// tools/mutate-comparisons.js — the J39 sweep. NOT a guard: it MUTATES the tree and restores it,
// which is the opposite of what a guard does. run-all.js derives its set from tests/check-*.js, so
// this file is never picked up there, and it must never be moved there.
//
//   node tools/mutate-comparisons.js --scope backends/backend1 [--only floor.js] [--limit N] [--list]
//
// Flips one comparison at a time — `<`↔`<=`, `>`↔`>=` — runs the guards, records what nothing
// noticed, restores. A mutation nothing notices is a SURVIVOR, and a survivor is a QUESTION
// (unreachable from which caller, or unguarded?) never a finding. §8: a sweep finds candidates, it
// does not decide them.
//
// ── FOUR WAYS THIS TOOL CAN LIE, EACH CLOSED ─────────────────────────────────────────────────
// A script that mutates and re-runs is itself untested code whose output is trusted BECAUSE it is
// mechanical. The failure modes are the mutation varieties in 09-roadmap.md §8:
//
//   1. THE EDIT NEVER APPLIED. A replacement that matched nothing reports success, and every
//      comparison then "survives" — a clean sweep meaning the probe never ran. Closed by asserting
//      the bytes AT THE RECORDED OFFSET were the operator expected and are now the flipped one.
//      Not "the file changed": changed WHERE and TO WHAT.
//   2. THE EDIT WAS UNDONE UNDERNEATH. Something else restored the file between the write and the
//      read, so the guards saw clean source. Closed by re-checking the offset AFTER the guards run
//      and BEFORE believing a green: a mutation that is no longer present makes the trial VOID, not
//      a survivor. This one was observed rather than theorised — see §8.
//   3. THE MUTATION BROKE THE PARSE. Every guard then dies for a reason unrelated to the
//      comparison and the row reads as "caught" — a FALSE CATCH, the dangerous direction, because
//      it hides a hole. Closed by `node --check`; a parse failure is reported as skipped, never as
//      caught.
//   4. THE OPERATOR WAS NEVER CODE. Most `<` and `>` in this tree are in comments and strings.
//      Mutating prose changes nothing, so it survives, and the list fills with noise. Closed by a
//      scanner that emits offsets in code only. It fails SAFE: a missed code operator under-reports,
//      and a mutated string operator becomes a row a human discards on sight — which is why every
//      row prints its source line.
//
// ── AND THE CONTROL RUNS FIRST ───────────────────────────────────────────────────────────────
// A harness that runs no guards, or restores before running them, reports a flawless sweep. So a
// comparison known to be guarded is flipped before anything else and MUST go red. If it does not,
// the pass refuses to start. No survivor is believed until the tool has proved it can produce a red.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TESTS = path.join(ROOT, "tests");

// Wall-clock dominators, run LAST so a mutation killed by a cheap guard costs little.
// PERFORMANCE ONLY — a survivor must clear every guard, so ordering cannot change a verdict.
// Measure on your own machine before trusting this split (J39's scope decision says why).
const SLOW = ["check-cascade-simulation.js", "check-feature-flow.js", "check-convergence.js",
              "check-counts.js", "check-strike.js", "check-reducer-ignore.js",
              "check-adversarial-sweep.js", "check-settings-order.js"];

function guardList() {
  const all = fs.readdirSync(TESTS).filter((f) => /^check-[a-z0-9-]+\.js$/.test(f)).sort();
  return all.filter((f) => SLOW.indexOf(f) < 0).concat(all.filter((f) => SLOW.indexOf(f) >= 0));
}

// ── which byte offsets are CODE (1) rather than string/comment/regex (0) ─────────────────────
function codeMask(src) {
  const m = new Uint8Array(src.length);
  const REGEX_OK = /[(,=:[!&|?{};+\-*%~^<>]/;
  let i = 0, lastSig = "";
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < src.length) { if (src[i] === "\\") { i += 2; continue; } if (src[i] === q) { i++; break; } i++; }
      lastSig = "x"; continue;
    }
    if (c === "/" && REGEX_OK.test(lastSig)) {
      const start = i; i++;
      let closed = false;
      while (i < src.length) {
        if (src[i] === "\\") { i += 2; continue; }
        if (src[i] === "[") { i++; while (i < src.length && src[i] !== "]") { if (src[i] === "\\") i++; i++; } }
        if (src[i] === "\n") break;
        if (src[i] === "/") { i++; closed = true; break; }
        i++;
      }
      if (!closed) { i = start + 1; m[start] = 1; lastSig = "/"; continue; }
      lastSig = "x"; continue;
    }
    m[i] = 1;
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  return m;
}

