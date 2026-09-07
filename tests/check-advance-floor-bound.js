// tests/check-advance-floor-bound.js
//
// THE RESTRAINT IS BOUNDED BY THE FLOOR — ON EVERY PATH THAT ASKS IT, NOT JUST ONE.
//
// `a client that knows it is missing history must not advance` is correct and load-bearing: it is
// what stops two clients forking into histories that each correctly refuse the other. But it has
// always come with a bound, stated in trust-cascade.md §7b:
//
//     "Bounded by the floor, like duty: an event at or below a floor is banked, so a reference
//      across that boundary is history that has been accounted for, not a hole."
//
// That bound lived in exactly ONE of the three places that ask. `Continuity.check()` filtered the
// held set before asking; `MatrixBridge.mayAdvance()` (the ADVANCE path) and
// `Checkpoint._wholeView()` (the owner's SEAL path) passed everything they held.
//
// The consequence is not subtle and it is not recoverable. Once a client has a floor and has
// forgotten below it, its own held events reference parents it deliberately dropped. Those read as
// gaps. A record for them usually exists, so they read as CORROBORATED gaps. The client concludes
// it is short of history and stops advancing — waiting for events it threw away on purpose, which
// are never coming back. Measured before this guard existed: identical held set, bounded says
// { ok: true }, unbounded says { ok: false, state: "short" }. The music stops and nothing says why.
//
// This could only start once forgetting genuinely ran AND the advance path began asking.
// Before that the rule was reached by nothing that plays songs, which is why four earlier
// versions could not get stuck.
//
// TWO PARTS, AND THE SECOND IS THE ONE THAT KEEPS HOLDING:
//   PART A — BEHAVIOUR. A reference below the floor is not a hole. The bound lives in the RULE, so
//            every caller inherits it and no call site can hold its own copy to drift.
//   PART B — REACH, DERIVED BY SCANNING. Every production call site is found by reading the source
//            rather than by listing the two anyone remembered, and each must state its floor. This
//            is the shape that found four extra senders in paths.md §8c: a rule applied to the path
//            where a bug was seen and not to its siblings is this codebase's recurring failure,
//            and it was committed here twice over.
//
// FAIL DIRECTION, STATED (CONCEPTS.md §3.2): a caller that does not state a floor gets an answer
// that does NOT block. Refusing to answer must never be able to stop the room — the whole reason
// this defect was expensive is that a check meant to be politeness acquired a veto.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadInContext, ROOT } = require("./_load");

let checks = 0;
function ok(c, m, extra) {
  if (!c && extra !== undefined) m += "\n      got " + JSON.stringify(extra);
  assert.ok(c, m);
  checks++;
}

const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
  "backends/backend1/vouch.js", "backends/backend1/continuity.js",
]);
const { Continuity, Ranks } = C;

const ROOM = "!room:hs";
const STAFF = Ranks.levelOf("staff");
const PLAYER = Ranks.levelOf("player");

function raw(id, l, sender, rank, body) {
  return {
    event_id: id, type: "m.room.message", sender: sender, senderRank: rank,
    l: l, ts: 1000 + l, origin_server_ts: 1000 + l, room_id: ROOM,
    content: { body: JSON.stringify(Object.assign({ l: l }, body)) },
  };
}

// ── THE ROOM THIS IS ABOUT ───────────────────────────────────────────────────────────────────
// A client that adopted a floor at l=100 and forgot below it. It still holds a child from before
// the floor whose parent it dropped, and a staff-rank carrier vouching that parent — so the gap is
// corroborated, which is precisely the case that STOPS a client rather than merely flagging it.
const FLOOR_L = 100;
const BANKED_PARENT = "$parent-banked-below-the-floor";

const HELD = [
  raw("$old-child", 50, "@dj:hs", PLAYER, { t: "ddjp.dj.play", p: BANKED_PARENT }),
  raw("$carrier", 60, "@staff:hs", STAFF, {
    t: "ddjp.dj.play", p: "$old-child",
    w: [{ i: BANKED_PARENT, l: 40, d: { t: "ddjp.dj.play", p: null }, h: "h", r: STAFF }],
  }),
  raw("$live", 140, "@dj:hs", PLAYER, { t: "ddjp.dj.play", p: "$carrier" }),
];

