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
  sb.Floor._setTrustedForTest({ n: 1, h: "h1", floorL: cut.l, grade: "verified", covers: "$s.." + cut.eventId, seed: seed, prev: null, thin: false });
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
if (failed) { console.log("[history-tallies] " + failed + " failure(s)"); process.exit(1); }
console.log("[history-tallies] PASS — a past song's final votes and saves stay in its history row (J73, owner): taken before a " +
  "decentralized trim and before a bot room moves on, never frozen while the song is live, shown by the panel where the " +
  "derived counts no longer have them, and kept in the stored table (" + asserts + " assertions)");
