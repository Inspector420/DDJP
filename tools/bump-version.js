#!/usr/bin/env node
// tools/bump-version.js
// Bumps the cache-busting version on EVERY app `<script src="...?v=N">` tag in
// index.html to N+1, in one shot. This is the deploy plumbing that makes a normal
// browser refresh pick up new code (GitHub Pages serves the JS with a short cache;
// a new `?v=` URL is what forces the fresh fetch).
//
// WHY THIS EXISTS: the version must be bumped on any deploy that changes app JS,
// but hand-editing ~22 tags is error-prone and easy to forget (a missed bump means
// users silently keep running the old code). This makes it a single command.
//
// USAGE:  node tools/bump-version.js        (or: npm run bump)
//
// FOR A SESSION/ASSISTANT: you own this. Run it as the last step of ANY code change,
// then hand back the modified index.html alongside the changed files. Do NOT ask the
// operator to manage version numbers — that is the whole point of this script.
//
// It is a dev tool: NOT loaded by the app, so it never needs versioning itself and
// cannot affect the running app.

const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "index.html");

let html;
try {
  html = fs.readFileSync(file, "utf8");
} catch (e) {
  console.error("bump-version: cannot read " + file + " — " + e.message);
  process.exit(1);
}

const matches = html.match(/\?v=\d+/g) || [];
if (!matches.length) {
  console.error("bump-version: no `?v=N` tags found in index.html — nothing to bump.");
  process.exit(1);
}

const current = Math.max.apply(null, matches.map((m) => parseInt(m.slice(3), 10)));
const next = current + 1;

// Single global version: set every tag to the same next number (covers the case
// where a prior partial edit left tags out of sync).
const bumped = html.replace(/\?v=\d+/g, "?v=" + next);
fs.writeFileSync(file, bumped);

console.log(
  "bump-version: " + matches.length + " tag(s) bumped " +
  "?v=" + current + " -> ?v=" + next + " in index.html"
);
console.log("Next: commit + push index.html (and the changed files) to deploy.");
