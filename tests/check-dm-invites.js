#!/usr/bin/env node
// tests/check-dm-invites.js
// SUBJECT: features/chat.js, backends/backend1/matrixaccount.js, backends/backend1/matrixbridge.js
//
// WALL: THE DM PANEL ANSWERS ONE INVITE AT A TIME, ASKS BEFORE A GROUP, AND NEVER JOINS A DDJP ROOM (J81; the owner's D5, D6, D9
// and rulings 15, 16 and 17).
//   Before J81 Accept was answered per PERSON and joined every invite that person had sent (`ddjp_433`), so one click could join
//   a group room or a channel by accident; the inviter was read AFTER the join, where the join's own member event could answer,
//   filing the conversation under this account's own id; and whatever was accepted was recorded in `m.direct`. Driven on the REAL
//   `features/chat.js`, `matrixaccount.js` and `matrixbridge.js` against the homeserver model (`tests/_inviteworld.js`):
//     D1  ONE CLICK, ONE ROOM: accepting one of a person's invitations joins that room and none of their others; two quick clicks
//         on one invitation join it once.
//     D2  ONE-TO-ONE IS A CONVERSATION: just the two of you (the server's summary says so) needs one click and is recorded in
//         `m.direct` under the INVITER, read before joining — not under this account, which the join's own member event names.
//     D3  A GROUP ASKS FIRST, AND IS NOT A CONVERSATION: the warning needs the second click — enforced in Chat, not only by the
//         button — and the room, once joined, is NOT recorded, and the log says so (D6).
//     D4  CAN'T SEE WHO IS IN IT: no summary answered, so the second click is asked too (D5, fail closed); joined and found to be
//         one-to-one, it is recorded.
//     D5  A DDJP INVITE NEVER JOINS THROUGH HERE: not in the panel, refused by Chat and by the account layer (ruling 17).
//     D6  A REFUSAL THAT FAILS SAYS SO AND THE INVITE STAYS; one that works leaves the room and binds nothing (ruling 15).
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[dm-invites] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[dm-invites] FAIL — the guard did not finish: a promise never settled"); process.exitCode = 1; } });

