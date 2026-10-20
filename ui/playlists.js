// ui/playlists.js
// PLAYLISTS · SONG ROWS AND PREVIEW · THUMBNAIL PIPELINE — extracted from ui/interface.js at
// ddjp_389 as the fourth of the ten files roles.md §5 records.
//
// ── THE GLOBAL IS `PlaylistPanels`, NOT `Playlists` ──────────────────────────────────────────
// `Playlists` is the FEATURE module — the user-global library and its storage. This file DRAWS it
// and decides nothing. Same reason `ui/queue.js` is `QueuePanels`.
//
// ── BOTH SETTER DIRECTIONS APPEAR HERE, WHICH IS WHY THE PRINCIPLE IS DIRECTIONLESS ──────────
// **The setter goes where the value is OWNED; the caller reaches for it across the seam.**
//   · `_plView` and `_plConfirmDelete` are owned here — eleven writes in this file, one each from
//     ui/interface.js (the playlists tab handler, and the panel relock). Those two call the
//     setters at the bottom of this file.
//   · `_plLocked` is a MISCLICK LOCK. It is owned by ui/interface.js — set by room teardown and by
//     `_relockAllPanels` — and this file only TOGGLES it from two lock buttons. So it stays there
//     and this file goes through `H.setPlLocked()`.
// Measured as a class before either was applied, not one at a time: the fiftieth signature.
//
// ── THIS CLUSTER RETIRES SIX PUBLISHED ENTRIES ───────────────────────────────────────────────
// `songRow`, `_addToPlaylistBtn`, `_fmtDur`, `renderPlaylists`, `SONG_ROW_H` and `previewActive`
// were all published through `UIBase.host` for earlier clusters. They live here now, so
// ui/panels.js, ui/queue.js and ui/player.js call this file directly and the entries are gone.
// The seam is meant to be EMPTY when the tenth file lands.
//
// Depends on: UIBase, Interface (via UIBase.host), QueuePanels, Playlists, Queue, Room,
// MetadataService, ThumbnailProvider, Logger

