// tests/check-licence-fields.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: ONE BEFORE-FORGETTING CHECK FOR BOTH ROOM TYPES (J73 job 7b).
//
// A decentralized room's licence to forget compared only nowPlaying, rotation and settings (`_canon`),
// while a bot room's move-on compared every derived field a drop could change (`REPRODUCE_FIELDS`). So
// a decentralized seed wrong only in its live counts or its advance view was licensed. Now both use the
// same field list and the same live-song counts — and honest floors must validate as often as before.
//   PART A — a seed that differs ONLY in the live song's counts is refused, and nothing is trimmed.
//   PART B — a seed that differs ONLY in the advance view is refused, and nothing is trimmed.
//   PART C — honest floors across a varied population are all licensed, and pass the bot room's check.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[licence-fields] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const FIELDS = ["nowPlaying", "rotation", "settings", "counts", "advance"];
const P = F.RANK.player, O = F.RANK.owner;
// Trim a client holding `log` to a floor cut at `boundaryId` with `seed` (tampered or not).
function trial(log, boundaryId, tamper) {
  const sb = loadInContext(FILES, {}); const SM = sb.StreamManager, S = sb.StateDeriver;
  sb.Floor.reset(); SM.reset(); log.forEach((e) => SM.ingest(F.toRaw(e)));
  const ord = SM.getLog(); const b = ord.find((e) => e.eventId === boundaryId);
  let seed = S.buildSeed(ord.slice(0, ord.indexOf(b) + 1), undefined);
  const honest = JSON.parse(JSON.stringify(seed));
  if (tamper) seed = tamper(JSON.parse(JSON.stringify(seed)));
  const diff = FIELDS.filter((k) => JSON.stringify(S.derive([], seed)[k]) !== JSON.stringify(S.derive([], honest)[k]));
  const f = { n: 1, h: "h1", floorL: b.l, grade: "verified", covers: ord[0].eventId + ".." + b.eventId, seed: seed, prev: null, thin: false };
  sb.Floor._setTrustedForTest(F.real(sb.Floor, f));
  const bot = SM.reproduces({ floorL: b.l, covers: f.covers, seed: seed });
  const dropped = SM.trimToFloor();
  return { dropped, licence: SM.seedValidation().status, diff, bot };
}
// The live song has votes and a declared length both before and after the cut, and no play follows it,
// so a wrong live tally or advance view in the seed stays visible after the cut.
function liveLog(S) {
  const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() }),
    F.reducerEvent("$j1", 2, 2000, "@a:hs", P, { t: "ddjp.dj.join", v: "vidA0000001" }),
    F.reducerEvent("$j2", 3, 2100, "@b:hs", P, { t: "ddjp.dj.join", v: "vidB0000001" }),
    F.reducerEvent("$p1", 4, 9000, "@a:hs", P, { t: "ddjp.dj.play", p: null }),
    F.reducerEvent("$v1", 5, 9500, "@c:hs", P, { t: "ddjp.dj.vote", p: "$p1" }),
    F.reducerEvent("$len", 6, 9600, "@c:hs", P, { t: "ddjp.play.len", pi: "$p1", sec: 200 }),
    F.reducerEvent("$v2", 7, 9700, "@d:hs", P, { t: "ddjp.dj.vote", p: "$p1" }),
    F.reducerEvent("$v3", 8, 9800, "@e:hs", P, { t: "ddjp.dj.vote", p: "$p1" })];
  return ev;
}
{
  const S = loadInContext(FILES, {}).StateDeriver; const log = liveLog(S);
  const honest = trial(log, "$v2", null);
  ok(honest.licence === "validated" && honest.dropped > 0 && honest.bot.ok === true, "A/B CONTROL: the honest floor is licensed and trims", honest);
  // The LEDGER's shape, not the derived one: votes are `v: { base, set, users }`.
  const counts = trial(log, "$v2", (s) => { s.ledger.counts["$p1"].v.base += 5; return s; });
  ok(JSON.stringify(counts.diff) === "[\"counts\"]", "A PREMISE — the tampered seed differs only in counts", counts.diff);
  ok(counts.licence !== "validated" && counts.dropped === 0, "A: a decentralized seed wrong only in the live song's counts is refused; nothing trimmed", counts);
  const adv = trial(log, "$v2", (s) => { s.liveDecl.len = Object.assign({}, s.liveDecl.len, { "@z:hs": { sec: 321, tier: 1 } }); return s; });
  ok(JSON.stringify(adv.diff) === "[\"advance\"]", "B PREMISE — the tampered seed differs only in the advance view", adv.diff);
  ok(adv.licence !== "validated" && adv.dropped === 0, "B: a decentralized seed wrong only in its advance view is refused; nothing trimmed", adv);
}
// ── PART C — honest floors, a varied population ─────────────────────────────────────────────
{
  const S = loadInContext(FILES, {}).StateDeriver;
  let seedN = 7; const rnd = () => (seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648;
  let total = 0, licensed = 0, botOk = 0; const bad = [];
  for (let room = 0; room < 20; room++) {
    const ev = [F.reducerEvent("$s", 1, 1000, "@owner:hs", O, { t: "ddjp.room.settings", s: S.defaultSettings() })];
    let l = 2, ts = 2000, prev = null, n = 0;
    const add = (who) => { ev.push(F.reducerEvent("$a" + n, l++, ts += 50, who, P, { t: "ddjp.dj.join", v: "vid" + String(n).padStart(8, "0") })); n++; };
    for (let u = 0; u < 4; u++) { add("@u" + u + ":hs"); add("@u" + u + ":hs"); }
    for (let r = 0; r < 10; r++) {
      const id = "$p" + r;
      ev.push(F.reducerEvent(id, l++, ts += 240000, "@u0:hs", P, { t: "ddjp.dj.play", p: prev })); prev = id;
      const k = Math.floor(rnd() * 5);
      for (let v = 0; v < k; v++) ev.push(F.reducerEvent("$v" + r + "_" + v, l++, ts += 1000, "@l" + v + ":hs", P, { t: rnd() < 0.7 ? "ddjp.dj.vote" : "ddjp.dj.save", p: id }));
      if (rnd() < 0.5) ev.push(F.reducerEvent("$len" + r, l++, ts += 500, "@l8:hs", P, { t: "ddjp.play.len", pi: id, sec: 120 + Math.floor(rnd() * 200) }));
      if (rnd() < 0.2) ev.push(F.reducerEvent("$set" + r, l++, ts += 500, "@owner:hs", O, { t: "ddjp.room.settings", s: Object.assign(S.defaultSettings(), { maxLen: 300 + r }) }));
      if (rnd() < 0.2) ev.push(F.reducerEvent("$bare" + r, l++, ts += 500, "@x" + r + ":hs", P, { t: "ddjp.dj.join" }));
      if (rnd() < 0.15) ev.push(F.reducerEvent("$lv" + r, l++, ts += 500, "@nobody:hs", P, { t: "ddjp.dj.leave" }));
      add("@u" + (r % 4) + ":hs");
    }
    for (const at of [Math.floor(ev.length * 0.4), Math.floor(ev.length * 0.75)]) {
      const t = trial(ev, ev[at].eventId, null); total++;
      if (t.licence === "validated" && t.dropped > 0) licensed++; else bad.push({ room, at, t });
      if (t.bot && t.bot.ok) botOk++;
    }
  }
  ok(total === 40 && licensed === total, "C: every honest floor in a varied population is licensed — the wider check costs no forgetting " +
    "(it compares a superset of the old fields, so the old check could not have licensed more)", { total, licensed, bad: bad.slice(0, 2) });
  ok(botOk === total, "C: and every one passes the bot room's check too — one check for both room types", { total, botOk });
}
if (failed) { console.log("[licence-fields] " + failed + " failure(s)"); process.exit(1); }
console.log("[licence-fields] PASS — one before-forgetting check for both room types (J73 job 7b): a decentralized seed wrong " +
  "only in its live counts or only in its advance view is refused with nothing trimmed, and all 40 honest floors across a " +
  "varied population are still licensed and pass the bot room's check (" + asserts + " assertions)");
