#!/usr/bin/env node
// tests/check-invite-kinds.js
// SUBJECT: backends/backend1/matrixaccount.js, features/room.js, features/chat.js
//
// WALL: EVERY PENDING INVITE HAS ONE VERDICT, FROM ONE CLASSIFIER, AND SHOWS IN EXACTLY ONE PLACE (J81; the owner's rulings 8,
// 14, 16 and 17).
//   Live (`?v=524`): the owner raised the bot to 99 and the staff chat's invite showed in the bot's app as a DM request — an
//   invite with one joined member passed the old two-member DM test, and the lobby listed every Matrix space. Now ONE classifier,
//   `MatrixAccount.invites()`, which the lobby (`Room.scanDDJPRooms`), the DM panel (`Chat.dmInvites`) and the join step all read:
//     ROOM       a space declaring `ddjp_mode`                    -> the lobby's room invitations;
//     CHANNEL    marked, or listed by a DDJP room this account is in; VERIFIED only when the mark is complete, the room is joined,
//                the room lists it and its creator made it         -> taken by the join step / waiting under its room;
//                not verified                                     -> waiting under its room's invitation (same creator), or
//                                                                    "Invitations not confirmed" with its reason;
//     OTHER      everything else, another app's space included    -> the DM panel, and ONLY these (ruling 17);
//     UNREADABLE no creation record in the preview                 -> "not confirmed": never accepted, never a DM (design §7).
//   No member count decides a verdict (8e); for OTHER it sets the warning: "two" only when the server's summary says so, "group"
//   when anything shows more than the inviter, "unknown" otherwise.
//
//   K1–K14 one row per kind; P the partition: every invite in exactly one place, never two, never none.
"use strict";
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[invite-kinds] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[invite-kinds] FAIL — the guard did not finish: a promise never settled"); process.exitCode = 1; } });

const ME = W.ME, OWNER = W.OWNER, STRANGER = "@stranger:hs";

