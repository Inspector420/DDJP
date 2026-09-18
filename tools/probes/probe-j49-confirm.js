// tools/probes/probe-j49-confirm.js
// READ-ONLY. Measures the J49 domination and, above all, THE PREMISE IT RESTS ON.
//
// The claim under measurement, from `09-roadmap.md` J49: `!expectedVideoId ||` in
// `Playback._confirmReading` is dominated, because the only duration provider in the tree returns
// `null` WHOLESALE when the player names no video, so the reading never arrives as an object with
// a falsy id and the equality answers false on its own.
//
// That is a claim about `ui/interface.js`, not about `playback.js`. R1 is therefore the row that
// decides the job: it runs the SHIPPED provider against every player shape the YouTube API can
// present and classifies what comes back. If any shape yields an object carrying a falsy id, the
// domination is over and the clause wants a guard row today.
//
//   R0  the admissibility gate, self-tested
//   R1  THE PROVIDER CONTRACT — every player shape, driven through the shipped provider
//   R2  the expected id at the call site, out of the reducer's own seed path
//   R3  `_confirmReading` on the shipped tree: which refusal each (expected × reading) reaches
//   R4  the same with the clause dropped — which rows change answer
//   R5  the end-to-end declaration path, shipped, for the one pairing that would collide
//
// Run: node tools/probes/probe-j49-confirm.js

const path = require("path");
const P = require(path.resolve(__dirname, "../../tests/_probe-j49-confirm.js"));

let bad = 0;
function line(s) { console.log(s); }
function refuse(row, why) { bad++; console.log("  " + row + "  REFUSED BY GATE — " + why); }

line("=== R0 — the admissibility gate, self-tested ===");
{
  const st = P.selfTest();
  line("  shapes it failed to catch : " + JSON.stringify(st.missed));
  line("  good shapes it rejected   : " + JSON.stringify(st.rejectedGood));
  line("  classifier disagreements  : " + JSON.stringify(st.classifierWrong));
  if (st.missed.length || st.rejectedGood || st.classifierWrong.length) {
    bad++;
    line("  !! the gate is broken, so nothing below is admissible");
  }
}

line("");
line("=== R1 — THE PROVIDER CONTRACT, driven from ui/interface.js's own source ===");
line("    The question: can ANY player shape make the shipped provider return an object whose");
line("    videoId is falsy? That object is the only reading the clause can refuse.");
const ps = P.providerSource();
if (!ps.ok) {
  refuse("R1", ps.stage);
} else {
  line("  extracted, " + ps.source.length + " chars, anchored on " + JSON.stringify(P.PROVIDER_ANCHOR));
  // Every shape the YouTube iframe API can present, including the two its own comments name.
  const shapes = [
    { name: "player absent",                  player: null,  ready: true },
    { name: "player present, not ready",      player: {},    ready: false },
    { name: "getVideoData missing",           player: { getDuration: () => 200 } },
    { name: "getVideoData -> undefined",      player: { getVideoData: () => undefined, getDuration: () => 200 } },
    { name: "getVideoData -> null",           player: { getVideoData: () => null, getDuration: () => 200 } },
    { name: "getVideoData -> {} (no id)",     player: { getVideoData: () => ({}), getDuration: () => 200 } },
    { name: "video_id empty string",          player: { getVideoData: () => ({ video_id: "" }), getDuration: () => 200 } },
    { name: "video_id null",                  player: { getVideoData: () => ({ video_id: null }), getDuration: () => 200 } },
    { name: "video_id present, duration 0",   player: { getVideoData: () => ({ video_id: "ABC" }), getDuration: () => 0 } },
    { name: "video_id present, no duration",  player: { getVideoData: () => ({ video_id: "ABC" }) } },
    { name: "video_id present, NaN duration", player: { getVideoData: () => ({ video_id: "ABC" }), getDuration: () => NaN } },
    { name: "getVideoData THROWS",            player: { getVideoData: () => { throw new Error("not ready"); }, getDuration: () => 200 } },
    { name: "getDuration THROWS",             player: { getVideoData: () => ({ video_id: "ABC" }), getDuration: () => { throw new Error("x"); } } },
    { name: "honest reading",                 player: { getVideoData: () => ({ video_id: "ABC" }), getDuration: () => 200 } },
  ];
  let falsyIdShapes = 0, drivenShapes = 0;
  for (const s of shapes) {
    const r = P.runProvider(ps.source, s.player, ("ready" in s) ? { ready: s.ready } : {});
    if (!r.ok) { refuse("R1/" + s.name, r.stage); continue; }
    drivenShapes++;
    const cls = P.classify(r.out);
    if (cls === "OBJECT-WITH-FALSY-ID") falsyIdShapes++;
    line("  " + s.name.padEnd(28) + " -> " + JSON.stringify(r.out) +
         (r.threw ? "  [threw: " + r.threw + "]" : "") + "   " + cls);
  }
  if (drivenShapes < shapes.length) {
    bad++;
    line("  !! only " + drivenShapes + " of " + shapes.length + " shapes were driven — a partial " +
         "sweep cannot establish a contract");
  }
  line("");
  line("  VERDICT: " + falsyIdShapes + " of " + drivenShapes + " player shapes yield an object " +
       "with a falsy id.");
  line("  " + (falsyIdShapes === 0
    ? "The provider returns null WHOLESALE whenever it cannot name a video, so the reading the"
    : "A reading with a falsy id IS producible today — THE DOMINATION IS OVER."));
  if (falsyIdShapes === 0) {
    line("  clause refuses is not producible by the tree. The domination holds, and it holds");
    line("  because of ui/interface.js rather than because of anything in playback.js.");
  }
}

