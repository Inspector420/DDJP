// features/actions.js
// The adapter between backend capabilities and the UI. Two calls the UI uses:
//   Actions.describe(action, target?) -> { enabled, reason, retryAt?, label?, active? }
//   Actions.perform(action, args?)    -> routes the click to the right feature; returns its promise
//
// `enabled`'s RULE half is ALWAYS Capabilities.can(...) — the adapter never
// re-implements a rank/permission rule (check-actions proves it). The adapter only
// adds STATE-AVAILABILITY (is the action meaningful right now — e.g. something
// playing to skip) and PRESENTATION (dynamic label, toggle `active`). hide-vs-disable,
// in-flight spinners, and the 5s misclick locks stay in the UI, layered on `enabled`.
//
// Capabilities + StreamManager are the backend INTERFACE (ok for a feature); the UI
// must go through THIS module, never the backend directly (check-boundaries rule D).
//
// Depends on: Capabilities, StreamManager (state), Room (my id/rank), and the feature
// modules it routes to (Queue, Skip, Reactions, RoomUpgrade). Feature→feature only.

const Actions = (() => {

  const state  = () => ((typeof StreamManager !== "undefined" && StreamManager.getState()) || {});
  const myId   = () => (typeof Room !== "undefined" ? Room.getMyId() : null);
  // ── AUTHORITY, NOT CHANNEL TIER ───────────────────────────────────────────────────────────
  // This decides who outranks whom, so it must read the level that separates a human owner (100)
  // from the bot (99). `Room.getMyRank()` answers the highest events CHANNEL this client can write
  // to, which caps at 99 for both — so an owner asking "may I grant Owner?" was compared as 99,
  // `99 < 99` was false, and the option vanished from the UI. Reported from a live room after an
  // upgrade. `rank.assign`, `member.kick` and `member.ban` are the three verbs whose answers differ
  // between the two readings; all three come through here.
  const myRank = () => (typeof Room !== "undefined" && Room.getMyAuthorityLevel
    ? Room.getMyAuthorityLevel() : (typeof Room !== "undefined" ? Room.getMyRank() : 0));

  function inRotation(s, u) { for (const r of (s.rotation || [])) if (r.user === u) return true; return false; }
  function entry(s, u) { for (const r of (s.rotation || [])) if (r.user === u) return r; return null; }

  // action -> { verb, run(args), avail(s), availReason, label(s), active(s) }
  // verb null  => no backend rule (display-level); `enabled` is pure state-availability.
  // avail absent => always available.
  const CATALOG = {
    "dj.join":       { verb: "dj.join",       run: ()  => Queue.join(),                          avail: (s) => !inRotation(s, myId()), label: () => "Join" },
    "dj.leave":      { verb: "dj.leave",      run: ()  => Queue.leave(),                         avail: (s) => inRotation(s, myId()),  label: () => "Leave" },
    "dj.declare":    { verb: "dj.declare",    run: (a) => Queue.submitSong(a.videoId, a.url),    avail: (s) => { const m = entry(s, myId()); return !!m && (m.pending || []).length < 2; }, availReason: "Your queue is full" },
    "dj.undeclare":  { verb: "dj.undeclare",  run: (a) => Queue.undeclare(a.videoId) },
    "dj.order":      { verb: "dj.order",      run: (a) => Queue.reorder(a.videoIds) },
    "dj.skip":       { verb: "dj.skip",       run: ()  => Skip.skip(),                           avail: (s) => !!s.nowPlaying, availReason: "Nothing is playing", label: () => "Skip" },
    "dj.move":       { verb: "dj.move",       run: (a) => Queue.move(a.userId, a.afterUserId) },
    "dj.remove":     { verb: "dj.remove",     run: (a) => Queue.remove(a.userId) },
    "dj.strike":     { verb: "dj.strike",     run: (a) => Queue.strike(a.userId, a.videoId) },
    "dj.reset":      { verb: "dj.reset",      run: ()  => Queue.reset(),                         avail: (s) => ((s.rotation || []).length > 0 || !!s.nowPlaying) },
    "room.settings": { verb: "room.settings", run: (a) => Room.setSettings(a.partial) },
    "react.vote":    { verb: "react.vote",    run: ()  => Reactions.vote(),                      avail: (s) => !!s.nowPlaying, availReason: "Nothing is playing", active: () => !!(typeof Reactions !== "undefined" && Reactions.hasVoted && Reactions.hasVoted()) },
    "react.save":    { verb: null,            run: (a) => Reactions.recordSave(a.pi),            avail: (s) => !!s.nowPlaying, availReason: "Nothing is playing", active: () => !!(typeof Reactions !== "undefined" && Reactions.hasSaved && Reactions.hasSaved()) },
    "rank.assign":   { verb: "rank.assign",   run: (a) => Room.assignRank(a.userId, a.newLevel) },
    // The two membership acts (J14). Like `rank.assign` beside them these are feature/transport
    // verbs rather than reducer events, so `perform`'s re-check is not the last word — `Room.kick`
    // and `Room.ban` re-read both ranks live and refuse again, because a descriptor rendered
    // before a promotion must not authorise an act after one.
    "member.kick":   { verb: "member.kick",   run: (a) => Room.kick(a.userId, a.reason) },
    "member.ban":    { verb: "member.ban",    run: (a) => Room.ban(a.userId, a.reason) },
    // THE DM ENTRY POINT (J15), AND `verb: null` IS THE DECISION RATHER THAN AN OMISSION.
    // J14 declared this row's SLOT on the user card and left it dark until the adapter knew the
    // action; this is that one entry. It carries no capability verb and no `Ranks.GATES` row, for
    // the reason `features/chat.js` states at the DM block: a DM has no reducer to fold it AND no
    // homeserver rule a DDJP rank could stand for, so a rank gate would report permitted against
    // nothing — the failure J14 hit from the other side. Its `enabled` is pure state-availability
    // (is secure chat up), which is the same shape `react.save` has and the same bucket
    // `reference/UI_WORKLIST.md` already puts chat send in: Transport, not Capability.
    // Messaging YOURSELF is refused by `Chat.openDM` rather than by `avail`, because `describe`
    // hands `avail` the room state and not the target — so the rule lives where it can see the
    // target and be driven, instead of in a button that is merely hidden.
    "chat.dm":       { verb: null,            run: (a) => Chat.openDM(a.userId),
                       avail: () => !!(typeof Chat !== "undefined" && Chat.cryptoReady && Chat.cryptoReady()),
                       availReason: "Secure chat is offline", label: () => "Message" },
    "room.invite":   { verb: "room.invite",   run: (a) => Room.invite(a.userId) },
    "room.upgrade":  { verb: "room.upgrade",  run: ()  => RoomUpgrade.upgrade(),                 label: () => "Upgrade" },
  };

  function describe(action, target) {
    const spec = CATALOG[action];
    if (!spec) return { enabled: false, reason: "Unknown action", label: null, active: false };
    const s = state();
    const ctx = { myId: myId(), myRank: myRank(), now: Date.now(), target: target || {} };
    const cap = spec.verb ? Capabilities.can(spec.verb, s, ctx) : { permitted: true, reason: null };
    const avail = spec.avail ? !!spec.avail(s) : true;
    // ── THE BOT IS NOT OFFERED OWNER ACTS (J52, extended) ────────────────────────────────────
    // The bot holds the ladder's top rung, so `Capabilities` answers "permitted" for every owner
    // act and this whole catalogue reads identically for it and for a human owner — measured, all
    // 19 of them. This asks the one question `Capabilities` structurally cannot: not *does this
    // rank allow it*, but *is this account the room's bot*.
    //
    // IT LIVES HERE RATHER THAN IN `Capabilities` ON PURPOSE. `Capabilities` answers from the same
    // table the REDUCER enforces, and `check-capabilities` proves the two agree — a bot clause in
    // there would make the rulebook disagree with the enforcement it is checked against, which is
    // the drift that guard exists to catch. This is a DISPLAY rule, so it belongs on the display
    // seam, and it can only ever subtract: `mayOffer` returns `{ may: true }` for every caller
    // that is not the bot.
    //
    // RESOLVED AT CALL TIME, NOT AT CONSTRUCTION. `botruntime.js` loads AFTER this file in
    // `index.html`, so a top-level reference would be `undefined` forever — the same shape as
    // `_desiredMembership` reading `CHANNELS` before it existed.
    let botPolicy = { may: true, why: null };
    try {
      if (typeof BotRuntime !== "undefined" && BotRuntime.mayOffer) botPolicy = BotRuntime.mayOffer(action);
    } catch (e) { botPolicy = { may: true, why: null }; }
    const enabled = cap.permitted && avail && botPolicy.may !== false;
    let reason = null;
    if (!cap.permitted) reason = cap.reason;
    else if (!avail) reason = spec.availReason || "Not available right now";
    else if (botPolicy.may === false) reason = botPolicy.why;
    const out = { enabled: enabled, reason: reason };
    if (cap.retryAt) out.retryAt = cap.retryAt;
    if (spec.label) out.label = spec.label(s);
    if (spec.active) out.active = !!spec.active(s);
    return out;
  }

  // Route a click. `args` doubles as the capability target and the feature-call params.
  // Re-checks `enabled` (defense in depth): the UI already hid/disabled it, but a stale
  // click must not slip a rejected intent onto the wire. Returns the feature's promise
  // so the UI can drive its own spinner / My-Queue loading bar.
  function perform(action, args) {
    const spec = CATALOG[action];
    if (!spec) return Promise.reject(new Error("Unknown action: " + action));
    const d = describe(action, args || {});
    if (!d.enabled) return Promise.reject(new Error(d.reason || "Not permitted"));
    try { return Promise.resolve(spec.run(args || {})); }
    catch (e) { return Promise.reject(e); }
  }

  return { describe: describe, perform: perform, ACTIONS: Object.keys(CATALOG) };
})();
