// tools/probes/mutate-j130-lists.js
// SUBJECT: J130 — the lists stop flickering (the owner's decisions, `ddjp_653`): `ui/queue.js` (a room event redraws a tab only
// when its record of what it drew changed; which tab hears which trigger; My queue's list redrawn under its add line; the
// windowed stack's one paint, no scroll anchoring, a replaced list's scroll ignored, each row counted as drawn; the strike
// cooldown's own redraw keeps the record), `ui/playlists.js` (the held title at once; one object URL per video, released
// with its blob; the library's scroll kept, every tab click starting it at the top; inside a playlist, the record last read
// drawn at once and the read reconciling), `ui/panels.js` (History's record), `ui/chat.js` (★/▲ as a record, your own ▲ one
// redraw), `ui/screens.js` (the four room triggers through `roomEvent`), the harness `tests/_screen-world.js` (the
// DOM-shaped tree), and `features/queue.js` (a strike's time recorded before the room queue is told, from its server stamp;
// J130's correction, `ddjp_661`), and song history's notice (J130's correction, `ddjp_662`): `backends/backend1/history.js`
// says when it wrote — after the write, once per operation, never for a reset, its listeners kept — `backends/backend1/
// matrixbridge.js` passes it to the app, `features/queue.js` once a page, `ui/screens.js` to `roomEvent`, and History hears it
// (`ui/queue.js` `_HEARS`). Held by `check-queue-redraw` A–L and `check-ui-render` (a part redraw removes what it replaces).
// One row per way it could go wrong, each naming the failure it must cause.
//
// JOURNALLED (`_journal.js`): every edit is recorded on disk before it is made and cleared only once the original bytes
// are back, so a run killed mid-row leaves a tree the next run restores rather than one it measures. APPLIED-CHECKED TWICE:
// each file must hold exactly its mutated bytes when the guard starts AND when its result is read; an edit that is not
// there at either moment VOIDs the row, because a mutation that never applied prints the same green as one that passed.
// Restored after every row and checked restored by hash.
//
//   node tools/probes/mutate-j130-lists.js            every row
//   node tools/probes/mutate-j130-lists.js QR3 QR9    named rows
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const J = require(path.join(__dirname, "_journal.js"));
const ROOT = path.join(__dirname, "..", "..");
const Q = "ui/queue.js", PL = "ui/playlists.js", PN = "ui/panels.js", CH = "ui/chat.js", SC = "ui/screens.js", SW = "tests/_screen-world.js";
const FQ = "features/queue.js", HI = "backends/backend1/history.js", MB = "backends/backend1/matrixbridge.js";
const QR = "check-queue-redraw", UR = "check-ui-render";
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── a room event redraws only what changed ──
  ["QR1", [[Q, "    if (same && rec !== null && _drawn.rec === rec) return;\n", ""]],
    QR, "A: A QUEUE EVENT THAT CHANGES NOTHING THE ROOM QUEUE SHOWS REDRAWS NOTHING", "RED"],   // no comparison: every event redraws
  ["QR2", [[SC, "QueuePanels.roomEvent(\"queue\");", "QueuePanels.renderQueuePanel();"]],
    QR, "A: A QUEUE EVENT THAT CHANGES NOTHING THE ROOM QUEUE SHOWS REDRAWS NOTHING", "RED"],   // 653's queue trigger, back
  ["QR3", [[SC, "QueuePanels.roomEvent(\"rank\");", "QueuePanels.renderQueuePanel();"]],
    QR, "A: A RANK CHANGE THAT CHANGES NOTHING THE ROOM QUEUE SHOWS REDRAWS NOTHING", "RED"],   // 653's rank trigger, back
  ["QR4", [[SC, "Reactions.onChange(() => { ChatPanels._syncNpButtons(); QueuePanels.roomEvent(\"reactions\"); });", "Reactions.onChange(() => { ChatPanels._syncNpButtons(); if (H.queueTab() === \"room\") QueuePanels.renderQueuePanel(); });"]],
    QR, "A: A REACTIONS EVENT THAT CHANGES NOTHING THE ROOM QUEUE SHOWS REDRAWS NOTHING", "RED"],   // 653's reactions trigger, back
  ["QR5", [[CH, "    QueuePanels.roomEvent(\"reactions\");   // redraws the room queue only if its ★/▲ now read differently (J130)", "    if (H.queueTab() === \"room\") QueuePanels.renderQueuePanel();"]],
    QR, "A: YOUR OWN ▲ REDRAWS THE ROOM QUEUE ONCE", "RED"],   // your own ▲ redrawn twice (the press and the echo)
  // ── the record is the screen's, both ways ──
  ["QR6", [[Q, "    const who = (u) => [u, H.shortName(u), H.rankColor(H._rosterLevel(u))];\n    const playing = !!(np && np.song);\n    const rows = [];", "    const who = (u) => [u, H.shortName(u)];\n    const playing = !!(np && np.song);\n    const rows = [];"]],
    QR, "A: A DJ'S RANK COLOUR — DRAWN, SO ONE REDRAW", "RED"],   // a colour drawn and not in the record: a promotion never shows
  ["QR7", [[Q, "rows.push([who(entry.user), vid, canManageRows ? _roomqRowRecord(_roomqRowState(entry, idx, rotation)) : null]);", "rows.push([who(entry.user), vid, null]);"]],
    QR, "A: ONE ROW'S ✕🎵 REFUSED, WITH ITS REASON — DRAWN, SO ONE REDRAW", "RED"],   // the row controls not in the record
  ["QR8", [[Q, "playing ? [who(np.dj), np.song.videoId, ChatPanels._npReactRecord()] : null", "playing ? [who(np.dj), np.song.videoId] : null"]],
    QR, "A: MY VOTE'S LATCH — DRAWN, SO ONE REDRAW", "RED"],   // ★/▲ not in the record: a vote never shows
  ["QR9", [[Q, "return [s.canMove, s.i === 0, s.i === s.last, s.strike.enabled, s.strike.reason, s.cooling ? s.coolUntil : 0, s.remove.enabled, s.remove.reason];", "return [s.canMove, s.i === 0, s.i === s.last, s.strike.enabled, s.strike.reason, 0, s.remove.enabled, s.remove.reason];"]],
    QR, "F: A STRIKE GREYS ✕🎵 AT ONCE", "RED"],   // a strike's cooldown not in the record: it shows only at the next change
  ["QR10", [[Q, "rows.push([who(entry.user), vid, canManageRows", "rows.push([who(entry.user), vid, entry.pending.map((p) => p.videoId), canManageRows"]],
    QR, "A: A DJ'S SECOND SONG (NOT SHOWN) — NOT DRAWN, SO NO REDRAW", "RED"],   // something not drawn in the record: a needless redraw
  ["QR11", [[Q, "playing ? [who(np.dj), np.song.videoId, ChatPanels._npReactRecord()] : null", "playing ? [who(np.dj), ChatPanels._npReactRecord()] : null"]],
    QR, "A: NOW PLAYING'S SONG — DRAWN, SO ONE REDRAW", "RED"],   // the song playing not in the record: a new song never shows
  // QR12 RE-ANCHORED ON PURPOSE at `ddjp_677`: the record states History's counts as shown (`shownCounts`); what it breaks is as it was.
  ["QR12", [[PN, "cutShortWord(h), shownCounts(c)];", "cutShortWord(h), null];"]],
    QR, "A: HISTORY, A PAST ROW'S VOTES — DRAWN, SO ONE REDRAW, AT ONCE", "RED"],   // History's counts not in its record
  ["QR13", [[Q, "    return JSON.stringify([items.map((s) => s.videoId), slots]);", "    return JSON.stringify([items.map((s) => s.videoId)]);"]],
    QR, "C: a slot's state moving (green → sent) is a change: one redraw, and it shows", "RED"],   // My queue's commit states not in its record
  // ── which tab hears which trigger ──
  ["QR14", [[Q, "history: [\"queue\", \"rank\", \"history\"], playlists: [] };", "history: [\"queue\", \"rank\", \"history\"], playlists: [\"queue\", \"rank\"] };"]],   // re-anchored at `ddjp_662`: History's list gained "history"
    QR, "B: THE LIBRARY IGNORES A ROOM EVENT (queue)", "RED"],   // Playlists hearing room events
  ["QR15", [[Q, "mine: [\"mine\"],", "mine: [\"mine\", \"queue\"],"]],
    QR, "C: ONE DJ EVENT THAT CHANGES MY QUEUE REDRAWS IT ONCE", "RED"],   // My queue hearing Queue too: the double notify, back
  // ── My queue: only the list ──
  ["QR16", [[Q, "    if (same && tab === \"mine\") { _redrawMyList(); _drawn.rec = rec; return; }\n", ""]],
    QR, "C: A TYPED LINK AND THE FOCUS SURVIVE A REDRAW", "RED"],   // My queue redrawn whole: the add line replaced
  ["QR17", [[Q, "    if (_uqList) { _uqList.remove(); _uqList = null; }\n    H._renderUqClear();", "    _uqList = null;\n    H._renderUqClear();"]],
    QR, "C: ONE DJ EVENT THAT CHANGES MY QUEUE REDRAWS IT ONCE", "RED"],   // the old list left under the new: two lists
  ["QR18", [[Q, "    if (_uqList) { _uqList.remove(); _uqList = null; }\n    H._renderUqClear();", "    _uqList = null;\n    H._renderUqClear();"]],
    UR, "`_redrawMyList` must REMOVE the list on screen before drawing it again", "RED"],   // the same, read by the rule
  // ── a row keeps its title and picture ──
  ["QR19", [[PL, "const titleEl = H.el(\"div\", { class: \"sr-title\", text: heldTitle || videoId });", "const titleEl = H.el(\"div\", { class: \"sr-title\", text: videoId });"]],
    QR, "D (room): A REDRAWN ROW SHOWS ITS HELD TITLE AT ONCE", "RED"],   // the title falls back to the id
  ["QR20", [[PL, "    const _cachedUrl = _thumbBlobs.has(videoId) ? _thumbUrl(videoId) : null;", "    const _cachedUrl = _thumbBlobs.has(videoId) ? URL.createObjectURL(_thumbBlobs.get(videoId)) : null;"]],
    QR, "D (room): A REDRAWN ROW KEEPS THE SAME PICTURE URL", "RED"],   // a new object URL per row per redraw
  ["QR21", [[PL, "_thumbBlobs.delete(k); _thumbUrlRelease(k); }", "_thumbBlobs.delete(k); }"]],
    QR, "D: AT MOST ONE LIVE OBJECT URL PER VIDEO, AND NO MORE THAN THE BLOB CACHE HOLDS (200)", "RED"],   // never released: a leak
  ["QR22", [[PL, "    const had = _thumbUrls.get(vid);\n    if (had) return had;\n", ""]],
    QR, "D: AT MOST ONE LIVE OBJECT URL PER VIDEO", "RED"],   // a URL per ask, not per video
  // ── the library's scroll ──
  ["QR23", [[PL, "    scroll.scrollTop = _plLibScrollTop;\n", ""]],
    QR, "E: THE LIBRARY KEEPS ITS SCROLL ACROSS A REDRAW", "RED"],   // a redraw opens the library at the top
  ["QR24", [[Q, "    if (typeof PlaylistPanels !== \"undefined\" && PlaylistPanels.resetLibraryScroll) PlaylistPanels.resetLibraryScroll();\n", ""]],
    QR, "E: the Playlists tab opens it at the top, as the other tabs", "RED"],   // the tab click keeps an old scroll
  // ── timed displays ──
  ["QR25", [[Q, "if (H.queueTab() === \"room\") { renderRoomQueue(); _keepDrawn(); }", "if (H.queueTab() === \"room\") { renderRoomQueue(); }"]],
    QR, "F: THE UNLOCK RUNS ON THROUGH A ROOM EVENT THAT CHANGES NOTHING", "RED"],   // the cooldown's redraw not recorded: the next event redraws again
  ["QR26", [[Q, "      if (H.queueTab() === \"room\") { renderRoomQueue(); _keepDrawn(); }", "      void 0;"]],
    QR, "F: AT THE COOLDOWN'S END ✕🎵 IS LIVE AGAIN", "RED"],   // the cooldown's end not drawn
  // ── the windowed stack ──
  ["QR27", [[Q, "          painted.items.every((it, k) => it === items[k])) return;", "          painted.items.every((it, k) => it === items[k])) { /* repaint anyway */ }"]],
    QR, "G: ONE PAINT PER RENDER", "RED"],   // every paint rebuilds its window: 653's three paints
  ["QR28", [[Q, "    scroller.style.overflowAnchor = \"none\";\n", ""]],
    QR, "G: THE BROWSER'S SCROLL ANCHORING IS OFF ON THE LIST", "RED"],   // anchoring back on
  ["QR29", [[Q, "scroller.addEventListener(\"scroll\", () => { if (!scroller.isConnected) return; _stackScrollTop", "scroller.addEventListener(\"scroll\", () => { _stackScrollTop"]],
    QR, "G: A SCROLL EVENT FROM A REPLACED LIST PAINTS NOTHING", "RED"],   // a replaced list's scroll paints and resets the offset
  // QR30 RE-MARKED ON PURPOSE at `ddjp_656` (J131's correction): it expected red, reading the sheet content-box. The page sizes
  // every box border-box (its first rule), so the stack's own `boxSizing` repeats it and taking it away changes nothing a
  // browser draws: G must stay green.
  ["QR30", [[Q, "        row.style.boxSizing = \"border-box\";\n", ""]],
    QR, "", "GREEN"],   // the inline border-box taken away: the page's first rule still sizes the row
  // QR31 RE-ANCHORED AND ITS EXPECTED ROW RENAMED ON PURPOSE at `ddjp_656` (J131's correction): `SONG_ROW_H` is the owner's 48,
  // and G's "drawn as it always was" was read content-box; the row now holds the stack's rows at the sheet's song-row height.
  ["QR31", [[PL, "  const SONG_ROW_H = 48;", "  const SONG_ROW_H = 44;"]],
    QR, "G: AND DRAWS IT AT THE HEIGHT THE SHEET DRAWS EVERY SONG ROW", "RED"],   // counted as drawn, but drawn smaller than every other song row
  // ── inside a playlist ──
  ["QR32", [[PL, "    if (held) draw(held);\n", ""]],
    QR, "H: YOUR OWN REDRAW (the lock) DRAWS FROM THE RECORD LAST READ", "RED"],   // 653's empty list until the read
  ["QR33", [[PL, "      if (held && sameRec(held, rec)) return;   // what it shows is what the read says: nothing is touched\n", ""]],
    QR, "H: and the read, landing with the same record, redraws nothing", "RED"],   // the read redraws what is already there
  // QR34 RE-ANCHORED ON PURPOSE at `ddjp_655` (J131): a line now stands between the two it reached (a move since the redraw
  // leaves the reconciling to the move's own read); the row still takes away the record the read would hold.
  ["QR34", [[PL, "      if (turn0 !== _plMoveTurn) return;      // a move since: its own read reconciles (J131)\n      _plHeld = rec ? { id, rec } : null;\n", "      if (turn0 !== _plMoveTurn) return;      // a move since: its own read reconciles (J131)\n"]],
    QR, "H: YOUR OWN REDRAW (the lock) DRAWS FROM THE RECORD LAST READ", "RED"],   // nothing held: every redraw waits for the read
  // ── the harness: the tree the rows are read on ──
  ["QR35", [[SW, "get children() { return (doc && doc.__shape) ? collectionOf(() => this._kids.filter((c) => c.nodeType === 1)) : this._kids; },", "get children() { return this._kids; },"]],
    QR, "PROBE: the tree is DOM-shaped", "RED"],   // the browser's shape undone: an Array answers `.map`
  // ── a strike the room delivers (J130's correction, `ddjp_661`): its time recorded, then the room queue told ──
  ["QR36", [[FQ, "    const onStrike = (e) => {\n      try { const x = e && e.content && e.content.x; if (x) _lastStrikeTs[x] = (typeof e.ts === \"number\" ? e.ts : 0); } catch (err) {}\n      _notify();\n    };\n    for (const t of TYPES) {\n      const fn = (t === \"ddjp.dj.strike\") ? onStrike : notify;\n      StreamManager.on(t, fn); _subs.push([t, fn]);\n    }\n",
    "    for (const t of TYPES) { StreamManager.on(t, notify); _subs.push([t, notify]); }\n    const onStrike = (e) => { const x = e && e.content && e.content.x; if (x) _lastStrikeTs[x] = (typeof e.ts === \"number\" ? e.ts : 0); };\n    StreamManager.on(\"ddjp.dj.strike\", onStrike); _subs.push([\"ddjp.dj.strike\", onStrike]);\n"]],
    QR, "I: A STRIKE THE ROOM DELIVERS GREYS ✕🎵 AT ONCE, AT ROOM ENTRY", "RED"],   // 660's two handlers, notify subscribed first: back
  ["QR37", [[FQ, "      try { const x = e && e.content && e.content.x; if (x) _lastStrikeTs[x] = (typeof e.ts === \"number\" ? e.ts : 0); } catch (err) {}\n      _notify();\n",
    "      _notify();\n      try { const x = e && e.content && e.content.x; if (x) _lastStrikeTs[x] = (typeof e.ts === \"number\" ? e.ts : 0); } catch (err) {}\n"]],
    QR, "I: A STRIKE THE ROOM DELIVERS GREYS ✕🎵 AT ONCE, AFTER A RANK CHANGE", "RED"],   // one handler, told before it records
  ["QR38", [[FQ, "_lastStrikeTs[x] = (typeof e.ts === \"number\" ? e.ts : 0); } catch (err) {}", "_lastStrikeTs[x] = Date.now(); } catch (err) {}"]],
    QR, "I: THE COOLDOWN RUNS FROM THE STRIKE'S SERVER STAMP", "RED"],   // this device's clock in place of the server's stamp
  // ── song history's notice reaches the History tab (J130's correction, `ddjp_662`): each link of the chain, cut ──
  ["QR39", [[HI, "    for (const fn of _listeners.slice()) { try { fn(); } catch (e) { /* a listener's fault is its own */ } }\n", ""]],
    QR, "J: ON A PAGE'S FIRST ROOM, A NEW SONG IS AT THE TOP OF HISTORY AT ONCE", "RED"],   // song history tells nobody
  ["QR40", [[MB, "function onHistoryChange(fn) { try { if (typeof History !== \"undefined\" && History.onChange) History.onChange(fn); } catch (e) {} }", "function onHistoryChange(fn) {}"]],
    QR, "J: ON A PAGE'S FIRST ROOM, A NEW SONG IS AT THE TOP OF HISTORY AT ONCE", "RED"],   // the transport does not pass it on
  ["QR41", [[FQ, "      MatrixBridge.onHistoryChange(_historyChanged);\n", ""]],
    QR, "J: ON A PAGE'S FIRST ROOM, A NEW SONG IS AT THE TOP OF HISTORY AT ONCE", "RED"],   // the queue feature never subscribes
  ["QR42", [[SC, "    Queue.onHistoryChange(() => { QueuePanels.roomEvent(\"history\"); });\n", ""]],
    QR, "J: ON A PAGE'S FIRST ROOM, A NEW SONG IS AT THE TOP OF HISTORY AT ONCE", "RED"],   // the screen never wires it
  ["QR43", [[Q, "history: [\"queue\", \"rank\", \"history\"]", "history: [\"queue\", \"rank\"]"]],
    QR, "J: ON A PAGE'S FIRST ROOM, A NEW SONG IS AT THE TOP OF HISTORY AT ONCE", "RED"],   // History does not hear it
  ["QR44", [[HI, "finally { _wrote = false; } };", "finally { _wrote = false; _listeners.length = 0; } };"]],
    QR, "J: AFTER A LEAVE AND ANOTHER ROOM, SONG HISTORY'S NOTICE STILL REACHES THE HISTORY TAB", "RED"],   // a reset drops the page's listeners
  ["QR45", [[HI, "finally { _wrote = false; } };", "finally { _wrote = true; _tell(); } };"]],
    QR, "J: A LEAVE TELLS NOTHING", "RED"],   // a reset tells: the leaving room's History redrawn empty
  ["QR46", [[HI, "    if (!_wrote || _depth > 0) return;\n", "    if (!_wrote) return;\n"], [HI, "    _ranges = out;\n    _wrote = true;\n", "    _ranges = out;\n    _wrote = true; _tell();\n"]],
    QR, "L: AFTER THE RESET, A RESTORE OF THREE STRETCHES AND ITS ROWS TELLS — ONCE", "RED"],   // a notice per write, not per operation
  ["QR47", [[HI, "fillGaps: _opAsync(fillGaps)", "fillGaps: _op(fillGaps)"]],
    QR, "L: A FILL OF TWO HOLES (PAGED, SEVERAL WRITES) — ONE NOTICE, WHEN IT SETTLES", "RED"],   // an async operation told at its first await
  ["QR48", [[HI, "  const _op = (fn) => function () { _depth++; try { return fn.apply(null, arguments); } finally { _depth--; _tell(); } };",
    "  const _op = (fn) => function () { _wrote = true; _tell(); _depth++; try { return fn.apply(null, arguments); } finally { _depth--; } };"]],
    QR, "L: A SONG'S REFRESH TELLS AFTER IT WROTE", "RED"],   // told before the write
  ["QR49", [[HI, "ingest: _op(ingest)", "ingest"]],
    QR, "K: A BOT ROOM'S SAVE POINT TELLS THE HISTORY TAB ONCE", "RED"],   // only the bridge's calls tell: the engine's hand-off silent
  ["QR50", [[HI, "    });\n    _wrote = true;\n    const dropped = before - _entries.length;\n", "    });\n    const dropped = before - _entries.length;\n"]],
    QR, "L: A FLOOR'S RECONCILE WRITES WHAT IT KEEPS — ONE NOTICE", "RED"],   // a writer that does not mark
  ["QR51", [[Q, "history: [\"queue\", \"rank\", \"history\"]", "history: [\"history\", \"queue\", \"rank\"]"]],
    QR, "", "GREEN"],   // the control: the same sources in another order — the parts above read the notice, not the list's text
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
      const h = J.open("mutate-j130-lists:" + id, file);   // journalled BEFORE the write
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
