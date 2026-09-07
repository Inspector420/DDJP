// tests/check-control-styling.js
// WALL: EVERY INTERACTIVE ELEMENT THE PANEL BUILDS IS STYLED BY SOMETHING THE STYLESHEET DECLARES.
//
// ── WHY THIS EXISTS: THREE UNSTYLED CONTROLS SHIPPED IN FIVE PACKAGES ───────────────────────
// `.dm-input` (v269), `.room-item-main` (v270, introduced by a row restructure) and
// `.delegation-rank` (v262) all rendered as browser-default chrome on a dark panel, and **no
// guard could see any of them.** `check-visual-reuse` asserts that PRECEDENTS ARE REUSED, which
// is a claim about controls that borrow — **a control reusing nothing is invisible to a reuse
// check.** That is the blind spot beside the one that guard already declares.
//
// ── THE PROPERTY, AND WHY IT IS NOT "CARRIES A CLASS" ───────────────────────────────────────
// A class-only rule would flag SIX buttons that are perfectly well styled by
// `.chat-input-row button` and `.uq-add button`. **A guard that cries wolf six times out of
// thirteen gets disabled, and that is worse than not having it.** So the property is *styled by
// something declared* — its own class OR an ancestor rule that reaches it. `.delegation-rank`
// fails that; the six buttons pass it.
//
// ── WHAT THE SWEEP FOUND, AND HOW IT WAS NEARLY MIS-MEASURED TWICE ─────────────────────────
// Thirteen controls carry no declared class of their own. Six are ancestor-styled and fine; one
// was the reported defect; six are native checkboxes and file inputs, EXEMPT WITH A REASON below.
//
// Both wrong instruments are worth naming, because the next person writing a sweep reaches for
// them: a PER-LINE scan reported fifteen, because `el("button", {` attribute objects span lines
// and a line-scoped regex sees a class key that is not there; and a grep for a bare `select {}`
// rule matched `user-select: all`, which briefly made the delegation dropdowns look covered.
// Both corrected by driving the parse rather than reading the output.

const fs = require("fs");
const path = require("path");

