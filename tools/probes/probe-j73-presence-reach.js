// tools/probes/probe-j73-presence-reach.js
// SUBJECT: features/room.js recentlyActive over backends/backend1/streammanager.js after a trim.
// QUESTION (J73 brief §2): in a SHARED room that has trimmed to a floor 20 minutes old, what does
// the real presence fold answer against the 1-hour default `botAfkMs`? The bot's presence pass holds
// whenever `fold.bounded === true` (features/botruntime.js, guarded by check-idle-sweep PART H and
// mutate-j67-j72 row Z1), so `bounded` is the quantity that decides whether anybody is removed.
// A MEASUREMENT: exits 0 unless a premise fails.   node tools/probes/probe-j73-presence-reach.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "features/room.js",
], {});
let bad = 0;
function premise(c, msg, d) { if (!c) { bad++; console.log("PREMISE FAILED — " + msg + (d ? " :: " + JSON.stringify(d) : "")); } }
premise(sb.Room && typeof sb.Room.recentlyActive === "function", "the real Room.recentlyActive must load");

const MIN = 60000, N = 50 * 60 * MIN;                       // "now", in server time
const O = F.RANK.owner, P = F.RANK.player;
const bare = (id, l, ts, who) => F.reducerEvent(id, l, ts, who, P, { t: "ddjp.dj.join" });   // a person pressing Join
const LOG = [
  F.reducerEvent("$s1", 1, N - 120 * MIN, "@owner:hs", O, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
  bare("$p", 2, N - 50 * MIN, "@p:hs"),
  bare("$q", 3, N - 30 * MIN, "@q:hs"),
  bare("$r", 4, N - 20 * MIN - 1000, "@r:hs"),            // the floor's boundary: 20 minutes back
  bare("$s", 5, N - 20 * MIN, "@s:hs"),
  bare("$t", 6, N - 2 * MIN, "@t:hs"),
];
sb.Floor.reset(); sb.StreamManager.reset();
LOG.forEach((e) => sb.StreamManager.ingest(F.toRaw(e)));
const win = sb.StreamManager.getState().settings.botAfkMs;
premise(win === 60 * MIN, "the shipped default window must be 1 hour", win);
const show = (f) => "people [" + f.people.map((p) => p.userId.split(":")[0]).join(",") + "] reach " +
  Math.round(f.reach / MIN) + " min, effective window " + Math.round(f.effectiveWindowMs / MIN) +
  " min, bounded=" + f.bounded;
const before = sb.Room.recentlyActive(N);
console.log("BEFORE THE TRIM (holds everything)  " + show(before));

const ordered = sb.StreamManager.getLog();
const seed = sb.StateDeriver.buildSeed(ordered.slice(0, ordered.findIndex((e) => e.eventId === "$r") + 1), undefined);
sb.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: 4, grade: "verified", covers: "$s1..$r",
                              seed: seed, prev: null, thin: false });
const dropped = sb.StreamManager.trimToFloor();
premise(dropped > 0, "the trim must happen, or 'after' measures nothing", { dropped, licence: sb.StreamManager.seedValidation() });
const after = sb.Room.recentlyActive(N);
console.log("AFTER TRIMMING TO A 20-MINUTE FLOOR   " + show(after) + "  (dropped " + dropped + ")");
premise(before.bounded === false, "control: holding everything, the 1-hour window must be answerable", before);

const lost = before.people.map((p) => p.userId).filter((u) => !after.people.some((q) => q.userId === u));
console.log(bad ? "VOID — " + bad + " premise(s) failed"
  : "MEASURED — after the trim the fold is bounded=" + after.bounded + " (reach " + Math.round(after.reach / MIN) +
    " min < window " + Math.round(win / MIN) + " min), so the bot's presence pass holds and removes nobody; " +
    "people active inside the hour but below the floor drop out of the list: [" + lost.join(", ") + "]");
process.exit(bad ? 1 : 0);
