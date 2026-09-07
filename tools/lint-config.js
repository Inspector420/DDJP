// tools/lint-config.js
// THE LINT CONFIG IS GENERATED, NOT COMMITTED — so it cannot drift from the tree it describes.
//
// Every module in this app is a script-tag global, so a linter with none declared reports 1649
// `no-undef` findings that are all the same non-fact. The globals are DERIVED from
// `tests/_load.js`'s KNOWN_GLOBALS, a list this tree already maintains and already guards
// (`check-reputation` PART F). A second hand-written copy would drift the day a module was added —
// the copied-rule category, declined in advance.
const { knownGlobals } = require("./lint-globals.js");

// Globals the app uses that are NOT its own modules. Each is named with what it is, because a bare
// list of strings is the thing this file exists to avoid.
const EXTERNAL_GLOBALS = {
  matrixcs: "the vendored matrix-js-sdk bundle in lib/, loaded by a script tag before the app",
  YT: "the YouTube IFrame API, injected by Google's loader script at runtime",
};

// ── THE ONLY RELAXED RULE, WITH ITS REASON ────────────────────────────────────────────────
// `check-control-styling`'s discipline: an exemption carries a reason beside it and the list is
// asserted EXHAUSTIVE, so a new one cannot join silently.
const EXEMPTIONS = {
  "no-unused-vars:ui/interface.js:_resetChatState":
    "`_resetChatState` is unused by production code AND EXTRACTED BY NAME by `check-chat-tiers` " +
    "and `probe-j12-tiers`, which brace-match from the declaration. Removing it makes those " +
    "REFUSE rather than fail, and a refusal reads like a pass to anyone not watching — so this " +
    "job stops here rather than reshaping an extracted region, exactly as the lint-only rule " +
    "requires. It is a real finding parked with its reason, not a rule switched off: the rest of " +
    "`no-unused-vars` stays on and four other dead bindings were removed at the code.",
  "no-empty:allowEmptyCatch":
    "218 findings, and they are one deliberate house idiom: `try { … } catch (e) {}` around a " +
    "read that must never block the caller — the comments in the tree call it 'never block the " +
    "backstop'. An empty catch is load-bearing here, and the alternative is 218 no-op statements " +
    "that say nothing. Empty blocks that are NOT catches remain errors.",
};

function build() {
  const globals = {};
  // The app's own modules: assigned by their own file, read by every other one.
  for (const n of knownGlobals()) globals[n] = "writable";
  for (const n of Object.keys(EXTERNAL_GLOBALS)) globals[n] = "readonly";
  return {
    // The one PARKED finding is silenced at its single site rather than by relaxing the rule
    // anywhere else — see EXEMPTIONS for why it cannot be removed.
    overrides: [{
      files: ["ui/interface.js"],
      rules: { "no-unused-vars": ["error", {
        varsIgnorePattern: "^(" + knownGlobals().concat(["_resetChatState"]).join("|") + ")$",
        args: "none",
      }] },
    }],
    root: true,
    env: { browser: true, es2022: true, commonjs: true },
    parserOptions: { ecmaVersion: 2022, sourceType: "script" },
    extends: "eslint:recommended",
    globals: globals,
    rules: {
      // NOT SWITCHED OFF — configured. `no-undef` and `no-redeclare` are two halves of one
      // property (every name resolves to exactly one declaration), and disabling half is the
      // asymmetry that lets a defect through. `builtinGlobals:false` stops a config-declared
      // global from counting as a redeclaration of the module that DEFINES it, which is the
      // app's own `const X = (function(){})()` pattern and not a redeclaration at all.
      "no-redeclare": ["error", { builtinGlobals: false }],
      // Same pattern from the other side: a module's top-level const is consumed by OTHER script
      // tags, which this parser cannot see. The ignore pattern is DERIVED from the same list, so
      // it covers exactly the module names and nothing else.
      "no-unused-vars": ["error", {
        varsIgnorePattern: "^(" + knownGlobals().join("|") + ")$",
        args: "none",
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
      // ── ADDED BEYOND `recommended`, AND DRIVEN RATHER THAN ASSUMED ──────────────────────
      // `no-use-before-define` is NOT in `eslint:recommended` — it is opt-in. v288 was a `const`
      // read twelve lines above its declaration, hoisted into a temporal dead zone: it parsed
      // cleanly, threw on every render from first room open, and killed six downstream calls in
      // `enterMainScreen` with the suite green. The recommended set alone does not catch it, which
      // was measured only after the rule that would have settled the job was finally run.
      //
      // `functions: false` because this codebase declares helpers below their call sites
      // throughout — function declarations hoist completely and calling one earlier in the same
      // scope is not a defect. `variables`/`classes` are what the dead zone is about.
      // **NOT ENABLED, AND THE MEASUREMENT IS THE REASON.** Driven both ways: it DOES catch v288
      // (reintroduce the defect and `'cur' was used before it was defined` fires at the exact
      // line). It also reports **48 findings on the clean tree, of which 44 are references inside
      // functions that run later** — legal, safe, and indistinguishable to the rule from a real
      // dead-zone read. ESLint has no option that separates them.
      //
      // 44 of 48 is far past the threshold this tree set at v273: *a guard that cries wolf six
      // times out of thirteen gets disabled, and that is worse than not having it.* Enabling it
      // would mean 44 exemptions, each needing a reason — which is tuning a rule set until it goes
      // quiet, the failure the same entry names.
      //
      // **THE CONDITION THAT WOULD CHANGE THIS:** a rule that distinguishes a deferred reference
      // from a dead-zone one, or a one-time pass over the FOUR shallow findings after which the
      // remaining 44 could be narrowed to a pattern. Both are jobs; neither is this one. What
      // covers v288's class today is `check-settings-render`, which EXECUTES the section.
      // "no-use-before-define": ["error", { functions: false, variables: true, classes: true }],
    },
  };
}
module.exports = { build, EXTERNAL_GLOBALS, EXEMPTIONS };
