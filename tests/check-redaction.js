// tests/check-redaction.js
// WALL: Spine immutability — redaction/edit refusal. Three things, all headless:
//   1. The pure restore decision (redacted x have-original -> ingest|restore|gap).
//   2. StreamManager stays APPEND-ONLY: a redaction *event* can't mutate the log.
//   3. The consensus consequence: re-ingesting the verified original (refusing the
//      redaction) yields the SAME derived state as the un-redacted log, while a
//      silently-dropped event (the old bug) diverges — old state resurfaces.
// The SDK-facing detection/restore wiring (isRedacted, getOriginalContent,
// EventCache) is exercised live; here we lock the logic it rests on.

const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[redaction] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(a, b, msg) { if (a !== b) fail(msg + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }
function ne(a, b, msg) { if (a === b) fail(msg + " (both " + JSON.stringify(a) + ")"); }

// --- 1) pure decision (matrixbridge loads headless; helper is pure) ---
const noop = () => {};
const MB = loadInContext(["transport/matrixbridge.js"], { Logger: { info: noop, warn: noop, error: noop, debug: noop } }).MatrixBridge;
eq(MB.spineRestoreDecision(false, false), "ingest",  "not redacted -> ingest original");
eq(MB.spineRestoreDecision(false, true),  "ingest",  "not redacted (even if cached) -> ingest");
eq(MB.spineRestoreDecision(true, true),   "restore", "redacted + verified original -> restore (refuse the redaction)");
eq(MB.spineRestoreDecision(true, false),  "gap",     "redacted + no original -> gap (flag, never silent-drop)");

// --- channel classification: chat is RAM-only (never cached/ingested) ---
// The router caches + ingests ONLY non-chat channels; chat-* is the ephemeral
// Skin and must skip EventCache (the bounded voucher store) and the StreamManager
// log entirely. These classifiers gate that, so lock them.
eq(MB._isChatChannel({ name: "chat-uncategorized" }), true,  "chat-* is a chat channel");
eq(MB._isChatChannel({ name: "chat-staff" }),         true,  "chat-staff is a chat channel");
eq(MB._isChatChannel({ name: "events-uncategorized" }), false, "events-* is NOT chat");
eq(MB._isChatChannel({ name: "settings-owner" }),     false, "settings-* is NOT chat");
eq(MB._isChatChannel({}),                             false, "no name -> not chat (safe default)");
eq(MB._isSpineChannel({ name: "events-staff" }),      true,  "events-* is Spine");
eq(MB._isSpineChannel({ name: "chat-guest" }),        false, "chat-* is NOT Spine");
// A channel is never BOTH (the router's two skip-branches can't both fire).
eq(MB._isChatChannel({ name: "chat-x" }) && MB._isSpineChannel({ name: "chat-x" }), false, "chat is not also Spine");

// --- shared: a tiny StreamManager+StateDeriver context and a raw builder ---
function smCtx() {
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  return loadInContext(["core/logger.js", "core/idb.js", "core/statederiver.js", "core/eventcache.js", "core/streammanager.js"], { localStorage });
}
// A ddjp protocol event as it reaches StreamManager.ingest (m.room.message whose
// body is the compact JSON blob).
function ev(id, body, rank) {
  return { event_id: id, type: "m.room.message", room_id: "!room:hs", sender: body.sender || "@a:hs",
    ts: body.l || 0, senderRank: rank == null ? 20 : rank, content: { body: JSON.stringify(body) } };
}
function snap(sm) {
  const s = sm.getState();
  return JSON.stringify({ np: s.nowPlaying ? { dj: s.nowPlaying.dj, vid: s.nowPlaying.song ? s.nowPlaying.song.videoId : null, pi: s.nowPlaying.pi } : null,
    rot: s.rotation.map(r => ({ u: r.user, p: r.pending.map(x => x.videoId) })) });
}

// A: join @a with vid1, declare vid2, then genesis play (p:null) -> consumes vid1.
const A_join    = ev("$j1", { t: "ddjp.dj.join",    v: "vid1", l: 1, sender: "@a:hs" });
const A_declare = ev("$d1", { t: "ddjp.dj.declare", v: "vid2", l: 2, sender: "@a:hs" });
const A_play    = ev("$p1", { t: "ddjp.dj.play",    p: null,  l: 3, sender: "@a:hs" });

// --- 2) append-only: a redaction EVENT cannot mutate the log ---
{
  const c = smCtx();
  c.StreamManager.ingest(A_join);
  c.StreamManager.ingest(A_declare);
  c.StreamManager.ingest(A_play);
  const before = snap(c.StreamManager);
  const lenBefore = c.StreamManager.getLog().length;

  // A redaction targeting $p1 arrives as an m.room.redaction — not an m.room.message,
  // so ingest must ignore it entirely (no removal, no mutation).
  c.StreamManager.ingest({ event_id: "$r1", type: "m.room.redaction", room_id: "!room:hs", sender: "@a:hs", ts: 9, l: 4, content: { redacts: "$p1" } });
  // And a duplicate of the play (dedup by event_id) must be a no-op too.
  c.StreamManager.ingest(A_play);

  eq(c.StreamManager.getLog().length, lenBefore, "redaction event + dup must not change log length");
  eq(snap(c.StreamManager), before, "redaction event must not mutate derived state");
}

// --- 3) restore == full log, and silent gap != full log (the old bug) ---
{
  const full = smCtx();
  full.StreamManager.ingest(A_join); full.StreamManager.ingest(A_declare); full.StreamManager.ingest(A_play);
  const fullSnap = snap(full.StreamManager);

  // "restore": refusing the redaction re-ingests the verified original $p1 — so the
  // derived state is identical to the un-redacted log.
  const restored = smCtx();
  restored.StreamManager.ingest(A_join); restored.StreamManager.ingest(A_declare);
  restored.StreamManager.ingest(A_play);   // <- the cached original, re-ingested
  eq(snap(restored.StreamManager), fullSnap, "restoring the original derives the SAME state as the un-redacted log");

  // "gap": the OLD behavior silently dropped the redacted play. Then vid1 is never
  // consumed and resurfaces — a different, corrupted state. This is what the fix
  // prevents (now it would be a flagged gap, never a silent wrong-state).
  const gap = smCtx();
  gap.StreamManager.ingest(A_join); gap.StreamManager.ingest(A_declare);   // $p1 dropped
  ne(snap(gap.StreamManager), fullSnap, "a silently-dropped play must NOT match the full log (it resurrects old state)");
  // Concretely: in the gap, vid1 is still pending (never played); in full it's now-playing.
  const gapState = gap.StreamManager.getState();
  eq(gapState.nowPlaying, null, "gap: nothing playing (the play was lost)");
  eq(gapState.rotation[0].pending[0].videoId, "vid1", "gap: vid1 wrongly still queued (resurfaced)");
}

// --- 4) the voucher seam: EventCache sync path + RAM-only degradation ---
// The redaction fix reads cached originals SYNCHRONOUSLY during ingest/replay.
// After the IndexedDB migration the durable backing is async, but store/get/has
// must stay synchronous against the RAM map — and must still work with no IDB
// present (as here under node: IDB.supported() is false, so it's RAM-only).
{
  const c = smCtx();
  const EC = c.EventCache;
  eq(EC.get("$nope"), null, "get of an unknown id -> null");
  eq(EC.has("$nope"), false, "has of an unknown id -> false");
  EC.store(A_play);
  eq(EC.has("$p1"), true, "after store, has is true synchronously (RAM hot path)");
  eq(EC.get("$p1").event_id, "$p1", "after store, get returns the original synchronously");
  EC.store({ no_id: true });   // malformed: ignored, no throw
  eq(EC.has(undefined), false, "malformed store left nothing addressable");
}

console.log("[redaction] PASS — pure decision; append-only under redaction; restore==full, gap!=full; EventCache sync path + RAM-only degradation");
process.exit(0);
