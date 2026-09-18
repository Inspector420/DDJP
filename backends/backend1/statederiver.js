// backends/backend1/statederiver.js
// Pure function. Takes ordered events, returns derived state.
// No side effects. No dependencies. Same input always gives same output.
//
// State shape: { nowPlaying, rotation, settings }
//   nowPlaying : { dj, song, pi, startedAt, skipped } | null
//   rotation   : [ { user, pending: [ {videoId, videoUrl}, ... ] }, ... ]  (head first)
//   settings   : owner-set, last-write-wins. The shape and the defaults are defaultSettings()
//                below — deliberately NOT restated here, because a comment listing three of
//                eighteen keys is how a reader learns a wrong shape confidently.
//
// The queue is a rotation of PEOPLE, each carrying a small buffer of declared
// songs. Head plays, rotates to the back, stays only while the buffer holds a
// song. See docs/main/04-features.md for the full design.
//
// Rank rides on ev.senderRank, stamped by transport from the CHANNEL an event
// arrived on (channel origin = rank proof). Room settings (chat tier, visibility)
// ARE derived here as ddjp.room.settings (owner-only, last-write-wins) — including
// `minDjRank`, the lowest rank allowed to JOIN the rotation (J07). It is read at LOG
// POSITION like every setting, so it governs later joins and never re-judges earlier
// ones; the default is "uncategorized", which is the behaviour this reducer had when
// the bar was a hardcoded constant.

