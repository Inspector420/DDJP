// tests/_screen-world.js
// THE MAIN SCREEN, BUILT BY THE REAL ui/ CODE IN A DOM DOUBLE — a harness, not a guard (no `check-` prefix, so
// `run-all` does not run it). Written for `check-owner-screens` (the owner's screen decisions at `ddjp_635`).
//
// WHAT IS REAL: every ui/ file, loaded WHOLE in page order, and the main screen built by their own
// `buildMainDom`, so no declaration is extracted by name and a reshaped region cannot make this refuse
// quietly. WHAT IS A DOUBLE: the DOM (below), and the feature layer under ui/ — each feature is a recording
// stand-in answering only what a world scripts (`o.features`); an unscripted call answers `undefined` and is
// RECORDED (`unscripted`), so a guard can see what the screen asked for that nobody answered.
//
// THE STYLESHEET IS READ, AND THAT IS ALL THAT IS CLAIMED FOR IT. `cascade(node, prop)` answers the value the
// page's own `<style>` declares for that node — inline style first, then the matching rule of highest
// specificity, later rules winning ties. Only the static state: rules under `:hover`, `:focus`, `::before`
// and the like, and everything inside `@media`/`@keyframes`, never apply. No layout: a flex row that
// stretches a button is not seen here (the drive in a real browser is how that was measured).

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const { collectionOf, nodeListOf } = require("./_domshape.js");
const { styleBlocks } = require("./_page-css.js");   // the page's <style> text as a browser reads it (comments skipped)

// ── WHAT A TRIGGER DID TO THE SCREEN (J130) ───────────────────────────────────────────────────
// Every change to a child list is told to the document's watchers (`world(...).watch(root)`), the way a MutationObserver
// with `subtree: true` hears it in a browser: a record for each insert and removal under the watched node. A watcher
// counts what J130 is about — the pane's own child list replaced (a REBUILD) and song rows put into it or taken out — and
// the same counts are read in Chromium by `tools/probes`' screen drive, so the double and the browser answer one question.
function noteMutation(doc, target, added, removed) {
  if (!doc || !doc.__watchers || !doc.__watchers.length) return;
  for (const w of doc.__watchers) {
    let inRoot = false;
    for (let p = target; p; p = p.parent) if (p === w.root) { inRoot = true; break; }
    if (!inRoot) continue;
    w.records++;
    if (typeof w.note === "function") w.note(target);   // `ddjp_699`: which node changed, for a watcher that is a MutationObserver's double
    if (target === w.root && removed.length) w.paneRebuilds++;
    const rows = (n) => (n.nodeType === 1 ? ((n.matches(".song-row") ? 1 : 0) + n.querySelectorAll(".song-row").length) : 0);
    for (const n of added) w.rowsBuilt += rows(n);
    for (const n of removed) w.rowsRemoved += rows(n);
  }
}

