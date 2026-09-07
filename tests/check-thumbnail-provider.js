// tests/check-thumbnail-provider.js
// WALL: the thumbnail downscale path (14 §3). Like the title provider, the canvas/
// network BODY is browser-only (review-only), but the DECISIONS it makes MUST hold:
//   - thumbUrl(): keyless ytimg URL, only for a valid id;
//   - thumbDrawRect(): center-crop "cover" geometry into a fixed THUMB_PX² box,
//     total on junk input (this is what stops non-16:9 art from stretching);
//   - the encode ladder is WebP-then-JPEG (smaller-first, no lossless PNG);
//   - needsThumb(): the pure "do we fetch?" gate (bad id / already-known => no);
//   - ensureThumb(): cache-FIRST (a hit reuses bytes, never re-encodes), a miss
//     downscales+stores, a TAINTED canvas resolves null (so the UI falls back to
//     the direct URL), and a bad id / load error never throw.
// metadata.js loads under node: browser globals are touched only inside the fetch
// body, which we drive with hand-rolled fakes (document/Image/canvas/Store.images)
// injected as the module's globals — exercising the REAL code, not a copy.

const { loadInContext } = require("./_load");

// ---- fakes that stand in for the browser + storage --------------------------
let stored = {};            // Store.images backing map (videoId -> blob)
let imgBehaviour = "ok";    // "ok" | "error" | "taint"
let noWebp = false;         // simulate a browser whose canvas can't encode webp
let canvasCalls = 0;        // count downscale work (to prove a cache hit skips it)

const fakeStore = {
  images: {
    has: (id) => Promise.resolve(!!stored[id]),
    load: (id) => Promise.resolve(stored[id] || null),
    persist: (id, blob) => { stored[id] = blob; return Promise.resolve(true); },
  },
  meta: { load: () => Promise.resolve(null), persist: () => Promise.resolve(true) },
};
function FakeImage() {}
Object.defineProperty(FakeImage.prototype, "src", {
  set: function (v) {
    const self = this;
    setTimeout(() => {
      if (imgBehaviour === "error") { if (self.onerror) self.onerror(); return; }
      self.naturalWidth = 480; self.naturalHeight = 360;   // a typical 4:3 hqdefault
      if (self.onload) self.onload();
    }, 0);
  },
});
function makeCanvas() {
  return {
    width: 0, height: 0,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: function (cb, type) {
      if (imgBehaviour === "taint") { throw new Error("tainted canvas"); }   // readback blocked
      if (type === "image/webp" && noWebp) return cb(null);                  // browser can't encode webp
      cb({ size: 1500, type: type });
    },
  };
}
const fakeDocument = { createElement: (t) => { if (t === "canvas") { canvasCalls++; return makeCanvas(); } return {}; } };

const { MetadataService: M } = loadInContext(["features/metadata.js"], {
  Store: fakeStore,
  document: fakeDocument,
  Image: FakeImage,
  URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
  setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise, Math: Math, Date: Date, isFinite: isFinite,
});

let failed = 0;
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[thumbnail] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}
function ok(cond, msg) { if (!cond) { console.log("[thumbnail] FAIL — " + msg); failed++; } }

// ---- thumbUrl: keyless ytimg URL, valid id only ----
ok(M.thumbUrl("dQw4w9WgXcQ") === "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", "thumbUrl is the keyless ytimg hqdefault url");
ok(M.thumbUrl("bad") === null, "thumbUrl(bad id) -> null");
ok(M.thumbUrl(123) === null, "thumbUrl(non-string) -> null");
ok(M.thumbUrl("dQw4w9WgXcQ").indexOf("https://i.ytimg.com/") === 0, "thumbUrl is https + ytimg (CSP img-src https: allows it)");

