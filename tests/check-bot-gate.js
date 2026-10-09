// tests/check-bot-gate.js
// SUBJECT: backends/backend2/authority.js, backends/backend2/runner.js
// WALL: THE BOT'S SECURITY GATE (J76, owner ruling 2). Strict order, always; the gate opens at most every gate.intervalMs;
//   whatever is due goes out at the next opening, together and in order; nothing due, nothing sent; "urgent" means sooner,
//   never ahead; bypass is off; every act meets the per-person limit; one table holds every value, validated and read.
//   PART A — strict order across the heartbeat and a seal.      PART B — urgent: sooner, never ahead.
//   PART C — openings at least gate.intervalMs apart; an empty opening does not count.
//   PART D — the per-person limit applies to urgent acts too, in silence.
//   PART E — merges never reorder: latest-per-actor and once-per-actor-target.
//   PART F — bypass off sends nothing early; on, an urgent act opens early but takes everything ahead.
//   PART G — each POLICY value is read.       PART H — validatePolicy refuses nonsense.
//   PART I — a queued act learns the id it really got: the carrier's, or carrier#k.
//   PART J — MEASURED: what the gate adds to a song change, a visible tab and a hidden one (timers once a minute) — and a
//            due song change goes at its first trigger whenever gate.intervalMs has passed since the last send.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-gate] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[bot-gate] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
  "backends/backend2/streammanager.js", "backends/backend2/authority.js"];
const world = () => { const sb = loadInContext(FILES, {}); const w = { t: 1000000, out: [], n: 0 };
  sb.B2Authority.reset();
  sb.B2Authority.attach((type, payload) => { const id = "$m" + (++w.n); w.out.push({ type, payload, id, at: w.t }); return Promise.resolve({ eventId: id }); }, { now: () => w.t });
  w.A = sb.B2Authority; return w; };
