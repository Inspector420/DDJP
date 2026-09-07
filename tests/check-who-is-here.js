// tests/check-who-is-here.js
// WALL: A LIST THAT CANNOT CLAIM MORE THAN IT LOOKED AT.
//
// J16 asks for a people list built from activity, and its Done-when is a wording requirement:
// "the list is honestly labelled ... the UI must not imply more than that". A wording requirement
// is the hardest kind to guard, because the failure is a sentence that is true of nothing and
// reads as fact — `roles.md` §10's second signature. So nothing here asserts that a string is
// SPELLED anywhere. Every claim the panel makes is either derived from a number this file drives,
// or is a statement about behaviour that this file executes the production path to check.
//
// THE JOB ENTRY IS WRONG TWICE AND BOTH ARE PINNED HERE.
//   · It declares a dependency on J20 (the bot). The Done-when asks only that the list mean "who
//     has done something recently", and PART C computes exactly that from `StreamManager.getLog()`
//     through the interface the app already has — no bot, no new event type, no new module.
//   · It names chatting, saving, voting and the queue as activity. Chat is Skin: `_routeEvent`
//     skips chat-named rooms BEFORE both `EventCache.store` and `StreamManager.ingest`, so chat
//     cannot reach the log this list is folded from. THREE of four, and PART F drives the real
//     router to prove it rather than restating the comment beside it.
//
// WHAT EACH PART PINS:
//   PART A — the fold's arithmetic, at explicit server stamps, with the admitted sibling beside
//     every exclusion (a refusal is evidence only if something adjacent was admitted).
//   PART B — the log's REACH bounds the window, measured from the log rather than assumed, with a
//     control where the reach is ample and the requested window survives intact.
//   PART C — the live path: real events through the one door, then `Room.recentlyActive`.
//   PART D — a TRIM narrows the list and the claim in the SAME step. This is the "what happens to
//     a name whose events fall below the floor" question, and the answer is that it needs no
//     second rule: the trim raises the log's oldest stamp, which shrinks the reach, which bounds
//     the window. One mechanism, both cases.
//   PART E — the panel renders what the feature hands it and decides nothing: no filtering, no
//     recency arithmetic, no reordering, and the clock it measures against is ServerClock's (P2).
//   PART F — the label's stated span is the EFFECTIVE window, never the requested one; the reach
//     note appears only when bounded and names BOTH numbers; and the sources sentence is TRUE,
//     driven through the real `_routeEvent` in both directions.
//   PART G — the number is a per-device DISPLAY PREFERENCE and reaches no backend module. This is
//     the part that pins the job's KIND: a room setting would be a new key in `defaultSettings()`,
//     and `seed.settings` is a whole-blob copy the checkpoint fingerprint commits, so one key
//     moves every checkpoint in every room (`09-roadmap.md` J45). Driven here with the control.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");
const P = require("./_probe-j16-active");

let asserts = 0;
function fail(msg, got) {
  console.log("[who-is-here] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");
const MIN = 60000;

// ── THE SOURCES ARE NOW AN EXPLICIT ARGUMENT, AND THAT IS THE POINT ─────────────────────────
// `foldActivity` took only a window, so WHAT COUNTS was not expressible and the panel's answer
// silently diverged from the room's. Every fixture below states the rule it is driving, because a
// fold called with no sources counts NOTHING (fail closed) — and a fixture that omitted them would
// be asserting over the empty case while claiming to assert over a full one.
const SPINE = { spine: true, chat: false };
// ── THE TWO NEW FOLD ARGUMENTS, FOR THE TESTS THAT ARE NOT ABOUT THEM (v322) ────────────────
// Most assertions here are about WINDOW ARITHMETIC — reach, boundedness, clock skew — and none of
// them care which kind of act somebody did. They pass a permissive groups map and a classifier
// that answers one group, so the arithmetic is tested at full admission and the classification
// is tested where it belongs (PART F below, and check-setting-endpoints PART H).
//
// PERMISSIVE HERE IS NOT THE PRODUCTION DEFAULT: the fold FAILS CLOSED when either argument is
// absent, which is what the bare-call assertions at the bottom of this file drive. Supplying them
// here is the fixture stating a rule, exactly as it already states `SPINE`.
const ALL_GROUPS = { rotation: true, moderation: true, skip: true, vote: true, save: true, settings: true };
const GROUP_OF = (t) => (typeof t === "string" && t.indexOf("ddjp.") === 0) ? "rotation" : null;

// ── AND THE LIVE READER IS DRIVEN TOO, WHICH IT WAS NOT ────────────────────────────────────
// Six mutation rows survived on the first pass because every fixture here drove the PURE fold with
// sources handed in explicitly. That proves the arithmetic and says nothing about where the rule
// comes from — the whole subject of this change. `recentlyActive` is the only place the room's
// definition is read, and nothing was reading it.
// ── THE FIXTURE'S ACTS ARE `ddjp.dj.join`, AND THEY USED TO BE `ddjp.dj.play` (v322) ─────────
// That was not an arbitrary pick and the change is not cosmetic. `ddjp.dj.play` is authored by the
// DJ's CLIENT when a song ends — nobody touches anything — so a fixture built on it was asserting
// that an auto-advance means somebody is around. It did, until v322: the panel counted the room
// playing music as evidence its listeners were present, and a person who queued five songs and
// left looked active until their buffer emptied. `ddjp.dj.join` is a person joining the queue,
// which is what the assertions below actually mean by "did something".
function SDefaults() {
  return loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON }).StateDeriver.defaultSettings();
}
function liveRoom(settings, log) {
  // MERGED ONTO THE REDUCER'S OWN DEFAULTS (v322), not passed through raw. A hand-built settings
  // object is a state no real room can be in: `applySettingsEvent` merges every event onto
  // `defaultSettings()`, so a live client's blob always carries EVERY key. Passing a partial one
  // here made the fixture exercise a shape production cannot produce — and when `activityPresence`
  // landed, thirteen guards went red against a fold that was behaving correctly for the blob it
  // was actually handed. The fixture was wrong, not the fold.
  // FILLED IN PLACE, never replaced. `Object.assign(SDefaults(), settings)` returns a NEW object,
  // and one test below mutates the object it handed in to drive "the owner changed the rule
  // between two reads" — which silently stopped working, because the room was closed over a copy.
  // Filling gaps on the caller's own object keeps that identity.
  //
  // `in` RATHER THAN A TRUTHINESS TEST, so a key written as an explicit `undefined` counts as
  // PRESENT and is left alone. That is how the fail-closed tests state "this room has no readable
  // window" now that omission means "default".
  settings = settings || {};
  {
    const _d = SDefaults();
    for (const k in _d) { if (!(k in settings)) settings[k] = _d[k]; }
  }
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      getLog: () => log,
      getState: () => ({ settings: settings }),
      isLegal: (id) => id !== "$refused",
      on() {},
    },
    MatrixBridge: { getUserId: () => "@me:hs", getMyRank: () => 0, getRoster: () => [] },
  });
  return sb.Room;
}

