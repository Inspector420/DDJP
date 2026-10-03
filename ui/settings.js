// ui/settings.js
// ROOM SETTINGS · USER SETTINGS — extracted from ui/interface.js at ddjp_393 as the seventh of
// the ten files roles.md §5 records.
//
// ── THE TWO LOCKS ARE READ AND TOGGLED HERE, AND OWNED ELSEWHERE ─────────────────────────────
// `_settingsLocked` and `_prefsLocked` are misclick locks. They are declared in ui/interface.js
// and SET there — by the gear sub-tab handler in `buildMainDom` and by `_relockAllPanels` — while
// this file only TOGGLES them from two lock buttons. **The setter goes where the value is owned**,
// so both come through `UIBase.host` as a reader and a setter, exactly as `_plLocked` does for
// ui/playlists.js. Measured as a CLASS before either was applied: the two are the same shape and
// applying the rule to one would have left the other rebinding another file's state.
//
// The STAGED room settings live here and nowhere else (ddjp_446): rows stage, Apply sends one
// message, and any lock or another room discards them — see `_stageSetting`. The per-row 3-second
// "Updating…" locks (`_setLocks`) are gone with the live writes they protected.
//
// Depends on: UIBase, Interface (via UIBase.host), Room, Capabilities, Ranks, ChatPrefs, Logger

