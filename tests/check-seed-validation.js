// tests/check-seed-validation.js
// WALL: the PRE-FORGET VALIDATION RECORD. Seeded-vs-genesis is the only evidence that the path a
// client relies on AFTER forgetting is sound — and forgetting drops the log that makes the check
// possible. There is exactly one chance to run it, so "we saw no warning" cannot be the signal.
//
//   PART A — a sound seed records `validated`, and only that licenses forgetting.
//   PART B — a THROW records `not-yet-run` and RETRIES. This is the fix: the signature used to be
//     marked before the derive ran, so a throw recorded the checkpoint as checked forever.
//   PART C — an unlocatable boundary records `not-yet-run` and retries. The `idx < 0` case is
//     commented "we've forgotten the boundary", so it gets MORE likely once forgetting is on.
//   PART D — a mismatch records `mismatched`, is CONCLUSIVE (not retried), and does not enforce.
//     Detection is not response (consensus-models §2): nothing is distrusted behind anyone's back;
//     what changes is that the cut no longer licenses a drop.
//   PART E — every non-`validated` state refuses the licence. The states must not collapse.
//   PART F — A PARTIAL LOG CANNOT CONCLUDE. While the client is still REPLAYING, its log is
//     incomplete and arrives out of order, so a genesis fold of it is not the room — it is a
//     fragment. Comparing a seed against that fragment produces a mismatch that says nothing about
//     the seed, and `mismatched` is CONCLUSIVE (PART D), so one spurious verdict during replay
//     poisons that checkpoint for the rest of the session and forgetting is never licensed again.
//     Seen live: the warning fired at 70 events, three events before replay finished.
//     "I cannot tell yet" is already a state this file insists on for the throw and the missing
//     boundary. Replay is the same situation and must record the same thing.

const assert = require("assert");
const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[seed-validation] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(a, b, msg) { if (a !== b) fail(msg + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }
function ok(c, msg) { if (!c) fail(msg); }
const noop = () => {};

let L = 0;
function mkRaw(type, sender, rank, body) {
  L++;
  return {
    event_id: "$e" + L, type: "m.room.message", sender, room_id: "!r",
    ts: L * 1000, senderRank: rank,
    content: { body: JSON.stringify(Object.assign({ t: type, l: L }, body)) },
  };
}

// A harness with a CONTROLLABLE checkpoint: we drive getTrusted/getSeed directly so each failure
// mode can be reached deliberately rather than hoped for.
function harness(settingsStatus) {
  const cp = { trusted: null, seed: null };
  const sb = loadInContext(
    ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
     "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
     "backends/backend1/streammanager.js"],
    {
      Logger: { info: noop, warn: noop, error: noop, debug: noop },
      // THE COLLABORATOR MOVED. StreamManager asks Floor for the trusted floor and its seed now,
      // not CheckpointEngine — the concept got its own home. The CLAIMS below are unchanged; only
      // the name and the two method names are.
      Floor: {
        current: () => cp.trusted, seed: () => cp.seed,
      },
      // The settings half of the licence moved too, and to its OWN concept: the question "were
      // these the rules?" is answered by reading the settings channel, which is a different job
      // from choosing a floor. Two claims, two homes, one licence.
      SettingsProof: {
        licensesForget: () => (settingsStatus === undefined ? true : settingsStatus === "validated"),
        verdict: () => ({ status: (settingsStatus === undefined ? "validated" : settingsStatus) }),
      },
      Date,
    }
  );
  return { SM: sb.StreamManager, SD: sb.StateDeriver, cp: cp, sb: sb };
}

// A short running room, ingested. Returns the raws so a covers-boundary can name a real id.
function scenario(SM) {
  L = 0;
  const raws = [
    mkRaw("ddjp.dj.join", "@a", 20, { v: "AAAAAAAAAAA", u: "https://y/a" }),
    mkRaw("ddjp.dj.join", "@b", 20, { v: "BBBBBBBBBBB", u: "https://y/b" }),
    mkRaw("ddjp.dj.play", "@a", 20, { p: null }),
    mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e3" }),
    mkRaw("ddjp.dj.skip", "@staff", 60, { p: "$e3" }),
  ];
  for (const r of raws) SM.ingest(r);
  return raws;
}

