#!/usr/bin/env node
// tests/check-history-summary.js
// SUBJECT: core/historysummary.js, index.html
//
// WALL: THE SONG HISTORY CHANNEL'S SUMMARY FORMAT IS ONE PURE PIECE, AND EVERY RULE IN IT IS DRIVEN (737; the owner's design in
// `consensus/history-rules.md` §12). The bot (738) writes with it and every device reads with it, so a rule wrong here is wrong on
// both sides at once. Held the way `check-rep-boundary` A holds REP's rules: no app global, no clock, no timer, loaded in an EMPTY
// sandbox.
//   A  PURE: names no app global, clock, timer or storage; loads in a sandbox holding nothing but the language; the page loads it.
//   B  THE ROUND TRIP: History-shaped rows (every field: song, DJ, start, end, votes, saves, how and why it ended; a relay member
//      id; a row with no DJ, no song, unknown ending) encode and read back to the same rows, in the room's order, whatever order they
//      were handed in; the DJ table holds each DJ once; trailing defaults are left off and come back; the transport's stamps are
//      taken off (`unstamp`) before reading.
//   C  EVERY REFUSAL, each by its own name, each one step from the body that reads: not an object, no reserved-field list, an
//      unknown version, a reserved field, no serial, a bad stretch, a bad count, a bad DJ table, bad rows, a bad row (each field),
//      a row outside the stretch, a play twice, rows out of order, more rows than songs.
//   D  THE BUDGET: REP's number (`RepRules.LIMITS.budgetBytes`) — compared, never a second copy taken on trust; `sentBytes` against an
//      independent count; a 15-song summary well under it; `fit` keeps the oldest rows that fit, cuts the stretch just below the first
//      left out, never splits one position, hands the rest back, and what it sends reads.
//   E  TRUST AND THE NEWEST: believed only top-level, on the song history channel, from a sender at 99 or above; the higher serial,
//      then the later position.
// RED FIRST on `ddjp_736`: the file does not exist.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const FILE = "core/historysummary.js";

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-summary] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 600) : "")); }
  return !!c;
}
const exists = fs.existsSync(path.join(ROOT, FILE));
ok(exists, "PREMISE — the format piece exists (" + FILE + ")");
const src = exists ? fs.readFileSync(path.join(ROOT, FILE), "utf8") : "";
// Code only: comments removed, strings kept (as `check-rep-boundary` reads REP's rules).
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => {
  let out = "", q = null;
  for (let i = 0; i < l.length; i++) { const c = l[i];
    if (q) { out += c; if (c === "\\") { out += l[i + 1] || ""; i++; } else if (c === q) q = null; continue; }
    if (c === "/" && l[i + 1] === "/") break;
    if (c === "\"" || c === "'" || c === "`") q = c; out += c; }
  return out;
}).join("\n");
let H = null;
try { const ctx = vm.createContext({}); vm.runInContext(src + "\n;this.H = HistorySummary;", ctx); H = ctx.H || null; } catch (e) { H = null; }

// ── A — PURE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const GLOBALS = ["StreamManager", "MatrixBridge", "MatrixAccount", "Capabilities", "Room", "Chat", "ServerClock", "Store", "BotRuntime", "Logger",
    "Backends", "StateDeriver", "Ranks", "History", "Floor", "Vouch", "Checkpoint", "EventCache", "Session", "Scheduler", "RepRules", "RepPorts",
    "Queue", "Songs", "Countries", "localStorage", "sessionStorage", "indexedDB", "navigator", "window", "document",
    "Date", "setTimeout", "setInterval", "fetch", "crypto", "TextEncoder"];
  const word = (g) => new RegExp("(^|[^A-Za-z0-9_$.])" + g + "(?![A-Za-z0-9_$])");
  const named = GLOBALS.filter((g) => word(g).test(code));
  ok(exists && named.length === 0, "A: `" + FILE + "` names no app global, no clock, no timer, no storage — every input is an argument", named);
  ok(!!H, "A: and it loads in a sandbox holding nothing but the language");
  ok(word("Logger").test("x; Logger.info(1)") && !word("Logger").test("x; MyLogger.info(1)"), "A: APPLIED — the name matcher sees a global and not a longer name");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const at = html.indexOf("core/historysummary.js?v="), be = html.indexOf("core/backends.js?v=");
  ok(at > 0 && be > at, "A: the page loads it with the other core files, before the backends that read it", { at, be });
}
if (!H) { console.log("[history-summary] " + (failed || 1) + " failure(s) of " + asserts + " assertions — the piece did not load"); process.exit(1); }

