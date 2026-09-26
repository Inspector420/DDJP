// ui/chatbuffer.js
// Pure, RAM-ONLY chat message store. No DOM, no Matrix, no disk.
//   - chat.js feeds messages IN (via interface's onMessage handler -> upsert)
//   - interface.js renders OUT of it (windowed view, stage 2)
//
// It holds up to CAP messages keyed by Matrix event_id, oldest evicted on
// overflow. The key behavior is upsert(): an event_id already present is updated
// IN PLACE rather than appended again — so a message renders once and changes,
// instead of a "decrypting…" placeholder and the real text showing as two rows
// (the duplicate-message bug). Update is non-downgrading: a successfully
// decrypted body is never replaced by a later decryption-failure placeholder,
// and a placeholder is upgraded to real text if the key arrives later.
//
// It also exposes a PURE classify(body, opts) the renderer calls at display time
// to decide whether a body is a single allowlisted inline image URL, a clickable
// allowlisted link, or plain text — driven entirely by the viewer's prefs (passed
// in), so the buffer itself stays content-only and prefs changes just re-render.
//
// SECURITY: this is the ephemeral Skin. NOTHING here is ever persisted — it is a
// plain in-memory structure and a reload loses it by design. Decrypted chat text
// and image URLs never touch IndexedDB.
//
// Depends on: nothing (URL is a platform global).

