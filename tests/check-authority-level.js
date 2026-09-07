// tests/check-authority-level.js
// WALL: DECISIONS ABOUT WHO OUTRANKS WHOM READ THE AUTHORITY LEVEL, NOT THE CHANNEL TIER.
//
// TWO FUNCTIONS ANSWER "WHAT RANK AM I?" ON DIFFERENT SCALES, and nothing in their names says so:
//   · `Room.getMyRank()`            the highest EVENTS CHANNEL this client can write to. Caps at
//                                   the owner channel's rank, so a human owner at Matrix power
//                                   level 100 answers **99** — the same number the bot answers,
//                                   because both can write there.
//   · `Room.getMyAuthorityLevel()`  the highest level held across the Space and every channel.
//                                   The Space is where a human owner's 100 lives.
//
// The first is right for "what may I author". The second is right for "who outranks whom". Using
// the first where the second belongs is not a rounding error: it collapses the one distinction the
// bot design rests on, and it has now broken two things in production.
//
//   1. THE UPGRADE BUTTON did nothing for every owner until it was fixed. `_mayUpgrade` compared a channel
//      tier against the space-child requirement of 100 and refused everyone.
//   2. THE RANK DROPDOWN had no Owner option (reported after a live upgrade). The rule is "ranks
//      strictly below your own", the UI asked for the tier, and `99 < 99` is false — so the one
//      person entitled to appoint a bot could never see the option.
//
// PART A — the two readings genuinely differ, and only at the top.
// PART B — exactly three verbs change answer between them. Derived, not listed.
// PART C — those three read the AUTHORITY level.
// PART D — an owner can offer the bot rank; a bot cannot.

const path = require("path");
const fs = require("fs");
const { loadInContext, ROOT } = require("./_load.js");

