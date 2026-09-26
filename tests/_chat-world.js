// tests/_chat-world.js
// THE ONE CHAT WORLD the chat guards drive — a harness, not a guard (no `check-` prefix, so
// `run-all` does not run it). Split out of `check-chat-view.js` at ddjp_425 so `check-chat-tiers`
// and `check-chat-redaction` drive the SAME real modules through the SAME DOM double rather than
// each keeping a fake of its own: three doubles of one screen is the copied-rule shape, one level out.
//
// WHAT IS REAL: `ChatPrefs` (over a fake localStorage), `ChatBuffer`, `Chat`, `Room` (its `foldFeed`
// runs for real; `chatTiers`, `selectChatTier`, `getMyId` and `recentEvents` are replaced — the last
// by the REAL `foldFeed` over a log the guard controls) and the whole of `ui/chat.js`.
// WHAT IS A DOUBLE, AND WHY: the DOM (no browser), `MatrixBridge` (no SDK — its `recentChatMessages`
// returns the shape read from `backends/backend1/matrixbridge.js`), and `Room.chatTiers`, whose
// resolution rule reads a joined room's channel map and is driven by `check-chat-tiers` PART C.
// The device clock is set eleven thousand years ahead unless `realDate` is asked for, so anything
// that measures the go-forward line against it hides every row (README trap 2).

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");

// ── A DOM DOUBLE THAT CAN ANSWER "WHAT IS ON SCREEN" ─────────────────────────────────────────
// Parent links, insertBefore, fragments, removal, replaceWith, a data-eid selector, and geometry
// in whole rows (20px each) so scroll anchoring is observable. Everything else a browser does —
// layout, cascade, IntersectionObserver — this cannot tell you, and nothing here claims it.
function mk(tag) {
  const n = {
    tag, parent: null, children: [], dataset: {}, style: {}, attrs: {}, className: "", _text: "",
    classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; },
                 toggle(c, on) { if (on) this._s[c] = 1; else delete this._s[c]; }, contains(c) { return !!this._s[c]; } },
    get firstChild() { return this.children[0] || null; },
    get childNodes() { return this.children; },
    get offsetTop() { return this.parent ? this.parent.children.indexOf(this) * 20 : 0; },
    appendChild(c) { return this.insertBefore(c, null); },
    insertBefore(c, ref) {
      const kids = c.tag === "#frag" ? c.children.slice() : [c];
      if (c.tag === "#frag") c.children.length = 0;
      for (const k of kids) { if (k.parent) k.parent._drop(k); k.parent = this; }
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i < 0) this.children.push(...kids); else this.children.splice(i, 0, ...kids);
      return c;
    },
    _drop(k) { const i = this.children.indexOf(k); if (i >= 0) this.children.splice(i, 1); k.parent = null; },
    removeChild(k) { this._drop(k); return k; },
    remove() { if (this.parent) this.parent._drop(this); },
    replaceWith(x) { const p = this.parent; if (!p) return; p.insertBefore(x, this); p._drop(this); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { if (t === "scroll") this._onscroll = fn; }, removeEventListener() {},
    _all() { const out = []; (function w(n) { for (const c of n.children) { out.push(c); w(c); } })(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) {
      const m = /\[data-eid="([^"]+)"\]/.exec(sel); if (!m) return [];
      const wantImg = /^img/.test(sel);
      return this._all().filter((x) => x.dataset && x.dataset.eid === m[1] && (!wantImg || x.tag === "img"));
    },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    set textContent(v) { this._text = String(v); this.children.length = 0; },
    get scrollHeight() { return this.children.length * 20; }, clientHeight: 200, scrollTop: 0,
  };
  return n;
}
function el(tag, attrs, kids) {
  const n = mk(tag);
  for (const k in (attrs || {})) {
    if (k === "text") n._text = String(attrs[k]); else if (k === "class") n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
  }
  for (const c of (kids || [])) if (c) n.appendChild(c);
  return n;
}
const documentDouble = {
  createTextNode: (t) => { const n = mk("#text"); n._text = String(t); return n; },
  createElement: (t) => mk(t),
  createDocumentFragment: () => mk("#frag"),
  getElementById: () => null,
};

// Every row the box holds, in order, as "m:<id>" for a message and "f:<eventId>" for a feed row.
function screen(box) {
  return box.children.map((n) => (n.dataset && n.dataset.eid) ? "m:" + n.dataset.eid
                                  : (n.dataset && n.dataset.fid) ? "f:" + n.dataset.fid : "?:" + n.className);
}

