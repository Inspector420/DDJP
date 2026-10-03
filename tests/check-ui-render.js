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
//   or is called ONLY from the dispatcher that just cleared it.
//
// Note what this does NOT flag, deliberately: helpers that append a single row (the setting-row
// builders, `_appendLogRow`) are correct — their parent clears once and they append many times.
// The distinguishing property here is "renders a whole panel into a container someone else owns".

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "ui", "shell.js");
// ── READ AS THE ui/ POPULATION, NOT AS ONE FILE (widened at ddjp_388) ────────────────────────
// THE SECOND WIDENING RECORDED AS A PRECONDITION, AND IT ALSO ARRIVED EARLY — at ui/queue.js
// rather than at a cluster that builds controls. `renderQueuePanel` moved there at ddjp_388 and
// this guard refused loudly rather than passing on an empty dispatcher set, which is the only
// reason it is a re-point and not a silent hole.
//
// ── AND THE CALLER HALF IS NOW WEAKER ACROSS FILES. MEASURED, NOT ASSUMED ────────────────────
// Driven at ddjp_388: a dispatched renderer called from another ui/ file as `QueuePanels.render…()`
// does NOT turn this guard red, because the caller scan matches BARE names and a cross-file call
// is a member expression. So widening the population fixed the dispatcher half and did not fix
// this half. It is written down rather than left for a later session to discover as a silent
// hole, and it is the next thing to fix in this guard — the fix is to match `<Global>.name(` as
// well as `name(`, and it needs the ten globals to exist before it can be written honestly.
//
// AND THE CALLER HALF WAS THE REAL RISK. This guard asserts no dispatched renderer is called from
// OUTSIDE the dispatcher. That scan walked the top-level functions of ONE file, so a caller that
// moved to another ui/ file would have satisfied the rule BY BEING INVISIBLE — the count going to
// zero because the caller left rather than because none exists. Over the population it cannot.
const UI_DIR = path.join(__dirname, "..", "ui");
const UI_FILES = fs.readdirSync(UI_DIR).filter((f) => f.endsWith(".js")).sort();
const src = UI_FILES.map((f) => fs.readFileSync(path.join(UI_DIR, f), "utf8")).join("\n;\n");

// ── THE CALLER HALF IS FIXED AT ddjp_397, AND IT WAITED FOR THE TENTH GLOBAL ON PURPOSE ──────
// The deferral was the point: matching `<Global>.name(` against six of ten globals would have
// pinned a PARTIAL set and read as complete — the shape a later session trusts and does not
// re-derive. The ten exist now, so the set is closed and the match below is honest.
// The globals are read from KNOWN_GLOBALS rather than listed here: a list in this file would be
// a second copy of the decision, free to drift from the one `check-ui-files` pins.
const { knownGlobals } = require("../tools/lint-globals.js");
const UI_GLOBALS = knownGlobals().filter((g) => UI_FILES.some((f) =>
  new RegExp("^const " + g + " = \\(\\(\\) =>", "m").test(fs.readFileSync(path.join(UI_DIR, f), "utf8"))));
assert.ok(UI_GLOBALS.length >= 8,
  "APPLIED - the ui/ globals must be derivable from KNOWN_GLOBALS, or the member-call match below " +
  "recognises nothing and this half is exactly as blind as it was before. Found: " + UI_GLOBALS.join(", "));
const MEMBER = new RegExp("(?:" + UI_GLOBALS.join("|") + ")\\.(\\w+)\\s*\\(", "g");

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

console.log("[ui-render] PASS — the shared queue container is cleared by its dispatcher, and every " +
  "panel renderer that appends into it either clears the container itself or is reachable only " +
  "from that dispatcher; renderRoomQueue specifically clears, because the strike-cooldown timer " +
  "repaints it directly and used to duplicate the whole list three seconds after a ✕🎵");
