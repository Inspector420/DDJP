// tests/check-gate-copy.js
// SUBJECT: ui/base.js, backends/backend1/ranks.js, backends/backend1/capabilities.js, features/room.js
// TWO ADDED at `ddjp_384` — both were under-declared, and the file names one of them as the accused
// in its own assertion text. `capabilities.js` PRODUCES the denial sentences: PART A drives
// `Capabilities.can()` over every `Capabilities.VERBS` entry after rewriting a `Ranks.GATES` row in
// source, and the header says outright that "a `capabilities.js` that had gone back to literals fails
// here". PART C adds `"...so `capabilities.js` is still computing a rank's written form of its own"`.
// `features/room.js` is hop three of PART C's chain — `Ranks.labelOf -> Ranks.LADDER ->
// Capabilities.LADDER -> Room.rankLadder()` — and each hop is asserted SEPARATELY so a failure names
// which link dropped the label. `Room.rankLadder()` dropping it fails here and nowhere else, since
// `ui/` may not reach `Ranks` and this chain is the only route to the screen.
// `ranks.js` STAYS: PART C's claim is that a rank's written form has ONE home and that home is
// `Ranks.labelOf`, which is the same call already settled for `ranks.js` in `check-bot-runtime`.
// WALL: THE RANK IN A DENIAL SENTENCE IS THE RANK THE GATE TABLE HOLDS.
//
// `Capabilities.can(...).reason` is not log-only. It travels `Actions.describe` -> the button
// `title` in `ui/interface.js`, so it is text a person reads. Ten of those sentences restated
// their gate's value as a literal — `no("VIP rank required to skip someone else's song")`,
// `no("High-Staff rank required")`, `no("Only the owner can ban someone")` — and a row moving in
// `Ranks.GATES` made every one of them lie, silently, on screen.
//
// ── WHY THIS GUARD MUTATES RATHER THAN READS ────────────────────────────────────────────────
// J36 says it in as many words: *a guard that only reads the current strings would pass on the
// defect*. Of course it would — the literals were CORRECT when they were written. "VIP rank
// required" matched `"dj.skip.others": "vip"` exactly, and would have matched a regex asserting
// so. What no reading can distinguish is a sentence that AGREES with the table from one that is
// DERIVED from it, and only the second survives the table changing.
//
// So every row is driven by moving it. The gate table is rewritten IN SOURCE and reloaded, which
// exercises the real `Ranks.permits` and the real `Ranks.gateFor` over a real table — no seam is
// swapped and no answer is stubbed, so a `capabilities.js` that had gone back to literals fails
// here even though every one of its strings still reads correctly.
//
// ── AND THE VERB->ACT MAPPING IS DISCOVERED, NEVER LISTED ───────────────────────────────────
// Writing `{ "dj.move": "dj.move", "dj.skip": "dj.skip.others", … }` here would be a second copy
// of the wiring under test, free to drift from `capabilities.js` and certain to, because the two
// are not even spelled alike (`dj.skip` is gated by `dj.skip.others`). Instead: move one row, see
// which verb's sentence moves with it. The mapping falls out of the measurement, so a verb
// re-pointed at a different gate tomorrow is covered without an edit here.
//
// PART A  every gated act owns exactly one verb's sentence, and moving the act moves the sentence
// PART B  the one act with no verb has no sentence — the deliberate absence, asserted
// PART C  a rank's written form has ONE home, and survives EVERY HOP to the screen. The first
//         version of this part checked the two ends and missed the link between them, which is
//         `FAILURE-SIGNATURES.md`'s first signature reproduced inside the guard for a job about
//         one rule living in two places. It now walks the chain hop by hop.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

let failed = false, A = 0;
function ok(c, msg, got) {
  A++;
  if (c) return;
  failed = true;
  console.log("[gate-copy] FAIL — " + msg);
  if (got !== undefined) console.log("      " + (typeof got === "string" ? got : JSON.stringify(got)));
}

