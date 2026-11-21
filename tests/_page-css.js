// tests/_page-css.js
// THE PAGE'S STYLESHEET, READ AS A BROWSER READS IT — a helper, not a guard (no `check-` prefix, so `run-all` does not run it).
//
// ── WHY THIS IS ONE FUNCTION (found at `ddjp_656`, J131's correction) ─────────────────────────────────────────────────
// index.html's head opens with an HTML comment (the Content-Security-Policy note) that mentions the text `<style>`. Four
// readers matched `<style…>…</style>` across the raw file, so their first block began INSIDE that comment: its text was the
// comment's words, the CSP meta tag and the real `<style>` tag, and a CSS parser reads all of that as the first rule's
// selector. The page's first rule, `* { box-sizing: border-box; }`, was lost, so every box read content-box — and every row
// height read 14 px taller than a browser draws it. The owner saw it: History's and the room queue's rows were 44 px on
// screen while the guards and the Chromium probes measured 58.
//
// ── AND THE FIRST FIX WAS ITSELF A SECOND PARSER THAT DISAGREED (the milestone close after `ddjp_658`) ───────────────────
// It removed every `<!--…-->` across the whole file before looking for `<style>`. A browser does not: inside a `<style>` or a
// `<script>` the text is RAW — `<!--` there is two characters of CSS or JavaScript, not a comment — so a `<!--` written inside a
// style rule (a `content: "<!--"`, say) made that reader delete every real rule up to the next `-->` anywhere in the page.
// So the page is walked as the HTML tokenizer walks it, in one pass: a comment is skipped only where a comment can begin
// (between elements); a tag is read to its closing `>`, quoted attribute values included; and the elements whose text is raw
// — `<style>`, `<script>`, `<title>`, `<textarea>` — are passed over whole, to their own closing tag, `<style>`'s text
// returned. Held by `check-list-look` P (the page's first rule is read; a comment that mentions `<style>` is skipped; a `<!--`
// inside a style rule drops no rule; a `<style>` written inside a script is not a style block) and R (no other reader in
// `tests/` or `tools/` cuts the stylesheet out of index.html on its own).
"use strict";
const RAW = { style: 1, script: 1, title: 1, textarea: 1 };   // elements whose text is not markup, as a browser parses them

function styleBlocks(html) {
  const s = String(html), low = s.toLowerCase(), out = [];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;
    // A comment, where one can begin. An unclosed one runs to the end of the page, as a browser reads it.
    if (s.startsWith("<!--", lt)) {
      const end = s.indexOf("-->", lt + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    const name = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(lt, lt + 64));
    if (!name) { i = lt + 1; continue; }                     // a `<` that starts no tag is text
    // The tag, to its own `>` — a `>` inside a quoted attribute value does not end it.
    let j = lt + 1, q = null;
    for (; j < s.length; j++) {
      const c = s[j];
      if (q) { if (c === q) q = null; }
      else if (c === "\"" || c === "'") q = c;
      else if (c === ">") break;
    }
    const tag = name[1].toLowerCase(), opening = s[lt + 1] !== "/";
    if (opening && RAW[tag]) {
      const close = low.indexOf("</" + tag, j + 1);
      const body = s.slice(j + 1, close < 0 ? s.length : close);
      if (tag === "style") out.push(body);
      if (close < 0) break;
      const gt = s.indexOf(">", close);
      i = gt < 0 ? s.length : gt + 1;
      continue;
    }
    i = j + 1;
  }
  return out;
}
module.exports = { styleBlocks };
