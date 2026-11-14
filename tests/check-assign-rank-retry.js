// tests/check-assign-rank-retry.js
// SUBJECT: backends/backend1/matrixbridge.js
// WALL: assignRank REPORTS SUCCESS ONLY WHEN EVERY STEP IS CONFIRMED (owner's live test on `ddjp_545`: a 429 on one channel
//   was logged, then "all channels reconciled" — the bot ended split, space level 99 but writing as rank 80). REBUILT AT J129
//   (the owner's): every step — each level, each invite and kick — is read back, a rate limit is waited out as the server
//   says, and a change has ONE MINUTE; the background retry `ddjp_545` added is gone, replaced by the named error and Try again.
//   Driven with the shipped block (from `RANK_LIMIT_MS` to the end of assignRank, with the bridge's one reading of a level)
//   against a scripted client that SHOWS what it accepted — a few turns later, as a sync would — and a virtual clock.
//   PART A — a 429 retried, honouring retry_after_ms, then confirmed: one success line, nothing "not confirmed".
//   PART B — a channel that stays 429: stopped at the minute, the step named, no success line, nothing left scheduled.
//   PART C — a 403 is not sent again; it is named, and the change ends at once.
//   PART D — a stop (the leave's) ends a change at once, nothing more sent.      (was: a newer assignment superseded the
//            background retry — there is none now, and a second change on a tab is refused by the room, `check-rank-change` D)
//   PART E — a send accepted but never shown is sent again after RANK_RESEND_MS, and named at the minute.
//   Since `ddjp_692` the block's sends are paced (the transport's one send pacer, inside the block): B's "at the minute" allows
//   the pacer's widest gap as the last wait, which a virtual clock counts whole; its pacing itself is `check-rank-trust` E's.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[assign-rank-retry] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const fnSrc = (name) => { const m = MB.match(new RegExp("\\n  (async )?function " + name + "\\(")); if (!m) return ""; const i = m.index + 1; return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); };
const span = (from, fnAnchor) => { const a = MB.indexOf(from), b = MB.indexOf("\n  }\n", MB.indexOf(fnAnchor)); return (a >= 0 && b > a) ? MB.slice(a, b + 4) : ""; };
const BLOCK = span("  const RANK_LIMIT_MS = ", "  async function assignRank(spaceId, channels, userId, level, opts) {");
const LEVELS = span("  const CREATOR_LEVEL = 100;", "  function _userLevelInRoom(room, userId) {");
const R = loadInContext(["backends/backend1/ranks.js"], {}).Ranks;
// `amJoined` too since `ddjp_652` (the owner's correction): the block reads "this account is in that room" from its
// membership, never from whether the SDK has the room — so the scripted rooms say this account has joined each.
// CHANGED ON PURPOSE AT `ddjp_699` (the owner's plan, part 4: members on request): the rank change reads a room's members through
// the transport's three reads (`memberIn` and the rest) after loading them first (`loadMembers`), so the world runs that block as it
// ships — from `MEMBERS_WAIT_MS` to the end of `memberEventIn` — with what it reaches stood in (these scripted rooms hold every
// member, so nothing is loaded and every read reads as before).
const MEMBERS = (() => { const a = MB.indexOf("  const MEMBERS_WAIT_MS = "), b = MB.indexOf("\n  }\n", MB.indexOf("  function memberEventIn(")); return (a >= 0 && b > a) ? MB.slice(a, b + 4) : ""; })() +
  "\nfunction getUserId() { return null; } function _short(x) { return String(x); } const _memberListeners = [], _roomsListeners = [];\n";
