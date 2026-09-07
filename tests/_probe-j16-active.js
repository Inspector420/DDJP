// tests/_probe-j16-active.js
// SHARED HARNESS for J16 (who has done something recently) — used by `tests/check-who-is-here.js`
// and by `tools/probes/probe-j16-active.js`, so the guard and the measurement cannot drift.
//
// ── WHY THE PANEL IS EXTRACTED AND RUN RATHER THAN MATCHED ───────────────────────────────────
// The subject of half this job is a LABEL, and a label is a claim about behaviour like any other
// (`roles.md` §10's second signature). A regex proving the sentence "Chat is not counted" is
// SPELLED in `ui/interface.js` proves nothing about whether the panel ever renders it, and is
// exactly the class of check that stayed green for the whole life of the blocked wire (J41).
// So `_spanText`, `_activityLabel` and `renderActivePanel` are pulled out by name and driven.
//
// THE ROUTER IS BORROWED, NOT REWRITTEN. The chat claim needs the real `_routeEvent`, which
// `_probe-j15-dm.js` already extracts and executes. A second extractor for the same function
// would be a second definition of "which rooms are ours" free to disagree with the first, so this
// file requires that one (P7).
//
// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Every reading here has several stages — find the file, find the declaration, brace-match it,
// run it, observe something — and an empty answer looks identical whichever stage failed. That
// matters more than usual for this job: the subject IS a list that can legitimately be empty, so
// "nobody is active" and "the harness never reached the panel" are the same output. Each reading
// therefore states its preconditions as SEPARATE checks and refuses to be asserted from if one
// fails, naming which. `selfTest()` feeds the gate broken readings AND sound ones, because a gate
// that refuses everything certifies nothing.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const UI_REL = "ui/interface.js";

// The J15 harness owns the router extraction; this one owns the panel.
const J15 = require(path.join(__dirname, "_probe-j15-dm.js"));

// ── extraction ───────────────────────────────────────────────────────────────────────────────
function matchBrace(src, open) {
  let d = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "{") d++;
    else if (c === "}") { d--; if (d === 0) return i; }
  }
  return -1;
}

// Pull one named function out of a file. Anchors on the name, so a guard keyed to this cannot fail
// because a comment moved — and if the region is reformatted past recognition it REFUSES (naming
// the stage) rather than passing, which is the safe direction.
function extractFn(rel, name, srcOverride) {
  let src = srcOverride;
  if (src == null) {
    try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); }
    catch (e) { return { ok: false, stage: "stage: " + rel + " is not readable" }; }
  }
  const anchor = "function " + name + "(";
  const n = src.split(anchor).length - 1;
  if (n === 0) {
    return { ok: false, stage: "stage: `" + name + "` is not declared in " + rel +
      " — this measurement has no subject" };
  }
  if (n !== 1) {
    return { ok: false, stage: "stage: `" + name + "` is declared " + n + " times in " + rel +
      ", expected exactly 1 — this measurement cannot tell which one it reads" };
  }
  const at = src.indexOf(anchor);
  const open = src.indexOf("{", src.indexOf(")", at));
  const close = matchBrace(src, open);
  if (open < 0 || close < 0) {
    return { ok: false, stage: "stage: `" + name + "` could not be brace-matched — a fact about " +
      "this probe rather than about the subject" };
  }
  return { ok: true, source: src.slice(at, close + 1), whole: src };
}

