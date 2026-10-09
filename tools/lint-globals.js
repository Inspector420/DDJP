// tools/lint-globals.js
// The app's globals, DERIVED from `tests/_load.js`'s KNOWN_GLOBALS rather than restated.
//
// Every module in this app is a script-tag global — `Ranks`, `StreamManager`, `Room` and so on —
// so a linter with no globals declared reports 1649 `no-undef` findings that are all the same
// non-fact. A second hand-written list here would be a copy of a list this tree already maintains
// and already guards (`check-reputation` PART F fails if a feature module is missing from it), and
// the two would drift the first time a module was added. Read from the source instead.
const fs = require("fs");
const path = require("path");

function knownGlobals() {
  const src = fs.readFileSync(path.join(__dirname, "..", "tests", "_load.js"), "utf8");
  const at = src.indexOf("const KNOWN_GLOBALS = [");
  if (at < 0) throw new Error("lint-globals: KNOWN_GLOBALS not found in tests/_load.js");
  const end = src.indexOf("];", at);
  return [...src.slice(at, end).matchAll(/"([A-Za-z_]\w*)"/g)].map((m) => m[1]);
}
module.exports = { knownGlobals };
