// tools/probes/mutate-j148-pictures.js
// SUBJECT: J148 — pictures through the room, presence no longer asked for; "Loading people…"; DMs' heading the same height
// (`ddjp_700`): a picture from the member event and its change heard on "RoomState.members" (`backends/backend1/matrixaccount.js`
// `_memberPicture`, `_loadAvatar`, `_onMemberPicture`, `_watchAvatarChanges`), every picture carrying whose it is and one sweep of
// the page (`ui/base.js` `avatarEl`, `ui/screens.js` the avatar-change listener) — `check-picture-path`; the filter dropping
// presence (`backends/backend1/matrixbridge.js` `syncFilterDefinition`) — `check-ask-less` L, A; People's waiting words and the
// transport's wait and retry (`ui/roster.js` `renderRoster`, `features/room.js` `peopleLate`, `backends/backend1/matrixbridge.js`
// `_loadRoomMembers`, `membersLate`, `index.html` `.people-wait`) — `check-people-loading`; DMs' heading line held at 30 px
// (`index.html`) — `check-panel-tops` E. One row per way it could go wrong, each naming the failure it must cause; the controls
// change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j148-pictures.js            every row
//   node tools/probes/mutate-j148-pictures.js PP1 PL4    named rows
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
const SC = "ui/screens.js";
const BA = "ui/base.js";
const PAGE = "index.html";
const PP = "check-picture-path";
const AL = "check-ask-less";
const PL = "check-people-loading";
const PT = "check-panel-tops";
const LISTEN = "    _c().on(\"RoomState.members\", (event, state, member) => { _onMemberPicture(event, member); });";
const WAIT_CSS = "    .roster-box .people-wait { min-height: 34px; box-sizing: border-box; padding: 4px 10px; display: flex; align-items: center; }";
const DM_CSS = "    .dm > .dm-box:not(.dm-convo) > .dm-head { min-height: 30px; }";
const WORDS = "      refs.rosterBox.appendChild(H.el(\"div\", { class: \"muted people-wait\", text: late ? \"Couldn't load people yet \\u2014 retrying\" : \"Loading people\\u2026\" }));";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── JOB 1: a picture from the member event, its change heard on "RoomState.members" ──
  ["PP1", [[MA, LISTEN, "    void _onMemberPicture;"]],
    PP, "A2: A MEMBER EVENT THAT CHANGES THE PICTURE SWAPS IT", "RED"],   // the change not listened for (699's listeners never heard it)
  ["PP2", [[MA, "      const m = _memberPicture(userId);", "      const m = null;"]],
    PP, "A1: THE PICTURE SHOWN IS THE MEMBER EVENT'S", "RED"],   // the profile first, as at 699
  ["PP3", [[MA, "      if (userId !== me && !B1MatrixBridge.membersHeld(room)) continue;   // this account's own is always held", "      if (userId !== me && !B1MatrixBridge.membersReady(room)) continue;"]],
    PP, "A8: BEFORE THE ROOM'S MEMBERS LAND, THE PICTURE IS THE PROFILE'S — AND ITS READ ASKED NO ROOM'S LOAD", "RED"],   // a picture's read loading every room
  ["PP4", [[MA, "    if (_avatarFrom[userId] === \"member\" && was === mxc) return;", "    void was;"]],
    PP, "A4: A PICTURE OF THEIR OWN IN ANOTHER ROOM, UNCHANGED THERE, DOES NOT FLIP THE ONE SHOWN", "RED"],   // per-room pictures flip-flopping
  ["PP5", [[MA, "    const gen = (_avatarGen[userId] = (_avatarGen[userId] || 0) + 1);", "    const gen = 0; _avatarGen[userId] = 0;"]],
    PP, "A9: A PROFILE ANSWER ARRIVING AFTER THE MEMBER'S PICTURE DOES NOT TAKE IT BACK", "RED"],   // an older load overwriting a newer picture
  ["PP6", [[MA, "    _avatarFrom[userId] = \"member\";\n    _setAvatar(userId, null);", "    _avatarFrom[userId] = \"member\";"]],
    PP, "A5: A PICTURE REMOVED — initials (null), and the screen is told", "RED"],   // a removed picture left on screen
  ["PP7", [[MA, LISTEN, LISTEN + "\n    _c().on(\"User.avatarUrl\", (event, user) => { if (user && user.userId) _refetchAvatar(user.userId, user.avatarUrl || null); });"]],
    AL, "L: PRESENCE — read here (the avatar code), so the sync keeps it", "RED"],   // a presence reader back while the filter drops presence
  ["PP8", [[MB, "    return { presence: { not_types: SYNC_PRESENCE_DROPPED.slice() },", "    return { presence: { not_types: [] },"]],
    AL, "L: PRESENCE — nothing reads it, so the sync does not ask for it", "RED"],   // presence asked for again though nothing reads it
  ["PP9", [[MA, "      const ev = B1MatrixBridge.memberEventIn(room, userId, \"a person's picture\");", "      const ev = room.currentState.getStateEvents(\"m.room.member\", userId);"]],
    AL, "A: NO SDK MEMBER READ OUTSIDE THE THREE", "RED"],   // the picture read past the transport's three
  ["PP10", [[BA, "      img.dataset.avatarFor = userId;\n", ""]],
    PP, "U: ONE CHANGE REACHES PEOPLE'S ROW", "RED"],   // a picture that does not say whose it is
  ["PP11", [[SC, "Array.from(document.querySelectorAll('[data-avatar-for=\"' + userId + '\"]'))", "Array.from(refs.chatBox ? refs.chatBox.querySelectorAll('[data-avatar-for=\"' + userId + '\"]') : [])"]],
    PP, "U: ONE CHANGE REACHES PEOPLE'S ROW", "RED"],   // the sweep back to one box
  // ── JOB 2: "Loading people…", the transport's wait and retry ──
  ["PL1", [[RO, WORDS, "      void late;"]],
    PL, "W: WHILE THE MEMBERS LOAD, PEOPLE SAYS", "RED"],   // People blank while it waits (699)
  ["PL2", [[RO, WORDS, "      refs.rosterBox.appendChild(H.el(\"div\", { class: \"muted people-wait\", text: \"Loading people\\u2026\" }));"]],
    PL, "W: PAST THE WAIT", "RED"],   // the late words never said
  ["PL3", [[PAGE, WAIT_CSS, "    .roster-box .people-wait { display: flex; align-items: center; }"]],
    PL, "W: IN A PERSON ROW'S BOX", "RED"],   // the words not where the first name would be
  ["PL4", [[MB, "      _membersLimit.set(id, _membersLater(() => { _membersLimit.delete(id); if (_membersPartial(room)) _tellMembers(); }, MEMBERS_WAIT_MS));", "      _membersLimit.set(id, _membersLater(() => { _membersLimit.delete(id); }, MEMBERS_WAIT_MS));"]],
    PL, "L: AT 10 S, LATE — and the member listeners told once", "RED"],   // People never redrawn in the late words
  ["PL5", [[MB, "    if (_membersCool.has(id)) return Promise.resolve(false);   // failed lately: asked again when its pause ends (below)\n", ""]],
    PL, "L: AND IT IS NOT ASKED AGAIN AT ONCE", "RED"],   // a failing server asked in a loop
  ["PL6", [[MB, "      _membersCool.set(id, _membersLater(() => { _membersCool.delete(id); if (_membersPartial(room)) _tellMembers(); }, MEMBERS_WAIT_MS));", "      _membersCool.set(id, _membersLater(() => { _membersCool.delete(id); }, MEMBERS_WAIT_MS));"]],
    PL, "L: 10 S AFTER THE FAILURE THE LISTENERS ARE TOLD", "RED"],   // "retrying" that never retries
  ["PL7", [[MB, "    return (_membersNow() - _membersAskedAt.get(roomId)) >= MEMBERS_WAIT_MS;", "    return (_membersNow() - _membersAskedAt.get(roomId)) > MEMBERS_WAIT_MS;"]],
    PL, "L: AT 10 S, LATE", "RED"],   // late one tick after the tell that redraws People
  ["PL8", [[ROOM, "MatrixBridge.membersLate(current.spaceId)", "MatrixBridge.membersLate((current.channels || {}).events_uncategorized)"]],
    PL, "R: PAST THE WAIT, THE OPEN ROOM'S PEOPLE ARE LATE", "RED"],   // the room's word read from a channel, not its Space
  // ── JOB 3: DMs' heading line keeps the lock's height ──
  ["DT1", [[PAGE, DM_CSS + "\n", ""]],
    PT, "E: THE HEADING LINE KEEPS THE LOCK'S 30 PX WITH NOTHING IN IT", "RED"],   // 699: 16 px, the search 14 px high
  ["DT2", [[PAGE, DM_CSS, "    .dm-head { min-height: 30px; }"]],
    PT, "E: AND ONLY THERE", "RED"],   // the lobby's Messages box and an open conversation moved too
  ["DT3", [[PAGE, DM_CSS, "    .dm > .dm-box:not(.dm-convo) > .dm-head { min-height: 28px; }"]],
    PT, "E: THE HEADING LINE KEEPS THE LOCK'S 30 PX WITH NOTHING IN IT", "RED"],   // nearly: the search 2 px high
  // ── CONTROLS: nothing that matters changes ──
  ["G1", [[MA, "    if (_avatarFrom[userId] && _avatarMxc[userId] === mxc) return;   // the picture shown already", "    if (_avatarFrom[userId] && _avatarMxc[userId] === mxc) return;   // the picture shown already (a control: words only)"]],
    PP, "", "GREEN"],
  ["G2", [[PAGE, WAIT_CSS, "    .roster-box .people-wait { box-sizing: border-box; min-height: 34px; padding: 4px 10px; display: flex; align-items: center; }"]],
    PL, "", "GREEN"],
  ["G3", [[PAGE, DM_CSS, "    .dm > .dm-box:not(.dm-convo) > .dm-head { min-height:30px; }"]],
    PT, "", "GREEN"],
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
      const h = J.open("mutate-j148-pictures:" + id, file);   // journalled BEFORE the write
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
