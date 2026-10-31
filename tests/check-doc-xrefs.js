#!/usr/bin/env node
// tests/check-doc-xrefs.js — DOES A CITATION IN THE DOCS POINT AT ANYTHING?
// SUBJECT: docs/, docs/main/09-roadmap.md
//
// What J51 asked for, plus the two neighbouring classes that have actually bitten. Until this file
// existed, `check-roadmap-gate` was the ONLY machine check on the doc tree and it reads one file
// for one field. This class has been found by hand three times, each by a different ad-hoc probe:
//
//   · `v275` — its only two roadmap occurrences were its heading and its `**Touches (v275).**`
//     line. `Touches` is on the drain's drop list, so draining it AND dropping the heading would
//     have made the token vanish and turned `FAILURE-SIGNATURES.md`'s "recorded in the v275 entry"
//     into a dangling citation. **Broken by two rules interacting, neither wrong alone.**
//   · `v292` — cited by `check-origin-fold.js` (retired at J82) as "v292's M7"; its only roadmap home was inside a
//     section being drained.
//   · `§1.4` — cited from `CONCEPTS.md` for twelve releases against a file with sections 0–6. A
//     markdown link checker reports it GREEN, because the address sits outside the link
//     parentheses: the file resolves and the address after it is prose to every tool that exists.
//
// ── WHY THIS IS A STATIC CHECK AND NOT A DIFF ───────────────────────────────────────────────
// The drains had `journal/drain-check.js`, a DIFF: it compared a before and an after and asked what fell to zero. A guard
// has no "before" — it runs on one tree — so the property had to be re-expressed as a STATIC one:
// **a citation that points at something absent**, computable from the tree alone. That is
// strictly stronger, and it is what lets this file catch all three cases above rather than only
// the ones that happen to be mid-edit. The diff tool went with the drains it served (step 2 of the clean-up, `ddjp_615`).
//
// ── WHAT IS NOT COVERED, NAMED SO IT IS NOT ASSUMED ────────────────────────────────────────
// ORDINALS INTO A LIST — *second*, *the third of these* — are addresses with no token to grep
// for, and they rot on INSERTION rather than on renumbering. J51 names them and nothing here
// reaches them. Give a rule a NAME and cite the name; this file is the backstop for the
// citations already written, never a substitute for that.
"use strict";
const fs = require("fs");
const path = require("path");
const DOCTREE = require("./_docs");

// ── Find the doc tree the way the handoff actually ships it ────────────────────────────────
// Same resolver shape as `check-roadmap-gate`, and for the same reason: two reachable copies
// that DIFFER are refused rather than picked between, because validating the tree the session
// did not edit reads exactly like the edit not having landed.
// Resolved by the shared `tests/_docs.js` rather than by a third copy of the glob.
const CANDIDATES = DOCTREE.docRoots();
const PRESENT = CANDIDATES.filter((c) => fs.existsSync(path.join(c, "main", "09-roadmap.md")));
if (!PRESENT.length) {
  console.log("[doc-xrefs] FAIL — no doc tree found. The docs ship with the tree, so their absence " +
    "is a broken tree and not a reason to pass. Looked in:");
  for (const c of CANDIDATES) console.log("      " + c);
  process.exit(1);
}
if (PRESENT.length > 1) {
  const first = fs.readFileSync(path.join(PRESENT[0], "main", "09-roadmap.md"), "utf8");
  if (PRESENT.some((c) => fs.readFileSync(path.join(c, "main", "09-roadmap.md"), "utf8") !== first)) {
    console.log("[doc-xrefs] FAIL — two doc trees are reachable and they DIFFER. Unpack one pair " +
      "at a time:");
    for (const c of PRESENT) console.log("      " + c);
    process.exit(1);
  }
}
const DOCS = PRESENT[0];
const APP = path.join(__dirname, "..");

let failed = 0, checked = 0;
function ok(cond, msg, detail) {
  checked++;
  if (cond) return;
  failed++;
  console.log("[doc-xrefs] FAIL — " + msg);
  if (detail !== undefined) console.log("      " + detail);
}

function walk(root, exts, skip) {
  const out = [];
  (function rec(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!skip || !skip.test(e.name)) rec(p); }
      else if (exts.test(e.name)) out.push(p);
    }
  })(root);
  return out;
}
const DOC_FILES = walk(DOCS, /\.md$/);
// `journal/` is drain tooling that NAMES the tokens it protects, and THIS FILE carries control
// tokens in its own assertions — scanning either makes the guard cite what it is checking and
// report itself. Caught on the first run, by the control firing on the control.
const APP_FILES = walk(APP, /\.js$/)
  .filter((p) => !/[\\/]journal[\\/]/.test(p))
  .filter((p) => path.basename(p) !== "check-doc-xrefs.js");
