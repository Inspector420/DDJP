// tests/check-repeat-cooldown.js
// WALL: A SONG THAT PLAYED INSIDE THE ROOM'S COOLDOWN IS SKIPPED WHEN IT COMES UP AND CANNOT BE
//       QUEUED — AND NEITHER HALF EVER ACTS ON A HISTORY IT CANNOT SEE FAR ENOUGH BACK IN.
//
// ── WHY THE REDUCER DOES NOT ENFORCE THIS ───────────────────────────────────────────────────
// "Has this song played recently" is answered from the play-log, whose REACH is bounded by what
// each client still holds. A trimmed client and a fresh one legitimately give different answers, so
// a fold that judged an advance on it would have two honest clients accepting different events —
// the divergence the checkpoint seed exists to prevent, and the one that reverted the `_joining`
// projection at v344. Sealing a play-log into the seed instead would grow it with the cooldown
// window, against a format whose size is meant to track people and songs currently relevant.
//
// So the setting is ROOM TRUTH and the enforcement is a BOT DECISION, published as an ordinary
// skip every client folds identically. That is the same split `botAfkMs` already has, and this
// file drives both ends of it.
//
// ── THE THREE THINGS THAT WOULD SILENTLY BREAK IT ───────────────────────────────────────────
// PART B — a song is in the history the moment it STARTS, so read naively every song is a repeat
//          of itself and the room skips everything.
// PART C — a repeat-skip pushes a fresh play, so without the `repeat` tag the clock restarts on
//          every attempt and a song people keep queuing becomes permanently unplayable.
// PART D — a short history reach must never read as "definitely a repeat", or the rotation empties
//          after every trim. The same rule and direction as `idleFor`'s `known: false`.

const { loadInContext } = require("./_load");

