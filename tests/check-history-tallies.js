// tests/check-history-tallies.js
// SUBJECT: backends/backend1/history.js, backends/backend1/streammanager.js, backends/backend2/streammanager.js, ui/panels.js
// WALL: A PAST SONG'S FINAL VOTES AND SAVES STAY IN ITS HISTORY ROW (J73, owner `ddjp_518`).
//
// The derived `counts` holds every play's tally in the folded window, but a seed carries only the live
// song's — past tallies are history — so they left the derived state at every save point and every
// trim, and the history panel (`counts[h.pi]`) showed nothing for them. The owner: when a play ends,
// store its final counts in its song-history row, taken before anything is dropped.
//   PART A — a decentralized trim: every ended play's row carries the reference reader's tally.
//   PART B — a bot room moving on: the same.
//   PART C — the live song's tally is not frozen early; its row gets the FINAL one when it ends.
//   PART D — the panel reads the row's own tally where the derived counts no longer have it.
//   PART E — the stored table keeps them.
//   PART F — and the backfill a trim rearms keeps them (J96): its verify rewrites every closed song's row without a tally, and
//            those rows replaced the rows that had one — on every tab, a tab that held every event included (found at J95).
//   PART G — but a LATER count replaces the stored one (J97, the supervisor's J96 check: putting the row's tally before a
//            fold's stayed green): a late vote on a finished song, and an owner's count change on it, reach its row at the next
//            fold — and verify after them keeps the new figure.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[history-tallies] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/activity.js", "backends/backend1/history.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const P = F.RANK.player, O = F.RANK.owner;
// A room: settings, songs from four DJs, then rounds of a play followed by votes and saves on it.
function roomLog(S, rounds) {
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })];
  let l = 2, ts = 2000, prev = null, n = 0;
  const add = (who) => { ev.push(F.reducerEvent("$a" + n, l++, ts += 50, who, P, { t: "ddjp.dj.join", v: "vid" + String(n).padStart(8, "0") })); n++; };
  for (let u = 0; u < 4; u++) { add("@u" + u + ":hs"); add("@u" + u + ":hs"); }
  for (let r = 0; r < rounds; r++) {
    const id = "$p" + r;
    ev.push(F.reducerEvent(id, l++, ts += 240000, "@u0:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id;
    for (let v = 0; v < (r % 4) + 1; v++) ev.push(F.reducerEvent("$v" + r + "_" + v, l++, ts += 1000, "@l" + v + ":hs", P, { t: "ddjp.dj.vote", p: id }));
    if (r % 2 === 0) ev.push(F.reducerEvent("$sv" + r, l++, ts += 1000, "@l9:hs", P, { t: "ddjp.dj.save", p: id }));
    add("@u" + (r % 4) + ":hs");
  }
  return ev;
}
const tally = (c) => c ? { votes: c.votes || 0, saves: c.saves || 0 } : null;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// ── PART A — a decentralized trim ───────────────────────────────────────────────────────────
{
  const sb = loadInContext(B1F, {}); const S = sb.StateDeriver, SM = sb.StreamManager, H = sb.History;
  const LOG = roomLog(S, 12);
  sb.Floor.reset(); SM.reset(); H.reset();
  LOG.forEach((e) => SM.ingest(F.toRaw(e)));
  const ref = SM.getState();
  ok(Object.keys(ref.counts).length >= 10 && Object.values(ref.counts).some((c) => c.saves > 0), "A PREMISE — the reference reader has tallies, saves among them");
  const ord = SM.getLog(); const cut = ord.find((e) => e.eventId === "$p7");
  const seed = S.buildSeed(ord.slice(0, ord.indexOf(cut) + 1), undefined);
  sb.Floor._setTrustedForTest(F.real(sb.Floor, { n: 1, h: "h1", floorL: cut.l, grade: "verified", covers: "$s.." + cut.eventId, seed: seed, prev: null, thin: false }));
  const dropped = SM.trimToFloor();
  ok(dropped > 0 && SM.seedValidation().status === "validated", "A PREMISE — the trim happens, licensed", { dropped, v: SM.seedValidation() });
  const ended = ["$p0", "$p1", "$p2", "$p3", "$p4", "$p5", "$p6"];
  const rows = Object.fromEntries(H.recent().map((h) => [h.pi, h]));
  ok(ended.every((pi) => rows[pi] && same(rows[pi].counts, tally(ref.counts[pi]))),
    "A: every play that ended before the cut keeps the reference reader's final tally in its row", ended.map((pi) => [pi, rows[pi] && rows[pi].counts, tally(ref.counts[pi])]));
  ok(ended.every((pi) => !SM.getState().counts[pi]), "A PREMISE — the derived counts no longer have them: the row is the only place they live");
}
// ── PART B — a bot room moving on ───────────────────────────────────────────────────────────
{
  const sb = loadInContext(B1F.concat(["backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"]), {});
  const D = sb.B2StreamManager, B1 = sb.B1StreamManager, H = sb.History;
  D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); H.reset();
  const R = sb.Ranks;
  const LOG = roomLog(sb.StateDeriver, 16);
  const relays = LOG.map((e) => ({ event_id: e.eventId, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: e.ts,
    content: { body: JSON.stringify(Object.assign({}, e.content, { l: e.l, actor: e.sender, rank: e.sender === "@owner:hs" ? R.levelOf("owner") : R.levelOf("player") })) } }));
  const ref = (() => { const r = loadInContext(B1F, {}); r.Floor.reset(); r.StreamManager.reset(); LOG.forEach((e) => r.StreamManager.ingest(F.toRaw(e))); return r.StreamManager.getState(); })();
  let k = 0, opened = false;
  for (const r of relays) {
    D.ingest(r);
    if (++k % 20 === 0) {
      const log = B1.getLog(), last = log[log.length - 1];
      const c = sb.B2Checkpoint.seal(sb.StateDeriver.buildSeed(log, B1.floorSeed() || undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
      D.ingest({ event_id: "$cp" + last.l, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: last.ts + 1, content: { body: JSON.stringify(Object.assign({}, c, { l: last.l + 1 })) } });
      if (!opened) { D.openFromSavePoint(); opened = true; }
    }
  }
  ok(D.lastMoveOn() && D.lastMoveOn().ok === true, "B PREMISE — the door moved on", D.lastMoveOn());
  const live = B1.getState().nowPlaying.pi;
  const gone = Object.keys(ref.counts).filter((pi) => pi !== live && !B1.getState().counts[pi]);
  const rows = Object.fromEntries(H.recent().map((h) => [h.pi, h]));
  ok(gone.length > 0 && gone.every((pi) => rows[pi] && same(rows[pi].counts, tally(ref.counts[pi]))),
    "B: every ended play whose tally left the derived state keeps it in its row", gone.filter((pi) => !(rows[pi] && same(rows[pi].counts, tally(ref.counts[pi])))));
}
// ── PART C — the live tally is not frozen early ─────────────────────────────────────────────
{
  const sb = loadInContext(B1F, {}); const S = sb.StateDeriver, H = sb.History; H.reset();
  const ev = roomLog(S, 0);
  const play = F.reducerEvent("$live", 20, 300000, "@u0:hs", P, { t: "ddjp.dj.play", p: null });
  const log = ev.concat([play, F.reducerEvent("$x1", 21, 301000, "@l1:hs", P, { t: "ddjp.dj.vote", p: "$live" })]);
  H.attach({ log: () => log, seed: () => undefined }); H.refresh();
  const r1 = H.recent().find((h) => h.pi === "$live");
  ok(!!r1 && !r1.counts, "C: while the song is live its row has no tally yet", r1);
  log.push(F.reducerEvent("$x2", 22, 302000, "@l2:hs", P, { t: "ddjp.dj.vote", p: "$live" }));
  log.push(F.reducerEvent("$x3", 23, 303000, "@l3:hs", P, { t: "ddjp.dj.save", p: "$live" }));
  log.push(F.reducerEvent("$next", 24, 600000, "@u1:hs", P, { t: "ddjp.dj.play", p: "$live" }));
  H.refresh();
  const r2 = H.recent().find((h) => h.pi === "$live");
  ok(!!r2 && same(r2.counts, { votes: 2, saves: 1 }), "C: when it ends, its row gets the FINAL tally — not the one it had mid-song", r2 && r2.counts);
}
// ── PART D — the panel reads the row's own tally ────────────────────────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, "ui/panels.js"), "utf8");
  const i = src.indexOf("    function rowCounts(cs, h) {"); const j = src.indexOf("}\n", i) + 2;
  const rowCounts = new Function(src.slice(i, j) + "\nreturn rowCounts;")();
  ok(same(rowCounts({ $a: { votes: 5 } }, { pi: "$a", counts: { votes: 1 } }), { votes: 5 }), "D: a live derived tally is shown when there is one");
  ok(same(rowCounts({}, { pi: "$a", counts: { votes: 3, saves: 1 } }), { votes: 3, saves: 1 }), "D: where the derived counts no longer have it, the row's own tally is shown");
  ok(rowCounts({}, { pi: "$a" }) === null, "D: neither — nothing shown, as before");
  ok(/rows\.forEach\(\(h\) => \{\n\s*const c = rowCounts\(counts, h\);/.test(src), "D: the history list renders through it");
}
// ── PART E — the stored table keeps them ────────────────────────────────────────────────────
{
  const sb = loadInContext(B1F, {}); const H = sb.History; H.reset();
  H.restore({ v: 2, rows: [{ pi: "$q", videoId: "v", dj: "@a:hs", at: 1, l: 5, counts: { votes: 4, saves: 2 } }], ranges: [[0, 9]], adds: {} });
  const snap = JSON.parse(JSON.stringify(H.snapshot()));
  const H2 = loadInContext(B1F, {}).History; H2.reset(); H2.restore(snap);
  ok(same((H2.recent()[0] || {}).counts, { votes: 4, saves: 2 }), "E: a row's tally survives the stored table and a reload");
}
// ── PART G — a later count replaces the stored one (J97, the supervisor's J96 check) ───────────────────────────────────────
// J96 keeps the tally a row holds when another path rewrites it with none, and a fold's own figure still comes first. Which one
// wins was never pinned: putting the row's held tally first stayed green, because every fold in A–F reads a song's tally as it
// was when it ended. A count can move after that: a late vote on a finished song, and the owner's count change (`ddjp.count.set`,
// an absolute figure for the playing it names). Each reaches the row at the next fold, and replaces the one it held.
{
  const sb = loadInContext(B1F, {}); const S = sb.StateDeriver, H = sb.History; H.reset();
  const log = roomLog(S, 0).concat([
    F.reducerEvent("$a", 20, 300000, "@u0:hs", P, { t: "ddjp.dj.play", p: null }),
    F.reducerEvent("$a1", 21, 301000, "@l1:hs", P, { t: "ddjp.dj.vote", p: "$a" }),
    F.reducerEvent("$a2", 22, 302000, "@l2:hs", P, { t: "ddjp.dj.vote", p: "$a" }),
    F.reducerEvent("$b", 23, 600000, "@u1:hs", P, { t: "ddjp.dj.play", p: "$a" })]);
  H.attach({ log: () => log, seed: () => undefined }); H.refresh();
  const row = () => tally((H.recent().find((h) => h.pi === "$a") || {}).counts);
  ok(same(row(), { votes: 2, saves: 0 }), "G PREMISE — the finished song's row holds its final tally", row());
  log.push(F.reducerEvent("$late", 24, 601000, "@l3:hs", P, { t: "ddjp.dj.vote", p: "$a" }));      // after the song ended
  log.push(F.reducerEvent("$c", 25, 900000, "@u2:hs", P, { t: "ddjp.dj.play", p: "$b" }));
  H.refresh();
  ok(same(row(), { votes: 3, saves: 0 }), "G: A LATE VOTE ON A FINISHED SONG REPLACES THE TALLY ITS ROW HELD, at the next fold", row());
  log.push(F.reducerEvent("$set", 26, 901000, "@owner:hs", O, { t: "ddjp.count.set", k: "vote", id: "$a", n: 10 }));
  log.push(F.reducerEvent("$d", 27, 1200000, "@u3:hs", P, { t: "ddjp.dj.play", p: "$c" }));
  H.refresh();
  ok(same(row(), { votes: 10, saves: 0 }), "G: AND SO DOES THE OWNER'S COUNT CHANGE ON IT", row());
  const v = H.verifyFrom(log.slice(), []);
  ok(v && v.ok && same(row(), { votes: 10, saves: 0 }), "G: and verify after them keeps the new figure (J96)", { v: v, row: row() });
}
// ── PART F — and the backfill a trim rearms keeps them (J96, the owner's call on J95's finding) ───────────────────────────
// A trim rearms song history's backfill (`MatrixBridge.rearmHistoryBackfill`, a 0 ms timeout in a browser). Its verify rewrites
// every closed song's row from the room, and those rows carry no tally: they replaced the rows that had one, so past tallies left
// song history moments after every trim, on every tab (found at J95; already so at `ddjp_589`). Driven with the real bridge on
// the owner's reopen (`tests/_reopen.js`): the tab that held every event, and the reopened tab, after the trim AND its backfill.
async function partF() {
  const W = require(path.join(__dirname, "_botroom.js"));
  const { settle, story } = require(path.join(__dirname, "_reopen.js"));
  const { R, T, G, play } = await story({ joinInStretch: W.VIP });
  for (const who of [W.HS, W.BOT]) R.put(who, { t: "ddjp.dj.vote", p: play.event_id });
  R.now += 5 * 60000;
  R.put(W.OWNER, { t: "ddjp.dj.play", p: play.event_id });   // the play the votes were on ends inside what the trim drops
  const cp = await R.seal(T); await settle(50);
  const tallied = (w) => w.sb.History.recent().filter((r) => r && r.counts).map((r) => r.pi + "|" + r.counts.votes + "/" + r.counts.saves).sort();
  const before = { T: tallied(T), G: tallied(G) };
  ok(cp && before.G.length >= 5 && before.G.indexOf(play.event_id + "|2/0") >= 0 && JSON.stringify(before.T) === JSON.stringify(before.G),
    "F PREMISE — after the trim both tabs hold every past song's tally (the dropped play's two votes among them)", before);
  const backfill = (w) => w.timers.live().filter((t) => t.ms === 0 && /backfillHistory/.test(String(t.fn)));
  ok(backfill(T).length >= 1 && backfill(G).length >= 1, "F PREMISE — the trim rearmed song history's backfill on both tabs",
    { T: backfill(T).length, G: backfill(G).length });
  const at = { T: T.logs.length, G: G.logs.length };
  for (const w of [T, G]) for (const t of backfill(w)) t.fn();   // its 0 ms timeout, as a browser would run it
  await settle(50);
  ok(T.said(/history — verified \d+ segment/, at.T).length >= 1 && G.said(/history — verified \d+ segment/, at.G).length >= 1,
    "F PREMISE — the backfill ran verify on both tabs", { T: T.said(/history —/, at.T), G: G.said(/history —/, at.G) });
  ok(JSON.stringify(tallied(G)) === JSON.stringify(before.G),
    "F: AFTER THE BACKFILL'S VERIFY, THE TAB THAT HELD EVERY EVENT KEEPS EVERY PAST SONG'S TALLY", { now: tallied(G), before: before.G });
  ok(JSON.stringify(tallied(T)) === JSON.stringify(tallied(G)),
    "F: AND SO DOES THE REOPENED TAB, equal to it", { T: tallied(T), G: tallied(G) });
}
partF().then(() => {
  if (failed) { console.log("[history-tallies] " + failed + " failure(s)"); process.exit(1); }
  console.log("[history-tallies] PASS — a past song's final votes and saves stay in its history row (J73, owner): taken before a " +
    "decentralized trim and before a bot room moves on, never frozen while the song is live, shown by the panel where the " +
    "derived counts no longer have them, kept in the stored table, and kept when the backfill a trim rearms runs verify " +
    "over every closed song — on the tab that held every event and on a reopened one (J96); and a LATER count — a late vote on a " +
    "finished song, the owner's count change — replaces the one the row held (J97) (" + asserts + " assertions)");
  process.exit(0);
}, (e) => { console.log("[history-tallies] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
