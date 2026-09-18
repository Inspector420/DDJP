// backends/backend1/matrixaccount.js
// App plumbing. Everything that serves NEITHER pillar: login and SSO, session
// persistence and at-rest encryption, account switching, DM scope, avatars and
// recovery keys. PILLARS.md §7 row 4 is the axis and it is not a reading of what
// gets edited — that property moves, and a boundary drawn on a moving property drifts.
//
// Split out of matrixbridge.js at J59. Depends DOWNWARD on MatrixBridge through named
// accessors and never sits beside it as a peer:
//
//   * `client` IS OWNED BY matrixbridge.js. This file creates it in three flows and
//     hands it over with `_setC`; every read goes through `_c()`. It holds no copy.
//     Two halves that can each believe they hold the live client is a disagreement
//     with NO SYMPTOM until a room does the wrong thing, and it is the exact defect
//     this split exists to avoid — so there is no `let client` in this file, on purpose.
//   * The three places the transport needs something from here are NOT calls up. They
//     are slots on `B1MatrixBridge._setAccountHost`, filled at the bottom of this IIFE.
//     Nothing in matrixbridge.js names this module.
//
// `check-wiring.js` asserts the host is filled and every slot present, because a
// correct module reached by nothing is this tree's characteristic defect and a unit
// suite cannot see it.

