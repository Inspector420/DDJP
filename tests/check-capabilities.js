// tests/check-capabilities.js
// WALL: the capability function must never drift from the reducer. For every GATED
// reducer verb, Capabilities.can(...).permitted must equal whether the reducer
// actually ACTS on the same event (well-formed so the gate is the only variable).
// The vote seam is checked by delegation to voteEligible; the transport verbs
// (rank.assign / room.invite / room.upgrade — not reducer events) are unit-checked
// against their feature rule. Plus contract hygiene (reason<->permitted) and purity.
//
// If can() and the reducer ever disagree, this goes red — that is what makes
// "consolidate the scattered rules with no behavior change" a fact, not a hope.

const assert = require("assert");
const { loadInContext } = require("./_load");

const { StateDeriver, Capabilities } = loadInContext(
  ["backends/backend1/ranks.js", "backends/backend1/statederiver.js", "backends/backend1/capabilities.js"],
  {}
);

const RANK = { OWNER: 100, HIGH_STAFF: 80, STAFF: 60, VIP: 40, PLAYER: 20, GUEST: 10, UNCAT: 0 };

// --- event + scenario helpers (parsed shape derive() consumes) ---
let _seq = 0;
function ev(type, sender, rank, content) {
  _seq++;
  return { type, sender, senderRank: rank, content: content || {}, eventId: "e" + _seq, ts: _seq * 1000 };
}
const join      = (u, r, v) => ev("ddjp.dj.join", u, r, { v });
const declare   = (u, r, v) => ev("ddjp.dj.declare", u, r, { v });
const play      = (u, r, p) => ev("ddjp.dj.play", u, r, { p: p || null });

const S = (log) => StateDeriver.derive(log);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// Did appending `e` to `log` change the derived state? (the reducer "acted")
const changed = (log, e) => !eq(S(log), S(log.concat([e])));

let checks = 0;
// Assert can().permitted === reducer-acted, for a well-formed event.
function equiv(verb, log, e, target) {
  const before = S(log);
  const ctx = { myId: e.sender, myRank: e.senderRank, now: 0, target: target || {} };
  const permitted = Capabilities.can(verb, before, ctx).permitted;
  const acted = changed(log, e);
  assert.strictEqual(
    permitted, acted,
    `[${verb}] can.permitted=${permitted} but reducer acted=${acted} (sender=${e.sender} rank=${e.senderRank})`
  );
  checks++;
}

// ---------- 1. Gated reducer verbs: can ≡ reducer ----------

// base rotation: A[s1,s2], B[s3]  (order A, B)
const base = [join("@a", 20, "s1"), declare("@a", 20, "s2"), join("@b", 20, "s3")];
// with a nowPlaying (A played s1; rotation now B, A[s2]; np.pi = play id)
const withNP = base.concat([play("@a", 20, null)]);
const npPi = S(withNP).nowPlaying.pi;

// dj.skip — something playing AND (I'm the DJ OR VIP+)
equiv("dj.skip", withNP, ev("ddjp.dj.skip", "@a", 0,  { p: npPi }));   // DJ, any rank -> yes
equiv("dj.skip", withNP, ev("ddjp.dj.skip", "@c", 40, { p: npPi }));   // other, VIP -> yes
equiv("dj.skip", withNP, ev("ddjp.dj.skip", "@c", 20, { p: npPi }));   // other, <VIP -> no

// dj.move — Staff+, target is a movable member
equiv("dj.move", base, ev("ddjp.dj.move", "@x", 60, { x: "@b", after: null }), { userId: "@b" });  // yes
equiv("dj.move", base, ev("ddjp.dj.move", "@x", 40, { x: "@b", after: null }), { userId: "@b" });  // no (<Staff)

// dj.remove — Staff+ may remove ANYONE in the rotation (rank-blind, like skip-others)
const baseHi = [join("@a", 20, "s1"), join("@b", 80, "s3")];   // B is High-Staff
equiv("dj.remove", base,   ev("ddjp.dj.remove", "@x", 60, { x: "@b" }), { userId: "@b", targetRank: 20 }); // staff removes player -> yes
equiv("dj.remove", baseHi, ev("ddjp.dj.remove", "@x", 60, { x: "@b" }), { userId: "@b", targetRank: 80 }); // staff removes HIGH-STAFF -> yes (rank-blind)
equiv("dj.remove", base,   ev("ddjp.dj.remove", "@x", 40, { x: "@b" }), { userId: "@b", targetRank: 20 }); // <Staff -> no

