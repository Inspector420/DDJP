// tests/check-view-menu.js
// SUBJECT: ui/roster.js, ui/shell.js, ui/screens.js, index.html
// WALL: THE VIEW IS PICKED IN YOUR PICTURE'S MENU, AND THE TOP BAR LOSES ⊞ AND COPY-MY-ID (`ddjp_699`, JOB 3; the owner's: "we can
// move the top bar button to copy user name in the status under profile since we showt he name in it proably a small button to
// the right of the name at the edge of the right side ... and we can also remove the layout button and also put it there in where
// we have 3 squares per layout or rectagle offering the layout but it must look good asa whole").
//   A  THE TOP BAR, IN A ROOM — no ⊞ and no button copying your ID; your picture there. CHANGED ON PURPOSE AT `ddjp_702` (the
//      owner's "remove room at the top"): no copy button at all — the room's ⧉ went to your picture's menu too
//      (`check-picture-menu`).
//   B  THE ROOM LIST — your picture and your ID's text, and no copy button beside them.
//   C  THE MENU'S TOP ROW — a small ⧉ at its right edge (last in the row, pushed there by the sheet), the copy button's own look;
//      clicked, it copies your Matrix ID and shows ✓, as every copy button does ("Copied").
//   D  THE LAYOUT TILES, INSIDE A ROOM ONLY — at the menu's foot under a divider, one tile per row of the shell's ONE table (Wide,
//      Compact, Phone), each a small drawing holding that layout's columns (three, two, one — the phone's frame upright) with
//      its word under it, spaced evenly; the one in use blue, the app's blue; none on the room list's menu.
//   E  A TILE SWITCHES THE LAYOUT — the real `_setLayout` (the columns' `data-layout`, remembered on this device), and the menu
//      closes, as ⊞'s menu closed on a pick; opened again, the new one is blue.
//   G  THE HEADER'S FIT PLACES THE OPEN MENU AGAIN AT ONCE — the fit moving your picture moves its menu in the same turn, no frame
//      waited (`H.placeMenus`, from `_fitHeader`); the window and the frames are `check-matrix-status` F's.
// DRIVEN on the REAL ui/ files (`tests/_screen-world.js`), the sheet read as a browser reads it (DECLARED, its cascade); where
// the tiles and the ⧉ sit and how they look was measured in Chromium (`699-REPORT.md`).
// CHANGED AT `ddjp_699`: this guard held ⊞'s menu (J134: under its button, its left edge with the button's, 8 px inside the window,
// placed again on resize and on the header's fit; `ddjp_698` G: and when the header's content moved the button). ⊞ is gone; your
// picture's menu, the only top-bar menu left, is held by `check-matrix-status` F, and this guard holds what took ⊞'s place.
"use strict";
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[view-menu] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const ME = "@me:hs";
const cls = (n) => String((n && n.className) || "");
const has = (n, c) => cls(n).split(/\s+/).indexOf(c) >= 0;
const flat = (k) => [k].concat(...Array.from((k && k.children) || []).filter((c) => c.nodeType === 1).map(flat));
const kidsOf = (n) => Array.from((n && n.children) || []).filter((c) => c.nodeType === 1);

const copied = [];
const prefs = { layout: "wide", set: [] };
const MS = { state: () => ({ lines: [{ key: "connection", label: "Matrix", state: "Online", tone: "ok", text: "Online" }], ring: "green", chat: null }), onChange() {}, waitingSecs: () => 0 };
const features = {
  Room: { rankLadder: () => [], getMyId: () => ME, getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [], getMyRank: () => 0,
    getMyAuthorityLevel: () => 0, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
  Media: { getAvatarUrl: () => null },
  Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
  ChatPrefs: { layout: () => prefs.layout, setLayout: (m) => { prefs.set.push(m); prefs.layout = m; } },
};
const w = SW.world({ features, domShaped: true, globals: { MatrixStatus: MS } });
w.sb.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "View room" }); } catch (e) { /* a stand-in not scripted may throw after the screen is built */ }
w.sb.Roster.renderMyRank();
const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
const settle = () => new Promise((r) => setImmediate(r));

