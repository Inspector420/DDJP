// tests/check-own-event-stamp.js
//
// A CLIENT MUST NOT FOLD ITS OWN EVENT ON ITS OWN CLOCK.
//
// `startedAt` is the shared anchor for everything time-based — the playhead, the advance gate, the
// maxLen ceiling — and it is the play event's `ts`. That has to be the HOMESERVER's stamp, or the
// clients computing from it are not computing from the same origin.
//
// A sender sees its own event twice. The first delivery arrives the moment the server accepts it:
// the id is real (the send response carried it) but the object is still OURS, and its
// origin_server_ts is whatever our own clock said when we pressed send. The second arrives through
// sync and carries the server's stamp. The first was let through and the second was dropped as a
// duplicate, so the sender kept its own clock's value for good while every other client held the
// server's.
//
// MEASURED IN A LIVE ROOM, and the two checkpoints in that room settle it between them:
//   sealed by the client that AUTHORED the play : seed startedAt 1786395230102
//   the actual event                            :      event ts 1786395231746   (1644ms apart)
//   sealed by a client that did NOT author it   : seed startedAt == event ts exactly
// The only difference between those two seals is whether the sealer had sent the play itself.
//
// WHAT IT COST. The DJ who queued a song computed that song's position from a different origin
// than the rest of the room — their latency plus their clock skew. And a checkpoint sealed in that
// state carries a `startedAt` nobody else derives, so the seed cross-check reports `mismatched`,
// the forget licence is withheld, and NOTHING IS EVER FORGOTTEN. That warning was not a false
// alarm; it was the one part of this system that noticed.
//
// THE OLD REASONING, and exactly where it stopped: "status is SENT once the server has accepted
// the event and assigned its real ID — at that point getId() already returns the real ID, so
// 'sent' is safe to let through". Correct about the ID. Silent about the timestamp.
//
// VERIFIED AGAINST THE VENDORED SDK ITSELF (PART F). This was written while lib/ was empty and
// the SDK's behaviour could only be assumed; it no longer has to be. matrix-js-sdk mints a local
// echo with `origin_server_ts: new Date().getTime()` — this device's clock — and replaces the
// whole event object on the sync echo, at which point the status clears. PART F runs the real
// bundle and shows the id IDENTICAL across both deliveries while only the timestamp changes,
// which is precisely why checking the id was not enough.
//
// THE SAFETY NET STAYS. Waiting for the confirmed delivery relies on the SDK re-offering the
// event, which it does (Room.handleRemoteEcho emits LocalEchoUpdated after swapping the event in).
// But "a client's own sends never reach its own state" is a regression this codebase has already
// suffered once and written down, lib/ can be emptied again for handoff, and an SDK upgrade could
// change the lifecycle. So a deferred event that is never confirmed is admitted anyway, late and
// loudly: losing your own event is worse than folding a stamp off by a round trip.
//
// GUARANTEES:
//   PART A — A PLACEHOLDER IS NEVER FOLDED. Unchanged, and still the reason the gate exists.
//   PART B — "SENT" IS NOT ENOUGH. The delivery whose id is real but whose stamp is ours is
//     refused. This is the fix.
//   PART C — A CONFIRMED DELIVERY IS FOLDED. Anything with no pending status is the server's.
//   PART D — THE DIVERGENCE IS REAL. Folded through the actual reducer: the same event under the
//     two stamps produces two different `startedAt`, and a seed built from one cannot match the
//     other. This is why the gate matters rather than being tidiness.
//   PART E — A DEFERRAL IS BOUNDED. An event that is never confirmed is admitted after a bound
//     rather than lost.
//   PART F — THE SDK REALLY BEHAVES THIS WAY. Run against the vendored bundle rather than assumed:
//     a local echo at status "sent" reports OUR clock, the sync echo replaces it with the server's,
//     and the event id is the same in both. Skipped with a stated reason when lib/ is empty (it is
//     emptied for token-efficient handoff), because a guard that quietly skips is a guard that
//     cannot be told from one that ran nothing.

const { loadInContext } = require("./_load");

let failures = 0;
// Whether PART F actually exercised the vendored SDK. The summary below must not claim a check
// that did not run — lib/ is emptied for token-efficient handoff, so "the SDK is RUN" would be
// false on exactly the copies a fresh session receives.
let _partFRan = false;
function ok(cond, msg, got) {
  if (cond) return;
  failures++;
  console.log("[own-event-stamp] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const MB = loadInContext([
  "core/logger.js", "core/storageio.js", "core/idb.js",
  "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/eventcache.js", "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
], {
  Date: Date, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout,
  setInterval: () => 0, clearInterval: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 },
  window: { isSecureContext: false }, document: undefined, indexedDB: undefined,
  matrixcs: {}, navigator: {},
}).MatrixBridge;

const REAL = "$abc:matrix.org";
const PLACEHOLDER = "~!room:matrix.org:txn123";

