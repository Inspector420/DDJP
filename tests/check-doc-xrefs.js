#!/usr/bin/env node
// tests/check-doc-xrefs.js — DOES A CITATION IN THE DOCS POINT AT ANYTHING?
//
// J51's Done-when, plus the two neighbouring classes that have actually bitten. Until this file
// existed, `check-roadmap-gate` was the ONLY machine check on the doc tree and it reads one file
// for one field. This class has been found by hand three times, each by a different ad-hoc probe:
//
//   · `v275` — its only two roadmap occurrences were its heading and its `**Touches (v275).**`
//     line. `Touches` is on the drain's drop list, so draining it AND dropping the heading would
//     have made the token vanish and turned `FAILURE-SIGNATURES.md`'s "recorded in the v275 entry"
//     into a dangling citation. **Broken by two rules interacting, neither wrong alone.**
//   · `v292` — cited by `check-origin-fold.js` as "v292's M7"; its only roadmap home was inside a
//     section being drained.
//   · `§1.4` — cited from `CONCEPTS.md` for twelve releases against a file with sections 0–6. A
//     markdown link checker reports it GREEN, because the address sits outside the link
//     parentheses: the file resolves and the address after it is prose to every tool that exists.
//
// ── WHY THIS IS NOT `journal/drain-check.js` RENAMED ────────────────────────────────────────
// That tool is a DIFF: it compares a before and an after and asks what fell to zero. A guard has
// no "before" — it runs on one tree — so the property had to be re-expressed as a STATIC one:
// **a citation that points at something absent**, computable from the tree alone. That is
// strictly stronger, and it is what lets this file catch all three cases above rather than only
// the ones that happen to be mid-edit. `drain-check.js` stays, because during a pass the diff
// question ("did MY cut strand this?") is the one being asked.
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
const DOC_TEXT = DOC_FILES.map((p) => fs.readFileSync(p, "utf8")).join("\n");
const rel = (p, root) => path.relative(root, p).split(path.sep).join("/");

// ═══ PART A — A DOC-HOMED TOKEN CITED FROM THE TREE MUST EXIST IN THE DOC TREE ═══════════════
// `vNNN` release markers and `JNN` job ids have their home in the docs. Guard and probe names do
// NOT belong here and are deliberately excluded: `check-origin-fold` ceasing to be named in prose
// strands nothing, because the guard is a file. The test is whether the citation's TARGET exists,
// not whether prose happens to mention it.
//
// EXEMPTIONS CARRY THEIR REASON AND THE LIST IS ASSERTED EXHAUSTED. An exemption that outlives
// its citation fails here, because a list of one silently becoming a list of twenty is how a
// guard stops meaning anything.
//
// EMPTY, AND IT EMPTIED ITSELF. `v284` was exempt because `ui/interface.js` cited it and the doc
// tree carried it nowhere. J17's discharged-debt block now states the v284 correction by name, so
// the token resolves through the real assertion and the exemption became stale in the direction
// this guard checks second — it went red on its own and named itself, which is the list staying
// honest rather than a chore anyone remembered.
//
// WHAT IS NOT DISCHARGED: the comment `_resetChatState IS DECIDED, NOT PARKED AGAIN (v284)` still
// names a release with no roadmap ENTRY of its own — the drained narrative block ends at v283.
// PART A tests whether a citation's target EXISTS, not whether it has an entry, so that is outside
// what this assertion can see. Correcting the comment is a COMMENT-ONLY edit to a `?v=`-tagged file
// and carries a deploy bump, so it stays owed rather than taken silently: fold it into the next job
// that touches ui/interface.js for its own reasons.
const EXEMPT = {};
const tokensFrom = (s) =>
  new Set([...(s.match(/\bv\d{3}\b/g) || []), ...(s.match(/\bJ\d{2}\b/g) || [])]);
