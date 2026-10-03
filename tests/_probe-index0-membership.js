// probe-index0-membership.js — F2: what does `indexOf(x) >= 0` do at INDEX 0?
//
// The J39 sweep left twelve `indexOf` membership tests classified BY READING. Reading a comparison
// tells you what it does; it does not tell you what reaches it, or what downstream depends on the
// answer. This probe drives the three rows with named consequences and reports what actually moves.
//
// ── WHY THIS NEEDS AN ADMISSIBILITY GATE ─────────────────────────────────────────────────────
// Every measurement here is "did X happen?" against a fixture, and the flip's expected effect is
// that X STOPS happening. So a fixture that never reached the code reports the same absence in
// every tree, and absence reads as agreement — the exact failure that killed three attempts to
// audit the DOMINATED pair (09-roadmap.md §J39). Each case therefore states its preconditions as
// SEPARATE checks, runs them before any comparison, and refuses to print a result if one fails,
// naming the stage. `--selftest` feeds each gate a deliberately broken input and shows it catches
// it, because a gate nobody has tested certifies everything downstream on its own authority.
//
// ── THE THREE ROWS ───────────────────────────────────────────────────────────────────────────
//   A  _ADVANCE_TYPES[0]     = "ddjp.dj.play"   streammanager.js:147, :240
//   B  NON_CRITICAL_TYPES[0] = "ddjp.dj.vote"   vouch.js:582, checkpoint.js:451
//   C  ENVELOPE_KEYS[0]      = "l"              vouch.js:104
//
// Each case measures the FIRST element against a MIDDLE element of the same list, through the same
// seam, in one run. That pairing is the control: under the flip the middle element must keep
// behaving and only the first may change. A case that moved both would be measuring something else.
//
// Run against a tree:  DDJP_TREE=/path/to/ddjp_240 node tests/_probe-index0-membership.js
// Self-test the gates: DDJP_TREE=/path/to/ddjp_240 node tests/_probe-index0-membership.js --selftest

const path = require("path");
const TREE = process.env.DDJP_TREE || path.resolve(__dirname, "..");
const { loadInContext } = require(path.join(TREE, "tests", "_load.js"));
const F = require(path.join(TREE, "tests", "_fixtures.js"));

const SELFTEST = process.argv.indexOf("--selftest") >= 0;
const out = {};

// THE GATE MUST BE REACHABLE BY ITS OWN SELF-TEST. The first draft of this file skipped every
// gate while self-testing (`if (!SELFTEST || !o.break...)`), which is the shape 08-build-and-deploy
// warns about one level down: a guard's own error handling wrapping the thing under test. The gate
// was then never shown to catch anything. It THROWS under self-test and exits otherwise, so the
// same code path runs in both modes and the self-test asserts on the refusal itself.
function inadmissible(caseName, stage, detail) {
  const payload = { INADMISSIBLE: caseName, stage: stage, detail: detail,
    note: "the fixture never reached the code; nothing below would mean anything" };
  if (SELFTEST) throw new Error("GATE REFUSED " + caseName + " at: " + stage);
  console.log(JSON.stringify(payload, null, 1));
  process.exit(2);
}

