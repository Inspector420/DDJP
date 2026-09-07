// tests/check-user-card.js
// THE USER CARD (J14) — the two moderation RULES and the SURFACE they are rendered on.
//
// J14 built two things and they fail differently, so this guard covers both and says which:
//
//   PART A  the gates AGREE WITH THE HOMESERVER — the enforcement equivalence for these verbs
//   PART B  the rules across the whole ladder, including the diagonal
//   PART C  the rules are the SAME PATTERN as rank.assign, not a second one
//   PART D  the card renders from the descriptor and decides nothing
//   PART E  the DM slot is the container J15 plugs into — driven both ways, plus
//           `closeOnRun`: an action opening its own surface must not reach the room-set verdict
//   PART F  a PARTIAL removal is never reported as a success
//   PART G  the feature layer refuses an act the descriptor would have allowed a stale click on
//
// ── WHY PART A IS NOT check-capabilities' JOB ────────────────────────────────────────────────
// Every other gated verb has a REDUCER branch, and `check-capabilities` proves `can().permitted`
// equals whether the reducer acted. `member.kick` and `member.ban` have no reducer branch and
// never can: they are Matrix MEMBERSHIP acts and never become Spine events. Their enforcer is the
// homeserver, through the power levels `matrixbridge._powerLevels` writes at channel creation. So
// the equivalence that matters is between the GATE and the POWER LEVEL, and an app gate weaker
// than the power level ships a button that reports permitted and yields a 403. PART A reads those
// numbers by EXECUTING `_powerLevels`, because a regex over them would go quiet the day somebody
// derives them.
//
// ── WHY THE CARD IS EXECUTED RATHER THAN MATCHED ─────────────────────────────────────────────
// Nine guards read `ui/interface.js` as source text and none executes it, so a change there is not
// validated by a green suite. `check-blocked-wire` (J41) and `check-playback-end` part 5 (J48)
// both answer that by extracting the subject's own source and RUNNING it; this file joins them.
// A regex proving `member.ban` is SPELLED in the card would be exactly the class of check that
// stayed green for the whole time the blocked wire did not exist.
//
// ── EVERY PART ASSERTS ITS OWN PREMISE ───────────────────────────────────────────────────────
// `paths.md` §9 entry 12's fourth shape: the decoration can live in the premise rather than in the
// assertion. A card that offers nothing passes "offers nothing it may not do" for free; a ladder
// loop that filtered to empty passes every row it contains. So each part refuses itself when the
// state it needs is not the state it built — and the admissibility gate in `_probe-j14-card.js`
// self-tests in both directions before any of it runs.

const assert = require("assert");
const P = require("./_probe-j14-card.js");
const { loadInContext } = require("./_load");

let checks = 0;
function ok(cond, msg) {
  if (!cond) { console.log("[user-card] FAIL — " + msg); process.exit(1); }
  checks++;
}
function gate(kind, r, opts, where) {
  const g = P.admissible(kind, r, opts);
  ok(g.ok, where + ": the reading was refused by its own admissibility gate, so nothing asserted " +
    "from it would mean anything —\n      " + g.problems.join("\n      "));
}

// ---- the gate is itself untested code; it certifies everything below ----
const st = P.selfTest();
ok(st.missed.length === 0, "the admissibility gate MISSED cases it claims to catch (" +
  st.missed.join(" · ") + ") — it would certify a broken reading");
ok(st.falseAlarms.length === 0, "the admissibility gate refused sound readings (" +
  st.falseAlarms.join(" · ") + ") — a gate that refuses everything certifies nothing");

const LADDER = P.LADDER;
const Ranks = P.Ranks;
const Capabilities = P.Capabilities;
const VERBS = ["member.kick", "member.ban"];

// ═══ PART A — the gates agree with what the homeserver will actually enforce ═════════════════
const hs = P.homeserverGate();
ok(hs.ok, "PART A: the power levels could not be read out of the transport — " + hs.stage);

