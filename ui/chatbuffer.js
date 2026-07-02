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
    function _record(id, sender, body, failed) {
      return {
        id: id,
        sender: sender,
        body: body == null ? "" : String(body),
        failed: !!failed
      };
    }

    // Insert a new id, or UPDATE an existing one in place. Non-downgrading:
    // a real (failed:false) record is never overwritten by a placeholder
    // (failed:true). Returns:
    //   { type:'insert'|'update'|'noop', record, evicted:[ids] }
    function upsert(id, sender, body, failed) {
      if (!id) return { type: "noop", record: null, evicted: [] };

      if (msgs.has(id)) {
        const prev = msgs.get(id);
        // Don't let a decryption-failure placeholder clobber real text we already have.
        if (prev && prev.failed === false && failed) {
          return { type: "noop", record: prev, evicted: [] };
        }
        const rec = _record(id, sender, body, failed);
        msgs.set(id, rec);
        return { type: "update", record: rec, evicted: [] };
      }

      const rec = _record(id, sender, body, failed);
      msgs.set(id, rec);
      order.push(id);
      const evicted = [];
      while (order.length > CAP) {        // overflow: drop the oldest
        const old = order.shift();
        msgs.delete(old);
        evicted.push(old);
      }
      return { type: "insert", record: rec, evicted: evicted };
    }

    // Prepend OLDER messages from a scroll-up page (each {id, sender, body, failed}),
    // given oldest -> newest, skipping ids already present. If this pushes the
    // buffer past CAP, the excess is trimmed from the OLD (front) end. Returns
    // { inserted:[records], evicted:[ids] }.
    function prependOlder(items) {
      const front = [];
      const inserted = [];
      for (const m of (items || [])) {
        if (!m || !m.id || msgs.has(m.id)) continue;
        const rec = _record(m.id, m.sender, m.body, m.failed);
        msgs.set(m.id, rec);
        front.push(m.id);
        inserted.push(rec);
      }
      if (front.length) order.unshift.apply(order, front);
      const evicted = [];
      while (order.length > CAP) {
        const old = order.shift();
        msgs.delete(old);
        evicted.push(old);
      }
      return { inserted: inserted, evicted: evicted };
    }

    function remove(id) {                 // for a future delete/redaction feature; unused now
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

    return { upsert, prependOlder, remove, get, has, ids, tail, size, clear };
  }

  return { create, classify, CAP };
})();
