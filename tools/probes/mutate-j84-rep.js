// tools/probes/mutate-j84-rep.js
// SUBJECT: J84-1, REP's foundations — the three room settings (ruling 23), the generic engine hooks E1–E6 (the side-message
// class, `sendSide`, `readChannelBack`, `pageRange`'s stops, the `bot.command` verb, `Store.rep`), the pure rules
// (`features/rep-rules.js`), the ports (`features/rep-ports.js`), the boundary, and PART R (moved to `check-wiring`); and
// J84-2, the bot side (`features/rep-bot.js`) with its hooks H1 and H2, and the one "who is active" function (the owner's
// rulings 30a and 30b); J84-3, the reader (`features/rep-reader.js`), H3 and the People tab's one order; J84-4, the
// fill-back, the rebuild, the window and the Q4 refusal, with ruling 35's real-time redraw; and J84-5, commands, files, the
// bot's own settings and the Bot card (H4). One row per site, each naming the failure it must cause in its guard, and the control. Each row plants its edit(s), confirms every
// one LANDED, runs the named guard and reads the outcome by the suite's own rule (`_verdict.js`); everything is restored after
// every row, and checked restored.
//   node tools/probes/mutate-j84-rep.js
"use strict";
const fs = require("fs");
const path = require("path");
const { redAsNamed, staysGreen } = require(path.join(__dirname, "_verdict.js"));   // the one rule for "red"
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..", "..");
const SD = "backends/backend1/statederiver.js", UI = "ui/settings.js", VO = "backends/backend1/vouch.js", CP = "backends/backend1/checkpoint.js";
const EC = "backends/backend1/eventcache.js", AU = "backends/backend2/authority.js", MB = "backends/backend1/matrixbridge.js";
const TR = "backends/backend2/transport.js", CA = "backends/backend1/capabilities.js", ST = "core/store.js", RR = "features/rep-rules.js";
const RP = "features/rep-ports.js", BR = "features/botruntime.js", RM = "features/room.js", IX = "index.html";   // BR, RM: J84-1's boundary rows and J84-2's
const RU = "check-rep-rules", SM = "check-side-messages", PO = "check-rep-ports", BD = "check-rep-boundary";
const RB = "features/rep-bot.js", BT = "check-rep-bot", IS = "check-idle-sweep";
const RD = "features/rep-reader.js", RE = "check-rep-reader", RO = "ui/roster.js", PT = "check-people-tab";   // J84-3
const PN = "ui/panels.js", SC = "ui/screens.js";   // J84-4: ruling 35's redraw and its subscription
const US = "ui/settings.js", BK = "check-bot-card";   // J84-5: the Bot card (H4) and its guard
// A row: [id, [[file, anchor, replacement], ...], guard, expected failure text, "RED" | "GREEN"].
const ROWS = [
  // ── THE THREE ROOM SETTINGS (ruling 23; Q8's range) ──
  // RS1 — the default interval moves: every room already built would change what it does.
  ["RS1", [[SD, "      repSummaryMs: 60 * 60 * 1000,\n", "      repSummaryMs: 30 * 60 * 1000,\n"]], RU, "FAIL — S: A NEW ROOM sends a summary every hour", "RED"],
  // RS2 — the range widens past Q8's 24 hours.
  ["RS2", [[SD, "{ min: 10 * 60 * 1000, max: 24 * 60 * 60 * 1000, scale: 60000 }", "{ min: 10 * 60 * 1000, max: 48 * 60 * 60 * 1000, scale: 60000 }"]],
    RU, "FAIL — S: the interval runs from 10 minutes to 24 hours", "RED"],
  // RS3 — the interval is declared but never folded.
  ["RS3", [[SD, "    if (_inRange(\"repSummaryMs\", s.repSummaryMs)) settings.repSummaryMs = s.repSummaryMs;\n", ""]], RU, "FAIL — S: both ends FOLD", "RED"],
  // RS4 — a switch folds whatever is truthy.
  ["RS4", [[SD, "    if (typeof s.repSelfVotes === \"boolean\") settings.repSelfVotes = s.repSelfVotes;\n", "    if (s.repSelfVotes !== undefined) settings.repSelfVotes = !!s.repSelfVotes;\n"]],
    RU, "FAIL — S: and folds ONLY as a boolean", "RED"],
  // RS5 — the panel's row offers values the room refuses.
  ["RS5", [[UI, "s.repSummaryMs, 10, 1440,", "s.repSummaryMs, 5, 1440,"]], RU, "FAIL — S: the panel's row offers exactly the range", "RED"],
  // RS6 — the REP rows show in a room with no bot, where they act on nothing.
  ["RS6", [[UI, "is `features/rep-rules.js`'s (ruling 21).\n    if (botHere) {\n", "is `features/rep-rules.js`'s (ruling 21).\n    if (true) {\n"]],
    "check-settings-rows", "FAIL — I: with no bot, every setting in BOT_ONLY and NEEDS_BOT is hidden", "RED"],
  // ── E1 — THE SIDE-MESSAGE CLASS ──
  // RE1 — the class leaves the non-critical answer: side messages are vouched, counted and kept like plays.
  ["RE1", [[VO, "  function isNonCritical(type) { return NON_CRITICAL_TYPES.indexOf(type) >= 0 || isSide(type); }\n", "  function isNonCritical(type) { return NON_CRITICAL_TYPES.indexOf(type) >= 0; }\n"]],
    SM, "FAIL — A: a side type is non-critical", "RED"],
  // RE2 — the seal cadence reads the list, not the class: side messages hurry the room's seals.
  ["RE2", [[CP, "        if (t && Vouch.isNonCritical(t)) continue;", "        if (t && Vouch.NON_CRITICAL_TYPES.indexOf(t) >= 0) continue;"]],
    SM, "FAIL — C: and four side messages beside them count for nothing", "RED"],
  // RE3 — the cache's tier reads the list: a side message is kept like a play.
  ["RE3", [[EC, "critical = !!b && !Vouch.isNonCritical(b.t);", "critical = !!b && Vouch.NON_CRITICAL_TYPES.indexOf(b.t) < 0;"]],
    SM, "FAIL — D: and a side message joins the vote in the tier dropped first", "RED"],
  // RE4 — a bot room's judge no longer knows the class: a client could send one as an intent.
  ["RE4", [[AU, "    try { if (typeof Vouch !== \"undefined\" && typeof Vouch.isSide === \"function\" && Vouch.isSide(type)) return SIDE; } catch (e) {}\n", ""]],
    SM, "FAIL — E: a side type is classified as the runner's own", "RED"],
  // RE5 — vouching eligibility reads the list: a side message from below the owner rung is vouched for.
  ["RE5", [[VO, "    if (isNonCritical(b.t)) return false;        // display-level, or a side message\n", "    if (NON_CRITICAL_TYPES.indexOf(b.t) >= 0) return false;\n"]],
    SM, "FAIL — A: nor is a side message ever eligible to be vouched for, whoever sent it", "RED"],
  // RE6 — the prefix loses its dot: `ddjp.sidecar` joins the class.
  ["RE6", [[VO, "  const SIDE_PREFIX = \"ddjp.side.\";\n", "  const SIDE_PREFIX = \"ddjp.side\";\n"]], SM, "FAIL — A: the class is the prefix `ddjp.side.`", "RED"],
  // RE7 — the turn ladder's positions read the list: side messages move the head.
  ["RE7", [[VO, "      if (!b || isNonCritical(b.t)) continue;\n      out.push(r.l);\n", "      if (!b || NON_CRITICAL_TYPES.indexOf(b.t) >= 0) continue;\n      out.push(r.l);\n"]],
    SM, "FAIL — A: and a side message is not a turn", "RED"],
  // ── E2 — `sendSide` ──
  // RE8 — backend1 forgets the reserved fields: a body field `t` is lost to the stamp, `actor` read as someone's act.
  ["RE8", [[MB, "    for (const k of SIDE_RESERVED) if (Object.prototype.hasOwnProperty.call(body, k)) return \"reserved field \" + k;\n", ""]],
    SM, "FAIL — F: a body carrying `t` is refused", "RED"],
  // RE9 — backend1 forgets who can write the owner-level channel.
  ["RE9", [[MB, "    if (getWriteChannelId(channels) !== owner) return { ok: false, reason: \"this account cannot write the owner-level channel\" };\n", ""]],
    SM, "FAIL — F: an account that cannot write the owner-level channel is refused", "RED"],
  // RE10 — backend1 sends on another channel than the owner-level one.
  ["RE10", [[MB, "    try { await sendEvent(owner, type, body); return { ok: true }; }", "    try { await sendEvent(channels.events_uncategorized || owner, type, body); return { ok: true }; }"]],
    SM, "FAIL — F: as ONE message on `events_owner`", "RED"],
  // RE11 — backend2 forgets the runner: any tab of the room sends on the runner's channel.
  ["RE11", [[TR, "    if (!mine) return { ok: false, reason: \"no runner is running for this room on this tab\" };\n", ""]],
    SM, "FAIL — G: with no runner running for this room, it is refused", "RED"],
  // RE12 — backend2 answers "queued" without the gate: the message is never sent.
  ["RE12", [[TR, "    const q = B2Authority.submitRaw(type, body);\n", "    const q = { queued: true };\n"]], SM, "FAIL — G: it is written once, as its own message, its body unchanged", "RED"],
  // RE13 — backend2 skips backend1's refusals: two definitions of a side message.
  ["RE13", [[TR, "    const why = B1MatrixBridge.sideRefusal(type, body);\n    if (why) return { ok: false, reason: why };\n    const owner", "    const owner"]],
    SM, "FAIL — G: and backend1's refusals hold here too", "RED"],
  // ── E3 — `readChannelBack` ──
  // RE14 — the time bound is ignored: older events come back.
  ["RE14", [[MB, "typeof ts !== \"number\" || ts < sinceTs) continue;", "typeof ts !== \"number\") continue;"]], PO, "FAIL — C: everything since the time given", "RED"],
  // RE15 — the scope check is gone: a channel of a room that does not run here is read.
  // RE15, RE16 re-anchored (J85): the paging moved into the one shared step, `_pageBackTo`, which E3 now reads through.
  ["RE15", [[MB, "    if (!room || typeof sinceTs !== \"number\" || !inScope(roomId)) return out;\n", "    if (!room || typeof sinceTs !== \"number\") return out;\n"]],
    PO, "FAIL — C: a channel outside the running room's scope is not read", "RED"],
  // RE16 — it never pages back: only what the client happens to hold.
  ["RE16", [[MB, "      if (o !== null && o < sinceTs) break;\n", "      if (true) break;\n"]], PO, "FAIL — C: it paged back to reach the window", "RED"],
  // RE17 — every sender reads as the owner: REP would believe anyone's summary.
  ["RE17", [[MB, "senderLevel: _userLevelInRoom(room, raw.sender), ts: ts,", "senderLevel: 100, ts: ts,"]], PO, "FAIL — C: each with its Matrix sender, that sender's level", "RED"],
  // ── E4 — `pageRange`'s stops ──
  ["RE18", [[MB, "    const kinds = Array.isArray(o.kinds) && o.kinds.length ? o.kinds : null;\n", "    const kinds = null;\n"]], PO, "FAIL — D: `kinds: [\"events\"]` reads the events channels only", "RED"],
  ["RE19", [[MB, "    const notBeforeTs = (typeof o.notBeforeTs === \"number\" && isFinite(o.notBeforeTs)) ? o.notBeforeTs : null;\n", "    const notBeforeTs = null;\n"]],
    PO, "FAIL — D: `notBeforeTs` drops what is older than the time", "RED"],
  // ── E5 — the `bot.command` verb ──
  // RE20 — a rung check: the bot (99) commands itself.
  ["RE20", [[CA, "        return Ranks.aboveLadder(myRank) ? OK : no(\"Only the room's owner can give the bot commands\");", "        return myRank >= 99 ? OK : no(\"Only the room's owner can give the bot commands\");"]],
    "check-authority-level", "FAIL — B: `bot.command` — the human owner (above the ladder) may command the bot", "RED"],
  // ── E6 — `Store.rep`'s single writer ──
  // RE21 — the lock is always granted: two tabs write one room's REP.
  ["RE21", [[ST, "          if (!lock) { resolve(false); return undefined; }\n", ""]], PO, "FAIL — F: the writer lock is granted once per room", "RED"],
  // RE22 — one lock for every room: a second room's bot waits on the first.
  ["RE22", [[ST, "\"ddjp:\" + ns + \":rep-writer:\" + spaceId", "\"ddjp:\" + ns + \":rep-writer:\""]], PO, "FAIL — F: named per account and per room", "RED"],
  // RE23 — one lock for every account: two accounts in one browser share one writer.
  ["RE23", [[ST, "\"ddjp:\" + ns + \":rep-writer:\" + spaceId", "\"ddjp::rep-writer:\" + spaceId"]], PO, "FAIL — F: named per account and per room", "RED"],
  // ── THE RULES (`rep-rules.js`) ──
  ["RR1", [[RR, "    if (set[reaction.voter]) return { added: false, why: \"already counted\" };\n", ""]], RU, "FAIL — B: the same vote again counts nothing", "RED"],
  // RR2 — self-votes always count, whatever the setting.
  ["RR2", [[RR, "    const sv = s.repSelfVotes === true ? (x[4] || 0) : 0;\n", "    const sv = (x[4] || 0);\n"]], RU, "FAIL — D: both switches off: self-reactions count nowhere", "RED"],
  // RR3 — a self-vote counts as given only (+1), against Q2's +2.
  ["RR3", [[RR, "VR = (x[1] || 0) + sv,", "VR = (x[1] || 0),"]], RU, "FAIL — D: both on: a self-vote is given AND received (+2 REP)", "RED"],
  // RR4 — the cut is ignored: a late reaction on an earlier playing counts.
  ["RR4", [[RR, "    if (!atOrAfterCut(playing, cut)) return { counts: false, why: \"before the cut\" };\n", ""]], RU, "FAIL — A: a playing before the cut is refused", "RED"],
  // RR5 — the owner's adjustments count as votes.
  ["RR5", [[RR, "  const KIND = Object.freeze({ \"ddjp.dj.vote\": \"v\", \"ddjp.dj.save\": \"s\" });", "  const KIND = Object.freeze({ \"ddjp.dj.vote\": \"v\", \"ddjp.dj.save\": \"s\", \"ddjp.count.set\": \"v\" });"]],
    RU, "FAIL — A: `ddjp.count.set` is not a reaction", "RED"],
  // RR6 — a reaction the room refused counts.
  ["RR6", [[RR, "    if (eligible === false) return { counts: false, why: \"not eligible\" };\n", ""]], RU, "FAIL — A: an ineligible person is refused", "RED"],
  // RR7 — another summary's additions are applied.
  ["RR7", [[RR, "(a) => a && a.of === sum.id && a.n === sum.n", "(a) => a && a.n === sum.n"]], RU, "FAIL — F: additions join their own summary", "RED"],
  // RR8 — the size budget is ignored: a big room's summary passes Matrix's limit.
  ["RR8", [[RR, "    if (sentBytes(TYPES.summary, make(ordered.length)) <= LIMITS.budgetBytes)", "    if (true)"]], RU, "FAIL — G: a big room's summary, as sent, fills but never passes the budget", "RED"],
  // RR9 — the older summary wins.
  ["RR9", [[RR, "    if (a.n !== b.n) return a.n > b.n ? a : b;\n", "    if (a.n !== b.n) return a.n < b.n ? a : b;\n"]], RU, "FAIL — F: the newer summary wins by serial", "RED"],
  // RR10 — a summary with no serial is read.
  ["RR10", [[RR, "    if (!_isInt(b.n)) return { ok: false, why: \"no serial\" };\n    if (!_cutOk(b.cut))", "    if (!_cutOk(b.cut))"]], RU, "FAIL — F: a summary with no serial is refused", "RED"],
  // RR11 — a summary carrying a field the transport stamps is read.
  ["RR11", [[RR, "    if (b.v !== VERSION) return { ok: false, why: \"unknown version\" };\n    if (!_noReserved(b)) return { ok: false, why: \"a reserved field\" };\n    if (!_isInt(b.n)) return { ok: false, why: \"no serial\" };",
    "    if (b.v !== VERSION) return { ok: false, why: \"unknown version\" };\n    if (!_isInt(b.n)) return { ok: false, why: \"no serial\" };"]], RU, "FAIL — F: a body carrying `t` is refused", "RED"],
  // RR12 — a reaction on one's own playing counts as given to oneself and received from oneself.
  ["RR12", [[RR, "          if (p.dj && u === p.dj) bump(u, self);\n", "          if (false) bump(u, self);\n"]], RU, "FAIL — C: the DJ: +1 vote and +1 save received, and one self-vote", "RED"],
  // ── THE BOUNDARY (ruling 21) ──
  // RB1 — the bot runtime names REP.
  ["RB1", [[BR, "const BotRuntime = (() => {\n", "const BotRuntime = (() => {\n  const _rv = () => RepRules.VERSION;\n"]], BD, "FAIL — E: the bot runtime, the seam and the engines name nothing of REP", "RED"],
  // RB2 — the rules read a clock.
  ["RB2", [[RR, "  function receiptOf(voter, pi, kind) {", "  function _now() { return Date.now(); }\n  function receiptOf(voter, pi, kind) {"]], BD, "FAIL — A: `rep-rules.js` names no app global, no clock", "RED"],
  // RB3 — the ports reach an engine internal.
  ["RB3", [[RP, "  const ST = () => _m(() => Store), BR = () => _m(() => BotRuntime), LG = () => _m(() => Logger);\n", "  const ST = () => _m(() => Store), BR = () => _m(() => BotRuntime), LG = () => _m(() => Logger), VC = () => _m(() => Vouch);\n"]],
    BD, "FAIL — C: `rep-ports.js` names only the nine modules it declares", "RED"],
  // RB4 — an engine names a REP side type.
  ["RB4", [[AU, "  const SIDE = { bot: true, why: \"a side message:", "  const SIDE = { bot: true, rep: \"ddjp.side.rep.summary\", why: \"a side message:"]], BD, "FAIL — E: and no side TYPE is named there at all", "RED"],
  // RB5 — a second place decides self-votes.
  ["RB5", [[RM, "  function runningRoom() { return (current && current.spaceId) ? current.spaceId : null; }\n", "  function runningRoom() { return (current && current.spaceId) ? current.spaceId : null; }\n  function _selfVotesOn() { const s = StreamManager.getState().settings || {}; return s.repSelfVotes === true; }\n"]],
    BD, "FAIL — F: the self-vote and self-save switches are read only by the rules piece", "RED"],
  // RB6 — the app calls REP outside a hook site.
  ["RB6", [[RM, "  function runningRoom() { return (current && current.spaceId) ? current.spaceId : null; }\n", "  function runningRoom() { return (current && current.spaceId) ? current.spaceId : null; }\n  function _repV() { return (typeof RepRules !== \"undefined\") ? RepRules.VERSION : 0; }\n"]],
    BD, "FAIL — D: outside REP's files no code names a REP global except at a hook site", "RED"],
  // ── THE PORTS ──
  ["RP1", [[RP, "    \"settings\", \"onSettingsChange\", \"whoIsActive\", \"peopleChanged\",\n", "    \"settings\", \"onSettingsChange\", \"peopleChanged\",\n"]], PO, "FAIL — A: `PORTS` lists exactly the ports the object exports", "RED"],
  // RP2 — who is active is asked of another function than the one shared one (ruling 30a).
  ["RP2", [[RP, "_has(RM(), \"presenceView\") ? RM().presenceView(now) : null;", "_has(RM(), \"recentlyActive\") ? RM().recentlyActive(now) : null;"]], PO, "FAIL — B: whoIsActive asks the one shared function", "RED"],
  ["RP3", [[RP, "    return MB().readChannelBack(channels, \"events_owner\", sinceTs);\n", "    return MB().readChannelBack(channels, \"events_uncategorized\", sinceTs);\n"]], PO, "FAIL — B: readOwnerChannelBack reads the owner-level channel", "RED"],
  ["RP4", [[RP, "    return MB().pageRange(fromL, toL, { kinds: [\"events\"], notBeforeTs: notBeforeTs });\n", "    return MB().pageRange(fromL, toL, { notBeforeTs: notBeforeTs });\n"]], PO, "FAIL — B: pageReactions asks for the events channels only", "RED"],
  // ── PART R (moved from `check-reputation` to `check-wiring`) ──
  // RE-ANCHORED AT J84-2 (the reason): version-free, so a bump cannot void it — the tag now loads a file that does not exist.
  ["RW1", [[IX, "<script src=\"features/rep-ports.js?v=", "<script src=\"features/rep-ports-gone.js?v="]], "check-wiring", "FAIL — R: EVERY feature module has a `<script>` tag in index.html", "RED"],
  // ── J84-2: THE BOT SIDE (`features/rep-bot.js`) ──
  // Counting with receipts.
  ["BC1", [[RB, "RepRules.add(t.fwd, r, playing, t.cut, RepPorts.isLegal(e.eventId) !== false);", "RepRules.add(t.fwd, r, playing, t.cut, true);"]], BT, "FAIL — A: a reaction the room refused counts for nothing", "RED"],
  ["BC2", [[RB, "    if (!playing) { _hold(s, e); return false; }\n", "    if (!playing) return false;\n"]], BT, "FAIL — A: a reaction on a playing not yet in song history is HELD", "RED"],
  ["BC3", [[RB, "    if (_retryHeld(s, now, I)) _dirty(s);\n", ""]], BT, "FAIL — A: and counted once song history shows it", "RED"],
  // The table and its persistence.
  ["BT1", [[RB, "    s.saveTimer = setTimeout(() => { s.saveTimer = null; if (_s === s && s.table) RepPorts.storeSave(s.spaceId, _plain(s.table)); }, SAVE_MS);\n", ""]],
    BT, "FAIL — B: and it is written then, for this room", "RED"],
  ["BT2", [[RB, "      try { RepPorts.storeSave(s.spaceId, _plain(s.table)); } catch (e) {}   // started, not awaited\n", ""]], BT, "FAIL — B: the leave saves the table as it stands", "RED"],
  ["BT3", [[RB, "t.v !== TABLE_V || ", ""]], BT, "FAIL — B: a stored table that does not read (another version) is no table at all", "RED"],
  // The single writer.
  ["BW1", [[RB, "      if (got === false) {\n", "      if (false) {\n"]], BT, "FAIL — C: another tab of this account holds the lock", "RED"],
  ["BW2", [[RB, "    if (s.release) { try { s.release(); } catch (e) {} }\n", ""]], BT, "FAIL — C: and the leave releases it", "RED"],
  // The base (Q4): a partial table is never published as the truth.
  ["BB1", [[RB, "    if (RepPorts.holdsWholeRoom() === true) {\n", "    if (true) {\n"]], BT, "FAIL — D: no table, no summary of its own, and a room older than the window", "RED"],
  // Summaries.
  ["BS1", [[RB, "      if (!RepPorts.mayAuthor()) return;   // still catching up: a count now would be a partial one\n", ""]], BT, "FAIL — E: nothing goes before the tab is caught up", "RED"],
  ["BS2", [[RB, "    if (s.awaitFrom === undefined) { s.awaitFrom = np.pi; return null; }\n", "    return why;\n"]], BT, "FAIL — E: the first summary waits for the song change", "RED"],
  ["BS3", [[RB, "    if (age >= RepRules.LIMITS.refreshFactor * I) return \"a refresh (the last is \" + _dur(age) + \" old)\";   // C12: at once\n", ""]],
    BT, "FAIL — E: but at 1.5 intervals it goes at once", "RED"],
  ["BS4", [[RB, "(t.counted > 0 || _sig(active) !== last.activeSig)", "true"]], BT, "FAIL — E: an UNCHANGED summary is not sent at one interval", "RED"],
  ["BS5", [[RB, "      for (const pi of f.closed) delete t.fwd.byPi[pi];\n", ""]], BT, "FAIL — I: each named person's published row plus what followed the cut", "RED"],
  ["BS6", [[RB, "    const view = RepPorts.whoIsActive(now);\n", "    const view = { people: [] };\n"]], BT, "FAIL — E: its rows are the people active in the bot's view", "RED"],
  // Additions.
  ["BA1", [[RB, "    if (fresh.length && !last.id) return [];   // its summary's id not heard back yet: they wait together\n", ""]],
    BT, "FAIL — F: a newly active person waits until the summary's own id is heard back", "RED"],
  ["BA2", [[RB, "    if (gap < RepRules.LIMITS.spacingMs) {", "    if (false) {"]], BT, "FAIL — F: none within 5 s of the last REP message", "RED"],
  ["BA3", [[RB, "    if (fresh.length && last.adds.people.length + fresh.length > RepRules.LIMITS.freshAfterPeople) {", "    if (false) {"]],
    BT, "FAIL — F: past 20 people added under one summary, a FRESH summary goes instead", "RED"],
  ["BA4", [[RB, "split: t.base[u] || RepRules.zero() })) });", "split: RepRules.plus(t.base[u], RepRules.contributions(t.fwd)[u]) })) });"]],
    BT, "FAIL — F: then an addition — under that summary's id and serial, with their split as of its cut", "RED"],
  // The size cap's left-out rule.
  ["BL1", [[RB, "    if (last.more > 0 && typeof last.lowestKept === \"number\") {", "    if (false) {"]], BT, "FAIL — G: while capped, a newcomer below the lowest REP kept is LEFT OUT", "RED"],
  // The hooks, H1 and H2, and the lifecycle.
  ["BH1", [[RM, "    try { if (typeof Rep !== \"undefined\" && Rep.leave) Rep.leave(\"the tab left the room (\" + reason + \")\"); } catch (e) {}\n", ""]],
    BT, "FAIL — H: H2 — the one leave step stops it", "RED"],
  ["BH2", [[RM, "    try { Rep.enter({ spaceId: current && current.spaceId, channels: current && current.channels }); }\n    catch (e) { Logger.warn(\"Room: REP could not be told the room changed — \" + ((e && e.message) || e)); }\n", ""]],
    BT, "FAIL — H: H1 — the room's entry on the bot's tab starts the bot side", "RED"],
  ["BH3", [[RB, "    if (_s && _s.spaceId === c.spaceId) { _s.channels = c.channels; return; }   // a rank change in the same room: keep running\n", ""]],
    BT, "FAIL — H: a rank change in the same room keeps it running", "RED"],
  ["BH4", [[RB, "      if (_s) _stop(\"this tab is not the room's bot here\");\n", ""]], BT, "FAIL — H: and a rank change away from the bot stops it", "RED"],
  ["BH5", [[RB, "    const bot = RepPorts.actingAsBot();\n", "    const bot = true;\n"]], BT, "FAIL — H: a tab that is not the room's bot runs none of it", "RED"],
  // ── J84-2: THE ONE "WHO IS ACTIVE" FUNCTION (rulings 30a and 30b) ──
  // PV1 — the presence sweep reads the spine fold again, not the one function: chat heard by the room's record is lost to it.
  ["PV1", [[BR, "    try { fold = _noteView(Room.presenceView(now)); } catch (e) { fold = null; }", "    try { fold = _noteView(Room.recentlyActive(now)); } catch (e) { fold = null; }"]],
    IS, "FAIL — ONE: somebody whose last spine act is 90 minutes old but who CHATTED a minute ago stays in the presence chat", "RED"],
  // PV2 — the queue sweep stops reading the record's chat times.
  ["PV2", [[BR, "    return typeof last === \"number\" && last >= now - windowMs && last <= now;", "    return false;"]], IS, "FAIL — Q: somebody who spoke a minute ago keeps their place", "RED"],
  // PV3 — "can it answer" always yes: a bot that just started removes for its own downtime.
  ["PV3", [[BR, "    return view.chatKnownFrom <= now - windowMs;", "    return true;"]], IS, "FAIL — Q: a bot watching for 30 SECONDS does not warn", "RED"],
  // PV4 — 30b undone: a device reads chat back over `botAfkMs` alone, less far than the bot.
  ["PV4", [[RM, "      readMs = Math.max(windowMs, (typeof aw === \"number\" && isFinite(aw)) ? aw : 0);", "      readMs = windowMs;"]],
    "check-viewer-chat", "FAIL — A: each visible tier is read back only as far as the window needs", "RED"],
  // PV5 — a tier known only once read back (the viewer's old rule): a bot that has watched for an hour still cannot answer.
  ["PV5", [[RM, "coveredFrom: now, reading: false };", "coveredFrom: null, reading: false };"]], IS, "FAIL — Q: APPLIED — with no chat from them, the Spine answer stands", "RED"],
  // ── J84-3: THE READER (rulings 24, 26, 30d, 32, 34; §4.3, §4.5) ── (its readiness rows were RR1–RR3 at `ddjp_580`, the same
  // ids as J84-1's rules rows above; renamed RY1–RY3 at `ddjp_581`)
  // RL1 — the look-back is one interval, not two: a device opening an interval and a half after the last summary finds none.
  ["RL1", [[RD, "    const span = RepRules.LIMITS.lookbackFactor * I;\n", "    const span = I;\n"]], RE, "FAIL — B: a device looks back twice the summary interval", "RED"],
  // RT1 — a live message is taken as the owner-level channel's whatever room it came on.
  ["RT1", [[RD, "    _take(r, { id: raw.event_id, channel: _channelKey(r, raw.room_id),", "    _take(r, { id: raw.event_id, channel: RepRules.TRUST.channel,"]],
    RE, "FAIL — C: a summary on another channel is ignored", "RED"],
  // RT2 — a relay batch's member passes as its own event.
  ["RT2", [[RR, "    if (typeof x.id !== \"string\" || !x.id || x.id.indexOf(\"#\") >= 0) return", "    if (typeof x.id !== \"string\" || !x.id) return"]],
    RE, "FAIL — C: a relay batch's member is never believed", "RED"],
  // RT3 — the sender's level is never asked: anyone who can write the channel is believed.
  ["RT3", [[RD, "    const t = RepRules.trust({ channel: m.channel, id: m.id, level: RepPorts.levelOf(r.spaceId, r.channels, m.sender) });",
    "    const t = RepRules.trust({ channel: m.channel, id: m.id, level: 99 });"]], RE, "FAIL — C: a summary from a sender below 99 is ignored", "RED"],
  // RT4 — the transport's stamps are not taken off: every real summary is refused as carrying a reserved field.
  ["RT4", [[RD, "    const body = RepRules.unstamp(m.body);\n", "    const body = m.body;\n"]], RE, "FAIL — C: PREMISE — the bot's summary, read back as the transport stamped it, is believed", "RED"],
  // RT5 — too much taken off: a relayed act's field is stripped and the body believed.
  ["RT5", [[RR, "  const STAMPED = Object.freeze([\"t\", \"l\", \"dv\", \"hv\"]);", "  const STAMPED = Object.freeze([\"t\", \"l\", \"dv\", \"hv\", \"actor\"]);"]],
    RE, "FAIL — C: and a body carrying a relayed act's field is refused", "RED"],
  // RN1 — the newest no longer wins: whatever arrives last is taken.
  ["RN1", [[RD, "      if (r.sum && RepRules.newer(r.sum, cand) !== cand) return false;   // the newest wins: this one is older\n", ""]],
    RE, "FAIL — C: and an older serial arriving later changes nothing", "RED"],
  // RA1 — an addition under the summary in force is kept but never shown (the published set not refreshed).
  ["RA1", [[RD, "    if (r.sum && a.of === r.sum.id && a.n === r.sum.n) {\n      r.pub = null;\n", "    if (r.sum && a.of === r.sum.id && a.n === r.sum.n) {\n"]],
    RE, "FAIL — C: and one naming the summary in force is", "RED"],
  // RC1 — the cut ignored when counting forward: a late vote on a closed playing counts on devices, never on the bot.
  ["RC1", [[RD, "    const res = RepRules.add(r.acc, { type: e.type, voter: e.sender, pi: pi }, playing, r.sum.cut,", "    const res = RepRules.add(r.acc, { type: e.type, voter: e.sender, pi: pi }, playing, null,"]],
    RE, "FAIL — A: and D's late vote on a closed playing counts for nothing, everywhere", "RED"],
  // RC2 — a newer summary does not close what came before its cut: those playings are counted twice.
  ["RC2", [[RD, "      if (RepRules.compareAt(p.l, pi, sum.cut.pos, sum.cut.pi) < 0) delete r.acc.byPi[pi];\n", ""]],
    RE, "FAIL — A: and its cut closes what came before it", "RED"],
  // RC3 — the stretch between the cut and the held log is never paged: a trimmed device misses it.
  ["RC3", [[RD, "    if (from === null || from <= sum.cut.pos) { _ready(r,", "    if (true) { _ready(r,"]],
    RE, "FAIL — A: a device whose held log starts above the cut pages exactly the stretch between them", "RED"],
  // RC4 — held reactions are never tried again: a vote on a playing song history showed late is lost.
  ["RC4", [[RD, "    if (r.sum && r.acc.held.length) _retryHeld(r, _now());\n", ""]],
    RE, "FAIL — A: a reaction on a playing song history has not shown is held, then counted once it shows", "RED"],
  // RY1 — ready while still catching up: a partial count shown as the number.
  ["RY1", [[RD, "    if (!RepPorts.mayAuthor()) {   // the held log is still filling", "    if (false) {   // the held log is still filling"]],
    RE, "FAIL — A: a device still catching up shows nothing yet", "RED"],
  // RY2 — ready although the paged stretch stopped short of the cut.
  ["RY2", [[RD, "      if (typeof list.reachedFrom === \"number\" && list.reachedFrom <= sum.cut.pos) {", "      if (true) {"]],
    RE, "FAIL — F: THE PAGED STRETCH STOPPED SHORT OF THE CUT", "RED"],
  // RY3 — a tab that cannot say where its log starts is read as holding everything.
  ["RY3", [[RD, "    if (from === undefined) {\n", "    if (false) {\n"]], RE, "FAIL — F: a tab that cannot say where its log starts shows nothing", "RED"],
  // RS7 — the settings the number is shown under are not the room's current ones: a switch changes nothing until... never.
  ["RS7", [[RD, "_forward(r)[userId]), RepPorts.settings() || {}).REP;", "_forward(r)[userId]), {}).REP;"]],
    RE, "FAIL — A: SELF-VOTES TURNED ON", "RED"],
  // RZ1 — no row from the bot shows a 0: a claim nobody made.
  ["RZ1", [[RD, "    if (!row) return null;   // not published by the bot", "    if (!row) return { rep: 0, text: \"0 REP\" };   // not published by the bot"]],
    RE, "FAIL — A: and nobody it did not publish gets one", "RED"],
  // RZ2 — the log no longer names the size limit for a capped summary.
  ["RZ2", [[RD, "        (r.sum.more ? \", or one of the \" + r.sum.more + \" it left out at the size limit\" : \"\") + \")\");", "        \")\");"]],
    RE, "FAIL — E: and the log says why, once per person per summary", "RED"],
  // RZ3 — no summary and nothing said.
  ["RZ3", [[RD, "      if (!r.sum) _log(\"no summary from the bot in the last \" + _dur(span) + \" — none shown\");\n", ""]],
    RE, "FAIL — D: and the log says why, once", "RED"],
  // RH1 — the leave reaches only the bot side: the reader runs on in the lobby.
  ["RH1", [[RP, "  function leave(why) { _each(\"leave\", why); }", "  function leave(why) { const b = _p(() => RepBot); if (b && b.leave) b.leave(why); }"]],
    RE, "FAIL — H: H2 — the leave stops it", "RED"],
  // RH2 — the entry reaches only the bot side: no tab but the bot's ever reads.
  ["RH2", [[RP, "  const PIECES = () => [_p(() => RepReader), _p(() => RepBot)];", "  const PIECES = () => [_p(() => RepBot)];"]],
    RE, "FAIL — H: H1 — on a tab that is not the bot, the reader starts", "RED"],
  // RH3 — a rank change in the same room restarts the reader: its numbers drop until it has read again.
  ["RH3", [[RD, "    if (_r && _r.spaceId === c.spaceId) { _r.channels = c.channels; return; }   // a rank change in the same room: keep reading\n", ""]],
    RE, "FAIL — H: a rank change in the same room keeps it", "RED"],
  // ── J84-3: THE PEOPLE TAB (rulings 27, 30e, 30f, 31, 34; Q6) ──
  ["PT1", [[RM, "      if (!a.active !== !b.active) return a.active ? -1 : 1;\n", ""]], PT, "FAIL — A: ACTIVE ON TOP, INACTIVE BELOW", "RED"],
  ["PT2", [[RM, "      if (a.lv !== b.lv) return b.lv - a.lv;\n", ""]], PT, "FAIL — A: NO BOT IN THE ROOM — no numbers, and the same order on rank and name alone", "RED"],
  ["PT3", [[RM, "      if ((a.number === null) !== (b.number === null)) return a.number === null ? 1 : -1;", "      if ((a.number === null) !== (b.number === null)) return a.number === null ? -1 : 1;"]],
    PT, "FAIL — A: NO NUMBER AFTER ANY NUMBER", "RED"],
  ["PT4", [[RM, "      if (a.number !== b.number) return b.number - a.number;", "      if (a.number !== b.number) return a.number - b.number;"]], PT, "FAIL — A: ACTIVE ON TOP, INACTIVE BELOW", "RED"],
  ["PT5", [[RM, "        nm: String(m.name || m.userId).toLowerCase() });", "        nm: String(m.name || m.userId) });"]], PT, "FAIL — A: the same name, any case — the user ID breaks the tie", "RED"],
  ["PT6", [[RO, "      if (b && b.text) kids.push(H.el(\"span\", { class: \"person-rep\", text: b.text }));\n      kids.push(nameEl);\n",
    "      kids.push(nameEl);\n      if (b && b.text) kids.push(H.el(\"span\", { class: \"person-rep\", text: b.text }));\n"]], PT, "FAIL — B: `<n> REP` IN ITS OWN ELEMENT, BEFORE THE NAME", "RED"],
  ["PT7", [[RO, "      const row = H.el(\"div\", { class: \"person\" + (it.active ? \"\" : \" inactive\") }, kids);", "      const row = H.el(\"div\", { class: \"person\" }, kids);"]],
    PT, "FAIL — B: THE INACTIVE ROWS ARE GREYED", "RED"],
  ["PT8", [[RO, "      const b = badges[member.userId];\n", "      const b = it.active ? badges[member.userId] : null;\n"]], PT, "FAIL — B: AN INACTIVE MEMBER'S NUMBER SHOWS", "RED"],
  ["PT9", [[RO, "      if (b && b.text) kids.push(H.el(\"span\", { class: \"person-rep\", text: b.text }));", "      kids.push(H.el(\"span\", { class: \"person-rep\", text: (b && b.text) || \"0 REP\" }));"]],
    PT, "FAIL — B: where this device holds no REP — the bot's row — nothing", "RED"],
  ["PT10", [[RO, "{ class: \"person-rep\", text: b.text }", "{ class: \"person-rep\", text: b.text, title: \"counted by the bot since 3 Oct\" }"]],
    PT, "FAIL — B: NO TOOLTIP AND NO COVERAGE TEXT", "RED"],
  ["PT11", [[RO, "Room.peopleOrder(fold, roster, numberOf)", "Room.peopleOrder(fold, roster)"]], PT, "FAIL — B: THE ROWS ARE IN THE FEATURE LAYER'S ORDER", "RED"],
  ["PT12", [[IX, "    .person-rep { font-size: 11px; color: #9aa0a6;", "    .person-rep { font-size: 11px; color: #3BA55D;"]], PT, "FAIL — C: `.person-rep` is a light grey", "RED"],
  ["PT13", [[IX, "    .roster-box .person.inactive { opacity: 0.55; }", "    .roster-box .person.inactive { }"]], PT, "FAIL — C: an inactive row is greyed", "RED"],
  // The boundary: a REP name in the UI outside H3, and the reader reaching an app global itself.
  ["RB7", [[RO, "(typeof Rep !== \"undefined\" && Rep.badge) ? (Rep.badge(userId) || null) : null", "(typeof RepReader !== \"undefined\") ? (RepReader.badge(userId) || null) : null"]],
    BD, "FAIL — D: outside REP's files no code names a REP global except at a hook site", "RED"],
  ["RB8", [[RD, "  function _now() { const t = RepPorts.serverNow();", "  function _now() { const t = ServerClock.serverNow();"]], BD, "FAIL — B: `features/rep-reader.js` names no app global", "RED"],
  ["RW2", [[IX, "<script src=\"features/rep-reader.js?v=", "<script src=\"features/rep-reader-gone.js?v="]], "check-wiring", "FAIL — R: EVERY feature module has a `<script>` tag in index.html", "RED"],
  // ── J84-4: THE FILL-BACK, THE REBUILD AND THE WINDOW (ruling 20; the design's §3) ──
  // FB1 — no fill-back with a table: what happened while the bot was away is never counted.
  ["FB1", [[RB, "    if (s.table) _fillBack(s, now);\n", "    if (s.table) _done(s);\n"]], BT, "FAIL — J: WHAT HAPPENED WHILE IT WAS AWAY IS COUNTED", "RED"],
  // FB2 — receipts off during the fill-back: each reaction's receipt forgotten before it is counted again.
  ["FB2", [[RB, "      for (const e of g.events.concat(s.early)) _count(s, e, st);\n      s.early = [];\n      if (g.capped)",
    "      for (const e of g.events.concat(s.early)) { const p0 = s.table.fwd.byPi[e.content && e.content.p]; if (p0 && p0[RepRules.kindOf(e.type)]) delete p0[RepRules.kindOf(e.type)][e.sender]; _count(s, e, st); }\n      s.early = [];\n      if (g.capped)"]],
    BT, "FAIL — J: RECEIPTS THROUGHOUT", "RED"],
  // FB3 — the window ignored: everything ever, held or paged, however old.
  ["FB3", [[RB, "    _gather(s, fromL, now - W).then((g) => {", "    _gather(s, fromL, -Infinity).then((g) => {"]], BT, "FAIL — L: a reaction older than the window is not filled", "RED"],
  // FB4 — the stretch below the held log is never paged: a trimmed tab, or a bot room's save point, loses it.
  ["FB4", [[RB, "    if (toL === null || toL < fromL) return Promise.resolve(", "    if (true) return Promise.resolve("]], BT, "FAIL — J: FROM THE CUT, WITHIN THE WINDOW", "RED"],
  // FB5, FB6 — a gap past the window: not said; `since` not moved.
  ["FB5", [[RB, "    _log(days + \" day(s) beyond the window were not filled\");\n", ""]], BT, "FAIL — L: BEYOND THE WINDOW", "RED"],
  ["FB6", [[RB, "    if (t.since === null || t.since < edge) t.since = edge;\n", ""]], BT, "FAIL — L: BEYOND THE WINDOW", "RED"],
  // FB7 — a summary sent while the table is still being filled: a partial count published.
  ["FB7", [[RB, "    if (s.fill) return;                     // nothing is sent while the table is being filled or rebuilt\n", ""]],
    BT, "FAIL — J: NOTHING IS SENT WHILE A FILL-BACK RUNS", "RED"],
  // FB8 — a fill-back that could not read is taken as done.
  ["FB8", [[RB, "      if (!g.ok) { _retry(s, \"the fill-back could not read the room back\"); return; }\n      _beyond(s, now, W);",
    "      if (!g.ok) { _done(s); return; }\n      _beyond(s, now, W);"]], BT, "FAIL — J: A FILL-BACK THAT CANNOT READ", "RED"],
  // FB9 — no fresh summary after a fill-back that counted.
  ["FB9", [[RB, "    if (s.afterFill) return \"after the fill-back (\" + s.afterFill + \" counted)\";   // §4.2: at once\n", ""]],
    BT, "FAIL — J: and a fresh summary follows at once", "RED"],
  // FB10, FB11 — the window: the stored setting never read; one outside 1–365 days taken.
  ["FB10", [[RB, "        s.windowMs = _windowMs(pf);\n", "        s.windowMs = _windowMs(null);\n"]], BT, "FAIL — L: THE WINDOW IS THE BOT'S OWN SETTING", "RED"],
  ["FB11", [[RB, "d >= WINDOW.min && d <= WINDOW.max)", "d >= WINDOW.min)"]], BT, "FAIL — L: and one outside 1–365 days is not read", "RED"],
  // RK1 — no rebuild: storage lost, the bot counts the room again from its start (late reactions included, the unnamed too).
  ["RK1", [[RB, "      if (plan) { _rebuild(s, plan, now); return; }\n", ""]], BT, "FAIL — K: THE SAME NUMBERS AS BEFORE", "RED"],
  // RK2 — everyone from the newest cut: b, named only in an older summary, loses what came between.
  ["RK2", [[RB, "RepRules.contributionsFrom(pre, (u) => (plan.who[u] ? plan.who[u].cut : null));", "RepRules.contributionsFrom(pre, (u) => (plan.who[u] ? C : null));"]],
    BT, "FAIL — K: THE SAME NUMBERS AS BEFORE", "RED"],
  // RK3 — the rebuild ignores additions: a person named only in one is lost.
  ["RK3", [[RB, "      for (const a of mine) for (const r of a.rows) who[r.user] = { split: r.split.slice(), cut: S.cut };\n", ""]],
    BT, "FAIL — K: THE SAME NUMBERS AS BEFORE", "RED"],
  // RK4 — a late reaction on a playing a later summary closed is counted, though the bot never counted it.
  ["RK4", [[RB, "          if (closer && typeof e.l === \"number\" && typeof closer.l === \"number\" && e.l >= closer.l) continue;\n", ""]],
    BT, "FAIL — K: and a late save the original never counted", "RED"],
  // RK5 — anyone's summary is taken for its own: the owner's planted one becomes the base.
  ["RK5", [[RB, "      if (!m || m.sender !== s.me || typeof m.id !== \"string\") continue;", "      if (!m || typeof m.id !== \"string\") continue;"]],
    BT, "FAIL — K: its last summary is the newest of its own", "RED"],
  // RK6 — its own messages read back without the window.
  ["RK6", [[RB, "    Promise.resolve(RepPorts.readOwnerChannelBack(s.channels, now - W)).then((list) => {", "    Promise.resolve(RepPorts.readOwnerChannelBack(s.channels, 0)).then((list) => {"]],
    BT, "FAIL — K: IT READS ITS OWN MESSAGES BACK on the owner-level channel, within the window", "RED"],
  // RK7 — filled back from the newest cut, not the oldest one used.
  ["RK7", [[RB, "    _gather(s, low.pos, now - W).then((g) => {", "    _gather(s, C.pos, now - W).then((g) => {"]], BT, "FAIL — K: filled back from the OLDEST cut it used", "RED"],
  // RK8 — someone with no cut credited all the same.
  ["RK8", [[RR, "      if (!c || !atOrAfterCut({ pi: pi, l: p.l }, c)) return;", "      if (c && !atOrAfterCut({ pi: pi, l: p.l }, c)) return;"]],
    RU, "FAIL — C: someone with no cut is credited nothing at all", "RED"],
  // RQ1–RQ3 — the base (Q4): published from nothing; refused without the line; a young room refused.
  ["RQ1", [[RB, "        if (g.reachedFrom <= 0 && !g.byTime && !g.capped) {", "        if (true) {"]], BT, "FAIL — D: no table, no summary of its own, and a room older than the window", "RED"],
  ["RQ2", [[RB, "        _log(\"no table and no summary within the window (\" + Math.round(W / DAY) + \" days) — import a reputation file, or start fresh\");\n", ""]],
    BT, "FAIL — D: and the log says why, in Q4's words", "RED"],
  ["RQ3", [[RB, "        if (g.reachedFrom <= 0 && !g.byTime && !g.capped) {", "        if (false) {"]], BT, "FAIL — D: no table, not held whole, but YOUNGER than the window", "RED"],
  // ── RULING 35: REP IN REAL TIME ──
  // RV1 — the reader never says what it shows moved.
  ["RV1", [[RD, "  function _changed(r) { if (r && r.ready && _r === r) RepPorts.peopleChanged(); }", "  function _changed(r) { }"]],
    RE, "FAIL — G: A COUNTED SAVE RAISES IT AT ONCE", "RED"],
  // RV2 — a settings change is not heard.
  ["RV2", [[RD, "    if (!_settingsHeard) { _settingsHeard = true; RepPorts.onSettingsChange(_onSettings); }", "    if (!_settingsHeard) { _settingsHeard = true; }"]],
    RE, "FAIL — G: PREMISE — it listens to the room's settings", "RED"],
  // RV3 — the port raises nothing.
  ["RV3", [[RP, "  function peopleChanged() { try { if (_has(RM(), \"peopleViewChanged\")) RM().peopleViewChanged(); } catch (e) {} }", "  function peopleChanged() { }"]],
    PO, "FAIL — B: peopleChanged raises the feature layer's generic", "RED"],
  // RV4 — the signal reaches no listener.
  ["RV4", [[RM, "  function peopleViewChanged() { for (const fn of _peopleViewListeners.slice()) { try { fn(); } catch (e) {} } }", "  function peopleViewChanged() { }"]],
    PT, "FAIL — E: \"THE PEOPLE VIEW CHANGED\" REACHES EVERY LISTENER", "RED"],
  // RV5 — the People tab does not subscribe.
  ["RV5", [[SC, "    if (Room.onPeopleViewChange) Room.onPeopleViewChange(Panels.peopleViewChanged);\n", ""]], PT, "FAIL — E: THE PEOPLE TAB SUBSCRIBES", "RED"],
  // RV6 — no debounce: every signal of a burst redraws.
  ["RV6", [[PN, "    if (_peopleSoon) return;\n    _peopleSoon = setTimeout(", "    _peopleSoon = setTimeout("]], PT, "FAIL — E: A BURST IS ONE REDRAW", "RED"],
  // RV7 — drawn while hidden.
  ["RV7", [[PN, "      if (!_peopleVisible()) return;\n      if (_peopleBusy())", "      if (_peopleBusy())"]], PT, "FAIL — E: People hidden — nothing drawn", "RED"],
  // RV8 — while you use the list the redraw is dropped, not waited for.
  ["RV8", [[PN, "      if (_peopleBusy()) { _peopleSoon = setTimeout(due, PEOPLE_SOON_MS); return; }", "      if (_peopleBusy()) return;"]],
    PT, "FAIL — E: while you are using the list it waits", "RED"],
  // ── J84-5: COMMANDS (§5.2; rulings 17, 32) ──
  ["CM1", [[RB, "    if (!RepPorts.mayCommand(RepPorts.levelOf(s.spaceId, s.channels, sender))) { ignored(\"not the owner\"); return; }\n", ""]], BT, "FAIL — M: OWNER ONLY", "RED"],
  ["CM2", [[RB, "    const tier = (tiers && Array.isArray(tiers.tiers) ? tiers.tiers : []).find((x) => x && x.id === roomId);",
    "    const tier = (tiers && Array.isArray(tiers.tiers) ? tiers.tiers : []).find((x) => x && x.id === roomId) || { tier: \"a DM\", id: roomId };"]], BT, "FAIL — M: NEVER A DM", "RED"],
  ["CM3", [[RB, "    if (now === null || typeof ts !== \"number\" || s.startedAt === null || ts < s.startedAt || ts < now - LIVE_MS) return;   // history",
    "    if (now === null) return;   // history"]], BT, "FAIL — M: HISTORY IS NEVER ANSWERED", "RED"],
  ["CM4", [[RB, "    if (cool > 0 && typeof prev === \"number\" && now - prev < cool) { ignored(\"cooldown\"); return; }\n", ""]], BT, "FAIL — M: THE COOLDOWN PER PERSON", "RED"],
  ["CM5", [[RB, "    if (s.replies.length >= s.prefs.roomLimit) { ignored(\"room limit\"); return; }\n", ""]], BT, "FAIL — M: THE ROOM-WIDE LIMIT", "RED"],
  ["CM6", [[RB, "    Promise.resolve(RepPorts.sendChat(roomId, text)).then((res) => {", "    Promise.resolve(RepPorts.sendChat(tiers.tiers[0].id, text)).then((res) => {"]],
    BT, "FAIL — M: under the room's CURRENT settings (a self-vote now counts both ways), and in the staff tier when asked there", "RED"],
  ["CM7", [[RB, "    const set = RepPorts.settings() || {}, all = _totals(s.table);", "    const set = {}, all = _totals(s.table);"]], BT, "FAIL — M: under the room's CURRENT settings", "RED"],
  ["CM8", [[RB, "    while (k > 1 && line(k).length > REPLY_MAX) k--;\n    return line(k).slice(0, REPLY_MAX);", "    return line(k);"]], BT, "FAIL — M: AT MOST 512 CHARACTERS", "RED"],
  ["CM9", [[RB, ".filter((r) => r.v > 0)\n", "\n"]], BT, "FAIL — M: @tops — by saves both ways; nobody at 0 is listed", "RED"],
  ["CM10", [[RB, "    if (s.prefs.commands !== true) { ignored(\"commands are off on this device\"); return; }\n", ""]], BT, "FAIL — M: commands off", "RED"],
  ["CM11", [[RB, "      return user + \" VG=\" + x.VG + \" VR=\" + x.VR + \" SG=\" + x.SG + \" SR=\" + x.SR;",
    "      return user + \" VG=\" + x.VG + \" VR=\" + x.VR + \" SG=\" + x.SG + \" SR=\" + x.SR + \" · counted since \" + _day(s.table.since || 0);"]],
    BT, "FAIL — M: and no coverage text", "RED"],
  ["CM12", [[RB, "      if (!all[user]) return user + \" is not in the reputation table.\";\n", ""]], BT, "FAIL — M: someone the table does not hold is said to be not in it", "RED"],
  // ── J84-5: FILES (§5.3; Q4, Q7, ruling 14) ──
  ["FL1", [[RB, "    ui.download(_fileName(s, now, \"backup\"), backup);   // ALWAYS FIRST, before anything else\n", ""]], BT, "FAIL — N: REPLACE — THE BACKUP DOWNLOADS FIRST", "RED"],
  ["FL2", [[RB, "    if (file) for (const u of Object.keys(file.rows)) t.base[u] = file.rows[u].slice();",
    "    if (old) for (const u of Object.keys(old.base)) t.base[u] = old.base[u].slice();\n    if (file) for (const u of Object.keys(file.rows)) t.base[u] = RepRules.plus(t.base[u], file.rows[u]);"]],
    BT, "FAIL — N: CONFIRMED, THE TABLE IS REPLACED — NEVER MERGED", "RED"],
  ["FL3", [[RB, "        if (yes !== true) { _log((fresh ? \"start fresh\" : \"replace\") + \" cancelled — nothing changed\"); return { ok: false, why: \"cancelled\" }; }\n", ""]],
    BT, "FAIL — N: cancelled at the preview — nothing changed", "RED"],
  ["FL4", [[RB, "    if (!o || typeof o !== \"object\" || Array.isArray(o) || o.format !== FORMAT) return", "    if (!o || typeof o !== \"object\" || Array.isArray(o)) return"]],
    BT, "FAIL — N: a file that is not a reputation table is refused", "RED"],
  ["FL5", [[RB, "           other ? \"ANOTHER ROOM: \" + (file.roomName ? file.roomName + \" (\" + file.room + \")\" : file.room) : \"This room: \" + (RepPorts.roomName() || file.roomName || file.room),",
    "           \"This room: \" + (RepPorts.roomName() || file.roomName || file.room),"]],
    BT, "FAIL — N: a file from ANOTHER ROOM is named and flagged", "RED"],
  // The preview names the people and the room (J84-5 item 2, as the owner worded it).
  ["FL13", [[RB, "        : [_peopleLine(file), \"Exported \"", "        : [file.people + \" people\", \"Exported \""]], BT, "FAIL — N: THE PREVIEW names the people", "RED"],
  ["FL14", [[RB, ": \"This room: \" + (RepPorts.roomName() || file.roomName || file.room),", ": \"This room\","]], BT, "FAIL — N: THE PREVIEW names the people", "RED"],
  ["FL15", [[RB, "(ranked.length > PREVIEW_NAMES ? \" and \" + (ranked.length - PREVIEW_NAMES) + \" more\" : \"\")", "\"\""]], BT, "FAIL — N: a long file: the first eight by REP named, the rest counted", "RED"],
  ["FL6", [[RB, "    s.freshNow = fresh ? \"after Start fresh\" : \"after a Replace\";\n", ""]], BT, "FAIL — N: A FRESH SUMMARY GOES AT ONCE", "RED"],
  ["FL7", [[RB, "    t.cut = _cutNow(s);\n", "    t.cut = null;\n"]], BT, "FAIL — N: cut at the current song's play", "RED"],
  ["FL8", [[RB, "    const picked = fresh ? Promise.resolve(null) : Promise.resolve(ui.pick());", "    const picked = Promise.resolve(ui.pick());"]], BT, "FAIL — N: START FRESH", "RED"],
  ["FL9", [[RB, "    for (const u of Object.keys(t.base)) out[u] = RepRules.plus(t.base[u], fwd[u]);", "    for (const u of Object.keys(t.base)) out[u] = t.base[u].slice();"]],
    BT, "FAIL — N: the whole table as it is now", "RED"],
  ["FL10", [[RB, "    _noTable(s, now, days * DAY);\n", "    s.windowMs = days * DAY; _noTable(s, now);\n"]], BT, "FAIL — N: the room's start found within thirty days", "RED"],
  ["FL11", [[RB, "    if (!s || s.writer !== true || !s.noBase || now === null) return { ok: false, why: \"only with no table and no summary\" };",
    "    if (!s || s.writer !== true || now === null) return { ok: false, why: \"only with no table and no summary\" };"]], BT, "FAIL — N: and offered only while there is no base", "RED"],
  ["FL12", [[RB, "    if (s.noBase) {\n      rows.push({ kind: \"button\", key: \"startFresh\"", "    if (false) {\n      rows.push({ kind: \"button\", key: \"startFresh\""]],
    BT, "FAIL — N: WITH NO BASE (Q4) the card offers Start fresh and Look further back", "RED"],
  // ── J84-5: THE BOT'S OWN SETTINGS (§5.1) ──
  ["PF1", [[RB, "    return typeof v === \"number\" && isFinite(v) && Math.floor(v) === v && v >= d.min && v <= d.max;", "    return typeof v === \"number\";"]],
    BT, "FAIL — O: a value outside its range", "RED"],
  ["PF2", [[RB, "    try { RepPorts.prefsSave(s.spaceId, Object.assign({}, s.prefs)); } catch (e) {}\n", ""]], BT, "FAIL — O: A CHANGE IS KEPT AND SAVED", "RED"],
  ["PF3", [[RB, "        s.prefs = _prefsOf(pf);\n", "        s.prefs = _prefsOf(null);\n"]], BT, "FAIL — O: and read back at the next start", "RED"],
  ["PF4", [[RB, "    if (s.writer === false) return { heading: head, note: \"Another tab of this account writes REP for this room — this tab only reads.\", rows: [] };\n", ""]],
    BT, "FAIL — O: a tab that does not hold the lock offers nothing", "RED"],
  ["RP5", [[RP, "return (c && typeof c.name === \"string\" && c.name) ? c.name : null;", "return c ? c.spaceId : null;"]], PO, "FAIL — B: roomName reads the running room's name", "RED"],
  // ── J84-5: THE BOT CARD (H4) ──
  ["UI1", [[US, "    if (!isBot) return null;\n    let on = false;", "    if (!isBot) { _repSection(_prefCard(\"Bot\")); return null; }\n    let on = false;"]],
    BK, "FAIL — A: A TAB THAT IS NOT THE BOT has no Bot card", "RED"],
  ["UI2", [[US, "    const after = (res) => { if (res && res.ok === false) msg.textContent = res.why || \"That didn't work.\"; else renderChatSettings(); };",
    "    const after = (res) => { renderChatSettings(); };"]], BK, "FAIL — C: REFUSED, the bot side's words are shown", "RED"],
  ["UI3", [[US, "      if (r.kind === \"number\") inp.onchange = () => after(r.set(Number(inp.value)));", "      if (r.kind === \"number\") inp.onchange = () => after(r.set(inp.value));"]],
    BK, "FAIL — C: A NUMBER GOES BACK TO ITS ROW as a number", "RED"],
  ["UI4", [[US, "      if (r.enabled === false) b.disabled = true;\n", ""]], BK, "FAIL — B: the buttons, one disabled where the bot side says so", "RED"],
  ["UI5", [[US, "  function _repUi(box, msg) {\n    return {\n", "  function _repUi(box, msg) {\n    return {\n      settings: () => null,\n"]], BK, "FAIL — C: A BUTTON RUNS ITS FLOW, lent three primitives", "RED"],
  ["UI6", [[US, "        const pv = H.el(\"div\", { class: \"rep-preview\" + (o && o.other ? \" rep-other\" : \"\") });", "        const pv = H.el(\"div\", { class: \"rep-preview\" });"]],
    BK, "FAIL — D: CONFIRM SHOWS THE LINES IN THE CARD", "RED"],
  ["UI7", [[US, "      b.onclick = () => { Promise.resolve(r.run(ui)).then((res) => { if (res && res.ok === false && res.why === \"cancelled\") return; after(res); }); };",
    "      b.onclick = () => { Promise.resolve(r.run(ui)).then((res) => { after(res); }); };"]], BK, "FAIL — C: a cancelled flow says nothing", "RED"],
  // ── J84-5: THE BOUNDARY ──
  // RB9 — the reach `ddjp_581`'s identifier reading missed: a global inside a template literal's `${…}`.
  ["RB9", [[RB, "  let _s = null, _gen = 0;\n", "  let _s = null, _gen = 0;\n  const __leak = () => `${StreamManager.getState()}`;\n"]], BD, "FAIL — B: `features/rep-bot.js` names no app global", "RED"],
  // RB10 — a second REP name in the settings panel, beside H4.
  ["RB10", [[US, "    try { c = (typeof Rep !== \"undefined\" && Rep.botCard) ? Rep.botCard() : null; } catch (e) { c = null; }",
    "    try { c = (typeof Rep !== \"undefined\" && Rep.botCard) ? Rep.botCard() : null; Rep.badge(\"x\"); } catch (e) { c = null; }"]], BD, "FAIL — D: `ui/settings.js` calls `Rep.botCard` once", "RED"],
  // N1 — THE CONTROL: an edit that changes nothing; the guard must stay green, so a green above is a reading of a live run.
  ["N1", [[RR, "  function kindOf(type) {", "\n  function kindOf(type) {"]], RU, "", "GREEN"],
  // N2 — THE BOT SIDE'S CONTROL, the same kind, for its own guard.
  ["N2", [[RB, "  let _s = null, _gen = 0;\n", "  let _s = null, _gen = 0;\n\n"]], BT, "", "GREEN"],
  // N3, N4 — THE READER'S AND THE PEOPLE TAB'S CONTROLS, the same kind, for their own guards.
  ["N3", [[RD, "  let _r = null, _gen = 0;\n", "  let _r = null, _gen = 0;\n\n"]], RE, "", "GREEN"],
  ["N4", [[RO, "  function _repBadge(userId) {\n", "\n  function _repBadge(userId) {\n"]], PT, "", "GREEN"],
  // N5 — THE BOT CARD'S CONTROL.
  ["N5", [[US, "  function _repUi(box, msg) {\n", "\n  function _repUi(box, msg) {\n"]], BK, "", "GREEN"],
];
let planted = [];
function restore() { for (const p of planted) fs.writeFileSync(p.file, p.original); planted = []; }
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { restore(); process.exit(130); });
process.on("exit", restore);
let good = 0, bad = 0;
for (const [id, edits, guard, expect, want] of ROWS) {
  // EVERY EDIT IS CHECKED BEFORE ANY IS WRITTEN: an anchor gone or doubled VOIDs the row and nothing is planted.
  const plan = [];
  let voided = null;
  const after = new Map();
  for (const [rel, oldS, newS] of edits) {
    const file = path.join(ROOT, rel);
    const original = after.has(file) ? after.get(file).original : fs.readFileSync(file, "utf8");
    const cur = after.has(file) ? after.get(file).mutated : original;
    const n = cur.split(oldS).length - 1;
    if (n !== 1) { voided = "anchor occurs " + n + " times in " + rel; break; }
    const mutated = cur.replace(oldS, newS);
    if (mutated === cur) { voided = "the edit changed nothing in " + rel; break; }
    after.set(file, { original, mutated });
  }
  if (voided) { console.log("VOID  " + id + " — " + voided); bad++; continue; }
  for (const [file, v] of after) plan.push({ file, original: v.original, mutated: v.mutated });
  let out = "", code = 0;
  try {
    for (const p of plan) { planted.push({ file: p.file, original: p.original }); fs.writeFileSync(p.file, p.mutated); }
    if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.mutated)) { console.log("VOID  " + id + " — an edit did not reach disk"); bad++; continue; }
    const r = spawnSync("node", [path.join("tests", guard + ".js")], { cwd: ROOT, encoding: "utf8", timeout: 240000 });
    out = (r.stdout || "") + (r.stderr || ""); code = r.status === null ? 1 : r.status;
  } finally { restore(); }
  if (plan.some((p) => fs.readFileSync(p.file, "utf8") !== p.original)) { console.log("ABORT — a file of row " + id + " was not restored"); process.exit(2); }
  if (want === "RED") {
    const v = redAsNamed(code, out, expect);
    if (v.mark === "RED") { good++; console.log("RED   " + id + "  " + guard + "  (" + expect + ")"); }
    else { bad++; console.log((v.mark === "WRONG" ? "WRONG " : "GREEN ") + id + "  " + guard + " — expected " + expect + (v.why ? " (" + v.why + ")" : "")); }
  } else {
    if (staysGreen(code, out)) { good++; console.log("MEASURED " + id + "  " + guard + " stays green — the control"); }
    else { bad++; console.log("RED?  " + id + "  " + guard + " — the control went red: the guard is not reading what the rows think it is"); }
  }
}
console.log((bad ? "FAIL" : "PASS") + " — " + good + " as expected, " + bad + " not");
process.exit(bad ? 1 : 0);
