// core/logger.js
// Protocol-level logger. No dependencies.
// UI can subscribe to log output — Logger doesn't call UI directly.

const Logger = (() => {
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  let currentLevel = levels.debug;
  const subscribers = [];

  // Defence-in-depth: scrub anything that looks like a secret before it reaches
  // any subscriber (including the console). This means a normal "here's my log
  // output" share never contains a token or recovery key, even if some future log
  // call accidentally passes one. It does NOT cover matrix-js-sdk's own console
  // logging, and a user can still read their own token from devtools/localStorage.
  const _secretPatterns = [
    /\bsyt_[A-Za-z0-9_=-]{10,}/g,                                   // Synapse access token
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,         // JWT (OIDC, Topic 5)
    /\b(?:[A-HJ-NP-Za-km-z1-9]{4}[ -]){6,}[A-HJ-NP-Za-km-z1-9]{1,4}\b/g, // recovery/security key (grouped base58)
    /((?:access_?token|password|recovery_?key|pickle_?key)["']?\s*[:=]\s*)("?[^"',\s)]+)/gi, // key=value forms
  ];
  function _redact(text) {
    let out = text;
    for (let i = 0; i < _secretPatterns.length - 1; i++) out = out.replace(_secretPatterns[i], "‹redacted›");
    out = out.replace(_secretPatterns[_secretPatterns.length - 1], "$1‹redacted›");
    return out;
  }

  function log(level, message) {
    if (levels[level] < currentLevel) return;
    const safe = typeof message === "string" ? _redact(message) : message;
    const entry = { level, message: safe, ts: Date.now() };
    for (const fn of subscribers) {
      try { fn(entry); } catch (e) {}
    }
  }

  function debug(msg) { log("debug", msg); }
  function info(msg)  { log("info",  msg); }
  function warn(msg)  { log("warn",  msg); }
  function error(msg) { log("error", msg); }

  function on(fn) { subscribers.push(fn); }
  function off(fn) { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }
  function setLevel(level) { if (levels[level] !== undefined) currentLevel = levels[level]; }

  // Also redact the browser's F12 console — not just the in-app log panel. This
  // wraps console.* so direct console calls AND third-party (matrix-js-sdk) output
  // pass through the same scrubber before printing. Installed at load, before the
  // SDK bundle runs, so the SDK's own logging is covered too.
  // Limits (documented in SECURITY.md): only string arguments are scrubbed (objects
  // are left intact so devtools inspection still works), and a user can always read
  // their own token from localStorage / the Network tab.
  function _installConsoleRedaction() {
    if (typeof console === "undefined" || console.__ddjpRedacted) return;
    for (const m of ["log", "info", "warn", "error", "debug"]) {
      if (typeof console[m] !== "function") continue;
      const orig = console[m].bind(console);
      console[m] = function (...args) {
        orig.apply(null, args.map((a) => (typeof a === "string" ? _redact(a) : a)));
      };
    }
    try { Object.defineProperty(console, "__ddjpRedacted", { value: true }); } catch (e) { console.__ddjpRedacted = true; }
  }
  _installConsoleRedaction();

  return { debug, info, warn, error, on, off, setLevel };
})();
