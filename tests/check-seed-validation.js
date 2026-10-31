// tests/check-seed-validation.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: the PRE-FORGET VALIDATION RECORD (J73). Seeded-vs-genesis was the licence to forget until step 5b (`ddjp_554`);
// it is a diagnostic now — forgetting follows `Floor.proves` in a shared room and the adoption in a bot room — and decides
// whether a tab may seal on a floor (`disagreesWithFloor`) and the J73 predicate `seedLicensesForget`, which no production
// path asks since J107. Forgetting drops the log the check reads, so there is exactly one chance to run it, and "we saw no
// warning" cannot be the signal.
//
//   PART A — a sound seed records `validated`, and only that satisfies `seedLicensesForget`.
//   PART B — a THROW records `not-yet-run` and RETRIES. This is the fix: the signature used to be
//     marked before the derive ran, so a throw recorded the checkpoint as checked forever.
//   PART C — an unlocatable boundary records `not-yet-run` and retries. The `idx < 0` case is
//     commented "we've forgotten the boundary", so it gets MORE likely once forgetting is on.
//   PART D — a mismatch records `mismatched`, is CONCLUSIVE (not retried), and does not enforce.
//     Detection is not response (consensus-models §2): nothing is distrusted behind anyone's back;
//     what changes is that `seedLicensesForget` says no at that cut.
//   PART E — `validated` satisfies the predicate, `reset` clears the verdict, and the record is handed out as a copy.
//   PART F — A PARTIAL LOG CANNOT CONCLUDE. While the client is still REPLAYING, its log is
//     incomplete and arrives out of order, so a genesis fold of it is not the room — it is a
//     fragment. Comparing a seed against that fragment produces a mismatch that says nothing about
//     the seed, and `mismatched` is CONCLUSIVE (PART D), so one spurious verdict during replay
//     poisons that checkpoint for the rest of the session (until step 5b forgetting was never licensed again).
//     Seen live: the warning fired at 70 events, three events before replay finished.
//     "I cannot tell yet" is already a state this file insists on for the throw and the missing
//     boundary. Replay is the same situation and must record the same thing.
//   PART F (by the settings; it comes first in the file, and the replay PART F above follows PART H) — a seed carrying
//     settings nobody was allowed to set is caught by the genesis cross-check; PART G — an honest seed of the same shape still
//     validates (the control); PART H — `seedLicensesForget` needs the fold AND the settings proof.
//   PART T — A TRIMMED TAB NEVER RUNS THE CHECK (J101). Driven with a real trim: after it, a new floor's check is not run,
//     so it can never compare a seed against a log that starts mid-room — `_deriveBest` returns first, from the floor's seed.
//   PART L — the mismatch warning says what the verdict decides (J115). PART N — and what it compared (the owner's `?v=558`
//     run): the save point's author, its event and that event's channel tier, the first differing field with both values.
//   PART O — a difference on a log that is not the whole room — the door set events aside below the floor, or the log never
//     reached the room's start — is not-yet-run with its own reason and no warning (`ddjp_627`); the whole room still mismatches.

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

// A harness with a CONTROLLABLE checkpoint: we drive Floor.current/Floor.seed directly so each failure
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

// ── PART A: a sound seed validates, and that is what `seedLicensesForget` takes ─────────────────────
{
  const h = harness();
  scenario(h.SM);
  eq(h.SM.seedValidation().status, "not-yet-run", "A: no checkpoint -> nothing has been validated");
  eq(h.SM.seedLicensesForget(), false, "A: no checkpoint never licenses forgetting");

  sealAt(h, 3);
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));   // an ingest with a trusted cp present
  const v = h.SM.seedValidation();
  eq(v.status, "validated", "A: a sound seed reproduces the genesis queue");
  eq(h.SM.seedLicensesForget(), true, "A: and only then does `seedLicensesForget` say yes");
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
// What contained this, while it was the licence (until step 5b), was the genesis cross-check; since then forgetting asks
// `Floor.proves`, which rebuilds the seed exactly from the save point before it, and the settings proof. Containment must be
// PROVEN rather than assumed: `_canon` compares REPRODUCE_FIELDS (nowPlaying, rotation, settings, counts, advance), so a seed whose settings differ
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
    "F: and so `seedLicensesForget` says no — what kept the seed route from becoming a settings " +
    "bypass while this was the licence (until step 5b)");

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

