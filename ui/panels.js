// ui/panels.js
// LOGS · WHO'S HERE · ROOM HISTORY — the read-only panels. Extracted from
// ui/interface.js at ddjp_387 as the second of the ten files roles.md §5 records.
//
// ── THE EVENT FEED PANEL IS GONE (ddjp_425); THE CUT RULE IT TAUGHT IS NOT ─────────────────────
// The feed's rows now sit between chat messages (`ui/chat.js` §CHAT, owner ruling) and its panel
// left this file. The record below is kept because it is about the CUT, not the panel:
// `renderRoster`, `rankSelect`, `renderUpgradePanel` and `runUpgrade` sit BELOW the
// `THE EVENT FEED (J13)` banner in ui/interface.js while their own banner — JOIN BUTTON, ROSTER,
// UPGRADE — is over a thousand lines earlier. They are the roster's and they stayed. **The banner
// is a reading aid; the cluster is an ownership unit**, and a region is bounded by where its own
// declarations END. Cutting this cluster on the banner span would have moved four roster
// declarations into this file.
//
// ── THE LOG FILTER STATE IS OWNED HERE AND WRITTEN THROUGH SETTERS ───────────────────────────
// `_logLevel` and `_logCat` are declared here and were written from `buildMainDom`'s two
// `onchange` handlers. Leaving those writes behind would have ui/shell.js rebinding variables
// this file owns, which is the seam shape that HALTs. The setters below keep the owner the owner
// and run exactly the body the handlers ran — location, not behaviour, and the same shape as the
// `player` / `playerReady` accessors established for ui/player.js.
//
// Depends on: UIBase, Interface (via UIBase.host), Logger, Room, Continuity, StateDeriver