// ── A DOM DOUBLE WITH SELECTORS ───────────────────────────────────────────────────────────────
// `el` in ui/base.js sets `className`, `onclick`, `value`, `placeholder`, `disabled` as properties and every
// other key as an attribute — this takes its shape from the real DOM those calls reach.
function mkText(t) {
  return { nodeType: 3, tag: "#text", parent: null, _t: String(t),
    get parentNode() { return this.parent; }, get textContent() { return this._t; }, set textContent(v) { this._t = String(v); },
    remove() { if (this.parent) this.parent.removeChild(this); } };
}
function mk(tag, doc) {
  const n = {
    nodeType: 1, tag: String(tag).toLowerCase(), parent: null, _kids: [], attrs: {}, dataset: {}, _cls: "", _listeners: {},
    ownerDocument: doc || null, value: "", disabled: false, checked: false, scrollTop: 0, scrollLeft: 0,
    clientHeight: 0, clientWidth: 0, scrollHeight: 0, scrollWidth: 0, offsetWidth: 0, offsetHeight: 0, offsetTop: 0,
    get tagName() { return this.tag.toUpperCase(); }, get nodeName() { return this.tagName; },
    get className() { return this._cls; }, set className(v) { this._cls = String(v == null ? "" : v); },
    get id() { return this.attrs.id || ""; }, set id(v) { this.attrs.id = String(v); },
    get title() { return this.attrs.title || ""; }, set title(v) { this.attrs.title = String(v); },
    get parentNode() { return this.parent; }, get parentElement() { return this.parent; },
    // CHILDREN (J130): stored in `_kids` (every node, text included). Without `domShaped` a node answers `children` and
    // `childNodes` with that Array, as it always did; with it, `children` is an HTMLCollection (elements only) and
    // `childNodes` a NodeList, `tests/_domshape.js`'s shapes — no array methods, as in a browser.
    get children() { return (doc && doc.__shape) ? collectionOf(() => this._kids.filter((c) => c.nodeType === 1)) : this._kids; },
    set children(v) { this._kids = Array.isArray(v) ? v : Array.from(v || []); },
    get childNodes() { return (doc && doc.__shape) ? nodeListOf(() => this._kids) : this._kids; },
    get firstChild() { return this._kids[0] || null; }, get lastChild() { return this._kids[this._kids.length - 1] || null; },
    get firstElementChild() { return this._kids.find((c) => c.nodeType === 1) || null; },
    get lastElementChild() { const e = this._kids.filter((c) => c.nodeType === 1); return e[e.length - 1] || null; },
    get nextSibling() { if (!this.parent) return null; const k = this.parent._kids; return k[k.indexOf(this) + 1] || null; },
    get previousSibling() { if (!this.parent) return null; const k = this.parent._kids; return k[k.indexOf(this) - 1] || null; },
    get isConnected() { let p = this; while (p.parent) p = p.parent; return p === (doc && doc.documentElement); },
    get textContent() { return this._kids.map((c) => c.textContent).join(""); },
    set textContent(v) { const was = this._kids; for (const c of was) c.parent = null; this._kids = []; if (v !== "" && v != null) this.appendChild(mkText(v)); else if (was.length) noteMutation(doc, this, [], was); },
    set innerHTML(v) { if (String(v) !== "") throw new Error("the DOM double takes no HTML: " + String(v).slice(0, 40)); this.textContent = ""; },
    get innerHTML() { return ""; },
    appendChild(c) { return this.insertBefore(c, null); },
    append(...cs) { for (const c of cs) this.appendChild(typeof c === "string" ? mkText(c) : c); },
    prepend(...cs) { for (const c of cs.reverse()) this.insertBefore(typeof c === "string" ? mkText(c) : c, this.firstChild); },
    insertBefore(c, ref) {
      if (c.tag === "#frag") { for (const k of c._kids.slice()) this.insertBefore(k, ref); return c; }
      if (c.parent) c.parent.removeChild(c);
      c.parent = this;
      const i = ref ? this._kids.indexOf(ref) : -1;
      if (i < 0) this._kids.push(c); else this._kids.splice(i, 0, c);
      noteMutation(doc, this, [c], []);
      return c;
    },
    removeChild(c) { const i = this._kids.indexOf(c); if (i >= 0) this._kids.splice(i, 1); c.parent = null; if (i >= 0) noteMutation(doc, this, [], [c]); return c; },
    replaceChild(nu, old) { this.insertBefore(nu, old); this.removeChild(old); return old; },
    replaceWith(x) { if (this.parent) this.parent.replaceChild(x, this); },
    remove() { if (this.parent) this.parent.removeChild(this); },
    replaceChildren(...cs) { const was = this._kids; for (const c of was) c.parent = null; this._kids = []; if (was.length) noteMutation(doc, this, [], was); for (const c of cs) this.appendChild(typeof c === "string" ? mkText(c) : c); },
    contains(x) { for (let p = x; p; p = p.parent) if (p === this) return true; return false; },
    setAttribute(k, v) { if (k === "class") this.className = v; else this.attrs[k] = String(v); },
    getAttribute(k) { return k === "class" ? this._cls : (this.attrs[k] == null ? null : this.attrs[k]); },
    hasAttribute(k) { return k === "class" ? !!this._cls : this.attrs[k] != null; },
    removeAttribute(k) { if (k === "class") this._cls = ""; else delete this.attrs[k]; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener(t, fn) { const l = this._listeners[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatchEvent(e) { for (const fn of (this._listeners[e.type] || []).slice()) fn(e); return true; },
    // A CLICK AS A PERSON MAKES ONE: the handler runs and the event bubbles, unless a handler stops it.
    click() {
      const ev = { type: "click", target: this, _stop: false, stopPropagation() { this._stop = true; }, preventDefault() {} };
      for (let p = this; p && !ev._stop; p = p.parent) {
        if (p.nodeType !== 1) continue;
        if (p === this && this.disabled) return;
        if (typeof p.onclick === "function") p.onclick(ev);
        for (const fn of (p._listeners.click || []).slice()) fn(ev);
      }
    },
    focus() { if (doc) doc.activeElement = this; }, blur() {}, select() {}, scrollIntoView() {}, scrollTo() {},
    setSelectionRange() {},
    getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    getClientRects() { return []; },
    animate() { return { cancel() {}, finished: Promise.resolve() }; },
    matches(sel) { return matches(this, sel); },
    closest(sel) { for (let p = this; p && p.nodeType === 1; p = p.parent) if (matches(p, sel)) return p; return null; },
    querySelectorAll(sel) { const out = []; (function w(x) { for (const c of x._kids) if (c.nodeType === 1) { if (matches(c, sel)) out.push(c); w(c); } })(this); return (doc && doc.__shape) ? nodeListOf(out) : out; },
    querySelector(sel) { let hit = null; (function w(x) { for (const c of x._kids) { if (hit) return; if (c.nodeType === 1) { if (matches(c, sel)) { hit = c; return; } w(c); } } })(this); return hit; },
    getElementsByClassName(c) { return this.querySelectorAll("." + c); },
  };
  n.classList = {
    _get() { return n._cls.split(/\s+/).filter(Boolean); },
    _set(a) { n._cls = a.join(" "); },
    add(...cs) { const a = this._get(); for (const c of cs) if (a.indexOf(c) < 0) a.push(c); this._set(a); },
    remove(...cs) { this._set(this._get().filter((c) => cs.indexOf(c) < 0)); },
    contains(c) { return this._get().indexOf(c) >= 0; },
    toggle(c, on) { const has = this.contains(c); const v = (on === undefined) ? !has : !!on; if (v) this.add(c); else this.remove(c); return v; },
    get length() { return this._get().length; },
  };
  n.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] || ""; } };
  // SCROLL AND HEIGHT, AS CHROMIUM HAS THEM, ONLY WITH `domShaped` (J130). Without it these are the plain numbers they always
  // were. With it: a detached node scrolls nowhere (it reads 0, as a node with no layout box does); setting `scrollTop` to a
  // new value fires a `scroll` event at the NEXT FRAME (`frame()`), as Chromium does — the event that made the windowed stack
  // paint a third time; and the queue pane's two scrollers (`.uq-scroll`, `.pl-scroll`) have the height Chromium measured for
  // them at their FIRST paint (614 px in a 1400×900 window, `ddjp_654`'s drive), everything else 0. No layout beyond that:
  // `scrollTop` is not clamped at the bottom.
  // `dataset` IS THE `data-*` ATTRIBUTES, as in a browser — with `domShaped` only (a selector like `[data-vid="…"]`, which the
  // thumbnail loader finds its rows by, reads what `dataset.vid = …` wrote). Without it, a plain store, as before.
  const kebab = (k) => String(k).replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
  const plainData = {};
  n.dataset = new Proxy(plainData, {
    get(t, k) { if (typeof k === "string" && doc && doc.__shape) { const v = n.attrs["data-" + kebab(k)]; return v === undefined ? undefined : v; } return t[k]; },
    set(t, k, v) { if (typeof k === "string" && doc && doc.__shape) n.attrs["data-" + kebab(k)] = String(v); else t[k] = v; return true; },
    deleteProperty(t, k) { if (typeof k === "string" && doc && doc.__shape) delete n.attrs["data-" + kebab(k)]; else delete t[k]; return true; },
  });
  let st = 0, ch = 0;
  Object.defineProperty(n, "scrollTop", { configurable: true, enumerable: true,
    get() { return (doc && doc.__shape && !n.isConnected) ? 0 : st; },
    set(v) {
      const x = Number(v) || 0;
      if (!(doc && doc.__shape)) { st = x; return; }
      const y = Math.max(0, x);
      if (y !== st) { st = y; doc.__shape.scrolled(n); }
    } });
  Object.defineProperty(n, "clientHeight", { configurable: true, enumerable: true,
    get() {
      if (!(doc && doc.__shape)) return ch;
      if (!n.isConnected) return 0;
      return (n.classList.contains("uq-scroll") || n.classList.contains("pl-scroll")) ? doc.__shape.viewH : ch;
    },
    set(v) { ch = Number(v) || 0; } });
  return n;
}
function makeDocument() {
  const doc = { listeners: {}, activeElement: null, title: "", visibilityState: "visible", hidden: false };
  doc.documentElement = mk("html", doc);
  doc.head = mk("head", doc); doc.body = mk("body", doc);
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.createElement = (t) => mk(t, doc);
  doc.createElementNS = (ns, t) => mk(t, doc);
  doc.createTextNode = (t) => mkText(t);
  doc.createDocumentFragment = () => mk("#frag", doc);
  doc.getElementById = (id) => doc.documentElement.querySelector("#" + id);
  doc.querySelector = (s) => doc.documentElement.querySelector(s);
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s);
  doc.addEventListener = (t, fn) => { (doc.listeners[t] = doc.listeners[t] || []).push(fn); };
  doc.removeEventListener = () => {};
  doc.hasFocus = () => true;
  return doc;
}