// premise: the two numbers must be DIFFERENT, or this part cannot tell a gate that tracks the
// power level from one that happens to be right about both by using a single value.
ok(hs.ban !== hs.kick, "PART A premise: ban and kick power levels are both " + hs.ban +
  ", so nothing below distinguishes a gate that tracks the homeserver from one constant that " +
  "coincidentally satisfies both");

const banGate = Ranks.gateFor("member.ban");
const kickGate = Ranks.gateFor("member.kick");
ok(banGate !== null, "PART A: `member.ban` has no row in Ranks.GATES, so `permits` fails closed " +
  "and the act is denied to everyone — the surface would be dead rather than gated");
ok(kickGate !== null, "PART A: `member.kick` has no row in Ranks.GATES");

ok(banGate === hs.weakestRankFor(hs.ban),
  "PART A: `member.ban` is gated at " + banGate + ", but the channels are created with ban=" +
  hs.ban + ", whose weakest sufficient rank is " + hs.weakestRankFor(hs.ban) + ". A gate WEAKER " +
  "than the power level renders an enabled button that the homeserver answers with a 403; a gate " +
  "STRONGER hides an act the server would have allowed. Change both or neither.");
ok(kickGate === hs.weakestRankFor(hs.kick),
  "PART A: `member.kick` is gated at " + kickGate + ", but the channels are created with kick=" +
  hs.kick + ", whose weakest sufficient rank is " + hs.weakestRankFor(hs.kick));

// ═══ PART B — the rules across the ladder, including the diagonal ════════════════════════════
const grids = {};
for (const verb of VERBS) {
  const g = P.ladderGrid(verb);
  gate("grid", g, {}, "PART B/" + verb);
  grids[verb] = g;

  // nobody may act on themselves — and this falls out of "strictly below" rather than from a
  // self clause, which is why it is asserted rather than assumed.
  const selfPairs = g.rows.filter((r) => r.actor === r.target && r.permitted);
  ok(selfPairs.length === 0, "PART B/" + verb + ": permitted on SELF at " +
    selfPairs.map((r) => r.actor).join(", ") + " — the strictly-below comparison is what refuses " +
    "this, so a permitted diagonal means the comparison is `<=` rather than `<`");

  // nobody may act UPWARD or sideways
  const upward = g.rows.filter((r) => r.permitted && r.targetLevel >= r.actorLevel);
  ok(upward.length === 0, "PART B/" + verb + ": permitted against an equal or stronger target (" +
    upward.slice(0, 3).map((r) => r.actor + "->" + r.target).join(", ") + ")");

  // and every rank at or above the gate may act on everyone below it — the positive half,
  // without which "denies everything" would pass every assertion above.
  const need = Ranks.gateFor(verb);
  for (const actor of LADDER) {
    for (const target of LADDER) {
      const expect = Ranks.atLeast(actor.level, need) && target.level < actor.level;
      const got = g.rows.find((r) => r.actor === actor.name && r.target === target.name).permitted;
      ok(got === expect, "PART B/" + verb + ": " + actor.name + " -> " + target.name +
        " answered " + got + ", expected " + expect + " (gate " + need + ", strictly below)");
    }
  }
}

// ═══ PART C — one moderation pattern, not two ════════════════════════════════════════════════
// J14's entry says in as many words: follow `rank.assign`'s existing shape, the others should not
// invent a second pattern (P7). `member.kick` shares its gate, so its grid must be IDENTICAL —
// which is a stronger statement than "both look sensible" and fails if either drifts.
const assignGrid = P.ladderGrid("rank.assign", (target) => ({ targetRank: target.level }));
gate("grid", assignGrid, {}, "PART C");
ok(Ranks.gateFor("rank.assign") === Ranks.gateFor("member.kick"),
  "PART C premise: `rank.assign` and `member.kick` no longer share a gate, so the identity below " +
  "is not the right comparison any more — re-derive it rather than deleting it");
