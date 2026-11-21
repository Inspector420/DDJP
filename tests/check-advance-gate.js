// tests/check-advance-gate.js
// SUBJECT: backends/backend1/statederiver.js
// WALL: WHEN A SONG MAY MOVE ON. This is the grief-proofing core — the rule that stops
// anyone ending anyone's song a second in by relabelling a skip as a play.
//
// A PLAIN PLAY (an automatic advance) is rejected unless its committed server stamp clears BOTH floors:
//   • minGate — the absolute floor, so even a 3-second song waits for the ordered cascade;
//   • agreed length − grace — once a well-supported length has been folded.
// An AVAILABILITY skip (ddjp.media.skip) clears minGate only, and only when the room's rule allows it (J153, PART g):
// a ranked person's length closes the dead-song route instead of delaying it, an unranked one closes nothing, and the
// room's "Skip songs blocked for some people" switch, with its own table, waives the length. Its moment is never moved
// by a length; `skipVerdict` decides, and the advance view reads the same function.
// Judged entirely on committed stamps (ev.ts, startedAt) and folded numbers, so every client
// reaches the same verdict whenever it replays — delivery lag and clock drift cannot move it.
//
// A MANUAL skip (ddjp.dj.skip) WAIVES the floor: a named person with rank ending a song early
// is the feature, gated by rank, not a grief. The waiver keys on the event TYPE, so a
// mislabelled play can never claim it.
//
// THE LENGTH RULE: highest rank that spoke wins; within one rank the majority value wins; a
// stalemate at a rank cascades down to the next. min and max ALWAYS clamp the result, which is
// what makes a liar harmless in both directions — no claim can push past the room's own bounds.

const assert = require("assert");
const { loadInContext } = require("./_load");

const c = loadInContext([
  "backends/backend1/ranks.js",
  "backends/backend1/statederiver.js",
], {});
const { StateDeriver, Ranks } = c;

const OWNER = Ranks.levelOf("owner"), VIP = Ranks.levelOf("vip"),
      PLAYER = Ranks.levelOf("player"), UNCAT = Ranks.levelOf("uncategorized");

// production-shaped event: eventId (camelCase), parsed content, server ts
function ev(id, l, sender, rank, content) {
  return { eventId: id, l: l, sender: sender, senderRank: rank,
           type: content.t, content: content, ts: l * 1000, roomId: "!r:hs" };
}
// a DJ with two songs so the rotation never empties, then a genesis play at ts = 5000ms.
function base(startTs) {
  return [
    ev("$j", 1, "@a:hs", PLAYER, { t: "ddjp.dj.join", v: "yt:S1_________" }),
    ev("$d", 2, "@a:hs", PLAYER, { t: "ddjp.dj.declare", v: "yt:S1b________" }),
    { eventId: "$p", l: 5, sender: "@a:hs", senderRank: PLAYER,
      type: "ddjp.dj.play", content: { t: "ddjp.dj.play", p: null }, ts: startTs, roomId: "!r:hs" },
  ];
}
const livePi = "$p";
// an advance (play) at a chosen server stamp
function advanceAt(ts, sender, rank) {
  return { eventId: "$adv", l: 6, sender: sender || "@a:hs", senderRank: rank == null ? PLAYER : rank,
    type: "ddjp.dj.play", content: { t: "ddjp.dj.play", p: livePi }, ts: ts, roomId: "!r:hs" };
}
function len(sender, rank, sec, id) {
  return ev(id || ("$l_" + sender), 5, sender, rank, { t: "ddjp.play.len", pi: livePi, sec: sec });
}
function advanced(st) { return st.nowPlaying && st.nowPlaying.pi !== livePi; }