// ── SELECTORS: compound (tag, #id, .class, [attr], [attr=v], :not(x), :disabled, :empty, :first-child,
// :last-child) joined by descendant ' ' and child '>'. Anything else — a state pseudo-class, a pseudo-element,
// a sibling combinator — makes the selector match NOTHING, which is what "the static state" means above.
function parseCompound(s) {
  const c = { tag: null, id: null, cls: [], attrs: [], nots: [], pseudo: [], bad: false };
  let i = 0;
  const ident = () => { const m = /^-?[A-Za-z_][\w-]*/.exec(s.slice(i)); if (!m) { c.bad = true; return ""; } i += m[0].length; return m[0]; };
  if (s[0] === "*") i = 1; else if (/[A-Za-z]/.test(s[0] || "")) c.tag = ident().toLowerCase();
  while (i < s.length && !c.bad) {
    const ch = s[i];
    if (ch === ".") { i++; c.cls.push(ident()); }
    else if (ch === "#") { i++; c.id = ident(); }
    else if (ch === "[") { const j = s.indexOf("]", i); const body = s.slice(i + 1, j); i = j + 1;
      const m = /^([\w-]+)(?:([~|^$*]?=)"?([^"]*)"?)?$/.exec(body.trim()); if (!m) c.bad = true; else c.attrs.push({ k: m[1], op: m[2] || null, v: m[3] }); }
    else if (s.startsWith("::", i)) { c.bad = true; }
    else if (ch === ":") {
      i++; const name = ident();
      if (s[i] === "(") { let d = 0, j = i; for (; j < s.length; j++) { if (s[j] === "(") d++; else if (s[j] === ")") { d--; if (!d) break; } }
        const arg = s.slice(i + 1, j); i = j + 1;
        if (name === "not") c.nots.push(...arg.split(",").map((x) => parseCompound(x.trim())));
        else c.bad = true; }
      else if (["disabled", "empty", "first-child", "last-child", "enabled"].indexOf(name) >= 0) c.pseudo.push(name);
      else c.bad = true;
    } else c.bad = true;
  }
  return c;
}
function parseSelector(sel) {
  // tokens: compounds and combinators
  const parts = []; let cur = "", depth = 0, brk = 0;
  const s = sel.trim().replace(/\s*>\s*/g, " > ").replace(/\s*[+~]\s*/g, " ~ ");
  for (const ch of s) {
    if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "[") brk++; if (ch === "]") brk--;
    if (ch === " " && !depth && !brk) { if (cur) parts.push(cur); cur = ""; } else cur += ch;
  }
  if (cur) parts.push(cur);
  const seq = [];
  let comb = " ";
  for (const p of parts) {
    if (p === ">") { comb = ">"; continue; }
    if (p === "~") { return null; }
    seq.push({ comb, c: parseCompound(p) }); comb = " ";
  }
  return seq.some((x) => x.c.bad) ? null : seq;
}
function classesOf(n) { return String(n.className || n._cls || "").split(/\s+/).filter(Boolean); }
function parentOf(n) { const p = n.parent || n.parentNode || null; return (p && p.tag !== "#frag") ? p : null; }
function attrOf(n, k) { if (k === "class") return n.className; if (n.getAttribute) return n.getAttribute(k); return (n.attrs || {})[k]; }
function matchCompound(n, c) {
  if (!n || n.nodeType === 3 || n.tag === "#text") return false;
  if (c.tag && String(n.tag).toLowerCase() !== c.tag) return false;
  if (c.id && attrOf(n, "id") !== c.id) return false;
  const cl = classesOf(n);
  for (const k of c.cls) if (cl.indexOf(k) < 0) return false;
  for (const a of c.attrs) {
    const v = attrOf(n, a.k);
    if (v == null) return false;
    if (a.op === "=" && String(v) !== a.v) return false;
  }
  for (const p of c.pseudo) {
    if (p === "disabled" && !n.disabled) return false;
    if (p === "enabled" && n.disabled) return false;
    if (p === "empty" && (n._kids || []).length) return false;
    if (p === "first-child" && (!parentOf(n) || parentOf(n)._kids.filter((x) => x.nodeType !== 3)[0] !== n)) return false;
    if (p === "last-child" && (!parentOf(n) || parentOf(n)._kids.filter((x) => x.nodeType !== 3).slice(-1)[0] !== n)) return false;
  }
  for (const x of c.nots) if (x.bad || matchCompound(n, x)) return false;
  return true;
}
function matchSeq(n, seq, k) {
  if (!matchCompound(n, seq[k].c)) return false;
  if (k === 0) return true;
  if (seq[k].comb === ">") { const p = parentOf(n); return !!p && matchSeq(p, seq, k - 1); }
  for (let p = parentOf(n); p; p = parentOf(p)) if (matchSeq(p, seq, k - 1)) return true;
  return false;
}
function matches(n, sel) {
  for (const one of splitList(sel)) { const seq = parseSelector(one); if (seq && matchSeq(n, seq, seq.length - 1)) return true; }
  return false;
}
function splitList(sel) { const out = []; let cur = "", d = 0; for (const ch of sel) { if (ch === "(") d++; if (ch === ")") d--; if (ch === "," && !d) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; }
function specificity(seq) {
  let a = 0, b = 0, c = 0;
  const add = (x) => { if (x.id) a++; b += x.cls.length + x.attrs.length + x.pseudo.length; if (x.tag) c++; for (const y of x.nots) add(y); };
  for (const s of seq) add(s.c);
  return a * 10000 + b * 100 + c;
}

// ── THE PAGE'S OWN STYLESHEET ──────────────────────────────────────────────────────────────────
function readSheet(html) {
  const rules = [];
  let order = 0;
  // READ AS A BROWSER READS THE PAGE (`ddjp_656`): this matched `<style>` across the raw file, began inside the head's comment
  // that mentions it, and lost the page's first rule, `* { box-sizing: border-box; }` — every box read content-box.
  for (const block of styleBlocks(html)) {
    const css = block.replace(/\/\*[\s\S]*?\*\//g, "");
    let i = 0, depth = 0;
    // Walk top-level blocks; an at-rule's block is skipped whole.
    while (i < css.length) {
      const open = css.indexOf("{", i);
      if (open < 0) break;
      const head = css.slice(i, open).trim();
      // find the matching close
      let d = 0, j = open;
      for (; j < css.length; j++) { if (css[j] === "{") d++; else if (css[j] === "}") { d--; if (!d) break; } }
      const body = css.slice(open + 1, j);
      i = j + 1;
      if (head.startsWith("@")) continue;
      const decls = {};
      for (const d1 of body.split(";")) { const k = d1.indexOf(":"); if (k < 0) continue;
        const prop = d1.slice(0, k).trim().toLowerCase(); let val = d1.slice(k + 1).trim(); const imp = /!important$/.test(val); val = val.replace(/\s*!important$/, "");
        if (prop) decls[prop] = { val, imp }; }
      for (const one of splitList(head)) {
        const seq = parseSelector(one);
        rules.push({ sel: one, seq, spec: seq ? specificity(seq) : -1, order: order++, decls });
      }
      void depth;
    }
  }
  return rules;
}
function makeCascade(rules) {
  // The declared value of `prop` for `n`, and which rule gave it ({ val, sel } or null).
  function declared(n, prop) {
    const st = n.style || {};
    const camel = prop.replace(/-([a-z])/g, (_, x) => x.toUpperCase());
    if (st[camel] !== undefined && st[camel] !== "") return { val: String(st[camel]), sel: "(inline style)" };
    let best = null;
    for (const r of rules) {
      if (!r.seq || !r.decls[prop]) continue;
      if (!matchSeq(n, r.seq, r.seq.length - 1)) continue;
      const imp = r.decls[prop].imp ? 1 : 0;
      if (!best || imp > best.imp || (imp === best.imp && (r.spec > best.spec || (r.spec === best.spec && r.order > best.order))))
        best = { val: r.decls[prop].val, sel: r.sel, spec: r.spec, order: r.order, imp };
    }
    return best;
  }
  // Is it on screen as far as the sheet says: neither it nor an ancestor is `display: none`, and the nearest
  // `visibility` (inherited) is not `hidden`. An element not attached under `root` is not on screen.
  function shown(n, root) {
    if (!n) return false;
    let attached = !root;
    for (let p = n; p; p = parentOf(p)) {
      const d = declared(p, "display");
      if (d && /^none\b/.test(d.val)) return false;
      if (root && p === root) attached = true;
    }
    if (!attached) return false;
    for (let p = n; p; p = parentOf(p)) {
      const v = declared(p, "visibility");
      if (v) return v.val !== "hidden";
    }
    return true;
  }
  return { declared, shown };
}

// ── THE FEATURE LAYER UNDER ui/: recording stand-ins ──────────────────────────────────────────
function recorder(name, scripted, unscripted) {
  return new Proxy(scripted || {}, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === "symbol" || k === "then" || k === "toJSON") return undefined;
      return function () { unscripted.push(name + "." + String(k)); return undefined; };
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}

const ROOT = path.resolve(__dirname, "..");
// The song players first, where the page loads them (J29, step 2): the plug, then each service's player in the table's order —
// YouTube's, then SoundCloud's (`ddjp_709`) — as the page's lines list them.
const UI_ORDER = ["ui/songplayer.js", "ui/youtube.js", "ui/soundcloud.js", "ui/chatbuffer.js", "ui/base.js", "ui/player.js", "ui/panels.js", "ui/queue.js", "ui/playlists.js",
                  "ui/roster.js", "ui/chat.js", "ui/settings.js", "ui/screens.js", "ui/shell.js"];

// world(o): o.features — { Name: { method: fn } } laid over the recorders. Returns the sandbox, the document,
// the main box, the refs, the host, the sheet's cascade and the unscripted calls.
//
// THREE OPTIONS, ADDED FOR J130 (`ddjp_654`) AND OFF BY DEFAULT, so every world built before reads exactly as it did:
//   o.domShaped — the tree a browser has: `children` an HTMLCollection and `childNodes`/`querySelectorAll` NodeLists
//                 (`tests/_domshape.js`, the card harness's shape), scroll and the pane's scrollers' height as above, and
//                 FRAMES: `requestAnimationFrame` queues, and `w.frame()` runs one — the `scroll` events set since the last
//                 frame first, then the callbacks queued before it, Chromium's order. `o.viewH` sets the scrollers' height.
//   o.clock     — a virtual clock: `Date.now()` and `new Date()` read it, `setTimeout`/`setInterval` are kept against it,
//                 and `await w.advance(ms)` moves it, running each timer as it falls due and letting promises settle
//                 between them. Without it timers are only recorded (`timers`), as before.
//   o.globals   — more globals for the page (a `URL`, an `IntersectionObserver`, `MetadataService`), laid over the defaults.
// And `w.watch(root)` (any world): counts what happens under `root` until `.take()` — rebuilds of its own child list,
// song rows put in and taken out (`noteMutation` above).
function world(opts) {
  const o = opts || {};
  const unscripted = [];
  const doc = makeDocument();
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const cas = makeCascade(readSheet(html));
  const main = mk("div", doc); main.id = "screen-main"; main.className = "screen";
  doc.body.appendChild(main);
  const timers = [];
  // THE VIRTUAL CLOCK (o.clock).
  const clock = { now: (typeof o.clock === "number") ? o.clock : 1.9e12, seq: 0, due: [] };
  class ClockDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock.now); }
    static now() { return clock.now; }
  }
  const at = (fn, ms, every) => { const id = ++clock.seq; clock.due.push({ id, fn, when: clock.now + Math.max(0, Number(ms) || 0), every: every ? Math.max(1, Number(ms) || 0) : 0 }); return id; };
  const cancel = (id) => { clock.due = clock.due.filter((t) => t.id !== id); };
  // FRAMES (o.domShaped).
  const frames = { queued: [], scrolls: new Set() };
  doc.__watchers = [];
  if (o.domShaped) doc.__shape = { viewH: (typeof o.viewH === "number") ? o.viewH : 614, scrolled: (n) => frames.scrolls.add(n) };
  const F = o.features || {};
  const names = ["Room", "Queue", "UserQueue", "Actions", "Playlists", "Chat", "ChatPrefs", "Store", "Reactions", "Skip",
    "Playback", "MediaLength", "MediaBlocked", "Media", "Metadata", "ServerClock", "BotRuntime", "BotSettings", "Rep",
    "RepReader", "RepRules", "RepBot", "RoomUpgrade", "MatrixAccount", "Session", "Interface"];
  const extras = {
    document: doc, window: null, navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: "double" },
    location: { href: "http://double/", search: "", hash: "", origin: "http://double" },
    localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; }, setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
    setTimeout: o.clock ? ((fn, ms) => at(fn, ms, false)) : ((fn, ms) => { timers.push({ fn, ms }); return timers.length; }),
    clearTimeout: o.clock ? cancel : () => {},
    setInterval: o.clock ? ((fn, ms) => at(fn, ms, true)) : () => 0, clearInterval: o.clock ? cancel : () => {},
    requestAnimationFrame: o.domShaped ? ((fn) => { frames.queued.push(fn); return frames.queued.length; }) : () => 0, cancelAnimationFrame: () => {},
    ResizeObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
    IntersectionObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    getComputedStyle: () => ({ getPropertyValue: () => "" }), CSS: { escape: (s) => String(s) },
    Date: o.clock ? ClockDate : Date, Math, JSON, Promise, Error, Map, Set, WeakMap, Symbol, Object, Array, String, Number, Boolean, RegExp, Intl, Proxy,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  };
  extras.window = extras;   // `window.innerWidth` and friends read off the same object
  extras.innerWidth = 1400; extras.innerHeight = 900;
  extras.addEventListener = () => {}; extras.removeEventListener = () => {}; extras.matchMedia = () => ({ matches: false, addEventListener() {} });
  for (const n of names) extras[n] = recorder(n, F[n], unscripted);
  if (o.globals) for (const k in o.globals) extras[k] = o.globals[k];
  // ui/base.js reads the ladder at LOAD (its display table), so the Room stand-in answers that one call by default.
  if (!F.Room || !F.Room.rankLadder) extras.Room.rankLadder = () => [];
  // `WindowedList` is pure and is the REAL one: the stacked lists page through it, and a stand-in would decide
  // which rows exist.
  const sb = loadInContext(["core/logger.js", "core/windowedlist.js"].concat(UI_ORDER), extras);
  // The main screen is SHOWN the way the app shows it (`Screens.showScreen`), or the sheet's `.screen { display:
  // none }` would hide everything under it.
  sb.Screens.showScreen("screen-main");
  // One frame: the scroll events set since the last, then the callbacks queued before this one (a callback that asks for
  // another frame gets the next).
  function frame() {
    const sc = Array.from(frames.scrolls); frames.scrolls.clear();
    for (const n of sc) n.dispatchEvent({ type: "scroll", target: n });
    const q = frames.queued; frames.queued = [];
    for (const fn of q) fn(clock.now);
  }
  const settle = () => new Promise((r) => setImmediate(r));
  async function advance(ms) {
    const until = clock.now + Math.max(0, Number(ms) || 0);
    await settle();
    for (;;) {
      const next = clock.due.filter((t) => t.when <= until).sort((a, b) => a.when - b.when || a.id - b.id)[0];
      if (!next) break;
      clock.now = Math.max(clock.now, next.when);
      if (next.every) next.when = clock.now + next.every; else clock.due = clock.due.filter((t) => t !== next);
      next.fn();
      await settle();
    }
    clock.now = until;
    await settle();
  }
  function watch(root) {
    const w = { root, records: 0, paneRebuilds: 0, rowsBuilt: 0, rowsRemoved: 0 };
    doc.__watchers.push(w);
    return { take() { doc.__watchers = doc.__watchers.filter((x) => x !== w); return { records: w.records, paneRebuilds: w.paneRebuilds, rowsBuilt: w.rowsBuilt, rowsRemoved: w.rowsRemoved }; } };
  }
  return { sb, doc, main, refs: sb.UIBase.refs, H: sb.UIBase.host, cas, unscripted, timers,
    frame, advance, settle, watch, clock, pendingFrames: () => frames.queued.length + frames.scrolls.size };
}

module.exports = { world, mk, mkText, makeDocument, matches, readSheet, makeCascade, recorder, UI_ORDER };
