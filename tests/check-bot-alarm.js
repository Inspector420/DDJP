// tests/check-bot-alarm.js
// SUBJECT: features/botruntime.js, ui/chat.js, ui/settings.js, core/chatprefs.js
// WALL: THE BOT'S WAKE-UP ALARM RINGS WHEN A HIDDEN BOT HAS SLEPT, ONLY ON THE BOT'S TAB, AND ITS LOOP LIVES IN THE AUDIO GRAPH
// (J68; the owner's decision 3, `ddjp_634`).
//
// A hidden bot that falls asleep — the computer slept, or the browser froze its tab — pauses the room until somebody comes back.
// The alarm is how the bot asks for that: when it detects it slept (Session's real-sleep test, told through the bridge) and its
// tab is not in view, it plays a continuous alarm until the tab is shown. Its modes are per device, beside "Watch videos on this
// device": when the bot falls asleep (the default), always on, off. Its volume is 10–100%, 33% by default. Its sound is the
// mention chime's family (sine, A5 and E6, a soft attack and decay, `CHIME_PEAK` 0.3 at 100%) in another pattern, looped by the
// audio graph and never re-triggered by a page timer — those are what a hidden tab gets slowed on. Until a click has armed it,
// a banner asks for one; if sound cannot play, the tab title flashes instead. None of it on a tab that is not the bot.
//
//   PART A — THE DECISION, every combination: mode × acting as bot × slept × in view × armed, against a table written here.
//   PART B — THE SLEEP, AS THE BOT KEEPS IT: a sleep the bridge tells while this tab is the bot is held and told to the page;
//            being seen clears it; stopping clears it; a sleep while not the bot is not held.
//   PART C — THE SOUND: it rings on a detected sleep while hidden, and stops on being shown; a recording AudioContext shows ONE
//            looping buffer source, started once, at CHIME_PEAK × volume, and no page timer armed; the buffer is the chime's
//            notes in another pattern (E6 first, then A5, and a rest); a sleep while in view does not ring.
//   PART D — THE MODES: "always on" plays from arming, in view and awake, until the mode changes or the tab stops being the
//            bot; "off" never plays and shows no banner.
//   PART E — THE BANNER shows until a click has armed the alarm, the click creating the audio context (or resuming it); under
//            its line, a smaller second one says why a click is needed (the owner, `ddjp_639`), read from the page's stylesheet.
//   PART F — THE TITLE FLASHES when sound cannot play, and is put back when the tab is shown.
//   PART G — NOT THE BOT: nothing shown, nothing played, the title untouched.
//   PART H — THE SETTINGS CARD (the real `ui/settings.js` functions, extracted by name): on the bot's tab the three modes in
//            order, the default chosen, the warning under "off", the mute instructions under "always on", the volume slider
//            from 10 to 100 at 33, and its release saving the volume and playing a sample.
//   PART I — THE PREFERENCES: the volume clamps to 10–100 and defaults to 33; the mode defaults to "when the bot falls asleep"
//            and refuses anything else; stored values are put right on load.
// Every row asserts its own premise first.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext } = require("./_load");
const CW = require("./_chat-world.js");
const XI = require("./_probe-j14-card.js");

let failed = 0, asserts = 0;
function ok(cond, msg, got) {
  asserts++;
  if (cond) return;
  failed++;
  console.log("[bot-alarm] FAIL — " + msg);
  if (got !== undefined) { try { console.log("      got " + JSON.stringify(got)); } catch (e) { console.log("      got (unprintable)"); } }
}
const CHIME_PEAK = 0.3;   // the owner's figure for the chime at 100%, which the alarm shares (decision 3)
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

// The runtime, loaded once for its pure decision and again per part where its state is driven.
function runtime(extra) {
  return loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/botsettings.js", "features/botruntime.js",
  ], Object.assign({ Date, Math, JSON, Promise, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} } }, extra || {}));
}
const RT = runtime();
const decide = (RT.BotRuntime && typeof RT.BotRuntime.alarmNow === "function") ? RT.BotRuntime.alarmNow : null;

