// tools/probes/mutate-j142-rank-trust.js
// SUBJECT: J142 — ranks you can trust (the owner's plan, part 1): the rule (`features/room.js` `rankStanding`, `rankRepairers`)
// over the bridge's readings (`backends/backend1/matrixbridge.js` `rankReadings`, `_levelSetAt`, one room list with the change,
// `_rankLevelRooms`), the ring (`ui/base.js` `rankRing`, drawn in `ui/roster.js`, `ui/chat.js`, `ui/player.js`; the sheet's
// `.rank-off > *` in `index.html`), the card's line and Repair (`ui/roster.js` `openUserCard`), and the transport's one send
// pacer (`matrixbridge.js` `_sendPace`); held by `check-rank-trust`. Since `ddjp_693` also: the ring's wait in server time and
// its timer (`features/room.js` `rankStanding`'s `ring`, `_ringFor`), the card's own picture (`ui/roster.js`, `.uc-av` in
// `index.html`), who may repair said by rank (`Room.rankRepairRank`), the bot's rung waiting for the last upgrade
// (`matrixbridge.js` `rankAssignable`; the picker and Repair in `ui/roster.js`) and an upgrade giving a bot already there its
// level (`matrixbridge.js` `botLevelAfterUpgrade`, asked by `features/roomupgrade.js` `upgrade`, named on the bar by `ui/roster.js`
// `runUpgrade`) — and the boundaries guard's reader (`tests/check-boundaries.js` `lexJs`, held by its own PART 0). Since `ddjp_694`
// also: the room's bot holding its level in every channel (`features/room.js` `_standing`, `_isRoomBot`) and an upgrade's bot step
// taking the room's one rank turn (`Room.upgradeBotLevel`, `upgradeBotStep`, the leave's stop; `features/actions.js`'s `rank.assign`
// row; the card's line and repaint in `ui/roster.js`; the wait on the bar, `features/roomupgrade.js`). Since `ddjp_695` also: new
// channels born naming everyone the Space names (`matrixbridge.js` `_copiedUsers`, `_powerLevels`, `createUpgradeBatch`), the whole
// batch in the room's one rank turn (`Room.upgradeTurn`; `features/roomupgrade.js` `upgrade`, `_batch`), every channel counting for
// everyone (`features/room.js` `_standing`), held by `check-upgrade-copy` and `check-rank-trust`. One row per
// way it could go wrong, each naming the failure it must cause; the controls change nothing that matters and must stay green.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes are
// back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE: each
// file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not there at
// either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed. Restored after
// every row and checked restored by hash.
//
//   node tools/probes/mutate-j142-rank-trust.js            every row
//   node tools/probes/mutate-j142-rank-trust.js RT1 RT3    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const MB = "backends/backend1/matrixbridge.js";
const ROOM = "features/room.js";
const UI = "ui/roster.js";
const CHAT = "ui/chat.js";
const PLAYER = "ui/player.js";
const BASE = "ui/base.js";
const PAGE = "index.html";
const RU = "features/roomupgrade.js";
const ACT = "features/actions.js";   // `ddjp_694`: the `rank.assign` row waits for an upgrade's bot step
const BND = "tests/check-boundaries.js";
const G = "check-rank-trust";
const GU = "check-upgrade-copy";   // `ddjp_695`: new channels name everyone, the whole batch in the room's one rank turn
const B = "check-boundaries";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  ["RT1", [[MB, "      if (!amJoined(r.roomId)) continue;\n", ""]],
    G, "A ROOM THIS ACCOUNT LEFT IS NOT READ", "RED"],   // a room left is read: its state as of leaving taken as now
  ["RT2", [[MB, "if (!room || _creatorsOf(room)[userId]) continue;", "if (!room) continue;"]],
    G, "A CREATOR IS NEVER OUT OF STEP", "RED"],   // a creator read: 100 by the server's rule against a power list that names them
  ["RT3", [[MB, "      if (_levelIn(e.getContent(), userId) !== _levelIn(un.prev_content, userId)) return { at: e.getTs(), before: null, unnamed: false, made: made };", "      return { at: e.getTs(), before: null, unnamed: false, made: made };"]],
    G, "A LATER CHANGE FOR SOMEONE ELSE IS NOT A SET FOR THEM", "RED"],   // what an event replaced not read: anyone's change taken as theirs
  ["RT4", [[MB, "        const first = !un.replaces_state && typeof made === \"number\"", "        const first = typeof made === \"number\""]],
    G, "AN EVENT NAMING ONE IT REPLACED IS NOT THE ROOM'S FIRST", "RED"],   // an event with an unseen predecessor taken as the room's first
  ["RT5", [[ROOM, "    if (tied.length === 1) { out.target = tied[0]; out.by = \"newest\"; return out; }", "    if (space) { out.target = space.level; out.by = \"newest\"; return out; }"]],
    G, "HIS EXAMPLE, THE SPACE STILL NAMING THEIR OLD LEVEL", "RED"],   // the supervisor's rejected first idea, the Space's level: the part left behind repaired to (re-aimed at `ddjp_695`: where the Space never named them the rooms that do agree, so his own example no longer reaches this line; the Space naming the old level does)
  ["RT6", [[ROOM, "    if (!exact.length) { out.by = \"unknown\"; return out; }", "    { out.target = Math.max.apply(null, levels); out.by = \"newest\"; return out; }"]],
    G, "A HALF-DONE DEMOTION'S REPAIR TARGET IS THE NEWEST LEVEL", "RED"],   // the highest level held: a demotion undone by its repair
  ["RT7", [[ROOM, "    if (space && !space.unnamed) { out.target = space.level; out.by = \"tie\"; return out; }", "    { out.target = tied[tied.length - 1]; out.by = \"tie\"; return out; }"]],
    G, "A TIE GOES TO THE SPACE'S LEVEL", "RED"],   // a tie settled by a channel (re-anchored at `ddjp_695`: the tie asks that the Space names them)
  ["RT8", [[ROOM, "    if (rd.some((r) => typeof r.at !== \"number\" && !(typeof r.before === \"number\" && r.before <= newest))) { out.by = \"unknown\"; return out; }", ""]],
    G, "A LEVEL SET AT A TIME THIS DEVICE CANNOT PLACE", "RED"],   // a level it cannot place assumed older: a target it cannot know
  ["RT9", [[MB, "    for (const r of _rankLevelRooms(spaceId, channels)) {", "    for (const r of [{ roomId: spaceId, key: \"space\" }]) {"]],
    G, "THE ROOMS READ ARE THE ROOMS A CHANGE SETS", "RED"],   // the reading's rooms not the change's: a split it cannot see
  ["RT10", [[UI, "      if (H.rankRing) H.rankRing(av, member.userId);", "      void av;"]],
    G, "PEOPLE — THE RING IS ON THE PERSON OUT OF STEP", "RED"],   // People without the ring
  ["RT11", [[CHAT, "    if (H.rankRing) H.rankRing(avBox, record.sender);", "    void avBox;"]],
    G, "CHAT ROWS — THE RING", "RED"],   // chat rows without it
  ["RT12", [[PLAYER, "    if (refs.npAvBox && H.rankRing) H.rankRing(refs.npAvBox, djId);", "    void djId;"]],
    G, "THE PLAYER'S LINE — THE DJ OUT OF STEP", "RED"],   // the player's line without it
  ["RT13", [[UI, "      ownPicture(refs.myAvatarSlot, { rank: true, layouts: true, room: true });", "      void ownPicture;"]],   // re-anchored at `ddjp_702` (the room's segment flag)   // re-anchored at `ddjp_697`: your own picture rings by the status piece (red: My Rank out of spec); at `ddjp_699`, its menu's layout tiles flag
    G, "THE HEADER — THIS ACCOUNT OUT OF STEP", "RED"],   // the header's own picture without it
  ["RT14", [[PAGE, ".rank-off > *, .chat-input-row .chat-pick-btn.locked {", ".chat-input-row .chat-pick-btn.locked {"]],
    G, "and the sheet DRAWS it", "RED"],   // the class set and nothing drawn: a ring nobody sees
  ["RT15", [[BASE, "    if (off) node.classList.add(\"rank-off\"); else node.classList.remove(\"rank-off\");", "    node.classList.add(\"rank-off\");"]],
    G, "AND ON NOBODY ELSE", "RED"],   // everyone ringed
  ["RT16", [[UI, "        if (!d.permitted) continue;", ""]],
    G, "A VIEWER WHO MAY NOT GIVE IT SEES NO REPAIR", "RED"],   // Repair offered to anyone
  ["RT17", [[UI, "        else if (!unlocked) { b.disabled = true; b.title = LOCKED_TITLE; }", ""]],
    G, "and behind the card's lock", "RED"],   // Repair outside the card's lock
  ["RT18", [[UI, "newLevel: lvl, repair: true });", "newLevel: lvl });"]],
    G, "REPAIR STARTS THE RANK CHANGE ITSELF, marked a repair", "RED"],   // a repair not said as one
  ["RT19", [[UI, "(j.repair ? \"Repairing \"", "(false ? \"Repairing \""]],
    G, "\"Repairing Them's rank… N of M\"", "RED"],   // its line reads as any change
  ["RT20", [[UI, "          noteSlot.appendChild(H.el(\"div\", { class: \"uc-rank-bar room-leave-track\" }, [fill]));", "          void fill;"]],
    G, "with a bar, filled to steps confirmed of steps", "RED"],   // no bar
  ["RT21", [[UI, "      if (j && j.userId === m.userId && j.state !== \"done\") return;", ""]],
    G, "ON THE TAB WHOSE OWN CHANGE STOPPED", "RED"],   // two answers on one card
  ["RT22", [[MB, "      { const gap = _sendPace.wait(); if (gap > 0 && (await until(_rankSleep(gap))).cut) return; }", ""]],
    G, "AT LEAST A SECOND BETWEEN SENDS", "RED"],   // no pacing: a change's sends in a burst
  ["RT23", [[MB, "      if (_is429(e)) _sendPace.pushedBack(\"ranks\", _retryAfterMs(e));", "      if (false) _sendPace.pushedBack(\"ranks\", _retryAfterMs(e));"]],   // re-anchored at `ddjp_697`: the push-back names its kind
    G, "AFTER A PUSH-BACK THE NEXT SEND COMES FURTHER APART", "RED"],   // a push-back heard and the pace unchanged
  ["RT24", [[MB, "{ _sendPace.landed(\"ranks\"); s.accepted = true;", "{ s.accepted = true;"]],   // re-anchored at `ddjp_697`
    G, "eases back", "RED"],   // never easing: one push-back slows the tab for good
  ["RT25", [[ROOM, "      const r = rungs.find((a) => canAssignRank(a, target, level));", "      const r = rungs.find(() => true);"]],
    G, "A VIEWER WHO MAY NOT GIVE IT SEES NO REPAIR — and the rank that may", "RED"],   // the rank change's rule not asked: the lowest rung named as able to repair (re-anchored at `ddjp_693`, by rank)
  ["RT26", [[MB, "typeof made === \"number\" && Math.abs(e.getTs() - made) <= FIRST_PL_MS;", "true;"]],
    G, "A POWER-LEVELS EVENT WITHOUT WHAT IT REPLACED, LONG AFTER THE ROOM WAS MADE", "RED"],   // a missing prev_content taken as proof of a first
  ["RT27", [[MB, "        if (first) return { at: e.getTs(), before: null, unnamed: false, made: made };", "        if (false) return { at: e.getTs(), before: null, unnamed: false, made: made };"]],
    G, "THE ROOM'S FIRST POWER LEVELS, SENT WITH ITS CREATION RECORD, SET EVERY LEVEL", "RED"],   // the room's first never placed
  // RT28, RT41, RT52 AND RT53 RE-ANCHORED AT ddjp_694: the late-channel line also asks whether the person is the room's bot, the
  // rank-job tell also wakes an upgrade's waiting bot step, and the upgrade asks the room's turn (`Room.upgradeBotLevel`) — the
  // rows' subjects unchanged.
  // ── RT28 retired at ddjp_695: decision 2 (the late-channel rule) is gone for everyone (`ddjp_695`, JOB 1): its line is deleted; RT75 puts it back.
  ["RT29", [[MB, "    if (!_named(cur, userId)) return { at: (typeof made === \"number\") ? made : null, before: null, unnamed: true, made: made };", ""]],
    G, "A CHANNEL AN UPGRADE MADE AFTER THEIR RANK WAS SET", "RED"],   // a default read as a set like any other: the same
  ["RT30", [[MB, "      const set = same ? { at: null, before: null, unnamed: null, made: null } : _levelSetAtMemo(r.room, r.roomId, userId);", "      const set = _levelSetAtMemo(r.room, r.roomId, userId);"]],
    G, "CHEAP — A PERSON IN STEP: NO ROOM'S TIMELINE IS READ", "RED"],   // every picture walks every timeline
  ["RT31", [[MB, "    if (k !== null && _setAtMemo.has(k)) return _setAtMemo.get(k);", "    if (false) return _setAtMemo.get(k);"]],
    G, "CHEAP — THE SAME READING ASKED AGAIN WALKS NO TIMELINE AGAIN", "RED"],   // nothing kept: the walk on every draw
  // ── `ddjp_693`: the ring waits (RT32–RT43), the card's own picture (RT44, RT45), who may repair said by rank (RT25, RT46–RT48),
  //    Bot only after the last upgrade and an upgrade giving a bot already there its level (RT49–RT58), and the boundaries
  //    guard's reader (BR1–BR5, held by `check-boundaries` PART 0) ──
  ["RT32", [[ROOM, "    if (now - since > limit) return true;", "    return true;"]],
    G, "A FRESH DISAGREEMENT (5 s, in server time) IS OUT OF STEP AND RINGS NOTHING", "RED"],   // no wait: the ring for a normal change's few seconds again
  ["RT33", [[ROOM, "    const limit = MatrixBridge.RANK_LIMIT_MS, now = _serverNowOrNull();", "    const limit = MatrixBridge.RANK_LIMIT_MS, now = Date.now();"]],
    G, "NEVER THE DEVICE'S CLOCK", "RED"],   // the local clock against a server stamp
  ["RT34", [[ROOM, "    if (_rankJob && _rankJob.state === \"running\" && _rankJob.userId === userId && current && _rankJob.room === current.spaceId) return false;", "    if (_rankJob && _rankJob.state === \"running\" && _rankJob.userId === userId && current && _rankJob.room === current.spaceId) { /* not suppressed */ }"]],
    G, "THIS TAB'S OWN CHANGE FOR THEM RUNNING — NO RING", "RED"],   // this tab's own change rings its person while it runs
  ["RT35", [[ROOM, "    if (now - since > limit) return true;", "    if (now - since >= limit) return true;"]],
    G, "AT THE MINUTE EXACTLY, STILL WITHIN A CHANGE'S TIME", "RED"],   // as long as, not longer than
  ["RT36", [[ROOM, "    _ringAt(since + limit, now);", "    void since;"]],
    G, "A WAITING RING SETS ONE TIMER", "RED"],   // no timer: a waiting ring waits for an event that may never come
  ["RT37", [[ROOM, "    _ringTimer = _ringLater(() => { _ringTimer = null; _ringDue = null; _ringTold(); }, Math.max(0, due - now) + RING_SLACK_MS);", "    _ringTimer = _ringLater(() => { _ringTimer = null; _ringDue = null; }, Math.max(0, due - now) + RING_SLACK_MS);"]],
    G, "WHEN IT FIRES, THE RANK LISTENERS ARE TOLD ONCE", "RED"],   // the timer tells nobody: nothing redraws
  ["RT38", [[ROOM, "      const t = (typeof r.at === \"number\") ? r.at : ((typeof r.before === \"number\") ? r.before : null);", "      const t = (typeof r.at === \"number\") ? r.at : null;"]],
    G, "A SET IT CANNOT PLACE COUNTS AS RECENT AS IT MAY BE", "RED"],   // a set it cannot place read as older than it may be
  ["RT39", [[ROOM, "      if (t !== null && (out.since === null || t > out.since)) out.since = t;", "      if (t !== null && (out.since === null || t < out.since)) out.since = t;"]],
    G, "`since` the newest level change", "RED"],   // the oldest change taken for the newest
  ["RT40", [[ROOM, "    if (typeof limit !== \"number\" || !isFinite(limit) || now === null || typeof since !== \"number\") return true;", "    if (typeof limit !== \"number\" || !isFinite(limit) || now === null || typeof since !== \"number\") return false;"]],
    G, "NO SERVER TIME TO READ — NOTHING MEASURED IS NOTHING HIDDEN", "RED"],   // no clock to read hides the ring
  ["RT41", [[ROOM, "  function _rankJobTold() { _ringOnJob(); _upTurn(); for (const fn of _rankJobListeners.slice()) { try { fn(rankJob()); } catch (e) {} } }   // the ring first: a listener's redraw re-reads it", "  function _rankJobTold() { _upTurn(); for (const fn of _rankJobListeners.slice()) { try { fn(rankJob()); } catch (e) {} } _ringOnJob(); }   // the ring first: a listener's redraw re-reads it"]],
    G, "the screen told as it starts", "RED"],   // the ring asked after the card's redraw re-read it: the screen never told
  ["RT42", [[BASE, "    try { const st = (userId && Room.rankStanding) ? Room.rankStanding(userId) : null; off = !!(st && st.ring); } catch (e) { off = false; }", "    try { const st = (userId && Room.rankStanding) ? Room.rankStanding(userId) : null; off = !!(st && st.outOfStep); } catch (e) { off = false; }"]],
    G, "and People draws no ring on them", "RED"],   // the picture reads out of step, not the ring's rule
  ["RT43", [[ROOM, "      [\"Rank ring\", () => { _ringStop(); _ringSeen.clear(); _ringJob = null; }],   // `ddjp_693`: a waiting ring's timer goes with the room", "      [\"Rank ring\", () => { _ringSeen.clear(); _ringJob = null; }],   // `ddjp_693`: a waiting ring's timer goes with the room"]],
    G, "THE LEAVE STOPS A WAITING RING'S TIMER", "RED"],   // a waiting ring's timer outlives its room
  ["RT44", [[UI, "      if (H.rankRing) H.rankRing(headAv, m.userId);   // the card's own picture: the ring, by the room's rule (`ddjp_693`)", "      void headAv;   // the card's own picture: the ring, by the room's rule (`ddjp_693`)"]],
    G, "THE CARD'S OWN PICTURE, THEIRS OUT OF STEP — THE SAME RING", "RED"],   // the card's picture without it
  ["RT45", [[PAGE, "    .uc-av { display: contents; }   /* the card's own picture's wrapper (ddjp_693): no box of its own, so the head lays out as before; it carries the ring */", "    .uc-av { display: inline-flex; }   /* the card's own picture's wrapper (ddjp_693): no box of its own, so the head lays out as before; it carries the ring */"]],
    G, "THE WRAPPER DRAWS NO BOX", "RED"],   // the wrapper a box of its own: the head lays out differently
  ["RT46", [[ROOM, "      if (!best && canAssignRank(rungs[rungs.length - 1] + 1, target, level)) best = { owner: true };", "      if (!best && canAssignRank(rungs[rungs.length - 1] + 1, target, level)) best = null;"]],
    G, "FOR BOT, THE OWNER ONLY", "RED"],   // for Bot, nobody said
  ["RT47", [[ROOM, "      const r = rungs.find((a) => canAssignRank(a, target, level));", "      const r = rungs.find((a) => canAssignRank(a, -1, level));"]],
    G, "A HALF-DONE DEMOTION — THE RANK THAT MAY MUST OUTRANK THEIR HIGHEST LEVEL", "RED"],   // their own highest level not asked: a rank that could not touch them named
  ["RT48", [[UI, "        offSlot.appendChild(H.el(\"span\", { class: \"uc-off-who\", text: who.owner ? \"Owner can repair it.\" : H.rankName(who.level) + \"+ can repair it.\" }));", "        offSlot.appendChild(H.el(\"span\", { class: \"uc-off-who\", text: who.owner ? \"Owner can repair it.\" : String(who.level) + \"+ can repair it.\" }));"]],
    G, "and the rank that may", "RED"],   // the rung's number, not its name
  ["RT49", [[MB, "      if (top !== null && level === top && d && d.maxBatch > 1 && d.batches) {", "      if (false && top !== null && level === top && d && d.maxBatch > 1 && d.batches) {"]],
    G, "BEFORE THE LAST BATCH THE BOT'S RUNG IS LOCKED", "RED"],   // the bot's rung assignable before the last upgrade again
  ["RT50", [[UI, "        sel.appendChild(H.el(\"option\", { value: String(r.level), disabled: \"disabled\" }, H.rankName(r.level) + \" — upgrade the room first\"));", "        sel.appendChild(H.el(\"option\", { value: String(r.level), disabled: \"disabled\" }, r.name + \" — upgrade the room first\"));"]],
    G, "THE PICKER SHOWS IT LOCKED, IN ITS OWN WORDS", "RED"],   // the locked top rung named "Owner — …"
  ["RT51", [[UI, "        if (!Room.isRankUnlocked(Room.getChannels(), lvl)) { b.disabled = true; b.title = H.rankName(lvl) + \" \\u2014 upgrade the room first\"; }", "        if (false) { b.disabled = true; b.title = H.rankName(lvl) + \" \\u2014 upgrade the room first\"; }"]],
    G, "AND REPAIR TO BOT, BEFORE THE LAST BATCH, IS SHOWN LOCKED", "RED"],   // Repair offers what the room refuses
  ["RT52", [[RU, "      if (typeof Room.upgradeBotLevel === \"function\") {", "      if (false) {"]],
    G, "THE UPGRADE ASKS IT ONCE THE BATCH IS THE ROOM'S", "RED"],   // the upgrade never gives the bot its level
  ["RT53", [[RU, "        bot = await Room.upgradeBotLevel(spaceId, added, { turn: turn, onProgress: (n, t) => { if (onProgress) onProgress(n, t, \"Bot's level\"); } });", "        bot = await Room.upgradeBotLevel(spaceId, added, { turn: turn, onProgress: (n, t) => { if (onProgress) onProgress(n, t); } });"]],
    G, "ITS PROGRESS ON THE UPGRADE'S BAR", "RED"],   // its progress unlabelled on the bar
  ["RT54", [[MB, "      const steps = keys.map((k) => ({ kind: \"level\", roomId: added[k], key: k }));", "      const steps = keys.map((k) => ({ kind: \"in\", roomId: added[k], key: k }));"]],
    G, "THE UPGRADE SETS THE BOT'S LEVEL IN EACH NEW CHANNEL", "RED"],   // the bot invited, its level never set
  ["RT55", [[MB, "      for (const s of r.missing) failed.push(_rankStepLabel(s));", "      void r.missing;"]],
    G, "A FAILURE IS NAMED, AS A RANK STEP'S", "RED"],   // a failure answered unnamed
  ["RT56", [[MB, "      const r = await _runRankSteps(steps, u, top, { onProgress: (n) => { try { if (typeof o.onProgress === \"function\") o.onProgress(base + n, grand); } catch (e) {} } });", "      const r = await _runRankSteps(steps, u, top, {});"]],
    G, "WITH PROGRESS — steps confirmed of steps", "RED"],   // no progress
  ["RT57", [[MB, "    if (_rankRun) {", "    if (false) {"]],
    G, "WHILE A RANK CHANGE RUNS ON THIS TAB — nothing sent", "RED"],   // sent over a change already running: two runs in one slot
  ["RT58", [[UI, "      lbl.textContent = short ? \"Done — the bot's level not confirmed: \" + ((bot.failed || []).join(\", \") || \"unknown\") : \"Done\";", "      lbl.textContent = \"Done\";"]],
    G, "THE BAR NAMES WHAT DID NOT LAND", "RED"],   // the bar says Done whatever did not land
  ["BR1", [[BND, "    if (c === \"/\" && d === \"/\") { while (i < n && src[i] !== \"\\n\") i++; continue; }", "    if (c === \"/\" && d === \"/\") { emit(\"/\"); i++; continue; }"]],
    B, "PART 0, the reader: a name in a trailing comment is not code", "RED"],   // a trailing comment read as code — and its apostrophe as a string's opening
  ["BR2", [[BND, "    if (c === \"/\" && d === \"*\") { i += 2; while (i < n && !(src[i] === \"*\" && src[i + 1] === \"/\")) { if (src[i] === \"\\n\") emit(\"\\n\"); i++; } i += 2; continue; }", "    if (false) { i += 2; while (i < n && !(src[i] === \"*\" && src[i + 1] === \"/\")) { if (src[i] === \"\\n\") emit(\"\\n\"); i++; } i += 2; continue; }"]],
    B, "PART 0, the reader: a clean file with apostrophes in its comments must show rule G nothing", "RED"],   // a block comment read as code: its apostrophe opens a string, its names are code
  ["BR3", [[BND, "      if (ch === \"$\" && src[j + 1] === \"{\") { emit(\"${\"); tpl.push(depth); sig(\"{\"); return j + 2; }", "      if (false) { emit(\"${\"); tpl.push(depth); sig(\"{\"); return j + 2; }"]],
    B, "PART 0, the reader: a template's `${…}` is code", "RED"],   // a template's expression read as its text
  ["BR4", [[BND, "    if (c === \"/\" && regexHere()) {", "    if (c === \"/\" && false) {"]],
    B, "PART 0, the reader: a regular expression holding quotes and slashes ends where it ends", "RED"],   // a regex not known: its quote opens a string over the code after it
  ["BR5", [[BND, "    if (c === \"/\" && d === \"*\") { i += 2; while (i < n && !(src[i] === \"*\" && src[i + 1] === \"/\")) { if (src[i] === \"\\n\") emit(\"\\n\"); i++; } i += 2; continue; }", "    if (c === \"/\" && d === \"*\") { i += 2; while (i < n && !(src[i] === \"*\" && src[i + 1] === \"/\")) { i++; } i += 2; continue; }"]],
    B, "PART 0, the reader: the reader must keep every line", "RED"],   // a block comment's lines lost: rule H's lines shift
  // ── CONTROLS: change nothing that matters, must stay green ──
  ["G1", [[ROOM, "    byLevel.sort((a, b) => (b.n - a.n) || (b.level - a.level));", "    byLevel.sort((a, b) => (b.n !== a.n ? b.n - a.n : b.level - a.level));"]], G, "", "GREEN"],   // the same order, spelt another way
  ["G2", [[MB, "  const PACE_MAX_MS = 4000;", "  const PACE_MAX_MS = 4 * 1000;"]], G, "", "GREEN"],   // the same ceiling, written another way
  ["G3", [[MB, "      if (top !== null && level === top && d && d.maxBatch > 1 && d.batches) {", "      if (top !== null && level === top && d && d.batches) {"]],
    G, "", "GREEN"],   // MEASURED: the maxBatch test is dominated — a plan built in one piece has no batches to wait for
  ["G4", [[BND, "      code += src.slice(i, j); bare += \"/ /\";", "      code += src.slice(i, j); bare += \"/\" + \" \" + \"/\";"]],
    B, "", "GREEN"],   // the same blank, spelt another way
  // ── `ddjp_694` ── JOB 1: the room's bot holds its level in every channel (`features/room.js` `_standing`, `_isRoomBot`); JOB 2: a
  // rank change and an upgrade's bot step go one at a time (`Room.upgradeBotLevel`, `upgradeBotStep`, the leave's stop; the adapter's
  // `rank.assign` row; the card's line and repaint in `ui/roster.js`; `features/roomupgrade.js`'s wait on the bar). Held by
  // `check-rank-trust` PARTs J, K and I.
  // ── RT59 retired at ddjp_695: the bot's exception to decision 2 went with decision 2 (`ddjp_695`); RT75 puts the rule back for everyone.
  // ── RT60 retired at ddjp_695: `_isRoomBot` is gone (`ddjp_695`): every channel counts for everyone, so nobody is singled out as the bot; RT75.
  ["RT61", [[ROOM, "    rd = rd.filter((r) => !r.unnamed);\n", ""]],
    G, "J shared room: ITS REPAIR TARGET IS BOT", "RED"],   // the target read from every room: the late channel's making taken as the newest set — a repair that demotes
  ["RT62", [[ROOM, "    if (named.length === 1) { out.target = named[0]; out.by = \"named\"; return out; }\n", ""]],
    G, "AFTER A RELOAD, THE BOT'S SET UNPLACEABLE", "RED"],   // the rooms naming them agreeing taken as no answer: "can't tell" after a reload
  // ── RT63 retired at ddjp_695: `_isRoomBot` is gone (`ddjp_695`), with nothing left to read its answer.
  ["RT64", [[ROOM, "    if (_upStep) {\n      const s = _upStep, waiting", "    if (false) {\n      const s = _upStep, waiting"]],
    G, "A RANK CHANGE ASKED WHILE THE BOT STEP RUNS IS REFUSED BY NAME", "RED"],   // a card's change runs beside the upgrade's bot step
  ["RT65", [[ACT, "const j = _rankRunning() || _upgrading();", "const j = _rankRunning();"]],
    G, "EVERY RANK PICKER WAITS — the adapter", "RED"],   // the pickers live while the bot step runs
  ["RT66", [[ACT, " const u = _upgrading(); if (u) return u.text;", ""]],
    G, "EVERY RANK PICKER WAITS — the adapter", "RED"],   // a waiting picker that does not say why
  ["RT67", [[UI, "      if (up && !(j && j.state === \"running\")) {", "      if (false) {"]],
    G, "THE CARD'S PICKER WAITS, SAYING WHY", "RED"],   // the card's line silent while the room upgrades
  ["RT68", [[UI, " || !!(Room.upgradeBotStep && Room.upgradeBotStep())", ""]],
    G, "AND THE PICKERS ARE LIVE AGAIN", "RED"],   // the step's end repaints no card: a picker left greyed
  ["RT69", [[ROOM, "    const j = (_rankJob && _rankJob.state === \"running\") ? _rankJob : null;\n    if (j) {", "    const j = (_rankJob && _rankJob.state === \"running\") ? _rankJob : null;\n    if (false) {"]],
    G, "AN UPGRADE ASKED WHILE A CHANGE RUNS WAITS", "RED"],   // the upgrade does not wait: the bridge refuses its step and the bot gets nothing
  ["RT70", [[ROOM, "    if (_upStep) {\n      const s = _upStep, waiting", "    if (_upStep && _upStep.state === \"running\") {\n      const s = _upStep, waiting"]],
    G, "THE TURN IS KEPT", "RED"],   // a change slips in while the step waits its turn
  ["RT71", [[ROOM, "      [\"Upgrade's bot step\", () => { const s = _upStep; if (!s || s.room !== c.spaceId) return; _upStep = null; s.stopped = true; _upLeft = true; if (typeof s.wake === \"function\") { const w = s.wake; s.wake = null; w(); } _rankJobTold(); }],\n", ""]],
    G, "LEAVING STOPS BOTH", "RED"],   // the leave stops the change only: the waiting step runs after it
  ["RT72", [[ROOM, " if (typeof s.wake === \"function\") { const w = s.wake; s.wake = null; w(); } _rankJobTold(); }],", " _rankJobTold(); }],"]],
    G, "LEAVING STOPS BOTH", "RED"],   // a step stopped while waiting never answers: the upgrade hangs with its re-entrancy guard held
  ["RT73", [[ROOM, "_ringOnJob(); _upTurn(); for (const fn", "_ringOnJob(); for (const fn"]],
    G, "ONE AFTER THE OTHER", "RED"],   // the step never told its turn came: it waits forever
  ["RT74", [[RU, "{ what: \"upgrade\", onWait: (text) => { if (onProgress) onProgress(null, null, text); } },", "{ what: \"upgrade\" },"]],
    G, "AND A WAIT FOR A RANK CHANGE ON THE BAR", "RED"],   // the upgrade's bar silent while it waits for a change (re-anchored at `ddjp_695`: the wait is the whole batch's turn's)
  // ── G5 retired at ddjp_695: `_isRoomBot` is gone (`ddjp_695`).
  // G6 RE-ANCHORED AT ddjp_695: the turn's own "held" line (`_takeTurn`), now asked by an upgrade's whole batch, a Repair and the bot
  // step; measured again.
  ["G6", [[ROOM, "    if (_upStep) return { reason: \"upgrade-running\" };\n", ""]],
    G, "", "GREEN"],   // dominated: `RoomUpgrade`'s one upgrade at a time (`_running`) and a Repair's one at a time (`repairRunning`) — measured
  // ── `ddjp_695` ── JOB 1: new channels name everyone (`matrixbridge.js` `_copiedUsers`, `_powerLevels`'s `users`, `createUpgradeBatch`),
  // the whole batch in the room's one rank turn (`Room.upgradeTurn`, `features/roomupgrade.js` `upgrade`/`_batch`, the bot step in the
  // turn it is handed), and every channel counting for everyone (`features/room.js` `_standing`). Held by `check-upgrade-copy` and
  // `check-rank-trust` PARTs A, J and L.
  ["RT75", [[ROOM, "and named the late channel's default as the target (`ddjp_694`'s finding); and an upgrade's channels now name everyone.\n    const levels = [];", "and named the late channel's default as the target (`ddjp_694`'s finding); and an upgrade's channels now name everyone.\n    { const st = rd.filter((r) => !r.unnamed && typeof r.at === \"number\").map((r) => r.at); const ls = st.length ? Math.max.apply(null, st) : null; if (ls !== null) rd = rd.filter((r) => !(r.unnamed && typeof r.made === \"number\" && r.made > ls)); }\n    const levels = [];"]],
    G, "J shared room: THE STAFF MEMBER IN THE SAME ROOM", "RED"],   // decision 2 back for everyone: a Staff member missing an old upgrade's channel shown in step
  ["RT76", [[ROOM, "    if (space && !space.unnamed) { out.target = space.level; out.by = \"tie\"; return out; }", "    if (space) { out.target = space.level; out.by = \"tie\"; return out; }"]],
    G, "A TIE WITH A SPACE THAT NEVER NAMED THEM", "RED"],   // a tie settled by a Space that holds the default: a repair that demotes
  ["UC1", [[MB, "        const create = () => _build(label, it.level, creatorId, spaceId, it.gates, it.key, _copiedUsers(spaceId, creatorId));", "        const create = () => _build(label, it.level, creatorId, spaceId, it.gates, it.key);"]],
    GU, "A: EACH NEW CHANNEL NAMES ALL THREE AT CREATE", "RED"],   // an upgrade's channel born naming its creator only: everyone ranked before it out of step
  ["UC2", [[MB, "        if (id === creatorId && _versionHasCreators(ROOM_VERSION)) continue;   // the new channel's creator: listed by no version 12 room\n", ""]],
    GU, "A: A SPACE WHOSE POWER LIST NAMES THIS ACCOUNT", "RED"],   // the new channel's creator listed: a version-12 server refuses the create
  ["UC3", [[MB, "    const live = _liveChannelMap(spaceId);\n    const own = _adoptable(spaceId);\n    try {\n      for (const it of items) {", "    const live = _liveChannelMap(spaceId);\n    const own = _adoptable(spaceId);\n    const _once = _copiedUsers(spaceId, creatorId);\n    try {\n      for (const it of items) {"],   // re-anchored at `ddjp_696` (the adoption read beside it)
    [MB, "        const create = () => _build(label, it.level, creatorId, spaceId, it.gates, it.key, _copiedUsers(spaceId, creatorId));", "        const create = () => _build(label, it.level, creatorId, spaceId, it.gates, it.key, _once);"]],
    GU, "A: THE SPACE IS READ AT EACH CHANNEL'S CREATE", "RED"],   // the Space read once for the batch: a level moved between two creates left behind
  ["UC4", [[MB, "    if (users && typeof users === \"object\") pl.users = Object.assign({}, users);\n", ""]],
    GU, "A: EACH NEW CHANNEL NAMES ALL THREE AT CREATE", "RED"],   // `_powerLevels` drops the users it is handed
  ["UC5", [[RU, "      const r = await Room.upgradeTurn(spaceId, { what: \"upgrade\", onWait: (text) => { if (onProgress) onProgress(null, null, text); } },\n        (turn) => _batch(target, spaceId, onProgress, turn));", "      const r = await _batch(target, spaceId, onProgress, null);"]],
    GU, "B: A RANK CHANGE ASKED WHILE THE BATCH MAKES ITS CHANNELS IS REFUSED BY NAME", "RED"],   // the batch outside the turn: a rank change lands between two creates
  ["UC6", [[RU, "{ turn: turn, onProgress: (n, t) => { if (onProgress) onProgress(n, t, \"Bot's level\"); } }", "{ onProgress: (n, t) => { if (onProgress) onProgress(n, t, \"Bot's level\"); } }"]],
    GU, "A: THE BOT STEP STAYS AS THE BACKSTOP", "RED"],   // the bot step asks a turn of its own inside the batch's, and is refused: the backstop never runs
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
      const h = J.open("mutate-j142-rank-trust:" + id, file);   // journalled BEFORE the write
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
