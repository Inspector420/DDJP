// J76: every act in the log, batch members included, as { type, body, room }.
const _members = (ctx) => [].concat(...ctx.sent.map((x) => x.type === "ddjp.batch" ? (x.body.evs || []).map((e) => ({ type: e.t, body: e, room: x.room })) : [x]));
// tests/check-bot-songs.js
// SUBJECT: backends/backend2/runner.js, backends/backend2/authority.js, backends/backend2/transport.js, features/playback.js, features/mediablocked.js
//
// WALL: IN A BOT ROOM THE BOT RUNS THE SONGS (J66). Driven against the real runner and authority
// (and the real Playback for the apps' side); the stand-ins take their shape from the real sources.
//
//   A  the runner ends a song at the FULL agreed length — never at the gate's earlier edge, which
//      would cut every song's last second — naming the song it ends
//   B  it starts the first song when someone is queued and nothing plays
//   C  with no agreed length it waits for the maxLen ceiling
//   D  one advance in flight per song; a lost or refused one is retried after the retry window
//   E  one length per song: the first report, then only a higher rank's real disagreement; the
//      display-only length is never relayed
//   F  the bot's own acts go straight to the runner: one message, still answered by `src`
//   G  an app's advance is a BACKUP in a bot room: it waits `advanceBackupMs` past the end
//   H  a lost can't-play report is sent once more (the retry, extracted and RUN)
//   I  a busy song, measured again

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load.js");

