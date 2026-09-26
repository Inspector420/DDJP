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
    const sec = H.el("div", { class: "pref-section" });
    sec.appendChild(H.el("div", { class: "pref-master-row" }, [H.el("span", { class: "pref-title", text: "Room events in chat" })]));
    sec.appendChild(H.el("div", { class: "pref-note", text: "Which room events appear between chat messages, from when you entered the room. Applies to this device only." }));
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
    const sec = H.el("div", { class: "pref-section" });
    sec.appendChild(H.el("div", { class: "pref-note", text: "Short chimes, made in the browser. Applies to this device only." }));
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

  // ── THE PANEL'S LAYOUT: SECTIONS, ONE ROW SHAPE, ONE NAME (settings rework, owner-approved) ────
  // Every row has the same four parts, in order: its title (from the one name table,
  // `ChatPanels._settingDisplayName`), one plain sentence, the control, and a "More" link for the
  // longer explanation. Rows render into whichever SECTION is being built — `_box()` is that
  // section's body, or the panel itself outside one — so the row helpers never learn where they
  // are. Collapsed sections render nothing at all; the summary on their header is what a person
  // reads instead.
  let _host = null;
  const _box = () => _host || refs.settingsBox;
  const _openSecs = { room: true };   // which sections are open; survives the re-render a toggle causes
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
    ["Away and idle", ["botPresenceSpine", "botPingMs", "botAfkMs", "botPresenceChat", "activityPresence",
                       "queueIdleMs", "botQueueChat", "activityQueue"]],
    ["Backups and history", ["checkpointCooldownMs", "checkpointEvery", "vouchTable", "receiptsPerMessage",
                             "checkpointTable", "checkpointRankOffsetMs", "selfWitnessCheckpoint"]],
  ];

  // A collapsible section (or, with `sub`, a subsection inside one). Its header is a real button
  // carrying the section's title and a one-line summary of its current values.
  function _section(id, title, summary, build, sub) {
    const open = !!_openSecs[id];
    const wrap = H.el("div", { class: sub ? "set-sub" : "set-sec", "data-section": id });
    const head = H.el("button", { class: sub ? "set-sub-head" : "set-sec-head", type: "button" }, [
      H.el("span", { class: "set-sec-text" }, [
        H.el("span", { class: "set-sec-title", text: title }),
        H.el("span", { class: "set-sec-sum", text: summary || "" }),
      ]),
      H.el("span", { class: "set-chev" + (open ? " open" : ""), text: "\u203A" }),
    ]);
    head.setAttribute("aria-expanded", open ? "true" : "false");
    head.onclick = () => { _openSecs[id] = !_openSecs[id]; renderSettings(); };
    wrap.appendChild(head);
    _box().appendChild(wrap);
    if (!open) return;
    const body = H.el("div", { class: sub ? "set-sub-body" : "set-sec-body" });
    wrap.appendChild(body);
    const prev = _host;
    _host = body;
    try { build(); } finally { _host = prev; }
  }

  function _rowHead(row, key, title, desc, readout) {
    row.appendChild(H.el("div", { class: "set-title-line" }, [
      H.el("span", { class: "set-label", text: title }),
      readout ? H.el("span", { class: "set-readout", text: readout }) : null,
    ]));
    if (desc) row.appendChild(H.el("div", { class: "set-desc", text: desc }));
  }

  function _rowMore(row, key, more) {
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
    if (key === "repeatCooldownMs" && v === 0) return "Off";
    const mins = (unit === "sec") ? v / 60 : (unit === "min") ? v : null;
    if (mins === null || mins < 1 || (unit === "min" && mins < 60)) return "";
    if (mins < 60) { const m = Math.floor(v / 60), r = Math.round(v % 60); return m + " min" + (r ? " " + r + " s" : ""); }
    const h = Math.floor(mins / 60), rm = Math.round(mins % 60);
    if (h >= 48 && rm === 0 && h % 24 === 0) return (h / 24) + " days";
    return h + " h" + (rm ? " " + rm + " min" : "");
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
      refs.settingsBox.appendChild(lockBtn);
    }

    // One choice row, in the panel's one row shape. `compact` is the per-group flag row: its label
    // and its two pills on one line, with no sentence of its own — its parent row carries that.
    const optionRow = (key, label, current, options, onPick, desc, more, compact) => {
      const locked = !!_setLocks[key];
      const opts = H.el("div", { class: "set-opts" });
      options.forEach(([val, text]) => {
        const active = val === current;
        const clickable = _editableFor(key) && !active && !locked;
        const b = H.el("button", { class: "set-opt" + (active ? " active" : "") + (compact ? " set-opt-sm" : ""), text: text });
        b.setAttribute("aria-pressed", active ? "true" : "false");
        if (clickable) b.onclick = () => { onPick(val); _lockSetting(key); };
        else b.disabled = true;   // non-owner, current choice, a per-setting lock, OR the master lock → inert
        opts.appendChild(b);
      });
      const row = H.el("div", { class: "set-row" + (compact ? " set-flag" : ""), "data-key": key });
      if (compact) {
        row.appendChild(H.el("span", { class: "set-flag-label", text: label }));
        row.appendChild(opts);
      } else {
        _rowHead(row, key, label, desc);
        row.appendChild(opts);
        _rowMore(row, key, more);
      }
      if (locked) row.appendChild(H.el("div", { class: "set-hint", text: "Updating\u2026" }));
      _box().appendChild(row);
    };
    const onOff = (key, desc, more) => optionRow(key, _name(key), s[key] ? "on" : "off",
      [["on", "On"], ["off", "Off"]], (v) => _commitSetting(key, { [key]: v === "on" }), desc, more);

    // ── NO VISIBLE SETTING THAT DOES NOTHING (the owner's rule for this panel) ────────────────
    // Every setting is reachable WHEREVER IT HAS AN EFFECT, and only there. Two facts decide it,
    // and neither is decided here. The ROOM'S ENGINE declares the settings it never acts on
    // (`Room.idleSettings`, from the engine's own descriptor), so a bot room drops the peer-backup
    // rows. And `BotRuntime.botInRoom` says whether a bot is present, because the bot's settings
    // change nothing without one. `check-settings-rows` PART I runs this panel in each room type.
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
        (v) => _commitSetting("vis", { vis: v }),
        "Invite only rooms need an invite. Open rooms can be joined by anyone who finds them.");
      optionRow("chat", _name("chat"), s.chat,
        [["uncategorized", _rankUp("uncategorized")], ["guest", _rankUp("guest")], ["staff", _rankUp("staff")]],
        (v) => _commitSetting("chat", { chat: v }),
        "Which of the room\u2019s three chats is the main one.");
      _renderBgSettingRow(s, isOwner, _editableFor("bg"));
    });

    const repeatMin = ms2(s.repeatCooldownMs, 60000);
    _section("queue", "DJ queue",
      _rankUp(s.minDjRank) + " can DJ, " + (repeatMin > 0 ? "no repeats for " + dur(repeatMin, "min") : "repeats allowed"), () => {
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
        "Together with Longest song it bounds the length everyone agrees on, so a false length report can\u2019t move a song on early or hold it forever. (CONCEPTS.md \u00a74.2 is where these three song settings are told apart.)");
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
    _section("away", "Away and idle",
      "Away after " + dur(afkMin, "min") + (botHere ? ", queue place held " + dur(idleMin, "min") : ""), () => {
      onOff("botPresenceSpine", "Queueing, voting, saving and similar actions count as activity.",
        "Turn this off to judge activity by chat alone. The lists of which actions count only apply while this is on.");
      if (botHere) {
        _renderNumberSettingRow("botPingMs", _name("botPingMs"), s.botPingMs, 15, 3600, _editableFor("botPingMs"),
          "After the bot asks someone if they\u2019re still there, how long it waits for an answer.", 1000, "sec");
      }
      _section("presence", "Presence", "Away after " + dur(afkMin, "min"), () => {
        _renderNumberSettingRow("botAfkMs", _name("botAfkMs"), s.botAfkMs, 1, 1440, _editableFor("botAfkMs"),
          "After this long without activity, someone no longer counts as active in People, and a bot treats them as away.", 60000, "min",
          "This measures what people do, not whether they\u2019re watching. Someone quietly listening for an hour counts as away.");
        onOff("botPresenceChat", "Sending a chat message counts as activity.",
          "Chat is never stored, so the People list can\u2019t count it itself; with this on, it says its list may leave out people who only chatted. A bot only notices that a message arrived, never what it said.");
        // The per-group lists only mean anything while room actions count at all.
        if (s.botPresenceSpine) {
          _renderFlagMapSetting(optionRow, _name("activityPresence"), "activityPresence", s.activityPresence, _editableFor("activityPresence"),
            "Being listed as present costs the room nothing, so this is usually more generous than the queue list.");
        }
      }, true);
      if (botHere) {
        _section("place", "DJ queue place", "Held for " + dur(idleMin, "min"), () => {
          _renderNumberSettingRow("queueIdleMs", _name("queueIdleMs"), s.queueIdleMs, 1, 1440, _editableFor("queueIdleMs"),
            "How long a queue place is held for someone who has stopped doing anything.", 60000, "min",
            "Keep it shorter than the away time: an idle place holds up everyone behind it. Coming back doesn\u2019t restore the place, but a moderator can put someone back.");
          onOff("botQueueChat", "Sending a chat message keeps your queue place.",
            "Chat is never stored. The bot only notices that a message arrived, never what it said.");
          if (s.botPresenceSpine) {
            _renderFlagMapSetting(optionRow, _name("activityQueue"), "activityQueue", s.activityQueue, _editableFor("activityQueue"),
              "Things your player does on its own, like starting the next song, never count.");
          }
        }, true);
      } else {
        _box().appendChild(H.el("div", { class: "set-notice",
          text: "Holding DJ queue places, and who can ask the bot for changes, appear here when a bot is in the room." }));
      }
    });

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
        _renderDelegationSetting("What others can ask the bot to change", "botDelegation", s.botDelegation, isOwner && !H.settingsLocked(),
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
    // failing OPEN: a missing label is cosmetic, a missing ROW is a setting nobody can reach.
    const NAMES = {
      rotation:   "Joining, leaving or reordering the queue",
      moderation: "Moving, removing or striking someone",
      skip:       "Skipping a song",
      vote:       "Upvoting a song",
      save:       "Saving a song",
      settings:   "Changing room settings",
    };
    const head = H.el("div", { class: "set-row", "data-key": key });
    _rowHead(head, key, label, note);
    _box().appendChild(head);
    for (const g of entry.keys) {
      const on = cur[g] === true;
      optionRow(key + ":" + g, NAMES[g] || g, on ? "on" : "off",
        [["on", "Counts"], ["off", "Doesn't"]],
        (v) => {
          // WHOLE MAP, rebuilt from the domain: the reducer accepts a flag map whole or refuses it
          // whole, and `cur` — not the DOM — supplies the others, so an undrawn row never writes false.
          const next = {};
          for (const k of entry.keys) next[k] = (k === g) ? (v === "on") : (cur[k] === true);
          const patch = {}; patch[key] = next;
          _commitSetting(key, patch);
        }, null, null, true);
    }
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
            // OWNER-ONLY and deliberately NOT `_commitSetting`: the delegable path must never carry
            // the one control that widens delegation. Still through the adapter (J31), whose
            // `room.settings` re-check is owner-gated.
            Actions.perform("room.settings", { partial: { botDelegation: next } })
              .catch((e) => Logger.warn("botDelegation: " + ((e && e.message) || e)));
          };
          row.appendChild(sel);
          wrap.appendChild(row);
        }
      }
    }
    // `_box()` — the section body while one renders. Never `refs.settingsBody`, a name that has
    // never existed and once threw here, silently skipping seven renders downstream.
    _box().appendChild(wrap);
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
    const locked = !!_setLocks.minDjRank;
    const row = H.el("div", { class: "set-row", "data-key": "minDjRank" });
    _rowHead(row, "minDjRank", _name("minDjRank"), "The lowest rank that can join the DJ queue.");
    if (!editable || !values.length) {
      row.appendChild(H.el("div", { class: "set-value", text: cur ? _rankUp(cur) : "\u2014" }));
    } else {
      const opts = H.el("div", { class: "set-opts" });
      for (const name of values) {
        const active = name === cur;
        const b = H.el("button", { class: "set-opt" + (active ? " active" : ""), text: _rankUp(name) });
        b.setAttribute("aria-pressed", active ? "true" : "false");
        if (!active && !locked) b.onclick = () => { _commitSetting("minDjRank", { minDjRank: name }); _lockSetting("minDjRank"); };
        else b.disabled = true;
        opts.appendChild(b);
      }
      row.appendChild(opts);
    }
    _rowMore(row, "minDjRank",
      "Raising it never removes anyone already in the queue. It decides who may join from now on, and "
      + "someone who leaves or drops out is judged by the rule in force when they come back.");
    if (locked) row.appendChild(H.el("div", { class: "set-hint", text: "Updating\u2026" }));
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
      const setBtn = H.el("button", { class: "pref-add-btn", text: "Set" });
      setBtn.onclick = () => {
        const rawVal = String(input.value).trim();
        const n = (rawVal === "") ? null : Math.round(Number(rawVal));
        if (n !== null && (!isFinite(n) || (lim && (n < lim.enoughMin || n > lim.enoughMax)))) {
          err.textContent = lim ? ("Enter " + lim.enoughMin + "-" + lim.enoughMax + ", or leave blank for never.")
                                : "Enter a whole number, or leave blank for never.";
          err.style.display = "block";
          return;
        }
        err.style.display = "none";
        // The complete table is built by Capabilities, not here: the posted shape is the ladder's.
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
      row.appendChild(H.el("div", { class: "set-num" }, controls));
      row.appendChild(err);
      _box().appendChild(row);
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
          return;                                             // never send a list the rules would drop
        }
        _commitSetting(key, { [key]: real }); _lockSetting(key);
      };
      const redraw = () => {
        while (box.firstChild) box.removeChild(box.firstChild);   // no innerHTML in the DOM layer
        draft.forEach((r, i) => {
          const txt = H.el("span", { text: describe(r) });
          const g = H.el("input", { type: "number", class: "uq-input", value: String(r.guestPlus) }); if (lim) { g.min = String(lim.itemMin); g.max = String(lim.itemMax); }
          const v = H.el("input", { type: "number", class: "uq-input", value: String(r.vipPlus) }); if (lim) { v.min = String(lim.itemMin); v.max = String(lim.itemMax); }
          g.setAttribute("aria-label", "Rule " + (i + 1) + ": people from Guest up");
          v.setAttribute("aria-label", "Rule " + (i + 1) + ": people from VIP up");
          g.onchange = () => { r.guestPlus = clamp(g.value); g.value = String(r.guestPlus); txt.textContent = describe(r); };
          v.onchange = () => { r.vipPlus = clamp(v.value); v.value = String(r.vipPlus); txt.textContent = describe(r); };
          const del = H.el("button", { class: "set-opt", text: "Remove" });
          del.setAttribute("aria-label", "Remove rule " + (i + 1));
          del.onclick = () => { draft.splice(i, 1); redraw(); };
          box.appendChild(H.el("div", { class: "set-rule" }, [
            H.el("div", { class: "set-rule-top" }, [txt, del]),
            H.el("div", { class: "set-num" }, [
              H.el("span", { class: "set-unit", text: "Guest and up" }), g,
              H.el("span", { class: "set-unit", text: "VIP and up" }), v]),
          ]));
        });
        const full = draft.length >= most;
        const add = H.el("button", { class: "pref-add-btn", text: "Add a rule" });
        add.disabled = full;
        add.onclick = () => { if (draft.length >= most) return; draft.push({ guestPlus: 0, vipPlus: 0 }); redraw(); };
        const save = H.el("button", { class: "pref-add-btn", text: "Save rules" });
        save.onclick = commit;
        const bar = [add, save];
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
    _rowHead(row, key, label, hint, _fmtDur(cur, unit, key));
    if (!editable) {
      row.appendChild(H.el("div", { class: "set-value", text: (cur === "" ? "\u2014" : String(cur) + (unit ? " " + unit : "")) }));
      _rowMore(row, key, more);
      _box().appendChild(row);
      return;
    }
    const input = H.el("input", { type: "number", class: "uq-input", value: String(cur) });
    input.setAttribute("aria-label", label + (unit ? " (" + unit + ")" : ""));
    input.min = String(min); input.max = String(max);
    const setBtn = H.el("button", { class: "pref-add-btn", text: "Set" });
    const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
    const submit = () => {
      const n = Math.round(Number(input.value));
      if (!isFinite(n) || n < min || n > max) {
        err.textContent = "Enter a number from " + min + " to " + max + ".";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      _commitSetting(key, { [key]: n * f });
      _lockSetting(key);
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    row.appendChild(H.el("div", { class: "set-num" }, [
      input, unit ? H.el("span", { class: "set-unit", text: unit }) : null, setBtn,
      H.el("span", { class: "set-range", text: min + "\u2013" + max }),
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
      if (cur) row.appendChild(H.el("div", { class: "set-value", text: cur }));
      _box().appendChild(row);
      return;
    }
    const input = H.el("input", { type: "text", class: "uq-input",
      placeholder: "Paste an image link", value: cur || "" });
    input.setAttribute("aria-label", "Background image link");
    const setBtn = H.el("button", { class: "pref-add-btn", text: "Set" });
    const clearBtn = H.el("button", { class: "set-opt", text: "Clear" });
    const err = H.el("div", { class: "set-hint", style: "color:#ff6b6b;display:none;" });
    const submit = () => {
      const raw = input.value.trim();
      if (!raw) { err.style.display = "none"; return; }
      const safe = Media.safeBgUrl(raw, ChatPrefs.bgOpts().hostAllowed);
      if (!safe) {
        err.textContent = "That isn't an approved image link. Use a PNG or JPEG from an approved host (see \u2699 Settings).";
        err.style.display = "block";
        return;
      }
      err.style.display = "none";
      _commitSetting("bg", { bg: safe });
    };
    setBtn.onclick = submit;
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    clearBtn.onclick = () => { input.value = ""; err.style.display = "none"; _commitSetting("bg", { bg: null }); };
    row.appendChild(H.el("div", { class: "set-num" }, [input, setBtn, clearBtn]));
    if (!ChatPrefs.bgOpts().bgOn) {
      row.appendChild(H.el("div", { class: "set-desc",
        text: "You have backgrounds turned off for yourself (\u2699 Settings), so you won't see this even when it's set." }));
    }
    row.appendChild(err);
    _box().appendChild(row);
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return { renderSettings, renderChatSettings };
})();
