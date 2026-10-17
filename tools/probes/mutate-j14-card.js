// tools/probes/mutate-j14-card.js
// MUTATION PASS FOR J14. Breaks each thing `check-user-card.js` claims to lock and reports
// whether the suite notices. Journalled, self-restoring, applied-checked on BOTH sides of every
// run.
//
//   node tools/probes/mutate-j14-card.js
//
// ── THE TWO RULES THIS RUNNER IS BUILT AROUND ────────────────────────────────────────────────
// 1. A MUTATION WHOSE EXPECTED RESULT IS "NOTHING CHANGES" CANNOT DETECT ITS OWN FAILURE TO
//    APPLY (`09-roadmap.md` §8). Every row here therefore expects a CHANGE — the direction that
//    announces its own failure. A row that expected green would be indistinguishable from a probe
//    that never ran.
// 2. ASSERT THE EDIT APPLIED, AND ASSERT IT STILL APPLIES WHEN YOU READ THE RESULT. Before-only
//    is sufficient when one hand holds the tree and worthless when two do. Under collision a
//    green mutation is VOID, not a survivor — discarded and re-run, never kept for comparison.
//
// The rows deliberately include one whose subject is the GUARD'S OWN PREMISE rather than the
// production code (M7), because `paths.md` §9 entry 12's fourth shape is a premise that stops
// pinning anything while every assertion around it stays correct.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const journal = require("./_journal.js");

const ROOT = path.resolve(__dirname, "..", "..");
const F = {
  ranks: path.join(ROOT, "backends/backend1/ranks.js"),
  caps: path.join(ROOT, "backends/backend1/capabilities.js"),
  bridge: path.join(ROOT, "backends/backend1/matrixbridge.js"),
  room: path.join(ROOT, "features/room.js"),
  ui: path.join(ROOT, "ui/interface.js"),
};

// ---- recover anything a previous run left behind, before reading a single byte ----
const rec = journal.recover();
if (rec.restored.length) {
  console.log("RECOVERED from a previous run: " + rec.restored.map((r) => r.file).join(", "));
}
if (rec.skipped.length) {
  console.log("SKIPPED (changed since, left alone): " + JSON.stringify(rec.skipped));
}

