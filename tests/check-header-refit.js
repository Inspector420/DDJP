// tests/check-header-refit.js
// SUBJECT: ui/shell.js
// WALL: THE TOP BAR RE-FITS WHEN WHAT IS IN IT CHANGES, NOT ONLY WHEN ITS WIDTH CHANGES (`ddjp_699`, JOB 2; HANDOFF §What is owed at
// `ddjp_698`: "The header's fit runs only when the header's own width changes" — at 390 px an upgrade's countdown appearing left the
// header 15 px too wide, 405 of 390, until the window next changed).
//   A  A PART APPEARING RE-FITS IT — the countdown put into the upgrade slot with the window unchanged and no fit asked for: the
//      fit runs, steps down until the header fits, and steps back up when the countdown goes.
//   B  A TEXT CHANGING RE-FITS IT — the countdown ticking to a longer text, the upload note's words changing. (CHANGED ON PURPOSE AT
//      `ddjp_702`: the rank's pill, whose words it changed until then, left the top bar for your picture's menu.)
//   C  ONE FIT PER CHANGE, NEVER ITS OWN — the fit's own writes (the shortened id, the tight classes, the arrow) do not call it back:
//      one change, one fit, then quiet (the fifty-seventh signature: a write fires only a change that moved).
//   D  ONE MECHANISM, ONE OBSERVER — the main screen built again leaves one observer watching, the new header's; the old one let go.
// DRIVEN on the REAL ui/ files (`tests/_screen-world.js`). MODELLED, and only this: the header's widths, a sum of its parts' as a
// browser would lay out a row — each part's width from its words (the room name, the note, the countdown), the tight
// classes shortening what the sheet shortens, the gaps and padding of `.main-header` — and a MutationObserver that hears what the
// double's tree does, as a browser's does (a part added or taken away; a text replaced), delivered after the change, at the turn's
// end. The real widths are Chromium's (`699-REPORT.md`: 390 px, the countdown appearing, 390 of 390).
// RED FIRST ON 698: the countdown appears and nothing re-fits — the header stays too wide.
"use strict";
const path = require("path");
const SW = require(path.join(__dirname, "_screen-world.js"));

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[header-refit] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } return !!c; }

// ── A MUTATIONOBSERVER AS A BROWSER'S, OVER THE DOUBLE'S TREE ─────────────────────────────────────────────────────────────────
// The double tells its document's watchers of every insert and removal under a node (`noteMutation`, the screen world): each
// watcher here is an observer's subscription; a record queues its callback once, run at the end of the turn (a microtask), as a
// browser delivers; `takeRecords()` empties the queue so nothing is delivered for it.
// A RUNAWAY IS SAID, NOT WAITED OUT: a fit whose own writes called it back would deliver for ever, one microtask after another,
// and starve every timer — the guard would hang rather than answer. Past `RUNAWAY` deliveries in one go the double stops and says so.
const observers = [];
const RUNAWAY = 200;
let runaway = false, burst = 0;
function makeMO(docOf) {
  return function MutationObserver(cb) {
    const doc = docOf();
    const self = { cb, subs: [], pending: 0, queued: false, live: true };
    const deliver = () => {
      self.queued = false;
      if (!self.live || !self.pending) return;
      if (++burst > RUNAWAY) { runaway = true; self.pending = 0; return; }
      setImmediate(() => { burst = 0; });
      const n = self.pending; self.pending = 0; self.delivered = (self.delivered || 0) + 1; cb(new Array(n).fill({}), api);
    };
    const api = {
      // `subtree` HONOURED, as a browser honours it: without it only the observed node's own child list is heard (the screen world
      // tells a watcher which node changed, `note`); with it, any node under it.
      observe(root, opts) {
        const sub = { root, records: 0, paneRebuilds: 0, rowsBuilt: 0, rowsRemoved: 0, opts: opts || {},
          note(target) {
            if (!self.live || (!this.opts.subtree && target !== root) || !(this.opts.childList || this.opts.characterData)) return;
            self.pending++; if (!self.queued) { self.queued = true; Promise.resolve().then(deliver); }
          } };
        self.subs.push(sub); doc.__watchers.push(sub);
      },
      disconnect() { self.live = false; doc.__watchers = doc.__watchers.filter((x) => self.subs.indexOf(x) < 0); self.subs = []; },
      takeRecords() { const n = self.pending; self.pending = 0; return new Array(n).fill({}); },
      _self: self,
    };
    observers.push(api);
    return api;
  };
}
const features = {
  Room: { rankLadder: () => [], getMyId: () => "@me:hs", getCurrent: () => ({ spaceId: "!s:hs", roomId: "!s:hs" }), getRoster: () => [], getMyRank: () => 0,
    getMyAuthorityLevel: () => 99, rankStanding: () => ({ ring: false }), onRankChange() {}, onMembersChange() {}, peopleOrder: () => [] },
  Media: { getAvatarUrl: () => null },
  Actions: { ACTIONS: [], describe: () => ({ enabled: false, reason: null }), perform: async () => ({ ok: true }) },
};
let w = null;
w = SW.world({ features, domShaped: true, globals: { MatrixStatus: { state: () => ({ lines: [], ring: "green", chat: null }), onChange() {}, waitingSecs: () => 0 },
  MutationObserver: makeMO(() => w.doc) } });
