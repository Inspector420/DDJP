// tests/check-sweep-residue.js
// SUBJECT: tools/mutate-residue.js, tools/mutate-comparisons.js
// WALL: the suite refuses to vouch for a tree that a mutation sweep left mid-mutation.
//
// ── WHY THIS EXISTS: A GREEN SUITE OVER A MUTATED FILE, AND NOTHING TO SAY SO ────────────────
// Observed while building `ddjp_415`. A backgrounded `tools/mutate-comparisons.js` was reaped by the harness
// when the command that started it returned, mid-trial: `backends/backend2/authority.js` stayed
// mutated (`_buf.length > MAX_PENDING` flipped to `>=`), and the pid file stayed behind. That flip
// is one the suite does not kill — so `node tests/run-all.js` would have printed every guard green
// over a tree carrying it, and a package built from that tree would have shipped it. It was caught
// by a digest the session happened to take, which is not a mechanism. The sweep's own recovery only
// runs when somebody next starts the sweep.
//
// ── WHAT IS CHECKED, AND WHERE ───────────────────────────────────────────────────────────────
//   A  the rule (`mutate-residue.js`), driven against FIXTURE markers in a temp directory
//   B  the REAL sweep's recovery and refusal, driven in a throwaway COPY of the tree — never the real
//      one. This guard runs as a child of any live sweep, and planting markers in the real `tools/`
//      would overwrite that sweep's backup of the file it is mutating.
//   C  the real `tools/` directory: clean, or owned by the sweep that is running THIS guard
//
// Ownership is "the pid file names my PARENT", not "the pid is alive" — see `mutate-residue.js` for
// why the second fails toward a pass. The sweep spawns each guard directly, so under a live sweep
// this guard's parent is the sweep; a person running `run-all` while a sweep holds the tree is not,
// and gets a FAIL naming the owner instead of a verdict about mutated code.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const Residue = require(path.join(ROOT, "tools", "mutate-residue.js"));

let failed = 0, assertions = 0;
function ok(cond, msg, got) {
  assertions++;
  if (!cond) { failed++; console.log("  ✗ " + msg + (got === undefined ? "" : " — got " + JSON.stringify(got))); }
}

// A pid that is certainly dead: a child that has already exited. Admissibility, not an assertion —
// if the OS has already handed the number to something else, the fixtures below mean nothing.
function deadPid() {
  for (let i = 0; i < 5; i++) {
    const r = spawnSync(process.execPath, ["-e", ""]);
    if (r.pid && !Residue.alive(r.pid)) return r.pid;
  }
  return null;
}
const DEAD = deadPid();
const MINE = process.pid;           // alive, and never the owner the tool or a fixture is asked about

const tmpRoots = [];
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), "ddjp-residue-")); tmpRoots.push(d); return d; }

