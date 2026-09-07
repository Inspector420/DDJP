// tests/check-membership-index0.js
// A MEMBERSHIP TEST MUST TREAT THE FIRST ELEMENT OF ITS LIST LIKE ANY OTHER.
//
// Found by the J39 sweep, filed as F2: twelve `indexOf(x) >= 0` tests across six modules, and
// nothing in the suite could tell `>= 0` from `> 0`. That flip has one effect and it is always the
// same — **the first element of the list stops being a member** — and index 0 is not an edge case
// here, it is the ordinary traffic of the room:
//
//   `_ADVANCE_TYPES[0]`     the ordinary play. Most advances in any room.
//   `NON_CRITICAL_TYPES[0]` the vote. The most frequent display-level event there is.
//   `ENVELOPE_KEYS[0]`      `l`, the position every single event carries.
//
// ── WHY ONE GUARD RATHER THAN THREE ──────────────────────────────────────────────────────────
// These are not three bugs. They are one shape appearing wherever a list is asked about
// membership, and the sweep found it three times because the tree contains it many times. A guard
// per row would go green on the row it was written for and stay silent on the fourth list somebody
// adds next year. So the rule this file locks is the general one:
//
//     for every membership list the backend exposes, the FIRST element must behave
//     identically to a MIDDLE element of the same list, through the same seam.
//
// ── DERIVED, NEVER RESTATED ──────────────────────────────────────────────────────────────────
// **No protocol type or key name is written in this file.** `NON_CRITICAL_TYPES` and
// `ENVELOPE_KEYS` are exported as slices and are read from the modules; `_ADVANCE_TYPES` is module
// -private, so its candidates are SCANNED out of the source and every verdict about them is then
// decided by EXECUTION — the `check-advance-notify` idiom, for the reason that file gives: a regex
// proves a string is spelled somewhere, which is a different claim from "this runs".
//
// A guard naming `ddjp.dj.play` in a string would have restated the list, and would rot the day
// somebody reorders it — which is the same day this guard would need to notice most.
//
// ── THE CONTROL IS THE MIDDLE ELEMENT, AND IT IS THE POINT ───────────────────────────────────
// Every case asserts the first element behaves like a middle one, never that it behaves some
// particular way. That is what makes it a comparison rather than a second copy of the rule: if
// somebody changes what a list MEANS, both readings move together and this guard stays green,
// correctly. It fails only when the two DIVERGE, which is exactly what the flip does and exactly
// what no other guard here can see.
//
// ── WHAT EACH ROW COSTS WHEN IT BREAKS, MEASURED RATHER THAN ASSUMED ─────────────────────────
// Driven before this file existed, each against a control that must not move (see
// `_probe-index0-membership.js`, whose gates refuse a fixture that never reached the code):
//
//   PART A  `_ADVANCE_TYPES` — BOTH sites are REPORTING sites, not deciding ones. The room still
//           advances; what is lost is the ORDER verdict line and the door refusal's "this was an
//           ADVANCE" warning, for the ordinary play only. That is observability rather than
//           divergence — and `README.md` names those exact lines as what to read before diagnosing
//           anything, with `roles.md` §7 pointing at them when two clients disagree. The handoff's
//           "the stream manager would stop recognising the primary advance" is true of the
//           comparison and reads stronger than the consequence.
//   PART B  `NON_CRITICAL_TYPES` — votes start counting toward the seal cadence AND toward the
//           vouch turn filter. Both are the self-amplifying shape `checkpoint.js` already warns
//           about for bundles: frequent traffic that changes nothing convincing the room it has
//           fallen behind. A busy room votes far more than it plays.
//   PART C  `ENVELOPE_KEYS` — the one that is NOT what it was filed as. The stated consequence was
//           that `l` "stops being stripped before hashing"; the fingerprint is in fact BYTE
//           IDENTICAL either way, because `_committed` re-adds `l` unconditionally two functions
//           down. What actually happens is worse: the record's delta `d` starts carrying `l`, and
//           `reconstruct` composes `Object.assign({ l: rec.l }, rebuild(rec.d))` — so the delta's
//           position OVERRIDES the record's own. A record with an edited `d.l` and an honest `rec.l`
//           passes `verifyRecord`, passes `verifyAgainstChain` with the strongest verdict the system
//           has (`chain-anchored`), and rebuilds the event at the forged position. Measured: honest
//           42, forged 9999, chain verdict `chain-anchored` in both. That is the position-forgery
//           hole `vouch.js`'s own header says was closed, reopened through a different door.

