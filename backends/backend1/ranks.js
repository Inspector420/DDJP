// backends/backend1/ranks.js
// THE RANK LADDER — the one place DDJP's rank vocabulary is declared. Loaded FIRST
// in the backend so every other module reads the ladder rather than restating it.
// Before this module the ladder was typed out in four backend modules and four more
// feature-level literals; a threshold could drift in one and not the others.
//
// NAMES vs NUMBERS. A rank is a NAME ("staff"). The number is a MATRIX POWER LEVEL —
// an implementation detail of the transport that happens to encode the same order.
// Numbers are legitimate in exactly two places: writing power levels when a channel
// is created, and reading the power level Matrix hands back. Everywhere else — gates,
// trust tiers, vouch decisions, display — the NAME is the currency. Numbers leaking
// past the transport is what made `rank < 60` appear in five feature modules.
//
// Rank is proved by CHANNEL ORIGIN, never by a claim in an event body: a channel is
// power-gated, so an event that arrived in events-staff was written by someone Matrix
// itself judged to be Staff+. That is why the ladder is welded to Matrix power levels
// and can never become a per-room setting — the proof would go with it.
//
// This is a BACKEND INTERNAL (check-boundaries rule F). Features reach the ladder
// through Capabilities, which re-exports what the app legitimately needs, so a
// feature can never hold its own copy of a threshold again.

