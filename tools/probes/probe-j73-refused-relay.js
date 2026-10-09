// tools/probes/probe-j73-refused-relay.js
// SUBJECT: backends/backend2/authority.js evaluate · backends/backend2/streammanager.js noteActivity
//          · features/room.js foldActivity.
// QUESTION (J73 brief §2 "still to check"): is there a REACHABLE act the bot relays and the room then
// refuses — and if so, do the two activity readings disagree about it? The held-log fold skips a
// refused act (`isLegal` false); the background read (`noteActivity`) has no legality check.
// The case: a VIP presses Skip just as the song changes. The bot judges by `Capabilities.can`, which
// asks about RANK, so a VIP's skip of the new song is permitted and relayed — carrying `p` of the
// song that just ended, which the reducer refuses as `advance-locked`.
// A MEASUREMENT: exits 0 unless a premise fails.   node tools/probes/probe-j73-refused-relay.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js", "backends/backend2/authority.js",
  "features/room.js",
], {});
let bad = 0;
function premise(c, msg, d) { if (!c) { bad++; console.log("PREMISE FAILED — " + msg + (d ? " :: " + JSON.stringify(d) : "")); } }
// THE SHARED DOOR BY NAME. With backend2 loaded the harness binds `StreamManager` to the BOT door,
// which refuses everything until a fold scope is bound — the first run of this probe was VOID for
// exactly that reason (nothing played), and said so.
const B1 = sb.B1StreamManager, R = sb.Ranks;
premise(sb.B2Authority && sb.B2StreamManager && sb.Room, "the real bot judge, bot door and Room must load");
const VIP = R.levelOf("vip"), PLY = R.levelOf("player"), OWN = R.levelOf("owner");

const LOG = [
  F.reducerEvent("$s1", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }),
  F.reducerEvent("$j1", 2, 2000, "@dj1:hs", PLY, { t: "ddjp.dj.join", v: "vid0000000A" }),
  F.reducerEvent("$j2", 3, 3000, "@dj2:hs", PLY, { t: "ddjp.dj.join", v: "vid0000000B" }),
  F.reducerEvent("$play1", 4, 10000, "@dj1:hs", PLY, { t: "ddjp.dj.play", p: null }),
  F.reducerEvent("$play2", 5, 20000, "@dj1:hs", PLY, { t: "ddjp.dj.play", p: "$play1" }),   // the song changes
];
B1.reset(); LOG.forEach((e) => B1.ingest(F.toRaw(e)));
const st = B1.getState();
premise(st.nowPlaying && st.nowPlaying.pi === "$play2" && st.nowPlaying.dj === "@dj2:hs",
  "the room must have moved on to @dj2's song", st.nowPlaying);

// 1 · the bot's own judge, exactly as the runner calls it (actor, state, the person's rank)
const intent = { t: "ddjp.dj.skip", p: "$play1", actor: "@v:hs" };
const verdict = sb.B2Authority.evaluate(intent, st, VIP);
console.log("1 · B2Authority.evaluate(VIP skip naming the ended song) -> " + JSON.stringify(verdict));

// 2 · the relay folds, and the reducer refuses it
const relay = F.reducerEvent("$vskip", 6, 21000, "@v:hs", VIP, { t: "ddjp.dj.skip", p: "$play1" });
B1.ingest(F.toRaw(relay));
const legal = B1.isLegal("$vskip");
const why = B1.refusalOf ? B1.refusalOf("$vskip") : null;
console.log("2 · the relayed skip in the log: isLegal=" + legal + " refusal=" + JSON.stringify(why));

// 3 · the held-log reading (People tab and bot alike)
const NOW = 25000, W = st.settings.botAfkMs;
const groups = st.settings.activityPresence;
const held = sb.Room.foldActivity(B1.getLog(), NOW, W, { spine: true, chat: false },
  (id) => B1.isLegal(id), groups, sb.Capabilities.activityGroupOf, null);
const heldHasV = held.people.some((p) => p.userId === "@v:hs");
console.log("3 · held-log fold: @v listed=" + heldHasV + " (refused counted " + held.refused + ")");

// 4 · the SAME act arriving through the background read instead (it sits below the save point)
sb.B2StreamManager.setFoldScope({ events_owner: "!ev:hs", settings_owner: "!set:hs" });
sb.B2StreamManager.noteActivity([{ event_id: "$carrier", room_id: "!ev:hs", sender: "@bot:hs", ts: 21000,
  type: "m.room.message", content: { body: JSON.stringify({ t: "ddjp.dj.skip", p: "$play1", actor: "@v:hs", rank: VIP }) } }]);
const older = sb.B2StreamManager.olderActivity();
const olderHasV = !!(older && older.by && older.by["@v:hs"]);
const merged = sb.Room.foldActivity(B1.getLog().filter((e) => e.eventId !== "$vskip"), NOW, W, { spine: true, chat: false },
  (id) => B1.isLegal(id), groups, sb.Capabilities.activityGroupOf, older);
const mergedHasV = merged.people.some((p) => p.userId === "@v:hs");
console.log("4 · background read: @v credited=" + olderHasV + " " + JSON.stringify(older && older.by["@v:hs"]) +
  "; fold over it lists @v=" + mergedHasV);

premise(verdict && verdict.ok === true, "for the case to be REACHABLE the bot must relay it", verdict);
premise(legal === false, "for the case to be a REFUSED act the reducer must refuse it", why);
premise(heldHasV === false, "control: the held-log fold must skip the refused act", held.people);
console.log(bad ? "VOID — " + bad + " premise(s) failed"
  : "MEASURED — reachable: the bot relays it (rank permits), the room refuses it (" + (why && why.code) +
    "); held-log fold does not count @v, background read " + (mergedHasV ? "DOES" : "does not") +
    " — the same act gives two answers depending on which side of the save point it sits");
process.exit(bad ? 1 : 0);