// ══ CASE A — _ADVANCE_TYPES, at both sites, observed through the log ═══════════════════════════
// Both sites are REPORTING sites: :147 chooses the wording of a door refusal, :240 gates the whole
// ORDER verdict line. So the observable is Logger output, and the fixture has to actually produce
// each line in the control tree or the measurement is of nothing.
function caseA(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js",
  ], { Date, Math, JSON });
  const { Logger, StreamManager } = sb;

  const lines = [];
  Logger.on((e) => lines.push(e.level + " " + e.message));

  // A running room, then one advance of each type on top of it. `dj.play` is index 0 of
  // _ADVANCE_TYPES; `dj.skip` is index 1 — the middle element that must keep working.
  const room = F.playingRoom({ songs: 1 });
  StreamManager.reset();
  for (const e of F.sortLog(room.log)) StreamManager.ingest(F.toRaw(e));

  const headL = room.lastL;
  const t = room.startTs + 400000;
  // Both name the live pi, so both are ordinary well-formed advances that reach the fold.
  const play = F.toRaw(F.reducerEvent("$advPlay", headL + 1, t, room.dj, F.RANK.player,
    { t: o.breakType ? "ddjp.dj.NOTATYPE" : "ddjp.dj.play", p: room.pi(0) }));
  const skip = F.toRaw(F.reducerEvent("$advSkip", headL + 2, t + 1000, room.dj, F.RANK.player,
    { t: "ddjp.dj.skip", p: "$advPlay" }));

  const before = lines.length;
  StreamManager.ingest(play);
  const playLines = lines.slice(before);
  const piAfterPlay = StreamManager.getState().nowPlaying
    ? StreamManager.getState().nowPlaying.pi : null;
  const before2 = lines.length;
  StreamManager.ingest(skip);
  const skipLines = lines.slice(before2);
  const piAfterSkip = StreamManager.getState().nowPlaying
    ? StreamManager.getState().nowPlaying.pi : null;

  const orderLine = (ls) => ls.filter((s) => s.indexOf("StreamManager: ORDER ") >= 0).length;

  const res = {
    // :240 — the ORDER verdict, one per advance type
    orderLineForFirstElement: orderLine(playLines),
    orderLineForMiddleElement: orderLine(skipLines),
    // corroboration that the fold really ran on both
    playIngested: StreamManager.getLog().some((e) => e.eventId === "$advPlay"),
    skipIngested: StreamManager.getLog().some((e) => e.eventId === "$advSkip"),
    // and that each one really MOVED THE ROOM — see the gate
    piAfterPlay: piAfterPlay,
    piAfterSkip: piAfterSkip,
  };

  // ── GATE A ──────────────────────────────────────────────────────────────────────────────
  // THE INGEST CHECK IS NOT ENOUGH, and the self-test is what proved it. An event that is simply
  // NOT an advance — any other `ddjp.*` type — is ingested happily and produces no ORDER line,
  // which is the identical reading to an advance the site stopped recognising. Absence would then
  // be attributable to the fixture rather than to index 0.
  //
  // So the gate demands an INDEPENDENT witness that each event was a genuine, accepted advance:
  // the room's head actually moved onto it. `nowPlaying.pi` is derived by the reducer and knows
  // nothing about `_ADVANCE_TYPES`, so it stays true under the mutation and cannot be the thing
  // being measured.
  {
    if (!res.playIngested) inadmissible("A", "the play never reached the log",
      "StreamManager.ingest refused it at the door — check validate(): a missing room_id, a " +
      "non-integer l, or a backdated position against the head the room fixture left behind");
    if (!res.skipIngested) inadmissible("A", "the skip never reached the log", "same door as above");
    if (piAfterPlay !== "$advPlay") inadmissible("A", "the first element did not ADVANCE the room",
      "nowPlaying.pi is " + piAfterPlay + ", not $advPlay — the fixture did not present a genuine " +
      "advance, so a missing ORDER line would say nothing about whether the site recognises one");
    if (piAfterSkip !== "$advSkip") inadmissible("A", "the middle element did not ADVANCE the room",
      "nowPlaying.pi is " + piAfterSkip + ", not $advSkip — same reason");
    if (res.orderLineForMiddleElement === 0) inadmissible("A", "no ORDER line for the MIDDLE element",
      "site :240 did not fire for `ddjp.dj.skip` in this tree, so its absence for `ddjp.dj.play` " +
      "would prove nothing — the control is what makes the first-element reading attributable");
  }
  return res;
}

