// features/rep-ports.js — J84: REP's BOUNDARY (the owner's ruling 21). Every call REP makes into the rest of the app
// goes through one of the ports below, and nothing else in REP names an app global. `check-rep-boundary` holds both
// halves: REP's other files name only `RepRules` and `RepPorts`, and outside REP's files the REP globals appear only at
// the hook sites the design names (H1–H5, DESIGN-J84-REP.md §2.2). `check-rep-ports` drives every port against the real
// modules, so a port cannot quietly point at something that no longer exists.
//
// Depends on (at CALL time, never at load time, so the load order cannot matter): StreamManager, MatrixBridge,
// Capabilities, Room, Chat, ServerClock, Store, BotRuntime, Logger.
//
// THE PORTS ARE THIN ON PURPOSE. Each one is a single call with its answer passed through; a decision made here would be
// REP logic outside REP's own pieces, which is the spaghetti ruling 21 forbids. Each answers safely when its module is
// not there (headless guards, a partial load): an empty list, null, or `false`, never a throw.
//
// THE APP REACHING REP (the other direction) is `Rep`, below: the app's one entry into REP. `Rep.enter` / `Rep.leave`
// (H1, H2: `features/room.js`'s bot evaluation and its one leave step) arrived with the bot side (J84-2), `Rep.badge` (H3,
// the People tab's row) with the reader (J84-3), `Rep.botCard` (H4, the Bot card) with commands and files (J84-5). `Rep`
// decides nothing either: it hands each call to the pieces, read at call time, and each piece decides for itself.
const RepPorts = (() => {
  // A module, read at call time; null when it is not loaded (a bare name would throw a ReferenceError instead).
  const _m = (get) => { try { return get() || null; } catch (e) { return null; } };
  const SM = () => _m(() => StreamManager), MB = () => _m(() => MatrixBridge), CAP = () => _m(() => Capabilities);
  const RM = () => _m(() => Room), CH = () => _m(() => Chat), SC = () => _m(() => ServerClock);
  const ST = () => _m(() => Store), BR = () => _m(() => BotRuntime), LG = () => _m(() => Logger);
  const _has = (g, f) => !!g && typeof g[f] === "function";

  // Q1 — reactions as the room folds them (both engines: a bot room unpacks relay batches member by member). Which
  // playings exist comes from song history (Q2), not from a play subscription: a module that subscribes to one advance
  // type must take all three (`check-advance-notify`), and REP needs none of them.
  const REACTION_TYPES = ["ddjp.dj.vote", "ddjp.dj.save"];
  function onReactions(fn) { if (_has(SM(), "on")) for (const t of REACTION_TYPES) SM().on(t, fn); }
  function offReactions(fn) { if (_has(SM(), "off")) for (const t of REACTION_TYPES) SM().off(t, fn); }
  function heldLog() { try { return _has(SM(), "getLog") ? (SM().getLog() || []) : []; } catch (e) { return []; } }
  function isLegal(id) { try { return _has(SM(), "isLegal") ? SM().isLegal(id) : null; } catch (e) { return null; } }
  // Does this tab hold the room from its start — nothing trimmed, nothing below a floor (`StreamManager.holdsWholeRoom`)?
  // `null` when the engine cannot say. The bot side's one way to a base with no table in J84-2 (counted from the start).
  function holdsWholeRoom() { try { return _has(SM(), "holdsWholeRoom") ? SM().holdsWholeRoom() === true : null; } catch (e) { return null; } }
  // Where the held log starts being complete (`StreamManager.heldFrom`): `null` when nothing was forgotten (the tab holds
  // the room from its start), else the first position it holds — just above a save point or a trim; `undefined` when the
  // engine cannot say. The reader pages the stretch below it from a summary's cut (J84-3).
  function heldFrom() {
    try { if (!_has(SM(), "heldFrom")) return undefined; const v = SM().heldFrom(); return (v === null || (typeof v === "number" && isFinite(v))) ? v : undefined; }
    catch (e) { return undefined; }
  }

  // Q2 — the playings: song history's verified rows, `{ pi, dj, l }`, newest first; its coverage; its reach-back; and which
  // playing is current (the reducer's `nowPlaying.pi`, or null with nothing playing) — the summary's cut (J84-2).
  function playings(limit) {
    try {
      const rows = _has(MB(), "roomHistory") ? (MB().roomHistory(limit) || []) : [];
      return rows.filter((r) => r && r.pi).map((r) => ({ pi: r.pi, dj: r.dj || null, l: (typeof r.l === "number") ? r.l : null }));
    } catch (e) { return []; }
  }
  function historyCoverage() { try { return _has(MB(), "historyCoverage") ? MB().historyCoverage() : null; } catch (e) { return null; } }
  function nowPlaying() {
    try { const np = _has(SM(), "getState") ? (SM().getState() || {}).nowPlaying : null; return (np && typeof np.pi === "string") ? { pi: np.pi } : null; }
    catch (e) { return null; }
  }
  function backfillHistory() { try { return _has(MB(), "backfillHistory") ? MB().backfillHistory() : null; } catch (e) { return null; } }

  // Q3 — a range of reactions from the server: the `events-*` channels only, stopped by a time bound (hook E4).
  function pageReactions(fromL, toL, notBeforeTs) {
    if (!_has(MB(), "pageRange")) return Promise.resolve([]);
    return MB().pageRange(fromL, toL, { kinds: ["events"], notBeforeTs: notBeforeTs });
  }

  // Q4 — side messages in: the live raw feed, and one channel read back over a time window (hook E3).
  function onRaw(fn) { if (_has(MB(), "onRawEvent")) MB().onRawEvent(fn); }
  function offRaw(fn) { if (_has(MB(), "offRawEvent")) MB().offRawEvent(fn); }
  function readOwnerChannelBack(channels, sinceTs) {
    if (!_has(MB(), "readChannelBack")) return Promise.resolve([]);
    return MB().readChannelBack(channels, "events_owner", sinceTs);
  }

  // Q5 — a side message out, alone (hook E2: backend1 sends it on the owner-level channel; a bot room's runner gates it).
  function sendSide(channels, type, body) {
    if (!_has(MB(), "sendSide")) return Promise.resolve({ ok: false, reason: "no transport" });
    return MB().sendSide(channels, type, body);
  }

  // Q6 — the room's settings, and their changes.
  function settings() { try { return (_has(SM(), "getState") && SM().getState().settings) || null; } catch (e) { return null; } }
  function onSettingsChange(fn) { if (_has(RM(), "onSettingsChange")) RM().onSettingsChange(fn); }

  // Q7 — who is active. THE ONE "who is active" function (the owner's ruling 30): the People tab's, and on the bot's tab
  // the same function over every chat tier the bot reads.
  function whoIsActive(now) { try { return _has(RM(), "presenceView") ? RM().presenceView(now) : null; } catch (e) { return null; } }
  // ...and that it changed (the owner's ruling 35): the feature layer's generic "the people view changed", which the People
  // tab redraws on, once per burst. Says only that something it shows moved (J84-4).
  function peopleChanged() { try { if (_has(RM(), "peopleViewChanged")) RM().peopleViewChanged(); } catch (e) {} }

  // Q8 — chat: a command in, a reply out to the tier it came from; the tiers this tab reads.
  function onChat(fn) { if (_has(CH(), "onMessage")) CH().onMessage(fn); }
  function sendChat(tierId, text) {
    if (!_has(CH(), "sendTo")) return Promise.resolve({ ok: false, reason: "no chat" });
    return CH().sendTo(tierId, text);
  }
  function chatTiers() { try { return _has(RM(), "chatTiers") ? RM().chatTiers() : null; } catch (e) { return null; } }

  // Q9 — who may command the bot (hook E5), and a person's authority level across the Space and its channels.
  function mayCommand(level) {
    try { return _has(CAP(), "can") ? CAP().can("bot.command", {}, { myRank: level }).permitted === true : false; }
    catch (e) { return false; }
  }
  function levelOf(spaceId, channels, userId) {
    try { return _has(MB(), "getUserEffectiveRank") ? MB().getUserEffectiveRank(spaceId, channels, userId) : 0; }
    catch (e) { return 0; }
  }
  function myId() { try { return _has(MB(), "getUserId") ? MB().getUserId() : null; } catch (e) { return null; } }
  // The running room's name, for an export file and its preview (J84-5); null when there is none.
  function roomName() { try { const c = _has(RM(), "getCurrent") ? RM().getCurrent() : null; return (c && typeof c.name === "string" && c.name) ? c.name : null; } catch (e) { return null; } }

  // Q10 — server time; and whether this tab is caught up enough to say anything (`MatrixBridge.mayAuthor`): a summary
  // built before replay has finished would publish a partial count as the room's.
  function serverNow() { try { return _has(SC(), "serverNow") ? SC().serverNow() : null; } catch (e) { return null; } }
  function mayAuthor() { try { return _has(MB(), "mayAuthor") ? (MB().mayAuthor() || {}).ok === true : false; } catch (e) { return false; } }

  // Q11 — the bot's local table, its bot-only settings, and the single writer (hook E6).
  function storeLoad(spaceId) { return (ST() && ST().rep) ? ST().rep.load(spaceId) : Promise.resolve(null); }
  function storeSave(spaceId, table) { return (ST() && ST().rep) ? ST().rep.save(spaceId, table) : Promise.resolve(false); }
  function prefsLoad(spaceId) { return (ST() && ST().rep) ? ST().rep.loadPrefs(spaceId) : Promise.resolve(null); }
  function prefsSave(spaceId, prefs) { return (ST() && ST().rep) ? ST().rep.savePrefs(spaceId, prefs) : Promise.resolve(false); }
  function writerLock(spaceId, held) { return (ST() && ST().rep) ? ST().rep.writerLock(spaceId, held) : Promise.resolve(null); }

  // Q12 — is this tab the room's bot. Nothing else of the bot runtime is read.
  function actingAsBot() { try { return _has(BR(), "actingAsBot") ? BR().actingAsBot() === true : false; } catch (e) { return false; } }

  // The log, one line each, prefixed so every REP line reads `REP: …`.
  function log(level, msg) { try { const L = LG(); if (L && typeof L[level] === "function") L[level]("REP: " + msg); } catch (e) {} }

  // THE LIST, as data: `check-rep-ports` compares it with what this object exports, so a port added without being listed
  // (or listed without existing) is red.
  const PORTS = ["onReactions", "offReactions", "heldLog", "isLegal", "holdsWholeRoom", "heldFrom",
    "playings", "historyCoverage", "nowPlaying", "backfillHistory", "pageReactions",
    "onRaw", "offRaw", "readOwnerChannelBack", "sendSide",
    "settings", "onSettingsChange", "whoIsActive", "peopleChanged",
    "onChat", "sendChat", "chatTiers", "mayCommand", "levelOf", "myId", "roomName",
    "serverNow", "mayAuthor", "storeLoad", "storeSave", "prefsLoad", "prefsSave", "writerLock",
    "actingAsBot", "log"];

  return { PORTS, onReactions, offReactions, heldLog, isLegal, holdsWholeRoom, heldFrom,
    playings, historyCoverage, nowPlaying, backfillHistory, pageReactions,
    onRaw, offRaw, readOwnerChannelBack, sendSide,
    settings, onSettingsChange, whoIsActive, peopleChanged,
    onChat, sendChat, chatTiers, mayCommand, levelOf, myId, roomName,
    serverNow, mayAuthor, storeLoad, storeSave, prefsLoad, prefsSave, writerLock,
    actingAsBot, log };
})();

