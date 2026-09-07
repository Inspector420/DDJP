// tests/check-genesis-settings.js
//
// A ROOM STATES ITS OWN RULES.
//
// Every setting decision in this system is judged at log position — which works only if there IS
// something in the log to judge against. A room that never posted its settings had none, so the
// proof path fell back to comparing a claim against the reducer's built-in DEFAULTS.
//
// That was the one assertion in DDJP checked against the application rather than against the log,
// and its failure was silent by construction: two builds shipping different defaults would each
// validate their own idea of "default", agree with themselves, and report nothing. No exception, no
// mismatch, no divergence anyone could see — until two clients computed different rooms.
//
// So the owner now posts the complete settings blob at creation, and the defaults comparison is
// DELETED rather than merely unused. This guard pins both halves.
//
// WHAT IS AND IS NOT EXERCISED HERE. features/room.js cannot be loaded headlessly (it needs
// MatrixBridge and a live Matrix client), so the CALL is checked statically, the way
// check-settings-passthrough and check-write-channel check theirs. A static check can only prove a
// string is present — this file's history is full of that trap — so everything that CAN be executed
// is executed instead: the blob the call would send is built for real and checked against the
// reducer's own completeness rule, and the deleted helper is asserted gone by lookup rather than by
// grep. The static part is confined to "is it called, and is it called before the room goes live",
// which is the only part no headless test can reach.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

function code(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  return src.split("\n").filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
}

// ── PART A — the blob a genesis write would carry is COMPLETE (executed) ─────────────────────
// The point of posting at creation is to leave real evidence. A blob missing keys is evidence of
// nothing: the reducer's own settingsBlobComplete is what a verifier applies, so that is the bar.
{
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js",
  ], {});

  const blob = sb.StreamManager.defaultSettings();

  ok(blob && typeof blob === "object" && Object.keys(blob).length > 0,
    "A: the interface door returns a settings blob at all", blob);

  ok(sb.StateDeriver.settingsBlobComplete(blob) === true,
    "A: APPLIED — and it satisfies the reducer's OWN completeness rule, so the genesis event is "
    + "evidence rather than a partial write that a later fold would have to guess at", blob);

  // The door exists because features/ may not reach StateDeriver (check-boundaries rule F). If it
  // ever returned a SHARED object, one caller mutating it would silently re-write every room's
  // idea of default — the same class of bug as a hand-copied literal, one indirection further away.
  const a = sb.StreamManager.defaultSettings();
  a.maxLen = 123456;
  ok(sb.StreamManager.defaultSettings().maxLen !== 123456,
    "A: APPLIED — and each call returns a FRESH object, so no caller can mutate the reducer's "
    + "defaults out from under everyone else");

  // Guards the door itself, not just its output: a door that answered from its own literal would
  // pass every check above while drifting from the reducer the moment a dial was added.
  ok(JSON.stringify(sb.StreamManager.defaultSettings()) === JSON.stringify(sb.StateDeriver.defaultSettings()),
    "A: APPLIED — and the door PASSES THROUGH the reducer's defaults rather than restating them, "
    + "so a new dial cannot appear in one and not the other");

  // AND THE BLOB THAT ACTUALLY GOES OUT IS THOSE DEFAULTS. create() writes through setSettings,
  // which MERGES the partial onto the current blob — so what is sent is a merge result, not the
  // argument. Passing the complete defaults as the partial is what makes the two identical
  // regardless of what derived state happens to hold at that instant, including the defensive
  // empty-object branch in getSettings(). Reproduced here rather than reasoned about, because
  // "the argument is right" and "the event carries it" are different claims and only the second
  // one is the room's rules.
  {
    const partial = sb.StreamManager.defaultSettings();
    const merge = (cur) => {
      const next = Object.assign({}, cur, partial);
      if (Object.prototype.hasOwnProperty.call(partial, "bg")) {
        next.bg = (typeof partial.bg === "string" && partial.bg) ? partial.bg : null;
      }
      return next;
    };
    const D = sb.StateDeriver.defaultSettings();
    const same = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]))
                     === JSON.stringify(Object.keys(D).sort().map((k) => [k, D[k]]));
    ok(same(merge(sb.StreamManager.getState().settings)),
      "A: APPLIED — merged onto seeded derived state, the genesis event carries exactly the "
      + "reducer's defaults");
    ok(same(merge({})),
      "A: APPLIED — and merged onto nothing at all it still carries exactly the reducer's "
      + "defaults, so the event does not depend on derived state having been seeded yet");
  }
}

