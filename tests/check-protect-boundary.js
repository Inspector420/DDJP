// tests/check-protect-boundary.js
// SUBJECT: backends/backend1/vouch.js, backends/backend1/continuity.js, backends/backend1/checkpoint.js
// WALL: PROTECTION JUDGES AN EVENT AT THE FLOOR'S POSITION BY ITS ID, AS THE FOLD DOES (J73 job 1b).
//
// A checkpoint folds everything up to AND INCLUDING its boundary in the fold's own order — position,
// then id — and `floorL` is the boundary's position, so an event sharing that position whose id sorts
// AFTER the boundary is not in the seed (`check-trim-boundary` holds that for the trim). J73 job 1's
// sweep found four protection-side places still deciding "banked" by position alone, so such an
// event read as already summarised: owed no vouch, retirable from the raw cache, outside the gap
// scan, and not required to be covered before the next seal. Ruling 1 covers protection too
// (owner, `ddjp_513` audit), so each now carries the boundary id and applies `Floor.afterBoundary`'s
// rule — including its answer when the id is UNKNOWN: an event at the floor is then NOT banked, which
// for protection is the careful direction.
//   PART A — `Vouch.owed`: the event after the boundary is owed; the boundary and before are not.
//   PART B — `Vouch._criticalPositions`: it counts as a turn.
//   PART C — `Vouch.mayRetire`: its raw copy is kept; the boundary's may go.
//   PART D — `Continuity.mayAdvance`: a missing parent it names is seen, not hidden below the floor.
//   PART E — `Checkpoint.coverageVerdict`: it is in the span a seal must cover.
//   PART F — every site agrees with `Floor.afterBoundary` across the boundary, known id and unknown.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[protect-boundary] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/dials.js", "backends/backend1/scheduler.js",
  "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
  "backends/backend1/vouch.js", "backends/backend1/floor.js", "backends/backend1/continuity.js",
  "backends/backend1/checkpoint.js"].filter((f) => fs.existsSync(path.join(ROOT, f)));
const sb = loadInContext(FILES, {});
const { Vouch, Floor, Continuity, Checkpoint, Ranks, StateDeriver } = sb;
ok(Vouch && Floor && Continuity && Checkpoint, "PREMISE — the real modules load", FILES);
const PLY = Ranks.levelOf("player"), STAFF = Ranks.levelOf("staff"), OWN = Ranks.levelOf("owner");
const S = StateDeriver.defaultSettings();
const FL = 5, BID = "$m";
function raw(id, l, body, sender) {
  return { event_id: id, type: "m.room.message", room_id: "!r:hs", sender: sender || "@g:hs", senderRank: PLY,
           l: l, ts: 1000 + l, content: { msgtype: "m.text", body: JSON.stringify(Object.assign({ l: l }, body)) } };
}
const join = (id, l) => raw(id, l, { t: "ddjp.dj.join", v: "vid" + id.replace("$", "").padStart(8, "0") });
// Three at the floor's position (before the boundary, the boundary, after it), one below, one above.
const HELD = [join("$y", 4), join("$a", 5), join("$m", 5), join("$z", 5), join("$w", 6)];
const legal = () => true;

