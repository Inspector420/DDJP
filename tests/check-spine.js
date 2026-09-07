// tests/check-spine.js
// WALL: THE LAYER STORY IS TRUE OF THE CODE, AND THE CASCADE LIST IS COMPLETE.
//
// Every other guard locks one rule. This one locks the SHAPE — the claim that the backend is six
// layers, each existing because of a problem the one below cannot solve, and that a client's duty
// to act is spread by rank across a known set of actions.
//
// WHY A GUARD FOR A CONCEPT. The shape is the thing you need in your head to change anything here
// safely, and it is the thing nothing checked. A locally correct change that is wrong across the
// stack is this project's signature failure: a floor restore that verified before replay, a seal
// cadence anchored on the wrong end. Both were right in their own file. `docs/SPINE.md` narrates
// the shape; this guard is what stops the narration drifting from the tree.
//
// THIS GUARD IS THE CANONICAL LIST. The prose has one home, but so does the structure, and they are
// not the same home. Where the page and this file disagree, THIS FILE IS RIGHT — it is derived by
// scanning, the page is written by hand.
//
// PART A — the layers exist: every module named below is really in the tree, in its stated layer.
// PART B — the dependencies that carry the story are real module references, not narrative.
// PART C — the cascade list is COMPLETE, derived by scanning for stagger callers.
// PART D — the direction of the stack: nothing below reaches up into a layer above it.

const path = require("path");
const fs = require("fs");

function fail(m, g) { console.log("[spine] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const ROOT = path.join(__dirname, "..");
const BE = path.join(ROOT, "backends/backend1");
const src = (f) => fs.readFileSync(path.join(BE, f), "utf8");
const code = (f) => src(f).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// ── THE SIX LAYERS ──────────────────────────────────────────────────────────────────────────
// Bottom to top. A module sits in the layer whose PROBLEM it exists to solve, which is not always
// the layer it is called from — `ranks` is read by everything and belongs at the bottom because a
// rank is a fact about the bus, not a decision any upper layer makes.
const LAYERS = [
  { n: "bus",        problem: "events must arrive at all, attributably",     mods: ["matrixbridge", "ranks"] },
  { n: "order",      problem: "they arrive in any order",                    mods: ["streammanager", "consensushash"] },
  { n: "meaning",    problem: "an ordered pile is not a room",               mods: ["statederiver", "capabilities", "dials", "history"] },
  { n: "wholeness",  problem: "I may be missing events and not know",        mods: ["continuity", "session"] },
  { n: "protection", problem: "events can be deleted and then unprovable",   mods: ["vouch", "trustpolicy"] },
  { n: "banking",    problem: "protecting everything forever is unbounded",  mods: ["checkpoint", "floor", "checkpointformat", "settingsproof", "eventcache"] },
];
const CASCADE = "scheduler";   // cuts across all six rather than sitting in one

// ── PART A — the layers are real, and they account for the whole backend ────────────────────
{
  const onDisk = fs.readdirSync(BE).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, ""));
  ok(onDisk.length > 12, "A: setup — the backend was actually read (probe applied)", onDisk.length);

  const placed = [];
  for (const L of LAYERS) for (const m of L.mods) placed.push(m);
  placed.push(CASCADE);

  for (const m of placed) {
    ok(onDisk.indexOf(m) >= 0,
      "A: APPLIED — `" + m + "` is named in the layer story and exists in the tree. A story that "
      + "names a module nobody wrote is the failure this project keeps repeating: plausible, "
      + "specific, and invented", onDisk);
  }
  // AND NOTHING IS UNACCOUNTED FOR. Derived, not hand-listed: a module added tomorrow lands here
  // and forces someone to say which problem it solves.
  const orphans = onDisk.filter((m) => placed.indexOf(m) < 0);
  ok(orphans.length === 0,
    "A: APPLIED — every backend module is placed in exactly one layer. An unplaced module means "
    + "either the story is incomplete or the module has no reason to exist, and both need answering",
    orphans);

  const seen = Object.create(null);
  for (const m of placed) {
    ok(!seen[m], "A: APPLIED — `" + m + "` is placed in ONE layer. Two homes is two answers to "
      + "\"what problem does this solve\", which is how a concept ends up spread across three files");
    seen[m] = true;
  }
}

