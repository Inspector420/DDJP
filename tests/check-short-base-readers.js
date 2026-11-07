#!/usr/bin/env node
// tests/check-short-base-readers.js
// SUBJECT: backends/backend1/streammanager.js
//
// WALL: WHERE A TAB'S HELD BASE IS SHORT, WHAT IT KEEPS OF WHAT IT FORGETS COUNTS FROM THE SAVE POINT IT FOLLOWS (the owner's
// ruling 43, J94) — AND THE ACTS AND ADDITIONS IT SET ASIDE ARE TAKEN AS THEY ARRIVE (J95).
//
// ── WHAT WAS FOUND (J93, described for the owner and not built: it changes what a trim keeps when it forgets) ────────────────
// The owner's `?v=540` reopen (`tests/_reopen.js`): the tab trimmed at a save point at l=8, followed later save points it could
// not trim to, and set aside the events below them. J93 fixed the move-on check's base. Three other readers still counted from
// the l=8 base: what the trim keeps of WHO WAS ACTIVE (it judged the dropped acts by a fold that never saw the set-aside stretch,
// so a vote on a play after it counted for nobody, and the set-aside acts themselves were never taken); SONG HISTORY's hand-off
// (the same fold, so a play that ended in the dropped stretch lost its final tally); and the ROTATION'S ENTRY TIMES (a member
// who joined inside the stretch had none). The owner's ruling 43: once a tab follows a save point it could not trim to and has
// set events aside below it, those readers count from that save point; the set-aside events' activity comes from the raw
// cache, which still holds them. Local records only.
//
// ── WHAT THIS HOLDS, ALL DRIVEN (the real backend1 engine, Floor, Checkpoint, Activity, History and the bridge; the SDK client
//    is the only double) — the reopened tab against the tab that held every event, the same room ─────────────────────────
//   P  THE REOPEN, AS J93 DROVE IT; a member (@vip) joins inside the stretch it sets aside; the reopened tab's base is short.
//   E  THE ENTRY TIMES WHILE THE BASE IS SHORT (the bot runtime reads them when it starts): equal, @vip's included.
//   (P to C leave the transport's coalesced sweep pending, so the trim's own take — the fallback for a stretch that never became
//    whole before it — is what they read. N and W are reopens of their own.)
//   N  RIGHT AFTER THE REOPEN, BEFORE ANY TRIM (J95, the owner's call on J94's first two decisions), once the transport's
//      coalesced sweep has run: who is recently active — the People tab's and the bot's AFK checks' reader, `Room.recentlyActive`
//      — equals the tab's that held every event, @staff's votes all through the set-aside stretch and @hs's one early in it
//      included; and the repeat rule's added record knows @vip's addition inside it.
//   W  A STRETCH NOT YET WHOLE (the raw cache missing one of its events) IS NOT TAKEN: no act judged by a fold short of it; and
//      at the trim, the repeat rule's added record still takes its additions — the fallback (J96, the supervisor's J95 check).
//   A  AFTER THE TRIM, THE ACTIVITY RECORD: equal — the votes inside the set-aside stretch (from the raw cache) and the votes on
//      the play the trim dropped (@hs) among them; and the repeat rule's added record knows @vip's addition inside the stretch (J96).
//   H  AFTER THE TRIM, SONG HISTORY: equal, final tallies included — the play that ended in the dropped stretch keeps its votes.
//   R  AFTER THE TRIM, THE ENTRY TIMES: equal.
//   C  THE CONTROL: the tab that held every event has every one of those acts in its own record (an absolute reading, so two
//      tabs broken the same way cannot pass as equal).
//
// ── WHAT IT DOES NOT HOLD ────────────────────────────────────────────────────────────────────────────────────────────────
//   · A set-aside stretch that is not yet whole when the sweep runs (still paging) is taken at a later sweep, or at the trim: W
//     holds that nothing is taken meanwhile, not when the rest arrives.
//   · A raw cache that no longer holds a set-aside event: that act is not taken (nothing else holds it).
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));
const { settle, story } = require(path.join(__dirname, "_reopen.js"));

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[short-base-readers] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
// Every reader, as a value two tabs can be compared by (keys sorted, so the order things were taken in does not matter).
const sorted = (o) => (o && typeof o === "object" && !Array.isArray(o)) ? Object.keys(o).sort().reduce((a, k) => { a[k] = sorted(o[k]); return a; }, {}) : o;
const activity = (w) => JSON.stringify(sorted(w.sb.Activity.read()));
const entries = (w) => JSON.stringify(sorted(w.sb.StreamManager.rotationEntries()));
const songs = (w) => w.sb.History.recent().map((r) => r.pi + "|" + r.videoId + "@" + r.l + "|" + JSON.stringify(r.counts || null)).sort();
// THE TRANSPORT'S COALESCED SWEEP (`MatrixBridge`'s `ddjp.local.banked` subscriber, a 0 ms timeout in a browser), run as a
// browser would — and only it: the history backfill a trim rearms rides the same beat, and J95 found that it strips past tallies
// from song history on every tab (reported to the owner, not changed here); H reads the hand-offs, not that.
const sweep = (w) => { for (const t of w.timers.live()) if (t.ms === 0 && /settleBanked/.test(String(t.fn))) t.fn(); };
const activeAt = (w, now) => JSON.stringify(sorted(w.sb.Room.recentlyActive(now)));
const activeNow = (w, now, who) => (w.sb.Room.recentlyActive(now).people || []).some((p) => p.userId === who);
const voted = (w, who) => { const a = w.sb.Activity.read(); return a && a.by[who] && a.by[who].vote; };

