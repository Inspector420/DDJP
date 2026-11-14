#!/usr/bin/env node
// tests/check-room-facts.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend1/matrixaccount.js, features/room.js
//
// WALL: ROOM FACTS THROUGH ONE DOOR (`ddjp_701`; the owner's "can you look at if work is needed to easely support adding it
// later? im guessing we could at least remove hte friction now", about sliding sync, parked; `main/05-matrix.md` §Asking Matrix
// less). NO BEHAVIOUR CHANGE: the app reads the same facts and answers the same; only where it reads them from moved.
//   PART F — FEATURES AND UI NEVER REACH THE SDK: no file outside the transport (app.js, core/, features/, ui/) calls
//            `getClient()` or reads an SDK room object — `getRoom`, `getRooms`, `currentState`, `getStateEvents`, a timeline,
//            a room's own membership, counts or last activity. The sweep's controls: a planted read is found, a commented one is
//            not, and the one `timeline` that is not a room's (the song preview's bar, `ui/playlists.js`) is named, not ignored.
//   PART R — THE NAMED READS, AND THE ROOM LIST THROUGH THEM, in the invite world (the real transport and room code, a
//            homeserver model): each read answers what the SDK holds for the room — its name, creation record and mark, its
//            channels, this account's membership and level, a person's level, its counts, its last activity, one state event —
//            and null for a room the client does not hold; `Room.scanDDJPRooms` and `Room.otherRooms` list what a reader of the
//            homeserver itself lists.
//   PART T — THE TABLE (`ROOM_FACTS`): for a room this tab is not in, every state type the transport reads, with what for, each
//            a [type, state key] pair as sliding sync's `required_state` would take it, and the facts that are not state saying
//            where they come from. Every state read in the transport is either the table's one door (`_fact`) or one of the open
//            room's own reads, listed by name (`ROOM_FACTS_OPEN`); a door call names a row of the table; each named read reads only
//            the rows it declares (`ROOM_FACT_READS`); and, driven, a type the table does not list is refused by name, never
//            read. The sweep's control: a planted state read in an unlisted function is found.
//   PART C — THE CONNECTION: one named choice, "classic", and `start()` makes the classic sync exactly as at 700 (the one filter,
//            members on request, the first sync's one event); its comment says where sliding sync would go, and the SDK this app
//            bundles still exports no `SlidingSync` (if an upgrade does, this says so).
// RED FIRST ON 700: F (room.js read the SDK in eleven places, each through `getClient()`), R (no named reads), T (no table), C (no named choice).
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const W = require(path.join(__dirname, "_inviteworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[room-facts] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[room-facts] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const settle = async (n) => { for (let i = 0; i < (n || 8); i++) await new Promise((r) => setImmediate(r)); };

// One line's code: a `//` comment (outside a quote) and any `/* … */` cut away; a block comment carried across lines.
function codeLines(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split("\n")) {
    let s = "", q = null;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i], n = raw[i + 1];
      if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
      if (q) { s += c; if (c === "\\") { s += n || ""; i++; } else if (c === q) q = null; continue; }
      if (c === "/" && n === "/") break;
      if (c === "/" && n === "*") { inBlock = true; i++; continue; }
      if (c === "\"" || c === "'" || c === "`") q = c;
      s += c;
    }
    out.push(s);
  }
  return out;
}
function enclosing(lines, i) {
  for (let j = i; j >= 0; j--) { const m = lines[j].match(/^ {2,4}(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/); if (m) return m[1]; }
  return "(top level)";
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── F — FEATURES AND UI NEVER REACH THE SDK ─────────────────────────────────────────────────────────────────────────────────
const SDK_ROOM_READS = [/\bgetClient\s*\(/, /\.getRoom\s*\(/, /\.getRooms\s*\(/, /\.currentState\b/, /\bgetStateEvents\s*\(/,
  /\.getLiveTimeline\s*\(/, /\.getTimelineSets?\s*\(/, /\.getUnfilteredTimelineSet\s*\(/, /\.getTimelineForEvent\s*\(/, /\.timeline\b/,
  /\.getMyMembership\s*\(/, /\.getJoinedMemberCount\s*\(/, /\.getInvitedMemberCount\s*\(/, /\.getLastActiveTimestamp\s*\(/];
// The one `timeline` outside the transport that is not a room's: the song preview's bar, its own element (J135).
const NOT_A_ROOM = [{ file: "ui/playlists.js", re: /\bpv\.timeline\b/ }];
function appFiles() {
  const out = ["app.js", "sw.js", "sw-register.js"].filter((f) => fs.existsSync(path.join(ROOT, f)));
  for (const d of ["core", "features", "ui"]) {
    if (!fs.existsSync(path.join(ROOT, d))) continue;
    for (const n of fs.readdirSync(path.join(ROOT, d)).sort()) if (/\.js$/.test(n)) out.push(d + "/" + n);
  }
  return out;
}
function sdkReadsIn(files) {
  const hits = [];
  for (const x of files) x.code.forEach((line, i) => {
    if (!SDK_ROOM_READS.some((re) => re.test(line))) return;
    if (NOT_A_ROOM.some((n) => n.file === x.f && n.re.test(line) && !SDK_ROOM_READS.some((re) => re !== SDK_ROOM_READS[9] && re.test(line)))) return;
    hits.push(x.f + ":" + (i + 1) + " " + line.trim().slice(0, 100));
  });
  return hits;
}
function partF() {
  const plant = (f, t) => [{ f, text: t, code: codeLines(t) }];
  ok(sdkReadsIn(plant("features/x.js", "  const r = MatrixBridge.getClient().getRoom(id);\n")).length === 1 &&
     sdkReadsIn(plant("features/x.js", "  // const r = MatrixBridge.getClient().getRoom(id);\n")).length === 0 &&
     sdkReadsIn(plant("ui/x.js", "  const n = room.timeline.length;\n")).length === 1 &&
     sdkReadsIn(plant("ui/playlists.js", "  pv.timeline = H.el(\"div\");\n")).length === 0 &&
     sdkReadsIn(plant("features/x.js", "  for (const r of c.getRooms()) n += r.getJoinedMemberCount();\n")).length === 1,
    "F CONTROL — the sweep finds a planted SDK read, not a commented one, and passes only the preview's own `timeline` element");
  const files = appFiles().map((f) => { const text = read(f); return { f, text, code: codeLines(text) }; });
  ok(files.some((x) => x.f === "features/room.js") && files.some((x) => x.f === "ui/shell.js"), "F PREMISE — the sweep read features/ and ui/", files.length);
  const hits = sdkReadsIn(files);
  ok(hits.length === 0, "F: NO FEATURE OR UI FILE CALLS getClient() OR READS AN SDK ROOM — every room fact through the transport's named reads", hits);
  const room = files.find((x) => x.f === "features/room.js");
  const used = ["roomIds", "roomName", "myMembershipIn", "getCreateContent", "getMyPowerLevel", "joinedCount", "newestStampIn", "hasClient"]
    .filter((n) => new RegExp("MatrixBridge\\." + n + "\\(").test(room.text));
  ok(used.length === 8, "F: AND features/room.js READS THEM THERE — the rooms held, a name, this account's membership, a creation record, a level, a count, the last activity, and whether a client is signed in", used);
}

// ── R — THE NAMED READS, AND THE ROOM LIST THROUGH THEM ─────────────────────────────────────────────────────────────────────
const READS = ["roomIds", "roomName", "getCreateContent", "channelMarkOf", "spaceChildIds", "myMembershipIn", "getMyPowerLevel",
  "userLevelIn", "joinedCount", "invitedCount", "newestStampIn", "roomStateEvent", "hasClient"];
async function partR() {
  const hs = W.homeserver();
  const ME = W.ME, OWNER = "@owner:hs";
  // Mine (I made it: owner), one I joined, one I am invited to, one I left; another app's space with a room in it; a plain
  // room; a room the homeserver has that this account never joined.
  const mine = hs.ddjpRoom("!mine:hs", { creator: ME, mode: "backend2", levels: { [ME]: 100 } });
  hs.rooms["!mine:hs"].members[ME] = "join";
  hs.ddjpRoom("!theirs:hs", { mode: "backend2", levels: { [ME]: 0 } });
  hs.rooms["!theirs:hs"].members[ME] = "join";
  hs.ddjpRoom("!asked:hs", { mode: "backend2" });
  hs.invite("!asked:hs", ME, { from: OWNER });
  hs.ddjpRoom("!gone:hs", { mode: "backend2" });
  hs.rooms["!gone:hs"].members[ME] = "leave";
  hs.room("!club:hs", { name: "club", content: { room_version: "12", type: "m.space" }, members: { [ME]: "join", "@ann:hs": "join", "@bea:hs": "join" }, children: ["!plain:hs"] });
  hs.room("!plain:hs", { name: "plain", members: { [ME]: "join", "@ann:hs": "join" }, joinRule: "public" });
  hs.room("!never:hs", { name: "never", members: { "@ann:hs": "join" } });
  const w = W.inviteWorld({ hs });
  const MB = w.MB;
  const missing = READS.filter((n) => typeof MB[n] !== "function");
  if (!ok(missing.length === 0, "R APPLIED — the transport has every named read", missing)) return;
  const c = w.client;
  const held = c.getRooms().map((r) => r.roomId);
  ok(JSON.stringify(MB.roomIds()) === JSON.stringify(held), "R: THE ROOMS HELD, BY ID, IN THE CLIENT'S ORDER", { got: MB.roomIds(), want: held });
  const rows = [];
  for (const id of held.concat(["!never:hs"])) {
    const r = c.getRoom(id);
    const ev = (t, k) => { try { return r ? r.currentState.getStateEvents(t, k) : null; } catch (e) { return null; } };
    const create = ev("m.room.create", "");
    const want = {
      name: r ? r.name : null,
      create: create ? create.getContent() : null,
      membership: r ? r.getMyMembership() : null,
      joined: r ? Number(r.getJoinedMemberCount()) : null,
      invited: r ? Number(r.getInvitedMemberCount()) : null,
    };
    const got = { name: MB.roomName(id), create: MB.getCreateContent(id), membership: MB.myMembershipIn(id), joined: MB.joinedCount(id), invited: MB.invitedCount(id) };
    rows.push({ id, same: JSON.stringify(got) === JSON.stringify(want), got, want });
  }
  ok(rows.every((x) => x.same), "R: EACH ROOM'S NAME, CREATION RECORD, THIS ACCOUNT'S MEMBERSHIP AND COUNTS — WHAT THE SDK HOLDS; null for a room not held", rows.filter((x) => !x.same));
  ok(JSON.stringify(MB.spaceChildIds("!club:hs")) === JSON.stringify(["!plain:hs"]) && JSON.stringify(MB.spaceChildIds("!mine:hs").sort()) === JSON.stringify(Object.values(mine.ch).sort()) &&
     MB.spaceChildIds("!never:hs").length === 0, "R: A SPACE'S CHANNELS", { club: MB.spaceChildIds("!club:hs"), mine: MB.spaceChildIds("!mine:hs").length });
  const mark = MB.channelMarkOf(Object.values(mine.ch)[0]);
  ok(!!mark && mark.room === "!mine:hs" && !!mark.kind && MB.channelMarkOf("!plain:hs") && MB.channelMarkOf("!plain:hs").room === null && MB.channelMarkOf("!never:hs") === null,
    "R: A CHANNEL'S MARK — its room and kind; none for a plain room; null for a room not held", mark);
  ok(MB.getMyPowerLevel("!mine:hs") === 100 && MB.getMyPowerLevel("!theirs:hs") === 0 && MB.getMyPowerLevel("!never:hs") === null,
    "R: THIS ACCOUNT'S LEVEL — the maker's 100, a member's 0, null for a room not held", [MB.getMyPowerLevel("!mine:hs"), MB.getMyPowerLevel("!theirs:hs")]);
  ok(MB.userLevelIn("!theirs:hs", OWNER) === 100 && MB.userLevelIn("!theirs:hs", ME) === 0 && MB.userLevelIn("!never:hs", OWNER) === null,
    "R: A PERSON'S LEVEL — its maker's 100, this account's 0; null for a room not held", [MB.userLevelIn("!theirs:hs", OWNER), MB.userLevelIn("!theirs:hs", ME)]);
  const sev = MB.roomStateEvent("!plain:hs", "m.room.join_rules", "");
  ok(!!sev && sev.getContent().join_rule === "public" && MB.roomStateEvent("!never:hs", "m.room.create", "") === null,
    "R: ONE STATE EVENT BY TYPE — a row of the table, read; null for a room not held", sev && sev.getContent());
  ok(MB.hasClient() === true && MB.myMembershipIn("!asked:hs") === "invite" && MB.myMembershipIn("!gone:hs") === "leave" && MB.myMembershipIn("!never:hs") === null,
    "R: MEMBERSHIP — invited, left, and null for a room the client does not hold", [MB.myMembershipIn("!asked:hs"), MB.myMembershipIn("!gone:hs")]);
  // The room list and the other rooms, through the reads — against a reader of the homeserver itself.
  const scan = w.Room.scanDDJPRooms();
  const names = (l) => (l || []).map((x) => x.spaceId + "=" + x.name).sort();
  ok(JSON.stringify(names(scan.owned)) === JSON.stringify(["!mine:hs=" + hs.rooms["!mine:hs"].name]) &&
     JSON.stringify(names(scan.joined)) === JSON.stringify(["!theirs:hs=" + hs.rooms["!theirs:hs"].name]) &&
     (scan.invited || []).some((x) => x.spaceId === "!asked:hs"),
    "R: THE ROOM LIST — mine owned, theirs joined, the invitation invited; the room left and another app's space not listed", { owned: names(scan.owned), joined: names(scan.joined), invited: (scan.invited || []).map((x) => x.spaceId) });
  const others = w.Room.otherRooms();
  const o = others && others.rooms ? others.rooms.map((r) => r.roomId + ":" + r.name + ":" + r.people + ":" + r.space + ":" + r.inside).sort() : null;
  ok(JSON.stringify(o) === JSON.stringify(["!club:hs:club:3:true:1", "!plain:hs:plain:2:false:0"]),
    "R: THE OTHER MATRIX ROOMS — the space with its people and the room inside it, the plain room with its two", o);
}

// ── T — THE TABLE ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function extractConst(src, name) {
  const a = src.indexOf("  const " + name + " = ");
  if (a < 0) return null;
  const b = src.indexOf("});\n", a);
  const b2 = src.indexOf("]);\n", a);
  const end = [b, b2].filter((x) => x > a).sort((x, y) => x - y)[0];
  return end ? src.slice(a, end + 4) : null;
}
function functionBodies(lines) {
  const out = Object.create(null);
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.match(/^ {2}(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/);
    if (m) { cur = m[1]; out[cur] = []; }
    if (cur) out[cur].push(l);
    if (cur && /^ {2}\}\s*$/.test(l)) cur = null;
    void i;
  });
  return out;
}
const STATE_TYPES_READ = ["m.room.create", "m.room.power_levels", "m.space.child", "m.room.member", "m.room.name", "m.room.join_rules"];
function rawStateReads(files, door, open) {
  const out = [];
  for (const x of files) x.code.forEach((line, i) => {
    if (!/\bgetStateEvents\s*\(/.test(line)) return;
    const fn = enclosing(x.code, i);
    if (fn === door || open.indexOf(fn) >= 0) return;
    out.push(x.f + ":" + (i + 1) + " [" + fn + "] " + line.trim().slice(0, 90));
  });
  return out;
}
async function partT() {
  const MBF = "backends/backend1/matrixbridge.js";
  const src = read(MBF);
  const tableSrc = extractConst(src, "ROOM_FACTS"), openSrc = extractConst(src, "ROOM_FACTS_OPEN"), readsSrc = extractConst(src, "ROOM_FACT_READS");
  if (!ok(!!tableSrc && !!openSrc && !!readsSrc, "T APPLIED — the transport writes the table (`ROOM_FACTS`), the open room's own reads (`ROOM_FACTS_OPEN`) and each named read's rows (`ROOM_FACT_READS`)")) return;
  let T = null, OPEN = null, RR = null;
  try { T = new Function(tableSrc + "\nreturn ROOM_FACTS;")(); OPEN = new Function(openSrc + "\nreturn ROOM_FACTS_OPEN;")(); RR = new Function(readsSrc + "\nreturn ROOM_FACT_READS;")(); }
  catch (e) { ok(false, "T: the three are data, read alone — " + e.message); return; }
  const rows = Object.keys(T);
  ok(rows.every((k) => typeof T[k].for === "string" && T[k].for.length > 20 && (T[k].type ? typeof T[k].key === "string" : typeof T[k].from === "string")),
    "T: EVERY ROW SAYS WHAT IT IS FOR — a state row its type and key, the others where their answer comes from", rows.filter((k) => !(T[k].for && (T[k].type ? typeof T[k].key === "string" : T[k].from))));
  const types = [...new Set(rows.filter((k) => T[k].type).map((k) => T[k].type))].sort();
  ok(JSON.stringify(types) === JSON.stringify(STATE_TYPES_READ.slice().sort()), "T: THE STATE TYPES READ OF A ROOM NOT OPEN — create, power levels, space children, this account's member (and the members on request), name, join rules", types);
  ok(["joined", "invited", "last"].every((k) => T[k] && !T[k].type && /summary|timeline/.test(T[k].from)), "T: AND THE FACTS THAT ARE NOT STATE — the joined and invited counts (the summary) and the last activity (the timeline and this account's member)", ["joined", "invited", "last"].map((k) => T[k] && T[k].from));
  const required = rows.filter((k) => T[k].type && !T[k].onRequest).map((k) => [T[k].type, T[k].key]);
  ok(required.length === 6 && required.some((p) => p[0] === "m.room.member" && p[1] === "$ME") && required.some((p) => p[0] === "m.space.child" && p[1] === "*") && T.members && T.members.onRequest === true,
    "T: WRITTEN AS SLIDING SYNC'S `required_state` WOULD TAKE IT — [type, state key] pairs (\"$ME\", \"*\"), the members on request kept out", required);
  ok(/required_state/.test(src.slice(src.indexOf("  // ══ ROOM FACTS THROUGH ONE DOOR"), src.indexOf("  const ROOM_FACTS = "))), "T: and its comment says so");
  // The transport's state reads: the door, or one of the open room's own.
  const files = [MBF, "backends/backend1/matrixaccount.js"].map((f) => { const text = read(f); return { f, text, code: codeLines(text) }; });
  const raw = rawStateReads(files, "_fact", OPEN);
  ok(raw.length === 0, "T: EVERY STATE READ IN THE TRANSPORT IS THE TABLE'S DOOR (`_fact`) OR ONE OF THE OPEN ROOM'S OWN, BY NAME (`ROOM_FACTS_OPEN`)", raw);
  ok(rawStateReads([{ f: "x.js", code: codeLines("  function _sneak(id) {\n    return client.getRoom(id).currentState.getStateEvents(\"m.room.topic\", \"\");\n  }\n") }], "_fact", OPEN).length === 1,
    "T CONTROL — a state read planted in a function on neither list is found");
  ok(OPEN.every((fn) => files.some((x) => new RegExp("^ {2}(?:async )?function " + fn.replace("$", "\\$") + "\\(", "m").test(x.text))), "T: every function the open room's list names exists", OPEN);
  // Every door call names a row; each named read reads only its rows.
  const calls = [];
  for (const x of files) x.code.forEach((line, i) => { for (const m of line.matchAll(/\b_fact\(\s*[^,]+,\s*"([^"]+)"/g)) calls.push({ at: x.f + ":" + (i + 1), fn: enclosing(x.code, i), row: m[1] }); });
  ok(calls.length >= 10 && calls.every((cc) => rows.indexOf(cc.row) >= 0), "T: EVERY CALL OF THE DOOR NAMES A ROW OF THE TABLE", calls.filter((cc) => rows.indexOf(cc.row) < 0));
  const bodies = functionBodies(files[0].code);
  const bad = [];
  for (const fn of Object.keys(RR)) {
    const body = bodies[fn];
    if (!body) { bad.push(fn + ": no such function"); continue; }
    const used = [...new Set(calls.filter((cc) => cc.fn === fn).map((cc) => cc.row))];
    const extra = used.filter((r) => RR[fn].indexOf(r) < 0);
    if (extra.length) bad.push(fn + " reads " + extra.join(", ") + " it does not declare");
    if (body.some((l) => /\bgetStateEvents\s*\(/.test(l))) bad.push(fn + " reads state past the door");
    if (RR[fn].some((r) => rows.indexOf(r) < 0)) bad.push(fn + " declares a row the table does not have");
  }
  ok(bad.length === 0 && Object.keys(RR).length >= 13, "T: EACH NAMED READ READS ONLY THE ROWS IT NAMES (`ROOM_FACT_READS`), and none past the door", bad);
  // Driven: a type the table does not list is refused by name, never read.
  const hs = W.homeserver();
  hs.room("!plain:hs", { name: "plain", members: { [W.ME]: "join" } });
  const w = W.inviteWorld({ hs });
  let asked = 0;
  const realGet = w.client.getRoom;
  w.client.getRoom = (id) => { const r = realGet(id); if (!r) return r; return Object.assign(Object.create(r), { currentState: { getStateEvents: (t, k) => { if (t === "m.room.topic") asked++; return r.currentState.getStateEvents(t, k); } } }); };
  const topic = w.MB.roomStateEvent("!plain:hs", "m.room.topic", "");
  w.MB.roomStateEvent("!plain:hs", "m.room.topic", "");
  ok(topic === null && asked === 0 && w.lines(/a room fact the table does not list was asked for \(type m\.room\.topic\)/).length === 1,
    "T: A TYPE THE TABLE DOES NOT LIST IS REFUSED BY NAME — null, never read, said once", { topic, asked, lines: w.lines(/room fact/) });
  ok(!!w.MB.roomStateEvent("!plain:hs", "m.room.create", ""), "T: and a row it lists is read (the control)");
  // The members row is the member door's, never the table's door.
  ok(w.MB.roomStateEvent("!plain:hs", "m.room.member", W.ME) === null, "T: the members are not read through the door — the member door's (`memberEventIn`), on request");
}

// ── C — THE CONNECTION ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function partC() {
  const src = read("backends/backend1/matrixbridge.js");
  const choices = src.match(/^ {2}const CONNECTION = "([a-z-]+)";/gm) || [];
  ok(choices.length === 1 && /"classic"/.test(choices[0]), "C: ONE NAMED CHOICE — `CONNECTION = \"classic\"`, the only one", choices);
  const head = src.slice(src.indexOf("  // ══ THE CONNECTION: ONE NAMED CHOICE"), src.indexOf("  const CONNECTION = "));
  ok(/org\.matrix\.simplified_msc3575/.test(head) && /\/versions/.test(head) && /SlidingSync\b/.test(head) && /fall back|fallback/.test(head),
    "C: ITS COMMENT SAYS WHERE SLIDING SYNC WOULD GO — `/versions` advertising `org.matrix.simplified_msc3575`, the SDK's `SlidingSync`, classic the fallback");
  // The SDK this app bundles (`tools/build-vendor.sh`: matrix-js-sdk's index) exports no `SlidingSync` class today.
  let idx = "";
  try { idx = fs.readFileSync(path.join(ROOT, "node_modules", "matrix-js-sdk", "lib", "matrix.js"), "utf8"); } catch (e) { idx = ""; }
  const exportsSS = /export\s*\{[^}]*\bSlidingSync\b(?!Event)[^}]*\}/.test(idx) || /export\s+\*\s+from\s+"\.\/sliding-sync\.js"/.test(idx);
  ok(idx.length > 0 && /SlidingSyncEvent/.test(idx) && !exportsSS, "C: AND THE SDK'S INDEX EXPORTS ONLY `SlidingSyncEvent`, NO `SlidingSync` — as the comment says (an upgrade that exports it is said here)", { read: idx.length, exportsSS });
  // `start()` makes the classic sync exactly as at 700.
  const hs = W.homeserver();
  let started = null;
  class Filter { constructor(u) { this.userId = u; this.definition = {}; } setDefinition(d) { this.definition = d || {}; } getDefinition() { return this.definition; } }
  const w = W.inviteWorld({ hs, extras: { matrixcs: { Filter } }, client: { startClient: async (opts) => { started = opts; }, initRustCrypto: async () => {}, getCrypto: () => ({}) } });
  try { w.sb.MatrixAccount.initCrypto = async () => false; } catch (e) {}
  try { await w.MB.start(); } catch (e) { /* read what it reached */ }
  const def = started && started.filter && started.filter.getDefinition ? started.filter.getDefinition() : null;
  ok(!!started && started.initialSyncLimit === 1 && started.lazyLoadMembers === true && JSON.stringify(def) === JSON.stringify(w.MB.syncFilterDefinition()),
    "C: `start()` MAKES THE CLASSIC SYNC AS AT 700 — the one filter, members on request, the first sync's one event", started && { initialSyncLimit: started.initialSyncLimit, lazyLoadMembers: started.lazyLoadMembers, def });
  ok(w.lines(/the connection .* is not built here/).length === 0 && w.lines(/sync started — asking for no typing, no read receipts and no presence, members on request/).length === 1,
    "C: and nothing new is said — the sync's one line, as at 700", w.lines(/sync started|connection/));
}

(async () => {
  try { partF(); } catch (e) { ok(false, "F threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  for (const [name, fn] of [["R", partR], ["T", partT], ["C", partC]]) {
    try { await fn(); } catch (e) { ok(false, name + " threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  await settle();
  _finished = true;
  if (failed) { console.log("[room-facts] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[room-facts] PASS — room facts through one door (`ddjp_701`; " + asserts + " assertions): no feature or UI file calls getClient() " +
    "or reads an SDK room — features/room.js reads the rooms held, names, memberships, creation records, levels, counts and last " +
    "activity through the transport's named reads, which answer what the SDK holds (null for a room not held), and the room list " +
    "and the other rooms list what the homeserver has; the table (`ROOM_FACTS`) holds every state type read of a room not open, " +
    "with what for, as sliding sync's required_state would take it; every state read in the transport is its door or one of " +
    "the open room's own, by name; each named read reads only its rows; a type not listed is refused by name; and the connection " +
    "is one named choice, \"classic\", started exactly as at 700, its comment saying where sliding sync would go");
  process.exit(0);
})();
