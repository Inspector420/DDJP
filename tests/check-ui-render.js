// tests/check-ui-render.js
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

const SRC = path.join(__dirname, "..", "ui", "interface.js");
const src = fs.readFileSync(SRC, "utf8");
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

assert.ok(FN[DISPATCHER], "expected a " + DISPATCHER + "() in ui/interface.js — if it was renamed, " +
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
