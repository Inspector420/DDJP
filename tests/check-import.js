// tests/check-import.js
//
// J27 — IMPORT AT ROOM CREATION. An option, in room creation, to build the room from a save file.
//
// WHAT THIS GUARD IS REALLY FOR. J25 built `readFile` and it had no production caller and could
// not have one — `CheckpointFormat` is a walled backend internal, so `features/` and `ui/` cannot
// reach it. That is the "correct module reached by nothing" shape (P1), and it is the same shape
// J26 closed in the other direction. So everything here is driven through `StreamManager` — the
// interface the app actually has — and never through the format module. A guard that called
// `CheckpointFormat.readFile` directly would pass on a build where the seam does not exist.
//
// The app half cannot be executed: `features/room.js` needs a live MatrixBridge and `app.js` needs
// a DOM. PARTS E and F are therefore static over the source, like `check-export` PARTS E and F,
// and that is stated rather than left implicit — a regex proving a name is SPELLED proves nothing
// about whether it RUNS.
//
//   A  the peer path is unreachable at import BY CONSTRUCTION, and the refusal says so
//   B  what the caller believes decides readability and nothing else; forging `owner` buys nothing
//   C  the imported checkpoint is re-anchored onto the room being created
//   D  the round trip: a room seeded from the file derives the SAME state, by fingerprint
//   E  the feature layer reads the file BEFORE it creates anything, and names no wire type
//   F  the create screen is actually wired to it, and decides nothing about the file

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load.js");
const F = require("./_fixtures.js");

let checks = 0;
function ok(c, m, extra) {
  assert.ok(c, m + (extra ? "  " + JSON.stringify(extra) : ""));
  checks++;
}

const ROOT = path.join(__dirname, "..");
// Block comments stripped BEFORE line comments, for the reason `check-export` records: a mutation
// that comments a call out with /* */ leaves the name spelled inside the region a regex searches,
// so an anchor matches a mention rather than the call. That defect was found by mutation on this
// file's sibling and the same stripper is used here.
function code(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
}

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
    BACKEND + "floor.js",
    BACKEND + "eventcache.js",
    BACKEND + "streammanager.js",
    BACKEND + "vouch.js",
    BACKEND + "session.js",
    BACKEND + "scheduler.js",
    BACKEND + "checkpoint.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

function sealed(sb, seed, n, prev, floorL, covers) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: false, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

