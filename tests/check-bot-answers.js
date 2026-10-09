// tests/check-bot-answers.js
// SUBJECT: backends/backend2/authority.js, backends/backend2/runner.js, backends/backend1/matrixbridge.js, features/userqueue.js, features/reactions.js, features/skip.js
//
// WALL: EVERY REQUEST IS ANSWERED, ON A SCHEDULE ONE TABLE DECIDES (J65). Driven against the real
// authority, runner, transport answer code and features — the shapes of every stand-in are taken from
// the real sources (`sendEvent` resolves `{ eventId, l }`; the fan-out raw carries `ts`).
//
//   A  the send table checks itself, and a planted missing row is caught
//   B  the schedule: a grouped act waits for its deadline; an instant act takes the waiting group
//      with it, group first; ten acts leave at once
//   C  everyone voting at a song's start costs ONE message; a skip meanwhile sends it at once
//   D  merges keep the result and still answer the merged act (`also`)
//   E  the budget holds grouped sends back and never an instant one
//   F  the runner answers "no" with the reason, drops an act too old to answer, refuses one person
//      flooding a group, and every request ends in exactly one counted outcome
//   G  the transport's answer rule, extracted and RUN: yes / no-with-reason / none, in both engines
//   H  the app follows answers: a join with no answer is retried once then released (Join comes
//      back); a lost vote un-presses its button; a skip reports the room's refusal
//   I  a busy song, measured: what the room costs in bot messages

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load.js");

let failed = 0, checks = 0;
function ok(cond, msg, got) {
  checks++;
  if (!cond) {
    failed++;
    console.log("[bot-answers] FAIL — " + msg);
    if (got !== undefined) { try { console.log("      got " + JSON.stringify(got)); } catch (e) { console.log("      got (unprintable)"); } }
  }
}
function attempt(label, fn) { try { return fn(); } catch (e) { ok(false, label + " threw: " + (e && e.message)); return null; } }
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

// The authority alone, with a LOCAL clock the guard moves, and a recording send.
function authority() {
  const ctx = { console };
  vm.createContext(ctx);
  ctx.Capabilities = { can: (verb) => ({ permitted: verb !== "dj.reset", reason: verb === "dj.reset" ? "Staff rank required" : null }) };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/authority.js"), "utf8") + "; globalThis.A = B2Authority;", ctx);
  const A = ctx.A, out = [];
  let now = 1000;
  A.reset();
  A.attach((type, payload) => { out.push({ type, payload }); return Promise.resolve({ eventId: "$o" + out.length, l: out.length }); },
    { now: () => now });
  return { A, out, set: (t) => { now = t; }, at: () => now };
}
const act = (A, t, actor, extra, src) => A.stamp(Object.assign({ t: t, l: 99, dv: 2, hv: 1 }, extra || {}), actor, 20, src || ("$" + Math.random().toString(36).slice(2)), null);

