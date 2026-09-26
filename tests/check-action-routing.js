// tests/check-action-routing.js
// SUBJECT: features/actions.js, ui/
// WALL: IF THE ADAPTER HAS A ROW FOR AN ACT, THE UI DISPATCHES THROUGH IT.
//
// `features/actions.js` is the one seam between a click and a feature. Its value is that
// `perform` re-checks the descriptor before anything reaches the wire, so a stale click cannot
// slip a refused intent past a button that was rendered a moment earlier. A UI that calls the
// feature directly gets none of that — and, worse, the two paths can hold DIFFERENT answers.
//
// That is not hypothetical; it is what J31 found. `_commitSetting` asked
// `Actions.describe("room.settings").enabled` for the RULE and then called `Room.setSettings`
// directly for the ACT. The rule and the dispatch reached the wire by two routes, and only one of
// them was the seam. `Room.invite` and `RoomUpgrade.upgrade` did the same with no rule read at all.
//
// ── WHAT THIS GUARD DOES *NOT* SAY ──────────────────────────────────────────────────────────
// It does not say every button must go through the adapter. Five catalog rows — `dj.join`,
// `dj.leave`, `dj.declare`, `dj.undeclare`, `dj.order` — have no UI dispatcher and MUST NOT get
// one, because the UI reaches those acts by a deliberately different route: the Join button edits
// `UserQueue`'s local intent and the reconcile loop authors the events. Measured, not assumed —
// PART C drives it. Routing the button at `dj.join` would post a bare join and skip the intent
// list, which is a behaviour change in a job filed as "no behaviour change".
//
// So the rule is one-directional and that is the whole design: **a row that exists must be the
// route**. Whether a row should exist is a judgement; whether the UI goes around one that does is
// not.
//
// PART A  every feature call a catalog row wraps is absent from `ui/`
// PART B  the row's args survive the adapter — the trap this job actually hit
// PART C  the rows with no dispatcher have no UI call site either, by either route

const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

let failed = false, A = 0;
function ok(c, msg, got) {
  A++;
  if (c) return;
  failed = true;
  console.log("[action-routing] FAIL — " + msg);
  if (got !== undefined) console.log("      " + (typeof got === "string" ? got : JSON.stringify(got)));
}

const ACTIONS_SRC = fs.readFileSync(path.join(ROOT, "features/actions.js"), "utf8");

// Comments stripped, and not as a formality: this file's header names `Room.setSettings` and
// `RoomUpgrade.upgrade` while explaining the defect, so a scan that read prose would fire on the
// post-mortem of the thing it is looking for — and the obvious "fix" would be deleting the
// explanation. Same reasoning `check-rank-injection` gives for the same step.
function strip(src) {
  return src.split("\n")
    .map((line) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return "";
      return line.replace(/([^:])\/\/.*$/, "$1");
    })
    .join("\n");
}

// ── READ AS THE ui/ POPULATION, NOT AS ONE FILE (widened at ddjp_388) ────────────────────────
// THIS IS THE WIDENING THAT WAS RECORDED AS A PRECONDITION AND IT ARRIVED EARLY. Measured at
// ddjp_386: PART A is a whole-file NEGATIVE property — *the UI does not call what a catalog row
// already wraps* — and a negative property scoped to one file stops covering code that leaves it
// WITHOUT GOING RED. Driven then: an identical violation planted in a cluster turned this guard
// red while the cluster sat in ui/interface.js and left it GREEN once the cluster sat in
// ui/player.js, PASS line unchanged. The prediction was that it would bite at the clusters that
// build controls; it bit at ui/queue.js instead, because PART C's dispatcher set moved with the
// panels rather than a violation appearing.
//
// The population is read from the DIRECTORY, never listed: a hand-written list is a second copy of
// the ten-file decision, free to drift, and it would drift the way that matters — a ui/ file added
// tomorrow simply not scanned, which is a guard reporting green about work it never looked at.
const UI_DIR = path.join(ROOT, "ui");
const UI_FILES = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".js")).sort();
const UI_SRC = strip(UI_FILES.map((f) => fs.readFileSync(path.join(UI_DIR, f), "utf8")).join("\n;\n"));
ok(UI_FILES.length >= 3,
  "APPLIED — the ui/ population must hold the split files, or every negative assertion below is " +
  "satisfied by a scan that found nothing. Found: " + UI_FILES.join(", "), UI_FILES);
ok(/function buildMainDom/.test(UI_SRC) && /function renderQueuePanel/.test(UI_SRC),
  "APPLIED — the scanned population must CONTAIN the dispatchers this guard judges. A directory " +
  "that scanned to nothing looks exactly like a tree with nothing wrong");