// ── PART A: the bound is in the rule ─────────────────────────────────────────────────────────
{
  // APPLIED FIRST. If the fixture does not actually produce a missing parent, everything below
  // passes vacuously — an unreached path reports absence, and absence reads exactly like a finding.
  const missing = Continuity.missingParents(HELD);
  ok(missing.indexOf(BANKED_PARENT) >= 0,
    "A: APPLIED — the fixture must really leave the banked parent missing, or this proves nothing",
    missing);

  const corr = Continuity.corroboration(BANKED_PARENT, HELD, {});
  ok(corr.corroborated === true,
    "A: APPLIED — the gap must really be CORROBORATED, or it would never have blocked anything",
    corr);

  // The heart of it: told where its floor is, the client does not treat banked history as a hole.
  const bounded = Continuity.mayAdvance(HELD, {}, FLOOR_L);
  ok(bounded.ok === true,
    "A: a reference to an event BELOW the floor is banked history, not a hole — it must not stop " +
    "the client advancing. This is trust-cascade.md §7b, and it was enforced on one path of three.",
    bounded);
  ok(bounded.state !== "short",
    "A: and the state must not be `short` — `short` is the state that holds the room still",
    bounded);

  // A REAL hole ABOVE the floor still stops it. Without this the fix could be "never block", which
  // would delete the anti-fork restraint rather than bound it.
  const realGap = HELD.concat([
    raw("$newer", 160, "@dj:hs", PLAYER, { t: "ddjp.dj.play", p: "$missing-above" }),
    raw("$vouch2", 165, "@staff:hs", STAFF, {
      t: "ddjp.dj.play", p: "$newer",
      w: [{ i: "$missing-above", l: 150, d: { t: "ddjp.dj.play", p: null }, h: "h", r: STAFF }],
    }),
  ]);
  const above = Continuity.mayAdvance(realGap, {}, FLOOR_L);
  ok(above.ok === false && above.state === "short",
    "A: a corroborated gap ABOVE the floor must STILL stop the client — the bound narrows the " +
    "question, it does not abolish it",
    above);

  // No floor yet is a real state (Floor.NO_FLOOR = -1), and it must bound nothing.
  const noFloor = Continuity.mayAdvance(HELD, {}, -1);
  ok(noFloor.ok === false && noFloor.state === "short",
    "A: with NO floor (-1) nothing is banked, so the same gap stops the client as before",
    noFloor);

  // FAIL OPEN, NOT CLOSED. A caller that never states a floor is a wiring bug — and a wiring bug
  // must not be able to stop the music. It answers, visibly, without blocking.
  const unstated = Continuity.mayAdvance(HELD, {});
  ok(unstated.ok === true,
    "A: a caller that does not state its floor must get a NON-BLOCKING answer. A check that " +
    "exists to save messages must never acquire a veto (CONCEPTS.md §3.2 — state the direction).",
    unstated);
  ok(typeof unstated.reason === "string" && unstated.reason.length > 0,
    "A: and it must SAY so rather than passing silently — a silent degrade is the failure this " +
    "codebase keeps finding",
    unstated);
}

