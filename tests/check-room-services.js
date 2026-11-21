// tests/check-room-services.js
// SUBJECT: core/songs.js, backends/backend1/statederiver.js, backends/backend1/streammanager.js, features/room.js, features/userqueue.js, ui/playlists.js
//
// WALL: A ROOM ALLOWS THE SONG SERVICES ITS OWNER TURNS ON, AND EVERY SEND IS ANSWERED (`ddjp_716`). The owner's words: "ok lets
// make a room setting to allow or not allow soundcloud and explain why with the I and default is off"; "id say not turned on in
// room settings and missing means not allowed except for youtube"; "A refusal gets released, never stuck. / make sure this is
// handled right for all song types / and submissions of songs in general". Driven against the real modules: the reducer and
// both engines' judges, the interface's predicate, the real `UserQueue` with the room's transport stubbed at its seams.
//
//   PART A — THE SETTING: `songServices`, a flag map whose keys are DERIVED from the song table's services a room must turn on
//            (YouTube never among them), empty by default; whole-or-nothing like every map.
//   PART B — THE ROOM'S RULE, AT LOG POSITION, IN BOTH ENGINES: a join or a declare carrying a song whose service the room does
//            not allow there is refused, `service-not-allowed`, with its words; turning it on admits later joins; turning it
//            off never re-judges a song already admitted; YouTube and a song-less join are never refused for it. Backend2's
//            judge refuses the same intent through the same reducer.
//   PART C — ONE PREDICATE: `StreamManager.serviceAllowed` is the reducer's rule against the room's settings, and
//            `Room.serviceAllowed` passes it through.
//   PART D — THE ADD DOOR: a pasted SoundCloud link refused with its service's name; allowed once on; +All's note names what
//            was left out.
//   PART E — MY QUEUE (`ddjp_717`, the owner's): every undeclared song the room does not allow, reaching the declare window, is
//            dropped in one step (one log line); one further down keeps its place, ringed ("not-allowed"), until its turn; none
//            allowed empties My queue. A song declared while allowed stays declared when the service is turned off, is never
//            ringed, plays and leaves as every song does.
//   PART F — EVERY REFUSAL, FOR EVERY SUBMISSION: released at once; a cause that still holds is not sent again while it holds,
//            and is sent once the room has changed and the check says yes; a cause gone at the answer is sent once more, not
//            twice; no answer is sent once more; a refused join outside the queue never runs down the list. A row per code the
//            reducer gives a join, a declare, an order and an undeclare. `service-not-allowed` on a declare on its way drops the
//            song and sends the next allowed one (`ddjp_717`).
//   PART G — NO BACKGROUND DIFFERENCE (`ddjp_717`): shown, a change to the window waits for the settle; hidden, it is reconciled
//            at once — the same sends, no timer.
"use strict";
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures.js");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[room-services] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const SC1 = "sc:artist-one/track-one", SC2 = "sc:artist-two/track-two";
const YT1 = "yt:AAAAAAAAAAA", YT2 = "yt:BBBBBBBBBBB", YT3 = "yt:CCCCCCCCCCC", YTX = "yt:XXXXXXXXXXX";
const LINK = { [SC1]: "https://soundcloud.com/artist-one/track-one", [SC2]: "https://soundcloud.com/artist-two/track-two",
  [YT1]: "https://www.youtube.com/watch?v=AAAAAAAAAAA", [YT2]: "https://www.youtube.com/watch?v=BBBBBBBBBBB",
  [YT3]: "https://www.youtube.com/watch?v=CCCCCCCCCCC" };

