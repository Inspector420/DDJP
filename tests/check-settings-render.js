// tests/check-settings-render.js
// WALL: THE SETTINGS PANEL'S SECTIONS ARE EXECUTED, NOT MERELY READ.
//
// ── WHY THIS EXISTS: THE SECOND TIME A UI EXCEPTION KILLED A RENDER CHAIN AND SHIPPED GREEN ──
// v280 was `refs.settingsBody` — one undefined ref, seven downstream calls skipped, three separate
// bug reports from one line. `check-ui-refs` exists because of it, and it passes on THIS defect:
//
//     const set = Object.keys(cur)…      // read
//     const cur = value || {};           // declared TWELVE LINES BELOW
//
// `const` is hoisted into a temporal dead zone, so this threw `ReferenceError: Cannot access 'cur'
// before initialization` on every render from the first room open. **Every `refs.X` in that
// function is assigned**, so the orphan-ref sweep is silent — correctly. Its coverage has a named
// edge: **it proves references RESOLVE, not that the function RUNS.**
//
// That edge is the one this tree has been carrying since v267 as "thirty-five `render*`
// declarations that no guard executes". `_renderDelegationSetting` was one of them, and the cost
// has now been paid twice.
//
// ── WHAT THIS DOES THAT A REF SWEEP CANNOT ──────────────────────────────────────────────────
// It CALLS the section builders, in both of their branches, and asserts they paint. A function
// that throws cannot paint, so any thrower — a dead-zone read, a null return, a real DOM method on
// a faked object — is caught by the same assertion rather than by a rule naming its shape.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let asserts = 0;
function fail(msg, got) {
  console.log("[settings-render] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }

const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");

// Brace-matched extraction over the RAW source. A regex terminating at the next `}` runs past a
// nested block, and a slice ending at the next declaration cuts at an inner helper — both mistakes
// this tree has already made and paid for.
function extract(name) {
  const at = src.indexOf("function " + name + "(");
  if (at < 0) return null;
  let d = 0;
  for (let k = src.indexOf("{", at); k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) return src.slice(at, k + 1); }
  }
  return null;
}

function node(tag) {
  return { tag, kids: [], cls: null, text: null, value: "",
           appendChild(n) { this.kids.push(n); return n; } };
}
function el(tag, attrs, kids) {
  const n = node(tag);
  if (attrs) {
    if (attrs.class) n.cls = attrs.class;
    if (attrs.text !== undefined) n.text = String(attrs.text);
    if (attrs.value !== undefined) n.value = attrs.value;
    if (attrs.onclick) n.onclick = attrs.onclick;
  }
  for (const c of (kids || [])) if (c) n.appendChild(c);
  return n;
}
function flatten(n, out) {
  out = out || [];
  for (const c of (n.kids || [])) { out.push(c); flatten(c, out); }
  return out;
}

