// tests/check-load-time-reads.js
// SUBJECT: features/, ui/
// WALL: nothing above the seam may FREEZE an engine's answer while the page loads, unless every
// engine would have given the same answer.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────────
// `core/backends.js` declares the four interface names as SHELLS whose contents the binder swaps
// per room. Bootstrap binds the shared engine before any `features/` or `ui/` script runs
// (`core/bind-bootstrap.js`), so anything those scripts read AT LOAD is the bootstrap engine's
// answer — and it stays that answer after `Room.join` binds a different engine. REPORTED FROM A
// LIVE BOT ROOM: `features/roomupgrade.js` asked `MatrixBridge.maxUpgradeBatch()` once at load,
// froze the shared engine's top batch, and offered "Upgrade (1/3)" in a room type built in one
// piece. The transport was right the whole time; the reader asked it at the wrong moment. No guard
// could see that, because every guard of the module handed it the number or never loaded it.
//
// ── THE RULE IS A PROPERTY, NOT A LIST ───────────────────────────────────────────────────────────
// A read made while loading is SAFE EXACTLY WHEN EVERY READY ENGINE ANSWERS IT IDENTICALLY — then
// freezing it loses nothing. So this guard does not keep an exemption list keyed by file path
// (the fifty-second signature: a path-keyed exemption goes stale at the next move). It DRIVES the
// load, records every read of the four shells that happens during it, re-asks each one under every
// ready engine, and fails any whose answers differ. Today the only such read is `ui/base.js`'s
// rank ladder, which passes on its merits: every engine registers one shared `Capabilities`. If an
// engine ever registers its own ladder, that read fails HERE, naming the file, instead of shipping
// a rank colour table frozen from the wrong room type.
//
// THIS GUARD CANNOT TELL YOU A LOAD-TIME READ IS HARMLESS for reasons other than engine identity
// (a value that changes over time, say) — it answers one question: could a room of another type
// have received a different answer?

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");

let checks = 0;
function fail(msg, got) {
  console.log("[load-time-reads] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); checks++; }

// The page's own order: everything up to and including bootstrap, then everything after it. No
// network, no vendored SDK, and not `app.js`, which is the boot sequence rather than a module.
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const order = [...html.matchAll(/<script[^>]+src="([^"?]+)/g)].map((m) => m[1])
  .filter((f) => !/^https?:|^lib\//.test(f));
const boot = order.indexOf("core/bind-bootstrap.js");
ok(boot > 0, "core/bind-bootstrap.js must be in index.html's script order — nothing else fills the shells", order);
const phase1 = order.slice(0, boot + 1);
const phase2 = order.slice(boot + 1).filter((f) => f !== "app.js");
ok(phase2.some((f) => f.startsWith("features/")) && phase2.some((f) => f.startsWith("ui/")),
  "the scripts after bootstrap must include both features/ and ui/ — otherwise this measures neither", phase2);

// A DOM that answers anything: this guard is about what scripts READ FROM THE ENGINE while loading,
// not about what they do to a page, and a thrower here would stop the measurement at that file.
const anything = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => "" : anything()),
  apply: () => anything(), construct: () => anything(),
});
const ctx = loadInContext(phase1, {
  Date, window: anything(), document: anything(), navigator: { userAgent: "" },
  location: { href: "", search: "", hash: "" },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
});
const run = (s) => vm.runInContext(s, ctx);
run("globalThis.__shells = { StreamManager, MatrixBridge, MatrixAccount, Capabilities }; globalThis.__B = Backends;");
const bootEngine = run("Backends.active()");
ok(typeof bootEngine === "string" && bootEngine, "bootstrap must have bound an engine before features/ load", bootEngine);

// Record every read of every shell member, with its arguments, attributed to the script running.
const reads = [];
let current = null;
function wrapShells() {
  for (const [name, shell] of Object.entries(ctx.__shells)) {
    for (const k of Object.keys(shell)) {
      const v = shell[k];
      if (typeof v === "function") {
        shell[k] = function (...args) { if (current) reads.push({ file: current, name, k, call: true, args }); return v.apply(this, args); };
      } else {
        Object.defineProperty(shell, k, { configurable: true, enumerable: true,
          get() { if (current) reads.push({ file: current, name, k, call: false }); return v; } });
      }
    }
  }
}
wrapShells();

