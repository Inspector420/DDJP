// backends/backend1/matrixbridge.js
// Pure transport. Moves bytes between the core and Matrix homeservers.
// Stamps Lamport clock on outbound. Caches raw events. Delivers to StreamManager.
// Depends on: EventCache, StreamManager, Logger

// Channel model. Events exist for every rank (down to uncategorized);
// checkpoints now exist for EVERY rank too, uncategorized included (each paired
// with the events channel of the same rank); chat has three RANK-tiered encrypted
// tiers (uncategorized, guest, staff) plus `presence-chat`, which is encrypted
// like the others and tiered by nothing — its membership is the room's activity
// rule, not a level; settings exist at owner, staff, and
// high-staff. Power levels on every channel make access track rank: promote ->
// invited, demote -> removed — EXCEPT `presence-chat`, whose membership is the
// room's activity rule rather than rank (see `_presenceChatKey`). The finished
// set is the Space + 19 channels = 20 rooms, built over three batches of
// 7/7/6 (the Space counts in batch 1), so no burst exceeds the
// ~10-rooms-per-window creation rate limit.
//
// **DO NOT TRUST THIS SENTENCE — RE-DERIVE IT.** The CHANNELS table below is the
// count and its `batch` column is the split:
//   grep -cE '^\s*\{ kind: "' backends/backend1/matrixbridge.js
// This line has now rotted THREE times: it read "20 channels / three batches of
// 7/7/7", then "21 / four batches of 7/7/7/1", and both survived the packages
// that made them false. It is a figure sitting beside the table that produces it,
// which is the one shape this tree keeps proving does not hold.
//
// Batch 1 — room creation (Space + 6 channels = 7 rooms). UNCATEGORIZED-ONLY:
//   Space
//   events-uncategorized open, lvl 0   | events-owner open, lvl 99
//   checkpoints-uncategorized open, 0  | checkpoints-owner open, lvl 99
//   chat-uncategorized   E2E,  lvl 0
//   settings-owner       open, lvl 99
//
// Batch 2 — upgrade 1 (guest + player + VIP, 7 channels). The guest tier unlocks here:
//   events-guest  open, lvl 10 | checkpoints-guest lvl 10 | chat-guest E2E lvl 10
//   events-player lvl 20 | checkpoints-player lvl 20 | events-vip lvl 40 | checkpoints-vip lvl 40
//
// Batch 3 — upgrade 2 (staff + high-staff, 7 channels):
//   events-staff lvl 60 | checkpoints-staff lvl 60 | events-high-staff lvl 80 |
//   checkpoints-high-staff lvl 80 | chat-staff E2E lvl 60
//   (settings-staff / settings-high-staff are RESERVED FOR NOTHING — created like any
//    other, and the reducer honors ONLY settings-owner. They were built for a
//    per-setting delegation that J18 then built WITHOUT them: a lower rank sends
//    `ddjp.bot.request` on its own events channel and the bot authors the change, which
//    keeps `ddjp.room.settings` to one author. They are kept rather than deleted because
//    removing them forks the room shape between old and new rooms — see the table below.)
//
// Batch 4 — upgrade 3 (the presence chat, 1 channel):
//   presence-chat E2E lvl 0
//   THE FIRST CHANNEL WHOSE MEMBERSHIP IS NOT RANK. Invite-only; the owner bot adds and
//   removes people as the room's activity rule says they are around or not, so the
//   promote->invited / demote->removed rule above does NOT apply to it and `assignRank`
//   skips it explicitly. `lvl 0` is the WRITE gate and is deliberately the floor:
//   whoever the room let in may talk, and a rank gate on top would be a second answer to
//   a question membership already settles.
//
// Map keys use underscores: events_uncategorized, checkpoints_uncategorized, chat_staff, settings_high_staff, ...
// Everyone currently chats in chat-uncategorized (a temporary default; a future
// room setting will let an owner repoint the default to guest — not hardcoded).

