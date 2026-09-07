// tests/check-reputation.js
// WALL: A REPUTATION NUMBER NEVER TRAVELS WITHOUT ITS COVERAGE, AND CHECKPOINTS ARE UNTOUCHED.
//
// J19's Done-when is the honest label and it is the whole job: the number is at best WHAT THE BOT
// SAW, never a complete count. The failure this guard exists to prevent is not a wrong number — it
// is a RIGHT number that looks like a different kind of number. A bot that started yesterday,
// restarted, or was away for a week produces a tally of the same type and shape as a complete one,
// and nothing about the value says which it is.
//
// So the property pinned here is structural rather than textual: **there is no shape in this
// module that is a tally without its coverage**, and the label REFUSES rather than falling back to
// a bare count. A guard can prove the surface says what it means; it can never prove a reader
// hears it (J16's precedent and its caveat both apply, and `README.md` carries the half this
// cannot reach).
//
// ── WHAT EACH PART PINS ──────────────────────────────────────────────────────────────────────
//   PART A — the fold's arithmetic at explicit values, with the admitted sibling beside every
//     exclusion; reactions RECEIVED, refused ones earning nothing.
//   PART B — COVERAGE TRAVELS OR NOTHING DOES: the tally and its window are inseparable, and
//     `partial` is a reading of the log rather than a constant.
//   PART C — THE LABEL REFUSES. No coverage, no sentence — and never the word "lifetime", and
//     never `complete: true`, in either branch.
//   PART D — SHAPE (a): checkpoints untouched. The snapshot is inert in state, seed AND
//     fingerprint, and the fingerprint still commits exactly six fields.
//   PART E — (b) and (c) are closed for reasons that are DRIVEN here, so a later reader can check
//     the argument rather than inherit it.
//   PART F — the module is REGISTERED: in `index.html` and in `_load.js`. v276 shipped a feature
//     module that no browser would have loaded while every guard drove it happily.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let asserts = 0;
function fail(msg, got) {
  console.log("[reputation] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

function makeRep(opts) {
  const o = opts || {};
  const sent = [];
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js", "features/reputation.js",
  ], {
    Date, Math, JSON,
    MatrixBridge: {
      sendEvent: async (ch, type, body) => { sent.push({ ch, type, body }); if (o.sendThrows) throw new Error("boom"); },
      eventsKeyForLevel: (lvl) => "events_L" + lvl,
    },
  });
  return { R: sb.Reputation, CF: sb.CheckpointFormat, SD: sb.StateDeriver, CH: sb.ConsensusHash, sent };
}
const M = makeRep();
const R = M.R;

// A log in the shape the fold walks: a play, then reactions naming it.
function mkLog(spec) {
  const out = [];
  let l = 0, ts = 1000;
  for (const s of spec) {
    l++; ts += 100;
    out.push({ eventId: s.id, type: s.type, sender: s.by, ts: ts, l: (s.l !== undefined ? s.l : l),
               body: s.p ? { p: s.p } : {} });
  }
  return out;
}

