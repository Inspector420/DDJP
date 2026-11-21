// tests/_probe-j12-tiers.js
// SHARED HARNESS for J12 (per-tier chat views and unread badges) — used by
// `tests/check-chat-tiers.js`. (J12's probe shared it until the finished jobs' probes went, `ddjp_617`.)
//
// ── WHY THE CHAT BUTTON IS EXTRACTED AND RUN RATHER THAN MATCHED ───────────────────────────────
// The subject is what a BADGE CLAIMS. A regex proving "unread" is spelled in `ui/chat.js`
// proves nothing about whether a silent tier carries one — and that is the case the job's Open is
// really about, because a badge on an empty staff channel is an invitation to open nothing.
// So `_chatTierLabel`, `_tierForChannel` and the renderer are pulled out by name and
// driven. This is the SEVENTH guard in the tree to execute this file rather than read it.
// THE RENDERER IS THE CHAT BUTTON SINCE J128 (the owner's): `_renderChatPicker` draws one button and, opened, its menu —
// it was `_renderChatTierStrip`, a row of tier buttons above the box. The driver opens the menu the way a person does, by
// clicking the button, and reads both.
//
// THE EXTRACTOR IS BORROWED, NOT REWRITTEN — `_probe-j16-active.js` owns `extractFn` and the
// recording DOM. A second copy would be a second
// definition of how this file is read (P7).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
// The chat surfaces moved to ui/chat.js at ddjp_392 — including THE DM PANEL, which came out of
// the middle of what used to be the roster's banner span. This constant names the file they are
// IN rather than the file their banner used to be in.
const UI_REL = "ui/chat.js";

const J16 = require(path.join(__dirname, "_probe-j16-active.js"));
const { extractFn, el, node, flatten } = J16;

// ── DRIVER 1 — the chat button and its menu, extracted and RUN ─────────────────────────────────
// `Room.chatTiers` and `ChatPrefs.tierUnread` are STUBBED and the stubs RECORD: what this driver
// proves is that the button and menu render what the feature and the prefs hand them and decide neither.
function drivePicker(opts) {
  const o = opts || {};
  // `_chatTierName` (it holds the label map) IS EXTRACTED TOO, NOT STUBBED. The label a person
  // reads is the subject of PART E, so supplying a stub map here would prove the strip renders
  // SOMETHING and nothing about what it says — which is the shape this whole probe exists to
  // avoid. Extracted, the real map is what the assertions read, and a tier missing from it shows
  // up as its raw protocol id rather than silently as a blank.
  const pieces = ["_chatTierName", "_chatTierLabel", "_tierForChannel", "_chatLocked",
                  "_renderChatPicker"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractFn(UI_REL, p, o.srcOverride);
    if (!ex.ok) return { ok: false, stage: ex.stage, asked: [], rendered: [] };
    srcs.push(ex.source);
  }
  const asked = [], unreadAsked = [], selected = [], goSet = [];
  const box = node("div");
  const input = node("input");
  const sandbox = {
    console, Math, JSON, Date,
    refs: { chatPick: o.noBox ? null : box, chatBox: null, chatInput: input },
    clear: (n) => { n.children.length = 0; },
    el,
    _selectChatTier: (t) => selected.push(t),
    Room: {
      chatTiers: () => { asked.push(1); if (o.throwFromRoom) throw new Error("no room"); return o.res; },
      selectChatTier: (t) => { selected.push(t); return o.res; },
    },
    ChatPrefs: {
      tierUnread: (t) => { unreadAsked.push(t); return (o.unread || []).indexOf(t) >= 0; },
      tierMentioned: (t) => (o.mentioned || []).indexOf(t) >= 0,
      goToPresent: () => o.goToPresent !== false,
      setGoToPresent: (v) => goSet.push(v),
    },
  };
  // The interim host seam (ui/base.js §host) — ui/chat.js reaches primitives through `H` since
  // ddjp_392. Built FROM the stubs above, one definition per driver.
  sandbox.H = {};
  for (const k of ["el", "clear", "shortName", "rankColor", "_rosterLevel", "avatarEl",
                   "_relockAllPanels"]) {
    if (sandbox[k] !== undefined) sandbox.H[k] = sandbox[k];
  }
  sandbox.H.rightTab = () => "chat";
  sandbox.H.queueTab = () => "room";
  sandbox.H.setRightTab = () => {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(srcs.join("\n") +
      "\n;globalThis.__render = _renderChatPicker;" +
      "\n;globalThis.__label = _chatTierLabel;" +
      "\n;globalThis.__tierFor = _tierForChannel;" +
      "\n;globalThis.__tierName = _chatTierName;", sandbox, { filename: "chatPicker" });
  } catch (e) {
    return { ok: false, stage: "stage: the chat button's declarations did not evaluate — " + e.message, asked, rendered: [] };
  }
  try {
    sandbox.__render();
    // Opened the way a person opens it: a click on the button (unless the reading is of the closed button alone).
    const btn0 = box.children[0];
    if (o.open !== false && btn0 && typeof btn0.onclick === "function") btn0.onclick();
  }
  catch (e) { return { ok: false, stage: "stage: `_renderChatPicker` threw — " + e.message, asked, rendered: [] }; }

  const nodes = flatten(box);
  const cls = (c) => nodes.filter((n) => String(n.className || "").split(/\s+/).indexOf(c) >= 0);
  const b = cls("chat-pick-btn")[0] || null;
  const go = cls("chat-pick-go")[0] || null;
  return {
    ok: true, asked, unreadAsked, selected, goSet, nodes,
    button: b ? { text: b.text, cls: String(b.className || ""), onclick: b.onclick } : null,
    // The menu's items, one per chat — the strip's buttons were these, and the rows below read the same facts of them.
    buttons: cls("chat-pick-item").map((n) => ({ text: n.text, cls: String(n.className || ""), tier: n.dataset && n.dataset.tier,
      active: /\bactive\b/.test(String(n.className || "")),
      unread: /\bunread\b/.test(String(n.className || "")), mentioned: /\bmentioned\b/.test(String(n.className || "")), onclick: n.onclick,
      // THE MAIN TIER'S MARK (ruling 39, J89): a small ✓ child on the right, not " (main)" in the name.
      mark: (n.children || []).filter((c) => /\bchat-tier-main\b/.test(String(c.className || ""))).map((c) => c.text).join("") })),
    go: go ? { text: flatten(go).map((n) => n.text).join(""), box: flatten(go).find((n) => n.tag === "input") || null } : null,
    hint: input.placeholder,
    note: cls("chat-tier-note").map((n) => n.text),
    label: sandbox.__label, tierFor: sandbox.__tierFor, tierName: sandbox.__tierName,
  };
}

