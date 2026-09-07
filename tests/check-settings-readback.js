// tests/check-settings-readback.js
//
// J35 — THE SETTINGS READ-BACK IS REACHED FROM A RUNNING CLIENT, and asks about the right moment.
//
// `SettingsProof.readBack` was correct and called by nothing for three releases. So the property
// this file exists to lock is a WIRING property, and a guard that drove `readBack` directly would
// pass on every broken build — the characteristic failure this suite records against `History`,
// `SettingsProof`, `earnsForget` and `onAuthorReady`. PART C therefore loads `matrixbridge.js`,
// runs `_wireConcepts`, and adopts a floor through `Floor.adopt` so the REAL subscriber fires.
//
//   PART Z — the admissibility gate, and its own self-test.
//   PART A — `atL` IS THE CUT. Driven both ways, because the tempting "improvement" here validates
//            a false claim rather than merely failing to help.
//   PART B — `needsDeeperRead()` names the two reasons a deeper read can fix, and excludes the
//            conclusive one. Both directions.
//   PART C — THE WIRE: adopting a floor a client cannot yet prove pages the settings channel,
//            re-proves, and then trims. Driven through the production subscriber, and the ORDER is
//            observed rather than read out of the source.
//   PART D — a page that FAILED withholds the licence instead of guessing, and stays retryable.
//            This is where the pager's own honesty is pinned: `[]` and `null` mean different things.
//   PART E — the continuation belongs to the room it started in.
//
// WHAT THIS FILE CANNOT SEE. `_settingsPager` itself needs the SDK, so PART C substitutes a spy for
// it after `_wireConcepts` has installed the real one — and asserts separately that the real one was
// installed, since a wire that attaches `null` is exactly the state J35 was fixing. Whether a live
// homeserver actually returns the channel is live-verification, not this.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

const fails = [];
function ok(c, m, g) {
  if (!c) { fails.push(m + (g !== undefined ? "\n      got " + JSON.stringify(g) : "")); }
}
// COLLECTS RATHER THAN EXITS, so a mutation names every part it broke instead of only the first
// assertion to fire. `09-roadmap.md` §Proving: attributing a red otherwise means clearing the
// failures ahead of it and re-running, one at a time.
function done(summary) {
  if (fails.length) {
    console.log("[settings-readback] FAIL — " + fails.length + " assertion(s):");
    for (const f of fails) console.log("  · " + f);
    process.exit(1);
  }
  console.log("[settings-readback] PASS — " + summary);
}

