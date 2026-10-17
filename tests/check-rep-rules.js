// tests/check-rep-rules.js
// SUBJECT: features/rep-rules.js, backends/backend1/statederiver.js, ui/settings.js
//
// WALL: REP'S RULES ARE ONE PURE PIECE, AND EVERY RULE IN IT IS DRIVEN (J84; the owner's rulings 21c, 23, 26, 28, 32).
// The bot side and every device's reader will both call this file, so a rule wrong here is wrong everywhere at once —
// and a rule decided anywhere else would let the two sides count differently. It runs in an EMPTY sandbox: no app
// global exists there, so a rule that reached for one would throw.
//
//   A  WHAT COUNTS: a vote or save naming a playing in song history, at or after the cut, by an eligible person —
//      each refusal beside the admitted case one step away. `ddjp.count.set` is not a reaction.
//   B  ONE PER PERSON PER PLAYING (the fold's own dedup, so the key is the receipt): the same reaction twice counts once;
//      a vote and a save by one person both count; two playings of the same song are two.
//   C  WHO EARNS WHAT: a vote on another's playing is +1 given to the voter and +1 received by the DJ; a vote on one's
//      own playing is one self-vote; saves the same. Rebuilt from messages cut at different songs (J84-4), each person
//      is credited only from their own cut, and someone with no cut nothing.
//   D  THE SPLIT UNDER THE ROOM'S CURRENT SETTINGS (ruling 26): all four combinations of the two switches; a self-vote
//      counts as given AND received when on (+2 REP, ruling 32); REP = VG + VR; the same split shows differently when
//      the setting changes — past and future alike.
//   E  THE CUT: a late reaction on an earlier playing is refused; the cut playing itself counts; ties by id, as song
//      history orders them.
//   F  THE MESSAGES: a summary and an addition round-trip; trailing zeros are dropped; a body with a field the
//      transport stamps, a duplicate person, a fraction or a negative is refused; an addition applies to its own summary
//      only, a later one replacing an earlier; the newer summary wins by serial, then position; a message as it arrives
//      reads once the transport's four stamps are off, and is believed only top-level on the owner-level channel from 99 up.
//   G  THE SIZE BUDGET (ruling 28): a summary as sent stays under 60,000 bytes; the highest REP rows are kept and the
//      rest counted in `more`; a small summary keeps everyone.
//   H  J19's SHAPE (c), DRIVEN: the same rule over all the reactions and over the newer half gives different answers —
//      two honest views — which is why REP is believed from the bot and never derived.
//   S  THE THREE ROOM SETTINGS (ruling 23; Q8's range): their defaults (a summary every hour, both switches off), the
//      interval's range (10 minutes to 24 hours, typed in minutes) folding at both ends and refusing one past, the switches
//      folding only as booleans, and the panel's row offering exactly the range. Read from the reducer in a context of its
//      own, never in the rules' empty sandbox — the rules read the settings they are handed.
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rep-rules] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}

// ── LOADED IN AN EMPTY SANDBOX ──────────────────────────────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(ROOT, "features/rep-rules.js"), "utf8");
const ctx = vm.createContext({});
vm.runInContext(src + "\n;this.RepRules = RepRules;", ctx, { filename: "rep-rules.js" });
const R = ctx.RepRules;
ok(!!R && typeof R.judge === "function", "PREMISE — the rules load in a sandbox holding no app global at all");

const S_OFF = { repSelfVotes: false, repSelfSaves: false }, S_ON = { repSelfVotes: true, repSelfSaves: true };
const P1 = { pi: "$p1", dj: "@dj:hs", l: 100 }, P2 = { pi: "$p2", dj: "@dj:hs", l: 120 }, P0 = { pi: "$p0", dj: "@dj:hs", l: 80 };
const CUT = { pi: "$p1", pos: 100 };
const vote = (voter, pi) => ({ type: "ddjp.dj.vote", voter: voter, pi: pi });
const save = (voter, pi) => ({ type: "ddjp.dj.save", voter: voter, pi: pi });

