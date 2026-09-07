// tests/check-rank-injection.js
// WALL: CHANNEL AUTHORITY IS NEVER READ WITHOUT ITS CHANNELS MAP.
//
// Four accessors derive a client's authority from the room's channel layout — getRankInfo,
// getMyRank, getWriteChannelId, getCheckpointChannelId. Every one of them returns a PLAUSIBLE
// value when called with no argument: rank 0, channel null. Nothing throws. A caller that forgets
// the map gets "guest" and carries on, and the only symptom is that some rank-dependent behaviour
// silently stops differentiating between clients.
//
// This has now happened TWICE with the same accessor:
//   features/playback.js  — the advance stagger. Every client, owner included, computed the
//                           weakest slot; the whole turn-taking design was inert. Fixed by
//                           injecting the rank at wire time; the comment at playback.js:18 is
//                           the post-mortem.
//   backends/backend1/checkpoint.js — the SEAL stagger, identical shape, found two
//                           versions later by reading a real room's checkpoints.
//
// So this guard is deliberately about the CLASS, not either instance. One assertion catches the
// site already fixed, the site just fixed, and every future one. Two sessions found this bug twice
// by accident; a guard finds it once and keeps finding it.

const fs = require("fs");
const path = require("path");
const { ROOT } = require("./_load");

function fail(msg, got) {
  console.log("[rank-injection] FAIL — " + msg);
  if (got !== undefined) console.log("      " + got);
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

// COMMENTS STRIPPED FIRST, and here that is not a formality: playback.js:18 contains the literal
// text "MatrixBridge.getMyRank() with NO ARGUMENTS" inside the comment describing the bug. A guard
// that skipped this step would fire on the post-mortem of the thing it is looking for, and the
// obvious "fix" would be to delete the explanation.
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function sources() {
  const out = [];
  for (const dir of ["backends/backend1", "features", "ui", "core"]) {
    const abs = path.join(ROOT, dir);
    let names = [];
    try { names = fs.readdirSync(abs); } catch (e) { continue; }
    for (const n of names) {
      if (!n.endsWith(".js")) continue;
      out.push({ rel: dir + "/" + n, src: strip(fs.readFileSync(path.join(abs, n), "utf8")) });
    }
  }
  return out;
}

const FILES = sources();
ok(FILES.length > 5, "found the source tree at all", FILES.length + " files");

// ── The class: an authority accessor invoked with an empty argument list ─────────────────────
const ACCESSORS = ["getMyRank", "getRankInfo", "getWriteChannelId", "getCheckpointChannelId"];
{
  const offenders = [];
  for (const f of FILES) {
    for (const acc of ACCESSORS) {
      // `X.getMyRank()` — a qualified call with nothing passed.
      const qualified = new RegExp("\\b[A-Za-z_$][\\w$]*\\." + acc + "\\(\\s*\\)", "g");
      let m;
      while ((m = qualified.exec(f.src)) !== null) {
        // Room.getMyRank() is the sanctioned wrapper — it holds `current.channels` and passes it.
        // Asserted separately below, so it is exempt here rather than invisible.
        if (/^Room\./.test(m[0])) continue;
        offenders.push(f.rel + "  ->  " + m[0]);
      }
      // A bare internal call inside matrixbridge itself, where these are module-scope functions.
      if (f.rel === "backends/backend1/matrixbridge.js") {
        const bare = new RegExp("(^|[^.\\w$])" + acc + "\\(\\s*\\)", "g");
        while ((m = bare.exec(f.src)) !== null) offenders.push(f.rel + "  ->  bare " + acc + "()");
      }
    }
  }
  ok(offenders.length === 0,
    "an authority accessor is called with NO channels map — it returns rank 0 / null channel " +
    "rather than throwing, so the caller silently becomes a guest",
    offenders.join("\n      "));
}

// ── The sanctioned wrapper actually passes the map ───────────────────────────────────────────
// Without this, the exemption above would be a hole: every call site could migrate to
// Room.getMyRank() and the guard would go quiet while the bug came back.
{
  const room = FILES.find((f) => f.rel === "features/room.js");
  ok(room, "features/room.js present");
  const decl = room.src.match(/function getMyRank\(\)\s*\{[^}]*\}/);
  ok(decl, "Room.getMyRank is declared");
  ok(/MatrixBridge\.getMyRank\(\s*[\w$.]+\s*\)/.test(decl[0]),
    "Room.getMyRank must pass a channels map through to the backend", decl && decl[0]);
}