let asserts = 0;
let failed = false;
function fail(msg, got) {
  failed = true;
  console.log("[repeat-cooldown] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const MIN = 60000;
const T = 10 * 60 * MIN;   // "now", far enough in that ages are expressible

const ev = (id, l, ts, type, content, rank) => ({
  eventId: id, l: l, ts: ts, type: type, content: content,
  sender: "@a:hs", senderRank: (rank === undefined ? 99 : rank),
});

// ═══ PART A — THE SETTING IS AN ORDINARY SETTING ═════════════════════════════════════════════
// Everything else here is behaviour. This part is the plumbing every other setting has, asserted
// through the modules that own it rather than by reading the panel.
{
  const c = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const d = c.StateDeriver.defaultSettings();
  ok(d.repeatCooldownMs === 0,
    "A: OFF in a new room. A non-zero default would change what every room already built does the "
    + "moment the key exists, without anybody opening the panel", d.repeatCooldownMs);

  const r = c.StateDeriver.SETTING_RANGES.repeatCooldownMs;
  ok(r && r.min === 0 && r.max === 30 * 24 * 60 * MIN && r.scale === 60000,
    "A: off, or a minute to a month, typed in minutes. `min: 0` IS the off value rather than a "
    + "degenerate one-second cooldown, so the panel's zero and the rule's zero are one number", r);

  ok(c.StateDeriver.applySettingsEvent(d, { repeatCooldownMs: r.max }).repeatCooldownMs === r.max,
    "A: the declared maximum FOLDS — a key the reducer defines but never merges is a value the "
    + "owner sets and the room discards");
  ok(c.StateDeriver.applySettingsEvent(d, { repeatCooldownMs: r.max + 1 }).repeatCooldownMs === 0,
    "A: and one past it is refused rather than clamped, like every other bound here");

  // DELEGABLE WITHOUT A LINE OF ITS OWN. The domain is derived from the key set at call time, so
  // this asserts the derivation rather than a list somebody remembered to extend.
  const dom = c.StateDeriver.SETTING_RANGES.botDelegation.keys();
  ok(dom.indexOf("repeatCooldownMs") >= 0,
    "A: and it is delegable, because the delegation domain is DERIVED from the key set", dom.length);
}

// ═══ PART B — A SONG IS NOT A REPEAT OF ITSELF ═══════════════════════════════════════════════
// The trap that would make the room skip every song. A history row is pushed when a song STARTS,
// which is measured here rather than assumed, and then the live playing is excluded by `pi`.
{
  const c = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const log = [
    ev("$1", 1, T - 90 * MIN, "ddjp.dj.join", { v: "AAAAAAAAAAA" }),
    ev("$2", 2, T - 89 * MIN, "ddjp.dj.declare", { v: "BBBBBBBBBBB" }),
    ev("$3", 3, T - 88 * MIN, "ddjp.dj.play", { p: null }),
    ev("$4", 4, T - 40 * MIN, "ddjp.dj.play", { p: "$3" }),
  ];
  const st = c.StateDeriver.derive(log, null);
  ok(st.nowPlaying && st.nowPlaying.pi === "$4",
    "B: APPLIED — the fixture reaches a second playing", st.nowPlaying);
  const live = st.history.filter((h) => h.pi === st.nowPlaying.pi);
  ok(live.length === 1,
    "B: THE MEASUREMENT THIS RULE TURNS ON — the CURRENTLY PLAYING song is already in the history, "
    + "because a row is pushed when a song starts rather than when it ends. Any reader that does "
    + "not exclude it calls every song a repeat of itself and the room skips everything",
    st.history);
  ok(st.history.length === 2 && st.history[0].pi === "$3",
    "B: and the finished playing is there too, ordered oldest-first", st.history);
}

// ═══ PART C — A REPEAT-SKIP IS NOT A PLAY ════════════════════════════════════════════════════
// Without the tag the feature eats itself: the skip pushes a fresh row, the clock restarts, and a
// song people keep queuing is blocked further into the future on every attempt.
{
  const c = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const log = [
    ev("$1", 1, T - 90 * MIN, "ddjp.dj.join", { v: "AAAAAAAAAAA" }),
    ev("$2", 2, T - 89 * MIN, "ddjp.dj.declare", { v: "BBBBBBBBBBB" }),
    // A THIRD SONG, AND ITS ABSENCE IS WHY A MUTATION SURVIVED. With two songs the unknown-token
    // skip below is the advance that empties the rotation, so it took `!head`'s own `continue` and
    // the marking was never reached — widening the token test to accept ANY string left this file
    // green. The fixture has to let the advance land for the row below to mean anything.
    ev("$2b", 3, T - 89 * MIN, "ddjp.dj.declare", { v: "CCCCCCCCCCC" }),
    ev("$3", 4, T - 88 * MIN, "ddjp.dj.play", { p: null }),
    ev("$4", 5, T - 40 * MIN, "ddjp.dj.skip", { p: "$3", k: "repeat" }),
    ev("$5", 6, T - 30 * MIN, "ddjp.dj.skip", { p: "$4", k: "not-a-real-token" }),
  ];
  const st = c.StateDeriver.derive(log, null);
  const first = st.history.filter((h) => h.pi === "$3")[0];
  ok(first && first.endedBy === "repeat",
    "C: a skip carrying `k: repeat` MARKS the row of the playing it ended, so the cooldown can "
    + "measure from the play that actually happened rather than from its own skip", first);

  const second = st.history.filter((h) => h.pi === "$4")[0];
  ok(second && second.endedBy === undefined,
    "C: an UNKNOWN token leaves the row unmarked — it degrades to an ordinary skip", second);

  const accepted = c.StateDeriver.deriveAccepted(log, null);
  // `deriveAccepted` answers an ARRAY of ids. Read through one helper so a shape change is a
  // failure here rather than a silently empty membership test — an empty accepted set is exactly
  // the plausible value that once disabled all vouching.
  const has = (id) => (accepted.has ? accepted.has(id)
    : (Array.isArray(accepted) ? accepted.indexOf(id) >= 0
      : Object.prototype.hasOwnProperty.call(accepted, id)));
  ok(has("$3") && has("$4"), "C: APPLIED — the accepted set is readable and holds the advances", accepted);
  ok(has("$5"),
    "C: AND THE UNKNOWN TOKEN DOES NOT REFUSE THE ADVANCE, which is deliberately the OPPOSITE of "
    + "`play.blocked`'s unknown reason. That token reaches a checkpoint seed and this one reaches "
    + "only the history, which nothing seals — and a skip is an ADVANCE, so refusing one over a "
    + "tag it did not understand is a freeze risk taken for a display-level fact", accepted);

  // AND THE MARKING RUNS EVEN WHEN THE SKIP EMPTIES THE ROOM. The marking is about the playing that
  // ENDED, not about whether another one begins — placed beside the new `nowPlaying` it never ran
  // on this path, and a repeat-skip of the last song left its row counting as a real play.
  const emptied = c.StateDeriver.derive([
    ev("$1", 1, T - 90 * MIN, "ddjp.dj.join", { v: "AAAAAAAAAAA" }),
    ev("$3", 2, T - 88 * MIN, "ddjp.dj.play", { p: null }),
    ev("$4", 3, T - 40 * MIN, "ddjp.dj.skip", { p: "$3", k: "repeat" }),
  ], null);
  ok(emptied.nowPlaying === null,
    "C: APPLIED — this fixture really does run the rotation dry", emptied.nowPlaying);
  ok(emptied.history[0] && emptied.history[0].endedBy === "repeat",
    "C: a repeat-skip that ends the LAST song still marks its row. Found by mutation, not by "
    + "reading: the marking sat below the next-song resolution, which takes its own `continue` "
    + "when nothing follows", emptied.history);

  // THE CONTROL: an untagged skip is the ordinary case and must stay unmarked, or the assertion
  // above would pass on a build that marked every row.
  const plain = c.StateDeriver.derive([
    ev("$1", 1, T - 90 * MIN, "ddjp.dj.join", { v: "AAAAAAAAAAA" }),
    ev("$2", 2, T - 89 * MIN, "ddjp.dj.declare", { v: "BBBBBBBBBBB" }),
    ev("$3", 3, T - 88 * MIN, "ddjp.dj.play", { p: null }),
    ev("$4", 4, T - 40 * MIN, "ddjp.dj.skip", { p: "$3" }),
  ], null);
  ok(plain.history[0] && plain.history[0].endedBy === undefined,
    "C CONTROL: a plain skip marks nothing, so the row above is the tag doing work", plain.history);
}

// ── THE READER, WITH THE HISTORY AND THE CLOCK INJECTED ──────────────────────────────────────
// `Room.playedWithin` reads the `History` module through the transport seam and `ServerClock` for
// the shared stamp. Both are stubbed, so the arithmetic is driven at explicit values — and the
// stubbing is stated rather than left to be discovered (see the note at the end).
function reader(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ChatPrefs: { chatTier: () => null, onChange() {} },
    Chat: { setReadableTiers() {}, setRoom() {}, onMessage() {}, init() {} },
    Store: { config: { saveRoom() {} } },
    ServerClock: { serverNow: () => (("now" in o) ? o.now : T) },
    StreamManager: {
      getLog: () => [],
      getState: () => ({ settings: Object.assign({ repeatCooldownMs: 0 }, o.settings || {}),
                         rotation: [], nowPlaying: ("np" in o) ? o.np : null }),
      isLegal: () => true, on() {},
    },
    // `Queue` is the feature seam `Room` reads the play-log through, exactly as production does.
    Queue: {
      recentHistory: () => (o.rows || []).slice().reverse(),   // the real one answers NEWEST FIRST
      historyReach: () => ({ complete: !!o.complete, entries: (o.rows || []).length, cap: 5000 }),
    },
    MatrixBridge: { getUserId: () => "@me:hs", getMyRank: () => 20, onRankChange() {}, onRoomsChanged() {},
                    getClient: () => null },
  });
  sb.Room._setCurrentForTest({ spaceId: "!s:hs", channels: { events_uncategorized: "!e0" } });
  return sb;
}
// Rows are given OLDEST FIRST here, the way the fold produces them, and the stub reverses — so a
// reader that assumed the wrong order would fail rather than accidentally agree.
const row = (videoId, at, pi, endedBy) => ({ videoId, at, pi: pi || ("$" + at), dj: "@a:hs",
                                             skipped: false, endedBy: endedBy });

