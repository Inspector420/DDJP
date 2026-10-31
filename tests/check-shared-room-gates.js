// tests/check-shared-room-gates.js
// SUBJECT: backends/backend1/matrixbridge.js, core/backends.js
// WALL: A SHARED ROOM IS BUILT WITH THE BARS ITS TABLE CARRIES (J115, item 2).
//
// The owner's ruling at `ddjp_469`: staff and above may delete chat messages, so every chat is created with the
// homeserver's `redact` bar at the staff rung. backend1's table says so, but backend1 REGISTERS a copy of its table as
// its plan (`channelTaxonomy()`), the room is built from the registered plan, and the copy dropped `gates`. Every
// shared room's chats were therefore built at the template's default, `redact: 100`, and staff could not delete.
// Bot rooms register their table itself and were never affected. New rooms only: an existing room is not updated.
//   PART A — the plan backend1 registers carries the table's `gates`: every chat row has `redact` at the staff rung,
//            and no other row has a `redact` bar.
//   PART B — the rows a NEW shared room is built from (creation, then each upgrade batch) carry it, and the real
//            power-levels template turns it into the homeserver's bar.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[shared-room-gates] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const noop = () => {};
const S = loadInContext(["core/backends.js", "backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"],
  { Logger: { info: noop, warn: noop, error: noop, debug: noop } });
const MODE = "backend1";
const STAFF = S.Ranks.levelOf("staff");
const isChat = (r) => r && (r.kind === "chat" || r.kind === "presence");

// ═══ PART A — the registered plan ══════════════════════════════════════════════════════════════
const plan = S.Backends.planFor(MODE) || [];
ok(plan.length > 0, "A PREMISE — backend1 registered a channel plan", plan.length);
const chats = plan.filter(isChat);
ok(chats.length >= 4, "A PREMISE — the plan has its chats (three rank chats and the presence chat)", chats.map((c) => c.key));
for (const r of chats) {
  ok(!!(r.gates && r.gates.redact === STAFF), "A: the registered plan's `" + r.key + "` carries `redact` at the staff " +
    "rung (" + STAFF + "), the owner's ruling at ddjp_469 — the copy backend1 registers used to drop `gates`", r);
}
const others = plan.filter((r) => !isChat(r) && r.gates && typeof r.gates.redact === "number");
ok(others.length === 0, "A: no event, checkpoint or settings row carries a `redact` bar — those keep the owner-only " +
  "default", others.map((r) => r.key));

// ═══ PART B — what a new shared room is built from ════════════════════════════════════════════
const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
const i = mb.indexOf("function _powerLevels");
const end = mb.indexOf("\n  function ", i + 10);
const pctx = { console };
vm.createContext(pctx);
vm.runInContext(mb.slice(i, end) + "\n;globalThis.PL = _powerLevels;", pctx);
ok(pctx.PL(0, "@o:hs", false).redact === 100, "B PREMISE — with no gates the template's redact bar is the owner's (100)");

const creation = (S.B1MatrixBridge.creationPlan({}, MODE) || {}).todo || [];
const built = creation.concat(plan.filter((r) => typeof r.batch === "number" && r.batch > 1));
const builtChats = built.filter(isChat);
ok(builtChats.length === chats.length, "B PREMISE — every chat is built, at creation or by an upgrade batch",
  { built: builtChats.map((r) => r.key), plan: chats.map((r) => r.key) });
for (const r of builtChats) {
  const bar = pctx.PL(r.level, "@o:hs", false, r.gates).redact;
  ok(bar === STAFF, "B: a new shared room's `" + r.key + "` is created with the homeserver's `redact` bar at " + STAFF +
    ", so staff can delete in it", { key: r.key, redact: bar, gates: r.gates });
}

if (failed) { console.log("[shared-room-gates] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
console.log("[shared-room-gates] PASS — a shared room is built with the bars its table carries (J115): the plan backend1 " +
  "registers keeps the table's `gates`, so every chat — the presence chat included — has `redact` at the staff rung " +
  "(the owner's ruling at ddjp_469) and no other row has one, and the rows a new room is built from, at creation and " +
  "in each upgrade batch, give the real template that bar. An existing room is not updated (" + asserts + " assertions)");