const RES = ["t", "l", "dv", "hv", "p", "pHash", "w", "og", "actor", "rank", "src", "at", "also", "evs"];   // shape only; D takes the real list
const T = 1792447900000;
const rows = [
  { pi: "$p2", l: 14, songKey: "yt:bbbbbbbbbbb", dj: "@ann:hs", at: T + 300000, endedAt: T + 540000, counts: { votes: 3, saves: 1 }, cutShortBy: "dj", endedBy: "repeat" },
  { pi: "$p1", l: 10, songKey: "yt:aaaaaaaaaaa", dj: "@jonas:hs", at: T, endedAt: T + 300000, counts: { votes: 0, saves: 0 }, cutShortBy: false },
  { pi: "$carrier#2", l: 20, songKey: "sc:artist/track", dj: "@ann:hs", at: T + 600000, counts: { votes: 1, saves: 0 }, cutShortBy: "media", endedBy: "region" },
  { pi: "$p4", l: 25, songKey: null, dj: null, at: null, counts: { votes: 0, saves: 0 } },
];
const ordered = rows.slice().sort((a, b) => (a.l - b.l) || (String(a.pi) < String(b.pi) ? -1 : 1));
const body = H.summary({ n: 7, from: 9, to: 30, count: 40, rows: rows });

// ── B — THE ROUND TRIP ──────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok(body.v === H.VERSION && body.n === 7 && body.from === 9 && body.to === 30 && body.count === 40, "B: the summary carries its version, serial, stretch and count", body);
  ok(JSON.stringify(body.djs) === JSON.stringify(["@jonas:hs", "@ann:hs"]), "B: THE DJ TABLE — each DJ once, in the rows' order", body.djs);
  ok(body.rows[0].length === 9 && body.rows[3].length === 5, "B: trailing defaults are left off (an unknown `why` dropped; a row of defaults is five long)", body.rows);
  const sent = Object.assign({ t: H.TYPE, l: 999, dv: 2, hv: 1 }, body);
  ok(H.read(sent, RES).ok === false && H.read(sent, RES).why === "a reserved field", "B: AS IT ARRIVED (the transport's stamps on it) it is refused…", H.read(sent, RES));
  const r = H.read(H.unstamp(sent), RES);
  ok(r.ok, "B: …and with them taken off (`unstamp`) it reads", r);
  const want = ordered.map((x) => { const o = { pi: x.pi, l: x.l, songKey: x.songKey, dj: x.dj, at: x.at, counts: x.counts };
    if (x.endedAt !== undefined) o.endedAt = x.endedAt; if (x.cutShortBy !== undefined) o.cutShortBy = x.cutShortBy; if (x.endedBy !== undefined) o.endedBy = x.endedBy; return o; });
  const norm = (a) => JSON.stringify(a.map((x) => Object.keys(x).sort().reduce((o, k) => { o[k] = x[k]; return o; }, {})));
  ok(r.ok && norm(r.value.rows) === norm(want), "B: THE ROWS COME BACK AS HANDED, in History's row shape and the room's order — song, DJ, start, end, votes, saves, " +
    "how and why it ended; a relay member's id; no DJ, no song, an unknown ending", { got: r.value && r.value.rows, want });
  ok(r.ok && r.value.n === 7 && r.value.from === 9 && r.value.to === 30 && r.value.count === 40, "B: and the serial, stretch and count", r.value);
  const again = H.summary({ n: 7, from: 9, to: 30, count: 40, rows: r.value.rows });
  ok(JSON.stringify(again) === JSON.stringify(body), "B: what reads, encoded again, is byte for byte what was sent");
}