const ACTIONS_CODE = strip(ACTIONS_SRC);

// ── THE CATALOG, READ OFF THE ADAPTER ────────────────────────────────────────────────────────
// Rows and the feature call each one wraps, both DERIVED from the source rather than listed here.
// A hand-written map would be a second copy of the catalogue, free to drift from it — and would
// go stale in the direction that matters: a row added tomorrow would simply not be checked, which
// is a guard reporting green about work it never looked at.
const ROWS = [...ACTIONS_CODE.matchAll(/"([a-z]+\.[a-zA-Z]+)":\s*\{[^}]*?run:\s*\([^)]*\)\s*=>\s*([A-Z][A-Za-z]*\.[a-zA-Z]+)/g)]
  .map((m) => ({ action: m[1], target: m[2] }));

const CATALOG_ACTIONS = [...ACTIONS_CODE.matchAll(/^\s*"([a-z]+\.[a-zA-Z]+)":\s*\{/gm)].map((m) => m[1]);

ok(CATALOG_ACTIONS.length > 0, "PREMISE: no catalog rows parsed out of features/actions.js — every "
  + "row below pins nothing", CATALOG_ACTIONS.length);
ok(ROWS.length === CATALOG_ACTIONS.length,
  "PREMISE: " + ROWS.length + " of " + CATALOG_ACTIONS.length + " rows yielded a feature target. A "
  + "row whose `run` this pattern cannot read is a row PART A silently skips, which is a guard "
  + "passing on the thing it was written to check",
  { parsed: ROWS.map((r) => r.action), all: CATALOG_ACTIONS });

// ═══ PART A — THE UI DOES NOT CALL WHAT A ROW ALREADY WRAPS ══════════════════════════════════
for (const row of ROWS) {
  const re = new RegExp("(^|[^.\\w])" + row.target.replace(".", "\\.") + "\\s*\\(", "m");
  ok(!re.test(UI_SRC),
    "PART A: a ui/ file calls `" + row.target + "(` directly, and `" + row.action + "` is a "
    + "catalog row that wraps exactly that. The adapter's re-check is then skipped, and the rule "
    + "and the act can reach the wire by two routes that disagree — which is what `_commitSetting` "
    + "was doing while ALSO asking `Actions.describe(\"room.settings\")` one function above. Use "
    + "`Actions.perform(\"" + row.action + "\", …)`",
    row);
}

// ═══ PART B — THE ARGS SURVIVE THE ADAPTER ═══════════════════════════════════════════════════
// THE TRAP THIS JOB ACTUALLY HIT, and it is the reason "uniformity only, no behaviour change"
// cannot be taken on trust. `room.upgrade`'s row read `run: () => RoomUpgrade.upgrade()` — no
// parameter — while the UI called `RoomUpgrade.upgrade(cb)` with a progress callback. Routing the
// button through `perform` without fixing the row would have dropped the callback silently: no
// throw, rooms still created, and the upgrade progress bar frozen at "Starting…" for the whole
// batch. A guard asserting only that `perform` reaches the feature would have passed on it.
//
// So the property is that what the CALLER passes arrives at the FEATURE, driven through the real
// adapter with a recording stub underneath.
{
  const calls = [];
  const rec = (name) => (...a) => { calls.push([name, a]); return Promise.resolve("ok"); };
  const state = { nowPlaying: null, rotation: [], settings: {} };

  const sb = loadInContext(
    ["backends/backend1/ranks.js", "backends/backend1/statederiver.js",
     "backends/backend1/capabilities.js", "features/actions.js"],
    {
      StreamManager: { getState: () => state },
      Room: { getMyId: () => "@me", getMyRank: () => 100, getMyAuthorityLevel: () => 100,
              setSettings: rec("Room.setSettings"), invite: rec("Room.invite") },
      RoomUpgrade: { upgrade: rec("RoomUpgrade.upgrade") },
      Queue: {}, Skip: {}, Reactions: {}, Chat: {}, Date,
    }
  );

  const marker = function progressCallback() {};
  return sb.Actions.perform("room.upgrade", { onProgress: marker }).then(() => {
    const c = calls.find((x) => x[0] === "RoomUpgrade.upgrade");
    ok(!!c, "PART B: `room.upgrade` did not reach `RoomUpgrade.upgrade` at all", calls);
    ok(c && c[1][0] === marker,
      "PART B: the progress callback did not survive `Actions.perform`. The UI renders the upgrade "
      + "bar from it, so dropping it freezes the bar at \"Starting…\" for the whole batch WITHOUT "
      + "throwing and without failing any other guard — a behaviour change hiding inside a routing "
      + "change. A row must be checked against its call site, not assumed to have been written for "
      + "one", c && c[1]);

    return sb.Actions.perform("room.settings", { partial: { maxLen: 300 } });
  }).then(() => {
    const c = calls.find((x) => x[0] === "Room.setSettings");
    ok(c && c[1][0] && c[1][0].maxLen === 300,
      "PART B: `room.settings` did not carry its partial through to `Room.setSettings`", c && c[1]);

    return sb.Actions.perform("room.invite", { userId: "@them:hs" });
  }).then(() => {
    const c = calls.find((x) => x[0] === "Room.invite");
    ok(c && c[1][0] === "@them:hs",
      "PART B: `room.invite` did not carry its userId through to `Room.invite`", c && c[1]);
    finish();
  }).catch((e) => {
    ok(false, "PART B threw: " + ((e && e.message) || e));
    finish();
  });
}

function finish() {

// ═══ PART C — THE ROWS WITH NO DISPATCHER HAVE NO UI CALL SITE EITHER ════════════════════════
// The other half of the one-directional rule, and the half that stops this guard being read as
// "wrap everything". These five rows are reached by `features/userqueue.js`'s reconcile loop —
// feature to feature — and by no button. Asserting the ABSENCE both ways is what makes them
// distinguishable from a bypass: a bypassed row has a UI call site, these have none by either
// route, so the correct answer for them is to leave them alone.
//
// If one of these ever gains a dispatcher, this row goes red and asks the question out loud —
// because routing the Join button at `dj.join` would post a bare `ddjp.dj.join` and skip
// `UserQueue`'s intent list, which is a behaviour change rather than uniformity.
const dyn = [...UI_SRC.matchAll(/action:\s*"([a-z]+\.[a-zA-Z]+)"/g)].map((m) => m[1]);
const undispatched = CATALOG_ACTIONS.filter((a) =>
  !UI_SRC.includes('Actions.perform("' + a + '"') && dyn.indexOf(a) < 0);

const EXPECTED = ["dj.join", "dj.leave", "dj.declare", "dj.undeclare", "dj.order"];
ok(undispatched.slice().sort().join(",") === EXPECTED.slice().sort().join(","),
  "PART C: the set of catalog rows with no UI dispatcher has changed. If a row LOST its "
  + "dispatcher, a button has gone around the adapter and PART A should say which. If a row GAINED "
  + "one, check it is not the rotation path: the Join button edits `UserQueue`'s local intent and "
  + "the reconcile loop authors the events, so dispatching at `dj.join` posts a bare join and "
  + "skips the intent list", { found: undispatched, expected: EXPECTED });

// AND THE REASON THEY ARE SILENT: no UI call site by ANY route, not merely no `perform`. Without
// this the row above would also pass for a button calling `Queue.join()` directly — the exact
// bypass PART A exists for, hiding inside the allow-list.
for (const row of ROWS) {
  if (EXPECTED.indexOf(row.action) < 0) continue;
  const re = new RegExp("(^|[^.\\w])" + row.target.replace(".", "\\.") + "\\s*\\(", "m");
  ok(!re.test(UI_SRC),
    "PART C: `" + row.action + "` is on the no-dispatcher list AND `ui/` calls `" + row.target
    + "(` directly. That is a bypass wearing an allow-list entry — the two readings need opposite "
    + "fixes, so the absence is asserted rather than inherited from PART C's set", row);
}

// ═══ PART D — A ROUTED DISPATCH SETTLES SOMEWHERE ════════════════════════════════════════════
// FOUND BY AUDITING THIS JOB, not by design. `Room.setSettings` RESOLVES `{ ok: false, reason }`
// for a refusal; `Actions.perform` REJECTS when the descriptor is not enabled. So routing a call
// changes the failure MODE, and `_commitSetting`'s nine callers were written against a promise
// that always settles — leaving a rare but real race (the descriptor was read a moment before the
// re-check, and a rank can move in between) to surface as an unhandled rejection in the console.
//
// The rule is deliberately narrow, because a wide one here would be a regex pretending to
// understand control flow: a `perform` in STATEMENT POSITION — nothing done with the promise it
// returns — cannot handle a rejection by construction. Anything returned, awaited or chained is
// left alone, since where its handler sits is a question this scan cannot answer honestly.
// ── THE FIRST VERSION OF THIS PART CRIED WOLF, AND THAT IS WHY IT READS THE STATEMENT ───────
// It flagged any LINE beginning `Actions.perform(` — which caught both of the correctly-chained
// sites, one of them pre-existing and untouched by this job, because their `.then` / `.catch` sits
// on the NEXT line. `doc-xrefs` records the standard plainly: a guard firing at that rate gets
// disabled, so a rule that cannot tell a wolf from a sheep is worse than no rule. The call's
// parentheses are balanced and the character that FOLLOWS is read, which is the only thing that
// actually distinguishes a chained promise from a dropped one.
{
  const bare = [];
  for (let i = UI_SRC.indexOf("Actions.perform"); i >= 0; i = UI_SRC.indexOf("Actions.perform", i + 1)) {
    // A CALL, NOT A MENTION. `if (Actions.perform)` is a typeof-style existence check and the
    // first version counted it as a dispatch, which is the same not-a-call confusion
    // `check-rank-injection` strips comments to avoid.
    const rest = UI_SRC.slice(i + "Actions.perform".length);
    if (!/^\s*\(/.test(rest)) continue;
    const open = UI_SRC.indexOf("(", i);
    if (open < 0) continue;
    let depth = 0, end = -1;
    for (let j = open; j < UI_SRC.length; j++) {
      if (UI_SRC[j] === "(") depth++;
      else if (UI_SRC[j] === ")") { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const after = UI_SRC.slice(end + 1).replace(/^\s+/, "")[0];
    if (after === ".") continue;                      // chained — .then / .catch
    const before = UI_SRC.slice(Math.max(0, i - 40), i);
    // `=>` IS A RETURN. A concise arrow body hands the promise to its caller exactly as `return`
    // does, and the first version missed it — flagging three correct sites where the promise is
    // handed to `_lockThen`. Listed before the bare `=` so the fat arrow is not read as assignment.
    if (/(=>|return|await|=|\(|,|:)\s*$/.test(before)) continue;   // returned, awaited, assigned, passed
    const line = UI_SRC.slice(0, i).split("\n").length;
    bare.push({ line: line, text: UI_SRC.slice(i, Math.min(end + 2, i + 90)).replace(/\s+/g, " ") });
  }
  ok(bare.length === 0,
    "PART D: `Actions.perform(` is called in statement position, so nothing can handle its "
    + "rejection. `perform` REJECTS a refused dispatch where a direct feature call typically "
    + "RESOLVES a verdict object — so a routed click that loses the re-check becomes an unhandled "
    + "rejection instead of a reported refusal. Return it, await it inside a try, or chain a "
    + "`.catch`", bare);
}

if (failed) process.exit(1);
console.log("[action-routing] PASS — a catalog row that exists is the route the UI takes (" + A
  + " assertions). J31 was filed as \"buttons with no permission rule call their feature directly\", "
  + "and MEASUREMENT changed the job TWICE. First: the acts actually going around "
  + "the adapter all HAVE rules, so the entry's premise was wrong — `_commitSetting` and the "
  + "roster's rank picker each asked `Actions.describe` for the RULE and then dispatched past the "
  + "adapter that holds it, one act reaching the wire by two routes. Second: reading found THREE "
  + "(`room.settings`, `room.invite`, `room.upgrade`) and this guard, run for the first time, found "
  + "TWO MORE — `rank.assign` and `chat.dm`, both of which were ALREADY dispatched correctly from "
  + "the user card, so a second unrouted path existed beside a routed one. **That is the argument "
  + "for deriving the rule instead of fixing the sites a reading turned up.** PART A derives each row's feature target from `features/actions.js` rather than "
  + "listing it, so a row added tomorrow is checked without an edit here, and refuses any direct "
  + "call to it from `ui/`. PART B drives the ARGS through the real adapter, which is the trap this "
  + "job hit: `room.upgrade`'s row took no parameter while the UI passed a progress callback, so "
  + "routing it unfixed would have frozen the upgrade bar for a whole batch without throwing or "
  + "failing anything else — a behaviour change inside a change filed as having none. PART C pins "
  + "the five rows that must NOT gain a dispatcher, because the UI reaches those acts through "
  + "`UserQueue`'s local intent and its reconcile loop, and asserts they have no UI call site by "
  + "EITHER route so a bypass cannot hide inside the allow-list. PART D came out of AUDITING this "
  + "job rather than designing it: `Room.setSettings` RESOLVES a refusal verdict while "
  + "`Actions.perform` REJECTS one, so routing changes the failure MODE under callers written for "
  + "the old one — and a `perform` in statement position cannot handle a rejection by "
  + "construction. Its first two versions CRIED WOLF (a line-based rule flagged correctly-chained "
  + "multi-line sites; then an identifier match read `if (Actions.perform)` as a call and a "
  + "concise arrow body as a dropped promise), which `doc-xrefs` names as the failure that gets a "
  + "guard disabled — so it balances the call\u0027s parens and reads the character that follows. "
  + "It then found ONE genuine site this job never touched");
process.exit(0);
}
