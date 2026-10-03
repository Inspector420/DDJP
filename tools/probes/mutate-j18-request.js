// tools/probes/mutate-j18-request.js
// J18 — break the Done-when's two clauses, and the domain read that keeps the vocabularies apart.
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
// range about other claims; cite these as `mutate-j18-request M4`, never as a bare `M4`. The journal
// markers (`J18M4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-j18-request.js M1 M2 M3
// `J18_SUITE=tests/check-bot-settings.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.J18_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J18_SUITE;

const F = {
  bs: path.join(ROOT, "features/botsettings.js"),
  sd: path.join(ROOT, "backends/backend1/statederiver.js"),
  vc: path.join(ROOT, "backends/backend1/vouch.js"),
};

const ROWS = [
  // ── THE DONE-WHEN'S FIRST CLAUSE — THE ROW MOST WORTH A RED ───────────────────────────────
  // "No settings event at all" is stronger than "a refused settings event". M1 makes the refusal
  // produce a write the reducer then bounces: nothing breaks, the setting does not change, and a
  // delegation table doing nothing looks exactly like one that works.
  { id: "M1", file: "bs", part: "B",
    why: "A REFUSED REQUEST STILL AUTHORS A SETTINGS WRITE — the reducer bounces it, the setting " +
         "does not change, and every test phrased as `the value did not move` still passes",
    find: "    if (!verdict.ok) {",
    repl: "    if (false) {   /*J18M1*/",
    marker: "J18M1", expect: 1 },

  { id: "M2", file: "bs", part: "B",
    why: "the decision is taken AFTER the write instead of before it, so the refusal reports " +
         "correctly and the event has already gone",
    find: "    const verdict = decide(req, senderLevel, settings);\n    if (!verdict.ok) {",
    repl: "    const verdict = decide(req, senderLevel, settings);\n    if (typeof authorSettings === \"function\") { try { await authorSettings({ [req && req.k]: req && req.v }); } catch (e) {} }   /*J18M2*/\n    if (!verdict.ok) {",
    marker: "J18M2", expect: 1 },

  // ── THE RANK TEST ─────────────────────────────────────────────────────────────────────────
  { id: "M3", file: "bs", part: "A/B",
    why: "the rank floor is not enforced — any rank may change any DELEGATED setting, so the " +
         "table's rank column becomes decoration",
    find: "    if (!Capabilities.atLeast(senderLevel, grantedTo)) {",
    repl: "    if (false) {   /*J18M3*/",
    marker: "J18M3", expect: 1 },

  { id: "M4", file: "bs", part: "A",
    why: "an UNDELEGATED setting is permitted — absence stops being a refusal, so a room that " +
         "never configured delegation silently delegates everything",
    find: "    if (typeof grantedTo !== \"string\" || !grantedTo) {",
    repl: "    if (false) {   /*J18M4*/",
    marker: "J18M4", expect: 1 },

  { id: "M5", file: "bs", part: "A",
    why: "a table naming a rank that does not exist is treated as a real grant rather than " +
         "refused — the failure direction of an unreadable grant opens",
    find: "    if (vocab.indexOf(grantedTo) < 0) return no(\"bad-grant\", \"`\" + grantedTo + \"` is not a rank\");",
    repl: "    /*J18M5*/",
    marker: "J18M5", expect: 1 },

  // ── THE DOMAIN, AND THE DEFECT THIS JOB WAS MOST LIKELY TO INTRODUCE ──────────────────────
  { id: "M6", file: "bs", part: "D",
    why: "THE DOMAIN CHECK IS DROPPED — a request may name anything, so `botDelegation` becomes " +
         "delegable (a rank granted it grants itself everything) and `Ranks.GATES` acts like " +
         "`room.upgrade` become requestable. The two vocabularies blur, which is exactly the " +
         "defect this job was most likely to introduce",
    find: "    if (domain.indexOf(key) < 0) {",
    repl: "    if (false) {   /*J18M6*/",
    marker: "J18M6", expect: 1 },

  { id: "M7", file: "bs", part: "D",
    why: "the domain is RESTATED as a hand-written list instead of read from the reducer — the " +
         "same keys today, and a setting added tomorrow is silently never delegable",
    find: "      domain = entry && Array.isArray(entry.keys) ? entry.keys : null;",
    repl: '      domain = ["maxLen", "minLen", "chat", "vis"];   /*J18M7*/',
    marker: "J18M7", expect: 1 },

  { id: "M8", file: "bs", part: "A",
    why: "the rank vocabulary is restated rather than read from the same seam, so a ladder change " +
         "leaves this file disagreeing with it",
    find: "      vocab = entry && Array.isArray(entry.values) ? entry.values : null;",
    repl: '      vocab = ["owner", "high-staff", "staff", "vip", "player", "guest", "uncategorized"];   /*J18M8*/',
    marker: "J18M8", expect: 1 },

  { id: "M9", file: "bs", part: "A",
    why: "an unreadable domain FAILS OPEN — if the seam throws, every request is permitted",
    find: '    if (!domain || !vocab) return no("no-domain", "the delegation domain could not be read");',
    repl: "    /*J18M9*/",
    marker: "J18M9", expect: 1 },

  { id: "M10", file: "bs", part: "A",
    why: "a malformed request THROWS instead of being refused — the request channel is writable " +
         "by anyone the room admits, so this is a denial-of-service surface",
    find: '    if (!req || typeof req !== "object") return no("malformed", "the request is not an object");',
    repl: "    /*J18M10*/",
    marker: "J18M10", expect: 1 },

  // ── THE REDUCER MUST STAY OUT OF IT ───────────────────────────────────────────────────────
  { id: "M11", file: "sd", part: "C/F",
    why: "the reducer accepts settings from HIGH-STAFF too — a second author of room truth, which " +
         "is the design J18 exists to avoid",
    find: '        if (!Ranks.permits(rank, "room.settings")) { _rej(ev); continue; }',
    repl: '        if (!Ranks.atLeast(rank, "high-staff")) { _rej(ev); continue; }   /*J18M11*/',
    marker: "J18M11", expect: 1 },

  { id: "M12", file: "vc", part: "wiring",
    why: "the request type becomes vouch-critical — real witness work spent protecting an event " +
         "whose whole effect is to ask a question, and requests start moving the seal cadence",
    find: '    "ddjp.bot.request",\n  ];',
    repl: "  ];   /*J18M12*/",
    marker: "J18M12", expect: 1 },
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
    console.log("[mutate-j18] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j18] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j18] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j18] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j18-request:" + row.id, file);
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
  console.log("\n[mutate-j18] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