for (const r of assignGrid.rows) {
  const k = grids["member.kick"].rows.find((x) => x.actor === r.actor && x.target === r.target);
  ok(k.permitted === r.permitted, "PART C: `member.kick` and `rank.assign` disagree at " +
    r.actor + " -> " + r.target + " despite sharing a gate — the two moderation rules have " +
    "become two patterns");
}
// and ban is STRICTLY stronger, which is what makes PART A's reading observable at all
ok(grids["member.ban"].permitted < grids["member.kick"].permitted,
  "PART C: ban is not stricter than kick, so the ban=100/kick=60 split PART A reads is not " +
  "reflected in the rules at all");

// ═══ PART D — the card renders the descriptor and decides nothing ════════════════════════════
const PERMITTED = { enabled: true, reason: null };
const DENIED = { enabled: false, reason: "Staff rank required" };

const cardYes = P.driveCard({
  member: { userId: "@them:hs", name: "Them", level: 0 },
  describeAnswers: { "rank.assign": PERMITTED, "member.kick": PERMITTED, "member.ban": PERMITTED },
});
gate("card", cardYes, { expectOffered: true }, "PART D (permitted)");

const cardNo = P.driveCard({
  member: { userId: "@them:hs", name: "Them", level: 0 },
  describeAnswers: { "rank.assign": DENIED, "member.kick": DENIED, "member.ban": DENIED },
});
gate("card", cardNo, {}, "PART D (denied)");

// the card ASKED about every action it has a row for — a card that offers nothing because it
// never asked reads identically to one that asked and was denied
for (const verb of VERBS) {
  ok(cardYes.asked.some((a) => a.action === verb),
    "PART D: the card never asked Actions.describe about `" + verb + "`, so whatever it renders " +
    "for that action is not a reading of the rules");
  // and it asked with a TARGET — a target-free ask is an ask about nobody
  const q = cardYes.asked.find((a) => a.action === verb);
  ok(q.target && q.target.userId && typeof q.target.targetRank === "number",
    "PART D: the card asked about `" + verb + "` with no userId/targetRank, so the descriptor it " +
    "rendered was computed against nobody");
}

// THE PROPERTY: same card, same member, opposite descriptors -> opposite live controls.
const liveYes = cardYes.offered.filter((o) => o.live && o.action).map((o) => o.action).sort();
const liveNo = cardNo.offered.filter((o) => o.live && o.action).map((o) => o.action).sort();
ok(liveYes.length > 0, "PART D premise: the card offered no live control even when every " +
  "descriptor permitted — the denied case below would then pass for free");
ok(liveNo.length === 0, "PART D: the card offered LIVE controls (" + liveNo.join(", ") +
  ") while every descriptor said denied — the UI is deciding for itself, which is the one thing " +
  "J14's Done-when forbids");

// a denied control is shown, disabled, carrying the BACKEND's reason — not a string from the UI
for (const o of cardNo.offered.filter((x) => x.action)) {
  ok(o.disabled, "PART D: the `" + o.action + "` control is not disabled under a denied descriptor");
  ok(o.title === DENIED.reason, "PART D: the `" + o.action + "` control's tooltip is " +
    JSON.stringify(o.title) + " rather than the backend's own reason " +
    JSON.stringify(DENIED.reason) + " — a reason written in the UI is a second copy of a rule");
}

// ═══ PART E — the DM slot: the container claim, driven both ways ═════════════════════════════
// "It is the container J15 and J16 plug into" is a claim about behaviour. Driven: the SAME card
// source must offer no DM control while the adapter does not know the action, and offer one the
// moment it does — with no edit to `ui/interface.js` in between. Running only the first half
// would be green on a card that can never show the control at all.
const dmAbsent = P.driveCard({
  describeAnswers: { "rank.assign": DENIED, "member.kick": PERMITTED, "member.ban": DENIED },
});
const dmPresent = P.driveCard({
  describeAnswers: { "rank.assign": DENIED, "member.kick": PERMITTED, "member.ban": DENIED,
    "chat.dm": PERMITTED },
});
gate("card", dmAbsent, { expectOffered: true }, "PART E (absent)");
gate("card", dmPresent, { expectOffered: true }, "PART E (present)");
ok(dmAbsent.source === dmPresent.source,
  "PART E premise: the two drives read different card source, so the comparison below is not " +
  "about the adapter's vocabulary at all");
