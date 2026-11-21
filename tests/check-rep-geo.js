// tests/check-rep-geo.js
// SUBJECT: features/rep-geo.js, features/rep-rules.js, features/rep-ports.js
//
// WALL: THE BOT AND BLOCKED SONGS (J153 (d), item 9, the owner's; `main/01-project.md` §9). The bot's prediction — where a
// song is blocked, against the countries of the people present — is the bot's alone and drives only what the room's three
// settings let it do: warn the DJ (`botBlockedWarn`, on), skip at a song's start (`botBlockedSkip`, off) when its minimums
// (`botBlockedRoads`) are met by RANKED people, and say so when it cannot. Driven on the REAL piece (`features/rep-geo.js`),
// started through the REAL `Rep.enter` and reaching the app only through the REAL ports (`features/rep-ports.js`), counting
// through the REAL rules (`RepRules.geoCount`), judging with the REAL country table's verdict (`Countries.blockedView`) and
// the REAL reducer's road rule (`StateDeriver.roadTableMet`, behind a StreamManager whose other answers are this world's).
// The doubles are what cannot run here, shaped from their sources: the lookup path's `fetchMany` and `geoStatus`
// (`features/metadata.js`), the skip (`features/skip.js`: `{ ok }`), the chat's `sendTo` (`{ ok }`), the room's main tier and
// its presence view (`features/room.js`), the levels, the clock, the stored countries (`Store.rep.loadCountries`).
//
//   A  WHERE IT RUNS: only on the room's bot tab, started by `Rep.enter` and stopped by `Rep.leave`; a second enter in the same
//      room keeps it; it looks every few seconds (its tick), short enough to see a start inside the decide window.
//   B  THE PREDICTION: people present with a country only — someone with a country who is not present is nobody here; the
//      warning counts unranked people while "Include unranked people's countries" is on and only ranked people when it is
//      off; the skip counts ranked people, always.
//   C  ONCE PER SONG PER DJ: a second look says nothing; the song leaving the queue and coming back is warned about again; the
//      same song under another DJ is that DJ's warning; a warning that did not arrive is tried again.
//   D  THE WORDS for each combination: what the bot will do (skip it when it starts, or nothing), whose countries, and the
//      line saying unranked people's countries are not counted.
//   E  THE SKIP AT A SONG'S START ONLY: inside the window with its answer, sent as the repeat sweep sends (token `region`),
//      once per playing, with one line; a song first seen late, an answer arriving after the window, a skip switched off, or
//      minimums met only by unranked people: no skip. A skip that does not take says no line.
//   F  NOTHING WITHOUT DATA: lookups off on this device → no lookup, no warning, no skip, and one muted line (H6) and one log
//      line, not one per look; no source answering → the line says so; no key for a source that wants one → the nudge; both
//      bot settings off → nothing looked up and no line.
//   G  THE LOOKUPS: the songs with no answer, asked together, under the room queue's list and with the server's time; a song
//      no source answered is not asked again until `RETRY_MS` has passed.
//   H  ONLY A CAUGHT-UP TAB ACTS: not caught up, nothing is asked or said.
//   T  STRIKES WITH THE FIX TIME (J153 (d)'s second half; his words, `main/01-project.md` §9; the supervisor's defaults): a
//      queued song meeting the minimums (ranked only) is warned about saying the bot will remove it, in whole minutes, floored;
//      its timer starts at that warning's DELIVERY (an undelivered one starts none and is tried again); when the DJ is next to
//      play — the head of the rotation, the song their first — and the full fix time has passed, with the minimums met NOW,
//      the bot sends the moderator's strike, once; it says so in one line only once the song is gone and not playing (one
//      that started first lost the race; one still queued after `SETTLE_MS` did not take and is tried again; one not sent is
//      tried again). Before the full time nothing is struck; nor is a DJ who is not next, nor with strikes off, nor by a tab
//      not caught up. After a strike the DJ's next song, if it will be struck too, is warned again and its timer starts over.
//      With warnings off only the songs it will strike are warned; a song warned before strikes were on is warned again when
//      they are; with the skip on too the words say so; a reload starts every timer over.
//   S  THE FIVE ROOM SETTINGS on the REAL reducer: the owner's defaults (warnings on, skips and strikes off, ten minutes, the
//      minimums at the blocked-for-some table's numbers), the minimums through the one road-list check, the switches' strict
//      check, the fix time inside its own row, and all read live (`Dials.LIVE`).
"use strict";
const { loadInContext } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rep-geo] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got).slice(0, 600) : "")); }
}
const J = (x) => JSON.stringify(x);
const SEC = 1000, MIN = 60 * SEC;
const T0 = 1800000000000;
const S1 = "yt:AAAAAAAAAAA", S2 = "yt:BBBBBBBBBBB", S3 = "yt:CCCCCCCCCCC";
const ROADS1 = [{ guestPlus: 1, vipPlus: 0 }];

