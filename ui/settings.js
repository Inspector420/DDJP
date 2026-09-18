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
// `_setLocks` and `SETTINGS_LOCK_CLEAR_MS` went the other way — declared in MODULE STATE and
// CONSTANTS, read by nothing but this cluster, so they came with it.
//
// Depends on: UIBase, Interface (via UIBase.host), Room, Capabilities, Ranks, ChatPrefs, Logger

const Settings = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;

  // --- state and constants this cluster owns, moved out with it -------------
  const SETTINGS_LOCK_CLEAR_MS  = 3000;  // optimistic settings lock releases + re-renders
  const _setLocks = {};   // settingKey -> true while a just-changed option is locked (3s)

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ USER SETTINGS PANEL
  //
  // Per-user device config: chat display toggles, the host allowlist, the two dim sliders.
  // Never touches the backend.
  // ────────────────────────────────────────────────────────────────────────────────────────

  function renderChatSettings() {
    const boxEl = refs.chatSettingsBox;
    if (!boxEl) return;
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
    boxEl.appendChild(lockBtn);

    // Everything below lives in one wrapper so a single pass can disable it all
    // while locked (the lock button itself stays enabled, outside the wrapper).
    const wrap = H.el("div", { class: "prefs-body" + (H.prefsLocked() ? " prefs-locked" : "") });
    // Images: ONE shared provider list, TWO independent toggles — inline chat
    // images and room backgrounds. The list greys only when BOTH are off; with
    // either on it stays active (it's feeding a live consumer). Removing a host
    // drops it from both at once (the merged-providers design).
    wrap.appendChild(_prefSection({
      note: "Off by default. These approved providers are shared by inline chat images and room backgrounds. A provider sees your IP when an image loads from it.",
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
      title: "Links in chat",
      note: "Off by default. When on, a link to an allowed host becomes clickable and opens in a new tab.",
      enabled: ChatPrefs.linksEnabled(),
      onToggle: (v) => ChatPrefs.setLinksEnabled(v),
      defaults: ChatPrefs.linkDefaults(),
      onDefault: (h, on) => ChatPrefs.setDefaultLinkHost(h, on),
      custom: ChatPrefs.linkCustomHosts(),
      onAdd: (h) => ChatPrefs.addLinkHost(h),
      onRemove: (h) => ChatPrefs.removeLinkHost(h),
    }));
    wrap.appendChild(_dimSection());
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

    const wrap = H.el("div", { class: "set-row" });
    wrap.appendChild(H.el("div", { class: "set-label", text: "This account is the room's bot" }));
    wrap.appendChild(H.el("div", { class: "muted", text: on
      ? "Watching the video, and reporting song lengths like anyone else."
      : "Not loading the video. Everything else works as normal — this account still moderates, "
        + "sweeps for idle DJs and reads the room. It will not report song lengths or say it "
        + "cannot see the video, because not watching is deliberate." }));
    const btn = H.el("button", { class: "set-opt" + (on ? " active" : ""),
      text: on ? "Stop watching videos" : "Watch videos on this device" });
    btn.onclick = () => {
      try { ChatPrefs.setBotView(!on); } catch (e) {}
      renderChatSettings();
    };
    wrap.appendChild(H.el("div", { class: "set-opts" }, [btn]));
    return wrap;
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
  function _dimSection() {
    const sec = H.el("div", { class: "pref-section" });
    sec.appendChild(H.el("div", { class: "pref-master-row" }, [H.el("span", { class: "pref-title", text: "Appearance" })]));
    sec.appendChild(H.el("div", { class: "pref-note", text: "How dark the room background and the panels look. Applies to this device only." }));
    sec.appendChild(_dimRow("Background dimness", () => ChatPrefs.bgDim(),   "--bg-dim",   (v) => ChatPrefs.setBgDim(v),   ChatPrefs.DIM_RANGES.bgDim));
    sec.appendChild(_dimRow("Panel dimness",      () => ChatPrefs.panelDim(), "--panel-dim", (v) => ChatPrefs.setPanelDim(v), ChatPrefs.DIM_RANGES.panelDim));
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
    const sec = H.el("div", { class: "pref-section" });

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

  // A form of toggles, not a view of a channel. The buttons ALWAYS reflect the
  // current state read from Matrix (chat tier is derived; visibility is the
  // space's live join rule), so there's nothing to reconcile. Only the owner can
  // change them, and after a change the just-touched setting locks for 3s so it
  // can't be re-toggled before the new state lands and re-renders.
  function _lockSetting(key) {
    _setLocks[key] = true;
    renderSettings();
    setTimeout(() => { delete _setLocks[key]; renderSettings(); }, SETTINGS_LOCK_CLEAR_MS);
  }

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

  // Route one settings change. `partial` is the same one-key object every row already builds, so
  // no row needs to know which path it took.
  function _commitSetting(key, partial) {
    const how = _maySetSetting(key);
    // THROUGH THE ADAPTER (J31). `_maySetSetting` above already asks
    // `Actions.describe("room.settings").enabled` for the RULE, and this line then dispatched
    // around the adapter that holds it — the rule and the act reaching the wire by two routes.
    // `perform` re-checks the same descriptor, so the answer cannot differ; what changes is that
    // there is one seam instead of a read and a write that could drift.
    // AND THE REJECTION IS CAUGHT, BECAUSE THE CONTRACT CHANGED UNDER NINE CALLERS.
    // `Room.setSettings` RESOLVES `{ok:false, reason}` for a refusal; `Actions.perform` REJECTS
    // when the descriptor is not enabled. None of this function's callers has a handler — they
    // were written against a promise that always settles — so routing without this turns a rare
    // race into an unhandled rejection in the console. The race is real and is the whole point
    // of the re-check: `how === "write"` was decided a moment earlier, and a rank can move in
    // between. Reported, and the panel re-renders from the settings subscription either way.
    if (how === "write") {
      return Actions.perform("room.settings", { partial: partial })
        .catch((e) => { Logger.warn("settings: " + ((e && e.message) || e)); return { ok: false }; });
    }
    if (how !== "request") return null;   // inert rows should never reach here
    let cur = null;
    try { cur = Room.getCurrent(); } catch (e) { cur = null; }
    let myLevel = null;
    try { myLevel = Room.getMyAuthorityLevel(); } catch (e) { myLevel = null; }
    if (!cur || !cur.channels || myLevel === null) { _settingSentNote(key, false); return null; }
    return Promise.resolve(BotSettings.request(cur.channels, myLevel, key, partial[key]))
      .then((r) => { _settingSentNote(key, !!(r && r.ok)); return r; })
      .catch(() => { _settingSentNote(key, false); return null; });
  }

  // A REQUEST IS AN ASK, AND THE WORDING SAYS SO. A direct write shows "Updating…" because it
  // either lands or errors; a request travels to another account that may be offline, may refuse
  // on rank, or may not exist. Telling somebody their change is saved when it has only been
  // posted is the same class as the AFK sweep counting an undelivered warning as delivered.
  function _settingSentNote(key, sent) {
    _setLocks[key] = false;
    const box = refs.settingsBox;
    if (!box) return;
    const note = H.el("div", { class: "set-hint", text: sent
      ? "Asked the room's bot to change this. It applies only if the bot is running and the room "
        + "still delegates this setting to your rank."
      : "That request could not be sent." });
    box.appendChild(note);
  }

  function renderSettings() {
    if (!refs.settingsBox) return;
    H.clear(refs.settingsBox);
    // The saves section is a child of this box, so clearing the box destroys it — the ref must go
    // with it or the next render appends into a node no longer in the document.
    refs.settingsExport = null;
    const s = Room.getSettings();
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

    refs.settingsBox.appendChild(H.el("div", { class: "uq-section", text: "Room settings" }));
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
      refs.settingsBox.appendChild(lockBtn);
    }

    const optionRow = (key, label, current, options, onPick) => {
      const locked = !!_setLocks[key];
      const opts = H.el("div", { class: "set-opts" });
      options.forEach(([val, text]) => {
        const active = val === current;
        const clickable = _editableFor(key) && !active && !locked;
        const b = H.el("button", { class: "set-opt" + (active ? " active" : ""), text: text });
        if (clickable) b.onclick = () => { onPick(val); _lockSetting(key); };
        else b.disabled = true;   // non-owner, current choice, a per-setting lock, OR the master lock → inert
        opts.appendChild(b);
      });
      const row = H.el("div", { class: "set-row" }, [H.el("div", { class: "set-label", text: label }), opts]);
      if (locked) row.appendChild(H.el("div", { class: "set-hint", text: "Updating…" }));
      refs.settingsBox.appendChild(row);
    };

    optionRow("chat", "Main chat", s.chat,
      [["uncategorized", "Uncategorized"], ["guest", "Guest"], ["staff", "Staff"]],
      (v) => _commitSetting("chat", { chat: v }));
    optionRow("vis", "Visibility", s.vis,
      [["private", "Private — invite only"], ["public", "Public — anyone can join"]],
      (v) => _commitSetting("vis", { vis: v }));
    _renderMinDjRankRow(s, _editableFor("minDjRank"));

    _renderBgSettingRow(s, isOwner, _editableFor("bg"));
    _renderNumberSettingRow("maxLen", "Max song length (sec)", s.maxLen, 10, 86400, _editableFor("maxLen"), "Songs auto-advance past this (10-min default keeps the room from freezing on unplayable songs).");
    _renderNumberSettingRow("minLen", "Grace period (sec)", s.minLen, 0, 600, _editableFor("minLen"), "Nothing auto-acts in the first few seconds of a song.");
    // -- WHEN A SONG MOVES ON (advance safety) ---------------------------------------------
    _renderSettingNote("When a song moves on",
      "These decide how the room agrees a song has ended, so nobody can cut a song short and everyone lands on the same next song.");
    _renderNumberSettingRow("minGate", "Shortest time before the next song (sec)", s.minGate, 0, 60000, _editableFor("minGate"),
      "Even a very short song waits at least this long before moving on, so everyone has time to react in order. Longer is safer but adds a little silence on short songs.", 1000);
    _renderNumberSettingRow("graceMs", "Allowance for length disagreement (sec)", s.graceMs, 0, 10000, _editableFor("graceMs"),
      "A small cushion for when people measured a song's length slightly differently. Bigger allows more disagreement; smaller is stricter.", 1000);
    _renderNumberSettingRow("presendMs", "Pause before you post the next song (ms)", s.presendMs, 0, 5000, _editableFor("presendMs"),
      "A tiny wait before your own device posts the next song, so it notices if someone already did. Keep it small.");
    _renderSkipRoadsSetting("skipRoads", "When to skip a song too many can't see", s.skipRoads, _editableFor("skipRoads"),
      "The room skips a song the moment ANY of these is true. Counts are different people who report being blocked. Uncategorized people are never counted, so a crowd of them can't force a skip.");
    // ── BACKUPS & SUMMARIES (advanced) ────────────────────────────────────────────────────
    // Written for a room owner, not an engineer: no protocol vocabulary, each row says what it
    // does, which way to move it, and (where one exists) the trap.
    _renderSettingNote("Backups & summaries",
      "Everyone here keeps small backups of what happens, so that if something is deleted the room can rebuild it by itself. These settings decide who keeps backups, how many are enough, and how often the room saves a summary so old history can be cleared. They only change who does what and when — they can never change what actually happened. What they do change is how quickly the room lets go of old history, so the summary settings below are worth a slower read than the rest.");

    _renderTableSetting("How many people must back up an event", "vouchTable", s.vouchTable, _editableFor("vouchTable"), true,
      "For each rank: how many different people at that rank or higher need a backup before an event counts as safe. Nobody backs up their own events, so a rank needs one more person present than its number to cover its own. The strongest rank that reaches its number settles it; ranks above that keep backing up anyway. Leave blank if that rank should never be enough on its own, and tick 'always helps' so they still pitch in when nobody stronger is covering. The owner is the one exception: their own events count as backed up already, because only they can delete them and they always have them. That one is built in and there is no switch for it — the alternative would be defending the owner against the owner, and would leave a quiet room permanently unable to save anything. Blank plus 'always helps' is the shipped setting for Player and Guest: their backups count towards nobody else's number, but having their own full set lets them save a summary for themselves and clear their own old history. Choose numbers your room can actually reach: a number nobody can meet means people keep trying forever.");

    _renderTableSetting("Who can replace the owner's summary", "checkpointTable", s.checkpointTable, _editableFor("checkpointTable"), false,
      "The owner's summary is always trusted. When the owner is away, this decides how many different people at each rank must produce matching summaries to stand in for one. They have to agree with each other, and each has to be checkable against the last one — if they don't line up, none of them is used. THIS IS ALSO THE DELETE SETTING: once a summary is trusted, everyone who trusts it clears the history underneath it, so this number is how many people would have to agree with each other before the room lets go of what came before. The people it takes are ones you promoted, so it is a number about how much you trust your own staff together. Higher is safer and harder to reach; blank means that rank can never stand in.");

    _renderNumberSettingRow("checkpointCooldownMs", "Minimum gap between summaries (minutes)", s.checkpointCooldownMs, 0, 1440, _editableFor("checkpointCooldownMs"),
      "The minimum time between summaries for the whole room — the owner included, so nobody can flood it. Nothing is saved until this has passed, whatever the other settings say. Lower clears old history sooner; higher means less traffic.", 60000);

    _renderNumberSettingRow("checkpointEvery", "Save a summary after this many actions", s.checkpointEvery, 5, 1000, _editableFor("checkpointEvery"),
      "A summary is also due once this many things have happened since the last one, whether or not the gap above has passed. The gap covers a quiet room; this covers a busy one — either is reason enough. Lower means more summaries and shorter history to keep; higher means fewer.");

    _renderNumberSettingRow("checkpointRankOffsetMs", "Head start for each rank (seconds)", s.checkpointRankOffsetMs, 0, 120, _editableFor("checkpointRankOffsetMs"),
      "The owner saves a summary first. Each rank below waits this much longer, so they only step in when the ranks above them did not — one summary instead of one per person. Give it enough time for the owner's summary to actually arrive; a few seconds is usually right.", 1000);


    optionRow("selfWitnessCheckpoint", "Save a summary from your own backups", s.selfWitnessCheckpoint ? "on" : "off",
      [["on", "On — allowed if I have every backup myself"], ["off", "Off — only when the room has enough backups"]],
      (v) => _commitSetting("selfWitnessCheckpoint", { selfWitnessCheckpoint: v === "on" }));
    _renderSettingNote(null,
      "Normally you can only save a summary once enough of the room has backups, so anything cleared can still be recovered by someone. With this on, you may also save one when you personally hold every backup for that stretch — useful in a quiet room, and safe because you could rebuild it all yourself.");

    _renderNumberSettingRow("vouchJitter", "Turn-taking step & peer jitter (ms)", s.vouchJitter, 0, 10000, _editableFor("vouchJitter"),
      "People take turns backing things up, strongest rank first, so the whole room doesn't send at once. This is the gap between each rank's turn. Bigger spreads the work out and avoids duplicates but reacts more slowly; smaller is quicker and chattier.");

    _renderNumberSettingRow("receiptsPerMessage", "Backups carried per message", s.receiptsPerMessage, 1, 50, _editableFor("receiptsPerMessage"),
      "Messages carry a few small backups of recent events along with them. More per message spreads history faster, but too many makes the message too big to send. 10 sits comfortably under the limit.");

    // ── THE BOT DIALS (J17) ──────────────────────────────────────────────────────────────────
    // EVERY SETTING THE REDUCER DEFINES MUST BE REACHABLE HERE — `check-settings-rows` PART G and
    // `check-settings-passthrough` both require it, and the J17 lattice measured them as
    // independently load-bearing rather than one dominating the other. J17's Touches field did not
    // name `ui/interface.js`; the build step is what discovers that, and the omission is why this
    // change earns a `?v=` bump a reader of that field alone would not have expected.
    //
    // ── THE BOT IS LIVE AS OF v322, AND THIS SAID IT DID NOT EXIST ────────────────────────
    // The original note was written when nothing called `BotRuntime.start()`, and it was accurate
    // then. It is not now: a client signed in as an account holding the ladder's top rung in this
    // room BECOMES the bot, with no button and no setting, because the owner grants the level in
    // Matrix and that is the switch.
    //
    // The reasoning the old note carried still stands and is why these were built before the
    // runtime was: the reducer defines the keys, so the room HAS these values whether or not
    // anything reads them, and a value the owner can neither see nor change is what PART G exists
    // to prevent. What was rejected on exactly those grounds was a speculative DISPLAY toggle for
    // J19 — a control that does nothing is a visible lie. That distinction is the reason this
    // block had to be re-read the moment the runtime landed: the text below is shown to a PERSON,
    // and it was telling them a feature they are using does not exist.
    _renderSettingNote("The bot", "These settle how the room's bot behaves. A bot is any client signed in as an account you have given the top rank in this room — there is nothing to switch on here. If no such account is present the room simply holds these settings.");

    optionRow("botPresenceSpine", "Count queue actions as being around", s.botPresenceSpine ? "on" : "off",
      [["on", "On — playing, voting and saving count"], ["off", "Off — ignore them"]],
      (v) => _commitSetting("botPresenceSpine", { botPresenceSpine: v === "on" }));
    _renderSettingNote(null,
      "Whether things people do in the room — joining the queue, voting, saving — count as a sign they are around.");

    optionRow("botPresenceChat", "Count chat as being around", s.botPresenceChat ? "on" : "off",
      [["on", "On — chatting counts too"], ["off", "Off — chat is not counted"]],
      (v) => _commitSetting("botPresenceChat", { botPresenceChat: v === "on" }));

    // THE QUEUE'S OWN CHAT SWITCH. Deliberately beside the presence one so an owner sees that the
    // two timers ask the same question separately, rather than discovering later that turning chat
    // on for one did nothing for the other.
    optionRow("botQueueChat", "Count chat as keeping your queue place", s.botQueueChat ? "on" : "off",
      [["on", "On — chatting keeps your place"], ["off", "Off — only queue actions count"]],
      (v) => _commitSetting("botQueueChat", { botQueueChat: v === "on" }));
    // OFF BY DEFAULT and the note says why rather than leaving it to be discovered. Every other
    // rule in this project keeps chat out of durable surfaces, and turning this on is the one
    // place a person opts into chat being read for anything.
    _renderSettingNote(null,
      "Off by default. Chat is private to the room and is never stored or included in summaries; turning this on only lets a bot notice that a message arrived, nothing about what it said.");

    _renderFlagMapSetting(optionRow, "What keeps you in the presence chat", "activityPresence", s.activityPresence, _editableFor("activityPresence"),
      "Which actions count as being around for the presence chat. Usually more generous than the queue list: being in a chat costs the room nothing, and the cost of getting this wrong is throwing out somebody who was there.");

    _renderNumberSettingRow("botAfkMs", "Treat someone as away after (minutes)", s.botAfkMs, 1, 1440, _editableFor("botAfkMs"),
      "How long without doing any of the things above before a bot treats somebody as away. This measures what people DO, not whether they are watching — somebody quietly listening for an hour counts as away.", 60000);

    _renderNumberSettingRow("botPingMs", "Wait for an answer for (seconds)", s.botPingMs, 15, 3600, _editableFor("botPingMs"),
      "After a bot asks whether somebody is still there, how long it waits before acting on the silence.", 1000);

    // ── WHAT COUNTS AS BEING AROUND, PER GROUP (v322) ──────────────────────────────────────
    // TWO maps and not one, because they answer two questions the room may answer differently:
    // what keeps your PLACE IN THE QUEUE, and what keeps you in the presence chat. Holding a deck
    // while gone blocks other people; sitting in a chat while gone blocks nobody.
    //
    // `botPresenceSpine` above is the master switch for the whole log; these say WHICH acts
    // within it. A room with the switch off is not asked these questions — rendering them would
    // offer an owner controls that decide nothing, which is the shape `check-settings-rows` PART
    // G exists to refuse from the other direction.
    _renderFlagMapSetting(optionRow, "What keeps your place in the queue", "activityQueue", s.activityQueue, _editableFor("activityQueue"),
      "Which deliberate actions count as still wanting your turn. A bot removes somebody from the queue after the time below without doing any of these. Things your player does on its own — starting the next song, reporting a length — never count, or somebody who queued songs and walked away would look busy forever.");

    _renderNumberSettingRow("queueIdleMs", "Give up a queue place after (minutes)", s.queueIdleMs, 1, 1440, _editableFor("queueIdleMs"),
      "How long a deck is held for somebody who has stopped doing any of the things above. Shorter than the away time, because an idle deck blocks everybody else while an idle chat member blocks nobody. Coming back does not restore the place — a moderator can put somebody back.", 60000);

    _renderNumberSettingRow("repeatCooldownMs", "Don't replay a song within (minutes)", s.repeatCooldownMs, 0, 43200, _editableFor("repeatCooldownMs"),
      "0 turns this off. A song that played inside this window is skipped when it comes up again, and clients will not let it into a queue in the first place. It needs a bot running to do the skipping. Very long windows may do less than they look like they do: each client's play history only reaches so far back, and a client that cannot see far enough blocks nothing rather than guessing.", 60000);

    _renderDelegationSetting("What a bot may change on request", "botDelegation", s.botDelegation, isOwner && !H.settingsLocked(),
      "Which settings a bot is allowed to change when somebody asks it to, and the lowest rank that may ask. Anything not listed here can only be changed by you. This list itself is not on it, and cannot be: whoever could change it could give themselves everything else.");

    _renderRestoreFromFileRow(isOwner && !H.settingsLocked());
    // The saves this client holds — rendered HERE, inside the room, because that is the only place
    // "held from this room" is a true statement (v273).
    Screens.renderExportSection();
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
    // Human names for the groups. A group with no label here still renders, under its own id —
    // failing OPEN, because a missing label is a cosmetic gap and a missing ROW is a setting the
    // owner cannot reach, which is the more expensive of the two.
    const NAMES = {
      rotation:   "Joining, leaving or reordering the queue",
      moderation: "Moving, removing or striking somebody",
      skip:       "Skipping a song",
      vote:       "Upvoting a song",
      save:       "Saving a song",
      settings:   "Changing the room settings",
    };
    _renderSettingNote(label, note);
    for (const g of entry.keys) {
      const on = cur[g] === true;
      optionRow(key + ":" + g, NAMES[g] || g, on ? "on" : "off",
        [["on", "Counts"], ["off", "Does not count"]],
        (v) => {
          // Rebuild the FULL map from the domain, so the write is whole and every group carries an
          // explicit boolean. Reading `cur` for the others rather than the DOM: the DOM holds what
          // is drawn, and a row that failed to draw would silently write false.
          const next = {};
          for (const k of entry.keys) next[k] = (k === g) ? (v === "on") : (cur[k] === true);
          const patch = {}; patch[key] = next;
          _commitSetting(key, patch);
        });
    }
  }

  function _renderDelegationSetting(label, key, value, editable, note) {
    // Bounds through the FEATURE LAYER, never `StateDeriver` — `check-boundaries` rule D forbids
    // `ui/` naming the reducer at all, and it caught this on the first run. `Room.getSettingRanges`
    // is the seam the rest of this panel already reads its bounds from, and it resolves the map
    // entry's derived key domain to a plain array on the way across.
    const entry = (Room.getSettingRanges() || {})[key];
    if (!entry || !Array.isArray(entry.keys)) return;
    const domain = entry.keys;
    const names = entry.values;
    // ── THE PRECEDENT DOES NOT FIT, AND THAT IS THE DECISION ────────────────────────────────
    // Every other option goes through `optionRow` → `.set-opts` with `.set-opt` pills, and this
    // table did not: it built `.setting-row` / `.setting-label` / `.setting-delegation`, **none of
    // which `index.html` declares.** The select was themed at v273; the row around it never
    // existed.
    //
    // MEASURED BEFORE FORCING THE PRECEDENT: 22 delegable settings × 8 rank choices = **176
    // pills**. That is a wall whatever it is styled as, and `optionRow`'s pill row does not scale
    // to it — "match the others" would have produced a themed wall, which is still a wall.
    //
    // **AND ZERO SETTINGS ARE DELEGATED BY DEFAULT**, which is what makes the honest shape
    // obvious: the table is empty in almost every room, so the default view should be the empty
    // one. It renders COLLAPSED — a summary line naming what is delegated, and the full list only
    // when asked for. A room that has delegated nothing shows one line instead of twenty-two rows
    // of "Nobody", and a room that has delegated three shows those three.
    //
    // THE CLASSES ARE THE ONES THE STYLESHEET ACTUALLY DECLARES, checked rather than assumed —
    // the first attempt reached for `pref-block`/`pref-row`/`pref-label`, three names that do not
    // exist, which is the same mistake this item is about, made again one layer along. `set-row`
    // and `set-label` are the settings panel's own; `dim-row`/`dim-label` is the established
    // label-plus-control pair; `set-opts`/`set-opt` is the disclosure.
    // ── `cur` IS DECLARED BEFORE IT IS READ, AND THAT IS THE WHOLE OF v288's FIRST BUG ────────
    // v287 added the summary line, which reads `cur` — and left `const cur = …` twelve lines
    // BELOW it, where the expanded branch had always declared it. `const` is hoisted into a
    // temporal dead zone, so the read threw `ReferenceError: Cannot access 'cur' before
    // initialization` on EVERY render of this panel, from the first room open.
    //
    // The consequence is the v280 shape exactly: nothing between `renderSettings()` and the end of
    // `enterMainScreen` is inside a `try`, so `renderLogs`, `ChatPrefs.load`, `_setLayout`,
    // `_applyDisplayDims`, `renderChatSettings` and `_renderGear` never ran — the all-panels-
    // combined display, and the delegation table missing, are ONE bug.
    const cur = (value && typeof value === "object") ? value : {};
    const wrap = H.el("div", { class: "set-row setting-delegation" });
    wrap.appendChild(H.el("div", { class: "set-label", text: label }));
    const set = Object.keys(cur).filter((k) => typeof cur[k] === "string" && cur[k]);
    // ── THIS PANEL IS READ BY PEOPLE WHO ARE NOT THE OWNER, AND IT ADDRESSED ONLY THE OWNER ──
    // The rows are inert for them but the panel renders, so a delegated staff member read
    // "Only YOU can change these settings" — false to them in the one direction that matters, and
    // the same defect as "Only the owner can change these" on the bot's screen. The names are
    // listed with their display names for the same reason the rows are.
    const listed = set.map((k) => ChatPanels._settingDisplayName(k)).join(", ");
    const summary = H.el("div", { class: "muted", text: set.length
      ? set.length + (set.length === 1 ? " setting is" : " settings are") + " delegated: " + listed
      : (editable ? "Nothing is delegated. Only you can change these settings."
                  : "Nothing is delegated — only the room's owner can change these settings.") });
    wrap.appendChild(summary);
    // AND THE BUTTON PROMISED AN ACTION TO SOMEBODY WHO CANNOT TAKE IT. For a reader who cannot
    // edit the table, this opens a read-only view, and the label now says that instead of
    // "Change what a bot may do".
    const toggle = H.el("button", { class: "set-opt", text: _delegationOpen ? "Hide the list"
      : (editable ? "Change what a bot may do" : "See what a bot may do") });
    toggle.onclick = () => { _delegationOpen = !_delegationOpen; renderSettings(); };
    wrap.appendChild(H.el("div", { class: "set-opts" }, [toggle]));
    if (!_delegationOpen) {
      refs.settingsBox.appendChild(wrap);
      if (note) _renderSettingNote(null, note);
      return;
    }
    for (const k of domain) {
      const row = H.el("div", { class: "dim-row delegation-row" });
      row.appendChild(H.el("span", { class: "dim-label delegation-key", text: ChatPanels._settingDisplayName(k) }));
      // `rank-select` is the themed precedent every other dropdown in this panel uses.
      // `delegation-rank` was declared NOWHERE, so eighteen of these rendered as native dropdowns —
      // the third unstyled control shipped in five packages, each guarded by nothing.
      const sel = H.el("select", { class: "rank-select delegation-rank" });
      // "Nobody" is the ABSENCE of a row, not a rank — a delegation table naming a rank for every
      // key would be a table that delegates everything, which is the opposite of its default.
      sel.appendChild(H.el("option", { value: "", text: "Nobody — owner only" }));
      // `owner` IS SKIPPED, AND IT IS THE ONLY ONE. Delegating a setting TO the owner is a no-op:
      // the owner writes settings directly and never travels through a bot request, so the row
      // would mean exactly what "Nobody — owner only" already means. Two options with one meaning
      // is a choice a person has to work out rather than read.
      //
      // The list is otherwise the ladder as the reducer hands it over — including
      // `uncategorized`, which really does mean everyone in the room, and is a delegation an
      // owner may legitimately want.
      for (const n of names) {
        if (n === "owner") continue;
        sel.appendChild(H.el("option", { value: n, text: n }));
      }
      sel.value = (typeof cur[k] === "string") ? cur[k] : "";
      sel.disabled = !editable;
      sel.onchange = () => {
        // WHOLE-OR-NOTHING, matching the reducer: the full map is rebuilt and sent, never a patch.
        // A partial write would be merged field-by-field by `applySettingsEvent` and could not
        // express a REMOVAL, so a row could be added and never taken away.
        const next = {};
        for (const kk of domain) {
          const v = (kk === k) ? sel.value : cur[kk];
          if (typeof v === "string" && v) next[kk] = v;
        }
        // OWNER-ONLY, AND DELIBERATELY NOT ROUTED. `botDelegation` is excluded from its own key
        // domain precisely so no rank can be delegated the power to widen its own delegation.
        // Routing it through `_commitSetting` would be harmless today — the bot refuses a key
        // outside the domain — but it would put the one control that must never be delegable on
        // the delegable path, which is a fact about this line worth stating rather than relying
        // on a refusal two modules away.
        // NOT `_commitSetting` (see above) — but still through the ADAPTER (J31). `perform`
        // re-checks `room.settings`, which is owner-gated, so this stays off the delegated
        // request path exactly as the paragraph above requires while stopping this from being
        // the one settings write that reaches the feature directly.
        Actions.perform("room.settings", { partial: { botDelegation: next } })
          .catch((e) => Logger.warn("botDelegation: " + ((e && e.message) || e)));
      };
      row.appendChild(sel);
      wrap.appendChild(row);
    }
    // ── `refs.settingsBox`, NOT `settingsBody` ────────────────────────────────────────────────
    // THIS LINE THREW IN THE FIRST BROWSER RUN AND KILLED SEVEN OTHER THINGS. `refs.settingsBody`
    // is not a stale reference — it is a name that HAS NEVER EXISTED anywhere in this file, one
    // character of divergence from the `settingsBox` all twenty-one sibling appends use. Every
    // guard passed, because no guard has ever CALLED this function.
    refs.settingsBox.appendChild(wrap);
    if (note) _renderSettingNote(null, note);
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

    _renderSettingNote("Restore this room from a save file",
      "Loads a saved copy of a room into this one: the queue, who was DJing, what was playing and "
      + "the room's settings all come from the file. The room carries on from there. What was "
      + "happening here before is not deleted, but the room stops computing from it — so treat "
      + "this as a restore rather than an undo. Nobody is invited and nobody's rank changes: "
      + "people in the file who are not in this room simply drop out of the queue as their saved "
      + "songs play. Only an owner-authored file works, and only the owner can do this.");

    const note = H.el("p", { class: "muted" });
    const input = H.el("input", { type: "file", accept: "application/json,.json" });
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
      note.textContent = "Restoring…";
      // THE RESULT IS READ, and every branch says something different. A refusal that renders as
      // silence is the shape that leaves a person pressing a button twice — the same reason the
      // feature layer RETURNS its refusals instead of dropping them (paths.md §8c).
      let res;
      try { res = await Room.overrideFromFile(parsed); }
      catch (e) { res = { ok: false, reason: "failed", detail: e && e.message }; }
      btn.disabled = false;
      if (res && res.ok) {
        note.textContent = "Restored. The room is now running from the file — everyone here "
          + "will pick it up as it reaches them.";
        return;
      }
      const reason = (res && res.reason) || "unknown";
      // The one refusal whose remedy is a DIFFERENT FILE rather than a retry, kept in the words
      // J27 established: no re-export can supply the joining segment of a room this client will
      // never hold.
      if (reason === "peer-file-unimportable") {
        note.textContent = "That file was saved by somebody who is not the room's owner, and only "
          + "an owner-authored file can restore a room. Ask the owner of the room it came from "
          + "for their own copy — saving this one again will not help.";
      } else if (reason === "not-live") {
        note.textContent = "This room is still loading. Wait until it has caught up and try again "
          + "— a restore has to know where the room is now.";
      } else if (reason === "checkpoint-not-published") {
        note.textContent = "The room is now using the file's settings but still its own queue — "
          + "the restore did not finish. Try again; repeating it is harmless.";
      } else {
        note.textContent = "Could not restore: " + reason
          + ((res && res.detail) ? " — " + res.detail : "");
      }
    };
    const row = H.el("div", { class: "set-row" }, [
      H.el("div", { class: "set-label", text: "Save file" }),
      H.el("div", { class: "set-opts" }, [input, btn]),
    ]);
    refs.settingsBox.appendChild(row);
    refs.settingsBox.appendChild(note);
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
    const r = (Room.getSettingRanges ? (Room.getSettingRanges().minDjRank || null) : null);
    const values = (r && Array.isArray(r.values)) ? r.values : [];
    const cur = (s && typeof s.minDjRank === "string") ? s.minDjRank : null;
    const locked = !!_setLocks.minDjRank;
    const row = H.el("div", { class: "set-row" });
    row.appendChild(H.el("div", { class: "set-label", text: "Who may join the DJ queue" }));
    if (!editable || !values.length) {
      row.appendChild(H.el("div", { class: "set-hint", text: cur ? (_rankLabel(cur) + " and above") : "\u2014" }));
      refs.settingsBox.appendChild(row);
      return;
    }
    const opts = H.el("div", { class: "set-opts" });
    for (const name of values) {
      const active = name === cur;
      const b = H.el("button", { class: "set-opt" + (active ? " active" : ""), text: _rankLabel(name) });
      if (!active && !locked) b.onclick = () => { _commitSetting("minDjRank", { minDjRank: name }); _lockSetting("minDjRank"); };
      else b.disabled = true;
      opts.appendChild(b);
    }
    row.appendChild(opts);
    row.appendChild(H.el("div", { class: "set-hint", text:
      "The weakest rank allowed to join the rotation. Raising it does NOT remove anyone already in "
      + "the queue — it decides who may join from now on, and someone who leaves or falls out is "
      + "judged by whatever the bar is when they come back." }));
    if (locked) row.appendChild(H.el("div", { class: "set-hint", text: "Updating\u2026" }));
    refs.settingsBox.appendChild(row);
  }

  // A plain explanatory row: an optional bold heading plus body text. Used to introduce a group of
  // settings once, instead of repeating the same context in every row's hint.
  function _renderSettingNote(heading, text) {
    const row = H.el("div", { class: "set-row" });
    if (heading) row.appendChild(H.el("div", { class: "set-label", text: heading }));
    row.appendChild(H.el("div", { class: "set-hint", text: text }));
    refs.settingsBox.appendChild(row);
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

  function _renderTableSetting(title, key, table, editable, withAlways, hint) {
    refs.settingsBox.appendChild(H.el("div", { class: "set-row" }, [
      H.el("div", { class: "set-label", text: title }),
      H.el("div", { class: "set-hint", text: hint || "" }),
    ]));
    const rows = Array.isArray(table) ? table : [];
    const specs = _rankRows();
    for (let i = 0; i < specs.length; i++) {
      const cur = rows[i] || {};
      const row = H.el("div", { class: "set-row" });
      row.appendChild(H.el("div", { class: "set-label", text: "\u2003" + _rankLabel(specs[i].name) }));
      // A locked rung is shown READ-ONLY even to the owner: uncategorized is a structural rule
      // ("no number of unplaced accounts is ever enough"), not a preference, and it is displayed
      // rather than hidden so the rule is visible instead of merely absent.
      if (!editable || !specs[i].editable) {
        const txt = (typeof cur.enough === "number") ? String(cur.enough) : "never";
        const extra = (withAlways && cur.always) ? " \u00b7 always helps" : "";
        row.appendChild(H.el("div", { class: "set-hint", text: txt + extra }));
        refs.settingsBox.appendChild(row);
        continue;
      }
      const input = H.el("input", { type: "number", class: "uq-input", value: (typeof cur.enough === "number") ? String(cur.enough) : "" });
      input.min = "1"; input.max = "50"; input.placeholder = "never";
      const controls = [input];
      let always = null;
      if (withAlways) {
        always = H.el("input", { type: "checkbox" });
        always.checked = (cur.always === true);
        controls.push(H.el("label", { class: "set-hint", style: "display:flex;align-items:center;gap:4px;" },
          [always, H.el("span", { text: "always helps" })]));
      }
      const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
      const setBtn = H.el("button", { class: "pref-add-btn", text: "Set" });
      setBtn.onclick = () => {
        const rawVal = String(input.value).trim();
        const n = (rawVal === "") ? null : Math.round(Number(rawVal));
        if (n !== null && (!isFinite(n) || n < 1 || n > 50)) {
          err.textContent = "Enter 1-50, or leave blank for never.";
          err.style.display = "block";
          return;
        }
        err.style.display = "none";
        // The complete table is built by Capabilities, not here: the posted shape is decided by the
        // ladder rather than by whatever this panel happens to be holding, which is what made the
        // short post possible in the first place.
        const next = Room.editSettingTable(rows, i, n, withAlways, always ? always.checked : false);
        if (!next) {
          err.textContent = "That row cannot be changed.";
          err.style.display = "block";
          return;
        }
        _commitSetting(key, { [key]: next });
        _lockSetting(key);
      };
      controls.push(setBtn);
      row.appendChild(H.el("div", { class: "uq-add", style: "display:flex;gap:6px;align-items:center;" }, controls));
      row.appendChild(err);
      refs.settingsBox.appendChild(row);
    }
  }

  // A generic owner-only NUMERIC setting row (maxLen/minLen/gate dials). Mirrors the bg
  // input row: an <input> + Set button, non-owner sees the current value read-only.
  // The range mirrors the reducer's validation so the UI can't offer an out-of-range
  // value; Room.setSettings re-validates regardless. Passes a partial with just this key.
  // `scale` (optional) lets a row show friendly units while storing raw ones — e.g. the checkpoint
  // cooldown is shown in MINUTES but stored in ms. min/max are expressed in the SHOWN unit.
  // The SKIP ROADS control. Each road is a pair (guest+, VIP+) of distinct-blocked-user
  // thresholds; the room skips when ANY road's both numbers are met. Rendered as plain
  // rows the owner reads as "5 blocked from guest up, OR 4 from VIP up, OR 3 and 2". Read
  // only for owners; others see the current roads. Writes the whole list back at once so a
  // half-edited table never reaches the reducer.
  function _renderSkipRoadsSetting(key, title, roads, editable, hint) {
    const list = Array.isArray(roads) ? roads : [];
    const row = H.el("div", { class: "set-row" });
    row.appendChild(H.el("div", { class: "set-label", text: title }));
    const describe = (r) => {
      const parts = [];
      if (r.guestPlus > 0) parts.push(r.guestPlus + " from guest up");
      if (r.vipPlus > 0) parts.push(r.vipPlus + " from VIP up");
      return parts.join(" and ") || "(nothing)";
    };
    row.appendChild(H.el("div", { class: "set-hint", text: list.map(describe).join("   OR   ") }));
    if (editable) {
      // Two inputs per road plus add/remove, kept deliberately simple; the reducer validates
      // and drops a malformed list wholesale, so the UI only has to assemble pairs.
      const draft = list.map((r) => ({ guestPlus: r.guestPlus || 0, vipPlus: r.vipPlus || 0 }));
      const box = H.el("div", { class: "uq-add", style: "display:flex;flex-direction:column;gap:6px;" });
      const commit = () => { _commitSetting(key, { [key]: draft.filter((r) => r.guestPlus > 0 || r.vipPlus > 0) }); _lockSetting(key); };
      const redraw = () => {
        while (box.firstChild) box.removeChild(box.firstChild);   // no innerHTML in the DOM layer
        draft.forEach((r, i) => {
          const g = H.el("input", { type: "number", class: "uq-input", value: String(r.guestPlus) }); g.min = "0"; g.max = "200";
          const v = H.el("input", { type: "number", class: "uq-input", value: String(r.vipPlus) }); v.min = "0"; v.max = "200";
          g.onchange = () => { r.guestPlus = Math.max(0, Math.round(Number(g.value) || 0)); };
          v.onchange = () => { r.vipPlus = Math.max(0, Math.round(Number(v.value) || 0)); };
          const del = H.el("button", { class: "pref-add-btn", text: "x" });
          del.onclick = () => { draft.splice(i, 1); redraw(); };
          box.appendChild(H.el("div", { style: "display:flex;gap:6px;align-items:center;" },
            [H.el("span", { class: "set-hint", text: "guest+" }), g, H.el("span", { class: "set-hint", text: "VIP+" }), v, del]));
        });
        const add = H.el("button", { class: "pref-add-btn", text: "Add a rule" });
        add.onclick = () => { draft.push({ guestPlus: 0, vipPlus: 0 }); redraw(); };
        const save = H.el("button", { class: "pref-add-btn", text: "Save rules" });
        save.onclick = commit;
        box.appendChild(H.el("div", { style: "display:flex;gap:6px;" }, [add, save]));
      };
      redraw();
      row.appendChild(box);
    }
    if (hint) row.appendChild(H.el("div", { class: "set-hint", text: hint }));
    refs.settingsBox.appendChild(row);
  }

  function _renderNumberSettingRow(key, label, current, min, max, editable, hint, scale) {
    // BOUNDS COME FROM THE REDUCER, and are converted into the unit the user actually types.
    // The caller's min/max are a fallback only. Previously each row carried its own copy: three
    // drifted when the reducer narrowed its ranges, and two compared a seconds input against
    // millisecond bounds — so the panel accepted values the reducer then silently discarded.
    const _r = (Room.getSettingRanges ? (Room.getSettingRanges()[key] || null) : null);
    const f = (_r && typeof _r.scale === "number" && _r.scale > 0)
      ? _r.scale : ((typeof scale === "number" && scale > 0) ? scale : 1);
    if (_r) { min = _r.min / f; max = _r.max / f; }
    const cur = (typeof current === "number") ? (current / f) : "";
    const row = H.el("div", { class: "set-row" });
    row.appendChild(H.el("div", { class: "set-label", text: label }));
    if (!editable) {
      row.appendChild(H.el("div", { class: "set-hint", text: (cur === "" ? "—" : String(cur)) }));
      refs.settingsBox.appendChild(row);
      return;
    }
    const input = H.el("input", { type: "number", class: "uq-input", value: String(cur) });
    input.min = String(min); input.max = String(max);
    const setBtn = H.el("button", { class: "pref-add-btn", text: "Set" });
    const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
    const submit = () => {
      const n = Math.round(Number(input.value));
      if (!isFinite(n) || n < min || n > max) {
        err.textContent = "Enter a number between " + min + " and " + max + ".";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      _commitSetting(key, { [key]: n * f });
      _lockSetting(key);
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    row.appendChild(H.el("div", { class: "uq-add", style: "display:flex;gap:6px;" }, [input, setBtn]));
    if (hint) row.appendChild(H.el("div", { class: "set-hint", text: hint }));
    row.appendChild(err);
    refs.settingsBox.appendChild(row);
  }

  // The room background-image control (owner-only). A validated PNG/JPEG link from
  // an approved provider; clients download it into their per-room cache and paint
  // it (see the _bg engine). Non-owners see the current link read-only. Validation
  // uses the SAME provider allowlist as chat images (ChatPrefs), so the hint and
  // the gate agree with what each viewer will actually load.
  function _renderBgSettingRow(s, isOwner, editable) {
    const cur = (s && s.bg) || null;
    const row = H.el("div", { class: "set-row" });
    row.appendChild(H.el("div", { class: "set-label", text: "Background image" }));

    // Non-owner, OR owner while the master lock is on → read-only (show the current link).
    if (!editable) {
      row.appendChild(H.el("div", { class: "set-hint", text: cur ? cur : "None set." }));
      refs.settingsBox.appendChild(row);
      return;
    }

    const input = H.el("input", { type: "text", class: "uq-input",
      placeholder: "https://i.imgur.com/example.png", value: cur || "" });
    const setBtn = H.el("button", { class: "pref-add-btn", text: "Set" });
    const clearBtn = H.el("button", { class: "set-opt", text: "Clear" });
    const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });

    const submit = () => {
      const raw = input.value.trim();
      if (!raw) { err.style.display = "none"; return; }
      const safe = Media.safeBgUrl(raw, ChatPrefs.bgOpts().hostAllowed);
      if (!safe) {
        err.textContent = "Not an approved image link. Use a PNG/JPEG from an approved provider (see ⚙ Settings).";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      _commitSetting("bg", { bg: safe });
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    clearBtn.onclick = () => { input.value = ""; err.style.display = "none"; _commitSetting("bg", { bg: null }); };

    row.appendChild(H.el("div", { class: "uq-add", style: "display:flex;gap:6px;" }, [input, setBtn, clearBtn]));
    if (!ChatPrefs.bgOpts().bgOn) {
      row.appendChild(H.el("div", { class: "set-hint",
        text: "Note: you have backgrounds turned off for yourself (⚙ Settings), so you won't see this even when set." }));
    }
    row.appendChild(err);
    refs.settingsBox.appendChild(row);
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return { renderSettings, renderChatSettings };
})();
