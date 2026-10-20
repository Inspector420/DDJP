// tests/check-nav-surfaces.js
// SUBJECT: ui/shell.js, ui/chat.js
// WALL: THE CHAT TIER STRIP IS THE QUEUE'S SUB-TAB SHAPE, AND ITS EXTRACTION ANCHORS STILL RESOLVE.
//
// This guard held three navigation surfaces from a browser run. Two of them were the room-file controls — the Saves
// button and its section (PARTS A–B), the export note (PART C) and the create-from-file row (PART D) — RETIRED AT J82
// with room files (owner's ruling 1; `check-no-room-files` PART A holds that they are gone). What remains:
//
//   PART E — the tier strip is the queue's sub-tab shape, and the three declarations
//     `check-chat-tiers` brace-matches from still resolve.

const fs = require("fs");
const path = require("path");

let asserts = 0;
function fail(msg, got) {
  console.log("[nav-surfaces] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");
// PART E names the chat surfaces that other guards brace-match from, and those moved to
// ui/chat.js at ddjp_392 while the nav wiring stayed. Both are read: this guard's subject is the
// set of extraction anchors across the ui/ layer, not the contents of one file.
const ui = ["ui/base.js", "ui/shell.js", "ui/chat.js", "ui/screens.js"]
  .map((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")).join("\n;\n");
const uiCode = ui.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

// ═══ PART E — THE TIER STRIP IS THE QUEUE'S SHAPE, AND STILL EXTRACTABLE ═════════════════════
{
  const P = require("./_probe-j12-tiers");
  const RES = { tiers: [{ tier: "uncategorized", id: "!u:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false }],
                activeTier: "staff", mainTier: "uncategorized" };
  const r = P.gate("strip", P.driveStrip({ res: RES, unread: ["uncategorized"] }),
    { expectAsked: true, expectButtons: true }, "PART E");

  ok(r.buttons.length === 2,
    "E: APPLIED — the strip must still paint its buttons after the reshape", r.buttons.length);
  ok(r.buttons.every((b) => /(^| )tab( |$)/.test(b.cls)),
    "E: EVERY TIER BUTTON CARRIES THE QUEUE'S `tab` CLASS — the same sub-button strip the queue " +
    "pane uses, so which tier is live reads exactly as which queue pane is live rather than as a " +
    "third kind of control", r.buttons.map((b) => b.cls));
  ok(r.buttons.every((b) => /chat-tier/.test(b.cls)),
    "E: and keeps `chat-tier` for what is genuinely particular to it — the unread dot's anchor, " +
    "which the queue strip has no equivalent of", r.buttons.map((b) => b.cls));
  ok(r.buttons[1].active === true && r.buttons[0].active === false,
    "E: the active marker is still the queue's `active`, and still reads the RESOLVER's answer",
    r.buttons.map((b) => b.active));
  ok(r.buttons[0].unread === true,
    "E: and the unread badge still renders — the reshape moved styling, not meaning",
    r.buttons.map((b) => b.unread));

  // THE CONTAINER SHARES THE QUEUE'S CLASS, so the two strips cannot drift apart in styling.
  ok(/refs\.chatTiers = el\("div", \{ class: "tabs chat-tiers" \}\)/.test(uiCode),
    "E: the container carries `tabs` beside `chat-tiers`, so anything the two strips share is " +
    "styled once", "container class not shared");

  // AND THE THREE DECLARATIONS THE OTHER GUARD BRACE-MATCHES FROM STILL RESOLVE.
  // `check-chat-tiers` anchors on these NAMES. Renaming one makes it REFUSE — and a refusal reads
  // like a pass to anyone not watching for it, which is why this is asserted here too.
  for (const name of ["_chatTierLabel", "_tierForChannel", "_renderChatTierStrip"]) {
    // These three moved to ui/chat.js with the CHAT banner at ddjp_392. This row exists to keep
    // `check-chat-tiers`'s extraction anchors honest, so it must name the file they are IN.
    const ex = P.extractFn("ui/chat.js", name);
    ok(ex.ok,
      "E: `" + name + "` still extracts by name. `check-chat-tiers` brace-matches from each of " +
      "these, so a rename would make it REFUSE rather than fail — and a refusal is easy to read " +
      "as a pass", ex.stage);
  }
}

console.log("[nav-surfaces] PASS — the chat tier strip is the QUEUE's sub-tab shape (" + asserts +
  " assertions): every tier button carries the queue's `tab` class and keeps `chat-tier` for its unread dot, the active " +
  "marker reads the resolver's answer, the container shares the queue's class, and the three declarations " +
  "`check-chat-tiers` brace-matches from still resolve — a rename there would make that guard REFUSE, which reads like a " +
  "pass to anyone not watching. (Its room-file parts, A–D, retired at J82 with room files.)");
