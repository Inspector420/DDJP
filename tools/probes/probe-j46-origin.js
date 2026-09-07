// tools/probes/probe-j46-origin.js
//
// J46 — DOES THE ORIGIN MARKER ALREADY EXIST? Asked before designing anything, because if an
// imported checkpoint already carries a committed, tamper-proof declaration that it ORIGINATES
// rather than SUMMARISES, then option 2 costs nothing: no new field, no format change, no freeze
// cost, and nothing uncommitted deciding whether a client discards its history.
//
// `fingerprint()` commits n, prev, seed, floorL, thin and covers. `buildImport` writes
// n=1, prev=null, thin=true and a single-event `covers`. The question is whether any of that, or
// any conjunction of it, is UNREACHABLE by an honestly-sealed checkpoint.
//
// ── THE FAILURE DIRECTIONS ARE ASYMMETRIC, AND THAT DECIDES THE STANDARD OF PROOF ────────────
//   FALSE NEGATIVE — the predicate misses an import. The import stays inert. That is today's
//                    behaviour, so the cost is zero and the failure is safe.
//   FALSE POSITIVE — the predicate fires on an HONEST checkpoint. A client then treats a seed that
//                    summarises its own log as one that replaces it, and discards real history on
//                    the strength of a claim nobody made. Catastrophic, silent, and irreversible.
// So the bar is not "usually right". It is ZERO false positives across every honest shape a
// checkpoint can reach. A single reachable collision sends this back to the format question.
//
// EVERY ROW SITS BEHIND AN ADMISSIBILITY GATE with its own self-test. Checkpoints are built by
// `Checkpoint.seal()` through an attached env — the production path — never assembled by hand,
// because the whole question is what production actually commits.

const path = require("path");
const assert = require("assert");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));