const SRC = ["_rankFromKey", "_presenceChatKey", "_desiredMembership", "amJoined"].map(fnSrc).join("") + LEVELS + BLOCK + MEMBERS;
const CH = { events_uncategorized: "!eu:hs", chat_uncategorized: "!cu:hs", events_owner: "!eo:hs" };
// The plan rows for those three, which the membership rule reads (`_presenceChatKey` asks the plan for the presence row, and a
// chat's rank comes from the derived levels). Supplied, because since J129 every membership is a confirmed step — the rule runs.
const PLAN = [{ key: "events_uncategorized", kind: "events", level: 0 }, { key: "chat_uncategorized", kind: "chat", level: 0 }, { key: "events_owner", kind: "events", level: 99 }];
const DERIVED = { levelBySlug: { uncategorized: 0, owner: 99 } };
const ALL = ["!space:hs"].concat(Object.values(CH));
const turns = async (n) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
function world(script) {
  const sends = {}, logs = [], waits = [], clock = { t: 0, cut: null };
  const rooms = {};
  const room = (id) => rooms[id] || (rooms[id] = { members: {}, pl: { users: {}, users_default: 0 },
    currentState: { getStateEvents: (t) => (t === "m.room.power_levels" ? { getContent: () => rooms[id].pl } : null) },
    getMember: (u) => (rooms[id].members[u] ? { membership: rooms[id].members[u] } : null), getMyMembership: () => "join" });
  for (const id of ALL) room(id);
  const err = (code, status, ra) => { const e = new Error(code); e.errcode = code; e.httpStatus = status; e.data = { errcode: code }; if (ra !== undefined) e.data.retry_after_ms = ra; return e; };
  const answer = async (rid, apply) => {
    sends[rid] = (sends[rid] || 0) + 1; const s = script[rid] || {};
    if (s.forbidden) throw err("M_FORBIDDEN", 403);
    if (s.always429 || (s.fail429 || 0) >= sends[rid]) throw err("M_LIMIT_EXCEEDED", 429, s.retryAfter);
    if (!s.lost) turns(2).then(apply);   // shown a sync later — or, `lost`, never
    return {};
  };
  const client = { getRoom: (id) => rooms[id] || null,
    invite: (rid, u) => answer("in:" + rid, () => { rooms[rid].members[u] = "invite"; }),
    kick: (rid, u) => answer("out:" + rid, () => { rooms[rid].members[u] = "leave"; }),
    sendStateEvent: (rid, t, c) => answer(rid, () => { rooms[rid].pl = JSON.parse(JSON.stringify(c)); }) };
  const Logger = { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]), debug() {}, error() {} };
  const api = new Function("client", "Logger", "Ranks", "rankAssignable", "_channels", "_derived", "clock", "waits", "turns",
    SRC + "\n_rankSleep = async (ms) => { waits.push(ms); clock.t += ms; if (clock.cut && clock.cut.at <= clock.t) { const f = clock.cut.fn; clock.cut = null; f(); } await turns(1); };" +
    "\n_rankLater = (fn, ms) => { clock.cut = { fn, at: clock.t + ms }; return clock.cut; };\n_rankUnlater = (h) => { if (clock.cut === h) clock.cut = null; };" +
    "\nreturn { assignRank, stopRankChange, RANK_POLL_MS, RANK_RESEND_MS, RANK_LIMIT_MS, PACE_MAX_MS: (typeof PACE_MAX_MS === \"number\" ? PACE_MAX_MS : 0) };")(
    client, Logger, R, () => ({ ok: true, missing: [] }), () => PLAN, () => DERIVED, clock, waits, turns);
  return Object.assign({ sends, logs, waits, clock, script, rooms }, api);
}
const success = (w) => w.logs.filter(([k, m]) => k === "info" && /\(all channels reconciled — \d+ of \d+ steps confirmed\)/.test(m));
const notConfirmed = (w) => w.logs.filter(([k, m]) => k === "warn" && /not confirmed:/.test(m));
(async () => {
  ok(BLOCK.indexOf("async function assignRank(") >= 0 && BLOCK.indexOf("function _rankSteps(") >= 0 && LEVELS.indexOf("function _userLevelInRoom(") >= 0,
    "PREMISE — the shipped assignRank block and the bridge's reading of a level were found");
  // A
  { const w = world({ "!eo:hs": { fail429: 2, retryAfter: 120 }, "in:!cu:hs": { fail429: 1, retryAfter: 90 } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    ok(r && r.ok === true && r.done === r.total && r.total > 0, "A: a 429 retried and then confirmed is a success, every step confirmed", r);
    ok(w.sends["!eo:hs"] === 3 && w.waits.filter((ms) => ms === 120).length === 2, "A: the level retried twice, honouring retry_after_ms", { sends: w.sends["!eo:hs"], waits: w.waits });
    ok(w.sends["in:!cu:hs"] === 2 && w.waits.filter((ms) => ms === 90).length === 1 && w.rooms["!cu:hs"].members["@bot:hs"] === "invite",
      "A: an INVITE's 429 is retried too, honouring retry_after_ms, and lands (J129 — it was swallowed)", { sends: w.sends["in:!cu:hs"], member: w.rooms["!cu:hs"].members["@bot:hs"] });
    ok(success(w).length === 1 && notConfirmed(w).length === 0, "A: one success line, nothing not confirmed", w.logs); }
  // B
  { const w = world({ "!eo:hs": { always429: true, retryAfter: 50 } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    ok(r && r.ok === false && r.reason === "limit" && r.failed.length === 1 && r.failed[0].label === "level in events-owner" && r.failed[0].error === "M_LIMIT_EXCEEDED",
      "B: a channel that stays 429 ends the change at the limit, naming the step and its error", r);
    // THE OWNER'S NUMBER, written here: "a 1-minute limit per change". Read from the block's own constant, a limit raised
    // to ten minutes would move this row's expectation with it and stay green.
    const MINUTE = 60000;
    // CHANGED ON PURPOSE AT `ddjp_692` (the owner's plan: the one send pacer, at least a second between sends and wider after a
    // push-back): a wait that runs past the minute is cut AT the minute in real time, and this virtual clock counts the whole
    // wait — so the change ends within the longest single wait the block can take, the server's 50 ms or the pacer's widest
    // gap, plus one read-back poll. Before, that wait was the server's alone.
    const longest = Math.max(50, w.PACE_MAX_MS || 0);
    ok(w.RANK_LIMIT_MS === MINUTE && w.clock.t >= MINUTE && w.clock.t < MINUTE + longest + w.RANK_POLL_MS + 1, "B: at the minute", { limit: w.RANK_LIMIT_MS, t: w.clock.t, longest });
    ok(success(w).length === 0 && notConfirmed(w).length === 1 && /level in events-owner \(M_LIMIT_EXCEEDED\)/.test(notConfirmed(w)[0][1]), "B: no success line — the warning names the step", w.logs);
    const n = w.sends["!eo:hs"]; await turns(30);
    ok(w.clock.cut === null && w.sends["!eo:hs"] === n, "B: and nothing is left scheduled — the background retry is gone (J129); Try again is the same change again", { cut: !!w.clock.cut }); }
  // C
  { const w = world({ "!cu:hs": { forbidden: true } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    ok(w.sends["!cu:hs"] === 1 && r && r.ok === false && r.reason === "refused" && r.failed.length === 1 && r.failed[0].label === "level in chat-uncategorized" && success(w).length === 0,
      "C: a 403 is sent once, not again, and named — the change ends refused", { sends: w.sends, r });
    ok(w.clock.t < w.RANK_LIMIT_MS, "C: at once, not at the minute", w.clock.t); }
  // D
  { const w = world({ "!eo:hs": { always429: true, retryAfter: 5000 } });
    const p = w.assignRank("!space:hs", CH, "@bot:hs", 99);
    await turns(20);
    const n = Object.values(w.sends).reduce((a, b) => a + b, 0);
    const stopped = w.stopRankChange();
    const r = await p;
    ok(stopped === true && r && r.ok === false && r.reason === "stopped" && Object.values(w.sends).reduce((a, b) => a + b, 0) === n,
      "D: a stop ends the change at once — stopped, and nothing more sent", { stopped, r });
    ok(w.stopRankChange() === false, "D: and with none running a stop has nothing to stop"); }
  // E
  { const w = world({ "in:!eu:hs": { lost: true } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    const expect = Math.floor(w.RANK_LIMIT_MS / w.RANK_RESEND_MS);
    ok(r && r.ok === false && r.reason === "limit" && r.failed.length === 1 && r.failed[0].label === "invite to events-uncategorized",
      "E: an invite accepted but never shown is not taken as landed — named at the minute", r);
    ok(w.sends["in:!eu:hs"] >= expect - 1 && w.sends["in:!eu:hs"] <= expect + 1, "E: it was sent again every RANK_RESEND_MS while unseen (about " + expect + " times)", w.sends["in:!eu:hs"]); }
  if (failed) { console.log("[assign-rank-retry] " + failed + " failure(s)"); process.exit(1); }
  console.log("[assign-rank-retry] PASS — assignRank reports success only when every step is confirmed by reading it back: 429s on levels and invites are retried honouring retry_after_ms, a step that never lands ends the change at the minute with the step named and nothing left scheduled, a 403 is named at once, a stop ends it, and a send never shown is sent again and named (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[assign-rank-retry] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
