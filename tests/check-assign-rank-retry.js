// tests/check-assign-rank-retry.js
// SUBJECT: backends/backend1/matrixbridge.js
// WALL: assignRank REPORTS SUCCESS ONLY WHEN EVERY CHANNEL'S POWER LEVEL IS CONFIRMED (owner's live test on `ddjp_545`: a 429
//   on one channel was logged, then "all channels reconciled" — the bot ended split, space level 99 but writing as rank 80).
//   Driven with the shipped assignRank block (its retry state and helpers) against a scripted client.
//   PART A — a 429 retried, honouring retry_after_ms, then confirmed: one success line, no partial.
//   PART B — a channel that stays 429: a partial result naming it, no success line, retried in the background until confirmed.
//   PART C — a 403 is not retried in the loop; it is reported.     PART D — a newer assignment supersedes the background retry.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[assign-rank-retry] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const fnSrc = (name) => { const m = MB.match(new RegExp("\\n  (async )?function " + name + "\\(")); if (!m) return ""; const i = m.index + 1; return MB.slice(i, MB.indexOf("\n  }\n", i) + 4); };
const BLOCK = (() => { const a = MB.indexOf("  const RANK_PL_RETRY_MS = "), b = MB.indexOf("\n  }\n", MB.indexOf("  async function assignRank(spaceId, channels, userId, level) {")); return (a >= 0 && b > a) ? MB.slice(a, b + 4) : ""; })();
const R = loadInContext(["backends/backend1/ranks.js"], {}).Ranks;
const SRC = ["_rankFromKey", "_presenceChatKey", "_desiredMembership"].map(fnSrc).join("") + BLOCK;
const CH = { events_uncategorized: "!eu:hs", chat_uncategorized: "!cu:hs", events_owner: "!eo:hs" };
function world(script) {
  const sends = {}, logs = [], waits = [], later = [];
  const rooms = {};
  const room = (id) => rooms[id] || (rooms[id] = { members: {}, currentState: { getStateEvents: (t) => t === "m.room.power_levels" ? { getContent: () => ({ users: {} }) } : null }, getMember: () => null });
  const err = (code, status, ra) => { const e = new Error(code); e.errcode = code; e.httpStatus = status; if (ra !== undefined) e.data = { errcode: code, retry_after_ms: ra }; return e; };
  const client = { getRoom: room, invite: async () => {}, kick: async () => {},
    sendStateEvent: async (rid) => { sends[rid] = (sends[rid] || 0) + 1; const s = script[rid] || {};
      if (s.forbidden) throw err("M_FORBIDDEN", 403);
      if (s.always429 || (s.fail429 || 0) >= sends[rid]) throw err("M_LIMIT_EXCEEDED", 429, s.retryAfter); } };
  const Logger = { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]), debug() {}, error() {} };
  const api = new Function("client", "Logger", "Ranks", "rankAssignable", "onSleep", "onLater",
    SRC + "\n_rankSleep = (ms) => { onSleep(ms); return Promise.resolve(); };\n_rankLater = (fn, ms) => { onLater(fn, ms); return 1; };\nreturn { assignRank };")(
    client, Logger, R, () => ({ ok: true, missing: [] }), (ms) => waits.push(ms), (fn, ms) => later.push({ fn, ms }));
  return Object.assign({ sends, logs, waits, later, script }, api);
}
const success = (w) => w.logs.filter(([k, m]) => k === "info" && /\(all channels reconciled/.test(m));
const partial = (w) => w.logs.filter(([k, m]) => k === "warn" && /PARTIAL/.test(m));
(async () => {
  ok(BLOCK.indexOf("async function _setLevelIn(") >= 0 && BLOCK.indexOf("async function assignRank(") >= 0, "PREMISE — the shipped assignRank block was found");
  // A
  { const w = world({ "!eo:hs": { fail429: 2, retryAfter: 120 } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    ok(r === undefined || r.ok !== false, "A: a 429 retried and then confirmed is a success", r);
    ok(w.sends["!eo:hs"] === 3 && JSON.stringify(w.waits) === "[120,120]", "A: retried twice, honouring retry_after_ms", { sends: w.sends["!eo:hs"], waits: w.waits });
    ok(success(w).length === 1 && partial(w).length === 0, "A: one success line, no partial", w.logs); }
  // B
  { const w = world({ "!eo:hs": { always429: true, retryAfter: 50 } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    ok(r && r.ok === false && r.partial === true && r.failed.length === 1 && r.failed[0] === "!eo:hs", "B: a channel that stays 429 is a PARTIAL result naming it", r);
    ok(success(w).length === 0 && partial(w).length === 1 && /!eo:hs/.test(partial(w)[0][1]), "B: no success line — the partial names the channel", w.logs);
    ok(w.later.length === 1, "B: and it keeps retrying in the background", w.later.length);
    w.script["!eo:hs"] = {};                       // the limit lifts
    await w.later[0].fn();
    ok(success(w).length === 1 && /after retry/.test(success(w)[0][1]), "B: once confirmed, the background retry reports success", w.logs.slice(-2)); }
  // C
  { const w = world({ "!cu:hs": { forbidden: true } });
    const r = await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    ok(w.sends["!cu:hs"] === 1 && w.waits.length === 0 && r && r.partial === true && success(w).length === 0, "C: a 403 is tried once, not retried in the loop, and reported as partial", { sends: w.sends, r }); }
  // D
  { const w = world({ "!eo:hs": { always429: true, retryAfter: 10 } });
    await w.assignRank("!space:hs", CH, "@bot:hs", 99);
    w.script["!eo:hs"] = {};
    await w.assignRank("!space:hs", CH, "@bot:hs", 60);   // a newer assignment for the same person
    const before = w.sends["!eo:hs"]; await w.later[0].fn();
    ok(w.sends["!eo:hs"] === before, "D: a newer assignment supersedes the older one's background retry", { before, after: w.sends["!eo:hs"] }); }
  if (failed) { console.log("[assign-rank-retry] " + failed + " failure(s)"); process.exit(1); }
  console.log("[assign-rank-retry] PASS — assignRank reports success only when every channel is confirmed: 429s are retried honouring retry_after_ms, a partial result names its channels and keeps retrying, and a newer assignment supersedes (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[assign-rank-retry] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
