// tests/check-picture-menu.js
// SUBJECT: ui/roster.js, ui/shell.js, index.html
// WALL: YOUR PICTURE'S MENU HOLDS YOUR RANK AND THE ROOM; THE TOP BAR LOSES BOTH (`ddjp_702`, JOB 1; the owner's: "maybe put the room
// Id in its own segment betwhen the user and matrix statuses", "remove room at the top", "do you think we should change  the rank to
// be in the card instead of the top bar", "i think i should be like A but on its own row above or below", "i like under, but maybe
// change the color for the rank color in chat"; his words in `main/05-matrix.md` §Slow-downs you can see).
//   P  YOUR RANK'S PILL — inside a room, on its own line under your ID: the rank's own name (`H.rankName`) of the AUTHORITY level (the
//      human owner reads "Owner", never the bot's "Bot"), in the rank's chat colour (`H.rankColor`) — the word in it, a soft fill of
//      it (16%), a thin border of it (55%); two ranks, two colours; an open menu's pill follows a rank change.
//   R  THE ROOM'S SEGMENT — inside a room, between your row and the status lines, no label: the room's name and its ID in your own
//      name's and ID's classes (so the same size, weight and grey, and "…" when long — DECLARED), and a ⧉ that copies the room's ID,
//      on the same right edge as yours (the same row rule — DECLARED).
//   O  THE ORDER — your row, the room's segment, the status lines, the layout tiles.
//   L  ON THE ROOM LIST — your row without the pill, no room segment, no My Rank.
//   T  THE TOP BAR — no rank pill and no copy button (the room's ⧉ left too): ← and the room's name on the left, your picture on the
//      right; the pill's rules gone from the sheet, and the header's fit has no rung for it.
// DRIVEN on the REAL ui/ files (`tests/_screen-world.js`), the sheet read as a browser reads it (DECLARED, its cascade). How it looks
// was measured in Chromium (`702-REPORT.md`): the pill 10.5 px, orange for the owner and blue for Staff; the two ⧉ on one edge.
// RED FIRST ON 701: no pill, no room segment; the top bar holds the pill and the room's ⧉.
"use strict";
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[picture-menu] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const ME = "@me:hs", ROOM = { roomId: "!room:hs", spaceId: "!room:hs", name: "Friday night at the club" };
const cls = (n) => String((n && n.className) || "");
const has = (n, c) => cls(n).split(/\s+/).indexOf(c) >= 0;
const flat = (k) => [k].concat(...Array.from((k && k.children) || []).filter((c) => c.nodeType === 1).map(flat));
const kidsOf = (n) => Array.from((n && n.children) || []).filter((c) => c.nodeType === 1);
const settle = () => new Promise((r) => setImmediate(r));

const copied = [];
const listeners = [];
let level = 100;
const LINES = [{ key: "connection", label: "Matrix", state: "Online", tone: "ok", text: "Online" },
  { key: "myRank", label: "My Rank", state: "In specs", tone: "ok", text: "In specs" },
  { key: "actions", label: "Actions & Chat", state: "OK", tone: "ok", text: "OK" }];
const MS = { state: (o) => ({ lines: (o && o.rank === false) ? LINES.filter((l) => l.key !== "myRank") : LINES, ring: "green", chat: null }),
  onChange: (fn) => listeners.push(fn), waitingSecs: () => 0 };
const features = {
  // The real ladder's levels, as `Room.rankLadder` hands them (backends/backend1/ranks.js): the page names and colours them.
  Room: { rankLadder: () => [{ name: "owner", level: 99 }, { name: "high-staff", level: 80 }, { name: "staff", level: 60 }, { name: "vip", level: 40 },
      { name: "player", level: 20 }, { name: "guest", level: 10 }, { name: "uncategorized", level: 0 }],
    getMyId: () => ME, getCurrent: () => ROOM, getRoster: () => [], getMyRank: () => Math.min(99, level), getMyAuthorityLevel: () => level,
    rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
  Media: { getAvatarUrl: () => null },
  Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
  ChatPrefs: { layout: () => "wide", setLayout: () => {} },
};
const w = SW.world({ features, domShaped: true, globals: { MatrixStatus: MS } });
w.sb.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
try { w.sb.Screens.enterMainScreen(ROOM); } catch (e) { /* a stand-in not scripted may throw after the screen is built */ }
w.sb.Roster.renderMyRank();
const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
const menuNow = () => kidsOf(w.doc.body).find((n) => has(n, "st-menu")) || null;
const hex = (h) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ""); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null; };
const rgba = (h, a) => { const c = hex(h); return c ? "rgba(" + c.join(", ") + ", " + a + ")" : null; };
const pillOf = (menu) => (menu ? flat(menu).find((n) => has(n, "st-rank")) : null) || null;

