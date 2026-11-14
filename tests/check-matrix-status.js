#!/usr/bin/env node
// tests/check-matrix-status.js
// SUBJECT: features/matrixstatus.js, backends/backend1/matrixbridge.js, backends/backend1/matrixaccount.js, ui/roster.js,
//          ui/screens.js, ui/chat.js, ui/base.js, index.html
//
// WALL: MATRIX SLOW-DOWNS — THE APP PACES ITSELF, AND YOUR PICTURE SAYS WHERE THINGS STAND (the owner's plan, part 3, `ddjp_697`;
// `main/05-matrix.md` §Slow-downs you can see). One status piece with no UI (`MatrixStatus`) holds the state; one table of kinds;
// every send names its kind; the room's structure is paced and its events and chat are not; your picture's ring and menu, and
// every wait, read only that piece.
//   T  THE ONE TABLE — six kinds, their keys and labels, the owner's words; no other file in the app spells a label.
//   K  EVERY SEND SITE NAMES A KIND FROM THE TABLE — each call that sends to Matrix in the transport carries `// kind: <key>`
//      (or `none`, the picture's alone); each kind a pacer call names is in the table and is the one its line's tag names; the
//      room's structure (ranks, membership, build) goes out PACED (`_paced`, the rank loop, the door, `{ paced: true }`), and
//      "actions" — every room event and chat — NOT paced (`_eventOut`).
//   O  THE ORANGE RULE — "Waiting N s" while the server's retry_after runs, then "Slowed N s ago" until a minute after the later of
//      the last push-back of that kind and the end of its wait (`ddjp_698`: a wait over a minute still gets its calm minute), then
//      "OK"; a new push-back restarts it; at most one timer, armed only while a line is orange.
// CHANGED ON PURPOSE AT `ddjp_698` (JOB 2, 697's decision 6 reversed): O's "Slowed" rows count from the wait's end, and a wait over
// a minute is driven.
//   C  THE CONNECTION MAPPING — SYNCING / PREPARED / CATCHUP Online; ERROR / STOPPED Offline (orange, not red); RECONNECTING never
//      flips it, either way.
//   R  THE RING'S FOUR STATES — green all well; orange any line not OK, Offline included; red only My Rank out of spec; both on the
//      diagonal; and the sheet draws each in the app's colours.
//   P  PACED AND NOT, DRIVEN THROUGH THE REAL BRIDGE — two invites a second apart, two messages at once; a message pushed back is
//      kept, waits out its retry_after, is sent again; the one after it waits its turn, in order, nothing dropped; the status
//      piece hears it ("Room Actions & Chat" Waiting, then Slowed; the held count, then none).
//   U  THE UI READS ONLY THE MODULE — no ui/ file names the transport's status; your picture's ring and its menu's lines are what
//      the module says and nothing else (a scripted module drives them); the room list's menu asks without My Rank.
//   N  THE CHAT NOTE — the strip's own note, in orange for this note only: "Matrix is slowing your messages and actions — yours
//      sends in 5 s.", gone when sent.
//   W  A WAIT SAID WHERE IT HAPPENS — "Waiting 12 s — Matrix asked us to slow down.", orange, on a leave's line.
//   A  A PACED SEND THAT NEVER ANSWERS DOES NOT HOLD THE REST (`ddjp_698`, JOB 1) — through the real bridge: at its one-minute
//      limit a paced send fails as "No answer from Matrix", logged, and the chain moves on; at the door a leave unanswered is named
//      in the leave's failures and the next room is left; one this client already shows left is read back as left; a late answer
//      is read back, never sent again.
//   V  THE WAITS CHROMIUM ALONE SAW AT 697, NOW DRIVEN (`ddjp_698`, JOB 4) — the wait under the card's rank line, on its own line;
//      the upgrade bar's countdown in the slow-down's words and orange, gone when its progress moves; making a room's step the same
//      way (the shared countdown driven; app.js's call read).
//   F  YOUR PICTURE'S MENU STAYS WITH IT (`ddjp_698`, JOB 6) — the one shared way: under the picture, its right edge with the
//      picture's, 8 px inside the window on both sides; placed again when the window narrows and when the header's content moves
//      the picture with the window unchanged (the next frame); let go when it closes.
// RED FIRST ON 696: `MatrixStatus` does not exist (every part refuses by name), no send names a kind, and nothing is paced but
// rank changes and leaves.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const W = require(path.join(__dirname, "_inviteworld.js"));
const SW = require(path.join(__dirname, "_screen-world.js"));
const CW = require(path.join(__dirname, "_chat-world.js"));
const ME = W.ME;

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[matrix-status] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[matrix-status] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const PARTS = [];
const part = (name, fn) => PARTS.push([name, fn]);
const rd = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };

// The status piece, alone, on a clock this guard moves; its one timer recorded, never fired behind a row's back.
function piece(over) {
  const clock = { t: 1.9e12, timers: [] };
  const ctx = Object.assign({ Date, Math, JSON, setTimeout: () => 0, clearTimeout: () => {} }, over || {});
  if (!fs.existsSync(path.join(ROOT, "features/matrixstatus.js"))) return null;
  const sb = loadInContext(["features/matrixstatus.js"], ctx);
  const M = sb.MatrixStatus;
  if (!M) return null;
  M._setClockForTest(() => clock.t, (fn, ms) => { const h = { fn, ms, live: true }; clock.timers.push(h); return h; }, (h) => { if (h) h.live = false; });
  const live = () => clock.timers.filter((h) => h.live);
  const pass = (ms) => { clock.t += ms; };
  const fire = () => { for (const h of live()) { h.live = false; h.fn(); } };
  return { M, clock, live, pass, fire };
}
const line = (st, key) => (st.lines.find((l) => l.key === key) || null);

// ═══ T — THE ONE TABLE ═══════════════════════════════════════════════════════════════════════════════════════════════════════
// CHANGED ON PURPOSE AT `ddjp_702` (the owner's: "lets put room actions & chat above user rank & invites and for this one lets ranme
// it Actions & Chat", "makybe in status change  user Rank & invite to User Ranking & Invite" — plural, the supervisor's default): the
// order and two labels; the keys as they were.
const TABLE = [["connection", "Matrix"], ["myRank", "My Rank"], ["actions", "Actions & Chat"], ["ranks", "User Ranking & Invites"],
  ["membership", "Room Joining & Leaving"], ["build", "Room Build & Upgrades"]];
part("T", async () => {
  const p = piece();
  ok(!!p, "T APPLIED — `MatrixStatus` is a feature module (features/matrixstatus.js)");
  if (!p) return;
  const got = (p.M.KINDS || []).map((k) => [k.key, k.label]);
  ok(JSON.stringify(got) === JSON.stringify(TABLE), "T: THE ONE TABLE — six kinds, in order, with the owner's labels", got);
  // The only place a label lives: no other file of the app spells one as a string.
  const files = [];
  for (const dir of ["features", "ui", "core", "backends/backend1", "backends/backend2", "backends/backend3"]) {
    if (!fs.existsSync(path.join(ROOT, dir))) continue;
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith(".js")) files.push(dir + "/" + f);
  }
  files.push("app.js");
  const spelled = [];
  for (const f of files) {
    if (f === "features/matrixstatus.js") continue;
    const src = rd(f);
    for (const [, label] of TABLE.slice(2)) if (src.indexOf("\"" + label + "\"") >= 0 || src.indexOf("'" + label + "'") >= 0) spelled.push(f + ": " + label);
  }
  ok(spelled.length === 0, "T: NO OTHER FILE SPELLS A KIND'S LABEL — the table is the only place it lives", spelled);
});