const dmCount = (r) => r.offered.filter((o) => o.action === "chat.dm").length;
ok(dmCount(dmAbsent) === 0, "PART E: the card offered a DM control while the adapter does not " +
  "know `chat.dm` — a control wired to a feature that does not exist");
ok(dmCount(dmPresent) === 1, "PART E: the card offered NO DM control even when the adapter knows " +
  "`chat.dm`, so J15 cannot plug into this container by adding a catalog entry — which is the " +
  "whole reason J14 goes first");

// ── AND THE SLOT'S OWN BRANCH, WHICH NOTHING WAS PINNING ────────────────────────────────────
// `closeOnRun` was added by J15 and left unguarded: deleting `if (spec.closeOnRun) {
// _closeUserCard(); return; }` left the whole suite green. It is not cosmetic. `Chat.openDM`
// RESOLVES `{ ok: false, reason: "self" }` for a self-DM rather than rejecting, so without the
// early return that result falls straight into the verdict branch below it — and that branch's
// wording is about a ROOM SET. A person who DMs themselves is told **"Not finished: 0 of 0
// channels done, 0 still open"**, which is `roles.md` §10's second signature exactly: a sentence
// naming an action nobody took, in a vocabulary belonging to a different verb, that reads as a
// real failure report.
//
// Driven at the resolved value that actually reaches it, not at a rejection — a rejection would
// take the catch path and prove nothing about this branch.
const dmSelf = P.driveCard({
  describeAnswers: { "rank.assign": DENIED, "member.kick": PERMITTED, "member.ban": DENIED,
    "chat.dm": PERMITTED },
  performResult: { ok: false, reason: "self" },
});
gate("card", dmSelf, { expectOffered: true }, "PART E (self-DM)");
function selfDMPart() {
  const node = dmSelf.click("chat.dm");
  ok(!!node, "PART E premise: no live `chat.dm` control to click, so the branch below is never " +
    "reached and its absence would read as a pass");
  // The perform is a resolved promise; let its .then run before reading what the card shows.
  return Promise.resolve().then(() => {}).then(() => {
    ok(dmSelf.performed.some((p) => p.action === "chat.dm"),
      "PART E premise: the click did not reach `Actions.perform`, so nothing produced a result " +
      "for the branch under test to mishandle", dmSelf.performed);
    ok(dmSelf.closed.length === 1,
      "PART E: an action that opens its own surface must CLOSE the card — a DM panel opens behind " +
      "the card's overlay, so a card left up covers what the click just opened", dmSelf.closed);
    const shown = dmSelf.texts().join(" | ");
    ok(shown.indexOf("channels done") < 0,
      "PART E: THE CARD TOLD A PERSON WHO DMed THEMSELVES `Not finished: 0 of 0 channels done`. " +
      "`openDM` RESOLVES {ok:false, reason:\"self\"} rather than rejecting, so without the " +
      "`closeOnRun` early return that value reaches a verdict branch whose vocabulary belongs to a " +
      "ban — a false narrative about a room set nothing touched", shown.slice(0, 200));
  });
}

// ═══ PART F — a PARTIAL removal is never reported as a success ═══════════════════════════════
// The consequence J14's entry names: a room is 21 Matrix rooms, a ban is 21 bans, and a partial
// ban looks exactly like a success. Driven at both layers — the transport's verdict, and what the
// card puts in front of a person.
// THE ROOM SET'S SIZE, read from the transport rather than written here. A room is the Space plus
// every channel in the taxonomy; a ban is a ban in each of them, and a partial ban looks exactly
// like a success — which is what PART F exists to refuse.
const EXPECTED_ROOMS = (() => {
  const rows = P.channelTaxonomyRows ? P.channelTaxonomyRows() : null;
  return (rows && rows.length) ? rows.length + 1 : null;
})();

