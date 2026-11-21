// tests/check-sc-frames.js
// SUBJECT: ui/soundcloud.js, ui/songplayer.js, ui/player.js, ui/playlists.js, ui/shell.js
//
// WALL: THE ROOM'S SOUNDCLOUD PLAYER IS MADE ONCE AND REUSED; A PREVIEW'S IS FRESH; THE ROOM'S GOES WHEN THE ROOM IS LEFT
// (`ddjp_714`, replacing `ddjp_710`'s one fresh frame per song). The owner's words: "nice but i did find an issue, in PC when the
// tab is not visible, soundcloud waits for you to come back to play and on phone it even asks for a tap. can we bypass it? its
// really stoping the experience". A fresh frame is a frame that has never played, and Chrome defers its autoplay in a tab that
// is not visible; YouTube's room player, made once and reused, plays on. So the room's box keeps ONE SoundCloud frame from its
// first SoundCloud song, and every song after goes into it through the widget's own `load`. `ddjp_710`'s worry — a hidden frame
// playing on — is the plug's check now (`ui/songplayer.js`; `check-player-check`): a frame stepped aside or held is paused and
// its sound held at 0. Driven through the WHOLE UI — the real `ui/` files, the room's own player (`Player.onPlaybackStateChange`,
// `clearPlayer`, `rebuildPlayer`), the room's leave (`_bgLeaveRoom`) and a song row's preview — over the stand-in `SC.Widget`
// (`tests/_sc-player.js`) and YouTube's (`tests/_player-drive.js`).
//
//   PART A — ONE FRAME IN THE ROOM, ACROSS SOUNDCLOUD → SOUNDCLOUD → YOUTUBE → SOUNDCLOUD: one widget made, at the first
//            SoundCloud song; each later SoundCloud song through `sc-player.load(<its link>, <the look>)`, never two frames; while
//            YouTube shows, SoundCloud's frame hidden, paused and silent (volume 0); shown again, it takes this device's volume.
//   PART B — AFTER A FINISH, NOTHING PLAYS: the song ends and the room holds it — the frame stays, silent; the widget plays a
//            related track by itself — paused again at once, never heard; nothing playing (`clearPlayer`) — paused, kept.
//   PART C — THE ROOM LEFT (`_bgLeaveRoom`), before the widget's READY and after: no SoundCloud frame is left in the page, and
//            nothing plays after — the frame's late events reach nothing, no widget is asked anything, nothing comes back.
//   PART D — THE PREVIEW STAYS FRESH: its own frame, opened on its song; removed when it closes (before READY and after); played
//            again after its end, a FRESH frame for the same song; the room's frame untouched throughout.
//   PART E — AN EARLY END, WITH THE REAL Playback (`ddjp_711`): a SoundCloud song that FINISHes 50 s into the 200 s the room
//            agrees is loaded once more IN THE SAME FRAME (`widget.load`), sought to the room's point on its PLAY; a second early
//            FINISH holds — the frame kept, silent, nothing loaded, the room's waiting cover.
//   PART F — ↻ HELD REBUILDS IT FRESH (`ddjp_712`): the old frame out of the page, a new one opened on the room's song.
//   PART G — THE NEXT SONG INTO THE SAME FRAME IS HEARD (`ddjp_715`), over a stand-in that follows SoundCloud's own `api.js` (a
//            READY handler heard once; the next track's READY reaches only the load's `callback`): the load carries its callback;
//            its READY names the song, "cued", its length declared before it plays; not started by itself, it is started by the
//            check no sooner than 4 s after its load, at the room's point; of two loads at once the latest wins; an earlier
//            track's READY never names the next song; no READY 5 s after a load: a fresh frame, once for the song, one line; a
//            seek asked before ready is the start point; a preview stays as it is. The owner's words, his log at `?v=631`:
//            "then it plays, it often randomly reloads to the start, and i dont see declared lengh in matrix...".
"use strict";
const D = require("./_player-drive.js");
const SCW = require("./_sc-player.js");
const { loadInContext } = require("./_load");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[sc-frames] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const S1 = "sc:artist-one/track-one", S2 = "sc:artist-two/track-two", S3 = "sc:artist-three/track-three", Y1 = "yt:AAAAAAAAAAA";
const LINK = (k) => "https://soundcloud.com/" + k.slice(3);

