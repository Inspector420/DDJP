// features/media.js
// The single home for ALLOWED EXTERNAL CLIENT-SIDE CONTENT and its policy:
//   - profile avatars  (account-level)
//   - chat GIFs         (.gif from allowlisted hosts)
//   - room backgrounds  (PNG/JPEG from allowlisted hosts)
//
// IMPORTANT — this is NOT a relaxation of "no media over Matrix". That rule
// (CLAUDE.md / 06_fundamentals.md / check-no-media.js) forbids carrying media as
// Matrix PROTOCOL / song data — bytes never cross a homeserver as a ddjp.* event
// or attachment. Everything here is the opposite: a TEXT link travels (in chat,
// or in the ddjp.room.settings `bg` field), and the image is fetched by the
// browser DIRECTLY from the external host — exactly like a YouTube embed. No
// bytes touch Matrix.
//
// The privacy contract this enforces (per the project's stance):
//   user -> user data exposure      = NOT allowed
//   user -> trusted external host   = allowed
// The allowlist below is what makes that hold. Without it, a poster could point a
// link at a host THEY control and harvest every viewer's IP — user-to-user
// exposure laundered through an intermediary. By only ever loading from a fixed
// set of trusted providers (which a poster can't turn into a personal logger),
// the only exposure is viewer -> trusted-provider, which is the allowed category.
//
// Avatars are the account-level exception to "no media over Matrix": they ride
// the Matrix media repo, not the Spine. The actual uploadContent/media-endpoint
// calls MUST live in transport/matrixbridge.js (the only place the SDK is
// touched); this module is the documented OWNER of that exception and the
// pass-through the UI talks to, so ui/ never reaches into transport directly.
//
// Depends on: MatrixBridge

const Media = (() => {

  // --- Allowed external hosts (registrable-domain suffixes) ------------------
  // Background images: static PNG/JPEG.
  const BG_HOSTS  = ["imgur.com", "postimages.org", "postimg.cc"];
  // Chat GIFs: animated .gif (the bg hosts + the two gif services).
  const GIF_HOSTS = ["imgur.com", "postimages.org", "postimg.cc", "tenor.com", "giphy.com"];
  // postimg.cc is included because postimages.org serves its direct image links
  // from the i.postimg.cc CDN; imgur/tenor/giphy direct links live on
  // subdomains (i.imgur.com, media.tenor.com, media.giphy.com), covered by the
  // subdomain match below.
  const BG_EXTS  = [".png", ".jpg", ".jpeg"];
  const GIF_EXTS = [".gif"];

  // host is EXACTLY `suffix` or a real subdomain of it — never a lookalike like
  // "imgur.com.evil.com" or "evilimgur.com".
  function _hostAllowed(host, suffixes) {
    host = (host || "").toLowerCase();
    return suffixes.some(s => host === s || host.endsWith("." + s));
  }
  function _pathHasExt(pathname, exts) {
    const p = (pathname || "").toLowerCase();
    return exts.some(e => p.endsWith(e));
  }

  // Parse + sanitize a candidate URL. Returns the normalized https href if it is
  // a safe image link from an allowed host with an allowed extension, else null.
  // Rejects EVERY non-https scheme (javascript:, data:, http:, ...), embedded
  // credentials, lookalike hosts, and malformed input. Pure; no network. This is
  // the load gate — nothing is ever fetched or rendered unless it passes here.
  //
  // `hosts` may be EITHER a suffix array (the built-in policy, used by the guard
  // and the GIF path) OR a predicate `(hostname) => bool` (the live background
  // path, where the allowlist is the user's editable provider list from
  // ChatPrefs). Either way the host decision is the ONLY thing that varies; the
  // https/credential/extension hardening below is invariant and never delegated.
  function _check(url, hosts, exts) {
    if (typeof url !== "string" || !url) return null;
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== "https:") return null;            // https only -> blocks javascript:/data:/http:
    if (u.username || u.password) return null;           // no credentials in the URL
    const hostOk = (typeof hosts === "function")
      ? !!hosts(u.hostname)                              // live: user provider predicate
      : _hostAllowed(u.hostname, hosts);                 // policy: built-in suffix list
    if (!hostOk) return null;                            // allowlisted host (or subdomain) only
    if (!_pathHasExt(u.pathname, exts)) return null;     // required image extension (query/hash ignored)
    return u.href;                                       // normalized — safe to use as an <img src>
  }

  function isAllowedBgUrl(url)      { return _check(url, BG_HOSTS,  BG_EXTS)  !== null; }
  function isAllowedChatGifUrl(url) { return _check(url, GIF_HOSTS, GIF_EXTS) !== null; }
  // Same checks, but return the normalized safe URL (or null). Callers that will
  // actually fetch/render use these so they render exactly what was validated.
  // safeBgUrl takes an OPTIONAL host predicate: when the UI passes the user's
  // background provider allowlist (ChatPrefs.bgOpts().hostAllowed) it gates on
  // that; with no predicate it falls back to the built-in BG_HOSTS policy (the
  // pure form the content-policy guard exercises).
  function safeBgUrl(url, hostAllowed) {
    return _check(url, (typeof hostAllowed === "function") ? hostAllowed : BG_HOSTS, BG_EXTS);
  }
  function safeChatGifUrl(url) { return _check(url, GIF_HOSTS, GIF_EXTS); }

  // For UI hints ("allowed: imgur, postimages, …"). Copies, not the live arrays.
  function allowedBgHosts()  { return BG_HOSTS.slice(); }
  function allowedGifHosts() { return GIF_HOSTS.slice(); }

  // --- Avatars (account-level allowed external content) ----------------------
  // Pure forwarding to MatrixBridge so ui/ never touches transport directly.
  function getAvatarUrl(userId) { return MatrixBridge.getAvatarUrl ? MatrixBridge.getAvatarUrl(userId) : null; }
  function onAvatarChange(fn)   { if (MatrixBridge.onAvatarChange) MatrixBridge.onAvatarChange(fn); }
  function offAvatarChange(fn)  { if (MatrixBridge.offAvatarChange) MatrixBridge.offAvatarChange(fn); }
  function uploadAvatar(file) {
    if (!MatrixBridge.uploadAvatar) return Promise.resolve({ ok: false, reason: "avatars unavailable" });
    return MatrixBridge.uploadAvatar(file);
  }

  return {
    // content policy / validators
    isAllowedBgUrl, isAllowedChatGifUrl, safeBgUrl, safeChatGifUrl,
    allowedBgHosts, allowedGifHosts,
    // avatars (account-level exception)
    getAvatarUrl, onAvatarChange, offAvatarChange, uploadAvatar
  };
})();
