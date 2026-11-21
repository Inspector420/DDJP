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
// `_openDMFromAction` and `insertMention` are this file's calls INTO the hole — the user card's
// action list opens a DM or fills the chat box. Both are direct `ChatPanels` calls now that
// ui/chat.js has landed.
//
// Depends on: UIBase (and its `host` seam), ChatPanels, Room, Actions, UserQueue, Media,
// RoomUpgrade, Rep, ServerClock, Panels, Logger. No backend global: this line used to name `Ranks` and `Capabilities`, which
// the file has never touched — a header claiming the UI reaches the backend, in the one layer
// `check-boundaries` rule D forbids it to.

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

  // --- Your own avatar, and the header's fit (live) ---
  // THE RANK LEFT THE TOP BAR FOR YOUR PICTURE'S MENU (`ddjp_702`, the owner's: "do you think we should change  the rank to be in
  // the card instead of the top bar", then "i think i should be like A but on its own row above or below", "i like under"): the
  // menu's pill under your ID says it (`_rankPill`), asked of the same authority level the top bar's pill asked (below). The top
  // bar keeps ← · the room's name on the left and your picture on the right.
  function renderMyRank() {
    const myId = Room.getMyId() || "";
    H.headerFit().fullId = myId;                       // remember the full @user:server for the shrinker
    if (refs.myIdBadge) refs.myIdBadge.textContent = myId;
    H._fitHeader();                                   // re-apply responsive shrink after text changes
    if (refs.myAvatarSlot && myId) {
      refs.myAvatarSlot.replaceChildren(H.avatarEl(myId, 28));
      // your picture: its ring and its menu (`ddjp_697`); in a room My Rank is in it, the layout tiles (`ddjp_699`), and your rank's
      // pill and the room's own segment (`ddjp_702`)
      ownPicture(refs.myAvatarSlot, { rank: true, layouts: true, room: true });
    }
    _drawMenuRank();                                   // an open menu's pill follows a rank change
  }

  // ── YOUR PICTURE: ITS RING AND ITS MENU (the owner's plan, part 3, `ddjp_697`; `main/05-matrix.md` §Slow-downs you can see) ──
  // Your own picture — in a room's header and on the room list's — carries ONE ring: green, all well; orange, any line not OK
  // (Matrix Offline included); red, My Rank out of spec (red is only that, his correction); half red, half orange on the
  // diagonal, both. Clicking it opens the menu: your picture, a button that changes it (a small ✎ on it; the file picker below);
  // your name and id, and at the top row's right edge a small ⧉ that copies your Matrix ID (`ddjp_699`); then the lines, label
  // left, state right in its colour; and in a room, under a divider, the three layout tiles (`ddjp_699`, below). It closes on a
  // click outside or Escape; no other text. EVERYTHING ITS LINES SAY IS READ FROM `MatrixStatus` — the ring's colour, the lines,
  // their words — and nothing is decided here. Everyone else's picture is as it was (`H.rankRing`, red only for a rank out of spec).
  const OWN_RINGS = ["green", "orange", "red", "both"];
  const _ownSlots = [];          // { slot, rank } — each place your picture is drawn
  let _ownWired = false;
  let _menu = null;              // the open menu: { el, lines, rec }
  function ownPicture(slot, opts) {
    if (!slot || !slot.classList) return slot;
    const rank = !(opts && opts.rank === false);
    const layouts = !!(opts && opts.layouts === true);   // the layout tiles: inside a room only (`ddjp_699`)
    const room = !!(opts && opts.room === true);         // your rank's pill and the room's segment: inside a room only (`ddjp_702`)
    let rec = null;
    for (const r of _ownSlots) if (r.slot === slot) rec = r;
    if (!rec) { rec = { slot: slot, rank: rank, layouts: layouts, room: room }; _ownSlots.push(rec); } else { rec.rank = rank; rec.layouts = layouts; rec.room = room; }
    slot.classList.add("st-ring");
    slot.classList.remove("rank-off");
    slot.setAttribute("role", "button");
    slot.setAttribute("tabindex", "0");
    slot.setAttribute("aria-label", "Your picture");
    slot.onclick = () => { if (_menu && _menu.rec === rec) _closeMenu(); else _openMenu(rec); };
    slot.onkeydown = (e) => { if (e && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); slot.onclick(); } };
    _paintOwn(rec);
    _wireOwn();
    return slot;
  }
  function _ownState(rec) {
    try { return MatrixStatus.state({ rank: rec ? rec.rank : true }); } catch (e) { return { lines: [], ring: "green", chat: null }; }
  }
  function _paintOwn(rec) {
    const ring = _ownState(rec).ring;
    for (const r of OWN_RINGS) { if (r === ring) rec.slot.classList.add("st-" + r); else rec.slot.classList.remove("st-" + r); }
    try { rec.slot.dataset.ring = ring; } catch (e) {}
  }
  function _wireOwn() {
    if (_ownWired || typeof MatrixStatus === "undefined" || !MatrixStatus.onChange) return;
    _ownWired = true;
    let waitSig = "";
    MatrixStatus.onChange(() => {
      for (const r of _ownSlots) _paintOwn(r);
      _drawMenuLines();
      _drawMenuRank();   // a rank change tells the status piece too: the pill follows it
      // A running rank change's line says its wait (`ddjp_697`): redrawn only when a countdown it could show has moved.
      const sig = H.slowWaitSig ? H.slowWaitSig() : "";
      if (sig !== waitSig) { waitSig = sig; if (_rankRunningNow() && typeof _cardRank.note === "function") { try { _cardRank.note(); } catch (e) {} } }
    });
    if (typeof document !== "undefined" && document.addEventListener) {
      document.addEventListener("pointerdown", (e) => {
        if (!_menu) return;
        const t = e && e.target;
        if (t && ((_menu.el.contains && _menu.el.contains(t)) || (_menu.rec.slot.contains && _menu.rec.slot.contains(t)))) return;
        _closeMenu();
      }, true);
      document.addEventListener("keydown", (e) => {
        if (!_menu || !e || e.key !== "Escape") return;
        const slot = _menu.rec.slot;
        _closeMenu();
        try { slot.focus(); } catch (x) {}
      });
    }
  }
  // THE MENU, TOP TO BOTTOM (`ddjp_702`; the owner approved the pictures — his words in `main/05-matrix.md` §Slow-downs you can see):
  //   1. YOUR ROW — your picture (the ✎ button, as before); three lines: your name, your ID, then, inside a room, your rank as a
  //      pill on its own line (`_rankPill`); the ⧉ that copies your ID at the right edge.
  //   2. INSIDE A ROOM, THE ROOM'S SEGMENT, NO LABEL — its name in your name's size and weight, its ID under it in your ID's grey,
  //      its ⧉ (copy the room's ID; it left the top bar for here, his "maybe put the room Id in its own segment betwhen the user
  //      and matrix statuses") on the same right edge as yours. Both rows borrow one rule (`.st-head`), and the room's lines your
  //      own lines' classes, so the two rows cannot drift apart; a long name or ID ends in "…".
  //   3. THE STATUS LINES (`MatrixStatus`, its one table's order and words).
  //   4. THE LAYOUT TILES, inside a room (`ddjp_699`).
  // On the room list: your row without the pill, no room segment, no My Rank — as before.
  function _openMenu(rec) {
    _closeMenu();
    const myId = Room.getMyId() || "";
    const pic = H.el("button", { class: "st-pic", type: "button", "aria-label": "Change your picture" },
                     [H.avatarEl(myId, 48), H.el("span", { class: "st-pic-edit", "aria-hidden": "true", text: "\u270E" })]);
    pic.onclick = () => { _closeMenu(); _pickAvatarFile(); };
    const rank = rec.room ? H.el("div", { class: "st-rank-line" }) : null;
    const who = H.el("div", { class: "st-who" }, [H.el("div", { class: "st-name", text: H.shortName(myId) }), H.el("div", { class: "st-id", text: myId }), rank]);
    // COPY YOUR ID, AT THE TOP ROW'S RIGHT EDGE (`ddjp_699`, the owner's: "a small button to the right of the name at the edge of
    // the right side"): the app's copy button, its usual look and its ✓ when copied; it took the top bar's place for this.
    const copy = H.copyButton("⧉", () => Room.getMyId() || "", "copy-btn icon-only st-copy", "Copy my Matrix ID");
    const parts = [H.el("div", { class: "st-head" }, [pic, who, copy])];
    const seg = rec.room ? _roomSegment() : null;
    if (seg) parts.push(seg);
    const lines = H.el("div", { class: "st-lines" });
    parts.push(lines);
    const el = H.el("div", { class: "st-menu", role: "dialog", "aria-label": "You and Matrix" }, parts);
    _menu = { el: el, lines: lines, rank: rank, rec: rec, stick: null, tiles: null };
    if (rec.layouts) el.appendChild(_menu.tiles = H.el("div", { class: "st-lays", role: "group", "aria-label": "Layout" }));
    _drawMenuRank();
    _drawMenuLines();
    _drawLayoutTiles();
    document.body.appendChild(el);
    // UNDER YOUR PICTURE, ITS RIGHT EDGE WITH THE PICTURE'S, 8 PX INSIDE THE WINDOW — AND KEPT THERE as the window or the header
    // changes, by the one shared way every top-bar menu uses (`H.stickToButton`, `ddjp_698`; it stayed where it opened at 697).
    _menu.stick = H.stickToButton(el, rec.slot);
  }
  // THE ROOM'S SEGMENT: the open room's name and ID and their ⧉, or nothing when no room is open.
  function _roomSegment() {
    let cur = null;
    try { cur = Room.getCurrent ? Room.getCurrent() : null; } catch (e) { cur = null; }
    if (!cur || !cur.spaceId) return null;
    const copy = H.copyButton("⧉", () => cur.spaceId || "", "copy-btn icon-only st-copy st-room-copy", "Copy room ID");
    return H.el("div", { class: "st-head st-room" }, [
      H.el("div", { class: "st-who" }, [H.el("div", { class: "st-name", text: cur.name || cur.spaceId }), H.el("div", { class: "st-id", text: cur.spaceId })]),
      copy,
    ]);
  }
  // YOUR RANK AS A PILL (`ddjp_702`; the owner's "i like under, but maybe change the color for the rank color in chat"): the rank's
  // name (`H.rankName`) in its chat colour (`H.rankColor`) — the word in that colour, a soft fill of it, a thin border of it — asked
  // of `Room.getMyAuthorityLevel`, as the top bar's pill asked: a reading that must tell the human owner from the bot (both at the
  // ladder's top for authoring). VIP and Staff keep their chat colours (the supervisor's default).
  const RANK_FILL = 0.16, RANK_EDGE = 0.55;
  function _tint(hex, a) {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ""));
    return m ? "rgba(" + parseInt(m[1], 16) + ", " + parseInt(m[2], 16) + ", " + parseInt(m[3], 16) + ", " + a + ")" : "transparent";
  }
  function _rankPill() {
    let level = 0;
    try { level = Room.getMyAuthorityLevel ? Room.getMyAuthorityLevel() : Room.getMyRank(); } catch (e) { level = 0; }
    const color = H.rankColor(level);
    const pill = H.el("span", { class: "st-rank", text: H.rankName(level) });
    pill.style.color = color;
    pill.style.background = _tint(color, RANK_FILL);
    pill.style.borderColor = _tint(color, RANK_EDGE);
    return pill;
  }
  function _drawMenuRank() {
    if (!_menu || !_menu.rank) return;
    _menu.rank.replaceChildren(_rankPill());
  }
  function _drawMenuLines() {
    if (!_menu) return;
    const rows = _ownState(_menu.rec).lines.map((l) => H.el("div", { class: "st-line", "data-kind": l.key }, [
      H.el("span", { class: "st-label", text: l.label }),
      H.el("span", { class: "st-state st-" + l.tone, text: l.text }),
    ]));
    _menu.lines.replaceChildren.apply(_menu.lines, rows);
  }
  // ── THE LAYOUT TILES, AT THE MENU'S FOOT, INSIDE A ROOM (`ddjp_699`; the owner's: "we can also remove the layout button and also
  // put it there in where we have 3 squares per layout or rectagle offering the layout but it must look good asa whole") ──────
  // Under a divider, one tile per layout of the shell's one table (`H.layouts()`: Wide, Compact, Phone), spaced evenly across
  // the menu: each a small drawing of that layout — a screen holding its columns, three, two, or one in a phone's upright
  // frame — with its word under it. The one in use is blue; clicking one switches to it with today's switch (`H._setLayout`,
  // remembered on this device) and closes the menu, as ⊞'s menu closed on a pick.
  function _drawLayoutTiles() {
    if (!_menu || !_menu.tiles) return;
    let list = [], on = null;
    try { list = H.layouts ? H.layouts() : []; on = H.layoutMode ? H.layoutMode() : null; } catch (e) { list = []; }
    const tiles = list.map((l) => {
      const cols = [];
      for (let i = 0; i < (l.cols || 1); i++) cols.push(H.el("span", { class: "st-lay-col" }));
      const t = H.el("button", { class: "st-lay" + (l.id === on ? " on" : ""), type: "button", title: l.hint || l.label, "aria-pressed": l.id === on ? "true" : "false", "data-layout": l.id },
        [H.el("span", { class: "st-lay-pic" + (l.id === "phone" ? " st-lay-phone" : "") }, cols), H.el("span", { class: "st-lay-word", text: l.label })]);
      t.onclick = (e) => { if (e && e.stopPropagation) e.stopPropagation(); try { H._setLayout(l.id); } catch (x) {} _closeMenu(); };
      return t;
    });
    _menu.tiles.replaceChildren.apply(_menu.tiles, tiles);
  }
  function _closeMenu() {
    if (!_menu) return;
    if (_menu.stick) _menu.stick.stop();
    try { _menu.el.remove(); } catch (e) {}
    _menu = null;
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
    // The room list's header has the same note beside your picture there (`ddjp_697`).
    const notes = [refs.avatarNote, (typeof document !== "undefined" && document.getElementById) ? document.getElementById("rooms-avatar-note") : null];
    for (const n of notes) {
      if (!n) continue;
      n.textContent = text || "";
      n.style.color = isError ? "#ff6b6b" : "#888";
    }
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
  // stays as the tooltip. Re-run on render, layout change, and window resize. Wide and compact only since `ddjp_702`: a phone's
  // button reads in full and moves under the controls instead (`_placePhoneJoin`, below).
  const _JOIN_LADDER = ["Join the DJ queue", "Join DJ queue", "Join queue", "Join", "JQ"];
  const _LEAVE_LADDER = ["Leave the DJ queue", "Leave DJ queue", "Leave queue", "Leave", "LQ"];
  function _fitJoinLabel(active) {
    const btn = refs.joinBtn;
    if (!btn) return;
    const ladder = active ? _LEAVE_LADDER : _JOIN_LADDER;
    btn.title = ladder[0];
    const row = btn.closest ? btn.closest(".playback-controls") : null;
    if (row && row.classList) row.classList.remove("pc-under");   // a phone's placing (`_placePhoneJoin`) is not this layout's
    const fits = () => !row || row.scrollWidth <= row.clientWidth + 1;
    const stepDown = () => {
      for (let i = 0; i < ladder.length; i++) {
        btn.textContent = ladder[i];
        if (i === ladder.length - 1) break;                 // shortest is the floor
        if (!row) break;                                    // not mounted yet — keep longest
        if (fits()) break;                                  // fits without overflowing the row
      }
    };
    // THE LAST RESORT (owner ruling, ddjp_450). A phone with the Leave lock showing had more FIXED
    // width in this row than the column holds, so even "LQ" overflowed and the whole page scrolled
    // sideways. Re-decided every fit: one line first, the label shortened as far as it goes; only if
    // that still overflows does the volume and reactions group drop to a second line — and then the
    // label is fitted again, because the join group has its line to itself.
    if (row && row.classList) row.classList.remove("pc-wrap");
    stepDown();
    if (row && row.classList && !fits()) { row.classList.add("pc-wrap"); stepDown(); }
    if (!_joinResizeWired) _wireJoinResize();
  }
  // RE-JUDGED LIVE ON RESIZE AND ROTATION — the one hook, made once. The WHOLE render, not only the fit: `_fitJoinLabel` rewrites
  // `title`, so re-fitting alone turned a refused Join's reason back into a plain label the first time the window moved.
  function _wireJoinResize() {
    if (_joinResizeWired) return;
    _joinResizeWired = true;
    let _rt;
    window.addEventListener("resize", () => {
      clearTimeout(_rt);
      _rt = setTimeout(() => { if (refs.joinBtn) renderJoinBtn(); }, 120);
    });
  }

  // ── THE PHONE'S JOIN / LEAVE: ALWAYS IN FULL, BESIDE THE CONTROLS IF IT FITS, ELSE CENTRED UNDER THEM (`ddjp_702`) ──────────
  // Measured by the supervisor at 700, 390 px, a song playing: the ladder made Join "Join" on one line and Leave "Leave the DJ
  // queue" on two, so a tap made the row jump. The owner's: "in phone mode we might as well put the join or leave queue buttons and
  // lock centered under and bump up the row on its place", then "its good under but i dont like the idea of it being under if it
  // would of fit to the left, so, lets only put it under if it dosent fit to the left dynamically AND lets not stretch volume
  // slider more to the left". So, in the phone layout only (the selector's mode, never the window's width):
  //   · the button reads in full — "Join the DJ queue" / "Leave the DJ queue" (with the lock); no ladder;
  //   · it stays on the left of the controls' line when it fits there, and goes under that line, centred, when it does not
  //     (`pc-under`: the controls' line moves up into the row's place);
  //   · THE FIT IS JUDGED ON THE WIDER STATE — Leave with its lock (the supervisor's default) — so Join and Leave always sit alike
  //     and a tap moves nothing but the button;
  //   · the controls (volume, ↻, ★ ▲) keep their own size and place, and the slider is never stretched: measured with nothing
  //     shrinking (`pc-measure`), the slider at its own width.
  // The measure writes Leave's words and shows the lock, reads, and puts both back in the same turn — nothing is painted between.
  // Wide and compact keep the ladder above.
  function _placePhoneJoin(active) {
    const btn = refs.joinBtn, lock = refs.leaveLockBtn;
    if (!btn) return;
    const full = active ? _LEAVE_LADDER[0] : _JOIN_LADDER[0];
    btn.textContent = full;
    btn.title = full;
    if (!_joinResizeWired) _wireJoinResize();
    const row = btn.closest ? btn.closest(".playback-controls") : null;
    if (!row || !row.classList) return;
    const lockShown = lock ? lock.style.display : null;
    row.classList.remove("pc-wrap", "pc-under");   // measured on one line, whatever the last placing was
    row.classList.add("pc-measure");
    btn.textContent = _LEAVE_LADDER[0];
    if (lock) lock.style.display = "";
    const fits = row.scrollWidth <= row.clientWidth + 1;
    btn.textContent = full;
    if (lock) lock.style.display = lockShown;
    row.classList.remove("pc-measure");
    row.classList.toggle("pc-under", !fits);
  }

  function renderJoinBtn() {
    if (!refs.joinBtn) return;
    const active = UserQueue.isActive();
    const stackLeft = UserQueue.stackCount ? UserQueue.stackCount() : 0;

    refs.joinBtn.classList.remove("active", "dropped", "refilling");

    // The Join/Leave label shortens under horizontal pressure instead of growing the row — see
    // _fitJoinLabel (a longest→shortest ladder that steps down until the player-control row stops
    // overflowing, and only then, as the last resort, lets the row stack). Fixed height; full text
    // stays as the tooltip.
    // ── JOIN ASKS THE ROOM'S RULE; LEAVE NEVER DOES ─────────────────────────────────────────
    // Whether I may join is the room's call (J07's `minDjRank` bar), so it comes from the adapter
    // like every other gated control — this button used to decide it alone, from the device's
    // queue, and offered a live Join to people the room refuses. A refused join is not an error
    // anywhere: the send succeeds, the fold drops it, and the button went on reading "Leave" as if
    // it had worked. So a refusal is shown DISABLED with the backend's own reason as the tooltip,
    // which is the user card's rule, rather than hidden.
    //
    // Leave is NOT gated by it. An active person is either in the rotation — a raised bar ejects
    // nobody — or waiting on a join the room refused, and Leave is the only way out of the second.
    // Pinned by `check-min-dj-rank` PART H, which runs this function against the real adapter.
    let refused = null;
    if (active) {
      // In the rotation, or actively (re)joining — auto-feed is on.
      refs.joinBtn.classList.add("active");
      refs.joinBtn.disabled = false;
    } else {
      // Not in the rotation — whether we never joined or just ran out.
      // Joining with nothing to play would put us in as an invisible member that
      // never rotates, so require at least one queued song before Join is live.
      const d = Actions.describe("dj.join");
      if (!d.enabled) refused = d.reason || null;
      refs.joinBtn.disabled = stackLeft === 0 || !d.enabled;
    }
    // A PHONE'S BUTTON IN FULL, BESIDE OR UNDER THE CONTROLS (`ddjp_702`, `_placePhoneJoin`); wide and compact, the ladder.
    if (H.layoutMode && H.layoutMode() === "phone") _placePhoneJoin(active); else _fitJoinLabel(active);
    // AFTER the fit, because `_fitJoinLabel` (and a phone's placing) writes the full label into `title`.
    if (refused) refs.joinBtn.title = refused;

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
  // ── THE DM SLOT WAS DECLARED BEFORE IT WAS BUILT, DELIBERATELY ──────────────────
  // J14 listed "open a DM" among the card's actions and names J15 as the job
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
    // Each action starts with its ICON in a square (owner ruling, ddjp_479) — PLAIN symbols, not colour emoji
    // (ddjp_481); the mail sign carries U+FE0E, which asks the browser to draw it as text.
    { action: "member.kick", label: "Remove From Room", icon: "\u21E5",
      confirm: (m) => "Remove " + m.name + " from this room?",
      note: "They are removed from all of this room's channels now. It does not keep them out.",
      danger: false },
    { action: "member.ban", label: "Ban", icon: "\u2298",
      confirm: (m) => "Ban " + m.name + " from this room?",
      note: "They are removed and cannot come back unless the ban is lifted.",
      danger: true },
    // J15 filled this slot with one catalog entry, exactly as J14 said it would — the
    // `action`/`label`/`confirm`/`note`/`danger` shape above needed no change. `closeOnRun`
    // is the ONE field J15 added, and it is here rather than in the adapter because it is
    // presentation: a DM opens a panel BEHIND this overlay, so a card that stayed up would
    // cover the thing the click just opened. The moderation rows do not take it — their
    // result is a verdict the person has to read.
    { action: "chat.dm", label: "Direct Message", icon: "\u2709\uFE0E",
      confirm: null, note: null, danger: false, closeOnRun: true },
    // The @ button (ddjp_431): one catalog row, the same shape as `chat.dm`, and it closes the card
    // because its result — their ID in your chat box — is on the panel behind it.
    { action: "chat.mention", label: "Chat Mention", icon: "@",
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
    _openCardRepaint = null;
    _cardRank.note = null;
  }

  // Repaint the OPEN card, if there is one, from the room as it is now (ddjp_471). Called on every rank
  // change and every member change; a closed card has nothing to repaint.
  // ── A BURST REDRAWS ONCE, AND A CHANGE'S BURST REDRAWS ONLY ITS PROGRESS LINE (J129, the owner's) ────────────────────
  // Every power-level and member event reached here (`_peopleChanged` in `ui/screens.js`), and each repaint cleared the card's
  // body: one rank change is twenty-odd such events, each replacing an open picker, and in Chromium removing a focused one
  // fires its blur — which re-locked the card. Now: while a rank change runs on this tab (`Room.rankJob()`), an event updates
  // the progress line and nothing else; otherwise events within `_cardRank.BURST_MS` of the first ask for ONE repaint. The change
  // starting and ending repaint at once (`_onRankJob`), because that is when the pickers grey out and come back.
  // The card's rank-change state, one table so a guard that runs the card extracts it whole: the burst's wait (`BURST_MS`) and
  // timer, the open card's progress-line redraw (`note`), whether `Room.onRankJob` is wired, and whether a change ran when
  // the card last looked.
  const _cardRank = { BURST_MS: 200, burstTimer: null, note: null, wired: false, wasRunning: false };
  let _openCardRepaint = null;
  // AN UPGRADE'S BOT STEP COUNTS AS RUNNING (`ddjp_694`): it holds the same turn (`Room.upgradeBotStep`), so a burst during it
  // redraws the line only, and its start and end repaint the card.
  function _rankRunningNow() {
    try { const j = Room.rankJob ? Room.rankJob() : null; return !!(j && j.state === "running") || !!(Room.upgradeBotStep && Room.upgradeBotStep()); } catch (e) { return false; }
  }
  function refreshUserCard() {
    if (typeof _openCardRepaint !== "function") return;
    if (_rankRunningNow()) { if (typeof _cardRank.note === "function") { try { _cardRank.note(); } catch (e) {} } return; }
    if (_cardRank.burstTimer) return;
    _cardRank.burstTimer = setTimeout(() => {
      _cardRank.burstTimer = null;
      if (typeof _openCardRepaint === "function") { try { _openCardRepaint(); } catch (e) {} }
    }, _cardRank.BURST_MS);
  }
  // The running change's own listener: its progress redraws the line; its start and its end redraw the card once.
  function _onRankJob(j) {
    const running = !!(j && j.state === "running") || _rankRunningNow();
    const turned = running !== _cardRank.wasRunning;
    _cardRank.wasRunning = running;
    if (turned) { if (typeof _openCardRepaint === "function") { try { _openCardRepaint(); } catch (e) {} } return; }
    if (typeof _cardRank.note === "function") { try { _cardRank.note(); } catch (e) {} }
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
    // ── ONE LOCK FOR RANK, REMOVE AND BAN (owner rulings, ddjp_452) ─────────────────────────────
    // The three acts on a PERSON sit behind one lock — the app's own non-expiring panel lock, borrowed
    // from the shell rather than built a second time. It does NOT expire on a timer; it locks when you lock it by hand, or
    // when your rights go. It is LOCAL to this open, so every open starts locked and nobody inherits an unlocked card.
    // ONE UNLOCK PER OPEN CARD (J129, the owner's — it REPLACES `ddjp_477`'s "an unlock is for one act"): neither choosing a
    // rank nor leaving the picker locks it again; between changes the picker waits for the running one to be ready. Opening
    // the picker still holds Remove and Ban (ddjp_477, kept). The Confirm second click on Remove and Ban is KEPT on top of it.
    // Message and @ are not behind it. With nothing to moderate here — your own card, someone you cannot act on — there is
    // no lock at all, because unlocking would reveal nothing.
    let unlocked = false;
    const GATED = { "member.kick": true, "member.ban": true };
    // AN OPEN CARD FOLLOWS THE ROOM (ddjp_471). Everything the card decides is decided AGAIN each time it
    // paints — the person's rank re-read from the roster, every action re-asked — and the app repaints an
    // open card on any rank or member change (`refreshUserCard`). It used to decide once, at open.
    let rankD = null, specs = [], anyGated = false;
    const fresh = () => {
      try {
        const r = (Room.getRoster ? (Room.getRoster() || []) : []).find((x) => x && x.userId === m.userId);
        if (r && typeof r.level === "number") m.level = r.level;
      } catch (e) {}
      nameEl.style.color = H.rankColor(m.level);
      const target = { userId: m.userId, targetRank: m.level };
      rankD = Actions.describe("rank.assign", target);
      specs = _cardActions().map((spec) => ({ spec: spec, d: Actions.describe(spec.action, target) }));
      anyGated = rankD.enabled || specs.some((x) => GATED[x.spec.action] && x.d.enabled);
      if (!anyGated) unlocked = false;   // rights gone: nothing to unlock, and none kept for their return
    };
    const lockSlot = H.el("div", { class: "uc-lock" });
    // THE CARD'S OWN PICTURE GETS THE RING TOO (the owner's "ok" to the supervisor's suggestion 5, `ddjp_693`): the picture he
    // agreed had it on the card's head. It sits in a wrapper of its own (`.uc-av`, drawn as no box, so nothing moves), which the
    // ring marks and a picture loading later does not replace — the same rule as every other picture (`stand`, below).
    const headAv = H.el("span", { class: "uc-av" }, [H.avatarEl(m.userId, 40)]);
    const head = H.el("div", { class: "uc-head" }, [
      headAv,
      // Under the name, the FULL Matrix ID — server and all (owner ruling, ddjp_466). The rank is shown in
      // its own box below, which is always there, so it is not said twice.
      H.el("div", { class: "uc-id" }, [
        nameEl,
        H.el("span", { class: "uc-mxid", text: m.userId }),
      ]),
      lockSlot,
    ]);

    // THE BODY IS FOUR SLOTS (J129; the second since `ddjp_692`): the rank row, a rank not the same everywhere (`stand`), its
    // progress line, and the actions. Only the actions are rebuilt on every paint; the rank row is rebuilt only when what it
    // shows changes (`rankSig`), so a repaint leaves a focused, open picker as it is; the progress line is redrawn in place
    // (`note`), and the out-of-step slot on every paint.
    const rankSlot = H.el("div", { class: "uc-rank" });
    // A RANK THAT IS NOT THE SAME EVERYWHERE (the owner's plan, part 1): the card is the answer and the fix — what each room
    // says, and Repair, or who may (`stand`, below). Empty when their rank is the same everywhere.
    const offSlot = H.el("div", { class: "uc-rank-off" });
    const noteSlot = H.el("div", { class: "uc-rank-note muted" });
    const actsSlot = H.el("div", { class: "uc-acts" });
    const body = H.el("div", { class: "uc-body" }, [rankSlot, offSlot, noteSlot, actsSlot]);
    const LOCKED_TITLE = "Locked \u2014 unlock this card to change their rank, remove or ban them";
    let gatedNow = [];   // Remove and Ban as last painted — the rank picker disables them while it is open
    let rankSig = null;
    let rankPicker = null;   // the picker as mounted — kept across paints that do not change it
    let pickerOpen = false;  // the mounted picker has focus: Remove and Ban stay held through a repaint until it is left
    // A SELECT'S SHAPE, as a person would see it: what each option says and whether it is offered, which one is chosen, and
    // whether the box itself can be used. Two equal shapes are the same picker.
    // `children` IS AN HTMLCollection in the browser, with no array methods — read through `Array.from` (`ddjp_653`: it was
    // `.map`ped, which threw, and the card never opened; the owner's report).
    const shapeOf = (n) => JSON.stringify([n.disabled === true, n.title || "", Array.from(n.children || []).map((c) =>
      [c.value !== undefined ? c.value : (c.attrs && c.attrs.value), c.text !== undefined ? c.text : c.textContent, !!(c.disabled || (c.attrs && c.attrs.disabled)), !!c.selected])]);
    // THE PROGRESS LINE (J129): what the one rank change on this tab is doing, from `Room.rankJob()` — rendered, not decided.
    const note = () => {
      let j = null, up = null;
      try { j = Room.rankJob ? Room.rankJob() : null; } catch (e) { j = null; }
      try { up = Room.upgradeBotStep ? Room.upgradeBotStep() : null; } catch (e) { up = null; }
      H.clear(noteSlot);
      if (noteSlot.classList) noteSlot.classList.remove("uc-rank-waits");   // the wait's own line, below, when there is one (`ddjp_697`)
      const waitLine = (sw) => { if (!sw) return; noteSlot.appendChild(sw); if (noteSlot.classList) noteSlot.classList.add("uc-rank-waits"); };
      // AN UPGRADE'S BOT STEP HOLDS THE TURN (`ddjp_694`): the line says so in the room's words, as for another change (J129) —
      // unless a change still runs (the step waits for it), whose line this card shows instead.
      if (up && !(j && j.state === "running")) {
        noteSlot.appendChild(H.el("span", { text: up.text }));
        waitLine(H.slowWait ? H.slowWait("ranks") : null);   // Matrix asked us to wait (`ddjp_697`)
        if (rankPicker && rankSig && rankSig.indexOf("shown|") === 0) {
          try { const d = Actions.describe("rank.assign", { userId: m.userId, targetRank: m.level }); if (!d.enabled && d.reason) rankPicker.title = d.reason; } catch (e) {}
        }
        return;
      }
      if (!j) return;
      const mine = j.userId === m.userId;
      if (j.state === "running") {
        const of = j.total ? j.done + " of " + j.total : "";   // the steps are counted as the change starts
        // A REPAIR SAYS IT IS ONE (the owner's plan, part 1); either change shows its steps on a bar — his "the progress is not
        // quite intuitive". The bar is the leave's (`.room-leave-track`, borrowed), filled to steps confirmed of steps.
        noteSlot.appendChild(H.el("span", { text: mine ? (j.repair ? "Repairing " + (m.name || j.name) + "'s rank\u2026" : "Changing to " + H.rankName(j.level) + "\u2026") + (of ? " " + of : "")
          : "Waiting \u2014 a rank change for " + (j.name || j.userId) + " is running" + (of ? " (" + of + ")" : "") }));
        if (mine) {
          const fill = H.el("div", { class: "room-leave-fill" });
          fill.style.width = (j.total ? Math.round((100 * j.done) / j.total) : 0) + "%";
          noteSlot.appendChild(H.el("div", { class: "uc-rank-bar room-leave-track" }, [fill]));
          // MATRIX ASKED US TO WAIT (`ddjp_697`): said under the bar, orange, with the countdown — the status piece's seconds.
          waitLine(H.slowWait ? H.slowWait("ranks") : null);
        }
        // The waiting picker's own reason moves with it: asked again, so it is the backend's words, not a copy of them.
        if (rankPicker && rankSig && rankSig.indexOf("shown|") === 0) {
          try { const d = Actions.describe("rank.assign", { userId: m.userId, targetRank: m.level }); if (!d.enabled && d.reason) rankPicker.title = d.reason; } catch (e) {}
        }
        return;
      }
      if (!mine) return;
      if (j.state === "done") { noteSlot.appendChild(H.el("span", { text: H.rankName(j.level) + " \u2713" })); return; }
      // A REPAIR THAT STOPPED SAYS WHERE, AND OFFERS ITSELF AGAIN (the owner's plan, part 1); any other change as before.
      noteSlot.appendChild(H.el("span", { text: j.repair
        ? "Repair stopped at " + j.done + " of " + j.total + " \u2014 not confirmed: " + ((j.failed || []).join(", ") || "unknown")
        : "Not finished \u2014 not confirmed: " + ((j.failed || []).join(", ") || "unknown") }));
      // TRY AGAIN IS THE SAME CHANGE AGAIN, and the change is the repair: it re-applies the whole correct state.
      const again = H.el("button", { class: "mini uc-retry", text: j.repair ? "Repair again" : "Try again" });
      if (!unlocked) { again.disabled = true; again.title = LOCKED_TITLE; }
      else again.onclick = async () => {
        let tr = m.level;
        if (j.repair) { try { const st = Room.rankStanding ? Room.rankStanding(m.userId) : null; if (st && typeof st.effective === "number") tr = st.effective; } catch (e) {} }
        const sent = Actions.perform("rank.assign", j.repair ? { userId: m.userId, targetRank: tr, newLevel: j.level, repair: true }
          : { userId: m.userId, targetRank: m.level, newLevel: j.level });
        try { told(await sent); } catch (e) { result.textContent = e.message || "Couldn't change that rank."; }
      };
      noteSlot.appendChild(again);
    };
    // ── THE LINE AND THE FIX (the owner's plan, part 1: "the player card as the awnser and solution") ───────────────────────
    // What each room says, worded from the room's facts (`Room.rankStanding`): "<name>'s rank isn't the same everywhere in
    // this room: Staff in the room, Guest in 3 of its 18 channels." Then "Repair to <rank>" — the rank set last — for whoever
    // may give it (the picker's rule, the adapter's), greyed as the picker is; anyone else is told who may. Where this device
    // cannot tell which rank was set last, it says so and offers each. Not shown while this tab's own change for them runs or
    // has stopped: its line above says where it is. A repair is the rank change itself, so it waits, shows and stops the same.
    const stand = () => {
      H.clear(offSlot);
      if (H.rankRing) H.rankRing(headAv, m.userId);   // the card's own picture: the ring, by the room's rule (`ddjp_693`)
      let st = null, j = null;
      try { st = Room.rankStanding ? Room.rankStanding(m.userId) : null; } catch (e) { st = null; }
      if (!st || !st.outOfStep) return;
      try { j = Room.rankJob ? Room.rankJob() : null; } catch (e) { j = null; }
      if (j && j.userId === m.userId && j.state !== "done") return;
      const parts = [];
      if (typeof st.space === "number") parts.push(H.rankName(st.space) + " in the room");
      (st.byLevel || []).filter((b) => b.level !== st.space).forEach((b, i) =>
        parts.push(H.rankName(b.level) + " in " + b.n + (i === 0 ? " of its " + st.channels + (st.channels === 1 ? " channel" : " channels") : "")));
      offSlot.appendChild(H.el("span", { class: "uc-off-line", text: m.name + "'s rank isn't the same everywhere in this room: " + parts.join(", ") + "." +
        (st.by === "unknown" ? " This device can't tell which was set last." : "") }));
      const offer = (typeof st.target === "number") ? [st.target]
        : [st.space].concat((st.byLevel || []).map((b) => b.level)).filter((l, i, a) => typeof l === "number" && a.indexOf(l) === i);
      const tr = (typeof st.effective === "number") ? st.effective : m.level;
      let mine = 0;
      for (const lvl of offer) {
        const d = Actions.describe("rank.assign", { userId: m.userId, targetRank: tr, newLevel: lvl });
        if (!d.permitted) continue;
        mine++;
        const b = H.el("button", { class: "mini uc-repair", text: "Repair to " + H.rankName(lvl) });
        // A LEVEL THE ROOM HAS NOT UNLOCKED IS SHOWN LOCKED, IN THE PICKER'S WORDS (`ddjp_693`: the bot's rung waits for the last
        // upgrade) — the picker's rule, so the card never offers a repair the room would refuse as "upgrade the room first".
        if (!Room.isRankUnlocked(Room.getChannels(), lvl)) { b.disabled = true; b.title = H.rankName(lvl) + " \u2014 upgrade the room first"; }
        else if (!d.enabled) { b.disabled = true; b.title = d.reason || "Not available right now"; }
        else if (!unlocked) { b.disabled = true; b.title = LOCKED_TITLE; }
        else b.onclick = async () => {
          const sent = Actions.perform("rank.assign", { userId: m.userId, targetRank: tr, newLevel: lvl, repair: true });
          try { told(await sent); } catch (e) { result.textContent = e.message || "Couldn't repair that rank."; }
        };
        offSlot.appendChild(b);
      }
      if (mine) return;
      // WHO MAY, SAID BY RANK (the owner's, `ddjp_693`): "<Rank>+ can repair it." — the lowest rung the rank change's rule lets
      // give it, its name as every rank is named here, "+" as the chat menu's "Guest+" — or "Owner can repair it." where only the
      // owner may. Nothing where nobody may now (his "or nothing since owner always can"). The room decides (`Room.rankRepairRank`).
      let who = null;
      try { who = Room.rankRepairRank ? Room.rankRepairRank(m.userId, offer) : null; } catch (e) { who = null; }
      if (who && (who.owner || typeof who.level === "number")) {
        offSlot.appendChild(H.el("span", { class: "uc-off-who", text: who.owner ? "Owner can repair it." : H.rankName(who.level) + "+ can repair it." }));
      }
    };
    // A CHANGE REFUSED BEFORE IT STARTS says why here (`Room.assignRank` answers it by name); one that started reports on the
    // progress line above, done or failed.
    const REFUSED = { "rank-change-running": "Another rank change is running \u2014 wait for it to finish.",
                      "upgrade-first": "That rank needs the room upgraded first.", "denied": "Your rank cannot give that rank." };
    const told = (res) => { if (res && res.ok === false && REFUSED[res.reason]) result.textContent = REFUSED[res.reason]; };
    const paint = () => {
      fresh();
      gatedNow = [];
      const gatedBtns = gatedNow;   // Remove and Ban as painted this time
      H.clear(actsSlot);
      H.clear(lockSlot);
      if (anyGated) {
        lockSlot.appendChild(H._panelLockBtn(!unlocked,
          unlocked ? "Moderation unlocked \u2014 click to lock" : LOCKED_TITLE,
          () => { unlocked = !unlocked; paint(); }));
      }
      // THE RANK BOX IS ALWAYS THERE (owner ruling, ddjp_466) — it is where the rank is shown. Live when you
      // may change it (and the card is unlocked); otherwise SHOWN but not changeable: one option, their
      // current rank, with the backend's reason. The picker lists only ranks you may assign, so it would
      // be empty for a viewer who may assign none — hence a box of its own, not a disabled picker.
      let row = null, picker = null;
      if (!rankD.enabled) {
        row = H.el("div", { class: "uc-row" }, [H.el("span", { class: "uc-label", text: "Rank" })]);
        const shown = H.el("select", { class: "rank-select" });
        shown.appendChild(H.el("option", { value: String(m.level), text: H.rankName(m.level) }));
        shown.disabled = true;
        // While a rank change runs, every card's picker WAITS (J129): its reason is the running change's progress.
        shown.title = rankD.reason || "Your rank cannot change theirs";
        row.appendChild(shown);
        picker = shown;
      }
      if (rankD.enabled) {
        row = H.el("div", { class: "uc-row" }, [H.el("span", { class: "uc-label", text: "Rank" })]);
        // A PICK THAT STARTS NO CHANGE PUTS ITS BOX BACK (J129, corrected at `ddjp_666`; the owner's choice): locked, refused
        // before a change starts (`Room.assignRank` answers `ok: false`, for any reason, a silent one too), or a send that
        // throws — the box goes back to the option it was drawn with (`back`). Left alone it showed the rank that did not
        // happen: nothing repaints after a refusal, a later repaint keeps the mounted picker (a fresh one's shape is the same),
        // and picking that rank again fired no change, because the select's value was that already. A pick that starts a
        // change needs none of it — its start repaints the card and replaces this box — so a box no longer mounted is left.
        const sel = rankSelect(m.level, async (lvl) => {
          if (!unlocked) { back(); return; }   // the picker is disabled while locked; this is the same rule at the act
          // THE CARD STAYS UNLOCKED (J129, the owner's; `ddjp_477`'s re-lock on a pick is replaced): the change starts, every
          // picker waits for it, and when it is ready they are live again — no second unlock.
          const sent = Actions.perform("rank.assign", { userId: m.userId, targetRank: m.level, newLevel: lvl });
          let res;
          try { res = await sent; }
          catch (e) { back(); result.textContent = e.message || "Couldn't change that rank."; return; }
          if (!(res && res.ok === true)) back();
          told(res);
        }, m.userId);
        const drawn = sel.value;   // the option the box was drawn with
        const back = () => { if (rankPicker === sel) sel.value = drawn; };
        if (!unlocked) { sel.disabled = true; sel.title = LOCKED_TITLE; }
        else {
          // WHILE THE PICKER IS OPEN, Remove and Ban cannot be clicked (ddjp_477, kept) — its list can sit over them.
          sel.onfocus = () => { pickerOpen = true; for (const b of gatedNow) { if (b._disarm) b._disarm(); b.disabled = true; } };   // an armed one is cancelled too
          // LEAVING IT NO LONGER LOCKS THE CARD (J129, the owner's): it gives Remove and Ban back, as painted.
          sel.onblur = () => { pickerOpen = false; if (unlocked) for (const b of gatedNow) if (b._live) b.disabled = false; };
        }
        row.appendChild(sel);
        picker = sel;
      }
      // REBUILT ONLY WHEN WHAT IT SHOWS CHANGES (J129): the same shape keeps the mounted row — and a focused, open picker with it.
      const sig = (rankD.enabled ? "live" : "shown") + "|" + shapeOf(picker);
      if (sig !== rankSig || !rankSlot.children.length) { H.clear(rankSlot); rankSlot.appendChild(row); rankSig = sig; rankPicker = picker; pickerOpen = false; }   // a replaced picker is not open, blur or no blur
      note();
      stand();
      for (const x of specs) {
        const spec = x.spec, d = x.d;
        const locked = !!GATED[spec.action] && !unlocked;
        // The icon in its square, then the label; the row can also hold the confirm check at its far right.
        const lbl = H.el("span", { class: "uc-lbl", text: d.label || spec.label });
        const btn = H.el("button", { class: "uc-action" + (spec.danger ? " uc-danger" : "") },
          [H.el("span", { class: "uc-ico", text: spec.icon || "" }), lbl]);
        btn.dataset.action = spec.action;
        if (GATED[spec.action]) gatedBtns.push(btn);
        btn.disabled = !d.enabled || locked;
        btn._live = !btn.disabled;   // J129: what leaving the rank picker gives back
        if (GATED[spec.action] && pickerOpen) btn.disabled = true;   // and while it is open, a repaint keeps them held
        if (!d.enabled && d.reason) btn.title = d.reason;
        else if (d.enabled && locked) btn.title = LOCKED_TITLE;
        const act = H.el("div", { class: "uc-act" }, [btn]);
        if (d.enabled && !locked) {
          btn.onclick = () => _runCardAction(spec, m, btn, result, act, lbl);
        }
        actsSlot.appendChild(act);
      }
    };
    paint();

    const close = H.el("button", { class: "mini", text: "Close", onclick: _closeUserCard });
    const card = H.el("div", { class: "uc-card" }, [head, body, result, H.el("div", { class: "uc-foot" }, [close])]);
    const overlay = H.el("div", { class: "uc-overlay" }, [card]);
    overlay.onclick = (e) => { if (e.target === overlay) _closeUserCard(); };
    _cardMount(overlay);
    _openCardRepaint = paint;   // so a rank or member change repaints THIS card while it is open
    _cardRank.note = note;      // and a running rank change redraws its progress line (J129)
    if (!_cardRank.wired && Room.onRankJob) { Room.onRankJob(_onRankJob); _cardRank.wired = true; }
    _cardRank.wasRunning = _rankRunningNow();
  }

  // Two-step for anything with a confirm string. The 5s misclick locks in ui/shell.js
  // are a timer; this is a deliberate second click, because a removal has
  // no undo the way a mis-struck song does.
  //
  // AND THE RESULT IS REPORTED AS THE BACKEND STATES IT. `Room.ban`/`Room.kick`
  // return a verdict across the room set, and a PARTIAL is the case J14 said
  // would bite on day one — twenty rooms closed and one open is not a success, so this
  // never prints one. The count comes out of the verdict rather than being assumed
  // from the absence of a throw.
  // ── REMOVE AND BAN ARE CONFIRMED AT THE FAR RIGHT (owner ruling, ddjp_479) ─────────────────────────
  // The first click ARMS: the question replaces the label, and a check square appears at the far right of
  // the row. Only the check acts. A second click on the same spot CANCELS, and so does waiting 5 s — so a
  // double-click, or a second click by habit, can never remove or ban anyone. It was the same button,
  // turned into "Confirm" in place.
  function _runCardAction(spec, m, btn, result, act, lbl) {
    const setLabel = (t) => { if (lbl) lbl.textContent = t; else btn.textContent = t; };
    const baseLabel = lbl ? lbl.textContent : btn.textContent;
    if (spec.confirm) {
      if (btn.dataset.armed === "1") { if (btn._disarm) btn._disarm(); return; }   // same spot again: cancel
      btn.dataset.armed = "1";
      const label = baseLabel;
      setLabel(spec.confirm(m));
      result.textContent = spec.note || "";
      const check = H.el("button", { class: "uc-confirm" + (spec.danger ? " uc-danger" : ""), text: "\u2713",
        title: "Yes \u2014 " + spec.confirm(m).replace(/\?$/, "") });
      check.dataset.confirmFor = spec.action;
      const disarm = () => {
        btn.dataset.armed = ""; setLabel(label); result.textContent = "";
        try { check.remove(); } catch (e) {}
        btn._disarm = null;
      };
      btn._disarm = disarm;
      check.onclick = () => { disarm(); _performCardAction(spec, m, btn, result, setLabel, label); };
      if (act) act.appendChild(check);
      setTimeout(() => { if (btn.dataset.armed === "1") disarm(); }, 5000);
      return;
    }
    _performCardAction(spec, m, btn, result, setLabel, baseLabel);
  }

  function _performCardAction(spec, m, btn, result, setLabel, label) {
    btn.disabled = true;
    setLabel("Working…");
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
          // And for the @ button, the ID goes into the chat box, off the RETURNED text for the same reason.
          if (spec.action === "chat.mention" && res && res.ok !== false && res.text) {
            ChatPanels.insertMention(res.text);
          }
          return;
        }
        if (res && res.ok === false) {
          const open = (res.failed || []).concat(res.unverified || []).length;
          result.textContent = "Not finished: " + (res.closed || 0) + " of " + (res.total || 0) +
            " channels done, " + open + " still open. Try again — repeating it is safe.";
          btn.disabled = false; setLabel(label);
          return;
        }
        if (res && res.reentry === "open") {
          result.textContent = "Removed. This room is public, so they can come back in.";
        } else {
          result.textContent = "Done.";
        }
        setLabel(label);
      })
      .catch((e) => {
        result.textContent = (e && e.message) || "That didn't work.";
        btn.disabled = false; setLabel(label);
      });
  }


  // THE PEOPLE TAB'S REP (H3, J84-3): through `Rep`, REP's one entry, and nowhere else in the UI (`check-rep-boundary` D).
  function _repBadge(userId) {
    try { return (typeof Rep !== "undefined" && Rep.badge) ? (Rep.badge(userId) || null) : null; } catch (e) { return null; }
  }

  function renderRoster() {
    if (!refs.rosterBox) return;
    H.clear(refs.rosterBox);
    const roster = Room.getRoster();
    // NULL IS "NOT LOADED YET" (`ddjp_699`, members on request), never "just you". SAID, IN THE LIST'S PLACE (`ddjp_700`, JOB 2;
    // the owner's "2 ok"): "Loading people…", muted, where the first person would be — and past the transport's wait (10 s,
    // `Room.peopleLate`) "Couldn't load people yet — retrying", until they land. Their landing, and the wait's end, redraw it
    // (`Room.onMembersChange`).
    if (roster === null) {
      let late = false;
      try { late = !!(Room.peopleLate && Room.peopleLate()); } catch (e) { late = false; }
      refs.rosterBox.appendChild(H.el("div", { class: "muted people-wait", text: late ? "Couldn't load people yet \u2014 retrying" : "Loading people\u2026" }));
      return;
    }
    if (!roster || roster.length === 0) {
      refs.rosterBox.appendChild(H.el("p", { class: "muted", text: "Just you so far" }));
      return;
    }
    // ── ONE LIST THAT CARRIES WHO IS ACTIVE (owner-approved design, ddjp_456) ────────────────────
    // Each member one compact row: a small avatar — with a green dot when active — the name, how long ago for active
    // people only, and the person's REP on the right when this device holds it. NO RANK LABEL (the owner's ruling 36, J88):
    // the rank shows through the name's colour (ruling 37), and the user card shows and changes it. THE ORDER IS THE FEATURE LAYER'S (`Room.peopleOrder`, rulings 31 and 34): the active on top, the inactive below
    // and greyed; within each, rank, then REP (no number after any number), then a–z. "Active" is this viewer's own view
    // (`Room.presenceView`), read against the server clock, never the device's.
    // The name is the card trigger (J14): the same affordance everywhere a person appears.
    let fold = null;
    try {
      const now = (typeof ServerClock !== "undefined" && ServerClock.serverNow) ? ServerClock.serverNow() : 0;
      fold = Room.presenceView ? Room.presenceView(now) : Room.recentlyActive(now);
    } catch (e) { fold = null; }
    // H3 (J84-3): REP's one name in the UI. `<n> REP`, in light grey, on the right where the rank tag was (ruling 36), only
    // when this device holds that person's REP; otherwise nothing there — never a 0, and no coverage text anywhere (Q6).
    const badges = Object.create(null);
    for (const m of roster) if (m && m.userId) badges[m.userId] = _repBadge(m.userId);
    const numberOf = (u) => (badges[u] && typeof badges[u].rep === "number") ? badges[u].rep : null;
    const ordered = Room.peopleOrder ? Room.peopleOrder(fold, roster, numberOf) : roster.map((m) => ({ member: m, active: null }));
    for (const it of ordered) {
      const member = it.member;
      const av = H.el("span", { class: "person-av" + (it.active ? " active" : "") }, [H.avatarEl(member.userId, 22)]);
      const nameEl = H.el("span", { class: "who", text: member.name || H.shortName(member.userId) });
      nameEl.style.color = H.rankColor(member.level);
      _wireCardTrigger(nameEl, member.userId, member.level);
      // The PROFILE PICTURE opens the card too (ddjp_478) — wired on its wrapper, which a picture loading
      // later does not replace (the image swaps in INSIDE it).
      _wireCardTrigger(av, member.userId, member.level);
      if (H.rankRing) H.rankRing(av, member.userId);   // a rank not the same everywhere: the ring (the owner's plan, part 1)
      const kids = [av, nameEl];
      if (it.active) {
        const ago = (typeof Panels !== "undefined" && Panels.agoFromServer) ? Panels.agoFromServer(it.active.lastTs) : "";
        if (ago) kids.push(H.el("span", { class: "person-ago", text: ago }));
      }
      // REP LAST, ON THE RIGHT (ruling 36): the rank tag's spot, pushed there by `.person-rep`'s own style. No number held
      // here, nothing there — the spot stays empty rather than holding a 0 or the rank.
      const b = badges[member.userId];
      if (b && b.text) kids.push(H.el("span", { class: "person-rep", text: b.text }));
      // The inactive are greyed, the whole row — the name and REP with it (rulings 34 and 38; the owner prefers the greyer look
      // to J88's undimmed name).
      const row = H.el("div", { class: "person" + (it.active ? "" : " inactive") }, kids);
      refs.rosterBox.appendChild(row);
    }
  }

  // `userId`: whose card this is — the adapter is asked about the change for THEM (J140: one bot per room asks who holds it).
  function rankSelect(currentLevel, onPick, userId) {
    const sel = H.el("select", { class: "rank-select" });
    const channels = Room.getChannels();
    H.RANKS().forEach(r => {
      // Which levels I may GRANT is the capability's call (rank strictly below mine);
      // isRankUnlocked is a structural fact (the room has that rank's channel yet).
      const d = Actions.describe("rank.assign", { userId: userId, targetRank: currentLevel, newLevel: r.level });
      if (!d.enabled && !d.permitted) return;                   // not yours to give: not listed
      if (!Room.isRankUnlocked(channels, r.level)) {           // its channels do not all exist yet: shown, not offered
        // NAMED AS EVERY RANK IS HERE (`H.rankName`): the top rung reads "Bot — upgrade the room first" (`ddjp_693`: the bot's
        // rung waits for the room's last upgrade).
        sel.appendChild(H.el("option", { value: String(r.level), disabled: "disabled" }, H.rankName(r.level) + " — upgrade the room first"));
        return;
      }
      // YOURS TO GIVE, NOT NOW (J140, the owner's: "turn unavailable and say bot already assigned"): shown, greyed, in the
      // adapter's words — the Bot choice while another account holds the bot's rank. The adapter decides; this only shows it.
      if (!d.enabled) {
        sel.appendChild(H.el("option", { value: String(r.level), disabled: "disabled" }, d.reason || r.name));
        return;
      }
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
    // Owner-only panel, and only in a room that HAS an upgrade path. Ask the descriptor with
    // retryAt:0 so the cooldown branch is bypassed — the panel's own status()/countdown below
    // still shows the cooldown to owners. A room built in one piece is refused here by the
    // descriptor's `avail`, and the slot stays EMPTY — the owner's ruling (bot-backend.md §9):
    // no note, no disabled button. Nothing in this file decides it.
    if (!Actions.describe("room.upgrade", { retryAt: 0 }).enabled) return;   // owner-only; has a path
    let st;
    try { st = RoomUpgrade.status(); } catch (e) { return; }
    if (!st) return;

    // A FULLY UPGRADED ROOM SAYS NOTHING HERE (the owner, ddjp_639): no "All ranks unlocked", and the empty slot takes no
    // space — `.upgrade-slot:empty` is not drawn (index.html), so the header's gap goes with it.
    if (st.currentBatch >= st.maxBatch) return;
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
    // (status-change re-render is wired once in `_wireMainOnce`, ui/screens.js)
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
    let ok = true, res = null;
    try {
      res = await Actions.perform("room.upgrade", { onProgress: (completed, total, label, waitUntil) => {
        if (completed == null) {
          if (waitUntil) {
            H.slowCountdown("upgrade-ratelimit", lbl, waitUntil);   // Matrix asked us to wait: said in place, orange (`ddjp_697`)
          } else {
            H.clearCountdown("upgrade-ratelimit");
            if (lbl.classList) lbl.classList.remove("slow-wait");
            lbl.textContent = label || "Waiting…";
          }
          return;
        }
        H.clearCountdown("upgrade-ratelimit");
        if (lbl.classList) lbl.classList.remove("slow-wait");
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
      // THE BOT'S LEVEL NOT CONFIRMED IN EVERY CHANNEL OF THE BATCH IS NAMED (the owner's, `ddjp_693`), as a rank change names
      // what did not land, and held long enough to be read; the batch itself is done (`RoomUpgrade.upgrade`'s answer).
      const bot = res && res.bot;
      const short = !!(bot && bot.ok === false);
      lbl.textContent = short ? "Done — the bot's level not confirmed: " + ((bot.failed || []).join(", ") || "unknown") : "Done";
      await new Promise(r => setTimeout(r, short ? H.UPGRADE_NOTE_PAUSE_MS() : H.UPGRADE_DONE_PAUSE_MS()));
    }
    renderUpgradePanel();
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    renderMyRank, ownPicture, renderJoinBtn, _wireCardTrigger, renderRoster, renderUpgradePanel,
    openUserCard, rankSelect, refreshUserCard,
  };
})();