const PlaylistPanels = (() => {

  const { refs, volumeState } = UIBase;   // the preview player mirrors the room volume
  const H = UIBase.host;

  // --- state this cluster owns, moved out of MODULE STATE with it ------------
  let _previewActive = false, _previewPlayer = null, _previewOverlay = null, _previewKeyHandler = null;
  let _previewColumn = null, _previewResizeHandler = null;   // the column the preview floats over + its reposition hook
  let _plView = "list";        // "list" (library) | a playlist id (inside one)
  let _plInited = false;       // one-time Playlists.init() guard (user-global feature)
  let _plConfirmDelete = null; // playlist id armed for the two-step inline delete
  let _plRenaming = null;      // playlist id whose name row is an inline editor
  const _plCounts = {};        // id -> track count, cached so the library list doesn't reload every render

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ THUMBNAIL PIPELINE
  //
  // Its own scheduler, not an img src: observe, enqueue, pump with a concurrency cap, blob
  // cache, LRU, failure backoff.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // THUMBNAIL VIEWPORT TRIGGER (14 §3 / §3a) — fetch on scroll-into-view only
  // ---------------------------------------------------------------------------
  // Mirrors the chat image observer: an IntersectionObserver gates work to rows a
  // viewer actually looks at, so a 5000-song list costs nothing until scrolled.
  // The room queue is the heaviest caller, so the §3a guardrails live here:
  //   • DEBOUNCE (THUMB_DEBOUNCE_MS) — a row must stay in view this long before we
  //     act, so fast scroll-throughs never fetch;
  //   • a SERIALIZED, CONCURRENCY-LIMITED pump (THUMB_CONCURRENCY wide);
  //   • 429 / error BACK-OFF — on a failure burst, pause fetching for a cooldown
  //     and fall back to cached/URL only.
  // Bounded RAM: at most THUMB_LRU thumbnails hold a live <img> src at once;
  // scroll one far away and its src is released (re-set on return, served from the
  // browser HTTP cache or the stored blob).
  //
  // Per-mode policy (set by songRow as data-thumb-mode):
  //   "fetch"     — cache hit (Store.images) → blob; else ensureThumb (downscale+
  //                 store), and on any failure fall back to the direct ytimg URL;
  //                 also ensure(title) to fill the title/duration gap.
  //   "cacheOnly" — Store.images hit → blob; otherwise leave the slot blank. Never
  //                 fetch, never URL-fallback, never title-fetch (display-if-known).
  //
  // SEAM (deferred, 14 §3): a background pre-fetch service for the room queue and
  // (selective) user queue would call the SAME MetadataService.ensure/ensureThumb
  // with its own which-songs/which-fields policy — this trigger is just the
  // viewport policy; the mechanism is field-selective and trigger-agnostic so the
  // pump can be added later without reshaping anything here.
  const THUMB_DEBOUNCE_MS = 250;    // in-view dwell before a row fetches (§3a)
  const THUMB_CONCURRENCY = 3;      // max simultaneous lookups (§3a, "2–3 wide")
  const THUMB_BACKOFF_MS  = 30000;  // pause fetching this long after a failure burst (§3a)
  const THUMB_BACKOFF_HITS = 4;     // consecutive failures that trip the back-off
  const THUMB_LRU = 60;             // max thumbnails holding a live <img> src at once

  // One observer + pump for the queue body (root). Lazily created; torn down on
  // room exit. State keyed by videoId (stable) — rows are ephemeral (the windowed
  // stack recreates them on scroll), so we never key on the node.
  let _thumb = null;   // { io, root, pending:Map(vid->timer), inflight:Set, queue:[], running:0, lru:[], fails:0, backoffUntil:0 }
  // videoIds whose thumbnail has loaded at least once this session. The windowed stack
  // recreates row DOM on every re-render (reorder/add/remove), so a freshly-mounted <img>
  // would otherwise start blank and FADE IN again — reading as a flash. For an id we've
  // already shown, we paint its (HTTP-cached) URL synchronously with no transition, so a
  // re-mount is seamless. Keyed by videoId (stable); the ytimg URL is immutable so there's
  // nothing to revoke. Never used for cacheOnly rows (they must not fetch a stranger's art).
  const _thumbSeen = new Set();
  // In-memory cache of the loaded thumbnail BLOB per videoId (the stored downscale). The
  // room-queue / history / now-playing rows are cacheOnly — they have no ytimg URL to
  // instant-paint on re-mount, so a full re-render (renderRoomQueue rebuilds EVERY row
  // when a single song changes) would blank each <img> and async-reload it from IDB,
  // reading as a FLASH. Holding the blob in RAM lets songRow paint it synchronously on
  // re-mount (no blank, no fade) — the cacheOnly analogue of the fetch-mode URL re-mount
  // above. Bounded LRU-by-insertion; blobs are small downscales so the cap is generous.
  const _thumbBlobs = new Map();
  const THUMB_BLOB_CACHE = 200;
  function _thumbCacheBlob(vid, blob) {
    if (!vid || !blob) return;
    if (_thumbBlobs.has(vid)) _thumbBlobs.delete(vid);   // re-insert to bump recency
    _thumbBlobs.set(vid, blob);
    while (_thumbBlobs.size > THUMB_BLOB_CACHE) { const k = _thumbBlobs.keys().next().value; _thumbBlobs.delete(k); }
  }
  function _newThumbState(root) {
    return { io: null, root: root, pending: new Map(), inflight: new Set(), queue: [], running: 0, lru: [], fails: 0, backoffUntil: 0 };
  }
  function _thumbReset() {
    if (_thumb && _thumb.io) { try { _thumb.io.disconnect(); } catch (e) {} }
    if (_thumb) for (const t of _thumb.pending.values()) clearTimeout(t);
    _thumb = null;
  }
  function _thumbObserver(root) {
    if (_thumb && _thumb.root === root) return _thumb;
    _thumbReset();
    _thumb = _newThumbState(root);
    if (typeof IntersectionObserver === "undefined") return _thumb;   // no IO → rows stay id-only
    _thumb.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const img = e.target;
        const vid = img.dataset ? img.dataset.vid : null;
        if (!vid) continue;
        if (e.isIntersecting) {
          // Debounce: only enqueue if it's still in view after the dwell.
          if (_thumb.pending.has(vid)) continue;
          const t = setTimeout(() => { _thumb.pending.delete(vid); _thumbEnqueue(vid); }, THUMB_DEBOUNCE_MS);
          _thumb.pending.set(vid, t);
        } else {
          // Left view before the dwell elapsed → cancel the pending fetch.
          const t = _thumb.pending.get(vid);
          if (t) { clearTimeout(t); _thumb.pending.delete(vid); }
        }
      }
    }, { root: root, rootMargin: "150px 0px" });
    return _thumb;
  }
  // Find the live <img.thumb> element(s) for a videoId within the current queue
  // body. There may be MORE THAN ONE: Room History renders a row per play, so a
  // song played N times has N rows sharing this videoId (My Queue / Playlists dedup
  // by videoId, so those surfaces never do). The observer STATE stays keyed by
  // videoId — one fetch per id, never N — but the APPLY step must reach EVERY
  // mounted row for that id, or only the first duplicate ever gets its thumbnail.
  // Rows may be absent entirely (scrolled away / re-rendered) — that's fine.
  function _thumbSel(vid) {
    return '[data-vid="' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(vid) : vid) + '"]';
  }
  // First match only — used where one representative row is enough (existence +
  // the row's thumb-mode, which is uniform across a surface's duplicates).
  function _thumbNode(vid) {
    if (!_thumb || !_thumb.root) return null;
    return _thumb.root.querySelector('img.thumb' + _thumbSel(vid));
  }
  // ALL matches — used by the apply helpers so a resolved fetch fills every row.
  function _thumbNodes(vid) {
    if (!_thumb || !_thumb.root) return [];
    return Array.prototype.slice.call(_thumb.root.querySelectorAll('img.thumb' + _thumbSel(vid)));
  }
  function _thumbRows(vid) {
    if (!_thumb || !_thumb.root) return [];
    return Array.prototype.slice.call(_thumb.root.querySelectorAll('.song-row' + _thumbSel(vid)));
  }
  // LRU bookkeeping: bump vid to most-recent; release the least-recent over cap by
  // clearing its <img> src (the stored blob / URL reloads on return).
  function _thumbTouch(vid) {
    const i = _thumb.lru.indexOf(vid);
    if (i >= 0) _thumb.lru.splice(i, 1);
    _thumb.lru.push(vid);
    while (_thumb.lru.length > THUMB_LRU) {
      const old = _thumb.lru.shift();
      // Release EVERY mounted <img> for the evicted id — duplicate History rows each
      // hold their own object URL — so nothing leaks and the cap stays honest.
      for (const node of _thumbNodes(old)) {
        const src = node.getAttribute("src");
        if (!src) continue;
        if (src.indexOf("blob:") === 0) { try { URL.revokeObjectURL(src); } catch (e) {} }
        node.removeAttribute("src");
      }
    }
  }
  function _thumbEnqueue(vid) {
    if (!_thumb) return;
    if (_thumb.inflight.has(vid) || _thumb.queue.indexOf(vid) >= 0) return;
    _thumb.queue.push(vid);
    _thumbPump();
  }
  function _thumbPump() {
    if (!_thumb) return;
    if (Date.now() < _thumb.backoffUntil) return;   // backed off → serve cache/URL only
    while (_thumb.running < THUMB_CONCURRENCY && _thumb.queue.length) {
      const vid = _thumb.queue.shift();
      if (_thumb.inflight.has(vid)) continue;
      _thumb.inflight.add(vid);
      _thumb.running++;
      _thumbProcess(vid).then(
        () => { _thumb && (_thumb.fails = 0); },
        () => {
          if (!_thumb) return;
          if (++_thumb.fails >= THUMB_BACKOFF_HITS) { _thumb.backoffUntil = Date.now() + THUMB_BACKOFF_MS; setTimeout(() => { if (_thumb) { _thumb.fails = 0; _thumbPump(); } }, THUMB_BACKOFF_MS); }
        }
      ).then(() => {
        if (!_thumb) return;
        _thumb.inflight.delete(vid);
        _thumb.running--;
        _thumbPump();
      });
    }
  }
  // Apply a stored thumbnail Blob to EVERY live img for vid (duplicate History rows
  // included). Each node gets its OWN object URL so its release stays independent
  // (no shared-URL double-revoke). Returns true if at least one row was filled.
  function _thumbShowBlob(vid, blob) {
    if (!blob) return false;
    _thumbCacheBlob(vid, blob);        // keep in RAM so a re-mount paints instantly (kills the cacheOnly flash)
    const nodes = _thumbNodes(vid);
    if (!nodes.length) return false;
    let any = false;
    for (const node of nodes) {
      // Already showing art for this id (e.g. the instant re-mount painted the direct
      // ytimg URL) → leave it. Swapping a wide 16:9 URL for the 120px center-cropped
      // square blob in the same object-fit:cover slot reframes the image and reads as
      // a zoom. The two are the same frame to the eye, so the swap buys nothing.
      if (node.classList.contains("loaded") && node.getAttribute("src")) { any = true; continue; }
      try {
        const url = URL.createObjectURL(blob);
        const prev = node.getAttribute("src");
        node.setAttribute("src", url);
        if (prev && prev.indexOf("blob:") === 0) { try { URL.revokeObjectURL(prev); } catch (e) {} }
        any = true;
      } catch (e) {}
    }
    if (any) _thumbTouch(vid);
    return any;
  }
  function _thumbShowUrl(vid) {
    const nodes = _thumbNodes(vid);
    if (!nodes.length) return;
    let any = false;
    for (const node of nodes) {
      if (node.classList.contains("loaded") && node.getAttribute("src")) { any = true; continue; }   // already painted — don't reframe
      const url = node.dataset ? node.dataset.url : null;
      if (url && node.getAttribute("src") !== url) { node.setAttribute("src", url); any = true; }
    }
    if (any) _thumbTouch(vid);
  }
  // Fill the row's title/duration from freshly-fetched metadata (fetch mode only) —
  // on EVERY mounted row for the id, not just the first duplicate.
  function _thumbDecorateMeta(vid, m) {
    if (!m) return;
    for (const rowEl of _thumbRows(vid)) {
      if (m.title) { const t = rowEl.querySelector(".sr-title"); if (t) { t.textContent = m.title; t.title = m.title; } }
      if (typeof m.durationSec === "number") { const d = rowEl.querySelector(".sr-dur"); if (d) d.textContent = _fmtDur(m.durationSec); }
    }
  }
  // The per-row work, by mode. Returns a Promise; rejects only on a real fetch
  // failure (so the back-off counter is meaningful) — a cache miss in cacheOnly
  // is a normal resolve.
  function _thumbProcess(vid) {
    const node = _thumbNode(vid);
    if (!node) return Promise.resolve();             // row gone — nothing to do
    const mode = node.dataset ? node.dataset.thumbMode : "cacheOnly";
    const imagesOk = (typeof Store !== "undefined" && Store.images);

    if (mode === "cacheOnly") {
      // Display-if-known: stored blob only, no fetch, no URL fallback.
      if (!imagesOk) return Promise.resolve();
      return Promise.resolve(Store.images.load(vid)).then((blob) => { if (blob) _thumbShowBlob(vid, blob); }).catch(() => {});
    }

    // fetch mode (your own songs): cache → ensureThumb → URL fallback; + title gap.
    const thumbWork = (imagesOk ? Promise.resolve(Store.images.load(vid)).catch(() => null) : Promise.resolve(null))
      .then((blob) => {
        if (blob) { _thumbShowBlob(vid, blob); return; }
        if (typeof MetadataService === "undefined" || !MetadataService.ensureThumb) { _thumbShowUrl(vid); return; }
        return Promise.resolve(MetadataService.ensureThumb(vid)).then((b) => {
          if (b) _thumbShowBlob(vid, b); else _thumbShowUrl(vid);     // taint/fail → direct URL
        }, () => { _thumbShowUrl(vid); });                            // never blank in fetch mode
      });
    // Title/duration gap (cache-first inside ensure). nowMs is supplied to the
    // pure freshness check; the clock lives in transport, so read it via the
    // bridge's stamp — here we just use Date.now() for the freshness comparison
    // (display-only; not consensus).
    const metaWork = (typeof MetadataService !== "undefined" && MetadataService.ensure)
      ? Promise.resolve(MetadataService.ensure(vid, ["title"], Date.now())).then((m) => _thumbDecorateMeta(vid, m)).catch(() => {})
      : Promise.resolve();
    return Promise.all([thumbWork, metaWork]);
  }

  // Called by songRow on each thumb it builds, when a fetch/cacheOnly slot exists.
  function _observeThumb(img) {
    if (!refs.queueBody) return;
    const st = _thumbObserver(refs.queueBody);
    if (st && st.io) st.io.observe(img); else if (img.dataset && img.dataset.thumbMode === "fetch") {
      // No IntersectionObserver → can't viewport-gate; show the URL directly so
      // your own queue still has thumbnails (cacheOnly stays blank without IO).
      _thumbShowUrlImmediate(img);
    }
  }
  function _thumbShowUrlImmediate(img) {
    const url = img.dataset ? img.dataset.url : null;
    if (url) img.setAttribute("src", url);
  }

  // On-demand fetch for a SINGLE row, triggered by an explicit interaction (clicking
  // the thumbnail to preview). Unlike the viewport observer this ignores the row's
  // thumbMode — even a cacheOnly surface (Room Queue / History / Now-Playing) fetches
  // here, because the user asked to interact with THIS song (not an ambient decorate,
  // 14 §3). Targets the given img/row directly, so duplicate rows for the same id
  // don't cross-update. Fetches the downscaled thumbnail (cache → ensureThumb → direct
  // URL) and fills the title/duration gap; results are cached, so other rows pick it up.
  function _previewFetch(vid, thumbImg, rowEl) {
    if (typeof MetadataService === "undefined" || !thumbImg) return;
    const imagesOk = (typeof Store !== "undefined" && Store.images);
    const showBlob = (blob) => {
      try {
        const u = URL.createObjectURL(blob);
        const prev = thumbImg.getAttribute("src");
        thumbImg.setAttribute("src", u);
        if (prev && prev.indexOf("blob:") === 0) { try { URL.revokeObjectURL(prev); } catch (e) {} }
      } catch (e) {}
    };
    const showUrl = () => { const url = thumbImg.dataset ? thumbImg.dataset.url : null; if (url && thumbImg.getAttribute("src") !== url) thumbImg.setAttribute("src", url); };
    (imagesOk ? Promise.resolve(Store.images.load(vid)).catch(() => null) : Promise.resolve(null)).then((blob) => {
      if (blob) { showBlob(blob); return; }
      if (!MetadataService.ensureThumb) { showUrl(); return; }
      return Promise.resolve(MetadataService.ensureThumb(vid)).then((b) => { if (b) showBlob(b); else showUrl(); }, () => showUrl());
    }).catch(() => {});
    if (MetadataService.ensure && rowEl) {
      Promise.resolve(MetadataService.ensure(vid, ["title"], Date.now())).then((m) => {
        if (!m) return;
        if (m.title) { const t = rowEl.querySelector(".sr-title"); if (t) { t.textContent = m.title; t.title = m.title; } }
        if (typeof m.durationSec === "number") { const d = rowEl.querySelector(".sr-dur"); if (d) d.textContent = _fmtDur(m.durationSec); }
      }).catch(() => {});
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ SONG ROWS AND PREVIEW
  //
  // songRow is used by every list. The thumbnail slot is the preview trigger for the local
  // mini-player.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // SONG ROW — one reusable component for every list of songs (14 §4)
  // ---------------------------------------------------------------------------
  // A song is just a videoId; title/thumbnail/duration are regenerable CACHE,
  // never truth (storage law). The row builds a thumbnail slot + title +
  // duration (geo cell reserved, blank until a geo provider is wired) + caller-
  // supplied action buttons, all via createElement/textContent (never innerHTML,
  // check-html-safety). Title/duration come cache-first from Store.meta and fill
  // in async when that resolves; the thumbnail is handled by the viewport trigger
  // (_thumbObserver) so nothing fetches for a row nobody looks at (14 §3).
  //
  // thumbMode decides the thumbnail policy on the row's surface:
  //   "fetch"     (My Queue — your own songs): on viewport, prefer the stored
  //               downscale; after attempting it, fall back to the direct ytimg
  //               URL so the slot is never blank.
  //   "cacheOnly" (Room Queue — other people's songs): show the stored downscale
  //               ONLY if already cached; never fetch, never URL-fallback (a
  //               stranger's song is display-only-if-known — no ambient load).
  // Both are expressed as data-attributes the observer reads; the row builder
  // itself triggers no network.
  const SONG_ROW_H = 44;            // fixed row height (px) — windowed-stack spacer math depends on it
  function _fmtDur(sec) {
    if (typeof sec !== "number" || !isFinite(sec) || sec <= 0) return "";
    const s = Math.round(sec), m = Math.floor(s / 60), r = s % 60;
    return m + ":" + (r < 10 ? "0" : "") + r;
  }
  // Build the row. opts: { pos?, actions?, thumbMode? ("fetch"|"cacheOnly"), sub? }
  function songRow(videoId, opts) {
    opts = opts || {};
    const mode = opts.thumbMode === "fetch" ? "fetch" : "cacheOnly";
    const row = H.el("div", { class: "song-row" });
    row.dataset.vid = videoId;

    // Thumbnail slot — the observer fills .src (stored blob → URL fallback in
    // fetch mode; stored blob only in cacheOnly). data-thumb-mode tells it which.
    const thumb = H.el("img", { class: "thumb", alt: "" });
    thumb.dataset.vid = videoId;
    thumb.dataset.thumbMode = mode;
    const fb = (typeof MetadataService !== "undefined") ? MetadataService.thumbUrl(videoId) : null;
    if (fb) thumb.dataset.url = fb;                 // the direct ytimg fallback (used only in fetch mode)
    // The thumb sits in a slot showing a tasteful placeholder (a ♪ in a neutral
    // box) until a real image actually loads. A cacheOnly row with no stored image
    // (e.g. an unwitnessed History song) therefore reads as an intentional empty
    // card, not a bare/broken sliver — and we still never fetch to fill it.
    thumb.addEventListener("load", () => { if (thumb.getAttribute("src")) { thumb.classList.add("loaded"); _thumbSeen.add(videoId); } });
    // Seamless re-mount: paint the art NOW, transition suppressed, so a full re-render
    // (a reorder/add, or renderRoomQueue rebuilding every row on a single song change)
    // shows it immediately instead of blank-then-fade. Prefer the cached BLOB — the
    // stored downscale, correct aspect, and the ONLY source cacheOnly rows have, so this
    // is what stops the room-queue / history / now-playing flash. Fall back to the
    // fetch-mode ytimg URL for a fetch row we've shown before but whose blob isn't cached.
    // The observer still runs and reconciles (same image; no visible change / no reframe).
    const _cachedBlob = _thumbBlobs.get(videoId);
    if (_cachedBlob) {
      try {
        thumb.classList.add("instant", "loaded");
        thumb.setAttribute("src", URL.createObjectURL(_cachedBlob));
        _thumbSeen.add(videoId);
      } catch (e) {}
    } else if (mode === "fetch" && fb && _thumbSeen.has(videoId)) {
      thumb.classList.add("instant", "loaded");
      thumb.setAttribute("src", fb);
    }
    // The thumbnail (or its ♪ placeholder) IS the preview button — click it to open
    // the mini-player (14 §7). This replaces the separate ▷ button on every row, to
    // save horizontal space. A ▶ overlay appears on hover/focus to signal it's live.
    const slot = H.el("span", { class: "thumb-slot", title: "Preview this song" }, [
      thumb, H.el("span", { class: "thumb-play", text: "\u25B6", "aria-hidden": "true" }),
    ]);
    slot.setAttribute("role", "button");
    slot.setAttribute("tabindex", "0");
    slot.setAttribute("aria-label", "Preview this song");
    const _openFromSlot = () => {
      _previewFetch(videoId, thumb, row);   // fetch this song's thumbnail + title/duration on demand
      _openPreview(videoId, slot.closest ? slot.closest(".column") : null);
    };
    slot.onclick = _openFromSlot;
    slot.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); _openFromSlot(); } };
    row.appendChild(slot);
    _observeThumb(thumb);                           // viewport-gated load (14 §3) — see _thumbObserver

    // Main column: title (defaults to the id until a cached/fetched title lands)
    // and a sub line carrying duration (and, later, geo) — plus an optional
    // caller sub (e.g. History's "played 5 min ago").
    const titleEl = H.el("div", { class: "sr-title", text: videoId });
    titleEl.title = videoId;
    const durEl = H.el("span", { class: "sr-dur" });
    const geoEl = H.el("span", { class: "sr-geo" });   // reserved; stays blank (no geo provider yet)
    const subKids = [durEl, geoEl];
    if (opts.sub) subKids.push(H.el("span", { class: "sr-when", text: opts.sub }));
    const subEl = H.el("div", { class: "sr-sub" }, subKids);
    const main = H.el("div", { class: "sr-main" }, [titleEl, subEl]);
    if (opts.pos != null) row.appendChild(H.el("span", { class: "sr-pos", text: String(opts.pos) }));
    row.appendChild(main);

    // Decorate from the per-video metadata cache (title/duration) — read-only,
    // cache-first, no fetch. The fetch (for gaps) is the observer's job in fetch
    // mode. Async, so it fills in after the row mounts (like avatars/chat images).
    if (typeof MetadataService !== "undefined" && MetadataService.get) {
      Promise.resolve(MetadataService.get(videoId)).then((m) => {
        if (!m) return;
        if (m.title) { titleEl.textContent = m.title; titleEl.title = m.title; }
        if (typeof m.durationSec === "number") durEl.textContent = _fmtDur(m.durationSec);
      }).catch(() => {});
    }

    // Action area: caller actions only (e.g. ＋ save-to-playlist, or move/remove on lists
    // you own). The preview affordance is the THUMBNAIL itself (see the slot above) — it
    // fetches title + thumbnail on demand — so there's no separate view or fetch button,
    // which saves a button's width on every row across the app.
    const acts = [];
    if (opts.actions && opts.actions.length) for (const a of opts.actions) acts.push(a);
    row.appendChild(H.el("span", { class: "uq-actions" }, acts));
    return row;
  }

  // The preview affordance now lives on the THUMBNAIL of every row (see songRow):
  // clicking the thumb/placeholder opens the mini-player below. It's LOCAL-only — it
  // sends no protocol event, never advances the rotation, and only reads title+duration
  // into the display cache — and reaches every surface at once (My Queue / Playlists /
  // Room Queue / Room History) because they all build rows through songRow.
  // ===== Preview mini-player (14 §7) =========================================
  // LOCAL-only takeover. _openPreview pauses the room player IN PLACE (no event,
  // the Spine is untouched, every other client keeps playing), mounts a centred
  // modal with a SECOND YT.Player on the chosen song, and reads its title+duration
  // into the metadata CACHE (display-only — never truth, never Playback). While
  // active, onPlaybackStateChange keeps caching _lastNp but stops driving the main
  // player. On close we tear the overlay down and re-sync the room player to LIVE
  // (the current consensus song at the live position — the room moved on while you
  // watched) and resume. Esc / the ✕ / a backdrop click all close it.
  function _applyVolumeToPreview() {
    if (!_previewPlayer) return;
    try {
      // Preview audio is INDEPENDENT of the main player — it must be audible even when
      // the room player is muted (they are NOT tied). Start unmuted at a sensible level
      // (the main's level if it's non-zero, else full); the preview's own native YT
      // controls take it from there, and nothing here ever touches the main player.
      _previewPlayer.unMute();
      _previewPlayer.setVolume((volumeState && volumeState.level > 0) ? volumeState.level : 100);
    } catch (e) { /* preview player not ready yet */ }
  }
  // Pull the player-sourced title + duration into the display cache (one combined
  // write via recordMeta — same no-clobber path the room player uses) and live-
  // update any rendered rows. NEVER calls Playback (this isn't the room song).
  function _previewRecordMeta(videoId) {
    if (!_previewPlayer) return;
    let title = null, dur = null;
    try { const vd = _previewPlayer.getVideoData(); if (vd && vd.title) title = vd.title; } catch (e) {}
    try { const d = _previewPlayer.getDuration(); if (typeof d === "number" && isFinite(d) && d > 0) dur = Math.round(d); } catch (e) {}
    if (typeof MetadataService !== "undefined" && MetadataService.recordMeta && (title || dur)) {
      const fields = {};
      if (title) fields.title = title;
      if (dur) fields.durationSec = dur;
      Promise.resolve(MetadataService.recordMeta(videoId, fields))
        .then(() => { Player._applyMetaToRows(videoId, title, dur); })
        .catch(() => {});
    }
    // Also warm the thumbnail cache so the launching row fills in on next render.
    if (typeof MetadataService !== "undefined" && MetadataService.ensureThumb) {
      Promise.resolve(MetadataService.ensureThumb(videoId)).catch(() => {});
    }
  }
  function _openPreview(videoId, columnEl) {
    if (_previewActive || !videoId) return;
    if (typeof YT === "undefined" || !window.YT || !window.YT.Player) return;   // YT not up yet
    _previewActive = true;
    _previewColumn = (columnEl && columnEl.getBoundingClientRect) ? columnEl : null;
    // Pause the room player in place — do NOT unmount the iframe, do NOT advance.
    try { if (Player.instance() && Player.isReady()) Player.instance().pauseVideo(); } catch (e) {}

    // Build the overlay with createElement only (no innerHTML — html-safety wall).
    const mount   = H.el("div", { id: "yt-preview-player" });
    const closeBtn = H.el("button", { class: "preview-x", text: "\u2715", "aria-label": "Close preview", onclick: _closePreview });
    const card = H.el("div", { class: "preview-card" }, [closeBtn, H.el("div", { class: "preview-frame" }, [mount])]);
    _previewOverlay = H.el("div", { class: "preview-overlay" }, [card]);
    // The full-screen backdrop LOCKS the rest of the UI: it captures every click so
    // nothing behind it is reachable, and clicking the backdrop itself does nothing —
    // the only way out is the ✕ (or Esc). The room (e.g. chat) stays visible through
    // the light scrim and keeps updating; you just can't interact until you exit.
    // Mount on <body>: the overlay is position:fixed (viewport-rect coords), and the
    // `#screen-main > * { position: relative }` clickability rule would otherwise force
    // it back into flow. Body keeps it free-floating over the live column.
    document.body.appendChild(_previewOverlay);
    _positionPreview();   // float it over the row's column (adapts to wide/compact/phone)

    _previewKeyHandler = (e) => { if (e.key === "Escape") _closePreview(); };
    document.addEventListener("keydown", _previewKeyHandler);
    _previewResizeHandler = () => _positionPreview();   // keep it pinned to the column on resize/layout change
    window.addEventListener("resize", _previewResizeHandler);

    // Second player — its OWN handlers; it NEVER calls Playback.notifyEnded /
    // setDuration (those drive consensus). It only records title+duration to cache.
    try {
      _previewPlayer = new YT.Player("yt-preview-player", {
        width: "100%", height: "100%", videoId: videoId,
        playerVars: { autoplay: 1, controls: 1, mute: 0, playsinline: 1, rel: 0 },
        events: {
          onReady: () => { _applyVolumeToPreview(); try { _previewPlayer.playVideo(); } catch (e) {} },
          onStateChange: (e) => { if (e.data === YT.PlayerState.PLAYING) _previewRecordMeta(videoId); }
        }
      });
    } catch (e) { _previewPlayer = null; }
  }
  // The overlay is the full-screen LOCK (fixed inset:0, CSS). This places the CARD over
  // the column the row lives in — so the preview sits IN that panel — and sizes its 16:9
  // frame to fit. Adapts to whatever layout is active. If the column is missing/hidden
  // (a layout where it's display:none), the card centres on the whole viewport instead.
  function _positionPreview() {
    if (!_previewOverlay) return;
    const card = _previewOverlay.querySelector(".preview-card");
    const frame = _previewOverlay.querySelector(".preview-frame");
    if (!card || !frame) return;
    const r = _previewColumn ? _previewColumn.getBoundingClientRect() : null;
    const vw = window.innerWidth || document.documentElement.clientWidth;
    const vh = window.innerHeight || document.documentElement.clientHeight;
    const area = (r && r.width > 40 && r.height > 40)
      ? { left: r.left, top: r.top, width: r.width, height: r.height }
      : { left: 0, top: 0, width: vw, height: vh };
    // Largest 16:9 frame that fits the area (card padding 12 + a margin from the edges).
    const pad = 12, gap = 14;
    const availW = Math.max(80, area.width - 2 * gap - 2 * pad);
    const availH = Math.max(45, area.height - 2 * gap - 2 * pad - 8);   // headroom for the card
    let fw = availW, fh = fw * 9 / 16;
    if (fh > availH) { fh = availH; fw = fh * 16 / 9; }
    frame.style.width = Math.round(fw) + "px";
    frame.style.height = Math.round(fh) + "px";
    // Centre the card within the area (read its size now that the frame is sized).
    const cr = card.getBoundingClientRect();
    card.style.left = Math.round(area.left + (area.width - cr.width) / 2) + "px";
    card.style.top  = Math.round(area.top + (area.height - cr.height) / 2) + "px";
  }
  function _closePreview() {
    if (!_previewActive) return;
    _previewActive = false;
    if (_previewKeyHandler) { document.removeEventListener("keydown", _previewKeyHandler); _previewKeyHandler = null; }
    if (_previewResizeHandler) { window.removeEventListener("resize", _previewResizeHandler); _previewResizeHandler = null; }
    if (_previewPlayer) { try { _previewPlayer.destroy(); } catch (e) {} _previewPlayer = null; }
    if (_previewOverlay && _previewOverlay.parentNode) _previewOverlay.parentNode.removeChild(_previewOverlay);
    _previewOverlay = null; _previewColumn = null;
    // Reattach the room player and re-sync to LIVE (loads the now-current consensus
    // song at the live position if it changed, else seeks the paused player forward),
    // then resume — the room kept moving while the preview played.
    Player._driveNowPlaying(Player.lastNp());
    try { if (Player.instance() && Player.isReady() && Player.lastNp() && Player.lastNp().song && !Player.lastNp().ended) Player.instance().playVideo(); } catch (e) {}
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ PLAYLISTS
  //
  // Library, detail, the add-to-playlist picker, and import/export.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // PLAYLISTS — the saved-library panel (14 §5 / P3). UI only: it reads/commands
  // the Playlists feature (create/rename/remove, addTrack/removeTrack, clone) and
  // renders the same song-rows the other surfaces use. All truth + protections
  // (dedup, caps, name disambiguation, the submit-path clone) live in the feature;
  // this layer never persists or mutates a playlist directly. Every node is built
  // via el() → check-html-safety stays clean.
  // ---------------------------------------------------------------------------

  // Playlists is USER-GLOBAL (not room-scoped like UserQueue), so it inits once —
  // lazily, the first time the panel or the add-to-playlist picker is opened — and
  // wires its onChange exactly once. Account switch reloads the page, so one init
  // per page load is correct per account. Kept out of the boot path on purpose.
  function _ensurePlaylistsInit() {
    if (_plInited || typeof Playlists === "undefined") return;
    _plInited = true;
    try { Playlists.init(); } catch (e) {}
    if (Playlists.onChange) Playlists.onChange(() => {
      // Fires on library changes (create/rename/remove/reorder). Refresh only when
      // the panel is showing the library list.
      if (H.queueTab() === "playlists" && _plView === "list") QueuePanels.renderQueuePanel();
    });
  }

  // Alphabetical, case-folded, natural-number sort — shared by the library tab and
  // the picker so both surfaces agree. "2" < "11", "apple" groups with "Apple".
  function _plSort(list) {
    return list.slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
  }

  function renderPlaylists() {
    _ensurePlaylistsInit();
    if (typeof Playlists === "undefined") {
      refs.queueBody.appendChild(H.el("p", { class: "muted", text: "Playlists are unavailable." }));
      return;
    }
    // Opening the Playlists tab always shows the library list (the tab's onclick
    // resets _plView); this validate is a safety for a detail view left pointing at
    // a since-deleted playlist.
    if (_plView !== "list" && !Playlists.list().some((p) => p.id === _plView)) _plView = "list";
    if (_plView === "list") _renderPlaylistLibrary();
    else _renderPlaylistDetail(_plView);
  }

  // --- Library view: create + the list of playlists (name · count) -------------
  // The create row is PINNED (in the panel's fixed head); only the list scrolls.
  function _renderPlaylistLibrary() {
    // New-playlist row (same shape as My Queue's add-by-link box) — fixed at the top.
    const input = H.el("input", { class: "uq-input", placeholder: "New playlist name…" });
    const note = H.el("div", { class: "uq-note muted" });
    const create = async () => {
      const name = input.value.trim();
      if (!name) return;
      const r = await Playlists.create(name);
      if (r && r.ok) { input.value = ""; note.textContent = "Created “" + r.name + "”."; }
      else { note.textContent = "Couldn't create: " + ((r && r.reason) || "unknown"); }
      // On success create() notifies → the panel re-renders and the new list appears
      // (the note element is rebuilt, so the confirmation is transient — that's fine,
      // the new row IS the confirmation). On failure there's no notify, so the error
      // note stays put.
    };
    input.onkeydown = (e) => { if (e.key === "Enter") create(); };
    // The lock (right of Create) gates rename + delete on every row below — while
    // locked they can't even be armed. Non-timed; re-locks on any tab change.
    const plLock = H._panelLockBtn(H.plLocked(),
      H.plLocked() ? "Locked — click to unlock editing" : "Unlocked — click to lock",
      () => { H.setPlLocked(!H.plLocked()); _plConfirmDelete = null; QueuePanels.renderQueuePanel(); });
    refs.queueBody.appendChild(H.el("div", { class: "pl-lib-head" }, [
      H.el("div", { class: "uq-add" }, [input, H.el("button", { text: "Create", onclick: create }), plLock]),
      H.el("div", { class: "pl-io-entry" }, [
        H.el("button", { class: "mini pl-io-open", text: "\u21C5 Import / Export",
          title: "Import or export playlists to a file", onclick: () => _openLibraryIO("export") }),
      ]),
      note,
    ]));

    const scroll = H.el("div", { class: "pl-scroll" });
    refs.queueBody.appendChild(scroll);
    const lists = _plSort(Playlists.list());
    if (!lists.length) {
      scroll.appendChild(H.el("p", { class: "muted", text: "No playlists yet — create one above." }));
      return;
    }
    for (const p of lists) scroll.appendChild(_playlistRow(p));
  }

  // One library row: name (click to open) · count · rename · delete (two-step).
  function _playlistRow(p) {
    const row = H.el("div", { class: "pl-row" });

    if (_plRenaming === p.id) {
      // Inline rename editor — commits through the feature (sanitize/collapse/cap/
      // non-empty + (2)/(3) disambiguation all apply). Enter/blur commit, Esc cancels.
      const edit = H.el("input", { class: "uq-input pl-rename", value: p.name });
      let done = false;   // Enter commits, which re-renders and fires blur → guard the second commit
      const commit = async () => {
        if (done) return;
        done = true;
        const v = edit.value.trim();
        _plRenaming = null;
        if (v && v !== p.name) { await Playlists.rename(p.id, v); }  // notify → re-render
        else QueuePanels.renderQueuePanel();
      };
      edit.onkeydown = (e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") { done = true; _plRenaming = null; QueuePanels.renderQueuePanel(); }
      };
      edit.onblur = commit;
      row.appendChild(edit);
      setTimeout(() => { try { edit.focus(); edit.select(); } catch (e) {} }, 0);
      return row;
    }

    const name = H.el("button", { class: "pl-name", text: p.name, title: "Open" });
    name.onclick = () => { _plView = p.id; _plConfirmDelete = null; QueuePanels.renderQueuePanel(); };
    row.appendChild(name);

    // Count · loaded lazily and cached (the index carries no counts). Shows the
    // cached number immediately if we have it, else fills in when the record loads.
    const count = H.el("span", { class: "pl-count" });
    if (typeof _plCounts[p.id] === "number") count.textContent = _plCounts[p.id] + (_plCounts[p.id] === 1 ? " song" : " songs");
    else {
      Promise.resolve(Playlists.get(p.id)).then((rec) => {
        const n = rec && rec.tracks ? rec.tracks.length : 0;
        _plCounts[p.id] = n;
        count.textContent = n + (n === 1 ? " song" : " songs");
      }).catch(() => {});
    }
    row.appendChild(count);

    const acts = [];
    if (_plConfirmDelete === p.id) {
      // Armed: REPLACE [✎ rename][✕ delete] with [✔ confirm] · [✘ cancel], fenced by the
      // .q-sep. The confirm is `mini ico dconfirm` — the SAME icon-button geometry as the
      // cancel ✕ (26×24, centered, no border/margin), just tinted red. It must NOT carry
      // the bare `.danger` class: that is the big standalone-button style (align-self
      // flex-start + margin-top + border + large padding) and it was pushing the confirm
      // down and growing the whole row. \uFE0E keeps the glyph text-presented (no taller
      // color-emoji). See `.mini.ico.dconfirm` / `.dconfirm + .q-sep` in index.html.
      acts.push(H.el("button", { class: "mini ico dconfirm", text: "\u2714\uFE0E", title: "Confirm delete",
        onclick: async () => { _plConfirmDelete = null; delete _plCounts[p.id]; await Playlists.remove(p.id); } }));
      acts.push(H.el("span", { class: "q-sep", "aria-hidden": "true" }));
      acts.push(H.el("button", { class: "mini ico", text: "\u2718\uFE0E", title: "Cancel",
        onclick: () => { _plConfirmDelete = null; QueuePanels.renderQueuePanel(); } }));
    } else {
      const renameBtn = H.el("button", { class: "mini ico", text: "✎",
        title: H.plLocked() ? "Locked — unlock (top) to rename" : "Rename",
        onclick: () => { if (H.plLocked()) return; _plRenaming = p.id; _plConfirmDelete = null; QueuePanels.renderQueuePanel(); } });
      renameBtn.disabled = H.plLocked();
      const delBtn = H.el("button", { class: "mini ico", text: "✕",
        title: H.plLocked() ? "Locked — unlock (top) to delete" : "Delete playlist",
        onclick: () => { if (H.plLocked()) return; _plConfirmDelete = p.id; QueuePanels.renderQueuePanel(); } });
      delBtn.disabled = H.plLocked();
      acts.push(renameBtn, delBtn);
    }
    row.appendChild(H.el("span", { class: "uq-actions" }, acts));
    return row;
  }

  // --- Detail view: one playlist's tracks --------------------------------------
  function _renderPlaylistDetail(id) {
    const back = H.el("button", { class: "mini pl-back", text: "← Back", title: "Back to playlists" });
    back.onclick = () => { _plView = "list"; _plConfirmDelete = null; QueuePanels.renderQueuePanel(); };
    const titleEl = H.el("span", { class: "pl-detail-title", text: "…" });
    const addAll = H.el("button", { class: "mini", text: "＋ All to my queue", title: "Add every song to my queue" });
    // Same Playlists-tab lock (_plLocked) that gates rename/delete in the library view,
    // surfaced here so it also gates the per-row ✕ remove-from-playlist. Same style
    // (.panel-lock-btn) and mannerism (non-timed, re-locks on tab change) as the other
    // panel locks; toggling disarms any pending remove and repaints the detail view.
    const detailLock = H._panelLockBtn(H.plLocked(),
      H.plLocked() ? "Locked — click to unlock removing" : "Unlocked — click to lock",
      () => { H.setPlLocked(!H.plLocked()); _plConfirmDelete = null; QueuePanels.renderQueuePanel(); });
    const header = H.el("div", { class: "pl-detail-head" }, [back, titleEl, H.el("span", { class: "uq-actions" }, [addAll, detailLock])]);
    refs.queueBody.appendChild(header);
    const note = H.el("div", { class: "uq-note muted" });

    // Add-by-link: the playlist analogue of My Queue's add box. Paste a YouTube link
    // (or a bare id) to drop a song straight into THIS playlist — routes through
    // Playlists.addTrackByUrl -> addTrack, so it inherits dedup + the track cap. On
    // success we re-render the detail (still on this playlist) so the new row shows.
    const linkInput = H.el("input", { class: "uq-input", placeholder: "Paste a YouTube link…" });
    const addByLink = async () => {
      const v = linkInput.value.trim();
      if (!v) return;
      const r = await Playlists.addTrackByUrl(id, v);
      if (r && r.ok) {
        linkInput.value = "";
        delete _plCounts[id];      // count is stale; reloads on re-render
        QueuePanels.renderQueuePanel();        // _plView is still this id -> detail re-renders with the new track
      } else {
        note.textContent = "Couldn't add: " + ((r && r.reason) || "unknown") + ".";
      }
    };
    linkInput.onkeydown = (e) => { if (e.key === "Enter") addByLink(); };
    refs.queueBody.appendChild(H.el("div", { class: "uq-add" }, [linkInput, H.el("button", { text: "Add", onclick: addByLink })]));

    refs.queueBody.appendChild(note);
    const body = H.el("div", { class: "pl-detail-body" });
    refs.queueBody.appendChild(body);

    addAll.onclick = async () => {
      const r = await Playlists.addWholeToQueue(id);
      if (r && r.ok) { note.textContent = "Added " + r.added + ", skipped " + r.skipped + "."; Roster.renderJoinBtn(); }
      else { note.textContent = "Couldn't add: " + ((r && r.reason) || "unknown"); }
    };

    Promise.resolve(Playlists.get(id)).then((rec) => {
      if (!rec) { titleEl.textContent = "(missing)"; body.appendChild(H.el("p", { class: "muted", text: "This playlist is gone." })); return; }
      titleEl.textContent = rec.name;
      titleEl.title = rec.name;
      _plCounts[id] = rec.tracks.length;
      if (!rec.tracks.length) {
        body.appendChild(H.el("p", { class: "muted", text: "No songs yet — paste a link above, or use the ＋ on a song in History or Now Playing." }));
        return;
      }
      // Windowed like My Queue's stack (a playlist can hold up to 5000). Each row:
      // ＋-to-my-queue (clone via the submit path), the view/preview button (built
      // into songRow), and a two-step remove-from-list.
      QueuePanels._renderWindowedStack(body, () => rec.tracks, (t, i) =>
        _playlistTrackRow(id, t.videoId, i), SONG_ROW_H);
    }).catch(() => { titleEl.textContent = "(error)"; });
  }

  function _playlistTrackRow(playlistId, videoId, i) {
    // ＋ add-to-my-queue is always available (non-destructive). The ✕ remove-from-playlist
    // is a SINGLE click — no two-step confirm — because the Playlists lock already guards
    // it: while locked the ✕ is greyed + inert (mirroring the library view's delete ✕), so
    // an accidental removal isn't possible without deliberately unlocking at the top first.
    // NOTE: dropping the confirm is scoped to per-song removal INSIDE a playlist only; the
    // library view (deleting a WHOLE playlist) keeps its two-step confirm. A .q-sep fences
    // ＋ from ✕ so the remove can't be fat-fingered, matching the My-Queue clusters.
    const acts = [];
    acts.push(H.el("button", { class: "mini ico", text: "＋", title: "Add to my queue",
      onclick: () => { const r = Playlists.cloneToQueue(videoId); Roster.renderJoinBtn();
        if (r && !r.ok && r.reason) Logger.info("My queue: " + r.reason); } }));
    acts.push(H.el("span", { class: "q-sep", "aria-hidden": "true" }));
    const rmBtn = H.el("button", { class: "mini ico", text: "✕",
      title: H.plLocked() ? "Locked — unlock (top) to remove" : "Remove from playlist",
      onclick: async () => {
        if (H.plLocked()) return;
        delete _plCounts[playlistId];
        await Playlists.removeTrack(playlistId, videoId);
        QueuePanels.renderQueuePanel();
      } });
    rmBtn.disabled = H.plLocked();
    acts.push(rmBtn);
    return songRow(videoId, { pos: (i + 1) + ".", thumbMode: "fetch", actions: acts });
  }

  // --- The cross-surface "add to a playlist" picker (History / Now Playing) -----
  // A body-mounted overlay (the Preview precedent), so it floats above the panel.
  // Structure: a FIXED head (title + Done) and a FIXED "new playlist" create row
  // stay pinned at the top; only the list of playlists scrolls beneath them. Adding
  // — whether to an existing list or via create-and-add — KEEPS THE PICKER OPEN so
  // you can add the same song to several playlists; it closes only on Done/backdrop.
  // onAdded (optional): fired ONCE, only when a track was genuinely added (r.ok), after
  // the picker closes. Used by the now-playing ★ to emit ddjp.dj.save + latch the star;
  // History's ＋ passes nothing (saving an old song is not a reaction to now-playing).
  function _openAddToPlaylist(videoId, onAdded) {
    _ensurePlaylistsInit();
    if (typeof Playlists === "undefined") return;
    const prior = document.querySelector(".pl-pick-overlay");
    if (prior) prior.remove();

    const result = H.el("div", { class: "uq-note muted pl-pick-note" });
    const listWrap = H.el("div", { class: "pl-pick-list" });

    const close = () => { if (Playlists.offChange) Playlists.offChange(repaint); overlay.remove(); };
    const addTo = async (pid, pname) => {
      const r = await Playlists.addTrack(pid, videoId);
      delete _plCounts[pid];   // library count is stale now; it reloads on next view
      const added = !!(r && r.ok);
      result.textContent = added ? "Added to “" + pname + "”."
        : "Not added: " + ((r && r.reason) || "unknown") + ".";
      close();   // one-and-done: adding a song closes the picker (as if Done)
      if (added && typeof onAdded === "function") { try { await onAdded(); } catch (e) {} }
    };

    const paint = () => {
      H.clear(listWrap);
      const lists = _plSort(Playlists.list());
      if (!lists.length) { listWrap.appendChild(H.el("p", { class: "muted", text: "No playlists yet — make one above." })); return; }
      for (const p of lists) {
        const b = H.el("button", { class: "pl-pick-item", text: p.name });
        b.onclick = () => addTo(p.id, p.name);
        listWrap.appendChild(b);
      }
    };
    // Re-paint wrapper for the onChange subscription. Self-heals the double-open
    // edge: if a later open replaced this overlay (its node detached) without our
    // close() firing, the next notify unsubscribes this stale listener instead of
    // painting into a detached node.
    const repaint = () => {
      if (!listWrap.isConnected) { if (Playlists.offChange) Playlists.offChange(repaint); return; }
      paint();
    };

    const newInput = H.el("input", { class: "uq-input", placeholder: "New playlist…" });
    const newAdd = async () => {
      const name = newInput.value.trim();
      if (!name) return;
      const c = await Playlists.create(name);
      if (c && c.ok) { newInput.value = ""; await addTo(c.id, c.name); }   // create, add, then close (addTo closes)
      else { result.textContent = "Couldn't create: " + ((c && c.reason) || "unknown") + "."; }
    };
    newInput.onkeydown = (e) => { if (e.key === "Enter") newAdd(); };
    paint();
    // Playlists.init()'s IndexedDB hydrate is ASYNC. On the FIRST time the picker
    // opens (before Playlists has ever hydrated), Playlists.list() above is still
    // empty and paint() shows "No playlists yet" even though lists exist. Re-paint
    // when the index lands (and on any later create/rename/remove); close()
    // unsubscribes so this doesn't leak across opens.
    if (Playlists.onChange) Playlists.onChange(repaint);

    // Fixed head: title + Done.
    const closeBtn = H.el("button", { class: "mini", text: "Done", onclick: close });
    const head = H.el("div", { class: "pl-pick-head" }, [
      H.el("span", { class: "pl-pick-title", text: "Add to a playlist" }),
      H.el("span", { class: "uq-actions" }, [closeBtn]),
    ]);
    // Fixed create row + result note, pinned under the head, above the scrolling list.
    const newRow = H.el("div", { class: "uq-add pl-pick-new" }, [newInput, H.el("button", { text: "Create + add", onclick: newAdd })]);

    const card = H.el("div", { class: "pl-pick-card" }, [head, newRow, result, listWrap]);
    const overlay = H.el("div", { class: "pl-pick-overlay" }, [card]);
    overlay.onclick = (e) => { if (e.target === overlay) close(); };
    document.body.appendChild(overlay);
    setTimeout(() => { try { newInput.focus(); } catch (e) {} }, 0);
  }

  // === 15: Playlists Import / Export overlay =================================
  // Body-mounted (the add-to-playlist / Preview precedent), reusing the .pl-pick-*
  // card. Two modes (Export | Import). During a run the view is LOCKED — no
  // backdrop/Close exit, only Cancel — and the run aborts cleanly (no partial file /
  // no half-written import beyond whole playlists already made). All non-consensus.
  function _ioTab(label, active, onclick) {
    return H.el("button", { class: "pl-io-tab" + (active ? " active" : ""), text: label, onclick: onclick });
  }

  function _openLibraryIO(startMode) {
    _ensurePlaylistsInit();
    if (typeof Playlists === "undefined" || typeof Playlists.exportPrepare !== "function") return;
    const prior = document.querySelector(".pl-io-overlay");
    if (prior) prior.remove();

    const S = {
      mode: startMode === "import" ? "import" : "export",
      phase: "pick",           // pick | running
      prep: null, selected: null, includeThumbs: true,
      run: null, prog: { done: 0, total: 0 }, note: "",
      file: null, fileName: "", inspect: null, summary: null,
    };

    const bodyEl = H.el("div", { class: "pl-io-body" });
    const card = H.el("div", { class: "pl-pick-card pl-io-card" });
    const overlay = H.el("div", { class: "pl-pick-overlay pl-io-overlay" }, [card]);
    const locked = () => S.phase === "running";
    const close = () => { overlay.remove(); };
    overlay.onclick = (e) => { if (e.target === overlay && !locked()) close(); };

    function _fmtBytes(n) {
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB";
      return (n / 1024 / 1024).toFixed(1) + " MB";
    }
    function _estimate() {
      const sizes = (S.prep && S.prep.thumbSizes) || {};
      let lists = 0, songs = 0, withThumb = 0, thumbChars = 0, textChars = 0;
      for (const l of (S.prep ? S.prep.lists : [])) {
        if (!S.selected.has(l.id)) continue;
        lists++; textChars += (l.name || "").length + 24;
        for (const t of l.tracks) {
          songs++; textChars += (t.videoId || "").length + 40;
          const s = sizes[t.videoId];
          if (typeof s === "number") { withThumb++; thumbChars += Math.ceil(s * 4 / 3) + 30; }
        }
      }
      const base = 80;
      return { lists, songs, withThumb, without: base + textChars, withT: base + textChars + thumbChars };
    }
    function _filename() {
      const d = new Date(), p = (n) => String(n).padStart(2, "0");
      return "ddjp-playlists-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + ".json";
    }
    function _download(obj) {
      const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = H.el("a", { href: url, download: _filename() });
      document.body.appendChild(a); a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); a.remove(); } catch (e) {} }, 4000);
    }

    function head() {
      const doneBtn = H.el("button", { class: "mini", text: "Close", onclick: () => { if (!locked()) close(); } });
      doneBtn.disabled = locked();
      const tabs = H.el("span", { class: "pl-io-tabs" }, [
        _ioTab("Export", S.mode === "export", () => { if (!locked()) { S.mode = "export"; S.phase = "pick"; S.note = ""; render(); } }),
        _ioTab("Import", S.mode === "import", () => { if (!locked()) { S.mode = "import"; S.phase = "pick"; S.note = ""; render(); } }),
      ]);
      return H.el("div", { class: "pl-pick-head" }, [
        H.el("span", { class: "pl-pick-title", text: "Playlists" }), tabs,
        H.el("span", { class: "uq-actions" }, [doneBtn]),
      ]);
    }

    function progressView() {
      const pct = S.prog.total ? Math.round(S.prog.done / S.prog.total * 100) : 0;
      const fill = H.el("div", { class: "pl-io-bar-fill" }); fill.setAttribute("style", "width:" + pct + "%");
      S._fill = fill;
      S._label = H.el("div", { class: "pl-io-prog-label", text: (S.mode === "export" ? "Exporting…" : "Importing…") + " " + S.prog.done + " / " + S.prog.total + " songs" });
      const cancel = H.el("button", { class: "mini danger", text: "Cancel", onclick: () => { if (S.run) S.run.cancelled = true; } });
      return H.el("div", { class: "pl-io-prog" }, [S._label, H.el("div", { class: "pl-io-bar" }, [fill]), H.el("div", { class: "pl-io-prog-actions" }, [cancel])]);
    }
    function _tick(done, total) {
      S.prog.done = done; S.prog.total = total;
      if (S._fill) S._fill.setAttribute("style", "width:" + (total ? Math.round(done / total * 100) : 0) + "%");
      if (S._label) S._label.textContent = (S.mode === "export" ? "Exporting…" : "Importing…") + " " + done + " / " + total + " songs";
    }

    function exportPick() {
      const wrap = H.el("div", { class: "pl-io-export" });
      if (!S.prep) {
        wrap.appendChild(H.el("p", { class: "muted", text: "Loading your playlists…" }));
        Playlists.exportPrepare().then((prep) => {
          S.prep = prep || { lists: [], thumbSizes: {} };
          S.selected = new Set(S.prep.lists.map((l) => l.id));
          render();
        }).catch(() => { S.prep = { lists: [], thumbSizes: {} }; S.selected = new Set(); render(); });
        return wrap;
      }
      if (!S.prep.lists.length) { wrap.appendChild(H.el("p", { class: "muted", text: "No playlists to export yet." })); return wrap; }

      wrap.appendChild(H.el("div", { class: "pl-io-selrow" }, [
        H.el("button", { class: "mini", text: "Select all", onclick: () => { S.selected = new Set(S.prep.lists.map((l) => l.id)); render(); } }),
        H.el("button", { class: "mini", text: "Deselect all", onclick: () => { S.selected = new Set(); render(); } }),
      ]));

      const listWrap = H.el("div", { class: "pl-io-list" });
      for (const l of S.prep.lists) {
        const cb = H.el("input", { type: "checkbox" }); cb.checked = S.selected.has(l.id);
        cb.onchange = () => { if (cb.checked) S.selected.add(l.id); else S.selected.delete(l.id); _repaintEst(); };
        listWrap.appendChild(H.el("label", { class: "pl-io-item" }, [cb,
          H.el("span", { class: "pl-io-item-name", text: l.name }),
          H.el("span", { class: "pl-io-item-count", text: String(l.tracks.length) })]));
      }
      wrap.appendChild(listWrap);

      const thumbCb = H.el("input", { type: "checkbox" }); thumbCb.checked = S.includeThumbs;
      thumbCb.onchange = () => { S.includeThumbs = thumbCb.checked; _repaintEst(); };
      wrap.appendChild(H.el("label", { class: "pl-io-thumbs" }, [thumbCb, H.el("span", { text: "Include thumbnails" })]));

      S._est = H.el("div", { class: "pl-io-est muted" });
      S._cov = H.el("div", { class: "pl-io-cov muted" });
      wrap.appendChild(S._est); wrap.appendChild(S._cov);
      _repaintEst();

      const btn = H.el("button", { class: "pl-io-go", text: "Export to file", onclick: () => _runExport() });
      wrap.appendChild(H.el("div", { class: "pl-io-go-row" }, [btn]));
      if (S.note) wrap.appendChild(H.el("div", { class: "uq-note muted", text: S.note }));
      return wrap;
    }
    function _repaintEst() {
      if (!S._est) return;
      const e = _estimate();
      let txt = e.lists + (e.lists === 1 ? " playlist · " : " playlists · ") + e.songs + (e.songs === 1 ? " song — " : " songs — ");
      txt += S.includeThumbs ? ("~" + _fmtBytes(e.withT) + " with thumbnails") : (_fmtBytes(e.without) + " without thumbnails");
      S._est.textContent = txt;
      if (S._cov) S._cov.textContent = S.includeThumbs ? ("thumbnails for " + e.withThumb + " of " + e.songs + " songs (the rest re-fetch on import)") : "";
    }
    async function _runExport() {
      const ids = S.prep.lists.filter((l) => S.selected.has(l.id)).map((l) => l.id);
      if (!ids.length) { S.note = "Select at least one playlist to export."; render(); return; }
      S.phase = "running"; S.run = { cancelled: false }; S.prog = { done: 0, total: 0 }; render();
      const res = await Playlists.exportBuild(ids, { includeThumbs: S.includeThumbs, onProgress: _tick, isCancelled: () => S.run.cancelled });
      S.phase = "pick";
      if (res && res.ok) { _download(res.file); S.note = "Exported " + ids.length + (ids.length === 1 ? " playlist." : " playlists."); }
      else if (res && res.reason === "cancelled") { S.note = "Export cancelled — no file saved."; }
      else { S.note = "Export failed."; }
      render();
    }

    function importPick() {
      const wrap = H.el("div", { class: "pl-io-import" });
      const fileInput = H.el("input", { type: "file", accept: ".json,application/json" });
      fileInput.setAttribute("style", "display:none");
      fileInput.onchange = () => {
        const f = fileInput.files && fileInput.files[0];
        if (!f) return;
        S.fileName = f.name || "file"; S.summary = null;
        const rd = new FileReader();
        rd.onload = () => {
          let obj = null; try { obj = JSON.parse(String(rd.result)); } catch (e) { obj = null; }
          S.file = obj;
          S.inspect = obj ? Playlists.inspectLibrary(obj) : { ok: false, reason: "not valid JSON" };
          render();
        };
        rd.onerror = () => { S.file = null; S.inspect = { ok: false, reason: "couldn't read the file" }; render(); };
        rd.readAsText(f);
      };
      wrap.appendChild(H.el("div", { class: "pl-io-choose" }, [
        H.el("button", { class: "mini", text: "Choose file…", onclick: () => fileInput.click() }),
        H.el("span", { class: "muted", text: S.fileName ? (" " + S.fileName) : " no file chosen" }),
      ]));
      wrap.appendChild(fileInput);

      if (S.summary) {
        const su = S.summary;
        const t = su.err ? ("Import failed: " + su.err)
          : su.cancelled ? ("Cancelled — kept " + su.playlists + (su.playlists === 1 ? " playlist (" : " playlists (") + su.added + " songs) already imported.")
          : ("Imported " + su.playlists + (su.playlists === 1 ? " playlist · " : " playlists · ") + su.added + (su.added === 1 ? " song added · " : " songs added · ") + su.skipped + " skipped.");
        wrap.appendChild(H.el("div", { class: "uq-note", text: t }));
        return wrap;
      }
      if (S.inspect) {
        if (S.inspect.ok) {
          wrap.appendChild(H.el("div", { class: "pl-io-est muted", text: S.inspect.playlists + (S.inspect.playlists === 1 ? " playlist · " : " playlists · ") + S.inspect.songs + (S.inspect.songs === 1 ? " song in this file." : " songs in this file.") }));
          wrap.appendChild(H.el("div", { class: "pl-io-cov muted", text: "Added as new playlists (a repeated name gets a number). Nothing you already have is changed." }));
          wrap.appendChild(H.el("div", { class: "pl-io-go-row" }, [H.el("button", { class: "pl-io-go", text: "Import", onclick: () => _runImport() })]));
        } else {
          wrap.appendChild(H.el("div", { class: "uq-note muted", text: "This doesn't look like a DDJP playlists file (" + (S.inspect.reason || "unrecognized") + ")." }));
        }
      } else {
        wrap.appendChild(H.el("p", { class: "muted", text: "Choose a DDJP playlists file to import." }));
      }
      return wrap;
    }
    async function _runImport() {
      if (!S.file) return;
      S.phase = "running"; S.run = { cancelled: false }; S.prog = { done: 0, total: 0 }; render();
      const res = await Playlists.importLibrary(S.file, { onProgress: _tick, isCancelled: () => S.run.cancelled });
      S.phase = "pick";
      S.summary = (res && res.ok) ? res : { playlists: 0, added: 0, skipped: 0, err: (res && res.reason) || "unknown" };
      render();
    }

    function render() {
      H.clear(card); card.appendChild(head());
      H.clear(bodyEl);
      if (S.phase === "running") bodyEl.appendChild(progressView());
      else if (S.mode === "export") bodyEl.appendChild(exportPick());
      else bodyEl.appendChild(importPick());
      card.appendChild(bodyEl);
    }
    render();
    document.body.appendChild(overlay);
  }

  // A ＋ action button that opens the add-to-playlist picker for a videoId. Shared
  // by the History rows and the Now-Playing row.
  function _addToPlaylistBtn(videoId) {
    return H.el("button", { class: "mini ico", text: "＋", title: "Add to a playlist",
      onclick: () => _openAddToPlaylist(videoId) });
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    renderPlaylists, _openAddToPlaylist, _addToPlaylistBtn,
    songRow, _fmtDur, _positionPreview, _closePreview, _thumbReset,
    SONG_ROW_H: () => SONG_ROW_H,
    previewActive: () => _previewActive,
    confirmDelete: () => _plConfirmDelete,
    // Setters for the two values this file OWNS and ui/interface.js writes.
    setView: (v) => { _plView = v; },
    setConfirmDelete: (v) => { _plConfirmDelete = v; },
  };
})();
