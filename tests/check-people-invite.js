#!/usr/bin/env node
// tests/check-people-invite.js
// SUBJECT: ui/shell.js, index.html
//
// WALL: THE PEOPLE TAB'S INVITE ABOVE THE PEOPLE, LIKE DMs (`ddjp_698`, JOB 5; the owner's: "id like the invite in people tab to
// go above users so it looks like dms"). The invite box and its Invite button sit under the tab's heading line ("People · N active",
// the active box) and above the people list — the DM tab's shape: its heading, its search box, its list (the supervisor's pick of
// the statement's two readings) — in that search row's look: full width, as high (the search's 6 px padding and 12 px type), the
// same 6 px under it, the button as high as the box. Nothing else in the tab moves; the box still invites by `room.invite`.
// Driven on the REAL ui/ files (`tests/_screen-world.js`), the page's own sheet read as a browser reads it (DECLARED, through the
// world's cascade); Chromium measured both tabs at desktop and phone width (698-REPORT.md).
// RED FIRST ON 697: the invite row is the tab's last row, under the list, 30 px high in 13 px type.
"use strict";
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[people-invite] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }

const performed = [];
const features = {
  Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [], getMyRank: () => 0,
    getMyAuthorityLevel: () => 0, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
  Actions: { ACTIONS: [], describe: () => ({ enabled: true, reason: null }), perform: async (verb, a) => { performed.push([verb, a && a.userId]); return { ok: true }; } },
  Media: { getAvatarUrl: () => null },
};
const w = SW.world({ features, domShaped: true });
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
// The main screen is built as the other screen guards build it; a stand-in it asks about and this guard does not script may
// throw after the tab is built, which is not this guard's subject — the tab must exist.
try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Invite room" }); } catch (e) { /* see above */ }
const roster = w.refs.roster;
ok(!!roster, "APPLIED — the People tab was built (`refs.roster`)");
const kids = roster ? Array.from(roster.children || []) : [];
const cls = (n) => (n && n.className) || "";
ok(kids.length === 3, "PREMISE — the People tab holds three rows (the invite, who is active, the list)", kids.map(cls));
const row = kids.find((k) => /(^|\s)invite-row(\s|$)/.test(cls(k)));
ok(kids[0] === w.refs.activeBox && kids[1] === row && kids[2] === w.refs.rosterBox,
  "THE INVITE IS ABOVE THE PEOPLE — under the tab's heading line, above the list, as DMs' search box is under its heading", kids.map(cls));
const input = row ? Array.from(row.children || []).find((k) => /(^|\s)invite-input(\s|$)/.test(cls(k))) : null;
const btn = row ? Array.from(row.children || []).find((k) => /(^|\s)invite-btn(\s|$)/.test(cls(k))) : null;
ok(!!input && !!btn && btn.textContent === "Invite", "its box and its Invite button, as before", row && Array.from(row.children || []).map(cls));
// THE DM SEARCH ROW'S LOOK, from the page's own sheet.
const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
const search = w.doc.createElement("input"); search.className = "dm-search"; w.doc.body.appendChild(search);
const px = (v) => (v === null || v === undefined) ? null : parseFloat(v);
const pad = (v) => String(v || "").trim().split(/\s+/).map(parseFloat);
const sPad = pad(decl(search, "padding")), iPad = pad(decl(input, "padding"));
ok(decl(input, "font-size") === decl(search, "font-size") && decl(input, "font-size") === "12px", "THE SAME TYPE AS THE DM SEARCH — 12 px", [decl(input, "font-size"), decl(search, "font-size")]);
ok(JSON.stringify(iPad) === JSON.stringify(sPad) && sPad[0] === 6, "THE SAME PADDING — 6 px 8 px", [decl(input, "padding"), decl(search, "padding")]);
ok(px(decl(input, "height")) === 28, "AS HIGH AS THE SEARCH ROW — 28 px (Chromium drew the search 28 px)", decl(input, "height"));
ok(px(decl(btn, "height")) === px(decl(input, "height")), "the button as high as the box", [decl(btn, "height"), decl(input, "height")]);
const sMargin = pad(decl(search, "margin")), rMb = px(decl(row, "margin-bottom")) !== null ? px(decl(row, "margin-bottom")) : pad(decl(row, "margin"))[2];
ok(rMb === 6 && sMargin[2] === 6, "THE SAME SPACE UNDER IT — 6 px", { row: decl(row, "margin") || decl(row, "margin-bottom"), search: decl(search, "margin") });
ok(decl(row, "display") === "flex" && (decl(input, "flex") || "").split(/\s+/)[0] === "1", "FULL WIDTH — the box takes the row beside its button, the row the tab's width", [decl(row, "display"), decl(input, "flex")]);
// STILL INVITES.
if (input && btn) {
  input.value = "@friend:hs";
  Promise.resolve(btn.onclick && btn.onclick()).then(() => {
    ok(performed.length === 1 && performed[0][0] === "room.invite" && performed[0][1] === "@friend:hs", "and it still invites by `room.invite`", performed);
    finish();
  }, (e) => { ok(false, "the Invite button threw — " + (e && e.message)); finish(); });
} else finish();
function finish() {
  if (failed) { console.log("[people-invite] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[people-invite] PASS — the People tab's invite above the people, like DMs (`ddjp_698`, the owner's \"id like the invite in people tab to go " +
    "above users so it looks like dms\"; " + asserts + " assertions): its box and Invite button sit under the tab's heading line and above " +
    "the people list, as DMs' search box sits under its heading; in the DM search row's look, read from the page's sheet — 12 px type, " +
    "6 px 8 px padding, 28 px high, the button as high, 6 px under it, full width; and it still invites by `room.invite`. Chromium drew both " +
    "tabs, desktop and phone");
  process.exit(0);
}