// ══ CASE A2 — site :147, the door-refusal wording ══════════════════════════════════════════════
// Reached only by an event that FAILS validate(). The backdating rule is the reliable way in: send
// an advance claiming a position below the head with a later timestamp.
function caseA2(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js",
  ], { Date, Math, JSON });
  const { Logger, StreamManager } = sb;
  const lines = [];
  Logger.on((e) => lines.push(e.message));

  const room = F.playingRoom({ songs: 2 });
  StreamManager.reset();
  for (const e of F.sortLog(room.log)) StreamManager.ingest(F.toRaw(e));

  // Backdated: l below the head, ts above the head's ts. Both types, same treatment.
  const mk = (id, type) => F.toRaw(F.reducerEvent(id, o.notBackdated ? room.lastL + 5 : 1,
    room.startTs + 900000, "@late:hs", F.RANK.player, { t: type, p: room.pi(0) }));

  const b0 = lines.length;
  StreamManager.ingest(mk("$doorPlay", "ddjp.dj.play"));
  const playMsgs = lines.slice(b0);
  const b1 = lines.length;
  StreamManager.ingest(mk("$doorSkip", "ddjp.dj.skip"));
  const skipMsgs = lines.slice(b1);

  const refusedAtDoor = (ms) => ms.filter((s) => s.indexOf("REFUSED AT THE DOOR") >= 0).length;
  const namedAsAdvance = (ms) => ms.filter((s) => s.indexOf("this was an ADVANCE") >= 0).length;

  const res = {
    doorRefusalFirstElement: refusedAtDoor(playMsgs),
    doorRefusalMiddleElement: refusedAtDoor(skipMsgs),
    namedAsAdvanceFirstElement: namedAsAdvance(playMsgs),
    namedAsAdvanceMiddleElement: namedAsAdvance(skipMsgs),
  };

  // ── GATE A2 ─────────────────────────────────────────────────────────────────────────────
  {
    if (res.doorRefusalFirstElement === 0 || res.doorRefusalMiddleElement === 0) {
      inadmissible("A2", "nothing was refused at the door",
        "validate() accepted the backdated events, so site :147 was never evaluated — the fixture " +
        "must produce a refusal before the WORDING of that refusal can be measured");
    }
    if (res.namedAsAdvanceMiddleElement === 0) {
      inadmissible("A2", "the MIDDLE element was not named as an advance",
        "site :147 did not classify `ddjp.dj.skip` as an advance in this tree, so its silence for " +
        "`ddjp.dj.play` would not be attributable to index 0");
    }
  }
  return res;
}

// ══ CASE B — NON_CRITICAL_TYPES, at all four of its `indexOf` sites ════════════════════════════
// Two are J39 survivors (vouch:582 `_criticalPositions`, checkpoint:451 `_countable`) and two were
// KILLED by the suite (vouch:306 `eligible`, vouch:613 `carries`). Measuring all four in one run is
// what shows the flip is one behaviour with two guarded faces and two unguarded ones.
function caseB(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/eventcache.js",
    "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js",
    "backends/backend1/dials.js",
    "backends/backend1/scheduler.js",
    "backends/backend1/vouch.js",
    "backends/backend1/floor.js",
    "backends/backend1/checkpoint.js",
    "core/playlistdoc.js",
  ], { Date, Math, JSON });
  const { Vouch, Checkpoint } = sb;

  const FIRST = o.breakList ? "ddjp.NOT.A.TYPE" : Vouch.NON_CRITICAL_TYPES[0];   // ddjp.dj.vote
  const MIDDLE = Vouch.NON_CRITICAL_TYPES[Math.floor(Vouch.NON_CRITICAL_TYPES.length / 2)];

  // A log of ONLY the type under test, so `_countable` has nothing else to count.
  const logOf = (type, n) => {
    const l = [];
    for (let i = 0; i < n; i++) {
      l.push(F.reducerEvent("$" + type + i, i + 1, 100000 + i, "@u" + i + ":hs", F.RANK.player,
        { t: type, p: "$somepi" }));
    }
    return l;
  };
  const N = 6;

  // The held-raw shape the vouch layer reads, at distinct positions so the turn filter is real.
  const rawsOf = (type, n) => logOf(type, n).map(F.toRaw);

  const res = {
    first: FIRST, middle: MIDDLE,
    // checkpoint:451 — the seal cadence
    countableFirst: Checkpoint._countable(logOf(FIRST, N)),
    countableMiddle: Checkpoint._countable(logOf(MIDDLE, N)),
    countableCritical: Checkpoint._countable(logOf("ddjp.dj.play", N)),
    // vouch:582 — which positions count as a turn
    turnPositionsFirst: Vouch._criticalPositions(rawsOf(FIRST, N), null).length,
    turnPositionsMiddle: Vouch._criticalPositions(rawsOf(MIDDLE, N), null).length,
    turnPositionsCritical: Vouch._criticalPositions(rawsOf("ddjp.dj.play", N), null).length,
    // vouch:613 — may one of my outgoing events carry a bundle (a KILLED row: control)
    carriesFirst: Vouch.carries(FIRST),
    carriesMiddle: Vouch.carries(MIDDLE),
    // vouch:306 — is it protectable at all (a KILLED row: control)
    eligibleFirst: Vouch.eligible(rawsOf(FIRST, 1)[0], "@nobody:hs", () => true),
    eligibleMiddle: Vouch.eligible(rawsOf(MIDDLE, 1)[0], "@nobody:hs", () => true),
  };

  // ── GATE B ──────────────────────────────────────────────────────────────────────────────
  {
    if (!FIRST || !MIDDLE || FIRST === MIDDLE) {
      inadmissible("B", "the list did not yield two distinct elements",
        "NON_CRITICAL_TYPES = " + JSON.stringify(Vouch.NON_CRITICAL_TYPES));
    }
    // THE ELEMENT UNDER TEST MUST ACTUALLY BE IN THE LIST, AT THE INDEX CLAIMED. Without this the
    // whole case is unfalsifiable: a name that is in no list produces "counted, not skipped" in
    // every tree, which is the same reading the flip produces and means nothing. Read off the
    // exported slice, which the call-site flip cannot touch — so this stays true under mutation
    // and is a precondition rather than part of what is being measured.
    if (Vouch.NON_CRITICAL_TYPES.indexOf(FIRST) !== 0) {
      inadmissible("B", "the FIRST element is not at index 0 of the live list",
        "testing `" + FIRST + "` against a list that is " +
        JSON.stringify(Vouch.NON_CRITICAL_TYPES) + " measures nothing about index 0");
    }
    if (Vouch.NON_CRITICAL_TYPES.indexOf(MIDDLE) <= 0) {
      inadmissible("B", "the MIDDLE element is not at a non-zero index of the live list",
        "the control must sit somewhere the flip cannot reach, or it is a second reading of the " +
        "same thing rather than a control");
    }
    // The counters must be able to count SOMETHING, or a zero everywhere proves nothing.
    if (res.countableCritical !== N) {
      inadmissible("B", "`_countable` did not count a known-critical log",
        "expected " + N + " for a log of `ddjp.dj.play`, got " + res.countableCritical +
        " — Vouch may be absent from the sandbox, in which case _countable returns list.length " +
        "for every input and the whole case is unfalsifiable");
    }
    if (res.turnPositionsCritical !== N) {
      inadmissible("B", "`_criticalPositions` did not see a known-critical log",
        "expected " + N + " positions, got " + res.turnPositionsCritical);
    }
  }
  return res;
}

