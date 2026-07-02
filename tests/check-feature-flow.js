// tests/check-feature-flow.js
// WALL: the personal-queue "intent" model. Drives the real UserQueue + Queue through
// the real StreamManager + StateDeriver. ONE local list (intent); its top-2 entries
// are what should be declared. _reconcile keeps the room's declared buffer matching
// them — declaring the missing, undeclaring the removed, ordering when the arrangement
// changed. Movement/remove are pure-local reorders of intent that then reconcile.
//
// The headline invariant is SAFE-DROP BY ENTRY-ID: a song leaves intent ONLY when it
// actually played (or you remove it), and the drop is keyed on a local entry-id bound
// to the declared head — never the shared videoId — so three copies of one song lose
// exactly the one that played, and a recent repeat can never drop the wrong entry.

const assert = require("assert");
const { loadInContext } = require("./_load");

// Stub bridge: ingests sends into the real StreamManager as "@me:hs", rank 20.
const bridge = {
  _sm: null, l: 0, n: 0,
  getUserId() { return "@me:hs"; },
  async sendEvent(channel, type, content) {
    bridge.l++; bridge.n++;
    const body = Object.assign({}, content, { t: type, l: bridge.l, dv: 1 });
    const raw = {
      event_id: "$e" + bridge.n, room_id: "!r:hs", type: "m.room.message",
      sender: "@me:hs", senderRank: 20, ts: 1000 + bridge.n,
      content: { body: JSON.stringify(body) }, l: bridge.l
    };
    bridge._sm.ingest(raw);
    return raw;
  }
};
// In-memory StorageIO.
const storage = (() => {
  const m = {};
  return {
    save(k, v) { m[k] = JSON.parse(JSON.stringify(v)); },
    load(k) { return m[k] ? JSON.parse(JSON.stringify(m[k])) : null; },
    remove(k) { delete m[k]; }
  };
})();

const sb = loadInContext(
  ["core/logger.js", "core/store.js", "core/statederiver.js", "core/streammanager.js", "features/queue.js", "features/userqueue.js"],
  { Date, URL, MatrixBridge: bridge, StorageIO: storage }
);
bridge._sm = sb.StreamManager;
const { Queue, UserQueue, StreamManager } = sb;

// Deterministic clock for the 5s settle timer: the test fast-forwards instead of
// really waiting. tick(ms) advances time and fires any timers now due.
const DEBOUNCE_MS = 5000;
const clock = (() => {
  let jobs = {}, now = 0, seq = 0;
  return {
    set(fn, ms) { const id = ++seq; jobs[id] = { fn: fn, at: now + ms }; return id; },
    clear(id) { delete jobs[id]; },
    tick(ms) {
      now += ms;
      const due = Object.keys(jobs).map(k => [k, jobs[k]]).filter(e => e[1].at <= now).sort((a, b) => a[1].at - b[1].at);
      for (const e of due) { delete jobs[e[0]]; e[1].fn(); }
    },
    pending() { return Object.keys(jobs).length; }
  };
})();
UserQueue.setClock(clock);
const settle = () => clock.tick(DEBOUNCE_MS);   // fire the pending settle timer

