#!/usr/bin/env node
// tests/check-lobby-top.js
// SUBJECT: index.html
//
// WALL: THE ROOM LIST'S TOP ROW FITS A PHONE (the owner's "ok", `ddjp_691`). Found at `ddjp_690`: at 390 px the lobby's top row —
// the title, the ID, Messages, Accounts, Log out — ran past the screen (447 px wide with a short ID, 606 with a long one, in
// Chromium; the title squeezed to 81 × 56, Log out to 57 × 54). Shown to him: the row wrapping, the title on its own line and the
// ID and the buttons under it. His answer: "ok". So the row is a class with a narrow-screen rule, and nothing is hidden.
//
// What this guard reads, and all it claims (the page's own sheet, through `tests/_page-css.js` and the screen world's cascade;
// no layout — the pixels are measured in Chromium, at 390 × 844 and 1400 × 900, and reported with the package):
//   A  THE MARKUP: the room list's top row is `.rooms-top`, holding the title and `.rooms-top-acts`; that holds the ID's slot
//      `#rooms-identity.rooms-top-id` and Messages, Accounts and Log out — every one of them still there, none hidden — and
//      none of the three boxes carries an inline style (an inline style beats the class, and was the 690 row).
//   B  THE SHEET, by the cascade: the row is a flex row that wraps; its buttons' group wraps and may shrink; the ID's slot may
//      shrink to the screen and no further than it.
//   C  THE NARROW RULE: under `@media (max-width: 600px)` the row stacks — `flex-direction: column`, `align-items: flex-start` —
//      so the title has its own line and the ID and the buttons sit under it.
// RED FIRST ON 690: the row is three inline-styled boxes with no class and no narrow rule — A, B and C each refuse.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { styleBlocks } = require("./_page-css.js");
const { mk, readSheet, makeCascade } = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[lobby-top] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// ── A — THE MARKUP ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The room list's screen, from its opening tag to the create section, comments removed (they sit between elements here).
const at = html.indexOf('<div id="screen-rooms"'), end = html.indexOf('id="create-room-section"', at);
const top = at >= 0 && end > at ? html.slice(at, end).replace(/<!--[\s\S]*?-->/g, "") : "";
ok(!!top, "A: the room list's screen and its create section are where they were", { at, end });
const tags = [];
top.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_, close, tag, attrs) => { tags.push({ close: !!close, tag: tag.toLowerCase(), attrs }); return ""; });
const attr = (t, name) => { const m = new RegExp("\\b" + name + "\\s*=\\s*\"([^\"]*)\"").exec(t.attrs); return m ? m[1] : null; };
const hasClass = (t, c) => (" " + (attr(t, "class") || "") + " ").indexOf(" " + c + " ") >= 0;
// Nesting, from the tag stream (void elements are not in this slice).
let depth = 0;
const open = tags.filter((t) => !t.close);
for (const t of tags) { if (t.close) depth--; else { t.depth = depth; depth++; } }
const row = open.find((t) => t.depth === 1);
ok(row && row.tag === "div" && hasClass(row, "rooms-top"), "A: THE TOP ROW IS `.rooms-top` (the screen's first box)", row && row.attrs);
const kids = open.filter((t) => t.depth === 2);
const acts = kids.find((t) => hasClass(t, "rooms-top-acts"));
ok(kids.length === 2 && kids[0].tag === "h2" && acts && kids[1] === acts, "A: it holds the title and `.rooms-top-acts`, in that order", kids.map((t) => t.tag + " " + (attr(t, "class") || "")));
const inActs = open.filter((t) => t.depth === 3);
const ids = inActs.map((t) => attr(t, "id"));
ok(JSON.stringify(ids) === JSON.stringify(["rooms-identity", "btn-lobby-dm", "btn-manage-accounts", "btn-logout"]),
  "A: NOTHING IS HIDDEN OR GONE — the ID's slot, Messages, Accounts, Log out, in that order", ids);
