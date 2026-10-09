// tools/probes/mutate-br-botruntime.js
// The bot runtime — break the entry gate, the read-it-back rule, and the no-configuration rule.
//
// SEPARATE FROM `mutate-j17-settings.js` AND `mutate-j17-lattice.js`, WHICH MEASURE A DIFFERENT
// THING. Those two ask what ADDING a key costs, and use an injected vehicle key to ask it. This
// one asks whether the five keys that actually landed are load-bearing. Both questions are live
// and neither answers the other.
//
// EVERY ROW EXPECTS A CHANGE unless it is explicitly marked `expectGreen`. A mutation whose
// expected result is "nothing changes" cannot detect its own failure to apply
// (`09-roadmap.md` §8), so each row breaks something and expects the suite to notice; a row that
// stays GREEN without being marked is a finding about the GUARD, not about the tree.
//
// JOURNALLED. The edit is recorded before it is made and cleared only after the original bytes
// are back, so a run killed mid-flight leaves a recoverable tree rather than a mutated one the
// next reader measures. APPLIED-CHECKED TWICE: once when the edit lands, and again after the
// suite's result has been read — before-only is sufficient when one hand holds the tree and
// worthless when two do. Under collision a green row is VOID, not a survivor.
//
// ROW IDS ARE PER-FILE. `mutate-j15-dm.js` and `mutate-j16-active.js` both have rows in the M1x
// range about other claims; cite these as `mutate-j-botruntime M4`, never as a bare `M4`. The journal
// markers (`BRM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-br-botruntime.js M1 M2 M3
// `BR_SUITE=tests/check-bot-runtime.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS THAT MATTER MOST ────────────────────────────────────────────────────────────────
// M3 is the one this job exists to prevent: the feed narrates events the reducer REFUSED. Nothing
// breaks, the list looks fuller, and the panel names acts nobody performed.
// M7 and M8 are the Done-when correction: collapse the two empties into one and the panel tells
// somebody their history was banked when it never existed, or that nothing has happened in a room
// whose entire history it destroyed. Both are true-of-nothing sentences that read as fact.

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.BR_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.BR_SUITE;

const F = {
  rt: path.join(ROOT, "features/botruntime.js"),
  mb: path.join(ROOT, "backends/backend1/matrixbridge.js"),
  ix: path.join(ROOT, "index.html"),
  ld: path.join(ROOT, "tests/_load.js"),
  rk: path.join(ROOT, "backends/backend1/ranks.js"),
};