const cited = new Map();
for (const p of APP_FILES) {
  for (const t of tokensFrom(fs.readFileSync(p, "utf8"))) {
    if (!cited.has(t)) cited.set(t, rel(p, APP));
  }
}
const hasToken = (t) => new RegExp("\\b" + t + "\\b").test(DOC_TEXT);
const danglingA = [...cited.entries()].filter(([t]) => !hasToken(t) && !EXEMPT[t]);
ok(danglingA.length === 0,
  "a doc-homed token is cited from the tree and exists NOWHERE in the doc tree, so a reader " +
  "following it finds nothing. This is the v275/v292 shape: an entry was removed and its " +
  "citations were not. Restore the entry, or stop citing it.",
  JSON.stringify(danglingA));
// The exemption list must stay honest in BOTH directions.
for (const t of Object.keys(EXEMPT)) {
  ok(cited.has(t), "`" + t + "` is exempted in PART A and nothing in the tree cites it any more — " +
    "an exemption that outlives its citation is how a list of one becomes a list of twenty. " +
    "Delete the entry.", EXEMPT[t]);
  ok(!hasToken(t), "`" + t + "` is exempted in PART A but the doc tree now DOES carry it, so the " +
    "exemption is stale and the real assertion should be doing this work.", EXEMPT[t]);
}
// PREMISE: this part must have reached a real population, or "none dangling" is a reading of an
// empty set. Not hypothetical — a guard whose collection is empty reports green forever.
ok(cited.size >= 40, "PART A collected too few doc-homed tokens to be reading anything; the scan " +
  "is not reaching the tree", "collected=" + cited.size);
// CONTROL, both directions: a token that cannot exist must be caught, and a real one must not.
ok(!hasToken("v999"), "PART A control: `v999` must not resolve, or the resolver answers yes to " +
  "everything and every green above is meaningless");
ok(hasToken("J17"), "PART A control: `J17` must resolve, or the resolver answers no to everything " +
  "and PART A is flagging the whole tree rather than reading it");

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
// Only three distinct locators survive in the doc tree and NONE is mechanically testable: their
// cited names are implied by prose ("actually SENT at ...") rather than written beside them. So a
// live-only PART B would filter its whole population away and report green — the exact shape of a
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
const popB = staleB.length + untestable.length;
ok(staleB.length === 0,
  "a `file:line` locator no longer points at the name it cites. The name still exists \u2014 only the " +
  "address rotted, which is why the claim reads sound. Cite the name, not the line (J51).",
  JSON.stringify(staleB, null, 1));

// ═══ PART C — A `§` ADDRESS MUST RESOLVE IN THE FILE IT NAMES ════════════════════════════════
// J51's original subject. A markdown link checker passes these because the address sits OUTSIDE
// the link parentheses — the file resolves and `§1.4` after it is prose to every tool that exists.
//
// ── THE POPULATION, MEASURED, AND MOST OF IT IS REFUSED ─────────────────────────────────────
// 365 `§` addresses exist in the doc tree. The linked form reaches 60. The other 305 were
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
//   resolver that wants a literal `1.3` heading marker inherits five false positives on day one,
//   all of them in `checkpoint-contents.md`, which is J51's ORIGINAL FILE — and they wear the
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
// finds nothing and reports five false positives across the tree, in J51's original file, wearing
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
const popC = liveC.pop.linked + liveC.pop["adjacent-backtick"] + liveC.pop["linked-in-span"];
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
// `09-roadmap.md` cites §1.3 (of another file) and offers no such section of its own.
ok(SECTIONS.has(ctlTgt) && !SECTIONS.get(ctlTgt).has("1.3"),
  "PART C control: a section a file merely MENTIONS must not count as one it OFFERS — that " +
  "circularity is what made the §1.3 citations resolve by coincidence rather than by structure");

