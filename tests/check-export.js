// tests/check-export.js
//
// J26 — EXPORT. The checkpoints this client holds, offered from the lobby, grouped by the rank
// that authored them, each labelled with its own SERVER stamp; pick one, save it as a file.
//
// WHAT THIS GUARD IS REALLY FOR. J25 built the serialiser and it had no production caller and
// could not have one — `CheckpointFormat` is a walled backend internal, so `ui/` and `features/`
// cannot reach `saveFile` at all. That is the "correct module reached by nothing" shape (P1), and
// a guard that called `CheckpointFormat.saveFile` directly would pass on a build where the seam
// does not exist. So the backend half here is driven THROUGH `StreamManager` — the interface the
// app actually has — and never through the format module.
//
// The app half cannot be executed: `features/room.js` needs a live MatrixBridge and `ui/` needs a
// DOM, so PARTS E and F are static over the source, the same approach `check-settings-passthrough`
// and `check-write-channel` take. That is stated rather than left implicit, because a regex
// proving a name is SPELLED proves nothing about whether it RUNS.
//
//   A  the held list is a real accessor, and a fresh copy per call
//   B  rank leaves the backend as a NAME, and the field discriminates
//   C  the stamp is the server's, passed through unchanged, and null when there is none
//   D  export builds a file `readFile` accepts, and `importable` tells the truth about it
//   E  the feature layer delegates and adds the one fact the backend cannot know: which room
//   F  the UI is actually WIRED to render it, clears its own container, and does no clock maths

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load.js");
const F = require("./_fixtures.js");

let checks = 0;
function ok(c, m) { assert.ok(c, m); checks++; }

const ROOT = path.join(__dirname, "..");
// STRIP BLOCK COMMENTS AS WELL AS LINE COMMENTS, and the reason is a defect this guard had on its
// first run. PART F asserts that the lobby CALLS the export renderer — the wiring, which is the
// whole point of the part (P1). Mutation M6 commented the call out with `/* ... */` and the guard
// stayed GREEN, because a whole-line `//` strip leaves the name spelled inside the block and the
// regex found it there. That is exactly the variety §8 names: THE ANCHOR MATCHED A MENTION IN A
// COMMENT RATHER THAN THE CALL — the textual-guard failure wearing a mutation's clothes. The
// mutation was right and the assertion was decorative, so the assertion is what changed.
//
// Block comments are removed before line comments so a `//` inside a block cannot truncate it.
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
    BACKEND + "floor.js",
    BACKEND + "eventcache.js",
    BACKEND + "streammanager.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, Promise });
}

// Build a checkpoint the way the format does, then hand it to Floor the way the TRANSPORT does —
// `Floor.remember(cp, originRank, author, ts)` is exactly what `_onCheckpointArrived` calls, with
// rank from the channel and ts from the event. Nothing here hand-writes a `_seen` entry, because a
// fixture that reaches the store by a side door is not exercising the door under test.
function sealed(sb, seed, n, prev, floorL, covers) {
  const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null, seed: seed,
               floorL: floorL, thin: false, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
  return cp;
}
function room3(sb) {
  const r = F.playingRoom({ songs: 3 });
  const log = F.sortLog(r.log);
  return { log: log, seed: sb.StateDeriver.buildSeed(log.slice(0, 3), null) };
}

// ── PART A — a real accessor, and a fresh copy per call ──────────────────────────────────────
// The entry named the problem precisely: the held list was reachable only through `_seenForTest()`,
// and reaching a test seam from production is the shape this tree keeps deleting. The accessor is
// the fix; the copy rule is what stops the fix becoming a new hazard, because these entries carry
// the fields ADOPTION reads — `r` decides which tier a candidate binds, `ts` anchors the seal
// cadence, `floorL` places the cut.
{
  const sb = fresh();
  const { seed } = room3(sb);
  ok(typeof sb.Floor.heldCheckpoints === "function",
    "A: Floor exposes heldCheckpoints() — a real accessor with a real name");
  ok(typeof sb.Floor._seenForTest === "undefined",
    "A: the `_seenForTest` seam is GONE rather than kept alongside it — two doors onto one piece "
    + "of state is the drift P7 is about, and the ForTest name tells the next reader that nothing "
    + "depends on it");

  sb.Floor.remember(sealed(sb, seed, 1, null, 3, "$a..$b"), F.RANK.owner, "@owner:hs", 700000);
  const first = sb.Floor.heldCheckpoints();
  // THE CONTROL. "Mutating the copy does not reach Floor" is vacuously true of an empty list, and
  // an unreached fixture returns an empty list — so assert there is something to mutate first.
  ok(first.length === 1, "A: CONTROL — the production remember() path put one entry in the list, "
    + "so the copy rule below has something to be true about");

  first[0].ts = 999999999;
  first[0].r = 0;
  first.push({ h: "$injected" });
  const second = sb.Floor.heldCheckpoints();
  ok(second.length === 1 && second[0].ts === 700000 && second[0].r === F.RANK.owner,
    "A: the returned list AND its entries are copies — a renderer that sorted in place would be "
    + "reordering the search space, and one that stamped a display time onto `ts` would feed a "
    + "device clock into the seal cadence (P2)");
}

