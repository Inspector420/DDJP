// tests/check-player-check.js
// SUBJECT: ui/songplayer.js, ui/soundcloud.js, ui/youtube.js, ui/player.js
//
// WALL: EVERY PLAYER IS KEPT TO WHAT THE ROOM SAYS, ALWAYS (`ddjp_714`; the owner's words: "ok just make sure we handle what its
// doing always like we mute it when needed, we unmute when needed and we also send the right songs at right time always").
// The plug's CHECK (`ui/songplayer.js` `check`), given what the room's player should be by `ui/player.js` (`_wantOf`) at every
// push, every player event and every 2 s, reads each player's own readings and fixes what differs — each fix in ONE log line,
// `Player: corrected <service> — <what was wrong>`, and nothing logged while all is right. Driven through the WHOLE UI — the
// real `ui/` files, the room's own player — over the stand-in `SC.Widget` (`tests/_sc-player.js`) and `YT.Player`
// (`tests/_player-drive.js`). Each wrong thing is made to happen INSIDE A STAND-IN, as the player itself would do it (no event,
// or only the player's own), and is shown fixed by the next check, with its line; a check after that finds it right and says
// nothing more.
//
//   PART A — QUIET WHEN ALL IS RIGHT: a room through a SoundCloud song, a YouTube song and their switches, ten seconds of checks
//            each: no correction, no line.
//   PART B — A HIDDEN PLAYER STARTS PLAYING: YouTube's behind SoundCloud's, SoundCloud's behind YouTube's — paused, its line;
//            and a held player (its song over, the room holding it) that starts — paused, its line.
//   PART C — THE WIDGET LOADS ANOTHER TRACK BY ITSELF while its song plays: the room's song loaded again into the same frame, at
//            the room's point, its line.
//   PART D — THE VOLUME CHANGED INSIDE A FRAME: inside a hidden one, or a held one — its sound back to 0, its line, this device's volume
//            untouched; inside a shown one (SoundCloud's, YouTube's) — the person's choice, now this device's (the slider follows),
//            with its own line and no correction.
//   PART E — A SHOWN PLAYER PAUSES BY ITSELF (YouTube's, SoundCloud's): played again, its line.
//   PART F — THE WRONG SONG IS LOADED (YouTube's player showing another video): the room's song loaded at the room's point, its line.
//   PART G — A DRIFT OVER 10 s: a seek to the room's point, its line; never past the player's length less 1 s.
//   PART H — YOUTUBE'S OWN MUTE AT A LOAD IS NOT THE PERSON'S CHOICE (`ddjp_715`; his log at `?v=631`: "volume from yt — 100, muted"
//            30 ms after a load): read before its load plays, it changes nothing of this device's volume and says no "volume from".
//   PART I — THE TAB HIDDEN AND SHOWN, IN THE LOG (`ddjp_715`): `Player: tab hidden`, `Player: tab shown (hidden 4m12s)`; nothing
//            once the room is left.
"use strict";
const D = require("./_player-drive.js");
const SCW = require("./_sc-player.js");

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[player-check] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}
const S1 = "sc:artist-one/track-one", Y1 = "yt:AAAAAAAAAAA", Y2 = "yt:BBBBBBBBBBB";
const LINK = (k) => "https://soundcloud.com/" + k.slice(3);
const CORRECTED = /^Player: corrected /;

// THE PREMISE, BY NAME: the plug has the check, and the room's player gives it a want.
{
  const fs = require("fs"), path = require("path");
  const plug = fs.readFileSync(path.join(__dirname, "..", "ui/songplayer.js"), "utf8");
  const room = fs.readFileSync(path.join(__dirname, "..", "ui/player.js"), "utf8");
  // Said, and the drive goes on: each part then shows what a tree without the check does with the same wrong thing.
  ok(plug.indexOf("bp.check = function") >= 0 && room.indexOf("function _wantOf(") >= 0,
    "PREMISE — the plug's check (`bp.check`) and the room's want (`_wantOf`) are in this tree (`ddjp_714`)");
}