// dj.strike — Staff+ may strike ANY DJ's named song (rank-blind); no-op if not in their buffer
equiv("dj.strike", base,   ev("ddjp.dj.strike", "@x", 60, { x: "@a", v: "s1" }), { userId: "@a", videoId: "s1" }); // staff strikes A's s1 -> yes
equiv("dj.strike", baseHi, ev("ddjp.dj.strike", "@x", 60, { x: "@b", v: "s3" }), { userId: "@b", videoId: "s3" }); // staff strikes HIGH-STAFF's song -> yes
equiv("dj.strike", base,   ev("ddjp.dj.strike", "@x", 40, { x: "@a", v: "s1" }), { userId: "@a", videoId: "s1" }); // <Staff -> no
equiv("dj.strike", base,   ev("ddjp.dj.strike", "@x", 60, { x: "@a", v: "s9" }), { userId: "@a", videoId: "s9" }); // song not in their buffer -> no

// dj.reset — High-Staff+
equiv("dj.reset", base, ev("ddjp.dj.reset", "@x", 80, {}));   // yes
equiv("dj.reset", base, ev("ddjp.dj.reset", "@x", 60, {}));   // no

// room.settings — Owner only
equiv("room.settings", [], ev("ddjp.room.settings", "@o", 100, { s: { chat: "guest" } }));  // yes
equiv("room.settings", [], ev("ddjp.room.settings", "@o", 80,  { s: { chat: "guest" } }));  // no

// dj.leave — member vs not
equiv("dj.leave", base, ev("ddjp.dj.leave", "@a", 20, {}));   // member -> yes
equiv("dj.leave", base, ev("ddjp.dj.leave", "@z", 20, {}));   // not a member -> no

// dj.declare — member (with buffer room) vs not
const oneSong = [join("@a", 20, "s1")];   // A has room for 1 more
equiv("dj.declare", oneSong, ev("ddjp.dj.declare", "@a", 20, { v: "s9" }), { videoId: "s9" }); // member -> yes
equiv("dj.declare", oneSong, ev("ddjp.dj.declare", "@z", 20, { v: "s9" }), { videoId: "s9" }); // not -> no

// dj.order — member vs not
const twoSong = [join("@a", 20, "s1"), declare("@a", 20, "s2")];
equiv("dj.order", twoSong, ev("ddjp.dj.order", "@a", 20, { o: ["s2", "s1"] })); // member -> yes
equiv("dj.order", twoSong, ev("ddjp.dj.order", "@z", 20, { o: ["s2", "s1"] })); // not -> no

// dj.undeclare — member AND videoId in my buffer
equiv("dj.undeclare", twoSong, ev("ddjp.dj.undeclare", "@a", 20, { v: "s2" }), { videoId: "s2" }); // yes
equiv("dj.undeclare", twoSong, ev("ddjp.dj.undeclare", "@a", 20, { v: "s9" }), { videoId: "s9" }); // not in buffer -> no
equiv("dj.undeclare", twoSong, ev("ddjp.dj.undeclare", "@z", 20, { v: "s1" }), { videoId: "s1" }); // not member -> no

// dj.join — the bar is a ROOM SETTING now (J07), so this verb's answer depends on state. Driven
// here at the DEFAULT bar (everyone admitted) plus one raised-bar pair, because this file's job is
// the can()≡reducer equivalence and a verb whose answer became state-dependent has to be exercised
// on both sides of it. The full (bar × rung) sweep lives in check-min-dj-rank; duplicating it here
// would be a second copy of one rule, which is what P7 forbids.
equiv("dj.join", [], join("@n", 0, "s5"));
{
  const owner = "@o", weak = "@w";
  const strict = Object.assign({}, StateDeriver.defaultSettings(), { minDjRank: "staff" });
  const barred = [ev("ddjp.room.settings", owner, RANK.OWNER, { s: strict })];
  // below the bar -> can() must say no AND the reducer must not act
  equiv("dj.join", barred, join(weak, RANK.GUEST, "s6"));
  // at the bar -> both yes. The control: without it the line above passes on a rulebook that
  // refuses every join once any bar is set.
  equiv("dj.join", barred, join("@s", RANK.STAFF, "s7"));
}

