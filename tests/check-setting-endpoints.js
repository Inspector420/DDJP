// tests/check-setting-endpoints.js
// EVERY SETTING RANGE IS INCLUSIVE AT BOTH ENDS, AND THE SUITE SAYS SO.
//
// Found by the J39 comparison sweep, and it was one finding wearing about ten survivor rows.
// `_inRange` is a single predicate — `v >= r.min && v <= r.max` — governing every numeric setting
// in the room. Flipping `>=` to `>` there makes every setting at exactly its minimum illegal, and
// the guard suite as shipped noticed NOTHING. The same shape survived at every hand-written range
// beside it: `skipRoads.length >= 1 && <= 8`, the two `>= 0 && <= 200` gates, `e <= 50`, `c.n >= 0`,
// and the MAX_ID / MAX_URL length limits.
//
// **THE ENDPOINTS ARE NOT AN EDGE CASE HERE, THEY ARE THE ORDINARY PATH.** The settings panel
// renders each dial across `min..max`, so an owner choosing exactly 5 for `minLen` is doing the
// obvious thing with the leftmost value offered. Under the flip the WHOLE blob is refused — the
// merge is all-or-nothing — and refused silently, which is 09-roadmap.md's recorded silent-refusal
// gap arriving through a boundary nobody tested.
//
// DERIVED, NOT RESTATED. The key list comes from `SETTING_RANGES` itself, so a setting added later
// is covered the day it is added rather than the day somebody remembers this file. PART C fails if
// the derivation ever reaches fewer keys than the reducer declares.
//
// ── WHY A PAIR-AWARE GUARD RATHER THAN TEN LITTLE ONES ───────────────────────────────────────
// Two settings are validated in PAIRS after their individual range checks, so a blob that sets one
// alone to an endpoint can be refused for a reason that has nothing to do with its range:
//   · `maxLen >= minLen`
//   · `minGate >= (LADDER.length * vouchJitter) + floor(vouchJitter / 2)`   — the turn ladder
// A guard that ignored this would fail for the wrong reason and get "fixed" by loosening it. So
// each endpoint is driven with its partner set to make the pair legal, and PART B then pins the
// pair boundaries themselves — which is where row 1167 lives, the one on J10's path.

// ── WHAT THIS GUARD DOES NOT COVER, ESTABLISHED BY MUTATION RATHER THAN BY GUESSING ──────────
// Driven: flipping `s.skipRoads.length >= 1` to `> 1` leaves this guard GREEN. That is not a hole
// in the guard, it is the shape of the decision — this file derives its key list from
// SETTING_RANGES, and `skipRoads`, the two `>= 0 && <= 200` gates, `e <= 50`, `c.n >= 0` and the
// MAX_ID / MAX_URL limits are ranges HAND-WRITTEN at their use sites, reachable by no derivation.
//
// **The fix for those is not a second guard restating them.** It is to fold them into
// SETTING_RANGES so this derivation reaches them, which is app-code work and therefore a job
// rather than an edit. Until then this file's coverage is exactly the derived population, and that
// sentence is here so nobody reads a green as covering the hand-written ones.

// ── TWO KINDS OF ENTRY, AND NEITHER IS EXEMPT (J07) ───────────────────────────────────────────
// `SETTING_RANGES` grew a second kind of entry when the min-DJ-rank bar landed: a rank is a STRING,
// so its validation is a MEMBERSHIP test against `Ranks.NAMES` rather than a numeric comparison.
// Its entry declares `values` instead of `min`/`max`.
//
// The endpoint test for a numeric range does not apply to it — there is no `min - 1` — so this file
// PARTITIONS the derived key list by kind and drives each kind through the test that fits:
//   · `range`  → both endpoints accepted, one step outside refused (four assertions, as before)
//   · `values` → EVERY declared value accepted, and a non-member refused
// The kind is read from `StateDeriver.settingKindOf`, the reducer's own answer, so this guard cannot
// invent a classification the fold disagrees with.
//
// **THE PARTITION IS NOT AN EXEMPTION, AND THE DIFFERENCE IS THE WHOLE POINT.** Writing
// `if (key === "minDjRank") continue;` would have turned this file green in one line and left the
// new key validated by nothing — 09-roadmap.md §8's *turning a red guard green by weakening what is
// under test*, which is listed there as one of the two failure modes to watch for in yourself. PART
// C therefore accounts for EVERY key in the table across both kinds and fails if the two populations
// do not add up to it, so a third kind added later cannot slip through as neither.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));

const sb = loadInContext([
  "core/logger.js",
  "backends/backend1/ranks.js",
  "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js",
  "backends/backend1/statederiver.js",
  // PART C3 drives the SEAM the panel reads bounds through, so the real `StreamManager` is loaded
  // rather than its behaviour restated — the copy-and-resolve rule lives there, not here.
  "backends/backend1/streammanager.js",
], { Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
     localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
     window: {}, document: { body: { appendChild() {} } } });
const { StateDeriver, Ranks, StreamManager: SM } = sb;
const RANGES = StateDeriver.SETTING_RANGES;
const D = StateDeriver.defaultSettings();