let failed = 0, checks = 0;
function ok(cond, msg, got) {
  checks++;
  if (!cond) {
    failed++;
    console.log("[bot-songs] FAIL — " + msg);
    if (got !== undefined) { try { console.log("      got " + JSON.stringify(got)); } catch (e) { console.log("      got (unprintable)"); } }
  }
}
function attempt(label, fn) { try { return fn(); } catch (e) { ok(false, label + " threw: " + (e && e.message)); return null; } }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// The real authority + runner, a state the test sets, a local clock it moves, and SERVER time
// learned the way the runner learns it: from the stamps of arriving messages.
function runnerWorld(stateRef, ranks) {
  let local = 5e12, k = 0;
  const ctx = { console, sent: [], Date: { now: () => local } };
  vm.createContext(ctx);
  ctx.Logger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  ctx.setInterval = () => 0; ctx.clearInterval = () => {};
  ctx.Ranks = { levelOf: (n) => (n === "owner" ? 99 : 0) };
  ctx.Capabilities = { can: () => ({ permitted: true, reason: null }) };
  ctx.StreamManager = { getState: () => stateRef.value, getLog: () => [] };
  ctx.Backends = { register: () => {}, active: () => "backend2", resolveMode: () => "backend2" };
  ctx.B2Checkpoint = { TYPE: "ddjp.checkpoint", floor: () => null, floorAt: () => null, seal: () => ({ ok: false }) };
  ctx.MatrixBridge = {
    getMyPowerLevel: () => 99, getUserId: () => "@bot:hs",
    getUserEffectiveRank: (s, c, who) => ((ranks && who in ranks) ? ranks[who] : 40),
    getCreateContent: () => ({ ddjp_mode: "backend2" }), onRawEvent: () => {}, offRawEvent: () => {},
    mayAuthor: () => ({ ok: true }), onAuthorReady: () => {},
    sendEvent: (room, type, c) => { ctx.sent.push({ room, type, body: c }); return Promise.resolve({ eventId: "$s" + ctx.sent.length, l: 1 }); },
  };
  for (const f of ["backends/backend2/authority.js", "backends/backend2/runner.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  vm.runInContext("globalThis.R = B2Runner; globalThis.A = B2Authority;", ctx);
  ctx.R.start({ channels: { events_uncategorized: "!int", events_owner: "!log" }, spaceId: "!s" });
  // J76: the start-up announcement takes the gate's first opening; let it go, so every row below sees the bot's own
  // acts at their first trigger — the property J76 holds (a due song change leaves at its first trigger).
  vm.runInContext("B2Authority.flush()", ctx);
  const at = (serverTs) => ctx.R._onRaw({ type: "m.room.message", event_id: "$t" + (++k), room_id: "!log", sender: "@bot:hs",
    ts: serverTs, content: { body: "{}" } });
  const intent = (body, sender, serverTs) => ctx.R._onRaw({ type: "m.room.message", event_id: "$i" + (++k), room_id: "!int",
    sender: sender, ts: serverTs, content: { body: JSON.stringify(Object.assign({ l: 50, dv: 2, hv: 1 }, body)) },
    ddjpType: body.t, ddjpBody: body });
  return { ctx, at, intent, wait: (ms) => { local += ms; }, setLocal: (v) => { local = v; }, local: () => local,
           // J76: an act may travel inside a batch (an urgent act takes the waiting group along), so count MEMBERS.
           plays: () => _members(ctx).filter((x) => x.type === "ddjp.dj.play"),
           ofType: (t) => _members(ctx).filter((x) => x.type === t) };
}
const S = 1790900000000;
const playing = (lenSec) => ({ value: {
  settings: {}, rotation: [{ user: "@dj:hs", pending: [{ videoId: "BBBBBBBBBBB" }] }],
  nowPlaying: { pi: "$p1", startedAt: S, song: { videoId: "AAAAAAAAAAA" }, dj: "@dj:hs" },
  advance: { pi: "$p1", gateLenSec: lenSec, earliestAt: lenSec ? S + lenSec * 1000 - 1000 : S + 8000, ceilingAt: S + 600000 },
} });

(async () => {
  // ── A, D — THE FULL LENGTH, ONE IN FLIGHT ──────────────────────────────────────────────────
  attempt("A", () => {
    const w = runnerWorld(playing(200));
    w.at(S + 199000);
    ok(w.plays().length === 0, "A: nothing at the gate's earliest edge (agreed length minus grace) — that edge is the " +
      "room's tolerance, and advancing there would cut every song's last second", w.plays().length);
    w.at(S + 199999);
    ok(w.plays().length === 0, "A: nor a moment before the end", w.plays().length);
    w.at(S + 200000);
    const p = w.plays();
    ok(p.length === 1 && p[0].body.p === "$p1" && p[0].body.actor === "@bot:hs" && p[0].room === "!log",
      "A: and AT the end the runner ends the song itself, naming it, into the log — no margin past it (J72): " +
      "the room accepts an advance up to its grace early, and players switch only when it reaches them",
      p.map((x) => x.body));
    for (let i = 1; i <= 8; i++) { w.wait(1000); w.at(S + 200000 + i * 1000); }
    ok(w.plays().length === 1, "D: one advance in flight per song — and NO retry while it is still on its way, even " +
      "8 s later. Retrying at 5 s is what put a refused duplicate in the owner's feed: the bot's tab sees its own " +
      "messages back slowly", w.plays().length);
    w.wait(13000); w.at(S + 221000);
    ok(w.plays().length === 2, "D: one that never comes back is retried after the answer window — the room never freezes",
      w.plays().length);
  });
  // And one that DID come back while the room did not move was refused (too early): retry 5 s on.
  // Async because the send's reply lands a moment after the send, as the real transport's does.
  await (async () => {
    const w2 = runnerWorld(playing(200));
    w2.at(S + 200000);
    await settle();
    const sentId = "$s" + w2.ctx.sent.length;   // the stub numbers sends in order; the play is the last
    w2.ctx.R._onRaw({ type: "m.room.message", event_id: sentId, room_id: "!log", sender: "@bot:hs", ts: S + 200100,
                      content: { body: "{}" } });
    w2.wait(4000); w2.at(S + 204100);
    ok(w2.plays().length === 1, "D: an advance that came back refused waits the retry window", w2.plays().length);
    w2.wait(1500); w2.at(S + 205600);
    ok(w2.plays().length === 2, "D: and is then retried", w2.plays().length);
  })();
  // D3 (J76, at the audit): the same, but the advance travels as a BATCH MEMBER — a join waits in the queue, so the urgent
  // advance takes it along and the carrier echoes. The runner must still know its own advance (`carrier#k`) and retry 5 s on.
  await (async () => {
    const w3 = runnerWorld(playing(200));
    // The door's member naming, from the shipped source: production loads the door before the authority, so the batched
    // advance learns `carrier#k` and only the CARRIER match can recognise its echo (J77; without this the two coincide).
    const SMS = require("fs").readFileSync(require("path").join(__dirname, "..", "backends/backend2/streammanager.js"), "utf8");
    const mi = SMS.indexOf("  function memberId("), mj = SMS.indexOf("\n", mi);
    vm.runInContext(SMS.slice(mi, mj) + "\nglobalThis.B2StreamManager = { memberId: memberId };", w3.ctx);
    w3.at(S + 199900);
    w3.intent({ t: "ddjp.dj.join", v: "jjjjjjjjjjj" }, "@j:hs", S + 199900);   // grouped: waits for its window
    w3.at(S + 200000);
    await settle();
    const last = w3.ctx.sent[w3.ctx.sent.length - 1];
    ok(last && last.type === "ddjp.batch" && last.body.evs[last.body.evs.length - 1].t === "ddjp.dj.play",
      "D3 PREMISE — the advance travelled as the batch's last member", last && last.type);
    const carrierId = "$s" + w3.ctx.sent.length;
    w3.ctx.R._onRaw({ type: "m.room.message", event_id: carrierId, room_id: "!log", sender: "@bot:hs", ts: S + 200100, content: { body: "{}" } });
    w3.wait(4000); w3.at(S + 204100);
    ok(w3.plays().length === 1, "D3: a batched advance that came back refused waits the retry window", w3.plays().length);
    w3.wait(1500); w3.at(S + 205600);
    ok(w3.plays().length === 2, "D3: and is retried at ADVANCE_RETRY_MS — its carrier's echo was known as its own", w3.plays().length);
  })();
  attempt("A tail", () => {
  });

  // ── B — THE FIRST SONG ─────────────────────────────────────────────────────────────────────
  attempt("B", () => {
    const w = runnerWorld({ value: { settings: {}, nowPlaying: null, advance: null,
      rotation: [{ user: "@dj:hs", pending: [{ videoId: "AAAAAAAAAAA" }] }] } });
    w.at(S);
    ok(w.plays().length === 1 && w.plays()[0].body.p === null,
      "B: someone is queued and nothing plays — the runner starts the first song (p=null)", w.plays().map((x) => x.body));
    const quiet = runnerWorld({ value: { settings: {}, nowPlaying: null, advance: null, rotation: [] } });
    quiet.at(S);
    ok(quiet.plays().length === 0, "B CONTROL: and with nobody queued it sends nothing", quiet.plays().length);
  });

  // ── C — NO AGREED LENGTH: THE CEILING ──────────────────────────────────────────────────────
  attempt("C", () => {
    const w = runnerWorld(playing(null));
    w.at(S + 300000);
    ok(w.plays().length === 0, "C: with no agreed length the runner does not guess — not the 8-second floor, not a " +
      "local estimate", w.plays().length);
    w.at(S + 600000);
    ok(w.plays().length === 1, "C: it ends the song at the maxLen ceiling", w.plays().length);
  });

  // ── E — ONE LENGTH PER SONG ────────────────────────────────────────────────────────────────
  attempt("E", () => {
    const w = runnerWorld(playing(null), { "@low:hs": 0, "@low2:hs": 0, "@high:hs": 60 });
    w.at(S + 1000);
    w.intent({ t: "ddjp.play.len", pi: "$p1", sec: 200 }, "@low:hs", S + 1000);
    w.intent({ t: "ddjp.play.len", pi: "$p1", sec: 230 }, "@low2:hs", S + 1100);
    w.intent({ t: "ddjp.play.len", pi: "$p1", sec: 201 }, "@high:hs", S + 1200);
    w.wait(1000); w.ctx.A.openIfDue();   // J76 Q2: length reports group normally — they leave after the window
    const lens = () => w.ofType("ddjp.play.len").length;
    ok(lens() === 1, "E: the first report goes; a same-rank one and a higher rank's AGREEING one change nothing and are " +
      "not passed on", lens());
    w.intent({ t: "ddjp.play.len", pi: "$p1", sec: 230 }, "@high:hs", S + 1300);
    w.wait(1000); w.ctx.A.openIfDue();
    ok(lens() === 2, "E: a higher rank's real disagreement IS passed on — the cascade's own correction", lens());
    w.intent({ t: "ddjp.media.len", v: "AAAAAAAAAAA", d: 200 }, "@low:hs", S + 1400);
    ok(w.ofType("ddjp.media.len").length === 0, "E: and the display-only length is never relayed", w.ofType("ddjp.media.len").length);
  });

  // ── F — THE BOT'S OWN ACTS GO STRAIGHT IN ──────────────────────────────────────────────────
  attempt("F", () => {
    const w = runnerWorld(playing(200));
    w.at(S + 1000);
    const before = w.ctx.sent.length;
    const r = w.ctx.R.submitOwn("ddjp.dj.skip", { p: "$p1", k: "repeat" });
    const out = w.ctx.sent.slice(before);
    ok(out.length === 1 && out[0].room === "!log" && out[0].body.src === r.eventId && out[0].body.k === "repeat",
      "F: the runner's own act becomes ONE message in the log — no intent written and relayed back — and its `src` is " +
      "the id handed back, so the act is still answered; the repeat tag survives", out.map((x) => ({ room: x.room, src: x.body.src })));
    // The transport routes the runner's own sends there, and only those.
    const routed = [], shared = [];
    const g = { console };
    vm.createContext(g);
    g.Logger = { info: () => {}, error: () => {}, warn: () => {} };
    g.Backends = { register: () => {} };
    g.B2StreamManager = { setFoldScope: () => {} };
    let mine = true;
    g.B2Runner = { start: () => ({ ok: false }), takesOwn: () => mine, submitOwn: (t) => { routed.push(t); return { eventId: "$own-1" }; } };
    g.B1MatrixBridge = { onRawEvent() {}, offRawEvent() {}, getUserEffectiveRank: () => 0, getUserId: () => "@bot:hs",
      seedClock() {}, setRoomScope() {}, answerDeadlineMs: () => 22000,
      sendEvent: (room, t) => { shared.push(room + " " + t); return Promise.resolve({ eventId: "$m" }); } };
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/transport.js"), "utf8") + "; globalThis.T = B2MatrixBridge;", g);
    g.T.seedClock("!s"); g.T.setRoomScope({ events_uncategorized: "!int", events_owner: "!log" });
    g.T.sendEvent("!int", "ddjp.dj.remove", {});
    g.T.sendEvent("!log", "ddjp.dj.play", {});
    mine = false;
    g.T.sendEvent("!int", "ddjp.dj.vote", {});
    ok(JSON.stringify(routed) === JSON.stringify(["ddjp.dj.remove"]) &&
       JSON.stringify(shared) === JSON.stringify(["!log ddjp.dj.play", "!int ddjp.dj.vote"]),
      "F: the transport hands the runner its OWN intents and nothing else — its log writes, and every send on a client " +
      "that is not the runner, go through the shared transport unchanged", { routed, shared });
    ok(g.T.advanceBackupMs() === 10000, "F: and tells apps their advance is a backup, sent 10 s past due", g.T.advanceBackupMs());
  });

  // ── G — AN APP'S ADVANCE IS A BACKUP ───────────────────────────────────────────────────────
  await (async () => {
    const mk = (backupMs) => {
      let now = 0;
      const timers = [], sends = [];
      const np = { dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0,
        settings: { maxLen: 600, minLen: 10, vouchJitter: 1000, minGate: 8000, graceMs: 1000, presendMs: 300 } };
      const state = () => ({ nowPlaying: np, rotation: [{ user: "@a:hs", pending: [] }], settings: np.settings,
        advance: { pi: np.pi, gateLenSec: null, earliestAt: 0, ceilingAt: 600000 } });
      const bridge = { async sendEvent(c, t) { sends.push(t); return { eventId: "$a" + sends.length }; }, mayAdvance: () => ({ ok: true }) };
      if (typeof backupMs === "number") bridge.advanceBackupMs = () => backupMs;
      const sb = loadInContext(["features/playback.js"], {
        Date: { now: () => now },
        Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round },
        setTimeout: (fn, ms) => { timers.push({ fn: fn, at: now + (ms || 0) }); return timers.length; },
        clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
        StreamManager: { getState: state, on: () => {}, off: () => {} }, MatrixBridge: bridge,
        Capabilities: { staggerMs: () => 0, rankNameOf: () => "uncategorized" },
        Logger: { debug() {}, info() {}, warn() {}, error() {} },
      });
      sb.Playback.initWiring("!ev:hs");
      const runDue = async () => {
        for (let i = 0; i < 50; i++) {
          const due = timers.filter((x) => x.at <= now && !x.done);
          if (!due.length) break;
          for (const x of due) { x.done = true; await x.fn(); }
        }
        await settle();
      };
      return { P: sb.Playback, sends, at: (t) => { now = t; }, runDue };
    };
    const shared = mk(undefined);
    shared.P.setDuration("AAAAAAAAAAA", 200);
    shared.at(200000); shared.P.notifyEnded("AAAAAAAAAAA"); shared.at(200400); await shared.runDue();
    ok(shared.sends.length === 1, "G CONTROL: in a shared room the app advances as the song ends — every client's " +
      "advance IS the mechanism", shared.sends.length);
    const bot = mk(10000);
    bot.P.setDuration("AAAAAAAAAAA", 200);
    bot.at(200000); bot.P.notifyEnded("AAAAAAAAAAA"); bot.at(200400); await bot.runDue();
    ok(bot.sends.length === 0, "G: in a bot room it does not — the runner ends songs", bot.sends.length);
    bot.at(210400); await bot.runDue();
    ok(bot.sends.length === 1, "G: and sends its backup only once the song is 10 s overdue, so a sleeping bot cannot " +
      "freeze the room", bot.sends.length);
  })();

  // ── H — A LOST CAN'T-PLAY REPORT IS SENT ONCE MORE ─────────────────────────────────────────
  await (async () => {
    const src = fs.readFileSync(path.join(ROOT, "features/mediablocked.js"), "utf8");
    const a = src.indexOf("function _followReport(");
    ok(a > 0, "H: the retry is one named function, `_followReport`");
    if (a < 0) return;
    let d = 0, end = -1;
    for (let i = src.indexOf("{", a); i < src.length; i++) {
      if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { end = i + 1; break; } }
    }
    const sends = [];
    const h = { Promise, eventsChannel: "!int", _iCannotSee: { $p1: { k: "150" } }, iReportedBlocked: () => false,
      StreamManager: { getState: () => ({ nowPlaying: { pi: "$p1" } }) },
      MatrixBridge: { sendEvent: (c, t) => { sends.push(t); return Promise.resolve({ eventId: "$b" + sends.length }); },
                      awaitAnswer: () => Promise.resolve({ status: "none" }) } };
    vm.createContext(h);
    vm.runInContext(src.slice(a, end) + "; globalThis.f = _followReport;", h);
    await h.f("$p1", { pi: "$p1" }, { eventId: "$b0" }, 1);
    await settle();
    ok(sends.length === 1, "H: a report with no answer is sent once more — once, not on and on", sends.length);
    sends.length = 0;
    h.iReportedBlocked = () => true;
    await h.f("$p1", { pi: "$p1" }, { eventId: "$b0" }, 1);
    ok(sends.length === 0, "H CONTROL: not when the room has already recorded me", sends.length);
  })();

  // ── K — THE ROOM'S CLOCK FROM THE BOT'S OWN ROUND TRIP (J72) ─────────────────────────────────
  // A bot whose device clock runs 2 s behind the server, and whose messages arrive 1 s after they
  // are stamped (the owner's run). "Newest stamp + local time since" lags by the arrival delay, so
  // songs ended about a second late. One round trip of its own announcement fixes the clock.
  await (async () => {
    const D = 2000, ARRIVE = 1000;
    const mk = async (sample) => {
      const w = runnerWorld(playing(200));
      w.setLocal(S + 100000 - D);                                  // true server time S+100000
      const t0 = w.local();
      if (sample) {
        // one of its own acts goes out at t0, is stamped 300 ms later, and comes back 800 ms after t0
        w.ctx.R.submitOwn("ddjp.dj.skip", { p: "$p1" });
        await settle();                                            // the send's reply lands
        const id = "$s" + w.ctx.sent.length;
        w.setLocal(t0 + 800);
        w.ctx.R._onRaw({ type: "m.room.message", event_id: id, room_id: "!log", sender: "@bot:hs",
                         ts: t0 + D + 300, content: { body: "{}" } });
      }
      // ordinary traffic: stamped, then arriving ARRIVE ms later
      const stamp = S + 150000;
      w.setLocal(stamp - D + ARRIVE);
      w.at(stamp);
      return w;
    };
    const fixed = await mk(true);
    fixed.setLocal(S + 200000 - D + 150);                          // true server time: end + 150 ms
    fixed.ctx.R._advanceTick();
    ok(fixed.plays().length === 1, "K: with its own round trip measured, the bot ends the song within moments of " +
      "the true end", fixed.plays().length);
    const lagging = await mk(false);
    lagging.setLocal(S + 200000 - D + 150);
    lagging.ctx.R._advanceTick();
    ok(lagging.plays().length === 0, "K CONTROL: without it, the arrival delay holds the change back — the second of " +
      "silence the owner measured", lagging.plays().length);
  })();

  // ── K2 — THE ROUND-TRIP CAP (audit ddjp_512: no guard covered RT_MAX_MS) ─────────────────────
  // The first sample is accepted whatever its round trip (the best-so-far starts at Infinity), so
  // the cap alone keeps out a slow one — and an echo stamped with the device clock after the
  // transport's 4-second wait. Over 3.5 s: not used; the clock stays on its fallback.
  await (async () => {
    const probe = async (rt) => {
      const w = runnerWorld(playing(200));
      w.setLocal(S + 100000);
      w.at(S + 100000);
      const t0 = w.local();
      w.ctx.R.submitOwn("ddjp.dj.skip", { p: "$p1" });
      await settle();
      const id = "$s" + w.ctx.sent.length;
      w.setLocal(t0 + rt);
      w.ctx.R._onRaw({ type: "m.room.message", event_id: id, room_id: "!log", sender: "@bot:hs", ts: t0 + 2600,
                       content: { body: "{}" } });
      return { now: w.ctx.R._serverNow(), fallback: t0 + 2600 };   // newest stamp, seen just now
    };
    const slow = await probe(5000);
    ok(slow.now === slow.fallback, "K2: a round trip over 3.5 s does not set the clock — it stays on its fallback", slow);
    const fast = await probe(800);
    ok(fast.now !== fast.fallback, "K2 CONTROL: one under the cap does", fast);
  })();

  // ── L — THE INSTANT-SEND FLOOR, BUILT AND OFF (J72) ─────────────────────────────────────────
  attempt("L", () => {
    // REWRITTEN BY J76 (owner ruling 2, `ddjp_529`): the dormant `instantMinGapMs` floor this part tested is gone — the gate
    // grew out of it. The protective points stay: what ships, that a second urgent act waits, that it then goes in order with
    // nothing dropped, and that the table refuses nonsense.
    const w = runnerWorld(playing(200));
    w.at(S + 1000);
    ok(w.ctx.A.POLICY.gate.intervalMs === 500 && w.ctx.A.POLICY.instantMinGapMs === undefined,
      "L: the gate ships at 500 ms, grown out of the old floor, which is gone", w.ctx.A.POLICY.gate);
    const n0 = w.ctx.sent.length;
    w.intent({ t: "ddjp.dj.skip", p: "$p1" }, "@a:hs", S + 1000);
    ok(w.ctx.sent.length - n0 === 1, "L: an urgent act goes at its first trigger when the gate is due", w.ctx.sent.length - n0);
    w.wait(100);
    w.intent({ t: "ddjp.dj.skip", p: "$p1" }, "@b:hs", S + 1100);
    ok(w.ctx.sent.length - n0 === 1, "L: a second one 100 ms later waits — openings are at least 500 ms apart", w.ctx.sent.length - n0);
    w.wait(400); w.ctx.A.openIfDue();
    ok(w.ctx.sent.length - n0 === 2 && w.ctx.sent[w.ctx.sent.length - 1].type === "ddjp.dj.skip",
      "L: and goes at the next opening — in order, nothing dropped", w.ctx.sent.slice(n0).map((x) => x.type));
    const g = w.ctx.A.POLICY.gate.intervalMs;
    w.ctx.A.POLICY.gate.intervalMs = -1;
    ok(w.ctx.A.validatePolicy().some((m) => /gate\.intervalMs/.test(m)), "L: and the table refuses a nonsense gate");
    w.ctx.A.POLICY.gate.intervalMs = g;
  });

  // ── I — A BUSY SONG, MEASURED AGAIN ────────────────────────────────────────────────────────
  attempt("I", () => {
    const ranks = {};
    for (let i = 0; i < 12; i++) ranks["@l" + i + ":hs"] = (i === 0 ? 60 : 0);
    const w = runnerWorld(playing(null), ranks);
    w.at(S);
    for (let i = 0; i < 12; i++) {
      w.intent({ t: "ddjp.media.len", v: "AAAAAAAAAAA", d: 200 }, "@l" + i + ":hs", S + 100 + i);
      w.intent({ t: "ddjp.play.len", pi: "$p1", sec: 200 }, "@l" + i + ":hs", S + 200 + i);
    }
    for (let i = 0; i < 9; i++) w.intent({ t: "ddjp.dj.vote", p: "$p1" }, "@l" + i + ":hs", S + 1000 + i);
    w.ctx.A.flush();
    const msgs = w.ctx.sent.filter((x) => x.room === "!log" && x.type !== "ddjp.bot.here").length;
    console.log("[bot-songs] measured — one busy song: 12 listeners, 33 acts, cost " + msgs + " bot messages (J65: 15 for 28)");
    ok(msgs <= 3, "I: a busy song's acts travel in at most three bot messages", msgs);
  });

  if (failed) {
    console.log("[bot-songs] FAIL — " + failed + " of " + checks + " assertions failed");
    process.exit(1);
  }
  console.log("[bot-songs] PASS — in a bot room the bot runs the songs (J66, " + checks + " assertions): it ends each " +
    "song at the full agreed length, starts the first, waits for the ceiling without one, and keeps one advance in " +
    "flight; one length per song; its own acts are one message, still answered; an app's advance is a 10 s backup; " +
    "a lost can't-play report goes once more; and a busy song costs at most three bot messages");
})();
