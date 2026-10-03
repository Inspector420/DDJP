// tools/probes/probe-j26-export.js
//
// J26 — EXPORT. Every premise the entry rests on, measured before any of it is built.
//
// The entry says: "It shows the checkpoints this client holds, grouped by the rank that authored
// them, each labelled with its own timestamp." Four separate claims about a data structure
// (`Floor._seen`) that no production code has ever read, plus one Open the entry leaves to the
// session. Eight jobs running have had a premise TRUE ABOUT THE MECHANISM and WRONG ABOUT THE
// CONSEQUENCE (09-roadmap.md §5), so nothing here is read out of a header.
//
// THE ADMISSIBILITY GATE IS THE POINT, and it has its own self-test at the bottom. Most rows here
// ask "does X survive Y?", and an unreached fixture answers NO to all of them — absence reads as a
// finding (paths.md §9.6). So every row that asserts a survival or an absence is paired with a
// control that must show the opposite state first, and a row whose control fails prints VOID
// rather than a verdict.
//
// Rows:
//   R1  what a _seen entry actually carries after the production remember() path
//   R2  the "rank that authored them" field — power or tier, and does it separate authors?
//   R3  the timestamp — server stamp, and can it be absent?
//   R4  THE OPEN: does export need to fetch more first? peer×1 / peer×2 / owner×1 through readFile
//   R5  a client that has FORGOTTEN — does _seen survive a trim, or is the list empty?
//   R6  does anything clear _seen between leaving a room and the lobby render?
//
// Run: node tools/probes/probe-j26-export.js   (from the tree root)

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));
const fs = require("fs");