// Seal at the cut after `upto` events: build the real seed and a trusted record naming that cut.
function sealAt(h, upto) {
  const log = h.SM.getLog();
  const covered = log.slice(0, upto);
  h.cp.seed = h.SD.buildSeed(covered);
  h.cp.trusted = { n: 1, h: "hash-1", covers: covered[0].eventId + ".." + covered[covered.length - 1].eventId };
}

// ── PART A: a sound seed validates, and that is what licenses forgetting ─────────────────────
{
  const h = harness();
  scenario(h.SM);
  eq(h.SM.seedValidation().status, "not-yet-run", "A: no checkpoint -> nothing has been validated");
  eq(h.SM.seedLicensesForget(), false, "A: no checkpoint never licenses forgetting");

  sealAt(h, 3);
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));   // an ingest with a trusted cp present
  const v = h.SM.seedValidation();
  eq(v.status, "validated", "A: a sound seed reproduces the genesis queue");
  eq(h.SM.seedLicensesForget(), true, "A: and only then is forgetting licensed");
  ok(v.sig, "A: the verdict names the checkpoint it applies to");
  ok(v.at > 0, "A: the verdict is timestamped");
}

// ── PART B: a throw is not a pass, and it retries ────────────────────────────────────────────
// The original bug: `_lastValidatedCp = sig` ran BEFORE the derive, so a throw recorded the
// checkpoint as checked and it was never looked at again.
{
  const h = harness();
  scenario(h.SM);
  sealAt(h, 3);

  let calls = 0;
  const realDerive = h.SD.derive;
  h.SD.derive = function (evts, seed) {
    if (seed) { calls++; throw new Error("boom"); }    // only the SEEDED validation derive
    return realDerive.apply(this, arguments);
  };

  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  const v1 = h.SM.seedValidation();
  eq(v1.status, "not-yet-run", "B: a throw records not-yet-run, NOT validated");
  ok(/^threw:/.test(v1.reason || ""), "B: the reason names the throw");
  eq(h.SM.seedLicensesForget(), false, "B: a throw never licenses forgetting");
  eq(calls, 1, "B: the validation was attempted once");

  // THE RETRY. Same checkpoint, next ingest — it must try again rather than treat it as done.
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e5" }));
  eq(calls, 2, "B: the same checkpoint is RETRIED after a throw");
  eq(h.SM.seedLicensesForget(), false, "B: still unlicensed");

  // and once it stops throwing, it concludes normally
  h.SD.derive = realDerive;
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@c", 20, { p: "$e5" }));
  eq(h.SM.seedValidation().status, "validated", "B: a transient failure resolves on a later pass");
}

// ── PART C: an unlocatable boundary is not a pass either ─────────────────────────────────────
{
  const h = harness();
  const raws = scenario(h.SM);
  sealAt(h, 3);
  // name a covered id we do not hold — the "we've forgotten the boundary" case
  h.cp.trusted = { n: 1, h: "hash-1", covers: raws[0].event_id + "..$nowhere" };

  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  const v = h.SM.seedValidation();
  eq(v.status, "not-yet-run", "C: an unlocatable boundary records not-yet-run");
  eq(v.reason, "no-boundary", "C: and says why");
  eq(h.SM.seedLicensesForget(), false, "C: an unrun check never licenses forgetting");

  // it retries, and succeeds once the boundary is locatable again
  h.cp.trusted = { n: 1, h: "hash-1", covers: raws[0].event_id + ".." + raws[2].event_id };
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e5" }));
  eq(h.SM.seedValidation().status, "validated", "C: retried and concluded once locatable");
}

