// tests/check-revised-verdict.js
// SUBJECT: backends/backend1/streammanager.js
// WALL: A VERDICT THE ORDER LINE PRINTED, LATER CHANGED, IS SAID TO HAVE CHANGED (J71 item 1, the owner's approval, `ddjp_632`).
//
// The ORDER line prints each advance's verdict as it arrives, stamped `finalAtIngest`, and nothing said so when a later-arriving,
// earlier-positioned event changed it (the twenty-first signature). J71's `ddjp_561` study: a late join turned l=98's ACCEPTED
// into the room's REFUSED, and the owner's two logs of one room read as two rooms. The story here is that study's
// (`tools/probes/probe-j71-arrival-order.js`), with the owner's positions, driven through the REAL StreamManager in both
// arrival orders.
//
//   A  LIVE, ONE LINE PER CHANGE: a late join turns l=98 ACCEPTED -> REFUSED and one REVISED line names the play, both
//      verdicts, the join that changed it and what is playing now; the reverse (a late leave: REFUSED -> ACCEPTED) too; a
//      change is said once; and the line is a log line only — the room is the room a tab holding everything derives, and a
//      line that cannot be said changes nothing.
//   B  THE CONTROLS: in position order nothing is revised and nothing is said; a late arrival that changes no printed verdict
//      says nothing.
//   C  WHILE LOADING, ONE SUMMARY (the owner's choice on noise): no line per change while the tab is not live; one line when
//      it goes live, with how many and which; nothing for a verdict that changed and changed back; nothing on a later going
//      live with nothing new; and a change once live has its own line.
//   D  BOUNDED, AND A RE-DERIVE THAT IS NOT AN ARRIVAL SAYS WHAT IT WAS: only the verdicts the ORDER line printed, only for
//      events still held (a save point that drops them forgets them); a room change forgets all; and a save point adopted
//      over a tab that lacked the join revises l=98 naming the save point, not an arrival.
//   E  A VERDICT THE FOLD WAS NOT GIVEN IS NOT A CHANGE (`ddjp_633`, the first gap the supervisor planted in `ddjp_632`): a
//      tab that FOLLOWS a save point before trimming holds the plays at or below its cut, but its fold is not given them, so
//      `isLegal` answers null ("cannot say"). Those printed ACCEPTED are not revised — live, no line; loading, none owed to
//      the summary. (With "not given" read as a refusal, a healthy room would look as if it changed its mind.) And a real
//      change ABOVE the cut is said there (`ddjp_634`): the fold from the save point's seed now says what it was given, so a
//      late play that takes away l=50's and l=60's parent revises them (on `ddjp_633` it read as "cannot say", and nothing was).
//   C's ORDER ROW (`ddjp_633`, the second gap): while loading, more changes than the summary names, found out of position
//      order (a late play at l=45 first, then one at l=15); the summary names the lowest positions, in order, and counts the rest.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));

let failed = 0, A = 0;
function ok(cond, msg, got) {
  A++;
  if (!cond) { failed++; console.log("[revised-verdict] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/dials.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js",
  "backends/backend1/history.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js",
  "backends/backend1/continuity.js", "backends/backend1/streammanager.js"];
const T0 = 1.79e12, MIN = 60000;
const S = loadInContext(["backends/backend1/ranks.js", "backends/backend1/dials.js", "backends/backend1/statederiver.js"], {}).StateDeriver.defaultSettings();
const ev = (id, l, ts, who, rank, c) => F.reducerEvent(id, l, ts, who, rank, c);
// THE STUDY'S ROOM, AT THE OWNER'S POSITIONS. A plays; K's join puts a song in the rotation; l=94 ends A and starts the next
// song if there is one; B joins; l=98 is a `p=null` play, legal only when nothing is playing. K's leave (the reverse story)
// empties the rotation again before l=94. $jZ is a join that changes no play's verdict.
const ROOM = [ev("$set", 89, T0, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: S }),
  ev("$jA", 90, T0 + MIN, "@a:hs", F.RANK.owner, { t: "ddjp.dj.join", v: "vidSONGAAAAA" }),
  ev("$pA", 91, T0 + 2 * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: null }),
  ev("$jK", 92, T0 + 3 * MIN, "@k:hs", F.RANK.player, { t: "ddjp.dj.join", v: "ckmQq8Bf39g" }),
  ev("$kL", 93, T0 + 4 * MIN, "@k:hs", F.RANK.player, { t: "ddjp.dj.leave" }),
  ev("$p94", 94, T0 + 12 * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: "$pA" }),
  ev("$jB", 95, T0 + 13 * MIN, "@b:hs", F.RANK.owner, { t: "ddjp.dj.join", v: "GtLkXIzMQck" }),
  ev("$jZ", 96, T0 + 14 * MIN, "@z:hs", F.RANK.owner, { t: "ddjp.dj.join", v: "zzzzzzzzzzz" }),
  ev("$p98", 98, T0 + 34 * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: null })];