let asserts = 0;
function fail(msg, got) {
  console.log("[control-styling] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const src = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
const code = src.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

// ── THE STYLESHEET, PARSED AS SELECTORS RATHER THAN GREPPED ────────────────────────────────
// A grep for `.name` matches inside comments, inside values (`user-select: all`) and inside
// property names. Selectors are read from the head of each rule instead.
const styleBlocks = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
ok(styleBlocks.length > 0, "APPLIED — the document must carry a stylesheet to read", styleBlocks.length);
const sheet = styleBlocks.join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

const selectors = [];
{
  let i = 0;
  while (i < sheet.length) {
    const open = sheet.indexOf("{", i);
    if (open < 0) break;
    const close = sheet.indexOf("}", open);
    if (close < 0) break;
    const head = sheet.slice(i, open).trim();
    if (head && head.indexOf("@") !== 0) {
      for (const sel of head.split(",")) if (sel.trim()) selectors.push(sel.trim());
    }
    i = close + 1;
  }
}
ok(selectors.length > 100,
  "APPLIED — the selector parse must find the stylesheet's rules, or every control below looks " +
  "unstyled and the sweep reports the file rather than the code", selectors.length);

// A class is DECLARED if some selector's final segment names it.
const declaredClasses = new Set();
// An ancestor rule is `<something> tag` — a bare tag as the LAST segment, scoped by what precedes.
const ancestorRules = new Map();        // "ancestorClass tag" -> selector
for (const sel of selectors) {
  for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) declaredClasses.add(m[1]);
  // ── AN ANCESTOR RULE IS `<ancestor-class> <tag>`, AND THE ANCESTOR IS PART OF IT ──────────
  // The first version keyed these by TAG ALONE, so a single `.chat-input-row button` rule
  // exempted EVERY button in the file — the wolf-crying fix overcorrected into never barking, and
  // both real defects passed. Driven: removing `rank-select` from the delegation dropdowns and
  // deleting `.room-item-main`'s rule both stayed green. The ancestor is now part of the key.
  const segs = sel.split(/[\s>]+/).filter(Boolean);
  // PSEUDO-CLASSES AND ATTRIBUTE FILTERS ARE STRIPPED FROM THE TAG. `.uq-add button:not(
  // .panel-lock-btn)` styles the buttons in that row, and reading its last segment literally made
  // four of them look uncovered — a false positive, which is the exact failure mode this guard was
  // shaped to avoid. `:not(...)` narrows which buttons the rule reaches, and the ones it excludes
  // carry their own class, so they are caught by the class branch anyway.
  const last = (segs[segs.length - 1] || "").replace(/[:\[].*$/, "");
  const prev = segs[segs.length - 2];
  if (segs.length > 1 && /^[a-z]+$/.test(last) && prev && prev.indexOf(".") === 0) {
    const key = prev.slice(1).split(".")[0] + " " + last;
    if (!ancestorRules.has(key)) ancestorRules.set(key, sel);
  }
}
ok(declaredClasses.size > 200,
  "APPLIED — and to find the classes in them", declaredClasses.size);
ok([...ancestorRules.keys()].some((k) => k.endsWith(" button")),
  "APPLIED — the sheet must contain at least one ancestor-scoped tag rule, or 'ancestor coverage' " +
  "is a category with no members and this guard is a class-only rule wearing a longer name",
  [...ancestorRules.keys()]);

// ── EXEMPTIONS: NATIVE CONTROLS, EACH WITH ITS REASON ──────────────────────────────────────
// **An exemption without a reason beside it is how a list of six becomes a list of twenty.** Each
// entry names WHY the browser's own rendering is the right answer, and the guard asserts the list
// is EXHAUSTED — an exemption for a control that no longer exists fails, so the list cannot grow
// stale, and a new native control is CAUGHT rather than joining it silently.
const NATIVE_EXEMPT = {
  "input:checkbox": "a checkbox is one of the few controls whose native rendering is universally " +
    "understood and whose themed versions are routinely worse — a styled checkbox has to " +
    "re-implement the indeterminate state, the focus ring and the keyboard toggle. Left native " +
    "DELIBERATELY, not overlooked.",
  "input:file": "a file picker cannot be styled at all in any portable way — the button inside it " +
    "is UA chrome and `::file-selector-button` support is uneven. The surrounding row is themed; " +
    "the picker itself is the browser's.",
};

// ── THE SWEEP ───────────────────────────────────────────────────────────────────────────────
// ── EVERY ELEMENT WITH A CLASS, NOT JUST THE INTERACTIVE ONES (v274) ────────────────────────
// This guard shipped asserting that every INTERACTIVE element is styled by something declared —
// and the delegation table then shipped with three undeclared classes (`setting-row`,
// `setting-label`, `setting-delegation`) on the `div`s laying it out. **The select inside them was
// correctly themed and the guard passed.** A control can be styled while the row around it is not,
// which is the same blind spot one layer out: the previous widening asked *is this control
// styled*, and the answer said nothing about the box holding it.
//
// The population is now every element the panel builds WITH A CLASS. Naming a class is a claim
// that the stylesheet says something about it; a class the sheet has never heard of is a claim
// about nothing, and the element renders as whatever its tag defaults to.
//
// Elements built with NO class are outside this: a `<span>` with no class claims nothing, and
// demanding one would be ceremony rather than a defect. The interactive tags are checked whether
// or not they carry a class, because a bare `<select>` IS a defect.
const TAGS = ["button", "select", "input", "textarea"];
const CLASSED_TAGS = ["div", "span", "p", "h2", "h3", "label", "ul", "li", "img"];
const findings = [];
for (const tag of TAGS.concat(CLASSED_TAGS)) {
  const interactive = TAGS.indexOf(tag) >= 0;
  const needle = 'el("' + tag + '"';
  let i = code.indexOf(needle);
  while (i >= 0) {
    const line = code.slice(0, i).split("\n").length;
    let cls = null, type = null;
    if (code.slice(i + needle.length, i + needle.length + 3) === ", {") {
      // BRACE-MATCHED, because attribute objects span lines and a line-scoped regex reports a
      // missing class key that is simply on another line — the first wrong instrument.
      let d = 0, j = code.indexOf("{", i + needle.length), end = j;
      for (let k = j; k < code.length; k++) {
        if (code[k] === "{") d++;
        else if (code[k] === "}") { d--; if (!d) { end = k; break; } }
      }
      const attrs = code.slice(j, end + 1);
      const cm = attrs.match(/class:\s*"([^"]*)"/) || attrs.match(/class:\s*([^,\n]+)/);
      if (cm) cls = cm[1].trim();
      const tm = attrs.match(/type:\s*"([^"]*)"/);
      if (tm) type = tm[1];
    }
    // THE NEAREST PRECEDING CONTAINER CLASS. `el("div", { class: "uq-add" }, [input, el("button"
    // …)])` puts the button inside `.uq-add`, and that is the ancestor a `.uq-add button` rule
    // names. Read from the 240 characters before the control, which spans the enclosing `el(`
    // call without reaching the previous statement.
    const before = code.slice(Math.max(0, i - 240), i);
    const cm2 = [...before.matchAll(/class:\s*"([\w\s-]+)"/g)];
    const container = cm2.length ? cm2[cm2.length - 1][1].split(/\s+/) : [];
    // A NON-INTERACTIVE ELEMENT WITH NO CLASS CLAIMS NOTHING AND IS NOT A FINDING.
    if (!interactive && !cls) { i = code.indexOf(needle, i + 1); continue; }
    findings.push({ tag, type, cls, line, container, interactive: interactive });
    i = code.indexOf(needle, i + 1);
  }
}
ok(findings.length > 40,
  "APPLIED — the sweep must find the panel's controls, or an empty defect list means the scan " +
  "missed rather than that the code is clean", findings.length);

