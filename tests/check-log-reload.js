#!/usr/bin/env node
// tests/check-log-reload.js
// SUBJECT: ui/panels.js, core/store.js, core/idb.js, core/storageio.js, app.js, backends/backend1/matrixaccount.js
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
//   F  J99 (the owner's decision, `ddjp_631`): ADD ACCOUNT RELOADS THE PAGE. The real `app.js` boot path and account handlers,
//      over the real account module (`backends/backend1/matrixaccount.js`; the Matrix client is the double) and the real
//      Logs tab: a second account added from Manage accounts stores none of the first's lines — before, the login screen
//      came up in the same page, and the sign-in saved the first account's session lines into the second's log. Add
//      account goes through switching's own path, driven: the room left, the client stopped, the page reloaded; the load
//      after it is the login screen, every account kept as it was; a reload there comes back to the first account.
//   G  J99'S MARK, THE TWO GAPS THE SUPERVISOR PLANTED IN `ddjp_631` (`ddjp_632`): the "adding an account" mark is THIS TAB'S
//      ONLY — another tab of the same browser reloading meanwhile (a bot tab's daily reload) restores its own session, and
//      the tab that asked still opens on the login screen; and a tab with no storage of its own clears the active account,
//      so its next load is the login screen, not the first account again.
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
  const store = (m) => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); }, key: (i) => Array.from(m.keys())[i] || null, get length() { return m.size; } });
  const localStorage = store(ls);
  // THE TAB'S OWN (J99): a reload keeps it, and another tab of the same browser has its own. `noTabStore`: a tab with none.
  const ss = new Map(), sessionStorage = (o && o.noTabStore) ? undefined : store(ss);
  const b = { dbs, ls, ss, indexedDB, localStorage, sessionStorage };
  // ANOTHER TAB OF THIS BROWSER: the same IndexedDB and localStorage, a sessionStorage of its own (`ddjp_632`).
  b.newTab = () => { const ss2 = new Map(); return Object.assign({}, b, { ss: ss2, sessionStorage: store(ss2) }); };
  return b;
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
// ONE PAGE LOAD WITH THE APP ON IT (J99): `page`'s modules, the real account module and the real `app.js` — its boot path runs
// as the page loads, and its buttons are the page's. The Matrix client, the transport's start and the screens are doubles,
// and record what they are asked: a client stopped, a room left, the page reloaded, a screen shown.
function appPage(b) {
  const timers = [], calls = [], screens = [];
  const els = Object.create(null);
  const el = (id) => els[id] || (els[id] = { id: id, value: "", textContent: "", innerHTML: "", disabled: false, style: {}, listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; }, appendChild() {} });
  let client = null, p = null;
  const MB = { getClient: () => client, _setClient: (c) => { client = c || null; return client; }, _setAccountHost() {},
    getUserId: () => (client ? client.getUserId() : null), start: async () => {}, waitForSync: async () => {}, onProgress() {}, isSynced: () => true };
  const mkClient = (o) => ({ getUserId: () => o.userId || null, getRooms: () => [], getCrypto: () => null, on() {}, logout: async () => {},
    login: async (type, body) => ({ user_id: "@" + body.user + ":hs", access_token: "t-" + body.user, device_id: "D-" + body.user }),
    stopClient: () => { calls.push("stop:" + (o.userId || "a login's own client")); } });
  const loc = { origin: "https://ddjp.test", pathname: "/", search: "", hash: "", href: "https://ddjp.test/", assign() {},
    reload: () => { calls.push("reload"); p.reloaded = true; } };
  const extras = { localStorage: b.localStorage, sessionStorage: b.sessionStorage, setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    Date, Math, JSON, Promise, URL, URLSearchParams, navigator: {}, UIBase: { refs: {}, host: { el: () => ({}), clear() {} } },
    document: { getElementById: el, querySelectorAll: () => [] }, window: { isSecureContext: false, location: loc, addEventListener() {} }, location: loc,
    confirm: () => true, alert() {}, MatrixBridge: MB, matrixcs: { createClient: mkClient },
    Interface: { showScreen: (sc) => screens.push(sc), renderRoomList() {}, showAccounts: (o) => { p.accounts = o; }, reopenAfterReload: () => false,
      setResumeHandler() {}, setRoomListBusy() {}, setCreateRoomVisible() {} },
    Room: { leave: (why) => calls.push("leave:" + why), scanDDJPRooms: () => ({}), availableTypes: () => [], pendingCreate: () => null },
    Chat: { dmInit() {} } };
  if (b.indexedDB) extras.indexedDB = b.indexedDB;
  const sb = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js", "ui/panels.js",
    "backends/backend1/matrixaccount.js", "app.js"], extras);
  p = { sb, calls, screens, reloaded: false, accounts: null,
    log: (m) => sb.Logger.info(m), save: async () => { while (timers.length) timers.shift()(); await settle(); },
    signInAs: async (name) => {
      el("input-homeserver").value = "https://hs.test"; el("input-username").value = name; el("input-password").value = "pw-" + name;
      await el("btn-login").listeners.click(); await settle();
    },
    openAccounts: () => { el("btn-manage-accounts").listeners.click(); return p.accounts; },
    earlier: () => { const t = sb.Panels._logText().split("\n"); const i = t.findIndex((l) => / from an EARLIER SESSION/.test(l)); const j = t.findIndex((l) => / THIS session, /.test(l));
      return i < 0 ? [] : t.slice(i + 1, j); } };
  return p;
}
// THE APP'S NEXT LOAD OF THIS TAB — or, when nothing reloaded it, the same page going on (as Add account did before J99).
async function after(b, pg) { if (!pg.reloaded) return pg; const n = appPage(b); await settle(); return n; }

