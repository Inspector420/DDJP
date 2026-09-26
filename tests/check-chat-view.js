// tests/check-chat-view.js
// SUBJECT: ui/chat.js, ui/chatbuffer.js, features/chat.js, core/chatprefs.js
// WALL: EACH CHAT SHOWS ITS OWN SOURCE, AND THE FEED SITS BETWEEN MESSAGES AT ITS OWN TIME.
//
// ── WHY THIS GUARD EXISTS: NOTHING COULD ASK WHAT IS ON SCREEN ──────────────────────────────
// Every chat guard before this one drove a PIECE — a buffer retained across a switch, a label, a
// filter — and the fake DOM they share (`_probe-j16-active`'s `node`) has no `insertBefore`, no
// `querySelector` and no geometry, so no guard could ask the only question a person asks: *which
// rows are in the box, and which Matrix room did each one come from?* Driven against the tree this
// guard replaced (ddjp_424, `?v=401`), with a positive control, four answers were wrong and the
// whole suite was green:
//   · JOIN — the one backfill filed under `_active` (the box's tier was not yet seeded when it
//     ran) while the live copies of the SAME messages filed under the tier's name: two buckets,
//     two dedup sets, every message on screen twice.
//   · TIER SWITCH — one DOM box shared by every tier and never cleared; the repaint rebuilt only
//     the new tier's mounted ids, so the OLD tier stayed on screen under the new tier's name.
//   · MAIN-CHAT CHANGE — the same repaint, the same fault.
//   · UNLISTED CHANNEL — a message whose channel no tier named was drawn under the visible tier.
// Each was a plausible screen rather than an error, which is the core signature.
//
// ── THE SHAPE IT PINS, AND WHY THE SHAPE IS THE FIX ─────────────────────────────────────────
// Chat is MODEL FIRST: messages are filed by the channel id they ARRIVED on (never by a tier name
// guessed at arrival), and `ChatBuffer.view` — pure — turns one channel's buffer plus the feed's
// rows into the list of rows to show. The box is only ever a rendering of that list. So a tier
// switch, a main-chat change and a new message are the same operation — recompute, reconcile —
// and none of the four faults above has anywhere left to live.
//
// WHAT EACH PART PINS:
//   PART A — one source per view: the box shows the active channel's messages and only those,
//     across a switch, and a message from a channel no tier names is drawn nowhere.
//   PART B — entry: EVERY readable tier is backfilled (not only the active one), the scrollback
//     flood and the backfill land in ONE buffer per channel, and each tier opens on its last ten,
//     once each, in order.
//   PART C — the room's main chat changes: a device following the room follows it; a device with
//     an override stays where it is.
//   PART D — the feed between messages: rows interleave at their SERVER time in every tier, the
//     feed is go-forward (nothing from before entry), the line is a server stamp and never the
//     device clock, and a refused event is never shown.
//   PART E — the device preference, ONE BOX PER KIND with a default per kind (owner ruling): the
//     defaults are the ruling, each kind toggles alone, only changes are stored,//     survives a reload, a stored blob cannot smuggle keys in, and every kind shows by default.
//   PART F — the Feed tab is gone and the fold is not (TEXTUAL, and says so).
//   PART G — a deletion tombstones the row in ITS OWN channel, in place.
//   PART I — the 512-character limit: one check for sending and receiving, the too-long chat event.
//   PART J — mentions: whole-ID matching, the purple dot on tier and tab, the accent, the chime (live only,
//     once per burst, scaled by volume, on at 33 by default), the @ insertion, and the settings.
//   PART H — a seeded random walk: after every step, no message from another channel on screen, no row
//     above an older one, nothing twice, no event of a hidden kind. The reported symptoms, reproduced on the old
//     tree and absent here.
//
// THE DOUBLES, AND WHAT THEY ARE TAKEN FROM. `ChatPrefs`, `ChatBuffer`, `Chat` and `Room.foldFeed`
// are the REAL modules. The DOM is a double because there is no browser; `MatrixBridge` is a double
// because there is no SDK, and its `recentChatMessages` returns the shape read from
// `backends/backend1/matrixbridge.js` (`{messages:[{event_id,sender,body,ts,failed}]}`, oldest
// first). `Room.chatTiers` is replaced because it reads a joined room's channel map — its
// resolution rule is driven by `check-chat-tiers` PART C, and this guard hands the panel a
// resolution in exactly that function's return shape.

const fs = require("fs");
const path = require("path");

