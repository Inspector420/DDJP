// tools/probes/mutate-j79-restore.js
// SUBJECT: J79 — the owner's restore in a bot room, and what it changed for shared rooms. Each row undoes ONE site, confirms
// the edit LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); restored after every row.
// R1–R16 are the design round's rows; R17–R30 are the owner's additions (each says which); R31–R44 are `ddjp_570`'s (the
// supervisor's three items, and the guard change they caused); R45–R90 are `ddjp_571`'s (the owner's restart rulings: the
// restart number and its root in both room types, the bot's confirmation, the gap-3 rules, the checkpoint's committed fields);
// N1 is the control.
// REMOVED AT `ddjp_571`, with the code they held (owner's ruling: restarts replace them): R6 (the chain-after-origin rule), R32
// (the floor-position check before a restore), R33–R37 (the chain walk, its stops, its missing link, `replacedBy`), R39 (the
// fold's `over`), R40 (the origin tie at one `l`). RE-AIMED: R4, R7, R11, R13, R29, R30, R38, R42 (now `n` compared before the
// restart), R44 — each says what it targets now.
//   node tools/probes/mutate-j79-restore.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const RM = "features/room.js", B2S = "backends/backend2/streammanager.js", B2C = "backends/backend2/checkpoint.js", TR = "backends/backend2/transport.js";
const B1S = "backends/backend1/streammanager.js", B1C = "backends/backend1/checkpoint.js", MB = "backends/backend1/matrixbridge.js", RK = "backends/backend1/ranks.js";
const CAP = "backends/backend1/capabilities.js", SD = "backends/backend1/statederiver.js", SPF = "backends/backend1/settingsproof.js", BR = "features/botruntime.js";
const CF = "backends/backend1/checkpointformat.js", FL = "backends/backend1/floor.js", RN = "backends/backend2/runner.js";
const G = "check-bot-restore", FD = "check-forgetting-differential", IM = "check-import", RC = "check-room-compat";
const ROWS = [
  // ── THE DESIGN ROUND'S ROWS ──
  ["R1", B2S, "return { ok: true, reason: null, detail: null, anchored: false, cp: built.cp };", "return { ok: true, reason: null, detail: null, anchored: true, cp: built.cp };",
    G, "FAIL — A: APPLIED — and it is ONE send", "RED"],                                     // a settings post before the save point, in bot rooms
  ["R2", RM, "    const wrong = _wrongRoomType(file);\n    if (wrong) {", "    const wrong = _wrongRoomType(file);\n    if (false) {",
    G, "FAIL — B: a full file into a backend2 room is refused by name", "RED"],              // the cross-type refusal (D2)
  ["R3", RK, "level > LADDER[0].level;", "level >= LADDER[0].level;",
    G, "FAIL — B: @bot:hs (99) is refused as not the room's owner", "RED"],                    // above the ladder, on the write side
  // RE-ANCHORED at `ddjp_571`: the carrier check now reads `isOrigin(cp) && !owner` on one line (the rest of `observe` moved).
  ["R4", B2C, "    if (isOrigin(cp) && !owner) {\n", "    if (isOrigin(cp) && false) {\n",
    G, "FAIL — C: an origin carried by the room's bot (99) is REFUSED", "RED"],               // the carrier check: a bot-authored origin accepted
  ["R5", B2S, "if (!_routeCheckpoint(ev, raw.sender))", "if (!_routeCheckpoint(ev, ev.sender))",
    G, "FAIL — C: an origin carried by a staff member whose body names the owner", "RED"],  // the sender read from the body's `actor`
  // R6 REMOVED at `ddjp_571`: the chain-after-origin rule is gone; restarts refuse a seal of the old floor (R45–R51, R42).
  // RE-ANCHORED at `ddjp_571`: the replacement adopts through `_foldArgs`, and names no `over`.
  ["R7", B2S, "const r = B1StreamManager.adoptFloor(args, { take: \"all\", origin: true });", "const r = B1StreamManager.adoptFloor(args, { take: \"all\", prove: true });",
    G, "FAIL — D: the OWNER device adopted the restore as its origin", "RED"],                // the origin asked to reproduce
  ["R8", B2S, "    if (B2Checkpoint.originSeen()) {", "    if (false) {",
    G, "FAIL — D: a device opening right then opens FROM THE RESTORE", "RED"],                // opening from what stands on the restore
  ["R9", B2S, "if (!(ownerRestore || first || (b.prev && _have(b.prev)))) continue;", "if (!(ownerRestore || first || b.prev)) continue;",
    G, "FAIL — E: and never at a stale seal whose predecessor it has not reached", "RED"],   // the download stop without the predecessor
  ["R10", BR, "    if (!_mayAnswer()) {\n", "    if (false) {\n",
    G, "FAIL — M: a request arriving while the bot is still catching up is HELD", "RED"],    // the LIVE gate on the bot's settings writes
  // R11 MEASURED: history learning the origin AFTER the drop's hand-off is caught by nothing, because `History.setOrigin` drops
  // every row at or below the cut whenever it runs — the order is belt-and-braces, as recorded in the J79 entry. RE-ANCHORED at
  // `ddjp_571`, in `_replaceWith`.
  ["R11", B2S, "    try { if (typeof History !== \"undefined\" && History.setOrigin) History.setOrigin({ l: cp.floorL, h: cp.h, seed: cp.seed }); } catch (e) {}\n    const meta = B2Checkpoint.held().find((h) => h.id === id) || {};\n    const args = _foldArgs(cp, id, meta);\n    const r = B1StreamManager.adoptFloor(args, { take: \"all\", origin: true });\n",
    "    const meta = B2Checkpoint.held().find((h) => h.id === id) || {};\n    const args = _foldArgs(cp, id, meta);\n    const r = B1StreamManager.adoptFloor(args, { take: \"all\", origin: true });\n    try { if (typeof History !== \"undefined\" && History.setOrigin) History.setOrigin({ l: cp.floorL, h: cp.h, seed: cp.seed }); } catch (e) {}\n",
    G, "", "GREEN"],
  ["R12", MB, "    try { if (typeof StreamManager !== \"undefined\" && typeof StreamManager.floorChain === \"function\") return StreamManager.floorChain() || []; } catch (e) { return []; }\n", "",
    G, "FAIL — F: the REOPENED device — truth = device", "RED"],                                // the engine's floor chain (history falls back to Floor)
  // RE-AIMED at `ddjp_571`: the bot room's export chain is cut at the pick's RESTART (and, after a restore, only what stood).
  ["R13", B2S, "          CheckpointFormat.compareRestart({ era: h.era, root: h.root }, rs) === 0 && (rs.era === 0 || h.accepted))", "          true)",
    G, "FAIL — G: a file saved while the old room's save points are still held STARTS AT THE RESTORE", "RED"],
  ["R14", RM, "const room = await create(name, _fileMode || undefined);", "const room = await create(name);",
    G, "FAIL — H: from a fresh page, a bot file makes a backend2 room", "RED"],               // create-from-file without the file's engine
  ["R15", SD, "        if (isRestoreAnchor(c)) { _rej(ev, \"restore-anchor\"); continue; }\n", "",
    G, "FAIL — J: the reducer refuses an anchor", "RED"],                                     // the reducer applies a restore anchor
  ["R16", SPF, "    if (!e.anchor) return true;\n", "    return true;\n",
    G, "FAIL — J: SettingsProof does not take an ORPHAN anchor", "RED"],                      // SettingsProof counts an orphan anchor
  // ── THE OWNER'S ADDITIONS ──
  ["R17", CAP, "        return Ranks.aboveLadder(myRank) ? OK : no(\"Only the room's owner can restore it from a file\");",
    "        return Ranks.atLeast(myRank, \"owner\") ? OK : no(\"Only the room's owner can restore it from a file\");",
    G, "FAIL — I: @bot:hs never sees the restore control", "RED"],                             // addition 4: the control by the owner rule
  ["R18", MB, "      return !!room && Ranks.aboveLadder(_userLevelInRoom(room, entry.sender));", "      return false;",
    G, "FAIL — K: decent-534-497's restore", "RED"],                                         // addition 5: the creator-carried origin still adopts
  ["R19", MB, "      if (cp && !cp.prev && cp.thin === true &&\n", "      if (false && cp && !cp.prev && cp.thin === true &&\n",
    G, "FAIL — K: the same origin carried by a top-rung account that is NOT the creator is ignored", "RED"],   // addition 5: a non-creator origin refused
  ["R20", B1S, "    if (_asOrigin) _recordOriginVerdict(fl);\n", "",
    G, "FAIL — C: and recorded as decentralized rooms record their origin", "RED"],         // addition 1: the origin-seed exception, recorded
  ["R21", MB, "    const known = !!(History.knowsFloor && History.knowsFloor(c[0].h));", "    const known = true;",
    G, "FAIL — F: the REOPENED device — truth = device", "RED"],                              // additions 2–3: a table stored before the restore
  ["R21b", MB, "    const known = !!(History.knowsFloor && History.knowsFloor(c[0].h));", "    const known = true;",
    FD, "FAIL — S19: the RESTORED device's history is the room's", "RED"],                     // the same hole in a shared room
  ["R22", "backends/backend1/history.js", "    for (const k of Object.keys(_verified)) { const ab = k.slice(KEY_V.length).split(\">\"); if (ab[0] === h || ab[1] === h) return true; }\n", "",
    G, "and its second open reads 0 pages and corrects 0 rows", "RED"],                       // addition 3: a floor the table verified is known
  ["R23", B1S, "    _moveOnLogged = null;\n    _bankedOwed = false;", "    _bankedOwed = false;",
    G, "FAIL — N: re-entering the room clears the mark", "RED"],                               // addition 7: the owed rider
  ["R24", RM, "    const settings = (typeof vis === \"string\") ? Object.assign({}, base, { vis: vis }) : Object.assign({}, base);",
    "    const settings = Object.assign({}, base);",
    G, "FAIL — L: a backend2 restore keeps THIS room's door", "RED"],                           // D4: this room's door
  ["R25", RM, "    const fit = MatrixBridge.mayAuthor ? MatrixBridge.mayAuthor() : { ok: true };\n    if (fit && fit.ok === false) {",
    "    const fit = MatrixBridge.mayAuthor ? MatrixBridge.mayAuthor() : { ok: true };\n    if (!fit) {",
    G, "FAIL — B: a client still loading is refused", "RED"],                                   // J28's boolean reading of `mayAuthor`
  ["R26", B2S, "      if (!_ownerSender(me)) return no(\"not-owner\");\n", "",
    G, "FAIL — B: and the bot room's engine refuses the bot's own plan", "RED"],              // the engine asks again
  ["R27", B1C, "    if (!amRoomOwner) return { ok: false, reason: \"not-owner\" };\n", "",
    IM, "C: a non-owner is REFUSED by name", "RED"],                                            // the shared room's publisher asks the room owner
  ["R28", TR, "        levelOf: (userId) => B1MatrixBridge.getUserEffectiveRank(_spaceId, _ch, userId),", "        levelOf: () => 0,",
    G, "FAIL — A: the owner's restore in a bot room succeeds", "RED"],                         // the transport hands the door its level reader
  // RE-AIMED at `ddjp_571`: a save point of an earlier restart than the room's cannot be saved.
  ["R29", B2S, "      if (CheckpointFormat.compareRestart(rs, B2Checkpoint.floorRestart()) < 0) return { ok: false, reason: \"replaced-by-restore\" };\n", "",
    G, "FAIL — G: and the refused seal on the old floor cannot be saved", "RED"],
  // RE-AIMED at `ddjp_571`: the shared export's cut at the newest origin is what still starts a RESTART-0 room's file at its own J28
  // restore (part K, built as ?v=519 wrote it); after a restore the restart cut (R89) does it too, so G no longer reads this line.
  ["R30", B1S, "      for (let i = 0; i < _all.length; i++) if (!_all[i].prev && _all[i].thin === true) _o = i;\n", "",
    G, "FAIL — K: a file saved from it starts at that restore", "RED"],
  // ── `ddjp_570`: THE SUPERVISOR'S THREE ITEMS ──
  // Item 1, a restore delivered again or an older one after a newer (part O), and the restore that must still win (P, P2):
  ["R31", B2C, "    if (_held.some((h) => (id !== null && h.id === id) || (h.cp && h.cp.h === cp.h))) {", "    if (false) {",
    G, "FAIL — O: and a save point already held — by its event id, or its fingerprint under another id — changes nothing", "RED"],   // the duplicate check
  // R32–R37 REMOVED at `ddjp_571`, with the floor-position check, the chain walk, its stops and `replacedBy` (owner's ruling).
  // RE-AIMED at `ddjp_571`: the fold's own check is by restart now — the same restore again is not a LATER restart.
  ["R38", B1S, "      if (_asOrigin && _c === 0) return { ok: false, reason: \"not-a-later-restart\" };\n", "",
    G, "FAIL — O: the fold refuses it by itself", "RED"],                                              // the fold's own check
  // R39 (`over`) and R40 (the origin tie at one `l`) REMOVED at `ddjp_571`.
  // RE-NAMED at `ddjp_571`: with no position the restore names no root, so the bot cannot seal on it — the story stops there.
  ["R41", B2S, "{ id: shaped.event_id, at: shaped.ts, l: shaped.l, owner: _ownerSender(carrier) }", "{ id: shaped.event_id, at: shaped.ts, owner: _ownerSender(carrier) }",
    G, "seal refused: the restore this would build on has no position", "RED"],                      // the door hands no position: no restore's root
  // Item 2, the supervisor's own mutation, RE-AIMED at `ddjp_571` (its line, the chain-after-origin rule, is gone): `n` compared
  // BEFORE the restart — a stale-seal rule keyed on `n` again.
  ["R42", B2C, "    if (c !== 0) return { c: c, by: \"restart\" };\n    if (a.cp.n !== b.cp.n) return { c: a.cp.n > b.cp.n ? 1 : -1, by: \"n\" };\n",
    "    if (a.cp.n !== b.cp.n) return { c: a.cp.n > b.cp.n ? 1 : -1, by: \"n\" };\n    if (c !== 0) return { c: c, by: \"restart\" };\n",
    G, "FAIL — P: the second stale seal — its `n` one higher than the restore's — is refused on the", "RED"],
  // The small item: a dropped held request is said.
  ["R43", BR, "        Logger.warn(\"BotRuntime: a settings request from \" + ((gone && gone.sender) || \"?\") + \" was DROPPED unanswered — more than \" +\n          MAX_HELD_REQUESTS + \" waited while this tab caught up (\" + _running.droppedHeld + \" dropped so far)\");\n", "",
    G, "FAIL — M: the 51st held request pushes the oldest out — and it is SAID", "RED"],
  // The guard change it caused: `check-backends` I replays an older checkpoint the client does not hold. RE-AIMED at `ddjp_571`: the
  // forward-only rule within a restart is the `n` step of the order now.
  ["R44", B2C, "    if (a.cp.n !== b.cp.n) return { c: a.cp.n > b.cp.n ? 1 : -1, by: \"n\" };\n", "    if (a.cp.n !== b.cp.n) return { c: 1, by: \"n\" };\n",
    "check-backends", "FAIL — I: replaying an older one does NOT rewind the floor", "RED"],
  // ── `ddjp_571`: THE RESTART NUMBER AND ITS ROOT (owner's ruling 2) ──
  // The format: committed from restart 1, absent at restart 0.
  ["R45", CF, "      o.era = era;\n", "",
    G, "FAIL — U: from restart 1 both are COMMITTED", "RED"],                                         // a raised era would verify
  ["R46", CF, "      if (r) o.root = r;\n", "",
    G, "FAIL — U: from restart 1 both are COMMITTED", "RED"],                                         // another root would verify
  ["R47", CF, "    if (Number.isSafeInteger(era) && era > 0) {\n      o.era = era;", "    o.era = Number.isSafeInteger(era) ? era : 0;\n    if (Number.isSafeInteger(era) && era > 0) {\n      o.era = era;",
    G, "FAIL — U: a save point of restart 0 hashes EXACTLY as before restarts existed", "RED"],     // restart 0 committed: every room re-fingerprinted
  ["R47b", CF, "    if (Number.isSafeInteger(era) && era > 0) {\n      o.era = era;", "    o.era = Number.isSafeInteger(era) ? era : 0;\n    if (Number.isSafeInteger(era) && era > 0) {\n      o.era = era;",
    RC, "[room-compat] FAIL — WHAT A CHECKPOINT COMMITS HAS CHANGED", "RED"],                          // owner's ruling 5: room-compat sees it
  ["R48", CF, "    if (cp.era !== undefined && !(Number.isSafeInteger(cp.era) && cp.era > 0)) return false;\n", "",
    G, "FAIL — U: and a malformed restart (`era: 0`, a string) is refused", "RED"],                   // `era: 0` read as restart 0
  // The order: the restart (era, then root), then `n`, then position.
  ["R49", CF, "    return laterInLog(ra, rb) ? 1 : -1;\n  }\n  function restartOf", "    return 0;\n  }\n  function restartOf",
    G, "FAIL — Q: on the", "RED"],                                                                     // two restores of one restart: no root decides
  ["R50", CF, "    if (ea !== eb) return ea > eb ? 1 : -1;\n", "",
    G, "FAIL — D: a seal the bot made on the OLD floor, landing after the restore, is refused on the", "RED"],   // the era not compared
  ["R51", B2C, "    if (c !== 0) return { c: c, by: \"restart\" };\n", "",
    G, "FAIL — D: the OWNER device adopted the restore as its origin", "RED"],                         // the bot room's order without the restart
  ["R52", B2C, "    return { c: _laterInLog(a.place, b.place) ? 1 : -1, by: \"position\" };", "    return { c: -1, by: \"position\" };",
    G, "FAIL — U: at one restart and one `n`, the save point LATER IN THE LOG stands", "RED"],        // a tie by arrival order
  ["R53", B2C, "        if (h !== entry && h.accepted && CheckpointFormat.compareRestart(_restartOf(h.cp, h.place), nr) < 0) h.accepted = false;\n", "",
    G, "FAIL — P2: and the stale seal seen first is not a save point that stood", "RED"],            // the old room's save points still read as stood
  ["R54", B2C, "    if (CheckpointFormat.eraOf(cp) > 0 && !isOrigin(cp) && !CheckpointFormat.rootOf(cp)) {", "    if (false) {",
    G, "FAIL — U: a save point of a restart that names no restore is refused", "RED"],
  // A restore starts a restart: one past the floor's, `n` back to 1, its own event its root; a seal inherits the floor's.
  ["R55", B2C, "    const era = CheckpointFormat.eraOf(_floor) + 1, n = 1;", "    const era = 1, n = 1;",
    G, "FAIL — U: and a restore on a restart-1 floor starts restart 2", "RED"],
  ["R56", B2C, "    const era = CheckpointFormat.eraOf(_floor) + 1, n = 1;", "    const era = CheckpointFormat.eraOf(_floor) + 1, n = _floor ? _floor.n + 1 : 1;",
    G, "FAIL — D: the restore starts a NEW RESTART", "RED"],                                            // `ddjp_569`'s count
  ["R57", B2C, "    const rs = floorRestart();\n", "    const rs = { era: 0, root: null };\n",
    G, "FAIL — D: and carries the restore's restart", "RED"],                                           // a seal on the restore of restart 0
  ["R58", CF, "    return origin ? _rootShape(place) : _rootShape(cp.root);", "    return _rootShape(cp.root);",
    G, "seal refused: the restore this would build on has no position", "RED"],                      // a restore that is not its own root
  // The door: the fold is handed each save point's restart; a later restart replaces the room.
  ["R59", B2S, "h: cp.h, n: cp.n, era: rs.era, root: rs.root };", "h: cp.h, n: cp.n };",
    G, "FAIL — D: the OWNER device adopted the restore as its origin", "RED"],
  ["R60", B2S, "    if (B2Checkpoint.floor() && CheckpointFormat.compareRestart(B2Checkpoint.floorRestart(), fr) > 0) return _replaceWith(B2Checkpoint.floorId());\n", "",
    G, "FAIL — D: the OWNER device adopted the restore as its origin", "RED"],
  // R61 MEASURED: moving on only within the fold's restart is belt-and-braces — a save point of an earlier restart is refused by the
  // fold itself (`earlier-restart`, R63), and a later one is a replacement, handled on the line before.
  ["R61", B2S, "        CheckpointFormat.compareRestart({ era: h.era, root: h.root }, fr) === 0)\n      .sort((a, b) => b.floorL - a.floorL);", "        true)\n      .sort((a, b) => b.floorL - a.floorL);",
    G, "", "GREEN"],
  ["R62", B2S, "    const held = B2Checkpoint.held().filter((h) => CheckpointFormat.compareRestart({ era: h.era, root: h.root }, fr) === 0)\n", "    const held = B2Checkpoint.held().filter((h) => true)\n",
    G, "FAIL — C: a device OPENING while that origin is the newest save point by position", "RED"],    // opening from a refused origin
  ["R63", B1S, "      if (_c < 0) return { ok: false, reason: \"earlier-restart\" };\n", "",
    G, "FAIL — O: the fold refuses it by itself", "RED"],                                              // the fold steps back a restart
  // The live check's lines (J79's Done-when), with the restart and the count.
  ["R64", B2S, "      if (_o && _o.adopted === false && /owner restores|before the room's restore|earlier restore|must name its restore/.test(String(_o.why))) {", "      if (false) {",
    G, "FAIL — D: the OWNER device SAYS both", "RED"],
  ["R65", B2S, "      if (r && r.ok && origin) Logger.info(", "      if (false) Logger.info(",
    G, "FAIL — D: the OWNER device SAYS both", "RED"],
  ["R66", B2S, "      else if (r && r.ok) Logger.info(", "      else if (false) Logger.info(",
    G, "FAIL — R: a device that never read the restore moves to its restart when the bot's confirmation arrives — and says so", "RED"],
  // ── `ddjp_571`: THE BOT CONFIRMS THE OWNER'S RESTORE (owner's ruling 3) ──
  ["R67", B2S, "    if (r && r.ok && origin) { try { if (typeof B2Runner !== \"undefined\" && B2Runner.restoreAdopted) B2Runner.restoreAdopted(id); } catch (e) {} }\n", "",
    G, "FAIL — R: the moment the bot's fold stands on the owner's restore, its confirmation is planned", "RED"],
  ["R68", RN, "      Logger.info(\"B2Runner: confirming the owner's restore — restart \"", "      if (false) Logger.info(\"B2Runner: confirming the owner's restore — restart \"",
    G, "FAIL — R: and says so", "RED"],
  ["R69", RN, "    if (!B2Checkpoint.floorIsOwnerOrigin()) return false;\n", "",
    G, "FAIL — R: re-read just before sending", "RED"],                                                 // owed on any floor the fold stands on: the
                                                                                                         // ordinary seal that lands first no longer stands it down
  ["R70", RN, "      stillNeeded: () => _confirmOwed(),", "      stillNeeded: () => true,",
    G, "FAIL — R: re-read just before sending", "RED"],
  ["R71", RN, "    if (_confirmFor && _confirmFor.h === fl.h && (Date.now() - _confirmFor.at) < cool) return false;   // in flight\n", "",
    G, "FAIL — R: asked again while it is in flight, nothing more is sent", "RED"],
  ["R72", RN, "    if (!fl || !ad || ad.h !== fl.h) return false;                 // the fold stands on it\n", "    if (!fl) return false;\n",
    G, "FAIL — R: and none is owed for a restore the bot's fold could not stand on", "RED"],
  ["R73", RN, "    if (!_on) return;\n    _confirmSoon();\n", "    if (!_on) return;\n",
    G, "FAIL — R: OFFLINE — the bot, back after the restore, confirms it on its return", "RED"],      // nothing plans it on the return to LIVE
  ["R74", RN, "    const out = B2Checkpoint.seal(seed, {\n      isRunner: true,\n      floorL: (head && typeof head.l === \"number\") ? head.l : fl.floorL,",
    "    const out = B2Checkpoint.restore(seed, {\n      isRunner: true,\n      floorL: (head && typeof head.l === \"number\") ? head.l : fl.floorL,",
    G, "FAIL — R: the bot confirms it AT ONCE", "RED"],                                                // a confirmation that is a restore
  ["R75", RN, "    B2Authority.submitRaw(B2Checkpoint.TYPE, out.cp);   // through the gate, in order (J76)\n    return out.cp;", "    _write(B2Checkpoint.TYPE, out.cp);\n    return out.cp;",
    G, "FAIL — R: and it waits in the ordered gate", "RED"],                                            // written past the gate
  // ── `ddjp_571`: THE GAP-3 RULES (owner's ruling 4) ──
  ["R76", B2S, "      if (c.era < topEra) continue;                               // a later restart is in hand\n", "",
    G, "FAIL — U: a download that has read a save point of restart 1 does not stop", "RED"],
  ["R77", RN, "  function _keyBelow(a, b) { return a.era !== b.era ? a.era < b.era : a.n < b.n; }", "  function _keyBelow(a, b) { return a.n < b.n; }",
    G, "FAIL — U: the runner reads a restore (restart 1, `n` 1) as PAST", "RED"],
  ["R78", B2S, "          if (CheckpointFormat.eraOf(cp) > 0) { o.era = cp.era; if (cp.root) o.root = { l: cp.root.l, id: cp.root.id }; }   // committed: it travels (`ddjp_571`)\n", "",
    G, "FAIL — G: and the file carries each save point's restart", "RED"],                               // a bot export without the restart
  ["R79", B1S, "          if (CheckpointFormat.eraOf(e) > 0) { o.era = e.era; if (e.root) o.root = { l: e.root.l, id: e.root.id }; }   // committed: it travels (`ddjp_571`)\n", "",
    G, "FAIL — S: a file saved from it carries the restart, and reads back", "RED"],                    // a shared export without it
  // ── `ddjp_571`: THE SHARED ROOM (the design round's M1) ──
  ["R80", FL, "    if (_c < 0) return false;                                        // from before the room's restore\n", "",
    G, "FAIL — S: the bot's seal after the restore — the RESTORE stands", "RED"],
  ["R81", FL, "    if (_trusted && _c === 0 && _pos(f) <= _pos(_trusted)) return false;   // not an improvement", "    if (_trusted && _pos(f) <= _pos(_trusted)) return false;   // not an improvement",
    G, "FAIL — S: the bot's seal before the restore — the RESTORE stands", "RED"],                      // a later restart asked for a higher cut
  // R82 MEASURED: `adopt`'s own tier check is belt-and-braces — `select` offers only candidates of the binding restart, which
  // only the owner channel raises (R83), and the owner channel adopts at tier 0.
  ["R82", FL, "    if (_c > 0 && selected.tier !== 0) return false;                 // only the owner channel opens a restart\n", "",
    G, "", "GREEN"],
  ["R83", FL, "      if (!e || TrustPolicy.tierOf(e.r) !== 0) continue;\n", "      if (!e) continue;\n",
    G, "FAIL — S: a seal from a lower rung CLAIMING a later restart opens nothing", "RED"],
  // R84 MEASURED: `select`'s restart filter is belt-and-braces — `adopt` refuses an earlier restart (R80), and a later one from a
  // lower rung (R82); it keeps such candidates from being chosen at all.
  ["R84", FL, "      CheckpointFormat.compareRestart(restartOf(cp), bind) === 0);", "      true);",
    G, "", "GREEN"],
  ["R85", B1S, "      if (protocolType === \"ddjp.checkpoint\") notify(_n);\n", "",
    G, "FAIL — S: the bot's seal before the restore — the RESTORE stands", "RED"],                      // a banked restore never reaches Floor
  ["R86", B1C, "    try { if (typeof Floor !== \"undefined\" && Floor.bindingRestart) era = Floor.bindingRestart().era + 1; } catch (e) { era = 1; }\n", "",
    G, "FAIL — S: and the next restore starts restart 2", "RED"],
  ["R87", B1C, "      const rs = (floor && typeof Floor !== \"undefined\" && Floor.restartOf) ? Floor.restartOf(floor) : { era: 0, root: null };", "      const rs = { era: 0, root: null };",
    G, "FAIL — S: the owner's next seal carries the restore's restart", "RED"],
  ["R88", MB, "        Floor.adopt({ floor: Object.assign({ u: author, place: place }, cp), tier: 0 });", "        Floor.adopt({ floor: Object.assign({ u: author }, cp), tier: 0 });",
    G, "FAIL — S: the owner's next seal carries the restore's restart", "RED"],                          // a restore adopted with no root
  ["R89", B1S, "e.floorL <= pick.floorL && _same(e))", "e.floorL <= pick.floorL)",
    G, "FAIL — S: a file saved from it carries the restore and that seal", "RED"],                       // the shared export's restart cut
  ["R90", MB, "      if (!Floor.remember(cp, rank, author, entry && entry.ts, place)) return;", "      if (!Floor.remember(cp, rank, author, entry && entry.ts)) return;",
    G, "FAIL — S: a file saved from it carries the restore and that seal", "RED"],                     // a held restore with no root: the file leaves it out
  // ── THE CONTROL ──
  ["N1", B2C, "const B2Checkpoint = (() => {\n", "const B2Checkpoint = (() => {\n\n", G, "", "GREEN"],
];
let planted = null;
function restore() { if (planted) { fs.writeFileSync(planted.file, planted.original); planted = null; } }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, rel, oldS, newS, guard, expect, want] of ROWS) {
  const file = path.join(ROOT, rel);
  const original = fs.readFileSync(file, "utf8");
  const n = original.split(oldS).length - 1;
  if (n !== 1) { console.log("VOID  " + id + " — anchor occurs " + n + " times in " + rel); bad++; continue; }
  const mutated = original.replace(oldS, newS);
  if (mutated === original) { console.log("VOID  " + id + " — the edit changed nothing"); bad++; continue; }
  planted = { file, original };
  fs.writeFileSync(file, mutated);
  let out = "", code = 0;
  try {
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (fs.readFileSync(file, "utf8") !== original) { console.log("ABORT — " + rel + " was not restored"); process.exit(2); }
  // Judged by the suite's own rule (`_verdict.js`, over `run-all.js` `verdictOf`), plus the named failure.
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green" + (id === "N1" ? " — the control" : " — the line is unreachable, as recorded")); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — expected no change; the 'unreachable' claim is wrong"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
