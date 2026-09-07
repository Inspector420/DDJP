// tools/probes/probe-j16-active.js — READ-ONLY. Measures the two claims J16 was re-scoped on,
// and the one that decides its Kind. Changes nothing; run it against any tree:
//   node tools/probes/probe-j16-active.js
//   node tools/probes/probe-j16-active.js --selftest
//
// ── THE THREE QUESTIONS ──────────────────────────────────────────────────────────────────────
// R0-R2  Is the Done-when computable TODAY? The entry declares a dependency on J20, which depends
//        on J17, which is the bot — a phase that has not started. But the Done-when asks only that
//        the list mean "who has done something recently", and every log entry carries a `sender`
//        and a server `ts`. If three events across two senders fold to a last-activity map with no
//        bot, no new event type and no new module, the dependency is wrong.
// R3-R5  How many of the four sources the entry names can actually reach the log, and what the
//        log's REACH does to a window wider than it.
// R6-R7  What a room setting would have COST, with the control first. This is the measurement the
//        Kind decision rests on, and it is the reason the window lives in a device preference.
//
// ── WHY EVERY ROW STATES ITS OWN PREMISE ─────────────────────────────────────────────────────
// Every reading here is "did X appear?" against a fixture, and the subject is a list that can
// legitimately be EMPTY. So a fixture that never reached the log reports the same absence a
// correct window does, and absence reads exactly like a finding (`tests/_fixtures.js`). Each row
// therefore checks its preconditions SEPARATELY, before any comparison, and refuses to print a
// result if one fails — naming the stage. `--selftest` feeds each gate a deliberately broken
// input and shows it catches it, because a gate nobody has tested certifies everything downstream
// on its own authority.

const path = require("path");
const TREE = process.env.DDJP_TREE || path.resolve(__dirname, "../..");
const { loadInContext } = require(path.join(TREE, "tests", "_load.js"));
const F = require(path.join(TREE, "tests", "_fixtures.js"));

const SELFTEST = process.argv.indexOf("--selftest") >= 0;
const MIN = 60000;
const out = {};

function inadmissible(row, stage, detail) {
  const payload = { INADMISSIBLE: row, stage: stage, detail: detail,
    note: "the fixture never reached the subject; nothing below would mean anything" };
  if (SELFTEST) throw new Error("GATE REFUSED " + row + " at: " + stage);
  console.log(JSON.stringify(payload, null, 1));
  process.exit(2);
}

// A client with the REAL StreamManager and the REAL Room reader.
function client() {
  const sb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js", "core/playlistdoc.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/settingsproof.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js", "features/room.js",
  ], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
  });
  sb.feed = (evs) => { for (const e of evs) sb.StreamManager.ingest(F.toRaw(e)); };
  return sb;
}

// ══ R0-R2 — is the Done-when computable with no bot? ═════════════════════════════════════════
function rowsA(opts) {
  const o = opts || {};
  const c = client();
  const room = F.playingRoom({ songs: 1 });
  c.feed(F.sortLog(room.log));
  const headL = room.lastL, t = room.startTs + 400000, other = "@voter:hs";

  // THREE EVENTS ACROSS TWO SENDERS — a queue act, a vote and a save. Three of the four sources
  // the entry names; the fourth is R3.
  const sent = [
    F.reducerEvent("$act1", headL + 1, t,        room.dj, F.RANK.player, { t: "ddjp.dj.declare", v: "SONG9" }),
    F.reducerEvent("$act2", headL + 2, t + 1000, other,   F.RANK.vip,    { t: "ddjp.dj.vote", p: room.pi(0) }),
    F.reducerEvent("$act3", headL + 3, t + 2000, other,   F.RANK.vip,    { t: "ddjp.dj.save", p: room.pi(0) }),
  ];
  for (const e of sent) {
    const raw = F.toRaw(e);
    if (o.breakSender) delete raw.sender;
    c.StreamManager.ingest(raw);
  }

  const log = c.StreamManager.getLog();
  // GATE 1 — the log exists at all.
  if (!Array.isArray(log) || log.length === 0) inadmissible("R0", "log-empty", { len: log && log.length });
  // GATE 2 — the events we sent are IN it, rather than refused at the door.
  const ids = new Set(log.map((e) => e.eventId));
  const missing = sent.map((e) => e.eventId).filter((id) => !ids.has(id));
  if (missing.length) inadmissible("R0", "sent-events-not-in-log", { missing });
  // GATE 3 — the two fields the map reads are present on them.
  const mine = log.filter((e) => /^\$act/.test(e.eventId));
  const noSender = mine.filter((e) => !e.sender).map((e) => e.eventId);
  const noTs = mine.filter((e) => typeof e.ts !== "number" || !e.ts).map((e) => e.eventId);
  if (noSender.length) inadmissible("R0", "entries-carry-no-sender", { noSender });
  if (noTs.length) inadmissible("R0", "entries-carry-no-ts", { noTs });

  const f = c.Room.recentlyActive(t + 3000, 60 * MIN);
  const map = {};
  for (const p of f.people) map[p.userId] = p.lastTs;

  out.R0_every_entry_carries_sender_and_server_ts = {
    entries: log.length,
    everySender: log.every((e) => !!e.sender),
    everyTs: log.every((e) => typeof e.ts === "number" && e.ts > 0),
  };
  out.R1_three_events_two_senders_fold_to_a_map = {
    senders: f.people.map((p) => p.userId).sort(),
    map: map,
    expected: { [room.dj]: t, [other]: t + 2000 },
    // The CONTROL for "these are server stamps": they are byte-identical to what was sent, so
    // nothing derived them from a local clock on the way through.
    stampsAreTheOnesSent: map[other] === t + 2000 && map[room.dj] === t,
  };
  out.R2_no_bot_no_new_event_type_no_new_module = {
    modulesLoaded: "the shipped tree only — Room.recentlyActive reads StreamManager.getLog()",
    newEventTypes: [],
    verdict: (f.people.length === 2)
      ? "the Done-when is computable TODAY; the entry's dependency on J20 (and so on J17, the bot) is WRONG"
      : "INCONCLUSIVE — read R1",
  };
  return c;
}

