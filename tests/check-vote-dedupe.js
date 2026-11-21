// tests/check-vote-dedupe.js
// SUBJECT: backends/backend2/authority.js
// WALL: THE BOT DROPS, IN SILENCE, A VOTE OR SAVE THE SAME PERSON HAS ALREADY CAST FOR THAT EXACT PLAY (owner's re-test,
//   `ddjp_535`, a backstop for re-sent presses). Driven through the real judge (`B2Authority.evaluate`) over a real held log.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[vote-dedupe] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const FILES = ["core/logger.js","backends/backend1/ranks.js","backends/backend1/consensushash.js","backends/backend1/trustpolicy.js","backends/backend1/statederiver.js","backends/backend1/capabilities.js","backends/backend1/activity.js","backends/backend1/checkpointformat.js","backends/backend1/session.js","backends/backend1/floor.js","backends/backend1/streammanager.js","backends/backend2/checkpoint.js","backends/backend2/streammanager.js","backends/backend2/authority.js"];
const sb = loadInContext(FILES, {}); const B1 = sb.B1StreamManager, A = sb.B2Authority, P = F.RANK.player, O = F.RANK.owner;
B1.reset(); A.reset();
[F.reducerEvent("$s", 1, 1000, "@o:hs", O, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
 F.reducerEvent("$j", 2, 2000, "@d:hs", P, { t: "ddjp.dj.join", v: "vidAAAAAAAA" }), F.reducerEvent("$p1", 3, 3000, "@d:hs", P, { t: "ddjp.dj.play", p: null }),
 F.reducerEvent("$v1", 4, 4000, "@me:hs", P, { t: "ddjp.dj.vote", p: "$p1" }), F.reducerEvent("$sv", 5, 5000, "@me:hs", P, { t: "ddjp.dj.save", p: "$p1" })].forEach((e) => B1.ingest(F.toRaw(e)));
const judge = (t, actor, p) => A.evaluate({ t: t, p: p, actor: actor }, B1.getState(), P, { log: B1.getLog(), seed: undefined });
for (const t of ["ddjp.dj.vote", "ddjp.dj.save"]) {
  const v = judge(t, "@me:hs", "$p1");
  ok(v.ok === false && v.silent === true && v.code === "duplicate", t + ": a second one from the same person for the same play is dropped in silence", v);
  ok(judge(t, "@other:hs", "$p1").code !== "duplicate", t + " CONTROL: another person's is not a duplicate");
}
// committed but not yet echoed
A.submit(A.stamp({ t: "ddjp.dj.vote", p: "$p1" }, "@late:hs", P, "$i9", null));
const c = judge("ddjp.dj.vote", "@late:hs", "$p1");
ok(c.ok === false && c.code === "duplicate", "a vote committed and not yet echoed counts too — the second is dropped", c);
if (failed) { console.log("[vote-dedupe] " + failed + " failure(s)"); process.exit(1); }
console.log("[vote-dedupe] PASS — the bot drops, in silence, a vote or save the same person already cast for that play, held or committed (" + asserts + " assertions)");
