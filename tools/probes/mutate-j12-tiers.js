// tools/probes/mutate-j12-tiers.js
// J13 — break each thing `check-chat-tiers` claims to pin, and watch it go red.
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
// range about other claims; cite these as `mutate-j12-tiers M4`, never as a bare `M4`. The journal
// markers (`J12M4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-j12-tiers.js M1 M2 M3
// `J12_SUITE=tests/check-chat-tiers.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.J12_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J12_SUITE;

const F = {
  rm: path.join(ROOT, "features/room.js"),
  ui: path.join(ROOT, "ui/interface.js"),
  ch: path.join(ROOT, "features/chat.js"),
  cp: path.join(ROOT, "core/chatprefs.js"),
};

const ROWS = [
  // ── the readable set: what actually blocked unread badges ─────────────────────────────────
  { id: "M1", file: "ch", part: "B",
    why: "`_handleRaw` goes back to the ONE active channel — the pre-J12 filter, under which a " +
         "message in a tier you are not viewing is discarded at the door and no badge is possible",
    find: "    if (_readable.indexOf(raw.room_id) < 0) return;",
    repl: "    if (raw.room_id !== currentChatId) return;   /*J12M1*/",
    marker: "J12M1", expect: 1 },

  { id: "M2", file: "ch", part: "B",
    why: "the readable filter fails OPEN on an empty set, so an unbound client renders a " +
         "stranger's chat channel as this room's",
    find: "    if (!_readable.length) return;",
    repl: "    if (!_readable.length) { /*J12M2*/ } else",
    marker: "J12M2", expect: 1 },

  { id: "M3", file: "ch", part: "B",
    why: "the channel id stops travelling with the message, so the consumer cannot tell which " +
         "tier it belongs to and files every message under whichever view is selected",
    // THE ANCHOR IS QUALIFIED BECAUSE THE UNQUALIFIED ONE MATCHED TWICE. `_handleRaw` and the DM
    // receive path both forward `(…, failed, raw.ts, raw.room_id)` — the DM path already carried
    // the channel id, which is where J12 took the pattern from. The probe REFUSED the ambiguous
    // anchor rather than mutating whichever came first (`09-roadmap.md` §8: *the anchor matched
    // THE WRONG OCCURRENCE*), so this row is anchored on the sanitiser call beside it.
    find: '_sanitize(raw.content.body || ""), failed, raw.ts, raw.room_id);',
    repl: '_sanitize(raw.content.body || ""), failed, raw.ts);   /*J12M3*/',
    marker: "J12M3", expect: 1 },

  // ── the resolver: the Open ────────────────────────────────────────────────────────────────
  { id: "M4", file: "rm", part: "C",
    why: "the device override is ignored, so a view switch cannot change what you are reading",
    find: "    let active = tiers.find((t) => t.tier === want) || tiers.find((t) => t.tier === mainTier) || tiers[0] || null;",
    repl: "    let active = tiers.find((t) => t.tier === mainTier) || tiers[0] || null;   /*J12M4*/",
    marker: "J12M4", expect: 1 },

  { id: "M5", file: "rm", part: "C",
    why: "the override wins even when it names a tier this client cannot read, so a demoted " +
         "person gets an empty view instead of a working one",
    find: "    let active = tiers.find((t) => t.tier === want) || tiers.find((t) => t.tier === mainTier) || tiers[0] || null;",
    repl: "    let active = want ? { tier: want, id: null } : (tiers.find((t) => t.tier === mainTier) || tiers[0] || null);   /*J12M5*/",
    marker: "J12M5", expect: 1 },

  { id: "M6", file: "rm", part: "C",
    why: "the resolver re-points RECEIVING but not SENDING, so the tier you read is not the tier " +
         "your next message goes to — and nothing looks broken",
    find: "    if (r.activeId) { try { Chat.setRoom(r.activeId); } catch (e) {} }",
    repl: "    /*J12M6*/",
    marker: "J12M6", expect: 1 },

  { id: "M7", file: "rm", part: "C",
    why: "only the active channel is pushed as readable, which is the pre-J12 filter arriving " +
         "through the resolver instead of through `_handleRaw`",
    find: "    try { Chat.setReadableTiers(r.tiers.map((t) => t.id)); } catch (e) {}",
    repl: "    try { Chat.setReadableTiers(r.activeId ? [r.activeId] : []); } catch (e) {}   /*J12M7*/",
    marker: "J12M7", expect: 1 },

  // ── the read markers ──────────────────────────────────────────────────────────────────────
  { id: "M8", file: "cp", part: "D",
    why: "the read marker follows a LATE message backwards, re-raising a badge the person just " +
         "cleared — backfill decrypts newest-first, so this is reachable rather than exotic",
    // ANCHORED ON THE TIER FUNCTION, because `dmMarkRead` carries a byte-identical line — J12
    // took the pattern from it. The unqualified anchor matched twice and the probe REFUSED rather
    // than mutating whichever came first, which is the guard rail working.
    find: "  function tierMarkRead(tier, ts) {\n    const s = _st();\n    const row = s.tiers.find((r) => r.tier === tier);\n    if (!row) return tierList();",
    repl: "  function tierMarkRead(tier, ts) {   /*J12M8*/\n    const s = _st();\n    const row = s.tiers.find((r) => r.tier === tier);\n    if (!row) return tierList();\n    row.readTs = Number(ts) || 0; _save(); _emit(); return tierList();",
    marker: "J12M8", expect: 1 },

  { id: "M9", file: "cp", part: "E",
    why: "a tier with NO traffic reads as unread, so every rank-granted tier in every quiet room " +
         "carries a badge inviting somebody to open an empty channel",
    // Same qualification as M8: `dmUnread`'s body is identical.
    find: "  function tierUnread(tier) {\n    const row = _st().tiers.find((r) => r.tier === tier);\n    return !!(row && row.lastTs > row.readTs);",
    repl: "  function tierUnread(tier) {   /*J12M9*/\n    const row = _st().tiers.find((r) => r.tier === tier);\n    return !row || row.lastTs > row.readTs;",
    marker: "J12M9", expect: 1 },

  // ── THE KEEP-ONE LATTICE ON THE TWO CAP SITES ─────────────────────────────────────────────
  // `tiers` is capped in TWO places: `tierFold` (what THIS build writes) and `load()` (a blob
  // this build did NOT write — an older version's, or a hand-edited localStorage). A single-site
  // pass cannot tell "both redundant" from "one is the enforcement", and BOTH outcomes have been
  // seen in this tree: the activity-window clamps had a reader holding the rule alone, while
  // `Floor.select`'s four genuinely had no enforcement among them. So the rotations are run.
  { id: "M10", file: "cp", part: "F",
    why: "KEEP `load()` ONLY (drop tierFold's cap) — does the loader alone hold the rule?",
    find: "    return out.slice(0, max);\n  }\n\n  // Normalize a user-typed host",
    repl: "    return out;   /*J12M10*/\n  }\n\n  // Normalize a user-typed host",
    marker: "J12M10", expect: 1 },

  { id: "M11", file: "cp", part: "F",
    why: "KEEP `tierFold` ONLY (drop load()'s cap) — does the writer alone hold the rule?",
    find: "      .slice(0, TIER_CAP);",
    repl: "      .slice();   /*J12M11*/",
    marker: "J12M11", expect: 1 },

  { id: "M12", file: "cp", part: "F",
    why: "DROP BOTH — the floor of the lattice. A green here with greens above would mean no " +
         "enforcement among the two; a red identifies that they hold jointly",
    find: "    return out.slice(0, max);\n  }\n\n  // Normalize a user-typed host",
    repl: "    return out;   /*J12M12a*/\n  }\n\n  // Normalize a user-typed host",
    find2: "      .slice(0, TIER_CAP);",
    repl2: "      .slice();   /*J12M12b*/",
    marker: "J12M12b", expect: 1 },

  // THE CONTROL, ADJACENT TO THE SUBJECTS. Without it, all-green cannot be told from a path
  // nothing reaches: this drops the SANITISER on the same `load()` expression the cap sits on.
  { id: "M13", file: "cp", part: "F",
    why: "CONTROL — drop load()'s tier SANITISER (the same expression the cap lives on). A red " +
         "here proves the suite reaches this walk and evaluates it, which is what makes any " +
         "green above a reading rather than an unreached path",
    find: '      .filter((r) => r && typeof r === "object" && r.tier)',
    repl: "      .filter((r) => true)   /*J12M13*/",
    marker: "J12M13", expect: 1 },

  // ── the strip ─────────────────────────────────────────────────────────────────────────────
  { id: "M14", file: "ui", part: "G",
    why: "the strip decides `active` itself instead of rendering the resolver's answer (P7)",
    find: "        active: t.tier === r.activeTier,",
    repl: "        active: !!t.main,   /*J12M14*/",
    marker: "J12M14", expect: 1 },

  { id: "M15", file: "ui", part: "E",
    why: "the strip stops stating what a badge means, leaving it to be inferred",
    // A WRONG NOTE RATHER THAN NO NOTE. The first version emptied it, which tripped the harness
    // gate's premise check ("the label carries no note") before PART E's assertion could fire —
    // a red reported by the gate rather than by the check written for the failure, which is the
    // same objection as *red by crash* one layer up. This says something untrue instead.
    find: '        ? "This room has one chat tier."',
    repl: '        ? "Chat."   /*J12M15*/',
    marker: "J12M15", expect: 1 },

  { id: "M16", file: "ui", part: "A",
    why: "a TIER key stops keying the buffers, so every tier shares one again and switching " +
         "silently mixes two audiences into one view",
    find: "    const key = (typeof tier === \"string\" && tier) ? tier : (box._chatTier || \"_active\");",
    repl: "    const key = \"_active\";   /*J12M16*/",
    marker: "J12M16", expect: 1 },

  { id: "M17", file: "ui", part: "A",
    why: "a ROOM change stops clearing the tier buffers, so the previous room's chat survives " +
         "into the next one — the control half of PART A's rule",
    find: "    box._chats = Object.create(null);",
    repl: "    /*J12M17*/",
    marker: "J12M17", expect: 1 },
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
    console.log("[mutate-j12] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j12] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  const want = process.argv.slice(2).filter((a) => /^M\d+$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j12] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j12] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j12-tiers:" + row.id, file);
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
  console.log("\n[mutate-j12] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