// ── PART A — Vouch.owed ─────────────────────────────────────────────────────────────────────
{
  const o = (floorId) => Vouch.owed(HELD, { myRank: STAFF, myUserId: "@me:hs", settings: S, isLegal: legal,
                                             rng: () => 0.5, floorL: FL, floorId: floorId });
  const r = o(BID);
  ok(r.bankedSkipped === 3, "A: with the boundary known, exactly the three at or before it are banked ($y, $a, $m)", r.bankedSkipped);
  ok(r.owedTotal === 2, "A: the event after the boundary ($z) is owed along with the one above ($w)", r.owedTotal);
  const u = o(undefined);
  ok(u.bankedSkipped === 1 && u.owedTotal === 4,
    "A: with the boundary id UNKNOWN only what lies below the floor is banked — careful, as Floor.afterBoundary is", u);
  const n = Vouch.owed(HELD, { myRank: STAFF, myUserId: "@me:hs", settings: S, isLegal: legal, rng: () => 0.5, floorL: null });
  ok(n.bankedSkipped === 0 && n.owedTotal === 5, "A CONTROL: with no floor nothing is banked — the count can move", n);
}
// ── PART B — Vouch._criticalPositions ───────────────────────────────────────────────────────
{
  const p = Vouch._criticalPositions(HELD, FL, BID);
  ok(JSON.stringify(p) === JSON.stringify([5, 6]), "B: the event after the boundary counts as a turn; the banked ones do not", p);
  ok(JSON.stringify(Vouch._criticalPositions(HELD, null)) === JSON.stringify([4, 5, 5, 5, 6]),
    "B CONTROL: with no floor every critical event is a turn", Vouch._criticalPositions(HELD, null));
}
// ── PART C — Vouch.mayRetire ────────────────────────────────────────────────────────────────
{
  const author = { u: "@g:hs", r: PLY };
  const mr = (l, id, bid) => Vouch.mayRetire(l, [], author, FL, S, OWN, id, bid);
  ok(mr(5, "$z", BID) === false, "C: the raw copy of an event after the boundary is KEPT — the seed never summarised it");
  ok(mr(5, "$m", BID) === true && mr(5, "$a", BID) === true && mr(4, "$y", BID) === true,
    "C: the boundary event, one before it and one below may go — they are in the seed");
  ok(mr(5, "$m", undefined) === false, "C: with the boundary id unknown, an event at the floor is kept (careful)");
  ok(mr(6, "$w", BID) === false, "C CONTROL: an unprotected event above the floor is kept, as before");
}
// ── PART D — Continuity.mayAdvance ──────────────────────────────────────────────────────────
{
  const play = (id) => raw(id, 5, { t: "ddjp.dj.play", p: "$gone" });   // names a parent nobody holds
  const seen = (id) => Continuity.mayAdvance([join("$y", 4), play(id)], S, FL, null, BID);
  ok(seen("$z").state !== "whole", "D: a missing parent named by an event AFTER the boundary is seen, not hidden below the floor", seen("$z"));
  ok(seen("$a").state === "whole", "D CONTROL: the same reference from an event BEFORE the boundary is banked history, not a hole", seen("$a"));
}
// ── PART E — Checkpoint.coverageVerdict ─────────────────────────────────────────────────────
{
  const verdict = (held) => {
    Floor.reset();
    Floor._setTrustedForTest({ n: 1, h: "h1", floorL: FL, grade: "verified", covers: "$y.." + BID,
                               seed: StateDeriver.buildSeed([], undefined), prev: null, thin: false });
    Checkpoint.attach({ held: () => held, settings: () => S, myUserId: () => "@me:hs", myRank: () => STAFF,
                        isLegal: () => legal });
    return Checkpoint.coverageVerdict();
  };
  const after = verdict([join("$y", 4), join("$m", 5), join("$z", 5)]);
  ok(after.mode !== "empty-span", "E: an event after the boundary is in the span a seal must cover", after);
  const before = verdict([join("$y", 4), join("$a", 5), join("$m", 5)]);
  ok(before.ok === true && before.mode === "empty-span", "E CONTROL: with nothing after the boundary the span is empty, as before", before);
}
// ── PART F — every site agrees with the rule's home ─────────────────────────────────────────
{
  const author = { u: "@g:hs", r: PLY };
  let disagree = [];
  for (const bid of [BID, null]) for (const l of [4, 5, 6]) for (const id of ["$a", "$m", "$z"]) {
    const home = Floor.afterBoundary([{ l: l, eventId: id }], FL, bid).length === 0;   // banked by the fold's own rule
    const retire = Vouch.mayRetire(l, [], author, FL, S, OWN, id, bid);             // unprotected: retire iff banked
    const turn = Vouch._criticalPositions([join(id, l)], FL, bid).length === 0;
    const owedR = Vouch.owed([join(id, l)], { myRank: STAFF, myUserId: "@me:hs", settings: S, isLegal: legal,
                                             rng: () => 0.5, floorL: FL, floorId: bid });
    const owedBanked = owedR.bankedSkipped === 1;
    if (retire !== home || turn !== home || owedBanked !== home) disagree.push({ bid, l, id, home, retire, turn, owedBanked });
  }
  ok(disagree.length === 0, "F: Vouch.mayRetire, _criticalPositions and owed decide 'banked' exactly as Floor.afterBoundary does", disagree);
}