// ---------- 2. Vote seam: can delegates to voteEligible ----------
for (const r of [0, 20, 40, 100]) {
  const expect = StateDeriver.voteEligible("@u", "@dj", r);
  const got = Capabilities.can("react.vote", S(withNP), { myId: "@u", myRank: r, target: { pi: npPi, djOfSong: "@dj" } }).permitted;
  assert.strictEqual(got, expect, `[react.vote] must equal voteEligible for rank ${r}`);
  checks++;
}

// ---------- 3. Transport verbs: unit rules ----------
function assertCan(verb, ctx, expected, label) {
  assert.strictEqual(Capabilities.can(verb, {}, ctx).permitted, expected, "[" + verb + "] " + label);
  checks++;
}
// rank.assign — Staff+, newLevel < mine, targetRank < mine
assertCan("rank.assign", { myRank: 60, target: { targetRank: 20, newLevel: 40 } }, true,  "staff assigns below self");
assertCan("rank.assign", { myRank: 40, target: { targetRank: 20, newLevel: 20 } }, false, "below staff cannot");
assertCan("rank.assign", { myRank: 60, target: { targetRank: 20, newLevel: 60 } }, false, "newLevel not below self");
assertCan("rank.assign", { myRank: 60, target: { targetRank: 60, newLevel: 20 } }, false, "target not below self");
// room.invite — always permitted today
assertCan("room.invite", { myRank: 0 }, true, "anyone may invite");
// room.upgrade — Owner + cooldown
assertCan("room.upgrade", { myRank: 100, now: 0, target: {} }, true, "owner, no cooldown");
assertCan("room.upgrade", { myRank: 80, now: 0, target: {} }, false, "non-owner");
assertCan("room.upgrade", { myRank: 100, now: 1000, target: { retryAt: 5000 } }, false, "in cooldown");
assertCan("room.upgrade", { myRank: 100, now: 5000, target: { retryAt: 1000 } }, true, "cooldown passed");
{
  const r = Capabilities.can("room.upgrade", {}, { myRank: 100, now: 1000, target: { retryAt: 5000 } });
  assert.strictEqual(r.retryAt, 5000, "[room.upgrade] carries retryAt when in cooldown");
  checks++;
}

// ---------- 4. Contract hygiene + purity ----------
// reason is null iff permitted, and a non-empty string when not.
for (const verb of Capabilities.VERBS) {
  for (const myRank of [0, 40, 100]) {
    const d = Capabilities.can(verb, S(withNP), { myId: "@a", myRank, now: 0, target: { userId: "@b", targetRank: 20, videoId: "s2", pi: npPi } });
    assert.strictEqual(d.reason === null, d.permitted === true, "[" + verb + "] reason must be null iff permitted");
    if (!d.permitted) assert.ok(typeof d.reason === "string" && d.reason.length > 0, "[" + verb + "] denied needs a reason string");
    checks++;
  }
}
// purity: same inputs -> equal result; no mutation of a frozen state/ctx.
{
  const state = Object.freeze(S(base));
  const ctx = Object.freeze({ myId: "@x", myRank: 60, now: 0, target: Object.freeze({ userId: "@b", targetRank: 20 }) });
  const a = Capabilities.can("dj.remove", state, ctx);
  const b = Capabilities.can("dj.remove", state, ctx);
  assert.ok(eq(a, b), "can() must be deterministic");
  checks++;   // (Object.freeze would have thrown on mutation)
}
// snapshot returns a descriptor for every target-free verb.
{
  const snap = Capabilities.snapshot(S(withNP), { myId: "@a", myRank: 100, now: 0 });
  for (const v of Capabilities.TARGET_FREE) assert.ok(snap[v] && typeof snap[v].permitted === "boolean", "snapshot missing " + v);
  checks++;
}

console.log("[capabilities] PASS — can() ≡ reducer for every gated verb; vote delegates to the seam; transport verbs unit-checked; reason/purity hold (" + checks + " assertions)");
process.exit(0);
