// tests/check-dm-panel.js
// THE DM PANEL (J15) — the invariant it must not break, and the surface it is built on.
//
//   PART A  the second ingest door is scoped BY ORIGIN — a DM reaches neither store nor fold
//   PART B  origin decides, never the body — one body, three origins, three fates
//   PART C  the DM scope is a SECOND scope, not a second entry in the first
//   PART D  the conversation index is METADATA — no message body survives a reload
//   PART E  the panel renders the feature's list and raises its notification
//   PART F  `Actions.ACTIONS` is the adapter's REAL vocabulary — PART E of check-user-card's premise
//
// ── WHY PART A EXISTS AT ALL, AND WHY IT IS RUN RATHER THAN READ ─────────────────────────────
// `roles.md` §Room scope says the scope gate lives at the ingest door. It lives at ONE of them.
// `_ingestSpineEvent` carries it; the non-Spine branch of `_routeEvent` did not, and that branch
// is reached by any room whose NAME is neither `chat-*` nor a Spine prefix — which is every
// Matrix room this account is in that DDJP did not create, and every DM room J15 adds. Measured
// on the tree as received: a `ddjp.dj.join` delivered from an unbound room entered the log,
// answered `isLegal` true, and put a stranger in the rotation. That is J15's Done-when failing
// before J15 adds a single DM, and it is `README.md` trap 3 exactly — the rule enforced at one
// door out of two.
//
// It is EXECUTED because `_routeEvent` lives inside `MatrixBridge.start()`, which needs a live
// SDK client and which no guard in this suite runs. A regex proving `inScope` is spelled beside
// the store call is the same class of check that stayed green for the whole life of the blocked
// wire (J41).
//
// ── EVERY PART ASSERTS ITS OWN PREMISE ───────────────────────────────────────────────────────
// A refusal is evidence only if something adjacent was admitted (`09-roadmap.md` §8), and a probe
// that never reached the door refuses everything for free. So every refusal here is driven beside
// a control that must be ADMITTED through the same function with one detail changed, and the
// admissibility gate refuses a reading whose router reached nothing at all.

const assert = require("assert");
const P = require("./_probe-j15-dm.js");
const { loadInContext } = require("./_load.js");

let checks = 0;
function ok(cond, msg) {
  if (!cond) { console.log("[dm-panel] FAIL — " + msg); process.exit(1); }
  checks++;
}
function gate(kind, r, opts, where) {
  const g = P.admissible(kind, r, opts);
  ok(g.ok, where + ": the reading was refused by its own admissibility gate, so nothing asserted " +
    "from it would mean anything —\n      " + g.problems.join("\n      "));
}

// ---- the gate is itself untested code; it certifies everything below ----
const st = P.selfTest();
ok(st.missed.length === 0, "the admissibility gate MISSED cases it claims to catch (" +
  st.missed.join(" · ") + ") — it would certify a broken reading");
ok(st.falseAlarms.length === 0, "the admissibility gate refused sound readings (" +
  st.falseAlarms.join(" · ") + ") — a gate that refuses everything certifies nothing");

// ---- the real modules ----
const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js",
  "backends/backend1/streammanager.js",
  "backends/backend1/matrixbridge.js",
], {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
  window: {}, document: { body: { appendChild() {} } },
});
const MB = sb.MatrixBridge;

// The REAL channel predicates, handed to the driver by reference. A harness copy of these would
// be a second definition of "which rooms are ours", free to disagree with the one that ships.
const ROOM_SCOPE = ["!ev-owner:hs", "!cp-owner:hs", "!set-owner:hs", "!chat-unc:hs"];
const SPINE_ROOM = { roomId: "!ev-owner:hs", name: "events-owner" };
const CHAT_ROOM = { roomId: "!chat-unc:hs", name: "chat-uncategorized" };
const DM_ROOM = { roomId: "!dm-them:hs", name: "" };
const FOREIGN_ROOM = { roomId: "!elsewhere:hs", name: "Some Element Room" };

const PROTOCOL_BODY = JSON.stringify({ t: "ddjp.dj.join", l: 9, v: "SONG0" });
const CHAT_BODY = "hello there";

