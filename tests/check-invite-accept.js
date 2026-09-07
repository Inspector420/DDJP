// tests/check-invite-accept.js
// WALL: AN INVITE TO A CHANNEL OF THE SPACE THIS CLIENT IS IN IS ACCEPTED WITHOUT A CLICK,
//       AND IT IS ACCEPTED EVENTUALLY EVEN WHEN IT IS NOT ACCEPTED NOW.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// Three channels are invite-only ON PURPOSE, and it is the same reason each time: MEMBERSHIP IS
// THE STATEMENT. Guest and staff chat because membership is the rank gate; presence chat because
// membership is the bot's activity verdict. If any space member could walk in, none of the three
// would mean anything — so they cannot be made `restricted` like the open channels are.
//
// But the CLICK adds nothing. You were invited by `assignRank` or by the bot, and neither invites
// somebody who has not earned it. Reported from a live room: the bot kicked an inactive person,
// they came back, the bot re-invited them, and they sat outside the presence chat because nobody
// pressed accept — with nothing anywhere saying why.
//
// ── THE PART THAT IS EASY TO GET WRONG ──────────────────────────────────────────────────────
// AN INVITE IS A STANDING CONDITION, NOT AN EVENT. Written as a handler for the arrival it breaks
// three ways for one reason: an invite that landed while the tab was closed is never re-announced,
// a cooldown that expires has nothing to re-trigger it, and a join that failed is consumed. PART C
// drives all three, because they are one bug wearing three hats.

const { loadInContext } = require("./_load");

let asserts = 0;
let failed = false;
function fail(msg, got) {
  failed = true;
  console.log("[invite-accept] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

// ── THE MAP `join()` ACTUALLY PRODUCES, WHICH IS NOT THE MAP THIS GUARD USED TO HAND OVER ────
// The first edition of this file listed all six channels here, including the three invite-only
// ones. That is the reader's expectation rather than the writer's output, and it is why the guard
// was green over a feature that could not see a staff invite: `Room.join()` builds the map by
// walking `m.space.child` and calling `getRoom(roomId)` with `if (!room) continue`, and `getRoom`
// answers null for a room you are neither in nor invited to. So a player's map holds the open
// channels and NONE of `chat_guest` / `chat_staff` / `presence_chat`.
//
// Handing the subject a map containing them tested the reconcile against itself. The fixture is
// now the two halves it really has: what this client resolved, and what the space ADVERTISES.
const CHANNELS = {
  events_uncategorized: "!e0", events_owner: "!e99",
  chat_uncategorized: "!c0",
};

// Every child of the space, resolved or not — what `MatrixBridge.spaceChildIds` reads out of
// `m.space.child`. The three invite-only rooms are here and deliberately absent from CHANNELS.
const SPACE_CHILDREN = ["!e0", "!e99", "!c0", "!c10", "!c60", "!pres"];

// Room ids -> the channel NAME the homeserver holds, so `_channelKeyFor` can name a channel that
// is not in the map yet. This is the only route to a key for the case this guard exists for.
const NAMES = {
  "!e0": "events-uncategorized", "!e99": "events-owner", "!c0": "chat-uncategorized",
  "!c10": "chat-guest", "!c60": "chat-staff", "!pres": "presence-chat",
};

// The REAL `Room`, with the transport stubbed at the two seams the reconcile uses. `NOW` is
// controllable because the cooldown is the whole subject of PART C.
function tree(opts) {
  const o = opts || {};
  const calls = { joined: [], lines: [], saved: [] };
  const membership = o.membership || {};
  let NOW = o.now || 1000000;
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js",
  ], {
    Date: Object.assign(function () { return new global.Date(NOW); },
      { now: () => NOW, UTC: global.Date.UTC, parse: global.Date.parse }),
    Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ChatPrefs: { chatTier: () => null, onChange() {} },
    Chat: { setReadableTiers() {}, setRoom() {}, onMessage() {}, init() {} },
    Store: { config: { saveRoom(r) { calls.saved.push(Object.keys(r.channels).sort().join(",")); } } },
    StreamManager: { getLog: () => [], getState: () => ({ settings: {}, rotation: [] }),
                     isLegal: () => true, on() {} },
    MatrixBridge: {
      getClient: () => ({ getRoom: (id) => (NAMES[id] ? { name: NAMES[id] } : null) }),
      channelTaxonomy: () => [],
      eventsKeyForLevel: () => null,
      presenceChatKey: () => "presence_chat",
      channelKeyFromName: (n) => String(n || "").replace(/-/g, "_"),
      // The advertisement, which is the whole point: these ids exist as children of the space
      // whether or not this client holds a Room for them. `o.children` lets a part drive the
      // degenerate case (unreadable space state) without a second tree.
      spaceChildIds: () => (o.children === undefined ? SPACE_CHILDREN.slice() : o.children),
      onRoomsChanged() {}, offRoomsChanged() {},
      amJoined: (id) => membership[id] === "join",
      amInvited: (id) => membership[id] === "invite",
      acceptChannelInvite: (id) => {
        calls.joined.push(id);
        if (o.joinFails) return Promise.resolve({ ok: false, reason: "join-failed", detail: "M_FORBIDDEN" });
        membership[id] = "join";
        return Promise.resolve({ ok: true, reason: null });
      },
    },
  });
  sb.Logger.on((e) => calls.lines.push("[" + e.level + "] " + e.message));
  sb.Room._setCurrentForTest({ spaceId: "!s:hs", channels: Object.assign({}, CHANNELS) });
  return { sb, calls, membership, at: (t) => { NOW = t; }, now: () => NOW };
}

