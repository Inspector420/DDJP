#!/usr/bin/env node
// journal/verify-s9-resolved.js — DRIVE §9's `[RESOLVED]` MARKERS, DO NOT DRAIN THEM.
//
// §9 says in its own opening that the markers were assigned **by reading for language claiming a
// fix — a heuristic, never driven.** So cutting a `[RESOLVED]` entry means trusting a marker the
// file says not to trust, and an unverified cut is a deletion. This drives each one against the
// tree instead, and RECORDS THE VERDICT EITHER WAY: a marker that fails here is a finding, not a
// reason to stop.
//
// One check per contradiction. Each names what it ran, so a green is a reading rather than an
// unreached walk — and each carries the claim it is testing in its own text, because a check whose
// subject is only in a commit message is a check nobody can re-anchor.
"use strict";
const fs = require("fs");
const path = require("path");
const APP = path.join(__dirname, "..");
let DOCS = null;
try {
  const up = path.join(APP, "..");
  for (const d of fs.readdirSync(up)) {
    if (/^docs[_-]?\d*$/.test(d) && fs.existsSync(path.join(up, d, "main", "09-roadmap.md"))) DOCS = path.join(up, d);
  }
} catch (e) { /* fall through */ }
if (!DOCS) { console.error("no doc tree found as a sibling"); process.exit(2); }

const app = (f) => fs.readFileSync(path.join(APP, f), "utf8");
// STRIP COMMENTS BEFORE SCANNING CODE. Four of this file's first five FAILs were the scan matching
// COMMENTARY — `_seenForTest` survives only in a comment recording that it was deleted, and
// `StateDeriver` appears in `ui/interface.js` only in a comment saying rule D forbids naming it.
// That is v267's own rule (**a scan that matches commentary is testing prose, not code**) arriving
// inside the instrument written to check §9. Reproduced four times in one pass, so it is stripped
// here rather than remembered.
const code = (f) => app(f).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
// AND FOR DOCS, AN ENTRY QUOTING THE TEXT IT CORRECTED IS NOT THAT TEXT SURVIVING. §9's entries
// quote the stale strings they fixed — that is what makes them worked examples — so a live claim
// is an occurrence OUTSIDE a `*"..."*` quotation.
const liveClaim = (f, needle) => {
  const s = doc(f);
  let i = -1, live = 0;
  while ((i = s.indexOf(needle, i + 1)) >= 0) {
    const before = s.slice(Math.max(0, i - 400), i);
    const quoteOpen = (before.match(/\*"/g) || []).length > (before.match(/"\*/g) || []).length;
    if (!quoteOpen) live++;
  }
  return live;
};
const doc = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");
const has = (f, re, where) => { try { return re.test((where === "doc" ? doc : app)(f)); } catch (e) { return null; } };

const results = [];
function check(id, claim, ran, verdict, detail) {
  results.push({ id, claim, ran, verdict, detail });
}

// ── A — the guard's WORDING was the fault; the row names the branch, maySeal carries a pointer ──
{
  const spine = app("tests/check-spine.js");
  const cp = app("backends/backend1/checkpoint.js");
  const ownerOnly = /owner/i.test(spine) && /maySeal|seal/i.test(spine);
  const pointer = /checkpoint-contents|trust-cascade|\.md/.test(cp.slice(Math.max(0, cp.indexOf("maySeal") - 2000), cp.indexOf("maySeal") + 2000));
  check("A", "J01 reworded the seal row to name the branch and added a doc pointer in `maySeal`.",
    "grep check-spine.js for the seal row; read 2k chars around `maySeal` in checkpoint.js for a doc pointer",
    ownerOnly && pointer ? "HOLDS" : "FAILS", "row-names-branch=" + ownerOnly + " maySeal-pointer=" + pointer);
}

