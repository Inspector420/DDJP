// core/chatprefs.js
// Per-user chat DISPLAY preferences (device-local config — NOT chat content).
// Owns, per category (images / links):
//   - a master on/off toggle. ALL DEFAULT ON (see _defaults): a fresh user gets
//     inline images and clickable links. Privacy is held by the HOST ALLOWLIST
//     below, not by the master toggles — only built-in allowed hosts are fetched,
//     so the toggles being on does not mean "fetch anything".
//   - a host allowlist: a set of built-in DEFAULT hosts the user can individually
//     uncheck, PLUS user-added CUSTOM hosts.
// Persisted via Store.prefs (synchronous localStorage tier, namespaced per user).
// It holds ONLY host strings, booleans, and small numeric DISPLAY LEVELS (the
// background/panel dim sliders) — never a message body or image URL from chat —
// so persisting it does not touch the RAM-only chat-content rule.
//
// Display classification itself (URL -> image | link | text) lives in
// ChatBuffer.classify and is PURE; this module only supplies the opts (effective
// allowlists + toggle states) via classifyOpts(). The pure helpers effectiveHosts
// and _normHost are exported for the guard.
//
// Depends on: Store, Logger.

const ChatPrefs = (() => {
  // Built-in defaults. Stored as BASE hosts; a base host also covers its media
  // subdomains (i.giphy.com / media2.giphy.com -> giphy.com), matched in _allowed.
  const DEFAULT_IMAGE_HOSTS = ["giphy.com", "tenor.com", "imgur.com", "postimg.cc"];
  const DEFAULT_LINK_HOSTS  = ["youtube.com", "youtu.be"];

  // Display-level sliders. Stored as a PERCENT 10..100 (UI range); the renderer
  // maps percent/100 -> the rgba alpha on the background scrim and the glass-card
  // background. Defaults match the original hardcoded CSS (scrim 0.55, card 0.75).
  // Display-level sliders. Each is a PERCENT with its OWN range (min/max/default);
  // the renderer maps percent/100 -> the rgba alpha on the background scrim and the
  // glass-card background.
  //   bgDim    0..100, default 0   — 0 = no scrim (background shows at full brightness)
  //   panelDim 65..100, default 75 — cards never drop below 65% opaque, so text stays readable
  const DIM_RANGES = {
    bgDim:    { min: 0,  max: 100, dflt: 0  },
    panelDim: { min: 65, max: 100, dflt: 75 },
  };

  // ── THE ACTIVITY WINDOW (J16) — A DISPLAY PREFERENCE, AND THAT IS THE WHOLE DECISION ────────
  // The people list built from activity needs one number: how recent is recent. J16's Open said
  // "one number, one place, and the same number the bot uses" — and the second half of that is a
  // requirement the BOT brought with it. There was no bot when this was written — there is one as
  // of v322 — and the conclusion is unchanged, which is why the note stays: what J16 needed was
  // never the bot's participation but a decision about WHERE the number lives, and that choice
  // decides this job's Kind rather than merely its wording. The bot now reads the same room
  // settings this refused to duplicate, so the collision it avoided is the one that would exist.
  //
  // IT IS NOT A ROOM SETTING, AND THE COST IS MEASURED RATHER THAN FEARED. A room setting is a new
  // key in `StateDeriver.defaultSettings()`; `seed.settings` is a whole-blob copy and the
  // checkpoint fingerprint commits the seed, so ONE new key moves the fingerprint of every
  // checkpoint in every room. Driven with a control (`tools/probes/probe-j16-active.js` R6/R7):
  // bumping `tick` alone moves the fingerprint, so the instrument reads the seed at all, and
  // adding one settings key moves it too. `Floor.chainVerifies` then refuses every checkpoint
  // sealed earlier, the room holds no floor, and nothing is forgotten until it seals TWO fresh
  // ones — the dead-checkpoint window `README.md` describes and `09-roadmap.md` J45 is filed about.
  // Routing through `dials.js` is not an escape: it reads `defaultSettings()` and its own rule
  // forbids restating a default, so choosing dials is choosing the same gate-shaped path.
  //
  // HERE IT COSTS NOTHING, and the reason is structural rather than a preference for tidiness:
  // this module is referenced by NO backend module, so nothing it holds can reach a seed, a
  // fingerprint or the reducer. That also settles what kind of claim the number makes — nothing
  // derives from it, no two clients have to agree about it, and a room where two people have
  // picked different windows is not in disagreement about anything.
  //
  // WHY THERE IS NO "CORRECT" VALUE, which is the part that makes it a preference at all: once the
  // list is labelled as ACTIVITY rather than presence, both failure directions are honest. Too
  // short drops a present-but-quiet listener; too long keeps someone who has gone. Neither makes
  // the label false, because the label claims only "did something in this span". The default is
  // therefore chosen for READABILITY and stated as such: 15 minutes is longer than the default
  // `maxLen` ceiling of one song (600s), so a listener who says nothing through a whole song still
  // shows, and short enough that the list turns over within a sitting.
  // ── `activityWindowMs` IS GONE (v272) ─────────────────────────────────────────────────────
  // It was a device-local "how far back the People tab counts someone as active". The People panel
  // is the surface showing the basis for a bot REMOVING somebody from a channel, so a local window
  // wider than the room's `botAfkMs` made the panel say a person is present while the bot was
  // about to remove them — a false statement about what is about to happen, not a preference.
  // The window is room truth now. REMOVED IN FULL — the range, the default, the two clamp sites,
  // the accessor and the setter — because a half-removal leaves dead code that still reads
  // plausible, which is this tree's recorded shape.

  // ONE clamp for both ranges (P7). It was `_clampDim` and served one caller; the name is now
  // honest about what it does, because a second caller with nothing to do with dimness is exactly
  // how a name starts misleading (`roles.md` §8). Private — nothing outside this file named it.
  function _clampToRange(v, range) {
    const r = range || { min: 0, max: 100, dflt: 0 };
    v = Math.round(Number(v));
    if (!isFinite(v)) return r.dflt;
    return v < r.min ? r.min : (v > r.max ? r.max : v);
  }

  let _state = null;
  const _listeners = [];

  function _defaults() {
    return {
      imagesEnabled: true,   // default ON (operator choice): inline chat images load from allowlisted hosts
      linksEnabled: true,    // default ON: clickable links to allowlisted hosts
      bgEnabled: true,       // default ON: room backgrounds (shares the image host list)
      bgDim: DIM_RANGES.bgDim.dflt,        // 0..100, default 0 (no scrim)
      panelDim: DIM_RANGES.panelDim.dflt,  // 65..100, default 75
      imageOff: {},      // base host -> true: a DEFAULT image host the user unchecked
      linkOff: {},       // base host -> true: a DEFAULT link host the user unchecked
      imageCustom: [],   // user-added image hosts (base form)
      linkCustom: [],    // user-added link hosts (base form)
      layout: "wide",    // device-local layout choice: "wide" | "compact" | "phone"
      // ── THE BOT'S VIEW — DEVICE-LOCAL, AND OFF BY DEFAULT ────────────────────────────────
      // Whether THIS DEVICE loads the media when it is running as the room's bot. Off means the
      // bot is an owner who cannot see the video: it reads the room, moderates and sweeps exactly
      // as before, but streams nothing. The reason is cost rather than consensus — a bot watching
      // every song all day is a provider bill and a quota nobody is enjoying.
      //
      // NOT A ROOM SETTING, for the reason the activity-window block below gives at length: a new
      // key in `defaultSettings()` moves the checkpoint fingerprint of every room, and `dials.js`
      // is the same gate by another route. It is also genuinely per-DEVICE — the same account can
      // run the bot on a spare machine that should watch and a laptop that should not.
      //
      // OFF IS THE DEFAULT BECAUSE ON IS THE COSTLY DIRECTION. A bot that quietly streams is a
      // bill; a bot that quietly does not is a countdown that waits for the ceiling.
      botView: false,

      dms: [],           // the DM conversation INDEX (J15) — metadata only, see the block below
      chatTier: null,    // J12 — which tier THIS DEVICE is looking at; null = follow the room's
                         // setting. See the block below for why null rather than a tier name.
      tiers: [],         // J12 — per-tier read markers, metadata only, see the block below
    };
  }

  // ── THE DM CONVERSATION INDEX (J15) — METADATA, NEVER CONTENT ──────────────────────────────
  // J15's Open asked whether a DM is RAM-only Skin like the rest of chat or the one place
  // persistence is expected. DECIDED: RAM-only. No DM message body is ever written here, to
  // `Store`, to `EventCache` or to the log, for the same reason room chat is not — DDJP's IDB
  // stores are NOT encrypted at rest (`main/07-security.md`: only the session blob is), so a
  // persisted DM archive would put plaintext on disk that the room chat rule deliberately keeps
  // off it. Element is the archive; recovering old chat is a stated non-goal.
  //
  // WHAT IS PERSISTED IS THE LIST OF CONVERSATIONS, AND THAT IS A REAL PRIVACY DECISION RATHER
  // THAN AN EXEMPTION. Without it the panel is empty after every reload and unusable, so the
  // index holds four fields per row — the DM room id, the other person's user id, the last
  // activity stamp, and a device-local read marker. That is WHO you have talked to and WHEN,
  // surviving a reload while the messages themselves do not. The asymmetry is deliberate and is
  // stated rather than buried: it is the same category as the host allowlist (device-local,
  // per-user, never room- or owner-controlled) and it is revocable the same way — `dmClear()`
  // is wired to a control in the panel.
  //
  // A PREVIEW WOULD BREAK THIS AND IS THE OBVIOUS NEXT FEATURE, so the rule is written where the
  // shape is: no field here may hold anything a person typed. `check-dm-panel` PART E drives a
  // message with a distinctive body through the whole path and asserts that body appears nowhere
  // in what this module writes.
  //
  // BOUNDED, because `Store.prefs` is the localStorage tier and `main/06-storage.md` says that
  // tier must never grow. One row is ~120 bytes and the cap is 50, so the index is a few KB and
  // stays that way; the oldest conversation falls off by last activity. Dropping a row loses no
  // message (there are none to lose) and no Matrix state — `m.direct` still holds the mapping, so
  // the conversation reappears in the list the moment it is used again.
  const DM_CAP = 50;

  // Pure: fold one touch into an index. Exported for the guard, because the cap and the ordering
  // are the two things that decide whether this can grow, and a rule only tests are allowed to
  // reach is a rule with one caller.
  function dmFold(list, row, cap) {
    const max = (typeof cap === "number" && cap > 0) ? cap : DM_CAP;
    const out = [];
    for (const r of (Array.isArray(list) ? list : [])) {
      if (!r || typeof r !== "object" || !r.roomId) continue;
      if (r.roomId === row.roomId) continue;                    // replaced by the touch
      out.push({ roomId: String(r.roomId), userId: String(r.userId || ""),
                 lastTs: Number(r.lastTs) || 0, readTs: Number(r.readTs) || 0 });
    }
    out.push({ roomId: String(row.roomId), userId: String(row.userId || ""),
               lastTs: Number(row.lastTs) || 0, readTs: Number(row.readTs) || 0 });
    out.sort((a, b) => (b.lastTs - a.lastTs) || (a.roomId < b.roomId ? -1 : 1));
    return out.slice(0, max);
  }

  // ── PER-TIER CHAT READ STATE (J12) ─────────────────────────────────────────────────────────
  // The same shape as the DM index above and for the same reasons: a tiny row of SCALARS per
  // tier, capped, ordered, and holding not one word of any message. Chat is RAM-only; what
  // survives a reload here is *which tier you were reading and how far* — never what was said.
  //
  // WHY THIS IS HERE AND NOT IN `defaultSettings()`. A read marker is a fact about one device,
  // not about the room, so a room setting would be wrong on the merits — and it would also be
  // expensive in a way that changes this job's KIND. `seed.settings` is a whole-blob copy the
  // checkpoint fingerprint commits, so ONE new key moves every checkpoint in every room and
  // reopens the dead-checkpoint window (`09-roadmap.md` J45). `dials.js` is not an escape: it
  // reads `defaultSettings()` and forbids restating a default, so routing through it is choosing
  // the gate-shaped path. `ChatPrefs` is referenced by no backend module — asserted structurally
  // by `check-who-is-here` PART G and again by `check-chat-tiers` PART F — so nothing it holds
  // can reach a seed, a fingerprint or the reducer.
  //
  // THE CAP EXISTS EVEN THOUGH THE TIER SET IS SMALL AND FIXED. Three tiers ship today, so a cap
  // of eight looks like decoration — and it is not, because this is the synchronous localStorage
  // tier that `main/06-storage.md` says must never grow, and the list can arrive from a STORE
  // this build did not write: an older build's blob, or a hand-edited `localStorage`. The route
  // is the same one J15's `load()` cap turned out to be the only defence against.
  const TIER_CAP = 8;

  // `chatTier` is NULL by default rather than "uncategorized", and the distinction is the whole
  // of J12's Open. `null` means *follow the room's setting*; a string means *this device has
  // chosen*. If the default were a tier name, this field would be a SECOND definition of which
  // tier the room's chat sits in, free to disagree with `settings.chat` the moment an owner
  // changed it — which is exactly the P7 collision the entry warns about. As a null-able
  // override it is a READER of the setting, and `Room.chatTiers()` is the one place that
  // resolves the pair.
  //
  // `tierTouch` takes SCALARS and not a message object, deliberately and for the same reason
  // `dmTouch` does: a caller cannot hand this a body it forgot to strip, because there is no
  // parameter for one.
  function tierFold(list, row, cap) {
    const max = (typeof cap === "number" && cap > 0) ? cap : TIER_CAP;
    const out = [];
    for (const r of (Array.isArray(list) ? list : [])) {
      if (!r || typeof r !== "object" || !r.tier) continue;
      if (r.tier === row.tier) continue;                       // replaced by the touch
      out.push({ tier: String(r.tier), lastTs: Number(r.lastTs) || 0, readTs: Number(r.readTs) || 0 });
    }
    out.push({ tier: String(row.tier), lastTs: Number(row.lastTs) || 0, readTs: Number(row.readTs) || 0 });
    out.sort((a, b) => (b.lastTs - a.lastTs) || (a.tier < b.tier ? -1 : 1));
    return out.slice(0, max);
  }

  // Normalize a user-typed host (accepts a pasted URL or "www." prefix), reducing
  // it to a bare lowercase base hostname. Returns "" if nothing usable.
  function _normHost(h) {
    h = (h == null ? "" : String(h)).trim().toLowerCase();
    if (!h) return "";
    try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(h)) h = new URL(h).hostname; } catch (e) {}
    h = h.replace(/^www\./, "");
    h = h.replace(/\/.*$/, "").replace(/[:?#].*$/, "");
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)) return "";   // must look like a domain
    return h;
  }

  // Pure: effective allowlist = the defaults the user did NOT switch off, plus the
  // custom hosts. Deduped; order not significant.
  function effectiveHosts(defaults, off, custom) {
    const set = {};
    for (const h of (defaults || [])) if (!(off && off[h])) set[h] = true;
    for (const h of (custom || [])) if (h) set[h] = true;
    return Object.keys(set);
  }

  function _save() { try { Store.prefs.save(_state); } catch (e) { Logger && Logger.warn && Logger.warn("ChatPrefs: save failed"); } }

  function load() {
    let s = null;
    try { s = Store.prefs.load(); } catch (e) {}
    _state = Object.assign(_defaults(), (s && typeof s === "object") ? s : {});
    _state.imageOff = (_state.imageOff && typeof _state.imageOff === "object") ? _state.imageOff : {};
    _state.linkOff  = (_state.linkOff && typeof _state.linkOff === "object") ? _state.linkOff : {};
    _state.imageCustom = Array.isArray(_state.imageCustom) ? _state.imageCustom : [];
    _state.linkCustom  = Array.isArray(_state.linkCustom) ? _state.linkCustom : [];
    _state.bgDim    = _clampToRange(_state.bgDim,    DIM_RANGES.bgDim);
    _state.panelDim = _clampToRange(_state.panelDim, DIM_RANGES.panelDim);
    // The DM index is rebuilt field by field rather than trusted as loaded: this is the one
    // value here that a previous build (or a hand-edited localStorage) could carry extra keys
    // in, and an extra key is exactly how a message body would arrive in a store that promises
    // it holds none. Unknown keys do not survive a load.
    _state.dms = (Array.isArray(_state.dms) ? _state.dms : [])
      .filter((r) => r && typeof r === "object" && r.roomId)
      .map((r) => ({ roomId: String(r.roomId), userId: String(r.userId || ""),
                     lastTs: Number(r.lastTs) || 0, readTs: Number(r.readTs) || 0 }))
      .sort((a, b) => (b.lastTs - a.lastTs) || (a.roomId < b.roomId ? -1 : 1))
      .slice(0, DM_CAP);
    // J12 — the same treatment for the tier markers, and the same reasoning: unknown keys do not
    // survive a load, so a blob carrying a message body cannot smuggle one in through this field.
    _state.tiers = (Array.isArray(_state.tiers) ? _state.tiers : [])
      .filter((r) => r && typeof r === "object" && r.tier)
      .map((r) => ({ tier: String(r.tier), lastTs: Number(r.lastTs) || 0, readTs: Number(r.readTs) || 0 }))
      .sort((a, b) => (b.lastTs - a.lastTs) || (a.tier < b.tier ? -1 : 1))
      .slice(0, TIER_CAP);
    _state.chatTier = (typeof _state.chatTier === "string" && _state.chatTier) ? _state.chatTier : null;
    return _state;
  }
  function _st() { return _state || load(); }

  function onChange(fn) { if (typeof fn === "function") _listeners.push(fn); }
  function _emit() { for (const fn of _listeners) { try { fn(); } catch (e) {} } }

  // --- queries ---
  function imagesEnabled() { return !!_st().imagesEnabled; }
  function linksEnabled()  { return !!_st().linksEnabled; }
  function bgEnabled()     { return !!_st().bgEnabled; }
  function botView()       { return !!_st().botView; }
  function bgDim()    { return _clampToRange(_st().bgDim,    DIM_RANGES.bgDim); }
  function panelDim() { return _clampToRange(_st().panelDim, DIM_RANGES.panelDim); }
  // Clamped on the way OUT as well as on the way in, like the dims: a hand-edited localStorage
  // or an older build's blob reaches `_st()` without passing through the setter, and a window of
  // 0 or NaN would make the activity fold answer "nobody" — a plausible value, which is this
  // codebase's signature failure rather than a visible one.
  function imageHosts() { return effectiveHosts(DEFAULT_IMAGE_HOSTS, _st().imageOff, _st().imageCustom); }
  function linkHosts()  { return effectiveHosts(DEFAULT_LINK_HOSTS,  _st().linkOff,  _st().linkCustom); }

  // A host is allowed if it equals an allowlisted base host OR is a subdomain of
  // one (so a checked "giphy.com" also covers i.giphy.com / media2.giphy.com).
  function _allowed(hosts, host) {
    host = (host == null ? "" : String(host)).toLowerCase().replace(/^www\./, "");
    for (const base of hosts) {
      if (host === base || host.endsWith("." + base)) return true;
    }
    return false;
  }

  // The opts object ChatBuffer.classify consumes. Read once per render from the
  // in-memory state (no storage hit per message).
  function classifyOpts() {
    const imgs = imageHosts(), lnks = linkHosts();
    return {
      imagesOn: imagesEnabled(),
      linksOn: linksEnabled(),
      imageHostAllowed: (h) => _allowed(imgs, h),
      linkHostAllowed:  (h) => _allowed(lnks, h),
    };
  }

  // The opts the background engine consumes. Backgrounds have their OWN master
  // toggle (bgEnabled) but SHARE the image host allowlist — so an approved image
  // provider is also an approved background provider, and removing a host drops it
  // from both at once (the merged-providers design). `hostAllowed` is the same
  // predicate chat images use, fed to Media.safeBgUrl as the host source.
  function bgOpts() {
    const imgs = imageHosts();
    return {
      bgOn: bgEnabled(),
      hostAllowed: (h) => _allowed(imgs, h),
    };
  }

  // --- mutations (the Settings UI calls these; each persists + notifies) ---
  function setImagesEnabled(v) { _st().imagesEnabled = !!v; _save(); _emit(); }
  function setLinksEnabled(v)  { _st().linksEnabled = !!v; _save(); _emit(); }
  function setBgEnabled(v)     { _st().bgEnabled = !!v; _save(); _emit(); }
  function setBotView(v)       { _st().botView = !!v; _save(); _emit(); }
  function setBgDim(v)    { _st().bgDim    = _clampToRange(v, DIM_RANGES.bgDim);    _save(); _emit(); }
  function setPanelDim(v) { _st().panelDim = _clampToRange(v, DIM_RANGES.panelDim); _save(); _emit(); }
  // Layout choice — persisted per user, restored on next login. No _emit: the UI's
  // _setLayout applies it directly; this only remembers it.
  function layout() { const v = _st().layout; return (v === "compact" || v === "phone") ? v : "wide"; }
  function setLayout(v) { _st().layout = (v === "compact" || v === "phone") ? v : "wide"; _save(); }
  function _setOff(offMap, host, on) { if (on) delete offMap[host]; else offMap[host] = true; }
  function setDefaultImageHost(host, on) { _setOff(_st().imageOff, host, on); _save(); _emit(); }
  function setDefaultLinkHost(host, on)  { _setOff(_st().linkOff,  host, on); _save(); _emit(); }
  function _addCustom(arr, defaults, raw) {
    const h = _normHost(raw);
    if (!h) return false;
    if (defaults.indexOf(h) >= 0) return false;   // it's a default — the checkbox handles it
    if (arr.indexOf(h) < 0) arr.push(h);
    return true;
  }
  function addImageHost(host) { const ok = _addCustom(_st().imageCustom, DEFAULT_IMAGE_HOSTS, host); if (ok) { _save(); _emit(); } return ok; }
  function addLinkHost(host)  { const ok = _addCustom(_st().linkCustom,  DEFAULT_LINK_HOSTS,  host); if (ok) { _save(); _emit(); } return ok; }
  function _rm(arr, h) { const i = arr.indexOf(h); if (i >= 0) { arr.splice(i, 1); return true; } return false; }
  function removeImageHost(host) { if (_rm(_st().imageCustom, host)) { _save(); _emit(); } }
  function removeLinkHost(host)  { if (_rm(_st().linkCustom,  host)) { _save(); _emit(); } }

  // --- views for the Settings UI ---
  function imageDefaults() { return DEFAULT_IMAGE_HOSTS.map((h) => ({ host: h, on: !_st().imageOff[h] })); }
  function linkDefaults()  { return DEFAULT_LINK_HOSTS.map((h) => ({ host: h, on: !_st().linkOff[h] })); }
  function imageCustomHosts() { return _st().imageCustom.slice(); }
  function linkCustomHosts()  { return _st().linkCustom.slice(); }

  // --- the DM conversation index (J15) ---
  // `dmTouch` takes four scalars and NOT a message object, deliberately: a caller cannot hand
  // this a body it forgot to strip, because there is no parameter for one.
  function dmList() { return _st().dms.map((r) => ({ roomId: r.roomId, userId: r.userId, lastTs: r.lastTs, readTs: r.readTs })); }
  function dmTouch(roomId, userId, lastTs) {
    if (!roomId) return dmList();
    const s = _st();
    const prev = s.dms.find((r) => r.roomId === roomId);
    const ts = Number(lastTs) || 0;
    s.dms = dmFold(s.dms, {
      roomId: roomId,
      userId: userId || (prev && prev.userId) || "",
      lastTs: Math.max(ts, (prev && prev.lastTs) || 0),
      readTs: (prev && prev.readTs) || 0,
    });
    _save(); _emit();
    return dmList();
  }
  function dmMarkRead(roomId, ts) {
    const s = _st();
    const row = s.dms.find((r) => r.roomId === roomId);
    if (!row) return dmList();
    // A read marker only ever moves FORWARD. A late-decrypting message can arrive with an older
    // stamp than one already rendered (backfill decrypts newest-first — `04-features.md`), and a
    // marker that followed it backwards would re-raise a notification the person already read.
    row.readTs = Math.max(row.readTs, Number(ts) || 0, row.lastTs);
    _save(); _emit();
    return dmList();
  }
  function dmUnread(roomId) {
    const row = _st().dms.find((r) => r.roomId === roomId);
    return !!(row && row.lastTs > row.readTs);
  }
  function dmUnreadCount() { return _st().dms.filter((r) => r.lastTs > r.readTs).length; }
  function dmClear() { _st().dms = []; _save(); _emit(); }

  // --- per-tier chat views and read markers (J12) ---
  function tierList() { return _st().tiers.map((r) => ({ tier: r.tier, lastTs: r.lastTs, readTs: r.readTs })); }
  function tierTouch(tier, lastTs) {
    if (!tier) return tierList();
    const s = _st();
    const prev = s.tiers.find((r) => r.tier === tier);
    const ts = Number(lastTs) || 0;
    s.tiers = tierFold(s.tiers, {
      tier: tier,
      lastTs: Math.max(ts, (prev && prev.lastTs) || 0),
      readTs: (prev && prev.readTs) || 0,
    });
    _save(); _emit();
    return tierList();
  }
  function tierMarkRead(tier, ts) {
    const s = _st();
    const row = s.tiers.find((r) => r.tier === tier);
    if (!row) return tierList();
    // FORWARD ONLY, exactly as `dmMarkRead` is and for the identical reason: backfill decrypts
    // newest-first, so a late message can arrive with an older stamp than one already rendered,
    // and a marker that followed it backwards would re-raise a badge the person just cleared.
    row.readTs = Math.max(row.readTs, Number(ts) || 0, row.lastTs);
    _save(); _emit();
    return tierList();
  }
  // A TIER WITH NO TRAFFIC IS NOT UNREAD, AND NEITHER IS ONE YOU HAVE NEVER OPENED. Both answer
  // false here, and they answer it for different reasons that happen to agree: a tier with no
  // traffic has no row at all (nothing has ever touched it), and a tier you have never opened has
  // a row whose `lastTs` is whatever arrived and whose `readTs` is 0 — so it IS unread, which is
  // correct, because there is something there you have not seen. The case that must not raise a
  // badge is the EMPTY one, and it does not, because a badge on a silent tier is an invitation to
  // open a room's staff channel and find nothing in it.
  function tierUnread(tier) {
    const row = _st().tiers.find((r) => r.tier === tier);
    return !!(row && row.lastTs > row.readTs);
  }
  function tierUnreadCount() { return _st().tiers.filter((r) => r.lastTs > r.readTs).length; }
  function tierClear() { _st().tiers = []; _save(); _emit(); }
  // null = follow the room's setting. See the block above for why the default is not a tier name.
  function chatTier() { const v = _st().chatTier; return (typeof v === "string" && v) ? v : null; }
  function setChatTier(t) { _st().chatTier = (typeof t === "string" && t) ? t : null; _save(); _emit(); }

  return {
    load, onChange, classifyOpts, bgOpts,
    dmList, dmTouch, dmMarkRead, dmUnread, dmUnreadCount, dmClear, dmFold, DM_CAP,
    tierList, tierTouch, tierMarkRead, tierUnread, tierUnreadCount, tierClear, tierFold, TIER_CAP,
    chatTier, setChatTier,
    imagesEnabled, linksEnabled, bgEnabled, imageHosts, linkHosts,
    botView, setBotView,
    bgDim, panelDim, setBgDim, setPanelDim,
    layout, setLayout,
    setImagesEnabled, setLinksEnabled, setBgEnabled, setDefaultImageHost, setDefaultLinkHost,
    addImageHost, addLinkHost, removeImageHost, removeLinkHost,
    imageDefaults, linkDefaults, imageCustomHosts, linkCustomHosts,
    // pure, exported for the guard:
    effectiveHosts, _normHost,
    DEFAULT_IMAGE_HOSTS, DEFAULT_LINK_HOSTS,
    DIM_RANGES,
  };
})();