// ═══ PART A — THE INVITE-ONLY CHANNELS ARE JOINED, THE REST ARE LEFT ALONE ═══════════════════
{
  const t = tree({ membership: { "!pres": "invite", "!c60": "invite", "!e0": "join" } });
  const r = t.sb.Room.acceptChannelInvites();
  ok(r.ok === true, "A: the reconcile runs", r);
  ok(t.calls.joined.indexOf("!pres") >= 0,
    "A: a pending invite to the PRESENCE chat is accepted without a click. The bot invited them "
    + "because it derives them as active — the confirmation adds nothing and its absence leaves "
    + "somebody outside a channel they are entitled to", t.calls.joined);
  ok(t.calls.joined.indexOf("!c60") >= 0,
    "A: AND THE STAFF CHAT, WHICH IS NOT IN `current.channels` AND NEVER WAS. This is the row the "
    + "first edition of this guard could not fail: it handed the subject a map containing "
    + "chat_staff, while `join()` builds that map from `getRoom()` and drops every room this "
    + "client is neither in nor invited to — so the real map has no such key and the reconcile "
    + "looped straight past a live invite. Reported from a room: a promotion landed and staff chat "
    + "never appeared. The scope is the space's ADVERTISED children now, so a channel can be seen "
    + "before it is resolved", { joined: t.calls.joined, mapKeys: Object.keys(CHANNELS) });
  ok(Object.keys(CHANNELS).indexOf("chat_staff") < 0 && SPACE_CHILDREN.indexOf("!c60") >= 0,
    "A PREMISE: and the row above rests on the fixture being the map join() produces rather than "
    + "the one the reconcile wants — chat_staff is a child of the space and NOT a resolved "
    + "channel. Restore it to CHANNELS and this file passes over a broken tree again",
    { mapKeys: Object.keys(CHANNELS), children: SPACE_CHILDREN });
  ok(t.calls.joined.indexOf("!e0") < 0,
    "A: a channel already JOINED is not re-joined — the reconcile acts on the difference, not on "
    + "the list", t.calls.joined);
  ok(t.calls.joined.indexOf("!c0") < 0,
    "A CONTROL: and a channel with no invite at all is untouched, so the rows above are the "
    + "membership read doing work rather than a loop over every channel", t.calls.joined);
}

// ═══ PART B — SCOPED BY THE SPACE'S OWN CHANNEL LIST, NEVER BY A NAME ════════════════════════
// The whole safety of this rests here. `current.channels` is what THIS client resolved for the
// space it is in, so an invite from anywhere else is never even considered.
{
  const t = tree({ membership: { "!stranger": "invite", "!pres": "invite" } });
  t.sb.Room.acceptChannelInvites();
  ok(t.calls.joined.indexOf("!stranger") < 0,
    "B: an invite to a room that is NOT a channel of this space is ignored. Without this the rule "
    + "is an auto-accept with a comment claiming it is scoped", t.calls.joined);
  ok(t.calls.joined.indexOf("!pres") >= 0,
    "B CONTROL: while the same pass accepts the one that IS a channel — so the row above is the "
    + "scope doing work, not a pass that accepted nothing", t.calls.joined);
}

