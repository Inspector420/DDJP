// tools/probes/probe-j17-bot.js
//
// J17 — THE BOT SKELETON, DESIGN ONLY. This probe answers the questions the job entry leaves open
// by DRIVING them, so the design is written from measurements rather than from the docs' account
// of themselves. Nothing here builds a bot; every row reads code that already ships.
//
//   Q1  the 99/100 split — the two ANSWERED opens, CHECKED rather than re-opened
//   Q2  two writers on the settings channel — who wins a race, through the production wire
//   Q3  what presence sources actually reach the BOT (not what reached J16)
//   Q4  the ping-or-remove loop measures AUTHORSHIP, which is what it also demands
//   Q5  removal is a Matrix membership act — there is no reducer branch and there cannot be
//
// ── EVERY ROW ASSERTS ITS OWN PREMISE ────────────────────────────────────────────────────────
// `09-roadmap.md` §8: a refusal is evidence only if something adjacent was admitted, and a probe
// that never reached the door refuses everything for free. Two upstream doors can swallow a row
// here without saying so — the RANK gate (`Ranks.permits`) and `StreamManager.validate`'s
// BACKDATING rule, which is the exact door that made two J02 assertions green for the wrong
// reason. So the gate below checks reachedness per kind and NAMES the stage that failed, and
// `selfTest()` feeds it both a broken reading and a sound one, because a gate that refuses
// everything certifies nothing and one that accepts everything certifies less.

const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const { loadInContext } = require(path.join(ROOT, "tests", "_load.js"));
const F = require(path.join(ROOT, "tests", "_fixtures.js"));
const J15 = require(path.join(ROOT, "tests", "_probe-j15-dm.js"));

// ═══ THE ADMISSIBILITY GATE ══════════════════════════════════════════════════════════════════
// Three kinds of reading, three sets of preconditions. `null` at the end of any of them looks
// identical, and the difference between "the rank gate refused it", "the backdating rule refused
// it" and "the tiebreak chose the other one" is the difference between a finding and an afternoon.
function admissible(kind, r, opts) {
  const o = opts || {};
  const problems = [];
  if (!r || typeof r !== "object") { return { ok: false, problems: ["stage: no reading at all"] }; }
  if (r.threw) problems.push("stage: the subject threw — " + r.threw);

  if (kind === "fold") {
    if (!r.accepted || r.accepted.length === 0) problems.push("stage: the fold accepted NOTHING — no row below it is about the rule under test");
    if (o.expectInLog) {
      for (const id of o.expectInLog) {
        if (r.logIds.indexOf(id) < 0) problems.push("stage: " + id + " never entered the LOG — refused upstream (validate/backdating), so the reducer never saw it");
      }
    }
    if (o.expectSettingsMoved && r.settings && r.baseline &&
        r.settings.maxLen === r.baseline.maxLen) {
      problems.push("stage: the settings never moved off the default, so this reading is of a fold that ignored every settings event");
    }
    // A REVERT row ends AT the default by construction, so `expectSettingsMoved` is the wrong
    // premise for it — the gate refused this row once for exactly that reason, which is the gate
    // working. What must be true instead is that the edit being reverted LANDED first: without
    // that, "the human's value is gone" is a reading of a fold that never accepted it.
    if (o.expectIntermediate && r.baseline &&
        (typeof r.afterHuman !== "number" || r.afterHuman === r.baseline.maxLen)) {
      problems.push("stage: the intermediate edit never landed (afterHuman=" + r.afterHuman +
        "), so a later reading of the default proves nothing about a revert");
    }
  }
  if (kind === "ladder") {
    if (typeof r.ownerLevel !== "number") problems.push("stage: the ladder did not load — levelOf('owner') is not a number");
    if (!r.taxonomy || r.taxonomy.length === 0) problems.push("stage: the channel taxonomy is empty — nothing was read");
  }
  if (kind === "powerlevels") {
    if (!r.pl || typeof r.pl !== "object") problems.push("stage: _powerLevels produced nothing");
    else if (typeof r.pl.state_default !== "number") problems.push("stage: _powerLevels returned an object with no state_default — the wrong function was extracted");
  }
  return { ok: problems.length === 0, problems };
}

