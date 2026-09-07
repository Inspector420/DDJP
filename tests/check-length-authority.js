// tests/check-length-authority.js
//
// THE BEST AVAILABLE TAKE ON A SONG'S LENGTH, BY RANK — AND THE ADVANCE OBEYS IT.
//
// A client that advances a song it knows nothing about is guessing. One that advances at the bare
// minGate floor, every song, is not guessing — and the audit measured a 240-second song airing for
// 8.001 seconds from a single uncategorized account.
//
// The rule that stops it already existed: gateLengthSec resolves the room's agreed length by
// HIGHEST RANK THAT SPOKE, then majority within that rank, then clamp. What the attack needed was
// for that rule to have nothing to work with — its advance had to sort BEFORE the honest
// declarations, so the prefix it was judged on contained none of them.
//
// The ordering rule closed that (see check-ordering): an event may not claim a position below the
// head while the server says it was minted later. An attacker's client cannot both claim not to
// have seen a declaration and be recorded as having sent afterwards. Honest declarations land about
// a second in, the floor is eight, so by the time an advance is legal the cascade has a real answer.
//
// This guard exists because that outcome is a PROPERTY OF TWO RULES INTERACTING, and neither one's
// own guard would notice if the interaction broke. It pins what the room owes: rank decides, numbers
// do not, and a client with no information cannot overrule one that has some.

const assert = require("assert");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/consensushash.js",
  "backends/backend1/vouch.js", "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js"], {});
const SM = sb.StreamManager, R = F.RANK;

const raw = (id, l, ts, sender, rank, body) => ({
  event_id: id, type: "m.room.message", sender: sender, room_id: "!r:hs",
  ts: ts, senderRank: rank, content: { body: JSON.stringify(Object.assign({ l: l }, body)) },
});

// A room playing a 240-second song. Declarations land ~1s in, which is when a real client learns
// the duration from its player and finds it disagrees with the room (which so far knows nothing).
// The attacker advances at 8.1s — the earliest the bare floor allows.
function scene(decls) {
  SM.reset();
  let l = 0;
  SM.ingest(raw("$j1", ++l, 1000, "@ann:hs", R.player, { t: "ddjp.dj.join", v: "a1" }));
  SM.ingest(raw("$j2", ++l, 1000, "@ben:hs", R.player, { t: "ddjp.dj.join", v: "b1" }));
  SM.ingest(raw("$d1", ++l, 1000, "@ann:hs", R.player, { t: "ddjp.dj.declare", v: "a2" }));
  SM.ingest(raw("$p0", ++l, 100000, "@ann:hs", R.player, { t: "ddjp.dj.play", p: null }));
  for (const d of decls) {
    SM.ingest(raw(d.id, ++l, 100000 + d.at, d.who, d.rank, { t: "ddjp.play.len", pi: "$p0", sec: d.sec }));
  }
  SM.ingest(raw("$atk", ++l, 108100, "@evil:hs", R.uncat, { t: "ddjp.dj.play", p: "$p0" }));
  const s = SM.getState();
  return { cut: !!(s.nowPlaying && s.nowPlaying.pi === "$atk"),
           agreed: s.advance && s.advance.gateLenSec };
}
const D = (id, at, who, rank, sec) => ({ id, at, who, rank, sec });

// ── PART A — one honest measurement is enough ────────────────────────────────────────────────
{
  const r = scene([D("$L1", 1000, "@ann:hs", R.player, 240)]);
  ok(r.agreed === 240, "A: one player's measurement becomes the room's agreed length", r);
  ok(r.cut === false,
    "A: APPLIED — and the 8-second advance is refused. This is the whole attack, and a single "
    + "honest client with a working player defeats it", r);
}

