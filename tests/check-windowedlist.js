// tests/check-windowedlist.js
// WALL: the windowed-list primitive. The DOM-scroll and IDB-page wiring are
// supplied by consumers (review-only), but the windowing MATH must be correct or
// every consumer (chat/playlists/queue) inherits the bug: prefetch the right
// direction, merge a page on the right end, and RELEASE the far end so RAM stays
// bounded. We drive the real controller through a fake in-memory source (no IDB,
// no DOM) and check the pure transitions directly.

const { loadInContext } = require("./_load");
const { WindowedList } = loadInContext(["core/windowedlist.js"], {});

let failed = 0;
function ok(c, m) { if (!c) { console.log("[windowedlist] FAIL — " + m); failed++; } }
function eq(g, w, m) { const a = JSON.stringify(g), b = JSON.stringify(w); if (a !== b) { console.log("[windowedlist] FAIL — " + m + "\n      got " + a + "\n      want " + b); failed++; } }

// --- pure: planFetch direction ---
const PF = WindowedList.planFetch;
eq(PF({ count: 100, viewTop: 5, viewBottom: 50, buffer: 10, hasMoreUp: true, hasMoreDown: false }), "up", "near top + more above -> up");
eq(PF({ count: 100, viewTop: 50, viewBottom: 95, buffer: 10, hasMoreUp: true, hasMoreDown: true }), "down", "near bottom + more below -> down");
eq(PF({ count: 100, viewTop: 50, viewBottom: 60, buffer: 10, hasMoreUp: true, hasMoreDown: true }), null, "middle of window -> no fetch");
eq(PF({ count: 100, viewTop: 2, viewBottom: 50, buffer: 10, hasMoreUp: false, hasMoreDown: false }), null, "near top but nothing more above -> no fetch");

// --- pure: mergeUp / mergeDown release the FAR end ---
eq(WindowedList.mergeUp([{ k: 5 }], [{ k: 3 }, { k: 4 }], 10), { items: [{ k: 3 }, { k: 4 }, { k: 5 }], released: 0, releasedFrom: "bottom" }, "mergeUp prepends, no release under cap");
const up = WindowedList.mergeUp([{ k: 3 }, { k: 4 }, { k: 5 }], [{ k: 1 }, { k: 2 }], 4);
eq(up.items.map(x => x.k), [1, 2, 3, 4], "mergeUp over cap releases from the bottom");
eq([up.released, up.releasedFrom], [1, "bottom"], "mergeUp reports 1 released from bottom");
const dn = WindowedList.mergeDown([{ k: 1 }, { k: 2 }], [{ k: 3 }, { k: 4 }], 3);
eq(dn.items.map(x => x.k), [2, 3, 4], "mergeDown over cap releases from the top");
eq([dn.released, dn.releasedFrom], [1, "top"], "mergeDown reports 1 released from top");

// --- pure: visibleRange (synchronous in-RAM virtual scroll) ---
const VR = WindowedList.visibleRange;   // viewport 10 rows of 20px, buffer 3
eq(VR(0, 200, 20, 1000, 3), { start: 0, end: 13, topPad: 0, botPad: (1000 - 13) * 20 }, "top: start 0, buffer below only");
eq(VR(2000, 200, 20, 1000, 3), { start: 97, end: 113, topPad: 97 * 20, botPad: (1000 - 113) * 20 }, "middle: window around scroll, buffered both sides, padded");
const _b = VR(1000 * 20 - 200, 200, 20, 1000, 3);
eq([_b.end, _b.botPad], [1000, 0], "bottom: end clamps to total, no bottom padding");
eq(VR(0, 200, 20, 5, 3), { start: 0, end: 5, topPad: 0, botPad: 0 }, "list shorter than viewport: render all");
eq(VR(0, 200, 20, 0, 3), { start: 0, end: 0, topPad: 0, botPad: 0 }, "empty list: empty range");
eq(VR(99999, 200, 20, 10, 3), { start: 10, end: 10, topPad: 200, botPad: 0 }, "scroll past end clamps");