const StateDeriver = (() => {

  // Power levels, derived from the one ladder (Ranks). Used ONLY where a numeric
  // level is genuinely needed — the default rank and the DJ floor. Every GATE below
  // asks Ranks.permits by name instead of comparing numbers.
  const RANK = { OWNER: Ranks.levelOf("owner"), HIGH_STAFF: Ranks.levelOf("high-staff"), STAFF: Ranks.levelOf("staff"), VIP: Ranks.levelOf("vip"), PLAYER: Ranks.levelOf("player"), GUEST: Ranks.levelOf("guest"), UNCAT: Ranks.levelOf("uncategorized") };

  // Default applies only to events that arrive without a stamped rank (tests).
  // Every event type this reducer actually folds. An event is LEGAL only if its type
  // is in here AND the fold did not reject it (see `accepted` below). The list is
  // explicit rather than inferred so an unknown type — `ddjp.anything` written into
  // the open channel by anyone — is illegal by default and can never become work for
  // the room. check-legality proves this list matches the types the reducer branches
  // on, so adding a branch without adding its type turns the build red.
  const HANDLED_TYPES = [
    "ddjp.dj.join", "ddjp.dj.leave", "ddjp.dj.declare", "ddjp.dj.undeclare", "ddjp.dj.order",
    "ddjp.dj.move", "ddjp.dj.remove", "ddjp.dj.strike", "ddjp.dj.reset",
    "ddjp.dj.play", "ddjp.dj.skip", "ddjp.media.skip",
    "ddjp.room.settings", "ddjp.dj.vote", "ddjp.dj.save", "ddjp.count.set",
    // Per-play-instance DECLARATIONS (Steps 7–9). Folded into consensus, so CRITICAL: they
    // gate advances and drive the availability skip, so a wrong one is a divergence not a
    // cosmetic glitch. `len` = "my measured length for THIS playing"; `avail` = "I am blocked
    // on THIS playing". Both are scoped to the play instance (pi), never the video, so a
    // declaration can never be stale from a previous song.
    "ddjp.play.len", "ddjp.play.blocked",
  ];

  // ── WHO CAUSED IT: A PERSON, OR THEIR CLIENT? (v322) ──────────────────────────────────────
  // Every type above is in the log. Only some of them mean somebody was THERE.
  //
  // **THIS DISTINCTION IS REQUIRED, NOT A PREFERENCE, AND THE REASON IS ONE ROW.** When a song
  // ends, the DJ's client authors the next `ddjp.dj.play` on its own. A person who queued five
  // songs and walked away keeps emitting events for as long as their buffer lasts. Count those as
  // activity and the AFK rule can never fire for exactly the person it exists for — the room would
  // hold a deck open for an empty chair and report the chair as occupied.
  //
  // So the table is ACTIVE ONLY. Passive types are not listed, which means they are not in the
  // settings domain either, which means **no room can configure them to count**. Structural, not a
  // check — the same shape that keeps `botDelegation` out of its own domain.
  //
  // NOT IN HERE, deliberately, with the reason each time:
  //   · `ddjp.dj.play`      — the client advancing to the next song. THE one that matters.
  //   · `ddjp.play.len`     — a measurement, and only sent when this client DISAGREES.
  //   · `ddjp.play.blocked` — the embed failed. The player acted, not the person.
  //   · `ddjp.media.skip`   — authored when a road is met, by whoever is fastest. Not a decision.
  //    `ddjp.dj.undeclare`  the buffer reconcile shedding a surplus.
  //    `ddjp.dj.order`      the SAME reconcile loop, pinning the buffer order. MEASURED: the only
  //                         sender is `userqueue.js`'s reconcile pass. The UI's move buttons edit
  //                         a LOCAL list and kick the loop, exactly as adding a song does, so no
  //                         click reaches the wire. It fired as songs cycled, which made an idle
  //                         person read as active — the same false positive the `declare`
  //                         exclusion was added to remove, alive through a different type.
  //
  // `ddjp.dj.declare` WAS EXCLUDED HERE AND IS BACK, because the reason given for removing it was
  // WRONG. It was called "a type nothing emits" — but the reducer HANDLES it and it is in
  // `HANDLED_TYPES`, so it is protocol; what is true is only that THIS client does not send it.
  // Excluding a protocol type on the strength of one client's habits is a different decision from
  // excluding an automatic act, and it silently changed what thirty fixtures mean by "an act".
  //
  // THE ACT THAT ACTUALLY NEEDED EXCLUDING IS `ddjp.dj.join` CARRYING A VIDEO — see
  // `activityGroupOf` below. That is what `Queue.submitSong` sends and what `userqueue.js` fires
  // on its own, and it is handled where the body can be read rather than by removing a type.
  //
  // THE LAST TWO WERE COUNTED AS `rotation` UNTIL THE OWNER ASKED. The exclusions above were
  // reasoned per TYPE, and `declare` is a type with TWO AUTHORS: a person adding a song, and
  // `userqueue.js` reconciling the buffer against their playlist as songs cycle. That loop
  // computes a surplus and a deficit and fires `undeclare`/`submitSong` on its own, with no
  // click — so anyone with a playlist loaded produced a steady trickle of "deliberate" rotation
  // activity while touching nothing, in BOTH timers, because `rotation` is on for both by
  // default.
  //
  // BOTH ARE DROPPED RATHER THAN SPLIT. `undeclare` does have a genuine manual path — removing a
  // song — so a finer rule could keep it. But both arrive from the same reconcile loop, and
  // telling them apart needs the AUTHOR'S INTENT, which the log does not record. A type is the
  // only thing a fold over the log can see, so the honest cut is by type. `join`, `leave` and
  // `order` remain: each has exactly one author, a person pressing something.
  //
  // CHECKED, NOT ASSUMED: `leaveRoomQueue` is a button, and a DJ whose buffer empties is dropped
  // by the reducer itself (`pending.length === 0` -> hard fall-out) without authoring any event,
  // so running out of songs was never counted as activity in the first place.
  //
  // GROUPS, NOT TYPES, because a room configuring eleven switches configures none of them. The
  // groups are the ones a person would name: joining or leaving the queue, moderating, skipping,
  // upvoting, saving, changing the room. `vote` and `save` are SEPARATE despite feeling like one
  // thing — a room may reasonably count a save (deliberate, rare) and not an upvote (a reflex).
  const ACTIVITY_GROUPS = ["rotation", "moderation", "skip", "vote", "save", "settings"];
  const ACTIVE_TYPES = {
    "ddjp.dj.join":       "rotation",
    "ddjp.dj.declare":    "rotation",
    "ddjp.dj.leave":      "rotation",
    "ddjp.dj.move":       "moderation",
    "ddjp.dj.remove":     "moderation",
    "ddjp.dj.strike":     "moderation",
    "ddjp.dj.reset":      "moderation",
    "ddjp.dj.skip":       "skip",
    "ddjp.dj.vote":       "vote",
    "ddjp.dj.save":       "save",
    "ddjp.room.settings": "settings",
    "ddjp.count.set":     "settings",
  };
  // The group an event's type belongs to, or null if a client caused it. TOTAL: an unknown type
  // answers null rather than throwing, because this is reached from a fold over a log that may
  // hold types from a newer build.
  // Build a flag map with `on` set true, in SORTED key order — the order the validator produces,
  // so a default and a validated copy of that same default are byte-identical. Groups outside
  // `on` are omitted rather than written false: absent means false, and omitting them is what
  // lets a group be ADDED later without invalidating every stored map in every room.
  function _flagsOn(on) {
    const out = {};
    for (const g of ACTIVITY_GROUPS.slice().sort()) { if (on.indexOf(g) >= 0) out[g] = true; }
    return out;
  }
  // `body` IS OPTIONAL AND ONE TYPE NEEDS IT. `ddjp.dj.join` carries TWO meanings on the wire:
  // with no video it is a person joining the rotation, and with `v` it is `Queue.submitSong` —
  // which `userqueue.js` calls ON ITS OWN to top the buffer up from a playlist as songs cycle.
  //
  // THE EXCLUSION LIST ABOVE NAMED `ddjp.dj.declare` FOR THIS, AND THAT TYPE IS NEVER EMITTED.
  // Nothing in the tree sends it; the audit that added it read the reducer's vocabulary instead of
  // the wire, removed a type that does not fire, and left the one that does. Reported from a live
  // room: an owner sitting still with a playlist loaded kept producing joins and never went idle,
  // so the AFK sweep could not fire for the person it exists for.
  //
  // A BARE JOIN STILL COUNTS. It has one author — somebody pressing join.
  function activityGroupOf(type, body) {
    const g = ACTIVE_TYPES[type];
    if (typeof g !== "string") return null;
    if (type === "ddjp.dj.join" && body && typeof body === "object"
        && typeof body.v === "string" && body.v) return null;
    return g;
  }

  const DEFAULT_RANK = RANK.PLAYER;



  // ── `MIN_DJ_RANK` IS GONE — IT IS `settings.minDjRank` NOW (J07) ─────────────────────────────
  // It was `const MIN_DJ_RANK = RANK.UNCAT` with a "settings deferred" comment, read by one
  // comparison in the join branch: `rank < MIN_DJ_RANK`. MEASURED before replacing it
  // (tools/probes/probe-min-dj-rank.js Q1): the weakest rung on the ladder is level 0 and
  // `levelOf("uncategorized")` is also 0, so that comparison could never be true for any rank the
  // transport can stamp. There was no bar set loose — there was NO BAR, and a dead comparison
  // standing where one would go. Worth stating precisely, because "hardcoded to the weakest rank"
  // and "unreachable" invite different follow-on work: the first suggests raising a constant, the
  // second says the mechanism has to be built.
  //
  // The bar is now a per-room setting, judged at LOG POSITION like every other. It is NOT in
  // `Ranks.GATES`: that table is protocol ("a room that could lower its own skip gate would derive
  // differently from one that didn't") and names join deliberately-absent, gated by membership. A
  // value carried in the log cannot cause that divergence — every client folds the same events and
  // derives the same bar — which is exactly how `skipRoads` already tunes what the reducer accepts
  // without a gate row. The comparison is `Ranks.atLeast(rank, settings.minDjRank)`, by NAME, so no
  // numeric threshold appears at the site.

  const BUFFER_MAX = 2;

  // Retained play-history window (14: Room History). Derived, recomputed each
  // ingest; capped so a long replayed log doesn't grow the array without bound.
  const HISTORY_MAX = 5000;

  // The single source of truth for the "blank" room settings — the values that
  // apply until the owner posts a ddjp.room.settings event. Returns a FRESH
  // object each call (derive mutates its copy in place, and StreamManager holds
  // its own copy), so callers never share one mutable default. StreamManager
  // borrows this (it depends on StateDeriver) instead of repeating the literal,
  // so a default only ever lives in one place. Pure — safe under the purity + layer guards (check-statederiver-purity, check-boundaries).
  // SEAM (consensus-integrity extensibility, docs/consensus/consensus-models.md §2). The
  // advance-lock decision, isolated to ONE predicate so the rule lives in a single place.
  // Today it is purely the chain check: a play/skip may advance iff it correctly follows
  // the current head (currentHead/claimedPrev are play-instance event ids, or null at
  // genesis). A FUTURE time-gate ("cannot advance faster than the current song could
  // really play") and the queue re-anchor rule plug in HERE — this signature is where the
  // play event / committed duration / clock would be threaded, changing one function
  // rather than the derive loop. Pure; behavior today is identical to the old inline test.
  function canAdvance(currentHead, claimedPrev) {
    return currentHead === claimedPrev;
  }

  // THE GATE LENGTH — the single source of truth for "how long must this song run before an
  // automatic advance is legal", used identically by the reducer's advance gate and by the
  // derived `advance.earliestAt` the transport reads, so the enforced verdict and the client
  // estimate can never disagree.
  //
  // We read the MOST TRUSTWORTHY value, not the longest. Reading the longest defends only against
  // lying SHORT (to advance early); it is defenceless against lying LONG — two accomplices, or one
  // VIP sock-puppet, claiming a huge length would grief every song to the maxLen ceiling, and an
  // honest higher-rank measurement could not pull it back down. The trustworthy reading defends
  // BOTH directions: it takes the strongest tier that spoke and the majority within it, so
  //   • a low-rank SHORT liar loses to any higher rank, or to the majority at its own tier, and
  //   • a low-rank LONG liar loses the same way; a higher-rank honest value overrides it.
  // This is the SAME cascade the display uses, so the gate and the progress bar finally agree.
  //
  // Still maxLen-CAPPED: the gate never demands waiting longer than the room's own ceiling (past
  // maxLen the ceiling advances the song regardless, so a longer gate is meaningless).
  //
  // THE AGREED LENGTH — one rule, used for both the advance gate and the display, so they can
  // never disagree:
  //   1. HIGHEST RANK WINS. Take the strongest tier that spoke.
  //   2. MAJORITY WITHIN THAT RANK. If several at that tier spoke, the most-claimed value wins.
  //   3. STALEMATE CASCADES DOWN. If that tier has no single winner (a tie for most-claimed),
  //      it is unresolved — fall to the next tier down and try again.
  //   4. min AND max ALWAYS APPLY. The result is clamped to [minLen, maxLen] whatever anyone
  //      claimed. This is what makes a liar harmless in both directions: claiming a huge length
  //      cannot push past the room's ceiling, and claiming a tiny one cannot go below its floor.
  // Nothing resolves at any tier -> null, and only minGate floors the advance.
  //
  // `entries` = [{ sec, tier }] for the current playing, one per sender (caller dedupes).
  function gateLengthSec(entries, minLenSec, maxLenSec) {
    if (!Array.isArray(entries) || !entries.length) return null;
    const valid = entries.filter((e) => e && typeof e.sec === "number" && isFinite(e.sec) && e.sec > 0);
    if (!valid.length) return null;
    // tiers present, strongest (lowest number) first
    const tiers = Array.from(new Set(valid.map((e) => e.tier))).sort((a, b) => a - b);
    for (const t of tiers) {
      const at = valid.filter((e) => e.tier === t).map((e) => e.sec);
      const tally = Object.create(null);
      for (const s of at) tally[s] = (tally[s] || 0) + 1;
      let top = null, topN = 0, tied = false;
      // iterate values in numeric order so the scan itself is order-independent
      for (const k of Object.keys(tally).map(Number).sort((a, b) => a - b)) {
        const n = tally[k];
        if (n > topN) { top = k; topN = n; tied = false; }
        else if (n === topN) { tied = true; }
      }
      if (top === null || tied) continue;         // stalemate at this tier -> cascade down
      let out = top;
      if (typeof minLenSec === "number" && minLenSec > 0 && out < minLenSec) out = minLenSec;
      if (typeof maxLenSec === "number" && maxLenSec > 0 && out > maxLenSec) out = maxLenSec;
      return out;
    }
    return null;                                   // nothing resolved at any tier
  }

  // SEAM (consensus-integrity extensibility, docs/consensus/consensus-models.md §2 /
  // docs/consensus/consensus-models.md §15). Vote/save eligibility, isolated to ONE predicate so the
  // rule lives in a single place. Today it is a PASS-THROUGH: every vote/save with a sender
  // and a resolved song counts, and the per-user Set (the counts pass, below) is the only
  // dedup. A FUTURE rank-gate ("only rank R may vote") and/or a self-vote rule ("a DJ can't
  // vote/save their own now-playing song") plug in HERE — reading the voter, the DJ who
  // played the song (djOfSong), and the voter's channel-origin rank — changing this one
  // function rather than the counts loop. Pure; behavior today is identical to the old inline
  // test (returns true, so counts are unchanged and check-counts stays green).
  function voteEligible(voter, djOfSong, rank) {
    return true;
  }

  function defaultSettings() {
    // chat/vis/bg: existing owner settings. maxLen = hard ceiling seconds (10min, ON by
    // default → the anti-freeze applies to every room out of the box). minLen = grace-floor
    // seconds. The availability skip is decided by the skipRoads (absolute per-rank-band counts),
    // never a percentage of an unknowable "present" denominator. All are judged AT LOG POSITION
    // (a song is governed by the settings in force when it started — see the snapshot on
    // nowPlaying).
    return {
      chat: "uncategorized", vis: "private", bg: null,
      // THE LOWEST RANK ALLOWED TO JOIN THE ROTATION (J07). A rank NAME, never a level — the
      // number is a Matrix power level and belongs at the transport boundary (ranks.js header).
      //
      // Default "uncategorized" = everyone, which is exactly what the room did when this was a
      // hardcoded constant, so a room that never touches the dial is unchanged.
      //
      // FAILING OPEN IS THE DELIBERATE DIRECTION HERE, and it is the opposite of the two per-rank
      // tables, which fall back STRICTER when a room loses its settings. The strict end of this
      // dial is "owner only may DJ", so failing closed would silently leave a room nobody but its
      // owner can play in — a worse failure than falling back to the behaviour the room already
      // had. A malformed value keeps the current one, like every setting here.
      minDjRank: "uncategorized",
      maxLen: 600, minLen: 10,
      // ── ADVANCE-GATE dials (Steps 7–10) ──────────────────────────────────────────────────
      // All judged AT LOG POSITION and snapshotted onto the song when it starts, like maxLen —
      // a mid-song change governs the NEXT song, never the running one.
      //
      // minGate: the absolute floor before ANY automatic advance is legal. A song shorter than
      // this still waits it out, so the rank cascade always has time to act in ORDER — otherwise
      // a 3-second song's honest advance and a grief advance are indistinguishable. A PLAIN NUMBER
      // the owner sets, deliberately: no client re-evaluates a formula, so two clients can never
      // disagree about the floor. It should comfortably exceed the full stagger ladder
      // (TIER_COUNT * vouchJitter + half a step) so the cascade has time to act IN ORDER — at the
      // 1000ms default that is ~7s, hence 8000. Nothing derives it; if you change vouchJitter or
      // add a rung, raise this by hand.
      minGate: 8000,
      // graceMs: margin subtracted from the agreed length in the advance gate. Absorbs honest
      // length DISAGREEMENT (not delivery lag — a stamp subtraction is unaffected by lag), so small.
      graceMs: 1000,
      // presendMs: the tiny dead air before a client authors its OWN advance, so it notices if the
      // room already moved. Well under one stagger step, so the send lands before the next slot opens.
      presendMs: 300,
      // THE SKIP ROADS — availability skip fires when ANY road's every requirement is met. Counts are
      // DISTINCT blocked users at rank-or-above (guest+ includes VIP+; a VIP blocked call counts on
      // both). Uncategorized is in NO road, so they can never skip among themselves — by structure.
      // `guestPlus` = guest-or-above; `vipPlus` = VIP-or-above.
      skipRoads: [
        { guestPlus: 5, vipPlus: 0 },   // crowd road
        { guestPlus: 0, vipPlus: 4 },   // authority road
        { guestPlus: 3, vipPlus: 2 },   // combined road
      ],
      // ── VOUCHING / CHECKPOINT / TRUST dials ────────────────────────────────────────────────
      // Owner-set and LOG-ORDERED like every setting: judged AT LOG POSITION, so a change only
      // affects decisions made AFTER it. It can never re-judge past vouching, and it can never
      // un-forget something already dropped under the old value. None of these are read for truth —
      // they only tune WHO vouches, WHEN, and WHO is trusted.

      // THE VOUCH TABLE — one row per rank, highest first (owner, high-staff, staff, vip, player,
      // uncategorized). `enough` = how many DISTINCT people at that rank or above must vouch an
      // event (excluding its sender) for it to count as satisfied; null means that rank can never
      // satisfy on its own. `always` = this rank pitches in whenever nothing above is satisfied.
      // The highest satisfied row ends the question; higher ranks keep working to their own row.
      vouchTable: Ranks.defaultVouchTable(),
      // THE CHECKPOINT TABLE — how many checkpoints from that many DIFFERENT people can stand in
      // for an owner checkpoint while the owner is away. Same row order. null = never.
      checkpointTable: Ranks.defaultCheckpointTable(),
      // ── THE BOT DIALS (J17) — FIVE KEYS, ONE EDIT, AND THE COUNT IS THE POINT ─────────────
      // Adding a settings key moves the canonical seed the checkpoint fingerprint commits, so every
      // existing checkpoint in every room becomes unverifiable and the room holds NO FLOOR and
      // forgets NOTHING until it seals two fresh ones. DRIVEN on this tree
      // (`probe-j17-bot.js` / this session's K1): +1 key moves the fingerprint, +5 keys in ONE
      // edit move it exactly once, and the no-edit control reproduces the baseline bytes. **The
      // damage is BINARY, not proportional** — which is the whole argument for enumerating the
      // schema once rather than adding a key per job and paying that window four times.
      //
      // All five are LIVE in `Dials`, never FROZEN, for `minDjRank`'s reason rather than a new one:
      // FROZEN means *snapshotted onto a song when it starts*, and a bot action is not a song, so
      // there would be no snapshot to read. Reading fresh, plus the reducer judging settings at log
      // position, already gives "whatever the room had set when the bot acted".

      // A map from a `defaultSettings()` KEY to the weakest rank NAME allowed to request that
      // change. Keyed by SETTING rather than by rank, unlike `vouchTable`/`checkpointTable`, which
      // are one row per rung and must resize with the ladder. Keying it this way means its domain
      // is this function's own key set and its vocabulary is `Ranks.NAMES` — both already have one
      // home, so neither can be restated here.
      //
      // `botDelegation` IS EXCLUDED FROM ITS OWN DOMAIN, STRUCTURALLY RATHER THAN BY A CHECK. A
      // rank permitted to edit the delegation table could grant itself every other setting in one
      // write, so the table cannot name itself. Enforced in `_delegationMap` below, where the key
      // is dropped on the way in — a rule that is structural cannot be out-argued, and one that is
      // a threshold can. Same shape as `uncategorized` being shown and locked in the per-rank tables.
      botDelegation: {},
      // TWO BOOLEANS RATHER THAN ONE TOKEN SET, because the bot has exactly two observation
      // channels and they are not alike: Spine events reach the fold, chat reaches the raw
      // listeners and neither `EventCache.store` nor `StreamManager.ingest`. Two plain booleans
      // follow `selfWitnessCheckpoint`'s precedent, need no new validation kind, and get two
      // checkboxes. The trade: a token set would absorb a third source without a new key — but a
      // third source is a new observation capability, which is a code change carrying its own
      // release anyway.
      botPresenceSpine: true,
      // OFF BY DEFAULT, deliberately: counting chat means the bot reads the encrypted Skin for
      // presence, and every other rule here keeps chat out of durable surfaces. Opt-in states that;
      // defaulting on would bury it. Enabling it does NOT put chat in the log — this governs
      // whether the bot COUNTS a message it already receives as a client. Nothing is stored,
      // nothing folded, nothing reaches a seed.
      // ── CHANGED TO `true` AT v283, AND IT WAS A FINGERPRINT-MOVING CHANGE ────────────────
      // The opt-in reasoning above still holds for what this GOVERNS — nothing is stored, folded,
      // or reaches a seed. What changed is the answer to "which way should a new room start", and
      // the owner chose counting chat.
      //
      // **CHANGING A DEFAULT IS NOT A FREE EDIT.** See the block above `botAfkMs` for the cost and
      // the recovery; it was paid deliberately here.
      botPresenceChat: true,
      // How long without a counted event before the bot considers somebody away, and how long it
      // waits after asking before acting. Plain numeric ranges, subject to the integer contract
      // (§4) like every numeric protocol field.
      // ── THE COST OF CHANGING ANY DEFAULT IN THIS BLOCK, MEASURED ─────────────────────────
      // **`seed.settings` is a WHOLE-BLOB copy: EVERY key is materialised whether or not
      // anybody set them.** (The count is deliberately not written here — it was `23` and went
      // stale at v322 when three keys landed, for a property the number was never part of.) So for a room that never authored a value, THE SHIPPED DEFAULT IS THE
      // COMMITTED VALUE — and changing it moves that room's checkpoint fingerprint exactly as
      // adding a new key does. Driven, same log, one default flipped:
      //
      //     BEFORE  botPresenceChat=false  botAfkMs=900000   fp = -5Z6Uhn3pOCZ_7bh
      //     AFTER   botPresenceChat=true   botAfkMs=3600000  fp = hWAEvh6nuDv99BIj
      //
      // **THE RECOVERY IS TWO FRESH SEALS.** A room whose held checkpoints were fingerprinted
      // under the old defaults stops licensing forgetting until it has sealed two checkpoints
      // under the new ones; then it recovers on its own with no intervention.
      //
      // **THAT WAS ACCEPTABLE AT v283 AND WOULD NOT BE IN A LIVE DEPLOYMENT.** The rooms in
      // existence were test rooms and creating new ones was fine. A deployment with real rooms
      // pays a window in which every one of them grows without forgetting — which is what
      // checkpoints exist to prevent. **The rule is not soft; the price was paid on purpose.**
      // `check-setting-endpoints` carries the row that proves the fingerprint moves.
      //
      // These stay PER-ROOM CHANGEABLE. A default governs only rooms created after it ships.
      botAfkMs: 3600000,     // 60 minutes  (was 15 — v283)
      botPingMs: 600000,     // 10 minutes  (was 2 — v283)
      // ── THE ACTIVITY RULES (v322) ────────────────────────────────────────────────────────
      // THREE KEYS, ADDED IN ONE PACKAGE, ON PURPOSE. The block above records what a settings-key
      // addition costs: every checkpoint in every room is re-fingerprinted, and no room holds a
      // floor or forgets anything until it has sealed two fresh ones. That cost is per SHAPE
      // CHANGE, not per key — so three keys landing together pay it once and three keys landing
      // one package apart pay it three times. Anything else this design needs must come now or
      // wait for a reason worth another window.
      //
      // TWO MAPS BECAUSE THERE ARE TWO QUESTIONS, and the room may answer them differently:
      // what keeps your PLACE IN THE QUEUE, and what keeps you in the PRESENCE CHAT. Holding a
      // deck while gone blocks other people; sitting in a chat while gone blocks nobody. A single
      // map would force one answer onto both, and the defaults below already differ.
      //
      // The domain is `ACTIVITY_GROUPS` — derived, never listed here — so a group added above
      // appears in both maps and in the panel without a second edit. Absent key = false, which is
      // why `skip` and `vote` can simply be missing from the queue map rather than written false.
      //
      // DEFAULTS, and the reasoning is the asymmetry above:
      //   · QUEUE keeps only deliberate acts about the rotation itself. A vote is a reflex and a
      //     save is a bookmark; neither says you are still willing to DJ, which is what holding a
      //     deck claims. Skipping does — you were watching the room enough to act on it.
      //   · PRESENCE is generous, because being in a chat costs the room nothing and the failure
      //     mode is throwing out somebody who was there. Everything deliberate counts.
      // BUILT SORTED, THROUGH ONE HELPER, AND THIS IS NOT TIDINESS. The validator sorts a flag
      // map on the way in so two rooms that agree produce byte-identical canonical forms. Written
      // as object literals here, the DEFAULTS were in insertion order while anything through the
      // validator was in sorted order — so a room posting its own defaults back produced a
      // different canonical form from the one it started with, and the settings proof could not
      // match the floor against the event it names. Caught by `check-forget-live` PART A, which
      // is the guard for exactly that comparison. The comment on `_flagMap` predicted this and
      // the literal below it reintroduced it four hundred lines away.
      // ── EVERY GROUP COUNTS BY DEFAULT, FOR BOTH SETS ────────────────────────────────────────
      // The queue set carried three of the six while presence carried all six, so a room that had
      // never touched the panel judged the two by different rules — and the narrower one governed
      // the harsher consequence: losing a held turn, rather than being dropped from a channel you
      // can rejoin. **The wider default is the safer one here**: counting more acts means removing
      // fewer people, and an owner who wants a stricter rule can uncheck rows they can already see.
      //
      // ONLY NEW ROOMS. A room that has authored settings carries its own value in the log, so this
      // changes nothing for it — the three missing rows are already visible in the panel and can be
      // ticked. **No key is added**, which is what keeps this off the fingerprint: adding one turns
      // `Floor.chainVerifies` false against every checkpoint sealed earlier (measured, ROW 1 of
      // `tools/probes/mutate-j25-settings-coupling.js`).
      activityQueue:    _flagsOn(ACTIVITY_GROUPS.slice()),
      // ── CHAT COUNTS TOWARDS KEEPING A QUEUE PLACE ───────────────────────────────────────────
      // The presence timer already had `botPresenceChat`; the queue timer had no chat option at
      // all, so somebody talking in the room still lost their deck. This is that switch, on by
      // default for the same reason every activity group is: counting more acts removes fewer
      // people, and an owner wanting a stricter rule can turn it off.
      //
      // THERE IS DELIBERATELY NO `botQueueSpine`. `botPresenceChat` has a `botPresenceSpine` twin
      // because presence can be answered from either source; the queue is answered from the Spine
      // and always will be, so a switch for it would only ever be a way to turn the whole rule
      // off by accident.
      botQueueChat:     true,
      activityPresence: _flagsOn(ACTIVITY_GROUPS),
      // The QUEUE's own idle window, separate from `botAfkMs` above and NOT a second copy of it.
      // `botAfkMs` is how long the ROOM considers you around — it already drives the people panel
      // and the presence question. This is how long a DECK is held for somebody who has stopped
      // doing anything, and it is shorter for the reason the maps differ: an idle deck blocks the
      // rotation for everyone else, while an idle chat member blocks nobody.
      queueIdleMs: 900000,   // 15 minutes

      // ── HOW LONG BEFORE A SONG MAY BE PLAYED AGAIN ────────────────────────────────────────
      // 0 IS OFF, and off is the default deliberately. A non-zero default would change what every
      // room already built does the moment this key exists, without anybody opening the panel —
      // and the room that most needs the rule is the one whose owner went looking for it.
      //
      // THE REDUCER DOES NOT ENFORCE THIS, AND THAT IS THE DESIGN RATHER THAN AN OMISSION. "Has
      // this song played recently" is answered from the play-log, whose REACH is bounded by what
      // each client still holds — a trimmed client and a fresh one legitimately give different
      // answers. Judging an advance on it would mean two honest clients accepting different
      // events, which is the divergence class the checkpoint seed exists to prevent, and the same
      // one that reverted the `_joining` projection at v344. Sealing a play-log into the seed to
      // fix that would grow the seed with the cooldown window, against a format whose promise is
      // that its size tracks people and songs currently relevant, never how long the room has run.
      //
      // So this is ROOM TRUTH that BEHAVIOUR reads: a bot skips a repeat with an ordinary authored
      // skip every client folds identically, and every client refuses to queue one. Exactly the
      // shape `botAfkMs` and `queueIdleMs` already have — folded, delegable, and acted on by a
      // reader whose own view is bounded and says so.
      // Held by three guards, each covering a different half: `check-room-compat` announces the
      // cost of the key existing at all, `check-setting-endpoints` PARTs A and D prove it folds at
      // its declared bounds, and `check-settings-rows` PART G proves the panel offers it. The
      // BEHAVIOUR it governs is `check-repeat-cooldown`.
      repeatCooldownMs: 0,

      checkpointCooldownMs: 20 * 60 * 1000,   // nobody spams checkpoints — the owner included
      // THE CHECKPOINT CADENCE, as dials rather than constants. A seal becomes due when EITHER
      // the cooldown above has elapsed or this many new events have accumulated.
      checkpointEvery: 40,                    // new events since our last seal that make one due
      // THE RANK LADDER FOR SEALING, hard-set in seconds rather than derived from vouchJitter.
      // Owner seals at the room's own threshold; each tier below adds one step, so the lower ranks
      // only ever act when the ranks above them did not. The step must comfortably exceed a
      // homeserver round trip — a client can only stand down for a checkpoint it has actually
      // SEEN, and one that fires before the owner's seal has synced back seals redundantly.
      checkpointRankOffsetMs: 5000,           // per tier: high-staff +5s, staff +10s, vip +15s...
      selfWitnessCheckpoint: true,            // may I seal on my OWN full trail when the room's is thin?
      vouchJitter: 1000,                      // the ONE turn-taking dial: rank slot width AND (at half) the peer jitter window
      receiptsPerMessage: 10,                 // how many vouch receipts ride along in one message
    };
  }

  // THE ACCEPTED RANGES — one table, exported, and the ONLY thing the validation below reads.
  // The owner settings panel reads this same table (through StreamManager -> Room), so the UI can
  // no longer advertise a range the reducer will refuse. Before this the two were hand-maintained
  // copies: the reducer narrowed minLen to 5-20, vouchJitter to 500-5000 and receiptsPerMessage to
  // 10-50 while the panel still offered the old ranges, and two more rows passed millisecond
  // bounds against a value the user typed in seconds. Every one of those failed the same silent
  // way — the owner set a value, the event went out, and the reducer kept the old one.
  // `scale` is display-only: how many raw units the user's typed unit is worth.
  // ── THE TYPED "CAN'T PLAY" VOCABULARY (J06) — PROTOCOL, NOT A SETTING ─────────────────────
  // `ddjp.play.blocked` carries a `k` naming WHY the embed failed, and this table is the one place
  // that decides which reasons count toward a skip road. Two decisions are frozen here, and both
  // are recorded in `blocked-content-survival.md` §3 rather than only in code:
  //
  // 1. THE LIST IS PROTOCOL; THE COUNTS ARE A SETTING. `skipRoads` already owns "how many, at
  //    which rung" and is owner-tunable. What "unavailable" MEANS is not, because a room that can
  //    redefine it can be tuned into skipping anything — and the structural floor of the whole
  //    design (`CONCEPTS.md` Part 7: no quantity of the weakest rung ever adds up) stops being
  //    structural the moment an owner can widen the vocabulary instead of raising a count.
  //
  // 2. A SMALL CLOSED VOCABULARY, NEVER FREE TEXT — and the reason is the fingerprint, not tidiness.
  //    This token is folded into `liveDecl.blocked` and therefore into a checkpoint's `seed`, which
  //    `h` commits. Free text there is an unbounded string inside a hashed field. So an UNKNOWN
  //    token is REJECTED at the fold like a bad `sec` is, rather than being accepted and ignored:
  //    accepting it would be the thing that lets arbitrary bytes reach the seed.
  //
  // ABSENT is not the same as UNKNOWN, and the difference is what lets this land mid-flight.
  // A declaration with no `k` at all is an older client's, is ACCEPTED, and does NOT count — so no
  // build that predates this can force a skip, and no room breaks while clients are mixed.
  //
  // `counts: true` means the song is unplayable for anyone who tries; `false` means the problem is
  // at the reporter's end and is nobody else's business.
    // ── WHY A SKIP HAPPENED, WHEN THE REASON CHANGES WHAT A LATER READER CONCLUDES ────────────
    // `ddjp.dj.skip` may carry `k`, a reason token from a small closed list — the same shape
    // `ddjp.play.blocked` already uses, and for the same reason: free text would be an unbounded
    // string, and a vocabulary is checkable.
    //
    // ONE TOKEN TODAY. `repeat` means "a bot ended this playing because the song had played too
    // recently", and it exists because WITHOUT IT THE FEATURE EATS ITSELF. A playing enters the
    // history the moment it starts, so a repeat that gets skipped would leave a fresh row and
    // restart its own cooldown: blocked until 11:30, tried again, now blocked until 12:30, and a
    // song people keep queuing becomes permanently unplayable with nothing saying why. Marking the
    // row keeps the clock measuring from the play that actually happened.
    //
    // AN UNKNOWN TOKEN IS IGNORED, NOT REFUSED — and this is deliberately the OPPOSITE of
    // `play.blocked`, which refuses one. Two reasons. The token reaches the HISTORY, which no
    // checkpoint seals, so it can never put arbitrary bytes inside a fingerprinted field — the
    // whole argument for refusing there. And a skip is an ADVANCE: refusing one over a tag it did
    // not understand would let a mislabelled body stall the room, which is a freeze risk taken on
    // behalf of a display-level fact. So an unrecognised tag degrades to an ordinary skip.
    //
    // A MODIFIED CLIENT CAN TAG ANY SKIP. All that buys is making one song playable slightly
    // sooner, which is why nothing is spent defending it.
    // Held by `check-repeat-cooldown` PART C, which drives all three cases through the fold: a
    // known token marks the ended playing, an unknown one leaves it unmarked, and the unknown one
    // does NOT refuse the advance. The empty-room case is there too, because the marking sat below
    // the next-song resolution once and never ran when a repeat-skip ended the last song.
    const SKIP_REASONS = { repeat: true };
    function isSkipReason(k) {
      return typeof k === "string" && Object.prototype.hasOwnProperty.call(SKIP_REASONS, k);
    }

  const BLOCKED_REASONS = {
    // the song is the problem — these advance a road
    "embed-denied":  { counts: true },   // the uploader disallows embedding
    "region-blocked": { counts: true },  // not available in the viewer's country
    "unavailable":   { counts: true },   // removed, private, or never existed
    // my end is the problem — these do not
    "bot-check":     { counts: false },  // an interstitial challenge aimed at this client
    "network":       { counts: false },  // my connection, not the media
    "player-failed": { counts: false },  // the embed itself would not come up
  };
  // The one predicate. Absent (`null`/`undefined`) resolves FALSE, which is the mid-flight rule
  // above; an unknown token never reaches here because the fold refuses it.
  function blockedReasonCounts(k) {
    const r = (typeof k === "string") ? BLOCKED_REASONS[k] : null;
    return !!(r && r.counts);
  }
  // Is this a token the protocol knows? Used by the fold's well-formedness check, and read through
  // `StreamManager.blockedReasons()` by the feature that maps a player error onto one — so the
  // reporter can never send a token the reducer will refuse (the SETTING_RANGES relationship, and
  // the same reason: two hand-maintained copies of one table is the drift that emptied the
  // settings panel).
  function isBlockedReason(k) {
    return typeof k === "string" && Object.prototype.hasOwnProperty.call(BLOCKED_REASONS, k);
  }

  // ── TWO KINDS OF ENTRY IN ONE TABLE, AND THE SECOND ONE IS WHY THIS COMMENT EXISTS (J07) ─────
  // Every entry here was `{min,max,scale}` — a NUMERIC bound checked by `_inRange`. `minDjRank` is
  // a rank, and a rank is a STRING in this codebase, so its validation is a MEMBERSHIP TEST against
  // the ladder's own names rather than a comparison. It lives in this table anyway, and that is the
  // decision rather than a convenience:
  //
  //   the panel reads THIS TABLE (StreamManager.settingRanges -> Room.getSettingRanges) to know
  //   what it may offer. A key validated somewhere else is a key the panel has to know about
  //   separately — which is the shape `chat` already has, with its three legal values written in
  //   `applySettingsEvent` below AND again in the panel's own row. Two hand-maintained copies of
  //   one fact is the drift docs/paths.md §7 records twice, and this key must not be a third
  //   instance of it.
  //
  // `values` is DERIVED from `Ranks.NAMES`, never spelled out, so adding a rung to the ladder
  // widens the accepted set the same day. Same relationship J06 gave the blocked-reason vocabulary:
  // one home, read through the interface as a copy, restated nowhere.
  //
  // A CONSUMER MUST DISPATCH ON THE KIND rather than assuming `min`/`max` exist. `settingKindOf`
  // below is the one place that answers which kind an entry is, so a reader — the reducer, the
  // panel, or a guard deriving its key list from this table — cannot invent its own test.
  const SETTING_RANGES = {
    // MEMBERSHIP: one of the ladder's rank names. See the note above.
    // ── THE ROTATION FLOOR IS OFFERED FROM `uncategorized` UP TO `guest`, NOT ALL SEVEN ──────
    // A RANGE CHANGE, not a new key — driven before building, because the two cost wildly
    // different amounts. `minDjRank` is an existing key with a `{values}` row, and **the seed
    // carries the settings BLOB, never the ranges**: `values` appears nowhere in a seed, so
    // narrowing the offered list cannot move a fingerprint. Free.
    //
    // DERIVED FROM THE LADDER rather than written out: the two rungs are taken by NAME from
    // `Ranks.NAMES`, so a ladder that renames a rung renames these, and one that inserts a rung
    // between them picks it up. A literal pair here would be a second copy of the ladder.
    //
    // WHY THESE TWO: `minDjRank` is the floor for JOINING the rotation, and a floor above `guest`
    // means a room where most arrivals cannot queue at all — which is a moderation decision the
    // rank ladder already expresses through channel membership. Offering seven rungs invited a
    // setting that reads as a small preference and acts as a lockout.
    minDjRank:            { values: Ranks.NAMES.filter((n) => n === "uncategorized" || n === "guest"),
                            scale: 1 },
    maxLen:               { min: 10,  max: 24 * 3600, scale: 1 },
    minLen:               { min: 5,   max: 20,        scale: 1 },
    minGate:              { min: 0,   max: 60000,     scale: 1000 },
    graceMs:              { min: 0,   max: 10000,     scale: 1000 },
    presendMs:            { min: 0,   max: 5000,      scale: 1 },
    vouchJitter:          { min: 500, max: 5000,      scale: 1 },
    receiptsPerMessage:   { min: 10,  max: 50,        scale: 1 },
    checkpointCooldownMs: { min: 0,   max: 24 * 60 * 60 * 1000, scale: 60000 },
    checkpointEvery:      { min: 5,   max: 1000,      scale: 1 },
    checkpointRankOffsetMs:     { min: 0, max: 120000, scale: 1000 },
    // THE QUEUE'S IDLE WINDOW. Floor is 60s and not 0: zero would remove a DJ the instant they
    // stopped acting, which for somebody mid-song is while their own song is playing. The ceiling
    // matches `botAfkMs`'s — a queue window LONGER than the room's idea of being around would
    // hold a deck for somebody the room has already stopped listing, which is the two-answers
    // collision `foldActivity`'s header is about, arriving from the other side.
    queueIdleMs:          { min: 60000, max: 24 * 60 * 60 * 1000, scale: 60000 },
    // OFF, OR A MINUTE TO A MONTH. `min: 0` is the OFF value rather than a degenerate one-second
    // cooldown, so the panel's zero and the rule's zero are the same number and nothing has to
    // translate between them. The ceiling is a month because a longer one asks about songs no
    // client's play-log still reaches, and a rule nothing can answer is a rule that silently does
    // nothing — see `Room.playedWithin`, which reports the reach rather than guessing past it.
    repeatCooldownMs:     { min: 0, max: 30 * 24 * 60 * 60 * 1000, scale: 60000 },
    // ── THE TWO ACTIVITY MAPS ────────────────────────────────────────────────────────────
    // FLAG-SHAPED, not rank-shaped: `values` is the two booleans rather than `Ranks.NAMES`, so
    // `_isValidMap` (which requires a STRING from a name vocabulary) cannot validate these and
    // `_isValidFlagMap` below does. Two predicates because they are two shapes, not one shape
    // with a mode — a mode would put a branch inside the validator every caller has to be right
    // about.
    //
    // `keys` is a FUNCTION for the same reason `botDelegation`'s is: it resolves at call time, so
    // a group added to `ACTIVITY_GROUPS` appears in the domain and in the panel with no second
    // edit. An array here would freeze today's set into a snapshot.
    activityQueue:        { keys: () => ACTIVITY_GROUPS.slice(), flags: true, scale: 1 },
    activityPresence:     { keys: () => ACTIVITY_GROUPS.slice(), flags: true, scale: 1 },
    // ── THE BOT DIALS (J17) ──────────────────────────────────────────────────────────────────
    // ROWS ARE ADDED WHERE THE SHAPE WANTS VALIDATING, NOT BECAUSE EVERY KEY NEEDS ONE. The claim
    // that a key without a row will not fold is FALSE and was checked: several shipping keys have
    // no row, `settingKindOf` answers `null` for every one, and all of them fold. Re-derive rather
    // than trusting a list here —
    // `Object.keys(SD.defaultSettings()).filter(k => !(k in SD.SETTING_RANGES))`.
    //
    // **THE COUNT AND THE LIST BOTH ROTTED, IN DIFFERENT DIRECTIONS.** It read "seven of the
    // eighteen keys" and named seven; the key set is larger now, and the list was already short by
    // two — `botPresenceSpine` and `botPresenceChat` have no row either, which the very next
    // sentence says while the list above it omitted them. A count and an enumeration of the same
    // thing, three lines apart, disagreeing.
    //
    // What a missing row actually costs is that the PANEL has no bounds to read and must restate
    // the vocabulary, which is the `chat` drift `roles.md` §Confusables already flags. So: rows
    // here for the numeric dials and for the maps, and none for the booleans, which have no
    // vocabulary to restate.
    botAfkMs:             { min: 60000, max: 24 * 60 * 60 * 1000, scale: 60000 },
    botPingMs:            { min: 15000, max: 60 * 60 * 1000,      scale: 1000 },
    // THE THIRD KIND (of four since v322 — `flags` joined it; see `activityQueue` below).
    // `botDelegation` is a MAP and is neither a numeric range nor a value set, so `settingKindOf`
    // needs an answer of its own for it. Both halves are DERIVED rather than listed:
    // `keys` is `defaultSettings()`'s own key set minus the key itself, and `values` is
    // `Ranks.NAMES`. Listing either would be a second copy free to drift, which is the whole
    // reason this key is set-shaped rather than rank-shaped.
    //
    // `keys` is a FUNCTION, not an array, because `defaultSettings()` is defined above this object
    // and calling it at module-construction time would freeze a snapshot of the key set that a
    // later key would not appear in. The panel and the reducer both call it.
    botDelegation:        { keys: () => Object.keys(defaultSettings()).filter((k) => k !== "botDelegation"),
                            values: Ranks.NAMES, scale: 1 },
  };
  // INTEGERS ONLY, and this is not cosmetic. The hash layer's canonical form (DCF) accepts only
  // finite integers — it THROWS on anything else. So a fractional value that passes validation
  // becomes a LEGAL event that no client can fingerprint, which silently kills the whole vouching
  // pass for everyone holding it (the bundle build throws, the caller swallows it, no bundle is
  // ever attached again). Rejecting here is the fix: an un-hashable event must never be legal.
  // Rounding would NOT do — the round only reaches derived state, while the event BODY that gets
  // hashed still carries the fraction.
  // (There is deliberately NO Math.round anywhere below this line. A value that reaches derived
  // state has already passed _inRange, so it IS a safe integer; rounding would only be dead code
  // that teaches the next reader the opposite of the rule.)
  function _inRange(key, v) {
    const r = SETTING_RANGES[key];
    // THIS KIND CHECK IS REDUNDANT TODAY, AND IT IS KEPT DELIBERATELY — see roles.md §9.
    // MEASURED (tools/probes/mutate-min-dj-rank.js row 6): deleting it leaves the whole suite GREEN,
    // and that is correct rather than a hole. EVERY call site passes a numeric key literal — the
    // count is not written because it moved from ten to thirteen when v322 added a key, for a
    // property that did not change; re-derive with `grep -c '_inRange(' ` and subtract the
    // definition. So a MEMBERSHIP key never arrives here; and if one did, `r.min`/`r.max` are
    // `undefined` for such an entry and both `v >= undefined` and `v <= undefined` are false, so the
    // answer would already be "refused". What enforces the refusal is the comparison against
    // `undefined`, not this line.
    //
    // It stays because it states the rule where a reader is working out what the two kinds mean —
    // the same reasoning roles.md §9 records for `Floor.select`'s three redundant clauses — and it is
    // documented as redundant so nobody mistakes it for the enforcement. The caller's actual
    // obligation is to ask `settingKindOf` and pick the right predicate; `applySettingsEvent` does.
    if (!r || !_isNumericRange(r)) return false;
    return Number.isSafeInteger(v) && v >= r.min && v <= r.max;
  }

  // ── THE TWO KINDS, ANSWERED IN ONE PLACE ─────────────────────────────────────────────────────
  // Read off the entry's own SHAPE rather than from a list of key names, so a key added to
  // SETTING_RANGES is classified by what it declares instead of by whoever remembers to extend a
  // list here. An entry that is neither is `null`, never a default — a silent default is how an
  // unvalidated setting would sail through as though it had been checked.
  function _isNumericRange(r) { return !!r && typeof r.min === "number" && typeof r.max === "number"; }
  function _isValueSet(r) { return !!r && Array.isArray(r.values); }
  // A MAP ENTRY: a derived key domain plus a value vocabulary. Asked BEFORE `_isValueSet`, because
  // a map entry also carries `values` and would otherwise answer "values" and be validated as a
  // scalar — the shape-reading order is load-bearing, not tidiness.
  function _isMapOf(r) {
    return !!r && typeof r.keys === "function" && Array.isArray(r.values);
  }
  // A FLAG MAP is a map whose values are booleans rather than names from a vocabulary. Kept apart
  // from `_isMapOf` rather than folded into it: that predicate's whole job is "keys() plus a
  // values vocabulary", and a flag map has no vocabulary. One predicate covering both would have
  // to answer `values` for a shape that has none.
  function _isFlagMapOf(r) {
    return !!r && typeof r.keys === "function" && r.flags === true;
  }
  // ACCEPTED WHOLE OR REFUSED WHOLE, like every other map here. A partial flag map is refused
  // rather than merged, so a room can never end up half on a new rule and half on the old one.
  // ABSENT MEANS FALSE and that is deliberate: a room writing `{rotation: true}` means only
  // rotation counts, and requiring every group to be written would make adding a group to
  // `ACTIVITY_GROUPS` invalidate every stored map in every room.
  function _isValidFlagMap(key, v) {
    const r = SETTING_RANGES[key];
    if (!_isFlagMapOf(r)) return false;
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const domain = r.keys();
    for (const k of Object.keys(v)) {
      if (domain.indexOf(k) < 0) return false;
      // BOOLEANS ONLY. `"false"` and `0` are both truthy-or-falsy in a way that would make a
      // room's rule depend on how its panel serialised it, and this value reaches a checkpoint
      // seed the fingerprint commits — so a coerced one is a room that cannot agree with itself.
      if (typeof v[k] !== "boolean") return false;
    }
    return true;
  }
  function settingKindOf(key) {
    const r = SETTING_RANGES[key];
    if (_isMapOf(r)) return "map";
    if (_isFlagMapOf(r)) return "flags";
    if (_isNumericRange(r)) return "range";
    if (_isValueSet(r)) return "values";
    return null;
  }
  // MEMBERSHIP for a map: every key must be in the derived domain and every value in the
  // vocabulary. TOTAL like every predicate here — it answers, it does not throw.
  function _isValidMap(key, v) {
    const r = SETTING_RANGES[key];
    if (!_isMapOf(r)) return false;
    if (!v || typeof v !== "object" || Array.isArray(v)) return false;
    const domain = r.keys();
    for (const k of Object.keys(v)) {
      if (domain.indexOf(k) < 0) return false;
      if (typeof v[k] !== "string" || r.values.indexOf(v[k]) < 0) return false;
    }
    return true;
  }
  // MEMBERSHIP: is `v` one of the values this key declares? Strings only — every value set here is
  // a name vocabulary, and accepting a non-string would make `indexOf` answer on coercion.
  function _inValues(key, v) {
    const r = SETTING_RANGES[key];
    if (!_isValueSet(r)) return false;
    return typeof v === "string" && r.values.indexOf(v) >= 0;
  }

  // ── THE REDUCER BOUNDS THE SHAPE; IT DOES NOT JUDGE THE CONTENT ──────────────────────────
  // Only `!c.v` was checked, so anything truthy became a song: an object, an array, a number, or a
  // 5000-character string. All of them entered the rotation's pending buffer — and the rotation
  // goes into every checkpoint SEED, which is specified at roughly 2 KB regardless of room age. A
  // handful of oversized joins breaks that guarantee outright, and a non-string id then flows on
  // into watchUrl() and the player.
  //
  // What is checked here is TYPE and SIZE, deliberately not format. Whether a string is a real
  // video id belongs to metadata.js and PlaylistDoc, which already own that question; restating it
  // in a pure reducer that may not depend on either would be a second copy free to drift. So the
  // reducer's promise is narrower and total: state cannot be poisoned by shape.
  //
  // Rejected, never truncated. A clipped id is a DIFFERENT id — it would look like a song and play
  // as nothing, which is worse than refusing the join outright.
  const MAX_ID = 64;      // a YouTube id is 11; the headroom is for future id formats, not payloads
  const MAX_URL = 512;
  function songOf(c) {
    if (!c || typeof c.v !== "string" || !c.v || c.v.length > MAX_ID) return null;
    const u = (typeof c.u === "string" && c.u && c.u.length <= MAX_URL) ? c.u : null;
    return { videoId: c.v, videoUrl: u };
  }

  function rankOf(ev) {
    return typeof ev.senderRank === "number" ? ev.senderRank : DEFAULT_RANK;
  }

  // derive(orderedEvents, seed?)
  //
  // SEED MODE (checkpoints, Phase 7). With no seed, derive folds from an empty genesis
  // state exactly as before (byte-identical — the seed path is skipped entirely). With a
  // seed, the reducer's CROSS-EVENT ACCUMULATORS are pre-populated from a checkpoint's
  // sealed core, so folding only the events AFTER the checkpoint reproduces the same state
  // as folding the whole log from genesis. The seed carries exactly the carry-forward state
  // (see docs/consensus/checkpoint-contents.md §1): members(+orderKey), nowPlaying(+pi
  // +settings), settings, tick, and the live-pi→videoId/dj mapping. Everything
  // else (history, rotation output, off-air pi maps) is recomputed and MUST NOT be seeded.
  // The seed is applied by COPYING (never aliasing) so the caller's object can't be mutated.
  function _deriveFull(orderedEvents, seed) {
    // LEGALITY (the vouch layer's input). Every top-level `continue` in the two event
    // loops below is a REJECTION — the event arrived, parsed, and changed nothing. We
    // record those rather than recording acceptances, deliberately: a rejection site we
    // forget to mark leaves an event counted as legal, which is the status quo, whereas
    // a missed acceptance would silently make real history unvouchable. Kept OUT of the
    // returned `state` so checkpoint fingerprints are byte-identical to before.
    // A reducer entry's id is `eventId` (StreamManager parses raws into that shape before
    // folding); some unit fixtures pass raw Matrix events keyed `event_id`. Accept either, so
    // the accepted set is populated in production, not only under the guards. Getting this wrong
    // silently returns an EMPTY accepted set, which makes every event read as illegal and stops
    // the vouch layer protecting anything — the worst possible failure, and invisible to tests
    // that happen to set event_id.
    const _idOf = (ev) => (ev && (ev.eventId || ev.event_id)) || null;
    const _rejected = Object.create(null);
    // ── A REASON IS DIAGNOSTIC OUTPUT, NEVER DERIVED STATE ──────────────────────────────────
    // `code` is REQUIRED. Every refusal site names the condition that decided, at the point it
    // decided — which is the only place that knows. The transport used to print "the fold did not
    // accept it (rank gate, empty rotation, or no road met)": three possibilities wearing an
    // explanation's clothes, and it printed that because **nothing upstream kept a reason**. A
    // message cannot name a decision it was not told about.
    //
    // **THE REASONS GO IN A SEPARATE MAP AND TRAVEL ALONGSIDE STATE, NEVER INSIDE IT.** `accepted`
    // already works this way, for the reason written at its own return: nothing here may move a
    // checkpoint fingerprint. J17 measured what one new committed field costs — every checkpoint in
    // every room re-fingerprints and the dead-checkpoint window opens — so a refusal reason that
    // reached a seed would be a settings-key-shaped cost wearing a log message's clothes.
    //
    // `detail` carries THE VALUES THAT DECIDED, because `no-road-met` without saying which roads
    // and what was needed is a shorter version of the problem being fixed. TOO EARLY is the
    // standard: it names the gate, the seconds and the agreed length.
    const _refusals = Object.create(null);
    function _rej(ev, code, detail) {
      const id = _idOf(ev);
      if (!id) return;
      _rejected[String(id)] = true;
      // An uncoded refusal is recorded as such rather than as "unknown": `check-refusal-reasons`
      // fails on any call site that omits a code, so this branch is unreachable in a tree that
      // passes — kept so a future path that slips through is VISIBLE rather than silently rejoining
      // the problem this fixes.
      _refusals[String(id)] = { code: (typeof code === "string" && code) ? code : "uncoded",
                                detail: (detail && typeof detail === "object") ? detail : null };
    }
    // All maps keyed by ATTACKER-CONTROLLED strings (userId, target, move-target x, play-instance
    // id) use Object.create(null) — a null-prototype object. With a plain {}, a hostile key like
    // "__proto__" or "constructor" would resolve to an INHERITED Object.prototype member: the
    // `!members[x]` existence guards would see a truthy value and fall through, then crash on
    // members[x].pending (undefined) — a reducer-wide DoS any Staff+ could trigger with one move.
    // Null-prototype maps have no inherited keys, so every guard and lookup is honest.
    const members = Object.create(null);      // userId -> { pending: [song], orderKey }
    // ── `rankByUser` IS GONE, AND THE PROJECT'S OWN RULE IS WHY ──────────────────────────────
    // It was a userId -> last-seen-rank map, carried into the checkpoint seed and committed by
    // the fingerprint. CONCEPTS.md §3.7 states the test for what a checkpoint may contain: does
    // the reducer need this value as a starting point to judge the NEXT event, and can it not be
    // recomputed from the other sealed fields? It failed the first half outright — nothing in the
    // tree ever read it. checkpoint-contents.md already called it vestigial.
    //
    // Vestigial was not the same as harmless. It was written for EVERY event carrying a sender,
    // before the type dispatch and before any rejection — so vouch bundles, peer checkpoints and
    // events the reducer rejected all wrote to it. Derived state stayed byte-identical (which is
    // all check-reducer-ignore used to assert), while the SEED and therefore the FINGERPRINT
    // moved. Two honest clients whose logs differed by one ignored message could not reproduce
    // each other's cut, so Floor.chainVerifies returned false, no quorum formed, no floor was
    // adopted and the room never forgot anything — silently, with every correctness guard green
    // because the room itself was right.
    //
    // Deleting the field removes the CATEGORY rather than the instance: no future inert event can
    // pollute an accumulator that does not exist. Narrowing the write instead would have left the
    // restore below re-admitting a polluted seed from an older or hostile checkpoint and
    // re-emitting it down the chain — which is what PART D of check-reducer-ignore pins.
    //
    // Rank itself is unaffected and always was: it is proved by CHANNEL ORIGIN on each event
    // (ev.senderRank), which is what every gate reads. This map was a copy of a fact the events
    // already carry, which is the same thing the Lamport counter turned out to be.
    let nowPlaying = null;
    let tick = 0;            // rotation counter, local to this derive() — keeps it pure
    const history = [];
    const piToVid = Object.create(null);
    const piToDj = Object.create(null);
    let settings = defaultSettings();
    // THE LIVE DECLARATION ACCUMULATOR (Steps 7-9).
    // Declarations are folded IN ORDER alongside every other event, so when a play/skip is
    // judged this holds exactly the declarations that sort BEFORE it - the prefix, and nothing
    // else. The old code rescanned the whole list per play, which let a declaration posted
    // AFTER an advance retroactively invalidate it (history rewriting) and made derive
    // superlinear. Only ONE pi is ever live, so this is a single entry that RESETS on advance:
    // bounded by participants, never by log length.
    // PROVENANCE FOR SETTINGS. The id of the last accepted ddjp.room.settings event, or null for a
    // room still on defaults. Settings are the one thing a checkpoint asserts that nothing else can
    // check: the seed COPIES the values, and a copy carries no evidence. Naming the event that
    // produced them means anyone holding it can recompute and compare instead of trusting the
    // checkpoint's author. Carry-forward, exactly like decl — the fold cannot recompute it from the
    // other sealed fields once the events below the cut are gone, which is the whole point.
    // NOTE: this is an IDENTIFIER, never an authority. The rank gate above still decides what is
    // accepted; this only records which accepted event we ended up at.
    let settingsFrom = null;
    // { pi, len: { user: {sec,tier} }, blocked: { user: {tier,k} } }
    // `blocked` was `{ user: tier }` — a bare number — until J06 gave the declaration a typed
    // reason. It is an OBJECT now, matching `len`, because the band needs the tier and the road
    // needs the reason, and two parallel maps keyed by the same user would be two answers to one
    // question (P7). This shape reaches the checkpoint seed, so see `buildSeed`/the seed reader.
    let decl = null;
    function _freshDecl(pi) { return { pi: pi, len: Object.create(null), blocked: Object.create(null) }; }

    // ── apply the checkpoint seed (if any) BEFORE folding ────────────────────────
    if (seed && typeof seed === "object") {
      if (typeof seed.settingsFrom === "string" || seed.settingsFrom === null) settingsFrom = seed.settingsFrom;
      if (seed.members && typeof seed.members === "object") {
        for (const u in seed.members) {
          const m = seed.members[u];
          if (!m) continue;
          const pending = Array.isArray(m.pending) ? m.pending.map((s) => ({ videoId: s.videoId, videoUrl: s.videoUrl != null ? s.videoUrl : null })) : [];
          members[u] = { pending: pending, orderKey: typeof m.orderKey === "number" ? m.orderKey : 0 };
        }
      }
      // A seed's `rankByUser` (if an older or foreign checkpoint carries one) is IGNORED, not
      // restored. Restoring it is what would let one polluted seal propagate down the whole chain
      // from clients that never saw the event that polluted it.
      if (seed.settings && typeof seed.settings === "object") settings = Object.assign(defaultSettings(), seed.settings);
      if (typeof seed.tick === "number") tick = seed.tick;
      if (seed.nowPlaying && typeof seed.nowPlaying === "object") {
        const n = seed.nowPlaying;
        nowPlaying = {
          dj: n.dj, pi: n.pi, startedAt: typeof n.startedAt === "number" ? n.startedAt : 0,
          skipped: !!n.skipped,
          song: n.song ? { videoId: n.song.videoId, videoUrl: n.song.videoUrl != null ? n.song.videoUrl : null } : null,
          settings: n.settings ? Object.assign({}, n.settings) : Object.assign({}, settings),
          // The frozen values AND their provenance both have to come back, or the seeded fold
          // rebuilds a nowPlaying that differs from the genesis one by exactly this field and the
          // cross-check reports a divergence that is entirely our own doing.
          settingsFrom: n.settingsFrom != null ? n.settingsFrom : null,
        };
        // restore the live-instance mapping so votes/saves after the checkpoint attribute
        if (n.pi && nowPlaying.song && nowPlaying.song.videoId) piToVid[n.pi] = nowPlaying.song.videoId;
        if (n.pi && nowPlaying.dj) piToDj[n.pi] = nowPlaying.dj;
        // THE LIVE DECLARATIONS ARE A CARRY-FORWARD ACCUMULATOR (checkpoint-contents.md 1).
        // The advance that ends the CURRENT song is judged against declarations folded before
        // the seal. Without them in the seed, derive(seed, after) accepts an advance that
        // derive(genesis) rejects - the forget path diverges. Live pi only, mirroring the
        // livePi rule: off-air declarations are dead and must NOT be sealed.
        decl = _freshDecl(n.pi);
        const sd = seed.liveDecl;
        if (sd && typeof sd === "object" && sd.pi === n.pi) {
          if (sd.len && typeof sd.len === "object") {
            for (const u in sd.len) {
              const r = sd.len[u];
              if (r && typeof r.sec === "number" && typeof r.tier === "number") decl.len[u] = { sec: r.sec, tier: r.tier };
            }
          }
          if (sd.blocked && typeof sd.blocked === "object") {
            // AN OBJECT, `{tier,k}` (J06). The old shape was a bare tier number and a seed still
            // carrying one is REFUSED per entry rather than read as untyped: this build supports
            // rooms it creates and no others (08-build-and-deploy.md §Legacy), and silently
            // admitting the old shape as `k: null` would make a pre-J06 checkpoint seed a tally
            // that quietly counts nothing — a wrong answer dressed as a migration. A refused entry
            // shows up as a seed that cannot reproduce its cut, which is the loud failure.
            for (const u in sd.blocked) {
              const b = sd.blocked[u];
              if (!b || typeof b !== "object" || typeof b.tier !== "number") continue;
              decl.blocked[u] = { tier: b.tier, k: (typeof b.k === "string") ? b.k : null };
            }
          }
        }
      }
    }

    // Room PLAY HISTORY (declared above): the ordered list of songs that actually played,
    // derived as a byproduct of the SAME fold that produces nowPlaying — so it can never
    // disagree with what really played. A play/skip's videoId is NOT in its event body; it's
    // whatever the reducer pops from the head DJ's buffer here. History is NOT seeded (it's a
    // recomputed display window); a checkpoint restarts it empty and it refills as events fold.
    // piToVid/piToDj (declared above) map a play-instance → its videoId/DJ for the counts pass;
    // the live instance is seeded, off-air ones refill during the fold. Bounded to HISTORY_MAX.
    function pushHistory(np) {
      if (!np || !np.song || !np.song.videoId) return;
      history.push({ videoId: np.song.videoId, dj: np.dj, at: np.startedAt || 0, pi: np.pi, skipped: !!np.skipped });
      if (history.length > HISTORY_MAX) history.shift();   // keep the most-recent window
    }
    // Room settings (declared above): last owner-written ddjp.room.settings wins; defaults
    // apply until the owner posts one (or the seed provides them).

    function pushSong(m, s) {
      if (!s) return;
      if (m.pending.length >= BUFFER_MAX) return;
      const wasEmpty = m.pending.length === 0;
      m.pending.push(s);
      if (wasEmpty) m.orderKey = ++tick;   // first song: enter / re-enter at the back
    }

    function visible() {
      const ids = [];
      for (const u in members) if (members[u].pending.length > 0) ids.push(u);
      ids.sort((a, b) => members[a].orderKey - members[b].orderKey);
      return ids;
    }

    const list = Array.isArray(orderedEvents) ? orderedEvents : [];

    for (const ev of list) {
      if (!ev || typeof ev.type !== "string") { _rej(ev, "unhandled-shape"); continue; }
      const c = ev.content || {};
      const user = ev.sender || (c.sender ? c.sender : null);
      const rank = rankOf(ev);

      if (ev.type === "ddjp.dj.join") {
        // THE BAR IS READ HERE, FROM `settings`, WHICH IS THE FOLD'S OWN RUNNING VALUE (J07).
        // Because events are folded in sorted order, `settings` reflects every settings event
        // BEFORE this join and none after — so this is "the bar the owner had set when the join
        // happened", with no snapshot needed and nothing to carry forward. That is what makes the
        // setting LIVE rather than FROZEN: a frozen dial is snapshotted onto a SONG, and a join is
        // not a song.
        //
        // A LATER CHANGE NEVER RE-JUDGES THIS JOIN, and never ejects a member admitted under a
        // lower bar. Raising the bar governs admission from that point on. The alternative was
        // considered and refused in writing: ejection would make `members` — which buildSeed seals
        // — a function of a LATER settings event as well as of the joins, so two clients that had
        // forgotten different amounts of history would have to agree about which past joins a
        // present setting retroactively voided. That is the divergence class
        // checkpoint-contents.md §0 exists to prevent, and it is why this is not merely a
        // preference about user experience.
        //
        // BY NAME, via Ranks.atLeast — no level literal at the site (check-boundaries rule H's
        // reasoning, applied inside the backend where it is a matter of drift rather than a rule).
        if (!user || !Ranks.atLeast(rank, settings.minDjRank)) { _rej(ev, "rank-below-min-dj"); continue; }
        // AN EVENT THAT CHANGES NOTHING IS NOT PART OF THE TIMELINE. A join from someone
        // ALREADY in the rotation that adds no song — which is what the Join button sends when
        // pressed twice — leaves members untouched, and so did a join whose song the buffer cap
        // refused. Accepted, it was legal; legal + critical is what protection is spent on, and
        // what the seal cadence counts. Rejecting is not a new rule: the reducer records every
        // no-op `continue` as a rejection, and these branches simply fell through instead.
        const _joining = !members[user];
        if (_joining) members[user] = { pending: [], orderKey: 0 };
        const _hadSongs = members[user].pending.length;
        pushSong(members[user], songOf(c));
        if (!_joining && members[user].pending.length === _hadSongs) { _rej(ev, "queue-full"); continue; }

      } else if (ev.type === "ddjp.dj.declare") {
        if (!user) { _rej(ev, "no-sender"); continue; }
        const m = members[user];
        if (!m) { _rej(ev, "not-a-member"); continue; }
        // Same rule as join: a declare with no usable song, or one the buffer cap refused,
        // changes nothing and is therefore not protectable.
        const _before = m.pending.length;
        pushSong(m, songOf(c));
        if (m.pending.length === _before) { _rej(ev, "queue-unchanged"); continue; }

      } else if (ev.type === "ddjp.dj.leave") {
        // A leave from someone who never joined deletes nothing. This branch had no rejection
        // at all, so every one of them was legal — the cheapest way in the whole protocol to
        // manufacture vouch work for every client in the room.
        if (!user || !members[user]) { _rej(ev, "not-a-member"); continue; }
        delete members[user];

      } else if (ev.type === "ddjp.dj.remove") {
        // Remove a DJ from the rotation. Staff+ may remove ANYONE currently in the
        // rotation — equal or higher rank, owner included — exactly like the VIP+
        // skip-others rule ignores whose song it is (rank-blind by design). Removal only
        // drops them from the DJ line; it touches no Matrix rank/power, and they can
        // rejoin with a fresh join. Rank is still channel-proven; no body field trusted.
        const target = c.x;
        if (!target || !members[target]) { _rej(ev, "target-not-a-member"); continue; }
        if (!Ranks.permits(rank, "dj.remove")) { _rej(ev, "not-permitted"); continue; }
        delete members[target];

      } else if (ev.type === "ddjp.dj.strike") {
        // Remove ONE specific declared song (by videoId `v`) from a target DJ's buffer
        // (`x`) — the moderator counterpart to the own-buffer ddjp.dj.undeclare. Staff+
        // may strike ANYONE's song (rank-blind, like remove / skip-others). Total: a
        // missing target/videoId, an unknown target, or a videoId not in their buffer is
        // a clean no-op. Removes the FIRST matching instance; if that empties the buffer
        // the DJ drops out of the rotation (hard fall-out, the SAME rule as undeclare —
        // they re-enter with a fresh join). Pure, no wall-clock; processed in sorted
        // (l, event_id) order so every client converges, like every other rotation edit.
        // The "shared 3s cooldown" is an ADVISORY UI gate (display-level, ServerClock —
        // see interface.js / queue.js); the reducer reads NO time and enforces none.
        if (!Ranks.permits(rank, "dj.strike")) { _rej(ev, "not-permitted"); continue; }
        const target = c.x;
        if (!target || !members[target]) { _rej(ev, "target-not-a-member"); continue; }
        const vid = c.v;
        if (typeof vid !== "string" || !vid) { _rej(ev, "no-video-id"); continue; }
        const idx = members[target].pending.findIndex(s => s.videoId === vid);
        if (idx < 0) { _rej(ev, "not-in-their-queue"); continue; }                        // not in their buffer -> no-op
        members[target].pending.splice(idx, 1);
        if (members[target].pending.length === 0) delete members[target];   // empty -> hard fall-out

      } else if (ev.type === "ddjp.dj.move") {
        if (!Ranks.permits(rank, "dj.move")) { _rej(ev, "not-permitted"); continue; }
        const x = c.x;
        if (!x || !members[x] || members[x].pending.length === 0) { _rej(ev, "target-queue-empty"); continue; }
        // Moving the head to the front, or a member to where it already sits, moves nothing.
        // Captured here and compared after the walk rather than predicted before it, because
        // the walk has four branches and a second copy of its arithmetic is what would drift.
        const _keyBefore = members[x].orderKey;
        // Reposition ONLY the moved member, WITHOUT sorting all members. The old handler called
        // visible() (a full O(M log M) sort) AND rewrote every member's orderKey on EVERY move —
        // O(M² log M) over a move flood, an attacker-triggerable complexity-DoS that froze derive
        // for seconds. Here a move needs only two keys: the target's, and the smallest key strictly
        // greater than the target's (the "next" slot). One O(M) scan finds both; x gets a key
        // strictly between them (or just below the current minimum for a to-front move). Identical
        // resulting order, deterministic (same keys from the same ordered log), no full sort.
        if (!c.after) {
          // to the FRONT: give x a key strictly below the current minimum (excluding x).
          let minK = null;
          for (const u in members) { if (u === x || members[u].pending.length === 0) continue; const k = members[u].orderKey; if (minK === null || k < minK) minK = k; }
          members[x].orderKey = (minK === null) ? 0 : minK - 1;
        } else if (!members[c.after] || members[c.after].pending.length === 0) {
          // target not in the visible rotation → no-op (matches the old filter/indexOf miss = append,
          // but with an unknown target the old code appended to the end; preserve "to the back").
          let maxK = null;
          for (const u in members) { if (u === x || members[u].pending.length === 0) continue; const k = members[u].orderKey; if (maxK === null || k > maxK) maxK = k; }
          members[x].orderKey = (maxK === null) ? 0 : maxK + 1;
        } else {
          // place x immediately AFTER c.after: between the target's key and the next-higher key.
          const afterK = members[c.after].orderKey;
          let nextK = null;   // smallest key strictly greater than afterK (excluding x)
          for (const u in members) {
            if (u === x || members[u].pending.length === 0) continue;
            const k = members[u].orderKey;
            if (k > afterK && (nextK === null || k < nextK)) nextK = k;
          }
          if (nextK === null) members[x].orderKey = afterK + 1;                 // target is last
          else if (nextK - afterK > 1) members[x].orderKey = Math.floor((afterK + nextK) / 2);
          else {
            // dense keys with no integer gap — one-time compaction of the visible order (rare, O(M)
            // once, deterministic). Rebuild keys 0..k in current sorted order with x placed after.
            const ids = [];
            for (const u in members) if (members[u].pending.length > 0 && u !== x) ids.push(u);
            ids.sort((a, b) => members[a].orderKey - members[b].orderKey);
            const pos = ids.indexOf(c.after);
            const seq = ids.slice(0, pos + 1).concat([x], ids.slice(pos + 1));
            let kk = 0; for (const u of seq) members[u].orderKey = kk++;
          }
        }

        if (members[x].orderKey === _keyBefore) { _rej(ev, "order-unchanged"); continue; }

      } else if (ev.type === "ddjp.dj.reset") {
        if (!Ranks.permits(rank, "dj.reset")) { _rej(ev, "not-permitted"); continue; }
        for (const u in members) delete members[u];
        nowPlaying = null;   // reset is now a true zero state: empty queue AND nothing playing

      } else if (ev.type === "ddjp.dj.order") {
        // Reorder MY OWN declared buffer (which of my up-to-2 songs plays next).
        // c.o is the desired order, by videoId. Consensus-critical: processed in
        // sorted (l, event_id) order like every other event, with no arrival-time
        // input (P2/P7) and no optimism, so if this races a play that advances my
        // buffer, every client — including the sender — derives the same result.
        // Only the sender's own buffer is touched, so no rank gate is needed.
        // Total: a non-member, missing/empty o, or unknown ids are clean no-ops;
        // any songs not named in o keep their relative order at the back; matching
        // consumes by instance so a duplicate videoId can't drop a song.
        if (!user) { _rej(ev, "no-sender"); continue; }
        const m = members[user];
        if (!m) { _rej(ev, "not-a-member"); continue; }
        const want = Array.isArray(c.o) ? c.o : null;
        if (!want || want.length === 0) { _rej(ev, "empty-selection"); continue; }
        const pool = m.pending.slice();
        const reordered = [];
        for (const vid of want) {
          const idx = pool.findIndex(s => s.videoId === vid);
          if (idx >= 0) reordered.push(pool.splice(idx, 1)[0]);
        }
        for (const s of pool) reordered.push(s);
        // Naming ids I do not hold, or the order already in force, both land here having moved
        // nothing. Compared by videoId in sequence, which is what the buffer's identity is.
        let _same = reordered.length === m.pending.length;
        if (_same) for (let i = 0; i < reordered.length; i++) {
          if (reordered[i].videoId !== m.pending[i].videoId) { _same = false; break; }
        }
        if (_same) { _rej(ev, "selection-unchanged"); continue; }
        m.pending = reordered;   // rotation position (orderKey) is unchanged

      } else if (ev.type === "ddjp.dj.undeclare") {
        // Remove ONE song from MY OWN declared buffer by videoId, WITHOUT playing
        // it — the "take a declared song back off the room queue" primitive (My
        // Queue room-queue-section remove/swap, 14 §4). Sender-only: it touches
        // only the sender's own songs, so no rank gate is needed (same reasoning
        // as ddjp.dj.order). Consensus-critical, processed in sorted (l, event_id)
        // order with no clock/optimism, so a race with a play that advances this
        // buffer converges identically for every client: either the song already
        // played (this is a clean no-op) or it's removed first and the play takes
        // the next. Total: a non-member, a missing/non-string v, or an unknown id
        // are all clean no-ops. Removes the FIRST matching instance. If that
        // empties the buffer, the member drops out of the rotation — the SAME
        // "no buffered songs => out of the rotation" rule as hard fall-out (they
        // re-enter with a fresh ddjp.dj.join, at the back).
        if (!user) { _rej(ev, "no-sender"); continue; }
        const m = members[user];
        if (!m) { _rej(ev, "not-a-member"); continue; }
        const vid = c.v;
        if (typeof vid !== "string" || !vid) { _rej(ev, "no-video-id"); continue; }
        const idx = m.pending.findIndex(s => s.videoId === vid);
        if (idx < 0) { _rej(ev, "not-in-my-queue"); continue; }                        // not in my buffer -> no-op
        m.pending.splice(idx, 1);
        if (m.pending.length === 0) delete members[user];   // empty buffer -> out of the rotation

      } else if (ev.type === "ddjp.play.len" || ev.type === "ddjp.play.blocked") {
        // PER-PLAY-INSTANCE DECLARATIONS. Legality is judged ONCE, here, from the state as of
        // THIS fold position, and never revisited. A declaration is legal iff:
        //   1. it is well-formed (pi a string; for len, sec a finite number > 0),
        //   2. it names the pi that is LIVE at its own fold position,
        //   3. it is the first from that sender for that pi.
        // Everything else is rejected and therefore unprotected: a pi that never started (a
        // rejected play has an event id but never became a play instance), a pi that has already
        // ended (this is the retroactive-invalidation vector), one that sorts before the play it
        // names (you cannot measure a song before it starts), a repeat, or junk.
        //
        // Judging at fold position is what makes a declaration about a NOW-FINISHED song stay
        // legal: it was live when the declaration landed, so it is accepted and PROTECTED for
        // good. That protection is load-bearing — every replay from genesis re-judges the advance
        // that ended that song using exactly these events, so losing one flips a settled verdict.
        // Protection ends when a checkpoint BANKS the segment (the forget doctrine,
        // checkpoint-contents.md 6a), never when the song ends.
        const cc = ev.content || {};
        const who = ev.sender || null;
        if (!who) { _rej(ev, "no-sender"); continue; }
        if (!nowPlaying || !nowPlaying.pi) { _rej(ev, "nothing-playing"); continue; }        // nothing is playing
        if (cc.pi !== nowPlaying.pi) { _rej(ev, "not-the-live-play"); continue; }              // not the live playing
        if (!decl || decl.pi !== nowPlaying.pi) decl = _freshDecl(nowPlaying.pi);
        const dTier = Ranks.tierOf(rank);
        if (ev.type === "ddjp.play.len") {
          // Integers only. Rounding a fraction would make the event legal while its BODY stays
          // un-hashable, and this is the one declaration ANY rank can author — so it is the
          // cheapest way to disable the whole room's protection layer.
          // SAFE integers, not merely integers: DCF's bound is Number.MAX_SAFE_INTEGER, and
          // Number.isInteger(1e21) is true. Matching the hash layer's contract EXACTLY is the
          // whole point — a near-miss here leaves the same silent hole open at the top of the range.
          const sec = (Number.isSafeInteger(cc.sec) && cc.sec > 0) ? cc.sec : null;
          if (sec === null) { _rej(ev, "unreadable-length"); continue; }
          if (decl.len[who]) { _rej(ev, "length-already-declared"); continue; }                     // one length per person per playing
          decl.len[who] = { sec: sec, tier: dTier };
        } else {
          // THE TYPED REASON (J06). Three cases, and the middle one is the whole point:
          //   `k` absent          -> ACCEPTED, reason null, counts toward no road. An older
          //                          client's declaration, so it cannot force a skip and the
          //                          change lands without breaking a room mid-flight.
          //   `k` a known token   -> ACCEPTED, and BLOCKED_REASONS decides whether it counts.
          //   `k` anything else   -> REJECTED, exactly as a bad `sec` is. Not accepted-and-ignored:
          //                          this value is folded into liveDecl and so into a checkpoint
          //                          seed, which `h` commits, and refusing here is what keeps an
          //                          unbounded string out of a hashed field.
          const hasK = cc.k !== undefined && cc.k !== null;
          if (hasK && !isBlockedReason(cc.k)) { _rej(ev, "unknown-block-reason"); continue; }
          if (decl.blocked[who] !== undefined) { _rej(ev, "block-already-declared"); continue; }   // one blocked per person per playing
          decl.blocked[who] = { tier: dTier, k: hasK ? cc.k : null };
        }

      } else if (ev.type === "ddjp.room.settings") {
        // Owner-only room settings. Channel origin is the proof (settings-owner
        // is stamped OWNER rank, whose power level is 99 — the ladder owns that
        // number and this comment must not restate it), so ignore any settings
        // event below Owner rank.
        // Last one in sorted order wins (last-write-wins): the owner posts the
        // FULL settings blob each time, so we just overwrite. Total: bad/missing
        // fields fall back to the current value, and an unknown value for a known
        // field is ignored (keeps the last valid one).
        if (!Ranks.permits(rank, "room.settings")) { _rej(ev, "not-permitted"); continue; }
        const s = c.s;
        if (!s || typeof s !== "object") { _rej(ev, "settings-not-an-object"); continue; }
        // ── ACCEPTED WHOLE, OR NOT AT ALL ────────────────────────────────────────────────
        // The comment that used to sit here said the pointer \"always names an event the reducer
        // actually honoured\", and set it three lines above the merge — so PASSING THE RANK GATE
        // was being read as BEING HONOURED. A blob whose values the merge refuses, in whole or in
        // part, still moved the pointer.
        //
        // That is not cosmetic, because the pointer is checked by REPLAYING the named event from
        // DEFAULTS (`settingsClaimVerdict`). If the event cannot stand alone as the account of the
        // room's settings, the replay produces settings the room never had and the verdict is
        // `mismatched` — which reads as tampering, and kills the forget licence at its last link.
        //
        // NO ATTACKER IS NEEDED. `minGate` and `vouchJitter` are validated as a PAIR and reverted
        // together, while each is individually inside its own SETTING_RANGES bound — so the panel,
        // which reads those bounds, offers both quite legitimately. An owner lowering minGate while
        // the jitter is high sends a complete, in-range, entirely reasonable blob that merges to
        // nothing. The room visibly ignores the edit; forgetting stops for good.
        //
        // So the event must REPRODUCE the settings it results in. This is the rule this file
        // already applies three times over — to the maxLen/minLen pair, to the minGate/vouchJitter
        // pair, and to both per-rank tables — applied to the blob as a whole: half a change landing
        // is worse than neither, because the result is a combination the owner never chose. What is
        // new is only that the pointer makes the cost of half-landing unbounded rather than local.
        const _merged = applySettingsEvent(settings, s);
        if (_canonSettings(applySettingsEvent(defaultSettings(), s)) !== _canonSettings(_merged)) {
          // REFUSED WHOLE, AND SILENTLY — nothing reports an event Matrix accepted and the fold
          // then refused, so the owner sees the panel re-render with the old values and no reason.
          // Deliberate trade (a lost edit is visible; a silently dead forget licence is not) and a
          // recorded open item: CONCEPTS.md Part 6 §14.
          _rej(ev, "settings-not-self-sufficient"); continue;    // not self-sufficient: refuse the whole event rather than the pointer
        }
        // Recorded only for an event that is BOTH owner-origin and fully honoured, so the pointer
        // means what its consumer assumes it means.
        settingsFrom = ev.eventId || null;
        settings = _merged;
      } else if (ev.type === "ddjp.dj.play" || ev.type === "ddjp.dj.skip" || ev.type === "ddjp.media.skip") {
        const prev = c.p ? c.p : null;
        const cur = nowPlaying ? nowPlaying.pi : null;
        if (!canAdvance(cur, prev)) { _rej(ev, "advance-locked"); continue; }        // advance lock (single-predicate seam)
        const isSkip = ev.type === "ddjp.dj.skip" || ev.type === "ddjp.media.skip";
        const manualSkip = ev.type === "ddjp.dj.skip";            // a person with rank, deliberately
        // THE ADVANCE GATE (Steps 7–10). An AUTOMATIC advance — a plain play, or an availability
        // skip — may not land before the song plausibly ended. Judged ENTIRELY on committed server
        // stamps and folded numbers, never a live clock: this play's own ev.ts (server-assigned,
        // unforgeable) versus the CURRENT song's start + gate. Every client computes the identical
        // verdict whenever it replays, so delivery lag and clock drift cannot change it. A too-early
        // play is rejected on every client alike — which is what makes relabelling a skip as a play
        // grief-proof WITHOUT needing rank.
        //   • minGate floor always applies, so even a 3-second song waits for the ordered cascade;
        //     without it a short song's honest and grief advances are indistinguishable.
        //   • agreed length − grace applies once a length is folded. The agreed length is the
        //     RANK/MAJORITY/CLAMP cascade (see gateLengthSec), not the longest claim: reading the
        //     longest defends only against lying short and is defenceless against lying long.
        //   • a MANUAL skip waives the floor — a named person with rank ending the song early IS
        //     the feature, gated by rank just below. The waiver keys on the TYPE being ddjp.dj.skip,
        //     so a mislabelled play can never claim it (a play is never a manual skip).
        if (nowPlaying && !manualSkip) {
          const set = nowPlaying.settings || settings;
          const started = nowPlaying.startedAt || 0;
          const nowTs = (typeof ev.ts === "number") ? ev.ts : 0;
          const minGate = (typeof set.minGate === "number") ? set.minGate : 8000;
          const grace = (typeof set.graceMs === "number") ? set.graceMs : 1000;
          // gateLen = the well-supported, maxLen-capped length for THIS playing (see
          // gateLengthSec). Scanned from the log here rather than read from the (later)
          // declaration pass, but computed by the SAME helper so the two cannot disagree.
          const maxLenGate = (typeof set.maxLen === "number") ? set.maxLen : 0;
          const minLenGate = (typeof set.minLen === "number") ? set.minLen : 0;
          // PREFIX ONLY. `decl` was accumulated by this same loop, so it contains exactly the
          // declarations that sort before this advance - never one that arrives after it.
          const gEntries = [];
          if (decl && decl.pi === nowPlaying.pi) {
            for (const u in decl.len) gEntries.push({ sec: decl.len[u].sec, tier: decl.len[u].tier });
          }
          const gl = gateLengthSec(gEntries, minLenGate, maxLenGate);
          const lenFloor = gl ? (started + gl * 1000 - grace) : 0;
          const gate = Math.max(started + minGate, lenFloor);
          if (started > 0 && nowTs > 0 && nowTs < gate) {
        _rej(ev, "too-early", { earliestAt: gate, atTs: nowTs, shortBySec: Math.round((gate - nowTs) / 1000) });
        continue;
      }   // too early — reject on every client

        }
        // ddjp.media.skip is the availability escape: the ROOM derived that enough of it is
        // blocked (a skip road met). It is NOT an individual's authority call, so it needs no
        // rank — a room with no VIPs must still escape a dead song. What authorises it is the
        // TALLY, recomputed here from the blocked declarations for this playing, so the author
        // cannot simply assert it. If no road is met, the skip is rejected on every client.
        if (ev.type === "ddjp.media.skip" && nowPlaying) {
          // FROZEN AT SONG START, like every other per-song dial (maxLen/minGate/graceMs/presendMs):
          // the rules for a song are the ones in force when it started. Read live, a mid-song
          // settings change would re-govern the running song and the frozen snapshot would be a lie.
          const setR = nowPlaying.settings || settings;
          const roads = Array.isArray(setR.skipRoads) ? setR.skipRoads : [];
          const gTier = Ranks.tierOf("guest"), vTier = Ranks.tierOf("vip");
          let ng = 0, nv = 0;
          // PREFIX ONLY - same accumulator, same guarantee as the length gate above.
          if (decl && decl.pi === nowPlaying.pi) {
            for (const u in decl.blocked) {
              const b = decl.blocked[u];
              // ONE TALLY, WRITTEN TWICE — see the `advance` view below, which counts the same
              // thing to decide whether anybody ever AUTHORS this event. A reason filter added
              // here and not there (or the reverse) is F3 with a new cause, and neither direction
              // has an error path: the generous view has every client authoring an escape every
              // client refuses, forever; the generous reducer means nobody authors and this
              // willingness is never exercised. Held by `check-blocked-reason` PART C.
              if (!blockedReasonCounts(b.k)) continue;   // my end, or untyped — not the room's problem
              if (b.tier <= gTier) ng++;
              if (b.tier <= vTier) nv++;
            }
          }
          let met = false;
          for (const r of roads) if (ng >= (r.guestPlus || 0) && nv >= (r.vipPlus || 0)) { met = true; break; }
          // THE VALUES THAT DECIDED, not just the verdict. `no-road-met` on its own is a shorter
          // version of the message this job removed — TOO EARLY is the standard because it names
          // the gate AND the numbers, so this names every road the room offers and what was
          // actually counted against each.
          if (!met) {
            _rej(ev, "no-road-met", { roads: roads.slice(), guests: ng, vips: nv });
            continue;
          }   // no road satisfied — the room did not authorise this
        }
        // A MANUAL skip (ddjp.dj.skip) of someone else's song is the authority path and needs the
        // rank gate — that is the feature, distinct from the derived availability escape above.
        if (manualSkip && nowPlaying && user !== nowPlaying.dj && !Ranks.permits(rank, "dj.skip.others")) { _rej(ev, "not-permitted"); continue; }
        const order = visible();
        // ── THE OUTGOING PLAYING IS MARKED BEFORE IT IS REPLACED ─────────────────────────────
        // A row is pushed when a song STARTS, so by the time an advance is judged the row for the
        // song being ended is already in `history`. This is where the reason on the ending event
        // reaches it. Marked only for a skip that names a token this build knows — an unknown one
        // degrades to an ordinary skip rather than refusing the advance (see `SKIP_REASONS`).
        //
        // BY `pi`, NOT BY POSITION. The row is found by the play instance it belongs to rather
        // than by assuming it is the last one, because that assumption is exactly the kind that
        // holds until a fold path arrives that pushes something else in between.
        //
        // AND IT SITS ABOVE THE NEXT-SONG RESOLUTION, WHICH IS WHERE IT DID NOT SIT FIRST. Placed
        // beside the new `nowPlaying`, it never ran when the skip emptied the room — `!head` takes
        // its own `continue` a line below — so a repeat-skip that ended the last song left the row
        // unmarked and that cut-short playing went on counting as a real play. Found by mutation:
        // widening the token test to accept anything left the guard GREEN, because its fixture ran
        // out of songs at exactly that advance. The marking is about the playing that ENDED, and
        // nothing about whether another one begins.
        if (isSkip && nowPlaying && nowPlaying.pi && isSkipReason(c.k)) {
          for (let hi = history.length - 1; hi >= 0; hi--) {
            if (history[hi] && history[hi].pi === nowPlaying.pi) { history[hi].endedBy = c.k; break; }
          }
        }
        const head = order.length > 0 ? order[0] : null;
        // ── THE ROOM EMPTIES, AND THAT IS SOMETHING HAPPENING ────────────────────────────────
        // No head means the last DJ played their last buffered song and fell out, so this advance
        // ends the music. There is nothing to start, hence the `continue` — but the event CHANGED
        // THE ROOM, and `nowPlaying` going null is exactly that change.
        //
        // This line used to read `{ nowPlaying = null; { _rej(ev); continue; } }` — the doubled
        // braces being the fingerprint of a mechanical pass that wrapped every top-level
        // `continue` with `_rej(ev)`. Of 47 rejection sites this was the only one that MUTATED
        // before rejecting, and the only one written that way. Its four neighbours (dj.join's
        // `_hadSongs`, dj.declare's `_before`, dj.move's `_keyBefore`, count.set's
        // baseline-already-in-force test) each save a before-value and reject only when nothing
        // moved. So this was not a case the pass missed: it was the rule INVERTED, at the one site
        // where the state change is the entire point.
        //
        // WHAT THE REJECTION COST, and the two halves are the same fact. Legality is what
        // `Vouch.eligible` spends protection on, so an event that cannot be accepted cannot be
        // vouched — this was simultaneously the one event in the room nobody could ever rebuild,
        // and the event whose disappearance forks everyone who reloads afterwards. `_countable`
        // skipped it too, so it never counted toward the seal cadence, while the checkpoint seed
        // moved anyway because `nowPlaying` did.
        //
        // AND THE FORK IS UNDETECTABLE IN PRINCIPLE, WHICH IS WHY PROTECTION IS THE ONLY DEFENCE.
        // The advance lock is `head === claimedPrev`, so once the room is empty the next play
        // names `p: null` — what genesis names. Nothing ever chains onto this event, so
        // `Continuity.missingParents` has no parent to find and both sides read as whole. A client
        // that missed it holds its old head permanently and correctly refuses every later advance,
        // through reloads; only adopting a checkpoint rescues it. Nothing will ever NOTICE this
        // event is gone, so the repair has to happen because somebody vouched it in advance.
        //
        // Accepting is one deleted token: `acceptedIds` is built by walking the handled types and
        // skipping only what `_rejected` names, so acceptance is the default and there is no
        // accept call to add. Null-safety downstream was checked rather than assumed — all three
        // readers of the banked parent take `(sd && sd.nowPlaying && sd.nowPlaying.pi) || null`,
        // `missingParents` follows only non-empty string parents, and the seeded fold guards
        // `seed.nowPlaying` being an object. See 09-roadmap.md J04 and CONCEPTS.md Part 6 §15.
        if (!head) { nowPlaying = null; continue; }
        const song = members[head].pending.shift();
        // Snapshot the settings IN FORCE AT THIS LOG POSITION onto the song. Because we
        // fold in sorted order, `settings` already reflects every settings event before
        // this play and none after — so this is exactly "the rules when the song started".
        // A later settings change overwrites `settings` but NOT this frozen copy, giving
        // keep-start-settings for free (the ceiling/threshold read np.settings, not live).
        // Shallow copy is safe: settings holds only primitives.
        const settingsAtStart = Object.assign({}, settings);
        // ...and WHICH event those frozen values came from. "What governed this song" is otherwise
        // an unverifiable claim the moment the settings event falls below a forget floor.
        nowPlaying = { dj: head, song: song, pi: ev.eventId, startedAt: ev.ts ? ev.ts : 0, skipped: isSkip,
                       settings: settingsAtStart, settingsFrom: settingsFrom };
        // PRUNE. The advance that ended the previous pi has just been judged, so its declarations
        // can never influence anything again — their legality is already recorded in the accepted
        // set. Dropping them here is what keeps the accumulator bounded by participants rather
        // than by log length, and keeps the checkpoint seed's liveDecl section small.
        decl = _freshDecl(ev.eventId);
        if (song && song.videoId && ev.eventId) piToVid[ev.eventId] = song.videoId;   // for the counts pass
        if (ev.eventId) piToDj[ev.eventId] = head;                                     // DJ of this instance (voteEligible seam)
        pushHistory(nowPlaying);   // a song actually started → it played (Room History)
        // Hard fall-out: if that was the DJ's last buffered song, they've run
        // out and are removed from the rotation entirely — running out of songs
        // means leaving the queue. They must send a fresh ddjp.dj.join to
        // re-enter (re-entering at the back). A DJ who still has a second
        // buffered song stays in and rotates to the back as normal.
        if (members[head].pending.length === 0) {
          delete members[head];
        } else {
          members[head].orderKey = ++tick;           // still has songs — rotate to the back
        }
      }
    }

    // --- COUNTS PASS (per-PLAYING distinct voters/savers + owner set-absolute adjustment) ---
    // Second pass over the SAME sorted log, so a vote is attributable even if it shares an `l`
    // with its play. Per (PLAY INSTANCE, kind): distinct organic actors, deduped by user; an owner
    // `ddjp.count.set { k, id, n }` sets an ABSOLUTE baseline for the playing it names and resets
    // that playing's organic set — organic votes/saves that sort AFTER it add on top. Latest set
    // wins (we just overwrite as we go in sorted order). Owner-gated by channel rank; a forged set
    // below Owner is ignored here (not merely in the UI). Deterministic + convergent: same result
    // for every arrival order (guarded).
    //
    // ── THE INSTANCE, NOT THE SONG ────────────────────────────────────────────────────────────
    // This used to resolve `piToVid[c.p]` and tally against the VIDEO ID, which threw away the
    // one thing the voter actually reacted to. A playing is its own event in the life of a room —
    // its own slot in the history, its own DJ, its own start, its own skipped-or-not — and every
    // other part of this reducer already treated it that way. The counts were the exception, and
    // two things fell out of it:
    //   · a song played a second time opened carrying the first playing's votes, which is a
    //     figure about a different moment
    //   · a listener who voted the first time could vote again — the affordance is keyed on the
    //     instance and correctly unlatches — and the dedup set, keyed on the song, silently
    //     absorbed it. The event was accepted by this reducer and paid for by the vouch layer,
    //     and moved nothing. A legal event that changes nothing is the shape this codebase is
    //     built to refuse.
    // The instance was in the event body the whole time; `c.p` names it.
    const _cnt = Object.create(null);   // pi -> { v:{base,set,users:Set}, s:{base,set,users:Set} } (null-proto: the pi is attacker-controlled)
    function _bucket(vid) {
      if (!_cnt[vid]) _cnt[vid] = { v: { base: 0, set: false, users: new Set() }, s: { base: 0, set: false, users: new Set() } };
      return _cnt[vid];
    }
    // ── seed the counts accumulator from the checkpoint's LEDGER SECTION ──
    // The optional counts section carries, for the LIVE PLAYING: the base totals, whether an
    // owner set-absolute is in force, AND the dedup user sets — so a repeat vote from someone
    // already counted BEFORE the checkpoint is still deduped after it. Absent section → counts
    // restart. Scoped to the live playing because that is the only one a later event can still
    // add to; see the note on the ledger in the seed below.
    if (seed && seed.ledger && seed.ledger.counts && typeof seed.ledger.counts === "object") {
      for (const vid in seed.ledger.counts) {
        const src = seed.ledger.counts[vid]; if (!src) continue;
        const b = _bucket(vid);
        if (src.v) { b.v.base = src.v.base || 0; b.v.set = !!src.v.set; b.v.users = new Set(Array.isArray(src.v.users) ? src.v.users : []); }
        if (src.s) { b.s.base = src.s.base || 0; b.s.set = !!src.s.set; b.s.users = new Set(Array.isArray(src.s.users) ? src.s.users : []); }
      }
    }
    for (const ev of list) {
      if (!ev || typeof ev.type !== "string") { _rej(ev, "unhandled-shape"); continue; }
      const c = ev.content || {};
      if (ev.type === "ddjp.dj.vote" || ev.type === "ddjp.dj.save") {
        const u = ev.sender || (c.sender ? c.sender : null);
        const pi = c.p;
        // The playing must be one this fold actually SAW start — piToVid is the record of that.
        // A vote naming a play instance that never became a playing (a rejected play has an event
        // id but never a song) is still refused, exactly as before; what changed is only WHAT the
        // accepted ones are tallied against.
        if (!u || typeof pi !== "string" || !piToVid[pi]) { _rej(ev, "unknown-play-instance"); continue; }
        if (!voteEligible(u, piToDj[pi] || null, rankOf(ev))) { _rej(ev, "vote-not-eligible"); continue; }   // SEAM: pass-through today (rank-gate / self-vote plug in here)
        _bucket(pi)[ev.type === "ddjp.dj.vote" ? "v" : "s"].users.add(u);
      } else if (ev.type === "ddjp.count.set") {
        if (!Ranks.permits(rankOf(ev), "count.set")) { _rej(ev, "not-permitted"); continue; }         // owner-only, by channel origin
        // `id` NAMES A PLAYING now, not a song. An owner adjusting one playing used to restate
        // every other playing of the same video at the same time, silently.
        const vid = c.id;
        const kind = c.k === "vote" ? "v" : (c.k === "save" ? "s" : null);
        if (typeof vid !== "string" || !vid || !kind) { _rej(ev, "no-video-id"); continue; }
        const n = (typeof c.n === "number" && isFinite(c.n) && c.n >= 0 && Math.floor(c.n) === c.n) ? c.n : null;
        if (n === null) { _rej(ev, "not-a-count"); continue; }                       // only a non-negative integer sets
        const b = _bucket(vid)[kind];
        // Re-stating a baseline already in force, with no organic tally to clear, moves nothing.
        // count.set is display-level so no protection is spent on it either way — recorded for
        // the same reason as its siblings: a legal event that changes nothing is a shape this
        // reducer refuses, and leaving one exception invites the next reader to add another.
        if (b.set && b.base === n && b.users.size === 0) { _rej(ev, "count-unchanged"); continue; }
        b.base = n; b.set = true; b.users = new Set();   // absolute baseline; organic resumes on top
      }
    }
    const counts = Object.create(null);   // null-proto: keyed by attacker-controlled play-instance id
    for (const vid in _cnt) {
      const c = _cnt[vid];
      counts[vid] = {
        votes: c.v.base + c.v.users.size,
        saves: c.s.base + c.s.users.size,
        votesAdjusted: c.v.set,
        savesAdjusted: c.s.set,
      };
    }

    // ── HISTORY DOES NOT CARRY THE FIGURES, AND A GUARD IS WHY ───────────────────────────────
    // Attaching votes/saves onto each history row was the first attempt, and check-reactions
    // refused it: "vote/save must not change history". That rule is right and worth keeping. A
    // history row is the record of WHAT PLAYED — song, DJ, when, skipped-or-not — and a reaction
    // changes none of it. Writing the tally onto the row makes a vote mutate the record of the
    // past, and puts the same number in two places in derived state, which is the drift this
    // project keeps having to delete.
    //
    // The join is free instead: both tables key on the play instance, so `counts[row.pi]` is that
    // row's own figures, and two rows for one video give two different answers. The renderer does
    // it, which is where a display join belongs.

    const rotation = visible().map(u => ({ user: u, pending: members[u].pending.slice() }));

    // --- THE ADVANCE VIEW (Steps 7-10) -------------------------------------------------
    // Read-only projection of the live accumulator that the main loop already built. There is
    // no second pass and no rescan: `decl` holds one entry per sender for the live pi, deduped
    // and legality-checked at fold time. This block only SHAPES that for the transport/UI —
    // it is never read for truth (the reducer's gate on the NEXT play is the truth).
    let advance = null;
    if (nowPlaying && nowPlaying.pi) {
      const pi = nowPlaying.pi;
      const guestTier = Ranks.tierOf("guest"), vipTier = Ranks.tierOf("vip");
      const live = (decl && decl.pi === pi) ? decl : _freshDecl(pi);

      // ONE AGREED LENGTH, used for both the gate and the progress bar so they can never
      // disagree: highest rank wins, majority within that rank, a stalemate cascades down, and
      // min/max always clamp. See gateLengthSec.
      const lenList = [];
      for (const u in live.len) lenList.push(live.len[u]);
      let gateLen = null, displayLen = null;
      if (lenList.length) {
        const maxLenSec = (nowPlaying.settings && typeof nowPlaying.settings.maxLen === "number")
          ? nowPlaying.settings.maxLen : (typeof settings.maxLen === "number" ? settings.maxLen : 0);
        const minLenSec = (nowPlaying.settings && typeof nowPlaying.settings.minLen === "number")
          ? nowPlaying.settings.minLen : (typeof settings.minLen === "number" ? settings.minLen : 0);
        gateLen = gateLengthSec(lenList, minLenSec, maxLenSec);
        displayLen = gateLen;
      }

      // AVAILABILITY ROADS — distinct blocked users per rank band. guest+ = tier <= guest;
      // vip+ = tier <= vip. A road fires when ALL its non-zero requirements are met; ANY road
      // fires the skip. Uncategorized (weakest tier) is in no band, so it can reach no road.
      // THE SECOND COPY OF THE TALLY. It must reach the same verdict as the reducer's
      // re-validation of `ddjp.media.skip` above, on BOTH axes — the rank band and the typed
      // reason. `check-tier-inclusive` owns the rank axis; `check-blocked-reason` owns the reason
      // axis and the agreement across it.
      let blockedGuestPlus = 0, blockedVipPlus = 0;
      for (const u in live.blocked) {
        const b = live.blocked[u];
        if (!blockedReasonCounts(b.k)) continue;   // untyped or local-only: reported, not counted
        if (b.tier <= guestTier) blockedGuestPlus++;
        if (b.tier <= vipTier) blockedVipPlus++;
      }
      // FROZEN at song start, matching the reducer's own media.skip authorisation.
      const setR = nowPlaying.settings || settings;
      const roads = Array.isArray(setR.skipRoads) ? setR.skipRoads : [];
      let roadMet = false;
      for (const r of roads) {
        if (blockedGuestPlus >= (r.guestPlus || 0) && blockedVipPlus >= (r.vipPlus || 0)) { roadMet = true; break; }
      }

      const started = nowPlaying.startedAt || 0;
      const set = nowPlaying.settings || settings;
      const minGate = (typeof set.minGate === "number") ? set.minGate : 8000;
      const grace = (typeof set.graceMs === "number") ? set.graceMs : 1000;
      const maxLen = (typeof set.maxLen === "number") ? set.maxLen : 600;
      const lenFloor = gateLen ? (started + gateLen * 1000 - grace) : 0;
      advance = {
        pi: pi,
        startedAt: started,
        gateLenSec: gateLen,
        displayLenSec: displayLen,
        earliestAt: Math.max(started + minGate, lenFloor),
        ceilingAt: started + maxLen * 1000,
        blockedGuestPlus: blockedGuestPlus,
        blockedVipPlus: blockedVipPlus,
        skipWarranted: roadMet,
      };
    }

    // Build the checkpoint SEED from the SAME fold (carry-forward accumulators only), so it
    // can never disagree with the derived state. History/rotation are recomputed, not seeded.
    const seedOut = {
      members: (() => { const o = {}; for (const u in members) o[u] = { pending: members[u].pending.map((s) => ({ videoId: s.videoId, videoUrl: s.videoUrl != null ? s.videoUrl : null })), orderKey: members[u].orderKey }; return o; })(),
      settings: Object.assign({}, settings),
      settingsFrom: settingsFrom,
      tick: tick,
      nowPlaying: nowPlaying ? {
        dj: nowPlaying.dj, pi: nowPlaying.pi, startedAt: nowPlaying.startedAt, skipped: !!nowPlaying.skipped,
        song: nowPlaying.song ? { videoId: nowPlaying.song.videoId, videoUrl: nowPlaying.song.videoUrl != null ? nowPlaying.song.videoUrl : null } : null,
        settings: nowPlaying.settings ? Object.assign({}, nowPlaying.settings) : null,
        settingsFrom: nowPlaying.settingsFrom != null ? nowPlaying.settingsFrom : null,
      } : null,
      // LEDGER SECTION (Phase 9): the grow-only counts + their dedup user sets, so vote/save
      // totals survive a forget. Serialized (Sets → arrays). This is the owner-bot section —
      // a peer/core checkpoint may omit it; only owner-channel checkpoints need carry it
      // (checkpoint-contents §4a). Kept SEPARATE from the core so the flat queue seed stays tiny.
      // THE LIVE DECLARATIONS. A carry-forward accumulator by checkpoint-contents.md 1's
      // own test: the reducer needs it to judge the NEXT advance correctly and cannot recompute
      // it from the other sealed fields. Live pi ONLY — off-air declarations are dead, exactly
      // like off-air piToVid/piToDj. Without this, derive(seed, after) accepts an advance that
      // derive(genesis) rejects, and the forget path diverges.
      liveDecl: (nowPlaying && nowPlaying.pi && decl && decl.pi === nowPlaying.pi) ? (() => {
        const L = {}, B = {};
        for (const u in decl.len) L[u] = { sec: decl.len[u].sec, tier: decl.len[u].tier };
        // THE REASON IS PART OF THE CARRY-FORWARD VALUE, not an annotation on it (J06).
        // checkpoint-contents.md §0's test decides it: the advance that ends the current song is
        // judged against the road tally, the tally now reads the reason, and nothing else in the
        // seed can reproduce it. Seal the tier without the reason and a seeded fold counts
        // reporters a genesis fold discards — an advance accepted by a client that forgot behind
        // the checkpoint and refused by one that did not, which is the §4.3 divergence exactly.
        //
        // THIS CHANGES THE SEED SHAPE, AND THEREFORE EVERY CHECKPOINT'S FINGERPRINT. Expect the
        // window README.md describes on any seed-shape change: existing checkpoints are
        // unverifiable here, and a room holds no floor and forgets nothing until it has sealed TWO
        // fresh ones, because a quorum cannot chain below two.
        for (const u in decl.blocked) B[u] = { tier: decl.blocked[u].tier, k: decl.blocked[u].k };
        return { pi: decl.pi, len: L, blocked: B };
      })() : null,
      // ── THE LIVE PLAYING ONLY ────────────────────────────────────────────────────────────
      // Counts are per PLAYING now, and sealing them all would grow the seed by one entry for
      // every song the room has ever played — for ever. A checkpoint is specified to stay small
      // however old the room is, which is what makes it cheap enough for everyone to carry, so
      // that is not a trade available here.
      //
      // The same test liveDecl passes, applied to the same question: does the reducer need this
      // as a starting point to judge the NEXT event? The live playing's tally does — a vote can
      // still arrive for it after the cut and must dedup against what came before. An off-air
      // playing's cannot: nothing further will ever be counted against it. So off-air counts are
      // recomputed from the log while it is held, and are gone below a forget floor — which is
      // the category history is already in, and is display data about something that has already
      // happened rather than anything the room computes from.
      ledger: {
        counts: (() => {
          const o = {};
          const live = (nowPlaying && nowPlaying.pi) ? nowPlaying.pi : null;
          const c = live ? _cnt[live] : null;
          if (c) {
            o[live] = {
              v: { base: c.v.base, set: c.v.set, users: Array.from(c.v.users) },
              s: { base: c.s.base, set: c.s.set, users: Array.from(c.s.users) },
            };
          }
          return o;
        })(),
      },
    };
    // The LEGAL set: handled type, and the fold did not reject it. Returned ALONGSIDE
    // state (never inside it) so nothing here can move a checkpoint fingerprint.
    const acceptedIds = [];
    for (const ev of list) {
      const id = _idOf(ev);
      if (!id) continue;
      if (HANDLED_TYPES.indexOf(ev.type) < 0) continue;
      if (_rejected[String(id)]) continue;
      acceptedIds.push(String(id));
    }
    // REFUSALS RIDE BESIDE `accepted`, for the same reason and through the same channel.
    return { state: { nowPlaying, rotation, settings, history, counts, advance }, seed: seedOut,
             accepted: acceptedIds, refusals: _refusals };
  }

  // PUBLIC derive: unchanged contract — returns just the derived state. Optional seed
  // (checkpoint-contents §1) lets it start from a checkpoint instead of genesis.
  function derive(orderedEvents, seed) { return _deriveFull(orderedEvents, seed).state; }

  // deriveAccepted: the same fold, returning ONLY the ids the reducer accepted — the
  // events that are actually part of the timeline. This is the vouch layer's notion of
  // "legal": protection is spent on history that happened, never on a well-formed
  // message that changed nothing. Pure; same fold as derive, so the two cannot disagree.
  function deriveAccepted(orderedEvents, seed) { return _deriveFull(orderedEvents, seed).accepted; }
  // deriveRefusals: the same fold, returning ONLY why each refused event was refused. Diagnostic
  // output — it rides beside the state and never inside it, exactly as `accepted` does, so no
  // reason can move a checkpoint fingerprint.
  function deriveRefusals(orderedEvents, seed) { return _deriveFull(orderedEvents, seed).refusals; }
  // BOTH IN ONE PASS. `derive` and `deriveAccepted` are thin wrappers over the same fold, each
  // discarding what the other wanted — so a caller that needs both (StreamManager, on every
  // ingested event) was folding the whole log twice for identical work.
  function deriveBoth(orderedEvents, seed) {
    const r = _deriveFull(orderedEvents, seed);
    return { state: r.state, accepted: r.accepted };
  }

  // buildSeed: fold the (optionally seeded) log and return ONLY the checkpoint seed — the
  // carry-forward accumulators a checkpoint must seal. Pure; same fold as derive, so the
  // seed matches the state exactly. The release gate (check-checkpoint-seed) proves:
  //   derive(buildSeed(events_up_to_N), events_after_N) === derive(all_events).

  // PURE: apply ONE ddjp.room.settings event's blob onto a settings object, returning a new one.
  // Extracted from the reducer rather than copied, and that is the whole point. Verifying a
  // checkpoint's settings claim means recomputing what the named event produces and comparing —
  // and a verifier carrying its OWN copy of these ~130 range checks would drift from the reducer
  // the first time a dial was added, then quietly disagree about rooms that were always fine.
  // Two hand-maintained copies of one rule is the failure docs/paths.md §7 records twice.
  // Rank is NOT checked here: this answers 'what does this blob mean', not 'may this author say
  // it'. The caller owns that question — the reducer via Ranks.permits, the verifier by only ever
  // asking about an event the seed already named. Exposed for the guard and for verification.
  function applySettingsEvent(base, s) {
    const settings = Object.assign({}, (base && typeof base === "object") ? base : defaultSettings());
    if (!s || typeof s !== "object") return settings;
    // THREE TIERS, NOT TWO. chat-staff is created in batch 3 and the docs describe it as selectable;
    // the reducer was the only thing that never accepted it, so an owner could see the channel exist
    // and never be able to point the room at it. Adding the value is strictly less work than paying
    // batch 3's creation cost in order to delete the feature.
    if (s.chat === "uncategorized" || s.chat === "guest" || s.chat === "staff") settings.chat = s.chat;
    if (s.vis === "public" || s.vis === "private") settings.vis = s.vis;
    // THE MIN-DJ-RANK BAR (J07). Validated by MEMBERSHIP against SETTING_RANGES' own value set —
    // which is `Ranks.NAMES` — rather than by an inline list of names like `chat` two lines up.
    // The panel reads the same entry, so the two cannot offer different vocabularies. TOTAL like
    // every setting here: an unknown name, a power LEVEL passed as a number, or a missing key keeps
    // the current value. A level is refused rather than translated on purpose — accepting `40`
    // would make the wire carry two spellings of one bar, and `_canonSettings` would then compare
    // unequal for two rooms that agree.
    if (_inValues("minDjRank", s.minDjRank)) settings.minDjRank = s.minDjRank;
    // bg: an owner-set room-background image LINK (text only — the image
    // itself is fetched client-side from the host, never over Matrix, the
    // same as a video id). A non-empty string sets it; null or "" clears it;
    // any other type is ignored (keeps the current value, matching chat/vis).
    // Host/format are deliberately NOT validated here: derive stays permissive
    // and total. The feature-layer load gate re-validates the host allowlist
    // before ever fetching the bytes, so a malformed or hostile link can be
    // derived but can never cause a load.
    if (typeof s.bg === "string") settings.bg = s.bg ? s.bg : null;
    else if (s.bg === null) settings.bg = null;
    // Blocked-content dials (Phase 2), all range-checked and TOTAL: a bad/missing
    // value keeps the current one. These are read at LOG POSITION — a play snapshots
    // the settings in force when it starts (see nowPlaying.settings below), so an
    // owner changing maxLen mid-song does NOT re-govern the running song (keep-start).
    // maxLen / minLen are RELATED: a ceiling below the floor is nonsense, so they
    // are resolved TOGETHER. Each is range-checked on its own first, then the
    // resulting PAIR must be sane — which is what lets a legal simultaneous change
    // through (judging each against the OTHER's old value would reject it). If the
    // proposed pair is inverted, BOTH keep their current values rather than half of
    // the change applying, the same all-or-nothing rule the tables use.
    {
      let _minLen = settings.minLen, _maxLen = settings.maxLen;
      if (_inRange("minLen", s.minLen)) {
        _minLen = s.minLen;   // already a safe integer — _inRange refuses anything else
      }
      if (_inRange("maxLen", s.maxLen)) {
        _maxLen = s.maxLen;   // already a safe integer — _inRange refuses anything else
      }
      if (_maxLen >= _minLen) { settings.minLen = _minLen; settings.maxLen = _maxLen; }
    }
    // Advance-gate dials — each range-checked and TOTAL (a bad value keeps the current one).
    // ── minGate AND vouchJitter ARE A PAIR ──────────────────────────────────────────────────
    // The reducer's own note on minGate says it must comfortably exceed the full stagger ladder,
    // and nothing enforced it. That left two ways to break the advance gate from the settings
    // panel: set minGate below the ladder, so a whole rank's slot opens before any advance is
    // legal; or set it to 0, which the range permits outright and which makes a song advanceable
    // one millisecond in — not eight seconds of music, none.
    //
    // Validated together and reverted together, exactly like maxLen/minLen above and for the same
    // reason: half of an inconsistent pair landing is worse than neither, because the result is a
    // combination the owner never chose. The width is DERIVED from the ladder rather than written
    // here, so adding a rank or widening the step moves this bound with it.
    {
      let _minGate = settings.minGate, _jitter = settings.vouchJitter;
      if (_inRange("minGate", s.minGate)) _minGate = s.minGate;
      if (_inRange("vouchJitter", s.vouchJitter)) _jitter = s.vouchJitter;
      // Every rank's slot, plus the half-step jitter window the last one draws from.
      const ladderMs = (Ranks.LADDER.length * _jitter) + Math.floor(_jitter / 2);
      if (_minGate >= ladderMs) { settings.minGate = _minGate; settings.vouchJitter = _jitter; }
    }
    if (_inRange("graceMs", s.graceMs)) {
      settings.graceMs = s.graceMs;
    }
    if (_inRange("presendMs", s.presendMs)) {
      settings.presendMs = s.presendMs;
    }
    // Skip roads: accepted only as a COMPLETE, well-formed list (1–8 roads), each a non-negative
    // pair, else the whole list is dropped rather than half-applied. `guestPlus`/`vipPlus` are
    // distinct-user thresholds; 0 means "this rank band is not required by this road".
    if (Array.isArray(s.skipRoads) && s.skipRoads.length >= 1 && s.skipRoads.length <= 8) {
      const roads = [];
      let ok = true;
      for (const r of s.skipRoads) {
        if (!r || typeof r !== "object") { ok = false; break; }
        const g = r.guestPlus, v = r.vipPlus;
        // Integers only — see _inRange: a fraction here is un-hashable and would poison vouching.
        const gOk = Number.isSafeInteger(g) && g >= 0 && g <= 200;
        const vOk = Number.isSafeInteger(v) && v >= 0 && v <= 200;
        if (!gOk || !vOk || (g === 0 && v === 0)) { ok = false; break; }   // a road requiring nothing is nonsense
        roads.push({ guestPlus: g, vipPlus: v });
      }
      if (ok) settings.skipRoads = roads;
    }
    // ── Vouching / checkpoint / trust dials ────────────────────────────────────────────
    // Range-checked + TOTAL (anything bad or missing keeps the current value). Judged at LOG
    // POSITION like every setting, so a change only governs decisions made after it. Behaviour
    // only — never read for truth — but derived here so every client shares identical values.
    // vouchJitter is NOT assigned here. It is half of the minGate pair above — a jitter wide
    // enough to push the stagger ladder past the advance gate is refused, and refusing half a pair
    // means neither value moves. Assigning it a second time here would let it through alone and
    // silently defeat that.
    if (_inRange("receiptsPerMessage", s.receiptsPerMessage)) {
      settings.receiptsPerMessage = s.receiptsPerMessage;
    }
    if (_inRange("checkpointCooldownMs", s.checkpointCooldownMs)) {
      settings.checkpointCooldownMs = s.checkpointCooldownMs;
    }
    if (_inRange("checkpointEvery", s.checkpointEvery)) {
      settings.checkpointEvery = s.checkpointEvery;
    }
    if (_inRange("checkpointRankOffsetMs", s.checkpointRankOffsetMs)) {
      settings.checkpointRankOffsetMs = s.checkpointRankOffsetMs;
    }
    if (typeof s.selfWitnessCheckpoint === "boolean") {
      settings.selfWitnessCheckpoint = s.selfWitnessCheckpoint;
    }
    // The two TABLES. A table is accepted only as a COMPLETE, well-formed set of rows (one per
    // rank) — a partial or malformed table is dropped wholesale rather than merged, so a room
    // can never end up half on a new policy and half on the old one. Each row's `enough` is a
    // count >= 1 or null ("this rank can never satisfy on its own"); `always` is a plain flag.
    // A TABLE IS ACCEPTED ONLY IF IT IS COMPLETE. There used to be a migration pad here: a six-row
    // table had the default guest row spliced in before uncategorized, so tables written by the
    // pre-ladder panel still applied. That pad is gone, deliberately — it was the second half of the
    // defect it was compensating for. The panel posted six values, the pad made six look like seven,
    // and the sixth value landed on uncategorized; one owner click editing VIP flipped the bottom
    // rung from "never" to a countable number.
    //
    // The consequence is accepted rather than mitigated: every table edit ever made through the old
    // panel was six rows, so on replay those events are now INERT and the room falls back to the
    // defaults in Ranks. That is only safe because those defaults are STRICTER than anything the old
    // panel could have left behind at the bottom rungs — player, guest and uncategorized are all
    // "never" — so a room that loses its stored settings gets tighter than its owner intended, never
    // looser. The owner re-saves once; nothing is quietly weakened in between.
    function _rows(v, withAlways) {
      if (!Array.isArray(v)) return null;
      if (v.length !== Ranks.TIER_COUNT) return null;
      const out = [];
      for (const row of v) {
        if (!row || typeof row !== "object") return null;
        const e = row.enough;
        const okEnough = (e === null) || (Number.isSafeInteger(e) && e >= 1 && e <= 50);   // safe integers only
        if (!okEnough) return null;
        const r = { enough: e };
        if (withAlways) r.always = (row.always === true);
        // NOTE: the old owner-row `selfCounts` flag is gone. The owner exemption is no
        // longer a counting rule that a room could switch off — it follows from who can
        // delete what, so it is decided by channel origin and is not settable.
        out.push(r);
      }
      return out;
    }
    // Accept a delegation blob or refuse it entirely. Returns a FRESH object so a caller cannot
    // retain a reference into derived state, the same discipline `_rows` follows.
    function _delegationMap(v) {
      if (!_isValidMap("botDelegation", v)) return null;
      const out = {};
      // Sorted so two rooms that agree produce byte-identical canonical forms — `_canonSettings`
      // compares these and key order would otherwise make agreeing rooms disagree.
      for (const k of Object.keys(v).sort()) out[k] = v[k];
      return out;
    }
    const vt = _rows(s.vouchTable, true);
    if (vt) settings.vouchTable = vt;
    const ct = _rows(s.checkpointTable, false);
    if (ct) settings.checkpointTable = ct;

    // ── THE BOT DIALS (J17) ────────────────────────────────────────────────────────────────
    // Two booleans, on `selfWitnessCheckpoint`'s exact precedent: a strict type check, TOTAL, and
    // a non-boolean keeps the current value like every setting here.
    if (typeof s.botPresenceSpine === "boolean") settings.botPresenceSpine = s.botPresenceSpine;
    if (typeof s.botPresenceChat === "boolean") settings.botPresenceChat = s.botPresenceChat;
    if (typeof s.botQueueChat === "boolean") settings.botQueueChat = s.botQueueChat;
    // Two numeric dials, range-checked against their own rows. `_inRange` refuses anything that is
    // not a safe integer, which is the integer contract rather than a convention: the hash layer's
    // canonical form THROWS on a fraction, so a fractional value that passed here would be a LEGAL
    // event no client could fingerprint.
    if (_inRange("botAfkMs", s.botAfkMs)) settings.botAfkMs = s.botAfkMs;
    if (_inRange("botPingMs", s.botPingMs)) settings.botPingMs = s.botPingMs;
    if (_inRange("queueIdleMs", s.queueIdleMs)) settings.queueIdleMs = s.queueIdleMs;
    if (_inRange("repeatCooldownMs", s.repeatCooldownMs)) settings.repeatCooldownMs = s.repeatCooldownMs;

    // ── THE TWO ACTIVITY MAPS — WHOLE OR NOTHING, like every map here ─────────────────────
    // Sorted on the way in for the same reason `_delegationMap` sorts: `_canonSettings` compares
    // these and key order would otherwise make two rooms that AGREE produce different canonical
    // forms, and therefore different fingerprints, and therefore checkpoints neither can verify.
    // A fresh object each time, so a caller cannot hold a reference into derived state.
    const _flagMap = (key, v) => {
      if (!_isValidFlagMap(key, v)) return null;
      const out = {};
      for (const k of Object.keys(v).sort()) out[k] = v[k];
      return out;
    };
    const aq = _flagMap("activityQueue", s.activityQueue);
    if (aq) settings.activityQueue = aq;
    const ap = _flagMap("activityPresence", s.activityPresence);
    if (ap) settings.activityPresence = ap;

    // THE DELEGATION TABLE — WHOLE OR NOTHING, and self-excluding.
    //
    // Whole-or-nothing like both per-rank tables and both dial pairs: a table with one bad row
    // does not apply half of itself. `_delegationMap` returns null for anything it will not accept,
    // and null keeps the current value.
    //
    // THE SELF-EXCLUSION IS THE ROW MOST WORTH GETTING RIGHT. A rank permitted to change
    // `botDelegation` could grant itself every other setting in a single subsequent write — the
    // table would be a key to itself. So `botDelegation` is not in its own domain, and the domain
    // is DERIVED from `defaultSettings()` rather than listed, which is what makes the exclusion
    // structural: there is no list anybody could add it back to. A later key is in the domain
    // automatically; this one can never be.
    const dg = _delegationMap(s.botDelegation);
    if (dg) settings.botDelegation = dg;

    return settings;
  }

  // PURE: is this blob a COMPLETE settings write? The write path always sends every key (that is
  // what check-settings-passthrough enforces), but the reducer merges field by field, so a partial
  // blob applies only its own fields. That matters here and nowhere else: verification recomputes
  // from DEFAULTS, so a partial event cannot substantiate a claim even when nothing is wrong.
  function settingsBlobComplete(blob) {
    if (!blob || typeof blob !== "object") return false;
    const ref = defaultSettings();
    for (const k in ref) if (!(k in blob)) return false;
    return true;
  }

  function _canonSettings(x) {
    const ref = defaultSettings();
    const o = {};
    for (const k of Object.keys(ref).sort()) o[k] = (x && k in x) ? x[k] : ref[k];
    return JSON.stringify(o);
  }

  // PURE: does the event a checkpoint NAMES actually produce the settings it CLAIMS?
  // Three verdicts, never two. "We cannot tell" is its own answer and must not collapse into
  // either "fine" or "tampered" — the first would license forgetting on no evidence, the second
  // would call a partial write an attack.
  //   match         the named event reproduces the claim. The claim is evidence now, not trust.
  //   mismatch      it reproduces something else. Recorded, never enforced.
  //   unverifiable  the event cannot settle the question at all (no blob, or a partial write).
  function settingsClaimVerdict(claimed, blob) {
    if (!claimed || typeof claimed !== "object") return { verdict: "unverifiable", reason: "no-claim" };
    if (!blob || typeof blob !== "object") return { verdict: "unverifiable", reason: "no-settings-in-event" };
    if (!settingsBlobComplete(blob)) return { verdict: "unverifiable", reason: "partial-event" };
    const produced = applySettingsEvent(defaultSettings(), blob);
    return (_canonSettings(produced) === _canonSettings(claimed))
      ? { verdict: "match", reason: null }
      : { verdict: "mismatch", reason: "differs-from-named-event" };
  }

  // A room that has never set anything names no event, and defaults are CODE rather than data —
  // so that claim is checkable by anyone with no fetch at all.

  function buildSeed(orderedEvents, seed) { return _deriveFull(orderedEvents, seed).seed; }

  // PURE: shape the derived play-history for display. derive() accumulates plays
  // oldest→newest; the Room History view wants them NEWEST-FIRST and optionally
  // limited. Total on junk input (non-array → []). Returns a fresh array (never
  // mutates the input) of the same entry objects. Time-ago FORMATTING is a UI
  // concern (it needs the wall clock, which is not the reducer's to read) — it
  // lives in the view; this only orders/limits. Exposed for the guard.
  function projectHistory(history, opts) {
    if (!Array.isArray(history)) return [];
    opts = opts || {};
    const out = history.slice().reverse();           // newest first
    if (typeof opts.limit === "number" && opts.limit >= 0 && out.length > opts.limit) {
      return out.slice(0, opts.limit);
    }
    return out;
  }

  return { derive, deriveAccepted, deriveRefusals, deriveBoth, buildSeed, defaultSettings, SETTING_RANGES, settingKindOf, projectHistory, canAdvance,
    ACTIVITY_GROUPS: ACTIVITY_GROUPS.slice(), activityGroupOf,
    BLOCKED_REASONS, blockedReasonCounts, isBlockedReason,
    applySettingsEvent, settingsBlobComplete, settingsClaimVerdict, voteEligible, HANDLED_TYPES: HANDLED_TYPES.slice() };
})();