try {
  if (DEAD === null) {
    ok(false, "PREMISE — could not obtain a pid known to be dead; parts A and B cannot be driven");
  } else {
    // ── PART A — the rule ──────────────────────────────────────────────────────────────────
    const plant = (dir, o) => {
      const p = Residue.paths(dir);
      if (o.inflight) fs.writeFileSync(p.inflight, JSON.stringify({ rel: "x.js", line: 1, from: "<", to: "<=" }));
      if (o.inflight) fs.writeFileSync(p.bak, "original");
      if (o.pid !== undefined) fs.writeFileSync(p.pid, String(o.pid));
      return dir;
    };
    const OWN = 424242;              // the pid the caller claims to be; never a real owner below
    const cases = [
      ["no markers",                           {},                               "clean"],
      ["pid file naming the caller",           { pid: OWN },                     "own-sweep"],
      ["pid file naming the caller, mid-trial",{ pid: OWN, inflight: true },     "own-sweep"],
      ["a LIVE pid that is not the caller",    { pid: MINE, inflight: true },    "other-sweep"],
      ["inflight, owner dead",                 { pid: DEAD, inflight: true },    "crashed"],
      ["inflight, no pid file at all",         { inflight: true },               "crashed"],
      ["inflight, pid file unreadable",        { pid: "not-a-pid", inflight: true }, "crashed"],
      ["only a pid file, owner dead",          { pid: DEAD },                    "stale-pid"],
    ];
    for (const [what, o, want] of cases) {
      const got = Residue.residue(OWN, plant(tmp(), o)).state;
      ok(got === want, "A: " + what + " must read as `" + want + "`", got);
    }
    // THE RECYCLED-PID HAZARD, stated as its own row because it is the reason ownership is "my
    // parent" and not "alive": a live number that is not the caller must never read as ownership.
    ok(Residue.residue(OWN, plant(tmp(), { pid: MINE, inflight: true })).state !== "own-sweep",
       "A: an alive-but-foreign pid must not be mistaken for the caller's own sweep");

    // ── PART B — the real sweep, in a throwaway copy ───────────────────────────────────────
    // The copy holds the two real tool files and a one-file scope, so `--list` has something to
    // list and ROOT resolves to the copy. `--list` never runs a guard; recovery runs before it.
    const ORIG = "const a = 1, b = 2;\nif (a < b) {}\n";
    const MUT = ORIG.replace("a < b", "a <= b");
    const copy = () => {
      const r = tmp();
      fs.mkdirSync(path.join(r, "tools"));
      fs.mkdirSync(path.join(r, "scope"));
      for (const f of ["mutate-comparisons.js", "mutate-residue.js"]) {
        fs.copyFileSync(path.join(ROOT, "tools", f), path.join(r, "tools", f));
      }
      fs.writeFileSync(path.join(r, "scope", "x.js"), MUT);   // the mutation a crash left behind
      return r;
    };
    const plantIn = (r, pid) => {
      const p = Residue.paths(path.join(r, "tools"));
      fs.writeFileSync(p.bak, ORIG);
      fs.writeFileSync(p.inflight, JSON.stringify({ rel: "scope/x.js", at: 18, line: 2, from: "<", to: "<=" }));
      if (pid !== undefined) fs.writeFileSync(p.pid, String(pid));
      return p;
    };
    const runTool = (r) => spawnSync(process.execPath,
      [path.join(r, "tools", "mutate-comparisons.js"), "--scope", "scope", "--list"],
      { encoding: "utf8", timeout: 30000 });
    const left = (p) => [p.inflight, p.bak, p.pid].filter((f) => fs.existsSync(f)).map((f) => path.basename(f));

    // B1 — a crash: restored, announced, and every marker gone.
    {
      const r = copy(); const p = plantIn(r, DEAD);
      const out = runTool(r);
      ok(out.status === 0, "B1: recovery from a crash must let the run proceed", out.status);
      ok(/RECOVERED/.test(out.stdout), "B1: and must SAY it restored a file", out.stdout.slice(0, 200));
      ok(fs.readFileSync(path.join(r, "scope", "x.js"), "utf8") === ORIG,
         "B1: the mutated file must hold its original bytes again");
      ok(left(p).length === 0, "B1: and no marker may survive the recovery — the pid file included", left(p));
    }
    // B2 — a live foreign owner: REFUSED, and nothing touched. B1 is its admitted sibling: same
    // plant, same file, one detail changed — the owner is alive.
    {
      const r = copy(); const p = plantIn(r, MINE);
      const out = runTool(r);
      ok(out.status !== 0, "B2: a tree owned by a live sweep must refuse to start a second one", out.status);
      ok(/REFUSED/.test(out.stdout), "B2: and must say why", out.stdout.slice(0, 200));
      ok(fs.readFileSync(path.join(r, "scope", "x.js"), "utf8") === MUT,
         "B2: and must NOT restore the live sweep's file underneath it — that is two sweeps erasing each other");
      ok(left(p).length === 3, "B2: and must leave the live sweep's markers where they are", left(p));
    }
    // B3 — killed between trials: only a pid file, and it is cleared without touching any file.
    {
      const r = copy(); const p = Residue.paths(path.join(r, "tools"));
      fs.writeFileSync(path.join(r, "scope", "x.js"), ORIG);
      fs.writeFileSync(p.pid, String(DEAD));
      const out = runTool(r);
      ok(out.status === 0 && /CLEARED/.test(out.stdout), "B3: a stale pid file must be cleared and said so",
         { status: out.status, out: out.stdout.slice(0, 200) });
      ok(!fs.existsSync(p.pid), "B3: and must actually be gone");
      ok(fs.readFileSync(path.join(r, "scope", "x.js"), "utf8") === ORIG, "B3: and no file may be touched");
    }
  }

  // ── PART C — the real tree ─────────────────────────────────────────────────────────────────
  const real = Residue.residue(process.ppid);
  const rec = real.rec || {};
  if (real.state === "crashed") {
    ok(false, "C: A SWEEP DIED MID-TRIAL and left " + (rec.rel || "an unknown file") + " mutated at line " +
       rec.line + " (" + rec.from + " -> " + rec.to + "). Every verdict in this run may describe mutated " +
       "code. Recover with: node tools/mutate-comparisons.js --list");
  } else if (real.state === "stale-pid") {
    ok(false, "C: a sweep died between trials and left its pid file (" + real.pid + "). No file is mutated; " +
       "clear it with: node tools/mutate-comparisons.js --list");
  } else if (real.state === "other-sweep") {
    ok(false, "C: a LIVE sweep (pid " + real.pid + ") owns this tree and is not the process running this " +
       "guard. Its mutations are on disk right now, so this run is not a verdict about the tree.");
  } else {
    ok(real.state === "clean" || real.state === "own-sweep", "C: unknown residue state", real.state);
  }
} finally {
  for (const d of tmpRoots) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
}

// The gate is below every part, and there is nothing asynchronous above it.
if (failed > 0) {
  console.log("[sweep-residue] FAIL — " + failed + " of " + assertions + " assertion(s) failed");
  process.exit(1);
}
console.log("[sweep-residue] PASS — a tree left mid-mutation by a killed sweep turns the suite red " +
  "instead of green, and a live sweep's own guards still pass. The rule has ONE home " +
  "(`tools/mutate-residue.js`) with two callers, and ownership is 'the pid file names my parent', " +
  "never 'the pid is alive', because a recycled pid would read as a live owner over a mutated file. " +
  "The REAL sweep's recovery is driven in a throwaway copy: it restores a crash and clears every " +
  "marker, refuses to start over a live owner without touching its file, and clears a pid left " +
  "between trials (" + assertions + " assertions)");
process.exit(0);
