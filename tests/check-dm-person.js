// tests/check-dm-person.js
// SUBJECT: backends/backend1/matrixaccount.js, features/chat.js
// WALL: A CONVERSATION IS A PERSON: REUSED, NEVER DUPLICATED BY THIS APP, AND WHOLE WHEN ELEMENT DUPLICATED IT.
//
// Owner rulings, `main/04-features.md` §Direct messages (ddjp_432). Messaging someone reuses the
// conversation you have; a room is made only when no usable one exists. Several rooms with one person
// — a wrong step in Element — are ONE conversation: their history merged, and replies going to the most
// recently active room you are both still in.
//
// READ AGAINST THE TREE THIS REPLACES (ddjp_431), each mechanism named where it lived:
//   · reuse depended only on `m.direct`, which THIS app writes — a room Element made or accepted without
//     writing it was not found, so the Message button made another;
//   · `findDMRoom` returned the FIRST room we were joined to and never asked whether THE OTHER PERSON was
//     still in it, so a reply could go into a room they had left;
//   · nothing stopped a second Message click while the first room was being created;
//   · opening a conversation marked it read with the DEVICE clock against server stamps (README trap 2);
//   · the list was per ROOM, so two rooms with one person were two conversations.
// Every part below drives the REAL `matrixaccount.js` (through `MatrixBridge._setClientForTest`, the seam
// `check-dm-gaps` uses) and the REAL `features/chat.js`. The client is a double — there is no SDK — built
// from the SDK calls the transport makes: `getRooms`, `getRoom`, `getMember`, `getMembers`,
// `getLastActiveTimestamp`, `currentState.getStateEvents`, `getAccountData`/`setAccountData`, `createRoom`.

const { loadInContext } = require("./_load");
let asserts = 0;
function fail(msg, got) { console.log("[dm-person] FAIL — " + msg); if (got !== undefined) console.log("      got " + JSON.stringify(got)); process.exit(1); }
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
let reachedVerdict = false;
process.on("exit", (code) => { if (code === 0 && !reachedVerdict) { console.log("[dm-person] FAIL — exited before the verdict"); process.exitCode = 1; } });

const ME = "@me:hs";
// One DM room as the SDK presents it. `peer` is the other person; `peerIs` their membership.
function room(id, peer, peerIs, lastTs, o) {
  const x = o || {};
  return {
    roomId: id,
    getMyMembership: () => x.mine || "join",
    getMember: (u) => (u === peer ? { userId: peer, membership: peerIs } : (u === ME ? { userId: ME, membership: x.mine || "join" } : null)),
    getMembers: () => [{ userId: ME, membership: x.mine || "join" }, { userId: peer, membership: peerIs }].concat(x.extra || []),
    getLastActiveTimestamp: () => lastTs,
    currentState: { getStateEvents: (t, k) => (t === "m.room.member" && (k === ME || k === peer) && x.direct)
      ? { getContent: () => ({ is_direct: true }), getSender: () => peer } : null },
  };
}
// A room we are INVITED to, as the SDK presents one: our member event says who invited us, when, and that it is direct.
function invite(id, from, ts) {
  const r = { roomId: id, _mine: "invite", getMyMembership() { return this._mine; }, getJoinedMemberCount: () => 1,
    getMember: () => null, getMembers: () => [], getLastActiveTimestamp: () => ts,
    currentState: { getStateEvents: (t, k) => (t === "m.room.member" && k === ME)
      ? { getContent: () => ({ is_direct: true }), getSender: () => from, getTs: () => ts } : null } };
  return r;
}
function world(rooms, direct) {
  const account = { direct: direct || {} }, created = [], writes = [], joined = [], left = [], listeners = {};
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/matrixbridge.js",
    "backends/backend1/matrixaccount.js", "core/storageio.js", "core/idb.js", "core/store.js", "core/chatprefs.js", "features/chat.js"], {
    Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval, clearInterval, window: {}, document: { body: { appendChild() {} } },
    localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
    indexedDB: undefined,
  });
  let n = 0;
  const client = {
    getUserId: () => ME,
    getRooms: () => rooms,
    getRoom: (id) => rooms.find((r) => r.roomId === id) || null,
    getAccountData: (t) => (t === "m.direct" ? { getContent: () => account.direct } : null),
    setAccountData: async (t, v) => { if (t === "m.direct") { writes.push(JSON.parse(JSON.stringify(v))); account.direct = JSON.parse(JSON.stringify(v)); } },
    createRoom: async (opts) => { await new Promise((r) => setTimeout(r, 5)); const id = "!new" + (++n) + ":hs"; created.push({ id, invite: opts.invite });
      rooms.push(room(id, opts.invite[0], "invite", 0, { direct: true })); return { room_id: id }; },
    sendMessage: async () => ({}),
    joinRoom: async (id) => { joined.push(id); await new Promise((r) => setTimeout(r, 5)); const r = rooms.find((x) => x.roomId === id); if (r) r._mine = "join"; return { room_id: id }; },
    leave: async (id) => { left.push(id); const r = rooms.find((x) => x.roomId === id); if (r) r._mine = "leave"; },
    on: (evt, fn) => { (listeners[evt] = listeners[evt] || []).push(fn); },
    // `MatrixAccount.cryptoAvailable` reads `getCrypto()`; a DM refuses to send without it.
    getCrypto: () => ({}),
    // The SDK's sync state: PREPARED/SYNCING once the first sync has landed. A world can set `syncState`.
    getSyncState: () => (world.syncState === undefined ? "SYNCING" : world.syncState),
  };
  ok(typeof sb.MatrixBridge._setClientForTest === "function", "APPLIED — the client seam must exist on MatrixBridge", null);
  sb.MatrixBridge._setClientForTest(client);
  const emit = (evt) => { for (const fn of (listeners[evt] || [])) fn(); };
  return { sb, MA: sb.MatrixAccount, C: sb.Chat, P: sb.ChatPrefs, account, created, writes, rooms, joined, left, emit };
}