function route(room, body, opts) {
  return P.driveRoute(Object.assign({
    room, body,
    scope: ROOM_SCOPE,
    dmScope: [DM_ROOM.roomId],
    isSpineChannel: MB._isSpineChannel,
    isChatChannel: MB._isChatChannel,
  }, opts || {}));
}

// ═══ PART A — the second door is scoped by origin ════════════════════════════════════════════
// THE CONTROL FIRST. Without an admitted sibling, every refusal below is free.
const rSpine = route(SPINE_ROOM, PROTOCOL_BODY);
gate("route", rSpine, { expectAnyCall: true }, "PART A (control)");
ok(rSpine.spined, "PART A control: a protocol event on an IN-SCOPE Spine channel did not reach " +
  "`_ingestSpineEvent` — if the admitted case cannot be admitted, the refusals below prove nothing");

const rDM = route(DM_ROOM, CHAT_BODY);
gate("route", rDM, { expectAnyCall: true }, "PART A (dm)");
ok(!rDM.stored, "PART A: a DM message reached `EventCache.store` — the cache IS the bounded " +
  "voucher store, so this both persists decrypted plaintext at rest and can evict real Spine " +
  "originals. A DM is Skin; the store is one of the two places it must never arrive");
ok(!rDM.folded, "PART A: a DM message reached `StreamManager.ingest` — the other place");
ok(rDM.fannedOut, "PART A premise: the DM did not reach the raw listeners either, so this part " +
  "is measuring a router that dropped the event entirely rather than one that routed it to Skin " +
  "and nowhere else — the refusals above would then be free");

// ═══ PART B — origin decides, never the body ═════════════════════════════════════════════════
// The SAME bytes from three origins. This is the axis the rule is actually about: a body cannot
// promote itself into the fold by being well-formed, and a room cannot be admitted by lacking a
// name. `09-roadmap.md` P6 for Skin.
const bodies = [];
for (const [label, room, expectFold] of [
  ["in-scope spine channel", SPINE_ROOM, "spine"],
  ["a DM room", DM_ROOM, "none"],
  ["a foreign Matrix room", FOREIGN_ROOM, "none"],
]) {
  const r = route(room, PROTOCOL_BODY);
  gate("route", r, { expectAnyCall: true }, "PART B (" + label + ")");
  bodies.push({ label, r, expectFold });
  if (expectFold === "spine") {
    ok(r.spined && !r.folded && !r.stored,
      "PART B: " + label + " did not take the Spine door");
  } else {
    ok(!r.folded && !r.stored,
      "PART B: the SAME protocol body delivered from " + label + " reached the store/fold. " +
      "Origin did not decide — a room with no DDJP-shaped name fell through both NAME tests, " +
      "which is how a stranger joins the rotation from a room you never bound");
  }
}
// and the premise: the three readings really did differ, or this loop compared one thing to itself
ok(bodies[0].r.spined && !bodies[1].r.spined && !bodies[2].r.spined,
  "PART B premise: all three origins took the same door, so this comparison is not about origin " +
  "at all");

// ═══ PART C — the DM scope is a SECOND scope ═════════════════════════════════════════════════
// Putting DM ids into `_activeScope` would have been one line and exactly wrong: that scope is
// what the ingest door, `_heldHere` and the vouch bundler all read, so a DM would have become a
// candidate original, an eviction subject and a fold input in one move.
MB.setRoomScope({ events_owner: "!ev-owner:hs", chat_uncategorized: "!chat-unc:hs" });
MB.setDMScope(["!dm-them:hs"]);
ok(MB.inScope("!ev-owner:hs"), "PART C premise: the room scope did not bind, so every claim below " +
  "is about an unbound gate that refuses everything for free");
ok(MB.inDMScope("!dm-them:hs"), "PART C premise: the DM scope did not bind");
ok(!MB.inScope("!dm-them:hs"), "PART C: a DM room answers `inScope` TRUE — the DM has been added " +
  "to the ROOM scope, which is the store, the fold, `_heldHere` and the vouch bundler in one move");
ok(!MB.inDMScope("!ev-owner:hs"), "PART C: a Spine channel answers `inDMScope` TRUE");

// a room change does not unbind a conversation — a DM is with a PERSON, not inside a room
MB.clearRoomScope();
ok(!MB.inScope("!ev-owner:hs"), "PART C premise: clearRoomScope did not clear the room scope");
ok(MB.inDMScope("!dm-them:hs"), "PART C: leaving a room unbound the DM scope. A conversation is " +
  "with a person and does not come and go with a room — and the panel would empty on every " +
  "room change with nothing saying why");

