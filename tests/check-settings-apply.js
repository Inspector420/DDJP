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
//   PART M — a choice that cannot be changed shows its chosen option's words, like Who can DJ.
//   PART N — titles explain themselves; each sentence waits under More; values on the title line.
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

// One client's panel. `delegated` names the keys a non-owner may request; `owner` decides the route.
function world(opts) {
  const o = opts || {};
  const performed = [], requested = [], timers = [];
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
    BotRuntime: { botInRoom: () => true },
    ChatPanels: { _settingDisplayName: (k) => "«" + k + "»" },
    Screens: { renderExportSection() {} }, QueuePanels: { _disableAllControls() {} },
    Media: { safeBgUrl: (raw) => (/^https:\/\/img\.ok\/.+\.png$/.test(raw) ? raw : null) },
    ChatPrefs: { bgOpts: () => ({ bgOn: true, hostAllowed: () => true }) },
    Logger: { info() {}, warn() {}, debug() {}, error() {} },
    document: { createElement: node, body: node("body") },
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout() {},
    console, Date: FakeDate, Math, JSON, Promise, Object, Array, String, Number, Set, Error,
  };
  vm.createContext(ctx);
  // The activity groups' names are ui/base.js's ONE shared table (ddjp_456); the panel asks the host for
  // them, so the REAL functions are run here and handed over as base.js's `publish` does.
  const _baseNames = ["ACTIVITY_GROUP_NAMES", "activityGroupName", "activityGroupsText"].map((n) => {
    const x = require("./_probe-j14-card.js").extractNamed("ui/base.js", n);
    if (!x.ok) throw new Error("shared group names not extractable: " + x.stage);
    return x.source;
  }).join("\n");
  vm.runInContext(_baseNames + "\n;UIBase.host.activityGroupName = activityGroupName; UIBase.host.activityGroupsText = activityGroupsText;\n" +
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
  return { ctx, S, box, slot, scroller, settings, performed, requested, timers, render, openAll, row, bar, apply, lockBtn, status,
    pickOther, toggle, typeInto, setLocked: (v) => { locked = !!v; }, setRoom: (r) => { room = r; }, tick: (ms) => { clock += ms; } };
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
  {
    const w = world({});
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
  {
    const w = world({ owner: false, delegated: ["maxLen", "graceMs"] });
    w.render(); w.openAll();
    const lim = BE.StreamManager.settingRanges();
    const mk = (k, d) => { const r = lim[k], f = r.scale || 1; const c = w.settings[k] / f;
      return (c + d <= r.max / f) ? c + d : c - d; };
    const a = mk("maxLen", 60), b = mk("graceMs", 1);
    ok(w.typeInto("maxLen", a) && w.typeInto("graceMs", b), "C: APPLIED — two delegated number rows were edited");
    ok(w.requested.length === 0 && w.performed.length === 0, "C: nothing is sent before Apply", { r: w.requested, p: w.performed });
    w.apply().onclick(); await settle();
    ok(w.requested.length === 1, "C: APPLY IS ONE BOT REQUEST, not one per setting", w.requested);
    ok(Object.keys(w.requested[0]).sort().join(",") === "graceMs,maxLen", "C: carrying both keys", w.requested[0]);
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
    ok(inputs("botPresenceChat", "checkbox").length === 1, "J: an on/off setting is ONE checkbox", inputs("botPresenceChat", "checkbox").length);
    ok(inputs("vis", "radio").length === 2 && inputs("chat", "radio").length >= 2, "J: a choice among several is a radio list", { vis: inputs("vis", "radio").length, chat: inputs("chat", "radio").length });
    ok(inputs("minDjRank", "radio").length >= 2, "J: and so is the minimum DJ rank", inputs("minDjRank", "radio").length);
    const groups = inputs("activityPresence", "checkbox");
    ok(groups.length === 6, "J: the 'what counts' switches are a checkbox list, one per group", groups.length);
    // A CHOICE pill carried aria-pressed; buttons that DO something (Clear, Remove, Hide the list) never did.
    const pills = find(w.box, (n) => n.tag === "button" && /\bset-opt\b/.test(n.className) && n.attrs["aria-pressed"] !== undefined);
    ok(pills.length === 0, "J: no choice is a button pill any more, anywhere in the room panel", pills.length);
    // Still STAGED and sent in ONE Apply: a checkbox and a radio, then Apply.
    const before = w.settings.botPresenceChat;
    ok(w.toggle("botPresenceChat") === !before && w.pickOther("vis"), "J: APPLIED — a checkbox flipped and a radio picked");
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
{
  const flatL = (n) => [n].concat(...((n && n.children) || []).map(flatL));
  const w = world({ locked: true, settings: { bg: "", skipRoads: [] } });
  w.render(); w.openAll();
  const rowFor = (k) => flatL(w.box).find((n) => (n.getAttribute ? n.getAttribute("data-key") : null) === k || (n.dataset && n.dataset.key === k));
  const valueText = (k) => { const r = rowFor(k); const v = r && flatL(r).find((n) => /\bset-value\b/.test(n.className || "")); return v ? (v._text || v.text || v.textContent || "") : null; };
  ok(valueText("bg") === "No background", "L: LOCKED, NO BACKGROUND SET — the row says so, instead of showing nothing", valueText("bg"));
  ok(valueText("skipRoads") === "No skip rules", "L: LOCKED, NO SKIP RULES — the row says so, instead of showing nothing", valueText("skipRoads"));
  const stateOf = (r) => flatL(r).some((x) => x.tag === "input" || x.tag === "select" || /\b(set-value|dim-row|set-rule)\b/.test(x.className || "") || /\bmuted\b/.test(x.className || ""));
  // A TABLE setting's title row holds only its heading; each rank's value is its own row right after it —
  // so a table counts as showing its state when EVERY one of those rank rows shows a value.
  const rankRowsAfter = (n) => {
    const par = flatL(w.box).find((p) => (p.children || []).indexOf(n) >= 0);   // this world's nodes do not record a parent
    const sib = (par && par.children) || [];
    const out = [];
    for (let i = sib.indexOf(n) + 1; i < sib.length && /\bset-rank-row\b/.test(sib[i].className || ""); i++) out.push(sib[i]);
    return out;
  };
  const tableShows = (n) => { const rr = rankRowsAfter(n); return rr.length > 0 && rr.every((r) => flatL(r).some((x) => /\bset-value\b/.test(x.className || ""))); };
  const blank = flatL(w.box).filter((n) => /\bset-row\b/.test(n.className || "") && (n.getAttribute && n.getAttribute("data-key")) && !stateOf(n) && !tableShows(n)).map((n) => n.getAttribute("data-key"));
  ok(blank.length === 0, "L: and NO row, locked, shows nothing — every setting shows what it is set to, whoever is looking", blank);
}

  // ═══ PART M — a choice that cannot be changed SHOWS ITS WORDS (owner rulings, ddjp_482 → ddjp_483) ═══════════
  // PART L counts a row as showing its state when it holds an input, and a locked radio list passed it while
  // nobody could read it: a disabled radio is drawn in the browser's own grey. ddjp_482 faded the unchosen
  // options; the owner found the shades of grey awkward and ruled for the WORD — the shape Who can DJ always
  // had, now `_choiceList`'s, so every choice row gets it from one place. Locked, or not yours to change,
  // alike. Compared against the UNLOCKED render of the same settings, so no label is restated here.
  {
    // Each list set to its SECOND option, so "the first option's words" cannot pass. Who can DJ's order is the
    // reducer's own (it lists guest FIRST), so its second value is read from that table, never assumed.
    const two = { vis: "public", chat: "guest", minDjRank: BE.StreamManager.settingRanges().minDjRank.values[1] };
    const radioRows = (w) => find(w.box, (n) => n.attrs && n.attrs["data-key"] && find(n, (x) => x.tag === "input" && x.attrs.type === "radio").length > 0);
    const open = world({ locked: false, settings: two }); open.render();
    const choiceKeys = radioRows(open).map((r) => r.attrs["data-key"]);
    ok(choiceKeys.length >= 3, "M: APPLIED — unlocked, the choice rows render radio lists to choose from", choiceKeys);
    const chosenText = (key) => {
      const r = open.row(key), on = find(r, (x) => x.tag === "input" && x.attrs.type === "radio" && x.checked)[0];
      const lab = on && find(r, (n) => n.tag === "label" && n.children.indexOf(on) >= 0)[0];
      const t = lab ? lab.children.find((c) => c.tag === "span") : null;
      return t ? t.text : null;
    };
    // By POSITION, not by label, so relabelling an option cannot turn this red.
    const notFirst = choiceKeys.filter((k) => { const rs = find(open.row(k), (x) => x.tag === "input" && x.attrs.type === "radio");
      return rs.length >= 2 && !rs[0].checked && rs.some((x) => x.checked); });
    ok(choiceKeys.every((k) => chosenText(k)) && notFirst.length === choiceKeys.length,
      "M: APPLIED — each unlocked list has the room's option chosen, and it is NOT the first one", { choiceKeys, notFirst });
    const word = (w, key) => { const r = w.row(key); const v = r && find(r, (n) => /\bset-value\b/.test(n.className || ""))[0]; return v ? v.text : null; };
    for (const [who, w] of [["LOCKED", world({ locked: true, settings: two })], ["NOT YOURS TO CHANGE", world({ locked: false, owner: false, settings: two })]]) {
      w.render();
      ok(find(w.box, (n) => n.tag === "input" && n.attrs.type === "radio").length === 0,
        "M: " + who + ", NO RADIO renders anywhere in the panel — nothing is left to read in grey", radioRows(w).map((r) => r.attrs["data-key"]));
      const wrong = choiceKeys.filter((k) => word(w, k) !== chosenText(k)).map((k) => [k, word(w, k), chosenText(k)]);
      ok(wrong.length === 0, "M: " + who + ", every choice row shows its chosen option's OWN WORDS — the same words the list gives it", wrong);
    }
    const odd = world({ locked: true, settings: { vis: "not-an-option" } }); odd.render();
    ok(word(odd, "vis") === "\u2014", "M: a value that is none of the options reads \u2014, rather than naming a choice nobody made", word(odd, "vis"));
  }

  // ═══ PART N — the title says what it is; its sentence waits under More (owner-approved preview, ddjp_487) ═══
  // Every row stacked a title, a sentence and its control, so the panel read as prose. Each title now
  // explains itself, the sentence and any detail sit behind one More, a number sits on its title line, and
  // a locked row is one line. The style is the panel's own; only where things sit changed.
  {
    const DROPPED = ["botPresenceChat", "botQueueChat"];   // their sentence only repeated the title (the third, `botPresenceSpine`, is gone: ddjp_498)
    const cls = (c) => (n) => new RegExp("\\b" + c + "\\b").test(n.className || "");
    // A key with ":" is an item INSIDE a row (one tick of an actions list), not a row of its own.
    const keyed = (w) => [...new Set(find(w.box, (n) => n.attrs && n.attrs["data-key"]).map((n) => n.attrs["data-key"]))].filter((k) => k.indexOf(":") < 0);
    const open = world({ locked: false }); open.render();
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
    const lk = world({ locked: true }); lk.render();
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

console.log("[settings-apply] PASS — room settings are STAGED and one Apply is ONE message (" + asserts + " assertions): " +
    "the real panel, driven by clicking and typing, sends nothing for three edits and then one owner write carrying all " +
    "three, or one bot request carrying every key for a delegated person. ANY lock discards what is staged — the lock " +
    "button, the relock a tab switch performs, and leaving the room — against a control that keeps it through ordinary " +
    "re-renders. The background link has no Set button, an unapproved link holds Apply back, and Clear stages the removal; " +
    "no row keeps a send button of its own. After Apply the bar names what the room did not take, and follows the room as " +
    "it lands. A choice that cannot be changed — locked, or not yours — shows its chosen option's own words from one " +
    "builder, compared against the unlocked list. THE BAR IS DECLARED ABOVE THE SCROLLER; HOW EITHER LOOKS IS BROWSER " +
    "LAYOUT, AND ONLY A PERSON AT A SCREEN CAN SAY");
}
main().catch((e) => fail("threw — " + ((e && e.stack) || e)));
