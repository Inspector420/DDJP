// tests/check-reload-button.js
// SUBJECT: ui/base.js, ui/player.js, ui/playlists.js, ui/shell.js, ui/songplayer.js, ui/youtube.js
// WALL: ↻ — A TAP RELOADS THE SONG, A HOLD REBUILDS THE WHOLE PLAYER (`ddjp_712`, the owner's design; his words: "maybe we can
//   make a circle load around the button like the avatar outline if we keep the button pressed and that reloads the whole
//   player a simple click just reloads the song", "tapping it or letting go to fast still refreshes the song, and completly
//   pusing it does the action upon the circle closing even if you dont lift click but waits for a lift to be pressed again",
//   and "lets do 1 second"). DRIVEN through the whole UI: the main screen built by the real ui/ files (`tests/_screen-world.js`,
//   the drive's `screen()`), the room's box player and the preview's made by the real plug over the real YouTube player file and
//   a recording stand-in `YT.Player`, and the two ↻ buttons pressed with pointer events on their own handlers, the clock and
//   the frames moved by hand. A double agrees with nothing here: what is counted is what the stand-in was asked.
//   PART A — THE ROOM'S ↻, A TAP: one load, AT THE ROOM'S POINT (where it loaded from 0 and the 10 s check moved it); no player
//            made, nothing destroyed; the ring back at 0.
//   PART B — AN EARLY RELEASE (0.5 s, the ring half drawn): a tap.
//   PART C — THE HOLD: nothing at 999 ms; at 1 s, still held, the whole player rebuilt — the old one destroyed, the box
//            emptied, one new player made, "Player: rebuilt by hand", the room's song loaded on it at the room's point, the ring
//            full and the face tinted; held on, nothing more; the lift does nothing.
//   PART D — A FRESH SECOND PRESS after it: a tap reloads, a hold rebuilds again.
//   PART E — ONE PLAYER, AND NO OLD ONE'S EVENTS: after a rebuild the box holds the new player alone, and an end or an error
//            from the old one reaches nothing; the new one's end is heard.
//   PART F — THE OTHER WAYS IN: a press the browser cancels does nothing; Enter or Space (a click no pointer made) is a tap and a
//            pointer's own click is not a second one; the long-press menu is refused; another button than the main one does
//            nothing; with nothing playing a tap does nothing and a hold still rebuilds the empty player.
//   PART G — THE PREVIEW'S ↻: a tap from where it is, and from 0 after its end; a hold rebuilds the preview's own player at its
//            point, the room's player untouched, the old preview player's events ignored.
//   PART H — THE ONE NUMBER, THE WORDS AND THE RING: HOLD_MS is 1000; both ↻ are hold buttons with the hover words and no other
//            `reset-btn` is; the page's ring is 2 px, 2 px outside, the app's blue, drawn from `--hold` out of the flow.
"use strict";
const fs = require("fs");
const path = require("path");
const D = require("./_player-drive.js");
const { ROOT } = require("./_load");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return true;
  failed++;
  console.log("[reload-button] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : ""));
  return false;
}
const ROOM = "yt-player", PREV = "yt-preview-player";
const K1 = D.K1, K3 = D.K3;
const ID = (k) => k.slice(3);