// ═══ PART A — the setting ═══
const SDW = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
const SD = SDW.StateDeriver;
{
  const r = SD.SETTING_RANGES.songServices;
  const optional = SDW.Songs.services().filter((s) => !s.always).map((s) => s.short);
  ok(SD.settingKindOf("songServices") === "flags" && r && JSON.stringify(r.keys()) === JSON.stringify(optional) &&
    optional.indexOf("yt") < 0 && optional.indexOf("sc") >= 0 && JSON.stringify(SD.defaultSettings().songServices) === "{}",
    "A — THE SETTING: a flag map whose keys are the song table's services a room must turn on (SoundCloud's, never YouTube's), empty by default",
    { kind: SD.settingKindOf("songServices"), keys: r && r.keys(), optional });
  const apply = (v) => SD.applySettingsEvent(SD.defaultSettings(), Object.assign(SD.defaultSettings(), { songServices: v })).songServices;
  ok(JSON.stringify(apply({ sc: true })) === '{"sc":true}' && JSON.stringify(apply({ sc: false })) === '{"sc":false}',
    "A — a well-formed map is taken", [apply({ sc: true }), apply({ sc: false })]);
  const refused = [{ sc: true, zz: true }, { yt: true }, { sc: "true" }, ["sc"]].map(apply);
  ok(refused.every((x) => JSON.stringify(x) === "{}"),
    "A — refused WHOLE, the current value kept: a service outside the domain, YouTube (it has no setting), a non-boolean, an array", refused);
}

// ═══ PART B — the room's rule, at log position, in both engines ═══
{
  const W = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const SD2 = W.StateDeriver, R = W.Ranks, OWN = R.levelOf("owner"), PLY = R.levelOf("player");
  const set = (id, l, on) => F.reducerEvent(id, l, l * 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: Object.assign(SD2.defaultSettings(), { songServices: on }) });
  const ev = (id, l, who, body) => F.reducerEvent(id, l, l * 1000, who, PLY, body);
  const log = [
    set("$s1", 1, {}),
    ev("$j1", 2, "@a:hs", { t: "ddjp.dj.join", v: SC1 }),
    ev("$j2", 3, "@b:hs", { t: "ddjp.dj.join", v: YT1 }),
    set("$s2", 4, { sc: true }),
    ev("$j3", 5, "@a:hs", { t: "ddjp.dj.join", v: SC1 }),
    set("$s3", 6, {}),
    ev("$d1", 7, "@a:hs", { t: "ddjp.dj.declare", v: SC2 }),
    ev("$j4", 8, "@c:hs", { t: "ddjp.dj.join", v: SC2 }),
    ev("$j5", 9, "@e:hs", { t: "ddjp.dj.join" }),
    ev("$d2", 10, "@b:hs", { t: "ddjp.dj.declare", v: YT2 }),
  ];
  const refusals = SD2.deriveRefusals(log);
  const codeOf = (id) => { const r = Array.isArray(refusals) ? refusals.find((x) => x && (x.eventId === id || x.id === id)) : refusals[id]; return r ? (r.code || r) : null; };
  const st = SD2.derive(log);
  const a = (st.rotation || []).find((x) => x.user === "@a:hs");
  ok(codeOf("$j1") === "service-not-allowed" && codeOf("$d1") === "service-not-allowed" && codeOf("$j4") === "service-not-allowed",
    "B — A JOIN OR A DECLARE OF A SERVICE THE ROOM DOES NOT ALLOW THERE IS REFUSED: before it was turned on, and after it was turned off",
    { j1: codeOf("$j1"), d1: codeOf("$d1"), j4: codeOf("$j4") });
  ok(codeOf("$j3") === null && !!a && a.pending.some((p) => p.songKey === SC1),
    "B — TURNED ON, A LATER JOIN IS ADMITTED; TURNED OFF AGAIN, THE SONG ALREADY ADMITTED STAYS (never re-judged)", { j3: codeOf("$j3"), a });
  ok(codeOf("$j2") === null && codeOf("$d2") === null && codeOf("$j5") === null && !(st.rotation || []).some((x) => x.user === "@c:hs"),
    "B — YOUTUBE IS NEVER REFUSED FOR IT, NOR A JOIN WITH NO SONG; a refused join admits nobody", { j2: codeOf("$j2"), d2: codeOf("$d2"), j5: codeOf("$j5") });
  ok(SD2.refusalText("service-not-allowed") === "songs from that service aren't allowed in this room",
    "B — its words", SD2.refusalText("service-not-allowed"));
  // Backend2: the bot's judge, through the same reducer (as `check-judge-reducer` builds it).
  const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
    "backends/backend1/activity.js", "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/floor.js", "backends/backend1/streammanager.js", "backends/backend2/checkpoint.js",
    "backends/backend2/streammanager.js", "backends/backend2/authority.js"], {});
  const B1 = sb.B1StreamManager; B1.reset();
  B1.ingest(F.toRaw(F.reducerEvent("$s1", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() })));
  const judge = (intent) => sb.B2Authority.evaluate(Object.assign({}, intent, { actor: "@n:hs" }), B1.getState(), PLY, { log: B1.getLog(), seed: undefined });
  const scJ = judge({ t: "ddjp.dj.join", v: SC1 }), ytJ = judge({ t: "ddjp.dj.join", v: YT1 });
  ok(scJ.ok === false && scJ.code === "service-not-allowed" && /aren't allowed in this room/.test(scJ.reason || "") && ytJ.ok === true,
    "B — IN A BOT ROOM: backend2's judge refuses the SoundCloud join with the same code and words, and takes the YouTube one", { scJ, ytJ });
  B1.ingest(F.toRaw(F.reducerEvent("$s2", 2, 2000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: Object.assign(sb.StateDeriver.defaultSettings(), { songServices: { sc: true } }) })));
  const scJ2 = judge({ t: "ddjp.dj.join", v: SC1 });
  ok(scJ2.ok === true, "B — and takes it once the room turns SoundCloud on", scJ2);
}

