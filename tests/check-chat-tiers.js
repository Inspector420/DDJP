// tests/check-chat-tiers.js
// WALL: A TIER SWITCH THAT LOSES NOTHING, AND A BADGE THAT MEANS SOMETHING.
//
// J12 asks for per-tier chat views with an unread marker per tier. Its Done-when has three
// clauses and the first is the one nobody had driven: *switching tiers does not lose messages*.
// Chat is RAM-ONLY — there is no server copy to recover from beyond one capped backfill — so
// "lose" here means PERMANENTLY, and a shape that re-inits the buffer on a switch cannot satisfy
// it at all. PART A is that measurement; the rest of this file is the shape it forced.
//
// ── THE ENTRY'S OPEN WAS UNDERSTATED, AND PART E IS WHY ─────────────────────────────────────
// The Open warns that tier VIEWS and the room's `chat` SETTING must not become two definitions of
// one thing (P7). They are not two definitions of one thing — they are answers to two different
// questions, and the collision the Open fears only arises if the device's view is stored as a
// tier NAME with a default. It is stored as a NULL-ABLE OVERRIDE instead, where null means
// *follow the room*, which makes it a READER of the setting rather than a second source.
//
// AND THE OPEN MISSED THE THING THAT ACTUALLY BLOCKED THE JOB. Before J12 `Chat._handleRaw`
// refused every message whose `room_id` was not the ONE active channel, so a message in a tier
// you were not viewing was discarded at the door — **no unread badge for it was possible even in
// principle**. PART B drives that. The fan-out was always there; the filter was the wall.
//
// WHAT EACH PART PINS:
//   PART A — a tier switch RETAINS every buffer, driven at message level, with the room change
//     that must still clear them beside it as the control.
//   PART B — the readable set: a message from a non-visible readable tier ARRIVES (it could not
//     before), one from an unreadable channel does not, and an unbound client fails CLOSED.
//   PART C — the resolver: one definition, and which side wins when the override and the room's
//     setting disagree. This is the Open, settled and driven.
//   PART D — the read markers: forward-only, per tier, surviving a reload, on the `dmTouch`
//     pattern with scalars rather than a message object.
//   PART E — the badge's MEANING: a silent tier carries none, a tier with unseen traffic does.
//   PART F — the number is a per-device preference no backend module can read, and the control
//     showing what a room setting would have cost.
//   PART G — the strip renders what it is handed and decides nothing.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const P = require("./_probe-j12-tiers");

let asserts = 0;
function fail(msg, got) {
  console.log("[chat-tiers] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

function prefs() {
  return loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js",
                        "core/chatprefs.js"], {
    localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
                    setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
    Date, Math, JSON, indexedDB: undefined,
  });
}

// ═══ PART A — a tier switch retains every buffer ═════════════════════════════════════════════
// THE DONE-WHEN'S FIRST CLAUSE, AND THE OLD SHAPE COULD NOT SATISFY IT. `_resetChatState` used to
// be the response to a tier change and replaced the single buffer wholesale.
{
  const cb = loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON });
  const vm = require("vm");
  const src = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
  const names = ["_newChatState", "_chatStates", "_chatState", "_allChatStates", "_resetChatState"];
  const srcs = [];
  for (const n of names) {
    const ex = P.extractFn("ui/interface.js", n);
    ok(ex.ok, "A: APPLIED — `" + n + "` must be extractable, or this part has no subject", ex.stage);
    srcs.push(ex.source);
  }
  const sb = { console, Math, JSON, Date, ChatBuffer: cb.ChatBuffer };
  sb.globalThis = sb; vm.createContext(sb);
  vm.runInContext(srcs.join("\n") + ";globalThis.__st=_chatState;globalThis.__reset=_resetChatState;", sb);

  const box = {};
  const main = sb.__st(box, "uncategorized");
  for (let i = 0; i < 40; i++) main.buf.upsert("$u" + i, "@a:hs", "main " + i, false, 1000 + i);
  const staff = sb.__st(box, "staff");
  for (let i = 0; i < 7; i++) staff.buf.upsert("$s" + i, "@b:hs", "staff " + i, false, 2000 + i);

  ok(main.buf.size() === 40 && staff.buf.size() === 7,
    "A: APPLIED — both tiers must hold messages before the switch, or retention below is free",
    { main: main.buf.size(), staff: staff.buf.size() });

  // THE SWITCH. Asking for a tier's state is the whole of it — there is no re-init step.
  const backToMain = sb.__st(box, "uncategorized");
  ok(backToMain === main && backToMain.buf.size() === 40,
    "A: SWITCHING TIERS LOSES NOTHING. The buffer for a tier is the SAME OBJECT before and after " +
    "a switch, so its messages are still there. Chat is RAM-only and the only recovery is a " +
    "ten-message backfill against a 5000-message cap, so a re-init here would destroy up to 4990 " +
    "messages permanently — which is what the shape before J12 did",
    { same: backToMain === main, size: backToMain.buf.size() });
  const backToStaff = sb.__st(box, "staff");
  ok(backToStaff === staff && backToStaff.buf.size() === 7,
    "A: in both directions, so retention is a property of the structure rather than of one tier",
    backToStaff.buf.size());

  // THE CONTROL, AND IT IS THE OTHER HALF OF THE RULE. A ROOM change must still clear everything:
  // `_resetChatState` is not wrong, it was being called for the wrong event.
  sb.__reset(box);
  const afterRoom = sb.__st(box, "uncategorized");
  ok(afterRoom !== main && afterRoom.buf.size() === 0,
    "A control: a ROOM change still clears every tier — the reset was never wrong, it was the " +
    "response to the wrong event. Without this control, retention above could be a reset that " +
    "stopped working rather than one that stopped being called for a tier switch",
    afterRoom.buf.size());
}