const usedExempt = new Set();
const unstyled = [];
let comparedNonInteractive = 0;
for (const f of findings) {
  const key = f.type ? f.tag + ":" + f.type : null;
  if (key && NATIVE_EXEMPT[key]) { usedExempt.add(key); continue; }
  // A computed class (a concatenation) is trusted: its literal part is checked by the guards that
  // drive that panel, and a static parse cannot resolve it.
  if (f.cls !== null && !/^[\w\s-]+$/.test(f.cls)) continue;
  const names = f.cls ? f.cls.split(/\s+/).filter(Boolean) : [];
  // COUNTED HERE — past every skip, at the point where this element's classes are actually
  // compared against the stylesheet. Anything counted below this line reached the decision.
  if (!f.interactive) comparedNonInteractive++;
  if (names.some((n) => declaredClasses.has(n))) continue;
  // ANCESTOR COVERAGE, TIED TO THIS CONTROL'S OWN CONTAINER — not to the existence of any rule
  // for the tag somewhere in the sheet.
  if (f.container.some((c) => ancestorRules.has(c + " " + f.tag))) continue;
  unstyled.push(f.tag + (f.type ? "[" + f.type + "]" : "") +
                (f.cls ? ' class="' + f.cls + '"' : " (no class)") + " @" + f.line);
}

// ── COUNTED AT THE COMPARISON, NOT AT COLLECTION ──────────────────────────────────────────
// This row read `findings.filter((f) => !f.interactive).length`, and **every finding had
// `interactive: undefined`** because the widening had not applied — so `!f.interactive` was true
// of all of them and the row "proving" layout elements were reached was counting the interactive
// ones. It passed while no `div` was ever collected.
//
// **A collection gathered and then filtered before the assertion satisfies a premise row about
// the collection and exempts everything.** So the count is taken where the decision is made:
// `compared` is incremented inside the classification loop, after every skip.
ok(comparedNonInteractive > 100,
  "APPLIED — layout elements must REACH THE COMPARISON, not merely be collected. A premise row "
  + "counting what was FOUND is satisfied by a sweep that finds them and then skips them, which "
  + "is exactly how this guard passed on a defect it was widened to catch",
  comparedNonInteractive);

ok(unstyled.length === 0,
  "EVERY ELEMENT THE PANEL BUILDS WITH A CLASS IS STYLED BY SOMETHING THE STYLESHEET DECLARES — its own class or an " +
  "ancestor rule. A control that reuses nothing renders as browser-default chrome on a dark " +
  "panel, and three shipped that way in five packages because a REUSE check cannot see a control " +
  "that reuses nothing", unstyled);

// THE EXEMPT LIST IS EXHAUSTED — no entry survives the control it excused.
const stale = Object.keys(NATIVE_EXEMPT).filter((k) => !usedExempt.has(k));
ok(stale.length === 0,
  "and every exemption names a control that still exists. An exemption outliving its control is " +
  "an excuse nobody re-reads, and it is how a list of six becomes a list of twenty", stale);

