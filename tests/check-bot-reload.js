// tests/check-bot-reload.js
// SUBJECT: features/botruntime.js, backends/backend2/authority.js, backends/backend2/streammanager.js
// WALL: THE BOT TAB RELOADS ITSELF AT MOST ONCE A DAY, AND ONLY AT A QUIET MOMENT (J73 job 8, owner).
//   The library keeps every event it is given and is left alone (probe-j73-sdk-memory), so the bot tab reloads
//   itself once it has been up a day — never while a song is changing, never with acts committed but unsent,
//   never with an AFK warning outstanding. Its cost (requests sent during it are not replayed; an act with a
//   retry gets through, one without is lost) is why the moment must be quiet.
//   PART A — up a day and quiet, it reloads — once.         PART B — up less than a day, it does not.
//   PART C — not while a song has just changed or is about to.   PART D — not with acts committed but unsent.
//   PART E — not with an AFK warning outstanding, presence or queue — each raised by the bot's real passes.
//   PART F — song history is stored before it reloads.      PART G — the unsent count is the bot door's own.
//   PART H — the bot's own tick asks.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-reload] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[bot-reload] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, T = 1000 * HOUR;
const act = (id, who, ts, type) => ({ eventId: id, sender: who, ts: ts, type: type, content: { t: type } });
function bot(o) {
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const settings = Object.assign(sd.StateDeriver.defaultSettings(), { botAfkMs: 10 * MIN, botPresenceChat: false, queueIdleMs: 15 * MIN, botPingMs: 5 * MIN }, o.settings || {});
  const w = { now: T, np: null, advance: null, unsent: 0, rotation: o.rotation || [], calls: [], intervals: [] };
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "features/room.js", "features/botruntime.js"], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval: (fn) => { w.intervals.push(fn); return w.intervals.length; }, clearInterval: () => {},
    window: {}, document: { body: { appendChild() {} }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: { getLog: () => o.log || [], isLegal: () => true, on() {}, unsentCount: () => w.unsent, rotationEntries: () => o.entries || [],
      getState: () => ({ settings: settings, rotation: w.rotation, nowPlaying: w.np, advance: w.advance }) },
    MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
      getRoster: () => ["@bot:hs"].concat(o.members || []).map((u) => ({ userId: u, level: u === "@bot:hs" ? 99 : 0 })),
      joinedMembersOf: () => ["@bot:hs"].concat(o.members || []), invitedMembersOf: () => [],
      inviteToPresence: () => Promise.resolve({ ok: true }), removeFromPresence: () => Promise.resolve({ ok: true }),
      persistHistoryNow: () => { w.calls.push("persist"); } },
    ServerClock: { serverNow: () => w.now }, Chat: { send: () => Promise.resolve({ ok: true }), sendTo: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() } });
  // A main chat, so a queue warning is DELIVERED: an undelivered one is not outstanding, and the bot clears its mark
  // (a first draft had none, so the queue row measured nothing).
  sb.Room.chatTiers = () => ({ mainId: "!main:hs", tiers: [] });
  const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!presence:hs" } });
  sb.BotRuntime._setReloadForTest(() => { w.calls.push("reload"); });
  return { sb, w, started, B: sb.BotRuntime };
}
const dayLater = (b) => { b.B.maybeDailyReload(b.w.now); b.w.now += DAY + MIN; };   // the first call marks the page's start
// ── A, B ────────────────────────────────────────────────────────────────────────────────────
{
  const b = bot({});
  ok(b.started && b.started.ok === true, "PREMISE — the real bot runtime started", b.started);
  b.B.maybeDailyReload(b.w.now); b.w.now += DAY - MIN;
  ok(b.B.maybeDailyReload(b.w.now).reason === "not-a-day" && b.w.calls.indexOf("reload") < 0, "B: up less than a day, it does not reload");
  b.w.now += 2 * MIN;
  const r = b.B.maybeDailyReload(b.w.now);
  ok(r.reloaded === true && b.w.calls.filter((c) => c === "reload").length === 1, "A: up a day with nothing playing — a quiet moment — it reloads", r);
  ok(b.B.maybeDailyReload(b.w.now + MIN).reloaded === false && b.w.calls.filter((c) => c === "reload").length === 1, "A: and only once — a reload under way is not started again");
  // ── F ──
  ok(b.w.calls.indexOf("persist") >= 0 && b.w.calls.indexOf("persist") < b.w.calls.indexOf("reload"), "F: song history is stored before the reload", b.w.calls);
}
// ── C ───────────────────────────────────────────────────────────────────────────────────────
{
  const b = bot({}); dayLater(b);
  b.w.np = { pi: "$p", dj: "@d:hs", song: { videoId: "v" }, startedAt: b.w.now - 10000 }; b.w.advance = { earliestAt: b.w.now + 5 * MIN };
  ok(b.B.maybeDailyReload(b.w.now).reason === "song-just-changed", "C: not while a song has just changed", b.B.quietMoment(b.w.now));
  b.w.np.startedAt = b.w.now - 2 * MIN; b.w.advance = { earliestAt: b.w.now + 30000 };
  ok(b.B.maybeDailyReload(b.w.now).reason === "song-about-to-change", "C: not while a song is about to change", b.B.quietMoment(b.w.now));
  b.w.advance = { earliestAt: b.w.now + 5 * MIN };
  ok(b.B.maybeDailyReload(b.w.now).reloaded === true, "C CONTROL: mid-song, settled and not near its change, it reloads", b.w.calls);
}
// ── D ───────────────────────────────────────────────────────────────────────────────────────
{
  const b = bot({}); dayLater(b); b.w.unsent = 2;
  ok(b.B.maybeDailyReload(b.w.now).reason === "unsent-acts", "D: not with acts committed but unsent — they would be lost");
  b.w.unsent = 0;
  ok(b.B.maybeDailyReload(b.w.now).reloaded === true, "D CONTROL: once they are sent, it reloads");
}
// ── E — warnings raised by the bot's own passes ─────────────────────────────────────────────
{
  const b = bot({ log: [act("$1", "@out:hs", T - 90 * MIN, "ddjp.dj.join")], members: ["@out:hs"] });
  const r = b.B.reconcilePresence();
  ok(r.ok === true && r.warned.indexOf("@out:hs") >= 0, "E PREMISE — the real presence pass warned someone", r);
  dayLater(b);
  ok(b.B.maybeDailyReload(b.w.now).reason === "presence-warning-outstanding", "E: not with a presence warning outstanding", b.B.quietMoment(b.w.now));
}
// ── G — the unsent count is the bot door's own ──────────────────────────────────────────────
{
  const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
  const sb = loadInContext(B1F.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "backends/backend2/authority.js"]), {});
  ok(sb.B2StreamManager.unsentCount() === 0, "G PREMISE — nothing committed yet");
  sb.B2Authority.submit(sb.B2Authority.stamp({ t: "ddjp.dj.vote", p: "$x" }, "@v:hs", 10, "$src", null));
  ok(sb.B2StreamManager.unsentCount() === 1, "G: an act the bot has committed to but not sent is counted by the bot door", sb.B2StreamManager.unsentCount());
  sb.B2Authority.reset();
  ok(sb.B2StreamManager.unsentCount() === 0, "G CONTROL: once nothing is waiting, it is zero");
}
// ── H — the bot's own tick asks ─────────────────────────────────────────────────────────────
{
  const b = bot({});
  ok(b.w.intervals.length > 0, "H PREMISE — the bot set its sweep tick");
  b.w.intervals.forEach((fn) => fn()); b.w.now += DAY + MIN; b.w.intervals.forEach((fn) => fn());
  ok(b.w.calls.indexOf("reload") >= 0, "H: the bot's own tick makes the check — a day up and quiet, the tab reloads", b.w.calls);
}
(async () => {
{
  // botQueueChat off: this harness never starts a chat watch, and with chat counted the pass would rightly say it
  // cannot tell and skip (a first draft did, and so measured no warning at all).
  const b = bot({ settings: { botQueueChat: false }, log: [act("$1", "@slow:hs", T - 2 * HOUR, "ddjp.dj.join")], rotation: [{ user: "@slow:hs", pending: [{ videoId: "vvvvvvvvvvv" }] }],
                  entries: [{ user: "@slow:hs", at: T - 2 * HOUR }] });
  const r = b.B.sweepIdle();
  ok(r.ok === true && r.warned.indexOf("@slow:hs") >= 0, "E PREMISE — the real queue pass warned someone", r);
  // The queue pass marks a warning outstanding once the warning is DELIVERED (`settled`), unlike the presence pass.
  await Promise.resolve(r.settled);
  dayLater(b);
  ok(b.B.maybeDailyReload(b.w.now).reason === "queue-warning-outstanding", "E: not with a queue warning outstanding", b.B.quietMoment(b.w.now));
}
})().then(done, (e) => { failed++; console.log("[bot-reload] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[bot-reload] " + failed + " failure(s)"); process.exit(1); }
console.log("[bot-reload] PASS — the bot tab reloads itself at most once a day and only at a quiet moment (J73 job 8): not under a " +
  "day, not while a song has just changed or is about to, not with acts committed but unsent, not with a presence or a queue " +
  "warning outstanding; history is stored first, the unsent count is the bot door's own, and the bot's tick asks (" + asserts + " assertions)");
  process.exit(0);
}
