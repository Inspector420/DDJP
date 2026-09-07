// tests/_probe-j13-feed.js
// SHARED HARNESS for J13 (the event feed) — used by `tests/check-event-feed.js` and by
// `tools/probes/probe-j13-feed.js`, so the guard and the measurement cannot drift.
//
// ── WHY THE PANEL IS EXTRACTED AND RUN RATHER THAN MATCHED ───────────────────────────────────
// The half of this job that can be wrong while everything still works is a SENTENCE: what the
// feed says when it is empty, and what it says about the events it is not listing. A regex
// proving "has been banked into a checkpoint" is SPELLED in `ui/interface.js` proves nothing
// about whether the panel ever renders it — the class of check that stayed green for the whole
// life of the blocked wire (J41). So `_feedRowText`, `_feedLabel` and `renderFeedPanel` are
// pulled out by name and driven. `check-who-is-here` is the precedent (J16, PARTs E and F) and
// this is the sixth guard in the tree to execute this file rather than read it.
//
// THE EXTRACTOR IS BORROWED, NOT REWRITTEN. `_probe-j16-active.js` already owns `extractFn` and
// the recording DOM, and a second copy would be a second definition of "how this file is read",
// free to disagree with the first (P7). This file requires that one and adds only what the feed
// needs: the windowed-stack shim, and drivers for the feed's own three declarations.
//
// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Every reading here has several stages — find the file, find the declaration, brace-match it,
// run it, observe something — and an empty answer looks identical whichever stage failed. That
// matters more for this job than for most, because THE SUBJECT IS LEGITIMATELY EMPTY IN THE CASE
// THE JOB IS ABOUT: a forgotten room's feed has no rows, and "no rows because the room was
// banked" and "no rows because the harness never reached the panel" are the same output. Each
// reading therefore states its preconditions as SEPARATE checks and refuses to be asserted from
// if one fails, naming which. `selfTest()` feeds the gate broken readings AND sound ones, because
// a gate that refuses everything certifies nothing.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const UI_REL = "ui/interface.js";

// The J16 harness owns the extraction and the recording DOM.
const J16 = require(path.join(__dirname, "_probe-j16-active.js"));
const { extractFn, el, node, flatten } = J16;

// ── THE CONSTANTS THE PANEL CLOSES OVER, READ FROM THE FILE RATHER THAN RESTATED ─────────────
// `renderFeedPanel` names `FEED_LIMIT` and `FEED_ROW_H`, which are declared beside it and are not
// part of any extracted function body. THIS COST A DIAGNOSIS AND IS WORTH THE PARAGRAPH.
//
// Left absent from the sandbox, the reference throws — INSIDE the panel's own
// `try { fold = Room.recentEvents(...) } catch (e) { return; }`, which is there so a throwing
// feature layer cannot take the people pane down with it. So the harness's missing dependency
// arrived as an early return, the panel painted nothing, and the reading looked exactly like
// "the panel renders nothing" rather than like "the harness never gave it what it needed".
// That is two documented failures at once: `08-build-and-deploy.md` §A guard must be able to
// fail — *one omitted a dependency from its sandbox, and the subject's fallback made the harness
// report the opposite of the truth* — and *a guard's own error handling must not wrap the thing
// under test*, reached from the subject's side rather than the guard's.
//
// THE ADMISSIBILITY GATE CAUGHT IT, which is the argument for having one: the run refused with
// "the panel never asked the feature layer for a feed" instead of asserting over an empty box.
// Without the gate this would have been a green PART with nothing in it.
//
// They are READ FROM THE SOURCE rather than injected as harness values, so a mutation that
// changes the shipped limit changes what this harness drives. Injecting `200` here would have
// made the guard agree with a number the file had stopped using.
function extractConsts(rel, names, srcOverride) {
  let src = srcOverride;
  if (src == null) {
    try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); }
    catch (e) { return { ok: false, stage: "stage: " + rel + " is not readable" }; }
  }
  const out = [];
  for (const n of names) {
    const re = new RegExp("^\\s*const\\s+" + n + "\\s*=\\s*([^;]+);", "m");
    const m = src.match(re);
    if (!m) {
      return { ok: false, stage: "stage: `const " + n + "` is not declared in " + rel +
        " — the panel closes over it, so a reading without it exercises the panel's error path " +
        "rather than the panel" };
    }
    out.push("const " + n + " = " + m[1].trim() + ";");
  }
  return { ok: true, source: out.join("\n") };
}