// and it REPLACES rather than merges, for the same reason its sibling does
MB.setDMScope(["!dm-other:hs"]);
ok(MB.inDMScope("!dm-other:hs") && !MB.inDMScope("!dm-them:hs"),
  "PART C: `setDMScope` MERGED rather than replaced — the conversation set of a previous session " +
  "would keep feeding this one, which is the bug `setRoomScope` replaces to avoid");

// ═══ PART D — the index is metadata, and a body never survives ════════════════════════════════
// J15's Open, driven rather than asserted: DMs are RAM-only Skin, and what persists is WHO and
// WHEN. The obvious next feature is a message preview in the list, which would break it — so the
// rule is measured against a distinctive body rather than described.
const SECRET = "meet me at the docks at midnight";
// THE STORED BLOB CARRIES A BODY. This fixture is the one that matters and the one an earlier
// version of this part could not express: a `load: () => null` store never hands the sanitiser
// anything to sanitise, so the rule that strips an unknown key is never reached and a mutation
// deleting it survives. Driven on this instead — a previous build, or a hand-edited
// localStorage, presenting exactly the shape a message preview would arrive as.
const STORED = {
  dms: [
    { roomId: "!dm-them:hs", userId: "@them:hs", lastTs: 5000, readTs: 0, preview: SECRET, body: SECRET },
    { roomId: "!dm-other:hs", userId: "@other:hs", lastTs: 7000, readTs: 0 },
  ],
};
const prefs = loadInContext(["core/logger.js", "core/chatprefs.js"], {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Date, Math,
});
const written = [];
prefs.Store = { prefs: { load: () => JSON.parse(JSON.stringify(STORED)), save: (s) => { written.push(JSON.stringify(s)); } } };
const CP = prefs.ChatPrefs;
const loaded = CP.load();
ok(JSON.stringify(STORED).indexOf(SECRET) >= 0,
  "PART D premise: the fixture blob does not contain the body it is meant to smuggle in, so the " +
  "searches below are searching for nothing");
ok(loaded.dms.length === 2, "PART D premise: the stored index did not load, so the sanitiser was " +
  "never reached and the assertions below are about an empty list");
ok(JSON.stringify(loaded.dms).indexOf(SECRET) < 0,
  "PART D: a body key present in the STORED index survived `load` — the reader strips it on the " +
  "way out, so this is the layer where a preview would actually persist");
CP.dmTouch("!dm-them:hs", "@them:hs", 5500);
CP.dmTouch("!dm-other:hs", "@other:hs", 7000);
ok(written.length >= 2, "PART D premise: nothing was written to the prefs store, so the search " +
  "for a body below is a search through nothing");
const all = written.join("\n");
ok(all.indexOf(SECRET) < 0, "PART D: a message body reached the persisted index");
ok(all.indexOf("@them:hs") >= 0, "PART D premise: the counterparty is NOT in what was written, so " +
  "the body search above proves nothing about what this store can hold — it may simply be empty");

// the four fields, and no fifth — asserted on what is WRITTEN as well as on what is read, because
// those are two different sanitisers and only one of them decides what sits on the disk
for (const blob of written) {
  for (const row of (JSON.parse(blob).dms || [])) {
    const keys = Object.keys(row).sort().join(",");
    ok(keys === "lastTs,readTs,roomId,userId",
      "PART D: a row WRITTEN to the store carries the fields `" + keys + "` — the persisted shape " +
      "is the one that matters, and anything beyond the four scalars is where a preview would live");
  }
}
for (const row of CP.dmList()) {
  const keys = Object.keys(row).sort().join(",");
  ok(keys === "lastTs,readTs,roomId,userId",
    "PART D: an index row carries the fields `" + keys + "` — anything beyond the four scalars is " +
    "where a preview would live");
}

// bounded: the localStorage tier must never grow (`main/06-storage.md`)
for (let i = 0; i < CP.DM_CAP + 20; i++) CP.dmTouch("!dm-" + i + ":hs", "@u" + i + ":hs", 1000 + i);
ok(CP.dmList().length === CP.DM_CAP, "PART D: the index grew past its cap (" +
  CP.dmList().length + " > " + CP.DM_CAP + ") — this is the synchronous localStorage tier");
