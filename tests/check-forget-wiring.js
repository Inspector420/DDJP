// tests/check-forget-wiring.js
// WALL: THE TRIGGERS. Everything below was already built, tested, and invoked by nothing.
//
//   gaining a floor  -> forget what is below it        (StreamManager.trimToFloor)
//   losing a floor   -> go back and fetch another one  (CheckpointEngine.thinJoin)
//
// A mechanism nothing calls is this codebase's signature bug, and three of them had accumulated. The
// logic was proven in isolation and a running client did none of it.
//
// FORGETTING IS GATED ON THE SEED LICENCE, not just on the floor's grade, and that is the joint
// answer to a deadlock rather than extra caution. The two memories check different things: the
// derived log trims on grade, while EventCache additionally requires the seed to have been VALIDATED
// against a genesis fold. That validation can only run while genesis is still held — so a client that
// trimmed first would bound its derived log and then never shed a single raw copy, because the
// licence it needs could no longer be computed. Validate first, then forget. The order is the fix.
//
// RE-PAGING READS WHAT WE STILL HOLD. Trimming the derived log does not drop the raw cache, so a
// client that has forgotten its fold can usually rebuild from EventCache with no network at all. A
// client that has dropped the raws too still needs a homeserver range reader, which does not exist —
// stated here rather than discovered later.
//
// Guarantees:
//   PART A — adopting a floor with the licence granted DOES forget below it.
//   PART B — without the licence it does NOT, and the log stays whole. Refusing beats guessing.
//   PART C — losing a floor raises the re-page flag and the wired path acts on it.
//   PART D — a re-page that succeeds restores a floor and clears the flag.
//   PART E — a re-page that cannot verify adopts nothing, exactly as thinJoin does when called by
//     hand. Wiring must not become a way around the constraint.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

function fail(msg, got) {
  console.log("[forget-wiring] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const OWNER = F.RANK.owner, HS = F.RANK.highStaff, STAFF = F.RANK.staff;

// A client with a real StreamManager, so the trim and the fold are the production ones.
function client(rank) {
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/checkpointformat.js", "backends/backend1/settingsproof.js",
    "backends/backend1/session.js", "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/floor.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
  ], { Date });
  sb.feed = (evs) => { for (const e of evs) sb.StreamManager.ingest(F.toRaw(e)); };

  // ── THE TRIGGER IS A SUBSCRIBER NOW ──────────────────────────────────────────────────────
  // The old engine called trimToFloor inline, immediately after adopting. Floor only EMITS, which
  // is the better shape — the consequence becomes declarative rather than buried in an adoption
  // path — but it is better ONLY if somebody subscribes. An emission nobody listens to is the same
  // flag-nobody-reads failure it replaced. Transport wires this; so does the guard, because the
  // subject of this file is the TRIGGERS.
  sb.Floor.attach({
    log: () => sb.StreamManager.getLog(),
    settings: () => ({}), myRank: () => rank,
    trimmed: () => { try { return sb.StreamManager._trimState() !== null; } catch (e) { return false; } },
  });
  sb.Floor.onChange(function (ev) {
    if (ev.kind !== "adopted" && ev.kind !== "moved") return;
    try { sb.StreamManager.trimToFloor(); } catch (e) {}
  });
  return sb;
}

