// tests/check-rep-boundary.js
// SUBJECT: features/rep-rules.js, features/rep-ports.js, features/botruntime.js, backends/backend1/statederiver.js, index.html
//
// WALL: REP IS ITS OWN ENTITY, WITH NO SPAGHETTI (J84, the owner's ruling 21). Three pieces — the pure rules, the bot
// side, the reader side — reach the rest of the app only through one ports file, and the app reaches them only at named
// hook sites. Nothing REP-specific goes inside the bot runtime, the engines, the fold or the UI beyond those hooks. This
// guard holds the boundary from both sides, over every `features/rep-*.js` that exists, so a piece added later is in
// scope the day it is added.
//
//   A  THE RULES ARE PURE: `rep-rules.js` names no app global and no clock, timer or storage, and loads in an empty
//      sandbox.
//   B  THE PIECES SPEAK ONLY TO THE RULES AND THE PORTS: every other `rep-*.js` names no app global besides `RepRules` and
//      `RepPorts`.
//   C  THE PORTS ARE THE ONE DOOR: `rep-ports.js` is the only REP file naming app globals, and only the nine it declares.
//   D  THE APP REACHES REP ONLY AT THE HOOK SITES: outside REP's files a REP global appears only where `HOOK_SITES`
//      allows, each with its reason — the script tags, since J84-2 `features/room.js`'s H1 (`Rep.enter`, after the
//      bot's evaluation) and H2 (`Rep.leave`, in the one leave step), each exactly once and nowhere else in that file,
//      since J84-3 `ui/roster.js`'s H3 (`Rep.badge`, the People tab's row), once, and since J84-5 `ui/settings.js`'s H4
//      (`Rep.botCard`, the Bot card), once. And REP's own files name no hook `Rep` does not list (J104).
//   E  NO REP INSIDE THE BOT RUNTIME, THE ENGINES OR THE FOLD: no REP identifier and no REP type name there. The engines
//      know the side class's prefix (`ddjp.side.`) and nothing more.
//   F  ONE PLACE DECIDES SELF-VOTES AND SELF-SAVES: the two switches are read only by the rules piece, beside the
//      schema, the panel's row and the delegation list's display names.
//   G  ONE LIST OF A SIDE MESSAGE'S RESERVED FIELDS (J103, ruling 46): the transport's; no REP file keeps a copy of it.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rep-boundary] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// Code only: block and line comments removed, and string contents kept (a type name in a string is code).
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => {
  let out = "", q = null;
  for (let i = 0; i < l.length; i++) {
    const c = l[i];
    if (q) { out += c; if (c === "\\") { out += l[i + 1] || ""; i++; } else if (c === q) q = null; continue; }
    if (c === "/" && l[i + 1] === "/") break;
    if (c === "\"" || c === "'" || c === "`") q = c;
    out += c;
  }
  return out;
}).join("\n");
// Identifiers only: `code` with every string's contents emptied. A browser global's name in English inside a log line —
// the design's "beyond the window" (ruling 20) — reaches nothing; a global is reached through an identifier (J84-4).
// BUT A TEMPLATE LITERAL'S `${…}` IS CODE, and is kept (J84-5, found at `ddjp_581`'s check: emptying templates whole let
// `\`${StreamManager.getState()}\`` through, green, while the same reach outside a template was red). One pass over the
// whole file, so a template spanning lines is read as one; nested templates and strings inside `${…}` are followed.
const idsOf = (src) => {
  const n = src.length;
  let out = "", i = 0;
  function quoted(q) {                  // '…' or "…": the quotes kept, the contents dropped
    out += q; i++;
    while (i < n) { const c = src[i]; if (c === "\\") { i += 2; continue; } if (c === q || c === "\n") { out += c; i++; return; } i++; }
  }
  function template() {                 // `…`: the text dropped, every ${…} kept as code
    out += "`"; i++;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { out += "`"; i++; return; }
      if (c === "$" && src[i + 1] === "{") { out += "${"; i += 2; expression(); continue; }
      if (c === "\n") out += c;
      i++;
    }
  }
  function expression() {               // inside ${ … } up to its own closing brace
    let depth = 1;
    while (i < n) {
      const c = src[i];
      if (c === "\"" || c === "'") { quoted(c); continue; }
      if (c === "`") { template(); continue; }
      if (c === "{") depth++;
      if (c === "}" && --depth === 0) { out += "}"; i++; return; }
      out += c; i++;
    }
  }
  while (i < n) {
    const c = src[i];
    if (c === "\"" || c === "'") { quoted(c); continue; }
    if (c === "`") { template(); continue; }
    out += c; i++;
  }
  return out;
};
const ids = (rel) => idsOf(code(rel));
const listJs = (dir) => fs.existsSync(path.join(ROOT, dir)) ? fs.readdirSync(path.join(ROOT, dir)).filter((f) => f.endsWith(".js")).map((f) => dir + "/" + f) : [];
const word = (name) => new RegExp("(^|[^A-Za-z0-9_$.])" + name.replace(/\./g, "\\.") + "(?![A-Za-z0-9_$])");

