// app.js — DDJP bootstrap (externalized from index.html for CSP, Topic 3).
// Wires the YouTube callback, the encryption gate, session restore, and the
// login/logout/create-room handlers. No logic change from the former inline block.

  window.onYouTubeIframeAPIReady = function () { Logger.debug("YouTube API ready"); };

  // The version this page is actually running, taken from the `?v=` cache-bust tag that
  // bump-version.js stamps onto every script and stylesheet. Never a literal: one home for
  // the number, and the deploy tool already owns it.
  function _runningVersion() {
    try {
      const tags = document.querySelectorAll('script[src*="?v="], link[href*="?v="]');
      for (const t of tags) {
        const m = String(t.src || t.href).match(/[?&]v=(\d+)/);
        if (m) return "v" + m[1];
      }
    } catch (e) {}
    return "v?";   // unknown is stated, never guessed
  }

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
    // ── WHICH CODE IS THIS? ──────────────────────────────────────────────────────────────
    // First line of every session, because a log that does not say which build produced it
    // cannot be read. A stale tab serving old JS against a current one is indistinguishable
    // from a consensus fault in a log — two clients genuinely disagreeing about state looks
    // identical either way, and the wrong diagnosis is expensive.
    //
    // READ, NOT WRITTEN. The number comes off this document's own `?v=` tags, which
    // tools/bump-version.js maintains. A literal here would be a second copy of the version
    // and would drift the first time someone bumped without editing it — the same shape as
    // every restated dial this project has had to delete.
    Logger.info("DDJP " + _runningVersion() + " — " + location.origin);

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
  // Wrap a promise so a hung network call (e.g. an unreachable/misspelled homeserver)
  // surfaces an error instead of leaving the button spinning forever.
  function _withTimeout(promise, ms, message) {
    let t;
    const timeout = new Promise((_, rej) => { t = setTimeout(() => { const e = new Error(message); e._timeout = true; rej(e); }, ms); });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
  }
  document.getElementById("btn-login").addEventListener("click", async () => {
    const homeserver = document.getElementById("input-homeserver").value.trim();
    const username = document.getElementById("input-username").value.trim();
    const password = document.getElementById("input-password").value;
    const le = document.getElementById("login-error");
    le.style.display = "none";
    const btn = document.getElementById("btn-login");
    const label = btn.textContent;
    btn.disabled = true; btn.textContent = "Logging in…";   // feedback: the click registered
    try {
      // Timeout only the auth network call; start()/waitForSync() can legitimately run long.
      await _withTimeout(MatrixBridge.login(homeserver, username, password), 20000, "Login timed out — check the homeserver address.");
      await Store.account.setUser(MatrixBridge.getUserId());
      await MatrixBridge.start();
      await MatrixBridge.waitForSync();
      await ensureEncryption();
      Interface.showScreen("screen-rooms");
      Interface.renderRoomList(Room.scanDDJPRooms());
    } catch (err) {
      Logger.error("Login failed: " + err.message);
      le.textContent = err._timeout ? err.message : "Login failed. Check your credentials.";
      le.style.display = "block";
    } finally {
      btn.disabled = false; btn.textContent = label;   // always restore the button
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

  // `file` is an optional parsed save file (J27). Everything about the progress, error and resume
  // machinery is identical either way — the only difference is which Room verb runs, and that a
  // create-from-file refuses the file before it builds anything. Kept as one function rather than
  // two on purpose: a second copy of this progress wiring is a second thing to keep in step, and
  // the import path is precisely the one where a half-built room is most expensive.
  async function attemptCreate(name, file) {
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
      const room = file ? await Room.createFromFile(name, file) : await Room.create(name);
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

  // ── CREATE FROM A SAVE FILE (J27) ───────────────────────────────────────────────────────
  // This reads a file and parses JSON. It decides NOTHING about the file's contents: whether the
  // version is one this build reads, whether the settings key set is older, whether the author
  // declaration can be corroborated and whether the snapshots can be trusted are all answered by
  // `StreamManager.importFile` below the seam, and every one of them is refused BEFORE a room is
  // created. The only judgement here is "is this even JSON", because a parse failure has no
  // meaning to report from any deeper layer.
  const importBtn = document.getElementById("btn-create-from-file");
  const importInput = document.getElementById("input-import-file");
  const importNote = document.getElementById("import-note");
  function showImportNote(text) {
    if (!importNote) return;
    importNote.textContent = text || "";
    importNote.style.display = text ? "block" : "none";
  }
  if (importBtn) importBtn.addEventListener("click", async () => {
    const name = document.getElementById("input-room-name").value.trim();
    if (!name) return alert("Enter a room name for the imported room");
    const f = importInput && importInput.files && importInput.files[0];
    if (!f) return alert("Choose a save file");
    showImportNote("");
    let parsed;
    try { parsed = JSON.parse(await f.text()); }
    catch (e) { showImportNote("That file is not readable JSON."); return; }
    try {
      await attemptCreate(name, parsed);
    } catch (e) {
      // attemptCreate already surfaces the message in the create-error line; this adds the one
      // thing it cannot know, which is that a refusal happened before anything was built.
      showImportNote("Nothing was created. " + (e && e.message ? e.message : ""));
    }
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
