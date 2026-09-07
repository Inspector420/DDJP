// tests/check-version-banner.js
//
// EVERY SESSION SAYS WHICH BUILD IT IS, AND SAYS IT FIRST.
//
// A log that does not name its own version cannot be read. Two clients running different builds
// produce exactly the log a consensus fault produces — different state from the same events — and
// telling those apart from the outside is impossible. That cost a full session's diagnosis, three
// times over, on a room where one window was serving cached JS.
//
// TWO PROPERTIES, AND THE SECOND IS THE ONE THAT DECAYS:
//   · the banner is logged at boot, ahead of the work
//   · the number is READ from the document's own `?v=` tags, never written as a literal
//
// A literal would be a second copy of the version, and `tools/bump-version.js` would not touch it.
// It would be correct on the day it was written and silently wrong from the next bump onward —
// which is worse than no banner at all, because a wrong version in a log is trusted. Restated
// constants are a shape this codebase has had to delete before (`08` §Legacy, the dead `visPct`
// dial, the per-room hashref flag).

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// ── (a) the banner is logged, at boot ────────────────────────────────────────────────────────
{
  ok(/Logger\.info\("DDJP " \+ _runningVersion\(\)/.test(app),
    "a: boot must log the running version");

  const banner = app.indexOf('Logger.info("DDJP "');
  const firstWork = app.indexOf("Store.durability.lockIn");
  ok(banner > 0 && firstWork > 0,
    "a: APPLIED — both the banner and the first boot work must be findable",
    { banner: banner, firstWork: firstWork });
  ok(banner < firstWork,
    "a: and it must come BEFORE the boot work — a banner printed after the interesting lines " +
    "does not label them",
    { banner: banner, firstWork: firstWork });
}

// ── (b) the number is read, not restated ─────────────────────────────────────────────────────
{
  const fn = app.slice(app.indexOf("function _runningVersion()"),
                       app.indexOf("function _runningVersion()") + 600);
  ok(fn.length > 50, "b: APPLIED — the version helper must be findable");

  ok(/\?v=/.test(fn) && /match\(/.test(fn),
    "b: the version must be READ off the document's own cache-bust tags");

  // A literal anywhere in the helper is the failure: bump-version.js would not update it, so it
  // would be right once and wrong forever after, in a line people trust.
  ok(!/["']v?\d{3}["']/.test(fn),
    "b: and never written as a literal — bump-version.js owns the number, and a second copy " +
    "drifts at the next bump",
    fn.match(/["']v?\d{3}["']/));

  ok(/return "v\?"|return 'v\?'/.test(fn),
    "b: an unknown version must be STATED, not guessed at or defaulted to something plausible");
}

// ── (c) the source it reads actually exists in the document ──────────────────────────────────
// If index.html ever stopped carrying `?v=` tags, the helper would silently report "v?" forever
// and this guard would still pass on (b) alone.
{
  const tags = html.match(/\?v=(\d+)/g) || [];
  ok(tags.length > 0,
    "c: APPLIED — index.html must actually carry the `?v=` tags the helper reads, or the banner " +
    "reports 'v?' for the rest of time",
    tags.length);

  const distinct = Array.from(new Set(tags));
  ok(distinct.length === 1,
    "c: and every tag must carry the SAME version — a half-bumped document serves a mix of old " +
    "and new files, which is the exact fault the banner exists to make visible",
    distinct);
}

console.log("[version-banner] PASS — every session logs the build it is running, ahead of the boot " +
  "work so the lines that follow are labelled; the number is read from the document's own `?v=` " +
  "cache-bust tags rather than restated as a literal that bump-version.js would not maintain, an " +
  "unknown version is stated rather than guessed, and index.html is checked to actually carry " +
  "those tags at one consistent value — because a stale tab serving cached JS produces exactly " +
  "the log a consensus fault produces, and nothing else distinguishes them (" + checks + " assertions)");