// ═══ PART A — THE DELEGATION SECTION RUNS, IN BOTH BRANCHES ═════════════════════════════════
{
  const fn = extract("_renderDelegationSetting");
  // `_settingDisplayName` IS EXTRACTED TOO, NOT STUBBED. The row labels and the summary line both
  // read it, and it is the thing that stopped the delegation table naming settings by raw key
  // while the panel above it used human names for the same ones. A stub here would prove the row
  // paints SOMETHING and nothing about what it says — which is the whole subject.
  const nameFn = extract("_settingDisplayName");
  ok(!!fn, "A: APPLIED — the section builder must be extractable, or nothing below is executed", "not found");

  // THE DEAD-ZONE READ IS DETECTABLE STRUCTURALLY TOO, and cheaply — but the row that matters is
  // the one that RUNS it, because a structural rule only catches the shape it was written for.
  ok(/const cur = \(value && typeof value === "object"\)/.test(fn),
    "A: APPLIED — `cur` must be declared in the function", "not declared");
  const declAt = fn.indexOf("const cur =");
  const firstRead = fn.indexOf("Object.keys(cur)");
  ok(firstRead < 0 || declAt < firstRead,
    "A: `cur` IS DECLARED BEFORE IT IS READ. `const` is hoisted into a temporal dead zone, so a " +
    "read above its declaration throws at RUNTIME while parsing cleanly — which is how this " +
    "shipped green and killed six downstream calls in `enterMainScreen`",
    { declaredAt: declAt, readAt: firstRead });

  function run(opts) {
    const o = opts || {};
    const painted = [];
    const ctx = {
      Room: {
        getSettingRanges: () => (o.noEntry ? {} : {
          botDelegation: { keys: ["maxLen", "minLen", "chat"], values: ["owner", "staff", "vip"] },
        }),
        setSettings: () => {},
      },
      refs: { settingsBox: { appendChild: (n) => painted.push(n) } },
      el, _renderSettingNote: () => {}, renderSettings: () => {},
      _delegationOpen: !!o.open,
    };
    vm.createContext(ctx);
    vm.runInContext(nameFn + "\n" + fn + ";globalThis.__f = _renderDelegationSetting;" +
      "\n;globalThis.__name = _settingDisplayName;", ctx);
    let threw = null;
    try { ctx.__f("What a bot may change", "botDelegation", o.value || {}, true, "a note"); }
    catch (e) { threw = e.constructor.name + ": " + e.message; }
    return { threw, painted, nodes: painted.length ? flatten(painted[0]) : [],
             displayName: ctx.__name };
  }

  // COLLAPSED — the default, and the branch v287 added and never ran.
  const collapsed = run({});
  ok(collapsed.threw === null,
    "A: THE COLLAPSED BRANCH RUNS WITHOUT THROWING. This is the branch that shipped broken: the " +
    "summary line reads `cur`, which the expanded branch declared below it", collapsed.threw);
  ok(collapsed.painted.length === 1,
    "A: and it PAINTS — a function that throws cannot paint, so this one assertion catches any " +
    "thrower rather than only the shape somebody thought of", collapsed.painted.length);
  const cText = collapsed.nodes.map((n) => n.text).filter(Boolean).join(" ");
  ok(/Nothing is delegated/.test(cText),
    "A: with the empty summary, because zero settings are delegated by default and that is the " +
    "view almost every room gets", cText.slice(0, 120));
  ok(collapsed.nodes.filter((n) => n.tag === "select").length === 0,
    "A control: and NO dropdowns — collapsed means collapsed, or the shape decision (22 settings " +
    "× 8 ranks = 176 controls) bought nothing", collapsed.nodes.filter((n) => n.tag === "select").length);

  // EXPANDED — the branch that always worked, driven so the collapsed row is a comparison.
  const open = run({ open: true });
  ok(open.threw === null,
    "A: THE EXPANDED BRANCH RUNS TOO", open.threw);
  ok(open.nodes.filter((n) => n.tag === "select").length === 3,
    "A: painting one dropdown per delegable setting, from the DERIVED domain rather than a list " +
    "here", open.nodes.filter((n) => n.tag === "select").length);

  // ── EVERY ROW IS LABELLED THE WAY THE PANEL ABOVE IT LABELS THE SAME SETTING ───────────────
  // The table listed raw keys — `checkpointRankOffsetMs`, `vouchJitter` — while the rows above it
  // said "Head start for each rank (seconds)" and "Turn-taking step & peer jitter (ms)". One
  // panel, two vocabularies, one setting. Asserted through the same function the row calls, so a
  // rename moves both together rather than only one.
  {
    const texts = open.nodes.map((n) => n.text).filter(Boolean);
    for (const k of ["maxLen", "minLen", "chat"]) {
      const want = open.displayName(k);
      ok(texts.indexOf(want) >= 0,
        "A: the row for `" + k + "` is labelled `" + want + "` — its display name, not its key",
        texts.slice(0, 12));
      ok(want !== k,
        "A: and that display name is genuinely not the key, or the line above proves nothing",
        { key: k, name: want });
    }
    ok(open.displayName("no-such-setting") === "no-such-setting",
      "A: a setting with no name falls back to its KEY rather than to a blank — one added to the "
      + "domain and not named must look unfinished, not invisible",
      open.displayName("no-such-setting"));
  }

  // ── `owner` IS NOT OFFERED AS A DELEGATE ───────────────────────────────────────────────────
  // Delegating a setting TO the owner is a no-op: the owner writes directly and never travels
  // through a bot request, so the option means exactly what "Nobody — owner only" already means.
  {
    const opts = open.nodes.filter((n) => n.tag === "option").map((n) => n.text);
    ok(opts.indexOf("owner") < 0,
      "A: `owner` is not a delegate option — it would duplicate `Nobody — owner only`", opts);
    ok(opts.indexOf("staff") >= 0 && opts.indexOf("vip") >= 0,
      "A CONTROL: the other ranks ARE offered, so the line above is `owner` being skipped rather "
      + "than an empty dropdown", opts);
  }

  // WITH A DELEGATION SET — the summary's other branch.
  const withVal = run({ value: { maxLen: "staff" } });
  ok(withVal.threw === null, "A: and with a value present", withVal.threw);
  const wText = withVal.nodes.map((n) => n.text).filter(Boolean).join(" ");
  ok(/1 setting is delegated: /.test(wText),
    "A: naming what is delegated rather than counting rows nobody set", wText.slice(0, 140));
  // NAMED THE WAY A PERSON READS IT, not by the raw key. Asserted through the same function the
  // panel calls, so a future rename moves both together.
  ok(wText.indexOf(withVal.displayName("maxLen")) >= 0,
    "A: and by the setting's DISPLAY name — the table used to list raw keys while the rows above "
    + "it used human ones, so one panel spoke two vocabularies for one setting",
    { text: wText.slice(0, 140), expected: withVal.displayName("maxLen") });

  // AND THE REFUSAL PATH, so 'it paints' is not true of everything.
  const none = run({ noEntry: true });
  ok(none.threw === null && none.painted.length === 0,
    "A control: with no delegation entry to read, it paints NOTHING and does not throw — so the " +
    "paint assertions above are readings rather than a function that always appends", none);
}