const Panels = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;   // el, clear, shortName, rankColor, _rosterLevel, songRow,
                           // _renderWindowedStack, _addToPlaylistBtn, _wireCardTrigger

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ LOGS PANEL
  //
  // The in-app log view. Logger output lands here, not in the browser console.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- Logger → Logs tab -----------------------------------------------------
  // The bottom debug log, relocated into the Logs tab. Lines from BEFORE this
  // page load (restored from storage) render grey; lines logged in THIS session
  // render green. Persisted (capped) so "older" actually exists across reloads.
  // ── HOW MUCH OF A SESSION THE PANEL CAN ACTUALLY HOLD ────────────────────────────────────
  // 300 was set when the log was quiet. The decision trail added since — SONG, ADVANCE, ORDER,
  // LEN — is what makes a stalled room readable, and it costs lines.
  //
  // THE PRESSURE IS REPLAY, not steady play, and that part is arithmetic rather than a guess:
  // joining a room ingests its whole history and every ingest logs a line, so a room with 300
  // events fills the panel before a single song has played. Steady play is far cheaper — roughly
  // ten lines a song — so the cap is spent on JOINING, which is exactly when the interesting part
  // happens. The OLDEST lines roll off first: startup, floor adoption, and the first thing that
  // went wrong. A line is a short string, so 2000 costs little in memory or in the stored record.
  const _logCap = 2000;
  // WHAT THE PANEL SHOWS. The full log is always kept and always copied; this only filters the
  // view, so turning the noise down can never lose evidence that was already recorded.
  const _LOG_LEVELS = ["debug", "info", "warn", "error"];
  let _logLevel = "debug";                    // show everything until asked otherwise
  function _lineLevel(line) {
    const m = /^\[(debug|info|warn|error)\]/.exec(line || "");
    // An unprefixed line is treated as INFO — visible by default, hidden at warn-and-above like
    // any other info line. Stated because the first version of this comment claimed it always
    // showed, which the comparison below does not do, and a note that promises more than the code
    // delivers is the thing this tree keeps having to delete.
    return m ? m[1] : "info";
  }
  function _passesLevel(line) {
    return _LOG_LEVELS.indexOf(_lineLevel(line)) >= _LOG_LEVELS.indexOf(_logLevel);
  }
  // ── THE SECOND FILTER: WHICH MODULE IS TALKING ───────────────────────────────────────────
  // The level filter answers "how bad", and that is the wrong axis for the question people
  // actually arrive with, which is "what is the BOT doing". Every interesting bot line is `info`,
  // and so are MatrixBridge's 74 and Room's 58 — so turning the level up hides the subject along
  // with the noise, and leaving it down buries seven lines under several hundred.
  //
  // THE CATEGORY IS THE PREFIX THE TREE ALREADY WRITES, not a new field on Logger. 88% of log
  // calls open with `Module: `, including the diagnostic families — `StreamManager: ORDER …`,
  // `MatrixBridge: SEAL …`, `Playback: ADVANCE …` — so the vocabulary exists and is maintained by
  // use. A `category` argument added to `Logger.debug/info/warn/error` would be a SECOND way of
  // saying what the string already says, free to disagree with it, and it would have to be
  // threaded through every Logger call site in the tree to be complete. Derived, not declared: a module that starts
  // logging appears in the picker on its own, and one that stops disappears.
  //
  // VIEW-ONLY, exactly like the level above, and for the reason stated there: the full log is
  // always held and `_logText` always copies everything, so narrowing to one module can never
  // discard the line somebody needed. That matters more here than for the level, because the
  // reason to narrow is that you are hunting something and do not yet know what.
  const _LOG_CAT_ALL = "*";
  const _LOG_CAT_OTHER = "other";
  let _logCat = _LOG_CAT_ALL;
  // ── THE TIME, WHICH `Logger` ALREADY COMPUTED AND THIS PANEL WAS DISCARDING ───────────────
  // Every entry carries `ts: Date.now()` and the line built below used to drop it. Everything the
  // bot does is a DURATION — `botAfkMs`, `botPingMs`, `queueIdleMs`, the sweep's own minute — so a
  // log without times cannot tell one sweep from forty, cannot measure the gap between a warning
  // and the removal it authorises, and cannot tell a stalled room from a quiet one. That last
  // distinction is the one that ran unnoticed for two days here.
  //
  // AFTER THE LEVEL TAG, NOT BEFORE IT, AND THAT PLACEMENT IS LOAD-BEARING. `_lineLevel` and
  // `_lineCategory` both anchor on `^[level]`; a stamp in front of it would leave every line
  // reading as level `info` and category `other`, which is a filter that silently stops filtering
  // rather than one that breaks visibly.
  //
  // LOCAL CLOCK, and `_logText` says so once at the top rather than every line saying it. No date
  // per line: `_priorLog` can be days old, so the DATE is carried by the session banners in
  // `_logText` where it is stated once, and the per-line cost stays twelve characters.
  function _stamp(ts) {
    const d = new Date((typeof ts === "number" && isFinite(ts)) ? ts : Date.now());
    const p2 = (n) => (n < 10 ? "0" : "") + n;
    const p3 = (n) => (n < 100 ? (n < 10 ? "00" : "0") : "") + n;
    return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()) + "." + p3(d.getMilliseconds());
  }
  // The stored line is `[level] HH:MM:SS.mmm Module: message`, so the level tag comes off first
  // and the stamp second. BOTH STRIPS ARE OPTIONAL-MATCHING, because `_priorLog` is restored from
  // storage and lines written before the stamp existed carry none — a required strip would send
  // every one of them to `other` on the first load after an upgrade, which reads as the previous
  // session having no modules in it.
  function _lineCategory(line) {
    const t = String(line == null ? "" : line)
      .replace(/^\[(?:debug|info|warn|error)\]\s*/, "")
      .replace(/^\d{2}:\d{2}:\d{2}\.\d{3}\s+/, "");
    const m = /^([A-Za-z][A-Za-z0-9_]*):/.exec(t);
    return m ? m[1] : _LOG_CAT_OTHER;
  }
  function _passesCategory(line) {
    return _logCat === _LOG_CAT_ALL || _lineCategory(line) === _logCat;
  }
  // The categories PRESENT in the log, sorted. Derived on demand rather than accumulated, so a
  // category cannot outlive the lines that produced it — the picker describes the log in the box,
  // never a list of what some module might one day say.
  function _logCategories(lines) {
    const seen = Object.create(null);
    for (const l of lines) seen[_lineCategory(l)] = true;
    return Object.keys(seen).sort();
  }
  let _priorLog = [];
  let _sessionLog = [];
  // Captured at load rather than at the first log line: a room that boots quietly would otherwise
  // date its session from whenever something first went wrong.
  const _sessionStart = Date.now();
  // ── THE COPY-OUT, WITH THE ONE THING THE SCREEN SHOWS AND THE CLIPBOARD LOST ──────────────
  // The panel renders prior-session lines grey and this session's green, and the copied text had
  // NO equivalent — the two runs ran straight together. So a reader of a pasted log could take a
  // stale `bot mode on` from yesterday as the current run, with nothing on the page to correct
  // them. That is a plausible value at document scale, and the copy is the form the log is
  // actually read in, because nobody diagnoses by scrolling somebody else's screen.
  //
  // THE BANNERS ARE BUILT HERE AND NOWHERE ELSE. They must never be pushed into `_priorLog` or
  // `_sessionLog`: those two arrays are what `_saveLogSoon` persists, so a banner placed in them
  // would be restored as an ordinary line next session, banner-ed again by the session after
  // that, and accumulate one marker per reload forever.
  //
  // Unfiltered, as before — a report carries what happened rather than what the reader was
  // looking at when they pressed the button.
  function _logFullStamp(ts) {
    try { return new Date(ts).toLocaleString(); } catch (e) { return String(ts); }
  }
  function _logText() {
    const out = [];
    out.push("=== DDJP log — copied " + _logFullStamp(Date.now()) +
             " — line times are this device's LOCAL clock ===");
    if (_priorLog.length) {
      out.push("=== " + _priorLog.length + " line(s) below are from an EARLIER SESSION, not from " +
               "the run that follows ===");
      for (const l of _priorLog) out.push(l);
    }
    out.push("=== " + _sessionLog.length + " line(s) below are THIS session, which began " +
             _logFullStamp(_sessionStart) + " ===");
    for (const l of _sessionLog) out.push(l);
    return out.join("\n");
  }
  // Hydrate the prior log asynchronously (Store.logs is now IndexedDB-backed).
  // Only seeds _priorLog; _sessionLog accumulates live, so a late resolve is safe.
  Promise.resolve(Store.logs.load()).then((saved) => {
    if (Array.isArray(saved)) _priorLog = saved.slice(-_logCap);
  }).catch(() => {});
  let _logSaveTimer = null;
  function _saveLogSoon() {
    if (_logSaveTimer) return;
    _logSaveTimer = setTimeout(() => {
      _logSaveTimer = null;
      try { Store.logs.persist(_priorLog.concat(_sessionLog).slice(-_logCap)); } catch (e) {}
    }, 800);
  }
  function _appendLogRow(text, fresh) {
    if (!refs.logsBox) return;
    // Filtered from the VIEW only; still held and copied. BOTH filters are asked here rather than
    // one here and one in renderLogs, so a live line and a re-rendered one can never disagree
    // about whether it is shown.
    if (!_passesLevel(text) || !_passesCategory(text)) return;
    // STICK TO THE BOTTOM ONLY IF ALREADY THERE. Appending used to force a scroll on every line,
    // so reading anything older than the last screenful was impossible in a busy room — the log
    // yanked itself away mid-read. Within a few pixels counts as "at the bottom".
    const box = refs.logsBox;
    const atBottom = (box.scrollHeight - box.scrollTop - box.clientHeight) < 24;
    box.appendChild(H.el("div", { class: "log-line " + (fresh ? "fresh" : "old") + " lvl-" + _lineLevel(text), text: text }));
    while (box.childNodes.length > _logCap) box.removeChild(box.firstChild);
    if (atBottom) box.scrollTop = box.scrollHeight;
  }
  // The picker's options are rebuilt here rather than on every arriving line, because rebuilding a
  // select per log message is the shape `_updateLogCount` already had to be rescued from. This
  // runs when a human is looking — the tab opens, or a filter changes — so a module that has only
  // just started logging appears the next time either happens.
  function _syncLogCatOptions() {
    const sel = refs.logsCat;
    if (!sel) return;
    const cats = _logCategories(_priorLog.concat(_sessionLog));
    // A selection naming a category the log no longer holds falls back to ALL. Leaving it selected
    // would render an empty panel, which is indistinguishable from a broken one — and the count
    // beside it would read `0 of 1400 lines`, which reads as a fault rather than as a filter.
    if (_logCat !== _LOG_CAT_ALL && cats.indexOf(_logCat) < 0) _logCat = _LOG_CAT_ALL;
    H.clear(sel);
    const all = H.el("option", { value: _LOG_CAT_ALL, text: "all modules" });
    all.value = _LOG_CAT_ALL;
    sel.appendChild(all);
    for (const c of cats) {
      const o = H.el("option", { value: c, text: c });
      o.value = c;
      sel.appendChild(o);
    }
    sel.value = _logCat;
  }
  function renderLogs() {
    if (!refs.logsBox) return;
    _syncLogCatOptions();
    H.clear(refs.logsBox);
    for (const line of _priorLog) _appendLogRow(line, false);
    for (const line of _sessionLog) _appendLogRow(line, true);
    _updateLogCount();
  }
  Logger.on(entry => {
    const line = "[" + entry.level + "] " + _stamp(entry.ts) + " " + entry.message;
    _sessionLog.push(line);
    if (_sessionLog.length > _logCap) _sessionLog.shift();
    _saveLogSoon();
    _appendLogRow(line, true);
    _updateLogCount();
  });

  // ── THE COUNTER IS UPDATED, NOT RE-RENDERED ────────────────────────────────────────────────
  // The first version of this called renderLogs() on every incoming line to keep the count
  // honest, which clears the container and rebuilds every row — up to two thousand DOM nodes per
  // log message, in the panel whose whole purpose is being readable while a room is busy. The
  // count is two numbers; only the two numbers need to change.
  function _updateLogCount() {
    if (!refs.logsCount) return;
    const shown = refs.logsBox ? refs.logsBox.childNodes.length : 0;
    const total = _priorLog.length + _sessionLog.length;
    refs.logsCount.textContent = (shown === total) ? (total + " lines")
                                                   : (shown + " of " + total + " lines");
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ ROOM HISTORY
  //
  // Newest first, read through the feature seam so it survives a trim.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // ROOM HISTORY — the shared, DERIVED play log (newest-first, "time ago")
  // ---------------------------------------------------------------------------
  // Not a stored list: it is StateDeriver's `history` (a byproduct of the same
  // pure fold that produces now-playing), so every client shows the same record
  // and it survives reload via replay (14: Room History is a derived shared view,
  // not a separate store). It therefore includes songs that played BEFORE you
  // arrived / while away — songs you didn't witness. Rows render cacheOnly
  // (thumbnail/title only if already known): a WITNESSED song is known because the
  // player pushed its title on play (_pushPlayerMeta); an UNWITNESSED song shows
  // id-only until you open its preview (clicking the thumbnail), which fetches title +
  // thumbnail on demand (no ambient load — same restraint as the room queue).
  const HISTORY_SHOW = 500;          // most-recent plays shown (the derived array is itself bounded)
  function _fmtAgo(at, now) {
    if (typeof at !== "number" || at <= 0) return "";
    const s = Math.max(0, Math.floor(((now || Date.now()) - at) / 1000));
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? " min ago" : " mins ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hr ago" : " hrs ago");
    const d = Math.floor(h / 24);
    return d + (d === 1 ? " day ago" : " days ago");
  }
  // On-demand metadata for an unwitnessed history row now rides the SAME path as every
  // other row: clicking the thumbnail opens the preview, which fetches title + thumbnail
  // (_previewFetch). There's no separate ↻ button — one affordance, less row clutter.
  function renderHistory() {
    const rows = (Queue.recentHistory ? Queue.recentHistory(HISTORY_SHOW) : []);   // newest-first, via the feature layer
    if (!rows.length) {
      refs.queueBody.appendChild(H.el("p", { class: "muted", text: "Nothing has played yet" }));
      return;
    }
    // ── SAY HOW MUCH OF THE ROOM THIS ACTUALLY IS ────────────────────────────────────────────
    // The module reports its reach honestly and nothing was showing it. A pane that says "the last
    // 40 songs" is useful; one that implies it has everything when it holds a window is not — and
    // this pane has spent a while quietly holding a window while looking complete.
    try {
      const cov = (Queue.historyReach ? Queue.historyReach() : null);
      if (cov && cov.entries) {
        refs.queueBody.appendChild(H.el("p", { class: "muted history-reach", text:
          cov.complete ? (cov.entries + " songs — the whole room")
                       : (cov.entries + " songs — as far back as this client can reach") }));
      }
    } catch (e) {}
    // SERVER time: a row's `at` is the reducer's `startedAt`, a homeserver stamp, and "x mins ago"
    // against a device clock minutes off the server narrates something that just played as minutes
    // ago — the mix README trap 2 refuses (roadmap §9 W).
    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : Date.now();
    // THE JOIN, MADE HERE. Both tables key on the play instance, so a row's reactions are
    // counts[row.pi] — this playing's own, not the song's running total. Two plays of one track
    // are two rows showing two different figures, which is the whole point of a playing having
    // its own identity. Done at render because a history row records WHAT PLAYED and a vote must
    // not mutate that record (check-reactions).
    const counts = (typeof Queue !== "undefined" && Queue.getState) ? (Queue.getState().counts || {}) : {};
    rows.forEach((h) => {
      const c = counts[h.pi] || null;
      const reactions = c
        ? ((c.votes ? " · ▲ " + c.votes : "") + (c.saves ? " · ★ " + c.saves : ""))
        : "";
      const row = PlaylistPanels.songRow(h.videoId, {
        thumbMode: "cacheOnly",                       // display-if-known; no ambient fetch
        sub: _fmtAgo(h.at, now) + (h.skipped ? " · skipped" : "") + reactions,
        actions: [PlaylistPanels._addToPlaylistBtn(h.videoId)],      // ＋ → save this song into a playlist
      });
      // DJ name goes on the SUB line (rank-colored), so the row keeps the same
      // 2-line shape (title + sub) as My Queue's rows. Prepending it into .sr-main
      // made history a 3-line row, which left the fixed 30px thumb undersized and
      // off-centre in a taller row — the "wrong size square areas" mismatch.
      const sub = row.querySelector(".sr-sub");
      if (sub) {
        const who = H.el("span", { class: "sr-who", text: H.shortName(h.dj) });
        who.style.color = H.rankColor(H._rosterLevel(h.dj));
        sub.insertBefore(who, sub.firstChild);
      }
      refs.queueBody.appendChild(row);
    });
  }


  // ══ WHO HAS DONE SOMETHING RECENTLY (J16) ═══════════════════════════════════════════════════
  // Three declarations, extracted by name and EXECUTED by `check-who-is-here` — the fifth guard in
  // the tree to run this file rather than read it, after `check-blocked-wire`, `check-playback-end`
  // part 5, `check-user-card` and `check-dm-panel`. Nine guards read `ui/interface.js` as source
  // text and a regex proving a sentence is SPELLED here would prove nothing about whether the
  // panel ever says it.

  // Pure. A duration in server-stamp milliseconds as words. Rounds DOWN, so the panel never claims
  // to have looked further back than it did — the same direction every bound in this feature takes.
  function _spanText(ms) {
    const m = Math.floor((typeof ms === "number" && isFinite(ms) && ms > 0 ? ms : 0) / 60000);
    if (m < 1) return "less than a minute";
    if (m === 1) return "1 minute";
    if (m < 60) return m + " minutes";
    const h = Math.floor(m / 60), r = m % 60;
    const hs = h === 1 ? "1 hour" : h + " hours";
    return r === 0 ? hs : hs + " " + (r === 1 ? "1 minute" : r + " minutes");
  }

  // Pure. Turns one fold into the strings the panel shows. Separate from the renderer so the
  // HONESTY of the label can be driven directly, which is the whole reason this job exists: the
  // Done-when asks that the list be honestly labelled, and a label is a claim about behaviour like
  // any other (`roles.md` §10's second signature).
  //
  // THE STATED SPAN IS THE EFFECTIVE WINDOW, NEVER THE REQUESTED ONE. That single substitution is
  // what keeps the panel from claiming a reach it does not have, and it is the line the mutation
  // pass aims at: with the requested window here, a freshly-loaded or freshly-trimmed room says
  // "in the last 15 minutes" over a log holding four, which is true of nothing and reads as fact.
  function _activityLabel(fold) {
    const f = fold || {};
    const people = Array.isArray(f.people) ? f.people : [];
    const n = people.length;
    const span = _spanText(f.effectiveWindowMs);
    return {
      count: n,
      heading: n === 1 ? "1 person active" : n + " people active",
      // The claim, and it is deliberately about ACTIVITY rather than presence. There is no presence
      // protocol here, so "who is here" is not a question this system can answer at all.
      window: n === 0 ? ("Nobody has done anything in the last " + span)
                      : ("Did something in the last " + span),
      // Named BOTH ways round when the window is wider than what this client holds, because the
      // discrepancy is the information: one number is what you asked for and the other is what
      // there was to look at. A young room reaches this the same way a trimmed one does.
      reachNote: f.bounded
        ? ("Your window is " + _spanText(f.requestedWindowMs) + ", but this client holds only " +
           _spanText(f.reach) + " of this room — anything older has been forgotten or was never seen.")
        : "",
      // THE LIMIT, STATED RATHER THAN IMPLIED. Chat is Skin: `_routeEvent` skips chat-named rooms
      // before both the store and the fold, so a chat message reaches the raw listeners and nothing
      // else and a person who has only chatted is invisible here. Three of the four sources J16's
      // entry names, and saying "activity" without saying which would imply the fourth.
      // ── THE ROOM DECIDES WHAT COUNTS; THIS DEVICE DECIDES HOW FAR BACK IT LOOKS ─────────────
      // Two settings, two questions, and until this was settled they were two ANSWERS to one
      // question — the panel counted from a device-local window while `botPresenceSpine` /
      // `botPresenceChat` / `botAfkMs` are room truth, so the People list and a bot's channel
      // membership would list different people, each correct by its own rule.
      //
      // The rule is now READ FROM THE ROOM and stated here, so a person can see which definition
      // produced the list rather than assuming the only one they know about.
      sources: (f.sources && f.sources.spine === false)
        ? "This room is not counting queue activity, so nobody is listed as around."
        : "Counts queue actions, votes and saves, as this room defines being around. Actions the " +
          "room refused are not counted.",
      // AND WHERE THIS PANEL CANNOT HONOUR THE ROOM'S RULE, IT SAYS SO INSTEAD OF IMPLYING
      // AGREEMENT. `botPresenceChat` is not a filter the fold is missing — chat never reaches the
      // log and cannot, so a room counting chat has a definition of *active* this panel is
      // structurally incapable of computing. The list is then a SUBSET, and a person comparing it
      // with what a bot does needs to know that before they conclude one of them is wrong.
      unobservable: (f.unobservable && f.unobservable.length)
        ? "This room also counts chat as being around, and this list cannot see chat — so it shows " +
          "fewer people than the room considers active. The difference is not a fault in either."
        : "",
    };
  }

  // The panel. Renders what the feature layer hands it and decides nothing: it does not filter by
  // window, does not compute recency, and does not sort — every one of those is `Room.foldActivity`'s
  // and a second copy here is the drift P7 is about.
  function renderActivePanel() {
    if (!refs.activeBox) return;
    H.clear(refs.activeBox);
    // ServerClock, never Date.now() (P2). Every `ts` in the log is the homeserver's stamp, so the
    // reference this is measured against has to be one too. With no offset learned yet serverNow()
    // degrades to the local clock, which is this client's best available answer and never worse
    // than what it does today.
    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;
    // NO WINDOW SUPPLIED. `recentlyActive` reads the room's rule — window and sources both — so
    // there is nothing for this panel to disagree through.
    let fold;
    try { fold = Room.recentlyActive(now); }
    catch (e) { return; }
    const lab = _activityLabel(fold);

    refs.activeBox.appendChild(H.el("div", { class: "active-head", text: lab.heading }));
    refs.activeBox.appendChild(H.el("p", { class: "muted active-window", text: lab.window }));
    if (lab.reachNote) {
      refs.activeBox.appendChild(H.el("p", { class: "muted active-reach", text: lab.reachNote }));
    }
    for (const p of (fold.people || [])) {
      const nameEl = H.el("span", { class: "who", text: H.shortName(p.userId) });
      nameEl.style.color = H.rankColor(H._rosterLevel(p.userId));
      // The same one trigger every surface uses (J14), so the card and its keyboard path cannot be
      // right in four places and forgotten in the fifth.
      Roster._wireCardTrigger(nameEl, p.userId);
      refs.activeBox.appendChild(H.el("div", { class: "person active-person" }, [
        nameEl,
        H.el("span", { class: "active-acts", text: p.acts === 1 ? "1 action" : p.acts + " actions" }),
      ]));
    }
    refs.activeBox.appendChild(H.el("p", { class: "muted active-sources", text: lab.sources }));
    if (lab.unobservable) {
      refs.activeBox.appendChild(H.el("p", { class: "muted active-unobservable", text: lab.unobservable }));
    }
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  //
  // What ui/interface.js may call. The log-filter setters exist because the two `<select>`
  // elements are built in `buildMainDom` and the state they drive is declared here; a second
  // copy of either scalar would be two variables describing one filter.
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    renderLogs, _logText, _fmtAgo, renderHistory, renderActivePanel,
    logLevels: () => _LOG_LEVELS,
    logLevel: () => _logLevel,
    setLogLevel: (v) => { _logLevel = v; renderLogs(); },
    setLogCat: (v) => { _logCat = v; renderLogs(); },
  };
})();
