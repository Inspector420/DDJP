// features/skip.js
// Skip the currently-playing song. Emits ddjp.dj.skip with p = the current
// play-instance id (the advance lock). Self-skip is any rank; skipping someone
// else's song needs VIP. The reducer enforces the same rule on receipt — every
// client (including the sender's own) only accepts the advance if p still
// matches nowPlaying.pi at the moment the event is processed.
//
// Race note: p is read from local stream state at click time. If another
// client's play/skip lands first, our event arrives with a stale p and is
// silently dropped by the (correctly deterministic) reducer everywhere — that
// is the protocol working as designed, not a bug, but it used to look like
// "skip did nothing" with zero feedback. Two things narrow that gap here:
//   1. Re-read np.pi immediately before sending (not just at click time) to
//      shrink the window where it can go stale between click and send.
//   2. After sending, watch whether nowPlaying.pi actually changed; if it
//      didn't within a short window, tell the caller so the UI can show
//      something honest instead of a click that silently did nothing. This
//      observes the outcome — it does not gate or pre-judge the event, so it
//      doesn't duplicate StateDeriver's accept/reject decision.
// Depends on: StreamManager, MatrixBridge, Room, Logger

const Skip = (() => {
  const VIP = 40;
  const CONFIRM_WINDOW_MS = 4000;   // generous: covers federation + jitter
  let eventsChannel = null;

  function init(channel) { eventsChannel = channel; }
  function destroy() { eventsChannel = null; }

  // Resolves { ok: true } if the skip was sent and the room's now-playing
  // actually changed shortly after, or { ok: false, reason } otherwise —
  // including the case where it sent but never took effect (lost the race).
  async function skip() {
    if (!eventsChannel) return { ok: false, reason: "not connected" };
    const npAtClick = StreamManager.getState().nowPlaying;
    if (!npAtClick) { Logger.info("Skip: nothing is playing"); return { ok: false, reason: "nothing is playing" }; }
    const me = MatrixBridge.getUserId();
    if (npAtClick.dj !== me && Room.getMyRank() < VIP) {
      Logger.warn("Skip: VIP rank required to skip someone else's song");
      return { ok: false, reason: "VIP rank required to skip someone else's song" };
    }

    // Re-read right before sending — narrows, doesn't eliminate, the race.
    const np = StreamManager.getState().nowPlaying;
    if (!np) return { ok: false, reason: "nothing is playing" };
    const targetPi = np.pi;

    await MatrixBridge.sendEvent(eventsChannel, "ddjp.dj.skip", { p: targetPi });

    const advanced = await _waitForAdvance(targetPi);
    if (!advanced) {
      Logger.info("Skip: did not take effect — someone else's skip/play landed first");
      return { ok: false, reason: "missed — someone else's skip or play landed first, try again" };
    }
    return { ok: true };
  }

  // Resolves true as soon as nowPlaying's pi differs from beforePi — including
  // a transition to null, which means the skip was accepted but the rotation
  // is now empty (a real, successful outcome, not a miss). Resolves false only
  // if nothing changed at all within CONFIRM_WINDOW_MS. Pure observation of
  // stream state via StreamManager's existing subscription mechanism — no new
  // accept/reject logic, just watching what StateDeriver already decided.
  function _waitForAdvance(beforePi) {
    function changed() {
      const s = StreamManager.getState().nowPlaying;
      const curPi = s ? s.pi : null;
      return curPi !== beforePi;
    }
    return new Promise((resolve) => {
      if (changed()) { resolve(true); return; }

      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        StreamManager.off("ddjp.dj.play", check);
        StreamManager.off("ddjp.dj.skip", check);
        StreamManager.off("ddjp.dj.reset", check);
        clearTimeout(timer);
        resolve(result);
      };
      const check = () => { if (changed()) finish(true); };
      StreamManager.on("ddjp.dj.play", check);
      StreamManager.on("ddjp.dj.skip", check);
      StreamManager.on("ddjp.dj.reset", check);   // reset can also clear nowPlaying-adjacent state
      const timer = setTimeout(() => finish(false), CONFIRM_WINDOW_MS);
    });
  }

  // Pure UI gate: is there a real current song to skip? Mirrors the
  // "nothing is playing" guard skip() enforces at click time, so the Skip
  // button's enabled state tracks CONSENSUS now-playing — not any client-local
  // "this looks over" estimate (which is what used to grey it mid-song).
  // Whether a non-VIP may skip someone else's song is surfaced as an honest
  // reason on click, not by pre-greying the button.
  function canSkip(np) {
    return !!(np && np.song);
  }

  return { init, destroy, skip, canSkip };
})();
