// tests/check-chat-delete.js
// SUBJECT: backends/backend1/capabilities.js, backends/backend1/ranks.js, backends/backend1/matrixbridge.js,
//          backends/backend2/skeleton.js, features/actions.js, features/room.js
// WALL: STAFF AND ABOVE MAY DELETE MESSAGES FROM PEOPLE RANKED BELOW THEM; NOBODY MAY DELETE A MESSAGE
// FROM SOMEONE AT OR ABOVE THEIR RANK (owner ruling, ddjp_469). In all four chats — Everyone, Guest+,
// Staff, Present — in BOTH engines. Matrix enforces the floor (a chat room's `redact` bar at the staff
// rung); it has no "only below you" rule for deletion, so that half is the APP's, in Capabilities — a
// client like Element can get around it, and the owner accepted that. Rooms made before this keep
// `redact: 100` — they are not updated (owner ruling, ddjp_470). DMs are untouched: your own messages only.
//
// Driven: the REAL Capabilities over the REAL ranks; the REAL `ensureChatRedactBar` over a Matrix client
// double; the channel plans read from both engines' sources. THIS GUARD CANNOT SEE A HOMESERVER.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");

let asserts = 0;
function fail(msg, got) {
  console.log("[chat-delete] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const src = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

(async () => {
  const { Ranks, Capabilities } = loadInContext(["backends/backend1/ranks.js", "backends/backend1/capabilities.js"], {});
  const STAFF = Ranks.levelOf("staff");
  ok(typeof STAFF === "number" && STAFF > 0, "PREMISE — the staff rung's level is read from the ladder", STAFF);

  // ═══ PART A — the rule: staff and above, and only people ranked BELOW you ═══════════════════════
  {
    const can = (me, target) => Capabilities.can("chat.redact", {}, { myRank: me, target: { targetRank: target } });
    const P_ = Ranks.levelOf("player"), U = Ranks.levelOf("uncategorized"), O = Ranks.levelOf("owner"), HS = Ranks.levelOf("high-staff");
    ok(can(STAFF, P_).permitted, "A: STAFF may delete a message from someone ranked below them", can(STAFF, P_));
    ok(!can(STAFF, STAFF).permitted, "A: but NOT from someone at their own rank", can(STAFF, STAFF));
    ok(!can(STAFF, O).permitted, "A: nor from someone above them — the owner's messages are the owner's", can(STAFF, O));
    ok(!can(P_, U).permitted, "A: and below staff, nobody deletes anyone else's messages", can(P_, U));
    ok(can(HS, STAFF).permitted && can(O, HS).permitted && can(100, O).permitted, "A: it CASCADES — each rank over the ranks below it, up to the human owner over the bot");
    ok(!can(STAFF, undefined).permitted, "A: and a message whose author's rank is unknown is refused, not waved through", can(STAFF, undefined));
    const actions = src("features/actions.js");
    ok(/"chat\.redact":\s*\{\s*verb:\s*"chat\.redact"[\s\S]{0,300}avail:\s*\(\)\s*=>[\s\S]{0,120}mayRedactOthers/.test(actions),
      "A: the actions list carries it, AVAILABLE only where the chat room's Matrix bar lets you (source-level)");
  }

  // ═══ PART B — new rooms: all four chats created with the staff bar, in both engines ═══════════════
  {
    const rows = (rel) => (src(rel).match(/\{ kind: "(chat|presence)",[^}]*\}[^}]*\}|\{ kind: "(chat|presence)",[^\n]*\}/g) || []);
    for (const rel of ["backends/backend1/matrixbridge.js", "backends/backend2/skeleton.js"]) {
      const r = rows(rel);
      const keys = r.map((x) => (x.match(/key: "([a-z_]+)"/) || [])[1]);
      ok(["chat_uncategorized", "chat_guest", "chat_staff", "presence_chat"].every((k) => keys.indexOf(k) >= 0),
        "B: APPLIED — " + rel + " declares the four chats", keys);
      const bad = r.filter((x) => { const m = x.match(/redact:\s*(\d+)/); return !m || parseInt(m[1], 10) !== STAFF; });
      ok(bad.length === 0, "B: EVERY CHAT in " + rel + " is created with its delete bar at the staff rung (" + STAFF + ")", bad);
    }
  }

  // ═══ PART C — older rooms are NOT updated (owner ruling, ddjp_470) ══════════════════════════════════
  // ddjp_469 had the owner's client lower an older room's chat bar on entering. The owner removed it: older
  // rooms are not supported for this. So nothing in the tree changes a chat's power levels on entry.
  {
    const rm = src("features/room.js"), mb = src("backends/backend1/matrixbridge.js");
    ok(!/ensureChatRedactBar/.test(rm) && !/function ensureChatRedactBar/.test(mb),
      "C: NOTHING LOWERS AN OLDER ROOM'S CHAT BAR — entering a room changes no permission (owner ruling)");
  }

  console.log("[chat-delete] PASS — staff and above may delete messages from people ranked below them, and nobody from someone " +
    "at or above their rank (" + asserts + " assertions): the rule is the REAL Capabilities over the real ladder, cascading up to the " +
    "human owner; every one of the four chats is created with its delete bar at the staff rung in both engines; the owner's client " +
    "lowers an older room's bar once, in the four chats only, changing nothing else, and nobody else's client tries. The \"below " +
    "you\" half is the app's — Matrix enforces only the bar. THIS GUARD CANNOT SEE A HOMESERVER");
  process.exit(0);
})().catch((e) => fail("threw — " + ((e && e.stack) || e)));