// --- integration: real controller over a fake ordered source of 1000 items ---
function fakeSource(N) {
  const all = []; for (let i = 0; i < N; i++) all.push({ k: i, v: "i" + i });
  return {
    fetch({ before, after, limit }) {
      let page;
      if (before !== undefined) { const lt = all.filter((x) => x.k < before); page = lt.slice(Math.max(0, lt.length - limit)); }
      else if (after !== undefined) { const gt = all.filter((x) => x.k > after); page = gt.slice(0, limit); }
      else { page = all.slice(Math.max(0, all.length - limit)); }   // most-recent page
      return Promise.resolve(page);
    },
  };
}

(async () => {
  const wl = WindowedList.create({ source: fakeSource(1000), key: (x) => x.k, pageSize: 50, maxWindow: 120, buffer: 10, hasMoreUp: true, hasMoreDown: false });

  await wl.init();
  let s = wl.snapshot();
  eq(s.items.length, 50, "init loads one most-recent page");
  eq([s.items[0].k, s.items[49].k], [950, 999], "init page is the newest 50 (950..999)");

  await wl.onScroll(2, 30);           // near top -> fetch older
  s = wl.snapshot();
  eq(s.items.length, 100, "one page older: window grows to 100, still under cap");
  eq(s.items[0].k, 900, "older page prepended (front is now 900)");

  await wl.onScroll(2, 30);           // again -> would be 150, trims to 120 from the bottom
  s = wl.snapshot();
  eq(s.items.length, 120, "window is capped at maxWindow (120)");
  eq([s.items[0].k, s.items[119].k], [850, 969], "after trim: front 850, bottom released down to 969");
  ok(s.hasMoreDown === true, "releasing from the bottom marks hasMoreDown");

  // keep paging up; window must never exceed the cap, and must exhaust at k=0
  for (let i = 0; i < 40; i++) await wl.onScroll(2, 30);
  s = wl.snapshot();
  ok(s.items.length <= 120, "window stays bounded across many scrolls (<=120)");
  eq(s.items[0].k, 0, "paged all the way to the oldest item");
  ok(s.hasMoreUp === false, "source exhausted upward -> hasMoreUp false");

  // ascending + contiguous within the window
  let contiguous = true; for (let i = 1; i < s.items.length; i++) if (s.items[i].k !== s.items[i - 1].k + 1) contiguous = false;
  ok(contiguous, "loaded window is contiguous and ascending");

  // --- in-RAM arraySource: top-down paging over a live array (queue/playlists) ---
  const big = []; for (let i = 0; i < 250; i++) big.push({ vid: "v" + i });
  const wl2 = WindowedList.create({ source: WindowedList.arraySource(() => big), key: (e) => e._i, pageSize: 50, maxWindow: 120, buffer: 10, hasMoreUp: false, hasMoreDown: true });
  await wl2.init();
  let t = wl2.snapshot();
  eq(t.items.length, 50, "arraySource init loads the HEAD page (top-down)");
  eq([t.items[0]._i, t.items[0].item.vid, t.items[49]._i], [0, "v0", 49], "head page entries carry position + item");
  await wl2.onScroll(20, 49);              // near bottom -> extend down
  t = wl2.snapshot();
  eq(t.items.length, 100, "extends downward to 100");
  await wl2.onScroll(70, 99);              // again -> 150, trims top to 120
  t = wl2.snapshot();
  eq(t.items.length, 120, "arraySource window capped at maxWindow");
  eq([t.items[0]._i, t.items[119]._i], [30, 149], "released from the top: window is now positions 30..149");
  ok(t.hasMoreUp === true, "releasing the top means we can scroll back up");
  for (let i = 0; i < 20; i++) await wl2.onScroll(t.items.length - 30, t.items.length - 1);
  t = wl2.snapshot();
  ok(t.items.length <= 120, "stays bounded paging to the end");
  eq(t.items[t.items.length - 1]._i, 249, "reached the last position");
  ok(t.hasMoreDown === false, "end of the in-RAM list -> hasMoreDown false");

  if (failed) { console.log("[windowedlist] " + failed + " failure(s)"); process.exit(1); }
  console.log("[windowedlist] PASS — planFetch, far-end release, visibleRange, bounded paging (async + in-RAM), exhaustion");
  process.exit(0);
})();
