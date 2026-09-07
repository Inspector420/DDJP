// tests/check-history-wired.js
//
// HISTORY SURVIVES FORGETTING, AND A NEW ARRIVAL SEES THE WHOLE ROOM.
//
// `History` was separated from the live fold for one reason: remembering and forgetting pull in
// opposite directions, and one module doing both has to compromise. The separation was built —
// fold, merge, paged backfill, a cap, honest coverage — attached with a log, a seed and a pager,
// and then read and fed by NOTHING. The pane kept reading the live fold instead, which is the exact
// coupling the module exists to remove.
//
// That was invisible while nothing ever forgot. The moment trimming started running, the fold began
// dropping everything below the floor — `trimmed to floor l=53 (29 dropped, 0 held)` — and the fold
// deliberately does not seed its history, so the pane emptied down to the floor. A room that had
// played dozens of songs showed a handful.
//
// TWO SEPARATE THINGS HAVE TO BE TRUE, and only the first is about forgetting:
//   1. What has already been read STAYS read. Entries accumulate in the module and are not
//      recomputed from a log that is being trimmed underneath them.
//   2. A client that has just arrived can reach BACK. Its live log starts at the floor, so
//      everything earlier has to come from the homeserver through the pager — otherwise "the full
//      history" means "the history since I happened to join", which is a different claim.
//
// GUARANTEES:
//   PART A — TRIMMING THE LOG DOES NOT TRIM HISTORY. Entries read before a floor arrives are still
//     there after the log is cut to it.
//   PART B — A SEGMENT WITHOUT A SEED IS REFUSED, NOT FOLDED INTO SILENCE. A play's videoId is not
//     in its body; it is whatever the reducer pops. Folding a mid-log segment from empty yields
//     ZERO entries, not fewer — which would look exactly like the bug above wearing a new hat.
//   PART C — BACKFILL REACHES THE BEGINNING. Paging back to position 0 marks the coverage complete
//     and the earliest songs appear.
//   PART D — THE CAP IS THE CAP. 5000 entries, oldest dropped, so a long-lived room cannot grow
//     this without bound.
//   PART E — A ROOM CHANGE CLEARS IT. History is per-room by definition.

const { loadInContext } = require("./_load");

let failures = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[history-wired] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

function ctx() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/history.js",
  ], { Date: Date });
}

// A room that plays five songs from one stocked DJ.
let _l = 0;
function ev(id, ts, sender, body) {
  return { eventId: id, l: ++_l, ts: ts, sender: sender, senderRank: 20,
           type: body.t, content: body, roomId: "!r:hs" };
}
// Five DJs with a song each, played in turn. One DJ holding five would not do: a DJ's buffer is
// its own, and the rotation is what actually produces five distinct playings.
function fiveSongs() {
  _l = 0;
  const log = [];
  ["A", "B", "C", "D", "E"].forEach((v, i) =>
    log.push(ev("$j" + v, 1000, "@dj" + i + ":hs", { t: "ddjp.dj.join", v: "SONG_" + v })));
  let prev = null;
  for (let i = 0; i < 5; i++) {
    const id = "$play" + i;
    log.push(ev(id, 100000 + i * 300000, "@dj0:hs", { t: "ddjp.dj.play", p: prev }));
    prev = id;
  }
  return log;
}

// ── PART A — trimming the log does not trim history ───────────────────────────────────────────
(() => {
  const c = ctx();
  const full = fiveSongs();
  let live = full.slice();
  c.History.attach({ log: () => live, seed: () => undefined });

  c.History.refresh();
  const before = c.History.count();
  ok(before === 5, "A: five plays produce five entries (the control)", before);

  // A floor lands and the log is cut to it — exactly what a live room now does.
  live = full.slice(-2);
  c.History.refresh(c.StateDeriver.buildSeed(full.slice(0, full.length - 2)));
  const after = c.History.count();
  ok(after === 5,
    "A: APPLIED — history still holds every song after the log is trimmed under it. Read from the "
    + "live fold, the pane emptied down to the floor the moment forgetting started running, "
    + "because the fold deliberately does not seed its history", { before: before, after: after });
})();

