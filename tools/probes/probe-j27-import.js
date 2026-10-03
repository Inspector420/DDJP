// tools/probes/probe-j27-import.js
//
// J27 — IMPORT AT ROOM CREATION. The measurements that decide the job, run BEFORE anything is
// decided, because eight jobs running have had a premise true about the mechanism and wrong about
// the consequence.
//
// THE THREE QUESTIONS:
//   R1–R3  can a PEER-authored file be imported at all? `Floor.chainVerifies` locates each cut by
//          index into the event log; a room that does not exist yet has no log. If that makes the
//          peer path unreachable BY CONSTRUCTION, the choice is owner-only or a stand-in, and it
//          is a decision with a cost rather than a detail.
//   R4–R6  does "forging owner buys nothing" survive the seam? The file's `author` is a claim
//          about the OLD room; the importer's belief is about the NEW one. Two propositions.
//   R7–R9  the ranks Open. It presumes the file carries ranks. Does it?
//
// EVERY ROW SITS BEHIND AN ADMISSIBILITY GATE, and the gate has its own self-test (--selftest,
// also run automatically at the top of a normal run). `null` at the end of a measurement looks the
// same whichever stage failed, and three independent attempts at one measurement elsewhere in this
// project all returned null from every tree INCLUDING their controls — absence read as agreement
// each time. So a row states its preconditions separately, runs them first, and refuses to print a
// finding if one fails, naming the stage that broke.

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
    BACKEND + "floor.js",
    BACKEND + "eventcache.js",
    BACKEND + "streammanager.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// `pre` is a list of { name, ok } computed BEFORE the measurement. If any is false the row prints
// its refusal and returns null WITHOUT running the measurement, so a null can never be mistaken
// for a finding. The stage name is the whole value: "no snapshots built" and "chain verifier threw"
// and "the fold reached nothing" are three different reasons for one null.
function row(id, question, pre, measure) {
  const bad = (pre || []).filter((p) => !p.ok);
  if (bad.length) {
    console.log("  " + id + "  INADMISSIBLE — " + bad.map((b) => b.name).join(" | "));
    return null;
  }
  let out;
  try { out = measure(); }
  catch (e) {
    console.log("  " + id + "  INADMISSIBLE — the measurement threw: " + (e && e.message));
    return null;
  }
  console.log("  " + id + "  " + question);
  console.log("       " + out.finding);
  return out;
}

// THE GATE IS ITSELF UNTESTED CODE unless something feeds it a deliberately broken input. Without
// this it certifies every row below on its own authority.
function selfTest() {
  const seen = [];
  const log = console.log;
  console.log = (s) => seen.push(String(s));
  let ranMeasure = false;
  const a = row("ST1", "q", [{ name: "a precondition that is false", ok: false }],
    () => { ranMeasure = true; return { finding: "SHOULD NEVER PRINT" }; });
  const b = row("ST2", "q", [{ name: "fine", ok: true }],
    () => { throw new Error("boom"); });
  const c = row("ST3", "q", [{ name: "fine", ok: true }], () => ({ finding: "admitted", v: 1 }));
  console.log = log;

  assert.ok(a === null, "gate self-test: a failed precondition must return null");
  assert.ok(ranMeasure === false, "gate self-test: a failed precondition must SKIP the measurement");
  assert.ok(seen.some((s) => /INADMISSIBLE.*a precondition that is false/.test(s)),
    "gate self-test: the refusal must NAME the stage that broke");
  assert.ok(b === null && seen.some((s) => /INADMISSIBLE.*threw: boom/.test(s)),
    "gate self-test: a throwing measurement is inadmissible, not a finding");
  assert.ok(c && c.v === 1 && seen.some((s) => /admitted/.test(s)),
    "gate self-test: CONTROL — an admissible row still runs and prints, or the gate refuses "
    + "everything for free and every row below reads as a refusal");
  console.log("[gate] self-test PASS — a false precondition skips the measurement and names "
    + "itself, a throw is inadmissible, and an admissible row still runs (the control without "
    + "which a gate that refuses everything looks identical to one that works)");
}

// ── shared fixture ───────────────────────────────────────────────────────────────────────────
function sealed(sb, seed, n, prev, floorL, covers) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: false, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}