// ── A — WHAT COUNTS ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const j = (r, p, cut, el) => R.judge(r, p, cut, el);
  ok(j(vote("@a:hs", "$p1"), P1, CUT).counts === true, "A: a vote on a playing at the cut, by an eligible person, counts (the admitted case)");
  ok(j({ type: "ddjp.count.set", voter: "@owner:hs", pi: "$p1" }, P1, CUT).why === "not a reaction", "A: `ddjp.count.set` is not a reaction — the owner's adjustments never count");
  ok(j({ type: "ddjp.dj.play", voter: "@a:hs", pi: "$p1" }, P1, CUT).counts === false, "A: nor is a play");
  ok(j(vote("a", "$p1"), P1, CUT).why === "no person" && j(vote("@a:hs", ""), P1, CUT).why === "names no playing", "A: no person, or no playing named, refused");
  ok(j(vote("@a:hs", "$p1"), null, CUT).why === "not a playing", "A: a reaction naming no playing song history holds is refused — the reducer's own rule");
  ok(j(vote("@a:hs", "$p1"), P2, CUT).why === "not a playing", "A: and so is one whose playing record is another playing's");
  ok(j(vote("@a:hs", "$p0"), P0, CUT).why === "before the cut", "A: a playing before the cut is refused");
  ok(j(vote("@a:hs", "$p1"), P1, CUT, false).why === "not eligible", "A: an ineligible person is refused — the reducer's eligibility seam");
  ok(j(vote("@a:hs", "$p0"), P0, null).counts === true, "A: with no cut (a room counted from its start) every playing is open");
}

// ── B — ONE PER PERSON PER PLAYING ──────────────────────────────────────────────────────────────────────────────────
{
  const acc = R.newAccumulator();
  ok(R.add(acc, vote("@a:hs", "$p1"), P1, CUT).added === true, "B: APPLIED — a first vote is added");
  const again = R.add(acc, vote("@a:hs", "$p1"), P1, CUT);
  ok(again.added === false && again.why === "already counted", "B: the same vote again counts nothing — the receipt is (person, playing, kind)", again);
  ok(R.add(acc, save("@a:hs", "$p1"), P1, CUT).added === true, "B: a save by the same person on the same playing is its own reaction");
  const P1b = { pi: "$p1b", dj: "@dj:hs", l: 110 };   // the same song played again is another playing
  ok(R.add(acc, vote("@a:hs", "$p1b"), P1b, CUT).added === true, "B: a vote on a second playing of the same song counts — one per PLAYING, never per song");
  ok(R.has(acc, "@a:hs", "$p1", "v") && !R.has(acc, "@b:hs", "$p1", "v"), "B: and `has` reads a receipt back");
  ok(R.receiptOf("@a:hs", "$p1", "v") !== R.receiptOf("@a:hs", "$p1", "s"), "B: a vote's and a save's receipts differ");
}

// ── C — WHO EARNS WHAT ──────────────────────────────────────────────────────────────────────────────────────────────
{
  const acc = R.newAccumulator();
  R.add(acc, vote("@a:hs", "$p1"), P1, CUT);       // a on dj's playing
  R.add(acc, save("@b:hs", "$p1"), P1, CUT);       // b saves dj's playing
  R.add(acc, vote("@dj:hs", "$p1"), P1, CUT);      // dj on their own playing: a self-vote
  R.add(acc, save("@dj:hs", "$p2"), P2, CUT);      // dj saves their own: a self-save
  const c = R.contributions(acc);
  ok(JSON.stringify(c["@a:hs"]) === "[1,0,0,0,0,0]", "C: a vote on another's playing is +1 vote given to the voter", c["@a:hs"]);
  ok(JSON.stringify(c["@b:hs"]) === "[0,0,1,0,0,0]", "C: a save is +1 save given", c["@b:hs"]);
  ok(JSON.stringify(c["@dj:hs"]) === "[0,1,0,1,1,1]", "C: the DJ: +1 vote and +1 save received, and one self-vote and one self-save kept apart", c["@dj:hs"]);
  // ADDED AT J84-4 (a table rebuilt from messages cut at different songs): each person is credited only from THEIR OWN cut,
  // the voter's half and the DJ's half of one reaction judged apart, and someone with no cut credited nothing.
  const cut2 = { pi: P2.pi, pos: P2.l };
  const own = { "@a:hs": CUT, "@dj:hs": cut2, "@b:hs": CUT };
  const f = R.contributionsFrom(acc, (u) => own[u] || null);
  ok(JSON.stringify(f["@a:hs"]) === "[1,0,0,0,0,0]" && JSON.stringify(f["@b:hs"]) === "[0,0,1,0,0,0]",
    "C: FROM EACH PERSON'S OWN CUT — the voters, cut at the room's cut, are credited as before", [f["@a:hs"], f["@b:hs"]]);
  ok(JSON.stringify(f["@dj:hs"]) === "[0,0,0,0,0,1]",
    "C: and the DJ, cut later, only for what came at or after their own cut — the received halves before it are not theirs to add", f["@dj:hs"]);
  const none = R.contributionsFrom(acc, (u) => (u === "@a:hs" ? CUT : undefined));
  ok(Object.keys(none).join() === "@a:hs", "C: someone with no cut is credited nothing at all", Object.keys(none));
}