(async () => {
  // ═══ PART A — which room is the conversation, and where a reply goes ═══════════════════════════
  {
    const w = world([
      room("!old:hs", "@alice:hs", "leave", 900),                      // m.direct lists it; she LEFT
      room("!first:hs", "@alice:hs", "join", 1000),                     // m.direct lists it; both in
      room("!element:hs", "@alice:hs", "join", 3000, { direct: true }), // made in Element; NOT in m.direct
      room("!bob:hs", "@bob:hs", "invite", 500),                        // we started it; Bob has not accepted
      room("!team:hs", "@carol:hs", "join", 4000, { extra: [{ userId: "@dan:hs", membership: "join" }] }), // a group room
    ], { "@alice:hs": ["!old:hs", "!first:hs"], "@bob:hs": ["!bob:hs"] });
    ok(typeof w.MA.dmRoomsWith === "function" && typeof w.MA.pickDMRoom === "function",
      "A: APPLIED — `MatrixAccount.dmRoomsWith` and `pickDMRoom` must exist", null);
    const alice = w.MA.dmRoomsWith("@alice:hs").map((r) => r.roomId).sort();
    ok(alice.join() === "!element:hs,!first:hs,!old:hs",
      "A: EVERY ROOM WITH HER IS FOUND — the two `m.direct` lists AND the one Element made, which Matrix marks direct " +
      "and this app never recorded. The tree before this found only `m.direct`'s, so the Message button made a fourth", alice);
    ok(w.MA.findDMRoom("@alice:hs") === "!element:hs",
      "A: A REPLY GOES TO THE MOST RECENTLY ACTIVE ROOM YOU ARE BOTH IN (owner ruling) — not the first listed", w.MA.findDMRoom("@alice:hs"));
    const onlyOld = w.MA.pickDMRoom([{ roomId: "!old:hs", other: "leave", lastTs: 9999 }]);
    ok(onlyOld === null,
      "A: NEVER A ROOM SHE LEFT, however recent — the tree before this returned the first room WE were in and never " +
      "asked about her, so a reply could go where nobody reads it", onlyOld);
    ok(w.MA.findDMRoom("@bob:hs") === "!bob:hs",
      "A: a room they are INVITED to counts when there is nothing better — a conversation you started that they have not accepted", null);
    ok(w.MA.dmRoomsWith("@carol:hs").length === 0 && w.MA.dmRoomIds().indexOf("!team:hs") < 0,
      "A: a GROUP room is never a DM, even with an old flag — one other person, or it is not a conversation with them", null);
    ok(w.MA.dmRoomIds().indexOf("!element:hs") >= 0,
      "A: AND THE ELEMENT ROOM IS IN SCOPE, so its messages are received — scope is the only thing the DM filter tests", w.MA.dmRoomIds());
    // m.direct is repaired by APPENDING, so Element and this app see the same set; nothing listed is dropped.
    const added = await w.MA.repairDirect();
    ok(added === 1 && JSON.stringify(w.account.direct["@alice:hs"]) === JSON.stringify(["!old:hs", "!first:hs", "!element:hs"]) &&
       JSON.stringify(w.account.direct["@bob:hs"]) === JSON.stringify(["!bob:hs"]),
      "A: THE ELEMENT ROOM IS ADDED TO `m.direct` AND NOTHING ELSE CHANGES — append-only, every existing entry kept", w.account.direct);
    ok((await w.MA.repairDirect()) === 0 && w.writes.length === 1,
      "A: and a second repair writes nothing — account data is written only when something is missing", w.writes.length);
  }

  // ═══ PART B — reuse, and one creation at a time ════════════════════════════════════════════════
  {
    const w = world([room("!a:hs", "@alice:hs", "join", 1000)], { "@alice:hs": ["!a:hs"] });
    w.C.dmInit();
    const r1 = await w.C.openDM("@alice:hs");
    ok(r1.ok && r1.roomId === "!a:hs" && w.created.length === 0, "B: MESSAGING HER AGAIN REUSES THE CONVERSATION — no new room", { r1, created: w.created });
    const w2 = world([], {});
    w2.C.dmInit();
    const [x, y] = await Promise.all([w2.C.openDM("@zoe:hs"), w2.C.openDM("@zoe:hs")]);
    ok(w2.created.length === 1 && x.roomId === y.roomId,
      "B: TWO CLICKS WHILE THE FIRST ROOM IS BEING MADE MAKE ONE ROOM — the tree before this made two", { created: w2.created, x, y });
    const again = await w2.C.openDM("@zoe:hs");
    ok(w2.created.length === 1 && again.roomId === x.roomId, "B: and the next click reuses it", again);
  }

  // ═══ PART C — the conversation is the person: one row, merged history, a reply that follows ═══════
  {
    const rooms = [room("!first:hs", "@alice:hs", "join", 1000), room("!element:hs", "@alice:hs", "join", 500, { direct: true })];
    const w = world(rooms, { "@alice:hs": ["!first:hs"] });
    w.C.dmInit();
    w.P.dmTouch("!first:hs", "@alice:hs", 1000);
    w.P.dmTouch("!element:hs", "@alice:hs", 500);
    const convs = w.C.conversations();
    ok(convs.length === 1 && convs[0].userId === "@alice:hs" && convs[0].roomIds.slice().sort().join() === "!element:hs,!first:hs",
      "C: TWO ROOMS WITH HER ARE ONE CONVERSATION IN THE LIST — one row, both rooms under it", convs);
    await w.C.openDM("@alice:hs");
    ok(w.C.currentDM() === "!first:hs", "C premise: while !first is the most active, it is the send target", w.C.currentDM());
    // She writes in the Element room: it becomes the most recently active, and the reply follows her there.
    rooms[1].getLastActiveTimestamp = () => 2000;
    const sent = [];
    w.sb.MatrixBridge.sendMessage = async (roomId, text) => { sent.push(roomId); };
    const sres = await w.C.sendDM("hi again");
    ok(sres && sres.ok === true, "C premise: the send itself succeeded, so where it went is a reading of the routing", sres);
    ok(sent.join() === "!element:hs",
      "C: A REPLY FOLLOWS HER TO THE ROOM SHE IS ACTIVE IN — the target is picked at send time, not remembered", sent);
    // The history of both rooms, merged in time order.
    w.sb.MatrixBridge.recentChatMessages = async (roomId) => ({ messages: roomId === "!first:hs"
      ? [{ event_id: "$f1", sender: "@alice:hs", body: "one", ts: 100 }, { event_id: "$f3", sender: ME, body: "three", ts: 300 }]
      : [{ event_id: "$e2", sender: "@alice:hs", body: "two", ts: 200 }] });
    const bf = await w.C.backfillDM(10);
    ok(bf.messages.map((m) => m.id).join() === "$f1,$e2,$f3",
      "C: HER HISTORY FROM EVERY ROOM IS ONE TIMELINE, in server-time order", bf.messages);
    // Marking read uses the SERVER stamps — a device clock far ahead must not mark a later message read.
    const P = w.P;
    P.dmTouch("!first:hs", "@alice:hs", 5000);
    ok(w.C.conversations()[0].unread === true, "C premise: a newer message makes her conversation unread — THIS is where a DEVICE-CLOCK read " +
      "marker shows first: opening her conversation above would have marked everything up to the device's now as read", w.C.conversations());
    // The world's clock is the real one (~1.8e12 ms), far AHEAD of these server stamps — the case the rule is about.
    const res = w.C.openDMRoom("!first:hs");
    ok(res.ok && w.C.conversations()[0].unread === false, "C: opening it clears it", w.C.conversations());
    P.dmTouch("!first:hs", "@alice:hs", 6000);
    ok(w.C.conversations()[0].unread === true,
      "C: AND A LATER MESSAGE IS UNREAD AGAIN — the read marker was the conversation's own stamp, not the device clock. " +
      "The tree before this marked read at `Date.now()`, so a device clock ahead of the server hid new messages",
      P.dmList());
  }

  // ═══ PART D — a request is a conversation row (owner rulings, ddjp_433) ═══════════════════════════
  {
    const rooms = [room("!a:hs", "@alice:hs", "join", 1000), room("!b:hs", "@bob:hs", "join", 2500),
      invite("!ainv:hs", "@alice:hs", 3000),                                      // Alice again, a new room
      invite("!s1:hs", "@spam:hs", 2000), invite("!s2:hs", "@spam:hs", 2100), invite("!s3:hs", "@spam:hs", 2200),
      invite("!c1:hs", "@carl:hs", 500)];
    const w = world(rooms, { "@alice:hs": ["!a:hs"], "@bob:hs": ["!b:hs"] });
    const notes = [];
    w.C.onDMNotify((roomId) => notes.push(roomId));
    w.C.dmInit();
    w.P.dmTouch("!a:hs", "@alice:hs", 1000); w.P.dmTouch("!b:hs", "@bob:hs", 2500);
    const rows = w.C.conversations();
    ok(rows.map((r) => r.userId).join() === "@alice:hs,@bob:hs,@spam:hs,@carl:hs",
      "D: REQUESTS AND CONVERSATIONS ARE ONE LIST, MOST RECENT AT THE TOP (owner ruling)", rows.map((r) => [r.userId, r.lastTs]));
    const spam = rows.find((r) => r.userId === "@spam:hs"), alice = rows.find((r) => r.userId === "@alice:hs");
    ok(spam.request === true && spam.requests.slice().sort().join() === "!s1:hs,!s2:hs,!s3:hs" && spam.roomIds.length === 0,
      "D: THREE INVITES FROM ONE PERSON ARE ONE ROW — the tree before this showed three lines", spam);
    ok(alice.request === true && alice.roomIds.join() === "!a:hs" && alice.requests.join() === "!ainv:hs",
      "D: an invite from someone you ALREADY talk to joins their existing row rather than making a second", alice);
    ok(rows.every((r) => !r.request || r.unread === true) && w.C.dmUnreadCount() >= 3,
      "D: a request counts as unread, so the DMs tab carries the purple dot", w.C.dmUnreadCount());
    ok(notes.length === 0, "D: invites already there when the app starts are shown, not chimed — they are not new", notes);
    // Answer: all of a person's invites, once, however many clicks.
    const [x, y] = await Promise.all([w.C.acceptDMRequest("@spam:hs"), w.C.acceptDMRequest("@spam:hs")]);
    ok(x.ok && y.ok && w.joined.slice().sort().join() === "!s1:hs,!s2:hs,!s3:hs",
      "D: ACCEPT JOINS EVERY INVITE FROM THAT PERSON — once each, even for two quick clicks", { joined: w.joined, x, y });
    ok(w.C.conversations().filter((r) => r.userId === "@spam:hs").every((r) => !r.request),
      "D: and afterwards they are an ordinary conversation, not a request", w.C.conversations().filter((r) => r.userId === "@spam:hs"));
    const d = await w.C.declineDMRequest("@carl:hs");
    ok(d.ok && w.left.join() === "!c1:hs" && !w.C.conversations().some((r) => r.userId === "@carl:hs"),
      "D: REFUSE DECLINES THEIR INVITES AND THE ROW GOES", { left: w.left, rows: w.C.conversations().map((r) => r.userId) });
    // A NEW invite, after the app started: shown and chimed, once.
    rooms.push(invite("!new:hs", "@dora:hs", 4000));
    w.emit("Room.myMembership");
    w.emit("Room.myMembership");
    ok(notes.join() === "!new:hs" && w.C.conversations()[0].userId === "@dora:hs",
      "D: A NEW REQUEST NOTIFIES ONCE AND GOES TO THE TOP — the tree before this had no signal at all, so a request " +
      "got no dot and no chime until something else happened to redraw the panel", { notes, top: w.C.conversations()[0] });
  }

  // ═══ PART E — DMs open, and do not freeze (reported: "they don't open quite often, and it looks permanent") ══
  // Reproduced at ddjp_436 against this file, with a positive result each: clicking a person whose newest
  // message was in a room joined after entry returned `not-a-dm` — scope was computed ONCE at room entry
  // and the refusal was silent; and one room scan over ten 3000-member rooms took ~100 ms, several per
  // click, because every member of every room was listed (and de-duplicated in quadratic time).
  {
    // A room joined AFTER entry opens, and the person's conversation opens with it.
    const rooms = [room("!a1:hs", "@alice:hs", "join", 10)];
    const w = world(rooms, { "@alice:hs": ["!a1:hs"] });
    w.C.dmInit();
    rooms.push(room("!a2:hs", "@alice:hs", "join", 20, { direct: true }));      // she opened it from Element
    w.P.dmTouch("!a1:hs", "@alice:hs", 10); w.P.dmTouch("!a2:hs", "@alice:hs", 20);
    const row = w.C.conversations()[0];
    ok(row.roomId === "!a2:hs" && !w.MA.inDMScope("!a2:hs"), "E premise: her row opens the room joined after entry, which scope never saw", row);
    const res = w.C.openDMRoom(row.roomId);
    ok(res.ok === true && w.C.currentDMPerson() === "@alice:hs" && w.MA.inDMScope("!a2:hs"),
      "E: CLICKING HER CONVERSATION OPENS IT — the room joined after entry is recognised as hers and taken into scope, " +
      "where the tree before this refused it silently and kept refusing until the room was re-entered", { res, scoped: w.MA.inDMScope("!a2:hs") });
    // Scope follows the rooms: one joined later is received without any click at all.
    rooms.push(room("!a3:hs", "@alice:hs", "join", 30, { direct: true }));
    w.emit("Room.myMembership");
    ok(w.MA.inDMScope("!a3:hs"), "E: A DM ROOM JOINED LATER IS IN SCOPE AS SOON AS THE ROOM LIST MOVES, so its messages are received", null);
    // Never at the expense of the rule that makes scope safe: a group room is not a DM.
    rooms.push(room("!grp:hs", "@alice:hs", "join", 40, { extra: [{ userId: "@eve:hs", membership: "join" }] }));
    w.emit("Room.myMembership");
    const g = w.C.openDMRoom("!grp:hs");
    ok(g.ok === false && g.reason === "not-a-dm" && !w.MA.inDMScope("!grp:hs"),
      "E: A GROUP ROOM IS STILL REFUSED and never enters scope — scope is the only thing the DM receive filter tests", g);
    // THE COST, AS A CALL COUNT (not a stopwatch, which would be flaky): a room with more than two members is
    // never a DM, so its member list is never walked. Its count comes from the room summary, which is cheap.
    let walked = 0;
    const big = { roomId: "!big:hs", getMyMembership: () => "join", getJoinedMemberCount: () => 3001, getInvitedMemberCount: () => 0,
      getMembers: () => { walked++; return []; }, getMember: () => null, getLastActiveTimestamp: () => 1, currentState: { getStateEvents: () => null } };
    rooms.push(big);
    w.MA.dmRoomIds(); w.MA.dmRoomsWith("@alice:hs"); w.MA.findDMRoom("@alice:hs"); w.MA.dmPeerOf("!a1:hs");
    ok(walked === 0, "E: A BIG ROOM'S MEMBER LIST IS NEVER WALKED — the tree before this listed every member of every room, " +
      "several times per click, and a space of a few thousand froze the panel", walked);
  }

  // ═══ PART F — a DM with no label still opens (reported: "That conversation could not be opened") ═════
  // Reproduced at ddjp_437 (/tmp/probe-dm2.js): a JOINED one-to-one room that `m.direct` does not list and
  // whose member events carry no `is_direct` — the flag rides on the INVITE, and joining replaces it — was
  // refused, both with the person known and with only our own messages seen. The evidence it is a DM is
  // our OWN conversation index: a room is only ever indexed after it was in DM scope.
  {
    const bare = (id, peer, peerIs, o) => { const x = o || {}; const mem = [{ userId: ME, membership: x.mine || "join" }].concat(peer ? [{ userId: peer, membership: peerIs }] : []).concat(x.extra || []);
      return { roomId: id, getMyMembership: () => x.mine || "join", getMembers: () => mem,
        getJoinedMemberCount: () => mem.filter((m) => m.membership === "join").length, getInvitedMemberCount: () => mem.filter((m) => m.membership === "invite").length,
        getMember: (u) => mem.find((m) => m.userId === u) || null, getLastActiveTimestamp: () => 5, currentState: { getStateEvents: () => null } }; };
    const rooms = [bare("!e:hs", "@alice:hs", "join"), bare("!n:hs", "@bob:hs", "join"),
                   bare("!g:hs", "@carl:hs", "join", { extra: [{ userId: "@dan:hs", membership: "join" }] }), bare("!stranger:hs", "@eve:hs", "join")];
    const w = world(rooms, {});
    w.C.dmInit();
    w.P.dmTouch("!e:hs", "@alice:hs", 5);   // person known
    w.P.dmTouch("!n:hs", "", 6);            // only our own messages were ever seen
    w.P.dmTouch("!g:hs", "@carl:hs", 7);    // a group room somehow in the index
    const e = w.C.openDMRoom("!e:hs");
    ok(e.ok === true && w.C.currentDMPerson() === "@alice:hs" && w.MA.inDMScope("!e:hs"),
      "F: A JOINED ONE-TO-ONE ROOM OUR OWN LIST HELD OPENS, though nothing labels it a DM — it was refused", e);
    await new Promise((r) => setTimeout(r, 10));
    ok(JSON.stringify(w.account.direct["@alice:hs"]) === JSON.stringify(["!e:hs"]),
      "F: AND IT IS RECORDED IN `m.direct` (appended), so it stays recognised — here after a reload, and in Element", w.account.direct);
    const n = w.C.openDMRoom("!n:hs");
    ok(n.ok === true && w.C.currentDMPerson() === "@bob:hs",
      "F: EVEN WHEN THE LIST NEVER LEARNED WHO IT WAS WITH — the room's one other member is the person", n);
    const g = w.C.openDMRoom("!g:hs");
    ok(g.ok === false && g.reason === "group" && !w.MA.inDMScope("!g:hs"),
      "F: A GROUP ROOM IS STILL REFUSED — and the refusal NAMES why, rather than one sentence for every case", g);
    ok(!w.MA.inDMScope("!stranger:hs") && w.MA.dmRoomIds().indexOf("!stranger:hs") < 0,
      "F: AN UNLABELLED ROOM THIS APP NEVER HELD IS NOT TAKEN IN — without our own index as evidence, a member count " +
      "alone does not make a room a conversation", w.MA.dmRoomIds());
    // A room ALREADY IN SCOPE whose index row never learned the person (an accept that could not name the
    // inviter adds scope without a person): the room's one other member is who it is with.
    rooms.push(bare("!n2:hs", "@fay:hs", "join"));
    w.MA.addDMScope("!n2:hs");
    w.P.dmTouch("!n2:hs", "", 8);
    const n2 = w.C.openDMRoom("!n2:hs");
    ok(n2.ok === true && w.C.currentDMPerson() === "@fay:hs",
      "F: A ROOM IN SCOPE WITH NO KNOWN PERSON opens as the conversation with its one other member", { n2, person: w.C.currentDMPerson() });
    // The cost rule holds here too: a big room in the index is refused from its COUNT, never walked.
    let walked = 0;
    rooms.push({ roomId: "!bigheld:hs", getMyMembership: () => "join", getJoinedMemberCount: () => 3001, getInvitedMemberCount: () => 0,
      getMembers: () => { walked++; return []; }, getMember: () => null, getLastActiveTimestamp: () => 1, currentState: { getStateEvents: () => null } });
    w.P.dmTouch("!bigheld:hs", "@carl:hs", 9);
    const bg = w.C.openDMRoom("!bigheld:hs");
    ok(bg.ok === false && bg.reason === "group" && walked === 0,
      "F: A BIG ROOM IN THE LIST IS REFUSED FROM ITS MEMBER COUNT — its members are never walked (the freeze of ddjp_436)", { bg, walked });
    const st = w.C.openDMRoom("!stranger:hs");
    ok(st.ok === false && !w.MA.inDMScope("!stranger:hs"),
      "F: and CLICKING toward it opens nothing — the index is the evidence, so a room outside it stays out", st);
  }

  // ═══ PART G — a conversation whose room is GONE (reported: "its room has not loaded yet") ═══════════
  // Reproduced at ddjp_438: a conversation the list remembers whose room the client does not have — left, and
  // not reloaded by the SDK — was refused as "not loaded yet, try again", which never becomes true. After the
  // first sync an unknown room is GONE, and a conversation with a known person still opens: the first message
  // starts a room (the owner's rule: create only when no usable room exists). Before the first sync it waits,
  // because making a room then could duplicate one that is about to appear.
  {
    const rooms = [];
    const w = world(rooms, {});
    w.C.dmInit();
    w.P.dmTouch("!left:hs", "@gina:hs", 50);        // remembered; the client does not have the room
    world.syncState = "SYNCING";
    const g = w.C.openDMRoom("!left:hs");
    ok(g.ok === true && w.C.currentDMPerson() === "@gina:hs" && w.C.currentDM() === null,
      "G: AFTER THE FIRST SYNC, A CONVERSATION WHOSE ROOM IS GONE STILL OPENS — with the person, and no room yet", g);
    ok(w.created.length === 0, "G: and opening it makes nothing — only a message does", w.created);
    const sres = await w.C.sendDM("hello again");
    ok(sres.ok === true && w.created.length === 1 && w.created[0].invite[0] === "@gina:hs",
      "G: THE FIRST MESSAGE STARTS ONE ROOM WITH HER, and it is sent there", { sres, created: w.created });
    // Before the first sync: it waits, and makes nothing.
    const w2 = world([], {});
    w2.C.dmInit();
    w2.P.dmTouch("!loading:hs", "@hal:hs", 50);
    world.syncState = "CATCHUP";
    const h = w2.C.openDMRoom("!loading:hs");
    ok(h.ok === false && h.reason === "not-loaded" && w2.created.length === 0,
      "G: BEFORE THE FIRST SYNC IT WAITS — \"not loaded yet\" is true then, and a room made now could duplicate one", h);
    // Gone, with nobody known: nothing to open, and it says gone rather than "try again".
    world.syncState = "SYNCING";
    const w3 = world([], {});
    w3.C.dmInit();
    w3.P.dmTouch("!gone:hs", "", 50);
    const x = w3.C.openDMRoom("!gone:hs");
    ok(x.ok === false && x.reason === "gone", "G: A ROOM THAT IS GONE, WITH NOBODY KNOWN, IS SAID TO BE GONE — not \"try again\"", x);
    delete world.syncState;
    // The device's list follows the ACCOUNT: switching without a reload must not show the last account's list.
    const w4 = world([], {});
    w4.sb.StorageIO.setNamespace("@alice:hs"); w4.P.load();
    w4.P.dmTouch("!alices:hs", "@carol:hs", 100);
    w4.sb.StorageIO.setNamespace("@bob:hs");
    ok(w4.P.dmList().length === 0,
      "G: A DIFFERENT ACCOUNT NEVER SEES THE LAST ONE'S CONVERSATIONS — the list was loaded once and kept for whoever " +
      "came next (reproduced: bob saw alice's)", w4.P.dmList());
    w4.sb.StorageIO.setNamespace("@alice:hs");
    ok(w4.P.dmList().map((r) => r.roomId).join() === "!alices:hs", "G: and switching back finds alice's list again", w4.P.dmList());
  }

  // ═══ PART H — the invite's "direct" mark survives the join (reported: Element shows a person on one side, a room on the other) ══
  // Each person's Element decides from THEIR OWN `m.direct`. A DM invite carries `is_direct`; joining replaces
  // the member event, and the flag survives only in the join's PREVIOUS content — which the SDK keeps and
  // Element reads (`getDMInviter`). This app read only the current content, so a DM accepted anywhere but
  // Element was never recognised or recorded, and that person's Element showed a room.
  {
    const joinedFromInvite = (id, inviter, prevDirect) => ({ roomId: id, getMyMembership: () => "join",
      getMembers: () => [{ userId: ME, membership: "join" }, { userId: inviter, membership: "join" }],
      getJoinedMemberCount: () => 2, getInvitedMemberCount: () => 0,
      getMember: (u) => ({ userId: u, membership: "join" }), getLastActiveTimestamp: () => 100,
      currentState: { getStateEvents: (t, k) => (t === "m.room.member" && k === ME)
        ? { getContent: () => ({ membership: "join" }), getPrevContent: () => ({ membership: "invite", is_direct: prevDirect }), getSender: () => ME } : null } });
    const rooms = [joinedFromInvite("!inv:hs", "@ivy:hs", true), joinedFromInvite("!plain:hs", "@jon:hs", false)];
    const w = world(rooms, {});
    ok(w.MA.dmRoomIds().indexOf("!inv:hs") >= 0 && w.MA.findDMRoom("@ivy:hs") === "!inv:hs",
      "H: A DM INVITE STAYS A DM AFTER JOINING — its `is_direct` is read from the join's previous content, as Element does", w.MA.dmRoomIds());
    ok(w.MA.dmRoomIds().indexOf("!plain:hs") < 0,
      "H control: a two-person room whose invite was NOT marked direct stays a room — the mark is the evidence", w.MA.dmRoomIds());
    const added = await w.MA.repairDirect();
    ok(added === 1 && JSON.stringify(w.account.direct["@ivy:hs"]) === JSON.stringify(["!inv:hs"]) && !w.account.direct["@jon:hs"],
      "H: AND IT IS RECORDED IN THIS ACCOUNT'S `m.direct`, so this person's Element shows the person, not a room", w.account.direct);
  }

  reachedVerdict = true;
  console.log("[dm-person] PASS — a conversation is a person: every one-to-one room with them is found, including one " +
    "Element made that `m.direct` never listed (which is then appended to it, nothing else changed); a reply goes to the " +
    "most recently active room you are both in, never one they left, and follows them if they move; messaging them again " +
    "reuses the conversation and two quick clicks make one room; the list shows one row per person and their history is " +
    "one timeline; and reading is marked in server time (" + asserts + " assertions)");
})().catch((e) => fail("threw — " + ((e && e.stack) || e)));
