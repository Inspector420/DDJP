// tests/check-settings-info.js
// SUBJECT: ui/settings.js, index.html
// WALL: ROOM SETTINGS' ⓘ IN PLACE OF "MORE" (`ddjp_702`, JOB 4; the owner's: "then in room settings all the more text buttont ake space
// maybe it could jsut be a i in circle button next to the title of the element like show advence options i or who can join i"; his
// words in `main/04-features.md` §Room settings panel).
//   I  EVERY ROW THAT HAD MORE HAS ⓘ, AND ONLY THOSE — the panel drawn whole (the advanced rows on, every card open): each explanation
//      a row keeps is behind an ⓘ; a row with nothing to explain has none; no "More" and no "Less" anywhere.
//   P  ON THE TITLE'S LINE, RIGHT AFTER THE TITLE — "Who can join ⓘ", "Show advanced options ⓘ": the ⓘ is the title's next sibling,
//      inside the part of the row that holds the title (the title line, or the check row's label).
//   T  TAPPED, THE SAME EXPLANATION UNDER THE TITLE; TAPPED AGAIN, GONE — `aria-expanded` says which; the explanation is the row's
//      next part after the title's, before its control.
//   L  ITS LOOK (DECLARED) — about 16 px, round, a thin border, the link's blue, an italic i; on the title line it keeps to the title
//      (its own margin takes the free space, so a value still ends at the right edge).
// DRIVEN on the REAL ui/settings.js over the screen world's DOM double (`tests/_screen-world.js`: `insertBefore` and siblings as a
// browser has them), the room's settings the engine's own defaults; the sheet read as a browser reads it. The pixels are Chromium's
// (`702-REPORT.md`: the ⓘ 16 × 16 right after "Show advanced options", its words under it when open).
// RED FIRST ON 701: every row ends in a "More" link, and its words go at the row's end.
"use strict";
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const SW = require(path.join(__dirname, "_screen-world.js"));
const { loadInContext, ROOT } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[settings-info] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const cls = (n) => String((n && n.className) || "");
const has = (n, c) => cls(n).split(/\s+/).indexOf(c) >= 0;
const flat = (k) => [k].concat(...Array.from((k && k.children) || []).filter((c) => c.nodeType === 1).map(flat));
const kidsOf = (n) => Array.from((n && n.children) || []).filter((c) => c.nodeType === 1);

// The engine's own settings and ranges (the room as the panel reads it), and the bot engine's idle list.
const BE = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"], { Date, Math, JSON });
const settings = BE.StateDeriver.defaultSettings();
let adv = true;
const features = {
  Room: { rankLadder: () => BE.Ranks.LADDER.map((r) => ({ name: r.name, level: r.level })), getMyId: () => "@own:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }),
    getRoster: () => [], getMyRank: () => 99, getMyAuthorityLevel: () => 100, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {},
    peopleOrder: () => [], getSettings: () => settings, getSettingRanges: () => BE.StreamManager.settingRanges(),
    getSettingRows: () => BE.Ranks.LADDER.map((r) => ({ name: r.name, editable: r.name !== "uncategorized" })), editSettingTable: () => null,
    idleSettings: () => [], overrideFromFile: async () => ({ ok: true }) },
  Actions: { ACTIONS: [], describe: () => ({ enabled: true, reason: null }), perform: async () => ({ ok: true }) },
  BotRuntime: { botInRoom: () => false },
  BotSettings: { decide: () => ({ ok: false }), request: async () => ({ ok: true }) },
  Media: { safeBgUrl: () => null, getAvatarUrl: () => null },
  ChatPrefs: { layout: () => "wide", setLayout: () => {}, bgOpts: () => ({ bgOn: true, hostAllowed: () => true }), advancedShown: () => adv, setAdvancedShown: (v) => { adv = !!v; } },
};
const w = SW.world({ features, domShaped: true });
try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Settings room" }); } catch (e) { /* a stand-in not scripted */ }
const decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
const box = () => w.refs.settingsBox;
let threw = null;
const render = () => { try { w.sb.Settings.renderSettings(); } catch (e) { threw = threw || e.message; } };
render();
// Every card and sub-card open, as a person would open them.
for (let pass = 0; pass < 60; pass++) {
  const closed = flat(box()).filter((n) => /\bset-(sec|sub)-head\b/.test(cls(n)) && n.getAttribute && n.getAttribute("aria-expanded") === "false");
  if (!closed.length) break;
  try { closed[0].onclick(); } catch (e) { threw = threw || e.message; }
}
ok(threw === null, "APPLIED — the real panel drew (" + threw + ")");
const rowOf = (n) => { let p = n; while (p && p !== box() && !has(p, "set-row") && !has(p, "set-adv-toggle") && !has(p, "set-check-row")) p = p.parentNode; return p === box() ? null : p; };
const infos = () => flat(box()).filter((n) => n.tagName === "BUTTON" && has(n, "set-more"));
const titleOf = (b) => { let t = b ? b.previousSibling : null; while (t && t.nodeType !== 1) t = t.previousSibling; return t; };

