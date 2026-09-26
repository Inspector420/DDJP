// tests/check-event-feed.js
// SUBJECT: features/room.js, backends/backend1/statederiver.js
// WALL: A FEED FOLD THAT NARRATES ONLY WHAT HAPPENED, AND KNOWS WHICH KIND OF EMPTY IT IS.
//
// J13 asks for a running list of what has happened in the room, derived on every render, holding
// no state of its own (P5). The failure this file exists to prevent is not a broken list — it is
// a PLAUSIBLE one: a feed that narrates an act the room refused, or that goes silently empty in a
// forgotten room and reads as a room where nothing has happened. Both are `roles.md` §10's second
// signature — a narrative naming an action nobody took — and neither breaks anything.
//
// ── THE JOB ENTRY'S DONE-WHEN IS WRONG, AND BOTH HALVES ARE DRIVEN HERE ─────────────────────
// It asks for "a feed that starts at the floor, not an empty one with no explanation".
//   · PART D: A FEED CAN NEVER START **AT** THE FLOOR. `trimToFloor` keeps `l > floorL` strictly,
//     because the boundary event is at the floor and already inside its seed. Driven: nothing at
//     the floor's position survives the trim, so the oldest row a feed can hold is the first
//     event strictly ABOVE it.
//   · PART E: THE EMPTY FEED IS REACHABLE AND CORRECT. A room that seals at its own head holds
//     ZERO rows while `getState()` still derives a live `nowPlaying` from the seed. "Not an empty
//     one" would require fabricating rows, which is the one thing a feed must never do.
// What survives is the last three words, and until ddjp_425 PART F was that: the PANEL explained
// the empty case. The panel is gone by owner ruling — the feed's rows sit between chat messages,
// go-forward from entry — so there is no surface left that shows an empty feed to explain. The FOLD
// still decides the three origins (PART E), and nothing here depends on a panel reading them.
//
// WHAT EACH PART PINS:
//   PART A — the fold's arithmetic at explicit stamps, with the admitted sibling beside every
//     exclusion (a refusal is evidence only if something adjacent was admitted).
//   PART B — a REFUSED event is counted and never narrated, driven at `isLegal` varying on one
//     fixture with one detail changed.
//   PART C — the live path: real events through the one door, then `Room.recentEvents`.
//   PART D — a trim, and what the feed holds at the floor. The strictness of the boundary.
//   PART E — the THREE ORIGINS, and that they are told apart by state-without-evidence rather
//     than by a guard seam. This is the part the Done-when correction rests on.
//   PART F — RETIRED at ddjp_425 with the Feed panel it drove. Its properties that outlive the
//     panel — rows in the fold's own words, a card trigger on every name, a throwing reader that
//     leaves the surface standing — are asserted where they now render, in `check-chat-view`
//     PART D. The ones that do not — relative ages, the windowed list, the empty-state sentences,
//     the refused count on screen, "unre-sorted" — retired with it: chat MUST re-sort, because it
//     merges feed rows with messages by server time.
//   PART G — every type the reducer handles is DECIDED about: named in `FEED_KINDS` or excluded
//     in `FEED_UNNAMED` with a reason. A new event type fails this rather than inheriting an
//     answer nobody chose.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let asserts = 0;
function fail(msg, got) {
  console.log("[event-feed] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");

// A client with the REAL StreamManager and the REAL Room fold — a harness copy of `foldFeed`
// would be a second definition of the rule, free to disagree with the one that ships.
function client(rank) {
  const sb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js", "core/playlistdoc.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/settingsproof.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js",
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

// Build an owner floor covering everything at or below `full[cutIdx]`, and adopt it through the
// real path with the licence granted first — which is the ordering the forget gate is about.
function adoptFloorAt(c, full, cutIdx) {
  const oc = client(F.RANK.owner);
  oc.feed(full.filter((e) => e.l <= full[cutIdx].l));
  const seg = oc.StreamManager.getLog();
  const last = seg[seg.length - 1];
  const FL = { t: "ddjp.checkpoint", n: 1, prev: null, seed: oc.StateDeriver.buildSeed(seg),
               covers: oc.CheckpointFormat.coversOf(seg[0].eventId, last.eventId),
               floorL: last.l, thin: false, by: "@own:hs" };
  FL.h = oc.CheckpointFormat.fingerprint(FL.n, FL.prev, FL.seed, FL.floorL, FL.thin, FL.covers);
  c.StreamManager._setLicenceForTest({ status: "validated", reason: "granted-by-guard" });
  c.SettingsProof._setVerdictForTest({ status: "validated", reason: "granted-by-guard" });
  c.Floor.remember(FL, F.RANK.owner, "@own:hs");
  c.Floor.adopt({ floor: Object.assign({ u: "@own:hs" }, FL), tier: 0 });
  return FL;
}

const C0 = client(F.RANK.staff);
const Room = C0.Room;
ok(typeof Room.foldFeed === "function" && typeof Room.recentEvents === "function",
  "the feature layer must expose the fold and its live reader — without both, nothing below has a subject");
ok(Room.FEED_KINDS && Room.FEED_UNNAMED,
  "and the kind tables, because PART G reads them out of the module rather than restating them");

const verbs = (f) => f.rows.map((r) => r.verb);
const ids = (f) => f.rows.map((r) => r.eventId);

// ═══ PART A — the fold's arithmetic, at explicit stamps ══════════════════════════════════════
// The fold reads no clock and no module of its own, which is what lets this part drive it at
// exact values — the same property `foldActivity` has and for the same reason.
{
  const T = 10000000;
  const log = [
    { eventId: "$e1", type: "ddjp.dj.join",  sender: "@a:hs", ts: T - 300, l: 1 },
    { eventId: "$e2", type: "ddjp.dj.play",  sender: "@b:hs", ts: T - 200, l: 2 },
    { eventId: "$e3", type: "ddjp.dj.vote",  sender: "@c:hs", ts: T - 100, l: 3 },
  ];
  const f = Room.foldFeed(log, () => true, { limit: 50 });

  ok(f.rows.length === 3, "A: every named, accepted event becomes a row", f.rows.length);
  // NEWEST FIRST. A running list is read from the top, so the order is the fold's claim and the
  // panel renders it unchanged (PART F).
  ok(ids(f).join(",") === "$e3,$e2,$e1",
    "A: newest first — a running list is read from the top", ids(f));
  ok(verbs(f)[0] === "upvoted the song" && verbs(f)[2] === "joined the DJ queue",
    "A: each row carries the phrasing its kind is named with", verbs(f));
  ok(f.rows[0].sender === "@c:hs" && f.rows[0].ts === T - 100,
    "A: with the sender and the SERVER stamp the transport put on the event (P2)", f.rows[0]);

  // Ties at one position break by id, so two events at one stamp have a stable order rather than
  // whichever the sort happened to leave. Newest-first means the id order is reversed too.
  const tied = Room.foldFeed([
    { eventId: "$aa", type: "ddjp.dj.vote", sender: "@x:hs", ts: T, l: 9 },
    { eventId: "$bb", type: "ddjp.dj.save", sender: "@y:hs", ts: T, l: 9 },
  ], () => true, {});
  ok(ids(tied).join(",") === "$bb,$aa",
    "A: two events at one stamp are ordered by id, so the list is stable rather than incidental", ids(tied));

  // An entry with no id or no type is not an event this feed can name.
  const dirty = Room.foldFeed(
    [{ type: "ddjp.dj.join", sender: "@n:hs", ts: T }, { eventId: "$x", sender: "@n:hs", ts: T },
     { eventId: "$ok", type: "ddjp.dj.join", sender: "@n:hs", ts: T, l: 1 }],
    () => true, {});
  ok(ids(dirty).length === 1 && ids(dirty)[0] === "$ok",
    "A: an entry with no id or no type contributes no row", ids(dirty));

  // AN UNNAMED KIND PRODUCES NO ROW, AND THIS ASSERTION EXISTS BECAUSE A MUTATION SURVIVED
  // WITHOUT IT. `mutate-j13-feed` M5 makes an unnamed type render with a placeholder verb, and
  // the first version of this file stayed GREEN: PART G reads the TABLES and PART A's fixture
  // used only named kinds, so nothing anywhere drove an unnamed type through the fold and looked
  // at what came out. The guard asserted that every type was DECIDED about and never that the
  // decision was ACTED on — a gap between a table and its consumer, which is the shape
  // `08-build-and-deploy.md` warns about under *the fixture was too simple to distinguish the
  // mutation from correct behaviour*.
  {
    const un = Object.keys(Room.FEED_UNNAMED)[0];
    ok(!!un, "A: APPLIED — there must be an excluded kind to drive, or the rows below are vacuous");
    const mixed = Room.foldFeed([
      { eventId: "$named",   type: "ddjp.dj.join", sender: "@a:hs", ts: T - 10, l: 1 },
      { eventId: "$unnamed", type: un,             sender: "@a:hs", ts: T - 5,  l: 2 },
    ], () => true, {});
    ok(ids(mixed).indexOf("$named") >= 0,
      "A control: the NAMED kind beside it becomes a row, or the exclusion below is free", ids(mixed));
    ok(ids(mixed).indexOf("$unnamed") < 0,
      "A: a kind listed in `FEED_UNNAMED` produces NO ROW — the exclusion is acted on rather than " +
      "merely declared in a table", ids(mixed));
    ok(mixed.unnamed === 1,
      "A: and it is counted, so 'held but not narrated' is a number the fold can report rather " +
      "than a silence", mixed.unnamed);
    ok(mixed.counted === 2,
      "A: while `counted` still sees everything held — the reach is measured over the whole log, " +
      "not over the narrated subset, or a room full of length declarations would report a " +
      "shorter reach than it has", mixed.counted);
  }

  // The LIMIT bounds the rows and says so, rather than silently showing fewer.
  const many = [];
  for (let i = 0; i < 30; i++) {
    many.push({ eventId: "$m" + i, type: "ddjp.dj.vote", sender: "@v:hs", ts: T + i, l: i });
  }
  const cut = Room.foldFeed(many, () => true, { limit: 10 });
  ok(cut.rows.length === 10 && cut.total === 30 && cut.truncated === true,
    "A: the limit bounds the ROWS while `total` keeps the true count, and `truncated` says which " +
    "— a feed that showed ten of thirty without saying so would be under-reporting silently", cut);
  const uncut = Room.foldFeed(many, () => true, { limit: 100 });
  ok(uncut.truncated === false && uncut.rows.length === 30,
    "A control: with room to spare nothing is truncated, so `truncated` is a reading rather than " +
    "a constant", uncut.truncated);
}

// ═══ PART B — a refused event is COUNTED, never NARRATED ═════════════════════════════════════
// The log holds what the reducer REJECTED as well as what it accepted (PART C drives that through
// the real door). A feed that listed them would name acts nobody performed.
{
  const T = 10000000;
  const log = [
    { eventId: "$good", type: "ddjp.room.settings", sender: "@own:hs", ts: T - 10, l: 1 },
    { eventId: "$bad",  type: "ddjp.room.settings", sender: "@ply:hs", ts: T - 5,  l: 2 },
  ];
  // ONE FIXTURE, ONE DETAIL CHANGED: the same kind, from two senders, with legality the only
  // difference. Without the admitted sibling the exclusion below would be free.
  const f = Room.foldFeed(log, (id) => id !== "$bad", {});
  ok(ids(f).indexOf("$good") >= 0,
    "B control: an ACCEPTED settings change IS narrated, or the exclusion below proves nothing", ids(f));
  ok(ids(f).indexOf("$bad") < 0,
    "B: an event the reducer REFUSED is not narrated — a feed listing it would name an act nobody " +
    "performed, which is `roles.md` §10's second signature", ids(f));
  ok(f.refused === 1,
    "B: AND IT IS COUNTED. Dropping it silently would make the feed under-report without saying " +
    "so, which is the same failure one level quieter", f.refused);

  // The count travels so the panel can state it; the rows never do.
  const none = Room.foldFeed(log, () => true, {});
  ok(none.refused === 0 && none.rows.length === 2,
    "B control: with nothing refused the count is zero and both rows appear — so `refused` is a " +
    "reading of legality rather than a constant", none);

  // THE INHERITED DIRECTION, WRITTEN DOWN RATHER THAN RE-DECIDED. `isLegal` answers TRUE when the
  // derive failed, because over-protecting is the safe failure for the vouch layer that owns it.
  // This fold inherits that and must not invent a second rule (P7).
  const noPredicate = Room.foldFeed(log, null, {});
  ok(noPredicate.rows.length === 2 && noPredicate.refused === 0,
    "B: with no legality predicate at all the fold narrates everything rather than nothing — the " +
    "contract's own failure direction, inherited rather than re-decided here", noPredicate);
}

// ═══ PART C — the live path: real events through the one door ════════════════════════════════
// PART A drove the fold directly, which is a guard on the MODULE. This drives the production
// reader over the log the transport actually fills.
{
  const c = client(F.RANK.staff);
  const room = F.playingRoom({ songs: 2 });
  c.feed(F.sortLog(room.log));
  const headL = room.lastL;
  const t = room.startTs + 400000;
  c.feed([
    F.reducerEvent("$vote", headL + 1, t,        "@voter:hs", F.RANK.vip, { t: "ddjp.dj.vote", p: room.pi(0) }),
    F.reducerEvent("$save", headL + 2, t + 1000, "@voter:hs", F.RANK.vip, { t: "ddjp.dj.save", p: room.pi(0) }),
  ]);
  // A settings blob from a PLAYER — legal shape, refused by the fold, still in the log.
  c.feed([F.reducerEvent("$deny", headL + 3, t + 2000, "@ply:hs", F.RANK.player,
    { t: "ddjp.room.settings", s: { maxLen: 400 } })]);

  const held = c.StreamManager.getLog();
  ok(held.some((e) => e.eventId === "$deny"),
    "C: APPLIED — THE REFUSED EVENT IS IN THE LOG. This is the premise PART B rests on, asserted " +
    "here against the real door rather than assumed: `getLog()` holds what the reducer rejected",
    held.map((e) => e.eventId));
  ok(c.StreamManager.isLegal("$deny") === false,
    "C: APPLIED — and the interface says it was refused, so legality is what distinguishes it",
    c.StreamManager.isLegal("$deny"));
  ok(c.StreamManager.isLegal("$vote") === true,
    "C control: while an accepted event answers true, so `isLegal` discriminates rather than " +
    "answering one way for everything", c.StreamManager.isLegal("$vote"));

  const f = c.Room.recentEvents({ limit: 100 });
  ok(ids(f).indexOf("$vote") >= 0 && ids(f).indexOf("$save") >= 0,
    "C: the live reader narrates the accepted acts — the feed is computable from the log TODAY, " +
    "with no bot, no new event type and no new module", ids(f));
  ok(ids(f).indexOf("$deny") < 0 && f.refused >= 1,
    "C: and the refused one is counted rather than listed, end to end through the production path",
    { ids: ids(f), refused: f.refused });
  ok(f.origin === "held",
    "C: a room holding its own log reports origin `held`", f.origin);

  // AND THE EXCLUSION HOLDS ON THE LIVE PATH TOO. `playingRoom` declares a song after every play,
  // so the log genuinely contains `ddjp.dj.declare` — an unnamed kind arriving through the real
  // door rather than hand-built. Same gap M5 found in PART A, closed here on the production path.
  const declares = held.filter((e) => e.type === "ddjp.dj.declare");
  ok(declares.length > 0,
    "C: APPLIED — the fixture must actually contain an unnamed kind, or the exclusion below is " +
    "asserted over an absence", held.map((e) => e.type));
  ok(!declares.some((d) => ids(f).indexOf(d.eventId) >= 0),
    "C: and none of them is narrated — a buffer edit is not a room act, and a feed of them is a " +
    "feed of typing", ids(f));
  ok(f.unnamed >= declares.length,
    "C: while the count reports them, so they are excluded rather than invisible", f.unnamed);

  // The reader must not cache: a second call after another event must see it.
  c.feed([F.reducerEvent("$late", headL + 4, t + 3000, "@voter:hs", F.RANK.vip,
    { t: "ddjp.dj.vote", p: room.pi(1) })]);
  const g = c.Room.recentEvents({ limit: 100 });
  ok(ids(g).indexOf("$late") >= 0 && ids(g)[0] === "$late",
    "C: the reader folds on every call rather than caching — a cached feed would go on narrating " +
    "rows whose evidence a trim has destroyed, and would miss the newest act", ids(g));
}

// ═══ PART D — the trim, and WHAT IS ACTUALLY AT THE FLOOR ════════════════════════════════════
// THE FIRST HALF OF THE DONE-WHEN CORRECTION. The entry asks for a feed that "starts at the
// floor". It cannot: the boundary event sits AT the floor and is already inside its seed, so
// `trimToFloor` keeps `l > floorL` STRICTLY and nothing at that position survives.
{
  const room = F.playingRoom({ songs: 8 });
  const full = F.sortLog(room.log);
  const c = client(F.RANK.staff);
  c.feed(full);

  const before = c.StreamManager.getLog();
  const beforeFeed = c.Room.recentEvents({ limit: 500 });
  ok(beforeFeed.rows.length > 0,
    "D control: the feed must hold rows BEFORE the trim, or its narrowing below proves nothing",
    beforeFeed.rows.length);

  const FLOOR = adoptFloorAt(c, full, 7);
  const after = c.StreamManager.getLog();
  ok(after.length < before.length,
    "D: APPLIED — the trim must have happened, or the readings below are the same reading",
    { before: before.length, after: after.length, floorL: FLOOR.floorL });

  // THE STRICTNESS, MEASURED. Not "roughly at the floor" — nothing at that position at all.
  ok(after.every((e) => e.l > FLOOR.floorL),
    "D: everything the client still holds is STRICTLY ABOVE the floor", after.map((e) => e.l));
  ok(!after.some((e) => e.l === FLOOR.floorL),
    "D: AND NOTHING SITS AT IT. The boundary event is already banked into the floor's own seed, " +
    "so keeping it would double-count on the next fold — which is why a feed can never `start at " +
    "the floor` the way the job entry asks. It starts at the first event ABOVE it",
    after.map((e) => e.l));
  ok(before.some((e) => e.l === FLOOR.floorL),
    "D control: and that event WAS held before the trim, so its absence is the boundary's doing " +
    "rather than a fixture that never had one", FLOOR.floorL);

  const afterFeed = c.Room.recentEvents({ limit: 500 });
  ok(afterFeed.rows.length > 0 && afterFeed.rows.length < beforeFeed.rows.length,
    "D: the feed narrows to what survived and still shows it — a trim shortens the list rather " +
    "than emptying it, while there is anything above the floor",
    { before: beforeFeed.rows.length, after: afterFeed.rows.length });
  ok(afterFeed.oldestL > FLOOR.floorL,
    "D: and the oldest row it can name is above the floor, measured rather than declared",
    { oldestL: afterFeed.oldestL, floorL: FLOOR.floorL });
  ok(afterFeed.origin === "held",
    "D: with rows still held the origin is `held`, not `forgotten` — the explanation is for the " +
    "case where there is nothing to show, not for every trimmed room", afterFeed.origin);
}

// ═══ PART E — THE THREE ORIGINS, told apart WITHOUT A GUARD SEAM ═════════════════════════════
// THE SECOND HALF OF THE CORRECTION, and the part the whole job turns on. The entry says a
// forgotten room must not show "an empty one". Driven here: the empty one is REACHABLE AND
// CORRECT, and what a forgotten room owes is an EXPLANATION rather than fabricated rows.
//
// The discriminator is STATE WITHOUT EVIDENCE, read from `getLog()` and `getState()` — both on
// the backend interface, so it survives a backend swap. `StreamManager._trimState()` would have
// answered too and is a GUARD SEAM: rule F is textual and would not have caught a feature reading
// it, but the reason rule F exists would.
{
  // E1 — nothing has happened at all.
  const fresh = client(F.RANK.staff);
  const f1 = fresh.Room.recentEvents({});
  ok(f1.rows.length === 0 && f1.origin === "nothing-yet",
    "E: a client with no events and no room reports `nothing-yet`", f1);

  // E2 — a young room, untrimmed.
  const young = client(F.RANK.staff);
  young.feed(F.sortLog(F.playingRoom({ songs: 2 }).log));
  const f2 = young.Room.recentEvents({});
  ok(f2.rows.length > 0 && f2.origin === "held",
    "E: a room holding its log reports `held`", { rows: f2.rows.length, origin: f2.origin });

  // E3 — THE QUIET ROOM: the floor is sealed at the log's own HEAD, so nothing is above it.
  const room = F.playingRoom({ songs: 8 });
  const full = F.sortLog(room.log);
  const c = client(F.RANK.staff);
  c.feed(full);
  adoptFloorAt(c, full, full.length - 1);

  const held = c.StreamManager.getLog();
  ok(held.length === 0,
    "E: APPLIED — A ROOM THAT SEALS AT ITS OWN HEAD HOLDS NOTHING AT ALL. This is the measurement " +
    "the Done-when did not have: the empty feed is not a failure mode to design away, it is what " +
    "a forgotten quiet room correctly contains", held.length);
  const st = c.StreamManager.getState();
  ok(!!(st && st.nowPlaying),
    "E: APPLIED — and the room is still RUNNING, deriving now-playing from the checkpoint's seed. " +
    "An empty log under a live room is exactly the state that has to be explained rather than " +
    "reported as an empty room", st && st.nowPlaying);

  const f3 = c.Room.recentEvents({});
  ok(f3.rows.length === 0 && f3.origin === "forgotten",
    "E: THE FEED SAYS `forgotten`, NOT `nothing-yet` — the two empties are told apart by state " +
    "surviving where evidence did not", f3);
  ok(f3.roomExists === true && f3.held === 0,
    "E: and the two readings that decide it travel together on the fold, so the panel cannot ask " +
    "them a render apart and get a pair that never coexisted", { held: f3.held, roomExists: f3.roomExists });

  // THE CONTROL THAT MAKES `forgotten` A READING RATHER THAN A CONSTANT: same empty list, no room.
  ok(f1.origin !== f3.origin,
    "E control: an empty feed with NO room answers differently from an empty feed WITH one — so " +
    "`forgotten` is decided by the pair rather than by emptiness alone", { fresh: f1.origin, trimmed: f3.origin });

  // AND THE SEAM IS NOT REACHED. The feature layer must not read a backend private to answer this.
  const src = fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  ok(!/_trimState\s*\(/.test(src),
    "E: `features/room.js` does not call `StreamManager._trimState()` — the discriminator is built " +
    "from `getLog()` and `getState()`, which are the contract, so it survives a backend that has " +
    "no such private", "features/room.js names _trimState");
}

// ═══ PART G — every reducer type is DECIDED about ════════════════════════════════════════════
// `08-build-and-deploy.md` §Decide, do not merely gate. A derived rule asserting one correct
// answer will be wrong somewhere; a guard demanding a DECISION cannot be, and it still catches the
// real failure — a new event type inheriting an answer nobody chose. The same move that fixed the
// six missing `ddjp.media.skip` subscriptions: DERIVE the candidates rather than list them.
{
  const sd = fs.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8");
  const found = Object.create(null);
  for (const m of sd.matchAll(/"(ddjp\.[a-z.]+)"/g)) found[m[1]] = true;
  const types = Object.keys(found).sort();
  ok(types.length > 10,
    "G: APPLIED — the scan must find the reducer's vocabulary, or every row below is vacuous", types.length);

  const named = Room.FEED_KINDS, unnamed = Room.FEED_UNNAMED;
  const undecided = types.filter((t) => !named[t] && !unnamed[t]);
  ok(undecided.length === 0,
    "G: every event type the reducer handles is either NAMED in `FEED_KINDS` or excluded in " +
    "`FEED_UNNAMED` with a reason. A type in neither is not a bug in the feed — it is a decision " +
    "nobody made, which is how a list somebody remembered goes stale",
    undecided);

  // The tables must not name a type the reducer does not handle — a verb for an event that can
  // never arrive reads as coverage and is decoration.
  const strayNamed = Object.keys(named).filter((t) => !found[t]);
  ok(strayNamed.length === 0,
    "G: and `FEED_KINDS` names no type the reducer does not handle, so every verb here is " +
    "reachable rather than decorative", strayNamed);
  const strayUnnamed = Object.keys(unnamed).filter((t) => !found[t]);
  ok(strayUnnamed.length === 0,
    "G: same for the exclusions — an excuse for an event that cannot arrive is not an exclusion",
    strayUnnamed);

  // Every exclusion carries a REASON, because "absent from the feed" and "nobody decided" are
  // different states and only one of them is acceptable.
  const reasonless = Object.keys(unnamed).filter((t) => typeof unnamed[t] !== "string" || unnamed[t].length < 20);
  ok(reasonless.length === 0,
    "G: and each exclusion states why, at length enough to be a reason rather than a label",
    reasonless);

  // The six kinds the JOB ENTRY names must all be reachable, since the entry is the requirement.
  for (const t of ["ddjp.dj.join", "ddjp.dj.play", "ddjp.dj.skip", "ddjp.dj.vote",
                   "ddjp.dj.save", "ddjp.room.settings"]) {
    ok(!!named[t],
      "G: the entry names joins, advances, skips, votes, saves and settings changes — `" + t +
      "` must be among the kinds the feed names", Object.keys(named));
  }

  // AND THE SEVENTH THE ENTRY DOES NOT NAME AND COULD NOT: chat. It is not in the reducer's
  // vocabulary at all, because `_routeEvent` skips chat-named rooms before both the store and the
  // fold — so there is no type here to decide about, and the panel states the limit instead.
  ok(!types.some((t) => /chat/.test(t)),
    "G: no chat type appears in the reducer's vocabulary, which is why the feed's limit is a " +
    "statement about the log rather than a filter this fold applies", types.filter((t) => /chat/.test(t)));
}

console.log("[event-feed] PASS — the feed fold narrates only what happened and tells its empties apart " +
  "(J13). It is folded from `StreamManager.getLog()` on every render and holds no state of its " +
  "own, so a row survives exactly as long as the evidence for it does. THE DONE-WHEN WAS WRONG IN " +
  "BOTH HALVES AND BOTH ARE DRIVEN HERE: a feed can never start AT the floor, because the trim " +
  "keeps `l > floorL` strictly and the boundary event is already inside its own seed; and the " +
  "empty feed is reachable and CORRECT, because a room that seals at its head holds zero rows " +
  "while still deriving a live now-playing from the checkpoint. What a forgotten room owes is the " +
  "explanation, not fabricated rows — and the three origins are told apart by state surviving " +
  "where evidence did not, read from `getLog()` and `getState()` rather than from a backend " +
  "private a swapped backend need not have. A refused event is COUNTED and never narrated, driven " +
  "at one kind from two senders with legality the only difference, because the log holds what the " +
  "reducer rejected and a feed listing it would name an act nobody performed. (The Feed PANEL left " +
  "at ddjp_425; its rows now render between chat messages and `check-chat-view` drives that.) And " +
  "every type the reducer handles is DECIDED " +
  "about — named with a verb or excluded with a reason — so a new event type fails this guard " +
  "rather than inheriting an answer nobody chose (" + asserts + " assertions)");
