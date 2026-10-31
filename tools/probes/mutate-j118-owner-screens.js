// tools/probes/mutate-j118-owner-screens.js
// SUBJECT: J118 (`ddjp_636`) — the owner's screen decisions at `ddjp_635`. 1, DMs: the app's own lock and Clear list side
// by side on the "Direct messages" line, one style and one height; behind the lock, Clear list and a ✕ per conversation
// that forgets it on this device (`Chat.forgetConversation`, `ChatPrefs.dmForget`); no empty text; the lock non-timed and
// re-locked on leaving the panel (`ui/shell.js` `_dmLocked`). 2, Feed: no "What has happened since you opened this room".
// 3, Room queue: no head row; Reset and the lock on the box's "Now Playing" line; the controls hidden while locked; the box
// always shown; still timed. 4, My queue: the lock hides only each ✕. 5, History: no "the whole room". 6, "Room Q" / "My Q" by the layout selector. 7, the logs bar's second line.
// 8, Import / Export beside Create, Create's kind of button, grey; and the owner's addition at `ddjp_636`: an empty playlist
// library says nothing. And at `ddjp_637`, the logs bar's three buttons one height. And the owner's decisions at `ddjp_637`,
// built at `ddjp_638`: an empty feed says nothing; the box says "Nothing"; My queue's "✕ Clear" on the add line, left of Add,
// it and its ✔ the line's height, no count line, no list head, no "Your queue is empty". And the owner's decisions at
// `ddjp_638`, built at `ddjp_639`: inside a playlist, Back the kind and height of "＋ All to my queue" and the lock; the room
// queue box with nothing playing the playing box's shape — "Nothing playing" in the tag's place, the song's space empty.
// Held by `check-owner-screens`, `check-chat-view` L2 (changed on purpose for decision 1) and `check-feed-tab` D (changed on
// purpose for the empty feed, `ddjp_637`). FH1 and MQ4–MQ6 re-anchored on purpose at `ddjp_638`: their lines moved.
// One row per site, each naming the failure it must cause in its guard, and a control per guard. Each row plants its edit(s),
// confirms every one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything
// is restored after every row, and checked restored. Run it in a fresh copy of the tree.
//   node tools/probes/mutate-j118-owner-screens.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const CH = "ui/chat.js", SH = "ui/shell.js", QU = "ui/queue.js", PA = "ui/panels.js", PL = "ui/playlists.js";
const FC = "features/chat.js", CP = "core/chatprefs.js", IX = "index.html";
const OS = "check-owner-screens", CV = "check-chat-view";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── DX: THE DM LINE (decision 1) ──
  // DX1 — no lock on the line.
  ["DX1", [[CH, `head.appendChild(H.el("span", { class: "dm-head-actions" }, [clearBtn, lock]));`, `head.appendChild(H.el("span", { class: "dm-head-actions" }, [clearBtn]));`]],
    OS, `FAIL — A: THE "DIRECT MESSAGES" LINE CARRIES THE APP'S OWN LOCK`, "RED"],
  // DX2 — Clear list a `mini` again, 22 px beside a 30 px lock.
  ["DX2", [[CH, `class: "dm-clear", text: "Clear list",`, `class: "mini", text: "Clear list",`]], OS, "FAIL — A: THE SAME HEIGHT AS THE LOCK", "RED"],
  // DX3 — the lock's style not shared: Clear list keeps its height but loses the lock's look.
  ["DX3", [[IX, "    .panel-lock-btn, .dm-clear { background: #2e2e35;", "    .dm-clear { height: 30px; }\n    .panel-lock-btn { background: #2e2e35;"]], OS, "FAIL — A: THE SAME STYLE", "RED"],
  // DX4 — Clear list usable while locked.
  ["DX4", [[CH, "      clearBtn.disabled = locked;", "      clearBtn.disabled = false;"]], OS, "FAIL — A: WHILE LOCKED, CLEAR LIST CANNOT BE USED", "RED"],
  // DX5 — its click forgets even while locked.
  ["DX5", [[CH, "onclick: () => { if (H.dmLocked()) return; try { Chat.clearConversations(); }", "onclick: () => { try { Chat.clearConversations(); }"]],
    OS, "FAIL — A: and a click that reaches it forgets nothing", "RED"],
  // DX6 — the ✕ shown while locked.
  ["DX6", [[CH, "    if (!H.dmLocked() && r.roomIds && r.roomIds.length) {", "    if (r.roomIds && r.roomIds.length) {"]], OS, "FAIL — A: WHILE LOCKED, NO CONVERSATION CARRIES A ✕", "RED"],
  // DX7 — the ✕ forgets only the newest room of that person.
  ["DX7", [[CH, "Chat.forgetConversation(r.roomIds);", "Chat.forgetConversation([r.roomId]);"]], OS, "FAIL — A: THE ✕ FORGETS THAT ONE CONVERSATION", "RED"],
  // DX8 — the ✕'s click reaches the row and opens the conversation.
  ["DX8", [[CH, "forget.onclick = (e) => { stop(e); if (H.dmLocked()) return;", "forget.onclick = (e) => { if (H.dmLocked()) return;"]],
    OS, "FAIL — A: and does not open the conversation it sits on", "RED"],
  // DX9 — leaving the panel leaves it unlocked.
  ["DX9", [[SH, "    _prefsLocked = true;\n    _dmLocked = true;\n", "    _prefsLocked = true;\n"]], OS, "FAIL — A: LEAVING THE PANEL LOCKS IT AGAIN", "RED"],
  // DX10 — the lock made timed, like the room queue's.
  ["DX10", [[CH, "() => { H.setDmLocked(!H.dmLocked()); renderDMPanel(); });", "() => { H.setDmLocked(!H.dmLocked()); setTimeout(() => { H.setDmLocked(true); renderDMPanel(); }, 5000); renderDMPanel(); });"]],
    OS, "FAIL — A: THE DM LOCK STAYS OPEN UNTIL CLICKED", "RED"],
  // DX11 — the empty text back (both guards that hold it).
  ["DX11", [[CH, "      if (q && !isId) {", `      if (!q && !(rows || []).length) list.appendChild(H.el("p", { class: "muted", text: "No conversations yet. Type someone's full Matrix ID above to start one." }));\n      if (q && !isId) {`]],
    OS, "FAIL — A: THE EMPTY LIST SAYS NOTHING", "RED"],
  ["DX12", [[CH, "      if (q && !isId) {", `      if (!q && !(rows || []).length) list.appendChild(H.el("p", { class: "muted", text: "No conversations yet. Type someone's full Matrix ID above to start one." }));\n      if (q && !isId) {`]],
    CV, "FAIL — L2: and the empty list says nothing", "RED"],
  // DX13 — a request with no conversation carries a ✕ too.
  ["DX13", [[CH, "    if (!H.dmLocked() && r.roomIds && r.roomIds.length) {", "    if (!H.dmLocked()) {"]], OS, "FAIL — A: a request with no conversation yet carries no ✕", "RED"],
  // DX14 — forgetting one drops every conversation.
  ["DX14", [[CP, "    s.dms = s.dms.filter((r) => !drop.has(String(r.roomId)));", "    s.dms = [];"]], OS, "FAIL — A (feature): FORGETTING ZOE DROPS BOTH HER ROOMS AND NOTHING ELSE", "RED"],
  // DX15 — forgetting reaches the transport.
  ["DX15", [[FC, "function forgetConversation(roomIds) { try { ChatPrefs.dmForget(roomIds); } catch (e) {} _dmChanged(); }",
    `function forgetConversation(roomIds) { try { ChatPrefs.dmForget(roomIds); } catch (e) {} try { MatrixBridge.sendMessage(roomIds[0], "left"); } catch (e) {} _dmChanged(); }`]],
    OS, "FAIL — A (feature): ONLY ON THIS DEVICE", "RED"],
  // DX16 — forgetting is not saved.
  ["DX16", [[CP, "    s.dms = s.dms.filter((r) => !drop.has(String(r.roomId)));\n    _saveIfMoved();", "    s.dms = s.dms.filter((r) => !drop.has(String(r.roomId)));"]],
    OS, "FAIL — A (feature): AND IT IS SAVED", "RED"],
  // ── FH: THE FEED HEAD (decision 2) ──
  ["FH1", [[PA, "    const parts = [];", `    const parts = rows.length ? ["What has happened since you opened this room"] : [];`]],
    OS, `FAIL — B: THE HEAD NO LONGER SAYS "WHAT HAS HAPPENED SINCE YOU OPENED THIS ROOM"`, "RED"],
  // FH4, FH5 — the empty feed's sentence back (the owner, `ddjp_637`), in both guards that hold it.
  ["FH4", [[PA, "    const parts = [];", `    const parts = rows.length ? [] : ["Nothing has happened since you opened this room"];`]],
    OS, "FAIL — B: AN EMPTY FEED SAYS NOTHING", "RED"],
  ["FH5", [[PA, "    const parts = [];", `    const parts = rows.length ? [] : ["Nothing has happened since you opened this room"];`]],
    "check-feed-tab", "FAIL — D: an empty go-forward feed says nothing", "RED"],
  ["FH2", [[IX, "    .feed-head:empty { display: none; }", "    .feed-head:empty { }"]], OS, `FAIL — B: THE HEAD NO LONGER SAYS "WHAT HAS HAPPENED SINCE YOU OPENED THIS ROOM"`, "RED"],
  ["FH3", [[PA, `    _setFeedHead(head ? head.charAt(0).toUpperCase() + head.slice(1) + "." : "");`, `    _setFeedHead(head ? head + "." : "");`]],
    OS, "FAIL — B: WHAT IS LEFT OUT IS STILL SAID", "RED"],
  // ── QR: THE ROOM QUEUE (decision 3) ──
  ["QR1", [[QU, `    const group = H.el("div", { class: "rq-group" + (playing ? " playing" : "") }, [npHead]);`,
    `    const headRow = H.el("div", { class: "rq-head-row" });\n    if (refs.roomqLockBtn) headRow.appendChild(refs.roomqLockBtn);\n    refs.queueBody.appendChild(headRow);\n    const group = H.el("div", { class: "rq-group" + (playing ? " playing" : "") }, [npHead]);`]],
    OS, "FAIL — C: THE HEAD ROW ABOVE THE BOX IS GONE", "RED"],
  ["QR2", [[IX, "    .rq-np-head .panel-lock-btn { margin-left: auto; }", "    .rq-np-head .panel-lock-btn { }"]], OS, "FAIL — C: THE LOCK IS AT THE FAR RIGHT", "RED"],
  ["QR3", [[QU, `      npHead.appendChild(H.el("span", { class: "rq-np-tag", text: "Now Playing" }));`,
    `      npHead.insertBefore(H.el("span", { class: "rq-np-tag", text: "Now Playing" }), npHead.firstChild);`]],
    OS, "FAIL — C: RESET ROTATION IS ON THAT LINE, LEFT OF", "RED"],
  ["QR4", [[IX, "    .roomq-locked .rq-ctl, .roomq-locked .rq-reset { display: none; }", "    .roomq-locked .rq-ctl, .roomq-locked .rq-reset { opacity: 0.4; pointer-events: none; }"]],
    OS, "FAIL — C: LOCKED, THE MODERATION CONTROLS ARE HIDDEN, NOT GREYED", "RED"],
  ["QR5", [[QU, `const sep = () => H.el("span", { class: "q-sep rq-ctl", "aria-hidden": "true" });`, `const sep = () => H.el("span", { class: "q-sep", "aria-hidden": "true" });`]],
    OS, "FAIL — C: LOCKED, THE MODERATION CONTROLS ARE HIDDEN, NOT GREYED", "RED"],
  ["QR6", [[IX, "    .rq-np-head .rq-reset { align-self: center; margin: 0; height: 30px;", "    .rq-np-head .rq-reset { align-self: center; margin: 0; height: 26px;"]],
    OS, "FAIL — C: BOTH KEEP THEIR SIZES", "RED"],
  ["QR7", [[SH, "      _lockTimers.roomq = setTimeout(_roomqRelockAndRender, _LOCK_UNLOCK_MS);\n", ""]], OS, "FAIL — C: THE LOCK STAYS TIMED", "RED"],
  ["QR8", [[QU, "    if (rotation && rotation.length) {", `    if (!rotation || !rotation.length) refs.queueBody.appendChild(H.el("p", { class: "muted", text: "No DJs waiting" }));\n    if (rotation && rotation.length) {`]],
    OS, `FAIL — C: and "No DJs waiting" is gone`, "RED"],
  // QR9 re-targeted on purpose at `ddjp_639`: the box-always-shown row is now C's "NOTHING PLAYING" row, which asserts the box first.
  ["QR9", [[QU, "    refs.queueBody.appendChild(group);", "    if (playing) refs.queueBody.appendChild(group);"]], OS, "FAIL — C: NOTHING PLAYING", "RED"],
  ["QR10", [[QU, "    if (showRoomqControls) {\n      refs.roomqLockBtn = H._roomqLockBtn();", "    if (true) {\n      refs.roomqLockBtn = H._roomqLockBtn();"]],
    OS, "FAIL — C: A VIEWER WHO CANNOT MODERATE", "RED"],
  // QR11 re-anchored on purpose at `ddjp_639`: the owner replaced `ddjp_637`'s "Nothing" with the playing box's shape. QR11–QR15:
  // "Nothing" back; the empty song space gone, or holding ★ and ▲, or another size; the tag in another style.
  ["QR11", [[QU, `npHead.appendChild(H.el("span", { class: "rq-np-tag", text: "Nothing playing" }));`,
    `npHead.appendChild(H.el("span", { class: "rq-np-tag", text: "Nothing" }));`]], OS, "FAIL — C: NOTHING PLAYING", "RED"],
  ["QR12", [[QU, `      group.appendChild(H.el("div", { class: "song-row rq-np-empty", "aria-hidden": "true" }));\n`, ""]],
    OS, "FAIL — C: THE SONG'S SPACE IS THERE AND EMPTY", "RED"],
  ["QR13", [[QU, `group.appendChild(H.el("div", { class: "song-row rq-np-empty", "aria-hidden": "true" }));`,
    `group.appendChild(H.el("div", { class: "song-row rq-np-empty", "aria-hidden": "true" }, [ChatPanels._starBtn(), ChatPanels._voteBtn()]));`]],
    OS, "FAIL — C: THE SONG'S SPACE IS THERE AND EMPTY", "RED"],
  ["QR14", [[IX, "    .rq-group .song-row.playing { border-color: #5865F2; }", "    .rq-group .song-row.playing { border-color: #5865F2; }\n    .rq-np-empty { min-height: 36px; }"]],
    OS, "FAIL — C: THE BOX IS ONE SIZE PLAYING OR NOT", "RED"],
  ["QR15", [[QU, `npHead.appendChild(H.el("span", { class: "rq-np-tag", text: "Nothing playing" }));`,
    `npHead.appendChild(H.el("span", { class: "muted rq-np-none", text: "Nothing playing" }));`]], OS, "FAIL — C: NOTHING PLAYING", "RED"],
  // ── MQ: MY QUEUE (decision 4) ──
  ["MQ1", [[IX, "    .uq-locked .uq-remove, .uq-locked .uq-remove-sep { display: none; }", "    .uq-locked .uq-remove, .uq-locked .uq-remove-sep { opacity: 0.4; pointer-events: none; }"]],
    OS, "FAIL — D: LOCKED, EACH ROW'S ✕ IS HIDDEN", "RED"],
  ["MQ2", [[QU, `guard.classList.add("uq-remove-sep"); `, ""]], OS, "FAIL — D: LOCKED, EACH ROW'S ✕ IS HIDDEN", "RED"],
  ["MQ3", [[IX, "    .uq-locked .uq-remove, .uq-locked .uq-remove-sep { display: none; }", "    .uq-locked .uq-actions .mini, .uq-locked .uq-remove-sep { display: none; }"]],
    OS, "FAIL — D: THE OTHER ROW CONTROLS STAY USABLE WHILE LOCKED", "RED"],
  // MQ4–MQ12: "✕ Clear" on the add line (the owner, `ddjp_637`). MQ4–MQ6 re-anchored on purpose: the list head they
  // reached is gone.
  ["MQ4", [[SH, `class: "mini ico dconfirm uq-confirm"`, `class: "mini danger"`]], OS, "FAIL — D: CLEAR AND ITS ✔ ARE THE HEIGHT OF ADD AND THE LOCK", "RED"],
  ["MQ5", [[IX, "    .uq-add .mini.uq-confirm { width: 30px; min-width: 30px;", "    .uq-add .mini.uq-confirm { width: 36px; min-width: 36px;"]],
    OS, "FAIL — D: CLEAR AND ITS ✔ ARE THE HEIGHT OF ADD AND THE LOCK", "RED"],
  ["MQ6", [[QU, `[input, refs.uqClear, H.el("button", { text: "Add", onclick: addOne }), refs.uqLockBtn]`, `[input, H.el("button", { text: "Add", onclick: addOne }), refs.uqClear, refs.uqLockBtn]`]],
    OS, `FAIL — D: "✕ CLEAR" IS ON THE ADD LINE, LEFT OF ADD`, "RED"],
  ["MQ7", [[SH, "    refs.uqClear.appendChild(clearBtn);", `    refs.uqClear.appendChild(clearBtn);\n    refs.uqClear.appendChild(el("span", { class: "muted", text: n + (n === 1 ? " song" : " songs") }));`]],
    OS, "FAIL — D: NO COUNT LINE", "RED"],
  ["MQ8", [[QU, "    if (items.length) {", `    if (!items.length) refs.queueBody.appendChild(H.el("p", { class: "muted", text: "Your queue is empty" }));\n    if (items.length) {`]],
    OS, "FAIL — D: AN EMPTY QUEUE SAYS NOTHING", "RED"],
  ["MQ9", [[SH, "    if (_uqConfirmClear) {", "    if (true) {"]], OS, "FAIL — D: the ✔ shows only once Clear is clicked", "RED"],
  ["MQ10", [[SH, "_uqConfirmClear = !_uqConfirmClear; _renderUqClear();", "_uqConfirmClear = true; _renderUqClear();"]], OS, "FAIL — D: CLICKING CLEAR AGAIN CANCELS", "RED"],
  ["MQ11", [[SH, "    clearBtn.disabled = _uqLocked;", "    clearBtn.disabled = false;"]], OS, "FAIL — D: LOCKED, CLEAR IS THERE AND CANNOT BE USED", "RED"],
  // MQ12's rule goes AFTER Add's, which it ties with: placed before it (its first version) it changed nothing in any cascade.
  ["MQ12", [[IX, "    .uq-add .mini.uq-confirm { width: 30px; min-width: 30px; padding: 0; font-size: 15px; }", "    .uq-add .mini.uq-confirm { width: 30px; min-width: 30px; padding: 0; font-size: 15px; }\n    .uq-add button.uq-clear { height: 32px; }"]],
    OS, "FAIL — D: CLEAR AND ITS ✔ ARE THE HEIGHT OF ADD AND THE LOCK", "RED"],
  // ── HR: HISTORY (decision 5) ──
  ["HR1", [[PA, "      if (cov && cov.entries && !cov.complete) {", "      if (cov && cov.entries) {"]], OS, "FAIL — E: A COMPLETE HISTORY SAYS NO", "RED"],
  ["HR2", [[PA, `          cov.entries + " songs — as far back as this client can reach" }));`, `          cov.entries + " songs" }));`]], OS, "FAIL — E: A PARTIAL HISTORY STILL SAYS SO", "RED"],
  // ── TQ: THE QUEUE TABS ON A PHONE (decision 6) ──
  ["TQ1", [[SH, "      t.textContent = phone ? short : full;", "      t.textContent = full;"]], OS, "FAIL — F: AT PHONE WIDTH THE TABS READ", "RED"],
  ["TQ2", [[SH, `    const phone = layoutMode === "phone";`, `    const phone = (typeof innerWidth === "number" && innerWidth < 600);`]], OS, "FAIL — F: AT PHONE WIDTH THE TABS READ", "RED"],
  ["TQ3", [[SH, "      t.textContent = phone ? short : full;", "      if (phone) t.textContent = short;"]], OS, "FAIL — F: and back in full", "RED"],
  ["TQ4", [[SH, `    _labelQueueTabs();  // "Room Q" / "My Q" on a phone\n`, ""]], OS, "FAIL — F: AT PHONE WIDTH THE TABS READ", "RED"],
  // ── LB: THE LOGS BAR (decision 7) ──
  ["LB1", [[SH, `      el("div", { class: "logs-bar-line" }, [levelSel, refs.logsCat, refs.logsCount]),\n      el("div", { class: "logs-bar-line logs-tools" }, [`,
                 `      el("div", { class: "logs-bar-line" }, [levelSel, refs.logsCat, refs.logsCount, el("span", { class: "logs-tools" }, [`],
           [SH, `to the clipboard"),\n      ]),\n    ]);`, `to the clipboard"),\n      ])]),\n    ]);`]],
    OS, "FAIL — G: BOT STATUS, HISTORY AUDIT AND COPY LOG ARE ON THEIR OWN LINE", "RED"],
  ["LB2", [[SH, "        botStatusBtn,\n        auditBtn,", "        auditBtn,\n        botStatusBtn,"]], OS, "FAIL — G: in their order", "RED"],
  ["LB3", [[IX, "    .logs-bar { display: flex; flex-direction: column;", "    .logs-bar { display: flex;"]], OS, "FAIL — G: the sheet stacks the two lines", "RED"],
  // LB4 — History audit back on `.copy-btn`'s own padding, 6 px taller than its neighbours (`ddjp_637`).
  ["LB4", [[IX, "    .logs-copy, .logs-audit { font-size: 11px; padding: 2px 8px; }", "    .logs-copy { font-size: 11px; padding: 2px 8px; }"]],
    OS, "FAIL — G: BOT STATUS, HISTORY AUDIT AND COPY LOG ARE ONE HEIGHT", "RED"],
  // ── PI: IMPORT / EXPORT (decision 8) ──
  // PI1, PI2 re-anchored on purpose at `ddjp_640`: the owner moved Import / Export right of Create (ddjp_639). PI2 is now that
  // decision's row: Import / Export back LEFT of Create, as it was.
  ["PI1", [[PL, `      H.el("div", { class: "uq-add" }, [input, H.el("button", { text: "Create", onclick: create }), io, plLock]),`,
    `      H.el("div", { class: "uq-add" }, [input, H.el("button", { text: "Create", onclick: create }), plLock]),\n      H.el("div", { class: "pl-io-entry" }, [io]),`]],
    OS, `FAIL — H: THE IMPORT AND EXPORT BUTTON SITS ON THE CREATE LINE`, "RED"],
  ["PI2", [[PL, `[input, H.el("button", { text: "Create", onclick: create }), io, plLock]`, `[input, io, H.el("button", { text: "Create", onclick: create }), plLock]`]],
    OS, `FAIL — H: THE IMPORT AND EXPORT BUTTON SITS ON THE CREATE LINE, RIGHT OF CREATE`, "RED"],
  // PI1–PI3 RE-ANCHORED ON PURPOSE at `ddjp_646` (the owner, `ddjp_645`: the button reads "Imp / Exp"): H finds it by its class
  // now, and the label has its own row; PI3 is a label with a glyph added, which that row refuses.
  ["PI3", [[PL, `const io = H.el("button", { class: "pl-io-open", text: "Imp / Exp",`, `const io = H.el("button", { class: "pl-io-open", text: "\\u21C5 Imp / Exp",`]],
    OS, `FAIL — H: IT READS "Imp / Exp"`, "RED"],
  // PI4, PI5 re-anchored on purpose at `ddjp_638`: Clear shares Import / Export's grey rule now.
  ["PI4", [[IX, "    .uq-add button.pl-io-open, .uq-add button.uq-clear { background: #333; color: #ccc; }", "    .uq-add button.uq-clear { background: #333; color: #ccc; }"]], OS, "FAIL — H: AND IT STAYS GREY", "RED"],
  ["PI5", [[IX, "    .uq-add button.pl-io-open, .uq-add button.uq-clear { background: #333; color: #ccc; }", "    .uq-add button.pl-io-open, .uq-add button.uq-clear { background: #333; color: #ccc; height: 22px; }"]],
    OS, "FAIL — H: THE SAME SIZE AND KIND OF BUTTON", "RED"],
  // PI6 — the empty library's sentence back (the owner's addition, `ddjp_636`).
  ["PI6", [[PL, "    for (const p of _plSort(Playlists.list())) scroll.appendChild(_playlistRow(p));",
    `    if (!Playlists.list().length) scroll.appendChild(H.el("p", { class: "muted", text: "No playlists yet — create one above." }));\n    for (const p of _plSort(Playlists.list())) scroll.appendChild(_playlistRow(p));`]],
    OS, "FAIL — H: AN EMPTY LIBRARY SAYS NOTHING", "RED"],
  // PD1, PD2 — inside a playlist (the owner, `ddjp_638`): Back and ＋ All off the lock's height; Back another kind of button.
  ["PD1", [[IX, "    .pl-detail-head .mini { height: 30px; }\n", ""]], OS, "FAIL — H: BACK, ＋ ALL AND THE LOCK ARE THE LOCK'S HEIGHT", "RED"],
  ["PD2", [[PL, `const back = H.el("button", { class: "mini pl-back", text: "← Back"`, `const back = H.el("button", { class: "pl-back", text: "← Back"`]],
    OS, `FAIL — H: "← BACK" IS THE SAME KIND`, "RED"],
  // ── THE CONTROLS: an edit that changes nothing; each guard must stay green, so a red above is a reading of a live run ──
  ["N1", [[SH, "  function _labelQueueTabs() {", "  function _labelQueueTabs()  {"]], OS, "", "GREEN"],
  ["N2", [[CH, "  function _dmRowEl(r, box) {", "  function _dmRowEl(r, box)  {"]], CV, "", "GREEN"],
  ["N3", [[PA, "  function renderFeedPanel() {", "  function renderFeedPanel()  {"]], "check-feed-tab", "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, () => newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
