// features/chat.js
// Owns chat — sending and receiving messages.
// Chat is not a protocol event — it goes through Matrix directly, not StreamManager.
// Chat is RAM-only and never cached at rest (no consensus, no checkpoints).
// The live render window (in interface.js) is the single source of "what's
// currently shown" and owns dedup; this module forwards live messages with their
// Matrix event_id and does ONE capped recent backfill when a room's chat starts
// (backfillRecent — the last few messages of the active/default channel). Chat is
// otherwise PRESENT-FORWARD: it never pages history on scroll (that's a future DM
// concern). Undecryptable backfilled messages come back failed and are hidden.
// Depends on: MatrixBridge, Logger

const Chat = (() => {
  let currentChatId = null;
  let _onMessage = null;

  function onMessage(fn) { _onMessage = fn; }

  function init(chatId) {
    currentChatId = chatId;
    // Register for raw Matrix events — chat is not a ddjp protocol event
    MatrixBridge.onRawEvent(_handleRaw);
    Logger.debug("Chat: init for " + chatId);
  }

  function destroy() {
    MatrixBridge.offRawEvent(_handleRaw);   // actually remove THIS handler (onRawEvent(null) didn't)
    currentChatId = null;
  }

  // Re-point chat at a different channel (e.g. a room setting changed the main
  // chat tier) WITHOUT re-subscribing the raw listener — init already did that,
  // and the listener filters by currentChatId. No-op if it's the same channel.
  // The render window resets its own dedup when the box is rebuilt/cleared.
  function setRoom(chatId) {
    if (!chatId || chatId === currentChatId) return;
    currentChatId = chatId;
    Logger.debug("Chat: switched to " + chatId);
  }

  function _handleRaw(raw, event, room) {
    if (!currentChatId) return;
    if (raw.type !== "m.room.message") return;
    if (raw.room_id !== currentChatId) return;
    // The encrypted shell (type m.room.encrypted) is filtered out above; chat
    // forwards only once the SDK reports a decrypted (or terminally-failed)
    // message via Event.decrypted. We pass the RAW body plus a `failed` flag and
    // let the render buffer decide display: it upserts by event_id and never
    // downgrades real text to a placeholder, so each message is ONE self-updating
    // row (no duplicate "real + Couldn't decrypt" pair).
    const failed = !!(event && event.isDecryptionFailure && event.isDecryptionFailure());
    if (_onMessage) _onMessage(raw.event_id, raw.sender, _sanitize(raw.content.body || ""), failed);
  }

  // Returns a status so the UI can react instead of an uncaught rejection. The E2E
  // failure mode — crypto never initialised, so an encrypted room refuses the send —
  // used to throw here and vanish the message into the console; now it comes back as
  // { ok:false, reason:"no-crypto" } so the caller can keep the text and show the
  // "secure chat offline" banner. cryptoReady() lets the UI pre-empt the same case.
  async function send(text) {
    if (!currentChatId) { Logger.warn("Chat: no chat room"); return { ok: false, reason: "no-room" }; }
    const safe = _sanitize(text.trim());
    if (!safe) return { ok: false, reason: "empty" };
    if (!cryptoReady()) return { ok: false, reason: "no-crypto" };   // pre-empt the encrypted-room refusal
    try {
      await MatrixBridge.sendMessage(currentChatId, safe);
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) || "";
      Logger.warn("Chat: send failed — " + msg);
      // The specific E2E failure (client has no crypto) vs any other transport error.
      const reason = /encryption/i.test(msg) ? "no-crypto" : "send-failed";
      return { ok: false, reason: reason, error: msg };
    }
  }

  // E2E health proxies (ui/ can't touch MatrixBridge directly — Rule D). cryptoReady()
  // is the cheap "is secure chat up?" check the banner polls; retryCrypto() is the
  // in-place Tier-1 recovery (re-init after a fresh token, no reload).
  function cryptoReady() {
    try { return !!(MatrixBridge.cryptoAvailable && MatrixBridge.cryptoAvailable()); }
    catch (e) { return false; }
  }
  async function retryCrypto() {
    try { return !!(MatrixBridge.retryCrypto && await MatrixBridge.retryCrypto()); }
    catch (e) { Logger.warn("Chat: retryCrypto failed — " + (e && e.message)); return false; }
  }

  // One-shot recent backfill when a room's chat starts: a SINGLE capped fetch of
  // the most recent `count` messages of the ACTIVE channel (currentChatId — the
  // room-settings default tier, guest vs uncategorized). Present-forward after:
  // no scroll paging, never asks again. Whatever the server returns (possibly
  // fewer than `count`, possibly zero) is mapped oldest->newest; the render buffer
  // dedups by id. Undecryptable messages are carried through as failed (the
  // renderer hides them). Degrades to {messages:[]} on any transport error.
  async function backfillRecent(count) {
    if (!currentChatId) return { messages: [] };
    let res;
    try { res = await MatrixBridge.recentChatMessages(currentChatId, count); }
    catch (e) { Logger.warn("Chat: backfill failed: " + (e && e.message)); return { messages: [] }; }
    const out = [];
    for (const m of (res.messages || [])) {
      out.push({ id: m.event_id, sender: m.sender, body: _sanitize(m.body || ""), failed: !!m.failed });
    }
    return { messages: out };
  }

  // Coerce a message body to a string. We do NOT HTML-escape: the single safety
  // boundary is the UI rendering every body through document.createTextNode (never
  // innerHTML), enforced by the check-html-safety guard. Escaping here too
  // double-escaped everything (a typed "<3" rendered as "&lt;3") (#2).
  function _sanitize(text) {
    return text == null ? "" : String(text);
  }

  return { init, destroy, setRoom, onMessage, send, backfillRecent, cryptoReady, retryCrypto };
})();
