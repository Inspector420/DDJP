#!/usr/bin/env node
// tests/check-save-point-race.js
// SUBJECT: backends/backend1/history.js, backends/backend1/matrixbridge.js, backends/backend1/streammanager.js
//
// WALL: SONG HISTORY, AND THE HISTORY AUDIT, FOLLOW THE SAVE POINT (the owner's ruling 41, J91) — and the log says so in
// plain words.
//
// ── WHAT WAS FOUND (J90 item 2, the owner's `?v=538` run, room "sharednew") ─────────────────────────────────────────────
// A save point records what its sealer had heard when it sealed. Two plays at one position, one of them not yet at the
// sealer: the save point counts the other, and when the late one arrives its position is settled, so every device drops
// it. Every device then PLAYS the save point's choice — but J90's probe (`probe-j90-seal-race`, turned into PART A here)
// found three devices with three song histories for that moment: the sealer the save point's play, a tab that had heard
// both the room-order play, a device opening later both — and the audit's "truth" counting both. The owner chose B + C
// (ruling 41): history and the audit follow the save point; the log says it in plain words. The save point itself is
// unchanged (option A declined).
//
// ── WHAT THIS HOLDS, ALL DRIVEN (the real backend1 engine, History, the bridge; the SDK client is the only double,
//    `tests/_botroom.js`) ─────────────────────────────────────────────────────────────────────────────────────────────
//   A  THE RACE A SAVE POINT SETTLED BY FIRST ARRIVAL: the owner's tab seals having heard only the bot's play; the bot's
//      tab heard both; a device opens later. All three play the save point's song, all three song histories are equal and
//      equal to the audit's truth (0 missing, 0 extra on each), the audit names the case in plain words, and the bot's tab
//      says which row left and why.
//   A2 THE SAVE POINT ARRIVES WHILE A TAB IS CATCHING UP: nothing is written then; back live, the refresh follows the save point
//      and its line names it.
//   A3 THE SEALER ITSELF (J92): a play at the save point's own position reaches the sealer while the seal is being sent; the
//      move-on check says what it knows in plain words, and the sealer's history follows its save point. (J92 took this for the
//      owner's `?v=540` seal n=7; J93's inline log showed that was a short base instead — `check-move-on-base`.)
//   B  THE CONTROL — A SAVE POINT THAT AGREES with the room's order: nothing is re-decided and nothing is said.
//   C  THE REOPEN LINE: while a tab is still loading it says so and does not warn; live, it names both answers and what the
//      save point recorded, and never calls the current answer what the floor "banks".
//   E  THE ROOM'S ORDER IS THE ENGINE'S (J91): ids compared code unit by code unit, as `orderEvents` does — by locale,
//      verify, the cache rebuild and the audit read a race between "$Nab…" and "$mt8E…" the other way from every device.
//   F  A TABLE STORED BEFORE `?v=540` IS CHECKED AGAIN, ONCE (the owner's ruling 42, J92): its "verified" marks were made by
//      the locale order, so a segment holding that order's pick was never read again ("1 missing, 1 extra" live). They are
//      set aside, the segment is checked against the room once, and the audit then shows 0 missing, 0 extra.
//   G  A SECOND BACKFILL IN ONE VISIT (J97, the owner's `?v=545` audit: "0 missing, 1 extra $mt8E… at l=53 — from cache under
//      5:…"): every trim re-arms the backfill, and each run restored the stored table again — the table the tab opened from,
//      when the first run had not yet saved its own. That put back the old order's row the first run's check had just removed,
//      and the first run's new mark kept the second check away. The table is restored once a visit; a later visit reads it, and
//      checks it, again (the marks go with the room, as its rows do).
//   H  A TABLE ALREADY STORED THAT WAY (both plays of one position, and a mark of today's rule over them): the mark does not
//      vouch for a segment holding two songs at one position — the segment is checked against the room once more, and the
//      audit then shows 0 missing, 0 extra.
//   D  THE RULE'S EDGES, on History itself: a closed stretch the live refresh asks about again is answered again when it
//      has changed; only the stretch a save point closes follows it; the engine's hand-off (at adoption, and the trim) prunes
//      only a stretch its save point re-decided, only the live writers' rows, only inside it; a backfill and a gap fill follow
//      the save point that closes their stretch; and a stretch no same-position play explains is left as it folds, and the
//      audit still says where. (J91 left the trim unsettled as unreachable; the sealer's own case, A3, reaches the stretch.)
//
// ── WHAT IT DOES NOT HOLD ────────────────────────────────────────────────────────────────────────────────────────────
//   · A device that never received the play the save point counted (it arrived after the save point): its own fold cannot
//     reach the save point's song, so the live refresh leaves it; verify, at the next open, reads the room and corrects it.
//   · A homeserver's timing, and a browser drawing the pane.
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[save-point-race] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const CH = B.FULL_CH, MIN = 60000;

