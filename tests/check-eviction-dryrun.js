// tests/check-eviction-dryrun.js
// WALL: the EVICTION DRY RUN. Forgetting is not wired, and the one path with no evidence behind it
// is floor resolution: covers -> last event id -> raw.l. It has only ever run against probes that
// supplied the raw themselves. If it resolves null in a real room, the banked tier is unreachable
// and the feature is inert WITHOUT SAYING SO — the exact shape of the bug it replaced (a null floor
// meant the "safe to drop" branch could never fire, under a comment claiming it was fixed).
//
//   PART A — a dry run drops NOTHING, under any pressure, with any floor.
//   PART B — every way the floor can fail is NAMED and distinguishable. "0 dropped" without a
//     reason is the useless answer; `boundary-not-held` in particular is the case predicted to
//     fire in production and must not be confusable with a resolved floor.
//   PART C — the plan reports the tiers and where the drop loop stopped, and pairs the floor with
//     the pre-forget verdict, so step 3's licence gate ships with data rather than a guess.
//   PART D — the dry run and the real evictor are ONE planner. If they could disagree, the
//     evidence collected by dry-running would not describe what eviction will actually do.

const { loadInContext, ROOT } = require("./_load");
const fs = require("fs");
const path = require("path");

function fail(msg, got) {
  console.log("[eviction-dryrun] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(a, b, msg) { if (a !== b) fail(msg + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }
function ok(c, msg) { if (!c) fail(msg); }
const noop = () => {};

let L = 0;
function mkRaw(type, sender, rank, body) {
  L++;
  return {
    event_id: "$e" + L, type: "m.room.message", sender, room_id: "!r",
    ts: L * 1000, l: L, senderRank: rank,
    content: { body: JSON.stringify(Object.assign({ t: type, l: L }, body)) },
  };
}

// A cache with a controllable checkpoint and a controllable pre-forget verdict.
function harness(opts) {
  const o = opts || {};
  const cp = { trusted: o.trusted === undefined ? null : o.trusted };
  const extras = {
    Logger: { info: noop, warn: noop, error: noop, debug: noop },
    StreamManager: {
      getState: () => ({ settings: {} }),
      seedValidation: () => (o.verdict || { status: "not-yet-run", reason: "no-checkpoint" }),
      seedLicensesForget: () => (o.verdict ? o.verdict.status === "validated" : false),
    },
    Date,
  };
  // THE COLLABORATOR MOVED. EventCache asks Floor where the floor is now — the concept got its own
  // home. `noEngine` still means "the floor source is absent entirely", which is a real state: a
  // partial load, or a backend shipped without it. The claims below are unchanged.
  if (!o.noEngine) extras.Floor = { current: () => cp.trusted };
  const sb = loadInContext(
    // The record layer, the duty layer and the repair layer are one module now — the split into
    // three was by MECHANISM, which is what let one concept live in five places.
    ["backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
     "core/playlistdoc.js", "backends/backend1/session.js", "backends/backend1/scheduler.js",
     "backends/backend1/vouch.js", "backends/backend1/eventcache.js"],
    extras
  );
  L = 0;
  const raws = [
    mkRaw("ddjp.dj.join", "@a", 20, { v: "AAAAAAAAAAA" }),
    mkRaw("ddjp.dj.play", "@a", 20, { p: null }),
    mkRaw("ddjp.dj.vote", "@b", 20, { p: "$e2" }),      // non-critical
    mkRaw("ddjp.dj.save", "@b", 20, { p: "$e2" }),      // non-critical
    mkRaw("ddjp.dj.skip", "@s", 60, { p: "$e2" }),
  ];
  for (const r of raws) sb.EventCache.store(r);
  return { EC: sb.EventCache, cp: cp, raws: raws };
}

// ── PART A: a dry run changes nothing ────────────────────────────────────────────────────────
{
  const h = harness({ trusted: { grade: "verified", covers: "$e1..$e2" } });
  const before = h.EC.values().length;
  const p = h.EC.dryRunEviction();
  eq(h.EC.values().length, before, "A: a dry run drops nothing");
  ok(h.raws.every((r) => h.EC.has(r.event_id)), "A: every event is still held afterwards");
  ok(p && typeof p === "object", "A: a dry run returns a plan");
  eq(p._order, undefined, "A: the executor's internal list is not handed out");

  // and it computes even though we are nowhere near the cap — that is the point of forcing.
  eq(p.overCap, false, "A: reports honestly that we are under cap");
  ok(p.tiers, "A: the plan is computed anyway, so a healthy room still yields evidence");
}

// ── PART B: every floor failure is named ─────────────────────────────────────────────────────
{
  const cases = [
    ["no-engine",         { noEngine: true },                                                     null],
    ["no-checkpoint",     { trusted: null },                                                      null],
    ["not-proved",        { trusted: { grade: "trusted", covers: "$e1..$e2" } },                  null],
    ["no-covers",         { trusted: { grade: "verified" } },                                     null],
    ["boundary-not-held", { trusted: { grade: "verified", covers: "$e1..$nowhere" } },            null],
    ["resolved-covers",   { trusted: { grade: "verified", covers: "$e1..$e2" } },                 2],
    ["resolved-floorL",   { trusted: { grade: "verified", covers: "$e1..$e2", floorL: 99 } },     99],
  ];
  for (const [reason, opts, expectFloor] of cases) {
    const h = harness(Object.assign({ verdict: { status: "validated" } }, opts));
    const p = h.EC.dryRunEviction();
    eq(p.floorReason, reason, "B: " + reason + " is named");
    eq(p.floorResolved, expectFloor, "B: " + reason + " resolves the floor as expected");
  }

  // THE ONE THAT MATTERS. An unresolved floor must be distinguishable from a resolved one —
  // conflating them is how a feature ships inert while reporting success.
  const V = { status: "validated" };
  const bad = harness({ verdict: V, trusted: { grade: "verified", covers: "$e1..$nowhere" } }).EC.dryRunEviction();
  const good = harness({ verdict: V, trusted: { grade: "verified", covers: "$e1..$e2" } }).EC.dryRunEviction();
  eq(bad.floorResolved, null, "B: an unheld boundary leaves the floor null (conservative)");
  ok(good.floorResolved !== null, "B: a held boundary resolves it");
  ok(bad.floorReason !== good.floorReason, "B: the two are not confusable");

  // A substitute checkpoint is graded but not proved — the grade must be reported, not just used,
  // or "not-proved" cannot be told apart from "no checkpoint at all" in the field.
  const sub = harness({ verdict: V, trusted: { grade: "trusted", covers: "$e1..$e2" } }).EC.dryRunEviction();
  eq(sub.grade, "trusted", "B: the grade is reported alongside the refusal");
  const none = harness({ verdict: V, trusted: null }).EC.dryRunEviction();
  eq(none.grade, null, "B: no checkpoint reports no grade");

  // THE REAL-ROOM CASE. A self-sealed checkpoint used to carry no grade at all, so earnsForget
  // saw undefined and the floor never resolved — reported as "not-proved" with a null grade, a
  // pair that is internally contradictory (not-proved means a checkpoint EXISTS to judge). That
  // contradiction is the signature of a missing field rather than a policy refusal, so assert it
  // cannot come back: a graded checkpoint reports its grade, always.
  const ungraded = harness({ verdict: V, trusted: { covers: "$e1..$e2" } }).EC.dryRunEviction();
  eq(ungraded.floorReason, "not-proved", "B: an ungraded checkpoint is refused");
  eq(ungraded.grade, null, "B: and reports the absent grade, so the contradiction is visible");
}

// ── PART C: tiers, stopping point, and the licence pairing ───────────────────────────────────
{
  const h = harness({ trusted: { grade: "verified", covers: "$e1..$e2" }, verdict: { status: "validated" } });
  const p = h.EC.dryRunEviction();

  ok(p.tiers.nonCritical.n >= 2, "C: votes and saves land in the non-critical tier");
  eq(p.tiers.pinned.n + p.tiers.nonCritical.n + p.tiers.retirable.n + p.tiers.lastHolder.n, h.raws.length,
    "C: every held event is accounted for in exactly one tier");
  ok(p.tiers.nonCritical.bytes > 0, "C: tiers carry bytes, not just counts");

  eq(p.wouldDrop.n, 0, "C: under cap, nothing would be dropped");
  eq(p.wouldDrop.stoppedAt, "under-cap", "C: and it says WHY nothing was dropped");
  ok(p.wouldDrop.stoppedAt !== null, "C: a stopping point is always named");

  // THE WHOLE VERDICT, not a boolean. The first real-room dry run answered `licence: false`, which
  // conflates mismatched / never-ran / no-boundary — the exact collapse StreamManager was rebuilt
  // to prevent, reintroduced one layer up.
  eq(p.licence.status, "validated", "C: the pre-forget verdict is recorded alongside the floor");
  const nb = harness({ trusted: { grade: "verified", covers: "$e1..$e2" },
                       verdict: { status: "not-yet-run", reason: "no-boundary" } }).EC.dryRunEviction();
  eq(nb.licence.status, "not-yet-run", "C: an unlicensed room records the status");
  eq(nb.licence.reason, "no-boundary", "C: AND the reason — false on its own says nothing");
  const mm = harness({ trusted: { grade: "verified", covers: "$e1..$e2" },
                       verdict: { status: "mismatched", reason: "diverges-from-genesis" } }).EC.dryRunEviction();
  ok(mm.licence.status !== nb.licence.status,
    "C: a mismatch and an unrun check are distinguishable — they mean opposite things");

  // WITHHOLDING. Fixing the missing grade made the banked tier reachable for the first time, in
  // the one direction that loses history. A resolved floor must not be ACTED on until the
  // pre-forget check has concluded validated.
  ok(nb.floorResolved !== null, "C: the floor still RESOLVES without a licence — that is evidence");
  eq(nb.floorL, null, "C: but it is not USED");
  eq(nb.floorWithheld, true, "C: and the withholding is reported, not silent");
  eq(p.floorWithheld, false, "C: a licensed room is not withheld");
  eq(p.floorL, p.floorResolved, "C: and uses the floor it resolved");
}

// ── PART E: settings events named by a checkpoint are NEVER offered for eviction ─────────────
// A checkpoint asserts the room's settings and the seed copies the values, so once the events
// below the floor are gone the claim is unverifiable — believed because of who sealed it rather
// than checkable by anyone. The seed now names the event; this keeps that event reachable.
{
  const settingsRaw = mkRaw("ddjp.room.settings", "@owner", 100, { s: { maxLen: 300 } });
  const frozenRaw   = mkRaw("ddjp.room.settings", "@owner", 100, { s: { maxLen: 600 } });

  const mkPinned = (seed) => {
    const h = harness({ trusted: { grade: "verified", covers: "$e1..$e2" }, verdict: { status: "validated" } });
    h.EC.store(settingsRaw); h.EC.store(frozenRaw);
    h.cp.trusted = { grade: "verified", covers: "$e1..$e2", seed: seed };
    return h.EC.dryRunEviction();
  };

  // Baseline: with no reference, a settings event is an ordinary event and lands in a tier.
  const loose = mkPinned({ settings: {} });
  eq(loose.tiers.pinned.n, 0, "E: nothing is pinned when the seed names nothing");

  // The room's CURRENT settings event.
  const one = mkPinned({ settings: {}, settingsFrom: settingsRaw.event_id });
  eq(one.tiers.pinned.n, 1, "E: the event the seed names is pinned");
  ok(one.tiers.pinned.bytes > 0, "E: and carries real bytes, so it was a held event, not a phantom id");

  // The PER-SONG reference is deliberately NOT pinned — it is fetchable by id, and pinning it
  // would hold an event forever against a question nobody may ever ask.
  const two = mkPinned({ settings: {}, settingsFrom: settingsRaw.event_id,
                         nowPlaying: { settingsFrom: frozenRaw.event_id } });
  eq(two.tiers.pinned.n, 1, "E: only the room's current settings event is pinned");
  ok(two.tiers.nonCritical.n + two.tiers.retirable.n + two.tiers.lastHolder.n === two.count - 1,
    "E: and the per-song one is an ordinary droppable event");

  // A named id we do not hold pins nothing and breaks nothing.
  const missing = mkPinned({ settings: {}, settingsFrom: "$nowhere" });
  eq(missing.tiers.pinned.n, 0, "E: a reference to an event we lack pins nothing");

  // AND THE POINT: the pinned event is not merely dropped last, it is never offered. It must not
  // appear in any droppable tier at any pressure.
  ok(one.tiers.nonCritical.n + one.tiers.retirable.n + one.tiers.lastHolder.n === one.count - 1,
    "E: the pinned event is removed from the tiers entirely, not ranked within them");
}

// ── PART D: one planner, so the evidence describes the real thing ────────────────────────────
// STATIC. Executing this would need 200k events to breach the cap, which no guard here does — the
// codebase's habit is to guard the decision, not the loop. So this asserts the structural
// property instead, and is labelled as text analysis rather than proof of behaviour.
{
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const src = strip(fs.readFileSync(path.join(ROOT, "backends/backend1/eventcache.js"), "utf8"));
  const ev = src.slice(src.indexOf("function _evict()"));
  const body = ev.slice(0, ev.indexOf("\n  }") + 4);

  ok(/_plan\(/.test(body), "D: the executor gets its list from the planner");
  ok(!/canRetire|NON_CRITICAL_TYPES|covers|earnsForget/.test(body),
    "D: the executor holds NO tier or floor logic of its own — one planner, so a dry run and a " +
    "real eviction cannot diverge");
  ok(/dryRunEviction/.test(src), "D: the dry run is exported");
  const dry = src.slice(src.indexOf("function dryRunEviction"));
  ok(!/_mem\.delete|IDB\.del/.test(dry.slice(0, dry.indexOf("\n  }") + 4)),
    "D: the dry run cannot delete — asserted at the source, not only by observation");
}

console.log("[eviction-dryrun] PASS — a dry run computes the full plan and drops nothing; every floor outcome is NAMED and an unheld boundary (the case predicted to fire in production) is not confusable with a resolved floor; tiers, bytes and the stopping point are reported so \"0 dropped\" is never the whole answer; the pre-forget verdict is recorded alongside the floor and independently of it; and the executor carries no tier logic of its own, so the evidence describes the real path (that last part is static)");
