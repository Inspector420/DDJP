// tools/mutate-residue.js — WHAT A SWEEP LEAVES BEHIND, AND WHETHER ANYBODY STILL OWNS IT.
//
// `tools/mutate-comparisons.js` writes three markers into `tools/` while it runs: the original of
// the file it is mutating (`.mutate-inflight.bak`), a record of where and how (`.mutate-inflight.json`),
// and its own pid (`.mutate.pid`). A clean exit removes all three. A KILLED one removes none — a
// `finally` does not run on SIGKILL, a container suspend, or a harness that reaps a background job
// when the command that started it returns — and the file being mutated stays mutated.
//
// ── WHY THIS IS ITS OWN FILE ─────────────────────────────────────────────────────────────────
// Two callers need the same answer: the sweep, deciding at startup whether to recover or refuse,
// and `tests/check-sweep-residue.js`, deciding whether the suite is looking at a tree somebody left
// mid-mutation. One rule, one home (P7). And the guard must NEVER load the sweep itself — that file
// runs a sweep on load, so a guard that required it would start mutating the tree from inside
// `run-all`. So the rule lives here, where requiring it does nothing but define it.
//
// ── THE STATES, AND WHO MAY PROCEED IN EACH ──────────────────────────────────────────────────
//   clean        no marker at all
//   own-sweep    a live pid file naming `ownPid` — the caller IS the sweep, or is its child
//   other-sweep  a live pid file naming somebody else — a sweep owns the tree right now
//   crashed      an inflight record with no live owner — a file IS (or may be) mutated
//   stale-pid    only a pid file, and its process is gone — the tree is clean, the run died
//
// OWNERSHIP IS "IS THIS MY PARENT", NOT "IS THIS PID ALIVE", and that is what makes it safe. A pid
// that is merely alive could be a recycled number belonging to anything, and that reading fails
// toward a PASS over a mutated tree — the dangerous direction. The sweep spawns each guard directly,
// so a guard run BY the sweep sees the sweep as its parent; a person running `run-all` while a sweep
// holds the tree does not, and is told so rather than handed a verdict about mutated code.

const fs = require("fs");
const path = require("path");

const TOOLS_DIR = __dirname;
const NAMES = { inflight: ".mutate-inflight.json", bak: ".mutate-inflight.bak", pid: ".mutate.pid" };

function paths(dir) {
  const d = dir || TOOLS_DIR;
  return { inflight: path.join(d, NAMES.inflight), bak: path.join(d, NAMES.bak), pid: path.join(d, NAMES.pid) };
}

// EPERM means the process exists and we may not signal it — alive. Anything else thrown — ESRCH
// above all — means there is no such process.
function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return !!e && e.code === "EPERM"; }
}

function residue(ownPid, dir) {
  const p = paths(dir);
  const hasInflight = fs.existsSync(p.inflight);
  const hasPid = fs.existsSync(p.pid);
  if (!hasInflight && !hasPid) return { state: "clean", paths: p };
  let pid = null;
  if (hasPid) {
    const n = Number(String(fs.readFileSync(p.pid, "utf8")).trim());
    pid = Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  let rec = null;
  if (hasInflight) {
    try { rec = JSON.parse(fs.readFileSync(p.inflight, "utf8")); } catch (e) { rec = null; }
  }
  if (pid !== null && pid === ownPid) return { state: "own-sweep", pid, rec, paths: p };
  if (pid !== null && alive(pid)) return { state: "other-sweep", pid, rec, paths: p };
  return { state: hasInflight ? "crashed" : "stale-pid", pid, rec, paths: p };
}

module.exports = { NAMES, paths, alive, residue };
