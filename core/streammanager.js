// core/streammanager.js
// Single inbound entry point for all protocol events.
// Maintains ordered log, derives state, notifies subscribers.
// Depends on: StateDeriver, EventCache, Logger

const StreamManager = (() => {
  let eventLog = [];
  let derivedState = { nowPlaying: null, rotation: [], settings: StateDeriver.defaultSettings() };
  const subscribers = {};

  // --- Lamport order ---
  function orderEvents(events) {
    return events.slice().sort((a, b) => {
      if (a.l !== b.l) return a.l - b.l;
      return a.eventId < b.eventId ? -1 : 1;
    });
  }

  // --- Validate incoming event minimally ---
  function validate(raw, l) {
    if (!raw.event_id) return "missing event_id";
    if (!raw.room_id) return "missing room_id";
    if (typeof l !== "number") return "missing or invalid l";
    return null;
  }

  // --- Ingest — called by MatrixBridge only ---
  function ingest(raw) {
    // Protocol events arrive as m.room.message with JSON body containing a "t" field
    // Parse and extract — ignore anything that isn't a ddjp protocol event
    let protocolType, protocolContent, protocolL;

    if (raw.type === "m.room.message") {
      let parsed = null;
      try { parsed = JSON.parse(raw.content.body); } catch (e) { return; }
      if (!parsed || !parsed.t || !parsed.t.startsWith("ddjp.")) return;
      protocolType = parsed.t;
      protocolL = typeof parsed.l === "number" ? parsed.l : 0;
      protocolContent = parsed;
    } else {
      return; // ignore all non-message Matrix events
    }

    const err = validate(raw, protocolL);
    if (err) {
      Logger.warn("StreamManager: dropping event " + raw.event_id + " — " + err);
      return;
    }

    // Deduplicate
    if (eventLog.some(e => e.eventId === raw.event_id)) return;

    const entry = {
      eventId: raw.event_id,
      type: protocolType,
      content: protocolContent,
      l: protocolL,
      ts: raw.ts || 0,
      roomId: raw.room_id,
      sender: raw.sender || null,
      senderRank: typeof raw.senderRank === "number" ? raw.senderRank : undefined
    };

    eventLog.push(entry);

    // Re-derive state from full ordered log
    const ordered = orderEvents(eventLog);
    derivedState = StateDeriver.derive(ordered);

    Logger.debug("StreamManager: ingested " + entry.type +
      " l=" + entry.l +
      " id=" + entry.eventId +
      " p=" + (entry.content && entry.content.p !== undefined ? entry.content.p : "-") +
      " rotation=" + derivedState.rotation.length +
      " pi=" + (derivedState.nowPlaying ? derivedState.nowPlaying.pi : "-") +
      " playing=" + (derivedState.nowPlaying && derivedState.nowPlaying.song ? derivedState.nowPlaying.song.videoId : "none"));

    // Notify subscribers
    notify(entry);
  }

  // --- Notify subscribers for this event type + wildcard ---
  function notify(entry) {
    const handlers = [
      ...(subscribers[entry.type] || []),
      ...(subscribers["*"] || [])
    ];
    for (const fn of handlers) {
      try { fn(entry); }
      catch (e) { Logger.warn("StreamManager: subscriber error for " + entry.type + ": " + e.message); }
    }
  }

  // --- Subscription ---
  function on(type, fn) {
    if (!subscribers[type]) subscribers[type] = [];
    subscribers[type].push(fn);
  }

  function off(type, fn) {
    if (!subscribers[type]) return;
    subscribers[type] = subscribers[type].filter(f => f !== fn);
  }

  // --- State access ---
  function getState() { return derivedState; }
  function getLog() { return orderEvents(eventLog); }

  // --- Reset on room change ---
  function reset() {
    eventLog = [];
    derivedState = { nowPlaying: null, rotation: [], settings: StateDeriver.defaultSettings() };
    Logger.debug("StreamManager: reset");
  }

  return { ingest, on, off, getState, getLog, reset };
})();
