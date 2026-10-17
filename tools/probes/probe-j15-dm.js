// tools/probes/probe-j15-dm.js
// J15 — READ-ONLY measurement. Changes nothing; prints what the tree actually does.
//
// R0 is the finding this job turned on, and it is kept as a row rather than as a sentence: on the
// tree as RECEIVED the second ingest door had no origin gate, so a room whose NAME was neither
// `chat-*` nor a Spine prefix reached `EventCache.store` and `StreamManager.ingest`. That is every
// Matrix room this account is in that DDJP did not create, and every DM room J15 adds. Run against
// a pre-J15 tree it prints ADMITTED; against this one it prints REFUSED.
//
// Every row is admissibility-gated: a row whose router reached NOTHING is refused rather than
// printed as a refusal, because an unreached measurement returns the same value in every tree and
// absence reads exactly like a finding.

const path = require("path");
const P = require("../../tests/_probe-j15-dm.js");
const { loadInContext } = require("../../tests/_load.js");

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
  "backends/backend1/matrixbridge.js",
], {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
  window: {}, document: { body: { appendChild() {} } },
});
const MB = sb.MatrixBridge;

const SCOPE = ["!ev-owner:hs", "!chat-unc:hs"];
const PROTO = JSON.stringify({ t: "ddjp.dj.join", l: 9, v: "SONG0" });

function route(room, body) {
  return P.driveRoute({
    room, body, scope: SCOPE, dmScope: ["!dm-them:hs"],
    isSpineChannel: MB._isSpineChannel, isChatChannel: MB._isChatChannel,
  });
}

const st = P.selfTest();
console.log("gate self-test: missed=" + st.missed.length + " falseAlarms=" + st.falseAlarms.length +
  (st.missed.length || st.falseAlarms.length ? "  — THE GATE IS BROKEN; nothing below means anything" : ""));
console.log("");

const rows = [
  ["R0  a DM room, PROTOCOL body       ", { roomId: "!dm-them:hs", name: "" }, PROTO],
  ["R1  a DM room, chat body           ", { roomId: "!dm-them:hs", name: "" }, "hello"],
  ["R2  a foreign room, PROTOCOL body  ", { roomId: "!elsewhere:hs", name: "Some Element Room" }, PROTO],
  ["R3  in-scope spine, PROTOCOL body  ", { roomId: "!ev-owner:hs", name: "events-owner" }, PROTO],
  ["R4  in-scope chat, chat body       ", { roomId: "!chat-unc:hs", name: "chat-uncategorized" }, "hello"],
];

for (const [label, room, body] of rows) {
  const r = route(room, body);
  const g = P.admissible("route", r, { expectAnyCall: true });
  if (!g.ok) { console.log(label + " REFUSED BY THE GATE: " + g.problems.join(" · ")); continue; }
  const fate = r.spined ? "spine door"
    : (r.stored || r.folded) ? "ADMITTED to " + [r.stored && "store", r.folded && "fold"].filter(Boolean).join(" + ")
    : (r.fannedOut ? "raw listeners only (Skin)" : "dropped entirely");
  console.log(label + " -> " + fate);
}

console.log("");
console.log("R5  the two scopes are separate:");
MB.setRoomScope({ events_owner: "!ev-owner:hs" });
MB.setDMScope(["!dm-them:hs"]);
console.log("      inScope(spine)=" + MB.inScope("!ev-owner:hs") +
            "  inScope(dm)=" + MB.inScope("!dm-them:hs") +
            "  inDMScope(dm)=" + MB.inDMScope("!dm-them:hs") +
            "  inDMScope(spine)=" + MB.inDMScope("!ev-owner:hs"));
MB.clearRoomScope();
console.log("      after clearRoomScope: inScope(spine)=" + MB.inScope("!ev-owner:hs") +
            "  inDMScope(dm)=" + MB.inDMScope("!dm-them:hs") + "   (a conversation is with a person)");

console.log("");
console.log("R6  the panel, extracted from ui/interface.js and RUN:");
const p = P.drivePanel({ conversations: [
  { roomId: "!dm-a:hs", userId: "@a:hs", lastTs: 9000, unread: true },
  { roomId: "!dm-b:hs", userId: "@b:hs", lastTs: 8000, unread: false },
] });
const g6 = P.admissible("panel", p, { expectRows: true });
if (!g6.ok) console.log("      REFUSED BY THE GATE: " + g6.problems.join(" · "));
else console.log("      rows=" + p.rows.length + "  unread rows=" + p.rows.filter((r) => r.unread).length +
                 "  badge=" + JSON.stringify(p.badge));
const p0 = P.drivePanel({ conversations: [] });
if (P.admissible("panel", p0, {}).ok) console.log("      with no conversations: rows=" + p0.rows.length +
  "  badge=" + JSON.stringify(p0.badge));
