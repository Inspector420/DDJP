// tests/check-owner-screens.js
// SUBJECT: ui/chat.js, ui/shell.js, ui/queue.js, ui/panels.js, ui/playlists.js, ui/roster.js, features/chat.js, core/chatprefs.js, index.html
// WALL: J118 — THE OWNER'S SCREEN DECISIONS AT `ddjp_635` HOLD, ON THE SCREEN THE REAL CODE BUILDS.
//
//   PART A — DMs: the app's own lock and "Clear list" side by side on the "Direct messages" line, one style and one
//            height; behind the lock, Clear list and a ✕ that forgets one conversation on this device; no empty text.
//   PART B — Feed: the head no longer says "What has happened since you opened this room"; what is left out is said.
//   PART C — Room queue: no head row; the lock at the far right of the box's "Now Playing" line, Reset left of
//            "Now Playing" and shown only while unlocked; the moderation controls HIDDEN while locked; the box
//            always there, "Nothing" when nothing plays (the owner, `ddjp_637`); still timed; nothing for a viewer
//            who cannot moderate.
//   PART D — My queue: the lock hides only each row's ✕. "✕ Clear" on the add line, left of Add, it and its ✔ the height
//            of Add and the lock; no count line, no list head, no "Your queue is empty" (the owner, `ddjp_637`).
//   PART E — History: no "N songs — the whole room"; the partial wording stays (the owner's keep).
//   PART F — Phone: "Room Q" and "My Q", decided by the layout selector the tree already has.
//   PART G — Logs: Bot status, History audit and Copy log on their own line, under level, category and count; the three
//            one height (`ddjp_637`).
//   PART H — Playlists: "Import / Export" is a button like Create, on its line, and grey — RIGHT of Create (the owner,
//            `ddjp_639`; it was left of it); an empty library says nothing (the owner, `ddjp_636`). Inside a playlist,
//            "＋ All to Q" takes two steps: a green ✔ square left of it, the red confirm squares' kind at the line's 30 px,
//            and only the ✔ adds; disarmed by what disarms the delete confirm; not behind the lock (`ddjp_639`).
//   PART I — the header: a fully upgraded room says nothing where the upgrade sits, and the slot takes no space
//            (the owner, `ddjp_639`).
//
// DRIVEN, NOT READ. `tests/_screen-world.js` loads all eleven ui/ files WHOLE and builds the main screen with their
// own `buildMainDom`, so no region is extracted by name and none can make this refuse by being reshaped. What a
// person sees is asked of the stylesheet the page ships (`index.html`), through the harness's small cascade — it
// answers DECLARED values in the static state and knows nothing of layout, which a browser was used for instead.
// PART A's forgetting is driven a second time through the REAL `Chat` and `ChatPrefs` (`tests/_chat-world.js`).
//
// Every part builds its own world, and every part states its premise before its rows: a part whose premise fails
// FAILS by name. Nothing here is skipped, so nothing here can pass by not running.

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const S = require("./_screen-world.js");
const CW = require("./_chat-world.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[owner-screens] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
function part(name, fn) {
  try { fn(); } catch (e) { failed++; console.log("[owner-screens] FAIL — " + name + " threw: " + String(e && e.stack || e).split("\n").slice(0, 3).join(" | ")); }
}

const NOW = 1.9e12;
// The room's data, as the feature layer under ui/ would answer it. Only DATA is scripted; the code that draws it
// is the tree's own.
function screen(o) {
  const st = Object.assign({
    playing: { dj: "@dj:hs", song: { videoId: "ccccccccccc" } },
    rotation: [{ user: "@ann:hs", pending: [{ videoId: "aaaaaaaaaaa" }] }, { user: "@bob:hs", pending: [{ videoId: "bbbbbbbbbbb" }] }],
    moderate: true,
    mine: [{ videoId: "eeeeeeeeeee" }, { videoId: "fffffffffff" }, { videoId: "ggggggggggg" }],
    history: [{ videoId: "ddddddddddd", dj: "@dj:hs", at: NOW - 60000, pi: "p1" }],
    reach: { entries: 40, complete: true },
    feed: { rows: [{ verb: "joined the DJ queue", ts: NOW - 1000, sender: "@ann:hs", eventId: "$1" }], truncated: false, refused: 0 },
    convs: [{ userId: "@zoe:hs", roomIds: ["!dm1:hs", "!dm2:hs"], roomId: "!dm1:hs", lastTs: NOW - 5000, unread: false },
            { userId: "@yan:hs", roomIds: ["!dm3:hs"], roomId: "!dm3:hs", lastTs: NOW - 9000, unread: false }],
    innerWidth: 1400,
  }, o || {});
  const calls = [];
  const rec = (name, ret) => function () { calls.push({ f: name, args: Array.from(arguments) }); return typeof ret === "function" ? ret.apply(null, arguments) : ret; };
  const features = {
    Room: { rankLadder: () => [], getMyId: () => "@me:hs", getRoster: () => [], recentEvents: () => st.feed, FEED_KINDS: {},
            scanDDJPRooms: () => [], historyAudit: rec("Room.historyAudit") },
    Queue: { getNowPlaying: () => st.playing, getRotation: () => st.rotation, lastStrikeTs: () => 0, STRIKE_COOLDOWN_MS: 3000,
             recentHistory: () => st.history, historyReach: () => st.reach, getState: () => ({ counts: {} }) },
    UserQueue: { items: () => st.mine.slice(), count: () => st.mine.length, slotState: () => null, isActive: () => false, stackCount: () => 0,
                 moveUp: rec("UserQueue.moveUp"), moveDown: rec("UserQueue.moveDown"), moveToTop: rec("UserQueue.moveToTop"),
                 moveToBottom: rec("UserQueue.moveToBottom"), removeAt: rec("UserQueue.removeAt"), clearQueue: rec("UserQueue.clearQueue"),
                 add: () => ({ ok: true }) },
    Actions: { describe: () => ({ enabled: !!st.moderate, reason: st.moderate ? null : "Not permitted" }), perform: rec("Actions.perform", Promise.resolve({ ok: true })) },
    Chat: { conversations: () => st.convs.slice(), dmUnreadCount: () => 0, clearConversations: rec("Chat.clearConversations"),
            forgetConversation: rec("Chat.forgetConversation"), openDMRoom: rec("Chat.openDMRoom", { ok: false, reason: "gone" }),
            setDMVisible: () => {}, closeDM: () => {}, dmAnswering: () => false },
    ChatPrefs: { layout: () => "wide", setLayout: () => {}, videoHidden: () => false, overlayBlocked: () => false },
    Playlists: { list: () => (st.playlists || []).slice(), create: () => Promise.resolve({ ok: true }),
                 get: (id) => Promise.resolve({ id, name: "Mine", tracks: [] }),
                 exportPrepare: () => new Promise(() => {}),   // the window's export pane, still preparing (H's control)
                 addWholeToQueue: rec("Playlists.addWholeToQueue", () => Promise.resolve({ ok: true, added: 2, skipped: 0 })) },
    RoomUpgrade: { isRunning: () => false, status: () => st.upgrade || null },
    ServerClock: { serverNow: () => NOW },
    Metadata: { get: () => null, cached: () => null },
  };
  const w = S.world({ features });
  w.sb.innerWidth = st.innerWidth;
  w.H.buildMainDom(w.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  w.st = st; w.calls = calls;
  w.q = (sel, root) => (root || w.main).querySelector(sel);
  w.qa = (sel, root) => (root || w.main).querySelectorAll(sel);
  w.btn = (re, root) => w.qa("button", root).find((b) => re.test(b.textContent)) || null;
  w.shown = (n) => w.cas.shown(n, w.main);
  w.decl = (n, prop) => { const d = n ? w.cas.declared(n, prop) : null; return d ? d.val : null; };
  w.called = (f) => calls.filter((c) => c.f === f);
  return w;
}

// ═══ PART A — DMs ═══════════════════════════════════════════════════════════════════════════════════════════════
part("A", () => {
  const w = screen();
  w.refs.tabDM.click();
  const box = w.refs.dmBox;
  const rows = () => w.qa(".dm-row", box);
  ok(rows().length === 2 && /@zoe:hs/.test(rows()[0].textContent), "A PREMISE — the DM list drew the two conversations it was given", rows().map((r) => r.textContent));
  const head = w.q(".dm-head", box);
  const lock = () => w.q(".dm-head .panel-lock-btn", box);
  const clear = () => w.btn(/^Clear list$/, w.q(".dm-head", box));
  ok(!!lock() && /🔒/.test(lock().textContent) && /\blocked\b/.test(lock().className),
    "A: THE \"DIRECT MESSAGES\" LINE CARRIES THE APP'S OWN LOCK — `_panelLockBtn`'s square, and it opens locked (the owner, ddjp_635)",
    head && head.children.map((c) => c.className + ":" + c.textContent));
  ok(!!clear(), "A: and Clear list beside it", head && head.textContent);
  const L = lock(), C = clear();
  // The lock's own style is its UNLOCKED one; locked, it turns red, which is the lock's state and not a style to copy.
  const sameAs = (c, l) => ["height", "background", "color", "border", "border-radius", "box-sizing"].map((p) => [p, w.decl(c, p), w.decl(l, p)]);
  if (L && C) {
    ok(L.parent === C.parent && C.nextSibling === L, "A: SIDE BY SIDE — Clear list, then the lock at the right", L.parent && L.parent.children.map((c) => c.textContent));
    ok(w.decl(C, "height") !== null && w.decl(C, "height") === w.decl(L, "height") && !/\bmini\b/.test(C.className),
      "A: THE SAME HEIGHT AS THE LOCK — Clear list is not a `mini` any more", [w.decl(C, "height"), w.decl(L, "height"), C.className]);
  }
  ok(C && C.disabled === true, "A: WHILE LOCKED, CLEAR LIST CANNOT BE USED", C && { disabled: C.disabled });
  if (C) { C.disabled = false; C.click(); }   // even a click that reaches it forgets nothing
  ok(w.called("Chat.clearConversations").length === 0, "A: and a click that reaches it forgets nothing", w.calls);
  ok(rows().every((r) => !w.btn(/✕/, r)), "A: WHILE LOCKED, NO CONVERSATION CARRIES A ✕ — it is behind the lock", rows().map((r) => r.textContent));
  if (lock()) lock().click();
  ok(lock() && !/\blocked\b/.test(lock().className) && clear() && clear().disabled === false, "A: one click unlocks the line", lock() && lock().className);
  const same = lock() && clear() ? sameAs(clear(), lock()) : null;
  ok(same && same.every(([, a, b]) => a !== null && a === b),
    "A: THE SAME STYLE — Clear list takes the lock's own declaration (the owner, ddjp_635)", same);
  const xs = rows().map((r) => w.btn(/✕/, r));
  ok(xs.length === 2 && xs.every((x, i) => x && rows()[i].lastElementChild === x),
    "A: UNLOCKED, EACH CONVERSATION CARRIES A ✕ AT ITS RIGHT (the owner, ddjp_635)", rows().map((r) => r.children.map((c) => c.className)));
  if (xs[0]) xs[0].click();
  const f = w.called("Chat.forgetConversation");
  ok(f.length === 1 && JSON.stringify(f[0].args[0]) === JSON.stringify(["!dm1:hs", "!dm2:hs"]),
    "A: THE ✕ FORGETS THAT ONE CONVERSATION — every room of that person, and no other", f);
  ok(w.called("Chat.openDMRoom").length === 0, "A: and does not open the conversation it sits on", w.calls.map((c) => c.f));
  ok(w.timers.every((t) => t.ms !== 5000), "A: THE DM LOCK STAYS OPEN UNTIL CLICKED — unlocking arms no timer (a choice made for the owner)", w.timers.map((t) => t.ms));
  w.refs.tabChat.click(); w.refs.tabDM.click();
  ok(lock() && /\blocked\b/.test(lock().className) && rows().every((r) => !w.btn(/✕/, r)),
    "A: LEAVING THE PANEL LOCKS IT AGAIN, like every lock without a timer", lock() && lock().className);
  if (lock()) lock().click();
  const clearsBefore = w.called("Chat.clearConversations").length;
  if (clear()) clear().click();
  ok(w.called("Chat.clearConversations").length === clearsBefore + 1, "A CONTROL: unlocked, Clear list forgets the list, as before", w.calls.map((c) => c.f));
  // A REQUEST WITH NO CONVERSATION has nothing on this device to forget; Refuse is how it is answered.
  const w2 = screen({ convs: [{ userId: "@req:hs", roomIds: [], roomId: null, lastTs: NOW, unread: true, request: true, invites: [] }] });
  w2.refs.tabDM.click();
  const L2 = w2.q(".dm-head .panel-lock-btn", w2.refs.dmBox); if (L2) L2.click();
  const r2 = w2.q(".dm-row", w2.refs.dmBox);
  ok(r2 && !w2.btn(/✕/, r2), "A: a request with no conversation yet carries no ✕ — there is nothing on this device to forget", r2 && r2.textContent);
  // EMPTY: nothing is said, and with nothing behind them there is no Clear list and no lock.
  const w3 = screen({ convs: [] });
  w3.refs.tabDM.click();
  const b3 = w3.refs.dmBox;
  ok(!/No conversations yet/.test(b3.textContent) && w3.qa(".dm-list p", b3).length === 0,
    "A: THE EMPTY LIST SAYS NOTHING — \"No conversations yet…\" is gone (the owner, ddjp_635)", b3.textContent);
  ok(!w3.q(".dm-head .panel-lock-btn", b3) && !w3.btn(/Clear list/, b3) && !!w3.q(".dm-search", b3),
    "A: and with nothing to clear there is no lock and no Clear list, while the search box stays", w3.q(".dm-head", b3) && w3.q(".dm-head", b3).textContent);
});

// ═══ PART A, THE FEATURE — the real `Chat` over the real `ChatPrefs` ══════════════════════════════════════════════
part("A (feature)", () => {
  const w = CW.world({ realDate: true });
  const CP = w.sb.ChatPrefs;
  CP.dmTouch("!z1:hs", "@zoe:hs", 1000); CP.dmTouch("!z2:hs", "@zoe:hs", 2000); CP.dmTouch("!y1:hs", "@yan:hs", 3000);
  const before = w.sb.Chat.conversations().map((c) => c.userId);
  ok(before.length === 2, "A (feature) PREMISE — two people, three rooms, in the device's index", before);
  ok(typeof w.sb.Chat.forgetConversation === "function", "A (feature): `Chat.forgetConversation` exists — the ✕'s one call", Object.keys(w.sb.Chat));
  if (typeof w.sb.Chat.forgetConversation === "function") {
    const sentBefore = w.sent.length, performedBefore = w.performed.length;
    w.sb.Chat.forgetConversation(["!z1:hs", "!z2:hs"]);
    const after = CP.dmList().map((r) => r.roomId);
    ok(JSON.stringify(after) === JSON.stringify(["!y1:hs"]), "A (feature): FORGETTING ZOE DROPS BOTH HER ROOMS AND NOTHING ELSE", after);
    ok(w.sent.length === sentBefore && w.performed.length === performedBefore, "A (feature): ONLY ON THIS DEVICE — nothing is sent, nothing is performed", { sent: w.sent, performed: w.performed });
    CP.load();
    ok(JSON.stringify(CP.dmList().map((r) => r.roomId)) === JSON.stringify(["!y1:hs"]), "A (feature): AND IT IS SAVED — the device's index, read back, holds no room of hers", CP.dmList());
    CP.dmTouch("!z1:hs", "@zoe:hs", 4000);
    ok(w.sb.Chat.conversations().some((c) => c.userId === "@zoe:hs"), "A (feature) CONTROL: a forgotten conversation comes back the moment it is used, as after Clear list", CP.dmList());
  }
});

// ═══ PART B — Feed ══════════════════════════════════════════════════════════════════════════════════════════════
part("B", () => {
  const show = (o) => {
    const w = screen(o);
    w.sb.ChatPanels.feedSince = () => 0;   // chat's go-forward line, which a started chat would hold
    w.refs.tabGear.click();
    if (w.refs.subtabFeed) w.refs.subtabFeed.click();
    return w;
  };
  const w = show();
  ok(w.qa(".feed-line", w.refs.feedBox).length === 1, "B PREMISE — the feed drew the one act it was given", w.refs.feedBox.textContent);
  ok(w.refs.feedHead.textContent === "" && !w.shown(w.refs.feedHead),
    "B: THE HEAD NO LONGER SAYS \"WHAT HAS HAPPENED SINCE YOU OPENED THIS ROOM\" — with nothing left out it says nothing, and takes no room (the owner, ddjp_635)",
    { head: w.refs.feedHead.textContent, shown: w.shown(w.refs.feedHead) });
  const w2 = show({ feed: { rows: [{ verb: "voted", ts: NOW - 1000, sender: "@ann:hs", eventId: "$2" }], truncated: true, refused: 1 } });
  ok(w2.refs.feedHead.textContent === "Showing the newest 500 · 1 refused act, shown in red.",
    "B: WHAT IS LEFT OUT IS STILL SAID — the newest N, and the refused acts", w2.refs.feedHead.textContent);
  const w3 = show({ feed: { rows: [], truncated: false, refused: 0 } });
  // CHANGED ON PURPOSE (the owner, ddjp_637): this row held "an empty feed still says why"; the sentence is removed.
  ok(w3.qa(".feed-line", w3.refs.feedBox).length === 0 && w3.refs.feedHead.textContent === "" && !w3.shown(w3.refs.feedHead),
    "B: AN EMPTY FEED SAYS NOTHING — \"Nothing has happened since you opened this room\" is gone and the head folds away (the owner, ddjp_637)",
    { head: w3.refs.feedHead.textContent, shown: w3.shown(w3.refs.feedHead) });
});

// ═══ PART C — Room queue ════════════════════════════════════════════════════════════════════════════════════════
part("C", () => {
  const w = screen();
  w.refs.tabRoom.click();
  const qb = w.refs.queueBody;
  ok(w.qa(".song-row", qb).length === 3, "C PREMISE — now playing and the two waiting DJs were drawn", w.qa(".song-row", qb).length);
  const box = () => w.q(".rq-group", qb);
  const npHead = () => w.q(".rq-np-head", qb);
  const reset = () => w.btn(/^Reset rotation$/, qb);
  const lock = () => w.q(".panel-lock-btn", qb);
  ok(qb.firstElementChild === box() && !w.q(".rq-head-row", qb), "C: THE HEAD ROW ABOVE THE BOX IS GONE — the box comes first (the owner, ddjp_635)",
    qb.children.map((c) => c.className));
  ok(lock() && npHead() && npHead().lastElementChild === lock() && w.decl(lock(), "margin-left") === "auto",
    "C: THE LOCK IS AT THE FAR RIGHT OF THE BOX'S \"NOW PLAYING\" LINE", npHead() && npHead().children.map((c) => c.className || c.textContent));
  const tag = w.q(".rq-np-tag", qb);
  ok(reset() && npHead() && reset().parent === npHead() && npHead().children.indexOf(reset()) < npHead().children.indexOf(tag),
    "C: RESET ROTATION IS ON THAT LINE, LEFT OF \"NOW PLAYING\"", npHead() && npHead().children.map((c) => c.textContent));
  ok(H(reset()) === "30px" && w.decl(reset(), "padding") === "0 12px" && w.decl(lock(), "height") === "30px" && w.decl(lock(), "width") === "34px",
    "C: BOTH KEEP THEIR SIZES — Reset 30 px high with its padding, the lock 34 × 30", { reset: [H(reset()), w.decl(reset(), "padding")], lock: [w.decl(lock(), "width"), w.decl(lock(), "height")] });
  function H(n) { return w.decl(n, "height"); }
  const ctls = () => w.qa(".song-row", qb).slice(1).map((r) => w.qa(".uq-actions > *", r)).reduce((a, b) => a.concat(b), []);
  ok(ctls().length >= 12, "C PREMISE — the waiting rows carry their moderation controls", ctls().length);
  ok(!w.shown(reset()) && ctls().every((c) => !w.shown(c)) && w.qa(".song-row", qb).every((r) => w.shown(r)),
    "C: LOCKED, THE MODERATION CONTROLS ARE HIDDEN, NOT GREYED — Reset, every row control and its separators; the songs stay",
    { reset: w.shown(reset()), shownCtls: ctls().filter((c) => w.shown(c)).map((c) => c.className + ":" + c.textContent) });
  lock().click();
  ok(!w.sb.UIBase.host.roomqLocked() && w.shown(reset()) && ctls().every((c) => w.shown(c)),
    "C CONTROL: unlocked, Reset and the controls are there", { reset: w.shown(reset()) });
  const t = w.timers.filter((x) => x.ms === 5000);
  ok(t.length >= 1, "C: THE LOCK STAYS TIMED — unlocking arms its 5 s re-lock", w.timers.map((x) => x.ms));
  if (t.length) t[t.length - 1].fn();
  ok(w.sb.UIBase.host.roomqLocked() && !w.shown(reset()) && ctls().every((c) => !w.shown(c)),
    "C: and when it runs, Reset and the controls are hidden again", { locked: w.sb.UIBase.host.roomqLocked(), reset: w.shown(reset()) });
  // NOTHING PLAYING, NOBODY WAITING: the box stays and says so; "No DJs waiting" is gone.
  const w2 = screen({ playing: null, rotation: [] });
  w2.refs.tabRoom.click();
  const qb2 = w2.refs.queueBody, box2 = w2.q(".rq-group", qb2), np2 = w2.q(".rq-np-head", qb2);
  // CHANGED ON PURPOSE (the owner, ddjp_638, replacing ddjp_637's "Nothing"): this row held "Nothing" on the line and no
  // song space. With nothing playing the box is the playing box's shape: "Nothing playing" in the "Now Playing" tag's place
  // and style, no DJ; under it the song's space EMPTY at the playing row's height; Reset and the lock as they are.
  const tag2 = np2 ? w2.q(".rq-np-tag", np2) : null;
  ok(box2 && w2.shown(box2) && tag2 && tag2.textContent === "Nothing playing" && !w2.q(".who", np2) && !w2.q(".rq-np-none", np2)
     && w2.q(".panel-lock-btn", np2) && w2.btn(/^Reset rotation$/, np2) && np2.children.indexOf(w2.btn(/^Reset rotation$/, np2)) < np2.children.indexOf(tag2),
    "C: NOTHING PLAYING — \"Nothing playing\" in the Now Playing tag's place and style, no DJ; Reset left, the lock right (the owner, ddjp_638)",
    np2 && np2.children.map((c) => c.className + ":" + c.textContent));
  const rows2 = box2 ? box2.children.filter((c) => c.nodeType === 1 && /\bsong-row\b/.test(c.className)) : [];
  ok(rows2.length === 1 && rows2[0].children.length === 0 && w2.shown(rows2[0]) && !w2.q(".np-react", box2)
     && w2.qa("button", box2).every((b) => /\b(rq-reset|panel-lock-btn)\b/.test(b.className)),
    "C: THE SONG'S SPACE IS THERE AND EMPTY — no thumbnail, no title, no ★ or ▲ (the owner, ddjp_638)",
    rows2.map((r) => r.children.map((c) => c.className)));
  // ONE SIZE, PLAYING OR NOT: the empty space takes every declaration that sizes the playing row, and the box every one
  // that sizes the playing box (a browser measured both; see the report). Colour may differ: blue is the playing mark.
  const playRow = w.q(".rq-group .song-row.playing", qb), playBox = w.q(".rq-group", qb);
  const sizeOf = (n, ww) => ["min-height", "height", "padding", "box-sizing", "border", "gap"].map((p) => [p, ww.decl(n, p)]);
  ok(playRow && rows2.length === 1 && JSON.stringify(sizeOf(rows2[0], w2)) === JSON.stringify(sizeOf(playRow, w))
     && JSON.stringify(sizeOf(box2, w2)) === JSON.stringify(sizeOf(playBox, w)),
    "C: THE BOX IS ONE SIZE PLAYING OR NOT — the empty space sized as the playing row, the box as the playing box (the owner, ddjp_638)",
    { empty: rows2[0] && sizeOf(rows2[0], w2), playing: playRow && sizeOf(playRow, w), box: box2 && sizeOf(box2, w2), playBox: playBox && sizeOf(playBox, w) });
  ok(!/No DJs waiting/.test(qb2.textContent), "C: and \"No DJs waiting\" is gone", qb2.textContent);
  // A VIEWER WHO CANNOT MODERATE sees no lock and no Reset, as today.
  const w3 = screen({ moderate: false });
  w3.refs.tabRoom.click();
  const qb3 = w3.refs.queueBody;
  ok(!w3.q(".panel-lock-btn", qb3) && !w3.btn(/Reset rotation/, qb3) && w3.q(".rq-np-tag", qb3) && w3.shown(w3.q(".rq-group", qb3)),
    "C: A VIEWER WHO CANNOT MODERATE SEES NO LOCK AND NO RESET, and the box with what is playing", qb3.textContent);
});

// ═══ PART D — My queue ══════════════════════════════════════════════════════════════════════════════════════════
part("D", () => {
  const w = screen();
  w.refs.tabMine.click();
  const qb = w.refs.queueBody;
  const rows = () => w.qa(".song-row", qb);
  ok(rows().length === 3, "D PREMISE — my three songs were drawn", rows().length);
  const x = (r) => w.btn(/^✕$/, r);
  const sepBefore = (r) => { const b = x(r); return b ? b.previousSibling : null; };
  ok(rows().every((r) => x(r) && !w.shown(x(r)) && sepBefore(r) && !w.shown(sepBefore(r))),
    "D: LOCKED, EACH ROW'S ✕ IS HIDDEN, and the separator that guarded it (the owner, ddjp_635)",
    rows().map((r) => ({ x: x(r) && w.shown(x(r)), sep: sepBefore(r) && w.shown(sepBefore(r)) })));
  const down = w.btn(/^▼$/, rows()[1]);
  ok(down && !down.disabled && w.shown(down), "D: THE OTHER ROW CONTROLS STAY USABLE WHILE LOCKED", down && { disabled: down.disabled });
  if (down) down.click();
  ok(w.called("UserQueue.moveDown").length === 1, "D CONTROL: and a move goes through", w.calls.map((c) => c.f));
  const lock = w.q(".uq-add .panel-lock-btn", qb);
  if (lock) lock.click();
  ok(rows().every((r) => w.shown(x(r))), "D CONTROL: unlocked, the ✕ is back", rows().map((r) => x(r) && w.shown(x(r))));
  if (x(rows()[0])) x(rows()[0]).click();
  ok(w.called("UserQueue.removeAt").length === 1, "D CONTROL: and removes", w.calls.map((c) => c.f));
  // ── CLEAR ON THE ADD LINE (the owner, ddjp_637). CHANGED ON PURPOSE: these rows held the list head under the add line —
  // the count, "✕ Clear" and a 32 px ✔ square of its height (ddjp_635/636). The list head is gone.
  const add = () => w.q(".uq-add", qb);
  const addBtn = () => add() ? add().children.find((c) => c.tag === "button" && c.textContent === "Add") : null;
  const clearB = () => w.btn(/✕ Clear/, qb);
  const conf = () => w.qa("button", qb).find((b) => /✔/.test(b.textContent) && w.shown(b)) || null;
  ok(!!add() && !!addBtn() && !!w.q(".uq-add .panel-lock-btn", qb), "D PREMISE — the add line has its Add and its lock", add() && add().textContent);
  const lineItems = () => { const out = []; (function walk(n) { for (const c of n.children) { if (c.nodeType !== 1) continue; if (c.tag === "button" || c.tag === "input") out.push(c); else walk(c); } })(add()); return out; };
  const order = () => lineItems().filter((c) => w.shown(c)).map((c) => c.tag === "input" ? "input" : c.textContent.replace(/🔒|🔓/g, "lock"));
  ok(clearB() && add().contains(clearB()) && JSON.stringify(order()) === JSON.stringify(["input", "✕ Clear", "Add", "lock"]),
    "D: \"✕ CLEAR\" IS ON THE ADD LINE, LEFT OF ADD — input, ✕ Clear, Add, lock (the owner, ddjp_637)", order());
  // The count is sought as an ELEMENT saying "N songs", not in the panel's whole text: run together, "✕ Clear3 songs" has
  // no word boundary before the 3, and a count placed beside Clear read as absent (break row MQ7, ddjp_638).
  const counts = w.qa("*", qb).filter((n) => /^\s*\d+ songs?\s*$/.test(n.textContent));
  ok(!w.q(".uq-listhead", qb) && counts.length === 0,
    "D: NO COUNT LINE, AND NOTHING LEFT OF THE LIST HEAD (the owner, ddjp_637)", { head: !!w.q(".uq-listhead", qb), counts: counts.map((n) => n.textContent) });
  ok(clearB() && clearB().disabled === false, "D CONTROL: unlocked, Clear can be used", clearB() && clearB().disabled);
  ok(!conf(), "D: the ✔ shows only once Clear is clicked", conf() && conf().textContent);
  if (clearB()) clearB().click();
  ok(!!conf(), "D PREMISE — clicking Clear shows its ✔", order());
  const c = conf(), cl = clearB();
  ok(c && cl && JSON.stringify(order()) === JSON.stringify(["input", "✔︎", "✕ Clear", "Add", "lock"]),
    "D: THE ✔ APPEARS BESIDE CLEAR, as before", order());
  const hs = c && cl ? { confirmW: w.decl(c, "width"), confirmH: w.decl(c, "height"), clear: w.decl(cl, "height"), add: w.decl(addBtn(), "height"),
    lock: w.decl(w.q(".uq-add .panel-lock-btn", qb), "height") } : null;
  ok(hs && hs.add && hs.confirmH === hs.add && hs.clear === hs.add && hs.lock === hs.add && hs.confirmW === hs.confirmH,
    "D: CLEAR AND ITS ✔ ARE THE HEIGHT OF ADD AND THE LOCK, the ✔ still a square (the owner, ddjp_637)", hs);
  if (clearB()) clearB().click();
  ok(!conf() && w.called("UserQueue.clearQueue").length === 0, "D: CLICKING CLEAR AGAIN CANCELS, as before", order());
  if (clearB()) clearB().click();
  if (conf()) conf().click();
  ok(w.called("UserQueue.clearQueue").length === 1, "D CONTROL: and the ✔ clears the queue", w.calls.map((x) => x.f));
  // LOCKED: Clear follows the lock, as before.
  const w2 = screen();
  w2.refs.tabMine.click();
  const cl2 = w2.btn(/✕ Clear/, w2.refs.queueBody);
  ok(cl2 && cl2.disabled === true && w2.shown(cl2), "D: LOCKED, CLEAR IS THERE AND CANNOT BE USED, as before", cl2 && cl2.disabled);
  // EMPTY: no Clear, and no "Your queue is empty".
  const w3 = screen({ mine: [] });
  w3.refs.tabMine.click();
  const q3 = w3.refs.queueBody;
  ok(w3.q(".uq-add", q3) && !w3.btn(/Clear/, q3) && !/Your queue is empty/.test(q3.textContent),
    "D: AN EMPTY QUEUE SAYS NOTHING — no \"Your queue is empty\", and no Clear (the owner, ddjp_637)", q3.textContent);
});

// ═══ PART E — History ═══════════════════════════════════════════════════════════════════════════════════════════
part("E", () => {
  const w = screen();
  w.refs.tabHistory.click();
  const qb = w.refs.queueBody;
  ok(w.qa(".song-row", qb).length === 1, "E PREMISE — the one played song was drawn", qb.textContent);
  ok(!w.q(".history-reach", qb) && !/the whole room/.test(qb.textContent),
    "E: A COMPLETE HISTORY SAYS NO \"N SONGS — THE WHOLE ROOM\" (the owner, ddjp_635)", w.q(".history-reach", qb) && w.q(".history-reach", qb).textContent);
  const w2 = screen({ reach: { entries: 40, complete: false } });
  w2.refs.tabHistory.click();
  const r2 = w2.q(".history-reach", w2.refs.queueBody);
  ok(r2 && r2.textContent === "40 songs — as far back as this client can reach",
    "E: A PARTIAL HISTORY STILL SAYS SO — the owner kept it: it is the warning that history is incomplete", r2 && r2.textContent);
});

// ═══ PART F — the queue tabs on a phone ═════════════════════════════════════════════════════════════════════════
part("F", () => {
  const w = screen({ innerWidth: 1400 });
  const labels = () => [w.refs.tabRoom, w.refs.tabMine, w.refs.tabHistory, w.refs.tabPlaylists].map((t) => t.textContent);
  ok(JSON.stringify(labels()) === JSON.stringify(["Room queue", "My queue", "History", "Playlists"]), "F PREMISE / CONTROL: the wide layout's tabs, in full", labels());
  w.H._setLayout("phone");
  ok(JSON.stringify(labels()) === JSON.stringify(["Room Q", "My Q", "History", "Playlists"]),
    "F: AT PHONE WIDTH THE TABS READ \"ROOM Q\" AND \"MY Q\" (the owner, ddjp_635) — decided by the layout selector, here with a 1400 px window", labels());
  w.H._setLayout("wide");
  ok(JSON.stringify(labels()) === JSON.stringify(["Room queue", "My queue", "History", "Playlists"]), "F: and back in full when the layout is wide again", labels());
  const w2 = screen({ innerWidth: 390 });
  ok(w2.refs.tabRoom.textContent === "Room queue", "F: ONE WAY OF TELLING A PHONE — a 390 px window in the wide layout keeps the full labels", w2.refs.tabRoom.textContent);
});

// ═══ PART G — the logs bar ══════════════════════════════════════════════════════════════════════════════════════
part("G", () => {
  for (const layout of ["wide", "phone"]) {
    const w = screen();
    w.H._setLayout(layout);
    const bar = w.refs.logsBar;
    const kids = bar ? bar.children.filter((c) => c.nodeType === 1) : [];
    ok(bar && w.q("select", bar) && w.btn(/Bot status/, bar), "G PREMISE — the logs bar was built (" + layout + ")", bar && bar.textContent);
    const line = (n) => kids.find((k) => k.contains(n)) || null;
    const lvl = w.qa("select", bar)[0], cat = w.qa("select", bar)[1], count = w.refs.logsCount;
    const bot = w.btn(/Bot status/, bar), audit = w.btn(/History audit/, bar), copy = w.btn(/Copy log/, bar);
    const first = line(lvl), second = line(bot);
    ok(kids.length === 2 && first && second && first !== second && kids[0] === first
       && line(cat) === first && line(count) === first && line(audit) === second && line(copy) === second,
      "G: BOT STATUS, HISTORY AUDIT AND COPY LOG ARE ON THEIR OWN LINE, UNDER LEVEL, CATEGORY AND COUNT (the owner, ddjp_635) — " + layout,
      kids.map((k) => k.textContent));
    ok(second && second.children.indexOf(bot) < second.children.indexOf(audit) && second.children.indexOf(audit) < second.children.indexOf(copy),
      "G: in their order: Bot status, History audit, Copy log", second && second.textContent);
    ok(w.decl(bar, "flex-direction") === "column", "G: the sheet stacks the two lines — always, not only on a phone (a choice made for the owner)", w.decl(bar, "flex-direction"));
    // ONE HEIGHT (`ddjp_637`; found at `ddjp_636`): the three take one padding and one size from the sheet. History audit
    // carried `.copy-btn`'s own 5px 9px while its neighbours carried `.logs-copy`'s 2px 8px, so it stood 6 px taller.
    const look = (b) => ["padding", "font-size", "line-height", "border"].map((p) => w.decl(b, p));
    ok(w.decl(bot, "padding") !== null && [audit, copy].every((b) => b && JSON.stringify(look(b)) === JSON.stringify(look(bot))),
      "G: BOT STATUS, HISTORY AUDIT AND COPY LOG ARE ONE HEIGHT — one padding and one size from the sheet (" + layout + ")",
      [bot, audit, copy].map((b) => b && [b.className].concat(look(b))));
  }
});

// ═══ PART H — Playlists ═════════════════════════════════════════════════════════════════════════════════════════
part("H", () => {
  const w = screen();
  w.refs.tabPlaylists.click();
  const qb = w.refs.queueBody;
  const create = w.btn(/^Create$/, qb), lock = w.q(".pl-lib-head .panel-lock-btn", qb);
  ok(create && lock, "H PREMISE — the library's Create line was drawn", w.q(".pl-lib-head", qb) && w.q(".pl-lib-head", qb).textContent);
  // Found by its class, not its words: the words are the owner's to change (they did, `ddjp_645`).
  const io = w.q(".pl-lib-head button.pl-io-open", qb);
  ok(!!io, "H PREMISE — the library's import and export button was drawn (`pl-io-open`)", w.q(".pl-lib-head", qb) && w.q(".pl-lib-head", qb).textContent);
  // CHANGED ON PURPOSE (the owner, ddjp_639): this row held Import / Export LEFT of Create (ddjp_635). The line is now
  // box, Create, the import and export button, lock. AND ITS LABEL (the owner, `ddjp_645`): "Imp / Exp", the full words kept in
  // its tooltip — the button, its place, its size and its grey unchanged.
  const order = create && create.parent ? create.parent.children.map((c) => c.tag === "input" ? "[box]" : c === lock ? "lock" : c === io ? "[io]" : c.textContent) : null;
  ok(io && create && io.parent === create.parent && create.nextSibling === io && io.nextSibling === lock
     && JSON.stringify(order) === JSON.stringify(["[box]", "Create", "[io]", "lock"]),
    "H: THE IMPORT AND EXPORT BUTTON SITS ON THE CREATE LINE, RIGHT OF CREATE: box, Create, it, lock (the owner, ddjp_639)", order);
  ok(io && io.textContent === "Imp / Exp",
    "H: IT READS \"Imp / Exp\" (the owner, ddjp_645) — it read \"Import / Export\"", io && io.textContent);
  ok(io && io.title === "Import or export playlists to a file",
    "H: AND ITS TOOLTIP KEEPS THE FULL WORDS — \"Import or export playlists to a file\" (the owner, ddjp_645)", io && io.title);
  // THE WINDOW IT OPENS IS UNCHANGED (the owner, `ddjp_645`): its two tabs still read "Export" and "Import", Export first.
  if (io && io.onclick) io.onclick();
  const tabs = ((w.sb.document && w.sb.document.body) ? w.qa(".pl-io-tab", w.sb.document.body) : []).concat(w.qa(".pl-io-tab", w.main) || []);
  const words = [...new Set(tabs)].map((t) => t.textContent);
  ok(JSON.stringify(words) === JSON.stringify(["Export", "Import"]) && /\bactive\b/.test(tabs[0] && tabs[0].className),
    "H CONTROL: IT OPENS THE SAME WINDOW — its tabs read \"Export\" and \"Import\", Export first and chosen", words);
  const props = ["height", "border-radius", "padding", "font-size", "border"];
  const cmp = props.map((p) => [p, w.decl(io, p), w.decl(create, p)]);
  ok(io && cmp.every(([, a, b]) => a !== null && a === b) && w.decl(lock, "height") === w.decl(create, "height"),
    "H: THE SAME SIZE AND KIND OF BUTTON AS CREATE AND THE LOCK", cmp.concat([["lock height", w.decl(lock, "height")]]));
  ok(io && w.decl(io, "background") === "#333" && w.decl(io, "background") !== w.decl(create, "background"),
    "H: AND IT STAYS GREY — today's grey, not Create's blue", io && [w.decl(io, "background"), w.decl(create, "background")]);
  // AN EMPTY LIBRARY SAYS NOTHING (the owner, ddjp_636, added to J118 while it was being built): the Create line is the way in.
  const scroll = w.q(".pl-scroll", qb);
  ok(!!scroll, "H PREMISE — the library's list was drawn, empty", qb.textContent);
  ok(scroll && scroll.children.length === 0 && !/No playlists yet/.test(qb.textContent),
    "H: AN EMPTY LIBRARY SAYS NOTHING — \"No playlists yet — create one above.\" is gone (the owner, ddjp_636)", scroll && scroll.textContent);
  const w2 = screen({ playlists: [{ id: "p1", name: "Mine" }] });
  w2.refs.tabPlaylists.click();
  const s2 = w2.q(".pl-scroll", w2.refs.queueBody);
  ok(s2 && w2.qa(".pl-row", s2).length === 1 && /Mine/.test(s2.textContent),
    "H CONTROL: a library with a playlist draws its row", s2 && s2.textContent);
  // INSIDE A PLAYLIST (the owner, ddjp_638): "← Back" the same kind of button as "＋ All", and all three on the
  // line — Back, ＋ All, the lock — the lock's height, as Create stands beside its lock. ＋ All was 30 px only because its
  // row stretched it beside the lock (measured); Back was 22. RENAMED ON PURPOSE (the owner, ddjp_639): "＋ All to my
  // queue" is "＋ All to Q".
  const nm = w2.q(".pl-name", w2.refs.queueBody);
  if (nm) nm.click();
  const dh = w2.q(".pl-detail-head", w2.refs.queueBody);
  const back = dh ? w2.btn(/Back/, dh) : null, all = dh ? w2.btn(/All to/, dh) : null, dlock = dh ? w2.q(".panel-lock-btn", dh) : null;
  ok(back && all && dlock, "H PREMISE — a playlist opened, and its line has Back, ＋ All and the lock", dh && dh.textContent);
  ok(all && all.textContent === "＋ All to Q", "H: \"＋ ALL TO MY QUEUE\" IS \"＋ ALL TO Q\" (the owner, ddjp_639)", all && all.textContent);
  const kind = (b) => ["background", "color", "padding", "border-radius", "font-size", "border"].map((p) => [p, w2.decl(b, p)]);
  ok(back && all && /\bmini\b/.test(back.className) && /\bmini\b/.test(all.className) && JSON.stringify(kind(back)) === JSON.stringify(kind(all)),
    "H: \"← BACK\" IS THE SAME KIND OF BUTTON AS \"＋ ALL\" (the owner, ddjp_638)", back && all && { back: kind(back), all: kind(all) });
  const hts = back && all && dlock ? [w2.decl(back, "height"), w2.decl(all, "height"), w2.decl(dlock, "height")] : null;
  ok(hts && hts[2] && hts.every((h) => h === hts[2]),
    "H: BACK, ＋ ALL AND THE LOCK ARE THE LOCK'S HEIGHT (the owner, ddjp_638)", hts);

  // "＋ ALL TO Q" TAKES TWO STEPS (the owner, ddjp_639). Its line is redrawn on every click, so each step reads it afresh.
  const line = () => { const h = w2.q(".pl-detail-head", w2.refs.queueBody); if (!h) return null;
    const btns = w2.qa("button", h); const a = btns.find((b) => /All to/.test(b.textContent)) || null;
    return { head: h, all: a, ok: btns.find((b) => /^\u2714/.test(b.textContent)) || null, lock: w2.q(".panel-lock-btn", h) }; };
  const adds = () => w2.called("Playlists.addWholeToQueue").length;
  let L = line();
  ok(L && L.all && !L.ok && adds() === 0, "H: BEFORE IT IS CLICKED THERE IS NO ✔, and nothing is added", L && L.head.textContent);
  L.all.click(); L = line();
  ok(L && L.ok && L.all && L.ok.nextSibling === L.all && adds() === 0,
    "H: CLICKING \"＋ ALL TO Q\" SHOWS A ✔ TO ITS LEFT — and adds nothing yet", L && { line: L.head.textContent, adds: adds() });
  // The ✔ is the red confirm squares' kind of button, green, a square at the line's 30 px.
  const red = ["padding", "font-size", "border-radius", "border"].map((p) => [p, w2.decl(L && L.ok, p)]);
  ok(L && L.ok && /\bmini\b/.test(L.ok.className) && /\bico\b/.test(L.ok.className) && /\bdconfirm\b/.test(L.ok.className)
     && w2.decl(L.ok, "height") === "30px" && w2.decl(L.ok, "width") === "30px" && w2.decl(L.ok, "min-width") === "30px",
    "H: THE ✔ IS THE RED CONFIRM SQUARES' KIND (mini ico dconfirm) AT THE LINE'S 30 PX, A SQUARE", L && L.ok && { cls: L.ok.className, h: w2.decl(L.ok, "height"), w: w2.decl(L.ok, "width"), red });
  const bg = L && L.ok ? w2.decl(L.ok, "background") : null;
  const green = (c) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c || ""); if (!m) return false; const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16)); return g > r + 24 && g > b + 24; };
  ok(green(bg), "H: AND IT IS GREEN — not the delete confirm's red", bg);
  L.all.click(); L = line();
  ok(L && !L.ok && adds() === 0, "H: CLICKING \"＋ ALL TO Q\" AGAIN CANCELS — the ✔ goes, and nothing was added", L && L.head.textContent);
  L.all.click(); L = line();
  if (L && L.ok) L.ok.click();
  L = line();
  ok(adds() === 1 && w2.called("Playlists.addWholeToQueue")[0].args[0] === "p1" && L && !L.ok,
    "H: ONLY CLICKING THE ✔ ADDS THE SONGS — once, this playlist's — and the ✔ goes", { adds: w2.called("Playlists.addWholeToQueue"), line: L && L.head.textContent });
  // WHAT DISARMS THE DELETE CONFIRM DISARMS THIS TOO. Measured in a browser at ddjp_639: the delete confirm is disarmed by its
  // own ✘ and ✔, by the playlists lock, by Back or opening another playlist, and by leaving the view (another queue tab, a
  // right-panel tab); it SURVIVES a redraw and a click elsewhere. The ✔ is held to the same list.
  // Each case shows the ✔ first and says so in its own row: a disarm that found nothing armed proves nothing.
  const armed = () => { const l = line(); if (l && !l.ok && l.all) l.all.click(); return !!(line() && line().ok); };
  const reopen = () => { const n2 = w2.q(".pl-name", w2.refs.queueBody); if (n2) n2.click(); };
  let was = armed();
  w2.sb.QueuePanels.renderQueuePanel();
  ok(was && !!(line() && line().ok), "H: A REDRAW KEEPS IT, AS IT KEEPS THE DELETE CONFIRM", { armedFirst: was, line: line() && line().head.textContent });
  was = armed(); if (line()) line().lock.click();
  ok(was && line() && !line().ok, "H: THE LOCK DISARMS IT, AS IT DISARMS THE DELETE CONFIRM", { armedFirst: was, line: line() && line().head.textContent });
  // Leaving is read from the panel's own state the moment the view is left — opening a playlist disarms as well, so the
  // screen after reopening could not tell which one did it.
  const stillArmed = () => (typeof w2.sb.PlaylistPanels.armed === "function" ? w2.sb.PlaylistPanels.armed() : null);
  was = armed(); { const b = line() && w2.btn(/Back/, line().head); if (b) b.click(); }
  let left = stillArmed(); reopen();
  ok(was && left === false && line() && !line().ok, "H: BACK DISARMS IT — nothing is left armed, and the playlist opened again shows no ✔", { armedFirst: was, armedAfterBack: left, line: line() && line().head.textContent });
  was = armed(); w2.refs.tabRoom.click();
  left = stillArmed(); w2.refs.tabPlaylists.click(); reopen();
  ok(was && left === false && line() && !line().ok, "H: LEAVING THE VIEW FOR ANOTHER QUEUE TAB DISARMS IT", { armedFirst: was, armedAfterTab: left, line: line() && line().head.textContent });
  was = armed(); w2.refs.tabChat.click();
  ok(was && line() && !line().ok, "H: AND SO DOES A RIGHT-PANEL TAB — the panels' relock", { armedFirst: was, line: line() && line().head.textContent });
  // Not behind the lock: locked, "＋ All to Q" and its ✔ work as they do unlocked.
  L = line();
  ok(L && /\blocked\b/.test(L.lock.className) && !L.all.disabled, "H PREMISE — the playlists lock is on, and ＋ All is usable", L && L.lock.className);
  const before = adds();
  armed(); L = line();
  ok(L && L.ok && !L.ok.disabled, "H: IT IS NOT BEHIND THE LOCK — locked, ＋ All still arms and its ✔ is usable", L && L.head.textContent);
  if (L && L.ok) L.ok.click();
  ok(L && L.ok && adds() === before + 1, "H: and, locked, the ✔ adds", w2.called("Playlists.addWholeToQueue").length);
});

