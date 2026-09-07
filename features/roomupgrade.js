// features/roomupgrade.js
// Incremental room upgrades. Higher-rank channels are unlocked in batches, 2h
// apart, driven by two owner-authority events:
//   ddjp.room.upgrade.start { n }   — owner is creating batch n
//   ddjp.room.upgrade.done  { n }   — batch n's channels are all created
// Read from the stream, trusting only events that arrived at Owner rank
// (channel origin). Tells the UI the current batch, whether one is mid-flight
// (resume), and when the owner may upgrade again.
// Depends on: MatrixBridge, StreamManager, Room, StorageIO, Logger

const RoomUpgrade = (() => {
  const COOLDOWN_MS = 2 * 60 * 60 * 1000;   // 2 hours between successful upgrades
  // ── DERIVED FROM THE TABLE, AND IT WAS A LITERAL `3` ──────────────────────────────────────
  // REPORTED FROM A LIVE ROOM: a fully upgraded room still offered an upgrade. `CHANNELS` has FOUR
  // batches since the presence channel landed, and this said three — so `currentBatch` reached 4,
  // the panel's `currentBatch >= maxBatch` branch never fired, and the button stayed.
  //
  // **SECOND TIME THIS EXACT MISTAKE HAS BEEN FOUND**, in the file next door: `highestPresentBatch`
  // carried a literal `[2, 3]` and could not see batch 4 either. A table extended in one place and
  // read as a constant in another — and the batch NUMBER is what nothing else reads, so nothing
  // else notices.
  //
  // Asked through the transport, because `features/` may not reach the channels table directly
  // (check-boundaries rule D). Falls back to the old literal only when the bridge cannot answer.
  const MAX_BATCH = (function () {
    try {
      if (typeof MatrixBridge !== "undefined" && MatrixBridge.maxUpgradeBatch) {
        const n = MatrixBridge.maxUpgradeBatch();
        if (typeof n === "number" && isFinite(n) && n > 0) return n;
      }
    } catch (e) {}
    return 3;
  })();
  // Rank questions go through Capabilities BY NAME — no numeric thresholds here.

  let ownerChannelId = null;
  let _events = [];                          // { kind: "start"|"done", n, ts, rank }
  const _subs = [];
  const _statusListeners = [];
  let _timer = null;
  let _lastCanUpgrade = null;
  let _running = false;                       // re-entrancy guard: one upgrade at a time

  // Pure: derive upgrade status from the accumulated events. Only Owner-rank
  // events count, so a forged upgrade event in a lower channel is ignored.
  function _computeStatus(events, now, batchFloor) {
    let maxDone = 0, lastDoneTs = null;
    const started = {}, doneSet = {};
    for (const e of events) {
      if (!e || typeof e.n !== "number") continue;
      if (typeof e.rank === "number" && !Capabilities.atLeast(e.rank, "owner")) continue;
      if (e.kind === "start") started[e.n] = true;
      if (e.kind === "done") {
        doneSet[e.n] = true;
        if (e.n > maxDone) { maxDone = e.n; lastDoneTs = e.ts || null; }
      }
    }
    // Floor at the highest batch whose channels physically exist (passed in by
    // status()). This makes a fully-built room read as upgraded even if a done
    // marker is missing — markers are advisory, the channels are ground truth.
    const currentBatch = Math.max(1, maxDone, batchFloor || 0);             // batch 1 exists from creation
    const nextBatch = currentBatch < MAX_BATCH ? currentBatch + 1 : null;
    let inProgress = null;
    if (nextBatch !== null && started[nextBatch] && !doneSet[nextBatch]) inProgress = nextBatch;
    const nextAvailableAt = lastDoneTs ? lastDoneTs + COOLDOWN_MS : 0;
    const cooldownPassed = now >= nextAvailableAt;
    const canUpgradeNow = (inProgress !== null) || (nextBatch !== null && cooldownPassed);
    return { currentBatch, nextBatch, maxBatch: MAX_BATCH, inProgress, nextAvailableAt, canUpgradeNow };
  }

  function status() {
    // Reconcile the marker-derived state with what's actually built: a batch
    // whose channels all exist counts as done even if its done-marker is absent.
    let floor = 1;
    try { floor = MatrixBridge.highestPresentBatch(Room.getChannels()); } catch (e) {}
    return _computeStatus(_events, Date.now(), floor);
  }

  function onStatusChange(fn) { if (fn && !_statusListeners.includes(fn)) _statusListeners.push(fn); }
  function _notify() {
    const s = status();
    for (const fn of _statusListeners) { try { fn(s); } catch (e) {} }
  }

  function _record(kind, entry) {
    const n = entry && entry.content ? entry.content.n : undefined;
    if (typeof n !== "number") return;
    _events.push({ kind: kind, n: n, ts: entry.ts || 0, rank: entry.senderRank });
    _notify();
  }

  function _cleanup() {
    for (const s of _subs) StreamManager.off(s[0], s[1]);
    _subs.length = 0;
    if (_timer) clearInterval(_timer);
    _timer = null;
  }

  function init(ownerEventsChannelId) {
    _cleanup();
    ownerChannelId = ownerEventsChannelId;
    _events = [];
    _lastCanUpgrade = null;
    const onStart = (e) => _record("start", e);
    const onDone = (e) => _record("done", e);
    StreamManager.on("ddjp.room.upgrade.start", onStart);
    StreamManager.on("ddjp.room.upgrade.done", onDone);
    _subs.push(["ddjp.room.upgrade.start", onStart], ["ddjp.room.upgrade.done", onDone]);
    // Re-notify when the cooldown elapses (time-based flip, no event to trigger it).
    _timer = setInterval(() => {
      const can = status().canUpgradeNow;
      if (can !== _lastCanUpgrade) { _lastCanUpgrade = can; _notify(); }
    }, 30000);
  }

  function destroy() { _cleanup(); _events = []; ownerChannelId = null; }

  // Seed the cooldown clock right after initial creation (batch 1).
  async function recordCreation() {
    if (!ownerChannelId) return;
    try {
      await MatrixBridge.sendEvent(ownerChannelId, "ddjp.room.upgrade.done", { n: 1 });
    } catch (e) {
      Logger.warn("RoomUpgrade: could not record batch 1: " + e.message);
    }
  }

  function _hasStart(n) {
    for (const e of _events) if (e.kind === "start" && e.n === n) return true;
    return false;
  }

  // ── THE GATE REFUSES THE BOT'S LEVEL, NOT ONLY LOW RANKS (J52) ──────────────────────────────
  // `Capabilities.atLeast(rank, "owner")` is true at 99 AND at 100, because the ladder SATURATES —
  // `ranks.js`'s header records this and `botruntime.js` refuses the human owner for the mirror
  // reason. But `_powerLevels` pins `m.space.child` / `m.space.parent` at **100**, and every batch
  // reaches a space-child write. So an account at 99 was permitted here and refused by the
  // homeserver: a button that reports permitted and yields a 403.
  //
  // LATENT UNTIL THIS PACKAGE. Nothing called `BotRuntime.start()`, so no account had ever run at
  // 99 and no one could reach this path. Wiring the bot made it live, which is why the fix lands
  // in the same package as the wiring rather than being filed for later — shipping the reachable
  // version of a known 403 is not a smaller decision than shipping the fix.
  //
  // AND THE ANSWER IS "NO", DERIVED RATHER THAN CHOSEN. `bot-model.md` §4: the bot acts only on
  // requests, and requests are settings keys only — `room.upgrade` is a `Ranks.GATES` act and NOT
  // a settings key, with zero overlap between the two vocabularies. So the bot can never be ASKED
  // to upgrade, and §3 says it authors nothing on its own initiative. A bot that cannot be asked
  // and does not self-start has no route to this function, and the gate should say so plainly
  // rather than admit a caller that cannot succeed.
  //
  // The comparison is against the SPACE-CHILD level read from the transport, never a literal 100 —
  // a second copy of that number is what J52 is about.
  // ── IT COMPARES THE POWER LEVEL, NOT THE CHANNEL TIER, AND THE FIRST VERSION DID NOT ──────
  // **This gate shipped BROKEN at v322 and refused every owner.** It was handed
  // `Room.getMyRank()`, which answers a CHANNEL TIER — the rank of the highest events channel I
  // can write to. A human owner at power level 100 answers **99** there, because 99 is what the
  // owner channel proves and both they and a bot can write to it. `matrixbridge.js` says so
  // directly, twelve lines above `getMyPowerLevel`: *"it cannot distinguish a bot at 99 from a
  // human owner at 100, because both can write to events-owner and both therefore answer 99."*
  // The gate then compared that 99 against the space-child requirement of 100 and refused.
  //
  // So the fix for J52 broke the button for the one person it was supposed to let through, while
  // correctly refusing the one it was written to stop. Both guards stayed green: `check-bot-wiring`
  // PART G drove the ARITHMETIC — `atLeast` admits the bot's level, the bot's level is below the
  // requirement — and never drove the INPUT, so it proved the comparison was right about numbers
  // nobody supplies.
  //
  // The level is read from `m.room.power_levels` as the homeserver holds it, which is the only
  // place that distinguishes 99 from 100 — and it is the same source the homeserver will enforce
  // the space-child write against, so the app and the server are now answering from one fact.
  function _mayUpgrade(level) {
    if (typeof level !== "number" || !isFinite(level)) return { ok: false, reason: "unreadable-rank" };
    if (!Capabilities.atLeast(level, "owner")) return { ok: false, reason: "not-owner" };
    let need = null;
    try { need = MatrixBridge.spaceChildLevel(); } catch (e) { need = null; }
    // NO FALLBACK. An unreadable requirement is refused rather than assumed: guessing 100 here
    // would be the second source this exists to remove, and guessing low would restore the 403.
    if (typeof need !== "number" || !isFinite(need)) return { ok: false, reason: "unreadable-requirement" };
    if (level < need) return { ok: false, reason: "below-space-write", need: need, rank: level };
    return { ok: true };
  }

  // The level this gate needs, from the space rather than from a channel. Null when the room is
  // not synced — which the gate refuses rather than reading as 0, because 0 is a real level.
  function _myPowerLevel() {
    let cur = null;
    try { cur = Room.getCurrent(); } catch (e) { return null; }
    if (!cur || !cur.spaceId) return null;
    try { return MatrixBridge.getMyPowerLevel(cur.spaceId); } catch (e) { return null; }
  }

  // Owner action: perform (or resume) the next batch. onProgress(completed,
  // total, label) is called for each channel as it's created (same shape as room
  // creation), so the UI can show a bar. completed === null means "rate-limited,
  // waiting".
  async function upgrade(onProgress) {
    const may = _mayUpgrade(_myPowerLevel());
    if (!may.ok) {
      if (may.reason === "below-space-write") {
        Logger.warn("RoomUpgrade: level " + may.rank + " is owner-tier but below the " + may.need +
                    " the homeserver requires to write space children — the upgrade would 403 " +
                    "partway through. This is the bot's level: the bot does not drive upgrades.");
      } else if (may.reason === "unreadable-requirement") {
        Logger.warn("RoomUpgrade: the space-child power requirement could not be read, so whether " +
                    "this account can complete an upgrade is unknown — refusing rather than " +
                    "starting a batch that may 403 halfway");
      } else {
        Logger.warn("RoomUpgrade: only the Owner can upgrade");
      }
      return;
    }
    // Re-entrancy guard: an upgrade is slow (many channel creates, possible
    // rate-limit waits). Without this, a second click — or the UI re-triggering
    // while the first run is mid-flight — starts a SECOND concurrent batch that
    // snapshots the channel map before the first has created anything, so both
    // create the same channels. This was a primary cause of duplicates.
    if (_running) { Logger.warn("RoomUpgrade: an upgrade is already in progress"); return; }
    _running = true;
    try {
      const st = status();
      const target = st.inProgress ? st.inProgress : st.nextBatch;
      if (target === null) { Logger.info("RoomUpgrade: room is fully upgraded"); return; }
      if (!st.inProgress && !st.canUpgradeNow) { Logger.warn("RoomUpgrade: next upgrade not unlocked yet"); return; }

      if (!_hasStart(target)) {
        try {
          await MatrixBridge.sendEvent(ownerChannelId, "ddjp.room.upgrade.start", { n: target });
        } catch (e) { Logger.error("RoomUpgrade: start failed: " + e.message); return; }
      }

      if (onProgress) MatrixBridge.onProgress(onProgress);
      let added;
      try {
        added = await MatrixBridge.createUpgradeBatch(Room.getCurrent().spaceId, Room.getChannels(), target);
      } catch (e) {
        if (onProgress) MatrixBridge.onProgress(null);
        // Persist whatever the batch managed to create before failing, so a
        // retry sees those channels as existing and doesn't recreate them.
        if (e && e.partial) Room.mergeChannels(e.partial);
        Logger.error("RoomUpgrade: batch " + target + " creation failed (resumable, retry to finish): " + e.message);
        _notify();
        return;
      }
      if (onProgress) MatrixBridge.onProgress(null);

      Room.mergeChannels(added);

      try {
        await MatrixBridge.sendEvent(ownerChannelId, "ddjp.room.upgrade.done", { n: target });
      } catch (e) { Logger.error("RoomUpgrade: done marker failed: " + e.message); }

      Logger.info("RoomUpgrade: batch " + target + " complete");
      _notify();
    } finally {
      _running = false;
    }
  }

  function isRunning() { return _running; }

  return { init, destroy, status, onStatusChange, upgrade, recordCreation, isRunning, _computeStatus };
})();
