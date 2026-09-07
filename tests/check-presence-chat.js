// tests/check-presence-chat.js
// WALL: THE PRESENCE CHANNEL'S MEMBERSHIP IS RECONCILED, AND THE FAILURE DIRECTIONS ARE CLOSED.
//
// The presence chat is the first channel whose membership is not decided by RANK. It is
// invite-only, and the owner bot adds and removes people as the ROOM's activity rule says they are
// around or not. Everything that can go wrong here is destructive in a way rank channels are not:
// this is the only code in the tree that removes people from a room on a schedule.
//
// WRITTEN AFTER THE FACT, DELIBERATELY SAID. The reconciliation shipped without a guard — the
// three files that named the channel were the taxonomy, the compat baseline and the idle sweep,
// none of which drives membership. An unguarded destructive path with a green suite is the exact
// shape this tree's audit keeps finding, so the code below is DRIVEN rather than read.
//
// PART A — it reconciles both directions, and the bot is never a candidate.
// PART B — an unreadable membership is a REFUSAL, never "nobody is in it".
// PART C — every other refusal path answers rather than acting.
// PART D — reconnect needs no catch-up: the comparison is against current state.
// PART E — `assignRank` must not touch this channel.
// PART F — removal is a KICK, never a ban.

const path = require("path");
const fs = require("fs");
const { loadInContext, ROOT } = require("./_load.js");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[presence-chat] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const T = 10000000;
const MIN = 60000;
const CH = "!presence:hs";
const STARTED = [];

// Built from the reducer's own defaults, never a hand-written blob: a partial settings object is a
// state no live client can hold, and fixtures that used one are what broke when these keys landed.
function tree(opts) {
  const o = opts || {};
  const sd = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js"], { Date, Math, JSON });
  const settings = sd.StateDeriver.defaultSettings();
  // built harness is chat-blind, withholds every removal, and every assertion below would
  // CHAT OFF. The room default is ON, but a bot only knows chat it has SEEN — so a freshly
  // measures the blindness rather than the reconciliation it is named for. Isolated here.
  // ONE ANSWER AT A TIME.
  settings.botPresenceChat = false;
  for (const k in (o.settings || {})) settings[k] = o.settings[k];

  const calls = { invited: [], removed: [] };
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/statederiver.js",
    "backends/backend1/capabilities.js", "features/room.js", "features/botruntime.js",
  ], {
    Date, Math, JSON, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    window: {}, document: { body: { appendChild() {} } },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    StreamManager: {
      getLog: () => o.log || [],
      getState: () => ({ settings: settings, rotation: [] }),
      isLegal: () => true, on() {},
    },
    MatrixBridge: {
      getUserId: () => "@bot:hs", getMyRank: () => 99, getRoster: () => [],
      getMyPowerLevel: () => 99, onRawEvent() {}, offRawEvent() {},
      joinedMembersOf: () => ("members" in o) ? o.members : [],
      invitedMembersOf: () => ("invited" in o) ? o.invited : [],
      inviteToPresence: (r, u) => { calls.invited.push(u); return Promise.resolve({ ok: true }); },
      removeFromPresence: (r, u) => { calls.removed.push(u); return Promise.resolve({ ok: true }); },
    },
    ServerClock: { serverNow: () => (("now" in o) ? o.now : T) },
    Chat: { send: () => Promise.resolve({ ok: true }) },
    Queue: { remove: () => Promise.resolve() },
  });
  const started = sb.BotRuntime.start({
    roomId: "!r:hs",
    channels: ("channels" in o) ? o.channels : { presence_chat: CH },
  });
  const out = { sb, calls, settings, started, stop: () => { try { sb.BotRuntime.stop(); } catch (e) {} } };
  STARTED.push(out);
  return out;
}

const act = (id, who, ts, type) => ({ eventId: id, sender: who, ts: ts, type: type });