// ── D — THE SPLIT UNDER THE ROOM'S CURRENT SETTINGS ─────────────────────────────────────────────────────────────────
{
  const split = [3, 5, 2, 4, 1, 2];   // vg vr sg sr sv ss
  const off = R.shown(split, S_OFF), on = R.shown(split, S_ON);
  ok(off.VG === 3 && off.VR === 5 && off.SG === 2 && off.SR === 4 && off.REP === 8, "D: both switches off: self-reactions count nowhere; REP = VG + VR", off);
  ok(on.VG === 4 && on.VR === 6 && on.SG === 4 && on.SR === 6 && on.REP === 10, "D: both on: a self-vote is given AND received (+2 REP), a self-save likewise", on);
  const v = R.shown(split, { repSelfVotes: true, repSelfSaves: false }), s = R.shown(split, { repSelfVotes: false, repSelfSaves: true });
  ok(v.VG === 4 && v.SG === 2 && s.VG === 3 && s.SG === 4 && v.REP === 10 && s.REP === 8, "D: each switch moves only its own kind; saves never change REP", [v, s]);
  ok(R.shown(split, {}).REP === 8 && R.shown(split, null).REP === 8, "D: a missing or unreadable setting is OFF, the default");
  ok(R.shown(split, S_OFF).REP !== R.shown(split, S_ON).REP, "D: the SAME split shows differently when the setting changes — past and future alike (ruling 26)");
}

// ── E — THE CUT ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok(R.atOrAfterCut({ pi: "$p1", l: 100 }, CUT) && R.atOrAfterCut({ pi: "$p9", l: 101 }, CUT), "E: the cut playing and a later one are open");
  ok(!R.atOrAfterCut({ pi: "$p0", l: 99 }, CUT), "E: an earlier one is closed — a late vote on it is ignored by everyone");
  ok(R.atOrAfterCut({ pi: "$p2", l: 100 }, CUT) && !R.atOrAfterCut({ pi: "$p0", l: 100 }, CUT), "E: at one position, by id — song history's own tie-break");
  ok(R.compareAt(1, "$a", 1, "$b") < 0 && R.compareAt(2, "$a", 1, "$b") > 0, "E: and the order is position, then id");
}

