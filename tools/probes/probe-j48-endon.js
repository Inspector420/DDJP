#!/usr/bin/env node
// tools/probes/probe-j48-endon.js
// READ-ONLY. Writes nothing, mutates nothing. It answers the question J48 is actually about:
//
//   can the room be in a state where `Playback.shouldEndOn`'s `videoId &&` clause is the ONLY
//   thing standing between an unconfirmable ENDED and an authored advance — and can the signal
//   arrive in the shape that collides with it?
//
// Both halves belong to other modules, so both are DRIVEN: the state out of `StateDeriver`'s seed
// path, the signal out of `ui/interface.js`'s own ENDED branch. Everything printed below is a
// reading of the shipped tree; the mutation runner beside this file is what shows which readings
// are load-bearing.
//
//   R0  the admissibility gate catches its own breakage
//   R1  the SEED PATH: what the fold builds from a song object with no usable id
//   R2  the WIRE: what the shipped ENDED branch forwards when the player cannot say
//   R3  the COLLISION: which (state, signal) pairs make the equality answer TRUE
//   R4  the CONSEQUENCE: does an advance reach the transport, per pair
//   R5  the CONTROL: an honest id at both ends must advance, or every refusal above is free

const path = require("path");
const P = require(path.join(__dirname, "..", "..", "tests", "_probe-j48-endon.js"));

let bad = 0;
const line = (s) => console.log(s);
const J = (v) => JSON.stringify(v);

line("── R0 — the gate's own test ──────────────────────────────────────────────────");
{
  const st = P.selfTest();
  if (st.missed.length) { bad++; line("   REFUSED: the gate MISSED " + J(st.missed)); }
  else line("   the gate catches every shape it claims to: incomplete drive, a throw, a control " +
            "that authored nothing, a refusal row that authored one, no playing, no song object, " +
            "and a pair whose equality does not collide");
  if (st.rejectedGood) { bad++; line("   REFUSED: the gate rejects good readings " + J(st.rejectedGood)); }
  else line("   and it still ADMITS an honest refusal and an honest control, so it is not " +
            "refusing everything for free");
}

line("");
line("── R1 — the seed path (backends/backend1/statederiver.js) ────────────────────");
const states = {};
for (const kind of ["real", null, "absent"]) {
  const s = P.seededState(kind);
  if (!s.ok) { bad++; line("   REFUSED (" + kind + "): " + s.stage); continue; }
  states[String(kind)] = s.np;
  const song = s.np.song;
  line("   seed song id " + String(kind).padEnd(7) + " -> np.song = " + J(song) +
       "   truthy song: " + !!song + "   id: " + J(song ? song.videoId : null));
}
line("   The fold copies `n.song.videoId` with no type check and guards " +
     "`nowPlaying.song && nowPlaying.song.videoId` on the very next line, so a song object");
line("   without a usable id survives as a TRUTHY song the room cannot name. An honest fold " +
     "cannot produce this — `dj.join`/`dj.declare` refuse a non-string `v` — so the");
line("   state arrives from a SEED (a peer's checkpoint body, or an imported save file), which " +
     "is read from the wire without a shape check on the song.");

line("");
line("── R2 — the wire (ui/interface.js, the main player's ENDED branch) ───────────");
const wire = {};
for (const [name, data, opts] of [
  ["getVideoData() -> undefined (the documented mid-swap reading)", undefined, null],
  ["getVideoData() -> {} with no video_id", {}, null],
  ["getVideoData() throws", null, { throws: true }],
  ["getVideoData() -> a real id", { video_id: "SONG0" }, null],
]) {
  const r = P.endedIdFromWire(data, opts);
  if (!r.ok) { bad++; line("   REFUSED: " + r.stage); continue; }
  if (r.threw) { bad++; line("   REFUSED: the handler threw (" + r.threw + ")"); continue; }
  wire[name] = r.forwarded[0];
  line("   " + name.padEnd(58) + " -> notifyEnded(" + J(r.forwarded[0]) + ")");
}
line("   So an unconfirmable reading reaches Playback as exactly `null`, never as `undefined`: " +
     "the handler declares `let endedId = null` and only overwrites it");
line("   when the player names a video. That is the half of the pair no amount of reading " +
     "playback.js can answer, and it decides which absence the clause defends.");

line("");
line("── R3 — the collision ────────────────────────────────────────────────────────");
const pairs = [
  ["seed id NULL   + ENDED null      (reachable through today's wire)", states["null"], null],
  ["seed id ABSENT + ENDED null      (the pairing J48's entry describes)", states["absent"], null],
  ["seed id ABSENT + ENDED undefined (needs a caller that passes one)", states["absent"], undefined],
  ["seed id REAL   + ENDED matching  (the control)", states["real"], states["real"] && states["real"].song.videoId],
];
for (const [name, np, id] of pairs) {
  if (!np) { bad++; line("   REFUSED: no state for " + name); continue; }
  const eq = !!(np.song && np.song.videoId === id);
  const idPresent = !!id;
  line("   " + name.padEnd(58) + " equality answers " +
    (eq
      ? (idPresent ? "TRUE, id present  <- an honest match; the clause passes it"
                   : "TRUE on two ABSENCES  <- the clause is the only bar")
      : "false  <- refused with or without the clause; pins nothing"));
}

line("");
line("── R4/R5 — the consequence, and the control ──────────────────────────────────");
for (const [name, np, id, expectAdvance] of [
  ["seed id NULL   + ENDED null", states["null"], null, false],
  ["seed id ABSENT + ENDED null", states["absent"], null, false],
  ["seed id ABSENT + ENDED undefined", states["absent"], undefined, false],
  ["CONTROL: seed id REAL + ENDED matching", states["real"],
   states["real"] && states["real"].song.videoId, true],
]) {
  if (!np) { bad++; continue; }
  const r = P.driveEnded(np, id);
  const a = P.admissible(r, { expectAdvance: expectAdvance, np: np });
  if (!a.ok) { bad++; line("   REFUSED: " + name + " — " + J(a.problems)); continue; }
  line("   " + name.padEnd(42) + " advances authored: " + r.advances.length +
       "   ended pushes: " + r.endedPushes.length);
}

line("");
line(bad === 0
  ? "[probe-j48] every row admitted. The state is the reducer's, the signal is the UI's, and the " +
    "control authored a real advance — so the refusals above are the clause and not the fixture."
  : "[probe-j48] " + bad + " row(s) REFUSED — read the stages above; nothing here is a finding " +
    "until they are cleared.");
process.exit(bad === 0 ? 0 : 1);