// ── I — EVERY ROW THAT HAD MORE HAS ⓘ ──
const all = infos();
ok(all.length >= 10, "I PREMISE — the panel drew many rows with an explanation (every card open, the advanced rows on)", all.length);
ok(all.every((b) => has(b, "set-info") && b.textContent === "i"), "I: EACH IS AN ⓘ — `set-info`, its one word \"i\"", all.map((b) => [cls(b), b.textContent]).slice(0, 4));
const words = flat(box()).filter((n) => kidsOf(n).length === 0).map((n) => n.textContent);
ok(!words.some((t) => t === "More" || t === "Less"), "I: NO \"More\" AND NO \"Less\" ANYWHERE IN THE PANEL", words.filter((t) => t === "More" || t === "Less"));
const rowsWith = new Set(all.map(rowOf).filter(Boolean));
const keyed = flat(box()).filter((n) => has(n, "set-row") && n.getAttribute && n.getAttribute("data-key"));
const without = keyed.filter((r) => !rowsWith.has(r));
// A row with nothing to explain has none: the panel's own source decides which rows have words (`_rowMore` with nothing to say returns).
ok(all.length === rowsWith.size, "I: ONE ⓘ A ROW — never two", { info: all.length, rows: rowsWith.size });
ok(without.every((r) => !flat(r).some((n) => has(n, "set-more-text"))), "I: A ROW WITHOUT ⓘ SHOWS NO EXPLANATION", without.map((r) => r.getAttribute("data-key")));

// ── P — ON THE TITLE'S LINE, RIGHT AFTER THE TITLE ──
const placed = all.map((b) => { const t = titleOf(b); return { title: t && has(t, "set-label") ? t.textContent : null, holder: cls(b.parentNode) }; });
ok(placed.every((x) => x.title), "P: EVERY ⓘ COMES RIGHT AFTER ITS ROW'S TITLE — the title's next element", placed.filter((x) => !x.title).slice(0, 4));
ok(placed.every((x) => /\b(set-title-line|pref-master-row)\b/.test(x.holder)), "P: ON THE TITLE'S LINE — inside the title line, or the check row's label", Array.from(new Set(placed.map((x) => x.holder))));
const byTitle = (t) => infos().find((b) => { const x = titleOf(b); return x && x.textContent === t; });   // drawn now, not as first drawn
const who = byTitle("Who can join"), advB = byTitle("Show advanced options");
ok(!!who && !!advB, "P: \"Who can join ⓘ\" AND \"Show advanced options ⓘ\" — the owner's two", { who: !!who, adv: !!advB, titles: placed.map((x) => x.title).slice(0, 6) });

// ── T — TAPPED, UNDER THE TITLE; TAPPED AGAIN, GONE ──
const tap = (title) => { const b = byTitle(title); if (b) b.onclick({ preventDefault() {} }); return byTitle(title); };
const textOf = (b) => { const r = rowOf(b); return r ? flat(r).filter((n) => has(n, "set-more-text")) : []; };
for (const title of ["Show advanced options", "Who can join"]) {
  const before = byTitle(title);
  ok(before && before.getAttribute("aria-expanded") === "false" && textOf(before).length === 0, "T: " + title + " — closed, nothing under it", before && before.getAttribute("aria-expanded"));
  const open = tap(title);
  const t = open ? textOf(open) : [];
  const holder = open ? open.parentNode : null;
  ok(!!open && open.getAttribute("aria-expanded") === "true" && t.length === 1 && t[0].textContent.length > 20, "T: " + title + " — TAPPED, ITS EXPLANATION SHOWS, aria-expanded true",
    { exp: open && open.getAttribute("aria-expanded"), text: t.map((x) => x.textContent) });
  ok(!!holder && t.length === 1 && holder.nextSibling === t[0], "T: " + title + " — UNDER THE TITLE: the row's next part after the title's", { next: holder && cls(holder.nextSibling) });
  const closed = tap(title);
  ok(!!closed && closed.getAttribute("aria-expanded") === "false" && textOf(closed).length === 0, "T: " + title + " — TAPPED AGAIN, GONE", closed && closed.getAttribute("aria-expanded"));
}
// The check row's ⓘ sits in its <label>: a tap there is the ⓘ's alone, it never ticks the box (its default is prevented).
{
  const b = byTitle("Show advanced options");
  let prevented = false;
  if (b) b.onclick({ preventDefault() { prevented = true; } });
  ok(prevented, "T: in a check row's label, the ⓘ's tap prevents the label's own (it never ticks the box)", prevented);
  if (b) tap("Show advanced options");
}

// ── L — ITS LOOK ──
{
  const b = byTitle("Show advanced options"), line = byTitle("Who can join");
  ok(decl(b, "width") === "16px" && decl(b, "height") === "16px" && decl(b, "border-radius") === "50%" && /^1px solid/.test(decl(b, "border") || "") && decl(b, "font-style") === "italic",
    "L: ABOUT 16 PX, ROUND, A THIN BORDER, AN ITALIC i (DECLARED)", { w: decl(b, "width"), r: decl(b, "border-radius"), b: decl(b, "border"), fs: decl(b, "font-style") });
  ok(decl(b, "color") === "#9aa4ff", "L: THE LINK'S BLUE (the More link's own colour, DECLARED)", decl(b, "color"));
  ok(!!line && has(line.parentNode, "set-title-line") && /\bauto\b/.test(decl(line, "margin") || ""), "L: on the title line it keeps to the title — its own margin takes the free space (DECLARED)", line && decl(line, "margin"));
}

if (failed) { console.log("[settings-info] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[settings-info] PASS — Room settings' ⓘ in place of More (`ddjp_702`, JOB 4; " + asserts + " assertions): the real panel drawn whole, every " +
  "row with an explanation has one ⓘ, right after its title on the title's line (\"Who can join ⓘ\", \"Show advanced options ⓘ\"), and no " +
  "\"More\" or \"Less\" is left; tapped, the same explanation shows under the title, aria-expanded true; tapped again, gone; in a check row's label " +
  "it never ticks the box; 16 px, round, thin-bordered, the link's blue, an italic i, keeping to the title. Chromium measured it (the report)");
process.exit(0);
