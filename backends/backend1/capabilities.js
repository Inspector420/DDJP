// backends/backend1/capabilities.js
// Pure. Answers "may this user do X to this room right now?" for every GATED
// action, using the SAME rules the reducer (statederiver.js) enforces on ingest.
// No side effects, no MatrixBridge/DOM/Store, no mutation of state/ctx, no clock
// (time enters via ctx.now). Deterministic: same inputs -> same output.
//
// This is the FUNDAMENTAL half of the capability system (backend rules only). The
// feature-layer `Actions` adapter composes these with state-availability and UI
// concerns (5s locks, spinners) into the full render descriptor and routes clicks.
// Lives beside the reducer so "the reducer would reject this" and "you may not do
// this" can never drift — check-capabilities.js proves the two agree.
//
//   Capabilities.can(verb, state, ctx) -> { permitted, reason, retryAt? }
//   Capabilities.snapshot(state, ctx)  -> { [verb]: descriptor }   // target-FREE verbs
//   Capabilities.VERBS                 -> the vocabulary (array of verb ids)
//
//   state = StreamManager.getState()   // { nowPlaying, rotation, settings, history, counts }
//   ctx   = { myId, myRank, now, target? }   // target is verb-specific (see table)

const B1Capabilities = (() => {

  // Same ladder as the reducer. The constants are re-stated here (the reducer's are
  // private to its IIFE); check-capabilities.js proves the resulting decisions match
  // the reducer exactly, so a typo in a threshold turns the build red.
  // The ladder is declared ONCE, in Ranks. RANK survives only as the numeric floor
  // for a missing ctx.myRank; every gate below asks Ranks.permits BY NAME, reading the
  // same GATES table the reducer reads — so the two cannot drift by construction, and
  // check-capabilities proves the resulting decisions still match.
  const RANK = { UNCAT: Ranks.levelOf("uncategorized") };

  const OK = { permitted: true, reason: null };
  function no(reason) { return { permitted: false, reason: reason }; }

  // ── THE MIN-DJ-RANK BAR, READ FROM STATE (J07) ───────────────────────────────────────────────
  // The room's own value when it has one; otherwise the reducer's default, asked for rather than
  // restated. A value the reducer would refuse is treated as absent, so this cannot be more
  // permissive than the fold it is predicting — the direction that matters, since the reducer is
  // what actually decides and a rulebook that said yes to a join the fold refuses is the drift
  // check-capabilities exists to catch.
  function _minDjRank(state) {
    const v = state && state.settings && state.settings.minDjRank;
    const legal = (typeof StateDeriver !== "undefined" && StateDeriver.settingKindOf
      && StateDeriver.settingKindOf("minDjRank") === "values")
      ? (StateDeriver.SETTING_RANGES.minDjRank.values || []) : [];
    if (typeof v === "string" && legal.indexOf(v) >= 0) return v;
    try { return StateDeriver.defaultSettings().minDjRank; } catch (e) { return "uncategorized"; }
  }
  // NO LOCAL `_rankLabel`. There was one — a title-caser written for J07 — and it was correct for
  // its single caller (`uncategorized`, `guest`) and WRONG for J36's first new one: it wrote `vip`
  // as "Vip" where the literal it replaced said "VIP". A rank's written form is ladder knowledge,
  // so the sites below ask `Ranks.labelOf` directly. It was briefly kept as a one-line alias, and
  // that is a synonym with no argument of its own — the shape `Floor.boundFor` already was when it
  // was deleted, so it went the same way rather than being kept for symmetry.

  // ── ONE DENIAL SENTENCE, BUILT FROM THE GATE THAT REFUSED (J36) ──────────────────────────────
  // Ten of these messages restated their gate's value as a literal — `no("VIP rank required to
  // skip someone else's song")`, `no("High-Staff rank required")`, `no("Only the owner can ban
  // someone")`. Change a row in `Ranks.GATES` and every one of them lies, and the lie is not
  // log-only: `.reason` travels `Capabilities.can` -> `Actions.describe` -> the button `title` in
  // `ui/interface.js`. One rule in two places, where the second place is what a person reads.
  //
  // THE SHAPE IS J07'S, NOT A NEW ONE. `dj.join` already built its refusal this way — `_rankLabel`
  // exists for it and its comment names these ten as the defect — so this is that sentence with
  // one home rather than a second pattern beside it (P7). Two messages therefore CHANGE WORDING:
  // "Only the owner can change settings" and "Only the owner can ban someone" become
  // "Owner rank required to …". That is the point rather than a side effect — the owner-only
  // phrasing is a second spelling of a gate value, and it is the spelling that cannot survive a
  // gate moving off `owner`.
  //
  // `doing` IS THE ONLY LITERAL LEFT, and it names the ACT rather than the rank — the half no
  // table holds. `Ranks.GATES` maps an act to a rank, not to a verb phrase, so deriving this too
  // would mean putting user-facing copy in the ladder, where `check-boundaries` rule H would then
  // have the reducer's own table carrying display strings.
  //
  // THE VERDICT AND THE NAME COME FROM THE SAME TABLE BY TWO ROUTES, AND THAT IS DELIBERATE.
  // `Ranks.permits` stays the one home for *may I* — it is what the reducer asks, and asking it
  // here is what `check-capabilities` proves equivalent. `Ranks.gateFor` is the one home for
  // *which rank* — the answer `permits` computes internally and throws away. Inlining
  // `atLeast(myRank, bar)` here would make them one lookup and would also be a second spelling of
  // `permits` in the layer whose whole job is not to restate the reducer's rules.
  //
  // A GATE ROW THAT DOES NOT EXIST FAILS CLOSED, matching `Ranks.permits` (unknown act -> denied)
  // and the switch default below. An act misspelled at this call site is refused rather than
  // silently permitted with an undefined rank in the sentence.
  function _gate(act, myRank, doing) {
    const bar = Ranks.gateFor(act);
    if (bar === null) return no("Unknown action");
    if (Ranks.permits(myRank, act)) return OK;
    return no(Ranks.labelOf(bar) + " rank required to " + doing);
  }

  // Is `userId` currently in the rotation (a member with a buffer)?
  function inRotation(state, userId) {
    const rot = (state && state.rotation) || [];
    for (const r of rot) if (r.user === userId) return true;
    return false;
  }
  function rotationEntry(state, userId) {
    const rot = (state && state.rotation) || [];
    for (const r of rot) if (r.user === userId) return r;
    return null;
  }

  // ---- Reducer verbs (each mirrors a ddjp.* gate in statederiver.js) ----

  function can(verb, state, ctx) {
    state = state || {};
    ctx = ctx || {};
    const myId = ctx.myId;
    const myRank = typeof ctx.myRank === "number" ? ctx.myRank : RANK.UNCAT;
    const t = ctx.target || {};
    const np = state.nowPlaying || null;

    switch (verb) {

      // ddjp.dj.join — the reducer admits a join iff `Ranks.atLeast(rank, settings.minDjRank)`
      // (J07). This used to be an unconditional `return OK`, because the bar was a hardcoded
      // constant equal to the weakest rung; it is a room SETTING now, so the answer depends on
      // state and the button must be able to say no.
      //
      // READ FROM `state.settings`, WHICH IS THE SAME BLOB THE REDUCER FOLDED, so the two cannot
      // disagree about the bar — and asked BY NAME through `Ranks.atLeast`, so no level literal
      // appears here either. `check-capabilities` drives the equivalence across the whole ladder:
      // `can().permitted` must equal whether the reducer actually acted.
      //
      // A MISSING BAR FALLS BACK TO THE REDUCER'S OWN DEFAULT rather than to a literal here, for
      // the reason dials.js exists: two copies of a default is invisible drift. A state object with
      // no settings at all (an empty `{}`, which several callers pass) therefore answers the same
      // way the reducer would on a room still on defaults — permitted.
      case "dj.join": {
        const bar = _minDjRank(state);
        return Ranks.atLeast(myRank, bar) ? OK
          : no(Ranks.labelOf(bar) + " rank required to join the DJ queue");
      }

      // ddjp.dj.leave — deletes members[me]; only meaningful if I'm in the rotation.
      case "dj.leave":
        return inRotation(state, myId) ? OK : no("You're not in the rotation");

      // ddjp.dj.declare — sender must be in the rotation (reducer: !members[user] -> skip).
      case "dj.declare":
        return inRotation(state, myId) ? OK : no("Join the rotation first");

      // ddjp.dj.order — sender-only reorder; must be in the rotation.
      case "dj.order":
        return inRotation(state, myId) ? OK : no("Join the rotation first");

      // ddjp.dj.undeclare — in the rotation AND the videoId is in my buffer.
      case "dj.undeclare": {
        const me = rotationEntry(state, myId);
        if (!me) return no("You're not in the rotation");
        const vid = t.videoId;
        const has = !!(me.pending || []).find(s => s.videoId === vid);
        return has ? OK : no("Not in your queue");
      }

      // ddjp.dj.skip — something playing AND (I'm the current DJ OR VIP+). The
      // advance-lock (canAdvance) is a race-resolution at ingest, not a user
      // permission — the initiating client always claims the current head — so it
      // is not a gate here.
      case "dj.skip":
        if (!np) return no("Nothing is playing");
        if (np.dj === myId) return OK;
        return _gate("dj.skip.others", myRank, "skip someone else's song");

      // NOTE: ddjp.media.skip (the availability escape) has NO capability verb, on purpose. It is
      // not an authority act -- no rank authorises it. The ROOM derives it from the blocked-skip
      // road tally (see statederiver's declaration pass), and the reducer re-validates that tally
      // on the resulting skip. Any rank may author it once a road is met, so there is nothing for
      // a rank capability to gate; gating it by rank would break the "a room with no VIPs still
      // escapes a dead song" guarantee.

      // ddjp.dj.move — Staff+, and the target is a member with pending songs.
      case "dj.move": {
        const g = _gate("dj.move", myRank, "move a DJ");
        if (!g.permitted) return g;
        const target = rotationEntry(state, t.userId);
        if (!target || (target.pending || []).length === 0) return no("Not a movable DJ");
        return OK;
      }

      // ddjp.dj.remove — Staff+ may remove ANYONE in the rotation (rank-blind, like the
      // VIP+ skip-others rule). Mirrors the reducer exactly (no target-rank comparison).
      case "dj.remove": {
        const g = _gate("dj.remove", myRank, "remove a DJ from the rotation");
        if (!g.permitted) return g;
        if (!inRotation(state, t.userId)) return no("Not in the rotation");
        return OK;
      }

      // ddjp.dj.strike — Staff+ may remove ONE named song from ANY DJ's buffer (rank-blind).
      // Mirrors the reducer: permitted iff Staff+ AND the target is in the rotation AND the
      // videoId is actually one of their declared songs (else the reducer would no-op).
      case "dj.strike": {
        const g = _gate("dj.strike", myRank, "remove someone else's song");
        if (!g.permitted) return g;
        const st = rotationEntry(state, t.userId);
        if (!st) return no("Not in the rotation");
        const has = !!(st.pending || []).find(s => s.videoId === t.videoId);
        return has ? OK : no("Not one of their songs");
      }

      // ddjp.dj.reset — High-Staff+.
      case "dj.reset":
        return _gate("dj.reset", myRank, "reset the rotation");

      // ddjp.room.settings — Owner only (content validity is an Actions concern).
      case "room.settings":
        return _gate("room.settings", myRank, "change room settings");

      // ddjp.dj.vote — delegates to the reducer's voteEligible seam (pass-through
      // today). djOfSong comes from the caller (Actions reads it from state).
      case "react.vote": {
        const ok = (typeof StateDeriver !== "undefined" && StateDeriver.voteEligible)
          ? StateDeriver.voteEligible(myId, t.djOfSong || null, myRank)
          : true;
        return ok ? OK : no("You can't vote on this");
      }

      // ---- Feature/transport verbs (NOT reducer events; rules live in room.js /
      // RoomUpgrade). Computed here so the backend owns them uniformly. ----

      // Room.assignRank / canAssignRank — Staff+, and both the new level AND the
      // target's current rank strictly below mine.
      case "rank.assign": {
        const g = _gate("rank.assign", myRank, "assign ranks");
        if (!g.permitted) return g;
        const newLevel = t.newLevel;
        const targetRank = t.targetRank;
        if (typeof newLevel === "number" && !(newLevel < myRank)) return no("Only ranks below your own");
        if (typeof targetRank === "number" && !(targetRank < myRank)) return no("Only ranks below your own");
        return OK;
      }

      // ── THE TWO MEMBERSHIP ACTS (J14) ──────────────────────────────────────────────────────
      // Room.kick / Room.ban. SHAPED AFTER `rank.assign` DELIBERATELY, clause for clause: the
      // gate, then the target strictly below me. It is the only moderation rule this tree had,
      // and J14's entry says in as many words not to invent a second pattern for the others (P7).
      //
      // What is NOT here, because `rank.assign` has it and these do not: a `newLevel` test. A
      // kick and a ban grant nothing, so there is no level to compare — the "strictly below"
      // rule applies to the TARGET only, and that single comparison is also what refuses acting
      // on YOURSELF, since nobody is strictly below themselves. That is the same reason
      // `rank.assign` needs no self clause of its own, and it is written down here because a
      // reader looking for an explicit self-check and not finding one has twice concluded there
      // is a hole. `check-user-card` PART B drives every (actor x target) pair on the ladder and
      // asserts the diagonal is refused, so the absence is measured rather than argued.
      //
      // AN ABSENT `targetRank` ANSWERS PERMITTED, exactly as it does in `rank.assign` above.
      // That is not a hole either, and it is not a decision made here: a descriptor is a
      // rendering answer, and the callers that render one always hold the target's level (the
      // roster row and the user card both do). The close is at the feature layer, where
      // `Room.kick`/`Room.ban` re-read BOTH ranks live from Matrix and refuse — the
      // "even if the button were somehow pressed" half of J14's Done-when, which for a
      // membership act cannot be the reducer because no reducer ever sees one.
      case "member.kick": {
        const g = _gate("member.kick", myRank, "remove someone from the room");
        if (!g.permitted) return g;
        const tk = t.targetRank;
        if (typeof tk === "number" && !(tk < myRank)) return no("Only people ranked below you");
        return OK;
      }
      case "member.ban": {
        const g = _gate("member.ban", myRank, "ban someone");
        if (!g.permitted) return g;
        const tb = t.targetRank;
        if (typeof tb === "number" && !(tb < myRank)) return no("Only people ranked below you");
        return OK;
      }

      // Room.invite — no DDJP rank rule today (Matrix power levels govern the actual
      // invite). Permitted for anyone in the room.
      case "room.invite":
        return OK;

      // RoomUpgrade — Owner only, plus the batch cooldown. ctx.target.retryAt (ms
      // epoch, supplied by the feature from the last batch time) gates the cooldown;
      // ctx.now is compared against it. Rank first, then cooldown.
      case "room.upgrade": {
        const g = _gate("room.upgrade", myRank, "upgrade the room");
        if (!g.permitted) return g;
        const retryAt = t.retryAt;
        const now = typeof ctx.now === "number" ? ctx.now : 0;
        if (typeof retryAt === "number" && retryAt > now) {
          return { permitted: false, reason: "Upgrade available soon", retryAt: retryAt };
        }
        return OK;
      }

    // `count.set` IS IN `GATES` AND HAS NO VERB HERE, DELIBERATELY. There is no UI control for it
    // yet, so there is nothing to answer permission for — and both places that matter already
    // refuse: this default returns `no("Unknown action")`, so an act with no verb fails closed, and
    // the reducer enforces owner-only from CHANNEL ORIGIN regardless of what any UI believes. It is
    // also absent from `VERBS`, so the vocabulary is internally consistent — it is not a verb the UI
    // can name. Written down because it has been re-investigated three times as a suspected gap.
    default:
        return no("Unknown action");
    }
  }

  // Every verb that needs no ctx.target (so the UI can refresh them in one call).
  const TARGET_FREE = ["dj.join", "dj.leave", "dj.declare", "dj.order", "dj.skip", "dj.reset", "room.settings", "room.invite"];
  // The whole vocabulary.
  // `member.kick` / `member.ban` are TARGET-BEARING (they need the target's rank), so they join
  // VERBS and stay out of TARGET_FREE — a snapshot() answer for them would be an answer about
  // nobody, which is precisely the shape that reads as permission.
  const VERBS = TARGET_FREE.concat(["dj.undeclare", "dj.move", "dj.remove", "dj.strike", "react.vote", "rank.assign", "room.upgrade", "member.kick", "member.ban"]);

  function snapshot(state, ctx) {
    const out = {};
    for (const v of TARGET_FREE) out[v] = can(v, state, ctx);
    return out;
  }
  // ── THE SETTINGS TABLES' ROW SET ─────────────────────────────────────────────────────────────
  // ONE ROW PER LADDER RUNG, derived rather than written down. The panel used to hold six
  // hand-written labels against a seven-rung ladder: guest was invisible, and because an edit posts
  // the WHOLE table, six values went into seven slots and the last one landed on uncategorized. An
  // owner changing the VIP number flipped uncategorized from "never" to a countable six — the one
  // anti-sybil guarantee that did not depend on counting, turned into one that does, by a click
  // about something else.
  //
  // Lives here rather than in the renderer for two reasons: it is policy, not painting, and a
  // renderer can only be READ by a guard while this can be RUN by one.
  //
  // UNCATEGORIZED IS NOT A DIAL. It is the bottom of the ladder — brand-new and unplaced accounts —
  // and "no number of them is ever enough" is a structural rule, not a preference. It is shown so
  // the rule is visible, and locked so it cannot be edited into a number.
  const _TABLE_ROWS = Ranks.LADDER.map((r) => ({
    name: r.name, level: r.level, editable: r.name !== "uncategorized",
  }));
  function settingsRows() {
    return _TABLE_ROWS.map((r) => ({ name: r.name, level: r.level, editable: r.editable }));
  }
  // Apply one cell edit and return the COMPLETE table to post, or null if the edit is not allowed.
  // Built to the ladder's length from scratch every time, so a caller holding a stale or short table
  // cannot produce a short post — the shape is decided here, not by whatever was passed in.
  function applyTableEdit(table, index, enough, withAlways, always) {
    if (typeof index !== "number" || index !== Math.floor(index)) return null;
    if (index < 0 || index >= _TABLE_ROWS.length) return null;
    if (!_TABLE_ROWS[index].editable) return null;
    const src = Array.isArray(table) ? table : [];
    const next = [];
    for (let k = 0; k < _TABLE_ROWS.length; k++) {
      const cur = src[k] || {};
      const row = { enough: (typeof cur.enough === "number" && isFinite(cur.enough)) ? cur.enough : null };
      if (withAlways) row.always = (cur.always === true);
      next.push(row);
    }
    next[index].enough = (typeof enough === "number" && isFinite(enough)) ? enough : null;
    if (withAlways) next[index].always = (always === true);
    return next;
  }

  return {
    can, snapshot, VERBS: VERBS.slice(), TARGET_FREE: TARGET_FREE.slice(), RANK,
    // ---- The rank vocabulary, re-exported for the app ----------------------------
    // features/ and ui/ may NOT reach Ranks directly (check-boundaries rule F), and
    // must never hold a numeric threshold of their own. These are the only legal way
    // to ask a rank question outside the backend, and they are BY NAME on purpose —
    // the number is a Matrix power level, an implementation detail of the transport.
    atLeast: Ranks.atLeast,
    staggerMs: Ranks.staggerMs,
    // THE GATE LOOKUP, passed through for the same reason and under the same rule. `features/` may
    // not name `Ranks` (check-boundaries rule F), and the display needs to ask which rank an act
    // requires — `BotRuntime.mayOffer` refuses the bot every act gated at `owner`, and it has to
    // DERIVE that set rather than restate it, or a row added to `GATES` tomorrow appears on the
    // bot's screen with nothing to notice.
    //
    // WRAPPED, NOT ALIASED, for the reason the note below gives about `activityGroupOf`: written
    // bare, `Ranks.gateFor` is resolved when this object is BUILT, so a guard loading capabilities
    // without ranks gets a TypeError at construction instead of a clean answer at call time.
    gateFor: (act) => Ranks.gateFor(act),
    // THE ACTIVITY CLASSIFICATION, passed through rather than reimplemented. `features/` may not
    // name `StateDeriver` (check-boundaries rule D), and the fold in `room.js` needs to know which
    // types a PERSON caused. Re-exported here so that stays one table in the reducer with a second
    // CALLER, never a second copy — a copy would be free to classify `ddjp.dj.play` as active,
    // which is the one row the whole distinction rests on.
    //
    // WRAPPED, NOT ALIASED, AND THAT IS NOT STYLE. `StateDeriver.activityGroupOf` written bare
    // here is read when this object is BUILT — at module construction — so every guard that loads
    // capabilities.js without the reducer beside it crashed on a ReferenceError before running a
    // single assertion. Twelve did. The lookup has to happen when the function is CALLED, by which
    // time the real app has loaded everything. Same reason `SETTING_RANGES.botDelegation.keys` is
    // a function rather than an array, one file over.
    activityGroupOf: (type, body) =>
      (typeof StateDeriver !== "undefined" && StateDeriver.activityGroupOf)
        ? StateDeriver.activityGroupOf(type, body) : null,
    // NO `activityGroups()` PASS-THROUGH. One was written and removed in the same package: the
    // panel reads the domain from `Room.getSettingRanges()[key].keys`, which is the seam it
    // already uses for every other bound, so nothing called it. A predicate with no call site is
    // indistinguishable from a missing feature and passes every guard — the shape `check-wiring`
    // exists for. Added back only with a caller.
    rankNameOf: Ranks.nameOf,
    // `label` RIDES ALONG (J36), and leaving it off is the defect this line was found with.
    // `ui/` may not reach `Ranks`, so this export and `Room.rankLadder()` are the ONLY route by
    // which a rank's written form gets to the screen. Dropping it here did not throw and did not
    // fail a guard: the UI reads `r.label || r.name`, so every rank quietly rendered as its raw
    // ladder token — `high-staff`, `vip`, `uncategorized` — on the roster and the rank picker.
    LADDER: Ranks.LADDER.map((r) => ({ name: r.name, level: r.level, label: r.label })),
    settingsRows, applyTableEdit,
  };
})();

// ── REGISTER THIS SLOT WITH THE SEAM (J23) ─────────────────────────────────────────────────
// The capability layer is what makes per-room backends invisible to ui/ (§3): the UI never names
// an engine, it reads descriptors and calls `perform(action)`. Swapping this slot is what makes
// the same buttons obey a different room's rules.
Backends.register("backend1", { Capabilities: B1Capabilities });
