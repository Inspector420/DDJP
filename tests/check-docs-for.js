// tests/check-docs-for.js
// SUBJECT: tools/docs-for.js
// WALL: `docs-for` FINDS A SECTION THAT NAMES A MODULE BY ITS GLOBAL, NOT ONLY BY ITS FILE (J107).
//
// The milestone process runs `node tools/docs-for.js <file>` on every changed file and corrects each section it lists. It
// matched the file's path and bare filename only, and most prose names a module by its global — `EventCache`,
// `Floor.proves`, `StreamManager.trimToFloor` — so those sections never came up, and nobody was told to read them. A tool
// whose list comes back short reads exactly like a tree with less to correct.
//   PART A — on a doc tree of its own: a section naming the file by path is found; one naming only `EventCache.…` is found
//            as the global; for `floor.js`, `` `Floor.proves` `` is found and "the floor moved" is not; and a global that
//            starts with two capitals (`UIBase`, `IDB`) is a global too.
//   PART B — the positive control on the real tree: a section that names `EventCache` and never `eventcache.js` is listed;
//            a guard's one-letter constant (`const C = …`) is not read as a module's global; and a guard's word-like name
//            that only aliases a module it loads (`const Room = C0.Room;`) is not either.
//   PART C — the seam: an engine's `B1StreamManager` brings `StreamManager`, and a section naming only that is listed as such.
// The tool also checks its matcher against fixed lines on every run and stops if they fail; PART A's last row reads that.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const DOCTREE = require("./_docs");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[docs-for] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const APP = path.join(__dirname, "..");
const TOOL = path.join(APP, "tools", "docs-for.js");
const run = (args) => { const r = spawnSync(process.execPath, [TOOL].concat(args), { cwd: APP, encoding: "utf8" }); return { code: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
// The sections the tool listed: "doc:line [how]".
const listed = (out) => [...out.matchAll(/^ {4}(\S+:\d+)\s+\[([^\]]+)\]/gm)].map((m) => ({ at: m[1], how: m[2].replace(/ x\d+$/, "") }));

// ── PART A — a doc tree of its own ───────────────────────────────────────────────────────────
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ddjp-docs-for-"));
try {
  const put = (f, text) => fs.writeFileSync(path.join(TMP, f), text);
  put("a.md", "# By path\n\nThe raw cache lives in `backends/backend1/eventcache.js`.\n");
  put("b.md", "# By global only\n\nAfter a trim, `EventCache.retireBanked` lets the banked raws go.\n");
  put("c.md", "# Prose only\n\nThe floor moved, and nobody said so.\n");
  put("d.md", "# Floor by global\n\nA device trims once `Floor.proves` rebuilds the seed.\n");
  put("e.md", "# Two capitals\n\nA cluster still reaches the shell through `UIBase.host`.\n");
  const ec = run(["--docs", TMP, "backends/backend1/eventcache.js"]), fl = run(["--docs", TMP, "backends/backend1/floor.js"]);
  const E = listed(ec.out), F = listed(fl.out);
  ok(ec.code === 0 && E.some((x) => x.at === "a.md:1" && x.how === "path"),
    "A PREMISE — the tool runs on a doc tree of its own and finds a section naming the file by path", { code: ec.code, listed: E });
  ok(E.some((x) => x.at === "b.md:1" && x.how === "global EventCache"),
    "A: A SECTION NAMING THE MODULE ONLY BY ITS GLOBAL IS FOUND — `EventCache.retireBanked`, never `eventcache.js`", E);
  ok(F.some((x) => x.at === "d.md:1" && x.how === "global Floor") && !F.some((x) => x.at === "c.md:1"),
    "A: a plain-word global is matched as code only — `Floor.proves` is found, \"the floor moved\" is not", F);
  ok(!/INSTRUMENT FAILED/.test(ec.out + fl.out), "A: the tool's own control on its matcher passed", (ec.out + fl.out).slice(0, 300));
  // J107, at the milestone close: the word rule (`[A-Z][a-z0-9]…`) kept a guard's `F` and `C` out, and kept `UIBase` and `IDB`
  // out with them; the guards' names now go by their directory (PART B), so a module's global is any capitalised name.
  const U = listed(run(["--docs", TMP, "ui/base.js"]).out);
  ok(U.some((x) => x.at === "e.md:1" && x.how === "global UIBase"),
    "A: A GLOBAL THAT STARTS WITH TWO CAPITALS IS A GLOBAL — `UIBase.host` lists the section for ui/base.js", U);
} finally {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
}

// ── PART B — the positive control on the real tree ──────────────────────────────────────────
// Derived, not named: the first section of the real doc tree that names `EventCache` as code and never `eventcache.js`.
{
  const root = DOCTREE.docRoots().find((d) => fs.existsSync(path.join(d, "START-HERE.md")));
  let target = null;
  if (root) {
    const walk = (rel) => {
      for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const r = rel ? rel + "/" + e.name : e.name;
        if (target) return;
        if (e.isDirectory()) walk(r);
        else if (e.name.endsWith(".md")) {
          const lines = fs.readFileSync(path.join(root, r), "utf8").split("\n");
          let head = 1, secHasFile = false, secHit = null;
          const close = () => { if (secHit && !secHasFile && !target) target = r + ":" + head; };
          lines.forEach((l, i) => {
            if (/^#{1,6} /.test(l)) { close(); head = i + 1; secHasFile = false; secHit = null; }
            if (/eventcache\.js/.test(l)) secHasFile = true;
            if (/`EventCache[`.(]|(?<![\w$.])EventCache\.[A-Za-z_$]/.test(l)) secHit = secHit || i + 1;
          });
          close();
        }
      }
    };
    walk("");
  }
  ok(!!target, "B PREMISE — the real doc tree has a section naming `EventCache` as code and never `eventcache.js`", { root, target });
  const out = run(["backends/backend1/eventcache.js"]).out;
  ok(!!target && listed(out).some((x) => x.at === target && /^global EventCache/.test(x.how)),
    "B: THE REAL TREE'S SECTION THAT NAMES ONLY THE GLOBAL IS LISTED (" + target + ")", listed(out).slice(0, 8));
}

// ── PART B2 — a guard's one-letter constant is not a module's global ─────────────────────────
// `check-floor-pairing` declares `const C = loadInContext(...)`; prose writing `C.` or `` `C` `` is not about it.
{
  const L = listed(run(["tests/check-floor-pairing.js"]).out);
  ok(!L.some((x) => /^global /.test(x.how)), "B: a guard's one-letter constant (`C`) is not taken for a module's global", L.filter((x) => /^global /.test(x.how)));
  // J107, at the milestone close: `check-who-is-here` declares `const Room = C0.Room;` — a word, and an alias of the module it
  // loads — and docs-for listed some eighty sections about `features/room.js` as describing the guard.
  const src = fs.readFileSync(path.join(APP, "tests", "check-who-is-here.js"), "utf8");
  ok(/^const Room = /m.test(src), "B PREMISE — `check-who-is-here` still declares a word-like alias (`const Room = …`)", "not found");
  const W = listed(run(["tests/check-who-is-here.js"]).out);
  ok(!W.some((x) => /^global /.test(x.how)), "B: a guard's alias of a module it loads (`Room`) is not taken for its own global — prose about `Room.` is about features/room.js",
    W.filter((x) => /^global /.test(x.how)).slice(0, 5));
}

// ── PART C — the seam's name ─────────────────────────────────────────────────────────────────
{
  const out = run(["backends/backend1/streammanager.js"]).out;
  const L = listed(out);
  ok(L.some((x) => /^global StreamManager, via the seam$/.test(x.how)),
    "C: an engine's `B1StreamManager` brings the seam's `StreamManager`, and a section naming only that is listed as such", L.slice(0, 6));
}

if (failed) { console.log("[docs-for] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[docs-for] PASS — `tools/docs-for.js` finds the sections that name a module by its GLOBAL as well as by its file " +
  "(J107; " + asserts + " assertions): on a doc tree of its own, `EventCache.retireBanked` alone lists the section; a plain-word " +
  "global is matched only as code (`Floor.proves` yes, \"the floor moved\" no); on the real tree, a section naming `EventCache` " +
  "and never its file is listed; a global starting with two capitals (`UIBase`) is one too; a guard's names (`C`, and " +
  "`Room` aliasing the module it loads) are not; and an engine's file brings the seam's name (`StreamManager`). THIS GUARD CANNOT TELL YOU A " +
  "LISTED SECTION IS WRONG — the tool bounds the reading, a person does it");
