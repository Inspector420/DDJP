// tests/check-chat-at-rest.js
// SUBJECT: backends/backend1/matrixbridge.js, backends/backend1/eventcache.js
// WALL: THE PRESENCE CHAT IS A CHAT, AND CHAT IS NEVER KEPT AT REST (J115, item 1; the owner's ruling at `ddjp_619`).
//
// The owner's test for anything this app keeps on disk: it must be part of the room's ordering or event tracking AND
// clean itself. Chat text is neither. The router skipped `chat-*` rooms before the store and the fold, but the presence
// chat's name has no `chat-` prefix, so its decrypted text was written to IndexedDB with the Spine originals, reloaded on
// every open, and handed to the fold, where a body shaped like a DDJP event was folded by the presence chat's members
// alone: a fork between who is in that chat and who is not.
//   PART A — the router: a presence-chat message, plain or DDJP-shaped, is neither stored nor folded, and still reaches
//            the raw listeners; a `chat-*` room and a Spine room are the controls.
//   PART B — why it matters: the same DDJP-shaped body, handed to the fold, puts its sender in the rotation.
//   PART C — what earlier builds left on disk goes: `EventCache.dropRooms`, and the bridge's once-per-open sweep, which
//            drops every held raw from a room the client names as a chat and nothing else; `replayRoom` runs it once the
//            cache is loaded.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const P = require(path.join(__dirname, "_probe-j15-dm.js"));
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[chat-at-rest] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const noop = () => {};
const LOG = { info: noop, warn: noop, error: noop, debug: noop };

function bridge() {
  return loadInContext(["backends/backend1/ranks.js", "backends/backend1/eventcache.js", "backends/backend1/matrixbridge.js"],
    { Logger: LOG });
}
const S = bridge();
const MB = S.MatrixBridge;
// The presence chat's name, from the table rather than spelled here.
const pRow = MB.channelTaxonomy().filter((c) => c.kind === "presence")[0];
const PRESENCE_NAME = pRow ? MB.channelName(pRow.kind, pRow.slug) : null;
ok(!!PRESENCE_NAME, "PREMISE — the channel table has a presence row to name", MB.channelTaxonomy().map((c) => c.key));

const PRESENCE = { roomId: "!presence:hs", name: PRESENCE_NAME };
const CHAT = { roomId: "!chat:hs", name: "chat-uncategorized" };
const SPINE = { roomId: "!events:hs", name: "events-uncategorized" };
const SCOPE = [PRESENCE.roomId, CHAT.roomId, SPINE.roomId];
const DDJP_BODY = JSON.stringify({ t: "ddjp.dj.join", l: 9, v: "SONG0000000" });
const TEXT_BODY = "back in five";

function route(room, body) {
  return P.driveRoute({ room, body, scope: SCOPE, dmScope: [],
    isSpineChannel: MB._isSpineChannel, isChatChannel: MB._isChatChannel });
}

// ═══ PART A — the router ═══════════════════════════════════════════════════════════════════════
{
  const spine = route(SPINE, DDJP_BODY);
  ok(spine.ok && spine.spined, "A control: a protocol event on an in-scope Spine channel reaches the Spine door — so a " +
    "refusal below is a reading of the router, not of a harness that routes nothing", spine.stage || spine.names);
  const chat = route(CHAT, TEXT_BODY);
  ok(chat.ok && !chat.stored && !chat.folded && chat.fannedOut,
    "A control: a `chat-*` message is neither stored nor folded, and reaches the raw listeners", chat.stage || chat.names);
  for (const [label, body] of [["plain text", TEXT_BODY], ["a DDJP-shaped body", DDJP_BODY]]) {
    const r = route(PRESENCE, body);
    ok(r.ok, "A: the router ran for a presence-chat message (" + label + ")", r.stage);
    ok(r.ok && !r.stored, "A: a presence-chat message (" + label + ") is NOT written to the event cache — it was, until " +
      "J115, which kept its decrypted text on disk", r.names);
    ok(r.ok && !r.folded, "A: a presence-chat message (" + label + ") is NOT handed to the fold", r.names);
    ok(r.ok && r.fannedOut, "A: a presence-chat message (" + label + ") still reaches the raw listeners — the chat " +
      "renders from them", r.names);
  }
  ok(MB._isChatChannel(PRESENCE) === true && MB._isChatChannel(CHAT) === true && MB._isChatChannel(SPINE) === false,
    "A: the predicate itself — the presence chat and a `chat-*` room are chats, a Spine room is not",
    { presence: MB._isChatChannel(PRESENCE), chat: MB._isChatChannel(CHAT), spine: MB._isChatChannel(SPINE) });
}