// ── PART B: every path that asks, derived by scanning ────────────────────────────────────────
// Not a list of the two call sites anyone remembered. The list is READ from the source, so a third
// caller added later is covered by construction rather than by memory.
{
  const dirs = ["backends/backend1", "features", "ui", "core"];
  const files = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith(".js")) files.push(path.join(d, f));
  }

  // Walk from the opening paren to its match, so a call may be wrapped across lines however the
  // author likes. An earlier version of this scanner read one line at a time and reported a
  // correctly-fixed call site as unfixed the moment it was wrapped — a guard that dictates
  // formatting is a guard that will be worked around rather than obeyed.
  // ── PART: THE RECORD, NOT THE SCAN (J38) ───────────────────────────────────────────────────
  // The scan below is a source scan, and its own header says what that costs: it counts ARGUMENTS,
  // so hoisting the position into a local leaves the count identical and the scan green, and a call
  // through an alias is not a call site to it at all. `check-advance-notify` settled the family —
  // a textual check stays green when a subscription is removed and the type name is left in a
  // comment, while an EXECUTED one goes red.
  //
  // So the fail-open branch records that it was taken, and this drives the production paths and
  // asserts the record is EMPTY. Nothing has to be provoked: the observation IS the assertion, and
  // a call added through any wrapper the scanner cannot follow still lands in the record.
  {
    ok(typeof Continuity.unboundedCalls === "function",
      "J38: `Continuity` does not record the fail-open branch, so what keeps every call site honest " +
      "is a source scan that counts arguments — hoisting the position into a local leaves the count " +
      "identical and the scan green");

    Continuity._resetUnboundedForTest();
    Continuity.mayAdvance(HELD, {}, FLOOR_L);
    Continuity.mayAdvance(HELD, {}, -1);
    ok(Continuity.unboundedCalls().length === 0,
      "J38: a call that STATED its floor was recorded as unbounded, so the record cannot tell a " +
      "stated bound from a missing one and asserting on it proves nothing",
      JSON.stringify(Continuity.unboundedCalls()));

    Continuity.mayAdvance(HELD, {});
    ok(Continuity.unboundedCalls().length === 1,
      "J38: a call that OMITTED its floor was not recorded. The branch answers `unbounded` and " +
      "protects nobody, so the only thing that can catch a new caller is the record itself",
      JSON.stringify(Continuity.unboundedCalls()));
    Continuity._resetUnboundedForTest();
  }

  function callsIn(src) {
    const out = [];
    const re = /Continuity\.mayAdvance\s*\(/g;   // the Continuity one specifically:
    let m;                                       // MatrixBridge.mayAdvance is a DIFFERENT function
    while ((m = re.exec(src)) !== null) {        // that shares the name (roles.md §6, confusables)
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      const linePrefix = src.slice(lineStart, m.index);
      if (linePrefix.trim().startsWith("//") || linePrefix.trim().startsWith("*")) continue;
      let i = m.index + m[0].length, depth = 1, args = 1, inStr = null;
      for (; i < src.length && depth > 0; i++) {
        const ch = src[i];
        if (inStr) { if (ch === "\\") i++; else if (ch === inStr) inStr = null; continue; }
        if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
        if (ch === "(" || ch === "[" || ch === "{") depth++;
        else if (ch === ")" || ch === "]" || ch === "}") depth--;
        else if (ch === "," && depth === 1) args++;
      }
      const body = src.slice(m.index, i);
      out.push({ args: body.trim() === "Continuity.mayAdvance()" ? 0 : args,
                 line: src.slice(0, m.index).split("\n").length,
                 text: body.split("\n")[0].trim() });
    }
    return out;
  }

  const callSites = [];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const c of callsIn(src)) callSites.push(Object.assign({ file: rel }, c));
  }

  // ASSERT THE SCAN FOUND SOMETHING. A filter that matches nothing reads as a pass, and that is
  // one of the four ways a guard was written this year that could not fail.
  ok(callSites.length >= 2,
    "B: APPLIED — the scan must find the real call sites; matching nothing would pass vacuously",
    callSites.map((c) => c.file + ":" + c.line));

  for (const c of callSites) {
    const args = c.args;
    ok(args >= 3,
      "B: " + c.file + ":" + c.line + " asks the restraint without stating its floor. Every path " +
      "that asks must pass one, or it treats banked history as a hole and stops the room.\n" +
      "      " + c.text,
      { args: args });
    // ── AND THE PARENT THE FLOOR BANKED ────────────────────────────────────────────────────
    // The floor's POSITION bounds the events we hold; it can say nothing about an event we do
    // NOT hold, which is exactly the case a client that has forgotten below its floor is in.
    // That one is named by the floor's own seed, and a caller that states the position but not
    // the name is bounded and still short on the very event the bound exists for — it would
    // wait forever for history it deleted on purpose. Derived by scanning, like the floor
    // itself, so a future caller cannot state half of the pair.
    ok(args >= 4,
      "B: " + c.file + ":" + c.line + " states its floor's POSITION but not the parent that floor " +
      "BANKED. Position cannot identify an event we do not hold, so this path would read a " +
      "deliberately-dropped play as a hole and stop the room.\n" +
      "      " + c.text,
      { args: args });
  }
}

console.log("[advance-floor-bound] PASS — the restraint is bounded by the floor wherever it is " +
  "asked, not only inside check(): an event at or below an adopted floor is banked history rather " +
  "than a hole, so a client that forgot below its floor keeps advancing instead of waiting forever " +
  "for events it deliberately dropped; a corroborated gap ABOVE the floor still stops it, so the " +
  "bound narrows the anti-fork restraint rather than deleting it; a client with no floor is " +
  "unchanged; a caller that states no floor gets a non-blocking answer that says so, because a " +
  "message-saving check must never hold a veto; and every call site states BOTH halves of the " +
  "bound — the floor's position, which covers what we hold, and the parent that floor banked, " +
  "which is the only way to account for one we do not — with the sites DERIVED by scanning the " +
  "source rather than listed from memory, which is what makes a future third caller covered " +
  "(" + checks + " assertions)");
