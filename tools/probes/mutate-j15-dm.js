// tools/probes/mutate-j15-dm.js
// J15 — break each thing `check-dm-panel` claims to pin, and watch it go red.
//
// EVERY ROW EXPECTS A CHANGE. A mutation whose expected result is "nothing changes" cannot detect
// its own failure to apply (`09-roadmap.md` §8), so each row here breaks something and expects the
// suite to notice; a row that stays GREEN is a finding about the guard, not about the tree.
//
// JOURNALLED. The edit is recorded before it is made and cleared only after the original bytes are
// back, so a run killed mid-flight leaves a recoverable tree rather than a mutated one the next
// reader measures. APPLIED-CHECKED TWICE: once when the edit lands, and again after the suite's
// result has been read — before-only is sufficient when one hand holds the tree and worthless when
// two do.
//
// ROW IDS ARE PER-FILE AND TWO FILES COLLIDE. `mutate-j16-active.js` also has an M15, and it is a
// different row about a different claim: THIS file's M15 is the RED `closeOnRun` row; that file's
// is the `expectGreen` setter-clamp row in its keep-one lattice. That file has no M14; this one's
// M14 is `load()`'s DM cap. Always qualify by file when citing one elsewhere — `mutate-j15-dm M15`,
// never a bare `M15`. The journal MARKERS already disambiguate (`J15M15` vs `J16M15`), so a
// mis-citation cannot apply the wrong edit; what it can do is send a reader to the wrong probe.
//
// ROW-SELECTABLE, because the full suite is ~35s per row and a batch has to fit a time budget:
//   node tools/probes/mutate-j15-dm.js M1 M2 M3
// `J15_SUITE=tests/check-dm-panel.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.J15_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J15_SUITE;

const F = {
  mb: path.join(ROOT, "backends/backend1/matrixbridge.js"),
  cp: path.join(ROOT, "core/chatprefs.js"),
  ui: path.join(ROOT, "ui/interface.js"),
  ac: path.join(ROOT, "features/actions.js"),
};