// THE WORLD. `o` sets the room: who is present (`people`), each person's level (`levels`), the stored countries (`cc`), the
// saved answers a lookup returns (`geo`), the settings, the queue, the song playing, and what the lookup path and the chat say.
function world(o) {
  o = o || {};
  const st = {
    now: T0, sent: [], skips: [], asks: [], logs: [], live: true, acting: o.acting !== false,
    settings: Object.assign({ botBlockedWarn: true, botBlockedSkip: false, botBlockedRoads: ROADS1, repUnrankedCountries: true }, o.settings || {}),
    rotation: o.rotation || [], np: o.np || null, people: o.people || [], levels: o.levels || {}, cc: o.cc || {},
    geo: o.geo || {}, status: o.status || { on: true, keyless: [] }, reached: (o.reached === undefined) ? null : o.reached,
    deliver: (o.deliver === undefined) ? true : o.deliver, skipOk: (o.skipOk === undefined) ? true : o.skipOk, intervals: [],
    struck: [], strikeAnswer: (o.strikeAnswer === undefined) ? { eventId: "$st", l: 9 } : o.strikeAnswer,
  };
  const real = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const ctx = loadInContext(["core/countries.js", "features/rep-rules.js", "features/rep-ports.js", "features/rep-geo.js"], {
    StreamManager: {
      getState: () => ({ settings: st.settings, rotation: st.rotation, nowPlaying: st.np }),
      roadTableMet: (r, g, v) => real.StateDeriver.roadTableMet(r, g, v),
    },
    MetadataService: {
      fetchMany: (keys, now, ask) => {
        st.asks.push({ keys: keys.slice(), now: now, ask: ask });
        const answers = {};
        for (const k of keys) if (st.geo[k]) answers[k] = st.geo[k];
        const reached = (st.reached === null) ? 1 : st.reached;
        return Promise.resolve({ answers: answers, on: true, asked: keys.length, reached: reached });
      },
      geoStatus: () => st.status,
    },
    Skip: { skip: (k) => { st.skips.push(k); return Promise.resolve(st.skipOk ? { ok: true } : { ok: false, reason: "missed" }); } },
    // The moderator's strike (`features/queue.js` `strike(userId, songKey)`: the sent event's `{ eventId, l }`, or a refusal).
    Queue: { strike: (dj, k) => { st.struck.push([dj, k]); return Promise.resolve(st.strikeAnswer); } },
    Chat: { sendTo: (tier, text) => { st.sent.push({ tier, text }); return Promise.resolve(st.deliver ? { ok: true } : { ok: false, reason: "no" }); } },
    Room: { chatTiers: () => ({ mainId: "!main", tiers: [] }), presenceView: () => ({ people: st.people.map((u) => ({ userId: u })) }) },
    MatrixBridge: { getUserEffectiveRank: (sp, ch, u) => (typeof st.levels[u] === "number" ? st.levels[u] : 0), mayAuthor: () => ({ ok: st.live }),
      getUserId: () => "@bot:hs" },
    Capabilities: { atLeast: (lvl, name) => real.Ranks.atLeast(lvl, name) },
    ServerClock: { serverNow: () => st.now },
    Store: { rep: { loadCountries: () => Promise.resolve({ v: 1, cc: st.cc }) } },
    BotRuntime: { actingAsBot: () => st.acting },
    Logger: { info: (m) => st.logs.push(String(m)), warn: (m) => st.logs.push(String(m)) },
    setInterval: (f, ms) => { st.intervals.push(ms); return st.intervals.length; }, clearInterval: () => { st.intervals.push("cleared"); },
    Promise, Object, Array, JSON, Math, String, Number, Date,
  });
  const w = { st, G: ctx.RepGeo, Rep: ctx.Rep, R: ctx.RepRules };
  w.enter = () => w.Rep.enter({ spaceId: "!space", channels: { events_owner: "!own" } });
  w.look = () => w.G._lookForTest();
  w.lines = () => st.sent.map((x) => x.text);
  return w;
}
// The countries and levels most rows use: a guest in France, an unranked person in France, a VIP in Germany, and a guest in
// France who is NOT present.
const BASE = { people: ["@g:hs", "@u:hs", "@v:hs", "@dj:hs"], levels: { "@g:hs": 10, "@u:hs": 0, "@v:hs": 40, "@far:hs": 10, "@dj:hs": 20 },
  cc: { "@g:hs": "FR", "@u:hs": "FR", "@v:hs": "DE", "@far:hs": "FR" } };
const FR = { blocked: ["FR"], embeddable: true, checkedAt: T0, source: "proxynova" };
const FRDE = { blocked: ["DE", "FR"], embeddable: true, checkedAt: T0, source: "proxynova" };
const queue = (dj, keys) => [{ user: dj, pending: keys.map((k) => ({ songKey: k })) }];
const settle = () => new Promise((r) => setImmediate(r));

