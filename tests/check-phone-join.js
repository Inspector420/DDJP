// tests/check-phone-join.js
// SUBJECT: ui/roster.js, ui/shell.js, index.html
// WALL: THE PHONE PLAYER'S JOIN / LEAVE (`ddjp_702`, JOB 7; the owner's: "in phone mode we might as well put the join or leave queue buttons
// and lock centered under and bump up the row on its place", then "its good under but i dont like the idea of it being under if it would
// of fit to the left, so, lets only put it under if it dosent fit to the left dynamically AND lets not stretch volume slider more to the
// left"; the supervisor measured 700 at 390 px: Join shrank to "Join", Leave broke onto two lines, so a tap made the row jump).
//   F  IN FULL, IN THE PHONE LAYOUT — "Join the DJ queue" / "Leave the DJ queue", whatever the width; no ladder.
//   U  UNDER, CENTRED, WHERE IT DOES NOT FIT — at 390 px (the row 348 px wide), Join and Leave alike: the row is `pc-under`.
//   B  BESIDE WHERE LEAVE FITS — at a phone layout on a wider window (the row 494 px), Join and Leave alike: beside.
//   J  JUDGED ON THE WIDER STATE — at a width where Join alone fits and Leave with its lock does not, BOTH go under (a tap moves nothing
//      but the button); measured with nothing shrinking (`pc-measure`), and on one line whatever the last placing was, so a second
//      placing gives the same answer (it flip-flopped once while this was built).
//   P  THE MEASURE PUTS EVERYTHING BACK — the label, the lock hidden in Join's state — and leaves no measuring class behind.
//   C  THE CONTROLS KEEP THEIR SIZE AND PLACE (DECLARED) — under, the controls' line keeps the row's place (`order`), the volume group at
//      its right edge, nothing grows; the slider has no rule of its own there (never stretched); the button and lock centred.
//   R  RE-JUDGED LIVE — the one resize hook re-renders the button, and a wider window brings it back beside.
//   K  WIDE AND COMPACT KEEP TODAY'S ROW — the ladder shortens the label, and nothing is placed under.
// DRIVEN: the REAL `renderJoinBtn`, `_placePhoneJoin`, `_fitJoinLabel`, `_wireJoinResize` and the two ladders, extracted from
// ui/roster.js and run over a row whose widths are Chromium's (MODELLED, and only this: "Join the DJ queue" 120.8 px and "Leave the
// DJ queue" 132.4 px with the phone's 8 px padding, the lock 34 px after a 6 px gap, 10 px to the controls, the controls 298 px at
// their own size; a row on one line overflows by what does not fit, unless `pc-measure` is off and the button and slider may shrink).
// Chromium measured the real boxes (`702-REPORT.md`: at 390 the button centred under, the controls' boxes the same in Join and
// Leave; at 720 both beside).
// RED FIRST ON 701: the phone's label steps down the ladder ("Join", "LQ"), and nothing goes under.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const P = require(path.join(__dirname, "_probe-j14-card.js"));
const { readSheet, makeCascade, mk, makeDocument } = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[phone-join] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }
const R = "ui/roster.js";
const pieces = ["_JOIN_LADDER", "_LEAVE_LADDER", "_fitJoinLabel", "_wireJoinResize", "_placePhoneJoin", "renderJoinBtn"].map((n) => {
  const x = P.extractNamed(R, n);
  return { n, ok: x.ok, src: x.ok ? x.source : "", stage: x.stage };
});
const missing = pieces.filter((p) => !p.ok).map((p) => p.n + " (" + p.stage + ")");
ok(missing.length === 0, "APPLIED — the button's declarations are extractable from ui/roster.js", missing);

const W = { "Join the DJ queue": 120.8, "Leave the DJ queue": 132.4 };
const btnW = (t) => (W[t] !== undefined ? W[t] : 16 + 6.6 * String(t).length);
const LOCK = 34, GAP_LOCK = 6, GAP_ROW = 10, CONTROLS = 298, SLIDER_GIVE = 100 - 56;

