// tests/check-reactions.js
// WALL: the now-playing ★ (save-to-playlist) and ▲ (upvote) reactions.
//
// Guarantees, all load-bearing for this feature:
//   PART A — emission + one-way-per-instance latch. vote()/recordSave() emit exactly one
//     spine event (ddjp.dj.vote / ddjp.dj.save) tagged with p = the current play-instance
//     id, are idempotent within an instance (a second press sends nothing), and go LIVE
//     again the moment the song changes (a new pi). Nothing playing → nothing sent.
//   PART B — DURABLE across reload. The latch is derived from MY OWN events on the spine,
//     so replaying history (as a reload does) repopulates it: a vote/save for the pi that
//     is STILL playing comes back pressed; the SAME video at a DIFFERENT (past) pi does
//     not; and another user's vote/save never lights my button.
//   PART C — NO consensus weight. The reducer has no branch for vote/save, so injecting
//     them into the log leaves derived state (nowPlaying/rotation/settings/history)
//     identical. This is what lets the annotations sit on the spine now and power
//     "user X voted/saved this song" later, with zero state-shape change today.

const assert = require("assert");
const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[reactions] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

// Compare an event body by keys+values only. The body is built inside the module's vm
// realm, so its prototype differs from a test-realm literal and deepStrictEqual would
// reject it on identity alone — key/value equality is what we actually mean here.
function sameContent(actual, expected, label) {
  const ak = Object.keys(actual || {}).sort();
  const ek = Object.keys(expected).sort();
  if (ak.length !== ek.length || ak.some((k, i) => k !== ek[i])) fail(label + " (keys differ)", actual);
  for (const k of ek) if (actual[k] !== expected[k]) fail(label + " (value of " + k + " differs)", actual);
}

// A controllable StreamManager + MatrixBridge pair. np is settable; on/off register
// subscribers; emit(entry) delivers an event to them (simulating live echo OR replay).
// sendEvent records outgoing events (the module also latches optimistically on send).
function harness(me) {
  let np = null;
  const subs = {};
  const sent = [];
  const StreamManager = {
    getState() { return { nowPlaying: np, rotation: [], settings: {} }; },
    on(t, fn) { (subs[t] = subs[t] || []).push(fn); },
    off(t, fn) { subs[t] = (subs[t] || []).filter((f) => f !== fn); },
  };
  const MatrixBridge = {
    getUserId() { return me; },
    async sendEvent(channel, type, content) { sent.push({ channel, type, content }); return { event_id: "$x" + sent.length }; },
  };
  const Logger = { info() {}, warn() {}, debug() {} };
  const emit = (type, sender, p) => {
    const entry = { type, sender, content: { p } };
    for (const fn of subs[type] || []) fn(entry);
  };
  return {
    StreamManager, MatrixBridge, Logger, sent, emit,
    setNp(pi, videoId) { np = pi == null ? null : { pi, song: { videoId: videoId || "V" } }; },
  };
}

// ---- PART A: emission + latch --------------------------------------------------
(() => {
  const h = harness("@me:hs");
  const sb = loadInContext(["features/reactions.js"], { StreamManager: h.StreamManager, MatrixBridge: h.MatrixBridge, Logger: h.Logger });
  const R = sb.Reactions;
  if (!R) fail("Reactions did not load");
  R.init("!ev:hs");

  h.setNp(null);
  R.vote();
  if (h.sent.length !== 0) fail("vote sent an event with nothing playing", h.sent);
  if (R.hasVoted() || R.hasSaved()) fail("latched with nothing playing");

  h.setNp("p1", "AAAAAAAAAAA");
  if (R.hasVoted()) fail("hasVoted true before voting");

  R.vote();
  if (h.sent.length !== 1) fail("first vote should send exactly one event", h.sent);
  assert.strictEqual(h.sent[0].type, "ddjp.dj.vote", "vote event type");
  assert.strictEqual(h.sent[0].channel, "!ev:hs", "vote on events channel");
  sameContent(h.sent[0].content, { p: "p1" }, "vote carries p = current pi (and nothing else)");
  if (!R.hasVoted()) fail("hasVoted should be true right after voting p1");

  R.vote();
  if (h.sent.length !== 1) fail("second vote must NOT send again (one-way)", h.sent);

  // A live echo of my own vote is idempotent (already in the set, no extra send).
  h.emit("ddjp.dj.vote", "@me:hs", "p1");
  if (!R.hasVoted() || h.sent.length !== 1) fail("echo of my vote should be idempotent", h.sent);

  R.recordSave("p1");
  if (h.sent.length !== 2 || h.sent[1].type !== "ddjp.dj.save") fail("recordSave should send one save event", h.sent);
  sameContent(h.sent[1].content, { p: "p1" }, "add carries p");
  if (!R.hasSaved()) fail("hasSaved should be true after recordSave p1");
  R.recordSave("p1");
  if (h.sent.length !== 2) fail("second recordSave must NOT send again (one-way)", h.sent);

  // Song changes to p2: both affordances go live again (latch keys on the live pi).
  h.setNp("p2", "BBBBBBBBBBB");
  if (R.hasVoted()) fail("hasVoted must reset when the song changes (p1 -> p2)");
  if (R.hasSaved()) fail("hasSaved must reset when the song changes (p1 -> p2)");
  R.vote();
  if (h.sent.length !== 3 || h.sent[2].content.p !== "p2") fail("vote on p2 should send a fresh vote event", h.sent);

  console.log("[reactions] PART A ok — one event per instance, p-tagged, one-way, resets on song change");
})();