function candidates(src) {
  const mask = codeMask(src);
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (!mask[i]) continue;
    const c = src[i];
    if (c !== "<" && c !== ">") continue;
    const prev = src[i - 1], next = src[i + 1];
    if (prev === "=" || prev === "!" || prev === "<" || prev === ">") continue;  // =>, <=, >=, <<, >>
    if (next === "<" || next === ">") continue;
    if (next === "=") out.push({ at: i, from: c + "=", to: c });                 // <= -> <
    else out.push({ at: i, from: c, to: c + "=" });                              // <  -> <=
  }
  return out;
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;
function snippet(src, at) {
  const a = src.lastIndexOf("\n", at) + 1;
  let b = src.indexOf("\n", at); if (b < 0) b = src.length;
  return src.slice(a, b).trim().slice(0, 118);
}

// Progress is not decoration here. Every mutation runs up to a hundred guards before it is
// killed, and the first version of this tool printed ONLY survivors — so a module whose mutations
// all die showed a blank screen for twenty minutes and read as a hang. It was reported as one, by
// the person who wrote it, watching its own log. A long-running tool that cannot say what it is
// doing will be killed by somebody who thinks it is stuck.
let VERBOSE = true;
function firstRed(list, tag) {
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    const t = Date.now();
    const r = spawnSync(process.execPath, [path.join(TESTS, g)], { encoding: "utf8", timeout: 120000 });
    const ms = Date.now() - t;
    if (VERBOSE && ms > 3000) {
      process.stdout.write("      " + tag + " ... " + g + " (" + (ms / 1000).toFixed(1) + "s)\n");
    }
    if (r.status !== 0) return g;
  }
  return null;
}

// One trial, with all four lies closed. Returns {killer} | {void:reason} | {skipped:reason}
const INFLIGHT = path.join(ROOT, "tools", ".mutate-inflight.json");
const INFLIGHT_BAK = path.join(ROOT, "tools", ".mutate-inflight.bak");

// A `finally` does NOT run when the process is killed — a container suspend, an OOM, a timeout.
// This tool learned that by leaving a mutated reducer in the tree overnight, which is the worst
// possible artefact: a real file, plausibly wrong, with nothing announcing it. So the ORIGINAL is
// written to disk BEFORE the mutation and cleared only after a verified restore. A marker on disk
// at startup means the last run died mid-trial, and recovery happens before anything else.
function recoverIfCrashed() {
  if (!fs.existsSync(INFLIGHT)) return;
  const rec = JSON.parse(fs.readFileSync(INFLIGHT, "utf8"));
  const abs = path.join(ROOT, rec.rel);
  fs.writeFileSync(abs, fs.readFileSync(INFLIGHT_BAK));
  fs.unlinkSync(INFLIGHT); fs.unlinkSync(INFLIGHT_BAK);
  console.log("RECOVERED — the previous run died mid-trial and left " + rec.rel +
              " mutated at line " + rec.line + " (" + rec.from + " -> " + rec.to + "). Restored.");
}

