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
    for (const m of out) b.upsert(m.id, m.sender, m.body, m.failed, m.ts, m.redacted, m.tooLong);
    if (msg && msg.redact) b.redact(msg.id);
    else if (msg && msg.id) b.upsert(msg.id, msg.sender, msg.body, msg.failed, msg.ts, msg.redacted, msg.tooLong);
    const rows = b.ids().map((i) => b.get(i));
    return rows.length > max ? rows.slice(rows.length - max) : rows;
  }

  // The unread badge on the DM tab. Reads the feature's count; renders nothing when
  // it is zero rather than a "0", because a zero badge trains people to ignore it.
  function _renderDMBadge() {
    if (!refs.tabDM) return;
    let n = 0;
    try { n = (typeof Chat !== "undefined" && Chat.dmUnreadCount) ? Chat.dmUnreadCount() : 0; } catch (e) { n = 0; }
    // A PURPLE DOT, AND NO COUNT (owner ruling, ddjp_432). Every DM is addressed to you, so an unread one
    // carries the dot a mention carries; `n` is PEOPLE with something unread, however many rooms each has.
    refs.tabDM.textContent = "DMs";
    // Its dot is the LEVEL MODEL's (ddjp_441): purple while a DM is unread and the DMs tab is not in front of you.
    if (typeof _renderLevelDots === "function") { try { _renderLevelDots(); } catch (e) {} }
    void n;
  }

  // ── THE DM LIST'S PIECES (ddjp_433) — extracted and run by the J15 harness beside `renderDMPanel` ───
  // A search matches the full Matrix ID or the short name, any case. A person's REQUEST is a row like any
  // other, saying they want to chat, with Accept and Refuse. ONE ANSWER PER PERSON is `Chat`'s rule
  // (`_answerRequest`), and it is the only enforcement: a UI lock here was measured DOMINATED by it (a
  // mutation removing the lock stayed green), so it was deleted. The UI only SHOWS the buttons disabled
  // while an answer is in flight, including across a redraw (`Chat.dmAnswering`).
  function _dmMatches(r, q) {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return true;
    let name = "";
    try { name = String(H.shortName(r.userId || "") || "").toLowerCase(); } catch (e) { name = ""; }
    return String(r.userId || "").toLowerCase().indexOf(s) >= 0 || name.indexOf(s) >= 0;
  }
  // A full Matrix ID that is not already in the list, and is not you: something a chat can be started with.
  function _dmStartable(q, rows) {
    const id = String(q || "").trim();
    if (!/^@[^\s:]+:\S+$/.test(id)) return false;
    let me = null;
    try { me = Room.getMyId ? Room.getMyId() : null; } catch (e) { me = null; }
    if (me && id.toLowerCase() === String(me).toLowerCase()) return false;
    return !(rows || []).some((r) => String(r.userId || "").toLowerCase() === id.toLowerCase());
  }
  function _renderDMList(list, rows, box) {
    H.clear(list);
    const q = String((box && box._dmQuery) || "").trim();
    const isId = /^@[^\s:]+:\S+$/.test(q);
    let me = null;
    try { me = Room.getMyId ? Room.getMyId() : null; } catch (e) { me = null; }
    if (isId && me && q.toLowerCase() === String(me).toLowerCase()) {
      list.appendChild(H.el("p", { class: "muted", text: "That is you." }));
    } else if (_dmStartable(q, rows)) {
      list.appendChild(_dmStartRow(q));
    }
    const shown = (rows || []).filter((r) => _dmMatches(r, q));
    const sg = _dmSuggestions(q, rows);
    const suggest = () => {
      if (!sg.length) return;
      list.appendChild(H.el("div", { class: "dm-suggest-head", text: "People in this space" }));
      const scroller = H.el("div", { class: "dm-suggest-list" });
      for (const m of sg) scroller.appendChild(_dmSuggestRow(m));
      list.appendChild(scroller);
    };
    if (!shown.length) {
      if (sg.length) { suggest(); return; }
      if (!q && !(rows || []).length) {
        list.appendChild(H.el("p", { class: "muted",
          text: "No conversations yet. Type someone's full Matrix ID above to start one, or click a person anywhere they appear and choose Message." }));
      } else if (q && !isId) {
        list.appendChild(H.el("p", { class: "muted", text: q.charAt(0) === "@"
          ? "To start a chat, type their full ID, like @someone:server."
          : "No conversations match \u201c" + q + "\u201d. To start a new chat, type their full Matrix ID." }));
      }
      return;
    }
    for (const r of shown) list.appendChild(_dmRowEl(r, box));
    suggest();
  }

  // ── SUGGESTIONS FROM THE SPACE (owner request, ddjp_435) ────────────────────────────────────────
  // Typing the start of somebody's user name — "@" optional — suggests MEMBERS OF THE CURRENT SPACE,
  // online or not: `Room.getRoster()`, the space's joined members with their cleaned display names, the
  // list the People panel uses. A match is the start of the Matrix localpart or of any word in the
  // display name, any case. Never you, never someone already in the list (their row shows instead), and
  // at most fifty (owner request, ddjp_436 — it was eight), shown in a box of their own that scrolls, so a
  // big space can be browsed without burying your conversations. A full ID is the start row's job, not this.
  // The cap lives INSIDE the function so the J15 harness, which extracts functions by name, carries it along.
  function _dmSuggestions(q, rows) {
    const SUGGEST_CAP = 50;
    const raw = String(q || "").trim().toLowerCase();
    if (!raw || /^@[^\s:]+:\S+$/.test(raw)) return [];
    const needle = raw.charAt(0) === "@" ? raw.slice(1) : raw;
    if (!needle) return [];
    let roster = [], me = null;
    try { roster = (Room.getRoster && Room.getRoster()) || []; } catch (e) { roster = []; }
    try { me = Room.getMyId ? String(Room.getMyId() || "").toLowerCase() : null; } catch (e) { me = null; }
    const listed = new Set((rows || []).map((r) => String(r.userId || "").toLowerCase()));
    const out = [];
    for (const m of roster) {
      const id = String((m && m.userId) || "").toLowerCase();
      if (!id || id === me || listed.has(id)) continue;
      const local = id.replace(/^@/, "").split(":")[0];
      const name = String((m && m.name) || "").toLowerCase();
      const byLocal = local.indexOf(needle) === 0;
      const byName = name.split(/\s+/).some((wd) => wd.indexOf(needle) === 0);
      if (byLocal || byName) out.push({ userId: m.userId, name: m.name || m.userId, byLocal: byLocal });
    }
    out.sort((a, b) => (Number(b.byLocal) - Number(a.byLocal)) || String(a.name).localeCompare(String(b.name)));
    return out.slice(0, SUGGEST_CAP);
  }
  function _dmSuggestRow(m) {
    const row = H.el("div", { class: "room-item dm-row dm-start dm-suggest" }, [
      H.avatarEl(m.userId, 28),
      H.el("div", { class: "dm-who-col" }, [
        H.el("span", { class: "dm-who", text: m.name }),
        H.el("span", { class: "dm-full-id", text: m.userId }),
      ]),
      H.el("span", { class: "dm-when", text: "Start a chat" }),
    ]);
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.onclick = () => _startDMByUserId(m.userId);
    row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onclick(); } };
    return row;
  }
  // The row a new chat is started from — the list's own row shape, marked as an action.
  function _dmStartRow(userId) {
    const row = H.el("div", { class: "room-item dm-row dm-start" }, [
      H.avatarEl(userId, 28),
      H.el("div", { class: "dm-who-col" }, [
        H.el("span", { class: "dm-who", text: "Start a chat with " + userId }),
        H.el("span", { class: "dm-full-id", text: "Click, or press Enter" }),
      ]),
    ]);
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    row.onclick = () => _startDMByUserId(userId);
    row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onclick(); } };
    return row;
  }
  function _dmRowEl(r, box) {
    // ── THE ROOM LIST'S ROW SHAPE, REUSED (v273) ───────────────────────────────────────
    // `.room-item` is the established row: a bordered box with its own background and hover. Reused
    // rather than invented. THE FULL MATRIX ID IS SHOWN under the short name, because it is the only
    // thing that actually identifies a person — a display name is chosen by them and is not unique.
    const nameEl = H.el("span", { class: "dm-who", text: r.userId ? H.shortName(r.userId) : "someone" });
    const idEl = H.el("span", { class: "dm-full-id", text: r.userId || "" });
    const who = H.el("div", { class: "dm-who-col" }, [nameEl, idEl]);
    if (r.request) who.appendChild(H.el("span", { class: "dm-request-note", text: "wants to chat" }));
    const row = H.el("div", { class: "room-item dm-row" + (r.unread ? " unread" : "") }, [
      H.avatarEl(r.userId, 28),
      who,
      H.el("span", { class: "dm-when", text: r.lastTs > 0 ? Panels._fmtAgo(r.lastTs) : "" }),
    ]);
    if (r.unread) row.appendChild(H.el("span", { class: "dm-dot", text: "●", title: r.request ? "Wants to chat" : "New message" }));
    if (r.request) {
      const key = r.requestKey || r.userId;
      const acc = H.el("button", { class: "mini", text: "Accept" });
      const ref = H.el("button", { class: "mini", text: "Refuse" });
      const lock = () => { acc.disabled = true; ref.disabled = true; };
      const answer = (fn) => (e) => {
        if (e && e.stopPropagation) e.stopPropagation();
        lock();
        Promise.resolve().then(() => fn(key)).then(() => {}, () => {}).then(() => { renderDMPanel(); });
      };
      acc.onclick = answer((k) => Chat.acceptDMRequest(k));
      ref.onclick = answer((k) => Chat.declineDMRequest(k));
      try { if (Chat.dmAnswering && Chat.dmAnswering(key)) lock(); } catch (e) {}
      row.appendChild(H.el("div", { class: "dm-request-actions" }, [acc, ref]));
    }
    row.setAttribute("role", "button");
    row.setAttribute("tabindex", "0");
    // A request with no conversation yet opens nothing — answering it is the only thing to do with it.
    row.onclick = (r.roomIds && r.roomIds.length && r.roomId) ? () => _openDMConversation(r.roomId) : () => {};
    row.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); row.onclick(); } };
    return row;
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
    let clearBtn = null;
    if (rows.length > 0) {
      head.appendChild(clearBtn = H.el("button", {
        class: "mini", text: "Clear list",
        title: "Forget which conversations you have had on this device. No messages are stored.",
        onclick: () => { try { Chat.clearConversations(); } catch (e) {} renderDMPanel(); },
      }));
    }
    box.appendChild(head);

    // NO EARLY RETURN FOR AN EMPTY LIST (ddjp_434): the search box is also how a chat is started, and a
    // person with no conversations yet is exactly who needs it. `_renderDMList` says what to do instead.

    // ── THE SEARCH BOX, THEN ONE ROW PER PERSON (owner rulings, ddjp_433) ──────────────────────────
    // Requests are rows in this list now, in the same shape as a conversation, with Accept and Refuse in
    // the row; the separate "message requests" block is gone. Typing filters the rows only, so the box
    // keeps its focus and text; the text lives on the DM box, so a redraw keeps it and its filter.
    const search = H.el("input", { class: "dm-search", type: "search", placeholder: "Search people by name or Matrix ID" });
    search.value = box._dmQuery || "";
    const list = H.el("div", { class: "dm-list" });
    // CLEAR LIST STEPS ASIDE WHILE YOU TYPE (owner request, ddjp_435) — a button that forgets every
    // conversation should not sit beside a box you are typing a name into.
    const syncClear = () => { if (clearBtn) clearBtn.style.display = String(box._dmQuery || "").trim() ? "none" : ""; };
    syncClear();
    search.oninput = () => { box._dmQuery = search.value || ""; syncClear(); _renderDMList(list, rows, box); };
    // ONE BOX FINDS PEOPLE AND STARTS A CHAT (owner request, ddjp_434). Enter on a full Matrix ID that is
    // not in the list starts it, as the "Start a chat with …" row does.
    search.onkeydown = (e) => {
      if (!e || e.key !== "Enter") return;
      const q = String(search.value || "").trim();
      if (_dmStartable(q, rows)) { if (e.preventDefault) e.preventDefault(); _startDMByUserId(q); return; }
      // Otherwise Enter picks the TOP SUGGESTION, when no conversation in the list matches (ddjp_435).
      const sg = _dmSuggestions(q, rows);
      if (sg.length && !(rows || []).some((r) => _dmMatches(r, q))) {
        if (e.preventDefault) e.preventDefault();
        _startDMByUserId(sg[0].userId);
      }
    };
    box.appendChild(search);
    // A refusal is named right under the box it came from — never swallowed.
    if (_dmNewError) box.appendChild(H.el("p", { class: "muted dm-new-error", text: _dmNewError }));
    _renderDMList(list, rows, box);
    box.appendChild(list);

    // (The separate "@someone:server / Start" box that stood here is gone — the search box above does it.)
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
      if (res && res.ok) { _dmNewError = ""; if (refs.dmBox) refs.dmBox._dmQuery = ""; _openDMConversation(res.roomId); return; }
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
    // A REFUSAL IS SAID, under the search box (ddjp_437). This redrew the list and nothing else, which looks
    // exactly like the app ignoring the click — and it kept "ignoring" it, so it looked permanent.
    // The reason is NAMED (ddjp_438): one sentence for every case hid which one happened.
    if (!res.ok) {
      const why = res.reason;
      _dmNewError = "That conversation could not be opened \u2014 " + (why === "group" ? "that room has more than two people in it, so it is not a direct message."
        : why === "left" ? "you are no longer in that room. Search their name to start a new chat."
        : why === "not-loaded" ? "its room has not loaded yet. Try again in a moment."
        : why === "gone" ? "its room is gone, and there is nobody known to start a new one with. Use Clear list to tidy it away."
        : why === "alone" ? "nobody else is in that room any more. Search their name to start a new chat."
        : "it is not a direct message.");
      renderDMPanel(); return;
    }
    _dmNewError = "";
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
    // The conversation is a PERSON (ddjp_432): named from them, not from whichever room a reply goes to — which
    // can differ from the row's room, and is null for a conversation whose room is gone (ddjp_439).
    let who = "";
    try { who = (Chat.currentDMPerson && Chat.currentDMPerson()) || ""; } catch (e) { who = ""; }
    if (!who) who = (_dmRows.find((r) => r.roomId === (Chat.currentDM && Chat.currentDM())) || {}).userId || "";
    const back = H.el("button", { class: "mini", text: "← Conversations", onclick: () => {
      try { Chat.closeDM(); } catch (e) {}
      _dmView = "list"; _dmMessages = []; renderDMPanel();
    } });
    box.appendChild(H.el("div", { class: "dm-head" }, [back, H.el("span", { class: "dm-title", text: H.shortName(who) })]));
    let roomless = false;
    try { roomless = !!(Chat.currentDM && !Chat.currentDM()); } catch (e) { roomless = false; }
    if (roomless) box.appendChild(H.el("p", { class: "muted dm-earlier-note", text: "There is no room with them any more \u2014 your first message starts a new one." }));

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
      note.textContent = res.reason === "too-long"
        ? "Too long — " + res.count + "/" + res.max + " characters. Shorten it to send."
        : res.reason === "no-crypto"
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
    Chat.onDMMessage((id, sender, body, failed, ts, roomId, tooLong) => {
      _dmMessages = _dmFoldMessage(_dmMessages, { id, sender, body, failed, ts, tooLong }, DM_MSG_CAP);
      if (H.rightTab() === "dm" && _dmView === "convo") renderDMPanel();
    });
    // A NEW DM CHIMES (ddjp_432), with its own on/off and volume, separate from the mention sound.
    if (Chat.onDMNotify) Chat.onDMNotify(() => { _dmChime(); });
    Chat.onDMChange(() => {
      _renderDMBadge();
      if (H.rightTab() === "dm") renderDMPanel();
    });
  }

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ CHAT
  //
  // The model, the view, and the box that renders it. Rows are placed by server time and id,
  // never arrival order.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ---------------------------------------------------------------------------
  // CHAT — MODEL FIRST, THEN THE SCREEN (ddjp_425)
  // ---------------------------------------------------------------------------
  // Chat is a bounded RAM model backed by Matrix, and the box is only ever a RENDERING of it.
  // Decrypted text never touches disk (ephemeral/E2E preserved; cleared on boot).
  //
  // ── WHY IT IS BUILT THIS WAY: THE PATCHED BOX SHOWED THE WRONG ROOM ──────────────────────────
  // Until ddjp_424 the box was PATCHED: one DOM element shared by every tier, a row inserted here
  // and replaced there, and per-tier sets of "mounted ids" doing the bookkeeping. Driven against
  // the real file (with a positive control, and the whole suite green throughout):
  //   · a TIER SWITCH left the old tier's rows on screen under the new tier's name — the box was
  //     never cleared and the repaint rebuilt only the new tier's mounted ids;
  //   · a MAIN-CHAT CHANGE did the same, through the same repaint;
  //   · a JOIN drew every message TWICE — the backfill ran before the box knew its tier and filed
  //     under `_active`, while the live copies of the same messages filed under the tier's name;
  //   · a message from a channel NO TIER NAMED was filed and drawn under whichever tier was visible.
  // Each was a plausible screen rather than an error. None could be seen by a guard, because the
  // shared fake DOM had no way to say which rows were in the box.
  //
  // ── THE SHAPE NOW ────────────────────────────────────────────────────────────────────────
  //   1. MESSAGES ARE FILED BY THE CHANNEL THEY ARRIVED ON — `room_id`, a fact of the transport —
  //      and never by a tier name resolved at arrival. One `ChatBuffer` per channel id. A message
  //      with no channel is not filed, and one whose channel is no tier is filed and drawn nowhere.
  //   2. `ChatBuffer.view` — PURE — turns the active channel's buffer plus the feed's rows into the
  //      list of rows to show.
  //   3. The box is RECONCILED to that list: rows it no longer holds leave, rows that changed are
  //      rebuilt, existing rows are kept (so an image does not reload), and a different channel is
  //      a fresh screen rather than a patch.
  // So a tier switch, a main-chat change and a new message are one operation — recompute and
  // reconcile — and none of the four faults above has anywhere to live. `check-chat-view` drives
  // the real file against a DOM double that can answer "what is on screen".
  //
  // ── THE WINDOW ───────────────────────────────────────────────────────────────────────────
  // On entry every readable tier is backfilled with its last CHAT_BACKFILL messages. While a
  // channel's backfill is in flight its view is "the last CHAT_BACKFILL readable messages", so the
  // scrollback flood (which arrives NEWEST-first through `Event.decrypted`) cannot pile up. When it
  // lands, the window's ANCHOR is set to the oldest of those; from then on the view is everything
  // from the anchor forward. Scrolling up moves the anchor back CHAT_PAGE at a time, from RAM — chat
  // still never pages Matrix on scroll. Following the tail past CHAT_DOM_CAP moves it forward.
  //
  // ── THE FEED, GO-FORWARD (owner ruling, ddjp_425) ──────────────────────────────────────────
  // The Feed tab is gone and its rows sit between messages, in every tier, at their server time.
  // They are read from `Room.recentEvents` (the fold is unchanged, and still excludes what the room
  // refused) on the re-derive announcement, and shown only if strictly after the GO-FORWARD LINE:
  // the newest server stamp this client held when the chat started — after the join path's replay,
  // so history does not read as new. A server stamp and never the device clock (README trap 2).
  // Which kinds show is `ChatPrefs.feedShown`, a device choice made ONE KIND AT A TIME, defaulting to
  // `Room.FEED_KINDS[type].shownByDefault` (saves, skips and unplayable-song skips on; the rest off).
  const CHAT_DOM_CAP = 600;        // most rows mounted while following the tail
  const CHAT_BOTTOM_SLOP = 48;     // px from the bottom still counts as "at the bottom"
  const CHAT_TOP_SLOP = 64;        // px from the top that triggers a load-older
  const CHAT_PAGE = 30;            // messages revealed from RAM per scroll-up
  const CHAT_BACKFILL = 10;        // recent-history fetch per tier on room entry (hardcoded for now)
  const CHAT_IMG_LRU = 30;         // max inline images kept decoded (with a live src) at once
  const FEED_IN_CHAT_LIMIT = CHAT_DOM_CAP;   // feed rows read per re-derive; never more than a screenful
  const UTD_TEXT = "Couldn't decrypt this message";   // shown for an undecryptable message
  // What a tombstone says. Deliberately about the ACT and not the actor: the row keeps its
  // author's name and colour, so "Message deleted" beside it already reads as *they took it back*.
  // Naming a redactor here would be wrong the moment a moderator case exists.
  const REDACTED_TEXT = "Message deleted";
  // An anchor that admits everything held — the window of a channel whose history fits on screen.
  const ALL_HELD = Object.freeze({ ts: -Infinity, key: "" });

  // ── THE MODEL ────────────────────────────────────────────────────────────────────────────
  // Anchored on the box, so its lifetime is the room's: `enterMainScreen` clears the screen and
  // `buildMainDom` builds a NEW box on every room entry, so nothing of the last room's chat can
  // reach this one. (`_resetChatState` existed for a room change and was filed as unused three
  // times; with the box as the model's owner there is nothing to reset, and it is gone.)
  function _newChatModel() {
    return {
      bufs: Object.create(null),    // channel id -> ChatBuffer — keyed by where a message ARRIVED
      views: Object.create(null),   // channel id -> { anchor, pending, backfilled }
      activeId: null,               // the channel the box shows (the resolver's `activeId`)
      paintedId: null,              // the channel the box last painted; a change is a fresh screen
      feedFromTs: null,             // the go-forward line, a server stamp; null = no feed yet
      feed: [],                     // the last feed reading, already cut to after the line
      gen: 0,                       // bumped to rebuild every row (a display preference changed)
      started: false,
      io: null, imgLRU: [],
    };
  }
  // ── A SWITCH NEVER REPLACES A BUFFER, AND THE MEASUREMENT THAT FORCED IT (J12) ────────────────
  // Before J12 there was ONE buffer on the box and a tier change replaced it wholesale. DRIVEN
  // (`probe-j12-tiers.js` R0): 120 messages in, switch, 0 out — a different buffer object, the old one
  // unreachable. Chat is RAM-only, so the only recovery was a ten-message backfill against a buffer
  // cap of 5000. So every channel's buffer is held on the model for the room's life, and a switch only
  // changes WHICH buffer the box renders — never replaces one. `check-chat-tiers` PART A drives it.
  function _chatModel(box) {
    if (!box._chat) box._chat = _newChatModel();
    return box._chat;
  }
  function _bufFor(model, channelId) {
    if (!model.bufs[channelId]) model.bufs[channelId] = ChatBuffer.create();
    return model.bufs[channelId];
  }
  function _viewFor(model, channelId) {
    if (!model.views[channelId]) model.views[channelId] = { anchor: null, pending: false, backfilled: false };
    return model.views[channelId];
  }
  // The one resolution, read through the feature layer. The panel never picks a channel itself.
  function _resolveTiers() {
    let r = null;
    try { r = Room.chatTiers(); } catch (e) { r = null; }
    return r || { tiers: [], activeTier: null, activeId: null };
  }
  // Is this KIND of room event shown on this device? The device's own choice if it made one, else the
  // kind's default, read from beside its name in `Room.FEED_KINDS` (owner ruling, ddjp_427). A kind the
  // table does not name is shown — hiding what nobody chose to hide would be a filter nobody set.
  function _feedShown(type) {
    let dflt = true;
    try {
      // A room kind (the log's vocabulary) or a chat kind (ddjp_430 — chat never reaches the log).
      const k = (Room.FEED_KINDS && Room.FEED_KINDS[type]) || (Chat.EVENT_KINDS && Chat.EVENT_KINDS[type]);
      if (k && k.shownByDefault === false) dflt = false;
    } catch (e) {}
    try { return ChatPrefs.feedShown(type, dflt) !== false; } catch (e) { return dflt; }
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
    // ONE NAME PER SETTING, EVERYWHERE. The settings panel titles its rows from this table, the
    // feed names a change with it, and the delegation list lists by it — so a setting cannot be
    // called one thing in the panel and another where its change is reported. Plain words, no units
    // (the unit belongs to the control). Renamed in the settings rework by the owner's approval.
    const NAMES = {
      vis: "Room access", chat: "Main chat", bg: "Background",
      minDjRank: "Who can DJ", repeatCooldownMs: "No repeats for",
      // The song trio is named by CONCEPTS.md §4.2, the one place they are disambiguated: two clamps
      // on the agreed length, a floor on play time, and a margin off the length — three ideas.
      maxLen: "Longest song", minLen: "Shortest counted length",
      minGate: "Minimum play time", graceMs: "Length tolerance", presendMs: "Hand-off delay",
      vouchJitter: "Turn-taking gap",
      skipRoads: "Skip rules",
      botPresenceSpine: "Room actions count as activity", botPingMs: "Reply window",
      botAfkMs: "Away after", botPresenceChat: "Chat counts as activity",
      activityPresence: "Actions that keep you present",
      queueIdleMs: "Give up queue place after", botQueueChat: "Chat keeps your queue place",
      activityQueue: "Actions that keep your queue place",
      checkpointCooldownMs: "Summary gap", checkpointEvery: "Summary after",
      vouchTable: "Backups needed", receiptsPerMessage: "Backups per message",
      checkpointTable: "Stand-in summaries", checkpointRankOffsetMs: "Head start per rank",
      selfWitnessCheckpoint: "Solo summaries",
    };
    return NAMES[key] || String(key || "");
  }

  // Pure. One resolution + the read markers -> the strip's labels. Separated from the renderer so
  // what a badge CLAIMS can be driven without a DOM.
  function _chatTierLabel(res, unreadFor, mentionFor) {
    const r = res || {};
    const tiers = Array.isArray(r.tiers) ? r.tiers : [];
    const unread = (typeof unreadFor === "function") ? unreadFor : (() => false);
    const mentioned = (typeof mentionFor === "function") ? mentionFor : (() => false);
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
        // ddjp_431 — somebody used your full Matrix ID in this tier and you have not opened it since.
        mentioned: !!mentioned(t.tier),
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
    const lab = _chatTierLabel(res, (t) => { try { return ChatPrefs.tierUnread(t); } catch (e) { return false; } },
                                    (t) => { try { return !!ChatPrefs.tierMentioned(t); } catch (e) { return false; } });
    if (!lab.tiers.length) { try { _renderLevelDots(); } catch (e) {} return; }
    for (const t of lab.tiers) {
      // `tab` is the queue's own sub-button class and `active` is the queue's own selected marker,
      // so which tier is live reads exactly as which queue pane is live. `chat-tier` stays for the
      // unread dot's positioning — the badge is this strip's alone and the queue has no equivalent.
      const b = H.el("button", { class: "tab chat-tier" + (t.active ? " active" : "") + (t.unread ? " unread" : "") + (t.mentioned ? " mentioned" : ""),
                               text: t.label, title: t.main ? "The room's main chat tier" : "" });
      b.onclick = () => _selectChatTier(t.tier);
      refs.chatTiers.appendChild(b);
    }
    refs.chatTiers.appendChild(H.el("span", { class: "muted chat-tier-note", text: lab.note }));
    // THE DOTS COME AFTER THE ROW IS BUILT (ddjp_443). They were drawn in the middle — after the clear, before the
    // buttons — so anything that redrew this row from inside them added a whole extra set: the owner's screenshot,
    // 1149 copies. Drawn last, a nested redraw can only REPLACE the row, never stack onto it.
    try { _renderLevelDots(); } catch (e) {}
  }

  // The switch. Re-points the feature layer through the ONE resolver, then shows that channel's
  // model — a fresh screen, because the box now shows a different source. Nothing is re-inited
  // and nothing is lost: every channel's buffer is retained on the model (J12's Done-when).
  function _selectChatTier(tier) {
    const box = refs.chatBox;
    let res;
    try { res = Room.selectChatTier(tier); } catch (e) { return; }
    if (!box) return;
    const m = _chatModel(box);
    m.activeId = (res && res.activeId) || null;
    // Reading a tier is what clears its badge, and it is marked at the tier's OWN newest stamp
    // rather than at a clock — the marker and the messages have to be on one scale or a badge
    // could survive being read (P2, one level up from the clock rule).
    try {
      const buf = m.activeId ? m.bufs[m.activeId] : null;
      const ids = buf ? buf.ids() : [];
      const newest = ids.length ? (buf.get(ids[ids.length - 1]) || {}).ts : 0;
      if (newest && res.activeTier) ChatPrefs.tierMarkRead(res.activeTier, newest);
    } catch (e) {}
    _paint(box);
    _renderChatTierStrip();
  }

  function _chatAtBottom(box) { return (box.scrollHeight - box.scrollTop - box.clientHeight) <= CHAT_BOTTOM_SLOP; }
  function _eidSel(id) { return '[data-eid="' + (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id) + '"]'; }

  // Lazily load an inline image's src only when it scrolls into view, and keep at
  // most CHAT_IMG_LRU images decoded — scroll one far away and it's released;
  // scroll back and it reloads (served from the browser's HTTP cache, so the
  // image host isn't re-hit). RAM-only; nothing persisted. One observer per box, on the model.
  function _chatObserver(box) {
    const st = _chatModel(box);
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
    // Over the limit (ddjp_430). Room chat shows these as a chat event instead; a DM, which has no
    // event settings, draws its row with this, because silently losing a person's message is worse.
    if (record.tooLong) {
      const t = document.createElement("span");
      t.className = "chat-redacted";
      t.textContent = " Message too long to show";
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
    // THE ACCENT (ddjp_431): a message that mentions THIS account, and is not its own, is marked.
    let me = null;
    try { me = Room.getMyId ? Room.getMyId() : null; } catch (e) { me = null; }
    let pinged = false;
    try { pinged = !record.redacted && record.sender !== me && Chat.mentions(record.body, me); } catch (e) { pinged = false; }
    const msg = H.el("div", { class: (o.rowClass || "chat-msg") + (pinged ? " chat-mention" : "") }, [av, senderEl]);
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

  // ── A FEED ROW (moved from the Feed panel, ddjp_425) ──────────────────────────────────────
  // Who did what, in the fold's own words (`Room.FEED_KINDS[type].verb`). The panel's version also
  // carried a relative age against `ServerClock`; a chat row carries none — it sits in time order
  // between messages that carry none either, and a stale "3 mins ago" frozen into a row that is
  // only rebuilt when something changes would be a plausible value that is quietly wrong.
  function _feedRowText(row) {
    const r = row || {};
    return { who: r.sender ? H.shortName(r.sender) : "somebody", verb: r.verb || "did something" };
  }
  function _feedRow(row) {
    const t = _feedRowText(row);
    // GREY, AND ONLY THE STYLESHEET SAYS SO (owner request, ddjp_428). The name used to take the person's
    // rank colour INLINE, which overrode the `.chat-feed` rules and could be near-white — so an event read
    // like a message. It borrows `sender` for weight and spacing and nothing colours it here.
    const whoEl = H.el("span", { class: "sender", text: t.who });
    // The same one trigger every surface a person appears in uses (J14).
    if (row.sender) Roster._wireCardTrigger(whoEl, row.sender);
    const n = H.el("div", { class: "chat-feed" },
                   [whoEl, H.el("span", { class: "chat-feed-verb", text: " " + t.verb })]);
    n.dataset.fid = row.eventId;
    return n;
  }

  // ── THE MENTION CHIME (ddjp_431) — made in the browser, never downloaded ───────────────────────────
  // Two soft sine notes under one envelope, synthesised with Web Audio, so there is no file to fetch and
  // no third party to ask. On by default at a third of full volume (owner ruling); the volume scales
  // the peak linearly, so a setting of 66 is twice as loud as 33. At most one chime per CHIME_GAP_MS — a
  // burst of mentions is badged and plays once. Browsers refuse sound until the page has been touched,
  // so the context is created (and resumed) on the first click or key after the chat starts; a mention
  // before that is badged and silent. The gap is measured on this device's clock, which is correct here:
  // it compares two moments on this device and never a server stamp (README trap 2).
  const CHIME_GAP_MS = 3000;
  const CHIME_PEAK = 0.3;          // the peak gain at 100% — a chime, not an alarm
  let _audioCtx = null;
  function _audio() {
    if (_audioCtx) { try { if (_audioCtx.state === "suspended") _audioCtx.resume(); } catch (e) {} return _audioCtx; }
    if (typeof AudioContext === "undefined") return null;
    try { _audioCtx = new AudioContext(); } catch (e) { _audioCtx = null; }
    return _audioCtx;
  }
  function _chime(ctx, volumePct) {
    const peak = CHIME_PEAK * volumePct / 100, t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
    g.connect(ctx.destination);
    for (const [freq, at] of [[880, 0], [1318.5, 0.12]]) {       // A5, then E6
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, t0 + at);
      o.connect(g);
      o.start(t0 + at);
      o.stop(t0 + 0.62);
    }
  }
  function _mentionChime(m) {
    let on = true, vol = 33;
    try { on = ChatPrefs.mentionSound() !== false; vol = ChatPrefs.mentionVolume(); } catch (e) {}
    if (!on || !(vol > 0)) return false;
    const now = Date.now();
    if (m && m.lastChimeAt && now - m.lastChimeAt < CHIME_GAP_MS) return false;
    const ctx = _audio();
    if (!ctx) return false;
    if (m) m.lastChimeAt = now;
    try { _chime(ctx, vol); } catch (e) { return false; }
    return true;
  }
  // A NEW DM (ddjp_432): the same chime, its OWN switch and volume and its own burst gap, so a DM and a
  // mention in the same moment are two things you asked to hear rather than one swallowing the other.
  let _lastDMChimeAt = 0;
  function _dmChime() {
    let on = true, vol = 33;
    try { on = ChatPrefs.dmSound() !== false; vol = ChatPrefs.dmVolume(); } catch (e) {}
    if (!on || !(vol > 0)) return false;
    const now = Date.now();
    if (_lastDMChimeAt && now - _lastDMChimeAt < CHIME_GAP_MS) return false;
    const ctx = _audio();
    if (!ctx) return false;
    _lastDMChimeAt = now;
    try { _chime(ctx, vol); } catch (e) { return false; }
    return true;
  }
  function _resetDMChimeGap() { _lastDMChimeAt = 0; }
  // The settings panel plays one at the chosen volume when a slider is released: `kind` "dm" or mention.
  function previewChime(kind) {
    let vol = 33;
    try { vol = (kind === "dm") ? ChatPrefs.dmVolume() : ChatPrefs.mentionVolume(); } catch (e) {}
    const ctx = _audio();
    if (ctx && vol > 0) { try { _chime(ctx, vol); } catch (e) {} }
  }
  function _armAudio() {
    if (typeof document === "undefined" || !document.addEventListener) return;
    const arm = () => { _audio(); document.removeEventListener("pointerdown", arm); document.removeEventListener("keydown", arm); };
    document.addEventListener("pointerdown", arm);
    document.addEventListener("keydown", arm);
  }

  // ── THE @ BUTTON'S EFFECT (ddjp_431) ─────────────────────────────────────────────────────────────
  // Pure: the person's full Matrix ID into `value` at the caret (replacing a selection), with a space
  // before it unless one is there or it is the start, and a space after unless one is there. The caret
  // lands after the space that follows the ID — inserted or already present — so typing carries on.
  function _mentionInsert(value, start, end, id) {
    const v = String(value == null ? "" : value);
    const a = Math.max(0, Math.min(v.length, Number(start) || 0));
    const b = Math.max(a, Math.min(v.length, (typeof end === "number") ? end : a));
    const left = v.slice(0, a), right = v.slice(b);
    const pre = (left && !/\s$/.test(left)) ? " " : "";
    const post = /^\s/.test(right) ? "" : " ";
    return { value: left + pre + id + post + right, caret: (left + pre + id).length + 1 };
  }
  function insertMention(userId) {
    if (!userId || !refs.chatInput) return;
    try { H.setRightTab("chat"); } catch (e) {}
    try { if (H._relockAllPanels) H._relockAllPanels(); } catch (e) {}
    try { if (typeof QueuePanels !== "undefined" && QueuePanels.renderRightPanel) QueuePanels.renderRightPanel(); } catch (e) {}
    const inp = refs.chatInput;
    const a = (typeof inp.selectionStart === "number") ? inp.selectionStart : String(inp.value || "").length;
    const b = (typeof inp.selectionEnd === "number") ? inp.selectionEnd : a;
    const r = _mentionInsert(inp.value, a, b, userId);
    inp.value = r.value;
    try { inp.focus(); inp.setSelectionRange(r.caret, r.caret); } catch (e) {}
    try { if (inp.oninput) inp.oninput(); } catch (e) {}      // the character counter follows
  }

  // ── NOTIFICATION DOTS AT EVERY LEVEL, IN EVERY LAYOUT (owner rulings, ddjp_441) ─────────────────────
  // The levels: the layout switch (Compact's Chat|Queues, Phone's Queues|Player|Chat) → the right-panel tabs
  // (Chat, DMs) → the tier buttons and DM rows. The leaves are the read markers (`ChatPrefs`); every level
  // above shows a dot while something UNREAD below it arrived after that level was last ON SCREEN. So:
  // opening a button clears that button and nothing deeper; a button is never dotted above something read
  // (it only ever looks at unread leaves); something newer re-lights the path. Orange = new chat; purple =
  // personal (a mention, a DM, a request). The "seen" marks are server stamps and live in RAM — after a reload
  // the path re-lights for whatever is still unread below, which on joining is only DMs.
  const _seenAt = { social: 0, chat: 0, dm: 0 };
  function _onScreen(tab) {
    let pane = true, cur = "chat";
    try { if (typeof H.paneShown === "function") pane = !!H.paneShown("social"); } catch (e) { pane = true; }
    try { if (typeof H.rightTab === "function") cur = H.rightTab(); } catch (e) { cur = "chat"; }
    return pane && cur === tab;
  }
  // NEVER RE-ENTERED (ddjp_442): drawing the dots moves read markers, and nothing a marker move triggers may
  // draw the dots again inside this one. MEASURED DOMINATED TODAY: read markers no longer fire `onChange`, so a
  // mutation removing this stays green. Kept anyway, and said so, because what it prevents is not a wrong dot
  // but a frozen app — the next path that moves a marker and redraws cannot bring the loop back.
  let _drawingDots = false;
  function _renderLevelDots() {
    if (_drawingDots) return;
    _drawingDots = true;
    try { _renderLevelDotsNow(); } finally { _drawingDots = false; }
  }
  function _renderLevelDotsNow() {
    let pane = true;
    try { if (typeof H.paneShown === "function") pane = !!H.paneShown("social"); } catch (e) { pane = true; }
    const vChat = _onScreen("chat"), vDM = _onScreen("dm");
    // The tier ON SCREEN is read now that it is (a message that arrived while it was hidden stayed unread).
    if (vChat && refs.chatBox && refs.chatBox._chat) {
      const m = refs.chatBox._chat, r = _resolveTiers();
      const buf = m.activeId ? m.bufs[m.activeId] : null, ids = buf ? buf.ids() : [];
      const newest = ids.length ? ((buf.get(ids[ids.length - 1]) || {}).ts || 0) : 0;
      if (newest && r.activeTier) { try { ChatPrefs.tierMarkRead(r.activeTier, newest); } catch (e) {} }
    }
    // An open DM is read only while it is on screen — `Chat` is told, and reads it the moment it is.
    try { if (Chat.setDMVisible) Chat.setDMVisible(vDM && _dmView === "convo"); } catch (e) {}
    let tiers = [];
    try { tiers = ChatPrefs.tierList() || []; } catch (e) { tiers = []; }
    let chatNew = 0, chatMention = 0;
    for (const t of tiers) {
      if (t.lastTs > t.readTs) chatNew = Math.max(chatNew, t.lastTs);
      if ((t.mentionTs || 0) > t.readTs) chatMention = Math.max(chatMention, t.mentionTs);
    }
    let dmNew = 0;
    try { for (const c of (Chat.conversations() || [])) if (c.unread) dmNew = Math.max(dmNew, c.lastTs || 0, 1); } catch (e) { dmNew = 0; }
    if (pane) _seenAt.social = Math.max(_seenAt.social, chatNew, chatMention, dmNew);
    if (vChat) _seenAt.chat = Math.max(_seenAt.chat, chatNew, chatMention);
    if (vDM) _seenAt.dm = Math.max(_seenAt.dm, dmNew);
    const set = (n, c, on) => { try { if (n && n.classList) n.classList.toggle(c, !!on); } catch (e) {} };
    set(refs.tabChat, "unread", chatNew > _seenAt.chat);
    set(refs.tabChat, "mentioned", chatMention > _seenAt.chat);
    set(refs.tabDM, "mentioned", dmNew > _seenAt.dm);
    let social = null;
    try { social = refs.paneNav ? Array.from(refs.paneNav.children).find((b) => b.dataset && b.dataset.pane === "social") : null; } catch (e) { social = null; }
    set(social, "unread", chatNew > _seenAt.social);
    set(social, "mentioned", chatMention > _seenAt.social || dmNew > _seenAt.social);
  }

  // ── A MESSAGE THAT WAS TOO LONG (ddjp_430) — shown as a chat event, grey like the room's ──────────
  // Who sent it and that it was too long; never any of its text, which was dropped at `Chat`'s door.
  // `data-eid` is the message's own id, so a deletion finds the row the way it finds any message.
  function _tooLongRow(rec) {
    const whoEl = H.el("span", { class: "sender", text: rec.sender ? H.shortName(rec.sender) : "somebody" });
    if (rec.sender) Roster._wireCardTrigger(whoEl, rec.sender);
    let verb = "sent a message that was too long to show";
    try { verb = Chat.EVENT_KINDS[Chat.TOO_LONG].verb || verb; } catch (e) {}
    const n = H.el("div", { class: "chat-feed" }, [whoEl, H.el("span", { class: "chat-feed-verb", text: " " + verb })]);
    if (rec.id) n.dataset.eid = rec.id;
    return n;
  }

  // ── RECONCILING THE BOX TO THE VIEW ──────────────────────────────────────────────────────
  // A row's signature says whether its content changed since it was built; `gen` forces every row
  // to rebuild when a display preference changes (text <-> image <-> link).
  function _sigOf(item, gen) {
    if (item.kind === "feed") return "f" + gen;
    if (item.kind === "long") return "l" + gen;
    const r = item.rec || {};
    return "m" + gen + (r.redacted ? "|R|" : "|-|") + r.body;
  }
  function _rowFor(box, item, sig) {
    const n = item.kind === "feed" ? _feedRow(item.row) : (item.kind === "long" ? _tooLongRow(item.rec) : _chatRow(box, item.rec));
    n.dataset.key = item.key;
    n.dataset.sig = sig;
    return n;
  }
  // A row leaving the box takes its image out of the observer and the LRU with it.
  function _releaseRow(m, n) {
    if (!n) return;
    const walk = (x) => {
      if (!x || !x.children) return;
      if (x.tagName === "IMG" || x.tag === "img") {
        try { if (m.io) m.io.unobserve(x); } catch (e) {}
        const id = x.dataset ? x.dataset.eid : null;
        if (id) { const i = m.imgLRU.indexOf(id); if (i >= 0) m.imgLRU.splice(i, 1); }
      }
      for (const c of Array.from(x.children)) walk(c);
    };
    walk(n);
  }
  function _reconcile(box, m, items, stick) {
    const want = new Set(items.map((it) => it.key));
    // Keep the reader where they are: remember the first row that survives, and where it was.
    let refKey = null, refTop = 0;
    const beforeTop = box.scrollTop;
    if (!stick) {
      for (const n of Array.from(box.children)) {
        const k = n.dataset ? n.dataset.key : null;
        if (k && want.has(k)) { refKey = k; refTop = n.offsetTop; break; }
      }
    }
    const have = Object.create(null);
    for (const n of Array.from(box.children)) {
      const k = n.dataset ? n.dataset.key : null;
      if (!k || !want.has(k)) { _releaseRow(m, n); n.remove(); continue; }
      have[k] = n;
    }
    const placed = Object.create(null);
    let i = 0;
    for (const it of items) {
      const sig = _sigOf(it, m.gen);
      let n = have[it.key];
      if (n && n.dataset.sig !== sig) {
        const fresh = _rowFor(box, it, sig);
        n.replaceWith(fresh);
        _releaseRow(m, n);
        n = fresh;
      } else if (!n) {
        n = _rowFor(box, it, sig);
      }
      const at = box.children[i] || null;
      if (at !== n) box.insertBefore(n, at);
      placed[it.key] = n;
      i++;
    }
    if (stick) box.scrollTop = box.scrollHeight;
    else if (refKey && placed[refKey]) box.scrollTop = beforeTop + (placed[refKey].offsetTop - refTop);
  }

  // Paint the active channel from the model. No feed re-read: that happens on the re-derive
  // announcement (`renderChat`), not on every message.
  function _paint(box) {
    if (!box) return;
    const m = _chatModel(box);
    const id = m.activeId;
    // A DIFFERENT SOURCE IS A FRESH SCREEN: it opens at the bottom instead of anchoring on a row of
    // the channel it replaced. What REMOVES that channel's rows is `_reconcile`, which drops every row
    // the new view does not hold. LATTICE-MEASURED at ddjp_425, with a control: an eager clear that
    // stood here was DOMINATED by it — dropping the clear alone left `check-chat-view` green,
    // dropping the reconcile's removal alone turned it red — so the clear was deleted rather than
    // kept as a second copy that reads like the enforcement. (An earlier draft of this comment called
    // the clear the fix for the tier-switch defect. The measurement said otherwise.)
    const fresh = m.paintedId !== id;
    m.paintedId = id;
    if (!id) return;
    const v = _viewFor(m, id);
    const stick = fresh || _chatAtBottom(box);
    let showLong = false;
    try { showLong = _feedShown(Chat.TOO_LONG); } catch (e) { showLong = false; }
    const opts = () => ({ anchor: v.anchor || (v.pending ? null : ALL_HELD), tail: CHAT_BACKFILL,
                          feedFromTs: m.feedFromTs, showFeed: _feedShown, showLong: showLong });
    let res = ChatBuffer.view(_bufFor(m, id), m.feed, opts());
    // Following the tail past the cap moves the window forward rather than letting it grow.
    if (stick && res.items.length > CHAT_DOM_CAP) {
      const first = res.items[res.items.length - CHAT_DOM_CAP];
      v.anchor = { ts: first.ts, key: first.key };
      res = ChatBuffer.view(_bufFor(m, id), m.feed, opts());
    }
    _reconcile(box, m, res.items, stick);
  }

  // Read the feed and paint. Called on the re-derive announcement — the one signal that fires for
  // everything that reached the fold — so a feed row can also LEAVE: an event that sorts earlier and
  // arrives late can turn an accepted act into a refused one (the twenty-first signature), and a
  // row that was shown must go when the fold stops narrating it. Derived, never accumulated.
  function _readFeed(m) {
    if (m.feedFromTs === null) return [];
    let f = null;
    try { f = Room.recentEvents({ limit: FEED_IN_CHAT_LIMIT }); } catch (e) { f = null; }
    const rows = (f && Array.isArray(f.rows)) ? f.rows : [];
    return rows.filter((r) => r && (Number(r.ts) || 0) > m.feedFromTs);
  }
  function renderChat(box) {
    box = box || refs.chatBox;
    if (!box) return;
    const m = _chatModel(box);
    m.feed = _readFeed(m);
    _paint(box);
  }

  // A chat display pref changed (image/link toggle, a host edit, a feed kind). Every row is rebuilt
  // from its record, and the feed is re-read so a hidden kind leaves and a shown one returns.
  function _repaintChat(box) {
    box = box || refs.chatBox;
    if (!box) return;
    const m = _chatModel(box);
    m.gen++;
    m.imgLRU = [];
    renderChat(box);
  }

  // Live receive. Filed into the buffer of the channel it ARRIVED on, then — only if that channel
  // is the one on screen — the box is reconciled to the new view. ts is the Matrix
  // origin_server_ts; the buffer orders by it, so a message delivered out of arrival order (E2E
  // history decrypts newest-first; late keys) lands in its correct slot.
  function addChatMessage(id, sender, body, failed, ts, roomId, tooLong) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box) return;
    // NO SOURCE, NO ROW. A message that cannot say which room it came from cannot be shown under
    // any room's name; the tree before this filed it under the visible tier.
    if (typeof roomId !== "string" || !roomId) return;
    const m = _chatModel(box);
    const res = _bufFor(m, roomId).upsert(id, sender, body, failed, ts, false, tooLong);
    if (res.type === "noop") return;

    // THE BADGE IS TOUCHED FOR EVERY TIER INCLUDING THE VISIBLE ONE, and the visible one is then
    // marked read immediately below. Touching only the hidden tiers would look equivalent and is
    // not: `tierTouch` is what CREATES the row, so a tier that had only ever been read while
    // visible would have no row at all and `tierUnread` would answer false for it forever after.
    // An over-long message does not light a badge: it has nothing to read, and with its event off by
    // default a badge would point at a tier with nothing new on it.
    // CHAT COUNTS FROM THE MOMENT YOU JOIN (owner ruling, ddjp_441): history loading at entry is not new.
    // And a message is READ ON ARRIVAL only if its tier is ON SCREEN — the tier you last viewed, while the
    // chat is off screen (Compact on Queues, another right-panel tab), used to be marked read and lit nothing.
    const tier = _tierForChannel(roomId);
    const lv = _viewFor(m, roomId);
    const live = !lv.pending && (Number(ts) || 0) > (lv.liveFrom || 0);
    const onScreen = roomId === m.activeId && _onScreen("chat");
    if (tier && !failed && !tooLong && live) {
      try {
        ChatPrefs.tierTouch(tier, ts);
        if (onScreen) ChatPrefs.tierMarkRead(tier, ts);
      } catch (e) {}
      // A MENTION (ddjp_431): somebody else's message with this account's full Matrix ID in it. The purple
      // mark is read state like the yellow one (cleared by opening the tier); the chime is for a LIVE one
      // only — never history arriving at entry, never a late decrypt of something older than the line.
      let me = null;
      try { me = Room.getMyId ? Room.getMyId() : null; } catch (e) { me = null; }
      let pinged = false;
      try { pinged = !!me && sender !== me && Chat.mentions(body, me); } catch (e) { pinged = false; }
      if (pinged) {
        try {
          ChatPrefs.tierMention(tier, ts);
          if (onScreen) ChatPrefs.tierMarkRead(tier, ts);
        } catch (e) {}
        const v = _viewFor(m, roomId);
        if (res.type === "insert" && v.backfilled && !v.pending && (Number(ts) || 0) > (v.liveFrom || 0)) _mentionChime(m);
      }
      _renderChatTierStrip();
    }
    if (roomId === m.activeId) _paint(box);
  }

  // ── A REDACTION ARRIVING (J11) ─────────────────────────────────────────────────────────────
  // ROUTED TO THE CHANNEL THE REDACTION ARRIVED IN, never to the tier being viewed — and a
  // redaction from a channel that holds no buffer here changes nothing. The tree before ddjp_425
  // routed an unrecognised channel to the VISIBLE tier, so a redaction could tombstone a message of
  // the same id in a room it did not come from.
  //
  // TOMBSTONE, NOT REMOVAL. `ChatBuffer.redact` mutates the record IN PLACE, which is what makes
  // this safe: the update branch never touches `order[]`, so the row keeps its chronological slot.
  // Remove-then-reinsert would land it at the FRONT, because `_place` sorts on the ts it is handed
  // and the original is lost with the record (`probe-j11-redact` R1b). The view then draws the mark
  // in the slot the message occupied. A record this device could not decrypt keeps `failed` across
  // a redaction, so it stays out of the view — a deletion must not reveal that an unreadable
  // message existed. And a redaction for a message this client never held is a no-op: it is the
  // normal case (buffers are per channel and capped, the client may have joined after the message),
  // and a mark for a message the person never saw would create a row rather than annotate one.
  function removeChatMessage(redactedId, roomId) {
    const box = refs.chatBox || document.getElementById("chat-messages");
    if (!box || !redactedId || typeof roomId !== "string" || !roomId) return;
    const m = _chatModel(box);
    const buf = m.bufs[roomId];              // never `_bufFor` — a redaction must not CREATE a buffer
    if (!buf || !buf.redact(redactedId)) return;
    if (roomId === m.activeId) _paint(box);
  }

  // Wire the scroll handler once per box: collapse back to the cap when we return to the bottom,
  // and reveal older RAM-held messages when we near the top.
  function _ensureChatScrollWired(box) {
    if (!box || box.dataset.scrollWired) return;
    box.dataset.scrollWired = "1";
    box.addEventListener("scroll", () => {
      if (_chatAtBottom(box)) { if (box.children.length > CHAT_DOM_CAP) _paint(box); }
      else if (box.scrollTop <= CHAT_TOP_SLOP) _loadOlderChat(box);
    });
  }

  // Scroll-up: move the window's anchor back CHAT_PAGE readable messages. RAM only — chat never
  // pages history from Matrix on scroll; the buffer holds the entry backfill and its scrollback
  // flood plus whatever has arrived live. The reconcile keeps the reader's row where it was.
  function _loadOlderChat(box) {
    const m = _chatModel(box);
    const id = m.activeId;
    if (!id) return;
    const v = _viewFor(m, id);
    if (!v.anchor || v.anchor === ALL_HELD) return;          // already showing everything held
    const buf = _bufFor(m, id);
    const readable = buf.ids().filter((k) => { const r = buf.get(k); return r && !r.failed; });
    const a = v.anchor;
    let idx = readable.findIndex((k) => { const r = buf.get(k); return r.ts > a.ts || (r.ts === a.ts && k >= a.key); });
    if (idx < 0) idx = readable.length;
    if (idx === 0) { v.anchor = ALL_HELD; _paint(box); return; }
    const next = Math.max(0, idx - CHAT_PAGE);
    const r = buf.get(readable[next]);
    v.anchor = next === 0 ? ALL_HELD : { ts: r.ts, key: readable[next] };
    _paint(box);
  }

  // ── ENTRY: EVERY READABLE TIER, ITS LAST CHAT_BACKFILL, ONCE ────────────────────────────────
  // One fetch per tier channel through `Chat.backfillRecent(count, chatId)`, which refuses a channel
  // this client may not receive from. Undecryptable backfilled messages are dropped before they
  // reach the buffer, so they never surface an error row. The SDK's scrollback re-fires
  // `Event.decrypted` for older history while the fetch runs; those land in the SAME channel buffer
  // through `addChatMessage`, and the view shows the last CHAT_BACKFILL until the fetch returns and
  // the anchor is set — so the flood can neither duplicate nor reverse anything.
  async function _backfillOne(box, channelId) {
    const m = _chatModel(box);
    const v = _viewFor(m, channelId);
    try {
      let res = null;
      try { res = await Chat.backfillRecent(CHAT_BACKFILL, channelId); } catch (e) { res = null; }
      const older = ((res && res.messages) || []).filter((x) => x && !x.failed);
      _bufFor(m, channelId).prependOlder(older);
    } finally {
      v.pending = false;
      v.backfilled = true;
      const buf = _bufFor(m, channelId);
      // THE LIVE LINE (ddjp_431): the newest stamp held once history has landed. A mention newer than this
      // is somebody speaking now and may chime; one at or below it is history and only badges.
      v.liveFrom = buf.ids().reduce((mx, k) => Math.max(mx, (buf.get(k) || {}).ts || 0), 0);
      const readable = buf.ids().filter((k) => { const x = buf.get(k); return x && !x.failed; });
      if (readable.length > CHAT_BACKFILL) {
        const k = readable[readable.length - CHAT_BACKFILL];
        v.anchor = { ts: buf.get(k).ts, key: k };
      } else {
        v.anchor = ALL_HELD;
      }
      if (channelId === m.activeId) _paint(box);
    }
  }
  // A tier that has not been backfilled yet — every tier at entry, and one that appears later (a
  // room upgrade, a presence join) when the resolution is next synced.
  function _backfillMissing(box, res) {
    const m = _chatModel(box);
    const jobs = [];
    for (const t of ((res && res.tiers) || [])) {
      if (!t || typeof t.id !== "string" || !t.id) continue;
      const v = _viewFor(m, t.id);
      if (v.backfilled || v.pending) continue;
      v.pending = true;
      jobs.push(_backfillOne(box, t.id));
    }
    return Promise.all(jobs);
  }

  // Start the room's chat: bind the box to the resolver's channel, draw the go-forward line, and
  // backfill every readable tier. Order-independent — it reads the resolution itself, so it no
  // longer depends on a caller having seeded the box's tier first (the H1 ordering hazard).
  async function startChat(box) {
    box = box || refs.chatBox;
    if (!box) return;
    const m = _chatModel(box);
    if (m.started) return;
    m.started = true;
    _ensureChatScrollWired(box);
    _armAudio();
    // CHAT COUNTS FROM JOINING (owner ruling, ddjp_441): last session's tier markers are dropped, so nothing old
    // lights a chat dot; DMs keep theirs (they carry over). The levels' "seen" marks start over with the room.
    try { ChatPrefs.tierClear(); } catch (e) {}
    _seenAt.social = 0; _seenAt.chat = 0;
    const r = _resolveTiers();
    m.activeId = r.activeId || null;
    // THE GO-FORWARD LINE: the newest SERVER stamp this client holds as the chat starts. The join
    // path awaits every channel's replay before the screen is entered, so history is already in and
    // none of it reads as new. `newestTs` is measured over everything held, not only narrated rows.
    let f = null;
    try { f = Room.recentEvents({ limit: 1 }); } catch (e) { f = null; }
    m.feedFromTs = (f && typeof f.newestTs === "number" && isFinite(f.newestTs)) ? f.newestTs : 0;
    m.feed = [];
    _paint(box);
    _renderChatTierStrip();
    await _backfillMissing(box, r);
  }

  // The resolution moved — the room's main chat changed, a tier appeared or went. A device following
  // the room follows it; one with an override stays (that is the resolver's rule, not this panel's).
  // A channel that is new since entry gets its backfill.
  function syncChatTier(box) {
    box = box || refs.chatBox;
    if (!box) return;
    const m = _chatModel(box);
    const r = _resolveTiers();
    m.activeId = r.activeId || null;
    if (m.started) _backfillMissing(box, r);
    _paint(box);
    _renderChatTierStrip();
  }

  // ────────────────────────────────────────────────────────────────────────────────────────

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    _onStarPress, _onVotePress, _starBtn, _voteBtn, _syncNpButtons,
    renderDMPanel, _dmResetToList, _openDMFromAction, _wireDMPanel, _renderDMBadge,
    _settingDisplayName, _renderChatTierStrip, removeChatMessage, _repaintChat,
    addChatMessage, startChat, renderChat, syncChatTier, _chatRow, _setChatNote,
    insertMention, _mentionInsert, previewChime, _resetDMChimeGap, _renderLevelDots,
  };
})();