// A client with the REAL StreamManager and the REAL Room fold. Room is loaded so the production
// reader is the one under test — a harness copy of `foldActivity` would be a second definition of
// the rule and free to disagree with the one that ships.
// ── THE WINDOW IS ROOM TRUTH NOW, SO A FIXTURE THAT WANTS ONE MUST SET IT AS THE ROOM DOES ──
// `recentlyActive` no longer takes a window — there is no parameter for a caller to disagree
// through, which is the whole point of v272. So a fixture wanting a 60-minute window ingests a
// real `ddjp.room.settings` event from the owner channel, which is the only way a room's window
// changes. That is not extra ceremony: it drives the path the panel actually depends on, where
// passing a number as an argument never did.
function setWindow(c, ms, l, ts) {
  c.StreamManager.ingest(F.rawEvent("$win" + ms, l, ts, "@own:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: { botAfkMs: ms } }));
  return c.StreamManager.getState().settings.botAfkMs;
}

function client(rank) {
  const sb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js", "core/playlistdoc.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/settingsproof.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js",
    // CAPABILITIES IS A REAL DEPENDENCY OF room.js AND WAS MISSING (v322). `setSettings` has
    // called `Capabilities.atLeast` since long before this change; the tree simply never exercised
    // that path, so its absence cost nothing until `recentlyActive` began reading the activity
    // classification through the same seam. A fixture that loads a module without its dependencies
    // is testing a tree the page cannot produce — the same thing the settings merge above fixes
    // one layer up.
    "backends/backend1/capabilities.js",
    "features/room.js",
  ], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
  });
  sb.feed = (evs) => { for (const e of evs) sb.StreamManager.ingest(F.toRaw(e)); };
  // The trim trigger, wired exactly as transport wires it: Floor only EMITS, and an emission
  // nobody listens to is the flag-nobody-reads failure it replaced.
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

const C0 = client(F.RANK.staff);
const Room = C0.Room;
ok(typeof Room.foldActivity === "function" && typeof Room.recentlyActive === "function",
  "the feature layer must expose the fold and its live reader — without both, nothing below has a subject");

const names = (f) => f.people.map((p) => p.userId);

// ═══ PART A — the fold's arithmetic, at explicit stamps ══════════════════════════════════════
// Every time here is a SERVER stamp and the fold reads no clock of its own, which is what lets
// this part drive it at exact values. Ten minutes of room, three senders.
{
  const T = 10000000;                       // "now", in server time
  const log = [
    { sender: "@a:hs", ts: T - 1 * MIN, type: "ddjp.dj.join" },    // well inside any window below
    { sender: "@a:hs", ts: T - 9 * MIN, type: "ddjp.dj.join" },    // an older act by the same person
    { sender: "@b:hs", ts: T - 4 * MIN, type: "ddjp.dj.join" },
    { sender: "@old:hs", ts: T - 30 * MIN, type: "ddjp.dj.join" }, // outside a 5-minute window, inside a 60-minute one
  ];

  const w5 = Room.foldActivity(log, T, 5 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF);
  // THE CONTROL FIRST. An exclusion proves nothing if the fixture never admitted anybody — a fold
  // that reached nothing returns an empty list, which is what a correct window also returns.
  ok(names(w5).indexOf("@a:hs") >= 0 && names(w5).indexOf("@b:hs") >= 0,
    "A control: two people inside a 5-minute window must be ADMITTED, or the exclusion below is free",
    names(w5));
  ok(names(w5).indexOf("@old:hs") < 0,
    "A: somebody whose last act is 30 minutes old is not active in a 5-minute window", names(w5));

  // The same fixture, one detail changed — the window. The person excluded above must now appear.
  const w60 = Room.foldActivity(log, T, 60 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF);
  ok(names(w60).indexOf("@old:hs") >= 0,
    "A: and the SAME person IS active in a 60-minute window, so the exclusion above was the window " +
    "doing its job rather than the fixture failing to reach them", names(w60));

  // LAST activity, not first: @a:hs acted at T-9min and again at T-1min.
  const a = w60.people.find((p) => p.userId === "@a:hs");
  ok(a && a.lastTs === T - 1 * MIN,
    "A: a person's stamp is their LATEST act, not their earliest — otherwise somebody who has just " +
    "spoken drops off the list because they also spoke an hour ago", a);
  ok(a && a.acts === 2, "A: and every act of theirs is counted", a);

  // Newest first. The panel renders in the order it is handed, so the order is the fold's claim.
  ok(names(w60)[0] === "@a:hs" && names(w60)[names(w60).length - 1] === "@old:hs",
    "A: the list is ordered by last activity, newest first", names(w60));

  // An entry with no sender or no server stamp says nothing about who did what when. It must not
  // become a nameless row, and it must not contribute a stamp to the reach.
  const dirty = Room.foldActivity(
    [{ sender: null, ts: T, type: "ddjp.dj.join" }, { sender: "@c:hs", ts: 0, type: "ddjp.dj.join" },
     { sender: "@c:hs", type: "ddjp.dj.join" }, { sender: "@d:hs", ts: T, type: "ddjp.dj.join" }],
    T, 60 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF);
  ok(names(dirty).length === 1 && names(dirty)[0] === "@d:hs",
    "A: an entry with no sender or no server stamp contributes nobody", names(dirty));
}

// ═══ PART B — the reach bounds the window, and it is MEASURED ════════════════════════════════
// The window is what the person asked for; the reach is what this client actually holds. A fold
// that answered the requested window over a shorter log would report "these two people" having
// looked at less than it claims — the plausible-value signature.
{
  const T = 10000000;
  const young = [{ sender: "@a:hs", ts: T - 3 * MIN, type: "ddjp.dj.join" },
                 { sender: "@b:hs", ts: T - 1 * MIN, type: "ddjp.dj.join" }];

  const f = Room.foldActivity(young, T, 60 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF);
  ok(f.reach === 3 * MIN,
    "B: the reach is measured from NOW back to the oldest stamp held, not from the newest event " +
    "— a quiet room can still see further back than its last event", f.reach);
  ok(f.bounded === true,
    "B: a 60-minute window over a log reaching 3 minutes is BOUNDED, and the fold says so rather " +
    "than answering as though it had looked", f);
  ok(f.effectiveWindowMs === 3 * MIN,
    "B: the effective window is the smaller of the two", f.effectiveWindowMs);
  ok(names(f).length === 2,
    "B control: everybody in the held log still shows — narrowing the CLAIM must not narrow the " +
    "LIST, or a young room would look empty", names(f));

  // The control: an ample log, where the requested window survives intact. Without this, `bounded`
  // could be hardwired true and every assertion above would still pass.
  const old = [{ sender: "@a:hs", ts: T - 90 * MIN, type: "ddjp.dj.join" },
               { sender: "@b:hs", ts: T - 1 * MIN, type: "ddjp.dj.join" }];
  const g = Room.foldActivity(old, T, 60 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF);
  ok(g.bounded === false && g.effectiveWindowMs === 60 * MIN,
    "B control: over a log reaching 90 minutes, a 60-minute window is NOT bounded and survives " +
    "intact — so `bounded` is a reading of the log rather than a constant", g);
  ok(names(g).indexOf("@a:hs") < 0,
    "B control: and the person outside it is excluded, so the window is still doing work", names(g));

  // A stamp from the future (clock skew) must shrink the claim, never widen it.
  const skew = Room.foldActivity([{ sender: "@a:hs", ts: T + 5 * MIN, type: "ddjp.dj.join" }], T, 60 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF);
  ok(skew.reach === 0 && skew.bounded === true,
    "B: a stamp ahead of now floors the reach at zero — skew narrows what the panel claims " +
    "rather than widening it", skew);
}

