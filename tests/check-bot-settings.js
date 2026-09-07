// tests/check-bot-settings.js
// WALL: DELEGATION IS BOT POLICY, AND THE REDUCER STILL HAS EXACTLY ONE SETTINGS AUTHOR.
//
// J18's Done-when is the whole job, and it has two clauses that fail differently:
//   · a request from an unpermitted rank produces NO SETTINGS EVENT AT ALL;
//   · the reducer still accepts settings from exactly one author.
//
// ── "NO EVENT" IS STRONGER THAN "A REFUSED EVENT", AND IT IS THE CLAUSE MOST EASILY FAKED ────
// A design that sent the settings write anyway and let the reducer bounce it would pass any test
// phrased as *the setting did not change*. It would also be wrong in a way nothing reports: every
// refused write still enters the log, still takes a position, and a room whose delegation table
// does nothing would look identical to one whose table works, because every request "went
// through" and every one bounced. So PART B asserts against a RECORDING transport that the number
// of sends is ZERO — the absence of a call, not the failure of one.
//
// ── WHAT EACH PART PINS ──────────────────────────────────────────────────────────────────────
//   PART A — the decision, driven at explicit values, with an admitted sibling beside every
//     refusal so a refusal is evidence rather than a module that refuses everything.
//   PART B — THE DONE-WHEN'S FIRST CLAUSE: zero sends on refusal, one on permission.
//   PART C — THE DONE-WHEN'S SECOND CLAUSE: exactly one rank passes `room.settings`, driven
//     across the whole ladder, and the reducer accepts from that one and no other.
//   PART D — the domain is READ, not restated: a key added to `defaultSettings()` becomes
//     delegable with no edit here, and `botDelegation` and GATES acts are refused by the SAME
//     rule that refuses a typo.
//   PART E — the request event is INERT: state, seed AND fingerprint identical.
//   PART F — the reducer is untouched by this job, which the Kind field asserts and this checks.

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext } = require("./_load");
const F = require("./_fixtures");

let asserts = 0;
function fail(msg, got) {
  console.log("[bot-settings] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

// The module, loaded with a RECORDING transport. Sends are counted, never performed.
function makeBot(opts) {
  const o = opts || {};
  const sent = [];
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
    "features/botsettings.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    // The seam can be made to MOVE or to THROW, which is what turns PART A's two rows from
    // structural claims into driven ones.
    __seam: { vocabulary: o.vocabulary || null, rangesThrow: !!o.rangesThrow },
    MatrixBridge: {
      sendEvent: async (ch, type, body) => { sent.push({ ch, type, body }); if (o.sendThrows) throw new Error("boom"); },
      eventsKeyForLevel: (lvl) => "events_L" + lvl,
    },
  });
  // Wrap the REAL seam rather than replacing it, so the default path is the production one and
  // only the two controls diverge.
  const realRanges = sb.StreamManager.settingRanges;
  sb.StreamManager.settingRanges = function () {
    if (o.rangesThrow) throw new Error("seam unavailable");
    const out = realRanges.call(sb.StreamManager);
    if (o.vocabulary && out && out.botDelegation) out.botDelegation.values = o.vocabulary.slice();
    return out;
  };
  return { BotSettings: sb.BotSettings, StateDeriver: sb.StateDeriver, Ranks: sb.Ranks, sent };
}

const B = makeBot();
const D = B.StateDeriver.defaultSettings();
const NAMES = B.Ranks.NAMES;
const lvl = (n) => B.Ranks.levelOf(n);

