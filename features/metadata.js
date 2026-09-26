// features/metadata.js — MetadataService
//
// ONE monolith module with MODULAR internals. It owns the POLICY — the per-video
// metadata cache (Store.meta + Store.images), the per-field freshness rules
// (title/duration permanent, geo TTL'd), in-flight dedup, and the untrusted-output
// sanitization boundary — and a PROVIDER REGISTRY for the MECHANISM (how a field is
// actually fetched). Built-in providers ship here; an extension or a code edit calls
// registerProvider() to add another. New providers are PREPENDED, so a custom or
// "unsupported" fetcher is tried before the built-ins (FIRST-SUCCESS-BY-ORDER), with
// the built-ins remaining as fallback. (14 §3, §5b.)
//
// The safety line: a provider returns DATA, NOT TRUST. Every provider's output
// (built-in, extension, or imported file) passes the SAME sanitize() boundary —
// videoId pattern-checked, strings length-capped and kept as plain text (callers
// render as textContent, never markup), durations/regions range-checked, unknown
// fields dropped, nothing executed. A sketchy fetcher can make a title WRONG; it can
// never make it DANGEROUS.
//
// Layering: a feature (depends on Store; used by the UI). Pure decision helpers
// (sanitize / isFresh / providersFor / validId) are exposed for the guard. The async
// fetch loop + cache I/O are thin glue; the built-in provider FETCH bodies touch the
// DOM/network and are review-only (browser-verified), never run at load.
const MetadataService = (function () {
  "use strict";

  const VIDEOID_RE = /^[A-Za-z0-9_-]{11}$/;       // YouTube video id shape
  const MAX_TITLE  = 300;                          // cap untrusted title length
  const REGION_RE  = /^[A-Z]{2}$/;                 // ISO-3166-1 alpha-2
  const GEO_TTL_MS = 90 * 24 * 60 * 60 * 1000;     // geo re-checks after 90 days (14 §3)

  function validId(videoId) { return typeof videoId === "string" && VIDEOID_RE.test(videoId); }

  // ---- PURE: the sanitization boundary (all provider/import output passes here) --
  // Returns a cleaned partial { title?, durationSec?, geo? }; drops anything that
  // doesn't validate; never throws; never returns markup.
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    if (typeof raw.title === "string") {
      const t = raw.title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
      if (t) out.title = t;                          // plain text — render as textContent
    }
    if (typeof raw.durationSec === "number" && isFinite(raw.durationSec) &&
        raw.durationSec > 0 && raw.durationSec < 24 * 3600) {
      out.durationSec = Math.round(raw.durationSec);
    }
    if (raw.geo && typeof raw.geo === "object") {
      const blocked = Array.isArray(raw.geo.blocked)
        ? raw.geo.blocked.filter((c) => typeof c === "string" && REGION_RE.test(c)).slice(0, 400)
        : [];
      const checkedAt = (typeof raw.geo.checkedAt === "number" && isFinite(raw.geo.checkedAt)) ? raw.geo.checkedAt : 0;
      out.geo = { blocked: blocked, checkedAt: checkedAt };
    }
    return out;
  }

  // ---- PURE: is a field fresh enough to skip re-fetching? nowMs is passed IN (the
  // clock lives in transport; callers supply the time). ----
  function isFresh(field, entry, nowMs) {
    if (!entry || typeof entry !== "object") return false;
    if (field === "title")       return typeof entry.title === "string" && entry.title.length > 0;   // permanent
    if (field === "durationSec") return typeof entry.durationSec === "number";                        // permanent
    if (field === "geo") {
      if (!entry.geo || typeof entry.geo !== "object") return false;
      const at = (typeof entry.geo.checkedAt === "number") ? entry.geo.checkedAt : 0;
      return (typeof nowMs === "number") && (nowMs - at) < GEO_TTL_MS;                                 // TTL'd
    }
    return false;
  }

  // ---- provider registry (first-success-by-order) ----
  // A provider: { id, fields: ["title"|"geo"|...], fetch(videoId, field) -> partial }
  const _providers = [];                             // ordered; index 0 tried first
  function registerProvider(p) {                     // extensions PREPEND -> override built-ins
    if (p && typeof p.fetch === "function" && Array.isArray(p.fields)) _providers.unshift(p);
    return api;
  }
  // PURE: providers that declare `field`, in priority order.
  function providersFor(field) {
    return _providers.filter((p) => p && Array.isArray(p.fields) && p.fields.indexOf(field) >= 0);
  }

  // ---- async: fetch one field via the first provider that succeeds ----
  function _fetchField(videoId, field) {
    if (!validId(videoId)) return Promise.resolve({});
    const chain = providersFor(field);
    let i = 0;
    function next() {
      if (i >= chain.length) return Promise.resolve({});
      const p = chain[i++];
      return Promise.resolve().then(() => p.fetch(videoId, field)).then((raw) => {
        const clean = sanitize(raw);                 // every provider's output is untrusted
        if (clean[field] !== undefined) return clean; // first success wins
        return next();
      }).catch(() => next());                          // a failing provider falls through
    }
    return next();
  }

  // ---- cache + dedup + policy ----
  const _inflight = {};                              // "videoId|field" -> Promise (dedup)
  function get(videoId) {                            // cached metadata only — no fetch
    return (typeof Store !== "undefined" && Store.meta) ? Store.meta.load(videoId) : Promise.resolve(null);
  }
  function _merge(into, part) {
    if (part.title !== undefined)       into.title = part.title;
    if (part.durationSec !== undefined) into.durationSec = part.durationSec;
    if (part.geo !== undefined)         into.geo = part.geo;
    return into;
  }
  function _save(videoId, rec) { if (typeof Store !== "undefined" && Store.meta) Store.meta.persist(videoId, rec); }

  // Ensure the requested fields are present/fresh, fetching only stale ones via the
  // registry. nowMs supplied by caller (transport clock). Returns merged metadata.
  // Pull-fetched fields are those a provider declares (e.g. title, geo); duration is
  // push-only (recordDuration), so it is never pulled here.
  function ensure(videoId, fields, nowMs) {
    if (!validId(videoId)) return Promise.resolve({});
    const want = Array.isArray(fields) && fields.length ? fields : ["title"];
    return get(videoId).then((cached) => {
      const entry = cached || {};
      const stale = want.filter((f) => !isFresh(f, entry, nowMs) && providersFor(f).length > 0);
      if (!stale.length) return entry;
      return Promise.all(stale.map((f) => {
        const k = videoId + "|" + f;
        if (!_inflight[k]) {
          _inflight[k] = _fetchField(videoId, f).then(
            (r) => { delete _inflight[k]; return r; },
            () => { delete _inflight[k]; return {}; }
          );
        }
        return _inflight[k];
      })).then((parts) => {
        const merged = Object.assign({}, entry);
        for (const part of parts) _merge(merged, part);
        _save(videoId, merged);
        return merged;
      });
    });
  }

  // ---- push path: metadata captured from the player (on play / preview) ----
  // The player reliably yields title + duration once a song is loaded; record them
  // so duration (never pull-able) gets filled and title gets a second, robust source.
  function recordTitle(videoId, title) {
    const clean = sanitize({ title: title });
    if (clean.title === undefined || !validId(videoId)) return Promise.resolve(false);
    return get(videoId).then((c) => { const m = _merge(c || {}, clean); _save(videoId, m); return true; });
  }
  function recordDuration(videoId, durationSec) {
    const clean = sanitize({ durationSec: durationSec });
    if (clean.durationSec === undefined || !validId(videoId)) return Promise.resolve(false);
    return get(videoId).then((c) => { const m = _merge(c || {}, clean); _save(videoId, m); return true; });
  }
  // Combined push: record several player-sourced fields in ONE read-merge-write.
  // recordTitle + recordDuration each do their own get→merge→save, so firing them
  // together raced on the same Store.meta record — the second save (built from a
  // read taken before the first persisted) dropped the first field. Callers with
  // more than one field at once (the player push: title + duration) must use this
  // so neither field clobbers the other.
  function recordMeta(videoId, fields) {
    if (!validId(videoId)) return Promise.resolve(false);
    const clean = sanitize(fields || {});
    if (clean.title === undefined && clean.durationSec === undefined && clean.geo === undefined) return Promise.resolve(false);
    return get(videoId).then((c) => { const m = _merge(c || {}, clean); _save(videoId, m); return true; });
  }

  // ===================== built-in providers (review-only) =====================
  // Their fetch bodies touch the DOM/network and are browser-verified; they are
  // NEVER executed at module load (only object literals are created here).

  // TITLE via oEmbed-JSONP. fetch() injects a <script> pointing at YouTube's oEmbed
  // endpoint with a callback param; oEmbed responds with JS that calls our callback
  // with { title, ... }. Script tags aren't CORS-bound, so this is keyless and
  // serverless, hitting YouTube directly — and youtube.com is already a trusted
  // script-src origin (the IFrame player loads from it), so it adds no new CSP
  // surface. Resolves {} on timeout/error so the chain falls through. (14 §3.)
  let _cbSeq = 0;                                    // monotonic callback-name token (no RNG/clock)
  const oembedTitleProvider = {
    id: "oembed-jsonp",
    fields: ["title"],
    fetch: function (videoId) {
      return new Promise(function (resolve) {
        var cb = "_ddjpOE_" + (++_cbSeq);
        var url = "https://www.youtube.com/oembed?format=json&callback=" + cb +
                  "&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D" + encodeURIComponent(videoId);
        var s = document.createElement("script");
        var done = false;
        function cleanup() { try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (s.parentNode) s.parentNode.removeChild(s); }
        var timer = setTimeout(function () { if (!done) { done = true; cleanup(); resolve({}); } }, 6000);
        window[cb] = function (data) { if (done) return; done = true; clearTimeout(timer); cleanup(); resolve(data && data.title ? { title: data.title } : {}); };
        s.onerror = function () { if (done) return; done = true; clearTimeout(timer); cleanup(); resolve({}); };
        s.src = url;
        (document.head || document.documentElement).appendChild(s);
      });
    },
  };
  registerProvider(oembedTitleProvider);             // built-in: lowest priority (extensions prepend above it)

  // ===================== THUMBNAIL (downscale → Store.images) =================
  // NOT a registry field provider. The registry/ensure() path is for METADATA
  // FIELDS that flow through sanitize() into the per-video Store.meta record
  // (title/duration/geo). A thumbnail is BYTES, and 14 §2 is explicit that
  // thumbnail bytes live SEPARATELY in the bounded A1 image cache (Store.images),
  // never alongside the ids in Store.meta. So the thumbnail path sits BESIDE the
  // registry — exactly like the player push paths (recordTitle/recordDuration),
  // which also bypass the registry because their data doesn't fit the
  // fetch(videoId, field) → sanitized-partial contract. (14 §3b calls thumbnails
  // "a provider whose output routes to Store.images"; this is that, expressed in
  // the shape the bytes actually need.)
  //
  // PURE bits (target-dimension math, the encode-format ladder, the "do we need
  // to fetch?" gate) are exposed for the guard. The fetch/canvas BODY touches the
  // DOM/network and is review-only — never run at module load.

  const THUMB_PX = 120;     // target square thumbnail edge (14 §3: ~96–120px render size)
  // Encode-format ladder: WebP preferred (smaller), JPEG fallback for browsers
  // that don't encode WebP from a canvas. PNG is deliberately absent (lossless =
  // large; defeats the "≈1–2 KB" goal). Pure data so the guard can pin the order.
  const THUMB_ENCODES = [
    { type: "image/webp", quality: 0.8 },
    { type: "image/jpeg", quality: 0.82 },
  ];

  // PURE: the YouTube static thumbnail URL for an id. Keyless, derived from the
  // id alone — i.ytimg.com is an https <img>/<canvas> source the CSP already
  // allows (img-src https:). "hqdefault" exists for effectively every video
  // (unlike maxres), so it's the safe default source to downscale from.
  function thumbUrl(videoId) {
    return validId(videoId) ? ("https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg") : null;
  }

  // PURE: given a source W×H, return the {w,h} to draw at — a square THUMB_PX box,
  // center-cropped (cover), so non-16:9 art isn't stretched. Returns the draw rect
  // INTO the canvas (always THUMB_PX²) plus the source crop rect. Total + safe on
  // junk input (→ a plain THUMB_PX² with no crop). The guard pins the geometry.
  function thumbDrawRect(srcW, srcH) {
    const D = THUMB_PX;
    if (!(srcW > 0) || !(srcH > 0)) return { dw: D, dh: D, sx: 0, sy: 0, sw: D, sh: D };
    // cover: crop the long side so the short side fills the box
    const side = Math.min(srcW, srcH);
    const sx = Math.max(0, Math.round((srcW - side) / 2));
    const sy = Math.max(0, Math.round((srcH - side) / 2));
    return { dw: D, dh: D, sx: sx, sy: sy, sw: side, sh: side };
  }

  // PURE: should we fetch+downscale a thumbnail for this id? No if the id is bad,
  // or if `known` says we already hold it (cache hit anywhere — Store.images, or
  // a list that carries it). The "known" predicate is supplied by the caller (the
  // UI checks Store.images / its lists); keeping it injected keeps this pure and
  // testable, and lets the room-queue "display-only-if-known" rule and My-Queue
  // "fetch-the-gap" rule share one decision.
  function needsThumb(videoId, known) {
    if (!validId(videoId)) return false;
    return !known;
  }

  // ---- review-only: load the ytimg image, downscale to a small blob, store it ---
  // Resolves the stored Blob (also returns it) or null on any failure (CORS taint,
  // load error, encode unsupported, no Store). NEVER throws. Downscale-once: the
  // original is drawn and discarded; only the small variant is persisted. On a
  // tainted canvas (a host that doesn't allow readback) toBlob/toDataURL throw —
  // we catch and resolve null, and the UI falls back to the direct URL (the
  // agreed "prefer stored downscale, else the link" behaviour). `force` skips the
  // known-check (e.g. a future refetch policy); default path checks Store.images.
  function ensureThumb(videoId, opts) {
    opts = opts || {};
    if (!validId(videoId)) return Promise.resolve(null);
    if (typeof document === "undefined" || typeof Image === "undefined") return Promise.resolve(null);
    const imagesOk = (typeof Store !== "undefined" && Store.images);
    const haveCheck = (opts.force || !imagesOk)
      ? Promise.resolve(false)
      : Promise.resolve(Store.images.has(videoId)).catch(() => false);
    return haveCheck.then((have) => {
      if (have) return Store.images.load(videoId).catch(() => null);   // cache hit: reuse bytes
      return _downscaleAndStore(videoId);
    });
  }
  function _downscaleAndStore(videoId) {
    return new Promise(function (resolve) {
      var url = thumbUrl(videoId);
      if (!url) return resolve(null);
      var img = new Image();
      var done = false;
      function finish(v) { if (done) return; done = true; resolve(v); }
      img.crossOrigin = "anonymous";                  // request CORS so the canvas stays readable
      var timer = setTimeout(function () { finish(null); }, 8000);
      img.onerror = function () { clearTimeout(timer); finish(null); };
      img.onload = function () {
        clearTimeout(timer);
        try {
          var rect = thumbDrawRect(img.naturalWidth || img.width, img.naturalHeight || img.height);
          var canvas = document.createElement("canvas");
          canvas.width = rect.dw; canvas.height = rect.dh;
          var ctx = canvas.getContext("2d");
          ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, rect.dw, rect.dh);
          _encodeFirst(canvas, 0, function (blob) {
            if (!blob) return finish(null);            // taint/unsupported → URL fallback in UI
            if (typeof Store !== "undefined" && Store.images) {
              Promise.resolve(Store.images.persist(videoId, blob)).catch(function () {});
            }
            finish(blob);
          });
        } catch (e) { finish(null); }                  // tainted canvas / draw failure → null
      };
      img.src = url;
    });
  }
  // review-only: try each encode in THUMB_ENCODES order; first that yields a blob wins.
  function _encodeFirst(canvas, i, cb) {
    if (i >= THUMB_ENCODES.length) return cb(null);
    var enc = THUMB_ENCODES[i];
    var handled = false;
    try {
      if (canvas.toBlob) {
        canvas.toBlob(function (blob) {
          if (handled) return; handled = true;
          if (blob) cb(blob); else _encodeFirst(canvas, i + 1, cb);
        }, enc.type, enc.quality);
        return;
      }
    } catch (e) { /* tainted canvas throws synchronously → fall through */ }
    cb(null);
  }

  var api = {
    // public API
    registerProvider: registerProvider, get: get, ensure: ensure,
    recordTitle: recordTitle, recordDuration: recordDuration, recordMeta: recordMeta,
    ensureThumb: ensureThumb,
    // exposed for guards (pure decisions)
    sanitize: sanitize, isFresh: isFresh, providersFor: providersFor, validId: validId,
    thumbUrl: thumbUrl, thumbDrawRect: thumbDrawRect, needsThumb: needsThumb,
    THUMB_PX: THUMB_PX, THUMB_ENCODES: THUMB_ENCODES,
  };
  return api;
})();
