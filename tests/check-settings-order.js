// tests/check-settings-order.js
// WALL: log-ordered settings (Phase 2). Settings are judged AT LOG POSITION, not from
// the live/current value. A play snapshots the settings in force WHEN IT STARTED onto
// nowPlaying.settings; a later settings change overwrites the running `settings` but
// NOT that frozen snapshot (keep-start-settings). This is the foundation the ceiling
// (maxLen) and the advance-gate floor (minGate) stand on.
//
// Guarantees, all load-bearing:
//   PART A — SNAPSHOT AT START. A song carries the settings that were in force at its
//     play position. With no settings events, that's the defaults (incl. the new
//     maxLen/minLen/minGate dials).
//   PART B — KEEP-START on mid-song change. An owner settings event that sorts AFTER a
//     song's play does NOT change that song's snapshot; the NEXT song gets the new value.
//   PART C — VALIDATION is total + range-checked. Out-of-range maxLen/minLen/minGate are
//     ignored (keep current); valid ones apply. Below-owner settings events are ignored.
//   PART D — CONVERGENT. The per-song snapshots are identical across shuffled arrival
//     orders (settings-at-position is a pure function of the ordered prefix).

const assert = require("assert");
const { loadInContext } = require("./_load");

const RANK = { OWNER: 100, STAFF: 60, PLAYER: 20 };

