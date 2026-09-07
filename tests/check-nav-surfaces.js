// tests/check-nav-surfaces.js
// WALL: THREE NAVIGATION SURFACES THAT SAY WHAT THEY DO.
//
// Three changes from a browser run, and TWO OF THE THREE ASKS WERE WRONG ABOUT WHAT EXISTED.
// Recorded here as measurements, so a later reader can check the correction rather than inherit it.
//
//   PART A — SAVES ARE ONLY KNOWABLE FOR THE OPEN ROOM, and the control is honest about it.
//     A per-room list was asked for and CANNOT EXIST: `Floor._seen` holds one room's checkpoints
//     and a seed carries no room id, so a per-row list would serve one room's saves under
//     another's name. The button opens the room instead, and the section's label names the room
//     it is actually listing.
//   PART B — the empty case is VISIBLE. It used to `display:none`, which is why a browser run
//     reported "no save control exists" — hidden is indistinguishable from absent.
//   PART C — the export note is driven from `exportCheckpoint`'s RETURN, never from its wording.
//     A grep for the sentence tests that the words exist, which is how a survivor got through two
//     jobs ago.
//   PART D — one field, two buttons: satisfied by LAYOUT. No function was added, and the id
//     ORDER `check-import` pins is unchanged.
//   PART E — the tier strip is the queue's sub-tab shape, and the three declarations
//     `check-chat-tiers` brace-matches from still resolve.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[nav-surfaces] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");
const ui = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
const uiCode = ui.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// ═══ PART A — SAVES ARE ONLY KNOWABLE FOR THE OPEN ROOM ══════════════════════════════════════
{
  // The measurement the whole control rests on, re-driven here rather than cited.
  const F = require("./_fixtures");
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const seed = sd.StateDeriver.buildSeed(F.sortLog(F.playingRoom({ songs: 2 }).log), null);
  const keys = Object.keys(seed);
  ok(keys.length > 3,
    "A: APPLIED — a seed must be inspectable, or the claim below is about nothing", keys);
  ok(!keys.some((k) => /room|space/i.test(k)),
    "A: A CHECKPOINT SEED CARRIES NO ROOM ID. So a held checkpoint cannot be attributed to a room " +
    "by inspection, and a per-room list of saves is not a feature that was skipped — it is one " +
    "that cannot be built without serving one room's state under another room's name", keys);

  const floor = fs.readFileSync(path.join(ROOT, "backends/backend1/floor.js"), "utf8");
  ok(/function reset\(\) \{ _seen = \[\];/.test(floor),
    "A: and `Floor.reset()` empties the held list, so it holds ONE room's checkpoints at a time",
    "no reset");

  // THE HONEST CONTROL: the button opens the room. It does not render a list.
  const savesFn = uiCode.match(/function savesButton\(room\)[\s\S]*?\n    \}/);
  ok(!!savesFn, "A: APPLIED — the saves button must be findable", "not found");
  ok(/openRoom\(room\)/.test(savesFn[0]),
    "A: THE BUTTON OPENS THE ROOM rather than rendering a per-room list. A list that quietly " +
    "showed the OPEN room's saves under another room's row is a plausible value with a " +
    "scrollbar, which is the shape this tree has recorded more than once", savesFn[0]);
  ok(!/heldCheckpoints/.test(savesFn[0]),
    "A: and it does not read the held list itself — there is no per-room answer for it to read",
    savesFn[0]);
  ok(/stopPropagation/.test(savesFn[0]),
    "A: it stops the click reaching the row behind it, so 'Saves' and 'open' are two acts rather " +
    "than one that happens twice", savesFn[0]);
}

