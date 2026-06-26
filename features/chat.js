// features/chat.js
// Owns chat — sending and receiving messages.
// Chat is not a protocol event — it goes through Matrix directly, not StreamManager.
// Chat is RAM-only and reloaded from Matrix as needed (no consensus, no
// checkpoints, nothing cached at rest). The live render window (in interface.js)
// is the single source of "what's currently shown" and owns dedup; this module
// just forwards messages with their Matrix event_id and pages older ones in.
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
    // A message the local user sent is delivered to raw listeners TWICE — once
    // via Room.timeline and once via Room.localEchoUpdated. Dedup is by event_id
    // and lives in the render window (interface), which both this live path and
    // the scroll-up path funnel through, so the same id is never drawn twice.
    const body = _sanitize(raw.content.body || "");
    // Pass the Matrix event_id (window dedup key) and full sender (UI looks up
    // rank for color; shortName() handles display truncation).
    if (_onMessage) _onMessage(raw.event_id, raw.sender, body);
  }

  // Page OLDER messages in from Matrix for a scroll-up. `seenIds` is the set of
  // event_ids currently in the render window; anything already shown is dropped
  // so we only return genuinely-older messages (oldest->newest). A message that
  // was trimmed from the window is NOT in seenIds, so it re-renders — that's how
  // "lose the past from RAM, get it back on scroll-up" works. Pure-ish: the only
  // side effect is the (review-only) SDK paging inside MatrixBridge.scrollbackChat.
  async function loadOlder(count, seenIds) {
    if (!currentChatId) return { messages: [], done: true };
    let res;
    try {
      res = await MatrixBridge.scrollbackChat(currentChatId, count || 30);
    } catch (e) {
      Logger.warn("Chat: loadOlder failed: " + (e && e.message));
      return { messages: [], done: true };
    }
    const seen = seenIds || new Set();
    const out = [];
    for (const m of (res.messages || [])) {
      if (m.event_id && seen.has(m.event_id)) continue;   // already in the window
      out.push({ id: m.event_id, sender: m.sender, body: _sanitize(m.body || "") });
    }
    return { messages: out, done: !!res.done };
  }

  async function send(text) {
    if (!currentChatId) { Logger.warn("Chat: no chat room"); return; }
    const safe = _sanitize(text.trim());
    if (!safe) return;
    await MatrixBridge.sendMessage(currentChatId, safe);
  }

  // Sanitize via textContent trick — no innerHTML ever
  function _sanitize(text) {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(text));
    return div.innerHTML;
  }

  return { init, destroy, setRoom, onMessage, send, loadOlder };
})();