// ═══ PART A — the decision, at explicit values ═══════════════════════════════════════════════
{
  const table = { maxLen: "staff" };
  const s = Object.assign({}, D, { botDelegation: table });

  // THE ADMITTED SIBLING FIRST, so every refusal below is evidence rather than a module that says
  // no to everything.
  const yes = B.BotSettings.decide({ k: "maxLen", v: 600 }, lvl("staff"), s);
  ok(yes.ok === true && yes.key === "maxLen" && yes.value === 600,
    "A control: a delegated setting requested by exactly the granted rank is PERMITTED — without " +
    "this the refusals below would be satisfied by a module that refuses everything", yes);
  const above = B.BotSettings.decide({ k: "maxLen", v: 600 }, lvl("owner"), s);
  ok(above.ok === true,
    "A: and a rank ABOVE the grant is permitted too — the table names a FLOOR, not an exact match",
    above);

  const below = B.BotSettings.decide({ k: "maxLen", v: 600 }, lvl("vip"), s);
  ok(below.ok === false && below.reason === "rank",
    "A: a rank BELOW the grant is refused, and the reason names the rank test rather than a " +
    "generic no", below);

  const undel = B.BotSettings.decide({ k: "minLen", v: 30 }, lvl("owner"), s);
  ok(undel.ok === false && undel.reason === "not-delegated",
    "A: a setting NOT in the table is refused even for the owner — absence is the default and it " +
    "is a refusal, so a room that has never configured delegation behaves as it did before J18",
    undel);

  const empty = B.BotSettings.decide({ k: "maxLen", v: 600 }, lvl("owner"), D);
  ok(empty.ok === false && empty.reason === "not-delegated",
    "A: and an EMPTY table delegates nothing — the shipped default is `{}`", empty);

  // TOTAL, not throwing. Anyone who can write to an events channel can put a blob on it, so a
  // policy that threw on a malformed request would make the bot's inbox a denial-of-service.
  for (const bad of [null, undefined, 42, "maxLen", {}, { k: "" }, { k: 5 }]) {
    const r = B.BotSettings.decide(bad, lvl("owner"), s);
    ok(r && r.ok === false,
      "A: a malformed request is REFUSED rather than thrown on — the request channel is writable " +
      "by anyone the room admits, so throwing here would be a denial-of-service surface",
      { sent: bad, got: r });
  }
  // ── THE VOCABULARY AND THE DOMAIN ARE READ FROM THE SEAM, DRIVEN RATHER THAN INSPECTED ────
  // These two rows exist because `mutate-j18-request` M8 and M9 survived without them, which is
  // the shape v274's build produced six times: a STRUCTURAL check on where a value comes from says
  // nothing about what happens when that source changes or fails. PART D asserts the module names
  // no literal — true of a module that restates the vocabulary in a variable, and true of one that
  // ignores a throwing seam. So both are driven through a seam that MOVES.
  {
    // A ladder with a rank name this file could not have hard-coded. If the vocabulary is read,
    // a grant naming it works; if it is restated, the grant is rejected as `bad-grant`.
    const moved = makeBot({ vocabulary: ["owner", "archduke", "guest"] });
    const withNew = Object.assign({}, D, { botDelegation: { maxLen: "archduke" } });
    const v = moved.BotSettings.decide({ k: "maxLen", v: 1 }, lvl("owner"), withNew);
    ok(v.reason !== "bad-grant",
      "A: THE RANK VOCABULARY IS READ FROM THE SEAM, not restated. Driven against a seam offering " +
      "a rank name this file could not have hard-coded: a restated list would call it `bad-grant` " +
      "and a ladder change would leave this module disagreeing with the ladder", v);
  }
  {
    // A THROWING seam. The failure direction must be CLOSED: unreadable means refuse, never allow.
    const broken = makeBot({ rangesThrow: true });
    const v = broken.BotSettings.decide({ k: "maxLen", v: 1 }, lvl("owner"),
      Object.assign({}, D, { botDelegation: { maxLen: "guest" } }));
    ok(v.ok === false && v.reason === "no-domain",
      "A: AND AN UNREADABLE DOMAIN FAILS CLOSED. If the seam throws, every request is refused — " +
      "the alternative is a backend hiccup silently delegating everything to everyone, which is " +
      "the one failure here that would not look like a failure", v);
  }

  const badGrant = B.BotSettings.decide({ k: "maxLen", v: 1 }, lvl("owner"),
    Object.assign({}, D, { botDelegation: { maxLen: "archduke" } }));
  ok(badGrant.ok === false && badGrant.reason === "bad-grant",
    "A: a table naming a rank that does not exist refuses rather than admitting everyone — the " +
    "failure direction of an unreadable grant is CLOSED", badGrant);
}