// ── PART A — BOTH DIRECTIONS, AND NEVER ITSELF ───────────────────────────────────────────────
{
  // @in acted recently; @out is in the channel but has done nothing for longer than the window.
  const t = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@in:hs", T - 1 * MIN, "ddjp.dj.join"),
          act("$2", "@out:hs", T - 90 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs", "@out:hs"],
  });
  const r = t.sb.BotRuntime.reconcilePresence();
  ok(r.ok === true, "A: the reconciliation runs", r);
  ok(r.added.length === 1 && r.added[0] === "@in:hs",
    "A: somebody the room derives as around and who is NOT in the channel is INVITED", r);
  // ── REMOVAL IS NOW TWO STAGES, AND THE FIRST PASS WARNS ───────────────────────────────────
  // This half used to remove the instant somebody fell out of the room's `want`: no warning, no
  // grace, no chance to react — while the queue gave ten minutes and a public message. AFK is one
  // idea and now has one shape, so the first pass warns and only a later one removes.
  //
  // INVITES ARE UNAFFECTED and deliberately so: adding somebody who is around costs them nothing
  // and needs no notice, so the two directions are not symmetric.
  ok(r.removed.length === 0 && r.warned.length === 1 && r.warned[0] === "@out:hs",
    "A: and somebody the room no longer derives as around is WARNED first, not removed", r);
  ok(t.calls.invited.length === 1 && t.calls.removed.length === 0,
    "A: the invite reached the transport and no kick did — a warning is not a removal", t.calls);

  // THE BOT IS NEVER A CANDIDATE, in either direction. It is always in the channel — it has to be,
  // to manage it — and it is never "active" by the room's rule, so a bare comparison would have it
  // remove ITSELF and then be unable to let anybody back in. That is a one-way door.
  ok(r.removed.indexOf("@bot:hs") < 0,
    "A: the bot never removes itself. It is in the channel and never active by the room's rule, so "
    + "a bare set difference would evict the only account that can invite anybody", r);
  ok(t.calls.removed.indexOf("@bot:hs") < 0, "A: and no removal reached the transport for it", t.calls);

  // STEADY STATE IS A NO-OP, which is what makes running this every minute safe.
  const t2 = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@in:hs", T - 1 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs", "@in:hs"],
  });
  const r2 = t2.sb.BotRuntime.reconcilePresence();
  ok(r2.added.length === 0 && r2.removed.length === 0,
    "A: an already-correct channel is left alone — the pass runs every minute, so anything else "
    + "would be a stream of invites and kicks at people who are exactly where they belong", r2);
  ok(r2.active === 1 && r2.inChannel === 1,
    "A: and it still reports what it compared, so 'nothing to do' is distinguishable from 'nobody "
    + "is around' — the two look identical in the empty arrays", r2);
}

// ── PART B — UNREADABLE MEMBERSHIP IS A REFUSAL ──────────────────────────────────────────────
// THE MOST DESTRUCTIVE FAILURE AVAILABLE HERE. Read as "nobody is in it", an unsynced channel
// makes every active person look missing and this invites the entire room at once — a plausible
// value standing where a refusal belongs, on the one path that acts on other people's membership.
{
  const t = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@a:hs", T - 1 * MIN, "ddjp.dj.join"),
          act("$2", "@b:hs", T - 1 * MIN, "ddjp.dj.join"),
          act("$3", "@c:hs", T - 1 * MIN, "ddjp.dj.join")],
    members: null,
  });
  const r = t.sb.BotRuntime.reconcilePresence();
  ok(r.ok === false && r.reason === "membership-unreadable",
    "B: null membership REFUSES, naming why", r);
  ok(r.added.length === 0 && t.calls.invited.length === 0,
    "B: and invites NOBODY. Three people are active and none is in the channel, so a reconciler "
    + "that read null as empty would invite all three — this is the assertion that proves it does "
    + "not", { reported: r.added, sent: t.calls.invited });

  // THE CONTROL: the same three, with a readable EMPTY channel, ARE invited. Without this, PART B
  // would pass on a reconciler that never invites anybody.
  const t2 = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@a:hs", T - 1 * MIN, "ddjp.dj.join"),
          act("$2", "@b:hs", T - 1 * MIN, "ddjp.dj.join"),
          act("$3", "@c:hs", T - 1 * MIN, "ddjp.dj.join")],
    members: [],
  });
  const r2 = t2.sb.BotRuntime.reconcilePresence();
  ok(r2.ok === true && r2.added.length === 3,
    "B CONTROL: a READABLE empty channel invites all three — so the refusal above is null being "
    + "distinguished from empty, not a reconciler that does nothing", r2);
}

