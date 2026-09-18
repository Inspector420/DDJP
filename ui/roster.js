// ui/roster.js
// JOIN/ROSTER/UPGRADE · RANK AND AVATAR · THE USER CARD — extracted from ui/interface.js at
// ddjp_391 as the fifth of the ten files roles.md §5 records.
//
// ── THIS CLUSTER CAME OUT OF THREE PLACES, AND ONE SPAN WAS LEFT WITH A HOLE ─────────────────
// `JOIN BUTTON, ROSTER, UPGRADE` runs unbroken from its banner to `CHAT`, and it holds THREE
// clusters' code. Roster proper and `THE USER CARD` came from the front of it; `renderRoster`
// through `runUpgrade` came from the BACK of it, stranded below where the event feed used to be;
// and between them sits `THE DM PANEL`, which is a CHAT surface and stayed for ui/chat.js.
// `RANK AND AVATAR` is contiguous and elsewhere entirely.
//
// **The banner is a reading aid; the cluster is an ownership unit** — and this is the worst case
// of that so far. Cutting the span would have taken the DM panel into the wrong file.
//
// ── THE SEAM WAS RE-MEASURED ON THE CORRECTED PARTS, NOT THE SPAN ───────────────────────────
// Measured on the banner span it read as 15 reach-backs and a HALT candidate (`rightTab`
// rebound on both sides). Measured on the parts that actually move: 13 and none — `rightTab`,
// `_chatRow`, `_setChatNote` and `_relockAllPanels` were all the DM panel's. Publishing the span's
// list would have been wrong in the direction that HIDES work: entries chat needs, and no signal
// about the ones roster does not.
//
// `_openDMFromAction` is the one call this file makes INTO the hole — the user card's action list
// opens a DM. It is published for now and becomes a direct ui/roster.js -> ui/chat.js call the day
// that cluster lands, which is the seam shrinking rather than the seam being wrong.
//
// Depends on: UIBase, Interface (via UIBase.host), Room, Ranks, Capabilities, Actions, Chat