// ── F — THE MESSAGES ────────────────────────────────────────────────────────────────────────────────────────────────
{
  ok(JSON.stringify(R.encodeRow("@a:hs", [3, 0, 1, 0, 0, 0])) === JSON.stringify(["@a:hs", 3, 0, 1]), "F: a row drops its trailing zeros");
  const body = R.summary({ n: 1700000000000, cut: CUT, since: 1690000000000, rows: [{ user: "@a:hs", split: [1, 2, 0, 0, 0, 0] }, { user: "@b:hs", split: R.zero() }], more: 0 });
  const back = R.readSummary(JSON.parse(JSON.stringify(body)));
  ok(back.ok && back.value.rows.length === 2 && JSON.stringify(back.value.rows[0].split) === "[1,2,0,0,0,0]" && back.value.rows[1].split.join() === "0,0,0,0,0,0",
    "F: a summary round-trips, every split whole again", back);
  ok(back.value.cut.pi === "$p1" && back.value.cut.pos === 100 && back.value.since === 1690000000000, "F: with its cut and its `since`");
  for (const k of ["t", "l", "actor", "p"]) ok(R.readSummary(Object.assign({}, body, { [k]: 1 })).ok === false, "F: a body carrying `" + k + "` is refused");
  ok(R.readSummary(Object.assign({}, body, { v: 2 })).why === "unknown version", "F: an unknown version is refused (forward only)");
  ok(R.readSummary(Object.assign({}, body, { rows: [["@a:hs", 1], ["@a:hs", 2]] })).ok === false, "F: a person twice is refused");
  ok(R.readSummary(Object.assign({}, body, { rows: [["@a:hs", 1.5]] })).ok === false && R.readSummary(Object.assign({}, body, { rows: [["@a:hs", -1]] })).ok === false,
    "F: a fraction or a negative is refused");
  ok(R.readSummary(Object.assign({}, body, { rows: [["nobody", 1]] })).ok === false, "F: a row that names no Matrix ID is refused");
  // ADDED AT J84-1's break run (the reason): a summary with its serial removed was read — `mutate-j84-rep` RR10 left this green.
  const without = (k) => { const o = Object.assign({}, body); delete o[k]; return o; };
  ok(R.readSummary(without("n")).why === "no serial" && R.readSummary(Object.assign({}, body, { n: -1 })).why === "no serial",
    "F: a summary with no serial is refused — the serial is what makes one summary newer than another");
  ok(R.readSummary(without("cut")).why === "no cut" && R.readSummary(Object.assign({}, body, { cut: { pi: "$p1" } })).why === "no cut",
    "F: and one with no cut, or half a cut, is refused");
  const sum = Object.assign({}, back.value, { id: "$sum1", l: 500 });
  const add1 = R.readAddition(R.addition({ of: "$sum1", n: sum.n, k: 1, rows: [{ user: "@c:hs", split: [0, 1, 0, 0, 0, 0] }] })).value;
  const add2 = R.readAddition(R.addition({ of: "$sum1", n: sum.n, k: 2, rows: [{ user: "@c:hs", split: [0, 2, 0, 0, 0, 0] }] })).value;
  const stray = R.readAddition(R.addition({ of: "$other", n: sum.n, k: 1, rows: [{ user: "@d:hs", split: [5, 0, 0, 0, 0, 0] }] })).value;
  const pub = R.published(sum, [add2, stray, add1]);
  ok(pub["@a:hs"] && pub["@c:hs"] && JSON.stringify(pub["@c:hs"]) === "[0,2,0,0,0,0]" && !pub["@d:hs"],
    "F: additions join their own summary, a later one replacing an earlier; another summary's are not applied", pub);
  ok(R.readAddition({ v: 1, n: 1, k: 1, rows: [] }).ok === false && R.readAddition({ v: 1, of: "$s", n: 1, k: 0, rows: [] }).ok === false,
    "F: an addition naming no summary, or numbered 0, is refused");
  const a = { n: 5, l: 10 }, b = { n: 6, l: 1 }, c = { n: 5, l: 20 };
  ok(R.newer(a, b) === b && R.newer(a, c) === c && R.newer(null, a) === a, "F: the newer summary wins by serial, then position");
  // ADDED AT J84-3 (the reader is the first to read a message as it ARRIVES): what the transport stamps comes off, and only
  // that — a relayed act's field still refuses; and which message a reader believes.
  const stamped = Object.assign({}, body, { t: R.TYPES.summary, l: 9001, dv: 2, hv: 1 });
  ok(R.readSummary(stamped).ok === false && R.readSummary(R.unstamp(stamped)).ok === true && JSON.stringify(R.unstamp(stamped)) === JSON.stringify(body),
    "F: a summary as the transport stamped it reads once the four stamped fields (`t`, `l`, `dv`, `hv`) are taken off — and is exactly what was sent",
    R.unstamp(stamped));
  ok(R.readSummary(R.unstamp(Object.assign({}, stamped, { actor: "@a:hs" }))).why === "a reserved field", "F: and anything else reserved is still refused after it");
  ok(R.trust({ channel: "events_owner", id: "$e1", level: 99 }).ok === true && R.trust({ channel: "events_owner", id: "$e1", level: 100 }).ok === true,
    "F: TRUST — top-level, on the owner-level channel, from the bot (99) or the owner above it");
  ok(R.trust({ channel: "events_uncategorized", id: "$e1", level: 100 }).ok === false && R.trust({ channel: null, id: "$e1", level: 100 }).ok === false,
    "F: never another channel, or one it cannot name");
  ok(R.trust({ channel: "events_owner", id: "$carrier#3", level: 99 }).ok === false && R.trust({ channel: "events_owner", id: "", level: 99 }).ok === false,
    "F: never a relay batch's member (`<carrier>#<k>`), never an event with no id");
  ok(R.trust({ channel: "events_owner", id: "$e1", level: 98 }).ok === false && R.trust({ channel: "events_owner", id: "$e1" }).ok === false,
    "F: never a sender below 99, or one whose level is unknown");
}

