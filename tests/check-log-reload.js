#!/usr/bin/env node
// tests/check-log-reload.js
// SUBJECT: ui/panels.js, core/store.js, core/idb.js, core/storageio.js
//
// WALL: THE LOGS TAB KEEPS THE SESSION BEFORE A RELOAD — the account's own, up to its last 2000 lines (J97, the owner's
// copies from `?v=537` to `?v=545`).
//
// ── WHAT WAS FOUND ─────────────────────────────────────────────────────────────────────────────────
// Every copy the owner made across nine builds showed the same "EARLIER SESSION": `19:48:29.640 DDJP v512` on the owner's tab,
// `19:48:33.027 Storage: idb-persisted (0/2048 MB)` on the bot's — never the session before the reload. The Logs tab read the
// earlier session when the page loaded, before anyone was signed in, so from the store every account shares; and it saved
// after sign-in, into the account's own (`Store.account.setUser` namespaces both engines). It wrote one place and read
// another, and the one it read had last been written at `?v=512`.
//
// ── WHAT THIS HOLDS, DRIVEN (the real Logger, StorageIO, IDB, Store and the Logs panel's own code, across page loads that
//    share one browser's IndexedDB and localStorage; the database itself is the only double) ───────────────────────────
//   A  A RELOAD SHOWS THE SESSION BEFORE IT: page 2's earlier session is page 1's lines, never the shared store's old ones.
//   B  AND THE ONE BEFORE THAT, UP TO 2000 LINES: page 3's earlier session holds pages 1 and 2, the newest 2000 lines.
//   C  NOTHING IS LOST TO A SAVE MADE BEFORE THE ACCOUNT'S LOG WAS READ: a page that logs before and while the earlier
//      session is being read still shows that session, and saves it on.
//   D  ONE ACCOUNT'S LOG IS NOT ANOTHER'S: a second account on the same browser sees only its own earlier session.
//   E  WITH NO INDEXEDDB (the localStorage fallback), the same.
"use strict";
const { loadInContext } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[log-reload] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const tick = () => new Promise((r) => setImmediate(r));
const settle = async (n) => { for (let i = 0; i < (n || 20); i++) await tick(); };

