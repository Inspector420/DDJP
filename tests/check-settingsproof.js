// tests/check-settingsproof.js
// WALL: THE RULES AT A MOMENT ARE PROVABLE, AND "I CANNOT TELL" IS A REAL ANSWER.
//
// The old tree answered ONE of the two questions:
//   A. does this settings event produce the values we claim?      -> answered
//   B. was that the RIGHT event, or did a newer one supersede it? -> ANSWERED BY NOTHING
// B is the hard one, because answering it needs certainty that every settings change up to that
// point has been seen. One missing event and you give a confident wrong answer.
//
// PART A — question A, three-way, through the reducer's OWN merge.
// PART B — question B: which event governed a moment. THE NEW ONE.
// PART C — an incomplete reading refuses to answer rather than guessing defaults.
// PART D — a superseded pointer is caught. This is what nothing could detect before.
// PART E — a room on defaults is checkable with no reading at all.
// PART F — only OWNER-origin events count, by channel rather than by body.
// PART G — detect, do not enforce: a mismatch records and changes nothing but the forget licence.
// PART H — values are recomputed by folding, so a partial later write does not erase earlier ones.
// PART I — THE POINTER NAMES AN EVENT THAT REPRODUCES THE ROOM. The reducer's own comment beside
//          `settingsFrom` states this invariant — "the pointer always names an event the reducer
//          actually honoured" — three lines above the line that breaks it. Passing the RANK gate
//          is not the same as being honoured: a blob whose every value the merge refuses moves the
//          pointer anyway. Driven end to end here (reducer -> seed -> proveClaim) rather than
//          asserted about either module alone, because each is individually correct and it is the
//          seam between them that fails.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");

function fail(m, g) { console.log("[settingsproof] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/settingsproof.js",
  ], {});
}
const OWNER = F.RANK.owner, STAFF = F.RANK.staff;

function sev(id, l, blob, rank) {
  return F.reducerEvent(id, l, 1000 + l, "@own:hs", (typeof rank === "number") ? rank : OWNER,
    Object.assign({ t: "ddjp.room.settings" }, { s: blob }));
}
function full(over) {
  const sb0 = tree();
  return Object.assign(sb0.StateDeriver.defaultSettings(), over || {});
}

// ── PART A — question A, three-way ───────────────────────────────────────────────────────────
{
  const sb = tree();
  const blob = full({ maxLen: 400 });
  const produced = sb.StateDeriver.applySettingsEvent(sb.StateDeriver.defaultSettings(), blob);
  ok(sb.SettingsProof.checkClaim(produced, blob).verdict === "match",
    "A: the named event reproducing the claim is a MATCH");
  ok(sb.SettingsProof.checkClaim(Object.assign({}, produced, { maxLen: 999 }), blob).verdict === "mismatch",
    "A: a claim the event does not produce is a MISMATCH");
  ok(sb.SettingsProof.checkClaim(produced, { maxLen: 400 }).verdict === "unverifiable",
    "A: APPLIED — a PARTIAL write settles nothing. Verification recomputes from defaults, so a "
    + "partial event cannot substantiate a full claim even when nothing is wrong. Collapsing that "
    + "into 'fine' licenses forgetting on no evidence; into 'tampered' accuses an honest room");
}

// ── PART B — question B: which event governed a moment ───────────────────────────────────────
{
  const sb = tree();
  sb.SettingsProof.ingest([
    sev("$s1", 10, full({ maxLen: 300 })),
    sev("$s2", 20, full({ maxLen: 400 })),
    sev("$s3", 30, full({ maxLen: 500 })),
  ]);
  sb.SettingsProof.markGenesisReached();

  ok(sb.SettingsProof.inForceAt(5, "$x").eventId === null,
    "B: before any settings event, the room was on DEFAULTS — and that is a known answer, not an "
    + "unknown one");
  ok(sb.SettingsProof.inForceAt(15, "$x").eventId === "$s1", "B: between the first and second, the first governs");
  ok(sb.SettingsProof.inForceAt(25, "$x").eventId === "$s2", "B: and so on");
  ok(sb.SettingsProof.inForceAt(999, "$x").eventId === "$s3", "B: after the last, the last still governs");
  ok(sb.SettingsProof.inForceAt(20, "$s2").eventId === "$s2",
    "B: APPLIED — an event governs its OWN position. The reducer judges at log position, so the "
    + "boundary has to be inclusive or the two disagree by one event");
}

