// tools/probes/mutate-j147-ask-less.js
// SUBJECT: J147 — asking Matrix less, step 1 (the owner's plan, part 4), and the top bar, People and DMs (`ddjp_699`): the sync's
// one filter and members on request (`backends/backend1/matrixbridge.js` `syncFilterDefinition`, `_buildSyncFilter`, `start`,
// `loadMembers`, `membersReady`, `membersOf`, `memberIn`, `memberEventIn`, and every place that loads first: `_runRankSteps`,
// `_reconcileAfterUpgrade`, `_memberAction`, `waitForSync`, `addToRoomScope`; `backends/backend1/matrixaccount.js` the DM scan;
// `features/room.js` the opening) — `check-ask-less` and `check-presence-chat` G; the top bar re-fitting when its content changes
// (`ui/shell.js` `_fitHeader`, `buildMainDom`) — `check-header-refit`; copy-my-ID and the layout in your picture's menu, the top
// bar without ⊞ and its copy button (`ui/roster.js`, `ui/shell.js`, `ui/screens.js`, `index.html`) — `check-view-menu`; People's
// invite on the DM search box's line (`index.html`) — `check-panel-tops`; People's window in casual words (`ui/panels.js`
// `_spanText`) — `check-who-is-here` F. One row per way it could go wrong, each naming the failure it must cause; the controls
// change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j147-ask-less.js            every row
//   node tools/probes/mutate-j147-ask-less.js AL1 TL5    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js";
const MA = "backends/backend1/matrixaccount.js";
const ROOM = "features/room.js";
const RO = "ui/roster.js";
const SH = "ui/shell.js";
const SC = "ui/screens.js";
const PN = "ui/panels.js";
const PAGE = "index.html";
const AL = "check-ask-less";
const PC = "check-presence-chat";
const HR = "check-header-refit";
const VM = "check-view-menu";
const PT = "check-panel-tops";
const WH = "check-who-is-here";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: the sync's filter ──
  // AL1 and AL3 re-anchored at `ddjp_700`: the definition's room half is on its own line since presence joined the filter (same
  // intent). AL2 retired at `ddjp_700`: it dropped presence while the avatar code read it — the reading is gone and the filter
  // drops presence now; `mutate-j148-pictures` PP7 (a presence reader back while it is dropped) and PP8 (presence asked for while
  // nothing reads it) hold the rule both ways.
  ["AL1", [[MB, "      room: { ephemeral: { not_types: SYNC_EPHEMERAL_DROPPED.slice() }, state: { lazy_load_members: true } } };", "      room: { state: { lazy_load_members: true } } };"]],
    AL, "L: TYPING — nothing reads it, so the sync does not ask for it", "RED"],   // typing and receipts asked for again
  ["AL3", [[MB, "      room: { ephemeral: { not_types: SYNC_EPHEMERAL_DROPPED.slice() }, state: { lazy_load_members: true } } };", "      room: { ephemeral: { not_types: SYNC_EPHEMERAL_DROPPED.slice() } } };"]],
    AL, "L: ROOM MEMBERS ON REQUEST", "RED"],   // every room's members in every sync again
  ["AL4", [[MB, "    await client.startClient(filter ? { initialSyncLimit: 1, filter: filter, lazyLoadMembers: true } : { initialSyncLimit: 1 });", "    await client.startClient({ initialSyncLimit: 1 });"]],
    AL, "F: IT HANDS THE SDK THE ONE DEFINITION", "RED"],   // the filter built and never handed over (698)
  ["AL5", [[MB, "    await client.startClient(filter ? { initialSyncLimit: 1, filter: filter, lazyLoadMembers: true } : { initialSyncLimit: 1 });", "    await client.startClient(filter ? { initialSyncLimit: 1, filter: filter } : { initialSyncLimit: 1 });"]],
    AL, "F: WITH `lazyLoadMembers`", "RED"],   // the SDK's rooms not told their members come on request
  // ── JOB 1: members on request, loaded first ──
  ["AL6", [[ROOM, "    await MatrixBridge.loadMembers([spaceId].concat(Object.values(channels)), \"opening the room\");\n", ""]],
    AL, "B1: THE OPENING LOADS THE SPACE'S AND EVERY JOINED CHANNEL'S MEMBERS", "RED"],   // the opening reads People from the few the sync named
  ["AL7", [[MB, "    if (_membersToLoad(memberRooms)) await until(loadMembers(memberRooms, \"a rank change\"));\n", ""]],
    AL, "B2: AND READS NONE BEFORE ITS LOAD", "RED"],   // read before loaded: each read cannot tell (an early read asks for the load it skipped)
  ["AL8", [[MB, "    if (_membersToLoad(memberRooms)) await loadMembers(memberRooms, why);\n", ""]],
    AL, "B3: AND READS NONE BEFORE ITS LOAD", "RED"],   // Repair reads the Space before its members landed: nobody invited
  ["AL9", [[MB, "    if (_membersToLoad(rooms.map((r) => r.roomId))) await loadMembers(rooms.map((r) => r.roomId), \"a kick or ban\");", "    if (false) await loadMembers(rooms.map((r) => r.roomId), \"a kick or ban\");"]],
    AL, "B5: A KICK LOADS THE ROOMS' MEMBERS BEFORE IT READS THE TARGET BACK", "RED"],   // every room "unverified"
  ["AL10", [[MA, "      const held = B1MatrixBridge.membersReady(room);\n", "      const held = true;\n"]],
    AL, "B6: BEFORE ITS MEMBERS LAND, THE DM SCAN PASSES THE ROOM BY AND ASKS FOR THEM", "RED"],   // the DM scan reads a list holding only this account
  ["AL11", [[MB, "    if (small.length) await loadMembers(small, \"direct messages (rooms of two or fewer)\");\n", ""]],
    AL, "B6: THE FIRST SYNC'S WAIT LOADS EVERY ROOM OF TWO OR FEWER", "RED"],   // the lobby binds DMs before their members land
  ["AL12", [[MB, "    const members = membersOf(room, \"joined\", \"People (the room's members)\");\n", "    const members = room.getJoinedMembers ? room.getJoinedMembers() : null;\n"]],
    AL, "A: NO SDK MEMBER READ OUTSIDE THE THREE", "RED"],   // People reads the SDK straight past the check
  ["AL13", [[MB, "    if (_membersPartial(room)) { _earlyRead(room, why); return null; }\n", ""]],
    PC, "G: A CHANNEL WHOSE MEMBERS ARE NOT LOADED YET is null for both", "RED"],   // a partial list read as the room's: the bot would invite everyone else
  ["AL14", [[MB, "    try { const r = client ? client.getRoom(roomId) : null; if (r) _loadRoomMembers(r); } catch (e) {}\n", ""]],
    AL, "B1: A CHANNEL ADDED TO THE ROOM AFTER ITS OPENING HAS ITS MEMBERS ASKED FOR AT ONCE", "RED"],   // a late channel's members never asked for
  ["AL15", [[MB, "    if (!members) return null;\n    for (const m of members) {\n      out.push({ userId: m.userId, name: _sanitizeName(m.name) || m.userId, level: _userLevelInRoom(room, m.userId) });", "    if (!members) return [];\n    for (const m of members) {\n      out.push({ userId: m.userId, name: _sanitizeName(m.name) || m.userId, level: _userLevelInRoom(room, m.userId) });"]],
    AL, "B1b: PEOPLE READ BEFORE THE SPACE'S MEMBERS LANDED IS NULL", "RED"],   // "nobody" for "cannot tell yet"
  // ── JOB 2: the top bar re-fits when its content changes ──
  ["HR1", [[SH, "      _headerFit.mo = new MutationObserver(() => _fitHeader());\n      _headerFit.mo.observe(header, { childList: true, subtree: true, characterData: true });\n", ""]],
    HR, "A: THE COUNTDOWN APPEARS — THE HEADER RE-FITS, WITH NO RESIZE AND NO FIT ASKED FOR", "RED"],   // 698: only a width change re-fits
  ["HR2", [[SH, "    if (_headerFit.mo) { try { _headerFit.mo.takeRecords(); } catch (e) {} }\n", ""]],
    HR, "C: ONE CHANGE, ONE FIT", "RED"],   // the fit's own writes call it back, for ever
  ["HR3", [[SH, "      _headerFit.mo.observe(header, { childList: true, subtree: true, characterData: true });", "      _headerFit.mo.observe(header, { childList: true, characterData: true });"]],
    HR, "A: THE COUNTDOWN APPEARS — THE HEADER RE-FITS", "RED"],   // the header's own children only: a part's content unheard
  ["HR4", [[SH, "    if (_headerFit.mo) { try { _headerFit.mo.disconnect(); } catch (e) {} _headerFit.mo = null; }\n", ""]],
    HR, "D: BUILT AGAIN — STILL ONE, THE NEW HEADER'S", "RED"],   // the old header's observer left watching
  // ── JOB 3: the menu takes copy-my-ID and the layout; the top bar loses both ──
  ["TL1", [[RO, "    const parts = [H.el(\"div\", { class: \"st-head\" }, [pic, who, copy])];", "    const parts = [H.el(\"div\", { class: \"st-head\" }, [pic, who])];"]],   // re-anchored at `ddjp_702`
    VM, "C: THE TOP ROW ENDS IN A SMALL ⧉", "RED"],   // no copy button in the menu
  ["TL2", [[PAGE, "    .st-head .st-copy { margin-left: auto; }\n", ""]],
    VM, "C: AT THE ROW'S RIGHT EDGE", "RED"],   // the ⧉ beside the name, not at the edge
  ["TL3", [[RO, "    const copy = H.copyButton(\"⧉\", () => Room.getMyId() || \"\", \"copy-btn icon-only st-copy\", \"Copy my Matrix ID\");", "    const copy = H.copyButton(\"⧉\", () => \"\", \"copy-btn icon-only st-copy\", \"Copy my Matrix ID\");"]],
    VM, "C: CLICKED, IT COPIES YOUR MATRIX ID AND SHOWS ✓", "RED"],   // a button that copies nothing
  ["TL4", [[RO, "    const layouts = !!(opts && opts.layouts === true);   // the layout tiles: inside a room only (`ddjp_699`)", "    const layouts = true;"]],
    VM, "D: ON THE ROOM LIST THE MENU HAS NO LAYOUT TILES", "RED"],   // tiles on the room list, where there is no room to lay out
  ["TL5", [[RO, "try { H._setLayout(l.id); } catch (x) {} _closeMenu(); };", "try { H._setLayout(l.id); } catch (x) {} };"]],
    VM, "E: AND THE MENU CLOSES", "RED"],   // a pick leaves the menu open
  ["TL6", [[RO, "class: \"st-lay\" + (l.id === on ? \" on\" : \"\")", "class: \"st-lay\""]],
    VM, "D: THE ONE IN USE IS BLUE", "RED"],   // no tile says which is in use
  ["TL7", [[PAGE, ".st-lays { display: flex; justify-content: space-evenly;", ".st-lays { display: flex; justify-content: flex-start;"]],
    VM, "D: SPACED EVENLY ACROSS THE MENU", "RED"],   // the tiles bunched to the left
  ["TL8", [[SH, "    const myIdentity = el(\"div\", { class: \"my-identity\" }, [refs.myAvatarSlot, refs.avatarNote]);", "    const myIdentity = el(\"div\", { class: \"my-identity\" }, [refs.myAvatarSlot, refs.avatarNote, copyButton(\"⧉\", () => Room.getMyId() || \"\", \"copy-btn copy-invite-btn icon-only\", \"Copy my ID for an invite\")]);"]],
    VM, "A: AND NO BUTTON IN IT COPIES YOUR ID", "RED"],   // 698's copy-my-ID back in the top bar
  ["TL9", [[SC, "    slot.appendChild(H.el(\"span\", { id: \"rooms-avatar-note\", class: \"rooms-avatar-note\" }));\n", "    slot.appendChild(H.el(\"span\", { id: \"rooms-avatar-note\", class: \"rooms-avatar-note\" }));\n    slot.appendChild(H.copyButton(\"⧉\", () => Room.getMyId() || \"\", \"copy-btn icon-only\", \"Copy my ID for an invite\"));\n"]],
    VM, "B: AND ITS COPY BUTTON IS GONE", "RED"],   // 698's copy button back on the room list
  ["TL10", [[PAGE, "    .st-lay-pic.st-lay-phone { width: 20px; border-radius: 5px; }\n", ""]],
    VM, "D: THE PHONE'S FRAME IS UPRIGHT", "RED"],   // a phone drawn as a screen
  ["TL11", [[RO, "for (let i = 0; i < (l.cols || 1); i++) cols.push", "for (let i = 0; i < 1; i++) cols.push"]],
    VM, "D: EACH A SMALL DRAWING OF ITS LAYOUT", "RED"],   // every tile one column: the drawing says nothing
  ["TL12", [[RO, "      ownPicture(refs.myAvatarSlot, { rank: true, layouts: true, room: true });", "      ownPicture(refs.myAvatarSlot, { rank: true, room: true });"]],   // re-anchored at `ddjp_702`
    VM, "D: AT THE MENU'S FOOT, INSIDE A ROOM", "RED"],   // no tiles in a room: no way left to change the layout
  // ── JOB 4: People and DMs lined up ──
  ["PT1", [[PAGE, "    .roster > .invite-row { margin-top: 8px; }\n", ""]],
    PT, "T: THE BARS AT THE SAME TOP", "RED"],   // 698: People's 8 px higher
  ["PT2", [[PAGE, "    .roster > .invite-row { margin-top: 8px; }\n", "    .roster > .invite-row { margin-top: 16px; }\n"]],
    PT, "T: THE BARS AT THE SAME TOP", "RED"],   // too far: below DMs'
  ["PT3", [[PAGE, ".active-box { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 0 0; }", ".active-box { display: flex; flex-direction: column; gap: 4px; margin: 16px 0 0 0; }"]],
    PT, "N: PEOPLE'S HEADING LINE STAYS", "RED"],   // the heading moved instead: the owner's "we dont want to modify the layouts"
  // ── JOB 5: People's window in casual words ──
  ["WD1", [[PN, "    if (m < 1) return \"just now\";\n", "    if (m < 1) return \"<1min\";\n"]],
    WH, "F: AND THE SPAN IS TODAY'S NUMBER, THE EFFECTIVE WINDOW, IN CASUAL WORDS", "RED"],   // 698's "<1min"
  ["WD2", [[PN, "    return d < 30 ? n(d, \"day\") : n(Math.floor(d / 30), \"month\");", "    return d < 31 ? n(d, \"day\") : n(Math.floor(d / 31), \"month\");"]],
    WH, "F: AND THE SPAN IS TODAY'S NUMBER, THE EFFECTIVE WINDOW, IN CASUAL WORDS", "RED"],   // a month of another length than the room list's
  ["WD3", [[PN, "    const n = (k, w) => \"in last \" + k + \" \" + w + (k === 1 ? \"\" : \"s\");", "    const n = (k, w) => \"in last \" + k + \" \" + w;"]],
    WH, "F: AND THE SPAN IS TODAY'S NUMBER, THE EFFECTIVE WINDOW, IN CASUAL WORDS", "RED"],   // "in last 2 hour"
  ["WD4", [[PN, "    if (h < 24) return n(h, \"hour\");", "    if (h < 25) return n(h, \"hour\");"]],
    WH, "F: AND THE SPAN IS TODAY'S NUMBER, THE EFFECTIVE WINDOW, IN CASUAL WORDS", "RED"],   // "in last 24 hours" for a day
  ["WD5", [[PN, "    if (m < 60) return \"in last \" + m + \" min\";", "    if (m < 60) return \"last \" + m + \"min\";"]],
    WH, "F: WHEN THE LOG IS SHORTER, THE STATED SPAN IS THE ONE ACTUALLY LOOKED AT", "RED"],   // 698's short words for minutes (the guard stops at its first failure)
  // ── Controls ──
  ["G1", [[MB, "  const MEMBERS_WAIT_MS = 10000;", "  const MEMBERS_WAIT_MS = 10 * 1000;"]],
    AL, "", "GREEN"],   // the same ten seconds, written as a product
  ["G2", [[SH, "{ childList: true, subtree: true, characterData: true }", "{ subtree: true, characterData: true, childList: true }"]],
    HR, "", "GREEN"],   // the same observer options in another order
  ["G3", [[PAGE, "    .roster > .invite-row { margin-top: 8px; }\n", "    .roster > .invite-row {  margin-top:8px;  }\n"]],
    PT, "", "GREEN"],   // the same rule, spaced otherwise
  ["G4", [[PAGE, "    .st-lay:hover { background: #2a2a2e; color: #cdcdcd; }\n", "    .st-lay:hover { background: #2b2b2f; color: #cdcdcd; }\n"]],
    VM, "", "GREEN"],   // a hover shade
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
      const h = J.open("mutate-j147-ask-less:" + id, file);   // journalled BEFORE the write
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