const BACKEND = "backends/backend1/";
function fresh() {
  return loadInContext([
    "core/logger.js",
    BACKEND + "ranks.js",
    BACKEND + "consensushash.js",
    BACKEND + "trustpolicy.js",
    BACKEND + "statederiver.js",
    BACKEND + "checkpointformat.js",
    BACKEND + "floor.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

let voids = 0;
function row(id, what, verdict, detail) {
  console.log("  " + id + " · " + what + "\n        → " + verdict +
    (detail !== undefined ? "\n        " + JSON.stringify(detail) : ""));
}
// THE GATE. A precondition stated as a SEPARATE check, run before the comparison, naming the
// stage that broke — because `null` at the end looks the same whichever stage produced it.
function gate(id, cond, why) {
  if (cond) return true;
  voids++;
  console.log("  " + id + " · GATE FAILED — " + why +
    "\n        → VOID (an unreached measurement returns the same value in every tree)");
  return false;
}

// ── a room with real checkpoints, built the way production builds them ────────────────────────
// Floor.remember() is the production entry: matrixbridge._onCheckpointArrived calls exactly this,
// with rank from the CHANNEL and ts from the EVENT. Nothing here hand-writes a _seen entry.
function sealAt(sb, seedState, n, prev, floorL, covers) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seedState,
               floorL: floorL, thin: false, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

function buildRoom(sb) {
  const room = F.playingRoom({ songs: 3 });
  const log = room.log.slice();
  const state = sb.StateDeriver.derive(F.sortLog(log));
  const seed = sb.StateDeriver.buildSeed(F.sortLog(log), null, log[log.length - 1].l);
  return { room, log, state, seed };
}

console.log("\nJ26 — EXPORT: the premises, driven\n" + "=".repeat(78));

// ── R1 · what a _seen entry carries ───────────────────────────────────────────────────────────
{
  const sb = fresh();
  const { log, seed } = buildRoom(sb);
  const cpA = sealAt(sb, seed, 1, null, 4, "$join..$play0");
  // The production call: (checkpoint, originRank, author, ts). Rank is the channel's power level.
  const ok = sb.Floor.remember(cpA, F.RANK.owner, "@owner:hs", 777000);
  if (gate("R1", ok === true, "Floor.remember refused the checkpoint — nothing to inspect")) {
    const seen = sb.Floor.heldCheckpoints();
    if (gate("R1", seen.length === 1, "remember() returned true but _seen is empty")) {
      row("R1", "the shape of a held entry, after the production remember() path",
        "FIELDS: " + Object.keys(seen[0]).sort().join(" · "), seen[0].ts);
    }
  }
}

// ── R2 · grouping by "the rank that authored them" ────────────────────────────────────────────
{
  const sb = fresh();
  const { seed } = buildRoom(sb);
  sb.Floor.remember(sealAt(sb, seed, 1, null, 4, "$a..$b"), F.RANK.owner, "@owner:hs", 700000);
  sb.Floor.remember(sealAt(sb, seed, 1, null, 4, "$c..$d"), F.RANK.staff, "@staff:hs", 700100);
  sb.Floor.remember(sealAt(sb, seed, 1, null, 4, "$e..$f"), F.RANK.vip, "@vip:hs", 700200);
  const seen = sb.Floor.heldCheckpoints();
  if (gate("R2", seen.length === 3, "expected three distinct authors held, got " + seen.length)) {
    const byR = seen.map((e) => ({ u: e.u, r: e.r,
      name: sb.Ranks.nameOf(e.r), tier: sb.TrustPolicy.tierOf(e.r) }));
    // The control: does the field DISCRIMINATE? Three authors at one rank must collapse to one
    // group, or "grouped by rank" is grouping by nothing.
    const sb2 = fresh();
    const seed2 = buildRoom(sb2).seed;
    sb2.Floor.remember(sealAt(sb2, seed2, 1, null, 4, "$g..$h"), F.RANK.staff, "@s1:hs", 1);
    sb2.Floor.remember(sealAt(sb2, seed2, 1, null, 4, "$i..$j"), F.RANK.staff, "@s2:hs", 2);
    const oneRank = new Set(sb2.Floor.heldCheckpoints().map((e) => e.r)).size;
    row("R2", "the author-rank field `r`, and whether it groups",
      "r is a POWER level (Ranks.nameOf resolves it); 3 ranks → " +
      new Set(seen.map((e) => e.r)).size + " groups, 2 authors at one rank → " + oneRank + " group",
      byR);
  }
}

// ── R3 · the timestamp ────────────────────────────────────────────────────────────────────────
{
  const sb = fresh();
  const { seed } = buildRoom(sb);
  // Control first: a checkpoint that ARRIVED carries the event's server stamp.
  sb.Floor.remember(sealAt(sb, seed, 1, null, 4, "$k..$l"), F.RANK.owner, "@owner:hs", 812345);
  const arrived = sb.Floor.heldCheckpoints()[0];
  if (gate("R3", typeof arrived.ts === "number",
      "the control failed: an arriving checkpoint did not carry a stamp, so an absent one measures nothing")) {
    // The other half: remember() is also reachable with no stamp at all. Floor's own header says
    // seal() adopts BEFORE the event exists anywhere, so there is no arrival time to read.
    sb.Floor.remember(sealAt(sb, seed, 2, null, 5, "$m..$n"), F.RANK.owner, "@owner:hs", undefined);
    const undated = sb.Floor.heldCheckpoints().find((e) => e.covers === "$m..$n");
    row("R3", "the stamp: server time from the event, and whether it can be absent",
      "arrived → " + arrived.ts + " (server stamp) · unstamped → " + JSON.stringify(undated.ts) +
      " — so a renderer MUST handle null rather than substituting a device clock (P2)",
      { arrived: arrived.ts, undated: undated.ts });
  }
}

// ── R4 · THE OPEN: fetch more first, or export what is present? ───────────────────────────────
// J25's entry claims this is already answered: "export must offer to fetch more when what is held
// is peer-authored and shorter than two." That is a claim about readFile's behaviour, so drive it.
{
  const sb = fresh();
  const { log, seed } = buildRoom(sb);
  const keys = Object.keys(sb.StateDeriver.defaultSettings());
  const cp1 = sealAt(sb, seed, 1, null, 4, "$join..$play0");
  const cp2 = sealAt(sb, seed, 2, cp1.h, 6, "$play0..$play1");
  const chainVerify = () => true;   // isolate the LENGTH rule from the chain's own verdict

  const peer1 = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cp1],
    keyset: keys, author: { rank: "staff" } });
  const peer2 = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cp1, cp2],
    keyset: keys, author: { rank: "staff" } });
  const owner1 = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cp1],
    keyset: keys, author: { rank: "owner" } });

  const rPeer1 = sb.CheckpointFormat.readFile(peer1, { keys, ownerAuthored: false, chainVerify });
  const rPeer2 = sb.CheckpointFormat.readFile(peer2, { keys, ownerAuthored: false, chainVerify });
  const rOwner1 = sb.CheckpointFormat.readFile(owner1, { keys, ownerAuthored: true, chainVerify });

  // THE CONTROL: a refusal is evidence only if something adjacent was ADMITTED. peer×2 and owner×1
  // are the adjacent admissions — same door, same fixture, one detail changed.
  if (gate("R4", rPeer2.ok === true && rOwner1.ok === true,
      "the controls did not pass (peer×2 " + rPeer2.reason + ", owner×1 " + rOwner1.reason +
      ") — a refusal with no adjacent admission attributes to nothing")) {
    row("R4", "THE OPEN — is one held checkpoint exportable?",
      "peer×1 → " + (rPeer1.ok ? "ok" : "REFUSED " + rPeer1.reason) +
      " · peer×2 → ok · owner×1 → ok. So the answer is PROVENANCE-DEPENDENT, not a blanket policy",
      { peer1: rPeer1.reason, peer2: rPeer2.ok, owner1: rOwner1.ok });
  }

  // And the half J25 did NOT drive: is the count the client holds even knowable before export?
  const sb2 = fresh();
  const seed2 = buildRoom(sb2).seed;
  sb2.Floor.remember(sealAt(sb2, seed2, 1, null, 4, "$o..$p"), F.RANK.staff, "@staff:hs", 900000);
  row("R4b", "can the UI tell, BEFORE exporting, that a peer file would be refused?",
    "held from that author = " + sb2.Floor.heldCheckpoints().filter((e) => e.u === "@staff:hs").length +
    " — countable from _seen with no paging, so the offer can be made without one");
}