// ── DRIVER 2 — the label alone ───────────────────────────────────────────────────────────────
function driveLabel(res, unreadList, srcOverride, mentionList) {
  const r = drivePicker({ res: { tiers: [], activeTier: null }, srcOverride });
  if (!r.ok) return { ok: false, stage: r.stage };
  let out;
  try { out = r.label(res, (t) => (unreadList || []).indexOf(t) >= 0, (t) => (mentionList || []).indexOf(t) >= 0); }
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
  if (kind === "picker") {
    if (w.expectAsked && (!r.asked || !r.asked.length)) {
      fail("the chat button never asked the feature layer which chats exist, so it cannot have rendered them");
    }
    if (w.expectButtons && (!r.button || !r.buttons || !r.buttons.length)) {
      fail("the menu painted no chats — an empty menu is what a button that never ran also produces");
    }
  }
  if (kind === "label") {
    if (!Array.isArray(r.label.tiers)) fail("the label carries no tier list", r.label);
    // The label used to be REQUIRED to carry a note; the owner removed the note (ddjp_453), so its tier
    // list is the one premise left — and it is still refused when missing, which the self-test drives.
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
  R("no box — the button paints nothing", () => {
    gate("picker", drivePicker({ noBox: true, res: RES }), { expectButtons: true }, "selftest");
  }, true);
  R("the subject is deleted from the source", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("function _chatTierLabel(", "function _NOT_chatTierLabel(");
    gate("picker", drivePicker({ srcOverride: src, res: RES }), { expectButtons: true }, "selftest");
  }, true);
  R("a room with no tiers, where chats were required", () => {
    gate("picker", drivePicker({ res: { tiers: [], activeTier: null } }), { expectButtons: true }, "selftest");
  }, true);
  R("the label loses its tier list", () => {
    const orig = fs.readFileSync(path.join(ROOT, UI_REL), "utf8");
    const src = orig.replace(/tiers: tiers\.map\(/, "tiers: null && tiers.map(");
    if (src === orig) throw new Error("selftest: the tier-list anchor matched nothing — this row would test the harness, not the gate");
    gate("label", driveLabel(RES, [], src), {}, "selftest");
  }, true);
  R("a sound button reading", () => {
    gate("picker", drivePicker({ res: RES }), { expectAsked: true, expectButtons: true }, "selftest");
  }, false);
  R("a sound label reading", () => { gate("label", driveLabel(RES, ["staff"]), {}, "selftest"); }, false);
  gate._throw = false;
  return out;
}

module.exports = { drivePicker, driveLabel, gate, selfTest, extractFn, el, node, flatten, J16, UI_REL, ROOT };
