// tests/check-agreed-length.js
// SUBJECT: backends/backend1/statederiver.js, backends/backend1/streammanager.js, features/playback.js
//
// WALL: ONE AGREED LENGTH, THE SAME FOR EVERYONE, AND NO FORKING (`ddjp_711`; the owner's words: "3 we must use a
// deterministic way to always all agree on lenght if not possible max song length wins i think", and "also when i say
// deterministically i mean that everyone always agrees by the end with cascading tie break and predictable best behavior
// on ties with no forking for some or other users"). Songs end by the room's clock at the agreed length plus the wait, so
// the agreed length is what ends every song, on every screen and for the bot (`StateDeriver.gateLengthSec`, the one rule):
//   1. the strongest rank that declared; 2. the majority within it; 3. a tie at a rank cascades to the next rank down;
//   4. every rank tied -> the strongest rank's longest tied length (a song is never cut short); 5. clamped to
//   [minLen, maxLen]; nobody declared -> none, and the ceiling ends the song.
//
//   PART A — THE RULE, the real `gateLengthSec`: each step, the pure tie, the clamp on a pure tie, none; and the answer
//            for every ORDER of the same declarations (all permutations) is one answer.
//   PART B — NO FORKING, through the real door and the real fold: one room's messages — a song, four declarations tied at
//            two ranks (a pure tie), an advance sent early by a screen that saw only the lower rank's, and the advance at
//            the agreed moment — ingested by fresh clients in the log's order, its reverse and 24 shuffles. Every client
//            admits every message (nothing is set aside by the door), agrees the same length (210 s, the pure tie's
//            answer), refuses the early advance as too early, and accepts the one at the agreed moment.
//   PART C — THE SCREEN THAT SAW FEWER DECLARATIONS, the real Playback over each client's own fold: it ends the song at
//            ITS agreed length (195 s), which the room refuses everywhere (PART B); and with every declaration in, the
//            agreed moment (210 s) is when a screen's clock end sends — not a second before.
//
// WHERE THE FOLD'S ORDER COMES FROM: `StreamManager.orderEvents` sorts the held set by `(l, event_id)` — a pure function of
// the SET, so two devices holding the same messages fold them in one order whatever order they arrived in. What can differ
// is the SET: the door refuses an event that claims a past position (`l` below the head) with a later server stamp than
// the head's, and whether it has seen that head first depends on arrival — J71's open decision. Honest senders never send
// one (their `l` and stamp rise together), which PART B's every-order admission measures; J71 (open) has it.
"use strict";
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[agreed-length] FAIL — " + msg);
  if (got !== undefined) { try { console.log("      got " + JSON.stringify(got)); } catch (e) { console.log("      got (unprintable)"); } }
}

// ═══ PART A — the rule ═══════════════════════════════════════════════════════════════════════════════════════════════
const RX = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date });
const G = RX.StateDeriver.gateLengthSec;
const tier = (name) => RX.Ranks.tierOf(F.RANK[name]);
ok(typeof G === "function" && tier("staff") < tier("guest"), "A PREMISE — the reducer exports its one length rule, and staff is a stronger tier than guest",
  { fn: typeof G, staff: tier("staff"), guest: tier("guest") });
const E = (sec, who) => ({ sec, tier: tier(who) });
function perms(a) {
  if (a.length <= 1) return [a.slice()];
  const out = [];
  a.forEach((x, i) => { for (const p of perms(a.slice(0, i).concat(a.slice(i + 1)))) out.push([x].concat(p)); });
  return out;
}
const CASES = [
  ["1 THE STRONGEST RANK WINS", [E(200, "staff"), E(180, "guest"), E(180, "guest")], 200],
  ["2 THE MAJORITY WITHIN IT", [E(200, "staff"), E(210, "staff"), E(210, "staff"), E(150, "guest")], 210],
  ["3 A TIE AT A RANK CASCADES DOWN", [E(200, "staff"), E(210, "staff"), E(190, "guest")], 190],
  ["4 EVERY RANK TIED: THE STRONGEST RANK'S LONGEST TIED LENGTH", [E(200, "staff"), E(210, "staff"), E(190, "guest"), E(195, "guest")], 210],
  ["4 and only its TIED lengths count: a lone 230 at the strongest rank is not tied with the two pairs", [E(200, "staff"), E(200, "staff"),
    E(210, "staff"), E(210, "staff"), E(230, "staff"), E(190, "guest"), E(195, "guest")], 210],
  ["4 a single rank tied with nothing below it", [E(200, "vip"), E(240, "vip")], 240],
];
for (const [name, entries, want] of (typeof G === "function" ? CASES : [])) {
  const got = G(entries, 10, 600);
  const all = perms(entries).map((p) => G(p, 10, 600));
  ok(got === want && all.every((x) => x === want), "A — " + name + ": " + want + " s, in every one of the " + all.length +
    " orders of the same declarations", { got, distinct: Array.from(new Set(all)) });
}
if (typeof G === "function") ok(G([E(590, "staff"), E(700, "staff")], 10, 600) === 600 && G([E(3, "staff"), E(5, "staff")], 10, 600) === 10,
  "A — 5 A PURE TIE IS CLAMPED TOO: its longest tied length is held to [minLen, maxLen]",
  { high: G([E(590, "staff"), E(700, "staff")], 10, 600), low: G([E(3, "staff"), E(5, "staff")], 10, 600) });