// ── THE FIXTURE ──────────────────────────────────────────────────────────────────────────────
// One owner settings event at genesis and one well above the cut. The second is what makes a LYING
// seed constructible and what makes "ask at the head" differ from "ask at the cut" — without it
// both readings agree and PART A would vary nothing, which is a control aimed at the wrong axis.
const CUT_N = 6;
function base() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/settingsproof.js",
    "backends/backend1/streammanager.js",
  ], {});
}
const B = base();
const DEF = B.StateDeriver.defaultSettings();
const EARLY = Object.assign({}, DEF, { maxLen: 300 });
const LATE = Object.assign({}, DEF, { maxLen: 500 });
const LOG = [
  F.reducerEvent("$sGenesis", 1, 900, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: EARLY }),
].concat(F.playingRoom({ songs: 8 }).log.map((e) =>
  F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
const TOP_L = Math.max.apply(null, LOG.map((e) => e.l));
LOG.push(F.reducerEvent("$sLate", TOP_L + 1, 999999, "@owner:hs", F.RANK.owner,
  { t: "ddjp.room.settings", s: LATE }));
const HEAD_L = TOP_L + 1;
const SETTINGS_EVENTS = LOG.filter((e) => e.type === "ddjp.room.settings");

function cut(sb, n) {
  const below = LOG.slice(0, n);
  return { n: 1, prev: null, seed: sb.StateDeriver.buildSeed(below), h: "h" + n,
           covers: below[0].eventId + ".." + below[below.length - 1].eventId,
           floorL: below[below.length - 1].l, by: "@owner:hs", grade: "quorum" };
}
const HONEST = cut(B, CUT_N);
// A LYING seed: same cut, but its pointer names the settings event that landed 14 positions LATER,
// and claims that event's values as the ones in force at the cut. Nothing at the cut produced them.
const LYING = JSON.parse(JSON.stringify(HONEST));
LYING.seed.settingsFrom = "$sLate";
LYING.seed.settings = B.StateDeriver.applySettingsEvent(B.StateDeriver.defaultSettings(), LATE);

// A THIN client: holds only what sorts above the cut, so it never held the settings event its own
// floor names — and claims coverage only from the floor's position, which is exactly what
// `_feedSettingsProofFromLog` claims in production via `markReadFrom(Floor.position())`.
function thin(sb, floor) {
  const { StreamManager, SettingsProof, Floor } = sb;
  StreamManager.reset(); Floor.reset(); SettingsProof.reset();
  SettingsProof.attach({ now: () => 1, pageSettings: null });
  for (const e of LOG.filter((x) => x.l > floor.floorL)) StreamManager.ingest(F.toRaw(e));
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  SettingsProof.markReadFrom(floor.floorL);
  Floor._setTrustedForTest(floor);
  return sb;
}
function full(sb, floor) {
  const { StreamManager, SettingsProof, Floor } = sb;
  StreamManager.reset(); Floor.reset(); SettingsProof.reset();
  SettingsProof.attach({ now: () => 1, pageSettings: null });
  for (const e of LOG) StreamManager.ingest(F.toRaw(e));
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  SettingsProof.markGenesisReached();
  Floor._setTrustedForTest(floor);
  return sb;
}
function proveAt(sb, floor, atL) {
  return sb.SettingsProof.proveClaim({
    claimed: floor.seed.settings, settingsFrom: floor.seed.settingsFrom,
    atL: atL, floorL: floor.floorL, floorNames: floor.seed.settingsFrom,
  });
}

// ── PART Z — THE ADMISSIBILITY GATE ──────────────────────────────────────────────────────────
// Every reading here can come back "unverifiable" for reasons that have nothing to do with the
// property: the log never landed, the fixture holds one settings event instead of two, the seed
// carries no pointer, the cut sits above the late event, or the control cannot validate either. An
// unreached measurement returns the same value in every tree, so absence would read as agreement.
// The gate states each precondition separately and REFUSES to let the parts run if one fails,
// naming which — and it has its own self-test below, because a gate nobody tested certifies
// everything downstream on its own authority.
function gate(o) {
  const broken = [];
  const S = [
    ["Z1-subject-present", () => (o.hasReadBack && o.hasNeedsDeeper) ? null
      : "SettingsProof.readBack / needsDeeperRead absent — the subject of this file is not there"],
    ["Z2-two-settings-events", () => (o.settingsCount === 2) ? null
      : "the fixture must carry two owner settings events, one below and one above the cut; got " + o.settingsCount],
    ["Z3-seed-names-an-event", () => (typeof o.honestNames === "string") ? null
      : "the seed at the cut names no settings event, so there is no pointer to prove"],
    ["Z4-cut-below-late", () => (o.cutL < o.lateL) ? null
      : "the late settings event must sort above the cut, or asking at the head varies nothing"],
    ["Z5-thin-never-held-it", () => (o.thinHeldNamed === false) ? null
      : "the thin client holds the very event its floor names, so it has nothing to page FOR"],
    ["Z6-control-validates", () => (o.controlStatus === "validated") ? null
      : "the CONTROL (full-replay client, honest seed, asked at the cut) answered '" +
        o.controlStatus + "' — no refusal below is attributable while that is true"],
  ];
  for (const [name, fn] of S) {
    let why = null;
    try { why = fn(); } catch (e) { why = "stage threw: " + (e && e.message); }
    if (why) broken.push(name + ": " + why);
  }
  return broken;
}
{
  const sb = base();
  const ctl = full(sb, HONEST);
  const t = thin(base(), HONEST);
  const facts = {
    hasReadBack: typeof sb.SettingsProof.readBack === "function",
    hasNeedsDeeper: typeof sb.SettingsProof.needsDeeperRead === "function",
    settingsCount: SETTINGS_EVENTS.length,
    honestNames: HONEST.seed.settingsFrom,
    cutL: HONEST.floorL, lateL: HEAD_L,
    thinHeldNamed: t.SettingsProof.known().some((e) => e.id === HONEST.seed.settingsFrom),
    controlStatus: proveAt(ctl, HONEST, HONEST.floorL).status,
  };
  // The gate's SELF-TEST: each row breaks exactly one precondition and must be caught by the stage
  // written for it. A gate that admits everything is a gate that certifies everything.
  const selftests = [
    ["Z1-subject-present", { hasReadBack: false }],
    ["Z2-two-settings-events", { settingsCount: 1 }],
    ["Z3-seed-names-an-event", { honestNames: null }],
    ["Z4-cut-below-late", { lateL: 0 }],
    ["Z5-thin-never-held-it", { thinHeldNamed: true }],
    ["Z6-control-validates", { controlStatus: "unverifiable" }],
  ];
  ok(gate(facts).length === 0,
    "Z: the gate must ADMIT a sound setup, or nothing below runs for a harness reason", gate(facts));
  for (const [stage, broken] of selftests) {
    const got = gate(Object.assign({}, facts, broken));
    ok(got.some((g) => g.indexOf(stage) === 0),
      "Z: SELF-TEST — the gate must catch a broken " + stage + ". A gate that passes this input " +
      "certifies every reading below it on its own authority", got);
  }
  if (gate(facts).length) {
    console.log("[settings-readback] FAIL — INADMISSIBLE, no results computed:");
    for (const g of gate(facts)) console.log("  · " + g);
    process.exit(1);
  }
}

// ── PART A — `atL` IS THE CUT ────────────────────────────────────────────────────────────────
// The claim under proof is "these were the settings in force AT THE FLOOR'S CUT", so question B has
// to be asked at the cut. J35's entry asked whether the caller should pass a distinct `atL` so that
// `_canAnswerAt`'s floor branch becomes reachable. It should not, and the cost of doing it is not
// "no benefit" but a VALIDATED LIE — which is why this is pinned here rather than left as a comment.
{
  const c1 = full(base(), LYING);
  const atCut = proveAt(c1, LYING, LYING.floorL);
  ok(atCut.status === "mismatched" && atCut.reason === "named-event-was-superseded",
    "A: APPLIED — asked AT THE CUT, a seed naming a settings event that did not exist there is " +
    "caught. This is the case nothing could detect before `settingsFrom` was checked at all", atCut);

  const c2 = full(base(), LYING);
  const atHead = proveAt(c2, LYING, HEAD_L);
  ok(atHead.status === "validated",
    "A: APPLIED — and asked at the HEAD the very same lie comes back VALIDATED. Recorded as the " +
    "measurement rather than the fix: if this ever stops being true the reasoning in " +
    "`_proveFloorSettings` needs re-reading, but while it holds, passing a later position to reach " +
    "the floor branch trades a detection for a forget licence on a false claim", atHead);

  const c3 = thin(base(), HONEST);
  const thinHead = proveAt(c3, HONEST, HEAD_L);
  ok(thinHead.status !== "validated",
    "A: APPLIED — and it never helped the client it was proposed for: an HONEST thin client asked " +
    "at the head still cannot prove its claim, because what it is missing is a READING and not a " +
    "bound", thinHead);
}

// ── PART B — WHICH VERDICTS A DEEPER READ CAN FIX ────────────────────────────────────────────
// Both directions, because the exclusions are the load-bearing half. `mismatched` is CONCLUSIVE:
// paging to look for a kinder answer is precisely the retry that verdict exists to forbid.
{
  const t = thin(base(), HONEST);
  const v1 = proveAt(t, HONEST, HONEST.floorL);
  ok(v1.status === "unverifiable" && v1.reason === "cannot-establish-which-event-governed",
    "B: APPLIED — the thin client's own verdict is the retryable one", v1);
  ok(t.SettingsProof.needsDeeperRead() === true,
    "B: a reading that does not reach the moment asked about is worth paging for");

  // THE SECOND RETRYABLE REASON needs the `fromFloor` branch: question B answers from what the
  // floor NAMES because the reading window holds no settings event at all, so B agrees — and then
  // question A has no event to recompute from. That is a client whose window is genuinely empty of
  // settings changes, which is the ORDINARY case for a channel this quiet.
  const t2 = base();
  t2.SettingsProof.reset();
  t2.SettingsProof.attach({ now: () => 1, pageSettings: null });
  t2.SettingsProof.markReadFrom(HONEST.floorL);       // examined the range above the floor: empty
  const v2 = t2.SettingsProof.proveClaim({
    claimed: HONEST.seed.settings, settingsFrom: HONEST.seed.settingsFrom,
    atL: HEAD_L, floorL: HONEST.floorL, floorNames: HONEST.seed.settingsFrom });
  ok(v2.status === "unverifiable" && v2.reason === "named-event-not-read",
    "B: APPLIED — setup: the second retryable reason is genuinely reachable", v2);
  ok(t2.SettingsProof.needsDeeperRead() === true,
    "B: and a claim whose named event sits below the reading window is worth paging for too");

  // ── EACH EXCLUSION NEEDS A FIXTURE THAT ONLY IT CAN REFUSE ────────────────────────────────
  // Found by mutation, and it is the audit list's *a second gate made the first one unobservable*.
  // Both rows here first used a client that had ALREADY reached genesis, so the `_reachedGenesis`
  // short-circuit answered before the status check was ever consulted — and flipping either one
  // changed nothing. Two gates in sequence, one fixture, neither observable. When a mutation
  // survives, suspect the fixture before the assertion.
  //
  // MISMATCHED on a client that has NOT reached genesis, so only the status check can refuse it.
  const m = thin(base(), HONEST);
  proveAt(m, HONEST, HONEST.floorL);
  ok(m.SettingsProof.needsDeeperRead() === true,
    "B: APPLIED — setup: this client is short of genesis and would otherwise page");
  m.SettingsProof._setVerdictForTest({ status: "mismatched", reason: "named-event-was-superseded" });
  ok(m.SettingsProof.needsDeeperRead() === false,
    "B: a MISMATCH is never worth paging for, even from a client with more of the channel left to " +
    "read. It is conclusive by design, so retrying until the answer improves is the one thing this " +
    "verdict forbids");

  // AND THE OTHER WAY: a retryable REASON on a client that HAS reached genesis, so only the
  // `_reachedGenesis` short-circuit can refuse it.
  const g = thin(base(), HONEST);
  proveAt(g, HONEST, HONEST.floorL);
  ok(g.SettingsProof.verdict().reason === "cannot-establish-which-event-governed",
    "B: APPLIED — setup: the verdict is one a deeper read COULD fix", g.SettingsProof.verdict());
  g.SettingsProof.markGenesisReached();
  ok(g.SettingsProof.needsDeeperRead() === false,
    "B: and a client that has reached genesis never pages again, whatever its verdict says. There " +
    "is nothing earlier to read, so answering yes sends a caller paging an exhausted channel on " +
    "every floor change for the rest of the session");

  const gv = full(base(), HONEST);
  proveAt(gv, HONEST, HONEST.floorL);
  ok(gv.SettingsProof.needsDeeperRead() === false,
    "B: APPLIED — and a validated verdict is not worth paging for either");

  // ── THE STATUS CHECK IS DOMINATED BY THE REASON CHECK, AND THAT IS PINNED HERE ────────────
  // A RECORDED SURVIVOR (`tools/probes/mutate-settings-readback.js` row 3): letting `mismatched`
  // through `needsDeeperRead`'s status test changes no answer, because neither reason a deeper read
  // can fix is ever recorded WITH a mismatch. The clause states the rule; the reason list enforces
  // it — the same shape as `_inRange`'s kind check and `Vouch.bandOf`'s early return, both on
  // `roles.md` §9's do-not-delete list.
  //
  // Asserting "the mutation survives" would be asserting a fact about a probe. What is asserted
  // instead is the PROPERTY that makes it survive: the two retryable reasons belong to
  // `unverifiable` alone. The day a mismatch acquires one of them the clause becomes load-bearing —
  // and this row goes red first, rather than the redundancy quietly turning into a live bug.
  {
    const RETRYABLE = ["cannot-establish-which-event-governed", "named-event-not-read"];
    const seen = {};
    const cases = [
      ["thin/honest at cut", () => proveAt(thin(base(), HONEST), HONEST, HONEST.floorL)],
      ["thin/lying at cut", () => proveAt(thin(base(), LYING), LYING, LYING.floorL)],
      ["full/lying at cut", () => proveAt(full(base(), LYING), LYING, LYING.floorL)],
      ["full/honest at cut", () => proveAt(full(base(), HONEST), HONEST, HONEST.floorL)],
      ["full/lying at head", () => proveAt(full(base(), LYING), LYING, HEAD_L)],
      ["no pointer", () => {
        const s = thin(base(), HONEST);
        return s.SettingsProof.proveClaim({ claimed: HONEST.seed.settings, settingsFrom: null,
          atL: HONEST.floorL, floorL: HONEST.floorL, floorNames: null });
      }],
      ["partial named event", () => {
        const s = base();
        s.SettingsProof.reset();
        s.SettingsProof.ingest([F.reducerEvent("$p", 2, 1000, "@owner:hs", F.RANK.owner,
          { t: "ddjp.room.settings", s: { maxLen: 300 } })]);
        s.SettingsProof.markGenesisReached();
        return s.SettingsProof.proveClaim({ claimed: EARLY, settingsFrom: "$p", atL: 5,
          floorL: -1, floorNames: undefined });
      }],
      ["named event below the window", () => {
        const s = base();
        s.SettingsProof.reset();
        s.SettingsProof.markReadFrom(HONEST.floorL);
        return s.SettingsProof.proveClaim({ claimed: HONEST.seed.settings,
          settingsFrom: HONEST.seed.settingsFrom, atL: HEAD_L, floorL: HONEST.floorL,
          floorNames: HONEST.seed.settingsFrom });
      }],
    ];
    for (const [name, run] of cases) {
      const v = run();
      seen[v.status + "/" + (v.reason || "null")] = name;
      if (RETRYABLE.indexOf(v.reason) >= 0) {
        ok(v.status === "unverifiable",
          "B: a reason a deeper read can fix must only ever be recorded with `unverifiable`. If a " +
          "MISMATCH can carry one, `needsDeeperRead`'s status test stops being redundant and starts " +
          "being the only thing stopping a conclusive verdict from being retried until it changes",
          { case: name, verdict: v });
      }
    }
    const statuses = Object.keys(seen);
    ok(statuses.length >= 4,
      "B: APPLIED — the sweep must actually reach several distinct verdicts, or it is asserting " +
      "over one row and reporting agreement", seen);
    ok(statuses.some((s) => s.indexOf("mismatched/") === 0),
      "B: APPLIED — including at least one MISMATCH, which is the status the claim is about", seen);
    ok(RETRYABLE.every((r) => statuses.some((s) => s.indexOf("unverifiable/" + r) === 0)),
      "B: APPLIED — and both retryable reasons, or the pairing is asserted over reasons nothing " +
      "produced", seen);
  }

  // The exclusions that are about the EVENT rather than the reading.
  const n = thin(base(), HONEST);
  n.SettingsProof._setVerdictForTest({ status: "unverifiable", reason: "partial-event" });
  ok(n.SettingsProof.needsDeeperRead() === false,
    "B: APPLIED — and a verdict about the named event's own CONTENT is not a reading problem. " +
    "Reading more of the channel cannot change what an event contains");
  n.SettingsProof._setVerdictForTest({ status: "unverifiable", reason: "names-no-settings-event" });
  ok(n.SettingsProof.needsDeeperRead() === false,
    "B: APPLIED — and neither is a claim with no pointer at all. Read through verdict(), so the " +
    "seam reaches the PREDICATE rather than only the report");
}

// ── THE PRODUCTION SANDBOX ───────────────────────────────────────────────────────────────────
// `matrixbridge.js` runs headless with the browser and SDK surfaces stubbed — the same shape
// `check-wiring` PART C uses, which is what makes a WIRING assertion possible at all here.
function wired() {
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/floor.js", "backends/backend1/continuity.js",
    "backends/backend1/history.js", "backends/backend1/settingsproof.js",
    "backends/backend1/dials.js", "backends/backend1/eventcache.js",
    "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
  ], { window: { location: { origin: "", pathname: "" }, addEventListener: () => {} },
       document: { addEventListener: () => {} },
       localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
       navigator: {}, indexedDB: null, Date: Date,
       setTimeout: (f) => { if (typeof f === "function") f(); return 1; },
       clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} });
  sb.MatrixBridge.seedClock("!space:hs");
  sb.MatrixBridge.setRoomScope({ settings_owner: "!settings-owner:hs" });
  sb.MatrixBridge._wireConcepts({ events_owner: "!events-owner:hs",
                                  settings_owner: "!settings-owner:hs" });
  return sb;
}
// Let the read-back's promise chain drain. Node's vm shares the host microtask queue, so one turn
// of the host event loop is enough; asserted rather than assumed by PART C's `paged` check.
const drain = () => new Promise((r) => setTimeout(r, 0));