// ONE ROOM: its homeserver, its clock, its positions, and its tabs (each delivered to by hand, so each hears what it hears).
function room() {
  const R = { server: {}, now: 1792447900000, L: 0, N: 0, tabs: [] };
  // `stored`: the song table this device kept from an earlier visit (`Store.history`); such a device is loading until `open()`,
  // as a reload is — so nothing writes its history before the table is restored.
  R.tab = (me, stored) => {
    const w = B.world({ mode: "backend1", me: me, server: R.server, order: B.ORDER, fanOut: true, timers: true, opened: stored ? false : undefined, extras: {
      ServerClock: { serverNow: () => R.now, init() {}, destroy() {} },
      Store: { history: { load: async () => (stored ? JSON.parse(JSON.stringify(stored)) : null), persist() {} }, config: { saveRoom() {} } } } });
    w.sb.MatrixBridge.onRawEvent = w.sb.B1MatrixBridge.onRawEvent;
    w.head = () => { const np = w.sb.StreamManager.getState().nowPlaying; return np ? np.pi : null; };
    w.rows = () => w.sb.History.recent().map((r) => r.pi + "|" + r.videoId).sort();
    w.said = (re) => w.logs.filter((m) => re.test(m));
    R.tabs.push(w);
    return w;
  };
  R.raw = (sender, body, o) => {
    o = o || {}; R.now += (o.dt !== undefined ? o.dt : 1000);
    const l = (o.l !== undefined) ? o.l : ++R.L; if (l > R.L) R.L = l;
    return { event_id: "$" + (o.id || ("e" + String(++R.N).padStart(3, "0"))), type: "m.room.message",
      room_id: body.t === "ddjp.room.settings" ? CH.settings_owner : CH.events_owner, sender: sender, origin_server_ts: R.now,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({}, body, { l: l })) } };
  };
  R.store = (r) => { (R.server[r.room_id] = R.server[r.room_id] || []).push(r); return r; };
  R.to = (r, ws) => { for (const w of ws) w.deliver(r, 99); return r; };
  R.put = (s, b, o) => R.to(R.store(R.raw(s, b, o)), R.tabs);
  // A seal by `w`, as `Checkpoint.seal` makes it, posted at the next position to the tabs named.
  R.seal = async (w, ws) => {
    const before = w.sent.length; await w.sb.Checkpoint.seal();
    const cp = w.sent.slice(before).filter((s) => s.t === "ddjp.checkpoint")[0];
    if (cp) R.to(R.store({ event_id: cp.id, type: "m.room.message", room_id: cp.roomId, sender: w.me, origin_server_ts: (R.now += 500),
      content: { body: JSON.stringify(Object.assign({}, cp.body, { l: ++R.L })) } }), ws || R.tabs);
    await settle();
    return cp ? cp.body : null;
  };
  // The whole room as the reducer reads it, folded from its start, ignoring save points: the audit's "raw fold".
  R.rawHead = (sb) => {
    const all = Object.values(R.server).flat().map((r) => { const b = JSON.parse(r.content.body);
      return { eventId: r.event_id, type: b.t, content: b, sender: r.sender, ts: r.origin_server_ts, l: b.l, senderRank: 99 }; })
      .sort((a, b) => (a.l - b.l) || a.eventId.localeCompare(b.eventId));
    const st = sb.StateDeriver.derive(all);
    return st.nowPlaying ? st.nowPlaying.pi : null;
  };
  return R;
}
// The race: two plays at one position, both naming no parent. The room's order (position, then id) puts `$5KpTB…` first.
function race(R) {
  R.put(B.OWNER, { t: "ddjp.room.settings", s: R.tabs[0].sb.StateDeriver.defaultSettings() });
  R.put(B.OWNER, { t: "ddjp.dj.join", v: "ownerSong01" });
  R.put(B.BOT, { t: "ddjp.dj.join", v: "botSong0001" });
  const at = ++R.L;
  const first = R.store(R.raw(B.BOT, { t: "ddjp.dj.play", p: null }, { l: at, id: "7FS82race", dt: 2000 }));   // the bot's: later in the room's order
  const later = R.store(R.raw(B.OWNER, { t: "ddjp.dj.play", p: null }, { l: at, id: "5KpTBrace", dt: 300 })); // the owner's: first in it
  return { at: at, first: first, later: later };
}
async function audit(w) {
  const before = w.logs.length;
  const rep = await w.sb.B1MatrixBridge.historyAudit();
  return { rep: rep, lines: w.logs.slice(before).filter((m) => /HISTORY AUDIT/.test(m)) };
}