// ── PART B — the code-defaults comparison is gone, not idle (executed) ───────────────────────
// Deleting the branch but leaving the helper exported would be worse than useless: it reads as a
// supported way to answer the question cheaply, and the next caller who wants a cheap answer will
// find it. Absence is the assertion.
{
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/settingsproof.js",
  ], {});

  ok(typeof sb.StateDeriver.settingsAreDefaults === "undefined",
    "B: settingsAreDefaults is DELETED from the reducer's exports, not merely unreferenced");

  // And the proof path now refuses rather than falling back — including in the flattering case
  // where the claimed values really are the defaults. Matching the code is not evidence.
  const v = sb.SettingsProof.proveClaim({
    claimed: sb.StateDeriver.defaultSettings(), settingsFrom: null, atL: 5,
  });
  ok(v.status === "unverifiable",
    "B: APPLIED — a claim naming NO settings event is unverifiable even when its values equal the "
    + "built-in defaults", v);

  ok(sb.SettingsProof.licensesForget() === false,
    "B: APPLIED — and the consequence is the FORGET LICENCE withheld. Dropping history on a claim "
    + "nothing can check is the loop where forgetting destroys the evidence that licensed it");
}

// ── PART C — creation actually posts it, before the room goes live (static) ──────────────────
// The part no headless test can reach. Kept deliberately narrow: presence, and ORDER.
{
  const room = code("features/room.js");

  const i = room.indexOf("function create");
  ok(i >= 0, "C: features/room.js still has a create path to check");
  // The create body runs to the next top-level function; bounding the scan keeps a match in some
  // other function from standing in for this one — which is exactly how a textual guard lies.
  const after = room.slice(i);
  const end = after.indexOf("\n  function ", 10);
  const createBody = end > 0 ? after.slice(0, end) : after;

  ok(/sendEvent\([^)]*"ddjp\.room\.settings"[\s\S]{0,80}StreamManager\.defaultSettings\(\)/.test(createBody),
    "C: create() posts the genesis settings, carrying the reducer's own defaults object verbatim "
    + "so there is no key list that can drift from the reducer");

  // NOT through setSettings, and that is the assertion. setSettings gates on getMyRank, which reads
  // POWER LEVELS OUT OF SYNCED ROOM STATE — and nothing in create() waits for that state to arrive
  // after the rooms are made. On a slow connection the lookup answers "uncategorized", setSettings
  // logs a warning and returns, and the room is left permanently without its own rules. A race that
  // fails SILENTLY, on the one write this whole change exists to make. The client-side rank check is
  // not the real one anyway: the homeserver enforces the power level on settings_owner.
  ok(!/setSettings\(\s*StreamManager\.defaultSettings/.test(createBody),
    "C: APPLIED — and NOT through setSettings, whose owner check depends on room state that may "
    + "not have synced yet at this exact moment");

  const iPost = createBody.search(/sendEvent\([^)]*"ddjp\.room\.settings"/);
  const iLive = createBody.indexOf("_startModules(");
  ok(iPost >= 0 && iLive >= 0 && iPost < iLive,
    "C: APPLIED — and it is posted BEFORE _startModules(), so the room's rules are in the log "
    + "before anything can act under them", { postAt: iPost, liveAt: iLive });

  // The failure this leaves behind must stay loud. Channels already exist by this point, so
  // throwing would orphan a real room; the accepted cost is a room that cannot forget until an
  // owner touches a setting once. That is a decision, and a decision nobody can see is a bug.
  ok(/Logger\.error\([^)]*genesis settings NOT posted/.test(room),
    "C: APPLIED — and a failure to post is logged at ERROR, never swallowed. A room silently "
    + "missing its own rules is the exact absence this whole change exists to remove");
}

console.log("[genesis-settings] PASS — a room states its own rules rather than inheriting them "
  + "from whichever build happens to be running: the blob posted at creation satisfies the "
  + "reducer's own completeness rule and is passed through from the reducer rather than restated, "
  + "the code-defaults comparison is deleted rather than left exported for the next caller who "
  + "wants a cheap answer, a claim naming no event is unverifiable even when its values flatter "
  + "the defaults, and the write happens before the room goes live with a failure that is logged "
  + "rather than swallowed (" + checks + " assertions)");