// ── PART C — an incomplete reading refuses to answer ─────────────────────────────────────────
{
  const sb = tree();
  sb.SettingsProof.ingest([sev("$s2", 20, full({ maxLen: 400 }))]);   // NOT read to the beginning
  const r = sb.SettingsProof.inForceAt(25, "$x");
  ok(r.known === false && r.reason === "incomplete-reading",
    "C: APPLIED — having read only part of the channel, it REFUSES. There may be an earlier change "
    + "we have not seen, and answering anyway is the confident wrong answer this module exists to "
    + "prevent", r);
  ok(r.coverage && r.coverage.reachedGenesis === false,
    "C: and it reports why, so the caller can go and read more rather than guess", r.coverage);

  // THE FLOOR CLOSES THE GAP ONLY IF IT CAN SUPPLY THE ANSWER. An earlier version of this rule
  // treated any floor below the reading window as sufficient — true for the VALUES, since the seed
  // carries them, and FALSE for "which event governed", which may be an event below the window
  // that we never read. It answered "defaults", a confident falsehood rather than an unknown.
  const withFloorButNoPointer = sb.SettingsProof.inForceAt(25, "$x", 19);
  ok(withFloorButNoPointer.known === false,
    "C: APPLIED — a floor alone does NOT close the gap. Without knowing what the floor NAMES, the "
    + "governing event may be one we never read, and answering 'defaults' would be a falsehood "
    + "rather than an unknown", withFloorButNoPointer);

  const withPointer = sb.SettingsProof.inForceAt(25, "$x", 19, "$s0");
  ok(withPointer.known === true && withPointer.eventId === "$s2",
    "C: APPLIED — with the floor's pointer supplied it can answer, and the answer is the event we "
    + "actually read above the floor", withPointer);

  // ...and "I read the range and found nothing" must be sayable, or a room that simply has not
  // changed its settings lately can never answer. Coverage is a claim about the range EXAMINED,
  // not about what happened to be in it.
  const empty = tree();
  empty.SettingsProof.markReadFrom(20);
  const fromFloor = empty.SettingsProof.inForceAt(25, "$x", 19, "$sFloor");
  ok(fromFloor.known === true && fromFloor.eventId === "$sFloor" && fromFloor.fromFloor === true,
    "C: APPLIED — having examined the range above the floor and found no changes, the governing "
    + "event is the one the FLOOR names. Inferring coverage from what was FOUND rather than what "
    + "was LOOKED AT made the ordinary case — a room that rarely changes settings — permanently "
    + "unanswerable", fromFloor);
}

// ── PART D — a superseded pointer is caught ──────────────────────────────────────────────────
{
  const sb = tree();
  const s1 = sev("$s1", 10, full({ maxLen: 300 }));
  const s2 = sev("$s2", 20, full({ maxLen: 400 }));
  sb.SettingsProof.ingest([s1, s2]);
  sb.SettingsProof.markGenesisReached();

  const claimedFrom1 = sb.StateDeriver.applySettingsEvent(sb.StateDeriver.defaultSettings(), s1.content.s);
  const v = sb.SettingsProof.proveClaim({ claimed: claimedFrom1, settingsFrom: "$s1", atL: 25 });
  ok(v.status === "mismatched" && v.reason === "named-event-was-superseded",
    "D: APPLIED — the claim names a REAL event that reproduces its values exactly, so question A "
    + "passes. It is still wrong, because a newer change had already landed by that moment. This is "
    + "the case nothing in the old tree could detect", v);
  ok(v.detail && v.detail.governing === "$s2",
    "D: APPLIED — and it names which event actually governed, so the mismatch is diagnosable", v.detail);

  const good = sb.SettingsProof.proveClaim({ claimed: claimedFrom1, settingsFrom: "$s1", atL: 15 });
  ok(good.status === "validated",
    "D: the control — the same claim at a moment where that event really did govern", good);
}