// ── PART A + B + C — the delivery decision ────────────────────────────────────────────────────
(() => {
  if (!MB.deliveryState) {
    failures++;
    console.log("[own-event-stamp] FAIL — the transport exposes no pure delivery decision. The "
      + "rule lives inside an SDK-facing router that cannot run headlessly, so without a split-out "
      + "predicate it can only be asserted as source text — and a text assertion has already let "
      + "one mutation through this file.");
    return;
  }
  for (const st of ["sending", "queued", "encrypting", "not_sent", "cancelled"]) {
    const d = MB.deliveryState(st, REAL);
    ok(d && d.fold === false,
      "A: a '" + st + "' delivery is not folded — it still carries a placeholder id", d);
  }

  const sent = MB.deliveryState("sent", REAL);
  ok(sent && sent.fold === false,
    "B: APPLIED — a 'sent' delivery is NOT folded. Its ID is real, which is what the old rule "
    + "checked, and its TIMESTAMP is still this device's clock — which is what everything "
    + "time-based in this room computes from. Folding it made the sender disagree with every "
    + "other client about when the song began, and made any checkpoint it sealed unmatchable", sent);
  ok(sent && sent.defer === true,
    "B: and it is DEFERRED rather than discarded — the event is real, only its stamp is not yet", sent);

  for (const st of [null, undefined, ""]) {
    const d = MB.deliveryState(st, REAL);
    ok(d && d.fold === true,
      "C: a delivery with no pending status has round-tripped and is folded", { status: st, d: d });
  }
  const ph = MB.deliveryState(null, PLACEHOLDER);
  ok(ph && ph.fold === false && ph.defer === false,
    "D: a placeholder id is refused whatever the status says, and is NOT deferred — there is no "
    + "real event behind it to wait for", ph);
})();

// ── PART D — the divergence this prevents, through the real reducer ───────────────────────────
(() => {
  const sb = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const { StateDeriver } = sb;
  const LOCAL = 1786395230102, SERVER = 1786395231746;   // the live room's two values
  let l = 0;
  const ev = (id, ts, b) => ({ eventId: id, l: ++l, ts: ts, sender: "@dj:hs", senderRank: 20,
                               type: b.t, content: b, roomId: "!r:hs" });
  const base = [
    ev("$j", 1000, { t: "ddjp.dj.join", v: "SONGA" }),
    ev("$d", 1000, { t: "ddjp.dj.declare", v: "SONGB" }),
  ];
  const withLocal = base.concat([ev("$play", LOCAL, { t: "ddjp.dj.play", p: null })]);
  l -= 1;
  const withServer = base.concat([ev("$play", SERVER, { t: "ddjp.dj.play", p: null })]);

  const a = StateDeriver.derive(withLocal).nowPlaying.startedAt;
  const b = StateDeriver.derive(withServer).nowPlaying.startedAt;
  ok(a !== b,
    "D: the same event under the two stamps yields different startedAt — this is not cosmetic, it "
    + "is the anchor the playhead, the advance gate and the ceiling all compute from", { a: a, b: b });

  const seedA = StateDeriver.buildSeed(withLocal);
  const seedB = StateDeriver.buildSeed(withServer);
  ok(JSON.stringify(seedA.nowPlaying) !== JSON.stringify(seedB.nowPlaying),
    "D: APPLIED — and a seed sealed from one cannot match a fold of the other, which is precisely "
    + "the 'checkpoint seed diverges from genesis queue' a live room reported. The check was "
    + "right; it was reporting a real disagreement", { a: seedA.nowPlaying, b: seedB.nowPlaying });
})();

// ── PART E — a deferral is bounded ────────────────────────────────────────────────────────────
(() => {
  if (!MB.deferralExpired) {
    failures++;
    console.log("[own-event-stamp] FAIL — nothing bounds the wait. Deferring an event on the "
      + "expectation that the SDK re-offers it, with no fallback, risks the regression this tree "
      + "already recorded once: a client's own sends never reaching its own state. The vendored "
      + "SDK is not in this tree, so that expectation cannot be checked here and must not be "
      + "relied on alone.");
    return;
  }
  ok(MB.deferralExpired(1000, 1200, 4000) === false,
    "E: a deferral inside the bound keeps waiting for the server's stamp");
  ok(MB.deferralExpired(1000, 6000, 4000) === true,
    "E: APPLIED — past the bound the event is admitted anyway. A stamp off by a round trip is a "
    + "small, bounded wrongness; losing the client's own event is not");
  ok(MB.deferralExpired(0, 6000, 4000) === false,
    "E: nothing deferred means nothing to expire");
})();

