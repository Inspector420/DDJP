// core/statederiver.js
// Pure function. Takes ordered events, returns derived state.
// No side effects. No dependencies. Same input always gives same output.
//
// State shape: { nowPlaying, rotation, settings }
//   nowPlaying : { dj, song, pi, startedAt, skipped } | null
//   rotation   : [ { user, pending: [ {videoId, videoUrl}, ... ] }, ... ]  (head first)
//   settings   : { chat, vis, bg }   // owner-set, last-write-wins; defaults { chat:"uncategorized", vis:"private", bg:null }
//
// The queue is a rotation of PEOPLE, each carrying a small buffer of declared
// songs. Head plays, rotates to the back, stays only while the buffer holds a
// song. See 07_queue_rotation.md for the full design.
//
// Rank rides on ev.senderRank, stamped by transport from the CHANNEL an event
// arrived on (channel origin = rank proof). Room settings (chat tier, visibility)
// ARE derived here as ddjp.room.settings (owner-only, last-write-wins). The one
// setting still unbuilt is a min-DJ-rank: it's hardcoded to Uncategorized below,
// so anyone may play.

const StateDeriver = (() => {

  const RANK = { OWNER: 100, HIGH_STAFF: 80, STAFF: 60, VIP: 40, PLAYER: 20, GUEST: 10, UNCAT: 0 };

  // Default applies only to events that arrive without a stamped rank (tests).
  const DEFAULT_RANK = RANK.PLAYER;

  // Hardcoded for now (settings deferred): Uncategorized and up may DJ.
  const MIN_DJ_RANK = RANK.UNCAT;

  const BUFFER_MAX = 2;

  function songOf(c) {
    if (!c || !c.v) return null;
    return { videoId: c.v, videoUrl: c.u ? c.u : null };
  }

  function rankOf(ev) {
    return typeof ev.senderRank === "number" ? ev.senderRank : DEFAULT_RANK;
  }

  function derive(orderedEvents) {
    const members = {};      // userId -> { pending: [song], orderKey }
    const rankByUser = {};   // userId -> last rank seen (for "strictly below" checks)
    let nowPlaying = null;
    let tick = 0;            // rotation counter, local to this derive() — keeps it pure
    // Room settings: last owner-written ddjp.room.settings wins. Defaults apply
    // until the owner posts one. chat = which chat tier everyone renders;
    // vis = space visibility (public = anyone can join, private = invite only).
    let settings = { chat: "uncategorized", vis: "private", bg: null };

    function pushSong(m, s) {
      if (!s) return;
      if (m.pending.length >= BUFFER_MAX) return;
      const wasEmpty = m.pending.length === 0;
      m.pending.push(s);
      if (wasEmpty) m.orderKey = ++tick;   // first song: enter / re-enter at the back
    }

    function visible() {
      const ids = [];
      for (const u in members) if (members[u].pending.length > 0) ids.push(u);
      ids.sort((a, b) => members[a].orderKey - members[b].orderKey);
      return ids;
    }

    const list = Array.isArray(orderedEvents) ? orderedEvents : [];

    for (const ev of list) {
      if (!ev || typeof ev.type !== "string") continue;
      const c = ev.content || {};
      const user = ev.sender || (c.sender ? c.sender : null);
      const rank = rankOf(ev);
      if (user) rankByUser[user] = rank;

      if (ev.type === "ddjp.dj.join") {
        if (!user || rank < MIN_DJ_RANK) continue;
        if (!members[user]) members[user] = { pending: [], orderKey: 0 };
        pushSong(members[user], songOf(c));

      } else if (ev.type === "ddjp.dj.declare") {
        if (!user) continue;
        const m = members[user];
        if (!m) continue;
        pushSong(m, songOf(c));

      } else if (ev.type === "ddjp.dj.leave") {
        if (user) delete members[user];

      } else if (ev.type === "ddjp.dj.remove") {
        const target = c.x;
        if (!target || !members[target]) continue;
        if (rank < RANK.STAFF) continue;
        const targetRank = rankByUser[target] === undefined ? DEFAULT_RANK : rankByUser[target];
        if (!(rank > targetRank)) continue;          // only strictly below your own rank
        delete members[target];

      } else if (ev.type === "ddjp.dj.move") {
        if (rank < RANK.STAFF) continue;
        const x = c.x;
        if (!x || !members[x] || members[x].pending.length === 0) continue;
        const order = visible();
        const without = order.filter(u => u !== x);
        let idx;
        if (!c.after) {
          idx = 0;
        } else {
          const pos = without.indexOf(c.after);
          idx = pos < 0 ? without.length : pos + 1;
        }
        const newOrder = without.slice(0, idx).concat([x], without.slice(idx));
        for (const u of newOrder) members[u].orderKey = ++tick;  // others keep relative order

      } else if (ev.type === "ddjp.dj.reset") {
        if (rank < RANK.HIGH_STAFF) continue;
        for (const u in members) delete members[u];
        nowPlaying = null;   // reset is now a true zero state: empty queue AND nothing playing

      } else if (ev.type === "ddjp.dj.order") {
        // Reorder MY OWN declared buffer (which of my up-to-2 songs plays next).
        // c.o is the desired order, by videoId. Consensus-critical: processed in
        // sorted (l, event_id) order like every other event, with no arrival-time
        // input (P2/P7) and no optimism, so if this races a play that advances my
        // buffer, every client — including the sender — derives the same result.
        // Only the sender's own buffer is touched, so no rank gate is needed.
        // Total: a non-member, missing/empty o, or unknown ids are clean no-ops;
        // any songs not named in o keep their relative order at the back; matching
        // consumes by instance so a duplicate videoId can't drop a song.
        if (!user) continue;
        const m = members[user];
        if (!m) continue;
        const want = Array.isArray(c.o) ? c.o : null;
        if (!want || want.length === 0) continue;
        const pool = m.pending.slice();
        const reordered = [];
        for (const vid of want) {
          const idx = pool.findIndex(s => s.videoId === vid);
          if (idx >= 0) reordered.push(pool.splice(idx, 1)[0]);
        }
        for (const s of pool) reordered.push(s);
        m.pending = reordered;   // rotation position (orderKey) is unchanged

      } else if (ev.type === "ddjp.room.settings") {
        // Owner-only room settings. Channel origin is the proof (settings-owner
        // is stamped rank 100), so ignore any settings event below Owner rank.
        // Last one in sorted order wins (last-write-wins): the owner posts the
        // FULL settings blob each time, so we just overwrite. Total: bad/missing
        // fields fall back to the current value, and an unknown value for a known
        // field is ignored (keeps the last valid one).
        if (rank < RANK.OWNER) continue;
        const s = c.s;
        if (!s || typeof s !== "object") continue;
        if (s.chat === "uncategorized" || s.chat === "guest") settings.chat = s.chat;
        if (s.vis === "public" || s.vis === "private") settings.vis = s.vis;
        // bg: an owner-set room-background image LINK (text only — the image
        // itself is fetched client-side from the host, never over Matrix, the
        // same as a video id). A non-empty string sets it; null or "" clears it;
        // any other type is ignored (keeps the current value, matching chat/vis).
        // Host/format are deliberately NOT validated here: derive stays permissive
        // and total. The feature-layer load gate re-validates the host allowlist
        // before ever fetching the bytes, so a malformed or hostile link can be
        // derived but can never cause a load.
        if (typeof s.bg === "string") settings.bg = s.bg ? s.bg : null;
        else if (s.bg === null) settings.bg = null;

      } else if (ev.type === "ddjp.dj.play" || ev.type === "ddjp.dj.skip") {
        const prev = c.p ? c.p : null;
        const cur = nowPlaying ? nowPlaying.pi : null;
        if (cur !== prev) continue;                  // advance lock
        const isSkip = ev.type === "ddjp.dj.skip";
        if (isSkip && nowPlaying && user !== nowPlaying.dj && rank < RANK.VIP) continue;
        const order = visible();
        const head = order.length > 0 ? order[0] : null;
        if (!head) { nowPlaying = null; continue; }
        const song = members[head].pending.shift();
        nowPlaying = { dj: head, song: song, pi: ev.eventId, startedAt: ev.ts ? ev.ts : 0, skipped: isSkip };
        // Hard fall-out: if that was the DJ's last buffered song, they've run
        // out and are removed from the rotation entirely — running out of songs
        // means leaving the queue. They must send a fresh ddjp.dj.join to
        // re-enter (re-entering at the back). A DJ who still has a second
        // buffered song stays in and rotates to the back as normal.
        if (members[head].pending.length === 0) {
          delete members[head];
        } else {
          members[head].orderKey = ++tick;           // still has songs — rotate to the back
        }
      }
    }

    const rotation = visible().map(u => ({ user: u, pending: members[u].pending.slice() }));
    return { nowPlaying, rotation, settings };
  }

  return { derive };
})();