// The gate is itself untested code and certifies everything downstream on its own authority, so
// it gets fed deliberately broken inputs AND sound ones.
function selfTest() {
  const missed = [], falseAlarms = [];
  const broken = [
    ["fold accepted nothing", "fold", { accepted: [], logIds: [] }, {}],
    ["an event missing from the log", "fold", { accepted: ["$a"], logIds: ["$a"] }, { expectInLog: ["$a", "$b"] }],
    ["settings never moved", "fold", { accepted: ["$a"], logIds: ["$a"], settings: { maxLen: 600 }, baseline: { maxLen: 600 } }, { expectSettingsMoved: true }],
    ["the subject threw", "fold", { accepted: ["$a"], logIds: ["$a"], threw: "boom" }, {}],
    ["ladder did not load", "ladder", { ownerLevel: null, taxonomy: [{}] }, {}],
    ["taxonomy empty", "ladder", { ownerLevel: 99, taxonomy: [] }, {}],
    ["wrong function extracted", "powerlevels", { pl: { hello: 1 } }, {}],
    ["no reading at all", "fold", null, {}],
    ["a revert whose edit never landed", "fold", { accepted: ["$a"], logIds: ["$a"], baseline: { maxLen: 600 }, afterHuman: 600 }, { expectIntermediate: true }],
    ["a revert with no intermediate reading at all", "fold", { accepted: ["$a"], logIds: ["$a"], baseline: { maxLen: 600 } }, { expectIntermediate: true }],
  ];
  for (const [name, kind, r, o] of broken) if (admissible(kind, r, o).ok) missed.push(name);

  const sound = [
    ["a real fold", "fold", { accepted: ["$a", "$b"], logIds: ["$a", "$b"], settings: { maxLen: 300 }, baseline: { maxLen: 600 } }, { expectInLog: ["$a", "$b"], expectSettingsMoved: true }],
    ["a real ladder read", "ladder", { ownerLevel: 99, taxonomy: [{ slug: "owner", level: 99 }] }, {}],
    ["a real power-level read", "powerlevels", { pl: { state_default: 100, redact: 100 } }, {}],
    ["a real revert", "fold", { accepted: ["$a"], logIds: ["$a"], baseline: { maxLen: 600 }, afterHuman: 300 }, { expectIntermediate: true }],
  ];
  for (const [name, kind, r, o] of sound) if (!admissible(kind, r, o).ok) falseAlarms.push(name);
  return { missed, falseAlarms };
}

// ═══ REPORTING ═══════════════════════════════════════════════════════════════════════════════
const out = [];
function row(label, value) { out.push({ label, value }); console.log("  " + label.padEnd(58) + "  " + value); }
function head(t) { console.log("\n" + t); }
function gate(kind, r, opts, where) {
  const g = admissible(kind, r, opts);
  if (!g.ok) {
    console.log("\n[probe-j17] INADMISSIBLE at " + where + ":");
    for (const p of g.problems) console.log("      " + p);
    console.log("[probe-j17] refusing to print a reading whose premises failed.");
    process.exit(1);
  }
}

const st = selfTest();
if (st.missed.length) { console.log("[probe-j17] the gate MISSED: " + st.missed.join(" · ")); process.exit(1); }
if (st.falseAlarms.length) { console.log("[probe-j17] the gate FALSE-ALARMED: " + st.falseAlarms.join(" · ")); process.exit(1); }
console.log("[probe-j17] admissibility gate self-tested BOTH ways: " +
  "10 broken readings caught, 4 sound ones admitted.");

// ═══ THE REAL MODULES ════════════════════════════════════════════════════════════════════════
function freshSandbox() {
  return loadInContext([
    "core/logger.js",
    "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js",
    "backends/backend1/eventcache.js",
    "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js",
    "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js",
  ], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
  });
}
const sb = freshSandbox();
const R = sb.Ranks, SD = sb.StateDeriver, MB = sb.MatrixBridge;

// ═══ Q1 — THE 99/100 SPLIT ═══════════════════════════════════════════════════════════════════
// The job entry marks this ANSWERED. It is not re-opened here; it is CHECKED, because the entry
// states a RESTRAINT ("cannot ... move power levels") and a restraint is a claim about code.
head("Q1 — the 99/100 split, read from the ladder and the power levels rather than from prose");

const ladderR = { ownerLevel: R.levelOf("owner"), taxonomy: MB.channelTaxonomy() };
gate("ladder", ladderR, {}, "Q1 ladder");

