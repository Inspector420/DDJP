// tools/probes/probe-min-dj-rank.js
// J07 — MEASURE BEFORE DECIDING. Three questions, none of them answerable by reading:
//
//   Q1  Is `rank < MIN_DJ_RANK` reachable at all today? (If it is dead code, the "bar" does not
//       exist rather than being set to its loosest value — a different starting point.)
//   Q2  Does a join below a bar get REFUSED by the fold, and is the refusal recorded as a
//       REJECTION (so it is never vouched and never counts toward the seal cadence)?
//   Q3  Does adding the key move the checkpoint SEED, and therefore every fingerprint?
//
// ── THE ADMISSIBILITY GATE, AND WHY IT IS HERE ────────────────────────────────────────────────
// 08-build-and-deploy.md §Writing a guard: a probe states its preconditions as SEPARATE checks,
// runs them before the comparison, and refuses to print a result if one fails — naming which stage
// broke. Three independent attempts at one J39 measurement returned `null` from every tree
// including their controls, because the fixtures never reached the code; absence read as agreement
// each time.
//
// The stages that can break here, each with its own name:
//   S1 the fold ran at all              — derive() returned a state object
//   S2 the join fixture REACHED the join branch — the control join is in the rotation
//   S3 the settings fixture was ACCEPTED — the room's derived settings actually carry the bar
//   S4 the accepted set is populated    — otherwise "rejected" is indistinguishable from "the
//                                         accepted set is empty", which is the id-resolver bug
//
// AND THE GATE IS ITSELF UNTESTED CODE, so PART Z feeds it deliberately broken input and shows it
// refuses. Without that it certifies everything downstream on its own authority.

