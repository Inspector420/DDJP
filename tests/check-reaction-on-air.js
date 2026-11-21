#!/usr/bin/env node
// tests/check-reaction-on-air.js
// SUBJECT: backends/backend1/statederiver.js, backends/backend1/streammanager.js, features/reactions.js, features/rep-rules.js, features/rep-reader.js, features/rep-bot.js, backends/backend2/authority.js, backends/backend1/history.js
//
// WALL: A VOTE OR A SAVE, AND THE OWNER'S COUNT CHANGE, COUNTS ONLY FOR THE SONG ON AIR WHERE IT LANDS (740; the owner's words, in
// order, in `consensus/consensus-models.md` §Counts + owner adjustment: "late vote arent allowed", "well the room shouldent accept it
// and the history dosent need to corrwect it", "the bot can correct holes in the timeline, but yes noting to correct after / do it").
// Driven through the REAL modules: the reducer and the shared engine's door, the write side (`features/reactions.js`), REP's rules,
// ports and the reader's own wire (extracted and run), song history's fold, and the bot room's judge.
//   A  THE ROOM'S RULE: on air where it lands, accepted; a song that has ended, refused `not-on-air` — a vote, a save, the owner's count
//      change; the last-second vote ordered after the next play is that case; a room reset; a playing the room never saw start keeps
//      `unknown-play-instance` (a count change too), so the two are told apart.
//   B  ONE RULE, BOTH SIDES: the write side's question (`StreamManager.reactionOnAir`, the reducer's `reactionOnAir` on the state now) and
//      the fold's verdict on a reaction landing right there agree at every position of a room, for every playing.
//   C  THE WRITE SIDE SENDS NOTHING THE FOLD WOULD REFUSE (`features/reactions.js`): a vote on the song on air goes; a save captured on a
//      song that has since ended is not sent (the playlist add stands; no save is recorded); one on the song on air goes.
//   D  REP COUNTS NO REACTION THE ROOM REFUSES: held, by the fold's own verdict (`RepPorts.isLegal`); paged or forgotten, by song
//      history's rows (`RepRules.onAirAmong`), which refuse where they prove the song had ended and agree with the reducer wherever they
//      answer — and say nothing (counted, as before) where they cannot decide. The reader's own `_verdict` wire, extracted and run.
//   E  SONG HISTORY'S TALLIES NEVER INCLUDE ONE: a song's row holds the votes and saves cast while it played, never a late one.
//   F  THE BOT ROOM'S JUDGE DROPS ONE IN SILENCE: a vote or save for a song no longer on air — behind a play already committed, the race —
//      is refused with no `ddjp.bot.refused` (silent); one on the song on air stands.
// RED FIRST on `ddjp_739`: the late vote, save and count change accepted (A); no `reactionOnAir` (B, C); a late save sent (C); no
// `onAirAmong`, and the held late vote eligible (D); a late vote in the row's tally (E); the late vote relayed (F).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[reaction-on-air] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 700) : "")); }
  return !!c;
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[reaction-on-air] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });

const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "core/songs.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/activity.js", "backends/backend1/history.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js"];
const G = F.RANK.guest, O = F.RANK.owner;
const has = (o, k) => !!o && typeof o[k] === "function";

