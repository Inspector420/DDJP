// features/metadata.js — MetadataService
//
// ONE monolith module with MODULAR internals. It owns the POLICY — the per-video
// metadata cache (Store.meta + Store.images), the per-field freshness rules
// (title/duration permanent, geo TTL'd), in-flight dedup, and the untrusted-output
// sanitization boundary — and a PROVIDER REGISTRY for the MECHANISM (how a field is
// actually fetched). Built-in providers ship here; an extension or a code edit calls
// registerProvider() to add another. New providers are PREPENDED, so a custom or
// "unsupported" fetcher is tried before the built-ins (FIRST-SUCCESS-BY-ORDER), with
// the built-ins remaining as fallback. (`main/03-modules.md` §MetadataService.)
//
// KEYED BY THE SONG'S KEY (J29, step 1). Every `songKey` here is a song key (`yt:` + YouTube's
// id, `core/songs.js`), and so are the caches' keys. What a service's own id looks like, its
// picture, its title lookup and where its songs are blocked (its region sources) are asked of
// `Songs` at the one door each is needed — this file keeps no copy of any service's rule or
// address, and names no service.
//
// The safety line: a provider returns DATA, NOT TRUST. Every provider's output
// (built-in, extension, or imported file) passes the SAME sanitize() boundary —
// the song key checked, strings length-capped and kept as plain text (callers
// render as textContent, never markup), durations/regions range-checked, unknown
// fields dropped, nothing executed. A sketchy fetcher can make a title WRONG; it can
// never make it DANGEROUS.
//
// Layering: a feature (depends on Store and Songs — Songs at load, for its region sources; used
// by the UI). Pure decision helpers
// (sanitize / isFresh / providersFor / validId) are exposed for the guard. The async
// fetch loop + cache I/O are thin glue; the built-in provider FETCH bodies touch the
// DOM/network and are review-only (browser-verified), never run at load.
const MetadataService = (function () {
  "use strict";

  const MAX_TITLE  = 300;                          // cap untrusted title length
  const DAY_MS     = 24 * 60 * 60 * 1000;
  // How long a saved answer about where a song is blocked is used: the device's own setting (`ChatPrefs.geoRecheckDays`,
  // J153 (c)), read at each lookup — never a number of this file's.

  // A song key of a service `Songs` knows; nothing else is fetched, cached or drawn.
  function validId(songKey) { return Songs.isKey(songKey); }

  // ---- PURE: the sanitization boundary (all provider/import output passes here) --
  // Returns a cleaned partial { title?, durationSec?, geo? }; drops anything that
  // doesn't validate; never throws; never returns markup.
  // WHERE A SONG IS BLOCKED (`geo`, J153 (c)): `{ blocked | allowed, embeddable, checkedAt }`. Exactly one list, its codes
  // checked against the country table and kept in the shorter form — `Countries.regionList`, the one rule both boundaries
  // call (`core/playlistdoc.js` `sanitizeMeta` is the other); an empty `allowed` means allowed nowhere. `embeddable` is
  // true, false, or null when the source does not say. `checkedAt` is a time this device's clock wrote. `source` is NOT read
  // from here: it is the provider that answered, written by `_fetchField` after this boundary, never taken from an answer.
  // A record in the older shape (`{ blocked, checkedAt }`) reads as it always did, `embeddable` null. Without the country
  // table no list can be checked, so no `geo` passes.
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
      const list = (typeof Countries !== "undefined" && Countries.regionList) ? Countries.regionList(raw.geo) : null;
      if (list) {
        const e = raw.geo.embeddable;
        list.embeddable = (e === true || e === false) ? e : null;
        list.checkedAt = (typeof raw.geo.checkedAt === "number" && isFinite(raw.geo.checkedAt)) ? raw.geo.checkedAt : 0;
        out.geo = list;
      }
    }
    return out;
  }

  // ---- PURE: is a field fresh enough to skip re-fetching? nowMs is passed IN (the
  // clock lives in transport; callers supply the time). ----
  // `geo` is kept `ttlMs` (the device's setting, which `ensure` reads and hands in): without a TTL it is never fresh, so a
  // caller that forgot one asks again rather than keeping an answer forever. Whichever source answered, the answer stands
  // until it expires (the owner's "trust old provider takes"): `source` is not read here.
  function isFresh(field, entry, nowMs, ttlMs) {
    if (!entry || typeof entry !== "object") return false;
    if (field === "title")       return typeof entry.title === "string" && entry.title.length > 0;   // permanent
    if (field === "durationSec") return typeof entry.durationSec === "number";                        // permanent
    if (field === "geo") {
      if (!entry.geo || typeof entry.geo !== "object") return false;
      if (!(typeof ttlMs === "number" && ttlMs > 0)) return false;
      const at = (typeof entry.geo.checkedAt === "number") ? entry.geo.checkedAt : 0;
      return (typeof nowMs === "number") && (nowMs - at) < ttlMs;                                       // TTL'd
    }
    return false;
  }

  // ---- provider registry (first-success-by-order) ----
  // A provider: { id, fields: ["title"|"geo"|...], fetch(songKey, field) -> partial }
  // A `geo` provider may also carry `name` (what the log calls it), `ready(songKey)` (false: it skips itself, uncounted —
  // a source that needs a key this device does not hold, any source for a song not its service's) and `dailyIds` (its daily
  // limit on this device: at the limit it is skipped, J153 (c)).
  const _providers = [];                             // ordered; index 0 tried first
  function registerProvider(p) {                     // extensions PREPEND -> override built-ins
    if (p && typeof p.fetch === "function" && Array.isArray(p.fields)) _providers.unshift(p);
    return api;
  }
  // PURE: providers that declare `field`, in priority order.
  function providersFor(field) {
    return _providers.filter((p) => p && Array.isArray(p.fields) && p.fields.indexOf(field) >= 0);
  }

  // ---- WHERE SONGS ARE BLOCKED: THE ONE LOOKUP PATH (J153 (c), the owner's) ----
  // Every device lookup of where a song is blocked goes through `ensure` → `_fetchField` (or, for the bot's whole room queue,
  // `fetchMany`, below: the same rules, several songs to a call where a source takes them), and so do its rules:
  //   · ONLY WHILE THE DEVICE SAYS SO (`ChatPrefs.geoLookup`, on by default), and only for a song on one of the lists that
  //     look songs up — the room queue, My queue, a playlist (`GEO_LISTS`; his "only songs that are being looked at in the
  //     UI"). History and the song playing are drawn from saved answers and never ask. Checked here, once, for every caller.
  //   · AN ANSWER IS KEPT until the device's own expiry (`ChatPrefs.geoRecheckDays`), whichever source gave it.
  //   · THE SOURCES IN ORDER, falling through (his "if youtube api use first, then make bowth proxy nova and indivious work
  //     with fallback"): the registry's own first-success-by-order. A source with no key skips itself, uncounted.
  //   · COUNTED, ready for a daily budget later (his "ready to later prioritize api usages … per 24h calls"): each call to a
  //     source, and the songs it asked about, by the list that asked, per hour, on this device (`ChatPrefs.geoCountAdd`). A
  //     source with a daily limit (`dailyIds`) is skipped once this device has asked it that many songs in the last day.
  //   · THE FIRST LOOKUP OF A PAGE logs one line naming each source it tried and how each answered — a live check reads it
  //     (L5). No line names a request's address: a source's address can carry the person's key.
  //   · THE DEVICE'S ORDER (J153 (d), his "auto fallback and lets you pick a favorite"): its favourite first, then the rest in
  //     the table's order while auto fallback is on, the favourite alone while it is off — one rule, `Songs.regionOrder`, over
  //     this device's choices (`ChatPrefs`); the card reads the same rule.
  //   · A SOURCE THAT IS DOWN IS SKIPPED (J153 (d), his "check if the service is down and self switch if it is"): below.
  const GEO_LISTS = ["room", "mine", "playlist"];
  const HOUR_MS = 60 * 60 * 1000;
  let _firstGeoSaid = false;
  function _prefs() { return (typeof ChatPrefs !== "undefined") ? ChatPrefs : null; }
  // No preferences module, no lookups: a device that cannot read its own switch asks nothing.
  function _geoOn() { try { const p = _prefs(); return !!(p && p.geoLookup && p.geoLookup() === true); } catch (e) { return false; } }
  function _geoTtlMs() {
    try { const p = _prefs(); const d = (p && p.geoRecheckDays) ? p.geoRecheckDays() : null; return (typeof d === "number" && d > 0) ? d * DAY_MS : null; }
    catch (e) { return null; }
  }
  function _geoName(p) { return (p && typeof p.name === "string" && p.name) ? p.name : String(p && p.id); }
  // The songs this device asked `p` about in the last day (25 whole hours, so never less than a day), over every list.
  function _idsToday(p, nowMs) {
    const p2 = _prefs();
    if (!p2 || !p2.geoCountRows) return 0;
    const hour = Math.floor(nowMs / HOUR_MS);
    const span = (typeof p2.GEO_COUNT_HOURS === "number") ? p2.GEO_COUNT_HOURS : 25;
    let n = 0;
    for (const r of p2.geoCountRows()) if (r.source === p.id && r.hour > hour - span && r.hour <= hour) n += r.ids;
    return n;
  }
  function _count(p, list, ids, nowMs) {
    try { const p2 = _prefs(); if (p2 && p2.geoCountAdd) p2.geoCountAdd(p.id, list, ids, Math.floor(nowMs / HOUR_MS)); } catch (e) {}
  }
  function _sayFirst(songKey, tried) {
    if (_firstGeoSaid || !tried.length) return;     // a song no source answers for (not YouTube's) asked nobody: not the first
    _firstGeoSaid = true;
    try {
      if (typeof Logger !== "undefined") {
        Logger.info("Metadata: first lookup of where a song is blocked (" + songKey + ") — " + tried.join(", "));
      }
    } catch (e) {}
  }

  // ---- A SOURCE THAT IS DOWN (J153 (d); the supervisor's numbers at `ddjp_725`) ----
  // A source whose calls FAIL `DOWN_AFTER` times in a row — a refusal, an error, a timeout — is down: skipped, uncounted, for
  // `DOWN_MS`, then asked again. A call that comes back, with an answer or with none, is the source answering, and starts
  // the count over: "no answer for this song" is not down. One log line when it goes down, naming it, and one when it is asked
  // again. The thumbnail pump's back-off, per source (`ui/playlists.js` `THUMB_BACKOFF_HITS`). Kept in memory, per page.
  // THE DEVICE'S OWN CLOCK, SET AND READ HERE ONLY: the callers hand in different clocks (a screen its own, the bot the
  // server's), so a window stamped by one and read by the other would mix them (`main/09-roadmap.md` P2). This is patience,
  // not room time. The guard sets the clock (`_setClockForTest`).
  const DOWN_AFTER = 3;
  const DOWN_MS = 10 * 60 * 1000;
  let _clock = () => Date.now();
  const _health = Object.create(null);           // source id -> { fails, until }
  function _say(level, m) { try { if (typeof Logger !== "undefined" && Logger[level]) Logger[level]("Metadata: " + m); } catch (e) {} }
  function _isDown(p) {
    const h = _health[p.id];
    if (!h || !h.until) return false;
    if (_clock() < h.until) return true;
    h.until = 0; h.fails = 0;
    _say("info", _geoName(p) + " is asked again: its " + Math.round(DOWN_MS / 60000) + " minutes down are over");
    return false;
  }
  function _failed(p) {
    const h = _health[p.id] || (_health[p.id] = { fails: 0, until: 0 });
    if (h.until) return;                           // already down: a call in flight when it went down
    if (++h.fails >= DOWN_AFTER) {
      h.until = _clock() + DOWN_MS;
      _say("warn", _geoName(p) + " is down — " + DOWN_AFTER + " failures in a row; not asked for " + Math.round(DOWN_MS / 60000) + " minutes");
    }
  }
  function _answered(p) { const h = _health[p.id]; if (h && !h.until) h.fails = 0; }
  // The sources down now, by name, in the table's order (for `geoStatus`).
  function _downNames() { return providersFor("geo").filter((p) => _isDown(p)).map(_geoName); }
  // THE PROVIDERS ONE SONG'S SERVICE ASKS, IN THIS DEVICE'S ORDER: the song table's one rule (`Songs.regionOrder`) over this
  // device's choices (`ChatPrefs.geoChoices`), the reading the card makes too. A provider built from the table carries its
  // service (`short`); one an extension registered carries none and keeps the registry's rule, before the table's, while
  // auto fallback is on. No preferences module: the table's order, fallback on, no key.
  function _geoChain(short) {
    const all = providersFor("geo");
    let choices = { favourite: "", fallback: true, keyHeld: false };
    try { const p2 = _prefs(); if (p2 && p2.geoChoices) choices = p2.geoChoices(short); } catch (e) {}
    const fallback = !(choices && choices.fallback === false);
    let plan = { ids: [] };
    try { plan = Songs.regionOrder(short, choices); } catch (e) { plan = { ids: [] }; }
    const byId = {};
    for (const p of all) if (p && p.short === short) byId[p.id] = p;
    const table = plan.ids.map((id) => byId[id]).filter(Boolean);
    const ext = fallback ? all.filter((p) => p && typeof p.short !== "string") : [];
    return ext.concat(table);
  }

  // ---- async: fetch one field via the first provider that succeeds ----
  // For `geo`, the answer is stamped here, after the boundary: `checkedAt` is the caller's time and `source` the provider
  // that answered, so neither is ever taken from an answer.
  function _fetchField(songKey, field, nowMs, list) {
    if (!validId(songKey)) return Promise.resolve({});
    const geo = field === "geo";                     // asked only by `ensure`, which has checked the switch, the list and nowMs
    const chain = geo ? _geoChain(Songs.serviceOf(songKey)) : providersFor(field);
    const tried = [];
    let i = 0;
    function next() {
      if (i >= chain.length) { if (geo) _sayFirst(songKey, tried); return Promise.resolve({}); }
      const p = chain[i++];
      if (geo) {
        let ready = true;
        try { ready = (typeof p.ready !== "function") || p.ready(songKey) === true; } catch (e) { ready = false; }
        if (!ready) return next();                                          // skips itself, uncounted
        if (_isDown(p)) { tried.push(_geoName(p) + " down"); return next(); }   // skipped, uncounted
        if (typeof p.dailyIds === "number" && _idsToday(p, nowMs) >= p.dailyIds) { tried.push(_geoName(p) + " at its daily limit"); return next(); }
        _count(p, list, 1, nowMs);
      }
      return Promise.resolve().then(() => p.fetch(songKey, field)).then((raw) => {
        if (geo) _answered(p);                       // it came back: answering, whatever it said
        const clean = sanitize(raw);                 // every provider's output is untrusted
        if (clean[field] !== undefined) {            // first success wins
          if (geo) { clean.geo.checkedAt = nowMs; clean.geo.source = String(p.id); tried.push(_geoName(p) + " answered"); _sayFirst(songKey, tried); }
          return clean;
        }
        if (geo) tried.push(_geoName(p) + " gave no answer");
        return next();
      }).catch((e) => {                              // a failing provider falls through
        // Only a source's own short word reaches the line, never an error's text, which could hold the address (and a key).
        if (geo) { tried.push(_geoName(p) + " refused (" + ((e && /^(HTTP \S{1,8}|timed out|network error)$/.test(e.message)) ? e.message : "failed") + ")"); _failed(p); }
        return next();
      });
    }
    return next();
  }

  // ---- cache + dedup + policy ----
  const _inflight = {};                              // "songKey|field" -> Promise (dedup)
  function get(songKey) {                            // cached metadata only — no fetch
    return (typeof Store !== "undefined" && Store.meta) ? Store.meta.load(songKey) : Promise.resolve(null);
  }
  function _merge(into, part) {
    if (part.title !== undefined)       into.title = part.title;
    if (part.durationSec !== undefined) into.durationSec = part.durationSec;
    if (part.geo !== undefined)         into.geo = part.geo;
    return into;
  }
  function _save(songKey, rec) { if (typeof Store !== "undefined" && Store.meta) Store.meta.persist(songKey, rec); }
  // ---- SYNC: this session's saved answer of where a song is blocked, or null (J153 (c)) ----
  // For the readers that cannot wait: YouTube's player file, choosing between the room's two counting reasons at the
  // moment a song fails (`ui/youtube.js` `reasonFor`), and a song row's globe and Region Blocks (`ui/playlists.js`). Read
  // from `Store.meta.peek` — null means "not loaded this session", never "blocked nowhere" — and handed back through the
  // boundary, so the caller gets the shape and nothing else. THE SOURCE THAT ANSWERED COMES BACK TOO (`ddjp_729`: Region
  // Blocks says "checked … (ProxyNova)"): the boundary does not read it, since `_fetchField` writes it after the boundary, so
  // it is handed back here only when it is one of the song's own service's region sources in the song table — never a word
  // the store holds that the table does not.
  function heldGeo(songKey) {
    if (!validId(songKey) || typeof Store === "undefined" || !Store.meta || typeof Store.meta.peek !== "function") return null;
    let rec = null;
    try { rec = Store.meta.peek(songKey); } catch (e) { rec = null; }
    if (!rec || !rec.geo || typeof rec.geo !== "object") return null;
    const geo = sanitize({ geo: rec.geo }).geo || null;
    if (geo && typeof rec.geo.source === "string") {
      const sh = Songs.serviceOf(songKey);
      if (_sources.some((x) => x.short === sh && x.id === rec.geo.source)) geo.source = rec.geo.source;
    }
    return geo;
  }

  // Ensure the requested fields are present/fresh, fetching only stale ones via the
  // registry. nowMs supplied by caller (transport clock). Returns merged metadata.
  // Pull-fetched fields are those a provider declares (e.g. title, geo); duration is
  // push-only (recordDuration), so it is never pulled here.
  // `ask` says who asked: `{ list }`, one of `GEO_LISTS`. `geo` is looked up only with a list, and only while the device's
  // switch is on (above); otherwise it is dropped from what is fetched and a saved answer is still returned.
  function ensure(songKey, fields, nowMs, ask) {
    if (!validId(songKey)) return Promise.resolve({});
    let want = Array.isArray(fields) && fields.length ? fields : ["title"];
    const list = (ask && GEO_LISTS.indexOf(ask.list) >= 0) ? ask.list : null;
    if (want.indexOf("geo") >= 0 && !(list && typeof nowMs === "number" && _geoOn())) want = want.filter((f) => f !== "geo");
    const ttl = _geoTtlMs();
    return get(songKey).then((cached) => {
      const entry = cached || {};
      const stale = want.filter((f) => !isFresh(f, entry, nowMs, ttl) && providersFor(f).length > 0);
      if (!stale.length) return entry;
      return Promise.all(stale.map((f) => {
        const k = songKey + "|" + f;
        if (!_inflight[k]) {
          _inflight[k] = _fetchField(songKey, f, nowMs, list).then(
            (r) => { delete _inflight[k]; return r; },
            () => { delete _inflight[k]; return {}; }
          );
        }
        return _inflight[k];
      })).then((parts) => {
        const merged = Object.assign({}, entry);
        for (const part of parts) _merge(merged, part);
        _save(songKey, merged);
        return merged;
      });
    });
  }

  // ---- MANY SONGS AT ONCE: THE BOT'S WHOLE-QUEUE CHECK (J153 (d); his "excepot the bot always monitors room queue") ----
  // The same path as `ensure` → `_fetchField`, for a list of songs: the device's switch and the list checked once, a saved
  // answer kept until it expires, the sources in the device's order with the same skips (no key, down, its daily limit; a
  // source that goes down part-way hands the rest to the next) and the same counting
  // (a call, and the songs it named, by the list that asked). What differs is the call: a source whose row says how many
  // songs one call may name (`many`) is asked about the waiting songs together, in groups of at most that many — the grouped
  // lane's shape (`backends/backend2/authority.js` POLICY: a group goes out together, at most `maxPerMessage` in one). Its
  // daily limit trims a group to what is left of it. A song a source does not answer falls through to the next source,
  // grouped again where that one takes groups, one at a time where it does not. Screens keep one song per call (`ensure`).
  // A song already being looked up is left to that lookup. Answers:
  //   answers  `{ songKey: geo }` for every song with an answer, saved or new (sanitized, as `heldGeo` hands one back);
  //   on       whether this device looks songs up at all (its switch, and a list that may ask);
  //   asked    the songs no saved answer covered, that a source was asked about;
  //   reached  how many calls a source answered at all, refusals and failures not counted (0 with songs asked: no source
  //            is answering).
  function fetchMany(songKeys, nowMs, ask) {
    const keys = [];
    for (const k of (Array.isArray(songKeys) ? songKeys : [])) if (validId(k) && keys.indexOf(k) < 0) keys.push(k);
    const list = (ask && GEO_LISTS.indexOf(ask.list) >= 0) ? ask.list : null;
    const on = !!(list && typeof nowMs === "number" && _geoOn());
    const ttl = _geoTtlMs();
    const out = { answers: {}, on: on, asked: 0, reached: 0 };
    return Promise.all(keys.map((k) => get(k).then((c) => [k, c || {}], () => [k, {}]))).then((rows) => {
      const entries = {}, want = [];
      for (const [k, entry] of rows) {
        entries[k] = entry;
        const held = (entry.geo && typeof entry.geo === "object") ? sanitize({ geo: entry.geo }).geo : null;
        if (held) out.answers[k] = held;
        if (on && !isFresh("geo", entry, nowMs, ttl) && !_inflight[k + "|geo"]) want.push(k);
      }
      if (!want.length) return out;
      out.asked = want.length;
      const tried = [];
      const keep = (k, clean, p) => {
        clean.geo.checkedAt = nowMs; clean.geo.source = String(p.id);
        out.answers[k] = clean.geo;
        _save(k, _merge(Object.assign({}, entries[k]), clean));
      };
      // EACH SERVICE IN TURN, ITS SOURCES IN THIS DEVICE'S ORDER (`_geoChain`: the favourite first; the rest only with auto
      // fallback on): a source answers only for its own service's songs, so the order is chosen per service.
      const shorts = [];
      for (const k of want) { const sh = Songs.serviceOf(k); if (shorts.indexOf(sh) < 0) shorts.push(sh); }
      let left = [], i = 0, chain = [];
      function nextService() {
        if (!shorts.length) { _sayFirst(want[0], tried); return Promise.resolve(out); }
        const sh = shorts.shift();
        left = want.filter((k) => Songs.serviceOf(k) === sh); i = 0; chain = _geoChain(sh);
        return nextSource();
      }
      function nextSource() {
        if (!left.length || i >= chain.length) return nextService();
        const p = chain[i++];
        let ready = [];
        try { ready = left.filter((k) => (typeof p.ready !== "function") || p.ready(k) === true); } catch (e) { ready = []; }
        if (!ready.length) return nextSource();                              // skips itself, uncounted
        let room = Infinity;
        if (typeof p.dailyIds === "number") room = p.dailyIds - _idsToday(p, nowMs);
        if (room <= 0) { tried.push(_geoName(p) + " at its daily limit"); return nextSource(); }
        const size = (typeof p.many === "number" && p.many > 1 && typeof p.fetchMany === "function") ? p.many : 1;
        const groups = [];
        for (let j = 0; j < ready.length && j < room; j += size) groups.push(ready.slice(j, Math.min(j + size, room)));
        // A SOURCE THAT IS DOWN asks nothing, uncounted — before its first group, or part-way, when its own refusals have
        // just made it down: the rest of its songs go on to the next source.
        let answered = 0, refused = 0, calls = 0, wentDown = false;
        return groups.reduce((chainP, g) => chainP.then(() => {
          if (_isDown(p)) { wentDown = true; return; }
          calls++;
          _count(p, list, g.length, nowMs);
          const call = (size > 1) ? Promise.resolve().then(() => p.fetchMany(g))
            : Promise.resolve().then(() => p.fetch(g[0], "geo")).then((raw) => ({ [g[0]]: raw }));
          return call.then((byKey) => {
            out.reached++;
            _answered(p);
            for (const k of g) {
              const clean = sanitize(byKey && byKey[k]);
              if (clean.geo !== undefined) { keep(k, clean, p); answered++; left = left.filter((x) => x !== k); }
            }
          }, () => { refused++; _failed(p); });
        }), Promise.resolve()).then(() => {
          tried.push(!calls ? _geoName(p) + " down"
            : _geoName(p) + " answered " + answered + " of " + ready.length + (refused ? " (" + refused + " call(s) refused)" : "") + (wentDown ? ", then down" : ""));
          return nextSource();
        });
      }
      return nextService();
    });
  }
  // What this device can do about where songs are blocked, for a caller that must say why it can't (the bot's muted line,
  // J153 (d)): whether it looks songs up at all, the sources it would ask but cannot, for want of a key this device
  // has not been given (their names, in the order they are asked), and the sources down at the moment (`down`, by name).
  function geoStatus() {
    const keyless = [];
    try { for (const p of providersFor("geo")) if (p && p.needsKey === true && !p.keyHeld()) keyless.push(_geoName(p)); } catch (e) {}
    let down = [];
    try { down = _downNames(); } catch (e) { down = []; }
    return { on: _geoOn(), keyless: keyless, down: down };
  }


  // ---- push path: metadata captured from the player (on play / preview) ----
  // The player reliably yields title + duration once a song is loaded; record them
  // so duration (never pull-able) gets filled and title gets a second, robust source.
  function recordTitle(songKey, title) {
    const clean = sanitize({ title: title });
    if (clean.title === undefined || !validId(songKey)) return Promise.resolve(false);
    return get(songKey).then((c) => { const m = _merge(c || {}, clean); _save(songKey, m); return true; });
  }
  function recordDuration(songKey, durationSec) {
    const clean = sanitize({ durationSec: durationSec });
    if (clean.durationSec === undefined || !validId(songKey)) return Promise.resolve(false);
    return get(songKey).then((c) => { const m = _merge(c || {}, clean); _save(songKey, m); return true; });
  }
  // Combined push: record several player-sourced fields in ONE read-merge-write.
  // recordTitle + recordDuration each do their own get→merge→save, so firing them
  // together raced on the same Store.meta record — the second save (built from a
  // read taken before the first persisted) dropped the first field. Callers with
  // more than one field at once (the player push: title + duration) must use this
  // so neither field clobbers the other.
  function recordMeta(songKey, fields) {
    if (!validId(songKey)) return Promise.resolve(false);
    const clean = sanitize(fields || {});
    if (clean.title === undefined && clean.durationSec === undefined && clean.geo === undefined) return Promise.resolve(false);
    return get(songKey).then((c) => { const m = _merge(c || {}, clean); _save(songKey, m); return true; });
  }

  // ===================== built-in providers (review-only) =====================
  // Their fetch bodies touch the DOM/network and are browser-verified; they are
  // NEVER executed at module load (only object literals are created here).

  // TITLE via oEmbed-JSONP. fetch() injects a <script> pointing at the song's service's
  // oEmbed endpoint (`Songs.titleLookupOf`) with a callback param; oEmbed responds with JS
  // that calls our callback with { title, ... }. Script tags aren't CORS-bound, so this is
  // keyless and serverless, hitting the service directly — and for YouTube that origin is
  // already a trusted script-src one (the IFrame player loads from it), so it adds no new CSP
  // surface. Resolves {} on timeout/error so the chain falls through.
  let _cbSeq = 0;                                    // monotonic callback-name token (no RNG/clock)
  const oembedTitleProvider = {
    id: "oembed-jsonp",
    fields: ["title"],
    fetch: function (songKey) {
      return new Promise(function (resolve) {
        var lookup = Songs.titleLookupOf(songKey);
        if (!lookup) { resolve({}); return; }      // a service with no title lookup: the chain falls through
        var cb = "_ddjpOE_" + (++_cbSeq);
        var url = lookup + "&callback=" + cb;
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

  // ===================== WHERE SONGS ARE BLOCKED: THE SOURCES, FROM THE SONG TABLE (J153 (c)) =====================
  // The sources, their addresses, their readers and their order are the song table's (`core/songs.js`, a service's
  // `regions`), read here AT LOAD — this file's one load-time need (`roles.md` §0). One provider is built from each source,
  // and nothing here names a service or a source. In the owner's order (`main/01-project.md` item 9), each falling through
  // to the next; the registry PREPENDS, so they are registered last-first. A source answers only for its own service's
  // songs: for any other song it skips itself, uncounted; so does one that needs the person's own key while this device
  // holds none (`ChatPrefs.apiKey`).
  // THEIR FETCH BODIES ARE REVIEW-ONLY (browser-verified), never run at load, and never put an address in an error or a log
  // line: a source's address can carry the person's key. A failure is "HTTP <status>", "timed out" or "network error",
  // nothing more.
  const GEO_TIMEOUT_MS = 8000;

  // review-only: one JSON GET, with a timeout, no cookies; the error never carries the address.
  function _getJson(url, referrerPolicy) {
    if (typeof fetch !== "function") return Promise.reject(new Error("network error"));
    const ctl = (typeof AbortController === "function") ? new AbortController() : null;
    const timer = setTimeout(() => { if (ctl) ctl.abort(); }, GEO_TIMEOUT_MS);
    const opts = { credentials: "omit", signal: ctl ? ctl.signal : undefined };
    if (referrerPolicy) opts.referrerPolicy = referrerPolicy;
    return fetch(url, opts).then((res) => {
      if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "?"));
      return res.json();
    }).then((j) => { clearTimeout(timer); return j; }, (e) => {
      clearTimeout(timer);
      // ONE word for every failure, never the error's own text (a browser's may name the address, and with it the key).
      const own = (e && typeof e.message === "string" && /^HTTP \S{1,8}$/.test(e.message)) ? e.message : null;
      throw new Error((e && e.name === "AbortError") ? "timed out" : (own || "network error"));
    });
  }
  function _apiKey(short) { try { return (typeof ChatPrefs !== "undefined" && ChatPrefs.apiKey) ? ChatPrefs.apiKey(short) : ""; } catch (e) { return ""; } }
  // One provider from one of the table's sources. `ready`: the song is the source's service's, and a key it needs is held.
  // `fetch`: the source's own address and reader; with `servers`, each in turn, the first to answer with a list the answer.
  function _regionProvider(src) {
    const idOf = (songKey) => { try { return (Songs.serviceOf(songKey) === src.short) ? Songs.idOf(songKey) : null; } catch (e) { return null; } };
    return {
      id: src.id, name: src.name, fields: ["geo"], dailyIds: src.dailyIds, many: src.many,
      short: src.short,                              // its service: the device's order is chosen per service (`_geoChain`)
      needsKey: !!src.key, keyHeld: () => !src.key || !!_apiKey(src.short),
      ready: (songKey) => !!idOf(songKey) && (!src.key || !!_apiKey(src.short)),
      // MANY AT ONCE (J153 (d)), only where the row says how many one call may name: one address naming every id, and each
      // song's answer read out of the one body by the row's own reader, by its id — `{ songKey: partial }`.
      fetchMany: (typeof src.many === "number" && src.many > 1 && !src.servers) ? function (songKeys) {
        const ids = songKeys.map(idOf), key = src.key ? _apiKey(src.short) : null;
        if (ids.some((x) => !x)) return Promise.reject(new Error("network error"));
        return _getJson(src.url(ids, key), src.referrer).then((j) => {
          const out = {};
          songKeys.forEach((k, n) => { out[k] = src.read(j, ids[n]) || {}; });
          return out;
        });
      } : undefined,
      fetch: function (songKey) {
        const id = idOf(songKey), key = src.key ? _apiKey(src.short) : null;
        if (!src.servers) return _getJson(src.url(id, key), src.referrer).then((j) => src.read(j, id) || {});
        // A SERVER THAT ANSWERED WITHOUT A LIST is the source answering, with no answer for this song (J153 (d)): only when
        // every server failed is the source's call a failure, which is what counts toward its being down.
        let i = 0, came = false;
        function nextServer() {
          if (i >= src.servers.length) return came ? Promise.resolve({}) : Promise.reject(new Error("network error"));
          const server = src.servers[i++];
          return _getJson(src.url(id, key, server), src.referrer).then((j) => { came = true; return j; })
            .then((j) => src.read(j, id) || nextServer(), () => nextServer());
        }
        return nextServer();
      },
    };
  }
  const _sources = Songs.regionSources();
  for (let i = _sources.length - 1; i >= 0; i--) registerProvider(_regionProvider(_sources[i]));   // the first source is tried first

  // ===================== THUMBNAIL (downscale → Store.images) =================
  // NOT a registry field provider. The registry/ensure() path is for METADATA
  // FIELDS that flow through sanitize() into the per-video Store.meta record
  // (title/duration/geo). A thumbnail is BYTES, and thumbnail bytes live SEPARATELY in the bounded image cache
  // (Store.images, `main/06-storage.md`'s table),
  // never alongside the ids in Store.meta. So the thumbnail path sits BESIDE the
  // registry — exactly like the player push paths (recordTitle/recordDuration),
  // which also bypass the registry because their data doesn't fit the
  // fetch(songKey, field) → sanitized-partial contract. (A thumbnail is "a provider whose output routes to
  // Store.images", expressed in the shape the bytes actually need.)
  //
  // PURE bits (target-dimension math, the encode-format ladder, the "do we need
  // to fetch?" gate) are exposed for the guard. The fetch/canvas BODY touches the
  // DOM/network and is review-only — never run at module load.

  const THUMB_PX = 120;     // target square thumbnail edge (a row draws it at ~96–120 px)
  // Encode-format ladder: WebP preferred (smaller), JPEG fallback for browsers
  // that don't encode WebP from a canvas. PNG is deliberately absent (lossless =
  // large; defeats the "≈1–2 KB" goal). Pure data so the guard can pin the order.
  const THUMB_ENCODES = [
    { type: "image/webp", quality: 0.8 },
    { type: "image/jpeg", quality: 0.82 },
  ];

  // PURE: the song's static picture URL. Keyless, derived from the key alone by the
  // song's service (`Songs.pictureOf`) — for YouTube an https <img>/<canvas> source the
  // CSP already allows (img-src https:).
  function thumbUrl(songKey) {
    return validId(songKey) ? Songs.pictureOf(songKey) : null;
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
  function needsThumb(songKey, known) {
    if (!validId(songKey)) return false;
    return !known;
  }

  // ---- review-only: load the song's picture, downscale to a small blob, store it ---
  // Resolves the stored Blob (also returns it) or null on any failure (CORS taint,
  // load error, encode unsupported, no Store). NEVER throws. Downscale-once: the
  // original is drawn and discarded; only the small variant is persisted. On a
  // tainted canvas (a host that doesn't allow readback) toBlob/toDataURL throw —
  // we catch and resolve null, and the UI falls back to the direct URL (the
  // agreed "prefer stored downscale, else the link" behaviour). `force` skips the
  // known-check (e.g. a future refetch policy); default path checks Store.images.
  function ensureThumb(songKey, opts) {
    opts = opts || {};
    if (!validId(songKey)) return Promise.resolve(null);
    if (typeof document === "undefined" || typeof Image === "undefined") return Promise.resolve(null);
    const imagesOk = (typeof Store !== "undefined" && Store.images);
    const haveCheck = (opts.force || !imagesOk)
      ? Promise.resolve(false)
      : Promise.resolve(Store.images.has(songKey)).catch(() => false);
    return haveCheck.then((have) => {
      if (have) return Store.images.load(songKey).catch(() => null);   // cache hit: reuse bytes
      return _downscaleAndStore(songKey);
    });
  }
  function _downscaleAndStore(songKey) {
    return new Promise(function (resolve) {
      var url = thumbUrl(songKey);
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
              Promise.resolve(Store.images.persist(songKey, blob)).catch(function () {});
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
    registerProvider: registerProvider, get: get, ensure: ensure, heldGeo: heldGeo, fetchMany: fetchMany, geoStatus: geoStatus,
    recordTitle: recordTitle, recordDuration: recordDuration, recordMeta: recordMeta,
    ensureThumb: ensureThumb,
    // exposed for guards (pure decisions)
    sanitize: sanitize, isFresh: isFresh, providersFor: providersFor, validId: validId, GEO_LISTS: GEO_LISTS,
    thumbUrl: thumbUrl, thumbDrawRect: thumbDrawRect, needsThumb: needsThumb,
    THUMB_PX: THUMB_PX, THUMB_ENCODES: THUMB_ENCODES, DOWN_AFTER: DOWN_AFTER, DOWN_MS: DOWN_MS,
    _setClockForTest: function (fn) { _clock = (typeof fn === "function") ? fn : () => Date.now(); } /* exposed for the guard */,
  };
  return api;
})();
