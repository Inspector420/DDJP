// tests/check-version-banner.js
// SUBJECT: app.js, index.html, ui/panels.js
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
//
// (d) THE COPY NAMES THE BUILD, FIRST (the owner, `ddjp_643`): the live log keeps only its newest lines, so the banner
// falls off, and a pasted log could not say which build it came from. "Copy log" (`Panels._logText`) begins with a line
// naming it — read by the banner's own function, off a page's `?v=` tags — and the moment it was copied. Driven: the real
// `_runningVersion` and the real `_logText`, over a page whose tags say v777, and over one with none.

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

// ── (d) "Copy log" starts with the build and the moment (the owner, `ddjp_643`) ──────────────────────────────────────
{
  const panels = fs.readFileSync(path.join(__dirname, "..", "ui", "panels.js"), "utf8");
  // A function's whole text, from its declaration to its closing brace.
  const fnOf = (text, name) => {
    const at = text.indexOf("function " + name + "(");
    if (at < 0) return null;
    let d = 0;
    for (let j = text.indexOf("{", at); j < text.length; j++) {
      if (text[j] === "{") d++;
      else if (text[j] === "}") { d--; if (d === 0) return text.slice(at, j + 1); }
    }
    return null;
  };
  const rv = fnOf(app, "_runningVersion"), lt = fnOf(panels, "_logText"), fs2 = fnOf(panels, "_logFullStamp");
  const helpers = ["_logBuild"].map((n) => fnOf(panels, n)).filter(Boolean).join("\n");
  ok(!!rv && !!lt && !!fs2, "d: APPLIED — `_runningVersion` (app.js) and `_logText` (ui/panels.js) must be findable", { rv: !!rv, lt: !!lt });
  // The page as the browser holds it: a classic script's top-level function is the window's, and the tags are the page's.
  const run = (tags) => {
    const document = { querySelectorAll: () => tags.map((src) => ({ src: src, href: "" })) };
    const window = {};
    const make = new Function("document", "window", "_priorLog", "_sessionLog", "_sessionStart",
      rv + "\nwindow._runningVersion = _runningVersion;\n" + fs2 + "\n" + helpers + "\n" + lt + "\nreturn _logText();");
    return make(document, window, ["[info] 09:00:00.000 Room: yesterday"], ["[info] 22:00:00.000 Room: today"], 0);
  };
  const text = run(["core/logger.js?v=777", "ui/panels.js?v=777"]);
  const first = String(text).split("\n")[0];
  ok(/^=== DDJP v777\b/.test(first),
    "d: \"COPY LOG\" STARTS WITH THE BUILD — its first line names the version, read off the page's own tags by the banner's " +
    "function (the owner, ddjp_643)", first);
  ok(/copied /.test(first), "d: and the moment it was copied", first);
  ok(String(text).split("\n").filter((l) => /DDJP v777/.test(l)).length === 1, "d: once, at the top", text);
  const none = String(run([])).split("\n")[0];
  ok(/^=== DDJP v\? /.test(none), "d: a page with no tags says so (v?), never a guess", none);
  ok(!/["']v?\d{3}["']/.test(lt + helpers), "d: and no version is written in the copy's code", (lt + helpers).match(/["']v?\d{3}["']/));
}

console.log("[version-banner] PASS — every session logs the build it is running, ahead of the boot " +
  "work so the lines that follow are labelled; the number is read from the document's own `?v=` " +
  "cache-bust tags rather than restated as a literal that bump-version.js would not maintain, an " +
  "unknown version is stated rather than guessed, and index.html is checked to actually carry " +
  "those tags at one consistent value; and \"Copy log\" starts with that build and the moment it was copied (ddjp_643) — because a stale tab serving cached JS produces exactly " +
  "the log a consensus fault produces, and nothing else distinguishes them (" + checks + " assertions)");