const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");
const F = require("./_fixtures");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[membership-index0] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// A list's first element and a middle one. The middle is the control: it sits where the flip
// cannot reach, so a difference between the two is attributable to index 0 and nothing else.
function firstAndMiddle(list, label) {
  ok(Array.isArray(list) && list.length >= 2,
    label + ": needs at least two members for a first-vs-middle comparison to mean anything — with " +
    "one member there is no control and this whole file would be asserting a constant", list);
  if (!Array.isArray(list) || list.length < 2) return null;
  return { first: list[0], middle: list[Math.floor(list.length / 2)], all: list.slice() };
}

let partsRun = 0;

// ══ PART A — `_ADVANCE_TYPES`: the reporting sites ═════════════════════════════════════════════
// The list is module-private, so it is SCANNED for candidates and every verdict is driven. What is
// asserted is that the ORDER verdict is emitted for the first element exactly as for a middle one,
// with the room genuinely advancing on both — the reducer's own `nowPlaying.pi` is the witness that
// each fixture presented a real advance, and it knows nothing about this list.
{
  const src = fs.readFileSync(path.join(ROOT, "backends", "backend1", "streammanager.js"), "utf8");
  const m = src.match(/_ADVANCE_TYPES\s*=\s*\[([^\]]*)\]/);
  ok(!!m, "A: the advance-type list could not be located in streammanager.js — a scan that finds " +
    "nothing reports a clean result, so this is a failure rather than a skip");
  const advanceTypes = m ? (m[1].match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, "")) : [];
  const pair = firstAndMiddle(advanceTypes, "A");

  // The scan must have reached a plausible list, not one string it happened to match.
  ok(advanceTypes.length >= 3,
    "A: the derived advance-type list is implausibly short — every one of these must be a real " +
    "protocol type the reducer can advance on", advanceTypes);

  if (pair) {
    // Drive each type through the production door and record what the log said about it.
    const measure = (type, prevType) => {
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

      const room = F.playingRoom({ songs: 1 });
      StreamManager.reset();
      for (const e of F.sortLog(room.log)) StreamManager.ingest(F.toRaw(e));

      // ACCEPTED ADVANCE — the ORDER verdict site.
      const id = "$adv";
      const before = lines.length;
      StreamManager.ingest(F.toRaw(F.reducerEvent(id, room.lastL + 1, room.startTs + 400000,
        room.dj, F.RANK.player, { t: type, p: room.pi(0) })));
      const accepted = lines.slice(before);
      const np = StreamManager.getState().nowPlaying;

      // REFUSED AT THE DOOR — the refusal-wording site. Backdated: a position below the head with
      // a later stamp, which `validate` refuses for every type alike.
      const before2 = lines.length;
      StreamManager.ingest(F.toRaw(F.reducerEvent("$door", 1, room.startTs + 900000,
        "@late:hs", F.RANK.player, { t: type, p: room.pi(0) })));
      const door = lines.slice(before2);

      return {
        advancedTheRoom: !!(np && np.pi === id),
        orderVerdict: accepted.filter((s) => s.indexOf("StreamManager: ORDER ") >= 0).length,
        refusedAtDoor: door.filter((s) => s.indexOf("REFUSED AT THE DOOR") >= 0).length,
        namedAsAdvance: door.filter((s) => s.indexOf("this was an ADVANCE") >= 0).length,
      };
    };

    const first = measure(pair.first);
    const middle = measure(pair.middle);

    // ── the fixture reached the code, for BOTH readings ───────────────────────────────────
    // Without this the comparison is between two absences. An event that is simply not an advance
    // is ingested happily and logs nothing, which is the identical reading to an advance the site
    // has stopped recognising — so the reducer's own verdict is what makes the readings admissible.
    ok(first.advancedTheRoom && middle.advancedTheRoom,
      "A: setup — both the first and the middle advance type must actually MOVE the room, or a " +
      "missing report says nothing about whether the site recognises an advance",
      { first: first.advancedTheRoom, middle: middle.advancedTheRoom });
    ok(first.refusedAtDoor === 1 && middle.refusedAtDoor === 1,
      "A: setup — both types must be refused at the door by the backdating rule, or the WORDING " +
      "of that refusal cannot be compared", { first: first.refusedAtDoor, middle: middle.refusedAtDoor });

    // ── the rule ──────────────────────────────────────────────────────────────────────────
    ok(first.orderVerdict === middle.orderVerdict,
      "A: the ORDER verdict must be reported for the FIRST advance type exactly as for a middle " +
      "one. This line is what distinguishes `my skip did nothing` from `my skip was correctly " +
      "refused`, and README names it as the thing to read before diagnosing a disagreement — so " +
      "losing it for the most common advance in the room is losing it where it is needed most",
      { first: first.orderVerdict, middle: middle.orderVerdict, firstType: pair.first });
    ok(first.namedAsAdvance === middle.namedAsAdvance,
      "A: a door refusal must be flagged as AN ADVANCE for the first type exactly as for a middle " +
      "one. That warning exists because a refused advance is the asymmetric failure — the sender " +
      "believes the room moved on and nobody else does",
      { first: first.namedAsAdvance, middle: middle.namedAsAdvance, firstType: pair.first });
    partsRun++;
  }
}

