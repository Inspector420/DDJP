#!/usr/bin/env node
// tests/check-ask-less.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend1/matrixaccount.js, features/room.js
//
// WALL: ASKING MATRIX LESS, STEP 1 (the owner's plan, part 4, `ddjp_699`; the rule and his words: `main/05-matrix.md` §Asking
// Matrix less). The sync asks for nothing the app never reads, and a room's members come on request — loaded first wherever
// they are read.
//   PART L — THE READERS, AND THE FILTER THAT FOLLOWS THEM. Every app file is swept for a reader of typing (`m.typing`), read
//            receipts (`m.receipt`) and presence (`m.presence`, and what the SDK fills from it: a User's picture, name, presence);
//            each hit is printed. The one filter (`syncFilterDefinition`) drops a kind exactly when nothing reads it — both ways,
//            so a reader added later makes the filter keep it, and a reader removed lets it go. Presence had readers (the avatar
//            code) and was kept at `ddjp_699`; since `ddjp_700` a picture comes from member events (`check-picture-path`), its
//            readers are gone, and the filter drops it. The sweep's own controls: a planted reader is found, a commented one is not.
//   PART F — THE SYNC IS STARTED WITH IT: the real `start()` hands the SDK that definition as its `Filter`, with `lazyLoadMembers`.
//   PART A — EVERY MEMBER READ GOES THROUGH THE TRANSPORT'S THREE (`membersOf`, `memberIn`, `memberEventIn`): an SDK member read
//            anywhere else fails; every call of the three is listed by file and function, and each must be one of the places
//            this guard holds (a new one fails until it says how it loads first). The room list's counts are the summary's.
//   PART B — EACH PLACE, DRIVEN, IN A HOMESERVER WHOSE MEMBERS COME ON REQUEST (the invite world's homeserver, each joined room
//            holding only the members the sync named — this account and those who wrote — until its load lands; its counts the
//            summary's, whole): the opening, a rank change, the reconcile after Repair, a leave, a kick, the DM scan and the
//            room list's other rooms. At each: no read before its room's members were loaded (the bridge counts every early read),
//            and the outcome as a room holding every member gives.
//   PART M — WHAT IT SAVES, MEASURED IN A HOMESERVER MODEL (several rooms, one open): what the sync asks for and what comes back
//            per sync, before (no filter: the SDK's default) and after. THE MODEL IS SYNAPSE'S RULE AS WRITTEN, NOT A SERVER: a
//            lazy sync's state carries the members of the timeline's senders and this account's own (Synapse's "always make sure
//            we LL ourselves so we know we're in the room"), and the room summary; ephemeral and presence events by the filter.
// Red first on 698: L (the filter drops nothing), F (no filter, no lazy members), A (reads outside the three) and B (early
// reads) fail; M measures 698's request as the "before". CHANGED ON PURPOSE AT `ddjp_700` (the owner's "1 ok": presence dropped):
// L's exclusion names the presence constant as well; F reads the new log line; A holds one more place, a person's picture
// (`matrixaccount.js` `_memberPicture`), which reads only a room whose members are held and asks no load; M measures three
// filters — none (the SDK's default), 699's (typing and receipts) and today's (presence too) — so the busy minute is reported
// before and after this step.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const W = require(path.join(__dirname, "_inviteworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[ask-less] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[ask-less] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });
const notes = [];