// ── PART E — a claim with no event behind it proves nothing ──────────────────────────────────
// This REVERSES the rule that stood here, and the old rule was not silly, so here is why it went.
// It validated a claim that named no settings event by comparing it against the reducer's built-in
// defaults — cheap, needing no reading at all, and correct as long as every client agreed what
// "default" meant. That agreement is CODE, not data: it is the single assertion in this system
// checked against the application rather than against the log. Two builds with different defaults
// would each validate their own idea and neither would report anything, which is the silent
// divergence this project is built to refuse. Every room now states its rules as an event at
// creation (features/room.js), so naming nothing is no longer the common case — it is a claim with
// no evidence, and the honest verdict is that it cannot be checked.
{
  const sb = tree();
  const v = sb.SettingsProof.proveClaim({ claimed: sb.StateDeriver.defaultSettings(), settingsFrom: null, atL: 5 });
  ok(v.status === "unverifiable",
    "E: a claim naming NO settings event is unverifiable — even when the values happen to equal "
    + "the built-in defaults. Matching code is not evidence; only the log is", v);
  const bad = sb.SettingsProof.proveClaim({ claimed: full({ maxLen: 999 }), settingsFrom: null, atL: 5 });
  ok(bad.status === "unverifiable",
    "E: APPLIED — and claiming NON-defaults while naming no event is the SAME verdict. The old rule "
    + "split these into validated/mismatched, which meant the defaults comparison was deciding "
    + "something. It decides nothing now, because it is gone", bad);
  ok(sb.SettingsProof.licensesForget() === false,
    "E: APPLIED — and the consequence that matters is the FORGET LICENCE being withheld. Dropping "
    + "history on an unverifiable claim is exactly the loop where forgetting destroys the evidence "
    + "for the check that licensed it");
  ok(typeof sb.StateDeriver.settingsAreDefaults === "undefined",
    "E: APPLIED — the helper is DELETED, not merely unused. A code-defaults comparison left "
    + "exported is a loaded gun for the next caller who reaches for the cheap answer");
}

// ── PART F — owner origin only, by channel ───────────────────────────────────────────────────
{
  const sb = tree();
  sb.SettingsProof.ingest([
    sev("$real", 10, full({ maxLen: 300 }), OWNER),
    sev("$forged", 15, full({ maxLen: 999 }), STAFF),    // same shape, lower channel
  ]);
  sb.SettingsProof.markGenesisReached();
  ok(sb.SettingsProof.known().length === 1 && sb.SettingsProof.known()[0].id === "$real",
    "F: APPLIED — a settings event from a lower channel is not a settings event. Rank is the "
    + "channel it arrived on, never a claim in the body, and the reducer ignores it too",
    sb.SettingsProof.known().map((e) => e.id));
  ok(sb.SettingsProof.inForceAt(20, "$x").eventId === "$real",
    "F: APPLIED — so the forged one cannot supersede the real one either");
}