// ── PART B — the dependencies the story rests on are real ───────────────────────────────────
// Each row is a load-bearing sentence in the page. If a row stops holding, the page is telling a
// story about a system that no longer exists.
{
  const CLAIMS = [
    ["checkpoint", "Vouch",       "banking asks protection whether the span is covered — this is WHY a checkpoint is trustworthy, and the single most load-bearing dependency in the backend"],
    ["checkpoint", "Floor",       "banking asks where its segment starts, rather than deciding a floor itself"],
    // WHICH BRANCH ASKS, because the sentence used to imply every seal does. It read "banking asks
    // wholeness whether it is safe to seal at all", which is stronger than what this row verifies —
    // the row proves the two modules are WIRED, not which callers use the wire. Only the OWNER
    // branch of maySeal asks, and that asymmetry is a decision rather than a missing wire:
    // checkpoint-contents.md §"The owner seals first, and alone" states it and marks it [built].
    // Peers show the span is PROTECTED (coverageVerdict); the owner shows it is COMPLETE. A reader
    // took the old wording for evidence of a gap in the seal path and spent a planning pass on it.
    ["checkpoint", "Continuity",  "banking asks wholeness whether its view is COMPLETE — on the owner's branch only, deliberately, because an owner floor is adopted with no recompute so a short owner seed would silently become the room's truth. Peers are gated on coverage instead"],
    ["continuity", "Vouch",       "wholeness corroborates a gap out of protection records, so a fabricated parent cannot freeze the room"],
    ["eventcache", "Floor",       "forgetting is bounded by the floor, not by a size heuristic"],
    ["eventcache", "Vouch",       "and by what is still owed protection"],
    ["floor",      "TrustPolicy", "the floor asks the one seam whether a checkpoint clears the room's bar"],
    ["vouch",      "TrustPolicy", "and so does protection — one comparison, so the two can never disagree"],
    ["streammanager", "StateDeriver", "order feeds meaning: the reducer is handed an ordered prefix and nothing else"],
    ["scheduler",  "Ranks",       "the cascade gets its slot from rank, which is a fact about the bus"],
    ["trustpolicy", "Ranks",      "and so do the bars, one row per rung"],
  ];
  for (const [file, dep, why] of CLAIMS) {
    const body = code(file + ".js");
    ok(new RegExp("\\b" + dep + "\\.").test(body),
      "B: APPLIED — `" + file + "` really references `" + dep + "`: " + why,
      file + ".js");
  }

  // AND THE ONE THAT MUST NOT APPEAR. The floor does not ask Vouch anything — Checkpoint is the
  // integrator that asks both. Stated because it is the arrow people draw from the story and the
  // code does not have.
  ok(/\bVouch\./.test(code("floor.js")) === false,
    "B: APPLIED — `floor` does NOT reference Vouch. Choosing where to compute from and deciding "
    + "what is protected are two questions; checkpoint is the only place they meet");
}

