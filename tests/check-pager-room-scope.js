// tests/check-pager-room-scope.js
//
// THE REACH-BACK PAGER MUST STAY INSIDE THE ROOM.
//
// `pageRange` is how anything reaches further back than the live log goes — history's backfill and
// the settings-proof read-back both go through it. It selected the channels to page by NAME:
// anything called `events-…`, `checkpoints-…` or `settings-…`. Every DDJP room names its channels
// exactly that way, so a client that has ever joined a second room paged BOTH of them and returned
// the union, interleaved by position.
//
// WHAT THAT DOES, and it is not a partial answer — it is a wrong one. A play's videoId is not in
// its body; it is whatever the reducer pops from the head DJ's buffer, so history exists only by
// FOLDING. Fold two rooms' logs together and every play names a parent that belongs to the other
// room's chain: the advance lock refuses them, and the result is a handful of entries rather than
// the room's history. The pane looks like it "did not load far enough". It loaded a mixture.
//
// The ingest door already refuses foreign rooms — one room at a time is a stated rule of this
// system. The door was scoped and the pager was not, which is this codebase's recurring shape: a
// rule reached by one of the paths that needed it.
//
// GUARANTEES:
//   PART A — SCOPED. With a room active, only that room's channels are paged.
//   PART B — NO SCOPE, NOTHING PAGED. Before a room is entered the pager returns empty rather than
//     ranging over every channel it can see. Fail-closed: an unscoped read is the bug above.
//   PART C — THE POSITION WINDOW STILL APPLIES. Scoping must not quietly widen or narrow the
//     [fromL, toL] range that callers rely on.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[pager-room-scope] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

// Two DDJP rooms, each with an identically-named events channel — which is the normal case, not a
// contrived one: every room this app creates names its channels the same way.
function fakeRoom(roomId, name, events) {
  return {
    roomId: roomId, name: name,
    timeline: events.map((e) => ({ event: e })),
    findEventById: () => null,
  };
}
function ev(roomId, l, id) {
  return {
    event_id: id, type: "m.room.message", sender: "@a:hs", room_id: roomId,
    origin_server_ts: 1000 + l,
    content: { body: JSON.stringify({ l: l, t: "ddjp.dj.play", p: null }) },
  };
}

const HOME = "!home:hs", FOREIGN = "!foreign:hs";
const homeEvents = [ev(HOME, 1, "$h1"), ev(HOME, 2, "$h2"), ev(HOME, 3, "$h3")];
const foreignEvents = [ev(FOREIGN, 1, "$f1"), ev(FOREIGN, 2, "$f2")];

function bridge() {
  const sb = loadInContext([
    "core/logger.js", "core/storageio.js", "core/idb.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
  ], {
    Date: Date, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined,
    matrixcs: {}, navigator: {},
  });
  sb.MatrixBridge._setClientForTest({
    getRooms: () => [
      fakeRoom(HOME, "events-owner", homeEvents),
      fakeRoom(FOREIGN, "events-owner", foreignEvents),
    ],
    scrollback: async () => {},
  });
  return sb.MatrixBridge;
}

// ── PART A — scoped to the active room ────────────────────────────────────────────────────────
(async () => {
  const MB = bridge();
  if (!MB._setClientForTest) {
    failures++;
    console.log("[pager-room-scope] FAIL — no seam to hand the pager a client, so this can only be "
      + "asserted as source text. The rule lives in an SDK-facing function; a text check cannot "
      + "show which rooms it actually ranges over.");
    return;
  }
  MB.setRoomScope({ events: HOME });
  const out = await MB.pageRange(0, 99);
  const rooms = Array.from(new Set(out.map((e) => e.roomId || (e.raw && e.raw.room_id))));
  ok(out.length > 0, "A: the pager returns the home room's events (the control)", out.length);
  ok(!out.some((e) => String(e.eventId).indexOf("$f") === 0),
    "A: APPLIED — no event from the OTHER room comes back. Selected by channel NAME, both rooms "
    + "matched — every DDJP room names its channels the same way — and the two logs were returned "
    + "interleaved by position. Folding that mixture makes every play name a parent from the other "
    + "room's chain, the advance lock refuses them, and the history pane shows a handful of entries "
    + "instead of the room's history", out.map((e) => e.eventId));
  ok(rooms.length <= 1, "A: everything returned belongs to one room", rooms);
})();

// ── PART B — no scope, nothing paged ──────────────────────────────────────────────────────────
(async () => {
  const MB = bridge();
  MB.clearRoomScope();
  const out = await MB.pageRange(0, 99);
  ok(Array.isArray(out) && out.length === 0,
    "B: APPLIED — with no room entered the pager returns NOTHING rather than ranging over every "
    + "channel it can see. Fail-closed is the only safe default here: an unscoped read is exactly "
    + "the mixture above, and it arrives silently as 'fewer entries' rather than as an error", out);
})();

// ── PART C — the position window still applies ────────────────────────────────────────────────
(async () => {
  const MB = bridge();
  MB.setRoomScope({ events: HOME });
  const out = await MB.pageRange(2, 3);
  ok(out.every((e) => e.l >= 2 && e.l <= 3),
    "C: scoping did not widen the [fromL, toL] window callers page against", out.map((e) => e.l));
  ok(out.length === 2, "C: and it did not narrow it either", out.length);
})();

setTimeout(() => {
  if (failures) process.exit(1);
  console.log("[pager-room-scope] PASS — reaching further back than the live log stays inside the "
    + "room: channels are selected by the active room scope rather than by a name every DDJP room "
    + "shares, so a client that has joined more than one room no longer folds two histories "
    + "together and shows the wreckage as a short list; an unscoped pager returns nothing rather "
    + "than everything; and the position window callers rely on is unchanged");
}, 60);
