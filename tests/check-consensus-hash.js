// tests/check-consensus-hash.js
// WALL: the content-addressing FOUNDATION for hash-ref / vouchers (consensus-critical,
// docs/consensus/consensus-models.md §2). Two clients MUST hash the same event to the same value, so
// this pins:
//   - SHA-256 + UTF-8 + base64url(unpadded) reproduce Node's own crypto EXACTLY (oracle);
//   - DCF (canonical form) is DETERMINISTIC — key-insertion order cannot change the bytes;
//   - DCF REJECTS anything ambiguous (non-integer / NaN / Infinity / -0 / out-of-range /
//     non-ASCII key / unsupported type) rather than hashing it two ways;
//   - contentHash is stable across key order; verify accepts the true body, rejects any
//     mutation / wrong hash / un-canonicalizable body, and never throws.
// Pure module, exercised directly. NOTHING here is wired into the protocol yet.

const crypto = require("crypto");
const { loadInContext } = require("./_load");
const { ConsensusHash: H } = loadInContext(["backends/backend1/ranks.js", "backends/backend1/consensushash.js"]);

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[consensus-hash] FAIL — " + msg); failed++; } }
function throws(fn, msg) { let t = false; try { fn(); } catch (e) { t = true; } if (!t) { console.log("[consensus-hash] FAIL — " + msg + " (expected a throw)"); failed++; } }

// Oracle: Node's crypto, same transform (SHA-256 of UTF-8 bytes -> unpadded base64url).
const oracle = (s) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("base64url");

// ---- 1) SHA-256 + UTF-8 + base64url reproduce the reference for many inputs ----
const strs = [
  "", "a", "abc", "message digest",
  "The quick brown fox jumps over the lazy dog",
  "x".repeat(55), "x".repeat(56), "x".repeat(57),   // block-boundary padding cases
  "x".repeat(63), "x".repeat(64), "x".repeat(65),
  "héllo — déjà vu", "音楽 🎵 vibes", "\u0000\u0001\u001f control",
  "y".repeat(1000),
];
for (const s of strs) ok(H.hashString(s) === oracle(s), "hashString matches Node crypto for input len " + s.length);

// A known published vector, belt-and-suspenders (SHA-256("abc")).
ok(H.hashString("abc") === "ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0", "SHA-256(\"abc\") base64url matches the published vector");

// ---- 2) DCF determinism: key-insertion order must not change the bytes ----
ok(H.canonicalize({ a: 1, b: 2, c: 3 }) === H.canonicalize({ c: 3, a: 1, b: 2 }), "object key order does not affect DCF");
ok(H.canonicalize({ b: { y: 2, x: 1 }, a: [3, 2, 1] }) === H.canonicalize({ a: [3, 2, 1], b: { x: 1, y: 2 } }), "nested key order does not affect DCF");
ok(H.canonicalize([1, 2, 3]) !== H.canonicalize([3, 2, 1]), "array ORDER is significant (kept, not sorted)");
ok(H.canonicalize({ t: "ddjp.dj.play", l: 5, p: null }) === '{"l":5,"p":null,"t":"ddjp.dj.play"}', "DCF shape: sorted keys, no whitespace, null literal");
ok(H.canonicalize(-7) === "-7" && H.canonicalize(0) === "0", "integers render base-10, no leading zeros");
ok(H.canonicalize("a\"b\\c\nd\te") === '"a\\"b\\\\c\\nd\\te"', "string escaping is the minimal JSON set");

// ---- 3) DCF rejects everything ambiguous (would otherwise hash two ways) ----
throws(() => H.canonicalize(1.5), "non-integer number rejected");
throws(() => H.canonicalize(NaN), "NaN rejected");
throws(() => H.canonicalize(Infinity), "Infinity rejected");
throws(() => H.canonicalize(-0), "-0 rejected");
throws(() => H.canonicalize(Number.MAX_SAFE_INTEGER + 2), "out-of-safe-range integer rejected");
throws(() => H.canonicalize({ "é": 1 }), "non-ASCII object key rejected");
throws(() => H.canonicalize({ x: undefined }), "undefined value rejected");
throws(() => H.canonicalize({ f: function () {} }), "function value rejected");

// ---- 4) contentHash is DCF -> hash, stable across key order, matches the oracle ----
const body = { t: "ddjp.dj.play", l: 42, p: "$parent", dv: 2, hv: 1 };
ok(H.contentHash(body) === oracle(H.canonicalize(body)), "contentHash == hash of the canonical form");
ok(H.contentHash({ t: "x", l: 1, dur: 213 }) === H.contentHash({ dur: 213, l: 1, t: "x" }), "contentHash stable across key order");
// A unicode title survives the whole pipeline and matches the oracle.
const titled = { t: "ddjp.dj.play", l: 9, title: "音楽 🎵", p: null };
ok(H.contentHash(titled) === oracle(H.canonicalize(titled)), "unicode-bearing body hashes consistently");

// ---- 5) verify: true body accepts; any mutation / wrong hash / bad body rejects; no throw ----
const good = H.contentHash(body);
ok(H.verify(body, good) === true, "verify accepts the exact body");
ok(H.verify(Object.assign({}, body, { l: 43 }), good) === false, "a one-field mutation fails verification");
ok(H.verify(body, good.slice(0, -1) + (good.slice(-1) === "A" ? "B" : "A")) === false, "a wrong expected hash fails verification");
ok(H.verify({ x: 1.5 }, good) === false, "an un-canonicalizable body fails verification (no throw)");
ok(H.verify(body, "") === false && H.verify(body, null) === false, "empty/null expected hash fails cleanly");

// hv is exposed and stable (scheme identifier).
ok(H.HV === 1, "hash version constant hv:1 is exposed");

if (failed) { console.log("[consensus-hash] " + failed + " failure(s)"); process.exit(1); }
console.log("[consensus-hash] PASS — SHA-256/UTF-8/base64url match Node's crypto oracle; DCF is deterministic (key-order-independent) and rejects ambiguous values; contentHash stable; verify accepts truth, rejects mutation/bad-hash/bad-body without throwing");
process.exit(0);