// ── PARTS B ONWARDS RUN INSIDE AN ASYNC MAIN, AND A REJECTION BECOMES A FAIL LINE ───────────
// `authorIfPermitted` is async, so PART B has to await it. The first version used a synchronous
// busy-wait to keep the whole file sync, which cannot work — the event loop cannot advance while a
// loop spins — and it produced "an awaited call did not settle". The fix is a real async main
// whose rejection is CAUGHT and reported through `fail()`: an unhandled rejection would be red by
// crash, which `08-build-and-deploy.md` says is not red enough, because node reports it in a
// different shape from a failed assertion and the runner would judge it on the exit code alone.
async function main() {
// ═══ PART B — THE DONE-WHEN'S FIRST CLAUSE: NO EVENT AT ALL ══════════════════════════════════
{
  const s = Object.assign({}, D, { botDelegation: { maxLen: "staff" } });

  // The permitted case FIRST: the writer must be reachable, or "zero sends" below is true of a
  // module that can never send at all.
  const wrote = [];
  const okv = await (B.BotSettings.authorIfPermitted({ k: "maxLen", v: 600 }, lvl("staff"), s,
    async (partial) => { wrote.push(partial); }));
  ok(okv.ok === true && wrote.length === 1,
    "B: APPLIED — a PERMITTED request authors exactly one settings write. Without this, the zero " +
    "below would be a claim about a module with no path to the transport at all", wrote);
  ok(JSON.stringify(wrote[0]) === JSON.stringify({ maxLen: 600 }),
    "B: carrying the requested key and value, so the bot authors what was asked for", wrote[0]);

  // AND THE CLAUSE ITSELF.
  for (const [why, req, level] of [
    ["an unpermitted RANK", { k: "maxLen", v: 600 }, lvl("vip")],
    ["an UNDELEGATED setting", { k: "minLen", v: 30 }, lvl("owner")],
    ["a setting that is NOT a setting", { k: "room.upgrade", v: 1 }, lvl("owner")],
    ["the delegation table ITSELF", { k: "botDelegation", v: { maxLen: "guest" } }, lvl("owner")],
    ["a malformed request", { nope: 1 }, lvl("owner")],
  ]) {
    const calls = [];
    const v = await B.BotSettings.authorIfPermitted(req, level, s, async (p) => { calls.push(p); });
    ok(v.ok === false,
      "B: " + why + " is refused", v);
    ok(calls.length === 0,
      "B: AND NOTHING IS AUTHORED — " + why + " produces ZERO settings writes, not a write the " +
      "reducer then bounces. A refused event would still enter the log and still take a position, " +
      "and a delegation table doing nothing would look exactly like one that works", calls);
  }

  // And nothing reached the transport in any of it.
  ok(B.sent.length === 0,
    "B: and the decision path never touches the transport at all — `decide` is asked BEFORE " +
    "anything is sent, which is what makes 'no event' a property of the structure rather than of " +
    "a well-behaved caller", B.sent);
}

// ═══ PART C — THE DONE-WHEN'S SECOND CLAUSE: EXACTLY ONE AUTHOR ══════════════════════════════
{
  const passes = NAMES.filter((n) => B.Ranks.permits(lvl(n), "room.settings"));
  ok(passes.length === 1,
    "C: EXACTLY ONE rank name may author settings, driven across the whole ladder rather than " +
    "asserted for one rung", passes);
  ok(NAMES.length >= 6,
    "C: APPLIED — the ladder must have several rungs, or 'exactly one' is trivially true",
    NAMES.length);

  // AND THE REDUCER AGREES, driven through the fold rather than read off the gate table.
  const sb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js",
  ], { localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
       Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
       window: {}, document: { body: { appendChild() {} } } });
  const room = F.playingRoom({ songs: 2 });
  for (const e of F.sortLog(room.log)) sb.StreamManager.ingest(F.toRaw(e));
  let l = room.lastL, ts = room.startTs + 500000;
  const accepted = [];
  for (const n of NAMES) {
    const id = "$set_" + n;
    sb.StreamManager.ingest(F.rawEvent(id, ++l, ts += 1000, "@" + n + ":hs", F.RANK[camel(n)],
      { t: "ddjp.room.settings", s: { maxLen: 400 + lvl(n) } }));
    if (sb.StreamManager.isLegal(id)) accepted.push(n);
  }
  ok(accepted.length === 1 && accepted[0] === passes[0],
    "C: AND THE REDUCER ACCEPTS FROM THAT ONE AND NO OTHER, driven end to end through the ingest " +
    "door: a settings event stamped at every rung of the ladder, and exactly one survives. The " +
    "rank comes from the CHANNEL ORIGIN, so this is a property of routing rather than of a claim " +
    "in the payload", { accepted, gate: passes });
  ok(sb.StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings").length === NAMES.length,
    "C control: all of them reached the LOG — so the six that did not apply were REFUSED by the " +
    "reducer rather than lost before it, which is what makes PART B's 'no event' a different and " +
    "stronger claim", sb.StreamManager.getLog().filter((e) => e.type === "ddjp.room.settings").length);
}

