// tests/check-settings-rows.js
// WALL: THE SETTINGS TABLES HAVE ONE ROW PER LADDER RUNG, ALWAYS.
//
// `ui/interface.js` held RANK_ROW_NAMES — six hand-written labels against a SEVEN-rung ladder.
// Guest was invisible and unsettable, and because every edit posts the WHOLE table, one ordinary
// owner click sent six values into a seven-slot table. A migration pad spliced the default guest row in
// at index 5 and the sixth posted value landed on UNCATEGORIZED:
//
//   owner edits VIP 4 -> 9
//   before : owner=1 high-staff=2 staff=3 vip=4 player=5 guest=6 uncategorized=never
//   after  : owner=1 high-staff=2 staff=3 vip=9 player=5 guest=6 uncategorized=6
//
// `never` meant no number of brand-new anonymous accounts can ever satisfy an event. After that
// click, six can. The one structural anti-sybil guarantee became a countable one, from a click that
// had nothing to do with it.
//
// Nothing tied the UI to the ladder — `check-settings-passthrough` asserts only that a control
// EXISTS per key, never that it has the right number of rows. So the row set is now built from
// Capabilities.LADDER and the edit is a pure function that can be run here, rather than DOM code
// that can only be read.
//
// Guarantees:
//   PART A — the row set IS the ladder, and uncategorized is structural rather than a dial.
//   PART B — an edit posts a COMPLETE table and changes only the cell edited. The §14.1 case is
//     asserted by name: editing VIP must leave uncategorized alone.
//   PART C — uncategorized cannot be edited, by anyone, through this path.
//   PART D — no hand-written row list survives in the UI.
//   PART E — the defaults have ONE home. Two modules used to carry their own copy of these tables.
//   PART F — the pad is gone: a short table is REJECTED rather than silently completed, and the
//     fallback that replaces it is stricter than what it replaces, so the failure direction is safe.

const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

function fail(msg, got) {
  console.log("[settings-rows] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }

const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/capabilities.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
]);
const { Ranks, Capabilities, TrustPolicy, StateDeriver } = C;
const N = Ranks.TIER_COUNT;
const names = Ranks.LADDER.map((r) => r.name);
const UNCAT = names.indexOf("uncategorized");
const GUEST = names.indexOf("guest");
const VIP = names.indexOf("vip");

// ── PART A: the row set is the ladder ────────────────────────────────────────────────────────
{
  ok(N === 7 && GUEST >= 0 && UNCAT === N - 1,
    "A: APPLIED — a seven-rung ladder with guest present and uncategorized last", { N: N, names: names });

  const rows = Capabilities.settingsRows();
  ok(Array.isArray(rows) && rows.length === N,
    "A: the panel's row set must have one row per rung — this is the whole defect", rows && rows.length);
  ok(rows.map((r) => r.name).join(",") === names.join(","),
    "A: and in ladder order, by name", rows.map((r) => r.name));
  ok(rows[GUEST] && rows[GUEST].editable === true,
    "A: guest is a real row the owner can set, not a hidden one", rows[GUEST]);
  ok(rows[UNCAT] && rows[UNCAT].editable === false,
    "A: uncategorized is structural, not a dial — it is shown and locked", rows[UNCAT]);
  ok(rows.filter((r) => r.editable).length === N - 1,
    "A: every other rung is editable", rows.filter((r) => r.editable).length);
}

// ── PART B: an edit posts a complete table and touches one cell ──────────────────────────────
{
  const before = StateDeriver.defaultSettings().vouchTable;
  ok(before.length === N, "B: APPLIED — the starting table must be a full one", before.length);

  const after = Capabilities.applyTableEdit(before, VIP, 9, true, false);
  ok(Array.isArray(after) && after.length === N,
    "B: an edit must post a COMPLETE table — a short post is what fed the wrong slot", after && after.length);
  ok(after[VIP].enough === 9, "B: the edited cell takes the new value", after[VIP]);

  // THE §14.1 CASE, by name. This is the click that used to flip the anti-sybil guarantee.
  ok(after[UNCAT].enough === before[UNCAT].enough,
    "B: editing VIP must leave UNCATEGORIZED exactly as it was", { was: before[UNCAT], now: after[UNCAT] });
  for (let i = 0; i < N; i++) {
    if (i === VIP) continue;
    ok(after[i].enough === before[i].enough,
      "B: no other row may move when one is edited (row " + i + " = " + names[i] + ")",
      { was: before[i], now: after[i] });
  }

  // THE DEFECT ITSELF: a SHORT table in must not make a short table out. The panel can be holding a
  // stale or truncated table — that is exactly how six values ended up in a seven-slot post — so the
  // shape has to be decided by the ladder, not by whatever was handed in. Passing a full table only
  // (as this part first did) cannot see the difference: mutation-verified.
  const short = before.slice(0, 4);
  const fromShort = Capabilities.applyTableEdit(short, VIP, 7, true, false);
  ok(Array.isArray(fromShort) && fromShort.length === N,
    "B: a SHORT table in must still produce a complete table out", fromShort && fromShort.length);
  ok(fromShort[VIP].enough === 7, "B: with the edit applied", fromShort[VIP]);
  ok(fromShort[UNCAT].enough === null && fromShort[GUEST].enough === null,
    "B: and the rungs the short table never mentioned come back as never, not as junk",
    { guest: fromShort[GUEST], uncat: fromShort[UNCAT] });

  // A blank means never, and must round-trip as null rather than 0.
  const blanked = Capabilities.applyTableEdit(before, GUEST, null, true, false);
  ok(blanked[GUEST].enough === null, "B: a blank entry means never, not zero", blanked[GUEST]);
}