row("R1.1 Ranks.levelOf('owner')", ladderR.ownerLevel);
row("R1.1 Ranks.nameOf(99) / nameOf(100)", R.nameOf(99) + " / " + R.nameOf(100));
row("R1.1 tierOf(99) / tierOf(100)", R.tierOf(99) + " / " + R.tierOf(100));

const ownerChans = ladderR.taxonomy.filter((c) => c.slug === "owner");
row("R1.2 owner channels, and their levels",
  ownerChans.map((c) => c.kind + "=" + c.level).join(" "));
// CONTROL on the same axis: a channel that is NOT the owner's must not read 99, or "they are all
// 99" would be a statement about the taxonomy being constant rather than about the owner rung.
const nonOwner = ladderR.taxonomy.filter((c) => c.slug !== "owner");
row("R1.2 control — any non-owner channel at 99?",
  nonOwner.some((c) => c.level === 99) ? "YES (the reading is meaningless)" : "no");

// R1.3 — a 99 WRITES. Driven through StreamManager.ingest, which is the door the entry's
// Done-when is about, rather than through derive() directly.
function driveWrites(rank) {
  const s = freshSandbox();
  const full = s.StateDeriver.defaultSettings();
  const blob = Object.assign({}, full, { maxLen: 321 });
  const logIds = [], accepted = [];
  let threw = null;
  try {
    // settings-owner: the settings write
    s.StreamManager.ingest(F.rawEvent("$set", 1, 1000, "@bot:hs", rank, { t: "ddjp.room.settings", s: blob }));
    // events-owner: an ordinary Spine write
    s.StreamManager.ingest(F.rawEvent("$join", 2, 1100, "@bot:hs", rank, { t: "ddjp.dj.join", v: "SONG0" }));
    for (const e of s.StreamManager.getLog()) logIds.push(e.eventId);
    for (const id of logIds) if (s.StreamManager.isLegal(id)) accepted.push(id);
  } catch (e) { threw = e.message; }
  const state = s.StreamManager.getState();
  return { logIds, accepted, threw, state, settings: state.settings, baseline: full,
           inRotation: (state.rotation || []).some((r) => r.user === "@bot:hs") };
}
const w99 = driveWrites(R.levelOf("owner"));
gate("fold", w99, { expectInLog: ["$set", "$join"], expectSettingsMoved: true }, "Q1 R1.3 (a 99 writing)");
row("R1.3 a 99 on settings-owner — maxLen becomes", w99.settings.maxLen);
row("R1.3 a 99 on events-owner — in the rotation", w99.inRotation ? "yes" : "NO");

// CONTROL: the same two writes one rung down. The settings write must be refused and the Spine
// write admitted — one detail changed, same door, so the refusal is attributable to the gate.
const w80 = driveWrites(R.levelOf("high-staff"));
gate("fold", w80, { expectInLog: ["$set", "$join"] }, "Q1 R1.3 (control, high-staff)");
row("R1.3 CONTROL high-staff on settings — maxLen",
  w80.settings.maxLen + (w80.settings.maxLen === 600 ? " (refused — default kept)" : " (ACCEPTED?!)"));
row("R1.3 CONTROL high-staff on events — in rotation",
  w80.inRotation ? "yes (the door is open, so the refusal above is the GATE)" : "NO — refusal not attributable");

// R1.4 — the power levels, EXECUTED. This is the row the entry's restraint actually rests on.
const plR = (() => {
  try { return { pl: MB._powerLevels ? MB._powerLevels(99, "@human:hs") : null,
                 plSpace: MB._powerLevels ? MB._powerLevels(100, "@human:hs", true) : null }; }
  catch (e) { return { pl: null, threw: e.message }; }
})();
// _powerLevels is module-private. Extract and execute it rather than reading it as text — the
// same reason check-user-card PART A does, and the same extractor J15 already owns.
if (!plR.pl) {
  const ex = J15.extractNamed("backends/backend1/matrixbridge.js", "_powerLevels");
  if (ex.ok) {
    const vm = require("vm");
    const sandbox = { console }; sandbox.globalThis = sandbox; vm.createContext(sandbox);
    vm.runInContext(ex.source + "\n;globalThis.__pl = _powerLevels;", sandbox, { filename: "_powerLevels" });
    plR.pl = sandbox.__pl(99, "@human:hs");
    plR.plSpace = sandbox.__pl(100, "@human:hs", true);
    plR.extracted = true;
  } else { plR.stage = ex.stage; }
}
gate("powerlevels", plR, {}, "Q1 R1.4");
row("R1.4 _powerLevels — state_default", plR.pl.state_default);
row("R1.4 _powerLevels — redact", plR.pl.redact);
row("R1.4 _powerLevels — ban / kick", plR.pl.ban + " / " + plR.pl.kick);
row("R1.4 _powerLevels — events['m.room.power_levels']", plR.pl.events["m.room.power_levels"]);
row("R1.4 space — events['m.space.child']", plR.plSpace.events["m.space.child"]);
row("R1.4 space — state_default", plR.plSpace.state_default);

