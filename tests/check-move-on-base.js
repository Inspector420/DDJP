#!/usr/bin/env node
// tests/check-move-on-base.js
// SUBJECT: backends/backend1/streammanager.js
//
// WALL: THE MOVE-ON CHECK FOLDS THIS TAB'S OWN EVENTS FROM WHAT THIS TAB'S FOLD STOOD ON, AND SAYS ONLY WHAT IT KNOWS (J93).
//
// ── WHAT WAS FOUND (the owner's `?v=540` run, room "sharednew", lines pasted inline by the supervisor) ──────────────────────
// At the reopen the save points reached the tab before the events they cover. It trimmed at one whose boundary it held
// (23:03:19.536 "derived log trimmed to floor l=8"), then followed n=3 to n=6 without trimming ("boundary not held"), and the
// events from l=10 to l=91 then arrived below the accepted boundary and were set aside ("already banked below the accepted
// boundary at l=91", 77 lines). Live, the other tab's play arrived at l=106 and this tab sealed n=7 at it. The move-on check
// folded this tab's events from its HELD BASE — the save point at l=8 — over a held log with l=10..91 missing, got another
// song playing, and J92's wording blamed "something that reached this tab after the save point was sealed". Nothing had: one
// ORDER line for l=106, and this tab sent no play. The base was short; the check did not know it, and its line claimed a cause.
//
// ── WHAT THIS HOLDS, ALL DRIVEN (the real backend1 engine, Floor, Checkpoint, History and the bridge; the SDK client is the
//    only double, `tests/_botroom.js`) ───────────────────────────────────────────────────────────────────────────────────
//   P  THE OWNER'S SEQUENCE: a reload whose events channel is the slow one; "floor n=2 boundary not held", then the trim at
//      n=2's l; n=3 to n=7 "boundary not held"; the events up to n=7 set aside below the accepted boundary; the other tab's play,
//      and this tab's seal at that play's own position. From the held base that play is refused; from n=7 it is accepted.
//   A  THE CHECK FOLDS FROM n=7, THE SAVE POINT THIS TAB'S FOLD STOOD ON, says so and says why not from the held base — and no
//      warning, and no claim that anything arrived late.
//   B  THE TRIM AFTER IT IS SAFE: the tab trims (the save point proves itself by the room's rebuild from n=7 and the held events
//      between), and afterwards plays what a tab that held everything plays, with the same state, the same song history, and the
//      history audit at 0 missing, 0 extra.
//   C  A SAVE POINT THAT DOES NOT REPRODUCE from that base still warns, names the base it folded from, and says it cannot tell
//      why; it is followed, as the room decides, and nothing is forgotten under it.
//   D  THE CONTROL: the tab that held everything folds from its held base, and its line is unchanged.
//   E  THE RECORD'S EDGES (`StreamManager.setAside()`): what was set aside above the held base, until a trim banks it; a
//      fetch-back to a later save point banks it too; a new room starts with none. (The room-start fetch-back moves the base to
//      the room's start; no guard reaches it after such a reopen — `mutate-j93-move-on-base` MB8, measured green.)
//
// ── WHAT IT DOES NOT HOLD ────────────────────────────────────────────────────────────────────────────────────────────────
//   · The three other readers of the same held base after such a reopen (what the trim keeps of who was active, the hand-off
//     to song history, the rotation's entry times). J93 described them and built nothing there; ruling 43 (J94, J95) made them
//     count from the save point the tab follows, and `check-short-base-readers` holds that.
//   · A homeserver's timing: the slow events channel stands in for the real paging order.
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[move-on-base] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
}
// THE OWNER'S REOPEN, as a world (`tests/_reopen.js`; moved out of this file at J94 so `check-short-base-readers` drives the same story).
const { settle, CH, MIN, story } = require(path.join(__dirname, "_reopen.js"));
const accepted = (sb, log, seed, id) => { const a = sb.StateDeriver.deriveAccepted(log, seed);
  return a instanceof Set ? a.has(id) : Array.isArray(a) ? a.indexOf(id) >= 0 : !!(a && a[id]); };
// The record, where the engine offers it ("absent" on a build without it, so a red-first run reads every row rather than a throw).
const setAsideOf = (w) => (typeof w.sb.StreamManager.setAside === "function") ? w.sb.StreamManager.setAside() : "absent";
const strip = (st) => JSON.stringify({ np: st.nowPlaying, rot: st.rotation, set: st.settings, adv: st.advance, c: st.counts && st.nowPlaying && st.counts[st.nowPlaying.pi] });