const loops = [];
function loopPart() {
  return Promise.resolve()
    // the CONTROL first: without it a refusal is not attributable to the partial failure
    .then(() => P.driveMembershipLoop("banFromRoom", { failOn: null }))
    .then((r) => {
      gate("loop", r, {}, "PART F (control)");
      loops.push(r);
      // DERIVED, NOT RESTATED (v322). This read `=== 21`, and the probe next door already builds
      // its room set FROM the transport's own taxonomy precisely so the count is the tree's — so
      // the literal here was the second copy, and adding one channel turned this red while the
      // thing it guards was untouched. What the premise needs to establish is that the loop covers
      // EVERY room, which is the taxonomy's length plus the Space.
      ok(r.roomCount === EXPECTED_ROOMS,
        "PART F premise: the room set is " + r.roomCount + " rooms, not the " + EXPECTED_ROOMS +
        " the transport's taxonomy declares (every channel, plus the Space)");
      ok(r.result.ok === true, "PART F control: a ban with every call succeeding reported ok=" +
        r.result.ok + " — if the complete case cannot report success, the partial case below " +
        "proves nothing about partiality");
      ok(r.result.closed === r.result.total, "PART F control: closed " + r.result.closed +
        " of " + r.result.total);
      // the Space goes FIRST — while it is open the target can join channels the loop has not
      // reached, so the room set could grow underneath it
      ok(r.calls.length > 0 && r.calls[0].roomId === "!space:hs",
        "PART F: the first call was against " + (r.calls[0] && r.calls[0].roomId) + " rather than " +
        "the Space. Read-by-all channels are restricted-join on Space membership, so a loop that " +
        "closes the Space last can be overtaken by its own subject");
      ok(r.calls.length === r.roomCount, "PART F: " + r.calls.length + " calls for " + r.roomCount +
        " rooms — the loop does not cover the room set");
    })
    // ONE room refusing
    .then(() => P.driveMembershipLoop("banFromRoom", {
      failOn: (roomId) => roomId.indexOf("chat_staff") >= 0,
    }))
    .then((r) => {
      gate("loop", r, {}, "PART F (one refusal)");
      ok(r.result.ok === false, "PART F: a ban with one room refusing reported ok=true. Twenty " +
        "rooms closed and one open is a person who can still write to this room, and every other " +
        "client will fold what they write");
      ok(r.result.closed === r.result.total - 1, "PART F: closed " + r.result.closed + " of " +
        r.result.total + " with one refusal");
      ok(r.result.failed.length === 1, "PART F: the verdict names " + r.result.failed.length +
        " failed rooms, expected 1 — a caller cannot retry what it is not told about");
      // the loop KEEPS GOING past a refusal; stopping at the first is what leaves the rest open
      ok(r.calls.length === r.roomCount, "PART F: the loop made " + r.calls.length + " calls after " +
        "a refusal, expected " + r.roomCount + " — it stopped early, leaving the remaining rooms open");
    })
    // a room this client cannot READ BACK is not a room it may call closed
    .then(() => P.driveMembershipLoop("banFromRoom", {
      invisible: (roomId) => roomId.indexOf("chat_guest") >= 0,
    }))
    .then((r) => {
      gate("loop", r, {}, "PART F (unverifiable)");
      ok(r.result.ok === false, "PART F: a room whose membership could not be read back was " +
        "counted as closed. `I can't tell` is not `it worked`, and the fail-closed direction here " +
        "costs a retry while the other costs the hole this function exists to prevent");
      ok(r.result.unverified.length === 1, "PART F: the verdict names " + r.result.unverified.length +
        " unverified rooms, expected 1");
    })
    // kick has the same rule — one shared body, asserted rather than assumed
    .then(() => P.driveMembershipLoop("kickFromRoom", {
      failOn: (roomId) => roomId.indexOf("events_vip") >= 0,
    }))
    .then((r) => {
      gate("loop", r, {}, "PART F (kick)");
      ok(r.result.ok === false, "PART F: a partial KICK reported success — the all-or-nothing rule " +
        "is in the ban path only, which is one rule in one of the two places it is needed (P3)");
      ok(r.calls.every((c) => c.op === "kick"), "PART F: kickFromRoom made a non-kick call");
    })
    // and what a PERSON is told: the card must not print a success over a partial verdict
    .then(() => {
      const r = P.driveCard({
        member: { userId: "@them:hs", name: "Them", level: 0 },
        describeAnswers: { "rank.assign": DENIED, "member.kick": DENIED, "member.ban": PERMITTED },
        performResult: { ok: false, op: "ban", total: 21, closed: 20,
          failed: ["!chat_staff:hs"], unverified: [] },
      });
      gate("card", r, { expectOffered: true }, "PART F (card)");
      const btn = r.click("member.ban");
      ok(btn !== null, "PART F premise: no live `member.ban` control to click, so the click path " +
        "below was never entered and its assertions are about nothing");
      ok(r.performed.length === 0, "PART F: the first click PERFORMED rather than arming — a " +
        "removal has no undo the way a mis-struck song does, so it takes a deliberate second click");
      btn.onclick();
      ok(r.performed.length === 1, "PART F: the second click did not perform");
      // let the promise settle, then read what the card put in front of the person
      return Promise.resolve().then(() => Promise.resolve()).then(() => {
        const note = findNote(r);
        ok(note !== null, "PART F premise: the card mounted no note element, so what it reports " +
          "cannot be read and the assertion below would pass for free");
        ok(/still open|Not finished/.test(note),
          "PART F: after an INCOMPLETE ban the card told the person " + JSON.stringify(note) +
          ". Twenty of twenty-one is not done, and a card that prints a success over it is the " +
          "failure J14's entry says will bite on day one");
        ok(!/^Done/.test(note), "PART F: the card printed a success over a partial verdict");
      });
    });
}