// ═══ PART B — why it matters: a DDJP-shaped body that reaches the fold, folds ══════════════════
// The presence chat is invite-only and encrypted, so only its members ever saw such a message. Folded, it put its
// sender in the rotation on their screens and nowhere else.
{
  const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
  const R = loadInContext(B1F, {});
  R.Floor.reset(); R.StreamManager.reset();
  const O = F.RANK.owner;
  R.StreamManager.ingest(F.toRaw(F.reducerEvent("$s1", 1, 100000, "@owner:hs", O,
    { t: "ddjp.room.settings", s: R.StateDeriver.defaultSettings() })));
  const raw = { event_id: "$p1", type: "m.room.message", sender: "@member:hs", room_id: PRESENCE.roomId, ts: 200000,
    content: { msgtype: "m.text", body: JSON.stringify({ t: "ddjp.dj.join", l: 2, v: "SONG0000000" }) },
    l: 2, senderRank: 0 };
  R.StreamManager.ingest(raw);
  const rot = (R.StreamManager.getState().rotation || []).map((x) => x.user);
  ok(rot.indexOf("@member:hs") >= 0, "B PREMISE — a DDJP-shaped presence-chat message handed to the fold joins its " +
    "sender to the rotation, which is what PART A keeps from happening", rot);
}

// ═══ PART C — what earlier builds left on disk goes ════════════════════════════════════════════
{
  const T = bridge();
  const EC = T.EventCache, M = T.MatrixBridge;
  ok(typeof EC.dropRooms === "function", "C: `EventCache.dropRooms` exists — the one way a room's raws all go");
  const put = (id, room, body) => EC.store({ event_id: id, type: "m.room.message", room_id: room, sender: "@x:hs", ts: 1,
    content: { body: body } });
  put("$c1", PRESENCE.roomId, TEXT_BODY);
  put("$c2", PRESENCE.roomId, DDJP_BODY);
  put("$c3", CHAT.roomId, TEXT_BODY);
  put("$s1", SPINE.roomId, DDJP_BODY);
  put("$u1", "!gone:hs", TEXT_BODY);               // a room this account has left: unknown to the client
  const rooms = { [PRESENCE.roomId]: PRESENCE, [CHAT.roomId]: CHAT, [SPINE.roomId]: SPINE };
  M._setClientForTest({ getRoom: (id) => rooms[id] || null });
  let out = null;
  try { out = M._sweepHeldChatForTest ? M._sweepHeldChatForTest() : null; } catch (e) { out = { threw: e.message }; }
  ok(out && out.dropped === 3, "C: the sweep drops the three raws held from the two chat rooms (the presence chat " +
    "included, DDJP-shaped or not)", out);
  ok(!EC.has("$c1") && !EC.has("$c2") && !EC.has("$c3"), "C: none of the chat raws is held any more",
    { c1: EC.has("$c1"), c2: EC.has("$c2"), c3: EC.has("$c3") });
  ok(EC.has("$s1"), "C: the Spine original is kept — the cache's real job is untouched");
  ok(EC.has("$u1"), "C: a room the client cannot name is not judged (the caps still bound it)");
  // Wired: replayRoom runs the sweep once the cache is loaded, before replay reads it.
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const at = src.indexOf("async function replayRoom(");
  const body = at >= 0 ? src.slice(at, src.indexOf("\n  }\n", at)) : "";
  const iLoad = body.indexOf("await EventCache.ensureLoaded();"), iSweep = body.indexOf("_sweepHeldChat();");
  ok(iLoad >= 0 && iSweep > iLoad, "C: `replayRoom` runs `_sweepHeldChat()` right after loading the cache — a sweep " +
    "nothing calls cleans nothing", { load: iLoad, sweep: iSweep });
}

if (failed) { console.log("[chat-at-rest] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[chat-at-rest] PASS — the presence chat is a chat (J115): its messages, plain or shaped like a DDJP " +
  "event, are neither written to the event cache nor folded, and still reach the chat's listeners, against a `chat-*` " +
  "room and a Spine room as controls; a DDJP-shaped one would have joined its sender to the rotation on its members' " +
  "screens alone. Chat text earlier builds kept on disk goes once per open, after the cache loads: every raw from a " +
  "room the client names as a chat, the Spine kept and an unknown room left to the caps (" + asserts + " assertions)");