// ── PART H: `seedLicensesForget` needs BOTH assertions, not just the fold ─────────────────────────────
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
// verdict poisons that checkpoint for the whole session (until step 5b forgetting was never licensed again).
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
    + "replay, a fragment's mismatch would stand for the whole session");
}

// ── PART T: A TRIMMED TAB NEVER RUNS THE CHECK, SO IT NEVER CONCLUDES FROM A LOG THAT STARTS MID-ROOM (J101) ──────────
// After a trim this tab's log starts at its floor, and folding it "from genesis" describes a room that never happened — a
// seed compared against that fold must differ, and `mismatched` is CONCLUSIVE (PART D). What keeps a trimmed tab out of the
// comparison is `_deriveBest` itself: a trimmed tab folds from its floor's seed and returns before the check (the case
// v281 added under the check for it could not run, and J101 removed it). Driven with a REAL trim: a verified floor, its
// boundary held, `Floor.proves` stood in as ok; then a new floor — and the check is not run for it, and never says `mismatched`.
{
  const h = harness();
  h.sb.Floor.proves = () => ({ ok: true });
  scenario(h.SM);
  // A floor's seed is built from the WHOLE room up to its cut, as the sealer that holds the room builds it.
  const seal = (n, upto, room) => {
    const covered = (room || h.SM.getLog()).slice(0, upto);
    h.cp.seed = h.SD.buildSeed(covered);
    h.cp.trusted = { n: n, h: "hash-" + n, grade: "verified", floorL: covered[covered.length - 1].l, seed: h.cp.seed,
      covers: covered[0].eventId + ".." + covered[covered.length - 1].eventId };
  };
  seal(1, 3);
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  const v1 = h.SM.seedValidation();
  eq(v1.status, "validated", "T PREMISE — the check ran for the first floor while the tab held the room from its start");
  const whole = h.SM.getLog().slice();
  const dropped = h.SM.trimToFloor();
  ok(dropped > 0 && h.SM.holdsWholeRoom() === false && h.SM.heldFrom() > 1,
    "T PREMISE — a REAL trim: the drop proved and done, so the tab no longer holds the room from its start (dropped " + dropped + ")");
  const room = whole.concat(h.SM.getLog().filter((e) => !whole.some((w) => w.eventId === e.eventId)));
  seal(2, room.length, room);   // a new floor, sealed over the whole room by a device that holds it
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e5" }));
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@c", 20, { p: "$e5" }));
  const v2 = h.SM.seedValidation();
  ok(v2.status !== "mismatched",
    "T: A TRIMMED TAB NEVER CONCLUDES `mismatched` — its log starts at its floor, and a genesis fold of it is not the room (got " +
    v2.status + (v2.reason ? " / " + v2.reason : "") + ")");
  eq(v2.sig, v1.sig, "T: because it never runs the check: the verdict is still the first floor's — the trimmed tab folds from the " +
    "floor's seed and returns before the comparison");
}

// ── PART L: THE WARNING SAYS WHAT THE VERDICT DECIDES, AND WHAT IT SAYS HOLDS (J115) ────────────────────────────────
// The mismatch line said "forgetting is not licensed at this cut": true until step 5b, false since. Forgetting follows
// `Floor.proves`, and J100's probe tab trimmed below that very cut. What the verdict decides is whether this tab may seal on
// that save point (`disagreesWithFloor`), so that is what the line must say — and the claim is driven, not read.
{
  const h = harness();
  const warns = [];
  h.sb.Logger.warn = (m) => warns.push(String(m));
  scenario(h.SM);
  sealAt(h, 3);
  h.cp.trusted.n = 7;
  const realDerive = h.SD.derive;
  h.SD.derive = function (evts, seed) {
    if (seed) return { nowPlaying: { pi: "$wrong" }, rotation: [], settings: {} };
    return realDerive.apply(this, arguments);
  };
  h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
  h.SD.derive = realDerive;
  eq(h.SM.seedValidation().status, "mismatched", "L PREMISE — the seed diverges and is recorded mismatched");
  const line = warns.filter((w) => /save point n=7|diverges/.test(w))[0] || null;
  ok(!!line, "L: APPLIED — a mismatch is logged, or the rows below read nothing (warnings: " + JSON.stringify(warns) + ")");
  ok(!/forgetting is not licensed/.test(line || ""), "L: the line no longer claims the mismatch stops forgetting — " +
    "since step 5b it does not (got " + JSON.stringify(line) + ")");
  ok(/save point n=7/.test(line || "") && /does not seal/.test(line || ""), "L: it names the save point and says this tab " +
    "does not seal on it (got " + JSON.stringify(line) + ")");
  eq(h.SM.disagreesWithFloor(), true, "L: and that is TRUE — while it holds the room from its start, this tab's seal check " +
    "reads the mismatch (`disagreesWithFloor`)");
}

