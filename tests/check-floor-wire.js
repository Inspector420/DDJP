// tests/check-floor-wire.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend1/floor.js, backends/backend1/streammanager.js
// WALL: THE BRIDGE'S FLOOR WIRING IS THE ONE THAT DECIDES A RETREAT (`ddjp_566`; the owner's order on the `ddjp_565` finding).
//   Retreat by proof lives in `Floor.revalidate`, and it asks `_env.canProve` — which only the bridge supplies, in
//   `_wireConcepts`'s `Floor.attach({...})`. Every guard that drove it attached its OWN copy of that object, so deleting the
//   bridge's `canProve:` line left the whole suite green (`ddjp_565`, P6b): a double agrees with whatever its author believed.
//   This guard takes the object literal OUT OF THE SHIPPED FILE, the way `check-forgetting-differential` takes
//   `_onCheckpointArrived`, attaches it to a real Floor over a real StreamManager, and drives the two cases where the proof
//   and the no-proof fallback (`trimmed ? needs-fetch : proved`) give opposite answers:
//   PART A — the wire reaches `StreamManager.canProve`, and the extraction found exactly one attach in `_wireConcepts`.
//   PART B — a TRIMMED device that trimmed under the older floor RETREATS to it (the fallback would demote it).
//   PART C — an UNTRIMMED device that cannot prove the older floor WITHDRAWS (the fallback would retreat onto it).
//   PART D — the wire fails CLOSED: a `canProve` that throws answers needs-fetch, never proved.
//   PART E — the wire's other readers reach the real module: `log` is the proof log, `trimmed` is the trim state.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[floor-wire] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }

// ── THE EXTRACTION: the argument of the one `Floor.attach(` inside `function _wireConcepts`, brace-matched past strings and
// comments. It REFUSES BY NAME rather than guessing: an anchor that is missing, doubled or unbalanced is a FAIL with its stage.
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
function matchBrace(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === "/" && n === "/") { i = src.indexOf("\n", i); if (i < 0) return -1; continue; }
    if (c === "/" && n === "*") { i = src.indexOf("*/", i + 2) + 1; if (i <= 0) return -1; continue; }
    if (c === "\"" || c === "'" || c === "`") { for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}
let ATTACH = null, stage = "";
{
  const fi = MB.indexOf("  function _wireConcepts(channels) {");
  const fe = fi < 0 ? -1 : matchBrace(MB, MB.indexOf("{", fi));
  if (fi < 0 || fe < 0) stage = "no `function _wireConcepts(channels)` in matrixbridge.js, or it does not close";
  else {
    const body = MB.slice(fi, fe + 1), hits = body.split("Floor.attach({").length - 1;
    if (hits !== 1) stage = "`Floor.attach({` occurs " + hits + " times inside `_wireConcepts`, not once";
    else { const o = body.indexOf("Floor.attach({") + "Floor.attach(".length, oe = matchBrace(body, o);
      if (oe < 0) stage = "the attach object inside `_wireConcepts` does not close"; else ATTACH = body.slice(o, oe + 1); }
  }
}
ok(ATTACH !== null, "A PREMISE — the bridge's Floor wiring could not be taken from the shipped file: " + stage);
if (!ATTACH) { console.log("[floor-wire] " + failed + " failure(s)"); process.exit(1); }

const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/continuity.js", "backends/backend1/streammanager.js"];
const quiet = { info() {}, warn() {}, debug() {}, error() {} };
const C = loadInContext(FILES, { Logger: quiet });
// THE SAME CHAIN `check-floor-retreat` drives: three substitute authors, the owner bar out of reach so the search must CHAIN,
// and a log with a hole above the second cut — the newest floor stops verifying while the older pair still does.
const LOG = F.sortLog([F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner, { t: "ddjp.room.settings", s: C.StateDeriver.defaultSettings() })]
  .concat(F.playingRoom({ songs: 8 }).log));
const CHAIN = F.chainOf(C, LOG, [4, 9, 14], "@hs1:hs");
const AUTHORS = ["@hs1:hs", "@hs2:hs", "@hs3:hs"];
const HOLED = LOG.filter((e) => e.eventId !== LOG[12].eventId);
const SETTINGS = { checkpointTable: [{ enough: 9 }, { enough: 2 }, { enough: 2 }, { enough: 2 }, { enough: 2 }, { enough: 2 }, { enough: 2 }] };
const asTrusted = (c) => ({ n: c.n, h: c.h, floorL: c.floorL, grade: "quorum", covers: c.covers, seed: c.seed, prev: c.prev, thin: false });