// A REAL TICK, not two microtasks. The failure path clears its mark inside a `.then` created in the
// sandbox realm, and cross-realm adoption does not settle within `await Promise.resolve()`.
function drain() { return new Promise((r) => setImmediate(r)); }

// ═══ PART C — ACCEPTED EVENTUALLY: THE THREE WAYS AN EVENT-SHAPED VERSION WOULD FAIL ═════════
(async () => {
  // C1 — THE COOLDOWN HOLDS, IT DOES NOT DROP.
  const t = tree({ membership: { "!pres": "invite" }, joinFails: true, now: 1000000 });
  const first = t.sb.Room.acceptChannelInvites();
  ok(first.accepted.indexOf("presence_chat") >= 0, "C: APPLIED — the first pass attempts it", first);

  // The join failed, so the mark is cleared and the very next pass retries — a failure is never
  // consumed by a cooldown it did not earn.
  await drain();                                // let the failed join clear its own mark
  const retryNow = t.sb.Room.acceptChannelInvites();
  ok(retryNow.accepted.indexOf("presence_chat") >= 0,
    "C: A FAILED JOIN IS RETRIED IMMEDIATELY, not held. The cooldown paces repeated ATTEMPTS; an "
    + "attempt that never landed has nothing to pace", { first, retryNow });

  // Now a SUCCESSFUL attempt, and the cooldown applies to it.
  const t2 = tree({ membership: { "!pres": "invite" }, now: 1000000 });
  t2.sb.Room.acceptChannelInvites();
  await drain();
  t2.membership["!pres"] = "invite";           // still invited: the join is slow to land
  const held = t2.sb.Room.acceptChannelInvites();
  ok(held.held.indexOf("presence_chat") >= 0 && held.accepted.length === 0,
    "C: a second attempt inside 10s is HELD", held);
  ok(t2.calls.lines.some((l) => /invite to presence_chat held/.test(l)),
    "C: AND THE HOLD SAYS SO. A silent skip is the shape that hid a refused kick for three "
    + "sessions — correct restraint, invisible, and then nobody knows why somebody is not in a "
    + "channel", t2.calls.lines);

  // C2 — AND THE COOLDOWN EXPIRING NEEDS NOTHING TO ARRIVE.
  t2.at(1000000 + 11000);
  const after = t2.sb.Room.acceptChannelInvites();
  ok(after.accepted.indexOf("presence_chat") >= 0,
    "C: once the cooldown passes the invite IS taken, with no new event to trigger it. An "
    + "arrival-shaped handler would wait forever here, because the invite already arrived",
    after);

// ═══ PART D — IT RUNS AT WIRING, NOT ONLY ON THE MEMBERSHIP HOOK ═════════════════════════════
// The restart case. An invite that landed while the tab was closed is never re-announced, so a
// client that only listened would come back and stay out of the channel indefinitely.
{
  const src = require("fs").readFileSync(
    require("path").join(__dirname, "..", "features", "room.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  ok(/applyChatTiers\(\);[\s\S]{0,400}acceptChannelInvites\(\)/.test(code),
    "D: the reconcile runs at WIRING, beside the chat tiers. TEXTUAL, and kept: the wiring block "
    + "has no name to extract and nothing in this suite loads `index.html`. What it proves is that "
    + "the call is spelled there, not that a browser reaches it");
  // WRITTEN AGAINST AN INLINE ARROW AND RED THE MOMENT THE LISTENER WAS NAMED — which was a
  // correction, not a regression: `offRoomsChanged` matches by identity, so an anonymous listener
  // can never be removed. A regex over a call site cannot tell a rename from a deletion, so this
  // asks the weaker, stabler question (the reconcile is subscribed to the membership hook at all)
  // and leaves the behaviour to the driven parts above.
  ok(/onRoomsChanged\(_onRoomsChangedInvites\)/.test(code)
     && /_onRoomsChangedInvites\(\)\s*\{[\s\S]{0,120}acceptChannelInvites\(\)/.test(code),
    "D: and again on every membership change, so an invite arriving live is taken without waiting "
    + "for the next room entry. TEXTUAL, same limitation");
}

// ═══ PART F — JOINING IS HALF THE JOB; THE OTHER HALF IS BEING IN THE MAP ═══════════════════
// `chatTiers()` builds from `Object.keys(current.channels)`, so a staff chat this client has just
// joined is offered by nothing until its key is mapped. A join nobody can then read is the same
// silence as not joining, one step further along.
  {
    const tF = tree({ membership: { "!c60": "invite", "!pres": "invite" } });
    ok(tF.sb.Room.getChannels().chat_staff === undefined,
      "F PREMISE: the channel is unmapped before the accept, which is the state a promoted player "
      + "is actually in", tF.sb.Room.getChannels());
    tF.sb.Room.acceptChannelInvites();
    await drain();
    ok(tF.sb.Room.getChannels().chat_staff === "!c60",
      "F: once the invite is accepted the channel is MAPPED, resolved from the room's own name "
      + "because it is not in the map to look up. Without this the join lands and the tier strip "
      + "still offers nothing", tF.sb.Room.getChannels());
    ok(tF.sb.Room.getChannels().presence_chat === "!pres",
      "F: and the presence chat the same way — one rule for the three, or the next person fixes "
      + "one and leaves the others", tF.sb.Room.getChannels());
    ok(tF.calls.saved.length > 0 && tF.calls.saved[tF.calls.saved.length - 1].indexOf("chat_staff") >= 0,
      "F: and the map is PERSISTED, so the next entry starts from it rather than re-earning it",
      tF.calls.saved);
    ok(tF.calls.lines.some((l) => /chat_staff is mapped and readable/.test(l)),
      "F: AND IT SAYS SO. Everything about this feature is invisible when it does not happen, "
      + "which is how it went unnoticed for the whole life of the guest and staff channels",
      tF.calls.lines);
  }

// ═══ PART G — THE ADVERTISEMENT IS UNREADABLE ═══════════════════════════════════════════════
// Fail toward the old behaviour rather than toward nothing: if the space's state cannot be read,
// the resolved map is still a real list of this space's channels and an invite in it is still
// this space's invite.
  {
    const tG = tree({ membership: { "!c0": "invite" }, children: [] });
    tG.sb.Room.acceptChannelInvites();
    ok(tG.calls.joined.indexOf("!c0") >= 0,
      "G: with no readable children the resolved map is still used, so nothing that is accepted "
      + "today stops being accepted. The union is a floor under the correction, not a second scope",
      tG.calls.joined);
  }

// ═══ PART E — TOTAL ═════════════════════════════════════════════════════════════════════════
  const tE = tree({ membership: {} });
  tE.sb.Room._setCurrentForTest(null);
  const rE = tE.sb.Room.acceptChannelInvites();
  ok(rE.ok === false && rE.reason === "no-room",
    "E: with no room resolved it refuses by name rather than throwing inside a wiring path", rE);

  // ── THE GATE IS WHERE EVERY PATH ARRIVES ─────────────────────────────────────────────────
  // At the end of the SOURCE it would run before these awaited parts resolved: the guard would
  // print FAIL, then PASS, then exit 0. That has happened in this suite.
  // ── WHAT THIS GUARD DOES NOT COVER, SAID PLAINLY ──────────────────────────────────────────
  // The transport is STUBBED here: `amInvited` and `acceptChannelInvite` are the sandbox's, not
  // the real ones, so mutating either in `matrixbridge.js` leaves this file green. Verified by
  // doing it. That is the right shape for a guard about `room.js`'s reconcile — but it means the
  // membership READ itself rests on being five lines that either compile or do not, and on
  // nothing here rendering a browser. Somebody widening this should start there.
  if (failed) process.exit(1);
  console.log("[invite-accept] PASS — an invite to a channel of the space this client is in is "
  + "accepted without a click, and the three invite-only channels are treated alike because they "
  + "are one shape: membership IS the statement, so they cannot be made `restricted`, and the "
  + "confirmation adds nothing to a decision `assignRank` or the bot already made. SCOPED by the "
  + "space's own channel list rather than by a name, so an invite from anywhere else is never "
  + "considered. And accepted EVENTUALLY: the reconcile reads what is true NOW rather than "
  + "handling an arrival, which is what carries it across a refresh, across a cooldown expiring "
  + "with nothing new to trigger it, and across a join that failed — three breakages an "
  + "event-shaped version would have had for one reason. A held attempt says it was held, because "
  + "a silent skip is the shape that hid a refused kick for three sessions (" + asserts
  + " assertions). TWO ROWS ARE TEXTUAL AND SAY SO: the wiring sites have no name to extract and "
  + "nothing here renders `index.html`.");
})().catch((e) => { console.log("[invite-accept] FAIL — threw: " + (e && e.stack)); process.exit(1); });
