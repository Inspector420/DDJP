// DDJP — register the freshness service worker.
//
// This lives in its own file (not inline) because the page CSP is
// `script-src 'self' ...` with NO 'unsafe-inline'; an inline registration script
// would be blocked. `script-src 'self'` permits this external file, so no CSP
// change is required.
//
// `updateViaCache:'none'` makes the browser re-check sw.js itself against the
// network (bypassing the HTTP cache) on each navigation, so the SW can never get
// permanently stuck on an old copy. The SW guarantees a fresh index.html; the
// existing `?v=` bump then guarantees fresh JS. This file touches no app data.
(function () {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then(function (reg) {
        // Proactively check for an updated SW on every load.
        try { reg.update(); } catch (e) {}
      })
      .catch(function (err) {
        // Registration must NEVER break the app. Log to the in-app panel if present.
        if (window.Logger && Logger.warn) {
          Logger.warn('SW: register failed: ' + (err && err.message));
        }
      });
  });

  // Kill-switch helper. From the browser console run:  window.__ddjpKillSW()
  // to fully remove the service worker and clear its (code-only) cache. This does
  // NOT touch IndexedDB, so room/user/crypto data is untouched.
  window.__ddjpKillSW = function () {
    try {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'DDJP_SW_KILL' });
      }
    } catch (e) {}
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
      if (window.Logger && Logger.info) Logger.info('SW: unregistered. Hard-refresh to fully detach.');
    });
  };
})();