// ═══ PART D — A GUARD CITING A MUTATION ROW MUST CITE A ROW THAT EXISTS ══════════════════════
// This widens the file's subject from doc cross-references to CITATIONS generally, and the reason
// is that the class is identical: an address that resolved when it was written, a target that
// moved, and nothing in between checking. The only difference is which side is prose.
//
// Mutation row ids are PER-FILE and COLLIDE across probes — `mutate-j15-dm.js` and
// `mutate-j16-active.js` both carry an `M15`, about different claims — so a bare `M6` is not an
// identifier and only the `(probe, row)` PAIR is. The probe file is where the row is DEFINED,
// which makes it the home; a guard comment naming one is a citation into it.
//
// MEASURED BEFORE BUILDING, because a property that looks stronger has twice failed on its live
// population in this file: 36 distinct `(probe, row)` citations across 14 guard files and 13
// probes, with ONE unresolved — `mutate-j11-redact` M8, a row that file's own ENVELOPE note
// records as deliberately RETIRED and replaced. A 1-in-36 rate, and the population is large
// enough to carry a control both ways. Corrected rather than exempted.
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
const liveD = auditRows(GUARD_FILES.map((p) => ({ where: rel(p, APP), lines: fs.readFileSync(p, "utf8").split("\n") })));
ok(liveD.bad.length === 0,
  "a guard cites a mutation row its probe does not define. The probe file is where a row is " +
  "DEFINED, so a citation naming one that is gone points at nothing — and because row ids are " +
  "per-file and collide, a reader cannot tell a retired row from a typo.",
  JSON.stringify(liveD.bad, null, 1));
ok(liveD.pop >= 25, "PART D reached too few `(probe, row)` citations to be reading anything",
  "population=" + liveD.pop);

// MOVED TO THE LAST LINE. Two guards in this suite have now printed FAIL and exited 0 because a
// part was appended BELOW their exit check — `check-setting-endpoints` and
// `check-presence-chat`, both found by mutating a rule and watching a "passing" guard stay
// green. Nothing was stranded here yet; that is luck, not structure.
console.log("[doc-xrefs] PASS — a citation in the docs points at something, checked three ways and " +
  "each with a control so all-green is a reading rather than an unreached walk (" + checked +
  " assertions). **PART A: a doc-homed token cited from the tree exists in the doc tree** — " +
  "driven, removing every doc mention of `v292` turns this red naming `check-origin-fold.js`, " +
  "which cites it. **AND THE LIMIT OF THAT IS MEASURED RATHER THAN GLOSSED: it catches TOTAL " +
  "absence only.** Deleting `v275`'s roadmap heading leaves this GREEN, because " +
  "`FAILURE-SIGNATURES.md` and `HANDOFF.md` still name the token — a citation keeps its own " +
  "target alive, so EXISTENCE is a weaker property than the SURVIVAL that actually bit. Requiring " +
  "an entry heading instead was measured and refused: 13 of 30 possessive citations name releases " +
  "that never had one (`v288`, `v285`, `v239`), and a guard crying wolf at that rate gets " +
  "disabled. **So the remaining half is a DIFF question and stays with `journal/drain-check.js`** " +
  "— *did MY cut strand this?* — which is why that tool was not deleted when this one was " +
  "written; the two are complementary and neither covers the other. Guard and probe names are " +
  "excluded on purpose: their home is the tree, so prose ceasing to name one strands nothing. " +
  "**PART B: every `file:line` locator still contains the name it cites** — twelve of fifteen " +
  "testable ones were stale at v312 with every name still present in the tree, so each claim read " +
  "sound while its address had rotted. The live population cannot carry the control (all " + popB +
  " reached citations write their name in prose rather than beside the address, so " + untestable.length +
  " are untestable and are NAMED rather than counted as passing), which is why the mechanism is " +
  "self-tested BOTH WAYS against a synthetic locator on every run instead. A +/-2 line window was " +
  "tried first and invented two findings by pulling names out of neighbouring clauses — a " +
  "proximity window is an anchor that matches whatever is nearby. **PART C: every `§` address " +
  "resolves in the file it names**, which a markdown link checker cannot see because the address " +
  "sits outside the link parentheses. **Widened beyond the linked form, and the population was " +
  "MEASURED before any rule was written**: 365 addresses exist in the doc tree, the linked form " +
  "reaches " + liveC.pop.linked + ", and the remainder splits by wolf rate rather than being swept " +
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
  "across the guard and probe trees). Row ids are PER-FILE and COLLIDE, so only the pair is an " +
  "identifier and the probe file is the home; measured before building, exactly one citation was " +
  "dangling — a row its own probe records as deliberately RETIRED — and it was corrected rather " +
  "than exempted. This is the same class as PART C with the sides swapped: an address that " +
  "resolved when written, a target that moved, and nothing in between checking.");


if (failed) process.exit(1);   // LAST LINE: appending a part cannot get underneath this