// ═══ PART A — the arithmetic ═════════════════════════════════════════════════════════════════
{
  const log = mkLog([
    { id: "$p1", type: "ddjp.dj.play", by: "@dj1:hs" },
    { id: "$v1", type: "ddjp.dj.vote", by: "@a:hs", p: "$p1" },
    { id: "$v2", type: "ddjp.dj.vote", by: "@b:hs", p: "$p1" },
    { id: "$s1", type: "ddjp.dj.save", by: "@a:hs", p: "$p1" },
    { id: "$p2", type: "ddjp.dj.play", by: "@dj2:hs" },
    { id: "$v3", type: "ddjp.dj.vote", by: "@a:hs", p: "$p2" },
  ]);
  const f = R.foldReputation(log, () => true, { roomStartsAt: 1 });
  ok(f.tally["@dj1:hs"] && f.tally["@dj1:hs"].votes === 2 && f.tally["@dj1:hs"].saves === 1,
    "A: reactions are counted toward the DJ who PLAYED the song, not the person who reacted — " +
    "reputation is what you RECEIVED", f.tally);
  ok(f.tally["@dj2:hs"].votes === 1,
    "A: across more than one DJ, so the attribution is a lookup rather than a single accumulator",
    f.tally);
  ok(!f.tally["@a:hs"],
    "A control: the VOTER earns nothing — without this the tally above could be counting the " +
    "wrong side of every reaction and still look plausible", Object.keys(f.tally));

  // A REFUSED reaction earns nothing. The admitted sibling is what makes this evidence.
  const g = R.foldReputation(log, (id) => id !== "$v2", { roomStartsAt: 1 });
  ok(g.tally["@dj1:hs"].votes === 1,
    "A: a reaction the reducer REFUSED earns nothing — otherwise anyone could inflate a score with " +
    "votes the room throws away", g.tally);
  ok(g.coverage.refused === 1,
    "A: and it is COUNTED rather than dropped silently, so the tally can report that it saw more " +
    "than it counted", g.coverage);
  ok(f.coverage.refused === 0 && f.tally["@dj1:hs"].votes === 2,
    "A control: with nothing refused the count is zero and both votes land — so `refused` is a " +
    "reading of legality rather than a constant", f.coverage);

  // A reaction naming a playing this log does not hold.
  const h = R.foldReputation(mkLog([
    { id: "$v9", type: "ddjp.dj.vote", by: "@a:hs", p: "$gone" },
  ]), () => true, {});
  ok(Object.keys(h.tally).length === 0 && h.coverage.unattributed === 1,
    "A: a reaction to a playing this log does not contain is UNATTRIBUTED, not an error and not " +
    "silently dropped — it is the ordinary consequence of a bot that joined mid-room, and it is " +
    "the evidence that the tally is partial", h.coverage);

  const dirty = R.foldReputation([{ type: "ddjp.dj.vote" }, { eventId: "$x" }, null], () => true, {});
  ok(Object.keys(dirty.tally).length === 0,
    "A: an entry with no id or no type contributes nothing and does not throw", dirty.tally);
}

