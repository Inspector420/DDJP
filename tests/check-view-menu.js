// tests/check-view-menu.js
// SUBJECT: ui/shell.js, index.html
// WALL: the view menu (⊞ beside the room name: Wide, Compact, Phone) opens just under its button, its LEFT edge at the
// button's left edge, so it reaches to the right; if that would pass the window's right edge it moves left just enough to end
// 8 px inside; it never passes the left edge; resized while open, it is placed again and stays inside; choosing an option or
// clicking outside closes it, as before (J134, the owner's: "also the menu to pick the view mode of the app opens to the left
// and in the past i saw it out of screen, can we make sure its to the right of the button and or cant act weird").
//
// DRIVEN: the REAL `_buildLayoutSelector`, `_setLayout`, `_fitHeader`, `LAYOUTS` and (when the tree has it) `_placeLayoutMenu`
// with its two constants are extracted from ui/shell.js and run over a small DOM double whose button this guard puts where
// Chromium measured it. MODELLED: where the menu lands is computed from the sheet's OWN `.layout-menu` declarations
// (`position`, `top`, `left`, `right`, `min-width`, `max-width`) and the inline `left`/`top` the code wrote, as CSS places a
// box — absolute against the selector (which wraps the button), fixed against the window. So the same rows read the old
// sheet's leftward menu and the new one's. The numbers agree with Chromium's (360, 390 and 1400 px, three room names, J134's
// entry); THIS GUARD CANNOT SEE A REAL LAYOUT — the header's own fit, the fonts, the menu's natural width are a browser's.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ROOT } = require("./_load");
const P = require("./_probe-j14-card.js");
const { readSheet } = require("./_screen-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[view-menu] FAIL — " + msg); if (got !== undefined) console.log("      got " + JSON.stringify(got)); }
  return !!c;
}
const near = (a, b, tol) => typeof a === "number" && isFinite(a) && Math.abs(a - b) <= (tol === undefined ? 1 : tol);

// ── THE SOURCES ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const SHELL = "ui/shell.js";
const shellSrc = fs.readFileSync(path.join(ROOT, SHELL), "utf8");
const grab = (name, need) => {
  const x = P.extractNamed(SHELL, name);
  if (need) ok(x.ok, "APPLIED — `" + name + "` is extractable from " + SHELL, x.stage);
  return x.ok ? x.source : "";
};
const SRC = {
  layouts: grab("LAYOUTS", true), build: grab("_buildLayoutSelector", true), setLayout: grab("_setLayout", true), fit: grab("_fitHeader", true),
  place: grab("_placeLayoutMenu", false),   // J134's; absent from a tree before it, and then the rows below say what the old menu did
  consts: (shellSrc.match(/^\s*const LAYOUT_MENU_[A-Z]+ = [^;\n]+;/gm) || []).join("\n"),
};

// ── THE SHEET'S MENU RULE, AND CSS LENGTHS AS THE MENU'S RULE WRITES THEM ───────────────────────────────────────────────
const sheet = readSheet(fs.readFileSync(path.join(ROOT, "index.html"), "utf8"));
const menuRules = sheet.filter((r) => r.sel === ".layout-menu");
ok(menuRules.length === 1, "PREMISE — the sheet has exactly one `.layout-menu` rule", menuRules.length);
const decl = (k) => { const r = menuRules[0]; return r && r.decls[k] ? r.decls[k].val : undefined; };
function splitTop(s) { const out = []; let d = 0, cur = ""; for (const ch of s) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; }
function len(v, vw) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  let m;
  if ((m = /^min\((.*)\)$/.exec(s))) return Math.min(...splitTop(m[1]).map((x) => len(x, vw)));
  if ((m = /^max\((.*)\)$/.exec(s))) return Math.max(...splitTop(m[1]).map((x) => len(x, vw)));
  if ((m = /^calc\((.*)\)$/.exec(s))) {
    const terms = m[1].replace(/\s+/g, " ").trim().split(/ (?=[+-] )/);
    let total = 0;
    for (const t of terms) { const mm = /^([+-] )?(-?[\d.]+)(px|vw)$/.exec(t.trim()); if (!mm) return NaN; const n = parseFloat(mm[2]) * (mm[3] === "vw" ? vw / 100 : 1); total += (mm[1] && mm[1][0] === "-") ? -n : n; }
    return total;
  }
  if ((m = /^(-?[\d.]+)px$/.exec(s))) return parseFloat(m[1]);
  if (s === "0") return 0;
  return NaN;   // "auto", or a form this model does not read
}

