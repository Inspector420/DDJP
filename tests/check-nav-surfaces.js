// tests/check-nav-surfaces.js
// SUBJECT: ui/shell.js, ui/chat.js
// WALL: THE CHAT BUTTON SITS BETWEEN THE TEXT BOX AND SEND, AND ITS EXTRACTION ANCHORS STILL RESOLVE.
//
// This guard held three navigation surfaces from a browser run. Two of them were the room-file controls — the Saves
// button and its section (PARTS A–B), the export note (PART C) and the create-from-file row (PART D) — RETIRED AT J82
// with room files (owner's ruling 1; `check-no-room-files` PART A holds that they are gone). What remains:
//
//   PART E — the chat button is in the input row, between the text box and Send; its menu marks the current chat with the
//     queue's own `active`; there is no strip above the box; and the declarations `check-chat-tiers` brace-matches from
//     still resolve.
// RE-AIMED AT J128 (the owner's): PART E held the owner's browser-run ruling that the tier strip take the QUEUE'S SUB-TAB
// SHAPE — `tab` on every tier button, `tabs` on the container. The owner replaced the strip with one chat button between the
// text box and Send, opening a menu upwards, so the strip's shape has nothing left to hold. What carries over: the current
// chat is marked with the queue's own selected marker (`active`), and the extraction anchors.

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

// ═══ PART E — THE CHAT BUTTON IS IN THE INPUT ROW, AND STILL EXTRACTABLE ════════════════════
{
  const P = require("./_probe-j12-tiers");
  const RES = { tiers: [{ tier: "uncategorized", id: "!u:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false }],
                activeTier: "staff", mainTier: "uncategorized" };
  const r = P.gate("picker", P.drivePicker({ res: RES, unread: ["uncategorized"] }),
    { expectAsked: true, expectButtons: true }, "PART E");

  ok(r.button && r.buttons.length === 2,
    "E: APPLIED — the chat button must still paint, and its menu its chats", { button: !!r.button, items: r.buttons.length });
  ok(r.buttons[1].active === true && r.buttons[0].active === false,
    "E: the current chat is marked with the QUEUE'S OWN `active` — which chat is live reads as which queue pane is live — " +
    "and it still reads the RESOLVER's answer", r.buttons.map((b) => b.active));
  ok(r.buttons[0].unread === true,
    "E: and the unread badge still renders — the reshape moved the control, not the meaning",
    r.buttons.map((b) => b.unread));

  // WHERE IT SITS (J128, the owner's): in the input row, between the text box (and its counter) and Send — and the strip
  // above the box is gone.
  ok(/el\("div", \{ class: "chat-input-row" \}, \[refs\.chatInput, refs\.chatCount, refs\.chatPick,\s*refs\.chatSend = el\("button", \{ text: "Send"/.test(uiCode),
    "E: THE CHAT BUTTON'S HOLDER SITS BETWEEN THE TEXT BOX AND SEND", "input row not in that order");
  ok(!/refs\.chatTiers\b/.test(uiCode) && !/class: "tabs chat-tiers"/.test(uiCode),
    "E: and there is NO TIER STRIP above the box any more", "a strip is still built");

  // AND THE DECLARATIONS THE OTHER GUARD BRACE-MATCHES FROM STILL RESOLVE.
  // `check-chat-tiers` anchors on these NAMES. Renaming one makes it REFUSE — and a refusal reads
  // like a pass to anyone not watching for it, which is why this is asserted here too.
  // `_renderChatTierStrip` became `_renderChatPicker` at J128, and `_chatLocked` joined (the button's red outline reads it).
  for (const name of ["_chatTierLabel", "_tierForChannel", "_renderChatPicker", "_chatLocked"]) {
    // These moved to ui/chat.js with the CHAT banner at ddjp_392. This row exists to keep
    // `check-chat-tiers`'s extraction anchors honest, so it must name the file they are IN.
    const ex = P.extractFn("ui/chat.js", name);
    ok(ex.ok,
      "E: `" + name + "` still extracts by name. `check-chat-tiers` brace-matches from each of " +
      "these, so a rename would make it REFUSE rather than fail — and a refusal is easy to read " +
      "as a pass", ex.stage);
  }
}

console.log("[nav-surfaces] PASS — the chat button sits between the text box and Send (J128, the owner's; the tier strip " +
  "above the box, in the queue's sub-tab shape, is gone) (" + asserts + " assertions): its menu marks the current chat with the " +
  "queue's own `active`, read from the resolver, the unread badge renders, and the declarations `check-chat-tiers` " +
  "brace-matches from still resolve — a rename there would make that guard REFUSE, which reads like a " +
  "pass to anyone not watching. (Its room-file parts, A–D, retired at J82 with room files.)");