// ── THE MUTATING LOADER ──────────────────────────────────────────────────────────────────────
// `loadInContext` resolves each entry against ROOT with `path.join`, so a path RELATIVE to ROOT
// reaches outside the tree correctly while an absolute one would be glued onto it. The mutated
// copy therefore lives in a temp dir and is addressed by its relative path — the tree itself is
// never written to, which matters because a guard that edits the source it is checking can leave
// a half-applied mutation behind on any throw.
const RANKS_REL = "backends/backend1/ranks.js";
const RANKS_SRC = fs.readFileSync(path.join(ROOT, RANKS_REL), "utf8");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ddjp-gate-copy-"));

function loadWithRanks(src, extraFiles) {
  const f = path.join(TMP, "ranks-" + (loadWithRanks._n = (loadWithRanks._n || 0) + 1) + ".js");
  fs.writeFileSync(f, src);
  // `extraFiles` is how PART C reaches `features/room.js` — the hop between `Capabilities` and the
  // UI. It is loaded ONLY where it is needed rather than always: PARTS A and B ask about
  // `Capabilities` alone, and pulling a feature module into their sandboxes would mean a load
  // failure there reporting as a gate-copy finding.
  return loadInContext([
    path.relative(ROOT, f),
    "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js",
  ].concat(extraFiles || []), {});
}

// Rewrite ONE gate row inside the GATES block. Bounded to that block by index rather than by a
// tree-wide regex: the act names also appear in comments and in `_LABELS`, and a guard that
// mutated a comment would prove nothing while looking like it had.
function withGate(act, rank) {
  const at = RANKS_SRC.indexOf("const GATES = {");
  const end = RANKS_SRC.indexOf("};", at);
  if (at < 0 || end < 0) throw new Error("GATES block not found in ranks.js");
  const block = RANKS_SRC.slice(at, end);
  const re = new RegExp('("' + act.replace(/\./g, "\\.") + '":\\s*)"[a-z-]+"');
  const hits = block.match(new RegExp(re.source, "g")) || [];
  if (hits.length !== 1) throw new Error("expected 1 row for " + act + ", found " + hits.length);
  return RANKS_SRC.slice(0, at) + block.replace(re, '$1"' + rank + '"') + RANKS_SRC.slice(end);
}

// Rewrite one LABEL row, for PART C.
function withLabel(name, label) {
  const at = RANKS_SRC.indexOf("const _LABELS = {");
  const end = RANKS_SRC.indexOf("};", at);
  if (at < 0 || end < 0) throw new Error("_LABELS block not found in ranks.js");
  const block = RANKS_SRC.slice(at, end);
  const re = new RegExp('("' + name + '":\\s*)"[^"]+"');
  const hits = block.match(new RegExp(re.source, "g")) || [];
  if (hits.length !== 1) throw new Error("expected 1 label row for " + name + ", found " + hits.length);
  return RANKS_SRC.slice(0, at) + block.replace(re, '$1"' + label + '"') + RANKS_SRC.slice(end);
}

// ── THE SUBJECT ──────────────────────────────────────────────────────────────────────────────
// A state and a target that carry every gated verb PAST its state checks, so the gate is the only
// thing left to refuse. Without this some verbs answer "Nothing is playing" or "Not in the
// rotation" and the sentence under test is never reached — a guard passing on a reason it never
// looked at, which is the shape this file exists to refuse.
const STATE = {
  nowPlaying: { dj: "@dj", pi: "p1", song: { videoId: "s1" } },
  rotation: [{ user: "@them", pending: [{ videoId: "s2" }] }],
  settings: {},
};
const CTX = {
  myId: "@me", myRank: 0, now: 0,
  target: { userId: "@them", targetRank: 0, videoId: "s2", newLevel: 0, djOfSong: "@dj" },
};

// Every verb's reason in one sandbox, so two sandboxes can be compared row by row.
function reasons(sb) {
  const out = {};
  for (const v of sb.Capabilities.VERBS) {
    const d = sb.Capabilities.can(v, STATE, CTX);
    out[v] = d.permitted ? null : d.reason;
  }
  return out;
}

const base = loadWithRanks(RANKS_SRC);
const baseReasons = reasons(base);
const GATES = base.Ranks.GATES;
const ACTS = Object.keys(GATES);