// ═══ PART A — THE DECISION, EVERY COMBINATION ═══
{
  ok(!!decide, "A: the decision is a pure, exported function — `BotRuntime.alarmNow`", typeof (RT.BotRuntime && RT.BotRuntime.alarmNow));
  // THE TABLE, written here from the owner's words and not from the code. Not the bot, or off: nothing. Otherwise the banner
  // until armed; "when the bot falls asleep" rings on a sleep while not in view — sound when armed, the title when not;
  // "always on" sounds from arming, and flashes the title for a sleep it cannot sound.
  const want = (s) => {
    const none = { sound: false, flash: false, banner: false };
    if (!s.bot || s.mode === "off") return none;
    const woke = s.slept && !s.inView;
    if (s.mode === "always") return { sound: s.armed, flash: !s.armed && woke, banner: !s.armed };
    return { sound: woke && s.armed, flash: woke && !s.armed, banner: !s.armed };   // "asleep", and anything unknown
  };
  const bad = [];
  let n = 0;
  for (const mode of ["asleep", "always", "off", "nonsense"]) for (const bot of [true, false]) for (const slept of [true, false])
    for (const inView of [true, false]) for (const armed of [true, false]) {
      n++;
      const s = { mode, bot, slept, inView, armed };
      let got = null;
      try { got = decide ? decide(s) : null; } catch (e) { got = "threw " + e.message; }
      const w = want(s);
      if (!got || got.sound !== w.sound || got.flash !== w.flash || got.banner !== w.banner) bad.push({ s, want: w, got });
    }
  ok(n === 64 && decide && bad.length === 0,
    "A: EVERY COMBINATION OF mode × acting as bot × slept × in view × armed answers as the owner's decision says (" + n + " of 64)", bad.slice(0, 3));
  ok(decide && (() => { try { const r = decide(); return r && r.sound === false && r.flash === false && r.banner === false; } catch (e) { return false; } })(),
    "A: and it is total — nothing given, nothing rings");
}

// ═══ PART B — THE SLEEP, AS THE BOT KEEPS IT ═══
{
  const told = { slept: [], page: 0 };
  const lines = [];
  const sb = runtime({
    StreamManager: { getState: () => ({ settings: {}, rotation: [] }), getLog: () => [], on() {} },
    ServerClock: { serverNow: () => 1000 },
    MatrixBridge: { getMyPowerLevel: () => 99, getUserId: () => "@bot:hs", getRoster: () => [], onRawEvent() {}, offRawEvent() {},
      onSlept: (fn) => { told.slept.push(fn); }, mayAuthor: () => ({ ok: true }), eventsKeyForLevel: (l) => "events_L" + l },
  });
  sb.Room = { rankLadder: () => sb.Capabilities.LADDER, idleFor: () => ({ known: false }), presenceView: () => ({ people: [] }) };
  for (const k of ["info", "warn", "debug", "error"]) sb.Logger[k] = (m) => lines.push(k + ": " + m);
  const BR = sb.BotRuntime;
  const has = typeof BR.alarmSlept === "function" && typeof BR.alarmWoken === "function" && typeof BR.onAlarmChange === "function";
  ok(has, "B: the runtime keeps the sleep for the page — `alarmSlept`, `alarmWoken`, `onAlarmChange`");
  if (has) BR.onAlarmChange(() => { told.page++; });
  const r = BR.start({ roomId: "!r:hs", channels: {} });
  ok(r && r.ok && told.slept.length === 1, "B PREMISE — the bot started and listens for a sleep through the bridge, once", { r, listeners: told.slept.length });
  const sleep = (ms) => { for (const f of told.slept.slice()) f({ gapMs: ms }); };
  const p0 = told.page;
  sleep(10 * 60000);
  ok(has && BR.alarmSlept() === true && told.page > p0,
    "B: A SLEEP THE BRIDGE TELLS WHILE THIS TAB IS THE BOT IS HELD, AND THE PAGE IS TOLD", { slept: has && BR.alarmSlept(), told: told.page });
  ok(lines.some((m) => /^warn: BotRuntime: this tab slept/.test(m) && /600 s/.test(m)), "B: and it is said, with the gap", lines.filter((m) => /slept/.test(m)));
  const p1 = told.page;
  if (has) BR.alarmWoken();
  ok(has && BR.alarmSlept() === false && told.page > p1, "B: being seen clears it, and the page is told", told.page);
  sleep(5 * 60000);
  BR.stop();
  ok(has && BR.alarmSlept() === false, "B: stopping clears it — a tab that is not the bot holds no sleep");
  sleep(5 * 60000);
  ok(has && BR.alarmSlept() === false, "B: and a sleep while not the bot is not held");
  BR.start({ roomId: "!r:hs", channels: {} });
  ok(told.slept.length === 1, "B: a second start does not listen twice", told.slept.length);
  ok(has && BR.alarmSlept() === false, "B: and the next start holds no sleep — none from before the stop, none heard while not the bot");
  BR.stop();
}

