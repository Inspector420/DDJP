// tests/check-chat-history.js
// WALL: chat is a present-forward RAM window backed by Matrix. Two invariants:
//   1) The live receive path forwards each message WITH its Matrix event_id, so
//      the render window can dedup by id (and the same id is never drawn twice).
//   2) backfillRecent() is a ONE-SHOT capped fetch used when a room's chat starts:
//      a SINGLE recentChatMessages call (never a paging loop), mapped oldest->newest,
//      returning whatever the server gave — possibly fewer than asked, possibly
//      zero (brand-new room, or recent messages this device can't decrypt) — with
//      NO re-paging and NO `done`/`seen` contract. It degrades to {messages:[]} on
//      a transport error instead of throwing. Chat does NOT page history on
//      scroll-up (loadOlder must be GONE). The transport fetch (recentChatMessages)
//      reads the timeline TAIL, not a prepended older page — that decision is its
//      own review-only concern; here we exercise the REAL Chat module headlessly.

const { loadInContext } = require("./_load");

let failed = 0;
function ok(c, m) { if (!c) { console.log("[chat-history] FAIL — " + m); failed++; } }
function eq(g, w, m) { const a = JSON.stringify(g), b = JSON.stringify(w); if (a !== b) { console.log("[chat-history] FAIL — " + m + "\n      got " + a + "\n      want " + b); failed++; } }

const noop = () => {};
let captured = null;          // the raw listener Chat registers on init
let nextResult = { messages: [] };
let throwNext = false;
let calls = 0;                // how many times recentChatMessages was invoked
const MatrixBridge = {
  onRawEvent: (fn) => { captured = fn; },
  offRawEvent: () => { captured = null; },
  sendMessage: async () => {},
  recentChatMessages: async (roomId, count) => {
    calls++;
    if (throwNext) { throwNext = false; throw new Error("network"); }
    return nextResult;
  }
};

const { Chat } = loadInContext(["features/chat.js"], {
  Logger: { info: noop, warn: noop, error: noop, debug: noop },
  MatrixBridge
});

(async () => {
  // ---- 0) the contract: one-shot backfill exists, no scroll-paging API ----
  ok(typeof Chat.backfillRecent === "function", "Chat exposes backfillRecent()");
  ok(typeof Chat.loadOlder === "undefined", "loadOlder() is GONE — chat does not page history on scroll");

  // ---- 1) live receive forwards (event_id, sender, body) ----
  const seenMsgs = [];
  Chat.onMessage((id, sender, body) => seenMsgs.push({ id, sender, body }));
  Chat.init("room1");
  ok(typeof captured === "function", "init registers a raw listener");
  captured({ type: "m.room.message", room_id: "room1", event_id: "e_live", sender: "@a:hs", content: { body: "hi" } }, {}, {});
  eq(seenMsgs, [{ id: "e_live", sender: "@a:hs", body: "hi" }], "live message forwarded with its event_id (window dedups by id)");
  captured({ type: "m.room.message", room_id: "other", event_id: "x", sender: "@a", content: { body: "no" } }, {}, {});
  captured({ type: "m.reaction", room_id: "room1", event_id: "y", sender: "@a", content: {} }, {}, {});
  eq(seenMsgs.length, 1, "messages from another room / non-message events are dropped");

  // ---- 2) backfillRecent maps + orders oldest->newest, ONE fetch only ----
  calls = 0;
  nextResult = { messages: [
    { event_id: "o1", sender: "@a", body: "first" },
    { event_id: "o2", sender: "@b", body: "second" },
    { event_id: "o3", sender: "@c", body: "third" }
  ] };
  let r = await Chat.backfillRecent(10);
  eq(r.messages.map(m => m.id), ["o1", "o2", "o3"], "backfill returned oldest->newest");
  eq([r.messages[0].sender, r.messages[0].body], ["@a", "first"], "fields mapped (sender + sanitized body)");
  eq(calls, 1, "backfill is a SINGLE recentChatMessages call (no paging loop)");
  ok(!("done" in r), "no `done` field — chat is present-forward, never asks again");

  // ---- 3) the failed flag is carried through (renderer hides it) ----
  nextResult = { messages: [
    { event_id: "g1", sender: "@a", body: "readable", failed: false },
    { event_id: "g2", sender: "@b", body: "m.bad.encrypted", failed: true }
  ] };
  r = await Chat.backfillRecent(10);
  eq(r.messages.map(m => [m.id, m.failed]), [["g1", false], ["g2", true]], "failed flag preserved per message");

  // ---- 4) SHORT result (fewer than asked): returned as-is, no re-page ----
  calls = 0;
  nextResult = { messages: [{ event_id: "s1", sender: "@a", body: "only one" }] };
  r = await Chat.backfillRecent(10);
  eq([r.messages.length, calls], [1, 1], "short backfill (1<10) returns cleanly with a single fetch — never loops");

  // ---- 5) EMPTY result (fresh room / all-undecryptable): clean no-op ----
  calls = 0;
  nextResult = { messages: [] };
  r = await Chat.backfillRecent(10);
  eq([r.messages.length, calls], [0, 1], "empty backfill -> {messages:[]}, single fetch, handled cleanly");

  // ---- 6) transport error degrades gracefully (no throw) ----
  throwNext = true;
  r = await Chat.backfillRecent(10);
  eq(r.messages.length, 0, "fetch error -> {messages:[]}, never throws");

  // ---- 7) no current room -> nothing to load, no fetch attempted ----
  Chat.destroy();
  ok(captured === null, "destroy removes the raw listener");
  calls = 0;
  r = await Chat.backfillRecent(10);
  eq([r.messages.length, calls], [0, 0], "no chat room -> {messages:[]} without touching the transport");

  if (failed) { console.log("[chat-history] " + failed + " failure(s)"); process.exit(1); }
  console.log("[chat-history] PASS — live forwards event_id; backfillRecent is one capped fetch (no paging), maps/orders, handles short/empty/error cleanly");
  process.exit(0);
})();