// ═══ PART D — THE DOMAIN IS READ, NOT RESTATED ═══════════════════════════════════════════════
{
  const src = fs.readFileSync(path.join(ROOT, "features/botsettings.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  const keys = Object.keys(D);
  const named = keys.filter((k) => new RegExp('"' + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"').test(src));
  ok(named.length === 0,
    "D: the module names NO settings key as a literal. A hand-listed domain would lose all three " +
    "properties J17 built into the derived one, and would lose them silently", named);
  ok(!/\bRanks\b/.test(src),
    "D: and it names no rank literal and no `Ranks` — rank comparison goes through " +
    "`Capabilities.atLeast`, by NAME, so a ladder change cannot leave a number here disagreeing " +
    "with it (rule H, and `check-boundaries` caught the first version reaching for `Ranks.levelOf`)",
    "names Ranks");

  // A SETTING ADDED LATER IS DELEGABLE WITH NO EDIT HERE — driven, not argued.
  const dom = B.StateDeriver.SETTING_RANGES.botDelegation.keys();
  ok(dom.length === keys.length - 1,
    "D: APPLIED — the derived domain must be the key set minus itself", { dom: dom.length, keys: keys.length });
  let anyDelegable = 0;
  for (const k of dom) {
    const v = B.BotSettings.decide({ k: k, v: 1 }, lvl("owner"),
      Object.assign({}, D, { botDelegation: { [k]: "guest" } }));
    if (v.ok) anyDelegable++;
  }
  ok(anyDelegable === dom.length,
    "D: EVERY key in the derived domain is delegable through this module — so a setting added to " +
    "`defaultSettings()` tomorrow is delegable the day it is added, with no edit here", 
    { delegable: anyDelegable, domain: dom.length });

  // AND THE TWO REFUSALS THAT ARE THE SAME REFUSAL.
  const selfRef = B.BotSettings.decide({ k: "botDelegation", v: {} }, lvl("owner"),
    Object.assign({}, D, { botDelegation: { botDelegation: "guest" } }));
  ok(selfRef.ok === false && selfRef.reason === "not-a-setting",
    "D: `botDelegation` is refused as NOT A SETTING — the same reason a typo gets, because it is " +
    "not in the derived domain. No special case here, and therefore no special case to forget",
    selfRef);
  const gates = Object.keys(B.Ranks.GATES);
  ok(gates.length > 5 && gates.indexOf("room.upgrade") >= 0,
    "D: APPLIED — the GATES vocabulary must be readable and contain the act being tested", gates.length);
  const overlap = gates.filter((g) => keys.indexOf(g) >= 0);
  ok(overlap.length === 0,
    "D: the two vocabularies are DISJOINT — no `Ranks.GATES` act is a settings key", overlap);
  for (const g of gates) {
    const v = B.BotSettings.decide({ k: g, v: 1 }, lvl("owner"),
      Object.assign({}, D, { botDelegation: { maxLen: "guest" } }));
    ok(v.ok === false && v.reason === "not-a-setting",
      "D: and EVERY GATES act is refused by that same rule — a request surface that blurred " +
      "settings keys and capability acts is the defect this job was most likely to introduce, and " +
      "it is avoided by having no second list to blur", { act: g, got: v });
  }
}

// ═══ PART E — THE REQUEST IS INERT: state, seed AND fingerprint ══════════════════════════════
{
  function build(withRequests) {
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
    let l = room.lastL, ts = room.startTs + 600000, n = 0;
    for (const e of log) sb.StreamManager.ingest(F.toRaw(e));
    if (withRequests) {
      for (const who of ["player", "vip", "staff"]) {
        sb.StreamManager.ingest(F.rawEvent("$req_" + who, ++l, ts += 1000, "@" + who + ":hs",
          F.RANK[camel(who)], { t: "ddjp.bot.request", k: "maxLen", v: 600 + (n++) }));
      }
    }
    const held = sb.StreamManager.getLog();
    const seed = sb.StateDeriver.buildSeed(held);
    return { sb, held, seed,
             fp: sb.CheckpointFormat.fingerprint(1, null, seed, 10, false, "$a..$b"),
             state: sb.StreamManager.getState() };
  }
  const clean = build(false), dirty = build(true);
  ok(dirty.held.filter((e) => e.type === "ddjp.bot.request").length === 3,
    "E: APPLIED — the requests must have reached the LOG, or inertness below is a claim about " +
    "events that were never there",
    dirty.held.filter((e) => e.type === "ddjp.bot.request").length);
  ok(JSON.stringify(clean.state) === JSON.stringify(dirty.state),
    "E: derived STATE is identical with and without the requests", "state differs");
  ok(JSON.stringify(clean.seed) === JSON.stringify(dirty.seed),
    "E: and so is the checkpoint SEED — the broad inertness `check-reducer-ignore` requires. An " +
    "event that left state identical and moved the seed would stop two honest clients verifying " +
    "each other's floors, with every correctness assertion still green", "seed differs");
  ok(clean.fp === dirty.fp,
    "E: and therefore the FINGERPRINT, which is the artefact a quorum actually compares",
    { clean: clean.fp.slice(0, 12), dirty: dirty.fp.slice(0, 12) });
}

// ═══ PART F — THE REDUCER IS UNTOUCHED ═══════════════════════════════════════════════════════
// J18's Kind is `new-module`, deliberately NOT `derivation`: if this job changed the reducer, the
// design went wrong. Asserted against the file rather than against the entry's description of it.
{
  const sd = fs.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8");
  ok(!/ddjp\.bot\.request/.test(sd),
    "F: the reducer has never heard of the request type, and must not learn it. A branch here " +
    "would make delegation reducer policy again, which is the design this job replaced", "names it");
  ok(!/botDelegation/.test(sd.split("\n").filter((l) => /applySettingsEvent|_delegationMap/.test(l)).join("\n")) === false,
    "F: APPLIED — the reducer does still fold `botDelegation` itself (J17), so 'untouched by J18' " +
    "is a claim about this job rather than about the key", "fold missing");
  const settingsBranch = sd.match(/} else if \(ev\.type === "ddjp\.room\.settings"\)[\s\S]{0,900}/);
  ok(!!settingsBranch, "F: APPLIED — the settings branch must be findable");
  ok(/Ranks\.permits\(rank, "room\.settings"\)/.test(settingsBranch[0]),
    "F: and it still gates on ONE act with the rank stamped by channel origin — unchanged by this " +
    "job, which is what keeps 'exactly one author' true", "gate changed");
}

function camel(n) { return n === "high-staff" ? "highStaff" : n; }
  console.log("[bot-settings] PASS — delegation is BOT POLICY and the reducer still has exactly one " +
  "settings author (J18, " + asserts + " assertions). THE DONE-WHEN'S FIRST CLAUSE IS THE STRONG " +
  "ONE and is asserted as an ABSENCE: an unpermitted request produces ZERO settings writes, not a " +
  "write the reducer bounces — driven against a recording writer, with the permitted case beside " +
  "it so the zero is not a claim about a module that can never send. A refused settings event " +
  "would still enter the log and take a position, and a delegation table doing nothing would look " +
  "exactly like one that works. THE SECOND CLAUSE is driven across the whole ladder AND through " +
  "the ingest door: exactly one rank name passes `room.settings`, a settings event stamped at " +
  "every rung reaches the log, and exactly one survives the fold — so 'one author' is a property " +
  "of channel origin rather than of a payload claim. THE DOMAIN IS READ, NEVER RESTATED: the " +
  "module names no settings key, no rank literal and no `Ranks`, every key in the derived domain " +
  "is delegable so a setting added tomorrow needs no edit here, and `botDelegation` itself and " +
  "EVERY `Ranks.GATES` act are refused by the SAME rule that refuses a typo — the blurring of " +
  "those two vocabularies is the defect this job was most likely to introduce and there is no " +
  "second list to blur. The request event is INERT in state, SEED and FINGERPRINT, and the " +
  "reducer never learns its type");
}

main().catch((e) => fail("an async part rejected — " + (e && e.message)));