w.sb.Settings.renderSettings = () => {}; w.sb.Settings.renderChatSettings = () => {};
const settle = async (n) => { for (let i = 0; i < (n || 3); i++) await new Promise((r) => setImmediate(r)); };
const flat = (k) => [k].concat(...Array.from((k && k.children) || []).filter((c) => c.nodeType === 1).map(flat));
const has = (n, c) => String((n && n.className) || "").split(/\s+/).indexOf(c) >= 0;

// ── THE ROW'S WIDTHS, AS A BROWSER LAYS OUT `.main-header` (the model; see the header) ─────────────────────────────────────────
const CHAR = { title: 8.5, note: 6.5, upgrade: 6.5 };
function partWidth(n) {
  if (!n || n.nodeType !== 1) return 0;
  if (has(n, "upgrade-slot")) { const t = n.textContent || ""; return t ? Math.ceil(t.length * CHAR.upgrade) : 0; }
  if (has(n, "back-btn")) return 26;
  if (has(n, "title-group")) {
    const title = flat(n).find((x) => has(x, "room-title"));
    const t = (title && title.textContent) || "";
    const tw = has(title, "fit-tight") ? Math.min(t.length * CHAR.title, 34) : t.length * CHAR.title;   // the sheet: `.title-group h2.fit-tight { max-width: 4ch }`
    const extra = flat(n).filter((x) => has(x, "copy-btn")).length * (26 + 10);
    return Math.ceil(tw + extra);
  }
  if (has(n, "layout-selector")) return 30;   // 698's ⊞, so the same rows read the tree before
  if (has(n, "my-identity")) {
    let sum = 0, parts = 0;
    for (const k of Array.from(n.children || []).filter((c) => c.nodeType === 1)) {
      let pw = 0;
      if (k === w.refs.myAvatarSlot) pw = 32;
      else if (k === w.refs.avatarNote) pw = Math.ceil((k.textContent || "").length * CHAR.note);
      else if (has(k, "copy-btn")) pw = 26;
      if (pw > 0) { sum += pw; parts++; }
    }
    return Math.ceil(sum + Math.max(0, parts - 1) * 8);   // `.my-identity { gap: 8px }`
  }
  return 0;
}
let fits = 0;
function modelHeader(header, width) {
  header.clientWidth = width;
  Object.defineProperty(header, "scrollWidth", { configurable: true, get() {
    const ws = Array.from(header.children || []).filter((c) => c.nodeType === 1).map(partWidth).filter((x) => x > 0);
    return 28 + ws.reduce((a, b) => a + b, 0) + Math.max(0, ws.length - 1) * 12;   // `.main-header { gap: 12px; padding: 10px 14px }`
  } });
}
const fitsNow = (h) => h.scrollWidth <= h.clientWidth + 1;
const level = () => (w.H.headerFit ? w.H.headerFit().level : null);

