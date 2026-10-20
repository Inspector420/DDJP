// backends/backend1/activity.js
// Activity — WHO DID WHAT KIND OF ACT, AND WHEN, kept beyond the log each engine holds (J73 job 2).
//
// Presence and AFK are answered by `Room.foldActivity` over the events an engine HOLDS. Both engines
// drop events — a shared room trims to its floor, a bot room opens from a save point — and a dropped
// event takes its evidence with it, so after a trim the People tab and the bot answered "can't tell"
// for an hour (`tools/probes/probe-j73-presence-reach.js`). The owner's rule: take what activity needs
// BEFORE anything is dropped. This module is where it is taken, and the one place it is kept (Q2:
// one module, called by each engine behind the seam — no copied rule, no room-type check).
//
// WHAT IS KEPT, AND NOTHING ELSE: per person, per activity group, the LATEST time — never the act.
// The group rule in force when an answer is READ decides what counts (Q4), so it is kept per group and
// filtered by `Room.foldActivity`, never here. Plus how far back the evidence reaches (`since`) and
// whether it reaches the room's start (`complete`). Not in any save point: it is not derived state.
//
// LEGALITY (Q3). A shared room takes evidence from events its fold has judged, so a REFUSED act counts
// for nobody — exactly as the held-log fold treats it. A bot room counts every relayed act: its judge
// refuses what the reducer would refuse (`B2Authority.evaluate`), so its log carries accepted acts only.
//
// CLEANS UP AFTER ITSELF. An entry older than the longest window the settings ALLOW (the ranges'
// maxima through the same formula the reads use) can never answer anything, so it goes.
const Activity = (function () {
  let _by = Object.create(null);
  let _since = null, _complete = false, _read = 0, _newest = null;

  function reset() { _by = Object.create(null); _since = null; _complete = false; _read = 0; _newest = null; }

  // The longest activity window any settings could ask for: every range at its maximum, through
  // `Capabilities.activityWindowMs` — the formula the reads use, so this cannot drift from them.
  // Unknown (a module missing) means keep everything: pruning on a guess could forget an answer.
  function maxWindowMs() {
    try {
      const R = StateDeriver.SETTING_RANGES;
      const top = {};
      for (const k of ["botAfkMs", "queueIdleMs", "botPingMs", "botPresencePingMs"]) top[k] = R[k].max;
      const w = Capabilities.activityWindowMs(top);
      return (typeof w === "number" && isFinite(w) && w > 0) ? w : Infinity;
    } catch (e) { return Infinity; }
  }
  function _groupOf(type, content) {
    try { return (typeof Capabilities !== "undefined" && Capabilities.activityGroupOf) ? Capabilities.activityGroupOf(type, content) : null; }
    catch (e) { return null; }
  }
  function _note(actor, grp, when) {
    if (!actor || grp === null || grp === undefined || typeof when !== "number" || !isFinite(when)) return;
    const row = _by[actor] || (_by[actor] = Object.create(null));
    if (!(grp in row) || when > row[grp]) row[grp] = when;
  }
  function _reach(ts) {
    if (typeof ts !== "number" || !isFinite(ts)) return;
    if (_since === null || ts < _since) _since = ts;
    if (_newest === null || ts > _newest) _newest = ts;
  }
  function prune(nowTs) {
    const now = (typeof nowTs === "number") ? nowTs : _newest;
    const max = maxWindowMs();
    if (typeof now !== "number" || !isFinite(max)) return 0;
    let n = 0;
    for (const a of Object.keys(_by)) {
      const row = _by[a];
      for (const g of Object.keys(row)) if (row[g] < now - max) { delete row[g]; n++; }
      if (!Object.keys(row).length) delete _by[a];
    }
    return n;
  }

  // TAKE BEFORE DROPPING — reducer-shaped events an engine is about to drop. `isLegal(id)` is the
  // fold's verdict; `false` means refused and counts for nobody. Pass `null` where every act in the
  // log was accepted by construction (a bot room: Q3). `opts.complete` says the dropped events
  // together with what was taken before them reach the room's start.
  function take(events, isLegal, opts) {
    for (const e of (Array.isArray(events) ? events : [])) {
      if (!e || typeof e.ts !== "number") continue;
      _reach(e.ts); _read++;
      if (typeof isLegal === "function" && isLegal(e.eventId) === false) continue;
      _note(e.sender, _groupOf(e.type, e.content), e.ts);
    }
    if (opts && opts.complete === true) _complete = true;
    prune();
    return { since: _since, complete: _complete };
  }

  // THE BOT ROOM'S BACKGROUND READ — raw carriers in its events room, read back past the save point.
  // Moved here unchanged from backend2's door so there is one store. Every raw read extends `since`,
  // whatever it carries: an hour of nothing but chat is still an hour in which nobody acted.
  function noteRaws(raws, logRoomId, opts) {
    for (const raw of (raws || [])) {
      if (!raw || typeof raw.ts !== "number" || !isFinite(raw.ts)) continue;
      _reach(raw.ts); _read++;
      if (!logRoomId || raw.room_id !== logRoomId || !raw.content || typeof raw.content.body !== "string") continue;
      let parsed = null;
      try { parsed = JSON.parse(raw.content.body); } catch (e) { continue; }
      if (!parsed || typeof parsed.t !== "string") continue;
      const acts = (parsed.t === "ddjp.batch") ? (Array.isArray(parsed.evs) ? parsed.evs : []) : [parsed];
      for (const a of acts) {
        if (!a || typeof a.t !== "string" || typeof a.actor !== "string" || !a.actor) continue;
        _note(a.actor, _groupOf(a.t, a), (typeof a.at === "number" && isFinite(a.at)) ? a.at : raw.ts);
      }
    }
    if (opts && opts.complete === true) _complete = true;
    prune();
    return { since: _since, complete: _complete };
  }

  // What `Room.foldActivity` merges with the held log. Null when nothing has been read: no list is
  // not the same as "nobody", and Room must then answer from the held log alone.
  function read() {
    if (!_read && !_complete) return null;
    return { by: _by, since: _since, complete: _complete };
  }
  function covered(nowTs, windowMs) {
    if (_complete) return true;
    if (_since === null || typeof nowTs !== "number" || typeof windowMs !== "number") return false;
    return (nowTs - _since) >= windowMs;
  }
  function size() { let n = 0; for (const a of Object.keys(_by)) n += Object.keys(_by[a]).length; return n; }

  return { reset, take, noteRaws, read, covered, prune, maxWindowMs, size };
})();
if (typeof module !== "undefined" && module.exports) module.exports = { Activity };
