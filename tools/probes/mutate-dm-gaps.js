// tools/probes/mutate-dm-gaps.js
// The four DM gaps — break each one separately: invites, the backfill limit, the id input, reuse.
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
// markers (`DMM4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-dm-gaps.js M1 M2 M3
// `DM_SUITE=tests/check-dm-gaps.js` narrows the runner for ATTRIBUTION ONLY — a green row
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
const SUITE = process.env.DM_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.DM_SUITE;

const F = {
  ch: path.join(ROOT, "features/chat.js"),
  ui: path.join(ROOT, "ui/interface.js"),
};

const ROWS = [
  // ── GAP 1: invites ────────────────────────────────────────────────────────────────────────
  { id: "M1", file: "ch", part: "A",
    why: "AN INVITE IS AUTO-BOUND AT INIT — anyone can put a room into this account's DM scope by " +
         "inviting it, and scope is the only thing the receive filter tests",
    find: "    try { MatrixBridge.setDMScope(ids); } catch (e) {}",
    repl: "    try { MatrixBridge.setDMScope(ids.concat((MatrixBridge.dmInviteRoomIds()||[]).map(function(i){return i.roomId;}))); } catch (e) {}   /*DMM1*/",
    marker: "DMM1", expect: 1 },

  { id: "M2", file: "ch", part: "A",
    why: "accepting no longer binds, so an accepted conversation still receives nothing",
    // ANCHORED ON THE ACCEPT PATH, because the bind line is byte-identical to `openDMRoom`'s —
    // the unqualified anchor matched twice and the probe REFUSED rather than mutating whichever
    // came first. That refusal is the guard rail, not a survivor: until this row goes RED,
    // accepting-binds is code with no net under it.
    find: "    // BOUND ONLY NOW, and through the same seam as every other conversation.\n    try { MatrixBridge.addDMScope(roomId); } catch (e) {}",
    repl: "    /*DMM2*/",
    marker: "DMM2", expect: 1 },

  { id: "M3", file: "ch", part: "A",
    why: "DECLINING binds, so refusing a stranger grants them the channel refusing was meant to deny",
    find: "    // NOT added to scope, and nothing to remove — declining leaves the room and the filter never",
    repl: "    try { MatrixBridge.addDMScope(roomId); } catch (e) {}   /*DMM3*/\n    // NOT added to scope, and nothing to remove — declining leaves the room and the filter never",
    marker: "DMM3", expect: 1 },

  { id: "M4", file: "ch", part: "A",
    why: "an unreadable invite list THROWS instead of reporting none, so the DM panel cannot render",
    find: "    try { return MatrixBridge.dmInviteRoomIds() || []; } catch (e) { return []; }",
    repl: "    return MatrixBridge.dmInviteRoomIds() || [];   /*DMM4*/",
    marker: "DMM4", expect: 1 },

  // ── GAP 2: the backfill limit ─────────────────────────────────────────────────────────────
  { id: "M5", file: "ui", part: "B",
    why: "the one-shot limit stops being stated, so a conversation looks complete when it is a " +
         "window onto its own end",
    find: '        text: "Showing the most recent " + _dmBackfilled + " messages. Earlier ones are not loaded." }));',
    repl: '        text: "" }));   /*DMM5*/',
    marker: "DMM5", expect: 1 },

  { id: "M6", file: "ui", part: "B",
    why: "asking for more asks for the SAME amount, so the loader re-fetches one window forever " +
         "and the start stays unreachable",
    find: "    const want = _dmBackfilled * 2;",
    repl: "    const want = _dmBackfilled;   /*DMM6*/",
    marker: "DMM6", expect: 1 },

  // ── GAP 3: the id input ───────────────────────────────────────────────────────────────────
  { id: "M7", file: "ui", part: "C",
    why: "a refusal is SWALLOWED — a typo'd id fails silently and the panel looks unchanged, which " +
         "is indistinguishable from a working conversation",
    find: '      _dmNewError = why === "self" ? "That is you."',
    repl: '      _dmNewError = "" || (why === "self" ? "" : "");   /*DMM7*/\n      if (false) _dmNewError = why === "self" ? "That is you."',
    marker: "DMM7", expect: 1 },

  { id: "M8", file: "ui", part: "C",
    why: "the shape check is dropped, so an obvious typo becomes a room-creation attempt",
    find: '    if (userId.indexOf("@") !== 0 || userId.indexOf(":") < 2) {',
    repl: "    if (false) {   /*DMM8*/",
    marker: "DMM8", expect: 1 },

  // ── GAP 4: reuse, not re-implementation ───────────────────────────────────────────────────
  { id: "M9", file: "ui", part: "D",
    why: "THE SECOND COPY RETURNS — the DM fold re-implements the non-downgrade rule instead of " +
         "delegating, so it inherits none of ChatBuffer's third state and a redacted DM can be " +
         "resurrected by a late body",
    find: "    const b = ChatBuffer.create();",
    repl: "    const at = out.findIndex((m) => m.id === (msg && msg.id));\n    if (at >= 0) { if (out[at].failed && !msg.failed) out[at] = msg; return out; }\n    if (msg && msg.id) out.push(msg);\n    out.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));\n    return out.length > max ? out.slice(out.length - max) : out;\n    const b = ChatBuffer.create();   /*DMM9*/",
    marker: "DMM9", expect: 1 },

  { id: "M10", file: "ch", part: "D",
    why: "a DM redaction from a room this client never bound is acted on — the scope test is " +
         "bypassed for deletions, so a stranger can delete rows out of your view",
    // Same collision, same qualification: J11 put a byte-identical type test in the ROOM chat
    // door. Anchored on the DM door's own comment above it.
    find: "    // ── THE SAME DOOR, FOR REDACTIONS TOO (gap 4) ───────────────────────────────────────────",
    repl: "    if (raw.type === \"m.room.redaction\" && raw.redacts) { if (_onDMRedaction) _onDMRedaction(raw.redacts, raw.room_id, raw.sender); return; }   /*DMM10*/",
    marker: "DMM10", expect: 1 },

  { id: "M11", file: "ch", part: "D",
    why: "a DM redaction naming nothing is approximated rather than refused",
    find: "      if (!target) { Logger.warn(\"Chat: DM redaction with no target id\"); return; }",
    repl: "      /*DMM11*/",
    marker: "DMM11", expect: 1 },
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
    console.log("[mutate-dm] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-dm] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-dm] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-dm] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-dm-gaps:" + row.id, file);
    let h2 = null;
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      // A second site may live in a DIFFERENT file (M21 needs the runtime and the ladder to
      // disagree, and they are two files). Its own journal handle is opened so a restore puts
      // both back, and `h2` is restored alongside `h` on every exit path below.
      if (row.find2 && row.file2) {
        h2 = J.open("mutate-dm-gaps:" + row.id + ":2", F[row.file2]);
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
  console.log("\n[mutate-dm] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
