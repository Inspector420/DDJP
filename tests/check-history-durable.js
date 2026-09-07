// tests/check-history-durable.js
// WALL: EVERY HISTORY ROW IS BACKED, AND A ROW SETTLED UNDER A SUPERSEDED FLOOR IS NOT BELIEVED.
//
// THE PANE IS A CACHE OF A DERIVATION, NOT AN ACCUMULATION, and that distinction is the whole
// reason this file exists. A list that only ever appends cannot heal: a row written from a bad
// fold stays wrong for the life of the room, and nothing revisits it. A cache that records WHAT IT
// WAS DERIVED UNDER can always be judged, and rebuilt when the answer it rested on changes.
//
// THE INVARIANT: **every row is backed by a checkpoint covering it, or by events this client still
// holds. Never neither.** Checkable at any instant, which is what makes durability testable rather
// than hopeful — a pane that has quietly lost its footing looks identical to one that has not.
//
// WHY A ROW NEEDS A FLOOR STAMP AT ALL. A play event does NOT name its song — its body is
// `{t, p}`, and the video is whatever the reducer pops off the head DJ's queue. So a row's content
// depends on the fold, and the fold depends on which floor the trust cascade selects. When a
// higher rank publishes a floor that disagrees, every row downstream of the disagreement was
// derived under an answer the room has since replaced. Without the stamp there is no way to know
// which rows those are; with it, they name themselves.
//
// PART A — a row carries its provenance: the proving event AND the floor it was settled under.
// PART B — the chain finds holes, anywhere, without a separate progress counter.
// PART C — a superseded floor invalidates exactly the rows downstream of it.
// PART D — the backing invariant holds after a discard.
// PART E — metadata is NOT stored here; it is read from the caches that already own it.

const path = require("path");
const fs = require("fs");
const { loadInContext, ROOT } = require("./_load.js");
const F = require("./_fixtures");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[history-durable] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

function tree() {
  return loadInContext([
    "core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/floor.js",
    "backends/backend1/history.js",
  ], { Date, Math, JSON, setTimeout, clearTimeout });
}

const T = tree();
const H = T.History, SD = T.StateDeriver, FL = T.Floor;

// ── A ROOM WITH REAL PLAYS ───────────────────────────────────────────────────────────────────
const LOG = F.sortLog(F.playingRoom({ songs: 6 }).log);
const CUT = 7;
const SEED = SD.buildSeed(LOG.slice(0, CUT));
const FLOOR_A = { n: 1, prev: null, seed: SEED, h: "hAAAA",
                  covers: LOG[0].eventId + ".." + LOG[CUT - 1].eventId,
                  floorL: LOG[CUT - 1].l, by: "@owner:hs", grade: "verified" };
const FLOOR_B = { n: 2, prev: "hAAAA", seed: SEED, h: "hBBBB",
                  covers: LOG[0].eventId + ".." + LOG[CUT - 1].eventId,
                  floorL: LOG[CUT - 1].l, by: "@owner:hs", grade: "verified" };