(async () => {
  // ── A — THE TOP BAR, IN A ROOM ───────────────────────────────────────────────────────────────────────────────────────────────
  const header = w.refs.mainHeader;
  ok(!!header, "A APPLIED — the main screen's top bar was built (`refs.mainHeader`)");
  const inBar = flat(header);
  ok(!inBar.some((n) => has(n, "layout-btn") || has(n, "layout-selector") || n.textContent === "⊞"), "A: NO ⊞ IN THE TOP BAR", inBar.map(cls).filter(Boolean));
  // Every copy button in the bar, by what it copies: click each and read the clipboard.
  const copyBtns = inBar.filter((n) => has(n, "copy-btn") && n.tagName === "BUTTON" && !has(n, "back-btn"));
  const what = [];
  for (const b of copyBtns) { const before = copied.length; b.onclick(); await settle(); what.push([cls(b), copied.slice(before)]); }
  ok(!what.some(([, c]) => c.indexOf(ME) >= 0), "A: AND NO BUTTON IN IT COPIES YOUR ID — copy-my-ID went to your picture's menu", what);
  const titleGroup = inBar.find((n) => has(n, "title-group"));
  ok(what.length === 0 && !!titleGroup && kidsOf(titleGroup).length === 1 && kidsOf(titleGroup)[0] === w.refs.roomTitle,
    "A: NO COPY BUTTON IN THE TOP BAR — the room's ⧉ left the room name for your picture's menu (`ddjp_702`)", { what, title: titleGroup && kidsOf(titleGroup).map(cls) });
  ok(inBar.indexOf(w.refs.myAvatarSlot) >= 0, "A: your picture is in the top bar, as before");

  // ── B — THE ROOM LIST ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ident = w.doc.createElement("div"); ident.id = "rooms-identity"; w.doc.body.appendChild(ident);
  const realGet = w.doc.getElementById ? w.doc.getElementById.bind(w.doc) : null;
  w.doc.getElementById = (id) => (id === "rooms-identity" ? ident : (realGet ? realGet(id) : null));
  w.sb.Screens.renderRoomList && (() => { try { w.sb.Screens.renderRoomList([]); } catch (e) { /* the list's own stand-ins */ } })();
  const listKids = kidsOf(ident);
  ok(listKids.some((n) => has(n, "rooms-my-pic")) && listKids.some((n) => has(n, "my-id") && n.textContent === ME),
    "B: THE ROOM LIST KEEPS YOUR PICTURE AND YOUR ID'S TEXT", listKids.map((n) => [cls(n), n.textContent]));
  ok(!listKids.some((n) => has(n, "copy-btn")), "B: AND ITS COPY BUTTON IS GONE — your picture's menu has it", listKids.map(cls));

  // ── C — THE MENU'S TOP ROW ───────────────────────────────────────────────────────────────────────────────────────────────────
  const slot = w.refs.myAvatarSlot;
  slot.onclick();
  const menuNow = () => kidsOf(w.doc.body).find((n) => has(n, "st-menu")) || null;
  let menu = menuNow();
  if (!ok(!!menu, "C APPLIED — your picture's menu opened in a room")) return finish();
  const head = kidsOf(menu).find((n) => has(n, "st-head"));
  const row = kidsOf(head);
  const cp = row[row.length - 1];
  ok(!!cp && has(cp, "copy-btn") && has(cp, "icon-only") && cp.textContent === "⧉" && cp.tagName === "BUTTON",
    "C: THE TOP ROW ENDS IN A SMALL ⧉ — the copy button's own look (`copy-btn icon-only`)", row.map((n) => [cls(n), n.textContent]));
  ok(decl(cp, "margin-left") === "auto" && decl(head, "display") === "flex", "C: AT THE ROW'S RIGHT EDGE — pushed there by the sheet (DECLARED)", { ml: decl(cp, "margin-left"), row: decl(head, "display") });
  const n0 = copied.length;
  if (cp && cp.onclick) cp.onclick();
  await settle();
  ok(copied.slice(n0).join() === ME && cp.textContent === "✓" && has(cp, "copied"), "C: CLICKED, IT COPIES YOUR MATRIX ID AND SHOWS ✓ — \"Copied\", as every copy button does",
    { copied: copied.slice(n0), text: cp && cp.textContent, cls: cls(cp) });

  // ── D — THE LAYOUT TILES ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const table = w.H.layouts ? w.H.layouts() : [];
  ok(table.length === 3 && table.map((l) => l.id).join() === "wide,compact,phone" && table.map((l) => l.cols).join() === "3,2,1",
    "D PREMISE — the shell's one table: Wide (three columns), Compact (two), Phone (one)", table);
  const tray = kidsOf(menu).find((n) => has(n, "st-lays"));
  ok(!!tray && kidsOf(menu)[kidsOf(menu).length - 1] === tray, "D: AT THE MENU'S FOOT, INSIDE A ROOM — after its lines", kidsOf(menu).map(cls));
  ok(!!tray && decl(tray, "border-top") === "1px solid #2d2d34" && decl(tray, "border-top") === decl(head, "border-bottom"),
    "D: UNDER A DIVIDER — the top row's own line (DECLARED)", tray && { tray: decl(tray, "border-top"), head: decl(head, "border-bottom") });
  ok(!!tray && decl(tray, "display") === "flex" && decl(tray, "justify-content") === "space-evenly", "D: SPACED EVENLY ACROSS THE MENU (DECLARED)", tray && { d: decl(tray, "display"), j: decl(tray, "justify-content") });
  const tiles = kidsOf(tray);
  ok(tiles.length === 3 && tiles.every((t) => t.tagName === "BUTTON" && has(t, "st-lay")), "D: THREE TILES, EACH A BUTTON", tiles.map(cls));
  const shape = tiles.map((t) => { const k = kidsOf(t); return { word: k[1] && k[1].textContent, cols: k[0] ? kidsOf(k[0]).filter((c) => has(c, "st-lay-col")).length : 0, picFirst: has(k[0], "st-lay-pic") && has(k[1], "st-lay-word"), phone: has(k[0], "st-lay-phone") }; });
  ok(JSON.stringify(shape.map((s) => [s.word, s.cols])) === JSON.stringify(table.map((l) => [l.label, l.cols])) && shape.every((s) => s.picFirst),
    "D: EACH A SMALL DRAWING OF ITS LAYOUT — its columns drawn — WITH ITS WORD UNDER IT: Wide 3, Compact 2, Phone 1", shape);
  ok(shape.length === 3 && shape[2].phone && !shape[0].phone && !shape[1].phone && decl(kidsOf(tiles[2])[0], "width") === "20px" && decl(kidsOf(tiles[0])[0], "width") === "44px",
    "D: THE PHONE'S FRAME IS UPRIGHT — narrower than the screens' (DECLARED)", shape.length === 3 ? { phone: decl(kidsOf(tiles[2])[0], "width"), wide: decl(kidsOf(tiles[0])[0], "width") } : shape);
  if (tiles.length !== 3) return finish();
  const blue = decl(kidsOf(menu).find((n) => has(n, "st-head")) && flat(menu).find((n) => has(n, "st-pic-edit")), "background");
  const onTiles = tiles.filter((t) => has(t, "on"));
  ok(onTiles.length === 1 && onTiles[0] === tiles[0] && decl(tiles[0], "color") === blue && blue === "#5865F2" && decl(tiles[1], "color") !== blue,
    "D: THE ONE IN USE IS BLUE — Wide, in the app's blue (the ✎'s, #5865F2); the others not", { on: onTiles.map((t) => kidsOf(t)[1].textContent), colours: tiles.map((t) => decl(t, "color")), blue });

  // ── E — A TILE SWITCHES THE LAYOUT ───────────────────────────────────────────────────────────────────────────────────────────
  tiles[2].click();
  ok(w.refs.columns && w.refs.columns.getAttribute("data-layout") === "phone" && prefs.set[prefs.set.length - 1] === "phone",
    "E: PHONE CLICKED — THE LAYOUT IS PHONE (the real switch: the columns' `data-layout`, remembered on this device)", { layout: w.refs.columns && w.refs.columns.getAttribute("data-layout"), saved: prefs.set });
  ok(!menuNow(), "E: AND THE MENU CLOSES, as ⊞'s did on a pick", !!menuNow());
  slot.onclick();
  menu = menuNow();
  const again = menu ? kidsOf(kidsOf(menu).find((n) => has(n, "st-lays"))).filter((t) => has(t, "on")).map((t) => kidsOf(t)[1].textContent) : null;
  ok(JSON.stringify(again) === JSON.stringify(["Phone"]), "E: OPENED AGAIN, PHONE IS THE BLUE ONE", again);
  kidsOf(kidsOf(menu).find((n) => has(n, "st-lays")))[0].click();   // back to Wide
  ok(w.refs.columns.getAttribute("data-layout") === "wide", "E: and Wide switches back", w.refs.columns.getAttribute("data-layout"));

  // ── G — THE HEADER'S FIT PLACES THE OPEN MENU AGAIN AT ONCE ───────────────────────────────────────────────────────────────────
  let at = { left: 1086, right: 1118, top: 10, bottom: 42 };
  slot.getBoundingClientRect = () => Object.assign({ width: at.right - at.left, height: at.bottom - at.top, x: at.left, y: at.top }, at);
  w.sb.window.innerWidth = 1300;
  slot.onclick();
  menu = menuNow();
  if (menu) {
    menu.getBoundingClientRect = () => ({ width: 280, height: 260, left: 0, top: 0, right: 280, bottom: 260, x: 0, y: 0 });
    w.H.placeMenus();
    const before = parseFloat(menu.style.left);
    at = { left: 1046, right: 1078, top: 10, bottom: 42 };   // the fit shortened something: your picture moved 40 px left
    const queued = w.pendingFrames();
    w.H._fitHeader();
    ok(before === 1118 - 280 && parseFloat(menu.style.left) === 1078 - 280 && w.pendingFrames() === queued,
      "G: THE HEADER'S FIT MOVES YOUR PICTURE — ITS OPEN MENU IS UNDER IT AGAIN IN THE SAME TURN, no frame waited", { before, after: parseFloat(menu.style.left), queued, now: w.pendingFrames() });
    slot.onclick();
  } else ok(false, "G APPLIED — the menu opened again");

  // ── F — THE ROOM LIST'S MENU HAS NO TILES (and keeps the ⧉) ─────────────────────────────────────────────────────────────────
  const pic = listKids.find((n) => has(n, "rooms-my-pic"));
  if (pic && pic.onclick) {
    pic.onclick();
    const lm = menuNow();
    ok(!!lm && !kidsOf(lm).some((n) => has(n, "st-lays")) && flat(lm).some((n) => has(n, "st-copy")),
      "D: ON THE ROOM LIST THE MENU HAS NO LAYOUT TILES — inside a room only — and keeps the ⧉", lm && kidsOf(lm).map(cls));
    pic.onclick();
  } else ok(false, "D APPLIED — the room list's picture opens its menu");
  finish();
})().catch((e) => { ok(false, "threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); finish(); });

function finish() {
  if (failed) { console.log("[view-menu] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[view-menu] PASS — the view is picked in your picture's menu, and the top bar loses ⊞ and copy-my-ID (`ddjp_699`, JOB 3; " + asserts +
    " assertions): no ⊞ and no button copying your ID in a room's top bar, the room's ⧉ by its name kept; the room list keeps your picture and " +
    "your ID's text, its copy button gone; the menu's top row ends in a small ⧉ at its right edge that copies your Matrix ID and shows ✓; inside " +
    "a room, under a divider, three tiles from the shell's one table — Wide, Compact, Phone, each a drawing of its columns with its word under it, " +
    "spaced evenly, the one in use in the app's blue — a pick switches the layout by the real switch and closes the menu; none on the room list; " +
    "the header's fit places the open menu again at once. Chromium drew it (the report)");
  process.exit(0);
}
