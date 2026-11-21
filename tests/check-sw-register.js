#!/usr/bin/env node
// tests/check-sw-register.js
// SUBJECT: sw-register.js, core/logger.js
//
// WALL: THE SERVICE WORKER'S TWO LOG LINES REACH THE LOG (J102).
//   `core/logger.js` declares `const Logger` at the top level of a classic script. Every later script on the page sees that
//   name, and it is NOT a property of `window`. `sw-register.js` asked `window.Logger`, so a refused registration and the
//   kill switch's note were never logged. Driven the way the page runs them: both files as classic scripts in ONE global
//   (they share its top-level names, as a page's scripts do), `window` that global, the registration refused, the kill
//   switch run.
//     A  PREMISE — in this global, as on the page, `Logger` is a name every script sees and not a property of `window`.
//     B  a refused registration logs its warning, with the reason.
//     C  the kill switch logs its note once the registrations are gone.
//     D  with no logger loaded the file still loads and runs and throws nothing: registration must never break the app.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[sw-register] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const turn = () => new Promise((r) => setImmediate(r));

// One page: its global, the two scripts in the page's order, a service-worker API that refuses or accepts.
function page(o) {
  const listeners = {}, unregistered = [];
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const ctx = vm.createContext({
    console: quiet,
    navigator: { serviceWorker: {
      register: () => (o.refuse ? Promise.reject(new Error("blocked by the browser's policy")) : Promise.resolve({ update() {} })),
      controller: null,
      getRegistrations: () => Promise.resolve([{ unregister() { unregistered.push(1); } }]),
    } },
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
  });
  vm.runInContext("var window = this; var __lines = [];", ctx);
  if (o.logger) {
    vm.runInContext(read("core/logger.js"), ctx, { filename: "core/logger.js" });
    vm.runInContext("Logger.on(function (e) { __lines.push(e.level + ': ' + e.message); });", ctx);
  }
  let threw = null;
  try { vm.runInContext(read("sw-register.js"), ctx, { filename: "sw-register.js" }); } catch (e) { threw = e; }
  return { ctx, listeners, unregistered, threw, lines: () => vm.runInContext("__lines.slice()", ctx),
    load: () => { for (const fn of listeners.load || []) fn(); } };
}

(async () => {
  // ── A ──
  {
    const p = page({ logger: true });
    const seen = vm.runInContext("[typeof Logger, typeof window.Logger]", p.ctx);
    ok(seen[0] === "object" && seen[1] === "undefined",
      "A PREMISE — `Logger` is a name every script on the page sees, and not a property of `window`", seen);
  }
  // ── B ──
  {
    const p = page({ logger: true, refuse: true });
    p.load();
    for (let i = 0; i < 5; i++) await turn();
    ok(p.threw === null && p.lines().some((l) => /^warn: SW: register failed: blocked by the browser's policy$/.test(l)),
      "B: A REFUSED REGISTRATION IS LOGGED — a warning, with the reason", p.lines());
    const fine = page({ logger: true });
    fine.load();
    for (let i = 0; i < 5; i++) await turn();
    ok(fine.lines().length === 0, "B: and an accepted one says nothing (the control)", fine.lines());
  }
  // ── C ──
  {
    const p = page({ logger: true });
    vm.runInContext("window.__ddjpKillSW()", p.ctx);
    for (let i = 0; i < 5; i++) await turn();
    ok(p.unregistered.length === 1 && p.lines().some((l) => /^info: SW: unregistered\./.test(l)),
      "C: THE KILL SWITCH IS LOGGED — its note, once the registrations are gone", { unregistered: p.unregistered.length, lines: p.lines() });
  }
  // ── D ──
  {
    const p = page({ logger: false, refuse: true });
    let threw = p.threw;
    try { p.load(); for (let i = 0; i < 5; i++) await turn(); vm.runInContext("window.__ddjpKillSW()", p.ctx); for (let i = 0; i < 5; i++) await turn(); }
    catch (e) { threw = e; }
    ok(threw === null && p.unregistered.length === 1, "D: with no logger loaded it still loads and runs, and throws nothing",
      threw ? String(threw) : p.unregistered.length);
  }
  if (failed) { console.log("[sw-register] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
  console.log("[sw-register] PASS — the service worker's two log lines reach the log (J102; " + asserts + " assertions). " +
    "Driven as the page runs them, `core/logger.js` and `sw-register.js` as classic scripts in one global: `Logger` is a " +
    "name every script sees and not a property of `window`; a refused registration logs its warning with the reason, an " +
    "accepted one says nothing; the kill switch logs its note; and with no logger at all the file loads, runs and throws " +
    "nothing. THIS GUARD CANNOT TELL YOU A BROWSER REFUSES A REGISTRATION AS THIS STAND-IN DOES");
})().catch((e) => { console.log("[sw-register] FAIL — threw: " + ((e && e.stack) || e)); process.exit(1); });