// A SECOND ROOM, A CHAIN OF PLAYS (`ddjp_633`): eight DJs with a song each; P1 (`p=null`) and P2–P5, each naming the one
// before. Two late plays: X1 at l=45 names P3, so P4 and P5 lose their parent; X2 at l=15 starts a song before P1, so P1,
// P2, P3 and X1 lose theirs. Arriving X1 then X2, six printed ACCEPTEDs change, found out of position order.
const CHAIN = [ev("$cset", 1, T0, "@o:hs", F.RANK.owner, { t: "ddjp.room.settings", s: S })];
for (let i = 0; i < 8; i++) CHAIN.push(ev("$j" + i, 2 + i, T0 + (1 + i) * 1000, "@d" + i + ":hs", F.RANK.owner, { t: "ddjp.dj.join", v: ("vid" + i + "xxxxxxxxx").slice(0, 11) }));
const play = (id, l, m, p) => ev(id, l, T0 + m * MIN, "@o:hs", F.RANK.owner, { t: "ddjp.dj.play", p: p });
CHAIN.push(play("$X2", 15, 5, null), play("$P1", 20, 6, null), play("$P2", 30, 17, "$P1"), play("$P3", 40, 28, "$P2"),
  play("$X1", 45, 39, "$P3"), play("$P4", 50, 50, "$P3"), play("$P5", 60, 61, "$P4"));
const CHAIN_IN_ORDER = ["$cset", "$j0", "$j1", "$j2", "$j3", "$j4", "$j5", "$j6", "$j7", "$P1", "$P2", "$P3", "$P4", "$P5"];
const byId = (id) => ROOM.concat(CHAIN).find((x) => x.eventId === id);

// One tab: the real modules, its log lines kept. `live` puts its phase machine LIVE first (a tab in the room, caught up);
// otherwise it is loading (REPLAYING) until `goLive()`.
function tab(opts) {
  const o = opts || {};
  const sb = loadInContext(FILES, {});
  const lines = [];
  for (const lv of ["info", "warn", "debug", "error"]) sb.Logger[lv] = (m) => { if (o.throwOnRevised && /REVISED/.test(String(m))) throw new Error("planted: the line cannot be said"); lines.push(String(m)); };
  sb.Floor.reset(); sb.StreamManager.reset();
  sb.Session._setPhaseForTest(o.loading ? sb.Session.REPLAYING : sb.Session.LIVE);
  const t = {
    sb, lines,
    feed(ids) { for (const id of ids) sb.StreamManager.ingest(F.toRaw(byId(id))); return t; },
    revised() { return lines.filter((m) => /^StreamManager: REVISED/.test(m)); },
    order(id) { return lines.filter((m) => /^StreamManager: ORDER /.test(m) && m.indexOf(" id=" + id + " ") >= 0); },
    goLive() { sb.Session._setPhaseForTest(sb.Session.LIVE); return t; },
    state() { return JSON.stringify(sb.StreamManager.getState().nowPlaying) + "|" + ROOM.map((e) => e.eventId + ":" + sb.StreamManager.isLegal(e.eventId)).join(","); },
  };
  return t;
}
const IN_ORDER = ["$set", "$jA", "$pA", "$jK", "$p94", "$jB", "$p98"];
const JOIN_LAST = ["$set", "$jA", "$pA", "$p94", "$jB", "$p98", "$jK"];
const LEAVE_LAST = ["$set", "$jA", "$pA", "$jK", "$p94", "$jB", "$p98", "$kL"];