// ── PART D: a mismatch is conclusive, recorded, and NOT enforced ─────────────────────────────
{
  const h = harness();
  scenario(h.SM);
  sealAt(h, 3);

  let calls = 0;
  const realDerive = h.SD.derive;
  h.SD.derive = function (evts, seed) {
    if (seed) { calls++; return { nowPlaying: { pi: "$wrong" }, rotation: [], settings: {} }; }
    return realDerive.apply(this, arguments);
  };

  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  eq(h.SM.seedValidation().status, "mismatched", "D: a diverging seed is recorded as mismatched");
  eq(h.SM.seedLicensesForget(), false, "D: a mismatch never licenses forgetting");

  // CONCLUSIVE: unlike not-yet-run, this does not re-derive on every subsequent ingest.
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e5" }));
  eq(calls, 1, "D: a mismatch is conclusive — not retried on every ingest");

  // NOT ENFORCED — asserted BEHAVIOURALLY. The weak version of this check ("live state still
  // equals genesis") is decorative: genesis is returned on every path today, so it holds whether
  // or not a mismatch revoked anything. The real question is whether the seed is still SERVED —
  // if a mismatch quietly revoked it, `_deriveBest` would take its `if (!seed) return genesis`
  // short-circuit and never attempt validation again. So: change the checkpoint and watch for a
  // fresh attempt.
  const before = calls;
  h.cp.trusted = { n: 2, h: "hash-2", covers: h.cp.trusted.covers };   // a NEW signature
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@c", 20, { p: "$e5" }));
  ok(calls > before,
    "D: a mismatch did NOT revoke the seed — a new checkpoint is still validated (detection ⟂ response)");
  h.SD.derive = realDerive;
}

// ── PART E: the states do not collapse, and reset clears the verdict ─────────────────────────
{
  const h = harness();
  scenario(h.SM);
  sealAt(h, 3);
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  eq(h.SM.seedLicensesForget(), true, "E: validated licenses");

  // A verdict belongs to one room's log.
  h.SM.reset();
  eq(h.SM.seedValidation().status, "not-yet-run", "E: reset clears the verdict");
  eq(h.SM.seedLicensesForget(), false, "E: a fresh room is not licensed by the last room's check");

  // The returned record is a copy — a caller cannot edit its way to a licence.
  const h2 = harness();
  scenario(h2.SM);
  sealAt(h2, 3);
  h2.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  const rec = h2.SM.seedValidation();
  rec.status = "tampered";
  eq(h2.SM.seedValidation().status, "validated", "E: the record is handed out as a copy");
}

// ── PART F: a seed carrying settings nobody was allowed to set ───────────────────────────────
// There are TWO routes into room settings and only one is rank-gated. The live route rejects
// anything below Owner (`Ranks.permits(rank, "room.settings")`, channel origin as proof). The
// SEED route is taken wholesale: `settings = Object.assign(defaultSettings(), seed.settings)`,
// with no author check at the point of consumption — and a checkpoint's hash is computed by its
// own author, so verification proves integrity in transit, not honesty.
//
// What contains this is the genesis cross-check, and containment must be PROVEN rather than
// assumed: `_canon` compares { nowPlaying, rotation, settings }, so a seed whose settings differ
// from what the log produces cannot validate. This is a real tampered seed, not a patched derive.
{
  // SEAL OVER EVERYTHING, then follow with an event that does NOT rebuild nowPlaying (a vote).
  // This matters: nowPlaying carries its own settings SNAPSHOT, so if a play or skip follows the
  // checkpoint, np is rebuilt from the tampered settings and the mismatch is caught through `np`
  // whether or not the canon compares settings at all. Mutation-testing this guard showed exactly
  // that — dropping `set` from the comparison left the assertion green. Isolating the term is the
  // difference between proving the containment and merely observing a failure somewhere.
  const h = harness();
  scenario(h.SM);
  sealAt(h, 5);

  // A hostile (or merely wrong) checkpoint author rewrites the room's settings in the seed, and
  // leaves the nowPlaying snapshot alone so ONLY the top-level settings can differ.
  h.cp.seed = JSON.parse(JSON.stringify(h.cp.seed));
  h.cp.seed.settings = Object.assign({}, h.cp.seed.settings || {}, { vis: "public", chat: "guest" });

  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  eq(h.SM.seedValidation().status, "mismatched",
    "F: a seed carrying settings the log never authorised does NOT validate");
  eq(h.SM.seedLicensesForget(), false,
    "F: and therefore never licenses forgetting — which is what keeps the seed route from " +
    "becoming a settings bypass once the log below the floor is dropped");

  // Live state is unaffected today: genesis is still truth while the full log is held.
  const live = h.SM.getState();
  eq(live.settings.vis, "private", "F: the tampered settings did not reach live state");
  eq(live.settings.chat, "uncategorized", "F: nor the chat tier");
}