// ── PART C — EVERY OTHER REFUSAL ANSWERS RATHER THAN ACTING ──────────────────────────────────
{
  const noCh = tree({ channels: {}, log: [act("$1", "@a:hs", T, "ddjp.dj.join")] });
  const r1 = noCh.sb.BotRuntime.reconcilePresence();
  ok(r1.ok === false && r1.reason === "no-presence-channel",
    "C: a room whose upgrade has not created the channel refuses by name — every room built "
    + "before the presence channel existed is in this state, so it is the common case rather than "
    + "an edge", r1);
  ok(noCh.calls.invited.length === 0 && noCh.calls.removed.length === 0,
    "C: and touches nothing", noCh.calls);

  const noClock = tree({ now: 0, log: [act("$1", "@a:hs", T, "ddjp.dj.join")], members: [] });
  const r2 = noClock.sb.BotRuntime.reconcilePresence();
  ok(r2.ok === false && r2.reason === "no-clock",
    "C: no server clock refuses. Presence is a reading against a SERVER stamp, and falling back "
    + "to a local one would compare two different clocks", r2);
  ok(noClock.calls.invited.length === 0 && noClock.calls.removed.length === 0,
    "C: and touches nothing", noClock.calls);

  // NOT RUNNING: the bot is off, or this is a room it has left.
  const off = tree({ log: [], members: [] });
  off.sb.BotRuntime.stop();
  const r3 = off.sb.BotRuntime.reconcilePresence();
  ok(r3.ok === false && r3.reason === "not-running",
    "C: a stopped runtime reconciles nothing — otherwise a room the client has left keeps having "
    + "its membership rewritten", r3);
}

// ── PART D — RECONNECT NEEDS NO CATCH-UP ─────────────────────────────────────────────────────
// The design's snap-back. Live-only governs acting on EVENTS; this repairs STATE. Because the
// comparison is against CURRENT state on both sides, an hour offline costs one pass — there is no
// queue, no replay and no catch-up path to get wrong.
{
  const t = tree({
    settings: { botAfkMs: 10 * MIN },
    // An hour of drift: two people became active, two went away, none of it observed.
    log: [act("$1", "@new1:hs", T - 2 * MIN, "ddjp.dj.join"),
          act("$2", "@new2:hs", T - 1 * MIN, "ddjp.dj.skip"),
          act("$3", "@gone1:hs", T - 200 * MIN, "ddjp.dj.join"),
          act("$4", "@gone2:hs", T - 300 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs", "@gone1:hs", "@gone2:hs"],
  });
  const r = t.sb.BotRuntime.reconcilePresence();
  ok(r.added.length === 2 && r.warned.length === 2 && r.removed.length === 0,
    "D: ONE PASS still sees an hour of drift in both directions — nothing replays and nothing is "
    + "queued, the fold is over the log the client holds NOW and the membership is read NOW. The "
    + "outbound direction is a WARNING rather than a removal, because removals gained a grace "
    + "period; what this part measures is that the pass sees all four in one go", r);
  // AND THE SECOND STAGE STILL ARRIVES. Without this, PART D would pass on a reconcile that had
  // quietly stopped removing anybody at all.
  const t2b = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$3", "@gone1:hs", T - 200 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs", "@gone1:hs"],
  });
  t2b.sb.BotRuntime.reconcilePresence();                       // warns
  t2b.sb.ServerClock.serverNow = () => T + 11 * MIN;           // past the default botPingMs
  const late = t2b.sb.BotRuntime.reconcilePresence();
  ok(late.removed.length === 1 && late.removed[0] === "@gone1:hs",
    "D: and once the grace has passed the removal DOES happen — two stages, not a removal that "
    + "was silently dropped", late);

  // ── AND THE GRACE IS REALLY WAITED OUT ────────────────────────────────────────────────────
  // Without this, PART D passes on a reconcile that warns once and then removes on the very next
  // pass regardless of the clock — two stages in name, one in effect.
  {
    const t2c = tree({
      settings: { botAfkMs: 10 * MIN },
      log: [act("$3", "@gone1:hs", T - 200 * MIN, "ddjp.dj.join")],
      members: ["@bot:hs", "@gone1:hs"],
    });
    t2c.sb.BotRuntime.reconcilePresence();                     // warns
    t2c.sb.ServerClock.serverNow = () => T + 1 * MIN;          // well inside the 10-minute grace
    const early = t2c.sb.BotRuntime.reconcilePresence();
    ok(early.removed.length === 0 && early.warned.length === 0,
      "D: INSIDE the grace nothing happens — no removal, and no second warning either. A person "
      + "told they have ten minutes must actually get ten minutes", early);
    // ── AND THE PASS SAYS SO RATHER THAN CLAIMING ALL IS WELL ────────────────────────────────
    // Empty lists look identical whether nothing was due or somebody is mid-grace, and the quiet
    // line used to assert `membership already correct` on every pass of the countdown to a
    // removal. The idle sweep was fixed for exactly this; this half was not.
    ok(early.pending === 1,
      "D: the pass REPORTS that somebody is warned and waiting, so the quiet line can describe the "
      + "pass instead of characterising it. Without this the log says the membership is already "
      + "correct throughout the entire grace period", early);
    ok(typeof early.inChannelCount === "number" && early.inChannelCount >= 1,
      "D: and how many it looked at, so an empty channel and a quiet one are different sentences",
      early);
  }


  // AND IT IS IDEMPOTENT: a second pass against a channel that is now correct does nothing.
  const t2 = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@new1:hs", T - 2 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs", "@new1:hs"],
  });
  const a = t2.sb.BotRuntime.reconcilePresence();
  const b = t2.sb.BotRuntime.reconcilePresence();
  ok(a.added.length === 0 && b.added.length === 0 && t2.calls.invited.length === 0,
    "D: and repeated passes are no-ops, so the recovery path is the SAME code as the steady path "
    + "rather than a second one that only runs after an outage", { a, b });
}