// THE VERDICT IS THE FULL SUITE, and that is the default: a row's claim is "does anything in the
// tree notice", not "does the guard I just wrote notice". `J14_SUITE` narrows the run to a single
// guard, which is useful for ATTRIBUTION only — reading which assertion fires, where `ok` exits at
// the first — and never for the survivor verdict. A green row measured that way would be a claim
// about one file dressed as a claim about the suite.
const SUITE_REL = process.env.J14_SUITE || "tests/run-all.js";
function suite() {
  try {
    const out = execFileSync("node", [path.join(ROOT, SUITE_REL)],
      { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { green: true, out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

// Which guards reported a failure, so a red is attributable rather than merely red.
function failing(out) {
  const names = new Set();
  for (const m of out.matchAll(/^\[([a-z0-9-]+)\] FAIL/gm)) names.add(m[1]);
  if (/user-card\] FAIL/.test(out)) names.add("user-card");
  return Array.from(names);
}
// AND WHICH ASSERTION. `08-build-and-deploy.md` §Writing a guard: where `ok` exits, one red line
// names the FIRST assertion to fire rather than the only one that would have — so "it went red"
// is a claim about ordering unless the message is read. Captured here so each row records which
// PART actually objected, and a row that goes red for an unrelated reason is visible.
function firstFailure(out) {
  const m = /\[user-card\] FAIL — ([^\n]*)/.exec(out);
  if (!m) {
    const any = /^\[([a-z0-9-]+)\] FAIL — ([^\n]*)/m.exec(out);
    return any ? (any[1] + ": " + any[2].slice(0, 110)) : null;
  }
  return m[1].slice(0, 130);
}

const rows = [];
// The full suite takes ~33s, so ten rows is ~6 minutes and a single run can outlive a session's
// patience — which is not a theoretical worry: the first attempt at this pass was killed mid-M9,
// and the JOURNAL is what restored `features/room.js` rather than leaving a mutated tree behind
// for the next reader to measure. Rows are therefore selectable, and the batches are recorded in
// the handoff so the set that ran is the set that is claimed.
const ONLY = process.argv.slice(2).filter((a) => /^M\d+$/.test(a));
function selected(id) { return ONLY.length === 0 || ONLY.indexOf(id) >= 0; }

function mutate(id, what, file, find, replaceWith, expect, marker) {
  if (!selected(id)) return;
  const h = journal.open("mutate-j14-card:" + id, file);
  let applied = 0, res = null, stillAfter = null, why = null;
  try {
    applied = h.apply(find, replaceWith, expect === undefined ? 1 : expect);
    const stillBefore = h.stillApplied(marker);
    if (!stillBefore) throw new Error("the mutation did not survive to the run");
    res = suite();
    stillAfter = h.stillApplied(marker);
  } catch (e) {
    why = e.message;
  } finally {
    h.restore();
  }

  const voided = (why !== null) || (stillAfter === false);
  const msg = res ? firstFailure(res.out) : null;
  rows.push({
    id, what, applied, voided, why, msg,
    green: res ? res.green : null,
    caught: res ? failing(res.out) : [],
  });
  const verdict = voided ? "VOID"
    : (res.green ? "GREEN — NOTHING NOTICED" : "RED — caught by " + failing(res.out).join(", "));
  console.log("\n" + id + " — " + what);
  console.log("   applied: " + applied + " site(s)" + (why ? "  (" + why + ")" : ""));
  console.log("   " + verdict);
  if (msg) console.log("   first assertion to fire: " + msg);
}

console.log("MUTATION PASS — J14. Every row expects a CHANGE; a green row is a finding.");

// ── M1 — the ban gate drops to staff, while the homeserver still demands 100 ─────────────────
// The exact drift PART A exists to catch: a button that reports permitted and gets a 403.
mutate("M1", "gate `member.ban` at staff while _powerLevels still writes ban: 100",
  F.ranks,
  '"member.ban":     "owner",',
  '"member.ban":     "staff",   /*MUT*/',
  1, '"member.ban":     "staff"');

// ── M2 — the strictly-below comparison becomes inclusive ─────────────────────────────────────
// Turns the diagonal permitted: staff kicking staff, and yourself.
mutate("M2", "`member.kick` accepts a target at your OWN rank (`<` becomes `<=`)",
  F.caps,
  'if (typeof tk === "number" && !(tk < myRank)) return no("Only people ranked below you");',
  'if (typeof tk === "number" && !(tk <= myRank)) return no("Only people ranked below you"); /*MUT*/',
  1, "tk <= myRank");

// ── M3 — the loop stops at the first refusal ─────────────────────────────────────────────────
// The shape that leaves every later room open while the earlier ones report closed.
mutate("M3", "the membership loop STOPS at the first refusal instead of continuing",
  F.bridge,
  '        Logger.warn("MatrixBridge: " + op + " failed for " + r.roomId + ": " + e.message);\n      }',
  '        Logger.warn("MatrixBridge: " + op + " failed for " + r.roomId + ": " + e.message);\n        break; /*MUT*/\n      }',
  1, "break; /*MUT*/");

// ── M4 — a partial reports success ───────────────────────────────────────────────────────────
// The single most dangerous line in the job: twenty of twenty-one read as done.
mutate("M4", "the verdict reports ok=true whenever ANY room closed",
  F.bridge,
  "const ok = (done.length === rooms.length);",
  "const ok = (done.length > 0); /*MUT*/",
  1, "done.length > 0");

// ── M5 — an unreadable room counts as closed ─────────────────────────────────────────────────
// "I can't tell" collapsing into "fine" — the failure loop CONCEPTS §3.3 is about.
mutate("M5", "a room whose membership cannot be read back is counted as CLOSED",
  F.bridge,
  "if (m === null) unverified.push(r.roomId);",
  "if (m === null) done.push(r.roomId); /*MUT*/",
  1, "if (m === null) done.push(r.roomId);");

// ── M6 — the Space goes last ─────────────────────────────────────────────────────────────────
// The ordering decision, mutated. While the Space is open the target can join channels the loop
// has not reached, so the room set can grow underneath it.
mutate("M6", "the Space is closed LAST instead of first",
  F.bridge,
  'if (spaceId) out.push({ key: "space", roomId: spaceId });\n    for (const key in (channels || {})) {\n      if (channels[key]) out.push({ key: key, roomId: channels[key] });\n    }',
  'for (const key in (channels || {})) {\n      if (channels[key]) out.push({ key: key, roomId: channels[key] });\n    }\n    if (spaceId) out.push({ key: "space", roomId: spaceId }); /*MUT*/',
  1, 'out.push({ key: "space", roomId: spaceId }); /*MUT*/');

// ── M7 — THE CARD DECIDES FOR ITSELF ─────────────────────────────────────────────────────────
// The Done-when's first clause, inverted: render the control live regardless of the descriptor.
mutate("M7", "the card renders every action LIVE, ignoring the descriptor",
  F.ui,
  "      btn.disabled = !d.enabled;",
  "      btn.disabled = false; /*MUT*/",
  1, "btn.disabled = false; /*MUT*/");

// ── M8 — the DM slot stops being a container ─────────────────────────────────────────────────
// The claim J15 rests on. Filtering to nothing means no catalog entry could ever light it up.
mutate("M8", "the card's action list ignores the adapter's vocabulary (returns the raw table)",
  F.ui,
  "    return _CARD_ACTIONS.filter((row) => known.indexOf(row.action) >= 0);",
  "    return _CARD_ACTIONS.slice(); /*MUT*/",
  1, "_CARD_ACTIONS.slice(); /*MUT*/");

// ── M9 — the feature layer stops re-reading live ranks ───────────────────────────────────────
// The only backstop a membership act has, deleted.
mutate("M9", "`_moderate` skips the live-rank re-check (the one backstop these verbs have)",
  F.room,
  "    if (!canModerate(verb, actorRank, targetRank)) {",
  "    if (false && !canModerate(verb, actorRank, targetRank)) { /*MUT*/",
  1, "if (false && !canModerate");

// ── M10 — the card prints a success over a partial ───────────────────────────────────────────
mutate("M10", "the card treats a partial verdict as done",
  F.ui,
  "        if (res && res.ok === false) {",
  "        if (false && res && res.ok === false) { /*MUT*/",
  1, "if (false && res && res.ok === false)");

// ── summary ──────────────────────────────────────────────────────────────────────────────────
console.log("\n────────────────────────────────────────────────────────────────");
const voided = rows.filter((r) => r.voided);
const green = rows.filter((r) => !r.voided && r.green);
const red = rows.filter((r) => !r.voided && !r.green);
console.log("rows: " + rows.length + " · red (noticed): " + red.length +
  " · GREEN (nothing noticed): " + green.length + " · void: " + voided.length);
if (green.length) {
  console.log("\nGREEN ROWS ARE THE FINDING — each is a break nothing in the suite objects to:");
  for (const r of green) console.log("  " + r.id + " — " + r.what);
}
if (voided.length) {
  console.log("\nVOID rows are discarded, not kept for comparison — re-run from scratch:");
  for (const r of voided) console.log("  " + r.id + " — " + (r.why || "did not survive to the read"));
}
const post = journal.recover();
console.log("\njournal after the run: " + (post.clean ? "clean" : "DIRTY — " +
  JSON.stringify(post.restored)));