function fail(msg, got) {
  console.log("[settings-order] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}

function makeClient() {
  return loadInContext(
    ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"],
    { Date }
  ).StreamManager;
}
function raw(eventId, l, sender, body, rank) {
  const r = { event_id: eventId, room_id: "!r:hs", type: "m.room.message", sender,
    content: { body: JSON.stringify(Object.assign({ l }, body)) }, ts: l * 60000, l };
  if (rank !== undefined) r.senderRank = rank;
  return r;
}
const j = (x) => JSON.stringify(x);

// Scenario: two DJs; owner sets maxLen=120 BEFORE the first play; then mid-way (after
// the first play, before the second) the owner lowers maxLen to 60. The first song must
// keep 120 (its start value); the second must get 60.
function scenario() {
  return [
    raw("$01", 1, "@a:hs", { t: "ddjp.dj.join", v: "S1" }, RANK.PLAYER),
    raw("$02", 2, "@b:hs", { t: "ddjp.dj.join", v: "S2" }, RANK.PLAYER),
    raw("$03", 3, "@o:hs", { t: "ddjp.room.settings", s: { maxLen: 120 } }, RANK.OWNER),   // before any play
    raw("$04", 4, "@a:hs", { t: "ddjp.dj.play", p: null }, RANK.PLAYER),                   // S1 starts under maxLen=120
    raw("$05", 5, "@o:hs", { t: "ddjp.room.settings", s: { maxLen: 60 } }, RANK.OWNER),    // mid-song change
    raw("$06", 6, "@b:hs", { t: "ddjp.dj.play", p: "$04" }, RANK.PLAYER),                  // S2 starts under maxLen=60
  ];
}

// ---- PART A + B: snapshot at start, keep-start on mid-song change ---------------
(() => {
  const C = makeClient();
  scenario().forEach((e) => C.ingest(e));
  const st = C.getState();
  // After both plays, live settings.maxLen should be 60 (last-write-wins on the running value)
  assert.strictEqual(st.settings.maxLen, 60, "live settings reflect the latest change");
  // The now-playing song is S2, which started under maxLen=60
  assert.ok(st.nowPlaying && st.nowPlaying.song.videoId === "S2", "S2 is now playing");
  assert.strictEqual(st.nowPlaying.settings.maxLen, 60, "S2 snapshot = 60 (its start value)");
  // History: S1 played first — its recorded start must reflect maxLen=120 (keep-start).
  // History carries pi; we re-derive S1's snapshot by checking the play that created it.
  // The reducer snapshots onto nowPlaying; history stores the play record. We assert the
  // KEEP-START property via a single-play run below to read S1's snapshot directly.
})();

// Direct keep-start read: stop right after S1's play and the mid-song change, and confirm
// S1's snapshot is still 120 even though live settings already moved to 60.
(() => {
  const C = makeClient();
  const evs = scenario().slice(0, 5); // through the mid-song change ($05), before S2 plays
  evs.forEach((e) => C.ingest(e));
  const st = C.getState();
  assert.strictEqual(st.settings.maxLen, 60, "live settings already lowered to 60");
  assert.ok(st.nowPlaying && st.nowPlaying.song.videoId === "S1", "S1 still playing");
  assert.strictEqual(st.nowPlaying.settings.maxLen, 120,
    "KEEP-START: S1 keeps its start value 120 even though live settings is 60");
})();

// ---- PART C: validation total + range-checked; below-owner ignored -------------
(() => {
  const C = makeClient();
  [
    raw("$01", 1, "@a:hs", { t: "ddjp.dj.join", v: "S1" }, RANK.PLAYER),
    // out-of-range: maxLen too big, minLen negative, minGate past its ceiling → all ignored (keep defaults)
    raw("$02", 2, "@o:hs", { t: "ddjp.room.settings", s: { maxLen: 999999, minLen: -5, minGate: 999999 } }, RANK.OWNER),
    // a NON-owner settings event → ignored entirely
    raw("$03", 3, "@x:hs", { t: "ddjp.room.settings", s: { maxLen: 30 } }, RANK.STAFF),
  ].forEach((e) => C.ingest(e));
  const s = C.getState().settings;
  assert.strictEqual(s.maxLen, 600, "out-of-range maxLen ignored → default 600");
  assert.strictEqual(s.minLen, 10, "out-of-range minLen ignored → default 10");
  assert.strictEqual(s.minGate, 8000, "out-of-range minGate ignored → default 8000");
  // now a valid owner change applies
  C.ingest(raw("$04", 4, "@o:hs", { t: "ddjp.room.settings", s: { maxLen: 300, minGate: 20000 } }, RANK.OWNER));
  const s2 = C.getState().settings;
  assert.strictEqual(s2.maxLen, 300, "valid maxLen applies");
  assert.strictEqual(s2.minGate, 20000, "valid minGate applies");

// ── minGate AND vouchJitter ARE A PAIR ───────────────────────────────────────────────────────
// The reducer's note on minGate has always said it must exceed the full stagger ladder, and until
// now nothing enforced it. Two ways to break the advance gate from the settings panel followed:
// set minGate below the ladder, so a whole rank's slot opens before any advance is legal; or set
// it to 0, which the range permitted outright and which makes a song advanceable one millisecond
// in — not eight seconds of music, none.
//
// Validated and reverted TOGETHER, like maxLen/minLen, because half of an inconsistent pair
// landing leaves the owner with a combination they never chose. The bound is DERIVED from
// Ranks.LADDER, so adding a rank or widening the step moves it without anyone remembering to.
{
  const setTo = (o) => {
    const c = makeClient();
    c.ingest(raw("$g", 1, "@o:hs", { t: "ddjp.room.settings", s: o }, RANK.OWNER));
    return c.getState().settings;
  };
  const dflt = setTo({});

  assert.strictEqual(setTo({ minGate: 0 }).minGate, dflt.minGate,
    "minGate=0 is refused. It was inside the declared range and made every song advanceable "
    + "immediately — the total-loss version of a client advancing at the floor");
  assert.strictEqual(setTo({ minGate: 5000 }).minGate, dflt.minGate,
    "minGate below the ladder width is refused, because a whole rank's slot would otherwise open "
    + "before any advance was legal");
  assert.strictEqual(setTo({ minGate: 20000 }).minGate, 20000,
    "a minGate above the ladder applies");

  const alone = setTo({ vouchJitter: 5000 });
  assert.strictEqual(alone.vouchJitter, dflt.vouchJitter,
    "raising the jitter ALONE is refused: it widens the ladder past the current minGate, and the "
    + "pair reverts rather than letting half the change land");
  assert.strictEqual(alone.minGate, dflt.minGate,
    "and minGate is untouched by that refusal — neither half moves");

  const both = setTo({ vouchJitter: 5000, minGate: 40000 });
  assert.strictEqual(both.vouchJitter, 5000, "a consistent pair applies");
  assert.strictEqual(both.minGate, 40000, "both halves of it");
}

// ── THE CHAT TIER HAS THREE VALUES, AS THE ROOM ALREADY HAS THREE CHANNELS ───────────────────
// chat-staff is created in batch 3 and the documentation describes it as selectable; the reducer
// was the only thing that never accepted it, so an owner could watch the channel be created and
// never be able to point the room at it. Adding the value costs one comparison; the alternative
// was paying batch 3's creation cost in order to delete a feature.
{
  const setTo = (o) => {
    const c = makeClient();
    c.ingest(raw("$c", 1, "@o:hs", { t: "ddjp.room.settings", s: o }, RANK.OWNER));
    return c.getState().settings.chat;
  };
  assert.strictEqual(setTo({ chat: "uncategorized" }), "uncategorized", "uncategorized is selectable");
  assert.strictEqual(setTo({ chat: "guest" }), "guest", "guest is selectable");
  assert.strictEqual(setTo({ chat: "staff" }), "staff",
    "staff is selectable — the channel exists, so refusing the value stranded it");
  assert.strictEqual(setTo({ chat: "owner" }), "uncategorized",
    "but only tiers that HAVE a channel: there is no chat-owner, so the value is refused rather "
    + "than pointing the room at a room that was never created");
  assert.strictEqual(setTo({ chat: "nonsense" }), "uncategorized", "and nonsense is refused");
}

  assert.strictEqual(s2.minLen, 10, "unspecified minLen stays");
})();

// ---- PART C2: the vouching / checkpoint / trust dials validate the same way ----
(() => {
  const C = makeClient();
  const D = C.getState().settings;
  assert.strictEqual(D.vouchTable.length, 7, "the vouch table has one row per rank");
  assert.strictEqual(D.vouchTable[1].enough, 2, "default: 2 high-staff satisfy");
  assert.strictEqual(D.vouchTable[D.vouchTable.length - 1].enough, null, "default: uncategorized can never satisfy alone");
  assert.strictEqual(D.checkpointTable[1].enough, 3, "default: 3 different-user high-staff checkpoints substitute");
  assert.strictEqual(D.checkpointCooldownMs, 20 * 60 * 1000, "default cooldown is 20 minutes");

  // ── THE BLOBS BELOW ARE COMPLETE, BECAUSE PRODUCTION'S ARE ─────────────────────────────
  // These were sparse — `{ vouchJitter: 800 }` and nothing else — which no client has ever sent:
  // `Room.setSettings` merges the caller's partial onto the CURRENT FULL blob and posts that,
  // because the event is last-write-wins and must carry every setting each time
  // (check-settings-passthrough pins it). A sparse blob is also unverifiable by construction — a
  // verifier replays the named event from DEFAULTS, so absent fields come back as defaults rather
  // than as what the room actually had.
  //
  // Rebuilt to production shape when the reducer began requiring a settings event to REPRODUCE
  // the settings it results in (check-settingsproof PART I). The assertions below are
  // UNCHANGED — the property under test is still table completeness — and the guard was
  // mutation-checked afterwards to confirm it still fails for its own reason rather than passing
  // because the fixture moved.
  const full = (over) => Object.assign({}, C.getState().settings, over);

  // OUT-OF-RANGE FIELDS ARE STILL IGNORED HERE, AND THAT IS THE RULE WORKING RATHER THAN AN
  // EXCEPTION TO IT. The reducer requires a settings event to REPRODUCE the settings it results in, and
  // this one does: the room is still on defaults, so a refused field leaves exactly the value a
  // replay from defaults would produce. The event is a faithful account of the room and is
  // accepted.
  //
  // The whole event is refused only where refusing a field would leave the room in a state no
  // single event describes — i.e. where the current value differs from the default. That case is
  // driven in check-settingsproof PART I, which is where the pointer is actually verified; here
  // it would be asserted against a room that cannot exhibit it. (Asserted the other way round
  // first, and this fixture is what corrected it.)
  C.ingest(raw("$w1", 1, "@o:hs", { t: "ddjp.room.settings", s: full({ vouchJitter: 99999, receiptsPerMessage: 999, checkpointCooldownMs: -5, selfWitnessCheckpoint: "yes" }) }, RANK.OWNER));
  let s1 = C.getState().settings;
  assert.strictEqual(s1.vouchJitter, 1000, "out-of-range vouch jitter ignored");
  assert.strictEqual(s1.receiptsPerMessage, 10, "out-of-range receipts-per-message ignored");
  assert.strictEqual(s1.checkpointCooldownMs, 20 * 60 * 1000, "negative cooldown ignored");
  assert.strictEqual(s1.selfWitnessCheckpoint, true, "non-boolean self-witness flag ignored");

  // valid owner changes apply
  C.ingest(raw("$w2", 2, "@o:hs", { t: "ddjp.room.settings", s: full({ vouchJitter: 800, receiptsPerMessage: 25, checkpointCooldownMs: 60000, selfWitnessCheckpoint: false }) }, RANK.OWNER));
  let s2 = C.getState().settings;
  assert.strictEqual(s2.vouchJitter, 800, "valid vouch jitter applies");
  assert.strictEqual(s2.receiptsPerMessage, 25, "valid receipts-per-message applies");
  assert.strictEqual(s2.checkpointCooldownMs, 60000, "valid cooldown applies");
  assert.strictEqual(s2.selfWitnessCheckpoint, false, "valid self-witness flag applies");

  // a table is accepted only COMPLETE and well-formed — never merged half-and-half
  const good = [{ enough: 1 }, { enough: 3, always: true }, { enough: null, always: true }, { enough: 9 }, { enough: null }, { enough: null }, { enough: null }];
  C.ingest(raw("$w3", 3, "@o:hs", { t: "ddjp.room.settings", s: full({ vouchTable: good.slice(0, 4) }) }, RANK.OWNER));
  assert.strictEqual(C.getState().settings.vouchTable[1].enough, 2, "a SHORT vouch table is dropped wholesale (no half-applied policy)");
  C.ingest(raw("$w4", 4, "@o:hs", { t: "ddjp.room.settings", s: full({ vouchTable: [{ enough: 0 }, {}, {}, {}, {}, {}, {}] }) }, RANK.OWNER));
  assert.strictEqual(C.getState().settings.vouchTable[1].enough, 2, "a table with an out-of-range count is dropped wholesale");
  C.ingest(raw("$w5", 5, "@o:hs", { t: "ddjp.room.settings", s: full({ vouchTable: good }) }, RANK.OWNER));
  const t5 = C.getState().settings.vouchTable;
  assert.strictEqual(t5[1].enough, 3, "a complete, valid vouch table applies");
  assert.strictEqual(t5[2].enough, null, "'never' is a legal value for a rank");
  assert.strictEqual(t5[2].always, true, "the per-rank always-vouch toggle applies");
  assert.strictEqual(t5[0].always, false, "a missing toggle defaults to off (total validation)");

  // below-owner changes are ignored
  C.ingest(raw("$w6", 6, "@x:hs", { t: "ddjp.room.settings", s: full({ vouchJitter: 1 }) }, RANK.STAFF));
  assert.strictEqual(C.getState().settings.vouchJitter, 800, "a below-owner dial change is ignored");
})();

// ---- PART D: convergent across shuffled arrival orders -------------------------
(() => {
  const canonical = makeClient();
  scenario().forEach((e) => canonical.ingest(e));
  const want = j(canonical.getState().nowPlaying.settings);
  const wantMax = canonical.getState().nowPlaying.settings.maxLen;

  function shuffle(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const k = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[k]; a[k] = t; } return a; }
  for (let n = 0; n < 200; n++) {
    const C = makeClient();
    shuffle(scenario()).forEach((e) => C.ingest(e));
    const np = C.getState().nowPlaying;
    if (!np || np.song.videoId !== "S2") fail("shuffled order changed which song plays", np);
    if (np.settings.maxLen !== wantMax) fail("shuffled order changed the snapshot maxLen", np.settings);
    if (j(np.settings) !== want) fail("shuffled order changed the settings snapshot", np.settings);
  }
})();

// ── (e) minLen / maxLen are resolved as a PAIR ───────────────────────────────────
// A ceiling below the floor is nonsense, so the two are judged together: a legal
// simultaneous change is accepted (judging each against the OTHER's old value would
// reject it), and an inverted proposal is dropped WHOLESALE rather than half-applied.
(() => {
  const C = makeClient();
  const D0 = C.getState().settings;

  // out-of-range on its own keeps the current value (total, like every setting)
  C.ingest(raw("$m1", 1, "@o:hs", { t: "ddjp.room.settings", s: { minLen: 3 } }, RANK.OWNER));
  assert.strictEqual(C.getState().settings.minLen, D0.minLen, "minLen below the floor is ignored");
  C.ingest(raw("$m2", 2, "@o:hs", { t: "ddjp.room.settings", s: { minLen: 25 } }, RANK.OWNER));
  assert.strictEqual(C.getState().settings.minLen, D0.minLen, "minLen above the ceiling is ignored");

  // a valid PAIR moving together applies, even though minLen alone would exceed the
  // old maxLen ordering check if each were judged against the other's stale value
  C.ingest(raw("$m3", 3, "@o:hs", { t: "ddjp.room.settings", s: { minLen: 20, maxLen: 30 } }, RANK.OWNER));
  let s = C.getState().settings;
  assert.strictEqual(s.minLen, 20, "a valid simultaneous pair applies (minLen)");
  assert.strictEqual(s.maxLen, 30, "a valid simultaneous pair applies (maxLen)");

  // an INVERTED proposal changes nothing at all — not the floor, not the ceiling
  C.ingest(raw("$m4", 4, "@o:hs", { t: "ddjp.room.settings", s: { minLen: 18, maxLen: 12 } }, RANK.OWNER));
  s = C.getState().settings;
  assert.strictEqual(s.minLen, 20, "an inverted pair leaves minLen untouched");
  assert.strictEqual(s.maxLen, 30, "an inverted pair leaves maxLen untouched (no half-applied policy)");

  // receipts-per-message floor
  C.ingest(raw("$m5", 5, "@o:hs", { t: "ddjp.room.settings", s: { receiptsPerMessage: 6 } }, RANK.OWNER));
  assert.strictEqual(C.getState().settings.receiptsPerMessage, D0.receiptsPerMessage, "receipts below the floor is ignored");
})();

console.log("[settings-order] PASS — settings judged at log position: a song snapshots its start-settings; a mid-song change keeps-start (next song gets the new value); validation total + range-checked; below-owner ignored; snapshot convergent across 200 shuffled orders");
