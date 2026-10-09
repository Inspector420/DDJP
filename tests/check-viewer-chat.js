// tests/check-viewer-chat.js
// SUBJECT: features/room.js, ui/panels.js
// WALL: THE PEOPLE TAB WORKS FROM EACH VIEWER'S OWN VIEW (J75, owner ruling 1). The bot's published list is gone. This
//   app tracks chat itself — who spoke and when, never what — per tier, in the tiers its rank unlocks; reads them back
//   on opening only as far as the window needs; reads a tier GAINED back and says it cannot fully tell for it until done;
//   drops a tier LOST; re-judges whether chat counts from what is kept; reads further for a wider window and keeps what
//   it has for a narrower one; starts fresh on a room switch; keeps only the last time per person, nothing older than the
//   longest allowed window. The bot is unchanged. The label reads "counts chat you can see".
//   PART A — opening: "can't fully tell" until each tier is read back, then chat-only people, and the honest label.
//   PART B — who and when, never what.      PART C — a tier gained.      PART D — a tier lost.
//   PART E — chat counted or not, re-judged with no download.       PART F — a wider window, a narrower one.
//   PART G — a room switch starts fresh.   PART H — self-cleaning.     PART I — the bot's fold is unchanged.
//   PART J — nothing publishes or grants `ddjp.presence` any more (the J73 list and its power-level entry are gone).
"use strict";
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require(path.join(__dirname, "_fixtures.js"));
const ROOT = path.join(__dirname, "..");
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[viewer-chat] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[viewer-chat] FAIL — the guard did not finish: a promise never settled, so its rows are not a reading"); process.exitCode = 1; } });
const MIN = 60000, HOUR = 60 * MIN, T = 1000 * HOUR;
const tick = () => new Promise((r) => setImmediate(r));
const B1F = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js", "backends/backend1/capabilities.js", "backends/backend1/activity.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js", "features/room.js"];
const pn = fs.readFileSync(path.join(ROOT, "ui/panels.js"), "utf8");
const fnOf = (sig) => { const i = pn.indexOf(sig); const j = pn.indexOf("\n  }\n", i); return pn.slice(i, j + 4); };
const label = new Function("H", fnOf("  function _spanText(ms) {") + fnOf("  function _activityLabel(fold) {") + "\nreturn _activityLabel;")({ activityGroupsText: () => "" });
let L = 1;
function world() {
  const w = { reads: [], pending: Object.create(null), raw: null, tiers: [{ tier: "main", id: "!t1" }, { tier: "staff", id: "!t2" }], cur: { spaceId: "!s1", channels: { a: "!t1", b: "!t2" } } };
  const sb = loadInContext(B1F, { ServerClock: { serverNow: () => T },
    MatrixBridge: { onRawEvent: (fn) => { w.raw = fn; }, getMyRank: () => 50, getMyPowerLevel: () => 50,
      readBackActivity: (id, since) => new Promise((res) => { w.reads.push({ id, since }); w.pending[id] = res; }) } });
  sb.Floor.reset(); sb.StreamManager.reset();
  sb.Room.chatTiers = () => ({ tiers: w.tiers });
  sb.Room.getCurrent = () => w.cur;
  w.sb = sb;
  w.settings = (over) => sb.StreamManager.ingest(F.toRaw(F.reducerEvent("$s" + (++L), L, T - 3 * HOUR + L, "@owner:hs", F.RANK.owner,
    { t: "ddjp.room.settings", s: Object.assign(sb.StateDeriver.defaultSettings(), { botPresenceChat: true, botAfkMs: 30 * MIN }, over || {}) })));
  w.view = () => sb.Room.presenceView(T);
  w.answer = async (id, people, reachedTs) => { const r = w.pending[id]; delete w.pending[id]; if (r) r({ ok: true, people: people, reachedTs: reachedTs, complete: false }); await tick(); await tick(); };
  w.ids = (v) => v.people.map((p) => p.userId).sort();
  return w;
}
(async () => {
  // ── A — opening ──
  const w = world(); w.settings();
  let v = w.view();
  ok(v.chatSeen === true && JSON.stringify(v.unknownTiers) === JSON.stringify(["main", "staff"]), "A: on opening, the tab cannot fully tell for either tier until each is read back", v.unknownTiers);
  ok(/can't fully tell yet for main, staff/.test(label(v).unobservable), "A: and says so", label(v));
  ok(w.reads.length === 2 && w.reads.every((r) => r.since === T - 30 * MIN), "A: each visible tier is read back only as far as the window needs", w.reads);
  await w.answer("!t1", { "@c1:hs": T - 5 * MIN }, T - 30 * MIN - 1);
  await w.answer("!t2", { "@c2:hs": T - 10 * MIN }, T - 30 * MIN - 1);
  v = w.view();
  ok(JSON.stringify(w.ids(v)) === JSON.stringify(["@c1:hs", "@c2:hs"]) && v.unknownTiers.length === 0, "A: once read, the chat-only people of both tiers are shown", w.ids(v));
  ok(label(v).unobservable === "counts chat you can see", "A: and the label reads \"counts chat you can see\"", label(v));
  // ── B — who and when, never what ──
  w.raw({ type: "m.room.message", room_id: "!t1", sender: "@c3:hs", ts: T - MIN, content: { body: "a secret message" } });
  const rec = w.sb.Room._viewerChatForTest();
  ok(rec.tiers["!t1"].people["@c3:hs"] === T - MIN && !JSON.stringify(rec).includes("secret"), "B: a live message records who and when, per tier — never what", rec.tiers["!t1"]);
  // ── C — a tier gained ──
  w.tiers = w.tiers.concat([{ tier: "high", id: "!t3" }]);
  v = w.view();
  ok(v.unknownTiers.indexOf("high") >= 0 && w.reads.some((r) => r.id === "!t3"), "C: a tier gained is read back for the window, and until then the tab cannot fully tell for it", v.unknownTiers);
  await w.answer("!t3", { "@c4:hs": T - 2 * MIN }, T - 30 * MIN - 1);
  v = w.view();
  ok(v.unknownTiers.length === 0 && w.ids(v).indexOf("@c4:hs") >= 0, "C: once read, its people count", w.ids(v));
  // ── D — a tier lost ──
  w.tiers = w.tiers.filter((x) => x.id !== "!t2");
  v = w.view();
  ok(w.ids(v).indexOf("@c2:hs") < 0 && !w.sb.Room._viewerChatForTest().tiers["!t2"], "D: a tier lost is dropped — its people no longer count, its records are gone", w.ids(v));
  // ── E — chat counted or not, from what is kept ──
  const before = w.reads.length;
  w.settings({ botPresenceChat: false });
  v = w.view();
  ok(v.chatSeen === false && w.ids(v).indexOf("@c1:hs") < 0, "E: with chat not counted, chat-only people are out", w.ids(v));
  w.settings({ botPresenceChat: true });
  v = w.view();
  ok(w.ids(v).indexOf("@c1:hs") >= 0 && w.reads.length === before, "E: counted again, they are back from what was kept — with no download", { reads: w.reads.length - before });
  // ── F — a wider window, a narrower one ──
  w.settings({ botAfkMs: 2 * HOUR });
  v = w.view();
  const wider = w.reads.slice(before);
  ok(wider.length === 2 && wider.every((r) => r.since === T - 2 * HOUR) && v.unknownTiers.length === 2, "F: a wider window reads every tier further back, unsure until done", wider);
  await w.answer("!t1", { "@old:hs": T - 90 * MIN }, T - 2 * HOUR - 1);
  await w.answer("!t3", {}, T - 2 * HOUR - 1);
  v = w.view();
  ok(w.ids(v).indexOf("@old:hs") >= 0 && v.unknownTiers.length === 0, "F: and then counts who it found there", w.ids(v));
  const n2 = w.reads.length;
  w.settings({ botAfkMs: 30 * MIN });
  v = w.view();
  ok(w.reads.length === n2 && w.ids(v).indexOf("@old:hs") < 0 && w.sb.Room._viewerChatForTest().tiers["!t1"].people["@old:hs"] === T - 90 * MIN,
    "F: a narrower window reads nothing, and keeps what it has (within the longest window the settings allow)", w.ids(v));
  // ── H — self-cleaning ──
  w.raw({ type: "m.room.message", room_id: "!t1", sender: "@ancient:hs", ts: T - w.sb.Activity.maxWindowMs() - HOUR });
  w.view();
  ok(!("@ancient:hs" in w.sb.Room._viewerChatForTest().tiers["!t1"].people), "H: nothing older than the longest window the settings allow is kept");
  // ── G — a room switch starts fresh ──
  w.cur = { spaceId: "!s2", channels: { a: "!u1" } }; w.tiers = [{ tier: "main", id: "!u1" }];
  v = w.view();
  const fresh = w.sb.Room._viewerChatForTest();
  ok(Object.keys(fresh.tiers).join() === "!u1" && w.ids(v).length === 0 && v.unknownTiers.join() === "main", "G: a room switch starts fresh — nothing carried over, the new tier read back", fresh);
  // ── I — the bot's fold is unchanged ──
  const w2 = world(); w2.settings(); w2.view(); await w2.answer("!t1", { "@chatonly:hs": T - MIN }, T - 31 * MIN);
  ok(w2.ids(w2.view()).indexOf("@chatonly:hs") >= 0 && w2.sb.Room.recentlyActive(T).people.every((p) => p.userId !== "@chatonly:hs"),
    "I: the bot's input, `recentlyActive`, is unchanged — the viewer's record lives only in the People tab's view");
  // ── J — nothing publishes or grants `ddjp.presence` ──
  const hits = [];
  for (const d of ["backends/backend1", "backends/backend2", "features", "ui", "core"]) for (const f of fs.readdirSync(path.join(ROOT, d))) {
    if (!/\.js$/.test(f)) continue;
    fs.readFileSync(path.join(ROOT, d, f), "utf8").split("\n").forEach((l, i) => { if (/ddjp\.presence|publishPresence|presenceList/.test(l) && !/^\s*\/\//.test(l)) hits.push(d + "/" + f + ":" + (i + 1)); });
  }
  ok(hits.length === 0, "J: no code publishes, believes or grants `ddjp.presence` — the list and its power-level entry are gone (J75)", hits);
})().then(done, (e) => { failed++; console.log("[viewer-chat] FAIL — threw: " + (e && e.stack || e)); done(); });
function done() {
  _finished = true;
  if (failed) { console.log("[viewer-chat] " + failed + " failure(s)"); process.exit(1); }
  console.log("[viewer-chat] PASS — the People tab works from each viewer's own view (J75): chat is tracked per tier, who and when " +
    "only, in the tiers the viewer can read; read back on opening as far as the window needs, unsure until done; a tier gained is " +
    "read back, a tier lost dropped; chat counted or not re-judged with no download; a wider window reads further, a narrower one " +
    "keeps; a room switch starts fresh; old records go; the bot's fold is unchanged; and nothing publishes ddjp.presence (" + asserts + " assertions)");
  process.exit(0);
}
