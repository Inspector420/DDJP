// tools/probes/mutate-nav-surfaces.js
// Three navigation surfaces — break the saves button, the visible empty case, the export note
// (from its RETURN, not its wording), the layout, and the tier strip's shape.
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
// markers (`NAVM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-nav-surfaces.js M1 M2 M3
// `NAV_SUITE=tests/check-nav-surfaces.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.NAV_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.NAV_SUITE;

const F = {
  ui: path.join(ROOT, "ui/interface.js"),
  ix: path.join(ROOT, "index.html"),
};

const ROWS = [
  // ── ITEM 1: the saves button and the visible empty case ───────────────────────────────────
  { id: "M1", file: "ui", part: "A",
    why: "THE SAVES BUTTON RENDERS A PER-ROOM LIST instead of opening the room — one room's saves " +
         "served under another room's name, which is what a seed carrying no room id makes " +
         "impossible to do correctly",
    find: "        _savesWanted = room.spaceId || null;\n        openRoom(room);",
    repl: "        _savesWanted = room.spaceId || null;\n        renderExportSection();   /*NAVM1*/",
    marker: "NAVM1", expect: 1 },

  { id: "M2", file: "ui", part: "B",
    why: "THE EMPTY CASE HIDES THE SECTION AGAIN — the exact state that made a browser run report " +
         "that no save control existed, because hidden is indistinguishable from absent",
    find: '    box.style.display = "flex";\n    if (!held.length) {',
    repl: '    if (!held.length) { box.style.display = "none"; return; }\n    box.style.display = "flex";\n    if (false) {   /*NAVM2*/',
    marker: "NAVM2", expect: 1 },

  { id: "M3", file: "ui", part: "B",
    why: "the two empties collapse into one sentence, so a room with no saves is told to open a " +
         "room it has already opened",
    find: '        ? "That room has no saved checkpoints yet."',
    repl: '        ? "Open a room to see the saves it holds. This client keeps them for one room at a time."   /*NAVM3*/',
    marker: "NAVM3", expect: 1 },

  { id: "M4", file: "ui", part: "A",
    why: "the Saves click falls through to the row behind it, so one press is two acts",
    find: "        if (ev && ev.stopPropagation) ev.stopPropagation();",
    repl: "        /*NAVM4*/",
    marker: "NAVM4", expect: 1 },

  // ── ITEM 1: the export note, driven from the RETURN ────────────────────────────────────────
  { id: "M5", file: "ui", part: "C",
    why: "the peer-authored branch is DEAD — the note's wording stays in the source and the branch " +
         "never runs, so every file reports as importable. This is the M7 shape exactly",
    find: "          note.textContent = out.importable",
    repl: "          note.textContent = true   /*NAVM5*/",
    marker: "NAVM5", expect: 1 },

  { id: "M6", file: "ui", part: "C",
    why: "the note stops naming the author's rank, so a refused import cannot be attributed",
    find: '              + (out.rank || "a peer") + ", and a peer\'s checkpoint is verified by folding the log "',
    repl: '              + "someone" + ", and a peer\'s checkpoint is verified by folding the log "   /*NAVM6*/',
    marker: "NAVM6", expect: 1 },

  { id: "M7", file: "ui", part: "C",
    why: "a REFUSED export still downloads — a file written from a refusal is a file with nothing " +
         "in it",
    find: "            note.textContent = \"Could not export: \" + ((out && out.reason) || \"unknown\");\n            return;",
    repl: "            note.textContent = \"Could not export: \" + ((out && out.reason) || \"unknown\");   /*NAVM7*/",
    marker: "NAVM7", expect: 1 },

  // ── ITEM 2: layout, and the ordering another guard pins ───────────────────────────────────
  { id: "M8", file: "ix", part: "D",
    why: "the name field moves BELOW both buttons, so what it belongs to is inferred again — the " +
         "defect the layout change fixed",
    find: '    <div class="room-actions room-actions-name">\n      <input id="input-room-name" placeholder="Room name..." />\n    </div>',
    repl: "    <!--NAVM8-->",
    marker: "NAVM8", expect: 1 },

  { id: "M9", file: "ix", part: "D",
    why: "`input-import-file` moves outside the create section, breaking the id ORDER " +
         "`check-import` pins — a layout change that silently invalidates another guard's premise",
    find: '      <input id="input-import-file" type="file" accept="application/json,.json" />',
    repl: "      <!--NAVM9-->",
    marker: "NAVM9", expect: 1 },

  // ── ITEM 3: the queue's shape, and the extraction the other guard needs ────────────────────
  { id: "M10", file: "ui", part: "E",
    why: "the tier buttons lose the queue's `tab` class, so the strip is a third kind of control " +
         "again rather than the established one",
    find: 'const b = el("button", { class: "tab chat-tier"',
    repl: 'const b = el("button", { class: "chat-tier"   /*NAVM10*/',
    marker: "NAVM10", expect: 1 },

  { id: "M11", file: "ui", part: "E",
    why: "the container loses the shared `tabs` class, so the two sub-tab strips are styled by " +
         "two rules and drift apart",
    find: 'refs.chatTiers = el("div", { class: "tabs chat-tiers" });',
    repl: 'refs.chatTiers = el("div", { class: "chat-tiers" });   /*NAVM11*/',
    marker: "NAVM11", expect: 1 },

  { id: "M12", file: "ui", part: "E",
    why: "a declaration `check-chat-tiers` brace-matches from is RENAMED — that guard REFUSES " +
         "rather than fails, and a refusal reads like a pass to anyone not watching for it",
    find: "  function _chatTierLabel(res, unreadFor) {",
    repl: "  function _chatTierLabelRenamed(res, unreadFor) {   /*NAVM12*/",
    marker: "NAVM12", expect: 1 },
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
    console.log("[mutate-nav] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-nav] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-nav] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-nav] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-nav-surfaces:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-nav-surfaces:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-nav] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
