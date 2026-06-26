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
  const MAX_BATCH = 3;
  const OWNER = 100;

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
      if (typeof e.rank === "number" && e.rank < OWNER) continue;
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

  // Owner action: perform (or resume) the next batch. onProgress(completed,
  // total, label) is called for each channel as it's created (same shape as room
  // creation), so the UI can show a bar. completed === null means "rate-limited,
  // waiting".
  async function upgrade(onProgress) {
    if (Room.getMyRank() < OWNER) { Logger.warn("RoomUpgrade: only the Owner can upgrade"); return; }
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