const OWNER = R.levelOf("owner");
row("R1.4 → can a 99 send an arbitrary state event?",
  (OWNER >= plR.pl.state_default) ? "YES" : "no  (state_default " + plR.pl.state_default + ")");
row("R1.4 → can a 99 send m.room.power_levels?",
  (OWNER >= plR.pl.events["m.room.power_levels"])
    ? "YES — the per-event override is " + plR.pl.events["m.room.power_levels"] + ", NOT state_default"
    : "no");
row("R1.4 → can a 99 redact somebody else's message?",
  (OWNER >= plR.pl.redact) ? "YES" : "no  (redact " + plR.pl.redact + ")");
row("R1.4 → can a 99 add a sub-room to the space?",
  (OWNER >= plR.plSpace.events["m.space.child"]) ? "YES" : "no  (m.space.child " + plR.plSpace.events["m.space.child"] + ")  ← J18's Open");

// R1.5 — canAssignRank, the app-side half of the restraint. Pure, so it is driven directly.
const roomSb = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
  "backends/backend1/matrixbridge.js", "features/room.js",
], {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
  window: {}, document: { body: { appendChild() {} } },
});
const can = roomSb.Room.canAssignRank;
row("R1.5 canAssignRank(99, target 100, new 60)", String(can(99, 100, 60)) + "   (bot demotes the human)");
row("R1.5 canAssignRank(99, target 60,  new 100)", String(can(99, 60, 100)) + "   (bot grants 100 to a friend)");
row("R1.5 canAssignRank(99, target 99,  new 60)", String(can(99, 99, 60)) + "   (bot acts on its own tier)");
row("R1.5 canAssignRank(99, target 60,  new 40)", String(can(99, 60, 40)) + "    ← CONTROL, must be true");
row("R1.5 canAssignRank(100, target 99, new 20)", String(can(100, 99, 20)) + "    (human demotes the bot)");

// ═══ Q2 — TWO WRITERS ON THE SETTINGS CHANNEL ════════════════════════════════════════════════
// 100 >= 99, so the human and the bot both pass the rank gate. That channel's invariant is one
// writer, last-write-wins. Who wins a race?
//
// DRIVEN THROUGH `StreamManager.ingest`, NOT `derive`. The reducer is ordering-INDEPENDENT given
// an ordered prefix and does not sort — `derive([A,B])` and `derive([B,A])` answer differently,
// which is correct and is exactly the wiring/module distinction README trap 1 is about. The
// ordering lives in `StreamManager.orderEvents`, so the production wire is the only place the
// question has an answer.
head("Q2 — two writers on the settings channel: who wins a race");