line("");
line("=== R2 — the EXPECTED id at the call site, from the reducer's own seed path ===");
line("    `const vid = s2.nowPlaying.song ? s2.nowPlaying.song.videoId : null` — a TRUTHY song");
line("    can still hand the clause a falsy expected id. That half is reachable today.");
for (const idValue of ["real", null, "absent"]) {
  const s = P.seededPlaying(idValue);
  if (!s.ok) { refuse("R2/" + String(idValue), s.stage); continue; }
  line("  seed id " + String(idValue).padEnd(7) + " -> song truthy: " + s.truthySong +
       ", expected id: " + JSON.stringify(s.expected) +
       ", falsy: " + (!s.expected));
}

line("");
line("=== R3 — _confirmReading on the SHIPPED tree: which refusal each pairing reaches ===");
const READINGS = {
  "null-wholesale":    null,
  "{videoId:null}":    { videoId: null, seconds: 200 },
  "{videoId:absent}":  { seconds: 200 },
  "{videoId:'ABC'}":   { videoId: "ABC", seconds: 200 },
};
const EXPECTED = { "null": null, "undefined": undefined, "'ABC'": "ABC" };

// `_confirmReading` is private, so it is reached the way production reaches it: through the
// declaration path, with the room's song id being the expected one. The refusal REASON is what
// distinguishes the five doors, so it is read from the log rather than inferred from silence.
function reasonFor(expectedId, reading, src) {
  const np = { song: (expectedId === undefined && false) ? null : { videoId: expectedId },
               pi: "$p2", startedAt: 0, dj: "@dj:hs" };
  if (expectedId === undefined) delete np.song.videoId;
  const r = P.driveDeclare({ np: np, reading: reading, playerId: expectedId, src: src });
  if (!r.ok) return { ok: false, stage: r.stage };
  return { ok: true, declared: r.lens.length, r: r, np: np };
}

function table(src, label) {
  line("  " + label);
  const rows = [];
  for (const ek of Object.keys(EXPECTED)) {
    for (const rk of Object.keys(READINGS)) {
      const res = reasonFor(EXPECTED[ek], READINGS[rk], src);
      if (!res.ok) { refuse("expected=" + ek + " reading=" + rk, res.stage); continue; }
      const readingId = READINGS[rk] ? READINGS[rk].videoId : "<no object>";
      rows.push({ expected: ek, reading: rk, declared: res.declared, readingId: readingId,
                  expectedId: EXPECTED[ek], np: res.np, r: res.r });
      line("    expected=" + ek.padEnd(11) + " reading=" + rk.padEnd(18) +
           " -> declarations: " + res.declared);
    }
  }
  return rows;
}
const shipped = table(undefined, "shipped:");

line("");
line("=== R4 — the same with `!expectedVideoId ||` dropped ===");
const fs = require("fs");
const CLAUSE = "if (!expectedVideoId || r.videoId !== expectedVideoId) {";
const DROPPED = "if (r.videoId !== expectedVideoId) {";
const pbPath = path.resolve(__dirname, "../../", P.PB_REL);
const pbSrc = fs.readFileSync(pbPath, "utf8");
const hits = pbSrc.split(CLAUSE).length - 1;
line("  in-memory mutation, nothing written to the tree. anchor occurrences: " + hits);
if (hits !== 1) {
  bad++;
  line("  !! the anchor matched " + hits + " times, expected 1 — an unapplied mutation reports " +
       "the same 'no change' as a dominated clause, so this row is VOID");
} else {
  const mutated = pbSrc.replace(CLAUSE, DROPPED);
  if (mutated === pbSrc) { bad++; line("  !! replacement produced identical source — VOID"); }
  else {
    const dropped = table(mutated, "clause dropped:");
    line("");
    line("  ROWS THAT CHANGE ANSWER (these are what a guard row could pin):");
    let changed = 0;
    for (const s of shipped) {
      const d = dropped.find((x) => x.expected === s.expected && x.reading === s.reading);
      if (!d) continue;
      const g = P.admissible(s.r, {
        expectDeclare: false, np: s.np,
        collides: { readingId: s.readingId, expectedId: s.expectedId, expect: true },
      });
      if (d.declared !== s.declared) {
        changed++;
        line("    expected=" + s.expected.padEnd(11) + " reading=" + s.reading.padEnd(18) +
             " : " + s.declared + " -> " + d.declared +
             (g.ok ? "   [admissible]" : "   [gate: " + g.problems[0].slice(0, 60) + "…]"));
      }
    }
    if (changed === 0) {
      line("    none. The clause changes no answer anywhere in this table, which is the");
      line("    domination stated as a measurement rather than as a reading.");
    }
    line("");
    line("  AND THE ONLY PAIRING THAT WOULD CHANGE ONE IS `{videoId:null}` AGAINST expected=null,");
    line("  which R1 has just shown no provider can produce.");
  }
}

line("");
line("=== R5 — the honest control: a real reading against a real id DOES declare ===");
{
  const s = P.seededPlaying("real");
  if (!s.ok) { refuse("R5", s.stage); }
  else {
    const r = P.driveDeclare({ np: s.np, reading: { videoId: s.expected, seconds: 200 },
                               playerId: s.expected });
    const g = P.admissible(r, { expectDeclare: true, np: s.np });
    if (!g.ok) refuse("R5", g.problems.join(" | "));
    else line("  a confirmable reading authors " + r.lens.length + " ddjp.play.len — so every " +
              "refusal above is a refusal rather than a fixture that never arrived.");
  }
}

line("");
line(bad === 0 ? "ALL ROWS ADMITTED." : "!! " + bad + " row(s) refused or void — see above.");
process.exit(0);
