// tests/check-settings-apply.js
// SUBJECT: ui/settings.js, index.html
// WALL: room settings are STAGED and sent with Apply, and one Apply is ONE message however many
// settings changed (owner rulings, ddjp_446 — recorded in main/04-features.md §Room settings panel).
//
// The real `ui/settings.js` is loaded WHOLE and driven the way a person drives it — clicking pills,
// typing into inputs, pressing the lock and Apply — against the reducer's real defaults, ranges and
// table builder. Only the edges are doubles: the DOM (no browser here), the adapter and the bot
// request (RECORDING, so the guard counts what would reach the wire), and the room's identity.
//
//   PART A — the owner: several edits send NOTHING until Apply, and Apply sends ONE write with all.
//   PART B — ANY lock discards (owner ruling): the lock button, the relock a tab switch performs,
//            and leaving the room each empty the staged set.
//   PART C — a delegated person: several edits become ONE bot request carrying every key.
//   PART D — the background link: no Set button; an unapproved link holds Apply back; Clear stages
//            the removal.
//   PART E — no per-row Set / Save button survives anywhere in the panel.
//   PART F — after Apply the bar names what the room did not take.
//   PART G — the bar sits above the scroller in both panels (DECLARED for the layout).
//   PART H — an empty queue / playlist feedback line takes no space (DECLARED).
//   PART I — a redraw keeps the reader's place, in both panels.
//   PART J — room settings are built from local settings' shapes: flat cards, checkboxes, radio lists.
//   PART K — local settings' cards carry the same heading element room settings' do.
//   PART L — locked, every row shows what it is set to.
//   PART M — a choice that cannot be changed is the same radio list, disabled, its choice readable (J135; it was ddjp_483's words).
//   PART N — titles explain themselves; each sentence waits under More; values on the title line.
//   PART S — the same locked or unlocked (J135): the same controls, disabled when not changeable; the chosen radio bright.
//   PART R — "Show advanced options" (J127): sends nothing, keeps what is staged, holds back a hidden bad value,
//            and its outline is the toggle's own colour (DECLARED); and (`ddjp_670`, R5) shown again, a bad value is the value
//            that was typed, with its red line, until it is fixed or locked away. And (`ddjp_677`, R6) locked — and always for
//            someone who gets no lock — both settings panels' cards take the chat box's darkness from its own rule, nothing dimmed.
//            And (`ddjp_678`, R7) while locked a skip rule's box takes that darkness on top of its card's — darker, "layered
//            again" — solid unlocked, its frame kept; no other box inside a card left solid (a shared room with no bot, and this
//            device's settings).
//
// THIS GUARD CANNOT TELL YOU HOW ANY OF IT LOOKS. The bar sits above the scroller rather than being
// sticky inside it (ddjp_459) — but clipping, overflow and the phone layout are browser machinery,
// and this harness has no layout engine. PART G asserts the declarations and the DOM placement they
// depend on; how it looks is for a person at a screen, in every layout.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext, ROOT } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[settings-apply] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const BE = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
  "backends/backend1/streammanager.js", "backends/backend1/capabilities.js"], { Date, Math, JSON });
const panelSrc = fs.readFileSync(path.join(ROOT, "ui/settings.js"), "utf8");

// A DOM double shaped like the one `check-settings-rows` PART I uses: onclick/disabled/value are
// PROPERTIES, everything else an attribute, and handlers are assigned as properties by the panel.
const node = (tag) => ({ tag, attrs: {}, text: "", children: [], style: {}, dataset: {}, className: "",
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  appendChild(c) { this.children.push(c); return c; },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); },
  get firstChild() { return this.children[0] || null; },
  setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
  get textContent() { return this.text; }, set textContent(v) { this.text = String(v); }, remove() {} });
const el = (tag, a, kids) => {
  const n = node(tag);
  if (a) for (const k in a) {
    if (k === "text") n.text = String(a[k]); else if (k === "class") n.className = a[k];
    else if (k === "onclick") n.onclick = a[k]; else if (k === "disabled") n.disabled = a[k];
    else if (k === "value") n.value = a[k]; else n.attrs[k] = String(a[k]);
  }
  if (kids) for (const c of kids) if (c) n.children.push(c);
  return n;
};
const find = (n, pred, out) => { out = out || []; if (!n || typeof n !== "object") return out;
  if (pred(n)) out.push(n); for (const c of (n.children || [])) find(c, pred, out); return out; };