// ── THE WORLD ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// The button is where Chromium measured it (30 × 28 px); the menu's natural width is under its min-width, as measured (the
// min-width decides it: 220 px at every width Chromium drove).
const BTN_W = 30, BTN_H = 28, BTN_TOP = 20, NATURAL_W = 200, MENU_H = 150;
function world(o) {
  const st = { vw: o.vw, btnLeft: o.btnLeft, win: {}, doc: {}, applied: [] };
  const btnRect = () => ({ left: st.btnLeft, right: st.btnLeft + BTN_W, top: BTN_TOP, bottom: BTN_TOP + BTN_H, width: BTN_W, height: BTN_H, x: st.btnLeft, y: BTN_TOP });
  // CSS: min-width beats max-width, and both bound the natural width.
  const menuW = () => { const mn = len(decl("min-width"), st.vw), mx = len(decl("max-width"), st.vw);
    let w = NATURAL_W; if (isFinite(mx)) w = Math.min(w, mx); if (isFinite(mn)) w = Math.max(w, mn); return w; };
  function placed(menu) {
    const pos = decl("position"), w = menuW();
    const val = (k) => (menu.style[k] !== undefined && menu.style[k] !== "") ? menu.style[k] : decl(k);
    const L = len(val("left"), st.vw), R = len(val("right"), st.vw), T = len(val("top"), st.vw);
    let left, top;
    if (pos === "fixed") { left = isFinite(L) ? L : (isFinite(R) ? st.vw - R - w : NaN); top = T; }
    else if (pos === "absolute") { const b = btnRect(); left = isFinite(L) ? b.left + L : (isFinite(R) ? b.right - R - w : b.left); top = b.top + (isFinite(T) ? T : 0); }
    else { left = NaN; top = NaN; }
    return { left, right: left + w, top, bottom: top + MENU_H, width: w, height: MENU_H, x: left, y: top };
  }
  function node(tag) {
    const n = { tag, style: {}, children: [], className: "", attrs: {}, textContent: "", onclick: null,
      setAttribute(k, v) { this.attrs[k] = String(v); }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      getBoundingClientRect() {
        if (/\blayout-btn\b/.test(this.className) || /\blayout-selector\b/.test(this.className)) return btnRect();
        if (/\blayout-menu\b/.test(this.className) && !/item/.test(this.className)) return placed(this);
        return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
      } };
    return n;
  }
  const el = (tag, props, children) => { const n = node(tag);
    for (const k in (props || {})) { if (k === "class") n.className = props[k]; else if (k === "text") n.textContent = props[k]; else n.setAttribute(k, props[k]); }
    for (const c of (children || [])) if (c) n.appendChild(c);
    return n; };
  const header = { scrollWidth: 100, clientWidth: 100 };
  const ctx = {
    refs: { mainHeader: header }, el, console, Math, __st: st,
    ChatPrefs: { setLayout() {} },
    window: { get innerWidth() { return st.vw; }, addEventListener(t, f) { (st.win[t] = st.win[t] || []).push(f); } },
    document: { documentElement: { get clientWidth() { return st.vw; } }, addEventListener(t, f) { (st.doc[t] = st.doc[t] || []).push(f); } },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC.layouts + "\nlet layoutMode = \"wide\";\nlet _layoutMenuCloserWired = false;\nconst _headerFit = { level: 0, fullId: \"\" };\n" +
    "function _applyLayout() { __st.applied.push(layoutMode); }\nfunction _applyHeaderLevel(n) {}\n" + SRC.consts + "\n" + SRC.place + "\n" +
    SRC.setLayout + "\n" + SRC.build + "\n" + SRC.fit + "\n;globalThis.__x = { _buildLayoutSelector, _fitHeader };", ctx);
  const sel = ctx.__x._buildLayoutSelector();
  const btn = sel.children.find((c) => /\blayout-btn\b/.test(c.className)), menu = sel.children.find((c) => /\blayout-menu\b/.test(c.className));
  const ev = { stopPropagation() {} };
  return {
    st, sel, btn, menu,
    open() { btn.onclick(ev); },
    resize(vw, btnLeft) { st.vw = vw; if (btnLeft !== undefined) st.btnLeft = btnLeft; (st.win.resize || []).forEach((f) => f()); },
    headerFit(btnLeft) { st.btnLeft = btnLeft; ctx.__x._fitHeader(); },   // the header's own fit, after a resize, moving the button
    outside() { (st.doc.click || []).forEach((f) => f()); },
    pick(i) { menu.children[i].onclick(ev); },
    shown: () => menu.style.display !== "none",
    // THE ADMISSIBILITY GATE: a reading is admitted only of an OPEN menu whose box and button are numbers.
    measure() {
      const m = menu.getBoundingClientRect(), b = btn.getBoundingClientRect();
      const why = [];
      if (menu.style.display === "none") why.push("the menu is closed");
      if (![m.left, m.right, m.top, b.left, b.bottom].every((v) => typeof v === "number" && isFinite(v))) why.push("a box is not a number");
      return { admitted: !why.length, why, m, b, vw: st.vw };
    },
  };
}
// The rule the owner asked for, as settled in J134's entry: from the button's left edge, moved left only as far as it must to
// end 8 px inside the right edge, never closer than 8 px to the left edge; 6 px under the button.
const want = (r) => Math.max(8, Math.min(r.b.left, r.vw - 8 - r.m.width));
const box = (r) => r && r.m ? { btn: [r.b.left, r.b.right], menu: [Math.round(r.m.left * 100) / 100, Math.round(r.m.right * 100) / 100], top: r.m.top, vw: r.vw, why: r.why } : r;
function part(name, f) { try { f(); } catch (e) { ok(false, name + " — the part threw: " + (e && e.message || e)); } }

