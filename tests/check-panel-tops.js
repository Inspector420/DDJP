// tests/check-panel-tops.js
// SUBJECT: index.html, ui/shell.js
// WALL: PEOPLE AND DMs LINED UP (`ddjp_699`, JOB 4; the owner's: "it would be nice if the search invite bars and first slement under
// them where at the same exsact heights in people and DMs now they are slightly missalosnged because of the lock box and invite box
// not being on the same level, and thats ok, we dont want to modify the layouts just maybe the higher if its not wrong").
// Measured at 698 in Chromium, desktop: People's bar at y 162, its first row at 204; DMs' bar at 170, its first row at 212 — the
// same 8 px both, DMs' heading line holding its 30 px lock and the DM box's own 8 px gap under it. Now People's invite row takes
// those 8 px above it (the higher one moves down, the owner's), and nothing else moves.
//   T  THE TWO TOPS IN BOTH TABS — from the top of each tab's pane: the bar (People's invite box, DMs' search box) and the first
//      row under it (the first person, the first conversation) at the same height, with the DM list drawn as it is with
//      conversations (the lock and Clear list in its heading line).
//   N  NOTHING ELSE MOVES — People's heading line and DMs' whole tab exactly as at 698: the same declarations.
//   W  AT EVERY WIDTH — no `@media` rule touches either tab's lines, so the desktop's tops are the phone's (Chromium measured both).
//   E  DMs WITH NO CONVERSATION (`ddjp_700`, JOB 3; closes HANDOFF's "DMs with no conversation have no lock in their heading
//      line"): no lock and no Clear list in the heading line, and the line keeps the lock's 30 px (`min-height`, the room's DM tab's
//      list only), so the search box and the first thing under it sit where they do with conversations — on People's line. At
//      699 the line was 16 px with nothing in it, and the search sat 14 px higher (Chromium: 201 against 215). And nothing else:
//      the lobby's Messages box and an open conversation keep their heading as it was.
// DRIVEN on the REAL ui/ files (`tests/_screen-world.js`): each tab's nodes as the real panel builds them. MODELLED, and only this:
// a flex column's stacking — each child's top is the one before's bottom plus the margins and the column's gap, from the page's
// own sheet (DECLARED, through the world's cascade); a row's height its declared `height`, or a line holding controls the tallest
// of theirs; the DM search box 28 px, as Chromium draws it (its height comes from its type and padding: `check-people-invite`).
// RED FIRST ON 698: People's bar and first row each 8 px above DMs'. ON 699: E — the empty DMs' search 14 px above People's invite.
// CHANGED ON PURPOSE AT `ddjp_700`: part E added, and a row's height reads its `min-height` too (the heading line's 30 px).
"use strict";
const fs = require("fs");
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[panel-tops] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const NOW = 1.9e12;
const features = {
  Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getMyRank: () => 0, getMyAuthorityLevel: () => 0,
    getRoster: () => [{ userId: "@ann:hs", name: "ann", level: 0 }, { userId: "@me:hs", name: "me", level: 0 }], rankStanding: () => ({ ring: false }),
    onRankChange() {}, onMembersChange() {}, peopleOrder: (v, roster) => roster.map((m) => ({ member: m, active: null })), presenceView: () => ({ people: [], effectiveWindowMs: 3600000 }), recentlyActive: () => ({ people: [] }) },
  Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
  Chat: { conversations: () => [{ userId: "@zoe:hs", roomIds: ["!dm1:hs"], roomId: "!dm1:hs", lastTs: NOW - 5000, unread: false }], dmUnreadCount: () => 0,
    clearConversations() {}, forgetConversation() {}, setDMVisible() {}, closeDM() {}, dmAnswering: () => false },
  ChatPrefs: { layout: () => "wide", setLayout() {} },
  Media: { getAvatarUrl: () => null },
  ServerClock: { serverNow: () => NOW },
};
const w = SW.world({ features, domShaped: true });
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
try { w.H.buildMainDom(w.main, { roomId: "!s:hs", spaceId: "!s:hs", name: "Tops room" }); } catch (e) { /* a stand-in not scripted may throw after the tabs are built */ }
try { w.sb.Panels.renderActivePanel(); } catch (e) {}
try { w.sb.Roster.renderRoster(); } catch (e) {}
try { w.refs.tabDM.click(); } catch (e) {}

