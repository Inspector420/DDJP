// features/botsettings.js — J18: settings through the bot.
//
// Depends on: MatrixBridge, StreamManager, Capabilities, Logger. Reads Room only through what it
// is handed, so the decision half is drivable at explicit values. NO rank literal and no `Ranks`
// reference: rank comparison goes through `Capabilities.atLeast`, by NAME.
//
// ── WHAT THIS REPLACES, AND WHY THERE IS STILL ONE WRITER ───────────────────────────────────
// The original design gave staff their own writable settings channels — a SECOND author of room
// truth, which the reducer would have had to learn about. This replaces it: a lower rank REQUESTS
// a change, and the bot (which holds owner rank) authors it. Delegation becomes bot POLICY rather
// than reducer policy, so `ddjp.room.settings` still has exactly one legitimate origin and the
// reducer is untouched. DRIVEN, not assumed: `Ranks.permits(level, "room.settings")` answers true
// for exactly one rank name out of seven, and the channel a settings event arrives on is what
// stamps that rank — so "one author" is a property of routing, not of a claim in the payload.
//
// ── THE DONE-WHEN IS "NO EVENT AT ALL", WHICH IS STRONGER THAN "A REFUSED EVENT" ────────────
// An unpermitted request must not produce a `ddjp.room.settings` event that the reducer then
// rejects. It must produce NOTHING. The difference is not cosmetic:
//   · a rejected settings event still enters the log, still occupies a position, and still shows
//     up in `check-reducer-ignore`'s broad-inertness accounting;
//   · a room full of refused settings writes is a room where the DELEGATION table is doing no
//     work while looking like it is, because every request "went through" and every one bounced.
// So `decide()` is asked BEFORE anything is sent, and `authorIfPermitted()` returns without
// touching the transport when the answer is no. The guard asserts ZERO sends, not a refusal.
//
// ── THE DOMAIN IS READ, NEVER RESTATED, AND THAT IS WHERE THIS JOB'S DEFECT WOULD LIVE ──────
// `botDelegation`'s key domain is DERIVED from `defaultSettings()` (J17), which buys three
// properties this module gets for free and would lose the moment it hand-listed keys:
//   · A SETTING ADDED LATER IS DELEGABLE THE DAY IT IS ADDED. No list here to forget.
//   · `botDelegation` IS NOT IN ITS OWN DOMAIN, so no rank can be delegated the power to rewrite
//     the delegation table and thereby grant itself everything else. Structural, not a check.
//   · THE TWO VOCABULARIES STAY DISJOINT. `room.upgrade` is a `Ranks.GATES` act and not a
//     settings key — measured, ZERO OVERLAP between the settings keys and the GATES acts (counts
//     not written: `23` here rotted at v322 and the disjointness did not change) — so a request
//     naming it is refused by the SAME rule that refuses a typo, with no special case. **A request
//     surface that blurred settings keys and GATES acts is the defect this job was most likely to
//     introduce**, and the way it is avoided is by never having a second list to blur.
const BotSettings = (() => {
  const REQUEST_TYPE = "ddjp.bot.request";

  // ── THE DECISION — PURE, TOTAL, AND DRIVABLE AT EXPLICIT VALUES ───────────────────────────
  // Takes the settings blob and the requester's LEVEL rather than reaching for either, so the
  // whole policy can be driven without a room, a transport or a clock. Returns a verdict object
  // rather than a boolean, because "no" has several reasons and a caller that cannot tell them
  // apart cannot report anything useful.
  //
  // TOTAL: every path returns a verdict. A policy that throws on a malformed request would make
  // the bot's own inbox a denial-of-service surface, since anyone able to write to an events
  // channel can put an arbitrary blob on it.
  function decide(req, senderLevel, settings) {
    const s = settings || {};
    if (!req || typeof req !== "object") return no("malformed", "the request is not an object");
    const key = req.k;
    if (typeof key !== "string" || !key) return no("no-key", "the request names no setting");

    // THE DOMAIN, READ FROM THE REDUCER. Not a list here. `settingRanges()` is the same seam the
    // settings panel reads its bounds through, and it resolves the derived key domain to a plain
    // array on the way across (J17).
    let domain = null, vocab = null;
    try {
      const entry = (StreamManager.settingRanges() || {}).botDelegation;
      domain = entry && Array.isArray(entry.keys) ? entry.keys : null;
      // The RANK VOCABULARY comes from the same seam entry — it is `Ranks.NAMES` resolved to an
      // array on the way across (J17). Read here rather than restated for the same reason the key
      // domain is: a ladder change must not leave a name in this file disagreeing with it.
      vocab = entry && Array.isArray(entry.values) ? entry.values : null;
    } catch (e) { domain = null; vocab = null; }
    if (!domain || !vocab) return no("no-domain", "the delegation domain could not be read");
    if (domain.indexOf(key) < 0) {
      // This one refusal covers a typo, a GATES act name, and `botDelegation` itself. They are
      // not three cases here because they are not three cases in the domain.
      return no("not-a-setting", "`" + key + "` is not a delegable setting");
    }

    const table = (s.botDelegation && typeof s.botDelegation === "object") ? s.botDelegation : {};
    const grantedTo = table[key];
    if (typeof grantedTo !== "string" || !grantedTo) {
      // ABSENCE IS THE DEFAULT AND IT IS A REFUSAL. An empty table delegates nothing, so a room
      // that has never configured delegation behaves exactly as it did before this job.
      return no("not-delegated", "nobody may change `" + key + "` by request");
    }
    // AN UNREADABLE GRANT IS ITS OWN REFUSAL, kept distinct from a rank refusal on purpose:
    // "nobody at your rank may do this" and "this room's table is corrupt" are different facts and
    // a caller that cannot tell them apart cannot report either. `Capabilities.atLeast` answers
    // false for an unknown name, which is the safe direction and the WRONG message — a person
    // would be told they lack a rank that does not exist.
    if (vocab.indexOf(grantedTo) < 0) return no("bad-grant", "`" + grantedTo + "` is not a rank");
    // COMPARED BY NAME THROUGH `Capabilities.atLeast`, NEVER BY LEVEL HERE. `check-boundaries`
    // caught the first version reaching for `Ranks.levelOf` — `Ranks` is a backend INTERNAL and
    // `features/` may touch the backend only through its interface, so the ladder stays swappable.
    // The rule it enforces is also the one this module wants: no rank NUMBER appears in this file,
    // so a ladder change cannot leave a literal here disagreeing with it (rule H).
    if (!Capabilities.atLeast(senderLevel, grantedTo)) {
      return no("rank", "`" + key + "` needs " + grantedTo + " and the request came from below it");
    }
    // THE VALUE IS NOT VALIDATED HERE, DELIBERATELY. `applySettingsEvent` is TOTAL and re-validates
    // every field against `SETTING_RANGES`; a second validation here would be a second copy of a
    // rule with one home (P7), free to disagree — and it would disagree in the direction that
    // matters, because this module would have to be edited every time a range moved.
    return { ok: true, key: key, value: req.v, reason: null, detail: null };
  }
  function no(reason, detail) { return { ok: false, key: null, value: undefined, reason, detail }; }

  // ── THE REQUEST SIDE — a lower rank asks ─────────────────────────────────────────────────
  // Sent on the requester's OWN events channel, which is the channel their rank can write to.
  // NOT on a settings channel — and the two that made that a live choice no longer exist.
  // `settings-staff` and `settings-high-staff` were write-gated at 60 and 80 while `botDelegation`
  // can name any rank down to `uncategorized`, so a delegated player could never have reached
  // them; that argument is why they were purposeless, and they have since been removed from the
  // channel table. The requester's own tier is the only channel writable by definition at every
  // rank the table can name, which is what makes this the right channel rather than the leftover.
  //
  // IT IS INERT TO THE REDUCER AND THAT IS MEASURED, NOT ASSUMED. `ddjp.bot.request` is a type the
  // reducer has never heard of, so it changes no derived state — and, in the broad sense
  // `check-reducer-ignore` uses, it moves neither the checkpoint SEED nor the FINGERPRINT. That
  // second half is the one that matters: an event that left state identical and moved the
  // fingerprint would stop two honest clients verifying each other's floors, with every
  // correctness assertion still green.
  async function request(channels, myLevel, key, value) {
    const ch = channels && MatrixBridge.eventsKeyForLevel
      ? channels[MatrixBridge.eventsKeyForLevel(myLevel)] : null;
    if (!ch) { Logger.warn("BotSettings: no events channel for level " + myLevel); return { ok: false, reason: "no-channel" }; }
    try {
      // THE TYPE IS A STRING LITERAL AT THE SEND SITE, not the constant above. `check-wiring`
      // PART D refused the constant, and it is right to: it CLASSIFIES every send by reading the
      // literal, and a send whose type it cannot read is a send whose decision it cannot record.
      // `REQUEST_TYPE` is still exported so a reader can name the type without a second spelling,
      // and the guard asserts the two agree rather than trusting them to.
      await MatrixBridge.sendEvent(ch, "ddjp.bot.request", { k: key, v: value });
    } catch (e) {
      Logger.warn("BotSettings: request failed — " + (e && e.message));
      return { ok: false, reason: "send-failed" };
    }
    return { ok: true };
  }

  // ── THE BOT SIDE — the only place a request can become a settings event ───────────────────
  // `authorSettings` is injected rather than reached for, so this can be driven against a
  // recording transport and the guard can assert that an unpermitted request produces ZERO calls.
  // A module that reached for `Room.setSettings` itself would only be assertable by mocking a
  // global, and the thing under test is precisely whether the call happens.
  async function authorIfPermitted(req, senderLevel, settings, authorSettings) {
    const verdict = decide(req, senderLevel, settings);
    if (!verdict.ok) {
      // NOTHING IS SENT. Not a refused settings event, not a rejection event, not an ack — the
      // Done-when is "no settings event at all", and the way to satisfy it is to have no code path
      // from here to the transport.
      Logger.warn("BotSettings: refused (" + verdict.reason + ") — " + verdict.detail);
      return verdict;
    }
    if (typeof authorSettings !== "function") return no("no-writer", "no settings writer was provided");
    try {
      await authorSettings({ [verdict.key]: verdict.value });
    } catch (e) {
      Logger.error("BotSettings: authoring failed — " + (e && e.message));
      return no("author-failed", e && e.message);
    }
    return verdict;
  }

  return { REQUEST_TYPE, decide, request, authorIfPermitted };
})();