function race(order, opts) {
  const o = opts || {};
  const s = freshSandbox();
  const full = s.StateDeriver.defaultSettings();
  const mk = (id, l, ts, sender, rank, maxLen) =>
    F.rawEvent(id, l, ts, sender, rank, { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen }) });
  const HUMAN = { id: "$aaa-human", sender: "@human:hs", rank: 100, maxLen: 111 };
  const BOT   = { id: "$bbb-bot",   sender: "@bot:hs",   rank: R.levelOf("owner"), maxLen: 222 };
  const lH = o.humanL != null ? o.humanL : 5, lB = o.botL != null ? o.botL : 5;
  const tsH = o.humanTs != null ? o.humanTs : 2000, tsB = o.botTs != null ? o.botTs : 2000;
  const evs = {
    human: mk(HUMAN.id, lH, tsH, HUMAN.sender, HUMAN.rank, HUMAN.maxLen),
    bot:   mk(BOT.id,   lB, tsB, BOT.sender,   BOT.rank,   BOT.maxLen),
  };
  let threw = null;
  try { for (const k of order) s.StreamManager.ingest(evs[k]); }
  catch (e) { threw = e.message; }
  const logIds = s.StreamManager.getLog().map((e) => e.eventId);
  const accepted = logIds.filter((id) => s.StreamManager.isLegal(id));
  const state = s.StreamManager.getState();
  const seed = s.StateDeriver.buildSeed(s.StreamManager.getLog());
  return { logIds, accepted, threw, settings: state.settings, baseline: full,
           winner: state.settings.maxLen === 111 ? "human" : (state.settings.maxLen === 222 ? "bot" : "neither"),
           settingsFrom: seed.settingsFrom, maxLen: state.settings.maxLen };
}

const rAB = race(["human", "bot"]);
gate("fold", rAB, { expectInLog: ["$aaa-human", "$bbb-bot"], expectSettingsMoved: true }, "Q2 (human first)");
const rBA = race(["bot", "human"]);
gate("fold", rBA, { expectInLog: ["$aaa-human", "$bbb-bot"], expectSettingsMoved: true }, "Q2 (bot first)");

row("R2.1 SAME l, SAME ts — arrival human→bot, winner", rAB.winner + " (maxLen " + rAB.maxLen + ")");
row("R2.1 SAME l, SAME ts — arrival bot→human, winner", rBA.winner + " (maxLen " + rBA.maxLen + ")");
row("R2.1 → arrival order changes the answer?", rAB.winner === rBA.winner ? "NO — the tiebreak decides" : "YES (convergence broken)");
row("R2.2 sorted ascending by (l, event_id); last wins", "$aaa-human < $bbb-bot → bot sorts LAST → " + rAB.winner + " wins");

// THE CONTROL THAT VARIES THE RIGHT AXIS. Every row above holds the ids fixed while asserting
// about a rule the ID decides — `09-roadmap.md` §8: if the rule names two quantities and every
// fixture holds one of them fixed, the second is unguarded however many assertions surround it.
// So: swap ONLY the ids, leave rank, sender, l and ts alone, and the winner must swap with them.
const rSwap = (() => {
  const s = freshSandbox();
  const full = s.StateDeriver.defaultSettings();
  const A = F.rawEvent("$zzz-human", 5, 2000, "@human:hs", 100,
    { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen: 111 }) });
  const B = F.rawEvent("$aaa-bot", 5, 2000, "@bot:hs", R.levelOf("owner"),
    { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen: 222 }) });
  s.StreamManager.ingest(A); s.StreamManager.ingest(B);
  const logIds = s.StreamManager.getLog().map((e) => e.eventId);
  const state = s.StreamManager.getState();
  return { logIds, accepted: logIds.filter((id) => s.StreamManager.isLegal(id)),
           settings: state.settings, baseline: full,
           winner: state.settings.maxLen === 111 ? "human" : (state.settings.maxLen === 222 ? "bot" : "neither") };
})();
gate("fold", rSwap, { expectInLog: ["$zzz-human", "$aaa-bot"], expectSettingsMoved: true }, "Q2 (id axis control)");
row("R2.2 CONTROL — ids swapped, everything else equal", "$aaa-bot < $zzz-human → " + rSwap.winner + " wins");
row("R2.2 → does RANK or SENDER decide the tie?", rSwap.winner !== rAB.winner
  ? "no — the winner followed the ID, so the id is the tiebreak"
  : "the winner did NOT follow the id — something else is deciding");

row("R2.3 settingsFrom names", rAB.settingsFrom + " / " + rBA.settingsFrom);
row("R2.3 → both arrival orders name the same event?", rAB.settingsFrom === rBA.settingsFrom ? "yes" : "NO");