// ── PART E — `assignRank` MUST NOT TOUCH THIS CHANNEL ────────────────────────────────────────
// Every other channel's membership follows rank, so a promotion invites and a demotion may kick.
// This one's does not. Left to fall through, a rank change anywhere in the room would re-admit
// people the bot had just removed for being away — and the bot would remove them again on its next
// pass, the two fighting forever with nothing reporting it.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  ok(/function _presenceChatKey\(\)/.test(src),
    "E: the presence channel's key must be DERIVED from the table, not spelled a second time");
  ok(src.indexOf("if (channelKey === _presenceChatKey()) return null;") >= 0,
    "E: the rank-driven membership decision must EXCLUDE the presence channel explicitly");

  // DERIVED, not a literal: renaming the row must carry the exclusion with it.
  const i = src.indexOf("function _presenceChatKey()");
  const body = src.slice(i, i + 400);
  ok(/CHANNELS\.filter\(\(c\) => c\.kind === "presence"\)/.test(body),
    "E: derived by KIND from the channels table. A literal `\"presence_chat\"` here would be the "
    + "second copy, and a renamed row would silently drop the exclusion", body.slice(0, 200));

  // AND IT IS A FUNCTION, NOT A CONST — the table is declared after this point, so a const would
  // read it before initialisation. The same construction-time trap `capabilities.js` hit.
  ok(/function _presenceChatKey/.test(src) && !/const _presenceChatKey\s*=/.test(src),
    "E: a function, so the lookup happens when CALLED — a const would read CHANNELS before it is "
    + "initialised, which is a crash at load rather than a defect at runtime");
}

