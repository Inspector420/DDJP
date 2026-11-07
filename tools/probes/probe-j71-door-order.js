// tools/probes/probe-j71-door-order.js — J71: the shared door judged by arrival order, honest clients. Run: node tools/probes/probe-j71-door-order.js
// SESSION PROBE (J71) — the real shared door, honest clients, two channels, opposite arrival orders.
const { loadInContext } = require(require("path").join(__dirname, "..", "..", "tests", "_load.js"));
const FILES = ["core/logger.js","backends/backend1/ranks.js","backends/backend1/consensushash.js","backends/backend1/trustpolicy.js",
  "backends/backend1/eventcache.js","backends/backend1/statederiver.js","backends/backend1/capabilities.js","backends/backend1/streammanager.js"];
// The real counter, copied: tick = max(clock, highest held) + 1; receive raises the clock.
const client = () => { let c = 0; return { seen(l) { c = Math.max(c, l); }, tick() { c = c + 1; return c; } }; };
const OWNER = "@gm:hs", P = "@p:hs", OWN = "!events_owner", UNC = "!events_uncategorized", SET = "!settings_owner";
let n = 0;
const raw = (room, sender, rank, body, ts) => ({ type: "m.room.message", event_id: "$e" + (++n), room_id: room, sender, ts,
  senderRank: rank, content: { body: JSON.stringify(Object.assign({ dv: 2, hv: 1 }, body)) } });
// The room so far: settings, P joined (l=1..2), a song playing; both apps have seen it all.
const A = client(), B = client();
const base = [];
const S = loadInContext(FILES, { Date, Math, JSON }).StateDeriver.defaultSettings();
base.push(raw(SET, OWNER, 100, { t: "ddjp.room.settings", s: S, l: A.tick() }, 1000));
base.push(raw(UNC, P, 0, { t: "ddjp.dj.join", v: "aaaaaaaaaaa", u: "https://www.youtube.com/watch?v=aaaaaaaaaaa", l: (B.seen(1), B.tick()) }, 2000));
A.seen(2);
base.push(raw(OWN, OWNER, 100, { t: "ddjp.dj.play", p: null, l: A.tick() }, 3000));      // l=3, song pi = that event
B.seen(3);
const pi = base[2].event_id;
// A song-start burst from the owner's app (owner channel), stamped 100..103 s.
const burst = [
  raw(OWN, OWNER, 100, { t: "ddjp.play.len", pi: pi, sec: 200, l: A.tick() }, 100000),
  raw(OWN, OWNER, 100, { t: "ddjp.media.len", v: "aaaaaaaaaaa", d: 200, l: A.tick() }, 101000),
  raw(OWN, OWNER, 100, { t: "ddjp.dj.vote", p: pi, l: A.tick() }, 102000),
];
// P votes at 103.5 s — the burst has not reached P's app yet (sync lag), so P's clock still says 3.
const pVote = raw(UNC, P, 0, { t: "ddjp.dj.vote", p: pi, l: B.tick() }, 103500);
function observe(order) {
  const sb = loadInContext(FILES, { Date, Math, JSON });
  const warns = []; sb.Logger.warn = (m) => warns.push(String(m)); sb.Logger.info = () => {}; sb.Logger.debug = () => {};
  for (const r of base.concat(order)) sb.StreamManager.ingest(r);
  const st = sb.StreamManager.getState();
  return { votes: (st.counts && st.counts[pi] && st.counts[pi].votes) || 0, refused: warns.filter((w) => /REFUSED AT THE DOOR/.test(w)).map((w) => w.slice(0, 120)) };
}
console.log("burst positions:", burst.map((r) => JSON.parse(r.content.body).l), " P's vote position:", JSON.parse(pVote.content.body).l);
const ownerRoomFirst = observe(burst.concat([pVote]));
const uncRoomFirst = observe([pVote].concat(burst));
console.log("observer who gets the owner channel first:", JSON.stringify(ownerRoomFirst));
console.log("observer who gets P's channel first:     ", JSON.stringify(uncRoomFirst));
console.log(ownerRoomFirst.votes === uncRoomFirst.votes ? "SAME" : "DIFFERENT — two honest clients, two rooms: the shared room diverges on arrival order");