// AND THE REASONS ARE REAL SENTENCES, not placeholders.
for (const k of Object.keys(NATIVE_EXEMPT)) {
  ok(NATIVE_EXEMPT[k].length > 80,
    "and `" + k + "` carries a REASON rather than a name — the difference between a decision and " +
    "a silent list", NATIVE_EXEMPT[k]);
}

// ── THE CONTROL: THE SWEEP CAN ACTUALLY FAIL ────────────────────────────────────────────────
// A sweep that reports zero is indistinguishable from a sweep that looked nowhere, which is what
// `check-visual-reuse` did for three releases. This drives a synthetic finding through the same
// classification and asserts it is REFUSED.
{
  const fake = { tag: "select", type: null, cls: "no-such-class-anywhere", line: 0 };
  const names = fake.cls.split(/\s+/);
  const wouldPass = names.some((n) => declaredClasses.has(n)) ||
    ["no-such-container"].some((c) => ancestorRules.has(c + " " + fake.tag));
  ok(wouldPass === false,
    "control: a control carrying an UNDECLARED class is classified as unstyled — so the empty " +
    "list above is a reading rather than a scan that classifies everything as fine", fake.cls);
  const real = { tag: "select", cls: "rank-select" };
  ok(declaredClasses.has(real.cls),
    "control: while a control carrying a DECLARED one passes — the two directions, so the rule " +
    "discriminates", real.cls);
  ok(!declaredClasses.has("delegation-rank") || declaredClasses.has("rank-select"),
    "control: and `delegation-rank` — the reported defect — is only acceptable because it now " +
    "also carries `rank-select`", "delegation-rank");
}

// ── A CLASS IS A SET, NOT A SEQUENCE ────────────────────────────────────────────────────────
// `_probe-j15-dm.js` matched rows with `indexOf("dm-row") === 0` — a claim about POSITION in the
// class list — and it broke the moment `room-item` went in front of it. The tree was searched for
// the same shape and this was the ONLY instance; recorded either way, because the search is the
// finding and a later reader should not have to repeat it to learn it came back empty.
{
  const probeDirs = ["tests", "tools/probes"];
  const offenders = [];
  for (const d of probeDirs) {
    for (const f of fs.readdirSync(path.join(ROOT, d))) {
      if (!f.endsWith(".js")) continue;
      const s = fs.readFileSync(path.join(ROOT, d, f), "utf8")
        .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
      for (const m of s.matchAll(/\b(?:cls|className)[^\n]{0,40}indexOf\("([\w-]+)"\)\s*===\s*0/g)) {
        offenders.push(d + "/" + f + " -> " + m[1]);
      }
    }
  }
  ok(offenders.length === 0,
    "NO HARNESS MATCHES A CLASS BY POSITION. `cls.indexOf(\"x\") === 0` asserts that `x` is FIRST " +
    "in the class list, which is a fact about how the element was written rather than about what " +
    "it is — and it fails silently the day any class is added in front, as a gate refusing to " +
    "read rows rather than a wrong answer. A class is a set, not a sequence", offenders);
}

console.log("[control-styling] PASS — every interactive element the panel builds is styled by " +
  "something the stylesheet declares (" + asserts + " assertions). THREE UNSTYLED CONTROLS " +
  "SHIPPED IN FIVE PACKAGES and no guard could see any of them: `check-visual-reuse` asserts " +
  "PRECEDENTS ARE REUSED, and **a control that reuses nothing is invisible to a reuse check**. " +
  "The rule here accepts ANCESTOR COVERAGE rather than demanding a class, because six buttons are " +
  "styled by `.chat-input-row button` and `.uq-add button` and a guard that cries wolf six times " +
  "out of thirteen gets disabled — which is worse than not having it. Six native checkboxes and " +
  "file inputs are EXEMPT WITH A REASON, and the list is asserted EXHAUSTED so an exemption " +
  "cannot outlive its control. The selector parse reads rule HEADS rather than grepping, because " +
  "a grep for a bare `select` rule matches `user-select: all`; and attribute objects are " +
  "BRACE-MATCHED, because they span lines and a per-line scan reports classes that are simply on " +
  "another line. Both instruments were tried and both were wrong. And no harness matches a class " +
  "by POSITION any more — `indexOf(\"dm-row\") === 0` broke the day a class went in front of it, " +
  "and the tree was swept for the shape");
