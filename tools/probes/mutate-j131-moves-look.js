// tools/probes/mutate-j131-moves-look.js
// SUBJECT: J131 — reorder a playlist's songs, one look for the queue pane's lists, and moderation in colour (the owner's,
// `ddjp_654`): `core/playlistdoc.js` (the move, decided once), `features/playlists.js` (the move written; a playlist's reads,
// edits and deletion in turn), `ui/playlists.js` (the room queue's four moves on each row, hidden and inert while locked; a
// move drawn at once from the held record, the list only, and only the latest move's read heard), `ui/queue.js` (the room
// queue one list, Now Playing its first row), `ui/panels.js` (History one list; skipped, ▲ and ★ as their own elements),
// `features/room.js` (`moderation` on every `FEED_KINDS` row, carried by the fold), `ui/chat.js` (the class on chat's row),
// `index.html` (the hide rule, the lists, the colours, the phone's border-box). Held by `check-playlist-moves`,
// `check-list-look`, `check-feed-moderation`, `check-control-styling` (J131's classes) and `check-owner-screens` C (the line
// first). And J131's correction (`ddjp_656`): every song row one height (`index.html`'s `.song-row`, `ui/playlists.js`'s
// `SONG_ROW_H`), read through `tests/_page-css.js`, the one reader of the page's stylesheet — RS1–RS5, and LK16–LK17 re-aimed.
// And at `ddjp_670` (the job the owner chose, his words W1–W3): six typing boxes in the chat's tint from one rule, the settings',
// rename and picker boxes grey (`index.html`'s shared rule, the `chat-tint` class in `ui/queue.js` and `ui/playlists.js`) — TI1–TI8;
// a playlist's top row, ← the lock's size, the box hinting its name, Add, +All (`ui/playlists.js` `_renderPlaylistDetail`, the
// sheet's `.pl-back` and `.pl-link`) — PT1–PT10; an empty playlist says nothing — PE1–PE2; held by `check-list-look` T, G, E.
// And at `ddjp_671` (the owner, L1–L3) Add became a blue ＋ — corrected at `ddjp_672` (his C1 and C4) to its own square right after
// the link box, ← and ＋ 30 × 30 squares, each glyph the square's `::before`, centred (`ui/playlists.js` `_renderPlaylistDetail`,
// the sheet's `.pl-back`, `.pl-link-add` and their `::before`) — PT11–PT31; PT2, PT3, PT6, PT7, PT9, PT11–PT13 and PT21
// re-anchored at `ddjp_672`, PT14–PT16, PT20 and PT22 retired; held by `check-list-look` G and `check-owner-screens` H.
// And at `ddjp_658` moderation teal, not the Staff blue it was (the owner: "something more unique"), a hue no rank paints a
// name in (`ui/base.js`'s faces, read by `check-feed-moderation` E) — TL1–TL5; LK11, LK14, FM9–FM12 and CS1 re-anchored.
// And at the milestone close after `ddjp_658`: the page reader walks the page as a browser does (a comment only between
// elements; a style's and a script's text raw), and no other reader in tests/ or tools/ cuts the stylesheet out on its own
// (`check-list-look` P and R; `tests/check-message-row.js` and `tests/check-rank-faces.js` moved onto the reader) — RS5
// re-anchored, RS6–RS12.
// And at `ddjp_677` (the owner's request at `ddjp_674`, his option 1): with nothing playing the first row is an empty play row —
// the playing row's shape, its picture's square empty with no ♪ and no preview, ▶, no title, ★ and ▲ disabled with no numbers
// (`ui/queue.js`, `ui/chat.js` `_starBtn` / `_voteBtn`'s `empty`, the sheet's `.rq-np-empty`), the playing row's and the Player's
// own ★ and ▲ as they were — NE1–NE15, held by `check-list-look` A, `check-owner-screens` C and `check-control-styling`; LK15
// re-anchored (History's ★ count is built from `shownCounts` now).
// One row per way it could go wrong, each naming the failure it must cause.
//
// JOURNALLED (`_journal.js`) and APPLIED-CHECKED TWICE, as `mutate-j130-lists`: every edit is recorded on disk before it is
// made and cleared only once the original bytes are back; each file must hold exactly its mutated bytes when the guard starts
// AND when its result is read, or the row is VOID. Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j131-moves-look.js            every row
//   node tools/probes/mutate-j131-moves-look.js MV3 FM1    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const DOC = "core/playlistdoc.js", FP = "features/playlists.js", PL = "ui/playlists.js", Q = "ui/queue.js", PN = "ui/panels.js",
  RM = "features/room.js", CH = "ui/chat.js", IX = "index.html", PM_T = "tests/check-playlist-moves.js", PC = "tests/_page-css.js",
  BS = "ui/base.js", MR = "tests/check-message-row.js", RF = "tests/check-rank-faces.js",
  DF = "tools/docs-for.js", J130P = "tools/probes/mutate-j130-lists.js";
const PM = "check-playlist-moves", LL = "check-list-look", FM = "check-feed-moderation", CS = "check-control-styling", OS = "check-owner-screens",
  QR_ = "check-queue-redraw";
// The chat's tint, one rule (`ddjp_670`; `index.html`).
// RE-ANCHORED at `ddjp_677` (part 3, the owner's "B for bowth settings pannels"): the one rule is two now — the darkness, which the
// locked settings cards share, and the chat's frame, which they do not — so TI1–TI5 and TI8 take both lines and still break what
// they broke.
// RE-ANCHORED at `ddjp_678` (J133): the darkness rule gained a second line (the lists, the player's cover, a locked skip rule's
// box), so SHARED is both lines; TI1–TI5 still break what they broke.
const SHARED = "    .chat-messages, .chat-input, .dm-search, .invite-input, .chat-tint, .prefs-body.prefs-locked .pref-section, .prefs-body.prefs-locked .set-sec, .prefs-body.prefs-locked > .set-row,\n" +
  "      .song-row, .pl-row, .dm-row, .logs-box, .player-shield.waiting, .prefs-body.prefs-locked .set-rule, .prefs-body.prefs-locked .set-deps .set-row { background: rgba(12,12,16,0.45); }";