// ═══ PART C — the live path: real events through the one door ════════════════════════════════
// PART A drove the fold directly, which is a guard on the MODULE. This drives the production
// reader, which reads the log the transport actually fills.
let LIVE_T = 0, LIVE_LOG = null;
{
  const c = client(F.RANK.staff);
  const room = F.playingRoom({ songs: 1 });
  c.feed(F.sortLog(room.log));
  const headL = room.lastL;
  const t = room.startTs + 400000;
  // Three events across two senders — a queue act, a vote and a save. Three of the four sources
  // J16's entry names; the fourth is PART F.
  c.feed([
    // A BARE `ddjp.dj.join` — THE DELIBERATE QUEUE ACT THE WIRE ACTUALLY PRODUCES. This fixture
    // used `{ t: "ddjp.dj.declare", v: "SONG9" }`, and **nothing in the tree emits that type**:
    // `Queue.submitSong` sends `ddjp.dj.join` WITH a `v`, and a person joining sends it with an
    // empty body. So this part was driven by a shape its caller cannot make, and stayed green
    // because the classifier happened to accept the invented type.
    //
    // It matters now because a join carrying `v` is buffer housekeeping and counts for NOTHING —
    // a client topping up from a playlist must not keep somebody "here".
    //
    // A SAVE, NOT A JOIN OR A SKIP. This DJ is ALREADY IN THE ROTATION here, so the reducer
    // refuses a second join, and it refuses this DJ's skip too — `isLegal` answers false for both
    // and a refused act is not evidence its sender was here. Each was tried and driven rather than
    // reasoned about; a save on the playing song is a deliberate act this sender can legally take
    // at this point, which is what the part needs.
    F.reducerEvent("$act1", headL + 1, t,          room.dj,     F.RANK.player, { t: "ddjp.dj.save", p: room.pi(0) }),
    F.reducerEvent("$act2", headL + 2, t + 1000,   "@voter:hs", F.RANK.vip,    { t: "ddjp.dj.vote", p: room.pi(0) }),
    F.reducerEvent("$act3", headL + 3, t + 2000,   "@voter:hs", F.RANK.vip,    { t: "ddjp.dj.save", p: room.pi(0) }),
  ]);
  LIVE_LOG = c.StreamManager.getLog();
  ok(LIVE_LOG.length > 0, "C: APPLIED — the log must hold the events that were ingested, or the " +
    "reader below is folding nothing", LIVE_LOG.length);
  ok(LIVE_LOG.some((e) => e.eventId === "$act2"),
    "C: APPLIED — the vote must have reached the log through the door", LIVE_LOG.map((e) => e.eventId));

  LIVE_T = t + 3000;
  const f = c.Room.recentlyActive(LIVE_T);
  ok(names(f).indexOf(room.dj) >= 0 && names(f).indexOf("@voter:hs") >= 0,
    "C: the live reader names both senders — the list is computable from the log TODAY, with no " +
    "bot, no new event type and no new module", names(f));
  ok(f.people.find((p) => p.userId === "@voter:hs").lastTs === t + 2000,
    "C: at the SERVER stamp the transport put on the event, never a local one (P2)", f.people);

  // A queue act, a vote and a save all reach it — the three sources, each shown to arrive.
  // DISTINCT kinds. The list was three entries and matched a three-name string; with the DJ's act
  // now a save there are two saves and a vote, and the question the assertion asks — "each source
  // kind arrived, none standing in for another" — is about the SET.
  const kinds = LIVE_LOG.filter((e) => /^\$act/.test(e.eventId)).map((e) => e.type)
    .filter((t, i, a) => a.indexOf(t) === i).sort();
  // WAS `ddjp.dj.declare` — a type nothing emits. Now the DJ's act is a save, so the three kinds
  // are two saves and a vote; the assertion is on the DISTINCT SET, which is what "three source
  // kinds" was reaching for and what survives the fixture using shapes the wire can produce.
  ok(kinds.join(",") === "ddjp.dj.save,ddjp.dj.vote",
    "C: and each source kind is in the log rather than one standing in for the others", kinds);
}

// ═══ PART D — a trim narrows the list and the claim in ONE step ══════════════════════════════
// The question J16 has to answer about forgetting: what happens to a name whose events fall below
// the floor. They go, because the evidence is gone — and the panel must stop claiming to have
// looked that far back at the same moment, or it reports a shorter list under an unchanged claim.
{
  const OWNER = F.RANK.owner;
  const room = F.playingRoom({ songs: 8 });
  const LOG = room.log;
  const CUT = 8;

  // An EARLY sender, comfortably below the cut but not at the very edge of the log, and the rest
  // of the room above it.
  const early = F.reducerEvent("$early", LOG[4].l, room.startTs + room.gapMs + 100, "@early:hs",
    F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) });
  const full = F.sortLog(LOG.slice(0, CUT).concat([early]).concat(LOG.slice(CUT)));

  const c = client(F.RANK.staff);
  c.feed(full);
  const T = room.startTs + 8 * room.gapMs + 60000;

  // THE WINDOW IS DERIVED FROM THE MEASURED REACH, not written down. A hardcoded span would go
  // quietly green the day the fixture's timings changed — it would simply be bounded in both
  // readings, and "bounded before and after" is exactly what a broken trim also looks like.
  //
  // AND IT IS NOW SET AS THE ROOM SETS IT (v272). The reach is measured first with whatever the
  // room currently says, then the derived span is written back through a real settings event —
  // because there is no longer an argument to pass one through, and inventing a second route for
  // the fixture would be inventing exactly the second source this change removed.
  const reachNow = c.Room.recentlyActive(T).reach;
  const WINDOW = reachNow - 1000;
  const applied = setWindow(c, WINDOW, LOG[LOG.length - 1].l + 1, T - 1000);
  ok(applied === WINDOW,
    "D: APPLIED — the room must have accepted the derived window, or both readings below are " +
    "taken at a span nobody set", { want: WINDOW, got: applied });
  ok(WINDOW > 0, "D: APPLIED — the fixture must span enough time to choose a window inside", reachNow);

  const before = c.Room.recentlyActive(T);
  ok(names(before).indexOf("@early:hs") >= 0,
    "D control: the early sender must be in the list BEFORE the trim, or its disappearance below " +
    "proves nothing", names(before));
  ok(before.bounded === false,
    "D control: and with a window just inside the log's reach, the claim starts UNbounded — so the " +
    "flip below is the trim's doing rather than the fixture's", before);

  // Build an owner floor over the stretch that contains the early sender, then adopt it through
  // the real path. The licence is granted first, which is the ordering the gate is about.
  const oc = client(OWNER);
  oc.feed(full.filter((e) => e.l <= LOG[CUT - 1].l));
  const seg = oc.StreamManager.getLog();
  const last = seg[seg.length - 1];
  const seed = oc.StateDeriver.buildSeed(seg);
  const covers = oc.CheckpointFormat.coversOf(seg[0].eventId, last.eventId);
  const FLOOR = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, covers: covers,
                  floorL: last.l, thin: false, by: "@own:hs" };
  FLOOR.h = oc.CheckpointFormat.fingerprint(FLOOR.n, FLOOR.prev, FLOOR.seed, FLOOR.floorL, FLOOR.thin, FLOOR.covers);

  c.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  c.SettingsProof._setVerdictForTest({ status: "validated", reason: "granted-by-guard" });
  ok(c.StreamManager.seedLicensesForget() === true,
    "D: APPLIED — the forget licence must actually be granted, or nothing is trimmed and this part " +
    "measures an untrimmed room", c.StreamManager.seedValidation());

  const heldBefore = c.StreamManager.getLog().length;
  c.Floor.remember(FLOOR, OWNER, "@own:hs");
  c.Floor.adopt({ floor: Object.assign({ u: "@own:hs" }, FLOOR), tier: 0 });
  const heldAfter = c.StreamManager.getLog().length;
  ok(heldAfter < heldBefore,
    "D: APPLIED — the trim must have happened, or the two readings below are the same reading",
    { before: heldBefore, after: heldAfter, floorL: FLOOR.floorL });

  const after = c.Room.recentlyActive(T);
  ok(names(after).indexOf("@early:hs") < 0,
    "D: a name whose every event fell below the floor is GONE from the list — the fold holds no " +
    "side-table of last-seen stamps, because one would go on naming somebody whose evidence this " +
    "client destroyed", names(after));
  ok(after.bounded === true,
    "D: AND THE CLAIM NARROWS IN THE SAME STEP. This is the whole point of the part: a shorter " +
    "list under an unchanged label is a lie the panel tells for free. The trim raises the oldest " +
    "stamp held, which shrinks the reach, which bounds the window — one mechanism, no second rule",
    after);
  ok(after.reach < before.reach,
    "D: and the reach is what moved, measured rather than declared", { before: before.reach, after: after.reach });
  ok(names(after).length > 0,
    "D control: somebody must still be in the list after the trim, or `bounded` above could be true " +
    "because the fold broke rather than because the log got shorter", names(after));
}