// ═══ PART B — THE EMPTY CASE IS VISIBLE ══════════════════════════════════════════════════════
{
  const sec = uiCode.slice(uiCode.indexOf("function renderExportSection()"));
  const body = sec.slice(0, sec.indexOf("\n  }\n") + 4);
  ok(body.length > 200, "B: APPLIED — the renderer body must be extractable", body.length);

  ok(!/if \(!held\.length\) \{ box\.style\.display = "none"; return; \}/.test(body),
    "B: THE EMPTY CASE NO LONGER HIDES THE SECTION. It used to, which is exactly why a browser " +
    "run reported that no save control existed — the section is hidden until a room has been " +
    "opened once, and a hidden control is indistinguishable from an absent one", "still hides");
  ok(/box\.style\.display = "flex";\n    if \(!held\.length\)/.test(body),
    "B: the container is shown BEFORE the empty test, so the empty branch renders into a visible " +
    "box rather than into one nobody can see", body.slice(0, 400));
  ok(/no saved checkpoints yet/.test(body) && /Open a room to see the saves/.test(body),
    "B: and it says WHICH empty it is — 'that room has none' and 'open a room' are different " +
    "facts, and telling somebody the second when the first is true reads as the control not " +
    "working", body.slice(0, 600));
  ok(/clear\(box\)/.test(body),
    "B: the renderer still clears its own container, unchanged", "no clear");
}

// ═══ PART C — THE NOTE IS DRIVEN FROM THE RETURN, NOT GREPPED ════════════════════════════════
// A grep for the note's wording tests that the words exist, not that the branch runs. That is how
// `mutate-dm-gaps` M7 survived two jobs ago, and the note here is the same shape: a string
// literal describing what the code does.
{
  const vm = require("vm");
  // BRACE-MATCHED, not regex-terminated. A `[\s\S]*?` to the next `};` ran past the handler's own
  // closing brace and swallowed the `return btn;` after it — the extraction compiled to an illegal
  // return and the guard died by CRASH rather than by assertion, which is not red enough.
  // QUALIFIED BY CONTENT, because `btn.onclick = () => {` appears several times in this file and
  // the first match was a different handler entirely (it referenced `getText`, which this one has
  // never heard of). An anchor that matches more than once is not an anchor.
  const marker = uiCode.indexOf("const out = Room.exportCheckpoint(cp.id);");
  ok(marker > 0, "C: APPLIED — the export handler must be locatable by its own content", marker);
  const at = uiCode.lastIndexOf("btn.onclick = () => {", marker);
  ok(at > 0, "C: APPLIED — the Save handler must be findable", at);
  let depth = 0, end = -1;
  for (let i = uiCode.indexOf("{", at); i < uiCode.length; i++) {
    if (uiCode[i] === "{") depth++;
    else if (uiCode[i] === "}") { depth--; if (!depth) { end = i + 1; break; } }
  }
  ok(end > at, "C: APPLIED — and brace-matchable", { at, end });
  const onclick = [uiCode.slice(at, end) + ";"];

  function drive(out) {
    const note = { textContent: "" };
    const dl = [];
    const ctx = {
      Room: { exportCheckpoint: () => out },
      _downloadJson: (f, n) => dl.push(n),
      _exportFilename: () => "f.json",
      note: note, cp: { id: "$c" }, info: { room: { name: "R" } },
    };
    vm.createContext(ctx);
    vm.runInContext("const btn = {};\n" + onclick[0] + "\nbtn.onclick();", ctx);
    return { note: note.textContent, downloaded: dl };
  }

  const okFile = drive({ ok: true, importable: true, snapshots: 3, file: {} });
  ok(okFile.downloaded.length === 1,
    "C: APPLIED — a successful export must download, or the notes below describe a path that " +
    "never ran", okFile);
  ok(/3 snapshot/.test(okFile.note),
    "C: an IMPORTABLE file reports its snapshot count — driven from the RETURNED `importable` and " +
    "`snapshots`, not read off the source", okFile.note);

  const peer = drive({ ok: true, importable: false, rank: "staff", snapshots: 2, file: {} });
  ok(peer.downloaded.length === 1,
    "C: a peer-authored file still SAVES — it is a real checkpoint and refusing to write it would " +
    "be refusing the export, not the import", peer);
  ok(/staff/.test(peer.note) && /cannot be created from this file/.test(peer.note),
    "C: AND THE NOTE NAMES THE AUTHOR'S RANK, taken from the RETURN. This is where a grep would " +
    "have passed against a dead branch: the sentence is a string literal in the source whether or " +
    "not the branch that emits it ever runs", peer.note);
  ok(peer.note !== okFile.note,
    "C control: the two branches say different things, so the note is a reading of the return " +
    "rather than one caption for both", { importable: okFile.note, peer: peer.note });

  const bad = drive({ ok: false, reason: "no-such-checkpoint" });
  ok(bad.downloaded.length === 0 && /no-such-checkpoint/.test(bad.note),
    "C: a refused export downloads NOTHING and names the reason — a file written from a refusal " +
    "would be a file with nothing in it", bad);
}