// ── PART G — detect, do not enforce ──────────────────────────────────────────────────────────
{
  const sb = tree();
  sb.SettingsProof.ingest([sev("$s1", 10, full({ maxLen: 300 }))]);
  sb.SettingsProof.markGenesisReached();
  sb.SettingsProof.proveClaim({ claimed: full({ maxLen: 999 }), settingsFrom: "$s1", atL: 15 });
  ok(sb.SettingsProof.verdict().status === "mismatched", "G: the mismatch is recorded");
  ok(sb.SettingsProof.licensesForget() === false,
    "G: APPLIED — and what it changes is the FORGET LICENCE, nothing else. It revokes nothing, "
    + "rejects nothing and tells no other module what to do. Two clients must never diverge "
    + "because they disagreed about a settings pointer");
  ok(sb.SettingsProof.known().length === 1,
    "G: APPLIED — the event is still there. Detecting is not deleting");

  const clean = tree();
  clean.SettingsProof.ingest([sev("$s1", 10, full({ maxLen: 300 }))]);
  clean.SettingsProof.markGenesisReached();
  ok(clean.SettingsProof.licensesForget() === false,
    "G: APPLIED — and a check that has not RUN does not license either. Unverified is not "
    + "permission, which is the loop that would otherwise let forgetting justify itself");
}

// ── PART H — values are folded, not taken from one event ─────────────────────────────────────
{
  const sb = tree();
  sb.SettingsProof.ingest([
    sev("$s1", 10, full({ maxLen: 300, minGate: 9000 })),
    sev("$s2", 20, { maxLen: 400 }),                     // a PARTIAL later write
  ]);
  sb.SettingsProof.markGenesisReached();
  const v = sb.SettingsProof.valuesAt(25, "$x");
  ok(v.known === true && v.settings.maxLen === 400,
    "H: the later change applies", v.known && v.settings.maxLen);
  ok(v.settings.minGate === 9000,
    "H: APPLIED — and the earlier field SURVIVES it. The reducer merges field by field, so values "
    + "have to be recomputed by folding every event in order. Reading them off the newest event "
    + "alone would silently reset everything it did not mention", v.settings.minGate);
}