// ═══ PART E — the panel renders what it is told and decides nothing ══════════════════════════
// EXTRACTED FROM `ui/interface.js` AND EXECUTED — the fifth guard in the tree to run that file
// rather than read it. Nine guards read it as text, and a regex proving a name is spelled there
// proves nothing about whether it runs.
{
  const T = 10000000;
  // A fold whose people are deliberately NOT what a recency filter would produce: one of them is
  // outside the stated window and the order is not newest-first. The panel must render exactly
  // these, in exactly this order — if it re-sorts or re-filters, it holds a second copy of a rule
  // that lives in the feature layer (P7).
  const fold = {
    people: [
      { userId: "@second:hs", lastTs: T - 2 * MIN, acts: 3 },
      { userId: "@first:hs", lastTs: T - 1 * MIN, acts: 1 },
      { userId: "@ancient:hs", lastTs: T - 999 * MIN, acts: 7 },
    ],
    since: T - 5 * MIN, reach: 90 * MIN, oldestTs: T - 90 * MIN, newestTs: T - MIN,
    counted: 11, requestedWindowMs: 5 * MIN, effectiveWindowMs: 5 * MIN, bounded: false,
  };
  const r = P.gate("panel", P.drivePanel({ fold, serverNow: T, windowMs: 5 * MIN }),
    { expectAsked: true, expectRendered: true }, "PART E");

  ok(r.rendered.length === 3,
    "E: the panel paints every person the fold returned — including one outside the stated window, " +
    "because deciding that is the fold's job and not the panel's", r.rendered);
  ok(r.rendered[0] === "second" && r.rendered[2] === "ancient",
    "E: in the fold's order, unre-sorted — a panel that re-sorted would hold a second copy of a " +
    "rule that lives in the feature layer (P7)", r.rendered);
  ok(r.acts.join(",") === "3 actions,1 action,7 actions",
    "E: with each person's own count, singular where it should be", r.acts);

  // THE CLOCK. P2: every stamp in the log is the homeserver's, so the reference has to be one too.
  ok(r.asked.length === 1 && r.asked[0].now === T,
    "E: the panel measures against ServerClock's stamp, never Date.now() — mixing a device clock " +
    "with a server stamp produces a plausible, meaningless number (P2)", r.asked);
  // ── THE PANEL SUPPLIES NO WINDOW AT ALL (v272) ──────────────────────────────────────────
  // This asserted that the panel passed a PER-DEVICE window down. That is the behaviour this
  // change removed: the People panel is the surface showing the basis for a bot removing somebody,
  // so a window the panel could choose is a window that can say a person is present while the bot
  // is about to remove them. The assertion is INVERTED rather than deleted — the panel must now
  // pass nothing, so a future edit that reintroduces an argument fails here.
  ok(r.asked[0].win === undefined,
    "E: AND IT SUPPLIES NO WINDOW. `recentlyActive` reads the room's rule — window and sources " +
    "both — so there is no parameter for this panel to disagree through, and a panel that passed " +
    "one would be choosing a rule the bot does not act on", r.asked);

  // Every rendered name is a card trigger, through the ONE helper every surface uses (J14).
  ok(r.carded.length === 3,
    "E: every name is wired to the one card trigger, so the affordance cannot be right in four " +
    "surfaces and forgotten in the fifth", r.carded);

  // A feature layer that throws must not take the panel down with it.
  const boom = P.drivePanel({ fold, serverNow: T, windowMs: 5 * MIN, throwFromRoom: true });
  ok(boom.ok === true,
    "E: a throwing reader leaves the panel standing rather than breaking the whole people pane", boom.stage);
}

