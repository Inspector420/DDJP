// features/chat.js
// Owns chat — sending and receiving messages.
// Chat is not a protocol event — it goes through Matrix directly, not StreamManager.
// Depends on: MatrixBridge, Logger

const Chat = (() => {
  let currentChatId = null;
  let _onMessage = null;
  const _seen = new Set();          // event_ids already rendered — prevents double-render

  function onMessage(fn) { _onMessage = fn; }

  function init(chatId) {
    currentChatId = chatId;
    _seen.clear();                  // fresh room — forget prior message ids
    // Register for raw Matrix events — chat is not a ddjp protocol event
    MatrixBridge.onRawEvent(_handleRaw);
    Logger.debug("Chat: init for " + chatId);
  }

  function destroy() {
    MatrixBridge.offRawEvent(_handleRaw);   // actually remove THIS handler (onRawEvent(null) didn't)
    _seen.clear();
    currentChatId = null;
  }

  // Re-point chat at a different channel (e.g. a room setting changed the main
  // chat tier) WITHOUT re-subscribing the raw listener — init already did that,
  // and the listener filters by currentChatId. Clears the dedup set so the new
  // channel's messages render fresh. No-op if it's the same channel.
  function setRoom(chatId) {
    if (!chatId || chatId === currentChatId) return;
    currentChatId = chatId;
    _seen.clear();
    Logger.debug("Chat: switched to " + chatId);
  }

  function _handleRaw(raw, event, room) {
    if (!currentChatId) return;
    if (raw.type !== "m.room.message") return;
    if (raw.room_id !== currentChatId) return;
    // Dedup: a message the local user sent is delivered to raw listeners TWICE
    // — once via Room.timeline and once via Room.localEchoUpdated (the
    // confirmation path added alongside the local-echo guard). Protocol events
    // are deduped in StreamManager by event_id; chat has no StreamManager, so
    // it must dedup here or the sender sees their own message twice while
    // everyone else sees it once.
    const id = raw.event_id;
    if (id) {
      if (_seen.has(id)) return;
      _seen.add(id);
    }
    const body = _sanitize(raw.content.body || "");
    // Pass the full Matrix ID so the UI can look up rank for color.
    // shortName() in interface.js handles the display truncation.
    if (_onMessage) _onMessage(raw.sender, body);
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

  return { init, destroy, setRoom, onMessage, send };
})();
