// tests/check-vote-latch.js
// SUBJECT: features/reactions.js, backends/backend1/matrixbridge.js, backends/backend2/streammanager.js
// WALL: IN A BOT ROOM A VOTE OR SAVE IS SENT ONCE, LIGHTS AND STAYS LIT, AND A SECOND PRESS SENDS NOTHING (owner's re-test,
//   `ddjp_535`). Driven through the real door, the real `reactions.js` and the bridge's real answer code (`_answersIn`,
//   `_settleAnswers`, `awaitAnswer`, `_normaliseAll`, from the shipped file), the bot relaying the press as a BATCH member
//   whose `src` is the intent. NOTE: this passes on `ddjp_535` too — the live re-send was not reproduced here; J78 records
//   that its cause is still unfound. This guard pins the path that does work.
"use strict";
const fs = require("fs"), path = require("path"), ROOT = path.join(__dirname, "..");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[vote-latch] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
const fn = (name) => { const i = MB.search(new RegExp("\\n  (async )?function " + name + "\\(")); const j = MB.indexOf("\n  }\n", i + 1); return MB.slice(i + 1, j + 4); };
const ANS = "const DEFAULT_ANSWER_DEADLINE_MS = 22000;\nconst _answers = new Map();\nfunction answerDeadlineMs() { return DEFAULT_ANSWER_DEADLINE_MS; }\n" + fn("_answersIn") + fn("_settleAnswers") + fn("awaitAnswer") + fn("_normaliseAll");
const FILES = ["core/logger.js","backends/backend1/ranks.js","backends/backend1/consensushash.js","backends/backend1/trustpolicy.js","backends/backend1/statederiver.js","backends/backend1/capabilities.js","backends/backend1/activity.js","backends/backend1/history.js","backends/backend1/checkpointformat.js","backends/backend1/session.js","backends/backend1/floor.js","backends/backend1/streammanager.js","backends/backend2/checkpoint.js","backends/backend2/streammanager.js"];
async function press(kind) {
  const sends = [];
  const MBstub = { getUserId: () => "@me:hs", sendEvent: (room, type, c) => { sends.push({ room, type, c }); return Promise.resolve({ eventId: "$int" + sends.length }); } };
  const sb = loadInContext(FILES.concat(["features/reactions.js"]), { MatrixBridge: MBstub });
  const D = sb.B2StreamManager; D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
  const ans = new Function("StreamManager", "setTimeout", "clearTimeout", "MatrixBridge", ANS + "\nreturn { awaitAnswer, _settleAnswers };")(D, setTimeout, clearTimeout, MBstub);
  MBstub.awaitAnswer = ans.awaitAnswer;
  let n = 0; const T0 = 1.7e12, P = sb.Ranks.levelOf("player"), O = sb.Ranks.levelOf("owner");
  const rel = (body, actor, rank, l) => ({ event_id: "$r" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * 1000, content: { body: JSON.stringify(Object.assign({}, body, { l, actor, rank, src: "$x" + n, at: null })) } });
  [rel({ t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }, "@o:hs", O, 1), rel({ t: "ddjp.dj.join", v: "vidAAAAAAAA" }, "@d:hs", P, 2), rel({ t: "ddjp.dj.play", p: null }, "@bot:hs", O, 3)].forEach((r) => D.ingest(r));
  sb.StreamManager = D;
  const R = sb.Reactions; R.init("!intents:hs");
  const go = kind === "vote" ? () => R.vote() : () => R.recordSave(D.getState().nowPlaying.pi);   // the save button records a save for the playing play
  const lit = kind === "vote" ? () => R.hasVoted() : () => R.hasSaved();
  const r1 = await go();
  ok(r1 && r1.ok === true && sends.length === 1 && lit(), kind + ": the press sends once and lights", { r1, sends: sends.length });
  const pi = D.getState().nowPlaying.pi, t = kind === "vote" ? "ddjp.dj.vote" : "ddjp.dj.save";
  const carrier = { event_id: "$c1", type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + 9000,
    content: { body: JSON.stringify({ t: "ddjp.batch", l: 4, evs: [{ t: t, p: pi, actor: "@me:hs", rank: P, src: "$int1", at: null }] }) } };
  await new Promise((r) => setTimeout(r, 20));
  D.ingest(carrier); ans._settleAnswers(carrier);
  await new Promise((r) => setTimeout(r, 20));
  ok(sends.length === 1 && lit(), kind + ": answered by a batched relay, it stays lit and nothing is resent", { sends: sends.length, lit: lit() });
  const r2 = await go();
  ok(r2 && r2.ok === false && sends.length === 1, kind + ": a second press sends nothing", { r2, sends: sends.length });
}
// C — after a reload from a save point that covers the vote, the button is lit from the room's ledger, and nothing is sent.
async function reload() {
  const T0 = 1.7e12; let n = 0;
  const mk = (sends) => { const MBs = { getUserId: () => "@me:hs", sendEvent: (r, t, c) => { sends.push(t); return Promise.resolve({ eventId: "$s" + sends.length }); }, awaitAnswer: () => new Promise(() => {}) };
    const sb = loadInContext(FILES.concat(["backends/backend2/checkpoint.js", "features/reactions.js"].filter((f, i, a) => a.indexOf(f) === i)), { MatrixBridge: MBs });
    sb.B2StreamManager.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.StreamManager = sb.B2StreamManager; return sb; };
  const s1 = [], A = mk(s1), P = A.Ranks.levelOf("player"), O = A.Ranks.levelOf("owner");
  const rel = (body, actor, rank, l) => ({ event_id: "$r" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * 1000, content: { body: JSON.stringify(Object.assign({}, body, { l, actor, rank, src: "$x" + n, at: null })) } });
  const evs = [rel({ t: "ddjp.room.settings", s: A.StateDeriver.defaultSettings() }, "@o:hs", O, 1), rel({ t: "ddjp.dj.join", v: "vidAAAAAAAA" }, "@d:hs", P, 2), rel({ t: "ddjp.dj.play", p: null }, "@bot:hs", O, 3)];
  evs.forEach((r) => A.B2StreamManager.ingest(r));
  const pi = A.B1StreamManager.getState().nowPlaying.pi;
  for (const [l, t] of [[4, "ddjp.dj.vote"], [5, "ddjp.dj.save"]]) A.B2StreamManager.ingest(rel({ t: t, p: pi }, "@me:hs", P, l));
  const log = A.B1StreamManager.getLog(), last = log[log.length - 1];
  const c = A.B2Checkpoint.seal(A.StateDeriver.buildSeed(log, undefined), { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId }).cp;
  const cp = { event_id: "$cp", type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + 6000, content: { body: JSON.stringify(Object.assign({}, c, { l: 6 })) } };
  const s2 = [], B = mk(s2);
  B.B2StreamManager.ingest(cp); B.B2StreamManager.openFromSavePoint();
  ok(B.B1StreamManager.getLog().length === 0 && B.B1StreamManager.getState().nowPlaying.pi === pi, "C PREMISE — the reloaded tab opened from a save point covering the vote and the save", B.B1StreamManager.getLog().length);
  B.Reactions.init("!intents:hs");
  ok(B.Reactions.hasVoted() === true && B.Reactions.hasSaved() === true, "C: after the reload the buttons are lit from the room's ledger — the vote and save below the floor are not forgotten");
  const r = await B.Reactions.vote(), r2 = await B.Reactions.recordSave(pi);
  ok(r.ok === false && r2.ok === false && s2.length === 0, "C: and pressing again sends nothing", { r, r2, sends: s2 });
}
// D — silence can mean "already counted": the bot drops a duplicate in silence, so a "none" answer while the room already
//     holds my vote keeps the latch and resends nothing (owner's live log, ddjp_537). Control: not held, it resends once.
async function silence(held) {
  const sends = [], T0 = 1.7e12; let n = 0;
  const MBs = { getUserId: () => "@me:hs", sendEvent: (r, t, c) => { sends.push(t); return Promise.resolve({ eventId: "$s" + sends.length }); },
    awaitAnswer: () => new Promise((res) => setTimeout(() => res({ status: "none", reason: "no-answer" }), 15)) };
  const sb = loadInContext(FILES.concat(["features/reactions.js"]), { MatrixBridge: MBs });
  const D = sb.B2StreamManager; D.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" }); sb.StreamManager = D;
  const P = sb.Ranks.levelOf("player"), O = sb.Ranks.levelOf("owner");
  const rel = (body, actor, rank, l) => ({ event_id: "$r" + (++n), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs", ts: T0 + l * 1000, content: { body: JSON.stringify(Object.assign({}, body, { l, actor, rank, src: "$x" + n, at: null })) } });
  [rel({ t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() }, "@o:hs", O, 1), rel({ t: "ddjp.dj.join", v: "vidAAAAAAAA" }, "@d:hs", P, 2), rel({ t: "ddjp.dj.play", p: null }, "@bot:hs", O, 3)].forEach((r) => D.ingest(r));
  const pi = D.getState().nowPlaying.pi;
  sb.Reactions.init("!intents:hs");
  await sb.Reactions.vote();
  if (held) D.ingest(rel({ t: "ddjp.dj.vote", p: pi, dv: 1 }, "@me:hs", P, 4));   // counted — its answer was dropped as a duplicate
  await new Promise((r) => setTimeout(r, 120));
  return { sends: sends.length, lit: sb.Reactions.hasVoted() };
}
(async () => { await press("vote"); await press("save"); await reload();
  const h = await silence(true), c = await silence(false);
  ok(h.sends === 1 && h.lit === true, "D: a 'none' answer while the room already holds my vote — nothing resent, and it stays lit", h);
  ok(c.sends === 2, "D CONTROL: a 'none' answer when the room does not hold it — resent once, as before", c);
})().then(() => {
  if (failed) { console.log("[vote-latch] " + failed + " failure(s)"); process.exit(1); }
  console.log("[vote-latch] PASS — in a bot room a vote and a save are each sent once, answered by a batched relay, stay lit, and a second press sends nothing (" + asserts + " assertions)");
  process.exit(0);
}, (e) => { console.log("[vote-latch] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