// ═══ PART F — the label is honest, and the sentence about chat is TRUE ═══════════════════════
{
  const T = 10000000;

  // The base fold the label rows vary from. `sources` and `unobservable` are part of it now,
  // because a fold without them is a fold from before the room had a say.
  const LAB_FOLD = {
    people: [{ userId: "@a:hs", lastTs: T, acts: 1 }],
    requestedWindowMs: 60 * MIN, effectiveWindowMs: 60 * MIN, reach: 90 * MIN, bounded: false,
    sources: { spine: true, chat: false }, unobservable: [],
  };

  // F1 — the stated span is the EFFECTIVE window, not the requested one.
  const unbounded = P.gate("label", P.driveLabel(LAB_FOLD), {}, "PART F1").label;
  ok(/1 hour/.test(unbounded.window) && !unbounded.reachNote,
    "F: with reach to spare, the panel states the window it was asked for and adds no caveat",
    unbounded);

  const bounded = P.gate("label", P.driveLabel({
    people: [{ userId: "@a:hs", lastTs: T, acts: 1 }],
    requestedWindowMs: 60 * MIN, effectiveWindowMs: 4 * MIN, reach: 4 * MIN, bounded: true,
  }), {}, "PART F2").label;
  ok(/4 minutes/.test(bounded.window) && !/1 hour/.test(bounded.window),
    "F: WHEN THE LOG IS SHORTER, THE STATED SPAN IS THE ONE ACTUALLY LOOKED AT. This is the line " +
    "the whole job turns on: with the requested window here, a freshly-loaded or freshly-trimmed " +
    "room says `in the last hour` over a log holding four minutes, which is true of nothing and " +
    "reads as fact", bounded.window);
  ok(bounded.reachNote && /1 hour/.test(bounded.reachNote) && /4 minutes/.test(bounded.reachNote),
    "F: and the caveat names BOTH numbers — what you asked for and what there was to look at, " +
    "because the discrepancy is the information", bounded.reachNote);

  // F3 — the count wording, and the empty case, which must not read as "nobody is here".
  const empty = P.gate("label", P.driveLabel({
    people: [], requestedWindowMs: 5 * MIN, effectiveWindowMs: 5 * MIN, reach: 90 * MIN, bounded: false,
  }), {}, "PART F3").label;
  ok(/Nobody has done anything/.test(empty.window) && !/here/.test(empty.window),
    "F: an empty list says nobody has DONE anything, never that nobody is here — this system has " +
    "no presence protocol and the label must not imply one", empty.window);

  // ── F4 — THE PANEL STATES WHICH DEFINITION PRODUCED THE LIST ─────────────────────────────
  // This asserted a fixed sentence naming chat as not counted. That sentence was true and it was
  // the WRONG CLAIM: it presented a permanent property of the log as the whole story, while the
  // ROOM has its own definition of being around (`botPresenceSpine` / `botPresenceChat`) that the
  // panel was not reading. Two answers to one question — found in a browser, not in review.
  // The room now decides WHAT counts and the device decides HOW FAR BACK it looks, and the panel
  // says which rule it applied.
  ok(/as this room defines/.test(unbounded.sources),
    "F: the panel names the ROOM's definition as the source of the rule, rather than presenting " +
    "one definition as if it were the only one", unbounded.sources);
  ok(/refused are not counted/.test(unbounded.sources),
    "F: and it states that refused actions do not count — the third divergence, which made a " +
    "person 'active' on the strength of an act the room threw away", unbounded.sources);

  // ── F5 — WHERE THE PANEL CANNOT HONOUR THE ROOM'S RULE, IT SAYS SO ───────────────────────
  // `botPresenceChat` is not a filter the fold is missing: chat never reaches the log and cannot,
  // so a room counting chat has a definition of active this panel cannot compute. The list is then
  // a SUBSET, and implying agreement is the accident this whole change exists to avoid.
  {
    const withChat = P.gate("label", P.driveLabel(Object.assign({}, LAB_FOLD,
      { sources: { spine: true, chat: true }, unobservable: ["chat"] })), {}, "PART F chat");
    ok(/cannot see chat/.test(withChat.label.unobservable),
      "F: a room that ALSO counts chat gets a sentence saying this list cannot see it", 
      withChat.label.unobservable);
    ok(/fewer people/.test(withChat.label.unobservable),
      "F: naming the DIRECTION of the difference — a person comparing this with a bot needs to " +
      "know which way it is wrong before concluding one of them is broken",
      withChat.label.unobservable);
    ok(!/fault/.test(withChat.label.unobservable) === false,
      "F: and saying the difference is not a fault in either, because it is a consequence of " +
      "where chat lives rather than of a mistake", withChat.label.unobservable);
    const noChat = P.gate("label", P.driveLabel(Object.assign({}, LAB_FOLD,
      { sources: { spine: true, chat: false }, unobservable: [] })), {}, "PART F nochat");
    ok(noChat.label.unobservable === "",
      "F control: a room NOT counting chat gets no such sentence — so the warning is a reading of " +
      "the room's rule rather than a permanent caption", noChat.label.unobservable);
    // AND IT IS RENDERED, not merely computed. PART F drives the LABEL; M7 deletes the line that
    // PAINTS it, and a label-only assertion cannot see that — the same gap between a value and its
    // rendering that `check-event-feed` had to close.
    const painted = P.gate("panel", P.drivePanel({
      fold: Object.assign({}, LAB_FOLD, { sources: { spine: true, chat: true },
                                          unobservable: ["chat"] }),
      serverNow: T, windowMs: 60 * MIN }), { expectRendered: true }, "PART F paint");
    ok(/cannot see chat/.test(painted.all),
      "F: and the panel PAINTS the sentence, rather than computing it and dropping it — a person " +
      "reading the list is the only reason it exists", painted.all.slice(0, 200));
    const notPainted = P.gate("panel", P.drivePanel({
      fold: Object.assign({}, LAB_FOLD, { sources: { spine: true, chat: false }, unobservable: [] }),
      serverNow: T, windowMs: 60 * MIN }), { expectRendered: true }, "PART F nopaint");
    ok(!/cannot see chat/.test(notPainted.all),
      "F control: and does not paint it when the room is not counting chat", notPainted.all.slice(0, 120));

    const noSpine = P.gate("label", P.driveLabel(Object.assign({}, LAB_FOLD,
      { sources: { spine: false, chat: false }, unobservable: [] })), {}, "PART F nospine");
    ok(/not counting queue activity/.test(noSpine.label.sources),
      "F: and a room counting NOTHING says so, rather than showing an empty list that reads as " +
      "'nobody is here'", noSpine.label.sources);
  }

  // F5 — AND THAT SENTENCE IS TRUE, DRIVEN THROUGH THE REAL ROUTER RATHER THAN READ.
  // `paths.md` §9 entry 13: break the condition you named, not the code you were looking at.
  // The router is `_probe-j15-dm.js`'s extractor, so there is one definition of "which rooms are
  // ours" in the suite rather than two.
  {
    const mb = loadInContext([
      "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js",
      "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
      "backends/backend1/matrixbridge.js",
    ], {
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
      window: {}, document: { body: { appendChild() {} } },
    });
    const SCOPE = ["!ev-owner:hs", "!chat-unc:hs"];
    const body = JSON.stringify({ t: "ddjp.dj.join", l: 9, v: "SONG0" });
    const route = (room) => P.J15.driveRoute({
      room, body, scope: SCOPE, dmScope: [],
      isSpineChannel: mb.MatrixBridge._isSpineChannel,
      isChatChannel: mb.MatrixBridge._isChatChannel,
    });

    // THE CONTROL FIRST. If the admitted case cannot be admitted, the refusal is free.
    const spine = route({ roomId: "!ev-owner:hs", name: "events-owner" });
    ok(spine.ok && spine.spined,
      "F control: the same body on an in-scope events channel DOES reach the ingest door — " +
      "without this the refusal below would be a broken harness", spine.stage || spine.names);

    const chat = route({ roomId: "!chat-unc:hs", name: "chat-uncategorized" });
    ok(chat.ok, "F: APPLIED — the router must have run for the chat room", chat.stage);
    ok(chat.folded === false && chat.stored === false,
      "F: A CHAT-CHANNEL EVENT REACHES NEITHER THE FOLD NOR THE STORE, whatever its body says. " +
      "So chat cannot reach the log this list is folded from, and the panel's sentence is a " +
      "statement about behaviour rather than a claim nobody re-reads", chat.names);
    ok(chat.fannedOut === true,
      "F: it reaches the raw listeners and nothing else — which is why chat renders while being " +
      "invisible here, and why this is a limit to state rather than a gap to close", chat.names);

    // And the consequence at the list: a person who has only chatted is not in it.
    const c = client(F.RANK.staff);
    const room = F.playingRoom({ songs: 1 });
    c.feed(F.sortLog(room.log));
    const T2 = room.startTs + 1000;
    const f = c.Room.recentlyActive(T2);
    ok(names(f).indexOf("@chatter:hs") < 0,
      "F: and a person whose only act was a chat message is absent from the list — three sources " +
      "reach it, not the four the job entry names", names(f));
    ok(names(f).length > 0,
      "F control: while somebody who acted on the Spine IS in it, so the absence above is chat " +
      "being unreachable rather than the reader being broken", names(f));
  }
}