function world(o) {
  const mode = { v: o.mode || "phone" };
  const st = { active: !!o.active, width: o.width };
  const set = (s) => ({ add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c),
    toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; } });
  const rowCls = new Set(["playback-controls"]), btnCls = new Set(["join-btn"]);
  const lock = { style: { display: "none" } };
  const row = { classList: set(rowCls), get clientWidth() { return st.width; },
    get scrollWidth() {
      if (rowCls.has("pc-under") || rowCls.has("pc-wrap")) return st.width;   // wrapped: the lines fit
      const lockOn = lock.style.display !== "none";
      const need = btnW(btn.textContent) + (lockOn ? GAP_LOCK + LOCK : 0) + GAP_ROW + CONTROLS;
      // Without the measure, the button and slider may shrink (`o.shrink`, the phone worlds): what the measure exists to stop. The
      // ladder's worlds do not shrink, as Chromium's row at 390 px did not (701 overflowed even at "LQ").
      const give = (rowCls.has("pc-measure") || o.shrink === false) ? 0 : btnW(btn.textContent) + SLIDER_GIVE;
      return Math.max(st.width, need - give);
    } };
  const btn = { textContent: "", title: "", disabled: false, classList: set(btnCls), closest: (sel) => (sel === ".playback-controls" ? row : null) };
  const resize = [], timers = [], relocks = [];
  const box = {
    refs: { joinBtn: btn, leaveLockBtn: lock },
    UserQueue: { isActive: () => st.active, stackCount: () => 2, joinRoomQueue() {}, leaveRoomQueue() {} },
    Actions: { describe: () => ({ enabled: true, reason: null }) },
    H: { layoutMode: () => mode.v, _relock: (k) => relocks.push(k), _renderLeaveLock() {} },
    window: { addEventListener: (t, f) => { if (t === "resize") resize.push(f); } },
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {}, console,
  };
  vm.createContext(box);
  vm.runInContext("let _joinResizeWired = false;\n" + pieces.map((p) => p.src).join("\n") + "\n;globalThis.__render = renderJoinBtn;", box);
  const render = () => box.__render();
  return { render, st, mode, rowCls, btn, lock, resize, timers, relocks,
    read: () => ({ label: btn.textContent, title: btn.title, under: rowCls.has("pc-under"), measuring: rowCls.has("pc-measure"), wrap: rowCls.has("pc-wrap"), lock: lock.style.display !== "none" }) };
}

if (!missing.length) {
  // ── F, U — 390 PX ──
  const a = world({ width: 348 });
  a.render(); const j = a.read();
  a.st.active = true; a.render(); const l = a.read();
  ok(j.label === "Join the DJ queue" && l.label === "Leave the DJ queue" && j.title === j.label && l.title === l.label,
    "F: IN FULL — \"Join the DJ queue\" and \"Leave the DJ queue\", no ladder step at 390 px", [j.label, l.label]);
  ok(j.under && l.under && !l.wrap && l.lock && !j.lock, "U: AT 390 PX, UNDER — Join and Leave alike (Leave with its lock)", { join: j, leave: l });
  const n = world({ width: 300 }); n.render(); n.st.active = true; n.render();
  ok(n.read().label === "Leave the DJ queue" && n.read().under, "F: even at 300 px, in full and under", n.read());
  // ── B — WHERE LEAVE FITS ──
  const b = world({ width: 494 });
  b.render(); const bj = b.read(); b.st.active = true; b.render(); const bl = b.read();
  ok(!bj.under && !bl.under && bj.label === "Join the DJ queue" && bl.label === "Leave the DJ queue", "B: WHERE LEAVE WITH ITS LOCK FITS (494 px), BOTH BESIDE", { join: bj, leave: bl });
  const edge = 132.4 + GAP_LOCK + LOCK + GAP_ROW + CONTROLS;   // 480.4
  const e1 = world({ width: Math.ceil(edge) }); e1.st.active = false; e1.render();
  const e0 = world({ width: Math.floor(edge) - 1 }); e0.render();
  ok(!e1.read().under && e0.read().under, "B: the edge is Leave's — beside at " + Math.ceil(edge) + " px, under at " + (Math.floor(edge) - 1), { at: [e1.read().under, e0.read().under] });
  // ── J — JUDGED ON THE WIDER STATE ──
  const joinNeeds = 120.8 + GAP_ROW + CONTROLS;   // 428.8: Join alone would fit beside
  const m = world({ width: 450 });
  m.render(); const mj = m.read(); m.st.active = true; m.render(); const ml = m.read();
  ok(450 > joinNeeds && 450 < edge && mj.under && ml.under, "J: AT 450 PX JOIN ALONE WOULD FIT, LEAVE WITH ITS LOCK WOULD NOT — both under, placed alike", { join: mj, leave: ml });
  const s = world({ width: 348 }); s.render(); const s1 = s.read().under; s.render(); const s2 = s.read().under; s.render();
  ok(s1 && s2 && s.read().under, "J: A SECOND AND THIRD PLACING GIVE THE SAME ANSWER — measured on one line, whatever the last placing was", [s1, s2, s.read().under]);
  // ── P — THE MEASURE PUTS EVERYTHING BACK ──
  ok(!j.measuring && !l.measuring && !j.lock && j.label === "Join the DJ queue", "P: AFTER THE MEASURE — Join's words, its lock hidden, no measuring class left", j);
  // The lock appearing on Join → Leave starts locked (`renderJoinBtn` reads whether it was shown AFTER the placing): the measure must
  // have put it back hidden, or the newly shown lock would keep an unlock window it never had.
  const t = world({ width: 348 }); t.render(); t.relocks.length = 0; t.st.active = true; t.render();
  ok(t.relocks.indexOf("leave") >= 0, "P: AND JOIN → LEAVE RELOCKS THE LOCK — it was hidden again after the measure, so it newly appears", t.relocks);
  // ── R — RE-JUDGED LIVE ──
  ok(a.resize.length === 1, "R PREMISE — one resize hook, made once", a.resize.length);
  a.st.width = 494; a.resize[0](); while (a.timers.length) a.timers.shift()();
  ok(!a.read().under && a.read().label === "Leave the DJ queue", "R: THE WINDOW WIDENED — the hook re-renders it, and it comes back beside", a.read());
  a.st.width = 348; a.resize[0](); while (a.timers.length) a.timers.shift()();
  ok(a.read().under, "R: narrowed again — under again", a.read());
  // ── K — WIDE AND COMPACT KEEP TODAY'S ROW ──
  for (const md of ["wide", "compact"]) {
    const k = world({ width: 348, mode: md, active: true, shrink: false });
    k.render();
    ok(!k.read().under && k.read().label !== "Leave the DJ queue" && _LADDER_HAS(k.read().label), "K: " + md.toUpperCase() + " — the ladder shortens the label, nothing under", k.read());
  }
  // A phone placing left behind when the layout changes is taken away by the ladder's own fit.
  const sw = world({ width: 348, active: true }); sw.render(); sw.mode.v = "wide"; sw.render();   // (the ladder's words are K's above)
  ok(!sw.read().under, "K: switched to wide — the phone's placing is taken away", sw.read());
}
function _LADDER_HAS(t) { return ["Leave DJ queue", "Leave queue", "Leave", "LQ"].indexOf(t) >= 0; }