const L98_REFUSED = "StreamManager: REVISED ddjp.dj.play l=98 id=$p98 — was ACCEPTED, now REFUSED (advance-locked) " +
  "(after ddjp.dj.join l=92 id=$jK arrived) | now playing ckmQq8Bf39g pi=$p94";
const L98_ACCEPTED = "StreamManager: REVISED ddjp.dj.play l=98 id=$p98 — was REFUSED (advance-locked), now ACCEPTED " +
  "(after ddjp.dj.leave l=93 id=$kL arrived) | now playing GtLkXIzMQck pi=$p98";

// ── A · LIVE: ONE LINE PER CHANGE ───────────────────────────────────────────────────────────────────────────────────────────
function partA() {
  // The premise: without the join, the tab's ORDER line for l=98 printed ACCEPTED (v505's open).
  const t = tab().feed(JOIN_LAST.slice(0, -1));
  ok(t.order("$p98").length === 1 && /finalAtIngest -> ACCEPTED/.test(t.order("$p98")[0]) && t.revised().length === 0,
    "A: PREMISE — before the join arrives, the ORDER line printed l=98 ACCEPTED and nothing is revised", { order: t.order("$p98"), revised: t.revised() });
  t.feed(["$jK"]);
  ok(t.revised().length === 1 && t.revised()[0] === L98_REFUSED,
    "A: J71 — A LATE JOIN TURNS l=98 ACCEPTED INTO REFUSED, AND ONE REVISED LINE SAYS SO: the play, both verdicts, the join that " +
    "changed it, and what is playing now", t.revised());
  ok(t.sb.StreamManager.isLegal("$p98") === false && t.sb.StreamManager.isLegal("$p94") === true,
    "A: PREMISE — the room now refuses l=98 and accepts l=94 (the study's settled answer)", { p98: t.sb.StreamManager.isLegal("$p98"), p94: t.sb.StreamManager.isLegal("$p94") });
  // Said once: a later arrival that moves nothing more says nothing more.
  t.feed(["$jZ"]);
  ok(t.revised().length === 1, "A: A CHANGE IS SAID ONCE — a later arrival that changes no verdict adds no second REVISED line", t.revised());

  // The reverse: with K's join and no leave, l=98 was printed REFUSED; K's leave arrives late and the room accepts it.
  const r = tab().feed(LEAVE_LAST.slice(0, -1));
  ok(r.order("$p98").length === 1 && /finalAtIngest -> REFUSED/.test(r.order("$p98")[0]),
    "A: PREMISE (the reverse) — before the leave arrives, the ORDER line printed l=98 REFUSED", r.order("$p98"));
  r.feed(["$kL"]);
  ok(r.revised().length === 1 && r.revised()[0] === L98_ACCEPTED,
    "A: THE REVERSE — A LATE LEAVE TURNS l=98 REFUSED INTO ACCEPTED, AND ONE REVISED LINE SAYS SO, with the leave and the song now playing", r.revised());

  // A log line only: the room is the room a tab that held everything in position order derives; and a line that cannot be said
  // (the logger throws on it) leaves the ingest and the room exactly as they are (the twenty-third signature).
  const whole = tab().feed(IN_ORDER);
  ok(t.state() === tab().feed(IN_ORDER.concat(["$jZ"])).state() && whole.state() === tab().feed(JOIN_LAST).state(),
    "A: A LOG LINE ONLY — after the REVISED line, the room is the one a tab holding everything in position order derives", { revisedTab: t.state(), whole: whole.state() });
  const th = tab({ throwOnRevised: true });
  let threw = null;
  try { th.feed(JOIN_LAST); } catch (e) { threw = (e && e.message) || String(e); }
  ok(threw === null && th.state() === whole.state() && th.sb.StreamManager.getLog().length === JOIN_LAST.length,
    "A: A REVISED LINE THAT CANNOT BE SAID CHANGES NOTHING — the ingest completes, every event is held, and the room is the same", { threw, state: th.state() });
}