// ═══ K — EVERY SEND SITE NAMES A KIND ═════════════════════════════════════════════════════════════════════════════════════════
const SEND_METHODS = ["invite", "kick", "ban", "unban", "createRoom", "sendStateEvent", "sendEvent", "sendMessage", "redactEvent",
  "joinRoom", "leave", "setPowerLevel", "setAccountData", "setRoomAccountData", "uploadContent", "setAvatarUrl", "setDisplayName",
  "sendReadReceipt", "sendTyping", "forget", "sendToDevice", "setPresence", "knockRoom", "setRoomTag", "sendHtmlMessage",
  "sendTextMessage", "sendNotice", "setRoomName", "setRoomTopic"];
const STRUCTURE = ["ranks", "membership", "build"];
// The send sites of a transport file: every line calling the SDK client (`client.` or `_c().`) with a method that sends.
function sendSites(src) {
  const re = new RegExp("(?:\\bclient|_c\\(\\))\\.(" + SEND_METHODS.join("|") + ")\\(");
  const lines = src.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i], code = L.replace(/\/\/.*$/, "");
    if (/^\s*(\/\/|\*)/.test(L)) continue;
    const m = re.exec(code);
    if (!m) continue;
    const tag = /\/\/ kind: (\w+)/.exec(L);
    out.push({ n: i + 1, method: m[1], line: L.trim().slice(0, 160), kind: tag ? tag[1] : null, code });
  }
  return out;
}
// The function a line sits in (the nearest `function NAME(` above it at two spaces' indent).
function fnOf(src, n) {
  const lines = src.split("\n");
  for (let i = n - 1; i >= 0; i--) { const m = /^ {2}(?:async )?function (\w+)\(/.exec(lines[i]); if (m) return m[1]; }
  return null;
}
part("K", async () => {
  const p = piece();
  const keys = p ? p.M.KINDS.map((k) => k.key) : TABLE.map((t) => t[0]);
  const sendKinds = keys.filter((k) => k !== "connection" && k !== "myRank");
  const files = [];
  for (const dir of ["backends/backend1", "backends/backend2", "backends/backend3"]) {
    if (!fs.existsSync(path.join(ROOT, dir))) continue;
    for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith(".js")) files.push(dir + "/" + f);
  }
  const all = [];
  for (const f of files) { const src = rd(f); for (const s of sendSites(src)) all.push(Object.assign({ file: f, fn: fnOf(src, s.n) }, s)); }
  ok(all.length >= 20, "K APPLIED — the scan finds the transport's send sites (" + all.length + ")", all.length);
  const untagged = all.filter((s) => !s.kind).map((s) => s.file + ":" + s.n + " " + s.line);
  ok(untagged.length === 0, "K: EVERY SEND SITE NAMES ITS KIND — `// kind: <key>` on the line that sends", untagged);
  const unknown = all.filter((s) => s.kind && s.kind !== "none" && sendKinds.indexOf(s.kind) < 0).map((s) => s.file + ":" + s.n + " " + s.kind);
  ok(unknown.length === 0, "K: and every kind named is one from the table", unknown);
  const none = all.filter((s) => s.kind === "none").map((s) => s.method);
  ok(none.length === 2 && none.indexOf("uploadContent") >= 0 && none.indexOf("setAvatarUrl") >= 0,
    "K: `none` only for the profile picture's upload and its setting (the owner's: \"your picture dosent need a status line\")", none);
  // THE KIND A PACER CALL NAMES IS IN THE TABLE, AND IS ITS LINE'S TAG.
  const callKinds = [];
  for (const f of files) {
    const lines = rd(f).split("\n");
    lines.forEach((L, i) => {
      if (/^\s*\/\//.test(L)) return;
      const code = L.replace(/\/\/.*$/, "");
      for (const m of code.matchAll(/\b(?:_paced|sendThrough|pushedBack|landed)\(\s*"(\w+)"/g)) callKinds.push({ f, n: i + 1, kind: m[1], tag: (/\/\/ kind: (\w+)/.exec(L) || [])[1] || null });
      for (const m of code.matchAll(/\b_eventOut\([\s\S]*?,\s*"(\w+)"\)/g)) callKinds.push({ f, n: i + 1, kind: m[1], tag: (/\/\/ kind: (\w+)/.exec(L) || [])[1] || null });
    });
  }
  ok(callKinds.length >= 15, "K APPLIED — the pacer's calls that name a kind are found (" + callKinds.length + ")", callKinds.length);
  const badCall = callKinds.filter((c) => sendKinds.indexOf(c.kind) < 0 || (c.tag && c.tag !== c.kind)).map((c) => c.f + ":" + c.n + " " + c.kind + "/" + c.tag);
  ok(badCall.length === 0, "K: every kind a pacer call names is in the table, and is the kind its line's tag names", badCall);
  // PACED OR NOT, BY THE OWNER'S RULE: the structure through a paced door, events and chat not.
  const PACED_FNS = ["_rankSend", "sendMembership"];   // the rank change's loop and the door pace these themselves
  const pacedHere = (s) => /\b_paced\(\s*"/.test(s.code) || (/sendThrough\(\s*"/.test(s.code) && /paced: true/.test(rd(s.file).split("\n").slice(s.n - 1, s.n + 12).join("\n"))) || PACED_FNS.indexOf(s.fn) >= 0;
  const notPaced = all.filter((s) => STRUCTURE.indexOf(s.kind) >= 0 && !pacedHere(s)).map((s) => s.file + ":" + s.n + " " + s.kind + " in " + s.fn);
  ok(notPaced.length === 0, "K: THE ROOM'S STRUCTURE IS PACED — every ranks, membership and build send goes through `_paced`, `{ paced: true }`, the rank loop or the door", notPaced);
  const paced = all.filter((s) => s.kind === "actions" && (/\b_paced\(/.test(s.code) || PACED_FNS.indexOf(s.fn) >= 0 || !/\b(_eventOut|sendThrough)\(/.test(s.code))).map((s) => s.file + ":" + s.n + " in " + s.fn);
  ok(paced.length === 0, "K: EVERY ROOM EVENT AND CHAT IS NOT PACED — an actions send goes out through `_eventOut` (held only while Waiting)", paced);
  const bridge = rd("backends/backend1/matrixbridge.js");
  const rankLoop = /\{ const gap = _sendPace\.wait\(\); if \(gap > 0 && \(await until\(_rankSleep\(gap\)\)\)\.cut\) return; \}/.test(bridge);
  const door = /async function sendMembership\([\s\S]{0,700}?const gap = _sendPace\.wait\(\);\s*\n\s*if \(gap > 0\) await _paceCounted\(\(ms\) => turn\.sleep\(ms, "pace"\)\)\(gap\);/.test(bridge);
  ok(rankLoop && door, "K: and the two that pace themselves do — the rank loop waits its gap, and the door waits it before every join and leave", { rankLoop, door });
});

// ═══ O — THE ORANGE RULE ═════════════════════════════════════════════════════════════════════════════════════════════════════
part("O", async () => {
  const p = piece();
  if (!p) { ok(false, "O APPLIED — `MatrixStatus` exists"); return; }
  const { M } = p;
  const at = () => line(M.state(), "ranks");
  ok(at().state === "OK" && at().tone === "ok" && p.live().length === 0, "O: before any push-back the line is OK, and no timer runs", { line: at(), timers: p.live().length });
  M._tellForTest({ what: "pushed", kind: "ranks", retryAfterMs: 5000, at: p.clock.t });
  ok(at().text === "Waiting 5 s" && at().tone === "warn", "O: A PUSH-BACK — \"Waiting N s\" while the server's retry_after runs", at());
  ok(p.live().length === 1, "O: and ONE timer ticks the countdown", p.live().length);
  p.pass(1200); p.fire();
  ok(at().text === "Waiting 4 s" && p.live().length === 1, "O: it counts down, the one timer re-armed (never two)", { line: at(), timers: p.live().length });
  p.pass(3800); p.fire();
  ok(at().text === "Slowed 0 s ago" && at().tone === "warn", "O: THEN \"Slowed N s ago\" — still orange — once the wait has run, counted from its end", at());
  M._tellForTest({ what: "landed", kind: "ranks", at: p.clock.t });
  ok(at().state === "Slowed", "O: a send that lands does not turn it green early — the minute is the rule", at());
  p.pass(59000); p.fire();
  ok(at().text === "Slowed 59 s ago", "O: still Slowed 59 s after the wait's end", at());
  p.pass(1000);
  M._syncForTest("PREPARED");   // a change that is not the timer's tick arrives first (a background tab's late timer)
  ok(at().text === "OK" && at().tone === "ok" && p.live().length === 0, "O: OK A MINUTE AFTER THE WAIT'S END — and the timer stops, even before its own tick", { line: at(), timers: p.live().length });
  // A WAIT OVER A MINUTE (`ddjp_698`): followed by its calm minute, never straight to OK.
  M._tellForTest({ what: "pushed", kind: "ranks", retryAfterMs: 90000, at: p.clock.t });
  ok(at().text === "Waiting 90 s", "O: a push-back with a wait of 90 s — Waiting 90 s", at());
  p.pass(90000); p.fire();
  ok(at().text === "Slowed 0 s ago" && at().tone === "warn", "O: A WAIT OVER A MINUTE IS FOLLOWED BY A CALM MINUTE — Slowed when it ends, never straight to OK", at());
  p.pass(59000); p.fire();
  ok(at().state === "Slowed", "O: still Slowed 59 s after it", at());
  p.pass(1000); p.fire();
  ok(at().state === "OK" && p.live().length === 0, "O: OK a minute after the wait's end", { line: at(), timers: p.live().length });
  // A new push-back restarts it.
  M._tellForTest({ what: "pushed", kind: "ranks", retryAfterMs: 0, at: p.clock.t });
  ok(at().text === "Slowed 0 s ago", "O: a push-back with no retry_after goes straight to Slowed", at());
  p.pass(30000); p.fire();
  M._tellForTest({ what: "pushed", kind: "ranks", retryAfterMs: 2000, at: p.clock.t });
  ok(at().text === "Waiting 2 s" && p.live().length === 1, "O: A NEW PUSH-BACK RESTARTS IT — Waiting again, still ONE timer", { line: at(), timers: p.live().length });
  p.pass(2000 + 40000); p.fire();
  ok(at().text === "Slowed 40 s ago", "O: and the minute counts from the newest wait's end (40 s, not 72)", at());
  p.pass(20000); p.fire();
  ok(at().state === "OK" && p.live().length === 0, "O: then OK, the timer stopped", { line: at(), timers: p.live().length });
  // Per kind: one kind's push-back leaves the others OK.
  M._tellForTest({ what: "pushed", kind: "membership", retryAfterMs: 3000, at: p.clock.t });
  const st = M.state();
  ok(line(st, "membership").state === "Waiting" && line(st, "ranks").state === "OK" && line(st, "build").state === "OK" && line(st, "actions").state === "OK",
    "O: PER KIND — a push-back on one line leaves the others OK", st.lines.map((l) => l.key + ":" + l.state));
  ok(M.waitingSecs("membership") === 3 && M.waitingSecs("ranks") === 0, "O: and a wait in place reads that kind's seconds", [M.waitingSecs("membership"), M.waitingSecs("ranks")]);
  // The pure rule, at its edges.
  const k = { pushedAt: 1000, until: 4000 };
  ok(M.lineFrom(k, 3999).state === "Waiting" && M.lineFrom(k, 4000).state === "Slowed" && M.lineFrom(k, 63999).state === "Slowed" && M.lineFrom(k, 64000).state === "OK",
    "O: THE RULE AT ITS EDGES — Waiting until retry_after ends, Slowed until 60 s after that, OK at 60 s", [M.lineFrom(k, 3999).state, M.lineFrom(k, 4000).state, M.lineFrom(k, 63999).state, M.lineFrom(k, 64000).state]);
});

// ═══ C — THE CONNECTION MAPPING ══════════════════════════════════════════════════════════════════════════════════════════════
part("C", async () => {
  const p = piece();
  if (!p) { ok(false, "C APPLIED — `MatrixStatus` exists"); return; }
  const { M } = p;
  const m = (s, last) => M.connectionFrom(s, last);
  ok(m("SYNCING") === "Online" && m("PREPARED") === "Online" && m("CATCHUP") === "Online", "C: SYNCING, PREPARED and CATCHUP are Online", [m("SYNCING"), m("PREPARED"), m("CATCHUP")]);
  ok(m("ERROR", "Online") === "Offline" && m("STOPPED", "Online") === "Offline", "C: ERROR and STOPPED are Offline", [m("ERROR", "Online"), m("STOPPED", "Online")]);
  ok(m("RECONNECTING", "Online") === "Online" && m("RECONNECTING", "Offline") === "Offline", "C: RECONNECTING NEVER FLIPS IT — it keeps the last answer, either way", [m("RECONNECTING", "Online"), m("RECONNECTING", "Offline")]);
  const conn = () => line(M.state(), "connection");
  const seen = [];
  M.onChange(() => seen.push(conn().state));
  M._syncForTest("PREPARED");
  ok(conn().text === "Online" && conn().tone === "ok", "C: driven — Online, green", conn());
  M._syncForTest("RECONNECTING");
  ok(conn().text === "Online" && seen.length === 1, "C: a hiccup (RECONNECTING) keeps Online and tells nobody", { line: conn(), told: seen });
  M._syncForTest("ERROR");
  ok(conn().text === "Offline" && conn().tone === "warn", "C: ERROR — Offline, ORANGE (red is only My Rank, his correction)", conn());
  M._syncForTest("RECONNECTING");
  ok(conn().text === "Offline", "C: RECONNECTING keeps Offline too", conn());
  M._syncForTest("CATCHUP");
  ok(conn().text === "Online", "C: back — CATCHUP is Online", conn());
  M._syncForTest("STOPPED");
  ok(conn().text === "Offline" && JSON.stringify(seen) === JSON.stringify(["Online", "Offline", "Online", "Offline"]), "C: STOPPED — Offline; each change told once", seen);
  ok(M.state().ring === "orange", "C: and Offline rings orange", M.state().ring);
});

// ═══ R — THE RING'S FOUR STATES ══════════════════════════════════════════════════════════════════════════════════════════════
part("R", async () => {
  const p = piece();
  if (!p) { ok(false, "R APPLIED — `MatrixStatus` exists"); return; }
  const { M } = p;
  const L = (key, tone) => ({ key, tone });
  const all = (over) => ["connection", "myRank", "ranks", "actions", "membership", "build"].map((k) => L(k, (over && over[k]) || "ok"));
  ok(M.ringFrom(all()) === "green", "R: GREEN — every line OK", M.ringFrom(all()));
  ok(M.ringFrom(all({ actions: "warn" })) === "orange" && M.ringFrom(all({ connection: "warn" })) === "orange", "R: ORANGE — any line not OK, Offline included", [M.ringFrom(all({ actions: "warn" })), M.ringFrom(all({ connection: "warn" }))]);
  ok(M.ringFrom(all({ myRank: "bad" })) === "red", "R: RED — only My Rank out of spec", M.ringFrom(all({ myRank: "bad" })));
  ok(M.ringFrom(all({ myRank: "bad", connection: "warn" })) === "both" && M.ringFrom(all({ myRank: "bad", build: "warn" })) === "both", "R: BOTH — out of spec and slowed (or Offline)", M.ringFrom(all({ myRank: "bad", connection: "warn" })));
  ok(M.ringFrom(all().filter((l) => l.key !== "myRank")) === "green", "R: without a room (no My Rank line) green", null);
  // Driven: My Rank from the room's own standing, only while a room is open.
  let standing = null;
  const q = piece({ Room: { getMyId: () => ME, rankStanding: () => standing, onRankChange() {} }, MatrixBridge: { onPace() {}, onSyncState() {}, syncState: () => "SYNCING" } });
  ok(!line(q.M.state(), "myRank"), "R: NO ROOM OPEN — no My Rank line", q.M.state().lines.map((l) => l.key));
  standing = { ring: false, outOfStep: true };
  // CHANGED ON PURPOSE AT `ddjp_702` (the owner's: "lets change my rank from OK to In specs and out of spec to out of specs in red").
  ok(line(q.M.state(), "myRank").text === "In specs" && line(q.M.state(), "myRank").tone === "ok" && q.M.state().ring === "green", "R: in a room, in step (or within its minute): My Rank \"In specs\", green", line(q.M.state(), "myRank"));
  standing = { ring: true, outOfStep: true };
  ok(line(q.M.state(), "myRank").text === "Out of specs" && line(q.M.state(), "myRank").tone === "bad" && q.M.state().ring === "red", "R: where the ring rings today: \"Out of specs\", red", line(q.M.state(), "myRank"));
  ok(!line(q.M.state({ rank: false }), "myRank") && q.M.state({ rank: false }).ring === "green", "R: and the room list's menu asks without My Rank", q.M.state({ rank: false }).lines.map((l) => l.key));
  q.M._tellForTest({ what: "pushed", kind: "build", retryAfterMs: 1000, at: q.clock.t });
  ok(q.M.state().ring === "both", "R: out of spec and a line slowed: both", q.M.state().ring);
  // The sheet draws each: the app's green, its orange (the unread dot's), its red; both on the diagonal.
  const css = rd("index.html");
  const bg = (cls) => (new RegExp("\\.st-ring\\.st-" + cls + " \\{ background: ([^;]+);").exec(css) || [])[1] || null;
  ok(bg("green") === "#6ee7a0" && bg("orange") === "#E8890C" && bg("red") === "#ff6b6b" && /^linear-gradient\(135deg, #ff6b6b 0 50%, #E8890C 50% 100%\)$/.test(bg("both") || ""),
    "R: THE SHEET DRAWS THE FOUR — green, orange, red, and half red half orange on the diagonal", [bg("green"), bg("orange"), bg("red"), bg("both")]);
  const dot = (/\.tab\.unread::after \{[^}]*background: (#[0-9A-Fa-f]{6})/.exec(css) || [])[1];
  ok(dot === "#E8890C", "R: the orange is the app's own (the unread dot's)", dot);
});

// ═══ P — PACED AND NOT, THROUGH THE REAL BRIDGE ══════════════════════════════════════════════════════════════════════════════
part("P", async () => {
  const hs = W.homeserver();
  const log = [];
  let t = 1.9e12;
  let fail = [];
  const client = {
    sendMessage: async (roomId, content) => { log.push(["send", content.body, t]); if (fail.length) { const e = fail.shift(); throw Object.assign(new Error("Too Many Requests"), e); } return { event_id: "$" + content.body }; },
    invite: async (roomId, userId) => { log.push(["invite", userId, t]); },
  };
  const w = W.inviteWorld({ hs, client });
  if (typeof w.MB.onPace !== "function" || typeof w.MB._setPaceSleepForTest !== "function") { ok(false, "P APPLIED — the bridge tells what its pacer saw (`onPace`) and its pace sleep has a seam"); return; }
  const slept = [];
  // The pace's sleep and the clock, this guard's: a sleep moves the clock by what it waited.
  w.MB._setPaceSleepForTest((ms) => { slept.push(ms); log.push(["sleep", ms, t]); t += ms; return Promise.resolve(); });
  w.MB._setRankClockForTest(null, null, null, () => t);
  const S = loadInContext(["features/matrixstatus.js"], { MatrixBridge: w.MB, Room: { onRankChange() {} }, Date, Math, JSON, setTimeout: () => 0, clearTimeout: () => {} }).MatrixStatus;
  S._setClockForTest(() => t, () => 0, () => {});
  // Two invites to the room: the room's structure, paced — the second a second after the first.
  log.length = 0;
  await Promise.all([w.MB.inviteToSpace("!s:hs", {}, "@a:hs"), w.MB.inviteToSpace("!s:hs", {}, "@b:hs")]);
  const inv = log.filter((e) => e[0] === "invite");
  ok(inv.length === 2 && inv[1][2] - inv[0][2] >= 1000 && slept.some((ms) => ms >= 1000), "P: THE ROOM'S STRUCTURE IS PACED — two invites a second or more apart", log);
  // Two messages: not paced — both at once.
  log.length = 0; slept.length = 0;
  t += 10000;
  const two = await Promise.all([w.MB.sendMessage("!c:hs", "one"), w.MB.sendMessage("!c:hs", "two")]);
  ok(slept.length === 0 && log.filter((e) => e[0] === "send").length === 2, "P: ROOM EVENTS AND CHAT ARE NOT PACED — two messages go at once, no wait", log);
  ok(line(S.state(), "actions").state === "OK", "P: and the line stays OK", line(S.state(), "actions"));
  // A push-back on a message: reported, kept, waits out retry_after, sent again; the next waits its turn; nothing dropped.
  log.length = 0; slept.length = 0;
  fail = [{ errcode: "M_LIMIT_EXCEEDED", httpStatus: 429, data: { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 3000 } }];
  let releaseFirst = null;
  w.MB._setPaceSleepForTest((ms) => { slept.push(ms); log.push(["sleep", ms, t]); return new Promise((r) => { releaseFirst = () => { t += ms; r(); }; }); });
  const a = w.MB.sendMessage("!c:hs", "three");
  a.catch(() => {});   // read below; a rejection is a row's reading, not a crash
  await turns(5);
  const told = line(S.state(), "actions");
  ok(told.state === "Waiting" && told.text === "Waiting 3 s", "P: THE STATUS PIECE HEARS IT — \"Room Actions & Chat\" Waiting 3 s", told);
  const b = w.MB.sendMessage("!c:hs", "four");
  b.catch(() => {});
  await turns(5);
  ok(log.filter((e) => e[0] === "send").map((e) => e[1]).join(",") === "three" && S.state().chat && S.state().chat.held === 1,
    "P: WHILE IT WAITS, THE NEXT IS KEPT — not sent, held (one), the chat told", { log, chat: S.state().chat });
  w.MB._setPaceSleepForTest((ms) => { slept.push(ms); log.push(["sleep", ms, t]); t += ms; return Promise.resolve(); });
  if (releaseFirst) releaseFirst();
  const done = await Promise.all([a, b]).then((r) => r, (e) => "threw: " + e.message);
  await turns(5);
  const sends = log.filter((e) => e[0] === "send");
  ok(Array.isArray(done) && sends.map((e) => e[1]).join(",") === "three,three,four" && sends[1][2] >= sends[0][2] + 3000,
    "P: SENT AGAIN AFTER retry_after, THEN THE NEXT — in order, nothing dropped", { done, log });
  ok(!S.state().chat && line(S.state(), "actions").state === "Slowed", "P: none held any more; the line says Slowed until its minute", { chat: S.state().chat, line: line(S.state(), "actions") });
  ok(two.length === 2, "P: (the two before: both answered)", two);
});

// ═══ U — THE UI READS ONLY THE MODULE ════════════════════════════════════════════════════════════════════════════════════════
part("U", async () => {
  const names = /\b(onPace|onSyncState|syncState|getSyncState|waitingFor|_sendPace|retry_after|retryAfterMs|_paceTell)\b/;
  const hits = [];
  for (const f of fs.readdirSync(path.join(ROOT, "ui"))) {
    if (!f.endsWith(".js")) continue;
    rd("ui/" + f).split("\n").forEach((L, i) => { if (!/^\s*\/\//.test(L) && names.test(L.replace(/\/\/.*$/, ""))) hits.push("ui/" + f + ":" + (i + 1)); });
  }
  ok(hits.length === 0, "U: NO ui/ FILE NAMES THE TRANSPORT'S STATUS — only the status piece is read", hits);
  // A SCRIPTED STATUS PIECE drives the ring and the menu: what they show is what it says, and nothing else.
  const listeners = [];
  const asked = [];
  let ring = "both";
  let lines = [{ key: "connection", label: "Matrix", state: "Offline", tone: "warn", text: "Offline" },
    { key: "myRank", label: "My Rank", state: "Out of specs", tone: "bad", text: "Out of specs" },
    { key: "ranks", label: "User Ranking & Invites", state: "Waiting", tone: "warn", text: "Waiting 7 s" }];
  const MS = { state: (o) => { asked.push(o || null); return { lines: (o && o.rank === false) ? lines.filter((l) => l.key !== "myRank") : lines, ring, chat: null }; },
    onChange: (fn) => listeners.push(fn), waitingSecs: () => 0 };
  const features = {
    Room: { rankLadder: () => [], getMyId: () => ME, getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [], getMyRank: () => 0,
      getMyAuthorityLevel: () => 0, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
    Media: { getAvatarUrl: () => null },
  };
  const w = SW.world({ features, domShaped: true, globals: { MatrixStatus: MS } });
  if (!w.sb.Roster || typeof w.sb.Roster.ownPicture !== "function") { ok(false, "U APPLIED — `Roster.ownPicture` draws your picture"); return; }
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Status room" }); } catch (e) {}
  w.sb.Roster.renderMyRank();
  const slot = w.refs.myAvatarSlot;
  const ringOf = (n) => ((/(^|\s)st-(green|orange|red|both)(\s|$)/.exec((n && n.className) || "") || [])[2] || null);
  ok(slot && ringOf(slot) === "both" && !/rank-off/.test(slot.className), "U: YOUR PICTURE'S RING IS THE MODULE'S — it says both, the picture rings both", slot && slot.className);
  ring = "orange";
  for (const fn of listeners) fn();
  ok(ringOf(slot) === "orange", "U: it says orange and tells — the ring follows, no other source", slot && slot.className);
  // The menu: opened by a click; its lines are the module's, label left, state right, in its colour.
  slot.onclick();
  const menu = w.doc.body && Array.from(w.doc.body.children || []).find((n) => /(^|\s)st-menu(\s|$)/.test(n.className || ""));
  const flat = (k) => [k].concat(...Array.from((k && k.children) || []).map(flat));
  const got = menu ? flat(menu).filter((n) => /(^|\s)st-line(\s|$)/.test(n.className || "")).map((n) => [n.children[0].textContent, n.children[1].textContent, n.children[1].className]) : null;
  ok(JSON.stringify(got) === JSON.stringify(lines.map((l) => [l.label, l.text, "st-state st-" + l.tone])),
    "U: THE MENU'S LINES ARE THE MODULE'S — label, state, colour, in its order", got);
  const pic = menu ? flat(menu).find((n) => /(^|\s)st-pic(\s|$)/.test(n.className || "")) : null;
  ok(!!pic && pic.tagName && pic.tagName.toLowerCase() === "button" && flat(pic).some((n) => n.textContent === "✎"), "U: your picture in it is a button, a small ✎ on it", pic && pic.className);
  const texts = menu ? flat(menu).filter((n) => !n.children || !n.children.length).map((n) => n.textContent).filter(Boolean) : [];
  // CHANGED ON PURPOSE AT `ddjp_699` (the owner's: copy your name and the layout "there", in this menu): its top row's ⧉ copies
  // your ID, and in a room the layout tiles say their words — the shell's one table's labels, read from it, never restated.
  const layWords = (w.H.layouts ? w.H.layouts() : []).map((l) => l.label);
  // CHANGED ON PURPOSE AT `ddjp_702` (the owner's pictures): in a room your rank's pill (the rank's own name) and the room's segment —
  // its name (here its id: this room has no name), its id and its ⧉ — are in it too.
  const cur = features.Room.getCurrent();
  const roomWords = [cur.name || cur.spaceId, cur.spaceId, w.H.rankName(features.Room.getMyAuthorityLevel())];
  const allowed = [ME.split(":")[0].replace("@", ""), ME, "✎", "\u29C9"].concat(...lines.map((l) => [l.label, l.text]), layWords, roomWords);
  ok(texts.every((x) => allowed.indexOf(x) >= 0 || /^[A-Z]{1,2}$/.test(x)), "U: no other text — your name and id, the ✎, your ID's ⧉, your rank, the room's name, id and ⧉, the lines, and in a room the layouts' words", texts);
  lines = lines.map((l) => (l.key === "ranks" ? Object.assign({}, l, { state: "OK", tone: "ok", text: "OK" }) : l));
  for (const fn of listeners) fn();
  const got2 = menu ? flat(menu).filter((n) => /(^|\s)st-line(\s|$)/.test(n.className || "")).map((n) => n.children[1].textContent) : null;
  ok(got2 && got2[2] === "OK", "U: and an open menu follows the module as it changes", got2);
  // The room list's header: your picture, the same ring, the same menu — asked without My Rank.
  asked.length = 0;
  const add = (tag, id) => { const n = w.doc.createElement(tag); n.id = id; w.doc.body.appendChild(n); return n; };
  add("span", "rooms-identity"); add("input", "input-join-code"); add("button", "btn-join-room"); add("span", "rooms-lock"); add("div", "room-list");
  features.Room.scanDDJPRooms = () => ({ owned: [], joined: [], invited: [], unconfirmed: [] });
  w.sb.Screens.showScreen("screen-rooms");
  w.sb.Screens.renderRoomList({ owned: [], joined: [], invited: [], unconfirmed: [] });   // the header is drawn with the list
  const roomsSlot = w.doc.getElementById ? w.doc.getElementById("rooms-identity") : null;
  const rp = roomsSlot ? flat(roomsSlot).find((n) => /(^|\s)rooms-my-pic(\s|$)/.test(n.className || "")) : null;
  ok(!!rp && ringOf(rp) === "orange" && asked.some((o) => o && o.rank === false), "U: THE ROOM LIST'S HEADER — your picture, the module's ring, asked without My Rank", { cls: rp && rp.className, asked });
});

// ═══ N — THE CHAT NOTE ═══════════════════════════════════════════════════════════════════════════════════════════════════════
part("N", async () => {
  const listeners = [];
  let chat = null;
  const MS = { state: () => ({ lines: [], ring: "green", chat }), onChange: (fn) => listeners.push(fn), waitingSecs: () => 0 };
  const w = CW.world({ realResolver: true, extras: { MatrixStatus: MS } });
  await w.CP.startChat(w.box);
  const n = w.refs.chatNote;
  const shown = () => (n.classList.contains("show") ? n.textContent : "");
  ok(listeners.length >= 1, "N APPLIED — the chat listens to the status piece", listeners.length);
  chat = { held: 1, secs: 5 };
  for (const fn of listeners) fn();
  ok(shown() === "Matrix is slowing your messages and actions — yours sends in 5 s." && n.classList.contains("slow"),
    "N: THE STRIP'S OWN NOTE, ORANGE — \"Matrix is slowing your messages and actions — yours sends in 5 s.\"", { text: shown(), cls: n.className });
  chat = null;
  for (const fn of listeners) fn();
  ok(shown() === "" && !n.classList.contains("slow"), "N: GONE WHEN SENT — nothing held, no note, no orange", { text: shown(), cls: n.className });
  const css = rd("index.html");
  ok(/\.chat-note\.slow \{ color: #E8890C;/.test(css), "N: the sheet colours this note only orange (`.chat-note.slow`)", null);
});

// ═══ W — A WAIT SAID WHERE IT HAPPENS ════════════════════════════════════════════════════════════════════════════════════════
part("W", async () => {
  const MS = { state: () => ({ lines: [], ring: "green", chat: null }), onChange() {}, waitingSecs: (k) => (k === "membership" ? 12 : 0) };
  const features = {
    Room: { rankLadder: () => [], getMyId: () => ME, scanDDJPRooms: () => ({ owned: [], joined: [{ spaceId: "!j:hs", name: "Jazz" }], invited: [], unconfirmed: [] }),
      needsAttention: () => [], joinJobs: () => [], pendingCreate: () => null, leftovers: () => null, leaveNotice: () => null, otherRooms: () => ({ count: 0, rooms: [] }),
      leaveJob: (id) => (id === "!j:hs" ? { spaceId: "!j:hs", name: "Jazz", state: "running", done: 2, total: 6, left: 2, failed: [] } : null),
      repairJob: () => null, repairRunning: () => null, onRoomsChanged() {} },
    Media: { getAvatarUrl: () => null },
  };
  const w = SW.world({ features, domShaped: true, globals: { MatrixStatus: MS } });
  const H = w.H;
  const el = H.slowWait ? H.slowWait("membership") : null;
  ok(!!el && el.textContent === "Waiting 12 s — Matrix asked us to slow down." && /slow-wait/.test(el.className), "W: THE WORDS — \"Waiting 12 s — Matrix asked us to slow down.\"", el && el.textContent);
  ok(H.slowWait && H.slowWait("build") === null, "W: and nothing where nothing waits", null);
  const add = (tag, id) => { const n = w.doc.createElement(tag); n.id = id; w.doc.body.appendChild(n); return n; };
  add("input", "input-join-code"); add("button", "btn-join-room"); add("span", "rooms-lock");
  const list = add("div", "room-list");
  w.sb.Screens.showScreen("screen-rooms");
  w.sb.Screens.renderRoomList(features.Room.scanDDJPRooms());
  const flat = (k) => [k].concat(...Array.from((k && k.children) || []).map(flat));
  const waits = list ? flat(list).filter((n) => /(^|\s)slow-wait(\s|$)/.test(n.className || "")).map((n) => n.textContent) : [];
  ok(waits.length === 1 && /^Waiting 12 s/.test(waits[0]), "W: A LEAVE'S LINE SAYS IT — under its bar, while its join or leave waits", waits);
  const css = rd("index.html");
  ok(/\n\s*\.slow-wait, #create-progress-step\.slow-wait \{ color: #E8890C; \}/.test(css), "W: in the same orange — making a room's step too", null);
});


// ═══ A — A PACED SEND THAT NEVER ANSWERS (`ddjp_698`, JOB 1) ═════════════════════════════════════════════════════════════════
part("A", async () => {
  const hs = W.homeserver();
  const HANG = "@hang:hs";
  let hang = null;
  const invites = [];
  const client = { invite: async (roomId, userId) => { invites.push(userId); if (userId === HANG) return new Promise((r) => { hang = r; }); return {}; } };
  const w = W.inviteWorld({ hs, client });
  if (typeof w.MB._setAnswerClockForTest !== "function") { ok(false, "A APPLIED — a paced send's minute has a seam (`_setAnswerClockForTest`)"); return; }
  const minutes = [];
  w.MB._setAnswerClockForTest((fn, ms) => { const h = { fn, ms, live: true }; minutes.push(h); return h; }, (h) => { if (h) h.live = false; });
  const fire = () => { const h = minutes.find((m) => m.live); if (h) { h.live = false; h.fn(); } return !!h; };
  // THE CHAIN: an invite that never answers, and one behind it.
  const l0 = w.logs.length;
  const first = w.MB.inviteToSpace("!s:hs", {}, HANG).then(() => "answered", (e) => e);
  const second = w.MB.inviteToSpace("!s:hs", {}, "@b:hs").then(() => "answered", (e) => "threw " + (e && e.message));
  await turns(10);
  ok(invites.join(",") === HANG && minutes.filter((m) => m.live).length === 1 && minutes[0].ms === 60000,
    "A PREMISE — the first invite is in flight with its one-minute limit, and the second waits behind it", { invites, minutes: minutes.map((m) => [m.ms, m.live]) });
  fire();
  // Bounded by event-loop turns, never real time: a chain that waits on a send with no answer is a reading, not a hang.
  const bounded = (p) => Promise.race([p, (async () => { for (let i = 0; i < 600; i++) await turns(1); return { hung: true }; })()]);
  const e1 = await bounded(first);
  const s2 = await bounded(second);
  ok(e1 && e1.message === "No answer from Matrix" && e1.errcode === "DDJP_NO_ANSWER", "A: AT ITS MINUTE A PACED SEND FAILS AS \"No answer from Matrix\"", e1 && { message: e1.message, errcode: e1.errcode });
  ok(s2 === "answered" && invites.join(",") === HANG + ",@b:hs", "A: AND THE CHAIN MOVES ON — the send behind it goes", { s2, invites });
  ok(w.lines(/MatrixBridge: no answer from Matrix within a minute to a paced send \(ranks\) — what waited behind it goes on/, l0).length === 1, "A: and it is logged", w.lines(/no answer/, l0));
  if (hang) hang({});
  await turns(10);
  ok(invites.filter((u) => u === HANG).length === 1 && w.lines(/a paced send \(ranks\) answered after its minute — read back like any other state/, l0).length === 1,
    "A: A LATE ANSWER IS ONLY READ BACK — never sent again", { invites, lines: w.lines(/after its minute/, l0) });
  // THE DOOR: three rooms left one at a time; the first never answers, the second this client already shows left, the third answers.
  const X = "!x:hs", Y = "!y:hs", Z = "!z:hs";
  for (const id of [X, Y, Z]) hs.room(id, { name: "room " + id.slice(1, 2), content: { room_version: "11" }, members: { [ME]: "join", "@friend:hs": "join" } });
  const leaves = [];
  const leave0 = w.client.leave;
  w.client.leave = (id) => { leaves.push(id); if (id === X || id === Y) { if (id === Y) hs.rooms[Y].members[ME] = "leave"; return new Promise(() => {}); } return leave0(id); };
  const l1 = w.logs.length;
  const out = w.MB.leaveRooms([X, Y, Z]);
  for (let i = 0; i < 40 && !fire(); i++) await turns(3);
  for (let i = 0; i < 40 && !fire(); i++) await turns(3);
  // Bounded by event-loop turns, never real time: a door that waits on a leave with no answer is a reading, not a hang.
  const r = Object.assign({ failed: [] }, await bounded(out));
  const fx = (r.failed || []).find((f) => f.id === X);
  ok(fx && fx.why === "No answer from Matrix" && leaves.join(",") === [X, Y, Z].join(","), "A: AT THE DOOR — the leave that never answers is named \"No answer from Matrix\" in the leave's failures, and the rooms after it are left",
    { failed: r.failed, leaves });
  ok(!(r.failed || []).some((f) => f.id === Y) && r.left === 2, "A: ONE THIS CLIENT ALREADY SHOWS LEFT IS READ BACK AS LEFT — its answer late, nothing sent again", { left: r.left, failed: r.failed });
  ok(w.lines(/MatrixBridge: no answer from Matrix within a minute to the leave of /, l1).length === 2 && w.lines(/room y \(left\)|its answer came late; read back/, l1).length >= 1,
    "A: and the leave's line says each", w.lines(/no answer|read back|leaving/, l1));
  ok(leaves.filter((id) => id === X).length === 1, "A: and the room with no answer is not sent its leave again — Leave again reads it back first", leaves);
});


// ═══ V — THE WAITS CHROMIUM ALONE SAW AT 697 (`ddjp_698`, JOB 4) ═════════════════════════════════════════════════════════════
part("V", async () => {
  const FRIEND = "@friend:hs";
  const MS = { state: () => ({ lines: [], ring: "green", chat: null }), onChange() {}, waitingSecs: (k) => (k === "ranks" ? 9 : 0) };
  let job = { userId: FRIEND, name: "friend", state: "running", level: 50, done: 3, total: 18, failed: [], repair: false };
  let perform = async () => ({ ok: true });
  const features = {
    Room: { rankLadder: () => [{ level: 0, name: "uncategorized" }, { level: 50, name: "staff" }, { level: 100, name: "owner" }], getMyId: () => ME,
      getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [{ userId: ME, level: 100, name: "me" }, { userId: FRIEND, level: 50, name: "friend" }],
      getMyRank: () => 100, getMyAuthorityLevel: () => 100, rankStanding: () => ({ ring: false, outOfStep: false }), rankJob: () => (job ? Object.assign({}, job) : null),
      upgradeBotStep: () => null, onRankJob() {}, onRankChange() {}, onMembersChange() {}, peopleOrder: () => [], isRankUnlocked: () => true },
    Actions: { ACTIONS: [], describe: () => ({ enabled: true, reason: null }), perform: (...a) => perform(...a) },
    RoomUpgrade: { isRunning: () => false, status: () => ({ currentBatch: 1, maxBatch: 3, canUpgradeNow: true, inProgress: false }) },
    Media: { getAvatarUrl: () => null },
  };
  const w = SW.world({ features, domShaped: true, clock: 1.95e12, globals: { MatrixStatus: MS } });
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Status room" }); } catch (e) {}
  const flat = (k) => [k].concat(...Array.from((k && k.children) || []).map(flat));
  const byClass = (root, cls) => flat(root).filter((n) => new RegExp("(^|\\s)" + cls + "(\\s|$)").test(n.className || ""));
  // THE CARD'S RANK LINE: a change for "friend" running, Matrix asking "User Rank & Invites" to wait 9 s.
  try { w.sb.Roster.openUserCard({ userId: FRIEND, name: "friend", level: 50 }); } catch (e) { ok(false, "V: the card opened — " + (e && e.message)); }
  const note = byClass(w.doc.body, "uc-rank-note")[0];
  const wait = note ? byClass(note, "slow-wait")[0] : null;
  ok(!!note && !!wait && wait.textContent === "Waiting 9 s — Matrix asked us to slow down." && /(^|\s)uc-rank-waits(\s|$)/.test(note.className),
    "V: THE CARD'S RANK LINE SAYS ITS WAIT — \"Waiting 9 s — Matrix asked us to slow down.\", on its own line under the change's progress", { note: note && note.textContent, cls: note && note.className });
  const css = rd("index.html");
  ok(/\n\s*\.uc-rank-note\.uc-rank-waits \{ flex-wrap: wrap; \}/.test(css) && /\n\s*\.uc-rank-note \.slow-wait \{ flex-basis: 100%;/.test(css), "V: and the sheet gives it its own line", null);
  job = null;
  // THE UPGRADE BAR: its own retry's countdown, in the slow-down's words and orange; gone when the progress moves on.
  let tell = null;
  perform = (verb, a) => { tell = a && a.onProgress; return new Promise(() => {}); };
  w.sb.Roster.renderUpgradePanel();
  const btn = byClass(w.refs.upgradeSlot, "upgrade-btn")[0];
  ok(!!btn, "V PREMISE — the upgrade button is shown", w.refs.upgradeSlot && w.refs.upgradeSlot.textContent);
  if (btn) btn.onclick();
  await w.settle();
  if (tell) tell(null, 6, "Rate limited — retrying in ", w.clock.now + 14000);
  const lbl = byClass(w.refs.upgradeSlot, "upgrade-bar-label")[0];
  ok(!!lbl && lbl.textContent === "Waiting 14 s — Matrix asked us to slow down." && /(^|\s)slow-wait(\s|$)/.test(lbl.className),
    "V: THE UPGRADE BAR'S WAIT — \"Waiting 14 s — Matrix asked us to slow down.\", orange", lbl && { text: lbl.textContent, cls: lbl.className });
  await w.advance(5000);
  ok(lbl && lbl.textContent === "Waiting 9 s — Matrix asked us to slow down.", "V: counting down", lbl && lbl.textContent);
  if (tell) tell(1, 6, "Made chat-staff");
  ok(lbl && lbl.textContent === "Made chat-staff (1/6)" && !/(^|\s)slow-wait(\s|$)/.test(lbl.className), "V: and gone, its orange too, when the progress moves on", lbl && { text: lbl.textContent, cls: lbl.className });
  // MAKING A ROOM: the same shared countdown (driven), called by app.js's create step (read).
  const step = w.doc.createElement("div"); w.doc.body.appendChild(step);
  w.H.slowCountdown("create-ratelimit", step, w.clock.now + 14000);
  ok(step.textContent === "Waiting 14 s — Matrix asked us to slow down." && /(^|\s)slow-wait(\s|$)/.test(step.className), "V: MAKING A ROOM'S STEP — the same words and orange", { text: step.textContent, cls: step.className });
  await w.advance(14000);
  ok(step.textContent === "Trying again…", "V: and \"Trying again…\" when its wait is over", step.textContent);
  const app = rd("app.js");
  ok(/Interface\.slowCountdown\("create-ratelimit", step, waitUntil\)/.test(app) && (app.match(/step\.classList\.remove\("slow-wait"\)/g) || []).length >= 3,
    "V: app.js's create step calls it on Matrix's wait, and takes the orange off when the progress moves, on another step and at the end", null);
  ok(/\n\s*\.slow-wait, #create-progress-step\.slow-wait \{ color: #E8890C; \}/.test(css), "V: the step's own rule does not out-colour it", null);
});

// ═══ F — YOUR PICTURE'S MENU STAYS WITH IT (`ddjp_698`, JOB 6) ═══════════════════════════════════════════════════════════════
part("F", async () => {
  const MS = { state: () => ({ lines: [{ key: "connection", label: "Matrix", state: "Online", tone: "ok", text: "Online" }], ring: "green", chat: null }), onChange() {}, waitingSecs: () => 0 };
  const features = {
    Room: { rankLadder: () => [], getMyId: () => ME, getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [], getMyRank: () => 0,
      getMyAuthorityLevel: () => 0, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
    Media: { getAvatarUrl: () => null },
  };
  const w = SW.world({ features, domShaped: true, globals: { MatrixStatus: MS } });
  w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
  try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Status room" }); } catch (e) {}
  w.sb.Roster.renderMyRank();
  const win = w.sb.window, L = {};
  win.addEventListener = (t, f) => { (L[t] = L[t] || []).push(f); };
  win.removeEventListener = (t, f) => { L[t] = (L[t] || []).filter((g) => g !== f); };
  const resize = (vw) => { win.innerWidth = vw; for (const f of (L.resize || []).slice()) f(); };
  const slot = w.refs.myAvatarSlot;
  let at = { left: 1086, right: 1118, top: 10, bottom: 42 };
  slot.getBoundingClientRect = () => Object.assign({ width: at.right - at.left, height: at.bottom - at.top, x: at.left, y: at.top }, at);
  win.innerWidth = 1300;
  slot.onclick();
  const menu = Array.from(w.doc.body.children || []).find((n) => /(^|\s)st-menu(\s|$)/.test(n.className || ""));
  if (!menu) { ok(false, "F APPLIED — your picture's menu opened"); return; }
  menu.getBoundingClientRect = () => ({ width: 280, height: 229, left: 0, top: 0, right: 280, bottom: 229, x: 0, y: 0 });
  const px = (v) => parseFloat(v);
  const read = () => ({ left: px(menu.style.left), top: px(menu.style.top), right: px(menu.style.left) + 280, vw: win.innerWidth, btn: [at.left, at.right] });
  resize(1300);
  let r = read();
  ok(r.right === 1118 && r.top === 48, "F: UNDER YOUR PICTURE, ITS RIGHT EDGE WITH THE PICTURE'S, 6 PX BELOW", r);
  at = { left: 686, right: 718, top: 10, bottom: 42 }; resize(900);
  r = read();
  ok(r.right === 718 && r.left === 438, "F: THE WINDOW NARROWS (1300 → 900) — THE MENU FOLLOWS ITS PICTURE (it stayed at x 838 at 697)", r);
  at = { left: 626, right: 658, top: 10, bottom: 42 }; w.frame();
  r = read();
  ok(r.right === 658, "F: THE HEADER'S CONTENT MOVES THE PICTURE, THE WINDOW UNCHANGED — ON THE NEXT FRAME THE MENU IS UNDER IT AGAIN", r);
  at = { left: 20, right: 52, top: 59, bottom: 91 }; resize(390);
  r = read();
  ok(r.left === 8 && r.top === 97, "F: KEPT 8 PX INSIDE THE WINDOW'S LEFT EDGE (a phone's room list puts your picture at the left)", r);
  at = { left: 360, right: 392, top: 10, bottom: 42 }; resize(390);
  r = read();
  ok(r.right === 390 - 8, "F: AND 8 PX INSIDE ITS RIGHT EDGE", r);
  slot.onclick();   // closes it
  ok((L.resize || []).length === 0, "F: CLOSED, IT IS LET GO — no listener left on the window", (L.resize || []).length);
});

(async () => {
  for (const [name, fn] of PARTS) {
    try { await fn(); } catch (e) { ok(false, name + ": threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  _finished = true;
  if (failed) { console.log("[matrix-status] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[matrix-status] PASS — Matrix slow-downs you can see (the owner's plan, part 3, " + asserts + " assertions): ONE TABLE of six kinds, its " +
    "labels nowhere else; EVERY SEND SITE in the transport names its kind, the room's structure goes out PACED (rank changes, invites, joins, " +
    "leaves, kicks, bans, making a room) and every room event and chat NOT — kept while Matrix asks us to wait, sent again, in order, nothing " +
    "dropped; THE ORANGE RULE — Waiting while retry_after runs, Slowed until a minute after the wait's end, then OK, one timer only while " +
    "orange; THE CONNECTION from the SDK's own sync state, RECONNECTING never flipping it, Offline orange; THE RING'S FOUR STATES, red only for " +
    "My Rank out of spec, drawn by the sheet; and THE UI READING ONLY THE MODULE — your picture's ring and menu, the chat's orange note, a wait " +
    "said where it happens. `ddjp_698`: A PACED SEND WITH NO ANSWER IN A MINUTE fails as \"No answer from Matrix\", logged, and what waited " +
    "behind it goes on — at the door too, a join or leave this client already shows done read back as done, nothing sent again; THE WAITS " +
    "CHROMIUM ALONE SAW driven — the card's rank line, the upgrade and create countdowns; YOUR PICTURE'S MENU stays with it as the window narrows " +
    "and as the header's content moves it, 8 px inside, let go when closed");
  process.exit(0);
})();