// ── C — EVERY REFUSAL ───────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const base = () => JSON.parse(JSON.stringify(body));
  ok(H.read(base(), RES).ok, "C CONTROL — the body every case below is one step from reads");
  const cases = [
    ["not an object", () => null], ["not an object", () => [1, 2]],
    ["unknown version", (b) => Object.assign(b, { v: 2 })], ["unknown version", (b) => { delete b.v; return b; }],
    ["a reserved field", (b) => Object.assign(b, { actor: "@x:hs" })],
    ["no serial", (b) => Object.assign(b, { n: 1.5 })], ["no serial", (b) => Object.assign(b, { n: -1 })],
    ["bad stretch", (b) => Object.assign(b, { from: 31 })], ["bad stretch", (b) => Object.assign(b, { to: "30" })],
    ["bad count", (b) => Object.assign(b, { count: 5001 })], ["bad count", (b) => Object.assign(b, { count: null })],
    ["bad DJ table", (b) => Object.assign(b, { djs: ["@jonas:hs", "@jonas:hs"] })], ["bad DJ table", (b) => Object.assign(b, { djs: ["jonas"] })],
    ["bad rows", (b) => Object.assign(b, { rows: {} })],
    ["a bad row", (b) => { b.rows[0] = b.rows[0].slice(0, 4); return b; }],
    ["a bad row", (b) => { b.rows[0][0] = ""; return b; }],
    ["a bad row", (b) => { b.rows[0][1] = 10.5; return b; }],
    ["a bad row", (b) => { b.rows[0][2] = 7; return b; }],
    ["a bad row", (b) => { b.rows[0][3] = 9; return b; }],
    ["a bad row", (b) => { b.rows[0][4] = -5; return b; }],
    ["a bad row", (b) => { b.rows[0][5] = "soon"; return b; }],
    ["a bad row", (b) => { b.rows[0][6] = -1; return b; }],
    ["a bad row", (b) => { b.rows[0][8] = 3; return b; }],
    ["a bad row", (b) => { b.rows[1][9] = "Not A Token"; return b; }],
    ["a row outside the stretch", (b) => Object.assign(b, { from: 11 })],
    ["a play twice", (b) => { b.rows[1][0] = b.rows[0][0]; return b; }],
    ["rows out of order", (b) => { const t = b.rows[0]; b.rows[0] = b.rows[1]; b.rows[1] = t; return b; }],
    ["more rows than songs", (b) => Object.assign(b, { count: 3 })],
  ];
  for (const [why, f] of cases) {
    const v = H.read(f(base()), RES);
    ok(v.ok === false && v.why === why, "C: REFUSED BY NAME — \"" + why + "\"", v);
  }
  const noList = H.read(base(), null);
  ok(noList.ok === false && noList.why === "no reserved-field list", "C: handed no reserved-field list, it reads nothing (never unchecked)", noList);
  const four = H.read(Object.assign(base(), { count: 4 }), RES);
  ok(four.ok === true, "C CONTROL — as many rows as songs reads (the bound is \"more\", not \"as many\")", four);
}