async function main() {
  const { R, T, G, cps, play, joined } = await story({ joinInStretch: B.VIP });
  const n2 = cps[1], n7 = cps[6];
  const SM = T.sb.StreamManager, rec = typeof SM.setAside === "function" ? SM.setAside() : null;
  ok(cps.every((c, i) => c && c.n === i + 1) && SM._trimState() === n2.floorL && T.sb.Floor.current().n === 7 &&
     rec && rec.base === n2.floorL && rec.hi === n7.floorL && joined && R.lOf(joined) > n2.floorL && R.lOf(joined) <= n7.floorL,
    "P PREMISE — the reopen as J93 drove it: trimmed at n=2, following n=7, the stretch between set aside, @vip's join inside it",
    { trim: SM._trimState(), floor: T.sb.Floor.current().n, rec, joined: joined && R.lOf(joined) });
  ok(G.sb.StreamManager.rotationEntries()[B.VIP] !== undefined, "P PREMISE — @vip is in the rotation for the tab that held every event");

  // ── E ──
  ok(entries(T) === entries(G), "E: THE ENTRY TIMES WHILE THE BASE IS SHORT ARE THE TAB'S THAT HELD EVERY EVENT — @vip's included", { T: entries(T), G: entries(G) });

  // The repeat rule's added record, before the trim: the transport's sweep is left pending here, so nothing has noted @vip's
  // addition inside the stretch yet (J96).
  const vipV0 = JSON.parse(joined.content.body).v, addedL = (w) => w.sb.History.addedAtL(B.VIP, vipV0);
  ok(addedL(T) === null && addedL(G) === R.lOf(joined), "A PREMISE — before the trim, the reopened tab has not noted @vip's addition; the tab that held every event has",
    { T: addedL(T), G: addedL(G) });

  // Votes on the live play, the next song (so the live play ENDS inside what the trim drops), and this tab's seal at its position.
  for (const who of [B.HS, B.BOT]) R.put(who, { t: "ddjp.dj.vote", p: play.event_id });
  R.now += 5 * 60000;
  const next = R.put(B.OWNER, { t: "ddjp.dj.play", p: play.event_id });
  const at = T.logs.length;
  const cp = await R.seal(T); await settle(50);
  ok(cp && cp.n === 8 && cp.floorL === R.lOf(next) && T.said(/trimmed to floor l=/, at).length === 1 && SM._trimState() === cp.floorL &&
     G.sb.StreamManager._trimState() === cp.floorL,
    "P PREMISE — this tab seals n=8 at the next play's position and both tabs trim under it", { cp: cp && cp.floorL, trims: T.said(/trimmed to floor/, at) });

  // ── C ── the control, absolute
  const lastStaff = Math.max(...(R.server[B.FULL_CH.events_owner] || []).filter((r) => r.sender === B.STAFF).map((r) => r.origin_server_ts));
  const lastHs = Math.max(...(R.server[B.FULL_CH.events_owner] || []).filter((r) => r.sender === B.HS).map((r) => r.origin_server_ts));
  ok(voted(G, B.STAFF) === lastStaff && voted(G, B.HS) === lastHs,
    "C: THE CONTROL — the tab that held every event keeps @staff's last vote (inside the set-aside stretch) and @hs's (on the dropped play)",
    { staff: [voted(G, B.STAFF), lastStaff], hs: [voted(G, B.HS), lastHs] });
  const playRow = (w) => w.sb.History.recent().find((r) => r.pi === play.event_id);
  ok(playRow(G) && playRow(G).counts && playRow(G).counts.votes === 2,
    "C: THE CONTROL — and the play that ended in the dropped stretch keeps its final tally in its row", playRow(G));

  // ── A, H, R ──
  ok(voted(T, B.STAFF) === lastStaff, "A: THE ACTS INSIDE THE SET-ASIDE STRETCH ARE TAKEN — from the raw cache", { T: voted(T, B.STAFF), want: lastStaff });
  ok(voted(T, B.HS) === lastHs, "A: THE VOTES ON THE PLAY THE TRIM DROPPED COUNT — judged from the save point this tab followed", { T: voted(T, B.HS), want: lastHs });
  ok(activity(T) === activity(G), "A: THE ACTIVITY RECORD IS THE TAB'S THAT HELD EVERY EVENT", { T: activity(T), G: activity(G) });
  ok(JSON.stringify(songs(T)) === JSON.stringify(songs(G)), "H: SONG HISTORY IS THE TAB'S THAT HELD EVERY EVENT, final tallies included", { T: songs(T), G: songs(G) });
  // And the repeat rule's added record (J96): after the trim the reopened tab knows @vip's addition inside the stretch. Here the
  // cache holds the whole stretch, so song history's hand-off notes it; W below is where only the trim's own record can.
  ok(addedL(T) === addedL(G) && addedL(T) === R.lOf(joined),
    "A: AFTER THE TRIM, THE REPEAT RULE'S ADDED RECORD KNOWS @vip's ADDITION INSIDE THE STRETCH", { T: addedL(T), G: addedL(G) });
  R.put(B.HS, { t: "ddjp.dj.join", v: "vidHS0000001" }); await settle();   // a rotation change after the cut, held by both
  ok(entries(T) === entries(G) && Object.keys(T.sb.StreamManager.rotationEntries()).length > 0,
    "R: AND SO ARE THE ENTRY TIMES AFTER THE TRIM (both now count from n=8; the short base mattered only before it, E)", { T: entries(T), G: entries(G) });

  // ── N — RIGHT AFTER THE REOPEN, BEFORE ANY TRIM (J95): the same reopen, its coalesced sweep run. (P to C above leave the sweep
  //    pending, so the trim's own take — the fallback for a stretch never whole before it — is what they read.) ──
  {
    const s1 = await story({ joinInStretch: B.VIP, earlyVote: B.HS });
    const { R: R1, T: T1, G: G1, cps: c1, joined: j1 } = s1;
    for (const w of [T1, G1]) sweep(w);
    await settle();
    ok(T1.sb.StreamManager._trimState() === c1[1].floorL, "N PREMISE — no trim yet: the reopened tab is still trimmed at n=2", T1.sb.StreamManager._trimState());
    ok(activeNow(G1, R1.now, B.STAFF) && activeNow(G1, R1.now, B.HS),
      "N: THE CONTROL — @staff (votes all through the stretch) and @hs (one vote early in it) are recently active for the tab that held every event");
    ok(activeAt(T1, R1.now) === activeAt(G1, R1.now),
      "N: WHO IS RECENTLY ACTIVE (the People tab, the bot's AFK checks) IS THE TAB'S THAT HELD EVERY EVENT, at once", { T: activeAt(T1, R1.now), G: activeAt(G1, R1.now) });
    const vipV = JSON.parse(j1.content.body).v, addL = (w) => w.sb.History.addedAtL(B.VIP, vipV), addT = (w) => w.sb.History.addedAt(B.VIP, vipV);
    ok(addL(G1) === R1.lOf(j1) && addL(T1) === addL(G1) && addT(T1) === addT(G1),
      "N: THE REPEAT RULE'S ADDED RECORD KNOWS @vip's ADDITION INSIDE THE STRETCH, at once", { T: [addL(T1), addT(T1)], G: [addL(G1), addT(G1)] });
  }

  // ── W — A STRETCH NOT YET WHOLE IS NOT TAKEN (J95): the same reopen, with the raw cache missing one set-aside event. Its fold
  //    from the held base does not reproduce the save point it follows, so none of its acts is judged — nothing is taken yet. ──
  {
    const s2 = await story({ joinInStretch: B.VIP });
    // the LAST PLAY inside the stretch: without it the fold cannot reach the save point, while the acts before it still judge as
    // the room judged them — so taking them anyway would show (a lost duplicate vote would change nothing the check compares)
    const lost = (s2.R.server[B.FULL_CH.events_owner] || []).filter((r) => JSON.parse(r.content.body).t === "ddjp.dj.play" && s2.R.lOf(r) > s2.cps[1].floorL && s2.R.lOf(r) <= s2.cps[6].floorL).pop();
    const EC = s2.T.sb.EventCache;
    s2.T.sb.StreamManager.setRawReader((id) => (id === lost.event_id ? null : EC.get(id)));   // the cache, less one event
    for (const w of [s2.T, s2.G]) sweep(w);
    await settle();
    const a2 = s2.T.sb.Activity.read();
    ok(activeNow(s2.G, s2.R.now, B.STAFF) && !(a2 && a2.by[B.STAFF]),
      "W: A STRETCH NOT YET WHOLE IS NOT TAKEN — with one set-aside event missing, none of its acts is judged or kept", a2);
    // AND THE TRIM IS THE FALLBACK (J96, the supervisor's J95 check). That stretch never became whole, so the sweep took nothing,
    // and song history's hand-off leaves a stretch it does not hold whole to verify — so the trim's own added record
    // (`History.noteAdds(_taken, …)`) is what notes @vip's addition inside it. Reverted to what was dropped alone, it stayed
    // green while only N read the record.
    const vipW = JSON.parse(s2.joined.content.body).v, addW = (w) => w.sb.History.addedAtL(B.VIP, vipW);
    s2.R.now += 5 * 60000;
    s2.R.put(B.OWNER, { t: "ddjp.dj.play", p: s2.play.event_id });
    const cpW = await s2.R.seal(s2.T); await settle(50);
    ok(cpW && s2.T.sb.StreamManager._trimState() === cpW.floorL && addW(s2.G) === s2.R.lOf(s2.joined) && addW(s2.T) === addW(s2.G),
      "W: AT THE TRIM, THE REPEAT RULE'S ADDED RECORD TAKES THE SET-ASIDE ADDITIONS — the fallback for a stretch never whole before it",
      { trim: s2.T.sb.StreamManager._trimState(), cp: cpW && cpW.floorL, T: addW(s2.T), G: addW(s2.G) });
  }

  if (failed) { console.log("[short-base-readers] " + failed + " failure(s) of " + asserts); process.exit(1); }
  console.log("[short-base-readers] PASS — where a tab's held base is short (the owner's reopen: trimmed at l=8, following later save " +
    "points it could not trim to, the events between set aside), what it keeps of what it forgets counts from the save point it " +
    "follows (ruling 43): its activity record, song history with final tallies, and the rotation's entry times equal the tab's " +
    "that held every event — the set-aside acts taken from the raw cache, the votes on the dropped play counted; and right after the " +
    "reopen, before any trim, who is recently active and the repeat rule's added record already equal it (J95) (" + asserts + " assertions)");
  process.exit(0);
}
main().catch((e) => { console.log("[short-base-readers] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