// ── THE APP'S FILES, AS CODE (comments taken out, line by line) ────────────────────────────────────────────────────────────────
const APP_DIRS = ["backends", "features", "core", "ui"];
function appFiles() {
  const out = ["app.js", "sw.js", "sw-register.js"].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const walk = (rel) => {
    for (const n of fs.readdirSync(path.join(ROOT, rel)).sort()) {
      const r = rel + "/" + n;
      if (fs.statSync(path.join(ROOT, r)).isDirectory()) walk(r); else if (/\.js$/.test(n)) out.push(r);
    }
  };
  for (const d of APP_DIRS) if (fs.existsSync(path.join(ROOT, d))) walk(d);
  return out;
}
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
const FILES = appFiles().map((f) => ({ f, text: fs.readFileSync(path.join(ROOT, f), "utf8") })).map((x) => Object.assign(x, { code: codeLines(x.text) }));
// The enclosing function of a line: the nearest `function NAME(` at or above it, at two or four spaces in.
function enclosing(text, lineNo) {
  const lines = text.split("\n");
  for (let i = lineNo; i >= 0; i--) { const m = lines[i].match(/^ {2,4}(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/); if (m) return m[1]; }
  return "(top level)";
}

// ── L — THE READERS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// What reads each kind, as the SDK hands it to an app (matrix-js-sdk 41.8.0): the event type itself; the SDK events it raises
// from it; the readers it fills. A User's picture, name and presence move on a presence event in this SDK (`User.
// setPresenceEvent`); the store this app gets (`createClient`'s default, the SDK's MemoryStore) also copies a member event's
// picture and name onto its User, silently — so `getUser(` reads presence and member events both, and is counted a reader of
// presence (corrected at `ddjp_700`: this said the store keeps no users).
const READERS = {
  typing: [/\bm\.typing\b/, /RoomMember\.typing/, /\bgetTypingMembers\b/, /RoomMemberEvent\.Typing/, /\.typing\b/],
  receipts: [/\bm\.receipt\b/, /Room\.receipt/, /\bgetReceiptsForEvent\b/, /\bgetUsersReadUpTo\b/, /\bgetEventReadUpTo\b/, /\bgetReadReceiptForUserId\b/,
    /\bhasUserReadEvent\b/, /RoomEvent\.Receipt/, /ReceiptType/],
  presence: [/\bm\.presence\b/, /"User\.(presence|avatarUrl|displayName|currentlyActive|lastPresenceTs)"/, /\bgetUser\(/, /\bcurrentlyActive\b/, /\blastActiveAgo\b/,
    /\blastPresenceTs\b/, /UserEvent\./],
};
// The filter's own definition names what it drops; it is not a reader (its lines are left out, by their constant's name).
const NOT_A_READER = /SYNC_EPHEMERAL_DROPPED|SYNC_PRESENCE_DROPPED|function syncFilterDefinition\(/;
function readersIn(files, kind) {
  const hits = [];
  for (const x of files) x.code.forEach((line, i) => {
    if (NOT_A_READER.test(line)) return;
    for (const re of READERS[kind]) if (re.test(line)) { hits.push(x.f + ":" + (i + 1) + " " + line.trim().slice(0, 90)); break; }
  });
  return hits;
}
{
  // THE SWEEP'S CONTROLS: a planted reader is found; the same words in a comment are not.
  const plant = (code) => [{ f: "planted.js", text: code, code: codeLines(code) }];
  ok(readersIn(plant("  client.on(\"RoomMember.typing\", (e, m) => show(m));\n"), "typing").length === 1 &&
     readersIn(plant("  // client.on(\"RoomMember.typing\") is not read here\n"), "typing").length === 0 &&
     readersIn(plant("  const r = room.getUsersReadUpTo(ev);\n"), "receipts").length === 1 &&
     readersIn(plant("  const u = client.getUser(id); /* getUser( */\n"), "presence").length === 1 &&
     readersIn(plant("  const s = \"// m.presence is not a comment in a string\";\n"), "presence").length === 1 &&
     readersIn(plant("  if (Room.presenceView) show();\n"), "presence").length === 0,
    "L CONTROL — the sweep finds a planted reader of each kind, and not the same words in a comment, nor this app's own \"presence\" (its activity view)");
}
const READ = {}; for (const k of Object.keys(READERS)) READ[k] = readersIn(FILES, k);
for (const k of Object.keys(READ)) notes.push(k + " readers: " + (READ[k].length ? READ[k].join(" | ") : "none"));
const mbSrc = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
let DEF = null;
{
  // The real definition, as the bridge ships it (the bridge's own text, run alone: it is a pure function over one constant).
  const a = mbSrc.indexOf("  const SYNC_EPHEMERAL_DROPPED = "), b = a >= 0 ? mbSrc.indexOf("\n  }\n", mbSrc.indexOf("  function syncFilterDefinition()", a)) : -1;
  if (ok(a >= 0 && b > a, "L APPLIED — the bridge's one filter definition (`SYNC_EPHEMERAL_DROPPED`, `syncFilterDefinition`) is there")) {
    try { DEF = new Function(mbSrc.slice(a, b + 4) + "\nreturn syncFilterDefinition();")(); } catch (e) { ok(false, "L: the definition runs alone — " + e.message); }
  }
}
const eph = (DEF && DEF.room && DEF.room.ephemeral && Array.isArray(DEF.room.ephemeral.not_types)) ? DEF.room.ephemeral.not_types : [];
const pres = (DEF && DEF.presence && Array.isArray(DEF.presence.not_types)) ? DEF.presence.not_types : [];
ok(READ.typing.length === 0 ? eph.indexOf("m.typing") >= 0 : eph.indexOf("m.typing") < 0,
  "L: TYPING — " + (READ.typing.length ? "read here, so the sync keeps it" : "nothing reads it, so the sync does not ask for it (`m.typing` dropped)"), { readers: READ.typing, dropped: eph });
ok(READ.receipts.length === 0 ? eph.indexOf("m.receipt") >= 0 : eph.indexOf("m.receipt") < 0,
  "L: READ RECEIPTS — " + (READ.receipts.length ? "read here, so the sync keeps them" : "nothing reads them, so the sync does not ask for them (`m.receipt` dropped)"), { readers: READ.receipts, dropped: eph });
ok(READ.presence.length === 0 ? pres.indexOf("m.presence") >= 0 : pres.indexOf("m.presence") < 0,
  "L: PRESENCE — " + (READ.presence.length ? "read here (the avatar code), so the sync keeps it, and says so" : "nothing reads it, so the sync does not ask for it"), { readers: READ.presence, dropped: pres });
ok(!!(DEF && DEF.room && DEF.room.state && DEF.room.state.lazy_load_members === true), "L: ROOM MEMBERS ON REQUEST — `room.state.lazy_load_members`", DEF);
ok(!!DEF && JSON.stringify(Object.keys(DEF).sort()) === JSON.stringify(pres.length ? ["presence", "room"] : ["room"]) &&
   JSON.stringify(Object.keys(DEF.room || {}).sort()) === JSON.stringify(["ephemeral", "state"]),
  "L: AND NOTHING ELSE IS FILTERED — the timeline, state, account data and to-device as the SDK asks for them", DEF);

// ── F — THE SYNC IS STARTED WITH IT ──────────────────────────────────────────────────────────────────────────────────────────
async function partF() {
  const hs = W.homeserver();
  let started = null;
  // A Filter as matrix-js-sdk 41.8.0's (`filter.ts`): a definition set whole, read back whole, and the lazy flag the sync sets.
  class Filter { constructor(u) { this.userId = u; this.definition = {}; } setDefinition(d) { this.definition = d || {}; } getDefinition() { return this.definition; }
    setLazyLoadMembers(v) { this.definition.room = this.definition.room || {}; this.definition.room.state = this.definition.room.state || {}; this.definition.room.state.lazy_load_members = v; } }
  const w = W.inviteWorld({ hs, extras: { matrixcs: { Filter } },
    client: { startClient: async (opts) => { started = opts; }, initRustCrypto: async () => {}, getCrypto: () => ({}) } });
  try { w.sb.MatrixAccount.initCrypto = async () => false; } catch (e) {}
  try { await w.MB.start(); } catch (e) { notes.push("F: start() stopped — " + ((e && e.message) || e)); }
  ok(!!started, "F APPLIED — the real `start()` reached the SDK's `startClient`", started);
  const def = started && started.filter && typeof started.filter.getDefinition === "function" ? started.filter.getDefinition() : null;
  ok(!!def && JSON.stringify(def) === JSON.stringify(DEF), "F: IT HANDS THE SDK THE ONE DEFINITION, AS ITS `Filter`", { got: def, want: DEF });
  ok(!!started && started.lazyLoadMembers === true && started.initialSyncLimit === 1, "F: WITH `lazyLoadMembers` — the rooms' member lists on request — and the first sync's one event, as before", started && { lazyLoadMembers: started.lazyLoadMembers, initialSyncLimit: started.initialSyncLimit });
  ok(w.lines(/MatrixBridge: sync started — asking for no typing, no read receipts and no presence, members on request/).length === 1, "F: and the log says what it asked for", w.lines(/sync started/));
}

// ── A — EVERY MEMBER READ GOES THROUGH THE THREE ─────────────────────────────────────────────────────────────────────────────
const THREE = ["membersOf", "memberIn", "memberEventIn"];
const SDK_READS = [/\.getJoinedMembers\(/, /\.getMembers\(/, /\.getMembersWithMembership\(/, /\.getMember\(/, /getStateEvents\(\s*["']m\.room\.member["']/];
// Each place that calls one of the three, and how it loads first (PART B drives each; the own-membership reads need no load).
const PLACES = {
  "backends/backend1/matrixbridge.js getRoster": "People — the open room's Space, loaded at the opening (B1)",
  "backends/backend1/matrixbridge.js joinedMembersOf": "the bot's presence chat — a channel of the open room, loaded at the opening (B1); null until loaded",
  "backends/backend1/matrixbridge.js invitedMembersOf": "the bot's presence chat — as above",
  "backends/backend1/matrixbridge.js _reconcileAfterUpgrade": "the reconcile after an upgrade or Repair — loads the Space and the batch's channels first (B3)",
  "backends/backend1/matrixbridge.js _rankInPlace": "a rank change and its repair — `_runRankSteps` loads the steps' rooms first (B2)",
  "backends/backend1/matrixbridge.js _membershipIn": "a kick or ban — `_memberAction` loads first (B5)",
  "backends/backend1/matrixbridge.js newestStampIn": "this account's own membership — always sent, no load",
  "backends/backend1/matrixaccount.js _memberIs": "the DM scan — read only once `membersReady` (B6)",
  "backends/backend1/matrixaccount.js _flaggedDirect": "the DM scan — read only once `membersReady` (B6)",
  "backends/backend1/matrixaccount.js _othersIn": "the DM scan — read only once `membersReady` (B6)",
  "backends/backend1/matrixaccount.js _classifyRoom": "an invite's preview — this account's own membership",
  "backends/backend1/matrixaccount.js _memberPicture": "a person's picture (`ddjp_700`) — only a room whose members are held (`membersHeld`, which asks no load); none, the profile (`check-picture-path` A)",
};
{
  const outside = [], inside = [], calls = [];
  for (const x of FILES) {
    x.code.forEach((line, i) => {
      if (SDK_READS.some((re) => re.test(line))) {
        const fn = enclosing(x.text, i);
        (x.f === "backends/backend1/matrixbridge.js" && THREE.indexOf(fn) >= 0 ? inside : outside).push(x.f + ":" + (i + 1) + " [" + fn + "] " + line.trim().slice(0, 80));
      }
      const m = line.match(/\b(?:B1MatrixBridge\.|MatrixBridge\.)?(membersOf|memberIn|memberEventIn)\(/);
      if (m && !/function (membersOf|memberIn|memberEventIn)\(/.test(line)) calls.push(x.f + " " + enclosing(x.text, i));
    });
  }
  ok(inside.length >= 5, "A CONTROL — the sweep finds the SDK's member reads inside the three themselves (five)", inside);
  ok(outside.length === 0, "A: NO SDK MEMBER READ OUTSIDE THE THREE — anywhere in the app", outside);
  const unknown = calls.filter((c, i, a) => a.indexOf(c) === i && !PLACES[c]);
  ok(calls.length >= Object.keys(PLACES).length && unknown.length === 0,
    "A: EVERY CALL OF THE THREE IS A PLACE THIS GUARD HOLDS, each with how it loads first", { unknown, calls: calls.filter((c, i, a) => a.indexOf(c) === i) });
  for (const c of Object.keys(PLACES)) ok(calls.indexOf(c) >= 0, "A: the place `" + c + "` still reads through the three (" + PLACES[c] + ")");
  notes.push("member reads: " + calls.filter((c, i, a) => a.indexOf(c) === i).map((c) => c.replace("backends/backend1/", "")).join(", "));
  // THE ROOM LIST'S COUNTS ARE THE SUMMARY'S: no count is taken by listing members.
  const count = FILES.filter((x) => /features\/room\.js|matrixaccount\.js|matrixbridge\.js/.test(x.f))
    .map((x) => x.code.filter((l) => /\.(?:getJoinedMembers|getMembers|getMembersWithMembership)\([^)]*\)\s*\.length/.test(l)).length).reduce((a, b) => a + b, 0);
  ok(count === 0, "A: AND NO COUNT IS A MEMBER LIST'S LENGTH — the room list counts with the summary (`getJoinedMemberCount`)", count);
}

// ── THE HOMESERVER WHOSE MEMBERS COME ON REQUEST ─────────────────────────────────────────────────────────────────────────────
// The invite world's homeserver and client, unchanged, with each JOINED room shown as matrix-js-sdk 41.8.0 shows it under lazy
// members (`models/room.ts`): until `loadMembersIfNeeded()` lands, `membersLoaded()` is false and its member reads hold only the
// members the sync named — this account and the room's `wrote` (who wrote in what the sync brought); its counts are the
// summary's, whole. A room this account is invited to (its preview) or has left reads as the base double does.
function lazyClient(hs, me, extra) {
  const base = W.clientFor(hs, me);
  const loads = [], loaded = new Set(), views = Object.create(null);
  const lazy = (v) => {
    if (!v) return v;
    if (views[v.roomId]) return views[v.roomId];
    const id = v.roomId, R = () => hs.rooms[id];
    const named = () => new Set([me].concat((R() && R().wrote) || []));
    const partial = () => v.getMyMembership() === "join" && !loaded.has(id);
    const keep = (list) => partial() ? (list || []).filter((m) => named().has(m.userId)) : list;
    return (views[id] = {
      roomId: id, get timeline() { return v.timeline; }, get name() { return v.name; },
      getMyMembership: () => v.getMyMembership(),
      getJoinedMemberCount: () => v.getJoinedMemberCount(), getInvitedMemberCount: () => v.getInvitedMemberCount(),
      getMember: (u) => (partial() && !named().has(u)) ? null : v.getMember(u),
      getMembers: () => keep(v.getMembers()), getJoinedMembers: () => keep(v.getJoinedMembers()),
      getMembersWithMembership: (m) => keep(v.getMembersWithMembership(m)),
      getLastActiveTimestamp: () => v.getLastActiveTimestamp(),
      currentState: { getStateEvents: (type, key) => {
        const r = v.currentState.getStateEvents(type, key);
        if (type !== "m.room.member" || !partial()) return r;
        if (key !== undefined) return (r && named().has(key)) ? r : null;
        return (r || []).filter((e) => named().has(e.getStateKey()));
      } },
      membersLoaded: () => !partial(),
      loadMembersIfNeeded: () => { loads.push(id); return new Promise((res) => setImmediate(() => { loaded.add(id); res(true); })); },
    });
  };
  const client = Object.assign({ getRoom: (id) => lazy(base.client.getRoom(id)), getRooms: () => base.client.getRooms().map(lazy) }, extra || {});
  return { client, loads, loaded };
}
const earlies = (w) => (typeof w.MB._earlyReadsForTest === "function" ? w.MB._earlyReadsForTest() : null);
const OTHERS = ["@ann:hs", "@bea:hs", "@cy:hs", "@dee:hs"];
// A DDJP room this account is in, with four others in the Space and the open channels; only `@ann` wrote lately.
function roomWithPeople(hs, sid, o) {
  o = o || {};
  const R = hs.ddjpRoom(sid, Object.assign({ levels: Object.assign({ [W.ME]: 0 }, o.levels || {}) }, o));
  hs.rooms[sid].members[W.ME] = "join";
  for (const u of OTHERS) {
    hs.rooms[sid].members[u] = "join";
    for (const k of Object.keys(R.ch)) if (!W.INVITE_ONLY[k]) hs.rooms[R.ch[k]].members[u] = "join";
  }
  for (const id of [sid].concat(Object.values(R.ch))) hs.rooms[id].wrote = ["@ann:hs"];
  return R;
}

// ── B1 — THE OPENING ─────────────────────────────────────────────────────────────────────────────────────────────────────────
async function partB1() {
  const hs = W.homeserver();
  const R = roomWithPeople(hs, "!open:hs", { mode: "backend2" });
  const lc = lazyClient(hs, W.ME);
  const w = W.inviteWorld({ hs, client: lc.client });
  ok(typeof w.MB.loadMembers === "function", "B1 APPLIED — the bridge loads members (`loadMembers`)");
  await w.Room.join("!open:hs");
  await w.settle(40);
  const ch = (w.Room.getCurrent() || {}).channels || {};
  const want = ["!open:hs"].concat(Object.values(ch));
  ok(Object.keys(ch).length >= 4, "B1 PREMISE — the room opened, its channels mapped", ch);
  ok(want.every((id) => lc.loads.indexOf(id) >= 0), "B1: THE OPENING LOADS THE SPACE'S AND EVERY JOINED CHANNEL'S MEMBERS", { loads: lc.loads, want });
  const e = earlies(w);
  ok(Array.isArray(e) && e.length === 0, "B1: AND NOTHING OF THE ROOM READ ITS MEMBERS BEFORE THEY WERE LOADED", e);
  const roster = (w.Room.getRoster() || []).map((r) => r.userId).sort();
  ok(JSON.stringify(roster) === JSON.stringify([W.OWNER, W.ME].concat(OTHERS).sort()), "B1: PEOPLE LISTS EVERY MEMBER OF THE SPACE, NOT ONLY THE ONE WHO WROTE", roster);
  ok(w.lines(/MatrixBridge: members loaded for opening the room — \d+ room\(s\)/).length === 1, "B1: and the log says it, once", w.lines(/members/));
  // A CHANNEL JOINED AFTER THE OPENING (a promotion's chat, the bot adding you to its presence chat): its members asked for at once.
  const late = "!open-late:hs";
  hs.room(late, { name: "late", members: { [W.ME]: "join", "@ann:hs": "join", "@bea:hs": "join" } });
  hs.rooms[late].wrote = [];
  w.MB.addToRoomScope(late);
  ok(lc.loads.indexOf(late) >= 0, "B1: A CHANNEL ADDED TO THE ROOM AFTER ITS OPENING HAS ITS MEMBERS ASKED FOR AT ONCE", lc.loads);
  return { hs, w, lc, R, ch };
}
// ── B1b — PEOPLE BEFORE THE SPACE'S MEMBERS LAND: cannot tell, never the one who wrote ─────────────────────────────────────────
async function partB1b() {
  const hs = W.homeserver();
  roomWithPeople(hs, "!early:hs", { mode: "backend2" });
  const lc = lazyClient(hs, W.ME);
  const w = W.inviteWorld({ hs, client: lc.client });
  const r = w.MB.getRoster("!early:hs");
  const e = earlies(w) || [];
  ok(r === null && e.length === 1 && e[0].roomId === "!early:hs" && lc.loads.indexOf("!early:hs") >= 0,
    "B1b: PEOPLE READ BEFORE THE SPACE'S MEMBERS LANDED IS NULL — \"cannot tell yet\", never [@ann, me] — counted as an early read, its load asked for", { r, e, loads: lc.loads });
  ok(w.lines(/MatrixBridge: the members of .* were read before they were loaded \(People \(the room's members\)\)/).length === 1, "B1b: and logged once, naming the place", w.lines(/read before/));
  await w.settle(6);
  const r2 = (w.MB.getRoster("!early:hs") || []).map((x) => x.userId).sort();
  ok(JSON.stringify(r2) === JSON.stringify([W.OWNER, W.ME].concat(OTHERS).sort()) && (earlies(w) || []).length === 1, "B1b: ONCE LANDED, EVERY MEMBER — and that read is not early", r2);
}

// ── B2 — A RANK CHANGE (and its repair, the same change), in a shared room whose members were never loaded ────────────────────
async function partB2() {
  const hs = W.homeserver();
  const sends = [];
  const lc = lazyClient(hs, W.ME, {
    sendStateEvent: async (rid, type, content) => { sends.push(["level", rid]); if (type === "m.room.power_levels") hs.rooms[rid].power = JSON.parse(JSON.stringify(content)); return {}; },
    kick: async (rid, u) => { sends.push(["kick", rid, u]); hs.rooms[rid].members[u] = "leave"; },
    invite: async (rid, u) => { sends.push(["invite", rid, u]); hs.invite(rid, u, { from: W.ME }); },
  });
  const w = W.inviteWorld({ hs, client: lc.client });
  // A shared room as the decentralized engine builds one, every batch's channels made; four others in it, only @ann wrote.
  const keys = (w.sb.Backends.planFor("backend1") || []).map((r) => r.key);
  const R = hs.ddjpRoom("!rank:hs", { mode: "backend1", keys, creator: W.OWNER, levels: { [W.ME]: 100, "@cy:hs": 60 } });
  for (const id of ["!rank:hs"].concat(Object.values(R.ch))) {
    hs.rooms[id].members[W.ME] = "join";
    for (const u of OTHERS) hs.rooms[id].members[u] = /chat_(guest|staff|high)/.test(Object.keys(R.ch).find((k) => R.ch[k] === id) || "") ? undefined : "join";
    hs.rooms[id].wrote = ["@ann:hs"];
  }
  for (const id of Object.values(R.ch)) for (const u of OTHERS) if (hs.rooms[id].members[u] === undefined) delete hs.rooms[id].members[u];
  hs.rooms[R.ch.chat_staff].members["@cy:hs"] = "join";
  hs.rooms[R.ch.chat_guest].members["@cy:hs"] = "join";
  // THE CHANGE'S CLOCK, VIRTUAL, ITS MINUTE KEPT: each sleep moves it, and the minute's timer fires when it passes — so a change that
  // cannot confirm a step (read from a list it never loaded) ends at its minute instead of reading back for ever.
  let vt = 0, cut = null;
  if (typeof w.MB._setRankClockForTest === "function") w.MB._setRankClockForTest(
    (ms) => { vt += ms; if (cut && vt >= cut.at) { const f = cut.fn; cut = null; f(); } return Promise.resolve(); },
    (fn, ms) => { cut = { fn, at: vt + ms }; return 1; }, () => { cut = null; }, () => vt);
  const chans = {}; for (const k of Object.keys(R.ch)) chans[k] = R.ch[k];
  const l0 = w.logs.length;
  // @bea to staff (60): her level everywhere, invites to the guest and staff chats. @cy from staff to uncategorized (0): out of both.
  const up = await w.MB.assignRank("!rank:hs", chans, "@bea:hs", 60, {});
  const down = await w.MB.assignRank("!rank:hs", chans, "@cy:hs", 0, {});
  const memberRooms = Object.values(chans).concat(["!rank:hs"]).filter((id) => id !== R.ch.presence_chat);
  ok(memberRooms.every((id) => lc.loads.indexOf(id) >= 0), "B2: A RANK CHANGE LOADS THE MEMBERS OF EVERY ROOM ITS STEPS READ A MEMBERSHIP IN, FIRST", { loads: lc.loads, missing: memberRooms.filter((id) => lc.loads.indexOf(id) < 0) });
  const e = earlies(w);
  ok(Array.isArray(e) && e.length === 0, "B2: AND READS NONE BEFORE ITS LOAD", e);
  ok(up && up.ok === true && down && down.ok === true, "B2: BOTH CHANGES END CONFIRMED, as in a room holding every member", { up, down, log: w.lines(/MatrixBridge: (assigned|rank change|refused)/, l0) });
  ok(sends.some((s) => s[0] === "invite" && s[1] === R.ch.chat_staff && s[2] === "@bea:hs") && sends.some((s) => s[0] === "kick" && s[1] === R.ch.chat_staff && s[2] === "@cy:hs"),
    "B2: THE MEMBERSHIP STEPS WERE READ RIGHT — @bea invited to the staff chat; @cy, who IS in it, removed (read unloaded, he would have looked out already and stayed)", sends.filter((s) => s[0] !== "level"));
  ok(!sends.some((s) => s[0] === "invite" && s[2] !== "@bea:hs"), "B2: and nobody already in a room was invited to it again", sends.filter((s) => s[0] === "invite"));
}

// ── B3 — THE RECONCILE AFTER REPAIR, in a room whose members were never loaded ─────────────────────────────────────────────────
async function partB3() {
  const hs = W.homeserver();
  const plan = ["events_uncategorized", "events_owner", "settings_owner", "chat_uncategorized", "chat_guest", "chat_staff", "presence_chat"];
  const R = roomWithPeople(hs, "!fix:hs", { mode: "backend2", creator: W.ME, keys: plan.filter((k) => k !== "chat_guest"), levels: { [W.ME]: 100, "@ann:hs": 10, "@bea:hs": 10 } });
  for (const id of ["!fix:hs"].concat(Object.values(R.ch))) hs.rooms[id].members[W.ME] = "join";
  const invites = [];
  let made = 0;
  const lc = lazyClient(hs, W.ME, {
    createRoom: async (opts) => {
      const cc = Object.assign({ room_version: opts.room_version || "1" }, opts.creation_content || {});
      const id = "!made" + (++made) + ":hs";
      const pl = ((opts.initial_state || []).find((e) => e.type === "m.room.power_levels") || {}).content || { users: {}, users_default: 0 };
      hs.room(id, { name: opts.name, creator: W.ME, content: cc, members: { [W.ME]: "join" }, joinRule: "invite", power: JSON.parse(JSON.stringify(pl)), parent: cc.ddjp_room || null });
      hs.rooms[id].wrote = [];
      return { room_id: id };
    },
    sendStateEvent: async (rid, type, content, key) => {
      if (type === "m.space.child") { if (hs.rooms[rid].children.indexOf(key) < 0) hs.rooms[rid].children.push(key); return {}; }
      if (type === "m.room.power_levels") { hs.rooms[rid].power = JSON.parse(JSON.stringify(content)); return {}; }
      return {};
    },
    invite: async (rid, u) => { invites.push([rid, u]); hs.invite(rid, u, { from: W.ME }); },
  });
  const timers = (fn, ms) => ((ms || 0) === 20000 ? (setImmediate(fn), 0) : ((ms || 0) <= 1000 ? setTimeout(fn, ms) : 0));
  const store = { history: { load: async () => null, persist() {} },
    config: { saveRoom() {}, savePendingCreate() {}, clearPendingCreate() {}, loadPendingCreate: () => null, saveLeaving() {}, loadLeaving: () => [] } };
  const w = W.inviteWorld({ hs, client: lc.client, extras: { setTimeout: timers, Store: store } });
  ok(typeof w.Room.repairRoom === "function", "B3 APPLIED — Repair (`Room.repairRoom`) is there");
  const l0 = w.logs.length;
  await w.Room.repairRoom("!fix:hs");
  const later = async (cond, ms) => { const end = Date.now() + (ms || 8000); while (Date.now() < end) { if (cond()) return true; await new Promise((r) => setTimeout(r, 15)); } return cond(); };
  await later(() => w.lines(/upgrade reconcile|repair reconcile/, l0).length > 0 || invites.length > 0, 8000);
  await w.settle(20);
  const guest = Object.keys(hs.rooms).find((id) => hs.rooms[id].create.content.ddjp_kind === "chat_guest");
  ok(!!guest, "B3 PREMISE — Repair made the missing guest chat", Object.keys(hs.rooms));
  ok(lc.loads.indexOf("!fix:hs") >= 0, "B3: THE RECONCILE LOADS THE SPACE'S MEMBERS FIRST", lc.loads);
  const e = earlies(w);
  ok(Array.isArray(e) && e.length === 0, "B3: AND READS NONE BEFORE ITS LOAD", e);
  const toGuest = invites.filter((i) => i[0] === guest).map((i) => i[1]).sort();
  ok(JSON.stringify(toGuest) === JSON.stringify(["@ann:hs", "@bea:hs"]), "B3: EVERY GUEST OF THE SPACE IS INVITED TO THE NEW GUEST CHAT — not only the one who wrote", { toGuest, invites, log: w.lines(/reconcile/, l0) });
}

// ── B4 — A LEAVE reads only this account's own membership: no load, and it leaves as before ──────────────────────────────────
async function partB4() {
  const hs = W.homeserver();
  const R = roomWithPeople(hs, "!bye:hs", { mode: "backend2" });
  for (const k of Object.keys(R.ch)) if (!W.INVITE_ONLY[k]) hs.rooms[R.ch[k]].members[W.ME] = "join";
  const lc = lazyClient(hs, W.ME);
  const store = { history: { load: async () => null, persist() {} }, config: { saveRoom() {}, saveLeaving() {}, loadLeaving: () => [] } };
  const w = W.inviteWorld({ hs, client: lc.client, extras: { Store: store } });
  const r = await w.Room.leaveForGood("!bye:hs");
  await w.settle(10);
  ok(r && r.ok === true, "B4: A LEAVE FOR GOOD LEAVES EVERY CHANNEL AND THE ROOM, as before", r);
  const e = earlies(w);
  ok(Array.isArray(e) && e.length === 0 && lc.loads.length === 0, "B4: IT READS NO ONE ELSE'S MEMBERSHIP — nothing loaded, nothing read early", { e, loads: lc.loads });
}

// ── B5 — A KICK reads the target's membership back: loaded first ─────────────────────────────────────────────────────────────
async function partB5() {
  const hs = W.homeserver();
  const R = roomWithPeople(hs, "!mod:hs", { mode: "backend2", levels: { [W.ME]: 100 } });
  for (const id of ["!mod:hs"].concat(Object.values(R.ch))) hs.rooms[id].members[W.ME] = "join";
  const lc = lazyClient(hs, W.ME, { kick: async (rid, u) => { hs.rooms[rid].members[u] = "leave"; } });
  const w = W.inviteWorld({ hs, client: lc.client });
  const chans = {}; for (const k of Object.keys(R.ch)) chans[k] = R.ch[k];
  const r = await w.MB.kickFromRoom("!mod:hs", chans, "@dee:hs", "test");
  const e = earlies(w);
  ok(Array.isArray(e) && e.length === 0 && lc.loads.indexOf("!mod:hs") >= 0, "B5: A KICK LOADS THE ROOMS' MEMBERS BEFORE IT READS THE TARGET BACK", { e, loads: lc.loads });
  ok(r && r.ok === true && r.unverified.length === 0, "B5: AND EVERY ROOM READS BACK CLOSED — none 'unverified' for want of a load", r);
}

// ── B6 — THE DM SCAN AND THE ROOM LIST'S OTHER ROOMS ─────────────────────────────────────────────────────────────────────────
async function partB6() {
  const hs = W.homeserver();
  // An Element-made DM (not in `m.direct`, `is_direct` on its invite) with @eve, who has not written lately; a group room.
  hs.room("!dm:hs", { name: "", members: { [W.ME]: "join", "@eve:hs": "join" } });
  hs.rooms["!dm:hs"].inviteMeta[W.ME] = { sender: "@eve:hs", direct: true, ts: 3000 };
  hs.rooms["!dm:hs"].wrote = [];
  hs.room("!group:hs", { name: "Group", members: { [W.ME]: "join", "@eve:hs": "join", "@fay:hs": "join" } });
  hs.rooms["!group:hs"].wrote = [];
  const lc = lazyClient(hs, W.ME);
  // The DM double's member event marks it direct only on an invite; a joined DM keeps the mark in its previous content.
  const w = W.inviteWorld({ hs, client: lc.client });
  const ids0 = w.MA.dmRoomIds();
  ok(ids0.indexOf("!dm:hs") < 0 && lc.loads.indexOf("!dm:hs") >= 0 && (earlies(w) || []).length === 0,
    "B6: BEFORE ITS MEMBERS LAND, THE DM SCAN PASSES THE ROOM BY AND ASKS FOR THEM — no read of a list that holds only this account", { ids0, loads: lc.loads, e: earlies(w) });
  ok(lc.loads.indexOf("!group:hs") < 0, "B6: a room of three is never asked for — the summary's count rules it out first", lc.loads);
  // The double's joined DM carries no `is_direct`; Element's DM is marked on the member events, as the invite world models an invite.
  hs.rooms["!dm:hs"].members[W.ME] = "join";
  await w.settle(10);
  const peer = w.MA.oneToOnePeer("!dm:hs");
  ok(peer && peer.peer === "@eve:hs", "B6: ONCE LANDED, WHO THE ONE-TO-ONE ROOM IS WITH IS READ — @eve, who never wrote", peer);
  ok((earlies(w) || []).length === 0, "B6: and no read came before its load", earlies(w));
  // `waitForSync` loads every room of two or fewer before the lobby binds DMs.
  const hs2 = W.homeserver();
  hs2.room("!dm2:hs", { name: "", members: { [W.ME]: "join", "@gil:hs": "join" } }); hs2.rooms["!dm2:hs"].wrote = [];
  hs2.room("!big:hs", { name: "Big", members: { [W.ME]: "join", "@a:hs": "join", "@b:hs": "join" } }); hs2.rooms["!big:hs"].wrote = [];
  const lc2 = lazyClient(hs2, W.ME);
  const w2 = W.inviteWorld({ hs: hs2, client: lc2.client });
  await w2.MB.waitForSync();
  ok(lc2.loaded.has("!dm2:hs") && !lc2.loaded.has("!big:hs"), "B6: THE FIRST SYNC'S WAIT LOADS EVERY ROOM OF TWO OR FEWER (the DM scan's) — and no bigger one", { loaded: Array.from(lc2.loaded) });
  // THE ROOM LIST'S OTHER ROOMS count with the summary: a three-person room reads three, though no member was loaded.
  const others = typeof w.Room.otherRooms === "function" ? w.Room.otherRooms() : null;
  const g = others && (others.rooms || others).find ? (others.rooms || others).find((r) => r && (r.roomId === "!group:hs" || r.id === "!group:hs")) : null;
  ok(!!g && g.people === 3, "B6: THE ROOM LIST COUNTS WITH THE SUMMARY — the group room reads 3 people with none of its members loaded", g || others);
  ok((earlies(w) || []).length === 0, "B6: and the room list read no member list early", earlies(w));
}

// ── M — WHAT IT SAVES, IN A HOMESERVER MODEL ─────────────────────────────────────────────────────────────────────────────────
// The account: one DDJP room open (a Space and 19 channels, 12 members), two more DDJP rooms (8 members each), four DMs and one
// public room of 300. Per sync: the INITIAL sync (each room's state; a timeline of one event, `initialSyncLimit`) and one
// INCREMENTAL sync carrying a minute of a busy room — 6 messages in the open room's chat from 3 people, 4 typing notices, 12
// read receipts, 2 messages in the public room with 5 typing and 20 receipts, and presence for 40 people. What comes back is
// counted as events and as bytes of JSON, each event a typical one's size.
function measure() {
  const rooms = [];
  const ddjp = (name, chans, n, open) => { for (let c = 0; c <= chans; c++) rooms.push({ id: "!" + name + c, members: n, open, writers: 1, stateOther: c === 0 ? 4 : 5 }); };
  ddjp("open", 19, 12, true); ddjp("b", 19, 8, false); ddjp("c", 13, 8, false);
  for (let i = 0; i < 4; i++) rooms.push({ id: "!dm" + i, members: 2, writers: 1, stateOther: 4 });
  rooms.push({ id: "!pub", members: 300, writers: 1, stateOther: 8 });
  const SIZE = { member: 420, state: 380, message: 520, typing: 140, receipt: 210, presence: 230, summary: 90 };
  // `drop`: what the filter leaves out — `lazy` members on request, `typing`, `receipts`, `presence` (each true or false).
  const sync = (drop, incremental) => {
    const filtered = !!drop.lazy;
    const n = { member: 0, state: 0, message: 0, typing: 0, receipt: 0, presence: 0, summary: 0 };
    for (const r of rooms) {
      if (!incremental) {
        n.state += r.stateOther;
        n.member += filtered ? Math.min(r.members, r.writers + 1) : r.members;   // lazy: the timeline's sender and this account
        n.message += 1;
        if (filtered) n.summary += 1;
      }
    }
    if (incremental) {
      n.message += 6 + 2;
      if (filtered) n.member += 0;   // the writers' member events are held already (they wrote before); a new writer would add one
      if (!drop.typing) n.typing += 4 + 5;
      if (!drop.receipts) n.receipt += 12 + 20;
    }
    if (!drop.presence) n.presence += 40;
    const events = Object.keys(n).filter((k) => k !== "summary").reduce((a, k) => a + n[k], 0);
    const bytes = Object.keys(n).reduce((a, k) => a + n[k] * SIZE[k], 0);
    return { n, events, bytes };
  };
  const NONE = {}, AT699 = { lazy: true, typing: true, receipts: true };
  const NOW = { lazy: !!(DEF && DEF.room && DEF.room.state && DEF.room.state.lazy_load_members), typing: eph.indexOf("m.typing") >= 0,
    receipts: eph.indexOf("m.receipt") >= 0, presence: pres.indexOf("m.presence") >= 0 };
  return { rooms: rooms.length, before: { initial: sync(NONE, false), incremental: sync(NONE, true) },
    at699: { initial: sync(AT699, false), incremental: sync(AT699, true) }, after: { initial: sync(NOW, false), incremental: sync(NOW, true) } };
}
function partM() {
  const before = { room: { timeline: { unread_thread_notifications: true } } };   // the SDK's default filter (`sync.ts` `buildDefaultFilter`)
  const after = DEF;
  const m = measure();
  const pct = (a, b) => Math.round(100 * (a - b) / a);
  ok(m.after.initial.n.member < m.before.initial.n.member && m.after.incremental.n.typing === 0 && m.after.incremental.n.receipt === 0,
    "M: THE MODEL SHOWS THE SAVING — fewer member events at the first sync, no typing or receipts after", m);
  ok(m.after.incremental.n.presence === (pres.indexOf("m.presence") >= 0 ? 0 : 40) && m.at699.incremental.n.presence === 40,
    "M: AND PRESENCE AS THE FILTER SAYS — none when it is dropped (`ddjp_700`), the 40 people's at 699", { now: m.after.incremental.n, at699: m.at699.incremental.n });
  const line = "asked before " + JSON.stringify(before) + " (no filter of ours; the first sync's timeline 1) → after " + JSON.stringify(after) +
    " with lazyLoadMembers; in " + m.rooms + " rooms, one open: the first sync " + m.before.initial.events + " events / " + Math.round(m.before.initial.bytes / 1024) +
    " KB → " + m.after.initial.events + " / " + Math.round(m.after.initial.bytes / 1024) + " KB (" + pct(m.before.initial.bytes, m.after.initial.bytes) + "% less; members " +
    m.before.initial.n.member + " → " + m.after.initial.n.member + "); a busy minute's sync " + m.before.incremental.events + " events / " + Math.round(m.before.incremental.bytes / 1024) +
    " KB → " + m.after.incremental.events + " / " + Math.round(m.after.incremental.bytes / 1024) + " KB (" + pct(m.before.incremental.bytes, m.after.incremental.bytes) +
    "% less; typing " + m.before.incremental.n.typing + " → 0, receipts " + m.before.incremental.n.receipt + " → 0; presence " + m.before.incremental.n.presence +
    " → " + m.after.incremental.n.presence + "); the busy minute at 699's filter (typing and receipts dropped, presence kept) " + m.at699.incremental.events + " events / " +
    Math.round(m.at699.incremental.bytes / 1024) + " KB → now " + m.after.incremental.events + " / " + Math.round(m.after.incremental.bytes / 1024) + " KB (" +
    pct(m.at699.incremental.bytes, m.after.incremental.bytes) + "% less); the first sync at 699's " + m.at699.initial.events + " / " + Math.round(m.at699.initial.bytes / 1024) +
    " KB → now " + m.after.initial.events + " / " + Math.round(m.after.initial.bytes / 1024) + " KB; the open room then asks once for its 20 rooms' members (/members)";
  notes.push("M: " + line);
  return line;
}

(async () => {
  try { await partF(); } catch (e) { ok(false, "F threw — " + ((e && e.stack) || e)); }
  for (const [name, fn] of [["B1", partB1], ["B1b", partB1b], ["B2", partB2], ["B3", partB3], ["B4", partB4], ["B5", partB5], ["B6", partB6]]) {
    try { await fn(); } catch (e) { ok(false, name + " threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); }
  }
  let mline = "";
  try { mline = partM(); } catch (e) { ok(false, "M threw — " + ((e && e.stack) || e)); }
  if (process.env.ASK_LESS_NOTES) for (const n of notes) console.log("  · " + n);
  _finished = true;
  if (failed) { console.log("[ask-less] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[ask-less] PASS — asking Matrix less, step 1 (the owner's plan, part 4, `ddjp_699`; presence `ddjp_700`; " + asserts + " assertions): the sync " +
    "drops typing, read receipts and presence — nothing here reads them (a picture comes from member events since `ddjp_700`); room members come on request, " +
    "every member read goes through the transport's three, and each place loads its rooms first — the opening, a rank change, the reconcile " +
    "after Repair, a kick; a leave reads only this account's own; the DM scan passes a room by until its members land. Measured in a " +
    "homeserver model: " + mline);
  process.exit(0);
})();
