// tests/check-clock-end.js
// SUBJECT: features/playback.js, backends/backend1/statederiver.js, backends/backend2/runner.js
//
// WALL: SONGS END BY THE ROOM'S CLOCK (`ddjp_711`, the owner's decision replacing "the first screen whose player says ENDED";
// his words: "then maybe the room cna be in perfect sync using clock time only and declared lenghts only to know what to do
// in a pure form with the player unable to alter logic"). A song ends at `advance.endsAt` — its agreed length plus the
// room's one wait (`StateDeriver.END_WAIT_MS`, 0 now: "can we build the machinery for the 3 second wait but set it to
// zero"). Driven with the real Playback over states folded by the real reducer.
//
//   PART A — THE WAIT IS ONE NUMBER IN ONE PLACE, DRIVEN AT 0 AND AT 3 s. The reducer defines it once and puts the clock end
//            on the advance view; the screens (`features/playback.js`) and the bot (`backends/backend2/runner.js`) read
//            `endsAt` and compute no end of their own. The reducer is loaded with the number changed (0, then 3000) and a
//            room folded through it: every screen sends nothing a millisecond before the agreed length plus the wait, and
//            the advance at it. (The bot at 3 s: `check-bot-songs` A2.)
//   PART B — A PLAYER'S END IS A WAKE-UP, NEVER THE DECISION. An early end answers "reload" once, then "hold"; a normal end
//            "hold"; none of them sends anything before the clock end. With no tick ever running, an end that arrives at or
//            after the clock end runs the clock check, and the advance goes.
//   PART C — THE END IS ARMED FROM EACH ARRIVING MESSAGE (as the bot's since J68), so a background tab whose interval is held
//            back still ends the song on time: no interval runs here at all. A message arms ONE timer for the end moment; a
//            changed agreed length re-arms it; a message after the end runs the clock check at once, arming nothing.
//   PART D — EARLY OR NORMAL: an end is early only while the room's elapsed time is below the agreed length minus
//            max(graceMs, 2 s) — at both sides of the margin, at the room's default graceMs and at a larger one.
//   PART E — NO PRIVATE LENGTH ENDS A SONG: with only this device's measured length and no agreed one, nothing is sent until
//            the ceiling; meanwhile the device declares its length again (a refused reading retried, one declaration per play).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[clock-end] FAIL — " + msg);
  if (got !== undefined) { try { console.log("      got " + JSON.stringify(got)); } catch (e) { console.log("      got (unprintable)"); } }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const { ONE, reducerWithWait, foldedRoom, T0 } = require("./_wait.js");

// THE REAL PLAYBACK over a state the test holds: its timers held until due, its interval captured and never run (a tab
// whose chain is held back), its subscriptions captured so the test delivers "messages", and every send recorded.
function screen(stateRef, o) {
  o = o || {};
  let now = 0;
  const timers = [], sent = [], subs = [], intervals = [];
  const provider = { reading: o.reading || null };
  const sb = loadInContext(["features/playback.js"], {
    Date: { now: () => now }, Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round },
    setTimeout: (fn, ms) => { const t = { fn, at: now + (ms || 0), id: timers.length + 1 }; timers.push(t); return t.id; },
    clearTimeout: (id) => { const t = timers.find((x) => x.id === id); if (t) t.cleared = true; },
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return 99; }, clearInterval: () => {},
    StreamManager: { getState: () => stateRef.value, on: (t, fn) => subs.push({ t, fn }), off: () => {} },
    ServerClock: { serverNow: () => now, elapsedSince: (ts) => now - ts },
    MatrixBridge: { mayAdvance: () => ({ ok: true }), async sendEvent(ch, type, body) { sent.push({ type, body, at: now }); return {}; } },
    Capabilities: { staggerMs: () => 0, rankNameOf: () => "staff" },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  const P = sb.Playback;
  P.setDurationProvider(() => provider.reading);
  P.initWiring("!ev:hs");
  if (o.start !== false) P.start();
  const pending = () => timers.filter((t) => !t.done && !t.cleared);
  const runDue = () => { for (let k = 0; k < 10; k++) { const due = pending().filter((t) => t.at <= now); if (!due.length) break; due.forEach((t) => { t.done = true; t.fn(); }); } };
  return {
    P, sent, subs, intervals, provider, pending,
    at: (t) => { now = t; },
    now: () => now,
    tick: () => { P._tick(); },
    run: () => runDue(),                                                         // what is due now, the clock held
    settle: (ms) => { const end = now + (ms || 1000); while (now < end) { now = Math.min(end, now + 50); runDue(); } },
    message: () => { for (const s of subs) if (s.t === "*") s.fn({}); },
    plays: () => sent.filter((x) => x.type === "ddjp.dj.play"),
    lens: () => sent.filter((x) => x.type === "ddjp.play.len"),
  };
}