// ONE BROWSER: its IndexedDB databases (by name) and its localStorage, which every page load of it shares.
function browser(o) {
  const dbs = new Map(), ls = new Map();
  const later = (fn) => setImmediate(fn);
  const indexedDB = (o && o.noIdb) ? undefined : {
    open(name) {
      const req = {};
      later(() => {
        let db = dbs.get(name);
        const fresh = !db;
        if (!db) { db = new Map(); dbs.set(name, db); }
        req.result = {
          objectStoreNames: { contains: (s) => db.has(s) },
          createObjectStore: (s) => { db.set(s, new Map()); },
          close() {},
          transaction(store) {
            const tx = {};
            const done = (r, v) => later(() => { r.result = v; if (r.onsuccess) r.onsuccess(); later(() => { if (tx.oncomplete) tx.oncomplete(); }); });
            tx.objectStore = () => ({
              get: (k) => { const r = {}; done(r, JSON.parse(JSON.stringify(db.get(store).has(k) ? db.get(store).get(k) : null))); return r; },
              put: (v, k) => { const r = {}; db.get(store).set(k, JSON.parse(JSON.stringify(v))); done(r, k); return r; },
              delete: (k) => { const r = {}; db.get(store).delete(k); done(r, undefined); return r; },
            });
            return tx;
          },
        };
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    deleteDatabase(name) { dbs.delete(name); const r = {}; later(() => { if (r.onsuccess) r.onsuccess(); }); return r; },
  };
  const localStorage = { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); },
    removeItem: (k) => { ls.delete(k); }, key: (i) => Array.from(ls.keys())[i] || null, get length() { return ls.size; } };
  return { dbs, ls, indexedDB, localStorage };
}
// ONE PAGE LOAD of that browser: the storage modules, the Logger and the Logs panel, as index.html loads them. Its timers are
// held so the guard says when the panel's save runs.
function page(b) {
  const timers = [];
  const extras = { localStorage: b.localStorage, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    Date, Math, JSON, Promise, navigator: {}, UIBase: { refs: {}, host: { el: () => ({}), clear() {} } } };
  if (b.indexedDB) extras.indexedDB = b.indexedDB;
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js", "ui/panels.js"], extras);
  return { sb, log: (m) => sb.Logger.info(m), save: async () => { while (timers.length) timers.shift()(); await settle(); },
    signIn: async (u) => { await sb.Store.account.setUser(u); await settle(); },
    earlier: () => { const t = sb.Panels._logText().split("\n"); const i = t.findIndex((l) => / from an EARLIER SESSION/.test(l)); const j = t.findIndex((l) => / THIS session, /.test(l));
      return i < 0 ? [] : t.slice(i + 1, j); } };
}
const has = (lines, text) => lines.some((l) => l.indexOf(text) >= 0);

async function main() {
  for (const noIdb of [false, true]) {
    const tag = noIdb ? "E (no IndexedDB): " : "";
    const b = browser({ noIdb });
    // The store every account shares, as `?v=512` left it: a page that saved before anyone was signed in.
    {
      const p0 = page(b);
      await settle();
      p0.log("DDJP v512 — the lobby, before sign-in");
      await p0.save();
    }
    // PAGE 1: boots, signs in, runs a session.
    const p1 = page(b);
    await settle();
    p1.log("DDJP v546 — page 1");
    await p1.signIn("@owner:hs");
    for (let i = 0; i < 5; i++) p1.log("page 1, line " + i);
    await p1.save();
    // PAGE 2: the reload.
    const p2 = page(b);
    await settle();
    p2.log("DDJP v546 — page 2");
    await p2.signIn("@owner:hs");
    const e2 = p2.earlier();
    ok(has(e2, "page 1, line 4") && has(e2, "DDJP v546 — page 1") && !has(e2, "DDJP v512"),
      tag + "A: A RELOAD SHOWS THE SESSION BEFORE IT — page 1's lines, not the shared store's `DDJP v512` (live: the same v512 lines from ?v=537 to ?v=545)", e2);
    // PAGE 3, after page 2 logged past the cap: the newest 2000 lines of both earlier pages.
    for (let i = 0; i < 2100; i++) p2.log("page 2, line " + i);
    await p2.save();
    const p3 = page(b);
    await settle();
    // C: a line logged, and the panel's save due, while the account's earlier session is still being read — then the page
    // closes with nothing more to say.
    p3.log("DDJP v546 — page 3, before sign-in");
    const signing = p3.sb.Store.account.setUser("@owner:hs");
    await p3.save();
    await signing; await settle();
    const e3 = p3.earlier();
    ok(e3.length === 2000 && has(e3, "page 2, line 2099") && !has(e3, "page 2, line 0]") && !has(e3, "DDJP v512"),
      tag + "B: AND THE SESSIONS BEFORE IT, THE NEWEST 2000 LINES", { lines: e3.length, first: e3[0], last: e3[e3.length - 1] });
    await p3.save();
    const p4 = page(b);
    await settle();
    await p4.signIn("@owner:hs");
    const e4 = p4.earlier();
    ok(has(e4, "DDJP v546 — page 3, before sign-in") && has(e4, "page 2, line 2099"),
      tag + "C: A SAVE DUE WHILE THE ACCOUNT'S LOG WAS BEING READ LOST NOTHING — page 3's lines follow page 2's, not in place of them",
      { first: e4[0], last: e4[e4.length - 1], n: e4.length });
    // D: another account on the same browser.
    const p5 = page(b);
    await settle();
    await p5.signIn("@bot:hs");
    const e5 = p5.earlier();
    ok(!e5.some((l) => /page \d/.test(l)), tag + "D: ANOTHER ACCOUNT ON THE SAME BROWSER DOES NOT SEE THIS ONE'S LOG", e5.slice(0, 3));
  }
  if (failed) { console.log("[log-reload] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[log-reload] PASS — the Logs tab keeps the session before a reload (J97; " + asserts + " assertions). DRIVEN on the real " +
    "Logger, StorageIO, IDB, Store and the Logs panel across page loads of one browser: a reload shows the session before it, " +
    "never the shared store's old lines; the sessions before it up to the newest 2000 lines; a save due before the account's log " +
    "was read loses nothing; another account on the same browser sees only its own; and the same with no IndexedDB.");
}
main().catch((e) => { console.log("[log-reload] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
