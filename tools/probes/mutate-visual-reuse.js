// tools/probes/mutate-visual-reuse.js
// Three visual corrections — break each borrow: the button shape, the shared marquee, the
// composer's classes. Every row is about a REUSE being undone, not about an appearance.
//
// SEPARATE FROM `mutate-j17-settings.js` AND `mutate-j17-lattice.js`, WHICH MEASURE A DIFFERENT
// THING. Those two ask what ADDING a key costs, and use an injected vehicle key to ask it. This
// one asks whether the five keys that actually landed are load-bearing. Both questions are live
// and neither answers the other.
//
// EVERY ROW EXPECTS A CHANGE unless it is explicitly marked `expectGreen`. A mutation whose
// expected result is "nothing changes" cannot detect its own failure to apply
// (`09-roadmap.md` §8), so each row breaks something and expects the suite to notice; a row that
// stays GREEN without being marked is a finding about the GUARD, not about the tree.
//
// JOURNALLED. The edit is recorded before it is made and cleared only after the original bytes
// are back, so a run killed mid-flight leaves a recoverable tree rather than a mutated one the
// next reader measures. APPLIED-CHECKED TWICE: once when the edit lands, and again after the
// suite's result has been read — before-only is sufficient when one hand holds the tree and
// worthless when two do. Under collision a green row is VOID, not a survivor.
//
// ROW IDS ARE PER-FILE. `mutate-j15-dm.js` and `mutate-j16-active.js` both have rows in the M1x
// range about other claims; cite these as `mutate-j-botruntime M4`, never as a bare `M4`. The journal
// markers (`VISM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-visual-reuse.js M1 M2 M3
// `VIS_SUITE=tests/check-visual-reuse.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS THAT MATTER MOST ────────────────────────────────────────────────────────────────
// M3 is the one this job exists to prevent: the feed narrates events the reducer REFUSED. Nothing
// breaks, the list looks fuller, and the panel names acts nobody performed.
// M7 and M8 are the Done-when correction: collapse the two empties into one and the panel tells
// somebody their history was banked when it never existed, or that nothing has happened in a room
// whose entire history it destroyed. Both are true-of-nothing sentences that read as fact.

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.VIS_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.VIS_SUITE;

const F = {
  ui: path.join(ROOT, "ui/interface.js"),
  ix: path.join(ROOT, "index.html"),
};

