// tools/probes/mutate-j13-feed.js
// J13 — break each thing `check-event-feed` claims to pin, and watch it go red.
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
// range about other claims; cite these as `mutate-j13-feed M4`, never as a bare `M4`. The journal
// markers (`J13M4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-j13-feed.js M1 M2 M3
// `J13_SUITE=tests/check-event-feed.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.J13_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J13_SUITE;

const F = {
  rm: path.join(ROOT, "features/room.js"),
  ui: path.join(ROOT, "ui/interface.js"),
};

const ROWS = [
  // ── the fold's arithmetic ──────────────────────────────────────────────────────────────────
  { id: "M1", file: "rm", part: "A",
    why: "the feed stops ordering newest-first, so a running list reads from the wrong end",
    find: "    rows.sort((a, b) => (b.ts - a.ts) || ((a.eventId < b.eventId) ? 1 : (a.eventId > b.eventId ? -1 : 0)));",
    repl: "    rows.sort((a, b) => (a.ts - b.ts));   /*J13M1*/",
    marker: "J13M1", expect: 1 },

  { id: "M2", file: "rm", part: "A",
    why: "the limit silently cuts the list without `total` or `truncated` reporting it",
    find: "    const total = rows.length;\n    const shown = rows.slice(0, limit);",
    repl: "    const shown = rows.slice(0, limit);\n    const total = shown.length;   /*J13M2*/",
    marker: "J13M2", expect: 1 },

  // ── THE ROW THIS JOB EXISTS FOR ────────────────────────────────────────────────────────────
  // Nothing breaks. The feed simply narrates what the room refused.
  { id: "M3", file: "rm", part: "B/C",
    why: "REFUSED EVENTS ARE NARRATED — the feed names a settings change the reducer rejected, " +
         "a reset a guest was not allowed to make. roles.md §10's second signature exactly",
    find: "      if (!ok) { refused++; continue; }",
    repl: "      if (!ok) { refused++; }   /*J13M3*/",
    marker: "J13M3", expect: 1 },

  { id: "M4", file: "rm", part: "B",
    why: "refused events are dropped SILENTLY — excluded from the rows and not counted, so the " +
         "feed under-reports without saying so",
    find: "      if (!ok) { refused++; continue; }",
    repl: "      if (!ok) { continue; }   /*J13M4*/",
    marker: "J13M4", expect: 1 },

  { id: "M5", file: "rm", part: "G",
    why: "an unnamed kind is narrated with a placeholder instead of being excluded, so every " +
         "length declaration and buffer edit buries the acts a person came to read",
    find: "      if (!k) { unnamed++; continue; }",
    repl: "      if (!k) { unnamed++; rows.push({ eventId: e.eventId, type: e.type, verb: \"did something\", group: \"other\", sender: e.sender || null, ts: ts, l: l }); continue; }   /*J13M5*/",
    marker: "J13M5", expect: 1 },

  // ── THE DONE-WHEN CORRECTION: the three origins ────────────────────────────────────────────
  { id: "M6", file: "rm", part: "E",
    why: "the origin stops reading the room and answers from emptiness alone — a forgotten room " +
         "is reported as one where nothing has happened",
    find: '      origin: counted > 0 ? "held" : (o.roomExists ? "forgotten" : "nothing-yet"),',
    repl: '      origin: counted > 0 ? "held" : "nothing-yet",   /*J13M6*/',
    marker: "J13M6", expect: 1 },

  { id: "M7", file: "rm", part: "E",
    why: "the discriminator ignores derived state, so EVERY empty feed claims its history was " +
         "banked — including a brand-new room that never had any",
    find: '      origin: counted > 0 ? "held" : (o.roomExists ? "forgotten" : "nothing-yet"),',
    repl: '      origin: counted > 0 ? "held" : "forgotten",   /*J13M7*/',
    marker: "J13M7", expect: 1 },

  { id: "M8", file: "rm", part: "E",
    why: "`roomExists` stops being a reading of the state and becomes a constant, which is what " +
         "makes M6/M7 findings about the rule rather than about one branch",
    find: "      roomExists = !!(st && (st.nowPlaying || (st.rotation && st.rotation.length > 0)));",
    repl: "      roomExists = false;   /*J13M8*/",
    marker: "J13M8", expect: 1 },

  // ── the panel's wording ────────────────────────────────────────────────────────────────────
  // M9 AND M11 WERE FIRST WRITTEN AS STRING SURGERY AND WENT RED BY CRASH — the mutated file did
  // not parse, so `check-event-feed` refused at its extraction stage and the assertion written for
  // the failure never ran. `08-build-and-deploy.md` §Writing a guard: *red by crash is not red
  // enough*, because a guard killed by a throw is one swallowed exception away from being killed
  // by nothing. Both are now edits that produce VALID code which simply says the wrong thing, so
  // the red comes from the assertion that exists for it.
  { id: "M9", file: "ui", part: "F",
    why: "the forgotten-room explanation is dropped, so the feed goes empty with NO explanation " +
         "— which is the one thing the Done-when actually asked for and the only half it got right",
    find: '    if (f.origin === "forgotten") {',
    repl: '    if (false /*J13M9*/) {',
    marker: "J13M9", expect: 1 },

  { id: "M10", file: "ui", part: "F",
    why: "the refused count is not stated, so excluding refused events becomes hiding them",
    find: "      refusedNote: f.refused",
    repl: "      refusedNote: false   /*J13M10*/",
    marker: "J13M10", expect: 1 },

  { id: "M11", file: "ui", part: "F",
    why: "the sources sentence stops saying chat is not listed, and implies the feed is everything",
    find: '      sources: "Rotation, playback, reactions, settings and moderation. Chat is not listed — " +\n               "it never reaches the log this is read from.",',
    repl: '      sources: "Everything that has happened in this room, including chat.",   /*J13M11*/',
    marker: "J13M11", expect: 1 },

  { id: "M12", file: "ui", part: "F",
    why: "the reach note claims completeness rather than saying this is what the client still holds",
    find: '        ? "Showing what this client still holds. Anything older has been forgotten or was never seen."',
    repl: '        ? "Showing every event in this room."   /*J13M12*/',
    marker: "J13M12", expect: 1 },

  // ── the panel's behaviour ──────────────────────────────────────────────────────────────────
  { id: "M13", file: "ui", part: "F",
    why: "the panel re-sorts the rows, so the fold's ordering claim stops being the one shown (P7)",
    find: "      _renderWindowedStack(refs.feedBox, () => rows, (r) => {",
    repl: "      _renderWindowedStack(refs.feedBox, () => rows.slice().sort((a, b) => a.ts - b.ts), (r) => {   /*J13M13*/",
    marker: "J13M13", expect: 1 },

  { id: "M14", file: "ui", part: "F",
    why: "the panel pre-cuts the list before handing it to the windowing helper, so the scrollbar " +
         "is proportional to a list nobody has",
    find: "      _renderWindowedStack(refs.feedBox, () => rows, (r) => {",
    repl: "      _renderWindowedStack(refs.feedBox, () => rows.slice(0, 5), (r) => {   /*J13M14*/",
    marker: "J13M14", expect: 1 },

  { id: "M15", file: "ui", part: "F",
    why: "the panel measures ages against the DEVICE clock rather than a server stamp (P2)",
    find: '    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;\n    let fold;\n    try { fold = Room.recentEvents({ limit: FEED_LIMIT }); }',
    repl: '    const now = Date.now();   /*J13M15*/\n    let fold;\n    try { fold = Room.recentEvents({ limit: FEED_LIMIT }); }',
    marker: "J13M15", expect: 1 },

  // ── the seam ───────────────────────────────────────────────────────────────────────────────
  // Not a wording row: this one asks whether PART E's structural assertion is load-bearing or
  // decorative. A feature reading the backend's guard seam would answer the same question and
  // survive a swap badly.
  { id: "M16", file: "rm", part: "E",
    why: "the feed answers `forgotten` from `StreamManager._trimState()` — the backend GUARD SEAM " +
         "— instead of from the contract. Same answer today, and a lite or bot backend has no " +
         "such private. PART E's structural check is what should notice",
    find: "      roomExists = !!(st && (st.nowPlaying || (st.rotation && st.rotation.length > 0)));",
    repl: "      roomExists = (StreamManager._trimState() !== null);   /*J13M16*/",
    marker: "J13M16", expect: 1 },
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    return { green: /All guards passed/.test(out) || /PASS/.test(out), out };
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
    console.log("[mutate-j13] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j13] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  const want = process.argv.slice(2).filter((a) => /^M\d+$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j13] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j13] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j13-feed:" + row.id, file);
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      if (row.find2) applied += h.apply(row.find2, row.repl2, row.expect);
    } catch (e) {
      h.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read.
    const still = h.stillApplied(row.marker);
    h.restore();

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
  console.log("\n[mutate-j13] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
