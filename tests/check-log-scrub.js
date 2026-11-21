// tests/check-log-scrub.js
// SUBJECT: core/logger.js
//
// WALL: A SECRET NEVER REACHES A LOG LINE (`core/logger.js` `_secretPatterns`; J153 (c) added a person's YouTube key).
// The log is what a person copies and pastes to the owner (the Logs tab's Copy), and the browser console is wrapped the same
// way, so the scrub is the one thing between a token in a message and a token in a pasted log. NOTHING DROVE IT until now:
// the patterns were read by no guard (J153's read-through searched `tests/` for them and found none). Driven here on the
// REAL file, loaded in a sandbox of its own with a recording console, through BOTH of its doors — a subscriber
// (`Logger.on`, what the Logs tab hears) and the wrapped console (`console.log`, what F12 prints):
//
//   A  EVERY PATTERN: a Synapse token (`syt_…`), a JWT, a grouped recovery key, the `name=value` forms (access_token,
//      password, recovery_key, pickle_key — quoted and `:` forms too), a Google API key (`AIza` + 35), and a `key=` in an
//      address (`?key=`, `&key=`, any value) — each gone, and the text around it kept.
//   B  CONTROLS, which must come through unchanged: plain text, words holding "key" (`monkey=1`, `keyboard=on`, "the key
//      is"), an `AIza` too short to be a key, an address with no key.
//   C  THE LIMIT IT STATES: an object is passed through as it is (devtools inspection), so the scrub is a rule for strings.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const FILE = "core/logger.js";

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[log-scrub] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

const printed = [];
const fakeConsole = {};
for (const m of ["log", "info", "warn", "error", "debug"]) fakeConsole[m] = (...a) => printed.push(a);
const ctx = vm.createContext({ console: fakeConsole });
vm.runInContext(fs.readFileSync(path.join(ROOT, FILE), "utf8") + "\n;this.L = Logger;", ctx, { filename: FILE });
const L = ctx.L;
ok(!!L && typeof L.on === "function" && typeof L.info === "function", "PREMISE — the real Logger loads alone and answers on/info");
const heard = [];
L.on((e) => heard.push(e.message));
// One line through each door: what the Logs tab hears, and what the wrapped console prints.
function both(text) {
  heard.length = 0; printed.length = 0;
  L.info(text);
  ctx.console.log(text);
  return { sub: heard[0], con: printed[0] && printed[0][0] };
}
ok(typeof ctx.console.log === "function" && ctx.console.__ddjpRedacted === true, "PREMISE — the console is wrapped (its marker set)");

const KEY = "AIza" + "SyA-" + "x".repeat(31);   // Google's form: AIza and 35 more
const cases = [
  ["a Synapse access token", "token syt_bWF0dGhldw_abcdefghij_0123456 sent", "syt_bWF0dGhldw"],
  ["a JWT", "id eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here", "eyJhbGciOiJSUzI1NiJ9"],
  ["a grouped recovery key", "key EsTc 5rq9 Ab3d WXYZ abcd efgh ijkm npqr end", "EsTc 5rq9 Ab3d"],
  ["access_token=", "url ?access_token=s3cr3tValue&x=1", "s3cr3tValue"],
  ["\"password\": \"…\"", "{\"user\":\"u\",\"password\": \"hunter2\"}", "hunter2"],
  ["recovery_key: …", "recovery_key: abcDEF123", "abcDEF123"],
  ["pickle_key=", "pickleKey=no pickle_key=PICKLEsecret", "PICKLEsecret"],
  ["a Google API key, bare", "your key " + KEY + " was set", KEY],
  ["a Google API key in an address", "GET https://www.googleapis.com/youtube/v3/videos?part=status&id=abc&key=" + KEY + " failed", KEY],
  ["a key= in an address, first", "https://example.org/x?key=OTHER-secret_1&y=2", "OTHER-secret_1"],
  ["a key= in an address, later", "https://example.org/x?a=1&key=zzzSecret#frag", "zzzSecret"],
];
for (const [what, text, secret] of cases) {
  const r = both(text);
  ok(typeof r.sub === "string" && r.sub.indexOf(secret) < 0 && r.sub.indexOf("‹redacted›") >= 0, "A: " + what + " is scrubbed from what a subscriber hears", r.sub);
  ok(typeof r.con === "string" && r.con.indexOf(secret) < 0 && r.con.indexOf("‹redacted›") >= 0, "A: " + what + " is scrubbed from the wrapped console", r.con);
}
{
  const r = both("GET https://www.googleapis.com/youtube/v3/videos?part=status&id=abc&key=" + KEY + " failed");
  ok(/videos\?part=status&id=abc&key=‹redacted›/.test(r.sub) && / failed$/.test(r.sub), "A: the text around a key is kept (the address up to `key=`, and after)", r.sub);
}
const controls = [
  "the room opened in 2 s",
  "monkey=1 keyboard=on donkey: 3",
  "the key is not set",
  "AIzaShort",
  "https://example.org/x?part=status&id=abc&monkey=7",
  "a ‹ and a › alone",
];
for (const text of controls) {
  const r = both(text);
  ok(r.sub === text && r.con === text, "B CONTROL — unchanged: " + JSON.stringify(text), r);
}
{
  heard.length = 0; printed.length = 0;
  const obj = { token: "syt_bWF0dGhldw_abcdefghij_0123456" };
  ctx.console.log(obj);
  ok(printed[0] && printed[0][0] === obj, "C: an object is passed through untouched (the scrub is for strings; the limit `core/logger.js` states)");
}

if (failed) { console.log("[log-scrub] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[log-scrub] PASS — no secret reaches a log line (" + asserts + " assertions), driven through both of the logger's doors, a " +
  "subscriber and the wrapped console: a Synapse token, a JWT, a grouped recovery key, the name=value forms, a Google API key and a " +
  "key= in an address are scrubbed with the text around them kept; plain text, words holding \"key\", a short AIza and an address " +
  "with no key come through unchanged; an object is passed as it is, the limit the logger states");
process.exit(0);