ok(ACTS.length > 0, "PREMISE: `Ranks.GATES` is empty, so every row below pins nothing", ACTS.length);

// ═══ PART A — MOVING A GATE MOVES ITS SENTENCE ═══════════════════════════════════════════════
// For each act: move it to a rung with a DIFFERENT label, reload, and require that the verb whose
// sentence changed now names the new rank and no longer names the old one.
//
// The target rung is chosen for a DISTINGUISHABLE LABEL rather than for being weaker or stronger.
// "Staff" is a substring of "High Staff", so a test that moved `staff` -> `high-staff` and then
// asked "does the sentence still contain Staff" would answer yes for both and prove nothing. The
// pair is picked so neither label contains the other.
const witnessed = {};
for (const act of ACTS) {
  const from = GATES[act];
  const to = (from === "vip") ? "owner" : "vip";
  const fromLabel = base.Ranks.labelOf(from);
  const toLabel = base.Ranks.labelOf(to);

  ok(fromLabel.indexOf(toLabel) < 0 && toLabel.indexOf(fromLabel) < 0,
    "PART A APPLIED (" + act + "): the two labels overlap as substrings, so a sentence containing "
    + "one cannot be told from a sentence containing the other", fromLabel + " / " + toLabel);

  const moved = reasons(loadWithRanks(withGate(act, to)));
  const changed = Object.keys(baseReasons).filter((v) => baseReasons[v] !== moved[v]);
  witnessed[act] = changed;

  // NOTHING MOVED. Two very different causes, and this loop cannot tell them apart: the act may
  // have no verb at all (legitimate — `count.set`), or its verb's sentence may be a LITERAL that
  // ignores the table. PART B is what separates them, by comparing the whole silent set against
  // the one act that is allowed to be in it. Driven: reverting `dj.skip` to its shipped literal
  // lands here, and the first version of this guard then reported it under PART B's wording about
  // a new gate — true of the mechanism, wrong about the cause, which is this project's second
  // failure signature appearing inside the guard written to catch its first.
  if (!changed.length) continue;

  ok(changed.length === 1,
    "PART A (" + act + "): moving one gate changed " + changed.length + " verbs' sentences. A gate "
    + "row belongs to one verb; more than one means a sentence is being built from a gate that is "
    + "not its own", changed);

  const v = changed[0];
  const before = baseReasons[v], after = moved[v];

  ok(typeof after === "string" && after.indexOf(toLabel) >= 0,
    "PART A (" + act + " -> " + v + "): the gate moved to `" + to + "` and the sentence a person "
    + "reads does not name " + JSON.stringify(toLabel) + ". THIS IS THE DEFECT J36 EXISTS FOR: the "
    + "string is written beside the rule instead of derived from it, so it was right when it was "
    + "typed and is wrong now", { before: before, after: after });

  ok(typeof after === "string" && after.indexOf(fromLabel) < 0,
    "PART A (" + act + " -> " + v + "): the sentence still names the OLD rank "
    + JSON.stringify(fromLabel) + " after its gate moved — a literal surviving beside a derived "
    + "half is the same lie with a smaller blast radius", { before: before, after: after });

  ok(typeof before === "string" && before.indexOf(fromLabel) >= 0,
    "PART A CONTROL (" + act + " -> " + v + "): the SHIPPED sentence does not name the rank the "
    + "shipped table holds, so the comparison above is between two wrong answers rather than a "
    + "correction", { shipped: before, gate: from });
}

