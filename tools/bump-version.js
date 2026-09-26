#!/usr/bin/env node
// tools/bump-version.js
// Bumps the cache-busting version on EVERY app `<script src="...?v=N">` tag in
// index.html to N+1, in one shot. This is the deploy plumbing that makes a normal
// browser refresh pick up new code (GitHub Pages serves the JS with a short cache;
// a new `?v=` URL is what forces the fresh fetch).
//
// WHY THIS EXISTS: the version must be bumped on any deploy that changes app JS,
// but hand-editing every tag is error-prone and easy to forget (a missed bump means
// users silently keep running the old code). This makes it a single command.
//
// THE COUNT IS NOT STATED HERE, AND IT USED TO BE. This said `~22 tags`; the real figure was 47
// when that was measured, and a number in a comment that nothing recomputes goes stale the way
// every prose count in this project has. It also understated the argument for the tool by half.
// Ask the tree:  grep -o '?v=[0-9]*' index.html | wc -l
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

// ── THE END-OF-SESSION CHECKLIST LIVES HERE AND NOWHERE ELSE ────────────────────────────────
// A bump is the one thing a session does deliberately, once, at the end. `START-HERE.md`'s sync
// rules already say the indexes are audited AT THE VERSION BUMP — and nothing said so at the
// moment of the bump, which is the only moment it is actionable. A rule read an hour earlier, in
// a file opened before any work started, is a rule competing with a finished session's wish to
// be finished.
//
// DELIBERATELY NOT REPEATED IN `tests/run-all.js`. The suite runs constantly; the bump happens
// once. The same checklist in both gets skimmed in both, and this project's oldest defect is that
// when everything is emphasised nothing is — it is why 128 shouting headings stopped being read
// and why a state index sat 26 versions stale under a green suite. One loud place beats two
// medium ones.
const owed = [
  "",
  "── BEFORE THIS SESSION IS RETIRED ──────────────────────────────────────────",
  "A bump is the audit point. `START-HERE.md` says the indexes are checked here,",
  "so here is where it is said. Against your CHANGE LIST, not from memory:",
  "",
  "  * RE-HEAD the state index from the tree. Do not append to it. Its headings",
  "    describe THIS package or they describe nothing.",
  "  * `node tools/docs-for.js <every file you changed>` — it names the sections",
  "    that describe each one, so this is a short list and not a re-read.",
  "  * RECORD findings, rulings and decisions in the file that owns each one.",
  "    A ruling that exists only in the conversation is half a package.",
  "  * DRAIN dated material to ARCHIVE.md. Records are free off the reading path",
  "    and cost every future session on it.",
  "  * RE-RUN `node tests/run-all.js` AND `node journal/verify-s9-resolved.js`.",
  "    The second is NOT in the suite and will not run itself.",
  "",
  "ONE BUMP PER PACKAGE, NOT PER PASS. A tagged file that you edited twice is",
  "still one changed file. Bumping per step is a recorded defect here, not a",
  "style opinion: it is how one package reached ?v=321 in eleven bumps, and the",
  "number is spent either way because ?v= may only go up.",
  "",
  "WRONG TO HAVE BUMPED AT ALL if no file carrying a ?v= tag changed. Guards,",
  "tools and docs ship byte-identical JS; the package name carries the tree.",
  "Derive it, do not guess:  grep -o 'src=\"[^\"]*?v=[0-9]*\"' index.html",
  "────────────────────────────────────────────────────────────────────────────",
  "",
];
for (const line of owed) console.log(line);

// A SECOND BUMP IN THE SAME SITTING IS THE ELEVEN-TIMES SHAPE. Reported, never blocked — the
// tool cannot know whether a genuinely separate package is being built, and a tool that refuses a
// legitimate action teaches people to work around it. Saying so is enough; nobody bumped eleven
// times on purpose.
try {
  const stamp = path.join(__dirname, "..", ".last-bump");
  const now = Date.now();
  if (fs.existsSync(stamp)) {
    const prev = JSON.parse(fs.readFileSync(stamp, "utf8"));
    const mins = Math.round((now - prev.at) / 60000);
    if (mins < 240) {
      console.log("NOTE: ?v=" + prev.to + " was set " + mins + " minute(s) ago, in what is probably");
      console.log("      this same session. If so, that earlier bump was the one that should not");
      console.log("      have happened — not this one. Two bumps for one package is the shape");
      console.log("      INVENTORY.md records as reaching eleven. Not blocked; just told.");
      console.log("");
    }
  }
  fs.writeFileSync(stamp, JSON.stringify({ at: now, from: current, to: next }));
} catch (e) { /* the reminder above is the point; a missing stamp must never fail a bump */ }

console.log("Next: commit + push index.html (and the changed files) to deploy.");