// ── PART F — REMOVAL IS A KICK, NEVER A BAN ──────────────────────────────────────────────────
// Being away is not misconduct. A ban would stop the bot re-admitting somebody the moment they act
// — turning a reversible reading into a permanent one, on a schedule, with no appeal.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const i = src.indexOf("async function removeFromPresence");
  ok(i > 0, "F: the removal call must exist");
  const body = src.slice(i, i + 700);
  ok(/client\.kick\(/.test(body),
    "F: removal from the presence channel is a KICK");
  ok(!/client\.ban\(/.test(body),
    "F: and never a ban. A banned person cannot be re-invited when they come back, so one quiet "
    + "hour would cost them the channel permanently", body.slice(0, 200));

  // The invite side must be an INVITE, not a forced join — the channel is invite-only and the
  // person still chooses to enter it.
  const j = src.indexOf("async function inviteToPresence");
  ok(j > 0 && /client\.invite\(/.test(src.slice(j, j + 500)),
    "F: and admission is an invite");
}

// ── PART G — THE PRODUCER'S PROMISE, DRIVEN ─────────────────────────────────────────────────
// PART B proves the RECONCILER treats null as a refusal. That is worthless if the thing that
// produces the value never returns null — and PART B could not see it, because the fixture stubs
// `joinedMembersOf`. Driven (P6): making the real function answer `[]` for an unreadable room left
// this whole file green, because a stub cannot fail.
//
// So the shipped function is extracted and run against a fake client. This is the same seam
// `check-bot-wiring` PART E uses for `accountsAtLevel`, and for the same reason: the safety of a
// destructive path rests on one function's promise about a value it cannot compute.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const fnSrc = src.slice(src.indexOf("function joinedMembersOf"),
                          src.indexOf("async function inviteToPresence"));
  ok(fnSrc.indexOf("function joinedMembersOf") === 0, "G: APPLIED — the function was extracted");

  let room = null;
  const sandbox = { console, client: { getRoom: () => room } };
  require("vm").createContext(sandbox);
  require("vm").runInContext(fnSrc + "\n;globalThis.jm = joinedMembersOf;"
    + "\n;globalThis.im = invitedMembersOf;", sandbox);
  const jm = sandbox.jm;
  const im = sandbox.im;

  room = { getJoinedMembers: () => [{ userId: "@b:hs" }, { userId: "@a:hs" }] };
  const got = jm("!r:hs");
  ok(Array.isArray(got) && got.length === 2 && got[0] === "@a:hs",
    "G: a readable room answers its members, SORTED — so two clients comparing the same channel "
    + "produce the same list rather than one that depends on sync order", got);

  // EVERY UNREADABLE SHAPE MUST ANSWER null, NOT []. An empty array is a real answer meaning
  // "nobody is in this channel", and the reconciler acts on it by inviting everybody active. A
  // function that returned it for a room it could not read would invite the whole room the first
  // time sync was slow — the plausible-value shape, on the only path that touches other people's
  // membership.
  room = null;
  ok(jm("!r:hs") === null, "G: an unknown room is null, never []");
  room = { getJoinedMembers: () => null };
  ok(jm("!r:hs") === null,
    "G: a room whose member list is not an array is null. `[]` here reads as 'this channel is "
    + "empty', and the reconciler would invite every active person into a channel it never read");
  room = { getJoinedMembers: () => { throw new Error("not synced"); } };
  ok(jm("!r:hs") === null, "G: and a throw is null rather than propagating or defaulting");
  room = {};
  ok(jm("!r:hs") === null, "G: a room with no member accessor at all is null");
  ok(jm(null) === null && jm("") === null, "G: and no room id is null");

  // THE CONTROL: an ACTUALLY empty channel is `[]` and not null, because that distinction is the
  // whole point — PART B's control depends on it being expressible.
  room = { getJoinedMembers: () => [] };
  const empty = jm("!r:hs");
  ok(Array.isArray(empty) && empty.length === 0,
    "G CONTROL: a readable EMPTY channel answers `[]`, so 'nobody is in it' stays sayable. "
    + "Without this the null above could be a function that answers null for everything", empty);

  // ── THE SIBLING, WHOSE null MEANS THE OPPOSITE THING ────────────────────────────────────────
  // `invitedMembersOf` answers "who has been asked and not answered". Its null makes the caller
  // fall back to the joined list and ask again, which is the safe direction HERE — a duplicate
  // invite is noise, while withholding one leaves somebody outside a channel with nothing saying
  // why. That is the reverse of `joinedMembersOf`, whose null must refuse the whole pass. Two
  // reads, one contract shape, two opposite consequences, so both are driven rather than one
  // being assumed from the other.
  room = { getMembersWithMembership: (m) => (m === "invite" ? [{ userId: "@b:hs" }, { userId: "@a:hs" }] : []) };
  const inv = im("!r:hs");
  ok(Array.isArray(inv) && inv.length === 2 && inv[0] === "@a:hs",
    "G: the invited read answers the INVITE membership, sorted the same way", inv);
  ok(room.getMembersWithMembership("join").length === 0,
    "G: APPLIED — and it asks for `invite` specifically, so a joined member is not counted as "
    + "somebody still waiting to answer");
  room = null;
  ok(im("!r:hs") === null, "G: an unknown room is null here too");
  room = { getMembersWithMembership: () => null };
  ok(im("!r:hs") === null, "G: a non-array answer is null");
  room = { getMembersWithMembership: () => { throw new Error("not synced"); } };
  ok(im("!r:hs") === null, "G: and a throw is null");
  room = {};
  ok(im("!r:hs") === null,
    "G: a room with no invited accessor is null — an older SDK degrades into re-inviting, which "
    + "is the behaviour this replaces rather than silence");
  room = { getMembersWithMembership: () => [] };
  const noneInvited = im("!r:hs");
  ok(Array.isArray(noneInvited) && noneInvited.length === 0,
    "G CONTROL: and 'nobody is waiting' is expressible as `[]`, or the nulls above would be a "
    + "function that answers null for everything", noneInvited);
}

