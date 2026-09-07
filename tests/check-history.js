// tests/check-history.js
// WALL: HISTORY SURVIVES THE FORGET.
//
// This module exists because two features were fighting. The play-log was a byproduct of the live
// fold and deliberately NOT sealed into checkpoints — correct, a snapshot carries what is needed to
// keep playing and a play-log is not that. But forgetting is switched on, so the moment a client
// adopted a floor and trimmed below it, the History pane emptied to whatever had happened since.
//
// PART A — history is DERIVED, never scanned. A play's videoId is not in its event body.
// PART B — it keeps what it already read when the live log is trimmed. THE FIX.
// PART C — overlapping reads dedup, so paging can be sloppy and repeated.
// PART D — order is (start stamp, instance), never stamp alone.
// PART E — it EVICTS at the cap rather than refusing. Regenerable data, opposite policy to truth.
// PART F — coverage is honest: it says how much of the room it can actually account for.
// PART G — it is inert. Nothing here can move the room.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");

function fail(m, g) { console.log("[history] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

function tree() {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/history.js",
  ], {});
}

const ROOM = F.playingRoom({ songs: 6 });
const LOG = F.sortLog(ROOM.log);

// ── PART A — derived, not scanned ────────────────────────────────────────────────────────────
{
  const sb = tree();
  sb.History.attach({ log: () => LOG });
  sb.History.ingest(LOG);
  const rec = sb.History.recent();
  ok(rec.length === 6, "A: six plays produce six history entries", rec.length);
  ok(rec.every((e) => typeof e.videoId === "string" && e.videoId.length > 0),
    "A: APPLIED — every entry has a videoId. It is NOT a field in the play event; it is whatever "
    + "the reducer pops from the head DJ's buffer, so this can only come from folding",
    rec.map((e) => e.videoId));
  ok(rec[0].pi === ROOM.pi(5) && rec[rec.length - 1].pi === ROOM.pi(0),
    "A: newest first", { first: rec[0].pi, last: rec[rec.length - 1].pi });
}

// ── PART B — it survives the live log being trimmed ──────────────────────────────────────────
{
  const sb = tree();
  let liveLog = LOG.slice();
  sb.History.attach({ log: () => liveLog });
  sb.History.refresh();
  const before = sb.History.count();
  ok(before === 6, "B: setup — six plays read", before);

  // the client adopts a floor and forgets everything below it
  liveLog = LOG.slice(8);
  const afterTrimLive = sb.History.foldRange(liveLog).length;
  ok(afterTrimLive < before,
    "B: setup — the LIVE fold alone would now show fewer plays, which is the old behaviour",
    { live: afterTrimLive, was: before });

  sb.History.refresh();               // history re-reads the (now shorter) live log
  ok(sb.History.count() === before,
    "B: APPLIED — history KEEPS what it already read. Trimming the derived log no longer empties "
    + "the pane, which is the conflict this module was separated to resolve",
    { now: sb.History.count(), was: before });
}

// ── PART B2 — a trimmed log without a seed is REFUSED, not folded into silence ────────────────
// A play's videoId is not in its event body, so history can only be produced by folding — and a
// fold needs somewhere to start. Given a mid-log SEGMENT with no seed, every play names a parent
// the fold has never seen, the advance lock refuses all of them, and the result is not "fewer
// entries" but ZERO. That failure is silent and arrives exactly when forgetting is switched on.
{
  const sb = tree();
  const segment = LOG.slice(6);                       // starts mid-history
  ok(sb.History._looksLikeSegment(segment) === true,
    "B2: a log whose first advance follows something is a SEGMENT, not a genesis log");
  ok(sb.History._looksLikeSegment(LOG) === false, "B2: and the full log is not");

  sb.History.attach({ log: () => segment });
  const refused = sb.History.refresh();
  ok(refused.refused === "segment-without-seed" && refused.added === 0,
    "B2: APPLIED — folding it anyway would produce an EMPTY history that looks exactly like a "
    + "quiet room. Refusing says 'I cannot produce history for this stretch', which is information; "
    + "an empty list that looks plausible is not", refused);

  const sb2 = tree();
  sb2.History.attach({ log: () => segment, seed: () => sb2.StateDeriver.buildSeed(LOG.slice(0, 6)) });
  const ok2 = sb2.History.refresh();
  ok(ok2.added > 0,
    "B2: APPLIED — and WITH the floor's seed the same segment folds correctly, so the answer was "
    + "to supply the starting point rather than to lower the bar", ok2);
}

// ── PART C — overlapping reads dedup ─────────────────────────────────────────────────────────
{
  const sb = tree();
  sb.History.attach({ log: () => LOG });
  sb.History.ingest(LOG);
  sb.History.ingest(LOG);             // the same stretch again
  sb.History.ingest(LOG.slice(0, 8)); // and an overlapping prefix
  ok(sb.History.count() === 6,
    "C: APPLIED — paging can overlap and repeat freely, because merge dedups by play instance. "
    + "That is what lets backfill be lazy without bookkeeping", sb.History.count());
}

