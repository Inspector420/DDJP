// features/history-ports.js — 738: THE SONG HISTORY BOT'S BOUNDARY, in REP's shape (the owner's design, `consensus/history-rules.md` §12;
// REP's door is the model, `features/rep-ports.js`). Every call the bot side (`features/history-bot.js`) makes into the rest of the app
// goes through one of the ports below, and nothing else of it names an app global. `check-history-bot-boundary` holds both halves: the
// bot names only `HistorySummary` (the format, `core/historysummary.js`, pure) and `HistoryPorts`; outside its two files the app names
// `HistoryBot` only at its two hook sites in `features/room.js`; and every port is exported, listed, called by the bot, and a single
// pass-through to a function that exists on both engines.
//
// Depends on (at CALL time, never at load time): MatrixBridge, StreamManager, ServerClock, Store, BotRuntime, Logger.
//
// THE PORTS ARE THIN ON PURPOSE (REP's rule): each one is a single call with its answer passed through, and each answers safely when its
// module is not there — an empty list, null, `false`, a refused promise — never a throw. A decision made here would be the bot's logic
// outside the bot.
const HistoryPorts = (() => {
  const _m = (get) => { try { return get() || null; } catch (e) { return null; } };
  const MB = () => _m(() => MatrixBridge), SM = () => _m(() => StreamManager), SC = () => _m(() => ServerClock);
  const ST = () => _m(() => Store), BR = () => _m(() => BotRuntime), LG = () => _m(() => Logger);
  const _has = (g, f) => !!g && typeof g[f] === "function";

  // P1 — song history as this tab holds it: its rows (newest first, as `roomHistory` gives them), its coverage, the summaries it took
  // (the bot's marks), a stretch as this tab holds it (the count re-send's rows).
  function rows() { try { return _has(MB(), "roomHistory") ? (MB().roomHistory() || []) : []; } catch (e) { return []; } }
  function coverage() { try { return _has(MB(), "historyCoverage") ? (MB().historyCoverage() || null) : null; } catch (e) { return null; } }
  function marks() { try { return _has(MB(), "historySummaries") ? (MB().historySummaries() || []) : []; } catch (e) { return []; } }
  function readingOf(from, to) { try { return _has(MB(), "historyReadingOf") ? (MB().historyReadingOf(from, to) || []) : []; } catch (e) { return []; } }
  // ...whether a run of song history's reading is in flight (`false`: none, or the transport cannot say — then nothing waits on it),
  // and the reader run once more: the song history channel read back, as every device reads it, so the bot's own echo becomes a mark.
  function busy() { try { return _has(MB(), "historyIdle") ? MB().historyIdle() !== true : false; } catch (e) { return false; } }
  function readBack() { if (!_has(MB(), "readHistorySummaries")) return Promise.resolve(null); return Promise.resolve().then(() => MB().readHistorySummaries()); }
  // ...and song history's reading run again (`rearmHistoryBackfill`: one coalesced run, the `ddjp_735` way), for a table that still
  // has a hole — a tab that saw its room from creation never read the room's first position back, so it never holds the start.
  function rearm() { try { if (_has(MB(), "rearmHistoryBackfill")) MB().rearmHistoryBackfill(); } catch (e) {} }
  // ...and that it wrote (song history's notice, through the transport): a reason to look again.
  function onHistoryChange(fn) { try { if (_has(MB(), "onHistoryChange")) MB().onHistoryChange(fn); } catch (e) {} }
  function offHistoryChange(fn) { try { if (_has(MB(), "offHistoryChange")) MB().offHistoryChange(fn); } catch (e) {} }

  // P2 — side messages: the live raw feed (the bot's own echo), and one summary out on the room's song history channel (736's keyed
  // send: only a `history` row of the plan, at its level, through `sendEvent` and the transport's push-back hold, in both engines).
  function onRaw(fn) { try { if (_has(MB(), "onRawEvent")) MB().onRawEvent(fn); } catch (e) {} }
  function offRaw(fn) { try { if (_has(MB(), "offRawEvent")) MB().offRawEvent(fn); } catch (e) {} }
  function sendSide(channels, type, body) {
    if (!_has(MB(), "sendSide")) return Promise.resolve({ ok: false, reason: "no transport" });
    return Promise.resolve().then(() => MB().sendSide(channels, type, body, "history_owner"));
  }

  // P3 — the room: the play now playing (the reducer's `nowPlaying.pi`, or null) and its settings (songs per summary, read live).
  function playingPi() { try { const np = _has(SM(), "getState") ? (SM().getState() || {}).nowPlaying : null; return (np && typeof np.pi === "string") ? np.pi : null; } catch (e) { return null; } }
  function settings() { try { return (_has(SM(), "getState") && SM().getState().settings) || null; } catch (e) { return null; } }

  // P4 — whether this tab may say anything (`mayAuthor`: caught up), and that it is caught up again; server time, in whole milliseconds
  // (REP's reading: the serial and the spacing are judged by it, never by the device's clock); this account; whether this tab is the
  // room's bot (the runtime's one answer, as REP asks it).
  function mayAuthor() { try { return _has(MB(), "mayAuthor") ? (MB().mayAuthor() || {}).ok === true : false; } catch (e) { return false; } }
  function onCaughtUp(fn) { try { if (_has(MB(), "onAuthorReady")) MB().onAuthorReady(fn); } catch (e) {} }
  function serverNow() {
    try { if (!_has(SC(), "serverNow")) return null; const t = SC().serverNow(); return (typeof t === "number" && isFinite(t)) ? Math.floor(t) : null; }
    catch (e) { return null; }
  }
  function myId() { try { return _has(MB(), "getUserId") ? MB().getUserId() : null; } catch (e) { return null; } }
  function actingAsBot() { try { return _has(BR(), "actingAsBot") ? BR().actingAsBot() === true : false; } catch (e) { return false; } }

  // P5 — the single writer: one tab of this account per room sends summaries (`Store.history.writerLock`, REP's lock step under its
  // own name). `null` when this browser has none.
  function writerLock(spaceId, held) {
    try { return (ST() && ST().history && typeof ST().history.writerLock === "function") ? ST().history.writerLock(spaceId, held) : Promise.resolve(null); }
    catch (e) { return Promise.resolve(null); }
  }

  // The log, one line each, prefixed so every line reads `History bot: …`.
  function log(level, msg) { try { const L = LG(); if (L && typeof L[level] === "function") L[level]("History bot: " + msg); } catch (e) {} }

  // THE LIST, as data: `check-history-bot-boundary` compares it with what this object exports and with what the bot calls.
  const PORTS = ["rows", "coverage", "marks", "readingOf", "busy", "readBack", "rearm", "onHistoryChange", "offHistoryChange",
    "onRaw", "offRaw", "sendSide", "playingPi", "settings", "mayAuthor", "onCaughtUp", "serverNow", "myId", "actingAsBot", "writerLock", "log"];

  return { PORTS, rows, coverage, marks, readingOf, busy, readBack, rearm, onHistoryChange, offHistoryChange,
    onRaw, offRaw, sendSide, playingPi, settings, mayAuthor, onCaughtUp, serverNow, myId, actingAsBot, writerLock, log };
})();