const act = (A, t, who, extra) => A.stamp(Object.assign({ t: t }, extra || {}), who, 10, "$src-" + who + "-" + t + "-" + Math.random().toString(36).slice(2, 7), null);
const flat = (out) => [].concat(...out.map((m) => m.type === "ddjp.batch" ? m.payload.evs.map((e) => e.t) : [m.type]));
const tick = () => new Promise((r) => setImmediate(r));
(async () => {
  // ── A — strict order across the heartbeat and a seal ──
  {
    const w = world(), A = w.A;
    A.submit(act(A, "ddjp.dj.join", "@a:hs", { v: "aaaaaaaaaaa" }));
    A.submitRaw("ddjp.bot.here", {});
    A.submit(act(A, "ddjp.dj.vote", "@b:hs", { p: "$x" }));
    A.submitRaw("ddjp.checkpoint", { n: 1 });
    A.submit(act(A, "ddjp.dj.skip", "@c:hs", { p: "$x" }));
    for (let g = 0; g < 10 && A.pending(); g++) { w.t += 500; A.openIfDue(); }
    ok(JSON.stringify(flat(w.out)) === JSON.stringify(["ddjp.dj.join", "ddjp.bot.here", "ddjp.dj.vote", "ddjp.checkpoint", "ddjp.dj.skip"]),
      "A: everything — relays, the heartbeat and the seal — leaves in the order the bot accepted it", flat(w.out));
    ok(w.out.every((m, i) => i === 0 || m.at - w.out[i - 1].at >= A.POLICY.gate.intervalMs), "A: and one message an opening, openings at least the interval apart", w.out.map((m) => m.at));
  }
  // ── B — urgent: sooner, never ahead ──
  {
    const w = world(), A = w.A;
    A.submit(act(A, "ddjp.dj.join", "@a:hs", { v: "aaaaaaaaaaa" }));          // grouped: not due for its window
    A.submit(act(A, "ddjp.dj.skip", "@b:hs", { p: "$x" }));                   // urgent
    ok(w.out.length === 0, "B: submitting sends nothing — only openings send", w.out.length);
    A.openIfDue();
    ok(w.out.length === 1 && JSON.stringify(flat(w.out)) === JSON.stringify(["ddjp.dj.join", "ddjp.dj.skip"]),
      "B: at the next opening the urgent act goes WITHOUT the group's wait, taking the act ahead of it along, in order", flat(w.out));
  }
  // ── C — spacing; an empty opening does not count ──
  {
    const w = world(), A = w.A;
    A.openIfDue();                                                              // empty
    A.submit(act(A, "ddjp.dj.skip", "@a:hs", { p: "$x" })); A.openIfDue();
    ok(w.out.length === 1, "C: an empty opening does not hold the next act back — it goes at its first trigger", w.out.length);
    w.t += 300; A.submit(act(A, "ddjp.dj.skip", "@b:hs", { p: "$x" })); A.openIfDue();
    ok(w.out.length === 1, "C: within the interval of the last send, nothing more goes", w.out.length);
    w.t += 200; A.openIfDue();
    ok(w.out.length === 2, "C: at the interval, it goes", w.out.length);
  }
  // ── D — the per-person limit applies to urgent acts too, in silence ──
  {
    const w = world(), A = w.A; let fast = 0;
    for (let i = 0; i < A.POLICY.perActor.acts + 3; i++) { const r = A.submit(act(A, "ddjp.dj.skip", "@one:hs", { p: "$x" + i })); if (r && r.tooFast) fast++; }
    ok(fast === 3 && A.pending() === A.POLICY.perActor.acts, "D: urgent acts meet the per-person limit; those over it are dropped", { fast, pending: A.pending() });
    ok(!w.out.length && !JSON.stringify(A.pending()).includes("refused"), "D: and in silence — no refusal is queued for them (Q1)");
  }
  // ── E — merges never reorder ──
  {
    const w = world(), A = w.A;
    A.submit(act(A, "ddjp.dj.order", "@a:hs", { order: [1, 2] }));
    A.submit(act(A, "ddjp.dj.declare", "@b:hs", { v: "bbbbbbbbbbb" }));
    A.submit(act(A, "ddjp.dj.order", "@a:hs", { order: [2, 1] }));
    A.flush();
    const evs = [].concat(...w.out.map((m) => m.payload.evs || [m.payload]));
    ok(JSON.stringify(evs.map((e) => e.t)) === JSON.stringify(["ddjp.dj.declare", "ddjp.dj.order"]) && JSON.stringify(evs[1].order) === "[2,1]",
      "E: latest-per-actor drops the earlier order and keeps the new one in ITS place — after the declare accepted between", evs.map((e) => e.t));
    const w2 = world(), A2 = w2.A;
    A2.submit(act(A2, "ddjp.dj.vote", "@v:hs", { p: "$s", dv: 1 }));
    A2.submit(act(A2, "ddjp.dj.join", "@j:hs", { v: "jjjjjjjjjjj" }));
    const dup = A2.submit(act(A2, "ddjp.dj.vote", "@v:hs", { p: "$s", dv: 1 }));
    A2.flush();
    const e2 = [].concat(...w2.out.map((m) => m.payload.evs || [m.payload]));
    ok(dup.merged === true && JSON.stringify(e2.map((e) => e.t)) === JSON.stringify(["ddjp.dj.vote", "ddjp.dj.join"]),
      "E: once-per-actor-target keeps the first and drops the duplicate", e2.map((e) => e.t));
  }
  // ── F — bypass ──
  {
    const w = world(), A = w.A;
    A.submit(act(A, "ddjp.dj.join", "@a:hs", { v: "aaaaaaaaaaa" })); A.submit(act(A, "ddjp.dj.skip", "@b:hs", { p: "$x" }));
    ok(A.POLICY.gate.bypass === false && w.out.length === 0, "F: bypass ships off — an urgent act does not open the gate early", w.out.length);
    const w2 = world(), A2 = w2.A; A2.POLICY.gate.bypass = true;
    A2.submit(act(A2, "ddjp.dj.join", "@a:hs", { v: "aaaaaaaaaaa" })); A2.submit(act(A2, "ddjp.dj.skip", "@b:hs", { p: "$x" }));
    ok(w2.out.length === 1 && JSON.stringify(flat(w2.out)) === JSON.stringify(["ddjp.dj.join", "ddjp.dj.skip"]), "F: on, an urgent act opens it early — and still takes everything ahead, in order", flat(w2.out));
    A2.POLICY.gate.bypass = false;
  }
  // ── G — each value is read ──
  {
    const w = world(), A = w.A, P = A.POLICY;
    const keep = JSON.parse(JSON.stringify({ g: P.gate, m: P.maxPerMessage, a: P.perActor }));
    P.gate.messagesPerOpening = 2; P.maxPerMessage = 2;
    for (let i = 0; i < 4; i++) A.submit(act(A, "ddjp.dj.join", "@u" + i + ":hs", { v: "u" + i + "uuuuuuuuuu".slice(0, 9) }));
    w.t += 2000; A.openIfDue();
    ok(w.out.length === 2 && w.out.every((m) => m.payload.evs.length === 2), "G: gate.messagesPerOpening and maxPerMessage are read — two messages of two", w.out.map((m) => m.payload.evs.length));
    P.gate.intervalMs = 1000; A.submit(act(A, "ddjp.dj.skip", "@s:hs", { p: "$x" })); w.t += 600; A.openIfDue();
    ok(w.out.length === 2, "G: gate.intervalMs is read — 600 ms after a send is inside a 1,000 ms interval", w.out.length);
    w.t += 400; A.openIfDue();
    ok(w.out.length === 3, "G: and at 1,000 ms it opens", w.out.length);
    P.perActor.acts = 1; A.submit(act(A, "ddjp.dj.skip", "@p:hs", { p: "$1" }));
    ok(A.submit(act(A, "ddjp.dj.skip", "@p:hs", { p: "$2" })).tooFast === true, "G: perActor is read");
    P.types["ddjp.dj.skip"].lane = "grouped"; P.types["ddjp.dj.skip"].waitMs = 1000;
    ok(A.isUrgent("ddjp.dj.skip") === false || A.URGENT.indexOf("ddjp.dj.skip") >= 0, "G: the urgent list is the table's lanes", A.URGENT);
    P.types["ddjp.dj.skip"].lane = "instant"; delete P.types["ddjp.dj.skip"].waitMs;
    Object.assign(P.gate, keep.g); P.maxPerMessage = keep.m; Object.assign(P.perActor, keep.a);
    const RUN = fs.readFileSync(path.join(__dirname, "..", "backends/backend2/runner.js"), "utf8").replace(/\/\/[^\n]*/g, "");
    ok(/_gate = setInterval\(function \(\) \{\s*_openSoon\(\);\s*\}, B2Authority\.POLICY\.gate\.intervalMs\);/.test(RUN),
      "G: the runner's gate timer reads POLICY.gate.intervalMs and asks the gate — no copy of the interval");
    ok(!/MatrixBridge\.sendEvent\(/.test(RUN.replace(/function _write[\s\S]*?\n  \}\n/, "")) && (RUN.match(/_write\(/g) || []).length === 2,
      "G: and the runner writes to events_owner only through the gate — `_write` is the authority's sender and nothing else calls it", (RUN.match(/_write\(/g) || []).length);
  }
  // ── H — validatePolicy refuses nonsense ──
  {
    const w = world(), P = w.A.POLICY, SHIPPED_MAX = P.maxPerMessage;
    ok(w.A.validatePolicy().length === 0, "H PREMISE — the shipped table is valid", w.A.validatePolicy());
    for (const [label, set, undo, pat] of [
      ["an interval of 0", () => { P.gate.intervalMs = 0; }, () => { P.gate.intervalMs = 500; }, /gate\.intervalMs/],
      ["no messages an opening", () => { P.gate.messagesPerOpening = 0; }, () => { P.gate.messagesPerOpening = 1; }, /messagesPerOpening/],
      ["a bypass that is not a boolean", () => { P.gate.bypass = "yes"; }, () => { P.gate.bypass = false; }, /gate\.bypass/],
      ["more bypasses than messages", () => { P.gate.bypassPerOpening = 5; }, () => { P.gate.bypassPerOpening = 1; }, /bypassPerOpening/],
      // CHANGED BY J77 (reader half): readers now sort batches of up to 20, so 11 is valid; 21 is the nonsense value.
      ["21 a message", () => { P.maxPerMessage = 21; }, () => { P.maxPerMessage = SHIPPED_MAX; }, /maxPerMessage/]]) {
      set(); ok(w.A.validatePolicy().some((m) => pat.test(m)), "H: it refuses " + label, w.A.validatePolicy()); undo();
    }
  }
  // ── I — a queued act learns its real id ──
  {
    const w = world(), A = w.A;
    const lone = A.submit(act(A, "ddjp.dj.skip", "@a:hs", { p: "$x" })); A.openIfDue(); await tick();
    const lid = await lone.promise;
    ok(lid && lid.eventId === w.out[0].id, "I: an act sent alone learns the carrier's id", lid);
    const j = A.submit(act(A, "ddjp.dj.join", "@b:hs", { v: "bbbbbbbbbbb" })), p = A.submit(act(A, "ddjp.dj.play", "@bot:hs", { p: "$x" }));
    w.t += 500; A.openIfDue(); await tick();
    const [jid, pid] = [await j.promise, await p.promise];
    ok(jid.eventId === w.out[1].id + "#0" && pid.eventId === w.out[1].id + "#1" && pid.carrier === w.out[1].id,
      "I: and batch members learn carrier#k — the id every reader gives them", [jid, pid]);
  }
  // ── J — MEASURED: the added delay, visible and hidden tabs ──
  {
    const model = (label, timerMs, msgEveryMs, sinceSendMs, oneShot) => {
      const delays = []; let rule = true;
      for (let trial = 0; trial < 400; trial++) {
        const w = world(), A = w.A;
        A.submit(act(A, "ddjp.dj.skip", "@prev:hs", { p: "$x" })); A.openIfDue();                 // a send just before
        const lastSend = w.t; w.t += (typeof sinceSendMs === "number") ? sinceSendMs : Math.floor(Math.random() * 1500);   // the change falls due this long after the last send
        const dueAt = w.t; A.submit(act(A, "ddjp.dj.play", "@bot:hs", { p: "$x" }));
        const asked = A.openIfDue();                                                              // submitted, and the gate asked at once
        const shot = (oneShot && asked && asked.reason === "between-openings" && asked.urgent) ? dueAt + asked.waitMs : null;   // the runner's one-shot
        const phaseT = Math.random() * timerMs, phaseM = Math.random() * msgEveryMs;
        const triggers = [];
        for (let k = 0; k < 400; k++) { triggers.push(lastSend + phaseT + k * timerMs); triggers.push(lastSend + phaseM + k * msgEveryMs); }
        if (shot !== null) triggers.push(shot);
        triggers.sort((a, b) => a - b);
        let sentAt = w.out.length === 2 ? dueAt : null;
        for (const at of triggers) { if (sentAt !== null) break; if (at <= dueAt) continue; w.t = at; A.openIfDue(); if (w.out.length === 2) sentAt = at; }
        const first = [dueAt].concat(triggers.filter((at) => at > dueAt)).find((at) => at - lastSend >= A.POLICY.gate.intervalMs);
        if (sentAt !== first) rule = false;
        delays.push(sentAt - dueAt);
      }
      delays.sort((a, b) => a - b);
      const q = (p) => delays[Math.floor(p * (delays.length - 1))];
      console.log("[bot-gate] MEASURED " + label + ": a due song change waits median " + q(0.5).toFixed(0) + " ms, p95 " + q(0.95).toFixed(0) + " ms, max " + q(1).toFixed(0) + " ms");
      return { rule, max: q(1) };
    };
    const vis0 = model("visible tab, NO one-shot (as first built)", 500, 2000);
    const vis = model("visible tab with the one-shot (timer 500 ms, a message every ~2 s)", 500, 2000, undefined, true);
    const hid = model("hidden tab (timer once a minute, a message every ~2 s)", 60000, 2000);
    const quiet = model("hidden, quiet room (timer once a minute, a message every ~5 min)", 60000, 300000);
    ok(vis.rule && hid.rule && quiet.rule, "J: in every trial a due song change went at its FIRST trigger once the interval had passed since the last send", [vis.rule, hid.rule, quiet.rule]);
    const idle = model("visible tab, last send long ago (the common case)", 500, 2000, 10000);
    ok(idle.rule && idle.max === 0, "J: when the last send was long ago, a due song change goes at once", idle.max);
    // WORST CASE, MEASURED: a send just before the change was due — the change waits out the rest of the interval, then
    // for the next trigger: at most gate.intervalMs + one timer period in a visible tab (more than the 500 ms first stated).
    ok(vis0.max <= 1000, "J: without the one-shot, a visible tab waits at most the interval plus one timer period", vis0.max);
    // THE ONE-SHOT (J76, at the audit): held only by the spacing, an urgent act gets an opening exactly when it ends.
    ok(vis.rule && vis.max <= 500, "J: with it, a visible tab's worst case is the gate's interval — 500 ms, as first stated", vis.max);
    // ── K — the one-shot's inputs and its one home ──
    {
      const w = world(), A = w.A;
      A.submit(act(A, "ddjp.dj.skip", "@a:hs", { p: "$x" })); A.openIfDue();
      w.t += 120; A.submit(act(A, "ddjp.dj.skip", "@b:hs", { p: "$x" }));
      const r = A.openIfDue();
      ok(r.reason === "between-openings" && r.urgent === true && r.waitMs === A.POLICY.gate.intervalMs - 120,
        "K: held by the spacing, the gate says exactly how long remains and that an urgent act waits", r);
      const w2 = world(), A2 = w2.A;
      A2.submit(act(A2, "ddjp.dj.skip", "@a:hs", { p: "$x" })); A2.openIfDue();
      w2.t += 120; A2.submit(act(A2, "ddjp.dj.join", "@b:hs", { v: "bbbbbbbbbbb" }));
      ok(A2.openIfDue().urgent === false, "K CONTROL: with only grouped acts waiting, no one-shot is asked for");
      const RN = fs.readFileSync(path.join(__dirname, "..", "backends/backend2/runner.js"), "utf8").replace(/\/\/[^\n]*/g, "");
      ok((RN.match(/B2Authority\.openIfDue\(/g) || []).length === 1 && /_oneShot = setTimeout\(function \(\) \{ _oneShot = null; if \(_on\) _openSoon\(\); \}, Math\.max\(0, r\.waitMs \|\| 0\)\);/.test(RN),
        "K: every gate call in the runner goes through `_openSoon`, which schedules ONE opening for when the spacing ends");
    }
  }
})().then(done, (e) => { failed++; console.log("[bot-gate] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[bot-gate] " + failed + " failure(s)"); process.exit(1); }
  console.log("[bot-gate] PASS — the bot's security gate (J76): everything, the heartbeat and seals included, leaves in accepted order, " +
    "one message an opening, openings at least the interval apart and only counted when they send; urgent acts go sooner and " +
    "never ahead; every act meets the per-person limit, in silence; merges never reorder; bypass is off; every value is read and " +
    "validated; a queued act learns its real id; and a due song change goes at its first trigger (" + asserts + " assertions)");
  process.exit(0);
}
