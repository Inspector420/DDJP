// tests/check-metadata-service.js
// SUBJECT: features/metadata.js
// WALL: the pure core of the metadata engine (`main/03-modules.md` §MetadataService). The provider FETCH bodies are
// browser-only (review-only), but the decisions the engine makes MUST hold:
//   - sanitize() is the safety boundary every provider/import output crosses — it
//     must drop/clamp untrusted data and never pass markup through;
//   - isFresh() encodes the per-field freshness law (title/duration permanent, geo
//     kept the device's own expiry, handed in) that decides what gets re-fetched;
//   - the registry resolves providers FIRST-SUCCESS-BY-ORDER, with a registered
//     (extension) provider PREPENDED above the built-ins so it can override them.
// WHERE A SONG IS BLOCKED (J153 (c)), driven on the REAL country table and the REAL device preferences (`core/chatprefs.js`
// over a Store.prefs double), never on stand-ins for either:
//   - the shape `{ blocked | allowed, embeddable, checkedAt }`: codes checked against the table, the shorter form both ways,
//     an empty allowed list kept, `embeddable` true/false/null, a `source` in an answer never read, the older shape still
//     read, no geo at all without the country table;
//   - isFresh's TTL as an argument, at each of the device's four choices (30/60/90/365 days) and at its boundary;
//   - ensure: the expiry read from the device's setting; `checkedAt` and `source` stamped by the lookup path (the caller's
//     time, the provider that answered), never taken from an answer; nothing looked up with the device's switch off, or
//     for no list, or for a list that does not look songs up — while a saved answer is still returned; the first lookup's
//     one line naming each source tried and how it answered, and no second line.
// metadata.js loads under node: browser globals are touched only inside fetch bodies,
// never at load. We give it a Store stub (its cache I/O isn't exercised here).

const { loadInContext } = require("./_load");
const { MetadataService: M } = loadInContext(["core/countries.js", "features/metadata.js"], {
  Store: { meta: { load() { return Promise.resolve(null); }, persist() { return Promise.resolve(true); } } },
});
// A world for the lookup path: the real table, the real preferences over a Store.prefs double, a recording Logger, and a
// Store.meta double holding one record per key.
function world(prefsInit) {
  let prefs = prefsInit ? JSON.parse(JSON.stringify(prefsInit)) : null;
  const recs = {}, lines = [];
  const w = loadInContext(["core/countries.js", "core/chatprefs.js", "features/metadata.js"], {
    Store: {
      meta: { load(k) { return Promise.resolve(recs[k] ? JSON.parse(JSON.stringify(recs[k])) : null); },
              persist(k, r) { recs[k] = JSON.parse(JSON.stringify(r)); return Promise.resolve(true); } },
      prefs: { load() { return prefs; }, save(v) { prefs = JSON.parse(JSON.stringify(v)); } },
    },
    Logger: { info(m) { lines.push(String(m)); }, debug() {}, warn() {}, error() {} },
  });
  return { M: w.MetadataService, P: w.ChatPrefs, recs, lines };
}

let failed = 0;
function eq(got, want, msg) {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) { console.log("[metadata] FAIL — " + msg + "\n      got " + a + "\n      want " + b); failed++; }
}
function ok(cond, msg) { if (!cond) { console.log("[metadata] FAIL — " + msg); failed++; } }

// ---- validId: a song KEY (J29, step 1) — `yt:` + an 11-char YouTube id; the bare id is no longer one ----
ok(M.validId("yt:dQw4w9WgXcQ"), "a YouTube song key is valid");
ok(!M.validId("dQw4w9WgXcQ"), "a bare 11-char id is not a song key (the room and the caches name songs by key)");
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
// ---- where a song is blocked: the shape (J153 (c)) ----
eq(M.sanitize({ geo: { blocked: ["DE", "xx", "FRANCE", "FR", "EU", "ZZ"], embeddable: true, checkedAt: 1000, source: "liar" } }),
   { geo: { blocked: ["DE", "FR"], embeddable: true, checkedAt: 1000 } },
   "geo keeps only the country table's codes (EU and ZZ dropped), reads embeddable, and never reads a source from an answer");
eq(M.sanitize({ geo: { allowed: [] } }), { geo: { allowed: [], embeddable: null, checkedAt: 0 } },
   "an EMPTY allowed list is kept — allowed nowhere, never no restriction; embeddable not said reads null");