// ═══ PART B — the readable set ═══════════════════════════════════════════════════════════════
// WHAT ACTUALLY BLOCKED UNREAD BADGES, AND THE ENTRY'S OPEN DOES NOT MENTION IT.
{
  let captured = null;
  const sb = loadInContext(["core/logger.js", "features/chat.js"], {
    Date, Math, JSON, setTimeout, clearTimeout,
    MatrixBridge: { onRawEvent: (fn) => { captured = fn; }, offRawEvent: () => {},
                    sendMessage: async () => {}, cryptoAvailable: () => true,
                    recentChatMessages: async () => ({ messages: [] }) },
  });
  const Chat = sb.Chat;
  const seen = [];
  Chat.onMessage((id, sender, body, failed, ts, roomId) => seen.push({ id, roomId }));
  Chat.init("!main:hs");
  ok(typeof captured === "function", "B: APPLIED — init must register a raw listener", typeof captured);

  const msg = (id, room) => ({ type: "m.room.message", room_id: room, event_id: id,
                               sender: "@a:hs", content: { body: "x" }, ts: 5000 });

  // Before widening: exactly the old behaviour, which is what makes J12 a widening.
  captured(msg("$a", "!main:hs"), {}, {});
  captured(msg("$b", "!staff:hs"), {}, {});
  ok(seen.length === 1 && seen[0].id === "$a",
    "B control: with only the active channel bound, a message from another chat channel is still " +
    "dropped — so `init` alone behaves exactly as it did before J12 and this is a widening rather " +
    "than a change of contract", seen.map((s) => s.id));

  Chat.setReadableTiers(["!main:hs", "!staff:hs"]);
  seen.length = 0;
  captured(msg("$c", "!staff:hs"), {}, {});
  ok(seen.length === 1 && seen[0].id === "$c",
    "B: A MESSAGE FROM A READABLE TIER YOU ARE NOT VIEWING NOW ARRIVES. Before J12 `_handleRaw` " +
    "refused everything but the ONE active channel, so a message in another tier was discarded at " +
    "the door and no unread badge for it was possible even in principle. The fan-out was always " +
    "there; the filter was the wall", seen);
  ok(seen[0].roomId === "!staff:hs",
    "B: and it carries the channel it arrived on, or the consumer cannot tell which tier it " +
    "belongs to and would file it under whichever view happened to be selected", seen[0]);

  seen.length = 0;
  captured(msg("$d", "!stranger:hs"), {}, {});
  ok(seen.length === 0,
    "B: while a channel NOT in the readable set is still refused — the set is a widening, not an " +
    "opening", seen);

  // FAIL CLOSED, which is the same rule `inScope` follows and for the same reason.
  Chat.setReadableTiers([]);
  seen.length = 0;
  captured(msg("$e", "!main:hs"), {}, {});
  ok(seen.length === 0,
    "B: an EMPTY readable set means nothing is ours rather than everything — a permissive filter " +
    "before a room is bound would render a stranger's chat channel as this room's", seen);
}