(async () => {
  // ── A — WHERE IT RUNS ────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world(Object.assign({}, BASE, { acting: false, rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR } }));
    w.enter();
    ok(w.G._stateForTest() === null && w.st.intervals.length === 0, "A: on a tab that is not the room's bot, `Rep.enter` starts nothing", w.G._stateForTest());
    w.st.acting = true;
    w.enter();
    const s = w.G._stateForTest();
    ok(s && s.spaceId === "!space" && s.tick === true && w.st.intervals[0] === w.G.TICK_MS && w.G.TICK_MS < w.G.DECIDE_MS,
      "A: on the bot's tab `Rep.enter` starts it, looking on a tick shorter than the decide window", { s, iv: w.st.intervals, tick: w.G.TICK_MS });
    w.enter();
    ok(w.st.intervals.filter((x) => typeof x === "number").length === 1, "A: a second enter in the same room keeps the one session", w.st.intervals);
    w.Rep.leave("the tab left the room");
    ok(w.G._stateForTest() === null && w.st.intervals.indexOf("cleared") >= 0 && w.st.logs.some((l) => /blocked songs — stopped — the tab left the room/.test(l)),
      "A: `Rep.leave` stops it and its tick, and says so", w.st.logs);
  }

  // ── B — THE PREDICTION ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR } }));
    w.enter(); await w.look(); await settle();
    ok(w.lines().length === 1 && /is blocked for 2 people here \(FR\)/.test(w.lines()[0]),
      "B: the warning counts the two present people in France — the guest and the unranked one — and not the one who is away", w.lines());
    const c = w.R.geoCount([{ user: "@g:hs", code: "FR" }, { user: "@u:hs", code: "FR" }, { user: "@v:hs", code: "DE" }, { user: "@g:hs", code: "FR" }],
      { "@g:hs": "guest", "@u:hs": null, "@v:hs": "vip" });
    ok(c.all.length === 3 && c.ranked.length === 2 && c.guests === 2 && c.vips === 1 && J(c.codes.all) === J(["DE", "FR"]) && J(c.codes.ranked) === J(["DE", "FR"]),
      "B: `RepRules.geoCount` counts distinct people, ranked ones per band (a VIP in both), the unranked in none, and each list's countries A to Z", c);
    const w2 = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: { repUnrankedCountries: false } }));
    w2.enter(); await w2.look(); await settle();
    ok(w2.lines().length === 1 && /is blocked for 1 person here \(FR\)/.test(w2.lines()[0]),
      "B: with \"Include unranked people's countries\" off, the warning counts the ranked person only", w2.lines());
    const w3 = world(Object.assign({}, BASE, { people: ["@u:hs"], rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: { repUnrankedCountries: false } }));
    w3.enter(); await w3.look(); await settle();
    ok(w3.lines().length === 0, "B: and a song blocked only for an unranked person then warns nobody", w3.lines());
    const w4 = world(Object.assign({}, BASE, { people: ["@v:hs", "@dj:hs"], rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR } }));
    w4.enter(); await w4.look(); await settle();
    ok(w4.lines().length === 0, "B CONTROL — a song blocked only where nobody present is warns nobody", w4.lines());
  }

  // ── C — ONCE PER SONG PER DJ ─────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1, S2]), geo: { [S1]: FR, [S2]: { blocked: [], embeddable: true, checkedAt: T0 } } }));
    w.enter(); await w.look(); await settle(); await w.look(); await settle();
    ok(w.lines().length === 1 && w.lines()[0].indexOf("AAAAAAAAAAA") > 0, "C: two looks, one warning — for the blocked song alone", w.lines());
    w.st.rotation = queue("@dj:hs", [S2]); await w.look(); await settle();
    w.st.rotation = queue("@dj:hs", [S2, S1]); await w.look(); await settle();
    ok(w.lines().length === 2, "C: the song leaving the queue and coming back is warned about again", w.lines());
    w.st.rotation = queue("@dj:hs", [S2, S1]).concat(queue("@dj2:hs", [S1])); await w.look(); await settle();
    ok(w.lines().length === 3 && w.lines()[2].indexOf("@dj2:hs") === 0, "C: the same song under another DJ is that DJ's own warning", w.lines());
    const u = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, deliver: false }));
    u.enter(); await u.look(); await settle();
    u.st.deliver = true; await u.look(); await settle();
    ok(u.st.sent.length === 2 && u.G._stateForTest().warned.length === 1, "C: a warning that did not arrive is tried again at the next look, then kept", u.st.sent.length);
  }

  // ── D — THE WORDS ────────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const say = async (settings, extra) => {
      const w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FRDE }, settings: settings }, extra || {}));
      w.enter(); await w.look(); await settle();
      return w.lines()[0] || null;
    };
    const none = await say({});
    ok(none === "@dj:hs — AAAAAAAAAAA is blocked for 3 people here (DE, FR). The bot won’t act on it.",
      "D: warnings on, skips off: the DJ, the song, how many, which countries, and that the bot won't act", none);
    const skip = await say({ botBlockedSkip: true });
    ok(skip === "@dj:hs — AAAAAAAAAAA is blocked for 3 people here (DE, FR). The bot will skip it when it starts.",
      "D: skips on and its minimums met by ranked people: the bot will skip it when it starts", skip);
    const unrankedOnly = await say({ botBlockedSkip: true }, { people: ["@u:hs", "@dj:hs"] });
    ok(unrankedOnly === "@dj:hs — AAAAAAAAAAA is blocked for 1 person here (FR). The bot won’t act on it.",
      "D: skips on but only an unranked person blocked: the warning says so and the bot won't act", unrankedOnly);
    const high = await say({ botBlockedSkip: true, botBlockedRoads: [{ guestPlus: 5, vipPlus: 0 }] });
    ok(/The bot won’t act on it\.$/.test(high || ""), "D: skips on but its minimums not met: the bot won't act", high);
    const leftOut = await say({ repUnrankedCountries: false, botBlockedSkip: true });
    ok(leftOut === "@dj:hs — AAAAAAAAAAA is blocked for 2 people here (DE, FR). The bot will skip it when it starts. Unranked people’s countries aren’t counted.",
      "D: unranked people's countries left out: the count is the ranked people's, and the line says so", leftOut);
    const off = await say({ botBlockedWarn: false, botBlockedSkip: true });
    ok(off === null, "D: warnings off: no warning line", off);
  }

  // ── E — THE SKIP AT A SONG'S START ONLY ──────────────────────────────────────────────────────────────────────────────
  {
    const np = (startedAt, k) => ({ pi: "$p1", dj: "@dj:hs", song: { songKey: k || S1 }, startedAt: startedAt });
    const run = async (o, looks) => {
      const w = world(Object.assign({}, BASE, { geo: { [S1]: FR }, settings: { botBlockedSkip: true, botBlockedWarn: false } }, o));
      w.enter();
      for (let i = 0; i < (looks || 1); i++) { await w.look(); await settle(); }
      return w;
    };
    const a = await run({ np: np(T0 - 3 * SEC) }, 2);
    ok(J(a.st.skips) === J(["region"]) && a.lines().length === 1 && a.lines()[0] === "Skipped AAAAAAAAAAA — it is blocked for 1 person here (FR).",
      "E: inside the window with its answer, the song is skipped once, tagged `region`, and one line says why (ranked people only)", { skips: a.st.skips, lines: a.lines() });
    ok(a.st.sent.every((x) => x.tier === "!main"), "E: the line goes to the room's main chat", a.st.sent);
    const late = await run({ np: np(T0 - 15 * SEC) });
    ok(late.st.skips.length === 0, "E: a song first seen after the window plays", late.st.skips);
    const w = world(Object.assign({}, BASE, { geo: {}, np: np(T0 - 2 * SEC), settings: { botBlockedSkip: true, botBlockedWarn: false } }));
    w.enter(); await w.look(); await settle();
    w.st.geo[S1] = FR; w.st.now = T0 + 9 * SEC; w.G._stateForTest(); await w.look(); await settle();
    ok(w.st.skips.length === 0 && w.G._stateForTest().tried[S1] === T0, "E PREMISE — no answer at the first look: nothing yet, and the song was asked", w.G._stateForTest());
    w.st.now = T0 + RETRY_PLUS(w); await w.look(); await settle();
    ok(w.st.skips.length === 0, "E: an answer that arrives after the window lets the song play", w.st.skips);
    const off = await run({ np: np(T0 - 3 * SEC), settings: { botBlockedSkip: false, botBlockedWarn: false } });
    ok(off.st.skips.length === 0, "E: skips switched off: no skip", off.st.skips);
    const unr = await run({ np: np(T0 - 3 * SEC), people: ["@u:hs"], settings: { botBlockedSkip: true, botBlockedWarn: false, botBlockedRoads: ROADS1 } });
    ok(unr.st.skips.length === 0, "E: blocked only for an unranked person: no skip, whatever \"Include unranked people's countries\" says", unr.st.skips);
    const lost = await run({ np: np(T0 - 3 * SEC), skipOk: false });
    ok(lost.st.skips.length === 1 && lost.lines().length === 0 && lost.st.logs.some((l) => /did not take — missed/.test(l)),
      "E: a skip that does not take posts no line, and the log says so", { lines: lost.lines(), logs: lost.st.logs });
  }

  // ── F — NOTHING WITHOUT DATA, AND NEVER SILENT ───────────────────────────────────────────────────────────────────────
  {
    const npNow = { pi: "$p1", dj: "@dj:hs", song: { songKey: S1 }, startedAt: T0 - 2 * SEC };
    const w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S2]), np: npNow, geo: { [S1]: FR, [S2]: FR },
      status: { on: false, keyless: [] }, settings: { botBlockedSkip: true } }));
    w.enter(); await w.look(); await settle(); await w.look(); await settle();
    ok(w.st.asks.length === 0 && w.st.sent.length === 0 && w.st.skips.length === 0, "F: lookups off on this device: nothing asked, no warning, no skip",
      { asks: w.st.asks.length, sent: w.st.sent.length, skips: w.st.skips.length });
    const note = w.Rep.roomNote();
    ok(note === "The bot can’t tell where songs are blocked: “Look up where songs are blocked” is off on this device, so it warns about and skips nothing.",
      "F: and `Rep.roomNote` (H6) carries the one muted line saying why", note);
    ok(w.st.logs.filter((l) => /REP: blocked songs — The bot can’t tell/.test(l)).length === 1, "F: the log says it once, not once per look", w.st.logs);
    const d = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: {}, reached: 0 }));
    d.enter(); await d.look(); await settle(); await d.look(); await settle();
    ok(/no source is answering/.test(d.Rep.roomNote() || "") && d.st.sent.length === 0, "F: no source answering: the line says so, and nothing is warned", d.Rep.roomNote());
    const k = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, status: { on: true, keyless: ["YouTube"] } }));
    k.enter(); await k.look(); await settle();
    ok(k.Rep.roomNote() === "No YouTube key on this device: the bot asks the other sources. Add one under “Where songs are blocked” to ask YouTube first." &&
       k.lines().length === 1, "F: no key for YouTube: the nudge is the line, and the bot still warns from the other sources", { note: k.Rep.roomNote(), lines: k.lines() });
    const n = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: { botBlockedWarn: false, botBlockedSkip: false },
      status: { on: false, keyless: ["YouTube"] } }));
    n.enter(); await n.look(); await settle();
    ok(n.st.asks.length === 0 && n.Rep.roomNote() === null && n.st.sent.length === 0, "F: both of the bot's settings off: nothing looked up, and no line", n.Rep.roomNote());
    const c = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR } }));
    c.enter(); await c.look(); await settle();
    ok(c.Rep.roomNote() === null && c.lines().length === 1, "F CONTROL — lookups on, a source answering, a key not wanted: no line, and the warning goes", c.Rep.roomNote());
  }

  // ── G — THE LOOKUPS ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1, S2]).concat(queue("@dj2:hs", [S3])),
      np: { pi: "$p0", dj: "@x:hs", song: { songKey: S3 }, startedAt: T0 - MIN }, geo: { [S1]: FR } }));
    w.enter(); await w.look(); await settle();
    ok(w.st.asks.length === 1 && J(w.st.asks[0].keys.slice().sort()) === J([S1, S2, S3]) && J(w.st.asks[0].ask) === J({ list: "room" }) && w.st.asks[0].now === T0,
      "G: the song playing and every queued song, each once, asked together under the room queue's list with the server's time", w.st.asks);
    await w.look(); await settle();
    ok(w.st.asks.length === 1, "G: a song with an answer is not asked again, and one no source answered is not asked at the next look", w.st.asks.length);
    w.st.now = T0 + w.G.RETRY_MS - SEC; await w.look(); await settle();
    ok(w.st.asks.length === 1, "G: nor just before `RETRY_MS`", w.st.asks.length);
    w.st.now = T0 + w.G.RETRY_MS; await w.look(); await settle();
    ok(w.st.asks.length === 2 && J(w.st.asks[1].keys.slice().sort()) === J([S2, S3]), "G: at `RETRY_MS` the unanswered songs are asked again — only they", w.st.asks);
  }

  // ── H — ONLY A CAUGHT-UP TAB ACTS ────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR },
      np: { pi: "$p1", dj: "@dj:hs", song: { songKey: S1 }, startedAt: T0 - 2 * SEC }, settings: { botBlockedSkip: true } }));
    w.st.live = false;
    w.enter(); await w.look(); await settle();
    ok(w.st.asks.length === 0 && w.st.sent.length === 0 && w.st.skips.length === 0, "H: not caught up: nothing asked, warned or skipped", w.st);
    w.st.live = true; await w.look(); await settle();
    ok(w.st.sent.length === 2 && w.st.skips.length === 1, "H CONTROL — caught up, the same look warns and skips", { sent: w.lines(), skips: w.st.skips });
  }

  // ── T — STRIKES WITH THE FIX TIME ────────────────────────────────────────────────────────────────────────────────────
  {
    const TS = { botBlockedStrike: true, botBlockedFixMs: 10 * MIN };
    const id = (dj, k) => dj + "\n" + k;
    const drop = (w, dj, k) => { for (const m of w.st.rotation) if (m.user === dj) m.pending = m.pending.filter((x) => x.songKey !== k); w.st.rotation = w.st.rotation.filter((m) => m.pending.length); };
    // T1 — the warning says the bot will remove it, and its delivery starts the timer.
    let w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1, S2]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    ok(w.lines().length === 1 && w.lines()[0] === "@dj:hs — AAAAAAAAAAA is blocked for 2 people here (FR). The bot will remove it when you\u2019re next to play unless you change it within 10 minutes.",
      "T: the warning says the bot will remove it when the DJ is next to play unless it is changed within the fix time", w.lines());
    ok(w.G._stateForTest().strikes[id("@dj:hs", S1)] === T0, "T: its delivery starts that song's timer, at the time it was delivered", w.G._stateForTest().strikes);
    w.st.now = T0 + 10 * MIN - 1; await w.look(); await settle();
    ok(w.st.struck.length === 0, "T: a moment before the full fix time, nothing is struck", w.st.struck);
    w.st.now = T0 + 10 * MIN; await w.look(); await settle();
    ok(J(w.st.struck) === J([["@dj:hs", S1]]), "T: the full fix time over, the DJ next to play, the bot sends the moderator's strike of that song", w.st.struck);
    ok(w.st.logs.some((l) => /blocked songs — striking yt:AAAAAAAAAAA from @dj:hs: blocked for 1 person ranked here \(FR\), the fix time over/.test(l)), "T: and its log says why", w.st.logs);
    ok(w.lines().length === 1, "T: no line while the song is still queued: a strike is said once it has happened", w.lines());
    await w.look(); await settle();
    ok(w.st.struck.length === 1, "T: sent once, not again at the next look", w.st.struck);
    drop(w, "@dj:hs", S1);
    w.st.now += 5 * SEC; await w.look(); await settle();
    ok(w.lines()[1] === "@dj:hs — AAAAAAAAAAA was removed from the queue: it is blocked for 1 person here (FR).",
      "T: once the song is gone and not playing, one line says so, counting ranked people as the skip's line does", w.lines());
    // T2 — not delivered: no timer, and the warning is tried again.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS, deliver: false }));
    w.enter(); await w.look(); await settle();
    ok(J(w.G._stateForTest().strikes) === J({}) && J(w.G._stateForTest().warned) === J([]), "T: a warning that did not arrive starts no timer, and is not marked", w.G._stateForTest());
    w.st.now = T0 + 20 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 0 && w.st.sent.length === 2, "T: so nothing is struck, however long, and the warning is tried again", { struck: w.st.struck, sent: w.st.sent.length });
    // T3 — after a strike, the DJ's next song, if it will be struck too, is warned again and its timer starts over.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1, S2]), geo: { [S1]: FR, [S2]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    ok(w.lines().length === 2 && J(Object.keys(w.G._stateForTest().strikes).sort()) === J([id("@dj:hs", S1), id("@dj:hs", S2)].sort()),
      "T PREMISE — both songs warned, both timers started", w.lines());
    w.st.now = T0 + 11 * MIN; await w.look(); await settle();
    drop(w, "@dj:hs", S1);
    w.st.now = T0 + 11 * MIN + 5 * SEC; await w.look(); await settle();
    ok(w.lines().length === 4 && /BBBBBBBBBBB is blocked for 2 people here \(FR\)\. The bot will remove it/.test(w.lines()[3]) &&
       w.G._stateForTest().strikes[id("@dj:hs", S2)] === T0 + 11 * MIN + 5 * SEC,
      "T: after the strike, the DJ's next song is warned again and its timer starts over at that warning", { lines: w.lines(), strikes: w.G._stateForTest().strikes });
    w.st.now = T0 + 12 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 1, "T: so it is not struck at once on the old timer", w.st.struck);
    // T4 — the song starting before the full time plays (nothing struck); a strike that loses the race says no line.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.st.now = T0 + 5 * MIN; w.st.rotation = []; w.st.np = { pi: "$p", dj: "@dj:hs", song: { songKey: S1 }, startedAt: T0 + 5 * MIN };
    await w.look(); await settle();
    ok(w.st.struck.length === 0 && w.lines().length === 1, "T: the song starting before the full fix time plays: nothing is struck, nothing said", { struck: w.st.struck, lines: w.lines() });
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.st.now = T0 + 10 * MIN; await w.look(); await settle();
    w.st.rotation = []; w.st.np = { pi: "$p", dj: "@dj:hs", song: { songKey: S1 }, startedAt: T0 + 10 * MIN };
    await w.look(); await settle();
    ok(w.st.struck.length === 1 && w.lines().length === 1 && w.st.logs.some((l) => /the strike of yt:AAAAAAAAAAA lost the race: it started first/.test(l)),
      "T: a strike the song's start beat says no line, only a log line", { lines: w.lines(), logs: w.st.logs.slice(-2) });
    // T5 — the minimums are re-checked at the strike: the ranked person blocked has left, nothing is struck.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.st.people = ["@u:hs", "@v:hs", "@dj:hs"]; w.st.now = T0 + 10 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 0, "T: the ranked person it is blocked for has left: the minimums are not met at the strike, nothing is struck", w.st.struck);
    w.st.people = BASE.people; await w.look(); await settle();
    ok(w.st.struck.length === 1, "T CONTROL — back, the minimums met again: struck", w.st.struck);
    // T6 — only the DJ next to play.
    w = world(Object.assign({}, BASE, { rotation: [{ user: "@a:hs", pending: [{ songKey: S3 }] }, { user: "@dj:hs", pending: [{ songKey: S1 }] }], geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.st.now = T0 + 30 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 0 && w.lines().length === 1, "T: a DJ who is not next to play is not struck, however long", w.st.struck);
    // T7 — strikes off: never struck; not caught up: never struck.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: { botBlockedStrike: false, botBlockedFixMs: 10 * MIN } }));
    w.enter(); await w.look(); await settle();
    w.st.now = T0 + 30 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 0 && /The bot won\u2019t act on it\./.test(w.lines()[0] || ""), "T: strikes off: the warning says nothing of removing it, and nothing is struck", { lines: w.lines(), struck: w.st.struck });
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.st.live = false; w.st.now = T0 + 30 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 0, "T: a tab not caught up strikes nothing", w.st.struck);
    // T8 — warnings off: only the songs it will strike are warned.
    const IT = { blocked: ["IT"], embeddable: true, checkedAt: T0, source: "proxynova" };
    const withIt = { people: BASE.people.concat(["@i:hs"]), levels: BASE.levels, cc: Object.assign({ "@i:hs": "IT" }, BASE.cc) };
    w = world(Object.assign({}, withIt, { rotation: queue("@dj:hs", [S1, S3]), geo: { [S1]: FR, [S3]: IT }, settings: Object.assign({ botBlockedWarn: false }, TS) }));
    w.enter(); await w.look(); await settle();
    ok(w.lines().length === 1 && /AAAAAAAAAAA/.test(w.lines()[0]) && /will remove it/.test(w.lines()[0]),
      "T: warnings off — the song it will strike is still warned, and the one blocked only for an unranked person is not", w.lines());
    w = world(Object.assign({}, withIt, { rotation: queue("@dj:hs", [S1, S3]), geo: { [S1]: FR, [S3]: IT }, settings: TS }));
    w.enter(); await w.look(); await settle();
    ok(w.lines().length === 2 && w.lines().some((l) => /CCCCCCCCCCC.*The bot won\u2019t act on it\./.test(l)), "T CONTROL — warnings on, the other is warned too, saying the bot won't act", w.lines());
    // T9 — a song warned before strikes were on is warned again when they are; its timer starts at that warning.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: { botBlockedStrike: false, botBlockedFixMs: 10 * MIN } }));
    w.enter(); await w.look(); await settle();
    w.st.settings = Object.assign({}, w.st.settings, { botBlockedStrike: true }); w.st.now = T0 + 30 * MIN; await w.look(); await settle();
    ok(w.lines().length === 2 && /will remove it/.test(w.lines()[1]) && w.st.struck.length === 0 && w.G._stateForTest().strikes[id("@dj:hs", S1)] === T0 + 30 * MIN,
      "T: strikes turned on later — the song is warned again, saying so, and its timer starts then (not struck on the first warning's time)", { lines: w.lines(), strikes: w.G._stateForTest().strikes });
    // T10 — the words: with the skip on too, and the fix time in whole minutes, floored.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: Object.assign({}, TS, { botBlockedSkip: true }) }));
    w.enter(); await w.look(); await settle();
    ok(/unless you change it within 10 minutes; if it starts before then, the bot will skip it\.$/.test(w.lines()[0] || ""), "T: with the skip on too, the warning says the skip applies if it starts first", w.lines());
    for (const [ms, words] of [[90 * SEC, "1 minute"], [125 * MIN + 59 * SEC, "125 minutes"]]) {
      w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: { botBlockedStrike: true, botBlockedFixMs: ms } }));
      w.enter(); await w.look(); await settle();
      ok((w.lines()[0] || "").indexOf("within " + words + ".") > 0, "T: a fix time of " + ms + " ms reads \"" + words + "\" (whole minutes, floored)", w.lines());
    }
    // T11 — a strike not sent, and one that does not take, are tried again; a reload starts every timer over.
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS, strikeAnswer: { ok: false, reason: "not-writable" } }));
    w.enter(); await w.look(); await settle();
    w.st.now = T0 + 10 * MIN; await w.look(); await settle();
    w.st.now += 5 * SEC; await w.look(); await settle();
    ok(w.st.struck.length === 2 && w.st.logs.some((l) => /the strike of yt:AAAAAAAAAAA from @dj:hs did not go out; trying again/.test(l)) && w.lines().length === 1,
      "T: a strike that did not go out is said in the log, tried again at the next look, and no line claims it", { struck: w.st.struck.length, lines: w.lines() });
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.st.now = T0 + 10 * MIN; await w.look(); await settle();
    w.st.now += w.G.SETTLE_MS - 1; await w.look(); await settle();
    ok(w.st.struck.length === 1, "T: sent, the song still queued: waited for, not sent again before `SETTLE_MS`", w.st.struck.length);
    w.st.now += 2; await w.look(); await settle();
    w.st.now += 5 * SEC; await w.look(); await settle();
    ok(w.st.struck.length === 2 && w.st.logs.some((l) => /the strike of yt:AAAAAAAAAAA did not take; trying again/.test(l)) && w.lines().length === 1,
      "T: still queued after `SETTLE_MS`: it did not take, said in the log, and is tried again", { struck: w.st.struck.length, logs: w.st.logs.slice(-3) });
    w = world(Object.assign({}, BASE, { rotation: queue("@dj:hs", [S1]), geo: { [S1]: FR }, settings: TS }));
    w.enter(); await w.look(); await settle();
    w.Rep.leave("reload"); w.st.now = T0 + 9 * MIN; w.enter(); await w.look(); await settle();
    w.st.now = T0 + 11 * MIN; await w.look(); await settle();
    ok(w.st.struck.length === 0 && w.lines().length === 2 && w.G._stateForTest().strikes[id("@dj:hs", S1)] === T0 + 9 * MIN,
      "T: a reload starts the timer over, from a new warning: never struck early on the first one's time", { struck: w.st.struck, lines: w.lines().length });
  }

  // ── S — THE FIVE ROOM SETTINGS: the reducer's defaults and fold, read live ────────────────────────────────────────
  {
    const real = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/dials.js"], { Date, Math, JSON });
    const SD = real.StateDeriver, D = SD.defaultSettings();
    ok(D.botBlockedWarn === true && D.botBlockedSkip === false && J(D.botBlockedRoads) === J(D.skipBlockedForSomeRoads),
      "S: the owner's defaults — warnings on, skips off, the bot's minimums the blocked-for-some table's numbers", [D.botBlockedWarn, D.botBlockedSkip, D.botBlockedRoads]);
    const A = (v) => SD.applySettingsEvent(SD.defaultSettings(), v);
    ok(J(A({ botBlockedRoads: [{ guestPlus: 2, vipPlus: 1 }] }).botBlockedRoads) === J([{ guestPlus: 2, vipPlus: 1 }]) &&
       J(A({ botBlockedRoads: [{ guestPlus: 0, vipPlus: 0 }] }).botBlockedRoads) === J(D.botBlockedRoads) &&
       J(A({ botBlockedRoads: [{ guestPlus: 1.5, vipPlus: 0 }] }).botBlockedRoads) === J(D.botBlockedRoads),
      "S: the bot's minimums fold through the one road-list check — a legal table taken, a road requiring nothing and a fraction refused whole");
    ok(A({ botBlockedSkip: true }).botBlockedSkip === true && A({ botBlockedSkip: "yes" }).botBlockedSkip === false && A({ botBlockedWarn: false }).botBlockedWarn === false,
      "S: the two switches fold on the booleans' strict check");
    ok(D.botBlockedStrike === false && D.botBlockedFixMs === 10 * MIN, "S: strikes off and a fix time of ten minutes by default (his \"example 10 min\")",
      [D.botBlockedStrike, D.botBlockedFixMs]);
    ok(A({ botBlockedStrike: true }).botBlockedStrike === true && A({ botBlockedStrike: 1 }).botBlockedStrike === false,
      "S: the strike's switch folds on the booleans' strict check");
    const fix = (v) => A({ botBlockedFixMs: v }).botBlockedFixMs;
    ok(fix(MIN) === MIN && fix(24 * 60 * MIN) === 24 * 60 * MIN && fix(MIN - 1) === 10 * MIN && fix(24 * 60 * MIN + 1) === 10 * MIN && fix(90000.5) === 10 * MIN && fix("600000") === 10 * MIN,
      "S: the fix time folds inside its row, one minute to 24 hours, whole milliseconds only", [fix(MIN), fix(MIN - 1), fix(90000.5)]);
    const R = SD.SETTING_RANGES || {};
    ok(R.botBlockedFixMs && R.botAfkMs && R.botBlockedFixMs.min === R.botAfkMs.min && R.botBlockedFixMs.max === R.botAfkMs.max && R.botBlockedFixMs.scale === 60000,
      "S: its row is `botAfkMs`' shape, shown in minutes", R.botBlockedFixMs);
    ok(["botBlockedWarn", "botBlockedSkip", "botBlockedRoads", "botBlockedStrike", "botBlockedFixMs"].every((k) => real.Dials.isLive(k) && !real.Dials.isFrozen(k)),
      "S: every one is read LIVE when the bot acts, never frozen onto a song (`Dials.LIVE`, as the countries' three)");
  }

  if (failed) { console.log("[rep-geo] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[rep-geo] PASS — the bot and blocked songs (J153 (d); " + asserts + " assertions), on the real piece, ports, rules, country " +
    "table and road rule. IT RUNS on the bot's tab only, through `Rep.enter`. THE PREDICTION counts the people present with a country — " +
    "unranked people for the warning while the room includes them, ranked people only for the skip. ONE WARNING per song per DJ while it is " +
    "queued, tried again if it did not arrive, saying how many, which countries and what the bot will do. THE SKIP at a song's start only, " +
    "tagged `region`, once, with one line. NOTHING WITHOUT DATA, and never silent: one muted line (H6) and one log line. THE LOOKUPS together, " +
    "under the room queue's list, the unanswered retried only after RETRY_MS. ONLY A CAUGHT-UP TAB ACTS. STRIKES (J153 (d)'s second half): " +
    "warned in whole minutes, the timer from the warning's delivery, struck when the DJ is next and the fix time is over with the " +
    "minimums met then, said once it has happened, the next song warned again and its timer started over, a reload starting over. THIS GUARD CANNOT TELL YOU A " +
    "SOURCE ANSWERS OR A CHAT LINE READS WELL IN A ROOM: that is his sitting's");
  process.exit(0);
})().catch((e) => { console.log("[rep-geo] FAIL — the guard threw: " + ((e && e.stack) || e)); process.exit(1); });

// An answer arriving after the window: past DECIDE_MS from the start, and past RETRY_MS from the first ask, so it is asked again.
function RETRY_PLUS(w) { return w.G.RETRY_MS + SEC; }
