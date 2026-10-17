// core/windowedlist.js
// The shared windowed-list primitive (08 §6 / 09 §4 `window`). One bounded
// sliding window over an ordered source, reused by chat scrollback, playlists,
// and the user queue — directional prefetch, a buffer above/below the viewport,
// and release-the-far-end to cap RAM. Built ONCE here, not three bespoke times.
//
// Source-agnostic: a consumer injects `source.fetch({ before, after, limit })`
// (returns up to `limit` items in ascending key order; `before`/`after` are the
// exclusive cursor keys of the current edges, both undefined => most-recent page)
// and a `key(item)` extractor. The same engine then sits over an IndexedDB list
// (playlists/queue) or Matrix scrollback (chat) without change.
//
// The WINDOW MATH is pure and guard-tested; only the source fetch (IDB / Matrix)
// and the DOM scroll wiring — supplied by the consumer — are review-only. Items
// are held in ascending order: "up" = older/smaller keys at the front, "down" =
// newer/larger keys at the back. No dependencies.

const WindowedList = (() => {

  // ---- pure transitions (guard-tested) ----------------------------------

  // Decide which direction to prefetch, or null. `viewTop`/`viewBottom` are the
  // indices (into the loaded items) that bound the visible slice; we prefetch
  // when the loaded-but-hidden margin on an edge falls to/under `buffer` and the
  // source still has more that way.
  function planFetch(state) {
    const count = state.count || 0;
    const above = state.viewTop;                       // loaded items hidden above the viewport
    const below = count - 1 - state.viewBottom;        // loaded items hidden below the viewport
    const buffer = state.buffer || 0;
    if (state.hasMoreUp && above <= buffer) return "up";
    if (state.hasMoreDown && below <= buffer) return "down";
    return null;
  }

  // Prepend an older page (ascending) to the front, then release the FAR end
  // (bottom) past maxWindow. Returns the new items + how many were released.
  function mergeUp(items, page, maxWindow) {
    let next = (page || []).concat(items);
    let released = 0;
    if (maxWindow > 0 && next.length > maxWindow) { released = next.length - maxWindow; next = next.slice(0, maxWindow); }
    return { items: next, released: released, releasedFrom: "bottom" };
  }

  // Append a newer page (ascending) to the back, then release the FAR end (top)
  // past maxWindow. Returns the new items + how many were released.
  function mergeDown(items, page, maxWindow) {
    let next = items.concat(page || []);
    let released = 0;
    if (maxWindow > 0 && next.length > maxWindow) { released = next.length - maxWindow; next = next.slice(released); }
    return { items: next, released: released, releasedFrom: "top" };
  }

  // ---- stateful controller over a source --------------------------------

  function create(opts) {
    opts = opts || {};
    const source = opts.source;
    const key = opts.key || ((x) => x && x.id);
    const pageSize = opts.pageSize || 50;
    const maxWindow = opts.maxWindow || 300;
    const buffer = opts.buffer || 20;

    let items = [];
    let hasMoreUp = opts.hasMoreUp !== undefined ? opts.hasMoreUp : true;
    let hasMoreDown = opts.hasMoreDown !== undefined ? opts.hasMoreDown : false;
    let loading = false;
    const listeners = [];

    function snapshot() { return { items: items.slice(), hasMoreUp: hasMoreUp, hasMoreDown: hasMoreDown, loading: loading }; }
    function onChange(fn) { if (fn && !listeners.includes(fn)) listeners.push(fn); }
    function _emit() { const s = snapshot(); for (const fn of listeners) { try { fn(s); } catch (e) {} } }

    async function _fetch(dir) {
      if (loading) return;
      if (dir === "up" && !hasMoreUp) return;
      if (dir === "down" && !hasMoreDown) return;
      loading = true; _emit();
      try {
        const before = (dir === "up" && items.length) ? key(items[0]) : undefined;
        const after = (dir === "down" && items.length) ? key(items[items.length - 1]) : undefined;
        const page = (await source.fetch({ before: before, after: after, limit: pageSize })) || [];
        if (dir === "up") {
          if (page.length < pageSize) hasMoreUp = false;     // source exhausted upward
          const r = mergeUp(items, page, maxWindow); items = r.items;
          if (r.released) hasMoreDown = true;                // we dropped some bottom -> more exists below again
        } else {
          if (page.length < pageSize) hasMoreDown = false;
          const r = mergeDown(items, page, maxWindow); items = r.items;
          if (r.released) hasMoreUp = true;
        }
      } catch (e) { /* keep current window; just clear loading below */ }
      loading = false; _emit();
    }

    // Load the initial (most-recent) page.
    async function init() { items = []; await _fetch(hasMoreUp ? "up" : "down"); }
    // Fetch the most recent page for a fresh, empty window (before/after undefined).
    // The UI calls this with the visible index bounds as the user scrolls.
    function onScroll(viewTop, viewBottom) {
      const dir = planFetch({ count: items.length, viewTop: viewTop, viewBottom: viewBottom, buffer: buffer, hasMoreUp: hasMoreUp, hasMoreDown: hasMoreDown });
      if (dir) return _fetch(dir);
    }

    return { init: init, onScroll: onScroll, snapshot: snapshot, onChange: onChange };
  }

  // ---- in-RAM source adapter (queue / playlists) ------------------------
  // Window a list held fully in memory. Entries carry their position as the
  // cursor key, so the SAME primitive windows a RAM list the way it windows an
  // IDB or Matrix source — that's how the user queue and playlists reuse it
  // (chat uses an async source instead). Orientation is top-down: the initial
  // page is the HEAD (position 0); scroll DOWN for more. Re-init the controller
  // after the backing array mutates (cheap — it's RAM). Pair with key: e => e._i.
  function arraySource(getArray) {
    return {
      fetch: function (q) {
        const arr = getArray() || [];
        const limit = q.limit || 50;
        let lo, hi;
        if (q.before !== undefined) { hi = q.before; lo = Math.max(0, hi - limit); }            // older (smaller index)
        else if (q.after !== undefined) { lo = q.after + 1; hi = Math.min(arr.length, lo + limit); } // newer (larger index)
        else { lo = 0; hi = Math.min(arr.length, limit); }                                       // initial: head of the list
        const out = [];
        for (let i = lo; i < hi; i++) out.push({ _i: i, item: arr[i] });
        return Promise.resolve(out);
      },
    };
  }

  // Pure: which rows to paint for a SYNCHRONOUS virtual scroll over a list held
  // fully in RAM. Given the scroll offset, the viewport/row heights, the total
  // row count, and a buffer of off-screen rows each side, return the [start, end)
  // slice to render plus the pixel padding above/below so the scrollbar stays
  // proportional. This is the in-RAM counterpart to the async controller: when
  // the whole list is in memory the window is a pure function of scroll position
  // (no cursors, no paging), which also makes scroll position trivially
  // preservable across list mutations. Total/clamps are defensive.
  function visibleRange(scrollTop, viewportH, rowH, total, buffer) {
    rowH = rowH > 0 ? rowH : 1;
    buffer = buffer > 0 ? buffer : 0;
    total = Math.max(0, total | 0);
    const firstVisible = Math.floor(Math.max(0, scrollTop || 0) / rowH);
    const visibleCount = Math.ceil(Math.max(0, viewportH || 0) / rowH);
    let start = firstVisible - buffer;
    let end = firstVisible + visibleCount + buffer;
    if (start < 0) start = 0;
    if (end > total) end = total;
    if (start > end) start = end;
    return { start: start, end: end, topPad: start * rowH, botPad: Math.max(0, total - end) * rowH };
  }

  return { create: create, planFetch: planFetch, mergeUp: mergeUp, mergeDown: mergeDown, arraySource: arraySource, visibleRange: visibleRange };
})();