// ═══ PART C — the resolver: one definition, and who wins ═════════════════════════════════════
// THE OPEN, SETTLED AND DRIVEN. `settings.chat` answers *which tier is the room's MAIN chat*;
// the device override answers *which tier am I looking at*. Two questions, one resolver.
{
  const CP = prefs();
  // ── THE FIXTURE DESCRIBED A ROOM THAT CANNOT EXIST, AND THAT IS WHY THE BUG SHIPPED ────────
  // It listed three chat channels and ONE events channel. No real room is ever in that shape:
  // channels are created in batches, and a `chat_staff` only exists in batch 3, by which point
  // `events_staff` exists too. So the fixture asserted over a room whose chat tiers had no events
  // ladder behind them — the exact condition the offered-tier filter had to be checked against,
  // made unreachable by the fixture itself. A browser found in one run what this could not.
  const CHANNELS = { chat_uncategorized: "!u:hs", chat_guest: "!g:hs", chat_staff: "!s:hs",
                     events_uncategorized: "!eu:hs", events_guest: "!eg:hs",
                     events_player: "!ep:hs", events_vip: "!ev:hs", events_staff: "!es:hs",
                     events_owner: "!e:hs" };
  const setRooms = [], readableSets = [];
  const MB = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/matrixbridge.js"], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
  const sb = loadInContext(["core/logger.js", "features/room.js"], {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ChatPrefs: CP.ChatPrefs,
    Chat: { setRoom: (id) => setRooms.push(id), setReadableTiers: (ids) => readableSets.push(ids),
            init() {}, dmInit() {} },
    StreamManager: { getState: () => ({ settings: { chat: "guest" } }), on() {}, getLog: () => [] },
    // The REAL taxonomy and the REAL level->key map, because the offered-tier filter reads both
    // and a stub here would be this guard restating the channel table.
    MatrixBridge: { getUserId: () => "@me:hs", getMyRank: () => 0, getRoster: () => [],
                    channelTaxonomy: () => MB.MatrixBridge.channelTaxonomy(),
                    eventsKeyForLevel: (lvl) => MB.MatrixBridge.eventsKeyForLevel(lvl) },
  });
  const Room = sb.Room;
  Room._setCurrentForTest({ spaceId: "!space:hs", channels: CHANNELS });
  CP.ChatPrefs.load();

  // No override: the ROOM's setting decides. One definition with one reader.
  CP.ChatPrefs.setChatTier(null);
  let r = Room.chatTiers();
  ok(r.mainTier === "guest",
    "C: APPLIED — the room's setting must be readable, or nothing below distinguishes anything", r);
  ok(r.activeTier === "guest",
    "C: WITH NO DEVICE OVERRIDE THE ROOM'S SETTING DECIDES. `null` means follow the room, which " +
    "is what makes the device preference a READER of `settings.chat` rather than a second " +
    "definition of it (P7, and the whole of this job's Open)", r.activeTier);
  ok(r.tiers.length === 3,
    "C: and every chat channel the room physically has is offered — floored against channels that " +
    "exist, never against a rank literal (rule H)", r.tiers.map((t) => t.tier));

  // ── A TIER IS OFFERED ONLY IF THE ROOM UNLOCKED ITS RANK ───────────────────────────────────
  // CONFIRMED IN A BROWSER before this row existed: a batch-1 room offered Uncategorized · Guest ·
  // Staff. Existence of a `chat_*` key is not the same question as *has the events ladder caught
  // up*, and this is the identical defect the RANK picker had at v272 — fixed there by filtering
  // through `isRankUnlocked`, and this picker shipped without the equivalent. Pinned here the way
  // `check-rank-injection` pins the other one.
  {
    // A batch-1 room: the chat keys are present, the events ladder is not.
    Room._setCurrentForTest({ spaceId: "!space:hs", channels: {
      chat_uncategorized: "!u:hs", chat_guest: "!g:hs", chat_staff: "!s:hs",
      events_uncategorized: "!eu:hs" } });
    const early = Room.chatTiers();
    ok(early.tiers.length === 1 && early.tiers[0].tier === "uncategorized",
      "C: A BATCH-1 ROOM OFFERS EXACTLY ONE TIER, even though three `chat_*` keys are present. " +
      "Offering a tier whose rank the room has not unlocked invites somebody to switch to a " +
      "channel no one of that rank can be in — the v272 rank-picker defect, in the tier picker",
      early.tiers.map((t) => t.tier));
    ok(early.activeTier === "uncategorized",
      "C: and the active tier falls back to one that IS offered, rather than to a filtered-out " +
      "name that would render an empty view", early.activeTier);

    // Half-upgraded: guest unlocked, staff not.
    Room._setCurrentForTest({ spaceId: "!space:hs", channels: {
      chat_uncategorized: "!u:hs", chat_guest: "!g:hs", chat_staff: "!s:hs",
      events_uncategorized: "!eu:hs", events_guest: "!eg:hs", events_player: "!ep:hs",
      events_vip: "!ev:hs" } });
    const mid = Room.chatTiers();
    ok(mid.tiers.length === 2 && mid.tiers.map((t) => t.tier).indexOf("staff") < 0,
      "C: and a half-upgraded room offers the tiers it HAS unlocked and not the one it has not — " +
      "so the filter tracks the ladder rather than being on or off", mid.tiers.map((t) => t.tier));

    // ── THE TAXONOMY IS READ, AND IT MUST FAIL CLOSED ─────────────────────────────────────
    // `mutate-ui-crash` M6 and M7 survived the rows above, which is this project's recorded
    // shape for the sixth time: a structural check says nothing about a source that FAILS or
    // MOVES. Both are now driven through a taxonomy that does one and then the other.
    const realTax = sb.MatrixBridge.channelTaxonomy;
    sb.MatrixBridge.channelTaxonomy = () => { throw new Error("taxonomy unavailable"); };
    const blind = Room.chatTiers();
    ok(blind.tiers.length === 0,
      "C: AN UNREADABLE TAXONOMY OFFERS NO TIER AT ALL — fail CLOSED. Failing open would offer " +
      "every tier the moment the level table could not be read, which is the confirmed browser " +
      "defect arriving by a different route", blind.tiers);

    // A taxonomy that MOVES: a tier this file could not have hard-coded.
    sb.MatrixBridge.channelTaxonomy = () => [
      { kind: "chat", slug: "uncategorized", key: "chat_uncategorized", level: 0, batch: 1 },
      { kind: "chat", slug: "guest", key: "chat_guest", level: 10, batch: 2 },
      { kind: "chat", slug: "staff", key: "chat_staff", level: 80, batch: 3 },
    ];
    Room._setCurrentForTest({ spaceId: "!space:hs", channels: {
      chat_uncategorized: "!u:hs", chat_staff: "!s:hs",
      events_uncategorized: "!eu:hs", events_guest: "!eg:hs", events_player: "!ep:hs",
      events_vip: "!ev:hs", events_staff: "!es:hs" } });
    const moved = Room.chatTiers();
    ok(moved.tiers.map((t) => t.tier).indexOf("staff") < 0,
      "C: MOVING A TIER'S LEVEL IN THE TAXONOMY MOVES THE FILTER — `staff` at 80 needs " +
      "`events_high_staff`, which this room lacks, so it is no longer offered even though " +
      "`events_staff` exists. A restated level table here would still have offered it",
      moved.tiers.map((t) => t.tier));

    sb.MatrixBridge.channelTaxonomy = realTax;
    // Restore the fully-upgraded fixture for the rows that follow.
    Room._setCurrentForTest({ spaceId: "!space:hs", channels: CHANNELS });
  }

  // An override: THIS DEVICE decides, and the room's setting is untouched.
  CP.ChatPrefs.setChatTier("staff");
  r = Room.chatTiers();
  ok(r.activeTier === "staff" && r.mainTier === "guest",
    "C: WITH AN OVERRIDE THE DEVICE DECIDES, and the room's main tier is UNCHANGED — the two " +
    "answers coexist because they answer different questions. A view that overwrote the setting " +
    "would be one device editing room truth for everybody", r);

  // An override naming a tier this room does not have falls back rather than emptying the view.
  CP.ChatPrefs.setChatTier("nosuchtier");
  r = Room.chatTiers();
  ok(r.activeTier === "guest",
    "C: an override naming a tier this client cannot read falls back to the room's main tier — a " +
    "person demoted out of a tier they had selected gets a working view rather than an empty one",
    r.activeTier);

  // ONE WRITER. Both callers go through the resolver rather than choosing a channel themselves.
  CP.ChatPrefs.setChatTier("staff");
  setRooms.length = 0; readableSets.length = 0;
  const applied = Room.applyChatTiers();
  ok(setRooms.length === 1 && setRooms[0] === "!s:hs",
    "C: the resolver is what re-points Chat, so the tier you READ is the tier your next message " +
    "GOES TO — a send bound to a different channel from the view is the sharpest way this could " +
    "be wrong and nothing would look broken", setRooms);
  ok(readableSets.length === 1 && readableSets[0].length === 3,
    "C: and the whole readable set is pushed for RECEIVING, which is the pair PART B needs",
    readableSets);
  ok(applied.activeTier === "staff", "C: and it hands back what it resolved", applied.activeTier);

  setRooms.length = 0;
  const sel = Room.selectChatTier("uncategorized");
  ok(sel.activeTier === "uncategorized" && setRooms[0] === "!u:hs",
    "C: and a VIEW SWITCH goes through that same resolver rather than re-pointing Chat itself — " +
    "one expression, two callers, which is what keeps this from becoming the second definition " +
    "the Open warns about", { sel: sel.activeTier, setRooms });
  ok(CP.ChatPrefs.chatTier() === "uncategorized",
    "C: and it records the choice on the device, so it survives a reload", CP.ChatPrefs.chatTier());
}