// ── PART A — A ROW CARRIES ITS PROVENANCE ────────────────────────────────────────────────────
{
  const rows = SD.derive(LOG).history;
  ok(Array.isArray(rows) && rows.length > 0,
    "A: APPLIED — the fixture room must produce plays, or nothing below is exercised", rows.length);

  const r = rows[0];
  ok(typeof r.pi === "string" && r.pi,
    "A: every row names the event that PROVES it played. That single field is what makes a row "
    + "verifiable on its own and what lets the chain find holes", r);
  ok(typeof r.videoId === "string" && ("at" in r) && ("dj" in r) && ("skipped" in r),
    "A: and it carries what the pane shows and the stream cannot regenerate — which song, when, "
    + "who played it, and whether it was skipped", r);

  // THE STAMP LIVES ON THE PANE'S ROW, NOT THE REDUCER'S. The first version of this asserted on
  // `StateDeriver.derive().history` and would have demanded the reducer record a floor — which it
  // must never do: the reducer is pure and knows nothing about trust. `History` is the layer that
  // folds a stretch UNDER a floor, so it is the layer that can say which one.
  H.reset();
  H.ingest(LOG, null);
  const hrows = H.recent();
  ok(hrows.length > 0, "A: APPLIED — History must hold rows to stamp", hrows.length);
  const hr = hrows[0];
  ok("floorSig" in hr,
    "A: THE STAMP. A pane row must record the FLOOR it was settled under. A play event does not "
    + "name its song — the video is whatever the reducer pops — so a row's content depends on which "
    + "floor the trust cascade selected. Without it, a room that corrects a divergence cannot say "
    + "which rows rested on the answer it replaced, and the pane keeps them forever. `Floor.sigOf` "
    + "already computes the identity this needs", Object.keys(hr));
  ok(hr.floorSig === null,
    "A: and folding under NO floor stamps `null` rather than omitting the field — a genesis-derived "
    + "row is not invalidated by a floor changing, because it never rested on one, and that is a "
    + "different fact from `nobody recorded this`", hr.floorSig);
}

// ── PART B — THE CHAIN FINDS HOLES, ANYWHERE ─────────────────────────────────────────────────
// Every play names its parent, so a complete history is a chain with no breaks. A row whose parent
// is absent IS the hole and NAMES the event to fetch — behind, or in the middle, by the same test.
// That is why no separate progress counter is needed, and a counter is the thing that rots.
{
  const rows = SD.derive(LOG).history;
  const byPi = Object.create(null);
  for (const r of rows) byPi[r.pi] = true;

  const parentOf = Object.create(null);
  for (const e of LOG) {
    if (e.content && e.content.t === "ddjp.dj.play") parentOf[e.eventId] = e.content.p || null;
  }
  const holes = rows.filter((r) => {
    const p = parentOf[r.pi];
    return p !== null && p !== undefined && !byPi[p];
  });
  ok(holes.length === 0,
    "B: APPLIED — a complete chain has no breaks, or the fixture is already holed and PART B's "
    + "detection would pass for the wrong reason", holes.map((h) => h.pi));

  // Remove one from the MIDDLE and the chain names it.
  const middle = rows[Math.floor(rows.length / 2)];
  const holed = Object.create(null);
  for (const r of rows) { if (r.pi !== middle.pi) holed[r.pi] = true; }
  const found = rows.filter((r) => {
    const p = parentOf[r.pi];
    return p && !holed[p];
  });
  ok(found.length > 0,
    "B: a row removed from the MIDDLE is detected by its successor naming a parent that is not "
    + "there — no counter, no bookkeeping, just the chain", { removed: middle.pi, detected: found.map((f) => f.pi) });
}