const rel = (p, root) => path.relative(root, p).split(path.sep).join("/");

// ═══ PART A — A POINTER FROM THE TREE TO A ROADMAP ENTRY MUST NAME AN ENTRY THAT EXISTS ════════
// A job number or a `vNNN` in code is a LABEL, and a label needs nothing: a finished job's entry is drained and then
// deleted, and a comment may keep the number as long as it says why (the owner's rule, J111). What must resolve is a
// POINTER — words sending the reader to an entry: an id followed by "'s entry" or "'s Done-when", "`09-roadmap.md`"
// followed by an id, "roadmap" followed by an id, "entry" followed by an id. A pointer whose entry is gone points at
// nothing: write the reason into the comment instead, or point at the rule's home.
//
// WHAT THIS WAS (J111). "Every `vNNN` / `Jnn` token cited from the tree exists somewhere in the docs" — which leaned on
// finished entries, where most tokens lived, and passed a pointer whose entry had gone so long as any other doc still
// mentioned the number. Its floor (forty tokens collected) and its control (`J17` resolves) were both denominated in
// what the clean-up removes; the fixture below drives the collector both ways instead.
// A POINTER MAY WRAP (J111's last batch, `ddjp_612`). Between its words, any run of white space, a line comment's `//` or
// a block comment's `*` counts as one space: `rep-reader.js` pointed at "J84's" and, on the next comment line, "entry",
// and the literal spaces these shapes once required read that as no pointer at all.
const GAP = String.raw`(?:\s|\/\/|\*)+`;
const POINTER_RES = [
  new RegExp(String.raw`\b(J\d{1,3})(?:'s|\u2019s)` + GAP + String.raw`(?:entry|Done-when)\b`, "g"),
  new RegExp(String.raw`\b09-roadmap\.md` + "`?,?" + GAP + String.raw`(?:§[\d.]+` + GAP + ")?(?:entry" + GAP + String.raw`)?(J\d{1,3})\b`, "g"),
  new RegExp(String.raw`\broadmap` + "`?,?" + GAP + "(?:entry" + GAP + String.raw`)?(J\d{1,3})\b`, "g"),
  new RegExp(String.raw`\bentry` + GAP + "(?:for" + GAP + String.raw`)?(J\d{1,3})\b`, "g"),
];
const pointersIn = (text) => {
  const out = [];
  for (const re of POINTER_RES) { const r = new RegExp(re.source, "g"); let m; while ((m = r.exec(text)) !== null) out.push(m[1]); }
  return out;
};
const ROADMAP_TEXT = (() => { const f = DOC_FILES.find((p) => rel(p, DOCS) === "main/09-roadmap.md"); return f ? fs.readFileSync(f, "utf8") : ""; })();
const ENTRY_IDS = new Set();
{ const re = /^(?:#### (J\d+)\b|\*\*(J\d+) — )/gm; let m; while ((m = re.exec(ROADMAP_TEXT)) !== null) ENTRY_IDS.add(m[1] || m[2]); }
const pointed = [];
for (const p of APP_FILES) for (const id of pointersIn(fs.readFileSync(p, "utf8"))) pointed.push([id, rel(p, APP)]);
// THE HELD LIST IS GONE (J111's last batch, `ddjp_612`). While the clean-up ran, a pointer in a `?v=`-tagged application
// file or a shared harness (`tests/_*.js`) was HELD here, with what to write, because rewording it moves `?v=` or selects
// every break file; the last batch fixed them all with one `?v=` bump (the owner's call, `ddjp_609`) and removed the list
// with the code that read it. No pointer is exempt.
const danglingA = pointed.filter(([id]) => !ENTRY_IDS.has(id));
ok(danglingA.length === 0,
  "a comment or message in the tree points at a roadmap entry that does not exist, so a reader following it finds " +
  "nothing. A finished entry is deleted once its rules have homes: write the reason into the comment, or point at the " +
  "rule's home (a job number alone may stay, as a label).",
  JSON.stringify(danglingA.slice(0, 20)));
// THE PREMISES, DRIVEN AT A FIXTURE rather than counted on the live tree.
{
  const fx = "see J999's entry; J998's Done-when; `09-roadmap.md` J997; roadmap J996; the entry J995; J994 as a label;\n" +
    "// wrapped, J993's\n// entry; and `09-roadmap.md`\n//   J992.";
  const got = pointersIn(fx).sort().join(",");
  ok(got === "J992,J993,J995,J996,J997,J998,J999",
    "PART A control: the collector must read every pointer shape and no bare label, or it answers for a different set", got);
  ok(ENTRY_IDS.size > 0 && ROADMAP_TEXT.length > 0,
    "PART A premise: the roadmap was read and its entry ids found, or every pointer reads as dangling", ENTRY_IDS.size);
}
// ═══ PART B — A `file.js:NNN` LOCATOR MUST STILL POINT AT THE NAME IT CLAIMS ═════════════════
// Measured at v312: sixteen such citations existed, fifteen were testable, and TWELVE were stale.
// In every case the name still existed in the tree, so the claims read as sound and only the
// addresses had rotted — which is exactly why nothing caught them. The tested property is the one
// that discriminates: does the CITED LINE contain the CITED NAME?
//
// Do not write new ones. This part exists so that a locator written anyway is not silent.
const LOCATOR = /`?([A-Za-z0-9_./-]+\.(?:js|html))`?:(\d+)/g;

// Extract the cited NAME from the text around a locator, then ask whether the cited LINE contains
// it. The name is a backticked identifier within a small window, because these citations wrap
// across lines in prose and a same-line rule reads almost none of them.
function auditLocators(entries) {
  const stale = [], untestable = [];
  for (const { where, lines } of entries) {
    lines.forEach((line, i) => {
      let m; LOCATOR.lastIndex = 0;
      while ((m = LOCATOR.exec(line)) !== null) {
        const [, file, lineNo] = m;
        const target = ALL_APP.find((q) => rel(q, APP).endsWith(file));
        if (!target) continue;
        // TIGHT, and the first attempt was not. A +/-2 LINE window pulled `substituteTrusted` out
        // of a neighbouring bullet for `floor.js:271` and `SNAPSHOT_TYPE` out of the clause above
        // `reputation.js:188`, then reported both stale — inventing two findings on a tree that
        // had none. A proximity window is an anchor that matches whatever is nearby, which is the
        // same defect as an anchor naming an identifier that occurs at ten sites. The name must
        // sit in the SAME clause as the locator, so a citation that does not write its name beside
        // the address is reported UNTESTABLE rather than guessed at.
        const from = Math.max(0, m.index - 80);
        const clause = line.slice(from, m.index + m[0].length + 40);
        const names = (clause.match(/`([A-Za-z_][A-Za-z0-9_]{2,})`/g) || [])
          .map((t) => t.replace(/`/g, "")).filter((t) => !t.includes("."));
        const tgtLines = fs.readFileSync(target, "utf8").split("\n");
        const at = tgtLines[Number(lineNo) - 1] || "";
        if (!names.length) { untestable.push(where + ":" + (i + 1) + " -> " + file + ":" + lineNo); continue; }
        if (!names.some((n) => at.includes(n))) {
          stale.push(where + ":" + (i + 1) + "  " + file + ":" + lineNo + "  cites " + JSON.stringify(names));
        }
      }
    });
  }
  return { stale, untestable };
}
const ALL_APP = walk(APP, /\.(js|html)$/);

// ── SELF-TEST FIRST, BOTH WAYS, BECAUSE THE LIVE POPULATION CANNOT CARRY THE CONTROL ────────
// When this was written only three distinct locators survived in the doc tree and NONE was mechanically
// testable: their cited names are implied by prose ("actually SENT at ...") rather than written beside
// them. More have been written since; few write their name beside the address, and none is stale, so the
// live tree still cannot carry the negative control. A live-only PART B would filter almost its whole
// population away and report green — the exact shape of a
// premise row that counts what a sweep FINDS and is satisfied by a sweep that finds them and then
// skips them. The mechanism is therefore proven against a synthetic fixture on every run: a
// locator that RESOLVES must come back clean and one that does NOT must come back stale.
const probeFile = ALL_APP.find((q) => rel(q, APP).endsWith("backends/backend1/vouch.js"));
const probeSrc = fs.readFileSync(probeFile, "utf8").split("\n");
const goodLine = probeSrc.findIndex((t) => /`?const`?\s|function |=>/.test(t) && /[A-Za-z_][A-Za-z0-9_]{4,}/.test(t)) + 1;
const goodName = (probeSrc[goodLine - 1].match(/[A-Za-z_][A-Za-z0-9_]{4,}/) || ["x"])[0];
const selfGood = auditLocators([{ where: "SELFTEST", lines: ["`" + goodName + "` at `backends/backend1/vouch.js:" + goodLine + "`"] }]);
const badLine = goodLine === 1 ? 2 : 1;
const selfBad = auditLocators([{ where: "SELFTEST", lines: ["`" + goodName + "` at `backends/backend1/vouch.js:" + badLine + "`"] }]);
ok(selfGood.stale.length === 0 && selfGood.untestable.length === 0,
  "PART B self-test: a locator pointing at the line that DOES contain its name was reported stale, " +
  "so this part flags everything and its greens mean nothing", JSON.stringify(selfGood));
ok(selfBad.stale.length === 1,
  "PART B self-test: a locator pointing at a line that does NOT contain its name was NOT reported, " +
  "so this part cannot fail and every green below is a reading of nothing", JSON.stringify(selfBad));

// ── Then the live tree ──────────────────────────────────────────────────────────────────────
const live = auditLocators(DOC_FILES.map((p) => ({ where: rel(p, DOCS), lines: fs.readFileSync(p, "utf8").split("\n") })));
const staleB = live.stale, untestable = live.untestable;
ok(staleB.length === 0,
  "a `file:line` locator no longer points at the name it cites. The name still exists \u2014 only the " +
  "address rotted, which is why the claim reads sound. Cite the name, not the line (J51).",
  JSON.stringify(staleB, null, 1));

// ═══ PART C — A `§` ADDRESS MUST RESOLVE IN THE FILE IT NAMES ════════════════════════════════
// J51's original subject. A markdown link checker passes these because the address sits OUTSIDE
// the link parentheses — the file resolves and `§1.4` after it is prose to every tool that exists.
//
// ── THE POPULATION, MEASURED, AND MOST OF IT IS REFUSED ─────────────────────────────────────
// 365 `§` addresses existed in the doc tree when this was measured; the linked form reached 60. The other 305 were
// measured before any rule was written, and they split into classes with very different wolf
// rates — so this part ADOPTS two and REFUSES two, with the numbers, rather than widening to
// everything and tuning until quiet.
//
//   ADOPTED  `file.md` §N        44 citations, ONE unresolved — a real stale citation
//   ADOPTED  [`file.md §N`](…)    2 citations, mechanical, and the linked form misses them
//                                 because the address sits BEFORE the closing paren
//   REFUSED  bare §N (same-file) 266 citations, 31 unresolved, an 11.7% wolf rate — and the
//                                 failures are NOT stale addresses. FOUR causes, each diagnosed:
//                                 CHAINED addresses (`paths.md` §1b · §8c — the second binds to
//                                 nothing), IMPLICIT cross-file references carrying no filename
//                                 at all ("recorded in §6's drain banner" means the ROADMAP's
//                                 §6), target sections whose heading shape this extractor cannot
//                                 parse, and — the sharpest — COMPOUND `§<section>.<item>`
//                                 addresses, which are now resolved above rather than merely
//                                 documented. **A guard crying wolf at 11.7% gets disabled,
//                                 which is worse than not having it.**
//
//   ⚠ IF YOU LATER ADOPT THE BARE CLASS, READ THE COMPOUND NOTE ON `sectionsOf` FIRST. A
//   resolver that wants a literal `1.3` heading marker inherits false positives on day one (five
//   when this was written, one — §1.8 — today), in `checkpoint-contents.md`, which is J51's ORIGINAL FILE — and they wear the
//   exact shape of J51's original bug: an address against a file whose sections appear to stop
//   short of it. They are correct citations into a numbered LIST. 85 compound-form addresses
//   exist tree-wide, so this is a convention rather than a handful of exceptions.
//   REFUSED  `file.md §N` bare    2 citations, and ONE is a historical recount of J51's own
//                                 §1.4 bug, which must stay green. No mechanical rule separates
//                                 an address being MENTIONED from one being USED, and a 1-in-2
//                                 wolf rate on a 2-sample population is not a rule.
//
// ── AND THE BINDING IS BY ADJACENCY, NEVER BY NEARNESS ──────────────────────────────────────
// A resolver that takes the NEAREST backticked filename mis-binds: it reads `CONCEPTS.md §1.4`
// where the target is `checkpoint-contents.md`, and `05-matrix.md §7.8` where `trust-cascade.md`
// is the file that has it. That is the same defect as PART B's rejected ±2-line window, arriving
// from a second direction — **a proximity anchor matches whatever is nearby.** So the filename
// must sit IMMEDIATELY before the address, with nothing but whitespace or `'s` between them.
// WHAT A FILE OFFERS AS A TARGET, DERIVED FROM ITS STRUCTURE AND NEVER FROM ITS OWN CITATIONS.
//
// This used to add every `§N` the file MENTIONS to the set of sections it OFFERS, which is
// circular: an address resolved because the target happened to cite it. Measured — with that rule
// removed, two live citations of `checkpoint-contents.md` §1.3 from the roadmap turn red, and they
// are CORRECT citations. They resolved only by coincidence.
//
// THE FOURTH NUMBERING SCHEME: COMPOUND `§<section>.<item>`. `checkpoint-contents.md` section 1 has
// no numbered SUBSECTIONS — it is a numbered list of eight items — so `§1.3` means section 1 item 3
// (`settings`) and `§1.8` means item 8 (`liveDecl`), which that file's own prose confirms where it
// writes the declaration beside the address. A resolver looking for a literal `1.3` heading marker
// finds nothing and reports false positives (five once, one today), in J51's original file, wearing
// the exact shape of J51's original bug. So the compound form is RESOLVED here, structurally: a
// numbered section N containing a numbered list contributes N.M for every item M.
function sectionsOf(file) {
  const s = fs.readFileSync(file, "utf8"); const out = new Set();
  for (const m of s.matchAll(/^#{1,6}\s+§?\s*(\d+(?:\.\d+)*[a-z]?)[.\s)]/gm)) out.add(m[1]);
  for (const m of s.matchAll(/^\s*(\d+(?:\.\d+)*[a-z]?)[.)]\s/gm)) out.add(m[1]);
  let section = null;
  for (const line of s.split("\n")) {
    const h = /^#{1,6}\s+(\d+)\.\s/.exec(line);
    if (h) { section = h[1]; continue; }
    const item = /^\s*(\d+)\.\s/.exec(line);
    if (item && section) out.add(section + "." + item[1]);
  }
  return out;
}
const SECTIONS = new Map(DOC_FILES.map((p) => [path.basename(p), sectionsOf(p)]));

// Collect (target file, section, where) triples for the two ADOPTED forms.
const C_FORMS = [
  { name: "linked", re: /\(([^)\s]*?\.md)\)[^§\n]{0,40}§(\d+(?:\.\d+)*[a-z]?)/g },
  { name: "adjacent-backtick", re: /`([A-Za-z0-9_./-]+\.md)`(?:'s)?\s*§(\d+(?:\.\d+)*[a-z]?)/g },
  { name: "linked-in-span", re: /\[`([A-Za-z0-9_./-]+\.md)\s+§(\d+(?:\.\d+)*[a-z]?)`\]\(/g },
];
function auditSections(entries) {
  const stale = []; const pop = { linked: 0, "adjacent-backtick": 0, "linked-in-span": 0 };
  for (const { where, lines } of entries) {
    lines.forEach((line, i) => {
      for (const form of C_FORMS) {
        form.re.lastIndex = 0; let m;
        while ((m = form.re.exec(line)) !== null) {
          const tgt = path.basename(m[1]); const sec = m[2];
          if (!SECTIONS.has(tgt)) continue;
          pop[form.name]++;
          if (!SECTIONS.get(tgt).has(sec)) {
            stale.push(where + ":" + (i + 1) + "  -> " + tgt + " §" + sec + "  [" + form.name + "]");
          }
        }
      }
    });
  }
  return { stale, pop };
}

// ── SELF-TEST BOTH WAYS FIRST, on every adopted form ────────────────────────────────────────
const selfC_bad = auditSections([{ where: "SELFTEST", lines: [
  "see [roles.md](roles.md) §99.91 here",
  "see `roles.md` §99.92 here",
  "see [`roles.md §99.93`](roles.md) here",
] }]);
ok(selfC_bad.stale.length === 3,
  "PART C self-test: an address that cannot resolve was not reported by every adopted form, so at " +
  "least one form cannot fail and its greens below are a reading of nothing",
  JSON.stringify(selfC_bad));
const selfC_good = auditSections([{ where: "SELFTEST", lines: [
  "see [roles.md](roles.md) §9 here",
  "see `roles.md` §9 here",
  "see [`roles.md §9`](roles.md) here",
] }]);
ok(selfC_good.stale.length === 0,
  "PART C self-test: an address that DOES resolve was reported stale, so a form flags everything",
  JSON.stringify(selfC_good));
// ── AND THE ADJACENCY RULE ITSELF IS SELF-TESTED, because nearness is the defect it prevents ──
const selfC_adj = auditSections([{ where: "SELFTEST", lines: [
  "`CONCEPTS.md` cited something else entirely and then `roles.md` §9 was named",
] }]);
ok(selfC_adj.stale.length === 0,
  "PART C self-test: the resolver bound an address to a filename that is NOT adjacent to it — " +
  "that is the nearest-filename defect this rule exists to avoid", JSON.stringify(selfC_adj));

// ── Then the live tree ──────────────────────────────────────────────────────────────────────
const liveC = auditSections(DOC_FILES.map((p) => ({ where: rel(p, DOCS), lines: fs.readFileSync(p, "utf8").split("\n") })));
const staleC = liveC.stale;
ok(staleC.length === 0,
  "a `§` address does not resolve in the file it names. A link checker reports these GREEN because " +
  "the address is outside the link parentheses.", JSON.stringify(staleC, null, 1));
// PREMISES, one per adopted form: a form that collects nothing reports green forever.
ok(liveC.pop.linked >= 40, "PART C reached too few LINKED citations to be reading anything",
  "population=" + liveC.pop.linked);
ok(liveC.pop["adjacent-backtick"] >= 30,
  "PART C reached too few ADJACENT-BACKTICK citations — this is the form the widening was for, " +
  "and a form that collects nothing passes forever", "population=" + liveC.pop["adjacent-backtick"]);
ok(liveC.pop["linked-in-span"] >= 1,
  "PART C reached no LINKED-IN-SPAN citations", "population=" + liveC.pop["linked-in-span"]);
// CONTROL, both directions, against a real target.
const ctlTgt = "09-roadmap.md";
ok(SECTIONS.has(ctlTgt) && SECTIONS.get(ctlTgt).has("6"),
  "PART C control: §6 must resolve in the roadmap, or the resolver answers no to everything");
ok(SECTIONS.has(ctlTgt) && !SECTIONS.get(ctlTgt).has("99.99"),
  "PART C control: §99.99 must NOT resolve, or the resolver answers yes to everything and every " +
  "green above is meaningless");
// CONTROL — the COMPOUND convention resolves, and it resolves STRUCTURALLY.
const cc = "checkpoint-contents.md";
ok(SECTIONS.has(cc) && SECTIONS.get(cc).has("1.3") && SECTIONS.get(cc).has("1.8"),
  "PART C control: the compound `§<section>.<item>` form must resolve — section 1 of " + cc +
  " is a numbered list of eight items, so §1.3 and §1.8 are items 3 and 8. Without this the " +
  "resolver reports five false positives in J51's own file, wearing the shape of J51's own bug");
// CONTROL — and the resolver must NOT be satisfied by the target merely CITING an address.
// `09-roadmap.md` once cited §1.3 (of another file); no doc does now, so this control asserts only
// that the roadmap offers no such section of its own.
ok(SECTIONS.has(ctlTgt) && !SECTIONS.get(ctlTgt).has("1.3"),
  "PART C control: a section a file merely MENTIONS must not count as one it OFFERS — that " +
  "circularity is what made the §1.3 citations resolve by coincidence rather than by structure");

// ═══ PART D — A GUARD CITING A MUTATION ROW MUST CITE A ROW THAT EXISTS ══════════════════════
// This widens the file's subject from doc cross-references to CITATIONS generally, and the reason
// is that the class is identical: an address that resolved when it was written, a target that
// moved, and nothing in between checking. The only difference is which side is prose.
//
// Mutation row ids are PER-FILE and COLLIDE across probes — `mutate-j15-dm.js` and
// `mutate-j16-active.js` both carry an `M1`, about different claims — so a bare `M6` is not an
// identifier and only the `(probe, row)` PAIR is. The probe file is where the row is DEFINED,
// which makes it the home; a guard comment naming one is a citation into it.
//
// MEASURED BEFORE BUILDING, because a property that looks stronger has twice failed on its live
// population in this file: 36 distinct `(probe, row)` citations across 14 guard files and 13
// probes, with ONE unresolved — `mutate-j11-redact` M8, a row that file's own ENVELOPE note
// records as deliberately RETIRED and replaced. A 1-in-36 rate, and the population is large
// enough to carry a control both ways. Corrected rather than exempted.
// A ROW ITS PROBE RECORDS AS RETIRED STILL RESOLVES (`── Mx retired: …`, J107): a citation of it is a record of what the
// row once caught, and the probe keeps the record of why it went. A row that is simply gone does not.
const ROWCITE = /`(mutate-[a-z0-9-]+)`/;
function auditRows(entries) {
  const seen = new Map();
  for (const { where, lines } of entries) {
    lines.forEach((line, i) => {
      const m = ROWCITE.exec(line);
      if (!m) return;
      for (const r of line.match(/\bM\d+\b/g) || []) {
        const key = m[1] + " " + r;
        if (!seen.has(key)) seen.set(key, where + ":" + (i + 1));
      }
    });
  }
  const bad = [];
  for (const [key, where] of seen) {
    const [probe, row] = key.split(" ");
    const f = path.join(APP, "tools", "probes", probe + ".js");
    if (!fs.existsSync(f)) { bad.push(where + "  " + key + "  NO SUCH PROBE"); continue; }
    const src = fs.readFileSync(f, "utf8");
    if (!(new RegExp('id: "' + row + '"').test(src) || new RegExp("── " + row + "\\b").test(src))) {
      bad.push(where + "  " + key + "  row not defined in that probe");
    }
  }
  return { bad, pop: seen.size };
}
// SELF-TEST BOTH WAYS, on synthetic input, before the live tree.
const selfD_bad = auditRows([{ where: "SELFTEST", lines: ["see `mutate-j11-redact` M999 for this"] }]);
ok(selfD_bad.bad.length === 1,
  "PART D self-test: a citation naming a row that does not exist was not reported, so this part " +
  "cannot fail", JSON.stringify(selfD_bad));
const selfD_good = auditRows([{ where: "SELFTEST", lines: ["see `mutate-j11-redact` M9 for this"] }]);
ok(selfD_good.bad.length === 0,
  "PART D self-test: a citation naming a row that DOES exist was reported bad, so this part flags " +
  "everything", JSON.stringify(selfD_good));

const GUARD_FILES = walk(path.join(APP, "tests"), /\.js$/)
  .concat(walk(path.join(APP, "tools"), /\.js$/))
  .filter((p) => path.basename(p) !== "check-doc-xrefs.js");
// THE PREMISE, TESTED DIRECTLY (J108). The live read below means something only if the walk reached both trees: `walk`
// swallows an unreadable directory and answers nothing, and a part that read nothing finds nothing dangling. This was a
// floor on the number of citations reached — a proxy denominated in what honest work removes (a retirement took cited
// rows away and the floor had to move; FAILURE-SIGNATURES' forty-seventh). So the walk is checked against an
// independent listing of the directories it must cover, which no citation can move.
{
  const direct = (d) => { try { return fs.readdirSync(d).filter((f) => f.endsWith(".js")).map((f) => path.join(d, f)); } catch (e) { return []; } };
  const must = direct(path.join(APP, "tests")).concat(direct(path.join(APP, "tools")), direct(path.join(APP, "tools", "probes")))
    .filter((p) => path.basename(p) !== "check-doc-xrefs.js");
  const missed = must.filter((p) => GUARD_FILES.indexOf(p) < 0).map((p) => rel(p, APP));
  ok(must.length > 0 && missed.length === 0,
    "PART D PREMISE — the walk reaches every .js file directly under tests/, tools/ and tools/probes/, or the live read " +
    "below reads nothing and finds nothing", missed.length ? missed.slice(0, 5) : "the listing itself found no files");
}
const liveD = auditRows(GUARD_FILES.map((p) => ({ where: rel(p, APP), lines: fs.readFileSync(p, "utf8").split("\n") })));
ok(liveD.bad.length === 0,
  "a guard cites a mutation row its probe does not define. The probe file is where a row is " +
  "DEFINED, so a citation naming one that is gone points at nothing — and because row ids are " +
  "per-file and collide, a reader cannot tell a retired row from a typo.",
  JSON.stringify(liveD.bad, null, 1));

// THE GATE, THEN THE PASS, BOTH AT THE END. Two guards in this suite printed FAIL and exited 0 because a part was appended
// BELOW their exit check — `check-setting-endpoints` and `check-presence-chat`, both found by mutating a rule and watching a
// "passing" guard stay green — so the check moved to the end here too. All three then printed PASS before it, so a failing
// run showed FAIL and then PASS; since J107 the PASS prints only past the gate. Append above the gate.
if (failed) process.exit(1);
console.log("[doc-xrefs] PASS — a citation in the docs points at something, checked four ways and " +
  "each with a control so all-green is a reading rather than an unreached walk (" + checked +
  " assertions). **PART A: a pointer from the tree to a roadmap entry names an entry that exists** (" + pointed.length +
  " pointers, none exempt, read across a comment's line breaks) — a job " +
  "number alone is a label and needs nothing, so a finished entry can be deleted once its rules have homes; the " +
  "collector is driven at a fixture of every pointer shape and a bare label (J111). " +
  "**PART B: every `file:line` locator still contains the name it cites** — twelve of fifteen " +
  "testable ones were stale at v312 with every name still present in the tree, so each claim read " +
  "sound while its address had rotted. The live population cannot carry the control (" + untestable.length +
  " of the reached citations write their name in prose rather than beside the address, so they are untestable and " +
  "are NAMED rather than counted as passing; the few that write it beside the address resolve), which is why the mechanism is " +
  "self-tested BOTH WAYS against a synthetic locator on every run instead. A +/-2 line window was " +
  "tried first and invented two findings by pulling names out of neighbouring clauses — a " +
  "proximity window is an anchor that matches whatever is nearby. **PART C: every `§` address " +
  "resolves in the file it names**, which a markdown link checker cannot see because the address " +
  "sits outside the link parentheses. **Widened beyond the linked form, and the population was " +
  "MEASURED before any rule was written**: 365 addresses existed in the doc tree when it was measured and the linked " +
  "form reached 60 of them; today it reaches " + liveC.pop.linked + ", and the remainder splits by wolf rate rather than being swept " +
  "up wholesale. ADOPTED — the adjacent-backtick form (" + liveC.pop["adjacent-backtick"] + " " +
  "citations, which is what the widening was for: it carried the one live stale address in the " +
  "tree, `roles.md` §10b against a file whose numbered headings run 0-11 and which contains that " +
  "string nowhere) and the linked-in-span form (" + liveC.pop["linked-in-span"] + ", which the " +
  "linked rule misses because the address precedes the closing paren). **REFUSED, WITH THE " +
  "NUMBERS, BECAUSE A MEASURED REFUSAL IS A RESULT** — bare same-file `§N`: 266 citations, 31 " +
  "unresolved, an 11.7% wolf rate, diagnosed NOT to be stale addresses but FOUR other things: " +
  "CHAINED addresses (`paths.md` §1b · §8c binds only the first), IMPLICIT cross-file " +
  "references carrying no filename at all, target headings this extractor cannot parse, and " +
  "COMPOUND `<section>.<item>` addresses — 85 of them tree-wide, a CONVENTION rather than a " +
  "handful, which are now RESOLVED STRUCTURALLY rather than merely documented: a numbered " +
  "section containing a numbered list offers one address per item. That last one matters most " +
  "to anyone who later adopts this class, because a resolver wanting a literal heading marker " +
  "inherits five false positives on day one, all inside J51's ORIGINAL FILE and wearing the " +
  "exact shape of J51's original bug. **And the resolver no longer counts an address a file " +
  "merely MENTIONS as one it OFFERS** — that circularity is what made those five resolve by " +
  "coincidence; removing it turned two correct citations red until the compound rule replaced " +
  "the coincidence with structure; and " +
  "the bare `file.md §N` in-span form: 2 citations, one a historical RECOUNT of J51's own §1.4 " +
  "bug which must stay green, and no mechanical rule separates an address being MENTIONED from " +
  "one being USED. **The binding is by ADJACENCY, never by nearness**, and that is self-tested: a " +
  "resolver taking the NEAREST backticked filename reads `CONCEPTS.md §1.4` where the target is " +
  "`checkpoint-contents.md`, which is PART B's rejected window arriving from a second direction. " +
  "**So J51 is closed for addresses that NAME their file, and explicitly not for the rest** — " +
  "ordinals into a list (*second*, *the third of these*) stay uncovered and rot on insertion " +
  "rather than renumbering: give a rule a name and cite the name. **PART D: a guard citing a " +
  "mutation row cites a row that EXISTS** (" + liveD.pop + " distinct `(probe, row)` citations " +
  "across the guard and probe trees: the number is reported, not gated — the walk is checked against a direct listing " +
  "of the trees instead, J108). Row ids are PER-FILE and COLLIDE, so only the pair is an " +
  "identifier and the probe file is the home; measured before building, exactly one citation was " +
  "dangling — a row its own probe records as deliberately RETIRED — and it was corrected rather " +
  "than exempted. This is the same class as PART C with the sides swapped: an address that " +
  "resolved when written, a target that moved, and nothing in between checking.");