let A = 0, failed = 0;
function ok(cond, msg, got) {
  A++;
  if (cond) return;
  failed++;
  console.log("[authority-level] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
}

const C = loadInContext([
  "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/capabilities.js",
], { Date }).Capabilities;
const R = loadInContext(["backends/backend1/ranks.js"]).Ranks;

const BOT = Math.max.apply(null, C.LADDER.map((r) => r.level));   // the ladder's top rung
const HUMAN = 100;                                                // the Space's owner level

// ── PART A — THE TWO READINGS DIFFER, AND ONLY AT THE TOP ────────────────────────────────────
{
  ok(BOT === 99,
    "A: APPLIED — the ladder's top rung is the bot's level. If this moves, every number below "
    + "moves with it and this file should be re-read rather than patched", BOT);
  ok(HUMAN > BOT,
    "A: the human owner's Space level must sit ABOVE the ladder's top rung — that gap is the whole "
    + "distinction, and `Ranks.nameOf` calls both `owner` because the ladder SATURATES", { HUMAN, BOT });
  ok(R.nameOf(BOT) === R.nameOf(HUMAN),
    "A: and both are named `owner`, which is exactly why a NAME cannot be used to tell them apart "
    + "and a LEVEL must be", { bot: R.nameOf(BOT), human: R.nameOf(HUMAN) });
}

// ── PART B — WHICH VERBS CARE, DERIVED ──────────────────────────────────────────────────────
// Not a written list. Every verb is asked at both readings across the target shapes that exist,
// and the ones that disagree are the answer. A list here would be a second copy that goes stale
// the first time a verb is added.
{
  const shapes = [
    { targetRank: 0, newLevel: BOT }, { targetRank: 0, newLevel: 80 },
    { targetRank: BOT }, { targetRank: 80 }, { targetRank: 0 }, {},
  ];
  const differ = new Set();
  for (const v of C.VERBS) {
    for (const t of shapes) {
      const asTier = C.can(v, {}, { myId: "@me:hs", myRank: BOT, target: t }).permitted;
      const asAuth = C.can(v, {}, { myId: "@me:hs", myRank: HUMAN, target: t }).permitted;
      if (asTier !== asAuth) differ.add(v);
    }
  }
  const found = [...differ].sort();
  ok(found.length > 0,
    "B: APPLIED — some verb must differ between the two readings, or there is nothing to guard "
    + "and this file is asserting about a distinction that no longer exists", found);
  ok(JSON.stringify(found) === JSON.stringify(["member.ban", "member.kick", "rank.assign"]),
    "B: exactly these three verbs change answer between a channel tier and an authority level, and "
    + "all three are the same question — may I act on somebody at the TOP RUNG. If this set grows, "
    + "the new verb needs the authority reading too and PART C must cover it", found);
}

// ── PART C — THE THREE READ THE AUTHORITY LEVEL ─────────────────────────────────────────────
{
  const act = fs.readFileSync(path.join(ROOT, "features/actions.js"), "utf8");
  ok(/getMyAuthorityLevel/.test(act),
    "C: the capability layer's `myRank` must read the AUTHORITY level. It read `getMyRank()` — the "
    + "channel tier — so an owner asking `may I grant Owner?` was compared as the bot's level and "
    + "the option vanished from the UI");

  const room = fs.readFileSync(path.join(ROOT, "features/room.js"), "utf8");
  ok(/function getMyAuthorityLevel/.test(room),
    "C: and the reader must exist in the feature layer");
  const i = room.indexOf("function getMyAuthorityLevel");
  const body = room.slice(i, i + 900);
  ok(/getUserEffectiveRank\(/.test(body),
    "C: it must read across the SPACE and the channels — the Space is where a human owner's level "
    + "above the ladder actually lives, and a channel-only reading cannot see it", body.slice(0, 200));
  ok(/current\.spaceId/.test(body),
    "C: naming the space explicitly, not just the channels");

  // AND THE ENFORCEMENT ALREADY READ IT, which is why the ACT was never broken — only the control
  // that offers it. Worth asserting: a fix that changed enforcement to match the broken display
  // would have "fixed" the symptom by breaking the rule.
  const ai = room.indexOf("async function assignRank");
  const abody = room.slice(ai, ai + 1200);
  ok(/getUserEffectiveRank\(/.test(abody),
    "C: `assignRank` must keep enforcing on the effective rank. Display and enforcement disagreeing "
    + "is how this shipped enforced-correctly and shown-wrongly; they must agree by both reading "
    + "the same thing, not by the stricter one being relaxed");
}

// ── PART D — AN OWNER MAY OFFER THE BOT RANK; A BOT MAY NOT ─────────────────────────────────
// The reported symptom, driven at the capability that decides whether the control renders.
{
  const asOwner = C.can("rank.assign", {}, { myId: "@me:hs", myRank: HUMAN, target: { targetRank: 0, newLevel: BOT } });
  ok(asOwner.permitted === true,
    "D: THE REPORTED FAULT. The human owner must be able to grant the bot's rank — it is the only "
    + "way to appoint a bot from the app, and without it the feature is reachable only through a "
    + "different Matrix client", asOwner);

  const asBot = C.can("rank.assign", {}, { myId: "@bot:hs", myRank: BOT, target: { targetRank: 0, newLevel: BOT } });
  ok(asBot.permitted === false,
    "D: and an account AT the bot's rank must not grant it to anybody else — `strictly below your "
    + "own` still holds, so a bot cannot appoint a second bot and a room cannot grow two "
    + "authorities that overwrite each other's settings", asBot);

  // The control: the owner can still grant ordinary ranks, so PART D is not passing on a
  // permission that was widened for everybody.
  const ordinary = C.can("rank.assign", {}, { myId: "@me:hs", myRank: R.levelOf("staff"), target: { targetRank: 0, newLevel: R.levelOf("vip") } });
  ok(ordinary.permitted === true,
    "D CONTROL: staff granting VIP is unaffected — the change is a correction to which number is "
    + "read, not a loosening of the rule", ordinary);
  const tooHigh = C.can("rank.assign", {}, { myId: "@me:hs", myRank: R.levelOf("staff"), target: { targetRank: 0, newLevel: R.levelOf("high-staff") } });
  ok(tooHigh.permitted === false,
    "D CONTROL: and staff still cannot grant above themselves", tooHigh);
}

// ── PART E — THE TOP RUNG IS LABELLED WHAT IT IS ────────────────────────────────────────────
// REPORTED FROM A LIVE ROOM once the option finally appeared: *"it says I can make another person
// Owner instead of bot"*. Granting it sets the ladder's top rung, and `BotRuntime` accepts
// **exactly** that level and nothing else — so the option appoints the room's BOT, not a
// co-owner. The label described a rank; the act appoints a role.
//
// This is the same class as the settings panel that told an owner the bot did not exist while they
// were configuring one: text shown to a PERSON, describing something the code does differently.
// The ladder saturating is correct for authority and useless as a label, because `nameOf` answers
// `owner` for both the bot's level and the human owner's.
{
  const ui = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");

  ok(/_BOT_LEVEL/.test(ui),
    "E: the UI must name the top rung as a level rather than by rank NAME — the name is `owner` for "
    + "both the bot and the human owner, so no name-keyed table can separate them");
  ok(/Math\.max\.apply\(null, RANKS\.map/.test(ui),
    "E: derived from the ladder, never written as a number. A literal here is the second copy, and "
    + "a ladder whose top rung moved would relabel everything below it");

  const ri = ui.indexOf("function rankName(level)");
  ok(ri > 0, "E: APPLIED — rankName must exist");
  const rbody = ui.slice(ri, ri + 500);
  ok(/level > _BOT_LEVEL.*Owner/s.test(rbody),
    "E: ABOVE the top rung is the human owner", rbody.slice(0, 160));
  ok(/level === _BOT_LEVEL.*Bot/s.test(rbody),
    "E: and AT it is the bot. Calling that `Owner` is what a live owner read as `make another "
    + "person a co-owner`, which is not what granting it does", rbody.slice(0, 160));

  // THE HEADER NAMES WHO I AM SIGNED IN AS, so it must ask the authority level too. Reported: with
  // the top rung correctly labelled `Bot`, the header called the human OWNER "Bot" — because it
  // asked the channel tier, which caps at that rung for both accounts. The one place a person looks
  // to see who they are could not tell them apart.
  const mri = ui.indexOf("function renderMyRank()");
  ok(mri > 0, "E: APPLIED — renderMyRank must exist");
  // COMMENTS STRIPPED BEFORE ASSERTING, because the first version of this checked that the name
  // APPEARED in the function — and the explanatory comment above the call contains it, so reverting
  // the call left the guard green. Sixth structural assertion this cycle to match prose instead of
  // code; the fix is the same every time, which is to test what RUNS.
  const codeOnly = (src) => src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const mbody = codeOnly(ui.slice(mri, mri + 1600));
  ok(/rankName\(\s*\(?\s*Room\.getMyAuthorityLevel/.test(mbody),
    "E: the header's own rank badge must READ the authority level — not merely mention it. Asking "
    + "the tier labels a human owner with the bot's name, in the one surface that answers `who am "
    + "I`, and makes the two accounts indistinguishable there", mbody.slice(0, 240));

  // THE DROPDOWN OPTION SAYS WHAT PICKING IT DOES. A card badge is a noun; an option in an assign
  // menu is an action, and the consequence — one bot per room — is not something a noun conveys.
  const si = ui.indexOf("function rankSelect(");
  ok(si > 0, "E: APPLIED — rankSelect must exist");
  const sbody = ui.slice(si, si + 1200);
  ok(/_BOT_LEVEL/.test(sbody) && /appoint/.test(sbody),
    "E: the assign option for the top rung must say it APPOINTS the bot, not merely name a rank",
    sbody.slice(0, 200));
}

if (failed) process.exit(1);
console.log("[authority-level] PASS — the decisions about who outranks whom read the AUTHORITY level "
  + "rather than the channel tier. The two differ only at the top and by exactly one rung, because "
  + "the ladder SATURATES: `nameOf` calls both the bot's 99 and a human owner's 100 `owner`, so no "
  + "name can separate them and only a level can. Which verbs care is DERIVED here rather than "
  + "listed — every verb is asked at both readings across every target shape, and exactly three "
  + "disagree (`rank.assign`, `member.kick`, `member.ban`), all of them the same question: may I "
  + "act on somebody at the top rung. Driven at the reported fault: a human owner can offer the "
  + "bot's rank, which is the only in-app way to appoint a bot, while an account already at that "
  + "rank cannot — so a room cannot grow two authorities overwriting each other's settings. "
  + "Enforcement in `assignRank` already read the effective rank and still must: this shipped "
  + "enforced-correctly and shown-wrongly, and the two agree now by reading the same thing rather "
  + "than by the stricter one being relaxed (" + A + " assertions)");