// ── PART C — A SUPERSEDED FLOOR INVALIDATES ITS ROWS ─────────────────────────────────────────
// The reason the stamp exists. This is the reported divergence one layer up: a client derives a
// room under one floor, a higher rank publishes another, and the rows built under the first are
// downstream of an answer the room has replaced.
{
  ok(typeof FL.sigOf === "function",
    "C: APPLIED — the floor identity function must exist; the stamp reuses it rather than "
    + "inventing a second way to name a floor");
  const sigA = FL.sigOf(FLOOR_A), sigB = FL.sigOf(FLOOR_B);
  ok(sigA && sigB && sigA !== sigB,
    "C: APPLIED — two different floors must have different signatures, or the stamp cannot "
    + "distinguish them and PART C proves nothing", { sigA, sigB });

  ok(typeof H.reconcileFloor === "function",
    "C: THE HEAL must exist — `History` has to be able to drop rows settled under a floor the trust "
    + "cascade no longer selects. Accumulating instead means a row written under a superseded "
    + "answer stays for the life of the room", Object.keys(H).sort());

  // DRIVEN. Rows are folded under floor A, then floor B arrives. Rows ABOVE the cut are suspect;
  // rows at or below it are covered by the checkpoint itself and must be left alone.
  H.reset();
  FL.reset();
  FL._setTrustedForTest(FLOOR_A);
  H.ingest(LOG, null);
  const underA = H.recent();
  ok(underA.length > 0 && underA[0].floorSig === sigA,
    "C: APPLIED — the rows must actually be stamped with floor A, or the reconcile below is "
    + "operating on nothing", { n: underA.length, sig: underA[0] && underA[0].floorSig });

  const above = underA.filter((r) => typeof r.l === "number" && r.l > FLOOR_A.floorL).length;
  ok(above > 0,
    "C: APPLIED — some rows must sit ABOVE the cut, or there is nothing a floor change can "
    + "invalidate and the assertion below would pass trivially", { above, cut: FLOOR_A.floorL });

  const r1 = H.reconcileFloor(sigB, FLOOR_B.floorL);
  ok(r1.dropped === above,
    "C: THE HEAL, DRIVEN. Exactly the rows above the cut — the ones derived under the replaced "
    + "answer — are dropped. Dropped rather than rewritten, because the events that would rebuild "
    + "them may be gone and a rebuilt-from-nothing row is a fabrication. The chain names what is "
    + "missing and the backfill re-reads it", r1);

  const kept = H.recent();
  ok(kept.every((r) => typeof r.l !== "number" || r.l <= FLOOR_A.floorL),
    "C: and everything kept is at or below the cut, where the CHECKPOINT covers it — re-deriving "
    + "those is what would make this expensive, and the room has already settled them",
    kept.map((r) => r.l));

  // AND A GENESIS-STAMPED ROW IS NOT IMMUNE — the audit (A7) found the comment claiming it was
  // while the code did the opposite. A row folded from this client's own view above the cut is the
  // LEAST trustworthy kind: it is exactly what a same-position race corrupts. Dropping and
  // re-reading it is what converges two clients that disagreed, which is the reported fault.
  {
    const T3 = tree(); const H3 = T3.History;
    H3.reset(); H3.ingest(LOG, null);
    const before3 = H3.recent().length;
    const mid = LOG[Math.floor(LOG.length / 2)].l;
    const r3 = H3.reconcileFloor("aFloorSig", mid);
    ok(r3.dropped > 0 && H3.recent().length > 0,
      "C: null-stamped rows ABOVE a new floor's cut are dropped and re-read; those at or below it "
      + "are kept because the checkpoint covers them. Immunity for genesis rows would leave two "
      + "diverged clients permanently disagreeing", { before: before3, r3, after: H3.recent().length });
  }

  // IDEMPOTENT: reconciling to the same floor again drops nothing. Without this a client could
  // thrash its pane on every fold.
  const r2 = H.reconcileFloor(sigB, FLOOR_B.floorL);
  ok(r2.dropped === 0,
    "C: reconciling twice to the same floor drops nothing — the ordinary case is that a new floor "
    + "AGREES, and a heal that churned every time would be worse than the fault", r2);
}