if (typeof G === "function") ok(G([], 10, 600) === null && G(null, 10, 600) === null, "A — NOBODY DECLARED: no agreed length (the ceiling ends the song)");

// ═══ PART B — no forking, through the real door and fold ═════════════════════════════════════════════════════════════
const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js",
  "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js",
  "backends/backend1/settingsproof.js", "backends/backend1/streammanager.js",
]);
const { StreamManager, StateDeriver, Floor, SettingsProof } = C;
for (const k of ["info", "warn", "debug", "error"]) C.Logger[k] = () => {};
const WAIT = (typeof StateDeriver.END_WAIT_MS === "number") ? StateDeriver.END_WAIT_MS : 0;   // the room's one wait (0 where none is defined)
const SETTINGS = StateDeriver.defaultSettings();
const T0 = 100000;
const ROOM = F.playingRoom({ songs: 1, startTs: T0 });
const PI = ROOM.pi(0);
let L = ROOM.lastL + 1;
const BASE = [F.reducerEvent("$genesis", 1, 900, "@owner:hs", F.RANK.owner, { t: "ddjp.room.settings", s: SETTINGS })]
  .concat(ROOM.log.map((e) => F.reducerEvent(e.eventId, e.l + 1, e.ts, e.sender, e.senderRank, e.content)));
// Four declarations, tied at both ranks: staff 200 and 210, guest 190 and 195 — the pure tie, whose answer is 210.
const DECL = [
  F.lenDecl("$len-staff-a", ++L, T0 + 6000, PI, 200, F.RANK.staff, "@staffA:hs"),
  F.lenDecl("$len-staff-b", ++L, T0 + 6100, PI, 210, F.RANK.staff, "@staffB:hs"),
  F.lenDecl("$len-guest-c", ++L, T0 + 6200, PI, 190, F.RANK.guest, "@guestC:hs"),
  F.lenDecl("$len-guest-d", ++L, T0 + 6300, PI, 195, F.RANK.guest, "@guestD:hs"),
];
const GUESTS_ONLY = DECL.slice(2);
// The early advance: a screen that held only the guests' declarations agreed 195 s and sent at its clock end.
const EARLY = F.reducerEvent("$adv-early", ++L, T0 + 195000 + WAIT, "@guestC:hs", F.RANK.guest, { t: "ddjp.dj.play", p: PI });
// The advance at the agreed moment (210 s plus the wait).
const ON_TIME = F.reducerEvent("$adv-on-time", ++L, T0 + 210000 + WAIT, "@staffA:hs", F.RANK.staff, { t: "ddjp.dj.play", p: PI });
const ALL = BASE.concat(DECL, [EARLY, ON_TIME]);