// ── PART B — rank leaves as a NAME, and the field discriminates ──────────────────────────────
// `_seen` carries `r`, a Matrix power level. Outside the backend a rank is a name
// (check-boundaries rule H), so the resolution has to happen below the seam. Handing the level out
// would make the picker's "group by the rank that authored them" a numeric comparison in the UI.
{
  const sb = fresh();
  const { seed } = room3(sb);
  sb.Floor.remember(sealed(sb, seed, 1, null, 3, "$a..$b"), F.RANK.owner, "@owner:hs", 700000);
  sb.Floor.remember(sealed(sb, seed, 1, null, 3, "$c..$d"), F.RANK.staff, "@staff:hs", 700100);
  sb.Floor.remember(sealed(sb, seed, 1, null, 3, "$e..$f"), F.RANK.staff, "@other:hs", 700200);

  const held = sb.StreamManager.heldCheckpoints();
  ok(held.length === 3, "B: CONTROL — three held entries reached the interface (got " + held.length + ")");
  ok(held.every((e) => typeof e.rank === "string" && e.rank.length > 0),
    "B: every entry carries a rank NAME");
  ok(held.every((e) => !("r" in e) && !("u" in e)),
    "B: the power LEVEL does not leave the backend, and neither does the author's Matrix ID — the "
    + "build law's `never show a raw Matrix ID` has one exception and it is the viewer's own");

  // THE FIELD MUST DISCRIMINATE. A name that answered the same string for every author would group
  // everything into one pile and the assertion above would still pass.
  const names = new Set(held.map((e) => e.rank));
  ok(names.size === 2,
    "B: the rank name SEPARATES authors of different rank and JOINS authors of the same rank — "
    + "two distinct names across an owner and two staff (got " + [...names].join("/") + ")");
}

// ── PART C — the stamp is the server's ───────────────────────────────────────────────────────
// The job says "labelled with its own server timestamp", and P2 has its own entry in the pitfall
// list for this surface. Two halves: an arriving checkpoint's stamp is passed through UNCHANGED,
// and a checkpoint that has no arrival time says so rather than acquiring one.
{
  const sb = fresh();
  const { seed } = room3(sb);
  const SERVER_TS = 1755400000000;   // a specific value, so a substituted clock cannot coincide
  sb.Floor.remember(sealed(sb, seed, 1, null, 3, "$a..$b"), F.RANK.owner, "@owner:hs", SERVER_TS);
  sb.Floor.remember(sealed(sb, seed, 2, null, 5, "$c..$d"), F.RANK.owner, "@owner:hs", undefined);

  const held = sb.StreamManager.heldCheckpoints();
  const dated = held.find((e) => e.covers === "$a..$b");
  const undated = held.find((e) => e.covers === "$c..$d");
  ok(dated && undated, "C: CONTROL — both the dated and the undated checkpoint reached the interface");
  ok(dated.at === SERVER_TS,
    "C: the server stamp is passed through UNCHANGED, byte for byte — not re-derived, not rounded, "
    + "not replaced by an arrival time this layer could have taken from Date.now()");
  ok(undated.at === null,
    "C: a checkpoint with no arrival time reports null. `seal()` adopts its own checkpoint BEFORE "
    + "the event exists anywhere, so this state is reachable in an ordinary room — and filling it "
    + "in from the local clock is precisely the mix P2 forbids");
}

