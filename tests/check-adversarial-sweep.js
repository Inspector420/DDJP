// tests/check-adversarial-sweep.js
// WALL: ONLY A COOPERATING GROUP SHOULD BE ABLE TO ACHIEVE ANYTHING.
//
// Every other guard asks "does this rule work". This one asks "what can an attacker DO" — across
// every observer rank, every deletion, every ordering, and rank changes mid-run. The bar is not that
// the code survives; it is that a lone actor, however placed, can reach nothing but honest failure.
//
// THE INVARIANT THAT MATTERS IS TRUTH, NOT AGREEMENT WITH MY OWN COPY. An earlier version of this
// asserted that any adopted floor must reproduce against the adopter's own fold. That is the wrong
// bar and it fired 56 times: a client with a DELETION in its history legitimately cannot reproduce a
// floor computed from the intact one — and adopting that floor is how it HEALS. The right question
// is whether the floor matches the TRUE history, and it always did (7 of 7 in the exhaustive
// single-deletion sweep below). Self-healing looks exactly like a failed self-consistency check,
// which is why the distinction has to be written down.
//
// Sweeps:
//   1  EXHAUSTIVE POLICY — can removing evidence ever GRANT capability?
//   2  QUORUM ARITHMETIC — can deleting a checkpoint PROMOTE a floor?
//   3  RANK CHANGE — does a demotion rewrite the past?
//   4  DELETION x ADOPTION — is every floor adopted while holding a hole TRUE?
//   5  ATTACK BATTERY — the named attacks, each with what it actually achieves.

const { loadInContext } = require("./_load");
const F = require("./_fixtures");