// A ROOM, BUILT AS A ROOM'S ENTRY BUILDS IT, with both stand-ins writing into one list of calls.
async function room(o) {
  const yt = D.standIn();
  const pending = [];
  const more = Object.assign({}, o || {});
  const tracks = more.tracks || {}; delete more.tracks;
  const sc = SCW.standIn({ calls: yt.calls, later: (fn) => pending.push(fn), tracks });
  const { w, noted } = D.screen(yt, Object.assign({ SC: sc.SC }, more));
  try { w.sb.window.SC = sc.SC; } catch (e) {}
  const logged = [];
  try { w.sb.Logger.on((e) => logged.push(String(e && e.message))); } catch (e) {}
  const drain = () => { for (let i = 0; i < 30 && pending.length; i++) pending.splice(0).forEach((f) => f()); };
  const step = async (ms) => { drain(); await w.advance(ms); drain(); for (let i = 0; i < 2; i++) w.frame(); drain(); };
  const P = w.sb.Player;
  P.initSongPlayer();
  await step(100);
  yt.ready("yt-player");
  await step(1000);
  let pi = 0;
  const np = (key, extra) => Object.assign({ pi: "$p" + (++pi), dj: "@d:hs", song: { songKey: key }, startedAt: w.clock.now - 2000, elapsed: 2, duration: 200 }, extra || {});
  // Every SoundCloud frame in the page, wherever it is (the room's box, a preview's).
  const frames = () => {
    const out = [];
    const walk = (n) => { if (!n) return; if (n.tag === "iframe" && /^sc-/.test(n.id || "")) out.push(n.id); for (const c of (n._kids || [])) walk(c); };
    walk(w.doc.body);
    return out;
  };
  const scCalls = (from) => yt.calls.slice(from).filter((c) => /^(SC\.Widget|sc-)/.test(c));
  // A SoundCloud song up and playing in a frame: its widget READY, then PLAY (what the widget's `auto_play` does).
  const up = async (name) => { sc.fire(name || "sc-player", "READY"); await step(50); sc.fire(name || "sc-player", "PLAY"); await step(300); };
  return { w, yt, sc, noted, logged, step, P, np, frames, scCalls, drain, up };
}
// A preview of a song, opened by its row's picture, as a person opens it.
function openPreview(r, key) {
  const row = r.w.sb.PlaylistPanels.songRow(key, {});
  const all = []; (function walk(x) { all.push(x); for (const c of (x._kids || [])) walk(c); })(row);
  const slot = all.find((x) => x.nodeType === 1 && /\bthumb-slot\b/.test(x.className || ""));
  if (slot && typeof slot.onclick === "function") { slot.onclick(); return true; }
  return false;
}
function previewButton(r, cls) {
  const card = (r.w.doc.body._kids || []).find((x) => /\bpreview-overlay\b/.test(x.className || ""));
  const all = []; if (card) (function walk(x) { all.push(x); for (const c of (x._kids || [])) walk(c); })(card);
  return all.find((x) => x.nodeType === 1 && new RegExp("\\b" + cls + "\\b").test(x.className || "")) || null;
}
// NOTHING PLAYS AFTER: time passes (polls, waits, the check), the removed frame's own late events come (READY, PLAY, FINISH), and
// nothing answers — no widget is made or asked, no frame comes back, the room logs no SoundCloud song playing.
async function nothingAfter(r, name, label) {
  const c = r.yt.calls.length, l = r.logged.length;
  await r.step(3000);
  for (const ev of ["READY", "PLAY", "PLAY_PROGRESS", "FINISH", "ERROR"]) if (r.sc.find(name)) r.sc.fire(name, ev);
  await r.step(1000);
  const asked = r.scCalls(c).filter((x) => !/^→ /.test(x));
  const heard = r.logged.slice(l).filter((x) => /Player: (playing|ended|failed).*sc:/.test(x));
  // Its widget's events unbound too (`ddjp_715`): api.js hears a READY handler once, so a late READY no longer shows a widget left bound.
  const W = r.sc.find(name), bound = W ? Object.keys(W.st.binds).length + W.st.readyOnce.length : 0;
  ok(asked.length === 0 && r.frames().length === 0 && heard.length === 0 && bound === 0,
    label + ": NOTHING PLAYS AFTER — the removed frame's late events reach nothing, its widget's events unbound, no widget is asked anything, no frame comes back",
    { asked, frames: r.frames(), heard, bound });
}
const look = (r) => JSON.stringify(Object.assign({}, r.w.sb.SoundCloudPlayer.LOOK));