// ── C — THE CONTROLS KEEP THEIR SIZE AND PLACE (DECLARED) ──
{
  const css = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const cas = makeCascade(readSheet(css));
  const doc = makeDocument();
  const rowN = mk("div", doc); rowN.className = "playback-controls pc-under";
  const jg = mk("div", doc); jg.className = "join-group"; const jb = mk("button", doc); jb.className = "join-btn";
  const vg = mk("div", doc); vg.className = "volume-group"; const sl = mk("input", doc); sl.className = "volume-slider";
  rowN.appendChild(jg); jg.appendChild(jb); rowN.appendChild(vg); vg.appendChild(sl); doc.body.appendChild(rowN);
  const d = (n, p) => { const x = cas.declared(n, p); return x ? { val: x.val, sel: x.sel } : null; };
  ok(d(rowN, "flex-wrap") && d(rowN, "flex-wrap").val === "wrap" && d(vg, "order") && d(vg, "order").val === "1" && d(jg, "order") && d(jg, "order").val === "2",
    "C: UNDER, THE CONTROLS' LINE KEEPS THE ROW'S PLACE AND THE BUTTON'S GOES UNDER IT (`order`, DECLARED)", { wrap: d(rowN, "flex-wrap"), vg: d(vg, "order"), jg: d(jg, "order") });
  ok(d(vg, "margin-left") && d(vg, "margin-left").val === "auto" && !/pc-under/.test((d(vg, "flex") || {}).sel || "") && !/pc-under/.test((d(vg, "flex-grow") || {}).sel || ""),
    "C: THE VOLUME GROUP AT ITS RIGHT EDGE, AT ITS OWN SIZE — nothing grows it there", { ml: d(vg, "margin-left"), flex: d(vg, "flex") });
  const sw = d(sl, "width"), sf = d(sl, "flex");
  ok(sw && sw.val === "100px" && !/pc-/.test(sw.sel) && sf && sf.val === "0 1 100px" && !/pc-/.test(sf.sel),
    "C: THE SLIDER HAS NO RULE OF ITS OWN UNDER — its own 100 px, never stretched (the old wrap's `flex: 1 1 auto` is not applied)", { width: sw, flex: sf });
  ok(d(jg, "justify-content") && d(jg, "justify-content").val === "center" && d(jg, "flex") && d(jg, "flex").val === "0 0 100%",
    "C: THE BUTTON AND ITS LOCK CENTRED ON THEIR OWN LINE", { jc: d(jg, "justify-content"), flex: d(jg, "flex") });
  rowN.className = "playback-controls pc-measure";
  ok(["join-group", "join-btn", "volume-group", "volume-slider"].every((c) => { const n = c === "join-group" ? jg : c === "join-btn" ? jb : c === "volume-group" ? vg : sl; const x = d(n, "flex-shrink"); return x && x.val === "0"; }),
    "C: WHILE MEASURED NOTHING SHRINKS — the button, the lock's group, the controls and the slider at their own size (`pc-measure`)");
}

if (failed) { console.log("[phone-join] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[phone-join] PASS — the phone player's Join / Leave (`ddjp_702`, JOB 7; " + asserts + " assertions): in the phone layout the button reads in " +
  "full, \"Join the DJ queue\" / \"Leave the DJ queue\"; at 390 px both sit under the controls, centred; where Leave with its lock fits (a wider window) " +
  "both sit beside, the edge being Leave's; where only Join would fit both still go under, judged on the wider state, measured with nothing " +
  "shrinking and on one line whatever came before, the same answer every time; the measure puts the label and the lock back; the controls keep " +
  "their size and place and the slider is never stretched (DECLARED); the one resize hook re-judges it; wide and compact keep the ladder. " +
  "Chromium measured the boxes (the report)");
process.exit(0);
