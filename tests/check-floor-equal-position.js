// tests/check-floor-equal-position.js
// WALL: WHAT A FLOOR AT THE SAME POSITION AS THE TRUSTED ONE DOES.
//
// ── WHY THIS EXISTS: TWO J39 SURVIVORS, ONE QUESTION ────────────────────────────────────────
// `adopt`  — `if (_trusted && _pos(f) <= _pos(_trusted)) return false;`
// `revalidate` — `if (_pos(f) < _pos(_trusted)) return _weakened("replaced-by-older");`
//
// Flipping either leaves the whole suite green. **They are the same question asked twice: what
// happens at an EQUAL position.** `adopt` refuses it as "not an improvement"; `revalidate` does NOT
// call it "replaced-by-older". One `<=` and one `<`, and the equal case is the only input where a
// flip changes anything — driven before writing this, because J39's B02 looked like the most
// dangerous survivor and turned out INERT.
//
// ── THE SHAPE, STATED PLAINLY: SEVENTEEN GUARDS AND NOT ONE VARIES THE BOUNDARY ────────────
// `adopt` is named by seventeen guards. **None constructs two floors at the same `floorL`**, so
// none can tell `<=` from `<`. That is the axis-never-varied shape at scale: coverage measured by
// how many guards TOUCH a function says nothing about whether any of them VARIES the thing that
// decides. It will be true elsewhere in the 831 sites pass 2 and 3 have left.

const path = require("path");
const { loadInContext } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[floor-equal-position] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

function floorTree() {
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/floor.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
       window: {}, document: { body: { appendChild() {} } },
       localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
       StreamManager: { getLog: () => [], getState: () => ({ settings: {} }) } });
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Floor.attach({ log: () => [], settings: () => ({}),
                    myRank: () => 99, trimmed: () => false });
  return sb;
}

const POS = 40;
function floorAt(l, h) {
  return { n: 3, prev: null, seed: { members: {}, settings: {} }, h: h,
           covers: "$a..$b", floorL: l, thin: false };
}

// ═══ `adopt` AT AN EQUAL POSITION ═══════════════════════════════════════════════════════════
{
  const sb = floorTree();
  const Floor = sb.Floor;
  const held = floorAt(POS, "$held");
  Floor._setTrustedForTest(held);

  // THE PREMISE. Without it every row below is about a client with no trusted floor, where the
  // comparison is skipped entirely — the shape that has taken several rows this month.
  const cur = Floor.current();
  ok(cur && cur.floorL === POS,
    "APPLIED — the client must already hold a trusted floor at the position under test, or " +
    "`adopt`'s comparison never runs", cur);

  const same = floorAt(POS, "$same");
  ok(same.floorL === held.floorL && same.h !== held.h,
    "APPLIED — and the candidate must sit at the SAME position with a DIFFERENT identity, which " +
    "is the only input where `<=` and `<` differ", { at: same.floorL, a: held.h, b: same.h });

  const took = Floor.adopt({ floor: same, tier: 0 }, true);
  ok(took === false,
    "A FLOOR AT THE SAME POSITION IS REFUSED. `<=` means 'not an improvement' — a floor that " +
    "banks nothing further is not worth churning the trusted one for, and adopting it would let " +
    "two peers at one cut swap the room's floor back and forth forever. Flipping to `<` admits it " +
    "and the whole suite stays green", took);
  ok(Floor.current().h === held.h,
    "and the held floor is UNCHANGED — the refusal is a decision, not a silent replacement",
    Floor.current().h);

  // THE CONTROL: a HIGHER position is still adopted, so the refusal above is about equality
  // rather than about a function that refuses everything.
  const higher = floorAt(POS + 5, "$higher");
  ok(Floor.adopt({ floor: higher, tier: 0 }, true) === true,
    "control: a floor strictly ABOVE is adopted, so `adopt` discriminates rather than refusing " +
    "every candidate", Floor.current().floorL);
  ok(Floor.current().floorL === POS + 5,
    "control: and it becomes the trusted one", Floor.current().floorL);
}

// ═══ `revalidate` AT AN EQUAL POSITION ══════════════════════════════════════════════════════
// The sibling comparison, one function down and one operator different. A floor at the same
// position must NOT be called `replaced-by-older` — it has not been replaced by anything older;
// it is the same cut seen twice.
{
  const sb = floorTree();
  const Floor = sb.Floor;
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "backends/backend1/floor.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

  ok(/_pos\(f\) < _pos\(_trusted\)\) \{/.test(src),
    "B: APPLIED — the `replaced-by-older` comparison must be findable, or the claim below is " +
    "about a line that is not there. (Shape updated at v321: J54 turned the single-statement " +
    "`return _weakened(...)` into a BLOCK, because a client that still holds everything now " +
    "RETREATS to the older floor rather than being weakened by it. The operator this file exists " +
    "to pin is untouched — only what follows it changed.)", "not found");
  ok(!/_pos\(f\) <= _pos\(_trusted\)\) \{/.test(src),
    "B: IT IS STRICTLY `<`, NOT `<=`. An equal position has not been replaced by anything OLDER — " +
    "it is the same cut seen twice, and weakening the floor for it would demote a client for " +
    "agreeing with itself. The two comparisons are deliberately different operators on the same " +
    "question, and neither was guarded until now", "uses <=");

  // AND THE TWO ARE READ TOGETHER, so a later edit that "harmonises" them fails here.
  ok(/_pos\(f\) <= _pos\(_trusted\)\) return false/.test(src),
    "B: while `adopt` is `<=` — the pair is asymmetric ON PURPOSE. `adopt` asks *is this better*, " +
    "`revalidate` asks *has this got worse*, and equality answers no to both", "adopt changed");
}

console.log("[floor-equal-position] PASS — what a floor at the same position as the trusted one " +
  "does (" + asserts + " assertions). **TWO J39 SURVIVORS, ONE QUESTION.** `adopt`'s `<=` and " +
  "`revalidate`'s `<` differ only at an EQUAL position, and flipping either left the suite green. " +
  "`adopt` REFUSES equality (not an improvement — otherwise two peers at one cut swap the floor " +
  "forever); `revalidate` does NOT weaken on it (nothing older has replaced anything — it is the " +
  "same cut seen twice). **The pair is asymmetric on purpose and both directions are now pinned.** " +
  "Seventeen guards name `adopt` and NONE constructs two floors at one `floorL` — coverage " +
  "measured by how many guards TOUCH a function says nothing about whether any VARIES what decides");