async function main() {
  // ── A — THE RACE A SAVE POINT SETTLED BY FIRST ARRIVAL ────────────────────────────────────────────────────────────
  {
    const R = room();
    const O = R.tab(B.OWNER), G = R.tab(B.BOT);
    for (const w of [O, G]) await w.open();
    const r = race(R);
    R.to(r.first, [O]);                       // the owner's tab hears the bot's play first ...
    R.to(r.later, [G]); R.to(r.first, [G]);   // ... the bot's tab hears both
    ok(O.head() === r.first.event_id && G.head() === r.later.event_id,
      "A: PREMISE — before the save point, the owner's tab plays the play it heard, the bot's the room's first", [O.head(), G.head()]);
    const cp = await R.seal(O);
    ok(cp && cp.floorL === r.at && cp.seed.nowPlaying && cp.seed.nowPlaying.pi === r.first.event_id,
      "A: PREMISE — the owner's tab seals at the race's position, recording the play it had heard", cp && { floorL: cp.floorL, np: cp.seed.nowPlaying && cp.seed.nowPlaying.pi });
    R.to(r.later, [O]); await settle();       // the room's first play reaches the sealer only now, at a settled position
    const F = R.tab(B.STAFF); await F.open(); await settle(50);
    const tabs = [O, G, F];
    ok(tabs.every((w) => w.head() === r.first.event_id) && R.rawHead(O.sb) === r.later.event_id,
      "A: PREMISE — every tab plays the save point's song; a fold of the whole room from its start plays the other",
      { tabs: tabs.map((w) => w.head()), raw: R.rawHead(O.sb) });
    const want = [r.first.event_id + "|ownerSong01"];
    ok(tabs.every((w) => JSON.stringify(w.rows()) === JSON.stringify(want)),
      "A: THE THREE SONG HISTORIES ARE EQUAL, AND HOLD WHAT PLAYED — at J90 the sealer's held the save point's play, the bot's the room-order play, the later device's both",
      { owner: O.rows(), bot: G.rows(), later: F.rows(), want: want });
    const audits = [];
    for (const w of tabs) audits.push(await audit(w));
    ok(audits.every((a) => a.rep.truthCount === 1 && !a.rep.missing.length && !a.rep.extra.length && !(a.rep.differs || []).length),
      "A: AND EQUAL TO THE AUDIT'S TRUTH, on every tab — at J90 the truth counted both plays",
      audits.map((a) => ({ truth: a.rep.truthCount, missing: a.rep.missing.length, extra: a.rep.extra.length })));
    const named = "info: MatrixBridge: HISTORY AUDIT — a save point settled a same-position race at l=" + r.at +
      " by first arrival; history follows the save point (the save point at l=" + r.at + " did not count " + r.later.event_id + ")";
    ok(audits.every((a) => a.lines.filter((m) => m === named).length === 1 && !a.lines.some((m) => /the segment before the floor/.test(m))),
      "A: THE AUDIT NAMES THE CASE IN PLAIN WORDS, and no longer reports the stretch as reaching another song", audits.map((a) => a.lines));
    // RE-AIMED AT J92: the row now leaves in the engine's hand-off at the save point's adoption (`_settleHistory`), so the line is
    // the engine's; the refresh's own line for the same case is held below (A2), where only the refresh can see it.
    const left = G.said(/\$5KpTBrace at l=\d+ left/);
    ok(left.length === 1 && left[0] === "info: StreamManager: song history follows save point n=" + cp.n + " at l=" + r.at + " — " + r.later.event_id + " at l=" + r.at +
      " left it (the save point counted the other play at l=" + r.at + ", the one that reached its sealer first)",
      "A: THE BOT'S TAB SAYS WHICH ROW LEFT AND WHY, once — and at once, when the save point arrives, not at the next song", left);

    // ── C — THE REOPEN LINE, ON THE TAB THAT HOLDS BOTH PLAYS ───────────────────────────────────────────────────────
    // The fold compares a fold from the room's start with one from the save point only while it holds the room from its
    // start (`setHistoryComplete`, which the bridge sets from History's coverage); the phase is the room's real Session.
    const SM = G.sb.StreamManager, S = G.sb.Session;
    const lines = () => G.logs.filter((m) => /DISAGREES|still loading the room/.test(m));
    const n0 = lines().length;
    S._setPhaseForTest(S.CATCHING_UP);
    SM.setHistoryComplete(false); SM.setHistoryComplete(true);
    const loading = lines().slice(n0);
    ok(loading.length >= 1 && loading.every((m) => m === "info: StreamManager: still loading the room — so far, folded from the room's start, this tab has " +
      r.later.event_id + " playing, and folded from the save point at l=" + r.at + ", " + r.first.event_id +
      ". Following the save point. This is the tab still reading the room, not a disagreement."),
      "C: WHILE THE TAB IS STILL LOADING, THE LINE SAYS SO, and does not warn", loading);
    const n1 = lines().length;
    SM.setHistoryComplete(false);
    S._setPhaseForTest(S.LIVE);
    SM.setHistoryComplete(true);
    const live = lines().slice(n1);
    ok(live.length >= 1 && live.every((m) => m === "warn: StreamManager: MY OWN VIEW DISAGREES WITH THE ROOM'S SETTLED ACCOUNT — playing now, folded from the room's start: " +
      r.later.event_id + "; folded from the save point at l=" + r.at + ": " + r.first.event_id + " (that save point recorded " + r.first.event_id +
      " as playing). Following the save point. Either a save point settled a same-position race by first arrival (song history follows the save point), or this tab is missing an event below it."),
      "C: LIVE, IT NAMES BOTH ANSWERS AND WHAT THE SAVE POINT RECORDED", live);
    ok(!G.logs.some((m) => /banks pi=/.test(m)), "C: AND NEVER CALLS THE CURRENT ANSWER WHAT THE FLOOR \"BANKS\"", G.logs.filter((m) => /banks/.test(m)));
  }

  // ── A2 — THE SAVE POINT ARRIVES WHILE THE TAB IS CATCHING UP: the refresh settles, and says so ──────────────────────
  // Nothing is written to history while a tab is not live, the engine's hand-off at adoption included. Back live, the next
  // refresh folds the stretch as the save point counted it, and its line names the save point, not the room's order.
  {
    const R = room();
    const O = R.tab(B.OWNER), G = R.tab(B.BOT);
    for (const w of [O, G]) await w.open();
    const r = race(R);
    R.to(r.first, [O]); R.to(r.later, [G]); R.to(r.first, [G]);
    ok(G.rows().length === 1 && G.rows()[0].indexOf(r.later.event_id) === 0, "A2: PREMISE — the bot's tab shows the room-order play", G.rows());
    const S = G.sb.Session;
    S._setPhaseForTest(S.CATCHING_UP);
    const cp = await R.seal(O);
    ok(G.head() === r.first.event_id && G.rows()[0].indexOf(r.later.event_id) === 0, "A2: PREMISE — catching up, the tab follows the save point but writes nothing", { head: G.head(), rows: G.rows() });
    S._setPhaseForTest(S.LIVE);
    R.put(B.STAFF, { t: "ddjp.dj.skip", p: "$no-such-playing" });   // any advance, even a refused one, refreshes history
    const left = G.said(/\$5KpTBrace at l=\d+ left/);
    ok(JSON.stringify(G.rows()) === JSON.stringify([r.first.event_id + "|ownerSong01"]) && left.length === 1 &&
      left[0] === "info: MatrixBridge: HISTORY — " + r.later.event_id + " at l=" + r.at + " left song history: the room's fold no longer has its play" +
      " (the save point at l=" + cp.floorL + " counted the other play at l=" + r.at + ", the one that reached it first; history follows the save point)",
      "A2: BACK LIVE, THE REFRESH FOLLOWS THE SAVE POINT AND ITS LINE NAMES IT — not \"another play comes first in the room's order\"", { rows: G.rows(), left: left });
  }

  // ── A3 — THE SEALER ITSELF: a play at the save point's own position arrives while the seal is being sent (J92) ─────────────
  // The seal records the play its tab had; the send takes a moment; the tab's own play for the same song change — the same
  // position, an id first in the room's order — arrives in it. The room follows the save point; before J92 song history did
  // not. A case that can happen; it is not what the owner's `?v=540` seal n=7 was (J93: one ORDER line for l=106, no own play).
  {
    const R = room();
    const O = R.tab(B.OWNER);
    await O.open();
    R.put(B.OWNER, { t: "ddjp.room.settings", s: Object.assign(O.sb.StateDeriver.defaultSettings(), { checkpointCooldownMs: 0 }) });
    R.put(B.OWNER, { t: "ddjp.dj.join", v: "ownerSong01" });
    R.put(B.BOT, { t: "ddjp.dj.join", v: "botSong0001" });
    const p0 = R.put(B.OWNER, { t: "ddjp.dj.play", p: null }), p0l = JSON.parse(p0.content.body).l;
    await R.seal(O);
    R.now += 5 * MIN;
    R.put(B.OWNER, { t: "ddjp.dj.join", v: "ownerSong02" });
    const at = ++R.L;
    const bots = R.to(R.store(R.raw(B.BOT, { t: "ddjp.dj.play", p: p0.event_id }, { l: at, id: "PbotPlay106" })), [O]);
    const own = R.raw(B.OWNER, { t: "ddjp.dj.play", p: p0.event_id }, { l: at, id: "AownPlay106", dt: 300 });
    let sentCp = null;
    O.sb.Checkpoint.attach({ send: async (t, body) => { sentCp = body; R.to(R.store(own), [O]); await settle(); return { event_id: "$cp106" }; } });
    await O.sb.Checkpoint.seal(); await settle();
    ok(sentCp && sentCp.floorL === at && sentCp.seed.nowPlaying && sentCp.seed.nowPlaying.pi === bots.event_id && O.head() === bots.event_id,
      "A3: PREMISE — the save point records the bot's play, and the room follows it", { cp: sentCp && sentCp.floorL, head: O.head() });
    // RE-AIMED AT J93: the line says only what the check knows — the base it folded from, and that both are plays at the save
    // point's own position. J92's "something reached this tab after the save point was sealed" was a cause the check cannot see,
    // and on the owner's `?v=540` reopen it was false (`check-move-on-base`).
    const warn = O.said(/move-on check — save point n=/);
    ok(warn.length === 1 && warn[0] === "warn: StreamManager: move-on check — save point n=" + sentCp.n + " at l=" + at + " records " + bots.event_id +
      " as playing; this tab's own events up to it, folded from its held base (the save point at l=" + p0l + "), give " + own.event_id + ". Both are plays at l=" + at +
      ", the save point's own position, and it counted " + bots.event_id + ". The room follows the save point; so does song history.",
      "A3: THE MOVE-ON CHECK SAYS IT IN PLAIN WORDS — what the save point records, what this tab's events give and from where, and only what it knows", O.said(/move-on/));
    ok(O.rows().some((x) => x.indexOf(bots.event_id + "|") === 0) && !O.rows().some((x) => x.indexOf(own.event_id) === 0),
      "A3: AND THE SEALER'S SONG HISTORY FOLLOWS ITS SAVE POINT — the engine's hand-off at adoption; J91 had judged the sealer's case unreachable", O.rows());
  }

  // ── B — THE CONTROL: A SAVE POINT THAT AGREES WITH THE ROOM'S ORDER ─────────────────────────────────────────────────
  {
    const R = room();
    const O = R.tab(B.OWNER), G = R.tab(B.BOT);
    for (const w of [O, G]) await w.open();
    const r = race(R);
    R.to(r.first, [O, G]); R.to(r.later, [O, G]);   // both tabs hear both, before the save point
    const cp = await R.seal(O);
    ok(cp && cp.seed.nowPlaying && cp.seed.nowPlaying.pi === r.later.event_id, "B: PREMISE — the save point records the room's first", cp && cp.seed.nowPlaying);
    const F = R.tab(B.STAFF); await F.open(); await settle(50);
    const want = [r.later.event_id + "|ownerSong01"];
    const a = []; for (const w of [O, G, F]) a.push(await audit(w));
    ok([O, G, F].every((w) => JSON.stringify(w.rows()) === JSON.stringify(want)) && a.every((x) => x.rep.truthCount === 1 && !x.rep.missing.length && !x.rep.extra.length),
      "B: A SAVE POINT THAT AGREES: every history and every truth hold the room's first play", { rows: [O, G, F].map((w) => w.rows()), truth: a.map((x) => x.rep.truthCount) });
    ok(a.every((x) => !x.lines.some((m) => /settled a same-position race/.test(m))) && ![O, G, F].some((w) => w.said(/left song history: .*save point/).length),
      "B: AND NOTHING IS RE-DECIDED OR SAID", a.map((x) => x.lines));
  }

  // ── E — THE ROOM'S ORDER IS THE ENGINE'S: IDS BY CODE UNIT ────────────────────────────────────────────────────────
  // History sorted ids by locale; the engine (`orderEvents`) by code unit. "$Nab…" comes first for the engine, "$mt8E…" for
  // the locale. A race between two such plays, a save point that agrees with the engine: verify, the cache rebuild, the audit's
  // truth and its raw fold must all read it as the engine did — with nothing "settled", because nothing arrived late.
  {
    const R = room();
    const O = R.tab(B.OWNER), G = R.tab(B.BOT);
    for (const w of [O, G]) await w.open();
    R.put(B.OWNER, { t: "ddjp.room.settings", s: O.sb.StateDeriver.defaultSettings() });
    R.put(B.OWNER, { t: "ddjp.dj.join", v: "ownerSong01" });
    R.put(B.BOT, { t: "ddjp.dj.join", v: "botSong0001" });
    const at = ++R.L;
    const lower = R.store(R.raw(B.BOT, { t: "ddjp.dj.play", p: null }, { l: at, id: "mt8Erace", dt: 2000 }));
    const upper = R.store(R.raw(B.OWNER, { t: "ddjp.dj.play", p: null }, { l: at, id: "NabRace", dt: 300 }));
    ok("$mt8Erace".localeCompare("$NabRace") < 0 && "$NabRace" < "$mt8Erace", "E: PREMISE — the locale and the code units order these two ids differently");
    R.to(lower, [O, G]); R.to(upper, [O, G]);
    const cp = await R.seal(O);
    ok(cp && cp.seed.nowPlaying && cp.seed.nowPlaying.pi === upper.event_id && O.head() === upper.event_id,
      "E: PREMISE — the engine, and so the save point, take \"$Nab…\"", cp && cp.seed.nowPlaying && cp.seed.nowPlaying.pi);
    const F = R.tab(B.STAFF); await F.open(); await settle(50);
    const want = [upper.event_id + "|ownerSong01"];
    const a = []; for (const w of [O, G, F]) a.push(await audit(w));
    ok([O, G, F].every((w) => JSON.stringify(w.rows()) === JSON.stringify(want)) && a.every((x) => x.rep.truthCount === 1 && !x.rep.missing.length && !x.rep.extra.length),
      "E: VERIFY, THE CACHE REBUILD AND THE AUDIT'S TRUTH READ THE RACE AS THE ENGINE DID — by locale they took \"$mt8E…\"",
      { rows: [O, G, F].map((w) => w.rows()), audits: a.map((x) => x.lines) });
    ok(a.every((x) => !x.lines.some((m) => /raw fold|settled a same-position race/.test(m))),
      "E: AND THE AUDIT'S RAW FOLD AGREES, with nothing \"settled\" — the case is not a late arrival", a.map((x) => x.lines));
  }

  // ── F — A TABLE STORED BEFORE THE ENGINE'S ORDER IS CHECKED AGAIN, ONCE (the owner's ruling 42, J92) ──────────────────
  // Live, `?v=540`: "restored 10 stored song(s)", "0 row(s) corrected", then the audit — "missing $P4cT… at l=53 — claimed as
  // covered, yet absent", "extra $mt8E… at l=53 — from cache". The table kept the locale order's pick and a "verified" mark
  // made by that order, so the segment was never read again. A device opens with such a table: the mark is set aside, the
  // segment is checked against the room once, and the audit then shows nothing missing and nothing extra.
  {
    const R = room();
    const O = R.tab(B.OWNER);
    await O.open();
    R.put(B.OWNER, { t: "ddjp.room.settings", s: O.sb.StateDeriver.defaultSettings() });
    R.put(B.OWNER, { t: "ddjp.dj.join", v: "ownerSong01" });
    R.put(B.BOT, { t: "ddjp.dj.join", v: "botSong0001" });
    const at = ++R.L;
    const lower = R.store(R.raw(B.BOT, { t: "ddjp.dj.play", p: null }, { l: at, id: "mt8E3VGrace", dt: 2000 }));
    const upper = R.store(R.raw(B.OWNER, { t: "ddjp.dj.play", p: null }, { l: at, id: "P4cT4akrace", dt: 300 }));
    R.to(lower, [O]); R.to(upper, [O]);
    const cp = await R.seal(O);
    ok(cp && cp.seed.nowPlaying && cp.seed.nowPlaying.pi === upper.event_id, "F: PREMISE — the save point records the engine's pick, \"$P4cT…\"", cp && cp.seed.nowPlaying);
    // THE TABLE A DEVICE STORED BEFORE `?v=540`: the locale order's row, coverage claimed, and the old rule's mark on the segment.
    const old = { v: 2, rows: [{ pi: lower.event_id, l: at, videoId: "ownerSong01", dj: B.OWNER, at: R.now, src: "cache" }], ranges: [[0, at + 1]], adds: {}, addsL: {},
      verified: { ["v2|start>" + cp.h]: { lo: 0, hi: at, live: null, banked: upper.event_id } }, origin: { start: true, h: cp.h } };
    const D = R.tab(B.STAFF, old); await D.open(); await settle(50);
    const a = await audit(D);
    ok(D.said(/^info: MatrixBridge: history — 1 stored segment check\(s\) were made before the room's order was the engine's \(\?v=540\); those segments are checked against the room again, once$/).length === 1,
      "F: THE OPEN SAYS A CHECK MADE BY THE OLD ORDER IS SET ASIDE", D.said(/history —/));
    ok(D.said(/^info: MatrixBridge: history — verified 1 segment\(s\) against the room in 1 page request\(s\); 0 already verified; [1-9]\d* row\(s\) corrected$/).length === 1,
      "F: AND THE SEGMENT IS CHECKED AGAIN, AND CORRECTED — live: \"0 row(s) corrected\"", D.said(/verified/));
    ok(JSON.stringify(D.rows()) === JSON.stringify([upper.event_id + "|ownerSong01"]) && a.rep.truthCount === 1 && !a.rep.missing.length && !a.rep.extra.length,
      "F: THE AUDIT THEN SHOWS 0 MISSING, 0 EXTRA — live: 1 missing \"$P4cT…\", 1 extra \"$mt8E…\" from cache", { rows: D.rows(), audit: a.lines });
    // ONCE: the table that device now stores carries the new rule's mark, and a table restored from it reads nothing again.
    // (On History itself: a device that replays the room in this harness writes the stretch before its restore, and a mark
    // restored after a writer touched its segment does not count — `ddjp_563` — so the open would re-check for that reason.)
    const snap = D.sb.History.snapshot();
    const X = R.tab(B.VIP), XH = X.sb.History;
    let pages = 0;
    XH.attach({ pageRange: async (from, to) => { pages++; return []; } });
    const rr = XH.restore(snap);
    const again = await XH.verifyIncremental([{ h: cp.h, l: cp.floorL, seed: cp.seed, prevNull: true }]);
    ok(Object.keys(snap.verified).length === 1 && Object.keys(snap.verified)[0].indexOf("v3|") === 0 && rr.olderMarks === 0 && again.ok && again.skipped === 1 && again.verified === 0 && pages === 0,
      "F: ONCE — the table stored after the check carries the new rule's mark, and a device restoring it reads nothing again", { marks: Object.keys(snap.verified), again: again, pages: pages });
  }

  // ── G AND H — A SECOND BACKFILL IN ONE VISIT, AND A TABLE IT ALREADY STORED (J97, the owner's `?v=545` audit) ───────────
  // Live, the owner's tab: "HISTORY AUDIT — truth 16 song(s), this device 17; 0 missing, 1 extra", "extra $mt8E… at l=53 … — from
  // cache under 5:_bEkd-Caj9" — the old order's row from a floor long gone, beside the engine's pick $P4cT…, which ruling 42's
  // check had added. Every trim re-arms the backfill, and every run restored the stored table: a second run started before the
  // first had saved restored the table the tab opened from, putting the old row back after the first run's check removed it —
  // and the first run's mark, today's rule, kept the second check away. Stored so, every later open read it back as checked.
  {
    const R = room();
    const O = R.tab(B.OWNER);
    await O.open();
    R.put(B.OWNER, { t: "ddjp.room.settings", s: Object.assign(O.sb.StateDeriver.defaultSettings(), { checkpointCooldownMs: 0 }) });
    R.put(B.OWNER, { t: "ddjp.dj.join", v: "ownerSong01" });
    R.put(B.BOT, { t: "ddjp.dj.join", v: "botSong0001" });
    const at = ++R.L;
    const lower = R.store(R.raw(B.BOT, { t: "ddjp.dj.play", p: null }, { l: at, id: "mt8E3VGrace", dt: 2000 }));
    const upper = R.store(R.raw(B.OWNER, { t: "ddjp.dj.play", p: null }, { l: at, id: "P4cT4akrace", dt: 300 }));
    R.to(lower, [O]); R.to(upper, [O]);
    const cp = await R.seal(O);
    const oldRow = { pi: lower.event_id, l: at, videoId: "ownerSong01", dj: B.OWNER, at: R.now, src: "cache", floorSig: "5:_bEkd-Caj9" };
    const old = { v: 2, rows: [oldRow], ranges: [[0, at + 1]], adds: {}, addsL: {},
      verified: { ["v2|start>" + cp.h]: { lo: 0, hi: at, live: null, banked: upper.event_id } }, origin: { start: true, h: cp.h } };
    // G: the tab opens from the old table, and a trim then re-arms the backfill while the store still holds that table.
    const D = R.tab(B.STAFF, old); await D.open(); await settle(50);
    ok(JSON.stringify(D.rows()) === JSON.stringify([upper.event_id + "|ownerSong01"]), "G: PREMISE — the open's check corrects the old table (ruling 42)", D.rows());
    R.put(B.BOT, { t: "ddjp.dj.join", v: "botSong0002" });
    R.now += 5 * MIN;
    R.put(B.BOT, { t: "ddjp.dj.play", p: upper.event_id });
    const n0 = D.logs.length;
    await R.seal(O);
    const trimmed = D.said(/StreamManager: derived log trimmed to floor l=/).length > 0;
    D.timers.fire(0); await settle(80);   // the re-armed backfill runs
    const runs = D.logs.slice(n0).filter((m) => /history — verified \d+ segment/.test(m)).length;
    ok(trimmed && runs === 1, "G: PREMISE — the new save point's trim re-armed the backfill, and it ran", { trimmed, runs, said: D.logs.slice(n0).filter((m) => /history —/.test(m)) });
    const aG = await audit(D);
    ok(D.rows().indexOf(lower.event_id + "|ownerSong01") < 0 && !aG.rep.missing.length && !aG.rep.extra.length,
      "G: A SECOND BACKFILL IN ONE VISIT DOES NOT PUT BACK THE ROW THE FIRST ONE'S CHECK REMOVED — live: \"1 extra $mt8E… — from cache\"",
      { rows: D.rows(), audit: aG.lines });
    ok(D.logs.slice(n0).filter((m) => /history — restored \d+ stored song/.test(m)).length === 0,
      "G: THE STORED TABLE IS RESTORED ONCE A VISIT — the second run leaves it alone", D.logs.slice(n0).filter((m) => /history —/.test(m)));
    // A LATER VISIT TO THE ROOM (back to the lobby, and in again, in the same page) reads the table again — and checks what it
    // reads: the marks this visit made go with the room, as its rows do (they are stored with the table).
    const stored = D.sb.History.snapshot();   // what this visit holds — H's table is made from it
    D.sb.StreamManager.reset("the tab left the room"); D.sb.MatrixBridge.resetCheckpoints();   // `Room.leave`'s order
    D.sb.MatrixBridge.seedClock(B.SPACE); D.sb.MatrixBridge.setRoomScope(CH); D.sb.MatrixBridge.wireCheckpoints(CH);
    const n1 = D.logs.length;
    await D.open(); await settle(50);
    const aV = await audit(D);
    ok(D.logs.slice(n1).filter((m) => /history — restored \d+ stored song/.test(m)).length === 1 && !aV.rep.missing.length && !aV.rep.extra.length,
      "G: A LATER VISIT RESTORES THE TABLE AGAIN, AND CHECKS IT — the store still held the old order's row", { said: D.logs.slice(n1).filter((m) => /history —/.test(m)), audit: aV.lines });
    // H: the table such a visit stored — both plays at one position, and today's mark over them — opens on another device.
    const bad = JSON.parse(JSON.stringify(stored));
    bad.rows = bad.rows.concat([oldRow]);
    const H = R.tab(B.VIP, bad); await H.open(); await settle(50);
    const aH = await audit(H);
    ok(H.said(/^info: MatrixBridge: history — 1 stored segment check\(s\) hold two songs at one position; those segments are checked against the room again, once$/).length === 1,
      "H: THE OPEN SAYS A CHECK OVER TWO SONGS AT ONE POSITION IS SET ASIDE", H.said(/history —/));
    ok(H.rows().indexOf(lower.event_id + "|ownerSong01") < 0 && !aH.rep.missing.length && !aH.rep.extra.length,
      "H: A TABLE STORED THAT WAY IS CHECKED AGAIN, AND THE AUDIT THEN SHOWS 0 MISSING, 0 EXTRA — live: \"1 extra … from cache under 5:…\"",
      { rows: H.rows(), audit: aH.lines });
  }

  // ── D — THE RULE'S EDGES, ON HISTORY ITSELF ──────────────────────────────────────────────────────────────────────
  {
    const R = room();
    const w = R.tab(B.OWNER);
    await w.open();
    const H = w.sb.History, SD = w.sb.StateDeriver;
    const S0 = SD.defaultSettings();
    const ev = (l, type, sender, content, id) => ({ eventId: "$" + (id || ("d" + l)), type: type, sender: sender, ts: 1792447900000 + l * 1000, l: l, senderRank: 99,
      content: Object.assign({ t: type }, content) });
    const base = [ev(1, "ddjp.room.settings", B.OWNER, { s: S0 }), ev(2, "ddjp.dj.join", B.OWNER, { v: "ownerSong01" }), ev(3, "ddjp.dj.join", B.BOT, { v: "botSong0001" })];
    const P1 = ev(4, "ddjp.dj.play", B.BOT, { p: null }, "7FS82d"), P2 = ev(4, "ddjp.dj.play", B.OWNER, { p: null }, "5KpTBd");
    const ord = (list) => list.slice().sort((a, b) => (a.l - b.l) || a.eventId.localeCompare(b.eventId));
    const seedP1 = SD.buildSeed(ord(base.concat([P1])));          // the save point a sealer makes having heard only P1
    const settleP1 = { at: 4, seed: seedP1 };
    const pis = () => H.recent().map((x) => x.pi).sort();
    const row = (pi, l, src) => ({ pi: pi, l: l, src: src, videoId: "x", dj: B.OWNER, at: 1 });   // a row another path wrote

    // THE SAME STRETCH ASKED AGAIN, CHANGED: the live refresh asks on every advance; a stretch that grew is answered again.
    H._setForTest([]);
    H.ingest(ord(base.concat([P1])), undefined, { src: "refresh", from: 1, to: 4, settle: settleP1 });
    const r2 = H.ingest(ord(base.concat([P1, P2])), undefined, { src: "refresh", from: 1, to: 4, settle: settleP1 });
    ok(JSON.stringify(pis()) === JSON.stringify(["$7FS82d"]) && r2.settled && r2.settled.dropped.length === 1 && r2.settled.dropped[0].pi === "$5KpTBd",
      "D: A STRETCH THAT CHANGED IS SETTLED AGAIN — the late play is left out once it is held, though the stretch was asked about before", { rows: pis(), settled: r2.settled });

    // THE ENGINE'S HAND-OFF (J92: at adoption, and the trim): prunes only a stretch its save point re-decided, only the live writers'
    // rows, only inside the stretch.
    const table = () => [row("$5KpTBd", 4, "refresh"), row("$verified", 3, "verify"), row("$stale", 2, "settle"), row("$below", 1, "refresh"), row("$above", 9, "refresh")];
    H._setForTest(table());
    H.ingest(ord(base.concat([P1, P2])), undefined, { src: "settle", from: 2, to: 4, settle: settleP1 });
    ok(JSON.stringify(pis()) === JSON.stringify(["$7FS82d", "$above", "$below", "$verified"]),
      "D: A STRETCH ITS SAVE POINT RE-DECIDED: the live writers' rows the settled fold does not produce leave, inside the stretch only; another path's row stays", pis());
    H._setForTest(table());
    H.ingest(ord(base.concat([P1, P2])), undefined, { src: "settle", from: 2, to: 4, settle: { at: 4, seed: SD.buildSeed(ord(base.concat([P1, P2]))) } });
    ok(pis().indexOf("$stale") >= 0 && pis().indexOf("$5KpTBd") >= 0,
      "D: a stretch its save point agrees with removes nothing — it is the fold refresh already wrote", pis());

    // ONLY THE STRETCH THE SAVE POINT CLOSES is folded as it counted it: what lies above it is the live fold's, untouched.
    const P3 = ev(6, "ddjp.dj.join", B.OWNER, { v: "ownerSong02" });
    H._setForTest([row("$verified", 3, "verify")]);
    const r3 = H.ingest(ord(base.concat([P1, P2, P3])), undefined, { src: "refresh", from: 1, to: 6, settle: { at: 3, seed: SD.buildSeed(ord(base)) } });
    ok(!r3.settled && pis().indexOf("$5KpTBd") >= 0 && pis().indexOf("$verified") >= 0,
      "D: A SAVE POINT BELOW THE RACE DOES NOT SETTLE IT — the race above its cut is the live fold's, by the room's order", { rows: pis(), settled: r3.settled });

    // A BACKFILL AND A GAP FILL follow the save point that closes their stretch.
    const cpEv = { eventId: "$cp", type: "ddjp.checkpoint", sender: B.OWNER, ts: 1792447905000, l: 5, senderRank: 99, content: { t: "ddjp.checkpoint", floorL: 4, seed: seedP1 } };
    const room5 = ord(base.concat([P1, P2])).concat([cpEv]);
    const pager = async (from, to) => { const out = room5.filter((e) => e.l >= from && e.l <= to); out.reachedFrom = from; return out; };
    H.reset(); H.markOpened();
    H.attach({ pageRange: pager, anchorOf: (e) => (e.type === "ddjp.checkpoint" ? { l: e.content.floorL, seed: e.content.seed } : null) });
    await H.backfill(0, undefined, 6);
    ok(JSON.stringify(pis()) === JSON.stringify(["$7FS82d"]), "D: A BACKFILL FOLLOWS THE SAVE POINT THAT CLOSES ITS STRETCH", pis());
    H.reset(); H.markOpened();
    H.attach({ pageRange: pager, anchorOf: (e) => (e.type === "ddjp.checkpoint" ? { l: e.content.floorL, seed: e.content.seed } : null) });
    H.restore({ v: 2, rows: [], ranges: [[0, 0], [5, 6]] });
    await H.fillGaps();
    ok(JSON.stringify(pis()) === JSON.stringify(["$7FS82d"]), "D: AND SO DOES A GAP FILL", pis());

    // NOTHING ELSE IS GUESSED: a stretch no same-position play explains is left as it folds, and the audit says where.
    const seedNone = SD.buildSeed(ord(base));                       // a save point recording nothing playing
    const odd = ord(base.concat([P2])).concat([Object.assign({}, cpEv, { content: { t: "ddjp.checkpoint", floorL: 4, seed: seedNone } })]);
    const an = H.deriveAnchored(odd, [{ l: 4, seed: seedNone }]);
    ok(an.rows.some((x) => x.pi === "$5KpTBd") && !(an.settled || []).length && an.floorChecks.some((c) => c.floorL === 4 && c.segmentHead === "$5KpTBd" && c.floorHead === null),
      "D: A STRETCH NO SAME-POSITION PLAY EXPLAINS IS LEFT AS IT FOLDS, and the audit's check still reports it", an);
  }

  if (failed) { console.log("[save-point-race] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[save-point-race] PASS — song history and the history audit follow the save point, and the log says it in plain words " +
    "(the owner's rulings 41 and 42, J91 and J92; " + asserts + " assertions). DRIVEN on the real backend1 engine, History and the bridge. A RACE A SAVE " +
    "POINT SETTLED BY FIRST ARRIVAL — the owner's tab sealing having heard one play, the bot's tab both, a device opening later: all " +
    "three play the save point's song, their song histories are equal and equal to the audit's truth on every tab (J90: three " +
    "histories, and a truth counting both), the audit names the case, and the bot's tab says which row left and why, at once; a tab " +
    "catching up when the save point arrives follows it once live; THE SEALER ITSELF, when a play at its save point's position arrives " +
    "while the seal is sent, says so in plain words and its history follows its save point (J92). A SAVE " +
    "POINT THAT AGREES re-decides nothing. THE REOPEN LINE says when the tab is only still loading, and live names both answers and " +
    "what the save point recorded, never what it \"banks\". THE ROOM'S ORDER IS THE ENGINE'S: ids by code unit, so verify, the cache and " +
    "the audit read a race between \"$Nab…\" and \"$mt8E…\" as every device did, and a table stored before that order is checked " +
    "again, once (ruling 42, J92). THE TABLE IS RESTORED ONCE A VISIT: a second backfill (every trim re-arms one) does not put back " +
    "the old row the first one's check removed, a later visit reads and checks it again, and a table already stored with two songs " +
    "at one position under a check is checked again (J97: \"1 extra $mt8E… — from cache under 5:…\"). ON HISTORY ITSELF: a changed stretch is settled again; only " +
    "the stretch a save point closes follows it; a backfill and a gap fill follow their save point; " +
    "a stretch no same-position play explains is left as it folds. NOT HELD: a device that never received the save point's play " +
    "(verify corrects it at the next open)");
}
main().catch((e) => { console.log("[save-point-race] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
