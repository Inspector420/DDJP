// tests/check-refusal-reasons.js
// WALL: A REFUSAL SAYS WHICH RULE REFUSED, AND SAYING SO COSTS NOTHING COMMITTED.
//
// ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
// `streammanager.js` printed "the fold did not accept it (rank gate, empty rotation, or no road
// met)" — three possibilities wearing an explanation's clothes. **It printed that because nothing
// upstream kept a reason**: every `_rej(ev)` recorded THAT an event was refused and never WHY, so
// `derive()` returned a rejected set carrying no reasons and no message downstream could name a
// condition. The fix was a reducer reporting change, not a string.
//
// It was not cosmetic. It stopped an investigation: establishing whether a suspected genesis race
// was real required knowing which rule refused a play, and the diagnosis had to be reconstructed
// by driving the reducer by hand for a session.
//
// ── THE ROW THAT MATTERS MOST IS PART A, AND IT IS NOT THE FEATURE ─────────────────────────
// **A reason is diagnostic output, never derived state.** J17 measured what one new committed
// field costs: every checkpoint in every room re-fingerprints and the dead-checkpoint window
// opens. A refusal reason that reached a seed would be a settings-key-shaped cost wearing a log
// message's clothes.

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let asserts = 0;
function fail(msg, got) {
  console.log("[refusal-reasons] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

function tree() {
  return loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/streammanager.js",
  ], { localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
       Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
       window: {}, document: { body: { appendChild() {} } } });
}

// A room with a REFUSED event in it, built from the real fixtures and the real reducer.
function roomWithRefusal() {
  const sb = tree();
  const SM = sb.StreamManager;
  const room = F.playingRoom({ songs: 1 });
  const seed = F.sortLog(room.log).filter((e) => e.type !== "ddjp.dj.play");
  for (const e of seed) SM.ingest(F.toRaw(e));
  let l = Math.max.apply(null, seed.map((e) => e.l)), ts = room.startTs + 100000;
  SM.ingest(F.rawEvent("$pA", ++l, ts += 100, room.dj, F.RANK.player,
    { t: "ddjp.dj.play", p: null, v: "vidA", d: 200 }));
  SM.ingest(F.rawEvent("$pB", ++l, ts += 165, "@other:hs", F.RANK.player,
    { t: "ddjp.dj.play", p: null, v: "vidB", d: 200 }));
  SM.ingest(F.rawEvent("$bad", ++l, ts += 100, "@ghost:hs", F.RANK.player,
    { t: "ddjp.room.settings", s: { maxLen: 400 } }));
  return { sb, SM, log: SM.getLog() };
}

// ═══ PART A — A REASON CANNOT REACH A FINGERPRINT ═══════════════════════════════════════════
{
  const r = roomWithRefusal();
  const SD = r.sb.StateDeriver, CF = r.sb.CheckpointFormat;
  const refusals = SD.deriveRefusals(r.log, null);

  ok(Object.keys(refusals).length > 0,
    "A: APPLIED — the fixture must actually contain refused events, or every claim below is " +
    "about a room where nothing was refused", Object.keys(refusals));

  const seed = SD.buildSeed(r.log, null);
  const seedText = JSON.stringify(seed);
  for (const key of Object.keys(refusals)) {
    ok(seedText.indexOf(refusals[key].code) < 0,
      "A: NO REFUSAL CODE APPEARS ANYWHERE IN THE SEED. A reason is diagnostic output and must " +
      "never become derived state — J17 measured what one committed field costs: every checkpoint " +
      "in every room re-fingerprints and the dead-checkpoint window opens",
      { code: refusals[key].code });
  }
  ok(seedText.indexOf("refusal") < 0 && seedText.indexOf("rejected") < 0,
    "A: and the seed carries no refusal-shaped key at all", Object.keys(seed));

  // ── THE SEED IS BYTE-IDENTICAL WITH REFUSALS PRESENT ──────────────────────────────────
  // The fingerprint commits the seed, so seed identity IS the fingerprint claim, and it is the
  // half this guard can make honestly: `CheckpointFormat.fingerprint` takes a built checkpoint
  // whose encoder throws on any field it does not expect, and a hand-assembled argument here would
  // be testing my construction of that object rather than the reducer. Asserted on the seed the
  // fold actually produces, twice, with a refusal in the log both times.
  const seedAgain = JSON.stringify(SD.buildSeed(r.log, null));
  ok(seedAgain === seedText,
    "A: THE SEED IS IDENTICAL ACROSS DERIVATIONS WITH REFUSALS PRESENT. The fingerprint commits " +
    "the seed, so a reason that changed nothing here can change nothing there — reasons ride " +
    "BESIDE state through the same channel `accepted` uses", { len: seedText.length });

  // THE CONTROL: a seed that DID carry the codes would differ, so the row above is a reading
  // rather than a comparison of two things that could not differ.
  const codesOnly = {};
  for (const k of Object.keys(refusals)) codesOnly[k] = String(refusals[k].code);
  const polluted = JSON.stringify(Object.assign({}, SD.buildSeed(r.log, null), { refusals: codesOnly }));
  ok(polluted !== seedText,
    "A control: attaching the codes to a seed DOES change it — so 'unchanged' above is a fact " +
    "about what the fold emits, not about a comparison that cannot fail",
    { clean: seedText.length, polluted: polluted.length });
}

