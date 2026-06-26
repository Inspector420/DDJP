// tests/check-robustness.js
// WALL: never crash on bad input. The stream is fed by the network, so every
// module that reads events must survive malformed, duplicate, and hostile input
// — dropping or defaulting, never throwing. This drives the real StreamManager
// through a gauntlet of junk and asserts: nothing crashes, duplicates are
// deduped by event_id, and clearly-invalid events never enter the log.

const { loadInContext } = require("./_load");

function client() {
  return loadInContext(
    ["core/logger.js", "core/statederiver.js", "core/streammanager.js"],
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
process.exit(0);
