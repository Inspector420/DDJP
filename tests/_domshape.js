// tests/_domshape.js
// A NODE'S CHILDREN AS THE DOM HAS THEM — ONE DEFINITION, for every DOM double here (a harness, not a guard: no `check-`
// prefix, so `run-all` does not run it).
//
// WHY IT EXISTS. At `ddjp_651` the user card read a select's `children` with `.map`; the card harness answered
// `children` with an Array, so every guard passed, and in the browser `children` is an HTMLCollection, which has no
// `.map`: the card never opened (the owner's report at `ddjp_652`). `ddjp_653` gave the card harness this shape behind
// `domShaped`; J130 (`ddjp_654`) moved it here so the main screen's harness (`tests/_screen-world.js`) builds the SAME
// shape for the queue pane rather than a second copy of it.
//
//   collectionOf(src)  — `children`: an HTMLCollection. Live (read from `src` at every access: an array, or a function
//                        answering one), indexed, iterable, with `length` and `item()`, and NO array methods.
//   nodeListOf(src)    — `childNodes` and `querySelectorAll`'s answer: a NodeList. The same, plus `forEach`, `entries`,
//                        `keys` and `values` — which a NodeList has and an HTMLCollection does not — and still no `.map`.
// Anything else asked of either answers `undefined`, so a call of an array method throws "is not a function" here as it
// does in Chromium.
//
// AND A SELECT AS THE DOM HAS IT (`ddjp_666`, J129's correction). A double whose select keeps `value` as a plain property,
// apart from its options' `selected`, cannot show a box that goes on showing a rank nobody got: there, a pick moved the
// value and left the drawn option selected, and a "pick" that fired `onchange` whatever the value did called the change
// again where Chromium fires nothing. So, from the HTML standard's select:
//   selectLike(optionsOf)  — `value` and `selectedIndex` for a select whose options `optionsOf()` answers in tree order:
//                            `value` reads the first selected option's value ("" if none); setting it selects the first
//                            option with that value and fires nothing. `settle(inserted)` is the selectedness rule a
//                            single select keeps: one selected at most — an option made selected, or inserted selected,
//                            deselects the rest — and with none selected, the first option not disabled is.
//   pickOption(sel, value) — what a PERSON can do: nothing on a disabled select or a disabled or missing option; picking
//                            the option already chosen fires nothing; otherwise it is chosen and `onchange` fires. Answers
//                            whether a change fired.
// An option's value is its `value` (the app's `el` sets it as a property), else its text; it is disabled by its `disabled`
// property or attribute.
"use strict";
function shaped(src, extra) {
  const read = () => (typeof src === "function" ? src() : src);
  return new Proxy({}, {
    get(t, k) {
      const a = read();
      if (k === "length") return a.length;
      if (k === "item") return (i) => a[i] || null;
      if (k === Symbol.iterator) return () => a[Symbol.iterator]();
      if (typeof k === "string" && /^\d+$/.test(k)) return a[k];
      if (extra && Object.prototype.hasOwnProperty.call(extra, k)) return extra[k](a);
      return undefined;
    },
    has(t, k) { const a = read(); return k === "length" || (typeof k === "string" && /^\d+$/.test(k) && Number(k) < a.length); },
  });
}
function collectionOf(src) { return shaped(src, null); }
const LIST_EXTRA = {
  forEach: (a) => (fn, self) => { a.slice().forEach((x, i) => fn.call(self, x, i)); },
  entries: (a) => () => a.slice().entries(),
  keys: (a) => () => a.slice().keys(),
  values: (a) => () => a.slice().values(),
};
function nodeListOf(src) { return shaped(src, LIST_EXTRA); }
const optValue = (o) => (o.value !== undefined && o.value !== null ? String(o.value) : String(o.text || ""));
const optDisabled = (o) => !!(o.disabled || (o.attrs && o.attrs.disabled));
function selectLike(optionsOf) {
  const opts = () => (optionsOf() || []).filter((o) => o && typeof o === "object" && o.tag === "option");
  return {
    get value() { const o = opts().find((x) => x._selected); return o ? optValue(o) : ""; },
    set value(v) { let done = false; for (const o of opts()) { o._selected = !done && optValue(o) === String(v); if (o._selected) done = true; } },
    get selectedIndex() { return opts().findIndex((x) => x._selected); },
    set selectedIndex(i) { opts().forEach((o, k) => { o._selected = k === i; }); },
    settle(inserted) {
      const os = opts();
      if (inserted && inserted._selected) for (const o of os) if (o !== inserted) o._selected = false;
      const on = os.filter((o) => o._selected);
      for (const o of on.slice(0, -1)) o._selected = false;
      if (!on.length) { const f = os.find((o) => !optDisabled(o)); if (f) f._selected = true; }
    },
  };
}
function pickOption(sel, value) {
  if (!sel || sel.disabled) return false;
  const o = Array.from(sel.children || []).find((x) => x && x.tag === "option" && optValue(x) === String(value));
  if (!o || optDisabled(o) || o._selected) return false;
  sel.value = String(value);
  if (typeof sel.onchange === "function") sel.onchange({ type: "change", target: sel });
  return true;
}
module.exports = { collectionOf, nodeListOf, selectLike, pickOption };
