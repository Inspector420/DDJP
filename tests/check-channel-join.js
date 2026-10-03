// tests/check-channel-join.js
// SUBJECT: backends/backend1/matrixbridge.js
// WALL: JOINING A ROOM JOINS EVERY CHANNEL, RETRYING, AND SAYS SO IF IT CANNOT (owner's test, `ddjp_534`). Each channel was
//   joined once with any failure swallowed: the bot started at rank 0 with chat tiers missing, and a user had to join
//   events-owner by hand. Driven through the bridge's real `joinDDJPSpace` and `_joinChildren` (from the shipped file)
//   against a stubbed client: PART A — a channel that fails twice, then succeeds, ends up joined, with no warning;
//   PART B — a channel that never joins is NAMED in the log; PART C — a channel advertised later is joined as it arrives.
"use strict";
const fs = require("fs"), path = require("path");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[channel-join] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const cut = (a, b) => { const i = MB.indexOf(a), j = MB.indexOf(b, i); return (i >= 0 && j > i) ? MB.slice(i, j) : ""; };
const SRC = cut("  const JOIN_RETRY_MS = ", "  // --- Invite ---");
function world(failTimes, advertiseLater) {
  const joined = new Set(), tries = {}, logs = [];
  const children = ["!events:hs", "!chat:hs", "!settings:hs"];
  let rounds = 0;
  const room = (id) => id === "!space:hs" ? { currentState: { getStateEvents: () => (rounds >= 1 || !advertiseLater ? children.concat(advertiseLater ? ["!late:hs"] : []) : children).map((k) => ({ getStateKey: () => k })) } }
    : { getMyMembership: () => joined.has(id) ? "join" : "invite" };
  const client = { getRoom: room, joinRoom: async (id) => { tries[id] = (tries[id] || 0) + 1; if (id === "!space:hs") return; if ((failTimes[id] || 0) >= tries[id]) { const e = new Error("rate limited"); e.errcode = "M_LIMIT_EXCEEDED"; throw e; } joined.add(id); } };
  const Logger = { info: (m) => logs.push(["info", m]), warn: (m) => logs.push(["warn", m]), debug() {}, error() {} };
  const make = new Function("client", "Logger", "waitForSpaceChildren", "setTimeout", "onSleep", SRC + "\n_joinSleep = () => { onSleep(); return Promise.resolve(); };\nreturn { join: joinDDJPSpace, advertised: _joinAdvertised };");
  const api = make(client, Logger, async () => true, setTimeout, () => { rounds++; });
  return { join: api.join, advertised: api.advertised, joined, tries, logs };
}
(async () => {
  ok(SRC.indexOf("async function joinDDJPSpace") >= 0 && SRC.indexOf("_joinChildren") >= 0, "PREMISE — the shipped join and its retry were found");
  { const w = world({ "!chat:hs": 2 }); await w.join("!space:hs");
    ok(w.joined.has("!chat:hs") && w.tries["!chat:hs"] === 3, "A: a channel that fails twice is retried and joined", w.tries);
    ok(!w.logs.some((l) => l[0] === "warn"), "A: and nothing is warned when every channel ends up joined", w.logs); }
  { const w = world({ "!events:hs": 99 }); await w.join("!space:hs");
    const warn = w.logs.find((l) => l[0] === "warn");
    ok(!w.joined.has("!events:hs") && !!warn && /!events:hs/.test(warn[1]) && /M_LIMIT_EXCEEDED/.test(warn[1]), "B: a channel that never joins is named in the log, with its last error", w.logs); }
  // C — a channel the space advertises AFTER the first pass (J78): the live m.space.child handler joins it, retrying.
  { const w = world({ "!late:hs": 1 }); await w.join("!space:hs"); await w.advertised("!late:hs");
    ok(w.joined.has("!late:hs") && w.tries["!late:hs"] === 2, "C: a channel advertised later is joined as it arrives, retried", w.tries); }
  { const w = world({ "!late:hs": 99 }); await w.join("!space:hs"); await w.advertised("!late:hs");
    const warn = w.logs.find((l) => l[0] === "warn" && /!late:hs/.test(l[1]));
    ok(!w.joined.has("!late:hs") && !!warn, "C: and one that never joins is named in the log", w.logs); }
  ok(/if \(childId && content && Array\.isArray\(content\.via\) && content\.via\.length > 0\) \{\s*try \{ _joinAdvertised\(childId\); \}/.test(MB),
    "C: the bridge's live m.space.child handler joins what the space advertises");
})().then(() => {
  if (failed) { console.log("[channel-join] " + failed + " failure(s)"); process.exit(1); }
  console.log("[channel-join] PASS — joining a room joins every channel, retrying with backoff, re-reading the advertised channels, and names any it still cannot join (" + asserts + " assertions)");
}, (e) => { console.log("[channel-join] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