const REP_FILES = listJs("features").filter((f) => /^features\/rep-[a-z]+\.js$/.test(f));
const REP_GLOBALS = ["RepRules", "RepPorts", "RepBot", "RepReader", "Rep"];
// Every app global a REP piece could reach for. The ports may name the nine they declare; nothing else in REP names any.
const APP_GLOBALS = ["StreamManager", "MatrixBridge", "MatrixAccount", "Capabilities", "Room", "Chat", "ServerClock", "Store",
  "BotRuntime", "BotSettings", "Logger", "Backends", "StateDeriver", "Ranks", "History", "Floor", "Vouch", "Checkpoint",
  "EventCache", "Session", "Scheduler", "B1MatrixBridge", "B1StreamManager", "B2Runner", "B2Authority", "B2Checkpoint",
  "Actions", "Queue", "Playback", "Reactions", "UserQueue", "ChatPrefs", "StorageIO", "IDB", "Interface", "Screens",
  "Settings", "Panels", "Roster", "Shell", "localStorage", "sessionStorage", "indexedDB", "navigator", "window", "document"];
const PORTS_MAY_NAME = ["StreamManager", "MatrixBridge", "Capabilities", "Room", "Chat", "ServerClock", "Store", "BotRuntime", "Logger"];

ok(REP_FILES.indexOf("features/rep-rules.js") >= 0 && REP_FILES.indexOf("features/rep-ports.js") >= 0,
  "PREMISE — REP's rules and ports exist, and the scan finds them", REP_FILES);

// ── A — THE RULES ARE PURE ──────────────────────────────────────────────────────────────────────────────────────────
{
  const c = code("features/rep-rules.js");
  const named = APP_GLOBALS.concat(["Date", "setTimeout", "setInterval", "fetch", "crypto", "TextEncoder"]).filter((g) => word(g).test(c));
  ok(named.length === 0, "A: `rep-rules.js` names no app global, no clock, no timer, no storage — every input is an argument", named);
  let loaded = false;
  try { const ctx = vm.createContext({}); vm.runInContext(read("features/rep-rules.js") + "\n;this.R = RepRules;", ctx); loaded = !!ctx.R; } catch (e) { loaded = false; }
  ok(loaded, "A: and it loads in a sandbox holding nothing but the language");
}

// ── B — THE PIECES SPEAK ONLY TO THE RULES AND THE PORTS ────────────────────────────────────────────────────────────
// THE READER ITSELF, BOTH WAYS (J84-5): what B reads is held here before B relies on it — a reach inside `${…}` is code,
// English in a string or in a template's text is not.
{
  const sees = (src) => APP_GLOBALS.filter((g) => word(g).test(idsOf(src)));
  ok(sees("const f = () => `${StreamManager.getState()}`;").join() === "StreamManager",
    "B: the identifier reader keeps a template's `${…}` — a global reached inside one is seen", sees("const f = () => `${StreamManager.getState()}`;"));
  ok(sees("const f = () => `a ${\"q\" + `${Room.x}`} b`;").join() === "Room", "B: and one nested in a template inside `${…}`", sees("const f = () => `a ${\"q\" + `${Room.x}`} b`;"));
  ok(sees("log(\"beyond the window\"); log(`the window ${n} days`);").length === 0,
    "B: and drops the words of a string and of a template's text — \"the window\" reaches nothing", sees("log(\"beyond the window\"); log(`the window ${n} days`);"));
  ok(sees("const t = `line one\n${Store.rep}\nline three`;").join() === "Store", "B: a template spanning lines is read as one", sees("const t = `line one\n${Store.rep}\nline three`;"));
}
for (const f of REP_FILES.filter((x) => x !== "features/rep-rules.js" && x !== "features/rep-ports.js")) {
  const c = code(f);
  const named = APP_GLOBALS.filter((g) => word(g).test(ids(f)));
  ok(named.length === 0, "B: `" + f + "` names no app global — it reaches the app through `RepPorts` only", named);
  ok(/\bRepRules\./.test(c), "B: and it counts through `RepRules`, never with a copy of the rules", f);
}

