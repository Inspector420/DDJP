// tests/check-fetch-back.js
// WALL: FETCHING AN EVENT BACK, AND WHAT ITS ABSENCE MEANS.
//
// Eviction is LOCAL — _evict drops from memory and IDB and never touches Matrix — so an event
// needed only to VERIFY a claim can be fetched back by id instead of pinned forever. That trade
// only holds if a failed fetch is distinguishable from a failed check. It is the same distinction
// the seed-validation tri-state exists for, one layer down:
//
//   an event we could not obtain   -> the claim is UNVERIFIED
//   an event that disagrees        -> the claim is WRONG
//
// Collapse them and every network hiccup becomes evidence of tampering, while every real tampering
// becomes indistinguishable from a network hiccup. This guard pins the four outcomes apart.
//
// The SDK call itself cannot run without lib/, so `fetchOutcome` carries all the meaning and is
// exercised directly; the caching and de-duplication around it are exercised through a fake client.

const { loadInContext } = require("./_load");

function fail(msg, got) {
  console.log("[fetch-back] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function eq(a, b, msg) { if (a !== b) fail(msg + " (expected " + JSON.stringify(b) + ", got " + JSON.stringify(a) + ")"); }
function ok(c, msg) { if (!c) fail(msg); }
const noop = () => {};

function bridge(extras) {
  return loadInContext(
    ["backends/backend1/ranks.js", "backends/backend1/matrixbridge.js"],
    Object.assign({
      Logger: { info: noop, warn: noop, error: noop, debug: noop },
      StreamManager: { getState: () => ({ settings: {} }), on: noop, off: noop },
      Date, setTimeout, clearTimeout,
    }, extras || {})
  ).MatrixBridge;
}

const raw = (body) => ({ event_id: "$x1", type: "m.room.message", content: { body: body } });

// ── PART A: the four outcomes are distinct ───────────────────────────────────────────────────
{
  const MB = bridge();

  const found = MB.fetchOutcome(raw(JSON.stringify({ t: "ddjp.room.settings", l: 1 })), null);
  eq(found.status, "found", "A: an intact event is found");
  ok(found.raw, "A: and hands back the event, which is the only outcome that can");

  // REDACTED: it existed and was deleted. No fetch brings it back — this is the one case where
  // the local copy WAS the last copy, and the pin trade genuinely loses something.
  eq(MB.fetchOutcome({ event_id: "$x", content: {}, unsigned: { redacted_because: {} } }, null).status,
    "redacted", "A: a tombstoned event is redacted, not merely missing");
  eq(MB.fetchOutcome({ event_id: "$x", content: {} }, null).status,
    "redacted", "A: an empty body is the same thing without the tombstone");
  eq(MB.fetchOutcome(raw(""), null).status, "redacted",
    "A: ...and an empty string body too — handing a verifier a blank blob to compare against " +
    "would read as a mismatch, which is the wrong verdict entirely");

  // MISSING vs UNAVAILABLE: the retryable distinction. This is the one that matters.
  const missing = MB.fetchOutcome(null, { errcode: "M_NOT_FOUND" });
  eq(missing.status, "missing", "A: the server saying no such event is missing");
  eq(missing.retryable, false, "A: and asking again will not change it");

  const offline = MB.fetchOutcome(null, new Error("network"));
  eq(offline.status, "unavailable", "A: a failure to ASK is unavailable, not an answer");
  eq(offline.retryable, true, "A: and IS worth asking again — the claim is unverified for now, not forever");

  ok(missing.status !== offline.status,
    "A: 'the event is not there' and 'we could not look' are never the same verdict");
  eq(MB.fetchOutcome(null, null).status, "missing", "A: no event and no error is still no event");
}

// ── PART B: local first, caching, and de-duplication ─────────────────────────────────────────
async function main() {
  const held = raw(JSON.stringify({ t: "ddjp.room.settings", l: 1 }));

  // Anything still held locally needs no round trip at all.
  {
    let calls = 0;
    const MB = bridge({ EventCache: { get: (id) => (id === "$x1" ? held : null) } });
    MB._setClientForTest({ fetchRoomEvent: async () => { calls++; return held; } });
    const out = await MB.fetchSpineEvent("$x1", "!r");
    eq(out.status, "found", "B: an event we still hold is found without asking anyone");
    eq(out.local, true, "B: and says so, so a caller can tell a cheap answer from a round trip");
    eq(calls, 0, "B: no fetch was attempted");
  }

  // Not held -> one fetch, and the answer is remembered.
  {
    let calls = 0;
    const MB = bridge({ EventCache: { get: () => null } });
    MB._setClientForTest({ fetchRoomEvent: async () => { calls++; return held; } });
    eq((await MB.fetchSpineEvent("$x1", "!r")).status, "found", "B: fetched from the server");
    eq(calls, 1, "B: exactly one round trip");
    eq((await MB.fetchSpineEvent("$x1", "!r")).status, "found", "B: still found on a second ask");
    eq(calls, 1, "B: and did NOT ask twice");
  }

  // A PURGED event must not be re-asked forever. Verification runs repeatedly; a claim pointing at
  // an event the server no longer has would otherwise generate a round trip on every single pass.
  {
    let calls = 0;
    const MB = bridge({ EventCache: { get: () => null } });
    MB._setClientForTest({ fetchRoomEvent: async () => { calls++; const e = new Error("gone"); e.errcode = "M_NOT_FOUND"; throw e; } });
    eq((await MB.fetchSpineEvent("$x1", "!r")).status, "missing", "B: a purged event is missing");
    await MB.fetchSpineEvent("$x1", "!r");
    await MB.fetchSpineEvent("$x1", "!r");
    eq(calls, 1, "B: a settled negative answer is cached — no retry storm");
  }

  // ...but a failure to ASK must NOT be cached, because it is the one outcome that changes on its
  // own. Caching it would strand a claim as unverified for the rest of the session over one
  // dropped connection.
  {
    let calls = 0, fail_ = true;
    const MB = bridge({ EventCache: { get: () => null } });
    MB._setClientForTest({ fetchRoomEvent: async () => { calls++; if (fail_) throw new Error("offline"); return held; } });
    eq((await MB.fetchSpineEvent("$x1", "!r")).status, "unavailable", "B: offline is unavailable");
    fail_ = false;
    eq((await MB.fetchSpineEvent("$x1", "!r")).status, "found",
      "B: and it RETRIES once the network is back — a retryable outcome is never cached");
    eq(calls, 2, "B: which took a second round trip, correctly");
  }

  // Concurrent asks for the same event collapse to one request.
  {
    let calls = 0;
    const MB = bridge({ EventCache: { get: () => null } });
    MB._setClientForTest({ fetchRoomEvent: async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return held; } });
    const all = await Promise.all([0, 1, 2, 3].map(() => MB.fetchSpineEvent("$x1", "!r")));
    ok(all.every((o) => o.status === "found"), "B: every concurrent caller gets the answer");
    eq(calls, 1, "B: from a single in-flight request");
  }

  // No client at all (backend swapped, not yet connected) is a failure to ASK, not an answer.
  {
    const MB = bridge({ EventCache: { get: () => null } });
    const out = await MB.fetchSpineEvent("$x1", "!r");
    eq(out.status, "unavailable", "B: no client means we could not look");
    eq(out.retryable, true, "B: and it is worth looking again later");
  }

  eq((await bridge().fetchSpineEvent("", "!r")).status, "missing", "B: an empty id asks nobody");

  console.log("[fetch-back] PASS — an event can be fetched back by id because eviction is local and the homeserver still holds it; the four outcomes stay distinct (found / redacted / missing / unavailable) so a failure to LOOK is never mistaken for a failure to MATCH; locally held events cost no round trip; settled answers are cached and retryable ones are not; and concurrent asks collapse to one request");
}

main().catch((e) => fail("threw: " + (e && e.stack || e)));