const FRAME = "    .chat-messages, .chat-input, .dm-search, .invite-input, .chat-tint { border: 1px solid rgba(255,255,255,0.06); }";
// The empty play row, as `ui/queue.js` builds it (`ddjp_677`).
const NE_ROW = "      list.appendChild(H.el(\"div\", { class: \"song-row rq-np-empty\", \"aria-hidden\": \"true\" }, [\n" +
  "        H.el(\"span\", { class: \"thumb-slot\" }),\n        H.el(\"span\", { class: \"sr-pos\", text: \"\\u25B6\" }),\n" +
  "        H.el(\"div\", { class: \"sr-main\" }),\n" +
  "        H.el(\"span\", { class: \"uq-actions\" }, [ChatPanels._starBtn({ empty: true }), ChatPanels._voteBtn({ empty: true })]),\n      ]));\n";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── A: the move, decided once ──
  ["MV1", [[DOC, `out.splice(to === "up" ? i - 1 : to === "down"`, `out.splice(to === "up" ? i : to === "down"`]],
    PM, "A: MOVE UP", "RED"],   // up moves nothing
  ["MV2", [[DOC, `if ((to === "up" || to === "top") && i === 0) return`, `if (to === "top" && i === 0) return`]],
    PM, "A: REFUSED BY NAME", "RED"],   // up from the first song is not refused
  ["MV3", [[DOC, "    const out = list.slice();\n", "    const out = list;\n"]],
    PM, "A: THE LIST IT WAS GIVEN IS UNTOUCHED", "RED"],   // the move changes the record it was given
  // ── B: written at once, in the playlist's turn ──
  ["MV4", [[FP, "      rec.tracks = m.tracks;\n      const okd = await Store.playlists.persist(rec);", "      rec.tracks = m.tracks;\n      const okd = true;"]],
    PM, "IS WRITTEN AT ONCE, ON THIS DEVICE", "RED"],   // the move never reaches storage
  ["MV5", [[FP, "    const run = (_turns[k] || Promise.resolve()).then(() => fn(), () => fn());", "    const run = Promise.resolve().then(() => fn());"]],
    PM, "B: AN ADD AND A REMOVE AT ONCE BOTH LAND", "RED"],   // no turns: 654's lost edit
  ["MV6", [[FP, "  function get(id) { return _inTurn(id, () => Store.playlists.loadOne(id)); }", "  function get(id) { return Promise.resolve(Store.playlists.loadOne(id)); }"]],
    PM, "B: A READ WAITS FOR THE EDITS ASKED BEFORE IT", "RED"],   // a read jumps the edits before it
  ["MV7", [[FP, "  function remove(id) {\n    return _inTurn(id, async () => {", "  function remove(id) {\n    return (async () => {"],
           [FP, "      _index = PlaylistDoc.indexRemove(_index, id);\n      _notify();\n      return { ok: true };\n    });", "      _index = PlaylistDoc.indexRemove(_index, id);\n      _notify();\n      return { ok: true };\n    })();"]],
    PM, "B: A PLAYLIST DELETED WHILE AN EDIT TO IT IS BEING WRITTEN STAYS DELETED", "RED"],   // the edit's write brings it back
  ["MV8", [[FP, "      if (!m.ok) return { ok: false, reason: m.reason };\n      rec.tracks = m.tracks;", "      if (!m.ok) { await Store.playlists.persist(rec); return { ok: false, reason: m.reason }; }\n      rec.tracks = m.tracks;"]],
    PM, "B: AND A REFUSED MOVE WRITES NOTHING", "RED"],   // a refusal still writes
  // ── C: the screen ──
  ["MV9", [[PL, "    acts.push(mv(\"\\u25B2\", \"Move up\", \"up\", !isFirst), mv(\"\\u25BC\", \"Move down\", \"down\", !isLast), sep(),\n              mv(\"\\u23EB\\uFE0E\", \"Move to top\", \"top\", !isFirst), mv(\"\\u23EC\\uFE0E\", \"Move to bottom\", \"bottom\", !isLast), sep());",
                 "    acts.push(mv(\"\\u23EB\\uFE0E\", \"Move to top\", \"top\", !isFirst), mv(\"\\u23EC\\uFE0E\", \"Move to bottom\", \"bottom\", !isLast), sep(),\n              mv(\"\\u25B2\", \"Move up\", \"up\", !isFirst), mv(\"\\u25BC\", \"Move down\", \"down\", !isLast), sep());"]],
    PM, "C: EACH SONG ROW CARRIES THE ROOM QUEUE'S FOUR MOVES, IN ITS ORDER AND WITH ITS GLYPHS", "RED"],   // jumps before steps
  ["MV10", [[PL, "    acts.push(mv(\"\\u25B2\", \"Move up\", \"up\", !isFirst), mv(\"\\u25BC\", \"Move down\"", "    acts.push(mv(\"\\u25B4\", \"Move up\", \"up\", !isFirst), mv(\"\\u25BC\", \"Move down\""]],
    PM, "C: EACH SONG ROW CARRIES THE ROOM QUEUE'S FOUR MOVES, IN ITS ORDER AND WITH ITS GLYPHS", "RED"],   // a glyph of its own
  ["MV11", [[PL, "mv(\"\\u25B2\", \"Move up\", \"up\", !isFirst)", "mv(\"\\u25B2\", \"Move up\", \"up\", true)"]],
    PM, "C: THE FIRST SONG'S ▲ AND ⏫ ARE DISABLED", "RED"],   // the first song's ▲ live
  ["MV12", [[PL, "mv(\"\\u23EC\\uFE0E\", \"Move to bottom\", \"bottom\", !isLast)", "mv(\"\\u23EC\\uFE0E\", \"Move to bottom\", \"bottom\", true)"]],
    PM, "C: THE LAST SONG'S ▼ AND ⏬ ARE DISABLED", "RED"],   // the last song's ⏬ live
  ["MV13", [[PL, "class: \"pl-detail-body\" + (H.plLocked() ? \" pl-locked\" : \"\")", "class: \"pl-detail-body\""]],
    PM, "C: LOCKED, THE MOVES ARE HIDDEN", "RED"],   // the lock's class not on the list
  ["MV14", [[IX, "    .pl-locked .pl-ctl { display: none; }\n", ""]],
    PM, "C: LOCKED, THE MOVES ARE HIDDEN", "RED"],   // the hide rule gone
  ["MV15", [[PL, "      if (on && move) b.onclick = () => { if (H.plLocked()) return; move(songKey, to); }; else b.disabled = true;", "      if (on && move) b.onclick = () => { move(songKey, to); }; else b.disabled = true;"],
            [PL, "    const move = (songKey, to) => {\n      if (H.plLocked()) return;\n", "    const move = (songKey, to) => {\n"]],
    PM, "C: LOCKED, A CLICK THAT REACHES A MOVE DOES NOTHING", "RED"],   // a hidden move still moves
  ["MV16", [[PL, "      _plHeld = { id, rec: m.rec };\n      const turn = ++_plMoveTurn;\n      H.clear(body);\n      draw(m.rec);\n", "      _plHeld = { id, rec: m.rec };\n      const turn = ++_plMoveTurn;\n"],
            [PL, "          if (sameRec(m.rec, rec)) return;\n", ""]],
    PM, "SHOWS THE NEW ORDER AT ONCE", "RED"],   // nothing drawn until the read: the blink
  ["MV17", [[PL, "      const turn = ++_plMoveTurn;\n      H.clear(body);\n      draw(m.rec);\n", "      const turn = ++_plMoveTurn;\n      QueuePanels.renderQueuePanel();\n"]],
    PM, "ONLY THE LIST IS REDRAWN", "RED"],   // the whole panel redrawn: the typed link gone
  ["MV18", [[PL, "          if (turn !== _plMoveTurn || !body.isConnected) return;\n", "          if (!body.isConnected) return;\n"]],
    PM, "C: A MOVE'S READ THAT LANDS AFTER A LATER MOVE IS NOT HEARD", "RED"],   // every move's read heard: a later move builds on an older order
  ["MV19", [[PL, "      if (turn0 !== _plMoveTurn) return;      // a move since: its own read reconciles (J131)\n", ""]],
    PM, "C: MOVES DURING A REDRAW'S READ", "RED"],   // a redraw's older read becomes the record moves build on
  ["MV20", [[PL, "          if (sameRec(m.rec, rec)) return;\n", ""]],
    PM, "THE READ THAT FOLLOWS AGREES, AND TOUCHES NOTHING", "RED"],   // the agreeing read redraws the list
  ["MV21", [[PM_T, "    const later = (v) => new Promise((res) => w.sb.setTimeout(() => res(v), 40));", "    const later = (v) => Promise.resolve(v);"]],
    PM, "C PROBE — THE READ TAKES TIME HERE", "RED"],   // the instrument: reads instant, "at once" means nothing
  // ── B (the look): the room queue and History ──
  ["LK1", [[Q, "    const list = H.el(\"div\", { class: \"rq-list\" });", "    const list = H.el(\"div\", { class: \"rq-group\" });"]],
    LL, "A: THE BOX AROUND NOW PLAYING IS GONE", "RED"],   // the box back
  ["LK2", [[Q, "      list.appendChild(npRow);\n", "      refs.queueBody.appendChild(npRow);\n"]],
    LL, "A: ONE LIST", "RED"],   // now playing outside the list
  ["LK3", [[Q, "{ pos: \"\\u25B6\", sub: H.shortName(np.dj), thumbMode: \"cacheOnly\",", "{ sub: H.shortName(np.dj), thumbMode: \"cacheOnly\","]],
    LL, "A: NOW PLAYING HAS ▶ WHERE THE NUMBER GOES", "RED"],
  ["LK4", [[Q, "        npWho.style.color = H.rankColor(H._rosterLevel(np.dj));\n", ""]],
    LL, "A: THE DJ IS ON ITS SUB LINE, IN THE DJ'S COLOUR", "RED"],
  ["LK5", [[Q, "          pos: (idx + 2) + \".\",", "          pos: (idx + 1) + \".\","]],
    LL, "A: THE WAITING SONGS ARE NUMBERED ON FROM IT", "RED"],
  ["LK6", [[IX, "    .rq-list .song-row.playing { border-color: #5865F2; }\n", ""]],
    LL, "A: THE BLUE EDGE MARKS IT", "RED"],
  ["LK7", [[IX, "    .rq-list, .hist-list { display: flex; flex-direction: column; }", "    .rq-list, .hist-list { display: flex; flex-direction: column; gap: 6px; }"]],
    LL, "A: THE ROWS ARE TOGETHER", "RED"],
  ["LK8", [[IX, ".rq-np-head { display: flex; align-items: center; gap: 6px; margin-bottom: 0; min-height: 30px; }", ".rq-np-head { display: flex; align-items: center; gap: 6px; margin-bottom: 0; }"]],
    LL, "A: THE LINE KEEPS THE LOCK'S HEIGHT WITHOUT IT", "RED"],
  ["LK9", [[IX, "    .rq-list .song-row.playing { border-color: #5865F2; }\n", "    .rq-list .song-row.playing { border-color: #5865F2; }\n    .rq-list .rq-np-empty { min-height: 36px; }\n"]],
    LL, "A: THE EMPTY ROW IS THE PLAYING ROW'S SIZE", "RED"],
  ["LK10", [[PN, "      histList.appendChild(row);\n", "      refs.queueBody.appendChild(row);\n"]],
    LL, "B: ONE LIST", "RED"],
  ["LK11", [[IX, "    .song-row .hist-skip { color: #32ac9f; }", "    .song-row .hist-skip { color: #888; }"]],
    LL, "B: \"SKIPPED\" IS THE MODERATION COLOUR", "RED"],
  ["LK12", [[IX, "    .song-row .hist-votes { color: #4aa3ff; }", "    .song-row .hist-votes { color: #4a6a9a; }"]],
    LL, "B: THE ▲ COUNT IS THE ▲ BUTTON'S OWN COUNT COLOUR", "RED"],   // the dim ▲, not the bright (the owner's answer)
  ["LK13", [[IX, "    .song-row .hist-saves { color: #ffd24a; }", "    .song-row .hist-saves { color: #e8c14a; }"]],
    LL, "B: THE ★ COUNT IS THE ★ BUTTON'S OWN COUNT COLOUR", "RED"],
  // LK14 re-anchored at `ddjp_663` (J131's correction): the word is the row's kind's ("skipped" or "Sys Skip", `cutShortWord`), not a fixed "skipped".
  // LK14 and LK15 RE-ANCHORED ON PURPOSE at `ddjp_667` (History's row on a phone): the word is put on the line by its own
  // statement, and the ★ count is built into the counts' spot (`check-list-look` F) — so LK15's failure is the counts' own
  // words now, which it changes, where it was the line's. What each breaks is as it was.
  ["LK14", [[PN, "sub.appendChild(H.el(\"span\", { class: \"hist-skip\", text: cut })); }", "const sk = H.el(\"span\", { class: \"hist-skip\", text: cut }); sk.style.color = \"#32ac9f\"; sub.appendChild(sk); }"]],
    LL, "B: EACH COLOUR IS THE STYLESHEET'S", "RED"],
  // LK15 RE-ANCHORED ON PURPOSE at `ddjp_677`: the ★ count is built into the spot on every row from `shownCounts`; what it breaks is as it was.
  // LK15 RE-ANCHORED ON PURPOSE AGAIN at `ddjp_678` (J133): the count carries `hist-zero` on a 0 (`zero(…)`); what it breaks is as it was.
  ["LK15", [[PN, "        H.el(\"span\", { class: \"hist-saves\" + zero(shown[1]), text: \"\\u2605 \" + shown[1] }),", "        H.el(\"span\", { class: \"hist-saves\" + zero(shown[1]), text: \"\\u2605\" + shown[1] }),"]],
    LL, "B: SO ARE THE ▲ AND ★ COUNTS", "RED"],   // the words moved
  // LK16 and LK17 RE-AIMED ON PURPOSE at `ddjp_656` (J131's correction): the phone rule they took away is gone — the overflow it
  // answered was the instrument's — and the frame and columns are border-box by the page's first rule.
  ["LK16", [[IX, "    * { box-sizing: border-box; }\n", ""]],
    LL, "C: THE PHONE FRAME IS SIZED BORDER-BOX", "RED"],   // the page's first rule gone: nothing sizes the frame border-box
  ["LK17", [[IX, "padding: 8px; gap: 0; }", "padding: 8px; gap: 0; box-sizing: border-box; }"]],
    LL, "C: BY THE PAGE'S FIRST RULE, AS EVERY BOX", "RED"],   // the phone rule for an overflow no browser had, back
  ["LK18", [[Q, "    refs.queueBody.appendChild(npHead);\n    const list", "    const list"], [Q, "    refs.queueBody.appendChild(list);\n  }\n", "    refs.queueBody.appendChild(list);\n    refs.queueBody.appendChild(npHead);\n  }\n"]],
    OS, "C: THE HEAD ROW IS GONE (the owner, ddjp_635) — the \"Now Playing\" line comes first", "RED"],   // the line under the list
  // ── J131's correction (`ddjp_656`): every song row one height, read as a browser reads the page ──
  // RS1 and RS2 RE-ANCHORED at `ddjp_678` (J133): the song row has no background of its own now (the chat box's rule gives it).
  ["RS1", [[IX, "gap: 10px; min-height: 48px; border: 1px solid #2a2a2a;", "gap: 10px; min-height: 44px; border: 1px solid #2a2a2a;"]],
    LL, "A: AND DRAWN AT ITS HEIGHT", "RED"],   // 655's sheet: the room queue's and History's rows 44, My queue's 58
  ["RS2", [[IX, "gap: 10px; min-height: 48px; border: 1px solid #2a2a2a;", "gap: 10px; min-height: 44px; border: 1px solid #2a2a2a;"]],
    QR_, "G: AND DRAWS IT AT THE HEIGHT THE SHEET DRAWS EVERY SONG ROW", "RED"],   // the same, seen from the stack
  ["RS3", [[IX, "    .rq-list, .hist-list { display: flex; flex-direction: column; }", "    .rq-list, .hist-list { display: flex; flex-direction: column; }\n    .hist-list .song-row { min-height: 50px; }"]],
    LL, "B: AND DRAWN AT ITS HEIGHT", "RED"],   // History alone at another height
  ["RS4", [[PL, "  const SONG_ROW_H = 48;", "  const SONG_ROW_H = 58;"]],
    LL, "A: AND DRAWN AT ITS HEIGHT", "RED"],   // the long lists back at J130's 58, a height of their own
  ["RS5", [[PC, "    if (s.startsWith(\"<!--\", lt)) {\n      const end = s.indexOf(\"-->\", lt + 4);\n      if (end < 0) break;\n      i = end + 3;\n      continue;\n    }\n", ""]],
    LL, "P PROBE \u2014 THE PAGE'S FIRST RULE IS READ", "RED"],   // the reader that skips no comment: it reads the head's `<style>` mention as the tag, and loses the first rule (re-anchored on the walking reader)
  ["RS6", [[PC, "  const s = String(html), low = s.toLowerCase(), out = [];", "  const s = String(html).replace(/<!--[\\s\\S]*?-->/g, \"\"), low = s.toLowerCase(), out = [];"]],
    LL, "P PROBE \u2014 A `<!--` INSIDE A STYLE RULE DROPS NO RULE", "RED"],   // the first fix back: every `<!--…-->` stripped across the page, inside a style rule too
  ["RS7", [[PC, "const RAW = { style: 1, script: 1, title: 1, textarea: 1 };", "const RAW = { style: 1, title: 1, textarea: 1 };"]],
    LL, "P PROBE \u2014 A `<style>` WRITTEN INSIDE A SCRIPT IS NOT A STYLE BLOCK", "RED"],   // a script's text read as markup
  ["RS8", [[MR, "    const css = styleBlocks(fs.readFileSync(path.join(ROOT, \"index.html\"), \"utf8\")).join(\"\\n\");   // the <style> text (top)\n    const rule = (sel) =>", "    const css = fs.readFileSync(path.join(ROOT, \"index.html\"), \"utf8\");\n    const rule = (sel) =>"]],
    LL, "R1: NO READER CUTS THE STYLESHEET OUT OF index.html ON ITS OWN", "RED"],   // `check-message-row` F back on the raw page (its rule splitter, line 141)
  ["RS9", [[MR, "    const css = styleBlocks(fs.readFileSync(path.join(ROOT, \"index.html\"), \"utf8\")).join(\"\\n\").replace(/\\/\\*[\\s\\S]*?\\*\\//g, \"\");   // (top)", "    const css = fs.readFileSync(path.join(ROOT, \"index.html\"), \"utf8\").replace(/\\/\\*[\\s\\S]*?\\*\\//g, \"\");   // (top)"]],
    LL, "R1: NO READER CUTS THE STYLESHEET OUT OF index.html ON ITS OWN", "RED"],   // `check-message-row` M back on the raw page
  ["RS10", [[RF, "  const css = strip(styleBlocks(read(\"index.html\")).join(\"\\n\"));   // the page's <style> text (top)", "  const css = strip(read(\"index.html\").replace(/<script[\\s\\S]*?<\\/script>/g, \"\"));"]],
    LL, "R1: NO READER CUTS THE STYLESHEET OUT OF index.html ON ITS OWN", "RED"],   // `check-rank-faces` E back on the raw page, scripts cut out
  ["RS11", [[DF, "// tools/docs-for.js \u2014 WHICH DOCUMENTATION DESCRIBES THE THING YOU JUST CHANGED.\n", "// tools/docs-for.js \u2014 WHICH DOCUMENTATION DESCRIBES THE THING YOU JUST CHANGED.\nconst _plant = require(\"fs\").readFileSync(\"index.html\", \"utf8\").replace(/([^{}]+)\\{([^{}]*)\\}/g, \"\");\n"]],
    LL, "R1: NO READER CUTS THE STYLESHEET OUT OF index.html ON ITS OWN", "RED"],   // a new rule splitter on the raw page, in tools/
  ["RS12", [[J130P, "// tools/probes/mutate-j130-lists.js\n", "// tools/probes/mutate-j130-lists.js\nconst _plant = (h) => h.match(/<style[^>]*>([\\s\\S]*?)<\\/style>/);\n"]],
    LL, "R1: NO READER CUTS THE STYLESHEET OUT OF index.html ON ITS OWN", "RED"],   // a new `<style>` cut, in tools/probes/
  // ── C: moderation in colour (teal since `ddjp_658`) ──
  ["FM1", [[RM, "\"ddjp.dj.skip\":       { verb: \"skipped a song\",             group: \"playback\", shownByDefault: true,  moderation: true  },", "\"ddjp.dj.skip\":       { verb: \"skipped a song\",             group: \"playback\", shownByDefault: true,  moderation: false },"]],
    FM, "A: THE KINDS MARKED ARE THE OWNER'S SIX", "RED"],   // a skip grey
  ["FM2", [[RM, "\"ddjp.media.skip\":    { verb: \"skipped an unplayable song\", group: \"playback\", shownByDefault: true,  moderation: false },", "\"ddjp.media.skip\":    { verb: \"skipped an unplayable song\", group: \"playback\", shownByDefault: true,  moderation: true  },"]],
    FM, "A: THE KINDS MARKED ARE THE OWNER'S SIX", "RED"],   // an unplayable song's skip blue
  ["FM3", [[RM, "group: \"settings\", shownByDefault: false, moderation: false },\n  };", "group: \"settings\", shownByDefault: false },\n  };"]],
    FM, "A: EVERY KIND STATES WHETHER IT IS MODERATION", "RED"],   // a kind undecided
  ["FM4", [[RM, "\"ddjp.dj.skip\":       { verb: \"skipped a song\",             group: \"playback\",", "\"ddjp.dj.skip\":       { verb: \"skipped a song\",             group: \"moderation\","]],
    FM, "A: `group` IS LEFT AS IT WAS", "RED"],   // the regroup instead of the flag
  ["FM5", [[RM, "verb: k.verb, group: k.group, moderation: !!k.moderation,", "verb: k.verb, group: k.group,"]],
    FM, "B: EVERY ROW THE FOLD NARRATES CARRIES ITS KIND'S `moderation`", "RED"],
  ["FM6", [[RM, "group: rk ? rk.group : null,\n                      moderation: !!(rk && rk.moderation), sender", "group: rk ? rk.group : null,\n                      sender"]],
    FM, "B: AN ACT THE ROOM REFUSED CARRIES IT TOO", "RED"],
  ["FM7", [[RM, "group: rk ? rk.group : null, moderation: !!(rk && rk.moderation), sender: e.sender || null, ts: ts, l: l, refused: true,", "group: rk ? rk.group : null, sender: e.sender || null, ts: ts, l: l, refused: true,"]],
    FM, "B: AND A BOT ROOM'S \"NO\" CARRIES THE NAMED ACT'S", "RED"],
  ["FM8", [[CH, "{ class: \"chat-feed\" + (row && row.moderation ? \" chat-feed-mod\" : \"\") }", "{ class: \"chat-feed\" }"]],
    FM, "C: IN CHAT, EACH KIND'S ROW CARRIES THE MODERATION CLASS", "RED"],
  ["FM9", [[IX, "    .chat-feed.chat-feed-mod .chat-feed-verb { color: #32ac9f; }\n", ""]],
    FM, "C: THE STYLESHEET COLOURS A MODERATION ROW'S NAME AND WORDS APART", "RED"],
  ["FM10", [[CH, "    n.dataset.fid = row.eventId;\n    return n;\n  }\n\n  // ── THE MENTION CHIME", "    if (row && row.moderation) whoEl.style.color = \"#38b3a5\";\n    n.dataset.fid = row.eventId;\n    return n;\n  }\n\n  // ── THE MENTION CHIME"]],
    FM, "E: THE MODERATION COLOUR IS NEVER AN INLINE COLOUR", "RED"],
  ["FM11", [[IX, "    .chat-feed.chat-feed-mod .sender { color: #38b3a5; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #32ac9f; }", "    .chat-feed.chat-feed-mod .sender { color: #14b8a6; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #14b8a6; }"]],
    FM, "E: THE OWNER'S SHADE", "RED"],   // the teal itself: not tamer
  ["FM12", [[IX, "    .chat-feed.chat-feed-mod .sender { color: #38b3a5; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #32ac9f; }", "    .chat-feed.chat-feed-mod .sender { color: #7fa8a4; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #6c9691; }"]],
    FM, "E: THE OWNER'S SHADE", "RED"],   // a quarter of the way: the shade the owner asked to brighten
  // ── `ddjp_658`: teal, a hue no name takes ──
  ["TL1", [[IX, "    .chat-feed.chat-feed-mod .sender { color: #38b3a5; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #32ac9f; }", "    .chat-feed.chat-feed-mod .sender { color: #558ae1; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #4f84db; }"]],
    FM, "E: A COLOUR NO NAME TAKES", "RED"],   // the blue back: Staff's own hue, 0° apart
  ["TL2", [[IX, "    .chat-feed.chat-feed-mod .sender { color: #38b3a5; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #32ac9f; }", "    .chat-feed.chat-feed-mod .sender { color: #8654da; }\n    .chat-feed.chat-feed-mod .chat-feed-verb { color: #804ed4; }"]],
    FM, "E: A COLOUR NO NAME TAKES", "RED"],   // purple, at the owner's strength: High Staff's own hue
  ["TL3", [[BS, "    \"player\":        { color: \"#4ADE80\" },", "    \"player\":        { color: \"#2DD4BF\" },"]],
    FM, "E: A COLOUR NO NAME TAKES", "RED"],   // a rank turned teal: the guard reads the ladder's faces, not a list
  ["TL4", [[BS, "  const _OWNER_COLOR   = \"#E8890C\";", "  const _OWNER_COLOR   = \"#14B8A6\";"]],
    FM, "E: A COLOUR NO NAME TAKES", "RED"],   // the owner, above the ladder, read too
  ["TL5", [[IX, "    .song-row .hist-skip { color: #32ac9f; }", "    .song-row .hist-skip { color: #4f84db; }"]],
    LL, "B: \"SKIPPED\" IS THE MODERATION COLOUR", "RED"],   // History's "skipped" left blue while chat turned teal
  // ── J131's classes in the sheet ──
  ["CS1", [[IX, "    .song-row .hist-skip { color: #32ac9f; }", "    .song-row .hist-skip { font-weight: 600; }"]],
    CS, "J131: EVERY CLASS THE JOB ADDS IS USED IN ui/ AND DECLARED", "RED"],   // declared, but its colour gone (the sweep is satisfied)
  ["CS2", [[CH, "(row && row.moderation ? \" chat-feed-mod\" : \"\")", "(row && row.moderation ? \" chat-feed-moderation\" : \"\")"]],
    CS, "J131: EVERY CLASS THE JOB ADDS IS USED IN ui/ AND DECLARED", "RED"],   // a computed class the sweep trusts, renamed
  // ── `ddjp_670` (three parts of the job the owner chose): six typing boxes in the chat's tint (TI), a playlist's top row
  // (PT), an empty playlist says nothing (PE) — `check-list-look` T, G and E ──
  ["TI1", [[IX, SHARED + "\n" + FRAME + "\n", ""]],
    LL, "T: THE SIX TYPING BOXES TAKE THE CHAT'S TINT", "RED"],                                               // the shared rule gone: no tint anywhere
  ["TI2", [[IX, SHARED, SHARED.replace(", .chat-tint, .prefs-body", ", .prefs-body")], [IX, FRAME, FRAME.replace(", .chat-tint {", " {")]],
    LL, "T: THE SIX TYPING BOXES TAKE THE CHAT'S TINT", "RED"],                                               // the three `chat-tint` boxes left grey
  ["TI3", [[IX, SHARED, SHARED.replace(" .dm-search,", "")], [IX, FRAME, FRAME.replace(" .dm-search,", "")]],
    LL, "T: THE SIX TYPING BOXES TAKE THE CHAT'S TINT", "RED"],                                               // the DM search left out (W3)
  ["TI4", [[IX, SHARED, SHARED.replace(".chat-messages, ", "")], [IX, FRAME, FRAME.replace(".chat-messages, ", "") + "\n    .chat-messages { background: rgba(12,12,16,0.45); border: 1px solid rgba(255,255,255,0.06); }"]],
    LL, "T: FROM ONE SHARED RULE", "RED"],                                                                   // the same look, two copies
  ["TI5", [[IX, SHARED, SHARED.replace(".chat-tint, .prefs-body", ".chat-tint, .uq-input, .prefs-body")], [IX, FRAME, FRAME.replace(".chat-tint {", ".chat-tint, .uq-input {")]],
    LL, "T: AND NOT THESE", "RED"],                                                                          // the room settings' boxes tinted (W2)
  ["TI6", [[PL, `    const newInput = H.el("input", { class: "uq-input", placeholder: "New playlist…" });`, `    const newInput = H.el("input", { class: "uq-input chat-tint", placeholder: "New playlist…" });`]],
    LL, "T: AND NOT THESE", "RED"],                                                                          // the picker's box, on its opaque card, tinted
  ["TI7", [[Q, `class: "uq-input chat-tint", placeholder: "Paste a song link…"`, `class: "uq-input", placeholder: "Paste a song link…"`]],
    LL, "T: THE SIX TYPING BOXES TAKE THE CHAT'S TINT", "RED"],                                               // My queue's box left grey
  ["TI8", [[IX, FRAME, FRAME + "\n    .chat-input { background: #333; border: 1px solid #555; }"]],
    LL, "T: THE SIX TYPING BOXES TAKE THE CHAT'S TINT", "RED"],                                               // a later grey for the send box beats it
  ["PT1", [[PL, `class: "mini pl-back", text: "\\u2190"`, `class: "mini pl-back", text: "← Back"`]],
    LL, "G: and it reads only the arrow", "RED"],                                                            // the old words back
  // PT2 AND PT3 RE-ANCHORED AT ddjp_672 (the owner, C4: "make sure the back button in the specific playlist is square not
  // rectagle"): ← is a 30 × 30 square, no longer the lock's 34 × 30; each row breaks it there.
  ["PT2", [[IX, "    .pl-detail-head .mini.pl-back { width: 30px; min-width: 30px; padding: 0; }\n", ""]],
    LL, "G: ← IS A TRUE SQUARE, 30 × 30", "RED"],                                                            // ← back to a mini button's own size
  ["PT3", [[IX, "    .pl-detail-head .mini.pl-back { width: 30px; min-width: 30px;", "    .pl-detail-head .mini.pl-back { width: 34px; min-width: 34px;"]],
    LL, "G: ← IS A TRUE SQUARE, 30 × 30", "RED"],                                                            // the lock's rectangle again (670, 671)
  ["PT4", [[PL, `class: "mini pl-all", text: "+All",`, `class: "mini pl-all", text: "＋ All to Q",`]],
    LL, "G: ONE ROW, IN THE OWNER'S ORDER", "RED"],                                                          // "＋ All to Q" back
  ["PT5", [[PL, `      placeholder: (listed ? listed.name : "") + " - paste a song link..." });`, `      placeholder: "Paste a song link…" });`]],
    LL, "G: THE BOX'S HINT IS THE PLAYLIST'S NAME", "RED"],                                                 // 669's hint, no name
  // PT6, PT7 AND PT9 RE-ANCHORED AT ddjp_671 (the owner, L1–L3), AND AGAIN AT ddjp_672 (C1: the ＋ its own square after the box):
  // each row breaks the same thing in the row as it is now — the ＋ before the box, a ＋ that does nothing, the box's rule gone.
  ["PT6", [[PL, `    const header = H.el("div", { class: "pl-detail-head" }, [back, linkInput,\n      H.el("button", { class: "pl-link-add", text: "+", title: "Add to this playlist", "aria-label": "Add to this playlist", onclick: addByLink }),`,
             `    const header = H.el("div", { class: "pl-detail-head" }, [back,\n      H.el("button", { class: "pl-link-add", text: "+", title: "Add to this playlist", "aria-label": "Add to this playlist", onclick: addByLink }), linkInput,`]],
    LL, "G: ONE ROW, IN THE OWNER'S ORDER", "RED"],                                                          // the ＋ before the box
  ["PT7", [[PL, `"aria-label": "Add to this playlist", onclick: addByLink }),`, `"aria-label": "Add to this playlist" }),`]],
    LL, "G: THE ＋ ADDS THE LINK TO THIS PLAYLIST", "RED"],                                                  // the ＋ does nothing
  ["PT8", [[PL, `    linkInput.onkeydown = (e) => { if (e.key === "Enter") addByLink(); };\n`, ""]],
    LL, "G: and Enter in the box adds too", "RED"],                                                          // Enter does nothing
  ["PT9", [[IX, "    .pl-detail-head .pl-link { flex: 1; min-width: 0; text-overflow: ellipsis; }\n", ""]],
    LL, "G: the box takes what the row leaves", "RED"],                                                      // the box at its own width, its hint not cut
  ["PT10", [[PL, `    refs.queueBody.appendChild(header);\n`, `    refs.queueBody.appendChild(header);\n    refs.queueBody.appendChild(H.el("div", { class: "uq-add" }));\n`]],
    LL, "G: THE OLD SECOND ROW IS GONE", "RED"],                                                             // a second row back under it
  // PT11–PT22 (`ddjp_671`): the ＋ (the owner, L1: "also we can turn add blue button inside a playlist for a + sign only in a
  // square"; L3: "lets go with 3 and keep the confirmation button appearing to confirm add all"). AT ddjp_672 (C1: "i dont like to
  // have the + inside the bar, i tought it would be its own square  next to it") the ＋ is its own square after the box: PT11–PT13,
  // PT17–PT19 and PT21 break the same thing there, re-anchored; the rows that broke its place INSIDE the box are retired below.
  ["PT11", [[PL, `text: "+", title: "Add to this playlist", "aria-label": "Add to this playlist", onclick: addByLink }),`, `text: "Add", onclick: addByLink }),`]],
    LL, "G: ONE ROW, IN THE OWNER'S ORDER", "RED"],                                                          // 670's row: Add a word button after the box
  ["PT12", [[PL, `class: "pl-link-add", text: "+", title:`, `class: "pl-link-add", text: "Add", title:`]],
    LL, "G: THE ＋ IS ITS OWN SQUARE RIGHT AFTER THE BOX", "RED"],                                           // the word back in the square
  ["PT13", [[PL, `text: "+", title: "Add to this playlist", "aria-label": "Add to this playlist", onclick`, `text: "+", onclick`]],
    LL, "G: its title and its aria-label", "RED"],                                                           // a "+" with no name
  // ── PT14 retired at ddjp_672: it moved the ＋ past the box's right edge, from inside its frame; the ＋ is not inside the box now (C1).
  // ── PT15 retired at ddjp_672: it took the ＋ out of the box's frame, which is where it is now (C1); PT23 breaks the opposite.
  // ── PT16 retired at ddjp_672: it took away the box's right padding kept for a ＋ inside it; there is none now (C1); PT30 puts it back.
  ["PT17", [[IX, ", .invite-btn, .pl-detail-head .pl-link-add {", ", .invite-btn {"]],
    LL, "G: AND IT IS BLUE", "RED"],                                                                          // the ＋ not Add's blue
  ["PT18", [[IX, ", .invite-btn, .pl-detail-head .pl-link-add {", ", .invite-btn {"]],
    OS, "H: AND THE ＋ IS THE BLUE ACTION BUTTON CREATE IS", "RED"],                                         // the same, read beside Create
  ["PT19", [[PL, `H.el("span", { class: "uq-actions" }, [addAllOk, addAll, detailLock])]);`, `H.el("span", { class: "uq-actions" }, [detailLock, addAllOk, addAll])]);`]],
    OS, "H: +ALL STAYS WHERE IT IS", "RED"],                                                                  // +All right of the lock (L2's idea, not picked)
  // ── PT20 retired at ddjp_672: it broke the holder the box and its ＋ shared; there is no holder now (C1).
  ["PT21", [[IX, "    .pl-detail-head .pl-link-add { width: 30px; min-width: 30px;", "    .pl-detail-head .pl-link-add { width: 34px; min-width: 34px;"]],
    LL, "G: AND IT IS A TRUE SQUARE, 30 × 30", "RED"],                                                       // not a square
  // ── PT22 retired at ddjp_672: it made the ＋ as tall as the box, over the box's frame; the ＋ is the row's height outside it now.
  // PT23–PT31 (`ddjp_672`): the ＋ its own square after the box, ← and ＋ 30 × 30, each glyph centred (the owner, C1: "no dont leave
  // it, also i dont like to have the + inside the bar, i tought it would be its own square  next to it"; C4: "make sure the back
  // button in the specific playlist is square not rectagle and that the + is its one square next to the search bar not small in it").
  ["PT23", [[IX, "    .pl-detail-head .pl-link-add { width: 30px; min-width: 30px; padding: 0;", "    .pl-detail-head .pl-link-add { position: absolute; width: 30px; min-width: 30px; padding: 0;"]],
    LL, "G: AND IT IS A TRUE SQUARE, 30 × 30", "RED"],                                                       // the ＋ placed over the row again, as inside the box
  ["PT24", [[IX, "    .pl-detail-head .pl-link-add { width: 30px; min-width: 30px; padding: 0;", "    .pl-detail-head .pl-link-add { width: 30px; min-width: 30px; height: 24px; padding: 0;"]],
    LL, "G: AND IT IS A TRUE SQUARE, 30 × 30", "RED"],                                                       // 671's 24 px height: "small in it"
  ["PT25", [[IX, "    .pl-detail-head .pl-back, .pl-detail-head .pl-link-add { font-size: 0; }\n", ""]],
    LL, "G: ←'S CHARACTER STAYS ITS TEXT, AT SIZE 0", "RED"],                                                 // the font's glyphs drawn again, where the font puts them
  ["PT26", [[IX, "      mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 10'", "      mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -1 14 10'"],
             [IX, "-webkit-mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 10'", "-webkit-mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 -1 14 10'"]],
    LL, "AND ←'S GLYPH IS CENTRED IN ITS SQUARE", "RED"],                                                    // the arrow drawn 1 px low
  ["PT27", [[IX, "      mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'", "      mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-1 0 12 12'"],
             [IX, "-webkit-mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'", "-webkit-mask-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='-1 0 12 12'"]],
    LL, "AND ＋'S GLYPH IS CENTRED IN ITS SQUARE", "RED"],                                                   // the plus drawn 1 px right
  ["PT28", [[IX, "    .pl-detail-head .pl-back::before, .pl-detail-head .pl-link-add::before { content: \"\"; flex: 0 0 auto; background: currentColor;", "    .pl-detail-head .pl-back::before, .pl-detail-head .pl-link-add::before { content: \"\"; flex: 0 0 auto; background: #888;"]],
    LL, "AND ←'S GLYPH IS CENTRED IN ITS SQUARE", "RED"],                                                    // a glyph not in its button's colour
  ["PT29", [[IX, "    .pl-detail-head .pl-link-add { width: 30px; min-width: 30px; padding: 0; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; }", "    .pl-detail-head .pl-link-add { width: 30px; min-width: 30px; padding: 0; flex: 0 0 auto; display: inline-flex; align-items: center; }"]],
    LL, "G: ＋'S CHARACTER STAYS ITS TEXT, AT SIZE 0, AND THE SQUARE'S FLEX LINE CENTRES WHAT IT DRAWS", "RED"],   // the glyph's box at the square's left
  ["PT30", [[IX, "    .pl-detail-head .pl-link { flex: 1; min-width: 0; text-overflow: ellipsis; }", "    .pl-detail-head .pl-link { flex: 1; min-width: 0; text-overflow: ellipsis; padding-right: 30px; }"]],
    LL, "G: the box takes what the row leaves", "RED"],                                                      // 671's padding kept for a ＋ inside the box
  ["PT31", [[IX, "    .pl-detail-head .mini.pl-back { width: 30px; min-width: 30px;", "    .pl-detail-head .mini.pl-back { width: 34px; min-width: 34px;"]],
    OS, "H: ← AND THE ＋ ARE BOTH TRUE SQUARES", "RED"],                                                     // ← the lock's rectangle again, read beside the ＋
  ["PE1", [[PL, `      if (!rec.tracks.length) return;\n`, `      if (!rec.tracks.length) { body.appendChild(H.el("p", { class: "muted", text: "No songs yet — paste a link above, or use the ＋ on a song in History or Now Playing." })); return; }\n`]],
    LL, "E: AN EMPTY PLAYLIST SHOWS NO TEXT", "RED"],                                                        // 669's sentence back
  ["PE2", [[PL, `      if (!rec.tracks.length) return;\n`, `      if (!rec.tracks.length) { body.appendChild(H.el("p", { class: "muted", text: "Empty." })); return; }\n`]],
    LL, "E: AN EMPTY PLAYLIST SHOWS NO TEXT", "RED"],                                                        // another sentence in its place
  // ── NE: THE EMPTY PLAY ROW (`ddjp_677`, the owner's request at `ddjp_674`) ──
  ["NE1", [[Q, NE_ROW, "      list.appendChild(H.el(\"div\", { class: \"song-row rq-np-empty\", \"aria-hidden\": \"true\" }));\n"]],
    LL, "A: THE EMPTY PLAY ROW IS THE PLAYING ROW'S SHAPE", "RED"],   // 676's empty box back
  ["NE2", [[IX, "    .song-row.rq-np-empty .thumb-slot::before { content: none; }\n", ""]],
    LL, "A: ITS PICTURE IS AN EMPTY SQUARE", "RED"],   // the ♪ back in the square
  ["NE3", [[Q, "        H.el(\"span\", { class: \"thumb-slot\" }),\n", "        H.el(\"span\", { class: \"thumb-slot\", role: \"button\", tabindex: \"0\", title: \"Preview this song\" }),\n"]],
    LL, "A: ITS PICTURE IS AN EMPTY SQUARE", "RED"],   // a preview button with nothing to preview
  ["NE4", [[IX, "    .song-row.rq-np-empty .thumb-slot { cursor: default; }\n", ""]],
    LL, "A: ITS PICTURE IS AN EMPTY SQUARE", "RED"],   // the preview's pointer over an empty square
  ["NE5", [[Q, "[ChatPanels._starBtn({ empty: true }), ChatPanels._voteBtn({ empty: true })]", "[ChatPanels._starBtn(), ChatPanels._voteBtn()]"]],
    LL, "A: WITH NO NUMBERS", "RED"],   // the playing row's builders as they are: "0" beside each glyph
  ["NE6", [[CH, "    if (!empty) b.onclick = _onStarPress;\n", "    b.onclick = _onStarPress;\n"]],
    LL, "A: A CLICK DOES NOTHING", "RED"],   // the ★'s handler wired in the empty row
  ["NE7", [[CH, "    b.disabled = !playing;\n    if (!empty) b.onclick = _onStarPress;\n", "    b.disabled = !playing && !empty;\n    if (!empty) b.onclick = _onStarPress;\n"]],
    LL, "A: GREYED AS THE SHEET GREYS A DISABLED BUTTON", "RED"],   // the empty row's ★ live-looking, not greyed
  ["NE8", [[IX, "    .rq-list .song-row.playing { border-color: #5865F2; }\n", "    .rq-list .song-row.playing { border-color: #5865F2; }\n    .rq-list .rq-np-empty { border-color: #5865F2; }\n"]],
    LL, "A: ITS EDGE STAYS GREY", "RED"],   // the blue of a song playing on a row with none
  ["NE9", [[Q, "        H.el(\"div\", { class: \"sr-main\" }),\n", "        H.el(\"div\", { class: \"sr-main\" }, [H.el(\"div\", { class: \"sr-title\", text: \"Nothing playing\" })]),\n"]],
    LL, "A: NO TITLE AND NO DJ LINE", "RED"],   // the owner's option 2, words in the row — he chose option 1
  ["NE10", [[Q, "        H.el(\"span\", { class: \"sr-pos\", text: \"\\u25B6\" }),\n", "        H.el(\"span\", { class: \"sr-pos\", text: \"\" }),\n"]],
    LL, "A: ▶ WHERE THE NUMBER GOES", "RED"],   // no ▶
  ["NE11", [[IX, "    .song-row.rq-np-empty .thumb-slot { cursor: default; }\n", "    .song-row.rq-np-empty .thumb-slot { cursor: default; }\n    .song-row.rq-np-empty .sr-pos { color: #ddd; }\n"]],
    LL, "A: ▶ WHERE THE NUMBER GOES, IN THE NUMBER'S GREY", "RED"],   // ▶ in another colour than the numbers' grey (a rule that wins: `.rq-np-empty .sr-pos` alone loses to `.song-row .sr-pos`, later in the sheet — inert, measured)
  ["NE12", [[CH, "  function _starBtn(opts) {\n    const empty = !!(opts && opts.empty);\n", "  function _starBtn(opts) {\n    const empty = !opts || !!opts.empty;\n"]],
    LL, "A: THE PLAYING ROW'S ★ AND ▲ ARE AS THEY WERE", "RED"],   // the reused builder leaking: the playing row's ★ drawn empty
  ["NE13", [[CH, "    _applyCount(refs.grabCount, \"save\");\n", ""]],
    LL, "A: AND THE PLAYER'S OWN ★ AND ▲ ARE AS THEY WERE", "RED"],   // the Player's ★ count no longer kept in step
  ["NE14", [[Q, "        H.el(\"span\", { class: \"uq-actions\" }, [ChatPanels._starBtn({ empty: true }), ChatPanels._voteBtn({ empty: true })]),\n", ""]],
    OS, "FAIL — C: THE SONG'S SPACE IS THERE, AN EMPTY PLAY ROW", "RED"],   // no ★ or ▲ in their places
  ["NE15", [[IX, "    .song-row.rq-np-empty .thumb-slot { cursor: default; }\n    .song-row.rq-np-empty .thumb-slot::before { content: none; }\n", ""]],
    CS, "J131: EVERY CLASS THE JOB ADDS IS USED IN ui/ AND DECLARED IN THE SHEET", "RED"],   // the empty row's class declared nowhere
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
      const h = J.open("mutate-j131-moves-look:" + id, file);   // journalled BEFORE the write
      handles.push(h);
      fs.writeFileSync(file, f.mutated);
    }
    landed = [...files].every(([file, f]) => fs.readFileSync(file, "utf8") === f.mutated);
    if (landed) {
      const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 400000 });
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
