// tests/check-repeat-rule.js
// SUBJECT: features/botruntime.js, backends/backend1/settingsproof.js, backends/backend1/streammanager.js, backends/backend1/matrixbridge.js, backends/backend1/history.js
// WALL: THE OWNER'S REPEAT RULE (`ddjp_536`, J73), every case, in BOTH room types. The bot judges each play at its start: a
//   copy added BEFORE the current `repeatCooldownMs` took effect plays; otherwise a play of the song inside the cooldown skips
//   it; when history cannot reach back far enough, it plays. Before/after is ROOM POSITION — the add's (through the bridge's
//   `historyAddedAtL`) against since-when the value has held (`StreamManager.settingSince`, from the backend's SettingsProof).
//   Driven with the real engine (the decentralized one, and the bot door), the real SettingsProof fed as the bridge feeds it,
//   the real History, the bridge's history functions from the shipped file, and the real Room, Queue and BotRuntime.
"use strict";
const fs = require("fs"), path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[repeat-rule] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const fnSrc = (sig) => { const i = MB.indexOf(sig); const j = MB.indexOf("\n  }\n", i); return (i >= 0 && j > i) ? MB.slice(i, j + 4) : ""; };
const BRIDGE = fnSrc("  function historyAddedAt(user, videoId, beforeTs) {") + fnSrc("  function historyAddedAtL(user, videoId, beforeL) {") +
  fnSrc("  function historyCoverage() {") + fnSrc("  function roomHistory(limit) {");
const ENGINE = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/history.js",
  "backends/backend1/checkpointformat.js", "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend1/settingsproof.js", "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"];
