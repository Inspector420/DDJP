// tests/check-bot-card.js
// SUBJECT: ui/settings.js, features/rep-bot.js
//
// WALL: THE BOT CARD SHOWS REP'S ROWS AND DECIDES NOTHING (J84-5; H4). On the bot's own tab the
// Bot card asks `Rep.botCard()` once and renders what comes back — the bot's own REP settings, the export, the Replace flow,
// Rebuild with its days and Start fresh (J117) — with the panel's own pieces; a change goes back to the row's own handler,
// and a refusal is shown as the bot side words it. It lends three primitives and only these: download a JSON, pick a JSON,
// confirm (inline, in the card).
// The real functions are extracted from `ui/settings.js` and run over a small recording DOM.
//
//   A  ONLY THE BOT: a tab that is not the room's bot has no Bot card, and REP is never asked.
//   B  THE ROWS: the heading, the note, a number with its range, an on/off box, buttons (one disabled when the bot side
//      says so), a span — J117's Rebuild — with its days and its action, named and disabled as the bot side says; and no
//      REP section at all when REP has no card.
//   C  A CHANGE GOES BACK, A REFUSAL IS SHOWN: a number and a box hand their value to the row; accepted, the panel
//      redraws; refused, the bot side's words are shown and nothing redraws; a button runs its flow with the primitives;
//      a span's action runs its flow with its days, waited for; a cancelled flow says nothing.
//   D  THE PRIMITIVES: confirm shows the lines in the card (another room flagged) and answers yes or no, then goes away;
//      download hands the JSON to the browser as a file; pick reads a chosen file as JSON, hands on one that does not
//      parse as such, and answers nothing when cancelled.
//   E  NO BUTTON MISSING (the owner's ask with `ddjp_629`): the REAL bot side's card (`features/rep-bot.js`), with a table and
//      with none, drawn by these same functions, shows every control J117 needs — the window, the cooldown, the room limit,
//      the commands switch, Export, Replace…, Rebuild… with its days, and Start fresh.
//   F  THE CARD REDRAWS ITSELF (J117, `ddjp_630`): the REAL bot side, the feature layer's REAL "the bot card changed" and these
//      same panel functions, wired as ui/screens.js wires them. Drawn while the bot side starts, the card moves from
//      "Starting…" to its table with no lock click — one change, one signal, one redraw of the REP section alone; a look that
//      changes nothing says nothing; a fill-back greys its buttons and ungreys them, each once; a redraw raises nothing (the
//      fifty-seventh signature); not while the panel is closed, and drawn as it stands when it opens (`_renderGear`), once; a
//      flow holds it still and the change is drawn when it settles; locked, the redrawn card stays locked; its last message
//      stays. The signal reaches every listener once, names nothing of REP, and ui/screens.js subscribes the panel.
"use strict";
const vm = require("vm");
const XI = require("./_probe-j14-card.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-card] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

// J68 (`ddjp_635`): the card also draws the bot's wake-up alarm (the owner's decision 3), so its pieces come too — `check-bot-alarm`
// PART H is their subject; here they are only what the card needs to draw.
const NAMES = ["_prefCard", "_botViewSection", "_botAlarmRows", "_ALARM_CHOICES", "_ALARM_NOTES", "_choiceList", "_repSection", "_repRow", "_repUi"];
const X = NAMES.map((n) => XI.extractNamed("ui/settings.js", n));
ok(X.every((x) => x.ok), "PREMISE — the Bot card's functions are each declared once in ui/settings.js", X.map((x, i) => NAMES[i] + ": " + (x.stage || "ok")));
// J117 (`ddjp_630`): the pieces that draw the REP section and redraw it in place, and the state they share (`_rep`). Held by F;
// A–E run with whichever are declared.
const REDRAW = ["_repCard", "_repSig", "_repDraw", "_repOpen", "refreshRepCard"];
const XR = REDRAW.map((n) => XI.extractNamed("ui/settings.js", n));
const HAVE_REDRAW = XR.every((x) => x.ok);
const PANEL_SRC = "let _rep = null;\n" + X.concat(XR.filter((x) => x.ok)).map((x) => x.source).join("\n");

// ── A recording DOM, just enough of it ────────────────────────────────────────────────────────────────────────────────
function node(tag) {
  // `dataset`, as a real element has (J68: the card's alarm volume slider is the first of its controls to carry one).
  const n = { tag: tag, className: "", textContent: "", children: [], attrs: {}, style: {}, dataset: {}, parent: null, listeners: {}, clicked: 0,
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    replaceChild(c, old) { const i = this.children.indexOf(old); if (i < 0) return old; c.parent = this; old.parent = null; this.children[i] = c; node.replaced++; return old; },
    get parentNode() { return this.parent; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { this.listeners[t] = fn; },
    click() { this.clicked++; if (this.onclick) this.onclick(); } };
  return n;
}
node.replaced = 0;   // how many times a section was drawn over in place (F)
function el(tag, a, kids) {
  const n = node(tag);
  for (const k of Object.keys(a || {})) {
    if (k === "class") n.className = a[k]; else if (k === "text") n.textContent = a[k];
    else if (k === "onclick") n.onclick = a[k]; else if (k === "value") n.value = a[k]; else n.attrs[k] = a[k];
  }
  for (const c of (kids || [])) if (c) n.appendChild(c);
  return n;
}
const flat = (n) => [n].concat(...n.children.map(flat));
const byClass = (root, c) => flat(root).filter((x) => (" " + x.className + " ").indexOf(" " + c + " ") >= 0);

function world(o) {
  const w = { redraws: 0, blobs: [], readers: [], body: node("body"), asked: 0, card: o.card };
  const ctx = {
    H: { el: el },
    ChatPrefs: { botView: () => false, setBotView: () => {} },
    BotRuntime: { actingAsBot: () => o.bot !== false },
    renderChatSettings: () => { w.redraws++; },
    document: { body: w.body },
    URL: { createObjectURL: (b) => { w.blobs.push(b); return "blob:" + w.blobs.length; }, revokeObjectURL: () => {} },
    Blob: function (parts, opt) { this.parts = parts; this.type = opt && opt.type; },
    FileReader: function () { const r = this; w.readers.push(r); r.readAsText = (f) => { r.file = f; }; },
    setTimeout: () => 0,
  };
  if (o.rep !== false) ctx.Rep = { botCard: () => { w.asked++; return w.card; } };
  vm.createContext(ctx);
  vm.runInContext(PANEL_SRC + "\n;this.section = _botViewSection; this.ui = _repUi;", ctx);
  w.ctx = ctx;
  w.section = () => ctx.section();
  return w;
}
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

(async () => {
  if (!X.every((x) => x.ok)) { console.log("[bot-card] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  const seen = { set: [], run: [] };
  const card = { heading: "Reputation (REP)", note: "A table of 4 people.", rows: [
    { kind: "number", key: "windowDays", label: "Fill-back window", unit: "days", value: 7, min: 1, max: 365, set: (v) => { seen.set.push(["windowDays", v]); return v === 3 ? { ok: true } : { ok: false, why: "out of range" }; } },
    { kind: "toggle", key: "commands", label: "Answer the owner's !rep commands", value: true, set: (v) => { seen.set.push(["commands", v]); return { ok: true }; } },
    { kind: "button", key: "export", label: "Export reputation table", enabled: true, run: (ui) => { seen.run.push(["export", ui]); return { ok: true }; } },
    { kind: "button", key: "replace", label: "Replace reputation table…", enabled: false, run: () => ({ ok: true }) },
    { kind: "button", key: "startFresh", label: "Start fresh", enabled: true, run: (ui) => { seen.run.push(["startFresh", ui]); return Promise.resolve({ ok: false, why: "cancelled" }); } },
    // J117: Rebuild, a span with its action. CHANGED AT J117, with the reason: Look further back went, and the span row's
    // action is named by the bot side and waited for like a button's flow.
    { kind: "days", key: "rebuild", label: "Rebuild from the last", unit: "days", value: 14, min: 1, max: 365, action: "Rebuild…", enabled: true,
      run: (ui, d) => { seen.run.push(["rebuild", d, ui]); return Promise.resolve(d === 30 ? { ok: false, why: "cancelled" } : { ok: false, why: "1 to 365 days" }); } },
  ] };

  // ── A — ONLY THE BOT ──────────────────────────────────────────────────────────────────────────────────────────────────
  {
    const w = world({ bot: false, card: card });
    ok(w.section() === null && w.asked === 0, "A: A TAB THAT IS NOT THE BOT has no Bot card — and REP is never asked", w.asked);
  }

  // ── B — THE ROWS ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const w = world({ card: card });
  const sec = w.section();
  const box = sec ? byClass(sec, "rep-card")[0] : null;
  ok(sec && w.asked === 1 && box, "B: on the bot's tab the Bot card asks REP once, and has a REP section", w.asked);
  const texts = box ? flat(box).map((x) => x.textContent).filter(Boolean) : [];
  ok(texts[0] === "Reputation (REP)" && texts.indexOf("A table of 4 people.") >= 0, "B: its heading and note, as the bot side gave them", texts.slice(0, 3));
  const inputs = box ? flat(box).filter((x) => x.tag === "input") : [];
  const num = inputs.find((x) => x.attrs.type === "number" && x.value === "7"), box2 = inputs.find((x) => x.attrs.type === "checkbox");
  ok(num && num.attrs.min === "1" && num.attrs.max === "365" && box2 && box2.checked === true, "B: a number with its range, an on/off box as it stands", inputs.map((x) => [x.attrs.type, x.value, x.attrs.min, x.attrs.max, x.checked]));
  const buttons = box ? flat(box).filter((x) => x.tag === "button") : [];
  const btn = (t) => buttons.find((x) => x.textContent === t);
  const span = inputs.find((x) => x.attrs.type === "number" && x.value === "14");
  ok(btn("Export reputation table") && btn("Replace reputation table…") && btn("Replace reputation table…").disabled === true && btn("Start fresh") &&
     btn("Rebuild…") && btn("Rebuild…").disabled !== true && span && span.attrs.min === "1" && span.attrs.max === "365" &&
     flat(box).some((x) => x.textContent === "Rebuild from the last"),
    "B: the buttons, one disabled where the bot side says so, and Rebuild with its days and its action as the bot side names them (J117)", buttons.map((x) => [x.textContent, !!x.disabled]));
  const off = world({ card: { heading: "Reputation (REP)", rows: [Object.assign({}, card.rows[card.rows.length - 1], { enabled: false })] } }).section();
  const offBtn = off ? flat(off).find((x) => x.tag === "button" && x.textContent === "Rebuild…") : null;
  ok(offBtn && offBtn.disabled === true, "B: and a span's action disabled where the bot side says so", offBtn && offBtn.disabled);
  const none = world({ card: null }).section();
  ok(none && byClass(none, "rep-card").length === 0 && flat(none).some((x) => x.textContent === "Watch videos on this device"),
    "B: with no card from REP there is no REP section — the Bot card as it was", none && flat(none).map((x) => x.textContent).filter(Boolean).slice(0, 2));
  const noRep = world({ card: card, rep: false }).section();
  ok(noRep && byClass(noRep, "rep-card").length === 0, "B: and with REP not loaded at all, the same");

  // ── C — A CHANGE GOES BACK, A REFUSAL IS SHOWN ────────────────────────────────────────────────────────────────────────
  const msg = box ? byClass(box, "rep-card-msg")[0] : null;
  num.value = "3"; num.onchange();
  ok(seen.set[0] && seen.set[0][1] === 3 && typeof seen.set[0][1] === "number" && w.redraws === 1 && msg.textContent === "",
    "C: A NUMBER GOES BACK TO ITS ROW as a number; accepted, the panel redraws", { set: seen.set, redraws: w.redraws });
  num.value = "0"; num.onchange();
  ok(w.redraws === 1 && msg.textContent === "out of range", "C: REFUSED, the bot side's words are shown and nothing redraws", msg.textContent);
  box2.checked = false; box2.onchange();
  ok(seen.set[2] && seen.set[2][0] === "commands" && seen.set[2][1] === false, "C: the box hands back its state", seen.set);
  btn("Export reputation table").onclick(); await flush();
  const lent = seen.run[0] && seen.run[0][1];
  ok(lent && ["download", "pick", "confirm"].every((k) => typeof lent[k] === "function") && Object.keys(lent).length === 3,
    "C: A BUTTON RUNS ITS FLOW, lent three primitives — download, pick, confirm — and nothing else", lent && Object.keys(lent));
  const r0 = w.redraws, m0 = msg.textContent;
  btn("Start fresh").onclick(); await flush();
  ok(w.redraws === r0 && msg.textContent === m0, "C: a cancelled flow says nothing and redraws nothing", { redraws: w.redraws - r0, msg: msg.textContent });
  span.value = "400"; btn("Rebuild…").onclick(); await flush();
  const rb = seen.run.find((r) => r[0] === "rebuild");
  ok(rb && rb[1] === 400 && rb[2] && ["download", "pick", "confirm"].every((k) => typeof rb[2][k] === "function") && msg.textContent === "1 to 365 days" && w.redraws === r0,
    "C: REBUILD HANDS ITS DAYS, as a number, with the primitives — and its flow is waited for: a refusal shown, nothing redrawn", { run: seen.run.map((r) => r[0] + ":" + (typeof r[1] === "number" ? r[1] : "ui")), msg: msg.textContent });
  msg.textContent = "";
  span.value = "30"; btn("Rebuild…").onclick(); await flush();
  ok(seen.run.some((r) => r[0] === "rebuild" && r[1] === 30) && msg.textContent === "" && w.redraws === r0,
    "C: and a cancelled Rebuild says nothing and redraws nothing", { msg: msg.textContent, redraws: w.redraws - r0 });

  // ── D — THE PRIMITIVES ────────────────────────────────────────────────────────────────────────────────────────────────
  const ui = lent;
  const p1 = ui.confirm(["2 people", "ANOTHER ROOM: Other Room (!o:hs)"], { other: true });
  const pv = byClass(box, "rep-preview")[0];
  ok(pv && /\brep-other\b/.test(pv.className) && flat(pv).some((x) => x.textContent === "ANOTHER ROOM: Other Room (!o:hs)") && box.children.indexOf(pv) === box.children.indexOf(msg) - 1,
    "D: CONFIRM SHOWS THE LINES IN THE CARD, just above the message line — another room flagged", pv && pv.className);
  flat(pv).find((x) => x.textContent === "Confirm").onclick();
  ok((await p1) === true && byClass(box, "rep-preview").length === 0, "D: Confirm answers yes, and the preview goes");
  const p2 = ui.confirm(["x"], {});
  flat(byClass(box, "rep-preview")[0]).find((x) => x.textContent === "Cancel").onclick();
  ok((await p2) === false && byClass(box, "rep-preview").length === 0, "D: Cancel answers no, and it goes");
  ui.download("ddjp-rep-x.json", { format: "ddjp-rep-table", rows: { "@a:hs": [1] } });
  const blob = w.blobs[0];
  ok(blob && blob.type === "application/json" && JSON.parse(blob.parts[0]).format === "ddjp-rep-table" && w.body.children.length === 0,
    "D: DOWNLOAD hands the JSON to the browser as a file", blob && blob.type);
  const p3 = ui.pick();
  const fi = w.body.children.find((x) => x.tag === "input");
  ok(fi && fi.attrs.type === "file" && /json/.test(fi.attrs.accept) && fi.clicked === 1, "D: PICK asks for a JSON file", fi && fi.attrs);
  fi.files = [{ name: "t.json" }]; fi.onchange();
  const rd = w.readers[0];
  rd.result = JSON.stringify({ format: "ddjp-rep-table", v: 1 }); rd.onload();
  const got3 = await p3;
  ok(got3 && got3.format === "ddjp-rep-table" && w.body.children.length === 0, "D: and reads the chosen file as JSON", got3);
  const p4 = ui.pick();
  const f4 = w.body.children.find((x) => x.tag === "input");
  f4.files = [{ name: "bad.json" }]; f4.onchange();
  const rd4 = w.readers[1]; rd4.result = "{ not json"; rd4.onload();
  ok(JSON.stringify(await p4) === JSON.stringify({ unreadable: true }), "D: a file that does not parse is handed on as such — for the bot side to refuse");
  const p5 = ui.pick();
  const f5 = w.body.children.find((x) => x.tag === "input");
  f5.listeners.cancel();
  ok((await p5) === null && w.body.children.length === 0, "D: and a pick cancelled answers nothing");

  // ── E — THE REAL CARD, DRAWN: NO BUTTON MISSING ───────────────────────────────────────────────────────────────────────
  const { loadInContext } = require("./_load.js");
  const realCard = async (stored) => {
    const sb = loadInContext(["features/rep-rules.js", "features/rep-ports.js", "features/rep-bot.js"], {
      setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
      BotRuntime: { actingAsBot: () => true }, ServerClock: { serverNow: () => 1700000000000 },
      MatrixBridge: { getUserId: () => "@bot:hs", mayAuthor: () => ({ ok: false }) }, Logger: { info() {}, warn() {} },
      Store: { rep: { load: async () => stored, loadPrefs: async () => null, savePrefs: async () => true, save: async () => true, writerLock: async () => true } } });
    sb.Rep.enter({ spaceId: "!s:hs", channels: { events_owner: "!o:hs" } });
    await flush();
    return sb.Rep.botCard();
  };
  const kept = { v: 1, room: "!s:hs", since: null, base: { "@a:hs": [1, 2, 0, 0, 0, 0] }, cut: null, fwd: { byPi: {}, held: [] }, last: null, lastMsgAt: null, counted: 0, heard: null };
  const NEEDED = ["Export reputation table", "Replace reputation table…", "Rebuild…", "Start fresh"];
  for (const [what, stored] of [["with a table", kept], ["with no table", null]]) {
    const rc = await realCard(stored);
    const rw = world({ card: rc });
    const rsec = rw.section();
    const rbox = rsec ? byClass(rsec, "rep-card")[0] : null;
    const shown = rbox ? flat(rbox) : [];
    const bts = shown.filter((x) => x.tag === "button").map((x) => x.textContent);
    const nums = shown.filter((x) => x.tag === "input" && x.attrs.type === "number").length;
    const boxes = shown.filter((x) => x.tag === "input" && x.attrs.type === "checkbox").length;
    ok(rc && rc.rows && rbox && NEEDED.every((t) => bts.indexOf(t) >= 0) && bts.length === NEEDED.length && nums === 4 && boxes === 1 &&
       shown.some((x) => x.textContent === "Rebuild from the last") && rbox.children.filter((x) => /\brep-row\b/.test(x.className)).length === rc.rows.length,
      "E: NO BUTTON MISSING, " + what + " — the real card drawn: Export, Replace…, Rebuild… with its days, Start fresh; the window, the cooldown and the room limit; the commands switch; one control per row",
      { buttons: bts, numbers: nums, boxes: boxes, rows: rc && rc.rows && rc.rows.map((r) => r.key) });
  }

  // ── F — THE CARD REDRAWS ITSELF (J117, `ddjp_630`) ──────────────────────────────────────────────────────────────────
  // Before, nothing redrew the card when the bot side moved on: drawn while the bot side started, it read "Starting…" until
  // the next lock click. The REAL bot side, the feature layer's REAL signal and these panel functions, wired as ui/screens.js
  // wires them; the bot side's clock and timers moved by hand.
  await (async () => {
    const SIG = { on: XI.extractNamed("features/room.js", "onBotCardChange"), raise: XI.extractNamed("features/room.js", "botCardChanged") };
    const GEAR = XI.extractNamed("ui/queue.js", "_renderGear");
    const premise = HAVE_REDRAW && SIG.on.ok && SIG.raise.ok && GEAR.ok;
    ok(premise, "F PREMISE — the redraw's pieces are each declared once: ui/settings.js's, the feature layer's \"the bot card changed\", and the gear panel's",
      XR.map((x, i) => REDRAW[i] + ": " + (x.stage || "ok")).concat([SIG.on.stage || "onBotCardChange: ok", SIG.raise.stage || "botCardChanged: ok", GEAR.stage || "_renderGear: ok"]));
    // THE SIGNAL, AS THE FEATURE LAYER DECLARES IT.
    const sc = vm.createContext({});
    if (SIG.on.ok && SIG.raise.ok) {
      vm.runInContext("const _botCardListeners = [];\n" + SIG.on.source + "\n" + SIG.raise.source + "\n;this.on = onBotCardChange; this.raise = botCardChanged;", sc);
      const heard = [];
      const f = () => heard.push("f"), g = () => { heard.push("g"); throw new Error("x"); }, h = () => heard.push("h");
      const t = vm.createContext({});
      vm.runInContext("const _botCardListeners = [];\n" + SIG.on.source + "\n" + SIG.raise.source + "\n;this.on = onBotCardChange; this.raise = botCardChanged;", t);
      t.on(f); t.on(g); t.on(h); t.on(f); t.raise();
      ok(heard.join() === "f,g,h" && !/\bRep\b|\bREP\b|rep-/.test(SIG.on.source + SIG.raise.source),
        "F: \"THE BOT CARD CHANGED\" REACHES EVERY LISTENER, once each — one that throws stops none after it — and names nothing of REP", heard);
    } else ok(false, "F: \"THE BOT CARD CHANGED\" REACHES EVERY LISTENER — the feature layer declares no such signal");
    const screens = require("fs").readFileSync(require("path").join(__dirname, "..", "ui", "screens.js"), "utf8");
    const once = screens.slice(screens.indexOf("function _wireMainOnce("), screens.indexOf("function _peopleRedraw("));
    ok(/Room\.onBotCardChange\(Settings\.refreshRepCard\)/.test(once), "F: THE PANEL LISTENS (ui/screens.js, in the once-a-page wiring)");

    // THE BOT SIDE, REAL, with a lock it waits for and a fill-back it waits on.
    const T = 1700000000000, timers = [];
    let signals = 0, may = false, lockGo = null, pageGo = null, deferPage = true;
    const reactL = [];
    const kept = { v: 1, room: "!s:hs", since: null, base: { "@a:hs": [1, 2, 0, 0, 0, 0] }, cut: null, fwd: { byPi: {}, held: [] }, last: null, lastMsgAt: null, counted: 0, heard: null };
    const { loadInContext } = require("./_load.js");
    const bot = loadInContext(["features/rep-rules.js", "features/rep-ports.js", "features/rep-bot.js"], {
      setTimeout: (fn, ms) => { const tm = { fn: fn, ms: ms, live: true }; timers.push(tm); return tm; }, clearTimeout: (tm) => { if (tm) tm.live = false; },
      setInterval: () => ({}), clearInterval: () => {},
      BotRuntime: { actingAsBot: () => true }, ServerClock: { serverNow: () => T }, Logger: { info() {}, warn() {} },
      StreamManager: { on: (t, fn) => reactL.push([t, fn]), off() {}, getLog: () => [], isLegal: () => true },
      MatrixBridge: { getUserId: () => "@bot:hs", mayAuthor: () => ({ ok: may }), roomHistory: () => [{ pi: "$p1", l: 5, dj: "@dj:hs", videoId: "v" }],
        pageRange: () => (deferPage ? new Promise((res) => { pageGo = () => res(Object.assign([], { reachedFrom: 0 })); }) : Promise.resolve(Object.assign([], { reachedFrom: 0 }))) },
      Room: { botCardChanged: () => { signals++; if (sc.raise) sc.raise(); } },
      Store: { rep: { load: async () => JSON.parse(JSON.stringify(kept)), loadPrefs: async () => null, savePrefs: async () => true, save: async () => true,
        writerLock: (sid, held) => new Promise((res) => { lockGo = () => { held(); res(true); }; }) } } });
    const soon = async () => { for (const tm of timers.slice()) if (tm.live && tm.ms === bot.RepBot.SOON_MS) { tm.live = false; tm.fn(); } await flush(); };
    let vid = 0;
    const vote = async (who) => { const e = { eventId: "$fv" + (++vid), type: "ddjp.dj.vote", sender: who, content: { p: "$p1" }, l: 10 + vid, ts: T };
      for (const [t, fn] of reactL.slice()) if (t === "ddjp.dj.vote") fn(e); await soon(); };

    // THE PANEL: these same functions, the gear's Settings sub-tab open, the REAL bot side's card asked for through `Rep`.
    const view = { right: "gear", gear: "settings", locked: false };
    const w = world({});
    let asked = 0;
    w.ctx.Rep = { botCard: () => { asked++; return bot.Rep.botCard(); } };
    w.ctx.H.rightTab = () => view.right; w.ctx.H.gearTab = () => view.gear; w.ctx.H.prefsLocked = () => view.locked;
    w.ctx.QueuePanels = { _disableAllControls: (root) => { for (const n of flat(root)) if (n.tag === "input" || n.tag === "button") n.disabled = true; } };
    const refresh = premise ? vm.runInContext("refreshRepCard", w.ctx) : null;
    if (refresh && sc.on) sc.on(refresh);   // as ui/screens.js wires it
    const gc = vm.createContext({ H: { gearTab: () => view.gear }, refs: {}, Settings: { refreshRepCard: refresh || (() => {}) } });
    if (GEAR.ok) vm.runInContext("const refs = this.refs;\n" + GEAR.source + "\n;this.render = _renderGear;", gc);
    const openGear = async () => { if (gc.render) gc.render(); await flush(); };

    bot.Rep.enter({ spaceId: "!s:hs", channels: { events_owner: "!o:hs" } });
    await flush();
    const sec = w.section();
    const repBox = () => (sec ? byClass(sec, "rep-card") : []);
    const noteOf = () => { const b = repBox()[0]; const n = b ? byClass(b, "pref-note").find((x) => !/rep-card-msg/.test(x.className)) : null; return n ? n.textContent : null; };
    const btnOf = (t) => { const b = repBox()[0]; return b ? flat(b).find((x) => x.tag === "button" && x.textContent === t) : null; };
    const others = sec ? sec.children.filter((c) => !/\brep-card\b/.test(c.className)) : [];
    ok(noteOf() === "Starting…" && asked === 1 && signals === 0, "F PREMISE — drawn while the bot side starts (its lock not granted yet), the card reads \"Starting…\"", { note: noteOf(), asked: asked, signals: signals });
    node.replaced = 0;
    lockGo(); await flush();
    ok(noteOf() === "A table of 1 people." && w.redraws === 0,
      "F: THE CARD MOVES FROM \"Starting…\" TO ITS TABLE WITHOUT A LOCK CLICK — the bot side started, and the card says so", { note: noteOf(), redraws: w.redraws });
    const keptOthers = sec ? sec.children.filter((c) => !/\brep-card\b/.test(c.className)) : [];
    ok(signals === 1 && node.replaced === 1 && asked === 2 && repBox().length === 1 && others.length > 0 && others.length === keptOthers.length && others.every((c, i) => c === keptOthers[i]),
      "F: ONE CHANGE, ONE REDRAW — one signal, one redraw of the REP section alone, in place; the rest of the Bot card untouched", { signals: signals, redraws: node.replaced, asked: asked, boxes: repBox().length });
    for (let i = 0; i < 3; i++) { bot.RepBot._stepForTest(); await flush(); }
    ok(signals === 1 && node.replaced === 1, "F: A LOOK THAT CHANGES NOTHING SAYS NOTHING — three more looks, no signal, no redraw", { signals: signals, redraws: node.replaced });
    // A FILL-BACK: its buttons greyed as it starts, and back when it ends — each once.
    may = true; bot.RepBot._stepForTest(); await flush();
    const greyed = ["Replace reputation table…", "Rebuild…", "Start fresh"].every((t) => btnOf(t) && btnOf(t).disabled === true);
    ok(noteOf() === "Filling in what it missed…" && greyed && signals === 2 && node.replaced === 2,
      "F: A FILL-BACK GREYS ITS BUTTONS ON THE CARD AS IT STARTS — one signal, one redraw", { note: noteOf(), greyed: greyed, signals: signals, redraws: node.replaced });
    pageGo(); await flush();
    const back = ["Replace reputation table…", "Rebuild…", "Start fresh"].every((t) => btnOf(t) && btnOf(t).disabled !== true);
    ok(noteOf() === "A table of 1 people." && back && signals === 3 && node.replaced === 3,
      "F: AND UNGREYS THEM WHEN IT ENDS — one signal, one redraw", { note: noteOf(), back: back, signals: signals, redraws: node.replaced });
    deferPage = false;
    // THE FIFTY-SEVENTH SIGNATURE: a redraw raises nothing. Asked again with nothing changed, it draws nothing and says nothing.
    if (refresh) refresh();
    await flush();
    ok(signals === 3 && node.replaced === 3, "F: A REDRAW RAISES NOTHING (the fifty-seventh signature) — asked again with nothing changed, nothing drawn, nothing said", { signals: signals, redraws: node.replaced });
    // CLOSED: the signal heard, nothing drawn; OPENED: drawn as it stands, once.
    view.right = "chat";
    await vote("@new:hs");
    ok(signals === 4 && node.replaced === 3 && noteOf() === "A table of 1 people.", "F: NOT WHILE THE PANEL IS CLOSED — the change said, nothing drawn", { signals: signals, redraws: node.replaced, note: noteOf() });
    view.right = "gear";
    await openGear();
    ok(noteOf() === "A table of 3 people." && node.replaced === 4, "F: AND WHEN THE PANEL OPENS, THE CARD IS DRAWN AS IT STANDS (`_renderGear`) — once", { note: noteOf(), redraws: node.replaced });
    await openGear();
    ok(node.replaced === 4 && signals === 4, "F: opened again with nothing changed, nothing drawn", { redraws: node.replaced, signals: signals });
    // A FLOW HOLDS THE CARD STILL: Start fresh's preview stays while a change is heard; the change is drawn once it settles.
    const fresh = btnOf("Start fresh");
    if (fresh) fresh.onclick();
    await flush();
    const pv = repBox()[0] ? byClass(repBox()[0], "rep-preview")[0] : null;
    await vote("@new2:hs");
    const pvStill = repBox()[0] ? byClass(repBox()[0], "rep-preview")[0] : null;
    ok(pv && pvStill === pv && signals === 5 && node.replaced === 4 && noteOf() === "A table of 3 people.",
      "F: A FLOW HOLDS THE CARD STILL — Start fresh's preview stays open while a change is heard", { preview: !!pv, same: pvStill === pv, signals: signals, redraws: node.replaced });
    if (pv) flat(pv).find((x) => x.textContent === "Cancel").onclick();
    await flush();
    ok(noteOf() === "A table of 4 people." && node.replaced === 5 && w.redraws === 0, "F: AND THE CHANGE IS DRAWN WHEN IT SETTLES — cancelled, the card as it stands, once", { note: noteOf(), redraws: node.replaced });
    // ITS LAST MESSAGE STAYS; LOCKED, THE REDRAWN CARD STAYS LOCKED.
    const msgOf = () => { const b = repBox()[0]; const m = b ? byClass(b, "rep-card-msg")[0] : null; return m; };
    if (msgOf()) msgOf().textContent = "out of range";
    view.locked = true;
    await vote("@new3:hs");
    const ctl = repBox()[0] ? flat(repBox()[0]).filter((x) => x.tag === "input" || x.tag === "button") : [];
    ok(noteOf() === "A table of 5 people." && msgOf() && msgOf().textContent === "out of range", "F: a redraw keeps what the card last said", { note: noteOf(), msg: msgOf() && msgOf().textContent });
    ok(ctl.length > 0 && ctl.every((x) => x.disabled === true), "F: LOCKED, THE REDRAWN CARD STAYS LOCKED — every control disabled, as the panel's lock drew it", ctl.map((x) => [x.tag, x.textContent, !!x.disabled]));
  })().catch((e) => ok(false, "F: threw — " + ((e && e.stack) || e)));

  if (failed) { console.log("[bot-card] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[bot-card] PASS — the Bot card shows REP's rows and decides nothing (J84-5, H4; " + asserts + " assertions), the real " +
    "functions run over a recording DOM. ONLY THE BOT has the card, and only it asks REP. THE ROWS are drawn as the bot side gave " +
    "them — heading, note, a number with its range, an on/off box, buttons (disabled where it says), Rebuild with its days and " +
    "its action (J117) — and with no card, no REP section. A CHANGE goes back to its row as the right kind; accepted, the panel redraws; " +
    "refused, the bot side's words show. A BUTTON runs its flow lent download, pick and confirm, and nothing else; cancelled, " +
    "nothing is said. THE PRIMITIVES: confirm shows its lines in the card, flags another room, answers yes or no and goes; " +
    "download hands the JSON over as a file; pick reads a JSON, passes on one that does not parse, and answers nothing when " +
    "cancelled. NO BUTTON MISSING: the real bot side's card, with a table and with none, draws every control J117 needs. " +
    "THE CARD REDRAWS ITSELF (J117): the real bot side says when its card would read differently and the panel redraws that card " +
    "alone — \"Starting…\" to its table with no lock click, one change one redraw, a look that changes nothing silent, a redraw " +
    "raising nothing, not while closed and current when opened, held still by a flow, locked and its message kept. " +
    "THIS GUARD CANNOT SEE A BROWSER SAVE A FILE OR OPEN A PICKER — that is the live batch");
})().catch((e) => { console.log("[bot-card] FAIL — threw: " + ((e && e.stack) || e)); process.exit(1); });