const ME = W.ME;
(async () => {
  const hs = W.homeserver();
  const room = (id, from, o) => {
    o = o || {};
    hs.room(id, { name: o.name || id, creator: from, content: { room_version: "12" }, members: Object.assign({ [from]: "join" }, o.others || {}), joinRule: "invite" });
    hs.invite(id, ME, { from, direct: !!o.direct });
  };
  room("!dm:hs", "@alice:hs", { direct: true });
  room("!dm2:hs", "@alice:hs", { direct: true });
  room("!group:hs", "@bob:hs", { name: "Book club", others: { "@carol:hs": "join" } });
  room("!pair:hs", "@erin:hs", { name: "two of us" });
  room("!refuse:hs", "@frank:hs", { direct: true });
  const A = hs.ddjpRoom("!a:hs", { levels: { [ME]: 60 } });
  hs.rooms["!a:hs"].members[ME] = "join";
  hs.invite(A.ch.chat_staff, ME, { from: W.OWNER });
  const summaries = { "!dm:hs": 1, "!dm2:hs": 1, "!group:hs": 2, "!refuse:hs": 1 };
  const w = W.inviteWorld({ hs, withChat: true, client: { getRoomSummary: async (id) => {
    if (summaries[id] === undefined) throw Object.assign(new Error("unrecognised"), { errcode: "M_UNRECOGNIZED" });
    return { num_joined_members: summaries[id] }; } } });
  const C = w.Chat, MA = w.MA;
  C.dmInit();
  await w.settle(20);   // the panel asks each invite's summary when it starts
  const inv = () => { const o = Object.create(null); for (const i of (C.dmInvites() || [])) o[i.roomId] = i; return o; };
  const joined = (id) => hs.rooms[id].members[ME] === "join";

  // ── D1 — ONE CLICK, ONE ROOM ───────────────────────────────────────────────────────────────────────────────────────────
  ok(inv()["!dm:hs"] && inv()["!dm2:hs"] && inv()["!dm:hs"].needsConfirm === false, "D1 PREMISE — both of Alice's invitations are listed; " +
    "the summary says just the two of you, so no second click", inv()["!dm:hs"]);
  const [x, y] = await Promise.all([C.acceptDMInvite("!dm:hs"), C.acceptDMInvite("!dm:hs")]);
  ok(x && x.ok && y && y.ok && joined("!dm:hs") && !joined("!dm2:hs") && hs.joins.filter((j) => j === ME + " !dm:hs").length === 1,
    "D1: ONE CLICK JOINS ONE ROOM — that invitation, once for two quick clicks, and NOT Alice's other one (D9; ddjp_433 joined both)",
    { x, y, joins: hs.joins });
  ok(!!inv()["!dm2:hs"], "D1: her other invitation is still waiting, to be answered on its own", Object.keys(inv()));

  // ── D2 — ONE-TO-ONE: RECORDED UNDER THE INVITER, READ BEFORE JOINING ──────────────────────────────────────────────────────
  ok(JSON.stringify(w.account.direct["@alice:hs"]) === JSON.stringify(["!dm:hs"]) && !w.account.direct[ME],
    "D2: recorded in `m.direct` under the INVITER — read from the invite before joining; read after, the join's own member event " +
    "would have named this account", w.account.direct);
  ok(w.lines(/Chat: accepted the invite to !dm:hs from @alice:hs — a conversation \(recorded\)/).length === 1, "D2: and the line says so",
    w.lines(/Chat:/));

  // ── D3 — A GROUP ASKS FIRST, AND IS NOT A CONVERSATION ───────────────────────────────────────────────────────────────────
  const g = inv()["!group:hs"] || {};
  ok(g.warn === "group" && g.needsConfirm === true, "D3: a room the summary says holds more than the inviter carries the group warning", g);
  const g1 = await C.acceptDMInvite("!group:hs");
  ok(g1 && g1.ok === false && g1.reason === "confirm" && !joined("!group:hs"), "D3: ONE CLICK DOES NOT JOIN A GROUP — Chat refuses without the " +
    "second click, whatever the button does", g1);
  const g2 = await C.acceptDMInvite("!group:hs", { confirmed: true });
  ok(g2 && g2.ok && g2.group === true && joined("!group:hs") && !w.account.direct["@bob:hs"],
    "D3: confirmed, it is joined — and NOT recorded as a conversation: a group room is not one (D6)", { g2, direct: w.account.direct });
  ok(w.lines(/Chat: accepted the invite to !group:hs from @bob:hs — a group room of 3 people: joined, not a conversation here/).length === 1,
    "D3: and the line says it was joined and why it is not listed", w.lines(/Chat:/));

  // ── D4 — CAN'T SEE WHO IS IN IT ─────────────────────────────────────────────────────────────────────────────────────────
  const p = inv()["!pair:hs"] || {};
  ok(p.warn === "unknown" && p.needsConfirm === true, "D4: no summary answered: the size is unknown, and the second click is asked (D5, fail closed)", p);
  const p1 = await C.acceptDMInvite("!pair:hs");
  ok(p1 && p1.reason === "confirm" && !joined("!pair:hs"), "D4: not joined on one click", p1);
  const p2 = await C.acceptDMInvite("!pair:hs", { confirmed: true });
  ok(p2 && p2.ok && p2.recorded === true && JSON.stringify(w.account.direct["@erin:hs"]) === JSON.stringify(["!pair:hs"]),
    "D4: confirmed and found one-to-one once joined, it is recorded as the conversation", { p2, direct: w.account.direct });

  // ── D5 — A DDJP INVITE NEVER JOINS THROUGH HERE ────────────────────────────────────────────────────────────────────────
  ok(!inv()[A.ch.chat_staff], "D5: a DDJP channel invite is not in the DM panel (ruling 17)", Object.keys(inv()));
  const d1 = await C.acceptDMInvite(A.ch.chat_staff, { confirmed: true });
  let threw = null;
  try { await MA.acceptDMInvite(A.ch.chat_staff); } catch (e) { threw = e.message; }
  ok(d1 && d1.ok === false && /not a DM-panel invite \(channel/.test(String(threw)) && !joined(A.ch.chat_staff),
    "D5: and asked directly, Chat refuses it and so does the account layer — nothing is joined", { d1, threw });

  // ── D6 — REFUSING ─────────────────────────────────────────────────────────────────────────────────────────────────────
  hs.failNext["leave:!refuse:hs"] = [{ errcode: "M_UNKNOWN", httpStatus: 502, message: "bad gateway" }];
  const r1 = await C.declineDMInvite("!refuse:hs");
  ok(r1 && r1.ok === false && hs.rooms["!refuse:hs"].members[ME] === "invite" && !!inv()["!refuse:hs"] &&
     w.lines(/Chat: could not refuse the invite to !refuse:hs .*it stays/).length === 1,
    "D6: A REFUSAL THAT FAILS SAYS SO AND THE INVITE STAYS (ruling 15)", { r1, logs: w.lines(/refuse/) });
  const r2 = await C.declineDMInvite("!refuse:hs");
  ok(r2 && r2.ok && hs.rooms["!refuse:hs"].members[ME] === "leave" && !inv()["!refuse:hs"] && !w.account.direct["@frank:hs"],
    "D6: refused, it leaves the room and binds nothing", r2);

  _finished = true;
  if (failed) { console.log("[dm-invites] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[dm-invites] PASS — the DM panel answers one invite at a time, asks before a group, and never joins a DDJP room (J81; " +
    asserts + " assertions): one click joins one room and none of the person's others, twice-clicked once; a one-to-one room is recorded " +
    "under the inviter read before joining; a group needs the second click — refused by Chat without it — and is joined but not " +
    "recorded, and says so; a room whose size cannot be seen asks too and is recorded once found one-to-one; a DDJP channel invite is " +
    "not listed and is refused by Chat and by the account layer; a refusal that fails says so and the invite stays.");
})().catch((e) => { console.log("[dm-invites] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