// ══ CASE C — ENVELOPE_KEYS[0] === "l" ══════════════════════════════════════════════════════════
// The stated consequence is that the Lamport position "stops being stripped before hashing". That
// is the reading of one line; this measures the whole record lifecycle instead — payload,
// fingerprint, self-verification, and the REBUILD, which is where a position actually lands.
function caseC(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js",
    "core/playlistdoc.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/vouch.js",
  ], { Date, Math, JSON });
  const { Vouch } = sb;

  const KEYS = Vouch.ENVELOPE_KEYS;
  const FIRST = o.breakKey ? "zz-not-a-key" : KEYS[0];              // "l"
  const MIDDLE = KEYS[Math.floor(KEYS.length / 2)];                 // an envelope key that is not index 0

  // A real critical event carrying a full envelope: position, wire version, hash version, a parent
  // commitment, a bundle and an origin claim. Everything in ENVELOPE_KEYS is present, so a key that
  // stops being stripped shows up as an extra key in the payload.
  const L = 42;
  const body = { t: "ddjp.dj.play", p: "$parent", l: L, dv: 2, hv: 1,
                 pHash: "deadbeef", w: [{ i: "$x", l: 7, d: {}, h: "h", r: 20 }], og: { ch: "c", rk: 20 } };
  const raw = { event_id: "$ev", type: "m.room.message", sender: "@a:hs", senderRank: F.RANK.player,
                l: L, ts: 1000, origin_server_ts: 1000, room_id: F.ROOM,
                content: { body: JSON.stringify(body) } };

  const payload = Vouch.actionPayload(body);
  const rec = Vouch.record(raw);

  // THE REBUILD IS THE POINT. `reconstruct` composes the event body as
  // Object.assign({ l: rec.l }, rebuild(rec.d)) — so anything `d` carries WINS over the record's
  // own position field. Simulated here rather than driven through `reconstruct`, which additionally
  // needs a tombstone and a chain anchor; the composition is the line under test.
  const rebuilt = Vouch.rebuild(rec ? rec.d : {});
  const composed = Object.assign({ l: rec ? rec.l : null }, rebuilt);

  // And the forgery this opens: edit `d.l` only, leave `rec.l` honest.
  const forged = rec ? { i: rec.i, l: rec.l, d: Object.assign({}, rec.d), h: rec.h, r: rec.r } : null;
  if (forged && Object.prototype.hasOwnProperty.call(forged.d, "l")) forged.d.l = 9999;
  const forgedComposed = forged ? Object.assign({ l: forged.l }, Vouch.rebuild(forged.d)) : null;

  // ── AND THE SAME FORGERY THROUGH THE REAL PROOF GATE ────────────────────────────────────
  // `verifyRecord` is self-consistency only; the module says so at length. The gate that actually
  // stands between a record and a rebuilt event is `verifyAgainstChain` — the record's fingerprint
  // must equal what a held CHILD already committed for that parent — and `reconstruct` is what
  // consumes the result. Measuring only self-consistency would understate or overstate this row,
  // so both are driven: a real parent, a real child committing `commitFor(parent)`, a tombstone,
  // and then the forged delta pushed through `reconstruct` itself.
  const parentBody = { t: "ddjp.dj.play", p: "$grandparent", l: L, dv: 2, hv: 1 };
  const parentRaw = { event_id: "$parent2", type: "m.room.message", sender: "@a:hs",
                      senderRank: F.RANK.player, l: L, ts: 1000, origin_server_ts: 1000,
                      room_id: F.ROOM, content: { body: JSON.stringify(parentBody) } };
  const honestRec = Vouch.record(parentRaw);
  const forgedRec = honestRec
    ? { i: honestRec.i, l: honestRec.l, d: Object.assign({}, honestRec.d), h: honestRec.h, r: honestRec.r }
    : null;
  if (forgedRec && Object.prototype.hasOwnProperty.call(forgedRec.d, "l")) forgedRec.d.l = 9999;

  // A child that chains onto the parent and carries the FORGED record in its bundle.
  const childBody = { t: "ddjp.dj.skip", p: "$parent2", l: L + 1, dv: 2, hv: 1,
                      pHash: Vouch.commitFor(parentBody), w: forgedRec ? [forgedRec] : [] };
  const childRaw = { event_id: "$child2", type: "m.room.message", sender: "@b:hs",
                     senderRank: F.RANK.player, l: L + 1, ts: 2000, origin_server_ts: 2000,
                     room_id: F.ROOM, content: { body: JSON.stringify(childBody) } };

  Vouch.rememberTombstone({ id: "$parent2", sender: "@a:hs", rank: F.RANK.player,
                            roomId: F.ROOM, ts: 1000 });
  const held = [childRaw];
  const chainVerdict = forgedRec ? Vouch.verifyAgainstChain(forgedRec, held) : null;
  const rebuiltEvent = Vouch.reconstruct("$parent2", held);
  let reconstructedL = null;
  if (rebuiltEvent && rebuiltEvent.ok) {
    try { reconstructedL = JSON.parse(rebuiltEvent.event.content.body).l; } catch (e) { reconstructedL = "unparseable"; }
  }

  const res = {
    first: FIRST, middle: MIDDLE,
    payloadHasFirstKey: Object.prototype.hasOwnProperty.call(payload, FIRST),
    payloadHasMiddleKey: Object.prototype.hasOwnProperty.call(payload, MIDDLE),
    payloadKeys: Object.keys(payload).sort(),
    fingerprint: Vouch.fingerprint(body),
    recordDeltaKeys: rec ? Object.keys(rec.d).sort() : null,
    recordL: rec ? rec.l : null,
    recordVerifies: rec ? Vouch.verifyRecord(rec) : null,
    rebuiltPosition: composed.l,
    // the forgery, at both gates
    forgedDeltaVerifies: forged ? Vouch.verifyRecord(forged) : null,
    forgedRebuiltPosition: forgedComposed ? forgedComposed.l : null,
    honestPosition: L,
    forgedChainVerdict: chainVerdict ? chainVerdict.why : null,
    forgedChainAccepted: chainVerdict ? chainVerdict.ok : null,
    reconstructOk: rebuiltEvent ? rebuiltEvent.ok : null,
    reconstructedAtPosition: reconstructedL,
  };

  // ── GATE C ──────────────────────────────────────────────────────────────────────────────
  {
    if (!rec) inadmissible("C", "no record was built",
      "Vouch.record returned null — it is TOTAL and returns null on a body it cannot read, so " +
      "every field below would be null in every tree");
    if (!KEYS.length || FIRST === MIDDLE) inadmissible("C", "the key list did not yield two distinct keys",
      "ENVELOPE_KEYS = " + JSON.stringify(KEYS));
    // Same precondition as case B, and for the same reason: a key that is in no list is stripped
    // by nothing in every tree, so "not stripped" would be true before and after the flip.
    if (KEYS.indexOf(FIRST) !== 0) {
      inadmissible("C", "the key under test is not at index 0 of ENVELOPE_KEYS",
        "testing `" + FIRST + "` against " + JSON.stringify(KEYS) + " measures nothing about index 0");
    }
    if (KEYS.indexOf(MIDDLE) <= 0) {
      inadmissible("C", "the control key is not at a non-zero index of ENVELOPE_KEYS",
        "the control must sit where the flip cannot reach it");
    }
    if (!Object.prototype.hasOwnProperty.call(body, FIRST) ||
        !Object.prototype.hasOwnProperty.call(body, MIDDLE)) {
      inadmissible("C", "the fixture body does not carry both keys",
        "a key absent from the body is absent from the payload whatever the comparison does");
    }
    if (!res.payloadKeys.length) inadmissible("C", "the action payload is empty",
      "actionPayload stripped everything, so 'this key is present' cannot be distinguished from " +
      "'nothing is present'");
    if (res.recordVerifies !== true) inadmissible("C", "an honest record does not self-verify",
      "verifyRecord returned " + res.recordVerifies + " on an unmutated record; a forged one " +
      "failing to verify would then say nothing about the forgery");
    // THE RECONSTRUCT PATH HAS ITS OWN PRECONDITIONS, and each one returns the same "no rebuilt
    // event" that a successfully-refused forgery returns. A missing tombstone, a child that does
    // not chain, or a bundle the resolver cannot anchor all produce `ok: false` — which would read
    // as "the forgery was blocked" when it means "the rebuild never ran".
    if (res.reconstructOk !== true) {
      inadmissible("C", "reconstruct did not produce an event",
        "why=" + (rebuiltEvent && rebuiltEvent.why) + " — no tombstone, no chaining child, or no " +
        "anchorable record. A refusal here is indistinguishable from a forgery being caught, so " +
        "nothing about the position can be concluded");
    }
    if (typeof res.reconstructedAtPosition !== "number") {
      inadmissible("C", "the rebuilt event carries no numeric position",
        "got " + JSON.stringify(res.reconstructedAtPosition) + " — the field the whole case is " +
        "about is absent, so equal-in-every-tree would mean nothing");
    }
  }
  return res;
}

