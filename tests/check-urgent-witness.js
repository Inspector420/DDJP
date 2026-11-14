// tests/check-urgent-witness.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend1/scheduler.js
// WALL: A DETECTED HOLE'S WITNESS PASS SKIPS THE RANK LADDER (J115, item 3).
//
// The Scheduler skips the rank ladder for a plan marked `urgent` — jitter only — and a detected deletion is the one
// reason to break the ladder (`trust-cascade.md` §7.4; the seal hold's witness cycle counts on it). The bridge never
// marked its pass urgent, so a hole waited its rank slot like routine under-coverage: at the bottom rung, six slots of
// the room's vouch jitter instead of the debounce. Driven with the REAL `_scheduleProactiveWitness`, extracted from the
// bridge, over the REAL Scheduler and ladder; only the timer is a double, so each plan's delay is read, not inferred.
//   PART A — routine under-coverage waits its rank slot (the control: the ladder applies at all).
//   PART B — a detected hole is planned urgent: the debounce only, whatever the rank.
//   PART C — a hole arriving while a routine pass waits its slot does not wait behind it; a second hole while the urgent
//            pass is pending changes nothing.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[urgent-witness] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
function grab(name) {
  const a = "function " + name + "(";
  const i = src.indexOf(a);
  if (i < 0 || src.indexOf(a, i + 1) >= 0) return null;
  const o = src.indexOf("{", src.indexOf(")", i));
  let d = 0;
  for (let j = o; j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (!d) return src.slice(i, j + 1); }
  }
  return null;
}
const fnSrc = grab("_scheduleProactiveWitness");
const DEBOUNCE = Number((src.match(/const _PROACTIVE_DEBOUNCE_MS = (\d+);/) || [])[1]);
ok(!!fnSrc && DEBOUNCE > 0, "APPLIED — `_scheduleProactiveWitness` and the debounce were read from the bridge", { fn: !!fnSrc, DEBOUNCE });

// One world: the real ladder and Scheduler, a recording timer, the bridge's function and the state it reads.
function world(rank) {
  const S = loadInContext(["backends/backend1/ranks.js", "backends/backend1/scheduler.js"], {});
  const timers = [], cleared = [];
  S.Scheduler.attach({ now: () => 0, random: () => 0,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: (h) => { cleared.push(h); } });
  const ctx = { Scheduler: S.Scheduler, console, Math, Date, JSON };
  vm.createContext(ctx);
  vm.runInContext(
    "let _recoveryRoom = '!ev:hs', _holeSeen = false, _proactivePlannedUrgent = false, _proactiveTimer = null;\n" +
    "const _recoveryChannels = {};\nconst _PROACTIVE_DEBOUNCE_MS = " + DEBOUNCE + ";\n" +
    "function getMyRank() { return " + rank + "; }\nfunction _mySettings() { return {}; }\n" +
    "const Dials = { live: () => 1000 };\nfunction _proactiveWitness() {}\n" + fnSrc + "\n" +
    ";globalThis.__w = { schedule: () => _scheduleProactiveWitness(), hole: () => { _holeSeen = true; } };", ctx);
  return { S, timers, cleared, w: ctx.__w };
}
const LOW = loadInContext(["backends/backend1/ranks.js"], {}).Ranks.levelOf("uncategorized");

// ═══ PART A — routine under-coverage waits its rank slot ═══════════════════════════════════════
const routine = (() => { const x = world(LOW); x.w.schedule(); return x; })();
const slot = routine.timers.length ? routine.timers[routine.timers.length - 1].ms : null;
ok(typeof slot === "number" && slot > DEBOUNCE, "A CONTROL — a routine pass at the bottom rung waits its rank slot, past " +
  "the debounce: the ladder applies, so a shorter delay below is a reading of `urgent`", { slot, DEBOUNCE });

// ═══ PART B — a detected hole is urgent ════════════════════════════════════════════════════════
{
  const x = world(LOW);
  x.w.hole(); x.w.schedule();
  const d = x.timers.length ? x.timers[x.timers.length - 1].ms : null;
  ok(d === DEBOUNCE, "B: a detected hole's pass is planned URGENT — the debounce and jitter only, not the bottom rung's " +
    "slot (" + slot + " ms)", { delay: d });
  ok(x.S.Scheduler.isPending("vouch:proactive"), "B: and it is pending under the one name");
}

// ═══ PART C — a hole does not wait behind a routine pass ═══════════════════════════════════════
{
  const x = world(LOW);
  x.w.schedule();                                   // routine, waiting its slot
  const first = x.timers.length;
  x.w.hole(); x.w.schedule();                       // a hole is detected while it waits
  const d = x.timers.length > first ? x.timers[x.timers.length - 1].ms : null;
  ok(d === DEBOUNCE, "C: a hole detected while a routine pass waits its slot is planned urgent, not folded into the " +
    "routine wait (planning a pending name coalesces)", { timers: x.timers.map((t) => t.ms) });
  ok(x.cleared.length === 1, "C: and the routine wait is cancelled — one pass, not two", x.cleared);
  const n = x.timers.length;
  x.w.hole(); x.w.schedule();                       // a second hole while the urgent pass is pending
  ok(x.timers.length === n && x.cleared.length === 1, "C: a second hole while the urgent pass is pending re-plans " +
    "nothing — the pending pass covers it, and a burst of holes cannot keep pushing it back",
    { timers: x.timers.map((t) => t.ms), cleared: x.cleared });
}

if (failed) { console.log("[urgent-witness] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[urgent-witness] PASS — a detected hole's witness pass skips the rank ladder (J115): driven through the real " +
  "`_scheduleProactiveWitness` over the real Scheduler and ladder, a routine pass at the bottom rung waits its slot (" +
  slot + " ms, the control) while a hole's is planned urgent at the " + DEBOUNCE + " ms debounce; a hole arriving while a " +
  "routine pass waits replaces it rather than waiting behind it, and a second hole while the urgent pass is pending " +
  "re-plans nothing (" + asserts + " assertions)");