// ── PART D — THE BACKING INVARIANT ───────────────────────────────────────────────────────────
// A row is backed by a checkpoint covering it, or by events still held. Never neither. This is the
// property that makes discarding raw events safe, and the one to assert after every discard.
{
  ok(typeof H.backing === "function" && typeof H.unbackedRows === "function",
    "D: THE INVARIANT MUST BE ASKABLE. Discarding raw events below a checkpoint is safe only while "
    + "every row above it still has its events. A rule nobody can ASK is a hope",
    Object.keys(H).sort());

  // DRIVEN, at the three shapes that matter.
  H.reset(); FL.reset();
  H.ingest(LOG, null);
  const all = H.recent();
  const lowest = all.reduce((m, r) => (typeof r.l === "number" && r.l < m) ? r.l : m, Infinity);
  const highest = all.reduce((m, r) => (typeof r.l === "number" && r.l > m) ? r.l : m, -Infinity);

  ok(H.backing(lowest, null).ok === true,
    "D: holding every event backs every row, with no checkpoint needed", H.backing(lowest, null));
  ok(H.backing(null, highest).ok === true,
    "D: and a checkpoint covering everything backs every row, with no events needed",
    H.backing(null, highest));

  // THE FAILURE THIS EXISTS TO CATCH: events discarded up to a point, and a checkpoint that does
  // not reach it. The rows in the gap are backed by nothing, and the pane must be able to say so.
  const gapHeld = Math.floor((lowest + highest) / 2) + 1;
  const gapCut = lowest;                       // a checkpoint covering almost nothing
  const bad = H.unbackedRows(gapHeld, gapCut);
  ok(bad.length > 0,
    "D: THE INVARIANT BREAKING IS DETECTED. With events held only from the middle and a checkpoint "
    + "covering only the start, the rows between are backed by neither — and that is exactly the "
    + "state a careless discard produces. A store that could not report this would discard until "
    + "the pane was quietly wrong", { held: gapHeld, cut: gapCut, unbacked: bad.length });
  ok(H.backing(gapHeld, gapCut).ok === false,
    "D: and the verdict form agrees with the list form", H.backing(gapHeld, gapCut));
}