const ROWS = [
  // ── ITEM 1: the back button ───────────────────────────────────────────────────────────────
  { id: "M1", file: "ui", part: "A",
    why: "THE ARROW BUTTON STOPS BORROWING the copy button's shape — back to a box sized by the " +
         "arrow's line-height, oblong and borderless beside the square copy buttons",
    find: 'const backBtn = el("button", { class: "back-btn copy-btn icon-only", text: "\\u2190" });',
    repl: 'const backBtn = el("button", { class: "back-btn", text: "\\u2190" });   /*VISM1*/',
    marker: "VISM1", expect: 1 },

  { id: "M2", file: "ui", part: "A",
    why: "the WORDED caller gets the 26px square too, clipping `← Rooms` — the second caller the " +
         "brief warned to check, changed by accident",
    find: 'const back = el("button", { class: "back-btn", text: "← Rooms" });',
    repl: 'const back = el("button", { class: "back-btn copy-btn icon-only", text: "← Rooms" });   /*VISM2*/',
    marker: "VISM2", expect: 1 },

  { id: "M3", file: "ix", part: "A",
    why: "a FOURTH button style is added instead of borrowing — the thing the ask ruled out, and " +
         "it would pass any check that only looked at the rendered box",
    find: "    /* `.back-btn.collapsed` is GONE.",
    repl: "    .back-btn.collapsed { width: 32px; padding: 6px 0; text-align: center; }\n    /* `.back-btn.collapsed` is GONE.   /*VISM3*/",
    marker: "VISM3", expect: 1 },

  { id: "M4", file: "ix", part: "A",
    why: "the precedent loses its height, so it stops being the thing that makes a square and the " +
         "borrow inherits the original defect",
    find: ".copy-btn.icon-only { padding: 0; width: 26px; height: 26px;",
    repl: ".copy-btn.icon-only { padding: 0; width: 26px;   /*VISM4*/",
    marker: "VISM4", expect: 1 },

  // ── ITEM 2: one marquee ───────────────────────────────────────────────────────────────────
  { id: "M5", file: "ui", part: "B",
    why: "THE FITTER STOPS TAKING ITS TARGET — hard-wired to the video title again, so a second " +
         "marquee would have to be COPIED for the room title. The five-times category",
    find: "function _fitMarquee(boxEl, txtEl) {\n    const box = boxEl || refs.videoTitle, txt = txtEl || refs.videoTitleText;",
    repl: "function _fitMarquee(boxEl, txtEl) {   /*VISM5*/\n    const box = refs.videoTitle, txt = refs.videoTitleText;",
    marker: "VISM5", expect: 1 },

  { id: "M6", file: "ui", part: "B",
    why: "the pending-frame handle goes back to MODULE level, so two targets fitting at once " +
         "cancel each other's frame and one title silently never fits",
    find: "      box._marqueeRaf = 0;\n      if (apply()) return;\n      if (++tries < 10) box._marqueeRaf = requestAnimationFrame(tick);",
    repl: "      _marqueeRaf = 0;   /*VISM6*/\n      if (apply()) return;\n      if (++tries < 10) _marqueeRaf = requestAnimationFrame(tick);",
    marker: "VISM6", expect: 1 },

  { id: "M7", file: "ui", part: "B",
    why: "the room title loses its inner text node, so the marquee has a box and nothing to move " +
         "inside it",
    find: 'refs.roomTitleText = el("span", { class: "room-title-text", text: room.name || room.spaceId });\n    refs.roomTitle = el("h2", { class: "room-title" }, [refs.roomTitleText]);',
    repl: 'refs.roomTitle = el("h2", { class: "room-title", text: room.name || room.spaceId });   /*VISM7*/',
    marker: "VISM7", expect: 1 },

  { id: "M8", file: "ui", part: "B",
    why: "the room title loses its own observer, so the header reflowing never re-fits it — the " +
         "video title's observer never sees that box",
    find: "        _roomTitleRo = new ResizeObserver(() => _fitMarquee(refs.roomTitle, refs.roomTitleText));",
    repl: "        /*VISM8*/",
    marker: "VISM8", expect: 1 },

  { id: "M9", file: "ix", part: "B",
    why: "the title box stops clipping, so the text widens the box instead of overflowing it and " +
         "nothing ever scrolls",
    find: ".room-title { overflow: hidden; white-space: nowrap; min-width: 0; }",
    repl: ".room-title { min-width: 0; }   /*VISM9*/",
    marker: "VISM9", expect: 1 },

  // ── ITEM 3: the DM composer ───────────────────────────────────────────────────────────────
  { id: "M10", file: "ui", part: "C",
    why: "THE DM FIELD STOPS BORROWING `.chat-input` — a browser-default white box with black " +
         "text on a dark panel, which is the reported defect exactly",
    find: 'const input = el("input", { class: "dm-input chat-input", type: "text", placeholder: "Message…" });',
    repl: 'const input = el("input", { class: "dm-input", type: "text", placeholder: "Message…" });   /*VISM10*/',
    marker: "VISM10", expect: 1 },

  { id: "M11", file: "ui", part: "C",
    why: "the row stops borrowing, so Send is a bare default button again — `.dm-input-row button` " +
         "has never had a rule",
    find: 'box.appendChild(el("div", { class: "dm-input-row chat-input-row" },',
    repl: 'box.appendChild(el("div", { class: "dm-input-row" },   /*VISM11*/',
    marker: "VISM11", expect: 1 },

  { id: "M12", file: "ix", part: "C",
    why: "`.dm-input` re-declares the borrowed appearance, so two rules describe one field and " +
         "drift the next time either is touched",
    find: "    .dm-input { flex: 1; min-width: 0; }",
    repl: "    .dm-input { flex: 1; min-width: 0; background: #333; border: 1px solid #555; color: #fff; padding: 8px; font-size: 13px; }   /*VISM12*/",
    marker: "VISM12", expect: 1 },

  { id: "M13", file: "ix", part: "C",
    why: "`.dm-sender` takes its colour back, so two rules decide what a name looks like and they " +
         "disagree — #9CA3AF against #5865F2",
    find: "    .dm-sender { flex-shrink: 0; }",
    repl: "    .dm-sender { color: #9CA3AF; flex-shrink: 0; }   /*VISM13*/",
    marker: "VISM13", expect: 1 },
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    // ── THE VERDICT IS THE EXIT CODE PLUS THE ABSENCE OF A FAILURE LINE ───────────────────────
    // `/PASS/.test(out)` alone is a TEXT MATCH, and it was true of output that also contained
    // `FAIL` — which is exactly what happened when a guard's failure gate sat above one of its
    // parts: the guard printed a FAIL line, exited 0, and three mutation rows read GREEN against a
    // tree whose fold they had deleted. `execFileSync` already throws on a non-zero exit, so
    // reaching this line means exit 0; the added test is that nothing announced a failure anyway.
    // A verdict that can be satisfied by a substring is not a verdict.
    const announcedFailure = /^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE)/m.test(out);
    return { green: !announcedFailure && (/All guards passed/.test(out) || /PASS/.test(out)), out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function firstFail(out) {
  const m = (out || "").match(/^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE) .*/m);
  return m ? m[0].slice(0, 180) : "(no FAIL line — check the output)";
}

function main() {
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[mutate-vis] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-vis] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-vis] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-vis] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-visual-reuse:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-visual-reuse:" + row.id + ":2", F[row.file2]);
        applied += h2.apply(row.find2, row.repl2, row.expect);
      } else if (row.find2) applied += h.apply(row.find2, row.repl2, row.expect);
    } catch (e) {
      h.restore(); if (h2) h2.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore(); if (h2) h2.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read.
    const still = h.stillApplied(row.marker);
    h.restore(); if (h2) h2.restore();

    if (!still) {
      console.log(row.id + "  VOID  — the mutation was gone by the time the result was read " +
        "(somebody else wrote to the tree); a green here would be a claim about a tree that " +
        "never held it");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    let verdict = r.green ? "GREEN" : "RED";
    if (row.expectGreen) verdict = r.green ? "DOMINATED" : "RED (redundancy ENDED — read it)";
    console.log(row.id + "  " + verdict + " [" + applied + " site, targets PART " + row.part + "] " +
      row.why + (/^RED/.test(verdict) ? "\n        -> " + firstFail(r.out) : ""));
    results.push({ id: row.id, verdict, part: row.part });
  }

  const red = results.filter((r) => /^RED/.test(r.verdict)).length;
  const green = results.filter((r) => r.verdict === "GREEN").length;
  const dom = results.filter((r) => r.verdict === "DOMINATED").length;
  const voidd = results.filter((r) => r.verdict === "VOID").length;
  console.log("\n[mutate-vis] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
