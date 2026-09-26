// DDJP service worker — FRESHNESS ONLY.
//
// Its single job: make every page load fetch index.html from the NETWORK,
// bypassing the browser's stale HTTP cache, so a normal refresh always picks up
// the latest deploy.
//
// Why this is needed: GitHub Pages serves files with `Cache-Control: max-age=600`
// and gives no way to change that header. A normal refresh inside that window
// reuses the cached index.html — which still points at the OLD `?v=` JS — so the
// `?v=` cache-bust never gets seen. This SW re-issues the document request with
// `{cache:'reload'}`, which bypasses the HTTP cache: fresh index.html -> fresh
// `?v=` references -> fresh JS, automatically. (The JS/wasm files are NOT
// intercepted; once index.html is fresh, the existing `?v=` bump busts them.)
//
// What it deliberately does NOT do:
//   - It does NOT pre-cache the app shell (pre-caching code is the classic
//     "stuck on an old version" trap). It is network-FIRST, so even a stale copy
//     of this SW still serves fresh content.
//   - It NEVER reads or writes IndexedDB. Your room state, user settings, and
//     crypto keys live in the `ddjp` and `ddjp-keys` IndexedDB stores, which a
//     service worker cannot and does not touch. Updating code cannot wipe data.
//   - It only ever intercepts same-origin GET *navigations*. Cross-origin
//     requests (YouTube, matrix.org media), the JS/wasm/SDK assets, POSTs, and
//     range requests all pass straight through untouched.
//
// The only thing it caches is a single last-known-good copy of index.html, used
// ONLY as an offline fallback when the network is unreachable.

var SHELL_CACHE = 'ddjp-shell-v1';     // holds exactly one entry: the offline fallback document
var OFFLINE_DOC = './index.html';      // resolved relative to this sw.js (works at root OR /subpath/)

self.addEventListener('install', function (event) {
  // Take over as soon as possible; do NOT pre-cache anything.
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil((async function () {
    // Drop caches left by any previous SW version.
    var keys = await caches.keys();
    await Promise.all(keys.filter(function (k) { return k !== SHELL_CACHE; })
                          .map(function (k) { return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function (event) {
  var req = event.request;

  // Touch ONLY same-origin GET navigations. Everything else is none of our
  // business — pass through to the network/browser exactly as normal.
  if (req.method !== 'GET') return;
  if (req.mode !== 'navigate') return;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // Network-FIRST, cache-bypassing. `cache:'reload'` forces a fresh trip to the
  // server, defeating the stale HTTP-cached index.html. On success, refresh the
  // single offline-fallback entry. Only if the network is unreachable do we serve
  // the last good copy.
  event.respondWith((async function () {
    try {
      var fresh = await fetch(url.href, { cache: 'reload', redirect: 'follow', credentials: 'same-origin' });
      try {
        var cache = await caches.open(SHELL_CACHE);
        await cache.put(OFFLINE_DOC, fresh.clone());
      } catch (e) { /* cache write is best-effort; never fatal */ }
      return fresh;
    } catch (netErr) {
      var c = await caches.open(SHELL_CACHE);
      var fallback = await c.match(OFFLINE_DOC);
      if (fallback) return fallback;
      throw netErr;   // genuinely offline with no fallback — let the browser show its error
    }
  })());
});

// Kill-switch: the page can postMessage({type:'DDJP_SW_KILL'}) to fully retire
// this SW and clear its cache. (sw-register.js exposes window.__ddjpKillSW(); the
// deploy notes also give a console one-liner.)
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'DDJP_SW_KILL') {
    event.waitUntil((async function () {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      await self.registration.unregister();
      var clients = await self.clients.matchAll();
      clients.forEach(function (c) { try { c.navigate(c.url); } catch (e) {} });
    })());
  }
});