// ── the recording DOM ────────────────────────────────────────────────────────────────────────
// Mirrors the real `el` key for key, including that `onclick`/`disabled`/`value` are PROPERTIES
// while everything else is an attribute — a harness that wired handlers differently from
// production could hide a control that is dead in the browser and live here.
function node(tag) {
  return {
    tag, attrs: {}, text: "", children: [], style: {}, dataset: {}, className: "",
    classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; },
                 toggle(c, on) { if (on) this._s[c] = 1; else delete this._s[c]; },
                 contains(c) { return !!this._s[c]; } },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { for (const c of cs) this.children.push(c); },
    remove() {}, focus() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = v; },
    get textContent() { return this.text; },
    set textContent(v) { this.text = String(v); },
  };
}
function el(tag, attrs, kids) {
  const n = node(tag);
  if (attrs) for (const k in attrs) {
    if (k === "text") n.text = String(attrs[k]);
    else if (k === "class") n.className = attrs[k];
    else if (k === "onclick") n.onclick = attrs[k];
    else if (k === "disabled") n.disabled = attrs[k];
    else if (k === "value") n.value = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  for (const c of (kids || [])) if (c) n.appendChild(c);
  return n;
}
function flatten(n, out) {
  out = out || [];
  for (const c of (n.children || [])) { out.push(c); flatten(c, out); }
  return out;
}

// ── DRIVER 1 — the panel, extracted from ui/interface.js and RUN ─────────────────────────────
// `Room.recentlyActive` is STUBBED here on purpose, and the stub RECORDS rather than decides: what
// this driver is for is proving the panel renders what the feature hands it and computes nothing
// of its own. The fold's real arithmetic is driven separately, against the real module.
function drivePanel(opts) {
  const o = opts || {};
  const pieces = ["_spanText", "_activityLabel", "renderActivePanel"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractFn(UI_REL, p, o.srcOverride);
    if (!ex.ok) return { ok: false, stage: ex.stage, asked: [], rendered: [] };
    srcs.push(ex.source);
  }

  const asked = [];
  const box = node("div");
  const carded = [];

  const sandbox = {
    console, Math, JSON, Date,
    refs: { activeBox: o.noBox ? null : box },
    clear: (n) => { n.children.length = 0; },
    el,
    // The REAL shortName, copied from `ui/interface.js` rather than approximated — a harness that
    // shortened names differently would make the rendered list unrecognisable to an assertion.
    shortName: (userId) => (userId || "").split(":")[0].replace("@", ""),
    rankColor: () => "#fff",
    _rosterLevel: () => 0,
    _wireCardTrigger: (nodeEl, userId) => carded.push(userId),
    // The clock the panel is REQUIRED to use. Recorded so the guard can assert the panel measured
    // against a server stamp rather than reaching for Date.now() (P2).
    ServerClock: { serverNow: () => o.serverNow },
    // The panel no longer asks ChatPrefs for a window (v272 — the window is room truth), so this
    // stub exists only to keep the sandbox complete if the panel ever reads something else from
    // ChatPrefs. It deliberately offers NO window: a stub that still answered one would let a
    // reintroduced read look like it worked.
    ChatPrefs: {},
    Room: {
      recentlyActive: (now, win) => {
        asked.push({ now, win });
        if (o.throwFromRoom) throw new Error("backend unavailable");
        return o.fold;
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(srcs.join("\n") +
      "\n;globalThis.__render = renderActivePanel;" +
      "\n;globalThis.__label = _activityLabel;" +
      "\n;globalThis.__span = _spanText;", sandbox, { filename: "activePanel" });
  } catch (e) {
    return { ok: false, stage: "stage: the panel declarations did not evaluate — " + e.message,
             asked, rendered: [] };
  }
  try { sandbox.__render(); }
  catch (e) { return { ok: false, stage: "stage: `renderActivePanel` threw — " + e.message, asked, rendered: [] }; }

  const nodes = flatten(box);
  const texts = nodes.map((n) => n.text).filter(Boolean);
  const cls = (c) => nodes.filter((n) => String(n.className || "").split(/\s+/).indexOf(c) >= 0);
  return {
    ok: true, asked, carded,
    nodes, texts,
    all: texts.join(" \u2016 "),
    head: cls("active-head").map((n) => n.text),
    window: cls("active-window").map((n) => n.text),
    reach: cls("active-reach").map((n) => n.text),
    sources: cls("active-sources").map((n) => n.text),
    // The people the panel actually painted, in the order it painted them.
    rendered: cls("active-person").map((n) => (n.children[0] ? n.children[0].text : "")),
    acts: cls("active-acts").map((n) => n.text),
    label: sandbox.__label, span: sandbox.__span,
  };
}

// ── DRIVER 2 — the label alone, so its honesty can be varied without a DOM ───────────────────
function driveLabel(fold, srcOverride) {
  const r = drivePanel({ fold: { people: [] }, serverNow: 0, windowMs: 0, srcOverride });
  if (!r.ok) return { ok: false, stage: r.stage };
  let out;
  try { out = r.label(fold); }
  catch (e) { return { ok: false, stage: "stage: `_activityLabel` threw — " + e.message }; }
  if (!out || typeof out !== "object") {
    return { ok: false, stage: "stage: `_activityLabel` returned no object" };
  }
  return { ok: true, label: out, span: r.span };
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
// A reading is admissible only if it reached its subject. `want` states what this particular row
// needed to be true BEFORE its assertion means anything — which is the premise written down as a
// check rather than assumed (`paths.md` §9 entry 12).
function gate(kind, r, want, where) {
  const w = want || {};
  const fail = (why, detail) => {
    const msg = "[who-is-here] INADMISSIBLE " + (where || kind) + " — " + why +
      "\n      nothing below this would mean anything; the reading never reached its subject" +
      (detail !== undefined ? "\n      got " + JSON.stringify(detail) : "");
    if (gate._throw) throw new Error(msg);
    console.log(msg);
    process.exit(2);
  };
  if (!r || r.ok !== true) fail((r && r.stage) || "the reading did not complete");
  if (kind === "panel") {
    if (w.expectAsked && (!r.asked || r.asked.length === 0)) {
      fail("the panel never asked the feature layer for a list, so it cannot have rendered one");
    }
    if (w.expectRendered && (!r.nodes || r.nodes.length === 0)) {
      fail("the panel painted nothing at all — an empty box is what a panel that never ran also produces");
    }
  }
  if (kind === "label") {
    for (const k of ["heading", "window", "sources"]) {
      if (typeof r.label[k] !== "string" || !r.label[k]) {
        fail("the label carries no `" + k + "`, so an assertion about its wording has no subject", r.label);
      }
    }
  }
  return r;
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
// BOTH DIRECTIONS. A gate shown only to refuse would certify nothing about the cases it admits,
// and a gate shown only to admit is not a gate. Feeds it a panel with no box (renders nothing), a
// source text with the subject deleted (no declaration to find), and then two sound readings.
function selfTest() {
  const out = [];
  gate._throw = true;
  const expectRefusal = (name, fn) => {
    try { fn(); out.push({ row: name, refused: false }); }
    catch (e) { out.push({ row: name, refused: true, why: String(e.message).split("\n")[0] }); }
  };
  const expectAdmit = (name, fn) => {
    try { fn(); out.push({ row: name, admitted: true }); }
    catch (e) { out.push({ row: name, admitted: false, why: String(e.message).split("\n")[0] }); }
  };

  expectRefusal("no box — the panel paints nothing", () => {
    gate("panel", drivePanel({ noBox: true, fold: { people: [] }, serverNow: 1000, windowMs: 60000 }),
      { expectRendered: true }, "selftest");
  });
  expectRefusal("the subject is deleted from the source", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("function _activityLabel(", "function _NOT_activityLabel(");
    gate("panel", drivePanel({ srcOverride: src, fold: { people: [] }, serverNow: 1000, windowMs: 60000 }),
      { expectRendered: true }, "selftest");
  });
  // ── THIS ROW'S OWN MUTATION SILENTLY STOPPED APPLYING, AND THE ROW ADMITTED ────────────────
  // The regex targeted a literal `sources: "Counts queue actions…"`. When `sources` became a
  // TERNARY (the room now decides what counts, so the sentence varies), the pattern matched
  // nothing, the source was returned unchanged, the label rendered fine — and the row reported
  // ADMITTED. **A self-test whose mutation quietly no-ops does not report a broken gate; it
  // reports a working one**, which is the failure this whole harness exists to catch, occurring
  // inside the harness.
  //
  // Fixed twice over: the pattern matches the current shape, AND the replacement is CHECKED to
  // have changed the source, so a future edit that moves this line again fails here rather than
  // passing quietly.
  expectRefusal("the label loses its sources sentence", () => {
    const orig = fs.readFileSync(path.join(ROOT, UI_REL), "utf8");
    const src = orig.replace(/sources: \([\s\S]*?\n\s*: "Counts queue actions[^"]*",/, 'sources: "",');
    if (src === orig) {
      throw new Error("selftest mutation did not apply — the `sources` shape moved and this row " +
                      "would have reported ADMITTED against an unmutated file");
    }
    gate("label", driveLabel({ people: [], effectiveWindowMs: 60000, requestedWindowMs: 60000, reach: 60000, bounded: false }, src),
      {}, "selftest");
  });
  expectAdmit("a sound panel reading", () => {
    gate("panel", drivePanel({ fold: { people: [{ userId: "@a:hs", lastTs: 5, acts: 1 }],
      effectiveWindowMs: 60000, requestedWindowMs: 60000, reach: 60000, bounded: false },
      serverNow: 1000, windowMs: 60000 }), { expectAsked: true, expectRendered: true }, "selftest");
  });
  expectAdmit("a sound label reading", () => {
    gate("label", driveLabel({ people: [], effectiveWindowMs: 60000, requestedWindowMs: 60000, reach: 60000, bounded: false }),
      {}, "selftest");
  });
  gate._throw = false;
  return out;
}

module.exports = { extractFn, drivePanel, driveLabel, gate, selfTest, el, node, flatten, J15, UI_REL, ROOT };