// The card's own result line, found by walking what it mounted. Matched on the class the card
// gives it rather than on position, so re-ordering the card does not silently stop this finding it
// — and a miss is reported as a PREMISE failure above rather than read as an empty message.
function findNote(r) {
  let found = null;
  function walk(n) {
    if (!n || typeof n !== "object" || found !== null) return;
    if (typeof n.className === "string" && n.className.indexOf("uc-note") >= 0 && n.text) {
      found = n.text; return;
    }
    for (const c of (n.children || [])) walk(c);
  }
  for (const m of (r.mountedNodes || [])) walk(m);
  return found;
}

// ═══ PART G — the feature layer refuses what a stale descriptor would have allowed ═══════════
// J14's Done-when asks that "the reducer still rejects the act even if the button were somehow
// pressed". For a MEMBERSHIP act there is no reducer and never can be, so the second enforcer is
// `Room.canModerate`, which re-reads both ranks live rather than trusting the click. Asserted
// here rather than left as a comment, because the entry's wording implies a backstop that does
// not exist for these two verbs and somebody will look for it.
function partG() {
  const calls = [];
  const RoomStub = {};
  const sandbox = loadInContext(
    ["backends/backend1/ranks.js", "backends/backend1/statederiver.js",
      "backends/backend1/capabilities.js", "features/room.js"],
    {
      StreamManager: { getState: () => ({}), reset() {}, on() {} },
      MatrixBridge: {
        getUserId: () => "@me:hs",
        // @me is staff(60); @ok is a VIP(40) BELOW me — the control; @them is high-staff(80),
        // who OUTRANKS me, which is the case the re-check exists for.
        getUserEffectiveRank: (s, c, u) => (u === "@me:hs" ? 60 : (u === "@ok:hs" ? 40 : 80)),
        banFromRoom: (...a) => { calls.push(["ban", a]); return Promise.resolve({ ok: true }); },
        kickFromRoom: (...a) => { calls.push(["kick", a]); return Promise.resolve({ ok: true }); },
        getSpaceVisibility: () => "private",
        onRankChange() {}, onChannelAdded() {},
      },
      Logger: { info() {}, warn() {}, debug() {}, error() {} },
      Date, Math, JSON, Promise,
      setTimeout: () => 0, clearTimeout: () => {},
    }
  );
  const Room = sandbox.Room;
  ok(Room && typeof Room.canModerate === "function",
    "PART G: `Room.canModerate` does not exist, so a membership act has exactly one enforcer — " +
    "the rulebook that rendered the button");

  // the pure rule, asked directly
  ok(Room.canModerate("member.kick", 60, 40) === true,
    "PART G premise: canModerate refused a staff actor over a VIP target, so every refusal " +
    "below would be free");
  ok(Room.canModerate("member.kick", 60, 80) === false,
    "PART G: canModerate permitted acting on somebody who OUTRANKS the actor");
  ok(Room.canModerate("member.kick", 60, 60) === false,
    "PART G: canModerate permitted acting on an equal");
  ok(Room.canModerate("member.ban", 60, 40) === false,
    "PART G: canModerate let a staff actor BAN — ban is owner-gated (PART A), and a second " +
    "opinion about that is a second rule");

  // and the async path refuses with LIVE ranks, not the ones the click carried
  Room._setCurrentForTest({ name: "R", spaceId: "!space:hs", channels: { events_owner: "!e:hs" } });
  // THE CONTROL FIRST. Without it, `ok:false` below is not attributable to the rank re-check —
  // an unbound room, a missing transport method or a thrown promise all produce the same refusal,
  // and a refusal that could come from anywhere is evidence of nothing.
  return Room.kick("@ok:hs").then((allowed) => {
    ok(allowed && allowed.ok === true, "PART G control: `Room.kick` refused a target the live " +
      "ranks put below the actor (answered " + JSON.stringify(allowed) + ") — so the refusal " +
      "asserted next cannot be attributed to the rank comparison");
    ok(calls.length === 1 && calls[0][0] === "kick",
      "PART G control: a permitted kick did not reach the transport");
    calls.length = 0;
    return Room.ban("@them:hs");
  }).then((res) => {
    ok(res && res.ok === false && res.reason === "denied",
      "PART G: `Room.ban` went through against a target the live ranks say outranks the actor — " +
      "it answered " + JSON.stringify(res) + ". A descriptor rendered before a promotion must " +
      "not authorise an act after one");
    ok(calls.length === 0, "PART G: a denied `Room.ban` still called the transport (" +
      calls.length + " calls) — the refusal is cosmetic");
  });
}

