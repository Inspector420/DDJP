// tools/probes/mutate-j140-one-bot.js
// SUBJECT: J140 — one bot per room (the owner's: "turn unavailable and say bot already assigned"): the rule `Room.botTaken`
// (`features/room.js`), read by the adapter as availability (`features/actions.js`, the `rank.assign` row and `describe`'s
// `permitted`), shown by the card's picker (`ui/roster.js` `rankSelect`), and refused at the act (`Room.assignRank`); held by
// `check-one-bot`. One row per way it could go wrong, each naming the failure it must cause; the controls change nothing that
// matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j140-one-bot.js            every row
//   node tools/probes/mutate-j140-one-bot.js OB1 OB3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const ROOM = "features/room.js";
const ACT = "features/actions.js";
const UI = "ui/roster.js";
const G = "check-one-bot";
const AVAIL = "return !j && !_botTaken(t); },";
const WORDS = "const b = _botTaken(t); return b ? b.text : null; } },";
const TARGET = "const avail = spec.avail ? !!spec.avail(s, ctx.target) : true;";
const PERMITTED = "const out = { enabled: enabled, permitted: cap.permitted && botPolicy.may !== false, reason: reason };";
const TOPONLY = "    if (top === null || level !== top) return null;";
const READ = "    try { at = MatrixBridge.accountsAtLevel(current.spaceId, top); } catch (e) { at = null; }\n    if (!at || !Array.isArray(at.who) || at.who.indexOf(userId) >= 0) return null;";
const SELF = "    if (!at || !Array.isArray(at.who) || at.who.indexOf(userId) >= 0) return null;";
const DEFAULT = "    if (!at.who.length && at.defaultIsLevel !== true) return null;";
const ACTREFUSE = "    { const b = botTaken(userId, level);";
const HIDE = "      if (!d.enabled && !d.permitted) return;";
const GREY = "      if (!d.enabled) {\n        sel.appendChild(H.el(\"option\", { value: String(r.level), disabled: \"disabled\" }, d.reason || r.name));\n        return;\n      }\n";
const WHOSE = "        }, m.userId);";
const HOLDERS = "holders: at.who.slice(),";
const ROOMCHECK = 'typeof Room.botTaken === "function")';
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["OB1", [[ACT, AVAIL, "return !j; },"]],
    G, "WHILE AN ACCOUNT HOLDS THE BOT'S RANK, giving it to someone else is NOT AVAILABLE", "RED"],   // the adapter forgets the rule: 689's picker
  ["OB2", [[ROOM, ACTREFUSE, "    { const b = null;"]],
    G, "`Room.assignRank` REFUSES A SECOND BOT, by name", "RED"],   // the act forgets it: any caller makes a second bot
  ["OB3", [[ROOM, SELF, "    if (!at || !Array.isArray(at.who)) return null;"]],
    G, "the bot's own level for THE BOT ITSELF is available", "RED"],   // the person a change is for counted as a holder: the bot's repair refused
  ["OB4", [[ROOM, DEFAULT, "    if (!at.who.length) return null;"]],
    G, "a room whose DEFAULT level is the bot's (everyone holds it): not available", "RED"],   // the default level ignored
  ["OB5", [[ROOM, READ, "    try { at = MatrixBridge.accountsAtLevel(current.spaceId, top); } catch (e) { at = null; }\n    if (!at) return { reason: \"bot-already-assigned\", text: BOT_TAKEN, holders: [], defaultIsLevel: false };\n    if (!Array.isArray(at.who) || at.who.indexOf(userId) >= 0) return null;"]],
    G, "a power list this tab cannot read refuses nothing", "RED"],   // no reading taken as a bot: closed for good on an unreadable list
  ["OB6", [[ROOM, TOPONLY, "    if (top === null) return null;"]],
    G, "CONTROL — the other rungs are untouched", "RED"],   // the rule asked of every rung, not only the bot's
  ["OB7", [[ACT, TARGET, "const avail = spec.avail ? !!spec.avail(s) : true;"]],
    G, "WHILE AN ACCOUNT HOLDS THE BOT'S RANK, giving it to someone else is NOT AVAILABLE", "RED"],   // availability not handed the target
  ["OB8", [[ACT, WORDS, "return null; } },"]],
    G, "WHILE AN ACCOUNT HOLDS THE BOT'S RANK, giving it to someone else is NOT AVAILABLE — \"Bot already assigned\"", "RED"],   // greyed with no words
  ["OB9", [[ACT, PERMITTED, "const out = { enabled: enabled, reason: reason };"]],
    G, "and it is still PERMITTED", "RED"],   // the rule half not said: the picker cannot tell "not yours" from "not now"
  ["OB10", [[UI, HIDE, "      if (!d.enabled) return;"]],
    G, "THE BOT CHOICE, WHILE ANOTHER ACCOUNT HOLDS IT, READS \"Bot already assigned\" AND IS GREYED", "RED"],   // hidden, not greyed
  ["OB11", [[UI, GREY, ""]],
    G, "THE BOT CHOICE, WHILE ANOTHER ACCOUNT HOLDS IT, READS \"Bot already assigned\" AND IS GREYED", "RED"],   // shown live, "appoint", a second bot offered
  ["OB12", [[UI, WHOSE, "        });"]],
    G, "THE BOT'S OWN CARD", "RED"],   // the card does not say whose it is: asked about nobody, the bot's own card greyed
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[ROOM, HOLDERS, "holders: at.who,"]], G, "", "GREEN"],   // the holders as the list itself, not a copy: nothing reads it after
  ["G2", [[ACT, ROOMCHECK, '!!Room.botTaken)']], G, "", "GREEN"],   // the same presence test, spelt another way
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
      const h = J.open("mutate-j140-one-bot:" + id, file);   // journalled BEFORE the write
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