// ── PART N: THE WARNING SAYS WHAT IT COMPARED (the owner's `?v=558` run) ─────────────────────────────────────────────
// The bot's tab warned "differs from save point n=2" and named nothing more, while the move-on check beside it names the
// first field that differs. The line now names the save point's author, its own event and the tier of the channel that event
// arrived on, and the first differing field with both values — read through `_firstDiffering` and `_field`, the move-on
// check's comparator, so the two checks name one field for one difference. A DIAGNOSTIC: the verdict is the same either way,
// and a line that cannot be built must not turn the verdict into "threw" (the twenty-third signature).
//   N1 — the save point's n, author, event id and channel tier, and the first field with both values.
//   N2 — the FIRST field in the comparator's order: a seed wrong in two fields is named by the earlier one.
//   N3 — a save point whose own event this tab does not hold (its own seal, before the echo) is said so, never misnamed.
//   N4 — a line that cannot be built changes no verdict.
//   N5 — an OBJECT field (`nowPlaying` carries the whole settings snapshot) is shown by the keys inside it that differ, each with
//        both values, and how many were equal (the owner's yes, `ddjp_627`); N6 — two keys, both named, in key order; N7 — a
//        field that is not an object on both sides is shown whole, as before; N8 — display only: the verdict and the field named
//        are the comparator's, with or without the narrowing.
{
  const rotationWrong = (realDerive) => function (evts, seed) {
    const st = realDerive.apply(this, arguments);
    if (!seed) return st;
    return Object.assign({}, st, { rotation: [{ user: "@planted", pending: [] }], settings: Object.assign({}, st.settings, { vis: "public" }) });
  };
  const drive = (o) => {
    const h = harness();
    const warns = [];
    h.sb.Logger.warn = (m) => warns.push(String(m));
    scenario(h.SM);
    // The save point's own event, on the owner's checkpoints channel — or, for N3, ANOTHER author's save point at the same n on
    // the high-staff one, so a lookup that named whichever checkpoint it found would name the wrong one.
    const cpRaw = o.notHeld ? mkRaw("ddjp.checkpoint", "@other:hs", 80, { n: 4, h: "hash-other" })
                            : mkRaw("ddjp.checkpoint", "@owner:hs", 99, { n: 4, h: "hash-4" });
    h.SM.ingest(cpRaw);
    sealAt(h, 3);
    Object.assign(h.cp.trusted, { n: 4, h: "hash-4", by: "@owner:hs" });
    if (o.ranksThrow) h.sb.Ranks.nameOf = () => { throw new Error("no ladder"); };
    const realDerive = h.SD.derive;
    h.SD.derive = rotationWrong(realDerive);
    h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
    h.SD.derive = realDerive;
    const line = warns.filter((w) => /differs from save point n=4/.test(w))[0] || null;
    return { h, warns, line, cpRaw, v: h.SM.seedValidation() };
  };
  {
    const r = drive({});
    eq(r.v.status, "mismatched", "N PREMISE — the planted seed diverges and is recorded mismatched");
    ok(!!r.line, "N: APPLIED — the mismatch is logged, or the rows below read nothing (warnings: " + JSON.stringify(r.warns) + ")");
    const L = r.line || "";
    ok(/save point n=4/.test(L) && L.indexOf("sealed by @owner:hs") >= 0,
      "N1: the line names the save point's n and its author (got " + JSON.stringify(L) + ")");
    ok(L.indexOf("its event " + r.cpRaw.event_id + " arrived on the owner channel") >= 0,
      "N1: the line names the save point's own event and the tier of the channel it arrived on (got " + JSON.stringify(L) + ")");
    ok(L.indexOf("first at rotation — from the start: [];") >= 0 && L.indexOf("from the save point: [{\"pending\":[],\"user\":\"@planted\"}]") >= 0,
      "N1: the line names the first differing field and both values, from the start and from the save point (got " + JSON.stringify(L) + ")");
    ok(L.indexOf("first at settings") < 0,
      "N2: a seed wrong in two fields is named by the FIRST in the comparator's order (rotation before settings), as the move-on " +
      "check names it (got " + JSON.stringify(L) + ")");
    ok(/does not seal/.test(L), "N: and it still says what the verdict decides, as PART L holds (got " + JSON.stringify(L) + ")");
  }
  {
    const r = drive({ notHeld: true });
    eq(r.v.status, "mismatched", "N3 PREMISE — mismatched with the save point's own event not held");
    ok((r.line || "").indexOf("its event is not in this tab's log") >= 0 && (r.line || "").indexOf(r.cpRaw.event_id) < 0,
      "N3: a save point whose event this tab does not hold is said so, and the other author's save point is not named for it (got " +
      JSON.stringify(r.line) + ")");
  }
  {
    // N5–N8: the planted difference is inside `nowPlaying` this time.
    const npPlant = (change) => (realDerive) => function (evts, seed) {
      const st = realDerive.apply(this, arguments);
      if (!seed || !st.nowPlaying) return st;
      return Object.assign({}, st, { nowPlaying: Object.assign({}, st.nowPlaying, change(st.nowPlaying)) });
    };
    const driveNp = (change, plant) => {
      const h = harness();
      const warns = [];
      h.sb.Logger.warn = (m) => warns.push(String(m));
      scenario(h.SM);
      sealAt(h, 3);
      Object.assign(h.cp.trusted, { n: 5, h: "hash-5", by: "@owner:hs" });
      const realDerive = h.SD.derive;
      h.SD.derive = (plant || npPlant)(change)(realDerive);
      h.SM.ingest(mkRaw("ddjp.dj.vote", "@a", 20, { p: "$e5" }));
      h.SD.derive = realDerive;
      const st = h.SM.getState();
      return { line: warns.filter((w) => /differs from save point n=5/.test(w))[0] || "", v: h.SM.seedValidation(), np: st.nowPlaying };
    };
    const one = driveNp(() => ({ settingsFrom: "$planted" }));
    eq(one.v.status, "mismatched", "N5 PREMISE — a seed differing only in nowPlaying.settingsFrom is recorded mismatched");
    const nKeys = Object.keys(one.np || {}).length;
    ok(one.line.indexOf("first at nowPlaying — 1 of its " + nKeys + " keys differs (" + (nKeys - 1) + " equal): settingsFrom from the start: ") >= 0 &&
      one.line.indexOf(", from the save point: \"$planted\"") >= 0,
      "N5: an object field is shown by the one key that differs, with both values, and how many keys were equal (got " + JSON.stringify(one.line) + ")");
    ok(one.line.indexOf("maxLen") < 0 && one.line.indexOf("\"pi\"") < 0,
      "N5: and nothing of the equal keys — not the settings snapshot, not the play (got " + JSON.stringify(one.line) + ")");
    const two = driveNp(() => ({ dj: "@planted-dj", settingsFrom: "$planted" }));
    ok(two.line.indexOf("first at nowPlaying — 2 of its " + nKeys + " keys differ (" + (nKeys - 2) + " equal): dj from the start: ") >= 0 &&
      two.line.indexOf(", from the save point: \"@planted-dj\"; settingsFrom from the start: ") >= 0,
      "N6: two keys that differ are both named, in key order, each with both values (got " + JSON.stringify(two.line) + ")");
    const gone = driveNp(null, () => (realDerive) => function (evts, seed) {
      const st = realDerive.apply(this, arguments);
      return seed ? Object.assign({}, st, { nowPlaying: null }) : st;
    });
    ok(gone.line.indexOf("first at nowPlaying — from the start: {") >= 0 && gone.line.indexOf("; from the save point: null") >= 0,
      "N7: a field that is not an object on both sides is shown whole, as before (got " + JSON.stringify(gone.line) + ")");
    eq(one.v.reason, "diverges-from-genesis", "N8: display only — the verdict is the comparator's, unchanged by the narrowing");
  }
  {
    const r = drive({ ranksThrow: true });
    eq(r.v.status, "mismatched", "N4: a line that cannot be built changes no verdict — still mismatched, never 'threw' (got " +
      JSON.stringify(r.v) + ")");
    ok(!!r.line, "N4: and the warning is still said (warnings: " + JSON.stringify(r.warns) + ")");
  }
}

