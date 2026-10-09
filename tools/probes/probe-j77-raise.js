// tools/probes/probe-j77-raise.js
// SUBJECT: J77, before the raise — how often a busy bot room would send a batch of MORE than ten if maxPerMessage were 20.
// MEASUREMENT ONLY: the real B2Authority on an injected clock, at the SHIPPED maxPerMessage (20 since J77, `ddjp_534`;
// it was raised in the sandbox before). Votes are random, so each spread runs TRIALS times and reports the range — a
// single run said "never" at 10 s where another gives a few songs (corrected at the `ddjp_533` audit). Busy rate as in probe-j73-judge-cost: 15 songs an hour; per song a play, 12 votes, a re-add.
// Votes arrive in a burst after each play (spread over `spreadMs`), which is what makes groups large.
//   node tools/probes/probe-j77-raise.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
  "backends/backend2/streammanager.js", "backends/backend2/authority.js"];
const TRIALS = 5;
for (const spreadMs of [3000, 10000, 30000]) { const overs = []; let largest = 0; let msgs = 0;
 for (let trial = 0; trial < TRIALS; trial++) {
  const sb = loadInContext(FILES, {}), A = sb.B2Authority, w = { t: 1e9, out: [] };
  A.reset();
  A.attach((type, payload) => { w.out.push(type === "ddjp.batch" ? payload.evs.length : 1); return Promise.resolve({ eventId: "$m" + w.out.length }); }, { now: () => w.t });
  const SONGS = 60, SONG_MS = 240000, events = [];
  for (let s = 0; s < SONGS; s++) {
    const at = s * SONG_MS;
    events.push([at, "ddjp.dj.play", "@bot:hs", { p: "$p" + s }]);
    for (let v = 0; v < 12; v++) events.push([at + 500 + Math.random() * spreadMs, "ddjp.dj.vote", "@v" + v + ":hs", { p: "$p" + s, dv: 1 }]);
    events.push([at + 2000 + Math.random() * 60000, "ddjp.dj.join", "@dj" + (s % 8) + ":hs", { v: "v" + String(s).padStart(10, "0") }]);
  }
  events.sort((a, b) => a[0] - b[0]);
  const start = w.t; let k = 0;
  for (let t = 0; t <= SONGS * SONG_MS; t += 100) {          // the gate asked every 100 ms (generous triggers)
    w.t = start + t;
    while (k < events.length && events[k][0] <= t) { const e = events[k++]; A.submit(A.stamp(Object.assign({ t: e[1] }, e[3]), e[2], 10, "$s" + k, null)); }
    A.openIfDue();
  }
  overs.push(w.out.filter((n) => n > 10).length); largest = Math.max(largest, ...w.out); msgs += w.out.length;
 }
  console.log("votes spread over " + (spreadMs / 1000) + " s (maxPerMessage " + loadInContext(FILES, {}).B2Authority.POLICY.maxPerMessage + "): songs with MORE than ten members per 60, over " + TRIALS +
    " runs: " + overs.join(", ") + " (" + (100 * Math.min(...overs) / 60).toFixed(0) + "–" + (100 * Math.max(...overs) / 60).toFixed(0) + "%); largest " + largest + "; ~" + Math.round(msgs / TRIALS) + " messages a run");
}
console.log("MEASURED");