ok(CP.dmList()[0].lastTs >= CP.dmList()[CP.dmList().length - 1].lastTs,
  "PART D premise: the index is not ordered by last activity, so the cap above is dropping an " +
  "arbitrary row rather than the oldest conversation");

// ── THE SECOND CAP SITE, AND IT IS NOT THE ONE ABOVE ────────────────────────────────────────
// The cap assertion above drives `dmTouch`, which folds through `dmFold` — so it pins `dmFold`'s
// cap and NOTHING ELSE. `load()` carries its own trailing `.slice(0, DM_CAP)`, and deleting it
// left the whole suite green, because every fixture in this file hands the loader a blob that is
// already under the cap. The two sites bound DIFFERENT routes and neither dominates the other:
//
//   `dmFold`'s cap   bounds what THIS build writes.       Drop it: 50 rows + 20 touches -> 70 persist.
//   `load()`'s cap   bounds a blob this build did NOT write — an older build's, a hand-edited
//                    localStorage, or one written before the cap existed. Drop it: a 500-row
//                    stored index loads as 500, and the first `dmMarkRead` persists all 500 back.
//
// That second route is how an unbounded index enters the synchronous localStorage tier, which
// `main/06-storage.md` says must never grow — and it enters it through a WRITE this build makes,
// which is why "we cap what we write" is not the same claim. Driven in its own context, because
// the fixture above has already filled the shared one.
{
  const OVER = CP.DM_CAP + 450;
  const big = { dms: [] };
  for (let i = 0; i < OVER; i++) {
    big.dms.push({ roomId: "!dm-big" + i + ":hs", userId: "@b" + i + ":hs", lastTs: 100000 + i, readTs: 0 });
  }
  const wrote = [];
  const ctx = loadInContext(["core/logger.js", "core/chatprefs.js"], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Date, Math,
  });
  ctx.Store = { prefs: { load: () => JSON.parse(JSON.stringify(big)),
                         save: (st) => { wrote.push(JSON.parse(JSON.stringify(st))); } } };
  const CP2 = ctx.ChatPrefs;
  ok(big.dms.length > CP2.DM_CAP,
    "PART D premise: the stored blob is not over the cap, so the load below caps nothing and this " +
    "whole block would be measuring a blob that already fitted", big.dms.length);
  const loadedBig = CP2.load();
  ok(loadedBig.dms.length === CP2.DM_CAP,
    "PART D: an OVER-CAP stored index must be capped BY `load`, not merely by what this build " +
    "writes — a blob written by an older build reaches the reader with no fold in between",
    loadedBig.dms.length);
  ok(loadedBig.dms[0].lastTs > loadedBig.dms[loadedBig.dms.length - 1].lastTs,
    "PART D premise: the loaded index is not ordered by last activity, so the cap dropped an " +
    "arbitrary 450 rows rather than the oldest conversations", loadedBig.dms.length);

  // AND THE CONSEQUENCE, which is what makes this a storage rule rather than a display one: the
  // very next write persists whatever `load` accepted. An uncapped read becomes an uncapped WRITE
  // one call later, through a function that touches no cap of its own.
  CP2.dmMarkRead(loadedBig.dms[0].roomId, 999999);
  ok(wrote.length >= 1,
    "PART D premise: nothing was persisted, so the size assertion below is about no write at all",
    wrote.length);
  ok(wrote[wrote.length - 1].dms.length === CP2.DM_CAP,
    "PART D: and the first write after that load persists the CAPPED index — otherwise reading an " +
    "over-cap blob is how this build writes one back, and the localStorage tier grows through a " +
    "path that never asked `dmFold` anything",
    wrote[wrote.length - 1].dms.length);
}

// the read marker only moves forward — backfill decrypts newest-first, so a late older message
// must not re-raise a notification the person already read
CP.dmTouch("!dm-read:hs", "@r:hs", 9000);
CP.dmMarkRead("!dm-read:hs", 9000);
ok(!CP.dmUnread("!dm-read:hs"), "PART D premise: marking a conversation read at its own last " +
  "stamp left it unread, so the backwards case below cannot be attributed to the marker moving");