// ── (a) the minGate floor: an advance before started+minGate is rejected ─────────
(() => {
  const started = 100000;   // arbitrary shared server stamp
  const log = base(started);
  // minGate defaults to 8000ms. An advance 3s later is too early.
  assert.ok(!advanced(StateDeriver.derive(log.concat([advanceAt(started + 3000)]))),
    "an advance before the minGate floor is rejected");
  // an advance past the floor (no length declared) is accepted
  assert.ok(advanced(StateDeriver.derive(log.concat([advanceAt(started + 9000)]))),
    "past the minGate floor, with no length, the advance is accepted");
})();

// ── (b) the length gate: a well-supported length extends the floor ───────────────
(() => {
  const started = 100000;
  // VIP declares 60s. Gate = started + 60000 − grace(1000) = started + 59000.
  const log = base(started).concat([len("@v:hs", VIP, 60)]);
  assert.ok(!advanced(StateDeriver.derive(log.concat([advanceAt(started + 30000)]))),
    "an advance before (length − grace) is rejected once a length is agreed");
  assert.ok(advanced(StateDeriver.derive(log.concat([advanceAt(started + 59500)]))),
    "an advance past (length − grace) is accepted");
})();

// ── (c) the length rule: high rank wins, majority within rank, stalemate cascades ──
(() => {
  const started = 100000;
  // a lone low-rank claim of an enormous length is CLAMPED to maxLen (default 600s), not honoured
  // literally — the clamp is the defence, so a liar can never push past the room's own ceiling.
  const liar = base(started).concat([len("@liar:hs", UNCAT, 999999)]);
  assert.ok(!advanced(StateDeriver.derive(liar.concat([advanceAt(started + 9000)]))),
    "a huge claim still gates (it is clamped, not ignored)");
  assert.ok(advanced(StateDeriver.derive(liar.concat([advanceAt(started + 600000)]))),
    "but only up to maxLen — the clamp bounds any liar in the long direction");

  // HIGH RANK WINS: a VIP's 60s beats two players claiming 600s
  const outranked = base(started).concat([
    len("@x:hs", PLAYER, 600, "$lx"), len("@y:hs", PLAYER, 600, "$ly"), len("@v:hs", VIP, 60, "$lv"),
  ]);
  assert.ok(advanced(StateDeriver.derive(outranked.concat([advanceAt(started + 59500)]))),
    "the highest rank that spoke sets the length, outranking a lower-rank majority");

  // MAJORITY WITHIN RANK: three players, two agree on 60
  const majority = base(started).concat([
    len("@a2:hs", PLAYER, 60, "$m1"), len("@b2:hs", PLAYER, 60, "$m2"), len("@c2:hs", PLAYER, 600, "$m3"),
  ]);
  assert.ok(advanced(StateDeriver.derive(majority.concat([advanceAt(started + 59500)]))),
    "within one rank the majority value wins");

  // STALEMATE CASCADES DOWN: two VIPs tie, so the next rank down decides
  const stale = base(started).concat([
    len("@v1:hs", VIP, 600, "$s1"), len("@v2:hs", VIP, 30, "$s2"), len("@p1:hs", PLAYER, 60, "$s3"),
  ]);
  assert.ok(advanced(StateDeriver.derive(stale.concat([advanceAt(started + 59500)]))),
    "a tie at the top rank is unresolved and cascades down to the next rank");
})();

// ── (d) min and max always clamp the agreed length ──────────────────────────────
(() => {
  const started = 100000;
  // set maxLen to 300s, then VIP claims 999s. Gate is capped at 300 − grace.
  const settingsEv = ev("$s", 3, "@o:hs", OWNER, { t: "ddjp.room.settings", s: { maxLen: 300 } });
  const log = [settingsEv].concat(base(started)).concat([len("@v:hs", VIP, 999)]);
  // just past 300 − grace should be accepted (the cap, not 999, governs)
  assert.ok(advanced(StateDeriver.derive(log.concat([advanceAt(started + 300000)]))),
    "the gate is capped at maxLen — a claim beyond the ceiling cannot extend it");
})();