// ═══ PART D — THE THREE ANSWERS, AND THE THIRD NEVER BLOCKS ══════════════════════════════════
{
  const OFF = reader({ rows: [row("AAAAAAAAAAA", T - 5 * MIN)], complete: true });
  ok(OFF.Room.playedWithin("AAAAAAAAAAA").blocked === false,
    "D: with the setting OFF nothing is ever blocked, whatever the history says",
    OFF.Room.playedWithin("AAAAAAAAAAA"));

  const S = { repeatCooldownMs: 60 * MIN };
  const inside = reader({ settings: S, complete: true, rows: [row("AAAAAAAAAAA", T - 30 * MIN)] });
  const v1 = inside.Room.playedWithin("AAAAAAAAAAA");
  ok(v1.blocked === true && v1.known === true && v1.reason === "played",
    "D: a song played inside the window is blocked", v1);
  ok(v1.at === T - 30 * MIN && v1.agoMs === 30 * MIN
     && v1.allowedAt === T + 30 * MIN && v1.waitMs === 30 * MIN,
    "D: AND IT RETURNS WHAT A SURFACE WOULD NEED TO EXPLAIN ITSELF — when it played, how long ago, "
    + "when it becomes allowed and how long that is — none of it formatted, because a feature that "
    + "returned a sentence is one the UI cannot re-word", v1);

  const outside = reader({ settings: S, complete: true, rows: [row("AAAAAAAAAAA", T - 61 * MIN)] });
  ok(outside.Room.playedWithin("AAAAAAAAAAA").blocked === false,
    "D: and one played outside it is not", outside.Room.playedWithin("AAAAAAAAAAA"));

  // THE BOUNDARY, both sides of it, because this is the comparison a mutation moves.
  const exact = reader({ settings: S, complete: true, rows: [row("AAAAAAAAAAA", T - 60 * MIN)] });
  ok(exact.Room.playedWithin("AAAAAAAAAAA").blocked === false,
    "D: exactly one cooldown later is ALLOWED — the window is how long it stays blocked, so the "
    + "moment it expires the song plays", exact.Room.playedWithin("AAAAAAAAAAA"));
  const justInside = reader({ settings: S, complete: true, rows: [row("AAAAAAAAAAA", T - 60 * MIN + 1)] });
  ok(justInside.Room.playedWithin("AAAAAAAAAAA").blocked === true,
    "D: and one millisecond short of it is not", justInside.Room.playedWithin("AAAAAAAAAAA"));

  // THE THIRD ANSWER. A history that does not reach back a full window cannot answer, and cannot
  // answering must never block — the same rule and direction as `idleFor`'s `known: false`.
  const short = reader({ settings: S, complete: false, rows: [row("BBBBBBBBBBB", T - 10 * MIN)] });
  const v2 = short.Room.playedWithin("AAAAAAAAAAA");
  ok(v2.known === false && v2.blocked === false && v2.reason === "short-reach",
    "D: a history reaching back 10 minutes CANNOT answer a 60-minute question, and says so rather "
    + "than answering. Blocking here would empty every queue after a trim", v2);

  // AND `complete` IS WHAT MAKES A YOUNG ROOM ANSWERABLE. Same short list, but the history reached
  // the room's beginning — so nothing found is a real answer rather than a shallow one.
  const young = reader({ settings: S, complete: true, rows: [row("BBBBBBBBBBB", T - 10 * MIN)] });
  const v3 = young.Room.playedWithin("AAAAAAAAAAA");
  ok(v3.known === true && v3.blocked === false && v3.reason === "not-played",
    "D CONTROL: with the same short list but the beginning REACHED, the answer is real — otherwise "
    + "the row above would be a reader that answers `short-reach` for everything", v3);

  // NO SHARED CLOCK IS NOT A REASON TO GUESS. Comparing a server stamp against `Date.now()` is
  // this project's second standing trap, so the absence of an offset is an answer.
  const noClock = reader({ settings: S, complete: true, now: 0, rows: [row("AAAAAAAAAAA", T - 5 * MIN)] });
  const v4 = noClock.Room.playedWithin("AAAAAAAAAAA");
  ok(v4.known === false && v4.blocked === false && v4.reason === "no-clock",
    "D: with no server clock it declines rather than falling back to the device clock", v4);
}

