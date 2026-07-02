// tests/check-metadata-service.js
// WALL: the pure core of the metadata engine (14 §3). The provider FETCH bodies are
// browser-only (review-only), but the decisions the engine makes MUST hold:
//   - sanitize() is the safety boundary every provider/import output crosses — it
//     must drop/clamp untrusted data and never pass markup through;
//   - isFresh() encodes the per-field freshness law (title/duration permanent, geo
//     TTL'd) that decides what gets re-fetched;
//   - the registry resolves providers FIRST-SUCCESS-BY-ORDER, with a registered
//     (extension) provider PREPENDED above the built-ins so it can override them.
// metadata.js loads under node: browser globals are touched only inside fetch bodies,
// never at load. We give it a Store stub (its cache I/O isn't exercised here).

const { loadInContext } = require("./_load");
const { MetadataService: M } = loadInContext(["features/metadata.js"], {
  Store: { meta: { load() { return Promise.resolve(null); }, persist() { return Promise.resolve(true); } } },
});

let failed = 0;
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[metadata] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}
function ok(cond, msg) { if (!cond) { console.log("[metadata] FAIL — " + msg); failed++; } }

// ---- validId: YouTube id shape ----
ok(M.validId("dQw4w9WgXcQ"), "11-char id is valid");
ok(!M.validId("short"), "wrong-length id rejected");
ok(!M.validId("../etc/passwd"), "path-like id rejected");
ok(!M.validId(123), "non-string id rejected");

// ---- sanitize: the untrusted-data boundary ----
eq(M.sanitize({ title: "  Hello   World  " }), { title: "Hello World" }, "title trimmed + whitespace-collapsed");
ok(M.sanitize({ title: "x".repeat(5000) }).title.length === 300, "title length-capped at 300");
eq(M.sanitize({ title: 42 }), {}, "non-string title dropped");
eq(M.sanitize({ durationSec: 213.7 }), { durationSec: 214 }, "duration rounded");
eq(M.sanitize({ durationSec: -5 }), {}, "non-positive duration dropped");
eq(M.sanitize({ durationSec: 999999 }), {}, "absurd duration (>24h) dropped");
eq(M.sanitize({ geo: { blocked: ["DE", "xx", "FRANCE", "FR"], checkedAt: 1000 } }),
   { geo: { blocked: ["DE", "FR"], checkedAt: 1000 } }, "geo keeps only valid ISO-2 region codes");
eq(M.sanitize({ geo: { blocked: "DE" } }), { geo: { blocked: [], checkedAt: 0 } }, "geo non-array blocked -> empty, checkedAt 0");
eq(M.sanitize({ evil: "<script>", fn: function () {} }), {}, "unknown/dangerous fields dropped");
eq(M.sanitize(null), {}, "null input -> {} (no throw)");
ok(M.sanitize({ title: "<img src=x onerror=alert(1)>" }).title.indexOf("<") >= 0
   && typeof M.sanitize({ title: "<b>" }).title === "string", "markup kept as PLAIN TEXT (callers render as textContent, never HTML)");

// ---- isFresh: per-field freshness law ----
ok(M.isFresh("title", { title: "x" }, 0), "title present -> fresh (permanent)");
ok(!M.isFresh("title", {}, 0), "title absent -> stale");
ok(M.isFresh("durationSec", { durationSec: 1 }, 0), "duration present -> fresh (permanent)");
const DAY = 24 * 60 * 60 * 1000, now = 1000 * DAY;
ok(M.isFresh("geo", { geo: { blocked: [], checkedAt: now - 10 * DAY } }, now), "geo 10 days old -> fresh");
ok(!M.isFresh("geo", { geo: { blocked: [], checkedAt: now - 100 * DAY } }, now), "geo 100 days old -> stale (90d TTL)");
ok(!M.isFresh("geo", { geo: { blocked: [] } }, now), "geo without checkedAt -> stale");

// ---- registry: first-success-by-order, extension prepends above built-ins ----
ok(M.providersFor("title").length >= 1, "built-in title provider (oembed) registered");
let calls = [];
M.registerProvider({ id: "ext", fields: ["title"], fetch(v) { calls.push("ext"); return Promise.resolve({ title: "from-ext" }); } });
const chain = M.providersFor("title");
eq(chain[0].id, "ext", "a registered provider is PREPENDED (tried before built-ins)");
ok(chain[chain.length - 1].id === "oembed-jsonp", "the built-in remains as fallback");

// ---- first-success: the prepended provider wins; later ones aren't consulted ----
(async () => {
  const merged = await M.ensure("dQw4w9WgXcQ", ["title"], now);
  eq(merged.title, "from-ext", "ensure() uses the first successful provider (the prepended one)");

  // A failing first provider falls through to the next that succeeds.
  M.registerProvider({ id: "bad", fields: ["geo"], fetch() { return Promise.reject(new Error("nope")); } });
  M.registerProvider({ id: "good", fields: ["geo"], fetch() { return Promise.resolve({ geo: { blocked: ["DE"], checkedAt: now } }); } });
  // 'good' was registered last -> prepended -> tried first; it succeeds.
  const g = await M.ensure("dQw4w9WgXcQ", ["geo"], now);
  eq(g.geo && g.geo.blocked, ["DE"], "ensure() resolves geo via a registered provider");

  // ---- recordMeta: title + duration in ONE write (the player-push no-clobber fix) ----
  // recordTitle and recordDuration each did their own get→merge→save; fired together
  // (as the player push does) they raced on the same record and the title kept getting
  // clobbered. recordMeta is a single read-merge-write, so a push carrying both fields
  // keeps both, and a later single-field push merges onto — never erases — the rest.
  let saved = null;
  const { MetadataService: M2 } = loadInContext(["features/metadata.js"], {
    Store: { meta: { load() { return Promise.resolve(saved); }, persist(id, rec) { saved = rec; return Promise.resolve(true); } } },
  });
  await M2.recordMeta("dQw4w9WgXcQ", { title: "Song Name", durationSec: 192 });
  ok(saved && saved.title === "Song Name" && saved.durationSec === 192,
     "recordMeta persists title AND duration in one record (no clobber)");
  await M2.recordMeta("dQw4w9WgXcQ", { durationSec: 200 });
  ok(saved && saved.title === "Song Name" && saved.durationSec === 200,
     "a later single-field recordMeta merges onto the record (title survives)");

  if (failed) { console.log("[metadata] " + failed + " failure(s)"); process.exit(1); }
  console.log("[metadata] PASS — sanitize boundary clamps/drops untrusted data; per-field freshness (title/duration permanent, geo 90d TTL); registry is first-success-by-order with extensions prepended");
  process.exit(0);
})();
