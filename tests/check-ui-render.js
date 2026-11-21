// tests/check-ui-render.js
// SUBJECT: ui/
// WALL: A PANEL RENDERER MUST NOT PAINT ON TOP OF ITSELF.
//
// `refs.queueBody` is one container shared by four tab panels (room queue / my queue / history /
// playlists). `renderQueuePanel` clears it and dispatches to whichever renderer matches the active
// tab. The renderers themselves only APPEND.
//
// That is fine while the dispatcher is the only caller. It stopped being true: the strike-cooldown
// timer (`_scheduleRoomqRerender`, armed whenever a ✕🎵 strike puts a DJ in its 3-second advisory
// cooldown) called `renderRoomQueue()` DIRECTLY. Three seconds after a strike, the entire room
// queue was painted a second time — and again on the next strike. It read as a random duplication
// precisely because the repaint was detached from the click that caused it.
//
// The fix is to make the renderer safe from ANY call site rather than trusting every future caller
// to remember, so `renderRoomQueue` now clears first. This guard locks the general rule:
//
//   a panel renderer either CLEARS the shared container itself,
//   or is called ONLY from the dispatcher that just cleared it,
//   or — a PART of a panel, redrawn under the rest of it — REMOVES the part it replaces before drawing it again.
//
// THE THIRD CLAUSE, AND WHY (J130, `ddjp_654`). The owner decided the lists redraw only when what they show changed, and
// that My queue redraws ONLY ITS LIST, so a link being typed in the add line above it, the focus and the "Added" note
// survive. That list is drawn into this container by `_renderMyList`, reached from the panel's own renderer (after the
// dispatcher's clear) and from `_redrawMyList` — which no clear precedes. A part redraw that appended without removing what
// it replaces would draw a second list under the first, this guard's original defect in a new place. So `_redrawMyList`
// removes the list on screen first, and `_renderMyList` has exactly those two callers. (Driven by `check-queue-redraw` C:
// each redraw takes away the window it replaces and builds one.)
//
// Note what this does NOT flag, deliberately: helpers that append a single row (the setting-row
// builders, `_appendLogRow`) are correct — their parent clears once and they append many times.
// The distinguishing property here is "renders a whole panel into a container someone else owns".

const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ── READ AS THE ui/ POPULATION, NOT AS ONE FILE (widened at ddjp_388) ────────────────────────
// THE SECOND WIDENING RECORDED AS A PRECONDITION, AND IT ALSO ARRIVED EARLY — at ui/queue.js
// rather than at a cluster that builds controls. `renderQueuePanel` moved there at ddjp_388 and
// this guard refused loudly rather than passing on an empty dispatcher set, which is the only
// reason it is a re-point and not a silent hole.
//
// ── THE CALLER HALF ACROSS FILES: MEASURED WEAKER AT ddjp_388, AND IT IS NOT NOW ─────────────
// Driven at ddjp_388: a dispatched renderer called from another ui/ file as `QueuePanels.render…()`
// did NOT turn this guard red, the caller scan then matching BARE names only, and a `<Global>.name(`
// match was planned. Driven again at J107: the scan below, `\bname\s*\(`, matches a member call
// too — `\b` holds after the dot — so `Panels.renderHistory()` called from `ui/shell.js` turns this
// guard red exactly as a bare `renderHistory()` does.
//
// AND THE CALLER HALF WAS THE REAL RISK. This guard asserts no dispatched renderer is called from
// OUTSIDE the dispatcher. That scan walked the top-level functions of ONE file, so a caller that
// moved to another ui/ file would have satisfied the rule BY BEING INVISIBLE — the count going to
// zero because the caller left rather than because none exists. Over the population it cannot.
const UI_DIR = path.join(__dirname, "..", "ui");
const UI_FILES = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".js")).sort();
const src = UI_FILES.map((f) => fs.readFileSync(path.join(UI_DIR, f), "utf8")).join("\n;\n");

// ── THE ui/ GLOBALS, DERIVED ─────────────────────────────────────────────────────────────────
// A `<Global>.name(` matcher was built from them at ddjp_397, waiting for the tenth global so it would not pin a partial
// set. It was never used: the bare-name scan below already sees a member call (J107, above), so it went. The globals are
// still derived and their count checked. They are read from KNOWN_GLOBALS rather than listed here: a list in this file
// would be a second copy of the decision, free to drift from the one `check-ui-files` pins.
const { knownGlobals } = require("../tools/lint-globals.js");
const UI_GLOBALS = knownGlobals().filter((g) => UI_FILES.some((f) =>
  new RegExp("^const " + g + " = \\(\\(\\) =>", "m").test(fs.readFileSync(path.join(UI_DIR, f), "utf8"))));
assert.ok(UI_GLOBALS.length >= 8,
  "APPLIED - the ui/ globals must be derivable from KNOWN_GLOBALS (`check-ui-files` pins the same list); fewer than " +
  "eight means that derivation broke. Found: " + UI_GLOBALS.join(", "));

assert.ok(UI_FILES.length >= 3,
  "APPLIED — the ui/ population must hold the split files, or the dispatcher scan below is a scan " +
  "of nothing. Found: " + UI_FILES.join(", "));
const lines = src.split("\n");