// ── PART D — ordered by (stamp, instance) ────────────────────────────────────────────────────
{
  const sb = tree();
  const a = { pi: "$b", at: 100, videoId: "V1", dj: "@d:hs" };
  const b = { pi: "$a", at: 100, videoId: "V2", dj: "@d:hs" };   // SAME stamp
  const merged = sb.History.merge([], [a, b]);
  ok(merged.length === 2, "D: two plays sharing a stamp are both kept", merged.length);
  ok(merged[0].pi === "$a" && merged[1].pi === "$b",
    "D: APPLIED — the tie is broken by instance id. Comparing the stamp alone would make the order "
    + "ambiguous exactly when two plays collide", merged.map((e) => e.pi));
}

// ── PART D2 — ordered by POSITION, never by timestamp ────────────────────────────────────────
// `at` is the server stamp on the play event, and plays are not ordered by timestamp anywhere in
// this system — they are ordered by (position, id), which is intrinsic and identical on every
// client. Stamps come from whichever homeserver wrote the event, so two plays can carry stamps that
// disagree with the order they actually happened in. Ordering a display by a DISPLAY value is the
// kind of second opinion that drifts silently: nothing errors, the list is just quietly wrong.
{
  const sb = tree();
  const out = sb.History.merge([], [
    { pi: "$p2", l: 20, at: 1000, videoId: "SECOND", dj: "@d:hs" },
    { pi: "$p1", l: 10, at: 9000, videoId: "FIRST",  dj: "@d:hs" },   // later stamp, earlier position
  ]);
  ok(out[0].videoId === "FIRST" && out[1].videoId === "SECOND",
    "D2: APPLIED — position decides, so a clock-skewed stamp cannot reorder the room's history",
    out.map((e) => e.videoId));

  const tied = sb.History.merge([], [
    { pi: "$b", l: 10, at: 1, videoId: "B", dj: "@d:hs" },
    { pi: "$a", l: 10, at: 1, videoId: "A", dj: "@d:hs" },
  ]);
  ok(tied[0].videoId === "A",
    "D2: two plays CAN share a position, so the id is the tiebreak — the same key the reducer sorts "
    + "by. Comparing position alone would make the pair's order arbitrary", tied.map((e) => e.videoId));

  // and the position is attached at ingest, since the reducer's entries do not carry one
  sb.History.reset();
  sb.History.attach({ log: () => LOG });
  sb.History.ingest(LOG);
  ok(sb.History.recent().every((e) => typeof e.l === "number"),
    "D2: APPLIED — ingest attaches the position from the events it was handed, so the truth layer "
    + "did not have to change to make its own display orderable");
}

// ── PART E — evict, do not refuse ────────────────────────────────────────────────────────────
{
  const sb = tree();
  const many = [];
  for (let i = 0; i < sb.History.MAX + 50; i++) many.push({ pi: "$p" + i, at: i, videoId: "V", dj: "@d:hs" });
  const merged = sb.History.merge([], many);
  ok(merged.length === sb.History.MAX, "E: the cap holds", merged.length);
  ok(merged[merged.length - 1].pi === "$p" + (many.length - 1),
    "E: APPLIED — the NEWEST is kept and the oldest evicted. History is regenerable from the log, "
    + "so eviction is the right policy — the opposite of the queue and playlists, which are local "
    + "truth and REFUSE a new item instead. Same number, opposite policy, and the policy is the "
    + "meaningful part");
}

// ── PART F — honest coverage ─────────────────────────────────────────────────────────────────
{
  const sb = tree();
  sb.History.attach({ log: () => LOG });
  ok(sb.History.coverage().fromL === null,
    "F: before reading anything it claims nothing rather than implying completeness");
  sb.History.ingest(LOG.slice(4));
  const c = sb.History.coverage();
  ok(c.fromL !== null && c.complete === false,
    "F: APPLIED — after a partial read it reports a WINDOW and says it is not complete. A pane that "
    + "implies it has everything when it has a window is worse than one that admits the bound", c);
}

// ── PART G — inert ───────────────────────────────────────────────────────────────────────────
{
  const sb = tree();
  const src = fs_read("backends/backend1/history.js");
  ok(!/MatrixBridge|sendEvent|StreamManager\.ingest/.test(src),
    "G: history sends nothing and ingests nothing into the room. It is display-only, and a module "
    + "that could feed back into consensus would not be safe to make lazy");
  ok(/StateDeriver/.test(src),
    "G: it folds through the reducer rather than inventing its own reading of what played");
}
function fs_read(p) { return require("fs").readFileSync(require("path").join(__dirname, "..", p), "utf8"); }

console.log("[history] PASS — history is its own reader and survives the forget: entries are "
  + "DERIVED by folding rather than scanned, because a played videoId is not in the event body; "
  + "trimming the live log no longer empties the pane, which is the conflict that forced the split; "
  + "overlapping reads dedup so paging can be lazy and repeated; ties are broken by instance rather "
  + "than by stamp alone; the cap EVICTS because this data is regenerable, the opposite of the "
  + "truth stores that refuse; coverage is reported honestly; and nothing here can move the room");
