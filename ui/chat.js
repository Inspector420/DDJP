// ui/chat.js
// CHAT · REACTIONS · THE DM PANEL · THE TIER STRIP · DELETING A MESSAGE — extracted from
// ui/interface.js at ddjp_392 as the sixth of the ten files roles.md §5 records.
//
// ── THIS CLUSTER TOOK THE HOLE ui/roster.js LEFT ─────────────────────────────────────────────
// `THE DM PANEL` sat in the MIDDLE of `JOIN BUTTON, ROSTER, UPGRADE` — a banner span that was
// otherwise the roster's. At ddjp_391 the roster was cut out around it, from the front and from
// the back, and the DM panel was left in place with no banner of its own. It comes here, because
// **a DM is a chat surface**: it shares `ChatBuffer`'s transition rules rather than copying them,
// which is the eighth signature's worked instance — `_dmFoldMessage` claiming *same rule as
// ChatBuffer* and then implementing it again.
//
// Assigned by the DOM surface it owns, not by enclosure (roles.md §5). Enclosure would have sent
// it to ui/roster.js for the accident of where it sits.
//
// ── `rightTab` IS OWNED BY ui/interface.js AND WRITTEN HERE ─────────────────────────────────
// One write in this file, nine there. **The setter goes where the value is owned**, so it is
// published through `UIBase.host` and this file calls `H.setRightTab()`. Worth noting that the
// roster measurement flagged `rightTab` as a HALT candidate and re-measuring on the corrected
// regions cleared it — the write was always this cluster's, sitting inside the DM hole.
//
// Depends on: UIBase, Interface (via UIBase.host), Chat, ChatBuffer, ChatPrefs, Room,
// MatrixBridge, Capabilities, Logger