// ═══ PART Z — THE GATE, BOTH WAYS ══════════════════════════════════════════════════════════════════════════════════════
part("Z", () => {
  const w = world({ vw: 360, btnLeft: 108.91 });
  ok(!w.measure().admitted && /closed/.test(w.measure().why.join()), "Z: THE GATE REFUSES A CLOSED MENU — nothing is read of a menu nobody sees", box(w.measure()));
  w.open();
  ok(w.measure().admitted, "Z: AND ADMITS THE SAME MENU OPEN", box(w.measure()));
  const bad = world({ vw: 360, btnLeft: NaN }); bad.open();
  ok(!bad.measure().admitted, "Z: and refuses a reading whose boxes are not numbers", box(bad.measure()));
});

// ═══ PART A — under the button, its left edge at the button's left edge, reaching right ════════════════════════════════
part("A", () => {
  const w = world({ vw: 360, btnLeft: 108.91 });   // a room named "a", phone, 360 px (Chromium)
  w.open();
  const r = w.measure();
  ok(r.admitted, "A PREMISE — the menu opened and was read", box(r));
  ok(near(r.m.left, r.b.left), "A: A SHORT NAME AT 360 PX — THE MENU'S LEFT EDGE IS THE BUTTON'S LEFT EDGE (it opened leftward, 81 px off the screen)", box(r));
  ok(r.m.right > r.b.right && r.m.left >= 0, "A: so it reaches to the right of the button, and starts on the screen", box(r));
  ok(near(r.m.top, r.b.bottom + 6), "A: 6 px under the button", box(r));
  const w2 = world({ vw: 1400, btnLeft: 359.55 });   // the long name, wide, 1400 px (Chromium)
  w2.open(); const r2 = w2.measure();
  ok(r2.admitted && near(r2.m.left, r2.b.left), "A: A LONG NAME AT 1400 PX — room to the right, so at the button's left edge, unmoved", box(r2));
});

// ═══ PART B — past the right edge, moved left just enough: 8 px inside ═══════════════════════════════════════════════
part("B", () => {
  for (const [label, vw, left] of [["\"Friday night\" at 360 px", 360, 191.56], ["\"Friday night at the club downtown\" at 390 px", 390, 288.44]]) {
    const w = world({ vw, btnLeft: left }); w.open(); const r = w.measure();
    ok(r.admitted, "B PREMISE — " + label + ": the menu opened and was read", box(r));
    ok(near(r.m.right, vw - 8), "B: " + label + " — FROM THE BUTTON IT WOULD PASS THE RIGHT EDGE, SO IT ENDS 8 PX INSIDE IT", box(r));
    ok(near(r.m.left, want(r)) && r.m.left < r.b.left, "B: moved left just that much, no more", box(r));
  }
});

// ═══ PART C — never past the left edge ═══════════════════════════════════════════════════════════════════════════════
part("C", () => {
  const w = world({ vw: 360, btnLeft: 3 }); w.open(); const r = w.measure();
  ok(r.admitted && r.m.left >= 8 && near(r.m.left, 8), "C: A BUTTON AT THE WINDOW'S LEFT EDGE — THE MENU STAYS 8 PX INSIDE IT", box(r));
  const n = world({ vw: 200, btnLeft: 100 }); n.open(); const rn = n.measure();
  ok(rn.admitted && rn.m.left >= 8 && rn.m.right <= 200 - 8 + 1, "C: A WINDOW NARROWER THAN THE MENU — IT NARROWS TO THE WINDOW LESS 16 PX AND PASSES NEITHER EDGE", box(rn));
});

