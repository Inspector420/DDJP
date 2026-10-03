// tests/check-bot-open.js
// SUBJECT: backends/backend1/streammanager.js, backends/backend2/streammanager.js, backends/backend2/checkpoint.js
//
// WALL: A BOT ROOM OPENS FROM THE BOT'S SAVE POINT AND AGREES WITH THE FULL DOWNLOAD (J67, step 1).
// Real doors, real reducer, a seed built the way the runner builds it. The owner's ruling: settings
// are read back to the change the save point contains (`seed.settingsFrom`); every later change is
// applied on top, even one numbered before the save point.
//
//   A  opening from the save point gives the same queue, song and settings as the full download
//   B  whichever channel arrives first
//   C  a settings change numbered BEFORE the save point but not in it is still applied
//   D  a save point in the old (display) shape is refused, and nothing changes

const { loadInContext } = require("./_load.js");

let failed = 0, checks = 0;
function ok(cond, msg, got) {
  checks++;
  if (!cond) { failed++; console.log("[bot-open] FAIL — " + msg); if (got !== undefined) console.log("      got " + JSON.stringify(got)); }
}
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/eventcache.js", "backends/backend1/statederiver.js",
  "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
  "backends/backend1/checkpointformat.js", "backends/backend2/checkpoint.js", "backends/backend1/activity.js", "backends/backend2/streammanager.js"];
const OWNER = "@gm:hs", BOT = "@bot:hs", LOG = "!log", SET = "!set";
const url = (v) => "https://www.youtube.com/watch?v=" + v;

function world() {
  const sb = loadInContext(FILES, { Date, Math, JSON });
  sb.Logger.warn = () => {}; sb.Logger.info = () => {}; sb.Logger.debug = () => {};
  sb.B2StreamManager.setFoldScope({ events_owner: LOG, settings_owner: SET });
  return sb;
}
// The room, as raws. Positions are the runner's (events) and the owner's clock (settings).
let n = 0;
// The real fan-out stamps `senderRank` from the channel — the settings room is the owner's (100).
const raw = (room, body, sender, ts) => ({ type: "m.room.message", event_id: "$r" + String(++n).padStart(3, "0"),
  room_id: room, sender: sender, ts: ts, senderRank: room === SET ? 100 : 99,
  content: { body: JSON.stringify(Object.assign({ dv: 2, hv: 1 }, body)) } });
const rel = (i, src) => Object.assign({}, i, { actor: OWNER, rank: 100, src: src, at: null });
const S0 = world().StateDeriver.defaultSettings();
const set1 = raw(SET, { t: "ddjp.room.settings", s: S0, l: 1 }, OWNER, 1000);
const early = [
  raw(LOG, { t: "ddjp.batch", l: 3, evs: [rel({ t: "ddjp.dj.join", v: "aaaaaaaaaaa", u: url("aaaaaaaaaaa") }, "$i1"),
                                           rel({ t: "ddjp.dj.join", v: "bbbbbbbbbbb", u: url("bbbbbbbbbbb") }, "$i2")] }, BOT, 2000),
  raw(LOG, rel({ t: "ddjp.dj.play", p: null, l: 4 }, "$i3"), BOT, 3000),
];
// The save point: sealed after l=4, at server time 4000. Its seed is built the runner's way.
const sealWorld = world();
for (const r of [set1].concat(early)) sealWorld.B2StreamManager.ingest(r);
const sealedLog = sealWorld.B2StreamManager.getLog();
const seed = sealWorld.StateDeriver.buildSeed(sealedLog, undefined);
const head = sealedLog[sealedLog.length - 1];
const cpBody = { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, floorL: head.l, thin: false, covers: head.eventId, l: 5 };
cpBody.h = sealWorld.CheckpointFormat ? sealWorld.CheckpointFormat.fingerprint(1, null, seed, head.l, false, head.eventId) : null;
const cpRaw = raw(LOG, cpBody, BOT, 4000);
// After the seal: a LATE settings change numbered 2 (the owner had not yet seen l=3,4), stamped 4100,
// so the seed never folded it — and ordinary traffic above the save point.
const lateSet = raw(SET, { t: "ddjp.room.settings", s: Object.assign({}, S0, { bg: "https://example.org/late.jpg" }), l: 2 }, OWNER, 4100);
const after = [
  raw(LOG, { t: "ddjp.batch", l: 6, evs: [rel({ t: "ddjp.dj.join", v: "ccccccccccc", u: url("ccccccccccc") }, "$i4")] }, BOT, 5000),
  raw(LOG, rel({ t: "ddjp.dj.play", p: early[1].event_id, l: 7 }, "$i5"), BOT, 400000),
];
const summary = (sb) => {
  const st = sb.B2StreamManager.getState();
  return JSON.stringify({ q: (st.rotation || []).map((r) => [r.user, r.pending.map((p) => p.videoId)]),
    np: st.nowPlaying && st.nowPlaying.song ? st.nowPlaying.song.videoId : null, bg: st.settings && st.settings.bg });
};