// ═══ PART E — THE LIVE PLAYING AND THE REPEAT-SKIP ARE BOTH EXCLUDED ═════════════════════════
// PARTs B and C established the two facts; this is the reader acting on them.
{
  const S = { repeatCooldownMs: 60 * MIN };
  const live = reader({
    settings: S, complete: true, np: { pi: "$live", song: { videoId: "AAAAAAAAAAA" } },
    rows: [row("AAAAAAAAAAA", T - 1 * MIN, "$live")],
  });
  ok(live.Room.playedWithin("AAAAAAAAAAA").blocked === false,
    "E: the song ON AIR is not a repeat of itself — its own row is excluded by `pi`. Without this "
    + "the bot skips every song a second after it starts", live.Room.playedWithin("AAAAAAAAAAA"));

  // AND THE SAME SONG PLAYED EARLIER STILL COUNTS, so the exclusion is one row rather than the
  // whole videoId — which is the mistake that would make the rule unenforceable.
  const both = reader({
    settings: S, complete: true, np: { pi: "$live", song: { videoId: "AAAAAAAAAAA" } },
    rows: [row("AAAAAAAAAAA", T - 20 * MIN, "$old"), row("AAAAAAAAAAA", T - 1 * MIN, "$live")],
  });
  ok(both.Room.playedWithin("AAAAAAAAAAA").blocked === true,
    "E: while an EARLIER playing of the same song still counts — the exclusion is one row, not the "
    + "video", both.Room.playedWithin("AAAAAAAAAAA"));

  // THE REPEAT-SKIP. A playing this rule already cut short is not evidence the song played.
  const cut = reader({
    settings: S, complete: true,
    rows: [row("AAAAAAAAAAA", T - 90 * MIN, "$real"), row("AAAAAAAAAAA", T - 5 * MIN, "$cut", "repeat")],
  });
  const v = cut.Room.playedWithin("AAAAAAAAAAA");
  ok(v.blocked === false && v.at === T - 90 * MIN,
    "E: a playing ENDED BY THE RULE ITSELF is not counted, so the clock still measures from the "
    + "real play 90 minutes ago rather than restarting on every attempt. Counting it makes a song "
    + "people keep queuing permanently unplayable", v);

  // THE CONTROL: the same two rows with the marker removed DO block, so the row above is the
  // marker doing work rather than a reader that ignores recent rows.
  const uncut = reader({
    settings: S, complete: true,
    rows: [row("AAAAAAAAAAA", T - 90 * MIN, "$real"), row("AAAAAAAAAAA", T - 5 * MIN, "$cut")],
  });
  ok(uncut.Room.playedWithin("AAAAAAAAAAA").blocked === true,
    "E CONTROL: unmarked, the same recent row blocks", uncut.Room.playedWithin("AAAAAAAAAAA"));
}