// ═══ PART D — resized while open: placed again, inside, and after the header's fit, at the button again ═══════════════
part("D", () => {
  const w = world({ vw: 390, btnLeft: 288.44 }); w.open();
  ok(w.measure().admitted, "D PREMISE — open at 390 px with the long name", box(w.measure()));
  w.resize(330, 135.59);   // narrower: the header's fit has shrunk the name, the button is further left (Chromium)
  let r = w.measure();
  ok(w.shown() ? (r.m.left >= 8 && r.m.right <= 330 - 8 + 1) : true, "D: NARROWED WHILE OPEN, IT STAYS INSIDE (OR CLOSES)", box(r));
  ok(w.shown() && near(r.m.left, want(r)), "D: placed again from where the button is now", box(r));
  w.resize(390);            // wider again: the resize comes first, with the button still where the narrow fit left it …
  w.headerFit(288.44);      // … then the header's own fit grows the name back and moves the button right
  r = w.measure();
  ok(w.shown() && near(r.m.left, want(r)) && r.m.right <= 390 - 8 + 1, "D: AND WHEN THE HEADER'S FIT MOVES THE BUTTON AFTER THE RESIZE, THE OPEN MENU FOLLOWS IT", box(r));
  const c = world({ vw: 390, btnLeft: 288.44 });
  const before = JSON.stringify(c.menu.style);
  c.resize(330, 135.59); c.headerFit(135.59);
  ok(JSON.stringify(c.menu.style) === before && !c.shown(), "D: a CLOSED menu is left alone by a resize and a fit — nothing written, still closed", { before, after: c.menu.style });
});

// ═══ PART E — choosing an option and clicking outside close it, as before; reopened, it is placed afresh ══════════════
part("E", () => {
  const w = world({ vw: 360, btnLeft: 108.91 });
  w.open(); ok(w.shown(), "E PREMISE — the button opens it");
  w.pick(1);
  ok(!w.shown() && w.st.applied[w.st.applied.length - 1] === "compact", "E: CHOOSING AN OPTION APPLIES IT AND CLOSES THE MENU", { shown: w.shown(), applied: w.st.applied });
  w.open(); ok(w.shown(), "E: it opens again");
  w.outside();
  ok(!w.shown(), "E: A CLICK OUTSIDE CLOSES IT");
  w.st.btnLeft = 191.56; w.open();
  const r = w.measure();
  ok(r.admitted && near(r.m.left, want(r)), "E: REOPENED WITH THE BUTTON MOVED, IT IS PLACED FROM WHERE THE BUTTON IS NOW", box(r));
  w.open();
  ok(!w.shown(), "E: and the button closes it again, as before");
});

// ═══ PART F — the sheet (DECLARED) ═══════════════════════════════════════════════════════════════════════════════════
part("F", () => {
  ok(decl("position") === "fixed", "F: THE MENU IS FIXED TO THE WINDOW — placed from the button's box, not from the header's (it was absolute inside the selector)", decl("position"));
  ok(decl("right") === undefined, "F: and declares no `right` — nothing anchors it to the button's right edge any more", decl("right"));
  ok(len(decl("max-width"), 360) === 344 && len(decl("min-width"), 200) <= 184, "F: never wider than the window less 16 px — its minimum width yields to a narrow window", { max: decl("max-width"), min: decl("min-width") });
});

if (failed) { console.log("[view-menu] " + failed + " failure(s) of " + asserts); process.exit(1); }
console.log("[view-menu] PASS — the view menu stays on screen, reaching right (" + asserts + " assertions; J134, the owner's: \"can we make sure " +
  "its to the right of the button and or cant act weird\"). The real `_buildLayoutSelector`, `_placeLayoutMenu`, `_setLayout` and `_fitHeader`, " +
  "with the sheet's own `.layout-menu`: opened under the button with its left edge at the button's (a short name at 360 px, a long one at 1400); " +
  "moved left just enough to end 8 px inside when it would pass the right edge (\"Friday night\" at 360, a long name at 390); never past the " +
  "left edge, a narrow window narrowing it; placed again when the window is resized while it is open and again when the header's fit moves the " +
  "button; left alone while closed; closed by a choice, a click outside or the button, and placed afresh when reopened. The gate refuses a " +
  "closed menu and an unreadable box. THIS GUARD CANNOT SEE A REAL LAYOUT — Chromium measured it");
process.exit(0);