// ══ R3 — how many of the four named sources can reach the log ════════════════════════════════
function rowB(opts) {
  const o = opts || {};
  const P15 = require(path.join(TREE, "tests", "_probe-j15-dm.js"));
  const mb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js",
  ], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
  });
  const body = JSON.stringify({ t: "ddjp.dj.join", l: 9, v: "SONG0" });
  const route = (room) => P15.driveRoute({
    room, body, scope: ["!ev-owner:hs", "!chat-unc:hs"], dmScope: [],
    isSpineChannel: o.breakPredicate ? (() => false) : mb.MatrixBridge._isSpineChannel,
    isChatChannel: mb.MatrixBridge._isChatChannel,
  });

  const spine = route({ roomId: "!ev-owner:hs", name: "events-owner" });
  const chat = route({ roomId: "!chat-unc:hs", name: "chat-uncategorized" });
  // GATE — the CONTROL must be admitted, or the refusal below is free. This is the row that
  // catches a harness that routed nothing: a broken router refuses chat for the wrong reason.
  if (!spine.ok) inadmissible("R3", "router-did-not-run", spine.stage);
  if (!spine.spined) inadmissible("R3", "control-not-admitted",
    { note: "the same body on an in-scope events channel did not reach the ingest door", names: spine.names });
  if (!chat.ok) inadmissible("R3", "router-did-not-run-for-chat", chat.stage);

  out.R3_chat_cannot_reach_the_log = {
    control_events_channel: { folded: spine.folded || spine.spined, stored: spine.stored || spine.spined },
    chat_channel: { folded: chat.folded, stored: chat.stored, rawListeners: chat.fannedOut },
    verdict: (!chat.folded && !chat.stored && chat.fannedOut)
      ? "THREE of the four sources the entry names, not four: chat reaches the raw listeners and nothing else"
      : "INCONCLUSIVE — read the two rows above",
  };
}

// ══ R4-R5 — the log's reach bounds the window ════════════════════════════════════════════════
function rowsC(opts) {
  const o = opts || {};
  const c = client();
  const Room = c.Room;
  const T = 10000000;
  const young = [{ sender: "@a:hs", ts: T - 3 * MIN }, { sender: "@b:hs", ts: T - 1 * MIN }];
  const ample = [{ sender: "@a:hs", ts: T - 90 * MIN }, { sender: "@b:hs", ts: T - 1 * MIN }];

  const f = Room.foldActivity(o.emptyLog ? [] : young, T, 60 * MIN);
  const g = Room.foldActivity(o.emptyLog ? [] : ample, T, 60 * MIN);
  // GATE — both folds must have SEEN something, or "bounded" below is a statement about an empty
  // array rather than about the reach.
  if (!f.counted || !g.counted) inadmissible("R4", "fold-counted-nothing", { f: f.counted, g: g.counted });

  out.R4_reach_bounds_the_window = {
    requested: 60 * MIN,
    young: { reach: f.reach, effective: f.effectiveWindowMs, bounded: f.bounded, people: f.people.length },
    control_ample: { reach: g.reach, effective: g.effectiveWindowMs, bounded: g.bounded, people: g.people.length },
    verdict: (f.bounded && f.effectiveWindowMs === f.reach && !g.bounded && g.effectiveWindowMs === 60 * MIN)
      ? "the effective window is the smaller of the two, and `bounded` is a READING of the log rather than a constant"
      : "INCONCLUSIVE",
  };
  out.R5_narrowing_the_claim_does_not_narrow_the_list = {
    youngPeople: f.people.map((p) => p.userId),
    note: "a young room shows everybody it holds; what shrinks is what the panel CLAIMS to have looked at",
  };
}