(async () => {
  const slot = w.refs.myAvatarSlot;
  slot.onclick();
  let menu = menuNow();
  if (!ok(!!menu, "APPLIED — your picture's menu opened in a room")) return finish();
  const rows = kidsOf(menu);

  // ── O — THE ORDER ──
  ok(JSON.stringify(rows.map(cls)) === JSON.stringify(["st-head", "st-head st-room", "st-lines", "st-lays"]),
    "O: YOUR ROW, THE ROOM'S SEGMENT, THE STATUS LINES, THE LAYOUT TILES — in that order", rows.map(cls));
  const lineLabels = flat(menu).filter((n) => has(n, "st-line")).map((n) => kidsOf(n)[0] && kidsOf(n)[0].textContent);
  ok(JSON.stringify(lineLabels) === JSON.stringify(LINES.map((l) => l.label)), "O: the lines are the status piece's, in its order", lineLabels);

  // ── P — YOUR RANK'S PILL ──
  const head = rows[0], who = kidsOf(head).find((n) => has(n, "st-who"));
  const whoKids = kidsOf(who);
  ok(whoKids.length === 3 && has(whoKids[0], "st-name") && has(whoKids[1], "st-id") && whoKids[1].textContent === ME && has(whoKids[2], "st-rank-line"),
    "P: THREE LINES — your name, your ID, then your rank on its own line under the ID", whoKids.map((n) => [cls(n), n.textContent]));
  let pill = pillOf(menu);
  const face = (lv) => ({ name: w.H.rankName(lv), color: w.H.rankColor(lv) });
  const owner = face(100);
  ok(!!pill && pill.parentNode === whoKids[2] && pill.textContent === owner.name && owner.name === "Owner",
    "P: THE RANK'S OWN NAME, OF THE AUTHORITY LEVEL — the human owner reads \"Owner\" (the authoring tier caps at the bot's rung, \"Bot\")", pill && pill.textContent);
  ok(!!pill && pill.style.color === owner.color && pill.style.background === rgba(owner.color, 0.16) && pill.style.borderColor === rgba(owner.color, 0.55),
    "P: IN THE RANK'S CHAT COLOUR — the word in it, a soft fill of it (16%), a thin border of it (55%)",
    pill && { color: pill.style.color, bg: pill.style.background, edge: pill.style.borderColor, want: owner.color });
  ok(decl(pill, "border-radius") === "999px" && /^1px solid/.test(decl(pill, "border") || "") && decl(pill, "font-size") === "10.5px" && decl(pill, "text-transform") === "uppercase",
    "P: A PILL — round ends, a thin border, small caps-size words (DECLARED)", pill && { r: decl(pill, "border-radius"), b: decl(pill, "border"), fs: decl(pill, "font-size"), tt: decl(pill, "text-transform") });
  // A rank change while the menu is open: the status piece tells (the room's rank change reaches it), and the pill follows.
  level = 60;
  for (const fn of listeners) fn();
  pill = pillOf(menuNow());
  const staff = face(60);
  ok(!!pill && pill.textContent === staff.name && staff.name !== owner.name && pill.style.color === staff.color && staff.color !== owner.color &&
     pill.style.background === rgba(staff.color, 0.16),
    "P: A RANK CHANGE WHILE IT IS OPEN — the pill follows: another rank, its own colour", pill && { text: pill.textContent, color: pill.style.color });
  level = 100;
  for (const fn of listeners) fn();

  // ── R — THE ROOM'S SEGMENT ──
  const seg = rows[1];
  const segWho = kidsOf(seg).find((n) => has(n, "st-who"));
  const segKids = kidsOf(segWho);
  ok(!!seg && segKids.length === 2 && has(segKids[0], "st-name") && segKids[0].textContent === ROOM.name && has(segKids[1], "st-id") && segKids[1].textContent === ROOM.spaceId,
    "R: THE ROOM'S NAME, THEN ITS ID — in your own name's and ID's classes, so the same size, weight and grey", segKids.map((n) => [cls(n), n.textContent]));
  ok(!flat(seg).some((n) => n !== segKids[0] && n !== segKids[1] && kidsOf(n).length === 0 && n.textContent && n.textContent !== "⧉"),
    "R: NO LABEL — nothing in it but the name, the ID and the ⧉", flat(seg).map((n) => n.textContent).filter(Boolean));
  for (const n of [segKids[0], segKids[1]]) {
    ok(decl(n, "text-overflow") === "ellipsis" && decl(n, "white-space") === "nowrap" && decl(n, "overflow") === "hidden",
      "R: A LONG " + (has(n, "st-name") ? "NAME" : "ID") + " ENDS IN \"…\" (DECLARED)", { to: decl(n, "text-overflow") });
  }
  const segCopy = kidsOf(seg)[kidsOf(seg).length - 1], myCopy = kidsOf(head)[kidsOf(head).length - 1];
  ok(!!segCopy && has(segCopy, "st-copy") && has(segCopy, "copy-btn") && segCopy.textContent === "⧉" && decl(segCopy, "margin-left") === "auto" && decl(myCopy, "margin-left") === "auto" &&
     decl(seg, "display") === "flex" && decl(seg, "display") === decl(head, "display"),
    "R: ITS ⧉ ON THE SAME RIGHT EDGE AS YOURS — the same row rule pushes both there (DECLARED)", { seg: segCopy && cls(segCopy), ml: decl(segCopy, "margin-left") });
  const n0 = copied.length;
  if (segCopy && segCopy.onclick) segCopy.onclick();
  await settle();
  ok(copied.slice(n0).join() === ROOM.spaceId && segCopy.textContent === "✓", "R: CLICKED, IT COPIES THE ROOM'S ID and shows ✓", { copied: copied.slice(n0), text: segCopy && segCopy.textContent });
  ok(decl(seg, "border-bottom") === decl(head, "border-bottom") && decl(head, "border-bottom") === "1px solid #2d2d34", "R: under a divider like your row's (DECLARED)", decl(seg, "border-bottom"));

  // ── L — ON THE ROOM LIST ──
  const listPic = w.doc.createElement("div");
  w.doc.body.appendChild(listPic);
  w.sb.Roster.ownPicture(listPic, { rank: false });
  listPic.onclick();
  menu = menuNow();
  ok(!!menu && !flat(menu).some((n) => has(n, "st-rank") || has(n, "st-rank-line") || has(n, "st-room")) && kidsOf(menu).map(cls).join() === "st-head,st-lines",
    "L: ON THE ROOM LIST — your row without the pill, no room segment", menu && kidsOf(menu).map(cls));
  const listLabels = menu ? flat(menu).filter((n) => has(n, "st-line")).map((n) => kidsOf(n)[0].textContent) : [];
  ok(listLabels.indexOf("My Rank") < 0 && listLabels.length === LINES.length - 1, "L: and no My Rank", listLabels);

  // ── T — THE TOP BAR ──
  const header = w.refs.mainHeader;
  const inBar = flat(header);
  ok(!w.refs.rankBadge && !inBar.some((n) => has(n, "rank-badge")), "T: NO RANK PILL IN THE TOP BAR", inBar.map(cls).filter((c) => /rank/.test(c)));
  ok(!inBar.some((n) => has(n, "copy-btn") && !has(n, "back-btn")), "T: NO COPY BUTTON IN IT — the room's ⧉ left too", inBar.filter((n) => has(n, "copy-btn")).map(cls));
  const parts = kidsOf(header);
  ok(has(parts[0], "back-btn") && has(parts[1], "title-group") && kidsOf(parts[1]).length === 1 && kidsOf(parts[1])[0] === w.refs.roomTitle &&
     has(parts[parts.length - 1], "my-identity") && kidsOf(parts[parts.length - 1])[0] === w.refs.myAvatarSlot,
    "T: ← AND THE ROOM'S NAME ON THE LEFT, YOUR PICTURE ON THE RIGHT", parts.map(cls));
  const css = require("fs").readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  ok(!/\.rank-badge\b/.test(css), "T: the pill's rules left the sheet with it — a rule for nothing reads as a part that is there");
  ok(w.H.headerFit && !("fullRank" in w.H.headerFit()), "T: and the header's fit keeps no rank's words to shorten", w.H.headerFit && Object.keys(w.H.headerFit()));
  finish();
})().catch((e) => { ok(false, "threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); finish(); });

function finish() {
  if (failed) { console.log("[picture-menu] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[picture-menu] PASS — your picture's menu holds your rank and the room, and the top bar loses both (`ddjp_702`, JOB 1; " + asserts +
    " assertions): in a room, your row's three lines — name, ID, then your rank as a pill, the authority level's own name (the owner \"Owner\") " +
    "in its chat colour, a soft fill and a thin border of it, following a rank change while open; the room's segment, no label, its name and ID " +
    "in your own lines' classes and \"…\" when long, its ⧉ copying the room's ID on your ⧉'s edge; then the status lines and the layout tiles. " +
    "On the room list: no pill, no segment, no My Rank. The top bar: ← and the room's name, your picture; no pill, no copy button, no rule or fit " +
    "rung left for them. Chromium measured how it looks (the report)");
  process.exit(0);
}