// ---- PART B: durable across reload (spine-derived latch) -----------------------
(() => {
  const h = harness("@me:hs");
  const sb = loadInContext(["features/reactions.js"], { StreamManager: h.StreamManager, MatrixBridge: h.MatrixBridge, Logger: h.Logger });
  const R = sb.Reactions;
  R.init("!ev:hs");                        // fresh session, as after a reload

  h.setNp("p1", "AAAAAAAAAAA");
  if (R.hasVoted() || R.hasSaved()) fail("fresh session should start unlatched before replay");

  // Replay of history: my past vote + save for the instance that is STILL playing.
  h.emit("ddjp.dj.vote", "@me:hs", "p1");
  h.emit("ddjp.dj.save", "@me:hs", "p1");
  if (!R.hasVoted()) fail("replay of my vote for the live pi should re-press the ▲");
  if (!R.hasSaved()) fail("replay of my save for the live pi should re-press the ★");
  if (h.sent.length !== 0) fail("replay must not emit anything", h.sent);

  // A DIFFERENT play-instance of (possibly) the same video does NOT count.
  h.setNp("p9", "AAAAAAAAAAA");            // same videoId, new instance
  if (R.hasVoted() || R.hasSaved()) fail("a past instance of the same video must not light the button");

  // Another user's vote/save for the live pi never lights MY button.
  h.setNp("p1", "AAAAAAAAAAA");
  const h2 = harness("@me:hs");
  const sb2 = loadInContext(["features/reactions.js"], { StreamManager: h2.StreamManager, MatrixBridge: h2.MatrixBridge, Logger: h2.Logger });
  const R2 = sb2.Reactions;
  R2.init("!ev:hs");
  h2.setNp("p1", "AAAAAAAAAAA");
  h2.emit("ddjp.dj.vote", "@someone:else", "p1");
  h2.emit("ddjp.dj.save", "@someone:else", "p1");
  if (R2.hasVoted() || R2.hasSaved()) fail("another user's reactions must not light my button");

  console.log("[reactions] PART B ok — latch survives reload via the spine, keyed to the live instance, mine only");
})();

// ---- PART C: the reducer must ignore vote/save entirely -------------------------
(() => {
  const sb = loadInContext(["core/logger.js", "core/statederiver.js"], { Date });
  const D = sb.StateDeriver;

  const base = [
    { type: "ddjp.dj.join", content: { v: "AAAAAAAAAAA", u: null }, sender: "@dj:hs", senderRank: 20, l: 1, eventId: "$j1", ts: 1 },
    { type: "ddjp.dj.play", content: { p: null },                    sender: "@dj:hs", senderRank: 20, l: 2, eventId: "$p1", ts: 2 },
  ];
  const withReactions = base.concat([
    { type: "ddjp.dj.vote", content: { p: "$p1" }, sender: "@me:hs", senderRank: 0, l: 3, eventId: "$v1", ts: 3 },
    { type: "ddjp.dj.save",  content: { p: "$p1" }, sender: "@me:hs", senderRank: 0, l: 4, eventId: "$a1", ts: 4 },
  ]);

  const a = D.derive(base);
  const b = D.derive(withReactions);

  if (!a.nowPlaying || !a.nowPlaying.song || a.nowPlaying.song.videoId !== "AAAAAAAAAAA")
    fail("base play sequence did not yield the expected now-playing", a.nowPlaying);
  assert.deepStrictEqual(b.nowPlaying, a.nowPlaying, "vote/save must not change nowPlaying");
  assert.deepStrictEqual(b.rotation, a.rotation, "vote/save must not change rotation");
  assert.deepStrictEqual(b.settings, a.settings, "vote/save must not change settings");
  assert.deepStrictEqual(b.history, a.history, "vote/save must not change history");

  console.log("[reactions] PART C ok — vote/save are inert in the reducer (no consensus effect)");
})();

console.log("[reactions] PASS — ★/▲ emit p-tagged spine events, latch one-way per instance, survive reload, and carry no consensus weight");
process.exit(0);