// ── F — J99: ADD ACCOUNT RELOADS THE PAGE (the owner's decision, `ddjp_631`) ─────────────────────────────────────────────
async function partF() {
  const b = browser({});
  const p1 = appPage(b);
  await settle();
  ok(p1.screens[p1.screens.length - 1] === "screen-login", "F PREMISE — a browser with no account opens on the login screen", p1.screens);
  await p1.signInAs("alice");
  for (let i = 0; i < 5; i++) p1.log("alice's line " + i);
  await p1.save();
  ok(p1.screens[p1.screens.length - 1] === "screen-rooms" && p1.sb.MatrixAccount.getActiveUserId() === "@alice:hs",
    "F PREMISE — alice signed in, the lobby showing, her lines logged", p1.screens);
  const opts = p1.openAccounts();
  ok(opts && typeof opts.onAdd === "function" && typeof opts.onSwitch === "function", "F PREMISE — Manage accounts offers Add account and switching");
  const c0 = p1.calls.length;
  opts.onAdd();
  await settle();
  const added = p1.calls.slice(c0);
  ok(JSON.stringify(added) === JSON.stringify(["leave:adding an account", "stop:@alice:hs", "reload"]),
    "F: ADD ACCOUNT GOES THROUGH THE RELOAD — the room left, alice's client stopped, the page reloaded (it showed the login " +
    "screen in this page, and a sign-in there carried this page's state into the second account)", added);
  const p2 = await after(b, p1);
  const MA = p2.sb.MatrixAccount;
  const before = { fresh: p2 !== p1, screen: p2.screens[p2.screens.length - 1], lobby: p2.screens.indexOf("screen-rooms") >= 0,
    listed: MA.listAccounts().map((a) => a.userId), active: MA.getActiveUserId(), stored: MA.hasStoredSession("@alice:hs") };
  ok(before.fresh && before.screen === "screen-login" && !before.lobby && JSON.stringify(before.listed) === '["@alice:hs"]' &&
     before.active === "@alice:hs" && before.stored === true,
    "F: AND THE NEXT LOAD IS THE LOGIN SCREEN FOR THE NEW ACCOUNT — alice kept as she was: listed, her session stored, still the " +
    "active account until the new one signs in", before);
  await p2.signInAs("bob");
  p2.log("bob's line");
  await p2.save();
  const kept = { listed: MA.listAccounts().map((a) => a.userId), active: MA.getActiveUserId(), stored: MA.hasStoredSession("@alice:hs") };
  ok(JSON.stringify(kept.listed) === '["@bob:hs","@alice:hs"]' && kept.active === "@bob:hs" && kept.stored === true,
    "F: bob signed in, Manage accounts lists both, alice's session kept — exactly as before J99", kept);
  const p3 = appPage(b);
  await settle();
  const e3 = p3.earlier();
  ok(p3.sb.MatrixAccount.getActiveUserId() === "@bob:hs" && has(e3, "bob's line") && !e3.some((l) => /alice's line/.test(l)),
    "F: J99 — A SECOND ACCOUNT ADDED FROM MANAGE ACCOUNTS STORES NONE OF THE FIRST'S LINES: bob's next load shows his own earlier " +
    "session, and not one of alice's (driven at J98: it showed alice's lines as bob's)", e3);
  // THE SAME PATH AS SWITCHING, DRIVEN: bob's page switches to alice.
  const o3 = p3.openAccounts(), c3 = p3.calls.length;
  o3.onSwitch("@alice:hs");
  await settle();
  const switched = p3.calls.slice(c3), steps = (l) => l.map((c) => c.split(":")[0]).join();
  ok(JSON.stringify(switched) === JSON.stringify(["leave:switching account", "stop:@bob:hs", "reload"]) && steps(added) === steps(switched),
    "F: AND IT IS SWITCHING'S OWN PATH — switching leaves, stops the client and reloads in the same three steps", { added: added, switched: switched });
  const p4 = await after(b, p3);
  ok(p4 !== p3 && p4.sb.MatrixAccount.getActiveUserId() === "@alice:hs" && p4.screens[p4.screens.length - 1] === "screen-rooms",
    "F: switched, the next load is alice's lobby", p4.screens);
  // CHANGED HER MIND: a reload at the new account's login screen comes back to the first account.
  const c = browser({});
  const q1 = appPage(c);
  await settle();
  await q1.signInAs("carol");
  q1.openAccounts().onAdd();
  await settle();
  const q2 = await after(c, q1);   // the new account's login screen
  const q3 = appPage(c);            // and she reloads there, signed in as nobody new
  await settle();
  ok(q2 !== q1 && q2.screens[q2.screens.length - 1] === "screen-login" && q3.sb.MatrixAccount.getActiveUserId() === "@carol:hs" &&
     q3.screens[q3.screens.length - 1] === "screen-rooms" && q3.screens.indexOf("screen-login") < 0,
    "F: A RELOAD AT THAT LOGIN SCREEN COMES BACK TO THE FIRST ACCOUNT — the login screen is shown once", { at: q2.screens, then: q3.screens });
}

// ── G — THE MARK IS THIS TAB'S, AND A TAB WITHOUT ONE STILL GETS THE LOGIN SCREEN (`ddjp_632`) ────────────────────────────
async function partG() {
  // TWO TABS OF ONE BROWSER, both alice's: tab A adds an account; tab B reloads before A's next load (a bot tab's daily reload).
  const b = browser({});
  const a1 = appPage(b);
  await settle();
  await a1.signInAs("alice");
  const tb = b.newTab();
  const b1 = appPage(tb);
  await settle();
  ok(b1.screens[b1.screens.length - 1] === "screen-rooms" && b1.sb.MatrixAccount.getActiveUserId() === "@alice:hs",
    "G PREMISE — a second tab of the same browser opens on alice's lobby", b1.screens);
  a1.openAccounts().onAdd();
  await settle();
  ok(a1.reloaded === true, "G PREMISE — tab A's Add account reloaded it", a1.calls);
  const b2 = appPage(tb);           // tab B's next load, while A's reload is under way
  await settle();
  ok(b2.screens[b2.screens.length - 1] === "screen-rooms" && b2.screens.indexOf("screen-login") < 0 &&
     b2.sb.MatrixAccount.getActiveUserId() === "@alice:hs",
    "G: THE MARK IS THIS TAB'S ONLY — another tab of the same browser, reloading while this one adds an account, restores its " +
    "session (alice's lobby), not the login screen", b2.screens);
  const a2 = await after(b, a1);
  ok(a2 !== a1 && a2.screens[a2.screens.length - 1] === "screen-login" && a2.screens.indexOf("screen-rooms") < 0,
    "G: AND THE TAB THAT ASKED STILL OPENS ON THE LOGIN SCREEN — the other tab did not take its mark", a2.screens);
  // A TAB WITH NO STORAGE OF ITS OWN: Add account clears the active account, so the next load is the login screen.
  const n = browser({ noTabStore: true });
  const n1 = appPage(n);
  await settle();
  await n1.signInAs("dave");
  ok(n1.screens[n1.screens.length - 1] === "screen-rooms", "G PREMISE — with no tab storage, dave signs in to the lobby", n1.screens);
  n1.openAccounts().onAdd();
  await settle();
  const n2 = await after(n, n1);
  const nm = n2.sb.MatrixAccount;
  const got = { fresh: n2 !== n1, screen: n2.screens[n2.screens.length - 1], lobby: n2.screens.indexOf("screen-rooms") >= 0,
    active: nm.getActiveUserId(), listed: nm.listAccounts().map((x) => x.userId) };
  ok(got.fresh && got.screen === "screen-login" && !got.lobby && got.active === null && JSON.stringify(got.listed) === '["@dave:hs"]',
    "G: A TAB WITH NO STORAGE OF ITS OWN — Add account clears the active account, so the next load is the login screen " +
    "(dave still listed), not dave's lobby again", got);
}

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
  await partF().catch((e) => ok(false, "F: threw — " + ((e && e.stack) || e)));
  await partG().catch((e) => ok(false, "G: threw — " + ((e && e.stack) || e)));
  if (failed) { console.log("[log-reload] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[log-reload] PASS — the Logs tab keeps the session before a reload (J97; " + asserts + " assertions). DRIVEN on the real " +
    "Logger, StorageIO, IDB, Store and the Logs panel across page loads of one browser: a reload shows the session before it, " +
    "never the shared store's old lines; the sessions before it up to the newest 2000 lines; a save due before the account's log " +
    "was read loses nothing; another account on the same browser sees only its own; and the same with no IndexedDB. AND ADD " +
    "ACCOUNT RELOADS THE PAGE (J99): the real app's Add account leaves, stops the client and reloads, as switching does; the next " +
    "load is the login screen with every account kept; the second account stores none of the first's lines. ITS MARK IS THE " +
    "TAB'S (G): another tab of the browser reloading meanwhile restores its session, and a tab with no storage of its own " +
    "clears the active account, so its next load is the login screen too.");
}
main().catch((e) => { console.log("[log-reload] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
