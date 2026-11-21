#!/usr/bin/env node
// journal/entry-list.js — THE VERIFICATION STEP FOR ANY §6 EDIT.
// Prints one line per job-entry start: id, shape, Kind tokens, done. Diff before and after a pass;
// a deletion shows as a missing line. Comparable across an edit only because check-roadmap-gate
// now refuses duplicate ids (J50) — a count that silently collapses duplicates cannot be compared.
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const end = src.indexOf("\n## 7. Decisions already made");
const RE = /^(?:#### (J\d+)\b|\*\*(J\d+) — )/gm;
const out = []; let m;
while ((m = RE.exec(src)) !== null) {
  if (end > 0 && m.index > end) continue;
  const id = m[1] || m[2];
  const nx = RE.lastIndex;
  const to = (() => { RE.lastIndex = nx; const n = RE.exec(src); RE.lastIndex = nx; return n && n.index < end ? n.index : end; })();
  const body = src.slice(m.index, to > 0 ? to : end);
  const done = /^(?:#### |\*\*)J\d+ —[^\n]*\b(?:DONE|done)\b/.test(body) ? "DONE" : "open";
  const k = body.indexOf("**Kind.**");
  let tok = "NO-KIND";
  if (k >= 0) { const rest = body.slice(k + 9); const para = rest.indexOf("\n\n") < 0 ? rest : rest.slice(0, rest.indexOf("\n\n"));
    const st = para.search(/\.(?:\s|$)/); const decl = st >= 0 ? para.slice(0, st) : para;
    tok = (decl.match(/`([a-z-]+)`/g) || []).map((t) => t.replace(/`/g, "")).join("+") || "EMPTY-KIND"; }
  out.push([id, m[1] ? "heading" : "prose", tok, done].join("\t"));
}
console.log(out.join("\n"));