// ═══ PART G — the number is a display preference, and reaches no backend ═════════════════════
// THIS IS THE PART THAT PINS THE JOB'S KIND. J16 is `ui`. It would be `derivation` — and on the
// Phase 6 gate — the moment the window became a room setting, because `seed.settings` is a
// whole-blob copy that the checkpoint fingerprint commits.
{
  const cp = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js",
                            "core/chatprefs.js"], {
    localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
                    setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
    Date, Math, JSON, indexedDB: undefined,
  });
  const CP = cp.ChatPrefs;
  CP.load();

  // ── THE WINDOW IS ROOM TRUTH, AND IT COST NO NEW SETTINGS KEY (v272) ─────────────────────
  // This part used to pin a device-local `ACTIVITY_WINDOW` range with its clamps, under a heading
  // saying J16 would become `derivation` "the moment the window became a room setting, because
  // `seed.settings` is a whole-blob copy that the checkpoint fingerprint commits".
  //
  // **THE WINDOW DID BECOME A ROOM SETTING, AND THE KIND DID NOT CHANGE** — because it REUSES
  // `botAfkMs`, which J17's schema already added. No key was created, so no seed grew, so no
  // fingerprint moved and no dead-checkpoint window opened. That is the whole reason this was
  // affordable, and it is asserted rather than argued.
  // Asserted across the WHOLE export surface, not by naming two functions: M7 re-added an
  // accessor and survived a two-name check that happened to still hold, because the name it
  // re-added was one of the two and the check read the module's exports rather than its source.
  const revived = Object.keys(CP).filter((k) => /activityWindow/i.test(k));
  ok(revived.length === 0,
    "G: NO EXPORT NAMES A DEVICE-LOCAL ACTIVITY WINDOW — swept rather than named, so a differently " +
    "spelled revival fails here too", revived);
  const cpSrc = fs.readFileSync(path.join(ROOT, "core/chatprefs.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  ok(!/activityWindowMs/.test(cpSrc),
    "G: and the SOURCE names it nowhere either — a half-removal leaves dead code that still reads " +
    "plausible, which is this tree's recorded shape", "still named");
  ok(CP.activityWindowMs === undefined && CP.setActivityWindowMs === undefined,
    "G: THE DEVICE-LOCAL WINDOW IS GONE IN FULL — accessor and setter both. A knob narrowed until " +
    "it cannot disagree is a control that does nothing; a knob that can disagree is the collision. " +
    "Half-removing it would leave dead code that still reads plausible", 
    { get: typeof CP.activityWindowMs, set: typeof CP.setActivityWindowMs });
  ok(CP.ACTIVITY_WINDOW === undefined,
    "G: and its range with them, so nothing clamps a value nobody reads", CP.ACTIVITY_WINDOW);
  const fresh = CP.load();
  ok(!Object.prototype.hasOwnProperty.call(fresh, "activityWindowMs"),
    "G: a fresh device carries no such preference at all — the default is gone too, which is what " +
    "distinguishes a removal from a disabling", Object.keys(fresh));

  // AND THE KEY IT MOVED TO IS ONE THE REDUCER ALREADY DEFINED.
  const D = SDefaults();
  ok(Object.prototype.hasOwnProperty.call(D, Room.ACTIVITY_WINDOW_KEY),
    "G: the window's key is a REAL settings key — a reader naming one the reducer does not define " +
    "would fold a window of zero and list nobody, silently", Room.ACTIVITY_WINDOW_KEY);
  ok(Room.ACTIVITY_WINDOW_KEY === "botAfkMs",
    "G: AND IT IS THE BOT'S OWN THRESHOLD — the same number the bot acts on, which is the whole " +
    "correctness argument: the panel shows the basis for the bot removing somebody, so a panel " +
    "reading a different number would say a person is present while the bot removes them",
    Room.ACTIVITY_WINDOW_KEY);
  ok(typeof D[Room.ACTIVITY_WINDOW_KEY] === "number" && D[Room.ACTIVITY_WINDOW_KEY] > 0,
    "G: with a usable default, so a room that has never set it still folds a window", 
    D[Room.ACTIVITY_WINDOW_KEY]);

  // ── THE SIGNATURE IS THE ENFORCEMENT, SO THE SIGNATURE IS WHAT IS PINNED ─────────────────
  // `mutate-one-window` M1 asks whether a passed window can change the answer, and it CANNOT be
  // broken from that angle: a second argument is ignored, and making the reader honour one takes
  // both adding the parameter and reading it. The property is enforced by the DECLARATION rather
  // than by a check — so the declaration is what this asserts, and it is the site that would
  // notice a reintroduction from the reader's end (M6 covers the caller's end).
  ok(Room.recentlyActive.length === 1,
    "G: `recentlyActive` DECLARES EXACTLY ONE PARAMETER. There is no window to pass, which is why " +
    "no caller can disagree through one — the collision is closed by the shape of the function " +
    "rather than by a rule somebody must remember", Room.recentlyActive.length);
  {
    const same = liveRoom({ botPresenceSpine: true, botPresenceChat: false, botAfkMs: 5 * 60000 },
      [{ eventId: "$r", sender: "@recent:hs", ts: 10000000 - 2 * 60000, type: "ddjp.dj.join" },
       { eventId: "$o", sender: "@older:hs",  ts: 10000000 - 9 * 60000, type: "ddjp.dj.join" }]);
    const a = same.recentlyActive(10000000).people.map((p) => p.userId).sort().join(",");
    const b = same.recentlyActive(10000000, 60 * 60000).people.map((p) => p.userId).sort().join(",");
    ok(a === b && a === "@recent:hs",
      "G: and a caller that passes one anyway is IGNORED — the answer is the room's window either " +
      "way, driven rather than inferred from the arity", { without: a, with: b });
  }

  // ── THE ROW THIS WHOLE CHANGE EXISTS FOR: ONE LOG, ONE LIST ──────────────────────────────
  // Before v272 a fixture where the device window and `botAfkMs` differed produced TWO lists —
  // driven, 5 minutes against 15, `["@recent"]` against `["@older","@recent"]`. That is not a
  // difference of opinion: the People panel is the surface showing the basis for the bot REMOVING
  // somebody, so the wider-local case says a person is present while the bot is about to remove
  // them. **There is now no second window to differ from.**
  {
    const T3 = 10000000, M = 60000;
    const LOG3 = [
      { eventId: "$r", sender: "@recent:hs", ts: T3 - 2 * M, type: "ddjp.dj.join" },
      { eventId: "$o", sender: "@older:hs",  ts: T3 - 9 * M, type: "ddjp.dj.join" },
    ];
    const names3 = (f) => f.people.map((p) => p.userId).sort().join(",");

    // TWO CLIENTS OF ONE ROOM. Nothing distinguishes them but which client they are — there is no
    // per-device window left for them to hold, so any disagreement would have to come from the
    // room, and the room is one thing.
    const a = liveRoom({ botPresenceSpine: true, botPresenceChat: false, botAfkMs: 5 * M }, LOG3);
    const b = liveRoom({ botPresenceSpine: true, botPresenceChat: false, botAfkMs: 5 * M }, LOG3);
    ok(names3(a.recentlyActive(T3)) === names3(b.recentlyActive(T3)),
      "G: TWO CLIENTS OF ONE ROOM PRODUCE ONE LIST. Before this change they could not be made to " +
      "agree, because each held its own window and neither was wrong by its own rule", 
      { a: names3(a.recentlyActive(T3)), b: names3(b.recentlyActive(T3)) });
    ok(names3(a.recentlyActive(T3)) === "@recent:hs",
      "G: APPLIED — and the shared list is the one the ROOM's window produces, or 'they agree' " +
      "would be true of two clients agreeing on the wrong answer", names3(a.recentlyActive(T3)));

    // AND THE ROOM CHANGING ITS WINDOW MOVES BOTH.
    const wide = liveRoom({ botPresenceSpine: true, botPresenceChat: false, botAfkMs: 15 * M }, LOG3);
    ok(names3(wide.recentlyActive(T3)) === "@older:hs,@recent:hs",
      "G: a room with a WIDER window lists more people — so the window is a reading of room truth " +
      "rather than a constant, and the agreement above is not agreement-on-nothing",
      names3(wide.recentlyActive(T3)));
    ok(names3(wide.recentlyActive(T3)) !== names3(a.recentlyActive(T3)),
      "G control: the two windows genuinely produce different lists on this log — which is what " +
      "made the old per-device knob a collision rather than a harmless preference",
      { narrow: names3(a.recentlyActive(T3)), wide: names3(wide.recentlyActive(T3)) });

    // A THROWING SETTINGS READ MUST ALSO FAIL CLOSED. `mutate-one-window` M3 put a default in the
    // catch and survived, because every fixture reached settings successfully — the missing case
    // was the one where reading them THROWS, which is the route a fallback would hide behind.
    {
      const boom = loadInContext(["core/logger.js", "features/room.js"], {
        Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
        window: {}, document: { body: { appendChild() {} } },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        StreamManager: { getLog: () => LOG3, isLegal: () => true, on() {},
                         getState: () => { throw new Error("no state"); } },
        MatrixBridge: { getUserId: () => "@me:hs", getMyRank: () => 0, getRoster: () => [] },
      }).Room;
      ok(boom.recentlyActive(T3).people.length === 0,
        "G: a settings read that THROWS lists nobody — the catch path fails closed too. A default " +
        "there would be the removed second source, reachable only when the room is unreadable, " +
        "which is the hardest place to notice it", boom.recentlyActive(T3).people);
    }

    // FAIL CLOSED: a room with no readable window lists nobody, rather than falling back to a
    // number nobody set — the second source this change removed, arriving as a default.
    // THE ABSENCE IS NOW EXPLICIT, because `liveRoom` merges onto the reducer's defaults (v322)
    // and a key left out of the overrides is therefore PRESENT with its default. Written as an
    // explicit `undefined`, which `Object.assign` copies, so the room still has no readable window
    // — and the test says so in the fixture instead of relying on what the builder omits.
    const none = liveRoom({ botPresenceSpine: true, botPresenceChat: false, botAfkMs: undefined }, LOG3);
    ok(none.recentlyActive(T3).people.length === 0,
      "G: and a room whose window cannot be read lists NOBODY. A fallback here would be inventing " +
      "a rule the bot does not act on, which is the collision in one line", 
      none.recentlyActive(T3).people);
  }

  // THE STRUCTURAL HALF, and the one that survives somebody moving the number later: no backend
  // module may name ChatPrefs at all. That is what makes this preference incapable of reaching a
  // seed, a fingerprint or the reducer.
  const backendFiles = fs.readdirSync(path.join(ROOT, "backends/backend1"))
    .filter((f) => f.endsWith(".js"));
  ok(backendFiles.length > 10, "G: APPLIED — the backend scan must find the modules to scan", backendFiles.length);
  const offenders = backendFiles.filter((f) => {
    const s = fs.readFileSync(path.join(ROOT, "backends/backend1", f), "utf8")
      .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
    return /\bChatPrefs\s*\./.test(s);
  });
  ok(offenders.length === 0,
    "G: no backend module reads ChatPrefs, so nothing it holds can reach a seed or a fingerprint " +
    "— this is why the activity window costs no checkpoint and why this job is `ui` rather than " +
    "`derivation` on the Phase 6 gate", offenders);

  // And the control that makes that meaningful: the reducer's OWN settings are the thing this
  // avoided, and adding one key there really does move a fingerprint.
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js"], { Date, Math, JSON });
  const seg = F.sortLog(F.playingRoom({ songs: 2 }).log);
  const seed = sd.StateDeriver.buildSeed(seg, null);
  ok(seed.settings && Object.keys(seed.settings).length > 0,
    "G: APPLIED — the seed must carry a settings blob, or the control below measures nothing", seed.settings);
  const fp = (s) => sd.CheckpointFormat.fingerprint(1, null, s, 10, false, "$a..$b");
  const base = fp(seed);
  const tickBumped = JSON.parse(JSON.stringify(seed)); tickBumped.tick = (tickBumped.tick || 0) + 1;
  ok(fp(tickBumped) !== base,
    "G control: bumping an ordinary seed field moves the fingerprint, so the instrument reads the " +
    "seed at all", { base: base.slice(0, 12) });
  const keyAdded = JSON.parse(JSON.stringify(seed)); keyAdded.settings.activityWindowMs = 900000;
  ok(fp(keyAdded) !== base,
    "G: and ONE new settings key moves it too — which is the cost this job declined to pay, and " +
    "the reason the number lives in a device preference (`09-roadmap.md` J45)", { base: base.slice(0, 12) });
}