// ── ONE WORLD: the real modules, with a room of two readable tiers and one channel nobody names ──
function world(opts) {
  const o = opts || {};
  const refs = {};
  const tiersState = { mainTier: "uncategorized" };
  const TIERS = [{ tier: "uncategorized", id: "!u:hs", level: 0 }, { tier: "staff", id: "!s:hs", level: 50 }];
  const history = o.history || {};          // channel id -> the server's timeline tail
  const asked = [];                          // which channels the backfill asked for, and how many
  const sent = [];                           // every message that reached the transport
  const tabsSet = [];                        // every right-panel tab the panel switched to
  const ui = { rightTab: "chat", panes: { social: true, queues: true, player: true } };   // wide by default
  const invites = (o.invites || []).slice(), accepted = [], declined = [], performed = [];   // DM requests, as the transport reports them
  let pendingFetch = [];                     // resolve the fetches by hand, so a flood can land first
  // A LIST, as the real transport keeps (`matrixbridge.js` `_rawListeners`, de-duplicated, fanned out to
  // every listener). This was a single slot, which was harmless while only room chat listened and wrong
  // the moment the DM handler joined: a double must take its shape from the real thing.
  const rawListeners = [];
  const rawListener = (raw, ev, room) => { for (const fn of rawListeners.slice()) fn(raw, ev, room); };
  const carded = [];                         // every name wired to the user card, in order
  const MB = {
    onRawEvent: (fn) => { if (fn && rawListeners.indexOf(fn) < 0) rawListeners.push(fn); },
    offRawEvent: (fn) => { const i = rawListeners.indexOf(fn); if (i >= 0) rawListeners.splice(i, 1); },
    sendMessage: async (roomId, text) => { sent.push({ roomId, text }); }, redactEvent: async () => {}, mayRedactIn: () => false,
    getUserId: () => "@me:hs",
    recentChatMessages: (roomId, count) => {
      asked.push({ roomId, count });
      const msgs = (history[roomId] || []).slice(-count).map((m) => ({ event_id: m.id, sender: m.sender, body: m.body, ts: m.ts, failed: false }));
      if (o.holdFetch) return new Promise((r) => pendingFetch.push(() => r({ messages: msgs })));
      return Promise.resolve({ messages: msgs });
    },
  };
  // A clock that would be obviously wrong if anything used it for the go-forward line (P2).
  const LocalDate = function () { return new Date(...arguments); };
  LocalDate.now = () => 9e15;
  const sb = loadInContext(
    ["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js", "core/chatprefs.js",
     "ui/chatbuffer.js", "features/chat.js", "features/room.js", "ui/chat.js"],
    {
      Date: o.realDate ? Date : LocalDate, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
      // A recording AudioContext when a guard asks for one (the mention chime); absent otherwise, as in a
      // browser that has none — the chime must then do nothing rather than throw.
      AudioContext: o.AudioContext,
      localStorage: o.localStorage || { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
                      setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
      indexedDB: undefined, document: documentDouble, CSS: undefined, IntersectionObserver: undefined,
      // `inDMScope` names one DM room, so the DM receive path can run; `sent` records every send.
      MatrixBridge: MB, MatrixAccount: { cryptoAvailable: () => true, inDMScope: (id) => id === "!dm:hs",
                                         dmRoomIds: () => ["!dm:hs"], setDMScope: () => {}, addDMScope: () => {},
                                         dmInviteRoomIds: () => invites.slice(),
                                         // A room the client does not have, after the first sync, is gone (ddjp_439).
                                         oneToOnePeer: () => ({ peer: null, reason: "gone" }), dmRoomsWith: () => [], findDMRoom: () => null,
                                         acceptDMInvite: async (id) => { accepted.push(id); await new Promise((r) => setTimeout(r, 5));
                                           const i = invites.findIndex((x) => x.roomId === id); const inv = i >= 0 ? invites.splice(i, 1)[0] : null;
                                           return { roomId: id, recorded: true, userId: inv ? inv.from : null }; },
                                         declineDMInvite: async (id) => { declined.push(id); const i = invites.findIndex((x) => x.roomId === id); if (i >= 0) invites.splice(i, 1); } },
      Panels: { _fmtAgo: () => "now" },
      // The right panel's redraw, which the panel's open path calls (ui/queue.js); the dots are redrawn by the guard.
      QueuePanels: { renderRightPanel() {} },
      // The adapter, recording what the panel asked of it; `performResult` sets what it answers.
      Actions: { perform: async (a, ctx) => { performed.push({ a, ctx }); return o.performResult || { ok: true, roomId: "!dm:hs" }; } },
      UIBase: { refs, host: { el, clear: (n) => { for (const c of n.children.slice()) n._drop(c); n._text = ""; },
                              _rosterLevel: () => 0, rankColor: () => "#fff", shortName: (s) => s,
                              avatarEl: () => mk("span"), setRightTab(t) { tabsSet.push(t); ui.rightTab = t; }, rightTab: () => ui.rightTab,
                              // What is ON SCREEN (ddjp_441): the right-panel tab, and which panes the layout shows.
                              paneShown: (p) => !!ui.panes[p], queueTab: () => "room",
                              // The panel's real open path relocks the panels (shell.js); no locks in this world.
                              _relockAllPanels() {} } },
      Roster: { _wireCardTrigger(el, who) { carded.push(who || null); } },
    });
  const Room = sb.Room;
  // The resolution the panel reads, in `Room.chatTiers()`'s own return shape.
  Room.chatTiers = () => {
    const tiers = TIERS.map((t) => ({ tier: t.tier, id: t.id, level: t.level, main: t.tier === tiersState.mainTier }));
    const want = sb.ChatPrefs.chatTier();
    const a = tiers.find((t) => t.tier === want) || tiers.find((t) => t.tier === tiersState.mainTier) || tiers[0];
    const mainRow = tiers.find((t) => t.tier === tiersState.mainTier) || null;
    return { tiers, activeTier: a.tier, activeId: a.id, mainTier: tiersState.mainTier, mainId: mainRow ? mainRow.id : null };
  };
  Room.selectChatTier = (tier) => { sb.ChatPrefs.setChatTier(tier); const r = Room.chatTiers(); sb.Chat.setRoom(r.activeId); return r; };
  Room.getMyId = () => "@me:hs";
  // The feed the panel reads is the REAL fold over a log this guard controls.
  const log = [];
  const refused = new Set();
  Room.recentEvents = (fopts) => Room.foldFeed(log.slice(), (id) => !refused.has(id), Object.assign({}, fopts, { roomExists: true }));
  // Bind Chat the way `features/room.js` does at entry: init on the main channel, then widen.
  sb.Chat.init("!u:hs");
  sb.Chat.setReadableTiers(TIERS.map((t) => t.id));
  const box = el("div");
  refs.chatBox = box;
  refs.chatTiers = el("div");
  refs.tabChat = el("button");
  // A text input as far as the @ insertion needs one: value, a caret, focus.
  refs.chatInput = Object.assign(mk("input"), { value: "", selectionStart: 0, selectionEnd: 0, focused: false,
    focus() { this.focused = true; }, setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; } });
  sb.Chat.onMessage(sb.ChatPanels.addChatMessage);
  sb.Chat.onRedaction(sb.ChatPanels.removeChatMessage);
  // `failed` sends it as this device's SDK reports an undecryptable message: the event says so.
  const raw = (id, room, ts, body, sender, failed) => rawListener({ type: "m.room.message", room_id: room, event_id: id,
    sender: sender || "@a:hs", content: { body: body || id }, ts },
    failed ? { isDecryptionFailure: () => true } : {}, {});
  const redaction = (target, room) => rawListener({ type: "m.room.redaction", room_id: room, redacts: target, sender: "@a:hs", event_id: "$r" + target, ts: 1 }, {}, {});
  const rawDM = (id, ts, body, sender) => rawListener({ type: "m.room.message", room_id: "!dm:hs", event_id: id,
    sender: sender || "@a:hs", content: { body: body || id }, ts }, {}, {});
  return { sb, CP: sb.ChatPanels, box, refs, tiersState, log, refused, asked, raw, redaction, carded, sent, rawDM, tabsSet, ui, invites, accepted, declined, performed,
           releaseFetches: () => { const p = pendingFetch; pendingFetch = []; for (const f of p) f(); } };
}
const tick = () => new Promise((r) => setImmediate(r));

// The strip button a person would click, or null. The guard asserts it exists before clicking.
function tierButton(w, label) {
  w.CP._renderChatTierStrip();
  return w.refs.chatTiers.children.find((x) => (x._text || "").indexOf(label) === 0) || null;
}

module.exports = { world, screen, tick, tierButton, el, mk };