// ── C — THE PORTS ARE THE ONE DOOR ──────────────────────────────────────────────────────────────────────────────────
{
  const c = code("features/rep-ports.js");
  const named = APP_GLOBALS.filter((g) => word(g).test(c));
  const extra = named.filter((g) => PORTS_MAY_NAME.indexOf(g) < 0);
  ok(extra.length === 0, "C: `rep-ports.js` names only the nine modules it declares — never an engine internal or the UI", extra);
  ok(named.length > 0, "C: APPLIED — the ports do name the modules they reach", named);
  ok(!/\bRepRules\b/.test(c), "C: and the ports decide nothing: they do not consult the rules");
}

// ── D — THE APP REACHES REP ONLY AT THE HOOK SITES ──────────────────────────────────────────────────────────────────
// file -> the REP globals it may name, and why. H1 (`Rep.enter`, room entry and rank changes) and H2 (`Rep.leave`, J83's
// one leave step) joined with the bot side (J84-2); H3 (`Rep.badge`, the People tab row) joins with the reader (J84-3), H4
// (`Rep.botCard`, the Bot card) with commands and files (J84-5).
const HOOK_SITES = {
  "features/room.js": ["Rep"],   // H1 and H2 (J84-2): the one entry, `Rep`, and only it
  "ui/roster.js": ["Rep"],       // H3 (J84-3): the People tab's row asks `Rep.badge`
  "ui/settings.js": ["Rep"],     // H4 (J84-5): the Bot card asks `Rep.botCard`, on the bot's own tab
};
{
  const appFiles = ["app.js"].concat(listJs("core"), listJs("features"), listJs("ui"), listJs("backends/backend1"), listJs("backends/backend2"), listJs("backends/backend3"))
    .filter((f) => REP_FILES.indexOf(f) < 0 && fs.existsSync(path.join(ROOT, f)));
  const breaches = [];
  for (const f of appFiles) {
    const c = code(f);
    for (const g of REP_GLOBALS) {
      const re = g === "Rep" ? /(^|[^A-Za-z0-9_$.])Rep\.[A-Za-z_$]/ : word(g);   // `Rep` the entry is named by its calls
      if (!re.test(c)) continue;
      if ((HOOK_SITES[f] || []).indexOf(g) >= 0) continue;
      breaches.push(f + " names " + g);
    }
  }
  ok(breaches.length === 0, "D: outside REP's files no code names a REP global except at a hook site", breaches);
  // AND THE HOOK SITES ARE WHERE THEY SAY: in `features/room.js`, `Rep` is called exactly twice — `Rep.enter` inside the
  // bot's evaluation (H1) and `Rep.leave` inside the one leave step (H2) — and for nothing else.
  const rm = code("features/room.js");
  const calls = (rm.match(/(^|[^A-Za-z0-9_$.])Rep\.([A-Za-z_$]+)\s*\(/g) || []).map((m) => m.replace(/^[^R]*Rep\./, "").replace(/\s*\($/, ""));
  const within = (start, end, what) => { const a = rm.indexOf(start), b = rm.indexOf(end, a + 1), i = rm.indexOf(what, a); return a >= 0 && b > a && i > a && i < b; };
  ok(JSON.stringify(calls.sort()) === JSON.stringify(["enter", "leave"]), "D: `features/room.js` calls `Rep.enter` and `Rep.leave`, once each, and nothing else of REP", calls);
  ok(within("function _evaluateBot() {", "function _evaluateBotRuntime() {", "Rep.enter(") && within("function leave(why, opts) {", "StreamManager.reset(", "Rep.leave("),
    "D: H1 sits in the bot's evaluation (after the runtime decided) and H2 in the leave's first step, before the engine resets");
  // H3: in `ui/roster.js`, `Rep` is called exactly once — `Rep.badge`, inside the People tab's one REP helper, which the
  // row builder asks — and for nothing else; no other UI file names REP (the breach scan above).
  const ro = code("ui/roster.js");
  const rcalls = (ro.match(/(^|[^A-Za-z0-9_$.])Rep\.([A-Za-z_$]+)\s*\(/g) || []).map((m) => m.replace(/^[^R]*Rep\./, "").replace(/\s*\($/, ""));
  const inHelper = (() => { const a = ro.indexOf("function _repBadge("), b = ro.indexOf("function renderRoster(", a + 1), i = ro.indexOf("Rep.badge(", a); return a >= 0 && b > a && i > a && i < b; })();
  ok(JSON.stringify(rcalls) === JSON.stringify(["badge"]) && inHelper && /_repBadge\(m\.userId\)/.test(ro.slice(ro.indexOf("function renderRoster("))),
    "D: `ui/roster.js` calls `Rep.badge` once, in `_repBadge`, which the People tab's row builder asks — and nothing else of REP", rcalls);
  // H4: in `ui/settings.js`, `Rep` is called exactly once — `Rep.botCard`, inside the REP section, which only the Bot card
  // (`_botViewSection`, the bot's own tab) asks — and for nothing else.
  const st = code("ui/settings.js");
  const scalls = (st.match(/(^|[^A-Za-z0-9_$.])Rep\.([A-Za-z_$]+)\s*\(/g) || []).map((m) => m.replace(/^[^R]*Rep\./, "").replace(/\s*\($/, ""));
  const inSection = (() => { const a = st.indexOf("function _repSection("), b = st.indexOf("function _repRow(", a + 1), i = st.indexOf("Rep.botCard(", a); return a >= 0 && b > a && i > a && i < b; })();
  const fromCard = (() => { const a = st.indexOf("function _botViewSection("), b = st.indexOf("function _repSection(", a + 1), i = st.indexOf("_repSection(sec)", a); return a >= 0 && b > a && i > a && i < b; })();
  ok(JSON.stringify(scalls) === JSON.stringify(["botCard"]) && inSection && fromCard,
    "D: `ui/settings.js` calls `Rep.botCard` once, in the REP section the Bot card alone builds — and nothing else of REP", scalls);
  const html = read("index.html");
  ok(/features\/rep-rules\.js\?v=/.test(html) && /features\/rep-ports\.js\?v=/.test(html), "D: the page loads both REP files (their two script tags)");
  // AND REP'S OWN FILES NAME ONLY THESE HOOKS (J104). The hooks are the ones `Rep` lists beside its code in `rep-ports.js`
  // (`H<n> \`Rep.<fn>(…)\``), one per function `Rep` has; any hook number REP's files name, comments included, must be one
  // of them. Before J104 the ports file's header said "H1–H5"; there are four.
  const portsSrc = read("features/rep-ports.js");
  const listed = [...portsSrc.matchAll(/^\/\/\s+H(\d+) `Rep\.(\w+)\(/gm)].map((m) => [Number(m[1]), m[2]]);
  const rctx = vm.createContext({});
  let repKeys = [];
  try { vm.runInContext(portsSrc + "\n;this.__rep = Rep;", rctx); repKeys = Object.keys(rctx.__rep || {}).sort(); } catch (e) { repKeys = []; }
  ok(repKeys.length >= 4 && JSON.stringify(listed.map((x) => x[1]).sort()) === JSON.stringify(repKeys) &&
     listed.every((x, i) => x[0] === i + 1),
    "D PREMISE — `Rep` lists its hooks beside its code, H1 up, one per function it has", { listed, repKeys });
  const named = [];
  for (const f of REP_FILES) for (const m of read(f).matchAll(/\bH(\d+)\b/g)) named.push(f + ": H" + m[1]);
  const unknown = named.filter((x) => !listed.some((h) => x.endsWith(": H" + h[0])));
  ok(named.length > 0 && unknown.length === 0, "D: EVERY HOOK REP'S FILES NAME IS ONE `Rep` HAS (H1–H" + listed.length + ")", unknown);
}

// ── E — NO REP INSIDE THE BOT RUNTIME, THE ENGINES OR THE FOLD ──────────────────────────────────────────────────────
{
  const inside = ["features/botruntime.js", "core/backends.js"].concat(listJs("backends/backend1"), listJs("backends/backend2"), listJs("backends/backend3"));
  const repWords = /\b(RepRules|RepPorts|RepBot|RepReader)\b|\bRep\.|rep-rules|rep-ports|rep-bot|rep-reader|ddjp\.side\.rep/;
  const hits = inside.filter((f) => repWords.test(code(f)));
  ok(hits.length === 0, "E: the bot runtime, the seam and the engines name nothing of REP — no global, no file, no type", hits);
  const sideNames = inside.filter((f) => /ddjp\.side\.[a-z]/.test(code(f)));
  ok(sideNames.length === 0, "E: and no side TYPE is named there at all — the engines know only the class's prefix", sideNames);
  ok(/"ddjp\.side\."/.test(code("backends/backend1/vouch.js")), "E: APPLIED — the prefix is defined once, in `vouch.js`");
  const sd = code("backends/backend1/statederiver.js");
  const keysOnly = sd.replace(/\b(repSummaryMs|repSelfVotes|repSelfSaves)\b/g, "");
  ok(!/\brep[A-Z]|\bREP\b/.test(keysOnly), "E: the reducer holds REP's three settings keys and nothing else of REP");
}

// ── F — ONE PLACE DECIDES SELF-VOTES AND SELF-SAVES ─────────────────────────────────────────────────────────────────
{
  const MAY = ["features/rep-rules.js", "backends/backend1/statederiver.js", "ui/settings.js", "ui/chat.js"];
  const all = ["app.js"].concat(listJs("core"), listJs("features"), listJs("ui"), listJs("backends/backend1"), listJs("backends/backend2"));
  const readers = all.filter((f) => /\brepSelf(Votes|Saves)\b/.test(code(f)));
  ok(readers.every((f) => MAY.indexOf(f) >= 0), "F: the self-vote and self-save switches are read only by the rules piece (beside the schema, the panel row and the display names)",
    readers.filter((f) => MAY.indexOf(f) < 0));
  ok(readers.indexOf("features/rep-rules.js") >= 0, "F: APPLIED — and the rules piece does read them", readers);
}

// ── G — ONE LIST OF A SIDE MESSAGE'S RESERVED FIELDS (the owner's ruling 46, J103) ──────────────────────────────────────
// The fields a side message may not carry are the transport's list (`MatrixBridge.sideReserved`), and REP's readers are
// handed it. Until J103 `rep-rules.js` kept a copy that matched with nothing comparing the two. So: no REP file holds any of
// the list's names as a string of its own — beyond the four the transport stamps (`RepRules.STAMPED`), which a reader takes
// off a message before it reads it. The list is read from the REAL transport, never written out here.
{
  const LIST = require(path.join(__dirname, "_load.js")).transportSideReserved();
  let stamped = null;
  try { const ctx = vm.createContext({}); vm.runInContext(read("features/rep-rules.js") + "\n;this.R = RepRules;", ctx); stamped = ctx.R.STAMPED; } catch (e) { stamped = null; }
  ok(Array.isArray(LIST) && Array.isArray(stamped) && stamped.every((k) => LIST.indexOf(k) >= 0),
    "G: PREMISE — the transport hands out its one list (ruling 46), and the four stamped fields are in it", { stamped, LIST });
  const names = (LIST || []).filter((k) => (stamped || []).indexOf(k) < 0);
  const literals = (src) => Array.from(src.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)).map((m) => (m[1] !== undefined ? m[1] : m[2]));
  const copies = REP_FILES.map((f) => [f, names.filter((n) => literals(code(f)).indexOf(n) >= 0)]).filter(([, hits]) => hits.length);
  ok(names.length >= 6 && copies.length === 0, "G: NO REP FILE KEEPS ITS OWN COPY of the transport's reserved fields — they are handed in (ruling 46)", copies);
  ok(literals("const X = [\"pHash\", 'evs'];").join() === "pHash,evs", "G: APPLIED — the string reader sees a list written in either quote");
}

if (failed) { console.log("[rep-boundary] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[rep-boundary] PASS — REP is its own entity (J84, the owner's ruling 21; " + asserts + " assertions, over " + REP_FILES.length +
  " REP file(s)). THE RULES ARE PURE: no app global, no clock, loaded in an empty sandbox. EVERY OTHER PIECE speaks only to the " +
  "rules and the ports. THE PORTS ARE THE ONE DOOR, naming only the nine modules they declare and deciding nothing. THE APP " +
  "REACHES REP only at its hook sites (the script tags, `features/room.js`'s H1 and H2 — `Rep.enter`, `Rep.leave`, once " +
  "each — `ui/roster.js`'s H3, `Rep.badge`, and `ui/settings.js`'s H4, `Rep.botCard`, once each; REP's own files name no other hook). NOTHING OF REP " +
  "is inside the bot runtime, the seam or the engines — they know the side class's prefix and no side type — and the reducer " +
  "holds REP's three settings keys and nothing else. ONE PLACE DECIDES self-votes and self-saves. THIS GUARD READS NAMES: it " +
  "cannot tell you a piece behaves, only where it is allowed to reach");
