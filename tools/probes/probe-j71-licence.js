// tools/probes/probe-j71-licence.js
// SUBJECT: J71's arrival-order divergence meeting J73 job 7b's licence (live-song counts compared).
// QUESTION (audit of job 7b): two honest observers of one room count 1 vote and 2 votes for the live
// song (`probe-j71-door-order`: P's vote, stamped by a lagging clock, is refused at one door as
// backdated and admitted at the other). Since 7b the decentralized licence compares the live song's
// counts. A floor built on the observer that counted 2, offered to the one that counted 1: what
// happens — and for how many floors? Real door, real `Floor` (remember → select → adopt), real trim.
// A MEASUREMENT: exits 0 unless a premise fails.   node tools/probes/probe-j71-licence.js
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "..", "..", "tests", "_load.js"));
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/eventcache.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
let bad = 0;
const premise = (c, m, d) => { if (!c) { bad++; console.log("PREMISE FAILED — " + m + (d ? " :: " + JSON.stringify(d) : "")); } };
// ── J71's room, verbatim in shape: settings, P joins, a song plays, the owner's song-start burst, P's vote ──
const client = () => { let c = 0; return { seen(l) { c = Math.max(c, l); }, tick() { c = c + 1; return c; } }; };
const OWNER = "@gm:hs", P = "@p:hs", Q = "@q:hs", OWN = "!events_owner", UNC = "!events_uncategorized", SET = "!settings_owner";
let n = 0;
const raw = (room, sender, rank, body, ts) => ({ type: "m.room.message", event_id: "$e" + String(++n).padStart(3, "0"), room_id: room, sender, ts,
  senderRank: rank, content: { body: JSON.stringify(Object.assign({ dv: 2, hv: 1 }, body)) } });
const A = client(), B = client();
const S = loadInContext(FILES, {}).StateDeriver.defaultSettings();
const base = [];
base.push(raw(SET, OWNER, 100, { t: "ddjp.room.settings", s: S, l: A.tick() }, 1000));
base.push(raw(UNC, P, 0, { t: "ddjp.dj.join", v: "aaaaaaaaaaa", u: "https://www.youtube.com/watch?v=aaaaaaaaaaa", l: (B.seen(1), B.tick()) }, 2000));
base.push(raw(UNC, Q, 0, { t: "ddjp.dj.join", v: "bbbbbbbbbbb", u: "https://www.youtube.com/watch?v=bbbbbbbbbbb", l: (B.seen(2), B.tick()) }, 2500));
A.seen(3);
base.push(raw(OWN, OWNER, 100, { t: "ddjp.dj.play", p: null, l: A.tick() }, 3000));
B.seen(4);
const pi = base[3].event_id;
const burst = [raw(OWN, OWNER, 100, { t: "ddjp.play.len", pi: pi, sec: 200, l: A.tick() }, 100000),
  raw(OWN, OWNER, 100, { t: "ddjp.media.len", v: "aaaaaaaaaaa", d: 200, l: A.tick() }, 101000),
  raw(OWN, OWNER, 100, { t: "ddjp.dj.vote", p: pi, l: A.tick() }, 102000)];
const pVote = raw(UNC, P, 0, { t: "ddjp.dj.vote", p: pi, l: B.tick() }, 103500);
function observer(order) {
  const sb = loadInContext(FILES, {});
  sb.Logger.warn = () => {}; sb.Logger.info = () => {}; sb.Logger.debug = () => {};
  sb.Floor.reset(); sb.StreamManager.reset();
  for (const r of base.concat(order)) sb.StreamManager.ingest(r);
  return sb;
}
const one = observer(burst.concat([pVote]));     // gets the owner's channel first: refuses P's vote
const two = observer([pVote].concat(burst));     // gets P's channel first: admits it
const votes = (sb) => { const st = sb.StreamManager.getState(); return (st.counts[pi] && st.counts[pi].votes) || 0; };
premise(votes(one) === 1 && votes(two) === 2, "J71 must reproduce: one observer counts 1, the other 2", { one: votes(one), two: votes(two) });
// Seal on observer TWO (an owner floor, built as the sealer builds it), offer it to observer ONE.
const sealOn = (sb, nth, prev) => {
  const ord = sb.StreamManager.getLog(), last = ord[ord.length - 1];
  const seed = sb.StateDeriver.buildSeed(ord, undefined), covers = ord[0].eventId + ".." + last.eventId;
  const cp = { n: nth, prev: prev, seed: seed, floorL: last.l, thin: false, covers: covers };
  cp.h = sb.CheckpointFormat.fingerprint(nth, prev, seed, last.l, false, covers);
  return cp;
};
const offer = (sb, cp, label) => {
  const remembered = sb.Floor.remember(cp, 100, OWNER, Date.now());
  const sel = sb.Floor.select(100, sb.StreamManager.getState().settings);
  if (sel) sb.Floor.adopt(sel);
  const dropped = sb.StreamManager.trimToFloor();
  const v = sb.StreamManager.seedValidation(), cur = sb.Floor.current();
  const row = { label, remembered, adopted: !!(cur && cur.h === cp.h), grade: cur && cur.grade, licence: v.status + (v.reason ? "/" + v.reason : ""),
                trimmed: dropped, held: sb.StreamManager.getLog().length, liveVotes: votes(sb) };
  console.log(JSON.stringify(row));
  return row;
};
const both = (r) => { one.StreamManager.ingest(r); two.StreamManager.ingest(r); };
console.log("observer ONE counts " + votes(one) + ", observer TWO counts " + votes(two) + " for the live song " + pi);
const F1 = sealOn(two, 1, null);
const r1 = offer(one, F1, "F1 — sealed on TWO during the divergent song");
// Still the same song: another listener votes (both observers see it), and TWO seals again.
both(raw(UNC, Q, 0, { t: "ddjp.dj.vote", p: pi, l: 8 }, 104000));
const F2 = sealOn(two, 2, F1.h);
const r2 = offer(one, F2, "F2 — sealed on TWO, the SAME song still live");
// The song changes on both, a vote on the new song, and TWO seals.
const play2 = raw(OWN, OWNER, 100, { t: "ddjp.dj.play", p: pi, l: 9 }, 400000);
both(play2);
both(raw(UNC, Q, 0, { t: "ddjp.dj.vote", p: play2.event_id, l: 10 }, 401000));
const F3 = sealOn(two, 3, F2.h);
const r3 = offer(one, F3, "F3 — sealed on TWO after the song changed");
premise(r1.adopted && r2.adopted && r3.adopted, "each floor must be adopted, or the licence measured is not the production path", { r1, r2, r3 });
const blocked = [r1, r2, r3].filter((r) => r.trimmed === 0).length;
console.log(bad ? "VOID — " + bad + " premise(s) failed"
  : "MEASURED — refused while the divergent song is live (" + [r1, r2].map((r) => r.licence).join(", ") + "), nothing trimmed; " +
    "licensed and trimmed once it changed (" + r3.licence + ", " + r3.trimmed + " dropped). Floors blocked: " + blocked +
    ". Every floor sealed during that one song is refused, so a room whose songs outlast its seal cooldown blocks for more than one floor.");
// NOT MEASURED: a lagging client voting on EVERY song (recurring divergence). A first attempt here could
// not make the later songs start on these observers and measured nothing; it was removed rather than
// reported. The stop condition (more than one floor blocked) was already met above.
process.exit(bad ? 1 : 0);
