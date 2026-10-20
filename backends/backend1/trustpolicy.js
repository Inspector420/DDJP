// backends/backend1/trustpolicy.js
//
// THE TRUST SEAM — the single place that turns channel-origin ranks into trust judgments.
// Every backend trust decision routes through here (check-trust-policy enforces it: no bare
// rank literal at a call site). Loads before recovery/checkpointengine/vouchpolicy.
//
// THE MODEL (see docs: resilience redesign). One STRICT CASCADE, driven by a per-rank TABLE:
//
//   An event is SATISFIED at the highest tier whose bar is met. A tier's bar of N means
//   N DISTINCT USERS at that rank OR ABOVE have vouched it, EXCLUDING the event's sender
//   (nobody vouches themselves). A tier may be set to "never" (no count) — it can then never
//   satisfy on its own.
//
//   DUTY is separate from coverage. I owe a vouch unless the event is satisfied at MY tier or
//   better ("don't trust down" — a present high rank keeps working to its own bar even when a
//   lower tier already covered it). A "never" tier owes nothing unless its ALWAYS toggle is on,
//   which means "pitch in whenever nothing above is satisfied".
//
//   Identity vs rank: counting dedupes by USER ID; the rank is always the channel-origin rank
//   stamped at ingest, never a body field.
//
// Exports: tierOf · satisfiedTier · owesVouch · substituteTrusted · gradeForTier · earnsForget.
// The rules are DATA (settings.vouchTable / settings.checkpointTable), so a room's whole
// character changes by editing config, never call sites.
//
// Pure: no I/O, no clock, no upward deps. Safe under check-boundaries (layer purity); the reducer's own
// no-side-effects rule is check-statederiver-purity.