// Each row: which file, the anchor, the replacement, a marker proving it is still applied, and
// the PART it targets. `expect` is the occurrence count the anchor must match — `apply` refuses a
// replacement matching nothing or matching more often than stated.
const ROWS = [
  { id: "M1", file: "mb", part: "A/B",
    why: "the second ingest door drops its origin gate — the tree as received",
    find: 'if (!_isChatChannel(room) && inScope(room.roomId)) {',
    repl: 'if (!_isChatChannel(room)) {   /*J15M1*/',
    marker: "J15M1", expect: 1 },

  { id: "M2", file: "mb", part: "C",
    why: "the DM scope is bound into the ROOM scope instead of beside it",
    find: '  function inDMScope(roomId) {\n    return !!(_dmScope && roomId && _dmScope[roomId]);',
    repl: '  function inDMScope(roomId) {   /*J15M2*/\n    return !!((_dmScope && roomId && _dmScope[roomId]) || (_activeScope && roomId && _activeScope[roomId]));',
    marker: "J15M2", expect: 1 },

  { id: "M3", file: "mb", part: "C",
    why: "setDMScope MERGES rather than replaces",
    find: '    _dmScope = n ? s : null;   // REPLACES, never merges',
    repl: '    if (_dmScope) { for (const k in _dmScope) s[k] = 1; }   /*J15M3*/\n    _dmScope = n ? s : null;',
    marker: "J15M3", expect: 1 },

  { id: "M4", file: "mb", part: "C",
    why: "a room change unbinds the conversations too",
    find: '  function clearRoomScope() { _activeScope = null; }',
    repl: '  function clearRoomScope() { _activeScope = null; _dmScope = null; /*J15M4*/ }',
    marker: "J15M4", expect: 1 },

  { id: "M5", file: "cp", part: "D",
    why: "the conversation index keeps whatever keys it is handed — where a preview would live",
    find: '      .map((r) => ({ roomId: String(r.roomId), userId: String(r.userId || ""),\n                     lastTs: Number(r.lastTs) || 0, readTs: Number(r.readTs) || 0 }))',
    repl: '      .map((r) => Object.assign({}, r, { roomId: String(r.roomId) }))   /*J15M5*/',
    marker: "J15M5", expect: 1 },

  { id: "M6", file: "cp", part: "D",
    why: "the index is unbounded in the synchronous localStorage tier",
    find: '    return out.slice(0, max);',
    repl: '    return out;   /*J15M6*/',
    marker: "J15M6", expect: 1 },

  { id: "M7", file: "cp", part: "D",
    why: "the read marker follows a late older message backwards",
    find: '    row.readTs = Math.max(row.readTs, Number(ts) || 0, row.lastTs);',
    repl: '    row.readTs = Number(ts) || 0;   /*J15M7*/',
    marker: "J15M7", expect: 1 },

  { id: "M8", file: "ui", part: "E",
    why: "the panel decides unread for itself instead of reading the feature's flag",
    find: '      const row = el("div", { class: "dm-row" + (r.unread ? " unread" : "") }, [',
    repl: '      const row = el("div", { class: "dm-row" }, [   /*J15M8*/',
    marker: "J15M8", expect: 1 },

  { id: "M9", file: "ui", part: "E",
    why: "the badge renders a zero rather than nothing",
    find: '    refs.tabDM.textContent = n > 0 ? ("DMs " + (n > 9 ? "9+" : n)) : "DMs";',
    repl: '    refs.tabDM.textContent = "DMs " + n;   /*J15M9*/',
    marker: "J15M9", expect: 1 },

  { id: "M10", file: "ui", part: "E",
    why: "the view opens a conversation without asking the feature",
    find: '    let res = { ok: false };\n    try { res = Chat.openDMRoom(roomId) || { ok: false }; } catch (e) { res = { ok: false }; }\n    if (!res.ok) { renderDMPanel(); return; }',
    repl: '    let res = { ok: true };   /*J15M10*/',
    marker: "J15M10", expect: 1 },

  { id: "M11", file: "ui", part: "E",
    why: "a late decryption failure clobbers text already rendered",
    find: '      if (out[at].failed && !msg.failed) out[at] = msg;',
    repl: '      out[at] = msg;   /*J15M11*/',
    marker: "J15M11", expect: 1 },

  { id: "M12", file: "ac", part: "F",
    why: "Actions.ACTIONS becomes a FILTERED export — the exact drift J14's handoff flagged",
    find: '  return { describe: describe, perform: perform, ACTIONS: Object.keys(CATALOG) };',
    repl: '  return { describe: describe, perform: perform, ACTIONS: Object.keys(CATALOG).filter((k) => k.indexOf("chat.") !== 0) };   /*J15M12*/',
    marker: "J15M12", expect: 1 },
  // The OTHER direction of PART F's both-ways loop. M12 is a FILTERED export (a name missing);
  // this is a STALE one (a name present that the adapter cannot resolve). J14's handoff named
  // both — "filtered or cached" — and a single row would have pinned only half of it.
  { id: "M13", file: "ac", part: "F",
    why: "Actions.ACTIONS becomes a STALE literal list rather than the live vocabulary",
    find: '  return { describe: describe, perform: perform, ACTIONS: Object.keys(CATALOG) };',
    repl: '  return { describe: describe, perform: perform, ACTIONS: Object.keys(CATALOG).concat(["chat.dm.v2"]) };   /*J15M13*/',
    marker: "J15M13", expect: 1 },

  // ── M14 AND M15 — TWO CLAIMS J15 SHIPPED AND NOTHING WAS PINNING ───────────────────────────
  // Both were green on deletion at v262, in a tree whose suite had grown to 126. Separate rows and
  // separate diffs, because they are separate claims about separate files and a combined row could
  // not say which one the red belonged to.
  //
  // M14 — `load()`'s cap. THE TWO CAP SITES IN `chatprefs.js` BOUND DIFFERENT ROUTES AND NEITHER
  // DOMINATES THE OTHER, which is why both need a row: `dmFold`'s cap bounds what THIS build
  // writes (drop it and 50 rows plus 20 touches persists 70 — M6), while `load()`'s bounds a blob
  // this build did NOT write, from an older build or a hand-edited localStorage. Every fixture in
  // `check-dm-panel` handed the loader an under-cap blob, so the second site was unreached and its
  // deletion invisible. Note the direction that makes it a storage fault rather than a display
  // one: an uncapped READ becomes an uncapped WRITE at the very next `dmMarkRead`.
  { id: "M14", file: "cp", part: "D",
    why: "load()'s cap is dropped — a 500-row stored index loads whole and the next write persists " +
         "all 500 back into the synchronous localStorage tier",
    find: "      .slice(0, DM_CAP);",
    repl: "      .slice(0);   /*J15M14*/",
    marker: "J15M14", expect: 1 },

  // M15 — `closeOnRun`'s early return. Not cosmetic: `Chat.openDM` RESOLVES `{ok:false,
  // reason:"self"}` for a self-DM rather than rejecting, so without the return that value falls
  // into a verdict branch whose wording is about a ROOM SET, and the card tells a person who DMed
  // themselves "Not finished: 0 of 0 channels done". A sentence naming an action nobody took
  // (`roles.md` §10's second signature), reachable by one click.
  { id: "M15", file: "ui", part: "E",
    why: "the closeOnRun early return is dropped — a self-DM reaches the room-set verdict branch " +
         "and the card prints 'Not finished: 0 of 0 channels done'",
    find: "        if (spec.closeOnRun) { _closeUserCard(); return; }",
    repl: "        if (spec.closeOnRun) { _closeUserCard(); }   /*J15M15*/",
    marker: "J15M15", expect: 1 },
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 300000 });
    return { green: /All guards passed/.test(out) || /PASS/.test(out), out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function firstFail(out) {
  const m = (out || "").match(/^\[[a-z0-9-]+\] FAIL — .*/m);
  return m ? m[0].slice(0, 160) : "(no FAIL line — check the output)";
}

function main() {
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[mutate-j15] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j15] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  const want = process.argv.slice(2).filter((a) => /^M\d+$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j15] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j15] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j15-dm:" + row.id, file);
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
    } catch (e) {
      h.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read. Under collision
    // a green row is VOID rather than a survivor.
    const still = h.stillApplied(row.marker);
    h.restore();

    if (!still) {
      console.log(row.id + "  VOID  — the mutation was gone by the time the result was read " +
        "(somebody else wrote to the tree); a green here would be a claim about a tree that " +
        "never held it");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const verdict = r.green ? "GREEN" : "RED";
    console.log(row.id + "  " + verdict + (verdict === "RED" ? "   " : " ") +
      " [" + applied + " site, targets PART " + row.part + "] " + row.why +
      (verdict === "RED" ? "\n        -> " + firstFail(r.out) : ""));
    results.push({ id: row.id, verdict, part: row.part });
  }

  const red = results.filter((r) => r.verdict === "RED").length;
  const green = results.filter((r) => r.verdict === "GREEN").length;
  const voidd = results.filter((r) => r.verdict === "VOID").length;
  console.log("\n[mutate-j15] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
