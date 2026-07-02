// app.js — DDJP bootstrap (externalized from index.html for CSP, Topic 3).
// Wires the YouTube callback, the encryption gate, session restore, and the
// login/logout/create-room handlers. No logic change from the former inline block.

  window.onYouTubeIframeAPIReady = function () { Logger.debug("YouTube API ready"); };

  // --- Encryption gate (Topic 2) ---
  // After login/restore + sync, ensure this device can read encrypted messages
  // before entering the app: the user either enters their existing recovery key
  // (set up in Element) or, as a last resort, creates and saves a new one.
  // Mandatory — no silent skip. Resolves once encryption is sorted; if the crypto
  // layer is unavailable it returns, so the app still loads.
  async function ensureEncryption() {
    let st;
    try { st = await MatrixBridge.encryptionStatus(); }
    catch (e) { Logger.warn("Encryption status check failed: " + (e && e.message)); return; }
    if (!st || !st.ok || st.ready) return;   // crypto unavailable or already verified

    await new Promise((resolve) => {
      const enterFlow = () => Interface.showEnterRecoveryKey({
        onUnlock: async (key) => { await MatrixBridge.unlockEncryption(key); resolve(); },
        onForgot: () => warnFlow(),
        onLogout: async () => { try { await MatrixBridge.logout(); } catch (e) {} location.reload(); },
      });
      const warnFlow = () => Interface.showResetWarning({
        onConfirm: () => createFlow(),
        onBack: () => enterFlow(),
      });
      async function createFlow() {
        let key;
        try { key = await MatrixBridge.generateRecoveryKey(); }
        catch (e) { Logger.error("Generate recovery key failed: " + (e && e.message)); resolve(); return; }
        Interface.showSaveNewKey({
          recoveryKey: key,
          confirmMatch: (typed) => MatrixBridge.confirmRecoveryKeyMatches(typed),
          onConfirm: async () => { await MatrixBridge.commitNewRecoveryKey(); resolve(); },
          onBack: st.hasRecoveryKey ? () => enterFlow() : undefined,
        });
      }
      if (st.hasRecoveryKey) enterFlow(); else createFlow();
    });
  }

  // Restore a saved session if one exists, else show login.
  (async () => {
    // Lock in storage durability before anything relies on it: ask the browser
    // to keep our IndexedDB (otherwise it's best-effort and can be evicted), and
    // surface the resolved mode instead of silently running without persistence.
    try {
      const dur = await Store.durability.lockIn();
      Logger.info("Storage: " + dur.mode + (dur.quota ? " (" + Math.round(dur.usage / 1048576) + "/" + Math.round(dur.quota / 1048576) + " MB)" : ""));
      if (dur.warn) Logger.warn("Storage durability — " + dur.reason);
    } catch (e) { Logger.warn("Storage durability check failed: " + (e && e.message)); }

    // Returning from an SSO redirect (loginToken in the URL)? Complete it before
    // anything else — there's no saved session yet, so restoreSession would just
    // bounce to the login screen.
    if (MatrixBridge.hasPendingSsoLogin()) {
      try {
        await MatrixBridge.completeSsoLogin();
        await Store.account.setUser(MatrixBridge.getUserId());
        await MatrixBridge.start();
        await MatrixBridge.waitForSync();
        await ensureEncryption();
        Interface.showScreen("screen-rooms");
        Interface.renderRoomList(Room.scanDDJPRooms());
      } catch (err) {
        Logger.error("SSO login failed: " + (err && err.message));
        Interface.showScreen("screen-login");
        const le = document.getElementById("login-error");
        if (le) { le.textContent = "SSO login failed. Please try again."; le.style.display = "block"; }
      }
      return;
    }

    const session = await MatrixBridge.restoreSession();
    if (session) {
      await Store.account.setUser(MatrixBridge.getUserId());
      await MatrixBridge.start();
      await MatrixBridge.waitForSync();
      await ensureEncryption();
      Interface.showScreen("screen-rooms");
      Interface.renderRoomList(Room.scanDDJPRooms());
    } else {
      Interface.showScreen("screen-login");
    }
  })();

  // Login
  document.getElementById("btn-login").addEventListener("click", async () => {
    const homeserver = document.getElementById("input-homeserver").value.trim();
    const username = document.getElementById("input-username").value.trim();
    const password = document.getElementById("input-password").value;
    document.getElementById("login-error").style.display = "none";
    try {
      await MatrixBridge.login(homeserver, username, password);
      await Store.account.setUser(MatrixBridge.getUserId());
      await MatrixBridge.start();
      await MatrixBridge.waitForSync();
      await ensureEncryption();
      Interface.showScreen("screen-rooms");
      Interface.renderRoomList(Room.scanDDJPRooms());
    } catch (err) {
      Logger.error("Login failed: " + err.message);
      const le = document.getElementById("login-error");
      le.textContent = "Login failed. Check your credentials.";
      le.style.display = "block";
    }
  });

  // SSO / redirect login: detect support for the entered homeserver, then hand off
  // to the homeserver's own login page. The password is never typed into DDJP.
  const ssoBtn = document.getElementById("btn-sso");
  if (ssoBtn) ssoBtn.addEventListener("click", async () => {
    const homeserver = document.getElementById("input-homeserver").value.trim();
    const le = document.getElementById("login-error");
    if (le) le.style.display = "none";
    if (!homeserver) {
      if (le) { le.textContent = "Enter your homeserver first."; le.style.display = "block"; }
      return;
    }
    const prev = ssoBtn.textContent;
    ssoBtn.disabled = true; ssoBtn.textContent = "Checking…";
    try {
      const flows = await MatrixBridge.getLoginFlows(homeserver);
      if (!flows.sso) {
        if (le) { le.textContent = "This homeserver doesn't offer SSO sign-in — use your username and password."; le.style.display = "block"; }
        ssoBtn.disabled = false; ssoBtn.textContent = prev;
        return;
      }
      await MatrixBridge.startSsoLogin(homeserver);   // navigates away
    } catch (err) {
      Logger.error("SSO sign-in failed: " + (err && err.message));
      if (le) { le.textContent = "Couldn't reach that homeserver. Check the URL."; le.style.display = "block"; }
      ssoBtn.disabled = false; ssoBtn.textContent = prev;
    }
  });

  // Logout
  document.getElementById("btn-logout").addEventListener("click", async () => {
    if (!confirm("Log out and clear saved session?")) return;
    await MatrixBridge.logout();
    Interface.showScreen("screen-login");
  });

  // Manage accounts (multi-account picker). Switching reloads the page so the
  // boot path brings up a clean single client for the chosen account. Forgetting
  // drops both the auth/crypto (transport) and the app storage (Store) for a user.
  const manageBtn = document.getElementById("btn-manage-accounts");
  function openAccounts() {
    Interface.showAccounts({
      accounts: MatrixBridge.listAccounts(),
      activeUserId: MatrixBridge.getActiveUserId(),
      hasSession: (uid) => MatrixBridge.hasStoredSession(uid),
      onSwitch: (uid) => { if (MatrixBridge.switchAccount(uid)) location.reload(); },
      onForget: async (uid) => {
        try { await MatrixBridge.forgetAccount(uid); } catch (e) { Logger.warn("Forget (auth) failed: " + (e && e.message)); }
        try { await Store.account.forgetUser(uid); } catch (e) { Logger.warn("Forget (storage) failed: " + (e && e.message)); }
        openAccounts();   // re-render the now-shorter list
      },
      onAdd: () => Interface.showScreen("screen-login"),
      onBack: () => Interface.showScreen("screen-rooms"),
    });
  }
  if (manageBtn) manageBtn.addEventListener("click", openAccounts);

  // Create room
  const createBtn = document.getElementById("btn-create-room");
  const createRetryBtn = document.getElementById("btn-create-retry");
  const createErr = document.getElementById("create-error");

  async function attemptCreate(name) {
    const progress = document.getElementById("create-progress");
    const bar = document.getElementById("create-progress-bar-fill");
    const step = document.getElementById("create-progress-step");
    createBtn.disabled = true; createBtn.textContent = "Creating...";
    createRetryBtn.disabled = true; createRetryBtn.style.display = "none";
    createErr.style.display = "none"; createErr.textContent = "";
    progress.style.display = "flex"; bar.style.width = "0%";
    if (Interface.setRoomListBusy) Interface.setRoomListBusy(true);
    MatrixBridge.onProgress((completed, total, label, waitUntil) => {
      if (completed == null) {
        if (waitUntil && Interface.startCountdown) {
          Interface.startCountdown("create-ratelimit", step, waitUntil, label || "Retrying in ", "");
        } else {
          if (Interface.clearCountdown) Interface.clearCountdown("create-ratelimit");
          step.textContent = label;
        }
        return;
      }
      if (Interface.clearCountdown) Interface.clearCountdown("create-ratelimit");
      bar.style.width = Math.round((completed / total) * 100) + "%";
      step.textContent = label + " (" + completed + " / " + total + ")";
    });
    try {
      const room = await Room.create(name);
      bar.style.width = "100%"; step.textContent = "Done";
      await new Promise(r => setTimeout(r, 500));
      progress.style.display = "none"; createErr.style.display = "none"; createRetryBtn.style.display = "none";
      Interface.enterMainScreen(room);
    } catch (err) {
      Logger.error("Create room failed: " + err.message);
      // No teardown happened — the partial room is kept and can be resumed.
      // Offer Resume instead of a dead end. The progress bar already reflects
      // how many channels exist (createDDJPSpace re-reports the resumed count).
      const pending = Room.pendingCreate && Room.pendingCreate();
      createErr.textContent = err.message;
      createErr.style.display = "block";
      if (pending) {
        createRetryBtn.textContent = "Resume creating (" + pending.built + "/" + pending.total + " built)";
        createRetryBtn.style.display = "block"; createRetryBtn.disabled = false;
        step.textContent = "Interrupted — resume to finish";
      } else {
        // Failed before anything was built (e.g. the space itself) — a plain retry.
        createRetryBtn.textContent = "Retry"; createRetryBtn.style.display = "block"; createRetryBtn.disabled = false;
        bar.style.width = "0%"; step.textContent = "";
      }
    } finally {
      createBtn.disabled = false; createBtn.textContent = "Create Room";
      if (Interface.clearCountdown) Interface.clearCountdown("create-ratelimit");
      if (Interface.setRoomListBusy) Interface.setRoomListBusy(false);
      MatrixBridge.onProgress(null);
    }
  }

  createBtn.addEventListener("click", async () => {
    const name = document.getElementById("input-room-name").value.trim();
    if (!name) return alert("Enter a room name");
    await attemptCreate(name);
  });

  createRetryBtn.addEventListener("click", async () => {
    // Resume uses the SAME name so Room.create picks up the stashed partial.
    const name = document.getElementById("input-room-name").value.trim();
    if (!name) return alert("Enter a room name");
    await attemptCreate(name);
  });

  // Room-list "Finish creating" → resume an interrupted (possibly cross-reload)
  // creation through the same progress UI as a fresh create.
  if (Interface.setResumeHandler) {
    Interface.setResumeHandler((pending) => {
      const name = (pending && pending.name)
        ? pending.name
        : document.getElementById("input-room-name").value.trim();
      if (!name) return;
      // Make the create section visible even if the user owns other complete
      // rooms (which would otherwise hide it), so the progress bar shows.
      if (Interface.setCreateRoomVisible) Interface.setCreateRoomVisible(true);
      document.getElementById("input-room-name").value = name;
      attemptCreate(name);
    });
  }

  // Join room
  document.getElementById("btn-join-room").addEventListener("click", async () => {
    const spaceId = document.getElementById("input-join-code").value.trim();
    if (!spaceId) return alert("Paste a Space ID");
    if (Interface.setRoomListBusy) Interface.setRoomListBusy(true);
    try {
      const room = await Room.join(spaceId);
      Interface.enterMainScreen(room);
    } catch (err) {
      Logger.error("Join failed: " + err.message);
      alert("Join failed: " + err.message);
    } finally {
      if (Interface.setRoomListBusy) Interface.setRoomListBusy(false);
    }
  });