// ── PART G: an HONEST seed still validates ───────────────────────────────────────────────────
// The negative control for F. Without it, "mismatched" above could be an artefact of sealAt
// producing a seed that never matches anything — absence reading as a finding.
{
  const h = harness();
  scenario(h.SM);
  sealAt(h, 5);
  const untouched = JSON.parse(JSON.stringify(h.cp.seed));
  h.cp.seed = untouched;
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  eq(h.SM.seedValidation().status, "validated",
    "G: an untampered seed of the same shape validates — so F caught the tampering, not the fixture");
}

// ── PART H: the licence needs BOTH assertions, not just the fold ─────────────────────────────
// A checkpoint asserts two separate things, and re-deriving from genesis proves only one of them:
// the QUEUE is right. It says nothing about whether the settings blob in the seed is one the room
// ever authorised. Dropping the log removes the evidence for both, so both must be settled first.
{
  const cases = [
    ["validated",    true,  "a checked settings claim licenses forgetting"],
    ["mismatched",   false, "a settings claim the named event contradicts does NOT"],
    ["unverified",   false, "nor one we could not fetch yet — later is not permission"],
    ["unverifiable", false, "nor one that can never be checked — purged is not permission"],
    ["not-yet-run",  false, "nor one nobody has looked at"],
  ];
  for (const [status, licensed, why] of cases) {
    const h = harness(status);
    scenario(h.SM);
    sealAt(h, 3);
    h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
    eq(h.SM.seedValidation().status, "validated",
      "H: the FOLD validates in every case (else this tests the wrong thing) — " + status);
    eq(h.SM.seedLicensesForget(), licensed, "H: " + why);
  }
}

// ── PART F: a client still REPLAYING cannot conclude, and it retries ─────────────────────────
// During replay the log is incomplete and arrives out of order, so folding it from genesis
// produces a FRAGMENT rather than the room. A seed compared against a fragment mismatches for
// reasons that say nothing about the seed — and `mismatched` is conclusive, so one spurious
// verdict poisons that checkpoint for the whole session and forgetting is never licensed again.
{
  const h = harness();
  // Nothing here stubs Session, so the module sees `typeof Session === "undefined"` — the shape a
  // backend module must tolerate. A missing phase machine must not be read as "still replaying",
  // or a client that never wires one could never validate at all.
  scenario(h.SM);
  sealAt(h, 3);
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  eq(h.SM.seedValidation().status, "validated",
    "F: with no phase machine present the check still concludes — absence is not 'replaying'");

  // Now a client that IS replaying.
  const h2 = harness();
  h2.sb.Session = { phase: () => "replaying", REPLAYING: "replaying" };
  scenario(h2.SM);
  sealAt(h2, 3);
  h2.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  const v = h2.SM.seedValidation();
  eq(v.status, "not-yet-run", "F: a client still replaying records not-yet-run, never a verdict");
  eq(v.reason, "still-replaying",
    "F: and names the reason — 'no boundary' and 'still replaying' need different answers");

  // Replay finishes; the very next ingest must be free to conclude.
  h2.sb.Session.phase = () => "live";
  h2.SM.ingest(mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e5" }));
  eq(h2.SM.seedValidation().status, "validated",
    "F: APPLIED — once replay is done the check runs and concludes. Recorded as CONCLUSIVE during "
    + "replay, a fragment's mismatch blocks forgetting for the whole session");
}

console.log("[seed-validation] PASS — the pre-forget check is a queryable TRI-STATE: a sound seed records validated (the only state that licenses forgetting), a throw and an unlocatable boundary both record not-yet-run and are RETRIED (they used to be marked checked before the derive ran), a divergence records mismatched, is conclusive, and enforces nothing (detection ⟂ response — the old line claimed a distrust it never performed); verdicts are per-room and handed out as copies; and a seed carrying room settings the log never authorised is caught by the genesis cross-check, with an honest seed of the same shape validating as the control; and the forget licence requires BOTH the fold reproducing genesis AND the settings claim checking out, since the log is the evidence for both");