// ═══ PART B — EVERY CALL AFTER `renderSettings` IN `enterMainScreen` IS NAMED ═══════════════
// The consequence is the finding, not the throw. A section that throws skips everything after it,
// and nothing between `renderSettings()` and the end of `enterMainScreen` is inside a `try`.
{
  const at = src.indexOf("function enterMainScreen(");
  ok(at > 0, "B: APPLIED — `enterMainScreen` must be findable", at);
  let d = 0, end = at;
  for (let k = src.indexOf("{", at); k < src.length; k++) {
    if (src[k] === "{") d++;
    else if (src[k] === "}") { d--; if (!d) { end = k + 1; break; } }
  }
  const body = src.slice(at, end);
  const callAt = body.lastIndexOf("\n    renderSettings();");
  ok(callAt > 0, "B: APPLIED — the top-level `renderSettings()` call must be findable", callAt);
  const tail = body.slice(callAt);

  // These six are what v280 lost and what this defect lost again. Named so a future edit that
  // moves one out of the tail — or wraps the call — is a deliberate act rather than an accident.
  for (const call of ["renderLogs()", "ChatPrefs.load()", "_setLayout(", "_applyDisplayDims()",
                      "renderChatSettings()", "_renderGear()"]) {
    ok(tail.indexOf(call) >= 0,
      "B: `" + call + "` runs AFTER `renderSettings()` and is therefore skipped when a settings " +
      "section throws. This is the chain that produced the all-panels-combined display twice — " +
      "`_setLayout` never told the panels which to show, `_applyDisplayDims` never sized the " +
      "player, `ChatPrefs.load` never loaded a single preference", call);
  }
  ok(!/try\s*\{[\s\S]{0,40}renderSettings\(\);/.test(tail.slice(0, 60)),
    "B: and the call is NOT wrapped in a try — recorded as the fact it is rather than assumed. " +
    "Wrapping it would hide the next thrower instead of preventing it, which is why the fix is " +
    "always at the section", "wrapped");
}

// ═══ PART C — THE SAVES DESTINATION, CARRIED ACROSS A NAVIGATION ═══════════════════════════
// `mutate-v288` M7 and M8 were green because **nothing drove the Saves button or its destination
// at all** — item 2 shipped unguarded. That is not a fixture gap; it is cross-screen state living
// in the render path that has now cost two releases, and it is exactly the kind that breaks
// quietly: a flag set on one screen and read on another fails by doing nothing.
//
// Driven by EXTRACTING the two halves and running them against a recording panel — the flag is a
// module-level `let`, so the setter and the reader are executed in one context and the second sees
// what the first wrote.
{
  const setter = extract("savesButton");
  ok(!!setter, "C: APPLIED — the Saves button builder must be extractable", "not found");
  ok(/_savesWanted = room\.spaceId/.test(setter),
    "C: THE BUTTON CARRIES A DESTINATION. Without it, `Saves` is `Open` with a different label — " +
    "the state the owner reported three times, each time answered as though the ask were a menu",
    "no destination");

  const opener = extract("openButton");
  ok(!!opener && /_savesWanted = null/.test(opener),
    "C control: and `Open` CLEARS it, so an ordinary open cannot inherit a destination somebody " +
    "asked for earlier and land somewhere nobody chose", opener ? "no clear" : "not found");

  // The reader, lifted out of `enterMainScreen`'s tail.
  const at = src.indexOf("    if (_savesWanted) {");
  ok(at > 0, "C: APPLIED — the destination must be READ somewhere, or the flag is a variable " +
    "nothing acts on", at);
  let d2 = 0, rEnd = at;
  for (let k = src.indexOf("{", at); k < src.length; k++) {
    if (src[k] === "{") d2++;
    else if (src[k] === "}") { d2--; if (!d2) { rEnd = k + 1; break; } }
  }
  const reader = src.slice(at, rEnd);

  function drive(wanted) {
    const scrolled = [];
    const tabs = [];
    const ctx = {
      Logger: { warn: () => {} },
      _savesWanted: wanted,
      rightTab: "chat",
      _relockAllPanels: () => {},
      renderRightPanel: () => tabs.push(ctx.rightTab),
      refs: { settingsExport: { scrollIntoView: (o) => scrolled.push(o) } },
    };
    vm.createContext(ctx);
    vm.runInContext(reader + "\n;globalThis.__left = _savesWanted;", ctx);
    return { tab: ctx.rightTab, scrolled, tabs, left: ctx.__left };
  }

  const landed = drive("!room:hs");
  ok(landed.tab === "roomset",
    "C: WITH A DESTINATION SET, the panel switches to room settings — the section is built by " +
    "`renderSettings`, so this is the only screen on which the saves exist", landed.tab);
  ok(landed.scrolled.length === 1,
    "C: and scrolls to the saves section, which is what makes it a DESTINATION rather than a " +
    "second way to open the room", landed.scrolled);
  ok(landed.left === null,
    "C: and the flag is CLEARED as it is read — a destination that survived would send the next " +
    "ordinary open somewhere nobody asked for", landed.left);

  const plain = drive(null);
  ok(plain.tab === "chat" && plain.scrolled.length === 0,
    "C control: with no destination the panel is untouched, so the landing above is a reading of " +
    "the flag rather than something that happens on every room open", plain);
}

// ── EVERY `optionRow` CALL PASSES [val, text] PAIRS ──────────────────────────────────────────
// `optionRow` destructures `options.forEach(([val, text]) => ...)`. A row passing
// `[{ value, label }]` throws "object is not iterable" — and nothing between `renderSettings()`
// and the end of `enterMainScreen` is inside a `try`, so `_setLayout`, `_applyDisplayDims`,
// `renderLogs`, `ChatPrefs.load`, `renderChatSettings` and `_renderGear` NEVER RUN. The room opens
// with every panel drawn on top of every other and the chat rendered twice.
//
// SHIPPED AT v337 and reported from a live room. It is the third time a throw in this one function
// has produced that display, and the second time the whole layout was lost to a one-line mistake
// in a settings row. The shape is cheap to check and the consequence is the entire screen.
{
  const src = require("fs").readFileSync(
    path.join(__dirname, "..", "ui", "interface.js"), "utf8");

  const re = /optionRow\((?:optionRow,\s*)?"([a-zA-Z]+)"[\s\S]{0,240}?\n\s*(\[\[|\[\{)/g;
  const pairs = [], objects = [];
  let m;
  while ((m = re.exec(src))) { (m[2] === "[[" ? pairs : objects).push(m[1]); }

  ok(pairs.length >= 5,
    "APPLIED — the option rows were found, or this measurement has no subject", pairs);
  ok(objects.length === 0,
    "every `optionRow` passes [val, text] PAIRS. An object-shaped option throws on the forEach "
    + "destructure and takes the whole main-screen layout with it, because nothing after "
    + "`renderSettings()` in `enterMainScreen` is inside a try", objects);

  // AND THE CONTRACT ITSELF, so this stays anchored if `optionRow` is ever rewritten to accept
  // objects — at which point the assertion above should be deleted, not worked around.
  ok(/options\.forEach\(\(\[val, text\]\)/.test(src),
    "and `optionRow` still destructures pairs, which is WHY the shape matters");
}

console.log("[settings-render] PASS — the settings panel's sections are EXECUTED, not merely read " +
  "(" + asserts + " assertions). THIS IS THE SECOND TIME A UI EXCEPTION KILLED A RENDER CHAIN AND " +
  "SHIPPED GREEN. v280 was an undefined ref and `check-ui-refs` exists because of it; **that guard " +
  "passes on this one**, correctly — every `refs.X` here is assigned. Its coverage has a named " +
  "edge: **it proves references RESOLVE, not that the function RUNS.** The defect was `const cur` " +
  "declared twelve lines below its first read — hoisted into a temporal dead zone, so it parsed " +
  "cleanly and threw on every render from the first room open, taking `renderLogs`, " +
  "`ChatPrefs.load`, `_setLayout`, `_applyDisplayDims`, `renderChatSettings` and `_renderGear` " +
  "with it. The all-panels-combined display and the missing delegation table were ONE bug. This " +
  "guard CALLS the section in both branches and asserts it paints, so any thrower is caught by " +
  "one assertion rather than by a rule naming its shape");