const idSlot = inActs.find((t) => attr(t, "id") === "rooms-identity");
ok(idSlot && hasClass(idSlot, "rooms-top-id"), "A: the ID's slot is `.rooms-top-id`", idSlot && idSlot.attrs);
const styled = [row, acts, idSlot].filter((t) => t && attr(t, "style") !== null).map((t) => t.attrs.trim());
ok(row && acts && idSlot && styled.length === 0, "A: NONE OF THE THREE CARRIES AN INLINE STYLE (it would beat the class)", styled);
const hidden = inActs.filter((t) => /\bhidden\b/.test(t.attrs) || /display\s*:\s*none/.test(attr(t, "style") || ""));
ok(hidden.length === 0, "A: no button and no slot is hidden in the markup", hidden.map((t) => t.attrs));

// ── B — THE SHEET, BY THE CASCADE ──────────────────────────────────────────────────────────────────────────────────────────
const cas = makeCascade(readSheet(html));
const build = (tag, cls, parent) => { const n = mk(tag); n.className = cls; if (parent) { n.parent = parent; parent._kids.push(n); } return n; };
const nRow = build("div", "rooms-top"), nActs = build("div", "rooms-top-acts", nRow), nId = build("span", "rooms-top-id", nActs);
nId.id = "rooms-identity";
const val = (n, p) => { const d = cas.declared(n, p); return d ? d.val : null; };
ok(val(nRow, "display") === "flex" && val(nRow, "flex-wrap") === "wrap" && val(nRow, "justify-content") === "space-between",
  "B: THE ROW IS A FLEX ROW THAT WRAPS, its ends apart on a wide screen", { display: val(nRow, "display"), wrap: val(nRow, "flex-wrap"), justify: val(nRow, "justify-content") });
ok(val(nActs, "display") === "flex" && val(nActs, "flex-wrap") === "wrap" && val(nActs, "min-width") === "0",
  "B: THE BUTTONS' GROUP WRAPS and may shrink", { display: val(nActs, "display"), wrap: val(nActs, "flex-wrap"), min: val(nActs, "min-width") });
ok(val(nId, "display") === "flex" && val(nId, "min-width") === "0" && val(nId, "max-width") === "100%",
  "B: THE ID'S SLOT MAY SHRINK TO THE SCREEN and no further than it", { display: val(nId, "display"), min: val(nId, "min-width"), max: val(nId, "max-width") });

// ── C — THE NARROW RULE ────────────────────────────────────────────────────────────────────────────────────────────────────
// Every `@media (max-width: N px)` block with N at least the phone's 390, read as text from the page's own style blocks.
const narrow = [];
for (const block of styleBlocks(html)) {
  const css = block.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    let d = 1, j = re.lastIndex;
    for (; j < css.length && d; j++) { if (css[j] === "{") d++; else if (css[j] === "}") d--; }
    narrow.push({ width: +m[1], body: css.slice(re.lastIndex, j - 1) });
  }
}
const rule = (body, sel) => { const m = new RegExp("(^|[}\\s,])" + sel.replace(/\./g, "\\.") + "\\s*\\{([^}]*)\\}").exec(body); return m ? m[2] : null; };
const stack = narrow.filter((x) => x.width >= 390).map((x) => ({ width: x.width, decl: rule(x.body, ".rooms-top") })).filter((x) => x.decl);
ok(stack.length === 1 && /flex-direction\s*:\s*column/.test(stack[0].decl) && /align-items\s*:\s*flex-start/.test(stack[0].decl),
  "C: UNDER A NARROW-SCREEN RULE THE ROW STACKS — the title on its own line, the ID and the buttons under it", stack);
ok(stack.length === 1 && stack[0].width >= 390 && stack[0].width < 1400, "C: the rule takes a phone (390 px) and not a wide screen (1400 px)", stack.map((x) => x.width));

if (failed) { console.log("[lobby-top] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[lobby-top] PASS — the room list's top row fits a phone (the owner's \"ok\", `ddjp_691`; " + asserts + " assertions): " +
  "the row is `.rooms-top` holding the title and `.rooms-top-acts` (the ID's slot `.rooms-top-id`, Messages, Accounts, Log out — " +
  "none hidden, none inline-styled); by the cascade it is a flex row that wraps, its group wraps and may shrink, the ID's slot " +
  "shrinks to the screen; under `@media (max-width: 600px)` it stacks, title first. The pixels are Chromium's, in the package's report.");
