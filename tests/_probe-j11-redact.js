// tests/_probe-j11-redact.js
// SHARED HARNESS for J11 (deleting a chat message) — used by `tests/check-chat-redaction.js` and
// by `tools/probes/probe-j11-redact.js`, so the guard and the measurement cannot drift.
//
// ── WHY THE ROW AND THE REMOVAL ARE EXECUTED RATHER THAN MATCHED ─────────────────────────────
// The subject is whether a deleted message LEAVES THE SCREEN. The failure this file exists to
// catch is silent: the obvious handler is refused by the buffer's own non-downgrading rule and
// the message simply stays, with nothing thrown and no log line. A regex proving `remove` is
// spelled in `ui/interface.js` proves nothing about whether the row goes. So `_chatRow`,
// `_isOwnMessage` and `removeChatMessage` are pulled out by name and driven. This is the EIGHTH
// guard in the tree to execute that file rather than read it.
//
// The extractor is borrowed from `_probe-j16-active.js` (via the same chain J12 and J13 used) —
// a second copy would be a second definition of how this file is read (P7).

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const UI_REL = "ui/interface.js";
const J16 = require(path.join(__dirname, "_probe-j16-active.js"));
const { extractFn, el, node, flatten } = J16;

// A real ChatBuffer, never a stand-in: the whole finding is about what the REAL dedup rule does.
function realBuffer() {
  const { loadInContext } = require(path.join(ROOT, "tests/_load.js"));
  return loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON }).ChatBuffer;
}

// ── DRIVER 1 — removeChatMessage, against a real buffer and a recording DOM ──────────────────
function driveRemoval(opts) {
  const o = opts || {};
  const CB = realBuffer();
  // `_eidSel` is extracted rather than stubbed, and it was NOT in the first version of this list.
  // The gate caught that: `removeChatMessage` threw `_eidSel is not defined` AFTER the buffer
  // removal had already succeeded, so `sizes` read 0 and the reading looked exactly like a clean
  // removal. The same class of harness fault J13 hit with `FEED_LIMIT` — a dependency omitted from
  // the sandbox, arriving as something that resembles success. Extracted so the selector the
  // subject actually builds is the one driven here.
  // `_chatRow` joined this list when the removal became a TOMBSTONE — the handler now replaces the
  // row rather than deleting it, so it needs the row builder. The gate caught the omission the
  // same way it caught `_eidSel` and J13's `FEED_LIMIT`: a throw that lands after part of the work
  // has already succeeded, so the reading resembles a clean result.
  const pieces = ["_eidSel", "_tierForChannel", "_chatStates", "_chatState", "_newChatState",
                  "_isOwnMessage", "_chatContent", "_chatRow", "removeChatMessage"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractFn(UI_REL, p, o.srcOverride);
    if (!ex.ok) return { ok: false, stage: ex.stage };
    srcs.push(ex.source);
  }
  const box = node("div");
  box._chatTier = o.visibleTier || null;
  const removedFromDom = [];
  const replacedInDom = [];
  box.querySelector = (sel) => {
    const m = /\[data-eid="(.*)"\]/.exec(sel);
    const id = m ? m[1] : null;
    if (!id || (o.mounted || []).indexOf(id) < 0) return null;
    return { remove: () => removedFromDom.push(id),
             replaceWith: (n) => replacedInDom.push({ id, node: n }) };
  };
  const replaced = [];
  box.querySelectorReplace = replaced;
  const sandbox = {
    console, Math, JSON, Date, ChatBuffer: CB, CSS: undefined,
    refs: { chatBox: o.noBox ? null : box },
    document: {
      getElementById: () => null,
      createTextNode: (t) => { const n = node("#text"); n.text = t; return n; },
      createElement: (tag) => { const n = node(tag); n.setAttribute = () => {}; return n; },
    },
    el,
    // The real constants and helpers the row builder closes over, extracted above where they are
    // this file's subject and stubbed here where they are not (avatars, colours, cards, prefs).
    UTD_TEXT: "Couldn't decrypt this message",
    REDACTED_TEXT: (function () {
      const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8");
      const m = src.match(/const REDACTED_TEXT = "([^"]*)";/);
      return m ? m[1] : null;
    })(),
    _rosterLevel: () => 0, rankColor: () => "#fff",
    shortName: (u) => (u || "").split(":")[0].replace("@", ""),
    _wireCardTrigger: () => {},
    avatarEl: () => { const a = node("img"); a.dataset = {}; a.style = {}; return a; },
    _deleteChatMessage: () => {},
    ChatPrefs: { classifyOpts: () => ({}) },
    Room: { chatTiers: () => o.res || { tiers: [], activeTier: null },
            getMyId: () => o.me || null },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(srcs.join("\n") +
      "\n;globalThis.__remove = removeChatMessage;" +
      "\n;globalThis.__state = _chatState;", sandbox, { filename: "removeChatMessage" });
  } catch (e) {
    return { ok: false, stage: "stage: the removal declarations did not evaluate — " + e.message };
  }
  // Seed the tiers named by the caller, through the SUBJECT's own state accessor.
  const seeded = {};
  for (const [tier, msgs] of Object.entries(o.seed || {})) {
    const st = sandbox.__state(box, tier);
    for (const m of msgs) {
      // `seedFailed` seeds a row as UNDECRYPTABLE, which is the state PART D's hidden-row case
      // needs and which no other driver could previously express.
      const isFailed = (o.seedFailed || []).indexOf(m.id) >= 0;
      st.buf.upsert(m.id, m.sender || "@a:hs", isFailed ? "" : (m.body || "x"), isFailed, m.ts || 1000);
    }
    for (const m of msgs) if ((o.mounted || []).indexOf(m.id) >= 0) st.domIds.add(m.id);
    seeded[tier] = st;
  }
  let threw = null;
  try { sandbox.__remove(o.redactedId, o.roomId); }
  catch (e) { threw = e.message; }
  const sizes = {};
  const held = {};
  for (const [tier, st] of Object.entries(seeded)) {
    sizes[tier] = st.buf.size();
    held[tier] = st.buf.ids();
  }
  return { ok: true, threw, sizes, held, removedFromDom, replacedInDom,
           records: Object.fromEntries(Object.entries(seeded).map(([t, st]) =>
             [t, st.buf.ids().map((i) => st.buf.get(i))])),
           domIds: Object.fromEntries(Object.entries(seeded).map(([t, st]) => [t, Array.from(st.domIds)])) };
}