// ═══ the harness's own gate, shown to work in both directions ════════════════════════════════
{
  const rows = P.selfTest();
  const refusals = rows.filter((r) => r.refused === true).length;
  const admits = rows.filter((r) => r.admitted === true).length;
// ═══ PART H — THE ROOM DECIDES WHAT COUNTS, READ THROUGH THE LIVE READER ════════════════════
{
  const T = 10000000;
  const LOG = [
    { eventId: "$a", sender: "@a:hs", ts: T - 1000, type: "ddjp.dj.join" },
    { eventId: "$refused", sender: "@ghost:hs", ts: T - 500, type: "ddjp.room.settings" },
  ];
  const names2 = (f) => f.people.map((p) => p.userId).sort();

  const on = liveRoom({ botPresenceSpine: true, botPresenceChat: false, botAfkMs: 60 * MIN }, LOG)
    .recentlyActive(T);
  ok(names2(on).join(",") === "@a:hs",
    "H: APPLIED — with the room counting queue activity, somebody who acted IS listed", names2(on));
  ok(names2(on).indexOf("@ghost:hs") < 0 && on.refused === 1,
    "H: AND AN ACT THE ROOM REFUSED COUNTS FOR NOBODY, counted rather than dropped silently. " +
    "Being listed as around on the strength of an act the room threw away is a claim about a " +
    "person that no event supports", { people: names2(on), refused: on.refused });

  const off = liveRoom({ botPresenceSpine: false, botPresenceChat: false, botAfkMs: 60 * MIN }, LOG)
    .recentlyActive(T);
  ok(off.people.length === 0 && off.sources.spine === false,
    "H: A ROOM THAT DOES NOT COUNT QUEUE ACTIVITY LISTS NOBODY — the rule comes from the ROOM, " +
    "so this is the setting doing something rather than a panel with its own opinion", off);

  // EXPLICIT ABSENCE, not an empty override object. Since v322 `liveRoom` merges onto the
  // reducer's defaults — because a partial blob is a state no live client can hold — so `{}` now
  // means "a normal room", which is the opposite of this assertion's premise. Naming each key as
  // undefined states the unreadable room the test is actually about.
  const noSettings = liveRoom({ botPresenceSpine: undefined, botPresenceChat: undefined,
                                botAfkMs: undefined, activityPresence: undefined }, LOG)
    .recentlyActive(T);
  ok(noSettings.people.length === 0,
    "H: and with NO rule readable it FAILS CLOSED — listing people under a definition nobody set " +
    "is the collision this change exists to end", noSettings);

  const chat = liveRoom({ botPresenceSpine: true, botPresenceChat: true, botAfkMs: 60 * MIN }, LOG)
    .recentlyActive(T);
  ok(chat.unobservable.length === 1 && chat.unobservable[0] === "chat",
    "H: A ROOM COUNTING CHAT IS REPORTED AS UNOBSERVABLE. Chat never reaches the log and cannot, " +
    "so this list is a SUBSET of what the room considers active — and the panel must say so " +
    "instead of implying it agrees with a bot that can see chat", chat.unobservable);
  ok(chat.sources.chat === true && on.unobservable.length === 0,
    "H control: while a room NOT counting chat reports nothing unobservable — so the flag is a " +
    "reading of the room's rule rather than a permanent caption", 
    { chat: chat.sources, spineOnly: on.unobservable });

  // THE RULE IS READ FRESH, driven by changing it between two calls on ONE Room.
  {
    let live = { botPresenceSpine: true, botPresenceChat: false, botAfkMs: 60 * MIN };
    const R2 = liveRoom(live, LOG);
    // `liveRoom` closes over the object it was handed, so mutating it IS the owner changing it.
    const first = R2.recentlyActive(T);
    ok(first.people.length === 1, "H: APPLIED — the first read must list somebody", first.people);
    live.botPresenceSpine = false;
    const second = R2.recentlyActive(T);
    ok(second.people.length === 0,
      "H: THE RULE IS READ FRESH ON EVERY CALL. The owner turned queue activity off between two " +
      "reads and the second obeyed — a cached rule would go on applying a definition the room no " +
      "longer has", second.people);
  }

  // THE FOLD'S OWN DEFAULT, driven directly — the live reader always builds a sources object, so
  // the `sources` argument being ABSENT is a path `recentlyActive` can never exercise and M2
  // survived on it.
  {
    const bare = Room.foldActivity(LOG, T, 60 * MIN);
    ok(bare.people.length === 0 && bare.sources.spine === false,
      "H: THE FOLD ITSELF FAILS CLOSED when handed no sources at all. Every call today supplies " +
      "them, so this is the path a future caller reaches first — and defaulting to `count " +
      "everything` would put the collision back for that caller alone", bare);
    for (const bad of [null, undefined, 0, "spine", []]) {
      ok(Room.foldActivity(LOG, T, 60 * MIN, bad).people.length === 0,
        "H: and a malformed sources argument counts nobody rather than being coerced into a rule",
        { sent: bad });
    }

    // ── THE GROUPS ARGUMENT FAILS CLOSED **ON ITS OWN** (v322) ────────────────────────────
    // The assertions above supply NO sources, so `wantSpine` is already false and the fold would
    // count nobody whatever the groups rule said. That masks this one completely: driven in the
    // v322 audit, making the groups map default to *count everything* left the whole suite GREEN,
    // because every other call in the tree supplies one.
    //
    // So this passes REAL sources and withholds only the groups, which is the one arrangement in
    // which the groups rule is the only thing that can close the fold.
    ok(Room.foldActivity(LOG, T, 60 * MIN, SPINE, null).people.length === 0,
      "H: WITH SOURCES SUPPLIED AND NO GROUPS RULE, the fold still counts nobody. Defaulting to "
      + "count-everything here would silently restore the thing v322 removed — a client-authored "
      + "auto-advance reading as its owner being present — for any caller that omitted the "
      + "argument, which is every caller written before it existed",
      Room.foldActivity(LOG, T, 60 * MIN, SPINE, null).people);
    for (const bad of [null, undefined, 0, "rotation", [], { rotation: "yes" }]) {
      ok(Room.foldActivity(LOG, T, 60 * MIN, SPINE, null, bad, GROUP_OF).people.length === 0,
        "H: and a malformed groups argument counts nobody rather than being coerced into a rule",
        { sent: bad });
    }
    // AND THE CLASSIFIER HALF, which fails closed separately: a groups map with no way to
    // classify an event is as unusable as no map at all.
    ok(Room.foldActivity(LOG, T, 60 * MIN, SPINE, null, ALL_GROUPS, null).people.length === 0,
      "H: a permissive groups map with NO CLASSIFIER counts nobody — the two halves are separate "
      + "and each closes on its own, so a caller supplying one cannot get a rule out of it");
    // THE CONTROL, or all five of the above pass on a fold that reaches nothing.
    ok(Room.foldActivity(LOG, T, 60 * MIN, SPINE, null, ALL_GROUPS, GROUP_OF).people.length > 0,
      "H CONTROL: with BOTH supplied the same log DOES list somebody, so the closures above are "
      + "the arguments doing work rather than a fixture that never admitted anybody");
  }

  // THE KEY TABLE IS INDEXED AT CALL TIME, driven by MOVING it — a reader that restated the names
  // would be unaffected, which is exactly how M6 survived.
  {
    // THE TWO KEYS DISAGREE, which is the only way to tell which one was read. The first version
    // set both to true and M6 survived: a hardcoded `s.botPresenceSpine` and a table lookup gave
    // the same answer, so the fixture could not distinguish them.
    const R3 = liveRoom({ botPresenceSpine: false, renamedSpineKey: true, botAfkMs: 60 * MIN }, LOG);
    const before = R3.recentlyActive(T);
    ok(before.people.length === 0,
      "H: APPLIED — under the original key the room counts nothing, so the change below is " +
      "visible", before.people);
    // THE WINDOW KEY IS INDEXED AT CALL TIME TOO, driven the same way as the sources: move the
    // table entry and see whether the reader follows. A restated key would be unaffected — which
    // is exactly how `mutate-one-window` M4's first version came back green.
    {
      const RW = liveRoom({ botPresenceSpine: true, renamedWindowKey: 60 * MIN, botAfkMs: 0 }, LOG);
      ok(RW.recentlyActive(T).people.length === 0,
        "H: APPLIED — with the window key naming a setting that is zero, nobody is listed",
        RW.recentlyActive(T).people);
      RW.ACTIVITY_WINDOW_KEY = "renamedWindowKey";
      ok(RW.recentlyActive(T).people.length > 0,
        "H: MOVING THE WINDOW KEY IN THE TABLE MOVES WHAT THE READER READS — it indexes at call " +
        "time rather than spelling the key, so a rename cannot leave the fold reading a setting " +
        "that no longer exists and listing nobody", RW.recentlyActive(T).people.length);
      RW.ACTIVITY_WINDOW_KEY = "botAfkMs";
    }

    R3.ACTIVITY_SOURCES.spine = "renamedSpineKey";
    const after = R3.recentlyActive(T);
    ok(after.people.length === 1 && after.sources.spine === true,
      "H: MOVING THE KEY IN THE TABLE MOVES WHAT THE READER READS — it indexes the table at call " +
      "time rather than restating the names, so a rename cannot leave the fold reading a key that " +
      "no longer exists and counting nobody", after.sources);
    R3.ACTIVITY_SOURCES.spine = "botPresenceSpine";
  }

  // AND THE SETTING KEYS ARE READ FROM THE TABLE, NOT RESTATED.
  ok(Room.ACTIVITY_SOURCES && Room.ACTIVITY_SOURCES.spine === "botPresenceSpine" &&
     Room.ACTIVITY_SOURCES.chat === "botPresenceChat",
    "H: the two setting names live in one table the reader indexes, so a rename moves both the " +
    "reader and this assertion together instead of leaving the fold reading a key that is gone",
    Room.ACTIVITY_SOURCES);
  const D = SDefaults();
  for (const k of Object.keys(Room.ACTIVITY_SOURCES)) {
    ok(Object.prototype.hasOwnProperty.call(D, Room.ACTIVITY_SOURCES[k]),
      "H: and every name in it is a real settings key — a source naming a setting the reducer " +
      "does not define would count nobody, silently", { source: k, key: Room.ACTIVITY_SOURCES[k] });
  }
}

  ok(refusals === 3 && admits === 2,
    "the admissibility gate refuses each broken reading and ADMITS the sound ones — a gate that " +
    "refuses everything certifies nothing", rows);
}