// ── B · THE CONTROLS ────────────────────────────────────────────────────────────────────────────────────────────────────────
function partB() {
  const t = tab().feed(IN_ORDER);
  ok(t.order("$p98").length === 1 && /-> REFUSED/.test(t.order("$p98")[0]) && t.revised().length === 0,
    "B: CONTROL — in position order every verdict printed is the room's, and nothing is revised", { order: t.order("$p98"), revised: t.revised() });
  t.feed(["$jZ"]);
  ok(t.revised().length === 0, "B: CONTROL — a late, earlier-positioned arrival that changes no printed verdict says nothing", t.revised());
}

// ── C · WHILE LOADING, ONE SUMMARY ──────────────────────────────────────────────────────────────────────────────────────────
function partC() {
  const t = tab({ loading: true }).feed(JOIN_LAST);
  ok(t.sb.StreamManager.isLegal("$p98") === false && t.revised().length === 0,
    "C: WHILE THE TAB IS LOADING THE ROOM, NO LINE PER CHANGE — l=98's verdict changed and nothing was said yet", { legal: t.sb.StreamManager.isLegal("$p98"), revised: t.revised() });
  t.goLive();
  const sum = t.revised();
  ok(sum.length === 1 && sum[0] === "StreamManager: REVISED while this tab was loading or catching up with the room — 1 verdict printed on an ORDER line changed as " +
    "later events arrived: ddjp.dj.play l=98 id=$p98 was ACCEPTED, now REFUSED (advance-locked). Each ORDER line is the verdict at ingest; " +
    "these are the verdicts now",
    "C: AT GOING LIVE, ONE SUMMARY LINE — how many verdicts changed while loading, and which (position, was, now)", sum);
  t.sb.Session._setPhaseForTest(t.sb.Session.SUSPENDED); t.goLive();
  ok(t.revised().length === 1, "C: GOING LIVE AGAIN WITH NOTHING NEW SAYS NOTHING — the summary was said once", t.revised());
  t.feed(["$kL"]);
  ok(t.revised().length === 2 && t.revised()[1] === L98_ACCEPTED,
    "C: ONCE LIVE, A CHANGE HAS ITS OWN LINE — K's leave arriving now turns l=98 back to ACCEPTED", t.revised());

  // A verdict that changed and changed back while loading is not a change: no summary at all.
  const b = tab({ loading: true }).feed(JOIN_LAST.concat(["$kL"])).goLive();
  ok(b.sb.StreamManager.isLegal("$p98") === true && b.revised().length === 0,
    "C: A VERDICT THAT CHANGED AND CHANGED BACK WHILE LOADING IS NOT IN THE SUMMARY — and with no other, no summary is said", { legal: b.sb.StreamManager.isLegal("$p98"), revised: b.revised() });

}