// ── R5 · a client that has forgotten ──────────────────────────────────────────────────────────
// "Done when … a client that has forgotten shows what it has rather than an error."
{
  const sb = fresh();
  const { seed } = buildRoom(sb);
  sb.Floor.remember(sealAt(sb, seed, 1, null, 4, "$q..$r"), F.RANK.owner, "@owner:hs", 950000);
  const before = sb.Floor.heldCheckpoints().length;
  // Trimming is a StreamManager action bounded by the floor; what it does to Floor is nothing.
  // Drive the flag Floor itself reads for "have I already forgotten below my floor?".
  sb.Floor.attach({ trimmed: () => true, log: () => [], settings: () => ({}), myRank: () => 100 });
  const after = sb.Floor.heldCheckpoints().length;
  if (gate("R5", before > 0, "nothing was held before the trim, so survival measures nothing")) {
    row("R5", "does the held list survive a client that has forgotten?",
      before + " held before · " + after + " after — " +
      (after === before ? "SURVIVES: the list is checkpoints SEEN, not events held, so a trimmed "
        + "client still has something to show" : "EMPTIED"),
      { before, after });
  }
}

// ── R6 · does anything clear _seen on the way back to the lobby? ──────────────────────────────
// Read, then stated as a source fact rather than a behaviour claim: this is about which call
// sites exist, and a probe cannot execute the UI.
{
  const src = {
    interface: fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8"),
    room: fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8"),
    bridge: fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8"),
  };
  const bgLeave = (src.interface.match(/function _bgLeaveRoom\(\)[\s\S]*?\n  \}/) || [""])[0];
  const clearsInLeave = /resetCheckpoints|Floor\.reset/.test(bgLeave);
  const resetSites = (src.bridge.match(/Floor\.reset\(\)/g) || []).length;
  const resetCalledFrom = /resetCheckpoints\(\)/.test(src.room);
  row("R6", "is the held list still there when the lobby renders?",
    "_bgLeaveRoom clears checkpoints: " + clearsInLeave +
    " · Floor.reset() call sites in transport: " + resetSites +
    " · reached from room.js: " + resetCalledFrom +
    " — reset runs on room ENTRY (_initModules), not on leave, so the lobby holds the LAST room's " +
    "checkpoints", { clearsInLeave, resetSites, resetCalledFrom });
}

// ── R7 · what is a short peer client ACTUALLY missing? ────────────────────────────────────────
// The Open frames the remedy as "fetch more" — more CHECKPOINTS. chainVerifies folds the oldest
// forward THROUGH THE EVENTS BETWEEN the members, so the alternative hypothesis is that what is
// missing is the joining SEGMENT, not the snapshots. These need opposite remedies, so drive it.
{
  const sb = fresh();
  const room = F.playingRoom({ songs: 3 });
  const log = F.sortLog(room.log);
  const cut1 = log[2], cut2 = log[5];
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cpA = sealAt(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  const seedB = sb.StateDeriver.buildSeed(log.slice(3, 6), seedA);
  const cpB = sealAt(sb, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);

  const withLog = sb.Floor.chainVerifies([cpA, cpB], log);
  const withoutLog = sb.Floor.chainVerifies([cpA, cpB], []);      // the trimmed / fresh client
  // CONTROL: the same two snapshots must verify SOMEWHERE, or "fails without the log" measures
  // nothing but a badly built pair.
  if (gate("R7", withLog === true,
      "the control failed: two honest chained snapshots did not verify even WITH the log, so the "
      + "pair is malformed and the without-log reading is meaningless")) {
    row("R7", "two snapshots, with the joining events and without them",
      "with log → " + withLog + " · without log → " + withoutLog +
      " — so the scarce thing is the SEGMENT, not the snapshot count. Paging more checkpoints " +
      "cannot fix a chain whose joining events are gone", { withLog, withoutLog });
  }
}

// ── R8 · assembling the file: does the pick alone chain, or does it need its predecessors? ─────
{
  const sb = fresh();
  const room = F.playingRoom({ songs: 3 });
  const log = F.sortLog(room.log);
  const keys = Object.keys(sb.StateDeriver.defaultSettings());
  const cut1 = log[2], cut2 = log[5];
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cpA = sealAt(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  const seedB = sb.StateDeriver.buildSeed(log.slice(3, 6), seedA);
  const cpB = sealAt(sb, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);
  sb.Floor.remember(cpA, F.RANK.staff, "@staff:hs", 600000);
  sb.Floor.remember(cpB, F.RANK.staff, "@staff:hs", 600500);

  const chainVerify = (snaps) => sb.Floor.chainVerifies(snaps, log);
  const held = sb.Floor.heldCheckpoints();
  if (gate("R8", held.length === 2, "expected two held snapshots, got " + held.length)) {
    // (a) the pick ALONE — what "pick one; save it as a file" reads as literally
    const alone = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cpB],
      keyset: keys, author: { rank: "staff" } });
    // (b) the pick PLUS the held snapshots at or below its cut — the chain material we already have
    const withChain = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cpA, cpB],
      keyset: keys, author: { rank: "staff" } });
    const rAlone = sb.CheckpointFormat.readFile(alone, { keys, ownerAuthored: false, chainVerify });
    const rChain = sb.CheckpointFormat.readFile(withChain, { keys, ownerAuthored: false, chainVerify });
    row("R8", "peer pick alone vs pick + its held predecessors",
      "alone → " + (rAlone.ok ? "ok" : "REFUSED " + rAlone.reason) +
      " · with chain → " + (rChain.ok ? "ok" : "REFUSED " + rChain.reason) +
      " — so the file's subject is the PICK and the predecessors are what make it readable",
      { alone: rAlone.reason, chain: rChain.ok });
  }
}

