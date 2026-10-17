// tests/check-bot-card.js
// SUBJECT: ui/settings.js
//
// WALL: THE BOT CARD SHOWS REP'S ROWS AND DECIDES NOTHING (J84-5; H4, the design's §5.1 and §5.3). On the bot's own tab the
// Bot card asks `Rep.botCard()` once and renders what comes back — the bot's own REP settings, the export, the Replace flow,
// the Q4 offers — with the panel's own pieces; a change goes back to the row's own handler, and a refusal is shown as the
// bot side words it. It lends three primitives and only these: download a JSON, pick a JSON, confirm (inline, in the card).
// The real functions are extracted from `ui/settings.js` and run over a small recording DOM.
//
//   A  ONLY THE BOT: a tab that is not the room's bot has no Bot card, and REP is never asked.
//   B  THE ROWS: the heading, the note, a number with its range, an on/off box, buttons (one disabled when the bot side
//      says so), the Q4 "look further back" with its days; and no REP section at all when REP has no card.
//   C  A CHANGE GOES BACK, A REFUSAL IS SHOWN: a number and a box hand their value to the row; accepted, the panel
//      redraws; refused, the bot side's words are shown and nothing redraws; a button runs its flow with the primitives;
//      a cancelled flow says nothing.
//   D  THE PRIMITIVES: confirm shows the lines in the card (another room flagged) and answers yes or no, then goes away;
//      download hands the JSON to the browser as a file; pick reads a chosen file as JSON, hands on one that does not
//      parse as such, and answers nothing when cancelled.
"use strict";
const vm = require("vm");
const XI = require("./_probe-j14-card.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[bot-card] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

const NAMES = ["_prefCard", "_botViewSection", "_repSection", "_repRow", "_repUi"];
const X = NAMES.map((n) => XI.extractNamed("ui/settings.js", n));
ok(X.every((x) => x.ok), "PREMISE — the Bot card's functions are each declared once in ui/settings.js", X.map((x, i) => NAMES[i] + ": " + (x.stage || "ok")));

// ── A recording DOM, just enough of it ────────────────────────────────────────────────────────────────────────────────
function node(tag) {
  const n = { tag: tag, className: "", textContent: "", children: [], attrs: {}, style: {}, parent: null, listeners: {}, clicked: 0,
    appendChild(c) { c.parent = this; this.children.push(c); return c; },
    insertBefore(c, ref) { c.parent = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, fn) { this.listeners[t] = fn; },
    click() { this.clicked++; if (this.onclick) this.onclick(); } };
  return n;
}
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
  vm.runInContext(X.map((x) => x.source).join("\n") + "\n;this.section = _botViewSection; this.ui = _repUi;", ctx);
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
    { kind: "days", key: "lookFurther", label: "Look further back", unit: "days", value: 28, min: 1, max: 365, run: (ui, d) => { seen.run.push(["lookFurther", d]); return { ok: false, why: "only with no table and no summary" }; } },
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
  ok(btn("Export reputation table") && btn("Replace reputation table…") && btn("Replace reputation table…").disabled === true && btn("Start fresh") && btn("Look"),
    "B: the buttons, one disabled where the bot side says so, and Look further back with its days", buttons.map((x) => [x.textContent, !!x.disabled]));
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
  const days = inputs.find((x) => x.attrs.type === "number" && x.value === "28");
  days.value = "30"; btn("Look").onclick();
  ok(seen.run.some((r) => r[0] === "lookFurther" && r[1] === 30) && msg.textContent === "only with no table and no summary",
    "C: Look further back hands its days, and shows a refusal", { run: seen.run.map((r) => r[0] + ":" + (typeof r[1] === "number" ? r[1] : "ui")), msg: msg.textContent });

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

  if (failed) { console.log("[bot-card] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[bot-card] PASS — the Bot card shows REP's rows and decides nothing (J84-5, H4; " + asserts + " assertions), the real " +
    "functions run over a recording DOM. ONLY THE BOT has the card, and only it asks REP. THE ROWS are drawn as the bot side gave " +
    "them — heading, note, a number with its range, an on/off box, buttons (disabled where it says), Look further back with its " +
    "days — and with no card, no REP section. A CHANGE goes back to its row as the right kind; accepted, the panel redraws; " +
    "refused, the bot side's words show. A BUTTON runs its flow lent download, pick and confirm, and nothing else; cancelled, " +
    "nothing is said. THE PRIMITIVES: confirm shows its lines in the card, flags another room, answers yes or no and goes; " +
    "download hands the JSON over as a file; pick reads a JSON, passes on one that does not parse, and answers nothing when " +
    "cancelled. THIS GUARD CANNOT SEE A BROWSER SAVE A FILE OR OPEN A PICKER — that is the live batch");
})().catch((e) => { console.log("[bot-card] FAIL — threw: " + ((e && e.stack) || e)); process.exit(1); });
