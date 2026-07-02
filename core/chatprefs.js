// core/chatprefs.js
// Per-user chat DISPLAY preferences (device-local config — NOT chat content).
// Owns, per category (images / links):
//   - a master on/off toggle. BOTH DEFAULT OFF: a fresh user gets plain-text chat
//     with no inline images and no clickable links, so nothing auto-fetches a
//     third-party host (this is the opt-in that closes the image-privacy finding).
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
  function _clampDim(v, range) {
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
    };
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
    _state.bgDim    = _clampDim(_state.bgDim,    DIM_RANGES.bgDim);
    _state.panelDim = _clampDim(_state.panelDim, DIM_RANGES.panelDim);
    return _state;
  }
  function _st() { return _state || load(); }

  function onChange(fn) { if (typeof fn === "function") _listeners.push(fn); }
  function _emit() { for (const fn of _listeners) { try { fn(); } catch (e) {} } }

  // --- queries ---
  function imagesEnabled() { return !!_st().imagesEnabled; }
  function linksEnabled()  { return !!_st().linksEnabled; }
  function bgEnabled()     { return !!_st().bgEnabled; }
  function bgDim()    { return _clampDim(_st().bgDim,    DIM_RANGES.bgDim); }
  function panelDim() { return _clampDim(_st().panelDim, DIM_RANGES.panelDim); }
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
  function setBgDim(v)    { _st().bgDim    = _clampDim(v, DIM_RANGES.bgDim);    _save(); _emit(); }
  function setPanelDim(v) { _st().panelDim = _clampDim(v, DIM_RANGES.panelDim); _save(); _emit(); }
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

  return {
    load, onChange, classifyOpts, bgOpts,
    imagesEnabled, linksEnabled, bgEnabled, imageHosts, linkHosts,
    bgDim, panelDim, setBgDim, setPanelDim,
    setImagesEnabled, setLinksEnabled, setBgEnabled, setDefaultImageHost, setDefaultLinkHost,
    addImageHost, addLinkHost, removeImageHost, removeLinkHost,
    imageDefaults, linkDefaults, imageCustomHosts, linkCustomHosts,
    // pure, exported for the guard:
    effectiveHosts, _normHost,
    DEFAULT_IMAGE_HOSTS, DEFAULT_LINK_HOSTS,
    DIM_RANGES,
  };
})();