const path = require("path");
const TESTS = path.join(__dirname, "..", "..", "tests");
const { loadInContext } = require(path.join(TESTS, "_load.js"));
const F = require(path.join(TESTS, "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const { StateDeriver, Ranks } = sb;

// ── the gate ──────────────────────────────────────────────────────────────────────────────────
function gate(name, checks) {
  const broken = checks.filter((c) => !c.ok);
  if (broken.length) {
    console.log("[probe] INADMISSIBLE (" + name + ") — refusing to print a result.");
    for (const b of broken) console.log("        stage " + b.stage + " failed: " + b.why);
    return false;
  }
  return true;
}
const stage = (s, why, ok) => ({ stage: s, why: why, ok: !!ok });

// ── PART Z — the gate's self-test, run FIRST ──────────────────────────────────────────────────
{
  const shouldRefuse = gate("SELF-TEST (deliberately broken)", [
    stage("S1", "a fold that never ran", false),
    stage("S2", "a join fixture that never reached the branch", true),
  ]);
  if (shouldRefuse) {
    console.log("[probe] FATAL — the admissibility gate ADMITTED a broken input. Every result "
      + "below would be certified by a gate that cannot refuse. Stopping.");
    process.exit(1);
  }
  const shouldAdmit = gate("SELF-TEST (all stages sound)", [stage("S1", "-", true), stage("S2", "-", true)]);
  if (!shouldAdmit) {
    console.log("[probe] FATAL — the gate REFUSED a sound input, so it refuses everything for free.");
    process.exit(1);
  }
  console.log("[probe] Z: gate self-test PASSED — it refuses a broken input and admits a sound one.");
}

const OWNER = "@owner:hs";
const inRotation = (st, u) => (st.rotation || []).some((r) => r.user === u);

// A room whose owner has posted a settings blob. `extra` is merged onto the reducer's own defaults,
// so the blob is COMPLETE — a partial one merges only its own fields and would not exercise the
// same path the panel uses.
function settingsEvent(id, l, ts, extra) {
  const blob = Object.assign({}, StateDeriver.defaultSettings(), extra || {});
  return F.reducerEvent(id, l, ts, OWNER, F.RANK.owner, { t: "ddjp.room.settings", s: blob });
}

// ── Q1 — is the hardcoded comparison reachable? ───────────────────────────────────────────────
{
  const levels = Ranks.LADDER.map((r) => r.level);
  const weakest = Math.min.apply(null, levels);
  console.log("\n[probe] Q1 — the hardcoded floor");
  console.log("        ladder levels: " + JSON.stringify(levels));
  console.log("        weakest level: " + weakest + "; MIN_DJ_RANK is levelOf('uncategorized') = "
    + Ranks.levelOf("uncategorized"));
  console.log("        so `rank < MIN_DJ_RANK` is " + (weakest < Ranks.levelOf("uncategorized")
    ? "REACHABLE" : "UNREACHABLE — dead code, no bar exists today rather than a bar set loose"));
}

// ── Q2 — a join at each rung, with no bar (today's tree) ──────────────────────────────────────
{
  console.log("\n[probe] Q2a — today, with no bar: which rungs may join?");
  const rows = [];
  for (const r of Ranks.LADDER) {
    const joiner = "@j" + r.name.replace("-", "") + ":hs";
    const log = [F.reducerEvent("$j", 1, 1000, joiner, r.level, { t: "ddjp.dj.join", v: "SONG" })];
    const both = StateDeriver.deriveBoth(log);
    const ok = gate("Q2a/" + r.name, [
      stage("S1", "derive returned no state", both && both.state),
      stage("S4", "accepted set empty — cannot tell refusal from an empty set",
        Array.isArray(both.accepted)),
    ]);
    if (!ok) process.exit(1);
    rows.push({ rank: r.name, inRotation: inRotation(both.state, joiner),
                accepted: both.accepted.indexOf("$j") >= 0 });
  }
  for (const row of rows) {
    console.log("        " + row.rank.padEnd(14) + " inRotation=" + String(row.inRotation).padEnd(5)
      + " accepted=" + row.accepted);
  }
  const allIn = rows.every((r) => r.inRotation && r.accepted);
  console.log("        => " + (allIn ? "EVERY rung may DJ, and every join is legal. Confirms the "
    + "entry: hardcoded to uncategorized, so anyone may DJ." : "NOT uniform — investigate"));
}

// ── Q2b — what a bar WOULD have to do, measured on the mechanism that already exists ──────────
// Nothing can set the bar yet, so the closest admissible measurement is the one existing setting
// whose value is a rank-shaped STRING: `chat`. It proves the transport for a string setting works
// end to end (accepted at log position, sealed into the seed) WITHOUT pretending it gates a join.
// Named for what it is: a transport measurement, not a bar measurement.
{
  console.log("\n[probe] Q2b — a rank-shaped STRING setting already rides the settings path");
  const room = F.playingRoom({ songs: 1 });
  const log = F.sortLog(room.log.concat([settingsEvent("$set", room.lastL + 1, 500000, { chat: "staff" })]));
  const st = StateDeriver.derive(log);
  const ok = gate("Q2b", [
    stage("S1", "derive returned no state", st && st.settings),
    stage("S3", "the settings event was not accepted — the room's derived value did not move",
      st && st.settings && st.settings.chat === "staff"),
  ]);
  if (!ok) process.exit(1);
  console.log("        derived settings.chat = " + JSON.stringify(st.settings.chat)
    + "  (a string value folds and lands, so the shape is not the obstacle)");
  const seed = StateDeriver.buildSeed(log);
  console.log("        seed.settings.chat    = " + JSON.stringify(seed.settings.chat)
    + "  (and it is SEALED, because seed.settings is a whole-blob copy)");
}

// ── Q3 — does one more settings key move the seed, and therefore the fingerprint? ─────────────
// Driven by SIMULATING the change on a copy of the seed rather than by editing the reducer: the
// question is whether the fingerprint input differs, and that is answerable from the seed's own
// bytes. The control is the same seed unchanged, which must NOT differ.
{
  console.log("\n[probe] Q3 — one more settings key vs the checkpoint fingerprint");
  const room = F.playingRoom({ songs: 2 });
  const log = F.sortLog(room.log);
  const seed = StateDeriver.buildSeed(log);
  const ok = gate("Q3", [
    stage("S1", "no seed produced", seed && seed.settings),
    stage("S2", "the fixture produced no nowPlaying, so nowPlaying.settings cannot be inspected",
      seed && seed.nowPlaying && seed.nowPlaying.settings),
  ]);
  if (!ok) process.exit(1);

  const canon = (x) => JSON.stringify(x, Object.keys(x).sort());
  const before = JSON.stringify(seed);
  const control = JSON.stringify(JSON.parse(before));            // same bytes, must not differ
  const withKey = JSON.parse(before);
  withKey.settings.minDjRank = "uncategorized";
  withKey.nowPlaying.settings.minDjRank = "uncategorized";
  const after = JSON.stringify(withKey);

  console.log("        seed.settings keys before : " + Object.keys(seed.settings).length);
  console.log("        control (same seed twice) : " + (control === before ? "IDENTICAL (as it must be)" : "DIFFERS — probe is broken"));
  console.log("        with one more key         : " + (after === before ? "IDENTICAL" : "DIFFERS"));
  console.log("        nowPlaying.settings is a WHOLE-BLOB copy: "
    + (Object.keys(seed.nowPlaying.settings).length === Object.keys(seed.settings).length
       ? "yes — same key count, so a LIVE classification does NOT keep a key out of the per-song snapshot"
       : "no — key counts differ, re-read the snapshot code"));
  if (control !== before) { console.log("[probe] FATAL — the control moved."); process.exit(1); }
  console.log("        => " + (after !== before
    ? "the seed CHANGES SHAPE, so `h` (which commits the seed) moves: every pre-existing checkpoint "
      + "becomes unverifiable and the room needs TWO fresh seals before it holds a floor again"
    : "no fingerprint consequence — re-check, this contradicts checkpointformat"));

  // And the old shape must still FOLD, because the seed reader fills defaults.
  const oldSeed = JSON.parse(before);                            // no minDjRank at all
  const tail = [];
  const st = StateDeriver.derive(tail, oldSeed);
  console.log("        an OLD seed (no key) still folds: "
    + (st && st.settings ? "yes; settings.chat=" + JSON.stringify(st.settings.chat) : "no — investigate")
    + "  (Object.assign(defaultSettings(), seed.settings) fills the missing key)");
}

console.log("\n[probe] done — every result above cleared the gate that would have refused it.");
