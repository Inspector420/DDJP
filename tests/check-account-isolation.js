// tests/check-account-isolation.js
// WALL: multi-account storage isolation. App data (room-list cache, user queue,
// logs) is namespaced PER MATRIX USER so two accounts on the same browser never
// share or clobber each other's storage, and re-login re-links to the right
// namespace. Auth/registry keys (session blobs, the account registry, the active
// pointer, the schema marker, SSO-pending) stay GLOBAL and unprefixed. The
// naming/prefixing DECISIONS are pure and locked here; the per-user database
// open + the forget-account teardown are browser-only (review-only), exactly
// like transport's SDK calls.

const { loadInContext } = require("./_load");

let failed = 0;
function ok(c, m) { if (!c) { console.log("[account-isolation] FAIL — " + m); failed++; } }
function eq(g, w, m) { const a = JSON.stringify(g), b = JSON.stringify(w); if (a !== b) { console.log("[account-isolation] FAIL — " + m + "\n      got " + a + "\n      want " + b); failed++; } }

// Minimal in-memory localStorage stand-in (enumerable, like the real one).
function makeLS() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key(i) { const k = Array.from(m.keys())[i]; return k == null ? null : k; },
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
  };
}

const { StorageIO, IDB } = loadInContext(["core/idb.js", "core/storageio.js"], { localStorage: makeLS() });

// ---- IDB: per-user database name (pure) ----
eq(IDB.dbNameFor(null), "ddjp", "no namespace -> legacy/global DB name");
eq(IDB.dbNameFor("@a:hs"), "ddjp:@a:hs", "namespace -> per-user DB name");
ok(IDB.dbNameFor("@a:hs") !== IDB.dbNameFor("@b:hs"), "two users -> two distinct DB names");

// ---- StorageIO: per-user prefix (pure) ----
eq(StorageIO.prefixFor(""), "ddjp_", "no namespace -> legacy/global prefix");
eq(StorageIO.prefixFor("@a:hs"), "ddjp_@a:hs_", "namespace -> per-user prefix");

// ---- StorageIO: live isolation + re-link ----
StorageIO.setNamespace("@a:hs");
StorageIO.save("rooms", [1]);
eq(StorageIO.load("rooms"), [1], "user A reads its own data");
StorageIO.setNamespace("@b:hs");
eq(StorageIO.load("rooms"), null, "user B does NOT see A's data (isolated)");
StorageIO.save("rooms", [2]);
StorageIO.setNamespace("@a:hs");
eq(StorageIO.load("rooms"), [1], "switching back to A re-links A's data intact");
StorageIO.setNamespace("@b:hs");
eq(StorageIO.load("rooms"), [2], "B's data also intact");

// ---- clearNamespace (forget account): only that user's keys ----
const ls3 = makeLS();
const ctx3 = loadInContext(["core/storageio.js"], { localStorage: ls3 });
ls3.setItem("ddjp_@a:hs_rooms", "[1]");
ls3.setItem("ddjp_@b:hs_rooms", "[2]");
ls3.setItem("ddjp_session", "X");
ctx3.StorageIO.clearNamespace("@a:hs");
ok(ls3.getItem("ddjp_@a:hs_rooms") === null, "forget account drops that user's keys");
ok(ls3.getItem("ddjp_@b:hs_rooms") === "[2]", "other user's keys survive forget");
ok(ls3.getItem("ddjp_session") === "X", "global/auth keys survive forget");

if (failed) { console.log("[account-isolation] " + failed + " failure(s)"); process.exit(1); }
console.log("[account-isolation] PASS — per-user DB + prefix isolation; forget is scoped to one user");
process.exit(0);
