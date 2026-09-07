// tests/_probe-j12-tiers.js
// SHARED HARNESS for J12 (per-tier chat views and unread badges) — used by
// `tests/check-chat-tiers.js` and by `tools/probes/probe-j12-tiers.js`, so the guard and the
// measurement cannot drift.
//
// ── WHY THE STRIP IS EXTRACTED AND RUN RATHER THAN MATCHED ───────────────────────────────────
// The subject is what a BADGE CLAIMS. A regex proving "unread" is spelled in `ui/interface.js`
// proves nothing about whether a silent tier carries one — and that is the case the job's Open is
// really about, because a badge on an empty staff channel is an invitation to open nothing.
// So `_chatTierLabel`, `_tierForChannel` and `_renderChatTierStrip` are pulled out by name and
// driven. This is the SEVENTH guard in the tree to execute this file rather than read it.
//
// THE EXTRACTOR IS BORROWED, NOT REWRITTEN — `_probe-j16-active.js` owns `extractFn`, the
// recording DOM and the constant extractor J13 added to it. A second copy would be a second
// definition of how this file is read (P7).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const UI_REL = "ui/interface.js";

const J16 = require(path.join(__dirname, "_probe-j16-active.js"));
const { extractFn, el, node, flatten } = J16;

// ── DRIVER 1 — the strip, extracted and RUN ──────────────────────────────────────────────────
// `Room.chatTiers` and `ChatPrefs.tierUnread` are STUBBED and the stubs RECORD: what this driver
// proves is that the strip renders what the feature and the prefs hand it and decides neither.
function driveStrip(opts) {
  const o = opts || {};
  // `CHAT_TIER_LABELS` AND `_chatTierName` ARE EXTRACTED TOO, NOT STUBBED. The label a person
  // reads is the subject of PART E, so supplying a stub map here would prove the strip renders
  // SOMETHING and nothing about what it says — which is the shape this whole probe exists to
  // avoid. Extracted, the real map is what the assertions read, and a tier missing from it shows
  // up as its raw protocol id rather than silently as a blank.
  const pieces = ["_chatTierName", "_chatTierLabel", "_tierForChannel",
                  "_renderChatTierStrip"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractFn(UI_REL, p, o.srcOverride);
    if (!ex.ok) return { ok: false, stage: ex.stage, asked: [], rendered: [] };
    srcs.push(ex.source);
  }
  const asked = [], unreadAsked = [], selected = [];
  const box = node("div");
  const sandbox = {
    console, Math, JSON, Date,
    refs: { chatTiers: o.noBox ? null : box, chatBox: null },
    clear: (n) => { n.children.length = 0; },
    el,
    _selectChatTier: (t) => selected.push(t),
    Room: {
      chatTiers: () => { asked.push(1); if (o.throwFromRoom) throw new Error("no room"); return o.res; },
      selectChatTier: (t) => { selected.push(t); return o.res; },
    },
    ChatPrefs: {
      tierUnread: (t) => { unreadAsked.push(t); return (o.unread || []).indexOf(t) >= 0; },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(srcs.join("\n") +
      "\n;globalThis.__render = _renderChatTierStrip;" +
      "\n;globalThis.__label = _chatTierLabel;" +
      "\n;globalThis.__tierFor = _tierForChannel;" +
      "\n;globalThis.__tierName = _chatTierName;", sandbox, { filename: "chatTierStrip" });
  } catch (e) {
    return { ok: false, stage: "stage: the strip declarations did not evaluate — " + e.message, asked, rendered: [] };
  }
  try { sandbox.__render(); }
  catch (e) { return { ok: false, stage: "stage: `_renderChatTierStrip` threw — " + e.message, asked, rendered: [] }; }

  const nodes = flatten(box);
  const cls = (c) => nodes.filter((n) => String(n.className || "").split(/\s+/).indexOf(c) >= 0);
  return {
    ok: true, asked, unreadAsked, selected, nodes,
    buttons: cls("chat-tier").map((n) => ({ text: n.text, cls: String(n.className || ""),
      active: /\bactive\b/.test(String(n.className || "")),
      unread: /\bunread\b/.test(String(n.className || "")), onclick: n.onclick })),
    note: cls("chat-tier-note").map((n) => n.text),
    label: sandbox.__label, tierFor: sandbox.__tierFor, tierName: sandbox.__tierName,
  };
}

// ── DRIVER 2 — the label alone ───────────────────────────────────────────────────────────────
function driveLabel(res, unreadList, srcOverride) {
  const r = driveStrip({ res: { tiers: [], activeTier: null }, srcOverride });
  if (!r.ok) return { ok: false, stage: r.stage };
  let out;
  try { out = r.label(res, (t) => (unreadList || []).indexOf(t) >= 0); }
  catch (e) { return { ok: false, stage: "stage: `_chatTierLabel` threw — " + e.message }; }
  if (!out || typeof out !== "object") return { ok: false, stage: "stage: `_chatTierLabel` returned no object" };
  return { ok: true, label: out };
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
function gate(kind, r, want, where) {
  const w = want || {};
  const fail = (why, detail) => {
    const msg = "[chat-tiers] INADMISSIBLE " + (where || kind) + " — " + why +
      "\n      nothing below this would mean anything; the reading never reached its subject" +
      (detail !== undefined ? "\n      got " + JSON.stringify(detail) : "");
    if (gate._throw) throw new Error(msg);
    console.log(msg);
    process.exit(2);
  };
  if (!r || r.ok !== true) fail((r && r.stage) || "the reading did not complete");
  if (kind === "strip") {
    if (w.expectAsked && (!r.asked || !r.asked.length)) {
      fail("the strip never asked the feature layer which tiers exist, so it cannot have rendered them");
    }
    if (w.expectButtons && (!r.buttons || !r.buttons.length)) {
      fail("the strip painted no tier buttons — an empty strip is what a strip that never ran also produces");
    }
  }
  if (kind === "label") {
    if (!Array.isArray(r.label.tiers)) fail("the label carries no tier list", r.label);
    if (typeof r.label.note !== "string" || !r.label.note) fail("the label carries no note", r.label);
  }
  return r;
}

// ── SELF-TEST — both directions ──────────────────────────────────────────────────────────────
function selfTest() {
  const out = [];
  gate._throw = true;
  const RES = { tiers: [{ tier: "uncategorized", id: "!u:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false }],
                activeTier: "uncategorized", activeId: "!u:hs", mainTier: "uncategorized" };
  const R = (name, fn, expectRefusal) => {
    let refused = false;
    try { fn(); } catch (e) { refused = true; }
    out.push({ row: name, refused, admitted: !refused, asExpected: refused === expectRefusal });
  };
  R("no box — the strip paints nothing", () => {
    gate("strip", driveStrip({ noBox: true, res: RES }), { expectButtons: true }, "selftest");
  }, true);
  R("the subject is deleted from the source", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("function _chatTierLabel(", "function _NOT_chatTierLabel(");
    gate("strip", driveStrip({ srcOverride: src, res: RES }), { expectButtons: true }, "selftest");
  }, true);
  R("a room with no tiers, where buttons were required", () => {
    gate("strip", driveStrip({ res: { tiers: [], activeTier: null } }), { expectButtons: true }, "selftest");
  }, true);
  R("the label loses its note", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace(/note: tiers\.length <= 1[\s\S]*?seen\.",/, "note: \"\",");
    gate("label", driveLabel(RES, [], src), {}, "selftest");
  }, true);
  R("a sound strip reading", () => {
    gate("strip", driveStrip({ res: RES }), { expectAsked: true, expectButtons: true }, "selftest");
  }, false);
  R("a sound label reading", () => { gate("label", driveLabel(RES, ["staff"]), {}, "selftest"); }, false);
  gate._throw = false;
  return out;
}

module.exports = { driveStrip, driveLabel, gate, selfTest, extractFn, el, node, flatten, J16, UI_REL, ROOT };