Promise.resolve()
  .then(selfDMPart)
  .then(loopPart)
  .then(partG)
  .then(() => {
    console.log("[user-card] PASS — the two moderation acts are gated where the HOMESERVER will " +
      "actually enforce them (ban=owner, kick=staff, both derived by EXECUTING _powerLevels rather " +
      "than restated, so weakening one without the other turns this red instead of shipping a " +
      "button that answers 403); the rules are `rank.assign`'s pattern rather than a second one — " +
      "identical grids across the whole ladder where they share a gate, ban strictly stricter, " +
      "nobody acting upward, sideways or on themselves, and the diagonal refused by the " +
      "strictly-below comparison rather than by a self clause; the card is EXTRACTED FROM " +
      "ui/interface.js AND EXECUTED, because nine guards read that file and none runs it, and it " +
      "offers live controls only where the descriptor says so, disabled ones carrying the " +
      "backend's own reason, asking about a real target rather than about nobody; the DM slot is " +
      "driven BOTH ways, so \"the container J15 plugs into\" is measured rather than asserted — " +
      "one catalog entry lights it up with no edit to the UI; a PARTIAL removal is never a " +
      "success at either layer (the Space closes first so the loop cannot be overtaken by its own " +
      "subject, the loop keeps going past a refusal instead of leaving the rest open, a room that " +
      "cannot be read back is unverified rather than closed, kick shares the rule rather than " +
      "having its own, and the card tells a person what is still open instead of printing Done); " +
      "and because a membership act has NO reducer to back it up, Room.canModerate re-reads both " +
      "ranks live and refuses a stale click before the transport is ever called (" + checks +
      " assertions)");
  })
  .catch((e) => {
    console.log("[user-card] FAIL — " + (e && e.stack || e));
    process.exit(1);
  });
