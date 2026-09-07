// tests/check-write-channel.js
//
// WRITE-CHANNEL CORRECTNESS. A client must always emit on the HIGHEST channel it is allowed to
// write to — for BOTH kinds — and must switch the instant its rights change:
//
//   • events_*      — where protocol events go. This also IS the client's channel-origin rank,
//                     the unforgeable rank proof every trust decision reads.
//   • checkpoints_* — where its checkpoints go. Everyone may seal a personal checkpoint; what a
//                     checkpoint is WORTH to others is decided by the trust cascade at ingest,
//                     never by hardcoding which channel checkpoints may come from.
//
// Both must be chosen by the same live power-level rule, and both must be re-bound on a rank
// change rather than at the next room entry — otherwise a promoted user keeps writing to a lower
// channel and under-states their own rank, and a demoted user keeps writing where they no longer
// belong until the send is rejected.
//
// MatrixBridge can't be loaded headlessly (it needs the Matrix SDK + a live client), so this is a
// STATIC guard over the source — the same approach check-trust-policy uses for its anti-erosion
// checks. It pins the STRUCTURE that makes the behaviour correct.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let checks = 0;
function ok(c, m) { assert.ok(c, m); checks++; }

function code(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");   // scan CODE, not prose
}
const mb = code("backends/backend1/matrixbridge.js");
const room = code("features/room.js");

// ── (a) ONE chooser, parameterised by kind — so the two can never drift apart ──
ok(/function _bestWritable\s*\(\s*channels\s*,\s*prefix\s*\)/.test(mb),
  "there is a single highest-writable chooser taking the channel KIND as a parameter");
ok(/_bestWritable\(channels,\s*"events_"\)/.test(mb),
  "the events write channel comes from that shared chooser");
ok(/_bestWritable\(channels,\s*"checkpoints_"\)/.test(mb),
  "the checkpoints write channel comes from the SAME shared chooser");

// the chooser must actually test writability against live power levels, not just pick by name
ok(/myLevel\s*>=\s*sendLevel/.test(mb),
  "the chooser only picks a channel we can actually send to (live power levels)");
ok(/rank\s*>\s*best\.rank/.test(mb),
  "the chooser keeps the HIGHEST writable channel, not the first one found");

// ── (b) checkpoints are NOT hardcoded to the owner channel any more ──
const wireBody = mb.slice(mb.indexOf("function wireCheckpoints"), mb.indexOf("function wireCheckpoints") + 900);
ok(!/checkpoints_owner/.test(wireBody),
  "wireCheckpoints no longer hardcodes the owner checkpoints channel");
ok(/getCheckpointChannelId\(channels\)/.test(wireBody),
  "wireCheckpoints binds the highest available checkpoints channel");
ok(!/[><]=?\s*100\b/.test(wireBody),
  "wireCheckpoints inlines no bare rank-100 literal (the owner test routes through the trust seam)");
ok(/TrustPolicy\.tierOf/.test(wireBody),
  "the owner check bins through TrustPolicy.tierOf");
ok(/const sendFn = cpCh \?/.test(wireBody),
  "anyone with a writable checkpoints channel can seal (a personal checkpoint bounds own storage)");

// ── (c) BOTH re-point on a rank change, not at the next room entry ──
const rewire = room.slice(room.indexOf("function _rewireWriteChannel"));
const rewireBody = rewire.slice(0, rewire.indexOf("\n  }\n") + 4);
ok(/MatrixBridge\.getWriteChannelId\(ch\)/.test(rewireBody),
  "the rank-change path re-points protocol writes at the new highest events channel");
ok(/MatrixBridge\.wireCheckpoints\(ch\)/.test(rewireBody),
  "the rank-change path ALSO re-binds checkpoints (the gap this guard exists to prevent)");
ok(/MatrixBridge\.onRankChange\(_rewireWriteChannel\)/.test(room),
  "the re-point runs on the rank-change hook, so the switch is immediate");

console.log("[write-channel] PASS — one shared chooser picks the HIGHEST channel we can actually write to for both kinds (events and checkpoints); checkpoints are no longer pinned to the owner channel and no bare rank literal gates them; and a rank change re-points BOTH immediately via the onRankChange hook (" + checks + " assertions)");
process.exit(0);