// ONE ROOM: three songs, then the reactions, each placed at a chosen position. `id`s are chosen so a same-position event sorts where the
// comment says (`$x…` and `$v…` after `$play…`; `$a…` before it).
function roomLog() {
  const room = F.playingRoom({ songs: 4 });
  const P = room.pis, lOf = (id) => room.log.find((e) => e.eventId === id).l, tsOf = (id) => room.log.find((e) => e.eventId === id).ts;
  const add = (id, l, ts, who, rank, body) => room.log.push(F.reducerEvent(id, l, ts, who, rank, body));
  add("$vOn", lOf(P[0]), tsOf(P[0]) + 1000, "@a:hs", G, { t: "ddjp.dj.vote", p: P[0] });                       // P0 on air
  add("$sOn", lOf(P[0]), tsOf(P[0]) + 2000, "@a:hs", G, { t: "ddjp.dj.save", p: P[0] });
  add("$xCOn", lOf(P[0]), tsOf(P[0]) + 3000, "@owner:hs", O, { t: "ddjp.count.set", k: "save", id: P[0], n: 4 });
  add("$vLate", lOf(P[1]), tsOf(P[1]) + 1000, "@b:hs", G, { t: "ddjp.dj.vote", p: P[0] });                     // P0 ended at P1
  add("$sLate", lOf(P[1]), tsOf(P[1]) + 2000, "@b:hs", G, { t: "ddjp.dj.save", p: P[0] });
  add("$xCPast", lOf(P[2]), tsOf(P[2]) + 1000, "@owner:hs", O, { t: "ddjp.count.set", k: "vote", id: P[0], n: 7 });
  add("$xCNoPlay", lOf(P[2]), tsOf(P[2]) + 2000, "@owner:hs", O, { t: "ddjp.count.set", k: "vote", id: "$noSuchPlay", n: 2 });
  add("$aEdge", lOf(P[2]), tsOf(P[2]) - 1, "@c:hs", G, { t: "ddjp.dj.vote", p: P[2] });                       // sorts BEFORE its own play
  add("$vSecond", lOf(P[3]) - 1, tsOf(P[3]) - 10, "@d:hs", G, { t: "ddjp.dj.vote", p: P[2] });                // P2's last second: on air
  add("$vRace", lOf(P[3]), tsOf(P[3]) + 5, "@e:hs", G, { t: "ddjp.dj.vote", p: P[2] });                       // ordered AFTER P3: the race
  add("$reset", room.lastL + 1, tsOf(P[3]) + 5000, "@owner:hs", O, { t: "ddjp.dj.reset" });
  add("$vReset", room.lastL + 2, tsOf(P[3]) + 6000, "@f:hs", G, { t: "ddjp.dj.vote", p: P[3] });
  return { room, P, log: F.sortLog(room.log) };
}
function sm(log) {
  const sb = loadInContext(B1F, {});
  sb.Floor.reset(); sb.StreamManager.reset(); sb.History.reset();
  for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
  return sb;
}

// ── A — THE ROOM'S RULE ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const W = roomLog();
{
  const sb = sm(W.log), SM = sb.StreamManager;
  const v = (id) => { const L = SM.isLegal(id); const r = SM.refusalOf ? SM.refusalOf(id) : null; return L === true ? "ACCEPTED" : (r ? r.code : String(L)); };
  ok(SM.getLog().length === W.log.length, "A PREMISE — every event reached the fold through the one door", { held: SM.getLog().length, log: W.log.length });
  ok(["$vOn", "$sOn", "$xCOn", "$vSecond"].every((id) => v(id) === "ACCEPTED"),
    "A: ON AIR WHERE IT LANDS — a vote, a save and the owner's count change on the song playing are accepted (a vote in that song's last second too)",
    ["$vOn", "$sOn", "$xCOn", "$vSecond"].map((id) => [id, v(id)]));
  ok(["$vLate", "$sLate", "$xCPast"].every((id) => v(id) === "not-on-air"),
    "A: A SONG THAT HAS ENDED — a vote, a save and the owner's count change on it are refused, `not-on-air`", ["$vLate", "$sLate", "$xCPast"].map((id) => [id, v(id)]));
  ok(v("$vRace") === "not-on-air", "A: THE LAST-SECOND VOTE ORDERED AFTER THE NEXT PLAY is refused, `not-on-air` — no message beyond the fold's own verdict", v("$vRace"));
  ok(v("$vReset") === "not-on-air", "A: a vote on the song that played before a reset is refused too — nothing is on air", v("$vReset"));
  ok(v("$xCNoPlay") === "unknown-play-instance" && v("$aEdge") === "unknown-play-instance",
    "A: a playing the room never saw start (a count change naming one; a vote sorting before its own play) keeps `unknown-play-instance`, told apart from `not-on-air`",
    { noPlay: v("$xCNoPlay"), edge: v("$aEdge") });
  const c = SM.getState().counts || {};
  ok(c[W.P[0]] && c[W.P[0]].votes === 1 && c[W.P[0]].saves === 4 && c[W.P[0]].savesAdjusted === true && !c[W.P[0]].votesAdjusted && !c["$noSuchPlay"],
    "A: the counts hold only what landed on air: P0 one vote, its saves the owner's 4 — no 7, no late save, no tally for a playing never seen", c);
  ok(sb.StateDeriver.refusalText("not-on-air", null) === "that song had already ended", "A: `not-on-air` reads \"that song had already ended\"", sb.StateDeriver.refusalText("not-on-air", null));
}