// ── G — THE SIZE BUDGET ─────────────────────────────────────────────────────────────────────────────────────────────
{
  const many = [];
  for (let i = 0; i < 3000; i++) many.push({ user: "@person-" + String(i).padStart(4, "0") + ":some.homeserver.example", split: [i % 50, (i * 7) % 300, i % 9, i % 11, i % 3, i % 2] });
  const fit = R.fitSummary({ n: 1, cut: CUT, since: null, rows: many }, S_OFF);
  const bytes = R.sentBytes(R.TYPES.summary, fit.body);
  ok(bytes <= R.LIMITS.budgetBytes && bytes > R.LIMITS.budgetBytes - 400, "G: a big room's summary, as sent, fills but never passes the budget", bytes);
  ok(fit.kept > 100 && fit.kept < 3000 && fit.more === 3000 - fit.kept && fit.body.more === fit.more, "G: it keeps what fits and counts the rest in `more`", { kept: fit.kept, more: fit.more });
  const kept = R.readSummary(fit.body).value.rows.map((r) => R.shown(r.split, S_OFF).REP);
  const sorted = many.map((r) => R.shown(r.split, S_OFF).REP).sort((x, y) => y - x);
  ok(kept.every((v, i) => v === sorted[i]) && kept[kept.length - 1] === fit.lowestKept, "G: the rows kept are the highest REP, in order — the left-out are the lowest", kept.slice(-3));
  const small = R.fitSummary({ n: 1, cut: CUT, since: null, rows: many.slice(0, 5) }, S_OFF);
  ok(small.kept === 5 && small.more === 0, "G: a small summary keeps everyone");
  ok(R.sentBytes(R.TYPES.summary, small.body) > JSON.stringify(small.body).length, "G: the measure counts what the transport adds (its fields, the JSON-in-JSON escaping)");
  ok(R.utf8Bytes("é") === 2 && R.utf8Bytes("😀") === 4 && R.utf8Bytes("a") === 1, "G: and counts UTF-8 bytes, not characters");
}

// ── H — J19's SHAPE (c), DRIVEN ─────────────────────────────────────────────────────────────────────────────────────
{
  const plays = [{ pi: "$q1", dj: "@a:hs", l: 1 }, { pi: "$q2", dj: "@b:hs", l: 2 }, { pi: "$q3", dj: "@a:hs", l: 3 }];
  const reactions = [vote("@x:hs", "$q1"), vote("@x:hs", "$q2"), vote("@x:hs", "$q3")];
  const full = R.newAccumulator(), half = R.newAccumulator();
  reactions.forEach((r, i) => R.add(full, r, plays[i], null));
  reactions.slice(2).forEach((r, i) => R.add(half, r, plays[i + 2], null));
  const f = R.contributions(full), h = R.contributions(half);
  ok(f["@a:hs"][1] === 2 && f["@b:hs"][1] === 1 && h["@a:hs"][1] === 1 && !h["@b:hs"],
    "H: one rule, two honest views — all of it gives a:2 b:1, the newer half gives a:1. A number meant to outlive forgotten history cannot be derived from what survives, so REP is believed from the bot (J19's shape (c), closed)", [f, h]);
}

