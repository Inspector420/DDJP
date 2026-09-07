// tests/check-settings-passthrough.js
//
// THE SETTINGS ROUND-TRIP MUST BE TOTAL.
//
// `ddjp.room.settings` is a LAST-WRITE-WINS blob: every write must carry every setting, and every
// read must surface every setting. Both sides of that round-trip used to hand-list their keys, and
// the failure mode was silent and nasty:
//
//   • read side  — a setting missing from the list reached the UI as `undefined`, so the panel
//                  rendered it as blank/"never" no matter what the room actually had. (This is
//                  exactly how the per-rank vouch/checkpoint tables appeared empty.)
//   • write side — a setting missing from the list was DROPPED from the outgoing blob, so an
//                  owner's edit was never sent, and the last-write-wins blob quietly reset it.
//
// Neither shows up as an error anywhere: no exception, no failed guard, just a control that does
// nothing. So this guard pins the STRUCTURE that prevents it — the read passes the derived blob
// through wholesale, and the write MERGES onto the current blob instead of rebuilding it.
//
// `features/room.js` can't be loaded headlessly (it needs MatrixBridge + a live client), so this is
// a static guard over the source, the same approach check-write-channel uses.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let checks = 0;
function ok(c, m) { assert.ok(c, m); checks++; }

// Strip only WHOLE-LINE comments. A naive `//` strip also eats everything after a URL inside a
// string literal (`https://…`), which silently deletes real code from the scan — that made this
// guard report a control as missing when it was plainly there.
function code(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  return src.split("\n").filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
}
const room = code("features/room.js");
const deriver = code("backends/backend1/statederiver.js");

function body(src, fnName) {
  const i = src.indexOf("function " + fnName);
  assert.ok(i >= 0, fnName + " exists");
  return src.slice(i, src.indexOf("\n  }", i) + 4);
}

// ── (a) READ side: getSettings returns the whole derived blob ──
const get = body(room, "getSettings");
ok(/Object\.assign\(\{\},\s*s\)/.test(get),
  "getSettings passes the derived settings through wholesale");
ok(!/maxLen:\s*typeof/.test(get),
  "getSettings does not hand-list individual settings (that is what hid the new ones)");

// ── (b) WRITE side: setSettings merges onto the current blob ──
const set = body(room, "setSettings");
ok(/Object\.assign\(\{\},\s*cur,\s*partial/.test(set),
  "setSettings MERGES the caller's partial onto the current full blob");
ok(!/minGate:\s*\(partial/.test(set) && !/maxLen:\s*\(partial/.test(set),
  "setSettings does not rebuild the blob from a hand-written key list");
ok(/hasOwnProperty\.call\(partial,\s*"bg"\)/.test(set),
  "bg keeps its explicit clear semantics through the merge");

// ── (c) the round-trip actually covers what the reducer defines ──
// Every key in defaultSettings() must be reachable; with a wholesale copy + merge that is true by
// construction, so we simply assert the reducer still owns the shape (nothing re-declares it).
const defaults = deriver.slice(deriver.indexOf("function defaultSettings"), deriver.indexOf("function defaultSettings") + 3000);
for (const key of ["vouchTable", "checkpointTable", "checkpointCooldownMs", "selfWitnessCheckpoint", "vouchJitter", "receiptsPerMessage"]) {
  ok(defaults.indexOf(key) >= 0, "defaultSettings() defines " + key);
  ok(room.indexOf(key) < 0, "room.js does NOT restate " + key + " (the reducer is the only source of the shape)");
}

// ── (d) the UI RENDERS every setting the reducer defines (nothing silently unreachable) ──
// A setting the owner can't see or change is as good as absent, and nothing else would catch it.
// The key list comes from the reducer itself, so adding a setting automatically extends this check.
const { loadInContext } = require("./_load");
const derived = loadInContext(
  ["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/streammanager.js"],
  { Date }
).StreamManager.getState().settings;
const ui = code("ui/interface.js");
const defined = Object.keys(derived);
ok(defined.length >= 10, "read the reducer's setting list (" + defined.length + " keys)");
for (const key of defined) {
  // a control either names the key ("maxLen") or reads it off the settings object (s.bg)
  const named = ui.indexOf('"' + key + '"') >= 0;
  const read = new RegExp("\\bs\\." + key + "\\b").test(ui);
  ok(named || read, "the settings panel surfaces a control for '" + key + "'");
}

console.log("[settings-passthrough] PASS — the settings blob round-trips TOTALLY: the read passes the derived blob through wholesale and the write merges onto it, so no setting can be silently hidden from the UI or silently dropped from an owner's write; room.js restates none of the reducer's setting shape, and the panel renders a control for EVERY setting the reducer defines (" + checks + " assertions)");
process.exit(0);