// ── B — J02 REMOVED the third floor outcome; a backwards replacement announces `demoted` ──────
{
  const floor = code("backends/backend1/floor.js");
  // The BACKWARDS case is the subject: it must route into `_weakened`, and `_weakened` must
  // announce `demoted`. A bare search for the word "moved" tests vocabulary rather than the
  // decision — floor.js legitimately emits `moved` on the FORWARD revalidation, which is a
  // different outcome and not the third path J02 removed.
  //
  // SUPERSEDED IN HALF AT v321, AND THE CHECK IS NARROWED RATHER THAN LOOSENED. J54 gave the
  // backwards case a second outcome: a client that STILL HOLDS EVERYTHING retreats to the older
  // verifying floor instead of being weakened by it. So "routes into `_weakened`" is no longer
  // unconditionally true and this entry went red — correctly, because a recorded resolution had
  // stopped describing the tree.
  //
  // What J02 actually removed was the third path that announced a backwards replacement as `moved`,
  // letting the trim boundary follow the floor DOWN. THAT is still gone and is what this now
  // asserts: the backwards branch must NOT emit `moved`, the trimmed case must still route into
  // `_weakened`, and `_weakened` must still announce `demoted`. Testing the retreat itself is
  // `check-floor-retreat`'s job; this entry stays about the contradiction it was filed for.
  const backwardsBranch = /_pos\(f\)\s*<\s*_pos\(_trusted\)\)\s*\{/.test(floor);
  const trimmedStillWeakens = /if\s*\(!stillHoldAll\)\s*return\s*_weakened\(/.test(floor);
  const demoted = /_emit\("demoted"/.test(floor);
  // THE BRANCH IS EXTRACTED BY BRACE MATCHING, NOT BY A CHARACTER WINDOW. Written first as
  // `[\s\S]{0,400}?` after the comparison — and it reported `never-moved=true` with `_emit("moved")`
  // put back on that very branch, because the body is longer than the window. A window is a proxy
  // for "inside this branch" and it fails SILENTLY in the safe-looking direction, which is the
  // shape this file exists to catch. Driven both ways after the change.
  const backwardsNeverMoved = (function () {
    const m = /_pos\(f\)\s*<\s*_pos\(_trusted\)\)\s*\{/.exec(floor);
    if (!m) return false;                       // no branch found is not a pass
    let depth = 0, start = floor.indexOf("{", m.index);
    for (let i = start; i < floor.length; i++) {
      if (floor[i] === "{") depth++;
      else if (floor[i] === "}") { depth--; if (depth === 0) return !/_emit\("moved"/.test(floor.slice(start, i + 1)); }
    }
    return false;                               // unbalanced is not a pass either
  })();
  const noMovedThird = backwardsBranch && trimmedStillWeakens && backwardsNeverMoved;
  check("B", "J02 removed the third floor path; a backwards replacement never announces `moved`, and a client that has already forgotten still routes into conditional retraction announcing `demoted`. (v321: an untrimmed client now RETREATS instead — `check-floor-retreat`.)",
    "grep comment-stripped floor.js: does the backwards comparison sit in a branch that never emits `moved`, does the trimmed case still route into `_weakened`, and does `_weakened` emit `demoted`?",
    demoted && noMovedThird ? "HOLDS" : "FAILS", "backwards-branch=" + backwardsBranch + " trimmed-still-weakens=" + trimmedStillWeakens + " never-moved=" + backwardsNeverMoved + " _weakened-emits-demoted=" + demoted);
}

// ── E — the blocked declaration carries a reason, AND play.blocked stays CRITICAL ─────────────
{
  const sd = app("backends/backend1/statederiver.js");
  const vouch = app("backends/backend1/vouch.js");
  const carriesReason = /BLOCKED_REASONS/.test(sd);
  // NON_CRITICAL_TYPES is an EXCLUSION list: absence means critical.
  const seg = vouch.slice(vouch.indexOf("NON_CRITICAL_TYPES"), vouch.indexOf("NON_CRITICAL_TYPES") + 600);
  const blockedAbsent = !/play\.blocked/.test(seg);
  check("E", "The blocked declaration carries a typed reason, and `ddjp.play.blocked` is ABSENT from `NON_CRITICAL_TYPES` — an exclusion list, so absence means critical and protected.",
    "grep statederiver.js for BLOCKED_REASONS; read the NON_CRITICAL_TYPES declaration in vouch.js and check play.blocked is not in it",
    carriesReason && blockedAbsent ? "HOLDS" : "FAILS", "reason-vocabulary=" + carriesReason + " play.blocked-excluded-from-noncritical=" + blockedAbsent);
}

// ── F — grab destinations are built (the playlist picker exists) ──────────────────────────────
{
  const built = /_openLibraryIO|addToPlaylist|add-to-playlist/i.test(app("ui/interface.js"));
  const described = /picker|playlist/i.test(doc("main/04-features.md"));
  check("F", "Grab destinations are BUILT and `04-features.md` already describes the picker.",
    "grep ui/interface.js for the picker declarations; grep 04-features.md for the description",
    built && described ? "HOLDS" : "FAILS", "picker-in-tree=" + built + " described=" + described);
}

// ── G — kick and ban EXIST in the gate table and in capabilities ──────────────────────────────
{
  const ranks = app("backends/backend1/ranks.js");
  const kick = /member\.kick/.test(ranks), ban = /member\.ban/.test(ranks);
  check("G", "J14 built both halves: `member.kick` and `member.ban` now exist in `Ranks.GATES`, where the earlier draft wrongly said they already did.",
    "grep ranks.js for member.kick and member.ban",
    kick && ban ? "HOLDS" : "FAILS", "kick=" + kick + " ban=" + ban);
}

// ── H — `heldCheckpoints()` exists as production; `_seenForTest` was DELETED, not left beside ──
{
  const floor = code("backends/backend1/floor.js");
  const prod = /heldCheckpoints/.test(floor);
  const seamGone = !/_seenForTest/.test(floor);
  check("H", "J26 added `Floor.heldCheckpoints()` and DELETED `_seenForTest()` rather than leaving the two side by side.",
    "grep COMMENT-STRIPPED floor.js — the deleted seam survives only in a comment recording its removal",
    prod && seamGone ? "HOLDS" : "FAILS", "heldCheckpoints=" + prod + " _seenForTest-deleted=" + seamGone);
}

// ── I — README's doc map carries both newer documents ─────────────────────────────────────────
{
  const r = doc("README.md");
  const both = /FAILURE-SIGNATURES\.md/.test(r) && /SPINE\.md/.test(r);
  check("I", "`README.md`'s doc map carries both newer documents.",
    "grep README.md for FAILURE-SIGNATURES.md and SPINE.md",
    both ? "HOLDS" : "FAILS", "both-in-doc-map=" + both);
}

// ── N — the gate is DERIVED rather than restated, and §5 points at the scan ───────────────────
{
  const gateDerives = /Kind/.test(app("tests/check-roadmap-gate.js"));
  const rm = doc("main/09-roadmap.md");
  const noHardList = liveClaim("main/09-roadmap.md", "That list today is") === 0;
  check("N", "§5 stopped restating the gate list and points at the derivation; the hand-written 'J02, J03 (outstanding)' copy is gone.",
    "grep check-roadmap-gate.js for the Kind derivation; count LIVE (unquoted) occurrences of the old hand-written list",
    gateDerives && noHardList ? "HOLDS" : "FAILS", "derived=" + gateDerives + " old-copy-gone=" + noHardList);
}

// ── O — the bump rule is DERIVED from the tag set, not from the four-directory restatement ─────
{
  const bd = doc("main/08-build-and-deploy.md");
  const derived = /\?v=/.test(bd) && /app\.js/.test(bd) && /sw-register\.js/.test(bd);
  const noStale44 = !/44 tagged|of the 44|all 44/.test(bd);
  check("O", "The version-bump rule names the two files outside the four directories and no longer writes the tag-set count out as a numeral.",
    "grep 08-build-and-deploy.md for app.js / sw-register.js and for any surviving '44' count",
    derived && noStale44 ? "HOLDS" : "FAILS", "names-both-loose-files=" + derived + " no-stale-44=" + noStale44);
}

// ── P — the roadmap no longer pastes the gate's output as a copy ───────────────────────────────
{
  const rm = doc("main/09-roadmap.md");
  const noPastedOutput = liveClaim("main/09-roadmap.md", "which now prints") === 0;
  check("P", "P1's pasted gate output ('which now prints J10 · J19 · J37') was corrected in place and is not restated.",
    "count LIVE (unquoted) occurrences of the pasted gate output — an entry quoting what it fixed is not that text surviving",
    noPastedOutput ? "HOLDS" : "FAILS", "pasted-copy-gone=" + noPastedOutput);
}

// ── Q — HANDOFF's heading agrees with the tree's own `?v=` tags ────────────────────────────────
{
  const idx = app("index.html");
  const tags = [...new Set((idx.match(/\?v=(\d+)/g) || []).map((t) => t.slice(3)))];
  const h = doc("HANDOFF.md").split("\n")[0];
  const m = h.match(/\?v=(\d+)/);
  const agree = tags.length === 1 && m && m[1] === tags[0];
  check("Q", "The failure Q records — a package headed with one `?v=` while the tree carried another — is not present: HANDOFF's heading agrees with index.html.",
    "read every ?v= tag from index.html (expect one distinct value) and compare against HANDOFF.md's first line",
    agree ? "HOLDS" : "FAILS", "tree=" + JSON.stringify(tags) + " handoff-heading=" + (m ? m[1] : "none"));
}

// ── S — rule D holds: ui/ does not name the reducer, and the fold lives in features/room.js ────
{
  const ui = code("ui/interface.js");
  const namesReducer = /StateDeriver/.test(ui);
  const foldInFeature = /foldActivity/.test(app("features/room.js"));
  check("S", "J13 was built against the corrected field and never went near rule D: the fold lives in `features/room.js` and `ui/` does not name `StateDeriver`.",
    "grep COMMENT-STRIPPED ui/interface.js for StateDeriver; grep features/room.js for foldActivity",
    !namesReducer && foldInFeature ? "HOLDS" : "FAILS", "ui-names-StateDeriver=" + namesReducer + " fold-in-features/room.js=" + foldInFeature);
}

// ── T — CORRECTED IN THE DOCS, OWED IN THE CODE. Both halves are asserted, separately. ─────────
{
  const docsFixed = ["main/03-modules.md", "main/05-matrix.md"].every((f) => {
    const s = doc(f);
    return !/cannot send state events[^.]{0,120}move power levels[^.]{0,200}state_default/i.test(s);
  });
  const header = app("backends/backend1/ranks.js").slice(0, 4000);
  const codeStillOwed = /state_default/.test(header);
  check("T", "Corrected in the docs and OWED in the code — the entry says both, so both are checked: the doc claims are gone AND `ranks.js`'s header is expected to still carry the wrong mechanism.",
    "grep 03-modules.md and 05-matrix.md for the old state_default attribution; read the first 4k of ranks.js for it",
    docsFixed ? "HOLDS" : "FAILS",
    "docs-corrected=" + docsFixed + " ranks.js-header-still-owed=" + codeStillOwed +
    (codeStillOwed ? " (owed, as the entry states)" : " (the owed half appears DISCHARGED — the entry is now understating the tree)"));
}

// ── Report ────────────────────────────────────────────────────────────────────────────────────
const w = Math.max(...results.map((r) => r.claim.length));
let fails = 0;
for (const r of results) {
  if (r.verdict !== "HOLDS") fails++;
  console.log(`[${r.id}] ${r.verdict}`);
  console.log(`     claim: ${r.claim}`);
  console.log(`     ran  : ${r.ran}`);
  console.log(`     read : ${r.detail}`);
}
console.log("\n" + results.length + " `[RESOLVED]` markers driven against the tree — " +
  (results.length - fails) + " HOLD, " + fails + " FAIL.");
process.exit(0);