// ── THE FULL DOWNLOAD ──────────────────────────────────────────────────────────────────────────
const full = world();
for (const r of [set1].concat(early, [cpRaw, lateSet], after)) full.B2StreamManager.ingest(r);
const truth = summary(full);
ok(JSON.parse(truth).bg === "https://example.org/late.jpg" && JSON.parse(truth).np === "bbbbbbbbbbb",
  "APPLIED — the full download applies the late setting and plays the second song", truth);

// ── OPENING FROM THE SAVE POINT, BOTH ARRIVAL ORDERS ───────────────────────────────────────────
const open = (settingsFirst) => {
  const sb = world();
  const D = sb.B2StreamManager;
  ok(typeof D.openFromSavePoint === "function", "the bot door can open from a save point", typeof D.openFromSavePoint);
  if (typeof D.openFromSavePoint !== "function") return null;
  const settingsRoom = [set1, lateSet];                 // the settings room is read whole
  const eventsRoom = [cpRaw].concat(after);             // the events room only from the save point
  const seq = settingsFirst ? settingsRoom.concat(eventsRoom) : eventsRoom.concat(settingsRoom);
  for (const r of seq) D.ingest(r);
  const res = D.openFromSavePoint();
  return { res: res, sum: summary(sb), ids: D.getLog().map((e) => e.eventId) };
};
const a = open(true), b = open(false);
if (a && b) {
  ok(a.res && a.res.ok === true, "A: the newest usable save point is adopted", a.res);
  ok(a.sum === truth, "A: opening from it gives the same queue, song and settings as the full download", { open: a.sum, full: truth });
  ok(b.sum === truth, "B: whichever channel arrives first", { open: b.sum, full: truth });
  ok(a.ids.indexOf(set1.event_id) < 0 && b.ids.indexOf(set1.event_id) < 0 &&
     a.ids.indexOf(lateSet.event_id) >= 0 && b.ids.indexOf(lateSet.event_id) >= 0,
    "A: and what the save point covers is DROPPED from memory — the point of opening from it — while the late " +
    "settings change it does not cover is kept", { a: a.ids, b: b.ids });
  ok(JSON.parse(a.sum).bg === "https://example.org/late.jpg" && JSON.parse(b.sum).bg === "https://example.org/late.jpg",
    "C: the settings change numbered before the save point but not in it is applied — it sorts after the change the " +
    "save point names (seed.settingsFrom)");
}

// ── E: SETTINGS ARRIVING AFTER THE SAVE POINT WAS ADOPTED ─────────────────────────────────────
// The events room finishes first and the save point is adopted; the settings room arrives after —
// the door's arrival check, not the adoption filter, must judge the late change.
{
  const sb = world();
  const D = sb.B2StreamManager;
  for (const r2 of [cpRaw].concat(after)) D.ingest(r2);
  const res = D.openFromSavePoint();
  for (const r2 of [set1, lateSet]) D.ingest(r2);
  ok(res && res.ok === true && summary(sb) === truth,
    "E: settings arriving AFTER adoption are judged by the change the save point names: the old one is " +
    "covered, the late one applied — same as the full download", { res: res, open: summary(sb), full: truth });
}