// ---- thumbDrawRect: center-crop "cover" into THUMB_PX², total on junk ----
const D = M.THUMB_PX;
ok(typeof D === "number" && D > 0, "THUMB_PX is a positive number");
eq(M.thumbDrawRect(480, 360), { dw: D, dh: D, sx: 60, sy: 0, sw: 360, sh: 360 }, "4:3 source -> crop the wider sides, square source rect, square dest");
eq(M.thumbDrawRect(360, 480), { dw: D, dh: D, sx: 0, sy: 60, sw: 360, sh: 360 }, "tall source -> crop top/bottom");
eq(M.thumbDrawRect(200, 200), { dw: D, dh: D, sx: 0, sy: 0, sw: 200, sh: 200 }, "square source -> no crop");
eq(M.thumbDrawRect(0, -5), { dw: D, dh: D, sx: 0, sy: 0, sw: D, sh: D }, "junk dims -> plain THUMB_PX box, no crop (total)");
ok(M.thumbDrawRect(999, 1).dw === D && M.thumbDrawRect(999, 1).dh === D, "dest is always THUMB_PX square");

// ---- encode ladder: WebP first (smaller), JPEG fallback, no lossless PNG ----
ok(Array.isArray(M.THUMB_ENCODES) && M.THUMB_ENCODES.length >= 2, "encode ladder has >=2 entries");
eq(M.THUMB_ENCODES.map((e) => e.type), ["image/webp", "image/jpeg"], "encode order is webp then jpeg");
ok(!M.THUMB_ENCODES.some((e) => e.type === "image/png"), "no lossless PNG in the ladder (would defeat the ~1-2KB goal)");

// ---- needsThumb: the pure fetch gate ----
ok(M.needsThumb("dQw4w9WgXcQ", false) === true, "valid id + not known -> fetch");
ok(M.needsThumb("dQw4w9WgXcQ", true) === false, "valid id + already known -> no fetch (reuse)");
ok(M.needsThumb("bad", false) === false, "bad id -> never fetch");

// ---- ensureThumb: cache-first / miss-downscale / taint / errors -------------
(async () => {
  // cache miss -> downscale to webp -> persist -> return blob
  stored = {}; imgBehaviour = "ok"; noWebp = false; canvasCalls = 0;
  let b = await M.ensureThumb("dQw4w9WgXcQ");
  ok(b && b.type === "image/webp", "miss: downscales to a webp blob");
  ok(canvasCalls === 1, "miss: did exactly one canvas downscale");
  ok(!!stored["dQw4w9WgXcQ"], "miss: the small blob is persisted to Store.images");

  // cache hit -> reuse bytes, NO re-encode
  canvasCalls = 0;
  b = await M.ensureThumb("dQw4w9WgXcQ");
  ok(canvasCalls === 0, "hit: no canvas work (reuses stored bytes — fetch-once)");
  ok(b && b.type === "image/webp", "hit: returns the stored blob");

  // webp unsupported -> JPEG fallback
  stored = {}; noWebp = true;
  b = await M.ensureThumb("dQw4w9WgXcQ");
  ok(b && b.type === "image/jpeg", "webp unsupported -> jpeg fallback");
  noWebp = false;

  // tainted canvas -> null (UI falls back to the direct URL), nothing stored
  stored = {}; imgBehaviour = "taint";
  b = await M.ensureThumb("dQw4w9WgXcQ");
  ok(b === null, "tainted canvas -> null (UI uses the URL fallback)");
  ok(!stored["dQw4w9WgXcQ"], "tainted: nothing persisted");

  // image load error -> null, no throw
  stored = {}; imgBehaviour = "error";
  b = await M.ensureThumb("dQw4w9WgXcQ");
  ok(b === null, "image load error -> null");

  // bad id -> null, no work
  imgBehaviour = "ok"; canvasCalls = 0;
  b = await M.ensureThumb("bad");
  ok(b === null && canvasCalls === 0, "bad id -> null, no fetch/canvas");

  // force:true -> bypass the cache-hit check (the future refetch seam)
  stored = { "dQw4w9WgXcQ": { size: 9, type: "image/webp" } }; canvasCalls = 0;
  b = await M.ensureThumb("dQw4w9WgXcQ", { force: true });
  ok(canvasCalls === 1, "force:true re-downscales despite a cached blob (refetch seam)");

  if (failed) { console.log("[thumbnail] " + failed + " failure(s)"); process.exit(1); }
  console.log("[thumbnail] PASS — keyless ytimg url; center-crop cover geometry (total); webp-then-jpeg ladder; fetch gate; ensureThumb cache-first, miss-downscale, taint->null, errors safe");
  process.exit(0);
})();
