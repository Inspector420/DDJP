// tests/check-bot-move-on.js
// SUBJECT: backends/backend2/streammanager.js, backends/backend1/streammanager.js, backends/backend1/eventcache.js
// WALL: A BOT ROOM MOVES ON AT EVERY NEW SAVE POINT, AND ONLY TO ONE THAT REPRODUCES WHAT IT HOLDS (J73 job 7).
//
// Bot rooms opened from one save point and then held everything (`openFromSavePoint` ran once), so the
// held log grew all session — and the judge's cost with it (`tools/probes/probe-j73-judge-cost.js`:
// 1.7 s for a 12-vote burst at a week). Q7: move on at every new save point, as decentralized rooms
// do. Q6: before dropping, check that the save point reproduces what is held — across every derived
// field a drop could change. Activity, history and added times are taken first. Real door, real
// `B2Checkpoint.seal` (real fingerprints), and a REFERENCE READER that folded every relay.
//   PART A — it moves on, and the room is still the reference reader's.
//   PART B — a seed that does not reproduce is refused, field by field, and nothing is dropped.
//   PART C — what is dropped is taken first: activity, the songs, and added times.
//   PART D — EventCache's banked tier follows the adopted save point.
//   PART E — over a long session the held log stays bounded.
"use strict";
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-move-on] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const FILES = ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
  "backends/backend1/activity.js", "backends/backend1/history.js", "backends/backend1/checkpointformat.js",
  "backends/backend1/session.js", "backends/backend1/floor.js", "backends/backend1/streammanager.js",
  "backends/backend2/checkpoint.js", "backends/backend2/streammanager.js"];
const FIELDS = ["nowPlaying", "rotation", "settings", "counts", "advance"];
const MIN = 60000;
function door() {
  const sb = loadInContext(FILES, {});
  sb.B2StreamManager.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
  sb.History.reset();
  return sb;
}
const R = loadInContext(["backends/backend1/ranks.js"], {}).Ranks;
const PLY = R.levelOf("player"), OWN = R.levelOf("owner");
const relay = (id, l, ts, actor, rank, body) => ({ event_id: id, type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs",
  ts: ts, content: { body: JSON.stringify(Object.assign({ l: l, actor: actor, rank: rank }, body)) } });
// A room as relays: settings, eight songs from four DJs, then rounds of a play, a few votes, a re-add.
function relays(sb, rounds, extra) {
  const out = [relay("$s", 1, 1000, "@owner:hs", OWN, { t: "ddjp.room.settings", s: sb.StateDeriver.defaultSettings() })];
  let l = 2, ts = 2000, prev = null, n = 0;
  const add = (who, bare) => { out.push(relay("$a" + n, l++, ts += 50, who, PLY, bare ? { t: "ddjp.dj.join" } : { t: "ddjp.dj.join", v: "vid" + String(n).padStart(8, "0") })); n++; };
  for (let u = 0; u < 4; u++) { add("@u" + u + ":hs"); add("@u" + u + ":hs"); }
  if (extra) extra(out, () => l++, () => (ts += 50));
  for (let r = 0; r < rounds; r++) {
    const id = "$p" + r;
    out.push(relay(id, l++, ts += 4 * MIN, "@u0:hs", PLY, { t: "ddjp.dj.play", p: prev })); prev = id;
    for (let v = 0; v < 3; v++) out.push(relay("$v" + r + "_" + v, l++, ts += 1000, "@l" + v + ":hs", PLY, { t: "ddjp.dj.vote", p: id }));
    add("@u" + (r % 4) + ":hs");
  }
  return out;
}
// The runner's seal, as the runner does it: the held log on the adopted seed, cut at its head.
function seal(sb, tamper) {
  const log = sb.B1StreamManager.getLog();
  let seed = sb.StateDeriver.buildSeed(log, sb.B1StreamManager.floorSeed() || undefined);
  if (tamper) seed = tamper(JSON.parse(JSON.stringify(seed)));
  const last = log[log.length - 1];
  const r = sb.B2Checkpoint.seal(seed, { isRunner: true, floorL: last.l, covers: log[0].eventId + ".." + last.eventId });
  return { event_id: "$cp" + last.l + (tamper ? "x" : ""), type: "m.room.message", room_id: "!log:hs", sender: "@bot:hs",
           ts: last.ts + 1, content: { body: JSON.stringify(Object.assign({}, r.cp, { l: last.l + 1 })) } };
}
const reference = (rs) => { const sb = door(); rs.forEach((r) => sb.B2StreamManager.ingest(r)); return sb.B1StreamManager.getState(); };
// By value, and counts as the live song's: past plays' tallies are history, which no seed carries
// (J73 job 7 records that they leave the derived state at every adoption, as at every trim).
const canon = (v) => (v === null || typeof v !== "object") ? JSON.stringify(v === undefined ? null : v)
  : Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
