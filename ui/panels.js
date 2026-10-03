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
  // ── NO CLOCK IS A DEFAULT (ddjp_448) ─────────────────────────────────────────────────────────
  // `at` is a SERVER stamp, so `now` must be the server's too. It used to default to the DEVICE
  // clock, and the DM list relied on that — README.md's second trap, wrong on any device whose clock
  // is off. The default is gone rather than documented: without a `now` there is NO age, which is
  // visibly absent, rather than a plausible one. Callers go through `agoFromServer`, which reads
  // the server clock in one place; `check-feed-tab` PART G drives it and derives the callers.
  function _fmtAgo(at, now) {
    if (typeof at !== "number" || at <= 0) return "";
    if (typeof now !== "number" || !isFinite(now) || now <= 0) return "";
    const s = Math.max(0, Math.floor((now - at) / 1000));
    if (s < 45) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + (m === 1 ? " min ago" : " mins ago");
    const h = Math.floor(m / 60);
    if (h < 24) return h + (h === 1 ? " hr ago" : " hrs ago");
    const d = Math.floor(h / 24);
    if (d < 30) return d + (d === 1 ? " day ago" : " days ago");
    // PAST A MONTH, MONTHS; PAST A YEAR, YEARS (owner ruling, ddjp_485) — "400 days ago" is a number nobody
    // reads. A month is 30 days, kept to 1–11 so it never says "12 months"; a year is 365 days.
    if (d < 365) { const mo = Math.min(11, Math.floor(d / 30)); return mo + (mo === 1 ? " month ago" : " months ago"); }
    const y = Math.floor(d / 365);
    return y + (y === 1 ? " year ago" : " years ago");
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
    const now = _serverNow();   // never the device clock: `_fmtAgo` gives no age without the server's
    // THE JOIN, MADE HERE. Both tables key on the play instance, so a row's reactions are
    // counts[row.pi] — this playing's own, not the song's running total. Two plays of one track
    // are two rows showing two different figures, which is the whole point of a playing having
    // its own identity. Done at render because a history row records WHAT PLAYED and a vote must
    // not mutate that record (check-reactions).
    const counts = (typeof Queue !== "undefined" && Queue.getState) ? (Queue.getState().counts || {}) : {};
    // A PAST ROW CARRIES ITS OWN FINAL COUNTS (J73, owner `ddjp_518`): the derived counts lose past plays
    // at every save point and trim, so the row's stored tally answers where they no longer can.
    function rowCounts(cs, h) { return (cs && cs[h.pi]) || (h && h.counts) || null; }
    rows.forEach((h) => {
      const c = rowCounts(counts, h);
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
        // The AGE IN ITS OWN ELEMENT, carrying its stamp (ddjp_472), so it is rewritten in place while
        // History is on screen: the name, then the age, then the rest of the line.
        const age = H.el("span", { class: "hist-ago", text: _fmtAgo(h.at, now) });
        age.dataset.ts = String(h.at);
        H.clear(sub);
        sub.appendChild(who);
        sub.appendChild(age);
        sub.appendChild(document.createTextNode((h.skipped ? " \u00b7 skipped" : "") + reactions));
      }
      refs.queueBody.appendChild(row);
    });
    _whileVisible("history", () => (H.queueTab() === "history" && !!refs.queueBody),
      () => _refreshAges(refs.queueBody, "hist-ago"), HISTORY_AGE_TICK_MS);
  }
  const HISTORY_AGE_TICK_MS = 30000;


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
    // THE PEOPLE HEADER (owner-approved design, ddjp_456): two short lines where there were four
    // sentences. "N active · in the last <span>", then what counts — BUILT FROM THE ROOM'S GROUPS.
    // The old third line was fixed text ("Counts queue actions, votes and saves") while which groups
    // count is a ROOM SETTING, so a room with the queue switched off was told joins counted.
    const groupsText = (typeof H.activityGroupsText === "function") ? H.activityGroupsText(f.groups) : "";
    return {
      count: n,
      heading: n + " active",
      // The span is the EFFECTIVE window, never the requested one — a trimmed or young room says the
      // reach it has, not the reach it was asked for. Activity, never presence: there is none here.
      window: "in the last " + span,
      // Named both ways round when this device holds less than the room's window: the discrepancy is
      // the information. Shown only then.
      reachNote: f.bounded
        ? ("Your window is " + _spanText(f.requestedWindowMs) + ", but this client holds only " +
           _spanText(f.reach) + " of this room — anything older has been forgotten or was never seen.")
        : "",
      sources: (f.sources && f.sources.spine === false) || !groupsText
        ? "This room isn't counting activity"
        : "Counts " + groupsText,
      // Chat never reaches the log, so a room that ALSO counts chat has a rule this list cannot follow.
      // Said in four words, and only for such a room.
      // J75: the tab counts the chat this viewer can see, and says which tier it cannot fully tell for yet.
      // J75: the People tab counts the chat this viewer can see, and says which tier it cannot fully tell for yet; a list
      // that genuinely does not count chat still says so.
      unobservable: f.chatSeen ? ("counts chat you can see" + ((f.unknownTiers && f.unknownTiers.length) ? " — can't fully tell yet for " + f.unknownTiers.join(", ") : ""))
                               : ((f.unobservable && f.unobservable.length) ? "chat isn't counted here" : ""),
    };
  }
  // WHICH MEMBERS ARE ACTIVE, AND IN WHAT ORDER — the fold's decision, carried, never remade (P7).
  // The fold's people first, EXACTLY as it returned them (one outside the window too: that is the
  // fold's call), then every other member in the roster's own order. A person the fold names who is
  // not in the roster any more is not listed: this is the member list.
  function _activeOrder(fold, roster) {
    const list = Array.isArray(roster) ? roster : [];
    const byId = Object.create(null);
    for (const m of list) if (m && m.userId) byId[m.userId] = m;
    const seen = Object.create(null);
    const out = [];
    for (const p of ((fold && Array.isArray(fold.people)) ? fold.people : [])) {
      if (!p || !byId[p.userId] || seen[p.userId]) continue;
      seen[p.userId] = true;
      out.push({ member: byId[p.userId], active: p });
    }
    for (const m of list) if (m && m.userId && !seen[m.userId]) out.push({ member: m, active: null });
    return out;
  }
  // The panel. Renders what the feature layer hands it and decides nothing: it does not filter by
  // window, does not compute recency, and does not sort — every one of those is `Room.foldActivity`'s
  // and a second copy here is the drift P7 is about.
  // ── ONE WAY TO KEEP A VISIBLE PANEL CURRENT (owner audit, ddjp_472) ─────────────────────────────
  // Some panels show words that go stale as time passes — "5 mins ago", who is active. Each asks
  // `_whileVisible(key, visible, tick, ms)`: while `visible()` is true, `tick` runs every `ms`; the first
  // tick that finds it hidden stops, and asking while hidden stops it at once. Asking again while it runs
  // changes nothing. The Feed, People, the DM list and History use it — each supplies only its own tick.
  const _ticking = Object.create(null);
  function _whileVisible(key, visible, tick, ms) {
    let on = false;
    try { on = !!visible(); } catch (e) { on = false; }
    if (on && !_ticking[key]) {
      _ticking[key] = setInterval(() => {
        let still = false;
        try { still = !!visible(); } catch (e) { still = false; }
        if (!still) { clearInterval(_ticking[key]); delete _ticking[key]; return; }
        try { tick(); } catch (e) {}
      }, ms);
    } else if (!on && _ticking[key]) {
      clearInterval(_ticking[key]);
      delete _ticking[key];
    }
  }
  // Rewrite, IN PLACE, every element under `root` with class `cls` and a `data-ts` stamp — so a list is
  // never rebuilt just to move its ages (a rebuild would lose a scroll position, or text being typed).
  function _refreshAges(root, cls) {
    const walk = (n) => {
      if (!n) return;
      if (n.classList && n.classList.contains(cls) && n.dataset && n.dataset.ts) n.textContent = agoFromServer(Number(n.dataset.ts));
      for (const c of Array.from(n.children || [])) walk(c);
    };
    walk(root);
  }

  // ── PEOPLE STAYS CURRENT WHILE IT IS ON SCREEN (ddjp_471) ────────────────────────────────────────
  // "1 min ago" and the green dot were decided once, when the list was drawn, so both went stale as time
  // passed. While People is visible the header and the list redraw every PEOPLE_REFRESH_MS; a tick leaves
  // the list alone while focus is inside it (a rebuild would drop keyboard focus from a name); a
  // tick that finds People hidden stops the timer. Rank and member changes redraw at once, not on a tick.
  const PEOPLE_REFRESH_MS = 30000;
  function _peopleVisible() {
    try { return !!(refs.roster && refs.roster.style && refs.roster.style.display !== "none"); } catch (e) { return false; }
  }
  function _peopleTick() {
    renderActivePanel();
    let busy = false;
    try { const a = document.activeElement; busy = !!(a && refs.rosterBox && refs.rosterBox.contains && refs.rosterBox.contains(a)); } catch (e) { busy = false; }
    if (!busy) { try { Roster.renderRoster(); } catch (e) {} }
  }

  function renderActivePanel() {
    if (!refs.activeBox) return;
    H.clear(refs.activeBox);
    const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;
    let fold;
    // The bot's published answer where there is one (J73 job 5), else this viewer's own fold.
    try { fold = Room.presenceView ? Room.presenceView(now) : Room.recentlyActive(now); }
    catch (e) { return; }
    const lab = _activityLabel(fold);
    // THE HEADER ONLY (ddjp_456). The active people are shown IN the member list below — a dot on their
    // avatar and how long ago — ordered by `_activeOrder`, so there is one list and no second copy.
    refs.activeBox.appendChild(H.el("div", { class: "active-top" }, [
      H.el("span", { class: "active-head", text: lab.heading }),
      H.el("span", { class: "muted active-window", text: lab.window }),
    ]));
    refs.activeBox.appendChild(H.el("p", { class: "muted active-sources",
      text: lab.sources + (lab.unobservable ? " \u00b7 " + lab.unobservable : "") }));
    if (lab.reachNote) {
      refs.activeBox.appendChild(H.el("p", { class: "muted active-reach", text: lab.reachNote }));
    }
    _whileVisible("people", _peopleVisible, _peopleTick, PEOPLE_REFRESH_MS);
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ THE EVENT FEED (Gear → Feed, owner rulings ddjp_447)
  //
  // EVERY kind the fold narrates, whatever chat's checkboxes say — chat keeps its own filtered feed.
  // Go-forward from the SAME line chat draws (`ChatPanels.feedSince`), asked of the fold as `since`,
  // so "after the line" is one rule. Newest at the bottom like chat, at most FEED_TAB_LIMIT. A row is
  // chat's own `_feedRow` plus HOW LONG AGO (only — no clock time, owner ruling ddjp_463), against the SERVER clock —
  // never the device's, because a server stamp compared with a local clock is the trap README.md
  // names second — rewritten in place on a timer while the tab is visible, so an age cannot go stale
  // (chat's rows read theirs at the moment you hover one, ddjp_468). Hidden, it reads and paints nothing and its timer stops.
  // Re-rendered on the re-derive announcement, like chat's feed, so an act a late arrival turns into
  // a refused one LEAVES.
  // ────────────────────────────────────────────────────────────────────────────────────────
  const FEED_TAB_LIMIT = 500;
  const FEED_AGE_TICK_MS = 15000;
  let _feedAges = [];

  function _feedTabVisible() {
    try { return H.rightTab() === "gear" && H.gearTab() === "feed"; } catch (e) { return false; }
  }
  // The server's now, or null — the ONE reader every "how long ago" on screen goes through.
  function _serverNow() {
    try {
      const n = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : null;
      return (typeof n === "number" && isFinite(n) && n > 0) ? n : null;
    } catch (e) { return null; }
  }
  // How long ago a SERVER stamp was, against the server clock. The DM list, history and this tab.
  function agoFromServer(at) { return _fmtAgo(at, _serverNow()); }
  // No age at all rather than one read from the device clock: an absent age is visibly absent.
  function _feedAgeText(ts) { return agoFromServer(ts); }
  function _tickFeedAges() {
    for (const n of _feedAges) n.textContent = _feedAgeText(Number(n.dataset.ts));
  }
  function _feedAgesVisible() { return _feedTabVisible() && !!refs.feedBox && _feedAges.length > 0; }
  function _setFeedHead(text) { if (refs.feedHead) refs.feedHead.textContent = text; }

  function renderFeedPanel() {
    const box = refs.feedBox;
    if (!box) return;
    if (!_feedTabVisible()) { _whileVisible("feed", _feedAgesVisible, _tickFeedAges, FEED_AGE_TICK_MS); return; }
    const since = (typeof ChatPanels !== "undefined" && ChatPanels.feedSince) ? ChatPanels.feedSince() : null;
    // Kept at the bottom only if the reader was already there — scrolling up to read is not undone.
    const stick = (box.scrollHeight - box.scrollTop - box.clientHeight) < 24;
    H.clear(box);
    _feedAges = [];
    if (typeof since !== "number") {
      _setFeedHead("The feed starts when the room's chat starts, and shows what happens from then on.");
      _whileVisible("feed", _feedAgesVisible, _tickFeedAges, FEED_AGE_TICK_MS);
      return;
    }
    let f = null;
    // REFUSED ACTS TOO (owner ruling, ddjp_455): shown in red with the room's reason, where the tab
    // used to leave them out and only count them. Chat asks for none.
    try { f = Room.recentEvents({ limit: FEED_TAB_LIMIT, since: since, refused: true }); } catch (e) { f = null; }
    // The fold is newest-first; this tab reads like chat, oldest at the top.
    const rows = (f && Array.isArray(f.rows)) ? f.rows.slice().reverse() : [];
    for (const r of rows) {
      const ago = H.el("span", { class: "feed-ago", text: _feedAgeText(r.ts) });
      ago.dataset.ts = String(r.ts);
      _feedAges.push(ago);
      const time = H.el("span", { class: "feed-time" }, [ago]);
      const kids = [time, ChatPanels._feedRow(r)];
      if (r.refused) {
        const why = (r.reason && r.reason.text) ? r.reason.text : "the room didn't record why";
        kids.push(H.el("span", { class: "feed-reason", text: "\u2014 refused: " + why }));
      }
      box.appendChild(H.el("div", { class: "feed-line" + (r.refused ? " refused" : "") }, kids));
    }
    // HOW FAR BACK, AND WHAT WAS LEFT OUT — said, not left to be inferred (J13's rule, back with a tab).
    // The line is the newest stamp held when chat started, which is not the moment the room was
    // opened, so no clock is printed for it: "since 14:02, when you opened it" would be false.
    const parts = [rows.length ? "What has happened since you opened this room"
                               : "Nothing has happened since you opened this room"];
    if (f && f.truncated) parts.push("showing the newest " + FEED_TAB_LIMIT);
    if (f && f.refused > 0) parts.push(f.refused + (f.refused === 1 ? " refused act" : " refused acts") + ", shown in red");
    _setFeedHead(parts.join(" \u00b7 ") + ".");
    if (stick) box.scrollTop = box.scrollHeight;
    _whileVisible("feed", _feedAgesVisible, _tickFeedAges, FEED_AGE_TICK_MS);
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  //
  // What ui/interface.js may call. The log-filter setters exist because the two `<select>`
  // elements are built in `buildMainDom` and the state they drive is declared here; a second
  // copy of either scalar would be two variables describing one filter.
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    renderLogs, _logText, _fmtAgo, agoFromServer, renderHistory, renderActivePanel, renderFeedPanel, _activeOrder, _whileVisible, _refreshAges,
    logLevels: () => _LOG_LEVELS,
    logLevel: () => _logLevel,
    setLogLevel: (v) => { _logLevel = v; renderLogs(); },
    setLogCat: (v) => { _logCat = v; renderLogs(); },
  };
})();