// ═══ PART D — ONE FIELD, TWO BUTTONS: SATISFIED BY LAYOUT ════════════════════════════════════
{
  const nameAt = html.indexOf('id="input-room-name"');
  const createAt = html.indexOf('id="btn-create-room"');
  const fileAt = html.indexOf('id="input-import-file"');
  const fromFileAt = html.indexOf('id="btn-create-from-file"');
  ok(nameAt > 0 && createAt > 0 && fileAt > 0 && fromFileAt > 0,
    "D: APPLIED — all four controls must be present", { nameAt, createAt, fileAt, fromFileAt });

  ok(nameAt < createAt && nameAt < fromFileAt,
    "D: THE NAME FIELD PRECEDES BOTH BUTTONS, so what it belongs to is visible rather than " +
    "inferred. It always FED both — `app.js` has read it for `btn-create-from-file` since J27 — " +
    "and the defect was that a second `.room-actions` row read as a separate form", 
    { nameAt, createAt, fromFileAt });
  ok(createAt < fromFileAt,
    "D: with Create Room first and Create-from-file beside it, which is the requested shape",
    { createAt, fromFileAt });

  // THE ORDER `check-import` PINS IS UNCHANGED. Two guards now depend on this sequence, and a
  // layout change that broke it would fail there rather than here — stated so the coupling is
  // visible from both sides.
  const sectionAt = html.indexOf('id="create-room-section"');
  const exportAt = html.indexOf('id="export-section"');
  ok(sectionAt < fileAt && fileAt < exportAt,
    "D: and `input-import-file` still falls between `create-room-section` and `export-section` — " +
    "the ordering `check-import` asserts. The rows moved; the sequence did not", 
    { sectionAt, fileAt, exportAt });

  // NO FUNCTION WAS ADDED. The next reader of that request should not assume one was.
  const app = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
  ok(/getElementById\("btn-create-from-file"\)/.test(app),
    "D: the button is wired in `app.js` — a THIRD wiring site beside `ui/interface.js` and the " +
    "DOM, which is why grepping the UI file reported an absence that was not one", "not wired");
  ok(/getElementById\("input-room-name"\)/.test(app),
    "D: and it reads the SHARED name field, so one-field-two-buttons is a fact about the wiring " +
    "rather than something this change introduced", "not shared");
}

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
    const ex = P.extractFn("ui/interface.js", name);
    ok(ex.ok,
      "E: `" + name + "` still extracts by name. `check-chat-tiers` brace-matches from each of " +
      "these, so a rename would make it REFUSE rather than fail — and a refusal is easy to read " +
      "as a pass", ex.stage);
  }
}

console.log("[nav-surfaces] PASS — three navigation surfaces that say what they do (" + asserts +
  " assertions). TWO OF THE THREE ASKS WERE WRONG ABOUT WHAT EXISTED. **A per-room list of saves " +
  "CANNOT EXIST**: a checkpoint seed carries no room id and `Floor._seen` holds one room's " +
  "checkpoints at a time, so a per-row list would serve one room's state under another room's " +
  "name — the button OPENS the room instead and the section names the room it is listing. **The " +
  "save control was never missing**, it was hidden: the empty case did `display:none`, which is " +
  "indistinguishable from an absent feature, and it now says WHICH empty it is. **The export " +
  "note is driven from `exportCheckpoint`'s RETURN**, not grepped — a grep for its wording tests " +
  "that the words exist, which is how a survivor got through two jobs ago. **One field, two " +
  "buttons was satisfied by LAYOUT**: the field always fed both, `app.js` has wired it since J27, " +
  "and no function was added. And the tier strip is now the QUEUE's sub-tab shape while the three " +
  "declarations `check-chat-tiers` brace-matches from still resolve — a rename there would make " +
  "that guard REFUSE, which reads like a pass to anyone not watching");
