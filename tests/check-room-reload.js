#!/usr/bin/env node
// tests/check-room-reload.js
// SUBJECT: features/room.js, ui/screens.js, app.js, features/botruntime.js
//
// WALL: AFTER A RELOAD THE TAB OPENS THE ROOM IT WAS IN — THAT TAB'S, THAT ACCOUNT'S — AND A TAB THAT WAS IN THE LOBBY STAYS THERE
//   (J83; the owner's E1, E2 and E5).
//   Before J83 every reload landed in the lobby: `app.js` showed the room list after `restoreSession` and nothing reopened a
//   room — the bot's daily reload included, which stopped the bot room every day until someone opened it on that tab.
//   Now the tab remembers its room in `sessionStorage` (per tab; a reload keeps it, a closed tab forgets it), under a key that
//   names the account; the switch writes it, a leave clears it unless the leave is for a reload, and the boot path reopens it.
//
//   Driven on the REAL `Room` over the homeserver model (`tests/_inviteworld.js`), with the boot path extracted from `app.js` and
//   the reopen and the lobby's note from `ui/screens.js`, run with doubles for what they only display; the daily reload on the
//   bot's own tab (`tests/_tabworld.js`).
//   R1  THE SWITCH WRITES THE TAB'S ROOM, under `ddjp_room:<this account>`.
//   R2  A LEAVE CLEARS IT (the tab was going to the lobby); a leave FOR A RELOAD keeps it.
//   R3  A BOOT WITH IT REOPENS: `app.js` binds the lobby (DMs at login, E3) and then asks the UI to reopen; the UI opens it through
//       the loading card as a reopen; `Room.reopen` says so and the room runs again. A boot with none stays in the lobby.
//   R4  A REFUSED REOPEN shows the lobby with its reason, says so, and forgets the tab's room.
//   R5  ANOTHER ACCOUNT'S ROOM IS NEVER READ: the key names the account.
//   R6  THE BOT'S DAILY RELOAD: leave (the tab keeps its room), reload — and the next page reopens it (E5).
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = path.join(__dirname, "..");
const W = require(path.join(__dirname, "_inviteworld.js"));
const TW = require(path.join(__dirname, "_tabworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[room-reload] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[room-reload] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const src = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
function braceFrom(text, at, what) {
  if (at < 0) throw new Error("extraction refused — " + what + " not found");
  const open = text.indexOf("{", at);
  let d = 0;
  for (let j = open; j < text.length; j++) {
    if (text[j] === "{") d++;
    else if (text[j] === "}") { d--; if (d === 0) return text.slice(at, j + 1); }
  }
  throw new Error("extraction refused — " + what + " never closes");
}
const KEY = "ddjp_room:" + W.ME;
const mkRoom = (hs, sid, o) => {
  const R = hs.ddjpRoom(sid, Object.assign({ levels: { [W.ME]: 20 } }, o || {}));
  hs.rooms[sid].members[W.ME] = "join";
  for (const k of ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized"]) if (R.ch[k] && hs.rooms[R.ch[k]]) hs.rooms[R.ch[k]].members[W.ME] = "join";
  return R;
};
const tab = (hs, ss) => W.inviteWorld({ hs, extras: { sessionStorage: ss } });

const PARTS = [];
const part = (fn) => PARTS.push(fn);

// ── R1, R2 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  const hs = W.homeserver(); mkRoom(hs, "!a:hs");
  const ss = TW.tabStore(), w = tab(hs, ss);
  ok(typeof w.Room.rememberedRoom === "function" && w.Room.rememberedRoom() === null, "R1 PREMISE — a fresh tab remembers no room",
    typeof w.Room.rememberedRoom === "function" ? w.Room.rememberedRoom() : "(no Room.rememberedRoom)");
  await w.Room.join("!a:hs"); await w.settle(30);
  ok(ss.getItem(KEY) === "!a:hs" && w.Room.rememberedRoom() === "!a:hs", "R1: the switch writes the tab's room under this account's key", ss._v);
  w.Room.leave("back to the lobby");
  ok(ss.getItem(KEY) === null, "R2: a leave to the lobby clears it — a tab that was in the lobby reloads into the lobby", ss._v);
  await w.Room.join("!a:hs"); await w.settle(30);
  w.Room.leave("the page is closing", { reloading: true });
  ok(ss.getItem(KEY) === "!a:hs", "R2: a leave FOR A RELOAD keeps it, so the reload opens the room again", ss._v);
});

// ── R3 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  // THE BOOT PATH, out of `app.js`: the restore branch of its first IIFE and `_enterLobby`, run with doubles for the client.
  const app = src("app.js");
  const enterLobby = braceFrom(app, app.indexOf("function _enterLobby("), "app.js _enterLobby");
  const iifeAt = app.indexOf("(async () => {", app.indexOf("// Restore a saved session"));
  const boot = braceFrom(app, iifeAt + "(async () => ".length, "app.js the boot IIFE");
  const run = async (restored) => {
    const calls = [];
    const env = {
      Logger: { info() {}, warn() {}, error() {}, debug() {} }, location: { origin: "https://x" }, _runningVersion: () => "v0",
      Store: { durability: { lockIn: async () => ({ mode: "persistent" }) }, account: { setUser: async () => {} } },
      MatrixAccount: { hasPendingSsoLogin: () => false, restoreSession: async () => restored },
      MatrixBridge: { getUserId: () => W.ME, start: async () => {}, waitForSync: async () => {} },
      ensureEncryption: async () => {}, _fillRoomTypes: () => {}, document: { getElementById: () => null },
      Chat: { dmInit: () => calls.push("dms") }, Room: { scanDDJPRooms: () => ({}) },
      Interface: { showScreen: (s) => calls.push(s), renderRoomList: () => calls.push("list"), reopenAfterReload: () => { calls.push("reopen"); return true; } },
    };
    const names = Object.keys(env);
    const fn = new Function(...names, enterLobby + "\nreturn async () => " + boot + ";");
    await fn(...names.map((k) => env[k]))();
    return calls;
  };
  const withSession = await run({ userId: W.ME });
  ok(JSON.stringify(withSession) === JSON.stringify(["dms", "screen-rooms", "list", "reopen"]),
    "R3: a restored session binds DMs (E3), shows the lobby, THEN asks to reopen the tab's room", withSession);
  const none = await run(null);
  ok(none.indexOf("reopen") < 0 && none.indexOf("screen-login") >= 0, "R3: with no session, the login screen and no reopen", none);

  // THE UI HALF, out of `ui/screens.js`: `reopenAfterReload` opens the remembered room through `openRoom`, as a reopen.
  const screens = src("ui/screens.js");
  const reopenFn = braceFrom(screens, screens.indexOf("function reopenAfterReload("), "ui/screens.js reopenAfterReload");
  const opened = [];
  const ui = (remembered) => new Function("Room", "openRoom", reopenFn + "\nreturn reopenAfterReload;")(
    { rememberedRoom: () => remembered, scanDDJPRooms: () => ({ owned: [], joined: [{ spaceId: "!a:hs", name: "Room A" }] }) },
    (room, o) => opened.push({ room, o }));
  ok(ui("!a:hs")() === true && opened.length === 1 && opened[0].room.spaceId === "!a:hs" && opened[0].room.name === "Room A" && opened[0].o && opened[0].o.reopen === true,
    "R3: the UI opens the remembered room, by its name, through the loading card as a REOPEN", opened);
  ok(ui(null)() === false && opened.length === 1, "R3: and a tab that remembers none stays in the lobby", opened.length);

  // THE ROOM HALF: a reload is a new page over the same tab — the room it remembers opens again, and says why.
  const hs = W.homeserver(); mkRoom(hs, "!a:hs");
  const ss = TW.tabStore(), w1 = tab(hs, ss);
  await w1.Room.join("!a:hs"); await w1.settle(30);
  w1.Room.leave("the page is closing", { reloading: true });
  const w2 = tab(hs, ss), l0 = w2.logs.length;
  ok(typeof w2.Room.reopen === "function", "R3 APPLIED — `Room.reopen` exists");
  if (typeof w2.Room.reopen === "function") { await w2.Room.reopen(); await w2.settle(30); }
  ok(w2.Room.runningRoom() === "!a:hs" && w2.lines(/Room: reopening !a:hs after a reload — this tab was in it/, l0).length === 1,
    "R3: after the reload the tab is in its room again, and the log says why (\"Room: reopening … after a reload — this tab was in it\")",
    { running: w2.Room.runningRoom(), lines: w2.lines(/Room: /, l0) });
});

