// tests/check-bot-relay.js
// SUBJECT: backends/backend2/authority.js, backends/backend2/runner.js, backends/backend2/streammanager.js, backends/backend2/transport.js, backends/backend2/checkpoint.js, backends/backend1/matrixbridge.js, backends/backend1/statederiver.js
//
// WALL: A BOT ROOM LOSES NOTHING IT WAS GIVEN (J64). Every part drives the REAL modules — the
// runner, the authority, the bot door AND the shared door behind it, the reducer, History — because
// the defects this file exists for all passed guards whose stand-ins agreed with the mistake:
// a batch fixture whose intents carried no `l` (real ones always do), a door replaced by a
// recorder (so the backdating rule never ran), a raw built with `origin_server_ts` (the real fan-out
// carries `ts`), an `onAuthorReady` double that fired once (the real one fires on EVERY return to
// LIVE). Shapes here are taken from the real sources, and the events in PART A are the ones the
// owner's bot-501 room actually lost.
//
//   A  a grouped act is never refused at the door as backdated, whatever an instant relay did in
//      the meantime — the bot-501 window (join l=33 behind media.len 35, play.len 36, media.len 37)
//   B  a group of more than ten keeps its arrival order (members sort by id, and "#10" < "#2")
//   C  held intents are released on EVERY return to live, not only the first
//   D  the runner's announcement carries no local-clock stamp
//   E  a grouped message reaches song history whole: `normaliseAll`, and the transport's history
//      paths route through one helper that uses it
//   F  the bot's checkpoint holds the room's real starting state, and song history folded from it
//      finds the next song
//   G  in a bot room, a request written to the intents channel is ranked by the person's power
//      level, not by the channel (which is the lowest rung for everybody)
//   H  a settings request is handled once, by the bot's own handler, and never relayed
//   I  a bot room's save-to-file produces a real file the importer reads back

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load.js");

let failed = 0, checks = 0;
function ok(cond, msg, got) {
  checks++;
  if (!cond) {
    failed++;
    console.log("[bot-relay] FAIL — " + msg);
    if (got !== undefined) { try { console.log("      got " + JSON.stringify(got)); } catch (e) { console.log("      got (unprintable)"); } }
  }
}
function attempt(label, fn) {
  try { return fn(); } catch (e) { ok(false, label + " threw: " + (e && e.message)); return null; }
}

const DOOR = [
  "core/logger.js",
  "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/eventcache.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend1/activity.js", "backends/backend2/streammanager.js", "backends/backend2/authority.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/history.js",
];
const OWNER = "@inspector-gm:matrix.org", BOT = "@inspector420-ddjp:matrix.org", P = "@inspectoronline:matrix.org";
const LOG = "!events_owner", SET = "!settings_owner", INT = "!events_uncategorized";
const url = (v) => "https://www.youtube.com/watch?v=" + v;
const join = (v, l) => ({ v: v, u: url(v), t: "ddjp.dj.join", l: l, dv: 2, hv: 1 });   // as the wire carries it

// ── A WORLD: the real authority feeding the real bot door, through a transport stand-in whose
// SHAPE is the real `sendEvent`'s — `Object.assign({}, content, { t: type, l: tickOutbound(), dv: 2 })`
// — and whose clock follows the real rule: every `l` seen raises it, every send ticks past it.
function relayWorld(extraFiles) {
  const warns = [];
  const sb = loadInContext(DOOR.concat(extraFiles || []), { Date, Math, JSON, Promise, setTimeout, clearTimeout });
  sb.Logger.warn = (m) => warns.push(String(m));
  sb.Logger.info = () => {}; sb.Logger.debug = () => {};
  const D = sb.B2StreamManager, A = sb.B2Authority;
  D.setFoldScope({ events_owner: LOG, settings_owner: SET });
  let clock = 0, ts = 1790815600000, n = 0;
  const seen = (l) => { if (typeof l === "number" && l > clock) clock = l; };
  const deliver = (room, body, sender) => {
    seen(body.l);
    D.ingest({ type: "m.room.message", event_id: "$c" + (++n), room_id: room, sender: sender || BOT,
               ts: (ts += 500), content: { body: JSON.stringify(body) } });
  };
  const sends = [];
  A.reset();
  A.attach((type, payload) => {
    const body = Object.assign({}, payload, { t: type, l: ++clock, dv: 2 });
    sends.push(type);
    deliver(LOG, body);
    return Promise.resolve({ eventId: "$x" + n, l: body.l });
  }, { windowMs: 1000 });
  const relay = (intent, actor, rank) => { seen(intent.l); return A.submit(A.stamp(intent, actor, rank, "$i" + (++n), null)); };
  const mine = (who) => { const r = (D.getState().rotation || []).find((x) => x.user === who); return r ? r.pending.map((p) => p.videoId) : null; };
  return { sb, D, A, warns, deliver, relay, sends, mine };
}