const MatrixBridge = (() => {
  let client = null;
  let _loginInProgress = false;
  // --- Encryption setup state (Topic 2) ---
  let _ssKey = null;          // decoded secret-storage private key currently in use
  let _loginPassword = null;  // held briefly to satisfy UIA on cross-signing key upload
  let _pendingNewKey = null;  // a generated recovery key awaiting save-confirmation

  // --- Lamport clock — now PER ROOM, not per client ---
  // Each room/space keeps its own monotonic counter. Ordering and convergence
  // only ever compare events WITHIN one room's log (StreamManager is reset on
  // every room switch), so a per-room clock is sufficient and correct — and it
  // means event numbers restart low in each room instead of carrying a single
  // ever-climbing count across every room the client has ever touched.
  // _activeClockRoom names which room tickOutbound/updateInbound currently
  // operate on; seedClock(roomId) sets it (and creates the entry if absent),
  // called at room entry alongside StreamManager.reset().
  const _clocks = {};            // roomId -> highest l seen/sent in that room
  let _activeClockRoom = null;
  let _currentSpaceId = null;    // the space we're currently in — scopes the new-channel watcher

  function seedClock(roomId) {
    if (!roomId) return;
    // Room entry: wipe the phase and start the heartbeat. Called here because seedClock is already
    // the one thing every room entry does first.
    try { _wireSession(); _wireScheduler(); if (typeof Session !== "undefined") Session.enterRoom(roomId); } catch (e) {}
    try { if (typeof Scheduler !== "undefined") Scheduler.cancelAll(); } catch (e) {}
    // The cadence tick is stopped for the same reason Scheduler is cancelled here: a timer armed
    // against the previous room would fire against this one, and "one owner cancels every timer on
    // a room change" is a rule the scheduler already keeps. Re-armed by wireCheckpoints once the
    // new room's channels are known — arming it here would poll a room with no channels yet.
    //
    // _sealWired is deliberately NOT reset. It guards the StreamManager subscriptions, and `on`
    // APPENDS without de-duplicating, so clearing it here would re-subscribe _onSpineForSeal on
    // every room change: after N rooms a single play would trigger N floor revalidations and N
    // checkpoint ingests. Subscriptions are per-session; the tick is per-room. Two lifetimes that
    // happened to sit behind one flag.
    try { _stopSealTick(); } catch (e) {}
    if (typeof _clocks[roomId] !== "number") _clocks[roomId] = 0;
    _activeClockRoom = roomId;
    _currentSpaceId = roomId;    // room.js calls this with the space id at room entry
  }

  // ── THE CLOCK IS DERIVED, NOT COUNTED ────────────────────────────────────────────────────
  // `_maxHeldL` is the highest position anything we HOLD claims. `_clocks` is a memo over it,
  // never the source of truth — the project's own first rule (derive, never patch) applied to the
  // one piece of state that was quietly exempt.
  //
  // WHAT THE COUNTER COST, measured in a live room. It lived in memory only, so a page reload
  // dropped it to zero and it had to re-climb during replay. A client whose queue reconciled during
  // that climb sent with positions far below the room's head — and every client judged those
  // honestly and differently: the sender's own head was legitimately low at that moment so it
  // accepted them, while a client that had finished replaying refused them as backdated. Same rule,
  // opposite outcomes, two rooms. The two clients then disagreed about which song was playing,
  // and the owner's checkpoint pushed its version onto everyone.
  //
  // The raw cache is IndexedDB-backed and its own header calls it a "fast-reload seed", so it
  // SURVIVES the reload the counter did not. Deriving from it makes the clock correct the instant
  // the cache is loaded, before replay contributes anything — the window closes rather than being
  // guarded.
  //
  // COST: this parses held raws on each send. Sends are a handful per song, so it is paid rarely,
  // and the alternative — a second stored number to keep in sync with the events — is precisely the
  // shape that caused the bug.
  function _maxHeldL() {
    let m = 0;
    try {
      const log = (typeof StreamManager !== "undefined" && StreamManager.getLog) ? StreamManager.getLog() : [];
      for (const e of log) if (e && typeof e.l === "number" && e.l > m) m = e.l;
    } catch (e) {}
    // ONLY WHEN THE CACHE CAN BE SCOPED TO THIS ROOM. `_heldHere` is now scoped by the room scope
    // bound at entry, and returns NOTHING rather than everything when no room is bound — so this
    // guard is belt-and-braces rather than the only thing standing between us and another room's
    // numbering. It used to be load-bearing: the cache fell back to every room this client had
    // ever been in, and deriving a clock from that jumped this room's positions to a value nobody
    // else had any reason to reach.
    //
    // The derived log above IS room-scoped now — but only because the ingest door refuses foreign
    // rooms (see _ingestSpineEvent). This comment used to justify reading it unguarded on the
    // grounds that "StreamManager is reset per room", which is true AFTER the first reset and
    // false before it: at startup sync had already folded another room's events in, and a fresh
    // room opened its numbering at 91 because a different room had reached 93. The premise is
    // now enforced rather than assumed.
    //
    // Either way the degradation is the same shape: less evidence, never foreign evidence — a
    // lower floor, never a stranger's.
    try {
      if (_activeScope) {
        for (const raw of _heldHere()) {
          const ev = (typeof StreamManager !== "undefined" && StreamManager.normalise)
            ? StreamManager.normalise(raw) : null;
          if (ev && typeof ev.l === "number" && ev.l > m) m = ev.l;
        }
      }
    } catch (e) {}
    return m;
  }

  function tickOutbound() {
    if (!_activeClockRoom) return 1;          // no room active yet — defensive
    // A FLOOR, NEVER A CEILING. What we hold can only RAISE the clock; it can never pull it down,
    // which is what a naively restored stored value would have done.
    const floor = Math.max(_clocks[_activeClockRoom] || 0, _maxHeldL());
    _clocks[_activeClockRoom] = floor + 1;
    return _clocks[_activeClockRoom];
  }

  function updateInbound(l) {
    if (!_activeClockRoom) return;
    if (typeof l === "number") {
      _clocks[_activeClockRoom] = Math.max(_clocks[_activeClockRoom] || 0, l);
    }
  }

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
    if (!client) throw new Error("MatrixBridge: no active client to refresh token");
    const r = await client.refreshToken(refreshToken);
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
      const r = await client.refreshToken(s.refreshToken);
      if (r && r.access_token) {
        client.setAccessToken(r.access_token);
        if (client.http && client.http.opts) client.http.opts.refreshToken = r.refresh_token || s.refreshToken;
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
      client = matrixcs.createClient({
        baseUrl: session.homeserver,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: session.userId,
        deviceId: session.deviceId,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
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
      client = matrixcs.createClient({
        baseUrl: homeserver,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: response.user_id,
        deviceId: response.device_id,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
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
      client = matrixcs.createClient({
        baseUrl: homeserver,
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        tokenRefreshFunction: _tokenRefreshFunction,
        userId: response.user_id,
        deviceId: response.device_id,
        cryptoCallbacks: { getSecretStorageKey: _getSecretStorageKey },
      });
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
      if (client) await client.logout();
    } catch (e) {}
    _clearSession();
    try { localStorage.removeItem(SSO_PENDING_KEY); } catch (e) {}
    // The DM scope survives a ROOM change (a conversation is with a person, not inside a room)
    // and must not survive an ACCOUNT change, which is where the person stops being us.
    clearDMScope();
    client = null;
    _ssKey = null;
    _loginPassword = null;
    _pendingNewKey = null;
    Logger.info("MatrixBridge: logged out");
  }

  // --- Start sync ---
  async function start() {
    if (!client) throw new Error("MatrixBridge: not logged in");

    // Helper: build raw object and route to StreamManager + rawListeners
    function _routeEvent(event, room) {
      if (!room) return;

      // CRITICAL: ignore local echo that hasn't reached a real event_id yet.
      // matrix-js-sdk fires Room.timeline for an event the instant it's sent
      // locally — before the homeserver confirms it — carrying a temporary
      // placeholder ID (~roomId:txnId) while status is "sending"/"queued"/
      // "encrypting"/"not_sent". If that placeholder ever gets ingested into
      // StreamManager, it can become nowPlaying.pi (StateDeriver just uses
      // whatever eventId is attached), and a skip/play sent while that
      // placeholder is "current" will carry it as p — a value that can never
      // match a real event_id on ANY client, including the one that sent it,
      // once the confirmed version with the real ID lands. This was the
      // actual cause of skips that work locally but never take effect
      // anywhere, confirmed by inspecting the raw room content directly: a
      // stuck skip's p field was a literal "~!room:matrix.org:txnId..." string.
      //
      // Per matrix-js-sdk: status is EventStatus.SENT ("sent") once the
      // server has accepted the event and assigned its real ID — at that
      // point getId() already returns the real $-prefixed ID, so "sent" is
      // safe to let through. status becomes null/undefined once the full
      // remote-echo sync round-trip completes, also safe. Only the earlier
      // pending statuses still carry the placeholder ID and must be blocked.
      // ── AND THE STAMP HAS TO BE THE SERVER'S TOO ─────────────────────────────────────────
      // The reasoning above is right about the ID and stops there. At status "sent" the id is
      // real — the send response carried it — but the object is still OURS, and its
      // origin_server_ts is whatever THIS DEVICE's clock said when we pressed send. The server's
      // stamp only arrives with the sync echo, at which point the status clears.
      //
      // Folding the first delivery and then dropping the second as a duplicate left the sender
      // holding its own clock's value for good, while every other client held the server's.
      // `startedAt` is that stamp, and the playhead, the advance gate and the ceiling all compute
      // from it — so the DJ who queued a song measured it from a different origin than the room.
      // Measured live at 1644ms apart, and a checkpoint sealed in that state carried a startedAt
      // nobody else derives, which is what "checkpoint seed diverges from genesis queue" was
      // reporting for real. See check-own-event-stamp.
      const eid = event.getId ? event.getId() : null;
      const _d = deliveryState(event.status, eid);
      if (!_d.fold) {
        // Deferred, not discarded: the event is real, only its stamp is not yet. The confirmed
        // delivery re-routes through here (Room.localEchoUpdated fires again when sync replaces
        // the local copy) and is folded then.
        if (_d.defer && eid) _noteDeferred(eid, room);
        return;
      }
      if (eid) _clearDeferred(eid);

      // Spine channels are immutable: refuse redactions/edits, ingesting the
      // verified original instead (see _ingestSpineEvent). Raw listeners are chat,
      // which filters to its own (non-Spine) channel, so Spine events never need
      // the fan-out below.
      if (_isSpineChannel(room)) {
        // LIVE: this branch is already past the `toStartOfTimeline` and `liveEvent === false`
        // guards above, so anything reaching it arrived now.
        _ingestSpineEvent(event, room, true);
        return;
      }

      // Non-Spine (chat): unchanged — edits/redactions are honored for display.
      const content = event.getContent();

      let parsedL = 0;
      let parsedType = null;
      let parsedBody = null;
      if (event.getType() === "m.room.message" && content.body) {
        try {
          const parsed = JSON.parse(content.body);
          if (typeof parsed.l === "number") parsedL = parsed.l;
          if (typeof parsed.t === "string") parsedType = parsed.t;
          if (parsed && typeof parsed === "object") parsedBody = parsed;
        } catch (e) {}
      }
      updateInbound(parsedL);

      const raw = {
        event_id: event.getId(),
        type: event.getType(),
        sender: event.getSender(),
        room_id: room.roomId,
        ts: event.getTs(),
        content: content,
        l: parsedL,
        // ── THE DDJP TYPE AND PAYLOAD, STAMPED FOR SUBSCRIBERS ────────────────────────────
        // `type` above is the MATRIX type, and for every DDJP event that is `m.room.message` —
        // the DDJP type rides inside the JSON body as `t`. Both were parsed six lines up and then
        // THROWN AWAY, so every `onRawEvent` subscriber received `type: "m.room.message"` and a
        // `content` whose payload was still a JSON string.
        //
        // REPORTED FROM A LIVE ROOM: the bot never acted on a delegated settings request. Its
        // handler asks `raw.type === "ddjp.bot.request"`, which cannot ever be true, so it
        // returned before counting anything — `seen: 0, acted: 0, refused: 0` while three
        // requests sat in the log. Not a rank problem, not a delegation problem, and not the
        // live-versus-history rule: the subscriber was reading a field that never carried it.
        //
        // STAMPED HERE RATHER THAN PARSED BY EACH SUBSCRIBER, because `StreamManager.ingest`
        // already re-parses this same body for the same reason, and a third copy would be a third
        // chance to disagree about what an event is. `type` is left alone — `features/chat.js`
        // reads it as the Matrix type and is right to.
        ddjpType: parsedType,
        ddjpBody: parsedBody,
        senderRank: _channelRank(room),   // channel origin = rank proof
        unsigned: event.getUnsigned ? event.getUnsigned() : null,
        // ── THE TARGET OF A REDACTION (J11) ────────────────────────────────────────────────
        // `m.room.redaction` names the event it deletes, and NOWHERE ELSE IN THIS ENVELOPE does
        // that id appear: `event_id` is the redaction's own. Without this field a chat client can
        // see that something was deleted and not which thing, which is indistinguishable from not
        // knowing at all. DRIVEN before the handler was written (`probe-j11-redact.js` R2).
        //
        // ONE LOCATION, BECAUSE THE ROOMS THIS BUILD CREATES ARE v11. `redacts` moved into
        // `content` at room version 11, and `_createOpenChannel`/`_createChatChannel` both pin
        // creation there. This once read the pre-v11 top-level location too, which LOOKED like a
        // compatibility bridge and was actually the shadow of a `room_version = "10"` two
        // functions away. Old rooms are discardable on upgrade, so the second read answered a
        // question nobody was owed an answer to — a branch reachable from no room this build can
        // make, which is a rule with no caller that a later reader would take for a live one.
        // `getAssociatedId()` is still asked first because the SDK normalises this itself, which
        // is the one path that would survive a version this build has not seen.
        redacts: (function () {
          try {
            if (event.getAssociatedId) { const a = event.getAssociatedId(); if (a) return a; }
          } catch (e) {}
          if (content && typeof content.redacts === "string") return content.redacts;
          return null;
        })(),
      };
      // Chat channels are the ephemeral Skin: do NOT cache or ingest them — that
      // would persist decrypted plaintext at rest and pollute/evict the bounded
      // voucher store. Chat lives only in RAM, rendered by the raw listeners and
      // reloaded from Matrix as needed.
      //
      // Recovery TRANSPORT (ddjp.voucher) is also not durable Spine:
      // it must REACH SUBSCRIBERS but must NOT be
      // EventCache.store'd — the cache IS the bounded voucher store, and caching transport
      // would evict the very originals we hold to answer with. So: ingest (notify) but skip
      // the store for these two types. They're reducer-inert (check-reducer-ignore), so
      // ingesting them can never affect derived truth.
      //
      // ── THE SECOND DOOR, SCOPED BY ORIGIN (J15) ──────────────────────────────────────
      // `_ingestSpineEvent` carries the room-scope gate and this branch did not, so the two
      // doors disagreed about what "here" means. The test above is a NAME test, and a room
      // whose name is neither `chat-*` nor a Spine prefix fell straight through it into the
      // store and the fold — which is every Matrix room this account is in that DDJP did not
      // create, and, once J15 exists, every DM room. DRIVEN before the fix: a `ddjp.dj.join`
      // delivered from a room that was never bound entered the log, answered `isLegal` true,
      // and put a stranger in the rotation with one buffered song. Origin decided nothing;
      // the absence of a name did.
      //
      // So the gate is the SAME gate, asked the same way, at the sibling door. Fail closed:
      // no scope bound means nothing is ours. Nothing legitimate is lost — every room in the
      // channels map is either Spine-named (handled above) or chat-named (skipped here), so
      // an in-scope room reaching this line is a room the map does not contain.
      //
      // A DM is NOT admitted by adding it to this scope. DM rooms carry their own scope
      // (`_dmScope`) which reaches the raw listeners and nothing else — a DM is Skin, so the
      // store and the fold are exactly the two places it must never arrive. See setDMScope.
      if (!_isChatChannel(room) && inScope(room.roomId)) {
        const _isRecoveryTransport = (parsedType === "ddjp.voucher");
        if (!_isRecoveryTransport) EventCache.store(raw);   // cache only durable spine originals
        StreamManager.ingest(raw);                          // subscribers see everything (inert types too)
      }

      for (const fn of _rawListeners) {
        try { fn(raw, event, room); } catch (e) {}
      }
    }

    // Fire rank-change listeners on power-level moves; fire channel-added
    // listeners when a new child channel is ADDED to the space we're in (an
    // upgrade), so every present client can join it immediately.
    client.on("RoomState.events", (stateEvent) => {
      try {
        if (!stateEvent || !stateEvent.getType) return;
        const t = stateEvent.getType();
        if (t === "m.room.power_levels") {
          for (const fn of _rankListeners) { try { fn(); } catch (e) {} }
          return;
        }
        if (t === "m.room.join_rules") {
          // Space visibility changed (or a channel's join rule). Notify only for
          // the current space — that's the value the Room-settings UI reflects.
          const isSpace = stateEvent.getRoomId && stateEvent.getRoomId() === _currentSpaceId;
          if (isSpace) for (const fn of _visListeners) { try { fn(); } catch (e) {} }
          return;
        }
        if (t === "m.space.child") {
          // Only adds (content has `via`) to the current space. An empty content
          // is a child *removal* — ignore it.
          const inCurrentSpace = stateEvent.getRoomId && stateEvent.getRoomId() === _currentSpaceId;
          if (!inCurrentSpace) return;
          const childId = stateEvent.getStateKey ? stateEvent.getStateKey() : null;
          const content = stateEvent.getContent ? stateEvent.getContent() : {};
          if (childId && content && Array.isArray(content.via) && content.via.length > 0) {
            for (const fn of _channelAddedListeners) { try { fn(childId); } catch (e) {} }
          }
          return;
        }
        if (t === "m.room.member") {
          // A membership event carries the member's current avatar_url. When a
          // user changes their global avatar, the homeserver propagates it into
          // these events across shared rooms — this is the most reliable
          // cross-client signal that someone's picture changed. Re-fetch using
          // the FRESH mxc straight from the event content (not the stale global
          // User store, which updates on a different event and lags behind).
          const userId = stateEvent.getStateKey ? stateEvent.getStateKey() : null;
          const content = stateEvent.getContent ? stateEvent.getContent() : {};
          if (userId) _refetchAvatar(userId, content && content.avatar_url ? content.avatar_url : null);
          return;
        }
      } catch (e) {}
    });

    client.on("Room.timeline", (event, room, toStartOfTimeline, removed, data) => {
      // Only LIVE events are routed here. Back-paginated (scrollback) events fire
      // this same listener with toStartOfTimeline=true — those are HISTORY, and
      // history is retrieved DELIBERATELY elsewhere: replayRoom (Spine, by direct
      // timeline iteration) and recentChatMessages / backfillRecent (chat, a tail
      // read folded oldest-first via prependOlder). Without this guard, the
      // scrollback that recentChatMessages runs to populate the one-shot chat
      // backfill fired this listener for every OLDER chat message, which routed
      // them to addChatMessage as if live — appending them bottom-first, so far
      // more than CHAT_BACKFILL rendered and in REVERSE order (newest at top).
      // Live events arrive with toStartOfTimeline=false; the Spine path is
      // unaffected (live spine events aren't back-paginated, replayRoom ingests
      // history directly, and StreamManager dedups by event_id regardless).
      if (toStartOfTimeline) return;
      if (data && data.liveEvent === false) return;   // belt-and-suspenders
      _routeEvent(event, room);
    });

    // CRITICAL companion to the local-echo guard in _routeEvent: that guard
    // correctly refuses to ingest an event while it's still pending (status
    // sending/queued/etc, temporary ~roomId:txnId ID) — see _routeEvent for
    // why. But matrix-js-sdk does NOT re-fire Room.timeline when a pending
    // event resolves to its final, confirmed state; it fires a SEPARATE event,
    // Room.localEchoUpdated, instead. Without listening for that too, an
    // event the local client itself sent would be filtered out once (while
    // pending) and then NEVER offered to _routeEvent again — meaning a
    // client's own sends would never update its own StreamManager at all.
    // This was a real regression: it surfaced as a single client repeatedly
    // re-attempting a genesis play forever, because their own successful
    // ddjp.dj.play never registered in their own local state, even though it
    // was genuinely present in the room (confirmed by inspecting raw room
    // content directly — the event existed and was correct).
    // By the time this fires, event.getId() already returns the real,
    // confirmed event ID and status is no longer a pending one, so it passes
    // _routeEvent's existing guard naturally — no special-casing needed here.
    client.on("Room.localEchoUpdated", (event, room) => {
      _routeEvent(event, room);
    });

    // E2E chat: SDK fires Event.decrypted once it has decrypted the content.
    // Re-route through the same path so rawListeners (chat.js) see the plain body.
    client.on("Event.decrypted", (event) => {
      const room = client.getRoom(event.getRoomId());
      _routeEvent(event, room);
    });

    // Initialise end-to-end encryption (Rust crypto / vodozemac, via the
    // vendored bundle — see tools/VENDOR_PROVENANCE.md). loadCrypto() instantiates
    // the WASM and must resolve before initRustCrypto(); the SDK's own internal
    // initAsync() then reuses that single load. Called after createClient() and
    // before startClient().
    //
    // Element-aligned crypto storage (Phase 2):
    //   - cryptoDatabasePrefix: a PER-USER crypto store, so multi-account devices
    //     never share one IndexedDB crypto DB (the SDK is not thread-safe across
    //     clients on the same DB) and "forget account" can drop it cleanly.
    //   - storageKey: a 32-byte PICKLE KEY that encrypts the crypto store at rest.
    //     It's a random key wrapped by the device-local non-extractable AES key
    //     (the same one that wraps the session) — Element's XSS-hardening pattern.
    //     Stable per user (required: the SDK needs the same key each init).
    // First run after this lands is a one-time re-key: the old default unencrypted
    // `matrix-js-sdk` store is abandoned, so each user re-inits into a fresh
    // per-user encrypted store and re-enters their recovery key to pull old room
    // keys from backup. Insecure contexts (plain-HTTP localhost) get no pickle key
    // and fall back to an unencrypted store, mirroring the session fallback.
    // Ensure a live access token before crypto init (see _ensureFreshToken): crypto's
    // first server calls run before startClient()'s refresh loop, so an expired token
    // here would make initRustCrypto() fail with "client does not support encryption".
    // The whole init lives in _initCrypto() so retryCrypto() can re-run the EXACT same
    // path later (Tier-1 recovery). Startup ignores the result and proceeds either way —
    // the app still loads without crypto (chat degrades to a visible banner, not a crash).
    await _initCrypto();

    // initialSyncLimit is deliberately LOW: nothing in DDJP relies on the
    // initial-sync timeline window. The Spine re-pages its complete history via
    // replayRoom() on join; chat is present-forward with a one-shot scrollback
    // backfill; room detection reads the room list (state), not timelines. Keeping
    // this small means the SDK isn't handed every joined room's old backlog to
    // decrypt at login — which is the source of the harmless-but-noisy
    // "key backup is not working" console wall for pre-key history. Reduces (does
    // not eliminate) that noise; incremental sync can still attempt some decrypts.
    await client.startClient({ initialSyncLimit: 1 });
    _watchAvatarChanges();   // wire real-time avatar update listeners
    Logger.info("MatrixBridge: sync started");
  }

  // Wait for the initial sync to complete before reading room state.
  // Returns a Promise that resolves when state is "PREPARED" or "SYNCING"
  // (both mean the client has received its first sync response).
  function waitForSync() {
    return new Promise((resolve) => {
      if (!client) { resolve(); return; }
      // If already synced, resolve immediately
      const currentState = client.getSyncState ? client.getSyncState() : null;
      if (currentState === "PREPARED" || currentState === "SYNCING") {
        resolve();
        return;
      }
      function onSync(state) {
        if (state === "PREPARED" || state === "SYNCING") {
          if (client) client.removeListener("sync", onSync);
          resolve();
        }
      }
      client.on("sync", onSync);
    });
  }

  // Wait until a Space's child channels are actually present in the synced state,
  // instead of sleeping a fixed guess and hoping. matrix-js-sdk has no single
  // "children are ready" event, so we poll the synced room state at a short
  // interval and return as soon as the condition holds — typically a few hundred
  // ms, versus the old flat multi-second waits. Two modes:
  //   needJoined:false — ready when the children are ADVERTISED (their
  //     m.space.child state events are present), so a caller can read the list
  //     and join each one. Used right after joining a Space.
  //   needJoined:true  — ready when every advertised child's room object has
  //     also SYNCED IN (client.getRoom resolves), so a caller can build a
  //     COMPLETE channel map and replay every channel. Used before map/replay.
  // The relevant count must hold steady for a couple of polls ("settled") so we
  // never proceed in the middle of children still arriving (e.g. right after an
  // upgrade adds channels). A hard timeout caps the wait so a missing/failed
  // child can never hang the join — on timeout we log and return what's present
  // (the caller still works with the children that did sync; a genuinely missing
  // channel surfaces downstream, never silently). SDK-facing, so it lives here.
  async function waitForSpaceChildren(spaceId, opts) {
    const o = opts || {};
    const needJoined  = !!o.needJoined;
    const timeoutMs   = typeof o.timeoutMs   === "number" ? o.timeoutMs   : 8000;
    const intervalMs  = typeof o.intervalMs  === "number" ? o.intervalMs  : 150;
    const settlePolls = typeof o.settlePolls === "number" ? o.settlePolls : 2;
    const deadline = Date.now() + timeoutMs;
    let last = -1, stable = 0;
    while (Date.now() < deadline) {
      let ready = false, metric = 0;
      const space = client ? client.getRoom(spaceId) : null;
      if (space) {
        const children = space.currentState.getStateEvents("m.space.child") || [];
        const total = children.length;
        if (total > 0) {
          if (needJoined) {
            let resolved = 0;
            for (const ch of children) {
              const rid = ch.getStateKey();
              if (rid && client.getRoom(rid)) resolved++;
            }
            metric = resolved;
            ready = resolved === total;   // every advertised child has synced in
          } else {
            metric = total;
            ready = true;                 // children are advertised — enough to join them
          }
        }
      }
      // Count consecutive polls where the condition holds AND the count is steady.
      if (ready && metric === last) {
        if (++stable >= settlePolls) return { ready: true, children: metric };
      } else {
        stable = ready ? 1 : 0;
      }
      last = metric;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    Logger.warn("MatrixBridge: waitForSpaceChildren timed out for " + spaceId + " (needJoined=" + needJoined + ")");
    return { ready: false, children: last < 0 ? 0 : last };
  }

  // Pub/sub for non-protocol events (chat, room state)
  const _rawListeners = [];
  function onRawEvent(fn) { if (fn && !_rawListeners.includes(fn)) _rawListeners.push(fn); }
  function offRawEvent(fn) { const i = _rawListeners.indexOf(fn); if (i >= 0) _rawListeners.splice(i, 1); }

  // Pub/sub for rank changes — fired when m.room.power_levels moves anywhere.
  const _rankListeners = [];
  function onRankChange(fn) { if (fn && !_rankListeners.includes(fn)) _rankListeners.push(fn); }
  function offRankChange(fn) { const i = _rankListeners.indexOf(fn); if (i >= 0) _rankListeners.splice(i, 1); }

  // Pub/sub for new channels — fired when a child is added to the current space
  // (a room upgrade). Lets clients join the new channel right away.
  const _channelAddedListeners = [];
  function onChannelAdded(fn) { if (fn && !_channelAddedListeners.includes(fn)) _channelAddedListeners.push(fn); }
  function offChannelAdded(fn) { const i = _channelAddedListeners.indexOf(fn); if (i >= 0) _channelAddedListeners.splice(i, 1); }

  // Pub/sub for space visibility — fired when the current space's join_rules move.
  const _visListeners = [];
  function onVisibilityChange(fn) { if (fn && !_visListeners.includes(fn)) _visListeners.push(fn); }
  function offVisibilityChange(fn) { const i = _visListeners.indexOf(fn); if (i >= 0) _visListeners.splice(i, 1); }

  // Pub/sub for the room LIST — fired when a room/space appears or our membership
  // in one changes (the things that move a space between owned/joined/invited).
  // Owns the SDK listeners so features never attach `.on()` to a handed-out
  // client (the transport boundary, enforced by check-boundaries). Mirror of
  // onRankChange. Subscribers get no payload; they re-scan via Room.scanDDJPRooms.
  const _roomsListeners = [];
  let _roomsWired = false;
  function _wireRoomsListeners() {
    if (_roomsWired || !client) return;
    const fire = () => { for (const fn of _roomsListeners) { try { fn(); } catch (e) {} } };
    client.on("Room", fire);
    client.on("Room.myMembership", fire);
    _roomsWired = true;
  }
  function onRoomsChanged(fn) {
    if (fn && !_roomsListeners.includes(fn)) _roomsListeners.push(fn);
    _wireRoomsListeners();
  }
  function offRoomsChanged(fn) { const i = _roomsListeners.indexOf(fn); if (i >= 0) _roomsListeners.splice(i, 1); }

  // --- Rank detection by write permission ---
  // My rank = the highest events-[rank] channel I can actually write to
  // (my power level >= that channel's message send level). That same channel is
  // where I post protocol events. Only channels that EXIST are considered, so
  // this degrades gracefully before higher-rank channels are created.
  // The highest-rank channel of a given KIND that I can actually WRITE to. One rule for both
  // kinds: `events_*` decides where protocol events go (and so my channel-origin rank), and
  // `checkpoints_*` decides where my checkpoints go. Because both read the same live power levels,
  // a promotion or demotion moves BOTH — room.js re-runs this on every rank change, so writes
  // switch to the new highest channel immediately rather than at the next room entry.
  function _bestWritable(channels, prefix) {
    if (!client || !channels) return { rank: -1, channelId: null, key: null };
    const me = getUserId();
    let best = { rank: -1, channelId: null, key: null };
    for (const key in channels) {
      if (key.indexOf(prefix) !== 0) continue;
      const room = client.getRoom(channels[key]);
      if (!room) continue;
      const rank = _rankFromKey(key);
      const myLevel = _userLevelInRoom(room, me);
      const sendLevel = _messageSendLevel(room);
      if (myLevel >= sendLevel && rank > best.rank) {
        best = { rank: rank, channelId: channels[key], key: key };
      }
    }
    return best;
  }

  function getRankInfo(channels) {
    const best = _bestWritable(channels, "events_");
    if (best.rank < 0) return { rank: 0, channelId: (channels && (channels.events_uncategorized || channels.events_player)) || null, key: null };
    return best;
  }

  // Where MY checkpoints go — the highest checkpoints channel I can write to, or null if none.
  // Everyone may seal (a personal checkpoint bounds their own storage); WHAT a checkpoint is worth
  // to others is decided by the trust cascade at ingest, never by which channel it arrived on being
  // hardcoded here.
  function getCheckpointChannelId(channels) {
    return _bestWritable(channels, "checkpoints_").channelId;
  }

  // My channel-origin rank: the rank of the highest EVENTS channel I can write to. This is the
  // rank every trust decision reads — proven by which channel accepted the write, never claimed.
  function getMyRank(channels) { return getRankInfo(channels).rank; }

  // ── MY POWER LEVEL IN A ROOM, READ BACK FROM THE SERVER (the bot runtime's entry gate) ─────
  // `getMyRank` above answers a CHANNEL TIER — the rank of the highest events channel I can write
  // to — and it cannot distinguish a bot at 99 from a human owner at 100, because both can write
  // to events-owner and both therefore answer 99. The bot runtime needs the actual NUMBER, and it
  // needs it from the same place every other authority decision comes from: `m.room.power_levels`
  // as the homeserver holds it. **A client asking about itself is still a client asking Matrix** —
  // this returns what the server state says, never a local claim, and a room the client has not
  // synced answers null rather than a plausible zero.
  //
  // Null and 0 are DIFFERENT and the caller must be able to tell: 0 is a real level (uncategorized)
  // and null is "I could not read it". A gate that treated the second as the first would refuse
  // correctly today and for the wrong reason, and would admit incorrectly the day the default
  // changed.
  function getMyPowerLevel(roomId) {
    if (!client || !roomId) return null;
    const room = client.getRoom(roomId);
    if (!room) return null;
    const me = getUserId();
    if (!me) return null;
    try {
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      if (!pl) return null;
      const c = pl.getContent() || {};
      const users = c.users || {};
      if (users[me] !== undefined) return users[me];
      return typeof c.users_default === "number" ? c.users_default : null;
    } catch (e) { return null; }
  }
  function getWriteChannelId(channels) { return getRankInfo(channels).channelId; }

  // A user-set Matrix displayname is fully attacker-controlled. It's only ever shown via
  // textContent (never HTML — no XSS), but an uncapped one is still a display-griefing vector:
  // a megabyte name bloats the DOM, and bidi-override / control characters can visually scramble
  // the roster and other rows. Sanitize once at this transport boundary: strip C0/C1 control and
  // Unicode bidi-override/isolate formatting chars, collapse whitespace, and cap the length.
  // Returns "" for a missing/empty name so callers fall back to the userId.
  function _sanitizeName(name) {
    if (typeof name !== "string" || !name) return "";
    const cleaned = name
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    return cleaned.length > 64 ? cleaned.slice(0, 64) + "…" : cleaned;
  }

  // Roster of the space: joined members with display name and power level.
  function getRoster(spaceId) {
    const room = client ? client.getRoom(spaceId) : null;
    if (!room) return [];
    const out = [];
    const members = room.getJoinedMembers ? room.getJoinedMembers() : [];
    for (const m of members) {
      out.push({ userId: m.userId, name: _sanitizeName(m.name) || m.userId, level: _userLevelInRoom(room, m.userId) });
    }
    out.sort((a, b) => b.level - a.level);
    return out;
  }

  // A user's true authority = the highest power level they hold across the space
  // and every channel. Used to gate rank changes so an inconsistency in one
  // channel can't be used to demote someone who is actually higher elsewhere.
  function getUserEffectiveRank(spaceId, channels, userId) {
    if (!client) return 0;
    let max = 0;
    const ids = [spaceId].concat(Object.values(channels || {})).filter(Boolean);
    for (const roomId of ids) {
      const room = client.getRoom(roomId);
      if (!room) continue;
      const lvl = _userLevelInRoom(room, userId);
      if (lvl > max) max = lvl;
    }
    return max;
  }

  // What membership a user at power `level` should have in a given channel:
  //   chat channels   -> member only if the channel's rank <= level (rank-gated)
  //   everything else -> member always (events/checkpoints/settings are read-by-all;
  //                      writing is gated by power level, not membership)
  // Pure, so it can be tested without a homeserver.
  // A FUNCTION, NOT A CONST, and that is the whole of a defect this caught on its first run.
  // `_desiredMembership` sits ABOVE the `CHANNELS` table, so a `const` here is evaluated before the
  // table exists — "Cannot access 'CHANNELS' before initialization", in twenty-three guards at
  // once. Same shape as `capabilities.js` reading the reducer at construction time, and the same
  // fix: look it up when it is CALLED. Derived either way, so a renamed row renames this with it.
  function _presenceChatKey() {
    const row = CHANNELS.filter((c) => c.kind === "presence")[0];
    return row ? row.key : null;
  }

  function _desiredMembership(channelKey, level) {
    if (channelKey.indexOf("chat_") === 0) return _rankFromKey(channelKey) <= level;
    // ── THE PRESENCE CHAT IS NOT A RANK QUESTION, AND THE DEFAULT WOULD HAVE ANSWERED IT ────
    // Every other row falls through to `true` — belong everywhere unless a rank says otherwise —
    // and that default is correct for every channel whose membership rank decides. This one's
    // membership is decided by the ROOM'S ACTIVITY RULE, held by the owner bot.
    //
    // Left to fall through, `assignRank` would INVITE the user here. And `assignRank` is described
    // as a per-user repair that re-applies full correct state, so it does not merely add somebody
    // once: every promotion, demotion or repair anywhere in the room would silently undo the bot's
    // decision, re-admitting people it had just removed for being away. The bot would remove them
    // again on its next sweep, and the two would fight forever with nothing reporting it.
    //
    // `null` rather than `false`, because "not my decision" is not "should not be here". A false
    // would make `assignRank` KICK them — which is the same collision from the other side, tearing
    // out somebody the bot correctly admitted. The caller skips the channel entirely.
    if (channelKey === _presenceChatKey()) return null;
    return true;
  }

  // ── PRESENCE-CHANNEL MEMBERSHIP, FOR THE BOT ONLY ────────────────────────────────────────
  // Three thin transport calls. The DECISION about who belongs is not here and must not be — it is
  // the room's activity rule, folded in `features/`. This layer only reports who is currently in
  // and does what it is told, which is what keeps one answer to "who is around" instead of two.
  //
  // `joinedMembersOf` returns null rather than [] when the room cannot be read. An empty array is
  // a real answer meaning "nobody is in it", and a reconciler that could not tell them apart would
  // read an unsynced room as an empty one and invite the entire room into it.
  // ── AM I ACTUALLY IN THIS ROOM? ──────────────────────────────────────────────────────────
  // Needed because `presence-chat` is the one channel whose membership is NOT decided by rank —
  // the bot adds and removes people by the room's activity rule. So "the channel exists" and "I
  // can read it" are different questions for it, and only for it. Every other channel is joined
  // by rank, where existence is enough.
  //
  // TRUE ONLY FOR A CONFIRMED JOIN. An invite is not a join, and a room the client has not synced
  // answers false rather than a hopeful true — the caller uses this to decide whether to OFFER a
  // tier, and offering one that cannot be read is the empty-view defect the tier picker already
  // had once.
  function amJoined(roomId) {
    if (!client || !roomId) return false;
    try {
      const r = client.getRoom(roomId);
      if (!r) return false;
      if (!r.getMyMembership) return false;
      return r.getMyMembership() === "join";
    } catch (e) { return false; }
  }

  // ── INVITED, WHICH IS NOT "NOT JOINED" ────────────────────────────────────────────────────
  // `amJoined` answers one of three memberships. The other two — invited, and absent — are
  // different facts with different answers: an INVITE is a standing offer this client should take,
  // and absence is nothing to act on. Collapsing them is why an invited person read as simply
  // missing and sat outside a channel they were entitled to.
  // ── WHAT THIS ROOM DEMANDS OF A KICKER ────────────────────────────────────────────────────
  // Reported from a live room. The bot held rank 99 on the SPACE and 0 in the presence chat, and
  // every removal came back `[403] You cannot kick user` once a minute for three sessions. Nothing
  // noticed, because `getMyPowerLevel` is asked about the SPACE and the capability check asked
  // whether the bot had JOINED the channel — a neighbouring question to the one that matters.
  //
  // `_powerLevels` gives a `users` entry to the CREATOR alone; every other account starts at
  // `users_default: 0`, and `assignRank` writes power into every channel that exists WHEN IT RUNS
  // — so a channel added to the space later inherits nothing, which is exactly what happened when
  // presence chat moved into batch 3.
  //
  // 50 is the Matrix default when a room states no `kick`, and it is stated rather than assumed:
  // a room that omits the field still demands something, and reporting `0` would read as "anyone".
  function kickLevelOf(roomId) {
    if (!client || !roomId) return null;
    try {
      const room = client.getRoom(roomId);
      if (!room) return null;
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      if (!pl) return null;
      const c = pl.getContent() || {};
      return (typeof c.kick === "number") ? c.kick : 50;
    } catch (e) { return null; }
  }

  function amInvited(roomId) {
    if (!client || !roomId) return false;
    try {
      const r = client.getRoom(roomId);
      if (!r || !r.getMyMembership) return false;
      return r.getMyMembership() === "invite";
    } catch (e) { return false; }
  }

  // Accept one invite. TOTAL: a join that fails answers false rather than throwing, because the
  // caller reconciles every channel in one pass and one refusal must not end the pass.
  async function acceptChannelInvite(roomId) {
    if (!client || !roomId) return { ok: false, reason: "no-room" };
    try { await client.joinRoom(roomId); return { ok: true, reason: null }; }
    catch (e) { return { ok: false, reason: "join-failed", detail: (e && e.message) || null }; }
  }

  function joinedMembersOf(roomId) {
    if (!client || !roomId) return null;
    const room = client.getRoom(roomId);
    if (!room) return null;
    try {
      const m = room.getJoinedMembers ? room.getJoinedMembers() : null;
      if (!Array.isArray(m)) return null;
      return m.map((x) => (x && x.userId) ? x.userId : null).filter(Boolean).sort();
    } catch (e) { return null; }
  }

  // ── AND THE ONES WHO HAVE BEEN ASKED AND HAVE NOT ANSWERED ────────────────────────────────
  // The bot's presence reconcile invites everyone in `want` who is not in `joinedMembersOf`. A
  // pending invite is not a join, so somebody sitting on one looked missing on every pass and was
  // re-invited once a minute, forever — a duplicate invite state event each time, against a
  // homeserver that rate-limits.
  //
  // NOT FIXED WITH A COOLDOWN, deliberately. A cooldown is a timer plus a number nobody has a
  // value for, and it becomes a SECOND place answering "have I already asked this person" —
  // competing with the membership state, which is the real answer, free to read, and the only one
  // that survives the bot restarting. The reconcile stays a reconcile: read what is true now.
  //
  // SAME null-VS-EMPTY CONTRACT as its sibling above, and it matters in the opposite direction
  // here. An unreadable room answering `[]` would read as "nobody has been asked" and re-invite
  // everybody, which is the behaviour this exists to stop; `null` lets the caller fall back to the
  // joined list alone, which is the old behaviour and errs toward asking again. Erring the other
  // way — treating unreadable as "already asked" — would leave people out of the channel silently,
  // which is the whole defect this feature exists to prevent.
  // Held by `check-presence-chat`: PART G extracts this function and drives its null-vs-empty
  // contract directly, PART J drives the reconcile that reads it — including the fallback when it
  // cannot answer, which errs the OPPOSITE way to its sibling's.
  function invitedMembersOf(roomId) {
    if (!client || !roomId) return null;
    const room = client.getRoom(roomId);
    if (!room) return null;
    try {
      const m = room.getMembersWithMembership ? room.getMembersWithMembership("invite") : null;
      if (!Array.isArray(m)) return null;
      return m.map((x) => (x && x.userId) ? x.userId : null).filter(Boolean).sort();
    } catch (e) { return null; }
  }

  // Both TOTAL and both idempotent: inviting somebody already in, or removing somebody already
  // out, is a no-op the server answers with an error we deliberately swallow. A reconciler that
  // treated those as failures would retry forever against a correct state.
  async function inviteToPresence(roomId, userId) {
    if (!client || !roomId || !userId) return { ok: false, reason: "no-target" };
    try { await client.invite(roomId, userId); return { ok: true }; }
    catch (e) { return { ok: false, reason: "invite-failed", detail: e && e.message }; }
  }
  async function removeFromPresence(roomId, userId) {
    if (!client || !roomId || !userId) return { ok: false, reason: "no-target" };
    // KICK, NEVER BAN. Being away is not misconduct, and a ban would stop the bot re-admitting
    // them the moment they act — turning a reversible reading into a permanent one.
    try { await client.kick(roomId, userId, "not currently active in this room"); return { ok: true }; }
    catch (e) { return { ok: false, reason: "remove-failed", detail: e && e.message }; }
  }

  // --- Assign rank ---
  // The single source of per-user correctness. Sets the target's power level on
  // the space and every channel, then reconciles membership channel-by-channel to
  // exactly what the rank should have — inviting where they belong and missing,
  // kicking where they don't belong. Running it re-applies the full correct state,
  // so it doubles as a per-user repair: corruption (wrong power, missing or extra
  // channel membership) is overwritten with the right values everywhere.
  async function assignRank(spaceId, channels, userId, level) {
    const allRoomIds = [spaceId].concat(Object.values(channels));
    for (const roomId of allRoomIds) {
      try {
        const room = client.getRoom(roomId);
        if (!room) continue;
        const plEvent = room.currentState.getStateEvents("m.room.power_levels", "");
        const pl = plEvent ? Object.assign({}, plEvent.getContent()) : {};
        pl.users = Object.assign({}, pl.users);
        pl.users[userId] = level;
        await client.sendStateEvent(roomId, "m.room.power_levels", pl, "");
      } catch (e) {
        Logger.warn("MatrixBridge: assignRank power level failed for " + roomId + ": " + e.message);
      }
    }
    // Always a member of the space itself.
    try { await client.invite(spaceId, userId); } catch (e) { /* already in */ }
    // Per-channel membership reconciliation.
    for (const key in channels) {
      const roomId = channels[key];
      try {
        const want = _desiredMembership(key, level);
        // NULL IS "NOT MINE TO DECIDE" and is skipped, never coerced. `if (want)` alone would treat
        // it as false and kick; the three-way answer is the point.
        if (want === null) continue;
        if (want) await client.invite(roomId, userId);
        else await client.kick(roomId, userId, "rank below this channel");
      } catch (e) { /* already-in invite / not-in kick are expected no-ops */ }
    }
    Logger.info("MatrixBridge: assigned " + userId + " to level " + level + " (all channels reconciled)");
  }

  // ── REMOVING SOMEBODY FROM THE ROOM (J14) ─────────────────────────────────────
  // A DDJP room is a Space plus twenty channels: TWENTY-ONE Matrix rooms. So a kick
  // is twenty-one kicks and a ban is twenty-one bans, and the failure this pair
  // exists to make impossible is the one J14's entry names — **a partial ban looks
  // exactly like a success**. Twenty rooms closed and one open is not "mostly
  // banned"; it is a person who can still write to the room, holding a channel whose
  // events every other client will ingest and fold, because scope is bound by channel
  // id and nothing re-checks Space membership per event.
  //
  // THREE DECISIONS, so the next reader does not have to re-derive them:
  //
  // 1. THE VERDICT IS ALL-OR-NOTHING, AND IT IS A REPORT RATHER THAN A ROLLBACK.
  //    `ok` is true only when every one of the rooms is CONFIRMED closed. Anything
  //    less returns `ok: false` with the exact rooms named. There is deliberately no
  //    automatic undo: un-banning is the direction that RESTORES access, so a
  //    rollback that itself partially fails leaves a worse state than the partial it
  //    was correcting — the same problem one level down, pointing the unsafe way.
  //    What replaces it is that both calls are IDEMPOTENT and re-runnable: banning an
  //    already-banned room is a no-op that still verifies, so a retry converges on
  //    the complete state. That is `assignRank`'s property directly above, which
  //    doubles as a per-user repair for exactly this reason.
  //
  // 2. THE SPACE GOES FIRST. Every events/checkpoints/settings channel and the
  //    uncategorized chat are created `restricted`, joinable by any member of the
  //    Space with no invite (`_createOpenChannel`). So while the Space is still open
  //    the target can JOIN channels the loop has not reached yet, and the set of
  //    rooms they hold could GROW during the loop. Closing the Space first removes
  //    the re-entry basis before anything else moves. Channels-last is the order that
  //    cannot be overtaken by its own subject.
  //
  // 3. UNCONFIRMED IS NOT CLOSED. A room we cannot read back counts as NOT done, and
  //    is reported by name. "I can't tell" is a real answer (`CONCEPTS.md` §3.3) and
  //    the fail-closed direction here is obvious: the cost of a false "unverified" is
  //    a retry, and the cost of a false "verified" is the hole this whole function is
  //    about. `_membershipIn` answers `null` for a room the client cannot see, which
  //    is why it is not a boolean.
  //
  // WHAT A KICK IS AND IS NOT, because the UI must not overstate it: a kick REMOVES
  // someone now and does not keep them out. With the Space's join rule `public`, or
  // with an invite still outstanding, they can walk back in — and the restricted
  // channels then re-admit them automatically. That is a property of Matrix, not a
  // defect here, and `Room.kick` returns it so the surface can say so.

  // The target's membership in one room, or null when this client cannot see it.
  function _membershipIn(roomId, userId) {
    try {
      const room = client ? client.getRoom(roomId) : null;
      if (!room) return null;
      const m = room.getMember ? room.getMember(userId) : null;
      if (!m) return null;
      return m.membership || null;
    } catch (e) { return null; }
  }

  // The full room set a membership act must cover: the Space FIRST, then every channel.
  function _memberActionRooms(spaceId, channels) {
    const out = [];
    if (spaceId) out.push({ key: "space", roomId: spaceId });
    for (const key in (channels || {})) {
      if (channels[key]) out.push({ key: key, roomId: channels[key] });
    }
    return out;
  }

  // One shared body for both acts — they differ only in the SDK call and in the
  // membership that counts as done. Two copies would be two places for the
  // all-or-nothing rule to drift (P7).
  async function _memberAction(op, spaceId, channels, userId, reason) {
    const rooms = _memberActionRooms(spaceId, channels);
    const done = [], failed = [], unverified = [];
    const wanted = (op === "ban") ? "ban" : "leave";   // a kick lands the target in `leave`

    for (const r of rooms) {
      try {
        if (op === "ban") await client.ban(r.roomId, userId, reason || "banned from this room");
        else await client.kick(r.roomId, userId, reason || "removed from this room");
      } catch (e) {
        // An already-banned room throws on some servers and is a no-op on others, so the
        // THROW is not the verdict — the read-back below is. Record and keep going: stopping
        // at the first refusal is what leaves the remaining rooms open.
        Logger.warn("MatrixBridge: " + op + " failed for " + r.roomId + ": " + e.message);
      }
      const m = _membershipIn(r.roomId, userId);
      if (m === null) unverified.push(r.roomId);
      else if (m === wanted || m === "ban") done.push(r.roomId);   // a ban also satisfies a kick
      else failed.push(r.roomId);
    }

    const ok = (done.length === rooms.length);
    if (!ok) {
      Logger.warn("MatrixBridge: " + op + " of " + userId + " is INCOMPLETE — " + done.length +
        " of " + rooms.length + " rooms closed; still open: " +
        failed.concat(unverified).join(", "));
    } else {
      Logger.info("MatrixBridge: " + op + "ned " + userId + " across all " + rooms.length + " rooms");
    }
    return {
      ok: ok, op: op, total: rooms.length, closed: done.length,
      failed: failed, unverified: unverified,
      reason: ok ? null : (op + "-incomplete"),
    };
  }

  function banFromRoom(spaceId, channels, userId, reason) {
    return _memberAction("ban", spaceId, channels, userId, reason);
  }
  function kickFromRoom(spaceId, channels, userId, reason) {
    return _memberAction("kick", spaceId, channels, userId, reason);
  }

  // --- Rate limiting & progress ---
  const CREATION_DELAY_MS = 20000; // 20s between channels

  // ── Channel taxonomy — the SINGLE source of truth ──────────────────────────
  // One row per channel: kind, slug, its map key, rank power level, and creation
  // batch (1 = creation, everything above it an upgrade — do not restate the
  // list here, it read `2/3 = the two upgrades` until batch 4 existed).
  // EVERYTHING about channels
  // derives from this table — the creation/upgrade specs, the rank a channel
  // proves, and the name/key string forms — so a rank/name/level fact is stated
  // exactly ONCE (this is the fix for the old smear: three separate spec lists, a
  // duplicated rank-level map, and ad-hoc dash/underscore surgery in many spots).
  // The wire ROOM NAMES ("kind-slug", e.g. "events-high-staff") and map KEYS
  // ("kind_slug", e.g. "events_high_staff") are live Matrix state and MUST stay
  // byte-identical — check-channel-taxonomy pins the whole set. Batch-1 order is
  // the creation order (delays / progress labels / resume depend on it):
  // events u/g/o, checkpoints g/o, chat u/g, settings-owner.
  const CHANNELS = [
    // Batch 1 — creation (Space + 6 channels = 7 rooms; the Space counts toward
    // the ≤10 rooms-per-burst rate-limit ceiling). A freshly-created room is
    // UNCATEGORIZED-ONLY: the guest tier now unlocks at Upgrade 1 (batch 2), so a
    // brand-new room has no guest events/checkpoints/chat until the owner upgrades.
    { kind: "events",      slug: "uncategorized", key: "events_uncategorized",    level: 0,   batch: 1 },
    { kind: "events",      slug: "owner",         key: "events_owner",            level: 99,  batch: 1 },
    { kind: "checkpoints", slug: "uncategorized", key: "checkpoints_uncategorized", level: 0, batch: 1 },
    { kind: "checkpoints", slug: "owner",         key: "checkpoints_owner",       level: 99,  batch: 1 },
    { kind: "chat",        slug: "uncategorized", key: "chat_uncategorized",      level: 0,   batch: 1 },
    { kind: "settings",    slug: "owner",         key: "settings_owner",          level: 99,  batch: 1 },
    // Batch 2 — upgrade 1 (guest + player + VIP, 7 channels). The guest tier moved
    // here from creation, so it's unlocked as part of the first upgrade.
    { kind: "events",      slug: "guest",         key: "events_guest",            level: 10,  batch: 2 },
    { kind: "checkpoints", slug: "guest",         key: "checkpoints_guest",       level: 10,  batch: 2 },
    { kind: "chat",        slug: "guest",         key: "chat_guest",              level: 10,  batch: 2 },
    { kind: "events",      slug: "player",        key: "events_player",           level: 20,  batch: 2 },
    { kind: "checkpoints", slug: "player",        key: "checkpoints_player",      level: 20,  batch: 2 },
    { kind: "events",      slug: "vip",           key: "events_vip",              level: 40,  batch: 2 },
    { kind: "checkpoints", slug: "vip",           key: "checkpoints_vip",         level: 40,  batch: 2 },
    // Batch 3 — upgrade 2 (staff + high-staff, 7 channels).
    //
    // ── settings-staff AND settings-high-staff ARE GONE (removed by the owner) ────────────────
    // They were created against a future in which a lower tier would WRITE settings directly:
    // "per-setting, per-tier delegation, so it costs no rate-limited creation later". **J18 built
    // that delegation and did not use them.** Delegation is bot POLICY — a lower rank sends
    // `ddjp.bot.request` on its OWN events channel and the bot authors the settings change — which
    // keeps `ddjp.room.settings` to exactly one author and leaves the reducer untouched. They could
    // not have been the request channel even if that had been wanted: write-gated at 60 and 80,
    // while `botDelegation` can name any rank down to `uncategorized`.
    //
    // ── THEY WERE KEPT ONCE, AND THE REASONING IS PRESERVED BECAUSE IT WAS SOUND ──────────────
    // The earlier decision was to KEEP, and its deciding argument was a FORK: every room already
    // built has these two and new ones would not, which "has to be true forever and is invisible
    // until something starts iterating channels". As a default that is the right instinct.
    //
    // WHAT CHANGED IS THAT THE FORK WAS MEASURED RATHER THAN FEARED, and it is inert:
    //   · a NEW room (19 channels)                -> highestPresentBatch = 4
    //   · an OLD room (21, holding both removals) -> highestPresentBatch = 4
    // `highestPresentBatch` asks THIS TABLE for keys and checks the room's map, so the two extras
    // an old room carries are never asked about. Every other walk over a room's channels —
    // `_desiredMembership`, both invite loops, scope building — is key-driven and generic, so a
    // channel the table does not know is handled rather than tripped over. Nothing at RUNTIME
    // reads a channel count; the only `.length` is `CREATION_CHANNELS.length`, which is batch 1.
    //
    // AND THE PURPOSE IS NOW PERMANENTLY GONE, not merely unfulfilled. Delegation shipped, the
    // panel calls it, and a delegated request travels on the requester's own events channel by
    // construction. So the balance the earlier note struck — two creations saved against an inert
    // fork — was decided the other way BY THE OWNER, on a system where these channels can never
    // acquire a purpose. `check-room-compat` carries the acknowledgement in the same diff.
    //
    // The reducer honors ONLY settings-owner, before J18, after it, and after this.
    { kind: "events",      slug: "staff",         key: "events_staff",            level: 60,  batch: 3 },
    { kind: "checkpoints", slug: "staff",         key: "checkpoints_staff",       level: 60,  batch: 3 },
    { kind: "events",      slug: "high-staff",    key: "events_high_staff",       level: 80,  batch: 3 },
    { kind: "checkpoints", slug: "high-staff",    key: "checkpoints_high_staff",  level: 80,  batch: 3 },
    { kind: "chat",        slug: "staff",         key: "chat_staff",              level: 60,  batch: 3 },
    // ── Batch 4 — upgrade 3: THE PRESENCE CHAT, one channel (v322) ─────────────────────────
    // The first channel in this table whose membership is not decided by RANK. Every other row is
    // open to the space and write-gated at a level; this one is INVITE-ONLY, and the owner bot
    // adds and removes people as the room's activity rule says they are around or not.
    //
    // `level: 0` is the WRITE gate, and it is deliberately the floor: anybody who is in the room
    // may talk in it. The gate that matters here is membership, and a rank gate on top would be a
    // second answer to who may speak — the room already decided that by letting them in.
    //
    // ITS OWN BATCH, ALONE, rather than appended to batch 3. Batch 3 exists in every room built
    // before this; adding a row to it would mean a room that has completed "upgrade 2" has it in
    // some builds and not others, and `status()` floors against channels that EXIST — so those
    // rooms would report batch 3 incomplete and offer an upgrade that re-runs it. A new batch is
    // additive: rooms at 3 stay at 3 and are offered a 4 that did not previously exist.
    // ── `presence_chat` IS IN BATCH 3, AND IT HAD ITS OWN BATCH 4 UNTIL NOW ──────────────────
    // v322 gave it a batch of its own with a real argument: appending it to an EXISTING batch
    // means a room that already completed that batch has it in some builds and not others. That
    // argument was right, and understated — driven here rather than assumed, the outcome is worse
    // than the re-run it predicted. A room built earlier carries a `done` marker for batch 3;
    // `_computeStatus` takes the HIGHER of that marker and what physically exists, so the room
    // reports batch 3 complete, is offered NOTHING, and never creates this channel. The UI reads
    // "All ranks unlocked" over a room that is missing one.
    //
    // MOVED ANYWAY, BY THE OWNER, ON A STATED TRADE: the site is not public, so the response is to
    // rebuild the room — which is exactly what `check-room-compat`'s own message names as the
    // pre-release answer. It costs one upgrade click instead of two and one room-creation window
    // instead of two, and it costs every existing room a rebuild. `check-room-compat` now carries
    // `#b<batch>` in its surface so a future batch move cannot pass it silently, which this one
    // did: `key@level` was identical across the move.
    { kind: "presence",    slug: "chat",          key: "presence_chat",           level: 0,   batch: 3 },
  ];

  // Canonical string forms — the ONLY place these two transforms live.
  // name (wire) = "kind-slug"; key (map) = "kind_slug" (slug dashes -> underscores).
  function channelName(kind, slug) { return kind + "-" + slug; }
  function channelKey(kind, slug)  { return kind + "_" + String(slug).replace(/-/g, "_"); }
  // A channel ROOM NAME -> its map key, e.g. "events-high-staff" -> "events_high_staff".
  function channelKeyFromName(name) { return String(name || "").replace(/-/g, "_"); }

  // Derived lookups (built from the table — no second list, and no "highstaff"
  // alias: the canonical slug is "high-staff" and nothing else maps).
  const LEVEL_BY_SLUG = {};
  for (const c of CHANNELS) LEVEL_BY_SLUG[c.slug] = c.level;          // slug -> rank level
  const EVENTS_KEY_BY_LEVEL = {};
  for (const c of CHANNELS) if (c.kind === "events") EVENTS_KEY_BY_LEVEL[c.level] = c.key;
  function eventsKeyForLevel(level) { return EVENTS_KEY_BY_LEVEL[level] || null; }  // 80 -> "events_high_staff"
  function channelTaxonomy() {       // read-only copy, for guards / tools
    return CHANNELS.map(c => ({ kind: c.kind, slug: c.slug, key: c.key, level: c.level, batch: c.batch }));
  }

  // Batch-1 (creation) spec, derived from the table in creation order — what
  // createDDJPSpace builds and creationPlan reasons about. kind selects the
  // creator ("chat" -> E2E; else open).
  const CREATION_CHANNELS = CHANNELS.filter(c => c.batch === 1);
  const TOTAL_CHANNELS = CREATION_CHANNELS.length;   // 6 — derived, never drifts from the spec

  // Pure: given the channels that already exist (map key -> roomId), return the
  // spec items still to create (in spec order), how many already exist, and
  // whether creation is complete. No SDK, no side effects, total on bad input —
  // the same role highestPresentBatch plays for upgrades. This is the dedup
  // brain that makes creation resumable: a retry builds only plan.todo.
  function creationPlan(existingChannels) {
    const have = (existingChannels && typeof existingChannels === "object") ? existingChannels : {};
    const todo = CREATION_CHANNELS.filter(it => !have[it.key]);
    const done = TOTAL_CHANNELS - todo.length;
    return { todo, total: TOTAL_CHANNELS, done, complete: todo.length === 0 };
  }

  let _creating = false;   // re-entrancy guard: one creation at a time (mirror of RoomUpgrade._running)
  let _onProgress = null;

  function onProgress(fn) { _onProgress = fn; }

  function _reportProgress(completed, label) {
    if (_onProgress) _onProgress(completed, TOTAL_CHANNELS, label);
  }

  async function _delay() {
    await new Promise(resolve => setTimeout(resolve, CREATION_DELAY_MS));
  }

  // Progressive retry on 429 — waits on the server's retry-after, then a fixed window, then gives up
  async function _createWithRetry(createFn, label) {
    const waits = [30000, 60000];
    let attempt = 0;
    // `for (;;)` rather than `while (true)`: an intentional infinite loop with no test, which is
    // what `no-constant-condition` is written to distinguish from an accidental one. Same
    // behaviour, one token, and it keeps the rule on rather than exempting it.
    for (;;) {
      try {
        return await createFn();
      } catch (e) {
        const isRateLimit =
          e.errcode === "M_LIMIT_EXCEEDED" ||
          e.httpStatus === 429 ||
          (e.message && e.message.includes("429")) ||
          (e.message && e.message.toLowerCase().includes("too many requests"));
        if (isRateLimit && attempt < waits.length) {
          const serverWait = e.retryAfterMs || (e.data && e.data.retry_after_ms);
          const waitMs = serverWait ? serverWait + 2000 : waits[attempt];
          const waitUntil = Date.now() + waitMs;
          Logger.warn("MatrixBridge: rate limited on " + label +
            " (attempt " + (attempt + 1) + ") — waiting " + Math.round(waitMs / 1000) + "s");
          // 4th arg = absolute timestamp the wait ends, so the UI can tick a
          // live countdown rather than freezing on a one-shot number.
          if (_onProgress) _onProgress(null, TOTAL_CHANNELS, "Rate limited — retrying in ", waitUntil);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          attempt++;
        } else {
          throw e;
        }
      }
    }
  }

  // --- Power level helpers ---
  // --- Rank <-> channel mapping ---
  // Rank is proven by the channel an event lives in (channel origin). A channel
  // named "events-staff" or a map key "events_staff" denotes Staff rank. The
  // slug -> level map (LEVEL_BY_SLUG) is derived from the CHANNELS table above, so
  // there is no second rank list to drift and no defensive "highstaff" alias.

  // "events-high-staff" -> 80 ; "chat-player" -> 20 ; unknown -> 0
  function _rankFromName(name) {
    if (!name) return 0;
    const dash = name.indexOf("-");
    if (dash < 0) return 0;
    const slug = name.slice(dash + 1);
    return LEVEL_BY_SLUG[slug] !== undefined ? LEVEL_BY_SLUG[slug] : 0;
  }
  // "events_high_staff" -> 80 (map keys use underscores)
  function _rankFromKey(key) {
    const us = key.indexOf("_");
    if (us < 0) return 0;
    const slug = key.slice(us + 1).replace(/_/g, "-");
    return LEVEL_BY_SLUG[slug] !== undefined ? LEVEL_BY_SLUG[slug] : 0;
  }
  // The rank of the channel an event arrived on = the sender's proven rank.
  function _channelRank(room) {
    return room ? _rankFromName(room.name) : 0;
  }

  // --- Spine immutability (redaction / edit refusal) ---
  // The Spine — events / checkpoints / settings channels — is append-only and
  // immutable at the protocol level (docs/consensus/consensus-models.md: never honor a redaction OR edit
  // there). Chat is the ephemeral Skin and is left alone. A Spine channel is one
  // whose name is events-* / checkpoints-* / settings-*.
  function _isSpineChannel(room) {
    const n = room && room.name ? room.name : "";
    return n.indexOf("events-") === 0 || n.indexOf("checkpoints-") === 0 || n.indexOf("settings-") === 0;
  }

  // Chat channels (chat-*) carry the ephemeral Skin. Chat is RAM-only, sourced
  // from Matrix — it is NEVER written to our caches: not the StreamManager log
  // (chat isn't a protocol event; the reducer ignores it anyway) and especially
  // not EventCache, which is the bounded voucher store — caching chat there both
  // persists decrypted plaintext at rest AND can evict real Spine originals,
  // weakening redaction-refusal. So the router skips both for chat and only fans
  // it out to the raw listeners (chat renders in RAM). Pure, testable.
  function _isChatChannel(room) {
    const n = room && room.name ? room.name : "";
    return n.indexOf("chat-") === 0;
  }

  // HASH-REF IS THE ONLY STANDARD. Every room this app creates is hash-ref: Tier-1 chain
  // events (play/skip) carry pHash/hv and history is voucher-verifiable. There is no
  // per-room gate and no unhashed path — the m.room.create marker check that used to
  // live here existed solely to keep emission OFF for rooms predating the standard, and
  // this build does not support them. A branch that reads as care and silently changes
  // behaviour is this codebase's signature bug; deleting the category removes it.

  // ── PURE: IS THIS DELIVERY THE SERVER'S YET? ───────────────────────────────────────────────
  // Split out for the reason every decision in this file is split out: the only caller is an
  // SDK-facing router that cannot run headlessly, so left inline the rule could be asserted only
  // as source text — and a text assertion has already let one mutation through this file.
  //
  //   fold  — may this delivery enter the log? Only when the server has echoed it back, because
  //           only then is origin_server_ts the server's rather than ours.
  //   defer — is there a real event behind it worth waiting for? A placeholder id has none.
  const PENDING_STATUSES = { sending: 1, queued: 1, encrypting: 1, not_sent: 1, cancelled: 1 };
  function deliveryState(status, eventId) {
    // A temporary id is never our real event_id shape, whatever the status claims, and there is
    // nothing behind it to wait for — the confirmed delivery arrives under a different id.
    if (typeof eventId === "string" && eventId.indexOf("~") === 0) return { fold: false, defer: false, why: "placeholder-id" };
    if (status && PENDING_STATUSES[status]) return { fold: false, defer: false, why: "pending" };
    if (status === "sent") return { fold: false, defer: true, why: "sent-but-our-stamp" };
    if (status) return { fold: false, defer: true, why: "unknown-status:" + status };
    return { fold: true, defer: false, why: "confirmed" };
  }

  // ── THE BOUND ON WAITING, AND WHY IT STAYS EVEN THOUGH THE PATH IS VERIFIED ────────────────
  // Deferring relies on the SDK re-offering the event once sync echoes it, and it does:
  // Room.handleRemoteEcho swaps the remote event in, MatrixEvent.handleRemoteEcho clears the
  // status, and LocalEchoUpdated is emitted afterwards — which this file already listens to.
  // check-own-event-stamp PART F runs the vendored bundle and shows the id IDENTICAL across both
  // deliveries while only the stamp moves, which is exactly why checking the id was never enough.
  //
  // The bound stays anyway. lib/ is emptied for token-efficient handoff so a future session may
  // not be able to check this; an SDK upgrade could change the lifecycle; and "a client's own
  // sends never reach its own state" is a regression this file has already suffered once and
  // recorded. A stamp off by a round trip is small and bounded; losing your own event is not. So
  // an unconfirmed delivery is admitted late and loudly rather than lost.
  //
  // Comfortably under the room's minGate (8s at the shipped default), so an admitted-late advance
  // is still judged against the same gate everyone else applies.
  const DEFER_MAX_MS = 4000;
  function deferralExpired(deferredAt, now, maxMs) {
    if (!deferredAt) return false;                        // nothing deferred: nothing to expire
    const cap = (typeof maxMs === "number" && maxMs > 0) ? maxMs : DEFER_MAX_MS;
    return (now - deferredAt) > cap;
  }
  const _deferred = Object.create(null);   // eventId -> { at, room }
  let _deferSweep = null;
  function _noteDeferred(eventId, room) {
    if (_deferred[eventId]) return;                       // already waiting; do not restart its clock
    _deferred[eventId] = { at: Date.now(), room: room };
    if (_deferSweep) return;
    _deferSweep = setInterval(_sweepDeferred, 1000);
  }
  function _clearDeferred(eventId) {
    if (!_deferred[eventId]) return;
    delete _deferred[eventId];
    if (!Object.keys(_deferred).length && _deferSweep) { clearInterval(_deferSweep); _deferSweep = null; }
  }
  // Admit anything the server never echoed back. Says so at WARN: an event folded on a local
  // stamp is exactly the condition this gate exists to prevent, so on the rare path where it
  // happens anyway an operator should be able to see it rather than infer it later from a seed
  // that will not match.
  function _sweepDeferred() {
    const now = Date.now();
    for (const id in _deferred) {
      const d = _deferred[id];
      if (!deferralExpired(d.at, now, DEFER_MAX_MS)) continue;
      delete _deferred[id];
      Logger.warn("MatrixBridge: admitting " + id + " without a confirmed server stamp — the sync " +
        "echo never came back within " + DEFER_MAX_MS + "ms. Its timestamp is this device's clock, " +
        "so anything this client seals over it may not match what the room derives");
      try {
        const room = d.room;
        const client_ = client;
        const ev = (room && client_ && room.findEventById) ? room.findEventById(id) : null;
        // NOT LIVE, DELIBERATELY. These arrived live but were HELD as out-of-order and are being
        // released now, possibly much later. Folding them is right; ACTING on them is a judgement
        // call, and the safe side of it is silence — a person whose request was deferred can send
        // it again, whereas a bot that acts on a released backlog does what a reload just did.
        if (ev && room) _ingestSpineEvent(ev, room, false);
      } catch (e) {}
    }
    if (!Object.keys(_deferred).length && _deferSweep) { clearInterval(_deferSweep); _deferSweep = null; }
  }

  // Pure decision for a Spine event's content source — testable headlessly:
  //   not redacted        -> "ingest"  (use the ORIGINAL content; defends edits)
  //   redacted + have orig -> "restore" (re-ingest the verified original; refuse the redaction)
  //   redacted, no orig    -> "gap"     (flag an unrecoverable hole; never silently drop)
  function spineRestoreDecision(isRedacted, hasVerifiedOriginal) {
    if (!isRedacted) return "ingest";
    return hasVerifiedOriginal ? "restore" : "gap";
  }

  // Resolve a VERIFIED original raw for an event id, or null.
  //
  // VOUCHER SEAM. Today the only source is our own EventCache — a copy taken
  // when we first saw the event, before any redaction/edit. It is trusted because
  // it was stored under the event's real (server-validated) id, so the content
  // already matches the content-addressed id by construction. The future voucher
  // layer (the vouchers design; its doc was drained) plugs in HERE: additional sources are a
  // received `ddjp.voucher` carrying re-supplied original content, verified by
  // recomputing the Matrix reference hash and checking it equals the event id
  // (self-verifying — anyone may vouch, false content fails the hash). Many
  // vouchers for one id collapse to a single per-event record (see _integrity);
  // the selection policy (highest rank, then most recent) is specified in the
  // archive. The downstream is identical to today: a verified original is ingested
  // at its own (l, event_id) position, so it is counted as true in the timeline.
  // Voucher store (Phase A step 4, the restore-CONSUMPTION path — detection is step 5, the exchange
  // step 6). A caller submits a re-supplied original BODY for a gap id; verification is deferred to
  // _verifiedOriginalFor, which checks each candidate against the committed hash resolved from the
  // CURRENT held CHAIN anchors — so a candidate that arrives before its anchor is verified once the
  // anchor is held. Populated by the request/response exchange later; callable now for the live test.
  const _vouchers = {};   // eventId -> [ candidateBodyObject, ... ]
  function submitVoucher(eventId, candidateBody, from) {
    if (!eventId || !candidateBody || typeof candidateBody !== "object") return false;
    (_vouchers[eventId] = _vouchers[eventId] || []).push(candidateBody);
    // SIDE-RECORD (Phase A step 4 — detect + verify + record, NOT consensus). If this candidate
    // hash-verifies NOW against a held CHAIN anchor (unambiguous-agreement), record that the gap is
    // RECOVERABLE, aggregating sources via _addVoucherRecord (dedup by `from`, representative by
    // og.rk/ts). This is a SIDE record only — we do NOT re-ingest a gap-recovered event into the
    // derived chain: its origin rank is channel-stamped and unhashed (§9.2), so it is not
    // trustworthy-recoverable in Phase A, and restore-to-consensus is deferred to the attestation
    // slice (which rank-weights these very carriers). The gap CUTS meanwhile (§1-floor-safe). The UI
    // can surface "recoverable, pending rank confirmation" from getIntegrityFlags(). Best-effort:
    // never blocks holding the body. (A candidate that arrives before its anchor simply isn't recorded
    // yet; it verifies once the anchor is held and a later submit re-checks.)
    try {
      if (typeof Vouch !== "undefined") {
        const expected = Vouch.expectedHashFor(eventId, _heldHere());
        if (expected && Vouch.acceptOriginal(eventId, candidateBody, _heldHere())) {
          const og = candidateBody.og;
          const rec = _addVoucherRecord(_integrity[eventId], {
            eventId: eventId,
            from: from || null,
            rank: (og && typeof og.rk === "number") ? og.rk : null,   // self-declared origin rank — CORROBORATED at attestation, advisory here
            ts: (typeof candidateBody.l === "number") ? candidateBody.l : 0,
          });
          _flagIntegrity(Object.assign({ status: "recoverable" }, rec));
        }
      }
    } catch (e) { /* side-record is best-effort */ }
    return true;
  }

  function _verifiedOriginalFor(eventId) {
    const c = EventCache.get(eventId);
    if (c && c.event_id === eventId && c.content && typeof c.content.body === "string") return c;
    // VOUCHER PATH: a re-supplied original is accepted iff it hash-verifies against the committed hash
    // resolved from held CHAIN anchors — Vouch.expectedHashFor is chain-anchor-scoped
    // unambiguous-agreement: it returns null on NO anchor OR on CONFLICT (a forged orphan disagreeing),
    // so nothing verifies and the caller falls through to "gap". A forger can only DENY this way, never
    // poison (a mispicked hash would inject content). Notes are not consulted here (deferred to
    // attestation). The verified body is byte-identical to the original, so its re-ingest re-derives to
    // "as if never deleted" (§9). The returned raw carries the body + l; the caller fills the
    // channel-derived fields (senderRank etc.) — see the restore branch of _ingestSpineEvent.
    const cands = _vouchers[eventId];
    if (cands && cands.length && typeof Vouch !== "undefined") {
      const expected = Vouch.expectedHashFor(eventId, _heldHere());
      if (expected) {
        for (const body of cands) {
          if (Vouch.acceptOriginal(eventId, body, _heldHere())) {
            const l = (body && typeof body.l === "number") ? body.l : 0;
            return { event_id: eventId, content: { body: JSON.stringify(body) }, l: l, __voucher: true };
          }
        }
      }
    }
    return null;
  }

  // Per-event integrity flags — a side record (NOT consensus state; the reducer
  // stays pure). Keyed by event id so multiple sources/vouchers can be aggregated
  // into ONE object per event later. Today each entry records a single detection.
  const _integrity = {};   // eventId -> { eventId, l, sender, channel, status, at }
  const _integrityListeners = [];
  // Any integrity flag — a refused redaction, an unrecoverable gap, a chain parent we do
  // not hold — means history is at risk RIGHT NOW. It marks the next vouching pass urgent,
  // which skips the rank ladder. Routine under-coverage stays lazy on purpose; a discovered
  // hole does not.
  // Does this integrity status start the SEAL HOLD clock? (Pure — split out so the guard can
  // exercise the decision headlessly, the same way IDB's plan helpers are.)
  //   "integrity-gap"     our own view just went short — we are the client at risk.
  //   "redaction-refused" we restored ours, but the room is under ACTIVE deletion and a sibling
  //                       event may be going short in the same burst. Conservative on purpose.
  //   "recoverable"       a voucher SUPPLYING the original — that is the repair LANDING, not a
  //                       new wound. Refreshing on it would extend the hold past the fix.
  function startsSealHold(status) { return status === "integrity-gap" || status === "redaction-refused"; }

  // PURE: what should the hole clock become? Split out — the way sealHoldDecision is, and for the
  // same reason — because the only production writer is reachable only through the SDK-facing router,
  // so without this the "once, not refreshed" rule could be asserted only as TEXT, and a text
  // assertion already let one mutation through in this file's history.
  //
  // PURE: does a hole arriving now START a new run of holding, or continue the one in progress?
  //
  // THE OBVIOUS ANSWER IS WRONG, and a guard caught it. "A new run begins whenever we were not
  // already holding" looks right and fails completely: a paced attacker restamps a millisecond
  // AFTER each hold lapses, so at that instant we are not holding, the run resets, and the
  // aggregate cap never accumulates. They never extend a single hold — the burst rule is
  // untouched — they simply start a new one forever, and sealing is blocked at every moment
  // anyone would actually ask.
  //
  // So a run continues while holes keep arriving, and ends only after a full cycle of genuine
  // silence past the point the last hold would have expired. Trouble that stops for a whole cycle
  // is over; trouble that resumes instantly never stopped.
  function startsNewHoldRun(lastHoleAt, now, cycleMs) {
    if (!lastHoleAt) return true;
    return now > (lastHoleAt + cycleMs + cycleMs);
  }

  // ONCE. A hole arriving while a hold is already active does not extend it. Under the previous rule
  // it did, and each one bought another full cycle.
  //
  // "Active" must mean the same thing here as it does to the reader, so the cap is passed through:
  // once the aggregate bound has released the hold, no hold IS active, and the next hole legitimately
  // starts a fresh one. Without this the two disagreed — the reader saw released, this saw held — and
  // the stamp would sit still while a new run was being recorded against a stale start.
  function holeStampAt(currentAt, holeAt, now, cycleMs, runSince, maxHoldMs) {
    return sealHoldDecision(currentAt, now, cycleMs, runSince, maxHoldMs).hold ? currentAt : holeAt;
  }
  // Cleared by a SUCCESSFUL SEAL, called from the checkpoint send path in wireCheckpoints. The wait
  // belongs to the gap it was opened for; once we have sealed, that wait is spent, and the next gap
  // must open its own rather than inherit a clock that has already been paid for. Deliberately NOT
  // called from sealHoldForWitness: see the read-only note there.
  function noteSealed() { _lastHoleAt = 0; }

  function _flagIntegrity(rec) {
    try { _holeSeen = true; _scheduleProactiveWitness(); } catch (e) {}
    // SEAL HOLD (see sealHoldForWitness): stamp the clock a checkpoint must wait out — ONCE PER GAP.
    //
    // THIS REVERSES THE RULE THAT STOOD HERE, and the old rule's objection was not wrong, so here is
    // the comparison that overturned it. The old note said refreshing was deliberate: this app never
    // redacts, so anyone deleting spine history could already deny their own room its checkpoints,
    // and a cap would hand whoever can time deletions a guaranteed seal window — the race itself.
    //
    // The premise was too generous about who can delete. In Matrix a user may always redact THEIR
    // OWN events regardless of the `redact` power level; the room's `events_default: 0` means every
    // participant qualifies. So "anyone able to delete spine history" is not a privileged few, it is
    // everybody, and the cost of the attack the refreshing window accepted is: keep deleting your own
    // events. The room then never seals, nobody ever forgets, and thin clients are impossible.
    //
    // The attack the cap opens costs strictly more: delete AND prevent the re-broadcast reaching the
    // sealer, which is delivery control — homeserver-level, not participant-level. Its cost to us is
    // one event lost below the floor.
    //
    // So the indefinite version loses to a much cheaper attack than the one it prevents. That was a
    // tolerable trade while sealing was optional. It is not tolerable now that the floor is what
    // every client computes from, because denial-of-sealing has become denial-of-service for the
    // whole room. What this wait protects against is RECOVERABLE ACCIDENTAL loss — a holder who can
    // still re-broadcast. Against a determined attacker we were always going to lose something; the
    // question is only whether we lose the event or the room. See trust-cascade.md §7.3.
    if (rec && startsSealHold(rec.status)) {
      const at = (typeof rec.at === "number") ? rec.at : Date.now();
      const nowMs = Date.now();
      // A RUN NEEDS A START. The cap measures how long we have been holding continuously, so the
      // clock starts when a genuinely NEW run begins — see startsNewHoldRun for why "we were not
      // holding at this instant" is the wrong test and defeats the cap entirely. Asked before the
      // stamp moves, because afterwards the answer would be about the new hole.
      const fresh = startsNewHoldRun(_lastHoleAt, nowMs, witnessCycleMs());
      _lastHoleAt = holeStampAt(_lastHoleAt, at, nowMs, witnessCycleMs(),
                                _holdRunSince, maxSealHoldMs());
      if (fresh) _holdRunSince = _lastHoleAt;
    }
    _integrity[rec.eventId] = Object.assign(_integrity[rec.eventId] || {}, rec);
    for (const fn of _integrityListeners) { try { fn(_integrity[rec.eventId]); } catch (e) {} }
  }
  function getIntegrityFlags() { return Object.keys(_integrity).map(k => _integrity[k]); }
  function onIntegrityFlag(fn) { if (fn && !_integrityListeners.includes(fn)) _integrityListeners.push(fn); }

  // Ingest a Spine event with redaction/edit refusal. Shared by live routing and
  // replay so both honor immutability identically. `event` is the SDK MatrixEvent,
  // `room` its channel. Returns true if something was ingested.
  // Split out and EXPORTED as a seam. A textual guard can only check that a name appears, which is
  // why an earlier version of the wiring guard stayed green when the call was disabled — the string
  // was still there. Executing it is the only honest test that the tombstone is actually recorded.
  function _recordTombstone(event, room) {
    try {
      if (typeof Vouch === "undefined" || !Vouch.rememberTombstone) return false;
      return Vouch.rememberTombstone({
        id: event.getId ? event.getId() : null,
        sender: event.getSender ? event.getSender() : null,
        rank: _channelRank(room),           // the SAME function live events use
        roomId: room ? room.roomId : null,
        ts: event.getTs ? event.getTs() : 0,
      });
    } catch (e) { return false; }           // additive — never block ingest
  }

  // ── `isLive` DECIDES WHETHER SUBSCRIBERS ARE TOLD, AND IT IS NOT DECORATION ────────────────
  // This function is called from THREE places: the live timeline, the deferred sweep, and
  // `replayRoom`. The raw-listener fan-out at the bottom was added so the bot could hear
  // `ddjp.bot.request` at all — and, placed here without this flag, it fired for REPLAYED events
  // too. Reported from a live room: reloading the bot replayed the log, handed it every historical
  // request, and it authored TWELVE settings writes in a row, flipping `maxLen` through the values
  // of requests that had been answered days earlier. They were refused at the door as backdated,
  // so nothing was corrupted — but only because a second, unrelated guard caught them.
  //
  // A REPLAYED REQUEST MUST NEVER ACT. That rule already existed and was already relied upon; the
  // fan-out simply bypassed it by arriving somewhere the rule was not. Default FALSE, so a caller
  // added later is silent until somebody decides it should not be.
  function _ingestSpineEvent(event, room, isLive) {
    // ── THE DOOR. ONE ROOM AT A TIME. ────────────────────────────────────────────────────────
    // Sync delivers events from every room in every Space this client is in. Only the room we are
    // actually in is ours. Refused HERE rather than at the two call sites, because a rule placed
    // where someone happened to notice is a rule with holes — the same lesson as the floor bound,
    // the live-clock check and the held-set scope, each of which was applied to one path of
    // several. Before any store or fold: a gate after the work only suppresses the log line.
    const _rid = room && (room.roomId || room.room_id);
    if (!inScope(_rid)) return;
    const eid = event.getId();
    const unsigned = event.getUnsigned ? event.getUnsigned() : null;
    const isRedacted = (event.isRedacted && event.isRedacted()) || !!(unsigned && unsigned.redacted_because);
    // ── THE TOMBSTONE ────────────────────────────────────────────────────────────────────
    // A redaction does not remove an event. It strips its CONTENT and leaves the event id, the
    // sender, the timestamp and the ROOM ID — homeserver-signed. The room is the channel and the
    // channel is the rank, so the rank of a deleted event is readable directly from what remains,
    // by exactly the rule every live event's rank is read by.
    //
    // This is the half of reconstruction that was missing. A vouch record carries content and
    // position but CANNOT carry identity — it commits the sender without letting you open the
    // commitment, and a claimed `sender` field would be asserted identity, which this system
    // refuses everywhere. So a rebuilt event had no author, the reducer needs one, and a rebuild
    // could only ever be restore-material. With the tombstone it is a complete event that folds.
    //
    // Recorded BEFORE the restore decision, because it is useful even when we CAN restore from
    // cache: it is what lets a later gap be recognised as a real deletion rather than a claim.
    if (isRedacted) _recordTombstone(event, room);
    const decision = spineRestoreDecision(isRedacted, !!_verifiedOriginalFor(eid));

    if (decision === "restore") {
      // Refuse the redaction: re-ingest the verified original — our own cached copy, or a
      // hash-verified voucher body (both are byte-identical to what was deleted).
      const orig = _verifiedOriginalFor(eid);
      // A voucher-sourced original carries the verified body + l but NOT the channel-derived fields
      // (it wasn't ingested from the channel). Fill them from the CURRENT channel context: senderRank
      // is the channel-origin rank (_channelRank(room)) — the same trusted, client-side assessment any
      // event in this channel gets, and the redacted event arrived in THIS channel so it is the right
      // one; the body content is already hash-verified. (An EventCache-sourced original already has
      // these, so this only touches the voucher case.) Rank ADJUDICATION (corroborating the claimed
      // og.rk) is the attestation slice; here the channel context supplies the rank, as for any event.
      if (orig && orig.__voucher) {
        orig.type = event.getType();
        orig.sender = event.getSender();
        orig.room_id = room.roomId;
        orig.ts = event.getTs ? event.getTs() : 0;
        orig.senderRank = _channelRank(room);
        delete orig.__voucher;
      }
      Logger.warn("MatrixBridge: ignoring redaction of " + eid + " in " + (room.name || "?") +
        " — restoring verified original (Spine is immutable)");
      updateInbound(orig.l || 0);
      StreamManager.ingest(orig);   // do NOT re-store: keep the cached original intact
      _flagIntegrity({ eventId: eid, l: orig.l || 0, sender: orig.sender || null,
        channel: room.name || null, status: "redaction-refused", at: Date.now() });
      return true;
    }
    if (decision === "gap") {
      // Redacted and we never cached the original (joined after the deletion, or
      // cache cleared). We cannot resurrect server-purged content — flag the hole
      // loudly instead of silently dropping it (which used to resurrect old state).
      // The voucher layer can later fill this from another client that held it.
      Logger.warn("MatrixBridge: redacted Spine event " + eid + " in " + (room.name || "?") +
        " has no cached original — integrity GAP (cannot restore without a voucher)");
      _flagIntegrity({ eventId: eid, l: (unsigned && unsigned.redacted_because && 0) || 0, sender: event.getSender(),
        channel: room.name || null, status: "integrity-gap", at: Date.now() });
      return false;
    }

    // Normal: build raw from ORIGINAL content (getOriginalContent ignores an edit's
    // m.new_content, so edits to a Spine event are refused — the reducer always
    // sees the originally-committed body). Same shape as the legacy path.
    const content = event.getOriginalContent ? event.getOriginalContent() : event.getContent();
    let parsedL = 0;
    let parsedType = null;
    let parsedBody = null;
    if (event.getType() === "m.room.message" && content && content.body) {
      try { const p = JSON.parse(content.body); if (typeof p.l === "number") parsedL = p.l; if (typeof p.t === "string") parsedType = p.t; if (p && typeof p === "object") parsedBody = p; } catch (e) {}
    }
    updateInbound(parsedL);
    const raw = {
      event_id: eid,
      type: event.getType(),
      sender: event.getSender(),
      room_id: room.roomId,
      ts: event.getTs(),
      content: content,
      l: parsedL,
      // Same two fields the chat branch stamps, and for the same reason: `type` is the MATRIX
      // type, and every DDJP event is an `m.room.message` carrying its real type in the body.
      ddjpType: parsedType,
      ddjpBody: parsedBody,
      senderRank: _channelRank(room),
      unsigned: unsigned,
    };
    // Recovery transport (ddjp.voucher) is ephemeral coordination, not
    // durable Spine — do NOT cache it on replay either (mirrors the live-ingest fix), so a
    // rejoin can't repopulate the bounded voucher store with old transport. StreamManager.ingest
    // already keeps it out of the log; here we keep it out of the cache.
    const _isRecoveryTransport = (parsedType === "ddjp.voucher");
    if (!_isRecoveryTransport) EventCache.store(raw);   // cache the original — this IS the voucher store
    StreamManager.ingest(raw);

    // ── SPINE EVENTS REACH THE RAW LISTENERS TOO, AND THEY DID NOT ────────────────────────────
    // The branch that routes here `return`s before the chat fan-out, under a comment that stated
    // its own assumption plainly: *"Raw listeners are chat, which filters to its own (non-Spine)
    // channel, so Spine events never need the fan-out below."* That was TRUE when chat was the
    // only subscriber. `BotRuntime` then subscribed via `onRawEvent` for `ddjp.bot.request` —
    // which arrives on `events-*`, and every `events-*` channel IS a Spine channel. So the bot's
    // handler was never called, for any request, in any room, ever.
    //
    // REPORTED BY THE OWNER THREE TIMES. The first two answers were wrong: the live-only rule
    // (true of those events, not the cause) and then the DDJP-type field (a real second defect,
    // fixed, and only ever reachable on the chat branch). The subscription itself never fired,
    // which is why the counters read `seen: 0` — the bot could not refuse what it was not told
    // about.
    //
    // SAFE FOR THE EXISTING SUBSCRIBER, checked rather than assumed: `features/chat.js`
    // `_handleRaw` drops anything whose `room_id` is not in its readable set, and that set holds
    // chat channels only. It fails CLOSED on an empty set. So a Spine event reaching it is
    // discarded by the gate that is already its first line.
    //
    // AFTER the store and the fold, deliberately: a subscriber that acts on a request should be
    // acting on a room state that already contains the event it is reacting to.
    if (isLive === true) {
      for (const fn of _rawListeners) {
        try { fn(raw, event, room); } catch (e) {}
      }
    }
    return true;
  }

  function _userLevelInRoom(room, userId) {
    try {
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      const c = pl ? pl.getContent() : {};
      const users = c.users || {};
      if (users[userId] !== undefined) return users[userId];
      return typeof c.users_default === "number" ? c.users_default : 0;
    } catch (e) { return 0; }
  }
  function _messageSendLevel(room) {
    try {
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      const c = pl ? pl.getContent() : {};
      if (c.events && typeof c.events["m.room.message"] === "number") return c.events["m.room.message"];
      return typeof c.events_default === "number" ? c.events_default : 0;
    } catch (e) { return 0; }
  }

  // ── EVERY ACCOUNT'S LEVEL, NOT ONLY MINE ──────────────────────────────────────────────────
  // `getMyPowerLevel` above already loads the WHOLE `users` map and then throws all of it away
  // except one entry. This returns the map instead. It is not a second read of anything: both
  // read the same `m.room.power_levels` state event, which is why they sit together — a copy of
  // this walk placed anywhere else would be free to disagree about what a missing entry means.
  //
  // WHY IT EXISTS: the owner-bot rule is "one bot per room", and the designation is POWER LEVEL
  // rather than a setting — Matrix state the homeserver already enforces the writing of, so it
  // costs no settings key and therefore no checkpoint window (J45). Answering "how many accounts
  // sit at the bot's level" needs everyone's level, and nothing could ask that before this.
  //
  // `users_default` is deliberately NOT folded in. It is the level of everyone NOT named in the
  // map — an unbounded set this cannot enumerate, so including it would mean returning a count
  // that is wrong whenever the default is itself the bot level. A room whose default is 99 is a
  // room where everyone is the bot, and the honest answer to "who is at 99" is then "this
  // function cannot tell you", which `botsAtLevel` below reports rather than guessing.
  //
  // Returns null (never {}) when the state cannot be read, because an empty map is a real answer
  // meaning "nobody is named" and a caller that could not distinguish the two would report a
  // room with no bot identically to a room it failed to look at.
  function allPowerLevels(roomId) {
    if (!client || !roomId) return null;
    const room = client.getRoom(roomId);
    if (!room) return null;
    try {
      const pl = room.currentState.getStateEvents("m.room.power_levels", "");
      if (!pl) return null;
      // `|| {}` HERE WOULD BE THE DEFECT THIS FUNCTION EXISTS TO AVOID. An absent content object
      // is "I could not read this"; a content object with no `users` map is "nobody is named",
      // which is a real answer with real consequences (everyone sits at `users_default`).
      // Collapsing the first into the second returns a confident empty list for a room that was
      // never read — a plausible value standing where a refusal belongs, which is the signature
      // every defect in this tree has worn. Caught by `check-bot-wiring` PART E, driven.
      const c = pl.getContent();
      if (!c || typeof c !== "object") return null;
      const users = (c.users && typeof c.users === "object") ? c.users : {};
      const out = Object.create(null);
      for (const id in users) {
        if (typeof users[id] === "number" && isFinite(users[id])) out[id] = users[id];
      }
      return { users: out, usersDefault: (typeof c.users_default === "number") ? c.users_default : null };
    } catch (e) { return null; }
  }

  // Who sits at exactly `level`. The ARRAY is the answer and its length is the count — a caller
  // enforcing "only one" needs to name the other one to say anything useful, and a bare number
  // cannot. `defaultIsLevel` is the honest escape hatch described above: true means the room's
  // default is itself this level, so the list is a floor rather than the whole truth.
  function accountsAtLevel(roomId, level) {
    const pl = allPowerLevels(roomId);
    if (!pl || typeof level !== "number" || !isFinite(level)) return null;
    const who = [];
    for (const id in pl.users) { if (pl.users[id] === level) who.push(id); }
    who.sort();
    return { level: level, who: who, defaultIsLevel: pl.usersDefault === level };
  }

  // THE ONE PLACE THIS NUMBER LIVES. `roomupgrade.js` compares an account's level against it
  // rather than against a literal 100 — J52 was two copies of a requirement, and a fix that added
  // a third would have been the same defect wearing a repair.
  const SPACE_CHILD_LEVEL = 100;
  function spaceChildLevel() { return SPACE_CHILD_LEVEL; }

  function _powerLevels(sendLevel, creatorId, isSpace) {
    const pl = {
      ban: 99,
      kick: 60,
      redact: 100,
      invite: 60,
      state_default: 100,
      users_default: 0,
      events_default: 0,
      events: {
        "m.room.message": sendLevel,
        "m.room.power_levels": 60
      }
    };
    // On the space, adding/removing sub-rooms is pinned at 100 and explicit (so it
    // can't drift even if state_default is ever loosened).
    //
    // ── 100 IS THE HUMAN OWNER, NOT THE `owner` RUNG. THIS SAID "owner-only" AND THAT MISLEADS ──
    // The ladder's top rung is 99 and `atLeast(level, "owner")` is true at 99 AND 100 — see the
    // header in `ranks.js`. So "owner-only" in this app's vocabulary means 99-or-above, and this
    // gate is not that: an account at 99 is refused the write by the HOMESERVER. Measured, not
    // reasoned: `_powerLevels` sets `m.space.child` and `m.space.parent` to 100, and the space is
    // built with `_powerLevels(100, creatorId, true)`.
    //
    // CLOSED AT v322, and the gate now DERIVES this number instead of restating it. The upgrade
    // gate reads `spaceChildLevel()` below, which returns this same constant — so a room whose
    // space rows move takes the gate with it. Filed as J52; the decision recorded in
    // `bot-model.md` §4 is that the bot never drives an upgrade, because `room.upgrade` is a
    // GATES act rather than a settings key and the bot acts only on settings requests.
    if (isSpace) {
      pl.events["m.space.child"] = SPACE_CHILD_LEVEL;
      pl.events["m.space.parent"] = SPACE_CHILD_LEVEL;
    }
    if (creatorId) pl.users = { [creatorId]: 100 };
    return pl;
  }

  // Unencrypted channel — events, checkpoints, settings. These are read-by-all:
  // when spaceId is given, the channel is created with a "restricted" join rule
  // gated on space membership, so ANY member of the space can join it themselves
  // with NO invite. That's what makes channels added later by an upgrade show up
  // in Element and be self-joinable for existing members (uncategorized included)
  // without the owner inviting anyone per-channel. Writing is still gated by power
  // level, not membership. (Chat is NOT created here — it stays invite-only,
  // because chat membership is the rank gate.)
  // ── WHICH BUILDER A ROW GETS, IN ONE PLACE (v322) ────────────────────────────────────────
  // This was a ternary on `kind === "chat"`, WRITTEN TWICE — once in room creation and once in the
  // upgrade path. Two copies of a rule agreed for as long as there were two kinds; the moment a
  // third arrived, a `presence` row added to only one of them would be created as an OPEN channel
  // by whichever site the author did not edit. That is the shape J15 measured: a rule enforced at
  // one door out of two, correct everywhere its author looked.
  //
  // A TABLE RATHER THAN A CHAIN, so adding a kind is adding a row and the default is explicit.
  function _builderFor(kind) {
    if (kind === "chat") return _createChatChannel;
    if (kind === "presence") return _createPresenceChannel;
    return _createOpenChannel;
  }

  // ── THE PRESENCE CHAT — INVITE-ONLY, WHICH NO OTHER CHANNEL IS ───────────────────────────
  // Every other channel is `restricted` to the space: anybody in the room can join it themselves,
  // and rank decides only what they may WRITE. This one inverts that. Membership is the gate, the
  // owner bot holds it, and `join_rule: invite` is what makes the bot's decision the only way in —
  // without it a person the bot had just removed could walk straight back through the space.
  //
  // ENCRYPTED and `history_visibility: joined`, like the other chats, and here the second one is
  // load-bearing rather than conventional: somebody re-added after a quiet spell must not receive
  // the backlog of what was said while they were considered away.
  //
  // NOT `preset: private_chat` alone. That sets invite for the room, but the space-restricted rule
  // is what the other builders add on top — so this deliberately does NOT add it. A presence
  // channel a space member could join without the bot is not a presence channel.
  async function _createPresenceChannel(name, sendLevel, creatorId, spaceId) {
    const initial_state = [
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" }},
      { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
      { type: "m.room.power_levels",       state_key: "", content: _powerLevels(sendLevel, creatorId) },
      { type: "m.room.encryption",         state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" }},
      // STATED RATHER THAN INHERITED. `private_chat` already implies invite, and writing it here
      // anyway is what makes the difference from the other builders READABLE at the one place a
      // reader compares them — the absence of the `restricted` block below is otherwise silent.
      { type: "m.room.join_rules",         state_key: "", content: { join_rule: "invite" }},
    ];
    const room = await client.createRoom({ name, preset: "private_chat", initial_state });
    return room.room_id;
  }

  async function _createOpenChannel(name, sendLevel, creatorId, spaceId) {
    const initial_state = [
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" }},
      { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
      { type: "m.room.power_levels",       state_key: "", content: _powerLevels(sendLevel, creatorId) }
    ];
    const opts = { name, preset: "private_chat", initial_state };
    // No hash-ref marker is written: every room is hash-ref, so a per-room flag would be a
    // constant dressed as a condition. Nothing reads it any more.
    if (spaceId) {
      // ── THE VERSION PIN ──────────────────────────────────────────────────────────────────
      // Restricted join needs a room version that supports it (v8+). Pinned so the rule is
      // honoured regardless of the server's own default, which is the whole reason a pin exists
      // here rather than a shrug.
      //
      // RAISED FROM v10 TO v11. The pin was at v10 and its shadow was a second read in the raw
      // envelope: room versions up to v10 carry a redaction's target at the TOP level of the
      // event, v11 moved it into `content`. J11 read both, which looked like a compatibility
      // bridge and was not — it was this line, one file away. Old rooms are discardable on
      // upgrade, so there is no migration and nothing is owed to rooms already created, and with
      // creation at v11 the top-level read is reachable from no room this build can make. It is
      // deleted.
      //
      // THE RISK THIS MOVES IS NOT ABOUT ROOMS. A server that does not support v11 FAILS
      // `createRoom` OUTRIGHT — it does not quietly fall back, because the version is requested
      // explicitly — so this raises the floor a self-hosted deployment must meet. v11 is the
      // current default on Synapse (since 1.95) and on Dendrite; a server older than that, or one
      // configured to cap its supported versions, cannot create rooms for this app at all.
      // Discarding old rooms answers every other question here and does not answer this one.
      opts.room_version = "11";
      initial_state.push({
        type: "m.room.join_rules", state_key: "",
        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] }
      });
    }
    const room = await client.createRoom(opts);
    return room.room_id;
  }

  // E2E encrypted channel — chat. Only the UNCATEGORIZED tier (level 0) is open:
  // it's the default everyone uses, so it's created restricted-join (any space
  // member joins with no invite), same as the read-by-all channels. The guest
  // and staff chat tiers stay invite-only because their membership IS the rank
  // gate (guest+ / staff+), applied via assignRank's invite/kick.
  async function _createChatChannel(name, sendLevel, creatorId, spaceId) {
    const initial_state = [
      { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "joined" }},
      { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
      { type: "m.room.power_levels",       state_key: "", content: _powerLevels(sendLevel, creatorId) },
      { type: "m.room.encryption",         state_key: "", content: { algorithm: "m.megolm.v1.aes-sha2" }}
    ];
    const opts = { name, preset: "private_chat", initial_state };
    if (spaceId && sendLevel === 0) {
      opts.room_version = "11";   // restricted join needs v8+; see the pin note in _createOpenChannel
      initial_state.push({
        type: "m.room.join_rules", state_key: "",
        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] }
      });
    }
    const room = await client.createRoom(opts);
    return room.room_id;
  }

  // ── THE SERVERS THAT CAN LET YOU IN ──────────────────────────────────────────────────────
  // `via` on an m.space.child tells a joining client which servers can help it reach the child
  // room. It was hardcoded to "matrix.org", which pinned every room this app creates to one
  // provider UNDERNEATH every other guarantee the project makes: a self-hosted room advertised a
  // server that had never heard of it, so federation had to guess, and a matrix.org outage broke
  // rooms with no relationship to matrix.org at all.
  //
  // The right answer is the room's OWN server — a Matrix room id is `!localpart:server`, and the
  // server that minted the id necessarily has the room. Our own homeserver (from our user id) is
  // the fallback, since we are a member and can therefore be asked. Both are derived, never
  // configured: there is no correct constant here, which is why the constant was wrong.
  function _serverOf(id) {
    const i = (typeof id === "string") ? id.indexOf(":") : -1;
    return (i > 0) ? id.slice(i + 1) : null;
  }
  function _viaFor(roomId) {
    const out = [];
    const home = _serverOf(roomId);
    if (home) out.push(home);
    const mine = _serverOf(getUserId());
    if (mine && out.indexOf(mine) < 0) out.push(mine);
    return out;
  }
  async function _addToSpace(spaceId, roomId) {
    await client.sendStateEvent(spaceId, "m.space.child", { via: _viaFor(roomId) }, roomId);
  }

  // --- Room creation ---
  // Creates the first-build 8-channel DDJP room structure (the space + the
  // CREATION_CHANNELS spec above).
  // Progress reported via onProgress callback after each successful channel creation.
  //
  // Idempotent & resumable: the channels still to build come from creationPlan,
  // deduped against BOTH a caller-supplied partial (`existing`) AND the space's
  // real current children (_liveChannelMap) — so anything a prior attempt already
  // made is skipped instead of duplicated, exactly like createUpgradeBatch.
  // `existing` is { spaceId, channels } from a previous failed run; omit it for a
  // fresh create (the common path). On a fresh create nothing pre-exists, so the
  // plan is the full 8 and behaviour is identical to before.
  //
  // THE PARTIAL IS CONSUMED. On a part-way failure this throws with
  // `e.partial = { spaceId, channels }`, and features/room.js reads it: a retry of the SAME room
  // name resumes and builds only what is missing rather than starting a second Space
  // (`_pendingCreate`, plus `Store.config.savePendingCreate` so it survives a reload).
  // This note previously said "nothing reads it yet" and kept saying so long after that call site
  // existed — a comment describing scaffolding that had already become load-bearing.
  async function createDDJPSpace(name, existing) {
    // Re-entrancy guard — a create is slow (8 creates, possible rate-limit
    // waits). Without this a re-trigger mid-flight could start a second create
    // that snapshots an empty space and duplicates everything (the same class of
    // bug the upgrade guard fixed). The UI also disables the button; this is the
    // code-level backstop.
    if (_creating) throw new Error("MatrixBridge: room creation already in progress");
    _creating = true;
    const creatorId = client.getUserId();
    let spaceId = (existing && existing.spaceId) ? existing.spaceId : null;
    const channels = (existing && existing.channels && typeof existing.channels === "object")
      ? Object.assign({}, existing.channels) : {};

    try {
      // Space — create only if we don't already have one (a resume reuses it).
      if (!spaceId) {
        const space = await client.createRoom({
          name,
          preset: "private_chat",
          creation_content: { type: "m.space" },
          initial_state: [
            { type: "m.room.history_visibility", state_key: "", content: { history_visibility: "shared" }},
            { type: "m.room.guest_access",       state_key: "", content: { guest_access: "forbidden" }},
            { type: "m.room.power_levels",       state_key: "", content: _powerLevels(100, creatorId, true) }
          ]
        });
        spaceId = space.room_id;
        Logger.info("MatrixBridge: space created " + spaceId);
      }

      // Fold the space's real current children into the channel map — ground
      // truth that catches channels a prior failed attempt created but never
      // merged back. Empty on a fresh create (a new space has no children yet),
      // so this is inert on the common path and only does work on a resume.
      const live = _liveChannelMap(spaceId);
      for (const key in live) if (!channels[key]) channels[key] = live[key];

      // What's left to build, in spec order. Already-present channels count
      // toward progress so a resumed bar starts where it left off.
      const plan = creationPlan(channels);
      let completed = plan.done;
      if (completed > 0) _reportProgress(completed, "resuming");

      for (const it of plan.todo) {
        const label = channelName(it.kind, it.slug);
        await _delay();
        const _build = _builderFor(it.kind);
        const create = () => _build(label, it.level, creatorId, spaceId);
        const id = await _createWithRetry(create, label);
        await _addToSpace(spaceId, id);
        channels[it.key] = id;
        completed++;
        _reportProgress(completed, label);
        Logger.info("MatrixBridge: created " + label + " (" + completed + "/" + TOTAL_CHANNELS + ")");
      }

      Logger.info("MatrixBridge: room creation complete — " + TOTAL_CHANNELS + " channels");
      return { spaceId, channels };

    } catch (e) {
      Logger.error("MatrixBridge: room creation failed — " + e.message);
      // No teardown: the partial channels are KEPT so the caller can resume and
      // finish them (Room.create passes `e.partial` back in, createDDJPSpace
      // dedups against it + the live space children, building only what's
      // missing). This is the orphan-proof replacement for the old all-or-nothing
      // _cleanupRooms — which could itself fail under the same rate limit that
      // caused the failure and leave channels stranded with no way back.
      const wrapped = new Error("Room creation interrupted (resumable — retry to finish). " + e.message);
      wrapped.partial = { spaceId, channels };
      throw wrapped;
    } finally {
      _creating = false;
    }
  }

  // User-initiated discard of an interrupted creation. The deliberate, explicit
  // cousin of the auto-teardown that was removed: it only ever runs when the user
  // chooses to abandon a half-built room (never automatically on a failure, where
  // resuming is the right move). Best-effort — leaving can hit the same rate limit
  // that may have interrupted creation, so a failed leave is logged, not fatal;
  // the caller still clears local state so the room stops being tracked. Any rooms
  // that couldn't be left are ordinary empty rooms the user can remove from a
  // standard Matrix client.
  async function discardCreation(spaceId, channels) {
    const ids = [spaceId, ...Object.values(channels || {})].filter(Boolean);
    let left = 0;
    for (const roomId of ids) {
      try { await client.leave(roomId); left++; }
      catch (e) { Logger.warn("MatrixBridge: discard — could not leave " + roomId + ": " + e.message); }
    }
    Logger.info("MatrixBridge: discarded interrupted creation (" + left + "/" + ids.length + " rooms left)");
    return { attempted: ids.length, left };
  }

  // --- Incremental upgrade batches ---
  // Batch 1 (Owner/Player/Uncategorized) is created at room creation. Higher
  // ranks arrive later, one batch at a time, 2h apart (see RoomUpgrade).
  // Upgrade batches, derived from the single CHANNELS table (batch field) so the
  // upgrade spec can never disagree with creation or the rank map.
  const UPGRADE_BATCHES = {
    2: CHANNELS.filter(c => c.batch === 2),
    3: CHANNELS.filter(c => c.batch === 3),
    4: CHANNELS.filter(c => c.batch === 4),
  };

  // Create the channels for one batch. Resumable: channels that already exist
  // are skipped (and counted as done for progress), so a retry after a partial
  // failure completes the rest. Uses the same per-channel delay + retry + progress
  // as room creation. Returns only the newly created { key: roomId } entries.
  // Read the space's ACTUAL current child channels straight from Matrix state,
  // keyed by name ("events-player" -> "events_player") the same way Room.join
  // builds its map. This is ground truth: it reflects exactly what exists in
  // the space right now, including channels created by a previous upgrade
  // attempt that failed before its results were merged into the in-memory map.
  // Using this as the dedup baseline is what makes upgrade resumable and
  // duplicate-proof, the same way room creation is reliable.
  // ── THE SPACE'S OWN CHANNEL LIST, BEFORE THIS CLIENT HAS RESOLVED ANY OF IT ───────────────
  // `_liveChannelMap` below answers "which channels do I hold, keyed by name" and DROPS any child
  // the SDK has no Room for. That filter is right for a map keyed by channel name and wrong for
  // the question "is this room a channel of my space", because the three invite-only channels are
  // exactly the ones a member has not resolved yet: `getRoom` answers null for a room you are
  // neither in nor invited to, so `chat-guest`, `chat-staff` and `presence-chat` are absent from
  // every non-member's map and stay absent for the whole room session.
  //
  // That absence is what made `Room.acceptChannelInvites` unable to see a staff invite: it looped
  // over the resolved map, the key was not in it, and the invite `assignRank` had just sent was
  // invisible — silently, because the loop never reached the branch that reports a hold.
  //
  // So this reads the ADVERTISEMENT rather than the resolution. `m.space.child` state keys exist
  // whether or not this client can see the rooms behind them, which is what makes the scope
  // survive not being a member yet.
  //
  // `via` IS THE PRESENCE TEST, not a courtesy check. A child with empty content is a REMOVED
  // child — clearing the content is how a space un-lists a room — so a `via`-less row names a
  // channel that is no longer part of this space. It is the same test the channel-added listener
  // already applies, rather than a second opinion about what a live child looks like.
  // Held by `check-invite-accept`, whose fixture is now the map `join()` really produces plus the
  // advertisement this reads — the two kept apart, because a fixture holding both is what let that
  // guard pass over a reconcile that could not see a staff invite.
  function spaceChildIds(spaceId) {
    const out = [];
    const space = (client && spaceId) ? client.getRoom(spaceId) : null;
    if (!space) return out;
    let children = [];
    try { children = space.currentState.getStateEvents("m.space.child") || []; }
    catch (e) { return out; }
    for (const child of children) {
      const roomId = child && child.getStateKey ? child.getStateKey() : null;
      if (!roomId) continue;
      const content = child.getContent ? child.getContent() : null;
      if (!content || !Array.isArray(content.via) || content.via.length === 0) continue;
      if (out.indexOf(roomId) < 0) out.push(roomId);
    }
    return out;
  }

  function _liveChannelMap(spaceId) {
    const out = {};
    const space = client ? client.getRoom(spaceId) : null;
    if (!space) return out;
    const children = space.currentState.getStateEvents("m.space.child");
    for (const child of children) {
      const roomId = child.getStateKey();
      const room = client.getRoom(roomId);
      if (!room || !room.name) continue;
      // Skip tombstoned/left child rooms — only count ones we're actually in.
      const key = channelKeyFromName(room.name);
      // If two children somehow share a name (the very bug we're fixing),
      // keep the first and ignore the rest so we don't re-create either.
      if (!out[key]) out[key] = roomId;
    }
    return out;
  }

  // Ground-truth "how upgraded is this room": the highest batch whose channels
  // ALL physically exist in the given channel map. This is independent of the
  // upgrade done-markers — so a room whose channels were fully created but whose
  // done-marker never landed (or, pre-pagination, didn't replay) still reads as
  // upgraded and never offers a redundant batch. A partially-created batch does
  // NOT count (so it stays resumable). Batch 1 is the creation baseline.
  // The table's top batch, so the app never carries a copy of the number. `roomupgrade.js` held a
  // literal `3` and a fully upgraded room went on offering an upgrade — the same mistake
  // `highestPresentBatch` below made with `[2, 3]`.
  function maxUpgradeBatch() {
    let max = 1;
    for (const c of CHANNELS) { if (typeof c.batch === "number" && c.batch > max) max = c.batch; }
    return max;
  }

  function highestPresentBatch(channels) {
    if (!channels) return 1;
    let highest = 1;
    // ── THE BATCH LIST IS DERIVED, AND WAS A LITERAL `[2, 3]` (v322) ──────────────────────
    // Batch 4 shipped in `CHANNELS` and in `UPGRADE_BATCHES` and this walker never looked at it,
    // so a room holding EVERY channel reported batch 3 — and the upgrade would go on offering a
    // a batch that was already complete, forever. Driven AT THE TIME, with every channel then
    //
    // defined present, this answered one short — and every guard was green because nothing
    // anywhere read a batch NUMBER.
    //
    // The keys are read from `UPGRADE_BATCHES` and sorted NUMERICALLY, because the object's own
    // key order is string order and would put 10 before 2 the moment a tenth batch existed. So a
    // new batch is picked up by adding a row to `CHANNELS` — which is what the table's own header
    // promises, and what a literal here quietly broke.
    const batchNums = Object.keys(UPGRADE_BATCHES).map(Number)
      .filter((n) => isFinite(n)).sort((a, b) => a - b);
    for (const n of batchNums) {
      const items = UPGRADE_BATCHES[n];
      if (!items || !items.length) continue;
      const allPresent = items.every(it => !!channels[it.key]);
      if (allPresent) highest = n; else break;   // batches are ordered; stop at the first gap
    }
    return highest;
  }

  async function createUpgradeBatch(spaceId, channels, batchN) {
    const items = UPGRADE_BATCHES[batchN];
    if (!items) return {};
    const creatorId = client.getUserId();
    const added = {};
    const total = items.length;
    let completed = 0;
    // Dedup against BOTH the caller's in-memory map AND the space's real,
    // current children. The live map catches channels a prior failed attempt
    // already created but never got merged back — without it, a retry would
    // recreate them, producing duplicate channels of the same name.
    const live = _liveChannelMap(spaceId);
    try {
      for (const it of items) {
        const key = it.key;
        const label = channelName(it.kind, it.slug);
        const existingId = channels[key] || added[key] || live[key];
        if (existingId) {                         // already exists anywhere — resumable skip
          added[key] = existingId;                // make sure the caller learns about it too
          completed++;
          if (_onProgress) _onProgress(completed, total, label + " (exists)");
          Logger.info("MatrixBridge: upgrade skip " + label + " — already exists (" + completed + "/" + total + ")");
          continue;
        }
        await _delay();
        const _build = _builderFor(it.kind);
        const create = () => _build(label, it.level, creatorId, spaceId);
        const id = await _createWithRetry(create, label);
        await _addToSpace(spaceId, id);
        added[key] = id;
        completed++;
        if (_onProgress) _onProgress(completed, total, label);
        Logger.info("MatrixBridge: upgrade created " + label + " (" + completed + "/" + total + ")");
      }
    } catch (e) {
      // Hard failure mid-batch (e.g. rate limit exhausted). Attach whatever we
      // DID create so the caller can persist it — otherwise those channels
      // would be orphaned from the in-memory map and a retry would recreate
      // them (the duplicate-channel bug). Live-dedup also catches them, but
      // persisting keeps the map honest immediately.
      e.partial = added;
      throw e;
    }
    return added;
  }

  // --- Join ---
  async function joinDDJPSpace(spaceId) {
    await client.joinRoom(spaceId);
    // Wait until the Space's children are advertised in synced state (so we know
    // what to join), rather than sleeping a fixed 3s and hoping. Returns as soon
    // as they're present; capped so it can't hang if none ever arrive.
    await waitForSpaceChildren(spaceId, { needJoined: false });
    const space = client.getRoom(spaceId);
    if (space) {
      const children = space.currentState.getStateEvents("m.space.child");
      for (const child of children) {
        try { await client.joinRoom(child.getStateKey()); } catch (e) {}
      }
    }
    Logger.info("MatrixBridge: joined " + spaceId);
    return spaceId;
  }

  // --- Invite ---
  // New members default to Uncategorized (level 0) until promoted. Events,
  // checkpoints, and settings channels are readable by everyone; chat channels
  // are joined by rank, so a fresh member only lands in chat-uncategorized.
  async function inviteToSpace(spaceId, channels, userId) {
    await client.invite(spaceId, userId);
    const level = 0;
    for (const key in channels) {
      const roomId = channels[key];
      if (!roomId) continue;
      const isChat = key.indexOf("chat_") === 0;
      if (isChat && _rankFromKey(key) > level) continue;   // chat above rank — skip
      try { await client.invite(roomId, userId); }
      catch (e) { Logger.warn("MatrixBridge: invite failed for " + roomId + ": " + e.message); }
    }
    Logger.info("MatrixBridge: invited " + userId);
  }

  // --- Promote / Demote ---
  // NOTE: superseded by assignRank below, which is what room.js actually calls
  // (it does full membership reconciliation, not just power levels + chat).

  // --- Send ---
  async function sendMessage(roomId, text) {
    await client.sendMessage(roomId, { msgtype: "m.text", body: text });
  }

  // ── REDACT (J11) ─────────────────────────────────────────────────────────────────────────
  // WHO MAY REDACT WHOM IS DECIDED BY THE HOMESERVER, AND THERE IS NO REDUCER BRANCH FOR IT.
  // This is J14's family exactly: Matrix power levels adjudicate a redaction, the reducer never
  // sees one (chat is Skin — `_routeEvent` skips chat-named rooms before both `EventCache.store`
  // and `StreamManager.ingest`), and a rank gate in front of this call would report *permitted*
  // against nothing. That is the 403 drift `main/10-capabilities.md` exists to prevent, so this
  // function carries NO gate and there is NO `Ranks.GATES` row for redaction. The homeserver
  // answers, and a refusal comes back as a rejected promise the caller reports.
  //
  // WHAT THE LADDER ACTUALLY SAYS, read from `_powerLevels` rather than assumed: `redact: 100`
  // and `events_default: 0`. Redacting SOMEBODY ELSE'S message needs level 100 — owner only.
  // Redacting YOUR OWN needs only permission to send an `m.room.redaction`, which
  // `events_default: 0` grants everyone. So the self case works for every rank today and the
  // moderator case would need the room's power levels changed, not a rank check added. That is a
  // different job from the one the entry defers it to.
  async function redactEvent(roomId, eventId, reason) {
    if (!roomId || !eventId) throw new Error("redactEvent: roomId and eventId are required");
    await client.redactEvent(roomId, eventId, undefined,
      (typeof reason === "string" && reason) ? { reason: reason } : undefined);
  }

  // --- Recent chat messages for the one-shot join backfill ---
  // Returns the most recent `count` chat MESSAGES of a room (the timeline TAIL),
  // oldest->newest. This is the join "peek", not scroll-up paging: a SINGLE bounded
  // scrollback to ensure enough history is loaded (never a paging loop), then we
  // read the tail. Reading the tail is the fix for the old bug where we returned
  // only the freshly-prepended older page and thus MISSED the recent messages that
  // were already in the live timeline. Each event is decrypted if needed; one this
  // device can't decrypt (no room key / sent before this crypto session) comes back
  // failed=true so the renderer hides it rather than showing "Unable to decrypt".
  // Degrades to {messages:[]} on a transport error — never throws. Review-only
  // (SDK timeline + per-event decrypt can't run headlessly).
  async function recentChatMessages(roomId, count) {
    if (!client) return { messages: [] };
    const room = client.getRoom(roomId);
    if (!room || !room.timeline) return { messages: [] };
    const want = count || 10;
    // One bounded fetch (state events in the timeline aren't messages, so over-fetch
    // a little to find `want` actual messages). NEVER loops — present-forward.
    try {
      if (room.timeline.length <= want) await client.scrollback(room, want * 2 + 10);
    } catch (e) {
      Logger.warn("MatrixBridge: chat backfill scrollback failed for " + roomId + ": " + (e && e.message));
    }
    const tl = room.timeline;
    const out = [];
    for (let i = tl.length - 1; i >= 0 && out.length < want; i--) {
      const ev = tl[i];
      try { if (client.decryptEventIfNeeded) await client.decryptEventIfNeeded(ev); } catch (e) {}
      if (!(ev.getType && ev.getType() === "m.room.message")) continue;
      const c = ev.getContent ? ev.getContent() : {};
      if (!c || typeof c.body !== "string") continue;
      const failed = !!(ev.isDecryptionFailure && ev.isDecryptionFailure()) || (c.msgtype === "m.bad.encrypted");
      out.push({
        event_id: ev.getId ? ev.getId() : null,
        sender: ev.getSender ? ev.getSender() : null,
        body: c.body,
        ts: ev.getTs ? ev.getTs() : 0,
        failed: failed,
      });
    }
    out.sort((a, b) => (a.ts || 0) - (b.ts || 0));   // guarantee oldest -> newest by timestamp
    return { messages: out };
  }

  // Witness-bundle cap FALLBACK (used only when settings are absent). The live cap is the log-ordered
  // room setting `receiptsPerMessage` (default 10) — measured to ride
  // well under one Matrix message (~30x margin). Forward-only — raising it never invalidates old bundles.
  const MAX_WITNESSES_PER_BUNDLE = 10;
  // The reducer-accepted set, as a predicate. Vouching only ever protects events that
  // are actually part of the timeline; null (StreamManager absent, e.g. under a unit
  // guard) degrades to type-only rather than making real history unprotectable.
  function _isLegal() {
    try { return (typeof StreamManager !== "undefined" && StreamManager.isLegal) ? StreamManager.isLegal : null; }
    catch (e) { return null; }
  }

  function _bundleCap() {
    try { const s = _mySettings(); return (s && typeof s.receiptsPerMessage === "number") ? s.receiptsPerMessage : MAX_WITNESSES_PER_BUNDLE; }
    catch (e) { return MAX_WITNESSES_PER_BUNDLE; }
  }

  async function sendEvent(roomId, type, content) {
    const stamped = Object.assign({}, content, { t: type, l: tickOutbound(), dv: 2 });
    // HASH-REF EMISSION: commit pHash = Vouch.commitFor(parent body) on any chained event
    // (one that carries `p`), so the parent becomes voucher-verifiable later. dv is pinned at
    // 2 on the literal above rather than bumped inside this block — there is only one wire
    // version now, so writing 1 and conditionally overwriting it would state a fallback that
    // does not exist. This is ADDITIVE and the reducer IGNORES pHash/hv/dv (proven by
    // check-reducer-ignore), and the whole block is best-effort under try/catch — on ANY
    // failure the event still goes out as a normal, valid message, so this can never affect
    // the queue or block a send. Non-chained events (no `p`) carry no pHash.
    try {
      const room = client.getRoom(roomId);
      if (room && typeof ConsensusHash !== "undefined") {
        stamped.hv = ConsensusHash.HV;
        if ("p" in content) {
          let pHash = null;   // null at genesis (p:null) or if we don't hold the parent
          const pid = content.p;
          if (typeof pid === "string" && pid) {
            const parent = EventCache.get(pid);
            if (parent && parent.content && typeof parent.content.body === "string") {
              // ── COMMIT WHAT A RECORD CAN PROVE ─────────────────────────────────────────
              // This stamped contentHash(FULL body), and a vouch record proves the hash of the
              // ACTION plus its position. Those are different values, so nothing a record carried
              // could ever match what the chain had committed.
              //
              // The consequence was silent and total: every record read as `hash-mismatch` — which
              // is treated as a FORGERY, not as "cannot check" — so `repairFrom` skipped all of
              // them and rebuilt nothing, ever. A recovery mechanism that quietly recovers nothing
              // looks exactly like a room where nothing was ever deleted.
              //
              // The action hash is the right commitment for two independent reasons: a record can
              // only reconstruct the action (the envelope is witnessing and position), and hashing
              // the full body is CIRCULAR, since the body contains records that contain hashes.
              pHash = (typeof Vouch !== "undefined" && Vouch.commitFor)
                ? Vouch.commitFor(JSON.parse(parent.content.body))
                : ConsensusHash.contentHash(JSON.parse(parent.content.body));
            }
          }
          stamped.pHash = pHash;
          // Smoke-test diagnostic (safe to keep): confirms emission is committing parent
          // hashes. A play/skip with pHash=null means we did not hold the parent (or it is
          // genesis) — not that emission is off, which is no longer a state that exists.
          // Only the Tier-1 chain (play/skip) is logged to avoid vote/save noise.
          if (type === "ddjp.dj.play" || type === "ddjp.dj.skip") {
            Logger.info("MatrixBridge: hashref " + type +
              " p=" + (typeof pid === "string" && pid ? pid.slice(0, 10) + "…" : "null") +
              " pHash=" + (pHash ? pHash.slice(0, 12) + "…" : "null"));
          }
        }
        // WITNESS BUNDLE (w) + RANK SELF-PROOF (og) — CHAIN-ONLY: attached only to the play/skip
        // chain (votes/saves are §1-floor-covered and witnessed by the NEXT play's bundle). As of
        // docs/consensus/consensus-models.md the bundle is PAYLOAD-BEARING (witness = vouch): each entry is a
        // full compact record {i,l,d,h,r} that lets any holder REGENERATE the event, not merely a
        // fingerprint {i,h,r} that could only PROVE it. Both w and og are hashed into the body (a
        // child's pHash commits them) and the reducer IGNORES both (check-reducer-ignore). Additive
        // + best-effort: a build failure never blocks or alters a send. og is our own channel +
        // channel-origin rank (a self-declaration the live path ignores; carried so a RESTORED
        // event has a rank claim for the future attestation slice).
        if (typeof Vouch !== "undefined" && Vouch.carries(type)) {
          try {
            // SAME selection as the standalone path: deficit-first, random within band,
            // stopping at what is already protected at my rank. This used to be
            // most-recent-N with no rank and no coverage awareness — so in a busy room
            // every carrier piled onto the same newest handful while older uncovered
            // events starved, on the path that carries most of the protection.
            const _held = _heldHere();
            // BOUNDED BY THE FLOOR. The old call had no floor argument at all, so clients kept
            // protecting events a checkpoint had already banked and the work grew with the age of
            // the room. `owed` now REFUSES to answer without it.
            const _owed = Vouch.owed(_held, {
              myRank: _channelRank(room), myUserId: getUserId(), settings: _mySettings(),
              isLegal: _isLegal(),
              floorL: (typeof Floor !== "undefined" && Floor.position) ? Floor.position() : -1,
            });
            stamped.w = Vouch.bundleFor(_held, _owed.targets, _bundleCap());
            _lastCarrierSentAt = Date.now();   // a carrier of mine just went out
            stamped.og = { ch: room.roomId, rk: _channelRank(room) };
          } catch (e) { /* additive — a bundle-build failure never blocks or alters a send */ }
        }
      }
    } catch (e) { /* commitment is best-effort — never block or alter a send */ }
    // WHAT IT SENT, REPORTED BACK (J27). This returned `undefined` and every caller ignored it,
    // which was fine while nothing had to refer to its own send. An import does: the checkpoint it
    // posts must NAME this room's genesis settings event and sit at that event's position, because
    // a floor placed where the log has never been is the pairing fault StreamManager refuses by
    // name. The alternative is waiting for the send to come back through sync and hunting for it,
    // which is a wait on a server dressed as room logic (BEHAVIOUR.md, "patience, not behaviour")
    // and races the very startup it happens during. Transport already holds both values.
    //
    // The Lamport position is OURS at send time and the id is the SERVER's. Nothing here folds
    // either — the event still arrives through sync and is folded there, with the server's stamp,
    // exactly as before. This reports; it does not shortcut the door.
    const res = await client.sendMessage(roomId, {
      msgtype: "m.text",
      body: JSON.stringify(stamped)
    });
    // RECOVERY RIDE-ALONG (Phase 12): after a real spine send, opportunistically post a small
    // ddjp.voucher carrying (a) answers to any pending meritorious requests and (b) a couple of
    // OLD held originals to slowly self-heal history — capped, from our OWN cache only. This is
    // a SEPARATE message (never baked into the hashed body — that would move a vouch target and
    // risk recovery). Best-effort: any failure never affects the real send above.
    try { if ((type === "ddjp.dj.play" || type === "ddjp.dj.skip")) _scheduleSilentRepair(); }
    catch (e) { /* additive — never blocks a send */ }

    return { eventId: (res && res.event_id) ? res.event_id : null, l: stamped.l };
  }

  // ── RECOVERY LIVE LOOP — wires the pure repair pieces onto transport ───────────────────
  // Thin glue: every decision (what is missing, what can be rebuilt, who owes protection) lives in
  // `Vouch` and `Continuity`; this only carries packets. It used to say "the pure Recovery module",
  // and there is no such module — that work was split between those two when the layer was
  // consolidated, and the name survived only here and in one boundaries list.
  function _mySettings() {
    try { const st = StreamManager.getState(); return (st && st.settings) ? st.settings : {}; } catch (e) { return {}; }
  }
  function _myRecoveryRank() {
    try { return getMyRank(_recoveryChannels || null); } catch (e) { return 0; }
  }

  // THE HELD SET FOR THIS ROOM. EventCache is keyed by event id and spans EVERY room and session a
  // client has ever seen — it is the durable store, and is deliberately never reset per room. So
  // every consumer must scope it, and scoping is subtle: a DDJP room is a SPACE whose events arrive
  // across SEVERAL Matrix rooms (one channel per rank). Filtering on a single room id is therefore
  // too NARROW (it drops the other rank channels of this same room), and no filter at all is far
  // too BROAD (it pulls in a previous room's history entirely). The correct scope is: any held
  // event whose room id is one of THIS space's channels. Everything that reads the cache for
  // vouching, repair or checkpoint decisions goes through here, so the scope can't drift apart.
  // ── ASK BACK FOR WHAT WE NEED (the network pager) ────────────────────────────────────────────
  // A client that has forgotten its history and lost its floor must be able to go and GET the stretch
  // it needs to verify a new one. Until this existed the only pager read EventCache, which works when
  // the raw copies are still held and returns nothing when they are not — so a client that had
  // dropped both simply had no route back to a floor.
  //
  // BOUNDED, not a full replay. Pages backwards only until the oldest event in hand sits at or below
  // `fromL`, or the timeline stops growing, or the guard trips. replayRoom pages to genesis on join
  // because it must; this is the opposite case and paging to genesis would defeat the point.
  //
  // Returns REDUCER-SHAPED events, via StreamManager.normalise. The fold silently ignores anything
  // else — an earlier pager handed raw Matrix events straight to the chain check and got an empty
  // fold with no error, which is the failure this codebase is built to refuse.
  // ── THE ROOM'S PLAY HISTORY ────────────────────────────────────────────────────────────────
  // Read through the interface, because `History` is a backend module and features may not reach
  // one directly. Newest first, projected for display exactly as the live fold's was.
  // NO SECOND PROJECTION. `History.recent()` already returns newest-first and already limits —
  // that is its whole read contract. Passing it through projectHistory as well reverses it back to
  // oldest-first, which is the ordering bug two correct functions make between them when each
  // assumes it is the one doing the ordering.
  function roomHistory(limit) {
    try {
      if (typeof History === "undefined") return [];
      return History.recent(limit);
    } catch (e) { return []; }
  }
  function historyCoverage() {
    try { return (typeof History !== "undefined") ? History.coverage() : null; }
    catch (e) { return null; }
  }

  // ── REACH BACK TO THE ROOM'S BEGINNING ─────────────────────────────────────────────────────
  // A client that has just arrived holds a log that starts at its floor, so everything earlier can
  // only come from the homeserver. Without this, "the full history" would quietly mean "the
  // history since I happened to join" — a different claim, and the one a new arrival would notice.
  //
  // Scheduled rather than run inline: it pages the timeline, which is slow and must not sit in
  // front of the room becoming usable. Runs ONCE per room, and is content to fail — a short list
  // is a worse pane, not a broken one, and `coverage()` reports which it is.
  let _historyBackfilled = false;
  let _lastHistCount = -1;

  // ── ONE LINE THAT ANSWERS EVERY QUESTION ABOUT THIS PANE ───────────────────────────────────
  // Whether the feed runs at all, what the fold returned, whether the seed decision was right,
  // and whether entries accumulate. Deduped on the count, so a busy room prints one line per
  // change rather than one per advance.
  function _refreshHistory() {
    try {
      const before = (typeof History !== "undefined") ? History.count() : 0;
      const r = History.refresh();
      const after = History.count();
      if (after === _lastHistCount && !(r && r.refused)) return;
      _lastHistCount = after;
      const cov = History.coverage();
      _tellFoldAboutCoverage(cov);
      const logLen = (StreamManager.getLog() || []).length;
      Logger.info("MatrixBridge: HISTORY " + after + " songs (+" + (after - before) + ")" +
        (r && r.refused ? " REFUSED=" + r.refused : "") +
        " | live log " + logLen + " events | covers " + cov.fromL + ".." + cov.toL +
        (cov.complete ? " (reaches the beginning)" : ""));
    } catch (e) { Logger.warn("MatrixBridge: history refresh: " + (e && e.message)); }
  }

  // ── REACHING BACK IS RE-ARMED BY A TRIM ────────────────────────────────────────────────────
  // The one-shot fires when the room goes live, and at that moment the log may hold only the
  // handful of events replay has delivered so far — the rest arrive over sync afterwards. Worse,
  // a TRIM is the moment the client permanently loses the ability to fold from genesis itself, so
  // it is exactly when reaching back matters and exactly when a one-shot has already been spent.
  function rearmHistoryBackfill() {
    _historyBackfilled = false;
    try { backfillHistory(); } catch (e) {}
  }

  async function backfillHistory() {
    if (_historyBackfilled || typeof History === "undefined") return;
    _historyBackfilled = true;
    try {
      const r0 = History.refresh();                       // whatever the live log already gives us
      if (r0 && r0.refused) Logger.info("MatrixBridge: history — the live log gave nothing (" + r0.refused + ")");

      // ── ASK WHAT WE ALREADY HOLD BEFORE ASKING THE SERVER ──────────────────────────────
      // The SDK is created with NO `store:` option, so its timeline is memory-only and starts
      // empty on every reload — measured, not assumed. Without this step each load re-pages the
      // room's whole history from the homeserver, which on a shared server is the difference
      // between a well-behaved client and one that gets throttled. `EventCache` already holds
      // every raw this client received, durably in IndexedDB and across reloads; nothing was
      // reading it back for the pane.
      //
      // SCOPED TO THIS ROOM. `EventCache` spans every room and session this client has ever seen,
      // and history exists only by FOLDING — a play's videoId is not in its body, it is whatever
      // the reducer pops. Folding two rooms together makes every play name a parent from the
      // other room's chain, which reads as "it did not load far enough" rather than as a fault.
      // The same trap `pageRange` documents one screen down.
      // ── THE STORED TABLE FIRST, BEFORE ANYTHING IS RE-FOLDED ───────────────────────────
      // Rows are derived-and-banked: restoring them is what lets the raw events behind a settled
      // row be dropped at all. Without this the table is recomputed from events every load, the
      // events can therefore never go, and the 5000 cap saves nothing.
      //
      // Best-effort and total: a missing or unreadable table restores to nothing and the rebuild
      // below fills it. Every row is derivable, so losing this costs one re-fold and never a fact.
      try {
        const sid = _currentSpaceId;
        if (sid && typeof Store !== "undefined" && Store.history) {
          const snap = await Store.history.load(sid);
          if (snap) {
            const rr = History.restore(snap);
            if (rr && rr.ok) {
              Logger.info("MatrixBridge: history — restored " + rr.restored +
                " stored song(s); nothing re-folded for them");
            }
          }
        }
      } catch (e) {
        Logger.warn("MatrixBridge: history — stored table not read (" + ((e && e.message) || "unknown") +
          "); rebuilding from held events instead");
      }

      try {
        // THROUGH `_heldHere()`, WHICH IS THE ONE SANCTIONED READER of the durable cache. A second
        // reader is what `check-room-scoping` refuses, and it refused this on the first attempt —
        // correctly: the helper already shares the ingest gate's scope, so the reader and the door
        // cannot disagree about what "here" means, and it degrades to EMPTY rather than to every
        // room. Less evidence, never foreign evidence.
        //
        // Scoping matters more here than almost anywhere, because history exists only by FOLDING:
        // a play's videoId is not in its body, it is whatever the reducer pops. Two rooms folded
        // together make every play name a parent from the other's chain, and the pane shows a
        // handful of rows — which reads as "it did not load far enough" rather than as a fault.
        const held = [];
        for (const raw of _heldHere()) {
          // NORMALISED THROUGH THE INGEST DOOR'S OWN FUNCTION, so a cached raw becomes the same
          // shape a live one does. A second decoder here would be free to disagree about what an
          // event is, which is the failure this tree keeps finding.
          const norm = (typeof StreamManager !== "undefined" && StreamManager.normalise)
            ? StreamManager.normalise(raw) : null;
          if (norm && typeof norm.l === "number") held.push(norm);
        }
        if (held.length) {
          // ── SEGMENT BY SEGMENT, EACH ANCHORED ON A CHECKPOINT ─────────────────────────
          // MEASURED IN A LIVE ROOM: folding all 168 held events as ONE run from genesis produced
          // NINE songs from a room that had played far more. A play does not name its song — the
          // reducer pops it off the head DJ's queue — so a play whose parent was not accepted
          // yields no row, and ONE broken link near the start silently costs every song after it.
          // The pane looked like it had not loaded far enough rather than like it had failed.
          //
          // The break is the same same-position race that put live state on the wrong head. Live
          // state now follows the floor and recovers; this did not, because it re-derived the
          // whole room from the beginning — the exact mistake, in the one layer the fix had not
          // been carried to.
          //
          // A CHECKPOINT IS AN ANSWER, so each stretch is folded FROM the nearest one at or below
          // it instead of from the room's start. A break inside one segment costs that segment
          // and stops there; every later segment re-anchors on its own checkpoint. That is what
          // makes the pane heal locally rather than lose everything downstream of one bad link.
          const cps = [];
          for (const e of held) {
            if (e && e.type === "ddjp.checkpoint" && e.content && e.content.seed &&
                typeof e.content.floorL === "number") {
              cps.push({ l: e.content.floorL, seed: e.content.seed });
            }
          }
          cps.sort((a, b) => a.l - b.l);

          let added = 0, segments = 0;
          // The stretch BELOW the first checkpoint has no seed to anchor on and genesis is the
          // honest reading for it — it really is the room's beginning.
          const bounds = [{ from: -Infinity, seed: undefined }]
            .concat(cps.map((c) => ({ from: c.l, seed: c.seed })));
          for (let i = 0; i < bounds.length; i++) {
            const lo = bounds[i].from;
            const hi = (i + 1 < bounds.length) ? bounds[i + 1].from : Infinity;
            // Strictly above the anchor and at or below the next: the seed already accounts for
            // its own cut, so including it would fold those events twice.
            const seg = held.filter((e) => typeof e.l === "number" && e.l > lo && e.l <= hi);
            if (!seg.length) continue;
            const r = History.ingest(seg, bounds[i].seed);
            added += (r && r.added) || 0;
            segments++;
          }
          Logger.info("MatrixBridge: history — rebuilt from " + held.length + " locally held " +
            "event(s) across " + segments + " checkpoint-anchored segment(s), " + added +
            " song(s) added; the server is asked only for the gap");
        }
      } catch (e) {
        Logger.warn("MatrixBridge: history — local rebuild skipped (" + ((e && e.message) || "unknown") +
          "); falling back to paging the server");
      }

      const cov = History.coverage();
      if (cov && cov.complete) {
        Logger.info("MatrixBridge: history already reaches the room's beginning — " + cov.entries + " songs");
        return;
      }
      // WHERE OUR OWN KNOWLEDGE STARTS. Normally that is what the live log gave us. But a client
      // whose log is a segment it cannot seed reads NOTHING from it, and giving up there would
      // leave the pane empty in exactly the case backfill exists for — so fall back to the oldest
      // position we hold and page everything below it.
      let ceiling = (cov && cov.fromL !== null) ? cov.fromL : null;
      if (ceiling === null) {
        try {
          const live = StreamManager.getLog() || [];
          ceiling = live.reduce((m, e) => (typeof e.l === "number" && (m === null || e.l < m)) ? e.l : m, null);
        } catch (e) { ceiling = null; }
      }
      if (ceiling === null || ceiling <= 0) {
        Logger.info("MatrixBridge: history — nothing below position " + ceiling + " to reach back for (" +
          (cov ? cov.entries : 0) + " songs)");
        return;
      }
      const r = await History.backfill(0, undefined, ceiling);   // from genesis: no seed, none applies
      const after = History.coverage();
      _tellFoldAboutCoverage(after);
      _persistHistory();
      Logger.info("MatrixBridge: history backfill " + (r && r.ok ? "ok" : "failed (" + (r && r.reason) + ")") +
        " — " + after.entries + " songs, " +
        (after.complete ? "back to the room's beginning" : "from position " + after.fromL));
    } catch (e) { Logger.warn("MatrixBridge: history backfill: " + (e && e.message)); }
  }

  // ── BANKING THE TABLE ─────────────────────────────────────────────────────────────────────
  // Written through one function so the two call sites cannot drift, and best-effort because the
  // table is CACHE: a write that fails costs a re-fold next load, never a fact. The pane's own cap
  // has already evicted anything past `History.MAX`, so this stores what the pane holds and no
  // second cap is invented here — two caps on one thing is two answers that eventually disagree.
  function _persistHistory() {
    try {
      const sid = _currentSpaceId;
      if (!sid || typeof Store === "undefined" || !Store.history) return;
      const snap = History.snapshot();
      if (snap && Array.isArray(snap.rows)) Store.history.persist(sid, snap);
    } catch (e) { /* a table that cannot be banked is re-derived next load */ }
  }

  // ── TELLING THE FOLD WHETHER THIS CLIENT'S HISTORY REACHES THE BEGINNING ──────────────────
  // The fold cannot work this out. A client that cannot read a channel is missing those `l` values
  // by design, so no count or contiguity check inside `StreamManager` separates that from a hole —
  // three versions of that test were written and each was wrong, the second of them shipped. This
  // layer is the one paginating backwards, so it is the one that knows, and it says so.
  //
  // WHAT THE FOLD DOES WITH IT: a client whose history is short folds from the floor's seed instead
  // of from the room's beginning. That is strictly MORE CAUTIOUS, which is the condition
  // `check-local-evidence` puts on using a local fact at all — it can never let this client accept
  // something the room would refuse.
  //
  // CALLED FROM EVERY PLACE COVERAGE IS RECOMPUTED, through one function, because two callers each
  // reporting for themselves is the shape this tree keeps finding stale. A boolean or nothing:
  // `coverage()` returning null means we did not learn anything, and saying "short" on no
  // information would send every client to its floor.
  function _tellFoldAboutCoverage(cov) {
    try {
      if (!cov || typeof cov.complete !== "boolean") return;
      if (StreamManager.setHistoryComplete) StreamManager.setHistoryComplete(cov.complete);
    } catch (e) { /* a client that cannot be told keeps the behaviour it had */ }
  }

  async function pageRange(fromL, toL) {
    const out = [];
    try {
      if (!client || typeof client.getRooms !== "function") return out;
      // ── THE SAME SCOPE THE INGEST DOOR USES ────────────────────────────────────────────────
      // `_isSpineChannel` tests the channel NAME, and every DDJP room names its channels the same
      // way — `events-owner`, `checkpoints-owner`, `settings-owner`. So a client that has joined a
      // second room paged BOTH and returned the union, interleaved by position.
      //
      // That is not a partial answer, it is a wrong one. History exists only by FOLDING (a play's
      // videoId is not in its body — it is whatever the reducer pops), and folding two rooms
      // together makes every play name a parent from the other room's chain. The advance lock
      // refuses them and the pane shows a handful of entries, which reads as "it did not load far
      // enough" rather than as a fault.
      //
      // One room at a time is already a rule here and the ingest door already enforces it. The
      // door was scoped and this was not — a rule reached by one of the paths that needed it.
      // Fail-closed with no scope set: an unscoped read IS the mixture.
      const rooms = client.getRooms().filter((r) => {
        try { return _isSpineChannel(r) && inScope(r.roomId); } catch (e) { return false; }
      });
      for (const room of rooms) {
        // ── HOW FAR BACK IS WORTH WALKING ────────────────────────────────────────────────
        // Each scrollback fetches ~100 events and a song costs several of them (the play, two
        // length reports, joins, reactions), so a bound of 40 reached only a few hundred songs —
        // far short of the history cap, and it stopped silently. Derived from that cap instead of
        // pinned, so the two numbers cannot drift apart. The walk still stops the moment it
        // reaches `fromL` or the room runs out, so a short room costs a couple of round trips.
        const cap = (typeof History !== "undefined" && History.MAX) ? History.MAX : 5000;
        const maxPages = Math.max(40, Math.ceil(cap / 20));
        let prev = -1, guard = 0;
        while (guard < maxPages) {
          const oldest = _oldestL(room);
          if (oldest !== null && oldest <= fromL) break;      // we have paged far enough back
          if (room.timeline.length === prev) break;            // no more history exists
          prev = room.timeline.length;
          try { await client.scrollback(room, 100); } catch (e) { break; }
          guard++;
        }
        const rank = _channelRank(room);
        for (const ev of room.timeline) {
          let raw = null;
          try { raw = ev.event || ev; } catch (e) { continue; }
          const norm = (typeof StreamManager !== "undefined" && StreamManager.normalise)
            ? StreamManager.normalise(raw) : null;
          if (!norm || typeof norm.l !== "number" || norm.l < fromL || norm.l > toL) continue;
          if (typeof norm.senderRank !== "number") norm.senderRank = rank;
          out.push(norm);
        }
      }
    } catch (e) {
      Logger.warn("MatrixBridge.pageRange: " + (e && e.message));
      return [];      // a failed fetch returns NOTHING, never a partial range presented as complete
    }
    out.sort((a, b) => (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId)));
    return out;
  }
  function _oldestL(room) {
    let lo = null;
    try {
      for (const ev of room.timeline) {
        const norm = (typeof StreamManager !== "undefined" && StreamManager.normalise)
          ? StreamManager.normalise(ev.event || ev) : null;
        if (norm && typeof norm.l === "number" && (lo === null || norm.l < lo)) lo = norm.l;
      }
    } catch (e) {}
    return lo;
  }

  // The room's start phase runs only AFTER replay, and that is exactly the condition a checkpoint
  // needs — it is a claim about where the room IS. Passed through here because features/ reaches the
  // backend only through this interface, so the engine stays swappable behind it.
  // ── SESSION: the phase machine, attached where the SDK lives ─────────────────────────────
  // Session must never reach for a browser global itself — it is written to run headless — so the
  // one place that legitimately touches `document`, `navigator` and the sync state wires it up.
  //
  // WHY THIS IS THE FIX FOR SLEEP. Before it there was NO wake detection anywhere: no
  // visibilitychange listener, no online/offline listener, and the only sync-state listener was a
  // one-shot at startup that removed itself. A laptop that slept for two hours woke with ~20
  // pending timers and no notion that anything had happened.
  let _sessionWired = false;
  let _floorTrimWired = false;
  let _repageWired = false;
  function _wireSession() {
    if (_sessionWired || typeof Session === "undefined") return;
    Session.attach({
      now: () => Date.now(),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (h) => clearInterval(h),
      headCount: () => { try { return StreamManager.getLog().length; } catch (e) { return 0; } },
      // DERIVED, never pinned — every other wait in this system comes from the room's own turn step,
      // so changing the dial moves them together.
      settleMs: () => {
        try { return Math.floor(Dials.live(_mySettings(), "vouchJitter") / 2); }
        catch (e) { return 500; }
      },
      onVisibility: (fn) => {
        try { document.addEventListener("visibilitychange", () => fn(!document.hidden)); } catch (e) {}
      },
      onConnectivity: (fn) => {
        try { window.addEventListener("online", () => fn(true)); window.addEventListener("offline", () => fn(false)); } catch (e) {}
      },
    });
    // The SDK's ongoing sync state, not the one-shot at startup. This is the signal that a
    // reconnect happened at all.
    try {
      if (client && client.on) {
        client.on("sync", (state) => {
          if (state === "ERROR" || state === "RECONNECTING") Session.connectionLost();
          else if (state === "SYNCING" || state === "PREPARED") Session.connectionBack();
        });
      }
    } catch (e) {}
    Session.start();
    _sessionWired = true;
  }

  // ── SCHEDULER: one place that takes a turn ───────────────────────────────────────────────
  let _schedulerWired = false;
  function _wireScheduler() {
    if (_schedulerWired || typeof Scheduler === "undefined") return;
    Scheduler.attach({
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (h) => clearTimeout(h),
      random: () => Math.random(),
    });
    _schedulerWired = true;
  }

  function setRoomLive(v) {
    // Liveness is Session's question now — one module owns "what phase am I in".
    //
    // NOTHING RESTORES A FLOOR HERE ANY MORE. This used to also load the stored floor, because that
    // check can only run once replay has finished — during wiring it verified against an empty log
    // and failed every time. Moving it here was correct and still not enough: the restore demanded
    // a recompute of every grade, including owner floors adopted on authority which are never
    // computed, so it answered `did-not-recompute` and DELETED the saved floor. The path is gone.
    // A floor is now re-earned on every load from the checkpoints replay delivers — one route
    // instead of two, and the surviving one is the one that worked. See backends/backend1/floor.js.
    if (v === true) {
      // REPLAY IS DONE. Not LIVE directly: a long replay may have a backlog queued behind it, and a
      // client folding a backlog is behind in exactly the way a replaying one is. Let the settle
      // decide.
      try { if (typeof Session !== "undefined") Session.replayFinished(); } catch (e) {}
      // REACH BACK NOW THAT WE KNOW WHERE OUR LOG STARTS. Fire-and-forget on purpose: the room is
      // usable without it and a short history pane is a worse pane rather than a broken one, so
      // this must never sit in front of going live.
      try { backfillHistory(); } catch (e) {}
    }
  }

  // THE RE-PAGE, from what we still hold. Trimming the derived log does not drop the RAW cache, so a
  // client that has forgotten its fold can usually rebuild from EventCache with no network at all.
  // Falling straight to the network would make the common case slow; never falling to it leaves a
  // client that dropped both with no route back to a floor.
  function _localPager() {
    return async function (fromL, toL) {
      try {
        const out = [];
        // THROUGH THE ONE HELPER. EventCache spans every room and session this client has ever
        // seen, and the correct scope is subtle: a DDJP room is a SPACE whose events arrive across
        // SEVERAL Matrix rooms, so filtering on one room id is too NARROW and no filter at all is
        // far too BROAD. Reading the cache directly here was a second scope that could drift from
        // the first — caught by check-room-scoping, which exists for exactly this.
        for (const raw of _heldHere()) {
          const ev = (typeof StreamManager !== "undefined" && StreamManager.normalise)
            ? StreamManager.normalise(raw) : null;
          if (!ev || typeof ev.l !== "number" || ev.l < fromL || ev.l > toL) continue;
          out.push(ev);
        }
        out.sort((a, b) => (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId)));
        if (!out.length || out[0].l > fromL) {
          try {
            const fetched = await pageRange(fromL, toL);
            if (Array.isArray(fetched) && fetched.length > out.length) return fetched;
          } catch (e) { /* a failed fetch is not a reason to adopt on less */ }
        }
        return out;
      } catch (e) { return []; }
    };
  }

  // ── DISPLAY ATTRIBUTION — deliberately NOT a consensus concern ───────────────────────────
  // Which voucher to NAME in the integrity flag: highest rank, then most recent. Ported here rather
  // than into `vouch.js` when the consensus modules merged, because this picks a face to show a
  // human and nothing computed depends on it. Putting a display choice behind the trust seam would
  // make it look like a rule.
  //
  // The tie-break matters only for stability: the same set must always name the same voucher, or
  // the flag flickers between equals as messages arrive in different orders.
  function _selectVoucher(vouchers) {
    const list = Array.isArray(vouchers) ? vouchers.filter(Boolean) : [];
    let best = null;
    for (const v of list) {
      if (best === null) { best = v; continue; }
      const vr = typeof v.rank === "number" ? v.rank : 0;
      const br = typeof best.rank === "number" ? best.rank : 0;
      if (vr > br) { best = v; continue; }
      if (vr === br && (typeof v.ts === "number" ? v.ts : 0) > (typeof best.ts === "number" ? best.ts : 0)) best = v;
    }
    return best;
  }

  // DEDUP BY SOURCE. One person submitting the same bytes twice is one voucher — the same
  // distinct-people rule the bars use, for the same reason: repetition must not look like breadth.
  function _addVoucherRecord(rec, v) {
    const out = Object.assign({ eventId: v && v.eventId, vouchers: [] }, rec || {});
    out.vouchers = Array.isArray(out.vouchers) ? out.vouchers.slice() : [];
    if (v && v.from !== undefined && out.vouchers.some((x) => x.from === v.from)) return out;
    if (v) out.vouchers.push({ from: v.from, rank: v.rank, ts: v.ts });
    out.representative = _selectVoucher(out.vouchers);
    return out;
  }

  // ── WHICH MATRIX ROOMS ARE MINE RIGHT NOW ────────────────────────────────────────────────
  // A DDJP room is a SPACE: several Matrix rooms, one channel per rank. Sync delivers events from
  // every room in every Space this client belongs to, and for a long time all of them were folded
  // into whatever room happened to be active — including before any room was chosen at all.
  //
  // Two faults came out of that, seen together in a live two-room session and looking unrelated
  // until the logs were read side by side. The Lamport clock reads the highest position it HOLDS,
  // so a brand-new room opened its numbering at 91 because another room had reached 93. And
  // And every event's rank is the CHANNEL it arrived on, so the other room's owner arrived here as
  // an owner. Positions order the room and rank decides who may act; neither is a small thing to
  // import from a stranger. (This named the seed's `rankByUser` map, which no longer exists —
  // the hazard is unchanged without it, because rank is read per event rather than accumulated.)
  //
  // Kept SEPARATE from `_recoveryChannels` on purpose. That is checkpoint-recovery state, set late
  // by wireCheckpoints; this is "which room am I in", needed from the moment the room is known and
  // before replay. It is also the thing that lifts: backend-selection.md §4 puts discovery and the
  // room list in shared bootstrap and only consensus per-room, so when the registry/binder lands,
  // setting this becomes part of `bind()` and nothing else moves. A scope carrying checkpoint
  // concerns could not make that trip.
  //
  // FAIL CLOSED (CONCEPTS.md §3.2 — state the direction): no room bound means NOTHING is ours.
  // Replay is how this room's history legitimately arrives, so refusing unscoped events costs
  // nothing; admitting them cost the spine.
  let _activeScope = null;

  function setRoomScope(channels) {
    const s = Object.create(null);
    let n = 0;
    if (channels) {
      for (const k in channels) {
        const id = channels[k];
        if (id && typeof id === "string" && !s[id]) { s[id] = 1; n++; }
      }
    }
    _activeScope = n ? s : null;    // REPLACES, never merges — an in-app room switch must not
    return n;                       // leave the room we just left feeding this one from sync
  }
  function clearRoomScope() { _activeScope = null; }
  function inScope(roomId) {
    return !!(_activeScope && roomId && _activeScope[roomId]);
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
      const ev = client && client.getAccountData && client.getAccountData("m.direct");
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
    if (!client) return [];
    const me = getUserId();
    const out = [];
    let rooms = [];
    try { rooms = client.getRooms() || []; } catch (e) { return []; }
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
    if (!client || !roomId) throw new Error("acceptDMInvite: no room");
    await client.joinRoom(roomId);
    // Read AFTER joining: before the join the room may not be in the store at all, and a null
    // here would silently skip the record and reproduce the defect for a subset of invites.
    let from = null;
    try {
      const inv = (dmInviteRoomIds() || []).find((i) => i.roomId === roomId);
      from = inv ? inv.from : null;
      if (!from) {
        const room = client.getRoom(roomId);
        const me = getUserId();
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
    if (!client || !roomId) throw new Error("declineDMInvite: no room");
    await client.leave(roomId);
    return roomId;
  }

  // The room id for a conversation with `userId`, or null. Only a room we are still joined to
  // counts: `m.direct` keeps entries for rooms the account has left, and offering one of those
  // as the live conversation sends into a room nobody reads.
  function findDMRoom(userId) {
    if (!userId || !client) return null;
    const list = _directMap()[userId];
    if (!Array.isArray(list)) return null;
    for (const id of list) {
      try {
        const r = client.getRoom(id);
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
    try { await client.setAccountData("m.direct", map); }
    catch (e) { Logger.warn("MatrixBridge: could not record m.direct — " + (e && e.message)); }
  }

  async function createDM(userId) {
    if (!client) throw new Error("MatrixBridge: not logged in");
    if (!userId) throw new Error("MatrixBridge: createDM needs a user id");
    const res = await client.createRoom({
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


  function _heldHere() {
    // ONE SCOPE, ASKED THE SAME WAY EVERYWHERE. This used to return EVERY cached event from every
    // room whenever it could not scope — the shape that put another room's settings and positions
    // into an outgoing vouch bundle (check-room-scoping). Empty is the honest degradation: less
    // evidence, never foreign evidence. It now shares the ingest gate's scope, so the reader and
    // the door can never disagree about what "here" means.
    if (!_activeScope) return [];
    const all = (typeof EventCache !== "undefined") ? EventCache.values() : [];
    return all.filter((r) => r && r.room_id && _activeScope[r.room_id]);
  }

  // SILENT AUTO-REPAIR (nobody ever asks). Regenerate events we're missing from the payload-bearing
  // records we ALREADY hold — Vouch.repairFrom rebuilds each body and gates it on the record's own
  // fingerprint, so a tampered record simply fails. This costs ZERO messages: no request, no answer.
  // Anything we can't rebuild is covered by the cooperative vouching loop, which keeps pushing records
  // for whatever is below the bar — so asking would add traffic without adding reach.
  function _silentRepair(roomId) {
    if (typeof Vouch === "undefined" || typeof EventCache === "undefined") return 0;
    try {
      const held = _heldHere();
      const rebuilt = Vouch.repairFrom(held);
      let n = 0;
      for (const raw of rebuilt) {
        if (EventCache.has && EventCache.has(raw.event_id)) continue;
        // ── AND IF MATRIX STILL KNOWS WHO WROTE IT, PUT IT BACK IN HISTORY ────────────────
        // `repairFrom` restores CONTENT. That alone is restore-material: the reducer keys members,
        // ranks and DJ attribution by SENDER, and a record commits the sender without letting you
        // open the commitment — so a rebuild on its own can never re-enter the fold.
        //
        // The tombstone is the other half. A redaction leaves the event id, the sender and the ROOM
        // ID behind, homeserver-signed, and the room is the channel and the channel is the rank. So
        // where a tombstone exists, the rebuild is a COMPLETE event and belongs in the timeline
        // rather than only in the cache.
        //
        // Without this call the whole mechanism stops one step short: the tombstone is recorded,
        // the content is recovered, and the two are never put together. That is the shape of every
        // bug this project keeps finding — each half correct, the join missing.
        try {
          const whole = Vouch.reconstruct(raw.event_id, held);
          if (whole.ok) {
            EventCache.store(Object.assign({}, whole.event, { room_id: whole.event.room_id || roomId || null }));
            StreamManager.ingest(whole.event);
            n++;
            continue;
          }
        } catch (e) { /* fall through to cache-only restore */ }
        try {
          EventCache.store(Object.assign({}, raw, { room_id: raw.room_id || roomId || null }));
          submitVoucher(raw.event_id, JSON.parse(raw.content.body), "repair");
          n++;
        } catch (e) {}
      }
      if (n) Logger && Logger.debug && Logger.debug("recovery: silently repaired " + n + " event(s) from held records");
      return n;
    } catch (e) { return 0; }
  }

  // Recovery state + the repair pass trigger (idempotent, debounced).
  let _recoveryWired = false;
  let _recoveryRoom = null;       // a channel we can post witness bundles on
  let _recoveryChannels = null;   // the room's channel map (for our rank)
  let _repairTimer = null;
  const _REPAIR_DEBOUNCE_MS = 4000;   // dial: at most one repair pass per this window
  function _scheduleSilentRepair() {
    if (_repairTimer) return;
    _repairTimer = setTimeout(() => {
      _repairTimer = null;
      try { _silentRepair(_recoveryRoom); } catch (e) {}
    }, _REPAIR_DEBOUNCE_MS);
  }
  // THE VOUCHING PASS (transport half; the decisions live in Vouch). On spine activity: work
  // out what I owe (the TrustPolicy cascade), take my slice of it (the three-phase fill), wait my
  // rank's turn (+jitter), RE-CHECK at fire time, then emit a standalone ddjp.witness.bundle —
  // staying silent if the team covered it while I waited. Coverage is read straight from the held
  // bundles, so there is no separate tracking to drift. Best-effort + reducer-inert: a failure here
  // never blocks a send or the queue.
  // A standalone bundle is a PAID message — the ride-along is free. So it fires only when
  // riding along is not available or not fast enough:
  //   BACKLOG — I owe a lot and have not sent a critical event in a long time, so no carrier
  //             of mine is coming to carry the load.
  //   HOLE    — a deletion was detected. That is history actually at risk, so it skips the
  //             queue: no turn wait, jitter only.
  // Routine under-coverage with recent carriers of my own rides along instead and costs
  // nothing. Set by the ingest path when a gap is flagged.
  let _holeSeen = false;
  let _lastCarrierSentAt = 0;
  const _CARRIER_QUIET_MS = 30000;   // "I have not sent a carrier lately"
  const _STANDALONE_BACKLOG = 20;    // owed events that justify paying for a message

  // ONE CALL for "what do I owe", so the free ride-along and the paid standalone can never choose
  // differently — and BOUNDED BY THE FLOOR, which `owed` refuses to answer without.
  function _owedNow(held, myRank, settings) {
    return Vouch.owed(held, {
      myRank: myRank, myUserId: getUserId(), settings: settings, isLegal: _isLegal(),
      floorL: (typeof Floor !== "undefined" && Floor.position) ? Floor.position() : -1,
    });
  }

  // `preStaggered` says the CALLER already waited its turn and already re-checked — which the
  // Scheduler does, since that is what it is for. Without it the rank ladder was applied TWICE on
  // the scheduled path: once by plan(), once by the timer below, so a player waited two full slots
  // instead of one and the inner timer skipped the phase and staleness checks the outer one exists
  // to provide. The fallback path (no Scheduler loaded) still needs the inner stagger, so the wait
  // is dropped rather than the re-check: rebuilding the bundle at send time is what keeps a client
  // silent when the herd covered the gap while it waited.
  function _proactiveWitness(roomId, urgent, preStaggered) {
    // GUARDED ON THE MODULE THAT ACTUALLY DOES THE WORK. This named VouchPolicy and CompactRecord —
    // both merged into Vouch and deleted — so `typeof ... === "undefined"` was permanently TRUE and
    // this function returned on its first line, always. The whole proactive vouching path was dead:
    // no bundles, no protection, no error, nothing in the log to look at.
    //
    // A `typeof` guard naming a module that no longer exists is the worst possible dead branch,
    // because it reads as defensive care. Nothing throws, nothing warns, and the feature is simply
    // absent while every unit guard around it still passes.
    if (typeof Vouch === "undefined" || !roomId) return;
    try {
      const settings = _mySettings();
      const myRank = _myRecoveryRank();
      const og = { ch: roomId, rk: myRank };
      const held = _heldHere();
      const hole = urgent || _holeSeen;
      if (!hole) {
        const quiet = (Date.now() - _lastCarrierSentAt) > _CARRIER_QUIET_MS;
        const owed = _owedNow(held, myRank, settings).targets.length;
        if (!(quiet && owed >= _STANDALONE_BACKLOG)) return;   // a carrier of mine will do this for free
      }
      const plan = { w: Vouch.bundleFor(held, _owedNow(held, myRank, settings).targets, _bundleCap()), og: og };
      if (!plan.w.length) return;                                   // nothing under-covered to cover
      setTimeout(() => {
        try {
          const held2 = _heldHere();
          const fresh = Vouch.bundleFor(held2, _owedNow(held2, myRank, settings).targets, _bundleCap());
          if (!fresh.length) return;                               // herd covered it during our wait — stay silent
          // .catch, not the enclosing try — sendEvent rejects rather than throwing, so that try
          // never saw a send failure. A lost bundle is survivable (the next carrier re-offers what
          // is still owed); an unhandled rejection in the room's most frequent path is not.
          sendEvent(roomId, Vouch.BUNDLE_TYPE, { w: fresh, og: og })
            .catch((e) => Logger && Logger.warn && Logger.warn("Vouch bundle send failed: " + (e && e.message)));
        } catch (e) {}
        // A detected hole skips the RANK ladder — jitter only, so peers still do not fire
        // together, but nobody waits behind an absent senior while history is at risk.
      }, preStaggered ? 0 : (hole
           ? Math.floor(Math.random() * ((settings && settings.vouchJitter) || 1000) / 2)
           : Scheduler.slotMs({
               rank: () => myRank,
               spacing: () => Dials.live(settings, "vouchJitter"),
               ownerOffsetMs: () => (typeof Store !== "undefined" && Store.stagger) ? Store.stagger.offsetMs() : 0,
             })));
      _holeSeen = false;
    } catch (e) {}
  }
  let _proactiveTimer = null;
  const _PROACTIVE_DEBOUNCE_MS = 4000;   // dial: at most one proactive witness pass per this window
  // ── THROUGH THE SCHEDULER ────────────────────────────────────────────────────────────────
  // This was a bare setTimeout, and it is the one job the Scheduler was built for. A raw timer here
  // has three failure modes, all silent:
  //   · it fires after a SLEEP, against a room that moved hours ago
  //   · it acts on the rank the client held when the pass was SCHEDULED, so sleeping through a
  //     promotion publishes under the old rank
  //   · it runs while the client is still draining a backlog, which is not the present
  //
  // The Scheduler answers all three in one place: stale plans are re-planned rather than run, the
  // rank is read at fire time, and only a LIVE client acts. The debounce is carried by minDelayMs
  // below, which the Scheduler applies as a FLOOR on the planned delay. It previously said the
  // debounce was "preserved because planning a name that is already pending coalesces" — but
  // coalescing only suppresses DUPLICATES while a plan is pending, and nothing read minDelayMs, so
  // tier zero planned at delay 0 and the debounce was gone for the client that acts most.
  function _scheduleProactiveWitness() {
    if (!_recoveryRoom) return;
    if (typeof Scheduler === "undefined" || !Scheduler.plan) {
      // No scheduler loaded (partial load): keep the old behaviour rather than stop protecting.
      if (_proactiveTimer) return;
      _proactiveTimer = setTimeout(() => {
        _proactiveTimer = null;
        try { _proactiveWitness(_recoveryRoom); } catch (e) {}
      }, _PROACTIVE_DEBOUNCE_MS);
      return;
    }
    Scheduler.plan("vouch:proactive", {
      rank: () => getMyRank(_recoveryChannels),        // READ AT FIRE TIME, never captured
      spacing: () => { try { return Dials.live(_mySettings(), "vouchJitter"); } catch (e) { return 1000; } },
      minDelayMs: _PROACTIVE_DEBOUNCE_MS,
      // THE RE-CHECK. The stagger creates an observation window; this is the thing that uses it.
      // If the room covered it while we waited, we owe nothing and send nothing.
      stillNeeded: () => {
        if (!_recoveryRoom) return false;
        try {
          const r = Vouch.owed(_heldHere(), {
            myRank: getMyRank(_recoveryChannels), myUserId: getUserId(),
            settings: _mySettings(), floorL: Floor.position(), isLegal: _isLegal(),
          });
          return !!(r && r.targets && r.targets.length);
        } catch (e) { return true; }    // cannot tell -> still act; under-protecting is the worse miss
      },
      run: () => { try { _proactiveWitness(_recoveryRoom, false, true); } catch (e) {} },
    });
  }
  // ── FETCH-BACK ───────────────────────────────────────────────────────────────────────────────
  // Eviction is LOCAL. _evict drops from memory and IDB and never touches Matrix, so the
  // homeserver still holds everything we forget. An event needed later only to VERIFY a claim can
  // therefore be fetched back by id rather than pinned forever: we keep the settings event live
  // state needs, and go and get the older ones a per-song claim refers to, when something actually
  // asks.
  //
  // PURE: what an attempted fetch MEANS. Split out because the SDK call cannot run headless, and
  // because this distinction is the entire point — an event we could not obtain leaves a claim
  // UNVERIFIED, which is not remotely the same as an event that disagrees with it. Collapsing the
  // two would turn every network hiccup into evidence of tampering, and every real tampering into
  // something indistinguishable from a network hiccup.
  //   found       the event, intact. The claim can be checked.
  //   redacted    it existed and was deleted. Gone from the server too — no fetch brings it back,
  //               and this is the one case where our local copy was the last copy.
  //   missing     the server says no such event. Not retryable.
  //   unavailable we could not ask (offline, timeout, history visibility). RETRYABLE — the claim
  //               is unverified for now, not forever.
  function fetchOutcome(raw, err) {
    if (err) {
      const code = (err && (err.errcode || err.name)) || "";
      if (code === "M_NOT_FOUND") return { status: "missing", retryable: false, raw: null };
      return { status: "unavailable", retryable: true, raw: null };
    }
    if (!raw || typeof raw !== "object") return { status: "missing", retryable: false, raw: null };
    const un = raw.unsigned;
    if (un && un.redacted_because) return { status: "redacted", retryable: false, raw: null };
    const c = raw.content;
    const body = (c && typeof c.body === "string") ? c.body : null;
    // A spine event with no body is a redaction we were handed without the tombstone — same
    // meaning, and treating it as "found" would hand the verifier an empty blob to compare against.
    if (!body) return { status: "redacted", retryable: false, raw: null };
    return { status: "found", retryable: false, raw: raw };
  }

  // Bounded, and NEGATIVE results are cached too — a claim referring to an event the server has
  // purged must not re-ask on every verification pass. `unavailable` is deliberately NOT cached:
  // it is the one outcome that can change on its own.
  const _FETCH_CACHE_MAX = 64;
  const _fetchCache = new Map();     // eventId -> outcome
  const _fetchInFlight = new Map();  // eventId -> promise

  async function fetchSpineEvent(eventId, roomId) {
    if (typeof eventId !== "string" || !eventId) return { status: "missing", retryable: false, raw: null };
    // Anything still held locally is the cheapest answer and needs no round trip.
    try {
      if (typeof EventCache !== "undefined" && EventCache.get) {
        const local = EventCache.get(eventId);
        if (local) return { status: "found", retryable: false, raw: local, local: true };
      }
    } catch (e) {}
    if (_fetchCache.has(eventId)) return _fetchCache.get(eventId);
    if (_fetchInFlight.has(eventId)) return _fetchInFlight.get(eventId);

    // The caller names an event, not a room. Which channel it lives in is the bridge's business.
    const room = roomId || (_recoveryChannels && (_recoveryChannels.settings_owner ||
                            _recoveryChannels.events_owner || _recoveryChannels.events_uncategorized)) || null;
    const p = (async () => {
      let raw = null, err = null;
      try {
        // THE SDK EDGE, deliberately one line. Everything that decides anything is above.
        // Unverifiable from a session without lib/ — the meaning of the result is guarded, the
        // call itself is not.
        if (!client || typeof client.fetchRoomEvent !== "function") throw new Error("no client");
        raw = await client.fetchRoomEvent(room, eventId);
      } catch (e) { err = e; }
      const out = fetchOutcome(raw, err);
      if (!out.retryable) {
        _fetchCache.set(eventId, out);
        if (_fetchCache.size > _FETCH_CACHE_MAX) _fetchCache.delete(_fetchCache.keys().next().value);
      }
      _fetchInFlight.delete(eventId);
      return out;
    })();
    _fetchInFlight.set(eventId, p);
    return p;
  }

  // ── SEAL HOLD — the seal-vs-witness race —────────────────────────────────────────────────────
  // A deletion self-heals: the alarm fires, holders re-broadcast, repairFrom rebuilds. But a
  // checkpoint sealing INSIDE that window banks the PRE-REPAIR verdict. Harmless while the full
  // log is held (genesis stays truth), and load-bearing the moment forgetting is switched on —
  // the log that keeps genesis authoritative is exactly what a forget drops.
  //
  // The existing hole gate cannot catch this. Continuity.missingParents follows chain parents (`p`)
  // only, and a declaration — ddjp.play.len { pi, sec } — carries no `p`. It is invisible there
  // BY DESIGN (a witness reference is not a demand), so the seal cannot be gated on detection.
  // It has to wait on TIME instead: one full witness cycle.
  //
  // The cycle is BOTH halves of the round trip, not just the send:
  //     _PROACTIVE_DEBOUNCE_MS   a holder notices and schedules its pass
  //   + vouchJitter / 2          the hole path's jitter (rank ladder skipped, jitter only)
  //   + _REPAIR_DEBOUNCE_MS      WE receive that bundle and debounce before repairing
  //   + _SETTLE_MARGIN_MS        network, ingest, re-derive
  // Stopping at the send half is the easy mistake: the bundle arriving is not the same event as
  // our own state being corrected, and it is our state that gets sealed.
  //
  // DERIVED, never pinned. vouchJitter is a live owner dial (500-5000), so a constant here would
  // be silently wrong the moment it is changed — two hand-maintained copies of one fact, which is
  // the failure docs/paths.md §7 records twice. Checkpoint ASKS; it does not restate.
  const _SETTLE_MARGIN_MS = 1500;
  let _lastHoleAt = 0;
  function witnessCycleMs() {
    let jitter = 1000;
    try {
      const s = _mySettings();
      if (s && typeof s.vouchJitter === "number" && isFinite(s.vouchJitter)) jitter = s.vouchJitter;
    } catch (e) {}
    return _PROACTIVE_DEBOUNCE_MS + Math.floor(jitter / 2) + _REPAIR_DEBOUNCE_MS + _SETTLE_MARGIN_MS;
  }
  // The DECISION, pure and exported: given the clock, are we still inside the cycle? Split out the
  // way IDB's plan helpers are, so the math is exercised directly rather than inferred.
  // PURE. Two bounds, not one, and they answer different questions.
  //
  //   cycleMs   bounds ONE hole. A hole arriving while a hold is active does not extend it
  //             (see holeStampAt) — that stops a BURST buying repeated cycles.
  //   maxHoldMs bounds a RUN of holes. Without it, a hole every cycle re-arms the wait forever:
  //             the burst rule stops one hold being extended, not a stream of new ones starting.
  //             Measured: one redaction per cycle blocked every seal for as long as it continued,
  //             for every client including the owner, because this check runs before the
  //             owner-unstick path can bound anything.
  //
  // That mattered far past sealing. No checkpoints means no floor advancement, which means no
  // forgetting and a log that grows without limit — and a short client that can never be rescued
  // by a floor above its hole. One account, a few events a minute, no damage to any history.
  //
  // The cap is not a new policy. The writer of this hold already reasoned that "against a
  // determined attacker we were always going to lose something; the question is only whether we
  // lose the event or the room" — and then, with no cap, lost the room. This completes that
  // reasoning: wait for repair, and when the wait has gone on long enough, proceed and SAY SO.
  function sealHoldDecision(lastHoleAt, now, cycleMs, runSince, maxHoldMs) {
    if (!lastHoleAt) return { hold: false, remainingMs: 0, cycleMs: cycleMs, capped: false };
    const remainingMs = (lastHoleAt + cycleMs) - now;
    if (remainingMs <= 0) return { hold: false, remainingMs: 0, cycleMs: cycleMs, capped: false };
    // The aggregate bound. Reported as `capped` rather than silently released, because a seal that
    // happens over an unrepaired hole is a different event from a clean one and a caller that
    // cannot tell them apart cannot report it either.
    if (typeof maxHoldMs === "number" && maxHoldMs > 0 && runSince && (now - runSince) >= maxHoldMs) {
      return { hold: false, remainingMs: 0, cycleMs: cycleMs, capped: true };
    }
    return { hold: true, remainingMs: remainingMs, cycleMs: cycleMs, capped: false };
  }
  // Asked by Checkpoint before every seal, OWNER INCLUDED. hold:true means a hole was
  // flagged recently enough that a repair may still be in flight — defer, and do not advance the
  // seal baseline.
  //
  // ASKING IS READ-ONLY. Clearing the clock here would look like an obvious tidy-up and would
  // half-disable the gate in silence: the first seal defers, the second sails through. That is the
  // `earnsForget` shape — a rule that is present, correct, and not doing its job. There is nothing
  // to clear; the clock lapses on its own and `resetCheckpoints` owns the room boundary.
  // HOW LONG IS LONG ENOUGH TO STOP WAITING? Continuity already answers that for the same
  // situation — a gap it has waited STUCK_CYCLES for is reported stuck, because at that point the
  // event is not coming. One definition, two readers: this consults it rather than restating a
  // number, so raising the patience of one raises the patience of both.
  function maxSealHoldMs() {
    const cycles = (typeof Continuity !== "undefined" && typeof Continuity.STUCK_CYCLES === "number")
      ? Continuity.STUCK_CYCLES : 6;
    return cycles * witnessCycleMs();
  }
  let _holdRunSince = 0;      // when the current UNBROKEN run of holding began
  function sealHoldForWitness(now) {
    return sealHoldDecision(_lastHoleAt, (typeof now === "number") ? now : Date.now(),
                            witnessCycleMs(), _holdRunSince, maxSealHoldMs());
  }
  // Guard seam. The clock's only production writer (`_flagIntegrity`) is reachable only through
  // the SDK-facing router, which cannot run headless — so without this the read-only property
  // above could only be asserted as TEXT, and a text assertion already let one mutation through
  // this session. Stamps the clock and nothing else.
  function _setHoleClockForTest(at) { _lastHoleAt = (typeof at === "number") ? at : 0; }

  // On spine activity: detect gaps to REQUEST (reactive) AND proactively WITNESS the least-covered
  // events we hold (Step 3c-3e). Both debounced + rank-staggered so the herd collapses to ~one.
  function _onSpineForGaps() { _scheduleSilentRepair(); _scheduleProactiveWitness(); }
  function wireRecovery() {
    if (_recoveryWired) return;
    if (typeof StreamManager !== "undefined" && StreamManager.on) {
      // an incoming bundle may carry records that repair us
      StreamManager.on(Vouch.BUNDLE_TYPE, _onSpineForGaps);
      StreamManager.on("ddjp.dj.play", _onSpineForGaps);
      StreamManager.on("ddjp.dj.skip", _onSpineForGaps);
      _recoveryWired = true;
    }
  }
  // `_repairNow()` stood here: a one-line wrapper over `_silentRepair`, exported, and called by
  // nothing. Its comment said recover-before-seal used it. Recover-before-seal actually runs
  // through the hold clock and `_scheduleSilentRepair`, so the comment named a consumer that did
  // not exist — worse than being unused, because it taught the next reader that a path was
  // handled. Deleted in J05 rather than wired: the behaviour it describes already happens.

  // Reset the reliability modules' per-room state on a room change (called by room.js via the
  // interface). Clears Floor's trusted checkpoint + seal baseline and the recovery queue/
  // timer, so nothing from a previous room leaks into the next. Listeners are left in place —
  // they're idempotent (_wired / _recoveryWired guards) and channel-independent.
  function resetCheckpoints() {
    try { if (typeof Floor !== "undefined") Floor.reset(); } catch (e) {}
    try { if (typeof Checkpoint !== "undefined") Checkpoint.reset(); } catch (e) {}
    try { if (typeof Continuity !== "undefined") Continuity.reset(); } catch (e) {}
    try { if (typeof History !== "undefined") History.reset(); } catch (e) {}
    _historyBackfilled = false;   // the backfill belongs to the room we just left
    try { if (typeof SettingsProof !== "undefined") SettingsProof.reset(); } catch (e) {}
    // A SETTINGS READ-BACK IN FLIGHT BELONGS TO THE ROOM WE JUST LEFT. Its continuation already
    // refuses to act once the space id has moved, but the LATCH is per-room too: left set, the next
    // room's first shallow reading would never page, and forgetting would silently never start there.
    _deepeningSettings = false;
    try { if (typeof Vouch !== "undefined") Vouch.forgetTombstones(); } catch (e) {}
    _recoveryRoom = null;
    _recoveryChannels = null;
    clearRoomScope();   // leaving a room: nothing is ours until the next one is bound
    _lastHoleAt = 0;   // SEAL HOLD is per-room; a hole in the room we just left must not defer seals here
    _holdRunSince = 0; // ...and neither must the RUN it belongs to, or the new room inherits a
                       // cap already part-spent by trouble that happened somewhere else
    if (_proactiveTimer) { try { clearTimeout(_proactiveTimer); } catch (e) {} _proactiveTimer = null; }
    // A DELIVERY WE WERE WAITING ON BELONGS TO THE ROOM WE JUST LEFT. The sweep would refuse it
    // anyway — the ingest door is room-scoped — but leaving the map populated keeps a one-second
    // timer alive for a room nobody is in, and per-room state that survives a room change is its
    // own bug class in this tree rather than a matter of taste.
    for (const k in _deferred) delete _deferred[k];
    if (_deferSweep) { try { clearInterval(_deferSweep); } catch (e) {} _deferSweep = null; }
    // LOG DEDUPE KEYS ARE PER-ROOM TOO. Only a line's worth of harm each — a first report
    // suppressed because the room we just left happened to end on the same value — but "per-room
    // state that survives a room change is its own bug class" is a rule here rather than a
    // preference, and a diagnostic that silently skips its first line is a diagnostic you cannot
    // trust at the moment you most need it.
    _lastHistCount = -1;
    _lastSealNote = "";
  }

  // --- Replay existing timeline into StreamManager ---
  async function replayRoom(roomId) {
    const room = client.getRoom(roomId);
    if (!room) return;
    Logger.info("MatrixBridge: replaying " + roomId);
    // Rehydrate the durable raw-event cache (the voucher seam) from IndexedDB
    // BEFORE replay, so a redaction encountered during replay can be refused by
    // restoring the original we held across the reload. Idempotent + RAM-only-safe.
    await EventCache.ensureLoaded();
    // Load the COMPLETE history first. startClient's initialSyncLimit only brings
    // the last N events per room into room.timeline; without paging back to the
    // start, a reload replays a TRUNCATED Spine — the advance-lock chain can't
    // anchor from its p=null genesis, so already-played songs never get shifted
    // out of their buffers and resurface ("past timeline" on reload). Page
    // backwards until the timeline stops growing (no older history) or a hard
    // guard trips, so derive always sees the whole ordered log.
    let reachedStart = false;
    try {
      let prevLen = -1, guard = 0;
      while (room.timeline.length !== prevLen && guard < 200) {
        prevLen = room.timeline.length;
        await client.scrollback(room, 100);
        guard++;
      }
      // The loop ends for two different reasons and only ONE of them means "there is nothing
      // older": the timeline stopped growing. A tripped guard means WE stopped, not the channel.
      reachedStart = (guard < 200);
    } catch (e) {
      Logger.warn("MatrixBridge: scrollback failed for " + roomId + ": " + (e && e.message));
    }
    // ── ONLY THE READER MAY CLAIM IT READ ────────────────────────────────────────────────────
    // SettingsProof can answer "which settings governed this moment" only for positions whose
    // whole settings history it has seen, and reaching the start of the channel is what makes that
    // true for every position. That claim licenses FORGETTING, so it must be made by the code that
    // actually paged — and only when the paging genuinely finished. A failed scrollback is warned
    // and swallowed above, so inferring the claim from "replay was attempted" would license
    // dropping history on a channel we never finished opening.
    if (roomId === _settingsChannelId && reachedStart && typeof SettingsProof !== "undefined") {
      try { SettingsProof.markGenesisReached(); } catch (e) {}
    }
    const channelRank = _channelRank(room);
    const spine = _isSpineChannel(room);
    room.timeline.forEach(event => {
      // Replay honors Spine immutability the same way live routing does: a
      // redacted protocol event is restored from its verified original (or
      // flagged as a gap), and an edited one is read from its original content —
      // never silently dropped or read as the edited/blanked version. This is the
      // path that used to silently lose a redacted event and resurrect old state.
      if (spine) { _ingestSpineEvent(event, room, false); return; }   // REPLAY: fold, never act

      // Defensive legacy path for any non-Spine caller (today replayRoom is only
      // called for events-*/settings-* channels).
      const content = event.getContent();
      let parsedL = 0;
      let parsedType = null;
      if (event.getType() === "m.room.message" && content.body) {
        try {
          const parsed = JSON.parse(content.body);
          if (typeof parsed.l === "number") parsedL = parsed.l;
          if (typeof parsed.t === "string") parsedType = parsed.t;
        } catch (e) {}
      }
      updateInbound(parsedL);   // replayed history must advance our clock too
      const raw = {
        event_id: event.getId(),
        type: event.getType(),
        sender: event.getSender(),
        room_id: room.roomId,
        ts: event.getTs(),
        content,
        l: parsedL,
        senderRank: channelRank,
        unsigned: event.getUnsigned ? event.getUnsigned() : null,
      };
      // recovery transport is never cached (consistent with the live + spine-replay paths)
      if (parsedType !== "ddjp.voucher") EventCache.store(raw);
      StreamManager.ingest(raw);
    });
  }

  function getClient() { return client; }
  function getUserId() { return client ? client.getUserId() : null; }
  function getClock() { return _activeClockRoom ? (_clocks[_activeClockRoom] || 0) : 0; }

  // Set the space's visibility. public = anyone can join the space; private =
  // invite-only. Owner-only — m.room.join_rules is state_default 100, so a
  // non-owner's call is refused by the homeserver (correct). This is the side
  // effect of the ddjp.room.settings `vis` value; the setting itself is the
  // shared truth everyone derives, this is what actually opens/closes the door.
  async function setSpaceJoinRule(spaceId, isPublic) {
    if (!client || !spaceId) return;
    const content = isPublic ? { join_rule: "public" } : { join_rule: "invite" };
    await client.sendStateEvent(spaceId, "m.room.join_rules", content, "");
  }

  // Read the space's current visibility straight from Matrix state — the single
  // source of truth (no DDJP settings event mirrors it). "public" iff the space
  // join rule is public; anything else (invite/restricted/knock/none) = private.
  function getSpaceVisibility(spaceId) {
    const room = client ? client.getRoom(spaceId) : null;
    if (!room) return "private";
    const jr = room.currentState.getStateEvents("m.room.join_rules", "");
    const rule = jr ? jr.getContent().join_rule : null;
    return rule === "public" ? "public" : "private";
  }

  // Join a single channel (used by the auto-join path when a new channel appears
  // in the space). events/checkpoints/settings are restricted-join, so a space
  // member joins with NO invite; chat is invite-only and will simply fail here
  // for anyone not ranked for it (expected — chat membership is the rank gate).
  // Returns true if we're in the room afterward. The caller replays it (room.js
  // routes new events channels through mergeChannels). Waits briefly so the
  // timeline has a chance to sync before the caller reads it.
  async function joinChannel(roomId) {
    if (!client || !roomId) return false;
    try {
      await client.joinRoom(roomId);
    } catch (e) {
      Logger.debug("MatrixBridge: did not join " + roomId + " (expected for rank-gated chat): " + e.message);
      return false;
    }
    await new Promise(r => setTimeout(r, 1000));
    return true;
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
    if (!userId || !client) return null;
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
        const profile = await client.getProfileInfo(userId);
        mxc = profile && profile.avatar_url;
      } catch (e) {
        Logger.debug("Avatar: getProfileInfo failed for " + userId + ": " + e.message);
      }
    }
    if (!mxc) {
      const user = client.getUser ? client.getUser(userId) : null;
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
    const base = client.baseUrl || (client.getHomeserverUrl ? client.getHomeserverUrl() : null);
    const token = client.getAccessToken ? client.getAccessToken() : null;

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
      const legacy = client.mxcUrlToHttp(mxc, AVATAR_SIZE, AVATAR_SIZE, "crop");
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
    if (!client) return { ok: false, reason: "not connected" };
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
      const res = await client.uploadContent(file, { type: file.type, name: file.name || "avatar" }); // no-media-ok: account avatar — account-level exception, never touches the Spine (docs/main/02-architecture.md)
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
      await client.setAvatarUrl(mxc);
    } catch (e) {
      Logger.warn("MatrixBridge: setAvatarUrl failed: " + (e && e.message));
      return { ok: false, reason: "the picture uploaded but updating your profile failed" };
    }
    // 3. Bust our own cache and re-fetch so the new picture appears at once.
    const me = getUserId();
    if (me) { _refetchAvatar(me, mxc); }
    Logger.info("MatrixBridge: avatar updated");
    return { ok: true };
  }

  // Bust the cache and re-notify when a user's profile picture changes live.
  // Called inside start() after the client is ready.
  function _watchAvatarChanges() {
    if (!client) return;
    client.on("RoomMember.membership", (event, member) => {
      // New member joined — pre-warm their avatar (mxc from the membership).
      if (member && member.membership === "join") {
        const mxc = member.getMxcAvatarUrl ? member.getMxcAvatarUrl() : null;
        _refetchAvatar(member.userId, mxc);
      }
    });
    client.on("User.avatarUrl", (event, user) => {
      // Global profile avatar changed — the user object's avatarUrl is fresh.
      if (user && user.userId) _refetchAvatar(user.userId, user.avatarUrl || null);
    });
    client.on("RoomMember.avatarUrl", (event, member) => {
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
      identifier: { type: "m.id.user", user: client.getUserId() },
      password: _loginPassword,
    });
  }

  // Initialise Rust crypto (E2E). Idempotent: a no-op if crypto is already up. Runs the
  // token-refresh-first sequence with a single refresh-and-retry (the token can lapse
  // mid-init). Returns { ok } — startup ignores it (app loads regardless); retryCrypto()
  // uses it for in-place Tier-1 recovery. This is the ONLY place crypto is initialised.
  async function _initCrypto() {
    if (!client) return { ok: false, reason: "no client" };
    if (client.getCrypto && client.getCrypto()) return { ok: true };   // already initialised
    await _ensureFreshToken();
    const uid = client.getUserId();
    const opts = { cryptoDatabasePrefix: _cryptoDbPrefix(uid) };
    try { const pk = await _pickleKey(uid); if (pk) opts.storageKey = pk; } catch (e) {}
    try {
      await matrixcs.loadCrypto();
      await client.initRustCrypto(opts);
      // Default Rust-crypto policy: messages are encrypted to every device in the room,
      // including unverified ones, so a send is never blocked on an unverified device.
      // Cross-signing + recovery-key verification is handled by the Topic 2 flow.
      Logger.info("MatrixBridge: crypto initialised (rust, per-user" + (opts.storageKey ? ", encrypted at rest" : "") + ")");
      return { ok: true };
    } catch (e) {
      Logger.warn("MatrixBridge: crypto init failed once, retrying after token refresh");
      try {
        await _ensureFreshToken(true);
        await client.initRustCrypto(opts);
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
  function cryptoAvailable() { return !!(client && client.getCrypto && client.getCrypto()); }

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
    const crypto = client && client.getCrypto && client.getCrypto();
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
    const crypto = client.getCrypto();
    let privateKey;
    try {
      privateKey = matrixcs.cryptoApi.decodeRecoveryKey(String(recoveryKey || "").replace(/\s+/g, " ").trim());
    } catch (e) {
      throw new Error("That doesn't look like a recovery key.");
    }
    // Validate against the account's default secret-storage key before trusting it.
    const defKeyId = await client.secretStorage.getDefaultKeyId();
    if (!defKeyId) throw new Error("This account has no recovery key set up yet.");
    const keyDesc = await client.secretStorage.getKey(defKeyId);
    const keyInfo = keyDesc ? keyDesc[1] : null;
    const valid = keyInfo ? await client.secretStorage.checkKey(privateKey, keyInfo) : false;
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
    const crypto = client.getCrypto();
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
    const crypto = client.getCrypto();
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
    try { if (client && client.stopClient) client.stopClient(); } catch (e) {}
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

  // Wire live checkpoints (Phase 10). Called by room.js with the room's channel map on enter/
  // rewire. The consensus layer is a BACKEND INTERNAL, so it's wired HERE (backend→backend), not from
  // a feature — features reach the backend only through this interface. The seal is bound to the
  // HIGHEST checkpoints channel we can write to (everyone may seal a personal checkpoint); the
  // owner flag only drives the seal-immediately-on-arrival shortcut.
  // ── THE NEW CONCEPTS, attached where the room context is ─────────────────────────────────
  // Each is written to fail VISIBLY when unwired rather than reach for a global, so this is the
  // one place that hands them what they need.
  // ── SETTINGS PROOF SUPPORT ─────────────────────────────────────────────────────────────────
  // See the wiring note inside _wireConcepts for why these exist and what was absent before them.
  let _settingsProofWired = false;
  let _settingsChannelId = null;

  // Everything the derived log already holds for the settings channel. Replay puts it there, so on
  // join this is the whole channel and no network is touched.
  //
  // Coverage is declared from what was EXAMINED, not from what happened to be found. Settings
  // change rarely, so an empty result is the NORMAL outcome of reading a healthy room — and
  // reporting that as "read nothing" would leave the module permanently unable to answer in the
  // ordinary case. markReadFrom exists for exactly that distinction; using it is the difference
  // between "I looked and there was nothing" and "I never looked".
  function _feedSettingsProofFromLog() {
    try {
      if (typeof StreamManager === "undefined" || typeof SettingsProof === "undefined") return;
      const log = StreamManager.getLog() || [];
      const settings = log.filter((e) => e && e.type === "ddjp.room.settings");
      if (settings.length) SettingsProof.ingest(settings);
      // ── GENESIS IS CLAIMED BY THE READER, NOT HERE ────────────────────────────────────────
      // This used to call markGenesisReached() whenever no floor was set, reasoning that replay
      // pages every Spine channel back to its start. The reasoning was right and the PLACE was
      // wrong: _wireConcepts runs from _initModules, which room.join calls BEFORE
      // _replayAllChannels — so at this moment the log is EMPTY and this claimed to have read a
      // channel it had not opened. It came out right only because replay then happened to fill in
      // behind it, and would have come out wrong the first time a scrollback failed, since that
      // failure is caught and warned rather than thrown.
      //
      // Coverage is a claim about what was EXAMINED. Only the code that did the examining can
      // make it, so replayRoom does (see the settings-channel branch there). Here we state only
      // what we can see: the events we hold, and the boundary below which we hold nothing.
      const fl = (typeof Floor !== "undefined" && Floor.position) ? Floor.position() : -1;
      if (fl >= 0) SettingsProof.markReadFrom(fl);
    } catch (e) { /* a failed feed leaves the verdict unproven, which withholds the licence */ }
  }

  // ── PROVE THE FLOOR'S SETTINGS CLAIM, READING THE FLOOR AT CALL TIME ─────────────────────────
  // Extracted in J35 because it is now called twice — once inline on the floor change, and once
  // after a read-back resolves — and the second call must NOT reuse the first one's values. A plan
  // is a description rather than a snapshot everywhere else in this tree; paging is I/O, so the
  // floor can move or be withdrawn while it is in flight, and proving a claim belonging to a floor
  // we no longer hold would record a verdict about the wrong cut.
  //
  // `atL` IS THE CUT, AND THAT IS THE WHOLE CORRECTNESS OF QUESTION B. The claim being proved is
  // "these were the settings in force at the floor's cut", so the position asked about has to be the
  // cut. Driven (`tools/probes/probe-settings-readback.js`): asking at the log HEAD instead makes a
  // seed whose pointer names a settings event that did not exist at its cut come back `validated`
  // rather than `mismatched` — the one case `check-settingsproof` PART D exists to catch. Do not
  // "improve" this by passing a later position to reach `_canAnswerAt`'s floor branch; that branch
  // closes the gap below the floor using what the floor NAMES, so reaching it here would make the
  // floor its own evidence.
  function _proveFloorSettings() {
    try {
      if (typeof Floor === "undefined" || !Floor.seed) return null;
      const seed = Floor.seed();
      if (!seed) return null;
      if (typeof SettingsProof === "undefined" || !SettingsProof.proveClaim) return null;
      const at = Floor.position();
      return SettingsProof.proveClaim({
        claimed: seed.settings,
        settingsFrom: seed.settingsFrom,
        atL: at,
        floorL: at,
        floorNames: seed.settingsFrom,
      });
    } catch (e) { return null; }
  }

  // ── AND IF THE READING WAS TOO SHALLOW, GO AND GET MORE OF IT (J35) ──────────────────────────
  // A client that replayed every channel to its start can always answer, so this does nothing for
  // it. A client that did NOT — a thin join, or one operating below a trim — holds no settings event
  // from before its window, so `inForceAt` refuses, the verdict stays `unverifiable`, and the forget
  // licence is withheld for the whole session. It fails closed, which is why nothing was broken
  // before this existed; the cost was that forgetting was unavailable to exactly the clients the
  // trust cascade exists to serve.
  //
  // WHETHER PAGING CAN HELP IS SettingsProof's QUESTION, NOT OURS. `needsDeeperRead()` reads its own
  // verdict vocabulary: two reasons mean "my reading does not reach far enough", and `mismatched` —
  // which is conclusive — is deliberately not one of them, because paging for a kinder answer is the
  // retry that verdict exists to forbid. Matching the reason strings here would be a second copy of
  // that vocabulary, and a stale copy reads as "nothing to page for", which looks exactly like a
  // healthy client.
  //
  // TO GENESIS, ONCE. `readBack(0)` is the only bound that makes the answer certain: the alternative
  // — stopping at a trusted floor — is what `_canAnswerAt`'s floor branch does, and it cannot serve
  // the claim of the floor it would be bounding on. It is cheap (the settings channel is quiet and
  // the pager fetches only the stretch below the reading window) and idempotent: once genesis is
  // reached, `needsDeeperRead()` is false and this never fires again.
  //
  // NOT AWAITED, SO NOT try/catch. An async function REJECTS rather than throws, so an enclosing
  // try/catch never runs and the failure becomes an unhandled rejection (roles.md §10b). The chain
  // carries its own handler.
  let _deepeningSettings = false;
  function _deepenSettingsRead() {
    try {
      if (_deepeningSettings) return;                                  // one page at a time
      if (typeof SettingsProof === "undefined" || !SettingsProof.needsDeeperRead) return;
      if (!SettingsProof.needsDeeperRead()) return;
      const forSpace = _currentSpaceId;      // captured to be COMPARED later, never to be used
      _deepeningSettings = true;
      Promise.resolve()
        .then(() => SettingsProof.readBack(0))
        .then((r) => {
          _deepeningSettings = false;
          // THE ROOM MAY HAVE CHANGED UNDER US. Per-room state surviving a room change is its own
          // bug class here (CONCEPTS.md §3.11), and this would prove the old room's floor claim
          // against the new room's reader — which `resetCheckpoints` has already emptied.
          //
          // A RECORDED SURVIVOR (`mutate-settings-readback.js` row 12), and kept deliberately. The
          // pager now refuses to ANSWER for a room we have left, so a stale page arrives here as
          // `page-failed` and the early return below fires first — which makes this line
          // undistinguishable by mutation today. It is not the same check: the pager's protects the
          // READING (the ingest happens inside `readBack`, before anything here runs), this one
          // protects the ACTIONS, and the two are at different stages with different blast radii.
          // Row 13 is what makes this one dominated, so if the pager's scoping is ever removed that
          // row goes red rather than this quietly becoming the only thing standing.
          if (_currentSpaceId !== forSpace) return;
          if (!r || !r.ok) {
            Logger && Logger.debug && Logger.debug(
              "MatrixBridge: settings read-back did not complete (" + ((r && r.reason) || "no-answer") +
              ") — the forget licence stays withheld, and the next floor change will ask again");
            return;
          }
          // PROVE, THEN TRIM — the same order as the inline path, and for the same reason: the trim
          // drops the evidence the proof reads. The floor is re-read inside the prove.
          const v = _proveFloorSettings();
          Logger && Logger.debug && Logger.debug(
            "MatrixBridge: settings read-back reached genesis (+" + (r.added || 0) +
            " event(s)); the floor's settings claim is now " + ((v && v.status) || "unproven"));
          // NO SECOND COPY OF THE LICENCE RULE. Whether the verdict is good enough to forget is
          // `seedLicensesForget`'s question and it asks it itself, so this asks unconditionally
          // rather than re-testing "validated" here and drifting from the one home.
          if (typeof StreamManager !== "undefined" && StreamManager.trimToFloor) StreamManager.trimToFloor();
        })
        .catch((e) => {
          _deepeningSettings = false;
          Logger && Logger.warn && Logger.warn(
            "MatrixBridge: settings read-back threw: " + (e && e.message) +
            " — licence withheld, which is the safe direction");
        });
    } catch (e) { _deepeningSettings = false; }
  }

  // Read the settings CHANNEL directly, for positions we no longer hold. This channel is short —
  // it is not the Spine and must not be treated like it — so a full read is cheap.
  //
  // Honesty about the range IS the job. The caller records coverage from what this returns, and
  // coverage is what licenses forgetting, so a partial read reported as whole would license
  // dropping history on evidence never examined. The scrollback loop ends for two different
  // reasons and only ONE of them means "there is nothing older": the timeline stopped growing. A
  // tripped guard means WE stopped, not that the channel did.
  //
  // ── AND UNTIL J35 THIS SAID SO WITHOUT DOING IT ───────────────────────────────────────────────
  // Every could-not-read case returned `[]` — and `[]` is not "I could not read". To `readBack` it
  // means *I examined the whole range and it was empty*, which is a legitimate and ordinary answer
  // for a channel this quiet. So the paragraph above described a distinction the code did not make:
  // a message naming an action it does not take. Harmless while nothing called `readBack`, and
  // load-bearing the moment J35 wired it. Driven, on a thin client whose floor names a settings
  // event it never held (`tools/probes/probe-settings-readback.js`):
  //
  //     returns []    -> readBack ok, genesis CLAIMED on no evidence, verdict
  //                      `mismatched / named-event-was-superseded` — which §8.1b makes CONCLUSIVE,
  //                      so the room never forgets again and `needsDeeperRead()` correctly stops
  //                      retrying. Permanent, and it accuses an honest room.
  //     returns null  -> readBack `page-failed`, coverage unchanged, verdict stays `unverifiable`,
  //                      retryable, licence withheld.
  //
  // That is the failure LOOP `CONCEPTS.md` §2.5 names — forgetting drops the evidence, and missing
  // evidence then reads as a verdict — reached from a direction nothing was watching. So a failure
  // to read returns `null`, which `readBack` refuses as `page-failed`, and ONLY a range genuinely
  // examined returns an array, empty or not.
  // ── AND IT IS SCOPED TO THE ROOM IT WAS ASKED FOR ─────────────────────────────────────────────
  // Found by mutation, and it is a defect in J35's first shape rather than a nicety. The read-back's
  // own continuation checks the room before it re-proves and re-trims — but `readBack` INGESTS what
  // this function returns before that continuation runs at all. So a page resolving after a room
  // change fed the previous room's settings events into the reader `resetCheckpoints` had just
  // emptied for the new one, and marked genesis reached over them: a reader holding a foreign room's
  // rules while claiming complete coverage, which is the strongest form of the confident wrong
  // answer this module exists to prevent.
  //
  // The check belongs HERE, where the I/O completes, and it is the same rule the ingest door already
  // applies — every DDJP room names its channels identically, so anything ranging over channels has
  // to ask which room is ours (`trust-cascade.md` §14). A stale answer is a could-not-read, so it
  // returns `null` like the others rather than an empty array.
  function _settingsPager() {
    return async function (fromL, toL) {
      const forSpace = _currentSpaceId;
      try {
        if (!_settingsChannelId) return null;      // we do not know the channel: nothing was read
        const room = client.getRoom(_settingsChannelId);
        if (!room) return null;                    // the SDK has no such room: nothing was read
        let prevLen = -1, guard = 0;
        while (room.timeline.length !== prevLen && guard < 200) {
          prevLen = room.timeline.length;
          await client.scrollback(room, 100);
          guard++;
        }
        if (guard >= 200) return null;             // WE stopped, not the channel
        if (_currentSpaceId !== forSpace) return null;   // this answer belongs to the room we left
        const rank = _channelRank(room);
        const out = [];
        room.timeline.forEach((event) => {
          try {
            if (!event.getType || event.getType() !== "m.room.message") return;
            const content = event.getOriginalContent ? event.getOriginalContent() : event.getContent();
            const ev = StreamManager.normalise({
              event_id: event.getId(), type: event.getType(), sender: event.getSender(),
              room_id: room.roomId, ts: event.getTs(), content: content, senderRank: rank,
            });
            if (!ev || ev.type !== "ddjp.room.settings") return;
            if (typeof toL === "number" && isFinite(toL) && ev.l > toL) return;
            if (typeof fromL === "number" && ev.l < fromL) return;
            out.push(ev);
          } catch (e) {}
        });
        out.sort((a, b) => (a.l - b.l) || String(a.eventId).localeCompare(String(b.eventId)));
        return out;                                // genuinely examined — empty here means empty
      } catch (e) { return null; }                 // a throw is not a reading
    };
  }


  function _wireConcepts(channels) {
    try {
      // The settings channel the pager reads. Owner-written by definition, so its channel-origin
      // rank is what SettingsProof.ingest checks a settings event against.
      if (channels && channels.settings_owner) _settingsChannelId = channels.settings_owner;
      if (typeof Floor !== "undefined") Floor.attach({
        log: () => { try { return StreamManager.getLog(); } catch (e) { return []; } },
        settings: () => _mySettings(),
        myRank: () => getMyRank(channels),
        trimmed: () => { try { return StreamManager._trimState() !== null; } catch (e) { return false; } },
        // NO load/save/drop. The floor is not persisted: it is re-earned from arriving checkpoints
        // on every load. Writing one with nothing to read it would be a store with no reader, which
        // is precisely how the restore rule drifted out of agreement with the acceptance rule.
        //
        // LEFTOVER ROWS, RECORDED HERE BECAUSE THE CODE THAT BUILT THE KEY IS GONE. An earlier build wrote
        // a trusted floor to the `kv` store under
        //     IDB.keyFor(null, "checkpoints", "cp:" + (channels.events_uncategorized ||
        //                                              channels.events_player))
        // — one row per room per client. Nothing reads or clears them now and `kv` is uncapped
        // (idb.js scopes its eviction to the bounded image cache), so they persist indefinitely.
        // Inert and non-growing, but not self-clearing. Anyone writing a one-off tidy needs this
        // key shape and there is nowhere else left in the tree to find it.
      });
      if (typeof Continuity !== "undefined") Continuity.attach({
        held: () => _heldHere(),
        floorL: () => { try { return Floor.position(); } catch (e) { return -1; } },
        // THE ONE PARENT THE FLOOR ACCOUNTS FOR. A client that has forgotten below its floor holds
        // advances chaining onto a play it dropped on purpose, and no position can identify an
        // event we do not hold. The floor's seed names it: nowPlaying.pi is the last advance at or
        // below the cut. Without this a trimmed client waits forever for history it deliberately
        // deleted — which is why forgetting could not safely be switched on.
        bankedPi: () => {
          try { const sd = Floor.seed(); return (sd && sd.nowPlaying && sd.nowPlaying.pi) || null; }
          catch (e) { return null; }
        },
        settings: () => _mySettings(),
      });
      if (typeof History !== "undefined") {
        History.attach({
          log: () => { try { return StreamManager.getLog(); } catch (e) { return []; } },
          seed: () => { try { return Floor.seed() || undefined; } catch (e) { return undefined; } },
          pageRange: pageRange,
        });
        // ── AND SOMETHING HAS TO FEED IT ────────────────────────────────────────────────────
        // The module was attached with a log, a seed and a pager, and then fed by nothing — so
        // the pane went on reading the live fold, which is the exact coupling History exists to
        // remove. That was invisible while nothing ever forgot. The moment trimming started
        // running the fold began dropping everything below the floor, and the fold deliberately
        // does not seed its history, so the pane emptied down to the floor.
        //
        // Fed on the events that CHANGE WHICH SONG IS PLAYING — the same three that move the room
        // anywhere else. Refreshing folds one bounded window, not the room's whole life, so this
        // is cheap enough to do on every advance.
        for (const t of ["ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip"]) {
          StreamManager.on(t, _refreshHistory);
        }
      }
      // ── GAINING A FLOOR MEANS FORGETTING BELOW IT ────────────────────────────────────
      // The old engine called trimToFloor inline, right after adopting. Floor only EMITS — which is
      // the better design, because it makes the consequence declarative instead of buried in an
      // adoption path — but an emission nobody subscribes to is a flag nobody reads, and that is
      // this codebase's signature bug. This is the subscriber.
      //
      // StreamManager decides whether it MAY (the grade plus the seed licence); this only says WHEN
      // to ask. Wired once, because Floor's listener list is not cleared on a room change.
      if (typeof Floor !== "undefined" && Floor.onChange && !_floorTrimWired) {
        Floor.onChange(function (ev) {
          if (ev.kind !== "adopted" && ev.kind !== "moved") return;
          // ── THE PANE FOLLOWS THE FLOOR TOO ────────────────────────────────────────────
          // MEASURED IN TWO LIVE CLIENTS OF ONE ROOM: both rebuilt 12 songs from their held events
          // across the same 16 checkpoint-anchored segments — agreeing exactly, because that path
          // derives from the room's settled account. Then one finished with 12 and the other 14.
          // The extra two came from each client's LIVE fold, and those diverge: that room had a
          // same-position race, so one client's head was `$zk7yK…` while the floor banked another.
          //
          // `reconcileFloor` was built to drop rows settled under a floor the cascade no longer
          // selects, AND NOTHING CALLED IT — a heal with no caller, which is the shape this tree
          // keeps finding. It belongs on the same hook the trim uses, because adopting a floor is
          // exactly when a row's provenance goes stale.
          //
          // Rows at or below the cut are untouched — the checkpoint covers them. Only rows ABOVE
          // it, stamped under a replaced answer, are dropped, and the backfill re-reads them from
          // the room rather than from this client's opinion.
          try {
            if (typeof History !== "undefined" && History.reconcileFloor && Floor.sigOf) {
              const f = Floor.current ? Floor.current() : null;
              if (f) {
                const rc = History.reconcileFloor(Floor.sigOf(f), f.floorL);
                if (rc && rc.dropped > 0) {
                  Logger.info("MatrixBridge: history — dropped " + rc.dropped + " row(s) settled " +
                    "under a floor the room has replaced; they will be re-read from the room");
                  _persistHistory();
                }
              }
            }
          } catch (e) { /* a pane that cannot reconcile is stale, not broken */ }
          // ── PROVE BEFORE TRIMMING ────────────────────────────────────────────────────────
          // Order matters and it is not arbitrary. The seed claims which settings were in force
          // at the floor's cut; the evidence for that claim is the settings events at or below
          // the cut — which is exactly what the trim is about to drop. Asking afterwards would be
          // asking a question whose evidence we just destroyed, and getting "cannot tell" for a
          // reason we caused. Prove first, then trim on the answer.
          //
          // The verdict enforces nothing by itself (detection is not response): it moves the
          // FORGET LICENCE and nothing else. A mismatch leaves the room running exactly as it
          // was, simply unable to drop history — which is the safe direction to fail in.
          _proveFloorSettings();   // reads the floor itself; an unproven claim withholds the licence
          try { if (typeof StreamManager !== "undefined" && StreamManager.trimToFloor) StreamManager.trimToFloor(); }
          catch (e) { /* a failed trim is never a reason to reject a floor already verified */ }
          // ── AND IF THE PROOF FAILED FOR WANT OF READING, GO DEEPER AND ASK AGAIN (J35) ───
          // After the trim rather than before it, and it costs nothing: the trim above cannot have
          // dropped anything, because a client that could not prove its claim never had the licence.
          // Paging is I/O, so this returns immediately and finishes on its own — detection is not
          // response, and a floor change must not block on the network.
          _deepenSettingsRead();
          // ACCEPTING SOMEBODY'S FLOOR QUIETS ME. Their snapshot banked this stretch, so mine would
          // say the same thing at a cost. With a live owner this is what leaves the owner as the
          // only client sealing at all — and when the owner goes, nobody's floor is adoptable until
          // enough same-rank peers agree, so the rest come due and substitutes take over with no
          // rule about succession.
          //
          // NOTHING IS STAMPED HERE. It used to write a local `Date.now()` into Checkpoint as a
          // cooldown reset, which meant every page load — adoption happens during replay — declared
          // that this client had just sealed, and refused every cadence tick for a full cooldown
          // afterwards. The quieting is DERIVED now, from the floor itself: the clock reads the
          // floor's own server timestamp and the count reads how much of the log it covers. All
          // this call still does is hand over the count, which needs the log to be measured.
          try {
            if (typeof Checkpoint !== "undefined" && Checkpoint.noteAdopted) {
              const fl = Floor.position();
              // ── ONE SCALE, OR THE COUNT MEANS NOTHING ──────────────────────────────────
              // This banked a RAW log count while maySeal compares it against a COUNTABLE one
              // (the same set Vouch uses to decide what needs protecting, which excludes bundles
              // and the other non-state-changing types). In a healthy room roughly half the log
              // is bundles, so after every adoption `head - _lastSealHead` went deeply NEGATIVE
              // and the count trigger then needed about twice its configured number of new
              // events before firing. Nothing errored: both were plausible integers, and the
              // clock trigger covered for it often enough that the room still sealed eventually.
              // The two numbers have to be measured the same way or their difference is noise.
              const below = (fl >= 0) ? StreamManager.getLog().filter(function (e) { return e.l <= fl; }) : [];
              const banked = Checkpoint._countable ? Checkpoint._countable(below) : below.length;
              // The floor POSITION travels too: it is the scale a trim cannot move, and the
              // count beside it could not survive one (v276).
              Checkpoint.noteAdopted(null, banked, fl);   // no clock: see above
            }
          }
          catch (e) {}
        });
        _floorTrimWired = true;
      }
      // ── LOSING A FLOOR MEANS GOING BACK FOR ANOTHER ──────────────────────────────────
      // The second half of the same lesson. A floor ANNOUNCES `demoted` or `withdrawn` when it
      // weakens — including when the only group that still verifies sits below where this client
      // already computes from, which J02 routed into the same weakening path rather than giving it
      // a third outcome. A client that loses its floor and merely NOTICES is a client that sat
      // there having noticed and done nothing.
      //
      // THE SUBSCRIPTION KEYS ON `kind`, AND THERE IS NO FLAG. `Floor.needsRepage()` and its
      // `_needsRepage` field were named here until J02 deleted them: they were read by nothing in
      // production, because this listener has always used the emission. A flag beside an emission
      // is two answers to one question, and the flag is the one nobody reads.
      //
      // Attempted on room activity rather than immediately, because paging is I/O and detection is
      // not response. The pager reads the raw cache first — trimming the derived log never dropped
      // those — so the common case needs no network at all.
      if (typeof Floor !== "undefined" && Floor.onChange && !_repageWired) {
        Floor.onChange(function (ev) {
          if (ev.kind !== "demoted" && ev.kind !== "withdrawn") return;
          try { Floor.thinJoin(_localPager()); } catch (e) {}
        });
        _repageWired = true;
      }
      // ── SETTINGS PROOF — FEED, COVERAGE, PAGER ────────────────────────────────────────
      // SettingsProof answers "which settings governed this moment", and through that whether it
      // is safe to forget. It could always answer. Nothing ever gave it anything to answer FROM:
      // ingest / markGenesisReached / markReadFrom were reachable only from tests, its pager was
      // the literal `null` below, and so its verdict never left "not-yet-run". Since the forget
      // licence demands "validated", StreamManager.trimToFloor() returned 0 every time it was
      // ever called. The floor was selected, verified, re-validated, graded and adopted — and
      // then nothing was ever dropped below it. Forgetting, which is the entire reason
      // checkpoints and the trust cascade exist, had never once run.
      //
      // Nothing here changes a rule. The module's refusal was correct and honest — it withheld
      // the licence because it genuinely could not tell. This supplies the reading it was
      // waiting for.
      //
      // THE FEED IS THE LOG, NOT NEW TRANSPORT. settings-* is a Spine channel, so its events
      // already arrive through _ingestSpineEvent and are already normalised into StreamManager.
      // A second reader for the live case would be a second definition of "a settings event",
      // free to drift from the first. So live and replay are both served by tapping the stream,
      // and the pager below exists only for the one case the stream cannot cover: reading BELOW
      // what we still hold, after a trim or a thin join.
      if (typeof SettingsProof !== "undefined" && !_settingsProofWired) {
        SettingsProof.attach({
          now: () => Date.now(),
          pageSettings: _settingsPager(),
        });
        _feedSettingsProofFromLog();                      // whatever replay already put in the log
        if (typeof StreamManager !== "undefined") {
          StreamManager.on("ddjp.room.settings", function (entry) {
            try { SettingsProof.ingest([entry]); } catch (e) {}
          });
        }
        _settingsProofWired = true;
      }
    } catch (e) { Logger && Logger.warn && Logger.warn("MatrixBridge: _wireConcepts: " + (e && e.message)); }
  }

  // A checkpoint arrived: remember it, then let Floor decide whether it changes anything. Adoption
  // is Floor's, verification is the format's, and neither is this module's business — it only
  // carries the packet.
  let _sealWired = false;
  function _onCheckpointArrived(entry) {
    try {
      const cp = entry && entry.content;
      const rank = (entry && typeof entry.senderRank === "number") ? entry.senderRank : 0;
      const author = (cp && cp.by) || (entry && entry.sender) || null;
      // The event's OWN timestamp, carried in so the floor derived from it can be dated. Server
      // time; the seal cadence measures from it and must never see a device clock.
      if (!Floor.remember(cp, rank, author, entry && entry.ts)) return;
      // An OWNER floor ends the search on authority with no recompute; anything else must chain.
      if (TrustPolicy.tierOf(rank) === 0) {
        Floor.adopt({ floor: Object.assign({ u: author }, cp), tier: 0 });
      } else if (!Continuity.check().corroborated) {
        const sel = Floor.select(Floor._envProbe().myRank, _mySettings(),
          (q) => Floor.chainVerifies(q, StreamManager.getLog()));
        if (sel) Floor.adopt(sel);
      }
    } catch (e) { /* a bad checkpoint is dropped, never fatal */ }
  }
  // ── THE SEAL TRAIL ─────────────────────────────────────────────────────────────────────────
  // Every other decision in this system now says why. This one said nothing, which is why an
  // operator watching a low rank seal in front of a present owner could only infer what happened
  // from timestamps afterwards. Deduped on the verdict, because both triggers fire often and an
  // undeduped line would drown the log in "not-due".
  let _lastSealNote = "";
  // `why` is a LABEL. Used directly as a StreamManager subscriber this receives the event entry
  // instead, which printed "[object Object]" — so the argument is only trusted when it is a string
  // and the subscription passes one deliberately.
  function _onSpineForSeal(why) {
    const _why = (typeof why === "string" && why) ? why : "a room event";
    try { Floor.revalidate(); } catch (e) { /* failing to CHECK is not a reason not to seal */ }
    try {
      const v = Checkpoint.maySeal(Date.now());
      const note = (v && v.ok) ? "DUE" : ("not yet — " + ((v && v.reason) || "?"));
      if (note !== _lastSealNote) {
        _lastSealNote = note;
        Logger.info("MatrixBridge: SEAL asked by " + _why + " — " + note +
          (v && v.sinceFloor !== undefined ? " | since my floor " + Math.round(v.sinceFloor / 1000) + "s" : "") +
          (v && v.cooldownMs !== undefined ? " of " + Math.round(v.cooldownMs / 1000) + "s" : "") +
          (v && v.ladderMs ? " + " + Math.round(v.ladderMs / 1000) + "s for my rung" : "") +
          (v && v.newEvents !== undefined ? " | " + v.newEvents + " new events" : ""));
      }
    } catch (e) {}
    try { Checkpoint.planSeal(); } catch (e) {}
  }

  // The tick that makes the clock trigger reachable. Self-rescheduling rather than setInterval so
  // the period is re-read from the live dial each time: an owner lengthening the cooldown should
  // slow the polling too, and an interval captured at wire time would never notice.
  let _sealTick = null;
  function _sealTickPeriod() {
    try {
      // A quarter of the room's own cooldown, floored so a misconfigured tiny cooldown cannot turn
      // this into a busy loop. Read through Dials so there is no second copy of the number.
      const cd = Dials.live(_mySettings() || {}, "checkpointCooldownMs");
      if (typeof cd === "number" && isFinite(cd) && cd > 0) return Math.max(30 * 1000, Math.floor(cd / 4));
    } catch (e) {}
    return 5 * 60 * 1000;
  }
  function _armSealTick() {
    _sealTick = setTimeout(function () {
      _sealTick = null;
      try { _onSpineForSeal("cadence tick"); } catch (e) {}
      _armSealTick();
    }, _sealTickPeriod());
  }
  function _startSealTick() { if (!_sealTick) _armSealTick(); }
  function _stopSealTick() { if (_sealTick) { clearTimeout(_sealTick); _sealTick = null; } }

  function wireCheckpoints(channels) {
    _wireConcepts(channels);
    if (typeof Checkpoint === "undefined") return;
    try {
      const cpCh = getCheckpointChannelId(channels);
      const amOwner = TrustPolicy.tierOf(getMyRank(channels)) === 0;
      // A SUCCESSFUL SEAL SPENDS THE WAIT. The hole clock is opened for one gap; once a checkpoint
      // has actually landed, that wait has been paid and the next gap must open its own. Cleared HERE
      // rather than where the hold is read, because reading has to stay side-effect-free (see the
      // note on sealHoldForWitness) — and only on success, since a send that failed sealed nothing.
      const sendFn = cpCh ? (async (type, content) => {
        const r = await sendEvent(cpCh, type, content);
        try { noteSealed(); } catch (e) {}
        return r;
      }) : null;
      // Rank for the seal stagger. Injected HERE because this is where the channels map is, and
      // the engine is a backend internal a feature may not reach. Re-injected on every rewire, so
      // a rank change moves the client's slot.
      // Checkpoint EMITS ONLY. Where it seals to, who it is, whether it may — all injected here,
      // because this is where the channel map is and a backend internal is not a feature's to reach.
      Checkpoint.attach({
        now: () => Date.now(),
        log: () => { try { return StreamManager.getLog(); } catch (e) { return []; } },
        held: () => _heldHere(),
        settings: () => _mySettings(),
        myRank: () => getMyRank(channels),
        myUserId: () => getUserId(),
        // The DEVICE, for the seal log only — never for the checkpoint. Two tabs of one account
        // seal independently and both are legitimate; without this the log cannot show that.
        myDeviceId: () => { try { return client && client.getDeviceId ? client.getDeviceId() : null; } catch (e) { return null; } },
        amOwner: () => amOwner,
        isLegal: () => _isLegal(),
        holdForWitness: (now) => sealHoldForWitness(now),
        thin: () => { try { return StreamManager._trimState() !== null; } catch (e) { return false; } },
        // THE SEAL CADENCE MEASURES FROM THE FLOOR I HOLD, not from whatever checkpoint went past.
        // A checkpoint is not a floor — an owner's is one instantly, a peer's needs enough same-rank
        // agreement to clear the room's bar. Both of these read Floor and nothing else, so there is
        // one answer to "am I covered" rather than two that can disagree.
        floorTs: () => { try { return Floor.anchorTs(); } catch (e) { return null; } },
        floorPos: () => { try { return Floor.position(); } catch (e) { return null; } },
        send: sendFn,
      });
      Checkpoint.noteArrival();
      // ── THE CADENCE PULSE — SPINE ACTIVITY *AND* A TICK ──────────────────────────────────
      // This used to be spine activity only, on the reasoning that "a heartbeat would make sealing
      // depend on a clock rather than on the room having actually moved". The reasoning was right
      // and the conclusion did not follow: maySeal has TWO triggers, and the clock one was
      // unreachable. Nothing polled, so the cooldown could only ever be evaluated when a play or
      // skip arrived — which made it a RATE LIMIT on the count trigger rather than a second reason
      // to seal, while a comment in Checkpoint said it "covers a quiet room where the count would
      // never arrive". It could not: nothing asked the clock in a quiet room.
      //
      // What keeps the original concern satisfied is that the TICK only ASKS. It grants nothing.
      // maySeal still refuses unless something countable has actually changed since our last seal
      // or adoption, so a room that is genuinely idle is polled and declines, costing one
      // comparison and no message. Sealing still depends on the room having moved; only NOTICING
      // that it moved no longer depends on it moving again.
      //
      // The period is transport, not a rule: it decides how promptly an expired cooldown is
      // noticed, not whether anything may seal. Derived from the cooldown rather than invented so
      // the two cannot drift — a quarter of it means a due seal waits at most 25% of one cooldown,
      // and a room that lengthens its cooldown automatically polls less.
      if (!_sealWired) {
        StreamManager.on("ddjp.dj.play", _onSpineForSeal);
        StreamManager.on("ddjp.dj.skip", _onSpineForSeal);
        StreamManager.on("ddjp.media.skip", _onSpineForSeal);   // the availability escape moves the
                                                                // room too, and the old engine did
                                                                // NOT listen for it
        StreamManager.on("ddjp.checkpoint", _onCheckpointArrived);
        _sealWired = true;
      }
      // Outside the guard above: the subscriptions are wired once per SESSION, but the tick is
      // stopped on every room change and so must be re-armed on every room entry. _startSealTick
      // is idempotent, so calling it when one is already running is a no-op.
      _startSealTick();
    } catch (e) { Logger && Logger.warn && Logger.warn("MatrixBridge.wireCheckpoints failed: " + (e && e.message)); }
    try {
      // bind a room for vouch bundles: our write channel, or any events channel.
      _recoveryRoom = (channels && (getWriteChannelId(channels) || channels.events_uncategorized || channels.events_owner)) || _recoveryRoom;
      _recoveryChannels = channels || _recoveryChannels;
      wireRecovery();
    } catch (e) { /* recovery is best-effort */ }
  }

  // ── MAY I ADVANCE? — THE ONE QUESTION THE ADVANCE PATH NEVER ASKED ────────────────────────
  // Two rules existed, were correct, were guarded, and were reachable by nothing that advances.
  //
  //   Session   "only a LIVE client authors anything" — its own header names THE STALE-TIMER
  //             ADVANCE as the thing this retires "as a CATEGORY". Scheduler had two call sites,
  //             both in the backend (the vouch pass and the seal); no feature ever asked.
  //   Continuity "a client that knows it is missing history must not advance" — called in exactly
  //             one place, the owner's SEAL gate. It governed whether a snapshot could be
  //             published, never whether a song could be played. Guarding the wrong door.
  //
  // Both live behind this one predicate so features ask a single question through the interface
  // instead of reaching for a backend internal. That is not tidiness: a backend without Continuity
  // (a lite or bot model) must still answer, and the app must not know which model it is talking to.
  //
  // PERMISSIVE ON FAILURE, RESTRICTIVE ONLY ON A DEFINITE NO. An absent module or a thrown check
  // means "I could not establish that anything is wrong", which is not the same as "something is
  // wrong" — and the costs are lopsided. A short client that advances emits an event everyone
  // holding the full history REJECTS (wrong parent), which is inert and self-heals the moment the
  // hole fills, because the reducer is pure and re-derives rather than patching. A client that
  // refuses on a transient error stops playing music. So only a definite "short" or "not-live"
  // blocks; anything unknown proceeds. This mirrors _wholeView's existing choice rather than
  // inventing a second policy for the same question.
  // ── AM I FIT TO AUTHOR AT ALL? ────────────────────────────────────────────────────────────
  // The base question, separate from mayAdvance because it has a different answer for a different
  // set of callers. "Am I caught up" applies to ANY send; "am I whole" applies only to a chained
  // advance, where a missing parent means this client would build on a history nobody shares.
  //
  // It exists because the queue was found sending during replay — the third time a rule the system
  // already had was reached by nothing that needed it. mayAdvance now composes from this rather
  // than restating the phase check, so there is one definition of "caught up" and callers pick the
  // question that matches what they are doing.
  function mayAuthor() {
    try {
      if (typeof Session !== "undefined" && Session.mayAuthor && !Session.mayAuthor()) {
        // WHY, not just NO. "suspended" on its own cannot tell an operator whether the tab is in
        // the background, the connection dropped, or a timer arrived so late the client inferred
        // it had been away — and those need completely different answers from whoever is testing.
        // Session records both; carried out here because features reach the phase machine only
        // through this interface, and a diagnostic nothing surfaces is a diagnostic nobody reads.
        const out = { ok: false, reason: "not-live", state: (Session.phase ? Session.phase() : null) };
        try { if (Session.suspendedBecause) out.because = Session.suspendedBecause(); } catch (e) {}
        try { if (Session.awaitingSignal) out.awaiting = Session.awaitingSignal(); } catch (e) {}
        return out;
      }
    } catch (e) { /* unknown is not a no — see the policy note on mayAdvance */ }
    return { ok: true };
  }

  // A REFUSAL NEEDS A WAY BACK. Anything gated on mayAuthor stops when the client is not live, and
  // whatever it wanted to do has to be retried when it becomes live — otherwise the gate does not
  // defer the work, it drops it. The queue's reconcile is woken by incoming dj.* events, so in a
  // QUIET room a song refused during catch-up could sit unsent until somebody else happened to act.
  // Quiet rooms are the worst case for everything reactive here, and this is one more instance.
  function onAuthorReady(fn) {
    if (typeof fn !== "function") return;
    try {
      if (typeof Session === "undefined" || !Session.onChange) return;
      // ONE OBJECT, NOT TWO ARGUMENTS. Session hands listeners a single
      // `{ from, to, reason, phase }`. Destructured positionally, `to` was permanently undefined
      // and this never fired — so a send refused while catching up was DROPPED rather than
      // deferred, and in a quiet room nothing ever came back for it. The name was spelled in both
      // files, which is all a textual guard can see; only driving the emit shows it.
      Session.onChange(function (ev) {
        if (ev && ev.to === Session.LIVE) { try { fn(); } catch (e) {} }
      });
    } catch (e) {}
  }

  function mayAdvance() {
    const fit = mayAuthor();
    if (!fit.ok) return fit;
    try {
      if (typeof Continuity !== "undefined" && Continuity.mayAdvance) {
        // The floor's banked parent travels with the floor's position — a caller that states one
        // and not the other would be bounded but still short on the event the bound exists for.
        let _banked = null;
        try { const _sd = (typeof Floor !== "undefined" && Floor.seed) ? Floor.seed() : null;
              _banked = (_sd && _sd.nowPlaying && _sd.nowPlaying.pi) || null; } catch (e) {}
        const v = Continuity.mayAdvance(_heldHere() || [], _mySettings() || {},
                                       (typeof Floor !== "undefined" && Floor.position) ? Floor.position() : -1,
                                       _banked);
        // Only a CORROBORATED gap blocks. An uncorroborated one must not, or a single fabricated
        // parent freezes the whole room — Continuity already draws that line, and re-drawing it
        // here would be a second copy of the rule free to disagree with the first.
        if (v && v.state === "short") return { ok: false, reason: "missing-history", state: "short" };
      }
    } catch (e) { /* unknown is not a no */ }
    return { ok: true };
  }

  return {
    login, logout, hasSession, restoreSession,
    mayAdvance, mayAuthor, onAuthorReady,
    listAccounts, getActiveUserId, hasStoredSession, switchAccount, forgetAccount, _registryUpsert, _registryRemove,
    getLoginFlows, startSsoLogin, completeSsoLogin, hasPendingSsoLogin,
    start, waitForSync, waitForSpaceChildren, onRawEvent, offRawEvent, onProgress,
    createDDJPSpace, discardCreation, joinDDJPSpace, inviteToSpace, assignRank, createUpgradeBatch, highestPresentBatch, creationPlan,
    banFromRoom, kickFromRoom, memberActionRooms: _memberActionRooms,
    sendMessage, sendEvent, redactEvent, recentChatMessages, replayRoom, spineRestoreDecision, getIntegrityFlags, onIntegrityFlag, submitVoucher,
    wireCheckpoints, resetCheckpoints, heldHere: _heldHere,
    setRoomScope, clearRoomScope, inScope,
    setDMScope, addDMScope, clearDMScope, inDMScope, dmRoomIds, findDMRoom, createDM,
    dmInviteRoomIds, acceptDMInvite, declineDMInvite,
    sealHoldForWitness, holeStampAt, startsNewHoldRun, noteSealed, pageRange, setRoomLive, sealHoldDecision, witnessCycleMs, startsSealHold,
    deliveryState, deferralExpired, roomHistory, historyCoverage, backfillHistory, rearmHistoryBackfill,
    fetchSpineEvent, fetchOutcome,
    // Guard seam: the SDK client is established by a connect flow that cannot run headless, so
    // without this the caching and de-duplication above could only be asserted as source text.
    _setClientForTest: function (c) { client = c; } /* exposed for the guard */,
    _setHoleClockForTest /* exposed for the guard */,
    _isChatChannel, _isSpineChannel, _recordTombstone, _wireConcepts, _viaFor,
    getRankInfo, getMyRank, getWriteChannelId, getCheckpointChannelId, getRoster, getUserEffectiveRank, desiredMembership: _desiredMembership,
    channelName, channelKey, channelKeyFromName, eventsKeyForLevel, channelTaxonomy, spaceChildIds,
    onRankChange, offRankChange, onRoomsChanged, offRoomsChanged, onChannelAdded, offChannelAdded, joinChannel, setSpaceJoinRule,
    getSpaceVisibility, onVisibilityChange, offVisibilityChange,
    getClient, getUserId, getClock, seedClock,
    // `allPowerLevels` is NOT exported. It exists as the one walk of the power-levels state event
    // and `accountsAtLevel` is the only caller — outside this file nothing wants the raw map, and
    // an export with no call site is indistinguishable from a missing feature while passing every
    // guard. Second one removed this package, after `Capabilities.activityGroups()`. Export it the
    // day something calls it.
    getMyPowerLevel, accountsAtLevel, spaceChildLevel, maxUpgradeBatch,
    joinedMembersOf, invitedMembersOf, amJoined, amInvited, acceptChannelInvite, kickLevelOf, presenceChatKey: _presenceChatKey,
    inviteToPresence, removeFromPresence,
    encryptionStatus, cryptoAvailable, retryCrypto, unlockEncryption, generateRecoveryKey, confirmRecoveryKeyMatches, commitNewRecoveryKey,
    getAvatarUrl, onAvatarChange, offAvatarChange, uploadAvatar
  };
})();