const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
const { styleBlocks } = require(path.join(__dirname, "_page-css.js"));   // the page's one stylesheet reader (`check-list-look` R)
const sheet = styleBlocks(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")).join("\n");
const px = (v) => (v === null || v === undefined || v === "") ? 0 : (parseFloat(v) || 0);
// A box's four margins (or paddings), from the shorthand and the longhands as the cascade declares them.
function sides(n, kind) {
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  const sh = decl(n, kind);
  if (sh) { const v = String(sh).trim().split(/\s+/).map(px); const [t, r = t, b = t, l = r] = v; Object.assign(out, { top: t, right: r, bottom: b, left: l }); }
  for (const s of ["top", "right", "bottom", "left"]) { const lv = decl(n, kind + "-" + s); if (lv !== null) out[s] = px(lv); }
  return out;
}
const elems = (n) => Array.from((n && n.children) || []).filter((c) => c.nodeType === 1);
const has = (n, c) => String((n && n.className) || "").split(/\s+/).indexOf(c) >= 0;
const SEARCH_H = 28;   // Chromium's height for `.dm-search` (12 px type, 6 px padding, its border); `check-people-invite`
// A row's height: its declared `height`; the search box Chromium's; a line holding controls, the tallest of theirs.
function heightOf(n) {
  const h = decl(n, "height");
  if (h && /px$/.test(h)) return px(h);
  if (has(n, "dm-search")) return SEARCH_H;
  let best = 0;
  for (const k of elems(n)) best = Math.max(best, heightOf(k) + sides(k, "margin").top + sides(k, "margin").bottom);
  const min = decl(n, "min-height");   // a line held open with nothing in it (`ddjp_700`: DMs' heading)
  return (min && /px$/.test(min)) ? Math.max(best, px(min)) : best;
}
// The tops of a flex column's children, from the column's content top (its padding-top in): margins add, never collapse.
function tops(col) {
  const gap = px(decl(col, "gap") || decl(col, "row-gap"));
  let y = sides(col, "padding").top;
  const out = [];
  elems(col).forEach((k, i) => {
    if (i > 0) y += gap;
    const m = sides(k, "margin");
    y += m.top;
    out.push({ node: k, top: y, height: heightOf(k) });
    y += heightOf(k) + m.bottom;
  });
  return out;
}

// ── PEOPLE: the pane `refs.roster` — the heading line, the invite row, the people (their first row at the list's top). ──
const roster = w.refs.roster;
const pt = tops(roster);
const pInvite = pt.find((t) => has(t.node, "invite-row"));
const pList = pt.find((t) => t.node === w.refs.rosterBox);
ok(!!pInvite && !!pList && elems(w.refs.activeBox).some((n) => has(n, "active-top")) && !!w.refs.rosterBox.querySelector(".person"),
  "T PREMISE — People's pane: its heading line, its invite row, its list (a person in it)", pt.map((t) => String(t.node.className)));
const pBar = pInvite ? pInvite.top : null;
const pFirst = pList ? pList.top + sides(w.refs.rosterBox, "padding").top : null;
// ── DMs: the pane `refs.dm`, its box `refs.dmBox` — the heading line (title, Clear list, the lock), the search, the list. ──
const dmCol = w.refs.dmBox;
const dt = tops(dmCol);
const dHead = dt.find((t) => has(t.node, "dm-head")), dSearch = dt.find((t) => has(t.node, "dm-search")), dList = dt.find((t) => has(t.node, "dm-list"));
ok(!!dHead && !!dSearch && !!dList && !!dHead.node.querySelector(".panel-lock-btn") && !!dList.node.querySelector(".dm-row"),
  "T PREMISE — DMs' pane as it is with a conversation: its heading line holding the lock and Clear list, its search box, its list (a row in it)", dt.map((t) => String(t.node.className)));
const paneTop = (pane, inner) => (pane === inner ? 0 : sides(inner, "margin").top + sides(pane, "padding").top);
const dBar = dSearch ? paneTop(w.refs.dm, dmCol) + dSearch.top : null;
const dFirst = dList ? paneTop(w.refs.dm, dmCol) + dList.top : null;
ok(pBar !== null && pBar === dBar, "T: THE BARS AT THE SAME TOP — People's invite box and DMs' search box, from each tab's top", { people: pBar, dms: dBar });
ok(pFirst !== null && pFirst === dFirst, "T: AND THE FIRST ROW UNDER EACH AT THE SAME TOP — the first person, the first conversation", { people: pFirst, dms: dFirst });
ok(dBar === 46 && dFirst === 88, "T: WHERE DMs' WERE AT 698 — 46 px and 88 px down its pane (DMs' 170 and 212, Chromium, its pane at 124)", { dBar, dFirst });

// ── N — NOTHING ELSE MOVES: People's heading line and DMs' rules as at 698 ──
const head = elems(w.refs.activeBox).find((n) => has(n, "active-top"));
ok(decl(head, "height") === "30px" && decl(w.refs.activeBox, "margin") === "8px 0 0 0" && pt[0] && pt[0].node === w.refs.activeBox && pt[0].top === 8,
  "N: PEOPLE'S HEADING LINE STAYS — 8 px down, 30 px high, as at 698", { h: decl(head, "height"), m: decl(w.refs.activeBox, "margin"), top: pt[0] && pt[0].top });
ok(decl(dmCol, "gap") === "8px" && decl(dmCol, "padding") === "8px 0" && decl(dSearch && dSearch.node, "margin") === "0 0 6px" && decl(dHead && dHead.node.querySelector(".panel-lock-btn"), "height") === "30px",
  "N: AND DMs' TAB IS UNTOUCHED — its box's 8 px gap and padding, its search's 6 px under, its 30 px lock", { gap: decl(dmCol, "gap"), pad: decl(dmCol, "padding") });
ok(pInvite && pInvite.height === 28 && sides(pInvite.node, "margin").bottom === 6 && sides(w.refs.rosterBox, "margin").top === 8,
  "N: People's invite row as at 698 below it — 28 px, 6 px under, the list's own 8 px", pInvite && { h: pInvite.height, mb: sides(pInvite.node, "margin").bottom });

// ── E — DMs WITH NO CONVERSATION (`ddjp_700`, JOB 3) ──
{
  features.Chat.conversations = () => [];
  try { w.sb.ChatPanels.renderDMPanel(); } catch (e) {}
  const et = tops(w.refs.dmBox);
  const eHead = et.find((t) => has(t.node, "dm-head")), eSearch = et.find((t) => has(t.node, "dm-search")), eList = et.find((t) => has(t.node, "dm-list"));
  ok(!!eHead && !!eSearch && !!eList && !eHead.node.querySelector(".panel-lock-btn") && !eHead.node.querySelector(".dm-clear"),
    "E PREMISE — DMs' pane with no conversation: its heading line holds neither the lock nor Clear list; then its search box, its list", et.map((t) => String(t.node.className)));
  const eBar = eSearch ? paneTop(w.refs.dm, w.refs.dmBox) + eSearch.top : null;
  const eFirst = eList ? paneTop(w.refs.dm, w.refs.dmBox) + eList.top : null;
  ok(eHead && eHead.height === 30, "E: THE HEADING LINE KEEPS THE LOCK'S 30 PX WITH NOTHING IN IT", eHead && { h: eHead.height, minHeight: decl(eHead.node, "min-height") });
  ok(eBar !== null && eBar === pBar, "E: SO THE SEARCH BOX SITS ON PEOPLE'S INVITE LINE — with the list empty, as with conversations", { people: pBar, dmsEmpty: eBar, dmsFull: dBar });
  ok(eFirst !== null && eFirst === pFirst, "E: AND THE FIRST THING UNDER IT ON PEOPLE'S FIRST ROW", { people: pFirst, dmsEmpty: eFirst });
  // Nothing else: the rule is the room's DM tab's list only.
  // Every rule that holds a heading line open (`min-height`) and names `.dm-head`, by its selector.
  const heads = sheet.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.split("{")).filter((x) => x.length === 2 && /\.dm-head\b/.test(x[0]) && /min-height/.test(x[1]))
    .map((x) => x[0].trim().replace(/\s+/g, " "));
  const rule = heads.length === 1 && heads[0] === ".dm > .dm-box:not(.dm-convo) > .dm-head";
  ok(rule, "E: AND ONLY THERE — one rule for the room's DM tab's list (`.dm > .dm-box:not(.dm-convo) > .dm-head`); the lobby's Messages box and an open conversation keep their heading as it was", heads);
}

// ── W — AT EVERY WIDTH ──
const media = (sheet.match(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) || []);
const touched = media.filter((m) => /\.(roster|invite-row|invite-input|active-box|active-top|dm-box|dm-head|dm-search|dm-list|panel-lock-btn|dm-clear|roster-box)\b/.test(m));
ok(media.length > 0 && touched.length === 0, "W: NO @media RULE TOUCHES EITHER TAB'S LINES — the desktop's tops are the phone's", { media: media.length, touched });

if (failed) { console.log("[panel-tops] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[panel-tops] PASS — People and DMs lined up (`ddjp_699`, JOB 4; " + asserts + " assertions): from each tab's top, People's invite box and DMs' " +
  "search box at the same height (" + pBar + " px), the first person and the first conversation at the same height (" + pFirst + " px) — People's invite " +
  "row takes the 8 px DMs' lock line gives its search; with no conversation DMs' heading line keeps its 30 px (`ddjp_700`), so its search and " +
  "list sit on People's line too; People's heading line and DMs' whole tab as at 698; no @media rule touches them. Chromium " +
  "measured both tabs at desktop and phone width (the report)");
process.exit(0);
