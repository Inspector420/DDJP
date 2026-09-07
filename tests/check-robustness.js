// tests/check-robustness.js
// WALL: never crash on bad input. The stream is fed by the network, so every
// module that reads events must survive malformed, duplicate, and hostile input
// — dropping or defaulting, never throwing. This drives the real StreamManager
// through a gauntlet of junk and asserts: nothing crashes, duplicates are
// deduped by event_id, and clearly-invalid events never enter the log.

const { loadInContext } = require("./_load");

function client() {
  return loadInContext(
    ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"],
    { Date }
  ).StreamManager;
}

// A well-formed ddjp.queue raw event; `over` overrides any field.
function raw(over) {
  return Object.assign(
    {
      event_id: "$valid",
      room_id: "!r:hs",
      type: "m.room.message",
      content: { body: JSON.stringify({ t: "ddjp.queue", l: 1, video_id: "AAA", video_url: "https://y/AAA" }) },
      ts: 1,
      l: 1,
    },
    over
  );
}

function fail(m) {
  console.log("[robustness] FAIL — " + m);
  process.exit(1);
}

const SM = client();

function feed(label, ev) {
  try {
    SM.ingest(ev);
  } catch (e) {
    fail("ingest() threw on " + label + " (it must never throw): " + e.message);
  }
}

// One good event establishes the baseline.
feed("valid event", raw());
if (SM.getLog().length !== 1) fail("a valid event was not ingested");

// Same event_id again — must be deduplicated.
feed("duplicate event_id", raw());
if (SM.getLog().length !== 1)
  fail("duplicate event_id was not deduplicated (log length " + SM.getLog().length + ")");

// A gauntlet of junk — each must be dropped, none may crash.
feed("body that isn't JSON", raw({ event_id: "$j", content: { body: "not json {{{" } }));
feed("non-ddjp message type", raw({ event_id: "$n", content: { body: JSON.stringify({ t: "m.custom", l: 1 }) } }));
feed("missing event_id", raw({ event_id: undefined }));
feed("missing room_id", raw({ event_id: "$m", room_id: undefined }));
feed("undefined content", raw({ event_id: "$u", content: undefined }));
feed("non-message Matrix event", raw({ event_id: "$r", type: "m.reaction" }));

if (SM.getLog().length !== 1)
  fail("malformed events leaked into the log (expected 1, got " + SM.getLog().length + ")");

console.log("[robustness] PASS — malformed and duplicate events are dropped without crashing");

// ---- PART B: prototype-key injection must not crash or pollute ------------------
// Maps keyed by attacker-controlled strings (userId, move-target, videoId) must use
// null-prototype objects, so a key like "__proto__" / "constructor" can't resolve to an
// inherited member (defeating existence guards) or pollute Object.prototype. A single hostile
// dj.move targeting "__proto__" once crashed the reducer on every honest client (a Staff+ DoS).
(() => {
  const SD = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js"], {}).StateDeriver;
  const ev = (id, l, sender, body, rank) => ({ event_id: id, l, sender, senderRank: rank, ts: l * 60000, type: body.t, content: body });
  const POISON = ["__proto__", "constructor", "prototype", "hasOwnProperty", "toString"];
  for (const key of POISON) {
    for (const type of ["ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.declare", "ddjp.dj.play", "ddjp.dj.vote", "ddjp.count.set"]) {
      const body = { t: type, l: 2, x: key, id: key, p: key, v: key, k: "vote", n: 1, after: key };
      try { SD.derive([ev("$j", 1, "@a", { t: "ddjp.dj.join", v: "SEED" }, 100), ev("$e", 2, "@x", body, 100)]); }
      catch (e) { console.log("[robustness] FAIL — prototype-key '" + key + "' crashed " + type + ": " + e.message); process.exit(1); }
    }
  }
  // a seed (forged checkpoint) carrying __proto__/constructor keys must also be inert + non-crashing
  const evilSeed = JSON.parse('{"members":{"__proto__":{"pending":[],"orderKey":0}},"rankByUser":{"constructor":100},"settings":{},"tick":0,"nowPlaying":null}');
  try { SD.derive([ev("$j", 1, "@b", { t: "ddjp.dj.join", v: "X" }, 20)], evilSeed); }
  catch (e) { console.log("[robustness] FAIL — malicious __proto__ seed crashed derive: " + e.message); process.exit(1); }
  // Object.prototype must be un-polluted
  if (({}).polluted !== undefined || ({}).pending !== undefined) { console.log("[robustness] FAIL — Object.prototype was polluted"); process.exit(1); }
  console.log("[robustness] PASS — prototype-key injection (__proto__/constructor/…) in any field or a forged seed neither crashes the reducer nor pollutes Object.prototype");
})();

// ---- PART C: front door never crashes; reducer total under multi-field poison --
(() => {
  const sm = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"], { MatrixBridge: { getUserId: () => "@me" } }).StreamManager;
  // StreamManager.ingest is THE network front door — must survive null/garbage delivery.
  for (const bad of [null, undefined, 0, "", "x", [], true, { type: null }, { type: "m.room.message" }, { type: "m.room.message", content: null }]) {
    try { sm.reset(); sm.ingest(bad); sm.getState(); }
    catch (e) { console.log("[robustness] FAIL — front door crashed on " + JSON.stringify(bad) + ": " + e.message); process.exit(1); }
  }
  // reducer totality under multi-field poison (a bounded deterministic sweep)
  const SD = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/statederiver.js"], {}).StateDeriver;
  const ev = (id, l, sender, body, rank) => ({ event_id: id, l, sender, senderRank: rank, ts: l * 60000, type: body.t, content: body });
  const H = [null, undefined, "", -1, NaN, Infinity, 1.5, {}, [], true, "__proto__", "constructor", 1e400, "x".repeat(2000)];
  const TYPES = ["ddjp.count.set", "ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.play", "ddjp.dj.vote", "ddjp.room.settings", "ddjp.dj.declare"];
  const FIELDS = ["after", "id", "k", "n", "p", "s", "v", "x"];
  for (const type of TYPES) for (const field of FIELDS) for (const val of H) for (const rank of [20, 100]) {
    const body = { t: type, l: 2 }; body[field] = val;
    try { SD.derive([ev("$s", 1, "@a", { t: "ddjp.dj.join", v: "S" }, 100), ev("$e", 2, "@x", body, rank)]); }
    catch (e) { console.log("[robustness] FAIL — reducer crashed on " + type + "." + field + "=" + String(val).slice(0, 12) + ": " + e.message); process.exit(1); }
  }
  console.log("[robustness] PASS — the ingest front door survives null/garbage delivery, and the reducer is total across every single-field hostile injection (no crash on any type×field×value)");
})();
process.exit(0);