function trial(rel, orig, cand, list) {
  const abs = path.join(ROOT, rel);
  if (orig.slice(cand.at, cand.at + cand.from.length) !== cand.from) {
    return { skipped: "offset-does-not-hold-operator" };
  }
  const mutated = orig.slice(0, cand.at) + cand.to + orig.slice(cand.at + cand.from.length);
  fs.writeFileSync(INFLIGHT_BAK, orig);
  fs.writeFileSync(INFLIGHT, JSON.stringify({ rel, at: cand.at, line: lineOf(orig, cand.at),
                                              from: cand.from, to: cand.to }));
  fs.writeFileSync(abs, mutated);
  try {
    // (1) applied — where, and to what
    let now = fs.readFileSync(abs, "utf8");
    if (now.slice(cand.at, cand.at + cand.to.length) !== cand.to) return { void: "did-not-apply" };
    if (now.length !== orig.length + (cand.to.length - cand.from.length)) return { void: "unexpected-length" };
    // (3) parses
    if (spawnSync(process.execPath, ["--check", abs], { encoding: "utf8" }).status !== 0) {
      return { skipped: "does-not-parse" };
    }
    const killer = firstRed(list, cand.tag || "");
    // (2) STILL applied, checked before any green is believed
    now = fs.readFileSync(abs, "utf8");
    if (now.slice(cand.at, cand.at + cand.to.length) !== cand.to) return { void: "undone-mid-run" };
    return { killer: killer };
  } finally {
    fs.writeFileSync(abs, orig);
    if (fs.readFileSync(abs, "utf8") !== orig) throw new Error("RESTORE FAILED for " + rel);
    if (fs.existsSync(INFLIGHT)) fs.unlinkSync(INFLIGHT);
    if (fs.existsSync(INFLIGHT_BAK)) fs.unlinkSync(INFLIGHT_BAK);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const scope = arg("--scope", "backends/backend1");
const only = arg("--only", null);
const limit = Number(arg("--limit", "0")) || 0;
const listOnly = argv.indexOf("--list") >= 0;

recoverIfCrashed();

const files = fs.readdirSync(path.join(ROOT, scope))
  .filter((f) => f.endsWith(".js") && (!only || f === only)).sort();
const inventory = [];
let total = 0;
for (const f of files) {
  const rel = path.join(scope, f);
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const cs = candidates(src);
  total += cs.length;
  inventory.push({ rel, src, cs });
  console.log("  " + rel.padEnd(42) + String(cs.length).padStart(4));
}
console.log("  " + "TOTAL".padEnd(42) + String(total).padStart(4));
if (listOnly) process.exit(0);

fs.writeFileSync(path.join(ROOT, "tools", ".mutate.pid"), String(process.pid));
process.on("exit", () => { try { fs.unlinkSync(path.join(ROOT, "tools", ".mutate.pid")); } catch (e) {} });

const list = guardList();
console.log("\n" + total + " comparisons x " + list.length + " guards. Expect minutes per module, "
  + "not seconds — a line prints per mutation, so silence longer than ~90s means something IS wrong.\n");
{
  const rel = "backends/backend1/trustpolicy.js";
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const at = src.indexOf(">= need");
  if (at < 0) { console.log("\nCONTROL FAILED — anchor `>= need` is gone. Re-anchor before trusting this tool."); process.exit(1); }
  const r = trial(rel, src, { at, from: ">=", to: ">", tag: "control" }, list);
  console.log("\ncontrol  trustpolicy.js `>= need` -> `>` : " +
    (r.killer ? "RED via " + r.killer : "NO RED (" + (r.void || r.skipped || "survived") + ")"));
  if (!r.killer) { console.log("the harness cannot produce a red; no survivor from it would mean anything."); process.exit(1); }
}

console.log("\nsweeping " + scope + (only ? "/" + only : "") + "\n");
const rows = [];
let run = 0, killed = 0, voided = 0, skipped = 0;
const t0 = Date.now();
outer:
for (const { rel, src, cs } of inventory) {
  for (const c of cs) {
    if (limit && run >= limit) break outer;
    const ln = lineOf(src, c.at);
    c.tag = path.basename(rel) + ":" + ln;
    process.stdout.write("  [" + String(run + 1).padStart(3) + "/" + total + "] " + c.tag +
                         "  " + c.from + "->" + c.to + " ");
    const tStart = Date.now();
    const r = trial(rel, src, c, list);
    run++;
    const took = ((Date.now() - tStart) / 1000).toFixed(0) + "s";
    const per = (Date.now() - t0) / run;
    const eta = ((total - run) * per / 60000).toFixed(0);
    process.stdout.write((r.skipped ? "SKIP(" + r.skipped + ")"
                        : r.void ? "VOID(" + r.void + ")"
                        : r.killer ? "killed by " + r.killer.replace(/^check-|\.js$/g, "")
                        : "SURVIVOR")
                        + "  [" + took + ", ~" + eta + "m left]\n");
    const base = { file: rel, line: lineOf(src, c.at), from: c.from, to: c.to, text: snippet(src, c.at) };
    if (r.skipped) { skipped++; continue; }
    if (r.void) { voided++; console.log("  VOID " + rel + ":" + base.line + " (" + r.void + ")"); continue; }
    if (r.killer) { killed++; continue; }
    rows.push(base);
    console.log("           " + base.text);
  }
}
const mins = ((Date.now() - t0) / 60000).toFixed(1);
console.log("\n" + run + " run / " + killed + " killed / " + rows.length + " survived / " +
            voided + " void / " + skipped + " skipped   (" + mins + " min)");
fs.writeFileSync(path.join(ROOT, "..", "j39-survivors.json"), JSON.stringify(rows, null, 1));
console.log("A survivor is a QUESTION — unreachable from which caller, or unguarded — never a finding.");