// ═══ PART I — the header's upgrade slot ════════════════════════════════════════════════════════════════════════
part("I", () => {
  // A FULLY UPGRADED ROOM (the owner, ddjp_639): nothing where the upgrade sits — no "All ranks unlocked" — and the slot
  // takes no space at all. Measured in a browser at ddjp_639: the words took 97 px and the slot the header's 12 px gap
  // besides; an empty slot still took the gap.
  const w = screen({ upgrade: { currentBatch: 4, maxBatch: 4, canUpgradeNow: false, inProgress: false, nextAvailableAt: 0 } });
  w.sb.Roster.renderUpgradePanel();
  const slot = w.refs.upgradeSlot;
  ok(!!slot && w.st.moderate === true, "I PREMISE — the header has its upgrade slot, and the viewer is the owner", slot && slot.className);
  ok(slot && !/All ranks unlocked/.test(slot.textContent) && slot.children.length === 0,
    "I: A FULLY UPGRADED ROOM SAYS NOTHING THERE — no \"All ranks unlocked\" (the owner, ddjp_639)", slot && slot.textContent);
  ok(slot && !w.shown(slot), "I: AND THE SLOT TAKES NO SPACE AT ALL — it is not drawn, so the header's gap goes with it", slot && w.decl(slot, "display"));
  const w2 = screen({ upgrade: { currentBatch: 2, maxBatch: 4, canUpgradeNow: true, inProgress: false, nextAvailableAt: 0 } });
  w2.sb.Roster.renderUpgradePanel();
  const s2 = w2.refs.upgradeSlot, up = s2 ? w2.btn(/Upgrade/, s2) : null;
  ok(up && up.textContent === "Upgrade (2/4)" && w2.shown(s2) && w2.shown(up),
    "I CONTROL: a room with ranks still to unlock shows its Upgrade button, slot and all", s2 && s2.textContent);
});

console.log(failed ? "[owner-screens] " + failed + " failure(s) in " + asserts + " assertions"
  : "[owner-screens] PASS — the owner's screen decisions at ddjp_635 hold on the screen the real code builds (" + asserts + " assertions): "
  + "the DM line's lock and Clear list, the ✕ that forgets one conversation on this device, no empty text; the feed head; the room "
  + "queue's controls on the Now Playing line and hidden while locked; my queue's ✕ and square ✔; history's partial wording "
  + "only; Room Q / My Q by the layout selector; the logs bar's second line; Import / Export right of Create; an empty library says "
  + "nothing; \"＋ All to Q\" in two steps behind a green ✔; a fully upgraded room's header slot empty and taking no space.");
process.exit(failed ? 1 : 0);
