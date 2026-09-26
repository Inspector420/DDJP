// tests/check-min-dj-rank.js
// SUBJECT: backends/backend1/statederiver.js, ui/roster.js, ui/screens.js, features/actions.js
// THE MINIMUM RANK TO JOIN THE ROTATION IS A ROOM SETTING, JUDGED AT LOG POSITION (J07).
//
// It was `const MIN_DJ_RANK = RANK.UNCAT` with a "settings deferred" comment. MEASURED before it was
// replaced (tools/probes/probe-min-dj-rank.js Q1): the weakest rung on the ladder is level 0 and
// `levelOf("uncategorized")` is 0, so `rank < MIN_DJ_RANK` could not be true for any rank the
// transport can stamp. **There was no bar set loose — there was no bar, and a dead comparison
// standing where one would go.** That distinction is why this guard drives the rule rather than
// asserting a constant moved: a constant is what was already there.
//
// ── WHAT THIS FILE LOCKS ──────────────────────────────────────────────────────────────────────
// A: a join BELOW the bar is refused, one AT it is admitted, and one ABOVE it is admitted — walked
//    across the WHOLE ladder rather than at one rung, because a bar tested at one value is a bar
//    whose direction is unproven. The two-sided walk is the control: an "at or above" assertion with
//    no "below" case passes on a reducer that admits everyone, and a "below" case with no "at" case
//    passes on one that admits nobody.
// B: the refusal is a REJECTION, not merely an absence from the rotation. Legality is what
//    protection is spent on and what the seal cadence counts, so a join the fold refuses must be
//    OUT of the accepted set. A branch that fell through without rejecting would leave the event
//    legal — the exact defect consensus-models.md §5 records seven live instances of.
// C: LOG POSITION. A join before a raise is admitted and STAYS admitted after it; a join after the
//    raise is refused; and the bar in force at each join is the one the owner had set at THAT point,
//    not the newest. This is the half that makes the "no ejection" decision a property rather than
//    an intention.
// D: NO EJECTION, asserted as state rather than inferred from C. Raising the bar leaves an
//    already-admitted member in the rotation, with their buffer, and leaves a playing song playing.
// E: the reducer and `Capabilities.can("dj.join")` agree at every rung and at every bar — the
//    2-dimensional sweep. `check-capabilities` drives one point of this (the default bar); the drift
//    that matters is a bar the rulebook reads differently from the fold, which needs both axes.
// F: the vocabulary is DERIVED from the ladder and reachable through the interface as a COPY, so a
//    caller cannot widen the set the reducer will accept. Same rule as `blockedReasons()` (J06).
// G: the SEED. `settings` is sealed whole, so the bar rides into every checkpoint with no new
//    accumulator — and a seeded fold judges a join across the cut exactly as a genesis fold does.
//    Asserted by comparing the two folds' VERDICTS, never by the field's presence, which is the
//    shape check-blocked-reason PART D established for the same reason.
// H: the JOIN BUTTON asks the rule. Its own source is extracted from ui/roster.js and RUN against
//    the real adapter and rulebook: live exactly when the join is permitted, a refusal carrying the
//    backend's own reason, Leave never gated by the join rule, a resize keeping the reason, and a
//    promotion re-rendering it (the handler extracted from ui/screens.js and run).
//
// ── NO RANK NAME AND NO POWER LEVEL IS WRITTEN IN THIS FILE ───────────────────────────────────
// Every rung comes from `Ranks.LADDER` and every bar from `SETTING_RANGES.minDjRank.values`. So
// adding a rung to the ladder extends this guard the same day, and the file cannot rot by naming a
// rank that moved. (`_fixtures.js` owns the event shapes; F.RANK is derived from the ladder too.)

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js",
  "backends/backend1/streammanager.js",
  "backends/backend1/dials.js",
], { Date, Math, JSON });
const { StateDeriver, Ranks, Capabilities, StreamManager, Dials } = sb;

