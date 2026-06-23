// core/logger.js
// Protocol-level logger. No dependencies.
// UI can subscribe to log output — Logger doesn't call UI directly.

const Logger = (() => {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  let currentLevel = levels.debug;
  const subscribers = [];

  function log(level, message) {
    if (levels[level] < currentLevel) return;
    const entry = { level, message, ts: Date.now() };
    for (const fn of subscribers) {
      try { fn(entry); } catch (e) {}
    }
  }

  function debug(msg) { log("debug", msg); }
  function info(msg)  { log("info",  msg); }
  function warn(msg)  { log("warn",  msg); }
  function error(msg) { log("error", msg); }

  function on(fn) { subscribers.push(fn); }
  function off(fn) { subscribers.splice(subscribers.indexOf(fn), 1); }
  function setLevel(level) { if (levels[level] !== undefined) currentLevel = levels[level]; }

  return { debug, info, warn, error, on, off, setLevel };
})();