// ══ PART B — `NON_CRITICAL_TYPES`: the two counters that read it ═══════════════════════════════
// Exported as a slice, so the list is read from the module rather than restated. Both surviving
// call sites are counters, and both are asked the same question: does the first element count?
{
  const sb = loadInContext([
    "core/logger.js",
    "core/playlistdoc.js",
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
  ], { Date, Math, JSON });
  const { Vouch, Checkpoint } = sb;

  const pair = firstAndMiddle(Vouch.NON_CRITICAL_TYPES, "B");
  if (pair) {
    const N = 6;
    const logOf = (type) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        out.push(F.reducerEvent("$" + i + type, i + 1, 100000 + i, "@u" + i + ":hs", F.RANK.player,
          { t: type, p: "$somepi" }));
      }
      return out;
    };
    const rawsOf = (type) => logOf(type).map(F.toRaw);

    // A type NOT on the list, to prove each counter can count at all. Taken from the reducer's own
    // advance vocabulary via the fixtures' running room rather than written down here.
    const criticalType = F.playingRoom({ songs: 1 }).log.filter((e) => e.content.p !== undefined)[0].type;

    const countable = { first: Checkpoint._countable(logOf(pair.first)),
                        middle: Checkpoint._countable(logOf(pair.middle)),
                        critical: Checkpoint._countable(logOf(criticalType)) };
    const turns = { first: Vouch._criticalPositions(rawsOf(pair.first), null).length,
                    middle: Vouch._criticalPositions(rawsOf(pair.middle), null).length,
                    critical: Vouch._criticalPositions(rawsOf(criticalType), null).length };

    // ── the counters can count, so a zero is a decision rather than an absence ─────────────
    ok(countable.critical === N && turns.critical === N,
      "B: setup — both counters must count a known-critical log in full. `_countable` degrades to " +
      "list.length when Vouch is absent and both would then answer the same for every input, " +
      "which is unfalsifiable rather than passing",
      { countable: countable.critical, turns: turns.critical, of: N });

    // ── the rule ──────────────────────────────────────────────────────────────────────────
    ok(countable.first === countable.middle,
      "B: the SEAL CADENCE must treat the first non-critical type exactly as it treats a middle " +
      "one. A display-level event that starts counting makes the room bank checkpoints because it " +
      "has been busy doing nothing — and checkpoints are themselves events, which is the " +
      "self-amplifying shape `_countable`'s own header records for bundles",
      { first: countable.first, middle: countable.middle, firstType: pair.first });
    ok(turns.first === turns.middle,
      "B: the VOUCH TURN FILTER must treat the first non-critical type exactly as it treats a " +
      "middle one. Turns are counted in events, not seconds, precisely so every client derives the " +
      "same answer — a flood of the most common display event advancing everyone's turn is what " +
      "`_criticalPositions` exists to prevent",
      { first: turns.first, middle: turns.middle, firstType: pair.first });

    // ── and the two sites that already fail loudly, asserted here so the LIST is covered as a
    // list rather than at the two places the sweep happened to surface ────────────────────
    ok(Vouch.carries(pair.first) === Vouch.carries(pair.middle),
      "B: whether an outgoing event may carry a bundle must not depend on the first element's " +
      "position in the list", { first: Vouch.carries(pair.first), middle: Vouch.carries(pair.middle) });
    const eligibleOf = (type) => Vouch.eligible(rawsOf(type)[0], "@nobody:hs", () => true);
    ok(eligibleOf(pair.first) === eligibleOf(pair.middle),
      "B: protectability must not depend on the first element's position in the list",
      { first: eligibleOf(pair.first), middle: eligibleOf(pair.middle) });
    partsRun++;
  }
}