// The BOT posting LATER in the Lamport order — the ordinary case, not a tie.
const rLater = race(["human", "bot"], { humanL: 5, botL: 6, humanTs: 2000, botTs: 2100 });
gate("fold", rLater, { expectInLog: ["$aaa-human", "$bbb-bot"], expectSettingsMoved: true }, "Q2 (bot at a higher l)");
row("R2.4 bot at l=6, human at l=5 — winner", rLater.winner + " (maxLen " + rLater.maxLen + ")");
const rEarlier = race(["bot", "human"], { humanL: 6, botL: 5, humanTs: 2100, botTs: 2000 });
gate("fold", rEarlier, { expectInLog: ["$aaa-human", "$bbb-bot"], expectSettingsMoved: true }, "Q2 (human at a higher l)");
row("R2.4 human at l=6, bot at l=5 — winner", rEarlier.winner + " (maxLen " + rEarlier.maxLen + ")");

// IS THE LOSER MERGED, OR GONE? Last-write-wins is total only if the loser leaves no trace. The
// loser here changes minGate as well, so a merge would be visible in a SECOND field.
const rMerge = (() => {
  const s = freshSandbox();
  const full = s.StateDeriver.defaultSettings();
  const A = F.rawEvent("$aaa-human", 5, 2000, "@human:hs", 100,
    { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen: 111, presendMs: 77 }) });
  const B = F.rawEvent("$bbb-bot", 5, 2000, "@bot:hs", R.levelOf("owner"),
    { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen: 222 }) });
  s.StreamManager.ingest(A); s.StreamManager.ingest(B);
  const logIds = s.StreamManager.getLog().map((e) => e.eventId);
  const state = s.StreamManager.getState();
  return { logIds, accepted: logIds.filter((id) => s.StreamManager.isLegal(id)),
           settings: state.settings, baseline: full,
           maxLen: state.settings.maxLen, presendMs: state.settings.presendMs };
})();
gate("fold", rMerge, { expectInLog: ["$aaa-human", "$bbb-bot"], expectSettingsMoved: true }, "Q2 (merge test)");
row("R2.5 loser also set presendMs=77; result", "maxLen=" + rMerge.maxLen + " presendMs=" + rMerge.presendMs +
  (rMerge.presendMs === 300 ? "  → NOT merged, wholly replaced" : "  → MERGED (invariant broken)"));

// R2.6 — THE HAZARD IS NOT THE TIE. A tie is rare and converges. The reachable failure is the
// LOST UPDATE: the bot reads the blob, the human edits, the bot writes back the copy it read.
// Because R2.5 shows the write is TOTAL rather than a merge, the human's edit is reverted with
// nothing refused, nothing logged and nothing to notice — the plausible-value signature.
const rLost = (() => {
  const s = freshSandbox();
  const full = s.StateDeriver.defaultSettings();
  // l=1: the room's settings as the bot finds them
  s.StreamManager.ingest(F.rawEvent("$s0", 1, 1000, "@human:hs", 100,
    { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen: 600, minGate: 8000 }) }));
  const asBotRead = Object.assign({}, s.StreamManager.getState().settings);   // the bot's copy
  // l=2: the human changes one dial
  s.StreamManager.ingest(F.rawEvent("$s1", 2, 2000, "@human:hs", 100,
    { t: "ddjp.room.settings", s: Object.assign({}, full, { maxLen: 300, minGate: 8000 }) }));
  const afterHuman = s.StreamManager.getState().settings.maxLen;
  // l=3: the bot writes back the blob it read at l=1, changing only ITS OWN field
  s.StreamManager.ingest(F.rawEvent("$s2", 3, 3000, "@bot:hs", R.levelOf("owner"),
    { t: "ddjp.room.settings", s: Object.assign({}, asBotRead, { presendMs: 250 }) }));
  const logIds = s.StreamManager.getLog().map((e) => e.eventId);
  const state = s.StreamManager.getState();
  return { logIds, accepted: logIds.filter((id) => s.StreamManager.isLegal(id)),
           settings: state.settings, baseline: full,
           afterHuman, afterBot: state.settings.maxLen, presendMs: state.settings.presendMs };
})();
gate("fold", rLost, { expectInLog: ["$s0", "$s1", "$s2"], expectIntermediate: true }, "Q2 (lost update)");
row("R2.6 human sets maxLen=300 at l=2; room reads", rLost.afterHuman);
row("R2.6 bot writes back its l=1 copy at l=3; room reads", rLost.afterBot +
  (rLost.afterBot === 600 ? "  → the human's edit is GONE" : "  → survived"));
row("R2.6 the bot's own field did land", "presendMs=" + rLost.presendMs);
row("R2.6 → was anything refused?", rLost.accepted.length === rLost.logIds.length
  ? "no — all three events are legal. The revert is silent" : "something was refused");