// A ROOM, BUILT AS A ROOM'S ENTRY BUILDS IT (this device's volume 70), with both stand-ins writing into one list of calls.
async function room() {
  const yt = D.standIn();
  const pending = [];
  const sc = SCW.standIn({ calls: yt.calls, later: (fn) => pending.push(fn) });
  const { w, noted, prefs } = D.screen(yt, { SC: sc.SC });
  try { w.sb.window.SC = sc.SC; } catch (e) {}
  const logged = [];
  try { w.sb.Logger.on((e) => logged.push(String(e && e.message))); } catch (e) {}
  const drain = () => { for (let i = 0; i < 30 && pending.length; i++) pending.splice(0).forEach((f) => f()); };
  // Time passes as it does for a player that plays: a playing YouTube player's time and a playing widget's position move with
  // the clock (the stand-ins hold still on their own), so the room's point and theirs agree while nothing is wrong.
  const flow = (ms) => {
    try { const y = yt.find("yt-player"); if (y && y.st.state === 1) y.st.t += ms / 1000; } catch (e) {}
    try { const m = sc.find("sc-player"); if (m && !m.st.paused) m.st.ms += ms; } catch (e) {}
  };
  const step = async (ms) => {
    for (let left = ms; left > 0; left -= 100) { const d = Math.min(100, left); drain(); await w.advance(d); flow(d); drain(); for (let i = 0; i < 2; i++) w.frame(); drain(); }
  };
  const P = w.sb.Player;
  P.initSongPlayer();
  await step(100);
  yt.ready("yt-player");
  await step(1000);
  let pi = 0;
  const np = (key, extra) => Object.assign({ pi: "$p" + (++pi), dj: "@d:hs", song: { songKey: key }, startedAt: w.clock.now - 20000, elapsed: 20, duration: 200 }, extra || {});
  const up = async () => { sc.fire("sc-player", "READY"); await step(50); sc.fire("sc-player", "PLAY"); await step(400); };
  const ytUp = async () => { yt.state("yt-player", 3); await step(200); yt.state("yt-player", 1); await step(400); };
  const Y = () => yt.find("yt-player"), S = () => sc.find("sc-player");
  // What the players were told to DO since a mark, and the corrections logged since another.
  // This device's volume put back by the room on its own (1 s after a load, at each "playing": `applyVolumeState`, as ever) is the
  // room's, not a correction: left out.
  const ROUTINE = new Set(["yt-player.setVolume(70)", "yt-player.unMute()", "sc-player.setVolume(70)"]);
  const acts = (from) => yt.calls.slice(from).filter((c) => !/^→ |^[\w-]+\.(get\w+|isMuted)\(/.test(c) && !ROUTINE.has(c));
  const lines = (from) => logged.slice(from).filter((x) => CORRECTED.test(x));
  return { w, yt, sc, noted, prefs, logged, step, P, np, up, ytUp, Y, S, acts, lines };
}
// ONE WRONG THING: done inside a stand-in, then up to one check's time (2 s, the room's timer — and for SoundCloud its poll and
// its answers); the fix and its line are what came; then a second period, which must bring no fix and no line (all right again).
async function wrong(r, doIt, ms) {
  await r.step(1500);   // settled: what the room does after a load or a "playing" has come and gone
  const c0 = r.yt.calls.length, l0 = r.logged.length;
  doIt();
  await r.step(ms || 2600);
  const fix = r.acts(c0), said = r.lines(l0);
  const c1 = r.yt.calls.length, l1 = r.logged.length;
  await r.step(4500);
  return { fix, said, after: r.acts(c1), saidAfter: r.lines(l1), all: r.logged.slice(l0) };
}

(async () => {
  // ═══ PART A — quiet when all is right ═══
  {
    const r = await room();
    const c0 = r.yt.calls.length, l0 = r.logged.length;
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    await r.step(12000);
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    await r.step(12000);
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    await r.step(12000);
    // And through the room's holds: each song ended and held, then the next — SoundCloud after YouTube and after itself.
    for (const k of [Y1, S1, S1]) {
      const n = r.np(k);
      r.P.onPlaybackStateChange(n); await r.step(300);
      if (k === S1) await r.up(); else await r.ytUp();
      await r.step(3000);
      r.P.onPlaybackStateChange(Object.assign({}, n, { elapsed: 200, ended: true })); await r.step(1500);
    }
    const said = r.lines(l0);
    const plays = r.acts(c0).filter((c) => /\.(play|playVideo|seekTo)\(/.test(c) && !/sc-player\.seekTo\(20000\)/.test(c));
    ok(said.length === 0 && plays.length === 0,
      "A — QUIET WHEN ALL IS RIGHT: a SoundCloud song, a YouTube song and back, ten seconds of checks each, and songs after a held end " +
      "— no correction, no line", { said, plays });
  }

  // ═══ PART B — a hidden player starts playing ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const b = await wrong(r, () => { r.Y().st.state = 1; });   // YouTube's hidden player starts by itself, no event
    ok(JSON.stringify(b.fix) === JSON.stringify(["yt-player.pauseVideo()"]) && JSON.stringify(b.said) === JSON.stringify(["Player: corrected yt — playing while not shown (the box shows sc)"]) &&
      b.after.length === 0 && b.saidAfter.length === 0,
      "B — YOUTUBE'S HIDDEN PLAYER STARTS PLAYING behind SoundCloud's: paused within one check, its one line, and nothing more after", b);
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.S().st.paused = false; });   // SoundCloud's hidden widget starts by itself, no event
    ok(b.fix.indexOf("sc-player.pause()") === 0 && b.fix.filter((c) => /^sc-player\.setVolume\([1-9]/.test(c)).length === 0 &&
      JSON.stringify(b.said) === JSON.stringify(["Player: corrected sc — playing while not shown (the box shows yt)"]) && b.after.length === 0 && b.saidAfter.length === 0,
      "B — SOUNDCLOUD'S HIDDEN WIDGET STARTS PLAYING behind YouTube's (read by its poll, `isPaused`): paused within one check, its one line", b);
  }
  {
    const r = await room();
    const n = r.np(Y1);
    r.P.onPlaybackStateChange(n); await r.step(300); await r.ytUp();
    r.P.onPlaybackStateChange(Object.assign({}, n, { elapsed: 200, ended: true })); await r.step(500);
    const b = await wrong(r, () => { r.Y().st.state = 1; });   // the held player starts by itself
    ok(JSON.stringify(b.fix) === JSON.stringify(["yt-player.pauseVideo()"]) && JSON.stringify(b.said) === JSON.stringify(["Player: corrected yt — playing while its song is over (held)"]) &&
      b.after.length === 0 && b.saidAfter.length === 0 && r.Y().st.muted === true,
      "B — A HELD PLAYER (its song over, the room holding it) THAT STARTS: paused, its line, and its sound still 0", b);
  }

  // ═══ PART C — the widget loads another track by itself ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    await r.step(1000);
    const c0 = r.yt.calls.length, l0 = r.logged.length;
    r.S().st.url = "https://soundcloud.com/someone-else/a-track-of-its-own";   // the widget moves on to another track, playing
    await r.step(2100);
    const fix = r.acts(c0), said = r.lines(l0);
    ok(fix.filter((c) => /^sc-player\.load\(/.test(c)).length === 1 && fix.indexOf('sc-player.load("' + LINK(S1) + '",' + JSON.stringify(Object.assign({}, r.w.sb.SoundCloudPlayer.LOOK)) + ")") >= 0 &&
      r.sc.made.length === 1 &&
      JSON.stringify(said) === JSON.stringify(["Player: corrected sc — it shows another track (\"Track someone-else/a-track-of-its-own\"), the room plays " + S1]) &&
      r.logged.slice(l0).some((x) => /^Player: load sc:artist-one\/track-one .*reason=corrected/.test(x)),
      "C — THE WIDGET LOADS ANOTHER TRACK BY ITSELF: within one check the room's song is loaded again into the same frame, its one line (and the load's own)", { fix, said });
    await r.up();
    const c1 = r.yt.calls.length, l1 = r.logged.length;
    await r.step(4500);
    ok(r.lines(l1).length === 0 && r.acts(c1).filter((c) => /^sc-player\.(load|play)\(/.test(c)).length === 0 &&
      r.acts(c0).filter((c) => /^sc-player\.seekTo\(/.test(c)).some((c) => /^sc-player\.seekTo\(2[0-9]{4}\)$/.test(c)),
      "C — at the room's point (sought on its PLAY), and right again after: nothing more", { said: r.lines(l1), seeks: r.acts(c0).filter((c) => /seekTo/.test(c)) });
  }

  // ═══ PART D — the volume changed inside a frame ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.S().st.vol = 80; });   // inside SoundCloud's hidden frame
    ok(JSON.stringify(b.fix) === JSON.stringify(["sc-player.setVolume(0)"]) && JSON.stringify(b.said) === JSON.stringify(["Player: corrected sc — its sound on while not shown (the box shows yt)"]) &&
      b.after.length === 0 && b.saidAfter.length === 0 && r.w.refs.volumeSlider.value === "70" && r.Y().st.vol === 70,
      "D — THE VOLUME TURNED UP INSIDE A HIDDEN FRAME: its sound back to 0 within one check, its line; this device's volume untouched (70)", b);
  }
  {
    const r = await room();
    const n = r.np(S1);
    r.P.onPlaybackStateChange(n); await r.step(300); await r.up();
    r.sc.fire("sc-player", "FINISH"); await r.step(100);
    r.P.onPlaybackStateChange(Object.assign({}, n, { elapsed: 200, ended: true })); await r.step(500);
    const b = await wrong(r, () => { r.S().st.vol = 80; });   // inside the held frame (its song over): not the person's
    ok(JSON.stringify(b.fix) === JSON.stringify(["sc-player.setVolume(0)"]) && JSON.stringify(b.said) === JSON.stringify(["Player: corrected sc — its sound on while its song is over (held)"]) &&
      b.after.length === 0 && r.w.refs.volumeSlider.value === "70" && !b.all.some((x) => /^Player: volume from /.test(x)),
      "D — THE VOLUME TURNED UP INSIDE A HELD FRAME (its song over): back to 0 within one check, its line — never taken for the person's", b);
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const b = await wrong(r, () => { r.S().st.vol = 30; });   // inside SoundCloud's shown frame, by the person
    ok(b.said.length === 0 && b.all.filter((x) => /^Player: volume from sc — 30, set inside its own player: now this device's$/.test(x)).length === 1 &&
      r.w.refs.volumeSlider.value === "30" && b.fix.filter((c) => /^sc-player\.setVolume\(/.test(c) && c !== "sc-player.setVolume(30)").length === 0 && b.saidAfter.length === 0,
      "D — THE VOLUME SET INSIDE SOUNDCLOUD'S SHOWN PLAYER IS THE PERSON'S: now this device's (the slider at 30), with its own line, no correction " +
      "(the `ddjp_710` owed line closed)", { said: b.said, all: b.all, slider: r.w.refs.volumeSlider.value, fix: b.fix });
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.Y().st.vol = 25; }, 600);   // inside YouTube's shown frame: its 400 ms poll, as always
    ok(b.said.length === 0 && b.all.filter((x) => /^Player: volume from yt — 25, set inside its own player: now this device's$/.test(x)).length === 1 &&
      r.w.refs.volumeSlider.value === "25" && b.fix.length === 0,
      "D — AND INSIDE YOUTUBE'S SHOWN PLAYER: taken within its poll (400 ms), as its two-way volume always was, now with its line", { said: b.said, all: b.all, slider: r.w.refs.volumeSlider.value });
  }

  // ═══ PART E — a shown player pauses by itself ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.Y().st.state = 2; });
    ok(JSON.stringify(b.fix) === JSON.stringify(["yt-player.playVideo()"]) && JSON.stringify(b.said) === JSON.stringify(["Player: corrected yt — paused while shown, the room playing " + Y1]) &&
      b.after.length === 0 && b.saidAfter.length === 0,
      "E — YOUTUBE'S SHOWN PLAYER PAUSES BY ITSELF: played again within one check, its line", b);
  }
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const b = await wrong(r, () => { r.S().st.paused = true; });
    ok(JSON.stringify(b.fix) === JSON.stringify(["sc-player.play()"]) && JSON.stringify(b.said) === JSON.stringify(["Player: corrected sc — paused while shown, the room playing " + S1]) &&
      b.after.length === 0 && b.saidAfter.length === 0,
      "E — SOUNDCLOUD'S SHOWN WIDGET PAUSES BY ITSELF (read by its poll): played again within one check, its line", b);
  }

  // ═══ PART F — the wrong song is loaded ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.Y().st.vid = "ZZZZZZZZZZZ"; });
    ok(b.fix.length === 1 && /^yt-player\.loadVideoById\(\{"videoId":"AAAAAAAAAAA","startSeconds":2[0-9](\.\d)?\}\)$/.test(b.fix[0]) &&
      JSON.stringify(b.said) === JSON.stringify(["Player: corrected yt — it shows yt:ZZZZZZZZZZZ, the room plays " + Y1]) && b.saidAfter.length === 0 &&
      b.after.filter((c) => /loadVideoById/.test(c)).length === 0,
      "F — YOUTUBE'S PLAYER SHOWS ANOTHER VIDEO: the room's song loaded at the room's point within one check, its line, and once only", b);
  }

  // ═══ PART G — a drift over 10 s ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(Y2, { startedAt: r.w.clock.now - 60000, elapsed: 60 })); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.Y().st.t = 20; });
    const sought = b.fix.length === 1 ? Number((b.fix[0].match(/^yt-player\.seekTo\(([\d.]+),true\)$/) || [])[1]) : NaN;
    ok(b.fix.length === 1 && sought >= 60 && sought <= 64 && b.said.length === 1 &&
      /^Player: corrected yt — the player at 2\d\.\d s, the room at 6\d\.\d s: more than 10 s apart \(sought to 6\d\.\d s; \d+ ms after its load\)$/.test(b.said[0]) &&
      b.saidAfter.length === 0,
      "G — A DRIFT OVER 10 s: a seek to the room's point within one check, its line (where, why, how long after its load)", b);
  }
  {
    const r = await room();
    // The room past the player's own length (200 s): the 10 s check never seeks past it less 1 s.
    r.P.onPlaybackStateChange(r.np(Y2, { startedAt: r.w.clock.now - 260000, elapsed: 260, duration: 300 })); await r.step(300); await r.ytUp();
    const b = await wrong(r, () => { r.Y().st.t = 150; });
    ok(b.fix.filter((c) => /seekTo/.test(c)).length === 0 && b.said.length === 0,
      "G — NEVER PAST THE PLAYER'S LENGTH LESS 1 s: the room at 260 s of a song this player measured at 200 s — no seek, no line", b);
  }

  // ═══ PART H — YouTube's own mute at a load is not the person's choice ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up(); await r.step(1500);
    const l0 = r.logged.length;
    r.P.onPlaybackStateChange(r.np(Y1)); await r.step(30);
    r.Y().st.muted = true; r.Y().st.vol = 100;   // YouTube mutes itself to start a video the browser will not let sound
    await r.step(1500);
    const from = r.logged.slice(l0).filter((x) => /^Player: volume from yt/.test(x));
    ok(from.length === 0 && r.prefs.level === 70 && r.prefs.muted === false && r.w.refs.volumeSlider.value === "70",
      "H — YOUTUBE'S OWN MUTE AT A LOAD IS NOT THE PERSON'S CHOICE: read before its load plays (muted, at 100), this device's volume stays 70, " +
      "unmuted, and no \"volume from yt\" is said", { from, prefs: r.prefs, slider: r.w.refs.volumeSlider.value });
  }
  // ═══ PART I — the tab hidden and shown, in the log ═══
  {
    const r = await room();
    r.P.onPlaybackStateChange(r.np(S1)); await r.step(300); await r.up();
    const doc = r.w.sb.document;
    const flip = (state) => { doc.visibilityState = state; doc.hidden = state === "hidden"; for (const fn of ((doc.listeners || {}).visibilitychange || []).slice()) fn({ type: "visibilitychange" }); };
    const l0 = r.logged.length;
    flip("hidden"); await r.w.advance(252000); flip("hidden"); flip("visible"); flip("visible");
    const tab = r.logged.slice(l0).filter((x) => /^Player: tab /.test(x));
    r.P.releasePlayer();
    const l1 = r.logged.length;
    flip("hidden"); await r.w.advance(1000); flip("visible");
    const after = r.logged.slice(l1).filter((x) => /^Player: tab /.test(x));
    ok(JSON.stringify(tab) === JSON.stringify(["Player: tab hidden", "Player: tab shown (hidden 4m12s)"]) && after.length === 0,
      "I — THE TAB HIDDEN AND SHOWN, IN THE LOG: one line each way, the time it was hidden (4m12s); nothing once the room is left", { tab, after });
  }

  if (failed) { console.log("[player-check] " + failed + " failure(s)"); process.exit(1); }
  console.log("[player-check] PASS — every player is kept to what the room says, always (" + asserts + " assertions): A quiet when all " +
    "is right; B a hidden player that starts (YouTube's, SoundCloud's) and a held one, paused within one check; C a track the widget " +
    "loads by itself replaced by the room's song in the same frame at the room's point; D a volume turned up inside a hidden frame back " +
    "to 0, and one set inside a shown player (SoundCloud's, YouTube's) taken as this device's; E a shown player that pauses by itself " +
    "played again; F another video loaded replaced by the room's song; G a drift over 10 s sought, never past the player's length — each " +
    "fix in one line, `Player: corrected <service> — …`, and nothing more once right; H YouTube's own mute at a load not taken as the " +
    "person's; I the tab hidden and shown said in the log, nothing once the room is left");
})().catch((e) => { console.log("[player-check] FAIL — threw: " + (e && e.stack || e)); process.exit(1); });