// ══ R6-R7 — what a room setting would have cost, control first ═══════════════════════════════
// THE MEASUREMENT THE KIND DECISION RESTS ON. `core/chatprefs.js` cites these two rows.
function rowsD(opts) {
  const o = opts || {};
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js",
  ], { Date, Math, JSON });
  const seed = sb.StateDeriver.buildSeed(F.sortLog(F.playingRoom({ songs: 2 }).log), null);
  if (o.stripSettings) delete seed.settings;

  // GATE — the seed must carry a settings blob, and it must be the reducer's own key set. A seed
  // with no settings would answer "no movement" for the wrong reason, and that reads exactly like
  // "a settings key is free".
  if (!seed || !seed.settings || typeof seed.settings !== "object") {
    inadmissible("R6", "seed-carries-no-settings", { keys: Object.keys(seed || {}) });
  }
  const defKeys = Object.keys(sb.StateDeriver.defaultSettings()).sort();
  const seedKeys = Object.keys(seed.settings).sort();
  const missing = defKeys.filter((k) => seedKeys.indexOf(k) < 0);
  if (missing.length) inadmissible("R6", "seed-settings-not-the-default-key-set", { missing });

  const fp = (s) => sb.CheckpointFormat.fingerprint(1, null, s, 10, false, "$a..$b");
  const base = fp(seed);
  const ctl = JSON.parse(JSON.stringify(seed)); ctl.tick = (ctl.tick || 0) + 1;
  const key = JSON.parse(JSON.stringify(seed)); key.settings.zzWouldBeANewKey = 900000;   // any key that does not exist yet

  out.R6_control_the_instrument_reads_the_seed = {
    field: "tick", movedFingerprint: fp(ctl) !== base,
    note: "without this, R7 measuring 'no movement' would be indistinguishable from a broken instrument",
  };
  out.R7_one_settings_key_moves_every_checkpoint = {
    key: "zzWouldBeANewKey", settingsKeysBefore: seedKeys.length,
    movedFingerprint: fp(key) !== base,
    consequence: "Floor.chainVerifies refuses every checkpoint sealed earlier; the room holds no floor " +
      "and forgets nothing until it seals TWO fresh ones (09-roadmap.md J45)",
    verdict: (fp(ctl) !== base && fp(key) !== base)
      ? "a room setting would have made J16 `derivation` and put it on the Phase 6 gate — which is why " +
        "the window lives in core/chatprefs.js, a module no backend reads"
      : "INCONCLUSIVE — read R6 before believing R7",
  };
}

// ══ self-test — each gate fed a deliberately broken input ════════════════════════════════════
if (SELFTEST) {
  const rows = [];
  const expectRefusal = (name, fn) => {
    try { fn(); rows.push({ row: name, refused: false }); }
    catch (e) { rows.push({ row: name, refused: true, at: String(e.message) }); }
  };
  expectRefusal("R0 — entries carry no sender", () => rowsA({ breakSender: true }));
  expectRefusal("R3 — the control is not admitted", () => rowB({ breakPredicate: true }));
  expectRefusal("R4 — the fold counted nothing", () => rowsC({ emptyLog: true }));
  expectRefusal("R6 — the seed carries no settings", () => rowsD({ stripSettings: true }));
  const clean = rows.filter((r) => r.refused).length;
  console.log(JSON.stringify(rows, null, 1));
  console.log(clean === 4 ? "SELFTEST OK — every gate refuses its broken input"
                          : "SELFTEST FAILED — a gate certified a fixture that never reached its subject");
  process.exit(clean === 4 ? 0 : 1);
}

rowsA({});
rowB({});
rowsC({});
rowsD({});
console.log(JSON.stringify(out, null, 1));
