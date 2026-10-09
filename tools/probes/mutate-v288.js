// tools/probes/mutate-v288.js
// v288 — the temporal dead zone that killed the render chain, the unrecorded DM accept that
// created duplicate rooms, and the Saves button's destination.
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
// markers (`VM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-v288.js M1 M2 M3
// `V8_SUITE=tests/check-who-is-here.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.V8_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.V8_SUITE;

const F = {
  ui: path.join(ROOT, "ui/interface.js"),
  mb: path.join(ROOT, "backends/backend1/matrixbridge.js"),
};

const ROWS = [
  // ── ITEM 1: THE TEMPORAL DEAD ZONE, AS IT SHIPPED ─────────────────────────────────────────
  { id: "M1", file: "ui", part: "settings",
    why: "`cur` READ BEFORE IT IS DECLARED — the shipped defect. It parses cleanly and throws " +
         "`ReferenceError` on every render, taking six downstream calls in enterMainScreen with " +
         "it: the all-panels display and the missing delegation table are ONE bug",
    find: '    const cur = (value && typeof value === "object") ? value : {};\n    const wrap = el("div", { class: "set-row setting-delegation" });',
    repl: '    const wrap = el("div", { class: "set-row setting-delegation" });',
    find2: "    for (const k of domain) {\n      const row = el(\"div\", { class: \"dim-row delegation-row\" });",
    repl2: '    const cur = (value && typeof value === "object") ? value : {};   /*VM1*/\n    for (const k of domain) {\n      const row = el("div", { class: "dim-row delegation-row" });',
    marker: "VM1", expect: 1 },

  { id: "M2", file: "ui", part: "settings",
    why: "the COLLAPSED branch stops painting — the section vanishes without throwing, which is " +
         "the half of the symptom a ref sweep would also miss",
    find: "      refs.settingsBox.appendChild(wrap);\n      if (note) _renderSettingNote(null, note);\n      return;",
    repl: "      return;   /*VM2*/",
    marker: "VM2", expect: 1 },

  { id: "M3", file: "ui", part: "settings",
    why: "the collapsed branch renders the full list anyway, so 22 settings × 8 ranks is a wall " +
         "again and the shape decision bought nothing",
    find: "    if (!_delegationOpen) {",
    repl: "    if (false) {   /*VM3*/",
    marker: "VM3", expect: 1 },

  // ── ITEM 3: THE ROUND TRIP ────────────────────────────────────────────────────────────────
  { id: "M4", file: "mb", part: "dm",
    why: "ACCEPTING STOPS RECORDING — the shipped defect. The room is joined and invisible, " +
         "findDMRoom answers null, and the next attempt creates a SECOND room. Every attempt " +
         "makes another, and each is a real joined room that can only be left",
    find: "    await _rememberDirect(from, roomId);\n    return { roomId: roomId, recorded: true, userId: from };",
    repl: "    return { roomId: roomId, recorded: true, userId: from };   /*VM4*/",
    marker: "VM4", expect: 1 },

  { id: "M5", file: "mb", part: "dm",
    why: "an unidentifiable inviter is reported as RECORDED, so the caller cannot tell " +
         "joined-and-recorded from joined-and-invisible and nobody is warned",
    find: '      return { roomId: roomId, recorded: false };',
    repl: '      return { roomId: roomId, recorded: true };   /*VM5*/',
    marker: "VM5", expect: 1 },

  { id: "M6", file: "mb", part: "dm",
    why: "`_rememberDirect` is re-implemented here as a REPLACE rather than reused — the eighth " +
         "copied-rule opportunity, taken. A replace hides a room this account is still joined to",
    find: "    await _rememberDirect(from, roomId);",
    repl: "    { const m = _directMap(); m[from] = [roomId]; try { await client.setAccountData(\"m.direct\", m); } catch (e) {} }   /*VM6*/",
    marker: "VM6", expect: 1 },

  // ── ITEM 2: THE DESTINATION ───────────────────────────────────────────────────────────────
  { id: "M7", file: "ui", part: "saves",
    why: "the Saves button carries no destination, so it is Open with a different label — the " +
         "state the owner has now reported three times",
    find: "        _savesWanted = room.spaceId || null;\n        openRoom(room);",
    repl: "        openRoom(room);   /*VM7*/",
    marker: "VM7", expect: 1 },

  { id: "M8", file: "ui", part: "saves",
    why: "the destination is never READ, so the flag is set and nothing acts on it — a control " +
         "whose promise lives entirely in a variable",
    find: "    if (_savesWanted) {\n      _savesWanted = null;",
    repl: "    if (false) {\n      _savesWanted = null;   /*VM8*/",
    marker: "VM8", expect: 1 },
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
    console.log("[mutate-v288] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-v288] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-v288] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-v288] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-v288:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-v288:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-v288] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