// ── PART C: uncategorized is not editable through this path ─────────────────────────────────
{
  const before = StateDeriver.defaultSettings().vouchTable;
  ok(Capabilities.applyTableEdit(before, UNCAT, 6, true, false) === null,
    "C: an edit aimed at uncategorized must be refused outright, not applied");
  ok(Capabilities.applyTableEdit(before, N, 6, true, false) === null,
    "C: and an index off the end of the ladder is refused too");
  ok(Capabilities.applyTableEdit(before, -1, 6, true, false) === null, "C: as is a negative one");
}

// ── PART D: no hand-written row list survives ───────────────────────────────────────────────
// Static, because the renderer is DOM code. Comments stripped: this file names the very identifier
// it hunts for (docs/paths.md trap 3).
{
  // LINE COMMENTS ONLY, and the strip has to prove it did not eat the file. The obvious block-comment
  // pass — /\/\*[\s\S]*?\*\//g — removes 23% of ui/interface.js: something earlier in the file opens a
  // `/*` that is not a comment, so the match runs on and swallows real code, including the very lines
  // this part is looking for. A static assertion whose INPUT has been silently gutted reports whatever
  // the wreckage happens to say, in either direction. So: no block pass, and a landmark check.
  const raw = fs.readFileSync(path.join(ROOT, "ui", "interface.js"), "utf8");
  const ui = raw.split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  ok(/_renderTableSetting\s*\(/.test(ui) && /Room\.setSettings\s*\(/.test(ui),
    "D: APPLIED — the stripped source must still contain the panel it is being asked about; if this " +
    "fails the preprocessing has eaten the file and every other check here is meaningless");
  ok(!/RANK_ROW_NAMES/.test(ui),
    "D: the hand-written row list must be gone — it is the defect, not a symptom of it");
  ok(/getSettingRows\s*\(/.test(ui),
    "D: and the panel must build its rows from the ladder, through the feature seam — the UI may not\n" +
    "       reach Capabilities directly (check-boundaries, check-ui-no-permission)");
  ok(/editSettingTable\s*\(/.test(ui),
    "D: and post through the shared edit, so the row count cannot drift from the ladder again");
}

// ── PART E: the defaults have one home ──────────────────────────────────────────────────────
// trustpolicy and statederiver each carried their own copy of these tables. Two hand-maintained
// copies of one fact is the failure this codebase records twice; here it would mean the reducer and
// the trust rules disagreeing about who can satisfy an event.
{
  const sd = StateDeriver.defaultSettings();
  for (const key of ["vouchTable", "checkpointTable"]) {
    ok(sd[key].length === N, "E: " + key + " must have one row per rung", sd[key].length);
  }
  const canon = { vouchTable: Ranks.defaultVouchTable(), checkpointTable: Ranks.defaultCheckpointTable() };
  for (const key of ["vouchTable", "checkpointTable"]) {
    ok(JSON.stringify(sd[key]) === JSON.stringify(canon[key]),
      "E: the reducer's " + key + " must BE the canonical one, not a copy of it",
      { reducer: sd[key], canonical: canon[key] });
  }
  // And a fresh copy each time, or one room's edit would leak into the defaults.
  const a = Ranks.defaultVouchTable();
  a[0].enough = 999;
  ok(Ranks.defaultVouchTable()[0].enough !== 999, "E: the defaults must hand out copies, not the original");

  // The ratified shape: VIP is the lowest rung that can satisfy anything.
  for (const key of ["vouchTable", "checkpointTable"]) {
    ok(sd[key][VIP].enough !== null, "E: VIP is the lowest rung that counts — " + key, sd[key][VIP]);
    for (const low of ["player", "guest", "uncategorized"]) {
      const i = names.indexOf(low);
      ok(sd[key][i].enough === null,
        "E: " + low + " must be off by default in " + key + " — quantity below VIP never satisfies",
        sd[key][i]);
    }
  }
}

// ── PART F: the pad is gone, and the fallback is the SAFE direction ─────────────────────────
{
  const base = StateDeriver.defaultSettings();
  // Distinct values throughout, so a pad would be VISIBLE. Slicing the defaults would not have been:
  // the new defaults are null at the bottom rungs, so a padded result coincidentally equals the base
  // and the assertion passes whether the pad ran or not. It did, until this was rewritten.
  const six = [{ enough: 9, always: false }, { enough: 9, always: false }, { enough: 9, always: false },
               { enough: 9, always: false }, { enough: 9, always: false }, { enough: 9, always: false }];
  const out = StateDeriver.applySettingsEvent(base, { vouchTable: six });
  ok(JSON.stringify(out.vouchTable) === JSON.stringify(base.vouchTable),
    "F: a short table is REJECTED, not silently completed — the pad is gone", out.vouchTable);

  // The consequence, stated so it is a decision rather than a surprise: every table edit ever made
  // through the old panel was six rows, so on replay those events are now inert and the room falls
  // back to these defaults. That is only acceptable because the fallback is STRICTER than anything
  // the old panel could have left behind for the bottom rungs — the room gets tighter than its owner
  // intended, never looser. An owner re-saves once; nothing is quietly weakened meanwhile.
  for (const low of ["player", "guest"]) {
    const i = names.indexOf(low);
    ok(base.vouchTable[i].enough === null,
      "F: the fallback must be strict at " + low + ", or losing a room's settings would LOOSEN it",
      base.vouchTable[i]);
  }
}

// ── PART G: every setting has a control, and every control has a setting ─────────────────────
// A setting the reducer knows about and the panel never renders is invisible: the room has it, the
// owner cannot see or change it, and nothing reports that. A control for a key the reducer does not
// know is the opposite — it writes a value into the blob that nothing reads. Neither shows up as an
// error, which is why this is asserted in both directions rather than assumed from a read-through.
//
// The four that looked missing on a first pass — bg, chat, vis, skipRoads — are all rendered, by
// helpers a narrow grep does not match. That is precisely why this checks the KEY rather than the
// helper: the panel may render a setting any way it likes, but it must render it.
{
  const strip = (x) => x.split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const ui = strip(fs.readFileSync(path.join(ROOT, "ui", "interface.js"), "utf8"));
  ok(/_renderTableSetting\s*\(/.test(ui) && /Room\.setSettings\s*\(/.test(ui),
    "G: APPLIED — the stripped panel source must still contain the panel");

  const keys = Object.keys(StateDeriver.defaultSettings());
  ok(keys.length >= 15, "G: APPLIED — defaultSettings must define a real set of keys", keys.length);

  const unexposed = keys.filter((k) => {
    // Named as a quoted argument (the helpers take the key first OR second), read off the current
    // settings as `s.key`, or written back by name. Any one of those means the panel handles it.
    const asArg = new RegExp('"' + k + '"\\s*,');
    const asRead = new RegExp('\\bs\\.' + k + '\\b');
    const asWrite = new RegExp('setSettings\\(\\s*\\{\\s*' + k + '\\b');
    return !(asArg.test(ui) || asRead.test(ui) || asWrite.test(ui));
  });
  ok(unexposed.length === 0,
    "G: every setting the reducer defines must be reachable in the panel — one that is not is a " +
    "value the room has and the owner can neither see nor change", unexposed);

  // And the reverse: a control naming a key the reducer does not define writes into the blob and
  // nothing ever reads it back.
  const rendered = [];
  // The key is the FIRST argument to most helpers and the SECOND to the table ones, so both shapes
  // are scanned. Missing the second shape is what made this part fail on its first run.
  const re = /(?:optionRow|_renderNumberSettingRow|_renderSkipRoadsSetting)\s*\(\s*"([A-Za-z]+)"|_renderTableSetting\s*\(\s*"[^"]*"\s*,\s*"([A-Za-z]+)"/g;
  let m;
  while ((m = re.exec(ui)) !== null) { const k = m[1] || m[2]; if (k && rendered.indexOf(k) < 0) rendered.push(k); }
  ok(rendered.length >= 10, "G: APPLIED — the scan must find the panel's controls", rendered.length);
  const orphans = rendered.filter((k) => keys.indexOf(k) < 0);
  ok(orphans.length === 0,
    "G: a control names a setting the reducer does not define — it would write a value nothing reads",
    orphans);
}

console.log("[settings-rows] PASS — the settings tables have one row per ladder rung: guest is a real settable row, uncategorized is shown and locked as a structural rule rather than a dial, an edit posts a complete table and moves only the cell edited (so editing VIP can no longer flip uncategorized from never to countable), the defaults live in one place instead of two hand-maintained copies with VIP as the lowest rung that counts, and a short table is now rejected outright rather than padded — with the fallback strict enough that losing a room's settings tightens it rather than loosening it");
