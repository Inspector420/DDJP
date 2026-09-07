// features/chat.js
// Owns chat — sending and receiving messages.
// Chat is not a protocol event — it goes through Matrix directly, not StreamManager.
// Chat is RAM-only and never cached at rest (no consensus, no checkpoints).
// The live render window (in interface.js) is the single source of "what's
// currently shown" and owns dedup; this module forwards live messages with their
// Matrix event_id and does ONE capped recent backfill when a room's chat starts
// (backfillRecent — the last few messages of the active/default channel). Chat is
// otherwise PRESENT-FORWARD: it never pages history on scroll (that's a future DM
// concern). Undecryptable backfilled messages come back failed and are hidden.
// Depends on: MatrixBridge, Logger, ChatPrefs (the DM conversation index — metadata only)

const Chat = (() => {
  let currentChatId = null;
  // ── THE READABLE SET (J12) ─────────────────────────────────────────────────────────────────
  // WHY THIS EXISTS AND WHY IT IS NOT `currentChatId`. Until J12 `_handleRaw` refused everything
  // whose `room_id` was not the ONE active channel — so a message in a tier you were not looking
  // at was discarded at the door, and no unread badge for it was possible even in principle. The
  // plumbing was already there: `matrixbridge._routeEvent` fans EVERY routed event out to the raw
  // listeners unconditionally (the fan-out sits outside the in-scope branch), so chat from every
  // tier this client has joined was arriving and being thrown away one line later. DRIVEN, not
  // read — `probe-j12-tiers.js` R2.
  //
  // TWO SETS, TWO QUESTIONS, AND CONFLATING THEM IS THE WHOLE HAZARD. `_readable` answers *may I
  // receive this* — every chat channel my rank grants. `currentChatId` answers *where does my
  // next message go* — the ONE tier I am looking at. Sending is deliberately still bound to the
  // single active channel: a send that fanned out would post the same words to three tiers with
  // three different audiences, which is the opposite of what a tier is for.
  let _readable = [];
  // ── A LIST, NOT A SLOT ──────────────────────────────────────────────────────────────────────
  // This was `_onMessage = fn`, so the LAST caller won and every earlier one was silently
  // unsubscribed. One caller existed (the panel's renderer), so nothing was broken — and the bot
  // needing to observe chat for its AFK rule would have taken the slot and stopped chat rendering,
  // with no error anywhere. A single-slot registrar is a defect that costs nothing until the
  // second subscriber arrives, and then costs the first one silently.
  const _msgListeners = [];
  // J11 — a separate channel for redactions, not a flag on `_onMessage`. A redaction is not a
  // message with a property; it is an instruction to REMOVE a row, and the consumer's response
  // has nothing in common with rendering one. Folding it into `onMessage` would mean every
  // existing caller growing a branch for an event it does not handle.
  let _onRedaction = null;

  // ADDITIVE, and duplicate-safe so a re-init does not double-render. There is no `offMessage`
  // because nothing has ever needed one; add it the day something does rather than shipping an
  // unused half.
  function onMessage(fn) {
    if (typeof fn !== "function") return;
    if (_msgListeners.indexOf(fn) < 0) _msgListeners.push(fn);
  }
  function onRedaction(fn) { _onRedaction = fn; }

  function init(chatId) {
    currentChatId = chatId;
    // THE ACTIVE CHANNEL IS READABLE BY DEFINITION, so `init` seeds the set with it. This is what
    // keeps J12 a WIDENING rather than a change of contract: a caller that never calls
    // `setReadableTiers` behaves exactly as it did before — one channel in, one channel out — and
    // the fail-closed rule below is about being UNBOUND, not about being un-widened.
    // `check-chat-history` is the caller that proved this mattered: it drives `init` alone and
    // went red when the filter demanded a set nobody had given it.
    _readable = chatId ? [chatId] : [];
    // Register for raw Matrix events — chat is not a ddjp protocol event
    MatrixBridge.onRawEvent(_handleRaw);
    Logger.debug("Chat: init for " + chatId);
  }

  function destroy() {
    MatrixBridge.offRawEvent(_handleRaw);   // actually remove THIS handler (onRawEvent(null) didn't)
    currentChatId = null;
    _readable = [];
  }

  // The readable set, REPLACED rather than merged — same rule and same reason as
  // `MatrixBridge.setRoomScope`: navigating between rooms must not leave the last room's channels
  // feeding this one. Callers hand the whole list; there is no add/remove.
  function setReadableTiers(ids) {
    _readable = (Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && x);
  }
  function readableTiers() { return _readable.slice(); }

  // Re-point chat at a different channel (e.g. a room setting changed the main
  // chat tier) WITHOUT re-subscribing the raw listener — init already did that,
  // and the listener filters by currentChatId. No-op if it's the same channel.
  // The render window resets its own dedup when the box is rebuilt/cleared.
  function setRoom(chatId) {
    if (!chatId || chatId === currentChatId) return;
    currentChatId = chatId;
    // Same rule as `init`: wherever the active channel points, it is readable. Additive here
    // rather than replacing, because `setReadableTiers` may already have widened the set and a
    // re-point must not narrow it back to one.
    if (_readable.indexOf(chatId) < 0) _readable = _readable.concat([chatId]);
    Logger.debug("Chat: switched to " + chatId);
  }

  function _handleRaw(raw, event, room) {
    // ── THE DOOR IS THE SAME DOOR (J11) ────────────────────────────────────────────────────
    // A redaction goes through the readable-set check BEFORE anything else, exactly as a message
    // does and for exactly the same reason: an unbound client must not act on a deletion from a
    // channel that is not ours. This is the one place the posture could have been weakened by
    // accident — the type test used to be the first line, so a handler added above it would have
    // been reachable from any room in sync. Order matters and the gate goes first.
    if (raw.type !== "m.room.message" && raw.type !== "m.room.redaction") return;
    // FAIL CLOSED. An empty readable set means nothing is ours — not everything. Same rule as
    // `inScope`, and for the same reason: before a room is bound, a permissive filter would let a
    // stranger's chat channel render as this room's.
    if (!_readable.length) return;
    if (_readable.indexOf(raw.room_id) < 0) return;

    if (raw.type === "m.room.redaction") {
      // NO TARGET, NO ACTION. A redaction whose `redacts` did not survive the envelope names
      // nothing, and guessing would delete the wrong row. Refused rather than approximated.
      const target = raw.redacts;
      if (!target) { Logger.warn("Chat: redaction with no target id"); return; }
      // The room id travels for the same reason it does on a message: buffers are per tier
      // (J12), and a redaction has to reach the tier the deleted message is actually in.
      if (_onRedaction) _onRedaction(target, raw.room_id, raw.sender);
      return;
    }
    // The encrypted shell (type m.room.encrypted) is filtered out above; chat
    // forwards only once the SDK reports a decrypted (or terminally-failed)
    // message via Event.decrypted. We pass the RAW body plus a `failed` flag and
    // let the render buffer decide display: it upserts by event_id and never
    // downgrades real text to a placeholder, so each message is ONE self-updating
    // row (no duplicate "real + Couldn't decrypt" pair).
    const failed = !!(event && event.isDecryptionFailure && event.isDecryptionFailure());
    // THE CHANNEL ID TRAVELS WITH THE MESSAGE. Appended rather than inserted, so every existing
    // caller keeps the arity it was written against — and the consumer needs it, because with more
    // than one channel arriving the message no longer says which view it belongs to. Without this
    // the UI would file every message under whichever tier happened to be selected when it landed.
    // EVERY listener, and one that throws must not stop the others — a renderer bug would
    // otherwise silence the bot's observation, and vice versa.
    for (const fn of _msgListeners) {
      try { fn(raw.event_id, raw.sender, _sanitize(raw.content.body || ""), failed, raw.ts, raw.room_id); }
      catch (e) { Logger.warn("Chat: a message listener threw — " + ((e && e.message) || e)); }
    }
  }

  // Returns a status so the UI can react instead of an uncaught rejection. The E2E
  // failure mode — crypto never initialised, so an encrypted room refuses the send —
  // used to throw here and vanish the message into the console; now it comes back as
  // { ok:false, reason:"no-crypto" } so the caller can keep the text and show the
  // "secure chat offline" banner. cryptoReady() lets the UI pre-empt the same case.
  // Take back one of your own messages. Bound to `currentChatId` — the tier you are LOOKING at —
  // which is the same binding `send` uses and for the same reason: the message you are deleting is
  // one you are looking at, and a redaction aimed at a channel you are not viewing would be
  // deleting something you cannot see.
  //
  // NO RANK GATE HERE, DELIBERATELY. See `MatrixBridge.redactEvent`: the homeserver adjudicates a
  // redaction and there is no reducer branch for it, so a gate would report permitted against
  // nothing (J14's lesson, and the 403 drift `10-capabilities.md` exists to prevent). A refusal
  // comes back as a rejected promise and is reported as a refusal, not pre-empted as a prohibition.
  async function redact(eventId) {
    if (!currentChatId) return { ok: false, reason: "no-room" };
    if (!eventId) return { ok: false, reason: "no-target" };
    try {
      await MatrixBridge.redactEvent(currentChatId, eventId);
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) || "";
      Logger.warn("Chat: redact failed — " + msg);
      // A 403 is the homeserver saying no. It is reported as such rather than being turned into a
      // local rule, because the local rule would be the thing that drifts.
      const reason = /403|forbidden|not permitted/i.test(msg) ? "forbidden" : "redact-failed";
      return { ok: false, reason: reason, error: msg };
    }
  }

  // ── SEND TO A NAMED CHANNEL ────────────────────────────────────────────────────────────────
  // `send` follows the ACTIVE tier, which is what a person typing wants and the wrong thing for
  // anything automatic. The bot's AFK warning went through `send`, so it landed in whatever tab
  // the bot's client happened to have open — a device-local, PERSISTENT preference. Someone
  // clicking a tab once on the bot's machine redirected every warning after it, silently and for
  // good. And since `presence` became a selectable tier the destination could be the presence
  // chat: the one channel holding only ACTIVE people, so a warning to an idle person would land
  // where they are least likely to be and may have just been removed from.
  //
  // ONE IMPLEMENTATION, TWO ENTRY POINTS. `send` is now `sendTo(currentChatId, ...)`, so the
  // sanitising, the crypto pre-empt and all five refusal shapes stay in one place — `_warn`
  // depends on `ok === false` meaning the message did not land, and a second copy of this
  // function would be a second chance to get that wrong.
  //
  // IT DOES NOT WIDEN `_readable`. Sending somewhere is not reading it, and `setRoom` is what
  // tracks the latter — pointing this at a channel must not quietly start folding it into the feed.
  async function sendTo(chatId, text) {
    if (!chatId) { Logger.warn("Chat: no chat room"); return { ok: false, reason: "no-room" }; }
    const safe = _sanitize(String(text == null ? "" : text).trim());
    if (!safe) return { ok: false, reason: "empty" };
    if (!cryptoReady()) return { ok: false, reason: "no-crypto" };   // pre-empt the encrypted-room refusal
    try {
      await MatrixBridge.sendMessage(chatId, safe);
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) || "";
      Logger.warn("Chat: send failed — " + msg);
      // The specific E2E failure (client has no crypto) vs any other transport error.
      const reason = /encryption/i.test(msg) ? "no-crypto" : "send-failed";
      return { ok: false, reason: reason, error: msg };
    }
  }

  async function send(text) { return sendTo(currentChatId, text); }

  // E2E health proxies (ui/ can't touch MatrixBridge directly — Rule D). cryptoReady()
  // is the cheap "is secure chat up?" check the banner polls; retryCrypto() is the
  // in-place Tier-1 recovery (re-init after a fresh token, no reload).
  function cryptoReady() {
    try { return !!(MatrixBridge.cryptoAvailable && MatrixBridge.cryptoAvailable()); }
    catch (e) { return false; }
  }
  async function retryCrypto() {
    try { return !!(MatrixBridge.retryCrypto && await MatrixBridge.retryCrypto()); }
    catch (e) { Logger.warn("Chat: retryCrypto failed — " + (e && e.message)); return false; }
  }

  // One-shot recent backfill when a room's chat starts: a SINGLE capped fetch of
  // the most recent `count` messages of the ACTIVE channel (currentChatId — the
  // room-settings default tier, guest vs uncategorized). Present-forward after:
  // no scroll paging, never asks again. Whatever the server returns (possibly
  // fewer than `count`, possibly zero) is mapped oldest->newest; the render buffer
  // dedups by id. Undecryptable messages are carried through as failed (the
  // renderer hides them). Degrades to {messages:[]} on any transport error.
  async function backfillRecent(count) {
    if (!currentChatId) return { messages: [] };
    let res;
    try { res = await MatrixBridge.recentChatMessages(currentChatId, count); }
    catch (e) { Logger.warn("Chat: backfill failed: " + (e && e.message)); return { messages: [] }; }
    const out = [];
    for (const m of (res.messages || [])) {
      out.push({ id: m.event_id, sender: m.sender, body: _sanitize(m.body || ""), failed: !!m.failed, ts: m.ts });
    }
    return { messages: out };
  }

  // Coerce a message body to a string. We do NOT HTML-escape: the single safety
  // boundary is the UI rendering every body through document.createTextNode (never
  // innerHTML), enforced by the check-html-safety guard. Escaping here too
  // double-escaped everything (a typed "<3" rendered as "&lt;3") (#2).
  function _sanitize(text) {
    return text == null ? "" : String(text);
  }

  // ═══ DIRECT MESSAGES (J15) ═══════════════════════════════════════════════════════════════
  // A DM is the same Skin as room chat — E2E, RAM-only, never truth — with two differences that
  // are the whole job: it lives in a SEPARATE Matrix room, and it is with a PERSON rather than
  // inside a room.
  //
  // ── WHAT ENFORCES A DM, GIVEN NOTHING FOLDS ONE ──────────────────────────────────────────
  // J14's finding was that kick and ban went missing for the project's life because
  // `check-capabilities` needs a reducer branch to compare against, so a verb no guard could
  // validate was a verb nobody added. A DM send is the same family and the answer had to be
  // DECIDED rather than found: there is no reducer backstop and there cannot be one.
  //
  // The decision: `chat.dm` carries NO capability verb and NO `Ranks.GATES` row. A rank gate on
  // "may I message this person" would be a rule with no enforcer — the homeserver decides who may
  // invite and join a room, and DDJP's ladder means nothing outside a DDJP room — which is the
  // button-reports-permitted-and-gets-a-403 drift `10-capabilities.md` exists to prevent, arriving
  // through the same door J14 came through. It joins `react.save` and `ddjp.media.skip`: no verb,
  // by decision, with the reason written down.
  //
  // What IS enforced, and what the guard drives, is the OTHER axis: not who may send, but where a
  // DM may LAND. `MatrixBridge`'s two doors both refuse a DM into the store and the fold, by
  // ORIGIN — the DM scope reaches the raw listeners and nothing else. That is the enforcement
  // counterpart, and it is a property of the transport rather than of a rank.
  let _dmRoomId = null;      // the conversation currently OPEN in the panel (null = none)
  let _onDMMessage = null;
  let _onDMRedaction = null;
  let _onDMChange = null;    // "the conversation list or its unread state moved"

  function onDMMessage(fn) { _onDMMessage = fn; }
  function onDMRedaction(fn) { _onDMRedaction = fn; }

  // Take back one of your own DM messages. The transport call is `redactEvent`, the SAME one room
  // chat uses — this is a second CALLER, never a second implementation, and the rule about what a
  // redaction means lives entirely in `ui/chatbuffer.js` where both paths read it.
  //
  // NO RANK GATE, for the reason J11 recorded: the homeserver adjudicates a redaction and the
  // reducer never sees one, so a gate here would report permitted against nothing.
  async function dmRedact(eventId) {
    if (!_dmRoomId) return { ok: false, reason: "no-room" };
    if (!eventId) return { ok: false, reason: "no-target" };
    try { await MatrixBridge.redactEvent(_dmRoomId, eventId); }
    catch (e) {
      const msg = (e && e.message) || "";
      Logger.warn("Chat: DM redact failed — " + msg);
      return { ok: false, reason: /403|forbidden/i.test(msg) ? "forbidden" : "redact-failed", error: msg };
    }
    return { ok: true };
  }
  function onDMChange(fn) { _onDMChange = fn; }
  function _dmChanged() { if (_onDMChange) { try { _onDMChange(); } catch (e) {} } }

  // Bind every DM room this account knows about, from Matrix's own `m.direct` mapping, and
  // reconcile the device-local index against it. Called once per session, not per room: a
  // conversation is not inside a DDJP room and does not come and go with one.
  function dmInit() {
    let ids = [];
    try { ids = MatrixBridge.dmRoomIds() || []; } catch (e) { ids = []; }
    try { MatrixBridge.setDMScope(ids); } catch (e) {}
    MatrixBridge.onRawEvent(_handleDMRaw);
    Logger.debug("Chat: DM scope bound for " + ids.length + " conversation(s)");
    return ids.length;
  }

  // ── PENDING DM REQUESTS (gap 1) ───────────────────────────────────────────────────────────
  // Reported, never bound. `dmInit` deliberately does NOT add these to scope: DM scope is the only
  // thing `_handleDMRaw` filters on, so binding an invite would let anyone put a room into this
  // account's DM channel by inviting it. Accepting is what binds, and it binds through the same
  // `addDMScope` a conversation this account started goes through — one path into the filter.
  function dmInvites() {
    try { return MatrixBridge.dmInviteRoomIds() || []; } catch (e) { return []; }
  }
  async function acceptDMInvite(roomId) {
    if (!roomId) return { ok: false, reason: "no-room" };
    let res = null;
    try { res = await MatrixBridge.acceptDMInvite(roomId); }
    catch (e) { Logger.warn("Chat: accept failed — " + (e && e.message)); return { ok: false, reason: "join-failed" }; }
    // THE RECORD IS REPORTED, NOT ASSUMED. Joining without recording leaves the conversation
    // joined and invisible to `findDMRoom`, which is what made the next attempt create a second
    // room. A caller that cannot tell the two apart cannot warn anybody.
    const recorded = !!(res && res.recorded);
    if (!recorded) Logger.warn("Chat: joined " + roomId + " but the conversation was not recorded");
    // BOUND ONLY NOW, and through the same seam as every other conversation.
    try { MatrixBridge.addDMScope(roomId); } catch (e) {}
    _dmChanged();
    return { ok: true, roomId: roomId, recorded: recorded,
             userId: (res && res.userId) || null };
  }
  async function declineDMInvite(roomId) {
    if (!roomId) return { ok: false, reason: "no-room" };
    try { await MatrixBridge.declineDMInvite(roomId); }
    catch (e) { Logger.warn("Chat: decline failed — " + (e && e.message)); return { ok: false, reason: "leave-failed" }; }
    // NOT added to scope, and nothing to remove — declining leaves the room and the filter never
    // heard of it. That asymmetry is the point: refusing costs nothing and grants nothing.
    _dmChanged();
    return { ok: true, roomId: roomId };
  }

  function dmDestroy() {
    MatrixBridge.offRawEvent(_handleDMRaw);
    _dmRoomId = null;
  }

  // The DM receive path. It filters on `inDMScope` — the room the event ARRIVED in — and never on
  // anything the body says, which is P6 applied to Skin: origin decides. A message from a room
  // this client has not bound as a conversation is not a DM, however it is shaped.
  function _handleDMRaw(raw, event, room) {
    // ── THE SAME DOOR, FOR REDACTIONS TOO (gap 4) ───────────────────────────────────────────
    // J11 built redaction for room chat and the DM path inherited none of it. The scope test goes
    // FIRST and is unchanged — a deletion from a room this account has not bound is not a deletion
    // of ours, however it is shaped, which is the same posture the message path has.
    if (raw.type !== "m.room.message" && raw.type !== "m.room.redaction") return;
    let mine = false;
    try { mine = !!MatrixBridge.inDMScope(raw.room_id); } catch (e) { mine = false; }
    if (!mine) return;

    if (raw.type === "m.room.redaction") {
      // NO TARGET, NO ACTION — the same refusal room chat makes. Guessing would delete the wrong
      // row, and `redacts` is the only field naming what was deleted.
      const target = raw.redacts;
      if (!target) { Logger.warn("Chat: DM redaction with no target id"); return; }
      if (_onDMRedaction) _onDMRedaction(target, raw.room_id, raw.sender);
      return;
    }
    const failed = !!(event && event.isDecryptionFailure && event.isDecryptionFailure());
    const body = _sanitize(raw.content.body || "");
    // The INDEX moves for every conversation; only the OPEN one is rendered. That is what makes
    // the notification a fact about the panel rather than about the current view — a message in a
    // conversation you are not looking at is exactly the case the badge exists for.
    let myId = null;
    try { myId = MatrixBridge.getUserId(); } catch (e) {}
    const other = (raw.sender && raw.sender !== myId) ? raw.sender : _otherOf(raw.room_id);
    try { ChatPrefs.dmTouch(raw.room_id, other, raw.ts); } catch (e) {}
    // My own message is not a notification to me: the marker follows my own send forward so the
    // conversation does not light up because I spoke in it.
    if (raw.sender === myId) { try { ChatPrefs.dmMarkRead(raw.room_id, raw.ts); } catch (e) {} }
    if (raw.room_id === _dmRoomId) {
      try { ChatPrefs.dmMarkRead(raw.room_id, raw.ts); } catch (e) {}
      if (_onDMMessage) _onDMMessage(raw.event_id, raw.sender, body, failed, raw.ts, raw.room_id);
    }
    _dmChanged();
  }

  function _otherOf(roomId) {
    try {
      const row = ChatPrefs.dmList().find((r) => r.roomId === roomId);
      return (row && row.userId) || "";
    } catch (e) { return ""; }
  }

  // Find-or-create the conversation with `userId` and make it the open one. Returns a STATUS
  // rather than throwing, the same contract `send` uses, so the card and the panel can render a
  // refusal instead of dropping an uncaught rejection.
  async function openDM(userId) {
    if (!userId) return { ok: false, reason: "no-user" };
    let me = null;
    try { me = MatrixBridge.getUserId(); } catch (e) {}
    // Messaging yourself is refused HERE rather than by hiding the control, because the adapter's
    // availability check cannot see the target (`describe` hands `avail` the room state only), and
    // a rule enforced by a hidden button is a rule with no enforcer.
    if (me && userId === me) return { ok: false, reason: "self" };
    let roomId = null;
    try { roomId = MatrixBridge.findDMRoom(userId); } catch (e) {}
    if (!roomId) {
      try { roomId = await MatrixBridge.createDM(userId); }
      catch (e) {
        Logger.warn("Chat: openDM failed — " + (e && e.message));
        return { ok: false, reason: "create-failed", error: (e && e.message) || "" };
      }
    }
    try { MatrixBridge.addDMScope(roomId); } catch (e) {}
    try { ChatPrefs.dmTouch(roomId, userId, 0); } catch (e) {}
    _dmRoomId = roomId;
    try { ChatPrefs.dmMarkRead(roomId, Date.now()); } catch (e) {}
    _dmChanged();
    return { ok: true, roomId: roomId, userId: userId };
  }

  // Open a conversation the index already holds (the panel's list click). No room is created and
  // no invite is sent — this is navigation, not a new conversation.
  function openDMRoom(roomId) {
    if (!roomId) return { ok: false, reason: "no-room" };
    let mine = false;
    try { mine = !!MatrixBridge.inDMScope(roomId); } catch (e) {}
    if (!mine) return { ok: false, reason: "not-a-dm" };
    _dmRoomId = roomId;
    try { ChatPrefs.dmMarkRead(roomId, Date.now()); } catch (e) {}
    _dmChanged();
    return { ok: true, roomId: roomId };
  }

  function closeDM() { _dmRoomId = null; _dmChanged(); }
  function currentDM() { return _dmRoomId; }

  // Send into the open conversation. Routed through `MatrixBridge.sendMessage` — the CHAT door —
  // and never `sendEvent`, which is the Spine door and stamps a Lamport position.
  async function sendDM(text) {
    if (!_dmRoomId) return { ok: false, reason: "no-room" };
    const safe = _sanitize((text == null ? "" : String(text)).trim());
    if (!safe) return { ok: false, reason: "empty" };
    if (!cryptoReady()) return { ok: false, reason: "no-crypto" };
    try {
      await MatrixBridge.sendMessage(_dmRoomId, safe);
      return { ok: true };
    } catch (e) {
      const msg = (e && e.message) || "";
      Logger.warn("Chat: DM send failed — " + msg);
      return { ok: false, reason: /encryption/i.test(msg) ? "no-crypto" : "send-failed", error: msg };
    }
  }

  // One capped backfill for a conversation, the same present-forward policy as room chat: a DM
  // panel that opened blank every time would push people to Element for the last thing said.
  async function backfillDM(count) {
    if (!_dmRoomId) return { messages: [] };
    let res;
    try { res = await MatrixBridge.recentChatMessages(_dmRoomId, count); }
    catch (e) { Logger.warn("Chat: DM backfill failed: " + (e && e.message)); return { messages: [] }; }
    const out = [];
    for (const m of (res.messages || [])) {
      out.push({ id: m.event_id, sender: m.sender, body: _sanitize(m.body || ""), failed: !!m.failed, ts: m.ts });
    }
    return { messages: out };
  }

  // The list the panel renders: newest conversation first, each with its unread flag. Read from
  // the device-local index, never from room state.
  function conversations() {
    let rows = [];
    try { rows = ChatPrefs.dmList(); } catch (e) { rows = []; }
    return rows.map((r) => ({
      roomId: r.roomId, userId: r.userId, lastTs: r.lastTs,
      unread: r.lastTs > r.readTs,
    }));
  }
  function dmUnreadCount() { try { return ChatPrefs.dmUnreadCount(); } catch (e) { return 0; } }
  function clearConversations() { try { ChatPrefs.dmClear(); } catch (e) {} _dmChanged(); }

  return { init, destroy, setRoom, setReadableTiers, readableTiers,
           onMessage, onRedaction, redact, send, sendTo, backfillRecent, cryptoReady, retryCrypto,
           dmInit, dmDestroy, openDM, openDMRoom, closeDM, currentDM, sendDM, backfillDM,
           onDMMessage, onDMRedaction, dmRedact,
           dmInvites, acceptDMInvite, declineDMInvite,
           onDMChange, conversations, dmUnreadCount, clearConversations };
})();
