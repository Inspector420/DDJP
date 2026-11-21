#!/usr/bin/env node
// tools/probes/probe-declined-genesis-check.js — STUDY ONLY. A probe, not a guard and not a break file (no `check-` or
// `mutate-` prefix, so neither `run-all` nor `tools/breaks-for.js` runs it). It changes nothing on disk.
//
// THE QUESTION (the owner's `?v=558` run, room "testedshare"): the bot's tab warned "this tab's fold of the room from its
// start differs from save point n=2" while the owner's tab, and every event both tabs had folded, agreed. The supervisor's
// reading, driven here rather than assumed: on the bot's opening save point n=1 was adopted before the events it covers
// arrived, so the door declined l=1 and l=2; n=1's own check could not find its boundary and never ran; n=2's could, and
// compared a fold missing l=1 and l=2 against n=2's seed.
// SINCE `ddjp_627` (the owner's option (i)) that comparison records "cannot tell" — not-yet-run / set-aside-below-floor — and
// warns nothing; the premises below expect that, and the snapshot the analysis reads is taken where the verdict is recorded.
//
// WHAT IS REAL: every backend1 module, the seam, `features/room.js` (`tests/_botroom.js`), the room story helper
// (`tests/_reopen.js`). WHAT IS A DOUBLE: the SDK client (no homeserver), as in every guard on those worlds. WHAT THIS ADDS,
// IN MEMORY ONLY: the live room's other channels (batches 2 and 3, so the bot's seal can reach checkpoints-high-staff), per-
// channel power for the bot's climb, the bot's tab paging two channels slowly, held checkpoint sends (so the order the two
// seals land in is chosen, not raced), and spies that RECORD and delegate (`setHistoryComplete`, `ingest`, `Logger.warn`).
//
// WHAT IT CANNOT EXPRESS: the live room's l=4..7 are not in the owner's paste. They are modelled as the two upgrades the room
// must have had for checkpoints-high-staff to exist (start and done, batches 2 and 3), which the owner can confirm. Room's
// rank rewire is private, so each rank step calls the part of it that reaches the backend (`MatrixBridge.wireCheckpoints`)
// and fires the bridge's own power-level listeners; Queue and Playback are doubles in this world, and the bot sent nothing in
// that window. Seals are called directly (`Checkpoint.seal`), not through the slot and the cadence tick.
"use strict";
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..", "..");
const B = require(path.join(ROOT, "tests", "_botroom.js"));

// ── THE LIVE ROOM'S CHANNELS: batch 1, plus the upgraded batches the bot's seal reached ────────────────────────────────────
Object.assign(B.FULL_CH, { checkpoints_uncategorized: "!c0:hs", events_vip: "!e40:hs", checkpoints_vip: "!c40:hs",
  events_high_staff: "!e80:hs", checkpoints_high_staff: "!c80:hs" });
Object.assign(B.SEND_LEVEL, { checkpoints_uncategorized: 0, events_vip: 40, checkpoints_vip: 40, events_high_staff: 80,
  checkpoints_high_staff: 80 });
const { room, settle } = require(path.join(ROOT, "tests", "_reopen.js"));
const CH = B.FULL_CH, MIN = 60000;

// ── WHAT RAN: the modules this probe's answers are about, by hash ──────────────────────────────────────────────────────────
const RAN = ["backends/backend1/streammanager.js", "backends/backend1/floor.js", "backends/backend1/checkpoint.js",
  "backends/backend1/matrixbridge.js", "backends/backend1/settingsproof.js", "backends/backend1/statederiver.js"]
  .map((f) => f + " " + crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, f))).digest("hex").slice(0, 16));
// The comparison's field list, read from the module rather than restated (the third signature).
const _smSrc = fs.readFileSync(path.join(ROOT, "backends/backend1/streammanager.js"), "utf8");
const _rf = /const REPRODUCE_FIELDS = (\[[^\]]*\])/.exec(_smSrc);
const REPRODUCE_FIELDS = _rf ? JSON.parse(_rf[1]) : null;

const premises = [];
function premise(cond, msg, got) { premises.push({ ok: !!cond, msg, got }); }
const canon = (x) => Array.isArray(x) ? "[" + x.map(canon).join(",") + "]"
  : (x && typeof x === "object") ? "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}" : JSON.stringify(x);
