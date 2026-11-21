// tools/probes/mutate-743-space-tree.js
// SUBJECT: package 743 — every space in the room list's "Other Matrix rooms" opens as a tree (the owner's: "i like all spaces to
// be leavable in this manner and with drop down"; "im not sure if individual rooms should leavable from space there but id you
// thin so for users to manage their stuff do it"): each space's own rows and what is at the top (`features/room.js`
// `otherRooms`, `kids` and `top`, from the walk a space's Leave takes), and the list drawn as a tree with ▸ / ▾, the spaces first,
// each row inside a space with its own Leave (`ui/screens.js` `otherLine`). Held by `check-other-rooms` PART E. One row per
// way it could go wrong, each naming the failure it must cause (`check-break-verdict` asks the one rule).
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-740-on-air`: every edit is recorded on disk before it is made
// and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts AND when
// its result is read, or the row is VOID. Restored after every row and checked restored by hash. Run only in a fresh copy
// (HANDOVER §4).
//
//   node tools/probes/mutate-743-space-tree.js            every row
//   node tools/probes/mutate-743-space-tree.js ST1 ST7    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js", SC = "ui/screens.js";
const OR = "check-other-rooms";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── the data: each space's own rows, and the top ──
  ["ST1", [[RM, "      r.kids = own.after.concat(own.ids).sort((a, b) => at.get(a) - at.get(b));", "      r.kids = [];"]],
    OR, "E: EACH SPACE NAMES THE ROWS IT LISTS ITSELF", "RED"],                 // no space knows its rows
  ["ST2", [[RM, "    for (const r of rows) r.top = !inSome.has(r.roomId);", "    for (const r of rows) r.top = true;"]],
    OR, "E: AT THE TOP, WHAT NO SPACE HERE LISTS", "RED"],                      // every row at the top: the list flat again
  ["ST3", [[RM, "    for (const r of rows) if (!reached.has(r.roomId)) { r.top = true; walk(r.roomId); }\n", ""]],
    OR, "E: A LOOP OF SPACES NEVER HIDES THEM", "RED"],                        // a loop of spaces vanishes
  // ── the list on screen ──
  ["ST4", [[SC, "          const tops = spacesFirst(now.rooms.filter((r) => r.top !== false));", "          const tops = spacesFirst(now.rooms);"]],
    OR, "E: THE SPACES FIRST, THEN THE ROOMS IN NO SPACE", "RED"],              // a space's rows also at the top
  ["ST5", [[SC, "          const tops = spacesFirst(now.rooms.filter((r) => r.top !== false));", "          const tops = now.rooms.filter((r) => r.top !== false);"]],
    OR, "E: THE SPACES FIRST, THEN THE ROOMS IN NO SPACE", "RED"],              // the spaces among the rooms, by quiet alone
  ["ST6", [[SC, "            const open = kids.length > 0 && _othersSpaces.has(r.roomId);", "            const open = false;"]],
    OR, "E: ▸ OPENS IT", "RED"],                                               // ▸ opens nothing
  ["ST7", [[SC, "            const kids = (r.space && Array.isArray(r.kids)) ? spacesFirst(r.kids.map((id) => byId[id]).filter((k) => k && !above.has(k.roomId))) : [];",
    "            const kids = (r.space && Array.isArray(r.kids)) ? r.kids.map((id) => byId[id]).filter((k) => k && !above.has(k.roomId)) : [];"]],
    OR, "E: ▸ OPENS IT", "RED"],                                               // inside a space, its room before the space inside it
  ["ST8", [[SC, "            const kids = (r.space && Array.isArray(r.kids)) ? spacesFirst(r.kids.map((id) => byId[id]).filter((k) => k && !above.has(k.roomId))) : [];",
    "            const kids = (r.space && Array.isArray(r.kids)) ? spacesFirst(r.kids.map((id) => byId[id]).filter((k) => k)) : [];"]],
    OR, "E: A LOOP OPENS ONCE", "RED"],                                        // a space shown inside itself
  ["ST9", [[SC, "            if (!_roomsLocked && !rj && !job && !asking) {\n              const b = H.el(\"button\", { class: \"btn-secondary room-open-btn room-leave-btn\", text: \"Leave\", title: inside",
    "            if (!_roomsLocked && !rj && !job && !asking && above.size === 0) {\n              const b = H.el(\"button\", { class: \"btn-secondary room-open-btn room-leave-btn\", text: \"Leave\", title: inside"]],
    OR, "E: UNLOCKED, EACH ROW INSIDE A SPACE HAS ITS OWN LEAVE", "RED"],      // only the top rows can be left
  ["ST10", [[SC, "          hide.onclick = (ev) => { stop(ev); _othersOpen = false; _othersArmed = false; _othersSpaces = new Set(); redraw(); };",
    "          hide.onclick = (ev) => { stop(ev); _othersOpen = false; _othersArmed = false; redraw(); };"]],
    OR, "E: HIDE CLOSES THE SPACES TOO", "RED"],                               // Hide keeps them open
  ["ST11", [[SC, "_othersOpen = false; _othersArmed = false; _othersAsk = null; _othersSpaces = new Set(); }",
    "_othersOpen = false; _othersArmed = false; _othersAsk = null; }"]],
    OR, "E: LEAVING THE ROOM LIST CLOSES THEM", "RED"],                        // they stay open across screens
];
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const want = process.argv.slice(2);
const journalWasThere = fs.existsSync(J.JOURNAL);
process.on("exit", () => {
  try { if (!journalWasThere && JSON.parse(fs.readFileSync(J.JOURNAL, "utf8")).entries.length === 0) fs.unlinkSync(J.JOURNAL); } catch (e) { /* leave it */ }
});
const rec = J.recover();
if (!rec.clean) console.log("recovered a dirty journal from a previous run: " + JSON.stringify(rec.restored.map((r) => r.file)));
let good = 0, bad = 0;
for (const [id, edits, guard, expect, wantMark, parts] of ROWS) {
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
      const h = J.open("mutate-743-space-tree:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const env = Object.assign({}, process.env, parts ? { HB_PARTS: parts } : {});
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 900000, env: env });
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
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + (parts ? " [" + parts + "]" : "") + "  (" + expect + ")"); }
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