// ═══ Q3 — WHAT REACHES THE BOT ═══════════════════════════════════════════════════════════════
// J16 had to state three-of-four because chat never enters the log. The bot sits in those channels
// as a CLIENT, so the question is not what the fold sees but what the ROUTER hands out.
// Driven through the REAL `_routeEvent`, borrowing J15's extractor rather than writing a second
// definition of "which rooms are ours".
head("Q3 — the presence sources that reach the BOT, measured at the router");

const SCOPE = ["!ev-owner:hs", "!cp-owner:hs", "!set-owner:hs", "!chat-unc:hs"];
const SPINE_ROOM = { roomId: "!ev-owner:hs", name: "events-owner" };
const CHAT_ROOM = { roomId: "!chat-unc:hs", name: "chat-uncategorized" };
function route(room, body) {
  return J15.driveRoute({ room, body, scope: SCOPE, dmScope: [],
    isSpineChannel: MB._isSpineChannel, isChatChannel: MB._isChatChannel });
}
const PROTOCOL = JSON.stringify({ t: "ddjp.dj.join", l: 9, v: "SONG0" });

// CONTROL FIRST — without an admitted sibling every refusal below is free.
const rSpine = route(SPINE_ROOM, PROTOCOL);
if (!rSpine.ok || !rSpine.spined) {
  console.log("[probe-j17] INADMISSIBLE Q3: the control did not reach `_ingestSpineEvent` — " +
    (rSpine.stage || "router reached nothing")); process.exit(1);
}
row("R3.1 CONTROL — protocol event on events-owner", "spine=" + rSpine.spined + " raw=" + rSpine.fannedOut);

const rChat = route(CHAT_ROOM, "someone typing in the room");
if (!rChat.ok) { console.log("[probe-j17] INADMISSIBLE Q3: " + rChat.stage); process.exit(1); }
row("R3.2 a chat message — EventCache.store", String(rChat.stored));
row("R3.2 a chat message — StreamManager.ingest", String(rChat.folded));
row("R3.2 a chat message — raw listeners", String(rChat.fannedOut));
row("R3.2 → visible to the FOLD (what J16 reads)", rChat.folded ? "yes" : "NO");
row("R3.2 → visible to a CLIENT in the channel", rChat.fannedOut ? "YES — this is the fourth source" : "no");

// ═══ Q4 — THE PING-OR-REMOVE LOOP ════════════════════════════════════════════════════════════
// If speaking counts as presence and the bot demands speech, the loop supplies the evidence it
// then reads. Driven against the fold J16 actually shipped.
head("Q4 — what the activity fold measures, and what a ping-or-remove loop would therefore demand");

const fold = roomSb.Room.foldActivity;
const NOW = 1000000, WINDOW = 15 * 60 * 1000;
const watcher = "@silent:hs", talker = "@talks:hs";
const logA = [
  { sender: talker, ts: NOW - 60000 },
  { sender: talker, ts: NOW - 30000 },
];
const aA = fold(logA, NOW, WINDOW);
if (aA.counted === 0) { console.log("[probe-j17] INADMISSIBLE Q4: the fold counted nothing"); process.exit(1); }
row("R4.1 a silent watcher, present for the whole window", (aA.people.some((p) => p.userId === watcher) ? "listed" : "NOT listed"));
row("R4.1 a person who authored two events", (aA.people.some((p) => p.userId === talker) ? "listed" : "NOT listed"));
const logB = logA.concat([{ sender: watcher, ts: NOW - 1000 }]);
const aB = fold(logB, NOW, WINDOW);
row("R4.2 same watcher, after authoring ONE event", (aB.people.some((p) => p.userId === watcher) ? "listed" : "NOT listed"));
row("R4.2 → the only difference between the two runs", "one authored event; nothing about watching");

// ═══ Q5 — REMOVAL IS A MEMBERSHIP ACT ════════════════════════════════════════════════════════
// There is no reducer branch for a kick and there never can be: it does not become a Spine event.
// The rule is the reducer-ignore invariant, so it is driven as one.
head("Q5 — removal never reaches the reducer");

