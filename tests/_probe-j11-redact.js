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
// The chat surfaces moved to ui/chat.js at ddjp_392 — `_eidSel`, `_chatRow`, `removeChatMessage`
// and `_isOwnMessage` all came out of the CHAT banner with it.
const UI_REL = "ui/chat.js";
const J16 = require(path.join(__dirname, "_probe-j16-active.js"));
const { extractFn, el, node, flatten } = J16;

// A real ChatBuffer, never a stand-in: the whole finding is about what the REAL dedup rule does.
function realBuffer() {
  const { loadInContext } = require(path.join(ROOT, "tests/_load.js"));
  return loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON }).ChatBuffer;
}

// ── DRIVER 1 (driveRemoval) RETIRED at ddjp_425 — `check-chat-redaction` PART D drives the real
// ui/chat.js through `_chat-world` now; the per-tier `_chatState` buckets it seeded no longer exist.

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
  // Same stub as DRIVER 1 — the user card moved to ui/roster.js at ddjp_391.
  sandbox.Roster = { _wireCardTrigger: () => {} };
  // The interim host seam (ui/base.js §host) — ui/chat.js reaches primitives through `H`.
  sandbox.H = {};
  for (const k of ["el", "clear", "shortName", "rankColor", "_rosterLevel", "avatarEl",
                   "_relockAllPanels"]) {
    if (sandbox[k] !== undefined) sandbox.H[k] = sandbox[k];
  }
  sandbox.H.rightTab = () => "chat";
  sandbox.H.setRightTab = () => {};
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
  R("_chatRow loses its event id", () => {
    const src = fs.readFileSync(path.join(ROOT, UI_REL), "utf8")
      .replace("if (record.id) msg.dataset.eid = record.id;", "");
    gate("row", driveRow({ srcOverride: src, me: "@me:hs",
      record: { id: "$a", sender: "@me:hs", body: "x", ts: 1 } }), { expectEid: true }, "selftest");
  }, true);
  R("a sound row reading", () => {
    gate("row", driveRow({ me: "@me:hs", record: { id: "$a", sender: "@me:hs", body: "x", ts: 1 } }),
      { expectEid: true }, "selftest");
  }, false);
  gate._throw = false;
  return out;
}

module.exports = { driveRow, gate, selfTest, extractFn, el, node, flatten,
                   realBuffer, J16, UI_REL, ROOT };
