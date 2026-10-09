// tests/_docs.js
// WHERE THE DOC TREE IS — resolved once, for every guard that needs it.
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────
// Three guards needed to find the docs and three guards answered it separately.
// `check-roadmap-gate` and `check-doc-xrefs` each carried the same glob; `check-vendor-build`
// carried a HARDCODED `docs_343`.
//
// That third one is the reason this file exists rather than being a tidy. The packaging
// convention in `main/08-build-and-deploy.md` is that a package name tracks the TREE, so every
// package renumbers `docs_NNN/` — and the first person to follow that convention got an ENOENT
// from a guard, on a tree where nothing was wrong. **A build rule that breaks the build when
// obeyed is worse than a missing rule**, and it was invisible for as long as nobody renumbered,
// which is exactly the shape of a dead copy: the thing that would have corrected it is use.
//
// It is also the project's own `one rule, one place` arriving in the test tree. Two copies had
// already been made and had already disagreed; a third would have been written the next time
// somebody needed a doc path.
//
// ── WHAT IT DOES NOT DECIDE ─────────────────────────────────────────────────────────────────
// Only WHERE the docs are. Whether their absence is a failure, and what to do when two trees are
// reachable and disagree, stay with the callers — `check-roadmap-gate` refuses rather than picking
// between two differing roadmaps, and that judgement belongs to the guard that has to report it.
// This returns every root it found, in candidate order, and says nothing about which is right.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

// The three shapes a doc tree has been found in, in the order they are preferred:
//   1. inside the tree            ddjp_NNN/docs/
//   2. a sibling named `docs`     docs/            (a working checkout)
//   3. a sibling named `docs_NNN` docs_343/        (a fresh extraction of a package)
//
// The third is a GLOB rather than a name, and that is the whole point — it is the one that
// renumbers. `^docs[_-]?\d*$` also matches a bare `docs`, which is harmless: candidate 2 already
// covers it and `docRoots` de-duplicates.
function docRoots() {
  const out = [];
  const add = (p) => { if (p && out.indexOf(p) < 0 && fs.existsSync(p)) out.push(p); };
  add(path.join(ROOT, "docs"));
  add(path.join(ROOT, "..", "docs"));
  try {
    const up = path.join(ROOT, "..");
    for (const d of fs.readdirSync(up).sort()) {
      if (/^docs[_-]?\d*$/.test(d)) add(path.join(up, d));
    }
  } catch (e) { /* no parent to scan; whatever was added above still stands */ }
  return out;
}

// Every existing path for one doc, across every root. Callers that must refuse on disagreement
// (rather than take the first) need the whole list, so this returns all of them.
function docPaths(rel) {
  return docRoots().map((r) => path.join(r, rel)).filter((p) => fs.existsSync(p));
}

// Where a guard looked, for a failure message. A guard that says "not found" without saying where
// it looked is making a claim it cannot support — `check-roadmap-gate` names this explicitly and
// this keeps that possible for every caller.
function searchedFor(rel) {
  const up = path.join(ROOT, "..");
  return [path.join(ROOT, "docs", rel), path.join(up, "docs", rel),
          path.join(up, "docs_<N>", rel) + "  (any `docs_NNN` sibling)"];
}

module.exports = { ROOT, docRoots, docPaths, searchedFor };
