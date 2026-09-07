// tests/check-savefile.js
//
// J25 — THE SAVE-FILE FORMAT. The `Done when` this file exists to satisfy:
//   "A guard round-trips a room: export, import, and prove the derived state is identical.
//    Not similar — identical, by fingerprint."
//
// WHAT THIS GUARD IS ABOUT, so nobody has to infer it from the assertions. A save file is NOT a
// new artefact: `checkpoint-contents.md` §7 fixes the export format AS the checkpoint format, so
// everything here is about the ENVELOPE around an artefact that already exists and already
// verifies. The envelope earns its place by answering three questions the bare checkpoint cannot:
// which format version wrote this, which consensus model produced it, and — the one this session
// added — WHICH SETTINGS KEY SET it was written against.
//
// THE ADMISSIBILITY GATE. Every refusal asserted here is paired with an adjacent admission that
// must pass: a reader that refuses everything satisfies "refuses a bad file" for free, and an
// unreached fixture returns the same value in every tree (`docs/paths.md` §9.6). Each PART states
// its own precondition, checks it BEFORE the comparison, and names the stage that broke. The gate
// is itself untested code, so PART 0 feeds it a deliberately broken input and shows it catches it.
//
// WHY A KEYSET FIELD IS PART OF THE FORMAT RATHER THAN A SEPARATE GUARD (J45). Adding one settings
// key turns `Floor.chainVerifies` from true to false against every checkpoint sealed before it,
// while `StreamManager.seedValidation` stays `validated` — measured, both directions, by
// `tools/probes/mutate-j25-settings-coupling.js`. A FORMAT VERSION does not move when that
// happens, because `checkpoint-contents.md` §1.3 is explicit that a new setting needs no new seed
// field. So the version marker alone cannot distinguish "this file predates key K" from "this file
// is corrupt", which is the exact distinction J25's entry says the marker exists to make. The
// keyset closes that gap at the only layer that can: the file itself. PART G drives it.
//
// P6 AND THE AUTHOR FIELD. Rank comes from the channel an event arrived on, never from its body —
// and a file has no channel. So the file's `author.rank` is a DECLARATION, never a grant: the
// caller supplies its own belief about provenance and a disagreement is a stated refusal. Forging
// `owner` in the file does not buy the owner's single-snapshot path. PART D drives that too.

const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));

const BACKEND = "backends/backend1/";
const sb = loadInContext([
  "core/logger.js",
  BACKEND + "ranks.js",
  BACKEND + "consensushash.js",
  BACKEND + "trustpolicy.js",
  BACKEND + "statederiver.js",
  BACKEND + "checkpointformat.js",
  BACKEND + "floor.js",
], { Date, Math, JSON, setTimeout, clearTimeout, Promise });

const SD = sb.StateDeriver;
const CF = sb.CheckpointFormat;
const Floor = sb.Floor;
const CH = sb.ConsensusHash;

let failures = 0;
let compared = 0;

function ok(cond, msg) {
  compared++;
  if (!cond) { failures++; console.log("[savefile] FAIL — " + msg); }
}
// The gate: a precondition that must hold before a comparison is readable. It does not assert the
// subject — it asserts the fixture reached the subject — and it names the stage that broke.
let gatesTripped = 0;
let gateQuiet = false;
function gate(stage, cond, why) {
  if (cond) return true;
  gatesTripped++;
  failures++;
  if (!gateQuiet) {
    console.log("[savefile] VOID at stage " + stage + " — " + why +
      " (an unreached measurement returns the same value in every tree)");
  }
  return false;
}

const canon = (x) => {
  if (Array.isArray(x)) return "[" + x.map(canon).join(",") + "]";
  if (x && typeof x === "object") {
    return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}";
  }
  return JSON.stringify(x);
};
// The Done when asks for identity BY FINGERPRINT, not by eye. Hash the canonical form of the whole
// derived state, so a difference anywhere in it fails rather than only in the fields we thought to
// list. (Hashing the canonical STRING rather than the object keeps this total: `advance` carries
// values DCF would refuse to hash directly, and a guard that throws is a guard that hides its
// subject.)
const statePrint = (st) => CH.contentHash({ s: canon(st) });

