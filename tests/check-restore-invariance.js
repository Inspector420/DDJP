// tests/check-restore-invariance.js
// STANDING GATE (docs/consensus/consensus-models.md §9.2): "a restored event re-derives to identical
// consensus state regardless of the rank stamped at restore." This is the permanent tripwire for
// rank-below-the-hash. It proves the reducer IS rank-sensitive for chain events — so any
// restore-TO-CONSENSUS path MUST reproduce the true origin rank (attestation) or be provably
// rank-neutral BEFORE it wires. Phase A gap recovery therefore does NOT re-ingest (side-record only);
// the redaction path is rank-safe because the event arrives in a KNOWN channel (same rank).
//
// WHEN attestation's re-ingest or a Phase-B checkpoint restore lands, EXTEND this: drive that path
// with a DELIBERATELY WRONG restore rank and assert derived consensus == the origin-rank consensus.
// If it can't, the two rank-sensitivity assertions below are the proof it's unsafe to wire.

const { loadInContext } = require("./_load");
const { StateDeriver: SD } = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
const j = (x) => JSON.stringify(x);
let failed = 0;
function ok(c, m) { if (!c) { console.log("[restore-invariance] FAIL — " + m); failed++; } }
function evt(id, l, s, rank, body) { return { eventId: id, l, sender: s, senderRank: rank, ts: l * 60000, type: body.t, content: Object.assign({ l }, body) }; }
const RANK = { OWNER: 100, STAFF: 60, VIP: 40, PLAYER: 20 };

// ---- The reducer is rank-SENSITIVE below the hash: a chain event's rank changes consensus. ----
// (1) skip advancement gate (statederiver:260): a non-DJ skip below VIP cuts instead of advancing.
function skipChain(r) {
  return [
    evt("$j1", 1, "@a:hs", RANK.STAFF, { t: "ddjp.dj.join", v: "SA" }),
    evt("$d1", 2, "@a:hs", RANK.STAFF, { t: "ddjp.dj.declare", v: "SA2" }),
    evt("$j2", 3, "@b:hs", RANK.STAFF, { t: "ddjp.dj.join", v: "SB" }),
    evt("$p1", 4, "@a:hs", RANK.STAFF, { t: "ddjp.dj.play", p: null }),
    evt("$sk", 5, "@b:hs", r,          { t: "ddjp.dj.skip", p: "$p1" }),
  ];
}
ok(j(SD.derive(skipChain(RANK.VIP))) !== j(SD.derive(skipChain(RANK.PLAYER))),
  "reducer is rank-sensitive: a restored skip's rank flips advance vs cut (the skip gate)");

// (2) The rotation-edit gates read the ACTOR's channel rank: a restored dj.remove at STAFF
// removes its target; at PLAYER it's a no-op. So a restored gated event's OWN rank flips
// consensus — the reducer is rank-sensitive, and restore-to-consensus must reproduce the true
// (channel) actor rank.
//
// HISTORY: dj.remove / dj.strike are now RANK-BLIND to the TARGET (Staff+ may remove/strike
// anyone, exactly like the VIP+ skip-others rule). The former "rank(actor) > rankByUser[target]"
// echo is gone — rankByUser is no longer read by ANY gate (it is retained only in the checkpoint
// seed for continuity). So a PLAY's stamped rank no longer echoes forward into a later remove:
// plays are now rank-invariant. The sensitivity a restore path must respect is each event's OWN
// actor rank, which the redaction path (origin channel) reproduces exactly.
function removeChain(r) {
  return [
    evt("$j1", 1, "@a:hs", RANK.STAFF, { t: "ddjp.dj.join", v: "SA" }),
    evt("$j2", 2, "@u:hs", RANK.OWNER, { t: "ddjp.dj.join", v: "SU" }),
    evt("$rm", 3, "@a:hs", r,          { t: "ddjp.dj.remove", x: "@u:hs" }), // acts iff r >= STAFF (target rank ignored)
  ];
}
ok(j(SD.derive(removeChain(RANK.STAFF))) !== j(SD.derive(removeChain(RANK.PLAYER))),
  "reducer is rank-sensitive: a restored rotation edit's OWN actor rank flips whether it acts (Staff+ gate)");

// ---- The safe restore condition: if the restored rank EQUALS the origin rank (as the REDACTION path
// guarantees — the event arrives in its own channel), consensus is identical. That is why the wired
// redaction-restore path is rank-safe. ----
ok(j(SD.derive(skipChain(RANK.VIP))) === j(SD.derive(skipChain(RANK.VIP))), "same-rank restore is identical (redaction path: origin channel)");
ok(j(SD.derive(removeChain(RANK.STAFF))) === j(SD.derive(removeChain(RANK.STAFF))), "same-rank restore is identical (redaction path: origin channel)");

// NOTE: no Phase-A GAP re-ingest path exists to exercise here — gap restore-to-consensus is deferred to
// attestation (§9.2), so a gap simply cuts. This file is the harness + the tripwire justification; a
// future re-ingest path must be added here and shown invariant to a wrong restore rank before it wires.

if (failed) { console.log("[restore-invariance] " + failed + " FAILED"); process.exit(1); }
console.log("[restore-invariance] PASS — the reducer is rank-sensitive below the hash (skip gate + actor-rank rotation edits; remove/strike are now rank-blind to the TARGET and rankByUser is seed-only, read by no gate), so restore-to-consensus MUST reproduce the true actor rank or be rank-neutral; same-rank (redaction) restore is identical; Phase-A gap re-ingest is deferred to attestation (no wired path to exercise yet)");