// ── PART E — METADATA IS NOT STORED HERE ─────────────────────────────────────────────────────
// `Store.meta` already caches title and duration per video, durably, LRU-capped, user-global; and
// `Store.images` does thumbnails. Both are CACHE, never truth, because the videoId regenerates
// them — `playlistdoc.js` states the law: *a track is its videoId and nothing else*. A history row
// duplicating any of it would be the second source this tree keeps finding stale.
{
  const rows = SD.derive(LOG).history;
  const r = rows[0];
  for (const forbidden of ["title", "durationSec", "duration", "thumb", "thumbnail", "videoUrl"]) {
    ok(!(forbidden in r),
      "E: a history row must NOT carry `" + forbidden + "`. It is regenerable from the videoId and "
      + "already cached durably by Store.meta / Store.images. Storing it here is a second copy that "
      + "goes stale, and the storage law says a track is its videoId and nothing else", Object.keys(r));
  }

  const store = fs.readFileSync(path.join(ROOT, "core/store.js"), "utf8");
  ok(/--- meta \(user-global per-video metadata CACHE/.test(store),
    "E: APPLIED — the metadata cache this defers to must exist, or the row is missing fields with "
    + "nowhere to read them from");
  ok(/META_CACHE_CAP/.test(store) && /IMG_CACHE_CAP/.test(store),
    "E: and both caches must be BOUNDED, so deferring to them cannot grow without limit");
}

// ── PART F — THE TABLE SURVIVES A RELOAD, AND THAT IS WHAT LETS EVENTS GO ───────────────────
// The point of storing rows is not speed. It is that a banked row does not need the events behind
// it — and without that, the events can never be dropped and the 5000 cap saves nothing.
{
  H.reset(); FL.reset();
  H.ingest(LOG, null);
  const live = H.recent();
  const snap = H.snapshot();

  ok(snap && snap.v === 1 && Array.isArray(snap.rows) && snap.rows.length === live.length,
    "F: a snapshot carries every row", { v: snap && snap.v, rows: snap && snap.rows.length, live: live.length });
  ok(typeof snap.fromL === "number" || snap.fromL === null,
    "F: and the REACH, which rows alone cannot recompute — a client that read back to a position "
    + "and found no songs there still knows it read that far, and losing it would re-page the same "
    + "empty stretch every load", { fromL: snap.fromL, toL: snap.toL });

  // THE RELOAD: a fresh module, nothing folded, restore only.
  const T2 = tree();
  const H2 = T2.History;
  H2.reset();
  const rr = H2.restore(snap);
  ok(rr.ok === true && H2.recent().length === live.length,
    "F: THE RELOAD. A fresh client restores the table without folding a single event — which is "
    + "what makes the raw events droppable", { restored: rr.restored, live: live.length });
  ok(JSON.stringify(H2.recent()) === JSON.stringify(live),
    "F: and the restored rows are the same rows, in the same order");

  // TOTAL ON JUNK. Every row is derivable, so a corrupt table costs one re-fold and never a fact.
  // A restore that threw would take the pane down over a cache.
  for (const junk of [null, undefined, {}, { v: 99, rows: [] }, { v: 1 }, "nope", 7]) {
    const r = H2.restore(junk);
    ok(r && r.ok === false,
      "F: unreadable input restores to NOTHING rather than throwing — the table is cache, and a "
      + "pane that dies over a bad cache file is worse than one that re-folds", { junk, r });
  }

  // AND WHAT MAY BE DROPPED. Conservative by construction: null means "I do not know", which a
  // caller must not read as "drop everything" — dropping is the one irreversible act here.
  ok(H2.droppableBelow(undefined) === null && H2.droppableBelow("x") === null,
    "F: with no floor there is no safe cut, and null says so rather than naming one");
  ok(H2.droppableBelow(FLOOR_A.floorL) === FLOOR_A.floorL,
    "F: and with a floor, events below its cut are redundant — the checkpoint carries the queue "
    + "state that decides what each play popped, which is the only thing re-deriving a row needs",
    H2.droppableBelow(FLOOR_A.floorL));

  // THE INVARIANT STILL HOLDS AFTER A RESTORE-THEN-DROP. This is the whole design in one line:
  // rows restored from storage, events dropped below the floor, and nothing left unbacked.
  const cut = FLOOR_A.floorL;
  const heldFrom = cut + 1;                    // events below the cut have been dropped
  ok(H2.backing(heldFrom, cut).ok === true,
    "F: THE DESIGN, END TO END. Rows restored from storage, raw events dropped below the "
    + "checkpoint, and every row still backed — by the checkpoint below the cut and by held events "
    + "above it. If this ever fails, the discard rule has outrun the backing rule",
    H2.backing(heldFrom, cut));
}

// ── PART G — ONE BROKEN LINK MUST NOT COST EVERY SONG AFTER IT ──────────────────────────────
// REPORTED FROM A LIVE ROOM: 168 held events produced NINE songs from a room that had played far
// more, and the pane looked like it had not loaded far enough rather than like it had failed.
//
// A play does not name its song — the reducer pops it off the head DJ's queue — so a play whose
// parent was not accepted yields NO ROW. Folded as one run from the room's beginning, a single
// break near the start silently costs every song after it. The break in that room was the same
// same-position race that put live state on the wrong head: live state now follows the floor and
// recovers, and this layer did not, because it re-derived everything from genesis.
//
// A CHECKPOINT IS AN ANSWER. Anchoring each stretch on the nearest one at or below it means a
// break costs that segment and stops there.
{
  const SDg = tree().StateDeriver;
  const base = F.sortLog(F.playingRoom({ songs: 8 }).log);
  const whole = SDg.derive(base).history.length;
  ok(whole >= 6,
    "G: APPLIED — the fixture must play enough songs for a mid-run break to cost something", whole);

  // BREAK THE CHAIN EARLY: drop one play the later ones descend from. This is the hole, and it is
  // what a client that resolved a race from one side effectively has.
  const plays = base.filter((e) => e.content && e.content.t === "ddjp.dj.play");
  const victim = plays[1];
  const holed = base.filter((e) => e.eventId !== victim.eventId);

  const oneRun = SDg.derive(holed).history.length;
  ok(oneRun < whole,
    "G: APPLIED — folding the holed log as ONE run must lose songs, or there is nothing for the "
    + "anchoring to rescue", { whole, oneRun });

  // ANCHORED: fold the stretch after a checkpoint FROM that checkpoint's seed. The break is below
  // it, so the segment above is unaffected.
  const CUTg = victim.l + 2;
  const seedG = SDg.buildSeed(base.filter((e) => e.l <= CUTg));
  const above = holed.filter((e) => e.l > CUTg);
  const anchored = SDg.derive(above, seedG).history.length;

  ok(anchored > oneRun,
    "G: THE FIX. Anchoring the stretch on a checkpoint recovers songs that one run from genesis "
    + "loses — a break costs its own segment and stops there, instead of everything downstream. "
    + "This is the same principle as live state following the floor, carried to the layer that "
    + "had been left re-deriving from the beginning",
    { oneRun, anchored, whole });

  // AND THE REBUILD MUST ACTUALLY DO IT. A text check, and named as one: driving the bridge needs
  // a live client, so this asserts the shape and PART G above proves the shape is worth having.
  const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const ri = mb.indexOf("locally held");
  ok(ri > 0, "G: APPLIED — the rebuild block must be findable");
  const rb = mb.slice(Math.max(0, ri - 3000), ri + 500);
  ok(/ddjp\.checkpoint/.test(rb) && /History\.ingest\(seg, bounds\[i\]\.seed\)/.test(rb),
    "G: the rebuild must fold SEGMENTS anchored on the checkpoints it holds, not one run from "
    + "genesis. `History.ingest(held, undefined)` is what produced nine songs from a full room");
  ok(/e\.l > lo && e\.l <= hi/.test(rb),
    "G: and a segment must start STRICTLY above its anchor — the seed already accounts for its own "
    + "cut, so including it would fold those events twice");
}

// ── PART H — THE HEAL HAS A CALLER ──────────────────────────────────────────────────────────
// `reconcileFloor` was BUILT AND NEVER WIRED, and two live clients of one room showed the cost:
// both rebuilt 12 songs from their held events across the same 16 checkpoint-anchored segments —
// agreeing exactly, because that path derives from the room's settled account — and then finished
// with 12 and 14. The extra rows came from each client's LIVE fold, which diverges when the room
// has had a same-position race.
//
// A heal with no caller passes every test of its own behaviour and changes nothing. That is the
// existence-vs-use shape this tree keeps finding, and it was found here for the sixth time this
// cycle — in code written to fix the previous one.
{
  const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  ok(/History\.reconcileFloor\(/.test(mb),
    "H: the heal must be CALLED. Defining it and leaving the pane to accumulate is the same as not "
    + "having it — every row settled under a replaced answer stays for the life of the room");

  // ON THE FLOOR HOOK SPECIFICALLY. Adopting a floor is exactly when a row's provenance goes
  // stale, so calling it anywhere else would heal at a moment that is not the one that matters.
  const hi = mb.indexOf("Floor.onChange(function (ev)");
  ok(hi > 0, "H: APPLIED — the floor-change hook must exist");
  const handler = mb.slice(hi, hi + 4000);
  ok(/History\.reconcileFloor\(/.test(handler),
    "H: and it must be called from the floor-change hook — the same hook the trim uses, because "
    + "that is the moment the answer a row rested on can be replaced");
  ok(/Floor\.sigOf\(f\)/.test(handler) && /f\.floorL/.test(handler),
    "H: passing the CURRENT floor's signature and cut, not a remembered one — the point is to "
    + "compare rows against the floor the cascade selects NOW", handler.slice(0, 200));
}

if (failed) process.exit(1);
console.log("[history-durable] PASS — the pane is a cache of a derivation rather than an "
  + "accumulation. Every row names the event that proves it played AND the floor it was settled "
  + "under, so a room that corrects a divergence can say exactly which rows rested on the answer it "
  + "replaced — a play event does not name its song, so a row's content depends on the fold, and "
  + "the fold depends on the floor. Holes are found by the chain rather than by a counter: every "
  + "play names its parent, so a row whose parent is absent both IS the hole and NAMES the event to "
  + "fetch, behind or in the middle by the same test. The backing invariant is ASKABLE — every row "
  + "backed by a checkpoint covering it or by events still held, never neither — which is what "
  + "makes discarding raw events a rule rather than a hope. And no row carries title, duration or "
  + "thumbnail: those are regenerable from the videoId and already cached durably elsewhere, and a "
  + "second copy is the failure this tree keeps finding (" + A + " assertions)");
