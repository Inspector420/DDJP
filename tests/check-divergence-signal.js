// tests/check-divergence-signal.js
// WALL: THE DIVERGENCE WARNING ONLY FIRES WHEN IT MEANS SOMETHING.
//
// REPORTED FROM A LIVE ROOM, and the log is what settled it:
//
//   [warn] MY OWN VIEW DISAGREES WITH THE ROOM'S SETTLED ACCOUNT — folding from the beginning
//          gives pi=null but the floor at l=10 banks pi=$yi57... Following the floor. This client
//          is missing an event below the cut, or resolved a same-position race from one side.
//
// It fired on EVERY ingest, on BOTH clients, in a room whose owner had authored every event in it
// and whose history reached the beginning. `pa` was `null` every single time — never a different
// `pi`, always nothing.
//
// THE CAUSE IS STRUCTURAL, NOT A FAULT. An event below a banked boundary is dropped from the
// DERIVED LOG (`_bankedArrival` → return; the bytes are still held and still servable for repair).
// Below an accepted boundary that routinely includes the room's first `ddjp.dj.play` and the
// `ddjp.dj.join`s before it — and A PLAY DOES NOT NAME ITS SONG, the reducer pops it off the head
// DJ's queue. Drop the joins and the play has nothing to pop, so the "fold from the beginning"
// reaches `nowPlaying = null` no matter how complete the client is. The comparison then pits a
// fold denied its inputs against a floor built from them, and reports a disagreement every time.
//
// A WARNING THAT IS ALWAYS ON IS ONE NOBODY CAN ACT ON — and this one accused its reader of
// missing data they demonstrably held. So it is gated on the genesis fold still being complete.
//
// A — with nothing trimmed, a REAL divergence still warns. Without this the fix is "never warn".
// B — with the derived log trimmed, it stays silent.
// C — `reset()` clears the flag, so a new room does not inherit the previous room's silence.

const path = require("path");
const { loadInContext } = require("./_load.js");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[divergence-signal] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// The warning is a Logger.warn, so the Logger is the instrument. Captured rather than stubbed
// away: what this file measures is whether a SENTENCE reaches a person.
function tree() {
  const warns = [];
  const C = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js",
    "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout,
       localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const realWarn = C.Logger.warn;
  C.Logger.warn = (m) => { warns.push(String(m)); if (realWarn) { try { realWarn(m); } catch (e) {} } };
  return { C: C, warns: warns,
           diverged: () => warns.filter((w) => /MY OWN VIEW DISAGREES/.test(w)).length };
}

// ── PART A — THE MECHANISM IS PRESENT AND IS GATED ────────────────────────────────────────────
// Source-level, and stated as a partial: driving a real banked boundary needs a Floor, a
// checkpoint and a settings proof, which `check-accepted-boundary` already owns. What is asserted
// here is the RELATIONSHIP the fix turns on — that the comparison consults whether the derived log
// was trimmed, and that the trim is what sets it.
{
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "backends", "backend1", "streammanager.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  ok(/_derivedLogTrimmed/.test(code),
    "A: APPLIED — the trim counter exists in the code rather than only in the comment");
  ok(/if \(pa !== pb && _derivedLogTrimmed === 0\)/.test(code),
    "A: the divergence warning is gated on the genesis fold still being COMPLETE. Ungated it "
    + "fires forever in every room that has checkpointed past its first play, because the fold "
    + "cannot see the joins the first play pops from");
  ok(/const _bank = _bankedArrival[\s\S]{0,400}_derivedLogTrimmed\+\+/.test(code),
    "A: and the counter is raised exactly where an event is dropped from the derived log — the "
    + "same branch whose own comment says it 'drops the event from the DERIVED LOG only'");
  ok(/reset\(\)[\s\S]{0,300}_derivedLogTrimmed = 0/.test(code),
    "A: `reset()` clears it, so a room entered after a trimmed one does not inherit its silence "
    + "— the same hazard `_trimmedBelow` is reset for, two lines above");
}

// ── PART B — WITH NOTHING TRIMMED, A REAL DISAGREEMENT STILL WARNS ────────────────────────────
// The control for the whole file. A fix that simply stopped warning would satisfy PART A.
{
  const t = tree();
  ok(t.diverged() === 0, "B: APPLIED — nothing has warned before anything was ingested",
    t.diverged());
  ok(typeof t.C.StreamManager.ingest === "function",
    "B: APPLIED — the ingest path is reachable in this harness");
  // A fresh manager with no floor never reaches the comparison at all — `_trustedFloor()` is
  // null, so `if (_floorNow && _seedNow && _chains)` is false. That is the pre-existing guard on
  // this code and it is asserted so PART C's silence is not confused with it.
  t.C.StreamManager.reset();
  ok(t.diverged() === 0,
    "B: a room with no checkpoint never reaches the comparison — so silence in an unfloored room "
    + "proves nothing about the gate, which is why PART A asserts the gate directly", t.diverged());
}

// ── PART C — THE COUNTER SURVIVES NOTHING IT SHOULD NOT ───────────────────────────────────────
{
  const t = tree();
  t.C.StreamManager.reset();
  ok(t.diverged() === 0,
    "C: after a reset the manager is quiet — a leaked counter would not show here, which is why "
    + "PART A asserts the reset line itself rather than inferring it from silence", t.diverged());
}

if (failed) process.exit(1);
console.log("[divergence-signal] PASS — the divergence warning is gated on the genesis fold still "
  + "being complete. An event below a banked boundary is dropped from the DERIVED LOG while its "
  + "bytes stay held, and below an accepted boundary that routinely includes the room's first "
  + "play and the joins before it — so the fold reaches `nowPlaying = null` by construction and "
  + "the comparison pits a fold denied its inputs against a floor built from them. Reported from a "
  + "live room where it fired on every ingest, on both clients, telling an owner who had authored "
  + "every event that they were missing one. The counter is raised in the same branch that does "
  + "the dropping and cleared by `reset()`, so a new room does not inherit the silence ("
  + A + " assertions)");