const fieldOf = (st, k) => k !== "counts" ? st[k] : ((st.nowPlaying && st.counts && st.counts[st.nowPlaying.pi]) || null);
const sameRoom = (a, b) => FIELDS.every((k) => canon(fieldOf(a, k)) === canon(fieldOf(b, k)));
// Feed relays, sealing every `every`; the door opens at the first save point.
function run(sb, rs, every, tamperAt) {
  let k = 0, sealed = 0, maxHeld = 0;
  for (const r of rs) {
    sb.B2StreamManager.ingest(r); k++;
    if (k % every === 0) {
      sb.B2StreamManager.ingest(seal(sb, tamperAt && tamperAt(sealed))); sealed++;
      if (sealed === 1) sb.B2StreamManager.openFromSavePoint();
    }
    maxHeld = Math.max(maxHeld, sb.B1StreamManager.getLog().length);
  }
  return { sealed, maxHeld };
}
// ── PART A — it moves on, and the room is the reference reader's ────────────────────────────
{
  const sb = door(); const rs = relays(sb, 40);
  const ref = reference(rs);
  const r = run(sb, rs, 30);
  const mo = sb.B2StreamManager.lastMoveOn();
  ok(r.sealed >= 3 && mo && mo.ok === true, "A: after opening, the door moves on to each new save point", { sealed: r.sealed, lastMoveOn: mo });
  ok(sb.B1StreamManager.getLog().length <= 31, "A: the held log holds only what came after the last save point", sb.B1StreamManager.getLog().length);
  ok(sameRoom(sb.B1StreamManager.getState(), ref), "A: and the room is exactly the reference reader's, field by field",
    FIELDS.filter((k) => canon(fieldOf(sb.B1StreamManager.getState(), k)) !== canon(fieldOf(ref, k))));
}
// ── PART B — a seed that does not reproduce is refused, and nothing goes ────────────────────
for (const [field, tamper] of [
  ["rotation", (s) => { s.members = {}; return s; }],
  // CORRECTED (J73 job 7b): this tamper first wrote the DERIVED counts shape into the ledger, so it was
  // refused for a malformed ledger, not for a wrong tally. The ledger keeps votes as `v: { base, set, users }`.
  ["counts", (s) => { const pi = s.nowPlaying.pi; const c = s.ledger.counts[pi] || (s.ledger.counts[pi] = { v: { base: 0, set: false, users: [] }, s: { base: 0, set: false, users: [] } }); c.v.base += 5; return s; }],
  ["settings", (s) => { s.settings = Object.assign({}, s.settings, { maxLen: 123 }); return s; }]]) {
  const sb = door(); const rs = relays(sb, 20);
  run(sb, rs.slice(0, 30), 30);                                   // opened at the first save point
  rs.slice(30, 60).forEach((r) => sb.B2StreamManager.ingest(r));
  const before = sb.B1StreamManager.getLog().length;
  sb.B2StreamManager.ingest(seal(sb, tamper));
  const mo = sb.B2StreamManager.lastMoveOn();
  ok(mo && mo.ok === false && mo.reason === "does-not-reproduce" && mo.field === field,
    "B: a save point whose seed differs in " + field + " is refused, and says which field", mo);
  ok(sb.B1StreamManager.getLog().length >= before, "B: and nothing was dropped (" + field + ")", { before, after: sb.B1StreamManager.getLog().length });
}
{
  const sb = door(); const rs = relays(sb, 20);
  run(sb, rs.slice(0, 30), 30); rs.slice(30, 60).forEach((r) => sb.B2StreamManager.ingest(r));
  sb.B2StreamManager.ingest(seal(sb, null));
  ok(sb.B2StreamManager.lastMoveOn().ok === true, "B CONTROL: the same save point, honest, is moved on to", sb.B2StreamManager.lastMoveOn());
}
// ── PART C — what is dropped is taken first ─────────────────────────────────────────────────
{
  const sb = door();
  const rs = relays(sb, 20, (out, nextL, nextTs) => {
    out.push(relay("$o", nextL(), nextTs(), "@o:hs", PLY, { t: "ddjp.dj.join" }));      // @o's only act
  });
  run(sb, rs.slice(0, 30), 30);
  rs.slice(30).forEach((r) => sb.B2StreamManager.ingest(r));
  sb.B2StreamManager.ingest(seal(sb, null));
  ok(sb.B2StreamManager.lastMoveOn().ok === true, "C PREMISE — the door moved on past @o's act");
  ok(!sb.B1StreamManager.getLog().some((e) => e.eventId === "$o"), "C PREMISE — @o's act is no longer held");
  const older = sb.B2StreamManager.olderActivity();
  ok(!!older && !!older.by["@o:hs"], "C: @o's activity was taken before it was dropped", older && Object.keys(older.by));
  const dropped = rs.filter((r) => { const b = JSON.parse(r.content.body); return b.t === "ddjp.dj.play" && !sb.B1StreamManager.getLog().some((e) => e.eventId === r.event_id); });
  const pis = new Set(sb.History.recent().map((h) => h.pi));
  ok(dropped.length > 0 && dropped.every((r) => pis.has(r.event_id)), "C: every song whose play was dropped is in song history", { dropped: dropped.length, rows: pis.size });
  const st = sb.B1StreamManager.getState();
  const q = st.rotation.find((x) => x.pending.length); const v = q && q.pending[0].videoId;
  const addRaw = rs.find((r) => { const b = JSON.parse(r.content.body); return b.v === v && b.actor === q.user; });
  ok(!!addRaw && sb.History.addedAt(q.user, v, Infinity) === addRaw.ts, "C: a queued song added before the cut keeps its added time", addRaw && { want: addRaw.ts, got: sb.History.addedAt(q.user, v, Infinity) });
}
// ── PART D — EventCache's banked tier follows the adopted save point ────────────────────────
{
  const sb = loadInContext(FILES.concat(["backends/backend1/vouch.js", "backends/backend1/eventcache.js"]), {});
  sb.B2StreamManager.setFoldScope({ events_owner: "!log:hs", settings_owner: "!set:hs" });
  const rs = relays(sb, 20);
  run(sb, rs, 30);
  const cut = sb.B1StreamManager.adoptedFloor();
  let plan = null; try { plan = sb.EventCache.dryRunEviction(); } catch (e) { plan = { threw: String(e && e.message) }; }
  ok(!!cut && sb.Floor.current() === null, "D PREMISE — a bot room: an adopted save point, and no floor in Floor", { cut: !!cut, floor: sb.Floor.current() });
  ok(!!plan && plan.floorL === cut.floorL && plan.floorReason === "resolved-floorL",
    "D: EventCache resolves its banked tier from the adopted save point, not \"no checkpoint\"", plan && { floorL: plan.floorL, reason: plan.floorReason, cut: cut.floorL });
}
// ── PART E — bounded over a long session ────────────────────────────────────────────────────
{
  const sb = door(); const rs = relays(sb, 400);                   // ~2,000 relays
  const r = run(sb, rs, 40);
  ok(rs.length > 1500 && r.maxHeld <= 41 + 1, "E: across a long session the held log never exceeds one save-point interval", { relays: rs.length, sealed: r.sealed, maxHeld: r.maxHeld });
}
if (failed) { console.log("[bot-move-on] " + failed + " failure(s)"); process.exit(1); }
console.log("[bot-move-on] PASS — a bot room moves on at every new save point (J73 job 7, Q7) and only to one whose seed " +
  "reproduces what it holds in every derived field (Q6): the room stays the reference reader's, a tampered rotation, " +
  "count or setting is refused by name with nothing dropped, the dropped stretch's activity, songs and added times are " +
  "taken first, EventCache banks against the adopted save point, and the held log stays within one interval (" + asserts + " assertions)");