// ═══ PART C — one predicate ═══
{
  const st = { settings: { songServices: {} } };
  const W = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"], {});
  const SM = W.StreamManager || W.B1StreamManager;
  const has = typeof SM.serviceAllowed === "function";   // a tree without it answers by name, and the parts below still run
  const off = has ? SM.serviceAllowed(SC1) : "missing", yt = has ? SM.serviceAllowed(YT1) : "missing";
  const X = require("./_probe-j14-card.js").extractNamed("features/room.js", "serviceAllowed");
  let pass = null;
  if (X.ok) { const fn = new Function("StreamManager", X.source + "\nreturn serviceAllowed;")({ serviceAllowed: (k) => SD.serviceAllowed(k, st.settings) }); pass = [fn(SC1), fn(YT1)]; st.settings.songServices = { sc: true }; pass.push(fn(SC1)); }
  ok(off === false && yt === true && X.ok && JSON.stringify(pass) === "[false,true,true]",
    "C — ONE PREDICATE: the interface answers with the reducer's rule (a fresh room: SoundCloud off, YouTube on), and Room passes it through", { off, yt, pass, stage: X.stage });
}

// ═══ The real UserQueue, its room stubbed at the seams ═══
function uq() {
  const st = { settings: { songServices: { sc: true } }, rotation: [], nowPlaying: null };
  const subs = {}, sent = [];
  let nid = 0, answer = () => ({ status: "yes" });
  const wire = (a) => (a && a.status === "no"
    ? (a.reason === "uncoded" ? { status: "no", reason: "refused", code: null } : { status: "no", reason: SD.refusalText(a.reason) || a.reason, code: a.reason })
    : a);
  const send = (kind) => (x) => { const id = "$" + kind + (++nid); sent.push([kind, Array.isArray(x) ? x.join(",") : x, id]); return Promise.resolve({ eventId: id }); };
  const doc = { visibilityState: "visible" };   // the page, shown or hidden (PART G)
  const sb = loadInContext(["core/logger.js", "features/userqueue.js"], {
    URL, document: doc,
    StreamManager: { getState: () => st, getLog: () => [], on: (t, f) => { (subs[t] = subs[t] || []).push(f); }, off() {}, isLegal: () => true },
    // THE ANSWER AS THE TRANSPORT GIVES IT (`matrixbridge.js` `_answersIn`, driven in PART B): a "no" carries the room's words
    // and the reducer's code; a row here names the code, and "uncoded" is a refusal that carries none.
    MatrixBridge: { getUserId: () => "@me:hs", awaitAnswer: (id) => Promise.resolve(wire(answer(id))), onAuthorReady() {} },
    Queue: { submitSong: send("join"), undeclare: send("undeclare"), reorder: send("order"), leave: send("leave") },
    Room: { serviceAllowed: (k) => SD.serviceAllowed(k, st.settings), canQueue: () => ({ ok: true }) },
    Store: { queue: { persist() {}, load: () => Promise.resolve(null) }, noteOldSongs() {} },
  });
  const UQ = sb.UserQueue, timers = [], logs = [];
  try { sb.Logger.on((e) => logs.push(String(e && e.message))); } catch (e) {}
  let tid = 0;
  UQ.setClock({ set: (f) => { const t = { id: ++tid, f }; timers.push(t); return t.id; }, clear: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); } });
  UQ.init("!space:hs"); UQ.resync();
  const mine = (keys) => { st.rotation = keys.length ? [{ user: "@me:hs", pending: keys.map((k) => ({ songKey: k })) }] : []; };
  const fire = (t) => (subs[t] || []).slice().forEach((f) => f({ type: t }));
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setImmediate(r)); timers.splice(0).forEach((t) => t.f()); } };
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };   // answers only: no timer runs
  const joins = (k) => sent.filter((s) => s[0] === "join" && (!k || s[1] === k)).length;
  return { UQ, st, sent, mine, fire, settle, flush, joins, logs, doc, timers, setAnswer: (f) => { answer = f; } };
}