// ── PART J — ASKED IS NOT ASKED AGAIN, AND ASKED IS NOT IN ───────────────────────────────────
// The add loop read the JOINED list, so somebody sitting on an unanswered invite looked missing on
// every pass and was invited again once a minute, forever — one duplicate invite state event per
// pass against a rate-limited homeserver. It was invisible because it worked: the person did
// eventually get in, and the noise was the mechanism.
//
// NOT FIXED WITH A COOLDOWN. That would be a timer, a number nobody has a value for, and a SECOND
// place answering "have I already asked this person" — competing with the membership state, which
// is the real answer and the only one that survives the bot restarting. So the reconcile keeps
// reading what is true now; it just reads the right thing.
//
// THE TWO HALVES READ DIFFERENT SETS, AND THAT IS THE WHOLE CARE HERE. `offered` (joined OR
// invited) gates the ADD; `have` (joined only) still gates the REMOVAL. Merging them would count
// an invited-and-never-joined person as in the channel, warn them in public, and then try to kick
// somebody who was never there.
{
  const t = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@asked:hs", T - 1 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs"],
    invited: ["@asked:hs"],
  });
  const r = t.sb.BotRuntime.reconcilePresence();
  ok(r.added.length === 0 && t.calls.invited.length === 0,
    "J: somebody active who already HOLDS an invite is not invited again — the pending invite is "
    + "the answer to 'does this person still need asking', and re-asking is a duplicate state "
    + "event every pass for as long as they take to accept", { r, invited: t.calls.invited });
  ok(r.awaiting === 1,
    "J: AND THE PASS SAYS SO. Silent is the right behaviour and the wrong report: they are now in "
    + "no list at all — not added, not in the channel, not warned — which is exactly the shape "
    + "that hid a refused kick for three sessions", r);
  ok(r.removed.length === 0 && r.warned.length === 0,
    "J: and an invited-not-joined person is NOT treated as being in the channel. The removal half "
    + "still reads the JOINED set, or the bot would warn somebody in public and then try to kick "
    + "a person who never arrived", r);

  // THE CONTROL, and it is the row that makes the first one a reading rather than a pass that
  // invited nobody: the same person, same window, with no invite outstanding.
  const c = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@asked:hs", T - 1 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs"],
    invited: [],
  });
  const rc = c.sb.BotRuntime.reconcilePresence();
  ok(rc.added.length === 1 && rc.added[0] === "@asked:hs" && c.calls.invited.length === 1,
    "J CONTROL: with no invite outstanding the same person IS invited, so the row above is the "
    + "invited set doing work rather than a reconciler that stopped acting", { rc, invited: c.calls.invited });

  // UNREADABLE FALLS BACK TO ASKING AGAIN. `null` means "I do not know who has been asked", and a
  // duplicate invite is noise while a withheld one leaves somebody outside a channel they are
  // entitled to with nothing saying why — which is the defect this feature exists to prevent. The
  // safe direction here is the opposite of `joinedMembersOf`'s, whose null must refuse.
  const u = tree({
    settings: { botAfkMs: 10 * MIN },
    log: [act("$1", "@asked:hs", T - 1 * MIN, "ddjp.dj.join")],
    members: ["@bot:hs"],
    invited: null,
  });
  const ru = u.sb.BotRuntime.reconcilePresence();
  ok(ru.added.length === 1 && u.calls.invited.length === 1,
    "J: an UNREADABLE invited set re-invites rather than assuming the person was already asked. "
    + "Erring the other way is silence, and silence is the whole defect", { ru, invited: u.calls.invited });
}