// ═══ PART F — THE ADD REFUSAL, AT THE ONE DOOR EVERY ROUTE USES ══════════════════════════════
// Typing a link, cloning one song and "add all" all arrive at `UserQueue.add`, so one refusal
// covers every route. Driven through the real `UserQueue`, with `Room` stubbed at the seam it
// actually calls — the refusal is what is under test here, not the reading.
{
  function queueTree(verdict) {
    const calls = { asked: [] };
    const sb = loadInContext(["core/logger.js", "core/playlistdoc.js", "features/userqueue.js"], {
      Date, Math, JSON, URL, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
      window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      Store: { queue: { load: () => Promise.resolve(null), save: () => Promise.resolve() } },
      StreamManager: { getState: () => ({ rotation: [], nowPlaying: null }), on() {} },
      MatrixBridge: { getUserId: () => "@me:hs", sendEvent: () => Promise.resolve() },
      Room: {
        canQueue: (v) => { calls.asked.push(v); return verdict(v); },
      },
    });
    return { sb, calls };
  }
  const ALLOW = () => ({ ok: true, code: null, reason: null, detail: null });
  const BLOCK = (v) => ({ ok: false, code: "repeat-cooldown", reason: "played too recently",
                          detail: { blocked: true, videoId: v, waitMs: 30 * MIN, allowedAt: T + 30 * MIN } });

  const t = queueTree(BLOCK);
  const r = t.sb.UserQueue.add("https://www.youtube.com/watch?v=AAAAAAAAAAA");
  ok(r.ok === false && r.code === "repeat-cooldown",
    "F: a blocked song is not added, and the refusal carries a CODE rather than only a sentence — "
    + "which is what lets a panel say more later without this file changing", r);
  ok(r.detail && r.detail.waitMs === 30 * MIN && r.videoId === "AAAAAAAAAAA",
    "F: and it carries the detail a surface would render, unformatted", r);
  ok(t.sb.UserQueue.count() === 0,
    "F: the queue is genuinely unchanged — a refusal that still added would be the worst of both",
    t.sb.UserQueue.count());
  ok(t.calls.asked.length === 1 && t.calls.asked[0] === "AAAAAAAAAAA",
    "F: APPLIED — and the video id reached the reader, so the row above is the gate rather than a "
    + "queue that refuses everything", t.calls.asked);

  const t2 = queueTree(ALLOW);
  const r2 = t2.sb.UserQueue.add("https://www.youtube.com/watch?v=AAAAAAAAAAA");
  ok(r2.ok === true && t2.sb.UserQueue.count() === 1,
    "F CONTROL: an allowed song is added normally", { r2, n: t2.sb.UserQueue.count() });

  // A BAD LINK IS STILL REFUSED FIRST, and now carries a code too — the older callers read
  // `reason` and are unaffected, which is why both fields exist.
  const t3 = queueTree(ALLOW);
  const r3 = t3.sb.UserQueue.add("not a link");
  ok(r3.ok === false && r3.code === "bad-link" && typeof r3.reason === "string",
    "F: the pre-existing refusals gained a code and KEPT their sentence, so the two panels that "
    + "render `reason` today are untouched", r3);
  ok(t3.calls.asked.length === 0,
    "F: and an unparseable link never reaches the reader — order matters, or a junk string would "
    + "be measured against the history", t3.calls.asked);
}

let PENDING = Promise.resolve();

