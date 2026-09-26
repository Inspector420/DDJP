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
  // ── THE 512-CHARACTER LIMIT — ONE CHECK, SENDING AND RECEIVING (owner ruling, ddjp_430) ───────────
  // No message over MAX_CHARS may be sent, and one arriving over it — from another Matrix app, which
  // has no such limit — is not shown. PILLARS §4 is why there is ONE function and not two: a write-side
  // check and a read-side check that are separate copies drift, and then this app sends what it refuses
  // to show, or refuses to send what it would show. Every send path and every receive path below asks
  // `isTooLong`, and `check-chat-view` PART I drives the boundary both ways at 511, 512 and 513.
  //
  // COUNTED AS A PERSON SEES IT, AND THE SAME EVERYWHERE. Code points, so an emoji counts once where
  // `.length` would count two. Not grapheme clusters: `Intl.Segmenter` is not in every browser, and a
  // limit that two clients count differently is two limits — a message one shows and another hides.
  //
  // AN OVER-LONG MESSAGE IS KEPT ONLY AS THE FACT THAT IT ARRIVED. Its body is dropped at this door,
  // so it never sits in RAM. In a room chat it can appear as the chat event below — off by default, its
  // own box in the settings panel; in a DM the row says so. It is a CHAT event kind rather than one of
  // `Room.FEED_KINDS`, because chat never reaches the room's log and that table is the log's vocabulary.
  const MAX_CHARS = 512;
  function charCount(text) { return Array.from(text == null ? "" : String(text)).length; }
  function isTooLong(text) { return charCount(text) > MAX_CHARS; }
  const TOO_LONG = "chat.too-long";
  const EVENT_KINDS = Object.freeze({
    [TOO_LONG]: Object.freeze({ verb: "sent a message that was too long to show", shownByDefault: false }),
  });

  // ── A MENTION IS YOUR FULL MATRIX ID, AS A WORD (owner ruling, ddjp_431) ─────────────────────────
  // Never a display name: names are not unique and can change, so matching them would ping the wrong
  // people ("DJ"). Case-insensitive (Matrix IDs are lowercase by spec; people type what they like).
  // "As a word" means the characters either side are not ID characters, so `@me:hs2` and `x@me:hs` do
  // not mention `@me:hs` — except that a trailing `.` or `:` ends a sentence unless an ID character
  // follows it (`@me:hs.` mentions; `@me:hs.org` is somebody else). Pure: the UI asks, this answers.
  const _ID_CHAR = /[a-z0-9._=\-/+:@]/;
  function mentions(body, userId) {
    if (typeof body !== "string" || !body || typeof userId !== "string" || !userId) return false;
    const hay = body.toLowerCase(), id = userId.toLowerCase();
    for (let i = hay.indexOf(id); i >= 0; i = hay.indexOf(id, i + 1)) {
      const before = i > 0 ? hay[i - 1] : "", after = hay[i + id.length] || "", next = hay[i + id.length + 1] || "";
      const okBefore = !before || !_ID_CHAR.test(before);
      const okAfter = !after || !_ID_CHAR.test(after) || ((after === "." || after === ":") && (!next || !_ID_CHAR.test(next)));
      if (okBefore && okAfter) return true;
    }
    return false;
  }

  // What the @ button puts in your box: the person's full Matrix ID, or a refusal if it is not one
  // (`@localpart:server`). Owned here, beside `mentions`, so what gets inserted and what counts as a
  // mention are one module's two halves of one definition.
  function mentionText(userId) {
    const id = (typeof userId === "string") ? userId.trim() : "";
    if (!/^@[^\s:]+:\S+$/.test(id)) return { ok: false, reason: "no-user" };
    return { ok: true, text: id };
  }

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
    const body = _sanitize(raw.content.body || "");
    const long = isTooLong(body);                 // the one check — the body goes no further if it fails
    // THE CHANNEL ID TRAVELS WITH THE MESSAGE. Appended rather than inserted, so every existing
    // caller keeps the arity it was written against — and the consumer needs it, because with more
    // than one channel arriving the message no longer says which view it belongs to. Without this
    // the UI would file every message under whichever tier happened to be selected when it landed.
    // EVERY listener, and one that throws must not stop the others — a renderer bug would
    // otherwise silence the bot's observation, and vice versa.
    for (const fn of _msgListeners) {
      // `tooLong` is APPENDED, so every listener keeps the arity it was written against.
      try { fn(raw.event_id, raw.sender, long ? "" : body, failed, raw.ts, raw.room_id, long); }
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
  // Whether this client may delete somebody ELSE'S message in the chat room it is showing. `ui/`
  // may not reach the transport (`check-boundaries` rule D), so it asks here.
  function mayRedactOthers() {
    try { return !!currentChatId && MatrixBridge.mayRedactIn(currentChatId); } catch (e) { return false; }
  }

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
    if (isTooLong(safe)) return { ok: false, reason: "too-long", count: charCount(safe), max: MAX_CHARS };
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
    try { return !!(MatrixAccount.cryptoAvailable && MatrixAccount.cryptoAvailable()); }
    catch (e) { return false; }
  }
  async function retryCrypto() {
    try { return !!(MatrixAccount.retryCrypto && await MatrixAccount.retryCrypto()); }
    catch (e) { Logger.warn("Chat: retryCrypto failed — " + (e && e.message)); return false; }
  }

  // One-shot recent backfill when a room's chat starts: a SINGLE capped fetch of
  // the most recent `count` messages of the ACTIVE channel (currentChatId — the
  // room-settings default tier, guest vs uncategorized). Present-forward after:
  // no scroll paging, never asks again. Whatever the server returns (possibly
  // fewer than `count`, possibly zero) is mapped oldest->newest; the render buffer
  // dedups by id. Undecryptable messages are carried through as failed (the
  // renderer hides them). Degrades to {messages:[]} on any transport error.
  //
  // ── ONE CHANNEL AT A TIME, AND ANY READABLE ONE (ddjp_425) ─────────────────────────────────
  // `chatId` is optional and appended, so every existing caller keeps the arity it was written
  // against and still gets the active channel. The chat panel now passes each readable tier in
  // turn, because a person joining a room should find the last few messages in EVERY tier they
  // can read — the tree before this fetched the active channel alone, and every other tier opened
  // empty until somebody spoke in it.
  //
  // FAIL CLOSED ON A CHANNEL WE MAY NOT RECEIVE FROM. The readable set is the door `_handleRaw`
  // enforces; a fetch that ignored it would be a second door into the same messages with no gate,
  // which is the two-doors shape `roles.md` §7b records for the ingest path.
  async function backfillRecent(count, chatId) {
    const target = (typeof chatId === "string" && chatId) ? chatId : currentChatId;
    if (!target) return { messages: [] };
    // Strict, so an UNBOUND client (empty set) admits nothing — the same direction `_handleRaw` fails.
    // The active channel is always in the set: `init` seeds it and `setRoom` adds it.
    if (_readable.indexOf(target) < 0) return { messages: [] };
    let res;
    try { res = await MatrixBridge.recentChatMessages(target, count); }
    catch (e) { Logger.warn("Chat: backfill failed: " + (e && e.message)); return { messages: [] }; }
    const out = [];
    for (const m of (res.messages || [])) {
      const b = _sanitize(m.body || ""), long = isTooLong(b);
      out.push({ id: m.event_id, sender: m.sender, body: long ? "" : b, failed: !!m.failed, ts: m.ts, tooLong: long });
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
  let _dmRoomId = null;      // the room a reply goes to right now (null = none yet)
  // ── A CONVERSATION IS A PERSON (owner ruling, ddjp_432) ──────────────────────────────────────────
  // `_dmPerson` is who the open conversation is WITH. Every one-to-one room with them belongs to it:
  // their messages from any of those rooms reach the panel, the history is all of them merged, and a
  // reply goes to `MatrixAccount.findDMRoom(person)` — picked at SEND time, so if they start writing in
  // another room (a wrong step in Element), the reply follows them there. `_dmRoomId` is only the last
  // answer, kept for callers that ask which room is open.
  let _dmPerson = null;
  const _dmCreating = Object.create(null);   // person -> the one in-flight room creation for them
  let _onDMNotify = null;                     // "somebody else's NEW message arrived in a DM" (the chime)
  // Is the open conversation ON SCREEN (ddjp_441)? Only then is an arriving message read on arrival — an open
  // conversation behind another tab or pane used to swallow the message and light nothing. The UI says; the
  // moment it becomes visible, what arrived meanwhile is read.
  let _dmVisible = true;
  function setDMVisible(v) {
    const was = _dmVisible;
    _dmVisible = !!v;
    if (_dmVisible && !was && _dmPerson) _markPersonRead(_dmPerson);
  }
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
  function onDMNotify(fn) { _onDMNotify = fn; }
  function _dmChanged() { if (_onDMChange) { try { _onDMChange(); } catch (e) {} } }

  // Bind every DM room this account knows about, from Matrix's own `m.direct` mapping, and
  // reconcile the device-local index against it. Called once per session, not per room: a
  // conversation is not inside a DDJP room and does not come and go with one.
  function dmInit() {
    let ids = [];
    try { ids = MatrixAccount.dmRoomIds() || []; } catch (e) { ids = []; }
    try { MatrixAccount.setDMScope(ids); } catch (e) {}
    MatrixBridge.onRawEvent(_handleDMRaw);
    _seenInvites = new Set(dmInvites().map((i) => i.roomId));
    try { if (MatrixBridge.onRoomsChanged) MatrixBridge.onRoomsChanged(_dmInvitesMaybeChanged); } catch (e) {}
    // Record rooms Matrix marks direct that `m.direct` does not list (ddjp_432) — append-only, and only when
    // something is missing — so Element and this app see the same conversations.
    try { const p = MatrixAccount.repairDirect && MatrixAccount.repairDirect(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    Logger.debug("Chat: DM scope bound for " + ids.length + " conversation(s)");
    return ids.length;
  }

  // ── PENDING DM REQUESTS (gap 1) ───────────────────────────────────────────────────────────
  // Reported, never bound. `dmInit` deliberately does NOT add these to scope: DM scope is the only
  // thing `_handleDMRaw` filters on, so binding an invite would let anyone put a room into this
  // account's DM channel by inviting it. Accepting is what binds, and it binds through the same
  // `addDMScope` a conversation this account started goes through — one path into the filter.
  function dmInvites() {
    try { return MatrixAccount.dmInviteRoomIds() || []; } catch (e) { return []; }
  }

  // ── A REQUEST IS A CONVERSATION ROW (owner rulings, ddjp_433) ──────────────────────────────────
  // Answered PER PERSON: Accept joins every invite that person has sent (they are one conversation to
  // us, so joining some and not others would leave part of it unreachable); Refuse declines them all.
  // ONE ANSWER AT A TIME per person — a second click while the first is in flight gets the first's
  // result, so a double click cannot join twice or accept-then-decline. `key` is the inviter's ID, or
  // `invite:<roomId>` when the transport could not say who asked.
  const _dmAnswering = Object.create(null);
  function _requestRooms(key) {
    return dmInvites().filter((i) => (i.from || ("invite:" + i.roomId)) === key).map((i) => i.roomId);
  }
  function _answerRequest(key, fn) {
    if (!key) return Promise.resolve({ ok: false, reason: "no-user" });
    if (_dmAnswering[key]) return _dmAnswering[key];
    _dmAnswering[key] = (async () => {
      const ids = _requestRooms(key);
      if (!ids.length) return { ok: false, reason: "no-request" };
      let done = 0;
      for (const id of ids) { const r = await fn(id); if (r && r.ok) done++; }
      _dmChanged();
      return { ok: done > 0, answered: done, of: ids.length };
    })().finally(() => { delete _dmAnswering[key]; });
    return _dmAnswering[key];
  }
  function dmAnswering(key) { return !!(key && _dmAnswering[key]); }   // for the UI to SHOW, never to enforce
  function acceptDMRequest(key) { return _answerRequest(key, acceptDMInvite); }
  function declineDMRequest(key) { return _answerRequest(key, declineDMInvite); }

  // A NEW REQUEST IS NOTICED (ddjp_433). Nothing signalled an invite before this: the panel re-read them
  // only when something else redrew it, so a request got no dot and no chime. The transport's room-list
  // signal fires on our membership changing, which an invite is; invites already there at start are
  // SEEN (shown with the dot, never chimed — they are not new), and a new one is announced once.
  let _seenInvites = null;
  function _dmInvitesMaybeChanged() {
    if (!_seenInvites) return;
    // SCOPE FOLLOWS THE ROOMS (ddjp_437): a one-to-one room joined since entry — from Element, or recognised
    // once its members loaded — is received from now on, not after the next room entry. `dmRoomIds` is only
    // one-to-one rooms, so this never widens scope to a group room.
    try { for (const id of (MatrixAccount.dmRoomIds() || [])) if (!MatrixAccount.inDMScope(id)) MatrixAccount.addDMScope(id); } catch (e) {}
    const now = dmInvites();
    let moved = now.length !== _seenInvites.size;
    for (const inv of now) {
      if (_seenInvites.has(inv.roomId)) continue;
      _seenInvites.add(inv.roomId);
      moved = true;
      if (_onDMNotify) { try { _onDMNotify(inv.roomId, inv.from, inv.ts); } catch (e) {} }
    }
    for (const id of Array.from(_seenInvites)) if (!now.some((i) => i.roomId === id)) _seenInvites.delete(id);
    if (moved) _dmChanged();
  }
  async function acceptDMInvite(roomId) {
    if (!roomId) return { ok: false, reason: "no-room" };
    let res = null;
    try { res = await MatrixAccount.acceptDMInvite(roomId); }
    catch (e) { Logger.warn("Chat: accept failed — " + (e && e.message)); return { ok: false, reason: "join-failed" }; }
    // THE RECORD IS REPORTED, NOT ASSUMED. Joining without recording leaves the conversation
    // joined and invisible to `findDMRoom`, which is what made the next attempt create a second
    // room. A caller that cannot tell the two apart cannot warn anybody.
    const recorded = !!(res && res.recorded);
    if (!recorded) Logger.warn("Chat: joined " + roomId + " but the conversation was not recorded");
    // BOUND ONLY NOW, and through the same seam as every other conversation.
    try { MatrixAccount.addDMScope(roomId); } catch (e) {}
    _dmChanged();
    return { ok: true, roomId: roomId, recorded: recorded,
             userId: (res && res.userId) || null };
  }
  async function declineDMInvite(roomId) {
    if (!roomId) return { ok: false, reason: "no-room" };
    try { await MatrixAccount.declineDMInvite(roomId); }
    catch (e) { Logger.warn("Chat: decline failed — " + (e && e.message)); return { ok: false, reason: "leave-failed" }; }
    // NOT added to scope, and nothing to remove — declining leaves the room and the filter never
    // heard of it. That asymmetry is the point: refusing costs nothing and grants nothing.
    _dmChanged();
    return { ok: true, roomId: roomId };
  }

  function dmDestroy() {
    try { if (MatrixBridge.offRoomsChanged) MatrixBridge.offRoomsChanged(_dmInvitesMaybeChanged); } catch (e) {}
    _seenInvites = null;
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
    try { mine = !!MatrixAccount.inDMScope(raw.room_id); } catch (e) { mine = false; }
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
    const b = _sanitize(raw.content.body || ""), long = isTooLong(b);   // the one check
    const body = long ? "" : b;
    // The INDEX moves for every conversation; only the OPEN one is rendered. That is what makes
    // the notification a fact about the panel rather than about the current view — a message in a
    // conversation you are not looking at is exactly the case the badge exists for.
    let myId = null;
    try { myId = MatrixBridge.getUserId(); } catch (e) {}
    let other = (raw.sender && raw.sender !== myId) ? raw.sender : _otherOf(raw.room_id);
    if (!other) { try { other = MatrixAccount.dmPeerOf ? MatrixAccount.dmPeerOf(raw.room_id) : null; } catch (e) { other = null; } }
    // NEW, not merely arrived: newer than anything this room's index row has seen. History (a backfill,
    // an initial sync of what was already read) is not new, so it does not chime.
    let prevTs = 0;
    try { const row = (ChatPrefs.dmList() || []).find((r) => r.roomId === raw.room_id); prevTs = row ? row.lastTs : 0; } catch (e) { prevTs = 0; }
    try { ChatPrefs.dmTouch(raw.room_id, other, raw.ts); } catch (e) {}
    if (_onDMNotify && raw.sender !== myId && !failed && (Number(raw.ts) || 0) > prevTs) {
      try { _onDMNotify(raw.room_id, raw.sender, raw.ts); } catch (e) {}
    }
    // My own message is not a notification to me: the marker follows my own send forward so the
    // conversation does not light up because I spoke in it.
    if (raw.sender === myId) { try { ChatPrefs.dmMarkRead(raw.room_id, raw.ts); } catch (e) {} }
    // THE OPEN CONVERSATION IS A PERSON: a message from ANY of their rooms reaches the panel.
    if (raw.room_id === _dmRoomId || (_dmPerson && other === _dmPerson)) {
      if (_dmVisible) { try { ChatPrefs.dmMarkRead(raw.room_id, raw.ts); } catch (e) {} }
      if (_onDMMessage) _onDMMessage(raw.event_id, raw.sender, body, failed, raw.ts, raw.room_id, long);
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
    // REUSE FIRST: any usable room with them, by the one rule in `pickDMRoom`.
    let roomId = null;
    try { roomId = MatrixAccount.findDMRoom(userId); } catch (e) {}
    if (!roomId) {
      // ONE CREATION AT A TIME PER PERSON. A second click while the first room is being made waits for
      // that room rather than making another — the tree before this made two.
      if (!_dmCreating[userId]) {
        _dmCreating[userId] = Promise.resolve()
          .then(() => MatrixAccount.createDM(userId))
          .finally(() => { delete _dmCreating[userId]; });
      }
      try { roomId = await _dmCreating[userId]; }
      catch (e) {
        Logger.warn("Chat: openDM failed — " + (e && e.message));
        return { ok: false, reason: "create-failed", error: (e && e.message) || "" };
      }
    }
    try { MatrixAccount.addDMScope(roomId); } catch (e) {}
    try { ChatPrefs.dmTouch(roomId, userId, 0); } catch (e) {}
    _dmPerson = userId;
    _dmRoomId = roomId;
    _markPersonRead(userId);
    _dmChanged();
    return { ok: true, roomId: roomId, userId: userId };
  }

  // Open a conversation the index already holds (the panel's list click). No room is created and
  // no invite is sent — this is navigation, not a new conversation.
  function openDMRoom(roomId) {
    if (!roomId) return { ok: false, reason: "no-room" };
    let mine = false;
    try { mine = !!MatrixAccount.inDMScope(roomId); } catch (e) {}
    if (!mine) {
      // GRACEFUL, AND STILL SAFE (ddjp_437). Scope was computed at room entry, so a room joined since — one
      // somebody opened from Element — was refused SILENTLY, and kept being refused until the room was
      // re-entered. If this room's person has one-to-one rooms with us, those rooms ARE the conversation:
      // take them into scope and open it. Anything else — a group room, a room we left — is still refused.
      let who = null;
      try { who = _otherOf(roomId) || (MatrixAccount.dmPeerOf ? MatrixAccount.dmPeerOf(roomId) : null); } catch (e) { who = null; }
      let theirs = [];
      try { theirs = who ? (MatrixAccount.dmRoomsWith(who) || []) : []; } catch (e) { theirs = []; }
      // A ROOM OUR OWN INDEX HELD, WITH NO LABEL (ddjp_438). Reported as "could not be opened": a joined
      // one-to-one room that `m.direct` does not list and whose member events carry no `is_direct` (the flag
      // rides on the invite; joining replaces it) was refused. Our index only ever holds rooms that were in
      // DM scope, so a held room that is joined with exactly one other person IS that conversation: open it
      // and append it to `m.direct`, so it stays recognised here and in Element. Evidence first — an
      // unlabelled room we never held is not taken in on a member count alone.
      let why = "not-a-dm";
      if (!theirs.some((r) => r.roomId === roomId)) {
        let held = false;
        try { held = (ChatPrefs.dmList() || []).some((r) => r.roomId === roomId); } catch (e) { held = false; }
        let one = { peer: null, reason: null };
        try { one = held && MatrixAccount.oneToOnePeer ? (MatrixAccount.oneToOnePeer(roomId) || one) : one; } catch (e) {}
        if (one.peer && (!who || who === one.peer)) {
          who = one.peer;
          theirs = theirs.concat([{ roomId: roomId, userId: one.peer, other: "join", lastTs: 0 }]);
          try { const p = MatrixAccount.recordDirect && MatrixAccount.recordDirect(one.peer, roomId); if (p && p.catch) p.catch(() => {}); } catch (e) {}
        } else if (one.reason) {
          why = one.reason;
        }
      }
      if (!theirs.length) {
        // GONE, LEFT OR EMPTY, WITH A KNOWN PERSON (ddjp_439): the conversation is with THEM, so it opens,
        // with no room yet — the first message starts one, through `openDM`'s one-at-a-time path (the owner's
        // rule: create only when no usable room exists). Not when merely NOT LOADED: a room made then could
        // duplicate one that is about to appear.
        if (who && (why === "gone" || why === "left" || why === "alone")) {
          _dmPerson = who;
          _dmRoomId = null;
          _markPersonRead(who);
          _dmChanged();
          return { ok: true, roomId: null, userId: who, fresh: true };
        }
        return { ok: false, reason: why };
      }
      for (const r of theirs) { try { MatrixAccount.addDMScope(r.roomId); } catch (e) {} }
      if (!theirs.some((r) => r.roomId === roomId)) roomId = theirs[0].roomId;
    }
    // The list opens a PERSON: whoever this room is with, all of their rooms, the reply target picked
    // by the one rule (falling back to the clicked room if the client cannot tell).
    let person = null;
    try { person = _otherOf(roomId) || (MatrixAccount.dmPeerOf ? MatrixAccount.dmPeerOf(roomId) : null); } catch (e) { person = null; }
    // The index may not know who a room is with (only our own messages seen): ask the room (ddjp_438).
    if (!person) { try { const one = MatrixAccount.oneToOnePeer ? MatrixAccount.oneToOnePeer(roomId) : null; person = (one && one.peer) || null; } catch (e) { person = null; } }
    _dmPerson = person;
    let target = null;
    try { target = person ? MatrixAccount.findDMRoom(person) : null; } catch (e) { target = null; }
    _dmRoomId = target || roomId;
    if (person) _markPersonRead(person); else { try { ChatPrefs.dmMarkRead(roomId, 0); } catch (e) {} }
    _dmChanged();
    return { ok: true, roomId: _dmRoomId, userId: person };
  }

  // READ MARKERS IN SERVER TIME (ddjp_432). Every index row for this person is marked read at ITS OWN
  // newest server stamp. The tree before this marked read at `Date.now()` — the device clock against
  // server stamps (README trap 2) — so a device clock ahead of the server hid new messages.
  function _markPersonRead(person) {
    let rows = [];
    try { rows = ChatPrefs.dmList() || []; } catch (e) { rows = []; }
    for (const r of rows) if (r.userId === person) { try { ChatPrefs.dmMarkRead(r.roomId, r.lastTs); } catch (e) {} }
  }

  function closeDM() { _dmRoomId = null; _dmPerson = null; _dmChanged(); }
  function currentDM() { return _dmRoomId; }
  function currentDMPerson() { return _dmPerson; }

  // Send into the open conversation. Routed through `MatrixBridge.sendMessage` — the CHAT door —
  // and never `sendEvent`, which is the Spine door and stamps a Lamport position.
  async function sendDM(text) {
    // THE TARGET IS PICKED NOW, not remembered: if they have moved to another room, the reply follows.
    if (_dmPerson) {
      let t = null;
      try { t = MatrixAccount.findDMRoom(_dmPerson); } catch (e) { t = null; }
      if (t) _dmRoomId = t;
      else {
        // Every room with them is unusable (they left): make one — through `openDM`'s one-at-a-time path.
        const r = await openDM(_dmPerson);
        if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || "no-room" };
      }
    }
    if (!_dmRoomId) return { ok: false, reason: "no-room" };
    const safe = _sanitize((text == null ? "" : String(text)).trim());
    if (!safe) return { ok: false, reason: "empty" };
    if (isTooLong(safe)) return { ok: false, reason: "too-long", count: charCount(safe), max: MAX_CHARS };
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
    if (!_dmRoomId && !_dmPerson) return { messages: [] };
    // Every room with the person (ddjp_432), merged in server time and de-duplicated by event id.
    let ids = [];
    try { ids = _dmPerson ? (MatrixAccount.dmRoomsWith(_dmPerson) || []).map((r) => r.roomId) : []; } catch (e) { ids = []; }
    if (_dmRoomId && ids.indexOf(_dmRoomId) < 0) ids.push(_dmRoomId);
    const all = [];
    for (const id of ids) {
      try { const r = await MatrixBridge.recentChatMessages(id, count); for (const m of ((r && r.messages) || [])) all.push(m); }
      catch (e) { Logger.warn("Chat: DM backfill failed for " + id + ": " + (e && e.message)); }
    }
    const seen = {};
    const res = { messages: all.filter((m) => m && m.event_id && !seen[m.event_id] && (seen[m.event_id] = true))
                               .sort((a, b) => ((a.ts || 0) - (b.ts || 0)) || (a.event_id < b.event_id ? -1 : 1)) };
    const out = [];
    for (const m of (res.messages || [])) {
      const b = _sanitize(m.body || ""), long = isTooLong(b);
      out.push({ id: m.event_id, sender: m.sender, body: long ? "" : b, failed: !!m.failed, ts: m.ts, tooLong: long });
    }
    return { messages: out };
  }

  // The list the panel renders: newest conversation first, each with its unread flag. Read from
  // the device-local index, never from room state.
  function conversations() {
    let rows = [];
    try { rows = ChatPrefs.dmList(); } catch (e) { rows = []; }
    // ONE ROW PER PERSON (ddjp_432). Every room with them folds into one conversation: unread if any is,
    // its time the newest of them, its `roomId` the room that newest message is in (what the list opens).
    const by = new Map();
    for (const r of rows) {
      const key = r.userId || ("room:" + r.roomId);
      const g = by.get(key) || { userId: r.userId || null, roomIds: [], roomId: r.roomId, lastTs: -1, unread: false };
      if (g.roomIds.indexOf(r.roomId) < 0) g.roomIds.push(r.roomId);
      if (r.lastTs > g.lastTs) { g.lastTs = r.lastTs; g.roomId = r.roomId; }
      if (r.lastTs > r.readTs) g.unread = true;
      by.set(key, g);
    }
    // REQUESTS JOIN THE SAME ROWS (ddjp_433): one per person, merged into an existing conversation with
    // them, unread until answered, dated by when they asked.
    for (const inv of dmInvites()) {
      const key = inv.from || ("invite:" + inv.roomId);
      const g = by.get(key) || { userId: inv.from || null, roomIds: [], roomId: null, lastTs: -1, unread: false };
      g.request = true;
      g.requests = (g.requests || []).concat([inv.roomId]);
      g.requestKey = key;
      g.unread = true;
      if ((Number(inv.ts) || 0) > g.lastTs) g.lastTs = Number(inv.ts) || 0;
      by.set(key, g);
    }
    return Array.from(by.values()).sort((a, b) => (b.lastTs - a.lastTs) || (String(a.userId) < String(b.userId) ? -1 : 1));
  }
  // People with something unread — one per person, however many rooms (ddjp_432).
  function dmUnreadCount() { try { return conversations().filter((c) => c.unread).length; } catch (e) { return 0; } }
  function clearConversations() { try { ChatPrefs.dmClear(); } catch (e) {} _dmChanged(); }

  return { init, destroy, setRoom, setReadableTiers, readableTiers, mayRedactOthers,
           MAX_CHARS, charCount, isTooLong, TOO_LONG, EVENT_KINDS, mentions, mentionText,
           onMessage, onRedaction, redact, send, sendTo, backfillRecent, cryptoReady, retryCrypto,
           dmInit, dmDestroy, openDM, openDMRoom, closeDM, currentDM, sendDM, backfillDM,
           onDMMessage, onDMRedaction, dmRedact, onDMNotify, currentDMPerson,
           dmInvites, acceptDMInvite, declineDMInvite, acceptDMRequest, declineDMRequest, dmAnswering, setDMVisible,
           onDMChange, conversations, dmUnreadCount, clearConversations };
})();