// ══ THE GATE SELF-TEST ═════════════════════════════════════════════════════════════════════════
// Each gate is fed an input it MUST reject. Without this the gates are untested code certifying
// every number above them.
if (SELFTEST) {
  console.log("gate self-test — each case is given a deliberately broken fixture.");
  console.log("The gate must REFUSE it. A gate that returns a reading here is one that would let");
  console.log("a fixture failure be reported as a finding.\n");
  const trials = [
    ["A  event is a `ddjp.*` type that is NOT an advance — ingested happily, no ORDER line, " +
     "which is the SAME reading a real finding produces",
      () => caseA({ breakType: true })],
    ["A2 event is NOT backdated — validate accepts it, so there is no door refusal to word",
      () => caseA2({ notBackdated: true })],
    ["B  the element under test is not in NON_CRITICAL_TYPES — the counters cannot discriminate",
      () => caseB({ breakList: true })],
    ["C  the key under test is not in ENVELOPE_KEYS — 'present in the payload' means nothing",
      () => caseC({ breakKey: true })],
  ];
  let caught = 0;
  for (const [name, run] of trials) {
    let r = null, refusal = null;
    try { r = run(); } catch (e) { refusal = e.message; }
    if (refusal) caught++;
    console.log("  " + (refusal ? "REFUSED " : "ADMITTED") + "  " + name);
    console.log("            " + (refusal ? refusal : "returned a reading: " + JSON.stringify(r).slice(0, 150)));
  }
  console.log("\n  " + caught + "/" + trials.length + " broken fixtures are refused by their gate.");
  if (caught !== trials.length) {
    console.log("  AN ADMITTED ONE MEANS THAT CASE'S GATE IS DECORATIVE — it would certify a " +
      "reading of nothing.");
  }
  process.exit(caught === trials.length ? 0 : 1);
}

out.A = caseA();
out.A2 = caseA2();
out.B = caseB();
out.C = caseC();
out.tree = TREE;
console.log(JSON.stringify(out, null, 1));