// ── PART O: A DIFFERENCE ON A LOG THAT IS NOT THE WHOLE ROOM IS "CANNOT TELL" (the owner's option (i), `ddjp_627`; J100) ─────
// The bot's tab at `?v=558` warned "differs from save point n=2": its door had set aside l=1 and l=2 below save point n=1, so
// its fold "from the start" lacked them, and it never trimmed (`ddjp_626`'s probe). That is not a disagreement. Driven with the
// real Floor and door, as `check-seal-disagrees` drives the banked device:
//   O1 — the probe's story: a save point adopted before the events it covers, then the next save point, whose boundary is held.
//        The comparison differs; the verdict is not-yet-run / set-aside-below-floor, there is no warning, and sealing is not blocked.
//   O2 — and it is asked once: what the door set aside stays out while the room is open, so later arrivals do not fold it again.
//   O3 — a log that never reached the room's start, with nothing set aside: not-yet-run / log-not-from-start, no warning.
//   O4 — the CONTROL: a tab that holds the room from its start and disagrees still records mismatched, and warns.
//   O5 — AND "CANNOT TELL" IS ASKED ONCE PER SAVE POINT AND REACH (`ddjp_645`, the supervisor's review of `ddjp_644`). O3's
//        verdict set no throttle, so the check folded the seed again at every arrival on the tab that should stay lightest (the
//        bot's). With the save point and what the tab holds unchanged, the adoption and ten arrivals fold it once. (Red on
//        `ddjp_644`: eleven.) O6 — a new save point asks again, and so does paging further back (a lower first event held);
//        the verdict stays not-yet-run. O2 above is the third row: `set-aside-below-floor` is asked once, as before.
//   O7 — AND AN OLDER EVENT HELD asks again too (`ddjp_646`, the supervisor's check of `ddjp_645`: O6's paging passes through
//        the SET-ASIDE path, and a constant in place of `_reachOf`'s first-event part left this guard green). The door sets
//        aside every arrival at or below a trusted floor, so an older event is HELD only while no floor stands: here the save
//        point is withdrawn (Floor's own test seam), the older event arrives and lowers the first held position with nothing
//        set aside, and the SAME save point stands again. The check is asked again. (Red by that plant.)
{
  const path = require("path");
  const F = require(path.join(__dirname, "_fixtures.js"));
  const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js",
    "backends/backend1/history.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js",
    "backends/backend1/continuity.js", "backends/backend1/streammanager.js"];
  const T0 = 1.7e12, MIN = 60000;
  const tab = () => {
    const sb = loadInContext(FILES, { Logger: { info: noop, warn: noop, debug: noop, error: noop } });
    sb.Floor.reset(); sb.StreamManager.reset();
    try { sb.Session.enterRoom("!r:hs"); sb.Session.replayFinished(); } catch (e) {}
    if (sb.Session._setPhaseForTest) sb.Session._setPhaseForTest(sb.Session.LIVE);
    const warns = []; sb.Logger.warn = (m) => warns.push(String(m));
    const S = sb.StateDeriver.defaultSettings();
    const log = [F.reducerEvent("$s", 1, T0, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: S })];
    for (let l = 2; l <= 30; l++) log.push(F.reducerEvent("$e" + String(l).padStart(3, "0"), l, T0 + l * MIN, "@d" + (l % 3) + ":hs", F.RANK.player, { t: "ddjp.dj.join", v: "vid" + String(l).padStart(8, "0") }));
    const scratch = loadInContext(FILES, { Logger: { info: noop, warn: noop, debug: noop, error: noop } });
    scratch.StreamManager.reset(); for (const e of log) scratch.StreamManager.ingest(F.toRaw(e));
    const full = scratch.StreamManager.getLog();
    const floorAt = (n, prev, l, seedFrom, h) => {
      const upto = full.filter((e) => e.l <= l);
      return F.real(sb.Floor, { n, prev, seed: sb.StateDeriver.buildSeed(seedFrom ? upto.filter((e) => e.l > seedFrom.l) : upto, seedFrom ? seedFrom.seed : undefined),
        h, covers: upto[0].eventId + ".." + upto[upto.length - 1].eventId, floorL: l, thin: false, by: "@o:hs" });
    };
    const differs = () => warns.filter((w) => /differs from save point/.test(w));
    return { sb, log, full, warns, differs, floorAt, SM: sb.StreamManager };
  };
  { // O1, O2 — the probe's story
    const t = tab();
    const cp1 = t.floorAt(1, null, 20, null, "h1");
    t.sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, cp1), tier: 0 });            // the save point FIRST
    for (const e of t.log) t.SM.ingest(F.toRaw(e));                                       // then its events: l <= 20 set aside
    ok(t.SM.ignoredArrivals() && t.SM.ignoredArrivals().count > 0 && t.SM._trimState() === null,
      "O1 PREMISE — the door set the covered events aside, and nothing was trimmed (got " + JSON.stringify({ ignored: t.SM.ignoredArrivals(), trim: t.SM._trimState() }) + ")");
    const cp2 = t.floorAt(2, "h1", 28, { l: 20, seed: cp1.seed }, "h2");
    let seeded = 0;
    const d0 = t.sb.StateDeriver.derive;
    t.sb.StateDeriver.derive = function (evts, seed) { if (seed) seeded++; return d0.apply(this, arguments); };
    t.sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, cp2), tier: 0 });           // the next save point, its boundary held
    t.SM.ingest(F.toRaw(F.reducerEvent("$after1", 31, T0 + 31 * MIN, "@d1:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidAFTER0001" })));
    const v = t.SM.seedValidation();
    eq(v.status + "/" + v.reason, "not-yet-run/set-aside-below-floor", "O1: the banked tab's difference is recorded \"cannot tell\", with its own reason");
    eq(t.differs().length, 0, "O1: and it warns nothing (warnings: " + JSON.stringify(t.differs()) + ")");
    eq(t.SM.disagreesWithFloor(), false, "O1: and sealing is not blocked by it");
    const first = seeded;
    t.SM.ingest(F.toRaw(F.reducerEvent("$after2", 32, T0 + 32 * MIN, "@d2:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidAFTER0002" })));
    t.SM.ingest(F.toRaw(F.reducerEvent("$after3", 33, T0 + 33 * MIN, "@d0:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidAFTER0003" })));
    const perIngest = (seeded - first) / 2;
    t.sb.StateDeriver.derive = d0;
    ok(first >= 1 && perIngest === 0, "O2: asked once — the check folded from the save point when it arrived (" + first + " seeded fold(s)), and " +
      "later arrivals do not fold it again (" + perIngest + " per arrival): what the door set aside stays out, so asking again folds the same gap");
    eq(t.SM.seedValidation().reason, "set-aside-below-floor", "O2: and the verdict stands");
  }
  { // O3 — a log that never reached the room's start, nothing set aside
    const t = tab();
    for (const e of t.log.filter((x) => x.l >= 3)) t.SM.ingest(F.toRaw(e));               // l=1 and l=2 never arrive
    t.sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, t.floorAt(1, null, 20, null, "h1")), tier: 0 });
    t.SM.ingest(F.toRaw(F.reducerEvent("$after1", 31, T0 + 31 * MIN, "@d1:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidAFTER0001" })));
    const v = t.SM.seedValidation();
    eq(v.status + "/" + v.reason, "not-yet-run/log-not-from-start", "O3: a log that does not reach the room's start, nothing set aside, cannot tell either");
    eq(t.differs().length, 0, "O3: and warns nothing (warnings: " + JSON.stringify(t.differs()) + ")");
  }
  { // O5, O6 — "cannot tell" is asked once per save point and per reach
    const t = tab();
    for (const e of t.log.filter((x) => x.l >= 3)) t.SM.ingest(F.toRaw(e));               // l=1 and l=2 never arrive, as O3
    let seeded = 0;
    const d0 = t.sb.StateDeriver.derive;
    t.sb.StateDeriver.derive = function (evts, seed) { if (seed) seeded++; return d0.apply(this, arguments); };
    t.sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, t.floorAt(1, null, 20, null, "h1")), tier: 0 });
    for (let i = 1; i <= 10; i++) t.SM.ingest(F.toRaw(F.reducerEvent("$arr" + String(i).padStart(3, "0"), 30 + i, T0 + (30 + i) * MIN, "@d" + (i % 3) + ":hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidARRIVE" + String(i).padStart(3, "0") })));
    const v = t.SM.seedValidation();
    ok(v.status + "/" + v.reason === "not-yet-run/log-not-from-start" && t.SM._trimState() === null && t.SM.getLog()[0] && t.SM.getLog()[0].l === 3,
      "O5 PREMISE — the tab's log does not reach the room's start (it begins at l=3), nothing is trimmed, and the verdict is cannot-tell (got " +
      JSON.stringify({ v: v.status + "/" + v.reason, first: t.SM.getLog()[0] && t.SM.getLog()[0].l }) + ")");
    eq(seeded, 1, "O5: WITH THE SAVE POINT AND THE REACH UNCHANGED, THE ADOPTION AND TEN ARRIVALS FOLD THE SEED ONCE — \"cannot tell\" for this " +
      "save point over this log is remembered, not re-derived at every arrival (on `ddjp_644`: once per arrival as well)");
    const before = seeded;
    t.sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, t.floorAt(2, "h1", 36, { l: 20, seed: t.floorAt(1, null, 20, null, "h1").seed }, "h2")), tier: 0 });
    t.SM.ingest(F.toRaw(F.reducerEvent("$arr011", 41, T0 + 41 * MIN, "@d1:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidARRIVE011" })));
    const afterCp = seeded;
    ok(afterCp > before && t.SM.seedValidation().sig !== v.sig, "O6: a NEW SAVE POINT asks again (" + (afterCp - before) + " fold(s))");
    const aside0 = (t.SM.ignoredArrivals() && t.SM.ignoredArrivals().count) || 0, first0 = t.SM.getLog()[0].l;
    t.SM.ingest(F.toRaw(F.reducerEvent("$e002", 2, T0 + 2 * MIN, "@d2:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vid00000002" })));   // paged further back
    const aside1 = (t.SM.ignoredArrivals() && t.SM.ignoredArrivals().count) || 0, first1 = t.SM.getLog()[0].l;
    ok(aside1 !== aside0 || first1 !== first0, "O6 PREMISE — the older event changed what the tab holds: set aside below the save point, or held " +
      "(got " + JSON.stringify({ aside0, aside1, first0, first1 }) + ")");
    t.SM.ingest(F.toRaw(F.reducerEvent("$arr012", 42, T0 + 42 * MIN, "@d2:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidARRIVE012" })));   // the next fold
    const afterPage = seeded;
    t.sb.StateDeriver.derive = d0;
    ok(afterPage > afterCp, "O6: and so does PAGING FURTHER BACK — an older event held changes what the tab can tell from (" + (afterPage - afterCp) + " fold(s))");
    eq(t.SM.seedValidation().status, "not-yet-run", "O6: and the verdict stays not-yet-run — never recorded as checked for good");
  }
  { // O7 — an older event HELD, nothing set aside, the same save point: asked again
    const t = tab();
    for (const e of t.log.filter((x) => x.l >= 5)) t.SM.ingest(F.toRaw(e));               // l=1..4 never arrived
    let seeded = 0;
    const d0 = t.sb.StateDeriver.derive;
    t.sb.StateDeriver.derive = function (evts, seed) { if (seed) seeded++; return d0.apply(this, arguments); };
    const cp = Object.assign({ u: "@o:hs" }, t.floorAt(1, null, 20, null, "h1"));
    t.sb.Floor.adopt({ floor: cp, tier: 0 });
    for (let i = 1; i <= 3; i++) t.SM.ingest(F.toRaw(F.reducerEvent("$h" + i, 30 + i, T0 + (30 + i) * MIN, "@d1:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidHELD000" + i })));
    const v0 = t.SM.seedValidation(), n0 = seeded;
    ok(v0.status + "/" + v0.reason === "not-yet-run/log-not-from-start" && n0 === 1,
      "O7 PREMISE — cannot tell, asked once so far (got " + JSON.stringify({ v: v0.status + "/" + v0.reason, folds: n0 }) + ")");
    const aside0 = (t.SM.ignoredArrivals() && t.SM.ignoredArrivals().count) || 0, first0 = t.SM.getLog()[0].l;
    t.sb.Floor._setTrustedForTest(null);                                                   // the save point stops standing
    t.SM.ingest(F.toRaw(t.log.find((x) => x.l === 4)));                                    // an older event: no floor to set it aside
    t.sb.Floor._setTrustedForTest(cp);                                                     // and the same save point stands again
    t.SM.ingest(F.toRaw(F.reducerEvent("$h4", 34, T0 + 34 * MIN, "@d2:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidHELD0004" })));
    const aside1 = (t.SM.ignoredArrivals() && t.SM.ignoredArrivals().count) || 0, first1 = t.SM.getLog()[0].l, v1 = t.SM.seedValidation();
    t.sb.StateDeriver.derive = d0;
    ok(first0 === 5 && first1 === 4 && aside1 === aside0 && t.SM._trimState() === null && v1.sig === v0.sig,
      "O7 PREMISE — the older event was HELD: the first held position went from 5 to 4, nothing was set aside, nothing trimmed, and " +
      "the save point is the same one (got " + JSON.stringify({ first0, first1, aside0, aside1, same: v1.sig === v0.sig }) + ")");
    ok(seeded > n0, "O7: AN OLDER EVENT HELD ASKS AGAIN — the first held position is part of what the check reads, set aside or not (" +
      (seeded - n0) + " fold(s))");
    eq(v1.status + "/" + v1.reason, "not-yet-run/log-not-from-start", "O7: and the verdict stays cannot-tell, never checked for good");
  }
  { // O4 — the control: the whole room, a dishonest save point
    const t = tab();
    for (const e of t.log) t.SM.ingest(F.toRaw(e));
    const cp = t.floorAt(1, null, 20, null, "h1");
    cp.seed.settings = Object.assign({}, cp.seed.settings, { repeatCooldownMs: 1234567 });
    t.sb.Floor.adopt({ floor: Object.assign({ u: "@o:hs" }, F.real(t.sb.Floor, Object.assign({}, cp, { grade: undefined }))), tier: 0 });
    t.SM.ingest(F.toRaw(F.reducerEvent("$after1", 31, T0 + 31 * MIN, "@d1:hs", F.RANK.player, { t: "ddjp.dj.join", v: "vidAFTER0001" })));
    eq(t.SM.seedValidation().status, "mismatched", "O4 CONTROL: a tab that holds the room from its start and disagrees still records mismatched");
    ok(t.differs().length === 1 && /differs from save point n=1/.test(t.differs()[0]), "O4 CONTROL: and warns (warnings: " + JSON.stringify(t.warns) + ")");
    eq(t.SM.disagreesWithFloor(), true, "O4 CONTROL: and does not seal on that save point");
  }
}

console.log("[seed-validation] PASS — the pre-forget check is a queryable TRI-STATE: a sound seed records validated (the only state `seedLicensesForget` takes), a throw and an unlocatable boundary both record not-yet-run and are RETRIED (they used to be marked checked before the derive ran), a divergence records mismatched, is conclusive, and enforces nothing (detection ⟂ response — the old line claimed a distrust it never performed); verdicts are per-room and handed out as copies; and a seed carrying room settings the log never authorised is caught by the genesis cross-check, with an honest seed of the same shape validating as the control; and `seedLicensesForget` requires BOTH the fold reproducing genesis AND the settings claim checking out, since the log is the evidence for both; and a tab that has really trimmed never runs the check, so it never concludes from a log that starts mid-room (J101); and the mismatch warning names the save point and says, truly, that this tab does not seal on it — not that forgetting stops (J115) — and says what it compared: the save point's author, its event and that event's channel tier, and the first differing field in the move-on check's order with both values, a line that cannot be built changing no verdict; and a difference on a log that is not the whole room is \"cannot tell\", without a warning, while the whole room still mismatches and warns; " +
  "and that \"cannot tell\" is asked once per save point and per reach, not at every arrival (ddjp_645), an older event held " +
  "or set aside asking again (ddjp_646)");