let failed = 0;
function ok(cond, msg, got) {
  if (cond) return;
  failed++;
  console.log("[setting-endpoints] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const ladderFor = (jitter) => (Ranks.LADDER.length * jitter) + Math.floor(jitter / 2);
const apply = (blob) => StateDeriver.applySettingsEvent(D, blob);

// A blob that moves `key` to `v` while keeping any pair it belongs to satisfiable.
function blobFor(key, v) {
  const b = {};
  b[key] = v;
  if (key === "minLen") b.maxLen = Math.max(D.maxLen, v);
  if (key === "maxLen") b.minLen = Math.min(D.minLen, v);
  if (key === "vouchJitter") b.minGate = Math.min(RANGES.minGate.max, ladderFor(v));
  if (key === "minGate") b.vouchJitter = RANGES.vouchJitter.min;   // cheapest legal ladder
  return b;
}

// ── PART A — both endpoints ACCEPTED, and one step outside REFUSED ────────────────────────────
// Accepted means the value is present in the merged settings. Refused means the merge left the
// prior value standing — the reducer's all-or-nothing behaviour, asserted rather than assumed.
const keys = Object.keys(RANGES);
const kindOf = (k) => StateDeriver.settingKindOf(k);
const rangeKeys = keys.filter((k) => kindOf(k) === "range");
const valueKeys = keys.filter((k) => kindOf(k) === "values");
// THE THIRD KIND (J17). `botDelegation` is a MAP — a derived key domain plus a value vocabulary —
// and is neither a numeric range nor a value set. This guard is what noticed it: PART C's
// partition went red the moment the kind existed, which is the partition doing its job rather
// than an obstacle. It is TAUGHT the kind rather than loosened: the partition below still demands
// that every key fall into exactly one of the three, so a FOURTH kind fails here in turn.
const mapKeys = keys.filter((k) => kindOf(k) === "map");
// FLAG MAPS are a fourth kind (v322): a map whose values are booleans rather than names from a
// vocabulary, so `_isValidMap` cannot validate them and `_isValidFlagMap` does. They are counted
// into the partition below rather than exempted — a kind left out of the partition is a key
// validated by nothing, which is exactly what PART C exists to refuse.
const flagKeys = keys.filter((k) => kindOf(k) === "flags");
let checkedEndpoints = 0;
for (const key of rangeKeys) {
  const r = RANGES[key];

  // `minGate`'s declared minimum is 0 and the reducer can NEVER accept it: the cheapest legal
  // ladder (vouchJitter at its own minimum) already costs more than 0, so the pair rule refuses
  // it whatever the range says. That is a property of the pair, not a bug in either, and it is
  // recorded here so nobody "completes" this guard by asserting an impossible value. PART B pins
  // the boundary that IS reachable for this key.
  const lowReachable = (key === "minGate") ? ladderFor(RANGES.vouchJitter.min) : r.min;

  const atLow = apply(blobFor(key, lowReachable));
  ok(atLow[key] === lowReachable,
    "A: `" + key + "` at its lowest reachable value (" + lowReachable + ") must be ACCEPTED — the "
    + "panel offers it, so refusing it refuses the obvious choice, and the whole blob goes with it",
    { got: atLow[key] });

  const atHigh = apply(blobFor(key, r.max));
  ok(atHigh[key] === r.max,
    "A: `" + key + "` at its declared maximum (" + r.max + ") must be ACCEPTED", { got: atHigh[key] });

  const below = apply(blobFor(key, lowReachable - 1));
  ok(below[key] !== lowReachable - 1,
    "A: `" + key + "` one below its floor (" + (lowReachable - 1) + ") must be REFUSED — an "
    + "inclusive bound that also admits the value outside it is not a bound", { got: below[key] });

  const above = apply(blobFor(key, r.max + 1));
  ok(above[key] !== r.max + 1,
    "A: `" + key + "` one above its ceiling (" + (r.max + 1) + ") must be REFUSED", { got: above[key] });

  checkedEndpoints += 4;
}

// ── PART A2 — the MEMBERSHIP kind: every declared value in, anything else out ─────────────────
// The endpoint idiom for a value set is "every member is admitted, a non-member is not". Both
// halves are needed and for the reasons §8 gives: a refusal is evidence only if something adjacent
// was admitted, so the accept loop is this refusal's control — without it a merge that refused
// EVERYTHING would pass the reject assertion for free.
//
// The non-member probes vary the axis three ways, because each fails through a different branch:
// an unknown NAME, a power LEVEL (the wrong spelling of a real rank, which is the mistake a caller
// familiar with Matrix would actually make), and a non-string.
let checkedValues = 0;
for (const key of valueKeys) {
  const values = RANGES[key].values;
  ok(Array.isArray(values) && values.length >= 2,
    "A2: `" + key + "` must declare a value set with something to choose between", values);

  for (const v of values) {
    const got = apply(blobFor(key, v));
    ok(got[key] === v,
      "A2: `" + key + "` must ACCEPT every value it declares — the panel renders one control per "
      + "entry in this list, so a declared value the merge refuses is a control that does nothing",
      { value: v, got: got[key] });
    checkedValues++;
  }

  // The value set is DERIVED (from Ranks.NAMES today), so a non-member cannot be written here as a
  // literal without risking it becoming a member later. Build one that provably is not in the set.
  const alien = values.join("") + "-nope";
  ok(values.indexOf(alien) < 0, "A2: the constructed non-member must really not be a member", alien);
  const refusedName = apply(blobFor(key, alien));
  ok(refusedName[key] !== alien,
    "A2: `" + key + "` must REFUSE a value outside its declared set — a membership test that admits "
    + "a non-member is not a test, and this value reaches a checkpoint seed the fingerprint commits",
    { got: refusedName[key] });

  // A LEVEL rather than a NAME. `minDjRank` is a rank, and a rank is a name here; accepting the
  // number would put two spellings of one bar on the wire and make two rooms that agree compare
  // unequal through _canonSettings.
  const refusedNum = apply(blobFor(key, Ranks.levelOf(values[values.length - 1])));
  ok(typeof refusedNum[key] === "string" && values.indexOf(refusedNum[key]) >= 0,
    "A2: `" + key + "` must keep a legal NAME when handed a power LEVEL, rather than storing the "
    + "number — two spellings of one value is what _canonSettings cannot compare", { got: refusedNum[key] });

  const refusedNull = apply(blobFor(key, null));
  ok(typeof refusedNull[key] === "string" && values.indexOf(refusedNull[key]) >= 0,
    "A2: `" + key + "` must be TOTAL — a null keeps the current value like every other setting",
    { got: refusedNull[key] });
  checkedValues += 3;
}

// ── PART B — the PAIR boundaries, which are inclusive too ─────────────────────────────────────
// Row 1167 is `_minGate >= ladderMs`. J10 wants vouchJitter near 5000, which needs minGate at
// EXACTLY the ladder cost; `>` refuses precisely that value, so the flip closes the path J10 has
// to walk. Row 1147 is `_maxLen >= _minLen`, where a room setting both to one number is coherent.
{
  const j = RANGES.vouchJitter.max;
  const need = ladderFor(j);
  const exact = apply({ vouchJitter: j, minGate: need });
  ok(exact.vouchJitter === j && exact.minGate === need,
    "B: `minGate` EXACTLY equal to the ladder cost must be accepted — this is the value J10's own "
    + "target requires, so an exclusive comparison here closes the path the plan has to walk",
    { minGate: exact.minGate, vouchJitter: exact.vouchJitter });

  const short = apply({ vouchJitter: j, minGate: need - 1 });
  ok(short.minGate !== need - 1,
    "B: one below the ladder cost must be refused, or the pair rule is not a rule", { got: short.minGate });

  const eq = apply({ minLen: 15, maxLen: 15 });
  ok(eq.minLen === 15 && eq.maxLen === 15,
    "B: `maxLen` EQUAL to `minLen` must be accepted — a room pinning both to one number is coherent "
    + "and sits exactly on the comparison", { minLen: eq.minLen, maxLen: eq.maxLen });

  const inverted = apply({ minLen: 16, maxLen: 15 });
  ok(inverted.minLen !== 16,
    "B: `maxLen` below `minLen` must be refused", { got: inverted.minLen });
}

// ── PART C — the derivation reached everything, across BOTH kinds ─────────────────────────────
ok(keys.length >= 10,
  "C: the scan must reach every declared setting range — a derivation that finds fewer keys than "
  + "the reducer declares reports a clean sweep of a subset", { found: keys.length });
// EVERY key must fall into exactly one kind. This is what makes the partition above a partition
// rather than an exemption: a key the reducer classifies as neither is unvalidated by anything, and
// would otherwise simply be absent from both loops with nothing saying so.
ok(rangeKeys.length + valueKeys.length + mapKeys.length + flagKeys.length === keys.length,
  "C: every key in SETTING_RANGES must be classified as `range`, `values`, `map` or `flags` — a key in none is "
  + "validated by nothing and would vanish from both loops silently",
  { keys: keys.length, range: rangeKeys.length, values: valueKeys.length, map: mapKeys.length,
    unclassified: keys.filter((k) => !kindOf(k)) });
ok(rangeKeys.length >= 10, "C: the numeric population must not have quietly emptied", { range: rangeKeys.length });

// ── PART C2 — THE MAP KIND, DRIVEN (J17) ──────────────────────────────────────────────────────
// A kind added to the partition and then never exercised would be an exemption with a name. Both
// halves of a map entry are DERIVED — the key domain from `defaultSettings()`, the vocabulary from
// `Ranks.NAMES` — which is the property that makes the self-exclusion structural, so both are
// checked against their sources rather than against a list restated here.
for (const key of mapKeys) {
  const r = RANGES[key];
  ok(typeof r.keys === "function",
    "C2: `" + key + "` declares its key domain as a FUNCTION, not an array — an array would freeze "
    + "the domain at module-construction time, before `defaultSettings` has its later keys, so a "
    + "key added afterwards would silently never be delegable", typeof r.keys);
  const domain = r.keys();
  const defaults = Object.keys(StateDeriver.defaultSettings());
  ok(domain.length > 0, "C2: APPLIED — `" + key + "`'s domain must be non-empty, or every row "
    + "below asserts over nothing", domain.length);
  const stray = domain.filter((k) => defaults.indexOf(k) < 0);
  ok(stray.length === 0,
    "C2: every key in `" + key + "`'s domain is a real setting — the domain is DERIVED from "
    + "`defaultSettings()`, so a name here that the reducer does not define would be a second "
    + "vocabulary free to drift", stray);
  ok(domain.indexOf(key) < 0,
    "C2: AND `" + key + "` IS NOT IN ITS OWN DOMAIN. A rank permitted to change the delegation "
    + "table could grant itself every other setting in one subsequent write, so the table cannot "
    + "name itself. Structural rather than a threshold: the domain is derived, so there is no list "
    + "anybody could add it back to", domain);
  ok(domain.length === defaults.length - 1,
    "C2: and it excludes EXACTLY itself — a domain shorter than that would be quietly dropping "
    + "other keys from delegation, which is a policy decision rather than a structural one",
    { domain: domain.length, defaults: defaults.length });
  ok(Array.isArray(r.values) && r.values.length > 0 && r.values === Ranks.NAMES,
    "C2: and its value vocabulary IS `Ranks.NAMES` by identity rather than by copy, so a ladder "
    + "change cannot leave the two disagreeing", r.values);
}
// ── PART C3 — THE MAP'S REFUSALS, AND THE SEAM THAT CARRIES IT (J17) ──────────────────────────
// PART C2 proves the map's SHAPE is right. These rows prove the reducer ACTS on it — three
// mutations survived C2 alone (`mutate-j17-schema` M8, M9, M11), because a structural check on a
// table entry says nothing about what happens to a blob that violates it.
for (const key of mapKeys) {
  const r = RANGES[key];
  const domain = r.keys();
  const good = { [domain[0]]: r.values[r.values.length - 1] };
  const accepted = apply({ [key]: good });
  ok(JSON.stringify(accepted[key]) === JSON.stringify(good),
    "C3: APPLIED — a VALID map must be accepted, or every refusal below is a refusal of everything",
    { sent: good, got: accepted[key] });

  // WHOLE OR NOTHING. One bad row rejects the whole write; it does not apply the rest.
  const mixed = Object.assign({}, good, { [domain[1]]: "notarank" });
  const afterMixed = apply({ [key]: mixed });
  ok(JSON.stringify(afterMixed[key]) !== JSON.stringify(mixed),
    "C3: a map with an invalid VALUE is refused", { got: afterMixed[key] });
  ok(Object.keys(afterMixed[key]).length === 0,
    "C3: AND IT IS REFUSED WHOLE — the valid rows beside the bad one do NOT apply. A partial "
    + "delegation is a subset nobody asked for, and it would look like a successful write",
    afterMixed[key]);

  // The vocabulary is checked, not merely the type. A rank name that is not on the ladder would
  // render as a blank selector in the panel and delegate to nobody.
  const badRank = apply({ [key]: { [domain[0]]: "archduke" } });
  ok(Object.keys(badRank[key]).length === 0,
    "C3: a value outside `Ranks.NAMES` is refused rather than stored as a string — the panel reads "
    + "this vocabulary to build its selector, so an unknown name is a row it cannot display",
    badRank[key]);
  const badKey = apply({ [key]: { notASetting: r.values[0] } });
  ok(Object.keys(badKey[key]).length === 0,
    "C3: and a key outside the derived domain is refused, so the table cannot name a setting the "
    + "reducer does not define", badKey[key]);
  // THE SELF-EXCLUSION, DRIVEN THROUGH THE FOLD rather than read off the domain.
  const selfRef = apply({ [key]: { [key]: r.values[r.values.length - 1] } });
  ok(Object.keys(selfRef[key]).length === 0,
    "C3: AND THE TABLE CANNOT NAME ITSELF, driven through the reducer's own merge. A rank granted "
    + "`" + key + "` could grant itself every other setting in one subsequent write — the table "
    + "would be a key to itself. C2 reads the domain; this drives what the fold does with a blob "
    + "that ignores it", selfRef[key]);

  // THE SEAM. `features/` may not reach the reducer (rule D/F), so the panel reads bounds through
  // `StreamManager.settingRanges()`. A map entry declares its domain as a FUNCTION, and handing a
  // callable across that boundary would be handing the feature layer a route into the reducer by
  // another name — textual rule F would not notice, but its reason would.
  const viaSeam = SM.settingRanges()[key];
  ok(viaSeam && Array.isArray(viaSeam.keys),
    "C3: the seam RESOLVES the derived domain to a plain array — code must not cross a boundary "
    + "that exists to carry data", { got: viaSeam && typeof viaSeam.keys });
  ok(JSON.stringify(viaSeam.keys) === JSON.stringify(domain),
    "C3: to the same domain the reducer derives, so the panel offers exactly the delegable keys",
    { seam: viaSeam.keys, reducer: domain });
  ok(viaSeam.keys.indexOf(key) < 0,
    "C3: including the self-exclusion, which the panel therefore does not have to remember — a "
    + "panel filtering it out by name would be a second copy of the rule, free to disagree",
    viaSeam.keys);
  viaSeam.keys.push("injected");
  ok(SM.settingRanges()[key].keys.indexOf("injected") < 0,
    "C3: and the array is a FRESH copy per call — a caller that mutates what it was handed cannot "
    + "push a key into the reducer's own delegable set", SM.settingRanges()[key].keys);
}

ok(mapKeys.length === 1,
  "C: exactly one map key today — a second would need its own reason, and this row is what would "
  + "make somebody give one", mapKeys);
ok(valueKeys.length >= 1,
  "C: the MEMBERSHIP population must not be empty — if it is, either the min-DJ-rank bar left the "
  + "table or its entry stopped declaring `values`, and PART A2 then proves nothing about nothing",
  { values: valueKeys.length });
ok(checkedEndpoints === rangeKeys.length * 4,
  "C: every numeric key must contribute four endpoint assertions", { checkedEndpoints, rangeKeys: rangeKeys.length });
ok(checkedValues >= valueKeys.length * 4,
  "C: every membership key must contribute an accept per declared value plus three refusals",
  { checkedValues, valueKeys: valueKeys.length });
for (const key of rangeKeys) {
  const r = RANGES[key];
  ok(Number.isFinite(r.min) && Number.isFinite(r.max) && r.max > r.min,
    "C: `" + key + "` must declare a usable range", r);
}
for (const key of valueKeys) {
  const r = RANGES[key];
  ok(Array.isArray(r.values) && r.values.every((v) => typeof v === "string" && v),
    "C: `" + key + "` must declare a usable value set of non-empty strings", r);
}

// ── PART D — EVERY KEY THE REDUCER DEFINES ACTUALLY FOLDS ─────────────────────────────────────
// THIS PART EXISTS BECAUSE THREE MUTATIONS SURVIVED WITHOUT IT. `mutate-j17-schema` M1, M2 and M5
// delete the fold lines for `botPresenceSpine`, `botPresenceChat` and `botDelegation`, and the
// suite stayed GREEN — because every loop above is driven from `SETTING_RANGES`, and a key with no
// row is in none of them. That is not a hole in this file's design; it is the consequence of PART
// C's own scope, which is *entries in the table*. The reducer's key set is LARGER than the table's.
//
// So the candidate list here is `defaultSettings()` rather than `SETTING_RANGES`, and the test
// value is DERIVED FROM THE DEFAULT'S SHAPE rather than listed per key — a list somebody remembers
// is the thing that leaves a key uncovered the day it is added. Anything the shape-deriver cannot
// build a value for must be named in `BESPOKE` with a reason, so a new key of an unhandled shape
// fails here rather than silently sitting outside every loop (`08-build-and-deploy.md` §Decide,
// do not merely gate — the same move that fixed the six missing `ddjp.media.skip` subscriptions).
//
// EVERY VALUE DIFFERS FROM THE DEFAULT, which is what makes a fold distinguishable from a no-op:
// sending a key its own default proves nothing, because a reducer that ignored the key entirely
// would produce the same answer.
{
  // Keys whose fold is bespoke and is driven elsewhere. Each carries WHERE, not just that it is
  // exempt — an exemption with no forwarding address is an exemption nobody re-checks.
  const BESPOKE = {
    chat:  "an inline three-value list in applySettingsEvent; driven by check-settings-rows",
    vis:   "an inline two-value list; same",
    bg:    "a string-or-null link whose host validation lives in the feature-layer load gate",
    // THREE OF THESE FOUR ADDRESSES WERE WRONG, found by the v323 sweep of paths cited in code. `check-skip-roads` and `check-vouch-table`
    // have never existed, and this table's own header says an exemption with no forwarding address
    // is an exemption nobody re-checks — so three keys sat outside every loop here, pointing at
    // guards a reader would have gone looking for and not found. Corrected against the guards that
    // actually drive each key through `applySettingsEvent`, which is what "driven" has to mean:
    // being MENTIONED by a guard is not being exercised by one.
    skipRoads:       "an array of road objects with its own shape walk; driven by check-tier-inclusive, which passes road VALUES through the reducer",
    vouchTable:      "a per-rank row table with its own `_rows` walk; driven by check-settings-rows",
    checkpointTable: "the same `_rows` walk; driven by check-settings-rows and check-checkpoint",
    // PAIRED, and the shape-deriver cannot see it. `minGate`'s effective floor is the LADDER COST
    // (`vouchJitter` × rungs + half a step), not the `min` its own row declares — so the probe
    // below picks 0, the pair rule correctly refuses it, and the row would read as *does not fold*
    // when what it actually found is *is validated against a second key*. PART B drives this pair
    // at its real boundary, including `minGate` exactly equal to the ladder cost.
    minGate: "floored by the ladder cost rather than by its own `min`; driven at that boundary in PART B",
    // THE TWO FLAG MAPS (v322). The generic prober builds a numeric or a vocabulary value; neither
    // is a boolean map, so it would send a value the validator correctly refuses and the row would
    // read as *does not fold* when what it found is *the prober cannot express this shape*. Driven
    // in PART H below instead, at both the accept and the refuse boundary.
    activityQueue:    "a boolean map over ACTIVITY_GROUPS; driven in PART H",
    activityPresence: "the same shape; driven in PART H",
  };

  const defaults = StateDeriver.defaultSettings();
  const allKeys = Object.keys(defaults);
  ok(allKeys.length > keys.length,
    "D: APPLIED — the reducer must define MORE keys than the range table does, or this part is a "
    + "second copy of the loops above rather than the cover for what they miss",
    { defaults: allKeys.length, ranged: keys.length });

  // Build a value that DIFFERS from the default, from the default's shape and the key's kind.
  function probeValue(key) {
    const d = defaults[key];
    if (typeof d === "boolean") return { ok: true, v: !d };
    const kind = kindOf(key);
    if (kind === "range") {
      const r = RANGES[key];
      return { ok: true, v: (d === r.min) ? r.max : r.min };
    }
    if (kind === "values") {
      const other = RANGES[key].values.filter((x) => x !== d);
      return other.length ? { ok: true, v: other[0] } : { ok: false, why: "the value set has one member" };
    }
    if (kind === "map") {
      const domain = RANGES[key].keys();
      const rank = RANGES[key].values[RANGES[key].values.length - 1];
      return domain.length ? { ok: true, v: { [domain[0]]: rank } }
                           : { ok: false, why: "the map's derived domain is empty" };
    }
    return { ok: false, why: "no rule builds a value for this shape" };
  }

  const undecided = [];
  let driven = 0;
  for (const key of allKeys) {
    if (BESPOKE[key]) continue;
    const p = probeValue(key);
    if (!p.ok) { undecided.push(key + " (" + p.why + ")"); continue; }
    const before = defaults[key];
    ok(JSON.stringify(p.v) !== JSON.stringify(before),
      "D: APPLIED — the probe value for `" + key + "` must DIFFER from its default, or a reducer "
      + "that ignored the key entirely would produce the same answer and this row would pass on a "
      + "no-op", { key: key, probe: p.v, def: before });
    const after = apply({ [key]: p.v });
    ok(JSON.stringify(after[key]) === JSON.stringify(p.v),
      "D: `" + key + "` FOLDS — a settings event carrying it changes the derived value. A key the "
      + "reducer defines but never applies is a control the owner can move that does nothing, and "
      + "nothing above this part would have noticed: every loop there is driven from "
      + "`SETTING_RANGES`, and a key with no row is in none of them",
      { key: key, sent: p.v, got: after[key] });
    driven++;
  }

  ok(undecided.length === 0,
    "D: every key the reducer defines is either DRIVEN here or named in `BESPOKE` with the guard "
    + "that drives it. A key in neither is not a bug in this file — it is a decision nobody made, "
    + "and it is how a key ships with a fold nothing exercises", undecided);
  ok(driven >= allKeys.length - Object.keys(BESPOKE).length,
    "D: APPLIED — the loop must have reached every non-bespoke key", { driven: driven });

  // AND THE EXEMPTIONS ARE REAL KEYS. An entry for a key the reducer no longer defines is an
  // excuse for something that cannot arrive, and would quietly shrink this part's coverage.
  const staleExempt = Object.keys(BESPOKE).filter((k) => allKeys.indexOf(k) < 0);
  ok(staleExempt.length === 0,
    "D: and every `BESPOKE` entry names a key the reducer still defines", staleExempt);

  // THE CONTROL: sending a key its own default must NOT be readable as a fold. Without this, a
  // reducer that ignored every key above would still pass, because `after[key]` would equal the
  // default and the probe value would have to differ from it — which the APPLIED rows check, but
  // only for the probe. This checks the reading itself discriminates.
  const noop = apply({ botAfkMs: defaults.botAfkMs });
  ok(noop.botAfkMs === defaults.botAfkMs,
    "D control: a key sent its own default is unchanged — so the rows above read a CHANGE rather "
    + "than an equality that would hold either way", noop.botAfkMs);
  const refused = apply({ botAfkMs: 1 });
  ok(refused.botAfkMs === defaults.botAfkMs,
    "D control: and an OUT-OF-RANGE value keeps the current one, so the fold is validated rather "
    + "than merely copied — a fold that assigned blindly would pass every row above", refused.botAfkMs);
}

// THE FAILURE GATE SITS AFTER EVERY PART, AND IT DID NOT. PART D was appended BELOW this line, so
// its assertions printed their FAIL text and the process still exited 0 — the guard announced
// itself as PASS with a failure on screen, and `mutate-j17-schema` M1/M2/M5 read GREEN against a
// tree whose fold they had deleted. Two documented shapes at once: a guard that CANNOT FAIL
// (`08-build-and-deploy.md` §A guard must be able to fail), and a runner whose verdict is a text
// match — `/PASS/` was true of output that also contained FAIL. Moved below every part; the
// runner's verdict is tightened separately.
//
// AND IT DRIFTED BACK. Parts were appended AFTER this line — including PART H, the whole activity
// map — so every assertion in them printed FAIL and the file still exited 0. Measured: mapping
// `ddjp.dj.play` to a group, the exact thing PART H forbids, left this guard's exit code at 0.
// The suite caught that one through OTHER guards; nothing at all covered `dj.declare` and
// `dj.undeclare`, so those assertions were decorative from the moment they were written.
//
// "Below every part" is a fact about POSITION, and position is what changes when somebody appends.
// The check now sits at the very end of the file, after the verdict, where appending cannot get
// underneath it.
// ═══ CHANGING A SHIPPED DEFAULT IS NOT FREE ═════════════════════════════════════════════════
//
// ── READ THIS BEFORE CHANGING A DEFAULT ────────────────────────────────────────────────────
// **Changing a shipped default is a FINGERPRINT-MOVING change for every room that never authored
// that key** — which is most keys in most rooms, because `seed.settings` materialises all of them.
// **The recovery is TWO FRESH SEALS:** a room whose held checkpoints were fingerprinted under the
// old defaults stops licensing forgetting until it has sealed two under the new ones, then
// recovers on its own with no intervention.
//
// **IT HAS BEEN PAID ONCE, DELIBERATELY.** At v283 three bot defaults changed — `botPresenceChat`
// to true, `botAfkMs` to 60 minutes, `botPingMs` to 10 — because the rooms in existence were TEST
// rooms and creating new ones was fine. **That is not a precedent for a live deployment**, where
// the same edit buys a window in which every real room grows without forgetting, which is the
// thing checkpoints exist to prevent.
//
// **The rule below is not soft. The price was known and chosen.** If you are here because you want
// to change a default: the cost is real, the recovery is two seals, and whether that is acceptable
// is a question about the rooms that exist — not about this row.
// J10's ruling is read as *values inside an unchanged key set cost nothing — existing rooms carry
// their own settings and only new rooms differ*. **Driven, and it is false for any key a room
// never explicitly set**, which is most keys in most rooms.
//
// `seed.settings` is a WHOLE-BLOB COPY: measured on a real fixture, all 23 keys are materialised
// and ZERO were authored away from their shipped default. So for those keys **the shipped default
// IS the committed value**, and changing it moves the fingerprint of every checkpoint in every
// room that never set it — the same cost as a new key, arriving as a one-line edit.
{
  const F2 = require("./_fixtures");
  const room2 = F2.playingRoom({ songs: 3 });
  const log2 = F2.sortLog(room2.log);
  // The fingerprint module is loaded HERE rather than assumed present in this guard's sandbox —
  // the first version referenced it and died by CRASH, and a row that goes red by crashing is not
  // red enough.
  const CF2 = require("./_load").loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/checkpointformat.js",
  ], { Date, Math, JSON }).CheckpointFormat;
  const seed2 = StateDeriver.buildSeed(log2, null);
  const defaults2 = StateDeriver.defaultSettings();

  const materialised = Object.keys(defaults2).filter((k) => k in seed2.settings);
  ok(materialised.length === Object.keys(defaults2).length,
    "DEFAULTS: APPLIED — every default key is MATERIALISED into the seed, so 'the room carries its " +
    "own settings' is true of the blob and not of authorship", 
    { keys: Object.keys(defaults2).length, inSeed: materialised.length });

  const authored = Object.keys(seed2.settings).filter(
    (k) => JSON.stringify(seed2.settings[k]) !== JSON.stringify(defaults2[k]));
  ok(authored.length === 0,
    "DEFAULTS: and in a room where nobody changed anything, NONE is authored away from its " +
    "default — so for all of them the shipped default is the committed value", authored);

  // THE CONSEQUENCE, IN ONE NUMBER. Two seeds over the SAME log, differing only in one default.
  const moved = Object.assign({}, seed2, {
    settings: Object.assign({}, seed2.settings, { botPresenceChat: !seed2.settings.botPresenceChat }),
  });
  const fpA = CF2.fingerprint(5, null, seed2, log2[log2.length - 1].l, false, "$a..$b");
  const fpB = CF2.fingerprint(5, null, moved, log2[log2.length - 1].l, false, "$a..$b");
  ok(fpA !== fpB,
    "DEFAULTS: FLIPPING ONE DEFAULT MOVES THE FINGERPRINT of a room that never set that key. " +
    "Changing a shipped default therefore costs what a NEW KEY costs — every checkpoint in every " +
    "such room re-fingerprints and the dead-checkpoint window opens — and it arrives looking like " +
    "a one-line edit", { before: String(fpA).slice(0, 14), after: String(fpB).slice(0, 14) });
  ok(String(fpA) !== "" && String(fpB) !== "",
    "DEFAULTS control: both fingerprints computed, so the inequality above is between two values " +
    "rather than between two failures", { a: !!fpA, b: !!fpB });
}