// ── B — ONE RULE, BOTH SIDES ────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const sb = loadInContext(B1F, {}), SD = sb.StateDeriver;
  ok(has(SD, "reactionOnAir"), "B PREMISE — the reducer exports its one predicate, `reactionOnAir`");
  const base = W.log.filter((e) => ["ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set", "ddjp.dj.reset"].indexOf(e.type) < 0);
  const cand = W.P.concat(["$noSuchPlay"]);
  let checked = 0, bad = [];
  for (let k = 1; k <= base.length && has(SD, "reactionOnAir"); k++) {
    const pre = base.slice(0, k), head = pre[pre.length - 1];
    const now = SD.derive(pre).nowPlaying;
    for (const pi of cand) {
      const probe = F.reducerEvent("$zProbe", head.l, head.ts + 1, "@w:hs", G, { t: "ddjp.dj.vote", p: pi });   // lands right after the prefix
      const took = SD.deriveAccepted(pre.concat([probe])).indexOf("$zProbe") >= 0;
      if (took !== (SD.reactionOnAir(now, pi) === true)) bad.push({ k, pi, took });
      checked++;
    }
  }
  ok(checked > 40 && bad.length === 0, "B: AT EVERY POSITION, FOR EVERY PLAYING, the write side's question and the fold's verdict on a vote landing there agree", { checked, bad: bad.slice(0, 4) });
  // the interface the write side reaches it through is the same predicate on the room as folded now
  const s2 = sm(base);
  const np = s2.StreamManager.getState().nowPlaying;
  ok(has(s2.StreamManager, "reactionOnAir") && cand.every((pi) => s2.StreamManager.reactionOnAir(pi) === (SD.reactionOnAir(np, pi) === true)) && s2.StreamManager.reactionOnAir(W.P[3]) === true,
    "B: `StreamManager.reactionOnAir(pi)` IS the reducer's predicate on the state now — the song on air yes, every other no", has(s2.StreamManager, "reactionOnAir") ? cand.map((pi) => [pi, s2.StreamManager.reactionOnAir(pi)]) : "missing");
}

