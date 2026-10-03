#!/usr/bin/env node
// SUBJECT: core/, docs/roles.md
// check-core-table.js — `roles.md` §5's Core table names every file in `core/`, and nothing else.
//
// WHY THIS EXISTS (ddjp_495). The table opened "three of the seven have a trap" while `core/` held
// nine: the engine seam (`backends.js`) and its load-time binder (`bind-bootstrap.js`) arrived at J23
// and were never added, and nothing compared the table with the directory. `check-ui-files` makes
// that comparison for `ui/`; this is the same comparison for `core/`. Both sides are READ — the
// directory from disk, the table from the doc — so this file holds no list of its own to go stale.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const { docPaths, searchedFor } = require("./_docs.js");   // one resolver, never a literal docs_NNN

let failed = 0, asserts = 0;
function ok(c, msg, got) {
  asserts++;
  if (c) return;
  failed++;
  console.log("[core-table] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const onDisk = fs.readdirSync(path.join(ROOT, "core")).filter((f) => f.endsWith(".js"))
  .map((f) => f.replace(/\.js$/, "")).sort();
ok(onDisk.length > 0, "APPLIED — core/ scanned to nothing, so every assertion below is free", onDisk);

const rolesPath = docPaths("roles.md").find((p) => fs.existsSync(p)) || null;
ok(!!rolesPath, "APPLIED — roles.md must be readable; the table is this guard's subject. " + searchedFor("roles.md"));
const roles = rolesPath ? fs.readFileSync(rolesPath, "utf8") : "";

// The section runs from its heading to the next heading of the same or a higher level.
const start = roles.search(/^### Core — shared plumbing/m);
ok(start >= 0, "APPLIED — the `### Core — shared plumbing` section must be findable, or nothing below reads it");
// From the line AFTER the heading: slicing one character in leaves `## Core…`, which is itself a
// heading, so the section came out empty — caught by the premise row below on the first run.
const rest = start >= 0 ? roles.slice(roles.indexOf("\n", start) + 1) : "";
const stop = rest.search(/^#{1,3} /m);
const section = start >= 0 ? rest.slice(0, stop >= 0 ? stop : rest.length) : "";
// A table row's first cell names the module as **`name`**.
const inTable = [...section.matchAll(/^\| \*\*`([a-z0-9-]+)`\*\* \|/gm)].map((m) => m[1]).sort();
ok(inTable.length > 0, "APPLIED — the table must yield rows, or an empty parse would pass as agreement", inTable);

const missing = onDisk.filter((m) => inTable.indexOf(m) < 0);
const extra = inTable.filter((m) => onDisk.indexOf(m) < 0);
ok(missing.length === 0,
  "every file in core/ has a row in roles.md §5's Core table — a module in no row is plumbing nobody " +
  "is told the trap of, and the sentence above the table then counts a population it does not hold", missing);
ok(extra.length === 0, "and every row names a file that is still in core/", extra);
// The count that went stale is not re-pinned here; it is gone from the prose, which is the fix.
ok(!/of the (seven|eight|nine|ten|\d+) have a trap/.test(section),
  "the section states no count of its own rows — the list is the count (README §Conventions)", null);

if (failed) process.exit(1);
console.log("[core-table] PASS — roles.md §5's Core table and core/ are the same set of modules, read from " +
  "both sides rather than listed here, and the section carries no count of its own rows (" + asserts + " assertions)");