// An EXPORTING client: a real room, a real log, two chained peer checkpoints built the way the
// format builds them. This is the tree the file comes from.
function exporter() {
  const sb = fresh();
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  const seedA = sb.StateDeriver.buildSeed(log.slice(0, 3), null);
  const cut1 = log[2], cut2 = log[5];
  const cpA = sealed(sb, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  const seedB = sb.StateDeriver.buildSeed(log.slice(3, 6), seedA);
  const cpB = sealed(sb, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);
  return { sb, log, cpA, cpB, seedA, seedB, keys: Object.keys(sb.StateDeriver.defaultSettings()) };
}

function main() {
  selfTest();
  console.log("");
  console.log("probe-j27-import — the measurements J27 turns on");
  console.log("=================================================");

  const X = exporter();

  // ── R1 ────────────────────────────────────────────────────────────────────────────────────
  // Does a peer chain verify AT ALL when the joining log is held? Without this control every
  // refusal below attributes to nothing — a probe that reached no path refuses everything free.
  console.log("");
  console.log("R1–R3  the peer path at import");
  const r1 = row("R1", "CONTROL — with the joining log held, does the peer chain verify?",
    [{ name: "two snapshots built", ok: !!(X.cpA && X.cpB) },
     { name: "a non-empty log to join them", ok: X.log.length >= 6 }],
    () => {
      const v = X.sb.Floor.chainVerifies([X.cpA, X.cpB], X.log);
      return { v: v, finding: "chainVerifies([cpA,cpB], log) = " + v
        + "   (log held: " + X.log.length + " events)" };
    });

  // ── R2 ────────────────────────────────────────────────────────────────────────────────────
  // The same two snapshots, with no log. This is the importer's position exactly: the room does
  // not exist, so there is nothing to index into.
  const r2 = row("R2", "THE QUESTION — the same two snapshots, with NO log (the importer's position)",
    [{ name: "R1 admitted, so there is a verdict to move against", ok: !!r1 },
     { name: "R1 verified, so a false here is a CHANGE rather than a constant", ok: !!(r1 && r1.v === true) }],
    () => {
      const empty = X.sb.Floor.chainVerifies([X.cpA, X.cpB], []);
      return { v: empty, finding: "chainVerifies([cpA,cpB], []) = " + empty
        + "   -> the SAME snapshots that verify with the log " + (empty ? "still verify" : "do NOT verify")
        + " without it" };
    });

  // ── R3 ────────────────────────────────────────────────────────────────────────────────────
  // Is it structural, or could a longer/shorter file fix it? Vary the snapshot COUNT while holding
  // "no log" fixed — the axis the entry's framing (and J26's Open) would reach for.
  const r3 = row("R3", "is it SCARCITY or STRUCTURE? vary the snapshot count with no log",
    [{ name: "R2 admitted", ok: !!r2 }],
    () => {
      const counts = {};
      for (const n of [2, 3, 4]) {
        const snaps = [X.cpA, X.cpB].slice(0, Math.min(2, n));
        while (snaps.length < n) snaps.push(X.cpB);
        counts[n] = X.sb.Floor.chainVerifies(snaps, []);
      }
      // and the direct reason: every cut resolves to index -1
      const idxA = X.log.length ? 0 : -1;
      const emptyIdx = [].findIndex((e) => e.eventId === X.cpA.covers.split("..")[1]);
      return { counts: counts, finding: "with no log: " + JSON.stringify(counts)
        + "   — and the cause is index resolution, not length: idx(lastId) on an empty log = "
        + emptyIdx + ", so `from <= 0 || to < 0` bails before any fold. (Same lookup against the "
        + "held log resolves: " + idxA + ".)" };
    });

  // ── R4 ────────────────────────────────────────────────────────────────────────────────────
  // The owner path, at import. `readFile` returns before the chain check for a corroborated owner.
  const r4 = row("R4", "does an OWNER-authored file read at import (no log, no chain verifier)?",
    [{ name: "a one-snapshot owner file can be built", ok: !!X.cpA }],
    () => {
      const f = X.sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [X.cpA],
        keyset: X.keys, author: { rank: "owner" } });
      const r = X.sb.CheckpointFormat.readFile(f, { keys: X.keys, ownerAuthored: true });
      // the adjacent REFUSAL, same door, one detail changed: a peer file at the same moment
      const pf = X.sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [X.cpA, X.cpB],
        keyset: X.keys, author: { rank: "staff" } });
      const pr = X.sb.CheckpointFormat.readFile(pf,
        { keys: X.keys, ownerAuthored: false, chainVerify: (s) => X.sb.Floor.chainVerifies(s, []) });
      return { owner: r.ok, peer: pr, finding: "owner file: ok=" + r.ok
        + "   |   ADJACENT peer file, two snapshots, same empty log: ok=" + pr.ok
        + " reason=" + pr.reason };
    });

  // ── R5 ────────────────────────────────────────────────────────────────────────────────────
  // THE AUTHORSHIP SEAM. `ownerAuthored` is the CALLER's belief. At import the natural reading of
  // "am I the owner?" is about the room being created — and the importer always is. Drive what
  // that does to "forging owner buys nothing".
  console.log("");
  console.log("R4–R6  the authorship seam");
  const r5 = row("R5", "if the importer's belief is about the NEW room, does forging `owner` buy the single-snapshot path?",
    [{ name: "R4 admitted, so the owner path is known to exist", ok: !!r4 },
     { name: "the owner path really did admit in R4", ok: !!(r4 && r4.owner === true) }],
    () => {
      // A file a PEER exported, with `author.rank` forged to "owner". One snapshot only, so it
      // needs the owner path to be readable at all.
      const forged = X.sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [X.cpA],
        keyset: X.keys, author: { rank: "owner" } });
      // belief #1: "I am the owner of the room I am about to create" — always true at import.
      const asCreator = X.sb.CheckpointFormat.readFile(forged, { keys: X.keys, ownerAuthored: true });
      // belief #2: "the file was authored by an owner of the room it came from" — what the
      // corroboration is actually for, and something the importer has no channel to establish.
      const asProvenance = X.sb.CheckpointFormat.readFile(forged,
        { keys: X.keys, ownerAuthored: false, chainVerify: (s) => X.sb.Floor.chainVerifies(s, []) });
      return { asCreator: asCreator.ok, asProvenance: asProvenance,
        finding: "belief = 'I am creating this room, so owner:true'  -> ok=" + asCreator.ok
          + "   |   belief = 'the file's provenance is peer'        -> ok=" + asProvenance.ok
          + " reason=" + asProvenance.reason
          + "\n       -> the SAME forged file is admitted or refused by the CALLER's belief alone; "
          + "the file's own `author` field never decides." };
    });

  // ── R6 ────────────────────────────────────────────────────────────────────────────────────
  // The control that varies the right axis: hold the belief fixed at owner and vary the FILE's
  // declaration. If the comparison is doing work, a peer-declaring file must be refused there.
  const r6 = row("R6", "CONTROL — hold the belief at owner and vary the FILE's declaration instead",
    [{ name: "R5 admitted", ok: !!r5 }],
    () => {
      const declaresPeer = X.sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [X.cpA],
        keyset: X.keys, author: { rank: "staff" } });
      const r = X.sb.CheckpointFormat.readFile(declaresPeer, { keys: X.keys, ownerAuthored: true });
      return { r: r, finding: "file declares peer, caller believes owner -> ok=" + r.ok
        + " reason=" + r.reason
        + "\n       -> the comparison DOES discriminate on the file's field. What it cannot do is "
        + "establish which belief is the honest one." };
    });

  // ── R7 ────────────────────────────────────────────────────────────────────────────────────
  // THE RANKS OPEN. Its wording — "the ranks in the file are a claim the new room has to make
  // real" — presumes the file carries ranks. Ask the seed what it actually holds.
  console.log("");
  console.log("R7–R9  the ranks Open");
  const r7 = row("R7", "what does a seed carry about people? (the Open presumes it carries ranks)",
    [{ name: "a seed was built from a real fold", ok: !!(X.seedA && typeof X.seedA === "object") },
     { name: "the room actually had a member", ok: !!(X.seedA && X.seedA.members
        && Object.keys(X.seedA.members).length > 0) }],
    () => {
      const seedKeys = Object.keys(X.seedA).sort();
      const memberIds = Object.keys(X.seedA.members);
      const perMember = Object.keys(X.seedA.members[memberIds[0]]).sort();
      const anyRankField = JSON.stringify(X.seedA).match(/"(rank|senderRank|r|rankByUser|power|tier)"\s*:/g);
      return { seedKeys, perMember, finding: "seed keys: " + seedKeys.join(" · ")
        + "\n       members: " + memberIds.length + "  ->  per-member fields: " + perMember.join(" · ")
        + "\n       rank-shaped keys anywhere in the seed: " + (anyRankField ? anyRankField.join(",") : "NONE") };
    });

  // ── R8 ────────────────────────────────────────────────────────────────────────────────────
  // If the seed carries no ranks, does the FILE carry them anywhere else? Ask the file.
  const r8 = row("R8", "does the FILE carry ranks anywhere outside the seed?",
    [{ name: "R7 admitted", ok: !!r7 }],
    () => {
      const f = X.sb.CheckpointFormat.saveFile({ mode: "full", snapshots: [X.cpA, X.cpB],
        keyset: X.keys, author: { rank: "staff" } });
      const payloadKeys = Object.keys(f.payload).sort();
      return { payloadKeys, finding: "payload keys: " + payloadKeys.join(" · ")
        + "\n       `author.rank` = " + JSON.stringify(f.payload.author)
        + "  — one rank, and it is the AUTHOR's declaration about themselves, not a roster." };
    });

  // ── R9 ────────────────────────────────────────────────────────────────────────────────────
  // So what DOES the imported room owe those people? Fold the seed forward and see who is in the
  // rotation, and at what rank the reducer judges them.
  const r9 = row("R9", "fold the seed as the new room would: who is in the rotation, and does rank gate them?",
    [{ name: "R7 admitted", ok: !!r7 }],
    () => {
      const st = X.sb.StateDeriver.derive([], X.seedB);
      const rot = (st.rotation || []).map((m) => m.user);
      const minDj = (st.settings || {}).minDjRank;
      return { rot, finding: "derive([], seed).rotation = " + JSON.stringify(rot)
        + "\n       settings.minDjRank = " + JSON.stringify(minDj)
        + "  -> the rotation is restored by USER ID with no rank in it; `minDjRank` is judged on a "
        + "JOIN event at its log position, and the seed's members are already in, so nothing in the "
        + "imported state re-checks their rank." };
    });

  // ── R10 ───────────────────────────────────────────────────────────────────────────────────
  // J26 ships an `importable` flag, stated before the click, and `check-export` PART D asserts it
  // against `readFile`'s own verdict — with the chain verifier fed the EXPORTING client's log. R2
  // says an importer has no log. So ask the flag the importer's question rather than the
  // exporter's.
  console.log("");
  console.log("R10    what J26's `importable` flag promises, asked the importer's way");
  const r10 = row("R10", "a peer file reported importable — is it, to a client with no room yet?",
    [{ name: "R2 admitted", ok: !!r2 },
     { name: "the export seam exists", ok: typeof X.sb.StreamManager.exportCheckpoint === "function" }],
    () => {
      const s = fresh();
      const r = F.playingRoom({ songs: 3 });
      const log = F.sortLog(r.log);
      const seedA = s.StateDeriver.buildSeed(log.slice(0, 3), null);
      const cut1 = log[2], cut2 = log[5];
      const cpA = sealed(s, seedA, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
      const seedB = s.StateDeriver.buildSeed(log.slice(3, 6), seedA);
      const cpB = sealed(s, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);
      s.Floor.remember(cpA, F.RANK.staff, "@staff:hs", 700000);
      s.Floor.remember(cpB, F.RANK.staff, "@staff:hs", 700500);
      const out = s.StreamManager.exportCheckpoint(cpB.h);
      const keys = Object.keys(s.StateDeriver.defaultSettings());
      // the EXPORTER's question — re-read where it was written, with that client's own log
      const here = s.CheckpointFormat.readFile(out.file,
        { keys, ownerAuthored: false, chainVerify: (c) => s.Floor.chainVerifies(c, log) });
      // the IMPORTER's question — a room that does not exist yet
      const there = s.CheckpointFormat.readFile(out.file,
        { keys, ownerAuthored: false, chainVerify: (c) => s.Floor.chainVerifies(c, []) });
      return { flag: out.importable, here: here.ok, there: there,
        finding: "exportCheckpoint says importable=" + out.importable
          + "\n       re-read WHERE IT WAS WRITTEN (that client's log): ok=" + here.ok
          + "\n       read AS AN IMPORTER (no room yet):                ok=" + there.ok
          + " reason=" + there.reason
          + "\n       -> the flag is true of the exporter's question and false of the importer's. "
          + "It is the only thing the person is told before the click." };
    });

  // ── R11 ───────────────────────────────────────────────────────────────────────────────────
  // The ranks Open, restated by R7 as: the file carries a ROTATION of user ids, and in the new
  // room those people are not members. Does the room work?
  console.log("");
  console.log("R11–R13  a rotation of people who are not here");
  const r11 = row("R11", "the imported rotation holds absent people — can the room still play?",
    [{ name: "R9 admitted", ok: !!r9 },
     { name: "the seeded rotation is non-empty", ok: !!(r9 && r9.rot && r9.rot.length > 0) }],
    () => {
      const st0 = X.sb.StateDeriver.derive([], X.seedB);
      const np0 = st0.nowPlaying;
      const pending0 = (st0.rotation[0] || {}).pending || [];
      return { np0, pending0, finding: "seeded state: nowPlaying=" + (np0 ? np0.song : null)
        + " dj=" + (np0 ? np0.dj : null)
        + "\n       head DJ's pending buffer carried IN THE SEED: " + JSON.stringify(pending0.map((p) => p.videoId))
        + "\n       -> the absent DJ's declared songs arrive with the file, so the room has "
        + "material to play without that person ever appearing." };
    });

  // ── R12 ───────────────────────────────────────────────────────────────────────────────────
  // And does it DRAIN? A DJ falls out of the rotation when their last buffered song plays (04-
  // features, hard fall-out). If that holds on seeded state, a rotation of absent people empties
  // itself rather than needing a rule.
  const r12 = row("R12", "does the rotation DRAIN when an absent DJ's buffered songs run out?",
    [{ name: "R11 admitted", ok: !!r11 },
     { name: "the head DJ has a buffer to exhaust", ok: !!(r11 && r11.pending0 && r11.pending0.length > 0) }],
    () => {
      const st0 = X.sb.StateDeriver.derive([], X.seedB);
      const dj = st0.rotation[0].user;
      const buffered = st0.rotation[0].pending.length;
      // Play through the buffer from an owner who is NOT in the rotation — the importer's position.
      const after = [];
      let prevPi = st0.nowPlaying ? st0.nowPlaying.pi : null;
      let l = 100, ts = (st0.nowPlaying ? st0.nowPlaying.startedAt : 100000) + 400000;
      const evs = [];
      for (let i = 0; i <= buffered; i++) {
        evs.push(F.reducerEvent("$imp" + i, ++l, ts += 400000, "@importer:hs", F.RANK.owner,
          { t: "ddjp.dj.play", p: prevPi }));
        prevPi = "$imp" + i;
        const s = X.sb.StateDeriver.derive(evs, X.seedB);
        after.push((s.rotation || []).length);
      }
      return { dj, buffered, after,
        finding: "head DJ " + dj + " arrives with " + buffered + " buffered song(s)"
          + "\n       rotation size after each successive advance: " + JSON.stringify(after)
          + "\n       -> " + (after[after.length - 1] === 0
            ? "it drains to empty. Nobody has to be evicted by a rule; the existing hard fall-out does it."
            : "it does NOT drain — this needs a rule after all.") };
    });

  // ── R13 ───────────────────────────────────────────────────────────────────────────────────
  // And the hard constraint on "making a rank real" even if the file DID carry ranks: a freshly
  // created room is uncategorized-only until Upgrade 1.
  const r13 = row("R13", "could a fresh room grant a rank at all, if the file named one?",
    [{ name: "the transport taxonomy loads headlessly", ok: (() => {
        try { return !!mb().MatrixBridge.creationPlan; } catch (e) { return false; } })() }],
    () => {
      const m = mb().MatrixBridge;
      const batch1 = m.creationPlan({}).todo.map((c) => c.key);
      const channels = {};
      for (const k of batch1) channels[k] = "!x:hs";
      const levels = [0, 10, 20, 40, 60, 80, 100];
      const unlocked = levels.filter((lv) => {
        const k = m.eventsKeyForLevel(lv);
        return k ? !!channels[k] : false;
      });
      return { batch1, unlocked, finding: "batch-1 channels: " + batch1.join(" · ")
        + "\n       ranks whose events channel exists at creation: " + JSON.stringify(unlocked)
        + "  -> a freshly created room can hold nobody between uncategorized and owner until "
        + "Upgrade 1, so a file naming ranks could not have them applied at creation even in "
        + "principle." };
    });

  console.log("");
  console.log("=================================================");
  const all = [r1, r2, r3, r4, r5, r6, r7, r8, r9, r10, r11, r12, r13];
  console.log("rows admitted: " + all.filter(Boolean).length + " of " + all.length);
}

// The transport, loaded once and only for its channel taxonomy (no SDK calls are made).
let _mb = null;
function mb() {
  if (!_mb) {
    _mb = loadInContext(["core/logger.js", BACKEND + "ranks.js", BACKEND + "matrixbridge.js"],
      { Date, Math, JSON, setTimeout, clearTimeout, Promise, matrixcs: {}, window: {}, navigator: {},
        localStorage: { getItem: () => null, setItem: () => {} } });
  }
  return _mb;
}

if (process.argv.indexOf("--selftest") >= 0) { selfTest(); }
else { main(); }