const ROWS = [
  // ── THE GATE — THE ROW MOST WORTH A RED ───────────────────────────────────────────────────
  { id: "M1", file: "rt", part: "A",
    why: "THE GATE BECOMES A RANK CHECK — `atLeast(level,\"owner\")` instead of `=== 99`. The " +
         "human owner's tab is admitted, two authorities write a last-write-wins settings blob, " +
         "and the loser's change vanishes with nothing reporting it",
    find: "    if (level === BOT_LEVEL) return { ok: true, reason: null, detail: null, level: level };",
    repl: "    if (level >= BOT_LEVEL) return { ok: true, reason: null, detail: null, level: level };   /*BRM1*/",
    marker: "BRM1", expect: 1 },

  { id: "M2", file: "rt", part: "A",
    why: "an UNREADABLE level collapses into `too-low` — it refuses correctly today for the wrong " +
         "reason, and admits wrongly the day a default changes",
    find: '      return { ok: false, reason: "unreadable", detail: "the power level could not be read from the room" };',
    repl: '      return { ok: false, reason: "too-low", detail: "no level" };   /*BRM2*/',
    marker: "BRM2", expect: 1 },

  { id: "M3", file: "rt", part: "A",
    why: "the human-owner case loses its own reason, so somebody at 100 is told they are too weak " +
         "and goes hunting a permission problem",
    find: '      return { ok: false, reason: "not-the-bot",',
    repl: '      return { ok: false, reason: "too-low",   /*BRM3*/',
    marker: "BRM3", expect: 1 },

  { id: "M4", file: "rt", part: "A",
    why: "a non-numeric level is admitted — a string \"99\" or an object passes the equality that " +
         "no longer type-checks",
    find: '    if (typeof level !== "number" || !isFinite(level)) {',
    repl: "    if (false) {   /*BRM4*/",
    marker: "BRM4", expect: 1 },

  // ── THE BOT LEVEL MUST AGREE WITH THE LADDER, NOT RESTATE IT ──────────────────────────────
  // THE ROW THIS REVISION EXISTS FOR. `botLevel()` used to be `const BOT_LEVEL = 99` and PART A
  // pinned it with `RT.BOT_LEVEL === 99` under a message saying "must be the ladder's top rung" —
  // the message described an agreement and the code checked a literal. Moving the rung and
  // clearing the guard's own literals the way anyone clearing a red would left the run red on a
  // SATURATION CONTROL, sending the reader to `atLeast` and never to the constant.
  //
  // TWO SITES, because one alone proves nothing: restating the level is harmless while the ladder
  // still says 99, and moving the ladder is harmless while the runtime derives. The disagreement
  // is the subject, so the mutation has to create one.
  { id: "M21", file: "rt", part: "A",
    why: "THE BOT LEVEL RESTATES THE LADDER while the ladder MOVES — the runtime admits an account " +
         "at a rung the ladder no longer has, and refuses the one it does. The failure must name " +
         "THE DISAGREEMENT rather than surface as a saturation puzzle two rows later",
    find: "    let ladder = null;\n    try { ladder = Room.rankLadder(); } catch (e) { return null; }",
    repl: "    return 99;   /*BRM21a*/\n    let ladder = null;\n    try { ladder = Room.rankLadder(); } catch (e) { return null; }",
    find2: '    { name: "owner",         level: 99  },',
    repl2: '    { name: "owner",         level: 97  },   /*BRM21*/',
    file2: "rk",
    marker: "BRM21", expect: 1 },

  // ── THE LEVEL MUST BE READ, NEVER CLAIMED ─────────────────────────────────────────────────
  { id: "M5", file: "rt", part: "B",
    why: "THE LEVEL IS TAKEN FROM THE CALLER instead of the transport — the gate checks the " +
         "caller's claim rather than the room's state, which is the one thing this project never " +
         "does. Authority becomes self-asserted",
    find: "    try { level = MatrixBridge.getMyPowerLevel(roomId); }\n    catch (e) { level = null; }",
    repl: "    level = (o.level !== undefined) ? o.level : null;   /*BRM5*/",
    marker: "BRM5", expect: 1 },

  { id: "M6", file: "rt", part: "B",
    why: "a THROWING transport defaults to the bot level instead of refusing — the failure " +
         "direction opens, and a client that cannot read its own level starts anyway",
    find: "    catch (e) { level = null; }",
    repl: "    catch (e) { level = 99; }   /*BRM6*/",
    marker: "BRM6", expect: 1 },

  { id: "M7", file: "rt", part: "B",
    why: "a REFUSED start still subscribes — a runtime that watches while refusing to act, which " +
         "is the worst of both and leaves a listener nobody removes",
    find: "    const gate = eligible(level);\n    if (!gate.ok) {",
    repl: "    const gate = eligible(level);\n    try { MatrixBridge.onRawEvent(() => {}); } catch (e) {}   /*BRM7*/\n    if (!gate.ok) {",
    marker: "BRM7", expect: 1 },

  { id: "M8", file: "mb", part: "B",
    why: "the transport reads a LOCAL guess instead of the server's power-levels state — the seam " +
         "stops being what Matrix says",
    find: '      const pl = room.currentState.getStateEvents("m.room.power_levels", "");\n      if (!pl) return null;',
    repl: "      const pl = null;   /*BRM8*/\n      if (!pl) return 99;",
    marker: "BRM8", expect: 1 },

  // ── NO CONFIGURATION OF ITS OWN ───────────────────────────────────────────────────────────
  { id: "M9", file: "rt", part: "C",
    why: "the runtime grows a LOCAL DEFAULT for a settings key — a second source that wins in the " +
         "code while the room's wins in the docs, and they disagree with nobody noticing",
    find: "  const BOT_LEVEL = 99;",
    repl: "  const BOT_LEVEL = 99;\n  const botAfkMs = 900000;   /*BRM9*/",
    marker: "BRM9", expect: 1 },

  { id: "M10", file: "rt", part: "C",
    why: "the runtime grows a TIMER — which would need a cadence key that does not exist, so it " +
         "would have to invent one",
    find: "    _running = { mode: o.mode || DEFAULT_MODE,",
    repl: "    setInterval(function () {}, 1000);   /*BRM10*/\n    _running = { mode: o.mode || DEFAULT_MODE,",
    marker: "BRM10", expect: 1 },

  { id: "M11", file: "rt", part: "C",
    why: "settings are CAPTURED AT START instead of read fresh, so the bot goes on applying a " +
         "delegation the owner has since revoked",
    find: "    try { settings = StreamManager.getState().settings; } catch (e) { settings = null; }",
    repl: "    settings = _running.cachedSettings || (_running.cachedSettings = StreamManager.getState().settings);   /*BRM11*/",
    marker: "BRM11", expect: 1 },

  { id: "M12", file: "rt", part: "C",
    why: "the runtime publishes reputation snapshots on its own — the gap that has no settings " +
         "key, papered over with a local schedule",
    find: "    if (raw.type === \"ddjp.bot.request\") { _handleRequest(raw); return; }",
    repl: "    if (raw.type === \"ddjp.bot.request\") { _handleRequest(raw); try { Reputation.publish(_running.channels, 99, Reputation.current({})); } catch (e) {} return; }   /*BRM12*/",
    marker: "BRM12", expect: 1 },

  // ── THE POLICY IS NOT RE-DECIDED HERE ─────────────────────────────────────────────────────
  { id: "M13", file: "rt", part: "D",
    why: "the requester's rank comes from the PAYLOAD instead of the channel origin the transport " +
         "stamped — anyone can claim any rank in a field they control",
    find: "    const senderLevel = (typeof raw.senderRank === \"number\") ? raw.senderRank : -1;",
    repl: "    const senderLevel = (raw.content && raw.content.rank) || raw.senderRank || -1;   /*BRM13*/",
    marker: "BRM13", expect: 1 },

  { id: "M14", file: "rt", part: "D",
    why: "STOP does not unsubscribe — the listener outlives bot mode and keeps acting after it " +
         "was turned off",
    find: "    try { MatrixBridge.offRawEvent(_running.handler); } catch (e) {}",
    repl: "    /*BRM14*/",
    marker: "BRM14", expect: 1 },

  { id: "M15", file: "rt", part: "D",
    why: "STARTING TWICE doubles the subscription, so every request is acted on twice",
    find: '    if (_running) return { ok: false, reason: "already-running", detail: "bot mode is already on" };',
    repl: "    /*BRM15*/",
    marker: "BRM15", expect: 1 },

  { id: "M16", file: "rt", part: "D",
    why: "the mode's handled list is ignored, so every event in the room is `seen` and the handler " +
         "stops being cheap about the vast majority of the fan-out",
    find: "    if (_running.mode && MODES[_running.mode].handles.indexOf(raw.type) < 0) return;",
    repl: "    /*BRM16*/",
    marker: "BRM16", expect: 1 },

  // ── THE SEAM ──────────────────────────────────────────────────────────────────────────────
  { id: "M17", file: "rt", part: "E",
    why: "an UNKNOWN MODE silently falls back to the one that exists, so a typo looks like a " +
         "working second mode",
    find: '    if (!mode) return { ok: false, reason: "no-such-mode", detail: "unknown mode " + o.mode };',
    repl: "    /*BRM17*/",
    marker: "BRM17", expect: 1 },

  { id: "M18", file: "rt", part: "E",
    why: "a SECOND MODE is pre-built for a room type that does not exist — the dead branch " +
         "backend-selection.md forbids",
    find: "  const DEFAULT_MODE = \"consensus\";",
    repl: "  MODES.centralized = { why: 'the bot-run room', handles: [] };   /*BRM18*/\n  const DEFAULT_MODE = \"consensus\";",
    marker: "BRM18", expect: 1 },

  // ── REGISTRATION — the v276/v277 shape ────────────────────────────────────────────────────
  { id: "M19", file: "ix", part: "F",
    why: "the module loses its <script> tag — driven in every sandbox, undefined in the browser",
    find: '<script src="features/botruntime.js?v=264"></script>',
    repl: "<!--BRM19-->",
    marker: "BRM19", expect: 1 },

  { id: "M20", file: "ld", part: "F",
    why: "the module loses its KNOWN_GLOBALS entry — a confusing TypeError far from its cause",
    find: '  "BotSettings", "Reputation", "BotRuntime",',
    repl: '  "BotSettings", "Reputation",   /*BRM20*/',
    marker: "BRM20", expect: 1 },
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    // ── THE VERDICT IS THE EXIT CODE PLUS THE ABSENCE OF A FAILURE LINE ───────────────────────
    // `/PASS/.test(out)` alone is a TEXT MATCH, and it was true of output that also contained
    // `FAIL` — which is exactly what happened when a guard's failure gate sat above one of its
    // parts: the guard printed a FAIL line, exited 0, and three mutation rows read GREEN against a
    // tree whose fold they had deleted. `execFileSync` already throws on a non-zero exit, so
    // reaching this line means exit 0; the added test is that nothing announced a failure anyway.
    // A verdict that can be satisfied by a substring is not a verdict.
    const announcedFailure = /^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE)/m.test(out);
    return { green: !announcedFailure && (/All guards passed/.test(out) || /PASS/.test(out)), out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function firstFail(out) {
  const m = (out || "").match(/^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE) .*/m);
  return m ? m[0].slice(0, 180) : "(no FAIL line — check the output)";
}