(async () => {
  // A LONGER NAME SINCE `ddjp_702`: the top bar lost the rank's pill and the room's ⧉ (both in your picture's menu now), so 698's
  // countdown overflows 390 px only beside a longer room name — the case this guard is about, kept.
  try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Friday night at the club" }); } catch (e) { /* stand-ins not scripted */ }
  const header = w.refs.mainHeader;
  if (!ok(!!header, "APPLIED — the main screen's top bar was built")) return finish();
  // Count every fit: each ends by placing the open menus (`H.placeMenus`), a member call on the host the fit reaches at call time.
  const place = w.H.placeMenus;
  w.H.placeMenus = function () { fits++; return place.apply(this, arguments); };
  modelHeader(header, 390);
  w.sb.Roster.renderMyRank();   // your picture, as the room shows it (asks for a fit itself)
  await settle();
  ok(fitsNow(header) && level() === 0, "PREMISE — at 390 px, nothing in the slot, the header fits with nothing shortened", { scroll: header.scrollWidth, client: header.clientWidth, level: level() });

  // ── A — A PART APPEARING ──
  const slot = w.refs.upgradeSlot;
  const f0 = fits;
  const note = w.doc.createElement("span"); note.className = "upgrade-note"; note.textContent = "Next unlock in 1:59:59";
  slot.appendChild(note);   // the countdown appears; the window does not change and nobody asks for a fit
  const overBy = header.scrollWidth - header.clientWidth;
  await settle();
  ok(overBy > 1, "A PREMISE — the countdown makes the row wider than the window, as at 698 (405 of 390)", overBy);
  ok(fits > f0 && fitsNow(header) && level() > 0, "A: THE COUNTDOWN APPEARS — THE HEADER RE-FITS, WITH NO RESIZE AND NO FIT ASKED FOR: it steps down until it fits",
    { fits: fits - f0, scroll: header.scrollWidth, client: header.clientWidth, level: level() });
  // ── C — ONE FIT FOR IT, NOT ITS OWN WRITES ──
  ok(fits - f0 === 1 && !runaway, "C: ONE CHANGE, ONE FIT — the fit's own writes (tight classes, the shortened words) do not call it back", { fits: fits - f0, runaway });
  const f1 = fits;
  await settle(5);
  ok(fits === f1, "C: AND THEN QUIET — nothing fits again while nothing changes", fits - f1);
  // ── B — A TEXT CHANGING ──
  const lv = level();
  note.textContent = "Next unlock in 1:59:58";
  await settle();
  ok(fits === f1 + 1 && fitsNow(header) && level() === lv, "B: THE COUNTDOWN TICKS — ONE FIT, STILL FITTING", { fits: fits - f1, level: level() });
  w.refs.avatarNote.textContent = "Uploading…";
  await settle();
  ok(fits === f1 + 2 && fitsNow(header), "B: THE UPLOAD NOTE'S WORDS CHANGE — ONE FIT", { fits: fits - f1, scroll: header.scrollWidth });
  // ── A, back ──
  slot.replaceChildren();
  w.refs.avatarNote.textContent = "";
  await settle();
  ok(level() === 0 && fitsNow(header), "A: THE COUNTDOWN GOES — THE HEADER STEPS BACK UP, nothing left shortened", { level: level(), scroll: header.scrollWidth });

  // ── D — ONE OBSERVER ──
  const liveBefore = observers.filter((o) => o._self.live && o._self.subs.some((s) => s.root === header)).length;
  ok(liveBefore === 1, "D: ONE OBSERVER WATCHES THE HEADER", liveBefore);
  try { w.sb.Screens.enterMainScreen({ roomId: "!s:hs", spaceId: "!s:hs", name: "Another room" }); } catch (e) {}
  const header2 = w.refs.mainHeader;
  const live = observers.filter((o) => o._self.live);
  ok(header2 !== header && live.length === 1 && live[0]._self.subs.every((s) => s.root === header2), "D: BUILT AGAIN — STILL ONE, THE NEW HEADER'S; THE OLD ONE LET GO",
    { live: live.length, roots: live.map((o) => o._self.subs.map((s) => s.root === header2 ? "new" : "old")) });
  finish();
})().catch((e) => { ok(false, "threw — " + ((e && e.stack) || e).toString().split("\n").slice(0, 3).join(" | ")); finish(); });

function finish() {
  if (failed) { console.log("[header-refit] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[header-refit] PASS — the top bar re-fits when what is in it changes (`ddjp_699`, JOB 2; " + asserts + " assertions): the upgrade " +
    "countdown appearing at 390 px, with no resize and no fit asked for, re-fits it until it fits, and it steps back when the countdown goes; a text " +
    "changing — the countdown's tick, the upload note's words — re-fits it; one change, one fit, never the fit's own writes; one observer, the current " +
    "header's. Chromium measured the real widths (the report)");
  process.exit(0);
}