async function main() {
  // ── P, A, B, D — the owner's sequence, and this tab's own seal at the play's position ───────────────────────────────────
  {
    const { R, T, G, cps, play, reopen, at, setB } = await story();
    const n2 = cps[1], n7 = cps[6], pl = R.lOf(play);
    ok(cps.every((c, i) => c && c.n === i + 1) && n2.covers.split("..")[1] === setB.event_id,
      "P PREMISE — seven save points, n=2's boundary the settings change", cps.map((c) => c && { n: c.n, floorL: c.floorL, covers: c.covers }));
    const lines = reopen.filter((m) => /move-on check|trimmed to floor/.test(m));
    const want = ["info: StreamManager: move-on check — floor n=2 boundary not held",
      "debug: StreamManager: derived log trimmed to floor l=" + n2.floorL + " (3 dropped, 1 held)"]
      .concat([3, 4, 5, 6, 7].map((n) => "info: StreamManager: move-on check — floor n=" + n + " boundary not held"));
    ok(JSON.stringify(lines) === JSON.stringify(want),
      "P PREMISE — the owner's reopen: \"floor n=2 boundary not held\", the trim at n=2's position, then n=3 to n=7 \"boundary not held\"", lines);
    const aside = reopen.filter((m) => m.indexOf("already banked below the accepted boundary at l=" + n7.floorL + " (held, and still servable for repair)") >= 0);
    const hole = (R.server[CH.events_owner] || []).map(R.lOf).filter((l) => l > n2.floorL && l <= n7.floorL);
    ok(aside.length === hole.length && hole.length > 40 && T.sb.StreamManager._trimState() === n2.floorL && T.sb.Floor.current().n === 7,
      "P PREMISE — the events from n=2's cut to n=7's are set aside below the accepted boundary; the tab stays trimmed at n=2 and follows n=7",
      { aside: aside.length, hole: hole.length, trim: T.sb.StreamManager._trimState(), floor: T.sb.Floor.current().n });
    const log = T.sb.StreamManager.getLog();
    ok(accepted(T.sb, log, n2.seed, play.event_id) === false && accepted(T.sb, log.filter((e) => e.l > n7.floorL), n7.seed, play.event_id) === true,
      "P PREMISE — THE CAUSE: from the held base the live play is refused (its parent is in the set-aside stretch); from n=7 it is accepted",
      [accepted(T.sb, log, n2.seed, play.event_id), accepted(T.sb, log.filter((e) => e.l > n7.floorL), n7.seed, play.event_id)]);
    const rec = setAsideOf(T);
    ok(rec && rec.base === n2.floorL && rec.n === hole.length && rec.lo === Math.min(...hole) && rec.hi === Math.max(...hole),
      "E: THE RECORD — what this tab set aside above its held base, and where", { rec, hole: hole.length });
    const gAt = G.logs.length;
    const cp = await R.seal(T);
    ok(cp && cp.n === 8 && cp.floorL === pl && T.said(/Checkpoint: sealing n=8 floorL=/, at).length === 1,
      "P PREMISE — this tab seals n=8 at the play's own position", cp && { n: cp.n, floorL: cp.floorL, play: pl });

    // ── A ──
    const said = T.said(/move-on check/, at);
    ok(JSON.stringify(said) === JSON.stringify(["info: StreamManager: move-on check — floor n=8 reproduces from save point n=7 at l=" + n7.floorL +
      ", the one this tab's fold stood on — not from its held base (the save point at l=" + n2.floorL + "), which is short: " + hole.length +
      " event(s) from l=" + Math.min(...hole) + " to l=" + Math.max(...hole) + " were set aside as already banked under a save point this tab follows but could not trim to"]),
      "A: THE CHECK FOLDS FROM THE SAVE POINT THIS TAB'S FOLD STOOD ON, AND SAYS WHY NOT FROM ITS HELD BASE", said);
    ok(!T.logs.slice(at).some((m) => /^warn: StreamManager: move-on|reached this tab after/.test(m)),
      "A: AND NO WARNING, AND NO CLAIM THAT ANYTHING REACHED THIS TAB LATE — one play at l=" + pl + ", and this tab sent none", T.said(/^warn/, at));

    // ── B ──
    const trims = T.said(/trimmed to floor/, at);
    ok(trims.length === 1 && trims[0].indexOf("trimmed to floor l=" + pl + " (") >= 0 && T.sb.StreamManager._trimState() === pl,
      "B PREMISE — the tab trims under n=8 after the check, as the owner's did", trims);
    ok(setAsideOf(T) === null, "E: A TRIM BANKS WHAT WAS SET ASIDE AT OR BELOW ITS CUT — the record is empty", setAsideOf(T));
    await settle(50);
    ok(T.head() === play.event_id && strip(T.sb.StreamManager.getState()) === strip(G.sb.StreamManager.getState()),
      "B: THE TRIM IS SAFE — afterwards this tab plays what the tab that held everything plays, with the same state", { T: T.head(), G: G.head() });
    const a = await T.sb.B1MatrixBridge.historyAudit();
    ok(JSON.stringify(T.rows()) === JSON.stringify(G.rows()) && T.rows().some((x) => x.indexOf(play.event_id + "|") === 0) &&
      a.truthCount === T.rows().length && !a.missing.length && !a.extra.length,
      "B: AND THE SAME SONG HISTORY, THE AUDIT AT 0 MISSING, 0 EXTRA", { T: T.rows(), G: G.rows(), truth: a.truthCount, missing: a.missing, extra: a.extra });

    // ── D ──
    const gSaid = G.said(/move-on check — floor n=8 /, gAt);
    ok(JSON.stringify(gSaid) === JSON.stringify(["info: StreamManager: move-on check — floor n=8 reproduces from the held base"]),
      "D: THE CONTROL — the tab that held everything folds from its held base, and its line is unchanged", G.said(/move-on/, gAt));
  }

  // ── C — A SAVE POINT THAT DOES NOT REPRODUCE from that base ──────────────────────────────────────────────────────────────
  {
    const { R, T, G, cps, play, at } = await story();
    const n2 = cps[1], n7 = cps[6], pl = R.lOf(play);
    // The other tab seals n=8 at the play; its record is altered to name the song before it, and its fingerprint recomputed.
    const before = G.sent.length; await G.sb.Checkpoint.seal();
    const real = G.sent.slice(before).filter((s) => s.t === "ddjp.checkpoint")[0].body;
    const CF = T.sb.CheckpointFormat, bad = JSON.parse(JSON.stringify(real));
    const was = bad.seed.nowPlaying.pi;
    bad.seed.nowPlaying = Object.assign({}, bad.seed.nowPlaying, { pi: cps[5].seed.nowPlaying.pi });
    bad.h = CF.fingerprint(bad.n, bad.prev, bad.seed, bad.floorL, bad.thin, bad.covers);
    ok(was === play.event_id && bad.seed.nowPlaying.pi !== was, "C PREMISE — the altered save point names another song than the play at l=" + pl, [was, bad.seed.nowPlaying.pi]);
    R.post(G, bad); await settle();
    const warn = T.said(/move-on check/, at);
    ok(JSON.stringify(warn) === JSON.stringify(["warn: StreamManager: move-on check — save point n=8 at l=" + pl + " records " + bad.seed.nowPlaying.pi +
      " as playing; this tab's own events up to it, folded from save point n=7 at l=" + n7.floorL + " (the one this tab's fold stood on), give " + play.event_id +
      ". This check does not say why. The room follows the save point; so does song history."]),
      "C: A SAVE POINT THAT DOES NOT REPRODUCE STILL WARNS, NAMES ITS BASE, AND CLAIMS NO CAUSE IT CANNOT KNOW", warn);
    ok(T.sb.Floor.current().h === bad.h && T.sb.StreamManager._trimState() === n2.floorL && T.said(/trimmed to floor/, at).length === 0,
      "C: AND IT IS FOLLOWED, AS THE ROOM DECIDES, BUT NOTHING IS FORGOTTEN UNDER IT — it does not prove itself", { floor: T.sb.Floor.current().h === bad.h, trim: T.sb.StreamManager._trimState() });

    // ── E — THE RECORD'S EDGES, on this tab (nothing trimmed under n=8, so the stretch is still set aside) ──
    const SM = T.sb.StreamManager, hole = (R.server[CH.events_owner] || []).map(R.lOf).filter((l) => l > n2.floorL && l <= n7.floorL);
    const r0 = setAsideOf(T);
    ok(r0 && r0.base === n2.floorL && r0.n === hole.length, "E PREMISE — the stretch is still set aside above the held base", r0);
    SM.restoreBelow(n7, [], false);
    ok(setAsideOf(T) === null, "E: A FETCH-BACK TO A LATER SAVE POINT BANKS WHAT WAS SET ASIDE AT OR BELOW ITS CUT", setAsideOf(T));
    // below the followed save point and above the new base; minted when its position was current (not a backdate)
    T.deliver(R.store(R.raw(B.STAFF, { t: "ddjp.dj.vote", p: play.event_id }, { l: n7.floorL + 1, dt: -10 * MIN })), 99);
    const r2 = setAsideOf(T);
    ok(r2 && r2.base === n7.floorL && r2.n === 1 && r2.lo === n7.floorL + 1, "E PREMISE — an arrival the followed save point banks is set aside above the new base", r2);
    SM.reset();
    ok(setAsideOf(T) === null, "E: A NEW ROOM STARTS WITH NOTHING SET ASIDE (`reset`)", setAsideOf(T));
  }

  if (failed) { console.log("[move-on-base] " + failed + " failure(s) of " + asserts); process.exit(1); }
  console.log("[move-on-base] PASS — the move-on check folds this tab's own events from the save point its fold stood on when its " +
    "held base is short, and says so: the owner's reopen (a trim at l=8, save points followed to l=91 without their boundaries, the " +
    "events below set aside) no longer warns of a late arrival; the trim after it is safe — the tab then plays, holds and audits what a " +
    "tab that held everything does; a save point that does not reproduce from that base still warns, names it and claims no cause; " +
    "the tab that held everything is unchanged (" + asserts + " assertions)");
  process.exit(0);
}
main().catch((e) => { console.log("[move-on-base] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