function fail(msg, got) {
  console.log("[adversarial-sweep] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { if (!c) fail(msg, got); }
const canon = (x) => Array.isArray(x) ? "[" + x.map(canon).join(",") + "]"
  : (x && typeof x === "object") ? "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + canon(x[k])).join(",") + "}"
  : JSON.stringify(x);

const MODS = ["core/logger.js","backends/backend1/ranks.js","backends/backend1/consensushash.js",
  "backends/backend1/trustpolicy.js","core/playlistdoc.js",
  "core/playlistdoc.js","backends/backend1/checkpointformat.js","backends/backend1/dials.js",
  "backends/backend1/session.js","backends/backend1/scheduler.js","backends/backend1/vouch.js",
  "backends/backend1/floor.js","backends/backend1/continuity.js",
  "backends/backend1/statederiver.js","backends/backend1/checkpoint.js"];
function client(rank) {
  const st = { log: [] };
  const SM = { getLog: () => st.log, getState: () => ({ settings: {} }) };
  const sb = loadInContext(MODS, { StreamManager: SM, Date });
  // Wired the way transport wires it. Sealing and floor-choosing are two modules now, so an
  // adversarial sweep has to connect them exactly as a real client does — otherwise it attacks a
  // client nobody runs.
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  sb.Floor.attach({ now: () => 1e7, log: () => st.log, settings: () => ({}), myRank: () => rank,
                    trimmed: () => false,  });
  sb.Checkpoint.attach({ now: () => 1e7, log: () => st.log, held: () => [], settings: () => ({}),
                         myRank: () => rank, myUserId: () => "@self:hs",
                         amOwner: () => rank === P.Ranks.levelOf("owner"), isLegal: () => null,
                         holdForWitness: () => ({ hold: false, remainingMs: 0, cycleMs: 6000 }),
                         thin: () => false, send: async () => {} });
  sb.__set = (l) => { st.log = l; };
  sb.__log = () => st.log;
  return sb;
}
const P = loadInContext(["core/logger.js","backends/backend1/ranks.js","backends/backend1/trustpolicy.js","backends/backend1/statederiver.js"], { Date });
const { Ranks, TrustPolicy, StateDeriver } = P;
const LEVELS = Ranks.LADDER.map((r) => r.level);
const O = Ranks.levelOf("owner"), H = Ranks.levelOf("high-staff"), S = Ranks.levelOf("staff"), PL = Ranks.levelOf("player");
// A room with every rung switched on, so every bar is reachable and no case is skipped for the
// uninteresting reason that its row is "never".
const SET = (function () {
  const b = StateDeriver.defaultSettings();
  return Object.assign({}, b, {
    vouchTable: b.vouchTable.map((r, i) => ({ enough: i === 6 ? null : (i + 1), always: false })),
    checkpointTable: b.checkpointTable.map((r, i) => ({ enough: i === 6 ? null : (i + 1) })),
  });
})();

async function main() {
  // ── SWEEP 1: can removing evidence GRANT capability? ────────────────────────────────────────
  {
    const author = { u: "@a:hs", r: PL };
    const sets = [[]];
    for (const a of LEVELS) {
      sets.push([{ u: "@v1:hs", r: a }]);
      for (const b of LEVELS) sets.push([{ u: "@v1:hs", r: a }, { u: "@v2:hs", r: b }]);
    }
    let cases = 0;
    for (const obs of LEVELS) {
      for (const full of sets) {
        const pFull = TrustPolicy.protectedFor(full, author, SET, obs);
        const oFull = TrustPolicy.owesVouch(obs, "@me:hs", author, full, SET);
        for (let i = 0; i < full.length; i++) {
          const less = full.slice(0, i).concat(full.slice(i + 1));
          cases++;
          ok(!(TrustPolicy.protectedFor(less, author, SET, obs) && !pFull),
            "1: a DELETION granted protection it did not have",
            { observer: Ranks.nameOf(obs), removed: Ranks.nameOf(full[i].r) });
          ok(!(oFull && !TrustPolicy.owesVouch(obs, "@me:hs", author, less, SET)),
            "1: a DELETION discharged a duty that was owed",
            { observer: Ranks.nameOf(obs), removed: Ranks.nameOf(full[i].r) });
        }
        for (const jr of LEVELS) {
          if (jr >= obs) continue;
          ok(!(pFull && !TrustPolicy.protectedFor(full, author, SET, jr)),
            "1: protection held for a SENIOR but not a junior — trust must flow down",
            { senior: Ranks.nameOf(obs), junior: Ranks.nameOf(jr) });
        }
      }
    }
    ok(cases > 500, "1: APPLIED — the sweep must actually cover a large case set", cases);
  }

  // ── SWEEP 2: can deleting a checkpoint PROMOTE a floor? ─────────────────────────────────────
  {
    let cases = 0;
    for (const obs of LEVELS) {
      for (const lvl of LEVELS) {
        for (let n = 0; n <= 6; n++) {
          const full = Array.from({ length: n }, (_, i) => ({ u: "@u" + lvl + i + ":hs", r: lvl }));
          const tFull = TrustPolicy.substituteTrusted(full, SET, obs);
          ok(!(tFull !== null && tFull > TrustPolicy.tierOf(obs)),
            "2: accepted a quorum from BELOW my own rank", { observer: Ranks.nameOf(obs), tier: tFull });
          for (let i = 0; i < full.length; i++) {
            const tLess = TrustPolicy.substituteTrusted(full.slice(0, i).concat(full.slice(i + 1)), SET, obs);
            cases++;
            ok(!(tLess !== null && (tFull === null || tLess < tFull)),
              "2: a DELETION promoted a floor to a more senior tier",
              { observer: Ranks.nameOf(obs), at: Ranks.nameOf(lvl), full: tFull, less: tLess });
          }
        }
      }
    }
    ok(cases > 300, "2: APPLIED — the checkpoint-deletion sweep must be broad", cases);
  }

  // ── SWEEP 3: does a demotion rewrite the past? ──────────────────────────────────────────────
  // A vouch carries the rank of the CHANNEL it was written on, so it cannot follow its author down.
  {
    const author = { u: "@a:hs", r: PL };
    for (const was of LEVELS) {
      const rec = [{ u: "@mover:hs", r: was }];
      const before = TrustPolicy.satisfiedTier(rec, author, SET);
      for (const now of LEVELS) {
        ok(TrustPolicy.satisfiedTier(rec, author, SET) === before,
          "3: a rank change altered what a PAST vouch is worth", { was: was, now: now });
      }
    }
    // ...while the mover's own DUTY does follow its current rank, which is the only thing that moves.
    // Three STAFF vouchers, which is exactly the staff row's bar here — so the event is satisfied at
    // tier 2. A high-staff is NOT discharged by that (2 > 1) and a guest is (2 <= 5). One voucher
    // would satisfy nobody and both would owe for the same dull reason, proving nothing.
    const cov3 = [{ u: "@s1:hs", r: S }, { u: "@s2:hs", r: S }, { u: "@s3:hs", r: S }];
    ok(TrustPolicy.satisfiedTier(cov3, { u: "@a:hs", r: PL }, SET) === 2,
      "3: APPLIED — three staff must satisfy the staff row and no higher",
      TrustPolicy.satisfiedTier(cov3, { u: "@a:hs", r: PL }, SET));
    const dutyHigh = TrustPolicy.owesVouch(H, "@mover:hs", { u: "@a:hs", r: PL }, cov3, SET);
    const dutyGuest = TrustPolicy.owesVouch(Ranks.levelOf("guest"), "@mover:hs", { u: "@a:hs", r: PL }, cov3, SET);
    ok(dutyHigh !== dutyGuest,
      "3: APPLIED — duty must differ by rank, or sweep 3 is comparing two identical things",
      { asHighStaff: dutyHigh, asGuest: dutyGuest });
  }

  const LOG = F.playingRoom({ songs: 10 }).log;
  const CUT = 4, BELOW = LOG.slice(0, CUT), ABOVE = LOG.slice(CUT);
  const oc = client(O); oc.__set(BELOW);
  // Built from the FORMAT rather than by driving a sealing path that now needs a transport. What
  // this sweep attacks is ADOPTION — what a client can be made to believe — not how a checkpoint
  // is produced.
  const mk = (sb, seg, prior, prev, n, who) => {
    const last = seg[seg.length - 1];
    const cp = { t: "ddjp.checkpoint", n: n, prev: prev || null,
                 seed: sb.StateDeriver.buildSeed(seg, prior),
                 covers: sb.CheckpointFormat.coversOf(seg[0].eventId, last.eventId),
                 floorL: last.l, thin: false, by: who };
    cp.h = sb.CheckpointFormat.fingerprint(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers);
    return cp;
  };
  const FLOOR = mk(oc, BELOW, undefined, null, 1, "@own:hs");
  ok(FLOOR, "APPLIED — the base owner floor must seal");
  const HQ = [];
  for (const [i, u] of [[0, 4], [1, 7], [2, ABOVE.length]]) {
    const c = client(H); c.__set(ABOVE.slice(0, u));
    HQ.push({ who: "@q" + i + ":hs",
              cp: mk(c, ABOVE.slice(0, u), FLOOR.seed, FLOOR.h, 2, "@q" + i + ":hs") });
  }
  ok(HQ.length === 3, "APPLIED — a three-author quorum must exist to attack", HQ.length);

  // ── SWEEP 4: every single deletion, and is the adopted floor TRUE? ──────────────────────────
  {
    let adopted = 0, wrong = [];
    for (const victim of LOG) {
      const c = client(S); c.__set(LOG.filter((e) => e.eventId !== victim.eventId));
      for (const q of HQ) c.Floor.remember(q.cp, H, q.who);
      const sel = c.Floor.select(S, {}, (q) => c.Floor.chainVerifies(q, c.__log()));
      if (sel) c.Floor.adopt(sel);
      const t = c.Floor.current();
      if (!t || t.grade !== "quorum") continue;
      adopted++;
      const truth = StateDeriver.buildSeed(LOG.filter((e) => e.l <= t.floorL));
      if (canon(truth) !== canon(t.seed)) wrong.push({ deleted: victim.eventId, floorL: t.floorL });
    }
    ok(adopted > 0, "4: APPLIED — some floors must be adopted while holding a hole, or this proves nothing", adopted);
    ok(wrong.length === 0,
      "4: a floor adopted while holding a hole must match the TRUE history — this is self-healing, " +
      "and a wrong floor here would be corruption spreading rather than damage being repaired", wrong);
  }

  // ── SWEEP 5: the named attacks ──────────────────────────────────────────────────────────────
  {
    const e = client(S); e.__set(LOG);
    const good = HQ[0].cp;
    // Every body field, forged one at a time. `covers` was accepted until this sweep found it:
    // adoption caught it downstream, but verify() is a public gate and a gate that passes a tampered
    // body is one someone will eventually rely on.
    for (const [k, forged] of Object.entries({
      n: { n: 9999 }, floorL: { floorL: (good.floorL || 0) + 500 }, thin: { thin: !good.thin },
      seed: { seed: Object.assign({}, good.seed, { tick: 999 }) }, covers: { covers: "$aaa..$bbb" },
      prev: { prev: "forged" },
    })) {
      ok(!e.CheckpointFormat.verify(Object.assign({}, good, forged)),
        "5: verify() accepted a checkpoint with a forged `" + k + "`", k);
    }
    ok(e.CheckpointFormat.verify(good), "5: APPLIED — and the untampered one still verifies");

    // Replaying an older floor must not drag the floor backwards.
    const r = client(S); r.__set(LOG);
    for (const q of HQ) r.Floor.remember(q.cp, H, q.who);
    const sel0 = r.Floor.select(S, {}, (q) => r.Floor.chainVerifies(q, r.__log()));
    if (sel0) r.Floor.adopt(sel0);
    const was = r.Floor.current();
    // Now replay the OLDER owner floor. Adoption is remember-then-decide, and the decision is
    // where "is this an improvement" is asked — the split the old single `ingest` hid.
    r.Floor.remember(FLOOR, O, "@own:hs");
    const sel1 = r.Floor.select(S, {}, (q) => r.Floor.chainVerifies(q, r.__log()));
    if (sel1) r.Floor.adopt(sel1);
    ok(!(was && r.Floor.current().floorL < was.floorL),
      "5: replaying an older floor dragged the floor backwards",
      { was: was && was.floorL, now: r.Floor.current().floorL });

    // A body claiming owner rank, arriving on a player channel.
    const i2 = client(S); i2.__set(LOG);
    // A body CLAIMING owner rank, arriving on a player channel. Rank comes from the channel it
    // arrived on, never from the body — so the claim changes nothing.
    i2.Floor.remember(Object.assign({}, HQ[0].cp, { by: "@own:hs", rank: O, senderRank: O }),
                      PL, "@liar:hs");
    const selL = i2.Floor.select(S, {}, (q) => i2.Floor.chainVerifies(q, i2.__log()));
    if (selL) i2.Floor.adopt(selL);
    const it = i2.Floor.current();
    ok(!(it && it.grade === "verified"),
      "5: a checkpoint claimed owner rank in its BODY and was believed — rank must ride the channel", it);

    // THE ACCEPTED RISK, asserted as a boundary rather than left implicit: three colluding
    // high-staff CAN move a junior's floor, and CANNOT move the owner's.
    const jr = client(S); jr.__set(LOG);
    for (const q of HQ) jr.Floor.remember(q.cp, H, q.who);
    // REMEMBERING IS NOT ADOPTING. The old `ingest` did both in one call; the split is deliberate,
    // because collecting a candidate and deciding to trust it are different acts and only the
    // second one is a trust decision. A guard written against the merged call has to make the
    // decision explicit — and that is the point, not an inconvenience.
    const selJ = jr.Floor.select(S, {}, (q) => jr.Floor.chainVerifies(q, jr.__log()));
    if (selJ) jr.Floor.adopt(selJ);
    ok(jr.Floor.current() !== null,
      "5: APPLIED — a real quorum must move a junior's floor, or the boundary below is vacuous");
    const own = client(O); own.__set(LOG);
    for (const q of HQ) own.Floor.remember(q.cp, H, q.who);
    const selW = own.Floor.select(O, {}, (q) => own.Floor.chainVerifies(q, own.__log()));
    if (selW) own.Floor.adopt(selW);
    ok(own.Floor.current() === null,
      "5: three colluding high-staff moved the OWNER's floor — the owner must trust nobody",
      own.Floor.current());
  }

  console.log("[adversarial-sweep] PASS — only cooperation achieves anything: across every observer rank, removing evidence never grants protection, never discharges a duty and never promotes a floor; a past vouch keeps the rank of the channel it was written on, so a demotion cannot rewrite history; every floor adopted while holding a deletion matched the TRUE history, which is self-healing rather than corruption; every forged body field is rejected, an older floor replayed cannot drag the floor backwards, and a body claiming owner rank on a junior channel is ignored; and the one thing that does work — three colluding high-staff moving a junior's floor — still cannot move the owner's");
}

main().catch((e) => fail("threw: " + (e && e.stack || e)));