// ── C — THE WRITE SIDE ──────────────────────────────────────────────────────────────────────────────────────────────────────────
(async () => {
  {
    const base = W.log.filter((e) => ["ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set", "ddjp.dj.reset"].indexOf(e.type) < 0);
    const upTo = (pi) => base.slice(0, base.findIndex((e) => e.eventId === pi) + 1);
    const sb = sm(upTo(W.P[2]));                 // P2 on air
    const sent = [];
    const MB = { getUserId: () => "@me:hs", async sendEvent(ch, t, c) { sent.push({ t, p: c && c.p }); return { eventId: "$sent" + sent.length }; } };
    const R = loadInContext(["core/logger.js", "features/reactions.js"], { StreamManager: sb.StreamManager, MatrixBridge: MB, Logger: sb.Logger }).Reactions;
    R.init("!ev:hs");
    const v = await R.vote();
    ok(v && v.ok === true && sent.length === 1 && sent[0].t === "ddjp.dj.vote" && sent[0].p === W.P[2], "C: A VOTE ON THE SONG ON AIR GOES, naming it", { v, sent });
    const s1 = await R.recordSave(W.P[1]);           // captured when ★ was pressed, the song since ended (the picker was open)
    ok(s1 && s1.ok === false && /ended/.test(s1.reason || "") && sent.length === 1,
      "C: A SAVE CAPTURED ON A SONG THAT HAS SINCE ENDED IS NOT SENT — the playlist add stands, no save is recorded", { s1, sent });
    const s2 = await R.recordSave(W.P[2]);
    const lastSent = sent[sent.length - 1] || {};
    ok(s2 && s2.ok === true && lastSent.t === "ddjp.dj.save" && lastSent.p === W.P[2], "C: CONTROL — a save on the song on air goes", { s2, sent });
    const src = fs.readFileSync(path.join(ROOT, "features/reactions.js"), "utf8");
    ok(/StreamManager\.reactionOnAir\(pi\)/.test(src) && !/nowPlaying\.pi\s*===\s*pi/.test(src),
      "C (TEXTUAL, beside the driven rows): the write side asks the interface for the reducer's predicate and keeps no copy of it");
  }

  // ── D — REP COUNTS NO REACTION THE ROOM REFUSES ─────────────────────────────────────────────────────────────────────────────────
  {
    const sb = sm(W.log);
    sb.History.attach({ log: () => sb.StreamManager.getLog(), seed: () => undefined }); sb.History.refresh();
    const MB = { roomHistory: (limit) => sb.History.recent(limit) };   // the bridge's own `roomHistory` (History.recent)
    const RP = loadInContext(["features/rep-ports.js"], { StreamManager: sb.StreamManager, MatrixBridge: MB }).RepPorts;
    const RR = loadInContext(["features/rep-rules.js"], {}).RepRules;
    ok(has(RR, "onAirAmong"), "D PREMISE — REP's rules carry `onAirAmong`");
    const rows = (RP.playings() || []).filter((r) => typeof r.l === "number").sort((a, b) => RR.compareAt(a.l, a.pi, b.l, b.pi));
    ok(rows.length === 4, "D PREMISE — song history's rows reach REP through its port, all four playings", rows.map((r) => r.pi));
    // HELD: the fold's verdict, through REP's port, is what REP is handed as `eligible`
    const playing = (pi) => rows.find((r) => r.pi === pi) || null;
    const held = (id) => { const e = W.log.find((x) => x.eventId === id); const a = RR.newAccumulator();
      return RR.add(a, { type: e.type, voter: e.sender, pi: e.content.p }, playing(e.content.p), null, RP.isLegal(id) !== false); };
    ok(held("$vOn").added === true && ["$vLate", "$sLate", "$vRace"].every((id) => held(id).added === false && held(id).why === "not eligible"),
      "D: HELD — REP takes the fold's word: the vote on air counts; the late vote, the late save and the race vote do not", ["$vOn", "$vLate", "$sLate", "$vRace"].map((id) => [id, held(id)]));
    // PAGED OR FORGOTTEN: no fold judged it — song history's rows decide where they can, and agree with the reducer wherever they answer
    const reacts = W.log.filter((e) => e.type === "ddjp.dj.vote" || e.type === "ddjp.dj.save");
    const ans = reacts.map((e) => ({ id: e.eventId, rows: has(RR, "onAirAmong") ? RR.onAirAmong(rows, { pi: e.content.p, l: e.l, id: e.eventId }) : "missing", fold: sb.StreamManager.isLegal(e.eventId) }));
    ok(ans.every((a) => a.rows === null || (a.rows === false && a.fold === false)),
      "D: PAGED — wherever the rows answer, they answer as the reducer did (a refusal the fold made); never `true`", ans);
    ok(["$vLate", "$sLate", "$vRace", "$aEdge"].every((id) => (ans.find((a) => a.id === id) || {}).rows === false),
      "D: and they PROVE the ended-song cases — a later song had started, or it sorts before its own song", ans.filter((a) => ["$vLate", "$sLate", "$vRace", "$aEdge"].indexOf(a.id) >= 0));
    ok((ans.find((a) => a.id === "$vReset") || {}).rows === null && (ans.find((a) => a.id === "$vOn") || {}).rows === null,
      "D: CANNOT DECIDE — an ending with no next song (the reset), and a song's own on-air vote before the next row: null, counted as before (the documented gap)",
      ans.filter((a) => a.id === "$vReset" || a.id === "$vOn"));
    const paged = (id) => { const e = W.log.find((x) => x.eventId === id); const a = RR.newAccumulator();
      return RR.add(a, { type: e.type, voter: e.sender, pi: e.content.p }, playing(e.content.p), null, true, has(RR, "onAirAmong") ? RR.onAirAmong(rows, { pi: e.content.p, l: e.l, id: id }) : undefined); };
    ok(paged("$vLate").added === false && paged("$vLate").why === "not on air where it landed" && paged("$vOn").added === true,
      "D: PAGED, AS REP COUNTS IT — the late vote is not counted, the vote on air is", { late: paged("$vLate"), on: paged("$vOn") });
    // THE READER'S OWN WIRE, extracted from `features/rep-reader.js` and run: `_refreshPlays` and `_verdict` over the real ports
    const src = fs.readFileSync(path.join(ROOT, "features/rep-reader.js"), "utf8");
    const grab = (name) => { const i = src.indexOf("  function " + name + "("); if (i < 0) return null; const j = src.indexOf("\n  }\n", i); return j < 0 ? null : src.slice(i, j + 4); };
    const body = [grab("_now"), grab("_refreshPlays"), grab("_verdict")];
    ok(body.every(Boolean), "D PREMISE — the reader's `_now`, `_refreshPlays` and `_verdict` were found to run", body.map((b) => !!b));
    if (body.every(Boolean)) {
      const RP2 = Object.assign({}, RP, { serverNow: () => 5, isLegal: (id) => (id === "$vLate" ? null : RP.isLegal(id)) });   // $vLate: as if paged
      const run = new Function("RepPorts", "RepRules", body.join("\n") + "\nreturn { _refreshPlays, _verdict };")(RP2, RR);
      const st = { plays: Object.create(null), order: [], playsAt: null };
      run._refreshPlays(st);
      const e = (id) => W.log.find((x) => x.eventId === id);
      const vl = run._verdict(st, e("$vLate")), vr = run._verdict(st, e("$vRace")), vo = run._verdict(st, e("$vOn"));
      ok(vl.eligible === true && vl.onAir === false && vr.eligible === false && vo.eligible === true && vo.onAir === null,
        "D: THE READER'S `_verdict` — a paged late vote refused by the rows, a held race vote by the fold, a held vote on air counted", { vl, vr, vo });
      // ...and the bot side's own wire, the same way (`features/rep-bot.js`)
      const bsrc = fs.readFileSync(path.join(ROOT, "features/rep-bot.js"), "utf8");
      const bgrab = (name) => { const i = bsrc.indexOf("  function " + name + "("); if (i < 0) return null; const j = bsrc.indexOf("\n  }\n", i); return j < 0 ? null : bsrc.slice(i, j + 4); };
      const bbody = [bgrab("_now"), bgrab("_refreshPlays"), bgrab("_verdict")];
      ok(bbody.every(Boolean), "D PREMISE — the bot side's `_now`, `_refreshPlays` and `_verdict` were found to run", bbody.map((b) => !!b));
      if (bbody.every(Boolean)) {
        const brun = new Function("RepPorts", "RepRules", bbody.join("\n") + "\nreturn { _refreshPlays, _verdict };")(RP2, RR);
        const bs = { plays: Object.create(null), order: [], playsAt: null };
        brun._refreshPlays(bs);
        const bl = brun._verdict(bs, e("$vLate")), br = brun._verdict(bs, e("$vRace")), bo = brun._verdict(bs, e("$vOn"));
        ok(bl.eligible === true && bl.onAir === false && br.eligible === false && bo.eligible === true && bo.onAir === null,
          "D: THE BOT SIDE'S `_verdict` — the same answers: a paged late vote refused by the rows, a held race vote by the fold, a held vote on air counted", { bl, br, bo });
      }
      ok(/const vd = _verdict\(r, e\);\s*const res = RepRules\.add\([^)]*vd\.eligible, vd\.onAir\)/.test(src) &&
         /const vd = _verdict\(s, e\);\s*const res = RepRules\.add\([^)]*vd\.eligible, vd\.onAir\)/.test(fs.readFileSync(path.join(ROOT, "features/rep-bot.js"), "utf8")),
        "D (TEXTUAL, beside the driven rows): the reader's and the bot side's count hand `_verdict`'s answer to `RepRules.add`");
    }
  }

  // ── E — SONG HISTORY'S TALLIES ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const sb = loadInContext(B1F, {}); sb.History.reset();
    sb.History.attach({ log: () => W.log, seed: () => undefined }); sb.History.refresh();
    const row = (pi) => (sb.History.recent().find((h) => h.pi === pi) || {}).counts || null;
    ok(row(W.P[0]) && row(W.P[0]).votes === 1 && row(W.P[0]).saves === 4 && row(W.P[2]) && row(W.P[2]).votes === 1,
      "E: A SONG'S ROW HOLDS WHAT LANDED WHILE IT PLAYED — P0 one vote and the owner's 4 saves, P2 its last-second vote — never the late vote, save, count change or race vote",
      { p0: row(W.P[0]), p2: row(W.P[2]) });
  }

  // ── F — THE BOT ROOM'S JUDGE ────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "core/songs.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "backends/backend2/authority.js"], {});
    const A = sb.B2Authority, SD = sb.StateDeriver;
    const base = W.log.filter((e) => ["ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set", "ddjp.dj.reset"].indexOf(e.type) < 0);
    const upto = base.slice(0, base.findIndex((e) => e.eventId === W.P[2]) + 1), last = upto[upto.length - 1];
    // P2 on air, and later in it: a join well past its start, so a play the bot commits now is not judged too early
    const log = upto.concat([F.reducerEvent("$fill", last.l + 1, last.ts + W.room.gapMs, "@n:hs", G, { t: "ddjp.dj.join", v: F.song(90) })]);
    const st = SD.derive(log), ctx = { log: log };
    A.reset();
    const late = A.evaluate({ t: "ddjp.dj.vote", p: W.P[1], actor: "@j:hs" }, st, G, ctx);
    const lateSave = A.evaluate({ t: "ddjp.dj.save", p: W.P[0], actor: "@j:hs" }, st, G, ctx);
    const on = A.evaluate({ t: "ddjp.dj.vote", p: W.P[2], actor: "@j:hs" }, st, G, ctx);
    ok(on && on.ok === true, "F: CONTROL — a vote on the song on air stands", on);
    ok(late && late.ok === false && late.silent === true && late.code === "not-on-air" && lateSave && lateSave.ok === false && lateSave.silent === true,
      "F: A VOTE OR SAVE FOR A SONG NO LONGER ON AIR IS DROPPED IN SILENCE — no `ddjp.bot.refused`", { late, lateSave });
    // the race: the bot has committed the next play (not yet echoed); a vote for the song it ends lands behind it
    A.submit(A.stamp({ t: "ddjp.dj.play", p: W.P[2] }, "@bot:hs", O, null, null));
    const race = A.evaluate({ t: "ddjp.dj.vote", p: W.P[2], actor: "@k:hs" }, st, G, ctx);
    ok(race && race.ok === false && race.silent === true && race.code === "not-on-air",
      "F: THE RACE — the next play already committed, a vote for the song it ends would land behind it: dropped in silence", race);
    A.reset();
  }

  _finished = true;
  if (failed) { console.log("[reaction-on-air] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[reaction-on-air] PASS — A VOTE, A SAVE OR THE OWNER'S COUNT CHANGE COUNTS ONLY FOR THE SONG ON AIR WHERE IT LANDS (740; " + asserts +
    " assertions, through the real modules). A song that has ended refuses it (`not-on-air`), the last-second vote ordered after the next play " +
    "included; a playing never seen keeps `unknown-play-instance`. ONE RULE, BOTH SIDES: the write side's question and the fold's verdict agree " +
    "at every position, and the write side sends nothing the fold would refuse. REP counts none the room refused — held by the fold's word, paged " +
    "by song history's rows where they can tell. Song history's tallies never include one. The bot room's judge drops one in silence.");
})();