// ═══ PART G — EVERY ROUTE IS THE SAME ROUTE ══════════════════════════════════════════════════
// The claim in PART F rests on `Playlists` reaching the queue only through `UserQueue.add`. That
// is asserted by DRIVING the playlist paths, not by reading the submit-path invariant.
{
  const added = [];
  const sb = loadInContext(["core/logger.js", "core/playlistdoc.js", "features/playlists.js"], {
    Date, Math, JSON, URL, setTimeout, clearTimeout,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Store: {
      playlists: {
        loadOne: () => Promise.resolve({ id: "p1", name: "P", tracks: [
          { videoId: "AAAAAAAAAAA" }, { videoId: "BBBBBBBBBBB" }, { videoId: "CCCCCCCCCCC" }] }),
        loadIndex: () => Promise.resolve(null), saveIndex: () => Promise.resolve(),
      },
    },
    UserQueue: {
      add: (url) => {
        added.push(url);
        if (url.indexOf("BBBBBBBBBBB") >= 0) {
          return { ok: false, code: "repeat-cooldown", reason: "played too recently",
                   detail: { waitMs: 5 * MIN } };
        }
        return { ok: true, videoId: "x" };
      },
    },
  });

  const one = sb.Playlists.cloneToQueue("BBBBBBBBBBB");
  ok(one.ok === false && one.code === "repeat-cooldown",
    "G: cloning ONE song from a playlist goes through the same door and inherits the refusal", one);
  ok(added.length === 1 && added[0].indexOf("watch?v=BBBBBBBBBBB") >= 0,
    "G: APPLIED — as a canonical watch URL, so a cloned song behaves exactly like a pasted link",
    added);

  // CHAINED, NOT RETURNED. This block used to end with `return sb.Playlists...` — and a top-level
  // `return` is legal in a CommonJS module, so it ENDED THE FILE. PART H below never executed and
  // seven mutations against it survived while this guard printed PASS, which is the vacuous green
  // this suite exists to refuse. Same family as the gate-on-the-last-line rule: the failure is
  // about POSITION and control flow, not about the assertions.
  PENDING = sb.Playlists.addWholeToQueue("p1").then((all) => {
    ok(all.ok === true && all.added === 2 && all.skipped === 1,
      "G: ADD ALL adds what it can and skips what it cannot — the tally keeps the shape the panel "
      + "renders today", all);
    ok(Array.isArray(all.refused) && all.refused.length === 1
       && all.refused[0].videoId === "BBBBBBBBBBB" && all.refused[0].code === "repeat-cooldown",
      "G: AND IT NAMES WHAT IT SKIPPED AND WHY. This is the only point in the flow where that "
      + "information exists; throwing it away here is what would make a future 'why was this "
      + "skipped' panel impossible without re-plumbing the whole path", all.refused);
    ok(all.refused[0].detail && all.refused[0].detail.waitMs === 5 * MIN,
      "G: carrying the same unformatted detail one add returns", all.refused[0]);
  });
}