const lOf = (raw) => JSON.parse(raw.content.body).l;

// ── THE STORY. `v.order` "checkpoint-first" (the reading) or "events-first" (the control); `v.botSendFirst` the bot's own
//    seal returns before the owner's arrives; `v.shortHistory` the transport tells the bot's fold its history is short ──────
async function story(v) {
  v = v || {};
  B.LEVELS[B.BOT] = 0;                      // the bot, before its promotion
  const R = room();
  R.now = Date.UTC(2026, 9, 26, 15, 53, 4);   // 10/26 16:53:04 local (the clock only orders things)
  const post = (w, s, id) => {                // a send, as the homeserver holds it and sync hands it to every tab
    const raw = { event_id: id, type: "m.room.message", room_id: s.roomId, sender: w.me, origin_server_ts: (R.now += 500),
      content: { body: JSON.stringify(s.body) } };
    R.store(raw); R.L = Math.max(R.L, s.body.l);
    return raw;
  };
  const to = (raw, tabs) => { for (const t of tabs) t.deliver(raw); return raw; };   // rank from the channel it is on
  const gate = (w) => {                       // checkpoint sends are held until released, so the order they land in is chosen
    const g = { hold: false, held: [] }, s0 = w.client.sendMessage;
    w.client.sendMessage = async (roomId, content) => {
      const r = await s0(roomId, content);
      if (g.hold && JSON.parse(content.body).t === "ddjp.checkpoint") await new Promise((res) => g.held.push(res));
      return r;
    };
    return g;
  };

  // 10/26: THE OWNER CREATES THE ROOM and seals n=1 at floorL=2 (the cadence tick, five minutes on).
  const O1 = R.tab(B.OWNER);
  await O1.open();
  const S0 = O1.sb.StateDeriver.defaultSettings();
  const set1 = R.put(B.OWNER, { t: "ddjp.room.settings", s: S0 }, { id: "6A0kGenesisSettings" });
  const upg1 = R.put(B.OWNER, { t: "ddjp.room.upgrade.done", n: 1 }, { id: "gkJdUpgradeDone1" });
  R.now += 5 * MIN;
  const b1 = O1.sent.length;
  const r1 = await O1.sb.Checkpoint.seal();
  const s1 = O1.sent.slice(b1).find((s) => s.t === "ddjp.checkpoint");
  premise(r1 && r1.ok && s1 && s1.body.n === 1 && s1.body.floorL === lOf(upg1), "n=1 sealed by the owner at floorL=2", r1);
  const cp1 = to(post(O1, s1, "$PTK9aoxAn1"), R.tabs);
  await settle(40);
  // l=4..7: the room's two upgrades (not in the paste — see the header)
  for (const [t, n] of [["start", 2], ["done", 2], ["start", 3], ["done", 3]]) { R.now += MIN; R.put(B.OWNER, { t: "ddjp.room.upgrade." + t, n: n }); }

  // 10/27: THE OWNER'S TAB IS A NEW PAGE (25 hours on; a seal's in-page re-entrancy clock is local time and a reload clears it).
  // It opens with its events first, trims to n=1 at the opening, and its held base at 18:16 is n=1, as the owner read.
  R.now = Date.UTC(2026, 9, 27, 17, 14, 0);
  O1.sb.MatrixBridge.persistHistoryNow();
  const O = R.tab(B.OWNER, { detached: true, stored: O1.stored.snap, w: { opened: false, cache: O1.sb.EventCache.values() } });
  const so0 = O.client.scrollback;
  O.client.scrollback = async (rm, n) => { if (rm.roomId === CH.checkpoints_owner) await settle(30); return so0(rm, n); };
  await O.open();
  R.tabs.splice(R.tabs.indexOf(O1), 1, O);
  premise(O.sb.StreamManager._trimState() === lOf(upg1) && (O.sb.Floor.current() || {}).n === 1,
    "the owner's tab stands on n=1 and has trimmed to it (its held base at 18:16 was n=1)",
    { trim: O.sb.StreamManager._trimState(), floor: (O.sb.Floor.current() || {}).n });

  // 10/27 18:15:34: THE BOT'S TAB OPENS, at rank 0.
  R.now = Date.UTC(2026, 9, 27, 17, 15, 34);
  const Bt = R.tab(B.BOT, { detached: true, w: { opened: false } });
  const hc = [], trace = [], warns = [], tells = [];
  const shc = Bt.sb.StreamManager.setHistoryComplete;
  Bt.sb.StreamManager.setHistoryComplete = (x) => { hc.push(x); return shc(x); };
  // What the check READ: the log and the floor when a fold from a save point's seed runs (the check is one), taken inside the ingest —
  // after it returns, a trim at the same save point has already shortened the log.
  let atFold = null;
  const der = Bt.sb.StateDeriver.derive;
  Bt.sb.StateDeriver.derive = function (evts, seed) {
    if (seed && !tells.length) { const f = Bt.sb.Floor.current(); atFold = { log: Bt.sb.StreamManager.getLog().slice(), trim: Bt.sb.StreamManager._trimState(),
      floor: f ? { n: f.n, by: f.by, h: f.h, grade: f.grade, covers: f.covers, floorL: f.floorL, seed: f.seed } : null }; }
    return der.apply(this, arguments);
  };
  const ing = Bt.sb.StreamManager.ingest;
  Bt.sb.StreamManager.ingest = (raw) => {
    const out = ing(raw);
    const f = Bt.sb.Floor.current();
    const sv = Bt.sb.StreamManager.seedValidation();
    trace.push({ id: raw && raw.event_id, l: raw && raw.l, floor: f ? f.n : null, sv: sv });
    if (sv.reason === "set-aside-below-floor" && !tells.length) {   // where `ddjp_627` records "cannot tell": the same snapshot the warning took
      tells.push({ line: null, at: raw && raw.event_id, floor: atFold && atFold.floor, log: atFold ? atFold.log : [], trim: atFold && atFold.trim,
        sv: sv, disagrees: Bt.sb.StreamManager.disagreesWithFloor(), whole: Bt.sb.StreamManager.holdsWholeRoom(),
        maySeal: Bt.sb.Checkpoint.maySeal(Date.now()), hc: hc.slice() });
    }
    return out;
  };
  const w0 = Bt.sb.Logger.warn;
  Bt.sb.Logger.warn = (m) => {
    if (/differs from save point/.test(String(m))) {
      const f = Bt.sb.Floor.current();
      warns.push({ line: String(m), floor: f ? { n: f.n, by: f.by, h: f.h, grade: f.grade, covers: f.covers, floorL: f.floorL, seed: f.seed } : null,
        log: Bt.sb.StreamManager.getLog().slice(), sv: Bt.sb.StreamManager.seedValidation(),
        disagrees: Bt.sb.StreamManager.disagreesWithFloor(), whole: Bt.sb.StreamManager.holdsWholeRoom(),
        maySeal: Bt.sb.Checkpoint.maySeal(Date.now()), trim: Bt.sb.StreamManager._trimState(), hc: hc.slice() });
    }
    return w0(m);
  };
  const slowCh = v.order === "events-first" ? [CH.checkpoints_owner] : [CH.events_owner, CH.settings_owner];
  const sb0 = Bt.client.scrollback;
  Bt.client.scrollback = async (rm, n) => { if (slowCh.indexOf(rm.roomId) >= 0) await settle(30); return sb0(rm, n); };
  const opened = await Bt.open();
  R.tabs.push(Bt);
  const atOpen = { log: Bt.sb.StreamManager.getLog().map((e) => e.l + ":" + e.eventId), floor: (Bt.sb.Floor.current() || {}).n,
    trim: Bt.sb.StreamManager._trimState(), ignored: Bt.sb.StreamManager.ignoredArrivals(), sv: Bt.sb.StreamManager.seedValidation(),
    whole: Bt.sb.StreamManager.holdsWholeRoom(), licensed: Bt.sb.StreamManager.forgettingLicensed(),
    canProve: Bt.sb.StreamManager.canProve(Bt.sb.Floor.current()),
    earns: Bt.sb.TrustPolicy.earnsForget((Bt.sb.Floor.current() || {}).grade), grade: (Bt.sb.Floor.current() || {}).grade,
    settingsLicence: Bt.sb.SettingsProof.licensesForget(), settingsVerdict: Bt.sb.SettingsProof.verdict(),
    cache: { [set1.event_id]: !!Bt.sb.EventCache.get(set1.event_id), [upg1.event_id]: !!Bt.sb.EventCache.get(upg1.event_id) },
    hc: hc.slice(), lines: Bt.logs.slice(), setAside: Bt.sb.StreamManager.setAside() };

  // 18:16:38–48: THE BOT CLIMBS 0 -> 40 -> 80 -> 99. The checkpoints-owner channel's power reaches it last, so at 99 its seal
  // still goes to checkpoints-high-staff (the owner's note at 18:16:50.348).
  const cpOwnerRoom = Bt.rooms[CH.checkpoints_owner], cpGet = cpOwnerRoom.currentState.getStateEvents;
  let cpOwnerLevel = 0;
  cpOwnerRoom.currentState.getStateEvents = (t, k) => {
    if (t !== "m.room.power_levels") return cpGet(t, k);
    return { getContent: () => ({ users: Object.assign({}, B.LEVELS, { [B.BOT]: cpOwnerLevel }), users_default: 0, events: { "m.room.message": 99 }, events_default: 99 }) };
  };
  const climb = [];
  for (const lvl of [40, 80, 99]) {
    R.now += 3000;
    B.LEVELS[B.BOT] = lvl; cpOwnerLevel = Math.min(lvl, 80);
    Bt.sb.MatrixBridge._onStateEventForTest({ getType: () => "m.room.power_levels", getRoomId: () => CH.events_owner });
    Bt.sb.MatrixBridge.wireCheckpoints(CH);
    climb.push({ level: lvl, rank: Bt.sb.MatrixBridge.getMyRank(CH), events: Bt.sb.MatrixBridge.getWriteChannelId(CH),
      checkpoints: Bt.sb.MatrixBridge.getCheckpointChannelId(CH) });
  }

  // 18:16:48–49: THE JOINS AT l=8 AND l=9, AND THE OWNER'S PLAY AT l=10.
  const j8 = R.put(B.OWNER, { t: "ddjp.dj.join", v: "IUPuEGlHI3Q" }, { id: "w5l4Join" });
  const j9 = R.put(B.OWNER, { t: "ddjp.dj.join", v: "Qq1Qq1Qq1Qq" }, { id: "1osmJoin" });
  const p10 = R.put(B.OWNER, { t: "ddjp.dj.play", p: null }, { id: "8NMePlay" });
  await settle(20);

  // CONTROL B's one change: the fold is told its history is short just before the save point arrives (the bridge tells it
  // again after every song change, so told earlier it would not survive the play).
  if (v.shortHistory) Bt.sb.StreamManager.setHistoryComplete(false);
  // CONTROL D's one change, IN MEMORY: the settings proof withholds the licence, so n=2 cannot be forgotten under and no trim
  // follows — the "save point that cannot prove" case.
  if (v.noTrim) Bt.sb.SettingsProof.licensesForget = () => false;
  const hcBeforeSeal = hc.slice();
  // 18:16:50: BOTH SEAL n=2 AT floorL=10. The sends are held; the owner's lands first at both tabs.
  const gO = gate(O), gB = gate(Bt);
  gO.hold = gB.hold = true;
  const oAt = O.logs.length, bAt = Bt.logs.length, ob = O.sent.length, bb = Bt.sent.length;
  const pO = O.sb.Checkpoint.seal(), pB = Bt.sb.Checkpoint.seal();
  await settle(10);
  const sO = O.sent.slice(ob).find((s) => s.t === "ddjp.checkpoint"), sB = Bt.sent.slice(bb).find((s) => s.t === "ddjp.checkpoint");
  if (!sO || !sB) {   // a seal that did not send makes everything after it void: say which, and why, and stop
    const why = async (w, p, s) => s ? "sent" : JSON.stringify(await Promise.race([p, settle(50).then(() => "pending")]));
    throw new Error("a seal did not send — owner: " + await why(O, pO, sO) + "; bot: " + await why(Bt, pB, sB) +
      "; the bot's log since: " + JSON.stringify(Bt.logs.slice(bAt).slice(-8)));
  }
  premise(sO && sB && sO.body.n === 2 && sB.body.n === 2 && sO.body.floorL === lOf(p10) && sB.body.floorL === lOf(p10),
    "both tabs seal n=2 at floorL=10", { owner: sO && { n: sO.body.n, floorL: sO.body.floorL }, bot: sB && { n: sB.body.n, floorL: sB.body.floorL } });
  premise(sO && sO.roomId === CH.checkpoints_owner && sB && sB.roomId === CH.checkpoints_high_staff,
    "the owner's seal goes to checkpoints-owner, the bot's to checkpoints-high-staff", { owner: sO && sO.roomId, bot: sB && sB.roomId });
  let jl = null, fo = null, ingestJlAt = null;
  const rel = async (g, p) => { g.hold = false; for (const f of g.held.splice(0)) f(); await p; await settle(10); };
  await rel(gO, pO);                                   // the owner's send returns: it adopts its own and trims (50.921/50.926)
  const ownerTrimBefore = O.said(/trimmed to floor/, oAt);
  if (v.botSendFirst) { await rel(gB, pB); }
  const svBeforeJl = Bt.sb.StreamManager.seedValidation();   // the verdict before the owner's n=2 reaches the bot (CONTROL C)
  jl = post(O, sO, "$jlPVownerN2");                    // the owner's save point: at the bot first (51.003), then the owner (51.020)
  ingestJlAt = Bt.logs.length;
  to(jl, [Bt]); await settle(10); to(jl, [O]); await settle(10);
  if (!v.botSendFirst) { await rel(gB, pB); }          // the bot's own send returns after it
  fo = post(Bt, sB, "$Fod0botN2");                     // and the bot's save point reaches both (the owner at 51.349)
  to(fo, [O, Bt]); await settle(20);

  // CONTROL D: a later act in a quiet room — does the tab sit in "my-view-disagrees"?
  let later = null;
  if (v.noTrim) {
    R.now += 25 * MIN;                                   // past the room's seal cooldown, with something countable
    R.put(B.OWNER, { t: "ddjp.dj.join", v: "Zz2Zz2Zz2Zz" }, { id: "joinLater" });
    await settle(20);
    const m = Bt.sb.Checkpoint.maySeal(Date.now());
    later = { trim: Bt.sb.StreamManager._trimState(), sv: Bt.sb.StreamManager.seedValidation(), disagrees: Bt.sb.StreamManager.disagreesWithFloor(),
      maySeal: { ok: m.ok, reason: m.reason } };
  }
  return { R, O, Bt, v, set1, upg1, cp1, j8, j9, p10, sO, sB, jl, fo, hc, trace, warns, tells, svBeforeJl, atOpen, climb, opened, oAt, bAt,
    ownerTrimBefore, ingestJlAt, hcBeforeSeal, later };
}