// ═══ PART B — COVERAGE TRAVELS, OR NOTHING DOES ══════════════════════════════════════════════
{
  const log = mkLog([
    { id: "$p1", type: "ddjp.dj.play", by: "@dj1:hs" },
    { id: "$v1", type: "ddjp.dj.vote", by: "@a:hs", p: "$p1" },
  ]);
  const f = R.foldReputation(log, () => true, { roomStartsAt: 1 });
  ok(f.coverage && typeof f.coverage === "object",
    "B: APPLIED — the fold must return coverage, or every row below has no subject", f.coverage);
  ok(typeof f.coverage.fromL === "number" && typeof f.coverage.toL === "number",
    "B: the window is reported as positions, so a reader can say how far back the number sees",
    f.coverage);
  ok(f.coverage.held === log.length,
    "B: measured over EVERYTHING held rather than over what was counted — a room with no votes " +
    "still has a window, and reporting none would make an empty tally look unbounded",
    { held: f.coverage.held, log: log.length });

  // `partial` IS A READING, driven in both directions on the same rule.
  ok(f.coverage.partial === false,
    "B control: a log that reaches the room's start is NOT partial — without this the partial " +
    "branch below would be satisfied by a flag that is always true", f.coverage);
  const late = R.foldReputation(mkLog([
    { id: "$p1", type: "ddjp.dj.play", by: "@dj1:hs", l: 500 },
    { id: "$v1", type: "ddjp.dj.vote", by: "@a:hs", p: "$p1", l: 501 },
  ]), () => true, { roomStartsAt: 1 });
  ok(late.coverage.partial === true,
    "B: A LOG THAT STARTS ABOVE THE ROOM'S BEGINNING IS PARTIAL. This is the case the Done-when " +
    "is about: a bot that joined late, restarted, or was away produces a tally of the same type " +
    "and shape as a complete one, and only this flag distinguishes them", late.coverage);
  const orphaned = R.foldReputation(mkLog([
    { id: "$v1", type: "ddjp.dj.vote", by: "@a:hs", p: "$gone", l: 1 },
  ]), () => true, { roomStartsAt: 1 });
  ok(orphaned.coverage.partial === true,
    "B: and a reaction to a playing this log never saw makes it partial too, even when the log " +
    "starts at the beginning — history missing from the MIDDLE is the same fact from the tally's " +
    "point of view as history missing from the start", orphaned.coverage);

  // AND THERE IS NO SHAPE THAT IS A TALLY ALONE.
  const src = fs.readFileSync(path.join(ROOT, "features/reputation.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  const returns = [...src.matchAll(/return\s*\{[\s\S]*?\};/g)].map((m) => m[0]);
  // THE FIELD IS LOOKED FOR AS A KEY, NOT AS A SUBSTRING. `mutate-j19-reputation` M6's first
  // version added a field merely NAMED `coverageDetached`, and a `/coverage/` test was satisfied
  // by it — the check would have passed a return whose coverage was renamed to anything containing
  // the word. The key form is what the caller actually reads.
  const tallyOnly = returns.filter((r) => /\btally\b/.test(r) && !/(^|[\s{,])coverage\s*:/.test(r));
  ok(tallyOnly.length === 0,
    "B: NO RETURN IN THE MODULE CARRIES A TALLY WITHOUT COVERAGE. A caller that could hold the " +
    "number alone would render a partial count as a lifetime one, which is the failure this job " +
    "is built around — so it is prevented by there being no such shape rather than by a rule a " +
    "caller must remember", tallyOnly.length);

  // AND THE SAME PROPERTY AT RUNTIME, because a source check proves a spelling and this proves the
  // shape a caller is actually handed. Driven over inputs that produce an empty tally, a full one,
  // and a refusing legality predicate — every one must carry a usable `coverage`.
  for (const [name, out] of [
    ["empty log", R.foldReputation([], () => true, {})],
    ["no reactions", R.foldReputation(mkLog([{ id: "$p", type: "ddjp.dj.play", by: "@d:hs" }]), () => true, {})],
    ["all refused", R.foldReputation(log, () => false, {})],
    ["normal", f],
  ]) {
    ok(out && out.tally && out.coverage && typeof out.coverage.partial === "boolean",
      "B: every fold result carries a usable coverage at RUNTIME — `" + name + "`. The source " +
      "check above proves a spelling; this proves the shape a caller is handed", { name, out });
  }
}

// ═══ PART C — THE LABEL REFUSES ══════════════════════════════════════════════════════════════
{
  const complete = R.foldReputation(mkLog([
    { id: "$p1", type: "ddjp.dj.play", by: "@dj1:hs" },
    { id: "$v1", type: "ddjp.dj.vote", by: "@a:hs", p: "$p1" },
  ]), () => true, { roomStartsAt: 1 });
  const lab = R.label(complete, "@dj1:hs");
  ok(lab && lab.votes === 1,
    "C: APPLIED — the label must render for a sound fold, or its refusals below prove nothing", lab);
  ok(lab.complete === false,
    "C: `complete` IS FALSE EVEN IN THE NON-PARTIAL BRANCH. A bot that was never absent cannot " +
    "prove it was never absent, so there is no branch here that claims a total", lab);
  ok(!/lifetime/i.test(lab.heading + " " + lab.note),
    "C: and the word LIFETIME appears nowhere — it is the one word that would promise exactly " +
    "what cannot be promised", lab);
  ok(/bot/i.test(lab.heading),
    "C: the heading names the SOURCE of the number rather than its scope, because its scope is " +
    "the thing that cannot be stated", lab.heading);
  ok(/higher/.test(lab.note),
    "C: and the note states which direction the truth lies in — a qualifier that said only " +
    "'approximate' would leave a reader free to assume it is approximately complete", lab.note);

  const partialFold = R.foldReputation(mkLog([
    { id: "$p1", type: "ddjp.dj.play", by: "@dj1:hs", l: 500 },
    { id: "$v1", type: "ddjp.dj.vote", by: "@a:hs", p: "$p1", l: 501 },
  ]), () => true, { roomStartsAt: 1 });
  const plab = R.label(partialFold, "@dj1:hs");
  ok(plab.note !== lab.note,
    "C: the partial case says something DIFFERENT from the complete-as-far-as-held case — one " +
    "sentence for both would make the flag decorative", { partial: plab.note, held: lab.note });
  ok(/joined after|missed time/.test(plab.note),
    "C: and it names the reason a person would otherwise have to guess", plab.note);

  // THE REFUSAL.
  for (const bad of [null, undefined, {}, { tally: { "@dj1:hs": { votes: 5 } } },
                     { tally: {}, coverage: {} }, { coverage: { partial: "yes" } }]) {
    ok(R.label(bad, "@dj1:hs") === null,
      "C: a fold WITHOUT usable coverage produces NO LABEL AT ALL — null, so a caller with " +
      "nothing to render shows nothing. The tempting fallback is to render the number and omit " +
      "the qualifier, which is exactly how a partial count becomes a lifetime one", { sent: bad });
  }
  ok(R.label(complete, "@nobody:hs").votes === 0,
    "C control: a user with no reactions labels as zero rather than refusing — the refusal above " +
    "is about missing COVERAGE, not about a missing user", R.label(complete, "@nobody:hs"));
}

// ═══ PART D — SHAPE (a): CHECKPOINTS UNTOUCHED ═══════════════════════════════════════════════
{
  const seg = F.sortLog(F.playingRoom({ songs: 2 }).log);
  const seed = M.SD.buildSeed(seg, null);
  const base = M.CF.fingerprint(1, null, seed, 10, false, "$a..$b");
  ok(typeof base === "string" && base.length > 10,
    "D: APPLIED — a baseline fingerprint must compute", base);

  // The fingerprint's domain, READ FROM THE FUNCTION rather than from its comment.
  const cfSrc = fs.readFileSync(path.join(ROOT, "backends/backend1/checkpointformat.js"), "utf8");
  const body = cfSrc.match(/function fingerprint\([\s\S]*?\n  \}/)[0];
  const fields = [...body.matchAll(/(\w+):\s/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i);
  ok(fields.length === 6,
    "D: the fingerprint commits EXACTLY SIX fields, read out of the function", fields);
  ok(!/\brep\b|reputation/i.test(body),
    "D: and reputation is not among them — shape (a) means checkpoints are untouched, asserted " +
    "against the code rather than against this file's description of it", fields);

  // The snapshot is inert: state, seed AND fingerprint.
  function build(withSnaps) {
    const sb = loadInContext([
      "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js",
      "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
      "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js",
      "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
    ], { localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
         Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
         window: {}, document: { body: { appendChild() {} } } });
    const room = F.playingRoom({ songs: 3 });
    const log = F.sortLog(room.log);
    for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
    let l = room.lastL, ts = room.startTs + 700000;
    if (withSnaps) {
      for (let i = 0; i < 3; i++) {
        sb.StreamManager.ingest(F.rawEvent("$snap" + i, ++l, ts += 1000, "@bot:hs", F.RANK.owner,
          { t: "ddjp.rep.snapshot", t2: { "@dj:hs": { votes: 9, saves: 9 } },
            c: { partial: false, held: 99 } }));
      }
    }
    const held = sb.StreamManager.getLog();
    const sd = sb.StateDeriver.buildSeed(held);
    return { held, seed: sd, state: sb.StreamManager.getState(),
             fp: sb.CheckpointFormat.fingerprint(1, null, sd, 10, false, "$a..$b") };
  }
  const clean = build(false), dirty = build(true);
  ok(dirty.held.filter((e) => e.type === "ddjp.rep.snapshot").length === 3,
    "D: APPLIED — the snapshots must have reached the LOG, or inertness is a claim about events " +
    "that were never there", dirty.held.filter((e) => e.type === "ddjp.rep.snapshot").length);
  ok(JSON.stringify(clean.state) === JSON.stringify(dirty.state),
    "D: derived STATE is identical with and without snapshots", "state differs");
  ok(JSON.stringify(clean.seed) === JSON.stringify(dirty.seed),
    "D: and so is the SEED — the half that matters, since an event leaving state identical while " +
    "moving the seed would stop two honest clients verifying each other's floors with every " +
    "correctness assertion still green", "seed differs");
  ok(clean.fp === dirty.fp,
    "D: and therefore the FINGERPRINT", { clean: clean.fp.slice(0, 12), dirty: dirty.fp.slice(0, 12) });
}

// ═══ PART E — WHY (b) AND (c) ARE CLOSED, DRIVEN ═════════════════════════════════════════════
// Recorded as measurements rather than as prose, so a later reader can CHECK the argument that
// closed two shapes instead of inheriting it.
{
  const seg = F.sortLog(F.playingRoom({ songs: 2 }).log);
  const seed = M.SD.buildSeed(seg, null);
  const base = M.CF.fingerprint(1, null, seed, 10, false, "$a..$b");

  // (b) — a seventh field, however it is added, moves every fingerprint.
  const inSeed = JSON.parse(JSON.stringify(seed));
  inSeed.rep = { "@a:hs": { votes: 3, saves: 1 } };
  ok(M.CF.fingerprint(1, null, inSeed, 10, false, "$a..$b") !== base,
    "E: (b) CLOSED — reputation carried INSIDE the seed moves the fingerprint, so every checkpoint " +
    "in every room becomes unverifiable and no room holds a floor or forgets anything until it " +
    "seals two fresh ones. That is the dead-checkpoint window the settings keys paid one release " +
    "ago, paid again for a number that is an assertion either way", "unchanged");
  const asSeventh = M.CH.contentHash({ n: 1, prev: null, seed: seed, floorL: 10, thin: false,
                                       covers: "$a..$b", rep: {} });
  ok(asSeventh !== base,
    "E: (b) CLOSED — and carried as a seventh ARGUMENT it moves too, so the cost is a property of " +
    "committing the number at all rather than of where it is put", "unchanged");

  // (c) — the entry says "hardest to reconcile with forgetting". Driven: it is CONTRADICTORY.
  function tallyOf(log) {
    const f = R.foldReputation(log, () => true, {});
    return JSON.stringify(f.tally);
  }
  const early = mkLog([
    { id: "$p0", type: "ddjp.dj.play", by: "@dj1:hs", l: 1 },
    { id: "$v0", type: "ddjp.dj.vote", by: "@a:hs", p: "$p0", l: 2 },
    { id: "$v0b", type: "ddjp.dj.vote", by: "@b:hs", p: "$p0", l: 3 },
  ]);
  const late = mkLog([
    { id: "$p9", type: "ddjp.dj.play", by: "@dj1:hs", l: 90 },
    { id: "$v9", type: "ddjp.dj.vote", by: "@a:hs", p: "$p9", l: 91 },
  ]);
  const whole = early.concat(late);
  ok(tallyOf(whole) !== tallyOf(late),
    "E: (c) CLOSED, AND THE ENTRY'S WORDING UNDERSTATES IT. `Derived` means every client computes " +
    "the same answer from what it HOLDS. Two honest clients — one that has forgotten beneath a " +
    "floor, one that has not — compute DIFFERENT tallies from the same rule with no disagreement " +
    "about any event. So a lifetime tally is not a consensus quantity at all: it is not merely " +
    "HARD to reconcile with forgetting, it is CONTRADICTORY, because a number whose purpose is to " +
    "survive forgotten history cannot be derived from the history that survives",
    { whole: tallyOf(whole), forgotten: tallyOf(late) });
  ok(tallyOf(whole) === tallyOf(whole.slice()),
    "E control: the same rule over the same log gives the same answer, so the disagreement above " +
    "is about what is HELD rather than about the fold being unstable", tallyOf(whole));
}

// ═══ PART F — THE MODULE IS REGISTERED ═══════════════════════════════════════════════════════
// v276 shipped `features/botsettings.js` with no `<script>` tag: every guard drove it in a sandbox
// and it would have been undefined in a browser. A tagged-file sweep caught it; no guard did.
// This is that guard, for this module and for every other feature.
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const loadSrc = fs.readFileSync(path.join(ROOT, "tests/_load.js"), "utf8");
  const feats = fs.readdirSync(path.join(ROOT, "features")).filter((f) => f.endsWith(".js"));
  ok(feats.length > 10, "F: APPLIED — the feature scan must find modules", feats.length);

  const unlisted = feats.filter((f) => html.indexOf("features/" + f + "?v=") < 0);
  ok(unlisted.length === 0,
    "F: EVERY feature module has a `<script>` tag in index.html. A module absent from that list " +
    "runs in every sandbox and is UNDEFINED in the browser — passing tests do not mean the file " +
    "loads, and no guard caught it the last time it happened", unlisted);

  // AND ITS GLOBAL IS EXPOSED TO THE HARNESS. `_load.js`'s list is hand-written and its exposer
  // swallows a ReferenceError per name on purpose, so an omission is silent and surfaces far away
  // as `undefined.something`.
  const missing = [];
  for (const f of feats) {
    const src = fs.readFileSync(path.join(ROOT, "features", f), "utf8");
    const m = src.match(/^const (\w+) = \(\(\) =>/m);
    if (!m) continue;
    if (loadSrc.indexOf('"' + m[1] + '"') < 0) missing.push(f + " -> " + m[1]);
  }
  ok(missing.length === 0,
    "F: and every feature global is named in `_load.js`'s KNOWN_GLOBALS. A missing entry fails as " +
    "a confusing TypeError a long way from its cause, because the exposer swallows the " +
    "ReferenceError by design", missing);
}

console.log("[reputation] PASS — a reputation number never travels without its coverage, and " +
  "checkpoints are untouched (J19, shape (a), " + asserts + " assertions). THE DONE-WHEN IS THE " +
  "HONEST LABEL AND IT IS THE WHOLE JOB: the failure prevented here is not a wrong number but a " +
  "RIGHT one that looks like a different kind of number, because a bot that started yesterday, " +
  "restarted or was away produces a tally of the same type and shape as a complete one. So the " +
  "fold returns NO shape that is a tally without its window — asserted against every `return` in " +
  "the module — and the label REFUSES rather than falling back to a bare count, because the " +
  "tempting fallback is exactly how a partial count becomes a lifetime one. `complete` is FALSE " +
  "in BOTH branches: a bot that was never absent cannot prove it. SHAPE (a) IS DRIVEN, NOT " +
  "DECLARED: the fingerprint commits exactly six fields read out of the function, reputation is " +
  "not among them, and a snapshot is inert in state, seed AND fingerprint. AND THE TWO CLOSED " +
  "SHAPES ARE CLOSED BY MEASUREMENT: (b) moves the fingerprint whether carried in the seed or as " +
  "a seventh argument, and (c) is not merely hard but CONTRADICTORY — two honest clients holding " +
  "different amounts of history compute different tallies from one rule, so a number whose " +
  "purpose is to survive forgotten history cannot be derived from the history that survives. " +
  "Finally, every feature module is checked to have a script tag and a KNOWN_GLOBALS entry, " +
  "because v276 shipped one with neither and no guard noticed");