(async () => {
  // ── A — THE TABLE CHECKS ITSELF ────────────────────────────────────────────────────────────
  attempt("A", () => {
    const w = authority();
    ok(Array.isArray(w.A.validatePolicy()) && w.A.validatePolicy().length === 0,
      "A: the shipped send table passes its own check", w.A.validatePolicy());
    const row = w.A.POLICY.types["ddjp.dj.join"];
    delete w.A.POLICY.types["ddjp.dj.join"];
    const missing = w.A.validatePolicy();
    w.A.POLICY.types["ddjp.dj.join"] = row;
    ok(missing.some((m) => /ddjp\.dj\.join/.test(m)),
      "A: and a relayed act with no row is CAUGHT — planted, not assumed. It would otherwise inherit a guessed default", missing);
    const slow = w.A.POLICY.types["ddjp.dj.vote"].waitMs;
    w.A.POLICY.types["ddjp.dj.vote"].waitMs = w.A.POLICY.answerWindowMs;
    const tooLong = w.A.validatePolicy();
    w.A.POLICY.types["ddjp.dj.vote"].waitMs = slow;
    ok(tooLong.some((m) => /ddjp\.dj\.vote/.test(m)),
      "A: so is a wait too long for the answer window — a grouped act could miss its own deadline", tooLong);
  });

  // ── B — THE TRIGGERS ───────────────────────────────────────────────────────────────────────
  attempt("B", () => {
    const w = authority();
    w.A.submit(act(w.A, "ddjp.dj.join", "@a:hs", { v: "aaaaaaaaaaa" }));
    w.set(1999); w.A.tick();
    ok(w.out.length === 0, "B: a grouped act waits for its deadline (1 s for a join)", w.out.map((x) => x.type));
    w.set(2000); w.A.tick();
    ok(w.out.length === 1 && w.out[0].type === "ddjp.batch", "B: and goes at it", w.out.map((x) => x.type));

    w.A.submit(act(w.A, "ddjp.dj.join", "@b:hs", { v: "bbbbbbbbbbb" }));
    w.A.submit(act(w.A, "ddjp.dj.play", "@c:hs", { p: "$pi" }));
    // J76: nothing leaves between openings; at the next one the urgent play takes the waiting join along, IN ORDER,
    // in one message (one message an opening).
    ok(w.out.length === 1, "B: nothing leaves between openings (J76)", w.out.length);
    w.A.tick();
    ok(w.out.length === 2 && w.out[1].type === "ddjp.batch" && w.out[1].payload.evs.map((e) => e.t).join() === "ddjp.dj.join,ddjp.dj.play",
      "B: an instant act takes the waiting group with it — the group first, so arrival order holds",
      w.out.map((x) => x.type));

    const before = w.out.length;
    // CHANGED BY J77 (`ddjp_534`): "full" is POLICY.maxPerMessage, read rather than copied — 20 since the raise.
    const FULL = w.A.POLICY.maxPerMessage;
    for (let i = 0; i < FULL; i++) w.A.submit(act(w.A, "ddjp.dj.join", "@u" + i + ":hs", { v: "c" + String(i).padStart(2, "0") + "cccccccc" }));
    w.A.tick();   // J76: a full group is due at once — it leaves at the next opening
    ok(w.out.length === before + 1 && w.out[before].payload.evs.length === FULL && w.A.pending() === 0,
      "B: a full message's worth leaves at once, as one message", { sent: w.out.length - before, pending: w.A.pending() });
  });

  // ── C — EVERYONE LIKES THE SONG AT ITS START ───────────────────────────────────────────────
  attempt("C", () => {
    const w = authority();
    for (let i = 0; i < 9; i++) { w.set(1000 + i * 100); w.A.submit(act(w.A, "ddjp.dj.vote", "@v" + i + ":hs", { p: "$song" })); }
    w.set(5999); w.A.tick();
    ok(w.out.length === 0, "C: nine votes in the first second wait (5 s for votes)", w.out.length);
    w.set(6000); w.A.tick();
    ok(w.out.length === 1 && w.out[0].payload.evs.length === 9,
      "C: and cost ONE bot message between them", w.out.map((x) => x.payload.evs && x.payload.evs.length));

    const w2 = authority();
    for (let i = 0; i < 4; i++) w2.A.submit(act(w2.A, "ddjp.dj.vote", "@v" + i + ":hs", { p: "$song" }));
    w2.set(1500);
    w2.A.submit(act(w2.A, "ddjp.dj.skip", "@s:hs", { p: "$song" }));
    w2.A.tick();   // J76: at the next opening, the urgent skip takes the waiting votes along — in order, one message
    ok(w2.out.length === 1 && w2.out[0].type === "ddjp.batch" && w2.out[0].payload.evs.length === 5 && w2.out[0].payload.evs[4].t === "ddjp.dj.skip",
      "C: a skip pressed during the wait sends the votes at once, with it", w2.out.map((x) => x.type));
  });

  // ── D — MERGES ─────────────────────────────────────────────────────────────────────────────
  attempt("D", () => {
    const w = authority();
    w.A.submit(act(w.A, "ddjp.dj.vote", "@a:hs", { p: "$song" }, "$first"));
    w.A.submit(act(w.A, "ddjp.dj.vote", "@a:hs", { p: "$song" }, "$second"));
    w.A.submit(act(w.A, "ddjp.dj.order", "@b:hs", { o: ["x"] }, "$o1"));
    w.A.submit(act(w.A, "ddjp.dj.order", "@b:hs", { o: ["y"] }, "$o2"));
    w.A.flush();
    const evs = w.out[0].payload.evs;
    const votes = evs.filter((e) => e.t === "ddjp.dj.vote"), orders = evs.filter((e) => e.t === "ddjp.dj.order");
    ok(votes.length === 1 && votes[0].src === "$first" && (votes[0].also || []).indexOf("$second") >= 0,
      "D: one person voting twice on one song is ONE vote — and the second is still answered, by `also`", votes);
    ok(orders.length === 1 && orders[0].o[0] === "y" && (orders[0].also || []).indexOf("$o1") >= 0,
      "D: and the latest order wins, answering the earlier one too", orders);
    ok(w.A.merged() === 2, "D: both merges are counted", w.A.merged());
  });

  // ── E — THE BUDGET ─────────────────────────────────────────────────────────────────────────
  attempt("E", () => {
    const w = authority();
    const B = w.A.POLICY.budget.messages;
    // CHANGED BY J76: lengths now group (owner Q2), so the budget is spent with urgent skips, one message an opening.
    for (let i = 0; i < B; i++) { w.A.submit(act(w.A, "ddjp.dj.skip", "@l" + i + ":hs", { p: "$s" + i })); w.A.tick(); }
    w.A.submit(act(w.A, "ddjp.dj.join", "@j:hs", { v: "jjjjjjjjjjj" }));
    w.set(3000);
    const r = w.A.tick();
    ok(r.reason === "budget" && w.A.pending() === 1, "E: past the budget, a due group waits", r);
    // CHANGED BY J76 (owner Q3: the budget stays as a second check): an urgent act waits too — the budget checks every send,
    // and it may not overtake the group waiting ahead of it. Once the budget allows, both leave in accepted order.
    w.A.submit(act(w.A, "ddjp.dj.play", "@p:hs", { p: "$pi" }));
    w.A.tick();
    ok(!w.out.some((x) => x.type === "ddjp.dj.play") && w.A.pending() === 2, "E: an urgent act waits behind it too — nothing overtakes (J76)", w.A.pending());
    w.set(3000 + w.A.POLICY.budget.perMs); w.A.tick();
    const lastOut = w.out[w.out.length - 1];
    ok(lastOut && lastOut.type === "ddjp.batch" && lastOut.payload.evs.map((e) => e.t).join() === "ddjp.dj.join,ddjp.dj.play",
      "E: and when the budget allows, the group and then the urgent act leave, in accepted order", lastOut && lastOut.payload);
    w.set(1000 + w.A.POLICY.budget.perMs + 10);
    w.A.tick();
    ok(w.A.pending() === 0, "E: and the group goes once the budget frees", w.A.pending());
  });

  // ── F — THE RUNNER'S ANSWERS, AND EVERY REQUEST'S ONE OUTCOME ──────────────────────────────
  attempt("F", () => {
    let fakeNow = 5e12;
    const ctx = { console, sent: [], live: true, ready: [], Date: { now: () => fakeNow } };
    vm.createContext(ctx);
    ctx.Logger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
    ctx.setInterval = () => 0; ctx.clearInterval = () => {};
    ctx.Ranks = { levelOf: (n) => (n === "owner" ? 99 : 0) };
    ctx.Capabilities = { can: (verb) => (verb === "dj.reset" ? { permitted: false, reason: "Staff rank required" } : { permitted: true, reason: null }) };
    ctx.StreamManager = { getState: () => ({ settings: {} }), getLog: () => [] };
    ctx.Backends = { register: () => {}, active: () => "backend2", resolveMode: () => "backend2" };
    ctx.B2Checkpoint = { TYPE: "ddjp.checkpoint", floor: () => null, floorAt: () => null, seal: () => ({ ok: false }) };
    ctx.MatrixBridge = {
      getMyPowerLevel: () => 99, getUserEffectiveRank: () => 40, getCreateContent: () => ({ ddjp_mode: "backend2" }),
      onRawEvent: () => {}, offRawEvent: () => {}, mayAuthor: () => ({ ok: true }), onAuthorReady: (fn) => ctx.ready.push(fn),
      sendEvent: (room, type, c) => { ctx.sent.push({ type, body: c }); return Promise.resolve({ eventId: "$s" + ctx.sent.length, l: 1 }); },
    };
    for (const f of ["backends/backend2/authority.js", "backends/backend2/runner.js"]) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
    }
    vm.runInContext("globalThis.R = B2Runner; globalThis.A = B2Authority;", ctx);
    ctx.R.start({ channels: { events_uncategorized: "!int", events_owner: "!log" }, spaceId: "!s" });
    let k = 0;
    const T0 = 1790815700000;
    const raw = (body, ts, sender) => ({ type: "m.room.message", event_id: "$in" + (++k), room_id: "!int", sender: sender || "@a:hs",
      ts: ts, content: { body: JSON.stringify(Object.assign({ l: 50, dv: 2, hv: 1 }, body)) }, ddjpType: body.t, ddjpBody: body });

    ctx.R._onRaw(raw({ t: "ddjp.dj.reset" }, T0));
    ctx.A.flush();
    const no = ctx.sent.filter((x) => x.type === "ddjp.batch").flatMap((x) => x.body.evs).find((e) => e.t === "ddjp.bot.refused");
    ok(no && no.src === "$in1" && no.of === "ddjp.dj.reset" && /Staff rank required/.test(no.reason) && no.actor === "@a:hs",
      "F: a refused act is ANSWERED — `ddjp.bot.refused` names the request, the act, the person and the room's reason. " +
      "Bot mode published no refusals, so the asking app could only guess", no);

    ctx.R._onRaw(raw({ t: "ddjp.dj.join", v: "nnnnnnnnnnn" }, T0 + 60000));                    // the newest stamp seen
    const held = raw({ t: "ddjp.dj.join", v: "ooooooooooo" }, T0 + 60000 - ctx.A.POLICY.answerWindowMs - 5000);
    ctx.R._onRaw(held);
    ok(ctx.R.stats().expired === 1,
      "F: an act older than the answer window is dropped unanswered — the asking app has already given up, " +
      "so acting now would make its honest \"that didn't work\" false", ctx.R.stats());

    const cap = ctx.A.POLICY.perActor.acts;
    for (let i = 0; i < cap + 3; i++) ctx.R._onRaw(raw({ t: "ddjp.dj.vote", p: "$p" + i }, T0 + 60000, "@flood:hs"));
    ok(ctx.R.stats().refused === 1 + 3,
      "F: one person past the rate cap is refused as too fast — each extra act answered \"no\" — rather " +
      "than crowding everybody else. (A cap counted per group could never fire: a group leaves at ten)", ctx.R.stats());
    ctx.R._onRaw(raw({ t: "ddjp.dj.vote", p: "$other" }, T0 + 60000, "@calm:hs"));
    ok(ctx.R.stats().refused === 4, "F: and nobody else is slowed by it", ctx.R.stats());

    // ANY ARRIVING MESSAGE RUNS THE SCHEDULE. The timer is a stub that never fires, so only the
    // arrival below can send the join once its second has passed — a sleeping tab still receives.
    ctx.A.flush();
    const n0 = ctx.sent.length;
    ctx.R._onRaw(raw({ t: "ddjp.dj.join", v: "ppppppppppp" }, T0 + 60000, "@late:hs"));
    ok(ctx.sent.length === n0, "F: APPLIED — the join waits", ctx.sent.length - n0);
    fakeNow += 1500;
    ctx.R._onRaw({ type: "m.room.message", event_id: "$own", room_id: "!log", sender: "@bot:hs", ts: T0 + 61500,
                   content: { body: "{}" } });
    ok(ctx.sent.length === n0 + 1 && ctx.sent[n0].type === "ddjp.batch",
      "F: and ANY arriving message sends it once due — the runner's own echo here — because a background " +
      "tab slows timers but still receives messages", ctx.sent.slice(n0).map((x) => x.type));

    const st = ctx.R.stats();
    ok(st.seen === st.stood + st.refused + st.expired,
      "F: and every request ends in exactly one counted outcome — accepted, refused or too old", st);
  });

  // ── G — THE TRANSPORT'S ANSWER RULE, EXTRACTED AND RUN ─────────────────────────────────────
  await (async () => {
    const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    const a = src.indexOf("const DEFAULT_ANSWER_DEADLINE_MS");
    const fnAt = src.indexOf("function _normaliseAll(");
    ok(a > 0 && fnAt > a, "G: APPLIED — the answer block and its conversion helper are where the extraction expects");
    if (!(a > 0 && fnAt > a)) return;
    let d = 0, end = -1;
    for (let i = src.indexOf("{", fnAt); i < src.length; i++) {
      if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { end = i + 1; break; } }
    }
    const log = [];
    const g = { console, setTimeout, clearTimeout, Map, Promise, String, Array,
      StreamManager: { getLog: () => log, refusalOf: (id) => (id === "$refusedOwn" ? { code: "not-permitted", text: "You may not do that" } : null),
                       normaliseAll: (r) => r.evs || [] },
      MatrixBridge: { answerDeadlineMs: () => 40 } };
    vm.createContext(g);
    vm.runInContext(src.slice(a, end) + "; globalThis.T = { awaitAnswer, _settleAnswers, _answersIn };", g);
    const T = g.T;
    const p1 = T.awaitAnswer("$mine");
    T._settleAnswers({ evs: [{ eventId: "$mine", type: "ddjp.dj.join", content: { t: "ddjp.dj.join" } }] });
    ok((await p1).status === "yes", "G: a shared room — my act's own event folding, accepted, is the yes");
    const p2 = T.awaitAnswer("$refusedOwn");
    T._settleAnswers({ evs: [{ eventId: "$refusedOwn", type: "ddjp.dj.reset", content: { t: "ddjp.dj.reset" } }] });
    const r2 = await p2;
    ok(r2.status === "no" && /may not/.test(r2.reason), "G: refused, it is the no — with the room's own reason", r2);
    const p3 = T.awaitAnswer("$intent");
    T._settleAnswers({ evs: [{ eventId: "$relay#0", type: "ddjp.dj.vote", content: { t: "ddjp.dj.vote", src: "$other", also: ["$intent"] } }] });
    ok((await p3).status === "yes", "G: a bot room — the relay that names my act, even merged into another's, is the yes");
    const p4 = T.awaitAnswer("$asked");
    T._settleAnswers({ evs: [{ eventId: "$r#0", type: "ddjp.bot.refused", content: { t: "ddjp.bot.refused", src: "$asked", reason: "Not in the rotation" } }] });
    const r4 = await p4;
    ok(r4.status === "no" && r4.reason === "Not in the rotation", "G: and the bot's refusal is the no, with its reason", r4);
    ok(/StreamManager\.ingest\(raw\);\n\s*_settleAnswers\(raw\);/.test(src),
      "G (textual): the spine door settles answers right after each event folds — the call site needs a " +
      "live client, so this proves it is spelled there, and the functions above are what it runs");
    const r5 = await T.awaitAnswer("$never");
    ok(r5.status === "none", "G: nothing inside the deadline is none — never a hang, never a guess", r5);
    log.push({ eventId: "$early", type: "ddjp.dj.save", content: { t: "ddjp.dj.save" } });
    ok((await T.awaitAnswer("$early")).status === "yes", "G: an answer that landed before the question is still found");
  })();

  // ── H — THE APP FOLLOWS ANSWERS ────────────────────────────────────────────────────────────
  await (async () => {
    // A JOIN THAT NEVER LANDS: the bot-501 wedge. Real StreamManager, Queue and UserQueue.
    const sent = [];
    const answers = {};   // eventId -> the answer the transport gives
    const bridge = {
      _sm: null, n: 0, l: 0, getUserId() { return "@gm:hs"; },
      async sendEvent(c, t, co) {
        bridge.n++; bridge.l++;
        const id = "$e" + bridge.n;
        sent.push({ t, v: co && co.v, id });
        const raw = { event_id: id, room_id: "!r:hs", type: "m.room.message", sender: "@gm:hs", senderRank: 100,
          ts: 1000 + bridge.n, l: bridge.l, content: { body: JSON.stringify(Object.assign({}, co, { t, l: bridge.l, dv: 2 })) } };
        if (t === "ddjp.dj.join" && co && co.v === "BBBBBBBBBBB") answers[id] = { status: "none", reason: "no-answer" };
        else { answers[id] = { status: "yes" }; setImmediate(() => bridge._sm.ingest(raw)); }
        return { eventId: id, l: bridge.l };
      },
      awaitAnswer(id) { return new Promise((r) => setImmediate(() => r(answers[id] || { status: "none" }))); },
    };
    const storage = (() => { const m = {}; return { save(k, v) { m[k] = JSON.parse(JSON.stringify(v)); },
      load(k) { return m[k] ? JSON.parse(JSON.stringify(m[k])) : null; }, remove(k) { delete m[k]; } }; })();
    const sb = loadInContext(["core/logger.js", "core/store.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
      "backends/backend1/streammanager.js", "core/playlistdoc.js", "features/queue.js", "features/userqueue.js"],
      { Date, URL, MatrixBridge: bridge, StorageIO: storage, setImmediate, setTimeout, clearTimeout });
    bridge._sm = sb.StreamManager;
    sb.UserQueue.setClock({ set: (fn) => setTimeout(fn, 0), clear: (id) => clearTimeout(id) });
    const { Queue, UserQueue } = sb;
    Queue.init("!ev:hs"); UserQueue.init("!r:hs"); await settle(); UserQueue.resync(); await settle();
    UserQueue.add("https://www.youtube.com/watch?v=BBBBBBBBBBB");
    UserQueue.joinRoomQueue();
    for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 5)); await settle(); }
    const tries = sent.filter((x) => x.t === "ddjp.dj.join" && x.v === "BBBBBBBBBBB").length;
    ok(tries === 2, "H: a join with no answer is retried ONCE — never silently forever, never endlessly", tries);
    ok(UserQueue.isActive() === false,
      "H: and then released: I am not in the rotation, so Join comes back instead of a Leave for a queue " +
      "I am not in — the bot-501 room sat silent behind exactly this", UserQueue.isActive());
    ok(UserQueue.items().length === 1 && (UserQueue.lastFailure() || {}).videoId === "BBBBBBBBBBB",
      "H: the song stays in my list, and the failure is there to show", { items: UserQueue.items().length, last: UserQueue.lastFailure() });

    // A LOST VOTE UN-PRESSES ITS BUTTON.
    const rb = { sent: [], getUserId: () => "@me:hs",
      async sendEvent(c, t, co) { rb.sent.push(t); return { eventId: "$v" + rb.sent.length }; },
      awaitAnswer() { return Promise.resolve({ status: "none" }); } };
    const rs = loadInContext(["core/logger.js", "features/reactions.js"], {
      MatrixBridge: rb, setImmediate, setTimeout, clearTimeout,
      StreamManager: { getState: () => ({ nowPlaying: { pi: "$song" } }), on: () => {}, off: () => {} } });
    rs.Reactions.init("!ev:hs");
    await rs.Reactions.vote();
    ok(rs.Reactions.hasVoted() === true, "H: APPLIED — the button lights at once, so a double-click cannot double-send");
    await settle();
    ok(rb.sent.length === 2 && rs.Reactions.hasVoted() === false,
      "H: a vote with no answer is retried once while the song plays, then the button UN-PRESSES — it " +
      "used to stay lit forever for a vote that never counted", { sends: rb.sent.length, lit: rs.Reactions.hasVoted() });

    // A SKIP REPORTS THE ROOM'S REFUSAL.
    const sk = { getUserId: () => "@me:hs", async sendEvent() { return { eventId: "$sk" }; },
      awaitAnswer() { return Promise.resolve({ status: "no", reason: "stale parent — the song had moved on" }); } };
    const ss = loadInContext(["core/logger.js", "features/skip.js"], {
      MatrixBridge: sk, Capabilities: { can: () => ({ permitted: true }) }, Room: { getMyRank: () => 40 },
      StreamManager: { getState: () => ({ nowPlaying: { pi: "$song", song: { videoId: "x" } } }), on: () => {}, off: () => {} },
      setTimeout, clearTimeout });
    ss.Skip.init("!ev:hs");
    const res = await ss.Skip.skip();
    ok(res.ok === false && /stale parent/.test(res.reason),
      "H: a skip the room refused says the room's own reason, not a guess after a fixed 4-second watch", res);
  })();

  // ── J — ONE "NEXT SONG" IN FLIGHT PER SONG (J70) ───────────────────────────────────────────
  // The owner's `?v=472` run: with the bot's tab asleep, the owner's app sent the same advance 17 times
  // in 34 s — `_advancing` clears when the send resolves, and the 2-second tick sends again until
  // the room moves. The real Playback, on the harness shape `check-end-of-song` uses: a song ends,
  // the tick keeps firing, and the answer is held back. With answers: one send. Without (the
  // CONTROL, the old behaviour every transport without `awaitAnswer` keeps): the repeat.
  await (async () => {
    const mk = (withAnswers) => {
      let now = 0, release = null;
      const timers = [], sends = [];
      const np = { dj: "@a:hs", song: { videoId: "AAAAAAAAAAA" }, pi: "$p1", startedAt: 0,
        settings: { maxLen: 600, minLen: 10, vouchJitter: 1000, minGate: 8000, graceMs: 1000, presendMs: 300 } };
      const state = () => ({ nowPlaying: np, rotation: [{ user: "@a:hs", pending: [] }], settings: np.settings,
        advance: { pi: np.pi, gateLenSec: null, earliestAt: 0, ceilingAt: 600000 } });
      const bridge = { async sendEvent(c, t) { sends.push(t); return { eventId: "$adv" + sends.length, l: sends.length }; },
                       mayAdvance: () => ({ ok: true }) };
      if (withAnswers) {
        bridge.awaitAnswer = () => new Promise((r) => { release = r; });
        bridge.answerDeadlineMs = () => 22000;
      }
      const sb = loadInContext(["features/playback.js"], {
        Date: { now: () => now },
        Math: { random: () => 0, floor: Math.floor, min: Math.min, max: Math.max, round: Math.round },
        setTimeout: (fn, ms) => { timers.push({ fn: fn, at: now + (ms || 0) }); return timers.length; },
        clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
        StreamManager: { getState: state, on: () => {}, off: () => {} },
        MatrixBridge: bridge,
        Capabilities: { staggerMs: () => 0, rankNameOf: () => "uncategorized" },
        Logger: { debug() {}, info() {}, warn() {}, error() {} },
      });
      sb.Playback.initWiring("!ev:hs");
      const runDue = async () => {
        for (let k = 0; k < 50; k++) {
          const due = timers.filter((x) => x.at <= now && !x.done);
          if (!due.length) break;
          for (const x of due) { x.done = true; await x.fn(); }
        }
        await settle();
      };
      return { P: sb.Playback, sends, at: (t) => { now = t; }, runDue, tick: () => sb.Playback._tick(),
               answer: (a) => { if (release) release(a); } };
    };
    const drive = async (w, until) => {
      w.P.setDuration("AAAAAAAAAAA", 200);
      w.at(200000); w.P.notifyEnded("AAAAAAAAAAA"); await w.runDue();
      for (let t = 202000; t <= until; t += 2000) { w.at(t); w.tick(); await w.runDue(); }
    };
    const old = mk(false);
    await drive(old, 220000);
    ok(old.sends.length >= 3,
      "J CONTROL: without answers the app re-sends the advance on every tick until the room moves — " +
      "the bot-501 shape, so the row below measures the gate and not a quiet harness", old.sends.length);
    const w = mk(true);
    await drive(w, 220000);
    ok(w.sends.length === 1,
      "J: with answers, ONE advance is in flight for a song until its answer comes back — not one per " +
      "2-second tick (bot-501: 17 in 34 s while the bot slept)", w.sends.length);
    w.answer({ status: "none", reason: "no-answer" });
    await settle();
    w.at(222000); w.tick(); await w.runDue();
    ok(w.sends.length === 1, "J: after a no-answer the next waits out the resend spacing", w.sends.length);
    w.at(228000); w.tick(); w.at(228400); await w.runDue();   // past the 300 ms pre-send pause
    ok(w.sends.length === 2, "J: and then the backup goes — the room never freezes on a lost advance", w.sends.length);
  })();

  // ── I — A BUSY SONG, MEASURED ──────────────────────────────────────────────────────────────
  attempt("I", () => {
    const w = authority();
    // 12 listeners: everyone reports a length (instant), 10 vote, 3 save, 2 queue a song, 1 advance.
    for (let i = 0; i < 12; i++) { w.set(1000 + i * 50); w.A.submit(act(w.A, "ddjp.media.len", "@l" + i + ":hs", { v: "x", d: 200 })); }
    for (let i = 0; i < 10; i++) { w.set(2000 + i * 200); w.A.submit(act(w.A, "ddjp.dj.vote", "@l" + i + ":hs", { p: "$song" })); }
    for (let i = 0; i < 3; i++) { w.set(4500 + i * 100); w.A.submit(act(w.A, "ddjp.dj.save", "@l" + i + ":hs", { p: "$song" })); }
    for (let i = 0; i < 2; i++) { w.set(5000 + i * 100); w.A.submit(act(w.A, "ddjp.dj.join", "@l" + i + ":hs", { v: "q" + i + "qqqqqqqqqq".slice(0, 9) })); }
    for (let t = 5000; t <= 12000; t += 250) { w.set(t); w.A.tick(); }
    w.set(200000); w.A.submit(act(w.A, "ddjp.dj.play", "@l0:hs", { p: "$song" }));
    const grouped = w.out.filter((x) => x.type === "ddjp.batch").length;
    const acts = 12 + 10 + 3 + 2 + 1;
    console.log("[bot-answers] measured — one busy song: " + acts + " acts from 12 listeners cost " + w.out.length +
      " bot messages (" + grouped + " grouped, " + (w.out.length - grouped) + " instant)");
    ok(grouped <= 3, "I: the fifteen grouped acts of a busy song travel in at most three messages", grouped);
  });

  if (failed) {
    console.log("[bot-answers] FAIL — " + failed + " of " + checks + " assertions failed");
    process.exit(1);
  }
  console.log("[bot-answers] PASS — every request is answered, on a schedule one table decides (J65, " + checks +
    " assertions): the table checks itself; grouped acts wait for their deadline, an instant act takes the group with " +
    "it and ten leave at once; a song's votes cost one message; merges still answer; the budget holds groups and " +
    "never an instant act; refusals are answered with the room's reason, stale acts dropped, floods refused, and " +
    "every request counted once; the transport answers yes, no or none in both engines; and the app retries once, " +
    "releases a wedged join, un-presses a lost vote and reports a refused skip");
})();