// ═══ PART D — the read markers ═══════════════════════════════════════════════════════════════
{
  const CP = prefs();
  const A = CP.ChatPrefs;
  A.load();
  ok(A.tierList().length === 0, "D: a fresh device has no tier rows", A.tierList());
  ok(A.tierUnread("staff") === false,
    "D: and a tier with no row is NOT unread — a badge on a tier nothing has ever arrived in " +
    "would invite somebody to open an empty channel", A.tierUnread("staff"));

  A.tierTouch("staff", 5000);
  ok(A.tierUnread("staff") === true,
    "D: a tier that has received something you have not read IS unread", A.tierList());
  A.tierMarkRead("staff", 5000);
  ok(A.tierUnread("staff") === false, "D: and reading it clears the badge", A.tierList());

  // FORWARD ONLY — the same rule as `dmMarkRead` and for the identical reason.
  A.tierTouch("staff", 9000);
  A.tierMarkRead("staff", 1);
  ok(A.tierUnread("staff") === false,
    "D: a read marker only ever moves FORWARD. Backfill decrypts newest-first, so a late message " +
    "can arrive with an older stamp than one already rendered, and a marker that followed it " +
    "backwards would re-raise a badge the person just cleared", A.tierList());

  // Scalars, not a message object — a caller cannot hand this a body it forgot to strip.
  const before = JSON.stringify(A.tierList());
  A.tierTouch("staff", { body: "secret" });
  const row = A.tierList().find((r) => r.tier === "staff");
  ok(row && typeof row.lastTs === "number" && JSON.stringify(A.tierList()) !== undefined &&
     !/secret/.test(JSON.stringify(A.tierList())),
    "D: `tierTouch` takes SCALARS and not a message object, so a body cannot reach the store " +
    "through it — there is no parameter for one", A.tierList());

  ok(A.tierUnreadCount() === 0, "D: the count agrees with the per-tier answer", A.tierUnreadCount());
  A.tierTouch("guest", 100);
  ok(A.tierUnreadCount() === 1, "D: and moves when a second tier goes unread", A.tierList());
}