// ══════════════════════════════════════════════════════════════════════════════════
// PART I — settingsFrom NAMES AN EVENT THAT REPRODUCES THE ROOM'S SETTINGS
// ══════════════════════════════════════════════════════════════════════════════════
//
// THE PROPERTY, stated so it can fail:
//
//     the event `settingsFrom` names, replayed from DEFAULTS, produces the room's
//     current settings.
//
// That is exactly what a verifier does — `checkClaim` recomputes
// `applySettingsEvent(defaults, blob)` — so if the property does not hold, the claim is
// unverifiable or mismatched and the forget licence dies at its last link. Stated as the
// property rather than as \"reject an out-of-range blob\" on purpose: it covers whatever
// the NEXT refusal path turns out to be, not the instance that was noticed.
//
// ── HOW THIS FAILS WITHOUT AN ATTACKER ───────────────────────────────────────────
// `applySettingsEvent` validates minGate and vouchJitter AS A PAIR and reverts BOTH
// unless minGate >= LADDER.length * jitter + jitter/2. Each value is individually inside
// its own SETTING_RANGES bound, so the settings panel — which reads those ranges — offers
// both quite legitimately. An owner who lowers minGate while the jitter is high therefore
// sends a complete, in-range, entirely reasonable blob that the reducer merges to NOTHING.
// The room visibly ignores the edit. The pointer moves to it anyway, and forgetting stops.
//
// ── WHY THIS IS NOT THE SAME FAILURE AS THE SEED POLLUTION IT RESEMBLES ──────────
// Worth being explicit, because someone debugging a room that will not forget needs to
// know which of the two they are looking at:
//
//   the seed        clients DISAGREE. Two honest peers compute different fingerprints
//                      for one cut, chainVerifies returns false, no floor is adopted.
//                      Forgetting dies AT THE FLOOR.
//   settingsFrom       clients AGREE. Everyone names the same event, chainVerifies passes,
//                      the floor is adopted. What breaks is the pointer against reality:
//                      SettingsProof reads the named event independently, replays it from
//                      defaults, gets settings the room never had, and records `mismatched`.
//                      Forgetting dies AT THE LICENCE.
//
// Same outcome, different door — and the log line differs, which is the tell.
(() => {
  const c = tree();
  const { StateDeriver, SettingsProof } = c;
  const OWNER = c.Ranks.levelOf("owner");
  const D = StateDeriver.defaultSettings();
  // The panel posts the WHOLE blob every time (check-settings-passthrough pins that), so a
  // realistic scenario is defaults-plus-an-edit rather than a sparse object. A sparse blob is
  // separately unverifiable ("partial-event") and would not reach the property under test.
  const blob = (over) => Object.assign({}, D, over || {});

  function room(writes) {
    const log = [];
    let l = 0;
    for (const [id, over] of writes) {
      log.push(F.reducerEvent(id, ++l, 100000 + l * 1000, "@o:hs", OWNER,
        { t: "ddjp.room.settings", s: blob(over) }));
    }
    return log;
  }

  // Each case: the writes, and what the LAST one is meant to be.
  const CASES = [
    ["a single clean write (control)",
      [["$s1", { maxLen: 300 }]]],
    ["a second clean write on top (control)",
      [["$s1", { maxLen: 300 }], ["$s2", { maxLen: 420 }]]],
    // THE LIVE PATH. $s1 raises the pair together and is accepted. $s2 lowers minGate back to
    // the default while leaving the jitter high — both values in range, the PAIR refused, so the
    // merge changes nothing at all.
    ["lowering minGate while the jitter is high — the pair refuses, nothing merges",
      [["$s1", { minGate: 40000, vouchJitter: 5000 }],
       ["$s2", { minGate: 8000, vouchJitter: 5000 }]]],
    // The blunt instance: one field out of its range, everything else fine.
    ["one field out of range on top of an earlier write",
      [["$s1", { maxLen: 300 }], ["$s2", { maxLen: 99999999 }]]],
  ];

  const offenders = [];
  let compared = 0;
  for (const [note, writes] of CASES) {
    const log = room(writes);
    const seed = StateDeriver.buildSeed(log);
    const lastId = writes[writes.length - 1][0];

    // Drive the real verifier over the real seed.
    const sp = tree().SettingsProof;
    sp.reset();
    sp.ingest(log);
    sp.markGenesisReached();          // this fixture IS the room's whole settings channel
    const v = sp.proveClaim({
      claimed: seed.settings, settingsFrom: seed.settingsFrom,
      atL: log[log.length - 1].l, floorL: -1, floorNames: seed.settingsFrom,
    });
    compared++;

    // FIXTURE CHECK. If a case stopped naming the event it is about, it is no longer testing
    // the seam — and a case whose blob became sparse would fail for "partial-event" instead,
    // which is a different finding wearing the same red.
    ok(seed.settingsFrom !== undefined,
      "PART I fixture: the seed carries no settingsFrom at all for: " + note);

    if (v.status !== "validated") {
      offenders.push(note + "\n        pointer=" + seed.settingsFrom + " (last write " + lastId + ")" +
        "  verdict=" + v.status + " reason=" + v.reason);
    }
  }
  ok(compared === CASES.length, "PART I: not every case was driven", compared);
  ok(offenders.length === 0,
    "PART I: " + offenders.length + " settings write(s) left `settingsFrom` naming an event that " +
    "does NOT reproduce the room's settings, so the forget licence dies at its last link:\n      " +
    offenders.join("\n      "));
})();

console.log("[settingsproof] PASS — the rules at a moment are provable: the claim is recomputed "
  + "through the reducer's OWN merge so a verifier can never be more permissive than the fold it "
  + "checks; WHICH event governed a moment is now answerable at all, and a pointer to a real event "
  + "that a newer change had already superseded is caught — the case nothing could detect before; "
  + "an incomplete reading REFUSES rather than guessing, and a trusted floor is what closes the "
  + "gap; only owner-origin events count, by channel; values are folded so a partial write does "
  + "not erase what came before; and a mismatch is recorded, changing nothing but the forget "
  + "licence. AND the pointer names an event that REPRODUCES the room: a blob the merge refuses "
  + "in whole or in part no longer moves settingsFrom, so an owner lowering minGate while the "
  + "jitter is high — every value in range, the PAIR refused, nothing merged — cannot silently "
  + "end forgetting");