(async () => {
  const hs = W.homeserver();
  // Joined DDJP room A (not running on this tab); invited DDJP room P; another app's space; and rooms built for each kind.
  const A = hs.ddjpRoom("!a:hs", { levels: { [ME]: 60 } });
  hs.rooms["!a:hs"].members[ME] = "join";
  const P = hs.ddjpRoom("!p:hs", { levels: { [ME]: 0 } });
  hs.invite("!p:hs", ME, { from: OWNER });                                                           // K1 ROOM
  hs.invite(A.ch.chat_staff, ME, { from: OWNER });                                                   // K2 verified channel of A
  hs.invite(P.ch.chat_guest, ME, { from: OWNER });                                                   // K5 waits under P's invitation
  const mk = (id, content, creator, o) => { hs.room(id, Object.assign({ name: (o && o.name) || id, creator: creator || STRANGER, content,
    members: { [creator || STRANGER]: "join" }, joinRule: "invite" }, o || {})); hs.invite(id, ME, Object.assign({ from: creator || STRANGER }, (o && o.inv) || {})); };
  mk("!fake:hs", { room_version: "12", ddjp_room: "!a:hs", ddjp_kind: "chat_staff" }, STRANGER, { name: "chat-staff" });            // K3 not listed
  hs.room("!madeby:hs", { name: "chat-guest", creator: STRANGER, content: { room_version: "12", ddjp_room: "!a:hs", ddjp_kind: "chat_guest" },
    members: { [STRANGER]: "join" }, joinRule: "invite" });
  hs.rooms["!a:hs"].children.push("!madeby:hs"); hs.invite("!madeby:hs", ME, { from: STRANGER });                                  // K4 listed, other creator
  mk("!pfake:hs", { room_version: "12", ddjp_room: "!p:hs", ddjp_kind: "chat_staff" }, STRANGER);                                   // K5b names P, other creator
  mk("!nowhere:hs", { room_version: "12", ddjp_room: "!zzz:hs", ddjp_kind: "chat_staff" }, OWNER);                                  // K6 names a room you are not in
  mk("!half:hs", { room_version: "12", ddjp_room: "!a:hs" }, OWNER);                                                                // K7 incomplete
  mk("!oddkind:hs", { room_version: "12", ddjp_room: "!a:hs", ddjp_kind: "events_vip" }, OWNER);                                    // K7b a kind A's engine lacks
  hs.room("!bare:hs", { name: "events-owner", creator: OWNER, content: { room_version: "12" }, members: { [OWNER]: "join" }, joinRule: "invite" });
  hs.rooms["!a:hs"].children.push("!bare:hs"); hs.invite("!bare:hs", ME, { from: OWNER });                                         // K8 listed, no mark
  mk("!nocreate:hs", { room_version: "12" }, STRANGER); hs.rooms["!nocreate:hs"].noCreateInPreview = true;                         // K9 unreadable
  mk("!dm:hs", { room_version: "12" }, "@alice:hs", { inv: { direct: true } });                                                     // K10 a person's DM
  mk("!group:hs", { room_version: "12" }, "@bob:hs", { name: "Book club" });                                                        // K11 a group
  hs.rooms["!group:hs"].members["@carol:hs"] = "join"; hs.rooms["!group:hs"].previewAll = true;   // a server whose preview shows the members
  mk("!space:hs", { room_version: "12", type: "m.space" }, "@dave:hs", { name: "Another app's space" });                           // K12 another app's space
  mk("!pair:hs", { room_version: "12" }, "@erin:hs", { name: "two of us" });                                                        // K13 a two-person room, not direct
  mk("!sum1:hs", { room_version: "12" }, "@fay:hs", { inv: { direct: true } });                                                     // K14 summary: just the two
  mk("!sum5:hs", { room_version: "12" }, "@gus:hs", { inv: { direct: true } });                                                     // K14 summary: five
  const summaries = { "!sum1:hs": 1, "!sum5:hs": 5 };
  const w = W.inviteWorld({ hs, withChat: true, client: { getRoomSummary: async (id) => {
    if (summaries[id] === undefined) throw Object.assign(new Error("unrecognised"), { errcode: "M_UNRECOGNIZED" });
    return { num_joined_members: summaries[id] }; } } });

  const vs = (typeof w.MA.invites === "function") ? w.MA.invites() : null;
  ok(Array.isArray(vs), "APPLIED — the one classifier exists (`MatrixAccount.invites()`)", typeof w.MA.invites);
  const by = Object.create(null);
  for (const v of (vs || [])) by[v.roomId] = v;
  const want = (id, verdict, extra, label) => {
    const v = by[id] || {};
    const pass = v.verdict === verdict && Object.keys(extra || {}).every((k) => (extra[k] instanceof RegExp ? extra[k].test(String(v[k])) : v[k] === extra[k]));
    ok(pass, label, { roomId: id, verdict: v.verdict, verified: v.verified, waitsUnder: v.waitsUnder, why: v.why, warn: v.warn, room: v.room, kind: v.kind });
  };
  want("!p:hs", "room", {}, "K1: a space declaring `ddjp_mode` is a DDJP ROOM");
  want(A.ch.chat_staff, "channel", { verified: true, room: "!a:hs", kind: "chat_staff" },
    "K2: a channel whose mark names a room you are in, which that room lists and its creator made, is VERIFIED");
  want("!fake:hs", "channel", { verified: false, why: /does not list it/ }, "K3: a stranger's room claiming your room is not verified — the room does not list it");
  want("!madeby:hs", "channel", { verified: false, why: /made by someone other than the room's creator/ },
    "K4: listed by your room but made by someone else: not verified");
  want(P.ch.chat_guest, "channel", { verified: false, waitsUnder: "!p:hs" }, "K5: a channel of a room you are INVITED to, made by its creator, waits under that invitation");
  want("!pfake:hs", "channel", { verified: false, waitsUnder: null, why: /made by someone other than the room's creator/ },
    "K5b: naming a room you are invited to but made by someone else: not confirmed");
  want("!nowhere:hs", "channel", { verified: false, why: /names a room you are not in/ }, "K6: naming a room you are neither in nor invited to: not confirmed");
  want("!half:hs", "channel", { verified: false, why: /mark is incomplete/ }, "K7: an incomplete mark: not confirmed");
  want("!oddkind:hs", "channel", { verified: false, why: /kind its room does not have/ }, "K7b: a kind the room's engine does not have: not confirmed");
  want("!bare:hs", "channel", { verified: false, why: /carries no mark/ }, "K8: listed by your room but carrying no mark: not confirmed (forward only)");
  want("!nocreate:hs", "unreadable", {}, "K9: no creation record in the preview: UNREADABLE (fails closed)");
  want("!dm:hs", "other", {}, "K10: a person's direct invite is NOT DDJP");
  want("!group:hs", "other", { warn: "group" }, "K11: a group room is NOT DDJP, with the group warning — here from a preview that shows its members");
  want("!space:hs", "other", {}, "K12: ANOTHER APP'S SPACE is not a DDJP room — it belongs to the DM panel (ruling 17)");
  want("!pair:hs", "other", { warn: "unknown" }, "K13: a two-person room not marked direct is NOT DDJP — no member count decides (8e) — and, " +
    "with no summary, its size is unknown");

  // K14 — the summary sets the warning once it is asked (the DM panel asks it).
  await Promise.all(["!sum1:hs", "!sum5:hs", "!pair:hs"].map((id) => w.MA.requestInviteSummary ? w.MA.requestInviteSummary(id, null) : null));
  const v2 = Object.create(null); for (const v of (w.MA.invites() || [])) v2[v.roomId] = v;
  ok((v2["!sum1:hs"] || {}).warn === "two" && (v2["!sum5:hs"] || {}).warn === "group" && (v2["!pair:hs"] || {}).warn === "unknown",
    "K14: the server's summary decides the warning — one joined is just the two of you, five is a group, unanswered stays unknown",
    { sum1: (v2["!sum1:hs"] || {}).warn, sum5: (v2["!sum5:hs"] || {}).warn, pair: (v2["!pair:hs"] || {}).warn });

  // P — THE PARTITION, read from the three readers the app shows.
  const scan = w.Room.scanDDJPRooms();
  const dm = (w.Chat.dmInvites() || []).map((i) => i.roomId);
  const lobbyRooms = (scan.invited || []).map((r) => r.spaceId);
  const notConfirmed = (scan.unconfirmed || []).map((r) => r.roomId);
  const all = (vs || []).map((v) => v.roomId);
  const waitingUnderInvite = (vs || []).filter((v) => v.verdict === "channel" && v.waitsUnder).map((v) => v.roomId);
  const waitingUnderJoined = (vs || []).filter((v) => v.verdict === "channel" && v.verified).map((v) => v.roomId);
  const places = Object.create(null);
  for (const [name, ids] of [["lobby room", lobbyRooms], ["under an invitation", waitingUnderInvite], ["under a joined room", waitingUnderJoined],
    ["not confirmed", notConfirmed], ["DM panel", dm]]) for (const id of ids) (places[id] = places[id] || []).push(name);
  const wrong = all.filter((id) => !places[id] || places[id].length !== 1).map((id) => [id, places[id] || []]);
  ok(all.length === 17 && wrong.length === 0, "P: EVERY INVITE IN EXACTLY ONE PLACE — never two, never none", { count: all.length, wrong });
  ok(["!dm:hs", "!group:hs", "!space:hs", "!pair:hs"].every((id) => dm.indexOf(id) >= 0) &&
     dm.every((id) => (by[id] || {}).verdict === "other"),
    "P: the DM panel holds every non-DDJP invite, another app's space included, and nothing else (ruling 17)", dm);
  ok([A.ch.chat_staff, P.ch.chat_guest, "!fake:hs", "!madeby:hs", "!nocreate:hs", "!p:hs"].every((id) => dm.indexOf(id) < 0),
    "P: a DDJP invite never shows in the DM panel — verified, waiting, not confirmed or a room — and neither does an unreadable one", dm);
  ok(lobbyRooms.join() === "!p:hs", "P: the lobby lists ONLY the DDJP room as a room invitation — not another app's space (8f)", lobbyRooms);
  const pRow = (scan.invited || [])[0] || {};
  ok(Array.isArray(pRow.waiting) && pRow.waiting.join() === "guest chat", "P: and under it, its waiting channel invitation", pRow.waiting);
  const aRow = (scan.joined || []).concat(scan.owned || []).find((r) => r.spaceId === "!a:hs") || {};
  ok(aRow.waiting === 1, "P: under the joined room that does not run here, its verified channel invitation waits", aRow);
  ok(notConfirmed.slice().sort().join() === ["!bare:hs", "!fake:hs", "!half:hs", "!madeby:hs", "!nocreate:hs", "!nowhere:hs", "!oddkind:hs", "!pfake:hs"].sort().join(),
    "P: \"Invitations not confirmed\" holds every DDJP-looking invite that is not verified, and the unreadable one", notConfirmed);
  ok((scan.unconfirmed || []).every((r) => typeof r.why === "string" && r.why.length > 0), "P: each with its reason", scan.unconfirmed);

  _finished = true;
  if (failed) { console.log("[invite-kinds] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[invite-kinds] PASS — every pending invite has one verdict from one classifier and shows in exactly one place (J81; " +
    asserts + " assertions): a space declaring its engine is a room invitation; a channel is verified only when its mark is complete, " +
    "its room is joined and lists it and the room's creator made it — a stranger's look-alike, a listed room made by someone else, an " +
    "incomplete mark, an unknown kind and an unmarked listed room are not confirmed, with their reasons; a channel of a room you are " +
    "invited to waits under that invitation; an invite with no creation record is unreadable; and everything else — a DM, a group, a " +
    "two-person room, another app's space — is the DM panel's and only the DM panel's, with no member count deciding, the summary " +
    "setting the warning. Seventeen invites, seventeen places, none twice.");
})().catch((e) => { console.log("[invite-kinds] FAIL — threw: " + ((e && e.stack) || e)); _finished = true; process.exit(1); });