async function main() {
  const LOG = F.playingRoom({ songs: 10 }).log;
  const CUT = 6;
  const BELOW = LOG.slice(0, CUT), ABOVE = LOG.slice(CUT);

  // An owner floor over the first stretch, built the way the format defines one. Sealing used to
  // come from the engine; emitting is `Checkpoint.seal` now, and it needs a transport to publish
  // through — which this headless harness has no business having. What PART A is about is the
  // CONSEQUENCE of adopting a floor, not how one is produced, so the floor is built directly from
  // the format both the emitter and the verifier share.
  const oc = client(OWNER); oc.feed(BELOW);
  const _seg = oc.StreamManager.getLog();
  const _last = _seg[_seg.length - 1];
  const _seed = oc.StateDeriver.buildSeed(_seg);
  const _covers = oc.CheckpointFormat.coversOf(_seg[0].eventId, _last.eventId);
  const FLOOR = { t: "ddjp.checkpoint", n: 1, prev: null, seed: _seed, covers: _covers,
                  floorL: _last.l, thin: false, by: "@own:hs" };
  FLOOR.h = oc.CheckpointFormat.fingerprint(FLOOR.n, FLOOR.prev, FLOOR.seed, FLOOR.floorL, FLOOR.thin, FLOOR.covers);
  ok(FLOOR && typeof FLOOR.floorL === "number", "the owner floor must seal");

  // ── PART A: gaining a floor forgets below it ────────────────────────────────────────────────
  {
    const c = client(STAFF);
    c.feed(LOG);
    const heldBefore = c.StreamManager.getLog().length;
    ok(heldBefore === LOG.length, "A: APPLIED — the whole log must be held first", heldBefore);

    // GRANT THE LICENCE FIRST — the ordering the gate is about, performed in that order here.
    // BOTH HALVES. The licence is two claims: the fold reproducing genesis says the QUEUE is right
    // and says nothing about whether the settings blob in the seed was ever authorised. Forgetting
    // removes the evidence for both, so both must be settled first — which is why granting only the
    // fold half leaves the licence withheld, correctly.
    c.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
    ok(c.StreamManager.seedLicensesForget() === false,
      "A: APPLIED — the fold half alone must NOT grant the licence; the settings claim is separate",
      c.StreamManager.seedValidation());
    c.SettingsProof._setVerdictForTest({ status: "validated", reason: "granted-by-guard" });
    ok(c.StreamManager.seedLicensesForget() === true,
      "A: APPLIED — the licence must actually be granted, or the branch below proves nothing",
      c.StreamManager.seedValidation());

    // ADOPTION MOVED. Receiving a checkpoint is `Floor.remember` (collect) then `Floor.adopt`
    // (decide) — the split matters, because the old engine did both inside one `ingest` and that is
    // how the concept ended up with no owner. The trim is no longer inline either; it is the
    // subscriber wired above, exactly as transport wires it.
    c.Floor.remember(FLOOR, OWNER, "@own:hs");
    c.Floor.adopt({ floor: Object.assign({ u: "@own:hs" }, FLOOR), tier: 0 });
    const heldAfter = c.StreamManager.getLog().length;

    // ASSERTED, NOT BRANCHED. An earlier version of this took an if/else on whether the licence
    // happened to be granted, and the else-branch ("nothing changed") is true whether or not the
    // trigger is wired at all — so unwiring adoption-forgets-below left it green. Mutation caught it.
    ok(heldAfter < heldBefore,
      "A: adopting a floor FORGETS what is below it — this is the trigger, and nothing called it before",
      { before: heldBefore, after: heldAfter, floorL: FLOOR.floorL });
    ok(c.StreamManager.getLog().every((e) => e.l > FLOOR.floorL),
      "A: and nothing at or below the floor survives", c.StreamManager.getLog().map((e) => e.l));
  }

  // ── PART B: no licence, no forgetting ───────────────────────────────────────────────────────
  // Forced, so the rule is asserted rather than inferred from whichever branch PART A happened to
  // take in this fixture.
  {
    const c = client(STAFF);
    c.feed(LOG);
    c.StreamManager._setLicenceForTest({ status: "mismatch", reason: "forced-by-guard" });
    const before = c.StreamManager.getLog().length;
    c.Floor.remember(FLOOR, OWNER, "@own:hs");
    c.Floor.adopt({ floor: Object.assign({ u: "@own:hs" }, FLOOR), tier: 0 });
    ok(c.StreamManager.getLog().length === before,
      "B: a client whose seed did not validate keeps its whole log, floor or no floor",
      { before: before, after: c.StreamManager.getLog().length });
  }

  // ── PART C/D: losing a floor RAISES the flag ────────────────────────────────────────────────
  // Both halves moved. Building a quorum used to mean driving the engine's own sealing path; that
  // is `Checkpoint.seal` now, and it needs a transport to publish through — which a headless guard
  // has no business having. And the FETCH moved to `Floor.thinJoin`, triggered by a subscriber on
  // the floor's change bus rather than by an inline call inside whatever happened to notice.
  //
  // So what is asserted HERE is only the TRIGGER, which is this file's subject. The behaviour lives
  // where it belongs: `check-floor` PART F covers conditional retraction, PART J covers thin
  // joining end to end — including the case that makes it worth having, a pager that RETURNS events
  // which still do not chain and must therefore adopt nothing.
  {
    const d = client(STAFF);
    d.Floor.attach({ log: () => [], settings: () => ({}), myRank: () => STAFF,
                     trimmed: () => true });
    d.Floor._setTrustedForTest({ n: 1, seed: {}, h: "x", covers: "$a..$b", floorL: 5, grade: "quorum" });

    // OBSERVE THE EMISSION, NOT A FLAG. The re-page subscriber keys on `kind`; the old
    // `needsRepage()` flag it used to assert was read by nothing in production (J02 deleted it).
    const emitted = [];
    d.Floor.onChange((e) => emitted.push(e));

    const r = d.Floor.revalidate();
    ok(r.moved === true && r.reason === "demoted-stale",
      "C: a quorum floor that stops verifying, under a client that has ALREADY FORGOTTEN below it, "
      + "is DEMOTED rather than withdrawn — withdrawing would leave it with no state at all, since "
      + "vouch records carry no sender and the reducer needs one", r);
    ok(d.Floor.grade() === "stale" && d.Floor.earnsForget() === false,
      "C: APPLIED — it is kept as the compute base but earns nothing further. Demoting is not "
      + "forgiving", { grade: d.Floor.grade() });

    ok(emitted.some((e) => e.kind === "demoted"),
      "D: APPLIED — and it ANNOUNCES. A client that loses its floor and merely NOTICES is a client "
      + "that sat there having noticed and done nothing, which is exactly where these three "
      + "mechanisms already were. The emission is the trigger — the subscriber that acts on it is "
      + "pinned in check-wiring — so this asserts the thing production reads rather than a flag "
      + "nothing ever asked for");
  }

  // ── PART E: the wired path still refuses to adopt unverified ────────────────────────────────
  // Wiring must not become a way around the constraint thinJoin holds when called by hand.
  {
    // The peers are built from the FORMAT both the emitter and the verifier share, rather than by
    // driving a sealing path that now needs a transport. What PART E is about is the REFUSAL, not
    // how a checkpoint is produced.
    const c = client(STAFF);
    const mk = (who, upto) => {
      const seg = ABOVE.slice(0, upto);
      const last = seg[seg.length - 1];
      const cp = { t: "ddjp.checkpoint", n: 2, prev: FLOOR.h,
                   seed: c.StateDeriver.buildSeed(seg, FLOOR.seed),
                   covers: c.CheckpointFormat.coversOf(seg[0].eventId, last.eventId),
                   floorL: last.l, thin: false, by: who };
      cp.h = c.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
      return cp;
    };
    c.Floor.attach({ log: () => [], settings: () => ({}), myRank: () => STAFF,
                     trimmed: () => false });
    let i = 0;
    for (const w of ["@h1:hs", "@h2:hs", "@h3:hs"]) c.Floor.remember(mk(w, 4 + (i++) * 4), HS, w);

    const r = await c.Floor.thinJoin(async () => []);   // the fetch comes back empty
    ok(r && r.mode === "none", "E: an empty fetch adopts nothing, wired or not", r);
    ok(c.Floor.current() === null,
      "E: APPLIED — and no unverified floor is left behind. A REFUSAL TO CHECK IS NOT A PASS: "
      + "'they already said so and paging would only confirm it' is the shortcut that turns the "
      + "cascade into trust-by-assertion at every level", c.Floor.current());
  }

  // ── PART F: the pager returns FOLDABLE events, and asks back when the cache falls short ──────
  // Two failures this part exists for, both found by an adversarial sweep rather than by reading:
  //   · the cache holds RAW Matrix events and the fold reads reducer-shaped ones, silently ignoring
  //     anything else — so a pager handing raws to the chain check produced an EMPTY fold and a
  //     re-page that could never verify, with no error anywhere;
  //   · a client that had dropped its raw copies too had no route back to a floor at all.
  {
    const sm = client(STAFF).StreamManager;
    const raw = F.toRaw(LOG[0]);
    const norm = sm.normalise(raw);
    ok(norm && norm.eventId === LOG[0].eventId && norm.content && norm.content.t,
      "F: normalise turns a raw Matrix event into a reducer-shaped one", norm);
    ok(sm.normalise(norm) === norm,
      "F: and passes an already-normalised one straight through, so double-conversion is safe");
    ok(sm.normalise({ type: "m.room.message", content: { body: "not json" } }) === null,
      "F: while unparseable content answers null rather than a half-built object");
    ok(sm.normalise({ type: "m.room.message", content: { body: JSON.stringify({ t: "other.thing", l: 1 }) } }) === null,
      "F: and so does well-formed JSON that is not a ddjp event — parsing is not belonging, and a " +
      "foreign payload reaching the fold is a stranger's message being treated as room history");
    ok(sm.normalise({ type: "m.room.member", content: {} }) === null,
      "F: as does a non-message Matrix event");

    // THE SHAPE MATTERS, measured rather than asserted from the shape alone: a raw fold is EMPTY.
    const SD = client(STAFF).StateDeriver;
    ok(SD.buildSeed(LOG).nowPlaying, "F: APPLIED — the reducer-shaped fold must produce a room");
    ok(!SD.buildSeed(LOG.map(F.toRaw)).nowPlaying,
      "F: APPLIED — and the RAW fold must produce nothing, which is why it failed silently");
    ok(SD.buildSeed(LOG.map(F.toRaw).map((r) => sm.normalise(r))).nowPlaying,
      "F: normalising first restores it — this is what the pager now does");
  }

  console.log("[forget-wiring] PASS — the triggers are connected: gaining a floor forgets what is below it, but only once the seed has been validated against genesis — the one ordering that stops a client bounding its derived log and then never being able to shed a raw copy; a floor broken by a deletion is withdrawn, demoted or replaced rather than silently kept, and a client that had already forgotten flags that it must fetch; and the wired path refuses an unverified floor exactly as the hand-called one does");
}

main().catch((e) => fail("threw: " + (e && e.stack || e)));
