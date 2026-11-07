// tests/_reopen.js
// THE OWNER'S `?v=540` REOPEN, AS A WORLD — a harness, not a guard (no `check-` prefix, so `run-all` does not run it). Moved
// out of `check-move-on-base.js` at J94 so `check-short-base-readers` drives the SAME story rather than a second copy of it
// (the `_botroom.js` precedent: two doubles of one room is the copied-rule shape, one level out). With no options, `story()`
// builds exactly what it built inside that guard.
//
// THE STORY: save points n=1..n=7 sealed by two tabs (the owner's and @admin's), n=2's boundary a settings change, which the
// settings channel carries; the owner's tab reloads with its events channel the slow one, so the save points and settings are
// in first — it trims at n=2, follows n=3..n=7 without their boundaries, and sets the events between aside; then @admin plays.
//   `o.joinInStretch` (J94) — that account joins the rotation in the last round, inside the stretch the reload sets aside.
//   `o.earlyVote` (J95) — that account votes once, on the first round's play: an act early inside that stretch.
"use strict";
const path = require("path");
const B = require(path.join(__dirname, "_botroom.js"));

const settle = (ms) => new Promise((r) => setTimeout(r, ms || 20));
const CH = B.FULL_CH, MIN = 60000;

// ONE ROOM: its homeserver, its clock, its positions, and its tabs (each delivered to by hand). `check-save-point-race`'s room.
function room() {
  const R = { server: {}, now: 1792447900000, L: 0, N: 0, tabs: [] };
  R.tab = (me, o) => {
    o = o || {};
    const w = B.world(Object.assign({ mode: "backend1", me: me, server: R.server, order: B.ORDER, fanOut: true, timers: true, extras: {
      ServerClock: { serverNow: () => R.now, init() {}, destroy() {} },
      Store: { history: { load: async () => (o.stored ? JSON.parse(JSON.stringify(o.stored)) : null), persist() {} }, config: { saveRoom() {} } } } }, o.w || {}));
    w.sb.MatrixBridge.onRawEvent = w.sb.B1MatrixBridge.onRawEvent;
    w.head = () => { const np = w.sb.StreamManager.getState().nowPlaying; return np ? np.pi : null; };
    w.rows = () => w.sb.History.recent().map((r) => r.pi + "|" + r.videoId + "@" + r.l).sort();
    w.said = (re, from) => w.logs.slice(from || 0).filter((m) => re.test(m));
    if (!o.detached) R.tabs.push(w);
    return w;
  };
  R.raw = (sender, body, o) => {
    o = o || {}; R.now += (o.dt !== undefined ? o.dt : 1000);
    const l = (o.l !== undefined) ? o.l : ++R.L; if (l > R.L) R.L = l;
    return { event_id: "$" + (o.id || ("e" + String(++R.N).padStart(3, "0"))), type: "m.room.message",
      room_id: body.t === "ddjp.room.settings" ? CH.settings_owner : CH.events_owner, sender: sender, origin_server_ts: R.now,
      content: { msgtype: "m.text", body: JSON.stringify(Object.assign({}, body, { l: l })) } };
  };
  R.store = (r) => { (R.server[r.room_id] = R.server[r.room_id] || []).push(r); return r; };
  R.to = (r, ws) => { for (const w of ws) w.deliver(r, 99); return r; };
  R.put = (s, b, o) => R.to(R.store(R.raw(s, b, o)), R.tabs);
  R.post = (w, body) => R.to(R.store({ event_id: "$" + w.me.slice(1, w.me.indexOf(":")) + "-cp" + (++R.N), type: "m.room.message", room_id: CH.checkpoints_owner,
    sender: w.me, origin_server_ts: (R.now += 500), content: { body: JSON.stringify(Object.assign({}, body, { l: ++R.L })) } }), R.tabs);
  // A seal by `w`, as `Checkpoint.seal` makes it, posted at the next position to every tab.
  R.seal = async (w) => {
    const before = w.sent.length; await w.sb.Checkpoint.seal();
    const cp = w.sent.slice(before).filter((s) => s.t === "ddjp.checkpoint")[0];
    if (cp) R.post(w, cp.body);
    await settle();
    return cp ? cp.body : null;
  };
  R.lOf = (r) => JSON.parse(r.content.body).l;
  return R;
}

// THE OWNER'S STORY up to the live play (see the header).
async function story(o) {
  o = o || {};
  const R = room();
  const O = R.tab(B.OWNER), G = R.tab(B.ADMIN);
  for (const w of [O, G]) await w.open();
  const S0 = Object.assign(O.sb.StateDeriver.defaultSettings(), { checkpointCooldownMs: 0 });
  R.put(B.OWNER, { t: "ddjp.room.settings", s: S0 });
  let prev = null, k = 0;
  const song = () => "vid" + String(++k).padStart(8, "0");
  for (const u of [B.OWNER, B.ADMIN]) { R.put(u, { t: "ddjp.dj.join", v: song() }); R.put(u, { t: "ddjp.dj.join", v: song() }); }
  R.now += 5 * MIN; prev = R.put(B.OWNER, { t: "ddjp.dj.play", p: prev }).event_id;
  const cps = [await R.seal(O)];
  const setB = R.put(B.OWNER, { t: "ddjp.room.settings", s: Object.assign({}, S0, { maxSongLengthMs: 600000 }) });   // n=2's boundary
  cps.push(await R.seal(G));
  let joined = null;
  for (let r = 0; r < 5; r++) {
    R.now += 5 * MIN;
    prev = R.put(r % 2 ? B.ADMIN : B.OWNER, { t: "ddjp.dj.play", p: prev }).event_id;
    for (let i = 0; i < 14; i++) R.put(B.STAFF, { t: "ddjp.dj.vote", p: prev });
    if (o.earlyVote && r === 0) R.put(o.earlyVote, { t: "ddjp.dj.vote", p: prev });
    R.put(r % 2 ? B.OWNER : B.ADMIN, { t: "ddjp.dj.join", v: song() });
    if (o.joinInStretch && r === 4) joined = R.put(o.joinInStretch, { t: "ddjp.dj.join", v: song() });
    cps.push(await R.seal(r % 2 ? G : O));
  }
  // THE RELOAD: the owner's tab, with its raw cache and song table, replaying until `open()`; its events channel pages slowly,
  // so the settings and save-point channels are in first — the order a long room's reopen has.
  O.sb.MatrixBridge.persistHistoryNow();
  const T = R.tab(B.OWNER, { detached: true, stored: O.stored.snap, w: { opened: false, cache: O.sb.EventCache.values() } });
  const sb0 = T.client.scrollback;
  T.client.scrollback = async (rm, n) => { if (rm.roomId === CH.events_owner) await settle(30); return sb0(rm, n); };
  await T.open();
  R.tabs.splice(R.tabs.indexOf(O), 1, T);   // the reloaded tab is the owner's tab now
  const reopen = T.logs.slice();
  R.now += 5 * MIN;
  const at = T.logs.length;
  const play = R.put(B.ADMIN, { t: "ddjp.dj.play", p: prev });
  return { R, T, G, cps, prev, play, reopen, at, setB, joined };
}

module.exports = { settle, CH, MIN, room, story };