// ── PART D — the file, and whether `importable` tells the truth ──────────────────────────────
// THE OPEN THE ENTRY LEFT OPEN: does export offer to fetch more first, or export what is present?
// Driven in tools/probes/probe-j26-export.js and settled as EXPORT WHAT IS PRESENT. The reasoning
// is pinned here because it is a property of the code, not a preference:
//   · an OWNER file is admitted at one snapshot and never reaches the chain check (R9), so paging
//     cannot change its answer;
//   · a PEER file below two is refused, and what a short client lacks is the joining SEGMENT
//     rather than more snapshots (R7) — so paging checkpoints does not buy what the chain needs;
//   · the answer is computable from what is already held (R4b), so stating it costs nothing.
// `importable` is that statement. If it ever disagrees with `readFile`, the control is lying to the
// person about what they just saved, which is the false-narrative failure §10 names.
{
  const sb = fresh();
  const { log, seed } = room3(sb);
  const keys = Object.keys(sb.StateDeriver.defaultSettings());
  const cut1 = log[2], cut2 = log[5];
  const cpA = sealed(sb, seed, 1, null, cut1.l, log[0].eventId + ".." + cut1.eventId);
  const seedB = sb.StateDeriver.buildSeed(log.slice(3, 6), seed);
  const cpB = sealed(sb, seedB, 2, cpA.h, cut2.l, log[3].eventId + ".." + cut2.eventId);
  const chainVerify = (snaps) => sb.Floor.chainVerifies(snaps, log);

  // (i) OWNER, one snapshot — sufficient by construction.
  {
    const s = fresh();
    const r = room3(s);
    const cp = sealed(s, r.seed, 1, null, 3, "$a..$b");
    s.Floor.remember(cp, F.RANK.owner, "@owner:hs", 700000);
    const out = s.StreamManager.exportCheckpoint(cp.h);
    ok(out.ok === true, "D: an owner-authored pick exports");
    ok(out.importable === true && out.snapshots === 1,
      "D: one owner snapshot is reported importable");
    const back = s.CheckpointFormat.readFile(out.file, { keys: Object.keys(s.StateDeriver.defaultSettings()), ownerAuthored: true });
    ok(back.ok === true,
      "D: and readFile AGREES — the flag the control shows is the same verdict the reader reaches "
      + "(got " + back.reason + ")");
  }

  // (ii) PEER, one snapshot — refused, and the flag says so BEFORE the click.
  {
    const s = fresh();
    const r = room3(s);
    const cp = sealed(s, r.seed, 1, null, 3, "$a..$b");
    s.Floor.remember(cp, F.RANK.staff, "@staff:hs", 700000);
    const out = s.StreamManager.exportCheckpoint(cp.h);
    ok(out.ok === true && out.importable === false,
      "D: a lone PEER snapshot still EXPORTS — the entry's Done-when is that a client shows what "
      + "it has rather than an error — but is reported un-importable");
    const back = s.CheckpointFormat.readFile(out.file,
      { keys: Object.keys(s.StateDeriver.defaultSettings()), ownerAuthored: false, chainVerify: () => true });
    ok(back.ok === false && back.reason === "chain-too-short",
      "D: and readFile refuses it for exactly that reason (got " + back.reason + ")");
  }

  // (iii) PEER, two chained snapshots. THE FLAG CHANGED AT J27 AND THE MEASUREMENT IS WHY.
  // This part used to assert `importable === true` here, because a two-snapshot peer file is
  // exactly what `readFile` accepts — asked with the EXPORTING client's log, which is the log this
  // guard had to hand. J27 asked the importer's question instead: `Floor.chainVerifies` folds the
  // log BETWEEN the cuts, and a room being created holds none of it, so the same file is refused
  // however long its chain (probe-j27-import.js R2, R3, R10). `importable` promises the person
  // something before the click, so the promise now answers the importer's question.
  //
  // THE CONTROL IS THE PAIR, and it varies the axis the flag is ABOUT — the verifier's holdings —
  // rather than the snapshot count, which R3 showed does not move the answer. Both readings are
  // asserted, so a flag that flipped for the wrong reason cannot pass here.
  {
    sb.Floor.remember(cpA, F.RANK.staff, "@staff:hs", 700000);
    sb.Floor.remember(cpB, F.RANK.staff, "@staff:hs", 700500);
    const out = sb.StreamManager.exportCheckpoint(cpB.h);
    ok(out.ok === true && out.snapshots === 2,
      "D: the peer pick still EXPORTS with its held predecessor as chain material (snapshots="
      + out.snapshots + ") — J26's Done-when is that a client shows what it has");
    ok(out.importable === false,
      "D: and is reported UN-importable, because the question the flag answers is the importer's");
    const here = sb.CheckpointFormat.readFile(out.file, { keys, ownerAuthored: false, chainVerify });
    ok(here.ok === true,
      "D: CONTROL — the very same file IS accepted when the verifier holds the joining log (got "
      + here.reason + "), so the refusal below is attributable to the missing SEGMENT rather than "
      + "to a fixture that reached nothing or a file that was malformed all along");
    const there = sb.CheckpointFormat.readFile(out.file,
      { keys, ownerAuthored: false, chainVerify: (c) => sb.Floor.chainVerifies(c, []) });
    ok(there.ok === false && there.reason === "chain-refused",
      "D: and refused when it does not (got " + there.reason + ") — which is the importer's "
      + "position exactly, and what `importable` now reports");
  }

  // (iv) the envelope is outside the commitment, and the picked checkpoint is really in the file.
  {
    const out = sb.StreamManager.exportCheckpoint(cpB.h);
    ok(out.file.ddjp === 1 && out.file.mode === "full",
      "D: the envelope's first two keys are readable without hashing anything");
    ok(out.file.payload.snapshots.some((c) => c.h === cpB.h),
      "D: the file actually carries the checkpoint that was picked");
    ok(!("hist" in out.file.payload),
      "D: the optional history tail is OMITTED, never nulled — J25 settled that the format CAN "
      + "carry one; whether export fills it is a separate question this job's Done-when does not "
      + "ask, and filling it would mean a new StreamManager->History arrow for display data");
  }

  // (v) a pick nobody holds is refused rather than invented.
  ok(sb.StreamManager.exportCheckpoint("$nothing-like-this").reason === "not-held",
    "D: exporting a checkpoint this client does not hold is refused by name");
}

