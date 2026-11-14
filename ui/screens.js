// ui/screens.js
// SCREENS AND ROOM LIST · MODALS — extracted from ui/interface.js at ddjp_394 as the eighth of
// the ten files roles.md §5 records.
//
// ── CUT LAST-BUT-ONE ON PURPOSE, AND THE REORDER IS MEASURABLE ───────────────────────────────
// `enterMainScreen` is a WIRING HUB: 164 lines calling sixteen render/build/wire functions across
// the roster, chat, DM, settings, feed, queue and player. Banner order would have cut it THIRD.
// Measured then: 24 reach-backs into eight clusters that had not moved. Measured now, after six
// of them landed: **NINE**. The fifteen that vanished are direct ui/ -> ui/ calls today instead of
// entries this file would have published and every later cut would have had to retire.
// **A wiring hub is cut after the things it wires** (roles.md §5).
//
// ── THE WHOLE PUBLIC SURFACE MOVED, SO `Interface` FORWARDS ──────────────────────────────────
// All eleven names `app.js` calls — `showScreen`, `enterMainScreen`, `renderRoomList` and the
// rest — are declared here now. They sat in `Interface`'s return as SHORTHAND, which cannot be
// re-pointed in place (the 51st signature), so that object holds FORWARDERS: the public surface
// keeps its shape while the code behind it moves. Arrows, so they bind at CALL time.
//
// Depends on: UIBase (and its `host`), Room, Chat, Playback, Queue, UserQueue, Reactions, Media,
// RoomUpgrade, ChatPrefs, Logger, and the other ui/ files at call time