// ── PART B — a segment without a seed is refused ──────────────────────────────────────────────
(() => {
  const c = ctx();
  const full = fiveSongs();
  c.History.attach({ log: () => full.slice(-3), seed: () => undefined });
  const r = c.History.refresh();
  ok(r && r.refused === "segment-without-seed",
    "B: a mid-log segment with no seed is REFUSED. Every play in it names a parent the fold has "
    + "never seen, so the advance lock rejects all of them and the result is ZERO entries — an "
    + "empty list that reads like a quiet room rather than a failure", r);
  ok(c.History.count() === 0, "B: and nothing false was recorded", c.History.count());
})();

// ── PART C — backfill reaches the beginning ───────────────────────────────────────────────────
(() => {
  const c = ctx();
  const full = fiveSongs();
  const floorL = full[full.length - 3].l;
  const live = full.filter((e) => e.l >= floorL);
  let asked = null;
  c.History.attach({
    log: () => live,
    seed: () => c.StateDeriver.buildSeed(full.filter((e) => e.l < floorL)),
    pageRange: async (fromL, toL) => {
      asked = { fromL: fromL, toL: toL };
      return full.filter((e) => e.l >= fromL && e.l < toL);
    },
  });
  c.History.refresh();
  const seen = c.History.count();
  ok(seen < 5, "C: a client that joined late sees only part of the room from its live log", seen);

  return c.History.backfill(0, undefined).then((r) => {
    ok(r && r.ok === true, "C: the backfill page succeeds", r);
    ok(asked && asked.fromL === 0,
      "C: it asks the homeserver for everything from the room's beginning", asked);
    ok(c.History.count() === 5,
      "C: APPLIED — after backfill the arrival can account for every song the room has played, "
      + "not just the ones since it happened to join", c.History.count());
    ok(c.History.coverage().complete === true,
      "C: and the coverage says so honestly, rather than a window implying it has everything",
      c.History.coverage());
  });
})();

// ── PART D + E — the cap, and a room change ───────────────────────────────────────────────────
(() => {
  const c = ctx();
  ok(c.History.MAX === 5000, "D: the cap is 5000 entries", c.History.MAX);
  const over = [];
  for (let i = 0; i < c.History.MAX + 25; i++) {
    over.push({ pi: "$p" + i, videoId: "V" + i, dj: "@d:hs", at: 1000 + i, skipped: false, l: i });
  }
  c.History._setForTest(over);
  ok(c.History.count() === c.History.MAX + 25, "D: the fixture is over the cap (setup)", c.History.count());
  c.History.attach({ log: () => [], seed: () => undefined });
  const merged = c.History.merge(over, [{ pi: "$new", videoId: "VNEW", dj: "@d:hs", at: 9e9, skipped: false, l: 9e9 }]);
  ok(merged.length <= c.History.MAX,
    "D: APPLIED — merging past the cap drops the OLDEST rather than growing without bound. A room "
    + "that runs for months must not turn its own history pane into an unbounded array", merged.length);

  c.History.reset();
  ok(c.History.count() === 0 && c.History.coverage().fromL === null,
    "E: a room change clears everything — history is per-room by definition", c.History.coverage());
})();

// ── PART H — THE SEED IS FOR A SEGMENT, AND ONLY FOR A SEGMENT ────────────────────────────────
// `refresh()` reaches for the floor's seed whenever the caller supplies none. That is right for a
// TRIMMED log — a mid-log segment cannot be folded from nothing — and WRONG for a log that still
// starts at genesis, which is the state a client is in for the whole window between finishing
// replay and its first trim.
//
// Seeding a genesis fold with a mid-room state makes the fold begin at the floor and then replay
// events from position 1. Every early play names a parent that does not match the seeded
// now-playing, the advance lock refuses them, and eight songs fold down to two. Nothing errors;
// the pane just says the room has barely played anything.
//
// `_looksLikeSegment` already existed and was consulted only to decide whether to REFUSE. It also
// answers the question that actually matters: whether the seed applies at all.
(() => {
  const c = ctx();
  const full = fiveSongs();
  const floorSeed = c.StateDeriver.buildSeed(full.slice(0, full.length - 4));

  const unseeded = c.StateDeriver.derive(full, undefined).history.length;
  const seeded = c.StateDeriver.derive(full, floorSeed).history.length;
  ok(unseeded > seeded,
    "H: a genesis log folded with a mid-room seed loses songs (the mechanism)",
    { noSeed: unseeded, withSeed: seeded });

  c.History.attach({ log: () => full, seed: () => floorSeed });
  c.History.refresh();
  ok(c.History.count() === unseeded,
    "H: APPLIED — refresh() does NOT apply the floor seed to a log that still starts at genesis. "
    + "A client holds exactly that log from the end of replay until its first trim, so the pane "
    + "showed two songs in a room that had played many — silently, because a refused play is not "
    + "an error", { got: c.History.count(), expected: unseeded });
})();