const ChatBuffer = (() => {
  const CAP = 5000;          // max messages retained in RAM before oldest is evicted

  // --- display classification (PURE; prefs come from the caller) --------------
  // A chat body is "special" only if it is a SINGLE bare https URL token. Given
  // the viewer's current prefs (opts), classify decides how the UI should render
  // it. opts = {
  //   imagesOn, linksOn,                       // the two master toggles
  //   imageHostAllowed(host)->bool,            // effective image allowlist test
  //   linkHostAllowed(host)->bool,             // effective link allowlist test
  // }
  // Result: { kind:'image', src } | { kind:'link', href } | { kind:'text' }.
  // HTTPS ONLY — javascript:, data:, http: never qualify (they stay text), so a
  // pasted "javascript:..." can never become a live href. Image wins over link
  // when a URL satisfies both. This function reads NO global prefs and touches no
  // storage; the renderer passes opts from ChatPrefs.classifyOpts(). With no opts
  // (or both toggles off) everything is plain text — the default.
  const IMG_EXT = /\.(gif|png|jpe?g)$/i;
  function classify(body, opts) {
    opts = opts || {};
    const s = (body == null ? "" : String(body)).trim();
    if (!s || /\s/.test(s)) return { kind: "text" };   // must be ONE bare token, no whitespace
    let u;
    try { u = new URL(s); } catch (e) { return { kind: "text" }; }
    if (u.protocol !== "https:") return { kind: "text" };   // https only
    const host = (u.hostname || "").toLowerCase();
    if (opts.imagesOn && typeof opts.imageHostAllowed === "function" &&
        opts.imageHostAllowed(host) && IMG_EXT.test(u.pathname)) {
      return { kind: "image", src: u.href };
    }
    if (opts.linksOn && typeof opts.linkHostAllowed === "function" &&
        opts.linkHostAllowed(host)) {
      return { kind: "link", href: u.href };
    }
    return { kind: "text" };
  }

  // --- buffer instance --------------------------------------------------------
  function create() {
    const order = [];          // event_ids, oldest -> newest
    const msgs = new Map();     // id -> { id, sender, body, failed, kind, src }

    // Records hold CONTENT ONLY: { id, sender, body, failed }. Whether a body is
    // shown as an inline image, a clickable link, or plain text is decided at
    // RENDER time from the viewer's live prefs (ChatBuffer.classify + ChatPrefs),
    // so toggling a pref re-renders existing messages without rebuilding the buffer.
    // ── THREE STATES, NOT TWO (J11b) ─────────────────────────────────────────────────────────
    // `failed` and `redacted` are ORTHOGONAL because they answer different questions. `failed`
    // means *this device could not read it* — a fact about keys, possibly temporary, and the
    // renderer hides it. `redacted` means *the author took it back* — a fact about the room,
    // permanent, and the renderer shows a tombstone. A single flag could not carry both, and the
    // first version of J11 tried to route a deletion through `failed` and was refused by the
    // non-downgrading rule below, which is the whole reason this field exists.
    //
    // A REDACTED RECORD HOLDS NO BODY, AND THAT IS ENFORCED HERE RATHER THAN AT THE CALLER.
    // A tombstone that kept the text would leave the plaintext in RAM for any repaint to render —
    // the deletion would be a rendering choice rather than a removal. Forcing it here means no
    // caller can get it wrong, including one written later.
    // `tooLong` (ddjp_430): the message arrived over `Chat.MAX_CHARS`. Like a tombstone it holds NO
    // BODY. `Chat` drops the text at its door first, so this is the SECOND line — kept, and driven on its
    // own by `check-chat-view` PART I, because a later caller that forwarded the text would otherwise
    // put it in RAM with the suite green (a mutation deleting this line was green until that row existed).
    function _record(id, sender, body, failed, ts, redacted, tooLong) {
      const red = !!redacted, long = !!tooLong;
      return {
        id: id,
        sender: sender,
        body: (red || long) ? "" : (body == null ? "" : String(body)),
        failed: !!failed,
        redacted: red,
        tooLong: long,
        ts: Number(ts) || 0
      };
    }

    // order[] is kept sorted oldest -> newest by (ts, id) so the RENDERED order is
    // independent of ARRIVAL order. This is load-bearing for E2E chat: encrypted
    // messages are delivered via Event.decrypted, and a room's history decrypts
    // NEWEST-first during the backfill scrollback (and megolm keys can also arrive
    // late) — so arrival order is NOT time order. Sorting on insert lands every
    // message in its correct chronological slot no matter when or how it arrived.
    // ts is the Matrix origin_server_ts; id breaks exact-ts ties deterministically.
    function _sortsAfter(existingId, ts, id) {
      const a = msgs.get(existingId);
      if (!a) return false;
      if (a.ts !== ts) return a.ts > ts;
      return a.id > id;
    }
    function _place(id, ts) {                 // splice id into order[] at its sorted slot
      let i = order.length;                    // fast path: a genuinely-newest msg lands at the end
      while (i > 0 && _sortsAfter(order[i - 1], ts, id)) i--;
      order.splice(i, 0, id);
    }

    // Insert a new id, or UPDATE an existing one in place. Non-downgrading:
    // a real (failed:false) record is never overwritten by a placeholder
    // (failed:true). Returns:
    //   { type:'insert'|'update'|'noop', record, evicted:[ids] }
    function upsert(id, sender, body, failed, ts, redacted, tooLong) {
      if (!id) return { type: "noop", record: null, evicted: [] };

      if (msgs.has(id)) {
        const prev = msgs.get(id);
        // ── REDACTION IS TERMINAL ────────────────────────────────────────────────────────────
        // Once a row is a tombstone, nothing turns it back into text. The reachable case is not
        // hypothetical: backfill decrypts NEWEST-first and megolm keys arrive late, so a real body
        // for an already-redacted message can genuinely show up afterwards. Admitting it would
        // resurrect something the author deleted — the worst failure this file can have, and one
        // that would look like the buffer working.
        if (prev && prev.redacted && !redacted) {
          return { type: "noop", record: prev, evicted: [] };
        }
        // Don't let a decryption-failure placeholder clobber real text we already have.
        // UNCHANGED, and it must stay unchanged: this is J12's rule and PART A of
        // `check-chat-redaction` drives it as a control. A redaction does NOT arrive through this
        // branch — it sets `redacted`, not `failed` — which is exactly why the third state was
        // needed rather than a looser version of this test.
        if (prev && prev.failed === false && failed && !redacted) {
          return { type: "noop", record: prev, evicted: [] };
        }
        // In-place update keeps the row's chronological slot: preserve the ts we
        // first placed it at (a late re-decrypt must not move the row), adopting an
        // incoming ts only if we somehow never had one.
        //
        // AND THIS IS WHY A TOMBSTONE IS A MUTATION RATHER THAN A REMOVE-AND-REINSERT. The update
        // branch never touches `order[]`, so the slot is structurally untouchable from here.
        // Driven: reinserting a removed row lands it at the FRONT, because `_place` sorts on the
        // ts it is handed and the original was lost with the record. Mutation keeps `keepTs`.
        const keepTs = (prev && prev.ts) ? prev.ts : (Number(ts) || 0);
        // `redacted` is STICKY, so a later ordinary update cannot quietly un-tombstone a row.
        const red = !!redacted || !!(prev && prev.redacted);
        // A redaction says nothing about whether this device could READ the message, so it must
        // not change `failed`. Without this a row that was hidden as undecryptable would become a
        // VISIBLE tombstone — a deletion causing a row to APPEAR, which is backwards.
        const nextFailed = red && prev ? !!prev.failed : !!failed;
        const long = !!tooLong || !!(prev && prev.tooLong);   // sticky: a message's length does not change
        const rec = _record(id, sender, body, nextFailed, keepTs, red, long);
        msgs.set(id, rec);
        return { type: "update", record: rec, evicted: [] };
      }

      const rec = _record(id, sender, body, failed, ts, redacted, tooLong);
      msgs.set(id, rec);
      _place(id, rec.ts);
      const evicted = [];
      while (order.length > CAP) {        // overflow: drop the oldest
        const old = order.shift();
        msgs.delete(old);
        evicted.push(old);
      }
      return { type: "insert", record: rec, evicted: evicted };
    }

    // Fold in a batch of history (each {id, sender, body, failed, ts}), skipping
    // ids already present. Each is placed at its sorted (ts, id) slot — older
    // messages naturally land toward the front — so a batch never has to be
    // pre-ordered and can safely interleave with what's already buffered. If this
    // pushes past CAP, the excess is trimmed from the OLD (front) end. Returns
    // { inserted:[records], evicted:[ids] }.
    function prependOlder(items) {
      const inserted = [];
      for (const m of (items || [])) {
        if (!m || !m.id || msgs.has(m.id)) continue;
        const rec = _record(m.id, m.sender, m.body, m.failed, m.ts, false, m.tooLong);
        msgs.set(m.id, rec);
        _place(m.id, rec.ts);
        inserted.push(rec);
      }
      const evicted = [];
      while (order.length > CAP) {
        const old = order.shift();
        msgs.delete(old);
        evicted.push(old);
      }
      return { inserted: inserted, evicted: evicted };
    }

    // Turn an existing row into a tombstone. A thin caller of `upsert` rather than a second
    // implementation (P7): the state rules live in one place and this is the one-call spelling of
    // the transition, so a caller cannot assemble it slightly differently. Answers false when the
    // id is not held, which is the normal case — buffers are per tier and capped, and a client may
    // have joined after the message.
    function redact(id) {
      if (!id || !msgs.has(id)) return false;
      const prev = msgs.get(id);
      upsert(id, prev.sender, "", prev.failed, prev.ts, true, prev.tooLong);
      return true;
    }

    function remove(id) {                 // still used for eviction paths; a DELETION is a redact
      if (!msgs.has(id)) return false;
      msgs.delete(id);
      const i = order.indexOf(id);
      if (i >= 0) order.splice(i, 1);
      return true;
    }

    function get(id) { return msgs.get(id) || null; }
    function has(id) { return msgs.has(id); }
    function ids() { return order.slice(); }                 // oldest -> newest
    function tail(n) { return order.slice(Math.max(0, order.length - n)); }
    function size() { return order.length; }
    function clear() { order.length = 0; msgs.clear(); }

    return { upsert, redact, prependOlder, remove, get, has, ids, tail, size, clear };
  }

  // ── THE VIEW: ONE CHANNEL'S BUFFER AND THE FEED'S ROWS, IN, THE ROWS TO SHOW, OUT (PURE) ──
  // WHY THIS EXISTS. The chat box used to be PATCHED — a row inserted here, a row replaced there,
  // one DOM box shared by every tier and bookkept by per-tier sets of mounted ids. Driven at
  // `ddjp_424`: a tier switch left the old tier's rows on screen, a join drew every message twice,
  // and a message from a channel no tier named was drawn under whichever tier was visible. Each
  // was a plausible screen rather than an error. The cure is to stop patching: THIS function
  // decides what one channel's view holds, and the box is only ever a rendering of its answer. A
  // switch, a main-chat change and a new message are then the same operation — recompute, repaint.
  //
  // IT DECIDES NOTHING ABOUT THE ROOM. Which channel, which feed kinds, and where the window starts
  // all arrive as arguments; this only merges, windows and orders. It holds no state and reads no
  // clock, so the same inputs give the same rows — `check-chat-view` drives it through the panel.
  //
  // THE WINDOW. `anchor` is the oldest `(ts, key)` the view shows, or null for "the last `tail`
  // readable messages" (the shape a channel has while its entry backfill is still in flight, so a
  // scrollback flood arriving newest-first cannot pile up). An anchor of `{ ts: -Infinity }` shows
  // everything held.
  //
  // THE FEED. Rows come from `Room.foldFeed` (already refused-filtered there — never re-decided
  // here). A row shows only if it is strictly after `feedFromTs` — the go-forward line, a SERVER
  // stamp (owner ruling, `main/04-features.md` §The event feed) — and `showFeed(type)` says yes: one
  // answer per KIND of event, never per bundle (ddjp_427).
  // `feedFromTs` null means no feed at all yet. Feed and messages share one ordering, the server
  // stamp, so a row sits between the messages either side of it in time (P2: both are homeserver
  // clocks; nothing here compares either against a device clock).
  //
  // UNREADABLE MESSAGES ARE ABSENT, as they always were: a record this device could not decrypt is
  // held for ordering and dedup and never drawn. A tombstone IS drawn — it is a mark the room made.
  function view(buf, feedRows, opts) {
    const o = opts || {};
    const tail = (typeof o.tail === "number" && o.tail > 0) ? Math.floor(o.tail) : 10;
    const anchor = (o.anchor && typeof o.anchor.ts === "number") ? o.anchor : null;
    const aKey = anchor && typeof anchor.key === "string" ? anchor.key : "";
    const showFeed = (typeof o.showFeed === "function") ? o.showFeed : function () { return true; };
    const fromTs = (typeof o.feedFromTs === "number" && !isNaN(o.feedFromTs)) ? o.feedFromTs : null;
    const inWindow = function (ts, key) {
      return !anchor || ts > anchor.ts || (ts === anchor.ts && key >= aKey);
    };

    let msgs = [];
    const ids = (buf && typeof buf.ids === "function") ? buf.ids() : [];
    for (const id of ids) {
      const r = buf.get(id);
      if (!r || r.failed) continue;
      // AN OVER-LONG MESSAGE IS A CHAT EVENT, shown only if `showLong` (its kind's box; off by default). A
      // deleted one is the ordinary tombstone — but only where the event itself would show, because a
      // deletion must not reveal that a hidden message existed (the J11 rule for undecryptable rows).
      if (r.tooLong && o.showLong !== true) continue;
      msgs.push({ key: id, kind: (r.tooLong && !r.redacted) ? "long" : "msg", ts: r.ts, rec: r });
    }
    msgs = anchor ? msgs.filter((m) => inWindow(m.ts, m.key)) : msgs.slice(Math.max(0, msgs.length - tail));

    const feed = [];
    if (fromTs !== null) {
      for (const row of (Array.isArray(feedRows) ? feedRows : [])) {
        if (!row || !row.eventId) continue;
        const ts = Number(row.ts) || 0;
        if (!(ts > fromTs)) continue;
        let shown = true;
        try { shown = showFeed(row.type) !== false; } catch (e) { shown = true; }
        if (!shown) continue;
        const key = "feed:" + row.eventId;
        if (!inWindow(ts, key)) continue;
        feed.push({ key: key, kind: "feed", ts: ts, row: row });
      }
    }

    // One ordering for both kinds: server stamp, then key — so two things at one instant have a
    // stable order rather than whichever the sort happened to leave.
    const items = msgs.concat(feed).sort((a, b) =>
      (a.ts - b.ts) || (a.key < b.key ? -1 : (a.key > b.key ? 1 : 0)));
    return { items: items, messages: msgs.length, feed: feed.length };
  }

  return { create, classify, view, CAP };
})();
