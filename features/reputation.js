// features/reputation.js — J19: lifetime reputation, shape (a).
//
// Depends on: MatrixBridge, StreamManager, Logger. The fold is pure and takes a log, so its
// arithmetic can be driven at explicit values without a room, a clock or a transport.
//
// ── SHAPE (a) IS CHOSEN, AND THE OTHER TWO ARE CLOSED FOR REASONS WORTH KEEPING ──────────────
// (a) bot-internal, published separately: the bot tallies what it has seen and publishes a
// standalone snapshot that has nothing to do with checkpoints. Export takes the most recent one
// as supplementary.
//
// (b) IN THE CHECKPOINT, ASSERTED BY THE BOT — closed, and DRIVEN rather than argued.
// `CheckpointFormat.fingerprint` commits exactly six fields (`n`, `prev`, `seed`, `floorL`,
// `thin`, `covers`), read out of the function itself. A seventh moves every fingerprint — measured
// both ways, as a field inside the seed and as an extra argument to the hash — so every checkpoint
// in every room becomes unverifiable and no room holds a floor or forgets anything until it seals
// two fresh ones. **That is the dead-checkpoint window the five settings keys paid one release
// ago, paid a second time — for a number that is an assertion either way.** And the worse half is
// not the cost: putting an UNVERIFIABLE number inside the artefact everyone verifies makes it
// look like verified truth. That contradicts the recorded decision that reputation is BELIEVED
// rather than derived (J17), and it would contradict it silently, because the number would sit
// beside five fields that really are checkable.
//
// (c) IN THE CHECKPOINT, DERIVED BY EVERYONE — closed, and the entry's wording UNDERSTATES why.
// It says "hardest to reconcile with forgetting". It is not hard; it is **contradictory**, and the
// contradiction is one line long: DERIVED means every client computes the same answer from what it
// holds, and this number's entire purpose is to outlive history that clients have forgotten.
// DRIVEN: the same tally rule over a full log and over a log missing its oldest half gives
// `{a:2,b:1}` and `{a:1}` — two honest clients, no disagreement about any event, different
// answers. **A quantity whose purpose is to survive forgetting cannot be derived from what
// survives forgetting.** The seed cannot rescue it either: carrying the running total forward
// through the seed means banking a number at seal time that nobody recomputes, which is (b)
// wearing (c)'s name.
//
// ── THE DONE-WHEN IS THE HONEST LABEL, AND IT IS THE WHOLE JOB ───────────────────────────────
// The number is at best WHAT THE BOT SAW. A bot that started yesterday, restarted, or was away
// for a week produces a number that LOOKS IDENTICAL to a complete one — same type, same shape,
// same rendering. That is the failure this module is built around, and the answer is structural:
// **a tally is never returned without its coverage**, and the label refuses to render a number
// whose coverage is missing rather than falling back to a bare count. There is no code path here
// that produces a number a caller could render alone.
//
// J16's precedent and its caveat both apply: a guard can prove this surface SAYS what it means,
// and can never prove a reader hears it. `README.md`'s live-verification list carries the half a
// guard cannot reach.
const Reputation = (() => {
  // Published as its own event, on its own type, with NOTHING to do with checkpoints. That
  // separation is the point of shape (a): a reader who finds this event knows it is an assertion,
  // because it is not inside the thing they verify.
  const SNAPSHOT_TYPE = "ddjp.rep.snapshot";

  // What counts toward reputation: reactions RECEIVED, not given. A vote or save names a playing
  // (`p`), and the playing names the DJ — so the tally is resolved through the log's own
  // play events rather than through a second notion of who owned a song.
  const EARNS = { "ddjp.dj.vote": "votes", "ddjp.dj.save": "saves" };

  // ── THE FOLD — PURE, AND IT RETURNS COVERAGE OR NOTHING ───────────────────────────────────
  // Takes an ordered log. Returns per-user tallies AND the window they were counted over. The two
  // travel together and cannot be separated by a caller, because a caller that could hold the
  // tally alone would render a partial number as a lifetime one — which is precisely the failure
  // the Done-when names.
  //
  // `isLegalFn` is taken rather than reached for, so the arithmetic can be driven at explicit
  // values. A REFUSED event earns nothing: the reducer rejected it, so it did not happen, and
  // counting it would let anyone inflate a score by sending votes the room throws away.
  function foldReputation(log, isLegalFn, opts) {
    const o = opts || {};
    const rows = Array.isArray(log) ? log : [];
    const legal = (typeof isLegalFn === "function") ? isLegalFn : function () { return true; };
    const djOf = Object.create(null);       // playing id -> the DJ who played it
    const tally = Object.create(null);
    let counted = 0, ignored = 0, refused = 0, unattributed = 0;
    let firstL = null, lastL = null, firstTs = null, lastTs = null;

    for (const e of rows) {
      if (!e || !e.eventId || !e.type) continue;
      const l = (typeof e.l === "number" && isFinite(e.l)) ? e.l : null;
      const ts = (typeof e.ts === "number" && isFinite(e.ts)) ? e.ts : null;
      // THE WINDOW IS MEASURED OVER EVERYTHING HELD, not over what was counted. It answers *how
      // far back can this tally possibly see*, which is a fact about the log rather than about
      // the reactions in it — a room with no votes still has a window, and reporting none would
      // make an empty tally look like an unbounded one.
      if (l !== null) { if (firstL === null || l < firstL) firstL = l; if (lastL === null || l > lastL) lastL = l; }
      if (ts !== null) { if (firstTs === null || ts < firstTs) firstTs = ts; if (lastTs === null || ts > lastTs) lastTs = ts; }

      let ok = true;
      try { ok = legal(e.eventId) !== false; } catch (err) { ok = true; }

      if (e.type === "ddjp.dj.play") {
        // A play attributes its playing id to its sender. Recorded even when refused, because the
        // attribution is about WHO played, not about whether the play was accepted — and a
        // refused play whose votes were accepted would otherwise lose its DJ.
        if (e.eventId) djOf[e.eventId] = e.sender || null;
        continue;
      }
      const kind = EARNS[e.type];
      if (!kind) { ignored++; continue; }
      if (!ok) { refused++; continue; }
      const pi = e.body && e.body.p;
      const dj = pi ? djOf[pi] : null;
      if (!dj) {
        // A reaction to a playing this log does not contain. NOT an error and NOT droppable
        // silently: it is the ordinary consequence of a bot that joined mid-room, and it is
        // exactly the evidence that this tally is partial. Counted so the label can say so.
        unattributed++;
        continue;
      }
      if (!tally[dj]) tally[dj] = { votes: 0, saves: 0 };
      tally[dj][kind]++;
      counted++;
    }

    return {
      tally: tally,
      // COVERAGE TRAVELS WITH THE TALLY. There is no shape here that is just a number.
      coverage: {
        fromL: firstL, toL: lastL, fromTs: firstTs, toTs: lastTs,
        held: rows.length, counted: counted, refused: refused, ignored: ignored,
        // THE ONE FLAG THAT DECIDES THE SENTENCE. True when this log cannot see the room's
        // beginning — either because something was forgotten beneath it, or because the observer
        // arrived after the room started. The two are the same fact from the tally's point of
        // view and are deliberately not distinguished: both mean *there is history I did not see*.
        // TWO WAYS TO BE PARTIAL, AND THE SECOND WAS MISSING UNTIL THE GUARD ASKED FOR IT.
        // The first is obvious: the log starts above the room's beginning, so history is missing
        // from the FRONT. The second is not: a reaction naming a playing this log does not hold
        // means history is missing from the MIDDLE — the log can begin at position 1 and still
        // have a hole in it, and the first version answered `false` for exactly that case.
        // Both are the same fact from the tally's point of view: there is history I did not see.
        partial: (unattributed > 0) ||
          ((typeof o.roomStartsAt === "number" && firstL !== null)
            ? firstL > o.roomStartsAt
            : (firstL === null || firstL > 1)),
        unattributed: unattributed,
      },
    };
  }

  // The live reader. Thin, and it reads on every call rather than caching — a cached tally would
  // go on reporting a window the log no longer has after a trim.
  function current(opts) {
    let log = [], legal = null;
    try { log = StreamManager.getLog() || []; } catch (e) { log = []; }
    try { legal = StreamManager.isLegal; } catch (e) { legal = null; }
    return foldReputation(log, legal ? (id) => StreamManager.isLegal(id) : null, opts);
  }

  // ── THE LABEL — AND IT REFUSES RATHER THAN FALLING BACK ───────────────────────────────────
  // Pure, so what the surface CLAIMS can be driven without a DOM. Returns null when coverage is
  // missing, and null is a refusal: a caller with nothing to render shows nothing. The tempting
  // alternative — render the number and omit the qualifier — is the exact failure the Done-when
  // names, because a partial number and a complete one look identical.
  function label(fold, userId) {
    if (!fold || !fold.coverage || typeof fold.coverage.partial !== "boolean") return null;
    const t = (fold.tally && fold.tally[userId]) || { votes: 0, saves: 0 };
    const c = fold.coverage;
    return {
      votes: t.votes, saves: t.saves,
      // NEVER THE WORD "LIFETIME", and never a bare total. The heading names the source of the
      // number rather than its scope, because its scope is the thing that cannot be promised.
      heading: "Seen by the bot",
      // The sentence a person reads. It states the limit FIRST, because a qualifier after a
      // number is read as a footnote and this one is the number's meaning.
      note: c.partial
        ? "This counts only what the bot has seen. It joined after this room started, or has " +
          "missed time since, so the real total is higher — there is no way to tell by how much."
        : "This counts everything in the history this client still holds. If anything has been " +
          "forgotten, or the bot was away, the real total is higher.",
      // TRUE IN BOTH BRANCHES, which is the point: even the non-partial branch does not claim
      // completeness, because a bot that was never absent cannot prove it was never absent.
      complete: false,
    };
  }

  // ── PUBLISHING — STANDALONE, AND INERT ────────────────────────────────────────────────────
  // A snapshot goes out on its own type, unrelated to any checkpoint. It is inert to the reducer
  // (an unknown type changes no derived state and — the half that matters — moves neither the
  // checkpoint seed nor the fingerprint), which is what keeps shape (a)'s promise that checkpoints
  // are untouched.
  //
  // THE COVERAGE IS PUBLISHED WITH THE TALLY, for the same reason the fold returns them together:
  // a snapshot carrying a bare number would let any reader render it as complete, and a reader on
  // another client has no other way to learn otherwise.
  async function publish(channels, myLevel, fold) {
    if (!fold || !fold.coverage) return { ok: false, reason: "no-coverage" };
    const ch = channels && MatrixBridge.eventsKeyForLevel
      ? channels[MatrixBridge.eventsKeyForLevel(myLevel)] : null;
    if (!ch) { Logger.warn("Reputation: no events channel for level " + myLevel); return { ok: false, reason: "no-channel" }; }
    try {
      await MatrixBridge.sendEvent(ch, "ddjp.rep.snapshot", { t: fold.tally, c: fold.coverage });
    } catch (e) {
      Logger.warn("Reputation: publish failed — " + (e && e.message));
      return { ok: false, reason: "send-failed" };
    }
    return { ok: true };
  }

  return { SNAPSHOT_TYPE, EARNS, foldReputation, current, label, publish };
})();