function client(events) {
  StreamManager.reset(); Floor.reset(); SettingsProof.reset();
  SettingsProof.attach({ now: () => Date.now(), pageSettings: null });
  for (const e of events) StreamManager.ingest(F.toRaw(e));
  const log = StreamManager.getLog();
  const both = StateDeriver.deriveBoth(log);
  const st = StreamManager.getState();
  return { ids: log.map((e) => e.eventId), state: st, refusals: both.refusals };
}
function seeded(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const ORDERS = [["the log's order", ALL], ["its reverse", ALL.slice().reverse()]];
for (let i = 0; i < 24; i++) ORDERS.push(["shuffle " + (i + 1), F.shuffled(ALL, seeded(711 + i))]);
// The agreed length before any advance, in each order of the song and its declarations.
const BEFORE = BASE.concat(DECL);
const lens = [], verdicts = [];
for (let i = 0; i < ORDERS.length; i++) {
  const order = i === 0 ? BEFORE : (i === 1 ? BEFORE.slice().reverse() : F.shuffled(BEFORE, seeded(1711 + i)));
  const c = client(order);
  lens.push({ order: ORDERS[i][0], len: c.state.advance && c.state.advance.pi === PI ? c.state.advance.gateLenSec : "no advance view",
    endsAt: c.state.advance ? c.state.advance.endsAt : null, held: c.ids.length });
}
ok(lens.every((x) => x.len === 210 && x.endsAt === T0 + 210000 + WAIT && x.held === BEFORE.length),
  "B — THE SAME MESSAGES IN ANY ORDER, ONE AGREED LENGTH: every client holds all " + BEFORE.length + " and agrees 210 s (the pure " +
  "tie's answer) and the same clock end, in the log's order, its reverse and 24 shuffles", lens.filter((x) => x.len !== 210 || x.held !== BEFORE.length));
for (const [name, order] of ORDERS) {
  const c = client(order);
  verdicts.push({ order: name, held: c.ids.length, ids: c.ids.join(","),
    early: c.refusals["$adv-early"] ? c.refusals["$adv-early"].code : "accepted",
    onTime: c.refusals["$adv-on-time"] ? c.refusals["$adv-on-time"].code : "accepted",
    playing: c.state.nowPlaying ? c.state.nowPlaying.pi : null });
}
const first = verdicts[0];
ok(verdicts.every((v) => v.held === ALL.length && v.ids === first.ids),
  "B — NOTHING IS SET ASIDE BY THE DOOR IN ANY ORDER: every client holds the same " + ALL.length + " messages in one fold order, (l, event_id)",
  verdicts.map((v) => ({ order: v.order, held: v.held })));
ok(verdicts.every((v) => v.early === "too-early" && v.onTime === "accepted" && v.playing === "$adv-on-time"),
  "B — THE SAME VERDICT ON EVERY ADVANCE, EVERYWHERE: the advance sent by the screen that saw fewer declarations is refused as too " +
  "early on every client, and the one at the agreed moment is accepted on every client — the room moves on at 210 s",
  verdicts.filter((v) => v.early !== "too-early" || v.onTime !== "accepted").slice(0, 4));

// ═══ PART C — the screen that saw fewer declarations, the real Playback ══════════════════════════════════════════════
function screen(events) {
  const view = client(events).state;
  let now = 0;
  const timers = [], sent = [];
  const sb = loadInContext(["features/playback.js"], {
    Date: { now: () => now }, Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round },
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + (ms || 0) }); return timers.length; }, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    StreamManager: { getState: () => view, on: () => {}, off: () => {} },
    ServerClock: { serverNow: () => now, elapsedSince: (ts) => now - ts },
    MatrixBridge: { mayAdvance: () => ({ ok: true }), async sendEvent(ch, type, body) { sent.push({ type, body, at: now }); return {}; } },
    Capabilities: { staggerMs: () => 0, rankNameOf: () => "guest" },
    Logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  sb.Playback.initWiring("!ev:hs");
  // The clock at `t`: one tick, then the rank slot and the pre-send pause run out (the advance's own timer, 300 ms).
  const at = (t) => {
    now = t; sb.Playback._tick();
    now = t + 1000;
    for (let k = 0; k < 5; k++) { const due = timers.filter((x) => x.at <= now && !x.done); due.forEach((x) => { x.done = true; x.fn(); }); }
  };
  return { view, sent, at, plays: () => sent.filter((x) => x.type === "ddjp.dj.play") };
}
const few = screen(BASE.concat(GUESTS_ONLY));
ok(few.view.advance && few.view.advance.gateLenSec === 195, "C PREMISE — the screen that held only the guests' declarations agrees 195 s (their tie's longest)",
  few.view.advance);
few.at(T0 + 195000 + WAIT - 1);
const beforeIts = few.plays().length;
few.at(T0 + 195000 + WAIT);
ok(beforeIts === 0 && few.plays().length === 1 && few.plays()[0].body.p === PI,
  "C — IT ENDS THE SONG AT ITS OWN AGREED MOMENT (195 s plus the wait) — the advance PART B shows refused on every client",
  { before: beforeIts, plays: few.plays() });
const full = screen(BEFORE);
full.at(T0 + 210000 + WAIT - 1);
const early = full.plays().length;
full.at(T0 + 210000 + WAIT);
ok(early === 0 && full.plays().length === 1, "C — WITH EVERY DECLARATION IN, THE CLOCK END IS THE AGREED MOMENT: nothing a millisecond " +
  "before 210 s plus the wait, the advance at it", { before: early, plays: full.plays() });

if (failed) { console.log("[agreed-length] " + failed + " failure(s)"); process.exit(1); }
console.log("[agreed-length] PASS — one agreed length, the same for everyone (" + asserts + " assertions): the strongest rank, its " +
  "majority, a tie cascading down, and with every rank tied the strongest rank's longest tied length, clamped — one answer for " +
  "every order of the same declarations; through the real door and fold, every client holding the same messages in any of 26 " +
  "orders holds all of them, agrees 210 s, refuses the advance of a screen that saw fewer declarations as too early and accepts " +
  "the one at the agreed moment; and the real Playback's clock end is that moment, not a millisecond before");