const CONTAINER = "refs.queueBody";
const DISPATCHER = "renderQueuePanel";

// ---- extract every top-level function body by brace matching -------------------
function functions() {
  const out = {};
  for (let i = 0; i < lines.length; i++) {
    const m = /^  (?:async )?function ([A-Za-z_0-9]+)\s*\(/.exec(lines[i]);
    if (!m) continue;
    let depth = 0, started = false, end = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === "{") { depth++; started = true; } else if (ch === "}") depth--; }
      if (started && depth <= 0) { end = j; break; }
    }
    out[m[1]] = { start: i + 1, end: end + 1, body: lines.slice(i, end + 1).join("\n") };
  }
  return out;
}
const FN = functions();

assert.ok(FN[DISPATCHER], "expected a " + DISPATCHER + "() somewhere in ui/ — if it was renamed, " +
  "update this guard rather than deleting it: the invariant it protects still applies");
assert.ok(FN[DISPATCHER].body.indexOf("clear(" + CONTAINER + ")") >= 0,
  DISPATCHER + " must clear " + CONTAINER + " before dispatching to a panel renderer");

// ---- which renderers does the dispatcher hand off to? --------------------------
const dispatched = Object.keys(FN).filter((n) =>
  n !== DISPATCHER && new RegExp("\\b" + n + "\\s*\\(").test(FN[DISPATCHER].body));
assert.ok(dispatched.length >= 3,
  "expected the dispatcher to hand off to several panel renderers; found: " + dispatched.join(", "));

// ---- the invariant ------------------------------------------------------------
for (const name of dispatched) {
  const fn = FN[name];
  if (fn.body.indexOf(CONTAINER + ".appendChild") < 0 &&
      fn.body.indexOf(CONTAINER + ".append") < 0) continue;   // doesn't write there — not our concern

  const clearsItself = fn.body.indexOf("clear(" + CONTAINER + ")") >= 0;

  // every call site of this renderer, outside its own body and outside the dispatcher
  const callers = [];
  for (const other of Object.keys(FN)) {
    if (other === name) continue;
    if (new RegExp("\\b" + name + "\\s*\\(").test(FN[other].body)) callers.push(other);
  }
  const outsideDispatcher = callers.filter((c) => c !== DISPATCHER);

  if (!clearsItself) {
    assert.strictEqual(outsideDispatcher.length, 0,
      name + "() appends into " + CONTAINER + " without clearing it, and is called from [" +
      outsideDispatcher.join(", ") + "] as well as " + DISPATCHER + ". Any caller that has not " +
      "just cleared will paint a SECOND copy of the whole panel on top of the first. Either clear " +
      "at the top of " + name + " (preferred — it makes the renderer safe from every call site), " +
      "or route that caller through " + DISPATCHER + ".");
  }
}

// ---- the specific regression, pinned ------------------------------------------
(() => {
  const rq = FN["renderRoomQueue"];
  assert.ok(rq, "renderRoomQueue() not found");
  assert.ok(rq.body.indexOf("clear(" + CONTAINER + ")") >= 0,
    "renderRoomQueue must clear " + CONTAINER + " at the top. It has a second call site — the " +
    "strike-cooldown timer in _scheduleRoomqRerender — which does NOT go through " + DISPATCHER +
    ". Without the clear, striking a song duplicates the entire room queue about three seconds later.");

  const sched = FN["_scheduleRoomqRerender"];
  if (sched) {
    assert.ok(/renderRoomQueue\s*\(|renderQueuePanel\s*\(/.test(sched.body),
      "_scheduleRoomqRerender should still repaint the room queue when its cooldown lapses");
  }
})();

// ---- a PART redraw removes what it replaces (J130) ----------------------------
(() => {
  const part = FN["_redrawMyList"], list = FN["_renderMyList"];
  assert.ok(part && list, "expected My queue's list renderer `_renderMyList` and its part redraw `_redrawMyList` in ui/ " +
    "(J130) — if they were renamed, update this guard: a part drawn into the shared container without the dispatcher's clear " +
    "must remove what it replaces");
  const callers = Object.keys(FN).filter((n) => n !== "_renderMyList" && /\b_renderMyList\s*\(/.test(FN[n].body)).sort();
  assert.deepStrictEqual(callers, ["_redrawMyList", "renderMyQueue"],
    "`_renderMyList` draws My queue's list into " + CONTAINER + " and must be reached only from `renderMyQueue` (after the " +
    "dispatcher's clear) and `_redrawMyList` (after it removes the list on screen). Found callers: " + callers.join(", "));
  const rm = part.body.indexOf("_uqList.remove()"), draw = part.body.indexOf("_renderMyList(");
  assert.ok(rm >= 0 && draw > rm,
    "`_redrawMyList` must REMOVE the list on screen before drawing it again — without that, a redraw under the add line " +
    "draws a second list under the first");
})();

console.log("[ui-render] PASS — the shared queue container is cleared by its dispatcher, and every " +
  "panel renderer that appends into it either clears the container itself or is reachable only " +
  "from that dispatcher; renderRoomQueue specifically clears, because the strike-cooldown timer " +
  "repaints it directly and used to duplicate the whole list three seconds after a ✕🎵; and My queue's " +
  "list, redrawn under its add line (J130), removes the list it replaces before drawing it again");