const Ranks = (() => {

  // Ordered STRONGEST FIRST. Index in this array is the TIER — the row index into
  // the vouch and checkpoint tables — so the ladder and the tables can never
  // disagree about how many tiers exist or what order they are in.
  const LADDER = [
    // OWNER IS 99, NOT 100, AND THE GAP IS DELIBERATE. Matrix reserves `state_default`
    // and `redact` at 100, so a second owner-tier account created at 99 reads as `owner`
    // to every DDJP gate and still cannot send state events, move power levels, promote
    // itself or redact somebody else's message. The human room creator sits at 100 and
    // keeps those. This is a MOVED rung, not an inserted one — seven rungs, same order,
    // so the vouch and checkpoint table row indices are unchanged.
    //
    // ── CORRECTED: "cannot promote itself" IS TRUE, AND NOT FOR THE REASON THIS HEADER GAVE ──
    // The claim is right; the mechanism named was wrong, and the difference matters because a
    // reader takes the mechanism as the guarantee. An account at 99 cannot promote itself because
    // `m.room.power_levels` is a STATE EVENT and `state_default` is 100 — the HOMESERVER refuses
    // the write. It is not because 99 reads as a weaker rank anywhere in this app: **it does not.**
    //
    // MEASURED while building the bot runtime, which is the job that had to depend on it:
    //
    //     nameOf(99)  = "owner"    atLeast(99,"owner")  = true
    //     nameOf(100) = "owner"    atLeast(100,"owner") = true    <-- the human owner
    //     nameOf(101) = "owner"    atLeast(101,"owner") = true
    //
    // **THE LADDER SATURATES.** `nameOf` and `atLeast` are floor comparisons against the top rung,
    // so every level at or above 99 answers `owner`, and NO RANK GATE IN THIS APP DISTINGUISHES
    // THE BOT FROM THE HUMAN OWNER. The 99/100 gap is enforced entirely by Matrix and entirely
    // outside these functions.
    //
    // WHAT THAT COSTS A READER WHO BELIEVES THE OLD WORDING: they write `atLeast(level, "owner")`
    // expecting it to mean *the bot*, and it admits the human too. `features/botruntime.js` needs
    // exactly that distinction for its entry gate and therefore compares `=== ` the top rung,
    // because admitting both puts two authorities on a last-write-wins settings blob — concurrent
    // writers overwrite rather than merge, and the loser's change vanishes silently.
    //
    // SO: THE GAP IS A MATRIX GUARANTEE, NOT A LADDER ONE. Anything in this app that needs to tell
    // 99 from 100 must compare the NUMBER, and must read the number from this ladder rather than
    // restating it — `Room.rankLadder()` is the legal route from `features/`.
    { name: "owner",         level: 99  },
    { name: "high-staff",    level: 80  },
    { name: "staff",         level: 60  },
    { name: "vip",           level: 40  },
    { name: "player",        level: 20  },
    { name: "guest",         level: 10  },
    { name: "uncategorized", level: 0   },
  ];

  const NAMES = LADDER.map((r) => r.name);
  const TIER_COUNT = LADDER.length;

  const _levelByName = Object.create(null);
  const _tierByName = Object.create(null);
  for (let i = 0; i < LADDER.length; i++) {
    _levelByName[LADDER[i].name] = LADDER[i].level;
    _tierByName[LADDER[i].name] = i;
  }

  // ---- PURE: name -> power level. Unknown name -> null (never a silent 0, which
  // would read as "uncategorized" and quietly grant the weakest rank). ----
  function levelOf(name) {
    const v = _levelByName[String(name)];
    return (typeof v === "number") ? v : null;
  }

  // ---- PURE: power level -> the strongest ladder name it reaches. A level between
  // rungs rounds DOWN (a level of 70 is "staff", not "high-staff") so an unexpected
  // Matrix value can never round UP into authority it wasn't granted. ----
  function nameOf(level) {
    const n = (typeof level === "number" && isFinite(level)) ? level : -1;
    for (const r of LADDER) if (n >= r.level) return r.name;
    return "uncategorized";
  }

  // ---- PURE: tier index (0 = owner). Accepts a name OR a power level, because the
  // transport boundary hands back numbers and everything above it uses names. ----
  // ── THE DEFAULT PER-RANK TABLES — ONE HOME ───────────────────────────────────────────────────
  // These lived in trustpolicy AND statederiver as two hand-maintained copies of one fact, which is
  // the failure docs/paths.md §7 records twice. Here it would mean the reducer and the trust rules
  // disagreeing about who can satisfy an event — a room where what you may do and what counts as
  // done are answered from different tables. They live beside the ladder because they are one row
  // per rung and must resize with it.
  //
  // RATIFIED SHAPE: VIP is the lowest rung that can satisfy anything. Player, guest and
  // uncategorized are OFF by default, so quantity below VIP never adds up to protection — the
  // anti-sybil guarantee stays structural at the bottom rather than becoming a number that can be
  // out-counted. The owner may switch player and guest on; uncategorized is not a dial (Capabilities).
  //
  // Handed out as COPIES: a caller that edited a shared array would rewrite every room's defaults.
  const _DEFAULT_VOUCH_TABLE = [
    { enough: 1,    always: false },   // owner — exempt by origin; inert for owner events
    { enough: 2,    always: false },   // high-staff
    { enough: 3,    always: false },   // staff
    { enough: 4,    always: false },   // vip
    // PLAYER AND GUEST VOUCH FOR THEMSELVES. `enough: null` means their vouches satisfy NOBODY's
    // bar — no rung, including their own, is discharged by them — so nobody else ever relies on
    // their word. `always: true` means they still do the work whenever nothing above them has
    // covered an event. The point is not to help the room: it is that a client which has witnessed
    // a span itself can seal its OWN floor over it (graded "real", the strongest grade there is) and
    // forget below it. Without this they never vouch, never self-witness, and can only forget when a
    // senior happens to have covered the span for them.
    { enough: null, always: true },    // player — vouches, satisfies nobody
    { enough: null, always: true },    // guest — same
    { enough: null, always: false },   // uncategorized — never, and not editable
  ];
  const _DEFAULT_CHECKPOINT_TABLE = [
    { enough: 1 },      // owner — one owner checkpoint is authoritative
    { enough: 3 },      // high-staff
    { enough: 4 },      // staff
    { enough: 5 },      // vip
    { enough: null },   // player — never
    { enough: null },   // guest — never
    { enough: null },   // uncategorized — never, and not editable
  ];
  function defaultVouchTable() { return _DEFAULT_VOUCH_TABLE.map((r) => ({ enough: r.enough, always: r.always })); }
  function defaultCheckpointTable() { return _DEFAULT_CHECKPOINT_TABLE.map((r) => ({ enough: r.enough })); }

  function tierOf(rank) {
    if (typeof rank === "string") {
      const t = _tierByName[rank];
      return (typeof t === "number") ? t : TIER_COUNT - 1;
    }
    return _tierByName[nameOf(rank)];
  }

  // ---- PURE: is `rank` at least `name`? The comparison every gate should use.
  // Lower tier index = stronger, so "at least" is <=. ----
  function atLeast(rank, name) {
    const need = _tierByName[String(name)];
    if (typeof need !== "number") return false;
    return tierOf(rank) <= need;
  }

  // ---- THE GATES ────────────────────────────────────────────────────────────────
  // Every act that requires a rank, and the rank it requires. HARDWIRED today: these
  // are protocol, agreed by everyone running DDJP, not per-room policy — a room that
  // could lower its own skip gate would derive differently from one that didn't.
  //
  // They live HERE, as one named table, so that if a gate ever does become settable
  // it is one table body that changes plus a convergence guard, not a hunt through
  // five features. The reducer enforces them on ingest and Capabilities answers
  // "may I?" from the same table — check-capabilities proves the two agree.
  //
  // NOT gates: dj.join / dj.leave / dj.declare / dj.order / dj.undeclare are open to
  // everyone, gated by rotation membership rather than rank, so they are absent by
  // design rather than by omission.
  //
  // ── TWO ROWS WHOSE ENFORCER IS NOT THE REDUCER (J14) ─────────────────────────
  // `member.kick` and `member.ban` are MATRIX MEMBERSHIP acts, in the same family
  // as `rank.assign` / `room.upgrade`: no reducer branch judges them and none ever
  // can, because they never become Spine events. Their enforcer is the homeserver,
  // via the channel power levels `matrixbridge._powerLevels` writes at creation —
  // `ban: 99`, `kick: 60`.
  //
  // SO THESE TWO LEVELS ARE NOT A PREFERENCE. They are the weakest ladder rung that
  // MEETS the corresponding power level, and choosing anything weaker would produce
  // a button that reports permitted and yields a 403 from the server — the same
  // rulebook-vs-enforcement drift `check-capabilities` exists to catch for reducer
  // verbs, arriving through a different enforcer. `check-user-card` PART A derives
  // both from `_powerLevels` by EXECUTING it and fails if either row disagrees, so
  // changing one without the other turns the build red rather than shipping a lie.
  const GATES = {
    "dj.skip.others": "vip",         // skipping a song that is not mine
    "dj.move":        "staff",
    "dj.remove":      "staff",
    "dj.strike":      "staff",
    "dj.reset":       "high-staff",
    "room.settings":  "owner",
    "count.set":      "owner",       // owner-set absolute vote/save baseline
    "rank.assign":    "staff",       // plus: target and new level strictly below mine
    "room.upgrade":   "owner",
    "member.kick":    "staff",       // = Ranks.nameOf-equivalent of _powerLevels.kick (60)
    "member.ban":     "owner",       // = the weakest rung meeting _powerLevels.ban (99)
  };

  // ---- PURE: the rank an act needs, or null if the act is not rank-gated. ----
  function gateFor(act) {
    const g = GATES[String(act)];
    return (typeof g === "string") ? g : null;
  }

  // ---- PURE: may this rank perform this act? An unknown act is DENIED, so adding a
  // gated action without declaring its gate fails closed rather than open. ----
  function permits(rank, act) {
    const need = gateFor(act);
    if (need === null) return false;
    return atLeast(rank, need);
  }

  // ---- THE STAGGER ─────────────────────────────────────────────────────────────
  // ONE turn-taking delay, used at every site where several clients could do the same
  // job: vouching, repair, checkpoint sealing, length reports, blocked reports, the
  // availability escape, and the ceiling advance. Sites differ in WHAT they emit, never
  // in HOW they take turns. Before this there were seven implementations with three
  // different ladders and two that were pure random — including the ceiling escape,
  // which was documented as rank-ordered and read no rank at all.
  //
  // Rank decides your SLOT: the owner acts first, each rank below waits one more step.
  // Jitter spreads PEERS within their own slot — peers are equal, so there is nothing to
  // derive an order from, and a deterministic tiebreak would make the same client do all
  // the work forever. The jitter window is HALF a step, which leaves a clean gap before
  // the next rank's slot; that gap is the observation window where the next rank sees the
  // job already done and stays quiet. A full-width window would let slots overlap and
  // destroy exactly that.
  //
  // The OWNER tier takes no random jitter — at most two owner-authority clients exist (a
  // human and a bot) and they are ordered deliberately by their own device-local offsets,
  // clamped to one step so an owner can at worst tie with high-staff, never overtake.
  function staggerMs(rank, spacingMs, rng, ownerOffsetMs) {
    // ZERO IS A VALUE, NOT AN ABSENCE. This used to fall back to 1000 for any spacing <= 0, so a
    // room that set its ladder step to 0 — the documented minimum, meaning "no ladder" — silently
    // got a one-second-per-tier ladder instead. Only a missing or non-finite value is a fallback.
    // The vouch path is unaffected: vouchJitter's own range floor is 500, so it can never be 0.
    const s = (typeof spacingMs === "number" && isFinite(spacingMs) && spacingMs >= 0) ? spacingMs : 1000;
    const tier = tierOf(rank);
    if (tier === 0) {
      const off = (typeof ownerOffsetMs === "number" && isFinite(ownerOffsetMs) && ownerOffsetMs >= 0)
        ? Math.min(ownerOffsetMs, s) : 0;
      return Math.round(off);
    }
    const r = (typeof rng === "function") ? rng : Math.random;
    return Math.round(tier * s + Math.floor(r() * (s / 2)));
  }

  return {
    LADDER: LADDER.map((r) => ({ name: r.name, level: r.level })),
    NAMES: NAMES.slice(),
    TIER_COUNT,
    levelOf, nameOf, tierOf, atLeast, staggerMs,
    defaultVouchTable, defaultCheckpointTable,
    GATES: Object.assign(Object.create(null), GATES),
    gateFor, permits,
  };
})();