// ═══ PART H — THE BOT ACTUALLY ACTS ══════════════════════════════════════════════════════════
// THIS PART EXISTS BECAUSE ITS ABSENCE WAS ONCE EXPLAINED AWAY HERE. The first edition of this file
// closed with a note saying the sweep could not be driven because reaching it needed the whole bot
// harness — which was untrue: the sweep simply was not EXPORTED, and the note documented a gap
// instead of closing it. Both its siblings are exported for exactly this reason.
function botTree(opts) {
  const o = opts || {};
  const calls = { skips: [], sent: [], lines: [] };
  let live = ("np" in o) ? o.np : null;
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      getLog: () => [], isLegal: () => true, on() {},
      // READ THROUGH A HOLDER so a part can advance the playing mid-test. Without this every
      // fixture reuses one `nowPlaying` and `pi` cannot be told from `videoId` anywhere in the file.
      getState: () => ({ settings: {}, rotation: [], nowPlaying: live }),
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99,
      getRoster: () => [], onRawEvent() {}, offRawEvent() {},
      joinedMembersOf: () => [], invitedMembersOf: () => [],
      mayAuthor: () => (("mayAuthor" in o) ? o.mayAuthor : true),
    },
    ServerClock: { serverNow: () => T },
    // `rankLadder` IS REQUIRED, and its absence is why the first draft of this part silently
    // ran against a runtime that had refused to start — `eligible` reads the ladder before it
    // compares anything, so a missing one refuses with `no-ladder` and every assertion below
    // reads `not-running`. The started-ness is asserted explicitly below rather than assumed.
    Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "guest", level: 10 }],
            playedWithin: () => o.verdict, chatTiers: () => ({ mainId: "!main" }) },
    Skip: o.noSkip ? undefined
      : { skip: (k) => { calls.skips.push(k); return Promise.resolve({ ok: true }); } },
    Chat: {
      sendTo: (id, text) => { calls.sent.push({ id, text }); return Promise.resolve({ ok: true }); },
      send: (text) => { calls.sent.push({ id: "ACTIVE-TIER", text }); return Promise.resolve({ ok: true }); },
    },
    Queue: { remove: () => Promise.resolve() },
  });
  sb.Logger.on((e) => calls.lines.push("[" + e.level + "] " + e.message));
  const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!p" } });
  // SAME SONG, NEW PLAYING — the one transition that tells a `pi` key from a `videoId` key.
  const np2 = () => { live = live ? { pi: live.pi + "b", song: live.song } : null; };
  return { sb, calls, started, np2 };
}
function partH() {
  const NP = { pi: "$live", song: { videoId: "AAAAAAAAAAA" } };
  const BLOCKED = { blocked: true, known: true, reason: "played", cooldownMs: 60 * MIN,
                    at: T - 12 * MIN, agoMs: 12 * MIN, allowedAt: T + 48 * MIN, waitMs: 48 * MIN };

  const t = botTree({ np: NP, verdict: BLOCKED });
  ok(t.started && t.started.ok === true,
    "H: APPLIED — the runtime actually STARTED. Without this every row below reads `not-running` "
    + "and passes nothing, which is how the first draft of this part reported green over a bot "
    + "that had refused to start", t.started);
  const r = t.sb.BotRuntime.sweepRepeat();
  ok(r.ok === true && r.reason === "skipping" && r.skipped === "AAAAAAAAAAA",
    "H: a blocked playing is skipped", r);
  ok(t.calls.skips.length === 1 && t.calls.skips[0] === "repeat",
    "H: AND THE SKIP CARRIES THE TAG. Untagged, it pushes a fresh play and restarts the very "
    + "clock it is enforcing — the whole reason the tag exists", t.calls.skips);

  // ONE ACT PER PLAYING. A tick that fires while the skip is in flight must not send a second.
  const again = t.sb.BotRuntime.sweepRepeat();
  ok(again.reason === "already-acted" && t.calls.skips.length === 1,
    "H: a second pass over the SAME playing sends nothing", { again, skips: t.calls.skips });

  return new Promise((res) => setImmediate(res)).then(() => {
    ok(t.calls.sent.length === 1 && t.calls.sent[0].id === "!main",
      "H: THE ANNOUNCEMENT GOES TO THE ROOM'S MAIN TIER, NOT THE ACTIVE ONE. The first draft "
      + "resolved `mainId` and then called `Chat.send`, which follows a device-local tab "
      + "preference — so one click on the bot's machine would have redirected every announcement "
      + "after it, possibly into the presence chat, which holds only the people who are around. "
      + "The stub records `ACTIVE-TIER` for that call, so the regression is visible rather than "
      + "silent", t.calls.sent);

    // NEVER ON IGNORANCE, and never while behind.
    const cannot = botTree({ np: NP, verdict: { blocked: false, known: false, reason: "short-reach" } });
    const rc = cannot.sb.BotRuntime.sweepRepeat();
    ok(rc.reason === "cannot-tell" && cannot.calls.skips.length === 0,
      "H: a reader that cannot answer produces no skip", { rc, skips: cannot.calls.skips });
    ok(cannot.calls.lines.some((l) => /cannot enforce it yet/.test(l)),
      "H: AND IT SAYS SO. A bot that can never answer does nothing forever and looks exactly like "
      + "a room where every song is fresh, while the owner who set the dial waits for an effect",
      cannot.calls.lines);

    const behind = botTree({ np: NP, verdict: BLOCKED, mayAuthor: false });
    ok(behind.sb.BotRuntime.sweepRepeat().reason === "not-live" && behind.calls.skips.length === 0,
      "H: and a bot that is not caught up authors nothing — asked through the interface, because a "
      + "feature may not reach `Session`", behind.calls.skips);

    const unwired = botTree({ np: NP, verdict: BLOCKED, noSkip: true });
    ok(unwired.sb.BotRuntime.sweepRepeat().reason === "no-skip-feature",
      "H: a missing skip feature is NAMED rather than thrown inside a tick that swallows — a "
      + "module loaded without its collaborator is this tree's own signature failure");

    // AND THE MEMORY IS ONE VALUE, NOT A GROWING SET. It answers "have I acted on the playing on
    // air right now", and there is only ever one of those — so it is bounded by construction
    // rather than by a cap or a TTL, neither of which has a number anybody could defend. It is
    // still cleared on `stop()`, because a value that outlived its room would answer for a
    // playing of a different one.
    const t2 = botTree({ np: NP, verdict: BLOCKED });
    t2.sb.BotRuntime.sweepRepeat();
    t2.sb.BotRuntime.stop();
    t2.sb.BotRuntime.start({ roomId: "!r2:hs", channels: { presence_chat: "!p" } });
    ok(t2.sb.BotRuntime.sweepRepeat().reason === "skipping",
      "H: after a stop the memory is empty, so the same playing is judged afresh rather than read "
      + "as already handled");

    // ── THE SAME SONG, A NEW PLAYING, STILL BLOCKED ──────────────────────────────────────
    // KEYED BY `pi`, NOT BY VIDEO ID, and the difference only shows here. Every other fixture in
    // this part reuses one `nowPlaying`, so `pi` and `videoId` are indistinguishable in them — and
    // a mutation swapping one for the other stayed GREEN across the whole file. The defect it
    // hides is not subtle: somebody re-queues a song the bot just skipped, it comes up again while
    // still inside the cooldown, and a videoId-keyed memory reads it as already handled and lets it
    // play in full. Driven by giving the second playing its own `pi`.
    const t4 = botTree({ np: NP, verdict: BLOCKED });
    t4.sb.BotRuntime.sweepRepeat();
    t4.np2();
    const second = t4.sb.BotRuntime.sweepRepeat();
    ok(second.reason === "skipping" && t4.calls.skips.length === 2,
      "H: the SAME SONG on a NEW playing is skipped again while it is still blocked — the memory "
      + "names the playing, not the video", { second, skips: t4.calls.skips });

    // AND A NEW PLAYING IS NEVER READ AS ALREADY HANDLED, which is the half a single value could
    // plausibly get wrong: overwritten by the newest, never accumulating.
    const t3 = botTree({ np: NP, verdict: BLOCKED });
    t3.sb.BotRuntime.sweepRepeat();
    ok(t3.sb.BotRuntime.sweepRepeat().reason === "already-acted",
      "H: APPLIED — the same playing is still remembered within one room");
  });
}