(async () => {
  // ═══ PART A — one frame in the room, across SoundCloud → SoundCloud → YouTube → SoundCloud ═══
  {
    const r = await room();
    const box = r.w.refs.player;
    const counts = [];
    const live = () => (box._kids || []).filter((c) => c.tag === "iframe" && c.id === "sc-player").length;
    const add = box.appendChild.bind(box), rem = box.removeChild.bind(box);
    box.appendChild = (c) => { const v = add(c); counts.push("+" + live()); return v; };
    box.removeChild = (c) => { const v = rem(c); counts.push("-" + live()); return v; };
    const c0 = r.yt.calls.length;
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const first = r.sc.find("sc-player");
    r.P.onPlaybackStateChange(r.np(S2)); await r.step(300); await r.up();
    const cY = r.yt.calls.length;
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); r.yt.state("yt-player", 1); await r.step(2500);
    const whileYT = r.scCalls(cY).filter((x) => !/^→ /.test(x));
    const hiddenThen = ((box._kids || []).find((c) => c.id === "sc-player") || { style: {} }).style.display;
    const cS = r.yt.calls.length;
    r.P.onPlaybackStateChange(r.np(S3)); await r.step(300); await r.up();
    const back = r.scCalls(cS).filter((x) => !/^→ /.test(x));
    const opened = r.scCalls(c0).filter((x) => /^SC\.Widget /.test(x));
    const loads = r.scCalls(c0).filter((x) => /^sc-player\.load\(/.test(x));
    const most = Math.max(0, ...counts.map((c) => Number(c.slice(1))));
    ok(JSON.stringify(opened) === JSON.stringify(["SC.Widget sc-player " + LINK(S1)]) && r.sc.made.length === 1 && r.sc.find("sc-player") === first &&
      JSON.stringify(loads) === JSON.stringify([S2, S3].map((k) => 'sc-player.load("' + LINK(k) + '",' + look(r) + ')')) && most === 1 && live() === 1 &&
      counts.filter((c) => c[0] === "-").length === 0,
      "A — ONE FRAME IN THE ROOM ACROSS SOUNDCLOUD → SOUNDCLOUD → YOUTUBE → SOUNDCLOUD: one widget, made at the first SoundCloud song; the " +
      "second and the last through the widget's own `load` on their links, with the look; never two frames, none removed", { opened, loads, counts });
    ok(whileYT.indexOf("sc-player.pause()") >= 0 && whileYT.indexOf("sc-player.setVolume(0)") >= 0 &&
      whileYT.filter((x) => /^sc-player\.(play|load|seekTo)\(|^sc-player\.setVolume\([1-9]/.test(x)).length === 0 && hiddenThen === "none",
      "A — WHILE YOUTUBE SHOWS, SOUNDCLOUD'S FRAME IS HIDDEN, PAUSED AND SILENT (volume 0), and nothing plays it", whileYT);
    ok(back.indexOf("sc-player.setVolume(70)") >= 0 && back.indexOf("sc-player.setVolume(70)") > back.findIndex((x) => /^sc-player\.load\(/.test(x)),
      "A — SHOWN AGAIN, IT TAKES THIS DEVICE'S VOLUME (70) with its next song", back);
  }

  // ═══ PART B — after a FINISH, nothing plays ═══
  {
    const r = await room();
    const n1 = r.np(S1);
    r.P.onPlaybackStateChange(n1); await r.step(300); await r.up();
    const c0 = r.yt.calls.length, l0 = r.logged.length;
    r.sc.fire("sc-player", "FINISH"); await r.step(100);
    r.P.onPlaybackStateChange(Object.assign({}, n1, { ended: true })); await r.step(300);
    const held = r.scCalls(c0).filter((x) => !/^→ /.test(x));
    ok(JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && held.indexOf("sc-player.setVolume(0)") >= 0,
      "B — ITS SONG ENDS AND THE ROOM HOLDS IT: the frame stays, and its sound is 0", { frames: r.frames(), calls: held });
    // The widget plays a related track by itself (SoundCloud's own next sound, `hide_related` ignored).
    const W = r.sc.find("sc-player");
    W.st.url = "https://soundcloud.com/someone-else/a-related-track";
    const c1 = r.yt.calls.length;
    r.sc.fire("sc-player", "PLAY"); await r.step(2500);
    const after = r.scCalls(c1).filter((x) => !/^→ /.test(x));
    // The room hears no play of it (the frame was stopped by the box: its PLAY paused again at once, never reported), and loads nothing.
    const heard = r.logged.slice(l0).filter((x) => /^Player: playing |reason=corrected/.test(x));
    ok(after.indexOf("sc-player.pause()") === 0 && after.filter((x) => /^sc-player\.(play|load)\(|^sc-player\.setVolume\([1-9]/.test(x)).length === 0 &&
      heard.length === 0 && W.st.paused === true && W.st.vol === 0,
      "B — A RELATED TRACK PLAYED BY THE WIDGET ITSELF AFTER THE FINISH IS PAUSED AT ONCE, SILENT, AND NOTHING IS LOADED FOR IT — the room's " +
      "song is held", { after, heard, paused: W.st.paused, vol: W.st.vol });
    // Nothing playing: the frame paused and kept.
    const r2 = await room();
    r2.P.onPlaybackStateChange(r2.np(S1)); await r2.step(300); await r2.up();
    const c2 = r2.yt.calls.length;
    r2.P.onPlaybackStateChange(null); await r2.step(300);
    ok(JSON.stringify(r2.frames()) === JSON.stringify(["sc-player"]) && r2.scCalls(c2).indexOf("sc-player.pause()") >= 0,
      "B — NOTHING PLAYING (`clearPlayer`): the frame paused, and kept for the next song", { frames: r2.frames(), calls: r2.scCalls(c2) });
  }

  // ═══ PART C — the room left: its frame gone (before READY and after) ═══
  for (const ready of [false, true]) {
    const when = ready ? "after READY" : "before READY";
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300);
    if (ready) await r.up();
    ok(JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]), "C PREMISE — the room's SoundCloud song has its one frame (" + when + ")", r.frames());
    let threw = null;
    try { r.w.H._bgLeaveRoom(); } catch (e) { threw = e && e.message; }
    await r.step(300);
    ok(!threw && r.frames().length === 0, "C — THE ROOM IS LEFT (`_bgLeaveRoom`, " + when + "): SoundCloud's frame goes out of the page", { threw, frames: r.frames() });
    await nothingAfter(r, "sc-player", "C — after leaving the room, " + when);
  }

  // ═══ PART D — the preview stays fresh ═══
  for (const ready of [false, true]) {
    const when = ready ? "after READY" : "before READY";
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const roomFrame = r.sc.find("sc-player");
    const opened = openPreview(r, S2); await r.step(200);
    ok(opened && JSON.stringify(r.frames().sort()) === JSON.stringify(["sc-player", "sc-preview-player"]) && r.sc.find("sc-preview-player") !== roomFrame,
      "D PREMISE — a SoundCloud preview opened over the room's SoundCloud song: its own fresh frame beside the room's (" + when + ")", r.frames());
    if (ready) await r.up("sc-preview-player");
    const x = previewButton(r, "preview-x");
    if (x) x.onclick();
    await r.step(500);
    ok(!!x && JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && r.sc.find("sc-player") === roomFrame,
      "D — THE PREVIEW CLOSES (" + when + "): its frame gone, the room's frame where it was", r.frames());
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); r.yt.state("yt-player", 1); await r.step(300);
    openPreview(r, S2); await r.step(200);
    await r.up("sc-preview-player");
    const first = r.sc.find("sc-preview-player");
    r.sc.fire("sc-preview-player", "FINISH"); await r.step(300);
    ok(r.frames().length === 0, "D — THE PREVIEW'S SONG ENDS: its frame gone (a preview is fresh, as `ddjp_710` made it)", r.frames());
    const play = previewButton(r, "pv-play");
    const c = r.yt.calls.length;
    if (play) play.onclick();
    await r.step(300);
    const again = r.yt.calls.slice(c).filter((y) => /^SC\.Widget sc-preview-player /.test(y));
    ok(!!play && JSON.stringify(again) === JSON.stringify(["SC.Widget sc-preview-player " + LINK(S2)]) && r.sc.find("sc-preview-player") !== first &&
      JSON.stringify(r.frames()) === JSON.stringify(["sc-preview-player"]),
      "D — PLAYED AGAIN AFTER ITS END: a FRESH frame for the same song, one only", { again, frames: r.frames() });
    await r.up("sc-preview-player");
    const x = previewButton(r, "preview-x"); if (x) x.onclick(); await r.step(300);
    ok(r.frames().length === 0, "D — and closed, it is gone too", r.frames());
    await nothingAfter(r, "sc-preview-player", "D — after the preview closes");
  }

  // ═══ PART E — an early end: the same frame at the room's point, then the hold ═══
  {
    const clockRef = { now: () => 0 };
    const st = { nowPlaying: null, rotation: [], settings: { graceMs: 1000, maxLen: 600 }, advance: null };
    const PB = loadInContext(["features/playback.js"], {
      Date: { now: () => clockRef.now() }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
      StreamManager: { getState: () => st, on() {}, off() {} },
      ServerClock: { serverNow: () => clockRef.now(), elapsedSince: (ts) => clockRef.now() - ts },
      MatrixBridge: { mayAdvance: () => ({ ok: true }), sendEvent: async () => ({}) },
      Capabilities: { staggerMs: () => 0, rankNameOf: () => "owner" },
      Logger: { info() {}, warn() {}, debug() {}, error() {} },
    }).Playback;
    const r = await room({ Playback: PB });
    clockRef.now = () => r.w.clock.now;
    PB.initWiring("!ev:hs");
    PB.onStateChange((n) => { if (n) r.P.onPlaybackStateChange(n); });
    const np = { pi: "$early1", dj: "@d:hs", song: { songKey: S1 }, startedAt: r.w.clock.now - 50000, settings: st.settings };
    st.nowPlaying = np;
    st.advance = { pi: "$early1", gateLenSec: 200, earliestAt: np.startedAt + 199000, endsAt: np.startedAt + 200000 };
    r.P.onPlaybackStateChange(np); await r.step(300);
    await r.up();
    const first = r.sc.find("sc-player");
    const c0 = r.yt.calls.length;
    r.sc.fire("sc-player", "FINISH"); await r.step(300);
    const opened = r.scCalls(c0).filter((x) => /^SC\.Widget /.test(x));
    const loads = r.scCalls(c0).filter((x) => /^sc-player\.load\(/.test(x));
    ok(JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && r.sc.find("sc-player") === first && opened.length === 0 &&
      JSON.stringify(loads) === JSON.stringify(['sc-player.load("' + LINK(S1) + '",' + look(r) + ')']),
      "E — A SOUNDCLOUD SONG THAT FINISHES EARLY (50 s into 200) IS LOADED ONCE MORE, IN THE SAME FRAME (the widget's own `load`)", { frames: r.frames(), opened, loads });
    const c1 = r.yt.calls.length;
    await r.up();
    const seeks = r.scCalls(c1).filter((x) => /^sc-player\.seekTo\(/.test(x)).map((x) => Number((x.match(/\((\d+)/) || [])[1]));
    ok(seeks.length >= 1 && seeks[0] >= 50000 && seeks[0] <= 52000, "E — AT THE ROOM'S POINT: on its PLAY the frame is sought to about 50 s", seeks);
    const c2 = r.yt.calls.length;
    r.sc.fire("sc-player", "FINISH"); await r.step(3000);
    const after = r.scCalls(c2).filter((x) => !/^→ /.test(x));
    const cover = r.w.refs && r.w.refs.playerShield ? r.w.refs.playerShield : null;
    ok(JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && after.filter((x) => /^SC\.Widget |^sc-player\.(load|play)\(/.test(x)).length === 0 &&
      after.indexOf("sc-player.setVolume(0)") >= 0,
      "E — A SECOND EARLY FINISH HOLDS: the frame kept, silent, nothing loaded or played", { frames: r.frames(), after });
    const said = cover ? JSON.stringify((cover._kids || []).map((k) => k.textContent)) : "";
    ok(!!cover && cover.style.display === "block" && /Waiting for the next song/.test(said),
      "E — and the room's waiting cover is up", { cover: !!cover, display: cover && cover.style.display, said });
  }

  // ═══ PART F — ↻ held rebuilds it fresh ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const old = r.sc.find("sc-player");
    const c0 = r.yt.calls.length;
    r.P.rebuildPlayer(); await r.step(700);
    const opened = r.scCalls(c0).filter((x) => /^SC\.Widget /.test(x));
    ok(JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && r.sc.find("sc-player") !== old && Object.keys(old.st.binds).length === 0 &&
      JSON.stringify(opened) === JSON.stringify(["SC.Widget sc-player " + LINK(S1)]),
      "F — ↻ HELD REBUILDS IT FRESH: the old frame out of the page (its events unbound), a new frame opened on the room's song", { frames: r.frames(), opened });
  }

  // ═══ PART G — the next song into the same frame is heard (`ddjp_715`) ═══
  const S3K = "sc:artist-three/track-three";
  const lensSince = (r, n0) => r.noted.slice(n0).filter((x) => /^setDuration /.test(x));
  const cuedSince = (r, l0) => r.logged.slice(l0).filter((x) => /^Player: cued sc:/.test(x)).map((x) => x.split(" ")[2]);
  {
    // PREMISE — the stand-in follows SoundCloud's api.js (`tests/_sc-player.js`, rules 1–2), or every row below agrees with a belief.
    const calls = [], q = [];
    const sc = SCW.standIn({ calls, later: (f) => q.push(f) });
    const el = { id: "sc-premise", attrs: { src: "https://w.soundcloud.com/player/?url=" + encodeURIComponent(LINK(S1)) },
      getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } };
    const W = sc.SC.Widget(el);
    let heard = 0, called = 0;
    W.bind("ready", () => heard++);
    sc.fire("sc-premise", "READY"); sc.fire("sc-premise", "READY"); q.splice(0).forEach((f) => f());
    W.load(LINK(S2), { callback: () => called++ });
    sc.fire("sc-premise", "READY"); q.splice(0).forEach((f) => f());
    ok(heard === 1 && called === 1, "G PREMISE — THE STAND-IN FOLLOWS SOUNDCLOUD'S api.js: a READY handler is heard once (three READYs, one call), " +
      "and the next track's READY reaches only its load's callback", { heard, called });
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    await r.step(5000);   // the first song's own start, if the check gave one, well behind (RETRY_MS)
    const W = r.sc.find("sc-player");
    const l0 = r.logged.length, n0 = r.noted.length;
    r.P.onPlaybackStateChange(r.np(S2)); await r.step(300);
    const asked = W.st.asked.slice(-1)[0] || {};
    r.sc.fire("sc-player", "READY"); await r.step(500);
    const lens = lensSince(r, n0), cued = cuedSince(r, l0);
    const playedYet = r.logged.slice(l0).filter((x) => /^Player: playing .*sc:artist-two/.test(x));
    ok(typeof asked.callback === "function" && asked.url === LINK(S2) && JSON.stringify(cued) === JSON.stringify([S2]) &&
      JSON.stringify(lens) === JSON.stringify(["setDuration " + S2 + " 215.3"]) && playedYet.length === 0,
      "G — THE NEXT SONG INTO THE SAME FRAME IS HEARD: its load carries a callback, its READY reaches it through that callback, the box reads " +
      "it \"cued\", and its length (215.3 s) is declared before it plays", { callback: typeof asked.callback, url: asked.url, cued, lens, playedYet });
    const c1 = r.yt.calls.length;
    await r.step(2000);
    const early = r.scCalls(c1).filter((x) => /^sc-player\.(play|seekTo)\(/.test(x));
    await r.step(4000);
    const started = r.scCalls(c1).filter((x) => /^sc-player\.(play|seekTo)\(/.test(x));
    const sought = started.length ? Number((started[0].match(/\((\d+)/) || [])[1]) : -1;
    const line = r.logged.slice(l0).filter((x) => x === "Player: corrected sc — loaded and not started while shown, the room playing " + S2);
    const playing = r.logged.slice(l0).filter((x) => /^Player: playing pi=\S+ sc:artist-two\/track-two /.test(x));
    ok(early.length === 0 && started.length >= 2 && /^sc-player\.seekTo\(/.test(started[0]) && started[1] === "sc-player.play()" &&
      sought >= 5000 && sought <= 10000 && line.length === 1 && playing.length === 1,
      "G — NOT STARTED BY ITSELF, IT IS STARTED: by the check, no sooner than 4 s after its load, sought to the room's point (5–10 s) and played, " +
      "with one line — and it plays", { early, started, line, playing });
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const l0 = r.logged.length, n0 = r.noted.length, c0 = r.yt.calls.length;
    r.P.onPlaybackStateChange(r.np(S2)); await r.step(150);
    r.P.onPlaybackStateChange(r.np(S3K)); await r.step(150);
    r.sc.fire("sc-player", "READY"); await r.step(500);
    const loads = r.scCalls(c0).filter((x) => /^sc-player\.load\(/.test(x)).length;
    ok(loads === 2 && JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && JSON.stringify(cuedSince(r, l0)) === JSON.stringify([S3K]) &&
      JSON.stringify(lensSince(r, n0)) === JSON.stringify(["setDuration " + S3K + " 215.3"]),
      "G — TWO LOADS AT ONCE (two accounts sending the next play together, as at `?v=631`): the latest wins — one frame, the box names the " +
      "last song alone, and its length alone is declared", { loads, frames: r.frames(), cued: cuedSince(r, l0), lens: lensSince(r, n0) });
  }
  {
    const r = await room({ tracks: { [LINK(S2)]: { durationMs: 100000 } } });
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const l0 = r.logged.length, n0 = r.noted.length;
    r.P.onPlaybackStateChange(r.np(S2)); await r.step(150);
    r.P.onPlaybackStateChange(r.np(S3K)); await r.step(150);
    r.sc.staleReady("sc-player"); await r.step(500);
    const early = { cued: cuedSince(r, l0), lens: lensSince(r, n0) };
    r.sc.fire("sc-player", "READY"); await r.step(500);
    ok(early.cued.length === 0 && early.lens.length === 0 && JSON.stringify(lensSince(r, n0)) === JSON.stringify(["setDuration " + S3K + " 215.3"]),
      "G — AN EARLIER TRACK'S READY NEVER NAMES THE NEXT SONG: the page before posts its READY after the next load was asked (its 100 s track " +
      "still answering) — nothing named, no length; the latest track's own READY names it, with its own length (215.3 s)", { early, after: lensSince(r, n0) });
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const first = r.sc.find("sc-player");
    const l0 = r.logged.length, c0 = r.yt.calls.length;
    r.P.onPlaybackStateChange(r.np(S2)); await r.step(300);
    await r.step(4000);
    const before = r.scCalls(c0).filter((x) => /^SC\.Widget /.test(x));
    await r.step(1500);
    const opened = r.scCalls(c0).filter((x) => /^SC\.Widget /.test(x));
    const FRESH = /^SoundCloud: no ready 5 s after loading sc:artist-two\/track-two — its frame replaced by a fresh one, at (\d+\.\d) s \(once for this song\)$/;
    const said = r.logged.slice(l0).filter((x) => FRESH.test(x));
    const at = said.length ? Number(said[0].match(FRESH)[1]) : -1;
    ok(before.length === 0 && JSON.stringify(opened) === JSON.stringify(["SC.Widget sc-player " + LINK(S2)]) && r.sc.find("sc-player") !== first &&
      JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]) && said.length === 1 && at >= 6 && at <= 9,
      "G — NO READY 5 s AFTER ITS LOAD: its frame replaced by a fresh one for the same song, at the room's point (about 7 s), with one line",
      { before, opened, frames: r.frames(), said });
    await r.step(8000);
    const again = r.scCalls(c0).filter((x) => /^SC\.Widget /.test(x));
    const saidAgain = r.logged.slice(l0).filter((x) => /^SoundCloud: no ready/.test(x));
    ok(again.length === 1 && saidAgain.length === 1 && JSON.stringify(r.frames()) === JSON.stringify(["sc-player"]),
      "G — ONCE FOR THE SONG, NEVER A LOOP: 8 s more with no READY, no second fresh frame and no second line", { again, saidAgain });
    r.sc.fire("sc-player", "READY"); await r.step(500); r.sc.fire("sc-player", "PLAY"); await r.step(500);
    ok(r.logged.slice(l0).filter((x) => /^Player: playing pi=\S+ sc:artist-two\/track-two /.test(x)).length === 1,
      "G — and the fresh frame up, the song plays", r.logged.slice(l0).filter((x) => /^Player: /.test(x)));
  }
  {
    const r = await room();
    const box = r.w.doc.createElement("div"); box.id = "seekbox"; r.w.doc.body.appendChild(box);
    const h = r.w.sb.SoundCloudPlayer.make(box, { startMuted: true }, {});
    h.show(true); h.load("artist-two/track-two", 0); await r.step(200);
    const c0 = r.yt.calls.length;
    h.seek(30); await r.step(200);
    const before = { t: h.time(), seeks: r.scCalls(c0).filter((x) => /^sc-seekbox\.seekTo\(/.test(x)) };
    r.sc.fire("sc-seekbox", "READY"); await r.step(100); r.sc.fire("sc-seekbox", "PLAY"); await r.step(300);
    const after = r.scCalls(c0).filter((x) => /^sc-seekbox\.seekTo\(/.test(x));
    ok(before.t === 0 && before.seeks.length === 0 && after.indexOf("sc-seekbox.seekTo(30000)") >= 0,
      "G — A SEEK ASKED BEFORE READY IS THE START POINT: nothing sent and the copy not moved (0 s), then on its PLAY the widget is sought to 30 s",
      { before, after });
    h.destroy();
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); r.yt.state("yt-player", 1); await r.step(300);
    const c0 = r.yt.calls.length, l0 = r.logged.length;
    openPreview(r, S2); await r.step(6500);
    const opened = r.scCalls(c0).filter((x) => /^SC\.Widget sc-preview-player /.test(x));
    ok(opened.length === 1 && r.logged.slice(l0).filter((x) => /^SoundCloud: no ready/.test(x)).length === 0,
      "G — A PREVIEW STAYS AS IT IS: 6.5 s with no READY, its one frame kept — no fresh one, no line", { opened });
  }

  if (failed) { console.log("[sc-frames] " + failed + " failure(s)"); process.exit(1); }
  console.log("[sc-frames] PASS — the room's SoundCloud player is made once and reused, a preview's is fresh (" + asserts + " assertions): " +
    "A SoundCloud → SoundCloud → YouTube → SoundCloud is one frame, each later song through the widget's own `load`, hidden, paused and " +
    "silent while YouTube shows, this device's volume again when shown; B after a FINISH the held frame is silent, a related track the " +
    "widget plays by itself is paused at once and nothing is loaded for it, and nothing playing pauses it; C leaving the room takes the " +
    "frame out of the page, before READY and after, and nothing answers after; D a preview opens its own fresh frame, gone when it closes " +
    "or its song ends, and played again opens afresh; E with the real Playback an early end loads once more in the same frame at the " +
    "room's point and a second holds, silent; F ↻ held rebuilds it fresh; G the next song into the same frame is heard through its load's " +
    "callback — \"cued\" and its length declared before it plays, started by the check 4 s after its load at the room's point, the latest " +
    "of two loads winning, an earlier track's READY naming nothing, a fresh frame once after 5 s with no READY, a seek before ready the start " +
    "point, and a preview as it was");
})().catch((e) => { console.log("[sc-frames] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