eq(M.sanitize({ geo: { blocked: ["DE"], checkedAt: 5 } }), { geo: { blocked: ["DE"], embeddable: null, checkedAt: 5 } },
   "a record in the older shape ({ blocked, checkedAt }) still reads, embeddable null");
eq(M.sanitize({ geo: { blocked: [], embeddable: "yes" } }), { geo: { blocked: [], embeddable: null, checkedAt: 0 } },
   "embeddable is true, false or null — anything else reads null");
eq(M.sanitize({ geo: { blocked: [], embeddable: false } }).geo.embeddable, false, "embeddable false is kept");
const CODES = loadInContext(["core/countries.js"]).Countries.codes();
const MOST = CODES.filter((c) => c !== "DE" && c !== "FR");
eq(M.sanitize({ geo: { blocked: MOST } }).geo, { allowed: ["DE", "FR"], embeddable: null, checkedAt: 0 },
   "a blocked list longer than the rest is kept as the allowed rest (the shorter form)");
eq(M.sanitize({ geo: { allowed: MOST } }).geo, { blocked: ["DE", "FR"], embeddable: null, checkedAt: 0 },
   "an allowed list longer than the rest is kept as the blocked rest (the shorter form)");
eq(M.sanitize({ geo: { blocked: "DE" } }), {}, "geo with a non-array list -> no geo");
eq(M.sanitize({ geo: { blocked: ["DE"], allowed: ["FR"] } }), {}, "geo with BOTH lists -> no geo (exactly one)");
eq(M.sanitize({ geo: {} }), {}, "geo with neither list -> no geo");
{
  const { MetadataService: M0 } = loadInContext(["features/metadata.js"], { Store: { meta: { load() { return Promise.resolve(null); }, persist() { return Promise.resolve(true); } } } });
  eq(M0.sanitize({ geo: { blocked: ["DE"] } }), {}, "without the country table no list can be checked, so no geo passes (fail closed)");
  eq(M0.sanitize({ title: "x" }), { title: "x" }, "CONTROL — without the country table a title still passes");
}
eq(M.sanitize({ evil: "<script>", fn: function () {} }), {}, "unknown/dangerous fields dropped");
eq(M.sanitize(null), {}, "null input -> {} (no throw)");
ok(M.sanitize({ title: "<img src=x onerror=alert(1)>" }).title.indexOf("<") >= 0
   && typeof M.sanitize({ title: "<b>" }).title === "string", "markup kept as PLAIN TEXT (callers render as textContent, never HTML)");

// ---- isFresh: per-field freshness law ----
ok(M.isFresh("title", { title: "x" }, 0), "title present -> fresh (permanent)");
ok(!M.isFresh("title", {}, 0), "title absent -> stale");
ok(M.isFresh("durationSec", { durationSec: 1 }, 0), "duration present -> fresh (permanent)");
const DAY = 24 * 60 * 60 * 1000, now = 1000 * DAY;
// the TTL is an argument: each of the device's four choices, and its boundary
for (const d of [30, 60, 90, 365]) {
  const ttl = d * DAY;
  ok(M.isFresh("geo", { geo: { blocked: [], checkedAt: now - ttl + 1 } }, now, ttl), "geo one ms inside " + d + " days -> fresh");
  ok(!M.isFresh("geo", { geo: { blocked: [], checkedAt: now - ttl } }, now, ttl), "geo exactly " + d + " days old -> stale");
}
ok(!M.isFresh("geo", { geo: { blocked: [], checkedAt: now - 100 * DAY } }, now, 90 * DAY), "geo 100 days old -> stale at 90 days");
ok(M.isFresh("geo", { geo: { blocked: [], checkedAt: now - 100 * DAY } }, now, 365 * DAY), "geo 100 days old -> fresh at 365 days");
ok(!M.isFresh("geo", { geo: { blocked: [], checkedAt: now - 10 * DAY } }, now), "geo with NO TTL handed in -> stale (asks again, never keeps forever)");
ok(!M.isFresh("geo", { geo: { blocked: [] } }, now, 90 * DAY), "geo without checkedAt -> stale");
ok(M.isFresh("geo", { geo: { allowed: ["DE"], checkedAt: now - DAY, source: "proxynova" } }, now, 30 * DAY)
   && M.isFresh("geo", { geo: { allowed: ["DE"], checkedAt: now - DAY, source: "another" } }, now, 30 * DAY),
   "an answer is fresh whichever source gave it (the owner's \"trust old provider takes\")");