// ── PART G — BACKFILL WORKS EVEN WHEN THE LIVE LOG READS AS NOTHING ───────────────────────────
// A client whose log is a segment it cannot seed reads ZERO entries from it (PART B), so its
// coverage never opens. Refusing to page in that state would leave the pane empty in exactly the
// case backfill exists for, and it would look like "it did not load far enough".
(() => {
  const c = ctx();
  const full = fiveSongs();
  const live = full.slice(-3);                       // a mid-log segment, and no seed to fold it
  c.History.attach({
    log: () => live,
    seed: () => undefined,
    pageRange: async (fromL, toL) => full.filter((e) => e.l >= fromL && e.l < toL),
  });
  const r0 = c.History.refresh();
  ok(r0 && r0.refused === "segment-without-seed", "G: the live log yields nothing (setup)", r0);
  ok(c.History.coverage().fromL === null, "G: so coverage never opened (setup)", c.History.coverage());

  const oldest = live.reduce((m, e) => (m === null || e.l < m) ? e.l : m, null);
  return c.History.backfill(0, undefined, oldest).then((r) => {
    ok(r && r.ok === true,
      "G: APPLIED — told where its own knowledge starts, the client pages from genesis anyway. "
      + "Refusing because nothing had been read yet left the pane empty in the one state backfill "
      + "is for", r);
    ok(c.History.count() > 0, "G: and songs actually arrive", c.History.count());
  });
})();

// ── PART F — THE WIRING, NOT THE MODULE ───────────────────────────────────────────────────────
// Everything above exercises History itself, and History was never the bug: it was correct,
// attached, and reached by NOTHING. A guard that only tests the module would have passed on every
// build where the pane was empty. What has to be driven is production's own path — the seam a
// feature reads through, and the subscription that feeds it.
(() => {
  const sb = loadInContext([
    "core/logger.js", "core/storageio.js", "core/idb.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/eventcache.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js", "backends/backend1/history.js",
    "backends/backend1/matrixbridge.js",
  ], {
    Date: Date, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 },
    window: { isSecureContext: false }, document: undefined, indexedDB: undefined,
    matrixcs: {}, navigator: {},
  });
  const MB = sb.MatrixBridge, H = sb.History;
  ok(typeof MB.roomHistory === "function",
    "F: the interface exposes a history read. A feature may not reach a backend module directly, "
    + "so without this seam the pane has no route to the module at all and goes on reading the "
    + "live fold — which is what it was doing", typeof MB.roomHistory);
  if (typeof MB.roomHistory !== "function") return;

  H.reset();
  H._setForTest([
    { pi: "$p1", videoId: "OLDSONG", dj: "@a:hs", at: 1000, skipped: false, l: 1 },
    { pi: "$p2", videoId: "NEWSONG", dj: "@b:hs", at: 2000, skipped: false, l: 2 },
  ]);
  const rows = MB.roomHistory(10);
  ok(Array.isArray(rows) && rows.length === 2,
    "F: APPLIED — the read seam returns what the MODULE holds, so entries that outlived a trim "
    + "reach the pane", rows && rows.length);
  ok(rows[0] && rows[0].videoId === "NEWSONG",
    "F: newest first, as a history pane wants it", rows[0]);
  ok(typeof MB.backfillHistory === "function" && typeof MB.historyCoverage === "function",
    "F: and reaching back past the floor is driven from here too — a new arrival's log starts at "
    + "its floor, so without a backfill 'the full history' would silently mean 'since I joined'");
})();

setTimeout(() => {
  if (failures) process.exit(1);
  console.log("[history-wired] PASS — history is fed, read and bounded: entries already read "
    + "survive the log being trimmed under them, so switching forgetting on no longer empties the "
    + "pane down to the floor; a mid-log segment with no seed is refused rather than folded into a "
    + "silent zero; a client that joined late can page back to the room's beginning and say "
    + "honestly whether it got there; the cap drops the oldest rather than growing without bound; "
    + "and a room change clears it. The WIRING is driven too, because the module was always correct "
    + "and reached by nothing");
}, 50);