const MIN = 60000, T0 = 1.7e12, A = "AAAAAAAAAAA", B = "BBBBBBBBBBB";
// steps: ["set", cooldownMin] | ["join", dj, vid] | ["add", dj, vid] | ["play"] ; returns the bot's verdict on the last play.
// A DJ whose only song has played leaves the rotation, so a later re-add is a fresh JOIN; "queued twice" declares the
// second copy while the DJ is still in it.
function run(kind, steps, opts) {
  const o = opts || {}, clock = { now: 0 }, skips = [];
  let bridge = null;
  const sb = loadInContext(ENGINE.concat(["features/room.js", "features/queue.js", "features/botruntime.js"]), {
    Date, Math, JSON, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    window: {}, document: { body: { appendChild() {} }, addEventListener() {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    ServerClock: { serverNow: () => clock.now }, Skip: { skip: (k) => { skips.push(k); return Promise.resolve({ ok: true }); } },
    Chat: { sendTo: () => Promise.resolve({ ok: true }), send: () => Promise.resolve({ ok: true }) },
    MatrixBridge: { getUserId: () => "@bot:hs", getMyRank: () => 99, getMyPowerLevel: () => 99, getRoster: () => [], onRawEvent() {}, offRawEvent() {},
      joinedMembersOf: () => [], invitedMembersOf: () => [], mayAuthor: () => ({ ok: true }), onAuthorReady() {},
      historyAddedAt: (...a) => bridge.historyAddedAt(...a), historyAddedAtL: (...a) => bridge.historyAddedAtL(...a),
      historyCoverage: (...a) => bridge.historyCoverage(...a), roomHistory: (...a) => bridge.roomHistory(...a) } });
  const SM = kind === "bot" ? sb.B2StreamManager : sb.B1StreamManager;
  if (kind === "bot") SM.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
  sb.StreamManager = SM;
  bridge = new Function("History", "StreamManager", BRIDGE + "\nreturn { historyAddedAt, historyAddedAtL, historyCoverage, roomHistory };")(sb.History, SM);
  sb.History.reset(); sb.History.attach({ log: () => SM.getLog() }); sb.SettingsProof.reset(); sb.SettingsProof.markGenesisReached();
  try { sb.Room.rankLadder = () => [{ name: "owner", level: 99 }, { name: "guest", level: 10 }]; sb.Room.chatTiers = () => ({ mainId: "!main" }); } catch (e) {}
  const P = sb.Ranks.levelOf("player"), O = 100;
  let l = 0, tAcc = 0, prev = null, settings = Object.assign(sb.StateDeriver.defaultSettings(), { repeatCooldownMs: 0 });
  const put = (body, actor, rank) => {
    // A play lands 12 minutes after the previous event (past any song's gate); everything else a minute. The bot judges a
    // second after the play starts, inside its decision window.
    l++; tAcc += (body.t === "ddjp.dj.play" ? 12 : 1) * MIN; const ts = T0 + tAcc; clock.now = ts + 1000;
    if (kind === "bot") SM.ingest({ event_id: "$e" + l, type: "m.room.message", room_id: body.t === "ddjp.room.settings" ? "!set:hs" : "!log:hs", sender: "@bot:hs", ts: ts,
      content: { body: JSON.stringify(Object.assign({}, body, { l: l, actor: actor, rank: rank, src: "$i" + l, at: null })) } });
    else SM.ingest({ event_id: "$e" + l, type: "m.room.message", room_id: "!r:hs", sender: actor, ts: ts, senderRank: rank, content: { body: JSON.stringify(Object.assign({}, body, { l: l, dv: 2, hv: 1 })) } });
    if (body.t === "ddjp.room.settings") sb.SettingsProof.ingest([{ eventId: "$e" + l, type: "ddjp.room.settings", l: l, sender: actor, senderRank: O, content: { t: "ddjp.room.settings", s: body.s } }]);
    return "$e" + l;
  };
  for (const st of steps) {
    if (st[0] === "set") { settings = Object.assign({}, settings, { repeatCooldownMs: st[1] * MIN }); put({ t: "ddjp.room.settings", s: settings }, "@owner:hs", O); }
    else if (st[0] === "join") put({ t: "ddjp.dj.join", v: st[2] }, st[1], P);
    else if (st[0] === "add") put({ t: "ddjp.dj.declare", v: st[2] }, st[1], P);
    else if (st[0] === "play") prev = put({ t: "ddjp.dj.play", p: prev }, "@bot:hs", O);
  }
  sb.History.refresh();
  if (o.shortHistory) { const head = l; sb.History.reset(); sb.History.ingest(SM.getLog().slice(-2), undefined, { from: head - 1, to: head }); }
  const started = sb.BotRuntime.start({ roomId: "!r:hs", channels: { presence_chat: "!p" } });
  const np = SM.getState().nowPlaying;
  const r = sb.BotRuntime.sweepRepeat();
  try { sb.BotRuntime.stop(); } catch (e) {}
  return { r, skips, np, started };
}
const CASES = [
  ["added AFTER the setting — skipped", [["set", 60], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["play"], ["play"]], true],
  ["added BEFORE the setting took effect — plays", [["set", 0], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["set", 60], ["play"], ["play"]], false],
  ["queued twice — the second copy is skipped", [["set", 60], ["join", "@d1:hs", A], ["add", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["play"], ["play"]], true],
  ["history too short to tell — plays", [["set", 60], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["play"], ["play"]], false, { shortHistory: true }],
  ["turned OFF before the replay — plays", [["set", 60], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["set", 0], ["play"], ["play"]], false],
  ["turned ON after the add — plays (added before it took effect)", [["set", 0], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["set", 60], ["play"], ["play"]], false],
  ["made LONGER after the add — plays (added before it took effect)", [["set", 1], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["set", 30], ["play"], ["play"]], false],
  ["made LONGER before the add — skipped", [["set", 1], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["set", 30], ["join", "@d1:hs", A], ["play"], ["play"]], true],
  ["made SHORTER — plays (not inside the shorter cooldown)", [["set", 30], ["join", "@d1:hs", A], ["join", "@d2:hs", B], ["play"], ["join", "@d1:hs", A], ["set", 1], ["play"], ["play"]], false],
];
for (const kind of ["decentralized", "bot"]) {
  for (const [label, steps, wantSkip, opts] of CASES) {
    const x = run(kind, steps, opts);
    const premise = x.started && x.started.ok === true && x.np && x.np.song && x.np.song.videoId === A;
    ok(premise, kind + " PREMISE — " + label + ": the bot ran and the song judged is A", { started: x.started, np: x.np && x.np.song });
    ok(premise && (wantSkip ? x.skips.length === 1 : x.skips.length === 0), kind + ": " + label, { reason: x.r && x.r.reason, order: x.r && x.r.order, skips: x.skips });
  }
}
if (failed) { console.log("[repeat-rule] " + failed + " failure(s)"); process.exit(1); }
console.log("[repeat-rule] PASS — the owner's repeat rule in both room types: added after the setting is skipped, before it plays, queued twice is skipped, too little history plays, and live changes either way follow the add's position against the setting's (" + asserts + " assertions)");