// ── the room ────────────────────────────────────────────────────────────────────────────────
// Four songs, so three playings are off air by the end; an owner settings event so `settingsFrom`
// is a real id rather than null; reactions on an off-air playing and on the live one.
const room = F.playingRoom({ songs: 4 });
const log = room.log.slice();
let l = room.lastL;
log.push(F.reducerEvent("$set1", ++l, 120000, "@owner:hs", F.RANK.owner,
  { t: "ddjp.room.settings", s: { maxLen: 900 } }));
const early = room.pi(0), live = room.pi(3);
log.push(F.reducerEvent("$v1", ++l, 130000, "@a:hs", F.RANK.player, { t: "ddjp.dj.vote", p: early }));
log.push(F.reducerEvent("$s1", ++l, 130002, "@a:hs", F.RANK.player, { t: "ddjp.dj.save", p: early }));
log.push(F.reducerEvent("$v3", ++l, 900000, "@c:hs", F.RANK.player, { t: "ddjp.dj.vote", p: live }));
const ordered = F.sortLog(log);

const genesis = SD.derive(ordered);
const CURRENT_KEYS = Object.keys(SD.defaultSettings()).sort();

// Two chained snapshots over the same log, so both the owner path (one) and the peer path (two)
// have a real artefact behind them.
function mk(n, prev, seed, floorL, covers, thin) {
  const h = CF.fingerprint(n, prev, seed, floorL, thin === true, covers);
  return { n: n, prev: prev || null, seed: seed, floorL: floorL, thin: thin === true, covers: covers, h: h };
}
const cutA = ordered[5], cutB = ordered[ordered.length - 1];
const seedA = SD.buildSeed(ordered.slice(0, 6));
const seedB = SD.buildSeed(ordered.slice(6), seedA);
const cpA = mk(1, null, seedA, cutA.l, CF.coversOf(ordered[0].eventId, cutA.eventId));
const cpB = mk(2, cpA.h, seedB, cutB.l, CF.coversOf(ordered[6].eventId, cutB.eventId));
const chainVerify = (snaps) => Floor.chainVerifies(snaps, ordered);

// ── PART 0 — the gate's own self-test ───────────────────────────────────────────────────────
// The gate certifies everything downstream on its own authority, so it is shown catching a
// deliberately broken input before anything trusts it.
{
  const before = gatesTripped, beforeFail = failures;
  gateQuiet = true;
  const passed = gate("selftest", false, "a deliberately false precondition");
  gateQuiet = false;
  const caught = (passed === false) && (gatesTripped === before + 1);
  gatesTripped = before; failures = beforeFail;   // un-count the deliberate trip
  ok(caught, "PART 0: the admissibility gate did not catch a false precondition — every VOID " +
    "below is unreliable and this guard certifies nothing");
}

// ── PART A — THE ROUND TRIP (the Done when) ─────────────────────────────────────────────────
{
  const S = "A";
  if (gate(S, genesis.nowPlaying && genesis.rotation.length > 0 && genesis.history.length > 0,
      "the genesis fold has no nowPlaying, an empty rotation or no history, so 'identical after " +
      "a round trip' would compare two empty rooms")) {

    const file = CF.saveFile({
      mode: "full",
      snapshots: [cpA, cpB],
      hist: SD.projectHistory(genesis.history, { limit: 50 }),
      keyset: CURRENT_KEYS,
      author: { rank: "player" },
    });
    // Through an actual serialisation, not an object handed straight back: the format has to
    // survive JSON, which is what a file IS.
    const wire = JSON.stringify(file);
    const read = CF.readFile(JSON.parse(wire), {
      keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify,
    });

    if (gate(S, read.ok === true, "the file did not read back at all (" + read.reason + "), so " +
        "there is nothing to compare")) {
      const imported = SD.derive([], read.snapshots[read.snapshots.length - 1].seed);
      const direct = SD.derive([], seedB);
      ok(statePrint(imported) === statePrint(direct),
        "PART A: a room imported from the FILE does not fingerprint-identically to the same seed " +
        "applied directly — the envelope is changing the artefact it wraps");

      // The control: identity must be capable of failing. A file whose seed has been altered by
      // one field must NOT reproduce the same fingerprint, or "identical" above is free.
      //
      // THE FIRST VERSION OF THIS CONTROL VARIED `tick`, AND IT WAS THE WRONG AXIS — recorded
      // rather than quietly corrected, because it is the failure `09-roadmap.md` §8 names: an
      // assertion pair that LOOKS like a control is read as one and the question dies there.
      // `tick` is a seed field that does not appear in derived state at all; it becomes observable
      // only once somebody JOINS, which is why PART E has to add a joiner to see it. Varying it
      // here moved nothing, so the control failed honestly and said the identity assertion above
      // could not fail. `settings` is varied instead, because that is a field the rule under test
      // is actually about.
      const tampered = JSON.parse(wire);
      tampered.payload.snapshots[1].seed.settings.maxLen =
        (tampered.payload.snapshots[1].seed.settings.maxLen || 0) + 1;
      const alt = SD.derive([], tampered.payload.snapshots[1].seed);
      ok(statePrint(alt) !== statePrint(direct),
        "PART A control: altering the sealed seed did not move the derived-state fingerprint, so " +
        "the identity assertion above cannot fail and proves nothing");
    }
  }
}

