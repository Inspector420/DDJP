// backends/backend1/dials.js
//
// ROOM DIALS — one home for every default, and one way to read one.
//
// This exists because the same numbers had started appearing in two places. `checkpointEvery: 40`
// and `checkpointRankOffsetMs: 5000` were written as fallbacks inside the checkpoint module while
// already living in the reducer's defaultSettings(). Two hand-maintained copies of one number is
// the failure this project records twice, and it is always invisible: the room sets a value, the
// event goes out, and one module keeps the old one.
//
// THE RULE: a module may READ a dial. It may never RESTATE a default.
//
// Reading through here also makes the frozen/live distinction impossible to get wrong by accident,
// because the two have different accessors and the wrong one is a visible mistake rather than a
// silent one.
//
// Depends on: StateDeriver (the one home for defaults). Pure.

const Dials = (() => {

  // FROZEN AT SONG START. Snapshotted onto the song when it begins, so a mid-song change governs
  // the NEXT song. Read these from nowPlaying.settings, never from the live blob — reading live
  // would let a settings change re-govern a song already playing, and the frozen snapshot would
  // then be a lie.
  const FROZEN = ["maxLen", "minLen", "minGate", "graceMs", "presendMs", "skipRoads"];

  // READ LIVE AT DECISION TIME. These govern BEHAVIOUR — who acts and when — never truth, so
  // reading them fresh is correct.
  // `minDjRank` (J07) is LIVE, and the reasoning is worth keeping because the obvious alternative
  // is wrong for a reason that is easy to miss. FROZEN means "snapshotted onto a SONG when it
  // starts"; a join is not a song, so there is no snapshot for it to read and `frozen()` would fall
  // through to `live()` on every call. Read fresh at decision time, combined with the reducer
  // folding settings AT LOG POSITION, gives exactly "whatever the owner had set when the join
  // happened" — the property wanted — without a snapshot existing at all.
  //
  // WHAT THIS CLASSIFICATION DOES NOT DO: it does not keep the key out of `nowPlaying.settings`.
  // That snapshot is `Object.assign({}, settings)` — the WHOLE blob, not the FROZEN subset — so
  // every setting is in every song's snapshot regardless of which list it appears in here. These
  // lists govern which ACCESSOR a reader must use, never what gets copied. Measured, not assumed
  // (tools/probes/probe-min-dj-rank.js Q3: the two key counts are equal).
  const LIVE = ["vouchTable", "checkpointTable", "vouchJitter", "receiptsPerMessage",
                "checkpointCooldownMs", "checkpointEvery", "checkpointRankOffsetMs",
                "selfWitnessCheckpoint", "minDjRank"];

  let _defaults = null;
  function _def() {
    if (_defaults) return _defaults;
    try { _defaults = StateDeriver.defaultSettings(); } catch (e) { _defaults = {}; }
    return _defaults;
  }

  // Read a LIVE dial. Missing or malformed falls back to the ONE default, never to a local literal.
  function live(settings, name) {
    if (LIVE.indexOf(name) < 0 && FROZEN.indexOf(name) < 0) return undefined;   // unknown dial
    const v = settings && settings[name];
    const d = _def()[name];
    if (typeof d === "number") return (typeof v === "number" && isFinite(v)) ? v : d;
    if (typeof d === "boolean") return (typeof v === "boolean") ? v : d;
    return (v === undefined || v === null) ? d : v;
  }

  // Read a FROZEN dial from a song's own snapshot, falling back to live settings only when there is
  // no snapshot at all (a song that started before the field existed).
  function frozen(nowPlaying, settings, name) {
    if (FROZEN.indexOf(name) < 0) return undefined;   // asking for a live dial the frozen way
    const snap = nowPlaying && nowPlaying.settings;
    if (snap && snap[name] !== undefined) return snap[name];
    return live(settings, name);
  }

  function isFrozen(name) { return FROZEN.indexOf(name) >= 0; }
  function isLive(name) { return LIVE.indexOf(name) >= 0; }
  function _resetForTest() { _defaults = null; }

  return { FROZEN: FROZEN.slice(), LIVE: LIVE.slice(), live, frozen, isFrozen, isLive, _resetForTest };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { Dials };