// ── PART C — the cascade list is complete, and derived ───────────────────────────────────────
// Every rank-staggered action, found by scanning for callers of the one stagger formula. A
// hand-written list stops covering the tree the moment somebody adds a file, which is exactly how
// the floor bound came to be applied at some call sites and not others.
{
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (["node_modules", "tests", ".git"].indexOf(e.name) < 0) walk(p); }
      else if (e.name.endsWith(".js")) files.push(p);
    }
  })(ROOT);
  ok(files.length > 40, "C: setup — the scan walked the tree (probe applied)", files.length);

  const callers = [];
  for (const f of files) {
    const body = fs.readFileSync(f, "utf8").split("\n");
    body.forEach((line, i) => {
      if (/^\s*\/\//.test(line)) return;
      if (/(Capabilities|Ranks)\.staggerMs\s*\(|Scheduler\.plan\s*\(/.test(line)) {
        callers.push(path.relative(ROOT, f) + ":" + (i + 1));
      }
    });
  }
  // The definition site and the Scheduler's own internal use are not actions.
  const acts = callers.filter((c) => !/backends\/backend1\/(ranks|scheduler|capabilities)\.js/.test(c));

  // EVERY SITE IS CLASSIFIED, AND NONE MAY BE SILENTLY SKIPPED. A site is either an ACTION — it
  // schedules work for this client's turn — or it is not, and then it must say why. Same shape as
  // check-advance-notify: a candidate with no entry is the GUARD's gap, not the tree's.
  //
  // WHO HOLDS THE RE-CHECK is named per action rather than asserted here. This guard owns the
  // INVENTORY — that the list is complete and every entry accounted for. The behaviour of each
  // re-check is held where it can actually be driven, and naming the holder is what makes an
  // unheld one visible instead of assumed.
  //
  // KEYED BY FILE, NOT BY file:line. The first version keyed on `matrixbridge.js:2713`, which made
  // an unrelated comment inserted anywhere above it turn this guard RED — reporting "the scan found
  // a site this guard has no entry for" when nothing had been added and a line had merely moved. A
  // false alarm that reads like a finding is worse than a false alarm: it trains the next person to
  // dismiss this guard's message, and the message is the only thing that makes it useful. A file
  // plus a count is stable under editing and still catches everything that matters — a new site in
  // a known file changes the count, a site in a new file has no entry, and a file that stops having
  // any is a stale entry.
  const SITES = {
    "backends/backend1/matrixbridge.js": { actions: 1, note: "vouch:proactive — Scheduler-routed, stillNeeded asserted below" },
    "backends/backend1/checkpoint.js":   { actions: 1, note: "checkpoint:seal — Scheduler-routed, stillNeeded DRIVEN below; the second site is ladderMs, an arithmetic term in the dueness comparison and never a scheduled job" },
    "features/playback.js":              { actions: 2, note: "play.len (check-stagger-savings A/B) and the advance (check-advance-gate, check-length-freshness); the third site is _mySlotMs(), which feeds a log line" },
    "features/medialength.js":           { actions: 1, note: "media.len — check-stagger-savings C/D/E" },
    "features/mediablocked.js":          { actions: 2, note: "play.blocked (staleness only — a blocked report is per-person and no peer can discharge it) and media.skip (check-blocked-skip)" },
  };
  const TOTAL_ACTIONS = 7;

  const byFile = Object.create(null);
  for (const c of acts) {
    const f = c.slice(0, c.lastIndexOf(":"));
    byFile[f] = (byFile[f] || 0) + 1;
  }
  for (const f of Object.keys(byFile)) {
    ok(SITES[f] !== undefined,
      "C: APPLIED — the scan found staggered sites in " + f + " and this guard has no entry for it. "
      + "That is the GUARD's gap, not the module's: a file nobody classified is a turn nobody "
      + "checked. Add an entry saying how many of its sites are ACTIONS and what holds each "
      + "re-check", Object.keys(byFile));
  }
  for (const f of Object.keys(SITES)) {
    ok(byFile[f] !== undefined,
      "C: APPLIED — this guard carries an entry for " + f + " and the scan finds no staggered site "
      + "there any more. A stale entry is a claim about code that has moved", Object.keys(byFile));
  }

  const actions = Object.keys(SITES).reduce((n, f) => n + SITES[f].actions, 0);
  ok(actions === TOTAL_ACTIONS,
    "C: APPLIED — there are exactly seven rank-staggered ACTIONS. Asserted EXACTLY, not as a floor: "
    + "`>= 7` against nine sites carried two units of slack, so a real action could be deleted and "
    + "the count would still pass", { actions: actions, expected: TOTAL_ACTIONS });

  // AND THE SITE COUNT PER FILE IS PINNED, so a NEW staggered site added to a file that already has
  // one cannot hide inside an entry that already exists. Recorded as sites (actions + non-actions),
  // because that is what the scan can see.
  const EXPECTED_SITES = {
    "backends/backend1/matrixbridge.js": 1, "backends/backend1/checkpoint.js": 2,
    "features/playback.js": 3, "features/medialength.js": 1, "features/mediablocked.js": 2,
  };
  for (const f of Object.keys(EXPECTED_SITES)) {
    ok(byFile[f] === EXPECTED_SITES[f],
      "C: APPLIED — " + f + " has " + byFile[f] + " staggered sites, this guard expects "
      + EXPECTED_SITES[f] + ". A site added to a file that already has one would otherwise slip in "
      + "under an entry that already exists", byFile);
  }

  // AND THE TWO SCHEDULER-ROUTED ONES REALLY PASS `stillNeeded`. Driven for checkpoint, parsed for
  // matrixbridge — and the difference is stated rather than blurred, because the previous version
  // of this assertion counted FILENAMES matching /matrixbridge|checkpoint/ and claimed that proved
  // they ask stillNeeded. It proved nothing: it matched three sites, one of which never touches
  // the Scheduler, and deleting `stillNeeded` from planSeal left this guard green.
  {
    let captured = null;
    const sb = require("./_load").loadInContext([
      "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/trustpolicy.js",
      "backends/backend1/consensushash.js", "backends/backend1/vouch.js",
      "backends/backend1/statederiver.js", "backends/backend1/dials.js",
      "backends/backend1/checkpointformat.js", "backends/backend1/floor.js",
      "backends/backend1/checkpoint.js",
    ], { Scheduler: { plan: (name, spec) => { captured = spec; return true; }, cancel: () => {} } });
    sb.Checkpoint.attach({
      now: () => 0, log: () => [], held: () => [], settings: () => ({}), myRank: () => 100,
      myUserId: () => "@u:hs", amOwner: () => true, isLegal: () => null, send: async () => {},
      holdForWitness: () => ({ hold: false }), thin: () => false,
      floorTs: () => null, floorPos: () => -1,
    });
    sb.Checkpoint.planSeal();
    ok(captured && typeof captured.stillNeeded === "function",
      "C: APPLIED — checkpoint:seal is DRIVEN and really hands the Scheduler a `stillNeeded`. "
      + "Without it the seal fires on a room that has moved since its slot was booked, which is "
      + "the whole difference between waiting your turn and a cascade",
      captured ? Object.keys(captured) : null);
  }
  {
    const mb = fs.readFileSync(path.join(BE, "matrixbridge.js"), "utf8");
    const i = mb.indexOf("Scheduler.plan(\"vouch:proactive\"");
    ok(i > 0, "C: setup — the vouch:proactive plan call was located (probe applied)", i);
    // Parsed, not driven: reaching this call needs a live sync and a room. Stated so nobody reads
    // it as equal evidence to the driven one above.
    ok(/stillNeeded/.test(mb.slice(i, i + 900)),
      "C: APPLIED — vouch:proactive's plan call carries a `stillNeeded`. PARSED from the call "
      + "itself rather than driven, because reaching it needs a live sync — but parsed AT THE CALL, "
      + "not inferred from the filename", mb.slice(i, i + 120));
  }
}

// ── PART D — the stack has a direction ──────────────────────────────────────────────────────
// The bottom two layers know nothing about trust. If `ranks` or `consensushash` started asking
// about floors or vouching, the layering would be a story rather than a fact — and every claim
// about swapping the consensus backend rests on this being true.
{
  for (const m of ["ranks", "consensushash"]) {
    const body = code(m + ".js");
    for (const upper of ["Floor", "Checkpoint", "Vouch", "Continuity", "TrustPolicy"]) {
      ok(new RegExp("\\b" + upper + "\\.").test(body) === false,
        "D: APPLIED — `" + m + "` does not reach up to `" + upper + "`. The bottom of the stack is "
        + "consensus-agnostic, which is the whole basis for the backend being swappable");
    }
  }
  ok(/\bRanks\./.test(code("trustpolicy.js")),
    "D: setup — while the upper layers DO reach down, which is the direction that is allowed "
    + "(probe applied: if nothing reached down either, the assertions above would prove nothing)");
}

// ── PART E — the BEHAVIOUR story is true too ────────────────────────────────────────────────
// docs/BEHAVIOUR.md claims a specific shape: one door in, four announcers, and a known set of
// timers. Structure is greppable and so is this much of behaviour — what is NOT checkable is
// ORDERING, whether one module's announcement fires before another needs it. That is the class the
// floor restore fell into, and only the running simulation can see it. Stated so nobody reads a
// green [spine] as covering it.
{
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p2 = path.join(d, e.name);
      // ── WHAT THIS SCAN IS ABOUT IS THE SHIPPED APP ────────────────────────────────────────
      // `tools/` joins `tests/` here, and the criterion is the same one `08-build-and-deploy.md`
      // §What `?v=` tracks uses to decide a version bump: is this code DELIVERED to a browser?
      // Nothing under either directory carries a `?v=` tag or appears in a `<script src>` — the one
      // mention of `tools/` in `index.html` is a provenance comment — so neither can bypass a
      // runtime door, because neither runs at runtime.
      //
      // WIDENED IN J35, AND WHAT MADE IT NECESSARY IS WORTH KEEPING: the first probe under `tools/`
      // to drive the REAL ingest door instead of `_setLogForTest` turned this red. That is the
      // correct instinct pointed at the wrong population — a probe going through the production
      // door is exactly what this suite asks for elsewhere ("a guard must reach the subject the way
      // production does"), so a rule that penalises it would push probes towards the seam that
      // bypasses validation, dedup and the banked check. The rule being enforced is that no
      // `features/` or `ui/` file reaches past the door, and the assertion below pins that the scan
      // still reaches those two directories, so this exclusion cannot quietly grow into them.
      if (e.isDirectory()) { if (["node_modules", "tests", "tools", ".git"].indexOf(e.name) < 0) walk(p2); }
      else if (e.name.endsWith(".js")) files.push(p2);
    }
  })(ROOT);

  // ONE DOOR. Every event enters through StreamManager.ingest; a second entry point would be a
  // second definition of "an event we accept", free to disagree with the first.
  const scanned = files.map((f) => path.relative(ROOT, f));
  // THE EXCLUSION ABOVE IS A DECISION, SO ITS BLAST RADIUS IS PINNED. `features/` and `ui/` are the
  // population this rule exists for; a scan that stopped reaching them would report "nobody bypasses
  // the door" for the reason that it looked nowhere, which is absence reading as agreement.
  ok(scanned.some((f) => f.indexOf("features/") === 0),
    "E: setup — the walk must still reach features/, or the one-door rule is enforced over nothing",
    scanned.length);
  ok(scanned.some((f) => f.indexOf("ui/") === 0),
    "E: setup — and ui/, for the same reason", scanned.length);
  ok(!scanned.some((f) => f.indexOf("tools/") === 0),
    "E: setup — and NOT tools/, which is dev-only and is deliberately excluded above; if this fires, "
    + "the exclusion stopped working and the next reader will meet a red about a probe", scanned.length);

  const ingesters = files.filter((f) => /StreamManager\.ingest\s*\(/.test(fs.readFileSync(f, "utf8")))
                         .map((f) => path.relative(ROOT, f));
  ok(ingesters.length > 0, "E: setup — the scan found the door (probe applied)", ingesters);
  for (const f of ingesters) {
    ok(/^backends\//.test(f),
      "E: APPLIED — only the transport layer calls the one ingest door. A feature reaching past it "
      + "would bypass validation, dedup and the already-banked check in a single line", ingesters);
  }

  // THE ANNOUNCERS. Modules that push rather than answer, because the chains they start are the
  // part of this system nothing else writes down.
  const ANNOUNCERS = {
    streammanager: "the room re-derived — every downstream reader",
    floor:         "where I compute from moved — trim + count anchor, and re-page on demote",
    session:       "my phase changed — parked work releases on LIVE",
    continuity:    "a gap opened or closed — repair is scheduled, debounced",
  };
  for (const m of Object.keys(ANNOUNCERS)) {
    const body = code(m + ".js");
    // ANCHORED, because `function onChange` also matches `function onChangeX` — a rename would
    // have slipped through as a substring, which mutation caught.
    ok(/function onChange\s*\(|function on\s*\(|subscribers\s*\[/.test(body),
      "E: APPLIED — `" + m + "` really announces (" + ANNOUNCERS[m] + "). A module that stopped "
      + "pushing would leave its listeners silently idle rather than failing", m);
  }

  // AND NOBODY ELSE DOES. Derived: a fifth announcer means a chain nobody has written down.
  const beMods = fs.readdirSync(BE).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, ""));
  const extra = beMods.filter((m) => !ANNOUNCERS[m] && /function onChange\s*\(/.test(code(m + ".js")));
  ok(extra.length === 0,
    "E: APPLIED — exactly four backend modules announce. A new one starts a reaction chain, and an "
    + "unwritten chain is how adopting a floor came to reset a counter three modules away with "
    + "nothing saying so", extra);

  // THE TIMERS ARE OWNED. Everything that wakes on its own lives in a module that says so; a timer
  // in a module not listed here is behaviour nobody declared.
  const TIMER_OWNERS = ["backends/backend1/matrixbridge.js", "backends/backend1/scheduler.js",
                        "backends/backend1/session.js"];
  const timerFiles = files.filter((f) => {
    const body = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    return /(^|[^\w.])(setTimeout|setInterval)\s*\(/.test(body);
  }).map((f) => path.relative(ROOT, f)).filter((f) => /^backends\//.test(f));
  ok(timerFiles.length >= 3, "E: setup — the timer scan found something (probe applied)", timerFiles);
  for (const f of timerFiles) {
    ok(TIMER_OWNERS.indexOf(f) >= 0,
      "E: APPLIED — every backend module that wakes on its own is named in docs/BEHAVIOUR.md. A new "
      + "timer is a new thing happening that no page describes", timerFiles);
  }
}

console.log("[spine] PASS — the layer story is true of the tree: every backend module is placed in "
  + "exactly one of the six layers and none is unaccounted for, so a module added tomorrow forces "
  + "someone to say which problem it solves; the dependencies the story rests on are real module "
  + "references — checkpoint asks vouch whether the span is covered, which is WHY a checkpoint is "
  + "trustworthy, checkpoint asks floor and continuity, continuity corroborates out of vouch "
  + "records, eventcache is bounded by floor and vouch, and floor and vouch both ask the one trust "
  + "seam so the two can never disagree — while floor does NOT ask vouch, because choosing where to "
  + "compute from and deciding what is protected meet only in checkpoint; the rank-staggered "
  + "actions are DERIVED by scanning for callers of the one stagger formula rather than listed from "
  + "memory, so an unnamed one fails here; and the bottom of the stack knows nothing of floors or "
  + "vouching, which is what makes the consensus layer swappable at all. Behaviour is locked as far "
  + "as it can be: one ingest door and only the transport calls it, exactly four announcing modules "
  + "with the chains they start named, and every self-waking backend module owned by a page — while "
  + "ORDERING between those chains is explicitly NOT covered here, because no grep can see it and "
  + "only the running simulation can");