// ── THE PAGE: the real `ui/chat.js` in the chat world, with a recording AudioContext, a document with a title and listeners,
// recording timers and the bot runtime's double (its decision the real one).
function page(o) {
  o = o || {};
  const rec = { contexts: 0, sources: [], gains: [], buffers: [], startState: o.startState || "running", resumeTo: "running" };
  const AC = o.noAudio ? undefined : class {
    constructor() { rec.contexts++; this.state = rec.startState; this.sampleRate = 8000; this.currentTime = 0; this.destination = { dest: true }; this._l = []; rec.ctx = this; }
    resume() { if (rec.resumeTo !== this.state) { this.state = rec.resumeTo; for (const f of this._l.slice()) f(); } return Promise.resolve(); }
    addEventListener(t, f) { if (t === "statechange") this._l.push(f); }
    createBuffer(ch, n, rate) { const d = new Float32Array(n); const b = { numberOfChannels: ch, length: n, sampleRate: rate, duration: n / rate, getChannelData: () => d }; rec.buffers.push(b); return b; }
    createBufferSource() { const s = { buffer: null, loop: false, started: 0, stopped: 0, to: [], connect(x) { s.to.push(x); }, disconnect() {}, start() { s.started++; }, stop() { s.stopped++; } }; rec.sources.push(s); return s; }
    createGain() { const g = { gain: { value: 1, setValueAtTime(v) { g.gain.value = v; }, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} }; rec.gains.push(g); return g; }
    createOscillator() { return { type: "", frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
  };
  const T = { intervals: new Map(), timeouts: 0, n: 0 };
  const doc = { title: "DDJP", visibilityState: "visible", hidden: false, fns: {},
    addEventListener(t, f) { (this.fns[t] = this.fns[t] || []).push(f); },
    removeEventListener(t, f) { const a = this.fns[t] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    fire(t) { for (const f of (this.fns[t] || []).slice()) f({ type: t }); } };
  doc.body = CW.el("body");
  const BRd = { bot: o.bot !== false, slept: false, fns: [],
    actingAsBot: () => BRd.bot, alarmSlept: () => BRd.slept, alarmWoken: () => { BRd.slept = false; },
    onAlarmChange: (fn) => { if (BRd.fns.indexOf(fn) < 0) BRd.fns.push(fn); }, alarmNow: decide || (() => ({})),
    tell: () => { for (const f of BRd.fns.slice()) f(); } };
  const w = CW.world({ AudioContext: AC, realDate: true, document: doc, extras: {
    BotRuntime: BRd,
    setInterval: (fn, ms) => { const id = ++T.n; T.intervals.set(id, { fn, ms }); return id; },
    clearInterval: (id) => { T.intervals.delete(id); },
  } });
  const d = w.sb.document || doc;
  const hide = (h) => { doc.hidden = !!h; doc.visibilityState = h ? "hidden" : "visible"; doc.fire("visibilitychange"); };
  const click = () => doc.fire("pointerdown");
  const sleep = () => { BRd.slept = true; BRd.tell(); };
  const ringing = () => rec.sources.filter((s) => s.loop === true && s.started > 0 && s.stopped === 0);
  const banner = () => CW.mk && doc.body.children.find((n) => / ?bot-alarm-banner ?/.test(n.className || ""));
  const bannerShown = () => { const b = banner(); return !!(b && b.style.display !== "none"); };
  return { w, rec, T, doc, BRd, hide, click, sleep, ringing, banner, bannerShown, P: w.sb.ChatPrefs };
}
const startPage = async (p) => { await p.w.CP.startChat(p.w.box); await settle(); };
// A part that throws is a failure named for its part, and the parts after it still run.
async function part(name, fn) { try { await fn(); } catch (e) { ok(false, name + " threw: " + (e && e.message)); } }
// The frequency of a stretch of the buffer, from its zero crossings.
function freqAt(buf, fromS, toS) {
  const d = buf.getChannelData(0), r = buf.sampleRate, a = Math.round(fromS * r), b = Math.round(toS * r);
  let x = 0;
  for (let i = a + 1; i < b; i++) if ((d[i - 1] < 0) !== (d[i] < 0)) x++;
  return x / 2 / (toS - fromS);
}
const peakIn = (buf, fromS, toS) => { const d = buf.getChannelData(0), r = buf.sampleRate; let m = 0; for (let i = Math.round(fromS * r); i < Math.round(toS * r) && i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; };

(async () => {
  // ═══ PART C — THE SOUND ═══
  await part("C", async () => {
    const p = page();
    await startPage(p);
    ok(p.P.botAlarm && p.P.botAlarm() === "asleep" && p.P.botAlarmVolume() === 33,
      "C PREMISE — the default mode (when the bot falls asleep) at the default volume", { mode: p.P.botAlarm && p.P.botAlarm() });
    p.click(); await settle();
    ok(p.rec.contexts === 1 && p.rec.ctx.state === "running" && !p.bannerShown(), "C PREMISE — a click armed it: the audio context runs", { contexts: p.rec.contexts });
    p.hide(true);
    const t0 = p.T.intervals.size;
    p.sleep(); await settle();
    const r = p.ringing();
    ok(r.length === 1 && r[0].started === 1,
      "C: A SLEEP DETECTED WHILE HIDDEN RINGS — one looping buffer source, started once", p.rec.sources.map((s) => ({ loop: s.loop, started: s.started, stopped: s.stopped })));
    ok(p.T.intervals.size === t0, "C: THE LOOP LIVES IN THE AUDIO GRAPH — no page timer was armed to play it (a hidden tab's timers are slowed)",
      Array.from(p.T.intervals.values()).map((t) => t.ms));
    const g = p.rec.gains[p.rec.gains.length - 1];
    ok(g && Math.abs(g.gain.value - CHIME_PEAK * 33 / 100) < 1e-9, "C: at the chime's peak scaled by the volume — 0.3 × 33%", g && g.gain.value);
    const buf = r.length ? r[0].buffer : null;
    ok(buf && buf.sampleRate === 8000 && buf.duration > 1.5, "C PREMISE — the source plays a buffer written at the context's rate", buf && { rate: buf.sampleRate, dur: buf.duration });
    if (buf) {
      const f1 = freqAt(buf, 0.01, 0.15), f2 = freqAt(buf, 0.32, 0.55);
      ok(Math.abs(f1 - 1318.5) < 40 && Math.abs(f2 - 880) < 40,
        "C: THE CHIME'S FAMILY IN ANOTHER PATTERN — E6 first, then A5 (a mention is A5 then E6, once)", { first: Math.round(f1), then: Math.round(f2) });
      ok(peakIn(buf, 0.6, 0.7) > 0.3 && peakIn(buf, buf.duration - 0.6, buf.duration) < 0.01,
        "C: and it repeats inside the loop, then rests before it comes round", { again: peakIn(buf, 0.6, 0.7), rest: peakIn(buf, buf.duration - 0.6, buf.duration) });
    }
    p.P.setBotAlarmVolume(66); p.w.CP.previewAlarm(); await settle();
    ok(p.ringing().length === 1 && p.ringing()[0] === r[0] && Math.abs(g.gain.value - CHIME_PEAK * 66 / 100) < 1e-9,
      "C: a new volume reaches the ringing alarm — the same source, louder", { gain: g.gain.value, ringing: p.ringing().length });
    p.hide(false); await settle();
    ok(r.length && r[0].stopped === 1 && p.ringing().length === 0, "C: SHOWN, IT STOPS — and the sleep is over", p.rec.sources.map((s) => s.stopped));
    p.hide(true); await settle();
    ok(p.ringing().length === 0, "C: hidden again with no new sleep, it stays quiet — being seen woke it", p.ringing().length);
    p.hide(false); p.sleep(); await settle();
    ok(p.ringing().length === 0 && p.BRd.slept === false, "C: A SLEEP DETECTED WHILE IN VIEW DOES NOT RING — there is nothing to wake", { ringing: p.ringing().length });
  });

  // ═══ PART D — THE MODES ═══
  await part("D", async () => {
    const p = page();
    await startPage(p);
    p.P.setBotAlarm("always"); await settle();
    ok(p.ringing().length === 0 && p.bannerShown(), "D PREMISE — always on, not yet armed: nothing plays, and the banner asks for a click", p.ringing().length);
    p.click(); await settle();
    const r = p.ringing();
    ok(r.length === 1, "D: \"ALWAYS ON\" PLAYS FROM ARMING — in view, with no sleep", p.ringing().length);
    p.P.setBotAlarm("asleep"); await settle();
    ok(r.length && r[0].stopped === 1 && p.ringing().length === 0, "D: and stops when the mode changes", p.ringing().length);
    p.P.setBotAlarm("always"); await settle();
    ok(p.ringing().length === 1, "D: always on again, it plays again", p.ringing().length);
    p.BRd.bot = false; p.BRd.tell(); await settle();
    ok(p.ringing().length === 0 && !p.bannerShown(), "D: and stops when the tab stops being the bot", p.ringing().length);
    p.BRd.bot = true; p.P.setBotAlarm("off"); p.BRd.tell(); p.hide(true); p.sleep(); await settle();
    ok(p.ringing().length === 0 && !p.bannerShown() && p.doc.title === "DDJP",
      "D: \"OFF\" NEVER PLAYS — armed, hidden and asleep, nothing; and no banner asks to arm what is off", { ringing: p.ringing().length, banner: p.bannerShown() });
  });

  // ═══ PART E — THE BANNER ═══
  await part("E", async () => {
    const p = page({ startState: "suspended" });
    await startPage(p);
    ok(p.rec.contexts === 0, "E PREMISE — no click yet: no audio context exists", p.rec.contexts);
    ok(p.bannerShown() && /Click anywhere to arm the bot's alarm/.test(p.banner().textContent),
      "E: THE BANNER SAYS \"Click anywhere to arm the bot's alarm\" until a click has armed it", p.banner() && p.banner().textContent);
    // THE BANNER EXPLAINS ITSELF (the owner, ddjp_639): under its line, a smaller second line.
    {
      const WHY = "Browsers only let a tab play sound after you click it once. Without that click, the alarm can't wake the bot.";
      const b = p.banner(), kids = b ? b.children.filter((n) => n.tag !== "#text") : [];
      ok(kids.length === 2 && kids[0].textContent === "Click anywhere to arm the bot's alarm" && kids[1].textContent === WHY,
        "E: UNDER \"CLICK ANYWHERE TO ARM THE BOT'S ALARM\", A SECOND LINE: \"" + WHY + "\" (the owner, ddjp_639)", kids.map((n) => n.textContent));
      const S = require("./_screen-world.js"), fs = require("fs"), path = require("path");
      const cas = S.makeCascade(S.readSheet(fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8")));
      const px = (n) => { const d = n ? cas.declared(n, "font-size") : null; return d ? parseFloat(d.val) : NaN; };
      const main = px(b), first = kids[0] ? (px(kids[0]) || main) : NaN, second = kids[1] ? px(kids[1]) : NaN;
      ok(main > 0 && first === main && second > 0 && second < first,
        "E: AND IT IS SMALLER — the stylesheet gives the second line a smaller size than the banner's own", { banner: main, first, second });
      ok(b && /\bbot-alarm-banner\b/.test(b.className) && cas.declared(b, "position") && cas.declared(b, "position").val === "fixed",
        "E CONTROL: the stylesheet is read for this banner (it is fixed at the top)", b && cas.declared(b, "position"));
    }
    p.click(); await settle();
    ok(p.rec.contexts === 1 && p.rec.ctx.state === "running" && !p.bannerShown(),
      "E: the click creates the audio context and resumes it, and the banner goes", { contexts: p.rec.contexts, state: p.rec.ctx && p.rec.ctx.state });
    p.rec.ctx.state = "suspended"; p.rec.ctx._l.forEach((f) => f()); await settle();
    ok(p.bannerShown(), "E: a context that stops running is not armed: the banner is back", p.bannerShown());
    p.click(); await settle();
    ok(p.rec.contexts === 1 && !p.bannerShown(), "E: and the next click resumes the same context", p.rec.contexts);
  });

  // ═══ PART F — THE TITLE FLASHES WHEN SOUND CANNOT PLAY ═══
  await part("F", async () => {
    const p = page({ noAudio: true });
    await startPage(p);
    p.click(); p.hide(true); p.sleep(); await settle();
    const fl = Array.from(p.T.intervals.values()).filter((t) => t.ms === 1000);
    ok(p.rec.sources.length === 0 && /asleep/i.test(p.doc.title) && fl.length === 1,
      "F: WITH NO SOUND TO PLAY, THE TAB TITLE FLASHES INSTEAD — the alarm title, and one flashing timer", { title: p.doc.title, timers: fl.length });
    if (fl.length) { fl[0].fn(); }
    ok(p.doc.title === "DDJP", "F: it flashes — back to the page's own title on the next turn", p.doc.title);
    if (fl.length) { fl[0].fn(); }
    ok(/asleep/i.test(p.doc.title), "F: and to the alarm again", p.doc.title);
    p.hide(false); await settle();
    ok(p.doc.title === "DDJP" && Array.from(p.T.intervals.values()).filter((t) => t.ms === 1000).length === 0,
      "F: shown, the title is put back and the flashing stops", p.doc.title);
  });

  // ═══ PART G — NOT THE BOT ═══
  await part("G", async () => {
    const p = page({ bot: false });
    await startPage(p);
    p.P.setBotAlarm("always"); p.click(); p.hide(true); p.sleep(); await settle();
    ok(p.rec.sources.length === 0 && !p.banner() && p.doc.title === "DDJP",
      "G: A TAB THAT IS NOT THE BOT SHOWS AND PLAYS NOTHING — no banner, no sound, the title untouched, even always on and asleep",
      { sources: p.rec.sources.length, banner: !!p.banner(), title: p.doc.title });
  });

  // ═══ PART H — THE SETTINGS CARD ═══
  await part("H", async () => {
    // REP's section is `check-bot-card`'s subject; here it is a stand-in that draws nothing.
    const NAMES = ["_prefCard", "_botViewSection", "_botAlarmRows", "_ALARM_CHOICES", "_ALARM_NOTES", "_choiceList"];
    const X = NAMES.map((n) => XI.extractNamed("ui/settings.js", n));
    ok(X.every((x) => x.ok), "H PREMISE — the Bot card's functions are each declared once in ui/settings.js", X.map((x, i) => NAMES[i] + ": " + (x.stage || "ok")));
    const flat = (n) => [n].concat(...(n.children || []).map(flat));
    const prefs = loadInContext(["core/logger.js", "core/storageio.js", "core/chatprefs.js"],
      { localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } } });
    const P = prefs.ChatPrefs;
    const card = (bot) => {
      const seen = { previews: 0, redraws: 0 };
      const ctx = { H: { el: CW.el }, ChatPrefs: P, BotRuntime: { actingAsBot: () => bot },
        ChatPanels: { previewAlarm: () => { seen.previews++; } }, renderChatSettings: () => { seen.redraws++; } };
      vm.createContext(ctx);
      if (X.every((x) => x.ok)) vm.runInContext("function _repSection() {}\n" + X.map((x) => x.source).join("\n") + "\n;this.section = _botViewSection;", ctx);
      const sec = ctx.section ? ctx.section() : null;
      return { sec, seen, all: sec ? flat(sec) : [] };
    };
    ok(card(false).sec === null, "H: a tab that is not the bot has no Bot card, and so no alarm");
    const c = card(true);
    const radios = c.all.filter((n) => n.tag === "input" && n.attrs.type === "radio");
    const label = (r) => (r.parent && r.parent.textContent) || "";
    ok(radios.length === 3 && /falls asleep/i.test(label(radios[0])) && /always on/i.test(label(radios[1])) && /^off/i.test(label(radios[2])),
      "H: ON THE BOT'S TAB, THE THREE MODES IN ORDER — when the bot falls asleep, always on, off", radios.map(label));
    ok(radios.length === 3 && radios[0].checked === true && !radios[1].checked && !radios[2].checked, "H: the default chosen", radios.map((r) => !!r.checked));
    const text = c.all.map((n) => n._text || "").join(" | ");
    ok(/Watch videos on this device/.test(text) && text.indexOf("Watch videos on this device") < text.search(/falls asleep/i),
      "H: beside \"Watch videos on this device\", in the same card, after it", text.slice(0, 200));
    if (radios.length === 3) { radios[2].checked = true; radios[2].onchange(); }
    const cOff = card(true);
    const offText = cOff.all.map((n) => n._text || "").join(" | ");
    ok(P.botAlarm() === "off" && /fall asleep/i.test(offText) && /pauses until someone comes back/i.test(offText),
      "H: CHOSEN, \"OFF\" SAYS WHY THE ALARM EXISTS — a hidden bot can fall asleep and the room pauses until someone comes back", offText.slice(-300));
    P.setBotAlarm("always");
    const aText = card(true).all.map((n) => n._text || "").join(" | ");
    ok(/mute the computer/i.test(aText) && /sound mixer/i.test(aText) && /not the tab/i.test(aText),
      "H: \"ALWAYS ON\" SAYS HOW TO SILENCE IT — mute the computer, or the browser in the system's sound mixer, not the tab", aText.slice(-300));
    P.setBotAlarm("asleep");
    const c2 = card(true);
    const sl = c2.all.find((n) => n.tag === "input" && n.attrs.type === "range" && n.dataset && n.dataset.kind === "botAlarm");
    ok(sl && sl.attrs.min === "10" && sl.attrs.max === "100" && sl.value === "33",
      "H: THE VOLUME SLIDER RUNS FROM 10 TO 100, AT 33", sl && sl.attrs);
    if (sl) { sl.value = "80"; sl.onchange(); }
    ok(P.botAlarmVolume() === 80 && c2.seen.previews === 1, "H: RELEASED, IT SAVES THE VOLUME AND PLAYS A SAMPLE", { vol: P.botAlarmVolume(), previews: c2.seen.previews });
  });

  // ═══ PART I — THE PREFERENCES ═══
  await part("I", async () => {
    const store = { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } };
    const mk = () => loadInContext(["core/logger.js", "core/storageio.js", "core/store.js", "core/chatprefs.js"], { localStorage: store }).ChatPrefs;
    const P = mk();
    const has = typeof P.botAlarmVolume === "function" && typeof P.setBotAlarmVolume === "function" && typeof P.botAlarm === "function";
    ok(has, "I: the preferences hold the alarm — `botAlarm`, `botAlarmVolume` and their setters");
    if (has) {
      ok(P.botAlarm() === "asleep" && P.botAlarmVolume() === 33, "I: THE DEFAULTS — when the bot falls asleep, at 33%", { m: P.botAlarm(), v: P.botAlarmVolume() });
      const got = [5, 0, -3, 10, 55.4, 100, 150, "x"].map((v) => { P.setBotAlarmVolume(v); return P.botAlarmVolume(); });
      ok(JSON.stringify(got) === JSON.stringify([10, 10, 10, 10, 55, 100, 100, 33]),
        "I: THE VOLUME CLAMPS TO 10–100 — below goes to 10, above to 100, nonsense to the default", got);
      P.setBotAlarm("always"); P.setBotAlarm("loud");
      ok(P.botAlarm() === "always", "I: a mode that is not one of the three is refused", P.botAlarm());
      P.setBotAlarmVolume(70);
      const P2 = mk(); P2.load();
      ok(P2.botAlarm() === "always" && P2.botAlarmVolume() === 70, "I: both survive a reload", { m: P2.botAlarm(), v: P2.botAlarmVolume() });
      const raw = JSON.parse(store._v[Object.keys(store._v).find((k) => /prefs/i.test(k))] || "{}");
      const k = Object.keys(store._v).find((x) => /prefs/i.test(x));
      if (k) { raw.botAlarm = "loud"; raw.botAlarmVolume = 3; store._v[k] = JSON.stringify(raw); }
      const P3 = mk(); P3.load();
      ok(k && P3.botAlarm() === "asleep" && P3.botAlarmVolume() === 10, "I: stored nonsense is put right on load — the default mode, the volume clamped",
        { key: k, m: P3.botAlarm(), v: P3.botAlarmVolume() });
    }
  });

  if (failed) { console.log("[bot-alarm] " + failed + " FAILED of " + asserts); process.exit(1); }
  console.log("[bot-alarm] PASS — the bot's wake-up alarm rings when a hidden bot has slept, only on the bot's tab, and loops in the " +
    "audio graph (" + asserts + " assertions): every combination of mode, bot, sleep, view and arming answers as the owner decided; " +
    "the runtime holds a sleep only while it is the bot; a sleep while hidden rings one looping source at the chime's peak and stops " +
    "on being shown, with no page timer; the chime's notes in another pattern; always on plays from arming, off never; the banner " +
    "until armed; the title flashes when sound cannot play; nothing on another tab; the card's three modes, warning, instructions " +
    "and slider; and the volume clamped to 10–100 at 33");
})();