// ── (e) manual skip waives the floor; availability skip does not ─────────────────
(() => {
  const started = 100000;
  const log = base(started);
  // a manual ddjp.dj.skip 1s in, from a VIP (may skip others), advances despite the floor
  const manual = { eventId: "$sk", l: 6, sender: "@v:hs", senderRank: VIP,
    type: "ddjp.dj.skip", content: { t: "ddjp.dj.skip", p: livePi }, ts: started + 1000, roomId: "!r:hs" };
  assert.ok(advanced(StateDeriver.derive(log.concat([manual]))),
    "a manual skip by an authorised rank waives the floor (authority IS the justification)");
  // a mislabelled play cannot claim the waiver — it is still floored
  assert.ok(!advanced(StateDeriver.derive(log.concat([advanceAt(started + 1000, "@v:hs", VIP)]))),
    "a play (even from a VIP) is NOT a manual skip and stays floored");
})();

// ── (f) a declaration only counts if it sorts BEFORE the advance ────────────────
// This case used to reorder the ADVANCE to the front of the log and assert both runs agreed.
// They did — but for different reasons: the front-loaded advance was rejected by the advance
// LOCK (nothing playing yet), not by the gate, so the test passed while a late declaration
// could still re-judge a settled advance. It also fed derive an unsorted log, which is a
// contract violation (ordering is StreamManager.orderEvents' job). Move the DECLARATION
// instead — that is the property that actually needed proving.
(() => {
  const started = 100000;
  const before = base(started).concat([len("@v:hs", VIP, 600), advanceAt(started + 30000)]);
  assert.ok(!advanced(StateDeriver.derive(before)),
    "a declaration that sorts BEFORE the advance gates it");

  // the same declaration, moved after the advance: it must have no effect on that advance.
  const after = base(started).concat([advanceAt(started + 30000)]).concat([
    { eventId: "$l_late", l: 9, sender: "@v:hs", senderRank: VIP, type: "ddjp.play.len",
      content: { t: "ddjp.play.len", pi: livePi, sec: 600 }, ts: started + 90000, roomId: "!r:hs" },
  ]);
  const noDecl = base(started).concat([advanceAt(started + 30000)]);
  assert.strictEqual(advanced(StateDeriver.derive(after)), advanced(StateDeriver.derive(noDecl)),
    "a declaration that sorts AFTER an advance cannot change that advance's verdict — the gate " +
    "reads the prefix, so history stays append-only and a rank-zero message cannot rewrite it");
  assert.ok(advanced(StateDeriver.derive(after)),
    "and the advance stands: 30s clears the 8s floor, with no length in force at its position");
})();