const Roster = (() => {

  const { refs } = UIBase;
  const H = UIBase.host;

  // --- state this cluster owns, moved out of MODULE STATE with it ------------
  let _joinResizeWired = false;   // one-time window-resize hook for the Join/Leave text-ladder

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ RANK AND AVATAR
  //
  // Own rank display and avatar upload.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- My rank + own avatar (live) ---
  function renderMyRank() {
    const myId = Room.getMyId() || "";
    H.headerFit().fullId = myId;                       // remember the full @user:server for the shrinker
    if (refs.myIdBadge) refs.myIdBadge.textContent = myId;
    if (refs.rankBadge) {
      // ── THE HEADER NAMES WHO I AM, SO IT ASKS THE AUTHORITY LEVEL ────────────────────────
      // `Room.getMyRank()` answers the highest events CHANNEL I can write to, which caps at the
      // ladder's top rung — so a human owner at Matrix level 100 answers 99 from it, exactly as the
      // bot does. With the top rung correctly labelled `Bot`, that made the header call the HUMAN
      // OWNER "Bot", and made the two accounts indistinguishable in the one place a person looks to
      // see who they are signed in as.
      //
      // THIRD PLACE THIS CONFUSION HAS SURFACED — after the upgrade gate and the rank dropdown. The
      // rule that covers all three: a reading that must separate the owner from the bot asks
      // `getMyAuthorityLevel`; a reading about what I may AUTHOR asks `getMyRank`. This is the
      // first kind.
      H.headerFit().fullRank = H.rankName(
        (Room.getMyAuthorityLevel ? Room.getMyAuthorityLevel() : Room.getMyRank()));
      refs.rankBadge.textContent = H.headerFit().fullRank;
    }
    H._fitHeader();                                   // re-apply responsive shrink after text changes
    if (refs.myAvatarSlot && myId) {
      const av = H.avatarEl(myId, 28);
      av.style.cursor = "pointer";
      av.title = "Click to change your picture";
      av.onclick = _pickAvatarFile;
      refs.myAvatarSlot.replaceChildren(av);
    }
  }

  // --- Avatar upload (own picture) ---
  // Clicking your own avatar (top-right) opens a device file picker. The chosen
  // image is validated + uploaded by Media.uploadAvatar, which sets it as
  // your global Matrix avatar. We show a brief uploading/updated/error note in
  // the header (refs.avatarNote) and let onAvatarChange swap the picture in.
  let _avatarUploading = false;
  function _pickAvatarFile() {
    if (_avatarUploading) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (file) _doAvatarUpload(file);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  }

  function _setAvatarNote(text, isError) {
    if (!refs.avatarNote) return;
    refs.avatarNote.textContent = text || "";
    refs.avatarNote.style.color = isError ? "#ff6b6b" : "#888";
  }

  async function _doAvatarUpload(file) {
    if (!Media.uploadAvatar) return;
    _avatarUploading = true;
    _setAvatarNote("Uploading…", false);
    try {
      const r = await Media.uploadAvatar(file);
      if (r && r.ok) {
        _setAvatarNote("Updated", false);
        setTimeout(() => _setAvatarNote("", false), 2500);
      } else {
        _setAvatarNote((r && r.reason) || "Upload failed", true);
        setTimeout(() => _setAvatarNote("", false), 5000);
      }
    } catch (e) {
      Logger.warn("Avatar upload: " + (e && e.message));
      _setAvatarNote("Upload failed — try again", true);
      setTimeout(() => _setAvatarNote("", false), 5000);
    } finally {
      _avatarUploading = false;
    }
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ JOIN BUTTON, ROSTER, UPGRADE
  //
  // The responsive Join text-ladder, the people list, rank assignment and the batch upgrade.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // Longest→shortest label ladders for the Join/Leave button. _fitJoinLabel steps
  // down until the player-control row stops overflowing, so the button yields
  // horizontal space and never wraps to a second line (fixed height). Full label
  // stays as the tooltip. Re-run on render, layout change, and window resize.
  const _JOIN_LADDER  = ["Join the DJ queue", "Join DJ queue", "Join queue", "Join", "JQ"];
  const _LEAVE_LADDER = ["Leave the DJ queue", "Leave DJ queue", "Leave queue", "Leave", "LQ"];
  function _fitJoinLabel(active) {
    const btn = refs.joinBtn;
    if (!btn) return;
    const ladder = active ? _LEAVE_LADDER : _JOIN_LADDER;
    btn.title = ladder[0];
    const row = btn.closest ? btn.closest(".playback-controls") : null;
    for (let i = 0; i < ladder.length; i++) {
      btn.textContent = ladder[i];
      if (i === ladder.length - 1) break;                 // shortest is the floor
      if (!row) break;                                    // not mounted yet — keep longest
      if (row.scrollWidth <= row.clientWidth + 1) break;  // fits without overflowing the row
    }
    if (!_joinResizeWired) {
      _joinResizeWired = true;
      let _rt;
      window.addEventListener("resize", () => {
        clearTimeout(_rt);
        _rt = setTimeout(() => { if (refs.joinBtn) _fitJoinLabel(UserQueue.isActive()); }, 120);
      });
    }
  }

  function renderJoinBtn() {
    if (!refs.joinBtn) return;
    const active = UserQueue.isActive();
    const stackLeft = UserQueue.stackCount ? UserQueue.stackCount() : 0;

    refs.joinBtn.classList.remove("active", "dropped", "refilling");

    // The Join/Leave label shortens under horizontal pressure instead of stacking or
    // growing the row — see _fitJoinLabel (a longest→shortest ladder that steps down
    // until the player-control row stops overflowing). Fixed height; full text stays
    // as the tooltip.
    if (active) {
      // In the rotation, or actively (re)joining — auto-feed is on.
      refs.joinBtn.classList.add("active");
      refs.joinBtn.disabled = false;
    } else {
      // Not in the rotation — whether we never joined or just ran out.
      // Joining with nothing to play would put us in as an invisible member that
      // never rotates, so require at least one queued song before Join is live.
      refs.joinBtn.disabled = stackLeft === 0;
    }
    _fitJoinLabel(active);

    // The leave-lock is shown ONLY in Leave mode. It starts LOCKED each time it
    // newly appears (a Join→Leave transition); while it stays visible across
    // re-renders, an in-progress unlock window is preserved (don't disturb it).
    if (refs.leaveLockBtn) {
      const wasShown = refs.leaveLockBtn.style.display !== "none";
      if (active) {
        if (!wasShown) H._relock("leave");          // newly appearing → locked, bar reset
        refs.leaveLockBtn.style.display = "";
      } else {
        refs.leaveLockBtn.style.display = "none";
        H._relock("leave");                          // hidden → cancel any window, back to locked
      }
      H._renderLeaveLock();
    }
  }

  // ---------------------------------------------------------------------------
  // THE USER CARD (J14)
  // ---------------------------------------------------------------------------
  // Click a person anywhere they appear — chat, the people list, the room queue —
  // and get their profile plus every action you are permitted against them. This is
  // the CONTAINER J15 (the DM panel) and J16 (who-is-here) plug into, which is why
  // it is built before either.
  //
  // ── THE CARD DECIDES NOTHING, AND THE LIST IS WHY ────────────────────────────
  // Every control comes out of one declared table, `_CARD_ACTIONS`, and each row is
  // rendered from whatever `Actions.describe` says about it — enabled, reason, and
  // nothing else. There is no rank comparison here, no `Capabilities` call, and no
  // per-control branch that could quietly become a rule. Adding a moderation action
  // means adding a row to that table and a gate to `Ranks.GATES`; it does not mean
  // editing this function.
  //
  // ── THE DM SLOT IS DECLARED AND NOT YET BUILT, DELIBERATELY ──────────────────
  // J14's entry lists "open a DM" among the card's actions and names J15 as the job
  // that builds the panel. A button wired to a feature that does not exist is the
  // "prose describing code nobody wrote" failure (`08-build-and-deploy.md`
  // §Deciding what is dead), and a permanently dead control teaches people to ignore
  // the card. So the row EXISTS in the table and renders only when the adapter knows
  // the action: `_cardActions()` filters against `Actions.ACTIONS`. J15 adds one
  // catalog entry and the control appears with NO change to this file — which is the
  // whole claim of "the container J15 plugs into", made checkable rather than
  // asserted. `check-user-card` PART E drives it both ways.
  //
  // ── A REMOVAL IS NOT A ROTATION REMOVAL ──────────────────────────────────────
  // `dj.remove` (already on the room-queue rows) drops somebody from the DJ ROTATION
  // and is a Spine event every client folds. `member.kick` removes them from the
  // MATRIX ROOMS and no reducer ever sees it. Two different acts, adjacent on this
  // card, and the labels have to keep them apart — see `roles.md` §6.
  const _CARD_ACTIONS = [
    { action: "member.kick", label: "Remove from room",
      confirm: (m) => "Remove " + m.name + " from this room?",
      note: "They are removed from all of this room's channels now. It does not keep them out.",
      danger: false },
    { action: "member.ban", label: "Ban",
      confirm: (m) => "Ban " + m.name + " from this room?",
      note: "They are removed and cannot come back unless the ban is lifted.",
      danger: true },
    // J15 filled this slot with one catalog entry, exactly as J14 said it would — the
    // `action`/`label`/`confirm`/`note`/`danger` shape above needed no change. `closeOnRun`
    // is the ONE field J15 added, and it is here rather than in the adapter because it is
    // presentation: a DM opens a panel BEHIND this overlay, so a card that stayed up would
    // cover the thing the click just opened. The moderation rows do not take it — their
    // result is a verdict the person has to read.
    { action: "chat.dm", label: "Message",
      confirm: null, note: null, danger: false, closeOnRun: true },
  ];

  // Only rows the adapter actually knows. An action the adapter has never heard of
  // would describe as "Unknown action" and render a control that can never work.
  function _cardActions() {
    const known = (typeof Actions !== "undefined" && Actions.ACTIONS) ? Actions.ACTIONS : [];
    return _CARD_ACTIONS.filter((row) => known.indexOf(row.action) >= 0);
  }

  let _userCard = null;
  function _closeUserCard() {
    if (_userCard) { try { _userCard.remove(); } catch (e) {} _userCard = null; }
  }

  // ONE trigger, used by every surface a person appears in — the roster, a chat
  // sender, the now-playing DJ, a queue row's DJ. Written once because the affordance
  // has to be identical everywhere ("click a person ANYWHERE they appear"), and four
  // hand-wired copies is four places for the keyboard path to be forgotten in three
  // of them. `level` is optional: the roster carries one, the other surfaces resolve
  // it from the roster, and 0 is the fallback for somebody not in it yet.
  function _wireCardTrigger(node, userId, level) {
    if (!node || !userId) return node;
    const lvl = (typeof level === "number") ? level : H._rosterLevel(userId);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.classList.add("uc-trigger");
    node.onclick = () => openUserCard({ userId: userId, name: H.shortName(userId), level: lvl });
    node.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); node.onclick(); }
    };
    return node;
  }

  // Mount point, split out so the guard can drive `openUserCard` without a document.
  function _cardMount(node) {
    _closeUserCard();
    _userCard = node;
    document.body.appendChild(node);
  }

  function openUserCard(member) {
    if (!member || !member.userId) return;
    const m = {
      userId: member.userId,
      name: member.name || H.shortName(member.userId),
      level: typeof member.level === "number" ? member.level : 0,
    };

    const result = H.el("div", { class: "uc-note muted" });

    // --- head: avatar, name, rank. Display uses of rank only — a name and a colour
    // decide nothing, which is the line `check-ui-no-permission` draws.
    const nameEl = H.el("span", { class: "uc-name", text: m.name });
    nameEl.style.color = H.rankColor(m.level);
    const head = H.el("div", { class: "uc-head" }, [
      H.avatarEl(m.userId, 40),
      H.el("div", { class: "uc-id" }, [
        nameEl,
        H.el("span", { class: "rank-tag", text: H.rankName(m.level) }),
      ]),
    ]);

    const body = H.el("div", { class: "uc-body" });

    // --- rank change. The control the tree already had; it keeps its own shape
    // (a select of grantable levels) because WHICH levels may be granted is a
    // second question the descriptor answers per-level.
    if (Actions.describe("rank.assign", { userId: m.userId, targetRank: m.level }).enabled) {
      const row = H.el("div", { class: "uc-row" }, [H.el("span", { class: "uc-label", text: "Rank" })]);
      row.appendChild(rankSelect(m.level, async (lvl) => {
        try { await Actions.perform("rank.assign", { userId: m.userId, targetRank: m.level, newLevel: lvl }); }
        catch (e) { result.textContent = e.message || "Couldn't change that rank."; }
      }));
      body.appendChild(row);
    }

    // --- the moderation and messaging actions, every one of them rendered from its
    // descriptor. A denied action is shown DISABLED with the backend's own reason as
    // the tooltip rather than hidden, so somebody who cannot act can see why — the
    // hide-vs-disable choice is presentation and stays here (`10-capabilities.md`).
    for (const spec of _cardActions()) {
      const d = Actions.describe(spec.action, { userId: m.userId, targetRank: m.level });
      const btn = H.el("button", {
        class: "uc-action" + (spec.danger ? " uc-danger" : ""),
        text: d.label || spec.label,
      });
      btn.dataset.action = spec.action;
      btn.disabled = !d.enabled;
      if (!d.enabled && d.reason) btn.title = d.reason;
      if (d.enabled) {
        btn.onclick = () => _runCardAction(spec, m, btn, result);
      }
      body.appendChild(btn);
    }

    const close = H.el("button", { class: "mini", text: "Close", onclick: _closeUserCard });
    const card = H.el("div", { class: "uc-card" }, [head, body, result, H.el("div", { class: "uc-foot" }, [close])]);
    const overlay = H.el("div", { class: "uc-overlay" }, [card]);
    overlay.onclick = (e) => { if (e.target === overlay) _closeUserCard(); };
    _cardMount(overlay);
  }

  // Two-step for anything with a confirm string. The 5s misclick locks elsewhere in
  // this file are a timer; this is a deliberate second click, because a removal has
  // no undo the way a mis-struck song does.
  //
  // AND THE RESULT IS REPORTED AS THE BACKEND STATES IT. `Room.ban`/`Room.kick`
  // return a verdict across the room set, and a PARTIAL is the case J14's entry says
  // will bite on day one — twenty rooms closed and one open is not a success, so this
  // never prints one. The count comes out of the verdict rather than being assumed
  // from the absence of a throw.
  function _runCardAction(spec, m, btn, result) {
    if (spec.confirm && btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.textContent = "Confirm";
      btn.title = spec.confirm(m);
      result.textContent = spec.note || "";
      setTimeout(() => {
        if (btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = spec.label; btn.title = ""; }
      }, 5000);
      return;
    }
    btn.dataset.armed = "";
    btn.disabled = true;
    btn.textContent = "Working…";
    Actions.perform(spec.action, { userId: m.userId, targetRank: m.level })
      .then((res) => {
        // An action that opens a surface of its own closes the card instead of reporting into
        // it. Checked BEFORE the verdict branch below, because that branch's wording is about a
        // room set — "N of M channels done" is a true sentence about a ban and a false narrative
        // about anything else, which is `roles.md` §10's second signature. An action whose result
        // is not a room-set verdict must not reach it.
        if (spec.closeOnRun) {
          _closeUserCard();
          // ── AND FOR `chat.dm`, GO WHERE IT OPENED ─────────────────────────────────────────
          // "Opens a surface of its own" was doing half the job: `Chat.openDM` creates or finds
          // the room and returns its id, the card closed, and **nothing moved** — the person was
          // left looking at the panel they started on with a conversation waiting somewhere they
          // could not see it. The action's job is the ROOM; landing in it is the panel's.
          //
          // Driven off the RETURNED room id rather than the action name plus a lookup: a second
          // `findDMRoom` here could disagree with the one the action just used.
          if (spec.action === "chat.dm" && res && res.ok !== false && res.roomId) {
            ChatPanels._openDMFromAction(res.roomId);
          }
          return;
        }
        if (res && res.ok === false) {
          const open = (res.failed || []).concat(res.unverified || []).length;
          result.textContent = "Not finished: " + (res.closed || 0) + " of " + (res.total || 0) +
            " channels done, " + open + " still open. Try again — repeating it is safe.";
          btn.disabled = false; btn.textContent = spec.label;
          return;
        }
        if (res && res.reentry === "open") {
          result.textContent = "Removed. This room is public, so they can come back in.";
        } else {
          result.textContent = "Done.";
        }
        btn.textContent = spec.label;
      })
      .catch((e) => {
        result.textContent = (e && e.message) || "That didn't work.";
        btn.disabled = false; btn.textContent = spec.label;
      });
  }


  function renderRoster() {
    if (!refs.rosterBox) return;
    H.clear(refs.rosterBox);
    const roster = Room.getRoster();
    if (!roster || roster.length === 0) {
      refs.rosterBox.appendChild(H.el("p", { class: "muted", text: "Just you so far" }));
      return;
    }
    roster.forEach(member => {
      const nameEl = H.el("span", { class: "who", text: member.name || H.shortName(member.userId) });
      nameEl.style.color = H.rankColor(member.level);
      // The name is the card trigger (J14) — same affordance in every surface a
      // person appears in, through the one helper so the keyboard path cannot be
      // remembered in three places and forgotten in the fourth.
      _wireCardTrigger(nameEl, member.userId, member.level);
      const row = H.el("div", { class: "person" }, [
        nameEl,
        H.el("span", { class: "rank-tag", text: H.rankName(member.level) })
      ]);
      // Staff+ may set ranks strictly below their own, for people below them —
      // and only ranks the room has actually unlocked channels for. The rank rule
      // (Staff+, target strictly below me — which also excludes myself) now comes
      // from the capability system; rankSelect still filters WHICH levels appear.
      if (Actions.describe("rank.assign", { targetRank: member.level }).enabled) {
        row.appendChild(rankSelect(member.level, async (lvl) => {
          // THROUGH THE ADAPTER (J31), and the SAME target shape the user card already sends.
          // The line above already asked `Actions.describe` for the rule; dispatching past it left
          // one act with two routes to the wire — the split `_commitSetting` had. `perform`
          // re-checks with `newLevel` included, which `rankSelect` has already filtered for, so
          // this is defence in depth rather than a new refusal.
          try { await Actions.perform("rank.assign", { userId: member.userId, targetRank: member.level, newLevel: lvl }); }
          catch (e) { Logger.warn("assignRank: " + e.message); }
        }));
      }
      refs.rosterBox.appendChild(row);
    });
  }

  function rankSelect(currentLevel, onPick) {
    const sel = H.el("select", { class: "rank-select" });
    const channels = Room.getChannels();
    H.RANKS().forEach(r => {
      // Which levels I may GRANT is the capability's call (rank strictly below mine);
      // isRankUnlocked is a structural fact (the room has that rank's channel yet).
      if (!Actions.describe("rank.assign", { targetRank: currentLevel, newLevel: r.level }).enabled) return;
      if (!Room.isRankUnlocked(channels, r.level)) return;     // room hasn't created this rank's channels yet
      // THE OPTION SAYS WHAT PICKING IT DOES. On a person's card the top rung reads "Bot"; here it
      // has to be a verb-ish phrase, because a dropdown of nouns reads as "set them to this" and
      // the consequence — this account becomes the room's bot, with one bot per room — is not
      // something a noun conveys.
      const label = (r.level === H.BOT_LEVEL()) ? "Bot (appoint as room bot)" : r.name;
      const opt = H.el("option", { value: String(r.level), text: label });
      if (r.level === currentLevel) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => onPick(parseInt(sel.value, 10));
    return sel;
  }

  // ---------------------------------------------------------------------------
  // OWNER upgrade control (lives in the header, top-left by the room name)
  // ---------------------------------------------------------------------------
  function renderUpgradePanel() {
    const slot = refs.upgradeSlot;
    if (!slot) return;
    // While an upgrade is actively running, runUpgrade() owns this slot and is
    // updating a live progress bar inside it. renderUpgradePanel is ALSO wired to
    // fire on events that occur DURING an upgrade: the start/done markers
    // (RoomUpgrade.onStatusChange) and the m.room.power_levels state event emitted
    // by every freshly-created channel (Room.onRankChange). Each such call would
    // clear the slot and repaint the "Resume unlock" button on top of the bar —
    // so the bar shows correctly at first, then gets clobbered the instant the
    // first of those events lands (the reported "displays well, then offers to
    // upgrade instead of showing progress"). Defer to the running upgrade and
    // leave its bar alone; runUpgrade() repaints this panel itself once it
    // finishes, so the normal button/cooldown view is restored then.
    if (RoomUpgrade.isRunning && RoomUpgrade.isRunning()) return;
    H.clearCountdown("upgrade-cooldown");   // drop any prior countdown before rebuilding
    H.clear(slot);
    // Owner-only panel. Ask the capability with retryAt:0 so the cooldown branch is
    // bypassed — this yields pure ownership; the panel's own status()/countdown below
    // still shows the cooldown to owners.
    if (!Actions.describe("room.upgrade", { retryAt: 0 }).enabled) return;   // owner-only
    let st;
    try { st = RoomUpgrade.status(); } catch (e) { return; }
    if (!st) return;

    if (st.currentBatch >= st.maxBatch) {
      slot.appendChild(H.el("span", { class: "upgrade-note", text: "All ranks unlocked" }));
      return;
    }
    if (st.canUpgradeNow) {
      const label = st.inProgress ? "Resume (" + st.currentBatch + "/" + st.maxBatch + ")"
                                  : "Upgrade (" + st.currentBatch + "/" + st.maxBatch + ")";
      const btn = H.el("button", { class: "upgrade-btn", text: label });
      btn.onclick = () => runUpgrade();
      slot.appendChild(btn);
    } else if (st.nextAvailableAt) {
      const note = H.el("span", { class: "upgrade-note" });
      slot.appendChild(note);
      H.startCountdown("upgrade-cooldown", note, st.nextAvailableAt,
        "Next unlock in ", "",
        () => renderUpgradePanel());   // cooldown hit zero — re-render to show the button
    } else {
      H.clearCountdown("upgrade-cooldown");
    }
    // (status-change re-render is wired once in enterMainScreen)
  }

  async function runUpgrade() {
    const slot = refs.upgradeSlot;
    if (!slot) return;
    if (RoomUpgrade.isRunning && RoomUpgrade.isRunning()) {
      Logger.warn("upgrade: already running — ignoring repeat trigger");
      return;
    }
    H.clear(slot);
    const fill = H.el("div", { class: "upgrade-bar-fill" });
    const lbl = H.el("span", { class: "upgrade-bar-label", text: "Starting…" });
    slot.appendChild(H.el("div", { class: "upgrade-bar" }, [H.el("div", { class: "upgrade-bar-track" }, [fill]), lbl]));
    let ok = true;
    try {
      await Actions.perform("room.upgrade", { onProgress: (completed, total, label, waitUntil) => {
        if (completed == null) {
          if (waitUntil) {
            H.startCountdown("upgrade-ratelimit", lbl, waitUntil, label || "Retrying in ", "");
          } else {
            H.clearCountdown("upgrade-ratelimit");
            lbl.textContent = label || "Waiting…";
          }
          return;
        }
        H.clearCountdown("upgrade-ratelimit");
        fill.style.width = Math.round((completed / total) * 100) + "%";
        lbl.textContent = label + " (" + completed + "/" + total + ")";
      } });
    } catch (e) {
      ok = false;
      Logger.warn("upgrade: " + e.message);
    }
    H.clearCountdown("upgrade-ratelimit");
    // On success, hold a brief "Done" state (mirrors room creation) so the done
    // marker has time to round-trip and be recorded before we repaint. Without
    // it, renderUpgradePanel can fire in the gap between the batch finishing and
    // the done event being ingested — when status still shows start-without-done
    // — and flash the stale "Resume unlock" button for a moment. On failure the
    // batch is resumable, so repaint immediately to bring the Resume button back.
    if (ok) {
      fill.style.width = "100%";
      lbl.textContent = "Done";
      await new Promise(r => setTimeout(r, H.UPGRADE_DONE_PAUSE_MS()));
    }
    renderUpgradePanel();
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    renderMyRank, renderJoinBtn, _wireCardTrigger, renderRoster, renderUpgradePanel,
    openUserCard, rankSelect,
  };
})();