// ── PART F — RUN THE REAL SDK ─────────────────────────────────────────────────────────────────
// The whole rule rests on a claim about matrix-js-sdk: that a delivery can carry a REAL event id
// and still carry OUR timestamp. Asserted here by constructing the lifecycle against the vendored
// bundle, so an upgrade that changes it turns this red rather than silently reopening the bug.
(() => {
  const fs = require("fs"), vm = require("vm"), path = require("path");
  const BUNDLE = path.join(__dirname, "..", "lib", "matrix-sdk.bundle.js");
  let src = null;
  try { src = fs.readFileSync(BUNDLE, "utf8"); } catch (e) { src = null; }
  _partFRan = false;
  if (!src || src.length < 1000) {
    // STATED, NOT SILENT. lib/ is emptied for token-efficient handoff, and a skip nobody is told
    // about is indistinguishable from a check that ran nothing.
    console.log("[own-event-stamp] NOTE — PART F skipped: lib/matrix-sdk.bundle.js is absent or "
      + "empty, so the SDK's local-echo lifecycle could not be exercised. The rule is still "
      + "enforced by PARTS A-C and bounded by PART E; what is NOT checked here is that the SDK "
      + "still behaves the way the rule assumes.");
    return;
  }
  const sb = { console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    window: {}, document: { baseURI: "http://x/" }, navigator: {}, location: {},
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: () => 0, clearInterval: () => {},
    TextEncoder: TextEncoder, TextDecoder: TextDecoder, URL: URL, fetch: () => {},
    crypto: { getRandomValues: (a) => a }, self: {}, process: process, globalThis: null };
  sb.globalThis = sb;
  vm.createContext(sb);
  try { vm.runInContext(src, sb, { filename: "matrix-sdk.bundle.js" }); }
  catch (e) {
    failures++;
    console.log("[own-event-stamp] FAIL — F: the vendored bundle did not evaluate: " + (e && e.message));
    return;
  }
  const m = sb.matrixcs;
  _partFRan = true;
  ok(m && typeof m.MatrixEvent === "function", "F: the bundle exposes MatrixEvent", typeof (m && m.MatrixEvent));
  if (!m || typeof m.MatrixEvent !== "function") return;

  // The two values a live room actually produced, so the guard and the incident use one story.
  const LOCAL = 1786395230102, SERVER = 1786395231746;
  const ev = new m.MatrixEvent({ event_id: "~!r:hs:txn1", room_id: "!r:hs", sender: "@me:hs",
    type: "m.room.message", content: { body: "x" }, origin_server_ts: LOCAL });
  ev.setStatus(m.EventStatus.SENT);
  ev.replaceLocalEventId("$real:hs");

  const idAtSent = ev.getId(), tsAtSent = ev.getTs(), statusAtSent = ev.status;
  ok(typeof idAtSent === "string" && idAtSent.indexOf("~") !== 0,
    "F: at status SENT the id is already REAL — which is what the old rule checked and why it let "
    + "this through", idAtSent);
  ok(tsAtSent === LOCAL,
    "F: APPLIED — and the timestamp at that moment is still OURS. The SDK mints a local echo with "
    + "`origin_server_ts: new Date().getTime()`, so a real id and a local clock arrive together",
    tsAtSent);
  ok(MB.deliveryState(statusAtSent, idAtSent).fold === false,
    "F: APPLIED — and our gate refuses exactly that delivery", MB.deliveryState(statusAtSent, idAtSent));

  ev.handleRemoteEcho({ event_id: "$real:hs", room_id: "!r:hs", sender: "@me:hs",
    type: "m.room.message", content: { body: "x" }, origin_server_ts: SERVER, unsigned: {} });

  ok(ev.getTs() === SERVER, "F: the sync echo replaces the stamp with the server's", ev.getTs());
  ok(ev.getId() === idAtSent,
    "F: and the ID IS UNCHANGED across both deliveries — the only thing that moved is the "
    + "timestamp, which is why an id check could never have caught this", ev.getId());
  ok(!ev.status, "F: the status clears, which is how the confirmed delivery is recognised", ev.status);
  ok(MB.deliveryState(ev.status, ev.getId()).fold === true,
    "F: APPLIED — and our gate folds that one", MB.deliveryState(ev.status, ev.getId()));
})();

if (failures) process.exit(1);
console.log("[own-event-stamp] PASS — a client no longer folds its own event on its own clock: the "
  + "delivery whose id is real but whose timestamp is still this device's is DEFERRED rather than "
  + "folded, so `startedAt` is always the homeserver's stamp and the sender computes a song's "
  + "position from the same origin as everyone else. The reducer shows why it matters — the two "
  + "stamps produce different state and unmatchable seeds, which is the divergence a live room "
  + "reported. " + (_partFRan
      ? "The vendored SDK was RUN, showing the id identical across both deliveries while only the "
        + "stamp moves, so an upgrade that changes that lifecycle turns this red rather than "
        + "silently reopening the bug. "
      : "The vendored SDK was NOT exercised (lib/ is empty here), so what the SDK actually does is "
        + "unchecked in this copy — see the NOTE above. ")
  + "The wait is bounded either way, because losing a client's own events must never be the price "
  + "of waiting for a better stamp");