// ── `Rep`: THE APP'S ONE ENTRY INTO REP (the design's §2.2) ────────────────────────────────────────────────────────────
// The app names `Rep` and nothing else of REP, and only at the hook sites `check-rep-boundary` lists. Each call goes to
// the pieces that exist, read at call time (a piece not loaded is skipped, never a throw); the pieces decide.
//   H1 `Rep.enter({ spaceId, channels })` — `features/room.js`, after the bot's evaluation (room entry and every rank
//      change). The reader starts on every tab; the bot side only on the room's bot tab, and elsewhere stops if it ran.
//   H2 `Rep.leave(why)` — `features/room.js`'s one leave step, beside the bot's stop, before the engine resets.
//   H3 `Rep.badge(userId)` — `ui/roster.js`'s People tab row: `{ rep, text: "<n> REP" }` when this device holds that
//      person's REP, else `null` (show nothing; never a 0).
//   H4 `Rep.botCard()` — `ui/settings.js`'s Bot card, on the bot's own tab: the bot side's plain rows (its settings, the
//      export, the Replace flow, the Q4 offers), or `null` where it is not running.
const Rep = (() => {
  const _p = (get) => { try { return get() || null; } catch (e) { return null; } };
  const PIECES = () => [_p(() => RepReader), _p(() => RepBot)];
  function _each(f, arg) { for (const p of PIECES()) if (p && typeof p[f] === "function") { try { p[f](arg); } catch (e) {} } }
  function enter(ctx) { _each("enter", ctx || {}); }
  function leave(why) { _each("leave", why); }
  function badge(userId) {
    const r = _p(() => RepReader);
    if (!r || typeof r.badge !== "function") return null;
    try { return r.badge(userId) || null; } catch (e) { return null; }
  }
  function botCard() {
    const b = _p(() => RepBot);
    if (!b || typeof b.card !== "function") return null;
    try { return b.card() || null; } catch (e) { return null; }
  }
  return { enter, leave, badge, botCard };
})();