// An EXPORTING room: a real fold, real cuts, two chained snapshots. This is where files come from.
function exportedRoom(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cut1 = log[2], cut2 = log[5];
  const cpA = sealed(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  const seedB = sb.StateDeriver.buildSeed(log.slice(3, 6), seedA);
  const cpB = sealed(sb, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);
  return { log, cpA, cpB, seedA, seedB, keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}
function fileOf(sb, snapshots, rank, keys) {
  return JSON.parse(JSON.stringify(sb.CheckpointFormat.saveFile({
    mode: "full", snapshots: snapshots, keyset: keys, author: { rank: rank },
  })));
}

// ── PART A — the peer path is unreachable at import, and the refusal is actionable ────────────
// THE MEASUREMENT THAT CHANGED THE JOB. `Floor.chainVerifies` locates each cut by INDEX into the
// event log and bails on `from <= 0 || to < 0`. A room that does not exist has no log, so every
// index resolves to -1 and a peer chain fails before any fold. That makes the peer path
// unreachable BY CONSTRUCTION rather than for being short — and the difference decides what the
// person is told, because one of those is fixable by re-exporting and the other is not.
//
// The ADJACENT ADMISSION is the whole part. A probe that reached nothing would refuse everything
// for free, so the same file is read both ways: with the exporting client's log (admitted) and
// with the room-being-created's absent one (refused). One detail changed, opposite answers.
{
  const sb = fresh();
  const X = exportedRoom(sb);
  const peerFile = fileOf(sb, [X.cpA, X.cpB], "staff", X.keys);

  const here = sb.CheckpointFormat.readFile(peerFile,
    { keys: X.keys, ownerAuthored: false, chainVerify: (c) => sb.Floor.chainVerifies(c, X.log) });
  ok(here.ok === true,
    "A: CONTROL — this peer file IS readable where its own log is held, so it is a well-formed "
    + "file rather than one that was broken all along (got " + here.reason + ")");

  const imported = sb.StreamManager.importFile(peerFile);
  ok(imported.ok === false,
    "A: and the SAME file is refused at import, where no log exists to fold between its cuts");
  ok(imported.reason === "peer-file-unimportable",
    "A: refused by a reason that names the real remedy. Left to itself readFile answers "
    + "`chain-refused`, which is true and UNACTIONABLE here — an operator told that re-exports, "
    + "and no re-export can supply a segment of a room this client will never hold. Same "
    + "ordering rule J25 applied when it put the keyset diagnosis ahead of the chain check",
    { got: imported.reason });
  ok(/owner-authored/.test(imported.detail || ""),
    "A: and the detail says what WOULD work, rather than only what did not");

  // SCARCITY IS THE WRONG AXIS, and this is the row that proves it. If more snapshots helped, the
  // remedy would be paging and the refusal above would be premature.
  const longer = sb.StreamManager.importFile(fileOf(sb, [X.cpA, X.cpB, X.cpB], "staff", X.keys));
  ok(longer.ok === false && longer.reason === "peer-file-unimportable",
    "A: a LONGER peer chain is refused identically — the answer does not move on the axis the "
    + "framing reaches for, so this is structural rather than a file that was simply short",
    { got: longer.reason });

  // And a corrupt peer file still reports its CORRUPTION rather than its provenance: the
  // translation happens after readFile has run, so the cheap structural checks still speak first.
  const corrupt = fileOf(sb, [X.cpA, X.cpB], "staff", X.keys);
  corrupt.fp = "$not-the-fingerprint";
  const cr = sb.StreamManager.importFile(corrupt);
  ok(cr.ok === false && cr.reason === "fingerprint-mismatch",
    "A: a CORRUPT peer file is still told it is corrupt — the import-specific refusal is a "
    + "translation of a chain answer, never a blanket verdict on peer files that hides a real "
    + "fault behind a provenance message", { got: cr.reason });
}

// ── PART B — what the caller believes decides READABILITY, and forging `owner` buys nothing ──
// `readFile` compares the file's `author` declaration against the caller's belief. At export that
// belief is grounded — the client knows what it holds. At import there is nothing to ground it in:
// no channel, no prior state, and no room id anywhere in the file, so the belief passed by the
// seam is the file's own declaration and the comparison is vacuous AT THIS CALL SITE. That is
// asserted rather than hidden, because a check reading as security and doing none is the false
// narrative `roles.md` §10 names.
//
// FORGING `owner` STILL BUYS NOTHING, for a reason that has nothing to do with the comparison:
// the file's rank reaches nothing. The checkpoint the importer publishes carries no author rank
// from the file, and the seed carries no ranks at all.
{
  const sb = fresh();
  const X = exportedRoom(sb);

  const ownerFile = fileOf(sb, [X.cpA], "owner", X.keys);
  const asOwner = sb.StreamManager.importFile(ownerFile);
  ok(asOwner.ok === true,
    "B: an owner-authored file reads at import with one snapshot — adopted on authority, no "
    + "recompute, so it never reaches the chain check the room cannot satisfy (got "
    + asOwner.reason + ")");

  // A peer file FORGED to declare owner. It is admitted — and that is the honest reading, because
  // the seam has nothing to contradict it with.
  const forged = fileOf(sb, [X.cpA], "owner", X.keys);
  const rf = sb.StreamManager.importFile(forged);
  ok(rf.ok === true,
    "B: a file DECLARING owner is admitted, because a file has no channel origin and the importer "
    + "has nothing to corroborate the declaration against. The comparison does not transfer to "
    + "this seam and the code says so rather than implying otherwise");

  // WHAT IT BUYS: nothing that travels. The published checkpoint carries no rank from the file.
  const anchor = { settingsFrom: "$genesis-settings", eventId: "$genesis-settings", l: 1 };
  const built = sb.Checkpoint.buildImport(rf.seed, anchor);
  ok(built.ok === true, "B: the forged file's seed still builds a checkpoint (it is a real seed)");
  const asText = JSON.stringify(built.cp);
  ok(asText.indexOf("owner") < 0,
    "B: APPLIED — and the word `owner` appears NOWHERE in what gets published. The file's rank "
    + "claim reaches no field of the checkpoint, so forging it changes nothing about the room "
    + "that is created; the room's authority comes from the channel the checkpoint is posted to");

  // And the deeper reason the claim cannot matter: the seed has no ranks to grant.
  const perMember = Object.keys(rf.seed.members[Object.keys(rf.seed.members)[0]]);
  ok(perMember.indexOf("rank") < 0 && perMember.indexOf("r") < 0,
    "B: the seed carries NO rank per member (fields: " + perMember.join(",") + ") — `rankByUser` "
    + "was deleted, so there is no roster in a save file for anyone to forge into");

  // The comparison itself is still LIVE one layer down — asserted so this part cannot be read as
  // saying the rule was removed. It was not; it just answers a question this seam cannot ask.
  const mismatched = sb.CheckpointFormat.readFile(fileOf(sb, [X.cpA], "staff", X.keys),
    { keys: X.keys, ownerAuthored: true });
  ok(mismatched.ok === false && mismatched.reason === "author-not-corroborated",
    "B: CONTROL — `readFile`'s corroboration still fires for a caller that HAS a belief, so what "
    + "changed is the call site's ability to form one, not the rule", { got: mismatched.reason });
}

// PART C ends in an AWAITED section, because the publish half is async. It is hung on this
// variable and awaited by the runner at the foot of the file rather than left floating: a
// rejection landing after the PASS line has printed is a guard announcing a success it does
// not have, which is the failure the announce-itself rule exists to close, one level in.
let PUBLISH = Promise.resolve();

// ── PART C — the imported checkpoint is re-anchored onto the room being created ──────────────
// A save file's checkpoint is a claim about a different room. `covers` and `floorL` name events
// this room has never held, and a floor placed where the log has never been is the pairing fault
// StreamManager already refuses by name. So the SEED crosses and every anchor is rebuilt.
{
  const sb = fresh();
  const X = exportedRoom(sb);
  const f = fileOf(sb, [X.cpA], "owner", X.keys);
  const read = sb.StreamManager.importFile(f);
  ok(read.ok === true, "C: the file reads, so there is a seed to re-anchor");

  const anchor = { settingsFrom: "$new-genesis", eventId: "$new-genesis", l: 1 };
  const built = sb.Checkpoint.buildImport(read.seed, anchor);
  ok(built.ok === true, "C: and it builds", { reason: built.reason });

  ok(built.cp.floorL === 1 && built.cp.covers === "$new-genesis..$new-genesis",
    "C: the cut names the NEW room's own genesis settings event, at its position — not the "
    + "exporting room's, which this room's log has never reached", built.cp.covers);
  ok(built.cp.covers.indexOf(X.cpA.covers.split("..")[1]) < 0,
    "C: APPLIED — and specifically NOT the old room's cut, so this is a rebuild rather than a "
    + "field that happened to be overwritten with something similar");
  ok(built.cp.seed.settingsFrom === "$new-genesis",
    "C: the settings pointer is re-anchored to the event the importer posts. The pointer "
    + "DESCRIBES and never decides, so this changes no verdict — it makes the claim checkable in "
    + "the room it now describes, which J25 settled when it answered J28's settings half");
  ok(built.cp.seed.settingsFrom !== read.seed.settingsFrom,
    "C: CONTROL — the pointer really MOVED. The exporting room's pointer was "
    + JSON.stringify(read.seed.settingsFrom) + ", and asserting the new value without asserting "
    + "it differs would pass on a fixture where the two happened to coincide");
  ok(built.cp.n === 1 && built.cp.prev === null,
    "C: it is the room's FIRST checkpoint — counter 1, no predecessor. Carrying the file's "
    + "counter would import a private seal count from a room whose chain does not continue here");
  ok(built.cp.thin === true,
    "C: and `thin` is TRUE, because the importer genuinely computed from a seed rather than from "
    + "this room's beginning. `thin` is the author's own statement about HOW it computed and it "
    + "is inside the fingerprint, so it is not a formality");

  // COMPLETENESS OF THE SETTINGS BLOB, which decides whether the room can ever prove its rules.
  const defaults = sb.StateDeriver.defaultSettings();
  const missing = Object.keys(defaults).filter((k) => !(k in built.cp.seed.settings));
  ok(missing.length === 0,
    "C: the sealed settings blob carries EVERY key this build declares (missing: "
    + JSON.stringify(missing) + "). `settingsBlobComplete` requires all of them, and a partial "
    + "blob answers `unverifiable` for the life of the room — which withholds the forget licence "
    + "permanently rather than loudly");

  // And it is self-consistent by the format's own predicate, which is what every reader asks.
  ok(sb.CheckpointFormat.verify(built.cp) === true,
    "C: and the rebuilt checkpoint verifies against its own fingerprint — the anchors are inside "
    + "`h`, so re-anchoring without recomputing it would produce a checkpoint nobody accepts");

  // The anchor is REQUIRED, not defaulted. A checkpoint with no place is worse than none.
  ok(sb.Checkpoint.buildImport(read.seed, null).ok === false,
    "C: an absent anchor is refused rather than defaulted");
  ok(sb.Checkpoint.buildImport(read.seed, { settingsFrom: "$a", eventId: "$a" }).ok === false,
    "C: and so is one with no position — `floorL` steers eviction and is committed by the "
    + "fingerprint, so guessing it is not an option");

  // THE DEFAULTS MERGE, DRIVEN ON A FILE THAT ACTUALLY NEEDS IT. The fixture above is folded by
  // THIS build, so its settings blob is already complete and the merge changes nothing — a
  // fixture too simple to distinguish the mutation from correct behaviour (08-build-and-deploy.md
  // §A guard must be able to fail). An older file is the case the merge exists for, so one is
  // built by removing a key the way age removes it.
  {
    const older = JSON.parse(JSON.stringify(read.seed));
    const dropped = Object.keys(older.settings)[0];
    delete older.settings[dropped];
    ok(!(dropped in older.settings),
      "C: CONTROL — the older-file fixture really is missing `" + dropped + "`, so the assertion "
      + "below has something to restore rather than agreeing with a blob that was complete");
    const b2 = sb.Checkpoint.buildImport(older, anchor);
    ok(b2.ok === true && (dropped in b2.cp.seed.settings),
      "C: APPLIED — a file predating a settings key seals a COMPLETE blob, with the missing value "
      + "filled from this build's defaults. That is the honest reading (checkpoint-contents §1.3): "
      + "the room really was running under the default, and an incomplete blob would answer "
      + "`unverifiable` for the life of the room");
  }

  // AND PUBLISHING REACHES THE WIRE. `buildImport` returning a correct object proves nothing about
  // whether anything sends it — the module-versus-wiring distinction (P1) that this tree keeps
  // paying for. The send is injected, so it can be driven.
  //
  // `amOwner` IS PART OF THE PRODUCTION SHAPE, and it is here because J28 made the function ask.
  // `matrixbridge.js` attaches it alongside `send`, so a harness supplying one and not the other is
  // not a smaller version of production — it is a different client, and it was answering `not-owner`
  // for a reason nothing in the room would ever reproduce. A guard must reach the subject the way
  // production does.
  PUBLISH = (async () => {
    const sent = [];
    sb.Checkpoint.attach({ send: async (type, cp) => { sent.push({ type, cp }); },
                           myUserId: () => "@importer:hs", amOwner: () => true });
    const res = await sb.Checkpoint.publishImport(read.seed, anchor);
    ok(res.ok === true, "C: publishImport reports success", { reason: res.reason });
    ok(sent.length === 1, "C: APPLIED — and it actually SENT, once", { sent: sent.length });
    ok(sent[0].type === sb.CheckpointFormat.TYPE,
      "C: on the checkpoint type, taken from the format module rather than spelled again",
      { got: sent[0].type });
    ok(sent[0].cp.h === built.cp.h,
      "C: and what went out is what buildImport built — the publisher adds nothing of its own");
    ok(sent[0].cp.by === "@importer:hs",
      "C: with the author's own id, injected by transport rather than read from the file");

    // ── THE OWNER GATE, WHICH IS THE HALF J27 PAID FOR WITH A PROMISE (J28) ──────────────────
    // J27 published without asking `maySeal` and discharged the cost with a WIRING claim: "it must
    // only ever be reached from room creation, where the caller is the owner by construction." J28
    // adds a second caller, so the claim is broken. Measured before it was replaced
    // (`probe-j28-running` R46): a guest-ranked, non-owner `_env` PUBLISHED — the promise was the
    // only thing holding it, and nothing in the tree was checking.
    //
    // A CONTROL SITS EITHER SIDE, because a refusal is evidence only if something adjacent was
    // admitted: the owner call above sent, this one does not, and the ONLY difference is `amOwner`.
    const before = sent.length;
    sb.Checkpoint.attach({ send: async (type, cp) => { sent.push({ type, cp }); },
                           myUserId: () => "@guest:hs", amOwner: () => false });
    const denied = await sb.Checkpoint.publishImport(read.seed, anchor);
    ok(denied.ok === false && denied.reason === "not-owner",
      "C: a non-owner is REFUSED by name — an import checkpoint declares an origin, and a client "
      + "adopting one stops folding its own history below the cut, which is why owner floors are "
      + "the only ones adopted without recompute (trust-cascade.md §6)", { got: denied.reason });
    ok(sent.length === before,
      "C: APPLIED — and nothing went to the wire. Asserting the return value alone would pass on a "
      + "function that refuses AFTER sending", { sentAfter: sent.length, before });

    // FAIL CLOSED WHEN AUTHORITY CANNOT BE READ. An absent `amOwner` is "I cannot establish that
    // this client is the owner", and the safe default for an ACCEPTANCE is to accept nothing.
    //
    // `amOwner` IS EXPLICITLY CLEARED, and the first version of this row did not do it. `attach`
    // MERGES (`Object.assign({}, _env, env)`), so omitting the key leaves the PREVIOUS block's
    // `amOwner: () => false` in place — and the assertion passed on that rather than on the
    // default it claims to test. Mutation caught it: flipping the `: false` fallback to `: true`
    // left the guard green. The assertion was load-bearing for a different claim than the one it
    // appeared to make, which is the decorative-assertion shape `paths.md` §9.12 says to expect in
    // a guard written minutes earlier.
    sb.Checkpoint.attach({ send: async (type, cp) => { sent.push({ type, cp }); },
                           myUserId: () => "@importer:hs", amOwner: undefined });
    ok(typeof sb.Checkpoint._envProbe !== "function"
       || typeof sb.Checkpoint._envProbe().amOwner !== "function",
      "C: PRECONDITION — and the env really has no owner reader, so the row below tests the "
      + "DEFAULT rather than a leftover `false` from the block above");
    const unknown = await sb.Checkpoint.publishImport(read.seed, anchor);
    ok(unknown.ok === false && unknown.reason === "not-owner",
      "C: and an env that cannot answer the question at all fails CLOSED rather than defaulting to "
      + "permitted", { got: unknown.reason });

    // A SEND FAILURE IS REPORTED, NOT SWALLOWED. A publish that quietly answers ok would leave a
    // room with the file's settings and none of its state, and nothing saying so.
    sb.Checkpoint.attach({ send: async () => { throw new Error("homeserver said no"); },
                           myUserId: () => "@importer:hs", amOwner: () => true });
    const bad = await sb.Checkpoint.publishImport(read.seed, anchor);
    ok(bad.ok === false && bad.reason === "send-failed",
      "C: CONTROL — and a send that throws is reported as a failure rather than reading as a "
      + "successful publish", { got: bad.reason });
  })();
}

// ── PART D — the round trip: the created room derives the SAME state ─────────────────────────
// The job's Done-when, driven the way J25's PART A drives its own: serialise through real JSON,
// then compare `ConsensusHash` fingerprints of the WHOLE derived state. Not similar — identical.
//
// WITH A CONTROL PROVING IDENTITY CAN FAIL, because a comparison that cannot come apart proves
// nothing. J25's first control varied `tick`, which does not reach derived state until somebody
// joins; this one varies the rotation, which does.
{
  const sb = fresh();
  const X = exportedRoom(sb);

  // What the exporting room derived at that cut.
  const before = sb.StateDeriver.derive([], X.cpA.seed);

  // The file, through real JSON, into the seam, re-anchored, and folded as the new room folds it.
  const f = fileOf(sb, [X.cpA], "owner", X.keys);
  const wire = JSON.parse(JSON.stringify(f));
  const read = sb.StreamManager.importFile(wire);
  ok(read.ok === true, "D: the round-tripped file reads", { reason: read.reason });

  const anchor = { settingsFrom: "$new-genesis", eventId: "$new-genesis", l: 1 };
  const built = sb.Checkpoint.buildImport(read.seed, anchor);
  const after = sb.StateDeriver.derive([], built.cp.seed);

  const print = (s) => sb.ConsensusHash.contentHash({
    rotation: s.rotation, nowPlaying: s.nowPlaying, counts: s.counts, history: s.history,
  });
  ok(print(before) === print(after),
    "D: the file's SEED round-trips: re-anchored and folded, it produces a fingerprint-identical "
    + "state to the one the exporting room derived at that cut — rotation, now-playing and counts, "
    + "through real JSON and the seam. NOTE THE SUBJECT, corrected at J28: this compares two "
    + "REDUCER folds, not two clients. What a created-from-file CLIENT derives is a DIFFERENT "
    + "QUESTION, and for two releases it had a different answer: `_deriveBest` returned the "
    + "genesis fold as live state until a trim, and the trim needed a licence an imported seed "
    + "could not earn. J46 (v254) made the two agree, and `check-origin-fold` PART B asserts the "
    + "agreement at this exact seam rather than only asserting the client's half — because a "
    + "green guard on the module while the wiring derived nothing is what happened here, and the "
    + "distinction is worth keeping even now that the answers match. The message here used to "
    + "read 'the created-from-file room derives...', which named a thing that did not happen "
    + "(roles.md §10)");

  // THE CONTROL: identity must be capable of failing.
  //
  // ITS FIRST VERSION DID NOT, AND THE REASON IS RECORDED RATHER THAN QUIETLY REPLACED. It added
  // `{ pending: [], orderKey: 1 }` — a member with an EMPTY buffer — and the fingerprint did not
  // move, because `projectRotation` does not emit a member with nothing declared: an emptied
  // buffer is the hard fall-out rule, so such a member is already out. So it varied membership on
  // an axis the projection deliberately ignores and proved nothing about the identity above. Same
  // family as `check-accepted-boundary` PART A's original control, one variable over: the
  // assertion was not decorative, it was load-bearing for a claim I was not making.
  const tampered = JSON.parse(JSON.stringify(built.cp.seed));
  tampered.members["@interloper:hs"] = { pending: [{ videoId: "ZZZ", videoUrl: null }], orderKey: 1 };
  ok(print(sb.StateDeriver.derive([], tampered)) !== print(before),
    "D: CONTROL — a seed differing by one rotation member DERIVES a different fingerprint, so the "
    + "identity above is a real comparison rather than two readings of nothing");

  // THE SUBJECT OF A MULTI-SNAPSHOT FILE IS THE NEWEST CUT, ordered by POSITION. An owner pick
  // exports with whatever chain material the client held at or below it, so a file may carry more
  // than one snapshot even on the path that needs only one — and seeding from the wrong end would
  // silently restore the room to an earlier moment. Position, never the author's private seal
  // counter `n`, which is incomparable across authors.
  {
    const two = fileOf(sb, [X.cpA, X.cpB], "owner", X.keys);
    const r2 = sb.StreamManager.importFile(two);
    ok(r2.ok === true, "D: a two-snapshot owner file reads", { reason: r2.reason });
    ok(JSON.stringify(r2.seed) === JSON.stringify(X.cpB.seed),
      "D: and its subject is the NEWEST cut, not the oldest — seeding from the wrong end would "
      + "restore the room to an earlier moment with nothing saying so");
    ok(JSON.stringify(X.cpA.seed) !== JSON.stringify(X.cpB.seed),
      "D: CONTROL — the two snapshots really do describe different states, so the assertion above "
      + "distinguishes the ends rather than reading two copies of one seed");
  }

  // SETTINGS SURVIVE THE CROSSING, which is the half the pointer re-anchoring must not disturb.
  ok(JSON.stringify(after.settings) === JSON.stringify(
       Object.assign(sb.StateDeriver.defaultSettings(), X.cpA.seed.settings || {})),
    "D: and the room's settings are the FILE's, merged over this build's defaults so nothing the "
    + "file predates is left undefined");

  // AND THE ROTATION OF ABSENT PEOPLE DRAINS RATHER THAN STALLING. The Open asks what an import
  // does when the people in it never join. The answer is that it never claimed them: the seed
  // carries their declared songs, the room plays those, and each falls out when the buffer empties
  // by the hard fall-out rule that already exists. No new eviction rule, and no stall.
  const startRot = after.rotation.length;
  ok(startRot > 0, "D: CONTROL — the imported rotation is non-empty, so there is something to "
    + "drain and the assertion below is not vacuous");
  const buffered = after.rotation[0].pending.length;
  ok(buffered > 0, "D: CONTROL — and the absent DJ arrives with declared songs, which is what "
    + "lets the room play at all before anyone joins");
  const evs = [];
  let l = 1000, ts = (after.nowPlaying ? after.nowPlaying.startedAt : 100000);
  let prevPi = after.nowPlaying ? after.nowPlaying.pi : null;
  for (let i = 0; i <= buffered; i++) {
    evs.push(F.reducerEvent("$imp" + i, ++l, ts += 400000, "@importer:hs", F.RANK.owner,
      { t: "ddjp.dj.play", p: prevPi }));
    prevPi = "$imp" + i;
  }
  const drained = sb.StateDeriver.derive(evs, built.cp.seed);
  ok(drained.rotation.length === 0,
    "D: playing through the imported buffer empties the rotation (" + startRot + " -> "
    + drained.rotation.length + ") — so a room whose imported members never join drains itself "
    + "rather than holding seats for people who are not there");
}

// ── PART E — the feature layer reads BEFORE it creates, and names no wire type ───────────────
// Static, because `features/room.js` needs a live MatrixBridge. Kept narrow: ORDER, and the two
// things that would be boundary violations.
{
  const room = code("features/room.js");
  const i = room.indexOf("async function createFromFile");
  ok(i >= 0, "E: features/room.js has a createFromFile path");
  const after = room.slice(i);
  const end = after.search(/\n  (?:async )?function \w+\s*\(/);
  const body = end > 0 ? after.slice(0, end) : after;

  const iRead = body.indexOf("StreamManager.importFile");
  const iCreate = body.search(/await create\(/);
  ok(iRead >= 0, "E: it reads the file through the SEAM (importFile), not through the format "
    + "module, which features/ may not reach at all");
  ok(iCreate >= 0, "E: and it creates the room by calling create() unchanged, so the channels are "
    + "built to THIS build's shape whatever shape the file came from — the second half of the "
    + "Done-when, and the one place a legacy branch would be tempting");
  ok(iRead < iCreate,
    "E: APPLIED — and the read comes FIRST. Creating twenty-one rate-limited rooms and then "
    + "discovering the file is unreadable leaves a real half-purpose room and a person who has to "
    + "delete it; every refusal importFile can produce is computable from the file alone",
    { readAt: iRead, createAt: iCreate });

  ok(!/sendEvent\([^)]*"ddjp\.checkpoint"/.test(body) && body.indexOf("ddjp.checkpoint") < 0,
    "E: it names no checkpoint wire type. Publishing goes through StreamManager.importCheckpoint "
    + "-> Checkpoint.publishImport -> the injected send, so the type has one home and the channel "
    + "is chosen where the channel map lives");
  ok(/StreamManager\.importCheckpoint/.test(body),
    "E: and that is the call it makes");
  ok(!/CheckpointFormat|Floor\.|Checkpoint\./.test(body),
    "E: and it reaches no backend INTERNAL directly (check-boundaries rule F) — the whole reason "
    + "this job began with a passthrough rather than with the UI its entry named first");

  // The failure this leaves behind must stay loud, exactly as create()'s does.
  ok(/Logger\.error\([^)]*imported settings NOT posted/.test(room)
     && /Logger\.error\([^)]*imported checkpoint NOT published/.test(room),
    "E: both post-creation failures are logged at ERROR rather than swallowed. The channels exist "
    + "by then, so throwing would orphan a real room — that is a decision, and a decision nobody "
    + "can see is a bug");
}

// ── PART F — the create screen is wired to it, and decides nothing about the file ────────────
// Static, because app.js needs a DOM. This is the part P1 is about: a correct seam reached by no
// button is the shape this tree keeps finding.
{
  const app = code("app.js");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  ok(/id="btn-create-from-file"/.test(html) && /id="input-import-file"/.test(html),
    "F: the create section carries a file input and a button");
  ok(html.indexOf('id="input-import-file"') > html.indexOf('id="create-room-section"')
     && html.indexOf('id="input-import-file"') < html.indexOf('id="export-section"'),
    "F: and they sit inside the CREATE section — the job is 'import at room creation', and an "
    + "import control parked beside the export list would be a different feature");

  ok(/getElementById\("btn-create-from-file"\)/.test(app),
    "F: app.js resolves the button");
  // THE CONDITION IS PART OF THE ASSERTION, AND THAT IS A DEFECT THIS GUARD HAD ON ITS FIRST RUN.
  // It matched `importBtn.addEventListener("click"` alone, and mutation M8 disabled the
  // registration with `if (false)` — the name still spelled, the call unreachable, and the guard
  // still GREEN. Same family as the block-comment defect `check-export` M6 found in its sibling,
  // arriving through a different door: there the anchor matched a mention in a comment, here it
  // matched a call that cannot run. So the shape is pinned rather than the name.
  ok(/if \(importBtn\) importBtn\.addEventListener\(\s*"click"/.test(app),
    "F: APPLIED — and SUBSCRIBES to it, under the element's own existence check and nothing else. "
    + "Resolving an element proves an id is spelled somewhere; a registration behind a condition "
    + "that is never true proves less than nothing, because it reads as wiring");

  // AND THE HANDLER BODY IS WHAT REACHES THE SEAM. Bounding the region stops a match somewhere
  // else in this file standing in for this one, which is exactly how a textual guard lies.
  const hStart = app.indexOf("if (importBtn) importBtn.addEventListener");
  const hEnd = app.indexOf("\n  createRetryBtn.addEventListener", hStart);
  ok(hStart >= 0 && hEnd > hStart, "F: the handler body can be bounded for scanning");
  const handler = app.slice(hStart, hEnd);
  ok(/attemptCreate\(\s*name\s*,\s*parsed\s*\)/.test(handler),
    "F: and INSIDE that handler the parsed file is handed to the create flow — the same progress, "
    + "error and resume machinery as a plain create, rather than a second copy of it");
  ok(/Room\.createFromFile\(/.test(app),
    "F: and the create flow reaches Room.createFromFile");
  ok(/JSON\.parse\(await [a-zA-Z]+\.text\(\)\)/.test(handler),
    "F: it parses the file as JSON, in the handler rather than anywhere else");

  // THE UI DECIDES NOTHING ABOUT THE FILE. Every verdict — version, mode, keyset, authorship,
  // chain — belongs below the seam. A copy up here would be the drift P7 is about, and it would
  // be a copy in the one layer no guard in this suite executes.
  for (const token of ["ddjp\\s*[!=]==?\\s*1", "keyset", "chainVerif", "author", "ownerAuthored",
                       "snapshots\\.length"]) {
    ok(!new RegExp(token).test(app),
      "F: app.js does not decide `" + token + "` about the file — every verdict is the seam's, "
      + "and this is the layer nothing in the suite runs");
  }
}

PUBLISH.then(() => {
console.log("[import] PASS — a room can be created from a save file, and the seam it needs exists "
  + "at last: `readFile` had no production caller from the day J25 wrote it, so this begins with "
  + "the passthrough its entry did not anticipate rather than with the UI its entry named first. "
  + "Driven rather than assumed, and the driving changed the job: `Floor.chainVerifies` folds the "
  + "log BETWEEN a peer file's cuts, and a room being created holds none of it — so the peer path "
  + "is unreachable BY CONSTRUCTION, not for being short, and a longer chain is refused "
  + "identically. That refusal now names the remedy that exists rather than the chain answer that "
  + "cannot be acted on, while a corrupt peer file still reports its corruption. The authorship "
  + "comparison is asserted for what it is at this seam — vacuous, because a file has no channel "
  + "origin and the importer has nothing to corroborate against — and forging `owner` is shown to "
  + "buy nothing for the reason that actually holds: the word reaches no field of the published "
  + "checkpoint, and the seed carries no ranks for anyone to forge into. The imported cut is "
  + "REBUILT onto the new room's own genesis settings event, with the pointer proven to have "
  + "moved, and the round trip derives a fingerprint-identical state against a control that can "
  + "fail. And the Open's premise is corrected in the assertions: an import claims nobody, so a "
  + "rotation whose people never join drains itself by the hard fall-out rule that already "
  + "existed (" + checks + " assertions)");
});