// A WORLD: the main screen, the room's player made and ready, its song 60 s in.
async function room(o) {
  o = o || {};
  const yt = D.standIn();
  const { w, noted } = D.screen(yt);
  const P = w.sb.Player;
  const lines = [];
  w.sb.Logger.on((e) => { try { lines.push(String(e.message)); } catch (x) {} });
  const step = async (ms) => { await w.advance(ms); w.frame(); };
  const np = (pi, key, elapsed, extra) => Object.assign({ pi, dj: "@d:hs", song: { songKey: key }, startedAt: w.clock.now - elapsed * 1000, elapsed, duration: 200 }, extra || {});
  P.initSongPlayer();
  await step(100);
  yt.ready(ROOM);
  await step(200);
  let n1 = null;
  if (o.song !== false) {
    n1 = np("$p1", K1, 60);
    P.onPlaybackStateChange(n1);
    await step(200);
    yt.state(ROOM, 3); await step(100); yt.state(ROOM, 1); await step(300);
    yt.setTime(ROOM, 61);
  }
  const btn = w.refs.resetBtn;
  let pid = 0;
  const ev = (type, extra) => Object.assign({ type, pointerId: pid, button: 0, _prevented: false, preventDefault() { this._prevented = true; } }, extra || {});
  const press = { down: (extra) => { pid++; const e = ev("pointerdown", extra); btn.dispatchEvent(e); return e; },
    up: () => btn.dispatchEvent(ev("pointerup")), cancel: () => btn.dispatchEvent(ev("pointercancel")) };
  const cut = () => yt.calls.length;
  // What a press asked of the players: the readings, and the sound put back after every load and on every state (as always),
  // are left out — they are not a reload or a rebuild.
  const since = (c) => yt.calls.slice(c).filter((x) => !/\.(getCurrentTime|getDuration|getVideoData|getPlayerState|getVolume|isMuted|setVolume|mute|unMute)\(/.test(x));
  const loads = (c) => since(c).filter((x) => /loadVideoById/.test(x));
  const made = (name) => yt.made.filter((m) => m.name === name);
  const hold = () => btn.style.getPropertyValue("--hold");
  return { yt, w, P, noted, lines, step, np, n1, btn, press, cut, since, loads, made, hold };
}
const loadAt = (id, s) => ROOM + ".loadVideoById({\"videoId\":\"" + id + "\",\"startSeconds\":" + s + "})";

(async () => {
  // ═══ PART A — a tap ═══════════════════════════════════════════════════════════════════════════════════════════════
  {
    const r = await room();
    ok(r.btn && r.btn.classList.contains("hold-btn"), "A PREMISE — the room's ↻ is drawn and is a hold button");
    const c = r.cut(), n = r.made(ROOM).length;
    r.press.down(); await r.step(200); r.press.up(); await r.step(50);
    ok(JSON.stringify(r.loads(c)) === JSON.stringify([loadAt(ID(K1), 60)]),
      "A — A TAP LOADS THE SONG ONCE, AT THE ROOM'S POINT (60 s) — not from 0 and a jump by the 10 s check", r.since(c));
    ok(r.made(ROOM).length === n && !r.since(c).some((x) => /destroy|^new /.test(x)), "A — and makes no player and destroys none", r.since(c));
    ok(r.hold() === "0" && !r.btn.classList.contains("hold-done"), "A — the ring is back at 0 after the lift", r.hold());
    ok(!r.lines.some((l) => /rebuilt by hand/.test(l)), "A — no rebuild line", r.lines.filter((l) => /rebuilt/.test(l)));
  }

  // ═══ PART B — an early release, at 0.5 s ═══════════════════════════════════════════════════════════════════════════
  {
    const r = await room();
    const c = r.cut();
    r.press.down(); await r.step(500);
    const mid = Number(r.hold());
    ok(mid >= 0.45 && mid <= 0.55, "B PREMISE — at 0.5 s the ring is half drawn (`--hold` from the clock)", r.hold());
    r.press.up(); await r.step(1500);
    ok(JSON.stringify(r.loads(c)) === JSON.stringify([loadAt(ID(K1), 60)]) && !r.since(c).some((x) => /destroy|^new /.test(x)),
      "B — LET GO BEFORE THE RING CLOSES, IT IS A TAP: one load at the room's point, no rebuild — and still none a second after", r.since(c));
    ok(r.hold() === "0", "B — the ring is back at 0", r.hold());
  }

  // ═══ PART C — the hold; D — a fresh second press; E — one player, no old events ════════════════════════════════════
  {
    const r = await room();
    const c = r.cut(), oldMount = r.w.refs.player.querySelector("#" + ROOM);
    const n = r.made(ROOM).length;
    r.press.down(); await r.step(999);
    ok(r.made(ROOM).length === n && !r.since(c).some((x) => /destroy/.test(x)), "C — AT 999 ms NOTHING HAS HAPPENED", r.since(c));
    await r.step(1);
    ok(r.since(c).some((x) => x === ROOM + ".destroy()") && r.made(ROOM).length === n + 1,
      "C — AT 1 s, STILL HELD, THE WHOLE PLAYER IS REBUILT: the old one destroyed and a new one made", r.since(c));
    ok(r.lines.filter((l) => l === "Player: rebuilt by hand").length === 1, "C — one log line: \"Player: rebuilt by hand\"", r.lines.filter((l) => /rebuilt/.test(l)));
    ok(r.hold() === "1" && r.btn.classList.contains("hold-done"), "C — the ring is full and the face tinted while it is held", [r.hold(), r.btn.className]);
    ok(!!oldMount && oldMount.parentNode !== r.w.refs.player && r.w.refs.player.querySelectorAll("#" + ROOM).length === 1,
      "C — THE BOX WAS EMPTIED: the old player's element is gone and one player element is in it");
    r.yt.ready(ROOM);
    await r.step(600);
    ok(JSON.stringify(r.loads(c)) === JSON.stringify([loadAt(ID(K1), 60)]),
      "C — THE NEW PLAYER LOADS THE ROOM'S SONG AT THE ROOM'S POINT once it is ready (the room's push driven again)", r.since(c));
    const c2 = r.cut(), n2 = r.made(ROOM).length;
    await r.step(3000);
    ok(r.loads(c2).length === 0 && r.made(ROOM).length === n2, "C — HELD ON FOR 3 s MORE, NOTHING MORE HAPPENS", r.since(c2));
    r.press.up(); await r.step(1500);
    ok(r.loads(c2).length === 0 && r.made(ROOM).length === n2 && r.lines.filter((l) => /rebuilt by hand/.test(l)).length === 1,
      "C — AND THE LIFT DOES NOTHING: no reload, no second rebuild", r.since(c2));
    ok(r.hold() === "0" && !r.btn.classList.contains("hold-done"), "C — the lift clears the ring and the tint", [r.hold(), r.btn.className]);
    // D — a fresh press
    r.yt.state(ROOM, 1); r.yt.setTime(ROOM, 61); await r.step(100);
    const c3 = r.cut();
    r.press.down(); await r.step(150); r.press.up(); await r.step(50);
    ok(JSON.stringify(r.loads(c3)) === JSON.stringify([loadAt(ID(K1), 60)]), "D — THE NEXT PRESS STARTS FRESH: a tap reloads once", r.since(c3));
    const n3 = r.made(ROOM).length;
    r.press.down(); await r.step(1000);
    ok(r.made(ROOM).length === n3 + 1, "D — and a hold rebuilds again", r.made(ROOM).length - n3);
    r.press.up(); await r.step(50);
    // E — one player, no old events
    r.yt.ready(ROOM); await r.step(600);
    const rooms = r.made(ROOM);
    const live = rooms[rooms.length - 1], old1 = rooms[rooms.length - 2], old0 = rooms[0];
    const nn = r.noted.length;
    for (const m of [old0, old1]) { m.cfg.events.onStateChange({ data: 0, target: m.p }); m.cfg.events.onError({ data: 150, target: m.p }); }
    await r.step(100);
    ok(r.noted.length === nn, "E — AN END AND AN ERROR FROM A PLAYER REBUILT AWAY REACH NOTHING (no end or blocked report)", r.noted.slice(nn));
    ok(r.w.refs.player.querySelectorAll("#" + ROOM).length === 1, "E — ONE PLAYER: the box holds the newest player's element alone");
    live.st.state = 0; live.cfg.events.onStateChange({ data: 0, target: live.p });
    await r.step(50);
    ok(r.noted.slice(nn).some((x) => /^notifyEnded yt:AAAAAAAAAAA/.test(x)), "E — the new player's own end IS heard (the control)", r.noted.slice(nn));
  }

  // ═══ PART F — the other ways in ════════════════════════════════════════════════════════════════════════════════════
  {
    const r = await room();
    const c = r.cut(), n = r.made(ROOM).length;
    r.press.down(); await r.step(500); r.press.cancel(); await r.step(1500);
    ok(r.since(c).length === 0 && r.made(ROOM).length === n && r.hold() === "0",
      "F — A PRESS THE BROWSER CANCELS (a touch taken for a scroll) DOES NOTHING — not at the cancel, not at 1 s", r.since(c));
    const c1 = r.cut();
    r.btn.click();   // Enter or Space: a click with no pointer's count
    await r.step(50);
    ok(JSON.stringify(r.loads(c1)) === JSON.stringify([loadAt(ID(K1), 60)]), "F — ENTER OR SPACE IS A TAP", r.since(c1));
    const c2 = r.cut();
    r.press.down(); await r.step(100); r.press.up();
    r.btn.dispatchEvent({ type: "click", detail: 1, preventDefault() {} });   // the click a pointer's press makes after it
    await r.step(50);
    ok(r.loads(c2).length === 1, "F — A POINTER'S TAP IS ONE RELOAD: the click that follows it is not a second", r.since(c2));
    const menu = { type: "contextmenu", _p: false, preventDefault() { this._p = true; } };
    r.btn.dispatchEvent(menu);
    ok(menu._p === true, "F — THE LONG-PRESS MENU IS REFUSED (contextmenu prevented)");
    const c3 = r.cut();
    r.press.down({ button: 2 }); await r.step(1200); r.press.up(); await r.step(50);
    ok(r.since(c3).length === 0, "F — ANOTHER BUTTON THAN THE MAIN ONE DOES NOTHING", r.since(c3));
    const e = r.press.down(); r.press.up(); await r.step(50);
    ok(e._prevented === true, "F — the press is the button's alone (pointerdown prevented: no text selection)");
    // nothing playing
    const z = await room({ song: false });
    const cz = z.cut(), nz = z.made(ROOM).length;
    z.press.down(); await z.step(100); z.press.up(); await z.step(600);
    ok(z.loads(cz).length === 0 && z.made(ROOM).length === nz, "F — WITH NOTHING PLAYING A TAP DOES NOTHING", z.since(cz));
    z.press.down(); await z.step(1000);
    ok(z.made(ROOM).length === nz + 1 && z.lines.some((l) => l === "Player: rebuilt by hand"),
      "F — AND A HOLD STILL REBUILDS THE EMPTY PLAYER, for troubleshooting", z.made(ROOM).length - nz);
    z.press.up();
  }

  // ═══ PART G — the preview's ↻ ══════════════════════════════════════════════════════════════════════════════════════
  {
    const r = await room();
    const row = r.w.sb.PlaylistPanels.songRow(K3, {});
    const all = []; (function walk(x) { all.push(x); for (const k of (x._kids || [])) walk(k); })(row);
    const slot = all.find((x) => x.nodeType === 1 && /\bthumb-slot\b/.test(x.className || ""));
    if (slot && typeof slot.onclick === "function") slot.onclick();
    await r.step(100);
    r.yt.ready(PREV); await r.step(100); r.yt.state(PREV, 1); await r.step(200);
    const pbtn = r.w.doc.body.querySelector(".preview-controls .pv-reload");
    if (ok(!!pbtn && pbtn.classList.contains("hold-btn"), "G PREMISE — the preview is open and its ↻ is a hold button")) {
      let pid = 100;
      const pdown = () => { pid++; pbtn.dispatchEvent({ type: "pointerdown", pointerId: pid, button: 0, preventDefault() {} }); };
      const pup = () => pbtn.dispatchEvent({ type: "pointerup", pointerId: pid, button: 0, preventDefault() {} });
      const prevLoads = (c) => r.yt.calls.slice(c).filter((x) => x.indexOf(PREV + ".loadVideoById") === 0);
      const roomCalls = (c) => r.since(c).filter((x) => x.indexOf(ROOM + ".") === 0 || x.indexOf("new " + ROOM) === 0);
      r.yt.setTime(PREV, 42);
      let c = r.cut();
      pdown(); await r.step(200); pup(); await r.step(50);
      ok(JSON.stringify(prevLoads(c)) === JSON.stringify([PREV + ".loadVideoById({\"videoId\":\"" + ID(K3) + "\",\"startSeconds\":42})"]),
        "G — A TAP PLAYS THE PREVIEW AGAIN FROM WHERE IT IS (42 s)", r.since(c));
      r.yt.setTime(PREV, 200); r.yt.state(PREV, 0); await r.step(50);
      c = r.cut();
      pdown(); await r.step(200); pup(); await r.step(50);
      ok(JSON.stringify(prevLoads(c)) === JSON.stringify([PREV + ".loadVideoById({\"videoId\":\"" + ID(K3) + "\",\"startSeconds\":0})"]),
        "G — AFTER ITS END, A TAP PLAYS IT FROM 0 (from its end it would only end again)", r.since(c));
      r.yt.state(PREV, 1); r.yt.setTime(PREV, 42); await r.step(50);
      const before = r.yt.made.filter((m) => m.name === PREV);
      c = r.cut();
      pdown(); await r.step(1000);
      const after = r.yt.made.filter((m) => m.name === PREV);
      ok(r.since(c).some((x) => x === PREV + ".destroy()") && after.length === before.length + 1,
        "G — A HOLD REBUILDS THE PREVIEW'S OWN PLAYER at 1 s, still held: the old one destroyed, a new one made", r.since(c));
      ok(r.w.doc.body.querySelectorAll("#" + PREV).length === 1, "G — and its box holds the new player alone");
      ok(r.lines.some((l) => /^Player: rebuilt by hand \(the song preview\)$/.test(l)), "G — its log line", r.lines.filter((l) => /rebuilt/.test(l)));
      r.yt.ready(PREV); await r.step(100);
      ok(JSON.stringify(prevLoads(c)) === JSON.stringify([PREV + ".loadVideoById({\"videoId\":\"" + ID(K3) + "\",\"startSeconds\":42})"]),
        "G — THE NEW PREVIEW PLAYER OPENS AT THE POINT THE OLD ONE WAS AT (42 s), once ready", r.since(c));
      ok(roomCalls(c).length === 0, "G — THE ROOM'S PLAYER IS NOT TOUCHED by the preview's rebuild", roomCalls(c));
      const c4 = r.cut();
      await r.step(2000); pup(); await r.step(50);
      ok(prevLoads(c4).length === 0 && r.yt.made.filter((m) => m.name === PREV).length === after.length, "G — held on and lifted: nothing more", r.since(c4));
      const old = before[before.length - 1], c5 = r.cut();
      old.cfg.events.onReady({ target: old.p });
      ok(r.since(c5).filter((x) => x.indexOf(PREV + ".") === 0).length === 0, "G — THE OLD PREVIEW PLAYER'S READY, ARRIVING LATE, DOES NOTHING", r.since(c5));
    }
  }

  // ═══ PART H — the one number, the words and the ring ════════════════════════════════════════════════════════════════
  {
    const r = await room();
    ok(r.w.H.HOLD_MS() === 1000, "H — THE HOLD IS ONE NAMED NUMBER, 1000 ms (his last word: \"lets do 1 second\")", r.w.H.HOLD_MS());
    const words = "Tap: reload the song · Hold: rebuild the player";
    ok(r.btn.getAttribute("title") === words, "H — the room's ↻ says on hover: " + words, r.btn.getAttribute("title"));
    const page = fs.readFileSync(path.join(ROOT, "ui/playlists.js"), "utf8");
    ok(/H\.holdButton\(pv\.reloadBtn,/.test(page) && /title: PV_RELOAD_TITLE/.test(page), "H — the preview's ↻ is made a hold button with the same words");
    const others = Array.from(r.w.main.querySelectorAll(".reset-btn")).filter((b) => b !== r.btn);
    ok(others.length >= 2 && others.every((b) => !b.classList.contains("hold-btn")), "H — NO OTHER `reset-btn` HOLDS (🖱, 👁)", others.map((b) => b.className));
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const rule = (sel) => { const i = css.indexOf("    " + sel + " {"); return i < 0 ? "" : css.slice(i, css.indexOf("}", i) + 1); };
    const ring = rule(".hold-btn::before"), btn = rule(".hold-btn"), done = rule(".hold-btn.hold-done");
    ok(/position: absolute/.test(ring) && /inset: -4px/.test(ring) && /padding: 2px/.test(ring) && /border-radius: 7px/.test(ring) && /pointer-events: none/.test(ring),
      "H — THE RING: out of the flow, 2 px thick, 2 px outside the button (inset −4 px, radius 7 px), never catching the pointer", ring);
    ok(/conic-gradient\(#5865F2 calc\(var\(--hold, 0\) \* 360deg\), transparent 0\)/.test(ring), "H — in the app's blue, filling clockwise from the top as `--hold` goes 0 to 1", ring);
    ok(/position: relative/.test(btn) && /touch-action: manipulation/.test(btn) && /user-select: none/.test(btn) && /-webkit-touch-callout: none/.test(btn),
      "H — the button: the ring's frame, no selection, no long-press callout, a scroll still the browser's", btn);
    ok(/rgba\(88, 101, 242/.test(done), "H — the face tinted blue when the ring closes", done);
  }

  if (failed) { console.log("[reload-button] " + failed + " of " + asserts + " FAILED"); process.exit(1); }
  console.log("[reload-button] PASS — ↻: a tap reloads the song, a hold rebuilds the whole player (" + asserts + " assertions): the room's tap " +
    "loads once at the room's point; let go at 0.5 s is a tap; held, nothing at 999 ms and at 1 s, still held, the old player destroyed, the box " +
    "emptied, one new player loading the room's song at the room's point, \"Player: rebuilt by hand\", the ring full and the face tinted; held on " +
    "and lifted, nothing more; the next press starts fresh; an old player's end or error reaches nothing; a cancelled press does nothing, Enter " +
    "or Space is a tap, the long-press menu is refused; with nothing playing a tap does nothing and a hold rebuilds the empty player; the " +
    "preview's ↻ the same — from where it is, from 0 after its end, its own player rebuilt at its point with the room's untouched; one number " +
    "(1000 ms), one hover text, the ring 2 px outside in the app's blue and out of the flow");
})().catch((e) => { console.log("[reload-button] FAIL — threw: " + (e && e.stack)); process.exit(1); });