const BACKEND = "backends/backend1/";
function fresh() {
  return loadInContext([
    "core/logger.js",
    BACKEND + "ranks.js",
    BACKEND + "consensushash.js",
    BACKEND + "trustpolicy.js",
    BACKEND + "statederiver.js",
    BACKEND + "checkpointformat.js",
    BACKEND + "dials.js",
    BACKEND + "session.js",
    BACKEND + "scheduler.js",
    BACKEND + "floor.js",
    BACKEND + "eventcache.js",
    BACKEND + "streammanager.js",
    BACKEND + "vouch.js",
    BACKEND + "checkpoint.js",
    BACKEND + "settingsproof.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

// THE GATE AWAITS, AND IT CHECKS THE SHAPE OF WHAT IT GOT. Both halves were missing on the first
// run and the first row proved it: `Checkpoint.seal()` is async, `measure()` returned a PROMISE,
// and the gate printed `undefined` as the finding — an admissible-looking row with no reading in
// it, which is precisely the shape this gate exists to refuse. The self-test did not catch it
// because every case it fed the gate was synchronous, so the gate was tested on inputs shaped
// unlike the ones it would receive. Refusing a result that carries no `finding` is the general
// fix; awaiting is the specific one.
async function row(id, question, pre, measure) {
  const bad = (pre || []).filter((p) => !p.ok);
  if (bad.length) {
    console.log("  " + id + "  INADMISSIBLE — " + bad.map((b) => b.name).join(" | "));
    return null;
  }
  let out;
  try { out = await measure(); }
  catch (e) {
    console.log("  " + id + "  INADMISSIBLE — the measurement threw: " + (e && e.message));
    return null;
  }
  if (!out || typeof out.finding !== "string") {
    console.log("  " + id + "  INADMISSIBLE — the measurement returned no `finding` (got "
      + (out === undefined ? "undefined" : typeof out) + "), so there is nothing to read");
    return null;
  }
  console.log("  " + id + "  " + question);
  console.log("       " + out.finding);
  return out;
}

async function selfTest() {
  const seen = [];
  const log = console.log;
  console.log = (s) => seen.push(String(s));
  let ranMeasure = false;
  const a = await row("ST1", "q", [{ name: "a precondition that is false", ok: false }],
    () => { ranMeasure = true; return { finding: "SHOULD NEVER PRINT" }; });
  const b = await row("ST2", "q", [{ name: "fine", ok: true }], () => { throw new Error("boom"); });
  const c = await row("ST3", "q", [{ name: "fine", ok: true }], () => ({ finding: "admitted", v: 1 }));
  // ST4 and ST5 are the two the first run needed and did not have.
  const d = await row("ST4", "q", [{ name: "fine", ok: true }], () => ({ v: 1 }));
  const e = await row("ST5", "q", [{ name: "fine", ok: true }],
    async () => ({ finding: "awaited", v: 2 }));
  console.log = log;
  assert.ok(a === null, "gate self-test: a failed precondition must return null");
  assert.ok(ranMeasure === false, "gate self-test: a failed precondition must SKIP the measurement");
  assert.ok(seen.some((s) => /INADMISSIBLE.*a precondition that is false/.test(s)),
    "gate self-test: the refusal must NAME the stage that broke");
  assert.ok(b === null && seen.some((s) => /INADMISSIBLE.*threw: boom/.test(s)),
    "gate self-test: a throwing measurement is inadmissible, not a finding");
  assert.ok(c && c.v === 1 && seen.some((s) => /admitted/.test(s)),
    "gate self-test: CONTROL — an admissible row still runs and prints");
  assert.ok(d === null && seen.some((s) => /INADMISSIBLE.*no `finding`/.test(s)),
    "gate self-test: a result with no `finding` is refused rather than printed as undefined — "
    + "the defect the first run of this probe actually had");
  assert.ok(e && e.v === 2 && seen.some((s) => /awaited/.test(s)),
    "gate self-test: an ASYNC measurement is awaited and read, not printed as a promise. Every "
    + "case above this one is synchronous, which is why the gate passed its own self-test while "
    + "silently mishandling the first four real rows");
  console.log("[gate] self-test PASS — a false precondition skips the measurement and names "
    + "itself, a throw is inadmissible, a result carrying no `finding` is refused rather than "
    + "printed as `undefined`, an async measurement is awaited, and an admissible row still runs");
}

// A client wired the way transport wires one, so `seal()` reaches the real gates.
function client(sb, opts) {
  const o = opts || {};
  sb.Session._setPhaseForTest("live");
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => F.RANK.owner, trimmed: () => !!(o.trimmed && o.trimmed()) });
  sb.Checkpoint.attach({
    send: async () => {}, myUserId: () => o.me || "@owner:hs",
    log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => F.RANK.owner,
    amOwner: () => true, held: () => [], isLegal: () => true,
    now: () => (o.now ? o.now() : Date.now()),
    thin: () => !!(o.trimmed && o.trimmed()),
    floorPos: () => (sb.Floor.current() ? sb.Floor.position() : null),
    floorTs: () => sb.Floor.anchorTs(),
  });
}

// The committed fields only. `seed` is committed too and is deliberately NOT read here: reading it
// is recompute, which is the inference this whole question exists to avoid.
const committed = (cp) => ({ n: cp.n, prev: cp.prev, floorL: cp.floorL, thin: cp.thin,
                             covers: cp.covers,
                             singleEvent: String(cp.covers).split("..")[0] === String(cp.covers).split("..")[1] });
const show = (c) => "n=" + c.n + " prev=" + (c.prev === null ? "null" : "<h>")
  + " floorL=" + c.floorL + " thin=" + c.thin + " singleEventCovers=" + c.singleEvent;

async function main() {
  await selfTest();
  if (process.argv.indexOf("--selftest") >= 0) return;
  console.log("");
  console.log("probe-j46-origin — is the origin declaration already committed?");
  console.log("===============================================================");
  console.log("");
  console.log("R18-R21  what each shape of checkpoint actually commits");

  // ── R18 — an ordinary room's FIRST seal, no floor held. This is the shape most likely to
  // collide, because `n = floor ? floor.n + 1 : _seq` makes it n=1 and `prev = floor ? floor.h
  // : null` makes it prev=null — the same pair `buildImport` writes.
  const r18 = await row("R18", "an ordinary room's FIRST seal (no floor held) — the likeliest collision",
    [{ name: "fixtures load", ok: true }],
    async () => {
      const sb = fresh();
      client(sb);
      const r = F.playingRoom({ songs: 3 });
      for (const e of F.sortLog(r.log)) sb.StreamManager.ingest(F.toRaw(e));
      const res = await sb.Checkpoint.seal();
      if (!res.ok) throw new Error("the seal was refused: " + res.reason);
      const c = committed(res.checkpoint);
      return { c, finding: show(c) };
    });

  // ── R19 — a seal made WITH a floor held. `prev` becomes the floor's fingerprint.
  // THE CLOCK IS ADVANCED RATHER THAN THE GATE BYPASSED. The second seal is refused `not-due`
  // otherwise — the re-entrancy window measured from `_lastOwnSealAt`, both sides a local clock —
  // and a probe that reached for `_setForTest` here would be measuring a path production does not
  // take. Moving `now` forward is what actually happens between two seals.
  const r19 = await row("R19", "a seal made WITH a floor held",
    [{ name: "the first-seal shape was measured", ok: !!r18 }],
    async () => {
      const sb = fresh();
      let clock = 1000000;
      client(sb, { now: () => clock });
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const first = await sb.Checkpoint.seal();          // seals AND adopts its own floor
      if (!first.ok) throw new Error("first seal refused: " + first.reason);
      for (let i = 0; i < 6; i++) {
        sb.StreamManager.ingest(F.rawEvent("$more" + i, 60 + i, 2000000 + i * 600000, "@dj:hs",
          F.RANK.player, { t: "ddjp.dj.declare", v: "SONGM" + i }));
      }
      clock += 6 * 3600 * 1000;                          // six hours later
      const second = await sb.Checkpoint.seal();
      if (!second.ok) throw new Error("second seal refused: " + second.reason);
      const c = committed(second.checkpoint);
      return { c, finding: show(c) + "   (floor held at seal time: " + !!sb.Floor.current() + ")" };
    });

  // ── R20 — a THIN client's first seal. This is the shape that could carry thin=true, so it is
  // the one that decides whether `thin` is usable as half of a discriminator.
  const r20 = await row("R20", "a THIN client's own first seal (it has trimmed below an adopted floor)",
    [{ name: "the with-floor shape was measured", ok: !!r19 }],
    async () => {
      const sb = fresh();
      let trimmed = false;
      let clock = 1000000;
      client(sb, { trimmed: () => trimmed, me: "@thin:hs", now: () => clock });
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      // Adopt somebody else's floor, then declare ourselves trimmed below it.
      const cut = log[2];
      const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
      const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, floorL: cut.l,
                   thin: false, covers: log[0].eventId + ".." + cut.eventId };
      cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
      sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 1000);
      const adopted = sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
      if (!adopted) throw new Error("the thin client did not adopt a floor to trim below");
      trimmed = true;
      for (let i = 0; i < 6; i++) {
        sb.StreamManager.ingest(F.rawEvent("$t" + i, 70 + i, 2000000 + i * 600000, "@dj:hs",
          F.RANK.player, { t: "ddjp.dj.declare", v: "SONGT" + i }));
      }
      clock += 6 * 3600 * 1000;
      const res = await sb.Checkpoint.seal();
      if (!res.ok) throw new Error("the thin seal was refused: " + res.reason);
      const c = committed(res.checkpoint);
      if (c.thin !== true) throw new Error("the fixture did not produce a THIN seal, so it cannot "
        + "test the shape it exists for");
      return { c, finding: show(c) + "   <- the only honest shape that carries thin=true" };
    });

  // ── R21 — the IMPORT.
  const r21 = await row("R21", "an IMPORTED checkpoint (buildImport)",
    [{ name: "the thin shape was measured", ok: !!r20 }],
    () => {
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
      const cut = log[2];
      const cpA = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seedA, floorL: cut.l,
                    thin: false, covers: log[0].eventId + ".." + cut.eventId };
      cpA.h = sb.CheckpointFormat.fingerprint(cpA.n, cpA.prev, cpA.seed, cpA.floorL, cpA.thin, cpA.covers);
      const file = JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({ mode: "full",
        snapshots: [cpA], keyset: Object.keys(sb.StateDeriver.defaultSettings()),
        author: { rank: "owner" } })));
      const read = sb.StreamManager.importFile(file);
      const built = sb.Checkpoint.buildImport(read.seed,
        { settingsFrom: "$gen", eventId: "$gen", l: 2 });
      const c = committed(built.cp);
      return { c, finding: show(c) };
    });

  // ── R22 — THE USER'S PROPOSAL, TESTED ON ITS OWN TERMS FIRST ───────────────────────────────
  console.log("");
  console.log("R22-R24  is any conjunction of committed fields a SOUND discriminator?");

  const r22 = await row("R22", "PROPOSAL A — n=1 & prev=null, alone. Does an honest seal collide?",
    [{ name: "all four shapes measured", ok: !!(r18 && r19 && r20 && r21) }],
    () => {
      const pA = (c) => c.n === 1 && c.prev === null;
      const honest = [["R18 first seal", r18.c], ["R19 with floor", r19.c], ["R20 thin", r20.c]];
      const falsePos = honest.filter(([, c]) => pA(c)).map(([nm]) => nm);
      return { falsePos, hits: pA(r21.c),
        finding: "fires on the import: " + pA(r21.c)
          + "   |  FALSE POSITIVES on honest checkpoints: "
          + (falsePos.length ? falsePos.join(", ") : "none")
          + "   -> " + (falsePos.length ? "UNSOUND" : "sound so far") };
    });

  // ── R23 — the conjunction that survives R22, if any. `prev === null` says the sealer held NO
  // floor; `thin === true` says it computed from a seed rather than from the room's beginning.
  // Together they say: my seed did not come from a floor I hold, and it is not this room's
  // beginning either. That is the origin claim, made of two statements the AUTHOR committed —
  // a reading rather than a recompute.
  const r23 = await row("R23", "PROPOSAL B — prev=null AND thin=true. Does an honest seal collide?",
    [{ name: "the thin shape is the one that could collide, and it was measured",
       ok: !!(r20 && r20.c.thin === true) }],
    () => {
      const pB = (c) => c.prev === null && c.thin === true;
      const honest = [["R18 first seal", r18.c], ["R19 with floor", r19.c], ["R20 thin", r20.c]];
      const falsePos = honest.filter(([, c]) => pB(c)).map(([nm]) => nm);
      return { falsePos, hits: pB(r21.c),
        finding: "fires on the import: " + pB(r21.c)
          + "   |  FALSE POSITIVES on honest checkpoints: "
          + (falsePos.length ? falsePos.join(", ") : "none")
          + "   -> " + (falsePos.length ? "UNSOUND" : "no collision in the enumerated shapes") };
    });

  // ── R24 — AND THE ENUMERATION IS THE WEAK PART, SO ATTACK IT DIRECTLY. R23 is only worth
  // anything if `prev=null AND thin=true` is unreachable by CONSTRUCTION rather than merely absent
  // from three fixtures. `prev=null` means `Floor.current()` was null at seal time; `thin=true`
  // means the client had trimmed. So the question is whether a client can hold NO floor while
  // having trimmed — and the answer lives in what a weakening floor does to a trimmed client.
  const r24 = await row("R24", "THE STRUCTURAL QUESTION — can a client have trimmed and hold NO floor?",
    [{ name: "proposal B survived the enumeration", ok: !!(r23 && r23.falsePos.length === 0) }],
    () => {
      const out = {};
      // A SUBSTITUTE floor is the subject, because `revalidate` only re-checks a `quorum` grade —
      // `real` and `verified` rest on evidence that cannot decay. So the observer must be a rank
      // that staff floors BIND: `select` skips any checkpoint whose tier is below the observer's
      // (`t > myTier` -> continue), so an OWNER observer accepts owner floors only.
      //
      // THE FIRST VERSION OF THIS ROW USED AN OWNER OBSERVER AND WAS VACUOUS. Nothing was ever
      // adopted, so "holds no floor" was trivially true in both branches and the row reported
      // proposal B unsound on the strength of a fixture that never reached the path. The adoption
      // control below is what catches that, and it is asserted rather than printed.
      for (const trimmedFlag of [false, true]) {
        const sb = fresh();
        const r = F.playingRoom({ songs: 3 });
        const log = F.sortLog(r.log);
        let evidenceGone = false;
        sb.Floor.attach({
          // THE CHAIN HAS TO ACTUALLY STOP VERIFYING, OR `revalidate` answers `still-holds` and the
          // weakening path is never reached — which is what the first two versions of this row did.
          // Emptying the log is the real shape of it: the joining evidence gone from the raw cache,
          // the case `trust-cascade.md` describes and J27 measured (`chainVerifies(q, [])` = false).
          log: () => (evidenceGone ? [] : sb.StreamManager.getLog()),
          settings: () => ({}), myRank: () => F.RANK.staff, trimmed: () => trimmedFlag });
        for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
        const cut = log[2];
        const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
        const mk = () => {
          const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, floorL: cut.l,
                       thin: false, covers: log[0].eventId + ".." + cut.eventId };
          cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
          return cp;
        };
        // Four DISTINCT staff authors — the substitute bar counts identities, not copies.
        sb.Floor.remember(mk(), F.RANK.staff, "@s1:hs", 5000);
        sb.Floor.remember(mk(), F.RANK.staff, "@s2:hs", 5100);
        sb.Floor.remember(mk(), F.RANK.staff, "@s3:hs", 5200);
        sb.Floor.remember(mk(), F.RANK.staff, "@s4:hs", 5300);
        const sel = sb.Floor.select(F.RANK.staff, {}, () => true);
        const adopted = sel ? sb.Floor.adopt(sel, false) : false;
        const gradeAtAdoption = sb.Floor.grade();
        evidenceGone = true;
        const rev = sb.Floor.revalidate();
        out[trimmedFlag ? "trimmed" : "untrimmed"] = {
          adopted, gradeAtAdoption, rev,
          holdsFloor: !!sb.Floor.current(),
          gradeAfter: sb.Floor.current() ? sb.Floor.grade() : null,
        };
      }
      // THE CONTROLS, ASSERTED RATHER THAN REPORTED. Without adoption the row measures nothing;
      // without an actual weakening it measures nothing either, and BOTH failures print a
      // confident-looking answer. Two earlier versions of this row did exactly that.
      if (!out.trimmed.adopted || !out.untrimmed.adopted) {
        throw new Error("CONTROL FAILED — no floor was adopted (trimmed=" + out.trimmed.adopted
          + ", untrimmed=" + out.untrimmed.adopted + "), so 'holds no floor' is trivially true "
          + "and this row cannot answer the question it exists for");
      }
      if (out.trimmed.gradeAtAdoption !== "quorum") {
        throw new Error("CONTROL FAILED — the adopted floor graded `" + out.trimmed.gradeAtAdoption
          + "` rather than `quorum`, and revalidate only re-checks a quorum floor");
      }
      const weakened = (o) => o.rev && o.rev.moved === true
        && (o.rev.reason === "withdrawn" || o.rev.reason === "demoted-stale");
      if (!weakened(out.trimmed) || !weakened(out.untrimmed)) {
        throw new Error("CONTROL FAILED — the floor did not actually weaken (untrimmed: "
          + JSON.stringify(out.untrimmed.rev) + ", trimmed: " + JSON.stringify(out.trimmed.rev)
          + "). `still-holds` means the chain never stopped verifying, so `_weakened` was never "
          + "reached and neither branch was exercised");
      }
      const reachable = out.trimmed.holdsFloor === false;
      return { out, reachable,
        finding: "both trees adopted a `quorum` floor and both genuinely weakened (control)."
          + "   UNTRIMMED -> " + out.untrimmed.rev.reason + ", holdsFloor="
          + out.untrimmed.holdsFloor
          + "   |  TRIMMED -> " + out.trimmed.rev.reason + ", holdsFloor="
          + out.trimmed.holdsFloor + " grade=" + out.trimmed.gradeAfter
          + "   -> a trimmed client holding NO floor is "
          + (reachable ? "REACHABLE — proposal B is UNSOUND"
                       : "NOT reachable by this route — proposal B survives") };
    });

  // ── R25 — THE OTHER ROUTE TO THE SAME PAIR, because R24 answers ONE route and the predicate
  // needs ALL of them. `_trusted` also becomes null on `Floor.reset()`, which runs on room entry.
  // So: can a client carry `thin=true` across a room change, into a room where it holds no floor?
  // In production both `thin` and `trimmed` read the SAME source —
  // `StreamManager._trimState() !== null` (matrixbridge, two attach sites) — so the question is
  // whether that source resets with the room. Driven rather than read, because the two resets live
  // in different modules and the pairing is a cross-module precondition of exactly the kind
  // `streammanager.js` warns reads as satisfied until somebody reorders a wiring step.
  const r25 = await row("R25", "THE OTHER ROUTE — can `thin=true` survive a room change into a floorless room?",
    [{ name: "the weakening route was answered", ok: !!(r24 && r24.reachable === false) }],
    () => {
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                        myRank: () => F.RANK.owner, trimmed: () => sb.StreamManager._trimState() !== null });
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const cut = log[2];
      const seed = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
      const cp = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, floorL: cut.l,
                   thin: false, covers: log[0].eventId + ".." + cut.eventId };
      cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
      sb.Floor.remember(cp, F.RANK.owner, "@owner:hs", 5000);
      sb.Floor.adopt(sb.Floor.select(F.RANK.owner, {}, () => true), false);
      // ONE MORE ARRIVAL, so the fold runs WITH the floor in place and the validation actually
      // executes. Without it `seedValidation` never leaves `not-yet-run/no-checkpoint`, the licence
      // is withheld for that reason, and the trim drops 0 — which the control below caught on the
      // first run of this row.
      sb.StreamManager.ingest(F.rawEvent("$tick", 90, 900000, "@dj:hs", F.RANK.player,
        { t: "ddjp.dj.declare", v: "SONGV" }));
      sb.SettingsProof._setVerdictForTest({ status: "validated" });
      // The production `thin`/`trimmed` source, both attach sites read this one expression.
      const thinNow = () => sb.StreamManager._trimState() !== null;
      const droppedCount = sb.StreamManager.trimToFloor();
      if (!thinNow()) {
        throw new Error("CONTROL FAILED — the client did not actually trim (dropped "
          + droppedCount + "), so 'thin survives a room change' has no thin to survive");
      }
      // The room change, as `features/room.js` `_initModules` performs it: StreamManager.reset()
      // then Floor.reset() via MatrixBridge.resetCheckpoints().
      sb.StreamManager.reset();
      sb.Floor.reset();
      return { before: true, after: thinNow(), holdsFloor: !!sb.Floor.current(),
        finding: "trimmed in room A (thin=true, control asserted), then changed room."
          + "   After the reset pair: thin=" + thinNow()
          + ", holdsFloor=" + !!sb.Floor.current()
          + "   -> the pair (no floor, thin=true) is "
          + (thinNow() && !sb.Floor.current() ? "REACHABLE — proposal B is UNSOUND"
                                              : "not reachable this way either")
          + ". Both production attach sites read `StreamManager._trimState() !== null`, and "
          + "`reset()` clears `_trimmedBelow`, so the flag cannot outlive the room it describes" };
    });

  // ── R26 — WHO CAN AUTHOR THE PAIR AND GET IT ACTED ON? "Committed" means a relay cannot strip
  // it; it does not mean only an importer can write it. The predicate would make a client DISCARD
  // ITS HISTORY, so the question of who can trigger it is the whole blast radius. It only bites if
  // the checkpoint becomes that client's FLOOR, so the existing adoption rules are the bound —
  // driven rather than assumed, because "the adoption rules cover it" is exactly the shape of
  // inherited reasoning this project keeps paying for.
  console.log("");
  console.log("R26  who can author the pair and have it adopted");

  const r26 = await row("R26", "a PEER forges prev=null & thin=true — is it adopted as a floor?",
    [{ name: "the pair is the surviving discriminator", ok: !!(r23 && r23.hits === true) }],
    () => {
      const sb = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                        myRank: () => F.RANK.staff, trimmed: () => false });
      for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
      const cut = log[2];
      // A forged ORIGIN claim: someone else's state, declared as this room's origin.
      const foreign = sb.StateDeriver.buildSeed(F.sortLog(F.playingRoom({ songs: 2 }).log), null);
      const forge = { t: "ddjp.checkpoint", n: 1, prev: null, seed: foreign, floorL: cut.l,
                      thin: true, covers: log[0].eventId + ".." + cut.eventId };
      forge.h = sb.CheckpointFormat.fingerprint(forge.n, forge.prev, forge.seed, forge.floorL,
        forge.thin, forge.covers);
      const wellFormed = sb.CheckpointFormat.verify(forge);

      sb.Floor.remember(forge, F.RANK.staff, "@peer:hs", 5000);
      const selStaff = sb.Floor.select(F.RANK.staff, {},
        (q) => sb.Floor.chainVerifies(q, sb.StreamManager.getLog()));
      const adoptedByPeerObserver = selStaff ? sb.Floor.adopt(selStaff, false) : false;

      // And the same forgery arriving on the OWNER channel — the case the trust model already
      // grants, so it is a statement about the existing ceiling rather than a new hole.
      const sb2 = fresh();
      sb2.Floor.attach({ log: () => sb2.StreamManager.getLog(), settings: () => ({}),
                         myRank: () => F.RANK.staff, trimmed: () => false });
      for (const e of log) sb2.StreamManager.ingest(F.toRaw(e));
      sb2.Floor.remember(forge, F.RANK.owner, "@owner:hs", 5000);
      const selOwner = sb2.Floor.select(F.RANK.staff, {}, () => true);
      const adoptedAsOwner = selOwner ? sb2.Floor.adopt(selOwner, false) : false;

      return { adoptedByPeerObserver, adoptedAsOwner, wellFormed,
        finding: "the forgery is well-formed by its own fingerprint: " + wellFormed
          + "   |  arriving from a PEER, adopted as a floor: " + adoptedByPeerObserver
          + "   |  arriving on the OWNER channel, adopted: " + adoptedAsOwner
          + "   -> the pair is only ACTED ON once the checkpoint is a floor, so the blast radius "
          + "is exactly the existing adoption model: a peer needs a chained quorum, an owner is "
          + "adopted on authority — which `trust-cascade.md` §6 already grants, and an owner who "
          + "can seal any seed can already replace the room" };
    });

  console.log("");
  console.log("done.");
  return { r18, r19, r20, r21, r22, r23, r24, r25, r26 };
}

main();