// ═══ PART B — THE ACT WITH NO VERB, ASSERTED RATHER THAN COMMENTED ═══════════════════════════
// `count.set` is in `GATES` and deliberately has no capability verb: there is no UI control for
// it, and `capabilities.js` carries a paragraph saying so because the absence has been
// re-investigated three times as a suspected gap. A comment cannot notice the day somebody adds
// the verb and forgets the sentence, or the day a row is added with no verb at all — so the
// absence is measured here instead, from the same mutation sweep PART A already ran.
const silent = ACTS.filter((a) => witnessed[a].length === 0);
const strays = silent.filter((a) => a !== "count.set");
// THE CAUSES, IN THE ORDER THEY ARE LIKELY, because a failure message that leads with the rare
// one sends the reader to the wrong file. An act appearing here is MOST often a sentence that
// stopped being derived — that is the whole defect J36 closed, and it is the cause a future edit
// reintroduces. A genuinely verb-less new gate is the second reading, and it is a smaller problem
// (a control nobody can press yet) than a control that lies about who may press it.
ok(strays.length === 0,
  "PART B: moving " + strays.join(", ") + " changed no sentence anywhere. Most likely its verb's "
  + "reason is a LITERAL again — the J36 defect, and the string will still READ correctly, which "
  + "is why nothing else catches it. Otherwise it is a gate row that has landed with no denial "
  + "sentence at all. Only `count.set` is allowed to be silent, and only because it has no verb",
  { silent: silent, allowed: ["count.set"] });
ok(silent.indexOf("count.set") >= 0,
  "PART B: `count.set` DID move a sentence, so it has acquired a verb. That is fine and this row "
  + "is the reminder: the verb needs a derived reason and this allow-list needs it removed");

ok(base.Capabilities.VERBS.indexOf("count.set") < 0,
  "PART B: `count.set` is silent because it has no verb, not because its verb answers a constant — "
  + "these need opposite fixes, so the reason for the silence is asserted rather than assumed");

// ═══ PART C — A RANK'S WRITTEN FORM HAS ONE HOME, AND SURVIVES EVERY HOP TO THE SCREEN ═══════
// The label lived in TWO places and they disagreed. `ui/interface.js` held `_RANK_FACE` with
// `"vip": { name: "VIP" }`; `capabilities.js` grew a local title-caser for J07 and rendered the
// same rung "Vip". Neither could see the other — `ui/` is downstream of `Capabilities` and may not
// reach it — so nothing in the tree could compare them, and the disagreement surfaced only when
// J36 gave the caser its first acronym.
//
// ── THE FIRST VERSION OF THIS PART CHECKED THE TWO ENDS AND MISSED THE MIDDLE ────────────────
// It asserted that `Ranks.LADDER` carried the renamed label, and that `ui/interface.js` READ
// `r.label`. Both were true. `Capabilities.LADDER` — the one hop between them — was still built as
// `{ name, level }` and dropped it, so `Room.rankLadder()` handed the UI `label: undefined` and
// every rank rendered as its raw ladder token: `high-staff`, `vip`, `uncategorized`, on the roster
// and in the rank picker. The whole suite passed.
//
// **That is `FAILURE-SIGNATURES.md`'s first signature — a guard on the module is not a guard on
// the wiring — reproduced inside the guard written to close a job whose entire premise is one rule
// living in two places.** It was invisible for the reason those always are: the UI reads
// `r.label || r.name`, so a missing label DEGRADES instead of throwing. The fallback is right and
// stays — a rung with no label should show its name, not `undefined` — and it is exactly what let
// a broken chain look like a working one.
//
// So the chain is now EXECUTED, hop by hop, in the order the value actually travels:
//     Ranks.labelOf  ->  Ranks.LADDER  ->  Capabilities.LADDER  ->  Room.rankLadder()
// and only the final UI hop is read as source, because nothing here renders a panel.
{
  const NEW = "Very Important Person";
  const sb = loadWithRanks(withLabel("vip", NEW), ["core/logger.js", "features/room.js"]);

  const r = reasons(sb);
  const carriers = Object.keys(r).filter((v) => typeof r[v] === "string" && r[v].indexOf(NEW) >= 0);
  ok(carriers.length > 0,
    "PART C: renaming the `vip` rung in the ladder changed no denial sentence, so `capabilities.js` "
    + "is still computing a rank's written form of its own", r);

  // EVERY HOP, NAMED SEPARATELY, so a failure says WHICH link dropped it rather than only that the
  // screen is wrong. A single end-to-end assertion would have caught the defect above and sent the
  // reader to the wrong file.
  const hops = [
    ["Ranks.LADDER", (sb.Ranks.LADDER || []).find((x) => x.name === "vip")],
    ["Capabilities.LADDER", (sb.Capabilities.LADDER || []).find((x) => x.name === "vip")],
    ["Room.rankLadder()", (sb.Room.rankLadder() || []).find((x) => x.name === "vip")],
  ];
  for (const [where, rung] of hops) {
    ok(rung && rung.label === NEW,
      "PART C: `" + where + "` drops the renamed label. `ui/` may not reach `Ranks`, so this chain "
      + "is the ONLY route a rank's written form takes to the screen, and a link that drops it does "
      + "not throw — the UI reads `r.label || r.name` and quietly renders the raw ladder token "
      + "instead", { hop: where, rung: rung });
  }

  // AND THE UI ACTUALLY TAKES IT. Source-level, and named as a partial rather than dressed as a
  // wall: nothing in this suite renders `ui/interface.js`, so this proves the panel READS the
  // ladder's label and not that the pixels are right. The same limit `check-bot-owner-ui` PART F
  // states for its own sentence check.
  const ui = fs.readFileSync(path.join(ROOT, "ui/base.js"), "utf8");
  const at = ui.indexOf("const RANKS =");
  const decl = ui.slice(at, ui.indexOf(";", at)).replace(/\/\/[^\n]*/g, "");
  ok(at > 0 && /r\.label/.test(decl),
    "PART C: the UI's RANKS table does not read `r.label` from the ladder, so it is holding its own "
    + "rank names again", decl);

  const face = ui.slice(ui.indexOf("_RANK_FACE"), ui.indexOf("const RANKS ="))
    .replace(/\/\/[^\n]*/g, "");
  ok(!/\bname:/.test(face),
    "PART C: `_RANK_FACE` carries a `name:` again — the second home is back. Colour belongs there; "
    + "the written form of a rank belongs to the ladder, because `capabilities.js` needs it too and "
    + "cannot reach the UI", face.slice(0, 400));
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}