// ── R4 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
part(async () => {
  // An OLD room (its channels carry no mark) — refused at its opening, so a reopen of it is refused too.
  const hs = W.homeserver(); mkRoom(hs, "!old:hs", { unmarked: true });
  const ss = TW.tabStore(); ss.setItem(KEY, "!old:hs");
  const w = tab(hs, ss), l0 = w.logs.length;
  let err = null;
  try { await w.Room.reopen(); } catch (e) { err = e; }
  await w.settle(20);
  ok(err && w.Room.runningRoom() === null && w.lines(/Room: reopen refused — .*; the lobby/, l0).length === 1,
    "R4: a refused reopen says so (\"Room: reopen refused — <reason>; the lobby\") and no room runs", { err: err && err.message, lines: w.lines(/Room: /, l0) });
  ok(ss.getItem(KEY) === null, "R4: and the tab forgets the room, so the next reload does not try it again", ss._v);
  // THE LOBBY SAYS WHY: `openRoom` out of `ui/screens.js`, as a reopen, against the real `Room`.
  const screens = src("ui/screens.js");
  const openFn = braceFrom(screens, screens.indexOf("async function openRoom("), "ui/screens.js openRoom");
  ss.setItem(KEY, "!old:hs");
  const shown = [];
  const box = new Function("Room", "Logger", "ChatPanels", "showRoomLoading", "showScreen", "renderRoomList", "enterMainScreen", "toggleLobbyDM",
    "let _pendingJoinId = null; let _lobbyNote = '';\n" + openFn + "\nreturn { openRoom, note: () => _lobbyNote };")(
    w.Room, { warn() {}, info() {} }, { lobbyDMOpen: () => false }, () => {}, (s) => shown.push(s), () => shown.push("list"), () => shown.push("main"), () => {});
  await box.openRoom({ spaceId: "!old:hs", name: "Old room" }, { reopen: true });
  ok(shown.indexOf("screen-rooms") >= 0 && shown.indexOf("main") < 0 && /^Could not reopen Old room — /.test(box.note()),
    "R4: the lobby is shown, with the reason above the room list", { shown, note: box.note() });
});