// ── PART H — THE TWO FLAG MAPS, at both boundaries ───────────────────────────────────────────
// Named in BESPOKE above, so this is the forwarding address that exemption promised. An exemption
// whose address does not exist is how a key ships with a fold nothing drives.
{
  const GROUPS = StateDeriver.ACTIVITY_GROUPS;
  ok(Array.isArray(GROUPS) && GROUPS.length > 0,
    "H: the reducer must export its activity groups — the domain is DERIVED from them, so a guard "
    + "listing groups here would be the second copy that outlives the first", GROUPS);

  for (const key of ["activityQueue", "activityPresence"]) {
    // ACCEPTED: a well-formed partial map. Partial is the normal case — absent means false, and
    // requiring every group would make ADDING a group invalidate every stored map in every room.
    const good = {}; good[GROUPS[0]] = false;
    const mk = (k, v) => { const b = {}; b[k] = v; return b; };
    let out = apply(mk(key, good));
    ok(out[key] && out[key][GROUPS[0]] === false,
      "H: " + key + " must accept a well-formed partial map, and absent groups mean false", out[key]);

    // REFUSED, three ways, each keeping the CURRENT value rather than half-applying:
    //   1. a group the domain does not contain
    const bad1 = {}; bad1[GROUPS[0]] = true; bad1["notagroup"] = true;
    out = apply(mk(key, bad1));
    ok(out[key] && out[key].notagroup === undefined,
      "H: " + key + " must refuse a map naming a group outside the domain — WHOLE, not by dropping "
      + "the bad row, so a room can never end up half on a new rule", out[key]);

    //   2. a non-boolean value. This reaches a checkpoint seed the fingerprint commits, so a
    //      coerced `"true"` would make a room unable to agree with itself.
    const bad2 = {}; bad2[GROUPS[0]] = "true";
    out = apply(mk(key, bad2));
    ok(out[key] && out[key][GROUPS[0]] !== "true",
      "H: " + key + " must refuse a STRING where a boolean belongs — `\"false\"` is truthy, and a "
      + "room whose rule depends on how its panel serialised the value cannot agree with itself",
      out[key]);

    //   3. an array, which is an object and would pass a bare typeof check
    out = apply(mk(key, [GROUPS[0]]));
    ok(out[key] && !Array.isArray(out[key]),
      "H: " + key + " must refuse an array — `typeof [] === \"object\"`, so a shape check that "
      + "forgot Array.isArray would accept it", out[key]);
  }

  // AND THE PASSIVE TYPES ARE NOT IN THE DOMAIN AT ALL — structural, not a check. No room can
  // configure `ddjp.dj.play` to count as activity, because there is no group it belongs to.
  ok(StateDeriver.activityGroupOf("ddjp.dj.play") === null,
    "H: the DJ's client auto-advancing must belong to NO group. If it did, a person who queued "
    + "songs and walked away would look active for as long as their buffer lasted — and the AFK "
    + "rule could never fire for exactly the person it exists for");
  ok(StateDeriver.activityGroupOf("ddjp.play.len") === null && StateDeriver.activityGroupOf("ddjp.play.blocked") === null
     && StateDeriver.activityGroupOf("ddjp.media.skip") === null,
    "H: measurements, player errors and road-met escapes are the CLIENT acting, not the person");
  // ── AND THE TWO WITH A CLIENT AS AUTHOR ────────────────────────────────────────────────────
  // `ddjp.dj.declare` and `ddjp.dj.undeclare` were `rotation` until the owner asked how many
  // actions are automatic. They are the SAME SHAPE as `dj.play` above, and were missed because
  // the exclusions were reasoned per TYPE while `declare` is a type with two authors: a person
  // adding a song, and `userqueue.js` reconciling the buffer against their playlist as songs
  // cycle — a loop that computes a surplus and a deficit and fires both on its own.
  //
  // ASSERTED AGAINST THE AUTHOR, NOT A LIST. The reason these must not count is that a caller
  // outside `ui/` emits them, so that is what this checks: if the reconcile loop is ever removed
  // and they become click-only, this fails and asks for the decision again rather than freezing
  // today's answer forever.
  // ── THE ONE THAT ACTUALLY FIRES: `ddjp.dj.join` WITH A VIDEO ───────────────────────────────
  // REPORTED FROM A LIVE ROOM after the exclusions above were written: an owner sitting still kept
  // "joining the queue" and never went idle. `Queue.submitSong` does not emit `ddjp.dj.declare` —
  // **nothing does** — it emits `ddjp.dj.join` WITH a `v`, and `userqueue.js` calls it on its own
  // to top the buffer up from a playlist as songs cycle.
  //
  // So the audit that added the two exclusions below read the reducer's VOCABULARY instead of the
  // WIRE, removed two types that never fire, and left the one that does. Same defect class as a
  // fixture supplying a shape its caller cannot produce, one layer over.
  ok(StateDeriver.activityGroupOf("ddjp.dj.join", { v: "abc123" }) === null,
    "H: a join CARRYING A VIDEO is buffer housekeeping and must count for nothing — a playlist "
    + "cycling would otherwise keep somebody alive in both timers while they touch nothing");
  ok(StateDeriver.activityGroupOf("ddjp.dj.join", {}) !== null,
    "H: while a BARE join still counts — it has one author, a person pressing join. Without this "
    + "the line above would pass on a rule that excluded joining entirely");
  {
    const q = require("fs").readFileSync(
      path.join(__dirname, "..", "features", "queue.js"), "utf8");
    ok(/sendEvent\([^,]+, "ddjp\.dj\.join", \{ v:/.test(q),
      "H: APPLIED — `submitSong` really does emit `ddjp.dj.join` with a video, which is WHY the "
      + "body has to be read. If it ever gets its own type this exclusion should move with it");
    ok(!/sendEvent\([^,]+, "ddjp\.dj\.declare"/.test(q),
      "H: APPLIED — and THIS CLIENT does not emit `ddjp.dj.declare`, which is why excluding that "
      + "type alone fixed nothing. It remains protocol the reducer handles, so it is not excluded");
  }

  ok(StateDeriver.activityGroupOf("ddjp.dj.undeclare") === null,
    "H: shedding a buffer surplus counts for nothing — `userqueue.js` fires it as a playlist "
    + "cycles, with no click");
  // `ddjp.dj.declare` IS COUNTED, and the reason it briefly was not is worth keeping. It was
  // removed as "a type nothing emits" — but the reducer HANDLES it and it is in `HANDLED_TYPES`,
  // so it is protocol, and only THIS client's habit of sending `ddjp.dj.join` instead made the
  // claim look true. Excluding a protocol type on one client's habits silently changed what
  // thirty fixtures mean by "an act", and one of them caught it.
  ok(StateDeriver.activityGroupOf("ddjp.dj.declare") !== null,
    "H: `ddjp.dj.declare` is protocol the reducer handles, so it still counts — the automatic act "
    + "this client really sends is a JOIN CARRYING A VIDEO, excluded above by reading the body");
  {
    const src = require("fs").readFileSync(
      path.join(__dirname, "..", "features", "userqueue.js"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    ok(/Queue\.submitSong\(/.test(code) && /Queue\.undeclare\(/.test(code),
      "H: APPLIED — a module outside `ui/` really does author both, which is WHY they are "
      + "excluded. If this ever stops being true the exclusion needs revisiting rather than "
      + "keeping by habit");
  }
  ok(StateDeriver.activityGroupOf("ddjp.dj.skip") !== null && StateDeriver.activityGroupOf("ddjp.dj.join") !== null,
    "H: CONTROL — deliberate acts must map to a group, or the two assertions above would pass on "
    + "a table that classified nothing at all");
}

console.log("[setting-endpoints] PASS — every declared setting entry is driven through the endpoint "
  + "test that fits its KIND, with the kinds read from the reducer's own `settingKindOf` and every "
  + "key in the table accounted for by exactly one of them: the " + rangeKeys.length + " numeric "
  + "ranges are INCLUSIVE at both ends and exclusive one step outside, and the " + valueKeys.length
  + " MEMBERSHIP set(s) admit every value they declare while refusing a non-member, a power LEVEL "
  + "passed instead of a name, and a null. Driven through the reducer's own merge rather than by "
  + "reading `_inRange`. The two PAIRED rules are inclusive at their boundaries too, including "
  + "`minGate` exactly equal to the ladder cost, which is the value J10's target requires. The key "
  + "list is DERIVED from SETTING_RANGES, so a setting added later is covered the day it is added — "
  + "and a key the reducer classifies as NEITHER kind fails PART C rather than disappearing from "
  + "both loops. Found by the J39 sweep: flipping `_inRange`'s `>=` to `>` made every setting "
  + "illegal at the leftmost value the panel offers, and the suite as shipped said nothing");

if (failed) process.exit(1);   // LAST LINE: appending a part cannot get underneath this