// ── D — THE BUDGET ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  let rep = null;
  try { const ctx = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(ROOT, "features/rep-rules.js"), "utf8") + "\n;this.R = RepRules;", ctx); rep = ctx.R; } catch (e) { rep = null; }
  ok(rep && H.LIMITS.budgetBytes === rep.LIMITS.budgetBytes, "D: THE BUDGET IS REP'S NUMBER — `HistorySummary.LIMITS.budgetBytes` equals `RepRules.LIMITS.budgetBytes` (core/ may not reach features/: compared here)",
    [H.LIMITS.budgetBytes, rep && rep.LIMITS.budgetBytes]);
  const LIST = require(path.join(__dirname, "_load.js")).transportSideReserved();
  ok(Array.isArray(LIST) && H.STAMPED.every((k) => LIST.indexOf(k) >= 0) && H.read(H.unstamp(Object.assign({ t: H.TYPE, l: 1, dv: 2, hv: 1 }, body)), LIST).ok,
    "D: READ AGAINST THE REAL TRANSPORT'S LIST (`MatrixBridge.sideReserved`): its four stamps are in it, and a summary as sent reads once they are off", LIST);
  const independent = Buffer.byteLength(JSON.stringify({ msgtype: "m.text", body: JSON.stringify(Object.assign({}, body, { t: H.TYPE, l: Number.MAX_SAFE_INTEGER, dv: 2, hv: 99 })) }), "utf8");
  ok(H.sentBytes(H.TYPE, body) === independent, "D: `sentBytes` IS THE CONTENT AS SENT — equal to an independent count", [H.sentBytes(H.TYPE, body), independent]);
  const many = [];
  for (let i = 0; i < 900; i++) many.push({ pi: "$" + "e".repeat(40) + String(i).padStart(4, "0"), l: 100 + i * 2, songKey: "yt:" + "c".repeat(11), dj: "@dj" + (i % 9) + ":matrix.org",
    at: T + i * 240000, endedAt: T + (i + 1) * 240000, counts: { votes: i % 7, saves: i % 3 }, cutShortBy: false });
  const s15 = H.summary({ n: 1, from: 100, to: 129, count: 15, rows: many.slice(0, 15) });
  ok(H.sentBytes(H.TYPE, s15) < 4000 && H.sentBytes(H.TYPE, s15) * 10 < H.LIMITS.budgetBytes, "D: a 15-song summary is well under the budget", H.sentBytes(H.TYPE, s15));
  const whole = H.fit({ n: 2, from: 100, to: 129, count: 15, rows: many.slice(0, 15) });
  ok(whole.kept === 15 && whole.rest.length === 0 && whole.next === null && whole.body.to === 129, "D: `fit` sends what fits whole, the stretch as handed", whole.kept);
  const f = H.fit({ n: 3, from: 100, to: 2000, count: 900, rows: many });
  const K = f.kept;
  ok(f.body && H.sentBytes(H.TYPE, f.body) <= H.LIMITS.budgetBytes && K > 300 && K < 900, "D: `fit` KEEPS THE OLDEST ROWS THAT FIT under the budget", { kept: K, bytes: f.body && H.sentBytes(H.TYPE, f.body) });
  ok(f.body && H.sentBytes(H.TYPE, H.summary({ n: 3, from: 100, to: many[K + 1].l - 1, count: K + 1, rows: many.slice(0, K + 1) })) > H.LIMITS.budgetBytes,
    "D: …and the largest that fits — one row more is over the budget");
  ok(f.body && f.body.to === f.rest[0].l - 1 && f.next === f.rest[0].l && K + f.rest.length === 900, "D: the stretch is cut just below the first row left out, and the rest handed back from there",
    { to: f.body && f.body.to, next: f.next, rest0: f.rest[0] && f.rest[0].l });
  ok(f.body && f.body.count === 900 - f.rest.length, "D: the room's count up to the cut (the count less the rows left out)", f.body && f.body.count);
  const back = f.body ? H.read(f.body, RES) : null;
  ok(back && back.ok && back.value.rows.length === K, "D: and what `fit` sends reads", back && back.why);
  // NEVER ONE POSITION SPLIT: the row the cut falls before is moved onto the position of the last row kept.
  const shared = many.map((r) => Object.assign({}, r));
  shared[K].l = shared[K - 1].l;
  const g = H.fit({ n: 4, from: 100, to: 2000, count: 900, rows: shared });
  ok(shared[K].l === shared[K - 1].l && String(shared[K - 1].pi) < String(shared[K].pi), "D PREMISE — two plays at one position, exactly where the cut falls", [shared[K - 1].l, shared[K].l]);
  ok(g.body && g.kept === K - 1 && g.rest[0].l === shared[K - 1].l && g.body.to === shared[K - 1].l - 1,
    "D: `fit` NEVER SPLITS ONE POSITION between two messages — both go to the next, the stretch cut below them", { kept: g.kept, K: K, firstRest: g.rest[0] && g.rest[0].l, to: g.body && g.body.to });
  const one = H.fit({ n: 5, from: 1, to: 2, count: 1, rows: [{ pi: "$" + "x".repeat(250), l: 1, songKey: "yt:" + "k".repeat(190), dj: "@" + "d".repeat(240) + ":hs", at: T, counts: { votes: 0, saves: 0 } }] });
  ok(one.body && one.kept === 1, "D CONTROL — one large row still fits on its own", one.kept);
}

// ── E — TRUST AND THE NEWEST ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok(H.trust({ channel: "history_owner", id: "$e", level: 99 }).ok && H.trust({ channel: "history_owner", id: "$e", level: 100 }).ok,
    "E: BELIEVED from the bot (99) or the owner above it, top-level, on the song history channel");
  const t1 = H.trust({ channel: "history_owner", id: "$e", level: 98 }), t2 = H.trust({ channel: "events_owner", id: "$e", level: 99 }), t3 = H.trust({ channel: "history_owner", id: "$c#1", level: 99 });
  ok(!t1.ok && /below level 99/.test(t1.why) && !t2.ok && /song history channel/.test(t2.why) && !t3.ok && /batch member/.test(t3.why),
    "E: IGNORED — a sender below the owner level, another channel, a relay batch's member", [t1, t2, t3]);
  const a = { n: 5, l: 100 }, b = { n: 6, l: 50 }, c = { n: 6, l: 70 };
  ok(H.newer(a, b) === b && H.newer(b, a) === b && H.newer(b, c) === c && H.newer(null, a) === a, "E: THE NEWEST — the higher serial, then the later position");
}

if (failed) { console.log("[history-summary] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[history-summary] PASS — the song history channel's summary format (737, `consensus/history-rules.md` §12; " + asserts + " assertions): ONE PURE " +
  "PIECE (no app global, no clock, loaded in an empty sandbox; the page loads it before the backends); THE ROUND TRIP — every field " +
  "of a History row back as handed, in the room's order, the DJ table once each, trailing defaults left off, the transport's stamps " +
  "taken off; EVERY REFUSAL by its own name; THE BUDGET REP's number (compared), `sentBytes` exact, `fit` the oldest rows that fit " +
  "with the stretch cut below the first left out and never one position split; TRUST top-level on the song history channel from 99 " +
  "up; the newest by serial, then position.");