// ── D · BOUNDED; A RE-DERIVE THAT IS NOT AN ARRIVAL SAYS WHAT IT WAS ─────────────────────────────────────────────────────────
function partD() {
  const t = tab().feed(JOIN_LAST.slice(0, -1));
  const mem = t.sb.StreamManager._revisedForTest ? t.sb.StreamManager._revisedForTest() : null;
  ok(!!mem && JSON.stringify(mem.said) === JSON.stringify(["$pA", "$p94", "$p98"]) && mem.pending === 0,
    "D: ONLY THE VERDICTS THE ORDER LINE PRINTED ARE REMEMBERED — the three plays, no join, no settings", mem);
  // A save point at l=95, sealed by a tab that held K's join: adopted here, it drops l=91 and l=94 from the held log, and the
  // fold from its seed refuses l=98 — a re-derive that is not an arrival, and the line says what it was.
  const sealed = ["$set", "$jA", "$pA", "$jK", "$p94", "$jB"].map(byId);
  const seed = t.sb.StateDeriver.buildSeed(sealed.slice().sort((a, b) => a.l - b.l));
  const r = t.sb.StreamManager.adoptFloor({ floorL: 95, seed: seed, covers: "$set..$jB" });
  ok(r && r.ok === true, "D: PREMISE — the save point at l=95 is adopted", r);
  ok(t.revised().length === 1 && t.revised()[0] === "StreamManager: REVISED ddjp.dj.play l=98 id=$p98 — was ACCEPTED, now REFUSED (advance-locked) " +
    "(after adopting the save point at l=95, not an arrival) | now playing ckmQq8Bf39g pi=$p94",
    "D: A RE-DERIVE THAT IS NOT AN ARRIVAL SAYS WHAT IT WAS — the save point a sealer holding the join made, adopted here", t.revised());
  const after = t.sb.StreamManager._revisedForTest ? t.sb.StreamManager._revisedForTest() : null;
  ok(!!after && JSON.stringify(after.said) === JSON.stringify(["$p98"]),
    "D: A DROP FORGETS — the plays the save point banked are no longer remembered; only the one still held", after);
  t.sb.StreamManager.reset();
  const gone = t.sb.StreamManager._revisedForTest ? t.sb.StreamManager._revisedForTest() : null;
  ok(!!gone && gone.said.length === 0 && gone.pending === 0, "D: A ROOM CHANGE FORGETS EVERYTHING — `reset()` clears what was printed", gone);
  // And a loading tab's owed summary goes with the room it was about.
  const l = tab({ loading: true }).feed(JOIN_LAST);
  l.sb.StreamManager.reset(); l.goLive();
  ok(l.revised().length === 0, "D: A ROOM LEFT BEFORE GOING LIVE OWES NO SUMMARY — the next room's going live says nothing of it", l.revised());
}

// ── C · THE SUMMARY NAMES THE LOWEST POSITIONS, IN ORDER (`ddjp_633`) ─────────────────────────────────────────────────────
function partCOrder() {
  // The premise, read from a live twin: the six changes are FOUND out of position order — l=50 and l=60 when X1 arrives,
  // then l=20, 30, 40 and 45 when X2 does.
  const live = tab().feed(CHAIN_IN_ORDER.concat(["$X1", "$X2"]));
  const found = live.revised().map((m) => Number((/ l=(\d+) id=/.exec(m) || [])[1]));
  ok(JSON.stringify(found) === "[50,60,20,30,40,45]",
    "C: PREMISE — a live tab finds the six changes out of position order (l=50 and l=60 first, then the lower ones)", found);
  const t = tab({ loading: true }).feed(CHAIN_IN_ORDER.concat(["$X1", "$X2"]));
  ok(t.revised().length === 0, "C: PREMISE — while loading, none of the six is said", t.revised());
  t.goLive();
  const words = (l, id) => "ddjp.dj.play l=" + l + " id=" + id + " was ACCEPTED, now REFUSED (advance-locked)";
  ok(t.revised().length === 1 && t.revised()[0] === "StreamManager: REVISED while this tab was loading or catching up with the room — 6 " +
    "verdicts printed on ORDER lines changed as later events arrived: " + [words(20, "$P1"), words(30, "$P2"), words(40, "$P3")].join("; ") +
    "; and 3 more. Each ORDER line is the verdict at ingest; these are the verdicts now",
    "C: THE SUMMARY NAMES THE LOWEST POSITIONS, IN ORDER, AND COUNTS THE REST — six changes found out of position order; " +
    "it names l=20, l=30 and l=40, and \"3 more\"", t.revised());
}

