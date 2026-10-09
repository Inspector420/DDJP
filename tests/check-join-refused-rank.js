// tests/check-join-refused-rank.js
// SUBJECT: backends/backend1/matrixbridge.js
// WALL: A CHANNEL REFUSED AT THIS RANK IS NOT RETRIED ON EVERY RANK CHANGE (`ddjp_563`: `!R4xx…` refused the bot at rank 99 at
//   17:32:37, after every rank change — a channel above its tier). It is retried once the rank rises above the rank it was
//   refused at; a transient failure is retried as before. Driven on the bridge's own retryWaitingJoins, extracted.
"use strict";
const fs = require("fs"), path = require("path");
let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[join-refused-rank] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
const MB = fs.readFileSync(path.join(__dirname, "..", "backends/backend1/matrixbridge.js"), "utf8");
const i = MB.indexOf("  function retryWaitingJoins(why) {"), j = MB.indexOf("\n  }\n", i) + 4;
ok(i > 0, "PREMISE — retryWaitingJoins is found");
let rank = 99; const tried = [];
const mk = () => new Function("_joinWaiting", "_joinChannel", "getMyRank", "Logger", "_recoveryChannels", MB.slice(i, j) + "\nreturn retryWaitingJoins;")(
  waiting, (id) => { tried.push(id); return Promise.resolve({ ok: false }); }, () => rank, { info() {}, warn() {} }, null);
const waiting = new Map([["!R4xx:hs", { errcode: "M_FORBIDDEN", refusedAtRank: 99 }], ["!flaky:hs", { errcode: "M_UNKNOWN" }]]);
const retry = mk();
retry("this account's rank changed");
ok(tried.indexOf("!R4xx:hs") < 0, "a channel refused at rank 99 is NOT retried while the rank is still 99", tried);
ok(tried.indexOf("!flaky:hs") >= 0, "a transient failure is retried as before", tried);
ok(waiting.has("!R4xx:hs"), "and the refused channel stays waiting — an invite or a higher rank can still bring it in");
tried.length = 0; rank = 100; retry("this account's rank changed");
ok(tried.indexOf("!R4xx:hs") >= 0, "once the rank rises above the rank it was refused at, it is retried", tried);
ok(/refusedAtRank: \(typeof _rk === "number"\) \? _rk : null/.test(MB), "a refusal records the rank it happened at");
if (failed) { console.log("[join-refused-rank] " + failed + " failure(s)"); process.exit(1); }
console.log("[join-refused-rank] PASS — a channel refused at this rank waits for a higher rank or an invite, not every rank change (" + asserts + " assertions)");