// ── PART H — THE UPGRADE CAN ACTUALLY REACH BATCH 4 ─────────────────────────────────────────
// FOUND BY AUDIT, NOT BY THE SUITE. The channel row, the batch table and the whole reconciliation
// shipped correct, and `highestPresentBatch` walked a LITERAL `[2, 3]` — so a room holding every
// channel reported batch 3, and the upgrade would offer a batch 4 that was already complete,
// forever. Every guard was green: nothing anywhere read a batch NUMBER.
//
// This is the shape the tree keeps finding — a table extended in three places and read in a
// fourth that was written before the table could grow.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const table = src.slice(src.indexOf("const CHANNELS = ["), src.indexOf("// Canonical string forms"));
  const batches = src.slice(src.indexOf("const UPGRADE_BATCHES = {"),
                            src.indexOf("async function createUpgradeBatch"));
  const sandbox = { console };
  require("vm").createContext(sandbox);
  require("vm").runInContext(table + "\n" + batches
    + "\n;globalThis.H = highestPresentBatch; globalThis.C = CHANNELS;", sandbox);
  const H = sandbox.H, C = sandbox.C;

  const present = (pred) => {
    const m = {};
    for (const c of C) { if (pred(c)) m[c.key] = "!" + c.key + ":hs"; }
    return m;
  };
  const top = Math.max.apply(null, C.map((c) => c.batch));
  // EVERY BATCH NUMBER BELOW IS DERIVED FROM `top`, AND THIS PART USED TO RESTATE THEM. It opened
  // `ok(top === 4, ...)` and then tested `batch !== 4` and `batch !== 3` as literals — inside the
  // part whose whole purpose is that `highestPresentBatch` reads the TABLE rather than a list. So
  // moving `presence_chat` from batch 4 into batch 3 turned it red for the reason it was written
  // to prevent: a number restated where it should have been read. It now says only that there is
  // MORE THAN ONE batch, which is what the assertions actually need.
  ok(top >= 2, "H: APPLIED — the table has at least two batches, or the gap cases below test "
    + "nothing", top);

  ok(H(present(() => true)) === top,
    "H: a room holding EVERY channel reports the table's highest batch. A literal list here "
    + "reported 3 with all 21 present, so the upgrade offered a completed batch forever", H(present(() => true)));
  ok(H(present((c) => c.batch !== top)) === top - 1,
    "H: a room missing the TOP batch's channels reports the one below it — so the last batch is "
    + "genuinely OFFERED rather than skipped", H(present((c) => c.batch !== top)));
  ok(H(present((c) => c.batch !== top - 1)) === Math.max(1, top - 2),
    "H: and a gap one batch down still stops there rather than counting the top as reached. "
    + "Batches are ordered, and a room cannot have skipped one",
    { got: H(present((c) => c.batch !== top - 1)), expected: Math.max(1, top - 2) });

  // THE LIST IS DERIVED. A literal is what this part exists to prevent recurring.
  ok(/Object\.keys\(UPGRADE_BATCHES\)/.test(src),
    "H: the batch numbers must be READ from the batch table, never listed. A row added to "
    + "`CHANNELS` is how a batch is created, and a literal here silently declines to see it");
  ok(/sort\(\(a, b\) => a - b\)/.test(src),
    "H: and sorted NUMERICALLY — object key order is string order, which puts 10 before 2 the "
    + "moment a tenth batch exists");
}

// ── PART I — THE UPGRADE CAP IS THE TABLE'S, NOT A LITERAL ──────────────────────────────────
// REPORTED FROM A LIVE ROOM: a fully upgraded room still offered an upgrade. `roomupgrade.js` held
// `MAX_BATCH = 3` while `CHANNELS` had four batches, so `currentBatch` reached 4, the panel's
// "All ranks unlocked" branch (`currentBatch >= maxBatch`) never fired, and the button stayed.
//
// SECOND TIME THIS EXACT MISTAKE HAS BEEN FOUND — `highestPresentBatch` carried a literal `[2, 3]`
// and could not see batch 4 either. A table extended in one place and read as a constant in
// another, twice, because the batch NUMBER is what nothing else reads.
{
  const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const ru = fs.readFileSync(path.join(ROOT, "features/roomupgrade.js"), "utf8");

  ok(/function maxUpgradeBatch/.test(mb),
    "I: the transport must expose the table's top batch, so the app never holds a copy of the "
    + "number");
  ok(!/const MAX_BATCH = [0-9]+;/.test(ru),
    "I: and `roomupgrade.js` must NOT hold it as a bare literal — that is exactly what left a "
    + "finished room offering an upgrade");
  ok(/MatrixBridge\.maxUpgradeBatch/.test(ru),
    "I: it asks the transport, because `features/` may not reach the channels table directly");

  // DRIVEN against the real table.
  const table = mb.slice(mb.indexOf("const CHANNELS = ["), mb.indexOf("// Canonical string forms"));
  const fn = mb.slice(mb.indexOf("function maxUpgradeBatch"), mb.indexOf("function highestPresentBatch"));
  const sandbox = {};
  require("vm").createContext(sandbox);
  require("vm").runInContext(table + "\n" + fn + ";globalThis.M = maxUpgradeBatch; globalThis.C = CHANNELS;", sandbox);
  const top = Math.max.apply(null, sandbox.C.map((c) => c.batch));
  ok(sandbox.M() === top,
    "I: and it answers the table's ACTUAL highest batch, so adding a row moves the cap with it",
    { got: sandbox.M(), table: top });
}