const TrustPolicy = (() => {

  // The ladder is declared ONCE, in Ranks. Tiers are ladder positions, so tierOf is
  // Ranks.tierOf — the tables below have exactly one row per rung and cannot drift out
  // of step with the ladder. A missing/NaN rank floors to the weakest tier (never
  // throws, never trusts).
  // `TIER_NAMES` was bound here and never read — the ladder is reached through `Ranks` directly.
  const tierOf = Ranks.tierOf;

  // ── THE TABLES (defaults; overridden by log-ordered room settings) ─────────────────────────
  // One row per ladder rung, strongest first.
  // enough: N distinct non-sender vouchers at this rank-or-above satisfies the tier. null = never.
  // always: this rank vouches anyway whenever nothing above is satisfied (only meaningful for a
  //         "never" tier; a counted tier already has standing duty).
  // ONE HOME: Ranks owns these, beside the ladder they are one row per rung of. This module used
  // to carry its own copy, so the trust rules and the reducer could drift about who satisfies what.
  const DEFAULT_VOUCH_TABLE = Ranks.defaultVouchTable();

  // Checkpoint SUBSTITUTES (owner-away fallback): N checkpoints from N DIFFERENT users at this
  // rank-or-above stand in for an owner floor. The caller must ALSO verify the span computes
  // through them and they agree; this table only answers the counting question.
  const DEFAULT_CHECKPOINT_TABLE = Ranks.defaultCheckpointTable();

  function _rows(settings, key, def) {
    const t = settings && settings[key];
    return (Array.isArray(t) && t.length === def.length) ? t : def;
  }
  function _enough(row) {
    const n = row && row.enough;
    return (typeof n === "number" && isFinite(n) && n >= 1) ? Math.floor(n) : null;   // null = never
  }

  // Count DISTINCT USERS at tier <= maxTier, excluding the event's sender. Entries are
  // { u: userId, r: channelOriginRank }; a bare number is accepted as a rank-only entry (each
  // counts as its own identity, which is what the single-checkpoint anchor check wants).
  function _countDistinct(entries, maxTier, excludeUser) {
    const seen = Object.create(null);
    let n = 0, anon = 0;
    for (const e of (Array.isArray(entries) ? entries : [])) {
      if (e === null || e === undefined) continue;
      const isObj = (typeof e === "object");
      const rank = isObj ? e.r : e;
      const user = isObj ? e.u : null;
      if (tierOf(rank) > maxTier) continue;                    // rank-or-above only
      if (excludeUser && user && user === excludeUser) continue; // never counts its own sender
      const key = user || ("\u0000anon" + (anon++));            // rank-only entries are distinct
      if (seen[key]) continue;
      seen[key] = 1; n++;
    }
    return n;
  }

  // OWNER SELF-COUNT. Everyone else needs someone else to confirm their events, because anyone
  // else's event can be deleted by a moderator — the point of a vouch is that a SECOND party can
  // regenerate it. The owner's own events are different in kind: nobody below the top rank can
  // delete another person's message at all, so an owner's event can only be removed by the owner.
  // Demanding coverage there would mean defending the owner against the owner, and would leave a
  // quiet room permanently "unsafe". Owner events are therefore EXEMPT — not "self-counted", but
  // outside the question entirely, decided by CHANNEL ORIGIN in satisfiedTier and in
  // Vouch.eligible. This is owner-ONLY: giving it to a lower rank would let anyone declare
  // their own events safe, which is exactly what the never-vouch-yourself rule exists to prevent.

  // ---- SATISFIED TIER: the highest tier whose bar this event meets, or null. Scanning top-down
  // and returning the first match IS the strict cascade — a lower tier only matters when every
  // tier above it fell short. `sender` may be a plain user id, or { u, r } when the caller knows
  // the author's channel-origin rank (needed for the owner self-count above). ----
  function satisfiedTier(vouchers, sender, settings) {
    const rows = _rows(settings, "vouchTable", DEFAULT_VOUCH_TABLE);
    const senderId = (sender && typeof sender === "object") ? sender.u : sender;
    const senderRank = (sender && typeof sender === "object") ? sender.r : null;
    // OWNER EXEMPTION — an owner's own event is satisfied outright, by CHANNEL ORIGIN.
    // Nobody below the top rank can delete another person's message, so an owner event
    // can only be removed by the owner; demanding coverage would mean defending the
    // owner against the owner, and would leave a quiet room permanently unsafe.
    //
    // This used to be expressed by synthesising a fake voucher entry for the sender and
    // flipping the exclusion — which only produced the right answer when the caller
    // passed the sender's RANK. One caller passed a bare user id, so the same event read
    // as satisfied while vouching and unsatisfied while evicting. Asking about origin
    // instead of counting makes that class of bug unrepresentable.
    if (senderRank !== null && senderRank !== undefined && tierOf(senderRank) === 0) return 0;
    for (let t = 0; t < rows.length; t++) {
      const need = _enough(rows[t]);
      if (need === null) continue;                              // "never" — cannot satisfy
      if (_countDistinct(vouchers, t, senderId) >= need) return t;
    }
    return null;
  }

  // ---- IS THIS EVENT PROTECTED AT MY BAR? satisfiedTier answers "at what tier"; every caller then
  // has to make the same comparison against its own tier, and writing that comparison out at each
  // call site is exactly how the vouching path and the seal gate came to disagree — one compared,
  // the other tested `=== null` and accepted coverage from anybody. One home for the rule.
  //
  // COVERAGE FROM BELOW DOES NOT DISCHARGE YOU. Three guest vouches do not beat one staff vouch,
  // and quantity below you never promotes anything.
  //
  // An unknown observer fails CLOSED — Ranks.tierOf answers "weakest" for a non-number, which is the
  // safe default for DUTY (you owe more) and the unsafe one for ACCEPTANCE (you accept more). This
  // is the acceptance side, so it must not inherit that default. ----
  // Exported because vouchpolicy's floor search asks the same question. One home for the rule: if
  // this default is ever softened it must soften in exactly one place.
  function _observerTier(myRank) {
    return (typeof myRank === "number" && isFinite(myRank)) ? tierOf(myRank) : 0;
  }
  function protectedFor(vouchers, sender, settings, myRank) {
    const sat = satisfiedTier(vouchers, sender, settings);
    return sat !== null && sat <= _observerTier(myRank);
  }

  // ---- DUTY: do I still owe this event a vouch? Never for my own events. Otherwise I rest only
  // when it is satisfied at MY tier or better; a lower-tier cover does NOT discharge me
  // ("don't trust down"). A "never" tier owes nothing unless its ALWAYS toggle is on. ----
  function owesVouch(myRank, myUserId, sender, vouchers, settings) {
    const senderId = (sender && typeof sender === "object") ? sender.u : sender;
    if (myUserId && senderId && myUserId === senderId) return false;   // never vouch yourself
    const myTier = tierOf(myRank);
    // THE SAME COMPARISON THE SEAL GATE MAKES, and deliberately the same code. This used to spell
    // out `sat <= myTier` here while canCheckpoint spelled out `=== null` there, which is two
    // hand-maintained copies of one rule — the failure docs/paths.md §7 records twice.
    if (protectedFor(vouchers, sender, settings, myRank)) return false;   // my bar (or better) is met
    const rows = _rows(settings, "vouchTable", DEFAULT_VOUCH_TABLE);
    const row = rows[myTier] || {};
    if (_enough(row) !== null) return true;                            // I can contribute to my bar
    return row.always === true;                                        // "never" tier: only if toggled
  }

  // ---- SUBSTITUTE CHECKPOINTS: the highest tier whose different-user checkpoint count is met, AS
  // JUDGED BY THE OBSERVER, or null. Same cascade shape, same don't-trust-down rule.
  // `checkpoints` = [{ u: authorUserId, r: originRank }]. The caller still has to prove the span
  // computes through them and they agree.
  //
  // The scan runs top-down, so the moment it passes the observer's own tier every remaining row is
  // a rank BELOW the observer and none of them can bind it — hence the break rather than a filter
  // after the fact. The owner sits alone at the top and accepts tier 0 only: "the owner trusts
  // nobody" is not a special case in the code, it is this loop breaking immediately. ----
  function substituteTrusted(checkpoints, settings, myRank) {
    const rows = _rows(settings, "checkpointTable", DEFAULT_CHECKPOINT_TABLE);
    const myTier = _observerTier(myRank);
    for (let t = 0; t < rows.length; t++) {
      if (t > myTier) break;                                   // a floor from below me does not bind me
      const need = _enough(rows[t]);
      if (need === null) continue;
      if (_countDistinct(checkpoints, t, null) >= need) return t;
    }
    return null;
  }

  // ---- GRADES + forget-asymmetry. Given the tier that vouched for a floor (from
  // Floor.select, which then chains them) — or null when nothing is trustable:
  //   real     — I computed it myself.
  //   verified — an OWNER floor (tier 0): owner always wins.
  //   quorum   — a delegated SUBSTITUTE whose members chain into each other. Since Step 12 this is
  //              proof rather than mere liveness, and it earns forgetting like the two above.
  //   stale    — a quorum floor that STOPPED verifying under a client that had already forgotten
  //              below it. Kept as the compute base, earns nothing further.
  //   none     — FAILSAFE: don't adopt it; computing from what I hold is always safe.
  // `real`, `verified` AND `quorum` earn the right to drop the raw log; `stale` and `none` do not.
  // This is the ONLY place the grading rule lives — the checkpoint engine calls it rather than
  // re-deriving it.
  //
  // (That line read "only PROVED grades (real/verified)" until J05, which was true before Step 12
  // promoted substitutes and false afterwards — while the paragraphs below it explained the
  // promotion at length. A reader who stopped at the first sentence carried away the inverse of
  // what `earnsForget` returns.)
  // ---- HOW MUCH IS THIS FLOOR WORTH? Three grades, and they answer two DIFFERENT questions that
  // used to be one:
  //   "real"     I folded it myself. Strongest.
  //   "verified" an OWNER floor, taken on authority.
  //   "quorum"   a SUBSTITUTE: N different authors at a tier I accept, whose floors chain into each
  //              other. Was "trusted", which meant accepted-but-second-class.
  //
  // STEP 12 PROMOTES "quorum" TO EARN FORGETTING. The accepted risk, stated plainly: the cheapest
  // forgery is three distinct high-staff producing matching floors, and only the OWNER can mint
  // high-staff. So the attack surface is exactly and only who the owner promotes, and an owner who
  // trusts nobody and recomputes beats a colluding quorum. The owner may raise the bar for more
  // resilience; that is what the checkpoint table is for.
  //
  // This is safe ONLY while verification-by-recompute stays mandatory. A colluding quorum cannot
  // assert arbitrary history — only history that RECOMPUTES — so the forgery lands only on a client
  // that cannot compute the span. That is thin clients, which is why thin re-paging (Step 10) had to
  // exist first: a thin client must re-page to verify. Never skip.
  //
  // The rename is not cosmetic. "quorum" now says HOW the floor was obtained, which is a different
  // question from what it is worth — and once substitutes earn forgetting those two questions stop
  // having the same answer. Re-validation keys off the grade meaning "obtained by recomputation from
  // peers", and that has to keep working after this promotion. See Floor.revalidate.
  function gradeForTier(tier, computedSelf) {
    if (computedSelf) return "real";
    if (tier === null || tier === undefined) return "none";
    return (tier === 0) ? "verified" : "quorum";
  }
  // "stale" is a fourth grade and deliberately not produced by gradeForTier: it is what a QUORUM floor
  // is demoted to when it stops verifying under a client that has already trimmed below it. Such a
  // floor cannot be withdrawn — there is nothing left to recompute from — so it stays as the compute
  // base while earning nothing further. See Floor.revalidate.
  function earnsForget(grade) {
    return grade === "real" || grade === "verified" || grade === "quorum";
  }

  return {
    DEFAULT_VOUCH_TABLE,
    tierOf, observerTier: _observerTier, satisfiedTier, protectedFor, owesVouch, substituteTrusted, gradeForTier, earnsForget,
  };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { TrustPolicy };