// ── The two known sites are injected, and the injection is actually called ───────────────────
// A setter nothing calls is this codebase's signature failure (earnsForget, gradeForTier's
// computedSelf, the seal-hold predicate). Assert the wiring, not just the seam.
{
  const cases = [
    // THE SEAL STAGGER, same class, new home. The engine split into Checkpoint (emitting) and Floor
    // (choosing), and BOTH read channel authority — so both must be handed it, and neither may
    // default to 0. `uncategorized` is not a neutral placeholder: it is the WEAKEST rung, which on
    // the acceptance side accepts every substitute quorum on offer.
    //
    // The shape also changed, which is the point of asserting the CLASS: rank is no longer pushed
    // in by a setter but pulled through an injected getter, so a rank change moves the slot without
    // anyone remembering to re-inject. The failure it guards against is identical either way.
    { mod: "backends/backend1/checkpoint.js", wirer: "backends/backend1/matrixbridge.js",
      call: /myRank:\s*\(\)\s*=>\s*getMyRank\(\s*channels\s*\)/,
      why: "the seal stagger" },
    { mod: "backends/backend1/floor.js", wirer: "backends/backend1/matrixbridge.js",
      call: /myRank:\s*\(\)\s*=>\s*getMyRank\(\s*channels\s*\)/,
      why: "whose floors bind me" },
    { mod: "features/playback.js", wirer: "features/room.js",
      call: /Playback\.setMyRank\(\s*MatrixBridge\.getMyRank\(\s*[\w$.]+\s*\)\s*\)/,
      why: "the advance stagger" },
  ];
  for (const c of cases) {
    const mod = FILES.find((f) => f.rel === c.mod);
    const wirer = FILES.find((f) => f.rel === c.wirer);
    // A SEAM EXISTS — by either shape. A module may take its rank through a `setMyRank` setter or
    // through an injected `myRank` getter; what matters is that it does not decide for itself, and
    // that whatever it exposes is actually CALLED. The getter shape is stronger, because a rank
    // change moves the slot with nobody remembering to re-inject — but the failure this guard
    // exists for is the same in both, so it accepts both and insists on the call site either way.
    ok(mod && (/function setMyRank\(/.test(mod.src) || /myRank:\s*null/.test(mod.src)
               || /myRank:\s*\(\)/.test(mod.src)),
      c.mod + " exposes a rank seam — a setter or an injected getter (" + c.why + ")");
    ok(wirer && c.call.test(wirer.src),
      c.mod + "'s rank must actually be INJECTED by " + c.wirer + " with a real channels map — " +
      "a setter nothing calls leaves the module reading 0 forever");
  }
}

// ── And the stagger reads the injected value, not a fresh channel-less lookup ────────────────
{
  // The seal's slot moved into the shared Scheduler — which is the point of having one: every
  // staggered job now takes its turn the same way, and there is a single place where the ladder
  // could be got wrong. Assert the PROPERTY, not the line it lives on: an earlier version required
  // staggerMs to appear inside `_onEvent` and broke the moment the slot moved into a helper.
  const sch = FILES.find((f) => f.rel === "backends/backend1/scheduler.js");
  const cp = FILES.find((f) => f.rel === "backends/backend1/checkpoint.js");
  ok(sch && /Ranks\.staggerMs\(/.test(sch.src),
    "the one stagger primitive is still what decides a slot — seven ladders were consolidated into "
    + "it and nothing may grow an eighth");
  ok(cp && /rank:\s*\(\)\s*=>\s*_env\.myRank\(\)/.test(cp.src),
    "and the seal feeds it the INJECTED rank, through a getter read at FIRE time rather than a "
    + "value captured when the job was planned");
  ok(cp && !/MatrixBridge\.getMyRank/.test(cp.src),
    "the seal stagger must never reach for the accessor it cannot feed a channels map");
}

// ── THE LADDER IS READ, NOT RESTATED (added when the owner rung moved 100 -> 99) ──────────────
// `Room.highestUnlockedRank` walked a hand-written level list. When the owner rung moved, the
// list still said 100, `eventsKeyForLevel` is an EXACT-match lookup keyed by ladder level, and a
// fully-unlocked room answered `high-staff` instead of `owner` — a plausible value, no throw,
// exactly this guard's class. Reverting the derivation left the whole suite green, so the change
// had no net under it until this row existed.
{
  const src = fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8");
  const fn = src.slice(src.indexOf("function highestUnlockedRank"));
  // COMMENTS STRIPPED FIRST. The function's own comment names the literal list it replaced, and
  // an earlier draft of this row went red on that prose — the guard read the post-mortem as the
  // defect. Assert against CODE, never against a file's description of itself.
  const body = fn.slice(0, fn.indexOf("\n  }"))
    .replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // PREMISE: this row is worthless if the function it names is not the one that walks levels.
  ok(/for \(const level of/.test(body),
    "PREMISE: highestUnlockedRank still walks a level list — if this fails the row below pins nothing");
  ok(!/\[\s*0\s*,\s*10\s*,/.test(body),
    "highestUnlockedRank must not restate the ladder as a literal level list");
  ok(/Capabilities\.LADDER/.test(body),
    "highestUnlockedRank reads Capabilities.LADDER — the only legal route to the ladder from features/");
}

// ── SECOND COPY OF THE SAME RULE, ONE FILE OVER (found by review, not by the sweep) ───────────
// `ui/interface.js` held `RANKS` — a hand-written table whose first row said `level: 100`. The
// row above pinned `room.js` and could not reach this one. The damage was not a wrong label:
// `rankSelect` filters options through `Room.isRankUnlocked`, `eventsKeyForLevel(100)` answers
// null, and the OWNER OPTION VANISHED FROM THE RANK PICKER — the only surface by which a human
// appoints the Phase 3 bot. A hand-written copy of a derived list is a second copy of the rule;
// the guard that catches the first cannot reach the second. Both are pinned here now.
{
  const src = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
  const at = src.indexOf("const RANKS =");
  ok(at > 0, "PREMISE: ui/interface.js still declares RANKS — if this fails the rows below pin nothing");
  const decl = src.slice(at, src.indexOf(";", at))
    .replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Via Room, NOT via Capabilities: ui/ may not reach the backend directly, so the first fix
  // here traded one violation for two (check-boundaries + check-ui-no-permission both fired).
  ok(/Room\.rankLadder\(\)/.test(decl),
    "RANKS is derived from Room.rankLadder(), not hand-written");
  ok(!/level:\s*100\b/.test(decl),
    "RANKS must not restate a rank level as a literal — the ladder owns the numbers");
  // The face table is keyed by NAME so a rung that moves carries its label. A level-keyed face
  // table would be the same defect wearing a different shape.
  const face = src.slice(src.indexOf("_RANK_FACE"), src.indexOf("const RANKS ="))
    .replace(/\/\/[^\n]*/g, "");
  ok(!/^\s*\d+\s*:/m.test(face),
    "the rank display table is keyed by ladder NAME, never by level");
}

console.log("[rank-injection] PASS — the ladder is read rather than restated in Room.highestUnlockedRank, and no module reads channel authority (getMyRank / getRankInfo / getWriteChannelId / getCheckpointChannelId) without passing the room's channels map, which those accessors answer with rank 0 and a null channel rather than an error; Room.getMyRank is exempt only because it demonstrably passes the map through; and both modules that hit this bug expose a rank setter that is provably CALLED with a real map, since a setter nothing calls is the same failure wearing a different hat");