// ── A SMALL CASCADE READER OVER THE PAGE'S OWN STYLESHEET (PART O's, lifted at J127 so PART R reads the same one) ──
// Every top-level rule whose selector (classes and tags, joined by ' ' or '>') matches the element and its rendered
// ancestors; the winner for the asked properties by specificity and then order — what a browser computes for that one
// property. Rules inside @media blocks and selectors with any other syntax are not read, and the reader says so: it is a
// reading of the declared rules, not a browser's layout. `winner(chain, props)` treats every name in `props` as setting
// the same thing (`border` and `border-color` both set a border's colour), the later declaration winning a tie.
// ONE CHANGE IN THE LIFT, AND WHY (J127): a class is matched as a WHOLE TOKEN of the element's class list, as a browser
// matches it. PART O's test was `\b<class>\b`, which reads `set-sec` inside `set-sec-body` — so `.set-sec.set-adv` (the
// outlined card's rule) "matched" the outlined BOX, won on order, and hid a wrong colour on the box: `mutate-j127-advanced`
// AV26 stayed green. PART O's readings are unchanged by it (its `flex` rules name no such prefix); its control still reads 92px.
function sheetReader() {
  const cls = (c) => (n) => String(n.className || "").split(/\s+/).indexOf(c) >= 0;
  // Read as a browser reads the page (`tests/_page-css.js`, `ddjp_656`): a raw match lost the page's first rule.
  const styles = require("./_page-css.js").styleBlocks(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  // Every rule, in source order: its selector, its declarations, and whether it sits inside an at-rule (@media).
  const rules = [];
  { const stack = []; let start = 0;
    for (let i = 0; i < styles.length; i++) {
      const ch = styles[i];
      if (ch === "{") { const sel = styles.slice(start, i).trim(); stack.push({ sel, at: /^@/.test(sel), inAt: stack.some((s) => s.at), from: i + 1 }); start = i + 1; }
      else if (ch === "}") { const e = stack.pop(); if (e && !e.at) rules.push({ sel: e.sel, body: styles.slice(e.from, i), media: e.inAt }); start = i + 1; }
      else if (ch === ";" && (!stack.length || stack[stack.length - 1].at)) start = i + 1;
    } }
  // A compound like `.set-num.set-link` or `input.uq-input`; a selector is compounds joined by ' ' or '>'.
  const parseSel = (s) => {
    if (/[:#\[*+~@]/.test(s)) return null;
    const parts = s.replace(/\s*>\s*/g, " > ").trim().split(/\s+/);
    const out = []; let comb = " ";
    for (const p of parts) { if (p === ">") { comb = ">"; continue; }
      const m = p.match(/^([a-z][a-z0-9]*)?((?:\.[A-Za-z0-9_-]+)*)$/); if (!m) return null;
      out.push({ comb, tag: m[1] || null, classes: (m[2] || "").split(".").filter(Boolean) }); comb = " "; }
    return out;
  };
  const fits = (c, n) => (!c.tag || c.tag === n.tag) && c.classes.every((k) => cls(k)(n));
  const matches = (chain, sel) => {          // chain: the element first, then its ancestors outward
    const go = (si, ni) => {
      if (!fits(sel[si], chain[ni])) return false;
      if (si === 0) return true;
      if (sel[si].comb === ">") return ni + 1 < chain.length && go(si - 1, ni + 1);
      for (let k = ni + 1; k < chain.length; k++) if (go(si - 1, k)) return true;
      return false;
    };
    return go(sel.length - 1, 0);
  };
  const winner = (chain, props) => {
    let best = null;
    rules.forEach((r, ri) => {
      if (r.media) return;
      let d = null;
      for (const p of props) {
        const re = new RegExp("(?:^|;)\\s*" + p.replace(/-/g, "\\-") + "\\s*:\\s*([^;]+)", "g");
        let m; while ((m = re.exec(r.body)) !== null) { if (!d || m.index > d.at) d = { value: m[1].trim(), prop: p, at: m.index }; }
      }
      if (!d) return;
      const order = ri + d.at / 1e7;
      for (const s of r.sel.split(",")) {
        const sel = parseSel(s.trim()); if (!sel || !matches(chain, sel)) continue;
        const spec = sel.reduce((a, c) => [a[0] + c.classes.length, a[1] + (c.tag ? 1 : 0)], [0, 0]);
        if (!best || spec[0] > best.spec[0] || (spec[0] === best.spec[0] && (spec[1] > best.spec[1] || (spec[1] === best.spec[1] && order >= best.order))))
          best = { value: d.value, prop: d.prop, sel: s.trim(), spec, order };
      }
    });
    return best;
  };
  const pathTo = (n, target, acc) => { if (n === target) return [n].concat(acc || []).reverse(); for (const c of (n.children || [])) { const p = pathTo(c, target, [n].concat(acc || [])); if (p) return p; } return null; };
  const chainOf = (w, target) => { const p = pathTo(w.box, target); return p ? p.slice().reverse() : null; };
  return { rules, parseSel, matches, winner, chainOf };
}

// One client's panel. `delegated` names the keys a non-owner may request; `owner` decides the route.
// `advanced` is this device's "Show advanced options" as stored (J127, the owner's): OFF unless a part asks, as for a
// person who never touched it. The stub records what the toggle WRITES (`prefWrites`); before J127 it was `{ bgOpts }`.
function world(opts) {
  const o = opts || {};
  const performed = [], requested = [], timers = [], prefWrites = [];
  let advanced = o.advanced === true;
  let locked = !!o.locked, clock = 1000000, room = "!space-a:hs";
  const settings = Object.assign(BE.StateDeriver.defaultSettings(), o.settings || {});
  const slot = node("div");   // the bar's own slot, ABOVE the scroller (ddjp_459)
  const box = node("div");
  // The scrolling area around the box. A BROWSER resets its scroll when the box it holds is emptied
  // (the scrollable height collapses); this double does the same the moment `H.clear` empties the box.
  const scroller = { scrollTop: 0 };
  box.parentNode = scroller;
  class FakeDate extends Date { static now() { return clock; } }
  const ctx = {
    UIBase: { refs: { settingsBox: box, settingsBar: slot }, host: { el, clear: (n) => { if (n) { n.children = []; if (n === box) scroller.scrollTop = 0; } },
      settingsLocked: () => locked, setSettingsLocked: (v) => { locked = !!v; },
      prefsLocked: () => true, setPrefsLocked() {} } },
    Room: {
      getSettings: () => settings, getSettingRanges: () => BE.StreamManager.settingRanges(),
      getSettingRows: () => BE.Capabilities.settingsRows(),
      editSettingTable: (t, i, e, w, a) => BE.Capabilities.applyTableEdit(t, i, e, w, a),
      idleSettings: () => [], getMyAuthorityLevel: () => (o.owner === false ? 60 : 100),
      getCurrent: () => ({ spaceId: room, channels: { events_L60: "!ev:hs" } }),
      overrideFromFile: async () => ({ ok: true }), idleFor: () => null, FEED_KINDS: [],
    },
    Actions: {
      describe: (a) => (a === "room.settings" ? { enabled: o.owner !== false, reason: o.owner === false ? "Only the owner" : null }
        : { enabled: true, reason: null }),
      perform: (a, args) => { performed.push({ a, partial: JSON.parse(JSON.stringify(args && args.partial)) }); return Promise.resolve({ ok: true }); },
    },
    BotSettings: {
      decide: (req) => ((o.delegated || []).indexOf(req.k) >= 0 ? { ok: true, key: req.k, value: req.v } : { ok: false }),
      request: (ch, lvl, values) => { requested.push(JSON.parse(JSON.stringify(values))); return Promise.resolve({ ok: true }); },
    },
    BotRuntime: { botInRoom: () => o.bot !== false },   // ADDED at `ddjp_678` (R7): a room with no bot, as `o.bot: false`; a bot by default, as before
    ChatPanels: { _settingDisplayName: (k) => "«" + k + "»" },
    Screens: { renderExportSection() {} }, QueuePanels: { _disableAllControls() {} },
    Media: { safeBgUrl: (raw) => (/^https:\/\/img\.ok\/.+\.png$/.test(raw) ? raw : null) },
    ChatPrefs: { bgOpts: () => ({ bgOn: true, hostAllowed: () => true }),
      advancedShown: () => advanced, setAdvancedShown: (v) => { prefWrites.push(v); advanced = !!v; } },
    Logger: { info() {}, warn() {}, debug() {}, error() {} },
    document: { createElement: node, body: node("body") },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    console, Date: FakeDate, Math, JSON, Promise, Object, Array, String, Number, Set, Error,
  };
  vm.createContext(ctx);
  // The activity groups' names are ui/base.js's ONE shared table (ddjp_456); the panel asks the host for
  // them, so the REAL functions are run here and handed over as base.js's `publish` does.
  const _baseNames = ["ACTIVITY_GROUP_NAMES", "activityGroupName"].map((n) => {
    const x = require("./_probe-j14-card.js").extractNamed("ui/base.js", n);
    if (!x.ok) throw new Error("shared group names not extractable: " + x.stage);
    return x.source;
  }).join("\n");
  vm.runInContext(_baseNames + "\n;UIBase.host.activityGroupName = activityGroupName;\n" +
    panelSrc + "\n;globalThis.__S = Settings;", ctx);
  const S = ctx.__S;
  const render = () => S.renderSettings();
  const openAll = () => {
    for (let pass = 0; pass < 60; pass++) {
      const closed = find(box, (n) => /^set-(sec|sub)-head$/.test(n.className) && n.attrs["aria-expanded"] === "false");
      if (!closed.length) break;
      closed[0].onclick();
    }
  };
  const row = (key) => find(box, (n) => n.attrs && n.attrs["data-key"] === key)[0] || null;
  const bar = () => find(slot, (n) => /\bsettings-bar\b/.test(n.className))[0] || null;
  const apply = () => { const b = bar(); return b ? find(b, (n) => /\bsettings-apply\b/.test(n.className))[0] || null : null; };
  const lockBtn = () => { const b = bar(); return b ? find(b, (n) => /\bsettings-lock\b/.test(n.className))[0] || null : null; };
  const status = () => { const b = bar(); const s = b ? find(b, (n) => /\bsettings-bar-status\b/.test(n.className))[0] : null; return s ? s.text : ""; };
  // A choice row: pick the first enabled, unchecked RADIO (ddjp_464 — they were pill buttons), the way a
  // person does, and return the label it stood for.
  const pickOther = (key) => {
    const r = row(key); if (!r) return null;
    const x = find(r, (n) => n.tag === "input" && n.attrs.type === "radio" && !n.checked && !n.disabled && n.onchange)[0];
    if (!x) return null;
    x.checked = true; x.onchange();
    const lab = find(r, (n) => n.tag === "label" && n.children.indexOf(x) >= 0)[0];
    const t = lab ? lab.children.find((c) => c !== x) : null;
    return (t && t.text) || "?";
  };
  // An on/off row: its one checkbox, flipped the way a person flips it.
  const toggle = (key) => {
    const r = row(key); if (!r) return null;
    const x = find(r, (n) => n.tag === "input" && n.attrs.type === "checkbox" && !n.disabled && n.onchange)[0];
    if (!x) return null;
    x.checked = !x.checked; x.onchange(); return x.checked;
  };
  const typeInto = (key, value, ev) => {
    const r = row(key); if (!r) return false;
    const inp = find(r, (n) => n.tag === "input" && n.attrs.type !== "checkbox")[0];
    if (!inp) return false; inp.value = String(value); (inp[ev || "onchange"] || (() => {}))(); return true;
  };
  // The "Show advanced options" box (J127), clicked the way a person clicks it.
  const advBox = () => { const t = box.children.find((c) => /\bset-adv-toggle\b/.test(c.className)); return t ? find(t, (n) => n.tag === "input")[0] || null : null; };
  const flipAdvanced = () => { const b = advBox(); if (!b) return null; b.checked = !b.checked; b.onchange(); return b.checked; };
  return { ctx, S, box, slot, scroller, settings, performed, requested, timers, render, openAll, row, bar, apply, lockBtn, status,
    pickOther, toggle, typeInto, setLocked: (v) => { locked = !!v; }, setRoom: (r) => { room = r; }, tick: (ms) => { clock += ms; },
    prefWrites, advBox, flipAdvanced, advanced: () => advanced, isLocked: () => locked };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

async function main() {
  // ═══ PART A — the owner: nothing is sent until Apply, and Apply is ONE write ════════════════
  {
    const w = world({});
    w.render(); w.openAll();
    ok(w.apply(), "A: APPLIED — the room panel renders an Apply control in its bar", w.bar());
    ok(w.apply().disabled === true, "A: Apply is disabled while nothing is staged", w.apply().text);
    const vis = w.pickOther("vis");
    const chat = w.pickOther("chat");
    const cur = w.settings.maxLen, lim = BE.StreamManager.settingRanges().maxLen, f = lim.scale || 1;
    const next = (cur + (lim.max > cur + 60 * f ? 60 * f : -60 * f)) / f;
    const typed = w.typeInto("maxLen", next);
    ok(vis && chat && typed, "A: APPLIED — two choice rows and one number row were edited", { vis, chat, typed });
    ok(w.performed.length === 0 && w.requested.length === 0,
      "A: THREE EDITS SEND NOTHING — the panel stages them; nothing reaches the adapter before Apply", w.performed);
    ok(/\(3\)/.test(w.apply().text) && w.apply().disabled === false, "A: and the bar says three are waiting", w.apply().text);
    w.apply().onclick(); await settle();
    ok(w.performed.length === 1 && w.performed[0].a === "room.settings",
      "A: APPLY SENDS ONE WRITE — one `room.settings` through the adapter, which is one `ddjp.room.settings`", w.performed);
    const p = w.performed[0].partial;
    ok(p && Object.keys(p).sort().join(",") === "chat,maxLen,vis" && p.maxLen === next * f,
      "A: carrying all three staged keys, the number in the reducer's own unit", p);
    ok(w.requested.length === 0, "A: and an owner's Apply is never a bot request", w.requested);
    w.render();
    ok(w.apply().disabled === true && !/\(\d+\)/.test(w.apply().text), "A: once sent, nothing is left staged", w.apply().text);
  }

  // ═══ PART A2 — two edits in ONE table before Apply both survive ═════════════════════════════════
  // A typed row stages WITHOUT redrawing, so its handler must build on the latest staged table, not
  // the one it was drawn with — or the second edit silently erases the first.
  // RUNS WITH "SHOW ADVANCED OPTIONS" ON (J127): both per-rank tables are among the owner's twelve advanced settings,
  // so there is no shown table to move this to; with the toggle off no table is drawn and there is nothing to edit.
  {
    const w = world({ advanced: true });
    w.render(); w.openAll();
    const rr = find(w.box, (n) => /\bset-rank-row\b/.test(n.className)
      && find(n, (x) => x.tag === "input" && x.attrs.type !== "checkbox").length > 0);
    ok(rr.length >= 2, "A2: APPLIED — at least two editable rank rows render", rr.length);
    const inp = (r) => find(r, (x) => x.tag === "input" && x.attrs.type !== "checkbox")[0];
    const lo = parseInt(inp(rr[0]).min || "1", 10), hi = parseInt(inp(rr[0]).max || "9", 10);
    const want = [hi, hi - 1];
    inp(rr[0]).value = String(want[0]); inp(rr[0]).onchange();
    inp(rr[1]).value = String(want[1]); inp(rr[1]).onchange();
    ok(w.performed.length === 0, "A2: two table edits send nothing before Apply", w.performed);
    w.apply().onclick(); await settle();
    ok(w.performed.length === 1, "A2: Apply is one write", w.performed);
    const p = w.performed[0].partial, ks = Object.keys(p);
    const got = ks.length === 1 && Array.isArray(p[ks[0]]) ? p[ks[0]].map((r) => r && r.enough) : null;
    ok(got && got.indexOf(want[0]) >= 0 && got.indexOf(want[1]) >= 0 && lo <= want[1],
      "A2: BOTH EDITS ARRIVE in the one table — the second built on the first rather than erasing it", { p, want });
  }

  // ═══ PART B — ANY lock discards (owner ruling) ═══════════════════════════════════════════════
  {
    // B1 — the lock button.
    let w = world({});
    w.render(); w.pickOther("vis");
    ok(/\(1\)/.test(w.apply().text), "B: APPLIED — one change staged", w.apply().text);
    w.lockBtn().onclick();                 // lock
    ok(w.apply().disabled === true, "B: the lock button disables Apply", w.apply().text);
    w.lockBtn().onclick();                 // unlock again
    ok(!/\(\d+\)/.test(w.apply().text), "B: LOCKING DISCARDED IT — unlocking again finds nothing staged", w.apply().text);
    w.apply().onclick(); await settle();
    ok(w.performed.length === 0, "B: and Apply after a lock sends nothing", w.performed);
    // B2 — the relock every tab switch performs: the lock set from outside, then a render.
    w = world({});
    w.render(); w.pickOther("chat");
    ok(/\(1\)/.test(w.apply().text), "B: APPLIED — one change staged before the tab switch", w.apply().text);
    w.setLocked(true); w.render();          // what `_relockAllPanels` does
    w.setLocked(false); w.render();
    ok(!/\(\d+\)/.test(w.apply().text), "B: A TAB-SWITCH RELOCK DISCARDS TOO — the ruling is ANY lock", w.apply().text);
    // B3 — leaving the room.
    w = world({});
    w.render(); w.pickOther("vis");
    w.setRoom("!space-b:hs"); w.render();
    ok(!/\(\d+\)/.test(w.apply().text), "B: entering another room discards what was staged in the last one", w.apply().text);
    // Control: a plain re-render while unlocked KEEPS staged changes, so the discards above are the lock and the room.
    w = world({});
    w.render(); w.pickOther("vis"); w.render(); w.render();
    ok(/\(1\)/.test(w.apply().text), "B CONTROL: re-rendering while unlocked keeps the staged change", w.apply().text);
  }

  // ═══ PART C — a delegated person: ONE request carrying every key ═════════════════════════════
  // MOVED FROM `graceMs` TO `minLen` (J127): `graceMs` is one of the owner's twelve advanced settings, not drawn while the
  // toggle is off. This part's subject is ONE request carrying every key — a property of staging, not of which row — so
  // it moves to a shown number row and runs on the view a person has by default. Applying a staged ADVANCED row is
  // PART R's, which drives it with the toggle turned off between the edit and Apply.
  {
    const w = world({ owner: false, delegated: ["maxLen", "minLen"] });
    w.render(); w.openAll();
    const lim = BE.StreamManager.settingRanges();
    const mk = (k, d) => { const r = lim[k], f = r.scale || 1; const c = w.settings[k] / f;
      return (c + d <= r.max / f) ? c + d : c - d; };
    const a = mk("maxLen", 60), b = mk("minLen", 1);
    ok(w.typeInto("maxLen", a) && w.typeInto("minLen", b), "C: APPLIED — two delegated number rows were edited");
    ok(w.requested.length === 0 && w.performed.length === 0, "C: nothing is sent before Apply", { r: w.requested, p: w.performed });
    w.apply().onclick(); await settle();
    ok(w.requested.length === 1, "C: APPLY IS ONE BOT REQUEST, not one per setting", w.requested);
    ok(Object.keys(w.requested[0]).sort().join(",") === "maxLen,minLen", "C: carrying both keys", w.requested[0]);
    ok(w.performed.length === 0, "C: and a delegated Apply never writes settings directly", w.performed);
  }

  // ═══ PART D — the background link ═════════════════════════════════════════════════════════════
  {
    const w = world({ settings: { bg: "https://img.ok/old.png" } });
    w.render();
    const r = w.row("bg");
    ok(r, "D: APPLIED — the background row renders");
    ok(find(r, (n) => n.tag === "button" && /^Set$/.test(n.text)).length === 0, "D: there is no Set button (owner ruling)");
    // ANOTHER change is staged first, or a disabled Apply would say only that nothing was staged —
    // which is exactly how this row first passed with the hold-back deleted (M6).
    ok(w.pickOther("vis"), "D: APPLIED — another change is staged first");
    ok(w.apply().disabled === false, "D: CONTROL — with one change staged, Apply is enabled", w.apply().text);
    ok(w.typeInto("bg", "https://evil.example/x.png", "oninput"), "D: APPLIED — a link was typed");
    ok(w.apply().disabled === true, "D: AN UNAPPROVED LINK HOLDS APPLY BACK, even with another change waiting", w.apply().text);
    w.typeInto("bg", "https://img.ok/new.png", "oninput");
    ok(w.apply().disabled === false && /\(2\)/.test(w.apply().text), "D: an approved link is staged beside it and releases Apply", w.apply().text);
    w.render();
    const clear = find(w.row("bg"), (n) => n.tag === "button" && /^Clear$/.test(n.text))[0];
    ok(clear, "D: Clear is still there");
    clear.onclick();
    w.apply().onclick(); await settle();
    ok(w.performed.length === 1 && w.performed[0].partial.bg === null && "vis" in w.performed[0].partial,
      "D: Clear stages the removal, sent by Apply in the same one write as the other change", w.performed);
  }

  // ═══ PART E — no per-row Set / Save button anywhere ═══════════════════════════════════════════
  {
    const w = world({});
    w.render(); w.openAll();
    const shown = find(w.box, (n) => n.attrs && n.attrs["data-key"]).length;
    const stray = find(w.box, (n) => n.tag === "button" && /^(Set|Save rules)$/.test(n.text)).map((n) => n.text);
    ok(shown > 10, "E: APPLIED — the whole panel is open (" + shown + " rows)", shown);
    ok(stray.length === 0, "E: NO ROW KEEPS ITS OWN SEND BUTTON — Apply is the only way a room setting leaves", stray);
  }

  // ═══ PART F — after Apply, the bar names what the room did not take ═══════════════════════════
  {
    const w = world({});
    w.render();
    const vis = w.pickOther("vis"), chat = w.pickOther("chat");
    ok(vis && chat, "F: APPLIED — two changes staged");
    w.apply().onclick(); await settle();
    const sent = w.performed[0].partial;
    w.settings.vis = sent.vis;              // the room took the visibility change and not the chat one
    w.tick(60 * 1000); w.render();          // past the settle window, inside the report's life
    const st = w.status();
    ok(/«chat»/.test(st) && !/«vis»/.test(st), "F: THE REPORT NAMES WHAT DID NOT TAKE — chat, and not visibility", st);
    w.settings.chat = sent.chat; w.render();
    ok(!/«chat»/.test(w.status()), "F: and it follows the room — once chat lands, it is no longer named", w.status());
  }

  // ═══ PART G — the bar sits ABOVE the scroller, so nothing scrolls behind it (ddjp_459) ════════════
  // Owner report: scrolled, the settings slid BEHIND the buttons. The bar had been STICKY — inside the
  // scrolling area, pinned while content passed under it — and every look tried for that (an opaque
  // colour: a black square; see-through with a blur: content still visible behind the buttons) failed
  // for the same reason: something WAS behind it. So the bar is no longer inside the scroller at all.
  // Each pane is its bar's slot, then a scrolling area; content is clipped at the scroller's top edge,
  // a small gap below the buttons. DECLARED for the layout — the browser is what clips.
  {
    const w = world({});
    w.render();
    const b = w.bar();
    ok(b && w.lockBtn() && w.apply(), "G: the room panel's bar holds the lock AND Apply", b && b.children.map((c) => c.className));
    ok(find(w.box, (n) => /\bsettings-bar\b/.test(n.className)).length === 0,
      "G: THE BAR IS NOT IN THE SCROLLING BOX — it is rendered into its own slot, so no row can pass behind it", null);
    const shell = fs.readFileSync(path.join(ROOT, "ui/shell.js"), "utf8");
    ok(/refs\.settings = el\("div", \{ class: "settings" \}, \[refs\.settingsBar, el\("div", \{ class: "settings-scroll" \}, \[refs\.settingsBox\]\)\]\)/.test(shell),
      "G: the room pane is its bar's slot THEN the scrolling area (source-level)");
    ok(/refs\.chatSettings = el\("div", \{ class: "chat-settings" \}, \[refs\.chatSettingsBar, el\("div", \{ class: "settings-scroll" \}, \[refs\.chatSettingsBox\]\)\]\)/.test(shell),
      "G: and so is the local pane — both panels, one shape (source-level)");
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const rule = (html.match(/\.settings-bar \{[^}]*\}/) || [""])[0];
    ok(rule && !/sticky/.test(rule) && !/backdrop-filter/.test(rule), "G: the bar is no longer sticky, and needs no see-through blur (DECLARED)", rule);
    ok(/\.settings-scroll \{[^}]*overflow-y:\s*auto/.test(html) && /\.settings, \.chat-settings \{[^}]*overflow:\s*hidden/.test(html),
      "G: the scrolling area scrolls and the pane around it does not (DECLARED)");
    ok(/\.settings-bar-slot:not\(:empty\) \{[^}]*margin-bottom:\s*8px/.test(html), "G: with a small gap below the bar (DECLARED)");
    const userSec = panelSrc.slice(panelSrc.indexOf("function renderChatSettings"), panelSrc.indexOf("══ ROOM SETTINGS PANEL"));
    ok(/refs\.chatSettingsBar/.test(userSec) && /settings-lock/.test(userSec), "G: the local panel renders its lock into its own slot too (source-level)");
  }

  // ═══ PART H — a queue's or playlist's empty feedback line takes no room (ddjp_459) ════════════════
  // The line under the add row ("Added 3, skipped 1.") reserved 16px while empty — the gap the owner
  // found in My queue and inside a playlist. Chat's own feedback line is unchanged, by the owner's choice.
  {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok(/\.uq-note:empty \{[^}]*display:\s*none/.test(html), "H: an empty queue / playlist feedback line takes no space (DECLARED)");
  }

  // ═══ PART I — a redraw keeps the reader's place, in BOTH panels (owner report, ddjp_461) ══════════
  // Local settings jumped back to its first row on every lock click: each panel redraws WHOLE, emptying
  // its box collapses the scrolling area, and a browser that lays it out in between resets the scroll.
  // Room settings happened not to — for no reason anyone wrote down. Both now note the position before a
  // redraw and put it back after, through one helper, so neither depends on the browser's timing.
  {
    const w = world({});
    w.render();
    w.scroller.scrollTop = 300;
    w.lockBtn().onclick();                        // a redraw, the way the owner triggered it
    ok(w.scroller.scrollTop === 300, "I: THE ROOM PANEL KEEPS ITS PLACE across a lock click — the box was emptied and the scroll put back", w.scroller.scrollTop);
    w.pickOther("vis");                            // and across a staged edit, which redraws too
    ok(w.scroller.scrollTop === 300, "I: and across a staged edit", w.scroller.scrollTop);
    // The local panel: the same helper, driven directly, and called by its renderer around the rebuild.
    const X = require("./_probe-j14-card.js").extractNamed("ui/settings.js", "_holdScroll");
    ok(X.ok, "I: APPLIED — `_holdScroll` is extractable from ui/settings.js", X.stage);
    const c = { console }; vm.createContext(c); vm.runInContext(X.source + "\n;globalThis.__h = _holdScroll;", c);
    const sc = { scrollTop: 420 }, bx = { parentNode: sc };
    const restore = c.__h(bx); sc.scrollTop = 0; restore();
    ok(sc.scrollTop === 420, "I: the helper puts back the position it noted", sc.scrollTop);
    // The renderer's EXACT source, brace-matched — a slice to the next function would carry whatever sits between.
    const LX = require("./_probe-j14-card.js").extractNamed("ui/settings.js", "renderChatSettings");
    ok(LX.ok, "I: APPLIED — `renderChatSettings` is extractable", LX.stage);
    const local = LX.source;
    ok(/_holdScroll\(boxEl\)[\s\S]*H\.clear\(boxEl\)/.test(local) && /restoreScroll\(\);\s*\}$/.test(local),
      "I: THE LOCAL PANEL notes its place BEFORE emptying the box and puts it back at the END of the redraw (source-level)", null);
  }

  await (async () => {
  // ═══ PART J — room settings look literally like local settings (owner-approved canvas, ddjp_464) ═════
  // Flat cards — no collapsing — each with a small heading; a sub-group is its OWN card, after its
  // parent. On/off is a checkbox with its title; a choice among several is a radio list; the "what counts"
  // switches are a checkbox list — the shapes local settings uses. Staging and Apply are unchanged.
  {
    const w = world({});
    w.render();                                       // NOTHING opened: every setting must already be there
    const heads = find(w.box, (n) => /\bset-(sec|sub)-head\b/.test(n.className));
    ok(heads.length === 0, "J: NO SECTION COLLAPSES — there are no section headers to open", heads.length);
    const cards = w.box.children.filter((c) => /\bset-sec\b/.test(c.className));
    ok(cards.length >= 5 && cards.every((c) => c.children[0] && /\bset-card-head\b/.test(c.children[0].className) && c.children[0].text),
      "J: flat cards at the panel's root, each with its small heading", cards.map((c) => c.children[0] && c.children[0].text));
    const presence = cards.find((c) => c.attrs["data-section"] === "presence");
    ok(presence, "J: the Room presence card is its OWN card at the panel's root", cards.map((c) => c.attrs["data-section"]));
    const inputs = (key, type) => { const r = w.row(key); return r ? find(r, (n) => n.tag === "input" && n.attrs.type === type) : []; };
    // The chat switch is a tick in the actions list since ddjp_621 (the owner's change, check 14); it is still ONE checkbox.
    ok(inputs("botPresenceChat:tick", "checkbox").length === 1, "J: an on/off setting is ONE checkbox", inputs("botPresenceChat:tick", "checkbox").length);
    ok(inputs("vis", "radio").length === 2 && inputs("chat", "radio").length >= 2, "J: a choice among several is a radio list", { vis: inputs("vis", "radio").length, chat: inputs("chat", "radio").length });
    ok(inputs("minDjRank", "radio").length >= 2, "J: and so is the minimum DJ rank", inputs("minDjRank", "radio").length);
    const groups = inputs("activityPresence", "checkbox");
    ok(groups.length === 7, "J: the 'what counts' switches are a checkbox list, one per group and one for chat (ddjp_621)", groups.length);
    // A CHOICE pill carried aria-pressed; buttons that DO something (Clear, Remove, Hide the list) never did.
    const pills = find(w.box, (n) => n.tag === "button" && /\bset-opt\b/.test(n.className) && n.attrs["aria-pressed"] !== undefined);
    ok(pills.length === 0, "J: no choice is a button pill any more, anywhere in the room panel", pills.length);
    // Still STAGED and sent in ONE Apply: a checkbox and a radio, then Apply.
    const before = w.settings.botPresenceChat;
    ok(w.toggle("botPresenceChat:tick") === !before && w.pickOther("vis"), "J: APPLIED — a checkbox flipped and a radio picked");
    ok(w.performed.length === 0, "J: nothing is sent before Apply", w.performed);
    w.apply().onclick();
    await Promise.resolve().then(() => {}).then(() => {
      ok(w.performed.length === 1 && w.performed[0].partial.botPresenceChat === !before && "vis" in w.performed[0].partial,
        "J: and Apply sends both in ONE write", w.performed);
    });
  }
  })();

  // ═══ PART K — local settings built the SAME way as room settings (owner-approved canvas, ddjp_465) ═══
  // Every local card carries the same small heading room settings' cards do — the ONE `set-card-head`, not
  // a look-alike; a card whose bold title WAS its heading (Appearance, Room events in chat) has only the
  // heading now; the bot's section is a card with a checkbox, not a loose row with a button. Driven: the
  // REAL `renderChatSettings` over the REAL ChatPrefs.
  {
    let saved = null;
    const Store = { prefs: { load: () => saved, save: (o) => { saved = JSON.parse(JSON.stringify(o)); } } };
    const { ChatPrefs: CP } = loadInContext(["core/chatprefs.js"], { URL, Store, Logger: { warn() {}, info() {}, error() {}, debug() {} } });
    CP.load();
    const renderLocal = (actingAsBot) => {
      const w = world({});
      const lbox = node("div"), lbar = node("div");
      w.ctx.UIBase.refs.chatSettingsBox = lbox; w.ctx.UIBase.refs.chatSettingsBar = lbar;
      w.ctx.UIBase.host.prefsLocked = () => false;
      w.ctx.ChatPrefs = CP;
      w.ctx.BotRuntime = { botInRoom: () => true, actingAsBot: () => actingAsBot };
      w.ctx.Room.FEED_KINDS = { "ddjp.dj.play": { verb: "started a song", shownByDefault: true } };
      w.ctx.document.documentElement = { style: { setProperty() {} } };
      w.S.renderChatSettings();
      const body = find(lbox, (n) => /\bprefs-body\b/.test(n.className))[0];
      return { body, cards: body ? body.children.filter((c) => /\bpref-section\b/.test(c.className)) : [] };
    };
    const r = renderLocal(false);
    ok(r.body && r.cards.length >= 5, "K: APPLIED — the local panel renders its cards", r.cards.length);
    const heads = r.cards.map((c) => (c.children[0] && /\bset-card-head\b/.test(c.children[0].className)) ? c.children[0].text : null);
    ok(heads.join("|") === "Images|Links|Appearance|Room events in chat|Sounds",
      "K: EVERY LOCAL CARD HAS THE SAME HEADING room settings' cards have, with the approved names", heads);
    const titles = r.cards.map((c) => find(c, (n) => /\bpref-title\b/.test(n.className)).map((n) => n.text));
    ok(!titles[2].includes("Appearance") && !titles[3].includes("Room events in chat"),
      "K: a card whose bold title WAS its heading has only the heading now — nothing said twice", titles);
    const bot = renderLocal(true).cards.find((c) => c.children[0] && c.children[0].text === "Bot");
    ok(bot, "K: signed in as the room's bot, the bot section is a CARD headed Bot");
    ok(bot && find(bot, (n) => n.tag === "input" && n.attrs.type === "checkbox").length === 1 &&
       find(bot, (n) => n.tag === "button").length === 0,
      "K: with ONE checkbox and no button — local's shape, like every other on/off", bot && bot.children.map((c) => c.className));
    ok(!renderLocal(false).cards.some((c) => c.children[0] && c.children[0].text === "Bot"), "K: CONTROL — not the bot, no Bot card");
    // BOTH PANELS, ONE CARD: room's groups and local's cards share one CSS rule and one heading element.
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok(/\.pref-section, \.set-sec \{/.test(html), "K: the two panels' cards are ONE CSS rule (DECLARED)");
    const room = world({}); room.render();
    const rc = room.box.children.filter((c) => /\bset-sec\b/.test(c.className));
    ok(rc.length > 0 && rc.every((c) => /\bset-card-head\b/.test((c.children[0] || {}).className || "")),
      "K: and room settings' cards start with the same heading element", rc.length);
  }

  // ═══ PART L — locked, or for someone who cannot change it, EVERY row shows what it is set to (ddjp_479) ═══
// A row that showed nothing while locked — and an empty box once unlocked — looked as if the option only
// existed when unlocked. The room background (none set) and the skip rules (none) did exactly that.
// CHANGED ON PURPOSE (`ddjp_680`, J135): a locked row draws the same controls it draws unlocked, disabled (PART S), so an empty
// background is its box's own "No background" and an empty skip list the editor's "No skip rules"; nothing is a line of words.
{
  const flatL = (n) => [n].concat(...((n && n.children) || []).map(flatL));
  // RUNS WITH "SHOW ADVANCED OPTIONS" ON (J127). This part claims EVERY row shows its value, and its table branch
  // (`tableShows`) only runs when a table is drawn — both tables are advanced. With the toggle off, twelve rows would be
  // exempt by not being drawn, and the table branch would never be reached.
  const w = world({ locked: true, advanced: true, settings: { bg: "", skipRoads: [] } });
  w.render(); w.openAll();
  const rowFor = (k) => flatL(w.box).find((n) => (n.getAttribute ? n.getAttribute("data-key") : null) === k || (n.dataset && n.dataset.key === k));
  const valueText = (k) => { const r = rowFor(k); const v = r && flatL(r).find((n) => /\bset-value\b/.test(n.className || "")); return v ? (v._text || v.text || v.textContent || "") : null; };
  const bgBox = (() => { const r = rowFor("bg"); return r ? flatL(r).find((n) => n.tag === "input") || null : null; })();
  ok(bgBox && bgBox.disabled === true && !bgBox.value && bgBox.attrs.placeholder === "No background",
    "L: LOCKED, NO BACKGROUND SET — the row says so in its own box (\"No background\"), drawn and disabled", bgBox && { disabled: bgBox.disabled, value: bgBox.value, placeholder: bgBox.attrs.placeholder });
  ok(valueText("skipRoads") === "No skip rules", "L: LOCKED, NO SKIP RULES — the row says so, instead of showing nothing", valueText("skipRoads"));
  const stateOf = (r) => flatL(r).some((x) => x.tag === "input" || x.tag === "select" || /\b(set-value|dim-row|set-rule)\b/.test(x.className || "") || /\bmuted\b/.test(x.className || ""));
  // A TABLE setting's title row holds only its heading; each rank's value is its own row right after it —
  // so a table counts as showing its state when EVERY one of those rank rows shows a value, in a box or (the structural rung)
  // as words.
  const rankRowsAfter = (n) => {
    const par = flatL(w.box).find((p) => (p.children || []).indexOf(n) >= 0);   // this world's nodes do not record a parent
    const sib = (par && par.children) || [];
    const out = [];
    for (let i = sib.indexOf(n) + 1; i < sib.length && /\bset-rank-row\b/.test(sib[i].className || ""); i++) out.push(sib[i]);
    return out;
  };
  const tableShows = (n) => { const rr = rankRowsAfter(n); return rr.length > 0 && rr.every((r) => flatL(r).some((x) => /\bset-value\b/.test(x.className || "") || x.tag === "input")); };
  const blank = flatL(w.box).filter((n) => /\bset-row\b/.test(n.className || "") && (n.getAttribute && n.getAttribute("data-key")) && !stateOf(n) && !tableShows(n)).map((n) => n.getAttribute("data-key"));
  ok(blank.length === 0, "L: and NO row, locked, shows nothing — every setting shows what it is set to, whoever is looking", blank);
}

  // ═══ PART M — a choice that cannot be changed is THE SAME LIST, its chosen option readable (J135, replacing ddjp_483) ═══
  // CHANGED ON PURPOSE (`ddjp_680`). It held ruling ddjp_483: a choice that cannot be changed shows its chosen option's WORDS,
  // because a disabled radio is drawn in the browser's grey, chosen and unchosen alike. The owner's J135 ("have the settings all
  // shown the same but uneditable even unlocked if no rights to them"; shown the two greys, "teh right one readable"): the
  // same radio list, locked or not, disabled when it cannot be changed, its chosen one drawn bright by the sheet (PART S,
  // DECLARED). Compared against the UNLOCKED render of the same settings, so no label is restated here.
  {
    // Each list set to its SECOND option, so "the first option" cannot pass. Who can DJ's order is the
    // reducer's own (it lists guest FIRST), so its second value is read from that table, never assumed.
    const two = { vis: "public", chat: "guest", minDjRank: BE.StreamManager.settingRanges().minDjRank.values[1] };
    const radioRows = (w) => find(w.box, (n) => n.attrs && n.attrs["data-key"] && find(n, (x) => x.tag === "input" && x.attrs.type === "radio").length > 0);
    const open = world({ locked: false, settings: two }); open.render();
    const choiceKeys = radioRows(open).map((r) => r.attrs["data-key"]);
    ok(choiceKeys.length >= 3, "M: APPLIED — unlocked, the choice rows render radio lists to choose from", choiceKeys);
    const chosenAt = (w, key) => find(w.row(key), (x) => x.tag === "input" && x.attrs.type === "radio").findIndex((x) => x.checked);
    const labels = (w, key) => find(w.row(key), (n) => n.tag === "label").map((l) => { const t = l.children.find((c) => c.tag === "span"); return t ? t.text : null; });
    ok(choiceKeys.every((k) => chosenAt(open, k) > 0), "M: APPLIED — each unlocked list has the room's option chosen, and it is NOT the first one", choiceKeys.map((k) => [k, chosenAt(open, k)]));
    ok(choiceKeys.every((k) => find(open.row(k), (x) => x.tag === "input" && x.attrs.type === "radio").every((x) => !x.disabled)), "M: unlocked, the owner's radios are enabled");
    for (const [who, w] of [["LOCKED", world({ locked: true, settings: two })], ["NOT YOURS TO CHANGE", world({ locked: false, owner: false, settings: two })]]) {
      w.render();
      const keys = radioRows(w).map((r) => r.attrs["data-key"]);
      ok(JSON.stringify(keys) === JSON.stringify(choiceKeys), "M: " + who + ", THE SAME CHOICE ROWS DRAW THEIR RADIO LISTS — no line of words in their place", keys);
      const wrong = choiceKeys.filter((k) => chosenAt(w, k) !== chosenAt(open, k) || JSON.stringify(labels(w, k)) !== JSON.stringify(labels(open, k)));
      ok(wrong.length === 0, "M: " + who + ", each list holds the same options with the same one chosen — the choice can be read", wrong);
      const live = choiceKeys.filter((k) => find(w.row(k), (x) => x.tag === "input" && x.attrs.type === "radio").some((x) => !x.disabled));
      ok(live.length === 0, "M: " + who + ", AND EVERY RADIO IS DISABLED — no click, tap or key can change it", live);
      ok(choiceKeys.every((k) => !find(w.row(k), (n) => /\bset-value\b/.test(n.className || "")).length), "M: " + who + ", no row keeps the old line of words");
    }
    const odd = world({ locked: true, settings: { vis: "not-an-option" } }); odd.render();
    ok(chosenAt(odd, "vis") === -1 && find(odd.row("vis"), (x) => x.tag === "input").length === 2,
      "M: a value that is none of the options chooses none, rather than naming a choice nobody made", chosenAt(odd, "vis"));
  }

  // ═══ PART N — the title says what it is; its sentence waits under More (owner-approved preview, ddjp_487) ═══
  // Every row stacked a title, a sentence and its control, so the panel read as prose. Each title now
  // explains itself, the sentence and any detail sit behind one More, a number sits on its title line, and
  // a locked row is one line. The style is the panel's own; only where things sit changed.
  {
    // The three whose sentence only repeated the title are gone as rows: `botPresenceSpine` at ddjp_498, and the two chat
    // switches at ddjp_621, which are ticks inside the actions lists now (PART Q). So every row offers More.
    const DROPPED = [];
    const cls = (c) => (n) => new RegExp("\\b" + c + "\\b").test(n.className || "");
    // A key with ":" is an item INSIDE a row (one tick of an actions list), not a row of its own.
    const keyed = (w) => [...new Set(find(w.box, (n) => n.attrs && n.attrs["data-key"]).map((n) => n.attrs["data-key"]))].filter((k) => k.indexOf(":") < 0);
    // RUNS WITH "SHOW ADVANCED OPTIONS" ON (J127), unlocked and locked: this part claims something of EVERY row — its
    // title, its More, its number on the title line — and with the toggle off the twelve advanced rows would be exempt by
    // not being drawn, most of them number rows.
    const open = world({ locked: false, advanced: true }); open.render();
    const keys = keyed(open);
    ok(keys.length >= 25, "N: APPLIED — the owner's unlocked panel draws its setting rows", keys.length);
    const inline = keys.filter((k) => (open.row(k).children || []).some((c) => cls("set-desc")(c) || cls("pref-note")(c)));
    ok(inline.length === 0, "N: NO ROW PRINTS ITS EXPLANATION under its title any more", inline);
    const noMore = keys.filter((k) => DROPPED.indexOf(k) < 0 && !find(open.row(k), cls("set-more")).length);   // the DROPPED may have none
    ok(noMore.length === 0, "N: EVERY ROW OFFERS MORE, so no explanation is lost", noMore);
    // The three whose sentence only repeated the title lose THAT sentence (owner-approved preview); any further
    // detail they had stays under their More, since dropping it would lose something the title does not say.
    const REPEATS = ["Queueing, voting, saving and similar actions count as activity.", "Sending a chat message counts as activity.",
      "Sending a chat message keeps your queue place."];
    const repeated = [];
    for (const k of DROPPED) {
      const b = keys.indexOf(k) >= 0 ? find(open.row(k), cls("set-more"))[0] : null;
      if (b) { b.onclick(); const t = find(open.row(k), cls("set-more-text"))[0]; if (t && REPEATS.some((x) => t.text.indexOf(x) >= 0)) repeated.push(k); }
    }
    ok(repeated.length === 0 && DROPPED.every((k) => keys.indexOf(k) >= 0), "N: and the three whose sentence only repeated the title no longer say it (owner-approved)", repeated);
    const empty = [];
    for (const k of keys) {
      const b = find(open.row(k), cls("set-more"))[0];
      if (!b) continue;
      if (!find(open.row(k), cls("set-more-text")).length) b.onclick();   // open it only if it is not open already
      const t = find(open.row(k), cls("set-more-text"))[0];
      if (!t || !t.text || t.text.length < 12) empty.push(k);
    }
    ok(empty.length === 0, "N: and opening it shows the explanation", empty);
    // A NUMBER ROW is one whose one control is a number — not the skip rules, whose rules each hold numbers.
    const numRows = keys.filter((k) => find(open.row(k), (n) => n.tag === "input" && n.attrs.type === "number").length === 1);
    const offLine = numRows.filter((k) => { const line = find(open.row(k), cls("set-title-line"))[0];
      return !(line && find(line, (n) => n.tag === "input" && n.attrs.type === "number").length); });
    ok(numRows.length >= 10 && offLine.length === 0, "N: a number row's input sits ON ITS TITLE LINE", { numRows: numRows.length, offLine });
    // Owner report, ddjp_488: the boxes did not line up, each sitting where its text ended. The text goes FIRST.
    const boxNotLast = numRows.filter((k) => { const n = find(open.row(k), cls("set-num"))[0], ch = n ? (n.children || []).filter(Boolean) : [];
      return !(ch.length && ch[ch.length - 1].tag === "input"); });
    ok(boxNotLast.length === 0, "N: a number's words, range and unit come BEFORE its box, so every box ends at the same edge", boxNotLast);
    // And a skip rule keeps each label WITH its box, label first, so a narrow window cannot split them.
    const sk = open.row("skipRoads"), ins = sk ? find(sk, (n) => n.tag === "input" && n.attrs.type === "number") : [];
    const loose = ins.filter((i) => { const pair = find(sk, (n) => cls("set-pair")(n) && (n.children || []).indexOf(i) >= 0)[0];
      return !(pair && pair.children[0] && cls("set-unit")(pair.children[0]) && pair.children[1] === i); });
    ok(ins.length >= 4 && loose.length === 0, "N: every skip-rule box sits in one group with its label, label first", { boxes: ins.length, loose: loose.length });
    const csx = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok(/\.set-title-line > \.set-num \{[^}]*margin-left:\s*auto/.test(csx) && /\.set-pair \{[^}]*display:\s*inline-flex[^}]*white-space:\s*nowrap/.test(csx),
      "N: the box is pushed to the right edge even on a wrapped line, and a label and its box wrap as one (DECLARED)");
    // Owner report, ddjp_489: a skip rule's boxes sat after their labels, not at the edge the number boxes share.
    ok(/\.set-rule \.set-num \{[^}]*flex-direction:\s*column/.test(csx) && /\.set-rule \.set-pair \{[^}]*justify-content:\s*space-between/.test(csx),
      "N: a skip rule gives each label and box ITS OWN LINE, the box at the right edge like a number row's (DECLARED)");
    const lk = world({ locked: true, advanced: true }); lk.render();   // ON, for the same reason as `open` above (J127)
    // Locked, a row that says its value says it on the title line — except where the value is a LIST or a
    // LINK, which no single line holds: the skip rules and the background, below as the approved preview has them.
    const BELOW = ["bg", "skipRoads"];
    const below = keyed(lk).filter((k) => BELOW.indexOf(k) < 0).filter((k) => {
      const r = lk.row(k), vals = find(r, cls("set-value"));
      if (!vals.length) return false;
      const line = find(r, cls("set-title-line"))[0];
      return !(line && vals.every((v) => find(line, (n) => n === v).length));
    });
    ok(below.length === 0, "N: LOCKED, A ROW IS ONE LINE — its value on the title line", below);
  }

  // ═══ PART O — the background link box takes the width it has room for (J112, the owner's answer at ddjp_620) ═══
  // It sat in the number rows' box group and took their fixed 92px — a box for "60", not for a link. Read through a small
  // CASCADE READER over the page's own stylesheet: every top-level rule whose selector (classes and tags, joined by ' ' or
  // '>') matches the element and its rendered ancestors, the winner for `flex` by specificity and then order — what a
  // browser computes for that one property. Rules inside @media blocks and selectors with any other syntax are not read,
  // and the reader says so: it is a reading of the declared rules, not a browser's layout.
  {
    const cls = (c) => (n) => new RegExp("\\b" + c + "\\b").test(n.className || "");
    // THE READER IS `sheetReader` NOW, LIFTED OUT OF THIS PART UNCHANGED (J127), so PART R reads the same cascade
    // rather than a copy of it; `flexOf` is its winner for the one property this part asks about.
    const SR = sheetReader();
    const rules = SR.rules;
    ok(rules.length > 100 && rules.some((r) => r.sel === ".set-num .uq-input"), "O PREMISE — the page's stylesheet was read into rules", rules.length);
    const flexOf = (chain) => { const b = SR.winner(chain, ["flex"]); return b ? { flex: b.value, sel: b.sel, spec: b.spec, order: b.order } : null; };
    const chainOf = SR.chainOf;
    const open = world({ locked: false }); open.render();
    const bgRow = open.row("bg");
    const input = bgRow ? find(bgRow, (n) => n.tag === "input" && n.attrs["aria-label"] === "Background image link")[0] : null;
    ok(!!input, "O PREMISE — the owner's unlocked panel draws the background row with its link box");
    // `maxLen`, NOT `checkpointEvery` (J127): the control needs any number box, and `checkpointEvery` is one of the owner's
    // twelve advanced settings, not drawn while the toggle is off. A shown row keeps the control off the toggle.
    const numKey = ["maxLen", "skipVotesNeeded"].find((k) => open.row(k) && find(open.row(k), (n) => n.tag === "input" && n.attrs.type === "number").length) ||
      find(open.box, (n) => n.attrs && n.attrs["data-key"] && find(n, (x) => x.tag === "input" && x.attrs.type === "number").length === 1).map((n) => n.attrs["data-key"])[0];
    const numInput = numKey ? find(open.row(numKey), (n) => n.tag === "input" && n.attrs.type === "number")[0] : null;
    const numFlex = numInput ? flexOf(chainOf(open, numInput)) : null;
    ok(!!numFlex && /^0 0 92px$/.test(numFlex.flex), "O CONTROL — the reader finds a number box's fixed 92px (`" + (numKey || "?") + "`), so the link " +
      "box's reading below is the page's rule and not the reader's", numFlex);
    const linkFlex = input ? flexOf(chainOf(open, input)) : null;
    const grow = linkFlex ? parseFloat(linkFlex.flex.split(/\s+/)[0]) : NaN;
    ok(!!linkFlex && grow >= 1, "O: the background link box GROWS into the width its row has — it took the number boxes' fixed 92px", linkFlex);
    const clear = bgRow ? find(bgRow, (n) => n.tag === "button" && n.text === "Clear")[0] : null;
    const clearFlex = clear ? flexOf(chainOf(open, clear)) : null;
    ok(!!clear && !(clearFlex && parseFloat(clearFlex.flex) >= 1), "O: and its Clear button keeps its own width beside it", clearFlex);
  }

  // ═══ PART P — Room presence says what chat does, under its actions list (J112's presence labels, ddjp_620; ddjp_621) ═══
  // Its explanation said "the People list can't count it itself; with this on, it says its list may leave out people who
  // only chatted" — true before J75. Since J75 People counts the chat you can see when chat counts. The chat switch is a
  // tick in the actions list since ddjp_621, so the sentence lives under that list's More. Opened as a person reads it.
  {
    const cls = (c) => (n) => new RegExp("\\b" + c + "\\b").test(n.className || "");
    const open = world({ locked: false }); open.render();
    const moreOf = (key) => {
      const r = open.row(key); if (!r) return "";
      const more = find(r, cls("set-more"))[0];
      if (more && !find(open.row(key), cls("set-more-text")).length) more.onclick();
      return (find(open.row(key), cls("set-more-text"))[0] || {}).text || "";
    };
    const t = moreOf("activityPresence");
    ok(!!t, "P PREMISE — Room presence's actions list has an explanation under More", t);
    ok(/People counts the chat you can see/.test(t) && /Chat is never stored/.test(t) && !/can’t count it itself|may leave out people who only chatted/.test(t),
      "P: it says People counts the chat you can see, and that chat is never stored — it said People could not count chat, which J75 made false", t);
    const q = moreOf("activityQueue");
    ok(/Chat is never stored/.test(q), "P: DJ presence's actions list says chat is never stored, as its chat switch did", q);
    ok(!/only chat counts/.test(t) && !/only chat counts/.test(q),
      "P: neither says \u201cuntick every one and only chat counts\u201d — chat is one of the ticks now, so unticking every one unticks it too", [t, q]);
  }

  // ═══ PART Q — chat is one of the actions that count, on both cards (the owner's change at check 14, ddjp_621) ═══
  // A UI MERGE ONLY: the tick is stored as the SAME boolean (`botQueueChat`, `botPresenceChat`), so no room's stored
  // settings change. statederiver keeps chat apart from ACTIVITY_GROUPS (raw listeners, never the fold), so it stays its
  // own key; only where it is drawn moved. Driven through the real panel: tick it, Apply, read the one write.
  await (async () => {
    const cls = (c) => (n) => new RegExp("\\b" + c + "\\b").test(n.className || "");
    const label = (n) => { const sp = find(n, (x) => x.tag === "span")[0]; return sp ? sp.text : ""; };
    for (const [card, chatKey, listKey] of [["DJ presence", "botQueueChat", "activityQueue"], ["Room presence", "botPresenceChat", "activityPresence"]]) {
      const w = world({ locked: false }); w.render();
      ok(!w.row(chatKey), "Q: " + card + " has NO separate \u201cchat counts\u201d switch row", w.row(chatKey) && w.row(chatKey).attrs);
      const list = w.row(listKey);
      const tick = list ? find(list, (n) => n.attrs && n.attrs["data-key"] === chatKey + ":tick")[0] : null;
      ok(!!tick && label(tick) === "Sending a chat message",
        "Q: " + card + "'s actions list has a tick named \u201cSending a chat message\u201d", tick && label(tick));
      const cbs = list ? find(list, (n) => n.tag === "input" && n.attrs.type === "checkbox") : [];
      ok(cbs.length === 7 && tick && cbs[cbs.length - 1] === find(tick, (n) => n.tag === "input")[0],
        "Q: " + card + ": it is the last of the list's seven ticks, after the six groups", cbs.length);
      const cb = tick ? find(tick, (n) => n.tag === "input")[0] : null;
      ok(cb && cb.checked === (w.settings[chatKey] === true), "Q: " + card + ": the tick reads the stored boolean", [cb && cb.checked, w.settings[chatKey]]);
      const before = w.settings[chatKey];
      if (cb) { cb.checked = !cb.checked; cb.onchange(); }
      ok(w.performed.length === 0, "Q: " + card + ": nothing is sent before Apply", w.performed);
      if (w.apply()) w.apply().onclick();
      await settle();
      const p = (w.performed[0] || {}).partial || {};
      ok(w.performed.length === 1 && p[chatKey] === !before && Object.keys(p).join(",") === chatKey,
        "Q: " + card + ": Apply sends ONE write of the SAME boolean key, and nothing else — the actions map is not touched", w.performed);
      const off = world({ locked: false, settings: { [chatKey]: false } }); off.render();
      const offCb = off.row(listKey) ? find(off.row(listKey), (n) => n.attrs && n.attrs["data-key"] === chatKey + ":tick").map((x) => find(x, (n) => n.tag === "input")[0])[0] : null;
      ok(offCb && offCb.checked === false, "Q: " + card + ": a room with chat off shows the tick unticked — its stored setting reads as it was", offCb && offCb.checked);
      const shut = world({ locked: true }); shut.render();
      const shutCb = shut.row(listKey) ? find(shut.row(listKey), (n) => n.attrs && n.attrs["data-key"] === chatKey + ":tick").map((x) => find(x, (n) => n.tag === "input")[0])[0] : null;
      ok(shutCb && shutCb.disabled === true, "Q: " + card + ": locked, the tick cannot be changed, like the others", shutCb && shutCb.disabled);
    }
  })();

  // ═══ PART R — "Show advanced options" changes only what this device shows (J127, the owner's) ═══════════════════
  // Driven through the real panel: flipping it sends nothing and stages nothing, locked or not, and leaves the lock alone;
  // a change staged on an advanced row and then hidden is neither applied nor discarded by the toggle — Apply sends it
  // (the owner's); a bad value typed there and then hidden keeps Apply blocked until it is fixed or locked away (the
  // owner's); and the outline is the toggle's own colour, on the box round the rows, never a row's own border (DECLARED:
  // read through `sheetReader`, the cascade reader PART O uses — how it looks is for a person at a screen).
  await (async () => {
    const G = BE.StreamManager.settingRanges().graceMs, gf = G.scale || 1;
    const gNow = BE.StateDeriver.defaultSettings().graceMs / gf;
    const gGood = (gNow + 1 <= G.max / gf) ? gNow + 1 : gNow - 1, gBad = G.max / gf + 50;
    // R1 — flipping it sends nothing and stages nothing, unlocked or locked, and the lock stays as it was.
    for (const [who, o] of [["UNLOCKED", {}], ["LOCKED", { locked: true }]]) {
      const w = world(o); w.render();
      ok(w.advBox() && w.advBox().disabled !== true && !w.row("graceMs"), "R PREMISE (" + who + ") — the toggle is drawn and live, and off an advanced row is not");
      w.flipAdvanced();
      ok(w.prefWrites.join(",") === "true" && !!w.row("graceMs"), "R (" + who + "): ticking it stores ON and draws the advanced rows", w.prefWrites);
      w.flipAdvanced(); await settle();
      ok(w.prefWrites.join(",") === "true,false" && !w.row("graceMs"), "R (" + who + "): unticking it stores OFF and hides them", w.prefWrites);
      ok(w.performed.length === 0 && w.requested.length === 0, "R (" + who + "): FLIPPING IT SENDS NOTHING — no settings write, no bot request", { p: w.performed, r: w.requested });
      ok(w.isLocked() === !!o.locked, "R (" + who + "): and the lock is as it was", w.isLocked());
      ok(w.apply() && w.apply().disabled === true && !/\(\d+\)/.test(w.apply().text), "R (" + who + "): and nothing is staged — Apply has nothing waiting", w.apply() && w.apply().text);
    }
    // R2 — A CHANGE STAGED ON AN ADVANCED ROW, THEN HIDDEN, IS STILL WAITING, AND APPLY SENDS IT (the owner's).
    {
      const w = world({ advanced: true }); w.render();
      ok(w.typeInto("graceMs", gGood) && /\(1\)/.test(w.apply().text), "R PREMISE — an advanced row was edited with the toggle on: one change waiting", w.apply().text);
      w.flipAdvanced();
      ok(!w.row("graceMs") && w.advanced() === false, "R PREMISE — the toggle is off and that row is no longer drawn");
      ok(/\(1\)/.test(w.apply().text) && w.apply().disabled === false && /^1 change waiting/.test(w.status()),
        "R: TURNING IT OFF DISCARDS NOTHING — the hidden change is still waiting, and the bar says so", { apply: w.apply().text, status: w.status() });
      w.apply().onclick(); await settle();
      ok(w.performed.length === 1 && Object.keys(w.performed[0].partial).join(",") === "graceMs" && w.performed[0].partial.graceMs === gGood * gf,
        "R: AND APPLY STILL SENDS IT, in the one write (the owner's)", w.performed);
      const c = world({ advanced: true }); c.render();
      c.typeInto("graceMs", gGood); c.flipAdvanced(); c.lockBtn().onclick(); c.lockBtn().onclick();
      ok(!/\(\d+\)/.test(c.apply().text), "R CONTROL: A LOCK still discards it — the lock and another room discard, the toggle does not", c.apply().text);
    }
    // R3 — A BAD VALUE TYPED INTO AN ADVANCED ROW, THEN HIDDEN, KEEPS APPLY BLOCKED until it is fixed or locked away (the owner's).
    {
      const w = world({ advanced: true }); w.render();
      ok(w.typeInto("graceMs", gBad) && w.apply().disabled === true, "R PREMISE — a value outside the range was typed into an advanced row, and Apply is held back");
      w.pickOther("vis");
      w.flipAdvanced();
      ok(!w.row("graceMs") && /\(1\)/.test(w.apply().text), "R PREMISE — that row is hidden, and a good change elsewhere is waiting", w.apply().text);
      ok(w.apply().disabled === true && w.status().indexOf("«graceMs»") === 0,
        "R: A HIDDEN BAD VALUE KEEPS APPLY BLOCKED, and the bar still names it (the owner's)", w.status());
      w.apply().onclick(); await settle();
      ok(w.performed.length === 0, "R: and nothing is sent while it stands", w.performed);
      w.flipAdvanced();
      ok(w.typeInto("graceMs", gGood) && w.apply().disabled === false, "R: FIXED, Apply is free again", w.status());
      w.apply().onclick(); await settle();
      ok(w.performed.length === 1 && Object.keys(w.performed[0].partial).sort().join(",") === "graceMs,vis", "R: and sends both in one write", w.performed);
      const z = world({ advanced: true }); z.render();
      z.typeInto("graceMs", gBad); z.flipAdvanced(); z.lockBtn().onclick(); z.lockBtn().onclick();
      ok(z.status() === "" && !/\(\d+\)/.test(z.apply().text), "R: LOCKED AWAY, it is gone — nothing waiting, nothing held back", z.status());
      z.pickOther("vis");
      ok(z.apply().disabled === false, "R: and the next change can be applied", z.status());
    }
    // R5 — SHOWN AGAIN, A BAD VALUE IS THE VALUE THAT WAS TYPED, WITH ITS RED LINE (`ddjp_670`, a part of the job the owner chose).
    // Read in the code at the milestone review after `ddjp_659` (J127's entry): typed into an advanced row, then the toggle off
    // and on, the row came back with the room's value and no red line, while Apply stayed blocked by a value nobody could see.
    // The owner's rules decide it (`main/04-features.md` §Room settings panel): the toggle neither applies nor discards, and a
    // bad value keeps Apply blocked until it is fixed or locked away — so the row shows what blocks it. Driven on a number row
    // (`graceMs`) and a table's cell (`vouchTable`), both advanced; a good staged value shows as staged, as before.
    {
      const tok = (n, c) => String((n && n.className) || "").split(/\s+/).indexOf(c) >= 0;
      const isRed = (n) => /#ff6b6b/i.test(String((n && n.attrs && n.attrs.style) || ""));
      const numRow = (w, key) => { const r = w.row(key); if (!r) return null;
        return { input: find(r, (n) => n.tag === "input" && n.attrs.type === "number")[0] || null, err: find(r, isRed)[0] || null }; };
      // The table's editable cells, in ladder order: each rank row inside the advanced box that holds the table's head.
      const cells = (w, key) => {
        const host = find(w.box, (n) => tok(n, "set-adv") && find(n, (m) => m.attrs && m.attrs["data-key"] === key).length > 0)[0];
        return host ? find(host, (n) => tok(n, "set-rank-row")).map((r) => ({ input: find(r, (n) => n.tag === "input" && n.attrs.type === "number")[0] || null,
          err: find(r, isRed)[0] || null })).filter((c) => c.input) : [];
      };
      const shown = (c) => !!c && !!c.err && c.err.style.display === "block" && !!c.err.text;
      const V = BE.StreamManager.settingRanges().vouchTable;
      const tBad = String(V.enoughMax + 50);
      const w = world({ advanced: true }); w.render();
      const g0 = numRow(w, "graceMs");
      g0.input.value = String(gBad); g0.input.onchange();
      const c0 = cells(w, "vouchTable")[0];
      if (c0) { c0.input.value = tBad; c0.input.onchange(); }
      const words = { g: g0.err && g0.err.text, t: c0 && c0.err && c0.err.text };
      ok(shown(g0) && c0 && shown(c0) && w.apply().disabled === true,
        "R5 PREMISE — a bad value typed into an advanced number row and an advanced table's cell: each shows its red line, and Apply is blocked", words);
      w.flipAdvanced();
      ok(!w.row("graceMs") && w.apply().disabled === true, "R5 PREMISE — the toggle off: those rows are hidden, and Apply is still blocked (R3's rule)");
      w.flipAdvanced();
      const g1 = numRow(w, "graceMs"), c1 = cells(w, "vouchTable")[0];
      ok(g1 && g1.input && g1.input.value === String(gBad) && shown(g1) && g1.err.text === words.g,
        "R5: SHOWN AGAIN, THE NUMBER ROW SHOWS THE VALUE THAT WAS TYPED, WITH ITS RED LINE — not the room's value", { value: g1 && g1.input && g1.input.value, err: g1 && g1.err && g1.err.text, shown: shown(g1) });
      ok(c1 && c1.input.value === tBad && shown(c1) && c1.err.text === words.t,
        "R5: AND SO DOES THE TABLE'S CELL — what was typed, its red line", { value: c1 && c1.input.value, err: c1 && c1.err && c1.err.text });
      ok(w.apply().disabled === true && w.status().indexOf("«graceMs»") === 0, "R5: and Apply stays blocked, the bar naming it", w.status());
      // Drawn again by another change (a whole redraw): the same — the row shows what blocks Apply wherever it is drawn.
      w.pickOther("vis");
      const g2 = numRow(w, "graceMs");
      ok(g2 && g2.input.value === String(gBad) && shown(g2), "R5: AND A WHOLE REDRAW (another row's change) SHOWS IT TOO — the row reads what blocks Apply, wherever it is drawn",
        { value: g2 && g2.input.value, shown: shown(g2) });
      // FIXED: the red line goes, and stays gone when the row is shown again.
      g2.input.value = String(gGood); g2.input.onchange();
      const cf = cells(w, "vouchTable")[0];
      cf.input.value = ""; cf.input.onchange();
      w.flipAdvanced(); w.flipAdvanced();
      const g3 = numRow(w, "graceMs"), c3 = cells(w, "vouchTable")[0];
      ok(g3.input.value === String(gGood) && !shown(g3) && c3 && !shown(c3) && w.apply().disabled === false,
        "R5: FIXED, IT IS GONE — shown again, the row reads the good value staged, no red line, and Apply is free",
        { value: g3.input.value, red: shown(g3), cell: c3 && shown(c3), apply: w.apply().disabled });
      // LOCKED AWAY: shown again, the room's own value, no red line.
      const z = world({ advanced: true }); z.render();
      const zg = numRow(z, "graceMs"); zg.input.value = String(gBad); zg.input.onchange();
      z.flipAdvanced(); z.lockBtn().onclick(); z.lockBtn().onclick(); z.flipAdvanced();
      const zg2 = numRow(z, "graceMs");
      ok(zg2 && zg2.input.value === String(gNow) && !shown(zg2) && z.status() === "",
        "R5: LOCKED AWAY, it is gone — shown again, the room's own value and no red line", { value: zg2 && zg2.input.value, red: shown(zg2) });
      // CONTROL: a good value staged and hidden shows as staged when shown again (as before).
      const c = world({ advanced: true }); c.render();
      c.typeInto("graceMs", gGood); c.flipAdvanced(); c.flipAdvanced();
      const cg = numRow(c, "graceMs");
      ok(cg && cg.input.value === String(gGood) && !shown(cg) && c.apply().disabled === false,
        "R5 CONTROL: a staged good value, shown again, shows as staged, no red line — as before", { value: cg && cg.input.value });
    }
    // R4 — THE OUTLINE, DECLARED: the toggle's own colour, on the box (or the card, or a Bot permissions row), never a row's border.
    {
      const SR = sheetReader();
      const pm = SR.rules.find((r) => !r.media && r.sel.split(",").map((s) => s.trim()).indexOf(".pref-master") >= 0 && /accent-color/.test(r.body));
      const accent = pm ? ((pm.body.match(/accent-color\s*:\s*([^;]+)/) || [])[1] || "").trim().toLowerCase() : null;
      ok(!!accent && /^#[0-9a-f]{6}$/.test(accent), "R PREMISE — the toggle's colour is read from `.pref-master`, not written here", accent);
      const w = world({ advanced: true }); w.render();
      ok(w.advBox() && /\bpref-master\b/.test(w.advBox().className), "R: the toggle IS a `pref-master` checkbox, so that colour is its own");
      const deleg = find(w.box, (n) => n.tag === "button" && /^(Choose|See) what others/.test(n.text))[0];
      if (deleg) deleg.onclick();
      const colourOf = (n) => { const b = n ? SR.winner(SR.chainOf(w, n), ["border", "border-color"]) : null;
        const m = b && b.value.match(/#[0-9a-fA-F]{6}\b/); return { colour: m ? m[0].toLowerCase() : (b ? b.value : null), sel: b && b.sel }; };
      // Found by their class TOKENS, never by the whole class string, so a box that stops borrowing the body is still
      // found here and judged by the rows below rather than refused by this premise (AV8b).
      const tok = (n, c) => String((n && n.className) || "").split(/\s+/).indexOf(c) >= 0;
      const boxN = find(w.box, (n) => tok(n, "set-adv") && !tok(n, "set-sec") && !tok(n, "delegation-row"))[0];
      const cardN = w.box.children.find((c) => tok(c, "set-sec") && tok(c, "set-adv"));
      const plainCard = w.box.children.find((c) => c.attrs["data-section"] === "room");
      const dRows = find(w.box, (n) => tok(n, "delegation-row"));
      const dAdv = dRows.find((n) => tok(n, "set-adv")), dPlain = dRows.find((n) => !tok(n, "set-adv"));
      ok(boxN && cardN && plainCard && dAdv && dPlain, "R PREMISE — ON, the panel draws an outlined box, an outlined card, a plain card, and Bot permissions rows of both kinds",
        { box: !!boxN, card: !!cardN, plain: !!plainCard, dAdv: !!dAdv, dPlain: !!dPlain });
      const got = { box: colourOf(boxN), card: colourOf(cardN), delegation: colourOf(dAdv) };
      ok(Object.keys(got).every((k) => got[k].colour === accent), "R: THE OUTLINE IS THE TOGGLE'S COLOUR — round the box, the card and the Bot permissions row", got);
      ok(colourOf(plainCard).colour !== accent && colourOf(dPlain).colour !== accent, "R CONTROL: and not round a card or a Bot permissions row that is not advanced",
        { card: colourOf(plainCard), delegation: colourOf(dPlain) });
      const inBox = boxN ? find(boxN, (n) => tok(n, "set-row") && n.attrs["data-key"])[0] : null;
      const rowB = inBox ? SR.winner(SR.chainOf(w, inBox), ["border"]) : null;
      ok(rowB && rowB.value === "none" && rowB.sel === ".set-sec-body > .set-row",
        "R: A ROW INSIDE THE BOX KEEPS A CARD'S BORDERLESS LOOK — the box borrows the card body's rule, so the outline is never the row's", rowB);
      const declared = new Set(); for (const r of SR.rules) for (const m of r.sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) declared.add(m[1]);
      ok(["set-adv-toggle", "set-adv"].every((c) => declared.has(c)), "R: and every class the toggle and the outline add is declared",
        ["set-adv-toggle", "set-adv"].filter((c) => !declared.has(c)));
    }
    // R6 — LOCKED, BOTH SETTINGS PANELS' CARDS TAKE THE CHAT BOX'S DARKNESS (ADDED at `ddjp_677` for the owner's request at
    // `ddjp_674`; CHANGED ON PURPOSE in the same package, his choice from a sketch: "i mean B for bowth settings pannels"; his
    // words in `main/04-features.md` §Room settings panel). While a panel's lock is shut — the room's, and this device's — each
    // card's black becomes the chat box's darkness, taken from the chat box's own rule (`.chat-messages` … `.chat-tint`), so a room
    // background shows through the cards; the words, checkboxes and buttons are NOT dimmed. This replaces this device's old
    // locked look (everything under its bar at opacity 0.55) and the first build of this part (the room settings the same).
    // Unlocked, solid, as before. A row inside a card stays see-through; a lone row takes the darkness; a card keeps its frame and
    // an advanced card its outline; someone who gets no lock is drawn as locked; the bar, the toggle, More and Apply as before.
    // DECLARED: which rule wins, read through `sheetReader` (no `:disabled` rule is read, and none is changed); what Chromium
    // draws — computed backgrounds and opacity — is in the report.
    {
      const SR = sheetReader();
      const tok = (n, c) => String((n && n.className) || "").split(/\s+/).indexOf(c) >= 0;
      const BG = ["background", "background-color"];
      // The element first, then what holds it, up to `root`; and whether it, or anything holding it, has an opacity of its own.
      const pathIn = (root, t) => { if (root === t) return [root]; for (const c of (root.children || [])) { const q = pathIn(c, t); if (q) return q.concat([root]); } return null; };
      const bgIn = (root, n) => { const ch = pathIn(root, n); return ch ? SR.winner(ch, BG) : null; };
      const dimmedIn = (root, n) => { const ch = pathIn(root, n); if (!ch) return "not found"; for (let i = 0; i < ch.length; i++) { const o = SR.winner(ch.slice(i), ["opacity"]); if (o) return o.sel + " " + o.value; } return null; };
      const chatN = node("div"); chatN.className = "chat-messages";
      const REF = SR.winner([chatN], BG);
      ok(REF && REF.value === "rgba(12,12,16,0.45)" && REF.sel === ".chat-messages",
        "R6 PREMISE — the chat box's darkness is its own rule's, `rgba(12,12,16,0.45)`, read off the sheet", REF);
      const fromChat = (b) => !!b && !!REF && b.order === REF.order && b.value === REF.value;
      const CARD = SR.winner([Object.assign(node("div"), { className: "set-sec" })], BG);
      ok(CARD && CARD.value === "#161616" && CARD.sel === ".set-sec", "R6 PREMISE — a card's own black, unlocked, is the card rule's `#161616`", CARD);
      // THIS DEVICE'S SETTINGS, as `renderChatSettings` draws them, locked and unlocked.
      let saved = null;
      const { ChatPrefs: CP } = loadInContext(["core/chatprefs.js"], { URL, Store: { prefs: { load: () => saved, save: (x) => { saved = JSON.parse(JSON.stringify(x)); } } },
        Logger: { warn() {}, info() {}, error() {}, debug() {} } });
      CP.load();
      const local = (locked) => {
        const lw = world({}); const lbox = node("div"), lbar = node("div");
        lw.ctx.UIBase.refs.chatSettingsBox = lbox; lw.ctx.UIBase.refs.chatSettingsBar = lbar;
        lw.ctx.UIBase.host.prefsLocked = () => locked; lw.ctx.ChatPrefs = CP;
        lw.ctx.BotRuntime = { botInRoom: () => true, actingAsBot: () => false };
        lw.ctx.Room.FEED_KINDS = { "ddjp.dj.play": { verb: "started a song", shownByDefault: true } };
        lw.ctx.document.documentElement = { style: { setProperty() {} } };
        lw.S.renderChatSettings();
        const body = find(lbox, (n) => tok(n, "prefs-body"))[0] || null;
        return { lbox, body, cards: body ? find(body, (n) => tok(n, "pref-section")) : [],
          words: body ? find(body, (n) => tok(n, "pref-title") || tok(n, "set-card-head") || tok(n, "pref-note")) : [],
          controls: body ? find(body, (n) => n.tag === "input" || n.tag === "button") : [] };
      };
      const L = local(true), LU = local(false);
      ok(L.body && tok(L.body, "prefs-locked") && L.cards.length >= 5 && L.words.length > 5 && L.controls.length > 5 && LU.body && !tok(LU.body, "prefs-locked"),
        "R6 PREMISE — this device's settings drew their cards, words and controls, locked (`prefs-locked`) and unlocked", { cards: L.cards.length, words: L.words.length, controls: L.controls.length });
      ok(L.cards.every((c) => fromChat(bgIn(L.lbox, c))),
        "R6: THIS DEVICE'S SETTINGS, LOCKED — EACH CARD'S BLACK IS THE CHAT BOX'S DARKNESS, FROM THE CHAT BOX'S OWN RULE", L.cards.map((c) => bgIn(L.lbox, c)).slice(0, 2));
      const lDim = [L.body].concat(L.cards, L.words, L.controls).map((n) => dimmedIn(L.lbox, n)).filter(Boolean);
      ok(lDim.length === 0, "R6: AND ITS WORDS, CHECKBOXES AND BUTTONS ARE NOT DIMMED — no opacity on any of them or on what holds them (the 0.55 is gone)", lDim.slice(0, 3));
      ok(LU.cards.length >= 5 && LU.cards.every((c) => { const b = bgIn(LU.lbox, c); return b && b.value === CARD.value && !fromChat(b); }) &&
         [LU.body].concat(LU.cards).every((n) => dimmedIn(LU.lbox, n) === null),
        "R6: UNLOCKED, THIS DEVICE'S CARDS ARE SOLID, AS TODAY", LU.cards.map((c) => bgIn(LU.lbox, c)).slice(0, 2));
      // THE ROOM SETTINGS.
      const made = (o) => { const w = world(o); w.box.className = "settings-box"; w.pre = w.box.className; w.render(); return w; };   // the box as ui/shell.js makes it
      const roomCards = (w) => w.box.children.filter((c) => tok(c, "set-sec"));
      const w = made({ locked: true });
      ok(w.pre === "settings-box" && w.box.children.length > 0 && roomCards(w).length >= 5, "R6 PREMISE — the box is the app's own (`settings-box`, ui/shell.js), and the panel drew its cards into it", w.pre);
      ok(tok(w.box, "prefs-body") && tok(w.box, "prefs-locked") && tok(w.box, "settings-box"),
        "R6: LOCKED, THE ROOM SETTINGS' BOX TAKES THIS DEVICE'S SETTINGS' CLASSES — `prefs-body` and `prefs-locked`, keeping its own `settings-box`", w.box.className);
      ok(roomCards(w).every((c) => fromChat(bgIn(w.box, c))) && L.cards.length && roomCards(w).every((c) => bgIn(w.box, c).order === bgIn(L.lbox, L.cards[0]).order),
        "R6: THE ROOM SETTINGS, LOCKED — EACH CARD'S BLACK IS THE CHAT BOX'S DARKNESS, FROM THE SAME RULE AS THIS DEVICE'S", roomCards(w).map((c) => bgIn(w.box, c)).slice(0, 2));
      const rWords = find(w.box, (n) => tok(n, "set-panel-title") || tok(n, "set-label") || tok(n, "set-card-head") || tok(n, "set-more"));
      const rCtl = find(w.box, (n) => n.tag === "input" || n.tag === "button");
      const rDim = [w.box].concat(roomCards(w), rWords, rCtl).map((n) => dimmedIn(w.box, n)).filter(Boolean);
      ok(rWords.length > 10 && rCtl.length > 10 && rDim.length === 0,
        "R6: AND ITS WORDS, CHECKBOXES AND BUTTONS ARE NOT DIMMED — the title, Show advanced options, every label, More: no opacity on any of them or what holds them", rDim.slice(0, 3));
      const inCard = find(roomCards(w)[0], (n) => tok(n, "set-row"))[0];
      const inCardU = (() => { const u = made({ locked: false }); const r = find(roomCards(u)[0], (n) => tok(n, "set-row"))[0]; return r ? bgIn(u.box, r) : null; })();
      ok(inCard && bgIn(w.box, inCard) && bgIn(w.box, inCard).value === "transparent" && inCardU && inCardU.value === "transparent",
        "R6: A ROW INSIDE A CARD STAYS SEE-THROUGH, LOCKED AS UNLOCKED — the card's darkness shows through it", { locked: inCard && bgIn(w.box, inCard), unlocked: inCardU });
      // A LONE ROW — as `_box()` puts one outside a card: a direct child of the box. The panel draws none today; one is set there.
      const lone = (ww) => { const r = node("div"); r.className = "set-row"; ww.box.children.push(r); const b = bgIn(ww.box, r); ww.box.children.pop(); return b; };
      const loneL = lone(w), loneU = lone(made({ locked: false }));
      ok(fromChat(loneL) && loneU && loneU.value === "#1a1a1a",
        "R6: A LONE ROW TAKES THE DARKNESS TOO, AND IS SOLID UNLOCKED (its own `#1a1a1a`)", { locked: loneL, unlocked: loneU });
      // A CARD KEEPS ITS FRAME, AND AN ADVANCED CARD ITS OUTLINE: the darkness is the chat box's background, never its frame.
      const wa = made({ locked: true, advanced: true });
      const advCard = wa.box.children.find((c) => tok(c, "set-sec") && tok(c, "set-adv")), plain = wa.box.children.find((c) => tok(c, "set-sec") && !tok(c, "set-adv"));
      const frame = (n) => { const b = n ? SR.winner(pathIn(wa.box, n), ["border", "border-color"]) : null; const m = b && b.value.match(/#[0-9a-fA-F]{6}\b/); return m ? m[0].toLowerCase() : (b && b.value); };
      ok(advCard && plain && fromChat(bgIn(wa.box, advCard)) && frame(advCard) === "#5865f2" && frame(plain) === "#2a2a2a",
        "R6: LOCKED, A CARD KEEPS ITS FRAME AND AN ADVANCED CARD ITS OUTLINE — the chat box's darkness, never its frame", { adv: frame(advCard), plain: frame(plain) });
      // ONE RULE: no other rule gives a locked card a background, and no rule dims a panel.
      const lockedBg = SR.rules.filter((r) => !r.media && /\bprefs-locked\b/.test(r.sel) && /(^|;)\s*background(-color)?\s*:/.test(r.body));
      const anyDim = SR.rules.filter((r) => !r.media && /(^|;)\s*opacity\s*:/.test(r.body) && /\.(prefs-body|prefs-locked|settings-box|pref-section|set-sec)\b/.test(r.sel));
      ok(lockedBg.length === 1 && /\.chat-messages\b/.test(lockedBg[0].sel) && anyDim.length === 0,
        "R6: ONE RULE FOR BOTH PANELS, THE CHAT BOX'S — no other rule gives a locked card a background, and none dims a panel", { bg: lockedBg.map((r) => r.sel), dim: anyDim.map((r) => r.sel) });
      const kids = w.box.children.map((c) => c.className);
      ok(tok(w.box, "prefs-locked") && w.box.children.some((c) => tok(c, "set-panel-title")) && w.box.children.some((c) => tok(c, "set-adv-toggle")) &&
         find(w.box, (n) => n === w.slot || n === w.bar()).length === 0 && !!w.lockBtn() && !tok(w.bar(), "prefs-locked") && !tok(w.slot, "prefs-locked"),
        "R6: EVERYTHING UNDER THE BAR TAKES THE LOOK — the title, Show advanced options, every card; the bar (the lock, Apply, its line) is not in it", kids);
      const nw = made({ locked: true, owner: false, delegated: ["maxLen"] });
      const note = nw.box.children.find((c) => c.tag === "p" && /\bmuted\b/.test(c.className));
      ok(note && tok(nw.box, "prefs-locked") && !!nw.lockBtn() && dimmedIn(nw.box, note) === null,
        "R6: AND THE NOTE — for someone who may change some things, the note is under the bar, not dimmed", note && note.text);
      // UNLOCKED, THEN LOCKED AGAIN: the box outlives a render, so its classes are set on every render.
      w.lockBtn().onclick();
      ok(!w.isLocked() && tok(w.box, "prefs-body") && tok(w.box, "settings-box") && !tok(w.box, "prefs-locked") &&
         roomCards(w).every((c) => { const b = bgIn(w.box, c); return b && b.value === CARD.value && !fromChat(b); }),
        "R6: UNLOCKED, SOLID, AS TODAY — no `prefs-locked`, every card its own black (the box keeps `prefs-body` and its own class)", { cls: w.box.className, card: bgIn(w.box, roomCards(w)[0]) });
      w.lockBtn().onclick();
      const toks = w.box.className.split(/\s+/).filter(Boolean);
      ok(w.isLocked() && tok(w.box, "prefs-locked") && toks.length === new Set(toks).size && toks.length === 3,
        "R6: AND LOCKED AGAIN, DARK AGAIN — set on every render, no class doubled, its own kept", toks);
      // SOMEONE WHO GETS NO LOCK.
      const v = made({ locked: false, owner: false });
      ok(!v.lockBtn() && tok(v.box, "prefs-locked") && roomCards(v).every((c) => fromChat(bgIn(v.box, c))),
        "R6: SOMEONE WHO GETS NO LOCK IS ALWAYS DRAWN AS LOCKED — no lock, and the cards dark even with the lock open", { lock: !!v.lockBtn(), cls: v.box.className });
      const d = made({ locked: false, owner: false, delegated: ["maxLen"] });
      ok(!!d.lockBtn() && !tok(d.box, "prefs-locked"), "R6 CONTROL: someone who may change one setting has the lock, and unlocked is drawn solid", d.box.className);
      // WHILE LOCKED: the toggle ticks, More opens, Apply greys itself.
      const z = made({ locked: true });
      const more = find(z.box, (n) => n.tag === "button" && /\bset-more\b/.test(n.className))[0];
      if (more) more.onclick();
      const opened = find(z.box, (n) => /\bset-more-text\b/.test(n.className)).length;
      z.flipAdvanced();
      ok(tok(z.box, "prefs-locked") && more && more.disabled !== true && opened === 1 && !!z.row("graceMs") && z.advanced() === true && z.apply().disabled === true && z.performed.length === 0,
        "R6: WHILE LOCKED, AS BEFORE — More opens, Show advanced options ticks, and Apply greys itself", { opened, advanced: z.advanced(), apply: z.apply().disabled, cls: z.box.className });

      // R7 — A BOX INSIDE A CARD, WHILE LOCKED, IS DARKER STILL (ADDED at `ddjp_678`; the owner: "also some settings sub pannel
      // exsist and arent transparant, they should be but a bit darker as tis layered again"; `main/04-features.md` §Room settings
      // panel). Measured on 677 (Chromium, both panels locked with advanced options on, the report): in a shared room the only
      // boxes inside a card still solid were the skip rules' (`.set-rule`, #151517) in the Blocked songs card. While the lock is
      // shut each takes the chat box's darkness ON TOP OF its card's — from the chat box's own rule, so it comes out darker
      // ("layered again"); unlocked it is solid, as today, like the cards. Each keeps its frame. DECLARED: which rule wins; the
      // pixels are Chromium's (the report).
      const solid = (b) => !!b && !fromChat(b) && !/^(transparent|none)$/.test(String(b.value).trim()) && !/rgba\([^)]*,\s*0?\.\d+\s*\)$/.test(b.value) && !/rgba\([^)]*,\s*0\s*\)$/.test(b.value);
      const ruleBoxes = (ww) => find(ww.box, (n) => tok(n, "set-rule"));
      const cardOf = (ww, n) => { const ch = pathIn(ww.box, n) || []; return ch.find((c) => c !== n && tok(c, "set-sec")) || null; };
      const rl = made({ locked: true, advanced: true });
      const RB = ruleBoxes(rl);
      ok(RB.length >= 2 && RB.every((n) => !!cardOf(rl, n)), "R7 PREMISE — locked, the room settings drew the skip rules' boxes, each inside a card (Blocked songs)",
        RB.map((n) => [n.className, cardOf(rl, n) && cardOf(rl, n).className]));
      ok(RB.every((n) => fromChat(bgIn(rl.box, n)) && fromChat(bgIn(rl.box, cardOf(rl, n)))),
        "R7: LOCKED, A SKIP RULE'S BOX TAKES THE CHAT BOX'S DARKNESS ON TOP OF ITS CARD'S — from the chat box's own rule, in a card that has it too, so it comes out darker (\"layered again\")",
        RB.map((n) => [bgIn(rl.box, n), bgIn(rl.box, cardOf(rl, n)) && bgIn(rl.box, cardOf(rl, n)).value]).slice(0, 2));
      const ru = made({ locked: false, advanced: true });
      const RU = ruleBoxes(ru);
      ok(RU.length >= 2 && RU.every((n) => { const b = bgIn(ru.box, n); return b && b.value === "#151517" && !fromChat(b); }),
        "R7: UNLOCKED, SOLID, AS TODAY — each skip rule's box its own #151517, as the cards their own black", RU.map((n) => bgIn(ru.box, n)).slice(0, 2));
      const ruleFrame = (ww, n) => { const b = SR.winner(pathIn(ww.box, n), ["border", "border-color"]); return b && b.value; };
      ok(RB.every((n) => /#2a2a2a/i.test(ruleFrame(rl, n) || "")), "R7: AND IT KEEPS ITS FRAME, #2a2a2a — the darkness, never the chat box's frame", RB.map((n) => ruleFrame(rl, n)).slice(0, 2));
      // AND NOTHING ELSE INSIDE A CARD IS LEFT SOLID, in the room the measurement named (a shared room with no bot) and in this
      // device's settings: a box, that is — the typing boxes, buttons and pickers keep their grey (the owner's, at `ddjp_670`:
      // "the ones in room settings for example have opaque backgrounds, so they can stay grey").
      const CTL = /^(input|button|select|textarea|option)$/;
      const solidIn = (root, cards) => cards.reduce((acc, c) => acc.concat(find(c, (n) => n !== c && !CTL.test(n.tag)).filter((n) => solid(bgIn(root, n))).map((n) => n.className + " " + bgIn(root, n).value)), []);
      const nb = made({ locked: true, advanced: true, bot: false });
      ok(roomCards(nb).length >= 5 && ruleBoxes(nb).length >= 2, "R7 PREMISE — a shared room with no bot drew its cards, the Blocked songs card's skip rules among them", roomCards(nb).length);
      const left = solidIn(nb.box, roomCards(nb)).concat(solidIn(L.lbox, L.cards));
      ok(left.length === 0, "R7: AND NO OTHER BOX INSIDE A CARD IS LEFT SOLID WHILE LOCKED — a shared room with no bot, and this device's settings", left.slice(0, 4));
    }
  })();

  // ═══ PART S — room settings look the same locked or unlocked, in this device's settings' style (J135, the owner's) ═════════
  // His words (`main/04-features.md` §Room settings panel): "have the settings all shown the same but uneditable even unlocked if
  // no rights to them"; "in local settings, they are greyed out but still decyferable and they turn colorfull and ready to be
  // edited when unlocked that the right style"; "make sure no pannels arent opaque while locked". Every row draws the same
  // controls locked or not — so nothing moves when the panel unlocks (MEASURED in Chromium: the panel's height locked equals
  // unlocked in all three room kinds, advanced on and off, J135's entry) — and a control that cannot be changed now is DISABLED:
  // locked; someone with no rights, always; a delegated person, on the rows not theirs. More, Show advanced options and the
  // delegation list's toggle keep working. DECLARED: the sheet draws a disabled radio in this panel, the chosen one bright.
  {
    const SR = sheetReader();
    const tok = (n, c) => String((n && n.className) || "").split(/\s+/).indexOf(c) >= 0;
    // Every control in the panel, in order, with the setting row it sits in (the double records no parent, so the walk carries it).
    const controls = (w) => {
      const out = [];
      const walk = (n, key, where) => {
        const k = (n.attrs && n.attrs["data-key"]) ? String(n.attrs["data-key"]).split(":")[0] : key;
        const wh = tok(n, "set-adv-toggle") ? "advanced-toggle" : tok(n, "set-opts") ? "options" : where;
        if (/^(input|select|button)$/.test(n.tag)) out.push({ n, key: k, where: wh, sig: k + "|" + n.tag + "|" + (n.attrs.type || "") + "|" + n.className });
        for (const c of (n.children || [])) walk(c, k, wh);
      };
      walk(w.box, null, null);
      return out;
    };
    const keep = (c) => tok(c.n, "set-more") || c.where === "advanced-toggle" || c.where === "options";   // these work while locked
    const shapes = [];
    for (const bot of [true, false]) for (const advanced of [false, true]) {
      const L = world({ locked: true, bot, advanced }); L.render();
      const U = world({ locked: false, bot, advanced }); U.render();
      const cl = controls(L), cu = controls(U);
      shapes.push([bot, advanced, cl.length]);
      const label = (bot ? "a room with a bot" : "a room with no bot") + ", advanced " + (advanced ? "on" : "off");
      ok(cl.length > 20 && JSON.stringify(cl.map((c) => c.sig)) === JSON.stringify(cu.map((c) => c.sig)),
        "S: " + label + " — LOCKED, THE PANEL DRAWS EXACTLY THE CONTROLS IT DRAWS UNLOCKED, row for row", { locked: cl.length, unlocked: cu.length, first: cl.map((c) => c.sig).filter((x, i) => x !== (cu[i] || {}).sig).slice(0, 3) });
      const live = cl.filter((c) => !keep(c) && !c.n.disabled).map((c) => c.sig);
      ok(live.length === 0, "S: " + label + " — LOCKED, EVERY CONTROL OF A SETTING IS DISABLED: no click, tap or key reaches it", live.slice(0, 4));
      const off = cl.filter((c) => keep(c) && c.n.disabled).map((c) => c.sig);
      ok(off.length === 0 && cl.some((c) => tok(c.n, "set-more")) && cl.some((c) => c.where === "advanced-toggle"),
        "S: " + label + " — and More and Show advanced options still work while locked", off);
      const dead = cu.filter((c) => !keep(c) && c.n.disabled && !/Add a rule/.test(c.n.text)).map((c) => c.sig);
      ok(dead.length === 0, "S: " + label + " — UNLOCKED, THE OWNER'S CONTROLS ARE ALL LIVE, in colour and ready to edit", dead.slice(0, 4));
      ok(!find(L.box, (n) => tok(n, "set-value") && !/^(No skip rules|never)/.test(n.text)).length, "S: " + label + " — no row is a line of words in place of its controls, locked", find(L.box, (n) => tok(n, "set-value")).map((n) => n.text).slice(0, 3));
    }
    // THE SKIP RULES: the editor, locked as unlocked — its short sentences, which a locked panel drew, are gone.
    const SL = world({ locked: true }); SL.render();
    const rulesL = find(SL.row("skipRoads"), (n) => tok(n, "set-rule"));
    ok(rulesL.length >= 1 && rulesL.every((r) => find(r, (n) => n.tag === "input" && n.disabled === true).length === 2 && find(r, (n) => n.tag === "button" && n.disabled === true).length === 1),
      "S: LOCKED, THE SKIP RULES ARE THE EDITOR — each rule its two boxes and Remove, disabled", rulesL.length);
    // SOMEONE WITH NO RIGHTS, UNLOCKED: the same controls, every one disabled. A DELEGATED PERSON: theirs alone are live.
    const nobody = world({ locked: false, owner: false }); nobody.render();
    const owner = world({ locked: false }); owner.render();
    const cn = controls(nobody), co = controls(owner);
    ok(JSON.stringify(cn.map((c) => c.sig)) === JSON.stringify(co.map((c) => c.sig)) && cn.filter((c) => !keep(c) && !c.n.disabled).length === 0,
      "S: SOMEONE WITH NO RIGHTS SEES THE SAME CONTROLS AS THE OWNER, EVERY ONE DISABLED, EVEN UNLOCKED", cn.filter((c) => !keep(c) && !c.n.disabled).map((c) => c.sig).slice(0, 3));
    const dl = world({ locked: false, owner: false, delegated: ["maxLen", "vis"] }); dl.render();
    const liveD = [...new Set(controls(dl).filter((c) => !keep(c) && !c.n.disabled).map((c) => c.key))].sort();
    ok(JSON.stringify(liveD) === JSON.stringify(["maxLen", "vis"]), "S: A DELEGATED PERSON, UNLOCKED: ONLY THE ROWS THEY HOLD ARE LIVE; the rest greyed the same way", liveD);
    const dlL = world({ locked: true, owner: false, delegated: ["maxLen", "vis"] }); dlL.render();
    ok(controls(dlL).filter((c) => !keep(c) && !c.n.disabled).length === 0, "S: and locked, none of theirs either");
    // A GREYED CONTROL CHANGES NOTHING even if its handler were reached (the browser does not fire one): nothing is staged. Each
    // in a panel of its own and read at once — together, the switch's redraw would discard what the box staged before it, and a
    // stage that should not have happened would read as none (found by this file's break row ST16, which stayed green).
    const z = world({ locked: true }); z.render();
    const radio = find(z.row("vis"), (n) => n.tag === "input" && n.attrs.type === "radio" && !n.checked)[0];
    const num = find(z.row("maxLen"), (n) => n.tag === "input")[0];
    const cb = find(z.row("botQueueRemove"), (n) => n.tag === "input" && n.attrs.type === "checkbox")[0];
    ok(radio && num && cb && radio.disabled && num.disabled && cb.disabled, "S PREMISE — locked, a choice's radio, a number's box and a switch, each disabled");
    if (radio && num && cb) {
      const tries = [["a radio", (w) => { const r = find(w.row("vis"), (n) => n.tag === "input" && n.attrs.type === "radio" && !n.checked)[0]; r.checked = true; r.onchange(); }],
        ["a number's box", (w) => { const n = find(w.row("maxLen"), (x) => x.tag === "input")[0]; n.value = "77"; n.onchange(); }],
        ["a switch", (w) => { const c = find(w.row("botQueueRemove"), (x) => x.tag === "input" && x.attrs.type === "checkbox")[0]; c.checked = !c.checked; c.onchange(); }]];
      for (const [what, act] of tries) {
        const t = world({ locked: true }); t.render(); act(t);
        ok(t.apply().text === "Apply" && t.status() === "" && t.performed.length === 0, "S: AND UNDERNEATH, A GREYED CONTROL STAGES NOTHING — " + what + ", and no message either", { apply: t.apply().text, status: t.status() });
      }
    }
    // THE DELEGATION LINE'S WORDS FOLLOW WHO READS IT, NEVER THE LOCK (it was a line longer while locked, so the row moved).
    const words = (w) => { const r = w.row("botDelegation"); const m = r && find(r, (n) => tok(n, "muted"))[0]; return m ? m.text : null; };
    const dOL = world({ locked: true }); dOL.render(); const dOU = world({ locked: false }); dOU.render();
    ok(words(dOL) && words(dOL) === words(dOU) && words(nobody) !== words(dOU), "S: THE DELEGATION LINE IS THE OWNER'S OWN, LOCKED AS UNLOCKED; another reader's is theirs", [words(dOL), words(dOU), words(nobody)]);
    // DECLARED — THE SHEET. A disabled radio drawn by the sheet in this panel only, the chosen one bright; the greying dims controls
    // only; and the rows under a switch take the chat box's darkness while locked.
    const css = require("./_page-css.js").styleBlocks(fs.readFileSync(path.join(ROOT, "index.html"), "utf8")).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = (sel) => { const at = css.indexOf(sel + " {"); return at < 0 ? null : css.slice(at, css.indexOf("}", at) + 1); };
    const off = rule('.settings-box .set-choices input[type="radio"]:disabled'), on = rule('.settings-box .set-choices input[type="radio"]:disabled:checked');
    ok(!!off && /appearance:\s*none/.test(off) && /width:\s*13px/.test(off) && /height:\s*13px/.test(off) && /border:\s*2px solid #6b6b72/.test(off),
      "S: A DISABLED RADIO IN ROOM SETTINGS IS DRAWN BY THE SHEET — a grey ring at the browser's own 13 px (DECLARED)", off);
    ok(!!on && /#5865F2/i.test(on) && /border-color:\s*#5865F2/i.test(on), "S: AND THE CHOSEN ONE IN THE ACCENT, RING AND DOT — the choice stays readable (DECLARED)", on);
    ok(!/\.chat-settings-box[^{]*radio/.test(css) && !/(^|[\s,}])\.set-choices input\[type="radio"\]:disabled/.test(css.replace(/\.settings-box \.set-choices/g, "")),
      "S: THIS DEVICE'S SETTINGS KEEP THEIR LOOK — the rule names the room panel only (DECLARED)");
    const dims = css.split("}").filter((r) => /opacity\s*:/.test(r) && /:disabled/.test(r) && /(set-num|set-opt|rank-select)/.test(r));
    ok(dims.length >= 2 && dims.every((r) => !/\.(prefs-body|prefs-locked|settings-box|set-sec|pref-section)\b/.test(r.split("{")[0])),
      "S: THE GREYING FADES THE CONTROLS ONLY — no card, word or panel is dimmed (DECLARED)", dims.map((r) => r.split("{")[0].trim()));
    const BG = ["background", "background-color"];
    const pathIn = (root, t) => { if (root === t) return [root]; for (const c of (root.children || [])) { const q = pathIn(c, t); if (q) return q.concat([root]); } return null; };
    const chatN = node("div"); chatN.className = "chat-messages";
    const REF = SR.winner([chatN], BG);
    const madeS = (o) => { const w = world(o); w.box.className = "settings-box"; w.render(); return w; };
    const depsIn = (w) => find(w.box, (n) => tok(n, "set-deps")).reduce((a, d) => a.concat(d.children.filter((c) => tok(c, "set-row"))), []);
    const lk = madeS({ locked: true }), ul = madeS({ locked: false });
    const dL = depsIn(lk), dU = depsIn(ul);
    ok(dL.length >= 2 && dL.every((r) => { const b = SR.winner(pathIn(lk.box, r), BG); return b && REF && b.value === REF.value && b.order === REF.order; }),
      "S: IN A ROOM WITH A BOT, THE ROWS UNDER A SWITCH TAKE THE CHAT BOX'S DARKNESS WHILE LOCKED, like a skip rule's box (they were solid #1a1a1a)", dL.map((r) => SR.winner(pathIn(lk.box, r), BG)).slice(0, 2));
    ok(dU.length >= 2 && dU.every((r) => { const b = SR.winner(pathIn(ul.box, r), BG); return b && b.value === "#1a1a1a"; }), "S: and unlocked, solid, as today", dU.map((r) => SR.winner(pathIn(ul.box, r), BG)).slice(0, 2));
    void shapes;
  }

console.log("[settings-apply] PASS — room settings are STAGED and one Apply is ONE message (" + asserts + " assertions): " +
    "the real panel, driven by clicking and typing, sends nothing for three edits and then one owner write carrying all " +
    "three, or one bot request carrying every key for a delegated person. ANY lock discards what is staged — the lock " +
    "button, the relock a tab switch performs, and leaving the room — against a control that keeps it through ordinary " +
    "re-renders. The background link has no Set button, an unapproved link holds Apply back, and Clear stages the removal; " +
    "no row keeps a send button of its own. After Apply the bar names what the room did not take, and follows the room as " +
    "it lands. A choice that cannot be changed — locked, or not yours — is the same radio list, disabled, the room's option " +
    "chosen, compared against the unlocked list; and (J135) every row draws the same controls locked as unlocked, each disabled " +
    "when it cannot be changed now — locked, no rights, or not delegated — More and Show advanced options still working, the " +
    "chosen radio drawn bright, the rows under a switch dark while locked. THE BAR IS DECLARED ABOVE THE SCROLLER; HOW EITHER LOOKS IS BROWSER " +
    "LAYOUT, AND ONLY A PERSON AT A SCREEN CAN SAY");
}
main().catch((e) => fail("threw — " + ((e && e.stack) || e)));