// ── R5 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
part(() => {
  const hs = W.homeserver(); mkRoom(hs, "!a:hs");
  const ss = TW.tabStore(); ss.setItem("ddjp_room:@other:hs", "!a:hs");
  const w = tab(hs, ss);
  ok(w.Room.rememberedRoom() === null, "R5: another account's room in this tab is never read — the key names the account", ss._v);
});

// ── R6 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
part(() => {
  // On the bot's own tab: the daily reload leaves (the runner's promised acts sent, history saved), keeps the tab's room, reloads.
  const w = TW.realWorld(), sb = w.sb, calls = [];
  w.enter(); w.goLive(); sb.B2Authority.flush();
  sb.BotRuntime._setReloadForTest(() => calls.push("reload:" + (sb.Room.runningRoom() || "no room")));
  const DAY = 24 * 3600 * 1000;
  sb.BotRuntime.maybeDailyReload(TW.T0);
  const r = sb.BotRuntime.maybeDailyReload(TW.T0 + DAY + 60000);
  ok(r && r.reloaded === true && calls[0] === "reload:no room", "R6: the daily reload leaves the room before it reloads (E5)", { r, calls });
  ok(w.ss.getItem("ddjp_room:" + TW.BOT) === TW.ROOM, "R6: and keeps the tab's room", w.ss._v);
  // The next page over the same tab remembers it — the boot path's reopen (R3) opens it.
  const w2 = TW.realWorld({ ss: w.ss });
  ok(w2.sb.Room.rememberedRoom() === TW.ROOM, "R6: the next page remembers the bot room, so the bot is back in it after the reload", w2.sb.Room.rememberedRoom());
});

(async () => {
  for (const fn of PARTS) {
    try { await fn(); } catch (e) { failed++; console.log("[room-reload] FAIL — a part threw: " + ((e && e.stack) || e)); }
  }
  _finished = true;
  if (failed) { console.log("[room-reload] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[room-reload] PASS — after a reload the tab opens the room it was in, and a tab that was in the lobby stays there (J83, E1, " +
    "E2, E5; " + asserts + " assertions): the switch writes the tab's room under this account's key; a leave to the lobby clears it and a " +
    "leave for a reload keeps it; the boot path binds DMs, shows the lobby, then reopens through the loading card as a reopen, which " +
    "says so and runs the room again; a refused reopen says why in the log and above the room list and forgets the room; another " +
    "account's room is never read; the bot's daily reload leaves first, keeps the room, and the next page remembers it.");
})();