function main() {
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[mutate-br] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-br] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-br] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-br] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j-botruntime:" + row.id, file);
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-br-botruntime:" + row.id + ":2", F[row.file2]);
        applied += h2.apply(row.find2, row.repl2, row.expect);
      } else if (row.find2) applied += h.apply(row.find2, row.repl2, row.expect);
    } catch (e) {
      h.restore(); if (h2) h2.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore(); if (h2) h2.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read.
    const still = h.stillApplied(row.marker);
    h.restore(); if (h2) h2.restore();

    if (!still) {
      console.log(row.id + "  VOID  — the mutation was gone by the time the result was read " +
        "(somebody else wrote to the tree); a green here would be a claim about a tree that " +
        "never held it");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    let verdict = r.green ? "GREEN" : "RED";
    if (row.expectGreen) verdict = r.green ? "DOMINATED" : "RED (redundancy ENDED — read it)";
    console.log(row.id + "  " + verdict + " [" + applied + " site, targets PART " + row.part + "] " +
      row.why + (/^RED/.test(verdict) ? "\n        -> " + firstFail(r.out) : ""));
    results.push({ id: row.id, verdict, part: row.part });
  }

  const red = results.filter((r) => /^RED/.test(r.verdict)).length;
  const green = results.filter((r) => r.verdict === "GREEN").length;
  const dom = results.filter((r) => r.verdict === "DOMINATED").length;
  const voidd = results.filter((r) => r.verdict === "VOID").length;
  console.log("\n[mutate-br] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