// ── PART B — the envelope is FIRST and OUTSIDE the fingerprint ──────────────────────────────
{
  const S = "B";
  const file = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
    author: { rank: "player" } });
  const keys = Object.keys(file);
  ok(keys[0] === "ddjp" && keys[1] === "mode",
    "PART B: the envelope's first two keys are " + JSON.stringify(keys.slice(0, 2)) +
    ", not [\"ddjp\",\"mode\"] — the version and mode must be readable from the first bytes");
  ok(Number.isSafeInteger(file.ddjp) && (file.mode === "full" || file.mode === "bot"),
    "PART B: the version is not an integer or the mode is not one of full|bot");

  // OUTSIDE, driven in BOTH directions. One direction proves the envelope is ignored by the
  // commitment; the other proves the commitment is not simply inert.
  //
  // THE FIRST VERSION OF THIS ASSERTION WAS DECORATIVE AND A MUTATION FOUND IT, which is recorded
  // rather than quietly corrected because it is the §9.12 case exactly. It read
  //   `CF.filePrint({...file, mode:"bot"}.payload) === file.fp`
  // — mutating the envelope and re-hashing the PAYLOAD. `filePrint` only ever receives the
  // payload, so `mode` could not have reached it whatever the code did: the assertion was true by
  // the function's SIGNATURE and could not fail. It looked like a both-directions pair and the
  // question died there. The claim has to be tested where it is decidable — at the FILE, comparing
  // two files that differ ONLY in an envelope key, because `saveFile` could perfectly well have
  // written `mode` into the payload and nothing above would have noticed.
  if (gate(S, typeof file.fp === "string" && file.fp.length > 0,
      "the file carries no payload fingerprint, so 'outside the fingerprint' has no subject")) {
    const asFull = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    const asBot = CF.saveFile({ mode: "bot", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    ok(asFull.mode !== asBot.mode && asFull.fp === asBot.fp,
      "PART B: two files differing ONLY in an envelope key carry DIFFERENT payload fingerprints — " +
      "the envelope is inside the commitment, so a future envelope field would retroactively " +
      "unverify every older file, which is the ROW 1 mechanism the envelope exists to sit outside of");

    const shorter = CF.saveFile({ mode: "full", snapshots: [cpA], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    ok(asFull.fp !== shorter.fp,
      "PART B control: two files differing in a PAYLOAD section carry the SAME fingerprint, so " +
      "the assertion above holds for the wrong reason — the commitment covers nothing");

    const payMoved = JSON.parse(JSON.stringify(file));
    payMoved.payload.snapshots[0].n = 99;
    ok(CF.filePrint(payMoved.payload) !== file.fp,
      "PART B: altering a snapshot inside the payload did not move the fingerprint");
  }
}

// ── PART C — an unknown version is refused with a STATED reason ─────────────────────────────
{
  const S = "C";
  const good = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
    author: { rank: "player" } });
  const okRead = CF.readFile(JSON.parse(JSON.stringify(good)),
    { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
  if (gate(S, okRead.ok === true,
      "the current-version control was refused (" + okRead.reason + "), so refusing a foreign " +
      "version proves only that the reader refuses everything")) {
    const foreign = JSON.parse(JSON.stringify(good));
    foreign.ddjp = good.ddjp + 1;
    const r = CF.readFile(foreign, { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(r.ok === false && r.reason === "unknown-version",
      "PART C: a file from a later format version was not refused as unknown-version (got " +
      r.reason + ") — a partial read of a foreign file is the path nothing exercises that " +
      "08-build-and-deploy.md §Legacy deletes as a category");
    ok(typeof r.detail === "string" && r.detail.indexOf(String(foreign.ddjp)) >= 0,
      "PART C: the refusal does not NAME the version it refused, so the reason is not stated");
  }
}

// ── PART D — one snapshot or a chain, decided by AUTHOR ─────────────────────────────────────
{
  const S = "D";
  if (gate(S, chainVerify([cpA, cpB]) === true && CF.verify(cpA) === true,
      "the two-snapshot control does not chain-verify, so refusing a lone peer snapshot is " +
      "attributable to the fixture rather than to the rule")) {

    const peerOne = CF.saveFile({ mode: "full", snapshots: [cpA], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    const rPeerOne = CF.readFile(peerOne, { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(rPeerOne.ok === false && rPeerOne.reason === "chain-too-short",
      "PART D: a peer-authored file carrying ONE snapshot was not refused as chain-too-short " +
      "(got " + rPeerOne.reason + ") — Floor.chainVerifies refuses below two, so such a file can " +
      "be read and never trusted");

    const peerTwo = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    ok(CF.readFile(peerTwo, { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify }).ok === true,
      "PART D control: a peer-authored file carrying a verifying CHAIN was refused, so the " +
      "refusal above is not attributable to the chain rule");

    const ownerOne = CF.saveFile({ mode: "full", snapshots: [cpA], keyset: CURRENT_KEYS,
      author: { rank: "owner" } });
    ok(CF.readFile(ownerOne, { keys: CURRENT_KEYS, ownerAuthored: true, chainVerify: chainVerify }).ok === true,
      "PART D: an owner-authored file carrying ONE snapshot was refused — an owner floor is " +
      "adopted on authority with no recompute, and that asymmetry is Floor.select's, applied to a file");

    // P6: the file's own author claim must not BUY the owner path. The caller's belief decides.
    const forged = CF.saveFile({ mode: "full", snapshots: [cpA], keyset: CURRENT_KEYS,
      author: { rank: "owner" } });
    const rForged = CF.readFile(forged, { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(rForged.ok === false,
      "PART D: a file DECLARING owner authorship was admitted on one snapshot while the caller " +
      "did not corroborate it — that is rank read from a body, which P6 forbids and which a file " +
      "cannot prove because it has no channel origin");
  }
}

// ── PART E — tick travels at high-water through the FILE ────────────────────────────────────
{
  const S = "E";
  const file = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
    author: { rank: "player" } });
  const read = CF.readFile(JSON.parse(JSON.stringify(file)),
    { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
  if (gate(S, read.ok === true && read.snapshots[1].seed.tick > 0,
      "the file's seed carries no positive tick, so high-water and zero are the same fixture")) {
    const seed = read.snapshots[1].seed;
    const joiner = F.reducerEvent("$late", 9000, 950000, "@late:hs", F.RANK.player,
      { t: "ddjp.dj.join", v: "LATESONG" });
    const high = SD.derive([joiner], seed).rotation.map((r) => r.userId || r.user || r.dj);
    const zeroed = JSON.parse(JSON.stringify(seed)); zeroed.tick = 0;
    const flat = SD.derive([joiner], zeroed).rotation.map((r) => r.userId || r.user || r.dj);
    ok(canon(high) !== canon(flat),
      "PART E control: dropping tick to 0 changed nothing about the rotation order, so the " +
      "high-water assertion below cannot fail");
    ok(high[high.length - 1] === "@late:hs",
      "PART E: a joiner arriving after an import did not enter at the BACK of the rotation " +
      "(got " + canon(high) + ") — a dropped tick puts a post-import joiner at the head");
  }
}

// ── PART F — hist? is carried, spanned, and reducer-INERT ───────────────────────────────────
{
  const S = "F";
  const tail = SD.projectHistory(genesis.history, { limit: 50 });
  if (gate(S, tail.length > 0 && SD.derive([], seedB).history.length === 0,
      "either the genesis fold produced no history or the seeded fold already has some — in " +
      "both cases 'the tail is what restores the pane' measures nothing")) {

    const withHist = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], hist: tail,
      keyset: CURRENT_KEYS, author: { rank: "player" } });
    const r = CF.readFile(JSON.parse(JSON.stringify(withHist)),
      { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(r.ok === true && Array.isArray(r.hist) && r.hist.length === tail.length,
      "PART F: the history tail did not survive the round trip");

    // INERT: it must not reach forward derivation. Same seed, with and without the tail.
    const noHist = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    const rNo = CF.readFile(JSON.parse(JSON.stringify(noHist)),
      { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(statePrint(SD.derive([], r.snapshots[1].seed)) === statePrint(SD.derive([], rNo.snapshots[1].seed)),
      "PART F: a file carrying a history tail derives a DIFFERENT room from one without it — " +
      "the tail is feeding forward derivation, which §2 of checkpoint-contents.md forbids");

    // SPANNED: tampering with the tail must move the payload fingerprint.
    const t = JSON.parse(JSON.stringify(withHist));
    t.payload.hist[0].videoId = "TAMPERED123";
    ok(CF.filePrint(t.payload) !== withHist.fp,
      "PART F: altering the history tail did not move the payload fingerprint — an optional " +
      "section must be spanned by the fingerprint when present");
    ok(CF.readFile(t, { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify }).ok === false,
      "PART F control: the reader admitted a file whose payload fingerprint no longer matches, " +
      "so the spanning above buys nothing at the door");
  }
}

// ── PART G — the keyset names what a bare refusal cannot (J45) ──────────────────────────────
{
  const S = "G";
  const older = CURRENT_KEYS.filter((k) => k !== "presendMs");
  if (gate(S, older.length === CURRENT_KEYS.length - 1,
      "the key chosen to drop is not in the current key set, so the older-file fixture is not older")) {

    // A file written before `presendMs` existed. Its snapshots are untouched and still
    // self-consistent; only the recorded keyset is older.
    const oldFile = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: older,
      author: { rank: "player" } });
    const r = CF.readFile(JSON.parse(JSON.stringify(oldFile)),
      { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(r.reason === "keyset-older",
      "PART G: a file written before a settings key existed was diagnosed as " + r.reason +
      " rather than keyset-older — a reader that cannot tell 'predates key K' from 'corrupt' " +
      "gives the two opposite responses the version marker exists to separate");
    ok(Array.isArray(r.missingKeys) && r.missingKeys.indexOf("presendMs") >= 0,
      "PART G: the diagnosis does not NAME the key the file predates, which is the whole " +
      "difference between an announcement and a bare false (J45)");

    // THE OTHER HALF OF "OPPOSITE RESPONSES", and the half that makes the diagnosis worth
    // carrying: the SAME age of file under OWNER provenance is usable rather than refused. The
    // seeded reader is Object.assign(defaultSettings(), seed.settings), so the key the file
    // predates is filled from the current default — which checkpoint-contents.md §1.3 calls the
    // honest reading, because that room really was running under it. One file age, two
    // provenances, two outcomes; a reader that answered the same to both would be wrong once.
    const oldOwner = CF.saveFile({ mode: "full", snapshots: [cpA], keyset: older,
      author: { rank: "owner" } });
    const ro = CF.readFile(JSON.parse(JSON.stringify(oldOwner)),
      { keys: CURRENT_KEYS, ownerAuthored: true, chainVerify: chainVerify });
    ok(ro.ok === true && ro.warning === "keyset-older" &&
       (ro.missingKeys || []).indexOf("presendMs") >= 0,
      "PART G: an OWNER-authored file predating a settings key was refused rather than admitted " +
      "with a named warning (ok=" + ro.ok + ", warning=" + ro.warning + ") — an owner floor is " +
      "adopted on authority with no recompute, so the key addition that breaks a peer chain does " +
      "not reach it, and refusing it would strand exactly the file J28's override path is for");
    // Guarded rather than dereferenced blind: a guard whose own error handling wraps its subject
    // hides it, and one that THROWS here would report a stack trace where an assertion belongs.
    ok(ro.ok === true && ro.snapshots &&
       SD.derive([], ro.snapshots[0].seed).settings.presendMs === SD.defaultSettings().presendMs,
      "PART G: the key the file predates did not come back from the current defaults, so the " +
      "warning above admits a file the reducer cannot actually fold");

    // The control: a file written under the CURRENT key set must diagnose clean, or
    // "keyset-older" is what this reader says about everything.
    const cur = CF.saveFile({ mode: "full", snapshots: [cpA, cpB], keyset: CURRENT_KEYS,
      author: { rank: "player" } });
    const rc = CF.readFile(JSON.parse(JSON.stringify(cur)),
      { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(rc.ok === true && !rc.missingKeys,
      "PART G control: a file written under the current key set was also diagnosed as older, so " +
      "the diagnosis above is not attributable to the key set");

    // A file from a NEWER tree — keys we do not have — is refused outright rather than read
    // best-effort, the same rule as an unknown version.
    const newer = CF.saveFile({ mode: "full", snapshots: [cpA, cpB],
      keyset: CURRENT_KEYS.concat(["somethingLater"]).sort(), author: { rank: "player" } });
    const rn = CF.readFile(JSON.parse(JSON.stringify(newer)),
      { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
    ok(rn.ok === false && rn.reason === "keyset-newer",
      "PART G: a file naming a settings key this build does not have was not refused as " +
      "keyset-newer (got " + rn.reason + ")");
  }
}

// ── PART H — the keyset diagnosis OUTRANKS the chain refusal ────────────────────────────────
// The two failures arrive together and only one of them is actionable. `Floor.chainVerifies`
// returns false for an older-keyset file because the recomputed blob gains the new key from the
// defaults — measured as ROW 1 of mutate-j25-settings-coupling.js. If the reader reports that as
// chain-refused, the operator is told the file is corrupt when it is merely old, and those need
// opposite responses. Ordering is the assertion.
{
  const S = "H";
  const older = CURRENT_KEYS.filter((k) => k !== "presendMs");
  const oldFile = CF.saveFile({ mode: "full", snapshots: [cpA], keyset: older,
    author: { rank: "player" } });
  // ONE snapshot AND an older keyset: both the chain rule and the keyset rule refuse it.
  const r = CF.readFile(JSON.parse(JSON.stringify(oldFile)),
    { keys: CURRENT_KEYS, ownerAuthored: false, chainVerify: chainVerify });
  if (gate(S, r.ok === false, "the doubly-bad file was admitted, so there is no refusal to attribute")) {
    ok(r.reason === "keyset-older",
      "PART H: a file that is BOTH older-keyset and too short to chain reported " + r.reason +
      " — the specific, actionable diagnosis must win over the generic one, or the operator is " +
      "told to re-export a file that no re-export can fix");
  }
}

if (failures === 0) {
  console.log("[savefile] PASS — the save file is the checkpoint format in an envelope, and the " +
    "envelope earns its place: a room round-trips through real JSON and derives a " +
    "FINGERPRINT-IDENTICAL state (with a control proving that identity can fail); `ddjp` and " +
    "`mode` are the first two keys and sit OUTSIDE the payload commitment, driven both ways so " +
    "the commitment is neither leaky nor inert; an unknown version is refused by name rather " +
    "than read best-effort; one snapshot suffices only when the CALLER corroborates owner " +
    "authorship, while a peer file carrying one is refused chain-too-short and the same file " +
    "carrying a verifying pair is admitted — a file DECLARING `owner` buys nothing, because a " +
    "file has no channel origin and P6 reads rank from nowhere else; `tick` travels at " +
    "high-water, so a post-import joiner enters at the back rather than the head; the `hist?` " +
    "tail is carried, spanned by the fingerprint and proven reducer-INERT against the same seed " +
    "without it; and the recorded SETTINGS KEY SET makes the one failure the format version " +
    "cannot express — a file written before a key existed — say so by name (J45) and outrank " +
    "the chain refusal it arrives with, because 'predates key K' and 'corrupt' need opposite " +
    "responses (" + compared + " assertions)");
} else {
  console.log("[savefile] " + failures + " FAILURE(S)" +
    (gatesTripped ? " — " + gatesTripped + " of them are VOID stages, meaning the fixture never " +
      "reached the subject; fix those first, the rest are unreadable until you do" : ""));
  process.exit(1);
}