(async () => {
  // ── PART A — THE BOT-501 WINDOW, END TO END ─────────────────────────────────────────────────
  attempt("A", () => {
    const w = relayWorld();
    const S = w.sb.StateDeriver.defaultSettings();
    w.deliver(SET, { t: "ddjp.room.settings", s: S, l: 1, dv: 2, hv: 1 }, OWNER);   // owner-direct, as in §2a
    w.relay(join("nixfjOuofqQ", 5), OWNER, 100);
    w.relay(join("-dbX4eAk7fI", 6), OWNER, 100);
    w.A.flush();
    w.relay({ p: null, t: "ddjp.dj.play", l: 8, dv: 2, hv: 1, pHash: null }, OWNER, 100);
    w.A.tick();   // J76: it leaves at the next opening
    ok(JSON.stringify(w.mine(OWNER)) === JSON.stringify(["-dbX4eAk7fI"]),
      "A: APPLIED — the room's opening folds through the real doors (gm playing, one song buffered), " +
      "so a missing song below is about the window and not the harness", w.mine(OWNER));

    const before = w.sends.length;
    w.relay(join("-Ex23WvD1Zo", 33), OWNER, 100);                                       // grouped
    w.relay({ v: "T4Cv5I4mTRM", d: 255, t: "ddjp.media.len", l: 34, dv: 2, hv: 1 }, OWNER, 100);   // instant
    w.relay({ pi: "$pi", sec: 255, t: "ddjp.play.len", l: 35, dv: 2, hv: 1 }, OWNER, 100);          // instant
    w.relay({ v: "T4Cv5I4mTRM", d: 255, t: "ddjp.media.len", l: 34, dv: 2, hv: 1 }, P, 0);          // instant
    // CHANGED BY J76: nothing overtakes, and lengths group (Q2) — so the case this row set up (instant relays out ahead of
    // a waiting group) cannot happen any more. What it guarded stays below: positions are minted when the message is sent.
    ok(w.sends.length === before, "A: nothing leaves between openings (J76)", w.sends.slice(before));
    w.A.flush();   // the group's wait passes: it leaves at an opening
    ok(w.sends.length - before === 1 && w.sends[before] === "ddjp.batch", "A: the four leave together, in one message, the group first, in accepted order",
      w.sends.slice(before));
    const backdated = w.warns.filter((m) => /REFUSED AT THE DOOR/.test(m) && /backdated/.test(m));
    ok(backdated.length === 0,
      "A: a grouped act is never refused at the door as backdated — the join bot-501 lost at l=33. Its " +
      "position must be the group's own, minted when the group is sent, not the author's", backdated);
    ok((w.mine(OWNER) || []).indexOf("-Ex23WvD1Zo") >= 0,
      "A: and the song is in gm's buffer", w.mine(OWNER));

    const stamped = w.A.stamp(join("abcdefghijk", 77), OWNER, 100, "$i", null);
    ok(stamped.l === undefined,
      "A: a stamped act carries no position of its own — the transport stamps the message it travels " +
      "in, and an author's `l` leaking through is what the door refused", stamped.l);
  });

  // ── PART B — A GROUP LARGER THAN TEN KEEPS ITS ORDER ────────────────────────────────────────
  attempt("B", () => {
    const w = relayWorld();
    w.deliver(SET, { t: "ddjp.room.settings", s: w.sb.StateDeriver.defaultSettings(), l: 1, dv: 2, hv: 1 }, OWNER);
    const users = [];
    for (let i = 0; i < w.A.POLICY.maxPerMessage + 2; i++) {
      const u = "@u" + String(i).padStart(2, "0") + ":hs";
      users.push(u);
      w.relay(join("song" + String(i).padStart(2, "0") + "xxxxx", 10 + i), u, 0);
    }
    // Since J65 a group of ten leaves at once (the "full" trigger), so ten go out as one message and
    // two wait — the order must hold ACROSS the two messages as well as inside each.
    w.A.tick();   // J76: a full group is due at once, and leaves at the next opening — one message an opening
    ok(w.A.pending() === 2 && w.sends.filter((t) => t === "ddjp.batch").length === 1,
      "B: APPLIED — a full message's worth (POLICY.maxPerMessage, 20 since J77) left as one message at the next opening, two still wait",
      { pending: w.A.pending(), batches: w.sends.filter((t) => t === "ddjp.batch").length });
    w.A.flush();
    const order = (w.D.getState().rotation || []).map((r) => r.user);
    ok(order.length === users.length, "B: every one lands (a full message's worth and two more — J77: counted, not copied)", order.length);
    ok(JSON.stringify(order) === JSON.stringify(users),
      "B: in the order they arrived. Members of one message share its position and sort by id, and " +
      "ids compare as text — \"#10\" before \"#2\" — so a message may carry at most ten", order);
  });

  // ── PARTS C, D, H — THE RUNNER, WITH AN onAuthorReady SHAPED LIKE THE REAL ONE ──────────────
  // The real `MatrixBridge.onAuthorReady(fn)` subscribes `fn` to Session.onChange and calls it on
  // EVERY transition to LIVE (backends/backend1/matrixbridge.js), so this double keeps every fn and
  // calls them all each time. A double that fired once is how the second return to live went untested.
  attempt("C/D/H", () => {
    const ctx = { console, sent: [], live: false, ready: [] };
    vm.createContext(ctx);
    ctx.Logger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
    ctx.setInterval = () => 0; ctx.clearInterval = () => {};
    ctx.Ranks = { levelOf: (n) => (n === "owner" ? 99 : 0) };
    ctx.Capabilities = { can: () => ({ permitted: true, reason: null }) };
    ctx.StreamManager = { getState: () => ({ settings: {} }), getLog: () => [] };
    ctx.Backends = { register: () => {}, active: () => "backend2", resolveMode: () => "backend2" };
    ctx.B2Checkpoint = { TYPE: "ddjp.checkpoint", floor: () => null, floorAt: () => null, seal: () => ({ ok: false }) };
    ctx.MatrixBridge = {
      getMyPowerLevel: () => 99, getUserEffectiveRank: () => 40,
      getCreateContent: () => ({ ddjp_mode: "backend2" }),
      onRawEvent: () => {}, offRawEvent: () => {},
      mayAuthor: () => (ctx.live ? { ok: true } : { ok: false, reason: "not-live" }),
      onAuthorReady: (fn) => { ctx.ready.push(fn); },
      sendEvent: (room, type, c) => { ctx.sent.push({ room, type, body: c }); return Promise.resolve({ eventId: "$s", l: 0 }); },
    };
    for (const f of ["backends/backend2/authority.js", "backends/backend2/runner.js"]) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
    }
    vm.runInContext("globalThis.R = B2Runner; globalThis.A = B2Authority;", ctx);
    const goLive = () => { ctx.live = true; for (const fn of ctx.ready.slice()) fn(); };
    // the raw the real fan-out builds (`_ingestSpineEvent`): `ts`, never `origin_server_ts`
    let k = 0;
    const raw = (body) => ({ type: "m.room.message", event_id: "$in" + (++k), room_id: INT, sender: "@a:hs",
      ts: 1790815700000 + k, content: { body: JSON.stringify(body) }, l: body.l, ddjpType: body.t, ddjpBody: body, senderRank: 0 });

    ctx.R.start({ channels: { events_uncategorized: INT, events_owner: LOG }, spaceId: "!s:hs" });
    goLive();
    for (let g = 0; g < 20 && ctx.A.pending(); g++) ctx.A.tick();   // J76: the runner's writes leave at gate openings
    ok(ctx.sent.length >= 1 && ctx.sent[0].type === "ddjp.bot.here",
      "C: APPLIED — the runner announced on its first return to live", ctx.sent.map((x) => x.type));
    ok(ctx.sent[0] && !Object.prototype.hasOwnProperty.call(ctx.sent[0].body, "at"),
      "D: the announcement carries no `at`. It read this device's `Date.now()`, and the bot door turns " +
      "`at` into the event's time — a local clock standing in for a server stamp", ctx.sent[0] && ctx.sent[0].body);

    ctx.live = false;
    // An instant act that is relayed. (A length report was used here until J66 made the display-only
    // `ddjp.media.len` accepted-and-not-relayed, which left nothing to see go out.)
    ctx.R._onRaw(raw({ p: "$song", t: "ddjp.dj.skip", l: 40, dv: 2, hv: 1 }));
    ok(ctx.R.stats().held === 1, "C: APPLIED — an intent arriving while not live is held", ctx.R.stats());
    const sentBefore = ctx.sent.length;
    goLive();
    for (let g = 0; g < 20 && ctx.A.pending(); g++) ctx.A.tick();   // J76: the runner's writes leave at gate openings
    ok(ctx.R.stats().held === 0 && ctx.sent.length > sentBefore,
      "C: and the SECOND return to live releases it at once, not the next once-a-minute beat. Bot-501 " +
      "waited until 20:47:49 and 21:07:26 for exactly this", { held: ctx.R.stats().held, newSends: ctx.sent.length - sentBefore });

    const n0 = ctx.sent.length;
    ctx.R._onRaw(raw({ s: { maxLen: 300 }, t: "ddjp.bot.request", l: 41, dv: 2, hv: 1 }));
    ctx.A.flush();
    const relayedRequest = ctx.sent.slice(n0).filter((x) => x.type === "ddjp.bot.request" ||
      (x.type === "ddjp.batch" && (x.body.evs || []).some((e) => e.t === "ddjp.bot.request")));
    ok(ctx.R.stats().seen >= 2, "H: APPLIED — the runner saw the request", ctx.R.stats());
    ok(relayedRequest.length === 0,
      "H: a settings request is never relayed. The bot's own handler reads the person's request where " +
      "it was written; a relayed copy arrives FROM THE BOT, and a handler that ever read it would " +
      "grant anybody's request at the bot's rung", relayedRequest);
  });

  // ── PART E — A GROUPED MESSAGE REACHES SONG HISTORY WHOLE ───────────────────────────────────
  attempt("E", () => {
    const w = relayWorld();
    const D = w.D, H = w.sb.History;
    let n = 0;
    // Real song spacing: the second play lands 300 s after the first, past the room's gate.
    const raw = (room, body, sender, ts) => ({ type: "m.room.message", event_id: "$h" + (++n), room_id: room,
      sender: sender || BOT, ts: ts, content: { body: JSON.stringify(body) } });
    const rel = (i) => Object.assign({}, i, { actor: OWNER, rank: 100, src: "$s" + n, at: null });
    const raws = [
      raw(SET, { t: "ddjp.room.settings", s: w.sb.StateDeriver.defaultSettings(), l: 1, dv: 2, hv: 1 }, OWNER, 1000),
      raw(LOG, { t: "ddjp.batch", l: 7, dv: 2, hv: 1, evs: [rel(join("nixfjOuofqQ", 5)), rel(join("-dbX4eAk7fI", 6))] }, BOT, 2000),
    ];
    raws.push(raw(LOG, rel({ p: null, t: "ddjp.dj.play", l: 9, dv: 2, hv: 1 }), BOT, 3000));
    raws.push(raw(LOG, rel({ p: raws[2].event_id, t: "ddjp.dj.play", l: 22, dv: 2, hv: 1 }), BOT, 303000));
    for (const r of raws) D.ingest(r);
    const live = (D.getState().history || []).map((h) => h.videoId);
    ok(live.length === 2, "E: APPLIED — the live fold plays both songs from the one grouped message", live);

    ok(typeof D.normaliseAll === "function", "E: the bot door offers `normaliseAll`", typeof D.normaliseAll);
    if (typeof D.normaliseAll !== "function") return;
    ok(D.normaliseAll(raws[1]).length === 2,
      "E: and it returns EVERY member of a group. `normalise` answers one event, so every caller that " +
      "converted a held or paged raw through it saw a group's first member only", D.normaliseAll(raws[1]).length);
    ok(typeof w.sb.B1StreamManager.normaliseAll === "function" && w.sb.B1StreamManager.normaliseAll(raws[2]).length === 1,
      "E: the shared door answers the same question — a list of one — so callers need no engine branch");
    H.reset();
    H.ingest(raws.flatMap((r) => D.normaliseAll(r)).filter((e) => typeof e.l === "number"), undefined);
    const rebuilt = H.recent(10).map((h) => h.videoId);
    ok(rebuilt.length === 2, "E: song history rebuilt from those raws has both songs, as the room played them", rebuilt);

    // THE TRANSPORT'S HISTORY PATHS. They live inside functions that need a live SDK client, so the
    // conversion is ONE named helper: it is extracted from the source and RUN against the real bot
    // door, and the call sites are read as text — which proves they are spelled, not that they run,
    // and is labelled so here.
    const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
    const at = src.indexOf("function _normaliseAll(");
    ok(at >= 0, "E: the transport has one conversion helper, `_normaliseAll`");
    if (at < 0) return;
    let depth = 0, end = -1;
    for (let i = src.indexOf("{", at); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const hctx = { StreamManager: D };
    vm.createContext(hctx);
    vm.runInContext(src.slice(at, end) + "; globalThis.f = _normaliseAll;", hctx);
    ok(hctx.f(raws[1]).length === 2, "E: and the helper, RUN, hands back every member", hctx.f(raws[1]).length);
    // And the rule for which held checkpoint may anchor a stretch of history, extracted and RUN
    // against the real reducer: a real starting state anchors, a pre-J64 display state does not.
    const extract = (name) => {
      const a = src.indexOf("function " + name + "(");
      if (a < 0) return null;
      let d = 0;
      for (let i = src.indexOf("{", a); i < src.length; i++) {
        if (src[i] === "{") d++;
        else if (src[i] === "}") { d--; if (d === 0) return src.slice(a, i + 1); }
      }
      return null;
    };
    const anchorSrc = extract("_isHistoryAnchor");
    ok(!!anchorSrc, "E: the rebuild's anchor rule is one named function, `_isHistoryAnchor`");
    if (anchorSrc) {
      const actx = { StateDeriver: w.sb.StateDeriver };
      vm.createContext(actx);
      vm.runInContext(anchorSrc + "; globalThis.g = _isHistoryAnchor;", actx);
      const ordered = D.getLog();
      const realSeed = w.sb.StateDeriver.buildSeed(ordered, undefined);
      const displaySeed = JSON.parse(JSON.stringify(D.getState()));
      const cpOf = (seed) => ({ type: "ddjp.checkpoint", content: { t: "ddjp.checkpoint", seed: seed, floorL: 22 } });
      ok(actx.g({ type: "ddjp.dj.play", content: { seed: realSeed, floorL: 22 } }) === false &&
         actx.g({ type: "ddjp.checkpoint", content: { t: "ddjp.checkpoint", seed: realSeed } }) === false,
        "E: and only a placed checkpoint is an anchor — another type, or one with no position, is not");
      ok(actx.g(cpOf(realSeed)) === true && actx.g(cpOf(displaySeed)) === false,
        "E: and RUN, it anchors on a real starting state and skips a display state", 
        { real: actx.g(cpOf(realSeed)), display: actx.g(cpOf(displaySeed)) });
      // ddjp_562: the rebuild still asks it first, then also requires the accepted floor chain (`&& _acc.has(...)`) — so the
      // check allows that conjunction; what it protects (a checkpoint is an anchor only if `_isHistoryAnchor` says so) is unchanged.
      // ddjp_563: the rebuild no longer reads anchors from held raws — it folds the ACCEPTED chain (Floor's memory) through History's
      // segment function; `_isHistoryAnchor` is still what decides a checkpoint wherever one is read from events (`_acceptedAnchors`).
      ok(/_isHistoryAnchor\(e\)/.test(src) && /History\.rebuildAnchored\(held, (?:await _resolvedChain\(\)|_acceptedChain\(\))\)/.test(src), "E (textual): the rebuild asks it");
    }
    const calls = (src.match(/_normaliseAll\(/g) || []).length - 1;
    ok(calls >= 5, "E (textual): the held-event, paging and range readers call the helper", calls);
    ok(!/StreamManager\.normalise\((raw|ev\.event \|\| ev)\)/.test(src),
      "E (textual): and none of them still converts a raw through `normalise` directly");
  });

  // ── PARTS F, I — THE BOT'S CHECKPOINT, AND SAVING IT TO A FILE ──────────────────────────────
  await (async () => {
    const sent = [];
    const sb = loadInContext(DOOR.concat(["backends/backend2/runner.js"]), {
      Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
      Backends: { register: () => {}, active: () => "backend2", resolveMode: (c) => (c && c.ddjp_mode) || null },
      MatrixBridge: {
        getMyPowerLevel: () => 99, getUserEffectiveRank: () => 100, getCreateContent: () => ({ ddjp_mode: "backend2" }),
        onRawEvent: () => {}, offRawEvent: () => {}, mayAuthor: () => ({ ok: true }), onAuthorReady: () => {},
        sendEvent: (room, type, c) => { sent.push({ room, type, c }); return Promise.resolve({ eventId: "$cp", l: 0 }); },
      },
    });
    sb.Logger.info = () => {}; sb.Logger.debug = () => {}; sb.Logger.warn = () => {};
    sb.StreamManager = sb.B2StreamManager;
    const D = sb.B2StreamManager, SD = sb.StateDeriver;
    D.setFoldScope({ events_owner: LOG, settings_owner: SET });
    let n = 0;
    const raw = (room, body, sender, ts) => ({ type: "m.room.message", event_id: "$f" + (++n), room_id: room,
      sender: sender || BOT, ts: ts || 1000 * n, content: { body: JSON.stringify(body) } });
    const rel = (i) => Object.assign({}, i, { actor: OWNER, rank: 100, src: "$s" + n, at: null });
    D.ingest(raw(SET, { t: "ddjp.room.settings", s: SD.defaultSettings(), l: 1, dv: 2, hv: 1 }, OWNER));
    D.ingest(raw(LOG, { t: "ddjp.batch", l: 7, dv: 2, hv: 1, evs: [rel(join("nixfjOuofqQ", 5)), rel(join("-dbX4eAk7fI", 6))] }));
    D.ingest(raw(LOG, rel({ p: null, t: "ddjp.dj.play", l: 9, dv: 2, hv: 1 })));
    const st = D.getState();
    ok(st.nowPlaying && st.nowPlaying.song && st.nowPlaying.song.videoId === "nixfjOuofqQ",
      "F: APPLIED — the room is playing its first song with the second buffered", st.nowPlaying);

    // THE CHECK BEFORE POSTING, DRIVEN: with a broken builder — one that drops the queue — the seed
    // no longer reproduces the log's fold, and nothing may be posted. An honest builder never fails
    // this, which is exactly why it has to be driven with a dishonest one or it is never shown to work.
    const realBuild = SD.buildSeed;
    attempt("F refuse", () => {
      SD.buildSeed = function (log, seed) { const out = realBuild(log, seed); out.members = {}; return out; };
      sb.B2Runner.start({ channels: { events_uncategorized: INT, events_owner: LOG }, spaceId: "!s:hs" });
      sb.B2Runner._maybeSeal();
    });
    SD.buildSeed = realBuild;
    ok(!sent.some((x) => x.type === "ddjp.checkpoint"),
      "F: a starting state that does not reproduce the room is never posted", sent.map((x) => x.type));
    attempt("F", () => { sb.B2Runner._maybeSeal(); });
    sb.B2Authority.flush();   // J76: the seal goes through the gate
    const cp = (sent.find((x) => x.type === "ddjp.checkpoint") || {}).c || null;
    ok(!!cp, "F: APPLIED — the runner sealed a checkpoint", sent.map((x) => x.type));
    if (cp) {
      ok(typeof SD.isSeed === "function" && SD.isSeed(cp.seed) === true,
        "F: and it holds the room's REAL starting state — the shape the reducer folds from — not the " +
        "display state, which nothing can resume from", cp.seed && Object.keys(cp.seed));
      const again = attempt("F derive", () => SD.derive([], cp.seed));
      ok(again && JSON.stringify((again.rotation || []).map((r) => [r.user, r.pending.map((p) => p.videoId)])) ===
                  JSON.stringify((st.rotation || []).map((r) => [r.user, r.pending.map((p) => p.videoId)])) &&
         again.nowPlaying && again.nowPlaying.pi === st.nowPlaying.pi,
        "F: folding from it reproduces the room — queue and now-playing", again && again.rotation);
      const H = sb.History;
      H.reset();
      H.ingest([{ eventId: "$next", type: "ddjp.dj.play", content: { p: st.nowPlaying.pi, t: "ddjp.dj.play", l: 30 },
                  l: 30, ts: 999999, sender: OWNER, senderRank: 100 }], cp.seed);
      ok(H.recent(5).some((h) => h.videoId === "-dbX4eAk7fI"),
        "F: and song history folded from it finds the next song — from the display state it found nothing",
        H.recent(5).map((h) => h.videoId));
      ok(typeof SD.isSeed === "function" && SD.isSeed(JSON.parse(JSON.stringify(st))) === false,
        "F: the display state is told apart, so a history rebuild can skip an old-style checkpoint " +
        "rather than fold from it");

      // ── I: save to file. The saves list reads `id`, `rank`, `floorL`, `at`, `thin`; the Save button
      // reads `{ ok, file, importable, snapshots, rank }` (ui/screens.js) — the shapes the normal door returns.
      D.ingest(raw(LOG, Object.assign({}, cp, { l: 10 }), BOT, 5000));
      const held = D.heldCheckpoints();
      const pick = Array.isArray(held) ? held[0] : null;
      ok(pick && typeof pick.id === "string" && typeof pick.floorL === "number" && pick.rank === "owner" && pick.thin === false,
        "I: the saves list gets the fields it shows — id, rank, position, thin", pick);
      const out = pick ? attempt("I export", () => D.exportCheckpoint(pick.id)) : null;
      ok(out && out.ok === true && out.file && out.file.mode === "bot" && out.snapshots >= 1,
        "I: Save returns `{ ok, file }` with a bot-mode file. It returned a bare file, so the button said " +
        "\"Could not export: unknown\"", out && { ok: out.ok, mode: out.file && out.file.mode, snapshots: out.snapshots });
      if (out && out.file) {
        const back = sb.CheckpointFormat.readFile(out.file, { keys: Object.keys(SD.defaultSettings()), ownerAuthored: true });
        ok(back && back.ok === true, "I: and the importer reads the file back", back);
      }
    }
  })();

  // ── PART G — THE REQUESTER'S RUNG IN A BOT ROOM ─────────────────────────────────────────────
  attempt("G", () => {
    const listeners = [];
    const g = { console };
    vm.createContext(g);
    g.Logger = { info: () => {}, error: () => {}, warn: () => {} };
    g.Backends = { register: () => {} };
    g.B2StreamManager = { setFoldScope: () => {} };
    g.B2Runner = { start: () => ({ ok: false, reason: "test" }) };
    g.B1MatrixBridge = {
      onRawEvent: (fn) => { if (listeners.indexOf(fn) < 0) listeners.push(fn); },
      offRawEvent: (fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
      getUserEffectiveRank: (space, ch, who) => (who === "@staff:hs" ? 60 : 0),
      getUserId: () => "@bot:hs", seedClock: () => {}, setRoomScope: () => {},
    };
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/transport.js"), "utf8"), g, { filename: "transport.js" });
    vm.runInContext("globalThis.T = B2MatrixBridge;", g);
    g.T.seedClock("!space:hs");
    g.T.setRoomScope({ events_uncategorized: INT, events_owner: LOG, chat_uncategorized: "!chat" });
    const got = [];
    const fn = (r) => got.push(r.senderRank);
    g.T.onRawEvent(fn);
    ok(listeners.length === 1, "G: APPLIED — one subscription reached the shared fan-out", listeners.length);
    for (const l of listeners.slice()) l({ room_id: INT, sender: "@staff:hs", senderRank: 0, ddjpType: "ddjp.bot.request" });
    for (const l of listeners.slice()) l({ room_id: "!chat", sender: "@staff:hs", senderRank: 0 });
    ok(got[0] === 60,
      "G: a request from the intents channel reaches subscribers ranked by the person's POWER LEVEL. " +
      "The channel says 0 for everybody in a bot room, so every delegated request was judged as the " +
      "lowest rung", got);
    ok(got[1] === 0, "G: a chat raw is left exactly as the transport stamped it", got);
    g.T.offRawEvent(fn);
    ok(listeners.length === 0, "G: and unsubscribing removes what subscribing added", listeners.length);
  });
  attempt("G consequence", () => {
    const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "backends/backend1/streammanager.js", "features/botsettings.js"],
      { Date, Math, JSON, Promise });
    const s = Object.assign(sb.StateDeriver.defaultSettings(), { botDelegation: { maxLen: "staff" } });
    const atStaff = sb.BotSettings.decide({ k: "maxLen", v: 300 }, 60, s);
    const atZero = sb.BotSettings.decide({ k: "maxLen", v: 300 }, 0, s);
    ok(atStaff.ok === true && atZero.ok === false,
      "G: why the rung matters — the same delegated request is granted at staff and refused at 0",
      { atStaff: atStaff.ok, atZero: atZero.ok });
  });

  // ── PART J — ONE VERDICT WHATEVER ROOM ARRIVES FIRST (J70) ─────────────────────────────────
  // The owner's `?v=472` run: the bot replayed `settings_owner` first, today's settings write (l=107,
  // stamped today) became the door's ONE head, and yesterday's backdated members passed; the
  // owner's app replayed the events first and refused them. The two disagreed from then on. The
  // same events, both orders, through the real doors.
  attempt("J", () => {
    const run = (settingsFirst, perRoom) => {
      const sb = loadInContext(DOOR, { Date, Math, JSON });
      const warns = [];
      sb.Logger.warn = (m) => warns.push(String(m)); sb.Logger.info = () => {}; sb.Logger.debug = () => {};
      const D = perRoom ? sb.B2StreamManager : null, B1 = sb.B1StreamManager;
      if (D) D.setFoldScope({ events_owner: LOG, settings_owner: SET });
      let n = 0;
      const raw = (room, body, sender, ts) => ({ type: "m.room.message", event_id: "$j" + (++n), room_id: room, sender, ts,
        content: { body: JSON.stringify(body) } });
      const rel = (i) => Object.assign({}, i, { actor: OWNER, rank: 100, src: "$s" + n, at: null });
      const S = sb.StateDeriver.defaultSettings();
      const set1 = raw(SET, { t: "ddjp.room.settings", s: S, l: 1, dv: 2, hv: 1 }, OWNER, 1000);
      const setLate = raw(SET, { t: "ddjp.room.settings", s: Object.assign({}, S, { bg: "x" }), l: 107, dv: 2, hv: 1 }, OWNER, 900000);
      const ev = [
        raw(LOG, { t: "ddjp.batch", l: 7, dv: 2, hv: 1, evs: [rel(join("aaaaaaaaaaa", 5))] }, BOT, 2000),
        raw(LOG, { t: "ddjp.media.len", v: "x", d: 200, l: 37, dv: 2, hv: 1, actor: OWNER, rank: 100, src: "$m", at: null }, BOT, 3000),
        raw(LOG, { t: "ddjp.batch", l: 38, dv: 2, hv: 1, evs: [rel(join("bbbbbbbbbbb", 33))] }, BOT, 3500),   // a pre-J64 member
      ];
      const seq = settingsFirst ? [set1, setLate].concat(ev) : [set1].concat(ev, [setLate]);
      for (const r of seq) (D || B1).ingest(r);
      const rot = (((D || B1).getState().rotation) || []).find((x) => x.user === OWNER);
      return { pending: rot ? rot.pending.map((p) => p.videoId) : null, scope: B1.doorScope ? B1.doorScope() : null };
    };
    const appOrder = run(false, true), botOrder = run(true, true);
    ok(JSON.stringify(appOrder.pending) === JSON.stringify(botOrder.pending),
      "J: in a bot room the door gives ONE verdict whichever room arrives first — the owner's app and the " +
      "bot disagreed about the whole room because they replayed the two rooms in different orders",
      { appOrder: appOrder.pending, botOrder: botOrder.pending });
    ok(JSON.stringify(botOrder.pending) === JSON.stringify(["aaaaaaaaaaa"]),
      "J: and it is the verdict the room's own order gives — the member minted after l=37 claims l=33 " +
      "inside the same room, so it is refused for everybody", botOrder.pending);
    ok(appOrder.scope === "per-room", "J: the bot engine turned the door's per-room head on", appOrder.scope);
    const shared = run(true, false);
    ok(shared.scope === "global",
      "J: a shared room keeps the ONE head, unchanged — that choice is open (J70), not made here", shared.scope);
  });

  if (failed) {
    console.log("[bot-relay] FAIL — " + failed + " of " + checks + " assertions failed");
    process.exit(1);
  }
  console.log("[bot-relay] PASS — a bot room loses nothing it was given (J64, " + checks + " assertions): " +
    "grouped acts are never refused as backdated and a group keeps its order; held intents go out on " +
    "every return to live; the announcement carries no local clock; a group reaches song history whole; " +
    "the bot's checkpoint is the room's real starting state and history folds from it; a request is " +
    "ranked by the person's power level and never relayed; and a save becomes a file the importer reads");
})();
