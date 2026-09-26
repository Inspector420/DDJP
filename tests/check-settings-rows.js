// tests/check-settings-rows.js
// SUBJECT: ui/settings.js, backends/backend1/ranks.js
// WALL: THE SETTINGS TABLES HAVE ONE ROW PER LADDER RUNG, ALWAYS.
//
// `ui/settings.js` held RANK_ROW_NAMES — six hand-written labels against a SEVEN-rung ladder.
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
// ── THE LANDMARK CHANGED AT J31, IN BOTH PARTS D AND G ──────────────────────────────────────
// `Room.setSettings(` was the second landmark and J31 removed it from `ui/`: the panel dispatches
// through `Actions.perform("room.settings", …)` now. A landmark's only job is to prove the strip
// did not eat the file, so it is replaced with another function these parts are actually about,
// and nothing they assert changes. It failed LOUDLY rather than silently only because it was
// written as an APPLIED premise — a landmark folded into the assertion it protects would simply
// have stopped protecting it.
// Static, because the renderer is DOM code. Comments stripped: this file names the very identifier
// it hunts for (docs/paths.md trap 3).
{
  // LINE COMMENTS ONLY, and the strip has to prove it did not eat the file. The obvious block-comment
  // pass — /\/\*[\s\S]*?\*\//g — removes 23% of ui/settings.js: something earlier in the file opens a
  // `/*` that is not a comment, so the match runs on and swallows real code, including the very lines
  // this part is looking for. A static assertion whose INPUT has been silently gutted reports whatever
  // the wreckage happens to say, in either direction. So: no block pass, and a landmark check.
  const raw = fs.readFileSync(path.join(ROOT, "ui", "settings.js"), "utf8");
  const ui = raw.split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  ok(/_renderTableSetting\s*\(/.test(ui) && /_commitSetting\s*\(/.test(ui),
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
// THE RULE IS NOW "REACHABLE WHEREVER IT HAS AN EFFECT" (the owner's ruling in the settings rework):
// a setting is shown in every room type where it changes something, and hidden where it cannot.
// This part stays the source-level floor — every key is handled SOMEWHERE in the panel — and PART I
// below RUNS the panel in each room type to prove the per-room half.
//
// The four that looked missing on a first pass — bg, chat, vis, skipRoads — are all rendered, by
// helpers a narrow grep does not match. That is precisely why this checks the KEY rather than the
// helper: the panel may render a setting any way it likes, but it must render it.
{
  const strip = (x) => x.split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const ui = strip(fs.readFileSync(path.join(ROOT, "ui", "settings.js"), "utf8"));
  ok(/_renderTableSetting\s*\(/.test(ui) && /_commitSetting\s*\(/.test(ui),
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
  // The table helpers' title is now read from the one name table (`_name("key")`), not a literal, so
  // the first argument is matched as anything without a comma rather than as a quoted string.
  const re = /(?:optionRow|_renderNumberSettingRow|_renderSkipRoadsSetting)\s*\(\s*"([A-Za-z]+)"|_renderTableSetting\s*\(\s*[^,]*,\s*"([A-Za-z]+)"/g;
  let m;
  while ((m = re.exec(ui)) !== null) { const k = m[1] || m[2]; if (k && rendered.indexOf(k) < 0) rendered.push(k); }
  ok(rendered.length >= 10, "G: APPLIED — the scan must find the panel's controls", rendered.length);
  const orphans = rendered.filter((k) => keys.indexOf(k) < 0);
  ok(orphans.length === 0,
    "G: a control names a setting the reducer does not define — it would write a value nothing reads",
    orphans);
}


// ── PART I: EVERY SETTING WHEREVER IT HAS AN EFFECT, AND NOWHERE IT HAS NONE ───────────────────
// The owner's rule for the reworked panel: no visible setting that does nothing. Two facts decide
// what "does nothing" means, and this part checks BOTH the facts and the panel that obeys them.
//   · The room's ENGINE declares what it never acts on (`idleSettings` in its descriptor). A bot room
//     has no `checkpoints_` channel, so backend1's peer-backup and stand-in machinery cannot seal or
//     adopt there — and no feature file, which runs in every room, may read an idle key, or the
//     declaration would be false. `vouchJitter` is the case that proves the check: features stagger
//     playback and reports by it, so it must never be declared idle.
//   · A BOT must be present for the bot's settings to change anything; those keys are read in
//     `features/` only by the bot's own runtime and its settings policy.
// The panel is then EXECUTED — the real `ui/settings.js`, the real defaults, ranges and names, the
// real bot engine descriptor — in each room type, every section and subsection opened by clicking
// its header the way a person would, and the rendered `data-key`s read back.
{
  const vm = require("vm");
  const P = require("./_probe-j14-card.js");
  const codeOf = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l)).map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  const reads = (src, k) => new RegExp("\\b" + k + "\\b").test(src);

  const BE = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js",
    "backends/backend1/streammanager.js"], { Date, Math, JSON });
  const KEYS = Object.keys(BE.StateDeriver.defaultSettings());

  // The bot engine's descriptor, read from the engine's own registration.
  const reg = { B1MatrixAccount: {}, B1Capabilities: {}, console, Logger: { info() {}, warn() {} } };
  vm.createContext(reg);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "core/backends.js"), "utf8") + "\n"
    + fs.readFileSync(path.join(ROOT, "backends/backend2/skeleton.js"), "utf8")
    + "\n;globalThis.__B = Backends; globalThis.__ch = B2_CHANNELS;", reg);
  const IDLE = ((reg.__B.describe("backend2") || {}).idleSettings) || [];
  ok(IDLE.length > 0, "I: APPLIED — the bot engine declares the settings it never acts on", IDLE);
  ok(IDLE.every((k) => KEYS.indexOf(k) >= 0), "I: every declared idle setting is a real setting", IDLE);
  ok(IDLE.indexOf("vouchJitter") < 0, "I: `vouchJitter` is never idle — playback and reports stagger by it in every room");
  ok(!reg.__ch.some((c) => /^checkpoints_/.test(c.key)),
    "I: a bot room has no `checkpoints_` channel — the reason peer backups and stand-in summaries do nothing there",
    reg.__ch.map((c) => c.key));
  const featFiles = fs.readdirSync(path.join(ROOT, "features")).filter((f) => f.endsWith(".js"));
  const b2Files = fs.readdirSync(path.join(ROOT, "backends/backend2")).filter((f) => f.endsWith(".js"));
  for (const k of IDLE) {
    const where = featFiles.filter((f) => reads(codeOf("features/" + f), k)).map((f) => "features/" + f)
      .concat(b2Files.filter((f) => reads(codeOf("backends/backend2/" + f).replace(/idleSettings:[\s\S]*?\]/, ""), k)).map((f) => "backends/backend2/" + f));
    ok(where.length === 0, "I: `" + k + "` is declared idle in bot rooms but code that runs there reads it", where);
  }
  // WHAT NEEDS A BOT. The presence settings are NOT here: `features/room.js` folds them into the
  // People panel's "who is active" list in every room. These five are the bot's alone. A feature
  // file may read one only inside a function whose every caller is the bot's own module — the
  // `Room.idleFor` shape — because "read" is not "acted on" when only the bot ever asks.
  const BOT_ONLY = ["botPingMs", "queueIdleMs", "botQueueChat", "activityQueue", "botDelegation"];
  const BOT_MODULES = ["features/botruntime.js", "features/botsettings.js"];
  const allCode = [];
  for (const dir of ["ui", "features", "core", "backends/backend1", "backends/backend2"]) {
    for (const f of fs.readdirSync(path.join(ROOT, dir)).filter((x) => x.endsWith(".js"))) allCode.push(dir + "/" + f);
  }
  const fnAround = (lines, i) => { for (let j = i; j >= 0; j--) { const m = lines[j].match(/^\s*(?:async\s+)?function\s+(\w+)\s*\(/); if (m) return m[1]; } return null; };
  for (const k of BOT_ONLY) {
    for (const f of featFiles) {
      const rel = "features/" + f;
      if (BOT_MODULES.indexOf(rel) >= 0) continue;
      const lines = codeOf(rel).split("\n");
      const fns = new Set();
      lines.forEach((l, i) => { if (reads(l, k)) fns.add(fnAround(lines, i) || "(top level)"); });
      for (const fn of fns) {
        const callers = fn === "(top level)" ? ["(top level)"] : allCode.filter((c) => {
          const src = codeOf(c).replace(new RegExp("function\\s+" + fn + "\\s*\\(", "g"), "");
          return new RegExp("\\b" + fn + "\\s*\\(").test(src);
        });
        ok(callers.length > 0 && callers.every((c) => BOT_MODULES.indexOf(c) >= 0),
          "I: `" + k + "` is hidden without a bot, but `" + rel + "` reads it in `" + fn + "`, which something other than the bot calls",
          callers);
      }
    }
  }

  const nameEx = P.extractNamed("ui/chat.js", "_settingDisplayName");
  ok(nameEx.ok, "I: stage — " + nameEx.stage);
  const panelSrc = fs.readFileSync(path.join(ROOT, "ui/settings.js"), "utf8");
  const drive = (kind, overrides) => {
    const idle = (kind === "bot") ? IDLE : [];
    const node = (tag) => ({ tag, attrs: {}, text: "", children: [], style: {}, dataset: {}, className: "",
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      appendChild(c) { this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      get firstChild() { return this.children[0] || null; },
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k]; },
      get textContent() { return this.text; }, set textContent(v) { this.text = String(v); }, remove() {} });
    // Mirrors the real `el`: onclick/disabled/value are PROPERTIES, everything else an attribute.
    const el = (tag, a, kids) => {
      const n = node(tag);
      if (a) for (const k in a) {
        if (k === "text") n.text = String(a[k]); else if (k === "class") n.className = a[k];
        else if (k === "onclick") n.onclick = a[k]; else if (k === "disabled") n.disabled = a[k];
        else if (k === "value") n.value = a[k]; else n.attrs[k] = String(a[k]);
      }
      if (kids) for (const c of kids) if (c) n.children.push(c);
      return n;
    };
    const box = node("div");
    const settings = Object.assign(BE.StateDeriver.defaultSettings(), overrides || {});
    const ctx = {
      UIBase: { refs: { settingsBox: box }, host: { el, clear: (n) => { if (n) n.children = []; },
        settingsLocked: () => false, setSettingsLocked() {} } },
      Room: { getSettings: () => settings, getSettingRanges: () => BE.StreamManager.settingRanges(),
        getSettingRows: () => BE.Ranks.LADDER.map((r) => ({ name: r.name, editable: r.name !== "uncategorized" })),
        editSettingTable: () => null, idleSettings: () => idle.slice(), getMyAuthorityLevel: () => 100,
        overrideFromFile: async () => ({ ok: true }) },
      Actions: { describe: () => ({ enabled: true, reason: null }), perform: () => Promise.resolve({ ok: true }) },
      BotRuntime: { botInRoom: () => kind !== "consensus" },
      ChatPanels: {}, Screens: { renderExportSection() {} },
      Media: { safeBgUrl: () => null }, ChatPrefs: { bgOpts: () => ({ bgOn: true, hostAllowed: () => true }) },
      BotSettings: { decide: () => ({ ok: false }) }, Logger: { info() {}, warn() {}, debug() {}, error() {} },
      document: { createElement: node, body: node("body") }, setTimeout: () => 0, clearTimeout() {},
      console, Date, Math, JSON, Promise, Object, Array, String, Number, Set, Error,
    };
    vm.createContext(ctx);
    vm.runInContext(nameEx.source + "\n;globalThis.__name = _settingDisplayName;", ctx);
    ctx.ChatPanels._settingDisplayName = ctx.__name;
    vm.runInContext(panelSrc + "\n;globalThis.__S = Settings;", ctx);
    const find = (n, pred, out) => { out = out || []; if (!n || typeof n !== "object") return out;
      if (pred(n)) out.push(n); for (const c of (n.children || [])) find(c, pred, out); return out; };
    let threw = null;
    const guard = (fn) => { try { fn(); } catch (e) { threw = threw || e.message; } };
    guard(() => ctx.__S.renderSettings());
    // Open every section and subsection by clicking its header, as a person would. A subsection
    // only exists once its parent is open, so this repeats until nothing closed is left.
    let clicks = 0;
    for (let pass = 0; pass < 60; pass++) {
      const closed = find(box, (n) => /^set-(sec|sub)-head$/.test(n.className) && n.attrs["aria-expanded"] === "false");
      if (!closed.length) break;
      clicks++; guard(() => closed[0].onclick());
    }
    const dt = find(box, (n) => n.tag === "button" && /^(Choose|See) what others/.test(n.text));
    if (dt.length) guard(() => dt[0].onclick());
    const byName = {}; for (const k of KEYS) byName[ctx.__name(k)] = k;
    return {
      threw, clicks,
      shown: new Set(find(box, (n) => n.attrs && n.attrs["data-key"]).map((n) => n.attrs["data-key"].split(":")[0])),
      delegated: find(box, (n) => /delegation-key/.test(n.className)).map((n) => byName[n.text] || n.text),
      notice: find(box, (n) => n.className === "set-notice").length > 0,
    };
  };
  const minus = (a, b) => a.filter((k) => b.indexOf(k) < 0);
  const same = (set, want) => want.every((k) => set.has(k)) && [...set].every((k) => want.indexOf(k) >= 0);

  const withBot = drive("consensusBot");
  ok(withBot.threw === null, "I: the panel threw in a consensus room with a bot (" + withBot.threw + ")");
  ok(withBot.clicks >= 5, "I: APPLIED — sections were opened by clicking their headers", withBot.clicks);
  ok(same(withBot.shown, KEYS), "I: a consensus room with a bot shows EVERY setting — all of them act there",
    { missing: minus(KEYS, [...withBot.shown]), extra: minus([...withBot.shown], KEYS) });

  const bot = drive("bot");
  ok(bot.threw === null, "I: the panel threw in a bot room (" + bot.threw + ")");
  ok(same(bot.shown, minus(KEYS, IDLE)), "I: a bot room shows every setting EXCEPT the ones its engine never acts on",
    { missing: minus(minus(KEYS, IDLE), [...bot.shown]), shownButIdle: IDLE.filter((k) => bot.shown.has(k)) });
  ok(bot.delegated.length > 0 && !bot.delegated.some((k) => IDLE.indexOf(k) >= 0),
    "I: nor does a bot room offer to DELEGATE a setting that does nothing there", bot.delegated.filter((k) => IDLE.indexOf(k) >= 0));

  const noBot = drive("consensus");
  ok(noBot.threw === null, "I: the panel threw in a consensus room with no bot (" + noBot.threw + ")");
  ok(same(noBot.shown, minus(KEYS, BOT_ONLY)), "I: with no bot, the five bot-only settings are hidden and every other one — presence included — is shown",
    { missing: minus(minus(KEYS, BOT_ONLY), [...noBot.shown]), shownButInert: BOT_ONLY.filter((k) => noBot.shown.has(k)) });
  ok(noBot.notice, "I: and the one line saying where they went is shown in their place");

  const spineOff = drive("consensusBot", { botPresenceSpine: false });
  ok(!spineOff.shown.has("activityPresence") && !spineOff.shown.has("activityQueue") && spineOff.shown.has("botPresenceSpine"),
    "I: with room actions not counted at all, the per-action lists (which then decide nothing) are hidden",
    [...spineOff.shown].filter((k) => /^activity/.test(k)));
}

console.log("[settings-rows] PASS — the settings tables have one row per ladder rung: guest is a real settable row, uncategorized is shown and locked as a structural rule rather than a dial, an edit posts a complete table and moves only the cell edited (so editing VIP can no longer flip uncategorized from never to countable), the defaults live in one place instead of two hand-maintained copies with VIP as the lowest rung that counts, and a short table is now rejected outright rather than padded — with the fallback strict enough that losing a room's settings tightens it rather than loosening it");