// THE GATE IS WHERE EVERY PATH ARRIVES, and both async parts are on ONE chain so neither can run
// after it. A part that resolves later than the gate is a part whose assertions are read by nobody.
PENDING.then(partH).then(finish).catch((e) => {
  console.log("[repeat-cooldown] FAIL — threw: " + (e && e.stack));
  process.exit(1);
});

function finish() {
  // ── WHAT THIS GUARD DOES NOT COVER, SAID PLAINLY ──────────────────────────────────────────
  // The WIRE from the tick to `sweepRepeat` is not driven: the interval callback has no name to
  // extract and nothing here renders a browser, so what is proved is that the sweep is right and
  // that it is reachable by name — not that the timer reaches it. That is README trap 1 and it is
  // stated rather than left to be discovered.
  //
  // `Queue.recentHistory`, `ServerClock` and `Room.canQueue` are STUBBED in their respective
  // parts, so mutating any of them in their own module leaves this file green.
  if (failed) process.exit(1);
  console.log("[repeat-cooldown] PASS — a song that played inside the room's cooldown is refused at "
    + "every door into a queue and skipped when it comes up, and neither half ever acts on a history "
    + "it cannot see far enough back in (" + asserts + " assertions). THE REDUCER DOES NOT ENFORCE "
    + "IT, deliberately: the play-log's reach is bounded per client, so a fold judging an advance on "
    + "it would have two honest clients accept different events — the divergence the checkpoint seed "
    + "exists to prevent. The setting is room truth and the enforcement is a bot decision published "
    + "as an ordinary skip, which is the split `botAfkMs` already has. Three traps are driven rather "
    + "than reasoned about: a row enters the history when a song STARTS, so the live playing is "
    + "excluded by `pi` or every song is a repeat of itself; a repeat-skip is TAGGED and not counted, "
    + "or the clock restarts on every attempt until a song people keep queuing is permanently "
    + "unplayable; and a short reach answers `known: false` and blocks NOTHING, because treating it "
    + "as maximal would empty every queue after a trim. Every refusal carries a CODE and unformatted "
    + "DETAIL beside the sentence today's panels render, so a surface can explain itself later "
    + "without this path changing. THE BOT'S SWEEP IS DRIVEN IN PART H, INCLUDING THE ANNOUNCEMENT'S TARGET — WHAT IS NOT COVERED IS THE TIMER THAT REACHES IT, AND THE FINAL NOTE SAYS SO.");
}