// CONTROL: a read made while a file is current IS recorded. Without this an empty result would be
// indistinguishable from a recorder that never fired.
current = "__control__";
run("MatrixBridge.getUserId ? MatrixBridge.getUserId() : Capabilities.LADDER");
current = null;
ok(reads.some((r) => r.file === "__control__"), "CONTROL: the recorder must see a read made during a file's load");
reads.length = 0;

const failedToLoad = [];
for (const f of phase2) {
  current = f;
  try { vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f }); }
  catch (e) { failedToLoad.push(f + ": " + String((e && e.message) || e).slice(0, 100)); }
  current = null;
}
// A script that threw was measured only up to where it threw, which is a hole, not a pass.
ok(failedToLoad.length === 0, "every script after bootstrap must load in this harness, or its reads are unmeasured", failedToLoad);

// Re-ask each distinct read under every ready engine and compare.
const engines = run("Backends.modes().filter((m) => Backends.isReady(m))");
ok(engines.length >= 2, "at least two ready engines are needed for a comparison to mean anything", engines);
const distinct = new Map();
for (const r of reads) {
  const key = r.file + " " + r.name + "." + r.k + (r.call ? "(" + JSON.stringify(r.args) + ")" : "");
  if (!distinct.has(key)) distinct.set(key, r);
}
function answerUnder(engine, r) {
  run("__B.bind(" + JSON.stringify(engine) + ")");
  const shell = ctx.__shells[r.name];
  if (!(r.k in shell)) return { absent: true };
  let v;
  try { v = r.call ? shell[r.k].apply(shell, r.args) : shell[r.k]; }
  catch (e) { return { threw: String((e && e.message) || e) }; }
  if (typeof v === "function") return { fn: true };
  try { return { v: JSON.stringify(v) }; } catch (e) { return { uncomparable: true }; }
}

// CONTROL: the engines really do answer SOMETHING differently in this harness, so "identical" below
// is a finding rather than a harness in which every engine is the same engine.
{
  const probe = { name: "MatrixBridge", k: "maxUpgradeBatch", call: true, args: [] };
  const answers = engines.map((e) => JSON.stringify(answerUnder(e, probe)));
  ok(new Set(answers).size > 1, "CONTROL: the ready engines must differ on a known per-engine answer (the top upgrade batch)", answers);
}

const frozen = [];
for (const [key, r] of distinct) {
  const answers = engines.map((e) => answerUnder(e, r));
  const shown = answers.map((a) => JSON.stringify(a));
  if (answers.some((a) => a.uncomparable)) { frozen.push(key + " — cannot be compared, so cannot be shown safe"); continue; }
  if (new Set(shown).size > 1) frozen.push(key + " — " + engines.map((e, i) => e + "=" + shown[i].slice(0, 60)).join(" · "));
  checks++;
}
run("__B.bind(" + JSON.stringify(bootEngine) + ")");

ok(frozen.length === 0,
  "a features/ or ui/ script reads an engine answer WHILE LOADING that another room type would answer " +
  "differently — it is frozen from the bootstrap engine and wrong in every other kind of room. Read it " +
  "when it is needed instead", frozen);

console.log("[load-time-reads] PASS — no features/ or ui/ script freezes an engine's answer at load that another room type " +
  "would answer differently. Driven, not scanned: the " + phase2.length + " scripts after bootstrap are loaded in page order " +
  "with every member of the four interface shells recorded, and each read made during a load is re-asked under every ready " +
  "engine (" + distinct.size + " distinct, all identical across " + engines.length + " engines, against a control proving the engines " +
  "do differ). The rule is a PROPERTY rather than a path-keyed exemption list, so a file that moves keeps its answer and an engine " +
  "that registers its own ladder turns this red where it matters (" + checks + " assertions)");
process.exit(0);