function seedDiff(a, b) {
  const out = [];
  for (const k of Array.from(new Set(Object.keys(a || {}).concat(Object.keys(b || {})))).sort()) {
    if (canon(a[k]) !== canon(b[k])) out.push({ k, owner: a[k], bot: b[k] });
  }
  return out;
}

async function main() {
  const say = (s) => console.log(s);
  say("probe-declined-genesis-check — what ran: " + RAN.join("; "));
  say("REPRODUCE_FIELDS, read from streammanager.js: " + JSON.stringify(REPRODUCE_FIELDS));
  premise(Array.isArray(REPRODUCE_FIELDS) && REPRODUCE_FIELDS.length > 0, "the comparison's field list is read from the module");

  // ── THE READING: n=1 reaches the bot's tab before the events it covers ──────────────────────────────────────────────────
  const M = await story({ order: "checkpoint-first" });
  const { Bt, O, set1, upg1, p10 } = M;
  premise(M.trace.some((t) => t.id === M.cp1.event_id) && M.trace.some((t) => t.id === set1.event_id) && M.trace.some((t) => t.id === upg1.event_id),
    "POSITIVE CONTROL — the ingest spy sees n=1 and l=1, l=2 arrive (so an absence below is a fact, not a blind spot)", M.trace.map((t) => t.id));
  const iN1 = M.trace.findIndex((t) => t.id === M.cp1.event_id), iS = M.trace.findIndex((t) => t.id === set1.event_id), iU = M.trace.findIndex((t) => t.id === upg1.event_id);
  premise(iN1 >= 0 && iN1 < iS && iN1 < iU, "the order the reading names: n=1 is ingested before l=1 and l=2", { n1: iN1, l1: iS, l2: iU });
  premise(M.climb.map((c) => c.rank).join() === "40,80,99" && M.climb[2].checkpoints === CH.checkpoints_high_staff,
    "the bot climbs 0 -> 40 -> 80 -> 99, and at 99 its checkpoints still go to checkpoints-high-staff", M.climb);

  say("");
  say("── 1. n=1's genesis check on the bot's tab: PASS or NEVER RUN ──");
  const whileN1 = M.trace.filter((t) => t.floor === 1);
  const statuses = Array.from(new Set(whileN1.map((t) => t.sv.status + "/" + t.sv.reason)));
  say("  seedValidation() after each of the " + whileN1.length + " ingests while n=1 was the floor: " + JSON.stringify(statuses));
  say("  'validated' ever recorded for n=1: " + whileN1.some((t) => t.sv.status === "validated"));
  say("  at the end of the opening: " + JSON.stringify(M.atOpen.sv));

  say("");
  say("── 2. did the bot's derived log hold l=1 and l=2; _historyComplete; why the short-history branch did not fold from the floor ──");
  say("  held log at the end of the opening (l:id): " + JSON.stringify(M.atOpen.log));
  say("  ignoredArrivals(): " + JSON.stringify(M.atOpen.ignored));
  say("  the door's lines for them: " + JSON.stringify(M.atOpen.lines.filter((m) => /already banked below/.test(m)).map((m) => m.slice(0, 200))));
  say("  setHistoryComplete was told, in order: " + JSON.stringify(M.atOpen.hc) + "  (the last value is _historyComplete; none = null)");
  say("  the bridge's coverage lines: " + JSON.stringify(M.atOpen.lines.filter((m) => /HISTORY .* songs|history already reaches|history backfill/.test(m)).map((m) => m.slice(0, 220))));
  say("  holdsWholeRoom(): " + M.atOpen.whole + "; setAside(): " + JSON.stringify(M.atOpen.setAside));
  say("  setHistoryComplete was told by the time the save point arrived: " + JSON.stringify(M.hcBeforeSeal) + "; at the warning: " +
    JSON.stringify(M.warns[0] && M.warns[0].hc) + "; over the whole run: " + JSON.stringify(M.hc));
  say("  the lines that preceded each telling: " + JSON.stringify(Bt.logs.filter((m) => /MatrixBridge: HISTORY \d+ songs/.test(m)).map((m) => m.slice(0, 200))));

  say("");
  say("── 3. which field differed at the n=2 check, and which save point it compared against ──");
  premise(M.warns.length === 0 && M.tells.length === 1, "the bot's tab records \"cannot tell\" at n=2 (not-yet-run / set-aside-below-floor) " +
    "and warns nothing — `ddjp_627`; at `ddjp_626` it warned \"differs from save point n=2\"", { warns: M.warns.map((w) => w.line), tells: M.tells.length });
  const W = M.tells[0] || {};
  say("  the verdict: " + JSON.stringify(W.sv) + "; warnings: " + M.warns.length);
  say("  recorded at the ingest of the owner's n=2: " + (W.at === M.jl.event_id));
  if (W.floor) {
    say("  Floor.current() at that moment: n=" + W.floor.n + " by " + W.floor.by + " grade " + W.floor.grade + " covers " + W.floor.covers +
      " — the owner's: " + (W.floor.h === M.sO.body.h) + ", the bot's own: " + (W.floor.h === M.sB.body.h));
    // The check, recomputed with the real reducer on the log it read: genesis over the held log, seeded over what follows the boundary.
    const SD = Bt.sb.StateDeriver, ord = W.log.slice();
    const bid = W.floor.covers.split("..")[1], idx = ord.findIndex((e) => e.eventId === bid);
    const genesis = SD.derive(ord), seeded = SD.derive(ord.slice(idx + 1), W.floor.seed);
    const field = (st, k) => { if (k !== "counts") return st[k] === undefined ? null : st[k]; const pi = st.nowPlaying && st.nowPlaying.pi; return pi && st.counts && st.counts[pi] ? st.counts[pi] : null; };
    const diffs = (REPRODUCE_FIELDS || []).filter((k) => canon(field(genesis, k)) !== canon(field(seeded, k)));
    say("  the log it read (l:id): " + JSON.stringify(ord.map((e) => e.l + ":" + e.eventId)));
    say("  REPRODUCE_FIELDS that differ, in the check's order: " + JSON.stringify(diffs));
    for (const k of diffs) {
      const g = field(genesis, k), s = field(seeded, k);
      const sub = (g && s && typeof g === "object" && typeof s === "object")
        ? Object.keys(Object.assign({}, g, s)).filter((x) => canon(g[x]) !== canon(s[x])).map((x) => x + ": from the start " + JSON.stringify(g[x]) + " | from n=2's seed " + JSON.stringify(s[x]))
        : ["from the start " + JSON.stringify(g) + " | from n=2's seed " + JSON.stringify(s)];
      say("    " + k + " — " + sub.join("; "));
    }
    say("  settings, from the start vs the seed: equal = " + (canon(genesis.settings) === canon(seeded.settings)));
    premise(diffs.length > 0, "the recomputed check differs too (it is the same comparison)", diffs);
  }

  say("");
  say("── 4. why the bot's tab never trimmed to n=1 ──");
  say("  while n=1 was the floor: grade " + M.atOpen.grade + ", earnsForget " + M.atOpen.earns + ", settings proof licenses " + M.atOpen.settingsLicence +
    " (" + JSON.stringify(M.atOpen.settingsVerdict && M.atOpen.settingsVerdict.status) + ")" +
    ", n=1's boundary " + M.upg1.event_id + " held in the derived log: " + M.atOpen.log.some((x) => x.endsWith(M.upg1.event_id)) +
    ", forgettingLicensed() " + M.atOpen.licensed + ", canProve(n=1) " + JSON.stringify(M.atOpen.canProve));
  say("  lines naming n=1 on the bot's tab: " + JSON.stringify(Bt.logs.filter((m) => /move-on check — floor n=1|trimmed to floor l=2|differs from save point n=1/.test(m))));
  say("  the settings read-back line: " + JSON.stringify(Bt.logs.filter((m) => /settings read-back/.test(m)).map((m) => m.slice(0, 160))));

  say("");
  say("── 5. the owner's and the bot's n=2 seeds, field by field ──");
  const d = seedDiff(M.sO.body.seed, M.sB.body.seed);
  say("  seed fields that differ: " + (d.length ? JSON.stringify(d) : "none — the two seeds are equal"));
  say("  the envelopes: " + ["n", "prev", "floorL", "covers", "thin", "by", "h"].map((k) => k + " " + (canon(M.sO.body[k]) === canon(M.sB.body[k]) ? "same" : "owner " + JSON.stringify(M.sO.body[k]) + " / bot " + JSON.stringify(M.sB.body[k]))).join("; "));

  say("");
  say("── 6. the trim counts ──");
  say("  owner: " + JSON.stringify(M.ownerTrimBefore) + " — before its own n=2 reached it: " + (M.ownerTrimBefore.length === 1));
  say("  owner's move-on line: " + JSON.stringify(O.said(/move-on check — floor n=2/, M.oAt)));
  const bTrim = Bt.said(/trimmed to floor l=10/, M.bAt);
  say("  bot: " + JSON.stringify(bTrim) + "; its held log just before (l:id): " + JSON.stringify((W.log || []).map((e) => e.l + ":" + e.eventId)));
  say("  above the cut on the bot when it trimmed: " + JSON.stringify((W.log || []).filter((e) => e.l > 10).map((e) => e.l + ":" + e.eventId)) +
    "; proofKept() after: owner " + JSON.stringify(O.sb.StreamManager.proofKept()) + ", bot " + JSON.stringify(Bt.sb.StreamManager.proofKept()));

  say("");
  say("── 7. what \"cannot tell\" costs, and the door's 'held' ──");
  say("  at the verdict: disagreesWithFloor() " + W.disagrees + ", holdsWholeRoom() " + W.whole + ", maySeal " + JSON.stringify(W.maySeal && { ok: W.maySeal.ok, reason: W.maySeal.reason }));
  say("  after the trim: disagreesWithFloor() " + Bt.sb.StreamManager.disagreesWithFloor() + ", seedValidation " + JSON.stringify(Bt.sb.StreamManager.seedValidation()) +
    ", maySeal " + JSON.stringify((() => { const m = Bt.sb.Checkpoint.maySeal(Date.now()); return { ok: m.ok, reason: m.reason }; })()));
  say("  l=1 and l=2 in the raw cache when the door declined them: " + JSON.stringify(M.atOpen.cache) +
    "; after the n=2 trim: " + JSON.stringify({ [set1.event_id]: !!Bt.sb.EventCache.get(set1.event_id), [upg1.event_id]: !!Bt.sb.EventCache.get(upg1.event_id) }));

  // ── CONTROLS ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  say("");
  say("── CONTROL A — the events reach the bot's tab before n=1 (the other arrival order) ──");
  const A = await story({ order: "events-first" });
  say("  at the opening: floor n=" + A.atOpen.floor + ", trimmed to " + A.atOpen.trim + ", ignoredArrivals " + JSON.stringify(A.atOpen.ignored));
  say("  lines naming n=1: " + JSON.stringify(A.Bt.logs.filter((m) => /move-on check — floor n=1|trimmed to floor l=2|differs from save point n=1/.test(m))));
  say("  at n=2: genesis warnings " + A.warns.length + "; move-on line " + JSON.stringify(A.Bt.said(/move-on check — floor n=2/, A.bAt)) + "; trim " + JSON.stringify(A.Bt.said(/trimmed to floor l=10/, A.bAt)));
  premise(A.atOpen.trim === 2 && A.warns.length === 0, "CONTROL A — with the events first the bot's tab trims to n=1 at the opening and does not warn at n=2", { trim: A.atOpen.trim, warns: A.warns.length });

  say("");
  say("── CONTROL B — the transport tells the bot's fold that its history is short (setHistoryComplete(false)) ──");
  const Bc = await story({ order: "checkpoint-first", shortHistory: true });
  say("  genesis warnings at n=2: " + Bc.warns.length + "; trim " + JSON.stringify(Bc.Bt.said(/trimmed to floor l=10/, Bc.bAt)) +
    "; seedValidation " + JSON.stringify(Bc.Bt.sb.StreamManager.seedValidation()));
  premise(Bc.warns.length === 0, "CONTROL B — the short-history branch, when told, folds from the floor and the check does not run", Bc.warns.length);

  say("");
  say("── CONTROL C — the bot's own seal returns before the owner's arrives ──");
  const Cc = await story({ order: "checkpoint-first", botSendFirst: true });
  const cw = Cc.warns[0];
  const ct = Cc.tells[0];
  say("  warnings: " + Cc.warns.length + (cw ? "; compared against " + (cw.floor.h === Cc.sB.body.h ? "the bot's own n=2" : cw.floor.h === Cc.sO.body.h ? "the owner's n=2" : "?") : "") +
    "; \"cannot tell\" recorded: " + Cc.tells.length + (ct ? " — against " + (ct.floor.h === Cc.sB.body.h ? "the bot's own n=2" : ct.floor.h === Cc.sO.body.h ? "the owner's n=2" : "?") : "") +
    "; the verdict before the owner's n=2 reached the bot: " + JSON.stringify(Cc.svBeforeJl && { status: Cc.svBeforeJl.status, reason: Cc.svBeforeJl.reason }));

  say("");
  say("── CONTROL D — n=2 cannot be forgotten under (the settings proof withholds the licence, in memory), and the room goes quiet ──");
  const Dd = await story({ order: "checkpoint-first", noTrim: true });
  say("  genesis warnings at n=2: " + Dd.warns.length + "; \"cannot tell\" recorded: " + Dd.tells.length + "; trims at n=2: " + Dd.Bt.said(/trimmed to floor l=10/, Dd.bAt).length +
    "; after a later join, past the cooldown: " + JSON.stringify(Dd.later));
  premise(Dd.warns.length === 0 && Dd.tells.length === 1 && Dd.Bt.said(/trimmed to floor l=10/, Dd.bAt).length === 0,
    "CONTROL D PREMISE — the same verdict (\"cannot tell\", no warning), and no trim follows it",
    { warns: Dd.warns.length, tells: Dd.tells.length, trims: Dd.Bt.said(/trimmed to floor l=10/, Dd.bAt) });

  say("");
  const bad = premises.filter((p) => !p.ok);
  for (const p of premises) say("  premise " + (p.ok ? "ok  " : "FAIL") + " — " + p.msg + (p.ok ? "" : "  got " + JSON.stringify(p.got)));
  if (bad.length) { say("probe-declined-genesis-check: VOID — " + bad.length + " premise(s) failed; nothing above is a finding"); process.exit(1); }
  say("probe-declined-genesis-check: done — " + premises.length + " premises held");
  process.exit(0);
}
main().catch((e) => { console.log("probe-declined-genesis-check: VOID — threw: " + (e && e.stack || e)); process.exit(1); });