// One device: a fresh sandbox, the SHIPPED attach object built over its real StreamManager, a spy on the one function the
// wire is supposed to reach (installed on the module itself, so the wire's own lookup finds it — the wire is not touched).
function standUp(log, trimUnder, opts) {
  const sb = loadInContext(FILES, { Logger: quiet }), SM = sb.StreamManager, Fl = sb.Floor;
  Fl.reset(); SM.reset(); SM._setLogForTest(log);
  const calls = [], real = SM.canProve;
  SM.canProve = (f) => { if (opts && opts.throws) { calls.push("threw"); throw new Error("canProve threw (planted)"); } const r = real(f); calls.push(r); return r; };
  const env = new Function("StreamManager", "_mySettings", "getMyRank", "channels", "return (" + ATTACH + ");")(SM, () => SETTINGS, () => 80, {});
  Fl.attach(env);
  const emissions = []; Fl.onChange((ev) => emissions.push(ev.kind));
  CHAIN.forEach((c, i) => Fl.remember(c, 80, AUTHORS[i], 1000 + i));
  let dropped = 0;
  if (trimUnder) { Fl._setTrustedForTest(asTrusted(trimUnder)); dropped = SM.trimToFloor(); }
  Fl._setTrustedForTest(asTrusted(CHAIN[2])); emissions.length = 0; calls.length = 0;
  return { sb, SM, Fl, env, calls, emissions, dropped };
}

ok(C.Floor.chainVerifies(CHAIN, HOLED) === false && C.Floor.chainVerifies(CHAIN.slice(0, 2), HOLED) === true,
  "PREMISE — the full chain must fail and the older pair verify against the holed log, or no retreat branch is reached");

// ── PART A — the wire reaches the real `canProve` ──────────────────────────────────────────────────────────────────────
{ const d = standUp(HOLED, CHAIN[0]); d.Fl.revalidate();
  ok(typeof d.env.canProve === "function", "A: the bridge's Floor wiring supplies no `canProve` — retreat by proof is unreachable in production, and " +
    "every floor change falls back to `trimmed ? needs-fetch : proved`", Object.keys(d.env));
  ok(d.calls.length >= 1, "A: the bridge's `canProve` never reached `StreamManager.canProve` while a floor stopped verifying — the wire is present " +
    "in name and decides nothing", d.calls);
}
// ── PART B — trimmed under the older floor: proved, so it retreats ─────────────────────────────────────────────────────
{ const d = standUp(HOLED, CHAIN[0]);
  ok(d.SM._trimState() === CHAIN[0].floorL && d.dropped > 0, "B PREMISE — the device really trimmed under the oldest cut", { trim: d.SM._trimState(), dropped: d.dropped });
  d.Fl.revalidate();
  ok(d.Fl.current() && d.Fl.current().floorL === CHAIN[0].floorL && d.emissions.indexOf("retreated") >= 0,
    "B: a trimmed device did not retreat to the floor it trimmed under — through the bridge's wiring the proof (`trimmed-under`) must " +
    "decide, and the fallback would demote it instead", { floor: d.Fl.current() && d.Fl.current().floorL, emissions: d.emissions, calls: d.calls });
}
// ── PART C — untrimmed, the room's start not held: not provable, so it withdraws ───────────────────────────────────────
{ const d = standUp(HOLED.filter((e) => e.l > 2), null);
  ok(d.SM._trimState() === null, "C PREMISE — the device is untrimmed");
  d.Fl.revalidate();
  ok(d.emissions.indexOf("retreated") < 0 && d.emissions.indexOf("withdrawn") >= 0,
    "C: an untrimmed device retreated onto a floor it cannot rebuild — through the bridge's wiring the proof must refuse (needs older " +
    "events) and the device withdraw; the fallback would stand it on a seed it has never rebuilt", { emissions: d.emissions, calls: d.calls });
}
// ── PART D — fail closed ───────────────────────────────────────────────────────────────────────────────────────────────
{ const d = standUp(HOLED, CHAIN[0], { throws: true });
  let r = null; try { r = d.env.canProve(CHAIN[0]); } catch (e) { r = { threwOut: String(e && e.message) }; }
  ok(r && r.ok === false && r.needsFetch === true, "D: when `StreamManager.canProve` throws, the bridge's wire must answer needs-fetch — never " +
    "proved, and never let the throw out into `revalidate`", r);
}
// ── PART E — the wire's other readers are the real module's ────────────────────────────────────────────────────────────
{ const d = standUp(HOLED, CHAIN[0]);
  ok(d.env.trimmed() === true && d.SM._trimState() !== null, "E: the bridge's `trimmed` does not read the trim state", { wire: d.env.trimmed(), trim: d.SM._trimState() });
  const ids = (a) => a.map((e) => e.eventId).join(",");
  ok(ids(d.env.log()) === ids(d.SM.proofLog()), "E: the bridge's `log` is not the proof log — Floor's chain verification would lose the quorum " +
    "floor's boundary", { wire: d.env.log().length, proof: d.SM.proofLog().length });
  ok(d.env.myRank() === 80 && d.env.settings() === SETTINGS, "E PREMISE — rank and settings come from the injected bridge helpers");
}
if (failed) { console.log("[floor-wire] " + failed + " failure(s)"); process.exit(1); }
console.log("[floor-wire] PASS — the bridge's own Floor wiring, taken out of `_wireConcepts` in the shipped file rather than copied, decides a " +
  "retreat: it reaches `StreamManager.canProve`; a trimmed device retreats to the floor it trimmed under and an untrimmed one that cannot " +
  "rebuild the older floor withdraws — the two cases where the no-proof fallback answers the opposite; a throwing proof fails closed to " +
  "needs-fetch; and its `log` and `trimmed` are the real proof log and trim state (" + asserts + " assertions)");