for (const t of STARTED) { try { t.stop(); } catch (e) {} }

// THE EXIT CHECK MOVED TO THE LAST LINE, and the reason is that it had drifted here. A part was
// appended BELOW it and printed FAIL while the file exited 0 — caught only by mutating the rule
// and watching a "passing" guard stay green. `check-setting-endpoints` carried the identical
// defect for the identical reason: "below every part" is a fact about POSITION, and position is
// what changes when somebody appends.
// ── CHAT-BLIND WITHHOLDS REMOVALS, AND ONLY REMOVALS ─────────────────────────────────────────
// The room can count chat towards being around, and chat NEVER reaches the Spine — so the fold
// cannot answer it and the bot's own observation must. A bot that just started has seen no chat,
// and treating that as silence would drop people for the bot's own downtime.
//
// ADDITIVE KNOWLEDGE, ADDITIVE EFFECT. Not being able to see chat is only ever a reason to KEEP
// somebody, so blindness withholds REMOVALS and leaves invites alone — the first version refused
// the whole pass, which also withheld invites that chat has nothing to do with.
{
  // THE HARNESS'S OWN SHAPES: settings under `settings`, membership under `members`. A first
  // version passed `{ botPresenceChat: true }` and set `t.MEMBERS` — neither of which this tree
  // reads — so the channel held nobody, nothing could be removed, and the assertion passed
  // without ever reaching the rule. Caught by mutating the rule and watching it stay green.
  const t = tree({ settings: { botPresenceChat: true }, members: ["@stale:hs"] });
  const r = t.sb.BotRuntime.reconcilePresence();
  ok(r.inChannel === 1,
    "APPLIED — the channel really holds somebody, or a removal count of zero means nothing", r);
  ok(r.ok === true,
    "the pass still RUNS while chat-blind — refusing it outright also withholds invites", r);
  ok(r.removed.length === 0 && r.chatBlind === true,
    "but removes nobody, and says which it was — a caller can tell `nobody was due to go` from "
    + "`removals were withheld`", r);
}

console.log("[presence-chat] PASS — the presence channel's membership is RECONCILED against the "
  + "room's own activity rule, in both directions, and every failure direction answers instead of "
  + "acting. Driven: somebody active and absent is invited, somebody present and gone is removed, "
  + "an already-correct channel is left alone, and the bot is excluded from both sides — a bare "
  + "set difference would have it evict the only account able to invite anybody back. The "
  + "destructive failure is closed and PROVED closed: unreadable membership refuses by name and "
  + "invites nobody, with a control where the same three people ARE invited from a readable empty "
  + "channel, so the refusal is null being distinguished from empty rather than a reconciler that "
  + "never acts. A missing channel, a missing clock and a stopped runtime each refuse by their own "
  + "name. Reconnect needs no catch-up path because both sides are read NOW — an hour of drift "
  + "costs one pass, and repeated passes are no-ops, so recovery is the steady code rather than a "
  + "second path that only runs after an outage. `assignRank` excludes the channel by a key DERIVED "
  + "from the table, so a rank change cannot re-admit somebody the bot just removed and start a "
  + "fight neither side reports. Removal is a kick and never a ban, because being away is not "
  + "misconduct and a ban would make one quiet hour permanent (" + A + " assertions)");


if (failed) process.exit(1);   // LAST LINE: appending a part cannot get underneath this