// ── F: THE BOT, OPENED FROM A SAVE POINT, BUILDS ITS NEXT ONE ON TOP OF IT (J67 step 2) ────────
// The runner's own seed builder, driven against a bot door that opened from the save point. It no
// longer holds the room's start, so a seed built from an empty start would lose the queue.
{
  const sb = loadInContext(FILES.concat(["backends/backend2/authority.js", "backends/backend2/runner.js"]), {
    Date, Math, JSON, setInterval: () => 0, clearInterval: () => {},
    Backends: { register: () => {}, active: () => "backend2", resolveMode: () => "backend2" },
    MatrixBridge: { getMyPowerLevel: () => 99, getUserId: () => BOT, getUserEffectiveRank: () => 99,
      getCreateContent: () => ({ ddjp_mode: "backend2" }), onRawEvent() {}, offRawEvent() {},
      mayAuthor: () => ({ ok: true }), onAuthorReady() {}, sendEvent: () => Promise.resolve({ eventId: "$x", l: 0 }) },
  });
  sb.Logger.warn = () => {}; sb.Logger.info = () => {}; sb.Logger.debug = () => {};
  sb.StreamManager = sb.B2StreamManager;
  const D = sb.B2StreamManager;
  D.setFoldScope({ events_owner: LOG, settings_owner: SET });
  for (const r2 of [set1, lateSet, cpRaw].concat(after)) D.ingest(r2);
  ok(D.openFromSavePoint().ok === true, "F: APPLIED — the bot's door opened from the save point");
  ok(typeof sb.B2Runner._buildSealSeed === "function", "F: the runner builds its seal seed in one named function");
  if (typeof sb.B2Runner._buildSealSeed === "function") {
    const next = sb.B2Runner._buildSealSeed(D.getLog());
    const st = next ? sb.StateDeriver.derive([], next) : null;
    const asSummary = st ? JSON.stringify({ q: (st.rotation || []).map((x) => [x.user, x.pending.map((p) => p.videoId)]),
      np: st.nowPlaying && st.nowPlaying.song ? st.nowPlaying.song.videoId : null, bg: st.settings && st.settings.bg }) : null;
    ok(asSummary === truth, "F: its next save point reproduces the room — built on top of the one it opened from",
      { next: asSummary, full: truth });
    const naive = sb.StateDeriver.derive([], sb.StateDeriver.buildSeed(D.getLog(), undefined));
    ok(JSON.stringify((naive.rotation || []).map((x) => x.user)) !== JSON.stringify(JSON.parse(truth).q.map((x) => x[0])) ||
       !naive.nowPlaying, "F CONTROL: built from an empty start instead, it loses what the save point held");
  }
}