// ── PART G — every production caller carries the boundary id ────────────────────────────────
// The parts above call the modules directly; this one reads the callers, so a site that stops
// passing the id fails here rather than silently going back to the careful-but-wrong answer.
{
  const files = ["backends/backend1/matrixbridge.js", "backends/backend1/checkpoint.js", "backends/backend1/eventcache.js"];
  const calls = [];
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, f), "utf8");
    for (const [name, needle, carries] of [
      ["Vouch.owed", "Vouch.owed(", /floorId:\s*_floorBoundaryId\(\)/],
      ["Continuity.mayAdvance", "Continuity.mayAdvance(", /_banked,\s*(_floorBoundaryId\(\)|_fid)\)/],
      ["Vouch.mayRetire", "Vouch.mayRetire(", /it\.key,\s*floorId\)/]]) {
      let i = src.indexOf(needle);
      while (i >= 0) {
        const lineStart = src.lastIndexOf("\n", i) + 1;
        if (!/^\s*\/\//.test(src.slice(lineStart, i))) {
          const seg = src.slice(i, src.indexOf(";", i) + 1);
          calls.push({ f, name, ok: carries.test(seg) });
        }
        i = src.indexOf(needle, i + 1);
      }
    }
  }
  ok(calls.filter((c) => c.name === "Vouch.owed").length === 3 && calls.filter((c) => c.name === "Continuity.mayAdvance").length === 2 &&
     calls.filter((c) => c.name === "Vouch.mayRetire").length === 2,   // 2 since J73: EventCache asks display-only items too
    "G PREMISE — the scan finds every caller (3 owed, 2 mayAdvance, 2 mayRetire), or a pass means nothing",
    calls.map((c) => c.f.split("/").pop() + ":" + c.name));
  ok(calls.every((c) => c.ok), "G: every production caller passes the floor's boundary id beside its position",
    calls.filter((c) => !c.ok));
}

// ── PART H — a floor that names no boundary id never becomes current ─────────────────────────
// The careful default (unknown id: nothing at the floor is banked) is only ever reached if a floor
// without an id can be adopted. Both builders write `first..last`; this makes the rest structural —
// `Floor.remember`, the one intake, refuses a checkpoint whose `covers` names no boundary id.
{
  const CF = sb.CheckpointFormat;
  const seed = StateDeriver.buildSeed([], undefined);
  const tryAdopt = (covers) => {
    Floor.reset();
    const cp = { n: 1, prev: null, seed: seed, floorL: 5, thin: false, covers: covers };
    cp.h = CF.fingerprint(1, null, seed, 5, false, covers);
    const remembered = Floor.remember(cp, OWN, "@owner:hs", 1000);
    const sel = Floor.select(STAFF, S);
    if (sel) Floor.adopt(sel);
    const cur = Floor.current();
    return { remembered, adopted: !!cur, id: cur ? (Floor.boundaryOf(cur) || {}).id : null };
  };
  const good = tryAdopt("$a.." + BID);
  ok(good.adopted && good.id === BID, "H CONTROL: a floor naming its boundary id is adopted — the path works", good);
  ok(!tryAdopt(BID).adopted, "H: a floor whose covers names no boundary id never becomes current", tryAdopt(BID));
  ok(!tryAdopt("$a..").adopted, "H: nor one whose boundary id is empty", tryAdopt("$a.."));
  Floor.reset();
}

if (failed) { console.log("[protect-boundary] " + failed + " failure(s)"); process.exit(1); }
console.log("[protect-boundary] PASS — protection judges an event at the floor's position by its id, as the fold does " +
  "(J73 job 1b): owed a vouch, counted as a turn, kept in the raw cache, seen by the gap scan and covered before a " +
  "seal when it sorts after the boundary; banked when it is the boundary or before it; careful when the id is " +
  "unknown. Every site agrees with Floor.afterBoundary across the boundary (" + asserts + " assertions)");
