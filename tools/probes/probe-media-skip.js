// probe-media-skip.js — DIAGNOSTIC, not a guard. Answers ONE question:
//
//   Can a client be CORROBORATED-SHORT (Continuity.mayAdvance -> "short", so the restraint
//   says hold still) while its own derived head is still the ROOM'S head (so the advance
//   lock would ACCEPT an advance it authors)?
//
// That intersection is the whole finding. If it is empty, `ddjp.media.skip` being authored
// outside the restraint is inert and check-wiring's recorded rationale ("a stale instance is
// dropped by the advance lock") already covers it. If it is non-empty, the restraint has a
// hole on exactly the path it was designed for.
//
// Built on tests/_fixtures.js — a hand-typed log reports absence, and absence reads like a
// finding (that file's own header).

const path = require("path");
const T = "/home/claude/proj/code/ddjp_239/tests";
const { loadInContext } = require(path.join(T, "_load.js"));
const F = require(path.join(T, "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
  "core/playlistdoc.js",
  "backends/backend1/vouch.js",
  "backends/backend1/continuity.js",
], { Date, Math, JSON });
const { StateDeriver, Continuity, Vouch } = sb;

const NO_FLOOR = -1;
const settings = StateDeriver.defaultSettings();

function head(log) {
  const st = StateDeriver.derive(F.sortLog(log));
  return st.nowPlaying ? st.nowPlaying.pi : null;
}
function verdict(held) {
  return Continuity.mayAdvance(held.map(F.toRaw), settings, NO_FLOOR, null);
}
function line(name, roomHead, myHead, v) {
  console.log(
    "  " + name.padEnd(34) +
    " roomHead=" + String(roomHead).padEnd(8) +
    " myHead=" + String(myHead).padEnd(8) +
    " lockWouldAccept=" + String(myHead === roomHead).padEnd(6) +
    " restraint=" + v.state + (v.corroborated ? " [" + v.corroborated.join(",") + "]" : "")
  );
}

// The room: four plays, one DJ, always stocked. This is the ROOM's truth.
const room = F.playingRoom({ songs: 4 });
const roomHead = head(room.log);
console.log("\nmedia.skip probe — the room's head is " + roomHead + "\n");

// ── CASE 1: the case I reasoned my way to first — a hole INSIDE my own chain ───────────
// I am missing $play1. Everything after it names a parent I lack, so my fold refuses it.
{
  const held = room.log.filter((e) => e.eventId !== "$play1");
  Vouch.forgetTombstones();
  Vouch.rememberTombstone({ id: "$play1", sender: room.dj, rank: F.RANK.player,
                            roomId: F.ROOM, ts: 1 });   // I watched it be deleted
  line("1. gap inside my own chain", roomHead, head(held), verdict(held));
}

// ── CASE 2: the case the restraint was actually DESIGNED for ──────────────────────────
// I hold the whole room. Somebody else advances from a parent I have never held ($ghost) —
// CONCEPTS §5.2's "you are behind, or they are lying, and you cannot tell which". Their
// advance is refused by my fold (stale parent), so my head does not move. The question is
// whether the restraint fires while my head is still the room's.
function ghostCase(label, corroborate) {
  Vouch.forgetTombstones();
  const held = room.log.slice();
  held.push(F.reducerEvent("$zz", room.lastL + 1, 900000, "@stranger:hs", F.RANK.player,
    { t: "ddjp.dj.play", p: "$ghost" }));
  corroborate(held);
  line(label, roomHead, head(held), verdict(held));
}

ghostCase("2a. ghost parent, uncorroborated", () => {});
ghostCase("2b. ghost parent + tombstone", () => {
  Vouch.rememberTombstone({ id: "$ghost", sender: "@stranger:hs", rank: F.RANK.player,
                            roomId: F.ROOM, ts: 1 });
});
ghostCase("2c. ghost, 2 builders @player", (held) => {
  held.push(F.reducerEvent("$zz2", room.lastL + 2, 900001, "@other:hs", F.RANK.player,
    { t: "ddjp.dj.play", p: "$ghost" }));
});
// 2c reads as "two builders are not enough" and that is NOT what it shows: player is a
// `enough: null` rung, so its word corroborates nothing — the structural floor doing its job.
// The same two builders at a rung that can satisfy a bar DO corroborate.
ghostCase("2d. ghost, 2 builders @vip", (held) => {
  held[held.length - 1] = F.reducerEvent("$zz", room.lastL + 1, 900000, "@stranger:hs", F.RANK.vip,
    { t: "ddjp.dj.play", p: "$ghost" });
  held.push(F.reducerEvent("$zz2", room.lastL + 2, 900001, "@other:hs", F.RANK.vip,
    { t: "ddjp.dj.play", p: "$ghost" }));
});

// ── CONTROL: hold everything, no ghost. Must be whole, and must match the room. ────────
{
  Vouch.forgetTombstones();
  line("C. control — whole client", roomHead, head(room.log), verdict(room.log));
}

console.log("\nRead rows 1 and 2b together — they are the whole answer:");
console.log("  · a corroborated gap INSIDE my accepted chain leaves my head stale, so the lock");
console.log("    refuses anything I author. The recorded rationale covers this case.");
console.log("  · a corroborated gap on a parent that is NOT in my accepted chain leaves my head");
console.log("    CURRENT, so the lock accepts. The restraint fires and media.skip ignores it.");
console.log("  So the intersection is non-empty, and the event I would author names the head the");
console.log("  room agrees on — which is why it cannot fork anybody. A rule with a hole, not a");
console.log("  live fork.\n");