// ── DRIVER 2 — _chatRow: does the affordance appear, and only where it should? ───────────────
function driveRow(opts) {
  const o = opts || {};
  const pieces = ["_isOwnMessage", "_chatRow"];
  const srcs = [];
  for (const p of pieces) {
    const ex = extractFn(UI_REL, p, o.srcOverride);
    if (!ex.ok) return { ok: false, stage: ex.stage };
    srcs.push(ex.source);
  }
  const clicked = [];
  const sandbox = {
    console, Math, JSON, Date, el,
    _rosterLevel: () => 0, rankColor: () => "#fff",
    shortName: (u) => (u || "").split(":")[0].replace("@", ""),
    _wireCardTrigger: () => {},
    avatarEl: () => { const a = node("img"); a.dataset = {}; a.style = {}; return a; },
    _chatContent: (box, rec) => el("span", { class: "body", text: rec.body }),
    _deleteChatMessage: (id) => clicked.push(id),
    Room: { getMyId: () => o.me },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  try {
    vm.runInContext(srcs.join("\n") + "\n;globalThis.__row = _chatRow;", sandbox, { filename: "chatRow" });
  } catch (e) {
    return { ok: false, stage: "stage: the row declarations did not evaluate — " + e.message };
  }
  let row;
  try { row = sandbox.__row(node("div"), o.record); }
  catch (e) { return { ok: false, stage: "stage: `_chatRow` threw — " + e.message }; }
  const nodes = flatten(row);
  const del = nodes.filter((n) => String(n.className || "").indexOf("chat-del") >= 0);
  return { ok: true, row, nodes, del, clicked,
           hasDelete: del.length > 0, eid: row.dataset ? row.dataset.eid : null };
}

// ── THE GATE ─────────────────────────────────────────────────────────────────────────────────
function gate(kind, r, want, where) {
  const w = want || {};
  const fail = (why, detail) => {
    const msg = "[chat-redaction] INADMISSIBLE " + (where || kind) + " — " + why +
      "\n      nothing below this would mean anything; the reading never reached its subject" +
      (detail !== undefined ? "\n      got " + JSON.stringify(detail) : "");
    if (gate._throw) throw new Error(msg);
    console.log(msg);
    process.exit(2);
  };
  if (!r || r.ok !== true) fail((r && r.stage) || "the reading did not complete");
  if (kind === "removal") {
    if (r.threw) fail("`removeChatMessage` threw — " + r.threw);
    // THE PREMISE THAT MATTERS MOST HERE: a removal asserted over an EMPTY buffer proves nothing,
    // and an empty buffer is exactly what a harness that never seeded one also produces.
    if (w.expectSeeded && Object.keys(r.sizes).length === 0) {
      fail("no tier buffer was seeded, so 'the message is gone' is true of a buffer that never had it");
    }
    if (w.expectHeld) {
      for (const [tier, n] of Object.entries(w.expectHeld)) {
        if (r.sizes[tier] === undefined) fail("tier `" + tier + "` was never seeded", r.sizes);
      }
    }
  }
  if (kind === "row") {
    if (!r.nodes || !r.nodes.length) fail("`_chatRow` painted nothing", r.nodes);
    if (w.expectEid && !r.eid) fail("the row carries no event id, so nothing could address it", r.eid);
  }
  return r;
}

// ── SELF-TEST — both directions ──────────────────────────────────────────────────────────────
function selfTest() {
  const out = [];
  gate._throw = true;
  const RES = { tiers: [{ tier: "main", id: "!m:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false }], activeTier: "main" };
  const R = (name, fn, expectRefusal) => {
    let refused = false;
    try { fn(); } catch (e) { refused = true; }
    out.push({ row: name, refused, admitted: !refused, asExpected: refused === expectRefusal });
  };
  R("no box — nothing can be removed", () => {
    gate("removal", driveRemoval({ noBox: true, redactedId: "$a", roomId: "!m:hs", res: RES }),
      { expectSeeded: true }, "selftest");
  }, true);
  R("nothing was seeded, so 'gone' is free", () => {
    gate("removal", driveRemoval({ redactedId: "$a", roomId: "!m:hs", res: RES, visibleTier: "main" }),
      { expectSeeded: true }, "selftest");
  }, true);
  R("the subject is deleted from the source", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("function removeChatMessage(", "function _NOT_removeChatMessage(");
    gate("removal", driveRemoval({ srcOverride: src, redactedId: "$a", roomId: "!m:hs", res: RES }),
      { expectSeeded: true }, "selftest");
  }, true);
  R("_chatRow loses its event id", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("if (record.id) msg.dataset.eid = record.id;", "");
    gate("row", driveRow({ srcOverride: src, me: "@me:hs",
      record: { id: "$a", sender: "@me:hs", body: "x", ts: 1 } }), { expectEid: true }, "selftest");
  }, true);
  R("a sound removal reading", () => {
    gate("removal", driveRemoval({ redactedId: "$a", roomId: "!m:hs", res: RES, visibleTier: "main",
      seed: { main: [{ id: "$a" }] } }), { expectSeeded: true }, "selftest");
  }, false);
  R("a sound row reading", () => {
    gate("row", driveRow({ me: "@me:hs", record: { id: "$a", sender: "@me:hs", body: "x", ts: 1 } }),
      { expectEid: true }, "selftest");
  }, false);
  // AND THE ONE THIS JOB REQUIRES: a redaction for a message never held must still be an
  // ADMISSIBLE reading, because it is the normal case rather than a failed one.
  R("a redaction for a message never held is still admissible", () => {
    gate("removal", driveRemoval({ redactedId: "$never", roomId: "!m:hs", res: RES,
      visibleTier: "main", seed: { main: [{ id: "$other" }] } }), { expectSeeded: true }, "selftest");
  }, false);
  gate._throw = false;
  return out;
}

module.exports = { driveRemoval, driveRow, gate, selfTest, extractFn, el, node, flatten,
                   realBuffer, J16, UI_REL, ROOT };