// ═══ PART A — the wait: one number, one place, at 0 and at 3 s ═══════════════════════════════════════════════════════
{
  // Code only: line comments are cut, so a comment naming the wait is not read as a second copy of it.
  const code = (t) => t.split("\n").map((l) => l.replace(/(^|[^:"'`])\/\/.*$/, "$1")).join("\n");
  const sd = read("backends/backend1/statederiver.js"), pb = code(read("features/playback.js")), rn = code(read("backends/backend2/runner.js"));
  const due = rn.slice(rn.indexOf("function _advanceDue("), rn.indexOf("function _advanceTick("));
  ok(sd.split(ONE).length === 2 && /endsAt: gateLen \? started \+ gateLen \* 1000 \+ END_WAIT_MS : null/.test(sd),
    "A PREMISE — the reducer defines the wait ONCE (`END_WAIT_MS`, 0) and the advance view's `endsAt` adds it to the agreed length");
  ok(/adv\.endsAt/.test(pb) && !/END_WAIT_MS/.test(pb) && /a\.endsAt/.test(due) && !/gateLenSec \* 1000/.test(due) && !/END_WAIT_MS/.test(due),
    "A — THE SCREENS AND THE BOT READ THE ONE END: `features/playback.js` and the runner's `_advanceDue` read `endsAt`, and neither " +
    "adds a wait or works out an end of its own");
  for (const W of [0, 3000]) {
    const SD = reducerWithWait(W);
    ok(!!SD && SD.END_WAIT_MS === W, "A PREMISE — the reducer loaded with its one wait at " + W + " ms", SD && SD.END_WAIT_MS);
    if (!SD) continue;
    const { state, pi } = foldedRoom(SD, 200);
    ok(state.advance && state.advance.pi === pi && state.advance.gateLenSec === 200 && state.advance.endsAt === T0 + 200000 + W,
      "A — AT A WAIT OF " + W / 1000 + " s THE FOLD'S CLOCK END IS THE AGREED LENGTH PLUS IT (" + (200 + W / 1000) + " s)", state.advance);
    const s = screen({ value: state });
    s.at(T0 + 200000 + W - 1); s.tick(); s.run();
    const before = s.plays().length;
    s.at(T0 + 200000 + W); s.tick(); s.settle();
    ok(before === 0 && s.plays().length === 1 && s.plays()[0].body.p === pi,
      "A — AT A WAIT OF " + W / 1000 + " s A SCREEN SENDS NOTHING A MILLISECOND BEFORE THE CLOCK END, AND THE ADVANCE AT IT", { before, plays: s.plays() });
  }
}

// ═══ PART B — a player's end is a wake-up ════════════════════════════════════════════════════════════════════════════
const SD0 = reducerWithWait(0);
const R200 = foldedRoom(SD0, 200);
{
  const s = screen({ value: R200.state });
  const key = R200.state.nowPlaying.song.songKey;
  s.at(T0 + 150000);
  const v1 = s.P.notifyEnded(key, R200.pi);
  const v2 = s.P.notifyEnded(key, R200.pi);
  s.settle();
  ok(v1 === "reload" && v2 === "hold" && s.plays().length === 0,
    "B — AN EARLY END (150 s of 200) IS RELOADED ONCE, A SECOND EARLY END IN THE SAME PLAY HOLDS, AND NEITHER SENDS ANYTHING", { v1, v2, plays: s.plays() });
  const n = screen({ value: R200.state });
  n.at(T0 + 199000);
  const v3 = n.P.notifyEnded(key, R200.pi);
  n.settle();
  ok(v3 === "hold" && n.plays().length === 0, "B — A NORMAL END (199 s of 200) HOLDS, AND STILL SENDS NOTHING BEFORE THE CLOCK END", { v3, plays: n.plays() });
  const w = screen({ value: R200.state });
  w.at(T0 + 200500);
  const v4 = w.P.notifyEnded(key, R200.pi);
  w.settle();
  ok(v4 === "hold" && w.plays().length === 1 && w.intervals.length === 1,
    "B — THE WAKE-UP: with no tick ever run (its interval held back), an end that arrives after the clock end runs the clock check " +
    "and the advance goes", { v4, plays: w.plays(), intervals: w.intervals.length });
  ok(w.P.notifyEnded("yt:ZZZZZZZZZZZ", R200.pi) === null, "B — AN END FROM ANOTHER SONG IS NOTHING (null)");
}

// ═══ PART C — the end, armed from each arriving message ══════════════════════════════════════════════════════════════
{
  const ref = { value: R200.state };
  const s = screen(ref);
  ok(s.subs.some((x) => x.t === "*"), "C PREMISE — Playback hears every arriving message (the wildcard), not only the song-moving ones",
    s.subs.map((x) => x.t));
  s.at(T0 + 100000);
  s.message();
  const armed = s.pending();
  ok(armed.length === 1 && armed[0].at === T0 + 200000, "C — A MESSAGE ARMS ONE TIMER FOR THE CLOCK END (100 s on), from that message",
    armed.map((t) => t.at - (T0 + 100000)));
  // The agreed length moves to 210 s: the next message re-arms to the new moment, the old timer cleared.
  ref.value = foldedRoom(SD0, 210).state;
  s.at(T0 + 120000);
  s.message();
  ok(s.pending().length === 1 && s.pending()[0].at === T0 + 210000, "C — A CHANGED AGREED LENGTH RE-ARMS IT: one timer, at the new moment",
    s.pending().map((t) => t.at - T0));
  s.at(T0 + 210000);
  const fire = s.pending()[0];
  if (fire) { fire.done = true; fire.fn(); }
  s.settle();
  ok(s.plays().length === 1 && s.intervals.length === 1, "C — IT FIRES, AND THE SONG ENDS WITH NO INTERVAL RUN — as a background tab whose chain " +
    "is held back", { plays: s.plays().length });
  const late = screen({ value: R200.state });
  late.at(T0 + 230000);
  late.message();
  late.settle();
  ok(late.plays().length === 1, "C — A MESSAGE AFTER THE CLOCK END RUNS THE CLOCK CHECK AT ONCE: the advance goes, no timer at zero", late.plays().length);
}

// ═══ PART D — early or normal ════════════════════════════════════════════════════════════════════════════════════════
{
  const key = R200.state.nowPlaying.song.songKey;
  const at = (state, sec) => { const s = screen({ value: state }); s.at(T0 + sec * 1000); return s.P.notifyEnded(key, state.nowPlaying.pi); };
  ok(at(R200.state, 197.5) === "reload" && at(R200.state, 198.5) === "hold",
    "D — AT THE ROOM'S DEFAULT graceMs (1 s) THE MARGIN IS 2 s: an end at 197.5 s of 200 is early, at 198.5 s normal",
    { early: at(R200.state, 197.5), normal: at(R200.state, 198.5) });
  const G5 = foldedRoom(SD0, 200, { graceMs: 5000 }).state;
  ok(G5.nowPlaying.settings.graceMs === 5000 && at(G5, 194.5) === "reload" && at(G5, 195.5) === "hold",
    "D — WITH graceMs AT 5 s THE MARGIN IS 5 s: early at 194.5 s, normal at 195.5 s", { grace: G5.nowPlaying.settings.graceMs, early: at(G5, 194.5), normal: at(G5, 195.5) });
}

// ═══ PART E — no private length ends a song ═════════════════════════════════════════════════════════════════════════
{
  const none = foldedRoom(SD0, null);
  const ref = { value: none.state };
  const maxLen = none.state.nowPlaying.settings.maxLen;
  const s = screen(ref);
  s.P.setDuration(none.state.nowPlaying.song.songKey, 200);   // this device measured 200 s (its reading is not confirmed: no provider yet)
  for (let t = 200; t < maxLen; t += 50) { s.at(T0 + t * 1000); s.tick(); s.settle(); }
  ok(none.state.advance && none.state.advance.endsAt === null && s.plays().length === 0,
    "E — WITH NO AGREED LENGTH, THIS DEVICE'S OWN 200 s ENDS NOTHING: no advance from 200 s to the ceiling", s.plays());
  s.at(T0 + maxLen * 1000); s.tick(); s.settle();
  ok(s.plays().length === 1, "E — THE CEILING ENDS IT (" + maxLen + " s)", s.plays().length);
  const r = screen({ value: none.state });
  const key = none.state.nowPlaying.song.songKey;
  r.at(T0 + 20000); r.tick(); r.settle(100);
  ok(r.lens().length === 0, "E PREMISE — with no reading from the player, nothing is declared", r.lens());
  r.provider.reading = { songKey: key, seconds: 200 };
  r.at(T0 + 22000); r.tick(); r.settle(100);
  const tooSoon = r.lens().length;
  r.at(T0 + 25100); r.tick(); r.settle(2000);
  ok(tooSoon === 0 && r.lens().length === 1 && r.lens()[0].body.sec === 200 && r.lens()[0].body.pi === none.pi,
    "E — WHILE THE ROOM HAS NO LENGTH THE DEVICE DECLARES ITS OWN AGAIN, at most every 5 s: once its player reads the song", { tooSoon, lens: r.lens() });
  r.at(T0 + 40000); r.tick(); r.settle(2000);
  ok(r.lens().length === 1, "E — ONE DECLARATION PER PLAY: having declared, it does not again", r.lens().length);
}

if (failed) { console.log("[clock-end] " + failed + " failure(s)"); process.exit(1); }
console.log("[clock-end] PASS — songs end by the room's clock (" + asserts + " assertions): the wait is one number in the reducer, " +
  "read through `endsAt` by the screens and the bot, and at 0 and at 3 s a screen sends nothing before the agreed length plus it and " +
  "the advance at it; a player's end only wakes the clock check (reload once, then hold; a normal end holds), and with no tick run an " +
  "end after the clock end sends the advance; each arriving message arms one timer for the end, re-armed when the length moves; an " +
  "end is early only below the agreed length minus max(graceMs, 2 s); and no private length ends a song — the ceiling does, while " +
  "the device declares its length again, once");
