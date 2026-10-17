// probe-play-len.js — DIAGNOSTIC. Settles ONE question, so the decision recorded against
// `playback.js|ddjp.play.len` in check-wiring PART D is evidence rather than an assertion:
//
//   A client that is BEHIND authors a length declaration. Does it reach the room's agreed
//   length — the value that gates when every client may advance — or does the reducer refuse it?
//
// This is the whole basis for leaving that send site ungated. If a behind client's declaration
// can move the gate, the site needs a gate and a deferral. If the reducer refuses it at its own
// fold position, gating buys nothing and costs a dropped declaration.
//
// PAIRED, per §8: a refusal is evidence only if something adjacent was ADMITTED. The stale
// declaration and the live one differ in ONE detail — which pi they name — so a refusal is
// attributable to that and not to the fixture failing to reach the reducer at all.

const path = require("path");
const T = "/home/claude/proj/code/ddjp_239/tests";
const { loadInContext } = require(path.join(T, "_load.js"));
const F = require(path.join(T, "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/statederiver.js",
], { Date, Math, JSON });
const { StateDeriver } = sb;

const room = F.playingRoom({ songs: 3 });
const livePi = room.pi(2);      // the head everyone agrees on
const stalePi = room.pi(0);     // where a client that is behind still thinks the room is

// Both declarations are well-formed, in range, and from distinct VIP senders. The ONLY
// difference is which playing they name — which is the axis the rule is about.
const stale = F.lenDecl("$dStale", room.lastL + 1, room.startTs + 900000, stalePi, 500,
                        F.RANK.vip, "@behind:hs");
const live  = F.lenDecl("$dLive",  room.lastL + 2, room.startTs + 900001, livePi,  250,
                        F.RANK.vip, "@caught:hs");

function fold(extra) {
  const r = StateDeriver.deriveBoth(F.sortLog(room.log.concat(extra)));
  const acc = new Set(r.accepted);
  return {
    accepted: (id) => acc.has(id),
    gate: r.state.advance ? r.state.advance.gateLenSec : null,
    pi: r.state.nowPlaying ? r.state.nowPlaying.pi : null,
  };
}

const both = fold([stale, live]);
const staleOnly = fold([stale]);
const liveOnly = fold([live]);

console.log("\nplay.len probe — the room's head is " + livePi + "\n");
console.log("  a BEHIND client declares 500s for " + stalePi + " (the pi it still thinks is live):");
console.log("      accepted by the reducer? " + staleOnly.accepted("$dStale"));
console.log("      room's agreed length now: " + staleOnly.gate);
console.log("  a CAUGHT-UP client declares 250s for " + livePi + ":");
console.log("      accepted by the reducer? " + liveOnly.accepted("$dLive"));
console.log("      room's agreed length now: " + liveOnly.gate);
console.log("  both together:");
console.log("      stale accepted? " + both.accepted("$dStale") +
            "   live accepted? " + both.accepted("$dLive") +
            "   agreed length: " + both.gate);

const verdict =
  (!both.accepted("$dStale") && both.accepted("$dLive") && both.gate === 250 &&
   staleOnly.gate === null);
console.log("\n  " + (verdict
  ? "A behind client's declaration NEVER reaches the agreed length: it is refused at its own\n" +
    "  fold position for not naming the live playing, so it is not folded, not protected, and\n" +
    "  cannot move the gate. The control admits the same declaration one detail changed, so the\n" +
    "  refusal is attributable to the pi and not to a fixture that missed the reducer.\n" +
    "  => the send site does not need a gate. What it would need, if gated naively, is a\n" +
    "     DEFERRAL — setDuration has no retry, so a refusal there is a DROP, and a dropped\n" +
    "     declaration costs the room its agreed length for that song."
  : "UNEXPECTED — re-read before concluding anything.") + "\n");
