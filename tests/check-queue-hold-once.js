// tests/check-queue-hold-once.js
// SUBJECT: features/queue.js, backends/backend1/matrixbridge.js
// WALL: A HELD SEND IS SENT EXACTLY ONCE, AND ITS WAIT LETS GO (`ddjp_558`, the owner's log on 557: "Queue: live again — sending a
//   song now" twice at one instant, then again at a later go-live). Each held call registered an author-ready listener that nothing
//   removed, so every later go-live woke it again. Driven with the real Queue against a bridge that can be made live on demand.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[queue-hold-once] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
(async () => {
  let live = false; const sends = [], listeners = new Set(), logs = [];
  const MB = { mayAuthor: () => live ? { ok: true } : { ok: false, reason: "not-live" },
    onAuthorReady: (fn) => listeners.add(fn), offAuthorReady: (fn) => listeners.delete(fn),
    sendEvent: (room, type, content) => { sends.push([type, content && content.v]); return Promise.resolve({ eventId: "$s" + sends.length, l: sends.length }); },
    getUserId: () => "@me:hs" };
  const SMstub = { on() {}, off() {}, getState: () => ({ rotation: [], nowPlaying: null, settings: {} }), getLog: () => [] };   // subscriptions only
  const sb = loadInContext(["core/logger.js", "features/queue.js"], { MatrixBridge: MB, StreamManager: SMstub, setTimeout: setTimeout, clearTimeout: clearTimeout, PlaylistDoc: { watchUrl: (v) => "https://www.youtube.com/watch?v=" + v } });
  for (const lv of ["info", "warn", "debug", "error"]) sb.Logger[lv] = (m) => logs.push(String(m));
  sb.Queue.init("!events:hs");
  const goLive = () => { live = true; for (const fn of Array.from(listeners)) fn(); };
  // one held song
  const p1 = sb.Queue.submitSong("vidAAAAAAAAA", "https://youtu.be/vidAAAAAAAAA");
  await new Promise((r) => setImmediate(r));
  ok(sends.length === 0 && listeners.size === 1, "PREMISE — the song is held while the client is not live", { sends, listeners: listeners.size });
  goLive(); await p1;
  ok(sends.length === 1 && sends[0][1] === "vidAAAAAAAAA", "a held song is SENT EXACTLY ONCE when the client goes live", sends);
  ok(listeners.size === 0, "and its wait LETS GO — no listener is left registered", listeners.size);
  const said = logs.filter((m) => /live again — sending a song now/.test(m)).length;
  goLive(); await new Promise((r) => setImmediate(r));
  ok(sends.length === 1 && logs.filter((m) => /live again — sending a song now/.test(m)).length === said, "a LATER go-live sends nothing and logs nothing — no stale listener wakes", { sends: sends.length, said });
  // two different songs held at once: each is sent once
  live = false; sends.length = 0;
  const pa = sb.Queue.submitSong("vidBBBBBBBBB", "u"), pb = sb.Queue.submitSong("vidCCCCCCCCC", "u");
  await new Promise((r) => setImmediate(r));
  goLive(); await pa; await pb;
  ok(sends.length === 2 && sends.map((s) => s[1]).sort().join() === "vidBBBBBBBBB,vidCCCCCCCCC", "two different songs held together are sent once each", sends);
  ok(listeners.size === 0, "and both waits let go", listeners.size);
  const MBsrc = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
  ok(/function offAuthorReady\(fn\)/.test(MBsrc) && /offAuthorReady,/.test(MBsrc.slice(MBsrc.lastIndexOf("  return {"))), "the bridge exports offAuthorReady, so a wait can let go");
  if (failed) { console.log("[queue-hold-once] " + failed + " failure(s)"); process.exit(1); }
  console.log("[queue-hold-once] PASS — a held send is sent exactly once, and its wait lets go, so no stale listener wakes at a later go-live (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { console.log("[queue-hold-once] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