let asserts = 0;
function fail(msg, got) {
  console.log("[chat-view] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
// A GUARD THAT NEVER REACHES ITS VERDICT MUST NOT EXIT 0. This file is async, and an `await` on a
// promise nobody settles lets node drain the loop and exit 0 with NO output — which happened while
// this guard was being written (a held fetch in PART B). The verdict is printed last, so a clean exit
// without it is a FAIL, never a quiet pass (the thirty-ninth signature: a gate last in the file is
// not last in time).
let reachedVerdict = false;
process.on("exit", (code) => {
  if (code === 0 && !reachedVerdict) {
    console.log("[chat-view] FAIL — exited before the verdict: an awaited step never settled, so the parts after it never ran");
    process.exitCode = 1;
  }
});
const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// The REAL Actions adapter over a world's modules, for the @ button's catalog entry.
function loadActions(w) {
  const vm = require("vm");
  // `Room` as Actions reads it at describe time (features/actions.js: `getMyId`, then
  // `getMyAuthorityLevel` or `getMyRank`) — those two and nothing else.
  const sb = { console, Date, Math, JSON, Promise, Chat: w.sb.Chat, Room: { getMyId: () => "@me:hs", getMyRank: () => 0 },
    StreamManager: { getState: () => ({ rotation: [], nowPlaying: null }) }, Capabilities: { can: () => ({ permitted: true }) },
    MatrixBridge: { getUserId: () => "@me:hs", getMyRank: () => 0 } };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(read("features/actions.js") + "\n;globalThis.__A = Actions;", sb);
  return sb.__A;
}

const W = require("./_chat-world");
const { world, screen, tick } = W;
function clickTier(w, label) {
  const b = W.tierButton(w, label);
  ok(!!b, "APPLIED — the strip must render a '" + label + "' button to click",
     w.refs.chatTiers.children.map((x) => x._text));
  b.onclick();
}

(async () => {
  // ── THE NEW SHAPE MUST EXIST, OR EVERY PART BELOW HAS NO SUBJECT ─────────────────────────────
  {
    const w = world();
    for (const fn of ["startChat", "renderChat", "syncChatTier", "addChatMessage", "removeChatMessage", "_renderChatTierStrip", "_repaintChat"]) {
      ok(typeof w.CP[fn] === "function", "APPLIED — ChatPanels." + fn + " must exist; the parts below drive it", typeof w.CP[fn]);
    }
    ok(typeof w.sb.ChatBuffer.view === "function", "APPLIED — ChatBuffer.view must exist: it is the pure model the box renders", typeof w.sb.ChatBuffer.view);
    ok(typeof w.sb.ChatPrefs.feedShown === "function" && typeof w.sb.ChatPrefs.setFeedShown === "function",
      "APPLIED — ChatPrefs.feedShown / setFeedShown must exist (PART E)", null);
  }

  // ═══ PART A — one source per view ═══════════════════════════════════════════════════════════
  {
    const w = world();
    await w.CP.startChat(w.box);
    for (let i = 0; i < 3; i++) w.raw("$u" + i, "!u:hs", 100 + i);
    for (let i = 0; i < 2; i++) w.raw("$s" + i, "!s:hs", 200 + i);
    w.raw("$x0", "!unlisted:hs", 150);
    // A channel that PASSES THE DOOR and is no tier: `Chat.init` seeds the room's chat channel into
    // the readable set, and the resolver can still leave it out (a tier whose rank the room has not
    // unlocked). Measured, not assumed: a channel outside the readable set is refused by `Chat`
    // before the panel sees it, so a row driven with one alone would pass with the panel's own rule
    // deleted — which a mutation run of this guard showed.
    w.sb.Chat.setReadableTiers(["!u:hs", "!s:hs", "!orphan:hs"]);
    w.raw("$o0", "!orphan:hs", 150);
    ok(screen(w.box).join() === "m:$u0,m:$u1,m:$u2",
      "A control: before any switch the box shows Everyone's messages — so the switch below starts from a known screen",
      screen(w.box));
    clickTier(w, "Staff");
    ok(screen(w.box).join() === "m:$s0,m:$s1",
      "A: AFTER SWITCHING TO STAFF THE BOX SHOWS STAFF'S MESSAGES AND ONLY THOSE. The tree before this " +
      "guard left Everyone's rows on screen under the Staff view: one box, never cleared, and a repaint " +
      "that rebuilt only the new tier's mounted ids", screen(w.box));
    clickTier(w, "Everyone");
    ok(screen(w.box).join() === "m:$u0,m:$u1,m:$u2",
      "A: and back — nothing was lost, and nothing of Staff's is left behind", screen(w.box));
    ok(screen(w.box).indexOf("m:$x0") < 0,
      "A: a message from outside the readable set is refused at the door and drawn nowhere", screen(w.box));
    ok(screen(w.box).indexOf("m:$o0") < 0,
      "A: A MESSAGE FROM A READABLE CHANNEL NO TIER NAMES IS DRAWN NOWHERE — the panel's own rule, behind the " +
      "door's. It used to be filed under whichever tier was visible when it landed, which puts one room's " +
      "words under another room's name", screen(w.box));
    clickTier(w, "Staff");
    ok(screen(w.box).indexOf("m:$o0") < 0, "A: in any tier", screen(w.box));
    ok(w.box._chat.bufs["!orphan:hs"] && w.box._chat.bufs["!orphan:hs"].has("$o0"),
      "A control: the orphan message WAS received and is held under its own channel — so its absence above is " +
      "the panel refusing to draw it, not a message that never arrived", Object.keys(w.box._chat.bufs));
  }

  // ═══ PART B — entry: every tier backfilled, one buffer per channel, last ten each ══════════
  {
    const hist = { "!u:hs": [], "!s:hs": [] };
    for (let i = 0; i < 25; i++) hist["!u:hs"].push({ id: "$hu" + String(i).padStart(2, "0"), sender: "@a:hs", body: "u" + i, ts: 1000 + i });
    for (let i = 0; i < 4; i++) hist["!s:hs"].push({ id: "$hs" + i, sender: "@b:hs", body: "s" + i, ts: 2000 + i });
    const w = world({ history: hist, holdFetch: true });
    const p = w.CP.startChat(w.box);
    // The SDK's scrollback re-fires `Event.decrypted` for history, NEWEST-first, while the fetch is
    // still in flight — `matrixbridge.js` routes it with no scrollback filter. The same messages.
    for (const ch of ["!u:hs", "!s:hs"]) for (const m of hist[ch].slice().reverse()) w.raw(m.id, ch, m.ts, m.body, m.sender);
    await tick();
    // MID-FLOOD, BEFORE THE FETCH RETURNS: the view is the last ten, never the pile. This is what the
    // tail window is for, and the screen after the fetch lands cannot show it — that one is right
    // either way, because the anchor set on landing collapses whatever the flood drew.
    const mid = screen(w.box);
    ok(mid.join() === hist["!u:hs"].slice(-10).map((m) => "m:" + m.id).join(),
      "B: WHILE THE BACKFILL IS IN FLIGHT the screen holds the newest ten, in order — the scrollback flood " +
      "arriving newest-first cannot pile twenty-five rows onto it", mid);
    w.releaseFetches(); await p; await tick();
    const askedIds = w.asked.map((a) => a.roomId).sort();
    ok(askedIds.join() === "!s:hs,!u:hs",
      "B: EVERY READABLE TIER IS BACKFILLED ON ENTRY, not only the active one — the tree before this guard " +
      "fetched the active channel alone, so every other tier opened empty", w.asked);
    ok(w.asked.every((a) => a.count === 10), "B: each backfill asks for the last ten", w.asked);
    ok(w.asked.every((a) => a.roomId !== "!unlisted:hs"), "B: and never for a channel no tier names", w.asked);
    // THE FETCH HAS THE RECEIVE DOOR'S GATE. Driven at `Chat` directly, because the panel above only
    // ever asks for tier channels and so cannot show whether the fetch itself would refuse one.
    const before = w.asked.length;
    const pForeign = w.sb.Chat.backfillRecent(10, "!unlisted:hs");
    w.releaseFetches();                              // so a missing gate is read by THIS row, not by a hang
    const foreign = await pForeign;
    ok(foreign.messages.length === 0 && w.asked.length === before,
      "B: `Chat.backfillRecent` REFUSES A CHANNEL OUTSIDE THE READABLE SET and never reaches the transport " +
      "for it — a fetch that ignored the set would be a second door into the same messages with no gate",
      { got: foreign.messages.length, asked: w.asked.slice(before) });
    const pMine = w.sb.Chat.backfillRecent(10, "!s:hs");
    w.releaseFetches();                              // this world holds fetches (for the flood above)
    await pMine;
    ok(w.asked.length === before + 1 && w.asked[before].roomId === "!s:hs",
      "B control: and it does fetch a readable one, so the refusal above is the gate and not a fetch that never runs",
      w.asked.slice(before));
    const s = screen(w.box);
    const want = hist["!u:hs"].slice(-10).map((m) => "m:" + m.id);
    ok(s.length === s.filter((x, i) => s.indexOf(x) === i).length,
      "B: NO MESSAGE IS ON SCREEN TWICE. The tree before this guard filed the backfill under `_active` and " +
      "the flood under the tier's name — two buckets, two dedup sets, twenty rows for ten messages", s);
    ok(s.join() === want.join(),
      "B: Everyone opens on its last ten, oldest first, even though 25 arrived newest-first", { got: s, want });
    ok(Object.keys(w.box._chat.bufs).sort().join() === "!s:hs,!u:hs",
      "B: ONE BUFFER PER CHANNEL, keyed by the channel id the message arrived on — never by a tier name " +
      "resolved at arrival, which is how `_active` came to exist", Object.keys(w.box._chat.bufs));
    ok(w.box._chat.bufs["!u:hs"].size() === 25,
      "B control: the older fifteen ARE held — so 'exactly ten on screen' is the window, not an absence; " +
      "scrolling up reveals them from RAM", w.box._chat.bufs["!u:hs"].size());
    clickTier(w, "Staff");
    ok(screen(w.box).join() === hist["!s:hs"].map((m) => "m:" + m.id).join(),
      "B: and Staff opens on ITS history, which the tree before this guard never fetched", screen(w.box));
  }

  // ═══ PART C — the room changes its main chat ═══════════════════════════════════════════════
  {
    const w = world();
    await w.CP.startChat(w.box);
    for (let i = 0; i < 3; i++) w.raw("$u" + i, "!u:hs", 100 + i);
    for (let i = 0; i < 2; i++) w.raw("$s" + i, "!s:hs", 200 + i);
    w.tiersState.mainTier = "staff";
    ok(w.sb.Room.chatTiers().activeTier === "staff",
      "C control: with no override the resolver now points at the new main tier — so the box below is the " +
      "panel's answer and not the resolver's", w.sb.Room.chatTiers().activeTier);
    w.CP.syncChatTier();
    ok(screen(w.box).join() === "m:$s0,m:$s1",
      "C: A DEVICE FOLLOWING THE ROOM FOLLOWS A MAIN-CHAT CHANGE, and shows the new main tier's messages " +
      "rather than the old tier's under the new tier's name", screen(w.box));
    // With an override the device stays where it chose to be.
    const w2 = world();
    await w2.CP.startChat(w2.box);
    for (let i = 0; i < 3; i++) w2.raw("$u" + i, "!u:hs", 100 + i);
    w2.raw("$s0", "!s:hs", 200);
    clickTier(w2, "Everyone");                       // an explicit choice: the override is set
    w2.tiersState.mainTier = "staff";
    w2.CP.syncChatTier();
    ok(screen(w2.box).join() === "m:$u0,m:$u1,m:$u2",
      "C: a device that CHOSE a tier stays on it when the room's main chat moves — the override is this " +
      "device's answer and the room's setting does not overrule it", screen(w2.box));
  }

  // ═══ PART D — the feed between messages, go-forward, in every tier ═════════════════════════
  {
    const w = world();
    // Before entry: history the log already holds. None of it may appear — the feed is go-forward.
    // Kinds ON by default (a save, a skip), so the only thing that can keep these off screen is the
    // go-forward line — with default-off kinds the row below would pass on the default alone.
    w.log.push({ eventId: "$old1", type: "ddjp.dj.skip", sender: "@a:hs", ts: 50, l: 1 });
    w.log.push({ eventId: "$old2", type: "ddjp.dj.save", sender: "@a:hs", ts: 90, l: 2 });
    w.raw("$u0", "!u:hs", 80);
    await w.CP.startChat(w.box);
    ok(screen(w.box).join() === "m:$u0",
      "D: ON ENTRY THE FEED SHOWS NOTHING FROM BEFORE ENTRY (owner ruling: go-forward). The line is the " +
      "newest SERVER stamp this client held when it entered — never the device clock, which this world " +
      "sets eleven thousand years ahead so any use of it hides everything", screen(w.box));
    w.raw("$u1", "!u:hs", 200);
    w.raw("$s1", "!s:hs", 210);
    w.log.push({ eventId: "$new1", type: "ddjp.dj.save", sender: "@b:hs", ts: 150, l: 3 });
    w.log.push({ eventId: "$new2", type: "ddjp.dj.skip", sender: "@b:hs", ts: 205, l: 4 });
    w.log.push({ eventId: "$bad", type: "ddjp.dj.skip", sender: "@c:hs", ts: 206, l: 5 });   // on by default: only the refusal hides it
    w.refused.add("$bad");
    w.CP.renderChat();                               // the re-derive announcement
    ok(screen(w.box).join() === "m:$u0,f:$new1,m:$u1,f:$new2",
      "D: FEED ROWS SIT BETWEEN MESSAGES AT THEIR SERVER TIME — a save at 150 between messages at 80 and " +
      "200 — and an event the room REFUSED is never shown", screen(w.box));
    ok(w.box.children.filter((n) => n.dataset && n.dataset.fid).every((n) => n.className.indexOf("chat-feed") >= 0),
      "D: a feed row is marked as one, so it can never be read as a message", w.box.children.map((n) => n.className));
    // GREY, BY THE STYLESHEET ALONE (owner request, ddjp_428). An inline colour on any part of an event row
    // would override the grey `.chat-feed` rules — the rank colour set on the name was one, and it could be
    // near-white. What colour the browser then paints is cascade machinery this double does not have;
    // what it CAN say is that nothing on the row is coloured inline, which is the one way to defeat the rule.
    const inline = [];
    for (const n of w.box.children.filter((x) => x.dataset && x.dataset.fid)) {
      (function walk(x) { if (x.style && x.style.color) inline.push(x.className + "=" + x.style.color); for (const c of x.children || []) walk(c); })(n);
    }
    ok(inline.length === 0,
      "D: NOTHING ON AN EVENT ROW IS COLOURED INLINE, so the stylesheet's grey is what shows — an inline rank colour " +
      "on the name overrode it and could be near-white", inline);
    clickTier(w, "Staff");
    ok(screen(w.box).join() === "f:$new1,f:$new2,m:$s1",
      "D: EVERY TIER SEES THE SAME FEED ROWS, interleaved with ITS OWN messages", screen(w.box));
    ok(w.box.children.some((n) => n.dataset && n.dataset.fid === "$new1" && /@b:hs/.test(n.textContent) && /saved the song/.test(n.textContent)),
      "D: a feed row says who did what, in the fold's own words", w.box.children.map((n) => n.textContent));
    // CARRIED OVER FROM THE FEED PANEL (J13, `check-event-feed` PART F until ddjp_425): every name is
    // a card trigger through the one helper every surface uses (J14). Counted per feed row, so the
    // message rows' own triggers cannot make up the number.
    w.carded.length = 0;
    w.CP._repaintChat(w.box);                       // rebuild every row, so every trigger is re-wired
    const feedRows = w.box.children.filter((n) => n.dataset && n.dataset.fid);
    const msgRows = w.box.children.filter((n) => n.dataset && n.dataset.eid);
    ok(feedRows.length === 2 && w.carded.length === feedRows.length + msgRows.length &&
       w.carded.filter((x) => x === "@b:hs").length === 2,
      "D: EVERY FEED NAME OPENS THE USER CARD, like every other surface a person appears in (J14)",
      { carded: w.carded, feed: feedRows.length, msgs: msgRows.length });
    // CARRIED OVER TOO: a feature layer that throws must not take the chat down with it.
    const before = screen(w.box).filter((x) => x.indexOf("m:") === 0);
    w.sb.Room.recentEvents = () => { throw new Error("boom"); };
    let threw = null;
    try { w.CP.renderChat(); } catch (e) { threw = e.message; }
    ok(!threw && screen(w.box).filter((x) => x.indexOf("m:") === 0).join() === before.join(),
      "D: A THROWING FEED READER LEAVES THE CHAT STANDING — the messages stay, and only the feed rows the " +
      "reader can no longer vouch for leave", { threw, screen: screen(w.box) });
  }

  // ═══ PART E — which kinds show: one checkbox per KIND, with a default per kind ═══════════════
  // Owner rulings, `main/04-features.md` §The event feed: which kinds show is a device-local choice
  // (ddjp_425), made PER KIND rather than per bundle, and ON BY DEFAULT ONLY FOR SAVES, SKIPS AND
  // UNPLAYABLE-SONG SKIPS (ddjp_427). The default lives beside the kind's name in `Room.FEED_KINDS`;
  // the device stores only what a person changed.
  {
    const RULED_ON = ["ddjp.dj.save", "ddjp.dj.skip", "ddjp.media.skip"];     // the ruling, by value
    const w = world();
    const P = w.sb.ChatPrefs, KINDS = w.sb.Room.FEED_KINDS;
    const types = Object.keys(KINDS);
    ok(types.length >= 12, "E: APPLIED — the kinds are read from `Room.FEED_KINDS`, or this part has no population", types);
    for (const t of types) {
      ok(typeof KINDS[t].shownByDefault === "boolean",
        "E: EVERY KIND DECLARES ITS DEFAULT — `" + t + "` must say true or false beside its name, so a new kind " +
        "is decided the day it is added rather than inheriting whatever an absent field means", KINDS[t]);
    }
    const onByDefault = types.filter((t) => KINDS[t].shownByDefault === true).sort();
    ok(onByDefault.join() === RULED_ON.slice().sort().join(),
      "E: THE DEFAULTS ARE THE OWNER'S RULING — saves, skips and unplayable-song skips on, every other kind off " +
      "(`main/04-features.md` §The event feed, ddjp_427)", { onByDefault });

    // What a person SEES by default: one event of EVERY kind after entry, and only the ruled three show.
    w.raw("$u0", "!u:hs", 80);
    await w.CP.startChat(w.box);
    types.forEach((t, i) => w.log.push({ eventId: "$k" + i, type: t, sender: "@b:hs", ts: 1000 + i, l: 10 + i }));
    w.CP.renderChat();
    const shownKinds = () => w.box.children.filter((n) => n.dataset && n.dataset.fid)
      .map((n) => types[Number(n.dataset.fid.slice(2))]).sort();
    ok(shownKinds().join() === RULED_ON.slice().sort().join(),
      "E: BY DEFAULT THE CHAT SHOWS SAVES, SKIPS AND UNPLAYABLE-SONG SKIPS, AND NOTHING ELSE", shownKinds());

    // ONE BOX PER KIND: the pairs the bundles joined are now independent.
    P.setFeedShown("ddjp.dj.vote", true, false);     w.CP._repaintChat(w.box);
    ok(shownKinds().indexOf("ddjp.dj.vote") >= 0 && shownKinds().indexOf("ddjp.dj.save") >= 0,
      "E: turning UPVOTES on shows them and leaves SAVES as they were", shownKinds());
    P.setFeedShown("ddjp.dj.save", false, true);     w.CP._repaintChat(w.box);
    ok(shownKinds().indexOf("ddjp.dj.save") < 0 && shownKinds().indexOf("ddjp.dj.vote") >= 0,
      "E: and turning SAVES off hides them and leaves UPVOTES on — the two were one bundle until ddjp_427", shownKinds());
    ok(shownKinds().indexOf("ddjp.dj.play") < 0 && shownKinds().indexOf("ddjp.dj.skip") >= 0,
      "E: SONG STARTS and SKIPS are independent the same way: starts off, skips on", shownKinds());

    // Only what a person CHANGED is stored — choosing the default again forgets the choice.
    const store = { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
    const a = world({ localStorage: store });
    a.sb.ChatPrefs.load();
    a.sb.ChatPrefs.setFeedShown("ddjp.dj.vote", true, false);
    a.sb.ChatPrefs.setFeedShown("ddjp.dj.skip", false, true);
    a.sb.ChatPrefs.setFeedShown("ddjp.dj.play", true, false); a.sb.ChatPrefs.setFeedShown("ddjp.dj.play", false, false);
    const key = Object.keys(store._v).find((k) => { try { return "feedShow" in JSON.parse(store._v[k]); } catch (e) { return false; } });
    ok(!!key, "E: APPLIED — the choices must be in the stored blob, or the rows below have no subject", Object.keys(store._v));
    const stored = JSON.parse(store._v[key]).feedShow;
    ok(JSON.stringify(stored) === JSON.stringify({ "ddjp.dj.vote": true, "ddjp.dj.skip": false }),
      "E: ONLY WHAT WAS CHANGED FROM THE DEFAULT IS STORED — turning song starts on and back off leaves nothing, " +
      "so a later change to a default reaches every device that never chose otherwise", stored);
    const b = world({ localStorage: store });
    b.sb.ChatPrefs.load();
    ok(b.sb.ChatPrefs.feedShown("ddjp.dj.vote", false) === true && b.sb.ChatPrefs.feedShown("ddjp.dj.skip", true) === false &&
       b.sb.ChatPrefs.feedShown("ddjp.dj.save", true) === true && b.sb.ChatPrefs.feedShown("ddjp.dj.play", false) === false,
      "E: the choices survive a reload, and an unchosen kind keeps its default", null);

    // A stored blob cannot carry junk in, and the bundle setting of the build before is not honoured.
    const blob = JSON.parse(store._v[key]);
    blob.feedShow = { "ddjp.dj.vote": true, "ddjp.dj.skip": "no", evil: { body: "a chat message" } };
    blob.feedOff = { playback: true, reaction: true };
    store._v[key] = JSON.stringify(blob);
    const c = world({ localStorage: store });
    c.sb.ChatPrefs.load();
    ok(c.sb.ChatPrefs.feedShown("ddjp.dj.vote", false) === true && c.sb.ChatPrefs.feedShown("ddjp.dj.skip", true) === true,
      "E: ONLY A BOOLEAN IS A CHOICE — a stored value of any other shape is dropped on load, so this field cannot carry " +
      "a message body into a store that promises it holds none", null);
    const reloaded = JSON.parse(JSON.stringify(c.sb.ChatPrefs.load()));
    ok(!("evil" in reloaded.feedShow) && !("ddjp.dj.skip" in reloaded.feedShow),
      "E: THE JUNK IS GONE FROM THE STORE ITSELF, not merely ignored when read — only boolean choices survive a load",
      reloaded.feedShow);
    ok(!("feedOff" in reloaded),
      "E: and the per-BUNDLE setting of the build before (`feedOff`) is dropped rather than read as kinds — its keys were " +
      "group names, which no kind has", Object.keys(reloaded));

    // THE PANEL, EXTRACTED AND RUN: one checkbox per kind, in the fold's own words, reflecting the default.
    const J16 = require("./_probe-j16-active");
    const pieces = ["_feedKinds", "_feedSection"].map((n) => J16.extractFn("ui/settings.js", n));
    ok(pieces.every((x) => x.ok), "E: APPLIED — `_feedKinds` and `_feedSection` must be extractable from ui/settings.js", pieces.map((x) => x.stage));
    const vm = require("vm");
    const sb2 = { Room: w.sb.Room, ChatPrefs: w.sb.ChatPrefs, Chat: w.sb.Chat, H: { el: W.el }, console };
    vm.createContext(sb2);
    vm.runInContext(pieces.map((x) => x.source).join("\n") + ";globalThis.__sec = _feedSection;", sb2);
    const sec = sb2.__sec();
    const boxes = [];
    (function walk(n) { for (const c of n.children || []) { if (c.tag === "input") boxes.push({ box: c, label: n.textContent }); walk(c); } })(sec);
    // The room's kinds, then chat's own (ddjp_430) — the panel lists both, in that order.
    const ALLK = Object.assign({}, KINDS, w.sb.Chat.EVENT_KINDS);
    const panelTypes = Object.keys(ALLK);
    ok(boxes.length === panelTypes.length && panelTypes.length === types.length + Object.keys(w.sb.Chat.EVENT_KINDS).length,
      "E: THE PANEL HAS ONE CHECKBOX PER KIND — the room's and chat's, not a box per bundle", boxes.map((x) => x.label));
    ok(boxes.every((x, i) => x.label.toLowerCase().indexOf(ALLK[panelTypes[i]].verb.toLowerCase()) >= 0),   // both sides: "DJ"
      "E: each labelled in the fold's own words, in the table's order", boxes.map((x) => x.label));
    const fresh = world();
    const sb3 = { Room: fresh.sb.Room, ChatPrefs: fresh.sb.ChatPrefs, Chat: fresh.sb.Chat, H: { el: W.el }, console };
    vm.createContext(sb3);
    vm.runInContext(pieces.map((x) => x.source).join("\n") + ";globalThis.__sec = _feedSection;", sb3);
    const boxes3 = []; (function walk(n) { for (const c of n.children || []) { if (c.tag === "input") boxes3.push(c); walk(c); } })(sb3.__sec());
    ok(boxes3.every((x, i) => x.checked === ALLK[panelTypes[i]].shownByDefault),
      "E: on a device that has chosen nothing, each box shows its kind's DEFAULT", boxes3.map((x) => x.checked));
    const voteBox = boxes3[types.indexOf("ddjp.dj.vote")];
    voteBox.checked = true; voteBox.onchange();
    ok(fresh.sb.ChatPrefs.feedShown("ddjp.dj.vote", false) === true,
      "E: and ticking a box records the choice for that kind", null);
    const again = []; (function walk(n) { for (const c of n.children || []) { if (c.tag === "input") again.push(c); walk(c); } })(sb3.__sec());
    ok(again[types.indexOf("ddjp.dj.vote")].checked === true && again[types.indexOf("ddjp.dj.play")].checked === false,
      "E: AND THE PANEL, DRAWN AGAIN, SHOWS THE CHOICE — a panel that always drew the default would make every tick " +
      "look undone the next time it rendered", again.map((x) => x.checked));
  }

  // ═══ PART F — the Feed tab is gone and the fold is not (TEXTUAL) ════════════════════════════
  // A regex proves a name is ABSENT from the source, which is the one thing a regex can prove. It
  // says nothing about whether the chat renders the feed — PART D executes that.
  {
    const shell = read("ui/shell.js"), queue = read("ui/queue.js"), screens = read("ui/screens.js"), panels = read("ui/panels.js");
    ok(/refs\.tabChat\s*=/.test(shell), "F control: the matcher finds a tab that IS built, so the absences below are about the tree", null);
    ok(!/refs\.tabFeed\b/.test(shell) && !/refs\.feedBox\b/.test(shell), "F: ui/shell.js builds no Feed tab and no feed box", null);
    ok(!/refs\.(tabFeed|feed)\b/.test(queue), "F: ui/queue.js toggles no Feed tab", null);
    ok(!/renderFeedPanel/.test(screens + panels), "F: nothing renders a feed panel any more", null);
    const room = read("features/room.js");
    ok(/function foldFeed\(/.test(room) && /function recentEvents\(/.test(room) && /\brecentEvents, foldFeed\b/.test(room),
      "F: THE FOLD STAYS — `Room.foldFeed` and `Room.recentEvents` are still defined and exported, because the " +
      "chat reads them (owner ruling: remove the menu, keep the logic)", null);
  }

  // ═══ PART G — a deletion tombstones the row in its own channel ══════════════════════════════
  {
    const w = world();
    await w.CP.startChat(w.box);
    for (let i = 0; i < 3; i++) w.raw("$u" + i, "!u:hs", 100 + i);
    for (let i = 0; i < 2; i++) w.raw("$s" + i, "!s:hs", 200 + i);
    w.redaction("$s0", "!s:hs");                    // in the tier NOT on screen
    ok(screen(w.box).join() === "m:$u0,m:$u1,m:$u2", "G: a deletion elsewhere does not touch the visible tier", screen(w.box));
    clickTier(w, "Staff");
    const tomb = w.box.children.find((n) => n.dataset && n.dataset.eid === "$s0");
    ok(screen(w.box).join() === "m:$s0,m:$s1" && !!tomb && /Message deleted/.test(tomb.textContent),
      "G: THE TOMBSTONE IS IN ITS OWN CHANNEL, IN THE DELETED MESSAGE'S SLOT", screen(w.box));
    // A redaction from a channel NO TIER NAMES, naming an id that IS on screen under Staff. The tree
    // before ddjp_425 routed an unrecognised channel to the VISIBLE tier and tombstoned it.
    w.sb.Chat.setReadableTiers(["!u:hs", "!s:hs", "!orphan:hs"]);   // passes the door; no tier, no buffer
    w.redaction("$s1", "!orphan:hs");
    // REPAINT BEFORE READING. A redaction repaints only when ITS channel is on screen, so without this
    // the row would read the box as it was before the redaction — and a mutation that tombstoned the
    // visible tier's copy would pass, because nothing had drawn it yet. Measured: it did.
    w.CP.renderChat();
    ok(screen(w.box).join() === "m:$s0,m:$s1" && !/Message deleted/.test(w.box.children[1].textContent),
      "G: A REDACTION FROM A CHANNEL NO TIER NAMES DELETES NOTHING — not even a message of the same id in the " +
      "tier on screen. A deletion carries its own room, and a room that holds no buffer here has nothing to delete",
      w.box.children.map((n) => n.textContent));
    w.redaction("$s1", "!s:hs");                    // in the tier ON screen
    ok(screen(w.box).join() === "m:$s0,m:$s1" && /Message deleted/.test(w.box.children[1].textContent),
      "G: and on screen it is replaced in place — same slot, same row count", screen(w.box));
  }


  // ═══ PART I — the 512-character limit: one check, sending and receiving (owner ruling, ddjp_430) ══
  // No message over 512 characters can be sent, and one arriving over it is not shown. PILLARS §4's
  // rule applies to the Skin as much as to the Spine: the write-side check and the read-side check are
  // the SAME code, or the app sends what it then refuses to show. Characters are counted as a person
  // sees them — code points, so an emoji counts once — and deterministically, so every client draws
  // the line in the same place.
  {
    const w = world();
    const C = w.sb.Chat;
    ok(C.MAX_CHARS === 512 && typeof C.charCount === "function" && typeof C.isTooLong === "function",
      "I: APPLIED — `Chat.MAX_CHARS`, `Chat.charCount` and `Chat.isTooLong` must exist; they are the one check", null);
    ok(C.charCount("\u{1F44D}") === 1 && C.charCount("\u{1F44D}".repeat(512)) === 512 && "\u{1F44D}".repeat(512).length === 1024,
      "I: AN EMOJI COUNTS ONCE — 512 thumbs-up are 512 characters, though they are 1024 UTF-16 units", C.charCount("\u{1F44D}"));
    // Sending: 512 goes, 513 is refused BEFORE the transport, and the refusal says so.
    await w.CP.startChat(w.box);
    const s512 = await C.send("a".repeat(512));
    const s513 = await C.send("a".repeat(513));
    const sEmoji = await C.send("\u{1F44D}".repeat(512));
    ok(s512.ok === true && sEmoji.ok === true && w.sent.length === 2,
      "I: a message of exactly 512 characters is sent — letters or emoji", { s512, sEmoji, sent: w.sent.length });
    ok(s513.ok === false && s513.reason === "too-long" && s513.count === 513 && s513.max === 512,
      "I: ONE CHARACTER OVER IS REFUSED, with the count and the limit, so the box can say how far over", s513);
    ok(w.sent.every((x) => C.charCount(x.text) <= 512),
      "I: and nothing over the limit ever reached the transport", w.sent.map((x) => C.charCount(x.text)));
    C.openDMRoom("!dm:hs");
    const d513 = await C.sendDM("b".repeat(513));
    ok(d513.ok === false && d513.reason === "too-long" && !w.sent.some((x) => x.roomId === "!dm:hs"),
      "I: DMs have the same limit, refused the same way", d513);

    // Receiving: the same line, drawn by the same function.
    w.raw("$ok", "!u:hs", 100, "c".repeat(512));
    w.raw("$long", "!u:hs", 101, "d".repeat(600));
    const rec = w.box._chat.bufs["!u:hs"].get("$long");
    ok(rec && rec.tooLong === true && rec.body === "",
      "I: AN OVER-LONG MESSAGE IS HELD AS THE FACT THAT IT ARRIVED — its text is not kept, not even in RAM", rec);
    // THE SECOND LINE, DRIVEN ON ITS OWN. `Chat` drops the text at the door, so the buffer is never handed
    // it — which means the buffer's own drop is dominated, and a mutation deleting it stayed green. A later
    // caller that forwarded the text would put it in RAM with nothing going red, so the buffer is asked directly.
    const bx = w.sb.ChatBuffer.create();
    bx.upsert("$direct", "@a:hs", "the whole over-long text", false, 5, false, true);
    bx.prependOlder([{ id: "$older", sender: "@a:hs", body: "more over-long text", failed: false, ts: 4, tooLong: true }]);
    ok(bx.get("$direct").body === "" && bx.get("$older").body === "" && bx.get("$direct").tooLong === true,
      "I: THE BUFFER ITSELF KEEPS NO TEXT FOR AN OVER-LONG RECORD, even when a caller hands it some — the door " +
      "drops it first, and this is the line behind the door", [bx.get("$direct"), bx.get("$older")]);
    ok(W.screen(w.box).join() === "m:$ok",
      "I: BY DEFAULT IT IS NOT SHOWN, and the 512-character one beside it is — the event is off by default", W.screen(w.box));
    ok(C.EVENT_KINDS && C.EVENT_KINDS[C.TOO_LONG] && C.EVENT_KINDS[C.TOO_LONG].shownByDefault === false,
      "I: the too-long event is a CHAT event kind, declared beside its name with its default — chat never reaches " +
      "the room's log, so it cannot be one of `Room.FEED_KINDS`", C.EVENT_KINDS);
    w.sb.ChatPrefs.setFeedShown(C.TOO_LONG, true, false);
    w.CP._repaintChat(w.box);
    const row = w.box.children.find((n) => n.dataset && n.dataset.eid === "$long");
    ok(W.screen(w.box).join() === "m:$ok,m:$long" && row && row.className.indexOf("chat-feed") >= 0 &&
       /@a:hs/.test(row.textContent) && /too long to show/.test(row.textContent) && row.textContent.indexOf("dddd") < 0,
      "I: WITH ITS BOX TICKED, IT SHOWS AS A GREY EVENT IN ITS SLOT — who sent it, that it was too long, and none of it",
      { screen: W.screen(w.box), text: row && row.textContent, cls: row && row.className });
    // No badge for a message with nothing to read — least of all while its event is off.
    w.raw("$slong", "!s:hs", 150, "h".repeat(700));
    w.raw("$sctl", "!u:hs", 151, "a normal message");            // control: the visible tier's badge machinery runs
    ok(w.sb.ChatPrefs.tierUnread("staff") === false,
      "I: AN OVER-LONG MESSAGE LIGHTS NO BADGE — it has nothing to read, and a badge would point at a tier with " +
      "nothing new on it", w.sb.ChatPrefs.tierList());
    w.raw("$snorm", "!s:hs", 152, "a normal staff message");
    ok(w.sb.ChatPrefs.tierUnread("staff") === true,
      "I control: an ordinary message in that same hidden tier DOES light it, so the absence above is the rule", w.sb.ChatPrefs.tierList());
    // The boundary agrees in both directions, at every length around it.
    for (const n of [511, 512, 513]) {
      const w2 = world();
      await w2.CP.startChat(w2.box);
      const sendOk = (await w2.sb.Chat.send("e".repeat(n))).ok === true;
      w2.raw("$n" + n, "!u:hs", 200, "e".repeat(n));
      const shown = W.screen(w2.box).indexOf("m:$n" + n) >= 0;
      ok(sendOk === shown,
        "I: WRITING AND READING AGREE at " + n + " characters — what can be sent is exactly what is shown", { n, sendOk, shown });
    }
    // Backfill draws the same line.
    const w3 = world({ history: { "!u:hs": [{ id: "$old", sender: "@a:hs", body: "f".repeat(700), ts: 50 }], "!s:hs": [] } });
    await w3.CP.startChat(w3.box); await tick();
    const old = w3.box._chat.bufs["!u:hs"].get("$old");
    ok(old && old.tooLong === true && old.body === "" && W.screen(w3.box).indexOf("m:$old") < 0,
      "I: A BACKFILLED over-long message is held the same way — the fetch is the same door", old);
    // DMs: the row says so, because a DM has no event settings and silently losing a person's message is worse.
    let dm = null;
    w.sb.Chat.dmInit();                              // binds the DM handler, as the app does at entry
    w.sb.Chat.onDMMessage((id, sender, body, failed, ts, roomId, tooLong) => { dm = { id, body, tooLong }; });
    w.rawDM("$dmlong", 300, "g".repeat(900));
    ok(dm && dm.tooLong === true && dm.body === "", "I: a DM over the limit arrives flagged, with no text", dm);
    const dmRow = w.CP._chatRow(w.box, { id: "$dmlong", sender: "@a:hs", body: "", failed: false, redacted: false, tooLong: true, ts: 300 });
    ok(/too long to show/i.test(dmRow.textContent), "I: and its row in the DM panel says it was too long to show", dmRow.textContent);
    // The settings box.
    const J16 = require("./_probe-j16-active"), vm = require("vm");
    const pcs = ["_feedKinds", "_feedSection"].map((n) => J16.extractFn("ui/settings.js", n));
    const sbx = { Room: world().sb.Room, ChatPrefs: world().sb.ChatPrefs, Chat: C, H: { el: W.el }, console };
    vm.createContext(sbx); vm.runInContext(pcs.map((x) => x.source).join("\n") + ";globalThis.__k = _feedKinds;", sbx);
    const k = sbx.__k().find((x) => x.type === C.TOO_LONG);
    ok(k && k.dflt === false && /too long to show/.test(k.label.toLowerCase()),
      "I: IT HAS ITS OWN BOX among the room events in settings, off by default", k);
  }

  // ═══ PART J — mentions: the @ button, the purple dot, the accent, the chime (owner rulings, ddjp_431) ══
  // A message mentions you when it contains your FULL Matrix ID as a whole word — never a display name,
  // which is not unique and can change. Purple dot bottom-right on the tier and on the Chat tab (the
  // yellow unread dot stays top-right); a light accent on the message; a short chime for a LIVE mention,
  // on by default at a third of full volume. The @ button on a person's card puts their ID in your box.
  {
    const w0 = world(), C = w0.sb.Chat, ME = "@me:hs";
    ok(typeof C.mentions === "function", "J: APPLIED — `Chat.mentions` must exist; it is the one test of a mention", null);
    const yes = ["hey @me:hs", "@me:hs, look", "(@me:hs)", "@me:hs.", "@ME:hs!", "hi @me:hs\nnext line"];
    const no = ["@me:hs2", "x@me:hs", "@me:hs.org", "@me:hs/x", "me", "@me", "", null];
    for (const t of yes) ok(C.mentions(t, ME) === true, "J: `" + t + "` MENTIONS you — the whole ID, as a word, any case", t);
    for (const t of no) ok(C.mentions(t, ME) === false, "J: `" + t + "` does NOT — a longer ID, a fragment, or a name", t);
    ok(C.mentions("hi @me:hs", null) === false, "J: with no account there is nobody to mention", null);

    // THE CHIME, RECORDED. Each played chime starts oscillators; the peak gain says how loud.
    // ONE RECORDER PER WORLD, each its own class. A subclass sharing its parent's counter made one world's
    // chime count in another's while this part was being written — a shared handle, in the instrument.
    const mkAC = (r) => class { constructor() { this.currentTime = 0; this.destination = {}; this.state = "running"; }
      resume() { return Promise.resolve(); }
      createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
      createGain() { const g = { gain: { setValueAtTime() {}, linearRampToValueAtTime(v) { if (v > 0) r.peaks.push(v); },
        exponentialRampToValueAtTime() {} }, connect() {} }; r.chimes++; return g; } };
    const rec = { chimes: 0, peaks: [] };
    const AC = mkAC(rec);
    const w = world({ AudioContext: AC });
    await w.CP.startChat(w.box); await tick();
    const P = w.sb.ChatPrefs;
    ok(P.mentionSound() === true && P.mentionVolume() === 33,
      "J: THE SOUND IS ON BY DEFAULT AT A THIRD OF FULL VOLUME (owner ruling) — this device only", { on: P.mentionSound(), vol: P.mentionVolume() });
    w.raw("$n1", "!s:hs", 1000, "just chatting", "@b:hs");
    ok(P.tierUnread("staff") === true && P.tierMentioned("staff") === false && rec.chimes === 0,
      "J control: an ordinary message lights the yellow unread dot, not the purple one, and plays nothing", { list: P.tierList(), chimes: rec.chimes });
    // The People tab is open (ddjp_441: a button in front of you does not dot — the level model's rule).
    w.ui.rightTab = "people";
    w.raw("$m1", "!s:hs", 1001, "hey @me:hs are you there", "@b:hs");
    ok(P.tierMentioned("staff") === true, "J: A MENTION IN A TIER YOU ARE NOT VIEWING MARKS IT MENTIONED", P.tierList());
    w.CP._renderChatTierStrip();
    const staffBtn = w.refs.chatTiers.children.find((b) => /Staff/.test(b._text));
    ok(staffBtn && staffBtn.className.indexOf("mentioned") >= 0 && staffBtn.className.indexOf("unread") >= 0,
      "J: ITS STRIP BUTTON CARRIES THE PURPLE DOT beside the yellow one", staffBtn && staffBtn.className);
    ok(w.refs.tabChat.classList.contains("mentioned"),
      "J: AND SO DOES THE CHAT TAB, so a mention is visible from People or DMs", w.refs.tabChat.classList._s);
    ok(rec.chimes === 1 && rec.peaks.length === 1 && rec.peaks[0] > 0,
      "J: A LIVE MENTION PLAYS THE CHIME, once", rec);
    const peakAt33 = rec.peaks[0];
    w.raw("$m2", "!s:hs", 1002, "@me:hs again", "@b:hs");
    ok(rec.chimes === 1, "J: A BURST CHIMES ONCE — a second mention inside the gap is badged and not played", rec.chimes);
    w.box._chat.lastChimeAt -= 60000;                        // time passes
    P.setMentionVolume(66);
    w.raw("$m3", "!s:hs", 1003, "@me:hs third", "@b:hs");
    ok(rec.chimes === 2 && Math.abs(rec.peaks[rec.peaks.length - 1] - peakAt33 * 2) < 1e-6,
      "J: after the gap it plays again, and the VOLUME SETTING SCALES IT — twice the setting, twice the peak", rec.peaks);
    const before = rec.chimes;
    // YOUR OWN MESSAGE, in a world of its own: a tier with no mention yet, and the burst gap clear, so the
    // only thing that can keep the dot off and the chime silent is the rule — not a gap left by the last one.
    {
      const r3 = { chimes: 0, peaks: [] };
      const AC3 = mkAC(r3);
      const wo = world({ AudioContext: AC3 });
      await wo.CP.startChat(wo.box); await tick();
      wo.raw("$own", "!s:hs", 1004, "note to self @me:hs", ME);
      ok(wo.sb.ChatPrefs.tierMentioned("staff") === false && r3.chimes === 0,
        "J: YOUR OWN MESSAGE NEVER PINGS YOU — no purple dot and no chime, with nothing else to explain their absence",
        { mentioned: wo.sb.ChatPrefs.tierMentioned("staff"), chimes: r3.chimes });
      wo.raw("$them", "!s:hs", 1005, "and you @me:hs", "@b:hs");
      ok(wo.sb.ChatPrefs.tierMentioned("staff") === true && r3.chimes === 1,
        "J control: the same words from somebody else do — so the absence above is the own-message rule", { chimes: r3.chimes });
    }
    w.box._chat.lastChimeAt -= 60000;
    w.raw("$long", "!s:hs", 1005, "@me:hs " + "x".repeat(600), "@b:hs");
    ok(rec.chimes === before, "J: one too long to show never pings or chimes", rec.chimes);
    P.setMentionSound(false); w.box._chat.lastChimeAt -= 60000;
    w.raw("$m4", "!s:hs", 1006, "@me:hs off", "@b:hs");
    P.setMentionSound(true); P.setMentionVolume(0); w.box._chat.lastChimeAt -= 60000;
    w.raw("$m5", "!s:hs", 1007, "@me:hs zero", "@b:hs");
    ok(rec.chimes === before && P.tierMentioned("staff") === true,
      "J: SOUND OFF, or volume at zero, plays nothing — and the purple dot is still there", rec.chimes);
    // Opening the tier clears it (reached, as a person reaches it, through the Chat tab); the accent marks the message.
    w.ui.rightTab = "chat";
    const btn = W.tierButton(w, "Staff"); btn.onclick();
    ok(P.tierMentioned("staff") === false && !w.refs.tabChat.classList.contains("mentioned"),
      "J: OPENING THE TIER CLEARS THE PURPLE DOT — on its button and on the Chat tab", P.tierList());
    const mRow = w.box.children.find((n) => n.dataset && n.dataset.eid === "$m1");
    const nRow = w.box.children.find((n) => n.dataset && n.dataset.eid === "$n1");
    ok(mRow && mRow.className.indexOf("chat-mention") >= 0 && nRow && nRow.className.indexOf("chat-mention") < 0,
      "J: THE MENTIONING MESSAGE CARRIES THE ACCENT, and the ordinary one beside it does not", [mRow && mRow.className, nRow && nRow.className]);

    // HISTORY DOES NOT CHIME: a mention that arrives while the entry backfill is still in flight is the
    // scrollback, not somebody speaking now. It is badged by the read marker like any unseen message.
    const rec2 = { chimes: 0, peaks: [] };
    const AC2 = mkAC(rec2);
    const wh = world({ AudioContext: AC2, holdFetch: true, history: { "!u:hs": [], "!s:hs": [{ id: "$h", sender: "@b:hs", body: "old @me:hs", ts: 10 }] } });
    const ph = wh.CP.startChat(wh.box);
    wh.raw("$h", "!s:hs", 10, "old @me:hs", "@b:hs");
    await tick(); wh.releaseFetches(); await ph; await tick();
    ok(rec2.chimes === 0, "J: A MENTION IN HISTORY LOADING AT ENTRY DOES NOT CHIME", rec2.chimes);

    // THE @ INSERTION: the whole ID at the caret, a space either side only where there is none.
    const ins = w.CP._mentionInsert;
    ok(typeof ins === "function", "J: APPLIED — `_mentionInsert` must be exported to drive", null);
    // THE CARET GOES AFTER THE SPACE THAT FOLLOWS THE ID — inserted or already there — so typing carries on.
    const cases = [["", 0, "@a:hs ", 6], ["hi", 2, "hi @a:hs ", 9], ["hi ", 3, "hi @a:hs ", 9],
                   ["hello world", 5, "hello @a:hs world", 12], ["x", 0, "@a:hs x", 6], ["a  b", 2, "a @a:hs b", 8]];
    for (const [v, at, want, caret] of cases) {
      const r = ins(v, at, at, "@a:hs");
      ok(r.value === want && r.caret === caret, "J: inserting at " + at + " in `" + v + "` gives `" + want + "`, caret after the ID's space", r);
    }
    w.refs.chatInput.value = "hi"; w.refs.chatInput.selectionStart = w.refs.chatInput.selectionEnd = 2;
    w.CP.insertMention("@alice:hs");
    ok(w.refs.chatInput.value === "hi @alice:hs " && w.refs.chatInput.focused && w.tabsSet.indexOf("chat") >= 0,
      "J: THE @ BUTTON'S EFFECT — the ID lands in the chat box at the caret, the Chat tab is shown, the box focused",
      { value: w.refs.chatInput.value, tabs: w.tabsSet });
    // AT THE CARET, NOT AT THE END: a caret in the middle is the only case that tells the two apart.
    w.refs.chatInput.value = "hello world"; w.refs.chatInput.selectionStart = w.refs.chatInput.selectionEnd = 5;
    w.CP.insertMention("@bob:hs");
    ok(w.refs.chatInput.value === "hello @bob:hs world" && w.refs.chatInput.selectionStart === 14,
      "J: IT GOES WHERE THE CARET IS — between two words it lands between them, caret after its space", { value: w.refs.chatInput.value, caret: w.refs.chatInput.selectionStart });
    const A = loadActions(w);
    ok(A.ACTIONS.indexOf("chat.mention") >= 0 && A.describe("chat.mention", { userId: "@alice:hs" }).enabled === true,
      "J: `chat.mention` IS AN ACTION THE CARD KNOWS, always enabled — no rank gate, by decision", A.ACTIONS);
    const pr = await A.perform("chat.mention", { userId: "@alice:hs" });
    ok(pr && pr.ok === true && pr.text === "@alice:hs", "J: and performing it hands back the ID to insert", pr);
    const bad = await A.perform("chat.mention", { userId: "alice" });
    ok(bad && bad.ok === false && bad.reason === "no-user", "J: and refuses something that is not a Matrix ID", bad);
    const roster = read("ui/roster.js");
    ok(/action: "chat\.mention"[^}]*closeOnRun: true/.test(roster) && /spec\.action === "chat\.mention"[\s\S]{0,160}ChatPanels\.insertMention\(/.test(roster),
      "J: the card has the row and routes its result to `insertMention` (TEXTUAL — `check-user-card` runs the card)", null);

    // THE SETTINGS: a checkbox and a volume slider, beside the other chat settings, this device only.
    const J16 = require("./_probe-j16-active"), vm = require("vm");
    const ex = ["_soundRow", "_soundSection"].map((n) => J16.extractFn("ui/settings.js", n))
      .reduce((a, x) => ({ ok: a.ok && x.ok, stage: a.stage || (!x.ok && x.stage), source: a.source + "\n" + (x.source || "") }), { ok: true, stage: null, source: "" });
    ok(ex.ok, "J: APPLIED — `_soundRow` and `_soundSection` must be extractable from ui/settings.js", ex.stage);
    const fresh = world();
    const sbs = { ChatPrefs: fresh.sb.ChatPrefs, ChatPanels: fresh.CP, H: { el: W.el }, console };
    vm.createContext(sbs); vm.runInContext(ex.source + ";globalThis.__s = _soundSection;", sbs);
    const found = []; (function walk(n) { for (const c of n.children || []) { if (c.tag === "input") found.push(c); walk(c); } })(sbs.__s());
    const box = found.find((x) => x.attrs.type === "checkbox"), slider = found.find((x) => x.attrs.type === "range");
    ok(box && box.checked === true && slider && Number(slider.attrs.value) === 33,
      "J: THE PANEL SHOWS THE SOUND ON AND THE SLIDER AT 33 on a device that has chosen nothing", { box: box && box.checked, slider: slider && slider.attrs });
    slider.value = "50"; slider.onchange();
    box.checked = false; box.onchange();
    ok(fresh.sb.ChatPrefs.mentionVolume() === 50 && fresh.sb.ChatPrefs.mentionSound() === false,
      "J: and moving the slider or unticking the box records it", { vol: fresh.sb.ChatPrefs.mentionVolume(), on: fresh.sb.ChatPrefs.mentionSound() });
  }

  // ═══ PART K — DMs: the purple dot with no count, and a chime of their own (owner rulings, ddjp_432) ══
  {
    const mk = (r) => class { constructor() { this.currentTime = 0; this.destination = {}; this.state = "running"; }
      resume() { return Promise.resolve(); }
      createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
      createGain() { r.chimes++; return { gain: { setValueAtTime() {}, linearRampToValueAtTime(v) { if (v > 0) r.peaks.push(v); },
        exponentialRampToValueAtTime() {} }, connect() {} }; } };
    const r = { chimes: 0, peaks: [] };
    const w = world({ AudioContext: mk(r) });
    const P = w.sb.ChatPrefs;
    w.refs.tabDM = W.el("button");
    w.sb.Chat.dmInit();
    w.CP._wireDMPanel();
    ok(P.dmSound() === true && P.dmVolume() === 33, "K: the DM sound is its own setting, on at a third by default", { on: P.dmSound(), vol: P.dmVolume() });
    w.rawDM("$d1", 300, "hello", "@a:hs");
    ok(r.chimes === 1, "K: A NEW DM CHIMES", r);
    w.CP._renderDMBadge();
    ok(w.refs.tabDM.textContent === "DMs" && w.refs.tabDM.classList.contains("mentioned"),
      "K: THE DMS TAB SHOWS THE PURPLE DOT AND NO COUNT (owner ruling)", { text: w.refs.tabDM.textContent, cls: w.refs.tabDM.classList._s });
    w.CP._resetDMChimeGap(); w.rawDM("$d2", 301, "mine", "@me:hs");
    w.CP._resetDMChimeGap(); w.rawDM("$d0", 100, "older, arriving late", "@a:hs");
    ok(r.chimes === 1, "K: YOUR OWN DM, and one older than what the conversation already holds (history), never chime", r.chimes);
    P.setMentionSound(false); w.CP._resetDMChimeGap(); w.rawDM("$d3", 302, "again", "@a:hs");
    ok(r.chimes === 2, "K: THE DM SOUND IS SEPARATE — the mention sound off does not silence it", r.chimes);
    const p33 = r.peaks[r.peaks.length - 1];
    P.setDMVolume(66); w.CP._resetDMChimeGap(); w.rawDM("$d4", 303, "louder", "@a:hs");
    ok(r.chimes === 3 && Math.abs(r.peaks[r.peaks.length - 1] - 2 * p33) < 1e-6, "K: and its own volume scales it", r.peaks);
    P.setDMSound(false); w.CP._resetDMChimeGap(); w.rawDM("$d5", 304, "quiet", "@a:hs");
    ok(r.chimes === 3, "K: and its own switch turns it off", r.chimes);
    w.sb.Chat.openDMRoom("!dm:hs");
    w.CP._renderDMBadge();
    ok(!w.refs.tabDM.classList.contains("mentioned") && w.refs.tabDM.textContent === "DMs",
      "K: OPENING THE CONVERSATION CLEARS THE DOT", w.refs.tabDM.classList._s);
  }

  // ═══ PART L — the DM list: requests as rows, and a search box (owner rulings, ddjp_433) ═══════════
  {
    const w = world({ invites: [{ roomId: "!s1:hs", from: "@spam:hs", ts: 2000 }, { roomId: "!s2:hs", from: "@spam:hs", ts: 2100 },
                               { roomId: "!c1:hs", from: "@carl:hs", ts: 500 }] });
    w.refs.dmBox = W.el("div"); w.refs.tabDM = W.el("button");
    w.sb.ChatPrefs.dmTouch("!dm:hs", "@alice:hs", 3000);
    w.CP.renderDMPanel();
    const all = [];
    (function walk(n) { for (const c of n.children || []) { all.push(c); walk(c); } })(w.refs.dmBox);
    const rowsOf = () => { const out = []; (function walk(n) { for (const c of n.children || []) { if (/\bdm-row\b/.test(c.className)) out.push(c); walk(c); } })(w.refs.dmBox); return out; };
    const search = all.find((n) => n.tag === "input" && /\bdm-search\b/.test(n.className));
    ok(!!search, "L: THE LIST HAS A SEARCH BOX", all.filter((n) => n.tag === "input").map((n) => n.className));
    const rows = rowsOf();
    ok(rows.length === 3 && /alice/.test(rows[0].textContent) && /spam/.test(rows[1].textContent) && /carl/.test(rows[2].textContent),
      "L: ONE ROW PER PERSON, requests among conversations, most recent at the top", rows.map((r) => r.textContent));
    const req = rows[1];
    const btns = []; (function walk(n) { for (const c of n.children || []) { if (c.tag === "button") btns.push(c); walk(c); } })(req);
    ok(/wants to chat/.test(req.textContent) && btns.map((b) => b._text).join() === "Accept,Refuse" && /\bdm-row\b/.test(req.className) && /\broom-item\b/.test(req.className),
      "L: A REQUEST LOOKS LIKE A CONVERSATION — the same row — saying it wants to chat, with Accept and Refuse inside it",
      { text: req.textContent, btns: btns.map((b) => b._text), cls: req.className });
    // Many clicks, one answer: the buttons lock while it is in flight.
    const ev = { stopPropagation() {} };
    btns[0].onclick(ev); btns[0].onclick(ev); btns[1].onclick(ev);
    ok(btns[0].disabled === true && btns[1].disabled === true, "L: BOTH BUTTONS LOCK THE MOMENT ONE IS PRESSED", btns.map((b) => b.disabled));
    await new Promise((r) => setTimeout(r, 30));
    ok(w.accepted.slice().sort().join() === "!s1:hs,!s2:hs" && w.declined.length === 0,
      "L: SO THREE CLICKS GIVE ONE ANSWER — every invite from that person accepted once, nothing refused", { accepted: w.accepted, declined: w.declined });
    // Search: by name or by Matrix ID; typing filters the list only, so the box keeps its text.
    w.CP.renderDMPanel();
    const s2 = []; (function walk(n) { for (const c of n.children || []) { if (c.tag === "input" && /\bdm-search\b/.test(c.className)) s2.push(c); walk(c); } })(w.refs.dmBox);
    s2[0].value = "CARL"; s2[0].oninput();
    ok(rowsOf().length === 1 && /carl/.test(rowsOf()[0].textContent), "L: SEARCHING A NAME SHOWS ONLY THAT PERSON, any case", rowsOf().map((r) => r.textContent));
    s2[0].value = "@alice:hs"; s2[0].oninput();
    ok(rowsOf().length === 1 && /alice/.test(rowsOf()[0].textContent), "L: and a full Matrix ID finds them too", rowsOf().map((r) => r.textContent));
    s2[0].value = "nobody-here"; s2[0].oninput();
    ok(rowsOf().length === 0 && /No conversations match/.test(w.refs.dmBox.textContent), "L: and no match SAYS so", w.refs.dmBox.textContent.slice(0, 200));
    w.CP.renderDMPanel();
    const s3 = []; (function walk(n) { for (const c of n.children || []) { if (c.tag === "input" && /\bdm-search\b/.test(c.className)) s3.push(c); walk(c); } })(w.refs.dmBox);
    ok(s3[0].value === "nobody-here" && rowsOf().length === 0, "L: a redraw keeps what you typed and the filter it applies", s3[0].value);
  }

  // ═══ PART L2 — ONE box finds people AND starts a chat (owner request, ddjp_434) ═════════════════
  // There were two text boxes: the search at the top and "@someone:server / Start" at the bottom, alike
  // and unlabelled; and with no conversations yet the panel stopped before the bottom one, so a new
  // person could not start a chat by ID at all. Now the search box does both.
  {
    const find = (w, pred) => { const out = []; (function walk(n) { for (const c of n.children || []) { if (pred(c)) out.push(c); walk(c); } })(w.refs.dmBox); return out; };
    const searchOf = (w) => find(w, (c) => c.tag === "input" && /\bdm-search\b/.test(c.className))[0];
    const w = world();
    w.refs.dmBox = W.el("div"); w.refs.tabDM = W.el("button");
    w.CP.renderDMPanel();
    ok(!!searchOf(w), "L2: WITH NO CONVERSATIONS YET THE SEARCH BOX IS THERE — the panel used to stop before its start box", w.refs.dmBox.textContent);
    ok(/full Matrix ID/.test(w.refs.dmBox.textContent), "L2: and the empty list says how to start one from it", w.refs.dmBox.textContent);
    ok(find(w, (c) => c.tag === "input").length === 1 && !find(w, (c) => /\bdm-new-id\b/.test(c.className)).length,
      "L2: THERE IS ONE TEXT BOX, not two — the bottom start box is gone", find(w, (c) => c.tag === "input").map((c) => c.className));
    const s = searchOf(w);
    s.value = "@newfriend:hs"; s.oninput();
    const start = find(w, (c) => /\bdm-start\b/.test(c.className));
    ok(start.length === 1 && /Start a chat with/.test(start[0].textContent) && /@newfriend:hs/.test(start[0].textContent) && /\broom-item\b/.test(start[0].className),
      "L2: A FULL MATRIX ID NOT IN YOUR LIST OFFERS A \"Start a chat with …\" ROW, in the list's own row shape", start.map((x) => x.textContent));
    start[0].onclick();
    await new Promise((r) => setTimeout(r, 5));
    ok(w.performed.length === 1 && w.performed[0].a === "chat.dm" && w.performed[0].ctx.userId === "@newfriend:hs",
      "L2: AND ONE CLICK STARTS IT, through the adapter the card's Message button uses", w.performed);
    // Somebody already in the list: their row, no start row.
    const w2 = world();
    w2.refs.dmBox = W.el("div"); w2.refs.tabDM = W.el("button");
    w2.sb.ChatPrefs.dmTouch("!dm:hs", "@alice:hs", 3000);
    w2.CP.renderDMPanel();
    const s2 = searchOf(w2); s2.value = "@alice:hs"; s2.oninput();
    ok(!find(w2, (c) => /\bdm-start\b/.test(c.className)).length && find(w2, (c) => /\bdm-row\b/.test(c.className)).length === 1,
      "L2: an ID already in your list shows THEIR row and offers nothing new", find(w2, (c) => /\bdm-row\b/.test(c.className)).map((r) => r.textContent));
    s2.value = "@me:hs"; s2.oninput();
    ok(!find(w2, (c) => /\bdm-start\b/.test(c.className)).length && /That is you/.test(w2.refs.dmBox.textContent),
      "L2: YOUR OWN ID offers no row and says so", w2.refs.dmBox.textContent.slice(-120));
    // ENTER ON YOUR OWN ID STARTS NOTHING. The list checks you first and never offers a row, so only the
    // Enter path reaches `_dmStartable`'s own self rule — a mutation removing that rule was green until
    // this row pressed Enter.
    const before = w2.performed.length;
    s2.onkeydown({ key: "Enter", preventDefault() {} });
    await new Promise((r) => setTimeout(r, 5));
    ok(w2.performed.length === before, "L2: AND PRESSING ENTER ON IT STARTS NOTHING", w2.performed);
    s2.value = "@bob"; s2.oninput();
    ok(!find(w2, (c) => /\bdm-start\b/.test(c.className)).length && /full ID/.test(w2.refs.dmBox.textContent),
      "L2: A PARTIAL ID says to type the full one", w2.refs.dmBox.textContent.slice(-160));
    // A refusal is named under the box — the rule the bottom box kept, moved with it.
    const w3 = world({ performResult: { ok: false, reason: "no-user" } });
    w3.refs.dmBox = W.el("div"); w3.refs.tabDM = W.el("button");
    w3.CP.renderDMPanel();
    const s3 = searchOf(w3); s3.value = "@ghost:hs"; s3.oninput();
    find(w3, (c) => /\bdm-start\b/.test(c.className))[0].onclick();
    await new Promise((r) => setTimeout(r, 5));
    const err = find(w3, (c) => /\bdm-new-error\b/.test(c.className));
    ok(err.length === 1 && /user id/.test(err[0].textContent),
      "L2: A REFUSAL IS NAMED, under the search box — never swallowed", w3.refs.dmBox.textContent.slice(-200));
  }

  // ═══ PART L4 — a conversation that cannot open SAYS so (ddjp_437) ═══════════════════════════════
  {
    const w = world();
    w.refs.dmBox = W.el("div"); w.refs.tabDM = W.el("button");
    w.sb.ChatPrefs.dmTouch("!gone:hs", "", 3000);               // a room that is gone, and nobody known
    w.CP.renderDMPanel();
    const rows = []; (function walk(n) { for (const c of n.children || []) { if (/\bdm-row\b/.test(c.className)) rows.push(c); walk(c); } })(w.refs.dmBox);
    rows[0].onclick();
    ok(/could not be opened/.test(w.refs.dmBox.textContent) && /gone/.test(w.refs.dmBox.textContent) && !/Try again/.test(w.refs.dmBox.textContent),
      "L4: A CLICK THAT CANNOT OPEN A CONVERSATION SAYS SO — the tree before this redrew the list and nothing else, which " +
      "looks exactly like the app ignoring the click", w.refs.dmBox.textContent.slice(0, 200));
  }

  // A gone room WITH a known person opens as that conversation, named from the person, saying it has no room.
  {
    const w = world();
    w.refs.dmBox = W.el("div"); w.refs.tabDM = W.el("button");
    w.sb.ChatPrefs.dmTouch("!gone2:hs", "@zed:hs", 3000);
    w.CP.renderDMPanel();
    const rows = []; (function walk(n) { for (const c of n.children || []) { if (/\bdm-row\b/.test(c.className)) rows.push(c); walk(c); } })(w.refs.dmBox);
    rows[0].onclick();
    const title = []; (function walk(n) { for (const c of n.children || []) { if (/\bdm-title\b/.test(c.className)) title.push(c); walk(c); } })(w.refs.dmBox);
    ok(title.length === 1 && /@zed:hs/.test(title[0].textContent) && /no room with them/.test(w.refs.dmBox.textContent),
      "L4: A CONVERSATION WHOSE ROOM IS GONE OPENS, NAMED FROM THE PERSON, and says the first message starts a new room " +
      "(its title was taken from the reply room, which is none here — it would have been blank)", { title: title.map((t) => t.textContent), text: w.refs.dmBox.textContent.slice(0, 160) });
  }

  // ═══ PART L3 — suggestions from the space, and Clear list out of the way (owner request, ddjp_435) ══
  // Typing the start of somebody's user name — no "@" needed — suggests people who are MEMBERS OF THE
  // SPACE, online or not (`Room.getRoster()`: the space's joined members, the list the People panel
  // uses). And the "Clear list" button steps aside while you type.
  {
    const find = (w, pred) => { const out = []; (function walk(n) { for (const c of n.children || []) { if (pred(c)) out.push(c); walk(c); } })(w.refs.dmBox); return out; };
    const searchOf = (w) => find(w, (c) => c.tag === "input" && /\bdm-search\b/.test(c.className))[0];
    // An EXACT class match: `\bdm-suggest\b` also matched the heading's `dm-suggest-head` (a `-` is a word
    // boundary), which read as a third suggestion while this part was being written.
    const sugg = (w) => find(w, (c) => /(^|\s)dm-suggest(\s|$)/.test(c.className));
    const w = world();
    w.refs.dmBox = W.el("div"); w.refs.tabDM = W.el("button");
    const roster = [{ userId: "@me:hs", name: "Me" }, { userId: "@alice:hs", name: "Alice" }, { userId: "@alfred:hs", name: "Alfie" },
      { userId: "@bob:hs", name: "Bob" }, { userId: "@x123:hs", name: "Zed Smith" }, { userId: "@carol:hs", name: "Carol" }];
    for (let i = 1; i <= 60; i++) roster.push({ userId: "@user" + String(i).padStart(2, "0") + ":hs", name: "User " + i });
    w.sb.Room.getRoster = () => roster;
    w.sb.ChatPrefs.dmTouch("!dm:hs", "@carol:hs", 3000);        // Carol is already a conversation
    w.CP.renderDMPanel();
    const clear = find(w, (c) => c.tag === "button" && c._text === "Clear list")[0];
    ok(clear && clear.style.display !== "none", "L3 premise: with a conversation in the list, Clear list is there", clear && clear.style);
    const s = searchOf(w);
    s.value = "al"; s.oninput();
    ok(clear.style.display === "none", "L3: CLEAR LIST STEPS ASIDE WHILE YOU TYPE", clear.style);
    s.value = ""; s.oninput();
    ok(clear.style.display !== "none", "L3: and comes back when the box is empty", clear.style);
    s.value = "al"; s.oninput();
    const names = () => sugg(w).map((r) => r.textContent);
    ok(sugg(w).length === 2 && names().some((t) => /@alice:hs/.test(t)) && names().some((t) => /@alfred:hs/.test(t)) && !names().some((t) => /@bob:hs/.test(t)),
      "L3: TYPING THE START OF A USER NAME, WITHOUT @, SUGGESTS THE SPACE'S MEMBERS WHOSE NAME STARTS SO", names());
    ok(/People in this space/.test(w.refs.dmBox.textContent) && sugg(w).every((r) => /\broom-item\b/.test(r.className) && /Start a chat/.test(r.textContent)),
      "L3: under a heading, each in the list's own row shape, saying what a click does", names());
    s.value = "@ALI"; s.oninput();
    ok(sugg(w).length === 1 && /@alice:hs/.test(names()[0]), "L3: with an @, in any case, the same", names());
    s.value = "smi"; s.oninput();
    ok(sugg(w).length === 1 && /@x123:hs/.test(names()[0]), "L3: a word of the display name counts too — \"smi\" finds Zed Smith", names());
    s.value = "ice"; s.oninput();
    ok(sugg(w).length === 0, "L3: THE START of a name, not the middle — \"ice\" does not suggest Alice", names());
    s.value = "me"; s.oninput();
    ok(sugg(w).length === 0, "L3: never yourself", names());
    s.value = "car"; s.oninput();
    ok(sugg(w).length === 0 && find(w, (c) => /\bdm-row\b/.test(c.className) && !/\bdm-suggest\b/.test(c.className)).length === 1,
      "L3: SOMEONE ALREADY IN YOUR LIST shows as their conversation, not as a suggestion too", names());
    s.value = "user"; s.oninput();
    ok(sugg(w).length === 50, "L3: AT MOST FIFTY suggestions (owner request, ddjp_436 — it was eight), of the 60 who match", sugg(w).length);
    const box = find(w, (c) => /(^|\s)dm-suggest-list(\s|$)/.test(c.className));
    ok(box.length === 1 && sugg(w).every((r) => r.parent === box[0]),
      "L3: ALL OF THEM IN ONE SCROLLABLE BOX of their own, so they never push your conversations out of view", box.length);
    // TEXTUAL, and says so: whether the box scrolls is the browser's cascade, which no double renders.
    ok(/\.dm-suggest-list\s*\{[^}]*max-height:[^;]+;[^}]*overflow-y:\s*auto/.test(read("index.html")),
      "L3: and the stylesheet gives that box a height limit and a scrollbar (TEXTUAL)", null);
    s.value = "alic"; s.oninput();
    sugg(w)[0].onclick();
    await new Promise((r) => setTimeout(r, 5));
    ok(w.performed.length === 1 && w.performed[0].ctx.userId === "@alice:hs",
      "L3: ONE CLICK STARTS A CHAT WITH THEM, through the adapter", w.performed);
    // The click OPENED that conversation (as it should), so go back to the list the way a person does.
    ok(typeof w.CP._dmResetToList === "function", "L3: APPLIED — the panel's back-to-list must be reachable", null);
    w.CP._dmResetToList();
    w.CP.renderDMPanel();
    const s2 = searchOf(w);
    ok(!!s2, "L3 premise: back on the list, with its search box", w.refs.dmBox.textContent.slice(0, 120));
    s2.value = "bo"; s2.oninput();
    s2.onkeydown({ key: "Enter", preventDefault() {} });
    await new Promise((r) => setTimeout(r, 5));
    ok(w.performed.length === 2 && w.performed[1].ctx.userId === "@bob:hs",
      "L3: ENTER PICKS THE TOP SUGGESTION when no conversation matches", w.performed.map((p) => p.ctx.userId));
  }

  // ═══ PART M — notification dots at every level, in every layout (owner rulings, ddjp_441) ════════
  // Every button on the way to something new shows a dot; opening one clears it and nothing deeper;
  // nothing is dotted above what was read; purple is personal (DM, request, mention), orange is other chat;
  // on joining only DMs carry over.
  {
    // Both places a class can live on the double: `classList` (toggled) and the `className` string (built with
    // it — how the tier buttons are made). Reading only one read the tier buttons as empty.
    const cls = (n) => n ? Object.keys((n.classList && n.classList._s) || {}).concat(String(n.className || "").split(/\s+/).filter(Boolean)) : [];
    const has = (n, c) => cls(n).indexOf(c) >= 0;
    const mkNav = (w, ids) => { w.refs.paneNav = W.el("div"); for (const id of ids) { const b = W.el("button"); b.dataset.pane = id; b.className = "pane-nav-btn"; w.refs.paneNav.appendChild(b); } };
    const nav = (w, id) => w.refs.paneNav.children.find((b) => b.dataset.pane === id);
    const tier = (w, label) => { w.CP._renderChatTierStrip(); return w.refs.chatTiers.children.find((b) => (b._text || "").indexOf(label) === 0); };
    const dots = (w) => w.CP._renderLevelDots();
    ok(typeof W.world().CP._renderLevelDots === "function", "M: APPLIED — `_renderLevelDots` must exist", null);

    // ── COMPACT, looking at the Queues side ──
    const w = world();
    w.refs.tabDM = W.el("button"); mkNav(w, ["social", "queues"]);
    w.ui.panes = { social: false, queues: true, player: true };      // compact, Queues showing
    await w.CP.startChat(w.box); await tick();
    w.raw("$p1", "!s:hs", 5000, "hello presence", "@b:hs");
    dots(w);
    ok(has(nav(w, "social"), "unread") && has(w.refs.tabChat, "unread") && has(tier(w, "Staff"), "unread"),
      "M: COMPACT ON QUEUES — A NEW CHAT MESSAGE LIGHTS EVERY BUTTON ON THE WAY: the Chat switch, the Chat tab, the tier",
      { nav: cls(nav(w, "social")), tab: cls(w.refs.tabChat), tier: cls(tier(w, "Staff")) });
    ok(!has(nav(w, "queues"), "unread"), "M: and not the side you are on, which has nothing new", cls(nav(w, "queues")));
    // A message in the tier you last viewed, while it is NOT on screen, is not marked read.
    w.raw("$u1", "!u:hs", 5001, "hello everyone", "@b:hs");
    ok(w.sb.ChatPrefs.tierUnread("uncategorized") === true,
      "M: A MESSAGE IN THE TIER YOU LAST VIEWED IS NOT MARKED READ WHILE THAT TIER IS OFF SCREEN — it was, so in " +
      "Compact on Queues it lit nothing and you missed it", w.sb.ChatPrefs.tierList());
    // Click the Chat switch: the Chat tab is what shows (the switch opens it), so both clear; the tier keeps its dot.
    w.ui.panes = { social: true, queues: false, player: true }; w.ui.rightTab = "chat";
    dots(w);
    ok(!has(nav(w, "social"), "unread") && !has(w.refs.tabChat, "unread") && has(tier(w, "Staff"), "unread"),
      "M: OPENING THE CHAT SWITCH CLEARS IT AND THE CHAT TAB THAT IT SHOWS — THE STAFF TIER KEEPS ITS DOT until opened",
      { nav: cls(nav(w, "social")), tab: cls(w.refs.tabChat), tier: cls(tier(w, "Staff")) });
    ok(w.sb.ChatPrefs.tierUnread("uncategorized") === false, "M: and the tier now on screen is read", w.sb.ChatPrefs.tierList());
    W.tierButton(w, "Staff").onclick();
    dots(w);
    ok(!has(tier(w, "Staff"), "unread"), "M: OPENING THE STAFF TIER CLEARS IT", cls(tier(w, "Staff")));
    // Back to Queues; something new re-lights the path.
    w.ui.panes = { social: false, queues: true, player: true };
    w.raw("$p2", "!s:hs", 5002, "again", "@b:hs");
    dots(w);
    ok(has(nav(w, "social"), "unread") && has(w.refs.tabChat, "unread"), "M: SOMETHING NEW LATER LIGHTS THE PATH AGAIN", { nav: cls(nav(w, "social")) });
    // Purple for a mention, and for a DM.
    w.raw("$m1", "!u:hs", 5003, "hey @me:hs", "@b:hs");
    dots(w);
    ok(has(nav(w, "social"), "mentioned") && has(w.refs.tabChat, "mentioned"), "M: A MENTION IS PURPLE ON EVERY LEVEL ON THE WAY", { nav: cls(nav(w, "social")), tab: cls(w.refs.tabChat) });
    w.sb.Chat.dmInit(); w.CP._wireDMPanel();
    w.rawDM("$d1", 5004, "a DM", "@a:hs");
    dots(w);
    ok(has(w.refs.tabDM, "mentioned") && has(nav(w, "social"), "mentioned"), "M: A DM IS PURPLE — on the DMs tab and the switch above it", { dm: cls(w.refs.tabDM) });
    // Open the social side on the DMs tab: switch and DMs tab clear; the Chat tab keeps its dot (not opened).
    w.ui.panes = { social: true, queues: false, player: true }; w.ui.rightTab = "dm";
    dots(w);
    ok(!has(w.refs.tabDM, "mentioned") && !has(nav(w, "social"), "mentioned") && !has(nav(w, "social"), "unread") && has(w.refs.tabChat, "mentioned"),
      "M: OPENING THE DMS TAB CLEARS IT AND THE SWITCH — THE CHAT TAB, NOT OPENED, KEEPS ITS DOT", { chat: cls(w.refs.tabChat), dm: cls(w.refs.tabDM) });

    // ── PHONE, on the Player: the same path, with the three-way switch ──
    const p = world();
    p.refs.tabDM = W.el("button"); mkNav(p, ["queues", "player", "social"]);
    p.ui.panes = { social: false, queues: false, player: true };
    await p.CP.startChat(p.box); await tick();
    p.raw("$x1", "!s:hs", 6000, "hi", "@b:hs");
    dots(p);
    ok(has(nav(p, "social"), "unread") && !has(nav(p, "player"), "unread") && has(p.refs.tabChat, "unread"),
      "M: PHONE — THE SAME PATH, starting from its own switch", { nav: p.refs.paneNav.children.map(cls) });
    // A DM ALONE makes the switch purple — here, where no mention has already made it so (the row above that
    // said it ran after one, and passed whether or not a DM lit anything).
    ok(!has(nav(p, "social"), "mentioned"), "M premise: nothing personal yet, so the switch is not purple", cls(nav(p, "social")));
    p.sb.Chat.dmInit(); p.CP._wireDMPanel();
    p.rawDM("$pd1", 6001, "a DM", "@a:hs");
    dots(p);
    ok(has(nav(p, "social"), "mentioned") && has(p.refs.tabDM, "mentioned"),
      "M: A DM ON ITS OWN MAKES THE SWITCH ABOVE IT PURPLE, and the DMs tab", { nav: cls(nav(p, "social")), dm: cls(p.refs.tabDM) });

    // ── WIDE: no switch, so the path starts at the tabs ──
    const wd = world();
    wd.refs.tabDM = W.el("button");
    wd.ui.rightTab = "people";
    await wd.CP.startChat(wd.box); await tick();
    wd.raw("$y1", "!s:hs", 7000, "hi", "@b:hs");
    dots(wd);
    ok(has(wd.refs.tabChat, "unread") && has(tier(wd, "Staff"), "unread"), "M: WIDE — the Chat tab and the tier, while the People tab is open", cls(wd.refs.tabChat));

    // ── ON JOINING, only DMs carry over ──
    const store = { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
    const before = world({ localStorage: store });
    before.sb.ChatPrefs.load();
    before.sb.ChatPrefs.tierTouch("staff", 100);                    // last session: an unread chat tier
    before.sb.ChatPrefs.dmTouch("!dm:hs", "@a:hs", 100);            // and an unread DM
    const after = world({ localStorage: store });
    after.sb.ChatPrefs.load();
    after.refs.tabDM = W.el("button");
    after.ui.rightTab = "people";
    await after.CP.startChat(after.box); await tick();
    after.CP._renderLevelDots();
    ok(after.sb.ChatPrefs.tierUnread("staff") === false && !has(after.refs.tabChat, "unread"),
      "M: ON JOINING, LAST SESSION'S CHAT UNREAD IS GONE — chat counts from the moment you join", after.sb.ChatPrefs.tierList());
    ok(has(after.refs.tabDM, "mentioned"), "M: BUT AN UNREAD DM IS STILL UNREAD, and says so", cls(after.refs.tabDM));
    // History loading at entry is not new: the backfill lights no dot.
    const hw = world({ history: { "!u:hs": [], "!s:hs": [{ id: "$old1", sender: "@b:hs", body: "from before", ts: 90 }] } });
    hw.ui.rightTab = "people";
    await hw.CP.startChat(hw.box); await tick();
    hw.raw("$old1", "!s:hs", 90, "from before", "@b:hs");            // the scrollback copy, arriving late
    hw.CP._renderLevelDots();
    ok(hw.sb.ChatPrefs.tierUnread("staff") === false && !has(hw.refs.tabChat, "unread"),
      "M: HISTORY LOADING AT ENTRY LIGHTS NO DOT — only what arrives after you join", hw.sb.ChatPrefs.tierList());
    // An OPEN DM behind another tab: a new message in it stays unread until you look.
    const dw = world();
    dw.refs.tabDM = W.el("button");
    dw.sb.Chat.dmInit(); dw.CP._wireDMPanel();
    dw.rawDM("$first", 100, "hi", "@a:hs");
    // Opened the way a person opens it — through the panel, so the panel is SHOWING the conversation; opening it
    // through `Chat` alone left the panel on its list, where the conversation is (rightly) not on screen.
    dw.CP._openDMFromAction("!dm:hs");                             // the conversation is open…
    dw.ui.rightTab = "chat";                                       // …but you are looking at the Chat tab
    dw.CP._renderLevelDots();
    dw.rawDM("$second", 200, "are you there?", "@a:hs");
    dw.CP._renderLevelDots();
    ok(dw.sb.Chat.conversations()[0].unread === true && has(dw.refs.tabDM, "mentioned"),
      "M: A NEW MESSAGE IN AN OPEN DM BEHIND ANOTHER TAB STAYS UNREAD, and the DMs tab says so — it was read on arrival", dw.sb.Chat.conversations());
    dw.ui.rightTab = "dm"; dw.CP._renderLevelDots();
    ok(dw.sb.Chat.conversations()[0].unread === false, "M: and it is read the moment the DMs tab is in front of you", dw.sb.Chat.conversations());
  }

  // ═══ PART N — no loop, no flood: read markers do not repaint the chat (reported: "now the app freezes") ═══
  // Reproduced at ddjp_441 (/tmp/probe-loop.js), with `onChange` wired as `ui/screens.js` wires it: ONE message
  // with the chat on screen fired it 3141 times — each a full rebuild of every chat row, nested 1117 deep.
  // Drawing the dots marks the on-screen tier read; `tierMarkRead` saved and fired `onChange` even when nothing
  // moved; the listener rebuilt the chat and redrew the strip; the strip drew the dots; and round again.
  {
    const w = world();
    w.refs.tabDM = W.el("button");
    let emits = 0, depth = 0, maxDepth = 0;
    w.sb.ChatPrefs.onChange(() => { emits++; depth++; maxDepth = Math.max(maxDepth, depth);
      try { w.CP._repaintChat(w.refs.chatBox); w.CP._renderChatTierStrip(); } finally { depth--; } });
    await w.CP.startChat(w.box); await tick();
    emits = 0;
    w.raw("$n1", "!u:hs", 5000, "on screen", "@b:hs");
    w.raw("$n2", "!s:hs", 5001, "off screen", "@b:hs");
    w.CP._renderLevelDots();
    W.tierButton(w, "Staff").onclick();
    ok(emits === 0 && maxDepth === 0,
      "N: MESSAGES, DOTS AND OPENING A TIER FIRE NO DISPLAY-CHANGE AT ALL — a read marker is not a display preference, so " +
      "it never rebuilds the chat. One message used to fire it 3141 times", { emits, maxDepth });
    ok(w.sb.ChatPrefs.tierUnread("staff") === false && w.sb.ChatPrefs.tierUnread("uncategorized") === false,
      "N control: the markers still MOVED — the tiers opened are read — so the silence above is not markers that stopped working", w.sb.ChatPrefs.tierList());
    w.sb.ChatPrefs.setImagesEnabled(false);
    ok(emits === 1, "N control: a DISPLAY preference still fires it, exactly once — the listener is wired and works", emits);
    // A marker that does not move does not write.
    const store = { _v: {}, n: 0, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this.n++; this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
    const q = world({ localStorage: store });
    q.sb.ChatPrefs.load();
    q.sb.ChatPrefs.tierTouch("staff", 100); q.sb.ChatPrefs.tierMarkRead("staff", 100);
    const n0 = store.n;
    q.sb.ChatPrefs.tierMarkRead("staff", 100); q.sb.ChatPrefs.tierMarkRead("staff", 50);
    ok(store.n === n0, "N: A READ MARKER THAT DOES NOT MOVE DOES NOT WRITE — again, or at an older stamp, is not a change", { before: n0, after: store.n });
    q.sb.ChatPrefs.dmTouch("!dm:hs", "@a:hs", 100);
    const n1 = store.n;
    q.sb.ChatPrefs.dmMarkRead("!dm:hs", 100);
    const n2 = store.n;
    q.sb.ChatPrefs.dmMarkRead("!dm:hs", 100);
    ok(n2 - n1 === 1 && store.n === n2, "N: and a DM marker writes once when it moves, not again when it does not", { n1, n2, after: store.n });
  }

  // ═══ PART N2 — the tier row is drawn ONCE, even if something redraws it mid-draw (reported with a screenshot) ══
  // The owner's screenshot at ddjp_441: the tier row stacked over and over. Replayed (/tmp/probe-strip.js): one
  // message left 1149 copies. The row CLEARED, then drew the dots in the MIDDLE of rebuilding, and the loop behind
  // the freeze redrew the whole row from inside the dots — each nested row added a full set, then the outer added
  // another. ddjp_442 stopped the loop (1 copy). This makes the row safe whatever redraws it: the dots are drawn
  // AFTER the row is built. Driven by forcing exactly that nested redraw.
  {
    const w = world();
    w.refs.tabDM = W.el("button");
    await w.CP.startChat(w.box); await tick();
    // Into the tier ON SCREEN — the dots only mark that one read, so a message elsewhere never reaches the redraw.
    w.raw("$z1", "!u:hs", 5000, "x", "@b:hs");
    const real = w.sb.ChatPrefs.tierMarkRead;
    let nested = 0;
    w.sb.ChatPrefs.tierMarkRead = function () { const r = real.apply(this, arguments); if (nested++ < 3) w.CP._renderChatTierStrip(); return r; };
    w.CP._renderChatTierStrip();
    w.sb.ChatPrefs.tierMarkRead = real;
    const kids = w.refs.chatTiers.children;
    ok(nested > 0, "N2 premise: the nested redraw actually happened, so one copy below is the row surviving it", nested);
    ok(kids.filter((n) => /^Everyone/.test(n._text || "")).length === 1 && kids.filter((n) => /chat-tier-note/.test(n.className)).length === 1,
      "N2: THE TIER ROW HOLDS ONE SET OF BUTTONS AND ONE NOTE even when it is redrawn from inside its own drawing — " +
      "the screenshot showed 1149", kids.map((n) => n._text || n.className));
  }

  // ═══ PART H — a seeded random walk, three screen invariants after EVERY step ═══════════════════
  // WHY THIS PART EXISTS. PARTS A–G each drive one scripted scenario. What a person reported was
  // what happens across MANY actions in a row — "the chats combine into one as we navigate" and "the
  // order is wrong, top is oldest sometimes". So this walks 200 seeded sequences of what a person does
  // in a room — messages arriving out of order in any tier (and from a readable channel no tier
  // names), scrollback floods, tier switches, the room's main chat moving, deletions, room events,
  // scrolling up, leaving and re-entering — and after EVERY step asserts: every message row belongs
  // to the channel being viewed (MIXING), rows run oldest-top to newest-bottom with room events in
  // their server-time slot (ORDER), and nothing is on screen twice (DOUBLE).
  //
  // DRIVEN AGAINST THE TREE THIS REPLACED (the ddjp_424 upload, same harness, same seeds): MIXING in
  // 186 of 200 walks, ORDER in 17 — the reported symptoms, reproduced. Against this tree: none. And
  // with the old faults planted here, one at a time (reconcile keeping rows the view dropped; rows
  // ordered by id rather than time; an unnamed channel filed under the visible tier), this part broke
  // in 199, 200 and 176 walks. Deterministic: the seeds are fixed, so a red run replays exactly.
  {
    const prng = (seed) => { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
    const TIER_CH = ["!u:hs", "!s:hs"], LABEL = { "!u:hs": "Everyone", "!s:hs": "Staff" };
    // On-by-default kinds weighted in, so room events reach the screen; off-by-default ones mixed in, so
    // the KIND invariant has something to refuse.
    const FEED_T = ["ddjp.dj.save", "ddjp.dj.skip", "ddjp.media.skip", "ddjp.dj.save", "ddjp.dj.skip", "ddjp.dj.vote", "ddjp.dj.play", "ddjp.dj.join"];
    const ST = { checks: 0, withMsgs: 0, both: 0, switchOtherHeld: 0, reentries: 0, floods: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const R = prng(seed), pick = (a) => a[Math.floor(R() * a.length)];
      const hist = { "!u:hs": [], "!s:hs": [] };
      const w = world({ history: hist });
      w.sb.Chat.setReadableTiers(["!u:hs", "!s:hs", "!orphan:hs"]);
      const tsOf = {}, chOf = {}, typeOf = {}, used = new Set();
      let n = 0, clock = 100000;
      const uniq = (t) => { while (used.has(t)) t++; used.add(t); return t; };
      // One message in ten is over the limit, so the too-long row takes part in every invariant.
      const arrive = (ch, ts) => { const id = "$" + ch.slice(1, 2) + (n++); tsOf[id] = ts; chOf[id] = ch;
        const body = R() < 0.1 ? "L".repeat(600) : id;
        if (hist[ch]) { hist[ch].push({ id, sender: "@a:hs", body, ts }); hist[ch].sort((a, b) => a.ts - b.ts); } w.raw(id, ch, ts, body); };
      await w.CP.startChat(w.box); await tick();
      for (let step = 0; step < 60; step++) {
        const x = R(); let op;
        if (x < 0.34) { op = "message"; clock += 1 + Math.floor(R() * 50); arrive(pick([...TIER_CH, ...TIER_CH, ...TIER_CH, "!orphan:hs", "!x:hs"]), uniq(clock - Math.floor(R() * 400))); }
        else if (x < 0.42) { op = "flood"; ST.floods++; const ch = pick(TIER_CH); const low = Math.min(clock, ...Object.values(tsOf)) - 2000; for (let i = 11; i >= 0; i--) arrive(ch, uniq(low + i * 10)); }
        else if (x < 0.58) { op = "switch"; const b = W.tierButton(w, LABEL[pick(TIER_CH)]); if (b) b.onclick(); }
        else if (x < 0.66) { op = "main-chat change"; w.tiersState.mainTier = w.tiersState.mainTier === "uncategorized" ? "staff" : "uncategorized";
          w.sb.Chat.setRoom(w.sb.Room.chatTiers().activeId); w.CP.syncChatTier(); }
        else if (x < 0.72) { op = "delete"; const ids = Object.keys(chOf).filter((i) => TIER_CH.indexOf(chOf[i]) >= 0); if (ids.length) { const id = pick(ids); w.redaction(id, chOf[id]); } }
        else if (x < 0.82) { op = "room event"; clock += 1 + Math.floor(R() * 50); const ts = uniq(clock); const e = "$e" + (n++); tsOf["f:" + e] = ts;
          const t = pick(FEED_T); typeOf[e] = t; w.log.push({ eventId: e, type: t, sender: "@b:hs", ts, l: n }); w.CP.renderChat(); }
        else if (x < 0.87) { op = "scroll up"; w.box.scrollTop = 0; if (w.box._onscroll) w.box._onscroll(); }
        else if (x < 0.92) { op = "toggle a kind"; const t = pick([...FEED_T, w.sb.Chat.TOO_LONG]);
          const d = (w.sb.Room.FEED_KINDS[t] || w.sb.Chat.EVENT_KINDS[t]).shownByDefault;
          w.sb.ChatPrefs.setFeedShown(t, !w.sb.ChatPrefs.feedShown(t, d), d); w.CP._repaintChat(w.box); }
        else { op = "leave and re-enter"; ST.reentries++; w.refs.chatBox = W.el("div"); w.box = w.refs.chatBox; w.refs.chatTiers = W.el("div"); await w.CP.startChat(w.box); }
        await tick();
        const active = w.sb.Room.chatTiers().activeId, s = screen(w.box);
        const where = " (seed " + seed + ", step " + step + ", right after '" + op + "')";
        const foreign = s.find((r) => r[0] === "m" && chOf[r.slice(2)] !== active);
        ok(!foreign, "H: MIXING — A MESSAGE FROM ANOTHER CHANNEL IS ON SCREEN" + where, { row: foreign, from: foreign && chOf[foreign.slice(2)], viewing: active });
        const ts = s.map((r) => r[0] === "m" ? tsOf[r.slice(2)] : tsOf["f:" + r.slice(2)]);
        const bad = ts.findIndex((t, i) => i > 0 && t < ts[i - 1]);
        ok(bad < 0, "H: ORDER — A ROW SITS ABOVE AN OLDER ONE; the screen must run oldest-top to newest-bottom, room events in their server-time slot" + where,
          bad < 0 ? null : { above: s[bad - 1] + "@" + ts[bad - 1], below: s[bad] + "@" + ts[bad] });
        ok(new Set(s).size === s.length, "H: DOUBLE — A ROW IS ON SCREEN TWICE" + where, s.filter((r, i) => s.indexOf(r) !== i));
        const hidden = s.find((r) => r[0] === "f" && !w.sb.ChatPrefs.feedShown(typeOf[r.slice(2)], w.sb.Room.FEED_KINDS[typeOf[r.slice(2)]].shownByDefault));
        ok(!hidden, "H: KIND — A ROOM EVENT OF A KIND THIS DEVICE HIDES IS ON SCREEN" + where, { row: hidden, kind: hidden && typeOf[hidden.slice(2)] });
        ST.checks++; const mc = s.filter((r) => r[0] === "m").length;
        if (mc) ST.withMsgs++; if (mc && mc < s.length) ST.both++;
        if ((op === "switch" || op === "main-chat change") && mc &&
            Object.keys(chOf).some((i) => TIER_CH.indexOf(chOf[i]) >= 0 && chOf[i] !== active)) ST.switchOtherHeld++;
      }
    }
    // THE WALK REACHED WHAT IT CLAIMS TO TEST — or a clean run would be a walk that never got there.
    ok(ST.checks === 200 * 60, "H premise: every step of every walk was checked", ST.checks);
    ok(ST.withMsgs > ST.checks / 2, "H premise: most screens held messages, so MIXING and ORDER had rows to judge", ST);
    ok(ST.both > ST.checks / 4, "H premise: many screens held messages AND room events, so ORDER judged the interleave", ST);
    ok(ST.switchOtherHeld > 500, "H premise: the walk switched tier or moved the main chat hundreds of times while the OTHER tier held " +
      "messages — the exact condition that combined the chats in the tree this replaced", ST);
    ok(ST.reentries > 100 && ST.floods > 100, "H premise: it left and re-entered the room, and absorbed scrollback floods, many times", ST);
  }

  reachedVerdict = true;
  console.log("[chat-view] PASS — each chat shows its own source and nothing else: messages are filed by the " +
    "channel they ARRIVED on and the box is only ever a rendering of that channel's model (`ChatBuffer.view`), so a " +
    "tier switch and a main-chat change are the same recompute and cannot leave another tier on screen; every " +
    "readable tier is backfilled on entry into ONE buffer per channel and opens on its last ten, once each, in " +
    "order; a message from a channel no tier names is drawn nowhere; the feed sits between messages at its SERVER " +
    "time in every tier, go-forward from a server-stamped line and never the device clock, with refused events " +
    "absent; which kinds show is a device-local choice made one kind at a time, with saves, skips and unplayable-song skips " +
    "on by default and only a person's changes stored, surviving a reload and refusing junk on load; the Feed tab is gone and the fold is not; a deletion tombstones its own row in place; and across 200 seeded walks of everything a person does in a room — 12,000 screens — no chat ever shows another channel's message, a row above an older one, or anything twice (" + asserts + " assertions)");
})().catch((e) => fail("threw — " + ((e && e.stack) || e)));