// ── PART E — the feature layer delegates, and adds the room ──────────────────────────────────
// Static: `features/room.js` cannot be loaded headlessly. What matters is that it DELEGATES rather
// than re-implementing, and that it supplies the one fact the backend genuinely cannot know.
{
  const room = code("features/room.js");
  ok(/function heldCheckpoints\(\)/.test(room) && /StreamManager\.heldCheckpoints/.test(room),
    "E: the feature layer reaches the held list through the INTERFACE");
  ok(/function exportCheckpoint\(/.test(room) && /StreamManager\.exportCheckpoint/.test(room),
    "E: and the export the same way");
  ok(!/CheckpointFormat|\bFloor\./.test(room),
    "E: and names no backend internal — check-boundaries rule F is the wall, this is the reason "
    + "J26's first task was a passthrough and not the UI its Touches field names first");
  // THE ROOM IDENTITY IS THE POINT, NOT A LABEL. `Floor.reset()` runs on room ENTRY, never on
  // leave, so the lobby holds the LAST room's checkpoints — and a checkpoint seed carries no room
  // id, so this is the only layer where the answer exists. Without it the control would offer one
  // room's state under another room's name.
  ok(/room:\s*current\s*\?/.test(room),
    "E: heldCheckpoints reports WHICH room the held checkpoints belong to, read from the feature "
    + "layer's `current` — the seed carries no room id and the backend cannot answer this");
}

// ── PART F — the UI is wired, clears itself, and does no clock arithmetic ────────────────────
// P1: a guard on the module is not a guard on the wiring. A renderer nobody calls is the exact
// failure this tree has recorded six times, so the call site is asserted, not the function.
{
  const ui = code("ui/interface.js");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

  ok(/function renderExportSection\(\)/.test(ui), "F: the renderer exists");
  // ── THE CALLER MOVED, AND THE ASSERTION MOVED WITH IT (v273) ────────────────────────────
  // This pinned that the LOBBY's `renderRoomList` calls the export renderer. It did, and the
  // section it produced described "the room you last opened" — a permanent list on the screen
  // whose whole subject is choosing BETWEEN rooms, so it was always about a room other than the
  // one being looked at. It renders inside the room now, from `renderSettings`, where "held from
  // this room" is true without qualification.
  //
  // THE PROPERTY IS UNCHANGED and is what still matters: **something invokes it**. Asserting only
  // that the function exists would stay green on a build where nothing calls it, which is how a
  // correct module comes to be reached by nothing — so the caller is named, just a different one.
  // ENCLOSURE BY POSITION, because neither a next-declaration slice nor a brace match is reliable
  // here: `renderSettings` declares helpers inside itself (so the first is too early) and the file
  // carries braces inside comments and strings (so counting them is not a fact about the code).
  // The call is inside `renderSettings` if it falls after that declaration and before the next
  // TOP-LEVEL one — which is what "inside" means for a file written at one indent level.
  // BRACE-MATCHED OVER THE RAW LINES. `ui` here is comment-stripped, so character offsets into it
  // do not correspond to the file and slicing by index drifted past the call. Counting braces line
  // by line over the ORIGINAL source is the only version of "inside this function" that is a fact
  // about the code rather than about how the guard happened to preprocess it.
  const rawLines = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8").split("\n");
  const sLine = rawLines.findIndex((l) => /function renderSettings\(/.test(l));
  ok(sLine >= 0, "F: APPLIED — `renderSettings` must be findable", sLine);
  let sd = 0, eLine = -1;
  for (let i = sLine; i < rawLines.length && eLine < 0; i++) {
    for (const ch of rawLines[i]) {
      if (ch === "{") sd++;
      else if (ch === "}") { sd--; if (sd === 0 && i > sLine) { eLine = i; break; } }
    }
  }
  ok(eLine > sLine, "F: APPLIED — and brace-matchable", { sLine, eLine });
  const settingsBody = rawLines.slice(sLine, eLine + 1).join("\n");
  ok(/renderExportSection\(\)/.test(settingsBody),
    "F: APPLIED — the ROOM's settings renderer calls it. Asserting the function exists would stay "
    + "green on a build where nothing invokes it, which is how a correct module comes to be "
    + "reached by nothing");
  const lobby = ui.slice(ui.indexOf("function renderRoomList("));
  const lobbyBody = lobby.slice(0, lobby.indexOf("\n  function setCreateRoomVisible"));
  ok(!/renderExportSection\(\)/.test(lobbyBody),
    "F: and the LOBBY no longer calls it — a section headed with one room's name, rendered on the "
    + "screen for choosing a different one, is a true label in the wrong place");
  ok(/id="export-section"/.test(html),
    "F: and the container it renders into is in the document");

  const sec = ui.slice(ui.indexOf("function renderExportSection()"));
  const secBody = sec.slice(0, sec.indexOf("\n  }\n") + 4);
  ok(/clear\(box\)/.test(secBody),
    "F: the renderer CLEARS ITS OWN container, so it is safe from every call site rather than "
    + "trusting each future caller to remember (the build law's preference, and what the "
    + "strike-cooldown timer got wrong)");
  ok(/Room\.heldCheckpoints/.test(secBody) && /Room\.exportCheckpoint/.test(secBody),
    "F: it reads through the feature layer");

  // THE P2 ASSERTION, AND IT IS ABOUT THE SHAPE OF THE ARITHMETIC RATHER THAN A NAME. A relative
  // label — "2 hours ago" — is `Date.now() - at`, a device clock subtracted from a server stamp,
  // in a line whose whole purpose is to be compared against what another client shows. An absolute
  // rendering of a server value is a display transformation and is fine.
  const fmt = ui.slice(ui.indexOf("function _fmtStamp("));
  const fmtBody = fmt.slice(0, fmt.indexOf("\n  }") + 4);
  ok(/toLocaleString/.test(fmtBody),
    "F: the stamp is rendered absolutely");
  ok(!/Date\.now|performance\.now/.test(fmtBody),
    "F: and NO local clock enters the label — a relative 'ago' here would subtract a device clock "
    + "from a server stamp, which is P2 on the one surface its pitfall entry was written for");
  ok(/time unknown/.test(fmtBody),
    "F: an absent stamp is STATED as unknown rather than filled in — the undated case PART C "
    + "proves is reachable must not silently acquire a time here");
}

ok(checks >= 25, "the guard actually compared something (" + checks + " assertions)");

console.log("[export] PASS — the export path is REACHED rather than merely correct: the held list "
  + "comes out of Floor through a real accessor (the `_seenForTest` seam is gone, not kept beside "
  + "it), through StreamManager, through the feature layer, to a lobby renderer the room list "
  + "actually calls — which is the half J25 could not have, because CheckpointFormat is walled and "
  + "its serialiser had no production caller at all. Rank leaves the backend as a NAME and the "
  + "author's Matrix ID does not leave; every label carries the checkpoint's OWN server stamp "
  + "passed through unchanged, and the undated case says so rather than taking the device clock "
  + "(P2). The Open is answered by construction rather than by preference: export ships what is "
  + "held and REPORTS whether it can be imported, because an owner file is complete at one "
  + "snapshot and never reaches the chain check while a short peer client is missing the joining "
  + "SEGMENT rather than more snapshots — so paging would cost a real round trip and buy neither. "
  + "`importable` is asserted against readFile's own verdict in both directions, with the "
  + "admitting sibling that makes the refusal attributable (" + checks + " assertions)");
process.exit(0);