// ── (g) THE ROOM'S SKIP OF A SONG PEOPLE CAN'T PLAY (J153, the owner's) ───────────────────────────────────────────────
// ONE RULE, READ TWICE: the reducer's re-validation of a `ddjp.media.skip` and the advance view (`skipWarranted`, `skipAt`)
// both ask `skipVerdict`. The room may skip when (the switch is on and ITS OWN table is met) or (no ranked person has
// reported a length and `skipRoads` is met), and never before `minGate`. Driven on the real reducer, every report with a
// counting reason taken from the reducer's own list, and the view compared with the reducer in every cell. Red on 721's
// app files: there one length from ANYONE held the skip, and there was no switch.
(() => {
  const GUEST = Ranks.levelOf("guest");
  const K = Object.keys(StateDeriver.BLOCKED_REASONS).find((k) => StateDeriver.blockedReasonCounts(k));
  assert.ok(typeof K === "string", "g PREMISE — the reducer's own list has a counting reason to report with");
  const started = 100000;
  const minGate = StateDeriver.defaultSettings().minGate;
  const at = (id, l, ts, sender, rank, content) => ({ eventId: id, l: l, sender: sender, senderRank: rank,
    type: content.t, content: content, ts: ts, roomId: "!r:hs" });
  // A room playing `$p` since `started`; `o.set` a settings blob posted before the song; `o.len` the rank of one length
  // declaration (240 s), or undefined for none; `o.n` guest reports; then `o.event` ("ddjp.media.skip" or "ddjp.dj.play")
  // at `started + o.off`. Returns the view before the event, the verdict on it, and a premise on the declarations.
  function room(o) {
    const log = [];
    if (o.set) log.push(at("$set", 3, 3000, "@o:hs", OWNER, { t: "ddjp.room.settings", s: o.set }));
    log.push(...base(started));
    let l = 6;
    if (o.len !== undefined) log.push(at("$len", l++, started + 500, "@sees:hs", o.len, { t: "ddjp.play.len", pi: livePi, sec: 240 }));
    for (let i = 0; i < o.n; i++) log.push(at("$b" + i, l++, started + 1000 + i, "@g" + i + ":hs", GUEST, { t: "ddjp.play.blocked", pi: livePi, k: K }));
    if (o.late) log.push(at("$late", l++, started + 2000, "@o:hs", OWNER, { t: "ddjp.room.settings", s: o.late }));
    const view = StateDeriver.derive(log).advance;
    const decls = StateDeriver.deriveAccepted(log);
    const declOk = log.filter((e) => /^\$(b|len)/.test(e.eventId)).every((e) => decls.indexOf(e.eventId) >= 0);
    const evt = at("$x", 50, started + o.off, "@g0:hs", GUEST, { t: o.event || "ddjp.media.skip", p: livePi });
    const full = log.concat([evt]);
    const refusals = StateDeriver.deriveRefusals(full);
    return { view: view, declOk: declOk, accepted: advanced(StateDeriver.derive(full)), code: refusals["$x"] ? refusals["$x"].code : null };
  }
  const ON = { skipBlockedForSome: true };

  // g1 — THE READ-THROUGH'S GATE PROBE, BOTH WAYS. Five guests can't see it; a sixth guest can, and reports 240 s.
  const off = room({ len: GUEST, n: 5, off: 10000 });
  assert.ok(off.declOk, "g1 PREMISE — every declaration was accepted, so the verdict is about the rule, not a refused report");
  assert.ok(!off.accepted && off.code === "skip-held-by-length",
    "g1: switch off — a ranked person's length holds the room's skip of a song five others can't see, with its own code " +
    "(`no-road-met` would name a false cause): " + JSON.stringify(off));
  const on = room({ set: ON, len: GUEST, n: 5, off: 10000 });
  assert.ok(on.declOk && on.accepted,
    "g1: switch on, its table met — the skip at +10 s is accepted though a ranked person can play the song: " + JSON.stringify(on));
  const early = room({ set: ON, len: GUEST, n: 5, off: minGate - 3000 });
  assert.ok(!early.accepted && early.code === "too-early",
    "g1: switch on — still never before `minGate`: the new waiver drops the length, never the floor: " + JSON.stringify(early));

  // g2 — AN UNRANKED LENGTH NO LONGER HOLDS THE DEAD-SONG SKIP; A RANKED ONE STILL DOES.
  const unranked = room({ len: UNCAT, n: 5, off: 10000 });
  assert.ok(unranked.declOk && unranked.accepted,
    "g2: an unranked account's length does not hold the room's skip — one claim from the weakest rung must not veto it: " + JSON.stringify(unranked));
  assert.ok(!off.accepted, "g2 control: a guest's length still does (g1)");

  // g3 — THE PLAY'S GATE IS UNCHANGED: every length, the unranked one included, still sets when a song ends normally.
  const play = room({ len: UNCAT, n: 5, off: 10000, event: "ddjp.dj.play" });
  assert.ok(!play.accepted && play.code === "too-early",
    "g3: a plain play at +10 s is still held by the unranked 240 s length — the ranked-only reading is the room skip's alone: " + JSON.stringify(play));

  // g4 — ITS OWN TABLE, not `skipRoads`: stricter, it is not met where `skipRoads` is; looser, it fires where `skipRoads` doesn't.
  const strict = room({ set: { skipBlockedForSome: true, skipBlockedForSomeRoads: [{ guestPlus: 9, vipPlus: 0 }] }, len: GUEST, n: 5, off: 10000 });
  assert.ok(!strict.accepted && strict.code === "skip-held-by-length",
    "g4: a stricter own table that is not met does not skip, though `skipRoads` is met (a ranked length closed that route): " + JSON.stringify(strict));
  const loose = room({ set: { skipBlockedForSome: true, skipBlockedForSomeRoads: [{ guestPlus: 2, vipPlus: 0 }] }, n: 2, off: 10000 });
  assert.ok(loose.accepted,
    "g4: a looser own table fires on two reports, where `skipRoads` (five guests) does not: " + JSON.stringify(loose));
  const looseOff = room({ set: { skipBlockedForSome: false, skipBlockedForSomeRoads: [{ guestPlus: 2, vipPlus: 0 }] }, n: 2, off: 10000 });
  assert.ok(!looseOff.accepted && looseOff.code === "no-road-met",
    "g4 control: the same table with the switch off does nothing: " + JSON.stringify(looseOff));

  // g5 — FROZEN AT THE SONG'S START, as `skipRoads` is: the switch turned on mid-song governs the next song, not this one.
  const late = room({ late: ON, len: GUEST, n: 5, off: 10000 });
  assert.ok(!late.accepted && late.code === "skip-held-by-length",
    "g5: the switch turned on after the song started does not govern it: " + JSON.stringify(late));

  // g6 — THE VIEW AND THE REDUCER AGREE, AND BOTH MATCH THE RULE: {off, on} × {no length, unranked, ranked} × {met, not met}.
  // `met` is five guest reports (the default tables' crowd road), `not met` two. The skip is sent just after `skipAt`.
  let cells = 0, fired = 0, held = 0;
  for (const sw of [false, true]) {
    for (const ln of [undefined, UNCAT, GUEST]) {
      for (const n of [5, 2]) {
        const want = n === 5 && (sw || ln !== GUEST);
        const r = room({ set: sw ? ON : null, len: ln, n: n, off: minGate + 1000 });
        const cell = { switch: sw, length: ln === undefined ? "none" : (ln === GUEST ? "ranked" : "unranked"), reports: n };
        assert.ok(r.declOk, "g6 PREMISE — every declaration accepted in " + JSON.stringify(cell));
        assert.ok(r.view && r.view.skipAt === started + minGate,
          "g6: the view's `skipAt` is the start plus `minGate`, whatever the lengths, in " + JSON.stringify(cell) + ": " + JSON.stringify(r.view));
        assert.strictEqual(r.view.skipWarranted, want, "g6: the view says the room will act exactly when the rule does, in " + JSON.stringify(cell));
        assert.strictEqual(r.accepted, want, "g6: the reducer accepts the skip exactly when the rule does, in " + JSON.stringify(cell));
        assert.strictEqual(r.view.skipWarranted, r.accepted, "g6: the view and the reducer agree, in " + JSON.stringify(cell));
        cells++; if (r.accepted) fired++; else held++;
      }
    }
  }
  assert.ok(cells === 12 && fired > 0 && held > 0,
    "g6 CONTROL — all twelve cells ran, some skipped and some held, so the agreement is about something: " + JSON.stringify({ cells, fired, held }));
})();

console.log("[advance-gate] PASS — a plain play clears BOTH the minGate floor and the agreed " +
  "length (highest rank wins, majority within a rank, a stalemate cascades down, min/max always " +
  "clamp so no claim can push past the room's own bounds); a manual skip waives the floor by rank " +
  "while a mislabelled play cannot; and only a declaration that sorts BEFORE an advance can gate " +
  "it, so a late one cannot re-judge a settled verdict. The room's skip of a song people can't play (J153) takes " +
  "minGate only: a ranked length holds it, an unranked one does not, the play's gate still reads every length, the " +
  "blocked-for-some switch and its own table skip anyway, frozen at the song's start, and the view agrees with the " +
  "reducer in all twelve cells");