// ══ PART C — `ENVELOPE_KEYS`: stripping, and where a position actually lands ═══════════════════
// The fingerprint is NOT the discriminator here and asserting on it would be decorative: `l` is
// re-added by `_committed` whatever the strip does, so the hash is identical under the flip. What
// discriminates is the REBUILD — which is the thing the whole vouch layer exists to make safe.
{
  const sb = loadInContext([
    "core/logger.js",
    "core/playlistdoc.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/vouch.js",
  ], { Date, Math, JSON });
  const { Vouch } = sb;

  const pair = firstAndMiddle(Vouch.ENVELOPE_KEYS, "C");
  if (pair) {
    // A body carrying EVERY envelope key, built from the list itself so a key added later is
    // covered without editing this file. Values are shape-plausible; only presence matters.
    const L = 42;
    const filler = { l: L, dv: 2, hv: 1, pHash: "deadbeef",
                     w: [{ i: "$x", l: 7, d: {}, h: "h", r: 20 }], og: { ch: "c", rk: 20 } };
    const body = { t: "ddjp.dj.play", p: "$parent" };
    for (const k of pair.all) body[k] = Object.prototype.hasOwnProperty.call(filler, k) ? filler[k] : 1;

    const payload = Vouch.actionPayload(body);
    ok(Object.keys(payload).length > 0,
      "C: setup — the action payload is empty, so `this key was stripped` cannot be told apart " +
      "from `nothing survived`", payload);

    // ── the rule, at the strip ────────────────────────────────────────────────────────────
    const firstStripped = !Object.prototype.hasOwnProperty.call(payload, pair.first);
    const middleStripped = !Object.prototype.hasOwnProperty.call(payload, pair.middle);
    ok(firstStripped === middleStripped,
      "C: the FIRST envelope key must be stripped from the action payload exactly as a middle one " +
      "is. The envelope is witnessing and position; leaving any of it in the payload puts it into " +
      "the record's delta, which is what the rebuild reads",
      { firstKey: pair.first, firstStripped: firstStripped,
        middleKey: pair.middle, middleStripped: middleStripped, payloadKeys: Object.keys(payload) });

    // ── the rule, where it actually bites: A REBUILT EVENT'S POSITION ─────────────────────
    // Driven through the production path — a real parent, a real child committing `commitFor`, a
    // tombstone — because `reconstruct` is what consumes a record and `verifyAgainstChain` is the
    // gate in front of it. A record whose DELTA names one position and whose own `l` names another
    // must never rebuild at the delta's.
    const parentBody = { t: "ddjp.dj.play", p: "$grandparent", l: L, dv: 2, hv: 1 };
    const mkRaw = (id, sender, l, b) => ({
      event_id: id, type: "m.room.message", sender: sender, senderRank: F.RANK.player,
      l: l, ts: 1000 + l, origin_server_ts: 1000 + l, room_id: F.ROOM,
      content: { body: JSON.stringify(b) } });

    const honest = Vouch.record(mkRaw("$parent2", "@a:hs", L, parentBody));
    ok(!!honest, "C: setup — no record could be built for the parent; `record` is total and " +
      "answers null on a body it cannot read, so every field below would be null");

    if (honest) {
      const FORGED_L = honest.l + 9000;
      const forged = { i: honest.i, l: honest.l, d: Object.assign({}, honest.d), h: honest.h, r: honest.r };
      let deltaCarriedPosition = false;
      for (const k of Object.keys(forged.d)) {
        if (k === pair.first && typeof forged.d[k] === "number") { forged.d[k] = FORGED_L; deltaCarriedPosition = true; }
      }

      const child = mkRaw("$child2", "@b:hs", L + 1,
        { t: "ddjp.dj.skip", p: "$parent2", l: L + 1, dv: 2, hv: 1,
          pHash: Vouch.commitFor(parentBody), w: [forged] });
      Vouch.rememberTombstone({ id: "$parent2", sender: "@a:hs", rank: F.RANK.player,
                                roomId: F.ROOM, ts: 1000 });
      const rebuilt = Vouch.reconstruct("$parent2", [child]);

      ok(rebuilt && rebuilt.ok === true,
        "C: setup — reconstruct produced no event, so a forged position could not have been " +
        "observed either way. A refusal here reads exactly like a forgery being caught",
        rebuilt && rebuilt.why);

      if (rebuilt && rebuilt.ok) {
        let at = null;
        try { at = JSON.parse(rebuilt.event.content.body).l; } catch (e) { at = "unparseable"; }
        ok(at === honest.l,
          "C: a rebuilt event must land at the position the RECORD commits, never at one its delta " +
          "carries. `reconstruct` composes `Object.assign({ l: rec.l }, rebuild(rec.d))`, so any " +
          "position inside the delta wins — and the delta is not what the fingerprint is checked " +
          "against, so a record with an edited delta position still passes `verifyRecord` AND " +
          "`verifyAgainstChain`. Position invariance was never wanted: an event has ONE position, " +
          "and `_committed` includes it for exactly this reason",
          { rebuiltAt: at, recordSays: honest.l, forgedDeltaSaid: deltaCarriedPosition ? FORGED_L : "delta carried no position" });
      }
      partsRun++;
    }
  }
}