const Settings = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;

  // --- state and constants this cluster owns, moved out with it -------------
  // Staged room settings (ddjp_446): `values` is every change waiting for Apply, `room` the room they
  // were made in. `_invalid` holds a message per control whose typed value cannot be sent, and holds
  // Apply back. `_report` is the last Apply's outcome, `_bar` the rendered bar's live parts.
  let _staged = { room: null, values: {} };
  const _invalid = {};
  let _report = null;
  let _bar = null;
  const SETTLE_MS = 5000;           // a sent write's grace to come back before a missing key is named
  const REPORT_MS = 5 * 60 * 1000;  // how long the bar keeps saying what the last Apply did

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ USER SETTINGS PANEL
  //
  // Per-user device config: chat display toggles, the host allowlist, the two dim sliders.
  // Never touches the backend.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ── A REDRAW KEEPS THE READER'S PLACE (owner report, ddjp_461) ─────────────────────────────────
  // Both settings panels redraw WHOLE — on every lock click, every staged edit. Emptying a box
  // collapses its scrolling area, and a browser that lays it out before the box is refilled resets the
  // scroll to the top: local settings jumped back to its first row on every lock click. Room settings
  // happened not to, which nothing guaranteed. So each renderer notes the position BEFORE emptying its
  // box and calls the returned function when it is done: one rule, both panels, no timing assumed.
  function _holdScroll(boxEl) {
    const sc = boxEl ? boxEl.parentNode : null;
    const at = (sc && typeof sc.scrollTop === "number") ? sc.scrollTop : 0;
    return () => { if (sc && typeof sc.scrollTop === "number" && sc.scrollTop !== at) sc.scrollTop = at; };
  }

  function renderChatSettings() {
    const boxEl = refs.chatSettingsBox;
    if (!boxEl) return;
    // Note the reader's place BEFORE the box is emptied (ddjp_461): every lock click redraws this
    // panel whole, and it jumped back to its first row. See `_holdScroll`.
    const restoreScroll = _holdScroll(boxEl);
    H.clear(boxEl);

    // Master lock — mirrors the Room-tab settings lock (same .settings-lock button).
    // These are per-user display prefs, so the lock just guards against accidental
    // changes: locked by default, re-locked on entry to this sub-tab, no timed relock.
    const lockBtn = H.el("button", {
      class: "settings-lock" + (H.prefsLocked() ? " locked" : ""),
      text: H.prefsLocked() ? "\uD83D\uDD12 Unlock settings" : "\uD83D\uDD13 Lock settings",
      title: H.prefsLocked() ? "Settings are locked — click to unlock" : "Settings unlocked — click to lock"
    });
    lockBtn.onclick = () => { H.setPrefsLocked(!H.prefsLocked()); renderChatSettings(); };
    // In the same bar as the room panel's, in its OWN SLOT above the scrolling list (ddjp_459), so the
    // lock stays in view and no setting scrolls behind it. These settings stay LIVE — only room
    // settings are staged.
    if (refs.chatSettingsBar) {
      H.clear(refs.chatSettingsBar);
      refs.chatSettingsBar.appendChild(H.el("div", { class: "settings-bar" }, [lockBtn]));
    }

    // Everything below lives in one wrapper so a single pass can disable it all
    // while locked (the lock button itself stays enabled, outside the wrapper).
    const wrap = H.el("div", { class: "prefs-body" + (H.prefsLocked() ? " prefs-locked" : "") });
    // Images: ONE shared provider list, TWO independent toggles — inline chat
    // images and room backgrounds. The list greys only when BOTH are off; with
    // either on it stays active (it's feeding a live consumer). Removing a host
    // drops it from both at once (the merged-providers design).
    wrap.appendChild(_prefSection({
      heading: "Images",
      note: "On by default. These approved providers are shared by inline chat images and room backgrounds. A provider sees your IP when an image loads from it.",
      toggles: [
        { label: "Images in chat", on: ChatPrefs.imagesEnabled(), onToggle: (v) => ChatPrefs.setImagesEnabled(v) },
        { label: "Room backgrounds", on: ChatPrefs.bgEnabled(), onToggle: (v) => ChatPrefs.setBgEnabled(v) },
      ],
      defaults: ChatPrefs.imageDefaults(),
      onDefault: (h, on) => ChatPrefs.setDefaultImageHost(h, on),
      custom: ChatPrefs.imageCustomHosts(),
      onAdd: (h) => ChatPrefs.addImageHost(h),
      onRemove: (h) => ChatPrefs.removeImageHost(h),
    }));
    wrap.appendChild(_prefSection({
      heading: "Links",
      title: "Links in chat",
      note: "On by default. A link to an allowed host becomes clickable and opens in a new tab.",
      enabled: ChatPrefs.linksEnabled(),
      onToggle: (v) => ChatPrefs.setLinksEnabled(v),
      defaults: ChatPrefs.linkDefaults(),
      onDefault: (h, on) => ChatPrefs.setDefaultLinkHost(h, on),
      custom: ChatPrefs.linkCustomHosts(),
      onAdd: (h) => ChatPrefs.addLinkHost(h),
      onRemove: (h) => ChatPrefs.removeLinkHost(h),
    }));
    wrap.appendChild(_dimSection());
    wrap.appendChild(_feedSection());
    wrap.appendChild(_soundSection());
    // ONLY THE BOT SEES THIS, and only while it is actually running as the bot. It is not a
    // permission — anybody may flip a device-local display pref — it is that the row is
    // meaningless to a client that is not the bot, and a control that does nothing is the
    // "button that did nothing" defect this tree has already shipped once.
    const botRow = _botViewSection();
    if (botRow) wrap.appendChild(botRow);
    boxEl.appendChild(wrap);

    // When locked, every control below the lock button is inert (mirrors the
    // Room-tab lock, which disables each settings control while locked).
    if (H.prefsLocked()) QueuePanels._disableAllControls(wrap);
    restoreScroll();
  }

  // The bot's view toggle. Returns null for every client that is not currently the room's bot, so
  // the section simply does not exist rather than appearing greyed out for everybody else.
  function _botViewSection() {
    let isBot = false;
    try { isBot = !!(typeof BotRuntime !== "undefined" && BotRuntime.actingAsBot && BotRuntime.actingAsBot()); }
    catch (e) { isBot = false; }
    if (!isBot) return null;
    let on = false;
    try { on = ChatPrefs.botView() === true; } catch (e) { on = false; }
    // A CARD WITH ONE CHECKBOX, like every other on/off here (owner-approved canvas, ddjp_465). It was a
    // loose row in the old room-settings style, with a button that said what clicking it would do.
    const sec = _prefCard("Bot");
    const cb = H.el("input", { type: "checkbox", class: "pref-master" });
    cb.checked = on;
    cb.onchange = () => { try { ChatPrefs.setBotView(!!cb.checked); } catch (e) {} renderChatSettings(); };
    sec.appendChild(H.el("label", { class: "pref-master-row" }, [cb, H.el("span", { class: "pref-title", text: "Watch videos on this device" })]));
    sec.appendChild(H.el("div", { class: "pref-note", text: on
      ? "This account is the room's bot. Watching the video, and reporting song lengths like anyone else."
      : "This account is the room's bot. Not loading the video. Everything else works as normal — this account still moderates, "
        + "sweeps for idle DJs and reads the room. It will not report song lengths or say it "
        + "cannot see the video, because not watching is deliberate." }));
    return sec;
  }

  // The background/panel dimness sliders (percent 10..100, per-user). Live preview
  // on drag (CSS var only); commit to ChatPrefs on release. View-only — no DOM
  // rebuild during a drag, no protocol event.
  function _dimRow(label, getPct, varName, commit, range) {
    const valEl = H.el("span", { class: "dim-val", text: getPct() + "%" });
    const lbl = H.el("div", { class: "dim-label" }, [H.el("span", { text: label }), valEl]);
    const slider = H.el("input", {
      type: "range", class: "dim-slider",
      min: String(range.min), max: String(range.max), step: "1",
      value: String(getPct()),
    });
    slider.oninput  = () => { const v = Number(slider.value); valEl.textContent = v + "%"; Player._setDimVar(varName, v); };
    slider.onchange = () => { commit(Number(slider.value)); };
    return H.el("div", { class: "dim-row" }, [lbl, slider]);
  }
  // ONE LOCAL CARD, HEADED LIKE ROOM SETTINGS' (owner-approved canvas, ddjp_465). A local card is local's
  // own `pref-section` with the SAME small heading room settings' groups carry — `set-card-head`, one
  // element in both panels, not a look-alike. A note that sits under no checkbox is flat (not indented).
  function _prefCard(heading) {
    return H.el("div", { class: "pref-section" }, [H.el("div", { class: "set-card-head", text: heading })]);
  }

  function _dimSection() {
    const sec = _prefCard("Appearance");
    sec.appendChild(H.el("div", { class: "pref-note pref-note-flat", text: "How dark the room background and the panels look. Applies to this device only." }));
    sec.appendChild(_dimRow("Background dimness", () => ChatPrefs.bgDim(),   "--bg-dim",   (v) => ChatPrefs.setBgDim(v),   ChatPrefs.DIM_RANGES.bgDim));
    sec.appendChild(_dimRow("Panel dimness",      () => ChatPrefs.panelDim(), "--panel-dim", (v) => ChatPrefs.setPanelDim(v), ChatPrefs.DIM_RANGES.panelDim));
    return sec;
  }
  // ── ROOM EVENTS IN CHAT — ONE CHECKBOX PER KIND (owner rulings ddjp_425, ddjp_427) ────────────
  // The feed's rows sit between chat messages, and which kinds appear is a device choice made ONE KIND
  // AT A TIME — upvotes apart from saves, song starts apart from skips. Allowed as a LOCAL knob because
  // nothing acts on what the feed displays — contrast the activity window below, removed because the
  // People panel IS the basis for the bot's action (`roles.md` §6).
  //
  // EVERYTHING IS READ, NOTHING IS LISTED. The kinds are `Room.FEED_KINDS`' rows in that table's order,
  // each box is labelled in the fold's own words (its `verb`), and each box starts at the kind's
  // `shownByDefault` until this device changes it — so a kind added to the table appears here, named
  // and defaulted, the day it is added. `check-chat-view` PART E extracts these two and runs them.
  function _feedKinds() {
    // The room's kinds, then chat's own (ddjp_430 — the too-long message). Two tables because chat
    // never reaches the room's log; one panel because to a person they are all "things in chat".
    let kinds = {};
    try { kinds = Object.assign({}, Room.FEED_KINDS || {}); } catch (e) { kinds = {}; }
    try { Object.assign(kinds, (typeof Chat !== "undefined" && Chat.EVENT_KINDS) || {}); } catch (e) {}
    return Object.keys(kinds).map((type) => {
      const k = kinds[type] || {};
      const verb = typeof k.verb === "string" && k.verb ? k.verb : type;
      return { type: type, dflt: k.shownByDefault !== false, label: verb.charAt(0).toUpperCase() + verb.slice(1) };
    });
  }
  function _feedSection() {
    const sec = _prefCard("Room events in chat");
    sec.appendChild(H.el("div", { class: "pref-note pref-note-flat", text: "Which room events appear between chat messages, from when you entered the room. Applies to this device only." }));
    for (const k of _feedKinds()) {
      const box = H.el("input", { type: "checkbox", class: "pref-master" });
      let on = k.dflt;
      try { on = ChatPrefs.feedShown(k.type, k.dflt) !== false; } catch (e) { on = k.dflt; }
      box.checked = on;
      box.onchange = () => { try { ChatPrefs.setFeedShown(k.type, box.checked, k.dflt); } catch (e) {} };
      sec.appendChild(H.el("label", { class: "pref-master-row" }, [box, H.el("span", { class: "pref-title", text: k.label })]));
    }
    return sec;
  }

  // ── THE MENTION SOUND (ddjp_431) — on by default at a third of full volume, this device only ─────────
  // A checkbox and a volume slider, borrowing the pref and dim-slider rows beside it. The slider commits
  // on release and plays the chime at the new volume, so the choice is heard rather than guessed.
  // Two chimes, each its own switch and volume (owner rulings ddjp_431, ddjp_432): a mention, and a new DM.
  function _soundRow(sec, o) {
    let on = true, vol = 33;
    try { on = o.get() !== false; vol = o.vol(); } catch (e) {}
    const box = H.el("input", { type: "checkbox", class: "pref-master" });
    box.checked = on;
    box.onchange = () => { try { o.set(box.checked); } catch (e) {} };
    sec.appendChild(H.el("label", { class: "pref-master-row" }, [box, H.el("span", { class: "pref-title", text: o.title })]));
    const valEl = H.el("span", { class: "dim-val", text: vol + "%" });
    const slider = H.el("input", { type: "range", class: "dim-slider", min: "0", max: "100", step: "1", value: String(vol) });
    slider.dataset.kind = o.kind;
    slider.oninput = () => { valEl.textContent = Number(slider.value) + "%"; };
    slider.onchange = () => {
      try { o.setVol(Number(slider.value)); } catch (e) {}
      try { ChatPanels.previewChime(o.kind); } catch (e) {}
    };
    sec.appendChild(H.el("div", { class: "dim-row" }, [H.el("div", { class: "dim-label" }, [H.el("span", { text: o.label }), valEl]), slider]));
  }
  function _soundSection() {
    const sec = _prefCard("Sounds");
    sec.appendChild(H.el("div", { class: "pref-note pref-note-flat", text: "Short chimes, made in the browser. Applies to this device only." }));
    _soundRow(sec, { kind: "mention", title: "Sound when someone mentions you", label: "Mention volume",
      get: () => ChatPrefs.mentionSound(), vol: () => ChatPrefs.mentionVolume(),
      set: (v) => ChatPrefs.setMentionSound(v), setVol: (v) => ChatPrefs.setMentionVolume(v) });
    _soundRow(sec, { kind: "dm", title: "Sound for a new direct message", label: "DM volume",
      get: () => ChatPrefs.dmSound(), vol: () => ChatPrefs.dmVolume(),
      set: (v) => ChatPrefs.setDMSound(v), setVol: (v) => ChatPrefs.setDMVolume(v) });
    return sec;
  }

  // ── THE DEVICE-LOCAL ACTIVITY WINDOW IS GONE (v272) ──────────────────────────────────────
  // `_activityWindowSection` offered "How far back the People tab counts someone as active. This
  // device only — nobody else sees it and nothing in the room depends on it." The second half of
  // that sentence stopped being true the moment a bot could act on `botAfkMs`: the People panel is
  // the surface showing the basis for the bot REMOVING somebody, so a wider local window makes the
  // panel say a person is present while the bot is about to remove them.
  //
  // REMOVED RATHER THAN NARROWED. A knob narrowed until it cannot disagree is a control that does
  // nothing, which this tree files as a visible lie; and a knob that CAN disagree is the collision
  // itself. The window is `botAfkMs` and lives in the room settings panel, where an owner changes
  // it for everyone — including for the bot that acts on it.


  // One settings section. Supports a SHARED host list governed by one or more
  // master toggles: the list is active when ANY toggle is on, and greys only when
  // ALL are off. `cfg.toggles` is an array of { label, on, onToggle }; the legacy
  // single-toggle form (cfg.enabled/onToggle/title) is still accepted and wrapped.
  // Checkbox `.checked`/`.onchange` are set imperatively (el doesn't bind those).
  // Mutations go through ChatPrefs, which notifies onChange -> the panel
  // re-renders, so controls always reflect persisted state.
  function _prefSection(cfg) {
    const sec = _prefCard(cfg.heading);

    // Normalize to a toggle list. Legacy callers pass title/enabled/onToggle.
    const toggles = Array.isArray(cfg.toggles) && cfg.toggles.length
      ? cfg.toggles
      : [{ label: cfg.title, on: cfg.enabled, onToggle: cfg.onToggle }];
    const anyOn = toggles.some(t => !!t.on);   // list active when ANY toggle is on

    for (const t of toggles) {
      const master = H.el("input", { type: "checkbox", class: "pref-master" });
      master.checked = !!t.on;
      master.onchange = () => t.onToggle(master.checked);
      sec.appendChild(H.el("label", { class: "pref-master-row" }, [master, H.el("span", { class: "pref-title", text: t.label })]));
    }
    if (cfg.note) sec.appendChild(H.el("div", { class: "pref-note", text: cfg.note }));

    const hosts = H.el("div", { class: "pref-hosts" + (anyOn ? "" : " pref-disabled") });

    for (const d of cfg.defaults) {
      const cb = H.el("input", { type: "checkbox" });
      cb.checked = !!d.on;
      cb.disabled = !anyOn;
      cb.onchange = () => cfg.onDefault(d.host, cb.checked);
      hosts.appendChild(H.el("label", { class: "pref-host" }, [cb, H.el("span", { text: d.host })]));
    }

    for (const h of cfg.custom) {
      const x = H.el("button", { class: "pref-chip-x", text: "×", title: "Remove", disabled: !anyOn, onclick: () => cfg.onRemove(h) });
      hosts.appendChild(H.el("span", { class: "pref-chip" }, [H.el("span", { text: h }), x]));
    }

    const input = H.el("input", { type: "text", class: "pref-add-input", placeholder: "add a host, e.g. example.com", disabled: !anyOn });
    const submit = () => { const v = input.value; input.value = ""; if (v) cfg.onAdd(v); };
    const addBtn = H.el("button", { class: "pref-add-btn", text: "Add", disabled: !anyOn, onclick: submit });
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    hosts.appendChild(H.el("div", { class: "pref-add-row" }, [input, addBtn]));

    sec.appendChild(hosts);
    return sec;
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ ROOM SETTINGS PANEL
  //
  // Owner-written room dials. Bounds come from the reducer through the feature seam, so the
  // panel cannot offer a value the reducer will refuse.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ── WHO MAY CHANGE WHICH SETTING, AND HOW IT GETS WRITTEN (J17's missing half) ─────────────
  // The room's `botDelegation` table maps a settings KEY to the weakest rank allowed to REQUEST
  // it. `BotSettings.decide` has always enforced that and `BotSettings.request` has always been
  // able to send one — but NOTHING CALLED IT. The table was configurable and unreachable: an
  // owner could delegate `maxLen` to staff and no staff member had any control that asked.
  //
  // THE PANEL IS REUSED RATHER THAN DUPLICATED. Every row already knows its key, its label, its
  // bounds and its wording; a second delegated-settings panel would be a second copy of all of it,
  // free to drift. So the rows stay exactly as they are and only two things change: WHETHER a row
  // is editable becomes a per-key question, and the WRITE routes to the bot when the person is
  // not the owner.
  //
  // "write"   — I am the owner: `Room.setSettings`, straight to the blob, as before.
  // "request" — I am not, but this key is delegated to a rank I hold: `ddjp.bot.request`, which
  //             the bot re-checks against the same table before authoring anything.
  // null      — neither. The row renders inert, exactly as it does today.
  //
  // THE REQUEST IS NOT A WRITE AND MUST NOT LOOK LIKE ONE. The bot may be offline, may refuse, or
  // may not exist; `_settingSentNote` says so rather than showing the optimistic "Updating…" a
  // direct write earns.
  // THE RULE IS ASKED, NEVER RESTATED — AND TWO GUARDS INSISTED. A first version compared the
  // table and the rank here with `Capabilities.atLeast`; `check-boundaries` rule D and
  // `check-ui-no-permission` both refused it, and they were right twice over. The UI must not
  // decide permission, and this particular decision already HAS an owner: `BotSettings.decide` is
  // the function the BOT runs on an arriving request. Asking it means the panel and the bot cannot
  // disagree about who may change what — the panel offers exactly what the bot would honour,
  // because it is the same function answering.
  //
  // THE VALUE PASSED IS THE CURRENT ONE, and `decide` deliberately does not validate values —
  // `applySettingsEvent` re-validates everything and is TOTAL. So this asks purely "may this
  // person request this key", which is the question.
  function _maySetSetting(key) {
    try {
      if (Actions.describe("room.settings").enabled) return "write";
    } catch (e) { /* not the owner, or unreadable — fall through to the delegated path */ }
    try {
      const s = Room.getSettings() || {};
      const myLevel = Room.getMyAuthorityLevel();
      const d = BotSettings.decide({ k: key, v: s[key] }, myLevel, s);
      return (d && d.ok) ? "request" : null;
    } catch (e) { return null; }
  }

  // ── STAGED, THEN ONE APPLY (owner rulings, ddjp_446 — main/04-features.md §Room settings panel) ───
  // A row no longer sends anything. It STAGES its change here, and Apply sends every staged key in ONE
  // message: the owner's one `room.settings` (one `ddjp.room.settings`), or a delegated person's one
  // `ddjp.bot.request` carrying them all. Which route is still `_maySetSetting`'s answer, asked per key
  // at Apply — so a rank that moved in between refuses instead of guessing.
  //
  // ANY LOCK DISCARDS, and so does another room: `renderSettings` empties the staged set whenever it
  // finds the panel locked or the room changed. Every lock path ends in a render — the lock button,
  // and `_relockAllPanels`, which every tab switch calls — so there is one rule and no second copy.
  //
  // A row that stays IN PLACE while being typed into (numbers, tables, the background link) stages
  // with `redraw === false`: a full redraw on every change would take the focus out of the next
  // field. Such a row reads the latest value through `_valueNow`, never the one it was drawn with,
  // or two edits in one table would keep only the second.
  //
  // `slot` names the control whose error this change clears — a table cell rather than the table.
  // A value equal to the room's own is UNSTAGED rather than staged: there is nothing to send.
  function _roomId() { try { const c = Room.getCurrent(); return (c && c.spaceId) || null; } catch (e) { return null; } }
  function _discardStaged() { _staged = { room: _roomId(), values: {} }; for (const k in _invalid) delete _invalid[k]; }
  function _valueNow(key) {
    if (Object.prototype.hasOwnProperty.call(_staged.values, key)) return _staged.values[key];
    const d = Room.getSettings() || {};
    return d[key];
  }
  function _stageSetting(key, partial, redraw, slot) {
    if (H.settingsLocked() || _maySetSetting(key) === null) return false;
    if (_staged.room !== _roomId()) _discardStaged();
    const d = Room.getSettings() || {};
    for (const k of Object.keys(partial || {})) {
      if (JSON.stringify(partial[k]) === JSON.stringify(d[k])) delete _staged.values[k];
      else _staged.values[k] = partial[k];
    }
    delete _invalid[slot || key];
    if (redraw === false) _renderBar(); else renderSettings();
    return true;
  }
  // A typed value that cannot be sent: it is not staged, and Apply waits until it is fixed or locked away.
  function _markInvalid(slot, key, msg) {
    _invalid[slot] = msg;
    if (key) delete _staged.values[key];
    _renderBar();
  }

  function _applyStaged() {
    if (H.settingsLocked()) return;
    if (_staged.room !== _roomId()) { _discardStaged(); renderSettings(); return; }
    if (Object.keys(_invalid).length) return;
    const values = Object.assign({}, _staged.values);
    const keys = Object.keys(values);
    if (!keys.length) return;
    // ONE ROUTE FOR THE WHOLE BATCH. An owner writes every key; a delegated person may stage only
    // keys the bot would honour, which never includes `botDelegation` (`decide` refuses it as
    // not-a-setting, and so `_stageSetting` does too). If a rank moved since staging, some keys
    // answer differently now — refuse by name rather than send half, and keep them staged.
    const how = _maySetSetting(keys[0]);
    const off = keys.filter((k) => _maySetSetting(k) !== how || how === null);
    if (off.length) {
      _invalid.__route = "You can no longer change " + off.map(_name).join(", ") + ". Lock the panel to discard.";
      _renderBar();
      return;
    }
    _discardStaged();
    const report = { how: how, sent: values, at: Date.now(), room: _roomId(), state: "sending" };
    _report = report;
    const settled = (sent) => {
      if (_report !== report) return;
      if (sent) {
        report.state = "sent"; report.at = Date.now();
        setTimeout(() => { if (_report === report) renderSettings(); }, SETTLE_MS + 50);
      } else {
        report.state = "failed";
        // Nothing left the machine, so nothing is lost: the changes are staged again — unless the
        // panel was locked or the room left meanwhile, which discards them by the same ruling.
        if (!H.settingsLocked() && _roomId() === report.room) {
          _staged = { room: report.room, values: Object.assign({}, values, _staged.values) };
        }
      }
      renderSettings();
    };
    if (how === "write") {
      // THROUGH THE ADAPTER (J31), which re-checks the owner descriptor. `Room.setSettings` merges the
      // batch onto the full blob and posts ONE event. A refusal RESOLVES `{ok:false}` there and
      // REJECTS here; both end in `settled(false)`, so neither reaches the console unhandled.
      Actions.perform("room.settings", { partial: values })
        .then((r) => settled(!(r && r.ok === false)),
              (e) => { Logger.warn("settings: " + ((e && e.message) || e)); settled(false); });
    } else {
      let cur = null, myLevel = null;
      try { cur = Room.getCurrent(); } catch (e) { cur = null; }
      try { myLevel = Room.getMyAuthorityLevel(); } catch (e) { myLevel = null; }
      if (!cur || !cur.channels || myLevel === null) { settled(false); return; }
      Promise.resolve(BotSettings.request(cur.channels, myLevel, values))
        .then((r) => settled(!!(r && r.ok)), () => settled(false));
    }
    renderSettings();
  }

  // What the bar says. Staged work first, then the last Apply's OUTCOME — read from the room, not
  // assumed: a key the room did not take is named, and the list follows the room as keys land.
  // A REQUEST IS AN ASK, AND THE WORDING SAYS SO — the bot may be offline, may refuse on rank, or
  // may not exist, so a delegated Apply never reads as done until the room shows it.
  function _barStatus() {
    const bad = Object.keys(_invalid);
    if (bad.length) return _invalid[bad[0]];
    const n = Object.keys(_staged.values).length;
    if (n) return n + (n === 1 ? " change" : " changes") + " waiting. Nothing is sent until Apply.";
    const r = _report;
    if (!r || r.room !== _roomId() || Date.now() - r.at > REPORT_MS) return "";
    if (r.state === "sending") return r.how === "request" ? "Sending your request to the room's bot\u2026" : "Applying\u2026";
    if (r.state === "failed") return "That could not be sent. Your changes are staged again \u2014 try Apply once more.";
    const now = Room.getSettings() || {};
    const missing = Object.keys(r.sent).filter((k) => JSON.stringify(now[k]) !== JSON.stringify(r.sent[k]));
    if (!missing.length) return r.how === "request" ? "The bot applied your changes." : "Applied.";
    if (r.how === "request") {
      return "Asked the room's bot. Still waiting for: " + missing.map(_name).join(", ") + ". It applies them "
        + "only if the bot is running and the room still delegates them to your rank.";
    }
    if (Date.now() - r.at < SETTLE_MS) return "Applying\u2026";
    return "The room did not take: " + missing.map(_name).join(", ") + ".";
  }

  function _renderBar() {
    if (!_bar) return;
    const n = Object.keys(_staged.values).length;
    _bar.apply.textContent = n ? "Apply (" + n + ")" : "Apply";
    _bar.apply.disabled = H.settingsLocked() || !n || Object.keys(_invalid).length > 0;
    _bar.status.textContent = _barStatus();
  }

  // ── THE PANEL'S LAYOUT: SECTIONS, ONE ROW SHAPE, ONE NAME (settings rework, owner-approved) ────
  // Every row has the same four parts, in order: its title (from the one name table,
  // `ChatPanels._settingDisplayName`), one plain sentence, the control, and a "More" link for the
  // longer explanation. Rows render into whichever SECTION is being built — `_box()` is that
  // section's body, or the panel itself outside one — so the row helpers never learn where they
  // are. Collapsed sections render nothing at all; the summary on their header is what a person
  // reads instead.
  let _host = null;
  const _box = () => _host || refs.settingsBox;
  const _moreOpen = {};                // which rows show their longer explanation
  const _name = (key) => ChatPanels._settingDisplayName(key);
  // A rank as the set of people it admits. Display only — ui/ compares no rank to anything.
  const _rankUp = (name) => ({
    uncategorized: "Everyone", guest: "Guests and up", player: "Players and up", vip: "VIPs and up",
    staff: "Staff and up", "high-staff": "High staff and up", owner: "Owner only",
  })[name] || (_rankLabel(name) + " and up");

  // The delegation list's grouping — the panel's own sections, so a setting is found where it
  // lives. Presentation only: a key in no group still gets a row under "Other", failing open.
  const _DELEG_GROUPS = [
    ["Room", ["vis", "chat", "bg"]],
    ["DJ queue", ["minDjRank", "repeatCooldownMs"]],
    ["Songs", ["maxLen", "minLen", "minGate", "graceMs", "presendMs", "vouchJitter"]],
    ["Blocked songs", ["skipRoads"]],
    // The panel's three cards since ddjp_495, in the panel's order.
    ["DJ presence", ["botQueueRemove", "queueIdleMs", "botQueueChat", "activityQueue",
                        "botQueueWarn", "botPingMs", "botQueueThanks", "botQueueAnnounce"]],
    ["Room presence", ["botAfkMs", "botPresenceChat", "activityPresence", "botPresenceRemove",
                  "botPresenceWarn", "botPresencePingMs", "botPresenceThanks", "botPresenceAnnounce"]],
    ["Backups and history", ["checkpointCooldownMs", "checkpointEvery", "vouchTable", "receiptsPerMessage",
                             "checkpointTable", "checkpointRankOffsetMs", "selfWitnessCheckpoint"]],
  ];

  // ONE LIST for every choice among several (ddjp_464): options are [value, text] pairs, and picking the
  // current one does nothing. A CHOICE THAT CANNOT BE CHANGED — locked, or not mine to change — SHOWS ITS
  // CHOSEN OPTION'S OWN WORDS instead of a greyed-out list (owner ruling, ddjp_483). A disabled radio is
  // drawn in the browser's grey, and ddjp_482's fade of the other options still left shades of grey to
  // tell apart. It is the shape Who can DJ always had, and it lives HERE so no row keeps its own copy. A
  // value that is none of the options reads "—" rather than naming a choice nobody made; the reducer
  // folds only listed values, so a room does not reach it. check-settings-apply PART M.
  function _choiceList(key, options, current, onPick, editable) {
    if (!editable) {
      const hit = options.find(([val]) => val === current);
      return H.el("div", { class: "set-value", text: hit ? hit[1] : "\u2014" });
    }
    const list = H.el("div", { class: "set-choices" });
    for (const [val, text] of options) {
      const r = H.el("input", { type: "radio", class: "pref-radio" });
      r.name = "set-" + key;
      r.checked = val === current;
      r.onchange = () => { if (r.checked && val !== current) onPick(val); };
      list.appendChild(H.el("label", { class: "pref-host" }, [r, H.el("span", { text: text })]));   // local's list item
    }
    return list;
  }

  function _section(id, title, summary, build, sub) {
    // FLAT CARDS, LIKE LOCAL SETTINGS (owner-approved canvas, ddjp_464). A group is a card with a small
    // heading and ALWAYS shows its settings — nothing collapses. A sub-group becomes its OWN card at the
    // panel's root, after its parent, so its rows still read in order; a parent's rows after it stay in
    // the parent's card. `summary` described a closed section and has nothing left to describe.
    const card = H.el("div", { class: "set-sec" + (sub ? " set-sub" : ""), "data-section": id }, [
      H.el("div", { class: "set-card-head", text: title }),
    ]);
    refs.settingsBox.appendChild(card);
    const body = H.el("div", { class: "set-sec-body" });
    card.appendChild(body);
    const prev = _host;
    _host = body;
    try { build(); } finally { _host = prev; }
  }

  // THE TITLE SAYS WHAT IT IS; THE SENTENCE WAITS UNDER MORE (owner ruling, ddjp_487). A row no longer
  // prints its explanation under the title — it is kept on the row, and `_rowMore` shows it with any
  // further detail behind the one More every row has. Returns the title line, so a row can put its value
  // there: a number's input, or what a locked row is set to.
  function _rowHead(row, key, title, desc, readout) {
    const line = H.el("div", { class: "set-title-line" }, [
      H.el("span", { class: "set-label", text: title }),
      readout ? H.el("span", { class: "set-readout", text: readout }) : null,
    ]);
    row.appendChild(line);
    row._moreDesc = desc || null;
    return line;
  }

  function _rowMore(row, key, more) {
    more = [row._moreDesc, more].filter(Boolean).join(" ");
    if (!more) return;
    const open = !!_moreOpen[key];
    const btn = H.el("button", { class: "set-more", type: "button", text: open ? "Less" : "More" });
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    btn.onclick = () => { _moreOpen[key] = !_moreOpen[key]; renderSettings(); };
    row.appendChild(btn);
    if (open) row.appendChild(H.el("div", { class: "set-more-text", text: more }));
  }

  // A duration in words, beside the number a person types: 600 sec reads "10 min". Empty when the
  // number already says it plainly. `repeatCooldownMs` at 0 is the one value that means "off".
  function _fmtDur(v, unit, key) {
    if (typeof v !== "number" || !isFinite(v)) return "";
    if (key === "repeatCooldownMs" && v === 0) return "any time";   // "Song can replay after · any time" (ddjp_487)
    const mins = (unit === "sec") ? v / 60 : (unit === "min") ? v : null;
    if (mins === null || mins < 1 || (unit === "min" && mins < 60)) return "";
    if (mins < 60) { const m = Math.floor(v / 60), r = Math.round(v % 60); return m + " min" + (r ? " " + r + " s" : ""); }
    const h = Math.floor(mins / 60), rm = Math.round(mins % 60);
    if (h >= 48 && rm === 0 && h % 24 === 0) return (h / 24) + " days";
    return h + " h" + (rm ? " " + rm + " min" : "");
  }

  function renderSettings() {
    if (!refs.settingsBox) return;
    // Note the reader's place BEFORE the box is emptied (ddjp_461) — see `_holdScroll`.
    const restoreScroll = _holdScroll(refs.settingsBox);
    H.clear(refs.settingsBox);
    // The saves section is a child of this box, so clearing the box destroys it — the ref must go
    // with it or the next render appends into a node no longer in the document.
    refs.settingsExport = null;
    // ANY LOCK DISCARDS, AND SO DOES ANOTHER ROOM (owner ruling, ddjp_446) — see `_stageSetting`.
    if (H.settingsLocked() || _staged.room !== _roomId()) _discardStaged();
    _bar = null;
    // The bar's slot is emptied with the box: a panel with nothing to change shows no bar, and no gap.
    if (refs.settingsBar) H.clear(refs.settingsBar);
    // Every row reads `s`, so laying the staged values over the room's HERE shows each row — and each
    // section summary — as it will be once applied, and no row has to learn that staging exists.
    const s = Object.assign({}, Room.getSettings() || {}, _staged.values);
    const settingsDesc = Actions.describe("room.settings");
    const isOwner = settingsDesc.enabled;
    // Master lock: the owner must explicitly unlock before any room setting can change.
    // Locked by default and re-locked on every entry to the Room tab (see the tab handler);
    // NO timed auto-relock — it stays as the owner leaves it until they lock or leave the tab.
    // EDITABILITY IS PER-KEY NOW, NOT ONE BOOLEAN. The owner may change everything; a delegated
    // person may change exactly the keys the room's `botDelegation` table grants their rank, and
    // nothing else. `_editableFor` answers that per row, and the master lock still applies to both
    // — a delegated person can fat-finger a dial as easily as an owner can.
    //
    // THE SINGLE `editable` BOOLEAN IS GONE, not merely unused. Every row now asks per key, and
    // leaving the old name in scope would be a second answer to the same question — free to
    // disagree the moment somebody reaches for the shorter one. The two rows that are genuinely
    // owner-only (`botDelegation`, restore-from-file) say so at their call site instead.
    const _editableFor = (key) => _maySetSetting(key) !== null && !H.settingsLocked();

    refs.settingsBox.appendChild(H.el("div", { class: "set-panel-title", text: "Room settings" }));
    // THE DESCRIPTOR'S OWN REASON, NOT A SENTENCE WRITTEN HERE. "Only the owner can change these"
    // is FALSE on the bot's screen — the bot IS at owner rank, and the reason it may not edit them
    // is that it changes settings only when asked. A hardcoded sentence that contradicts the
    // account reading it is the same defect class as the rank named "Owner" that appoints a bot
    // and the header that called the human owner "Bot": both were wrong words on a correct
    // mechanism, and both reached the owner because nothing reads rendered text.
    if (!isOwner) {
      refs.settingsBox.appendChild(H.el("p", { class: "muted",
        text: settingsDesc.reason || "Only the owner can change these." }));
    }

    // ── THE LOCK IS FOR ANYONE WHO CAN CHANGE SOMETHING, NOT JUST THE OWNER ──────────────────
    // `_settingsLocked` starts TRUE and every editable row is gated on it. Rendering the unlock
    // button `if (isOwner)` was correct while the owner was the only person who could change
    // anything — and became a DEAD END the moment delegation shipped: a staff member granted
    // `maxLen` saw the row, could not unlock, and had no way to reach it. The feature was
    // reachable in every layer except the one a person touches.
    //
    // ANYONE WITH AT LEAST ONE CHANGEABLE ROW GETS THE LOCK, which is the same rule the rows
    // themselves use rather than a second one: if `_editableFor` can ever answer true for this
    // person, the lock is theirs to open. Somebody with nothing delegated gets no button, because
    // unlocking would reveal nothing.
    const canChangeSomething = Object.keys(s).some((k) => _maySetSetting(k) !== null)
      || _maySetSetting("chat") !== null;
    if (canChangeSomething) {
      const lockBtn = H.el("button", {
        class: "settings-lock" + (H.settingsLocked() ? " locked" : ""),
        text: H.settingsLocked() ? "\uD83D\uDD12 Unlock settings" : "\uD83D\uDD13 Lock settings",
        title: H.settingsLocked() ? "Settings are locked — click to unlock" : "Settings unlocked — click to lock"
      });
      lockBtn.onclick = () => { H.setSettingsLocked(!H.settingsLocked()); renderSettings(); };
      // THE BAR, SPLIT IN TWO (owner ruling, ddjp_446): the lock and Apply, in their own slot ABOVE the
      // scrolling area (ddjp_459), so both stay in view and nothing scrolls behind them. Apply is the
      // only way a room setting leaves.
      const applyBtn = H.el("button", { class: "pref-add-btn settings-apply", text: "Apply" });
      applyBtn.onclick = _applyStaged;
      const status = H.el("div", { class: "set-hint settings-bar-status" });
      // Into its OWN SLOT above the scrolling area (ddjp_459) — never into the box that scrolls.
      refs.settingsBar.appendChild(H.el("div", { class: "settings-bar" }, [lockBtn, applyBtn, status]));
      _bar = { apply: applyBtn, status: status };
      _renderBar();
    }

    // A CHOICE AMONG SEVERAL is a radio list, and ON/OFF is a checkbox with its title — the shapes local
    // settings uses (owner-approved canvas, ddjp_464). Both stage through `_stageSetting`, as the pill
    // buttons did; nothing is sent before Apply.
    const optionRow = (key, label, current, options, onPick, desc, more) => {
      const row = H.el("div", { class: "set-row", "data-key": key });
      const line = _rowHead(row, key, label, desc);
      const ed = _editableFor(key);
      (ed ? row : line).appendChild(_choiceList(key, options, current, onPick, ed));   // locked: its word on the title line
      _rowMore(row, key, more);
      _box().appendChild(row);
    };
    const onOff = (key, desc, more) => {
      const cb = H.el("input", { type: "checkbox", class: "pref-master" });
      cb.checked = !!s[key];
      cb.disabled = !_editableFor(key);
      cb.onchange = () => _stageSetting(key, { [key]: !!cb.checked });
      const row = H.el("div", { class: "set-row set-check-row", "data-key": key });
      // Local settings' OWN row: `pref-master-row` and its indented `pref-note` — borrowed, not copied.
      row.appendChild(H.el("label", { class: "pref-master-row" }, [cb, H.el("span", { class: "set-label", text: _name(key) })]));
      row._moreDesc = desc || null;   // under More, like every other row (ddjp_487)
      _rowMore(row, key, more);
      _box().appendChild(row);
    };

    const idle = new Set(Room.idleSettings ? Room.idleSettings() : []);
    const live = (k) => !idle.has(k);
    const botHere = (typeof BotRuntime !== "undefined" && BotRuntime.botInRoom) ? !!BotRuntime.botInRoom() : true;
    const ms2 = (ms, per) => (typeof ms === "number") ? Math.round(ms / per) : 0;
    const dur = (v, unit, key) => _fmtDur(v, unit, key) || (v + (unit === "sec" ? " s" : " min"));
    const roads = Array.isArray(s.skipRoads) ? s.skipRoads.length : 0;
    const shared = Object.keys(s.botDelegation || {})
      .filter((k) => typeof s.botDelegation[k] === "string" && s.botDelegation[k] && live(k)).length;

    _section("room", "Room",
      (s.vis === "public" ? "Anyone can join" : "Invite only") + ", main chat " + _rankUp(s.chat)
        + ", " + (s.bg ? "custom background" : "no background"), () => {
      optionRow("vis", _name("vis"), s.vis,
        [["private", "Invite only"], ["public", "Anyone can join"]],
        (v) => _stageSetting("vis", { vis: v }),
        "Invite only rooms need an invite. Open rooms can be joined by anyone who finds them.");
      optionRow("chat", _name("chat"), s.chat,
        [["uncategorized", _rankUp("uncategorized")], ["guest", _rankUp("guest")], ["staff", _rankUp("staff")]],
        (v) => _stageSetting("chat", { chat: v }),
        "Which of the room\u2019s three chats is the main one.");
      _renderBgSettingRow(s, isOwner, _editableFor("bg"));
    });

    const repeatMin = ms2(s.repeatCooldownMs, 60000);
    _section("queue", "DJ queue",
      _rankUp(s.minDjRank) + " can DJ, " + (repeatMin > 0 ? "songs can replay after " + dur(repeatMin, "min") : "songs can replay any time"), () => {
      _renderMinDjRankRow(s, _editableFor("minDjRank"));
      _renderNumberSettingRow("repeatCooldownMs", _name("repeatCooldownMs"), s.repeatCooldownMs, 0, 43200, _editableFor("repeatCooldownMs"),
        "A song that played within this time can\u2019t be queued again. Set 0 to allow repeats.", 60000, "min",
        "Your app refuses a recent repeat when you try to queue it. Skipping a repeat someone queued earlier needs a bot in the room. Very long windows can do less than they look: each app only remembers so much play history, and one that can\u2019t see far enough back blocks nothing rather than guessing.");
    });

    _section("songs", "Songs",
      "Songs count as " + s.minLen + " s to " + dur(s.maxLen, "sec"), () => {
      _renderNumberSettingRow("maxLen", _name("maxLen"), s.maxLen, 10, 86400, _editableFor("maxLen"),
        "A song is never taken as longer than this, so one broken video can\u2019t stall the room.", 1, "sec");
      _renderNumberSettingRow("minLen", _name("minLen"), s.minLen, 5, 20, _editableFor("minLen"),
        "A song is never taken as shorter than this, so nobody can claim a song is short to skip it early.", 1, "sec",
        "Together with Longest a song can play it bounds the length everyone agrees on, so a false length report can\u2019t move a song on early or hold it forever. (CONCEPTS.md \u00a74.2 is where these three song settings are told apart.)");
      _section("fine", "Fine-tuning", "Rarely needs changing", () => {
        _renderNumberSettingRow("minGate", _name("minGate"), s.minGate, 0, 60, _editableFor("minGate"),
          "Even a very short song plays at least this long before the room moves on by itself.", 1000, "sec",
          "Without it, an honest move to the next song and a griefing one would look the same on a very short song. Longer is safer but adds a little silence after very short songs.");
        _renderNumberSettingRow("graceMs", _name("graceMs"), s.graceMs, 0, 10, _editableFor("graceMs"),
          "A small margin taken off the agreed length, so honest differences in where a song ends don\u2019t hold the room up.", 1000, "sec",
          "It absorbs disagreement about where a song ends, not network delay. Bigger moves on a little sooner; smaller waits for the full length.");
        _renderNumberSettingRow("presendMs", _name("presendMs"), s.presendMs, 0, 5000, _editableFor("presendMs"),
          "How long your app waits before posting the next song, in case someone else already did.", 1, "ms",
          "Keep this small. It exists so two apps don\u2019t both post the next song at once.");
        // NOT A BACKUP SETTING, whatever its key says: playback, blocked-song reports and length
        // reports all stagger by rank on this step, in every room type — which is why it lives here
        // and is never on an engine's idle list.
        _renderNumberSettingRow("vouchJitter", _name("vouchJitter"), s.vouchJitter, 500, 5000, _editableFor("vouchJitter"),
          "Ranks take turns, strongest first, when posting the next song and reporting songs that won\u2019t play. This is the gap between turns.", 1, "ms",
          "Bigger spreads the work out and avoids duplicates but reacts more slowly; smaller is quicker and chattier. In rooms where everyone keeps backups, it spaces those out too.");
      }, true);
    });

    _section("blocked", "Blocked songs", roads + (roads === 1 ? " skip rule" : " skip rules"), () => {
      _renderSkipRoadsSetting("skipRoads", _name("skipRoads"), s.skipRoads, _editableFor("skipRoads"),
        "When people report that a song won\u2019t play for them, the room skips it as soon as any rule below is met.",
        "Each count means different people. Uncategorized people are never counted, so a crowd of newcomers can\u2019t force a skip.");
    });

    // ── PRESENCE ACTS IN EVERY ROOM; THE QUEUE-PLACE RULES ONLY WITH A BOT ─────────────────────
    // The presence settings are ROOM truth for the People panel's "who is active" list as well as
    // the bot's away rule (`features/room.js`, WHO COUNTS AS ACTIVE), so they act with or without a
    // bot and are always shown. The reply window, the queue-place rules and delegation are the bot's
    // alone — `Room.idleFor` reads the queue pair and only the bot calls it — so they wait for one.
    const afkMin = ms2(s.botAfkMs, 60000), idleMin = ms2(s.queueIdleMs, 60000);
    // -- DEPENDENT ROWS SIT UNDER THEIR SWITCH, INDENTED, AND LEAVE WITH IT (ddjp_495) ---------
    // The owner-approved canvas: a row that only means something while a switch is on is drawn
    // under it and is ABSENT while it is off -- the rule `activityPresence` already followed
    // under a switch -- and the switch's place is taken by one plain line saying what
    // happens instead. `s` holds staged values, so this answers before Apply as well as after.
    const under = (build) => {
      const box = H.el("div", { class: "set-deps" });
      _box().appendChild(box);
      const prev = _host; _host = box;
      try { build(); } finally { _host = prev; }
    };
    const insteadLine = (text) => _box().appendChild(H.el("div", { class: "set-notice", text: text }));
    // AN ODD CHOICE IS SAID, NEVER REFUSED (owner, ddjp_497): both times and both chat switches stay
    // freely configurable, and the DJ card says in amber what a surprising combination will do.
    const warnLine = (text) => _box().appendChild(H.el("div", { class: "set-warn", text: text }));
    // THE BOT'S MESSAGES, THE SAME FOUR ROWS FOR EACH HALF. One builder so the two cards cannot
    // drift into two shapes; the keys differ, the order and the rules do not.
    const botMessages = (warn, ping, thanks, announce, pingText, whenText) => {
      _box().appendChild(H.el("div", { class: "set-group-label", text: "Bot messages" }));
      onOff(warn, null, "The bot posts \u201cAFK check\u201d in the main chat, then waits for an answer. Off: people are removed the moment " + whenText + ", with no message first.");
      if (s[warn] !== false) {
        under(() => {
          _renderNumberSettingRow(ping, _name(ping), s[ping], 15, 3600, _editableFor(ping),
            "After the bot asks someone if they\u2019re still there, how long it waits for an answer.", 1000, "sec");
          onOff(thanks, null, "Posted when a warned person does something in time.");
        });
      } else {
        insteadLine(pingText);
      }
      onOff(announce, null, "Posted in the main chat when the bot removes someone. Off: the removal still happens, without a message.");
    };

    // -- THE QUEUE-PLACE RULES ACT ONLY WITH A BOT -- `Room.idleFor` reads them and only the bot calls it.
    if (botHere) {
      _section("place", "DJ presence", "Away after " + dur(idleMin, "min"), () => {
        onOff("botQueueRemove", null,
          "Off: nobody loses their queue place for being idle, and the bot posts none of the messages below.");
        if (s.botQueueRemove === false) { insteadLine("Nobody loses their queue place for being idle."); return; }
        _renderNumberSettingRow("queueIdleMs", _name("queueIdleMs"), s.queueIdleMs, 1, 1440, _editableFor("queueIdleMs"),
          "How long a queue place is held for someone who has stopped doing anything.", 60000, "min",
          "Keep it shorter than Room presence\u2019s away time: an idle place holds up everyone behind it. Coming back doesn\u2019t restore the place, but a moderator can put someone back.");
        if (s.queueIdleMs > s.botAfkMs) warnLine("A DJ can be marked away while keeping their place.");
        onOff("botQueueChat", null,   /* its sentence only repeated the title (ddjp_487) */
          "Chat is never stored. The bot only notices that a message arrived, never what it said.");
        if (s.botQueueChat === true && s.botPresenceChat !== true) warnLine("A DJ who only chats can be marked away.");
        // ALWAYS SHOWN (ddjp_498). It hid when Room presence's actions switch was off, though DJ
        // presence never read that switch: a setting in force that nobody could see.
        _renderFlagMapSetting(optionRow, _name("activityQueue"), "activityQueue", s.activityQueue, _editableFor("activityQueue"),
          "Things your player does on its own, like starting the next song, never count. Untick every one and only chat counts.");
        botMessages("botQueueWarn", "botPingMs", "botQueueThanks", "botQueueAnnounce",
          "Idle DJs are removed after " + dur(idleMin, "min") + ", with no warning.", "their time runs out");
      }, true);
    }
    // -- PRESENCE ACTS IN EVERY ROOM; REMOVING PEOPLE FROM ITS CHAT ONLY WITH A BOT ---------------
    // The presence settings are ROOM truth for the People panel's "who is active" list as well as
    // the bot's away rule (`features/room.js`, WHO COUNTS AS ACTIVE), so they act with or without a
    // bot and are always shown -- and they STAY when removal is off, because People still reads them.
    _section("presence", "Room presence", "Away after " + dur(afkMin, "min"), () => {
      _renderNumberSettingRow("botAfkMs", _name("botAfkMs"), s.botAfkMs, 1, 1440, _editableFor("botAfkMs"),
        "After this long without activity, someone no longer counts as active in People, and a bot treats them as away.", 60000, "min",
        "This measures what people do, not whether they\u2019re watching. Someone quietly listening for an hour counts as away.");
      onOff("botPresenceChat", null,   /* its sentence only repeated the title (ddjp_487) */
        "Chat is never stored, so the People list can\u2019t count it itself; with this on, it says its list may leave out people who only chatted. A bot only notices that a message arrived, never what it said.");
      _renderFlagMapSetting(optionRow, _name("activityPresence"), "activityPresence", s.activityPresence, _editableFor("activityPresence"),
        "Being listed as present costs the room nothing, so this is usually more generous than the queue list. Untick every one and only chat counts.");
      if (botHere) {
        onOff("botPresenceRemove", null,
          "Off: nobody is removed from the presence chat. People still shows who is away, using the time above.");
        if (s.botPresenceRemove === false) {
          insteadLine("Nobody is removed from the presence chat. People still marks someone away after " + dur(afkMin, "min") + ".");
        } else {
          botMessages("botPresenceWarn", "botPresencePingMs", "botPresenceThanks", "botPresenceAnnounce",
            "Away people are removed from the presence chat after " + dur(afkMin, "min") + ", with no warning.", "they count as away");
        }
      } else {
        _box().appendChild(H.el("div", { class: "set-notice",
          text: "DJ presence, removing people who are away, and who can ask the bot for changes, appear here when a bot is in the room." }));
      }
    }, true);
    const gapMin = ms2(s.checkpointCooldownMs, 60000);
    _section("backups", "Backups and history",
      "A summary every " + dur(gapMin, "min") + " or " + s.checkpointEvery + " actions", () => {
      _renderSettingNote(null, live("vouchTable")
        ? "Everyone keeps small backups so the room can rebuild anything that gets deleted, and saves summaries so old history can be cleared. These settings change who does this and when, never what happened."
        : "The bot saves a summary of the room on this schedule, so old history can be cleared.");
      _renderNumberSettingRow("checkpointCooldownMs", _name("checkpointCooldownMs"), s.checkpointCooldownMs, 0, 1440, _editableFor("checkpointCooldownMs"),
        "The shortest time between two summaries of the room.", 60000, "min",
        "Applies to everyone, the owner included. Lower clears old history sooner; higher means less traffic.");
      _renderNumberSettingRow("checkpointEvery", _name("checkpointEvery"), s.checkpointEvery, 5, 1000, _editableFor("checkpointEvery"),
        "A summary is also due after this many actions, even if the gap hasn\u2019t passed.", 1, "actions",
        "The gap covers quiet rooms; this covers busy ones.");
      if (live("vouchTable") || live("receiptsPerMessage")) {
        _section("keep", "Who keeps backups", "How many people must hold each backup", () => {
          if (live("vouchTable")) {
            _renderTableSetting(_name("vouchTable"), "vouchTable", s.vouchTable, _editableFor("vouchTable"), true,
              "For each rank, how many people at that rank or higher must hold a backup before an event is safe.",
              "Nobody backs up their own events, so a rank needs one more person present than its number. Leave a rank blank if it should never be enough on its own, and tick Always helps so it still pitches in. The owner\u2019s own events always count as backed up: only they can delete them, and they always have them.");
          }
          if (live("receiptsPerMessage")) {
            _renderNumberSettingRow("receiptsPerMessage", _name("receiptsPerMessage"), s.receiptsPerMessage, 10, 50, _editableFor("receiptsPerMessage"),
              "How many backups travel with each message.", 1, "per message",
              "More spreads history faster, but too many makes a message too big to send. 10 fits comfortably.");
          }
        }, true);
      }
      if (live("checkpointTable") || live("checkpointRankOffsetMs") || live("selfWitnessCheckpoint")) {
        _section("standin", "Standing in for the owner", "When the owner is away", () => {
          if (live("checkpointTable")) {
            _renderTableSetting(_name("checkpointTable"), "checkpointTable", s.checkpointTable, _editableFor("checkpointTable"), false,
              "When the owner is away, how many people at each rank must produce matching summaries to stand in for the owner\u2019s.",
              "They have to agree with each other and line up with the last summary, or none of them is used. The people it takes are ones you promoted, so this is a number about how far you trust your own staff together. Higher is safer and harder to reach; blank means that rank can never stand in.",
              "This also decides when old history is deleted: once a summary is trusted, the history under it is cleared.");
          }
          if (live("checkpointRankOffsetMs")) {
            _renderNumberSettingRow("checkpointRankOffsetMs", _name("checkpointRankOffsetMs"), s.checkpointRankOffsetMs, 0, 120, _editableFor("checkpointRankOffsetMs"),
              "The owner saves first. Each rank below waits this much longer, so only one summary gets sent.", 1000, "sec",
              "Give it long enough for the owner\u2019s summary to arrive. A few seconds is usually right.");
          }
          if (live("selfWitnessCheckpoint")) {
            onOff("selfWitnessCheckpoint", "Lets someone save a summary when they personally hold every backup for that stretch.",
              "Useful in a quiet room, and safe because they could rebuild everything themselves.");
          }
        }, true);
      }
    });

    if (botHere) {
      _section("perms", "Bot permissions",
        shared === 0 ? "Only the owner can change settings" : (shared + (shared === 1 ? " setting shared" : " settings shared")), () => {
        _renderDelegationSetting("Who can ask the bot to change settings", "botDelegation", s.botDelegation, isOwner && !H.settingsLocked(),
          "Choose the lowest rank that can ask the bot to change each setting. Anything left as Owner only stays with the owner. This list itself can never be shared: whoever could change it could give themselves everything else.",
          Array.from(idle));
      });
    }

    if (isOwner) {
      _section("files", "Room files", "Restore a save file", () => {
        _renderRestoreFromFileRow(isOwner && !H.settingsLocked());
      });
    }
    // The saves this client holds — rendered HERE, inside the room, because that is the only place
    // "held from this room" is a true statement (v273). It places itself below the sections.
    Screens.renderExportSection();
    restoreScroll();
  }

  // ── THE DELEGATION TABLE (J17) ─────────────────────────────────────────────────────────────
  // A map control rather than a per-rank one, because `botDelegation` is keyed by SETTING. Both
  // halves are read from `SETTING_RANGES` — the key domain from the entry's own `keys()` and the
  // rank vocabulary from its `values` — rather than restated here. That is the whole reason the
  // key got a row: a key with no row leaves the panel with no bounds to read and forces it to
  // restate the vocabulary, which is the `chat` drift `roles.md` §Confusables already flags.
  //
  // `botDelegation` NEVER APPEARS IN ITS OWN LIST, and the panel does not have to remember that:
  // the domain it iterates is the reducer's, and the reducer's excludes it structurally. A panel
  // filtering it out by name would be a second copy of the rule, free to disagree.
  // Collapsed by default — see the shape decision inside. Module-level so the disclosure
  // survives the re-render that toggling it causes.
  let _delegationOpen = false;

  // ── A BOOLEAN MAP CONTROL ─────────────────────────────────────────────────────────────────
  // One on/off row per group, through `optionRow` like every other choice in this panel. The
  // delegation table needed its own collapsed shape because 22 settings x 8 ranks is 176 pills;
  // this is 6 groups x 2, which the established control handles without becoming a wall. Matching
  // the precedent is right HERE and was wrong THERE, and the difference is the measurement rather
  // than a preference.
  //
  // THE DOMAIN COMES FROM THE REDUCER, through the feature layer — `check-boundaries` rule D
  // forbids `ui/` naming `StateDeriver` at all. So a group added to `ACTIVITY_GROUPS` grows a row
  // here with no edit, and a group removed loses one.
  //
  // WRITES THE WHOLE MAP, never one key. The blob is last-write-wins and the reducer accepts a
  // flag map WHOLE or refuses it whole, so posting a single-key object would mean the map became
  // that one key and every other group silently reverted to absent — which reads as false.
  function _renderFlagMapSetting(optionRow, label, key, value, editable, note) {
    const entry = (Room.getSettingRanges() || {})[key];
    if (!entry || !Array.isArray(entry.keys)) return;
    const cur = (value && typeof value === "object" && !Array.isArray(value)) ? value : {};
    // A CHECKBOX LIST, one per group, like local settings' list of image hosts (ddjp_464). It was a row of
    // "Counts | Doesn't" buttons per group. Each tick stages the whole map, as each button did; whether it
    // may be changed is this map's own answer (`editable`), not a per-group key that no rule knows.
    const head = H.el("div", { class: "set-row", "data-key": key });
    _rowHead(head, key, label, note);
    const list = H.el("div", { class: "set-choices" });
    for (const g of entry.keys) {
      const cb = H.el("input", { type: "checkbox" });
      cb.checked = cur[g] === true;
      cb.disabled = !editable;
      cb.onchange = () => {
        const next = {};
        for (const k of entry.keys) next[k] = (k === g) ? !!cb.checked : (cur[k] === true);
        const patch = {}; patch[key] = next;
        _stageSetting(key, patch);
      };
      list.appendChild(H.el("label", { class: "pref-host", "data-key": key + ":" + g }, [cb, H.el("span", { text: H.activityGroupName(g, "long") })]));
    }
    head.appendChild(list);
    _rowMore(head, key, null); _box().appendChild(head);
  }

  function _renderDelegationSetting(label, key, value, editable, note, hidden) {
    // Bounds through the FEATURE LAYER (`Room.getSettingRanges`), never the reducer: rule D.
    const entry = (Room.getSettingRanges() || {})[key];
    if (!entry || !Array.isArray(entry.keys)) return;
    const domain = entry.keys;
    const names = entry.values;
    // Settings this room's engine never acts on are not LISTED — offering to delegate a control that
    // changes nothing is the inert control the panel no longer shows. They stay in the MAP: the write
    // below rebuilds it from the whole domain, so a delegation this room does not list survives.
    const skip = new Set(Array.isArray(hidden) ? hidden : []);
    // `cur` is declared BEFORE it is read. v288's first bug was a temporal-dead-zone read of it that
    // threw on every render and killed everything after `renderSettings` in `enterMainScreen`.
    const cur = (value && typeof value === "object") ? value : {};
    const wrap = H.el("div", { class: "set-row setting-delegation", "data-key": key });
    _rowHead(wrap, key, label, note);
    const set = Object.keys(cur).filter((k) => typeof cur[k] === "string" && cur[k] && !skip.has(k));
    // READ BY PEOPLE WHO ARE NOT THE OWNER, so it never tells them "only you".
    const listed = set.map((k) => _name(k)).join(", ");
    wrap.appendChild(H.el("div", { class: "muted", text: set.length
      ? set.length + (set.length === 1 ? " setting is" : " settings are") + " shared: " + listed
      : (editable ? "Nothing is shared. Only you can change these settings."
                  : "Nothing is shared \u2014 only the room's owner can change these settings.") }));
    // Collapsed by default: nothing is delegated in almost every room, so the honest default view is
    // the one line above rather than a list of every setting reading "Owner only".
    const toggle = H.el("button", { class: "set-opt", text: _delegationOpen ? "Hide the list"
      : (editable ? "Choose what others can ask for" : "See what others can ask for") });
    toggle.onclick = () => { _delegationOpen = !_delegationOpen; renderSettings(); };
    wrap.appendChild(H.el("div", { class: "set-opts" }, [toggle]));
    if (_delegationOpen) {
      const placed = new Set();
      const groups = _DELEG_GROUPS.map((g) => [g[0], g[1].filter((k) => domain.indexOf(k) >= 0 && !skip.has(k))]);
      for (const g of groups) g[1].forEach((k) => placed.add(k));
      const rest = domain.filter((k) => !placed.has(k) && !skip.has(k));
      if (rest.length) groups.push(["Other", rest]);
      for (const g of groups) {
        if (!g[1].length) continue;
        wrap.appendChild(H.el("div", { class: "set-group-label", text: g[0] }));
        for (const k of g[1]) {
          const row = H.el("div", { class: "dim-row delegation-row" });
          row.appendChild(H.el("span", { class: "dim-label delegation-key", text: _name(k) }));
          const sel = H.el("select", { class: "rank-select delegation-rank" });
          sel.setAttribute("aria-label", _name(k) + ": who can ask");
          // "Owner only" is the ABSENCE of a row, not a rank — and it says OWNER, because people who
          // are not the owner read this list too. `owner` itself is skipped: delegating to the owner
          // would mean exactly what "Owner only" already means.
          sel.appendChild(H.el("option", { value: "", text: "Owner only" }));
          for (const n of names) {
            if (n === "owner") continue;
            sel.appendChild(H.el("option", { value: n, text: _rankUp(n) }));
          }
          sel.value = (typeof cur[k] === "string") ? cur[k] : "";
          sel.disabled = !editable;
          sel.onchange = () => {
            // WHOLE-OR-NOTHING over the WHOLE domain, unlisted keys included, so a removal can be
            // expressed and a delegation this room does not list is kept rather than dropped.
            const next = {};
            for (const kk of domain) {
              const v = (kk === k) ? sel.value : cur[kk];
              if (typeof v === "string" && v) next[kk] = v;
            }
            // OWNER-ONLY, AND STILL NEVER A REQUEST. It stages like every row now (ddjp_446), and the
            // delegable path still cannot carry the one control that widens delegation: a non-owner's
            // `_maySetSetting("botDelegation")` is null (`decide` refuses it as not-a-setting), so it
            // can neither be staged nor sent, and the bot refuses it again on arrival.
            _stageSetting("botDelegation", { botDelegation: next });
          };
          row.appendChild(sel);
          wrap.appendChild(row);
        }
      }
    }
    // `_box()` — the section body while one renders. Never `refs.settingsBody`, a name that has
    // never existed and once threw here, silently skipping seven renders downstream.
    _rowMore(wrap, key, null); _box().appendChild(wrap);
  }

  // ── RESTORE THIS ROOM FROM A SAVE FILE (J28) ─────────────────────────────────────────────────
  // The counterpart to the export picker on the rooms screen: that one writes a file, this one
  // reads one back into a room that is already running.
  //
  // IT DECIDES NOTHING. Whether the file is readable, whether its version and settings key set are
  // ones this build reads, whether its author declaration can be corroborated, whether the client
  // is caught up enough to anchor on the head, and whether this client is the owner are all
  // answered below the seam — the first four by `Room.overrideFromFile` and the backend it calls,
  // the last inside `Checkpoint.publishImport`. The only judgement here is "is this even JSON",
  // because a parse failure has no meaning to report from any deeper layer. Same division as the
  // create-from-file control in `app.js`.
  //
  // THE GATE IS `Actions.describe`, NEVER A RANK. The UI compares no rank to anything
  // (check-ui-no-permission), so whether to offer this at all is asked of the capability system
  // using the same verb that gates every other row in this panel.
  //
  // AND IT IS DELIBERATELY BEHIND THE SAME MASTER LOCK as every setting here. Restoring a room is
  // the most consequential thing on this panel — every client that adopts the checkpoint stops
  // computing from its own history below the cut — so it should not be one stray click away.
  function _renderRestoreFromFileRow(editable) {
    if (!Actions.describe("room.settings").enabled) return;   // not the owner: no control at all
    const row = H.el("div", { class: "set-row" });
    _rowHead(row, "restore", "Restore from a file", "Restore this room from a save file you downloaded earlier.");
    const note = H.el("div", { class: "set-desc" });
    const input = H.el("input", { type: "file", accept: "application/json,.json" });
    input.setAttribute("aria-label", "Save file to restore from");
    const btn = H.el("button", { class: "btn-secondary", text: "Restore from file" });
    if (!editable) {
      btn.disabled = true;
      note.textContent = "Unlock settings above to restore.";
    }
    btn.onclick = async () => {
      const f = input.files && input.files[0];
      if (!f) { note.textContent = "Choose a save file first."; return; }
      let parsed;
      try { parsed = JSON.parse(await f.text()); }
      catch (e) { note.textContent = "That file is not readable JSON."; return; }
      btn.disabled = true;
      note.textContent = "Restoring\u2026";
      // THE RESULT IS READ, and every branch says something different: a refusal that renders as
      // silence leaves a person pressing the button twice (paths.md §8c).
      let res;
      try { res = await Room.overrideFromFile(parsed); }
      catch (e) { res = { ok: false, reason: "failed", detail: e && e.message }; }
      btn.disabled = false;
      if (res && res.ok) {
        note.textContent = "Restored. The room is now running from the file \u2014 everyone here "
          + "will pick it up as it reaches them.";
        return;
      }
      const reason = (res && res.reason) || "unknown";
      if (reason === "peer-file-unimportable") {
        note.textContent = "That file was saved by somebody who is not the room's owner, and only "
          + "an owner-authored file can restore a room. Ask the owner of the room it came from "
          + "for their own copy \u2014 saving this one again will not help.";
      } else if (reason === "not-live") {
        note.textContent = "This room is still loading. Wait until it has caught up and try again "
          + "\u2014 a restore has to know where the room is now.";
      } else if (reason === "checkpoint-not-published") {
        note.textContent = "The room is now using the file's settings but still its own queue \u2014 "
          + "the restore did not finish. Try again; repeating it is harmless.";
      } else {
        note.textContent = "Could not restore: " + reason
          + ((res && res.detail) ? " \u2014 " + res.detail : "");
      }
    };
    row.appendChild(H.el("div", { class: "set-opts" }, [input, btn]));
    row.appendChild(note);
    _rowMore(row, "restore",
      "The queue, who was DJing, what was playing and the room's settings all come from the file, and "
      + "the room carries on from there. What happened here before is not deleted, but the room stops "
      + "computing from it, so treat this as a restore rather than an undo. Nobody is invited and "
      + "nobody's rank changes: people in the file who are not in this room drop out of the queue as "
      + "their saved songs play. Only an owner-authored file works, and only the owner can do this.");
    _box().appendChild(row);
  }

  // ── WHO MAY JOIN THE DJ QUEUE (J07) ──────────────────────────────────────────────────────────
  // A rank row, and the OPTIONS ARE DERIVED FROM THE REDUCER'S OWN TABLE rather than written here.
  // `Room.getSettingRanges().minDjRank.values` is the vocabulary the fold will accept, so the panel
  // cannot offer a rank the reducer refuses — the same relationship every number row already has
  // with its bounds, and the reason this key's validation was put in that table at all.
  //
  // Contrast `Main chat` a few lines above, whose three values ARE written in this file and again
  // in the reducer. That is the older shape and the drift this row exists not to repeat; it is left
  // alone here because changing it is not this job.
  //
  // The label is a DISPLAY form of the rank NAME — ui/ compares no rank to a number, so there is
  // nothing here for check-boundaries rule H to catch. It reuses `_rankLabel`, the helper the two
  // per-rank tables below already use; a second copy of that one-line transform is exactly the
  // duplication this row is otherwise built to avoid.
  function _renderMinDjRankRow(s, editable) {
    // The options are DERIVED from the reducer's own table, so the panel cannot offer a rank the
    // fold refuses; the labels are display forms of the rank NAMES (ui/ compares no rank).
    const r = (Room.getSettingRanges ? (Room.getSettingRanges().minDjRank || null) : null);
    const values = (r && Array.isArray(r.values)) ? r.values : [];
    const cur = (s && typeof s.minDjRank === "string") ? s.minDjRank : null;
    const row = H.el("div", { class: "set-row", "data-key": "minDjRank" });
    const line = _rowHead(row, "minDjRank", _name("minDjRank"), "The lowest rank that can join the DJ queue.");
    if (!values.length) {
      // No options to list at all — the only case the shared builder cannot cover.
      line.appendChild(H.el("div", { class: "set-value", text: cur ? _rankUp(cur) : "\u2014" }));
    } else {
      // The same list as every choice (ddjp_464), which shows the chosen rank's own words when this
      // row cannot be changed — the rule this row had first, now the builder's (ddjp_483).
      (editable ? row : line).appendChild(_choiceList("minDjRank", values.map((v) => [v, _rankUp(v)]), cur,
        (name) => _stageSetting("minDjRank", { minDjRank: name }), editable));
    }
    _rowMore(row, "minDjRank",
      "Raising it never removes anyone already in the queue. It decides who may join from now on, and "
      + "someone who leaves or drops out is judged by the rule in force when they come back.");
    _box().appendChild(row);
  }

  // A plain explanatory row: an optional bold heading plus body text. Used to introduce a group of
  // settings once, instead of repeating the same context in every row's hint.
  function _renderSettingNote(heading, text) {
    // A section's short introduction — said once, rather than repeated in every row.
    const row = H.el("div", { class: "set-intro" });
    if (heading) row.appendChild(H.el("div", { class: "set-label", text: heading }));
    row.appendChild(H.el("div", { class: "set-desc", text: text }));
    _box().appendChild(row);
  }

  // ── The two per-rank TABLES. Editing any row posts the WHOLE table, because the reducer accepts
  // a table only if it is COMPLETE and well-formed — that all-or-nothing rule is what stops a room
  // ending up half on a new policy and half on the old one. A BLANK count means "never": that rank
  // can never satisfy on its own (it can still help via the always toggle).
  // ONE ROW PER LADDER RUNG, asked for rather than written down. This was six hand-written labels
  // against a seven-rung ladder — guest missing, uncategorized wrongly editable — and since an edit
  // posts the whole table, six values went into seven slots and the last landed on the wrong rung.
  // Capabilities owns the row set and the edit so the count cannot drift from the ladder again, and
  // so a guard can RUN the rule instead of only reading it (check-settings-rows).
  const _rankRows = () => Room.getSettingRows();
  const _rankLabel = (name) => name.replace(/(^|-)([a-z])/g, (m, d, c) => (d ? "-" : "") + c.toUpperCase());

  function _renderTableSetting(title, key, table, editable, withAlways, hint, more, warn) {
    const head = H.el("div", { class: "set-row", "data-key": key });
    _rowHead(head, key, title, hint);
    if (warn) head.appendChild(H.el("div", { class: "set-warn", text: warn }));
    _rowMore(head, key, more);
    _box().appendChild(head);
    const rows = Array.isArray(table) ? table : [];
    const specs = _rankRows();
    // BOUNDS COME FROM THE REDUCER'S TABLE (J62), as the number rows' do.
    const lim = (Room.getSettingRanges ? (Room.getSettingRanges()[key] || null) : null);
    for (let i = 0; i < specs.length; i++) {
      const cur = rows[i] || {};
      const row = H.el("div", { class: "set-row set-rank-row" });
      const rankName = _rankLabel(specs[i].name);
      row.appendChild(H.el("span", { class: "set-rank-name", text: rankName }));
      // A locked rung is shown READ-ONLY even to the owner: uncategorized is a structural rule, not a
      // preference, and is displayed so the rule is visible instead of merely absent.
      if (!editable || !specs[i].editable) {
        const txt = (typeof cur.enough === "number") ? String(cur.enough) : "never";
        const extra = (withAlways && cur.always) ? ", always helps" : "";
        row.appendChild(H.el("span", { class: "set-value", text: txt + extra }));
        _box().appendChild(row);
        continue;
      }
      const input = H.el("input", { type: "number", class: "uq-input", value: (typeof cur.enough === "number") ? String(cur.enough) : "" });
      input.setAttribute("aria-label", rankName + ": people needed");
      if (lim) { input.min = String(lim.enoughMin); input.max = String(lim.enoughMax); }
      input.placeholder = "never";
      const controls = [input];
      let always = null;
      if (withAlways) {
        always = H.el("input", { type: "checkbox" });
        always.checked = (cur.always === true);
        controls.push(H.el("label", { class: "set-hint", style: "display:flex;align-items:center;gap:4px;" },
          [always, H.el("span", { text: "Always helps" })]));
      }
      const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
      // STAGED ON CHANGE, no Set button (ddjp_446). The table is read FRESH through `_valueNow`,
      // not from `rows`, which is what this table looked like when it was drawn: a second edit
      // before Apply must build on the first, or the first is silently lost.
      const slot = key + ":" + i;
      const stageRow = () => {
        const rawVal = String(input.value).trim();
        const n = (rawVal === "") ? null : Math.round(Number(rawVal));
        if (n !== null && (!isFinite(n) || (lim && (n < lim.enoughMin || n > lim.enoughMax)))) {
          err.textContent = lim ? ("Enter " + lim.enoughMin + "-" + lim.enoughMax + ", or leave blank for never.")
                                : "Enter a whole number, or leave blank for never.";
          err.style.display = "block";
          _markInvalid(slot, null, rankName + ": " + err.textContent);
          return;
        }
        err.style.display = "none";
        // The complete table is built by Capabilities, not here: the posted shape is the ladder's.
        const base = _valueNow(key);
        const next = Room.editSettingTable(Array.isArray(base) ? base : [], i, n, withAlways, always ? always.checked : false);
        if (!next) {
          err.textContent = "That row cannot be changed.";
          err.style.display = "block";
          _markInvalid(slot, null, rankName + ": that row cannot be changed.");
          return;
        }
        _stageSetting(key, { [key]: next }, false, slot);
      };
      input.onchange = stageRow;
      if (always) always.onchange = stageRow;
      row.appendChild(H.el("div", { class: "set-num" }, controls));
      row.appendChild(err);
      _box().appendChild(row);
    }
  }

  // A generic NUMERIC setting row (maxLen/minLen/gate dials): an <input> that STAGES on change;
  // someone who cannot change it sees the current value read-only. The range mirrors the
  // reducer's validation so the UI can't offer an out-of-range value; the reducer re-validates
  // regardless. Stages a partial with just this key; Apply sends it with the rest.
  // `scale` (optional) lets a row show friendly units while storing raw ones — e.g. the checkpoint
  // cooldown is shown in MINUTES but stored in ms. min/max are expressed in the SHOWN unit.
  // The SKIP ROADS control. Each road is a pair (guest+, VIP+) of distinct-blocked-user
  // thresholds; the room skips when ANY road's both numbers are met. Rendered as plain
  // rows the owner reads as "5 blocked from guest up, OR 4 from VIP up, OR 3 and 2". Read
  // only for owners; others see the current roads. Writes the whole list back at once so a
  // half-edited table never reaches the reducer.
  function _renderSkipRoadsSetting(key, title, roads, editable, hint, more) {
    const list = Array.isArray(roads) ? roads : [];
    const lim = (Room.getSettingRanges ? (Room.getSettingRanges()[key] || null) : null);   // J62: the reducer's table
    const row = H.el("div", { class: "set-row", "data-key": key });
    _rowHead(row, key, title, hint);
    const describe = (r) => {
      const parts = [];
      if (r.guestPlus > 0) parts.push(r.guestPlus + " from Guest up");
      if (r.vipPlus > 0) parts.push(r.vipPlus + " from VIP up");
      return parts.length ? "Skip at " + parts.join(" and ") : "Empty rule (ignored)";
    };
    if (!editable) {
      for (const r of list) row.appendChild(H.el("div", { class: "set-rule set-value", text: describe(r) }));
      if (!list.length) row.appendChild(H.el("div", { class: "set-value", text: "No skip rules" }));   // said, not blank (ddjp_479)
    } else {
      // The reducer drops a malformed list WHOLESALE and says nothing, so this panel never assembles
      // one (J62, fixed at ddjp_419). Every bound is the reducer's own (`lim`); the 0 and Infinity
      // are only what is left when that table cannot be reached.
      const lo = lim ? lim.itemMin : 0, hi = lim ? lim.itemMax : Infinity;
      const most = lim ? lim.maxItems : Infinity, fewest = lim ? lim.minItems : 1;
      const clamp = (x) => Math.min(hi, Math.max(lo, Math.round(Number(x) || 0)));
      const draft = list.map((r) => ({ guestPlus: r.guestPlus || 0, vipPlus: r.vipPlus || 0 }));
      const box = H.el("div", { class: "set-rules" });
      let err = null;
      const commit = () => {
        const real = draft.filter((r) => r.guestPlus > 0 || r.vipPlus > 0);   // a blank road is not a rule
        if (real.length < fewest || real.length > most) {
          if (err) {
            err.textContent = (real.length < fewest)
              ? ("A room needs at least " + fewest + " skip rule" + (fewest === 1 ? "" : "s") + " with a number above 0.")
              : ("Up to " + most + " rules.");
            err.style.display = "block";
          }
          _markInvalid(key, key, err ? err.textContent : "These skip rules cannot be sent.");
          return;                                             // never stage a list the rules would drop
        }
        if (err) err.style.display = "none";
        _stageSetting(key, { [key]: real }, false);           // every valid draft is staged (ddjp_446)
      };
      const redraw = () => {
        while (box.firstChild) box.removeChild(box.firstChild);   // no innerHTML in the DOM layer
        draft.forEach((r, i) => {
          const txt = H.el("span", { text: describe(r) });
          const g = H.el("input", { type: "number", class: "uq-input", value: String(r.guestPlus) }); if (lim) { g.min = String(lim.itemMin); g.max = String(lim.itemMax); }
          const v = H.el("input", { type: "number", class: "uq-input", value: String(r.vipPlus) }); if (lim) { v.min = String(lim.itemMin); v.max = String(lim.itemMax); }
          g.setAttribute("aria-label", "Rule " + (i + 1) + ": people from Guest up");
          v.setAttribute("aria-label", "Rule " + (i + 1) + ": people from VIP up");
          g.onchange = () => { r.guestPlus = clamp(g.value); g.value = String(r.guestPlus); txt.textContent = describe(r); commit(); };
          v.onchange = () => { r.vipPlus = clamp(v.value); v.value = String(r.vipPlus); txt.textContent = describe(r); commit(); };
          const del = H.el("button", { class: "set-opt", text: "Remove" });
          del.setAttribute("aria-label", "Remove rule " + (i + 1));
          del.onclick = () => { draft.splice(i, 1); redraw(); commit(); };
          box.appendChild(H.el("div", { class: "set-rule" }, [
            H.el("div", { class: "set-rule-top" }, [txt, del]),
            // EACH LABEL KEPT WITH ITS BOX (owner report, ddjp_488): loose in one wrapping row, a narrow window
            // broke the line between "VIP and up" and its own box.
            H.el("div", { class: "set-num" }, [
              H.el("span", { class: "set-pair" }, [H.el("span", { class: "set-unit", text: "Guest and up" }), g]),
              H.el("span", { class: "set-pair" }, [H.el("span", { class: "set-unit", text: "VIP and up" }), v])]),
          ]));
        });
        const full = draft.length >= most;
        const add = H.el("button", { class: "pref-add-btn", text: "Add a rule" });
        add.disabled = full;
        add.onclick = () => { if (draft.length >= most) return; draft.push({ guestPlus: 0, vipPlus: 0 }); redraw(); };
        const bar = [add];
        if (full) bar.push(H.el("span", { class: "set-range", text: "Up to " + most + " rules." }));
        box.appendChild(H.el("div", { class: "set-num" }, bar));
        err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
        box.appendChild(err);
      };
      redraw();
      row.appendChild(box);
    }
    _rowMore(row, key, more);
    _box().appendChild(row);
  }

  function _renderNumberSettingRow(key, label, current, min, max, editable, hint, scale, unit, more) {
    // BOUNDS COME FROM THE REDUCER, converted into the unit the person types. The caller's min/max
    // are a fallback only: each row once carried its own copy, three drifted when the reducer
    // narrowed its ranges, and two compared a seconds input against millisecond bounds.
    const _r = (Room.getSettingRanges ? (Room.getSettingRanges()[key] || null) : null);
    const f = (_r && typeof _r.scale === "number" && _r.scale > 0)
      ? _r.scale : ((typeof scale === "number" && scale > 0) ? scale : 1);
    if (_r) { min = _r.min / f; max = _r.max / f; }
    const cur = (typeof current === "number") ? (current / f) : "";
    const row = H.el("div", { class: "set-row", "data-key": key });
    const words = _fmtDur(cur, unit, key);
    const line = _rowHead(row, key, label, hint);
    if (!editable) {
      // Locked: ONE line — the title and what it is set to, in words where there are some.
      line.appendChild(H.el("div", { class: "set-value", text: (cur === "" ? "\u2014" : (words || String(cur) + (unit ? " " + unit : ""))) }));
      _rowMore(row, key, more);
      _box().appendChild(row);
      return;
    }
    const input = H.el("input", { type: "number", class: "uq-input", value: String(cur) });
    input.setAttribute("aria-label", label + (unit ? " (" + unit + ")" : ""));
    input.min = String(min); input.max = String(max);
    const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
    // STAGED ON CHANGE, no Set button (ddjp_446): Apply sends it with everything else.
    const submit = () => {
      const n = Math.round(Number(input.value));
      if (!isFinite(n) || n < min || n > max) {
        err.textContent = "Enter a number from " + min + " to " + max + ".";
        err.style.display = "block";
        _markInvalid(key, key, label + ": " + err.textContent);
        return;
      }
      err.style.display = "none";
      _stageSetting(key, { [key]: n * f }, false);
    };
    input.onchange = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    // THE TEXT BEFORE THE BOX (owner report, ddjp_488): with the words, range and unit after it, each box sat
    // wherever its text happened to end, and no two lined up. Before it, every box ends at the row's right edge.
    line.appendChild(H.el("div", { class: "set-num" }, [   // on the title line; it wraps below a long title
      words ? H.el("span", { class: "set-readout", text: words }) : null,
      H.el("span", { class: "set-range", text: min + "\u2013" + max }),
      unit ? H.el("span", { class: "set-unit", text: unit }) : null, input,
    ]));
    row.appendChild(err);
    _rowMore(row, key, more);
    _box().appendChild(row);
  }

  // The room background-image control (owner-only). A validated PNG/JPEG link from
  // an approved provider; clients download it into their per-room cache and paint
  // it (see the _bg engine). Non-owners see the current link read-only. Validation
  // uses the SAME provider allowlist as chat images (ChatPrefs), so the hint and
  // the gate agree with what each viewer will actually load.
  function _renderBgSettingRow(s, isOwner, editable) {
    const cur = (s && s.bg) || null;
    const row = H.el("div", { class: "set-row", "data-key": "bg" });
    _rowHead(row, "bg", _name("bg"), "A PNG or JPEG link from an approved image host, shown behind the room.", cur ? "Set" : "None");
    if (!editable) {
      // Locked, the row still says what it is set to (ddjp_479) — nothing at all looked like no option.
      row.appendChild(H.el("div", { class: "set-value", text: cur || "No background" }));
      _rowMore(row, "bg", null); _box().appendChild(row);
      return;
    }
    const input = H.el("input", { type: "text", class: "uq-input",
      placeholder: "Paste an image link", value: cur || "" });
    input.setAttribute("aria-label", "Background image link");
    const clearBtn = H.el("button", { class: "set-opt", text: "Clear" });
    const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
    // CHECKED AS IT IS TYPED, and there is no Set button (owner ruling, ddjp_446). An approved link
    // is staged; an unapproved one is not, and holds Apply back until it is fixed or locked away.
    // An empty field changes nothing — Clear is what stages the removal.
    const check = () => {
      const raw = input.value.trim();
      if (!raw) { err.style.display = "none"; delete _invalid.bg; delete _staged.values.bg; _renderBar(); return; }
      const safe = Media.safeBgUrl(raw, ChatPrefs.bgOpts().hostAllowed);
      if (!safe) {
        err.textContent = "That isn't an approved image link. Use a PNG or JPEG from an approved host (see \u2699 Settings).";
        err.style.display = "block";
        _markInvalid("bg", "bg", err.textContent);
        return;
      }
      err.style.display = "none";
      _stageSetting("bg", { bg: safe }, false);
    };
    input.oninput = check;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } };
    clearBtn.onclick = () => { input.value = ""; err.style.display = "none"; _stageSetting("bg", { bg: null }, false); };
    row.appendChild(H.el("div", { class: "set-num" }, [input, clearBtn]));
    if (!ChatPrefs.bgOpts().bgOn) {
      row.appendChild(H.el("div", { class: "set-desc",
        text: "You have backgrounds turned off for yourself (\u2699 Settings), so you won't see this even when it's set." }));
    }
    row.appendChild(err);
    _rowMore(row, "bg", null); _box().appendChild(row);
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return { renderSettings, renderChatSettings };
})();