// ── R9 · the owner path needs no log at all ───────────────────────────────────────────────────
// The asymmetry that decides the whole answer: an owner floor is adopted on authority with NO
// recompute, so a one-snapshot owner file is complete by construction and paging adds nothing.
{
  const sb = fresh();
  const { seed } = buildRoom(sb);
  const keys = Object.keys(sb.StateDeriver.defaultSettings());
  const cp = sealAt(sb, seed, 1, null, 4, "$s..$t");
  const file = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cp],
    keyset: keys, author: { rank: "owner" } });
  // No chainVerify supplied AT ALL — if the owner path touched it this would answer no-chain-verifier.
  const r = sb.CheckpointFormat.readFile(file, { keys, ownerAuthored: true });
  // THE CONTROL, ON ITS SECOND VERSION — recorded rather than quietly fixed, because the first one
  // is the exact failure 09-roadmap.md §8 names: A CONTROL THAT VARIES THE WRONG AXIS. It re-read
  // the OWNER-declaring file with ownerAuthored:false and got `author-not-corroborated` — a
  // refusal that never reaches the chain check, so it proved the author comparison works and said
  // nothing whatever about whether the owner branch skips the chain. The rule under test is the
  // CHAIN LENGTH, so the control has to hold authorship corroborated and vary only provenance:
  // a peer-declaring single snapshot, read as a peer, must fail AT THE CHAIN.
  const peerFile = sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [cp],
    keyset: keys, author: { rank: "staff" } });
  const asPeer = sb.CheckpointFormat.readFile(peerFile, { keys, ownerAuthored: false });
  if (gate("R9", asPeer.ok === false && asPeer.reason === "chain-too-short",
      "the control did not land on the chain rule (it answered " + asPeer.reason + "), so it "
      + "cannot attribute the owner file's admission to the owner branch")) {
    row("R9", "an owner-authored single snapshot, with no chain verifier supplied",
      "as owner → " + (r.ok ? "ok" : "REFUSED " + r.reason) +
      " · an equivalent PEER single snapshot → REFUSED " + asPeer.reason +
      " — the owner path never reaches the chain, so no amount of paging changes its answer",
      { asOwner: r.ok, peerControl: asPeer.reason });
  }
}

// ── THE GATE'S OWN SELF-TEST ──────────────────────────────────────────────────────────────────
// "And the gate is itself untested code: give it a self-test that feeds it a deliberately broken
// input and shows it catches it, or it certifies everything downstream on its own authority."
// (08-build-and-deploy.md §The level above "announce itself")
console.log("\n  ── gate self-test ──");
{
  const voidsBefore = voids;
  const caught = !gate("SELF", false, "a deliberately false precondition");
  const counted = voids === voidsBefore + 1;
  console.log("  SELF · the gate on a KNOWN-BAD input → " +
    (caught && counted ? "CAUGHT and counted as a void — the gate discriminates"
                       : "DID NOT CATCH — every verdict above is uncertified"));
  if (!(caught && counted)) process.exitCode = 2;
  voids = voidsBefore;   // the self-test's own void is not a real one
}

console.log("\n" + "=".repeat(78));
console.log(voids === 0 ? "All rows reached their subject." :
  voids + " row(s) VOID — do not read those as findings.");
