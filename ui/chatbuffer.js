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
    function _record(id, sender, body, failed, ts, redacted) {
      const red = !!redacted;
      return {
        id: id,
        sender: sender,
        body: red ? "" : (body == null ? "" : String(body)),
        failed: !!failed,
        redacted: red,
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
    function upsert(id, sender, body, failed, ts, redacted) {
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
        const rec = _record(id, sender, body, nextFailed, keepTs, red);
        msgs.set(id, rec);
        return { type: "update", record: rec, evicted: [] };
      }

      const rec = _record(id, sender, body, failed, ts, redacted);
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
        const rec = _record(m.id, m.sender, m.body, m.failed, m.ts);
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
      upsert(id, prev.sender, "", prev.failed, prev.ts, true);
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

  return { create, classify, CAP };
})();