// ── S — THE THREE ROOM SETTINGS ─────────────────────────────────────────────────────────────────────────────────────
{
  const { loadInContext } = require(path.join(__dirname, "_load.js"));
  const c = loadInContext(["backends/backend1/ranks.js", "backends/backend1/statederiver.js"], {});
  const SD = c.StateDeriver, d = SD.defaultSettings(), MIN = 60 * 1000;
  ok(d.repSummaryMs === 60 * MIN && d.repSelfVotes === false && d.repSelfSaves === false,
    "S: A NEW ROOM sends a summary every hour, and counts neither self-votes nor self-saves", [d.repSummaryMs, d.repSelfVotes, d.repSelfSaves]);
  const r = SD.SETTING_RANGES.repSummaryMs;
  ok(r && r.min === 10 * MIN && r.max === 24 * 60 * MIN && r.scale === MIN, "S: the interval runs from 10 minutes to 24 hours, typed in minutes (Q8)", r);
  const fold = (o) => SD.applySettingsEvent(d, o);
  ok(r && fold({ repSummaryMs: r.min }).repSummaryMs === r.min && fold({ repSummaryMs: r.max }).repSummaryMs === r.max,
    "S: both ends FOLD — a key the reducer declares but never merges is a value the owner sets and the room discards");
  ok(r && fold({ repSummaryMs: r.max + 1 }).repSummaryMs === d.repSummaryMs && fold({ repSummaryMs: r.min - 1 }).repSummaryMs === d.repSummaryMs,
    "S: and one past either end is refused, not clamped");
  ok(fold({ repSelfVotes: true }).repSelfVotes === true && fold({ repSelfSaves: true }).repSelfSaves === true,
    "S: each switch folds when turned on");
  ok(fold({ repSelfVotes: 1 }).repSelfVotes === false && fold({ repSelfSaves: "yes" }).repSelfSaves === false,
    "S: and folds ONLY as a boolean — a truthy number or string is refused, so no room can read it two ways");
  const ui = fs.readFileSync(path.join(ROOT, "ui/settings.js"), "utf8");
  const m = /_renderNumberSettingRow\(\s*"repSummaryMs"\s*,[^,]*,[^,]*,\s*(\d+)\s*,\s*(\d+)\s*,/.exec(ui);
  ok(!!m && r && Number(m[1]) * MIN === r.min && Number(m[2]) * MIN === r.max,
    "S: the panel's row offers exactly the range — a wider row offers values the room refuses, a narrower one hides ones it takes",
    m ? [m[1], m[2]] : "(no row)");
}

if (failed) { console.log("[rep-rules] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[rep-rules] PASS — REP's rules are one pure piece and every rule in it is driven (J84; " + asserts + " assertions), in a " +
  "sandbox holding no app global. WHAT COUNTS: a vote or save naming a playing in song history, at or after the cut, by an " +
  "eligible person — never `count.set`, never a refused reaction. ONE PER PERSON PER PLAYING, the fold's own dedup, so that " +
  "key is the receipt. WHO EARNS WHAT: given to the voter, received by the DJ, and a reaction on one's own playing kept apart. " +
  "THE SPLIT is shown under the room's CURRENT settings, all four combinations, a self-vote counting as given and received " +
  "(+2 REP), so a settings change shows at once for past and future alike. THE CUT closes earlier playings, ties by id. THE " +
  "MESSAGES round-trip and refuse what they must; additions join only their own summary; the newer summary wins. THE BUDGET " +
  "keeps a summary under 60,000 bytes as sent, the highest REP first, the rest counted. And J19's shape (c) is closed by " +
  "measurement. THE THREE ROOM SETTINGS default to an hour and off, fold at both ends of 10 minutes to 24 hours and only as " +
  "booleans, and the panel offers exactly that. THIS GUARD CANNOT TELL YOU THE TWO SIDES CALL THESE RULES — `check-rep-boundary` holds that half");