console.log("[who-is-here] PASS — the people list means what it says it means (J16). It is folded " +
  "from `StreamManager.getLog()` on every render and holds NO state of its own, so a name survives " +
  "exactly as long as the evidence for it does; the entry's dependency on the bot is refuted by " +
  "computing the Done-when without one, driven end to end from the ingest door through the feature " +
  "reader to the rendered panel. The window is bounded by the log's own REACH, measured rather " +
  "than assumed, so a young room and a trimmed room narrow the CLAIM through the same arithmetic " +
  "and a name that fell below the floor disappears in the same step the panel stops claiming to " +
  "have looked that far back — with a control proving `bounded` is a reading of the log and not a " +
  "constant. The panel is EXTRACTED FROM `ui/interface.js` AND EXECUTED, because nine guards read " +
  "that file and a regex proving a sentence is spelled there proves nothing about whether it is " +
  "ever rendered: it paints what the fold hands it in the fold's own order, filters and re-sorts " +
  "nothing, and measures against ServerClock's stamp rather than a device clock (P2). Its stated " +
  "span is the EFFECTIVE window, never the requested one. And the sentence about chat is driven " +
  "rather than restated — the real `_routeEvent` refuses a chat-channel event at both the store " +
  "and the fold while admitting the same body from an events channel, so THREE sources reach this " +
  "list and not the four the entry names. The window is a per-device preference no backend module " +
  "can read, with the control showing what a room setting would have cost: one settings key moves " +
  "every checkpoint's fingerprint (" + asserts + " assertions)");