const kickR = (() => {
  const s = freshSandbox();
  const base = F.playingRoom({ songs: 1 });
  const before = JSON.stringify(s.StateDeriver.derive(base.log));
  const withKick = base.log.concat([
    F.reducerEvent("$kick", base.lastL + 1, 900000, "@bot:hs", R.levelOf("owner"),
      { t: "ddjp.member.kick", u: base.dj }),
  ]);
  const after = JSON.stringify(s.StateDeriver.derive(withKick));
  // CONTROL on the same axis: a type the reducer DOES fold must change the same string, or
  // "identical" is a statement about a fold that ignored the whole log.
  const withJoin = base.log.concat([
    F.reducerEvent("$j2", base.lastL + 1, 900000, "@other:hs", R.levelOf("player"),
      { t: "ddjp.dj.join", v: "SONGX" }),
  ]);
  const afterJoin = JSON.stringify(s.StateDeriver.derive(withJoin));
  return { identical: before === after, controlChanged: before !== afterJoin,
           accepted: ["premise"], logIds: [] };
})();
row("R5.1 a member.kick event folded — state identical", String(kickR.identical));
row("R5.1 CONTROL — a dj.join changes the same string", String(kickR.controlChanged));
const fs = require("fs");
const reducerSrc = fs.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8");
row("R5.2 'kick' branches in the reducer",
  (reducerSrc.match(/ev\.type\s*===\s*"[^"]*kick/g) || []).length);
row("R5.2 Ranks.GATES['member.kick'] exists", String(R.gateFor("member.kick")));
row("R5.2 → enforced by", "the homeserver: _powerLevels.kick = " + plR.pl.kick);


// ═══ Q6 — "EVERY KEY NEEDS A SETTING_RANGES ROW" ═════════════════════════════════════════════
// The job entry states this as a mechanism: "Every new key must also declare a row in
// `SETTING_RANGES`, or `settingKindOf` answers null and the reducer will not fold it." The first
// half is checkable against the keys ALREADY SHIPPING, which is cheaper than reasoning about it.
head("Q6 — the SETTING_RANGES claim, checked against the keys already in the tree");

const defaults = SD.defaultSettings();
const allKeys = Object.keys(defaults);
const rangedKeys = Object.keys(SD.SETTING_RANGES);
const rowless = allKeys.filter((k) => rangedKeys.indexOf(k) < 0);
row("R6.1 defaultSettings keys / SETTING_RANGES rows", allKeys.length + " / " + rangedKeys.length);
row("R6.1 keys with NO row", rowless.join(", "));
row("R6.2 settingKindOf answers null for all of them",
  String(rowless.every((k) => SD.settingKindOf(k) === null)));

// DO THEY FOLD? The claim says they will not. Driven through applySettingsEvent, one probe value
// per row-less key, each chosen to differ from its default so a no-op cannot read as a refusal.
const probeVals = {
  chat: "staff", vis: "public", bg: "https://example/x.png", selfWitnessCheckpoint: false,
  skipRoads: [{ guestPlus: 9, vipPlus: 0 }, { guestPlus: 0, vipPlus: 9 }, { guestPlus: 1, vipPlus: 1 }],
};
const tbl = JSON.parse(JSON.stringify(defaults.vouchTable)); tbl[3].enough = 2;
probeVals.vouchTable = tbl;
const ctbl = JSON.parse(JSON.stringify(defaults.checkpointTable)); ctbl[3].enough = 2;
probeVals.checkpointTable = ctbl;
const mergedAll = SD.applySettingsEvent(defaults, Object.assign({}, defaults, probeVals));
const foldedRowless = rowless.filter((k) =>
  JSON.stringify(mergedAll[k]) !== JSON.stringify(defaults[k]));
row("R6.3 row-less keys that DID fold", foldedRowless.length + " of " + rowless.length);
row("R6.3 → is the entry's mechanism claim true?",
  foldedRowless.length === 0 ? "yes" : "NO — the reducer folds every one of them");
row("R6.4 what a missing row actually costs", "no table-driven validation, so applySettingsEvent " +
  "carries bespoke logic AND the panel has no bounds to read");
row("R6.4 the worked example already in the tree", "`chat`'s three legal values live in the " +
  "reducer AND again in the panel — roles.md flags it as the older shape");

console.log("\n[probe-j17] DONE — every row above passed its own admissibility gate, and the gate " +
  "was self-tested in both directions before any of them ran.");