if (failed) process.exit(1);
console.log("[gate-copy] PASS — the rank in a denial sentence is the rank `Ranks.GATES` holds, proved "
  + "by MOVING every row rather than by reading the strings (" + A + " assertions). Reading proves "
  + "nothing here: the ten literals J36 replaced were all CORRECT when written, and would have "
  + "satisfied any regex asserting they matched the table — what no reading separates is a sentence "
  + "that agrees with the gate from one derived from it. Each row is rewritten IN SOURCE and "
  + "reloaded, so the real `gateFor` and the real `permits` run over a real table and a return to "
  + "literals fails here while still reading correctly. The verb->act mapping is DISCOVERED by "
  + "watching which sentence moves, never listed — `dj.skip` is gated by `dj.skip.others` and a "
  + "hand-written map would be a second copy of the wiring under test. The target rung is picked so "
  + "neither label is a substring of the other, because `Staff` inside `High Staff` makes the "
  + "obvious comparison answer yes to both. `count.set`'s missing sentence is asserted as an "
  + "ABSENCE OF A VERB rather than assumed, since a gate with no denial and a verb with a constant "
  + "one need opposite fixes. And the label has ONE home and SURVIVES THE TRIP, driven by renaming "
  + "a rung and walking `Ranks.labelOf` -> `Ranks.LADDER` -> `Capabilities.LADDER` -> "
  + "`Room.rankLadder()` hop by hop. It was in `ui/interface.js` AND in a title-caser in "
  + "`capabilities.js`, which disagreed about `vip` — \"VIP\" against \"Vip\" — with no route "
  + "between them for anything to notice. THE HOPS ARE WALKED SEPARATELY BECAUSE THE FIRST VERSION "
  + "OF THIS FILE ASSERTED THE TWO ENDS AND PASSED WHILE THE MIDDLE WAS BROKEN: `Capabilities."
  + "LADDER` was still built as `{name, level}`, so the UI got `label: undefined` and rendered every "
  + "rank as its raw ladder token. Nothing threw, because the UI reads `r.label || r.name` — the "
  + "fallback is correct and is exactly what made a broken chain look like a working one");
process.exit(0);