const ChatPanels = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ REACTIONS
  //
  // Save and upvote, and their latched state.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // After any add/vote, refresh BOTH surfaces the affordances live on: the player bar
  // (persistent refs, updated in place) and the room-queue now-playing row (rebuilt).
  function _reflectReactions() {
    _syncNpButtons();
    if (H.queueTab() === "room") QueuePanels.renderQueuePanel();
  }
  // ★ press: capture the play-instance + song NOW (the picker is async and the song may
  // advance), open the same add-to-playlist picker History's ＋ uses, and only on a real
  // add emit ddjp.dj.save + latch the star lit for this instance. Cancelling saves nothing.
  // One-way: no-op once already saved this instance.
  function _onStarPress() {
    if (typeof Reactions !== "undefined" && Reactions.hasSaved && Reactions.hasSaved()) return;
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    if (!np || !np.song) return;
    const pi = np.pi != null ? np.pi : null;
    PlaylistPanels._openAddToPlaylist(np.song.videoId, async () => {
      if (typeof Actions !== "undefined" && Actions.perform) {
        try { await Actions.perform("react.save", { pi: pi }); } catch (e) { return; }
        _reflectReactions();
      }
    });
  }
  // ▲ press: emit ddjp.dj.vote for the current instance + latch. One-way (no un-vote).
  async function _onVotePress() {
    if (typeof Reactions === "undefined" || !Reactions.vote) return;
    if (Reactions.hasVoted && Reactions.hasVoted()) return;
    try { await Actions.perform("react.vote"); } catch (e) { return; }
    _reflectReactions();
  }
  // ★ button for a row (the room-queue now-playing row). Reflects Reactions.hasSaved():
  // ☆ outline when not yet saved this instance, ★ filled once saved. Acts on the current
  // song, so no videoId arg — it reads now-playing itself.
  function _starBtn() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const on = playing && typeof Reactions !== "undefined" && Reactions.hasSaved && Reactions.hasSaved();
    const _sc = _npCount("save");
    const b = H.el("button", { class: "mini ico grab np-react" + (on ? " on" : ""),
      title: !playing ? "Save to playlist (nothing playing)" : (on ? "Saved to a playlist" : "Save this song") },
      [H.el("span", { class: "np-ico", text: on ? "\u2605" : "\u2606" }),
       H.el("span", { class: "np-count" + (_sc.adjusted ? " adjusted" : ""), text: String(_sc.n), title: _sc.adjusted ? "owner-adjusted" : "" })]);
    b.disabled = !playing;
    b.onclick = _onStarPress;
    return b;
  }
  // ▲ upvote button for a row. Reflects Reactions.hasVoted().
  function _voteBtn() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const on = playing && typeof Reactions !== "undefined" && Reactions.hasVoted && Reactions.hasVoted();
    const _vc = _npCount("vote");
    const b = H.el("button", { class: "mini ico upvote np-react" + (on ? " on" : ""),
      title: !playing ? "Upvote (nothing playing)" : (on ? "Upvoted" : "Upvote this song") },
      [H.el("span", { class: "np-ico", text: "\u25B2" }),
       H.el("span", { class: "np-count" + (_vc.adjusted ? " adjusted" : ""), text: String(_vc.n), title: _vc.adjusted ? "owner-adjusted" : "" })]);
    b.disabled = !playing;
    b.onclick = _onVotePress;
    return b;
  }
  // The derived vote/save count for the now-playing song (from the reducer's counts map),
  // plus whether it was owner-adjusted. { n, adjusted }. 0 when nothing is playing / uncounted.
  function _npCount(kind) {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    if (!np || !np.song || !np.song.videoId) return { n: 0, adjusted: false };
    const st = (typeof Queue !== "undefined" && Queue.getState) ? Queue.getState() : null;
    // KEYED ON THE PLAYING, not the song. Two plays of one track are two different moments in the
    // room and carry their own figures — which is also what makes the ★/▲ affordance agree with
    // the number beside it, since the affordance was always keyed on the instance.
    const c = st && st.counts ? st.counts[np.pi] : null;
    if (!c) return { n: 0, adjusted: false };
    return kind === "save"
      ? { n: c.saves || 0, adjusted: !!c.savesAdjusted }
      : { n: c.votes || 0, adjusted: !!c.votesAdjusted };
  }
  function _applyCount(span, kind) {
    if (!span) return;
    const c = _npCount(kind);
    span.textContent = String(c.n);
    span.title = c.adjusted ? "owner-adjusted" : "";
    span.classList.toggle("adjusted", c.adjusted);
  }
  // Keep the player-bar ★/▲ buttons in step with the current now-playing song: reflect
  // its latched add/vote state (from Reactions), and disable both when nothing is playing.
  function _syncNpButtons() {
    const np = (typeof Queue !== "undefined" && Queue.getNowPlaying) ? Queue.getNowPlaying() : null;
    const playing = !!(np && np.song);
    const R = (typeof Reactions !== "undefined") ? Reactions : null;
    _applyCount(refs.grabCount, "save");
    _applyCount(refs.upvoteCount, "vote");
    if (refs.grabBtn) {
      const on = playing && R && R.hasSaved && R.hasSaved();
      refs.grabBtn.disabled = !playing;
      refs.grabBtn.classList.toggle("on", !!on);
      if (refs.grabIco) refs.grabIco.textContent = on ? "\u2605" : "\u2606";
      refs.grabBtn.title = !playing ? "Save to playlist (nothing playing)" : (on ? "Saved to a playlist" : "Save this song");
    }
    if (refs.upvoteBtn) {
      const on = playing && R && R.hasVoted && R.hasVoted();
      refs.upvoteBtn.disabled = !playing;
      refs.upvoteBtn.classList.toggle("on", !!on);
      refs.upvoteBtn.title = !playing ? "Upvote (nothing playing)" : (on ? "Upvoted" : "Upvote this song");
    }
  }


  // ---------------------------------------------------------------------------
  // A list of recent conversations, scrollable, each opening into a one-to-one
  // chat, with an incoming message raising a notification in the panel itself.
  //
  // ── THE PANEL DECIDES NOTHING, AND THE FEATURE IS WHY ────────────────────────
  // Every row comes from `Chat.conversations()` and every unread mark comes from
  // the same row's own flag. There is no rank here, no `Capabilities` call, and no
  // second copy of "is this conversation unread" — the read marker lives in
  // `ChatPrefs` beside the index it marks, so the badge and the row can never
  // disagree. Sending is `Chat.sendDM`, which returns the same `{ok, reason}`
  // status room chat does, so a refusal renders instead of vanishing.
  //
  // ── WHAT IS PERSISTED, AND WHAT IS NOT ───────────────────────────────────────
  // The message list rendered here is RAM only, exactly like room chat: reload and
  // it is gone, and one capped backfill per conversation is the whole history
  // policy. What survives a reload is the conversation INDEX — who and when, never
  // what — which is what makes this list non-empty on a second visit. `Clear` drops
  // it. See `core/chatprefs.js`, which holds the reasoning and the cap.
  //
  // ── NOT WINDOWED, DELIBERATELY ───────────────────────────────────────────────
  // `core/windowedlist.js` is the tool for a list that can grow without bound. This
  // one cannot: the index is capped at `ChatPrefs.DM_CAP`, so the row count has a
  // ceiling and a plain scrollable container is the honest amount of machinery.
  // The message view is bounded the same way room chat's is.
  // ── AN INBOX DOES NOT REMEMBER WHERE YOU WERE (v274) ──────────────────────────────────────
  // Resuming the last conversation is right for a ROOM — you were doing something there and want
  // it back. It is wrong for an inbox, where the reason to open the tab is almost always to see
  // what has arrived, and landing inside one conversation hides every other one behind a back
  // button. `_dmResetToList()` is called when the tab is shown, so the view is a property of
  // OPENING the panel rather than of the last thing that happened in it.
  let _dmView = "list";     // "list" | "convo"
  let _dmRows = [];         // the last rendered conversation list (RAM)
  let _dmMessages = [];     // messages of the OPEN conversation (RAM only, capped)
  let _dmNewError = "";     // the last refusal from starting a DM by id, shown not swallowed
  let _dmBackfilled = 0;    // how many messages the last fetch ASKED for — stated, not guessed
  const DM_BACKFILL_STEP = 50;
  const DM_MSG_CAP = 500;

  // Pure: fold one arriving message into the RAM view. Split out and named so the
  // cap and the non-downgrading upsert are reachable by a guard rather than being
  // asserted as source text — the same reason `ChatBuffer`'s helpers are.
  function _dmFoldMessage(list, msg, cap) {
    const max = (typeof cap === "number" && cap > 0) ? cap : DM_MSG_CAP;
    const out = (Array.isArray(list) ? list : []).slice();
    // ── THE TRANSITION RULES ARE `ChatBuffer`'s, NOT A COPY OF THEM (gap 4) ──────────────────
    // This used to say *"Same rule as ChatBuffer"* in a comment and then implement it again — the
    // non-downgrade test, one line, restated. J11 then added a THIRD state (`redacted`, orthogonal
    // to `failed`, admitting real→redacted and refusing redacted→real) to `ChatBuffer` and **the
    // DM path inherited none of it**, because a comment saying "same rule" is not the same rule.
    // That is the duplication category this project has recorded four times, and the guard
    // covering the first copy could not reach the second.
    //
    // So the list is folded THROUGH a real `ChatBuffer` and the rules are read from where they
    // live: a late decryption failure still cannot clobber real text, a redaction is terminal, a
    // tombstone holds no body, and `keepTs` preserves the slot — none of it written here. The
    // buffer is rebuilt per fold, which is O(n) against a cap of 200 and buys one definition.
    const b = ChatBuffer.create();
    for (const m of out) b.upsert(m.id, m.sender, m.body, m.failed, m.ts, m.redacted);
    if (msg && msg.redact) b.redact(msg.id);
    else if (msg && msg.id) b.upsert(msg.id, msg.sender, msg.body, msg.failed, msg.ts, msg.redacted);
    const rows = b.ids().map((i) => b.get(i));
    return rows.length > max ? rows.slice(rows.length - max) : rows;
  }

  // The unread badge on the DM tab. Reads the feature's count; renders nothing when
  // it is zero rather than a "0", because a zero badge trains people to ignore it.
  function _renderDMBadge() {
    if (!refs.tabDM) return;
    let n = 0;
    try { n = (typeof Chat !== "undefined" && Chat.dmUnreadCount) ? Chat.dmUnreadCount() : 0; } catch (e) { n = 0; }
    refs.tabDM.textContent = n > 0 ? ("DMs " + (n > 9 ? "9+" : n)) : "DMs";
    refs.tabDM.classList.toggle("has-unread", n > 0);
  }

  function renderDMPanel() {
    const box = refs.dmBox;
    if (!box) return;
    H.clear(box);
    _renderDMBadge();
    if (_dmView === "convo") { _renderDMConvo(box); return; }

    let rows = [];
    try { rows = (typeof Chat !== "undefined" && Chat.conversations) ? Chat.conversations() : []; }
    catch (e) { rows = []; }
    _dmRows = rows;

    const head = H.el("div", { class: "dm-head" }, [
      H.el("span", { class: "dm-title", text: "Direct messages" }),
    ]);
    if (rows.length > 0) {
      head.appendChild(H.el("button", {
        class: "mini", text: "Clear list",
        title: "Forget which conversations you have had on this device. No messages are stored.",
        onclick: () => { try { Chat.clearConversations(); } catch (e) {} renderDMPanel(); },
      }));
    }
    box.appendChild(head);

    if (rows.length === 0) {
      box.appendChild(H.el("p", { class: "muted",
        text: "No conversations yet. Click a person anywhere they appear and choose Message." }));
      return;
    }

    const list = H.el("div", { class: "dm-list" });
    for (const r of rows) {
      // ── THE ROOM LIST'S ROW SHAPE, REUSED (v273) ──────────────────────────────────────────
      // DMs were bare names on a background — no box, no avatar, and only a short name, so two
      // people whose names truncate the same way were indistinguishable. `.room-item` is the
      // established row: a bordered box with its own background and hover. Reused rather than
      // invented, which would have been a fifth row shape in a file that already has four.
      //
      // THE FULL MATRIX ID IS SHOWN under the short name, because it is the only thing that
      // actually identifies a person — a display name is chosen by them and is not unique.
      const nameEl = H.el("span", { class: "dm-who", text: H.shortName(r.userId) });
      const idEl = H.el("span", { class: "dm-full-id", text: r.userId });
      const who = H.el("div", { class: "dm-who-col" }, [nameEl, idEl]);
      const row = H.el("div", { class: "room-item dm-row" + (r.unread ? " unread" : "") }, [
        H.avatarEl(r.userId, 28),
        who,
        H.el("span", { class: "dm-when", text: r.lastTs ? Panels._fmtAgo(r.lastTs) : "" }),
      ]);
      if (r.unread) row.appendChild(H.el("span", { class: "dm-dot", text: "●", title: "New message" }));
      row.setAttribute("role", "button");
      row.setAttribute("tabindex", "0");
      row.onclick = () => _openDMConversation(r.roomId);
      row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onclick(); } };
      list.appendChild(row);
    }
    // ── PENDING REQUESTS (gap 1) ────────────────────────────────────────────────────────────
    // A room somebody else invited us to is not in `m.direct`, so it never reached DM scope and a
    // stranger's first message arrived NOWHERE. It is offered here as a decision, NOT bound:
    // binding on arrival would let anyone put a room into this account's DM scope by inviting it,
    // and scope is the only thing the DM receive filter tests.
    let invites = [];
    try { invites = Chat.dmInvites() || []; } catch (e) { invites = []; }
    if (invites.length) {
      box.appendChild(H.el("div", { class: "dm-requests-head",
        text: invites.length === 1 ? "1 message request" : invites.length + " message requests" }));
      for (const inv of invites) {
        const who = H.el("span", { class: "dm-who", text: inv.from ? H.shortName(inv.from) : "someone" });
        if (inv.from) Roster._wireCardTrigger(who, inv.from);
        const acc = H.el("button", { class: "mini", text: "Accept",
          onclick: () => { Promise.resolve(Chat.acceptDMInvite(inv.roomId)).then(() => renderDMPanel(), () => renderDMPanel()); } });
        const dec = H.el("button", { class: "mini", text: "Decline",
          onclick: () => { Promise.resolve(Chat.declineDMInvite(inv.roomId)).then(() => renderDMPanel(), () => renderDMPanel()); } });
        box.appendChild(H.el("div", { class: "dm-request" }, [who, acc, dec]));
      }
      box.appendChild(H.el("p", { class: "muted dm-requests-note",
        text: "Nothing sent to you here reaches your conversations until you accept." }));
    }

    box.appendChild(list);

    // ── START ONE BY USER ID (gap 3) ────────────────────────────────────────────────────────
    // `openDM` has always refused `no-user` and `self`; no surface could reach either. The refusal
    // is shown rather than swallowed — a typo'd id must fail VISIBLY, because the alternative is a
    // room created with nobody in it and a conversation that looks open and is not.
    const idInput = H.el("input", { class: "dm-new-id", placeholder: "@someone:server" });
    const go = H.el("button", { class: "mini", text: "Start", onclick: () => {
      const v = String(idInput.value || "").trim();
      _startDMByUserId(v);
    } });
    box.appendChild(H.el("div", { class: "dm-new" }, [idInput, go]));
    if (_dmNewError) box.appendChild(H.el("p", { class: "muted dm-new-error", text: _dmNewError }));
  }

  // The refusals, named. `openDM` answers a reason and this turns each into a sentence — an
  // unnamed failure is what makes a typo look like a working conversation.
  function _startDMByUserId(userId) {
    _dmNewError = "";
    if (!userId) { _dmNewError = "Type a user id, like @someone:server."; renderDMPanel(); return; }
    if (userId.indexOf("@") !== 0 || userId.indexOf(":") < 2) {
      _dmNewError = "That is not a user id. They look like @someone:server.";
      renderDMPanel(); return;
    }
    // THROUGH THE ADAPTER (J31). The user card's Message button already dispatched `chat.dm`;
    // this panel's own "start a conversation" input called the feature directly, so one act had
    // two routes and only one of them was re-checked.
    //
    // THE REJECTION BRANCH IS NOT THE SAME AS BEFORE, AND THAT IS THE POINT. `Chat.openDM`
    // RESOLVES `{ ok: false, reason }`; `Actions.perform` REJECTS when the descriptor is not
    // enabled — which for `chat.dm` means `Chat.cryptoReady()` is false. The old handler flattened
    // every rejection to one sentence, so routing without touching it would have replaced a
    // specific "Secure chat is offline" with "Could not start that conversation" — a routing
    // change quietly making a message worse. The adapter's reason is used when it has one.
    Promise.resolve(Actions.perform("chat.dm", { userId: userId })).then((res) => {
      if (res && res.ok) { _dmNewError = ""; _openDMConversation(res.roomId); return; }
      const why = (res && res.reason) || "failed";
      _dmNewError = why === "self" ? "That is you."
        : why === "no-user" ? "Type a user id, like @someone:server."
        : "Could not start that conversation. Check the id and that the server knows them.";
      renderDMPanel();
    }, (e) => {
      _dmNewError = (e && e.message) || "Could not start that conversation.";
      renderDMPanel();
    });
  }

  // The inbox's default state. Closing the open conversation matters as much as changing the view:
  // leaving `Chat`'s room bound would keep a conversation receiving into a panel showing the list.
  function _dmResetToList() {
    if (_dmView !== "convo") return;
    _dmView = "list";
    _dmMessages = [];
    try { Chat.closeDM(); } catch (e) {}
  }

  // ── OPEN A CONVERSATION AND LAND IN IT (v274) ─────────────────────────────────────────────
  // The user card's Message button ran `chat.dm`, which creates or finds the room — and then
  // nothing moved. The action's job is the ROOM; landing the person in it is the panel's, and no
  // one was doing it. This is the panel's half, callable from anywhere that has a room id.
  function _openDMFromAction(roomId) {
    if (!roomId) return;
    H.setRightTab("dm");
    H._relockAllPanels();
    _openDMConversation(roomId);
    QueuePanels.renderRightPanel();
  }

  function _openDMConversation(roomId) {
    let res = { ok: false };
    try { res = Chat.openDMRoom(roomId) || { ok: false }; } catch (e) { res = { ok: false }; }
    if (!res.ok) { renderDMPanel(); return; }
    _dmView = "convo";
    _dmMessages = [];
    _dmBackfilled = DM_BACKFILL_STEP;
    renderDMPanel();
    // One capped backfill, present-forward after — the same policy room chat has.
    try {
      Promise.resolve(Chat.backfillDM(DM_BACKFILL_STEP)).then((r) => {
        for (const m of ((r && r.messages) || [])) _dmMessages = _dmFoldMessage(_dmMessages, m, DM_MSG_CAP);
        if (_dmView === "convo") renderDMPanel();
      }).catch(() => {});
    } catch (e) {}
  }

  // Ask for more of the same conversation. Doubles rather than paginating, because
  // `recentChatMessages` takes a COUNT and not a cursor — asking for twice as many and re-folding
  // is the honest use of the seam that exists, and `_dmFoldMessage` deduplicates by id so the
  // overlap costs nothing. What is NOT claimed is that this reaches the beginning: it reaches
  // further, and the note says which.
  function _loadEarlierDM() {
    const want = _dmBackfilled * 2;
    try {
      Promise.resolve(Chat.backfillDM(want)).then((r) => {
        _dmBackfilled = want;
        for (const m of ((r && r.messages) || [])) _dmMessages = _dmFoldMessage(_dmMessages, m, DM_MSG_CAP);
        renderDMPanel();
      }, () => {});
    } catch (e) {}
  }

  // A redaction ARRIVING for a DM. Routed through `_dmFoldMessage`, so the transition rules are
  // `ChatBuffer`'s — the same ones room chat uses — rather than a second copy here.
  function _dmRedactionArrived(redactedId) {
    if (!redactedId) return;
    _dmMessages = _dmFoldMessage(_dmMessages, { id: redactedId, redact: true }, DM_MSG_CAP);
    renderDMPanel();
  }

  // Sending one. The row goes when the redaction comes BACK through the door, not optimistically —
  // same rule as room chat, so this client is not the one place a failed deletion looks like
  // success.
  async function _deleteDMMessage(eventId) {
    if (!eventId) return;
    let res;
    try { res = await Chat.dmRedact(eventId); }
    catch (e) { res = { ok: false }; }
    if (!res || !res.ok) _setChatNote("That deletion did not go through.");
    else _setChatNote(CHAT_DELETE_NOTE);
  }

  function _renderDMConvo(box) {
    const who = (_dmRows.find((r) => r.roomId === (Chat.currentDM && Chat.currentDM())) || {}).userId || "";
    const back = H.el("button", { class: "mini", text: "← Conversations", onclick: () => {
      try { Chat.closeDM(); } catch (e) {}
      _dmView = "list"; _dmMessages = []; renderDMPanel();
    } });
    box.appendChild(H.el("div", { class: "dm-head" }, [back, H.el("span", { class: "dm-title", text: H.shortName(who) })]));

    const msgs = H.el("div", { class: "dm-msgs" });
    for (const m of _dmMessages) {
      if (m.failed) continue;   // an undecryptable message is hidden, as in room chat
      // `sender` is the chat panel's own name styling; `dm-sender` keeps only the flex behaviour
      // a DM row needs, so there is one rule deciding what a name looks like in this app.
      // THE SAME BUILDER ROOM CHAT USES. Every branch that used to live here — the sender span,
      // the tombstone, the own-rows-only delete — was the same decision written twice.
      msgs.appendChild(_chatRow(msgs, m, { rowClass: "dm-msg", onDelete: _deleteDMMessage }));
    }
    // ── WHAT THIS CONVERSATION IS NOT SHOWING (gap 2) ───────────────────────────────────────
    // `backfillDM` IS called on open — with 50, not the room-chat 10 — so the brief's premise was
    // half right: the start of a conversation is not unreached because nothing asks, it is
    // unreached because **nothing asks TWICE**. One capped fetch, present-forward after, and no
    // way back. Stated rather than implied, and a control that asks for more.
    if (_dmMessages.length >= _dmBackfilled) {
      box.appendChild(H.el("p", { class: "muted dm-earlier-note",
        text: "Showing the most recent " + _dmBackfilled + " messages. Earlier ones are not loaded." }));
      box.appendChild(H.el("button", { class: "mini", text: "Load earlier messages",
        onclick: () => _loadEarlierDM() }));
    }
    box.appendChild(msgs);

    const note = H.el("div", { class: "dm-note muted" });
    // ── THE CHAT PANEL'S OWN CLASSES, NOT A SECOND SET (browser run) ───────────────────────
    // `.dm-input` declared only `flex: 1; min-width: 0` — no background, colour, border, padding
    // or font-size — so it rendered as a browser-default white box with black text beside a
    // dark-themed panel. `.dm-input-row button` had NO RULE AT ALL, so Send was a bare default
    // button. Both are solved already by `.chat-input` and `.chat-input-row button` one panel over.
    //
    // WHY NOT A NEW RULE: there is nothing about a DM composer that differs from a chat composer —
    // same width behaviour, same dark field, same send affordance. A second set of declarations
    // would be two descriptions of one appearance, free to drift the next time either is touched.
    // `dm-input` / `dm-input-row` stay on the elements so the DM-specific gap rule still applies.
    const input = H.el("input", { class: "dm-input chat-input", type: "text", placeholder: "Message…" });
    const doSend = async () => {
      const text = input.value;
      if (!text || !text.trim()) return;
      let res = { ok: false, reason: "send-failed" };
      try { res = await Chat.sendDM(text); } catch (e) { res = { ok: false, reason: "send-failed" }; }
      if (res.ok) { input.value = ""; note.textContent = ""; return; }
      note.textContent = res.reason === "no-crypto"
        ? "Secure chat is offline — the message was not sent."
        : "That didn't send. Try again.";
    };
    input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };
    box.appendChild(note);
    box.appendChild(H.el("div", { class: "dm-input-row chat-input-row" },
      [input, H.el("button", { text: "Send", onclick: doSend })]));
  }

  // The notification. A message in the OPEN conversation is rendered; one in any
  // other conversation moves the index and repaints the list, which is what makes
  // the badge and the row's dot appear without the person doing anything. Wired in
  // `enterMainScreen` beside the room-chat wiring.
  function _wireDMPanel() {
    if (typeof Chat === "undefined" || !Chat.onDMMessage) return;
    Chat.onDMRedaction(_dmRedactionArrived);
    Chat.onDMMessage((id, sender, body, failed, ts) => {
      _dmMessages = _dmFoldMessage(_dmMessages, { id, sender, body, failed, ts }, DM_MSG_CAP);
      if (H.rightTab() === "dm" && _dmView === "convo") renderDMPanel();
    });
    Chat.onDMChange(() => {
      _renderDMBadge();
      if (H.rightTab() === "dm") renderDMPanel();
    });
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ CHAT
  //
  // The render window, sorted insert, scrollback and the one-shot backfill. Rows are placed by
  // timestamp and id, never arrival order.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // CHAT
  // ---------------------------------------------------------------------------
  // Chat is a bounded RAM window backed by Matrix. Decrypted text never touches
  // disk (ephemeral/E2E preserved; cleared-on-boot automatic). At the bottom the
  // DOM holds the most-recent CHAT_DOM_CAP messages and the oldest fall away as
  // new ones arrive — but the moment you scroll UP, the homeserver is asked for
  // older messages and they're prepended (the history RAM dropped comes back),
  // with your scroll position anchored so nothing you're reading jumps. Trimming
  // is STICKY-AWARE: it pauses while you read older messages and resumes when you
  // return to the bottom (collapsing the window back to the cap). Dedup is owned
  // by the window itself — an id is "seen" only while its row is in the DOM, so a
  // trimmed-then-reloaded message renders again instead of being suppressed.
  const CHAT_DOM_CAP = 600;        // most-recent rows kept mounted while following the tail
  const CHAT_BOTTOM_SLOP = 48;     // px from the bottom still counts as "at the bottom"
  const CHAT_TOP_SLOP = 64;        // px from the top that triggers a load-older
  const CHAT_PAGE = 30;            // messages revealed from RAM per scroll-up
  const CHAT_BACKFILL = 10;        // one-shot recent-history fetch on room entry (hardcoded for now)
  const CHAT_IMG_LRU = 30;         // max inline images kept decoded (with a live src) at once
  const UTD_TEXT = "Couldn't decrypt this message";   // shown for an undecryptable message
  // What a tombstone says. Deliberately about the ACT and not the actor: the row keeps its
  // author's name and colour, so "Message deleted" beside it already reads as *they took it back*.
  // Naming a redactor here would be wrong the moment a moderator case exists.
  const REDACTED_TEXT = "Message deleted";

  // Per-box state. The ChatBuffer is the RAM source of truth (up to 5000 msgs,
  // oldest evicted on overflow); the DOM renders a window of it. domIds = ids
  // currently mounted (trim removes from here, NOT from the buffer, so a trimmed
  // message re-renders from RAM on scroll-up with no network). imgLRU = ids of
  // inline images that currently hold a live src, most-recently-shown last.
  function _newChatState() {
    return { buf: ChatBuffer.create(), domIds: new Set(), loading: false, backfilled: false, backfilling: false, liveFromTs: 0, io: null, imgLRU: [] };
  }
  // ── ONE BUFFER PER TIER, AND THE MEASUREMENT THAT FORCED IT (J12) ──────────────────────────
  // Before J12 there was ONE buffer on the box, and a tier change ran `_resetChatState`, which
  // replaced it wholesale. DRIVEN (`probe-j12-tiers.js` R0): 120 messages in, switch, 0 out — a
  // different buffer object, the old one unreachable. Chat is RAM-ONLY and there is no server
  // copy to recover from except a SINGLE capped `backfillRecent(CHAT_BACKFILL)` = 10 messages,
  // against a buffer cap of 5000. So a switch could destroy up to 4990 messages with a ten-message
  // recovery, permanently. **J12's Done-when — "switching tiers does not lose messages" — was
  // asking for something the old shape could not give**, and no amount of care at the call site
  // would have changed that; the shape had to change.
  //
  // So the buffers are HELD PER TIER and a switch is a re-render from a retained buffer rather
  // than a re-init. Bounded and stated: the tier set is the room's chat channels (three today),
  // each capped at the same 5000, so the ceiling is tiers × CAP and does not grow with time. This
  // is RAM the module already spends, one bucket per tier instead of one bucket.
  //
  // ── `_resetChatState` IS DECIDED, NOT PARKED AGAIN (v284) ─────────────────────────────────
  // It has been filed as "unused" twice and re-parked twice, each time reconstructing the
  // reasoning. The comment here used to say it "STILL EXISTS AND IS STILL RIGHT — for a ROOM
  // change, where the old room's messages genuinely must go."
  //
  // **DRIVEN, AND A ROOM CHANGE DOES NOT NEED IT.** `enterMainScreen` calls `clear(main)` and then
  // `buildMainDom(main, room)`, which builds `refs.chatBox` fresh — so on every room entry the box
  // is a NEW ELEMENT with no `_chats` at all. There is nothing of the old room's to clear, and no
  // caller anywhere in the tree. (A first reading placed the build inside `enterMainScreen` and was
  // wrong; the measurement corrected it — the build is in `buildMainDom`, which `enterMainScreen`
  // calls after clearing.)
  //
  // **IT STAYS, AND THE REASON IS THE EXTRACTIONS.** `check-chat-tiers` and `probe-j12-tiers` both
  // list it in the `names` array they brace-match from — not in prose, in the array. Removing it
  // makes those REFUSE rather than fail, and a refusal reads like a pass. Moving them off it is a
  // change to two harnesses to delete one dead function, and it would cost the thing those
  // harnesses exist to demonstrate: that a tier change does NOT reach the reset.
  //
  // **SO THE COST OF KEEPING IT IS ONE UNCALLED FUNCTION; THE COST OF REMOVING IT IS TWO HARNESS
  // EDITS AND A WEAKER DEMONSTRATION.** Kept deliberately. `check-lint` parks the resulting
  // `no-unused-vars` finding at this single site with the same reason, so a later lint run does
  // not re-file it — and this comment is here so the reasoning is not reconstructed a fourth time.
  function _chatStates(box) {
    if (!box._chats) box._chats = Object.create(null);
    return box._chats;
  }
  function _chatState(box, tier) {
    const all = _chatStates(box);
    const key = (typeof tier === "string" && tier) ? tier : (box._chatTier || "_active");
    if (!all[key]) all[key] = _newChatState();
    return all[key];
  }
  // Every tier's state, for the paths that must reach all of them (a room change disconnects
  // every observer, not just the visible one).
  function _allChatStates(box) {
    const all = _chatStates(box);
    return Object.keys(all).map((k) => all[k]);
  }
  function _resetChatState(box) {
    if (!box) return;
    for (const st of _allChatStates(box)) {
      if (st && st.io) { try { st.io.disconnect(); } catch (e) {} }
    }
    box._chats = Object.create(null);
  }

  // ── THE TIER STRIP AND ITS BADGES (J12) ────────────────────────────────────────────────────
  // Three declarations, extracted by name and EXECUTED by `check-chat-tiers` — the seventh guard
  // in the tree to run this file rather than read it. Same argument as J13's feed panel and J16's
  // activity panel: the subject is a CLAIM about what a badge means, and a regex proving a label
  // is spelled here proves nothing about whether it is ever rendered, or about what it says when
  // a tier is silent.
  //
  // THE PANEL DECIDES NOTHING. Which tiers exist and which is active is `Room.chatTiers()`;
  // whether a tier is unread is `ChatPrefs.tierUnread`. A second copy of either here is the drift
  // P7 is about, and the P7 collision is the one thing J12's Open names.

  // ── WHAT A TIER IS CALLED ON SCREEN ────────────────────────────────────────────────────────
  // The tier IDs are protocol — they are channel-key slugs and rank names, and they must not
  // change. What a person reads is a different question, and it was being answered by printing
  // the protocol name: the strip said `uncategorized (main)`, `guest`, `staff`. "Uncategorized"
  // is what the LADDER calls its bottom rung; as the name of a chat room it tells a reader
  // nothing, and "guest" reads as *only* guests rather than *guests and above*.
  //
  // DISPLAY-ONLY AND THAT IS THE WHOLE POINT. Nothing downstream reads these strings — the tier
  // id still travels everywhere else, so this cannot drift into a second vocabulary.
  //
  // AN UNKNOWN TIER FALLS BACK TO ITS ID RATHER THAN TO A BLANK. A tier added to the channel
  // table and not to this map should look unfinished, not invisible: `check-chat-tiers` fails on
  // a missing label, and until somebody reads that failure the strip still shows something a
  // person can name when they report it.
  // THE MAP LIVES INSIDE THE FUNCTION so `check-chat-tiers` can EXTRACT AND EXECUTE it — its
  // extractor takes `function` declarations, and a bare `const` beside one would have to be
  // stubbed by the guard, which would prove the strip renders something and nothing about what it
  // says. Called rather than read, the real labels are what the assertions see.
  function _chatTierName(tier) {
    const LABELS = {
      uncategorized: "Everyone",   // the ladder's bottom rung is everyone in the room
      guest: "Guest+",             // guests AND above — "guest" alone reads as only guests
      staff: "Staff",
      presence: "Present",         // the bot-managed channel: who the room says is here now
    };
    return LABELS[tier] || String(tier || "");
  }

  // ── WHAT A SETTING IS CALLED, IN ONE PLACE ─────────────────────────────────────────────────
  // The delegation table listed every row by its RAW KEY — `checkpointRankOffsetMs`,
  // `vouchJitter`, `receiptsPerMessage` — while the settings panel a few lines above called the
  // same three things "Head start for each rank (seconds)", "Turn-taking step & peer jitter (ms)"
  // and "Backups carried per message". So the owner met two vocabularies for one setting, in one
  // panel, and the delegation one was the machine's.
  //
  // MEASURED: 22 of the 25 delegable keys already had a human label at their row's call site.
  // This is that name, hoisted so both places read it — the row and the delegation table cannot
  // disagree because there is one source.
  //
  // A KEY WITH NO NAME FALLS BACK TO THE KEY. Same reason as the chat tiers: a setting added to
  // the domain and not named here must look unfinished rather than invisible, and `check-settings-
  // labels` fails on it so somebody is told.
  function _settingDisplayName(key) {
    const NAMES = {
      chat: "Main chat", vis: "Visibility", bg: "Room background",
      minDjRank: "Who can DJ", maxLen: "Max song length (sec)", minLen: "Grace period (sec)",
      minGate: "Shortest time before the next song (sec)",
      graceMs: "Allowance for length disagreement (sec)",
      presendMs: "Pause before you post the next song (ms)",
      skipRoads: "When to skip a song too many can't see",
      vouchTable: "How many people must back up an event",
      checkpointTable: "Who can replace the owner's summary",
      botPresenceSpine: "Count queue actions as being around",
      botPresenceChat: "Count chat as being around",
      botQueueChat: "Count chat as keeping your queue place",
      botAfkMs: "Treat someone as away after (minutes)",
      botPingMs: "Wait for an answer for (seconds)",
      activityQueue: "What keeps your place in the queue",
      activityPresence: "What keeps you in the presence chat",
      queueIdleMs: "Give up a queue place after (minutes)",
      repeatCooldownMs: "Don't replay a song within (minutes)",
      checkpointCooldownMs: "Minimum gap between summaries (minutes)",
      checkpointEvery: "Save a summary after this many actions",
      checkpointRankOffsetMs: "Head start for each rank (seconds)",
      selfWitnessCheckpoint: "Save a summary from your own backups",
      vouchJitter: "Turn-taking step & peer jitter (ms)",
      receiptsPerMessage: "Backups carried per message",
    };
    return NAMES[key] || String(key || "");
  }

  // Pure. One resolution + the read markers -> the strip's labels. Separated from the renderer so
  // what a badge CLAIMS can be driven without a DOM.
  function _chatTierLabel(res, unreadFor) {
    const r = res || {};
    const tiers = Array.isArray(r.tiers) ? r.tiers : [];
    const unread = (typeof unreadFor === "function") ? unreadFor : (() => false);
    return {
      tiers: tiers.map((t) => ({
        tier: t.tier,
        // The room's MAIN tier is marked rather than renamed, because "main" is a fact about the
        // room and the tier keeps its own name in every client regardless of which is main.
        main: !!t.main,
        active: t.tier === r.activeTier,
        // A TIER WITH NO TRAFFIC CARRIES NO BADGE, and that is a decision rather than a
        // side-effect. `tierUnread` answers false for a tier with no row at all — nothing has
        // ever arrived there — so a silent staff channel does not invite somebody to open an
        // empty room. A tier you have NEVER OPENED but which HAS traffic does carry one, because
        // there is something there you have not seen, which is what a badge is for.
        unread: !!unread(t.tier),
        label: _chatTierName(t.tier) + (t.main ? " (main)" : ""),
      })),
      // Stated rather than implied, the same way the feed and the activity panel state theirs:
      // this strip shows the tiers the ROOM HAS and this client has joined, which is not the same
      // as every tier the protocol defines.
      note: tiers.length <= 1
        ? "This room has one chat tier."
        : "Tiers your rank grants. Unread marks a tier with messages you have not seen.",
    };
  }

  // Which tier a channel id belongs to, resolved through the feature layer rather than by
  // reversing the `chat_` key here — the UI does not own the channel vocabulary.
  function _tierForChannel(roomId) {
    if (!roomId) return null;
    let res;
    try { res = Room.chatTiers(); } catch (e) { return null; }
    const hit = (res && res.tiers || []).find((t) => t.id === roomId);
    return hit ? hit.tier : null;
  }

  function _renderChatTierStrip() {
    if (!refs.chatTiers) return;
    H.clear(refs.chatTiers);
    let res;
    try { res = Room.chatTiers(); } catch (e) { return; }
    const lab = _chatTierLabel(res, (t) => { try { return ChatPrefs.tierUnread(t); } catch (e) { return false; } });
    if (!lab.tiers.length) return;
    for (const t of lab.tiers) {
      // `tab` is the queue's own sub-button class and `active` is the queue's own selected marker,
      // so which tier is live reads exactly as which queue pane is live. `chat-tier` stays for the
      // unread dot's positioning — the badge is this strip's alone and the queue has no equivalent.
      const b = H.el("button", { class: "tab chat-tier" + (t.active ? " active" : "") + (t.unread ? " unread" : ""),
                               text: t.label, title: t.main ? "The room's main chat tier" : "" });
      b.onclick = () => _selectChatTier(t.tier);
      refs.chatTiers.appendChild(b);
    }
    refs.chatTiers.appendChild(H.el("span", { class: "muted chat-tier-note", text: lab.note }));
  }

  // The switch. Re-points the feature layer through the ONE resolver, then repaints from the
  // RETAINED buffer for that tier — no re-init, so nothing is lost (J12's Done-when).
  function _selectChatTier(tier) {
    const box = refs.chatBox;
    let res;
    try { res = Room.selectChatTier(tier); } catch (e) { return; }
    if (!box) return;
    box._chatTier = res.activeTier;
    // Reading a tier is what clears its badge, and it is marked at the tier's OWN newest stamp
    // rather than at a clock — the marker and the messages have to be on one scale or a badge
    // could survive being read (P2, one level up from the clock rule).
    try {
      const st = _chatState(box, res.activeTier);
      const ids = st.buf.ids();
      const newest = ids.length ? (st.buf.get(ids[ids.length - 1]) || {}).ts : 0;
      if (newest) ChatPrefs.tierMarkRead(res.activeTier, newest);
    } catch (e) {}
    _repaintChat(box);
    _renderChatTierStrip();
  }

  function _chatAtBottom(box) { return (box.scrollHeight - box.scrollTop - box.clientHeight) <= CHAT_BOTTOM_SLOP; }
  function _eidSel(id) { return '[data-eid="' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id) + '"]'; }

  // Lazily load an inline image's src only when it scrolls into view, and keep at
  // most CHAT_IMG_LRU images decoded — scroll one far away and it's released;
  // scroll back and it reloads (served from the browser's HTTP cache, so the
  // image host isn't re-hit). RAM-only; nothing persisted.
  function _chatObserver(box) {
    const st = _chatState(box);
    if (st.io || typeof IntersectionObserver === "undefined") return st.io;
    st.io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const img = e.target;
        const src = img.dataset ? img.dataset.src : null;
        if (!src) continue;
        if (img.getAttribute("src") !== src) img.setAttribute("src", src);   // (re)load
        const id = img.dataset ? img.dataset.eid : null;
        if (!id) continue;
        const i = st.imgLRU.indexOf(id);
        if (i >= 0) st.imgLRU.splice(i, 1);
        st.imgLRU.push(id);                                  // most-recently-shown last
        while (st.imgLRU.length > CHAT_IMG_LRU) {             // release the least-recent
          const oldId = st.imgLRU.shift();
          const node = box.querySelector('img' + _eidSel(oldId));
          if (node) node.removeAttribute("src");             // free decode; data-src kept for reload
        }
      }
    }, { root: box, rootMargin: "200px 0px" });
    return st.io;
  }

  // Inner content for a message record, decided at RENDER time from the viewer's
  // current chat prefs (ChatPrefs): an undecryptable placeholder, an inline image,
  // a clickable link, or plain text. Images and links are BOTH off by default
  // (opt in per category under the gear → Settings tab), so by default every body
  // is a plain text node and nothing auto-fetches a third party. Images/links are
  // built via createElement + setAttribute/textContent — never innerHTML
  // (check-html-safety) — and classify only ever yields an https URL on a host the
  // user allowlisted.
  function _chatContent(box, record) {
    if (record.failed) return document.createTextNode(" " + UTD_TEXT);
    // THE TOMBSTONE (J11b). A vanished row is indistinguishable from one that was never there, so
    // a deletion leaves a mark instead of a hole. Checked AFTER `failed` deliberately: a message
    // this device never decrypted is hidden by the caller, and a redaction must not turn a hidden
    // row into a visible one — a deletion causing a row to APPEAR is backwards. The buffer keeps
    // `failed` across a redaction for exactly that reason.
    if (record.redacted) {
      const t = document.createElement("span");
      t.className = "chat-redacted";
      t.textContent = " " + REDACTED_TEXT;
      return t;
    }
    const c = ChatBuffer.classify(record.body, ChatPrefs.classifyOpts());
    if (c.kind === "image" && c.src) {
      const img = document.createElement("img");
      img.className = "chat-img";
      img.alt = c.src;
      img.title = c.src;                                   // hover shows where the image points
      img.setAttribute("referrerpolicy", "no-referrer");   // don't leak the room to the image host
      img.style.maxWidth = "240px";
      img.style.maxHeight = "240px";
      img.style.borderRadius = "6px";
      img.style.display = "block";
      img.style.marginTop = "3px";
      if (record.id) img.dataset.eid = record.id;
      img.dataset.src = c.src;
      const io = _chatObserver(box);
      if (io) io.observe(img); else img.setAttribute("src", c.src);   // no IO -> load directly
      return img;
    }
    if (c.kind === "link" && c.href) {
      const a = document.createElement("a");
      a.className = "chat-link";
      a.textContent = " " + record.body;                   // label is the URL text (safe text node)
      a.href = c.href;                                     // https-only, allowlisted host (classify-enforced)
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";              // no window.opener, no referrer, no SEO transfer
      a.setAttribute("referrerpolicy", "no-referrer");
      return a;
    }
    return document.createTextNode(" " + record.body);
  }

  // ── ONE MESSAGE ROW, TWO SURFACES (v274) ──────────────────────────────────────────────────
  // The DM thread had its own row builder — its own sender span, its own tombstone branch, its own
  // delete control — and **none of the avatar work**, because v285's avatars reached the
  // conversation LIST and not the messages inside a conversation. That is the seventh instance of
  // one rule with two implementations and the SECOND in DMs, after `_dmFoldMessage` said *"same
  // rule as ChatBuffer"* and then implemented it again.
  //
  // **THEY MERGE, AND THE DIFFERENCES ARE TWO ARGUMENTS.** Everything that looked DM-specific was
  // the same decision written twice: hide a failed row, tombstone a redacted one, offer delete on
  // your own only and never on a tombstone. What genuinely differs is WHICH delete function to
  // call and WHICH class the row carries. Both are now parameters, so avatars, the live avatar
  // refresh, tombstones and anything added later arrive in both for free.
  function _chatRow(box, record, opts) {
    const o = opts || {};
    const level = H._rosterLevel(record.sender);
    const color = H.rankColor(level);
    const senderEl = H.el("span", { class: "sender", text: H.shortName(record.sender) });
    senderEl.style.color = color;
    // The card, from chat (J14). `_rosterLevel` answers 0 for somebody not in the
    // roster, which is the right fallback: a descriptor computed against too WEAK a
    // target rank can only be MORE permissive than the truth — so `Room.kick`/`Room.ban`
    // re-read both ranks live and refuse. That is the same defence-in-depth
    // `rank.assign` has always relied on, and it is why a stale roster level here is a
    // rendering imprecision rather than a permission hole.
    Roster._wireCardTrigger(senderEl, record.sender, level);
    const av = H.avatarEl(record.sender, 20);
    av.style.marginRight = "5px";
    av.style.verticalAlign = "middle";
    av.dataset.avatarFor = record.sender;   // lets onAvatarChange find and refresh it
    const msg = H.el("div", { class: o.rowClass || "chat-msg" }, [av, senderEl]);
    msg.appendChild(_chatContent(box, record));
    if (record.id) msg.dataset.eid = record.id;   // window key (dedup + in-place update)
    // ── TAKE IT BACK (J11) ─────────────────────────────────────────────────────────────────
    // ON YOUR OWN ROWS ONLY, AND THAT IS A DECISION RATHER THAN A GATE. The homeserver ladder
    // reads `redact: 100` with `events_default: 0`, so deleting your OWN message needs only
    // permission to send a redaction — which everyone has — while deleting someone else's needs
    // level 100. So the self case works for every rank and the moderator case is not a rank check
    // that was left out; it would need the room's power levels changed, which is a different job
    // from the one J11's Open defers it to.
    //
    // The absence of the control on other people's rows is a UI choice about what to OFFER, not a
    // permission check. `features/chat.js` carries no gate either: a redaction is adjudicated by
    // the homeserver and never reaches the reducer, so a gate would report permitted against
    // nothing — J14's lesson and the 403 drift `10-capabilities.md` exists to prevent.
    // Not on a tombstone: there is nothing left to take back, and offering it would send a second
    // redaction the homeserver has no reason to honour.
    if (record.id && !record.redacted && _isOwnMessage(record.sender)) {
      const del = H.el("button", { class: "chat-del", text: "×", title: "Delete this message" });
      del.onclick = () => (o.onDelete || _deleteChatMessage)(record.id);
      msg.appendChild(del);
    }
    return msg;
  }

  // Own-ness compared against the live account id rather than a cached one, so a row rendered
  // before a re-login does not keep somebody else's affordance.
  function _isOwnMessage(sender) {
    if (!sender) return false;
    let me = null;
    try { me = Room.getMyId ? Room.getMyId() : null; } catch (e) { me = null; }
    // YOURS, OR ONE YOU HAVE THE POWER TO REMOVE. This read `sender === me` alone, so a moderator
    // with the homeserver's permission was never offered the control — the delete existed and could
    // not be reached. Reported from a live room by an owner who could not remove another person's
    // message in a room whose `redact` bar he was well above. The power-level fix was necessary and
    // not sufficient: the server said yes and nothing ever asked.
    if (!!me && sender === me) return true;
    try { return !!(Chat.mayRedactOthers && Chat.mayRedactOthers()); } catch (e) { return false; }
  }

  // ── WHAT A DELETION ACTUALLY PROMISES, AND THE PANEL SAYS IT ───────────────────────────────
  // A redaction is a REQUEST other clients honour, not an erasure. The homeserver strips the
  // content from its copy and tells everyone; each client then removes it if it is listening. A
  // client that had already rendered the message and is not running may still show it, and
  // anything already screenshotted or copied is beyond reach entirely. Stated the way J16 stated
  // chat's invisibility and J13 stated its reach — a promise the tree cannot keep must not be
  // implied by silence.
  const CHAT_DELETE_NOTE = "Deleted for everyone still connected. Copies already saved elsewhere " +
    "are beyond reach.";

  async function _deleteChatMessage(eventId) {
    if (!eventId) return;
    let res;
    try { res = await Chat.redact(eventId); }
    catch (e) { res = { ok: false, reason: "redact-failed" }; }
    if (res && res.ok) {
      // NOT REMOVED HERE. The row goes when the redaction comes BACK through the door, so the
      // local view and every other client change for the same reason at the same point. Removing
      // optimistically would make this client the one place a failed deletion still looks like a
      // success, which is the failure mode hardest to notice from inside it.
      _setChatNote(CHAT_DELETE_NOTE);
      return;
    }
    _setChatNote(res && res.reason === "forbidden"
      ? "The server refused that deletion."
      : "That deletion did not go through.");
  }

  function _setChatNote(text) {
    if (!refs.chatNote) return;
    refs.chatNote.textContent = text || "";
  }

  // ── A REDACTION ARRIVING (J11) ─────────────────────────────────────────────────────────────
  // THE MEASUREMENT THAT DECIDED THIS FUNCTION'S SHAPE. The obvious handler is an upsert to a
  // placeholder — exactly what a decryption failure does — and `probe-j11-redact.js` R0 shows the
  // buffer REFUSES it: `prev.failed === false && failed` returns `noop`, so the message stays on
  // screen after being deleted and nothing throws. The non-downgrading rule that protects real
  // text from a decryption placeholder protects it from a deletion too, and it cannot tell the
  // two apart because both arrive as "replace real text with an absence".
  //
  // So the row is REMOVED rather than tombstoned, and that is what the buffer can express: `remove`
  // has been there since the buffer was written, marked *for a future delete/redaction feature*.
  // A tombstone would have to be remove-then-reinsert, which re-enters at the sorted slot and
  // leaves a row a later real message could clobber — the dedup rule expresses one of the two
  // cleanly and it is disappearance.
  //
  // A REDACTION FOR A MESSAGE THIS CLIENT NEVER HELD IS A NO-OP, NOT AN ERROR. It is the normal
  // case, not the exotic one: buffers are per tier and capped, the client may have joined after
  // the message, the tier may never have been opened, and the row may have been evicted. `remove`
  // answers false and that is the whole response.
  function removeChatMessage(redactedId, roomId) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box || !redactedId) return;
    // Routed to the tier the deleted message is IN, not the tier being viewed — buffers are per
    // tier (J12) and a redaction carries its own room_id. Driven rather than assumed (R3).
    const tier = _tierForChannel(roomId);
    const visible = box._chatTier || null;
    const st = _chatState(box, tier || visible);
    // TOMBSTONE, NOT REMOVAL. `redact` mutates the record IN PLACE, which is what makes this safe:
    // the update branch never touches `order[]`, so the row keeps its chronological slot. Driven
    // (R1b) — remove-then-reinsert lands the row at the FRONT, because `_place` sorts on the ts it
    // is handed and the original is lost with the record. The clobber that ruled a tombstone out
    // the first time belongs to REINSERTION, not to mutation.
    //
    // Answers false when this client never held the message, which is the normal case and is
    // still a no-op: a tombstone for a message the person never saw would create a row rather
    // than mark one, which is the same objection as the hidden-row case above.
    if (!st.buf.redact(redactedId)) return;
    // The DOM row only exists if this tier is the visible one AND the row was mounted. It is
    // REPLACED rather than removed, so the mark lands in the slot the message occupied.
    if (!tier || tier === visible) {
      const node = box.querySelector(_eidSel(redactedId));
      const rec = st.buf.get(redactedId);
      if (node && rec) {
        if (rec.failed) { node.remove(); st.domIds.delete(redactedId); return; }
        node.replaceWith(_chatRow(box, rec));
      }
    }
  }

  function _trimChat(box) {
    const st = _chatState(box);
    while (box.children.length > CHAT_DOM_CAP) {
      const node = box.firstChild;
      const id = node && node.dataset ? node.dataset.eid : null;
      if (id) st.domIds.delete(id);     // freed from the DOM (stays in buf) -> re-renders on scroll-up
      box.removeChild(node);
    }
  }

  // A chat display pref changed (image/link master toggle, or a host edit). The
  // buffer is content-only and untouched; we just rebuild each MOUNTED row from
  // its record so a body flips between text / image / link to match the new prefs.
  // Bounded by what's currently mounted; the image LRU resets and the observer
  // re-attaches to any rows that just became images.
  function _repaintChat(box) {
    if (!box) return;
    const st = _chatState(box);
    st.imgLRU = [];
    for (const id of Array.from(st.domIds)) {
      const old = box.querySelector(_eidSel(id));     // the row div is the first match in tree order
      const rec = st.buf.get(id);
      if (!old) { st.domIds.delete(id); continue; }
      if (!rec || rec.failed) { old.remove(); st.domIds.delete(id); continue; }
      old.replaceWith(_chatRow(box, rec));
    }
  }

  // A previously-hidden message just became readable (its megolm key arrived and
  // the SDK re-fired Event.decrypted). Insert it in correct timeline order — find
  // the nearest mounted message AFTER it in buffer order and put it before that
  // row; if it belongs after everything mounted, append it. If NEITHER neighbour
  // is on screen (it sits in a scrolled-away region), do nothing — it renders in
  // order when you scroll there. Anchored so the view never jumps; never reorders.
  function _insertDecrypted(box, id, record) {
    const st = _chatState(box);
    const all = st.buf.ids();                 // oldest -> newest
    const idx = all.indexOf(id);
    if (idx < 0) return;

    // nearest mounted neighbour AFTER this message -> insert right before it
    let beforeNode = null;
    for (let i = idx + 1; i < all.length; i++) {
      if (st.domIds.has(all[i])) { beforeNode = box.querySelector(_eidSel(all[i])); break; }
    }
    // nearest mounted neighbour BEFORE this message (to confirm we're inside the window)
    let hasPrevMounted = false;
    for (let i = idx - 1; i >= 0; i--) {
      if (st.domIds.has(all[i])) { hasPrevMounted = true; break; }
    }

    // Only insert if this message sits inside the currently-mounted region:
    // either it has a mounted neighbour after it, or it has one before it and
    // belongs at the live tail. Otherwise leave it for scroll-driven render.
    if (!beforeNode && !hasPrevMounted) return;

    const atBottom = _chatAtBottom(box);
    const beforeH = box.scrollHeight;
    const beforeTop = box.scrollTop;
    const row = _chatRow(box, record);
    if (beforeNode) box.insertBefore(row, beforeNode);
    else box.appendChild(row);                // belongs after everything mounted (live tail)
    st.domIds.add(id);

    if (atBottom && !beforeNode) box.scrollTop = box.scrollHeight;     // following the tail
    else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);     // anchor; don't jump
  }

  // Live receive. upsert() into the RAM buffer, then render the outcome:
  //   insert -> a new row, placed in CHRONOLOGICAL order (not blindly at the bottom)
  //   update -> patch the existing row IN PLACE (placeholder -> real text, etc.)
  //   noop   -> ignored (no id, or a placeholder that must not clobber real text)
  // ts is the Matrix origin_server_ts; the buffer orders by it, so a message
  // delivered out of arrival-order (E2E history decrypts newest-first; late keys)
  // still lands in its correct slot.
  // `roomId` is J12's addition and is what makes per-tier buffers possible: `Chat` now forwards
  // every readable tier, so the message has to say which one it belongs to. A message for a tier
  // that is NOT the visible one is buffered and touched for the badge, and returns before any
  // DOM work — it has no rows on screen to patch.
  function addChatMessage(id, sender, body, failed, ts, roomId) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box) return;
    const tier = _tierForChannel(roomId);
    const visible = box._chatTier || null;
    const st = _chatState(box, tier || visible);
    const res = st.buf.upsert(id, sender, body, failed, ts);
    if (res.type === "noop") return;

    // THE BADGE IS TOUCHED FOR EVERY TIER INCLUDING THE VISIBLE ONE, and the visible one is then
    // marked read immediately below. Touching only the hidden tiers would look equivalent and is
    // not: `tierTouch` is what CREATES the row, so a tier that had only ever been read while
    // visible would have no row at all and `tierUnread` would answer false for it forever after.
    if (tier && !failed) {
      try {
        ChatPrefs.tierTouch(tier, ts);
        if (tier === visible) ChatPrefs.tierMarkRead(tier, ts);
      } catch (e) {}
      _renderChatTierStrip();
    }
    if (tier && visible && tier !== visible) return;   // buffered, badged, not drawn

    // While the one-shot backfill is in flight, the scrollback it runs re-fires
    // Event.decrypted for a flood of OLDER messages. Buffer them (done above) but
    // DON'T render here — _backfillChatOnce renders the last CHAT_BACKFILL from the
    // buffer once, in order. Rendering them live is exactly what produced the
    // reversed, over-cap history. (New live messages during this brief window are
    // buffered too and appear as part of that one render.)
    if (st.backfilling) return;

    _ensureChatScrollWired(box);

    if (res.type === "update") {
      const old = box.querySelector(_eidSel(id));
      if (res.record.failed) {                               // undecryptable -> hidden
        if (old) { st.domIds.delete(id); old.remove(); }
        return;
      }
      if (old) { old.replaceWith(_chatRow(box, res.record)); return; }   // mounted -> patch in place
      // Not mounted but now readable (a pending message whose key just arrived).
      // Insert it in correct timeline order, but ONLY if its neighbours are on
      // screen — otherwise it lives in a scrolled-away region and will render in
      // order when you scroll there. Never reorder, never dump at the bottom.
      _insertDecrypted(box, id, res.record);
      return;
    }

    // insert. Undecryptable old/re-key messages are hidden (kept in the buffer for
    // ordering/dedup, but never drawn — no readable content on this device).
    if (res.record.failed) return;

    // Late history (older than the newest we've shown) is not "live" — drop it from
    // the live path so it can't pile onto the bottom. It stays buffered and is
    // revealed in order by scroll-up (_loadOlderChat). Genuinely-new messages
    // (ts beyond the backfill horizon) fall through to the ordered insert below.
    if (st.liveFromTs && (Number(ts) || 0) <= st.liveFromTs && !st.domIds.has(id)) return;

    const stick = _chatAtBottom(box);
    const beforeH = box.scrollHeight;
    const beforeTop = box.scrollTop;

    // Place the row in chronological (buffer) order: find the nearest mounted
    // message AFTER this one and insert before it; if none, it belongs at the tail.
    const all = st.buf.ids();                 // oldest -> newest (ts-sorted)
    const idx = all.indexOf(id);
    let beforeNode = null;
    for (let i = idx + 1; i < all.length; i++) {
      if (st.domIds.has(all[i])) { beforeNode = box.querySelector(_eidSel(all[i])); break; }
    }
    const row = _chatRow(box, res.record);
    if (beforeNode) box.insertBefore(row, beforeNode);
    else box.appendChild(row);
    if (id) st.domIds.add(id);

    if (stick) { _trimChat(box); box.scrollTop = box.scrollHeight; }   // following the tail
    else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);     // scrolled up: anchor, don't jump
  }

  // Wire the scroll handler once per box: trim back to the cap when we return to
  // the bottom, and reveal older RAM-buffered messages when we near the top.
  function _ensureChatScrollWired(box) {
    if (!box || box.dataset.scrollWired) return;
    box.dataset.scrollWired = "1";
    box.addEventListener("scroll", () => {
      if (_chatAtBottom(box)) _trimChat(box);
      else if (box.scrollTop <= CHAT_TOP_SLOP) _loadOlderChat(box);
    });
  }

  // Scroll-up: reveal up to CHAT_PAGE older messages that are ALREADY in the RAM
  // buffer but not currently mounted (trimmed when we followed the tail). This is
  // RAM-only — chat never pages history from Matrix on scroll. Chat is
  // present-forward: the only history the buffer holds is the one-shot join
  // backfill (_backfillChatOnce) plus whatever has arrived live this session.
  // Hidden (undecryptable) messages are skipped. View stays anchored.
  function _loadOlderChat(box) {
    const st = _chatState(box);
    const all = st.buf.ids();                              // oldest -> newest
    const firstNode = box.firstChild;
    const oldestDom = firstNode && firstNode.dataset ? firstNode.dataset.eid : null;
    let firstIdx = oldestDom ? all.indexOf(oldestDom) : all.length;
    if (firstIdx < 0) firstIdx = all.length;

    const picked = new Set();
    for (let i = firstIdx - 1; i >= 0 && picked.size < CHAT_PAGE; i--) {
      const idv = all[i];
      if (st.domIds.has(idv)) continue;
      const rec = st.buf.get(idv);
      if (rec && !rec.failed) picked.add(idv);             // skip hidden (undecryptable)
    }
    if (!picked.size) return;

    const beforeH = box.scrollHeight;
    const beforeTop = box.scrollTop;
    const frag = document.createDocumentFragment();
    for (const idv of st.buf.ids()) {        // render in buffer order (oldest -> newest)
      if (!picked.has(idv) || st.domIds.has(idv)) continue;
      const rec = st.buf.get(idv);
      if (!rec) continue;
      st.domIds.add(idv);
      frag.appendChild(_chatRow(box, rec));
    }
    box.insertBefore(frag, box.firstChild);
    box.scrollTop = beforeTop + (box.scrollHeight - beforeH);   // anchor the view
  }

  // One-shot history backfill when a room's chat starts: pull the last
  // CHAT_BACKFILL messages of the active channel from Matrix in a SINGLE fetch
  // (the recent TAIL — recentChatMessages). Only the READABLE ones become buffer
  // rows: a backfilled message this device can't decrypt is DROPPED entirely here
  // — never buffered, never drawn — so it shows NO error now and stays silent even
  // if live messages later render decryption errors (the two are decoupled).
  //
  // ORDER + CAP: because chat is E2E, the fetch's own scrollback re-fires
  // Event.decrypted for a FLOOD of older messages, and they arrive NEWEST-first.
  // Two things keep the join view correct: (1) the RAM buffer orders by ts, so the
  // flood + the fetched tail interleave into true chronological order; (2) while
  // `backfilling` is set, addChatMessage buffers those events but does NOT draw
  // them (see there) — this single render is the only one. We then draw just the
  // LAST CHAT_BACKFILL readable messages (the intended cap), leaving the rest in
  // RAM for scroll-up (_loadOlderChat), and set liveFromTs to the newest ts so any
  // later straggler decrypts are treated as history, not appended to the tail.
  // Runs once per room entry; chat is present-forward after. A brand-new room — or
  // one whose recent messages are all undecryptable — yields nothing (clean no-op).
  async function _backfillChatOnce(box) {
    if (!box) return;
    const st = _chatState(box);
    if (st.backfilled || st.loading) return;
    st.backfilled = true;
    st.loading = true;
    st.backfilling = true;   // defer live rendering of the scrollback flood until this render
    _ensureChatScrollWired(box);
    try {
      let res;
      try { res = await Chat.backfillRecent(CHAT_BACKFILL); }
      catch (e) { return; }
      // Readable-only: drop undecryptable backfilled messages before they ever
      // reach the buffer (so they can never surface an error row).
      const older = ((res && res.messages) || []).filter((m) => m && !m.failed);
      st.buf.prependOlder(older);   // interleaves by ts with anything the flood already buffered

      // The initial view is the last CHAT_BACKFILL READABLE messages, in order.
      const readable = st.buf.ids().filter((idv) => { const r = st.buf.get(idv); return r && !r.failed; });
      const show = readable.slice(Math.max(0, readable.length - CHAT_BACKFILL));   // oldest -> newest
      if (!show.length) return;

      const atBottom = _chatAtBottom(box);
      const beforeH = box.scrollHeight;
      const beforeTop = box.scrollTop;
      const frag = document.createDocumentFragment();
      for (const idv of show) {
        if (st.domIds.has(idv)) continue;
        st.domIds.add(idv);
        frag.appendChild(_chatRow(box, st.buf.get(idv)));
      }
      if (frag.childNodes.length) {
        box.insertBefore(frag, box.firstChild);
        if (atBottom) box.scrollTop = box.scrollHeight;                 // fresh box: stick to bottom
        else box.scrollTop = beforeTop + (box.scrollHeight - beforeH);  // else keep the reader put
      }
      // Newest ts we've folded in becomes the live horizon: strictly-newer messages
      // are live and append; anything at-or-below is history (backfill / stragglers).
      const newest = st.buf.get(show[show.length - 1]);
      st.liveFromTs = (newest && newest.ts) || 0;
    } finally {
      st.backfilling = false;
      st.loading = false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    _onStarPress, _onVotePress, _starBtn, _voteBtn, _syncNpButtons,
    renderDMPanel, _dmResetToList, _openDMFromAction, _wireDMPanel, _renderDMBadge,
    _settingDisplayName, _renderChatTierStrip, removeChatMessage, _repaintChat,
    addChatMessage, _backfillChatOnce, _chatRow, _setChatNote,
  };
})();