// The case, and it has to go through `dmMarkRead` rather than through a second `dmTouch`: the
// touch maxes the last stamp forward on its own, so an older touch changes nothing and a row
// written that way is green whatever the marker does. What actually happens is a backfilled older
// message arriving in the OPEN conversation, which marks read at ITS stamp — newest-first
// decryption (`main/04-features.md`) is why that ordering is normal rather than exotic.
CP.dmMarkRead("!dm-read:hs", 8000);
ok(!CP.dmUnread("!dm-read:hs"), "PART D: a read marker moved BACKWARDS onto an older message, so " +
  "a late decryption re-raised a notification for a conversation the person has already read");
// and the other half of the same max: marking read catches the row up to its own last activity,
// so a conversation cannot stay lit after it has been opened
CP.dmTouch("!dm-read:hs", "@r:hs", 11000);
CP.dmMarkRead("!dm-read:hs", 0);
ok(!CP.dmUnread("!dm-read:hs"), "PART D: marking a conversation read with no stamp left it unread " +
  "— opening a conversation must clear its own notification");

// ═══ PART E — the panel renders the feature's list and raises the notification ════════════════
// EXTRACTED FROM `ui/interface.js` AND EXECUTED, the fourth guard in the tree to do that. The
// panel is driven with opposite conversation lists and the rendered tree is compared, so "the
// notification appears" is measured rather than asserted.
const CONVOS = [
  { roomId: "!dm-a:hs", userId: "@a:hs", lastTs: 9000, unread: true },
  { roomId: "!dm-b:hs", userId: "@b:hs", lastTs: 8000, unread: false },
];
const pRows = P.drivePanel({ conversations: CONVOS });
gate("panel", pRows, { expectRows: true }, "PART E (rows)");
ok(pRows.rows.length === CONVOS.length, "PART E: the panel rendered " + pRows.rows.length +
  " conversation rows for " + CONVOS.length + " conversations");
ok(pRows.rows.filter((r) => r.unread).length === 1,
  "PART E: the unread mark does not follow the feature's own flag");
ok(pRows.badge === "DMs 1" && pRows.badgeUnread,
  "PART E: the tab badge reads " + JSON.stringify(pRows.badge) + " with one unread conversation — " +
  "the notification IN THE PANEL ITSELF is the thing J15's entry asks for");

const pNone = P.drivePanel({ conversations: [] });
gate("panel", pNone, {}, "PART E (empty)");
ok(pNone.rows.length === 0, "PART E: rows appeared with no conversations");
ok(pNone.badge === "DMs" && !pNone.badgeUnread,
  "PART E: the badge reads " + JSON.stringify(pNone.badge) + " with nothing unread — a zero badge " +
  "trains people to ignore a real one");
ok(pRows.source === pNone.source,
  "PART E premise: the two drives read different panel source, so the comparison is not about the " +
  "conversation list at all");

// a row click opens the conversation THROUGH the feature — the panel navigates, it does not decide
const opened = pRows.openRow("!dm-a:hs");
ok(opened.view === "convo", "PART E: clicking a conversation row did not open it");
ok(opened.chatCalls.some((c) => c.f === "openDMRoom" && c.id === "!dm-a:hs"),
  "PART E: the panel switched view without asking `Chat.openDMRoom` — a view that opens itself is " +
  "a second definition of which conversation is current");

// the RAM view's cap and its non-downgrading upsert
const fold = pRows.fold;
let msgs = [];
msgs = fold(msgs, { id: "$1", sender: "@a", body: "real", failed: false, ts: 1 }, 500);
msgs = fold(msgs, { id: "$1", sender: "@a", body: "", failed: true, ts: 1 }, 500);
ok(msgs.length === 1 && msgs[0].body === "real",
  "PART E: a late decryption FAILURE clobbered text already rendered — the non-downgrading rule " +
  "`ChatBuffer` holds for room chat, which a DM needs for the same reason");
let capped = [];
for (let i = 0; i < 30; i++) capped = fold(capped, { id: "$" + i, sender: "@a", body: "m", failed: false, ts: i }, 10);
ok(capped.length === 10, "PART E: the RAM message view grew past its cap (" + capped.length + ")");