// ── PART B — RANK DECIDES, AND NUMBERS DO NOT ────────────────────────────────────────────────
// The property that matters. Colluding accounts can outnumber, so if quantity could win, buying
// more accounts would buy the room — and accounts are free.
{
  const one = scene([D("$L1", 1000, "@evil1:hs", R.uncat, 10),
                     D("$L2", 1100, "@ben:hs", R.guest, 240)]);
  ok(one.agreed === 240 && one.cut === false,
    "B: an attacker claiming 10s loses to ONE GUEST claiming 240s — one rank above is enough", one);

  const two = scene([D("$L1", 1000, "@evil1:hs", R.uncat, 10),
                     D("$L2", 1050, "@evil2:hs", R.uncat, 10),
                     D("$L3", 1100, "@ben:hs", R.guest, 240)]);
  ok(two.agreed === 240 && two.cut === false,
    "B: APPLIED — and TWO of them still lose to that one guest. The cascade resolves by rank first "
    + "and only then by majority WITHIN a rank, so extra accounts at the bottom buy nothing", two);

  const three = scene([D("$L1", 1000, "@evil1:hs", R.uncat, 10),
                       D("$L2", 1050, "@evil2:hs", R.uncat, 10),
                       D("$L3", 1080, "@evil3:hs", R.uncat, 10),
                       D("$L4", 1100, "@ben:hs", R.guest, 240)]);
  ok(three.agreed === 240 && three.cut === false,
    "B: APPLIED — nor does a third. There is no number of accounts at a rank that outvotes a "
    + "single account above it", three);
}

// ── PART C — with no rank above them, they win, and that is correct ──────────────────────────
// Deliberately asserted rather than left implicit. If the attacker is the best information the
// room has, deferring to them is the same rule working, not a hole in it — the alternative would
// be a room that refuses to believe the only person who can see the song.
{
  const alone = scene([D("$L1", 1000, "@evil:hs", R.uncat, 10)]);
  ok(alone.agreed === 10,
    "C: with nobody above them, the attacker's own claim IS the room's agreed length", alone);
  ok(alone.cut === false,
    "C: APPLIED — and even then the 8.1s advance is refused, because their claim of 10s puts the "
    + "gate at 9s. Lying short is bounded below by minLen, so the lie cannot pay", alone);

  const silent = scene([]);
  ok(silent.agreed === null && silent.cut === true,
    "C: APPLIED — and when NOBODY declares, the bare floor is all there is and the advance stands. "
    + "That means no client can see the song at all, which is the availability skip's business, not "
    + "the length gate's", silent);
}

// ── PART D — the interaction. The ordering rule is what gives the cascade its chance ──────────
// The attack's real requirement was never a rank; it was arriving FIRST. An advance stamped at a
// position before the declaration, but minted after it, is the only remaining way to get there.
{
  SM.reset();
  let l = 0;
  SM.ingest(raw("$j1", ++l, 1000, "@ann:hs", R.player, { t: "ddjp.dj.join", v: "a1" }));
  SM.ingest(raw("$j2", ++l, 1000, "@ben:hs", R.player, { t: "ddjp.dj.join", v: "b1" }));
  SM.ingest(raw("$d1", ++l, 1000, "@ann:hs", R.player, { t: "ddjp.dj.declare", v: "a2" }));
  SM.ingest(raw("$p0", ++l, 100000, "@ann:hs", R.player, { t: "ddjp.dj.play", p: null }));
  const playL = l;
  SM.ingest(raw("$L1", ++l, 101000, "@ann:hs", R.player, { t: "ddjp.play.len", pi: "$p0", sec: 240 }));

  const before = SM.getLog().length;
  SM.ingest(raw("$atk", playL, 108100, "@evil:hs", R.uncat, { t: "ddjp.dj.play", p: "$p0" }));
  ok(SM.getLog().length === before,
    "D: an advance claiming a position BEFORE the declaration, while the server records it as sent "
    + "AFTER, is refused. A client cannot both not-have-seen a message and have replied to it");

  const s = SM.getState();
  ok(s.nowPlaying && s.nowPlaying.pi === "$p0",
    "D: APPLIED — so the song keeps playing. Without this the cascade is correct and irrelevant: "
    + "the attacker simply arranges to be judged on a prefix that contains no measurements", s.nowPlaying);
}

console.log("[length-authority] PASS — the room's view of a song's length is the best available by "
  + "RANK, and the advance gate obeys it: one honest measurement defeats an 8-second cut, one guest "
  + "outranks any number of uncategorized accounts claiming otherwise, and lying short is bounded "
  + "below by minLen so the lie does not pay; with nobody above them an attacker's claim is the "
  + "room's claim, which is the same rule working rather than a hole in it; and the ordering rule "
  + "is what gives the cascade its chance at all, by refusing an advance that claims not to have "
  + "seen a declaration the server records it as following (" + checks + " assertions)");