// ── E · A VERDICT THE FOLD WAS NOT GIVEN IS NOT A CHANGE (`ddjp_633`) ──────────────────────────────────────────────────────
function partE() {
  for (const loading of [false, true]) {
    const tag = loading ? " (while loading)" : "";
    const t = tab({ loading: loading }).feed(CHAIN_IN_ORDER);
    const printed = ["$P1", "$P2"].map((id) => t.order(id)[0] || "");
    ok(printed.every((m) => /finalAtIngest -> ACCEPTED/.test(m)), "E: PREMISE" + tag + " — l=20 and l=30 were printed ACCEPTED", printed);
    // A save point at l=30 (covering up to P2), as a sealer holding the same events made it, followed by this tab: the fold
    // now starts from its seed, and the trim does not happen (it cannot prove the floor for forgetting).
    const log = t.sb.StreamManager.getLog();
    const cut = log.findIndex((e) => e.eventId === "$P2");
    const floor = { n: 1, h: "hE", prev: null, thin: false, floorL: 30, grade: "verified", covers: "$cset..$P2",
      seed: t.sb.StateDeriver.buildSeed(log.slice(0, cut + 1), null) };
    t.sb.Floor._setTrustedForTest(floor);
    const trimmed = t.sb.StreamManager.trimToFloor();
    const legal = ["$P1", "$P2", "$P3", "$P4", "$P5"].map((id) => t.sb.StreamManager.isLegal(id));
    ok(trimmed === 0 && t.sb.StreamManager._trimState() === null && JSON.stringify(legal) === "[null,null,true,true,true]" &&
       t.sb.StreamManager.getLog().length === CHAIN_IN_ORDER.length,
      "E: PREMISE" + tag + " — the tab follows the save point and has not trimmed: l=20 and l=30 are still held, and the fold, " +
      "not given them, cannot say (null)", { trimmed, legal, held: t.sb.StreamManager.getLog().length });
    const mem = t.sb.StreamManager._revisedForTest();
    ok(t.revised().length === 0 && mem.pending === 0,
      "E: A VERDICT THE FOLD WAS NOT GIVEN IS NOT A CHANGE" + tag + " — the plays at or below the save point's cut, printed " +
      "ACCEPTED, get no REVISED line" + (loading ? " and none is owed to the summary" : ""), { revised: t.revised(), pending: mem.pending });
    if (loading) {
      t.goLive();
      ok(t.revised().length === 0, "E: AND AT GOING LIVE NO SUMMARY — nothing changed; the fold only stopped being given them", t.revised());
    } else {
      t.feed(["$X1"]);
      const tail = " (after ddjp.dj.play l=45 id=$X1 arrived) | now playing vid3xxxxxxx pi=$X1";
      ok(JSON.stringify(t.revised()) === JSON.stringify([
          "StreamManager: REVISED ddjp.dj.play l=50 id=$P4 — was ACCEPTED, now REFUSED (advance-locked)" + tail,
          "StreamManager: REVISED ddjp.dj.play l=60 id=$P5 — was ACCEPTED, now REFUSED (advance-locked)" + tail]),
        "E: AND ABOVE THE CUT A REAL CHANGE IS SAID — following the save point, a late play at l=45 takes away l=50's and l=60's " +
        "parent, and each gets its REVISED line (the fold from the seed says what it was given)", t.revised());
    }
  }
}

partA(); partB(); partC(); partCOrder(); partD(); partE();
if (failed) { console.log("[revised-verdict] " + failed + " failure(s) of " + A + " assertions"); process.exit(1); }
console.log("[revised-verdict] PASS — a verdict the ORDER line printed, later changed, is said to have changed (J71 item 1, the owner's " +
  "approval; " + A + " assertions). DRIVEN on the real StreamManager in both arrival orders, with the `ddjp_561` study's room at the owner's " +
  "positions: a late join turns l=98 ACCEPTED into REFUSED and one REVISED line names the play, both verdicts, the join and what is " +
  "playing now; a late leave turns it back. Said once per change; nothing in position order, nothing for a late arrival that moves no " +
  "printed verdict. WHILE LOADING, ONE SUMMARY at going live (the owner's choice on noise), none for a verdict that changed back, none " +
  "on a later going live; it names the lowest positions in order, and counts the rest. BOUNDED: only the verdicts ORDER printed, only for " +
  "events still held; and a verdict the fold was not given (a save point followed before the trim) is not a change. A LOG LINE ONLY: the room is the room a " +
  "tab holding everything derives, and a line that cannot be said changes nothing (the twenty-third signature). What this cannot reach: " +
  "how often a real room's arrival order revises a verdict — that is the owner's live check");