const B1MatrixAccount = (() => {
  // The two named accessors, and the whole of this file's upward surface.
  const _c = () => B1MatrixBridge.getClient();
  const _setC = (c) => B1MatrixBridge._setClient(c);

  let _loginInProgress = false;
  // --- Encryption setup state (Topic 2) ---
  let _ssKey = null;          // decoded secret-storage private key currently in use
  let _loginPassword = null;  // held briefly to satisfy UIA on cross-signing key upload
  let _pendingNewKey = null;  // a generated recovery key awaiting save-confirmation
  // --- Session persistence (multi-account) ---
  // Each Matrix user's session (access/refresh token, device id) is stored under
  // its OWN key so logging in as a second user never clobbers the first, and a
  // re-login always re-links to the same namespaced storage. An account REGISTRY
  // (the known users + which is active) sits alongside. Without persistence every
  // login would create a new device and hit matrix.org's device limit, so the
  // device id is part of what we keep.
  const ACCOUNTS_KEY = "ddjp_accounts";             // [{ userId, homeserver, deviceId }] — known accounts
  const ACTIVE_KEY = "ddjp_active";                 // userId of the active account
  function _sessionKeyFor(userId) { return "ddjp_session__" + userId; }

  // Pure registry transforms (guarded headlessly). Most-recently-active first.
  function _registryUpsert(list, acct) {
    const rest = (list || []).filter((a) => a && a.userId !== acct.userId);
    return [{ userId: acct.userId, homeserver: acct.homeserver, deviceId: acct.deviceId }].concat(rest);
  }
  function _registryRemove(list, userId) {
    return (list || []).filter((a) => a && a.userId !== userId);
  }

  // Registry + active-pointer I/O (raw localStorage; auth lives in transport).
  function _loadAccounts() { try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || "[]") || []; } catch (e) { return []; } }
  function _saveAccounts(list) { try { localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list || [])); } catch (e) {} }
  function _getActive() { try { return localStorage.getItem(ACTIVE_KEY) || null; } catch (e) { return null; } }
  function _setActive(userId) { try { if (userId) localStorage.setItem(ACTIVE_KEY, userId); else localStorage.removeItem(ACTIVE_KEY); } catch (e) {} }

  // --- At-rest session encryption (Topic 5a, part 2) ---
  // The session blob (access + refresh token) is encrypted with a NON-EXTRACTABLE
  // AES-GCM key kept in IndexedDB, so an info-stealer that scrapes localStorage gets
  // only ciphertext plus a key it cannot export — it can't decrypt the token off the
  // user's machine (the pattern Element uses). Requires a secure context
  // (crypto.subtle); on plain-HTTP localhost it transparently falls back to the old
  // plaintext storage so local dev still works. Production (HTTPS) gets the protection.
  const _SK_DB = "ddjp-keys", _SK_STORE = "keys", _SK_ID = "session-key";
  let _sessKeyPromise = null;

  function _cryptoOk() {
    try { return !!(window.isSecureContext && window.crypto && window.crypto.subtle); }
    catch (e) { return false; }
  }
  function _skDb() {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(_SK_DB, 1); } catch (e) { return reject(e); }
      req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(_SK_STORE)) db.createObjectStore(_SK_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function _skReq(mode, fn) {
    return _skDb().then((db) => new Promise((res, rej) => {
      const r = fn(db.transaction(_SK_STORE, mode).objectStore(_SK_STORE));
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    }));
  }
  // The non-extractable key: fetched once, generated + persisted if absent. If it
  // can't be persisted we throw, so the caller falls back to plaintext rather than
  // writing ciphertext we could never decrypt again.
  function _sessionKey() {
    if (_sessKeyPromise) return _sessKeyPromise;
    _sessKeyPromise = (async () => {
      let k = null;
      try { k = await _skReq("readonly", (os) => os.get(_SK_ID)); } catch (e) {}
      if (k) return k;
      k = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await _skReq("readwrite", (os) => os.put(k, _SK_ID));   // throws → plaintext fallback
      return k;
    })();
    return _sessKeyPromise;
  }
  const _b64 = (u8) => { let s = ""; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
  const _ub64 = (s) => { const bin = atob(s); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  async function _encryptSession(obj) {
    const key = await _sessionKey();
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const ct = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
    return JSON.stringify({ v: 1, iv: _b64(iv), ct: _b64(new Uint8Array(ct)) });
  }
  async function _decryptSession(blob) {
    const env = JSON.parse(blob);
    const key = await _sessionKey();
    const pt = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: _ub64(env.iv) }, key, _ub64(env.ct));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // --- At-rest crypto-store protection (Phase 2) --------------------------
  // Per-user crypto database name, so each account's Rust-crypto store is its own
  // IndexedDB (isolation + the not-thread-safe constraint + clean forget).
  function _cryptoDbPrefix(userId) { return "matrix-js-sdk:" + userId; }

  // The 32-byte PICKLE KEY that encrypts a user's crypto store at rest (the SDK's
  // initRustCrypto `storageKey`). Element's pattern: a random key, itself wrapped
  // by the device-local NON-EXTRACTABLE AES key, stored as ciphertext in the
  // `ddjp-keys` IndexedDB. Generated once per user and reused (the SDK requires
  // the SAME key on every init for a device). Returns undefined on an insecure
  // context (then the store is unencrypted — same graceful fallback as the
  // session blob), so the app still runs on plain-HTTP localhost.
  async function _pickleKey(userId) {
    if (!_cryptoOk() || !userId) return undefined;
    const id = "pickle-" + userId;
    try {
      const existing = await _skReq("readonly", (os) => os.get(id));
      if (existing && existing.iv && existing.ct) {
        const key = await _sessionKey();
        const pt = await window.crypto.subtle.decrypt({ name: "AES-GCM", iv: _ub64(existing.iv) }, key, _ub64(existing.ct));
        return new Uint8Array(pt);
      }
    } catch (e) { Logger.warn("MatrixBridge: pickle key read failed — " + (e && e.message)); }
    // None stored yet: mint 32 random bytes, wrap them, persist the ciphertext.
    const raw = window.crypto.getRandomValues(new Uint8Array(32));
    try {
      const key = await _sessionKey();
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const ct = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, raw);
      await _skReq("readwrite", (os) => os.put({ iv: _b64(iv), ct: _b64(new Uint8Array(ct)) }, id));
    } catch (e) {
      Logger.warn("MatrixBridge: pickle key persist failed — crypto store will be unencrypted: " + (e && e.message));
      return undefined;
    }
    return raw;
  }

  // Write one account's session under its own key (encrypted at rest when the
  // platform allows, plaintext fallback on insecure localhost), then register it
  // and mark it active. The write helper is shared by save + per-account reads.
  async function _writeSessionBlob(userId, obj) {
    if (_cryptoOk()) {
      try { localStorage.setItem(_sessionKeyFor(userId), await _encryptSession(obj)); return; }
      catch (e) { Logger.warn("MatrixBridge: session encryption failed, storing plaintext — " + e.message); }
    }
    try { localStorage.setItem(_sessionKeyFor(userId), JSON.stringify(obj)); }
    catch (e) { Logger.warn("MatrixBridge: failed to save session"); }
  }

  async function _saveSession(homeserver, userId, accessToken, deviceId, refreshToken, expiry) {
    const obj = { homeserver, userId, accessToken, deviceId, refreshToken, expiry };
    await _writeSessionBlob(userId, obj);
    _saveAccounts(_registryUpsert(_loadAccounts(), { userId, homeserver, deviceId }));
    _setActive(userId);
  }

  // Decrypt one stored blob (handles the encrypted envelope + the plaintext
  // fallback, migrating plaintext up to encrypted in place when we now can).
  async function _readSessionBlob(storageKey) {
    let raw;
    try { raw = localStorage.getItem(storageKey); } catch (e) { return null; }
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return null; }
    if (parsed && parsed.v === 1 && parsed.iv && parsed.ct) {
      try { return await _decryptSession(raw); }
      catch (e) { Logger.warn("MatrixBridge: session decrypt failed — " + e.message); return null; }
    }
    if (parsed && parsed.accessToken) {
      if (_cryptoOk()) {
        try { localStorage.setItem(storageKey, await _encryptSession(parsed)); Logger.info("MatrixBridge: migrated session to encrypted storage"); }
        catch (e) {}
      }
      return parsed;
    }
    return null;
  }

  async function _loadSession() {
    const active = _getActive();
    if (!active) return null;
    const obj = await _readSessionBlob(_sessionKeyFor(active));
    if (obj && !obj.userId) obj.userId = active;
    return obj;
  }

  // Sign out the ACTIVE account: invalidate + drop its (now-useless) session blob
  // and clear the active pointer, but KEEP its registry entry and its namespaced
  // local data so re-login re-links. (Wholesale removal is forgetAccount.)
  function _clearSession() {
    const active = _getActive();
    if (active) { try { localStorage.removeItem(_sessionKeyFor(active)); } catch (e) {} }
    _setActive(null);
  }

  // Called by the SDK when the access token has expired (reactive refresh). Exchanges
  // the refresh token for a fresh access+refresh pair — Synapse/MAS rotate and
  // invalidate the old refresh token — persists them, and returns them so the
  // in-flight request retries. A stolen access token is then only valid until it
  // expires (≈5 min on Synapse/MAS). Result shape required by the SDK:
  // { accessToken, refreshToken, expiry }. Only invoked when a refresh token exists,
  // so homeservers without refresh-token support fall back to the long-lived token.
  async function _tokenRefreshFunction(refreshToken) {
    if (!_c()) throw new Error("MatrixBridge: no active client to refresh token");
    const r = await _c().refreshToken(refreshToken);
    const expiryMs = r.expires_in_ms ? Date.now() + r.expires_in_ms : undefined;
    const s = await _loadSession();
    if (s) await _saveSession(s.homeserver, s.userId, r.access_token, s.deviceId, r.refresh_token || refreshToken, expiryMs);
    Logger.info("MatrixBridge: access token refreshed");
    // The SDK stores this expiry and later calls .getTime() on it, so it MUST be a
    // Date — returning a number throws "getTime is not a function" and breaks refresh.
    return { accessToken: r.access_token, refreshToken: r.refresh_token || refreshToken, expiry: expiryMs ? new Date(expiryMs) : undefined };
  }

  // Refresh the access token *proactively* when we hold a refresh token and the
  // stored access token is at/near expiry. Needed because crypto init (initRustCrypto)
  // makes authenticated requests BEFORE startClient()'s reactive refresh loop is
  // active: if the token expired while the tab was closed, crypto init would 401 and
  // throw, leaving the client with no encryption. Non-fatal: on failure we fall back
  // to the stored token. `force` skips the expiry check (used for the init retry).
  async function _ensureFreshToken(force) {
    const s = await _loadSession();
    if (!s || !s.refreshToken) return;
    if (!force && s.expiry && Date.now() < s.expiry - 60000) return;   // still comfortably valid
    try {
      const r = await _c().refreshToken(s.refreshToken);
      if (r && r.access_token) {
        _c().setAccessToken(r.access_token);
        if (_c().http && _c().http.opts) _c().http.opts.refreshToken = r.refresh_token || s.refreshToken;
        const expiry = r.expires_in_ms ? Date.now() + r.expires_in_ms : undefined;
        await _saveSession(s.homeserver, s.userId, r.access_token, s.deviceId, r.refresh_token || s.refreshToken, expiry);
        Logger.info("MatrixBridge: token refreshed before crypto init");
      }
    } catch (e) {
      Logger.warn("MatrixBridge: pre-crypto token refresh failed — " + e.message);
    }
  }

  async function hasSession() {
    return (await _loadSession()) !== null;
  }

  async function restoreSession() {
    const session = await _loadSession();
    if (!session) return false;
    try {
      const _newClient = matrixcs.createClient({
        baseUrl: session.homeserver,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: session.userId,
        deviceId: session.deviceId,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
      _setC(_newClient);
      Logger.info("MatrixBridge: restored session as " + session.userId);
      return session;
    } catch (e) {
      Logger.warn("MatrixBridge: session restore failed — " + e.message);
      _clearSession();
      return false;
    }
  }

  // --- Login ---
  async function login(homeserver, username, password) {
    if (_loginInProgress) throw new Error("MatrixBridge: login already in progress");
    _loginInProgress = true;
    try {
      const temp = matrixcs.createClient({ baseUrl: homeserver });
      const response = await temp.login("m.login.password", { user: username, password, refresh_token: true });
      temp.stopClient();
      _loginPassword = password;   // held to satisfy UIA on cross-signing key upload; cleared on logout
      const _newClient = matrixcs.createClient({
        baseUrl: homeserver,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: response.user_id,
        deviceId: response.device_id,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
      _setC(_newClient);
      await _saveSession(homeserver, response.user_id, response.access_token, response.device_id,
                   response.refresh_token, response.expires_in_ms ? Date.now() + response.expires_in_ms : undefined);
      Logger.info("MatrixBridge: logged in as " + response.user_id);
      return response;
    } finally {
      _loginInProgress = false;
    }
  }

  // --- SSO / redirect login (Topic 5b) ---
  // Anti-phishing: rather than typing a password into DDJP, the user is redirected
  // to the homeserver's own login page (which may itself federate to an external
  // identity provider), authenticates THERE, and is redirected back to DDJP with a
  // one-time login token we exchange for a session — DDJP never sees the password.
  // Works on homeservers that advertise the `m.login.sso` flow; full OIDC dynamic
  // client registration is still deferred (see the project SECURITY policy doc).
  const SSO_PENDING_KEY = "ddjp_sso_pending";

  // The app's own URL, no query/hash — where the homeserver sends the user back.
  function _appRedirectUrl() {
    return window.location.origin + window.location.pathname;
  }

  // Ask the homeserver which login flows it supports, so the UI can show the right
  // controls (password, an SSO button, or both). Returns an SDK-free summary.
  async function getLoginFlows(homeserver) {
    const temp = matrixcs.createClient({ baseUrl: homeserver });
    let flows = [];
    try {
      const r = await temp.loginFlows();
      flows = (r && r.flows) || [];
    } finally {
      if (temp.stopClient) temp.stopClient();
    }
    const sso = flows.find((f) => f && f.type === "m.login.sso");
    return {
      password: flows.some((f) => f && f.type === "m.login.password"),
      sso: !!sso,
      idps: (sso && sso.identity_providers) || [],
    };
  }

  // Begin SSO: remember the homeserver, then navigate the whole tab to the HS's SSO
  // endpoint. Control leaves the app here; completion happens on the redirect back.
  async function startSsoLogin(homeserver, idpId) {
    const temp = matrixcs.createClient({ baseUrl: homeserver });
    const url = temp.getSsoLoginUrl(_appRedirectUrl(), "sso", idpId);
    if (temp.stopClient) temp.stopClient();
    try { localStorage.setItem(SSO_PENDING_KEY, JSON.stringify({ homeserver })); } catch (e) {}
    window.location.assign(url);
  }

  function _pendingSsoToken() {
    try { return new URLSearchParams(window.location.search).get("loginToken") || null; }
    catch (e) { return null; }
  }

  // True when this page load is the redirect back from the HS (loginToken present).
  // app.js checks this before restoreSession() during bootstrap.
  function hasPendingSsoLogin() {
    return _pendingSsoToken() !== null;
  }

  // Strip ?loginToken=… from the address bar without reloading, so it isn't left in
  // history or replayed. Any other query params are preserved.
  function _cleanSsoUrl() {
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("loginToken");
      window.history.replaceState({}, document.title, u.pathname + u.search + u.hash);
    } catch (e) {}
  }

  // Exchange the one-time login token for a real session. Requests refresh tokens so
  // SSO logins get the same short-lived-token hardening as password logins (Topic
  // 5a). No password is available, so _loginPassword stays null — the recovery-key
  // unlock path needs none; only a destructive reset would (surfaced clearly by
  // _authUploadDeviceSigningKeys).
  async function completeSsoLogin() {
    const token = _pendingSsoToken();
    if (!token) return false;
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(SSO_PENDING_KEY) || "null"); } catch (e) {}
    const homeserver = pending && pending.homeserver;
    if (!homeserver) {
      _cleanSsoUrl();
      throw new Error("Could not complete SSO login (no pending homeserver). Please log in again.");
    }
    if (_loginInProgress) throw new Error("MatrixBridge: login already in progress");
    _loginInProgress = true;
    try {
      const temp = matrixcs.createClient({ baseUrl: homeserver });
      const response = await temp.login("m.login.token", { token, refresh_token: true });
      if (temp.stopClient) temp.stopClient();
      const _newClient = matrixcs.createClient({
        baseUrl: homeserver,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: response.user_id,
        deviceId: response.device_id,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
      _setC(_newClient);
      await _saveSession(homeserver, response.user_id, response.access_token, response.device_id,
                   response.refresh_token, response.expires_in_ms ? Date.now() + response.expires_in_ms : undefined);
      Logger.info("MatrixBridge: logged in via SSO as " + response.user_id);
      return response;
    } finally {
      _loginInProgress = false;
      try { localStorage.removeItem(SSO_PENDING_KEY); } catch (e) {}
      _cleanSsoUrl();
    }
  }

  async function logout() {
    try {
      if (_c()) await _c().logout();
    } catch (e) {}
    _clearSession();
    try { localStorage.removeItem(SSO_PENDING_KEY); } catch (e) {}
    // The DM scope survives a ROOM change (a conversation is with a person, not inside a room)
    // and must not survive an ACCOUNT change, which is where the person stops being us.
    clearDMScope();
    _setC(null);
    _ssKey = null;
    _loginPassword = null;
    _pendingNewKey = null;
    Logger.info("MatrixBridge: logged out");
  }
  // ── THE DM SCOPE (J15) — A SECOND SCOPE, DELIBERATELY NOT A SECOND ENTRY IN THE FIRST ──────
  // A DM is a separate Matrix room and it is Skin: it must reach the raw listeners and NOTHING
  // else. Adding DM room ids to `_activeScope` would have been one line and exactly wrong — that
  // scope is what the ingest door, `_heldHere` and the vouch bundler all read, so a DM would have
  // become a candidate original, an eviction subject and a fold input in one move. Two scopes
  // because they answer two questions: `inScope` asks *is this the room I am in*, `inDMScope`
  // asks *is this a conversation I am holding open*. Nothing reads both.
  //
  // INDEPENDENT OF THE ROOM, AND THAT IS THE POINT. A DM is with a PERSON, not inside a room, so
  // walking between rooms neither binds nor unbinds one — `clearRoomScope` leaves this alone. It
  // is cleared on logout and on an account switch, where the person changes, and `setDMScope`
  // REPLACES for the same reason its sibling does.
  let _dmScope = null;

  function setDMScope(ids) {
    const s = Object.create(null);
    let n = 0;
    if (ids) {
      for (const id of ids) {
        if (id && typeof id === "string" && !s[id]) { s[id] = 1; n++; }
      }
    }
    _dmScope = n ? s : null;   // REPLACES, never merges
    return n;
  }
  function addDMScope(roomId) {
    if (!roomId || typeof roomId !== "string") return false;
    if (!_dmScope) _dmScope = Object.create(null);
    if (_dmScope[roomId]) return false;
    _dmScope[roomId] = 1;
    return true;
  }
  function clearDMScope() { _dmScope = null; }
  function inDMScope(roomId) {
    return !!(_dmScope && roomId && _dmScope[roomId]);
  }

  // ── DM TRANSPORT ──────────────────────────────────────────────────────────────────────────
  // Find-or-create the one-to-one room for a user, and remember it in `m.direct` so the same
  // conversation is found next time and by any other Matrix client. `m.direct` is Matrix's own
  // account data, which means the mapping is the HOMESERVER's rather than a second copy DDJP
  // maintains — one rule, one place, and the same list Element reads.
  //
  // The room is created encrypted, invite-only and one-to-one. Chat is E2E unconditionally
  // (`07-security.md`), and a DM is the case where that matters most, so the encryption state is
  // set at creation via `initial_state` for the same reason every other channel's config is:
  // a room can never exist half-configured.
  function _directMap() {
    try {
      const ev = _c() && _c().getAccountData && _c().getAccountData("m.direct");
      const c = ev && ev.getContent ? ev.getContent() : null;
      return (c && typeof c === "object") ? c : {};
    } catch (e) { return {}; }
  }

  // Every DM room id this account knows about, from Matrix's own mapping.
  function dmRoomIds() {
    const map = _directMap();
    const out = [];
    for (const user in map) {
      const list = map[user];
      if (!Array.isArray(list)) continue;
      for (const id of list) if (id && out.indexOf(id) < 0) out.push(id);
    }
    return out;
  }

  // ── ROOMS SOMEBODY ELSE INVITED US TO (DM gap 1) ──────────────────────────────────────────
  // `dmRoomIds()` walks `m.direct`, which is account data THIS account writes when IT starts a
  // conversation. A room somebody else invited us to is not in that map — so it never reaches
  // `setDMScope`, so `_handleDMRaw`'s `inDMScope` filter drops every message in it, so **a
  // stranger's first DM arrives nowhere at all.** Driven: nothing in this file read invited rooms;
  // the data was in the SDK and nothing asked for it.
  //
  // THESE ARE REPORTED AS PENDING, NEVER BOUND. Auto-binding would let anyone put a room into this
  // account's DM scope by inviting it, and DM scope is the ONLY thing `_handleDMRaw` filters on —
  // an invite would become a channel a stranger controls the membership of. Accepting is a
  // decision a person makes; this only reports that there is one to make.
  //
  // A DM invite is recognised the way Matrix marks one — `is_direct` on our own member event —
  // with a two-member fallback for servers that do not stamp it. Anything else invited to us is
  // not offered here as a conversation.
  function dmInviteRoomIds() {
    if (!_c()) return [];
    const me = B1MatrixBridge.getUserId();
    const out = [];
    let rooms = [];
    try { rooms = _c().getRooms() || []; } catch (e) { return []; }
    for (const room of rooms) {
      if (!room || !room.roomId) continue;
      let membership = null;
      try { membership = room.getMyMembership ? room.getMyMembership() : null; } catch (e) { membership = null; }
      if (membership !== "invite") continue;
      let direct = false, inviter = null;
      try {
        const mine = room.currentState.getStateEvents("m.room.member", me);
        const c = mine && mine.getContent ? mine.getContent() : null;
        direct = !!(c && c.is_direct);
        inviter = (mine && mine.getSender) ? mine.getSender() : null;
      } catch (e) { direct = false; }
      if (!direct) {
        let n = 0;
        try { n = (room.getJoinedMemberCount ? room.getJoinedMemberCount() : 0) + 1; } catch (e) { n = 0; }
        if (n !== 2) continue;
      }
      out.push({ roomId: room.roomId, from: inviter || null });
    }
    return out;
  }

  // Accepting is the ONLY thing that binds, and it binds through the same `setDMScope` every other
  // conversation goes through — there is no second path into the DM filter.
  // ── ACCEPTING MUST RECORD THE CONVERSATION THE WAY STARTING ONE DOES ──────────────────────
  // This was `joinRoom` and nothing else, and the consequence was not a display bug. `findDMRoom`
  // reads `_directMap()[userId]` and `dmRoomIds()` walks the same map — which THIS account writes.
  // So an accepted invite was joined and INVISIBLE: `findDMRoom` answered null, the caller
  // concluded no conversation existed, and created a new room. **Every attempt made another one**,
  // and each is a real joined room. The panel not opening is the symptom people notice; the
  // accumulation is the serious half and it is permanent.
  //
  // `_rememberDirect` is REUSED rather than re-implemented — the eighth copied-rule opportunity in
  // this tree and the cheapest one to decline. It APPENDS and de-duplicates, which is the right
  // behaviour here: a person may legitimately have more than one room with somebody (an older
  // conversation they were invited to, and one they started), and replacing the list would hide a
  // room this account is still joined to rather than resolving anything.
  //
  // THE INVITER'S ID COMES FROM THE ROOM, not from the caller: `dmInviteRoomIds()` already reads
  // it off our own member event, and asking the caller to pass it would be a second source that
  // can disagree with the invite we are accepting.
  async function acceptDMInvite(roomId) {
    if (!_c() || !roomId) throw new Error("acceptDMInvite: no room");
    await _c().joinRoom(roomId);
    // Read AFTER joining: before the join the room may not be in the store at all, and a null
    // here would silently skip the record and reproduce the defect for a subset of invites.
    let from = null;
    try {
      const inv = (dmInviteRoomIds() || []).find((i) => i.roomId === roomId);
      from = inv ? inv.from : null;
      if (!from) {
        const room = _c().getRoom(roomId);
        const me = B1MatrixBridge.getUserId();
        const mine = room && room.currentState.getStateEvents("m.room.member", me);
        from = (mine && mine.getSender) ? mine.getSender() : null;
      }
    } catch (e) { from = null; }
    // NO SILENT SKIP. If we cannot name the other person we cannot index the map, and the caller
    // has to know: returning as though it worked is what produced the duplicates.
    if (!from) {
      Logger.warn("MatrixBridge: joined " + roomId + " but could not identify the inviter — " +
                  "m.direct not updated");
      return { roomId: roomId, recorded: false };
    }
    await _rememberDirect(from, roomId);
    return { roomId: roomId, recorded: true, userId: from };
  }

  // ── DECLINING LEAVES, AND LEAVES THE MAP ALONE — DELIBERATELY ─────────────────────────────
  // The sibling was written with the same one-line shape and only one half was ever driven. Asked
  // directly: should a stale map entry go too?
  //
  // **There is nothing to remove.** An invite this account never accepted was never in `m.direct`
  // — that map is written by whoever STARTS a conversation, which is the whole reason accepting
  // had to write it. So declining has no entry to clean up, and adding a removal here would be
  // code that never runs.
  //
  // What a removal WOULD affect is a room this account started and later left, whose entry
  // `m.direct` keeps. `findDMRoom` already handles that: it skips rooms we are not joined to, so a
  // stale entry offers nothing and sends nowhere. Harmless, and left alone rather than pruned —
  // rewriting account data to tidy a list nobody reads is a write with the user's name on it for
  // no gain.
  async function declineDMInvite(roomId) {
    if (!_c() || !roomId) throw new Error("declineDMInvite: no room");
    await _c().leave(roomId);
    return roomId;
  }

  // The room id for a conversation with `userId`, or null. Only a room we are still joined to
  // counts: `m.direct` keeps entries for rooms the account has left, and offering one of those
  // as the live conversation sends into a room nobody reads.
  function findDMRoom(userId) {
    if (!userId || !_c()) return null;
    const list = _directMap()[userId];
    if (!Array.isArray(list)) return null;
    for (const id of list) {
      try {
        const r = _c().getRoom(id);
        if (r && (!r.getMyMembership || r.getMyMembership() === "join")) return id;
      } catch (e) {}
    }
    return null;
  }

  async function _rememberDirect(userId, roomId) {
    const map = _directMap();
    const list = Array.isArray(map[userId]) ? map[userId].slice() : [];
    if (list.indexOf(roomId) < 0) list.push(roomId);
    map[userId] = list;
    try { await _c().setAccountData("m.direct", map); }
    catch (e) { Logger.warn("MatrixBridge: could not record m.direct — " + (e && e.message)); }
  }

  async function createDM(userId) {
    if (!_c()) throw new Error("MatrixBridge: not logged in");
    if (!userId) throw new Error("MatrixBridge: createDM needs a user id");
    const res = await _c().createRoom({
      preset: "trusted_private_chat",
      is_direct: true,
      invite: [userId],
      initial_state: [
        { type: "m.room.encryption", state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" } },
        { type: "m.room.guest_access", state_key: "", content: { guest_access: "forbidden" } },
        { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "invited" } },
      ],
    });
    const roomId = res && res.room_id;
    if (!roomId) throw new Error("MatrixBridge: createDM returned no room id");
    await _rememberDirect(userId, roomId);
    return roomId;
  }


  // --- Avatar cache ---
  // Fetches each user's avatar exactly once, converts mxc:// to an HTTPS
  // thumbnail URL, and caches the result (null = no avatar / failed). Fires
  // _avatarListeners when a profile updates so the UI can re-render.
  // Thumbnail size 96px — small enough to be cheap, big enough for 2x screens.
  const AVATAR_SIZE = 96;
  const _avatarCache = {};   // userId -> blob/HTTP URL string | null
  const _avatarMxc = {};     // userId -> last mxc loaded (dedups repeat change events)
  const _avatarListeners = [];
  function onAvatarChange(fn)  { if (fn && !_avatarListeners.includes(fn)) _avatarListeners.push(fn); }
  function offAvatarChange(fn) { const i = _avatarListeners.indexOf(fn); if (i >= 0) _avatarListeners.splice(i, 1); }
  function _fireAvatarChange(userId) {
    for (const fn of _avatarListeners) { try { fn(userId); } catch (e) {} }
  }

  // Parse "mxc://server/mediaId" -> { server, mediaId } or null.
  function _parseMxc(mxc) {
    if (typeof mxc !== "string" || mxc.indexOf("mxc://") !== 0) return null;
    const rest = mxc.slice("mxc://".length);
    const slash = rest.indexOf("/");
    if (slash < 0) return null;
    return { server: rest.slice(0, slash), mediaId: rest.slice(slash + 1) };
  }

  // Returns the cached avatar URL (a blob: object URL) for userId, or null.
  // On a cache miss it kicks off an async authenticated fetch and fires
  // _fireAvatarChange when the blob URL is ready — so the UI updates then.
  // Subsequent calls return the cached value synchronously.
  function getAvatarUrl(userId) {
    if (!userId || !_c()) return null;
    if (userId in _avatarCache) return _avatarCache[userId];
    _avatarCache[userId] = null;   // mark in-flight so we don't double-fetch
    _loadAvatar(userId);
    return null;
  }

  // Async loader. Resolves the user's mxc (local store or profile fetch),
  // then downloads the thumbnail WITH the access token and caches a blob URL.
  // Plain <img src> can't send an auth header, and matrix.org now requires
  // authenticated media — so we fetch the bytes ourselves and hand the UI a
  // local blob: URL it can render. Falls back to the legacy unauthenticated
  // endpoint for older homeservers that don't enforce auth.
  async function _loadAvatar(userId, mxcHint) {
    // 1. Resolve the mxc://. If a fresh hint is supplied (from a change event),
    //    use it directly — it's authoritative and avoids any network round-trip.
    //    With NO hint (initial load), ask the server for the CURRENT avatar via
    //    getProfileInfo FIRST. We deliberately do NOT trust client.getUser().avatarUrl
    //    up front: that value comes from cached room-membership state and lags a
    //    user's actual profile, so after someone changes their picture we'd keep
    //    showing the old one (#10). The lagging store is only a last-resort fallback
    //    if the profile fetch fails (offline / transient error).
    let mxc = mxcHint || null;
    if (!mxc) {
      try {
        const profile = await _c().getProfileInfo(userId);
        mxc = profile && profile.avatar_url;
      } catch (e) {
        Logger.debug("Avatar: getProfileInfo failed for " + userId + ": " + e.message);
      }
    }
    if (!mxc) {
      const user = _c().getUser ? _c().getUser(userId) : null;
      if (user && user.avatarUrl) mxc = user.avatarUrl;
    }
    if (!mxc) {
      // No avatar (never had one, or it was just removed). Clear to null and
      // notify so the UI can fall back to initials if it was showing a picture.
      if (_avatarCache[userId]) _setAvatar(userId, null);
      else _avatarCache[userId] = null;
      return;
    }

    const parts = _parseMxc(mxc);
    const base = _c().baseUrl || (_c().getHomeserverUrl ? _c().getHomeserverUrl() : null);
    const token = _c().getAccessToken ? _c().getAccessToken() : null;

    // 2. Preferred path: authenticated media endpoint (Matrix 1.11+, MSC3916),
    //    fetched with the bearer token and turned into a local blob: URL.
    if (parts && base && token) {
      const authUrl = base.replace(/\/$/, "") +
        "/_matrix/client/v1/media/thumbnail/" + encodeURIComponent(parts.server) +
        "/" + encodeURIComponent(parts.mediaId) +
        "?width=" + AVATAR_SIZE + "&height=" + AVATAR_SIZE + "&method=crop";
      try {
        const res = await fetch(authUrl, { headers: { Authorization: "Bearer " + token } });
        if (res.ok) {
          const blob = await res.blob();
          _setAvatar(userId, URL.createObjectURL(blob));
          return;
        }
        Logger.debug("Avatar: authed media " + res.status + " for " + userId);
      } catch (e) {
        Logger.debug("Avatar: authed media fetch failed for " + userId + ": " + e.message);
      }
    }

    // 3. Fallback: legacy unauthenticated URL (older homeservers). If this also
    //    fails to load, the UI's onerror handler shows initials.
    try {
      const legacy = _c().mxcUrlToHttp(mxc, AVATAR_SIZE, AVATAR_SIZE, "crop");
      if (legacy) { _setAvatar(userId, legacy); return; }
    } catch (e) {
      Logger.debug("Avatar: legacy mxcUrlToHttp failed for " + userId + ": " + e.message);
    }
  }

  // Cache a resolved avatar URL and notify listeners. Revokes a prior blob URL
  // for this user so we don't leak object URLs across profile changes.
  function _setAvatar(userId, url) {
    const prev = _avatarCache[userId];
    if (prev && typeof prev === "string" && prev.indexOf("blob:") === 0 && prev !== url) {
      try { URL.revokeObjectURL(prev); } catch (e) {}
    }
    _avatarCache[userId] = url;
    _fireAvatarChange(userId);
  }

  // Re-fetch a user's avatar in response to a live change event, using the FRESH
  // mxc the event carried (authoritative). De-dups: if the new mxc resolves to a
  // value we already have, _loadAvatar still produces a new blob and _setAvatar
  // fires once — cheap for a one-off profile change. Pass mxc=null when unknown
  // and it falls back to a server profile fetch.
  function _refetchAvatar(userId, mxc) {
    if (!userId) return;
    // Track the last mxc we loaded per user so a burst of identical membership
    // events (common on sync) doesn't re-download the same picture repeatedly.
    if (mxc && _avatarMxc[userId] === mxc) return;   // already loaded this exact avatar
    _avatarMxc[userId] = mxc || null;
    delete _avatarCache[userId];
    _loadAvatar(userId, mxc || null);
  }

  // Upload a new profile picture for the current user from a File/Blob.
  // Validates type + size, uploads to the (authenticated) media repo via the
  // SDK, sets it as the account's global avatar, then busts our own cache so
  // the new picture shows immediately. Returns { ok: true } or
  // { ok: false, reason } — never throws, so the UI can show a clean message.
  // Note: this sets the GLOBAL Matrix avatar (every room/client), matching how
  // standard clients behave — it is not scoped to this DDJP room.
  const AVATAR_MAX_BYTES = 8 * 1024 * 1024;   // 8MB — generous for a profile pic
  async function uploadAvatar(file) {
    if (!_c()) return { ok: false, reason: "not connected" };
    if (!file) return { ok: false, reason: "no file selected" };
    if (!file.type || file.type.indexOf("image/") !== 0) {
      return { ok: false, reason: "please choose an image file" };
    }
    if (file.size > AVATAR_MAX_BYTES) {
      return { ok: false, reason: "image is too large (max " + (AVATAR_MAX_BYTES / 1024 / 1024) + "MB)" };
    }
    // 1. Upload the bytes — SDK handles the auth + endpoint. Returns an mxc URL.
    let mxc = null;
    try {
      const res = await _c().uploadContent(file, { type: file.type, name: file.name || "avatar" }); // no-media-ok: account avatar — account-level exception, never touches the Spine (docs/main/02-architecture.md)
      // uploadContent returns either { content_uri } or the uri string depending on SDK version.
      mxc = (res && res.content_uri) ? res.content_uri : (typeof res === "string" ? res : null);
    } catch (e) {
      const rl = e && (e.errcode === "M_LIMIT_EXCEEDED" || e.httpStatus === 429);
      if (rl) return { ok: false, reason: "rate limited — wait a moment and try again" };
      const tooBig = e && (e.errcode === "M_TOO_LARGE" || e.httpStatus === 413);
      if (tooBig) return { ok: false, reason: "the server rejected the image as too large" };
      Logger.warn("MatrixBridge: avatar upload failed: " + (e && e.message));
      return { ok: false, reason: "upload failed — check your connection and try again" };
    }
    if (!mxc) return { ok: false, reason: "upload did not return a media URL" };
    // 2. Set it as the account avatar.
    try {
      await _c().setAvatarUrl(mxc);
    } catch (e) {
      Logger.warn("MatrixBridge: setAvatarUrl failed: " + (e && e.message));
      return { ok: false, reason: "the picture uploaded but updating your profile failed" };
    }
    // 3. Bust our own cache and re-fetch so the new picture appears at once.
    const me = B1MatrixBridge.getUserId();
    if (me) { _refetchAvatar(me, mxc); }
    Logger.info("MatrixBridge: avatar updated");
    return { ok: true };
  }

  // Bust the cache and re-notify when a user's profile picture changes live.
  // Called inside start() after the client is ready.
  function _watchAvatarChanges() {
    if (!_c()) return;
    _c().on("RoomMember.membership", (event, member) => {
      // New member joined — pre-warm their avatar (mxc from the membership).
      if (member && member.membership === "join") {
        const mxc = member.getMxcAvatarUrl ? member.getMxcAvatarUrl() : null;
        _refetchAvatar(member.userId, mxc);
      }
    });
    _c().on("User.avatarUrl", (event, user) => {
      // Global profile avatar changed — the user object's avatarUrl is fresh.
      if (user && user.userId) _refetchAvatar(user.userId, user.avatarUrl || null);
    });
    _c().on("RoomMember.avatarUrl", (event, member) => {
      // Room-member avatar changed — read the fresh mxc straight off the member.
      if (member && member.userId) {
        const mxc = member.getMxcAvatarUrl ? member.getMxcAvatarUrl() : null;
        _refetchAvatar(member.userId, mxc);
      }
    });
  }

  // ===== Encryption setup — cross-signing, secret storage, key backup (Topic 2) =====
  // All SDK crypto lives here in transport/. ui/interface.js renders the recovery-key
  // screens but never touches the SDK; index.html orchestrates between them.
  // Accounts and the original recovery key are created in Element — DDJP only unlocks
  // an existing identity, or (as a last resort) resets to a new one. See the project SECURITY policy doc.

  // The SDK calls this whenever it needs the secret-storage key (to read/write
  // cross-signing keys or the backup key). We return the key the user entered or the
  // one we just generated; null makes the SDK surface a recoverable error, not hang.
  async function _getSecretStorageKey({ keys }) {
    if (!_ssKey) return null;
    const keyId = Object.keys(keys)[0];
    return [keyId, _ssKey];
  }

  // UIA callback for uploading cross-signing keys (a protected endpoint, so the
  // server re-checks auth). We reuse the login password. On a restored session no
  // password is held, so this asks the user to log in again before changing setup.
  async function _authUploadDeviceSigningKeys(makeRequest) {
    if (!_loginPassword) {
      throw new Error("Please log out and log in again before changing encryption setup.");
    }
    await makeRequest({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: _c().getUserId() },
      password: _loginPassword,
    });
  }

  // Initialise Rust crypto (E2E). Idempotent: a no-op if crypto is already up. Runs the
  // token-refresh-first sequence with a single refresh-and-retry (the token can lapse
  // mid-init). Returns { ok } — startup ignores it (app loads regardless); retryCrypto()
  // uses it for in-place Tier-1 recovery. This is the ONLY place crypto is initialised.
  async function _initCrypto() {
    if (!_c()) return { ok: false, reason: "no client" };
    if (_c().getCrypto && _c().getCrypto()) return { ok: true };   // already initialised
    await _ensureFreshToken();
    const uid = _c().getUserId();
    const opts = { cryptoDatabasePrefix: _cryptoDbPrefix(uid) };
    try { const pk = await _pickleKey(uid); if (pk) opts.storageKey = pk; } catch (e) {}
    try {
      await matrixcs.loadCrypto();
      await _c().initRustCrypto(opts);
      // Default Rust-crypto policy: messages are encrypted to every device in the room,
      // including unverified ones, so a send is never blocked on an unverified device.
      // Cross-signing + recovery-key verification is handled by the Topic 2 flow.
      Logger.info("MatrixBridge: crypto initialised (rust, per-user" + (opts.storageKey ? ", encrypted at rest" : "") + ")");
      return { ok: true };
    } catch (e) {
      Logger.warn("MatrixBridge: crypto init failed once, retrying after token refresh");
      try {
        await _ensureFreshToken(true);
        await _c().initRustCrypto(opts);
        Logger.info("MatrixBridge: crypto initialised (rust) after refresh");
        return { ok: true };
      } catch (e2) {
        Logger.warn("MatrixBridge: crypto init failed — E2E chat will not work: " + (e2 && e2.message));
        return { ok: false, reason: (e2 && e2.message) || "init failed" };
      }
    }
  }

  // Cheap synchronous "is E2E up?" — the UI polls this to decide whether to show the
  // "secure chat offline" banner. True iff the client has a live crypto instance.
  function cryptoAvailable() { return !!(_c() && _c().getCrypto && _c().getCrypto()); }

  // Tier-1 recovery: re-run crypto init in place (forces a fresh token). Fixes the common
  // transient case — an expired token at startup — with NO page reload. Resolves true if
  // crypto is up afterwards; the UI escalates to a reload (Tier 2) when this returns false.
  async function retryCrypto() {
    try { const r = await _initCrypto(); return !!(r && r.ok); }
    catch (e) { Logger.warn("MatrixBridge: retryCrypto threw — " + (e && e.message)); return false; }
  }

  // Report encryption state so index.html can choose a screen: nothing (already
  // verified), "enter your recovery key", or "create one".
  async function encryptionStatus() {
    const crypto = _c() && _c().getCrypto && _c().getCrypto();
    if (!crypto) return { ok: false, reason: "no-crypto" };
    try {
      // Nudge backup on first — a no-op when the secret-storage key isn't loaded
      // this session, but it enables backup if we already unlocked earlier.
      await crypto.checkKeyBackupAndEnable().catch(() => {});
      const [crossSigningReady, hasServerKeys, backupVersion] = await Promise.all([
        crypto.isCrossSigningReady(),
        crypto.userHasCrossSigningKeys(),
        crypto.getActiveSessionBackupVersion(),
      ]);
      const backupActive = !!backupVersion;
      return {
        ok: true,
        // "ready" means the device is cross-signed (verified identity). We do NOT
        // require active key backup: DDJP encryption exists only to stop passive
        // eavesdropping on LIVE chat, and recovering old chat is a non-goal (Element
        // is the archive). Gating on backup would force a recovery-key prompt whenever
        // backup wasn't live this session — friction for no benefit. (Reverted the
        // ?v=10 `&& backupActive` gate.)
        ready: crossSigningReady,
        crossSigningReady,             // same as `ready` now; kept for callers that referenced it
        hasRecoveryKey: hasServerKeys, // account already has a recovery key (e.g. from Element)
        hasBackup: backupActive,
      };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }

  // Unlock with an existing recovery key (Element's "Security Key"). Validates it,
  // then cross-signs THIS device and restores the message-key backup. Throws on a
  // bad key so the UI can show an error.
  async function unlockEncryption(recoveryKey) {
    const crypto = _c().getCrypto();
    let privateKey;
    try {
      privateKey = matrixcs.cryptoApi.decodeRecoveryKey(String(recoveryKey || "").replace(/\s+/g, " ").trim());
    } catch (e) {
      throw new Error("That doesn't look like a recovery key.");
    }
    // Validate against the account's default secret-storage key before trusting it.
    const defKeyId = await _c().secretStorage.getDefaultKeyId();
    if (!defKeyId) throw new Error("This account has no recovery key set up yet.");
    const keyDesc = await _c().secretStorage.getKey(defKeyId);
    const keyInfo = keyDesc ? keyDesc[1] : null;
    const valid = keyInfo ? await _c().secretStorage.checkKey(privateKey, keyInfo) : false;
    if (!valid) throw new Error("That recovery key didn't match this account.");

    _ssKey = privateKey;
    try {
      await crypto.bootstrapCrossSigning({ authUploadDeviceSigningKeys: _authUploadDeviceSigningKeys });
      // Pull old message keys from the existing backup — best-effort (sessions that
      // were never backed up can't be recovered), but log the outcome instead of
      // silently swallowing it, so a broken restore is visible.
      try {
        const r = await crypto.restoreKeyBackup();
        Logger.info("MatrixBridge: key backup restore — " + ((r && (r.imported + "/" + r.total)) || "done"));
      } catch (e) {
        Logger.warn("MatrixBridge: key backup restore failed — " + (e && e.message));
      }
      // Trust + enable the existing server backup now that the secret is loaded.
      // Non-destructive and best-effort: if a usable backup exists it's enabled; if
      // not, we simply don't back up old message keys — fine, since old-chat recovery
      // is a non-goal. (Reverted the ?v=10 auto-`resetKeyBackup()` fallback, which
      // rolled a fresh server-side backup version whenever the existing one couldn't
      // be enabled — risky and unnecessary for DDJP's scope. Deliberate new-key
      // creation still resets backup, in commitNewRecoveryKey.)
      await crypto.checkKeyBackupAndEnable().catch(() => {});
      Logger.info("MatrixBridge: encryption unlocked with recovery key");
      return true;
    } catch (e) {
      _ssKey = null;
      Logger.warn("MatrixBridge: unlock failed — " + e.message);
      throw new Error("Couldn't finish unlocking: " + e.message);
    }
  }

  // Generate a new recovery key for display only. Commits nothing — index.html shows
  // the key, gates on the save-confirmation, then calls commitNewRecoveryKey().
  async function generateRecoveryKey() {
    const crypto = _c().getCrypto();
    _pendingNewKey = await crypto.createRecoveryKey();
    return _pendingNewKey.encodedPrivateKey;   // the human-readable key to show & save
  }

  // Confirm the user typed the generated key back correctly, before committing.
  function confirmRecoveryKeyMatches(typed) {
    if (!_pendingNewKey) return false;
    const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
    return norm(typed) === norm(_pendingNewKey.encodedPrivateKey);
  }

  // Commit the generated key. DESTRUCTIVE: replaces any existing secret storage,
  // cross-signing identity, and key backup with new ones under the new key. Old
  // encrypted *message* history under the previous key becomes unreadable. Room
  // membership, ownership, and power levels are room state, not crypto — untouched.
  // Called only after the save + re-entry confirmation.
  async function commitNewRecoveryKey() {
    const crypto = _c().getCrypto();
    if (!_pendingNewKey) throw new Error("No pending recovery key to commit.");
    const generated = _pendingNewKey;
    _ssKey = generated.privateKey;
    try {
      await crypto.bootstrapSecretStorage({
        setupNewSecretStorage: true,
        createSecretStorageKey: async () => generated,
      });
      await crypto.bootstrapCrossSigning({
        setupNewCrossSigningKeys: true,
        authUploadDeviceSigningKeys: _authUploadDeviceSigningKeys,
      });
      await crypto.resetKeyBackup();
      _pendingNewKey = null;
      Logger.info("MatrixBridge: new recovery key committed (encryption reset)");
      return true;
    } catch (e) {
      _ssKey = null;
      Logger.warn("MatrixBridge: encryption reset failed — " + e.message);
      throw new Error("Couldn't set up the new key: " + e.message);
    }
  }

  // --- Multi-account surface (data layer for the picker) -----------------
  // Known accounts (most-recently-active first) for the account switcher.
  function listAccounts() { return _loadAccounts(); }
  function getActiveUserId() { return _getActive(); }
  // True if this account still has a stored (restorable) session — i.e. switching
  // to it boots straight in, vs. a signed-out account that lands on login.
  function hasStoredSession(userId) { try { return !!localStorage.getItem(_sessionKeyFor(userId)); } catch (e) { return false; } }

  // Switch the active account: point at the chosen user and let the caller reload.
  // A reload re-runs the boot path (restoreSession reads the active account), which
  // gives a guaranteed-clean single client — sidestepping the SDK's not-thread-safe
  // constraint and the in-memory module teardown a live swap would require.
  function switchAccount(userId) {
    if (!userId || userId === _getActive()) return false;
    try { if (_c() && _c().stopClient) _c().stopClient(); } catch (e) {}
    clearDMScope();   // the person changed — see the DM scope block
    _setActive(userId);
    return true;
  }

  // Delete a user's crypto store(s). The Rust crypto store DBs are named from the
  // per-user prefix; we enumerate and drop every DB under it (with a fallback to
  // the known SDK suffixes when indexedDB.databases() isn't available). Review-only.
  async function _deleteCryptoDbs(userId) {
    const prefix = _cryptoDbPrefix(userId);
    const drop = (name) => new Promise((res) => { try { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch (e) { res(); } });
    try {
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        const targets = dbs.filter((d) => d && d.name && d.name.indexOf(prefix) === 0).map((d) => d.name);
        await Promise.all(targets.map(drop));
        return;
      }
    } catch (e) {}
    await Promise.all([prefix, prefix + "::matrix-sdk-crypto", prefix + "::matrix-sdk-crypto-meta"].map(drop));
  }

  // Forget an account on THIS browser entirely: its session blob, registry entry,
  // pickle key, and crypto store(s). (App-side storage is dropped by the caller via
  // Store.account.forgetUser.) Does NOT call client.logout() — this is a local
  // forget, not a global sign-out. Intended for NON-active accounts (the active
  // account holds an open crypto-store connection that would block deletion; the
  // UI only offers forget once an account is signed out / not active).
  async function forgetAccount(userId) {
    if (!userId) return;
    try { localStorage.removeItem(_sessionKeyFor(userId)); } catch (e) {}
    _saveAccounts(_registryRemove(_loadAccounts(), userId));
    if (_getActive() === userId) _setActive(null);
    try { await _skReq("readwrite", (os) => os.delete("pickle-" + userId)); } catch (e) {}
    try { await _deleteCryptoDbs(userId); } catch (e) {}
  }

  // ── THE ACCOUNT HOST — how the transport reaches this file without naming it ──────────────
  // matrixbridge.js calls these three from its sync loop. Filled here rather than imported
  // there, so the dependency runs plumbing -> transport in both directions of control flow.
  B1MatrixBridge._setAccountHost({
    refetchAvatar: _refetchAvatar,
    initCrypto: _initCrypto,
    watchAvatarChanges: _watchAvatarChanges,
  });

  return {
    login, logout, hasSession, restoreSession,
    getLoginFlows, startSsoLogin, completeSsoLogin, hasPendingSsoLogin,
    listAccounts, getActiveUserId, hasStoredSession, switchAccount, forgetAccount,
    _registryUpsert, _registryRemove,
    setDMScope, addDMScope, clearDMScope, inDMScope, dmRoomIds, findDMRoom, createDM,
    dmInviteRoomIds, acceptDMInvite, declineDMInvite,
    encryptionStatus, cryptoAvailable, retryCrypto, unlockEncryption,
    generateRecoveryKey, confirmRecoveryKeyMatches, commitNewRecoveryKey,
    getAvatarUrl, onAvatarChange, offAvatarChange, uploadAvatar,
  };
})();

// ── REGISTER THIS SLOT WITH THE SEAM (J23) ─────────────────────────────────────────────────
// `MatrixAccount` joined the interface at J59 and every doc in the tree said the seam had three
// globals until `ddjp_399`. It is a slot like the other three; a seam built to the old list is
// one the account half cannot pass through.
Backends.register("backend1", { MatrixAccount: B1MatrixAccount });