// `ok` COLLECTS rather than exits, so one red names every part that fired instead of only the
// first. 08-build-and-deploy.md: attributing a red in an exiting guard means clearing the failures
// ahead of it and re-running, which is a cost paid by whoever mutates this later.
let failed = 0, checks = 0;
function ok(cond, msg, got) {
  checks++;
  if (cond) return;
  failed++;
  console.log("[min-dj-rank] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const OWNER = "@owner:hs";
const LADDER = Ranks.LADDER;                                  // strongest first
const BARS = StateDeriver.SETTING_RANGES.minDjRank.values;     // the declared vocabulary
// The strongest rung the vocabulary offers, computed rather than taken as `BARS[0]`. That index
// assumed the offered list was the ladder in ladder order; it is now a FILTERED subset (v282), and
// `BARS[0]` appeared at seven sites — an index naming a position is not a name.
const STRICTEST = BARS.slice().sort((a, b) => Ranks.tierOf(a) - Ranks.tierOf(b))[0];
const inRotation = (st, u) => (st.rotation || []).some((r) => r.user === u);

// A COMPLETE settings blob, which is what the write path always sends: a partial one merges only
// its own fields and would exercise a path the panel never takes.
function setBar(id, l, ts, bar) {
  const blob = Object.assign({}, StateDeriver.defaultSettings(), { minDjRank: bar });
  return F.reducerEvent(id, l, ts, OWNER, F.RANK.owner, { t: "ddjp.room.settings", s: blob });
}
const joinAt = (id, l, ts, user, level) =>
  F.reducerEvent(id, l, ts, user, level, { t: "ddjp.dj.join", v: "SONG" });

// ── PART Z — the fixture reaches the branch at all ────────────────────────────────────────────
// The admissibility gate for everything below. A join fixture that never reaches the join branch
// refuses for free, and absence reads exactly like a finding (_fixtures.js's own header).
{
  const st = StateDeriver.derive([joinAt("$z", 1, 1000, "@z:hs", F.RANK.owner)]);
  ok(inRotation(st, "@z:hs"),
    "Z: the plain join fixture must reach the join branch and enter the rotation. If this fails, "
    + "every refusal below is a fixture that never arrived rather than a bar that worked");
  const bar = StateDeriver.derive([setBar("$s", 1, 1000, STRICTEST)]).settings.minDjRank;
  ok(bar === STRICTEST,
    "Z: the settings fixture must actually move the derived bar, or PART A varies nothing",
    { got: bar });
  if (failed) {
    console.log("[min-dj-rank] INADMISSIBLE — the fixtures do not reach the code. Stopping rather "
      + "than reporting results a broken fixture would produce identically in every tree.");
    process.exit(1);
  }
}

// ── PART A — the bar is two-sided, at every rung ──────────────────────────────────────────────
// For every declared bar, walk every rung: stronger-or-equal is admitted, weaker is refused.
{
  let admitted = 0, refused = 0;
  for (const bar of BARS) {
    for (const rung of LADDER) {
      const user = "@u" + rung.name.replace("-", "") + ":hs";
      const log = [setBar("$s", 1, 1000, bar), joinAt("$j", 2, 2000, user, rung.level)];
      const st = StateDeriver.derive(log);
      const expected = Ranks.atLeast(rung.level, bar);
      ok(inRotation(st, user) === expected,
        "A: with the bar at `" + bar + "`, a join from `" + rung.name + "` must be "
        + (expected ? "ADMITTED" : "REFUSED"),
        { bar: bar, rung: rung.name, inRotation: inRotation(st, user) });
      if (expected) admitted++; else refused++;
    }
  }
  // A filtered check must assert it filtered to something — and here BOTH directions must be
  // populated, or the sweep proves one half twice.
  ok(admitted > 0 && refused > 0,
    "A: the sweep must contain both admissions and refusals. A corpus with no refusals passes on a "
    + "reducer that ignores the bar; one with no admissions passes on a reducer that refuses "
    + "everyone", { admitted, refused });
}

// ── PART B — a refused join is a REJECTION, and an admitted one is legal ──────────────────────
{
  const strictest = STRICTEST;                    // the strongest rung the vocabulary offers
  const weakest = LADDER[LADDER.length - 1];    // the weakest rung on the ladder
  ok(!Ranks.atLeast(weakest.level, strictest),
    "B: the fixture must genuinely be below the bar, or the rejection assertion is vacuous",
    { bar: strictest, rung: weakest.name });

  const log = [setBar("$s", 1, 1000, strictest), joinAt("$j", 2, 2000, "@low:hs", weakest.level)];
  const both = StateDeriver.deriveBoth(log);
  ok(Array.isArray(both.accepted) && both.accepted.indexOf("$s") >= 0,
    "B: the accepted set must be populated — an empty one makes every rejection assertion below "
    + "pass for the wrong reason, which is the id-resolver failure consensus-models.md §5 records",
    { accepted: both.accepted });
  ok(both.accepted.indexOf("$j") < 0,
    "B: a join below the bar must be REJECTED, not merely absent from the rotation. Legality is "
    + "what protection is spent on and what the seal cadence counts, so a refused join left legal "
    + "manufactures vouch work for every client in the room", { accepted: both.accepted });

  // The control, same door, one detail changed: a join AT the bar is accepted AND legal.
  const okLog = [setBar("$s", 1, 1000, strictest), joinAt("$j2", 2, 2000, "@high:hs", Ranks.levelOf(strictest))];
  const okBoth = StateDeriver.deriveBoth(okLog);
  ok(okBoth.accepted.indexOf("$j2") >= 0,
    "B: a join AT the bar must be accepted and legal — without this control the rejection above is "
    + "indistinguishable from a fold that rejects every join", { accepted: okBoth.accepted });
}

// ── PART C — judged at LOG POSITION ───────────────────────────────────────────────────────────
{
  const strictest = STRICTEST;
  const weakest = LADDER[LADDER.length - 1];
  const early = "@early:hs", late = "@late:hs";

  // join (no bar) -> raise the bar -> a second join from the same weak rung
  const log = [
    joinAt("$jEarly", 1, 1000, early, weakest.level),
    setBar("$raise", 2, 2000, strictest),
    joinAt("$jLate", 3, 3000, late, weakest.level),
  ];
  const both = StateDeriver.deriveBoth(log);
  ok(inRotation(both.state, early),
    "C: a join folded BEFORE the raise stays in the rotation after it. A later setting governs what "
    + "happens next and never re-judges what already happened", { rotation: both.state.rotation });
  ok(!inRotation(both.state, late),
    "C: a join folded AFTER the raise, from the same rung, is refused — so the bar really is read "
    + "at each join's own position rather than once", { rotation: both.state.rotation });
  ok(both.accepted.indexOf("$jEarly") >= 0 && both.accepted.indexOf("$jLate") < 0,
    "C: and the two joins differ in LEGALITY too, not only in membership",
    { accepted: both.accepted });

  // The reverse direction: LOWERING the bar admits a rung that was refused a moment earlier.
  // Without this, C proves the bar can only ever tighten.
  const lowered = [
    setBar("$s1", 1, 1000, strictest),
    joinAt("$jNo", 2, 2000, "@a:hs", weakest.level),
    setBar("$s2", 3, 3000, BARS[BARS.length - 1]),
    joinAt("$jYes", 4, 4000, "@b:hs", weakest.level),
  ];
  const st = StateDeriver.derive(lowered);
  ok(!inRotation(st, "@a:hs") && inRotation(st, "@b:hs"),
    "C: lowering the bar admits the rung that was refused before it — the rule reads the value in "
    + "force at each position, in both directions", { rotation: st.rotation });
}

// ── PART D — raising the bar EJECTS NOBODY, and the room keeps playing ────────────────────────
// Asserted as state rather than inferred from C, because "the later join was refused" and "the
// earlier member is still here" are two properties and only the second is the decision.
{
  const strictest = STRICTEST;
  // A DJ strictly BELOW the strictest OFFERED bar. `guest` was below the old strictest (`owner`);
  // with the vocabulary narrowed to uncategorized..guest it is now AT the strictest, so the fixture
  // drops a rung. Derived rather than swapped for a literal, so a further narrowing moves it again.
  const belowRank = Ranks.atLeast(F.RANK.guest, strictest) ? F.RANK.uncategorized : F.RANK.guest;
  const room = F.playingRoom({ songs: 1, rank: belowRank });
  ok(!Ranks.atLeast(belowRank, strictest),
    "D: APPLIED — the playing DJ must be below the bar being set, or nothing is at risk of " +
    "ejection", { dj: belowRank, bar: strictest });

  const raised = F.sortLog(room.log.concat([setBar("$raise", room.lastL + 1, 900000, strictest)]));
  const before = StateDeriver.derive(F.sortLog(room.log));
  const after = StateDeriver.derive(raised);

  ok(after.settings.minDjRank === strictest,
    "D: the raise must actually land, or this part measures nothing", { got: after.settings.minDjRank });
  ok(inRotation(after, room.dj),
    "D: the DJ admitted under the old bar is STILL in the rotation after the raise. Ejection would "
    + "make `members` — which buildSeed seals — a function of a later settings event, so two clients "
    + "that had forgotten different amounts of history would have to agree about which past joins a "
    + "present setting voided: the divergence class checkpoint-contents.md §0 exists to prevent",
    { rotation: after.rotation });
  ok(!!after.nowPlaying && after.nowPlaying.dj === room.dj,
    "D: and the song they are playing keeps playing", { nowPlaying: after.nowPlaying });
  ok(JSON.stringify(after.rotation) === JSON.stringify(before.rotation),
    "D: the whole rotation is byte-identical across the raise, buffers included",
    { before: before.rotation, after: after.rotation });
}

// ── PART E — the rulebook agrees with the fold, on BOTH axes ──────────────────────────────────
// `Capabilities.can` is what greys the Join button, through `Actions.describe` — driven in PART H,
// because for the whole life of J07 this sentence was true of nothing. A rulebook more permissive than the fold offers
// a button whose event the room refuses; one more restrictive hides an action that would work. The
// sweep is 2-dimensional because a single-bar check passes on a rulebook that ignores the bar.
{
  let compared = 0, permittedSeen = 0, deniedSeen = 0;
  for (const bar of BARS) {
    const state = StateDeriver.derive([setBar("$s", 1, 1000, bar)]);
    for (const rung of LADDER) {
      const verdict = Capabilities.can("dj.join", state, { myId: "@x:hs", myRank: rung.level, now: 0 });
      const log = [setBar("$s", 1, 1000, bar), joinAt("$j", 2, 2000, "@x:hs", rung.level)];
      const acted = inRotation(StateDeriver.derive(log), "@x:hs");
      ok(verdict.permitted === acted,
        "E: can('dj.join') must equal whether the reducer acts — bar `" + bar + "`, rung `"
        + rung.name + "`", { permitted: verdict.permitted, acted: acted });
      // The contract: a denial carries a reason, a permission does not.
      ok(verdict.permitted ? verdict.reason === null : (typeof verdict.reason === "string" && verdict.reason),
        "E: the descriptor's reason must match its verdict — a denial with no reason reaches the "
        + "button title as an empty tooltip", { verdict });
      compared++;
      if (verdict.permitted) permittedSeen++; else deniedSeen++;
    }
  }
  ok(compared === BARS.length * LADDER.length,
    "E: the sweep must cover every (bar, rung) pair", { compared });
  ok(permittedSeen > 0 && deniedSeen > 0,
    "E: both verdicts must occur, or the equivalence is asserted in one direction only",
    { permittedSeen, deniedSeen });

  // A state with NO settings at all — several callers pass `{}`. It must answer the way the reducer
  // would on a room still on defaults, from the reducer's own default rather than a literal here.
  const dflt = StateDeriver.defaultSettings().minDjRank;
  for (const rung of LADDER) {
    const bare = Capabilities.can("dj.join", {}, { myId: "@x:hs", myRank: rung.level, now: 0 }).permitted;
    ok(bare === Ranks.atLeast(rung.level, dflt),
      "E: with no settings in state, the answer must fall back to the reducer's DEFAULT bar rather "
      + "than to a literal in capabilities.js", { rung: rung.name, bare: bare, dflt: dflt });
  }

  // A bar the reducer would REFUSE must not make the rulebook more permissive than the fold. The
  // rulebook treats it as absent; the fold never stored it in the first place.
  const alien = BARS.join("") + "-nope";
  for (const rung of LADDER) {
    const got = Capabilities.can("dj.join", { settings: { minDjRank: alien } },
      { myId: "@x:hs", myRank: rung.level, now: 0 }).permitted;
    ok(got === Ranks.atLeast(rung.level, dflt),
      "E: an illegal bar in state must be treated as absent, never as a bar of its own — a rulebook "
      + "reading a value the fold refused is the drift check-capabilities exists to catch",
      { rung: rung.name, got });
  }
}

// ── PART F — one home, derived, and handed out as a COPY ──────────────────────────────────────
{
  ok(StateDeriver.settingKindOf("minDjRank") === "values",
    "F: the reducer must classify the bar as a MEMBERSHIP entry. If it reads as `range`, `_inRange` "
    + "judges it numerically and every rank name is refused",
    { got: StateDeriver.settingKindOf("minDjRank") });

  // DERIVED from the ladder, not written down. Compared as sets against Ranks.NAMES, so a reordered
  // ladder does not fail this and a ladder with a new rung extends it.
  // ── A PROPER SUBSET OF THE LADDER, NOT ALL OF IT (v282) ──────────────────────────────────
  // This asserted the bars were EXACTLY `Ranks.NAMES`. The rotation floor is now offered from
  // `uncategorized` up to `guest` only: a floor above `guest` is a room where most arrivals cannot
  // queue at all, which the ladder already expresses through channel membership. **A range change,
  // not a new key** — the seed carries the settings blob and never the ranges, so narrowing the
  // offered list cannot move a fingerprint.
  ok(BARS.every((b) => Ranks.NAMES.indexOf(b) >= 0),
    "F: every accepted bar is a real rung of the ladder — still derived, so a renamed rung renames "
    + "these and a hand-written pair would be a second copy of the ladder", { bars: BARS });
  ok(BARS.length >= 2 && BARS.length < Ranks.NAMES.length,
    "F: and it is a PROPER SUBSET — offering all seven invited a setting that reads as a small "
    + "preference and acts as a lockout", { offered: BARS, ladder: Ranks.NAMES.length });

  // Every default must itself be a legal value, or the room ships unable to reproduce its own blob.
  ok(BARS.indexOf(StateDeriver.defaultSettings().minDjRank) >= 0,
    "F: the default bar must be one of the declared values");

  // A COPY through the interface. Mutating what the app is handed must not reach the fold.
  const handed = StreamManager.settingRanges();
  ok(handed && handed.minDjRank && Array.isArray(handed.minDjRank.values),
    "F: the interface must expose the bar's value set for the panel to render");
  handed.minDjRank.values.push("@tampered");
  handed.minDjRank.min = -1;
  const again = StreamManager.settingRanges();
  ok(again.minDjRank.values.indexOf("@tampered") < 0,
    "F: the interface hands out a COPY — the panel renders one control per entry in this list, so a "
    + "shared array lets a renderer widen the set the reducer will accept",
    { values: again.minDjRank.values });
  ok(StateDeriver.SETTING_RANGES.minDjRank.values.indexOf("@tampered") < 0,
    "F: and the reducer's own table is untouched by that write",
    { values: StateDeriver.SETTING_RANGES.minDjRank.values });
  const merged = StateDeriver.applySettingsEvent(StateDeriver.defaultSettings(), { minDjRank: "@tampered" });
  ok(merged.minDjRank !== "@tampered",
    "F: and the fold still refuses the value that was pushed into the handed-out copy",
    { got: merged.minDjRank });

  // The classification. LIVE, because a join is not a song and there is no snapshot to freeze onto.
  ok(Dials.isLive("minDjRank") && !Dials.isFrozen("minDjRank"),
    "F: the bar is a LIVE dial. FROZEN means snapshotted onto a SONG when it starts; a join is not "
    + "a song, so `frozen()` would fall through to `live()` on every call",
    { live: Dials.isLive("minDjRank"), frozen: Dials.isFrozen("minDjRank") });
  ok(Dials.live({ minDjRank: STRICTEST }, "minDjRank") === STRICTEST
    && Dials.live({}, "minDjRank") === StateDeriver.defaultSettings().minDjRank,
    "F: and reading it through Dials answers the room's value, falling back to the ONE default");
}

// ── PART G — the SEED, driven by verdict rather than by the field's presence ───────────────────
{
  const strictest = STRICTEST;
  const weakest = LADDER[LADDER.length - 1];

  // A room that raises the bar, then a checkpoint is taken, then a join arrives below the bar.
  const room = F.playingRoom({ songs: 2, rank: F.RANK.owner });
  const raise = setBar("$raise", room.lastL + 1, 900000, strictest);
  const upTo = F.sortLog(room.log.concat([raise]));
  const seed = StateDeriver.buildSeed(upTo);

  ok(seed && seed.settings && seed.settings.minDjRank === strictest,
    "G: the bar rides into the seed as part of the sealed settings blob — no new accumulator is "
    + "needed, because `settings` is already sealed whole", { got: seed && seed.settings && seed.settings.minDjRank });

  const after = [joinAt("$jAfter", room.lastL + 2, 950000, "@post:hs", weakest.level)];
  const genesis = StateDeriver.derive(F.sortLog(upTo.concat(after)));
  const seeded = StateDeriver.derive(after, seed);

  // The VERDICT is what must agree, not the field. A guard asserting the field is present passes on
  // a seed the fold then ignores — check-blocked-reason PART D's reasoning, same shape.
  ok(inRotation(genesis, "@post:hs") === inRotation(seeded, "@post:hs"),
    "G: a client that FORGOT behind the checkpoint must judge a join across the cut exactly as one "
    + "folding from genesis does. Disagreement here is the divergence forgetting exists to avoid",
    { genesis: inRotation(genesis, "@post:hs"), seeded: inRotation(seeded, "@post:hs") });
  ok(!inRotation(seeded, "@post:hs"),
    "G: and both must REFUSE it — a seeded fold that lost the bar would admit this join, which is "
    + "the failure the assertion above is shaped to catch rather than a redundant restatement",
    { seeded: inRotation(seeded, "@post:hs") });

  // The control in the other direction: the same join, at a rung the bar admits, must be admitted
  // by BOTH folds. Without it, "both refuse" is satisfied by a seeded fold that refuses everything.
  const okJoin = [joinAt("$jOk", room.lastL + 2, 950000, "@ok:hs", Ranks.levelOf(strictest))];
  const gOk = StateDeriver.derive(F.sortLog(upTo.concat(okJoin)));
  const sOk = StateDeriver.derive(okJoin, seed);
  ok(inRotation(gOk, "@ok:hs") && inRotation(sOk, "@ok:hs"),
    "G: a join AT the bar is admitted by both folds — the control that makes the refusal above "
    + "attributable to the bar rather than to a seeded fold that refuses every join",
    { genesis: inRotation(gOk, "@ok:hs"), seeded: inRotation(sOk, "@ok:hs") });

  // AND THE SEED SHAPE CHANGED, WHICH MOVED EVERY FINGERPRINT. Recorded as an assertion so the
  // consequence is visible in the suite rather than only in the handoff: `seed.nowPlaying.settings`
  // is a WHOLE-BLOB copy, so the key is in the per-song snapshot too despite being a LIVE dial —
  // the natural reading of "classify it LIVE" is that it would not be, and that reading is wrong.
  ok(seed.nowPlaying && seed.nowPlaying.settings
    && Object.keys(seed.nowPlaying.settings).length === Object.keys(seed.settings).length,
    "G: nowPlaying.settings is a whole-blob copy, so a LIVE classification does not keep a key out "
    + "of the per-song snapshot. Both are fingerprint-committed, which is why adding this key moved "
    + "every checkpoint's `h` and costs a room two fresh seals before it holds a floor again",
    { live: Object.keys(seed.settings).length,
      snapshot: seed.nowPlaying && seed.nowPlaying.settings && Object.keys(seed.nowPlaying.settings).length });

  // An OLD seed — one sealed before this key existed — must still FOLD, filling the default. The
  // fingerprint does not verify (that is the window), but the fold must not throw or blank the bar.
  const old = JSON.parse(JSON.stringify(seed));
  delete old.settings.minDjRank;
  delete old.nowPlaying.settings.minDjRank;
  const fromOld = StateDeriver.derive([], old);
  ok(fromOld.settings.minDjRank === StateDeriver.defaultSettings().minDjRank,
    "G: a seed sealed before the key existed still folds, resolving the bar to the default — the "
    + "honest answer, since that room WAS running under it, and safe because no past join is "
    + "re-judged. (Contrast J06, where the old shape had to be REFUSED: a bare number where a "
    + "{tier,k} object was expected would have counted nothing while looking fine.)",
    { got: fromOld.settings.minDjRank });
}

// ── PART H — the Join button ASKS the rule, and says why it refuses ────────────────────────────
// PART E proves the rulebook agrees with the fold. That was only ever half the claim: its comment
// said `Capabilities.can` is what greys the Join button, and for the whole life of J07 nothing did.
// `renderJoinBtn` never asked `Actions.describe("dj.join")` and no production code anywhere did, so
// a person below the room's bar was offered a live Join, the room refused the join, and nothing on
// screen said so — the forty-fourth signature, a correct rule reached by nothing, with every guard
// green because every guard drove the rule and none drove the button.
//
// EXECUTED, NOT READ. The button's own declarations are extracted from `ui/roster.js` by the shared
// scanner (`_probe-j14-card.js`, the one `check-user-card` uses — a second dialect of it would be a
// second thing to get wrong) and run. The ADAPTER and the RULEBOOK are the REAL modules over a state
// the REAL reducer derived: a double here would agree with whatever its author believed about who
// may join, which is the belief under test. Only the transport's identity, the device-local queue
// and the DOM are stood in for, each shaped from the real source (`Room.getMyAuthorityLevel` is
// what `Actions` asks first; `UserQueue.isActive` is a boolean and `stackCount` a number).
{
  const vm = require("vm");
  const P = require(path.join(__dirname, "_probe-j14-card.js"));
  const UI = "ui/roster.js";
  const pieces = ["_JOIN_LADDER", "_LEAVE_LADDER", "_fitJoinLabel", "renderJoinBtn"];
  const srcs = [];
  let stage = null;
  for (const p of pieces) {
    const ex = P.extractNamed(UI, p);
    if (!ex.ok) { stage = ex.stage; break; }
    srcs.push(ex.source);
  }
  ok(stage === null, "H: stage — " + stage + ". The button could not be extracted, which is a fact "
    + "about this probe; nothing below is a reading of the button");

  if (stage === null) {
    let curState = {}, curLevel = 0;
    const ab = loadInContext([
      "core/logger.js",
      "backends/backend1/ranks.js",
      "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js",
      "features/actions.js",
    ], {
      Date, Math, JSON,
      StreamManager: { getState: () => curState },
      Room: { getMyId: () => "@x:hs", getMyRank: () => curLevel, getMyAuthorityLevel: () => curLevel },
    });

    // The DOM, as small as the button needs. `title`, `disabled` and `textContent` are PROPERTIES,
    // exactly as `renderJoinBtn` and `_fitJoinLabel` write them.
    const cls = new Set();
    const btn = {
      title: "", textContent: "", disabled: false,
      classList: { add: (c) => cls.add(c), remove: (...cs) => cs.forEach((c) => cls.delete(c)),
                   contains: (c) => cls.has(c) },
      closest: () => null,   // unmounted: `_fitJoinLabel` keeps the longest label, as in the browser
    };
    const uq = { active: false, stack: 1 };
    const asked = [];
    const resizeFns = [], timers = [];
    const box = {
      refs: { joinBtn: btn, leaveLockBtn: null },
      UserQueue: { isActive: () => uq.active, stackCount: () => uq.stack },
      // A RECORDER over the real adapter, never a decider: it forwards every question unchanged.
      Actions: { describe: (a, t) => { asked.push(a); return ab.Actions.describe(a, t); } },
      H: { _relock() {}, _renderLeaveLock() {} },
      window: { addEventListener: (t, f) => { if (t === "resize") resizeFns.push(f); } },
      setTimeout: (f) => { timers.push(f); return timers.length; },
      clearTimeout: () => {},
      console,
    };
    vm.createContext(box);
    let threw = null;
    try {
      vm.runInContext("let _joinResizeWired = false;\n" + srcs.join("\n")
        + "\n;globalThis.__render = renderJoinBtn; globalThis.__joinLabel = _JOIN_LADDER[0];", box);
    } catch (e) { threw = e.message; }
    ok(threw === null, "H: the extracted button would not load (" + threw + ")");

    const render = () => { try { box.__render(); return null; } catch (e) { return e.message; } };
    const verdictAt = (level) =>
      ab.Capabilities.can("dj.join", curState, { myId: "@x:hs", myRank: level, now: 0 });

    if (threw === null) {
      // ── H1: Join agrees with the rulebook at every (bar, rung), and a refusal carries the
      // backend's OWN reason as its tooltip — the user card's rule (roles.md §5, THE USER CARD).
      let denied = 0, permitted = 0, compared = 0, deniedCase = null;
      for (const bar of BARS) {
        curState = StateDeriver.derive([setBar("$s", 1, 1000, bar)]);
        for (const rung of LADDER) {
          curLevel = rung.level; uq.active = false; uq.stack = 1;
          asked.length = 0;
          const err = render();
          const v = verdictAt(rung.level);
          compared++;
          if (v.permitted) permitted++; else { denied++; if (!deniedCase) deniedCase = { bar, rung, v }; }
          ok(err === null, "H1: renderJoinBtn threw (" + err + ")");
          ok(asked.indexOf("dj.join") >= 0,
            "H1: renderJoinBtn never asked Actions.describe(\"dj.join\") — the button cannot refuse a "
            + "join the room will refuse, because it never asks", { bar, rung: rung.name, asked });
          ok(btn.disabled === !v.permitted,
            "H1: the Join button must be live exactly when the rulebook permits the join — bar `" + bar
            + "`, rung `" + rung.name + "`. A live button below the bar sends a join every client "
            + "refuses and leaves the person believing they are queued",
            { disabled: btn.disabled, permitted: v.permitted });
          if (!v.permitted) {
            ok(btn.title === v.reason,
              "H1: a refused Join must say WHY in the backend's own words, as the user card does — "
              + "a reason written in the UI is a second copy of the rule", { title: btn.title, reason: v.reason });
          } else {
            ok(btn.title === box.__joinLabel,
              "H1: a permitted Join keeps its full label as the tooltip", { title: btn.title });
          }
        }
      }
      ok(compared === BARS.length * LADDER.length && permitted > 0 && denied > 0,
        "H1: the sweep must cover every (bar, rung) pair and see BOTH verdicts, or the agreement is "
        + "asserted in one direction only", { compared, permitted, denied });

      // ── H2: the device's own precondition survives — no songs, no Join, even where permitted.
      curState = StateDeriver.derive([setBar("$s", 1, 1000, StateDeriver.defaultSettings().minDjRank)]);
      curLevel = LADDER[0].level; uq.active = false; uq.stack = 0;
      render();
      ok(verdictAt(curLevel).permitted && btn.disabled === true,
        "H2: with nothing queued the button stays disabled even when the room would admit the join — "
        + "joining with nothing to play makes an invisible member that never rotates",
        { disabled: btn.disabled });

      // ── H3: LEAVE is never gated by the join rule. It is the way out: a person already active is
      // either in the rotation (a raised bar ejects nobody — PART D) or waiting on a join the room
      // refused, and greying Leave there would trap them in a state nothing on screen explains.
      if (deniedCase) {
        curState = StateDeriver.derive([setBar("$s", 1, 1000, deniedCase.bar)]);
        curLevel = deniedCase.rung.level; uq.active = true; uq.stack = 1;
        render();
        ok(btn.disabled === false && cls.has("active"),
          "H3: in Leave mode the button stays live below the bar — Leave must never be greyed by the "
          + "JOIN rule", { disabled: btn.disabled, active: cls.has("active") });
      }

      // ── H4: a window resize must not wipe the reason. The resize hook re-fits the label, and
      // `_fitJoinLabel` rewrites `title`; a hook that only re-fits turns the refusal back into a
      // plain label the first time the window moves.
      if (deniedCase) {
        curState = StateDeriver.derive([setBar("$s", 1, 1000, deniedCase.bar)]);
        curLevel = deniedCase.rung.level; uq.active = false; uq.stack = 1;
        render();
        ok(resizeFns.length === 1, "H4 premise: the resize hook was wired exactly once",
          { hooks: resizeFns.length });
        if (resizeFns.length) {
          timers.length = 0;
          resizeFns[0]();
          while (timers.length) timers.shift()();
          ok(btn.disabled === true && btn.title === deniedCase.v.reason,
            "H4: after a resize the refused Join still says why", { disabled: btn.disabled, title: btn.title });
        }
      }
    }
  }

  // ── H5: a PROMOTION re-renders the button. A rank change is a Matrix power-level change, not a
  // room event, so `Queue.onStateChange` does not fire for it — without this subscription a person
  // promoted above the bar sees a greyed Join until some unrelated event happens to arrive. The
  // subscription's own handler is extracted from `ui/screens.js` and RUN, not grepped.
  {
    const fs = require("fs");
    const SCR = "ui/screens.js";
    const src = fs.readFileSync(path.join(__dirname, "..", SCR), "utf8");
    const anchor = "Room.onRankChange(";
    const hits = src.split(anchor).length - 1;
    ok(hits === 1, "H5: `" + anchor + "` appears " + hits + " times in " + SCR + ", expected 1 — this "
      + "cannot tell which subscription it is reading");
    if (hits === 1) {
      const open = src.indexOf(anchor) + anchor.length - 1;
      const close = P.matchPair(src, open, "(", ")");
      const handlerSrc = close > open ? src.slice(open + 1, close) : null;
      const calls = [];
      const rec = (name) => new Proxy({}, { get: (t, k) => () => { calls.push(name + "." + String(k)); } });
      // ONE RECORDER PER GLOBAL THE HANDLER REACHES, and the list is a grammar that ages (the
      // forty-ninth signature): at ddjp_425 the handler stopped rendering the Feed panel and started
      // re-syncing the chat, and this list turned the handler into a ReferenceError until
      // `ChatPanels` joined it. Loud, which is the safe direction.
      const box2 = { Roster: rec("Roster"), Panels: rec("Panels"), QueuePanels: rec("QueuePanels"),
                     Settings: rec("Settings"), ChatPanels: rec("ChatPanels") };
      vm.createContext(box2);
      let err = handlerSrc ? null : "the handler could not be bracket-matched";
      if (!err) { try { vm.runInContext("(" + handlerSrc + ")()", box2); } catch (e) { err = e.message; } }
      ok(err === null, "H5: the extracted rank-change handler would not run (" + err + ")");
      ok(calls.indexOf("Roster.renderMyRank") >= 0,
        "H5 premise: the handler ran and re-rendered the rank badge, so an absence below is a reading",
        { calls });
      ok(calls.indexOf("Roster.renderJoinBtn") >= 0,
        "H5: a rank change must re-render the Join button, whose live/greyed state now depends on rank",
        { calls });
    }
  }
}

if (failed) {
  console.log("[min-dj-rank] " + failed + " of " + checks + " assertions FAILED");
  process.exit(1);
}
console.log("[min-dj-rank] PASS — the lowest rank allowed to join the rotation is a room SETTING "
  + "judged at log position, not a constant: every rung is walked against every declared bar in both "
  + "directions, a join below the bar is REJECTED rather than merely absent (so it is never vouched "
  + "and never counts toward the seal cadence) with a join at the bar as its control, and the bar in "
  + "force is the one at each join's own position — raising it refuses later joins while EJECTING "
  + "NOBODY already in the rotation, buffers and playing song byte-identical across the raise, "
  + "because ejection would make the sealed `members` accumulator a function of a later settings "
  + "event. `Capabilities.can('dj.join')` is driven against the reducer across every (bar, rung) "
  + "pair, with a bar the fold refuses treated as absent so the rulebook can never be the more "
  + "permissive of the two. The vocabulary is DERIVED from `Ranks.NAMES` — no rank name or power "
  + "level appears in this file — and handed to the app as a COPY, proven by tampering with what the "
  + "interface returns and watching the fold still refuse it. And it reaches the checkpoint SEED "
  + "with no new accumulator, driven by comparing the seeded fold's VERDICT on a join across the cut "
  + "against the genesis fold's, in both directions. And the Join BUTTON asks it: extracted from "
  + "ui/roster.js and run against the real adapter over the real rulebook at every (bar, rung), it is "
  + "live exactly when the join is permitted and a refusal carries the backend's own reason, while "
  + "Leave is never greyed by the join rule and a promotion re-renders it (" + checks + " assertions)");