// ---- registry: first-success-by-order, extension prepends above built-ins ----
ok(M.providersFor("title").length >= 1, "built-in title provider (oembed) registered");
let calls = [];
M.registerProvider({ id: "ext", fields: ["title"], fetch(v) { calls.push("ext"); return Promise.resolve({ title: "from-ext" }); } });
const chain = M.providersFor("title");
eq(chain[0].id, "ext", "a registered provider is PREPENDED (tried before built-ins)");
ok(chain[chain.length - 1].id === "oembed-jsonp", "the built-in remains as fallback");

// ---- first-success: the prepended provider wins; later ones aren't consulted ----
(async () => {
  const merged = await M.ensure("yt:dQw4w9WgXcQ", ["title"], now);
  eq(merged.title, "from-ext", "ensure() uses the first successful provider (the prepended one)");

  // ---- where a song is blocked: the lookup path (J153 (c)), on the real preferences ----
  const SONG = "yt:dQw4w9WgXcQ";
  {
    const W = world();
    let calls = 0;
    W.M.registerProvider({ id: "bad", name: "Bad", fields: ["geo"], fetch() { calls++; return Promise.reject(new Error("HTTP 403")); } });
    W.M.registerProvider({ id: "good", name: "Good", fields: ["geo"], fetch() { calls++; return Promise.resolve({ geo: { blocked: ["DE"], checkedAt: 5, source: "liar" } }); } });
    // 'good' was registered last -> prepended -> tried first; it succeeds.
    const g = await W.M.ensure(SONG, ["geo"], now, { list: "mine" });
    eq(g.geo && g.geo.blocked, ["DE"], "ensure() resolves geo via a registered provider");
    ok(g.geo && g.geo.checkedAt === now, "checkedAt is the lookup's own time, never the answer's", g.geo);
    ok(g.geo && g.geo.source === "good", "source is the provider that answered, never the answer's own claim", g.geo);
    ok(W.recs[SONG] && W.recs[SONG].geo && W.recs[SONG].geo.source === "good", "the stamped answer is what is saved beside the song");
    ok(W.lines.length === 1 && /first lookup of where a song is blocked/.test(W.lines[0]) && /Good answered/.test(W.lines[0]),
      "the first lookup of a page logs ONE line naming the source and how it answered", W.lines);
    // fresh by the device's expiry: no second call
    const before = calls;
    await W.M.ensure(SONG, ["geo"], now + DAY, { list: "mine" });
    ok(calls === before, "a saved answer inside the device's expiry is not asked again", { calls: calls, before: before });
    // the device's expiry decides: 100 days later, stale at 90, fresh at 365
    W.P.setGeoRecheckDays(365);
    await W.M.ensure(SONG, ["geo"], now + 100 * DAY, { list: "mine" });
    ok(calls === before, "at 365 days, a 100-day-old answer is kept (the expiry is the device's setting, read at the lookup)");
    W.P.setGeoRecheckDays(90);
    await W.M.ensure(SONG, ["geo"], now + 100 * DAY, { list: "mine" });
    ok(calls === before + 1, "at 90 days, a 100-day-old answer is asked again", { calls: calls, before: before });
    ok(W.lines.length === 1, "no second first-lookup line", W.lines);
  }
  {
    // a failing first source falls through, and the line names both
    const W = world();
    W.M.registerProvider({ id: "good", name: "Good", fields: ["geo"], fetch() { return Promise.resolve({ geo: { allowed: ["FR"] } }); } });
    W.M.registerProvider({ id: "bad", name: "Bad", fields: ["geo"], fetch() { return Promise.reject(new Error("HTTP 403")); } });
    const g = await W.M.ensure(SONG, ["geo"], now, { list: "room" });
    ok(g.geo && g.geo.source === "good" && JSON.stringify(g.geo.allowed) === JSON.stringify(["FR"]), "a refusing first source falls through to the next", g.geo);
    ok(W.lines.length === 1 && /Bad refused \(HTTP 403\)/.test(W.lines[0]) && /Good answered/.test(W.lines[0]),
      "the first-lookup line names each source tried, in order, and how each answered", W.lines);
  }
  {
    // only a source's own short word reaches the line: an error whose text names an address (and a key) logs "failed"
    const W = world();
    W.M.registerProvider({ id: "leaky", name: "Leaky", fields: ["geo"], fetch() { return Promise.reject(new Error("GET https://h.example/x?id=1&key=AIza" + "Z".repeat(35) + " failed")); } });
    W.M.registerProvider({ id: "word", name: "Word", fields: ["geo"], fetch() { return Promise.reject(new Error("HTTP 429")); } });
    await W.M.ensure(SONG, ["geo"], now, { list: "room" });
    ok(W.lines.length === 1 && /Word refused \(HTTP 429\), Leaky refused \(failed\)/.test(W.lines[0]) && !/https?:|key=|AIza/.test(W.lines[0]),
      "a source's failure reaches the line as its short word (\"HTTP 429\"), and an error's own text — an address, a key — never does", W.lines);
  }
  {
    // the switch, checked once inside ensure; the list; a saved answer still returned
    const W = world();
    let calls = 0;
    W.M.registerProvider({ id: "good", fields: ["geo"], fetch() { calls++; return Promise.resolve({ geo: { blocked: ["DE"] } }); } });
    await W.M.ensure(SONG, ["geo"], now, { list: "room" });
    ok(calls === 1, "CONTROL — with the switch on and a list, the lookup is made", calls);
    W.P.setGeoLookup(false);
    const off = await W.M.ensure(SONG, ["geo"], now + 400 * DAY, { list: "room" });
    ok(calls === 1, "the device's switch OFF: nothing is looked up, whoever asks", calls);
    ok(off.geo && off.geo.source === "good", "the switch off still returns the saved answer");
    W.P.setGeoLookup(true);
    for (const ask of [undefined, {}, { list: "history" }, { list: "nowPlaying" }]) {
      await W.M.ensure(SONG, ["geo"], now + 400 * DAY, ask);
      ok(calls === 1, "no lookup for " + JSON.stringify(ask) + " — only the room queue, My queue and a playlist look songs up", calls);
    }
    await W.M.ensure(SONG, ["geo"], now + 400 * DAY, { list: "playlist" });
    ok(calls === 2, "CONTROL — the same stale answer, asked for a playlist, is looked up", calls);
    eq(W.M.GEO_LISTS, ["room", "mine", "playlist"], "the lists that look songs up are the room queue, My queue and a playlist");
  }
  {
    // no preferences module: nothing is looked up (a device that cannot read its own switch asks nothing)
    let calls = 0;
    const { MetadataService: M3 } = loadInContext(["core/countries.js", "features/metadata.js"], {
      Store: { meta: { load() { return Promise.resolve(null); }, persist() { return Promise.resolve(true); } } } });
    M3.registerProvider({ id: "good", fields: ["geo"], fetch() { calls++; return Promise.resolve({ geo: { blocked: ["DE"] } }); } });
    await M3.ensure(SONG, ["geo"], now, { list: "room" });
    ok(calls === 0, "with no preferences module, nothing is looked up", calls);
  }

  // ---- recordMeta: title + duration in ONE write (the player-push no-clobber fix) ----
  // recordTitle and recordDuration each did their own get→merge→save; fired together
  // (as the player push does) they raced on the same record and the title kept getting
  // clobbered. recordMeta is a single read-merge-write, so a push carrying both fields
  // keeps both, and a later single-field push merges onto — never erases — the rest.
  let saved = null;
  const { MetadataService: M2 } = loadInContext(["features/metadata.js"], {
    Store: { meta: { load() { return Promise.resolve(saved); }, persist(id, rec) { saved = rec; return Promise.resolve(true); } } },
  });
  await M2.recordMeta("yt:dQw4w9WgXcQ", { title: "Song Name", durationSec: 192 });
  ok(saved && saved.title === "Song Name" && saved.durationSec === 192,
     "recordMeta persists title AND duration in one record (no clobber)");
  await M2.recordMeta("yt:dQw4w9WgXcQ", { durationSec: 200 });
  ok(saved && saved.title === "Song Name" && saved.durationSec === 200,
     "a later single-field recordMeta merges onto the record (title survives)");

  if (failed) { console.log("[metadata] " + failed + " failure(s)"); process.exit(1); }
  console.log("[metadata] PASS — sanitize boundary clamps/drops untrusted data; per-field freshness (title/duration permanent, geo kept the device's own expiry); where a song is blocked: the shape, codes checked against the table, the shorter form, stamps from the lookup path, the switch and the lists; registry is first-success-by-order with extensions prepended");
  process.exit(0);
})();