const Screens = (() => {

  const { refs, _bg } = UIBase;   // room entry resets the background engine's room id
  const H = UIBase.host;

  // --- state and constants this cluster owns, moved out with it -------------
  const RECOVERY_COPY_REVERT_MS = 1500;  // same, for the recovery-key modal's copy button
  let _mainWired = false;      // the app's change subscriptions, made once per page (ddjp_472)
  let _chatPrefsWired = false;  // ChatPrefs load + onChange subscription happen once
  let _cryptoPollStarted = false;    // guard so the health poll is wired once
  let _roomsLocked = true;           // J139: the room list's lock — Leave shows only while it is open
  let _armedLeave = null;            // J139: the room whose owner's warning is showing in its row
  let _othersOpen = false;           // `ddjp_695`: the other-rooms line opened (Show); closed again when the room list is left
  let _othersArmed = false;
  let _othersAsk = null;              // `ddjp_696`: the space row whose Leave asks, "Leave <name> and the N rooms inside it you're in?"          // `ddjp_695`: Leave all's one question showing in the line

  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ SCREENS AND ROOM LIST
  //
  // showScreen, the room list, entering a room.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // --- Screens ---
  let _currentScreen = null;
  function showScreen(id) {
    if (PlaylistPanels.previewActive()) PlaylistPanels._closePreview();   // never leave a floating preview behind on navigation
    if (id !== "screen-rooms") { _roomsLocked = true; _armedLeave = null; _othersOpen = false; _othersArmed = false; _othersAsk = null; }   // J139: leaving the room list locks its Leave again, like DMs; `ddjp_695`: the other-rooms line closes
    ["screen-login", "screen-encryption", "screen-rooms", "screen-accounts", "screen-main"].forEach(s => {
      const elx = document.getElementById(s);
      if (elx) elx.style.display = "none";
    });
    const target = document.getElementById(id);
    if (target) target.style.display = "flex";
    _currentScreen = id;
  }

  // Wire live room-list updates exactly once. When Matrix reports a membership
  // or room change (new invite, a room joined elsewhere, etc.), re-render the
  // list — but only if the rooms screen is actually visible, so we never fight
  // with the main room screen or rebuild a hidden DOM. Also suppressed while a
  // creation/join is in progress: those operations create many channels in a
  // burst, each firing a Matrix Room event, which would otherwise repaint the
  // rooms screen on top of the creation progress bar.
  let _roomsLiveWired = false;
  let _roomListBusy = false;        // set true during create/join to pause live repaints
  function setRoomListBusy(v) { _roomListBusy = !!v; }
  // The room-list "Finish creating" card triggers this; app.js registers a
  // handler that drives the same create-progress flow as a fresh create. Keeps
  // the create orchestration in one place (the app shell) instead of the UI.
  let _resumeHandler = null;
  function setResumeHandler(fn) { _resumeHandler = (typeof fn === "function") ? fn : null; }
  function _wireLiveRoomList() {
    if (_roomsLiveWired) return;
    if (!Room.onRoomsChanged) return;
    Room.onRoomsChanged((scanned) => {
      if (_roomListBusy) return;
      if (_currentScreen === "screen-rooms") renderRoomList(scanned);
    });
    // REMOVED FROM THE ROOM ELSEWHERE (J83, the owner's E7): the room has already left itself; the screen follows it to the
    // lobby and says why.
    if (Room.onLeft) Room.onLeft(_onRoomLeft);
    // J139: a leave's progress redraws its own row in place; one at a time: the door's state greys what waits.
    if (Room.onLeaveJob) Room.onLeaveJob(_onLeaveJob);
    if (Room.onDoorChange) Room.onDoorChange(() => _reflectDoor());
    if (Room.onJoinJob) Room.onJoinJob(_onJoinJob);   // `ddjp_690`: Join Room's row, drawn at once and as it moves
    if (Room.onRepairJob) Room.onRepairJob(_onRepairJob);   // `ddjp_695`: a Repair's progress on its row
    try { if (typeof MatrixStatus !== "undefined" && MatrixStatus.onChange) MatrixStatus.onChange(_onStatus); } catch (e) {}   // `ddjp_697`
    _roomsLiveWired = true;
  }
  // A WAIT SAID WHERE IT HAPPENS (the owner's plan, part 3, `ddjp_697`): while Matrix asks us to wait, a leave's, a Repair's and a
  // join's line says so under it, orange, with the countdown (`H.slowWait`). The status piece's change redraws, in place, only
  // the rows whose job runs (`_runningRows`, filled as they are drawn) — and the list while a room is being joined — and only
  // when a countdown they could show has moved.
  const _runningRows = new Set();
  let _waitSigSeen = "";
  function _onStatus() {
    if (_currentScreen !== "screen-rooms") return;
    const sig = H.slowWaitSig ? H.slowWaitSig() : "";
    if (sig === _waitSigSeen) return;
    _waitSigSeen = sig;
    const joining = ((Room.joinJobs && Room.joinJobs()) || []).some((j) => j.state !== "failed");
    if (joining) { renderRoomList(Room.scanDDJPRooms()); return; }
    for (const k of Array.from(_runningRows)) { _runningRows.delete(k); _redrawRoomRow(k); }
  }
  // A REPAIR'S ROW (`ddjp_695`): its progress redraws the row in place; its start and end redraw the list (every other Repair waits
  // while one runs, and a room repaired leaves "Needs attention").
  const _repairSeen = Object.create(null);
  function _onRepairJob(spaceId) {
    if (_currentScreen !== "screen-rooms") return;
    const j = Room.repairJob ? Room.repairJob(spaceId) : null, st = j ? j.state : null;
    if (_repairSeen[spaceId] === st && st === "running" && _redrawRoomRow(spaceId)) return;
    _repairSeen[spaceId] = st;
    renderRoomList(Room.scanDDJPRooms());
  }
  function _onLeaveJob(spaceId) {
    if (_currentScreen !== "screen-rooms") return;
    const others = Room.OTHERS || "others";
    _redrawRoomRow(String(spaceId).indexOf(others + ":") === 0 ? others : spaceId);   // `ddjp_695`: one other room's leave redraws its line
  }
  function _onJoinJob() {
    if (_currentScreen !== "screen-rooms") return;
    renderRoomList(Room.scanDDJPRooms());
  }

  // ── JOIN ROOM, BY A ROOM'S ID: LIKE ACCEPTING AN INVITE (the owner's, `ddjp_690`: "well im thinking the room could appear int he
  // list and show progress isntead? as if you accepted an invite maybe?") ──────────────────────────────────────────────────────
  // The box's button joins the room only (`Room.joinById`, in its turn at the door) and opens nothing. At once a "Joining" section
  // at the top of the list shows the pasted ID with a greyed "Joining…", or what its turn waits for; done, the room is in the list
  // under its name; failed, the row says why and the ID stays in the box. An empty box gets a note. No window. Drawn from
  // `Room.joinJobs`; nothing here decides. Join Room is not greyed while the door is busy: a press waits its turn in its row.
  let _joinNote = "";       // the empty box's note, until the next press
  let _joinBoxWired = false;
  function _wireJoinBox() {
    if (_joinBoxWired) return;
    const b = (typeof document !== "undefined") ? document.getElementById("btn-join-room") : null;
    if (!b) return;
    b.onclick = () => { joinRoomById(); };
    _joinBoxWired = true;
  }
  function joinRoomById() {
    const box = (typeof document !== "undefined") ? document.getElementById("input-join-code") : null;
    const id = box ? String(box.value || "").trim() : "";
    if (!id) { _joinNote = "Paste a Space ID to join."; renderRoomList(Room.scanDDJPRooms()); return Promise.resolve({ ok: false, reason: "empty" }); }
    _joinNote = "";
    return Promise.resolve(Room.joinById(id)).then((r) => {
      if (r && r.ok && box && String(box.value || "").trim() === id) box.value = "";   // done: the box is free; failed: the ID stays
      return r;
    }, (e) => ({ ok: false, why: (e && e.message) || String(e) }));
  }
  function _joiningRow(j) {
    const name = H.el("span", { class: "room-invite-name", title: j.spaceId, text: j.spaceId });
    if (j.state === "failed") {
      // REJECTED (the owner's, `ddjp_691`: "reject non ddjp rooms"): left again in the same turn; a failed leave names the room.
      // A record that did not come in time is said plainly (the owner's "lets small fix", `ddjp_692`; `main/05-matrix.md`).
      const words = !j.rejected ? "Couldn't join (" + (j.why || "failed") + ")."
        : (j.leftAgain === false ? (j.unreadable ? "Couldn't check this room in time, and leaving it again failed: " : "That isn't a DDJP room, and leaving it again failed: ") + (j.name || j.spaceId) + " (" + (j.why || "failed") + ")."
          : (j.unreadable ? "Couldn't check this room in time, so the app left it. Try again." : "That isn't a DDJP room."));
      return H.el("div", { class: "room-invite-wrap" }, [H.el("div", { class: "room-item room-invite-row" }, [name]),
        H.el("p", { class: "room-invite-note", text: words })]);
    }
    // Accept's own look while it joins (`.room-accept-btn`, greyed): "Joining…", or what its turn waits for.
    const b = H.el("button", { class: "btn-primary room-accept-btn", text: (j.state === "waiting" && j.waitsFor) ? "Waits for: " + j.waitsFor : "Joining\u2026" });
    b.disabled = true;
    const row = H.el("div", { class: "room-item room-invite-row" }, [name, b]);
    const sw = (j.state === "running" && H.slowWait) ? H.slowWait("membership") : null;   // Matrix asked us to wait (`ddjp_697`)
    return sw ? H.el("div", { class: "room-invite-wrap" }, [row, sw]) : row;
  }

  // ── LEAVE A ROOM FOR GOOD, BEHIND ONE LOCK (J139; the owner's, `?v=605`: "yes lock protected and also shows progression") ──
  // The app's own square lock (`_panelLockBtn`) at the right of "Recent Rooms": locked, the list is today's; unlocked, a red
  // Leave at each room's right (beside Open on rooms you own). It stays open until clicked, and leaving this screen locks it
  // again, as DMs' does. On a room you own, Leave first shows the owner's warning IN THE ROW (`Room.leaveNotice` says whose
  // and which words), with "Leave anyway" and "Cancel" — no window. Then the row says how far the leave has got, with a bar,
  // and what failed, with "Leave again". All of it is drawn from `Room.leaveJob`; nothing here decides. (`_roomsLocked` and
  // `_armedLeave` are declared with this file's state, above, because `showScreen` reads them.)
  const _roomRows = Object.create(null);          // space id -> { el, build } for this render's rows, redrawn in place
  function _redrawRoomRow(spaceId) {
    const r = _roomRows[spaceId];
    if (!r || !r.el || !r.el.parentNode) return false;
    const fresh = r.build();
    r.el.parentNode.replaceChild(fresh, r.el);
    r.el = fresh;
    _reflectDoor();
    return true;
  }
  function _failedWords(failed) {
    const groups = [];
    for (const f of failed || []) {
      const g = groups[groups.length - 1];
      if (g && g.why === f.why) g.labels.push(f.label); else groups.push({ why: f.why, labels: [f.label] });
    }
    return groups.map((g) => g.labels.join(", ") + " (" + g.why + ")").join("; ");
  }
  function _ownerWarning(n) {
    return "You're the owner. " + (n && n.visibility === "public"
      ? "Join Room with its Space ID brings you back (as owner)."
      : "Only Staff or above still here can invite you back (as owner).") + " If nobody is left, the room is lost.";
  }

  // ── ONE AT A TIME (the owner's rule, `ddjp_689`): what the door is doing greys every join and leave button ─────────────
  // The rule is the bridge's (`MatrixBridge` `inTurn`); this only shows it: while one runs, every other Accept, Decline, Open,
  // Leave and Discard is greyed, its title naming what it waits for, and one line above the list says what runs. Join Room is
  // not (`ddjp_690`): a press waits its turn in its own row, under "Joining", saying what for.
  // A button's own reason to be greyed (its own act running, the lock) is kept beside the door's (`_gate`, `_gateOwn`).
  let _gated = [];
  let _doorNote = null;
  function _gate(btn) { btn._gateOwn = !!btn.disabled; btn._gateTitle = btn.title || ""; _gated.push(btn); return btn; }
  function _gateOwn(btn, v) { btn._gateOwn = !!v; _applyGate(btn, Room.doorState ? Room.doorState() : null); }
  function _applyGate(btn, d) {
    const busy = !!(d && d.busy);
    btn.disabled = !!btn._gateOwn || busy;
    btn.title = busy ? "Waits for: " + d.what : (btn._gateTitle || "");
  }
  function _reflectDoor() {
    const d = (Room.doorState ? Room.doorState() : null) || { busy: false };
    for (const b of _gated) _applyGate(b, d);
    const list = (typeof document !== "undefined") ? document.getElementById("room-list") : null;
    if (list && d.busy) {
      if (!_doorNote || _doorNote.parentNode !== list) { _doorNote = H.el("p", { class: "muted rooms-note" }); list.insertBefore(_doorNote, list.firstChild); }
      _doorNote.textContent = "One at a time: " + d.what + " — the others wait.";
    } else if (_doorNote) { if (_doorNote.parentNode) _doorNote.parentNode.removeChild(_doorNote); _doorNote = null; }
    try { if (ChatPanels.reflectDoor) ChatPanels.reflectDoor(d); } catch (e) {}
  }
  function _renderRoomsLock(any) {
    const slot = (typeof document !== "undefined") ? document.getElementById("rooms-lock") : null;
    if (!slot) return;
    H.clear(slot);
    if (!any) return;   // nothing behind it, so no lock — as DMs' with an empty list
    slot.appendChild(H._panelLockBtn(_roomsLocked,
      _roomsLocked ? "Locked — click to unlock Leave on each room" : "Unlocked — click to lock",
      () => { _roomsLocked = !_roomsLocked; _armedLeave = null; _othersAsk = null; renderRoomList(Room.scanDDJPRooms()); }));
  }
  function _onRoomLeft(info) {
    if (!info || !info.removed) return;
    _pendingJoinId = null;
    try { H._bgLeaveRoom(); } catch (e) {}
    setLobbyNote("You are no longer in " + (info.name || info.left) + " \u2014 it was closed on this tab.");
    showScreen("screen-rooms");
    renderRoomList(Room.scanDDJPRooms());
  }

  // ── A LINE ABOVE THE ROOM LIST (J83): why the tab is in the lobby when it did not go there itself — a reopen after a reload
  // that was refused, or a room this account was removed from. Cleared when a room is opened.
  let _lobbyNote = "";
  function setLobbyNote(text) { _lobbyNote = text || ""; }

  // ── THE DM PANEL, REACHABLE FROM THE LOBBY (J83, the owner's E3) ─────────────────────────────────────────────────────
  // DMs are bound at login (`app.js`), so the lobby's Messages button opens the same panel a room's DM tab shows.
  let _lobbyDMOpen = false;
  function _wireLobbyDM() {
    const b = (typeof document !== "undefined") ? document.getElementById("btn-lobby-dm") : null;
    if (b && !b._ddjpWired) { b._ddjpWired = true; b.onclick = () => toggleLobbyDM(); }
    try { ChatPanels._wireDMPanel(); ChatPanels._renderDMBadge(); } catch (e) {}
  }
  function toggleLobbyDM(open) {
    const host = (typeof document !== "undefined") ? document.getElementById("lobby-dm") : null;
    if (!host) return;
    _lobbyDMOpen = (typeof open === "boolean") ? open : !_lobbyDMOpen;
    host.style.display = _lobbyDMOpen ? "flex" : "none";
    if (_lobbyDMOpen) ChatPanels.openLobbyDM(host); else ChatPanels.closeLobbyDM();
  }

  // --- Rooms-screen identity (top-right, left of Log out) ---
  // Shows the viewer's OWN full Matrix ID, so they can read it from the room selector (e.g. to send to an owner for an invite)
  // without first entering a room; COPYING IT IS IN YOUR PICTURE'S MENU SINCE `ddjp_699` (its top row's ⧉, as in a room — the
  // owner's "move the top bar button to copy user name in the status under profile"), so this row's own copy button went.
  // This is a deliberate, scoped exception to the "display names only"
  // rule (docs/main/02-architecture.md / docs/main/07-security.md) — the main header no longer
  // shows the id as text: it is always the viewer's own id, never another user's. Reads
  // Room.getMyId at click time so it stays correct. Idempotent — safe to call
  // on every room-list render (the id doesn't change between renders).
  function renderRoomsIdentity() {
    const slot = document.getElementById("rooms-identity");
    if (!slot) return;
    H.clear(slot);
    const myId = Room.getMyId() || "";
    if (!myId) return;
    // YOUR PICTURE, BESIDE YOUR NAME (`ddjp_697`): the same ring and the same menu as in a room, without My Rank (no room is
    // open here); its upload note beside it.
    const pic = H.el("span", { class: "rooms-my-pic" }, [H.avatarEl(myId, 28)]);
    slot.appendChild(pic);
    Roster.ownPicture(pic, { rank: false });
    slot.appendChild(H.el("span", { id: "rooms-avatar-note", class: "rooms-avatar-note" }));
    slot.appendChild(H.el("span", { class: "my-id", title: myId, text: myId }));
  }

  // --- Room list (login → rooms) ---
  function renderRoomList(scanned) {
    _wireLiveRoomList();   // idempotent — sets up auto-refresh on first render
    _wireLobbyDM();        // J83: the Messages button and its unread dot
    _wireJoinBox();        // `ddjp_690`: Join Room by a room's ID
    renderRoomsIdentity(); // your picture and id, top-right of this screen (copying it: your picture's menu, `ddjp_699`)
    // ── THE SAVES SECTION IS NO LONGER ON THE SELECTOR (v273) ─────────────────────────────
    // It described "the room you last opened" — a permanent list on a screen whose whole subject
    // is a CHOICE between rooms, so it was always about a room other than the one being looked at.
    // It went with room files at J82 (the owner's ruling 1) — see OPEN, below.
    const list = document.getElementById("room-list");
    if (!list) return;
    H.clear(list);
    _gated = []; _doorNote = null;
    for (const k of Object.keys(_roomRows)) delete _roomRows[k];
    _runningRows.clear();
    if (_lobbyNote) list.appendChild(H.el("p", { class: "muted rooms-note", text: _lobbyNote }));
    // JOINING, AT THE TOP (`ddjp_690`): the empty box's note, then each room being joined by its ID.
    if (_joinNote) list.appendChild(H.el("p", { class: "muted rooms-note", text: _joinNote }));
    const joining = (Room.joinJobs && Room.joinJobs()) || [];
    if (joining.length) {
      list.appendChild(H.el("h3", { class: "room-section-title", text: "Joining" }));
      for (const j of joining) list.appendChild(_joiningRow(j));
    }

    const ownedRaw = (scanned && scanned.owned) || [];
    const joined = (scanned && scanned.joined) || [];
    const invited = (scanned && scanned.invited) || [];
    const unconfirmed = (scanned && scanned.unconfirmed) || [];

    // An interrupted creation (this or a prior session) — its half-built space
    // already shows up in `owned`, so pull it out and present it as a dedicated
    // "Finish creating" entry instead, to avoid a broken double-listing.
    const pending = (Room.pendingCreate && Room.pendingCreate()) || null;
    const owned = pending ? ownedRaw.filter(r => r.spaceId !== pending.spaceId) : ownedRaw;

    // LEFTOVER CHANNELS (`ddjp_691`): counted only once the client has its rooms (`Room.leftovers` answers null before); their Leave
    // is behind the same lock, so the lock is there when only they are.
    const lo = (Room.leftovers && Room.leftovers()) || null;
    const loCount = lo ? lo.count : 0;
    // OTHER MATRIX ROOMS (`ddjp_695`): counted once the client has its rooms (`Room.otherRooms` answers null before); their Leave is
    // behind the same lock, so the lock is there when only they are.
    const others = (Room.otherRooms && Room.otherRooms()) || null;
    const othersCount = others ? others.count : 0;
    _renderRoomsLock(owned.length + joined.length + loCount + othersCount > 0);
    if (!pending && owned.length === 0 && joined.length === 0 && invited.length === 0 && unconfirmed.length === 0) {
      if (!joining.length && !loCount && !othersCount) list.appendChild(H.el("p", { class: "muted", text: "No rooms yet — create one or join with a Space ID" }));
      setCreateRoomVisible(true);
      leftoverLine();
      otherLine();
      _reflectDoor();
      return;
    }
    setCreateRoomVisible(owned.length === 0);

    function section(title, rooms, builder) {
      if (rooms.length === 0) return;
      list.appendChild(H.el("h3", { class: "room-section-title", text: title }));
      rooms.forEach(room => list.appendChild(builder(room)));
    }

    // ── NEEDS ATTENTION, FIRST (the owner's plan, part 2, `ddjp_695`; his "1 yes", "2 yes" on the real room list) ───────────────────
    // A room with something wrong that this account can tell from what sync holds (`Room.needsAttention`, which decides): its name,
    // one plain reason in amber under it, and its buttons — Repair where this account may write the room's channel list (it works
    // LOCKED: it only adds), "Only its owner can repair it." elsewhere, and the room's own Leave behind the lock. A wrong mark is
    // Leave only. A room listed here is not listed again below.
    const attn = (Room.needsAttention && Room.needsAttention({ owned: owned, joined: joined })) || [];
    const inAttn = Object.create(null);
    for (const a of attn) inAttn[a.spaceId] = true;
    if (attn.length) {
      list.appendChild(H.el("h3", { class: "room-section-title", text: "Needs attention" }));
      for (const a of attn) {
        const entry = { el: null, build: () => attentionRow(a) };
        entry.el = entry.build();
        _roomRows[a.spaceId] = entry;
        list.appendChild(entry.el);
      }
    }

    if (pending) {
      list.appendChild(H.el("h3", { class: "room-section-title", text: "Finish creating" }));
      const row = H.el("div", { class: "room-item room-invite-row" });
      row.appendChild(H.el("span", { class: "room-invite-name",
        text: (pending.name || pending.spaceId) + " — interrupted (" + pending.built + "/" + pending.total + " channels)" }));
      const resumeBtn = H.el("button", { class: "btn-primary room-accept-btn", text: "Resume" });
      resumeBtn.onclick = () => {
        resumeBtn.disabled = true; resumeBtn.textContent = "Resuming…";
        if (_resumeHandler) _resumeHandler(pending);
        else Logger.warn("Interface: no resume handler registered");
      };
      const discardBtn = H.el("button", { class: "btn-secondary room-accept-btn", text: "Discard" });
      discardBtn.onclick = async () => {
        if (!window.confirm("Discard the half-built room \"" + (pending.name || pending.spaceId) + "\"? "
          + "This leaves its channels behind and can't be resumed afterward.")) return;
        resumeBtn.disabled = true; _gateOwn(discardBtn, true); discardBtn.textContent = "Discarding…";
        try { await Room.discardPendingCreate(); }
        catch (e) { Logger.warn("Discard failed: " + e.message); }
        renderRoomList(Room.scanDDJPRooms());
      };
      row.appendChild(resumeBtn);
      row.appendChild(_gate(discardBtn));   // a discard is a leave: one at a time
      list.appendChild(row);
    }

    // ── OPEN, BESIDE EACH OWNED ROOM ─────────────────────────────────────────────────────
    // An explicit button that opens the room, beside the row that does the same. (It had a sibling,
    // `Saves`, which opened the room on its saves list; room files were removed at J82, owner's
    // ruling 1, and the list and the button went with them.)
    function openButton(room) {
      const b = H.el("button", { class: "btn-secondary room-open-btn", text: "Open",
        title: "Open this room" });
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        openRoom(room);
      };
      return _gate(b);   // opening joins: one at a time
    }

    // ── A ROOM'S ROW (owned or joined), drawn from the lock and the room's leave (J139) ───────────────────────────────────
    // ── THE WRAPPER CARRIES THE LOOK; THE CHILD INHERITS IT ───────────────────────────────
    // `.room-item` is a themed row AND, one section down, a bare clickable button — one class in
    // two roles. When v270 wrapped it to add a second control, the wrapper kept the theme and the
    // inner `<button>` got only `flex`/`text-align`, so **the browser's default chrome won** and
    // the row rendered white. Same defect as `.dm-input` one release earlier, introduced by that
    // restructure.
    //
    // FIXED AT THE CAUSE RATHER THAN BY PATCHING ONE RULE: the WRAPPER is the row, so the
    // wrapper keeps the look and `.room-item-main` is declared as inheriting — transparent,
    // `color: inherit`, `font: inherit`, no border. The alternative (moving the theme onto the
    // child) would have left the wrapper unstyled and the Open button sitting outside the row's
    // background, which is the same defect one element over.
    // LOCKED, WITH NO LEAVE, A ROW IS TODAY'S: an owned room's wrapper with Open, a joined room one bare button. Unlocked, a red
    // Leave at its right. While a leave shows (the owner's warning, its progress, what failed), the frame (`.room-item`) holds
    // the row's line and the leave's line under it, borrowing `.room-invite-wrap`'s column.
    function roomRow(room, owned) {
      const job = Room.leaveJob ? Room.leaveJob(room.spaceId) : null;
      const showLeave = !_roomsLocked && !job && _armedLeave !== room.spaceId;   // a leave's own line carries its buttons
      const lines = leaveLines(room, job);
      if (!owned && !showLeave && !lines.length) {
        const btn = H.el("button", { class: "room-item" }, [room.name || room.spaceId]);
        btn.onclick = () => openRoom(room);
        return withWaiting(_gate(btn), room);
      }
      const row = H.el("div", { class: lines.length ? "room-with-open" : "room-item room-with-open" });
      const btn = H.el("button", { class: "room-item-main" }, [room.name || room.spaceId]);
      if (owned) btn.appendChild(H.el("span", { class: "room-badge-owner", text: "owner" }));
      btn.onclick = () => openRoom(room);
      row.appendChild(_gate(btn));
      if (owned) row.appendChild(openButton(room));
      if (showLeave) row.appendChild(leaveButton(room));
      if (!lines.length) return withWaiting(row, room);
      return withWaiting(H.el("div", { class: "room-item room-invite-wrap" }, [row].concat(lines)), room);
    }
    function leaveButton(room) {
      const b = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave", title: "Leave this room for good" });
      b.onclick = (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        if (_roomsLocked) return;
        const n = Room.leaveNotice ? Room.leaveNotice(room.spaceId) : null;
        if (n && n.owner) { _armedLeave = room.spaceId; _redrawRoomRow(room.spaceId); return; }   // the owner's warning, in the row
        Room.leaveForGood(room.spaceId);
      };
      return _gate(b);
    }
    // The line(s) under a row's name while its leave shows: the owner's warning, the progress and its bar, or what failed.
    function leaveLines(room, job, again0, words) {
      const againAct = again0 || (() => Room.leaveForGood(room.spaceId));   // a room's own, or the leftovers' (`ddjp_691`)
      const runningWords = (words && words.running) || ((j) => (j.resumed ? "Finishing the leave from last time… " : "Leaving… ") + j.done + " of " + j.total + " channels");
      // The words, and the buttons together at the line's right (`.dm-head-actions`, the DM panel's head group, borrowed); on a
      // narrow screen the buttons wrap under the words (`.room-leave-line`).
      const line = (text, cls, buttons) => H.el("div", { class: "room-invite-row room-leave-line" },
        [H.el("span", { class: cls || "enc-sub", text: text })].concat(buttons && buttons.length ? [H.el("span", { class: "dm-head-actions" }, buttons)] : []));
      const stop = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); };
      // Waiting for its turn says for what; a leave just asked for (no turn named yet) says it is leaving.
      if (job && job.state === "waiting") return [line(job.waitsFor ? "Waits for: " + job.waitsFor + "…" : (job.resumed ? "Finishing the leave from last time…" : "Leaving…"))];
      if (job && job.state === "running") {
        const fill = H.el("div", { class: "room-leave-fill" });
        fill.style.width = (job.total ? Math.round((job.done / job.total) * 100) : 0) + "%";
        const others = Room.OTHERS || "others";
        _runningRows.add(String(room.spaceId).indexOf(others + ":") === 0 ? others : room.spaceId);   // its wait redraws it (`ddjp_697`)
        const sw = H.slowWait ? H.slowWait("membership") : null;
        return [line(runningWords(job)), H.el("div", { class: "room-leave-track" }, [fill])].concat(sw ? [sw] : []);
      }
      if (job && job.state === "failed") {
        const again = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave again", title: "Finish leaving: only what is left is sent" });
        again.onclick = (ev) => { stop(ev); if (_roomsLocked) return; againAct(); };
        if (_roomsLocked) { again.disabled = true; again.title = "Locked — unlock (right of Recent Rooms) to leave"; }
        return [line("Left " + job.left + " of " + job.total + ". Couldn't leave: " + _failedWords(job.failed) + ".", "room-invite-note", [_gate(again)])];
      }
      if (_armedLeave === room.spaceId && !_roomsLocked) {
        const n = Room.leaveNotice ? Room.leaveNotice(room.spaceId) : null;
        const go = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave anyway" });
        go.onclick = (ev) => { stop(ev); if (_roomsLocked) return; _armedLeave = null; Room.leaveForGood(room.spaceId); };
        const no = H.el("button", { class: "btn-secondary room-open-btn", text: "Cancel" });
        no.onclick = (ev) => { stop(ev); _armedLeave = null; _redrawRoomRow(room.spaceId); };
        return [line(_ownerWarning(n), "enc-sub", [_gate(go), no])];
      }
      return [];
    }
    const listed = (owned) => (room) => {
      const entry = { el: null, build: () => roomRow(room, owned) };
      entry.el = entry.build();
      _roomRows[room.spaceId] = entry;
      return entry.el;
    };

    section("Your rooms", owned.filter((r) => !inAttn[r.spaceId]), listed(true));

    section("Joined rooms", joined.filter((r) => !inAttn[r.spaceId]), listed(false));

    // ── INVITATIONS: ACCEPT AND DECLINE WORK AS EXPECTED EVERYWHERE (J81; rulings 15 and 16) ──────────────────────────
    // A room invitation has Accept (it joins the room only — its channels are joined when you open it, D4) AND Decline
    // (which also declines the channel invitations waiting under it). "Invitations not confirmed" has Decline only. A
    // failure is said on the row, with its reason, and the buttons come back: never a stuck button, and a decline that
    // fails leaves the invite where it is.
    function inviteButtons(row, acts) {
      const note = H.el("span", { class: "room-invite-note muted", text: "" });
      const btns = acts.map((a) => _gate(H.el("button", { class: a.cls, text: a.label })));   // one at a time: greyed while another runs
      const lock = (v) => { for (const b of btns) _gateOwn(b, v); };
      acts.forEach((a, i) => {
        btns[i].onclick = async () => {
          lock(true); note.textContent = ""; btns[i].textContent = a.busy;
          let r = null, err = null;
          try { r = await a.run(); } catch (e) { err = e; }
          if (!err && !(r && r.ok === false)) { renderRoomList(Room.scanDDJPRooms()); return; }
          const why = err ? ((err && err.message) || String(err)) : ((r.failed && r.failed.join(", ")) || r.reason || "failed");
          Logger.warn("Interface: " + a.label.toLowerCase() + " failed — " + why);
          lock(false); btns[i].textContent = a.label;
          note.textContent = "could not " + a.label.toLowerCase() + ": " + why + " \u2014 it stays";
        };
        row.appendChild(btns[i]);
      });
      row.appendChild(note);
      return row;
    }

    section("Room invitations", invited, (room) => {
      const row = H.el("div", { class: "room-item room-invite-row" });
      row.appendChild(H.el("span", { class: "room-invite-name", text: room.name || room.spaceId }));
      inviteButtons(row, [
        { label: "Accept", busy: "Joining…", cls: "btn-primary room-accept-btn", run: () => Room.acceptInvite(room.spaceId) },
        { label: "Decline", busy: "Declining…", cls: "btn-secondary room-decline-btn", run: () => Room.declineInvite(room.spaceId) },
      ]);
      if (room.waiting && room.waiting.length) {
        const wrap = H.el("div", { class: "room-invite-wrap" }, [row]);
        wrap.appendChild(H.el("p", { class: "muted room-invite-waiting",
          text: "also waiting: " + room.waiting.join(", ") + " \u2014 joined when you open the room" }));
        return wrap;
      }
      return row;
    });

    // ── LEFTOVER CHANNELS FROM ROOMS YOU LEFT (the owner's, `ddjp_691`: "yes" to one line, "Leftover channels from rooms you left: 7",
    // with a Leave button behind the lock) ──────────────────────────────────────────────────────────────────────────────────────
    // Shown only when there are some, at the list's end: the count (`Room.leftovers`), and their leave by a room's own leave
    // (`Room.leaveLeftovers`, one implementation): through the door, its progress, what failed and "Leave again" in the line's
    // frame, as a room's row has them. A redraw of its own as it moves (`_onLeaveJob`). THEY LEAVE BY THEMSELVES (`ddjp_696`, JOB 2,
    // `Room.autoLeaveLeftovers`): the line shows that leave; its manual Leave is only Leave again, after a leave that failed.
    function leftoverLine() {
      const key = Room.LEFTOVERS || "leftovers";
      const build = () => {
        const job = Room.leaveJob ? Room.leaveJob(key) : null;
        const now = (Room.leftovers && Room.leftovers()) || null;
        const n = now ? now.count : 0;
        if (!n && !job) return H.el("span", { class: "room-leftover-none" });
        // While its leave shows (progress, what failed), the frame holds the line and the leave's lines under it, as a room's row.
        const lines = leaveLines({ spaceId: key }, job, () => Room.leaveLeftovers());
        const row = H.el("div", { class: lines.length ? "room-invite-row" : "room-item room-invite-row" },
          [H.el("span", { class: "room-invite-name", text: "Leftover channels from rooms you left: " + n })]);
        return lines.length ? H.el("div", { class: "room-item room-invite-wrap" }, [row].concat(lines)) : row;
      };
      if (!loCount && !(Room.leaveJob && Room.leaveJob(key))) return;
      const entry = { el: null, build: build };
      entry.el = build();
      _roomRows[key] = entry;
      list.appendChild(entry.el);
    }

    // ── A "NEEDS ATTENTION" ROW (`ddjp_695`): the room's name (it opens the room), one plain reason in amber under it, and its
    // buttons. REPAIR (`Room.repairRoom`) is not behind the lock — it only adds; while it runs, "Repairing… N of M channels" over
    // the leave's own bar (borrowed), and a failure says what, with "Repair again". One Repair at a time: another row's waits,
    // greyed, saying for what. Leave is the room's own (`leaveButton`, `leaveLines`), behind the lock.
    function attentionRow(a) {
      const room = { spaceId: a.spaceId, name: a.name };
      const job = Room.repairJob ? Room.repairJob(a.spaceId) : null;
      const leave = Room.leaveJob ? Room.leaveJob(a.spaceId) : null;
      const busy = Room.repairRunning ? Room.repairRunning() : null;
      const top = H.el("div", { class: "room-invite-row room-attn-top" });
      const nameBtn = H.el("button", { class: "room-item-main" }, [a.name]);
      if (a.owned) nameBtn.appendChild(H.el("span", { class: "room-badge-owner", text: "owner" }));
      nameBtn.onclick = () => openRoom(room);
      top.appendChild(_gate(nameBtn));
      const acts = [];
      const running = !!(job && (job.state === "running" || job.state === "waiting"));
      if (a.kind === "missing" && a.repair === "yes" && !running && !(job && job.state === "failed")) {
        const b = H.el("button", { class: "btn-secondary room-open-btn room-repair-btn", text: "Repair", title: "Make the channels this room should already have" });
        if (busy && busy.spaceId !== a.spaceId) { b.disabled = true; b.title = "Waits for: repairing " + busy.name; }
        b.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); Room.repairRoom(a.spaceId); };
        acts.push(b);
      }
      if (!_roomsLocked && !leave && _armedLeave !== a.spaceId && !running) acts.push(leaveButton(room));
      if (acts.length) top.appendChild(H.el("span", { class: "dm-head-actions room-attn-acts" }, acts));
      const lines = [H.el("p", { class: "room-invite-note room-attn-why", text: a.words })];
      if (a.kind === "missing" && a.repair === "owner") lines.push(H.el("p", { class: "muted room-invite-why room-attn-who", text: "Only its owner can repair it." }));
      if (job && job.state === "waiting") lines.push(H.el("p", { class: "enc-sub room-attn-line", text: job.waitsFor ? job.waitsFor + "…" : "Repairing…" }));
      if (job && job.state === "running") {
        const fill = H.el("div", { class: "room-leave-fill" });
        fill.style.width = (job.total ? Math.round((job.done / job.total) * 100) : 0) + "%";
        lines.push(H.el("p", { class: "enc-sub room-attn-line", text: "Repairing… " + job.done + " of " + job.total + " channel" + (job.total === 1 ? "" : "s") }));
        lines.push(H.el("div", { class: "room-leave-track" }, [fill]));
        _runningRows.add(a.spaceId);   // its wait redraws it (`ddjp_697`)
        const sw = H.slowWait ? H.slowWait("build") : null;
        if (sw) lines.push(sw);
      }
      if (job && job.state === "failed") {
        const again = H.el("button", { class: "btn-secondary room-open-btn room-repair-btn", text: "Repair again", title: "Make what is still missing" });
        if (busy && busy.spaceId !== a.spaceId) { again.disabled = true; again.title = "Waits for: repairing " + busy.name; }
        again.onclick = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); Room.repairRoom(a.spaceId); };
        lines.push(H.el("div", { class: "room-invite-row room-leave-line" }, [
          H.el("span", { class: "room-invite-note", text: "Repair stopped at " + job.done + " of " + job.total + " — couldn't make: " + _failedWords(job.failed) + "." }),
          H.el("span", { class: "dm-head-actions" }, [again])]));
      }
      for (const l of leaveLines(room, leave)) lines.push(l);
      return withWaiting(H.el("div", { class: "room-item room-invite-wrap room-attn-row" }, [top].concat(lines)), a);
    }

    // ── OTHER MATRIX ROOMS ON THIS ACCOUNT (`ddjp_695`; his "3 ok… i tought it would be nice if our app could clean them for us",
    // then "ok" to the closed line and the opened list) ── ONE LINE, LAST, CLOSED: "Other Matrix rooms on this account (not DDJP):
    // N" with Show, only when N > 0 (`Room.otherRooms`, the one classifier, decides). Opened: Hide and — the lock open — Leave all,
    // which asks once in the line; under it what is left out, then every room, quietest first, in a list that scrolls, each with
    // its words from sync (`Room.otherRoomWords`) and — the lock open — its own Leave. Leaves are the room list's one leave
    // (`Room.leaveOtherRooms`): the door, one at a time, paced, "Leaving 3 of 23…", what failed and "Leave again". Closed again
    // when the room list is left (`showScreen`); nothing kept on the device.
    function otherLine() {
      const key = Room.OTHERS || "others";
      const otherWords = { running: (j) => "Leaving " + j.done + " of " + j.total + "…" };
      const build = () => {
        const now = (Room.otherRooms && Room.otherRooms()) || null;
        const n = now ? now.count : 0;
        const job = Room.leaveJob ? Room.leaveJob(key) : null;
        if (!n && !job) return H.el("span", { class: "room-leftover-none" });
        const ids = now ? now.rooms.map((r) => r.roomId) : [];
        const stop = (ev) => { if (ev && ev.stopPropagation) ev.stopPropagation(); };
        const redraw = () => { renderRoomList(Room.scanDDJPRooms()); };
        const acts = [];
        if (!_othersOpen) {
          const show = H.el("button", { class: "btn-secondary room-open-btn room-other-show", text: "Show", title: "List them" });
          show.onclick = (ev) => { stop(ev); _othersOpen = true; redraw(); };
          acts.push(show);
        } else {
          const hide = H.el("button", { class: "btn-secondary room-open-btn room-other-hide", text: "Hide" });
          hide.onclick = (ev) => { stop(ev); _othersOpen = false; _othersArmed = false; redraw(); };
          acts.push(hide);
          if (!_roomsLocked && !job && !_othersArmed && n) {
            const all = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave all", title: "Leave every room listed here" });
            all.onclick = (ev) => { stop(ev); if (_roomsLocked) return; _othersArmed = true; redraw(); };
            acts.push(_gate(all));
          }
        }
        const head = H.el("div", { class: "room-invite-row room-other-head" },
          [H.el("span", { class: "room-invite-name", text: "Other Matrix rooms on this account (not DDJP): " + n }), H.el("span", { class: "dm-head-actions" }, acts)]);
        const parts = [head];
        if (_othersOpen && _othersArmed && !_roomsLocked && !job) {
          const go = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave all anyway" });
          go.onclick = (ev) => { stop(ev); if (_roomsLocked) return; _othersArmed = false; Room.leaveOtherRooms(ids, { all: true }); };
          const no = H.el("button", { class: "btn-secondary room-open-btn", text: "Cancel" });
          no.onclick = (ev) => { stop(ev); _othersArmed = false; redraw(); };
          parts.push(H.el("div", { class: "room-invite-row room-leave-line" },
            [H.el("span", { class: "enc-sub", text: "Leave all " + n + "? Some can't be rejoined without a new invite." }), H.el("span", { class: "dm-head-actions" }, [_gate(go), no])]));
        }
        for (const l of leaveLines({ spaceId: key }, job, () => Room.leaveOtherRooms(ids, { all: true }), otherWords)) parts.push(l);
        if (_othersOpen && n) {
          parts.push(H.el("p", { class: "muted room-invite-why room-other-intro", text: "Quietest first. Not listed: DDJP rooms, and your chats and invites (those are in Messages)." }));
          const rows = now.rooms.map((r) => {
            const rk = key + ":" + r.roomId;
            const rj = Room.leaveJob ? Room.leaveJob(rk) : null;
            const sub = (Room.otherRoomWords ? Room.otherRoomWords(r, now.now) : []).join(" · ");
            const words = H.el("div", { class: "room-other-words" }, [H.el("span", { class: "room-invite-name room-other-name", title: r.roomId, text: r.name })]
              .concat(sub ? [H.el("span", { class: "muted room-other-sub", text: sub })] : []));
            const line = H.el("div", { class: "room-invite-row room-other-row" }, [words]);
            // A SPACE WITH ROOMS INSIDE ASKS ONCE (`ddjp_696`, JOB 1): it is left with them — the rooms first, the space last.
            const inside = (r.space && typeof r.inside === "number") ? r.inside : 0;
            const asking = inside > 0 && _othersAsk === r.roomId && !_roomsLocked && !rj && !job;
            if (!_roomsLocked && !rj && !job && !asking) {
              const b = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave", title: inside ? "Leave this space and the rooms inside it" : "Leave this room" });
              b.onclick = (ev) => { stop(ev); if (_roomsLocked) return; if (inside > 0) { _othersAsk = r.roomId; redraw(); return; } Room.leaveOtherRooms([r.roomId]); };
              line.appendChild(_gate(b));
            }
            const rl = leaveLines({ spaceId: rk }, rj, () => Room.leaveOtherRooms([r.roomId]), otherWords);
            if (asking) {
              const go = H.el("button", { class: "btn-secondary room-open-btn room-leave-btn", text: "Leave anyway" });
              go.onclick = (ev) => { stop(ev); if (_roomsLocked) return; _othersAsk = null; Room.leaveOtherRooms([r.roomId]); };
              const no = H.el("button", { class: "btn-secondary room-open-btn", text: "Cancel" });
              no.onclick = (ev) => { stop(ev); _othersAsk = null; redraw(); };
              rl.push(H.el("div", { class: "room-invite-row room-leave-line room-other-ask" },
                [H.el("span", { class: "enc-sub", text: "Leave " + r.name + " and the " + inside + " room" + (inside === 1 ? "" : "s") + " inside it you're in?" }),
                 H.el("span", { class: "dm-head-actions" }, [_gate(go), no])]));
            }
            return rl.length ? H.el("div", { class: "room-invite-wrap room-other-item" }, [line].concat(rl)) : line;
          });
          parts.push(H.el("div", { class: "room-other-list" }, rows));
        }
        return H.el("div", { class: "room-item room-invite-wrap room-other" }, parts);
      };
      if (!othersCount && !(Room.leaveJob && Room.leaveJob(key))) return;
      const entry = { el: null, build: build };
      entry.el = build();
      _roomRows[key] = entry;
      list.appendChild(entry.el);
    }

    section("Invitations not confirmed", unconfirmed, (inv) => {
      const row = H.el("div", { class: "room-item room-invite-row room-unconfirmed-row" });
      row.appendChild(H.el("span", { class: "room-invite-name", text: "\u201c" + (inv.name || inv.roomId) + "\u201d" + (inv.from ? " from " + inv.from : "") }));
      inviteButtons(row, [
        { label: "Decline", busy: "Declining…", cls: "btn-secondary room-decline-btn", run: () => Room.declineInvite(inv.roomId) },
      ]);
      return H.el("div", { class: "room-invite-wrap" }, [row, H.el("p", { class: "muted room-invite-why", text: inv.why || "not confirmed" })]);
    });
    leftoverLine();
    otherLine();
    _reflectDoor();   // one at a time: what runs now greys the rest
  }
  // Under a joined room that is not running on this tab: how many verified channel invitations wait for its opening.
  function withWaiting(rowEl, room) {
    if (!room || !room.waiting) return rowEl;
    const wrap = H.el("div", { class: "room-invite-wrap" }, [rowEl]);
    wrap.appendChild(H.el("p", { class: "muted room-invite-waiting",
      text: room.waiting + " channel invitation" + (room.waiting === 1 ? "" : "s") + " waiting \u2014 accepted when you open it" }));
    return wrap;
  }
  function setCreateRoomVisible(visible) {
    const section = document.getElementById("create-room-section");
    if (section) section.style.display = visible ? "flex" : "none";
  }

  // ---------------------------------------------------------------------------
  // OPENING A ROOM — instant transition, then live.
  //
  // Joining replays the room's full history (back-paginating every channel),
  // which can take a moment. We don't want to block on that with the rooms list
  // still on screen, so we switch to the main screen immediately and show a
  // loading card for the room (its name is already known from the scan), then
  // run the join in the background and swap in the live room when it resolves.
  // ---------------------------------------------------------------------------
  let _pendingJoinId = null;   // spaceId currently loading, or null

  function showRoomLoading(room) {
    showScreen("screen-main");
    const main = document.getElementById("screen-main");
    if (!main) return;
    H.clear(main);

    const back = H.el("button", { class: "back-btn", text: "← Rooms" });
    back.onclick = () => {
      _pendingJoinId = null;   // the pending swap is cancelled...
      // ...AND THE OPENING WITH IT (J83, the owner's E8): before, the join finished in the background and the room ran,
      // unseen, with its bot. It stops at its next step now, and a room it had already switched to is left.
      Room.cancelOpening("back on the loading card");
      H._bgLeaveRoom();
      showScreen("screen-rooms");
      renderRoomList(Room.scanDDJPRooms());
    };

    // THE CARD SAYS HOW FAR THE OPENING HAS GOT (J141; the owner's): "Joining channels: N of M", the bar filling as each channel
    // answers (the bar's `steps` look), then "Loading songs and chat…" with the moving bar while the room loads — and, one at a
    // time, "Waiting: …" while its turn waits. Drawn from `Room.join`'s progress; nothing here decides.
    const fill = H.el("div", { class: "room-loading-bar-fill" });
    const word = H.el("p", { class: "muted", text: "Loading room…" });
    const card = H.el("div", { class: "room-loading" }, [
      H.el("h2", { class: "room-loading-title", title: room.spaceId || "", text: room.name || room.spaceId }),
      H.el("div", { class: "room-loading-bar-track" }, [fill]),
      word
    ]);

    main.appendChild(H.el("div", { class: "room-loading-screen" }, [back, card]));
    return { progress(p) {
      if (!p) return;
      if (p.step === "joining") {
        fill.className = "room-loading-bar-fill steps";
        fill.style.width = (p.total ? Math.round((p.done / p.total) * 100) : 100) + "%";
        word.textContent = "Joining channels: " + p.done + " of " + p.total;
        return;
      }
      fill.className = "room-loading-bar-fill"; fill.style.width = "";
      word.textContent = p.step === "waiting" ? "Waiting: " + (p.what || "its turn") + "…" : (p.step === "loading" ? "Loading songs and chat…" : word.textContent);
    } };
  }

  async function openRoom(room, opts) {
    const o = opts || {};
    _pendingJoinId = room.spaceId;
    if (!o.reopen) _lobbyNote = "";
    if (ChatPanels.lobbyDMOpen && ChatPanels.lobbyDMOpen()) toggleLobbyDM(false);
    const card = showRoomLoading(room);
    const shows = { onProgress: (p) => { if (card && card.progress && _pendingJoinId === room.spaceId) card.progress(p); } };
    try {
      // A REOPEN AFTER A RELOAD (J83, E1) goes through `Room.reopen`, which says so and, when refused, forgets the tab's room.
      await (o.reopen ? Room.reopen(room.spaceId, shows) : Room.join(room.spaceId, shows));
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      if (!(e && e.cancelled)) Logger.warn("Join failed: " + msg);
      if (_pendingJoinId !== room.spaceId) return;   // user already navigated away
      _pendingJoinId = null;
      if (o.reopen && !(e && e.cancelled)) _lobbyNote = "Could not reopen " + (room.name || room.spaceId) + " \u2014 " + msg;
      showScreen("screen-rooms");
      renderRoomList(Room.scanDDJPRooms());
      return;
    }
    // If the user hit back (or opened a different room) while we were loading,
    // don't yank them into this room.
    if (_pendingJoinId !== room.spaceId) return;
    _pendingJoinId = null;
    enterMainScreen(Room.getCurrent());
  }

  // AFTER A RELOAD (J83, the owner's E1): the room this tab was in, if it remembers one for this account, is opened again
  // through the same loading card. Answers whether there was one.
  function reopenAfterReload() {
    const sid = (Room.rememberedRoom && Room.rememberedRoom()) || null;
    if (!sid) return false;
    let name = sid;
    try {
      const sc = Room.scanDDJPRooms() || {};
      const hit = [].concat(sc.owned || [], sc.joined || []).find((r) => r && r.spaceId === sid);
      if (hit && hit.name) name = hit.name;
    } catch (e) { /* the id is the name */ }
    openRoom({ spaceId: sid, name: name }, { reopen: true });
    return true;
  }

  // ---------------------------------------------------------------------------
  // MAIN SCREEN — built programmatically so the UI owns its own layout.
  // ---------------------------------------------------------------------------
  // ── THE APP'S CHANGE SUBSCRIPTIONS, MADE ONCE (owner audit, ddjp_472) ─────────────────────────────
  // These were made in `enterMainScreen`, so every room entered added another copy — each registry kept
  // each new handler — and after N rooms every change redrew everything N times. Every handler reads the
  // CURRENT screen (`refs`, the modules), never the room it was made for, so one copy serves every room.
  function _wireMainOnce() {
    if (_mainWired) return;
    _mainWired = true;
    // Wire feature callbacks. Each one only re-renders the affected region.
    // renderActivePanel joins these because the activity list is folded from the LOG, so it is
    // stale the moment anything enters it — and Queue.onStateChange is the re-derive announcement,
    // which is the one signal that fires for every event that reached the fold.
    // The CHAT joins for exactly the same reason and through the same signal (ddjp_425): its feed
    // rows are folded from the same log, so anything that re-derives the room has already changed
    // them — and a re-derive can REMOVE a row as well as add one, when a late event turns an
    // accepted act into a refused one. `renderChat` re-reads the fold, and so does the Gear → Feed
    // panel (`Panels.renderFeedPanel`, ddjp_447).
    // The queue pane hears each room trigger by its source and redraws only what changed, if anything (J130, ui/queue.js
    // `roomEvent`, which holds which tab hears which).
    Queue.onStateChange(() => { Player.renderNowPlaying(); ChatPanels._syncNpButtons(); QueuePanels.roomEvent("queue"); _peopleRedraw(); ChatPanels.renderChat(); Panels.renderFeedPanel(); Roster.renderJoinBtn(); });
    Playback.onStateChange(Player.onPlaybackStateChange);
    // A deliberate hold must not look like a hang. Playback emits only on TRANSITIONS, so this
    // is not a poll — the advance path retries every tick and would otherwise fire constantly.
    Playback.onHoldChange((reason) => { H.reflectPlaybackHold(reason); });
    Chat.onMessage(ChatPanels.addChatMessage);
    Chat.onRedaction(ChatPanels.removeChatMessage);
    UserQueue.onChange(() => { QueuePanels.roomEvent("mine"); Roster.renderJoinBtn(); });
    // Song history wrote (J130's correction, `ddjp_662`): a song entering it — on a page's first room after the queue's
    // notice, or when a tab that was away is settled again — and the engine's own writes. History hears it (`_HEARS`).
    Queue.onHistoryChange(() => { QueuePanels.roomEvent("history"); });
    // My ★/▲ latch is derived from my own vote/add events on the spine. Those don't move
    // consensus state (the reducer ignores them), so the Queue.onStateChange render above
    // won't fire when they replay on reload — this re-presses the buttons when the latch
    // is (re)built from history, and on any live echo.
    if (typeof Reactions !== "undefined" && Reactions.onChange) {
      Reactions.onChange(() => { ChatPanels._syncNpButtons(); QueuePanels.roomEvent("reactions"); });
    }
    // A member joined, left or was removed (ddjp_471): the People tab and an open user card redraw.
    Room.onMembersChange(_peopleChanged);
    // ...and anything else the People tab shows (the owner's ruling 35: REP's numbers, in real time), once per burst.
    if (Room.onPeopleViewChange) Room.onPeopleViewChange(Panels.peopleViewChanged);
    // ...and the bot's own card (J117, `ddjp_630`): when what it shows moved, the panel redraws that card alone, while open.
    if (Room.onBotCardChange) Room.onBotCardChange(Settings.refreshRepCard);
    // A chat mapped after the room was wired (ddjp_621: joined late, or its mark read late): the panel re-resolves its tiers.
    if (Room.onChatTiersChanged) Room.onChatTiersChanged(() => ChatPanels.syncChatTier());
    // The Join button is here because its live/greyed state now comes from the room's join rule,
    // which reads MY rank — and a promotion is a power-level change, not a room event, so the
    // `Queue.onStateChange` render above never fires for it (`check-min-dj-rank` PART H5).
    Room.onRankChange(() => { Roster.renderMyRank(); Roster.renderJoinBtn(); _peopleChanged(); ChatPanels.syncChatTier(); ChatPanels._repaintChat(refs.chatBox); QueuePanels.roomEvent("rank"); Roster.renderUpgradePanel(); Settings.renderSettings(); });
    // Re-render avatar spots when a profile picture updates in real time.
    if (Media.onAvatarChange) Media.onAvatarChange((userId) => {
      const url = Media.getAvatarUrl ? Media.getAvatarUrl(userId) : null;
      // url may be null here on avatar REMOVAL — _applyUrl handles both: a real
      // URL swaps initials→img / updates src; null swaps img→initials.
      // Helper: update an existing avatar node in-place to match `url`.
      function _applyUrl(node) {
        if (!node) return;
        const sz = parseInt(node.style.width) || H.AVATAR_CSS_SIZE();
        if (!url) {
          // Avatar removed → revert to initials (only if currently an img).
          if (node.tagName === "IMG") {
            const fresh = H._initialsEl(userId, sz);
            fresh.style.cssText = node.style.cssText.replace(/object-fit:cover;?/, "");
            fresh.dataset.avatarFor = userId;
            node.replaceWith(fresh);
            return fresh;
          }
          return node;
        }
        if (node.tagName === "IMG") {
          if (node.src !== url) node.src = url;
          return node;
        } else {
          // Was an initials div — replace once with a real img, keep data-avatar-for
          const img = document.createElement("img");
          img.src = url;
          img.alt = H.shortName(userId);
          img.style.cssText = node.style.cssText;
          img.dataset.avatarFor = userId;
          img.onerror = () => { img.replaceWith(H._initialsEl(userId, parseInt(img.style.width) || H.AVATAR_CSS_SIZE())); };
          node.replaceWith(img);
          return img;
        }
      }
      // EVERY PICTURE OF THIS PERSON ON THE PAGE (`ddjp_700`): each carries `data-avatar-for` (`H.avatarEl`), so one sweep
      // reaches People's rows, chat's and the DM threads' rows, the DM list, the player's line, an open card, and your own picture
      // in the top bar, its menu and the room list. Before, chat, the DM box, the player's picture and your own were found one by
      // one, and People's rows and the DM list kept the old picture until they were drawn again.
      const nodes = (document && document.querySelectorAll) ? Array.from(document.querySelectorAll('[data-avatar-for="' + userId + '"]')) : [];
      for (const node of nodes) {
        const was = node;
        const now = _applyUrl(node) || node;
        if (refs.npAvatar === was && now !== was) refs.npAvatar = now;   // the player's line keeps its own node current
      }
    });
    if (RoomUpgrade.onStatusChange) RoomUpgrade.onStatusChange(() => Roster.renderUpgradePanel());
    if (Room.onSettingsChange) Room.onSettingsChange((s) => {
      // THE ROOM'S MAIN CHAT MAY HAVE MOVED (ddjp_425). `Room._applySettings` has already re-pointed
      // `Chat` through the one resolver before this listener runs; this re-reads the same resolution
      // for the box. A device following the room lands on the new main tier's OWN messages — a fresh
      // screen, never the old tier's rows under the new name, which is what the J12 repaint did —
      // and a device with an override stays where it is. Every tier's buffer survives either way.
      // Unconditional rather than keyed on `s.chat`: the sync is idempotent, and a compare against a
      // remembered value is one more copy of the room's state to keep true across room changes.
      ChatPanels.syncChatTier();
      Player._bgOnSetting(_bg.roomId, (s && s.bg) || null);   // react to a background link change (debounced)
      Settings.renderSettings();
    });

  }

  // People redraws only while it is on screen; it is drawn fresh when opened. An open user card always. Its TAB counts always
  // (`ddjp_702`): "People (N)", from the same fold, People shown or not.
  function _peopleRedraw() {
    if (H.rightTab() === "people") { Roster.renderRoster(); Panels.renderActivePanel(); }
    else Panels.labelPeopleTab();
  }
  function _peopleChanged() { _peopleRedraw(); Roster.refreshUserCard(); }

  function enterMainScreen(room) {
    if (ChatPanels.lobbyDMOpen && ChatPanels.lobbyDMOpen()) toggleLobbyDM(false);   // J83: the room's DM tab takes over
    showScreen("screen-main");
    const main = document.getElementById("screen-main");
    if (!main) return;
    H.clear(main);
    QueuePanels._resetStackScroll();   // a new room's queue starts at the top (scroll is preserved within a room)
    H.buildMainDom(main, room);

    _wireMainOnce();   // the change subscriptions — once per page, not once per room (ddjp_472)
    ChatPanels._wireDMPanel();   // J15 — the DM panel's own message + index listeners
    ChatPanels.renderDMPanel();  // paint the (usually empty) list and the badge on entry
    // Reflect the secure-chat banner now (crypto init has already run by the time we reach
    // the main screen) and keep it current with a light poll — crypto can recover (a retry
    // elsewhere) or lapse (token expiry) out of band, so the banner shouldn't be one-shot.
    H.reflectCryptoBanner();
    if (!_cryptoPollStarted) { _cryptoPollStarted = true; setInterval(() => { H.reflectCryptoBanner(); }, 5000); }
    // Start the room's chat (ddjp_425): bind the box to the resolver's channel, draw the go-forward
    // line for feed rows, and backfill the last few messages of EVERY readable tier — not only the
    // active one. It reads the resolution itself, so it no longer depends on the box's tier being
    // seeded first; that dependency is what filed the old one-shot backfill under `_active`.
    if (refs.chatBox) ChatPanels.startChat(refs.chatBox);
    Roster.renderMyRank();
    Player.renderNowPlaying();
    QueuePanels.renderQueuePanel();
    Roster.renderRoster();
    Panels.renderActivePanel();
    ChatPanels._renderChatPicker();
    Roster.renderUpgradePanel();
    Settings.renderSettings();
    Panels.renderLogs();
    if (!_chatPrefsWired) {
      ChatPrefs.load();
      // Restore the remembered layout choice now that prefs are loaded (per user,
      // device-local). Falls back to "wide" if none saved.
      try { H._setLayout(ChatPrefs.layout()); } catch (e) {}
      // A pref change re-renders the mounted chat (text <-> image/link) and the
      // settings panel itself (checkboxes / chips reflect the persisted state).
      // The bg toggle also lives in ChatPrefs, so re-apply the background here:
      // flipping "Room backgrounds" off unpaints immediately; on re-evaluates the
      // current room setting (may download).
      ChatPrefs.onChange(() => { ChatPanels._repaintChat(refs.chatBox); ChatPanels._renderChatPicker(); Settings.renderChatSettings(); Settings.renderSettings(); Player._bgApplyToggle(); Player._applyDisplayDims(); });
      _chatPrefsWired = true;
    }
    Player._applyDisplayDims();   // push the saved dim levels onto the CSS vars for this entry
    Settings.renderChatSettings();
    QueuePanels._renderGear();
    QueuePanels.renderRightPanel();
    Roster.renderJoinBtn();
    Player._bgEnterRoom(room && room.spaceId ? room.spaceId : (Room.getCurrent() || {}).spaceId || null);
    Player.initSongPlayer();
  }


  // ══ MODALS
  //
  // Encryption recovery key entry, reset, save, and the account picker.
  // ────────────────────────────────────────────────────────────────────────────────────────

  // ===== Encryption / recovery-key screens (Topic 2) =====
  // Render into #screen-encryption. These never touch the SDK — app.js passes
  // callbacks that do the MatrixAccount work; these methods collect input, enforce
  // the save/understanding gates, and surface errors.

  function _encMount(node) {
    const host = document.getElementById("screen-encryption");
    if (!host) return;
    H.clear(host);
    host.appendChild(node);
    showScreen("screen-encryption");
  }

  // "Enter your recovery key" — the normal path for an account set up in Element.
  // onUnlock(key) resolves on success (and transitions away) or throws on a bad key.
  // onForgot() routes to the reset-understanding gate. onLogout() is the escape hatch.
  function showEnterRecoveryKey({ onUnlock, onForgot, onLogout }) {
    // type=password so the key is masked (dots), not shown in the clear.
    const input = H.el("input", { type: "password", class: "enc-input", placeholder: "Recovery key (e.g. EsTc ABCD …)" });
    const err = H.el("p", { class: "enc-error" });
    const btn = H.el("button", { class: "btn-primary", text: "Unlock" });
    btn.onclick = async () => {
      err.textContent = "";
      // Guard the empty key: a stray Enter carried over from the login screen (or a
      // too-fast Enter before typing) must NOT submit a blank key — that could resolve
      // the encryption gate with nothing entered and skip the step entirely.
      if (!input.value || !input.value.trim()) { err.textContent = "Enter your recovery key first."; return; }
      btn.disabled = true; btn.textContent = "Unlocking…";
      try { await onUnlock(input.value); }
      catch (e) { err.textContent = (e && e.message) || "Couldn't unlock."; btn.disabled = false; btn.textContent = "Unlock"; }
    };
    input.onkeydown = (e) => { if (e.key === "Enter") btn.click(); };
    const forgot = H.el("button", { class: "enc-link", text: "I don't have my recovery key" });
    forgot.onclick = () => onForgot();
    const logout = H.el("button", { class: "enc-link enc-link-muted", text: "Log out" });
    logout.onclick = () => onLogout && onLogout();
    _encMount(H.el("div", { class: "enc-box" }, [
      H.el("h2", { text: "Unlock encrypted messages" }),
      H.el("p", { class: "enc-sub", text: "Enter the recovery key you saved when you set up your account in Element. This verifies this device and restores your encrypted message history." }),
      input, err, btn,
      H.el("div", { class: "enc-divider" }),
      forgot, logout,
    ]));
    setTimeout(() => input.focus(), 0);
  }

  // Gate A — understanding that resetting is destructive. Continue stays disabled
  // until both acknowledgements are ticked. onConfirm() proceeds to create a new key.
  function showResetWarning({ onConfirm, onBack }) {
    const ack1 = H.el("input", { type: "checkbox", class: "enc-check" });
    const ack2 = H.el("input", { type: "checkbox", class: "enc-check" });
    const cont = H.el("button", { class: "btn-primary", text: "Create a new recovery key", disabled: true });
    const refresh = () => { cont.disabled = !(ack1.checked && ack2.checked); };
    ack1.onchange = refresh; ack2.onchange = refresh;
    cont.onclick = () => onConfirm();
    const back = H.el("button", { class: "btn-secondary", text: "Go back" });
    back.onclick = () => onBack();
    _encMount(H.el("div", { class: "enc-box enc-box-wide" }, [
      H.el("h2", { text: "Create a new recovery key?" }),
      H.el("p", { class: "enc-sub", text: "Do this only if you genuinely cannot find your existing recovery key. Check Element and your password manager first — the old key cannot be recovered once you replace it." }),
      H.el("label", { class: "enc-ack" }, [ack1, H.el("span", { text: "I understand that creating a new key permanently replaces my old one, and any encrypted messages that only the old key could unlock will become unreadable." })]),
      H.el("label", { class: "enc-ack" }, [ack2, H.el("span", { text: "I understand this affects encrypted messages only — my account, my rooms, and my ownership are not affected — and that I should look for my existing key before continuing." })]),
      cont, back,
    ]));
  }

  // Gate B — show the new key; require both the saved-it checkbox and a correct
  // re-entry before committing. confirmMatch(typed) checks the re-entry locally;
  // onConfirm() commits. onBack is optional (omitted on first-time setup).
  function showSaveNewKey({ recoveryKey, confirmMatch, onConfirm, onBack }) {
    const keyBox = H.el("div", { class: "enc-key", text: recoveryKey });
    const copy = H.el("button", { class: "btn-secondary", text: "Copy" });
    copy.onclick = () => { try { navigator.clipboard.writeText(recoveryKey); copy.textContent = "Copied"; setTimeout(() => copy.textContent = "Copy", RECOVERY_COPY_REVERT_MS); } catch (e) {} };
    const saved = H.el("input", { type: "checkbox", class: "enc-check" });
    const reentry = H.el("input", { type: "text", class: "enc-input", placeholder: "Type your recovery key again to confirm" });
    const err = H.el("p", { class: "enc-error" });
    const cont = H.el("button", { class: "btn-primary", text: "Confirm & continue", disabled: true });
    const refresh = () => { cont.disabled = !(saved.checked && reentry.value.trim().length > 0); };
    saved.onchange = refresh; reentry.oninput = refresh;
    cont.onclick = async () => {
      err.textContent = "";
      if (!confirmMatch(reentry.value)) { err.textContent = "That doesn't match the key above. Check and try again."; return; }
      cont.disabled = true; cont.textContent = "Setting up…";
      try { await onConfirm(); }
      catch (e) { err.textContent = (e && e.message) || "Couldn't finish setup."; cont.disabled = false; cont.textContent = "Confirm & continue"; }
    };
    const children = [
      H.el("h2", { text: "Save your recovery key" }),
      H.el("p", { class: "enc-sub", text: "This is the only way to unlock your encrypted messages on another device or after logging out. Save it in a password manager now — it won't be shown again." }),
      keyBox, copy,
      H.el("label", { class: "enc-ack" }, [saved, H.el("span", { text: "I have saved my recovery key somewhere safe." })]),
      reentry, err, cont,
    ];
    if (onBack) { const back = H.el("button", { class: "enc-link", text: "Back" }); back.onclick = () => onBack(); children.push(back); }
    _encMount(H.el("div", { class: "enc-box enc-box-wide" }, children));
  }

  // --- Manage accounts (multi-account picker) ---
  // Lists known accounts with the active one badged; non-active accounts can be
  // switched to (or signed into, if their session was cleared) or forgotten. All
  // side effects run through the passed-in handlers (the app shell owns the bridge
  // + store calls) — this view only builds DOM, per the UI/storage boundary.
  // shape: showAccounts({ accounts:[{userId,homeserver}], activeUserId,
  //   hasSession(userId)->bool, onSwitch(userId), onForget(userId), onAdd(), onBack() })
  function showAccounts(opts) {
    opts = opts || {};
    const screen = document.getElementById("screen-accounts");
    if (!screen) return;
    H.clear(screen);

    const rows = (opts.accounts || []).map((a) => {
      const isActive = a.userId === opts.activeUserId;
      const left = H.el("div", { class: "acct-id" }, [
        H.el("span", { class: "my-id", title: a.userId, text: a.userId }),
        isActive ? H.el("span", { class: "acct-badge", text: "Active" }) : null,
      ]);
      const actions = H.el("div", { class: "acct-actions" });
      if (!isActive) {
        const signedIn = opts.hasSession ? opts.hasSession(a.userId) : true;
        const sw = H.el("button", { class: "btn-secondary", text: signedIn ? "Switch" : "Sign in" });
        sw.onclick = () => { sw.disabled = true; opts.onSwitch && opts.onSwitch(a.userId); };
        const forget = H.el("button", { class: "enc-link enc-link-muted", text: "Forget" });
        forget.onclick = async () => {
          if (!confirm("Forget " + a.userId + " on this browser? This removes its local data and encryption keys here. Encrypted history will need the recovery key to restore if you sign in again.")) return;
          forget.disabled = true; forget.textContent = "Forgetting…";
          try { opts.onForget && await opts.onForget(a.userId); } catch (e) {}
        };
        actions.appendChild(sw); actions.appendChild(forget);
      }
      return H.el("div", { class: "acct-row" }, [left, actions]);
    });

    const add = H.el("button", { class: "btn-primary", text: "Add account" });
    add.onclick = () => opts.onAdd && opts.onAdd();
    const back = H.el("button", { class: "btn-secondary", text: "Back" });
    back.onclick = () => opts.onBack && opts.onBack();

    screen.appendChild(H.el("div", { class: "accounts-wrap" }, [
      H.el("div", { class: "accounts-head" }, [H.el("h2", { text: "Accounts" }), back]),
      H.el("p", { class: "enc-sub", text: "Each account keeps its own separate storage and encryption on this browser." }),
      H.el("div", { class: "accounts-list" }, rows.length ? rows : [H.el("p", { class: "muted", text: "No accounts yet." })]),
      add,
    ]));
    showScreen("screen-accounts");
  }


  // ────────────────────────────────────────────────────────────────────────────────────────
  // ══ EXPORTS
  // ────────────────────────────────────────────────────────────────────────────────────────

  return {
    showScreen, renderRoomList, setCreateRoomVisible, enterMainScreen,
    showEnterRecoveryKey, showResetWarning, showSaveNewKey, showAccounts,
    setRoomListBusy, setResumeHandler, openRoom,
    reopenAfterReload, setLobbyNote, toggleLobbyDM,   // J83
  };
})();
