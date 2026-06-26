// tests/check-chat-history.js
// WALL: chat is a bounded RAM window backed by Matrix. Two invariants must hold
// or the "lose the past from RAM, get it back on scroll-up" behavior breaks:
//   1) The live receive path forwards each message WITH its Matrix event_id, so
//      the render window can dedup by id (and so the same id is never drawn
//      twice across the live + scroll-up paths).
//   2) loadOlder() pages older messages from Matrix, drops anything still in the
//      window (the `seen` set), keeps oldest->newest order, and propagates a
//      `done` signal so the UI stops asking once history is exhausted — AND it
//      degrades to {done:true} on any transport error instead of throwing.
// The DOM/scroll wiring (prepend + anchored scrollTop + trim-frees-id) is
// review-only; here we exercise the REAL Chat module headlessly with stubs.

const { loadInContext } = require("./_load");

let failed = 0;
function ok(c, m) { if (!c) { console.log("[chat-history] FAIL — " + m); failed++; } }
function eq(g, w, m) { const a = JSON.stringify(g), b = JSON.stringify(w); if (a !== b) { console.log("[chat-history] FAIL — " + m + "\n      got " + a + "\n      want " + b); failed++; } }

// --- stubs: a fake DOM (sanitize uses createElement/createTextNode), a captured
//     raw-listener, and a programmable scrollbackChat (the SDK paging seam). ---
const noop = () => {};
function makeDoc() {
  return {
    createElement: () => {
      let t = "";
      return { appendChild(n) { t += (n && n.__t) || ""; }, set innerHTML(v) {}, get innerHTML() { return t; } };
    },
    createTextNode: (s) => ({ __t: String(s == null ? "" : s) })
  };
}
let captured = null;          // the raw listener Chat registers on init
let pages = [];               // queue of scrollbackChat results
let throwNext = false;        // make the next scrollbackChat throw
const MatrixBridge = {
  onRawEvent: (fn) => { captured = fn; },
  offRawEvent: () => { captured = null; },
  sendMessage: async () => {},
  scrollbackChat: async () => {
    if (throwNext) { throwNext = false; throw new Error("network"); }
    return pages.length ? pages.shift() : { messages: [], done: true };
  }
};

const { Chat } = loadInContext(["features/chat.js"], {
  Logger: { info: noop, warn: noop, error: noop, debug: noop },
  document: makeDoc(),
  MatrixBridge
});

(async () => {
  // ---- 1) live receive forwards (event_id, sender, body) ----
  const seenMsgs = [];
  Chat.onMessage((id, sender, body) => seenMsgs.push({ id, sender, body }));
  Chat.init("room1");
  ok(typeof captured === "function", "init registers a raw listener");
  captured({ type: "m.room.message", room_id: "room1", event_id: "e_live", sender: "@a:hs", content: { body: "hi" } }, {}, {});
  eq(seenMsgs, [{ id: "e_live", sender: "@a:hs", body: "hi" }], "live message forwarded with its event_id (window dedups by id)");
  // wrong room / wrong type are ignored
  captured({ type: "m.room.message", room_id: "other", event_id: "x", sender: "@a", content: { body: "no" } }, {}, {});
  captured({ type: "m.reaction", room_id: "room1", event_id: "y", sender: "@a", content: {} }, {}, {});
  eq(seenMsgs.length, 1, "messages from another room / non-message events are dropped");

  // ---- 2) loadOlder maps + orders oldest->newest, done=false while paging ----
  pages = [{ messages: [
    { event_id: "o1", sender: "@a", body: "first" },
    { event_id: "o2", sender: "@b", body: "second" },
    { event_id: "o3", sender: "@c", body: "third" }
  ], done: false }];
  let r = await Chat.loadOlder(30, new Set());
  eq(r.messages.map(m => m.id), ["o1", "o2", "o3"], "older page returned oldest->newest");
  eq([r.messages[0].sender, r.messages[0].body], ["@a", "first"], "fields mapped (sender + sanitized body)");
  eq(r.done, false, "more history available -> done:false");

  // ---- 3) dedup against the current window (trimmed ids are NOT in `seen`) ----
  pages = [{ messages: [
    { event_id: "o4", sender: "@a", body: "keep" },
    { event_id: "o5", sender: "@b", body: "drop" },
    { event_id: "o6", sender: "@c", body: "keep" }
  ], done: false }];
  r = await Chat.loadOlder(30, new Set(["o5"]));
  eq(r.messages.map(m => m.id), ["o4", "o6"], "messages already in the window are filtered out");
  // A message that was trimmed from the DOM is absent from `seen`, so it comes back:
  pages = [{ messages: [{ event_id: "o5", sender: "@b", body: "back" }], done: false }];
  r = await Chat.loadOlder(30, new Set(["o4", "o6"]));
  eq(r.messages.map(m => m.id), ["o5"], "a trimmed-then-reloaded message renders again (not suppressed)");

  // ---- 4) done propagates so the UI stops asking ----
  pages = [{ messages: [], done: true }];
  r = await Chat.loadOlder(30, new Set());
  eq([r.messages.length, r.done], [0, true], "server has no older history -> done:true, empty");

  // ---- 5) transport error degrades gracefully (no throw) ----
  throwNext = true;
  r = await Chat.loadOlder(30, new Set());
  eq([r.messages.length, r.done], [0, true], "scrollback error -> {messages:[], done:true}, never throws");

  // ---- 6) no current room -> nothing to load ----
  Chat.destroy();
  ok(captured === null, "destroy removes the raw listener");
  r = await Chat.loadOlder(30, new Set());
  eq([r.messages.length, r.done], [0, true], "no chat room -> done:true, empty");

  if (failed) { console.log("[chat-history] " + failed + " failure(s)"); process.exit(1); }
  console.log("[chat-history] PASS — live forwards event_id; loadOlder pages/orders/dedups, propagates done, degrades on error");
  process.exit(0);
})();