// Plant a thin client inside a WIRED tree and hand it a spy pager, then adopt a floor for real.
function stage(sb, floor, pager) {
  const { StreamManager, SettingsProof, Floor } = sb;
  StreamManager.reset(); Floor.reset(); SettingsProof.reset();
  for (const e of LOG.filter((x) => x.l > floor.floorL)) StreamManager.ingest(F.toRaw(e));
  StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
  SettingsProof.markReadFrom(floor.floorL);
  const calls = [];
  SettingsProof.attach({ now: () => 1, pageSettings: (from, to) => {
    calls.push({ from: from, to: to });
    return Promise.resolve(pager(from, to));
  } });
  return calls;
}

(async () => {

  // ── PART C — THE WIRE, DRIVEN THROUGH THE REAL SUBSCRIBER ──────────────────────────────────
  {
    const sb = wired();

    // FIRST: the wiring installs a REAL pager. A wire that attaches `null` is the state J35 fixed,
    // and it would make every assertion below pass against a spy the production code never asks for.
    const nullTree = wired();
    nullTree.SettingsProof.reset();
    const noPager = await nullTree.SettingsProof.readBack(0);
    ok(noPager && noPager.reason !== "no-pager",
      "C: APPLIED — `_wireConcepts` attaches a real settings pager. Attached as `null` this answers " +
      "'no-pager' and the read-back can never run, which is exactly the unfinished wire J35 closed",
      noPager);

    const calls = stage(sb, HONEST, () => SETTINGS_EVENTS);
    const before = sb.SettingsProof.verdict();
    const heldBefore = sb.StreamManager.getLog().length;
    ok(before.status !== "validated",
      "C: APPLIED — setup: this client cannot prove its claim before the read-back", before);

    // THE PRODUCTION PATH. `Floor.adopt` emits `adopted`; the subscriber `_wireConcepts` registered
    // is what must do the rest. Nothing here calls readBack, proveClaim or trimToFloor.
    const adopted = sb.Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
    ok(adopted === true, "C: APPLIED — the floor was genuinely adopted, so the emission happened");
    await drain();

    ok(calls.length === 1,
      "C: adopting a floor this client cannot prove PAGES the settings channel. Unwired, the verdict " +
      "stays unverifiable for the whole session and a thin or post-trim client never forgets " +
      "anything — the machinery all reporting success while forgetting has never once run", calls);
    ok(calls.length === 1 && calls[0].from === 0,
      "C: APPLIED — and it asks to GENESIS. Stopping at a trusted floor is the other route, and it " +
      "cannot serve the claim of the floor it would bound on: the floor would be its own evidence",
      calls);
    const after = sb.SettingsProof.verdict();
    ok(after.status === "validated",
      "C: and the verdict then MOVES OFF unverifiable, which is the whole point of the wire", after);
    ok(sb.SettingsProof.licensesForget() === true,
      "C: APPLIED — so the forget licence is finally earnable by a client that did not replay to " +
      "genesis");
    ok(sb.StreamManager.getLog().length < heldBefore || sb.StreamManager._trimState() !== null,
      "C: APPLIED — and the TRIM follows the proof. A licence nothing acts on is the " +
      "flag-nobody-reads failure one level up",
      { heldBefore: heldBefore, heldAfter: sb.StreamManager.getLog().length,
        boundary: sb.StreamManager._trimState() });

    // ── THE CLIENT THAT NEEDS NO PAGE MUST NOT PAY FOR ONE ────────────────────────────────────
    // A full-replay client can already answer, so the whole read-back must be inert for it. Without
    // this row the suite would be blind to the inline prove being deleted: the thin row above would
    // still pass, because the deep path would prove for it. Two rows on one axis, and each covers
    // what the other cannot.
    {
      const fsb = wired();
      const { StreamManager, SettingsProof, Floor } = fsb;
      StreamManager.reset(); Floor.reset(); SettingsProof.reset();
      for (const e of LOG) StreamManager.ingest(F.toRaw(e));
      StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
      SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
      SettingsProof.markGenesisReached();
      const fcalls = [];
      SettingsProof.attach({ now: () => 1,
        pageSettings: (from, to) => { fcalls.push({ from: from, to: to }); return Promise.resolve(SETTINGS_EVENTS); } });
      const heldBefore2 = StreamManager.getLog().length;
      Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
      await drain();
      ok(SettingsProof.verdict().status === "validated",
        "C: APPLIED — a full-replay client proves its claim on the INLINE path, with no paging at " +
        "all. Deleting that call would leave the thin row above green, because the deep path would " +
        "prove for it — so this row is what makes the inline prove observable",
        SettingsProof.verdict());
      ok(fcalls.length === 0,
        "C: APPLIED — and it pages NOTHING. A read-back fired on every adoption would put a " +
        "scrollback on the floor cadence for every client in the room, to answer a question they " +
        "could already answer", fcalls);
      ok(StreamManager.getLog().length < heldBefore2,
        "C: APPLIED — and it trims", { before: heldBefore2, after: StreamManager.getLog().length });
    }

    // ── AND THE CALLER ASKS ABOUT THE CUT ─────────────────────────────────────────────────────
    // PART A pins that `proveClaim` answers differently at the cut and at the head. This pins that
    // the PRODUCTION CALLER picks the cut — which PART A cannot see, because it calls `proveClaim`
    // itself. Without this row, moving `atL` later in `_proveFloorSettings` breaks nothing in the
    // suite: the honest client still validates, and the lie goes through silently.
    {
      const lsb = wired();
      const { StreamManager, SettingsProof, Floor } = lsb;
      StreamManager.reset(); Floor.reset(); SettingsProof.reset();
      for (const e of LOG) StreamManager.ingest(F.toRaw(e));
      StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
      SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
      SettingsProof.markGenesisReached();
      SettingsProof.attach({ now: () => 1, pageSettings: () => Promise.resolve(SETTINGS_EVENTS) });
      Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, LYING), tier: 0 });
      await drain();
      const v = SettingsProof.verdict();
      ok(v.status === "mismatched",
        "C: the caller asks about the FLOOR'S CUT. A seed naming a settings event that did not " +
        "exist at its cut must come back mismatched through the production path — asked at the log " +
        "head instead it comes back validated (PART A), so this is the assertion that stops the " +
        "bound quietly moving later", v);
      ok(SettingsProof.licensesForget() === false,
        "C: APPLIED — and that lie earns no forget licence");
      ok(StreamManager._trimState() === null,
        "C: APPLIED — and nothing is dropped on it", StreamManager._trimState());
    }

    // ORDER, OBSERVED. Page -> prove -> trim, because the trim destroys the evidence the proof
    // reads. A string index in the source proves an order in the FILE; this proves it at runtime.
    const seq = [];
    const sb2 = wired();
    const calls2 = stage(sb2, HONEST, () => { seq.push("page"); return SETTINGS_EVENTS; });
    const realTrim = sb2.StreamManager.trimToFloor;
    sb2.StreamManager.trimToFloor = function () { seq.push("trim"); return realTrim.apply(this, arguments); };
    const realProve = sb2.SettingsProof.proveClaim;
    sb2.SettingsProof.proveClaim = function () { seq.push("prove"); return realProve.apply(this, arguments); };
    sb2.Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
    await drain();
    ok(calls2.length === 1 && seq.indexOf("page") >= 0,
      "C: APPLIED — setup: the observed sequence actually recorded a page", seq);
    // THE FIRST TRIM AFTER THE PAGE, not just any trim. The first version of this asked whether
    // SOME prove preceded SOME trim, which a sequence of trim-prove-trim satisfies — so a mutation
    // that trimmed first and then re-proved and re-trimmed survived it. The rule is that nothing
    // trims between the page and the proof, so the assertion has to name the FIRST one.
    const iPage = seq.indexOf("page");
    const firstProve = seq.findIndex((s, i) => s === "prove" && i > iPage);
    const firstTrim = seq.findIndex((s, i) => s === "trim" && i > iPage);
    ok(firstProve > iPage && firstTrim > firstProve,
      "C: the read-back path re-PROVES before it re-TRIMS, with nothing trimming in between. " +
      "Reversing them asks a question whose evidence was just destroyed, and gets 'cannot tell' for " +
      "a reason we caused", seq);
  }

  // ── PART D — A FAILED PAGE WITHHOLDS, AND `[]` IS NOT A FAILURE ─────────────────────────────
  // The refusals are paired with an admission (PART C's working pager), so each is attributable to
  // the pager's answer rather than to a fixture that never reached the wire.
  {
    for (const [name, pager, expectRetryable] of [
      ["threw", () => { throw new Error("scrollback failed"); }, true],
      ["null", () => null, true],
      ["not-an-array", () => 42, true],
    ]) {
      const sb = wired();
      const calls = stage(sb, HONEST, pager);
      sb.Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
      await drain();
      ok(calls.length === 1,
        "D: APPLIED — setup: the " + name + " case genuinely reached the pager", calls);
      ok(sb.SettingsProof.licensesForget() === false,
        "D: a page that " + name + " must withhold the forget licence rather than guess. Trimming " +
        "on an unread channel drops history on evidence nobody examined");
      ok(sb.StreamManager._trimState() === null,
        "D: APPLIED — and nothing is trimmed", sb.StreamManager._trimState());
      ok(sb.SettingsProof.needsDeeperRead() === expectRetryable,
        "D: APPLIED — and it stays RETRYABLE, so the next floor change asks again. A failure that " +
        "recorded itself as an answer would end forgetting for the session");
    }

    // THE PAGER'S OWN HONESTY, which only became load-bearing when `readBack` acquired a caller.
    // `[]` means *I examined the range and it was empty* — a normal answer for a channel this quiet
    // — so a could-not-read that returns `[]` claims genesis coverage on no evidence. Measured: the
    // verdict then goes `mismatched`, which §8.1b makes CONCLUSIVE, so the room never forgets again
    // AND `needsDeeperRead()` correctly stops retrying. It accuses an honest room, permanently.
    {
      const sb = wired();
      stage(sb, HONEST, () => []);
      sb.Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
      await drain();
      const v = sb.SettingsProof.verdict();
      ok(v.status === "mismatched",
        "D: APPLIED — setup: an EMPTY-ARRAY answer really does produce the conclusive verdict, " +
        "which is what makes the source assertion below load-bearing rather than tidy", v);
      const fs = require("fs");
      const src = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
      const pager = src.slice(src.indexOf("function _settingsPager()"),
                              src.indexOf("function _wireConcepts("));
      ok(pager.length > 200, "D: APPLIED — setup: the pager's source was located", pager.length);
      ok(!/return \[\];/.test(pager),
        "D: `_settingsPager` must not answer a could-not-read with `[]`. Every one of its four " +
        "failure exits used to, and `[]` is indistinguishable from a genuinely empty range — which " +
        "is how a client that read NOTHING claimed genesis coverage and then recorded a conclusive " +
        "mismatch against an honest room",
        (pager.match(/return \[\];/g) || []).length);
      ok((pager.match(/return null;/g) || []).length >= 4,
        "D: APPLIED — and all four of them say `null` instead, which `readBack` refuses as " +
        "`page-failed`. Counted rather than located, so inserting a line above one does not move it",
        (pager.match(/return null;/g) || []).length);
    }
  }

  // ── PART E — THE CONTINUATION AND THE PAGE BOTH BELONG TO THE ROOM THEY STARTED IN ─────────
  // Per-room state surviving a room change is its own bug class here (CONCEPTS.md §3.11, six
  // modules and counting). Two separate mechanisms, and mutation showed they need two separate
  // rows: with one row each masked the other, because the continuation clears the latch itself on
  // the way past — so the latch's clearing in `resetCheckpoints` only matters when a page NEVER
  // resolves, which is exactly the hung-scrollback case it exists for.
  {
    // E1 — A PAGE THAT NEVER RESOLVES MUST NOT STRAND THE NEXT ROOM. Left set, the latch means the
    // next room's first shallow reading never pages, and forgetting silently never starts there.
    const sb = wired();
    let stranded = false;
    stage(sb, HONEST, () => new Promise(() => { stranded = true; }));   // never settles
    sb.Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
    await drain();
    ok(stranded === true, "E: APPLIED — setup: a page is genuinely in flight and will not settle");

    sb.MatrixBridge.seedClock("!other-space:hs");   // room entry: this is what moves the space id
    sb.MatrixBridge.setRoomScope({ settings_owner: "!other-settings:hs" });
    sb.MatrixBridge.resetCheckpoints();       // the room change
    const calls2 = stage(sb, HONEST, () => SETTINGS_EVENTS);
    sb.Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
    await drain();
    ok(calls2.length === 1,
      "E: a room change clears the in-flight read-back latch. A page that never settles — a hung " +
      "scrollback is the ordinary way — would otherwise leave it set for the rest of the session, " +
      "and this client would quietly never forget again in any room it entered afterwards", calls2);
  }
  {
    // E2 — AND A PAGE THAT RESOLVES LATE MUST NOT ACT ON THE ROOM WE LEFT. Driven through the REAL
    // pager, because the damage happens INSIDE `readBack` — it ingests what the pager returned
    // before the continuation gets to check anything, so a check living only in the continuation
    // would let the previous room's settings events into the reader `resetCheckpoints` had just
    // emptied, and mark genesis reached over them. Found by mutation; the first shape of this file
    // asserted on the verdict instead and passed for an unrelated reason (the floor is reset too, so
    // there was nothing to prove either way).
    const sb = wired();
    let release = null;
    const fakeRoom = { roomId: "!settings-owner:hs", timeline: [] };
    sb.MatrixBridge._setClientForTest({
      getRoom: () => fakeRoom,
      scrollback: () => new Promise((r) => { release = r; }),
    });
    const { StreamManager, SettingsProof, Floor } = sb;
    StreamManager.reset(); Floor.reset(); SettingsProof.reset();
    for (const e of LOG.filter((x) => x.l > HONEST.floorL)) StreamManager.ingest(F.toRaw(e));
    StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
    SettingsProof.ingest(StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings"));
    SettingsProof.markReadFrom(HONEST.floorL);
    let trims = 0;
    const realTrim = StreamManager.trimToFloor;
    StreamManager.trimToFloor = function () { trims++; return realTrim.apply(this, arguments); };

    Floor.adopt({ floor: Object.assign({ u: "@owner:hs" }, HONEST), tier: 0 });
    await drain();
    ok(typeof release === "function",
      "E: APPLIED — setup: the REAL pager is mid-scrollback, so the room check under test is the " +
      "one in production rather than one the spy performed for it");

    const trimsBefore = trims;
    sb.MatrixBridge.seedClock("!other-space:hs");   // room entry: this is what moves the space id
    sb.MatrixBridge.setRoomScope({ settings_owner: "!other-settings:hs" });
    sb.MatrixBridge.resetCheckpoints();       // the room change, mid-page
    // RED BY CRASH IS NOT RED ENOUGH (`08-build-and-deploy.md` §Writing a guard), and this file has
    // now been taught it twice by the same shape: if no page was in flight the setup assertion above
    // has already recorded it, and calling an absent `release` here would throw before any assertion
    // below ran — turning five unrelated mutations into crashes attributed to nothing.
    if (typeof release === "function") release();
    await drain();

    ok(SettingsProof.known().length === 0,
      "E: a page resolving after a room change must not INGEST. `readBack` ingests before the " +
      "continuation runs, so a reader emptied for the new room would be refilled with the previous " +
      "room's rules — every DDJP room names its channels identically, so a page that does not ask " +
      "which room is ours is reading somebody else's", SettingsProof.known().map((e) => e.id));
    ok(SettingsProof.coverage().reachedGenesis === false,
      "E: APPLIED — and it must not claim genesis coverage over the room we left. Claiming complete " +
      "coverage of a channel never read for this room is the confident wrong answer in its " +
      "strongest form", SettingsProof.coverage());
    ok(trims === trimsBefore,
      "E: APPLIED — and nothing trims on the strength of it",
      { before: trimsBefore, after: trims });
  }

  done("the settings read-back is REACHED from a running client and asks about the right moment: " +
    "adopting a floor whose settings claim this client cannot yet prove pages the settings channel " +
    "to genesis, re-proves and only then trims — driven through the real floor-change subscriber " +
    "rather than by calling readBack, because the module was correct and reached by nothing for " +
    "three releases; `atL` is the CUT and asking at the log head instead VALIDATES a seed naming an " +
    "event that did not exist there (measured both ways, since the tempting improvement trades a " +
    "detection for a licence on a false claim, and never helped the honest thin client it was " +
    "proposed for); a deeper read is attempted only for the two verdicts a reading can fix and " +
    "never for the conclusive one; a page that throws, returns null or returns a non-array " +
    "withholds the licence and stays retryable; the pager may no longer answer a could-not-read " +
    "with an empty array, because that claimed genesis coverage on no evidence and recorded a " +
    "CONCLUSIVE mismatch against an honest room; and a page resolving after a room change proves " +
    "nothing, while the in-flight latch is cleared so the next room can still page.");
})();
