// tools/probes/mutate-j138-dj-card.js
// SUBJECT: J138 — the DJ's picture on the player's line opens their card (`ui/player.js` `_setNpLabel`: the picture in a bare
// wrapper wired with `Roster._wireCardTrigger`), and so do the DJ names in History (`ui/panels.js` `renderHistory`'s `.sr-who`),
// held by `check-dj-card`. Live, `?v=605` (the owner's checks 56 and 64): the picture opened nothing, History's names neither.
// One row per way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must
// stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j138-dj-card.js            every row
//   node tools/probes/mutate-j138-dj-card.js DC1 DC6    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const PLAYER = "ui/player.js";
const PANELS = "ui/panels.js";
const G = "check-dj-card";
const PWIRE = "      Roster._wireCardTrigger(avBox, djId);";
const PBOX = '      const avBox = H.el("span", {}, [refs.npAvatar]);';
const PREPL = "      refs.npLabel.replaceChildren(\n        avBox,";
const HWIRE = "        Roster._wireCardTrigger(who, h.dj);";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE PLAYER'S PICTURE (`check-dj-card` A, B) ──
  ["DC1", [[PLAYER, PWIRE + "\n", ""]],
    G, "A: THE PICTURE IS A CARD TRIGGER", "RED"],   // not wired: 605's picture
  ["DC2", [[PLAYER, PWIRE, "      Roster._wireCardTrigger(refs.npAvatar, djId);"]],
    G, "A: AFTER THE PICTURE IS REPLACED (an avatar arriving) A CLICK ON THE NEW ONE STILL DRAWS THE CARD", "RED"],   // wired on the
    // picture node, not its wrapper: an avatar arriving replaces the node and takes the handler with it
  ["DC3", [[PLAYER, PWIRE, "      Roster._wireCardTrigger(avBox, Room.getMyId());"]],
    G, "A: A CLICK ON THE PICTURE DRAWS THAT DJ'S CARD", "RED"],   // the wrong person's card
  ["DC4", [[PLAYER, PBOX, '      const avBox = H.el("span", { class: "chat-av" }, [refs.npAvatar]);']],
    G, "B: THE PICTURE'S WRAPPER IS A BARE SPAN", "RED"],   // the wrapper borrows a look of its own
  ["DC5", [[PLAYER, PREPL, "      refs.npLabel.replaceChildren(\n        refs.npAvatar,"]],
    G, "A: THE PICTURE IS A CARD TRIGGER", "RED"],   // the wired wrapper left out of the line: the picture alone, unwired
  ["DC6", [[PLAYER, PWIRE, PWIRE + "\n      avBox.style.display = \"inline-block\";"]],
    G, "B: THE PICTURE'S WRAPPER IS A BARE SPAN", "RED"],   // the wrapper given a box of its own
  // ── HISTORY'S DJ NAMES (`check-dj-card` C, D) ──
  ["DC7", [[PANELS, HWIRE + "\n", ""]],
    G, "C: EVERY HISTORY ROW'S DJ NAME IS A CARD TRIGGER", "RED"],   // not wired: 605's History
  ["DC8", [[PANELS, HWIRE, "        Roster._wireCardTrigger(who, rows[0].dj);"]],
    G, "C: A CLICK ON EACH DRAWS THAT ROW'S DJ'S CARD", "RED"],   // every name opens the newest row's DJ
  ["DC9", [[PANELS, HWIRE, "        Roster._wireCardTrigger(sub, h.dj);"]],
    G, "C: A CLICK ON THE ROW'S TITLE OR AGE DRAWS NO CARD", "RED"],   // the whole line wired, not the name
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[PANELS, HWIRE, "        Roster._wireCardTrigger(who, h.dj, undefined);"]], G, "", "GREEN"],   // the level left to the roster, said aloud
  ["G2", [[PLAYER, PWIRE, "      Roster._wireCardTrigger(avBox, String(djId));"]], G, "", "GREEN"],   // the same id
];

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
// The journal file is the run's own; one this run created and left empty is removed at the end, so a copy the file ran
// in comes back byte for byte (HANDOVER §4). A journal still holding entries is never removed.
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark] of ROWS) {
  if (want.length && want.indexOf(id) < 0) continue;
  // PLANNED IN MEMORY FIRST: every anchor must occur exactly once in the bytes it will be applied to, or nothing is written.
  const files = new Map();
  let voided = null;
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    if (!files.has(file)) { const o = fs.readFileSync(file, "utf8"); files.set(file, { rel, original: o, mutated: o }); }
    const f = files.get(file);
    const n = f.mutated.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel + ": " + JSON.stringify(oldS.slice(0, 60)); break; }
    const next = f.mutated.replace(oldS, () => newS);
    if (next === f.mutated) { voided = "the edit changed nothing in " + rel; break; }
    f.mutated = next;
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  const handles = [];
  let out = "", code = 0, landed = true, held = true;
  try {
    for (const [file, f] of files) {
      const h = J.open("mutate-j138-dj-card:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
      out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
      held = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);   // still there as the result is read
    }
  } finally { for (const h of handles) h.restore(); }
  const restored = [...files].every(([file, f]) => sha(fs.readFileSync(file, "utf8")) === sha(f.original));
  if (!restored) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (!landed) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
  if (!held) { console.log("VOID  " + id + " — an edit was gone by the time the result was read"); bad++; continue; }
  if (wantMark === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else {
      bad++;
      const first = (out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160);
      console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (first ? " — got " + first : "") + (v.why ? " (" + v.why + ")" : ""));
    }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected green: " + ((out.match(/\] FAIL[^\n]*/) || [""])[0].slice(0, 160))); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
