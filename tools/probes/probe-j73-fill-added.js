// tools/probes/probe-j73-fill-added.js
// SUBJECT: backends/backend1/matrixbridge.js pageRange (the song-history fill's download) and
//          backends/backend1/history.js ingest.
// QUESTION (owner, J73 Q10 settlement): does the history fill really download the "added" events —
// a `ddjp.dj.join` carrying a video, and `ddjp.dj.declare` — and what does song history keep of them?
// `pageRange` is EXTRACTED from matrixbridge.js and RUN (check-bot-open PART N's method), against an
// SDK-shaped room whose older events arrive only by scrolling back. Both room types: shared-room raws
// through backend1's `normalise`, bot relays (`actor`, no `at`) through backend2's `normaliseAll`.
// A MEASUREMENT: exits 0 unless a premise fails.   node tools/probes/probe-j73-fill-added.js
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const F = require(path.join(__dirname, "..", "..", "tests", "_fixtures.js"));
const ROOT = path.join(__dirname, "..", "..");
let bad = 0;
function premise(c, msg, d) { if (!c) { bad++; console.log("PREMISE FAILED — " + msg + (d ? " :: " + JSON.stringify(d) : "")); } }

const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
function cut(from, to) { const a = mb.indexOf(from), b = mb.indexOf(to, a + 1); return (a >= 0 && b > a) ? mb.slice(a, b) : null; }
const pageSrc = cut("  async function pageRange(fromL, toL) {", "  // The room's start phase runs only AFTER replay");
premise(!!pageSrc && /function _oldestL\(room\)/.test(pageSrc), "pageRange and _oldestL must be extracted from the shipped file");

const sb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend1/history.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js",
], {});
const R = sb.Ranks, PLY = R.levelOf("player"), OWN = R.levelOf("owner");

// A room's log: settings, two songs added by each of four people, then 32 rounds of "the next song
// plays" + "the person who just played adds another". The queue never runs dry, so every play chains
// and song history must fold exactly 32 rows — the CONTROL that the fold read the download at all.
const PLAYS = 32;
function roomEvents() {
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() })];
  let l = 2, ts = 2000, prev = null, n = 0;
  const add = (who) => {
    const vid = "vid" + String(n).padStart(8, "0");
    ev.push(F.reducerEvent("$add" + n, l++, ts += 100, who, PLY,
      (n >= 8 && n % 5 === 4) ? { t: "ddjp.dj.declare", v: vid } : { t: "ddjp.dj.join", v: vid }));
    n++;
  };
  for (let u = 0; u < 4; u++) { add("@u" + u + ":hs"); add("@u" + u + ":hs"); }
  for (let r = 0; r < PLAYS; r++) {
    const id = "$play" + r;
    ev.push(F.reducerEvent(id, l++, ts += 10000, "@u0:hs", PLY, { t: "ddjp.dj.play", p: prev }));
    prev = id;
    add("@u" + (r % 4) + ":hs");
  }
  return ev;
}
const isAdd = (e) => e && (e.type === "ddjp.dj.declare" || (e.type === "ddjp.dj.join" && e.content && e.content.v));

// An SDK-shaped room: the live timeline holds only the newest few; scrollback prepends 100 older.
function sdkRoom(roomId, raws, live) {
  const all = raws.map((r) => ({ event: r }));
  const room = { roomId: roomId, timeline: all.slice(-live) };
  let next = all.length - live;
  const client = {
    getRooms: () => [room],
    scrollback: async (rm) => { const from = Math.max(0, next - 100); rm.timeline = all.slice(from, next).concat(rm.timeline); next = from; },
  };
  return { room, client };
}
function run(label, raws, normaliseAll, senderOf) {
  const { client } = sdkRoom("!ev:hs", raws, 12);
  const pageRange = new Function("client", "_isSpineChannel", "inScope", "History", "_normaliseAll", "_channelRank", "Logger",
    pageSrc + "\nreturn pageRange;")(client, () => true, () => true, sb.History, normaliseAll, () => PLY, { warn() {} });
  const got = [];
  sb.History.reset();
  sb.History.attach({ log: () => [], seed: null, pageRange: async (a, b) => { const r = await pageRange(a, b); got.push(...r); return r; } });
  return sb.History.backfill(0, undefined, 10000).then((bf) => {
    const adds = got.filter(isAdd);
    const rows = sb.History.recent();
    const rowIds = new Set(rows.map((r) => r.pi));
    const keptAdds = adds.filter((e) => rowIds.has(e.eventId));
    const sample = adds[adds.length - 1];
    console.log(label.padEnd(12) + " fill ok=" + bf.ok + " | downloaded " + got.length + " events, of them " + adds.length +
      " 'added' (" + adds.filter((e) => e.type === "ddjp.dj.join").length + " join+video, " +
      adds.filter((e) => e.type === "ddjp.dj.declare").length + " declare) | song history kept " + rows.length +
      " rows, all plays=" + rows.every((r) => /^\$play/.test(String(r.pi))) +
      ", added events kept=" + keptAdds.length +
      " | last added: who=" + (sample && senderOf(sample)) + " video=" + (sample && sample.content.v) + " ts=" + (sample && sample.ts));
    return { got, adds, rows, keptAdds, bf };
  });
}

(async () => {
  // SHARED ROOM: one raw per event, normalised by backend1's own door.
  const shared = roomEvents().map(F.toRaw);
  const a = await run("SHARED ROOM", shared, (r) => { const n = sb.B1StreamManager.normalise(r); return n ? [n] : []; }, (e) => e.sender);
  premise(a.bf.ok && a.adds.length === 40, "the shared fill must reach every added event (40)", { ok: a.bf.ok, adds: a.adds.length });
  premise(a.rows.length === PLAYS, "control: song history must fold every play it downloaded, or 'kept nothing' means nothing", a.rows.length);

  // BOT ROOM: the bot relays each act into events-owner — sender is the bot, the person is `actor`.
  sb.B2StreamManager.setFoldScope({ events_owner: "!ev:hs", settings_owner: "!set:hs" });
  const bot = roomEvents().map((e, i) => {
    const body = Object.assign({}, e.content, { actor: e.sender, rank: e.senderRank, l: undefined });
    delete body.l;
    return { event_id: e.eventId, type: "m.room.message", room_id: "!ev:hs", sender: "@bot:hs", ts: e.ts, l: e.l,
             senderRank: OWN, content: { body: JSON.stringify(Object.assign({}, body, { l: e.l })) } };
  });
  const b = await run("BOT ROOM", bot, (r) => sb.B2StreamManager.normaliseAll(r), (e) => e.sender);
  premise(b.bf.ok && b.adds.length === 40, "the bot-room fill must reach every added event (40)", { ok: b.bf.ok, adds: b.adds.length });
  premise(b.adds.every((e) => e.sender !== "@bot:hs"), "bot relays must be credited to the person, not the bot");
  premise(b.rows.length === PLAYS, "control: the bot room must fold every play too", b.rows.length);

  console.log(bad ? "VOID — " + bad + " premise(s) failed"
    : "MEASURED — the fill DOES download the added events in both room types (with who, which video and the server " +
      "stamp), and song history keeps none of them: it folds the download and keeps only the plays");
  process.exit(bad ? 1 : 0);
})();