// ── G: SONG HISTORY STARTS FROM THE SAME SAVE POINT (J67 step 3) ────────────────────────────────
{
  const sb = loadInContext(FILES.concat(["backends/backend1/history.js"]), { Date, Math, JSON });
  sb.Logger.warn = () => {}; sb.Logger.info = () => {}; sb.Logger.debug = () => {};
  const D = sb.B2StreamManager;
  D.setFoldScope({ events_owner: LOG, settings_owner: SET });
  for (const r2 of [set1, lateSet, cpRaw].concat(after)) D.ingest(r2);
  D.openFromSavePoint();
  const H = sb.History;
  H.reset(); H.ingest(D.getLog(), D.floorSeed());
  const withSeed = H.recent(5).map((h) => h.videoId);
  H.reset(); H.ingest(D.getLog(), undefined);
  const without = H.recent(5).map((h) => h.videoId);
  ok(withSeed.indexOf("bbbbbbbbbbb") >= 0, "G: song history, started from the save point's state, finds the song played after it", withSeed);
  ok(without.indexOf("bbbbbbbbbbb") < 0, "G CONTROL: without it, it does not", without);
  const src = require("fs").readFileSync(require("path").join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  ok(/seed: \(\) => \{ try \{ return \(StreamManager\.floorSeed && StreamManager\.floorSeed\(\)\) \|\| Floor\.seed\(\)/.test(src),
    "G (textual — the attach needs a live client): History's live starting state asks the door's floor first");
}

// ── H: OPENED ON LOAD, KEEPING THE ACTIVITY WINDOW (J67 step 4) ────────────────────────────────
{
  const ws = world().B2StreamManager;
  const w = ws.activityWindowMs({ botAfkMs: 3600000, queueIdleMs: 900000, botPingMs: 600000, botPresencePingMs: 300000 });
  ok(w === 4200000, "H: the window is the longest AFK or idle window plus the longest warning time (1 h + 10 min)", w);
  ok(ws.activityWindowMs({}) === 0 && ws.activityWindowMs(null) === 0, "H: and nothing unknown is guessed");
  // (The window path into openFromSavePoint was removed — no production caller used it; audit ddjp_512.)
  const roomSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "features", "room.js"), "utf8");
  ok(/await Promise\.allSettled\(jobs\);[\s\S]{0,900}StreamManager\.openFromSavePoint\(\);/.test(roomSrc),
    "H (textual — the replay needs a live room): Room opens from the save point once every channel's download has settled");
}

// ── I: THE DOWNLOAD STOPS AT THE NEWEST USABLE SAVE POINT (J67, two-stage opening, stage 1) ──────
{
  const D = world().B2StreamManager;
  D.setFoldScope({ events_owner: LOG, settings_owner: SET });
  const asTimeline = (raws) => raws.map((r) => ({ type: r.type, content: r.content }));
  ok(typeof D.replayHasEnough === "function", "I: the bot door answers whether a download has reached far enough");
  if (typeof D.replayHasEnough === "function") {
    ok(D.replayHasEnough(LOG, asTimeline(after)) === false, "I: no save point yet — keep downloading");
    ok(D.replayHasEnough(LOG, asTimeline([cpRaw].concat(after))) === true, "I: a usable save point is in — stop");
    const disp = JSON.parse(JSON.stringify(D.getState()));
    const oldShape = raw(LOG, Object.assign({}, cpBody, { seed: disp,
      h: world().CheckpointFormat.fingerprint(1, null, disp, head.l, false, head.eventId) }), BOT, 4000);
    ok(D.replayHasEnough(LOG, asTimeline([oldShape].concat(after))) === false, "I: an old-shape save point does not stop it");
    const forged = raw(LOG, Object.assign({}, cpBody, { h: "0".repeat(64) }), BOT, 4000);
    ok(D.replayHasEnough(LOG, asTimeline([forged].concat(after))) === false, "I: nor one whose fingerprint does not verify");
    ok(D.replayHasEnough(SET, asTimeline([cpRaw, set1])) === false, "I: the settings room is always downloaded whole");
  }
  const mb = require("fs").readFileSync(require("path").join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  ok(/if \(_replayHasEnough\(roomId, room\)\) \{ stoppedAtSavePoint = true; break; \}/.test(mb) &&
     /reachedStart = \(guard < 200\) && !stoppedAtSavePoint;/.test(mb),
    "I (textual — the download needs a live client): replayRoom asks before each page, and a stopped download is " +
    "not taken as reaching the room's start");
}

// ── J: THE BACKGROUND READ OF WHO IS ACTIVE (J67, stage 2) ──────────────────────────────────────
// Older events of the bot's log, read after the room opened, feed only a last-activity list —
// credited to the person who ACTED (a relay's actor), never to the bot, and never to the queue.
{
  const sb = world();
  const D = sb.B2StreamManager;
  D.setFoldScope({ events_owner: LOG, settings_owner: SET });
  for (const r2 of [set1, lateSet, cpRaw].concat(after)) D.ingest(r2);
  const _beforeOpen = (typeof D.olderActivity === "function") ? D.olderActivity() : null;
  D.openFromSavePoint();
  const _afterOpen = (typeof D.olderActivity === "function") ? D.olderActivity() : null;
  const before = summary(sb);
  ok(typeof D.noteActivity === "function" && typeof D.olderActivity === "function" && typeof D.activityCovered === "function",
    "J: the bot door keeps a background activity list");
  if (typeof D.noteActivity === "function") {
    // J73 job 2 CHANGED WHERE THIS HOLDS: opening from the save point now TAKES the activity of what it
    // drops, before dropping it (the owner's "take before dropping"). So "nothing read" is true before
    // the save point is opened, and after it there is a list.
    ok(_beforeOpen === null, "J: nothing read yet — no list, not an empty one that reads as 'nobody was active'");
    ok(_afterOpen !== null, "J: opening from the save point took what it dropped, first (J73 job 2)", _afterOpen);
    const older = raw(LOG, { t: "ddjp.batch", l: 2, evs: [rel({ t: "ddjp.dj.vote", p: "$x" }, "$o1"),
      Object.assign(rel({ t: "ddjp.dj.join" }, "$o2"), { actor: "@pat:hs" }),
      // A join CARRYING a song is the queue's automatic re-join, not a person acting — not counted.
      Object.assign(rel({ t: "ddjp.dj.join", v: "ddddddddddd", u: url("ddddddddddd") }, "$o3"), { actor: "@auto:hs" })] }, BOT, 1500);
    D.noteActivity([older]);
    const list = D.olderActivity();
    const grpVote = sb.Capabilities.activityGroupOf("ddjp.dj.vote", { t: "ddjp.dj.vote" });
    ok(list && list.by[OWNER] && list.by[OWNER][grpVote] === 1500 && list.by["@pat:hs"] && !list.by[BOT],
      "J: each act is credited to the person who acted — the relay's actor — and never to the bot", list && list.by);
    const withAt = raw(LOG, { t: "ddjp.batch", l: 3, evs: [Object.assign(rel({ t: "ddjp.dj.vote", p: "$x" }, "$o4"),
      { actor: "@timed:hs", at: 1200 })] }, BOT, 1500);
    D.noteActivity([withAt]);
    ok(D.olderActivity().by["@timed:hs"][grpVote] === 1200,
      "J: an act carrying its own time is credited with it — the door's rule (`_shape`), not the relay's stamp");
    ok(list && !list.by["@auto:hs"], "J: and the queue's automatic re-join is not counted as anyone being active — " +
      "the same rule the fold uses (StateDeriver.activityGroupOf)", list && list.by);
    ok(summary(sb) === before, "J: and nothing read this way reaches the queue", { before, after: summary(sb) });
    const S = sb.B2StreamManager.activityWindowMs(sb.B2StreamManager.getState().settings);
    // Measured from the OLDEST evidence, taken or read: since J73 job 2 that is the oldest event the save
    // point dropped, not the read's 1500 — more evidence, so covered sooner. The row's point is unchanged.
    const _from = D.olderActivity().since;
    ok(D.activityCovered(_from + S - 1) === false && D.activityCovered(_from + S) === true,
      "J: covered once the read reaches back a whole activity window", S);
    const newest = D.getLog().reduce((m, e) => Math.max(m, e.ts || 0), 0);
    ok(D.activityCovered() === false, "J: asked without a time, it judges against the newest server stamp it holds — not yet");
    D.noteActivity([{ ts: newest - S, room_id: "!elsewhere", content: { body: "{}" } }]);
    ok(D.activityCovered() === true, "J: and covered once the read reaches a whole window behind that stamp — the transport " +
      "never reaches for an app clock (check-boundaries)", { newest, S });
    D.noteActivity([], { complete: true });
    ok(D.activityCovered(1500 + S + 999999999) === true, "J: or once it reached the room's start");
  }
  const mb = require("fs").readFileSync(require("path").join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  ok(/if \(stoppedAtSavePoint\) _readActivityBack\(roomId, room\);/.test(mb) &&
     /StreamManager\.noteActivity\(/.test(mb) && /StreamManager\.activityCovered\(/.test(mb),
    "J (textual — paging needs a live client): a stopped download goes on reading back in the background");
}

// ── K: THE 24-HOUR CAP THE BACKGROUND READ RELIES ON (J67, owner) ──────────────────────────────
// The read back is bounded by the activity window, so the AFK and presence windows are capped at
// 24 hours (owner). The cap was already in the table; this pins it, because raising it silently
// unbounds the read.
{
  const sb = world();
  const R = sb.StateDeriver.SETTING_RANGES;
  ok(R && R.queueIdleMs && R.queueIdleMs.max === 24 * 60 * 60 * 1000 && R.botAfkMs && R.botAfkMs.max === 24 * 60 * 60 * 1000,
    "K: the idle-queue and presence AFK windows are capped at 24 hours", R && { q: R.queueIdleMs, a: R.botAfkMs });
  const most = sb.B2StreamManager.activityWindowMs({ botAfkMs: R.botAfkMs.max, queueIdleMs: R.queueIdleMs.max,
    botPingMs: R.botPingMs.max, botPresencePingMs: R.botPresencePingMs.max });
  ok(most <= 25 * 60 * 60 * 1000, "K: so the background read never reaches back more than 25 hours (window plus warning)", most);
}

// ── L: THE TRANSPORT'S READ-BACK OF WHO SPOKE (J67, chat) — textual, paging needs a live client ──
{
  const mb = require("fs").readFileSync(require("path").join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  const a = mb.indexOf("async function readBackActivity(");
  const body = a >= 0 ? mb.slice(a, a + 2400) : "";
  ok(a >= 0 && /who === me/.test(body) && /ty !== "m\.room\.message" && ty !== "m\.room\.encrypted"/.test(body),
    "L (textual): readBackActivity counts messages, encrypted ones included without decrypting, and never this client's own");
  ok(/if \(room\.timeline\.length === prev\) \{ out\.complete = true; break; \}/.test(body),
    "L (textual): and a timeline that stops growing is the chat's start — complete (owner: what cannot be fetched does not exist)");
}

// ── M — ONE RULE FOR "USABLE" (audit ddjp_512, finding 1) ─────────────────────────────────────
// A save point with no position verifies (the fingerprint normalises floorL to null) but the
// opening would skip it. It must never stop the download — a stopped download with nothing opened
// from folds a cut-off log from an empty start.
{
  const asT = (raws) => raws.map((r) => ({ type: r.type, content: r.content }));
  const sb = world(); const D = sb.B2StreamManager;
  D.setFoldScope({ events_owner: LOG, settings_owner: SET });
  const noPos = raw(LOG, Object.assign({}, cpBody, { floorL: null,
    h: sb.CheckpointFormat.fingerprint(1, null, seed, null, false, head.eventId) }), BOT, 4000);
  ok(D.replayHasEnough(LOG, asT([noPos].concat(after))) === false,
    "M: a save point with no position never stops the download — the opening would skip it");
  for (const r2 of [set1, lateSet, noPos].concat(after)) D.ingest(r2);
  const res = D.openFromSavePoint();
  ok(res.ok === false && res.stopped === false, "M: nor is it opened from — and the result says the download never stopped", res);
  const sb2 = world(); const D2 = sb2.B2StreamManager;
  D2.setFoldScope({ events_owner: LOG, settings_owner: SET });
  ok(D2.replayHasEnough(LOG, asT([cpRaw].concat(after))) === true, "M CONTROL: the same save point WITH its position stops it");
  for (const r2 of [set1, lateSet, cpRaw].concat(after)) D2.ingest(r2);
  const r3 = D2.openFromSavePoint();
  ok(r3.ok === true && r3.stopped === true && summary(sb2) === truth, "M CONTROL: and is opened from, matching the full download", r3);
  // The tie the `covers` range exists for, MEASURED: an event at the save point's exact position
  // arriving after it is refused at the bot door as backdated — so in a bot room it cannot occur.
  const tie = raw(LOG, rel({ t: "ddjp.dj.vote", p: early[1].event_id, l: head.l }, "$tie"), BOT, 500000);
  D2.ingest(tie);
  ok(D2.getLog().every((e) => String(e.eventId).indexOf(tie.event_id) !== 0),
    "M: the id tie-break is unreachable in a bot room — an event at the save point's position after it is refused at the door");
}

// ── N — THE BACKGROUND READS, RUN (audit ddjp_512, finding 3; were text-only) ───────────────────
// The shipped functions, extracted from matrixbridge.js and run against a fake client. Async, so
// the file's verdict waits for it (PART_N below).
const PART_N = (async () => {
  const mbSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "backends", "backend1", "matrixbridge.js"), "utf8");
  const cut = (from, to) => { const a = mbSrc.indexOf(from), b = mbSrc.indexOf(to, a + 1); return (a >= 0 && b > a) ? mbSrc.slice(a, b) : null; };
  // From the block's first line (J73 job 4 and its fix): the read-back keeps its room, a busy flag and a
  // generation counter, declared just above it — taken from the shipped file rather than copied here.
  const readBackSrc = cut("  let _activityReadAt = null, _activityReadBusy = false;", "  async function replayRoom(roomId) {");
  const whoSrc = cut("  async function readBackActivity(roomId, sinceTs) {", "  async function _readActivityBack(roomId, room) {");
  ok(readBackSrc && whoSrc, "N: APPLIED — both background-read functions were found to run");
  const ev = (i, who, type) => ({ getId: () => "$e" + i, getSender: () => who || "@u:hs", getTs: () => 1000 + i,
    getType: () => type || "m.room.message", getContent: () => ({ body: "{}" }) });
  const run = async (resetOnPage) => {
    const room = { timeline: [ev(100)] };
    let page = 0;
    const client = { scrollback: async (r) => { page++; if (page === resetOnPage) { r.timeline = [ev(200)]; return; }
                                                  if (page <= 3) r.timeline.unshift(ev(page)); } };
    const notes = { complete: false, raws: 0 };
    const SM = { noteActivity: (raws, o) => { notes.raws += raws.length; if (o && o.complete) notes.complete = true; },
                 activityCovered: () => notes.complete };
    const fn = new Function("client", "StreamManager", "Logger", readBackSrc + "\nreturn _readActivityBack;")(client, SM, { info() {}, warn() {} });
    await fn("!r", room);
    return notes;
  };
  if (readBackSrc) {
    const whole = await run(0);
    ok(whole.complete === true, "N CONTROL: with no reset it reads every page and then declares the room's start reached", whole);
    const reset = await run(2);
    ok(reset.complete === false, "N: a timeline RESET mid-read (a limited sync) is stopping short — never 'reached the start'", reset);
  }
  if (whoSrc) {
    const room = { timeline: [ev(5, "@a:hs", "m.room.encrypted"), ev(7, "@bot:hs"), ev(9, "@a:hs")] };
    const client = { getRoom: () => room, scrollback: async () => {} };
    const fn = new Function("client", "getUserId", "Logger", whoSrc + "\nreturn readBackActivity;")(client, () => "@bot:hs", { warn() {} });
    const r = await fn("!chat", 0);
    ok(r.ok === true && r.people["@a:hs"] === 1009 && !("@bot:hs" in r.people) && r.complete === true,
      "N: readBackActivity, run — newest time per sender, encrypted messages counted without decrypting, this " +
      "client's own excluded, and a timeline that stops growing is the chat's start", r);
  }
})().catch((e) => { failed++; console.log("[bot-open] FAIL — N threw: " + (e && e.message)); });

// ── O — THE SEED FOLLOWS THE FLOOR (audit ddjp_512, finding 6) — textual: both are internal ──────
{
  const sm = require("fs").readFileSync(require("path").join(__dirname, "..", "backends", "backend1", "streammanager.js"), "utf8");
  ok(/function _trustedSeed\(\) \{\s*if \(_adopted\) return _adopted\.seed \|\| null;/.test(sm) &&
     /function _trustedFloor\(\) \{\s*if \(_adopted\) return _adopted;/.test(sm),
    "O (textual): _trustedSeed and _trustedFloor both answer from the adopted save point first, so the pair cannot drift");
}

// ── D: AN OLD-SHAPE SAVE POINT IS REFUSED ──────────────────────────────────────────────────────
const old = world();
// A properly fingerprinted save point, so it is HELD — refused by its shape, not by its fingerprint.
const dispSeed = JSON.parse(JSON.stringify(sealWorld.B2StreamManager.getState()));
const oldCp = raw(LOG, Object.assign({}, cpBody, { seed: dispSeed,
  h: sealWorld.CheckpointFormat.fingerprint(1, null, dispSeed, head.l, false, head.eventId) }), BOT, 4000);
for (const r of [set1, oldCp].concat(after)) old.B2StreamManager.ingest(r);
const before = summary(old);
ok(old.B2StreamManager.heldCheckpoints().length === 1, "D: APPLIED — the old-shape save point is held (its fingerprint is valid)",
  old.B2StreamManager.heldCheckpoints().length);
const r = old.B2StreamManager.openFromSavePoint ? old.B2StreamManager.openFromSavePoint() : { ok: false };
ok(r.ok === false && summary(old) === before, "D: a save point in the old display shape is not adopted, and nothing changes",
  { res: r, before: before, after: summary(old) });

PART_N.then(() => {
if (failed) { console.log("[bot-open] FAIL — " + failed + " of " + checks + " assertions failed"); process.exit(1); }
console.log("[bot-open] PASS — a bot room opens from the bot's save point and agrees with the full download (J67 step 1, " +
  checks + " assertions): same queue, song and settings in both arrival orders, a late settings change numbered before " +
  "the save point still applied, and an old-shape save point refused");
});