// ══ THE DERIVATION REACHED ALL THREE LISTS ════════════════════════════════════════════════════
// A part that silently did not run reports nothing, and nothing reads as a pass.
ok(partsRun === 3,
  "the guard must exercise all three lists — a part that bailed early on a missing export or a " +
  "short list leaves that list unguarded while the file still prints PASS", { partsRun: partsRun });

if (failures) process.exit(1);
console.log("[membership-index0] PASS — every membership list the backend exposes treats its FIRST " +
  "element exactly as it treats a middle one, which is what `indexOf(x) >= 0` claims and what " +
  "`> 0` silently stops being true. The three lists are DERIVED, not restated — two are read from " +
  "their modules' own exports and the third is scanned for candidates and settled by execution — " +
  "so no protocol type or key name appears in this file and a reordered list cannot rot it. " +
  "Driven, each against a middle-element control that must not move: the ordinary play keeps its " +
  "ORDER verdict and its door-refusal advance warning, the vote stays out of both the seal cadence " +
  "and the vouch turn filter, and `l` stays out of the record's delta — that last one because a " +
  "delta carrying a position OVERRIDES the record's own inside `reconstruct`, so a forged delta " +
  "position passes self-consistency, passes the chain anchor, and rebuilds the event somewhere " +
  "it never was (F2, from the J39 sweep)");