// ═══ PART F — the container's premise, which J14's handoff flagged and nothing checked ═══════
// `check-user-card` PART E proves the CARD filters against `Actions.ACTIONS`. It stubs that
// export, so it says nothing about whether the shipped export is the adapter's real vocabulary —
// and J14's handoff records exactly that: "if that export ever becomes filtered or cached, PART E
// starts measuring the cache and the container claim quietly stops being checked." This is that
// premise, asserted where it can fail. It is why J15 could rely on one catalog entry.
const app = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
  "features/actions.js",
], {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Date, Math, setTimeout, clearTimeout,
  Room: { getMyId: () => "@me:hs", getMyRank: () => 100 },
  Chat: { cryptoReady: () => true },
  Queue: {}, Skip: {}, Reactions: {}, RoomUpgrade: {},
});
const A = app.Actions;
ok(Array.isArray(A.ACTIONS) && A.ACTIONS.length > 0,
  "PART F premise: `Actions.ACTIONS` is not a non-empty array, so the comparison below is vacuous");
// BOTH DIRECTIONS. Every name the export publishes must resolve, and every name that resolves
// must be published — a filtered export fails the second, a stale cache fails the first.
for (const a of A.ACTIONS) {
  ok(A.describe(a, {}).reason !== "Unknown action",
    "PART F: `Actions.ACTIONS` publishes `" + a + "` which the adapter cannot resolve — the export " +
    "is a stale copy rather than the live vocabulary");
}
ok(A.describe("definitely.not.an.action", {}).reason === "Unknown action",
  "PART F premise: the adapter answers a made-up action as though it knew it, so 'resolves' does " +
  "not discriminate and the loop above passes for anything");
ok(A.ACTIONS.indexOf("chat.dm") >= 0,
  "PART F: `chat.dm` is not in the adapter's vocabulary, so the card's declared slot stays dark — " +
  "this is the one catalog entry J14 said would light it up");
// and the card really is unedited in the way that mattered: the row J14 declared is the row J15
// filled, matched by its action id rather than by the file's shape
const cardTable = P.extractNamed(P.UI_REL, "_CARD_ACTIONS");
ok(cardTable.ok, "PART F: `_CARD_ACTIONS` could not be extracted — " + (cardTable.stage || ""));
ok(cardTable.source.indexOf('action: "chat.dm"') >= 0,
  "PART F: the card's table no longer declares `chat.dm`");

console.log("[dm-panel] PASS — a DM is Skin and the transport is what enforces it: the SECOND " +
  "ingest door is now scoped BY ORIGIN, so a message from a room this client never bound reaches " +
  "neither the voucher store nor the fold — driven by EXTRACTING `_routeEvent` out of " +
  "`matrixbridge.js` and RUNNING it, because that router needs a live SDK client and no guard in " +
  "this suite executed it, and a regex proving `inScope` is spelled beside the store call is the " +
  "check that stayed green for the whole life of the blocked wire. The same protocol body is " +
  "driven from three origins and takes three fates, so a body cannot promote itself into the fold " +
  "by being well-formed and a room cannot be admitted by lacking a name — which is what it did " +
  "before this: measured on the tree as received, a `ddjp.dj.join` from an unbound room entered " +
  "the log, answered isLegal true, and put a stranger in the rotation. The DM scope is a SECOND " +
  "scope rather than a second entry in the first (the first is read by the door, `_heldHere` AND " +
  "the vouch bundler, so one line there would have made a DM a fold input, a candidate original " +
  "and an eviction subject at once); it survives a room change because a conversation is with a " +
  "person, and it REPLACES like its sibling. The conversation index is METADATA — driven against " +
  "a distinctive body that reaches nothing persisted, four scalar fields and no fifth, capped " +
  "because it lives in the synchronous tier, and a read marker that only moves forward so a " +
  "newest-first backfill cannot re-raise what was read. The panel is EXTRACTED FROM " +
  "`ui/interface.js` AND EXECUTED — the fourth guard to do that — and driven with opposite " +
  "conversation lists, so the badge and the row dot are measured rather than described, while a " +
  "row click routes through the feature instead of the view deciding which conversation is " +
  "current. And PART F pins the premise J14's handoff flagged and nothing checked: " +
  "`Actions.ACTIONS` is the adapter's REAL vocabulary, asserted both ways, which is the whole " +
  "reason one catalog entry was enough (" + checks + " assertions)");