// ── DRIVER 1 — the panel, extracted from ui/interface.js and RUN ─────────────────────────────
// `Room.recentEvents` is STUBBED and the stub RECORDS rather than decides: what this driver is
// for is proving the panel renders what the feature hands it and computes nothing of its own.
// The fold's real arithmetic is driven separately, against the real module.
//
// `_renderWindowedStack` is shimmed rather than extracted, and that is a DELIBERATE BOUNDARY.
// It is review-only DOM wiring (scroll listeners, rAF, clientHeight) whose windowing MATH is
// already guarded by `check-windowedlist`. What this harness has to prove is that the panel hands
// it the fold's rows unchanged, so the shim records what it was handed and paints all of it —
// a shim that windowed would make "the panel painted three of five" indistinguishable from
// "the panel dropped two".
function drivePanel(opts) {
  const o = opts || {};
  const consts = extractConsts(UI_REL, ["FEED_LIMIT", "FEED_ROW_H"], o.srcOverride);
  if (!consts.ok) return { ok: false, stage: consts.stage, asked: [], rendered: [] };
  const pieces = ["_fmtAgo", "_feedRowText", "_feedLabel", "renderFeedPanel"];
  const srcs = [consts.source];
  for (const p of pieces) {
    const ex = extractFn(UI_REL, p, o.srcOverride);
    if (!ex.ok) return { ok: false, stage: ex.stage, asked: [], rendered: [] };
    srcs.push(ex.source);
  }

  const asked = [];
  const box = node("div");
  const carded = [];
  const windowed = [];      // what the panel handed the windowing helper

  const sandbox = {
    console, Math, JSON, Date,
    refs: { feedBox: o.noBox ? null : box },
    clear: (n) => { n.children.length = 0; },
    el,
    shortName: (userId) => (userId || "").split(":")[0].replace("@", ""),
    rankColor: () => "#fff",
    _rosterLevel: () => 0,
    _wireCardTrigger: (nodeEl, userId) => carded.push(userId),
    // The shim. Records the list it was given, then paints every row through the panel's own
    // `rowFor`, so the assertions below are about the panel's output and not about the scroller.
    _renderWindowedStack: (parent, getList, rowFor, rowH) => {
      const list = getList() || [];
      windowed.push({ n: list.length, rowH: rowH });
      const holder = el("div", { class: "feed-stack" });
      for (let i = 0; i < list.length; i++) holder.appendChild(rowFor(list[i], i));
      parent.appendChild(holder);
    },
    // The clock the panel is REQUIRED to use. Recorded so the guard can assert the panel measured
    // against a server stamp rather than reaching for Date.now() (P2).
    ServerClock: { serverNow: () => o.serverNow },
    Room: {
      recentEvents: (arg) => {
        asked.push(arg);
        if (o.throwFromRoom) throw new Error("backend unavailable");
        return o.fold;
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(srcs.join("\n") +
      "\n;globalThis.__render = renderFeedPanel;" +
      "\n;globalThis.__label = _feedLabel;" +
      "\n;globalThis.__row = _feedRowText;", sandbox, { filename: "feedPanel" });
  } catch (e) {
    return { ok: false, stage: "stage: the feed declarations did not evaluate — " + e.message,
             asked, rendered: [] };
  }
  try { sandbox.__render(); }
  catch (e) { return { ok: false, stage: "stage: `renderFeedPanel` threw — " + e.message, asked, rendered: [] }; }

  const nodes = flatten(box);
  const texts = nodes.map((n) => n.text).filter(Boolean);
  const cls = (c) => nodes.filter((n) => String(n.className || "").split(/\s+/).indexOf(c) >= 0);
  return {
    ok: true, asked, carded, windowed,
    nodes, texts,
    all: texts.join(" \u2016 "),
    head: cls("feed-head").map((n) => n.text),
    empty: cls("feed-empty").map((n) => n.text),
    reach: cls("feed-reach").map((n) => n.text),
    refused: cls("feed-refused").map((n) => n.text),
    sources: cls("feed-sources").map((n) => n.text),
    truncated: cls("feed-truncated").map((n) => n.text),
    // The rows the panel actually painted, in the order it painted them.
    rendered: cls("feed-row").map((n) => ({
      who: n.children[0] ? n.children[0].text : "",
      verb: n.children[1] ? n.children[1].text : "",
      ago: n.children[2] ? n.children[2].text : "",
      cls: String(n.className || ""),
    })),
    label: sandbox.__label, row: sandbox.__row,
  };
}

// ── DRIVER 2 — the label alone, so its wording can be varied without a DOM ───────────────────
function driveLabel(fold, srcOverride) {
  const r = drivePanel({ fold: { rows: [], total: 0, origin: "nothing-yet" },
                         serverNow: 0, srcOverride });
  if (!r.ok) return { ok: false, stage: r.stage };
  let out;
  try { out = r.label(fold); }
  catch (e) { return { ok: false, stage: "stage: `_feedLabel` threw — " + e.message }; }
  if (!out || typeof out !== "object") {
    return { ok: false, stage: "stage: `_feedLabel` returned no object" };
  }
  return { ok: true, label: out, row: r.row };
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
// A reading is admissible only if it reached its subject. `want` states what this particular row
// needed to be true BEFORE its assertion means anything — the premise written down as a check
// rather than assumed (`paths.md` §9 entry 12).
function gate(kind, r, want, where) {
  const w = want || {};
  const fail = (why, detail) => {
    const msg = "[event-feed] INADMISSIBLE " + (where || kind) + " — " + why +
      "\n      nothing below this would mean anything; the reading never reached its subject" +
      (detail !== undefined ? "\n      got " + JSON.stringify(detail) : "");
    if (gate._throw) throw new Error(msg);
    console.log(msg);
    process.exit(2);
  };
  if (!r || r.ok !== true) fail((r && r.stage) || "the reading did not complete");
  if (kind === "panel") {
    if (w.expectAsked && (!r.asked || r.asked.length === 0)) {
      fail("the panel never asked the feature layer for a feed, so it cannot have rendered one");
    }
    if (w.expectPainted && (!r.nodes || r.nodes.length === 0)) {
      fail("the panel painted nothing at all — an empty box is what a panel that never ran also " +
           "produces, and an EMPTY FEED IS THE CASE THIS JOB IS ABOUT, so the two must be told apart");
    }
    if (w.expectRows && (!r.rendered || r.rendered.length === 0)) {
      fail("the panel painted no event rows, so an assertion about their content has no subject");
    }
  }
  if (kind === "label") {
    if (typeof r.label.sources !== "string" || !r.label.sources) {
      fail("the label carries no `sources`, so an assertion about its wording has no subject", r.label);
    }
    if (typeof r.label.heading !== "string" || !r.label.heading) {
      fail("the label carries no `heading`", r.label);
    }
  }
  return r;
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
// BOTH DIRECTIONS. A gate shown only to refuse would certify nothing about the cases it admits,
// and a gate shown only to admit is not a gate.
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
  const ROWS = { rows: [{ eventId: "$a", type: "ddjp.dj.join", verb: "joined the DJ queue",
                          group: "rotation", sender: "@a:hs", ts: 1000, l: 1 }],
                 total: 1, truncated: false, limit: 200, counted: 1, refused: 0, unnamed: 0,
                 oldestTs: 1000, newestTs: 1000, oldestL: 1, held: 1, roomExists: true,
                 origin: "held" };

  expectRefusal("no box — the panel paints nothing", () => {
    gate("panel", drivePanel({ noBox: true, fold: ROWS, serverNow: 5000 }),
      { expectPainted: true }, "selftest");
  });
  expectRefusal("the subject is deleted from the source", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("function _feedLabel(", "function _NOT_feedLabel(");
    gate("panel", drivePanel({ srcOverride: src, fold: ROWS, serverNow: 5000 }),
      { expectPainted: true }, "selftest");
  });
  expectRefusal("an empty fold where rows were required", () => {
    gate("panel", drivePanel({ fold: { rows: [], total: 0, origin: "nothing-yet" }, serverNow: 5000 }),
      { expectRows: true }, "selftest");
  });
  expectRefusal("the label loses its sources sentence", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace(/sources: "Rotation, playback[\s\S]*?read from\.",/, 'sources: "",');
    gate("label", driveLabel(ROWS, src), {}, "selftest");
  });
  expectAdmit("a sound panel reading", () => {
    gate("panel", drivePanel({ fold: ROWS, serverNow: 5000 }),
      { expectAsked: true, expectPainted: true, expectRows: true }, "selftest");
  });
  expectAdmit("a sound label reading", () => {
    gate("label", driveLabel(ROWS), {}, "selftest");
  });
  // AND THE ONE THAT MATTERS FOR THIS JOB: an EMPTY feed must still be an admissible panel
  // reading, because the forgotten room is the case the Done-when is about. A gate that refused
  // it would make the job's own subject unmeasurable.
  expectAdmit("an EMPTY forgotten-room panel is still admissible", () => {
    gate("panel", drivePanel({ fold: { rows: [], total: 0, counted: 0, refused: 0, unnamed: 0,
      oldestTs: null, held: 0, roomExists: true, origin: "forgotten" }, serverNow: 5000 }),
      { expectAsked: true, expectPainted: true }, "selftest");
  });
  gate._throw = false;
  return out;
}

module.exports = { drivePanel, driveLabel, gate, selfTest, extractFn, extractConsts,
                   el, node, flatten, J16, UI_REL, ROOT };