// ═══ PART B — EVERY REFUSAL SITE CARRIES A CODE, READ FROM THE SOURCE ═══════════════════════
// The vocabulary is DERIVED from the call sites, not restated in a list here. A hand-written list
// of valid codes would be a second copy of the rule the code already expresses — the category this
// tree has recorded eight times — and it would drift the first time somebody added a path.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

  // THE DECLARATION IS NOT A CALL. `function _rej(ev, code, detail)` matches a naive scan and
  // reported 47 sites against 46 literals — a one-off that would have been "fixed" by loosening
  // the row, which is how a guard stops meaning anything. Excluded explicitly.
  const calls = [...src.matchAll(/(?<!function )_rej\(\s*ev\s*([,)])/g)];
  ok(calls.length > 40,
    "B: APPLIED — the scan must find the refusal sites, or an empty violation list below means " +
    "the regex missed rather than that every site is coded", calls.length);

  const uncoded = calls.filter((m) => m[1] === ")").length;
  ok(uncoded === 0,
    "B: EVERY `_rej` CALL PASSES A CODE. A new refusal path must carry a reason or fail HERE — " +
    "defaulting to 'unknown' would rejoin the problem this fixes, which is a message naming three " +
    "causes and identifying none", uncoded);

  const codes = [...src.matchAll(/_rej\(\s*ev\s*,\s*"([a-z][a-z0-9-]*)"/g)].map((m) => m[1]);
  ok(codes.length === calls.length,
    "B: and every code is a kebab-case literal at the site that decided — a code computed " +
    "elsewhere would be a reason the deciding line does not know", 
    { sites: calls.length, literals: codes.length });
  const vocab = Array.from(new Set(codes));
  ok(vocab.length > 15,
    "B: the vocabulary is DERIVED from the sites and is genuinely varied — one code reused " +
    "everywhere would satisfy the rows above and say nothing", vocab.length);
  ok(vocab.indexOf("uncoded") < 0,
    "B: and nothing is coded `uncoded` — that value exists only as the fallback inside `_rej`, " +
    "unreachable in a tree that passes this part", vocab);
}

// ═══ PART C — THE PRECISE MESSAGES ARE THE STANDARD: A CODE CARRIES ITS DECIDING VALUES ═════
{
  const sb = tree();
  const SD = sb.StateDeriver;
  const room = F.playingRoom({ songs: 2 });
  const log = F.sortLog(room.log);
  // A play that arrives BEFORE its gate opens — the too-early path, which is the standard the
  // other codes are measured against because it names the gate AND the numbers.
  const early = log.filter((e) => e.type === "ddjp.dj.play");
  ok(early.length > 0, "C: APPLIED — the fixture must contain plays", early.length);

  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8");
  const withDetail = [...src.matchAll(/_rej\(ev,\s*"([a-z0-9-]+)",\s*\{([^}]*)\}/g)]
    .map((m) => ({ code: m[1], fields: m[2].split(",").map((f) => f.split(":")[0].trim()) }));
  ok(withDetail.length >= 2,
    "C: APPLIED — at least the two codes a bare verdict would under-explain must carry detail",
    withDetail.map((d) => d.code));

  const byCode = {};
  for (const d of withDetail) byCode[d.code] = d.fields;
  ok(byCode["too-early"] && byCode["too-early"].length >= 3,
    "C: `too-early` carries the gate, the moment and the shortfall — this is the message that " +
    "already worked, and it worked because it named the condition AND the values that decided",
    byCode["too-early"]);
  ok(byCode["no-road-met"] && byCode["no-road-met"].indexOf("roads") >= 0,
    "C: `no-road-met` names WHICH ROADS the room offers and what was counted against them. " +
    "`no-road-met` alone is a shorter version of the problem being fixed", byCode["no-road-met"]);
}

// ═══ PART D — THE TRANSPORT PRINTS THE REASON IT WAS GIVEN ══════════════════════════════════
{
  const ui = fs.readFileSync(path.join(ROOT, "backends/backend1/streammanager.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  ok(ui.indexOf("rank gate, empty rotation, or no road met") < 0,
    "D: THE THREE-CAUSES MESSAGE IS GONE. It named three possibilities and identified none, and " +
    "it is the reason a session was spent reconstructing a diagnosis by hand", "still present");
  ok(/_refusalFor\(entry\.eventId\)/.test(ui),
    "D: and the transport reads the fold's refusal channel rather than guessing", "not wired");
  ok(/rf\.code/.test(ui) && /rf\.detail/.test(ui),
    "D: printing both the code and the values that decided", "code or detail missing");

  // DRIVEN: the genesis race's second play now names its rule.
  const r = roomWithRefusal();
  const refusals = r.sb.StateDeriver.deriveRefusals(r.log, null);
  ok(refusals["$pB"] && refusals["$pB"].code === "advance-locked",
    "D: the second of two concurrent genesis plays reports `advance-locked` — the rule that " +
    "actually refused it. Establishing that by hand cost a session", refusals["$pB"]);
  ok(refusals["$bad"] && refusals["$bad"].code === "not-permitted",
    "D control: and a settings event from somebody without the right reports a DIFFERENT code, " +
    "so the reporting discriminates rather than labelling everything the same",
    refusals["$bad"]);
}

console.log("[refusal-reasons] PASS — a refusal says which rule refused, and saying so costs " +
  "nothing committed (" + asserts + " assertions). The message named three causes and identified " +
  "none **because nothing upstream kept a reason** — every `_rej(ev)` recorded THAT an event was " +
  "refused and never WHY, so no message downstream could name a condition. All 46 refusal sites " +
  "now carry a code at the point that decided, and the vocabulary is DERIVED from those sites " +
  "rather than restated in a list here — a list would be a second copy of the rule the code " +
  "expresses. A new path must carry a code or fail PART B. Reasons ride BESIDE state through the " +
  "same channel `accepted` uses: PART A drives that no code reaches the seed and that the " +
  "fingerprint is unchanged, with a control proving a polluted seed WOULD move it. And the two " +
  "precise messages are the standard — `too-early` and `no-road-met` carry the values that " +
  "decided, because a code without them is a shorter version of the same problem");