// ═══ PART E — what a badge MEANS ═════════════════════════════════════════════════════════════
{
  const RES = { tiers: [{ tier: "guest", id: "!g:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false },
                        { tier: "uncategorized", id: "!u:hs", main: false }],
                activeTier: "guest", activeId: "!g:hs", mainTier: "guest" };
  const lab = P.gate("label", P.driveLabel(RES, ["staff"]), {}, "PART E").label;
  const by = (t) => lab.tiers.find((x) => x.tier === t);
  ok(by("staff").unread === true,
    "E: a tier with messages you have not seen carries a badge", lab.tiers);
  ok(by("uncategorized").unread === false,
    "E: A SILENT TIER CARRIES NONE. This is the case the Open is really about: a badge on a tier " +
    "nothing has arrived in is an invitation to open an empty channel, and it would appear on " +
    "every rank-granted tier in every quiet room", lab.tiers);
  ok(by("guest").main === true && by("staff").main === false,
    "E: the room's MAIN tier is marked rather than renamed — `main` is a fact about the room and " +
    "the tier keeps its own name in every client", lab.tiers);
  ok(by("guest").active === true && by("staff").active === false,
    "E: and exactly one tier is active, which is the resolver's answer rather than the strip's",
    lab.tiers);
  ok(/Unread marks a tier/.test(lab.note),
    "E: the strip states what a badge means rather than leaving it to be inferred", lab.note);

  const one = P.gate("label", P.driveLabel(
    { tiers: [{ tier: "uncategorized", id: "!u:hs", main: true }], activeTier: "uncategorized" }, []),
    {}, "PART E one").label;
  ok(/one chat tier/.test(one.note),
    "E: and a room with a single tier says so, rather than offering a chooser with one option and " +
    "no explanation", one.note);
}

// ═══ PART F — the marker is a device preference, and reaches no backend ══════════════════════
// THE PART THAT PINS THE JOB'S KIND. J12 is `ui`. It would be `derivation` — and on the Phase 6
// gate — the moment a read marker became a room setting.
{
  const CP = prefs();
  CP.ChatPrefs.load();
  ok(typeof CP.ChatPrefs.TIER_CAP === "number" && CP.ChatPrefs.TIER_CAP > 0,
    "F: the tier list has a declared cap", CP.ChatPrefs.TIER_CAP);

  // ── THE CAP, DRIVEN AT BOTH SITES, AND THIS BLOCK EXISTS BECAUSE THE CONTROL WAS GREEN ─────
  // The first version of this part asserted only that `TIER_CAP` was a positive number. The
  // keep-one lattice (`mutate-j12-tiers` M10-M13) then came back ALL GREEN **including its
  // control** — and a green control means the rotations are INADMISSIBLE rather than informative:
  // all-green could not be told from a walk nothing in the suite ever enters. Which is precisely
  // what the adjacent-control rule is for, and the first time in this tree it has fired that way.
  // So the sites are driven here, and only then do the rotations mean anything.
  const CAP = CP.ChatPrefs.TIER_CAP;

  // SITE 1 — `tierFold`, which bounds what THIS build writes.
  {
    const many = [];
    for (let i = 0; i < CAP + 12; i++) many.push({ tier: "t" + i, lastTs: 1000 + i, readTs: 0 });
    const folded = CP.ChatPrefs.tierFold(many, { tier: "fresh", lastTs: 99999, readTs: 0 });
    ok(folded.length === CAP,
      "F: `tierFold` bounds what this build writes, driven over a list past the cap", folded.length);
    ok(folded[0].tier === "fresh",
      "F: keeping the most recent rather than the first — the cap drops by last activity, so a " +
      "tier that just spoke cannot be the one evicted", folded.map((r) => r.tier));
  }

  // SITE 2 — `load()`, which bounds a blob THIS BUILD DID NOT WRITE. The route the setter never
  // sees: an older build's stored list, or a hand-edited localStorage. This is the same repair
  // J15's M14 needed and for the same reason — every other fixture handed the loader an under-cap
  // blob, so the second site was never reached.
  {
    const rows = [];
    for (let i = 0; i < CAP + 40; i++) rows.push({ tier: "s" + i, lastTs: 500 + i, readTs: 0 });
    const cp2 = prefs();
    cp2.Store.prefs = { load: () => ({ tiers: rows }), save() {} };
    const loaded = cp2.ChatPrefs.load();
    ok(loaded && Array.isArray(loaded.tiers),
      "F: APPLIED — the stored blob must have reached the loader, or the cap below is measuring a " +
      "default that was never challenged", loaded && loaded.tiers && loaded.tiers.length);
    ok(cp2.ChatPrefs.tierList().length === CAP,
      "F: a STORED list past the cap is bounded on the way in — the route the writer never sees, " +
      "and the one an older build's blob arrives by, into the synchronous localStorage tier " +
      "`main/06-storage.md` says must never grow", cp2.ChatPrefs.tierList().length);
  }

  // THE SANITISER ON THAT SAME EXPRESSION — the control's subject, and unguarded until now.
  // Unknown keys must not survive a load, because an extra key is exactly how a message body
  // would arrive in a store that promises it holds none.
  {
    const cp3 = prefs();
    cp3.Store.prefs = { load: () => ({ tiers: [
      { tier: "guest", lastTs: 10, readTs: 0, body: "a message body that must not survive" },
      { lastTs: 20 },            // no tier at all
      "not an object",
    ] }), save() {} };
    cp3.ChatPrefs.load();
    const list = cp3.ChatPrefs.tierList();
    ok(list.length === 1 && list[0].tier === "guest",
      "F: rows with no tier, and non-objects, do not survive a load", list);
    ok(!/message body/.test(JSON.stringify(list)),
      "F: AND AN UNKNOWN KEY DOES NOT SURVIVE EITHER — a stored blob carrying a body cannot " +
      "smuggle one through this field, which is the promise the RAM-only chat rule rests on",
      JSON.stringify(list));
  }

  const backendFiles = fs.readdirSync(path.join(ROOT, "backends/backend1")).filter((f) => f.endsWith(".js"));
  ok(backendFiles.length > 10, "F: APPLIED — the backend scan must find modules", backendFiles.length);
  const offenders = backendFiles.filter((f) => {
    const s = fs.readFileSync(path.join(ROOT, "backends/backend1", f), "utf8")
      .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
    return /\bChatPrefs\s*\./.test(s);
  });
  ok(offenders.length === 0,
    "F: no backend module reads ChatPrefs, so nothing it holds can reach a seed, a fingerprint or " +
    "the reducer — which is why the read markers cost no checkpoint and why this job is `ui` " +
    "rather than `derivation` on the Phase 6 gate", offenders);

  // The control: adding a key to the reducer's settings really does move a fingerprint.
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js"], { Date, Math, JSON });
  const F2 = require("./_fixtures");
  const seg = F2.sortLog(F2.playingRoom({ songs: 2 }).log);
  const seed = sd.StateDeriver.buildSeed(seg, null);
  ok(seed.settings && Object.keys(seed.settings).length > 0,
    "F: APPLIED — the seed must carry a settings blob", seed.settings);
  const fp = (x) => sd.CheckpointFormat.fingerprint(1, null, x, 10, false, "$a..$b");
  const base = fp(seed);
  const added = JSON.parse(JSON.stringify(seed));
  added.settings.chatReadTs = 5000;
  ok(fp(added) !== base,
    "F control: ONE new settings key moves every checkpoint's fingerprint — the cost this job " +
    "declined to pay, and the reason the read markers live in a device preference (J45)",
    { base: base.slice(0, 12) });
}

// ═══ PART G — the strip renders what it is handed and decides nothing ════════════════════════
// EXTRACTED FROM `ui/interface.js` AND EXECUTED — the seventh guard in the tree to run that file
// rather than read it.
{
  const RES = { tiers: [{ tier: "guest", id: "!g:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false }],
                activeTier: "staff", activeId: "!s:hs", mainTier: "guest" };
  const r = P.gate("strip", P.driveStrip({ res: RES, unread: ["guest"] }),
    { expectAsked: true, expectButtons: true }, "PART G");

  ok(r.buttons.length === 2,
    "G: the strip paints one button per tier the resolver returned", r.buttons.map((b) => b.text));
  // ── THIS ASSERTED "UNRE-LABELLED" UNTIL THE TIERS WERE GIVEN DISPLAY NAMES ────────────────
  // It required the button to start with the raw tier id — `guest` — which pinned the strip to
  // printing PROTOCOL names at a person. `uncategorized` is what the ladder calls its bottom
  // rung; as the name of a chat room it tells a reader nothing, and `guest` reads as *only*
  // guests rather than *guests and above*. The owner renamed them: Everyone / Guest+ / Staff /
  // Present.
  //
  // WHAT THE PART STILL MEANS, AND IT IS THE HALF THAT WAS LOAD-BEARING: the strip does not
  // RE-SORT and does not RE-DECIDE. So the order is still the resolver's and the main marking is
  // still the resolver's — and the text is asserted as the DISPLAY NAME OF THAT TIER by calling
  // the same function the strip calls, rather than as a literal. A future rename moves both
  // together; a strip that started inventing labels would not.
  ok(r.buttons[0].text.indexOf(r.tierName("guest")) === 0 && /\(main\)/.test(r.buttons[0].text),
    "G: in the resolver's order and with its main marking — unre-sorted, and labelled by the "
    + "tier's own display name rather than by anything the strip decides",
    { painted: r.buttons.map((b) => b.text), expectedFirst: r.tierName("guest") });
  ok(r.tierName("guest") !== "guest" && r.tierName("uncategorized") !== "uncategorized",
    "G: and the display name is genuinely NOT the protocol id — otherwise the assertion above "
    + "would pass against a strip that never renamed anything",
    { guest: r.tierName("guest"), uncategorized: r.tierName("uncategorized") });
  ok(r.tierName("no-such-tier") === "no-such-tier",
    "G: an unmapped tier falls back to its id rather than to a blank — a tier added to the "
    + "channel table and not to the label map must look unfinished, not invisible",
    r.tierName("no-such-tier"));
  ok(r.buttons[1].active === true && r.buttons[0].active === false,
    "G: the ACTIVE tier is the resolver's answer, not the strip's — a strip that decided would " +
    "hold a second copy of the rule the resolver owns (P7)", r.buttons);
  ok(r.buttons[0].unread === true && r.buttons[1].unread === false,
    "G: and unread comes from ChatPrefs per tier rather than from anything the strip computes",
    r.buttons);
  ok(r.unreadAsked.length === 2,
    "G: it asks about every tier it paints, so a badge cannot be missing because nobody asked",
    r.unreadAsked);
  ok(typeof r.buttons[0].onclick === "function",
    "G: every tier is clickable, so the view is reachable rather than merely displayed", r.buttons);
  ok(r.note.length === 1 && /Unread/.test(r.note[0]),
    "G: and the note is rendered rather than only computed", r.note);

  // The channel -> tier resolution goes through the feature layer, not a string split here.
  ok(r.tierFor("!s:hs") === "staff" && r.tierFor("!nope:hs") === null,
    "G: the UI resolves a channel to a tier through `Room.chatTiers()` rather than reversing the " +
    "`chat_` key itself — the UI does not own the channel vocabulary", r.tierFor("!s:hs"));

  const boom = P.driveStrip({ res: RES, throwFromRoom: true });
  ok(boom.ok === true,
    "G: a throwing feature layer leaves the strip standing rather than breaking the chat panel",
    boom.stage);
}

// ═══ the harness's own gate, both directions ═════════════════════════════════════════════════
{
  const rows = P.selfTest();
  const refusals = rows.filter((r) => r.refused === true).length;
  const admits = rows.filter((r) => r.admitted === true).length;
  ok(refusals === 4 && admits === 2,
    "the admissibility gate refuses each broken reading and ADMITS the sound ones — a gate that " +
    "refuses everything certifies nothing", rows);
}

// ═══ PART J — THE PRESENCE TIER, AND THE ORDER THE STRIP IS GIVEN ════════════════════════════
// `presence-chat` is an encrypted chat channel like the other three; only its MEMBERSHIP rule
// differs — the bot adds and removes people by the room's activity rule rather than by rank. So
// for this ONE tier "the channel exists" and "I can read it" are different questions, and both
// are asked. Offering a tier that opens an empty view is the defect the rank filter was added to
// fix, arriving through the one channel rank does not govern.
{
  const MBx = loadInContext(["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"],
    { EventCache: {}, StreamManager: {}, Logger: { info() {}, warn() {}, debug() {}, error() {} } });
  const TAX = MBx.MatrixBridge.channelTaxonomy();
  const PKEY = MBx.MatrixBridge.presenceChatKey();

  function tiersFor(o) {
    const opts = o || {};
    const channels = {};
    for (const c of TAX) {
      if (opts.without && opts.without.indexOf(c.key) >= 0) continue;
      channels[c.key] = "!" + c.key + ":hs";
    }
    const CPx = loadInContext(["core/logger.js", "core/store.js", "core/chatprefs.js"], {
      Date, Math, JSON, window: {}, document: {},
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
    CPx.ChatPrefs.load();
    const sbx = loadInContext(["core/logger.js", "features/room.js"], {
      Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
      window: {}, document: { body: { appendChild() {} } },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      ChatPrefs: CPx.ChatPrefs,
      Chat: { setRoom() {}, setReadableTiers() {}, init() {}, dmInit() {} },
      StreamManager: { getState: () => ({ settings: { chat: "uncategorized" } }), on() {}, getLog: () => [] },
      // THE REAL taxonomy and key map: a stub here would be this guard restating the channel table.
      MatrixBridge: {
        getUserId: () => "@me:hs", getMyRank: () => 0, getRoster: () => [],
        channelTaxonomy: () => TAX,
        eventsKeyForLevel: (lvl) => MBx.MatrixBridge.eventsKeyForLevel(lvl),
        presenceChatKey: () => PKEY,
        amJoined: (id) => (id === channels[PKEY] ? opts.joined !== false : true),
      },
    });
    sbx.Room._setCurrentForTest({ spaceId: "!space:hs", channels: channels });
    return sbx.Room.chatTiers().tiers.map((t) => t.tier);
  }

  const inIt = tiersFor({});
  ok(inIt.indexOf("presence") >= 0,
    "J: the presence channel is offered as a tier when it EXISTS and this client is joined — it "
    + "is a chat channel, and its own feed follows from being in this list at all", inIt);

  const notIn = tiersFor({ joined: false });
  ok(notIn.indexOf("presence") < 0,
    "J: and NOT offered when the client is not a member. The bot decides who is in it, so "
    + "existence is not readability for this one tier, and a tier that opens an empty view is "
    + "the defect the rank filter exists to prevent", notIn);

  const absent = tiersFor({ without: [PKEY] });
  ok(absent.indexOf("presence") < 0,
    "J: and NOT offered when the room has never created the channel — a room whose upgrade has "
    + "not reached it must not show a tier for it", absent);

  // THE CONTROL: the other three are unaffected by the membership answer, so J is the presence
  // rule doing work rather than a resolver that stopped returning tiers.
  ok(notIn.length === inIt.length - 1 && notIn.every((t) => inIt.indexOf(t) >= 0),
    "J CONTROL: exactly ONE tier differs between joined and not-joined — the rank-governed tiers "
    + "are untouched by a membership question that is not theirs", { inIt, notIn });

  // ── ORDER: BY THE LADDER, PRESENCE LAST ────────────────────────────────────────────────────
  // This list sorted ALPHABETICALLY and said so deliberately. Alphabetical put Everyone last and
  // Guest+ first, which reads as arbitrary. Sorted by the level the channel table gives, so a
  // tier added to that table lands in the right place on the day it is added.
  const lvl = {};
  for (const c of TAX) { if (c.kind === "chat") lvl[c.slug] = c.level; }
  const ranked = inIt.filter((t) => t !== "presence");
  let ascending = true;
  for (let i = 1; i < ranked.length; i++) {
    if (!(lvl[ranked[i - 1]] <= lvl[ranked[i]])) ascending = false;
  }
  ok(ascending,
    "J: the rank-governed tiers are ordered by the LEVEL the channel table gives, widest first",
    ranked.map((t) => t + "@" + lvl[t]));
  ok(inIt[inIt.length - 1] === "presence",
    "J: and presence is pinned LAST. Its `level: 0` is a write gate rather than a rank, so "
    + "sorting it as if it were the widest audience would put it first", inIt);
}

// ═══ PART K — `Chat.onMessage` IS A LIST, NOT A SLOT ═════════════════════════════════════════
// It was `_onMessage = fn`, so the LAST caller won and every earlier one was silently
// unsubscribed. Exactly one caller existed — the panel's renderer — so nothing was broken, and the
// bot needing to observe chat for its AFK rule would have taken the slot and STOPPED CHAT
// RENDERING, with no error anywhere. A single-slot registrar costs nothing until the second
// subscriber arrives, and then costs the first one silently.
{
  let rawHandler = null;
  const CH = loadInContext(["core/logger.js", "features/chat.js"], {
    Date, Math, JSON, setTimeout, clearTimeout,
    // CAPTURED, so a message can be delivered the way the transport delivers one.
    MatrixBridge: { onRawEvent: (fn) => { rawHandler = fn; }, offRawEvent() {},
                    cryptoAvailable: () => true, sendMessage: () => Promise.resolve() },
    ChatBuffer: { push() {}, all: () => [], clear() {} },
  });
  const seen = [];
  const a = () => seen.push("a");
  const b = () => seen.push("b");
  CH.Chat.onMessage(a);
  CH.Chat.onMessage(b);
  CH.Chat.onMessage(a);          // duplicate — must not double-register

  // ── DRIVEN, NOT PATTERN-MATCHED ────────────────────────────────────────────────────────────
  // The source assertions below are cheap and were written first; they cannot tell a fan-out from
  // one that stops after the first listener. So the message is DELIVERED through the transport
  // handler Chat subscribed with, which is the only way in that production also uses.
  CH.Chat.init("!chat:hs");
  const raw = {
    event_id: "$m1", room_id: "!chat:hs", sender: "@p:hs", ts: 1,
    type: "m.room.message", content: { msgtype: "m.text", body: "hello" },
  };
  try { if (rawHandler) rawHandler(raw, null, { roomId: "!chat:hs" }); } catch (e) {}

  ok(seen.length === 2,
    "K: BOTH listeners ran, exactly once each. A fan-out that stops after the first is the "
    + "single-slot bug wearing a loop, and the first listener here is the panel's renderer",
    seen);
  ok(seen.indexOf("a") >= 0 && seen.indexOf("b") >= 0,
    "K: and both are the ones registered — the duplicate registration added no third call", seen);

  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "features", "chat.js"), "utf8");
  const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  ok(/const _msgListeners = \[\]/.test(code),
    "K: the registrar holds a LIST. A slot means the second subscriber silently unsubscribes the "
    + "first, and the first here is the panel's chat renderer");
  ok(/_msgListeners\.indexOf\(fn\) < 0/.test(code),
    "K: and refuses duplicates, so a re-init does not double-render every message");
  ok(/for \(const fn of _msgListeners\)[\s\S]{0,200}catch/.test(code),
    "K: it fans out to EVERY listener and a throw in one does not stop the others — a renderer "
    + "bug would otherwise silence the bot's observation, and the reverse");
  ok(!/_onMessage = fn/.test(code),
    "K: and the single-slot assignment is gone rather than merely supplemented");
}

console.log("[chat-tiers] PASS — a tier switch loses nothing and a badge means something (J12). " +
  "THE DONE-WHEN'S FIRST CLAUSE COULD NOT BE MET BY THE OLD SHAPE and PART A is the measurement: " +
  "chat is RAM-only, a tier change used to replace the single buffer wholesale, and the only " +
  "recovery is a ten-message backfill against a 5000-message cap — so up to 4990 messages went " +
  "permanently. Buffers are now held PER TIER and a switch is a re-render from a retained one, " +
  "with the ROOM change that must still clear them driven beside it as the control. THE OPEN WAS " +
  "UNDERSTATED IN THE DIRECTION THAT MATTERED: the P7 collision it warns about is avoided by " +
  "storing the device's view as a NULL-ABLE OVERRIDE that means `follow the room`, so it reads " +
  "`settings.chat` rather than restating it and one resolver serves both callers — but what " +
  "actually blocked the job was `_handleRaw` refusing every channel but the active one, which " +
  "made an unread badge impossible in principle rather than merely unbuilt. The readable set is a " +
  "WIDENING: `init` alone behaves exactly as before, an unbound client fails CLOSED, and a " +
  "stranger's channel is still refused. Read markers are per-tier, forward-only, take scalars " +
  "rather than a message object, and live where no backend module can read them — with the " +
  "control showing what a room setting would have cost. A SILENT TIER CARRIES NO BADGE. And the " +
  "strip is EXTRACTED FROM `ui/interface.js` AND EXECUTED, because a regex proving a label is " +
  "spelled there proves nothing about what it says when a tier is empty (" + asserts + " assertions)");
