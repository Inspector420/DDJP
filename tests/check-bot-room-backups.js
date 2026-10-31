// tests/check-bot-room-backups.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend2/skeleton.js, core/backends.js
// WALL: A BOT ROOM ATTACHES AND SENDS NO PEER BACKUPS (the owner's ruling, ddjp_423).
//
// Found in the settings rework: backend2 does not replace `sendEvent`, so every message a bot-room
// client sent went through backend1's path and carried `Vouch.bundleFor(...)` — backups for a room
// that never rebuilds from peers' backups. Nothing is deleted there, and a returning bot or client
// rebuilds from the newest checkpoint in `events_owner` plus the events after it. So the bytes were
// read by nothing. The engine now declares `backups: false`, and backend1 asks before bundling.
//
//   B1  the bot engine's descriptor says no peer backups; the shared engine's default says yes
//   B2  the REAL gate, extracted and run against the REAL descriptors, answers each engine correctly,
//       and fails OPEN when nothing can be read (a wrong "no" in a shared room loses protection)
//   B3  BOTH send paths ask it: the bundle on an ordinary message, and the standalone backup
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");

let checks = 0;
function fail(msg, got) {
  console.log("[bot-room-backups] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { checks++; if (!c) fail(msg, got); }

// The registry with the bot engine's own registration in it.
const reg = { B1MatrixAccount: {}, B1Capabilities: {}, console, Logger: { info() {}, warn() {} } };
vm.createContext(reg);
vm.runInContext(fs.readFileSync(path.join(ROOT, "core/backends.js"), "utf8") + "\n"
  + fs.readFileSync(path.join(ROOT, "backends/backend2/skeleton.js"), "utf8") + "\n;globalThis.__B = Backends;", reg);
const d2 = reg.__B.describe("backend2");
ok(!!d2, "B1 PREMISE: the bot engine is registered with a descriptor");
ok(d2.backups === false, "B1: the bot engine declares that its rooms use no peer backups", d2);

// B2 — the gate itself, as it ships.
const ex = P.extractNamed("backends/backend1/matrixbridge.js", "_engineCarriesBackups");
ok(ex.ok, "B2 stage — " + ex.stage);
const run = (backends) => {
  const box = backends ? { Backends: backends } : {};
  vm.createContext(box);
  vm.runInContext(ex.source + ";globalThis.__g = _engineCarriesBackups;", box);
  return box.__g();
};
const bound = (mode) => ({ active: () => mode, describe: (m) => reg.__B.describe(m) });
ok(run(bound("backend2")) === false, "B2: in a bot room the gate says NO backups");
ok(run(bound("backend1")) === true, "B2: in a shared room it says yes — the default, since that engine declares nothing");
ok(run(null) === true, "B2: and with no registry to ask it fails OPEN, to yes");
ok(run({ active: () => { throw new Error("x"); }, describe: () => null }) === true,
  "B2: a registry that throws also reads as yes");

// B3 — both paths consult it. Read from the stripped source, at the two sites that send backups.
const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8")
  .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
ok(/Vouch\.carries\(type\)\s*&&\s*_engineCarriesBackups\(\)/.test(src),
  "B3: the bundle on an ordinary message is attached only where the engine uses backups");
const pw = P.extractNamed("backends/backend1/matrixbridge.js", "_proactiveWitness");
ok(pw.ok, "B3 stage — " + pw.stage);
const firstStmt = pw.source.slice(pw.source.indexOf("{") + 1).split("\n")
  .map((l) => l.trim()).filter((l) => l && !l.startsWith("//"))[0] || "";
ok(/^if \(!_engineCarriesBackups\(\)\) return;/.test(firstStmt),
  "B3: and the standalone backup returns before anything else where the engine uses none", firstStmt);

console.log("[bot-room-backups] PASS — a bot room attaches and sends no peer backups: its engine declares "
  + "`backups: false`, the real gate answers each engine correctly against the real descriptors and fails "
  + "open when unreadable, and both send paths ask it (" + checks + " assertions)");