function fail(msg, got) {
  console.log("[feature-flow] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
const j = (x) => JSON.stringify(x);
function myPending() {
  const e = (StreamManager.getState().rotation || []).find(r => r.user === "@me:hs");
  return e ? e.pending.map(p => p.videoId) : [];
}
function itemIds() { return UserQueue.items().map(e => e.videoId); }
function itemEids() { return UserQueue.items().map(e => e.eid); }
function belowIds() { return UserQueue.list().map(s => s.videoId); }   // entries below the declared window
function expect(actualArr, expectedArr, msg) { if (j(actualArr) !== j(expectedArr)) fail(msg, actualArr); }

// Advance: emit a play following the current play-instance (as Playback would).
async function play() {
  const np = StreamManager.getState().nowPlaying;
  return bridge.sendEvent("!ev:hs", "ddjp.dj.play", { p: np ? np.pi : null });
}
const url = (id) => "https://www.youtube.com/watch?v=" + id;
const X = "XXXXXXXXXXX";

async function run() {
  Queue.init("!ev:hs");
  UserQueue.init("space1");
  UserQueue.resync();   // simulate room.js after history replay: go live so plays absorb

  // 0) URL hygiene: a misclicked paste with stray trailing characters must not smuggle
  //    a malformed id in. A recoverable id (junk after 11 valid chars) is cleaned and
  //    accepted; an unrecoverable one (too short, or 12+ run-on chars) is rejected.
  {
    const ID1 = "o69Rl5BJb2I", ID2 = "dQw4w9WgXcQ";
    const a = UserQueue.add(url(ID1) + "\\");            // trailing backslash → strip → accept
    if (!a.ok || a.videoId !== ID1) fail("trailing junk should strip to the clean id", a);
    UserQueue.removeAt(0);
    const b = UserQueue.add(url(ID1) + "xx");            // 13 run-on valid chars → ambiguous → reject
    if (b.ok) fail("an over-length run-on id must be rejected, not truncated", b);
    const c = UserQueue.add("https://www.youtube.com/watch?v=short");   // too short → reject
    if (c.ok) fail("a too-short id must be rejected", c);
    const d = UserQueue.add("https://youtu.be/" + ID2 + ".");           // youtu.be trailing junk → strip
    if (!d.ok || d.videoId !== ID2) fail("youtu.be trailing junk should strip to the clean id", d);
    UserQueue.removeAt(0);
    expect(itemIds(), [], "url-hygiene checks leave the list empty for the scenario");
  }

  // 1) Add three songs before joining — they only sit in intent; nothing is declared.
  UserQueue.add(url("AAAAAAAAAAA"));
  UserQueue.add(url("BBBBBBBBBBB"));
  UserQueue.add(url("CCCCCCCCCCC"));
  expect(itemIds(), ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"], "songs sit in intent before joining");
  expect(myPending(), [], "nothing should be declared before joining");

  // 2) Join — the top two of intent are declared to the room.
  UserQueue.joinRoomQueue();
  expect(myPending(), ["AAAAAAAAAAA", "BBBBBBBBBBB"], "joining declares the top two");
  expect(itemIds(), ["AAAAAAAAAAA", "BBBBBBBBBBB", "CCCCCCCCCCC"], "intent still holds all three");
  expect(belowIds(), ["CCCCCCCCCCC"], "one song below the declared window");

  // 3) A play consumes AAA — the played entry drops from intent immediately. The
  //    survivor BBB stays declared; the newly-arrived slot-2 song CCC counts down (the
  //    debounce) and is declared only once the settle window elapses.
  await play();
  if (StreamManager.getState().nowPlaying.song.videoId !== "AAAAAAAAAAA") fail("first play should start AAA");
  expect(itemIds(), ["BBBBBBBBBBB", "CCCCCCCCCCC"], "the played song leaves intent (played → dropped)");
  expect(myPending(), ["BBBBBBBBBBB"], "the survivor stays declared; the next song is still counting down (not sent)");
  settle();
  expect(myPending(), ["BBBBBBBBBBB", "CCCCCCCCCCC"], "after the settle window the next song is declared");

  // 4) A play consumes BBB — nothing left to refill with.
  await play();
  expect(itemIds(), ["CCCCCCCCCCC"], "played BBB leaves intent");
  expect(myPending(), ["CCCCCCCCCCC"], "buffer drops to one with nothing left to refill");

  // 5) A play consumes CCC — it drops from intent, my buffer empties so I leave the
  //    visible rotation, but CCC is now-playing and I'm its DJ (the "on the decks" window).
  await play();
  expect(itemIds(), [], "played CCC leaves intent — nothing left");
  expect(myPending(), [], "buffer empty after the last song");
  if ((StreamManager.getState().rotation || []).some(r => r.user === "@me:hs")) fail("I should have fallen out of the visible rotation buffer");
  const npNow = StreamManager.getState().nowPlaying;
  if (!npNow || npNow.dj !== "@me:hs") fail("I should still be the now-playing DJ (CCC playing)");
  if (UserQueue.isActive()) fail("running dry turns participation off");

  // 6) AUTO-REJOIN while still now-playing: adding re-enters me without a manual Join.
  UserQueue.add(url("DDDDDDDDDDD"));
  expect(myPending(), ["DDDDDDDDDDD"], "adding while still now-playing auto-rejoins and declares");
  expect(itemIds(), ["DDDDDDDDDDD"], "the added song is in intent and declared");

  // 7) TRUE fall-out: play DDD (drops from intent, I leave), then advance again so
  //    nothing of mine is on the decks.
  await play();   // DDD plays → drops from intent, buffer empties
  await play();   // DDD ends → nothing playing, I'm fully out
  const npAfter = StreamManager.getState().nowPlaying;
  if (npAfter && npAfter.dj === "@me:hs") fail("I should no longer be the now-playing DJ");
  if (UserQueue.isActive()) fail("should be inactive after a true fall-out");
  expect(itemIds(), [], "intent is empty after everything played");

  // 8) After a TRUE fall-out, adding only sits in intent — no silent re-entry.
  UserQueue.add(url("EEEEEEEEEEE"));
  expect(myPending(), [], "adding after a true fall-out must NOT auto-declare or re-enter");
  expect(itemIds(), ["EEEEEEEEEEE"], "the added song just sits in intent");

  // 9) Re-joining explicitly declares the waiting song (immediate — an empty buffer
  //    must never wait on the settle timer).
  UserQueue.joinRoomQueue();
  expect(myPending(), ["EEEEEEEEEEE"], "re-joining declares the waiting song");
  UserQueue.removeAt(0); settle();   // clear for the next scenario: the undeclare settles, then we fall out
  expect(itemIds(), [], "cleared for the safe-drop scenario");
  if (UserQueue.isActive()) fail("removing the only song and settling should fall you out");

  // 10) SAFE-DROP BY ENTRY-ID — the headline invariant. Three copies of the SAME video
  //     are three separate entries. Playing one drops EXACTLY that entry (by eid); the
  //     other two survive. If drop were keyed on videoId, all three (or the wrong one)
  //     would be at risk — this proves it isn't.
  UserQueue.add(url(X));
  UserQueue.add(url(X));
  UserQueue.add(url(X));
  const xe = itemEids();
  expect(itemIds(), [X, X, X], "three copies of one video = three entries");
  if (xe[0] === xe[1] || xe[1] === xe[2] || xe[0] === xe[2]) fail("each copy must get a distinct entry-id", xe);
  UserQueue.joinRoomQueue();
  expect(myPending(), [X, X], "two copies of the same video declared together (no dedup)");
  await play();   // declared head (the first copy) plays
  expect(itemEids(), [xe[1], xe[2]], "the PLAYED entry dropped by eid; the other two copies survive");
  expect(itemIds(), [X, X], "two copies still in intent");
  expect(myPending(), [X], "the survivor stays; the refilled copy is still counting down");
  settle();
  expect(myPending(), [X, X], "after the settle the buffer is back to two copies");
  UserQueue.clearQueue();                          // deliberate wipe → immediate undeclare + fall out
  await play();                                    // advance past the now-playing X
  if (UserQueue.isActive()) fail("clearing should leave us inactive");
  expect(itemIds(), [], "cleared for the reorder scenario");

  // 11) REORDER on the ONE list — the movement buttons are now plain reorders (no
  //     swaps/promote/demote). Local reorders are pure (no events); a reorder of the
  //     top two re-declares to match.
  ["PPPPPPPPPPP","QQQQQQQQQQQ","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT"].forEach(id => UserQueue.add(url(id)));
  expect(myPending(), [], "still out of the rotation after the adds");
  expect(itemIds(), ["PPPPPPPPPPP","QQQQQQQQQQQ","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT"], "five songs in intent");

  // 11a) Local reorders while inactive — pure, no events, no declaring.
  UserQueue.moveToBottom(0);
  expect(itemIds(), ["QQQQQQQQQQQ","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT","PPPPPPPPPPP"], "moveToBottom sends the top to the end");
  UserQueue.moveToTop(4);
  expect(itemIds(), ["PPPPPPPPPPP","QQQQQQQQQQQ","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT"], "moveToTop brings the last to the front");
  UserQueue.moveDown(0);
  expect(itemIds(), ["QQQQQQQQQQQ","PPPPPPPPPPP","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT"], "moveDown swaps with the next");
  UserQueue.moveUp(1);
  expect(itemIds(), ["PPPPPPPPPPP","QQQQQQQQQQQ","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT"], "moveUp swaps with the previous");
  UserQueue.moveToBottom(4); UserQueue.moveUp(0);   // boundary no-ops
  expect(itemIds(), ["PPPPPPPPPPP","QQQQQQQQQQQ","RRRRRRRRRRR","SSSSSSSSSSS","TTTTTTTTTTT"], "boundary moves are no-ops");
  expect(myPending(), [], "no reorder while inactive ever declared anything");

  // 11b) Join, then reorder within the top two — debounced, so it takes effect only
  //      after the settle window (a rapid flurry of reorders would batch into one send).
  UserQueue.joinRoomQueue();
  expect(myPending(), ["PPPPPPPPPPP","QQQQQQQQQQQ"], "joining declares the top two (immediate)");
  UserQueue.moveDown(0);   // P → 2nd slot
  expect(myPending(), ["PPPPPPPPPPP","QQQQQQQQQQQ"], "the reorder is still counting down — nothing sent yet");
  settle();
  expect(myPending(), ["QQQQQQQQQQQ","PPPPPPPPPPP"], "after the settle the buffer is reordered");
  UserQueue.moveUp(1); settle();     // P back to plays-next
  expect(myPending(), ["PPPPPPPPPPP","QQQQQQQQQQQ"], "and back again");

  // 11c) Bring a below-window song into the top two — the reconciler undeclares the one
  //      pushed out, declares the newcomer, and orders to the intended arrangement.
  UserQueue.moveToTop(2);  // R (below the window) → front
  expect(itemIds(), ["RRRRRRRRRRR","PPPPPPPPPPP","QQQQQQQQQQQ","SSSSSSSSSSS","TTTTTTTTTTT"], "R jumps to the front of intent immediately");
  settle();
  expect(myPending(), ["RRRRRRRRRRR","PPPPPPPPPPP"], "R takes plays-next; Q (pushed out) is undeclared");

  // 11d) Push a declared song back out — it stays in intent, just un-declared.
  UserQueue.moveToBottom(0); settle();   // R → the end
  expect(itemIds(), ["PPPPPPPPPPP","QQQQQQQQQQQ","SSSSSSSSSSS","TTTTTTTTTTT","RRRRRRRRRRR"], "R returns to the tail of intent (never lost)");
  expect(myPending(), ["PPPPPPPPPPP","QQQQQQQQQQQ"], "the top two are declared again");

  // 12) SIGNAL ECONOMY — nothing goes on the wire until the settle window elapses, a
  //     flurry of edits batches into ONE event, and the "everything shifts up" after a
  //     removal is DERIVED on each client, never sent. (bridge.n counts every event.)
  let n0 = bridge.n;
  UserQueue.moveDown(0); UserQueue.moveUp(1); UserQueue.moveDown(0);   // three rapid reorders of the top two
  if (bridge.n - n0 !== 0) fail("no event may go on the wire before the settle window", bridge.n - n0);
  settle();
  expect(myPending(), ["QQQQQQQQQQQ","PPPPPPPPPPP"], "the batched reorders resolve to one final arrangement");
  if (bridge.n - n0 !== 1) fail("a flurry of top-two reorders must send exactly 1 event once settled", bridge.n - n0);

  n0 = bridge.n;
  UserQueue.removeAt(0); settle();   // remove the declared plays-next song; the 2nd shifts up, S refills
  expect(myPending(), ["PPPPPPPPPPP","SSSSSSSSSSS"], "removing the declared head shifts the 2nd up and refills");
  expect(itemIds(), ["PPPPPPPPPPP","SSSSSSSSSSS","TTTTTTTTTTT","RRRRRRRRRRR"], "Q left intent (explicit remove); the rest stay");
  if (bridge.n - n0 !== 2) fail("removing a declared song must send exactly 2 events (undeclare + refill declare)", bridge.n - n0);

  // 12b) NEVER-STARVE override — if a play empties the buffer while the next song is
  //      still counting down, that song is declared IMMEDIATELY (no settle), so the room
  //      is never left with nothing to play.
  UserQueue.clearQueue();
  ["GGGGGGGGGGG","HHHHHHHHHHH","IIIIIIIIIII"].forEach(id => UserQueue.add(url(id)));
  UserQueue.joinRoomQueue();
  expect(myPending(), ["GGGGGGGGGGG","HHHHHHHHHHH"], "join declares the top two immediately");
  await play();   // G plays → H survives, I is counting down (debounced)
  expect(myPending(), ["HHHHHHHHHHH"], "after G plays, H stays declared and I is still counting down");
  await play();   // H plays before I's window elapses → buffer empties → override
  expect(myPending(), ["IIIIIIIIIII"], "the never-starve override declares I at once — no settle needed");
  UserQueue.clearQueue();
  await play();   // advance past the now-playing song so the next scenario starts clean

  // 13) CLEAR MY QUEUE — a deliberate wipe. Empties the whole list, undeclares
  //     everything from the room immediately, and falls us out. Distinct from a play/✕.
  ["AAAAAAAAAAA","BBBBBBBBBBB","CCCCCCCCCCC"].forEach(id => UserQueue.add(url(id)));
  UserQueue.joinRoomQueue();
  expect(myPending(), ["AAAAAAAAAAA","BBBBBBBBBBB"], "populated and declared before the clear");
  UserQueue.clearQueue();
  expect(itemIds(), [], "clear empties the whole list");
  expect(myPending(), [], "clear undeclares everything from the room (immediately)");
  if (UserQueue.isActive()) fail("clearing everything falls you out of the rotation");

  // 14) FILL-THEN-REFUSE cap — a full queue rejects new songs and keeps what it has;
  //     it must never drop what's already queued. (Run inactive: no reconcile churn.)
  let added = 0;
  while (true) { const r = UserQueue.add(url(X)); if (!r.ok) break; added++; }
  if (added < 1) fail("should accept songs up to the cap", added);
  const atCap = UserQueue.count();
  const r2 = UserQueue.add(url(X));
  if (r2.ok) fail("a full queue must refuse new songs", r2);
  if (!/full/i.test(r2.reason || "")) fail("the refusal should say the queue is full", r2);
  expect(UserQueue.count(), atCap, "a refused add must not drop or change what's queued");
  UserQueue.clearQueue();   // tidy up

  console.log("[feature-flow] PASS — one intent list feeds and refills; SAFE-DROP by entry-id (3 copies, one plays, the exact played entry drops and the other two survive); a played song leaves intent while a kick/leave/reorder never does; auto-rejoins while still now-playing; stays out after a true fall-out until an explicit re-join; malformed paste ids are cleaned or rejected; movement buttons are plain reorders (local ones pure, top-two ones re-declare); each edit is minimal on the wire (top-two reorder 1, remove 2 — the shift-up is derived, not sent); Clear wipes the whole list and falls out; and the queue fills to a cap then refuses without dropping anything");
  process.exit(0);
}

run().catch(e => fail("threw: " + e.message));