(async () => {
  // ═══ PART D — the add door ═══
  {
    const w = uq();
    w.st.settings.songServices = {};
    const r = w.UQ.add(LINK[SC1]), y = w.UQ.add(LINK[YT1]);
    w.st.settings.songServices = { sc: true };
    const r2 = w.UQ.add(LINK[SC1]);
    ok(r.ok === false && r.code === "service-not-allowed" && r.reason === "SoundCloud songs aren't allowed in this room." && y.ok === true && r2.ok === true,
      "D — A PASTED SOUNDCLOUD LINK IS REFUSED BY ITS SERVICE'S NAME while the room has it off, a YouTube link is taken, and once on it is taken", { r, y, r2 });
    const X = require("./_probe-j14-card.js").extractNamed("ui/playlists.js", "_addAllNote");
    let note = null, plain = null;
    if (X.ok) {
      const fn = new Function("Songs", X.source + "\nreturn _addAllNote;")(SDW.Songs);
      note = fn({ added: 3, skipped: 2, refused: [{ songKey: SC1, code: "service-not-allowed" }, { songKey: SC2, code: "service-not-allowed" }] });
      plain = fn({ added: 3, skipped: 1, refused: [{ songKey: YT1, code: "repeat-cooldown" }] });
    }
    ok(note === "Added 3 songs. 2 SoundCloud songs left out: not allowed in this room." && plain === "Added 3, skipped 1.",
      "D — +ALL SAYS WHAT WAS LEFT OUT FOR ITS SERVICE, and is unchanged when nothing was", { note, plain, stage: X.stage });
    // The real Playlists feature over the real My queue: a playlist itself takes a SoundCloud song with the room's SoundCloud
    // off (a playlist is this device's, not the room's); +All adds the allowed ones and hands back the others as refused.
    const recs = {};
    const store = { playlists: { loadIndex: () => Promise.resolve({ order: [], names: {} }), loadOne: (id) => Promise.resolve(recs[id] ? JSON.parse(JSON.stringify(recs[id])) : null),
      persist: (pl) => { recs[pl.id] = JSON.parse(JSON.stringify(pl)); return Promise.resolve(true); }, remove: () => Promise.resolve(true), reorder: () => Promise.resolve(true), clear: () => Promise.resolve() },
      durability: { supported: () => true } };
    const w2 = uq();
    w2.st.settings.songServices = {};
    const PL = loadInContext(["core/playlistdoc.js", "features/playlists.js"], { Store: store, UserQueue: w2.UQ, Date, URL }).Playlists;
    PL.init(); await new Promise((r) => setImmediate(r));
    const pl = await PL.create("Mixed");
    const took = [];
    for (const k of [YT1, SC1, YT2, SC2, YT3]) took.push((await PL.addTrackByUrl(pl.id, LINK[k])).ok);
    const all = await PL.addWholeToQueue(pl.id);
    ok(took.every(Boolean) && all.added === 3 && all.refused.length === 2 && all.refused.every((x) => x.code === "service-not-allowed") &&
      JSON.stringify(w2.UQ.items().map((x) => x.songKey)) === JSON.stringify([YT1, YT2, YT3]),
      "D — A PLAYLIST ITSELF TAKES A SOUNDCLOUD SONG with the room's off; +All adds the allowed three to My queue and leaves the two out, by code",
      { took, added: all.added, refused: all.refused.map((x) => x.code), mine: w2.UQ.items().map((x) => x.songKey) });
  }

  // ═══ PART E — my queue ═══
  {
    // THE DROP: added while the room allowed SoundCloud, then turned off, then Join — every undeclared SoundCloud song in the
    // window's way goes in one step; one further down keeps its place, ringed, until its turn.
    const w = uq();
    for (const k of [SC1, YT1, SC2, YT2, SC1, YT3]) w.UQ.add(LINK[k]);
    w.st.settings.songServices = {};
    const ringedBefore = [0, 1, 2, 3, 4, 5].map((i) => w.UQ.slotState(i));
    w.UQ.joinRoomQueue(); await w.settle();
    const firstJoins = w.sent.filter((s) => s[0] === "join").map((s) => s[1]);
    const left = w.UQ.items().map((x) => x.songKey), states = left.map((_, i) => w.UQ.slotState(i));
    const said = w.logs.filter((x) => /^My queue: /.test(x));
    ok(JSON.stringify(firstJoins) === JSON.stringify([YT1, YT2]) && JSON.stringify(left) === JSON.stringify([YT1, YT2, SC1, YT3]) &&
      states[2] === "not-allowed" && states[3] === null && ringedBefore[0] === "not-allowed" &&
      JSON.stringify(said) === JSON.stringify(["My queue: dropped " + SC1 + ", " + SC2 + " — not allowed in this room now, never sent"]),
      "E — THE DROP: the undeclared SoundCloud songs reaching the window go in one step, silently but for one log line; one further " +
      "down keeps its place, ringed (\"not-allowed\"), until its turn", { firstJoins, left, states, ringedBefore, said });
    // Its turn comes: the first song plays, the window moves down to it, and it goes.
    w.mine([YT1, YT2]); w.fire("ddjp.dj.join"); await w.settle();   // both land
    w.mine([YT2]); w.st.nowPlaying = { pi: "$p1", dj: "@me:hs", song: { songKey: YT1 } }; w.fire("ddjp.dj.play"); await w.settle();
    ok(JSON.stringify(w.UQ.items().map((x) => x.songKey)) === JSON.stringify([YT2, YT3]) && w.joins(YT3) === 1,
      "E — and when its turn comes it goes, the next allowed song declared", { left: w.UQ.items().map((x) => x.songKey), joins: w.sent.map((x) => x[0] + " " + x[1]) });
    // None allowed: My queue empties, nothing is sent.
    const z = uq();
    for (const k of [SC1, SC2]) z.UQ.add(LINK[k]);
    z.st.settings.songServices = {};
    z.UQ.joinRoomQueue(); await z.settle();
    ok(z.UQ.count() === 0 && z.joins() === 0, "E — none allowed: My queue empties and nothing is sent", { count: z.UQ.count(), sent: z.sent });
    // NO SWAP: turned off with a SoundCloud song declared and waiting, it stays declared and plays; nothing is sent for it; it is
    // never ringed (the owner's precision: a red song never sits inside or above the declared window).
    const v = uq();
    for (const k of [SC1, YT1, YT2]) v.UQ.add(LINK[k]);
    v.UQ.joinRoomQueue(); await v.settle();
    v.mine([SC1, YT1]); v.fire("ddjp.dj.join"); await v.settle();
    const c0 = v.sent.length;
    v.st.settings.songServices = {}; v.fire("ddjp.room.settings"); await v.settle();
    const after = v.sent.slice(c0).map((s) => s[0] + " " + s[1]);
    const vs = [0, 1, 2].map((i) => v.UQ.slotState(i));
    ok(after.length === 0 && JSON.stringify(v.UQ.items().map((x) => x.songKey)) === JSON.stringify([SC1, YT1, YT2]) && vs[0] === "green",
      "E — NO SWAP: a song declared while the room allowed it stays declared and nothing is sent for it when the room turns its " +
      "service off", { after, items: v.UQ.items().map((x) => x.songKey), states: vs });
    ok(vs.indexOf("not-allowed") < 0, "E — A DECLARED SONG IS NEVER RINGED, its service off or not", vs);
    // It plays, and leaves My queue as every song does.
    v.mine([YT1]); v.st.nowPlaying = { pi: "$p2", dj: "@me:hs", song: { songKey: SC1 } }; v.fire("ddjp.dj.play"); await v.settle();
    ok(JSON.stringify(v.UQ.items().map((x) => x.songKey)) === JSON.stringify([YT1, YT2]) && v.joins(YT2) === 1,
      "E — it plays and leaves My queue as every song does; the next allowed song is declared", { items: v.UQ.items().map((x) => x.songKey) });
  }

  // ═══ PART F — every refusal ═══
  const FRESH = async (keys, on) => { const w = uq(); for (const k of keys) w.UQ.add(LINK[k]); if (on === false) w.st.settings.songServices = {}; return w; };
  // F1 — service-not-allowed for a declare on its way (the room turned it off meanwhile): the song is dropped, one line, and the
  // next allowed song sent; refused for it while the room has it on again (the cause gone): sent once more.
  {
    const w = await FRESH([SC1, YT1, YT2]);
    w.setAnswer((id) => { const s = w.sent.find((x) => x[2] === id); if (s && s[1] === SC1) { w.st.settings.songServices = {}; return { status: "no", reason: "service-not-allowed" }; } return { status: "yes" }; });
    w.UQ.joinRoomQueue(); await w.settle();
    const said = w.logs.filter((x) => /^My queue: /.test(x));
    const g = await FRESH([SC1, YT1]);
    g.setAnswer((id) => { const s = g.sent.find((x) => x[2] === id); return s && s[1] === SC1 && g.joins(SC1) === 1 ? { status: "no", reason: "service-not-allowed" } : { status: "yes" }; });
    g.UQ.joinRoomQueue(); await g.settle();
    ok(JSON.stringify(w.UQ.items().map((x) => x.songKey)) === JSON.stringify([YT1, YT2]) && w.joins(YT2) === 1 && w.joins(SC1) === 1 &&
      JSON.stringify(said) === JSON.stringify(["My queue: the room refused " + SC1 + " — service-not-allowed; dropped from My queue"]) &&
      g.joins(SC1) === 2 && g.UQ.count() === 2,
      "F — service-not-allowed: the refused song is dropped (one line) and the next allowed one sent; with the room allowing it again " +
      "by the answer, sent once more", { items: w.UQ.items().map((x) => x.songKey), sent: w.sent.map((x) => x[0] + " " + x[1]), said, again: g.joins(SC1) });
  }
  // F9 — service-not-allowed outside the queue: Join stays, and the next allowed song is sent in its place AT THE ANSWER (no
  // timer runs here) — also when both songs in flight were SoundCloud's, refused as the room turned it off.
  {
    const w = await FRESH([SC1, YT1, YT2]);
    w.setAnswer((id) => { const s = w.sent.find((x) => x[2] === id); if (s && s[1] === SC1) { w.st.settings.songServices = {}; return { status: "no", reason: "service-not-allowed" }; } return { status: "yes" }; });
    w.UQ.joinRoomQueue(); await w.flush();
    const v = await FRESH([SC1, SC2, YT1]);
    v.setAnswer((id) => { const s = v.sent.find((x) => x[2] === id); if (s && /^sc:/.test(s[1])) { v.st.settings.songServices = {}; return { status: "no", reason: "service-not-allowed" }; } return { status: "yes" }; });
    v.UQ.joinRoomQueue(); await v.flush();
    ok(w.UQ.isActive() === true && w.joins(YT2) === 1 && w.joins(SC1) === 1 && v.UQ.isActive() === true && v.joins(YT1) === 1 && v.joins(SC1) === 1 && v.joins(SC2) === 1,
      "F — service-not-allowed on a first join: Join stays, and the next allowed song is sent in its place", { active: [w.UQ.isActive(), v.UQ.isActive()], sent: [w.sent.map((x) => x[0] + " " + x[1]), v.sent.map((x) => x[0] + " " + x[1])] });
  }
  // F2 — queue-full, its cause still holding at the answer: held; sent again when the room has changed and there is room.
  {
    const w = await FRESH([YT1, YT2]);
    w.setAnswer((id) => { const s = w.sent.find((x) => x[2] === id); if (s && s[1] === YT2) { w.mine([YT1, YTX]); return { status: "no", reason: "queue-full" }; } return { status: "yes" }; });
    w.UQ.joinRoomQueue(); await w.settle();
    const held = w.joins(YT2);
    w.setAnswer(() => ({ status: "yes" }));
    w.mine([YT1]); w.fire("ddjp.dj.undeclare"); await w.settle();
    ok(held === 1 && w.joins(YT2) === 2, "F — queue-full while it still holds: not sent again; sent once the buffer has room again", { held, now: w.joins(YT2) });
  }
  // F3 — queue-full (a join's) or queue-unchanged (a declare's) gone by the answer — the room changed in between: sent once more,
  // and only once.
  for (const code of ["queue-full", "queue-unchanged"]) {
    const w = await FRESH([YT1, YT2]);
    w.setAnswer((id) => { const s = w.sent.find((x) => x[2] === id); return s && s[1] === YT2 ? { status: "no", reason: code } : { status: "yes" }; });
    w.UQ.joinRoomQueue(); await w.settle(); await w.settle();
    w.fire("ddjp.dj.order"); await w.settle();   // the room's stream goes on (an order that moves nothing), changing nothing the refusal is about
    ok(w.joins(YT2) === 2, "F — " + code + " gone by the answer: sent ONCE more (two sends), not again while nothing changes", w.joins(YT2));
  }
  // F4 — rank-below-min-dj, outside the queue: Join ends, and the list is not run down.
  {
    const w = await FRESH([YT1, YT2, YT3]);
    w.setAnswer(() => ({ status: "no", reason: "rank-below-min-dj" }));
    w.UQ.joinRoomQueue(); await w.settle(); await w.settle();
    ok(w.UQ.isActive() === false && w.joins(YT3) === 0 && w.joins() <= 2,
      "F — rank-below-min-dj outside the queue: Join ends and the next songs are not sent into the same refusal", { active: w.UQ.isActive(), joins: w.joins() });
  }
  // F5 — no answer: sent once more, as before.
  {
    const w = await FRESH([YT1]);
    w.setAnswer(() => ({ status: "none", reason: "no-answer" }));
    w.UQ.joinRoomQueue(); await w.settle();
    ok(w.joins(YT1) === 2, "F — no answer at all: sent once more, as it always was", w.joins(YT1));
  }
  // F6 — every other code a join or a declare can get: released, held until the room changes, then sent once.
  for (const code of ["no-sender", "not-a-member", "uncoded"]) {
    const w = await FRESH([YT1]);
    w.setAnswer(() => ({ status: "no", reason: code }));
    w.UQ.joinRoomQueue(); w.mine([YTX]); await w.settle();
    const held = w.joins(YT1), freed = w.UQ.slotState(0) !== "sent";
    w.setAnswer(() => ({ status: "yes" }));
    w.st.nowPlaying = { pi: "$p9", dj: "@x:hs" }; w.fire("ddjp.dj.play"); await w.settle();
    ok(freed && held === 1 && w.joins(YT1) >= 2, "F — " + code + ": released, not sent again until the room changes, then sent", { freed, held, now: w.joins(YT1) });
  }
  // F7 — an undeclare's codes: released from waiting, never stuck.
  for (const code of ["no-sender", "not-a-member", "no-song-key", "not-in-my-queue"]) {
    const w = await FRESH([YT1]);
    w.UQ.joinRoomQueue(); await w.settle();
    w.mine([YT1, YTX]); w.fire("ddjp.dj.join");
    w.setAnswer((id) => { const s = w.sent.find((x) => x[2] === id); return s && s[0] === "undeclare" ? { status: "no", reason: code } : { status: "yes" }; });
    await w.settle();
    const und = w.sent.filter((s) => s[0] === "undeclare" && s[1] === YTX).length;
    w.fire("ddjp.dj.order"); await w.settle();
    const und2 = w.sent.filter((s) => s[0] === "undeclare" && s[1] === YTX).length;
    ok(und === 1 && und2 === 2, "F — undeclare " + code + ": released (the surplus is worked out again and asked once more on the next change)", { und, und2 });
  }
  // F8 — an order's codes: read, nothing left waiting; no answer sends it once more.
  for (const code of ["no-sender", "not-a-member", "empty-selection", "selection-unchanged", null]) {
    const w = await FRESH([YT1, YT2]);
    w.UQ.joinRoomQueue(); await w.settle();
    w.setAnswer((id) => { const s = w.sent.find((x) => x[2] === id); return s && s[0] === "order" ? (code ? { status: "no", reason: code } : { status: "none", reason: "no-answer" }) : { status: "yes" }; });
    w.mine([YT2, YT1]); w.fire("ddjp.dj.join"); await w.settle();
    const orders = w.sent.filter((s) => s[0] === "order").length;
    ok(code ? orders === 1 : orders === 2, "F — order " + (code || "with no answer") + ": " + (code ? "read, not sent again by itself" : "sent once more"), orders);
  }

  // ═══ PART G — no background difference ═══
  // The settle (DEBOUNCE_MS) is the one wait in My queue's decisions that a hidden tab stretches: shown, a change to the window
  // waits for it; hidden, it is reconciled at once — the same sends, no timer.
  for (const hidden of [false, true]) {
    const w = uq();
    for (const k of [YT1, YT2, YT3]) w.UQ.add(LINK[k]);
    w.UQ.joinRoomQueue(); await w.settle();
    w.mine([YT1, YT2]); w.fire("ddjp.dj.join"); await w.settle();
    w.doc.visibilityState = hidden ? "hidden" : "visible";
    const c0 = w.sent.length;
    w.UQ.moveToTop(2); await w.flush();   // YT3 to the top: the window changes
    const now = w.sent.slice(c0).map((x) => x[0] + " " + x[1]), waiting = w.timers.length;
    await w.settle();
    const later = w.sent.slice(c0).map((x) => x[0] + " " + x[1]);
    ok(hidden ? (now.indexOf("join " + YT3) >= 0 && now.indexOf("undeclare " + YT2) >= 0 && waiting === 0)
              : (now.length === 0 && waiting === 1 && later.indexOf("join " + YT3) >= 0 && later.indexOf("undeclare " + YT2) >= 0),
      "G — NO BACKGROUND DIFFERENCE: " + (hidden ? "hidden, the change is reconciled at once, no timer" : "shown, the change waits for the settle, then the same sends"),
      { hidden, now, waiting, later });
  }

  if (failed) { console.log("[room-services] " + failed + " failure(s)"); process.exit(1); }
  console.log("[room-services] PASS — a room allows the song services its owner turns on, and every send is answered (" + asserts +
    " assertions): A the setting, its services derived from the song table, YouTube never in it, whole or nothing; B a join or a declare " +
    "of a service the room does not allow at its position refused by name, in both engines, an admitted song never re-judged; C one " +
    "predicate through the interface; D the add door's refusal by the service's name and +All's note; E undeclared songs the room does " +
    "not allow dropped when they reach the window, many in one step, the rest ringed until their turn; a declared one kept, never " +
    "ringed, played; F every refusal released, held while its cause holds, sent once more when the room changed, never run down the " +
    "list, a service refusal dropping its song; G no wait while the page is hidden");
})().catch((e) => { console.log("[room-services] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
