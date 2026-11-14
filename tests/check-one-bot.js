#!/usr/bin/env node
// tests/check-one-bot.js
// SUBJECT: features/room.js, features/actions.js, ui/roster.js
//
// WALL: ONE BOT PER ROOM (J140). His finding on `?v=605`, his words: "alsoit was possible to give someone bot rank at the
// firstt room upgrade or invite other people, im thinking this may cuase problems with rights or autority over channels". Shown
// the Bot choice greyed naming who holds it, with a confirm before appointing, his answer at `ddjp_690`: "1 no id rather the
// bot selector we have not turn unavailable and say bot already assigned / its simpler". Read plainly: the rank picker stays as
// it is; while ANOTHER account holds the bot's rank, the Bot choice is unavailable and reads "Bot already assigned"; no name,
// no confirm; a room with no bot as before ("Bot (appoint as room bot)").
//
// THE RULE LIVES WHERE RANK CHOICES ARE DECIDED (`Room.botTaken`, read by the adapter as availability), NOT IN ui/ — the card's
// picker only shows it — and `Room.assignRank` refuses by the same rule at the act. Driven in BOTH room types (a shared room,
// `backend1`; a bot room, `backend2`) through the REAL bridge, room and adapter over the model homeserver
// (`tests/_inviteworld.js`), and the REAL card and rank picker (`tests/_probe-j14-card.js`, the tree shaped like the DOM):
//   A  THE ADAPTER: the bot's level for someone else, while an account holds it — not available, permitted, "Bot already
//      assigned"; the other rungs untouched; the bot's own level for the bot itself available (it adds no bot); a room with no
//      bot, available; a room whose DEFAULT level is the bot's, not available; a power list this tab cannot read, available.
//   B  THE ACT: `Room.assignRank` to the bot's level while another holds it is refused by name, "Bot already assigned", with
//      nothing sent and no change started, and a line saying who holds it; `Actions.perform` refuses with the same words; with
//      no bot the same change starts; the bot's own re-apply is not refused.
//   C  THE CARD: someone else's card, a bot in the room — the Bot choice reads "Bot already assigned", greyed, and cannot be
//      picked: forced, nothing is sent, the box goes back to their rank, the card says "Bot already assigned"; every other rung
//      as before; no bot — "Bot (appoint as room bot)", live; the bot's OWN card — "Bot (appoint as room bot)", chosen, live (the
//      worker's decision, `ddjp_690`: their own level adds no bot); the bot demoted elsewhere — the open card follows, live again.
//   D  ui/ decides nothing of it: no ui/ file names the rule or the power list (the picker reads the descriptor). Source-level.
// RED FIRST ON 689: there the adapter offers the Bot choice whatever the room holds and `assignRank` sends it — A, B and C red
// at the rows that name the rule; A's and C's controls green there, as they should be.
"use strict";
const fs = require("fs");
const path = require("path");
const W = require(path.join(__dirname, "_inviteworld.js"));
const P = require(path.join(__dirname, "_probe-j14-card.js"));
const ROOT = path.join(__dirname, "..");

let asserts = 0, failed = 0;
function ok(c, msg, got) { asserts++; if (!c) { failed++; console.log("[one-bot] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); } }
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[one-bot] FAIL — the guard did not finish, so its rows are not a reading"); process.exitCode = 1; } });

const ME = W.ME, THEM = "@them:hs", BOT = "@bot:hs";
const lv = (name) => P.Ranks.levelOf(name);
const TOP = Math.max.apply(null, P.Ranks.LADDER.map((r) => r.level));   // the bot's rung: the ladder's top, derived
const STAFF = lv("staff");
const WORDS = "Bot already assigned", APPOINT = "Bot (appoint as room bot)";
const MODES = [["backend1", "shared room"], ["backend2", "bot room"]];
const turns = async (n) => { for (let i = 0; i < (n || 1); i++) await new Promise((r) => setImmediate(r)); };

// ── THE WORLD: one DDJP room of the given type; this account ("me") its owner at 100, two people in it ──────────────────────
// `o.levels`: more levels (`{ [BOT]: TOP }` puts a bot in the room); `o.usersDefault`: the room's default level; `o.unreadable`:
// the space's power list cannot be read. Every send is RECORDED and HELD (it never answers): a change that starts shows as a
// running change with its first send made, and a refusal as no send at all.
function world(mode, o) {
  o = o || {};
  const hs = W.homeserver();
  const sends = [];
  const held = () => new Promise(() => {});
  const client = {
    sendStateEvent: (rid, type) => { sends.push({ kind: type === "m.room.power_levels" ? "level" : type, rid }); return held(); },
    invite: (rid, u) => { sends.push({ kind: "invite", rid, u }); return held(); },
    kick: (rid, u) => { sends.push({ kind: "kick", rid, u }); return held(); },
  };
  const w = W.inviteWorld({ hs, client });
  const keys = (w.sb.Backends.planFor(mode) || []).map((r) => r.key);
  const sid = "!ob-" + mode + ":hs";
  const R = hs.ddjpRoom(sid, { mode, keys });
  const levels = Object.assign({ [ME]: 100 }, o.levels || {});
  for (const id of [sid].concat(Object.values(R.ch))) {
    hs.rooms[id].power = { users: Object.assign({}, levels), users_default: o.usersDefault || 0 };
    hs.rooms[id].members[ME] = "join";
  }
  for (const u of [THEM, BOT]) {
    hs.rooms[sid].members[u] = "join";
    for (const k of keys) if ((!/^chat_/.test(k) && !/presence/.test(k)) || k === "chat_uncategorized") hs.rooms[R.ch[k]].members[u] = "join";
  }
  if (o.unreadable) hs.rooms[sid].power = null;   // the space's power list: no content to read
  w.Room._enterForTest({ name: "One-bot room", spaceId: sid, channels: R.ch }, mode);
  return { w, hs, sid, ch: R.ch, sends, A: w.sb.Actions, Room: w.Room };
}
const describeFor = (x, who, from, to) => x.A.describe("rank.assign", { userId: who, targetRank: from, newLevel: to });

// ── THE CARD, as the app opens it: the real opener and picker, the real room and adapter, the tree a browser has ─────────────
const flat = (n) => [n].concat(...Array.from((n && n.children) || []).map(flat));
const nodes = (c) => [].concat(...c.mountedNodes.map(flat));
const pickerOf = (c) => nodes(c).find((n) => n.tag === "select");
const optionsOf = (c) => { const s = pickerOf(c); return s ? Array.from(s.children || []).map((n) => ({ value: n.value !== undefined ? n.value : (n.attrs && n.attrs.value), text: n.text, disabled: !!(n.disabled || (n.attrs && n.attrs.disabled)), selected: !!n.selected })) : []; };
const optOf = (c, level) => optionsOf(c).find((x) => String(x.value) === String(level)) || null;
const noteOf = (c) => { const r = nodes(c).find((n) => typeof n.className === "string" && /\buc-note\b/.test(n.className)); return r ? r.text : null; };
const card = (x, who, level) => P.driveCard({ domShaped: true, realRankSelect: true, chromiumFocus: true, unlock: true, Room: x.Room, Actions: x.A,
  member: { userId: who, name: who, level: level } });

(async () => {
  // ═══ A — THE ADAPTER ═══════════════════════════════════════════════════════════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = world(mode, { levels: { [BOT]: TOP } });
    ok(x.Room.getMyAuthorityLevel() === 100 && TOP === 99, "A " + name + ": PREMISE — this account is the room's owner (100) and the bot's rung is the ladder's top (99)", { me: x.Room.getMyAuthorityLevel(), TOP });
    const d = describeFor(x, THEM, 0, TOP);
    ok(d.enabled === false && d.reason === WORDS, "A " + name + ": WHILE AN ACCOUNT HOLDS THE BOT'S RANK, giving it to someone else is NOT AVAILABLE — \"" + WORDS + "\"", d);
    ok(d.permitted === true, "A " + name + ": and it is still PERMITTED — the owner may give the bot's rank; the room's state, not the rule, holds it (so the picker shows it greyed)", d);
    const d2 = describeFor(x, THEM, 0, STAFF);
    ok(d2.enabled === true, "A " + name + ": CONTROL — the other rungs are untouched (staff for them, available)", d2);
    const d3 = describeFor(x, BOT, TOP, TOP);
    ok(d3.enabled === true, "A " + name + ": the bot's own level for THE BOT ITSELF is available — it adds no bot (the re-apply that repairs)", d3);
    const none = world(mode);
    const d4 = describeFor(none, THEM, 0, TOP);
    ok(d4.enabled === true, "A " + name + ": CONTROL — a room with no bot: the bot's rank is available, as before", d4);
    const dflt = world(mode, { usersDefault: TOP });
    const d5 = describeFor(dflt, THEM, TOP, TOP);
    ok(d5.enabled === false && d5.reason === WORDS, "A " + name + ": a room whose DEFAULT level is the bot's (everyone holds it): not available", d5);
    const unread = world(mode, { unreadable: true });
    const d6 = describeFor(unread, THEM, 0, TOP);
    ok(d6.enabled === true, "A " + name + ": a power list this tab cannot read refuses nothing — no reading is not a bot (the warning is the net)", d6);
  }

  // ═══ B — THE ACT ═══════════════════════════════════════════════════════════════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = world(mode, { levels: { [BOT]: TOP } });
    const from = x.w.logs.length;
    const r = await Promise.race([x.Room.assignRank(THEM, TOP), turns(40).then(() => ({ timedOut: true }))]);
    ok(r && r.ok === false && r.reason === "bot-already-assigned" && r.text === WORDS,
      "B " + name + ": `Room.assignRank` REFUSES A SECOND BOT, by name — \"" + WORDS + "\"", r);
    ok(x.sends.length === 0, "B " + name + ": and NOTHING IS SENT for it — no level, no invite", x.sends);
    ok(x.Room.rankJob() === null, "B " + name + ": and no change is started (the picker's wait is not taken)", x.Room.rankJob());
    ok(x.w.lines(new RegExp("Room: " + THEM + " was not given the bot's level \\(" + TOP + "\\) — " + BOT + " already holds it; one bot per room"), from).length === 1,
      "B " + name + ": one line says who holds it", x.w.lines(/Room: /, from));
    let rejected = null;
    try { await x.A.perform("rank.assign", { userId: THEM, targetRank: 0, newLevel: TOP }); } catch (e) { rejected = (e && e.message) || String(e); }
    ok(rejected === WORDS && x.sends.length === 0, "B " + name + ": `Actions.perform` refuses it with the same words, and sends nothing", { rejected, sends: x.sends.length });
    // CONTROL: no bot — the same change STARTS (the rule refuses only a second bot).
    const none = world(mode);
    none.Room.assignRank(THEM, TOP);
    await turns(20);
    const j = none.Room.rankJob();
    ok(j && j.state === "running" && j.level === TOP && j.userId === THEM && none.sends.length >= 1,
      "B " + name + ": CONTROL — with no bot in the room the same change starts and its first step is sent", { job: j, sends: none.sends.length });
    // The bot's own re-apply is not refused by the rule.
    const self = world(mode, { levels: { [BOT]: TOP } });
    self.Room.assignRank(BOT, TOP);
    await turns(20);
    const js = self.Room.rankJob();
    ok(js && js.state === "running" && js.userId === BOT && self.w.lines(/one bot per room/).length === 0,
      "B " + name + ": the bot's own level given to the bot again starts (it adds no bot)", { job: js, lines: self.w.lines(/Room: /) });
  }

  // ═══ C — THE CARD ══════════════════════════════════════════════════════════════════════════════════════════════════════
  for (const [mode, name] of MODES) {
    const x = world(mode, { levels: { [BOT]: TOP } });
    const c = card(x, THEM, 0);
    ok(c.ok && pickerOf(c) && !pickerOf(c).disabled && optionsOf(c).length > 1, "C " + name + ": PREMISE — their card is open and unlocked, its real picker live", c.stage || optionsOf(c));
    if (!(c.ok && pickerOf(c))) continue;
    const bot = optOf(c, TOP);
    ok(bot && bot.text === WORDS && bot.disabled === true,
      "C " + name + ": THE BOT CHOICE, WHILE ANOTHER ACCOUNT HOLDS IT, READS \"" + WORDS + "\" AND IS GREYED", bot);
    ok(!optionsOf(c).some((o) => o.text === APPOINT), "C " + name + ": and no choice offers to appoint a second bot", optionsOf(c));
    const others = optionsOf(c).filter((o) => String(o.value) !== String(TOP));
    ok(others.length >= 5 && others.every((o) => !o.disabled && o.text !== WORDS), "C " + name + ": CONTROL — every other rung as before, live", others);
    // FORCED (a script, or a stale picker): nothing is sent, the box goes back, the card says why.
    const s = pickerOf(c);
    s.focus(); s.value = String(TOP); s.onchange();
    await turns(10);
    ok(x.sends.length === 0 && String(s.value) !== "" , "C " + name + ": FORCED, IT CANNOT BE PICKED — nothing is sent", x.sends);
    ok(String(pickerOf(c).value) === "0" && noteOf(c) === WORDS, "C " + name + ": the box goes back to their rank and the card says \"" + WORDS + "\"", { value: pickerOf(c).value, note: noteOf(c) });
    // NO BOT: as before.
    const none = world(mode);
    const c2 = card(none, THEM, 0);
    const b2 = optOf(c2, TOP);
    ok(b2 && b2.text === APPOINT && !b2.disabled, "C " + name + ": CONTROL — a room with no bot: \"" + APPOINT + "\", live, as before", b2);
    // THE BOT'S OWN CARD (the decision): its own level, chosen and live — it adds no bot. A world of its own, so nothing the rows
    // above did (a change a forced pick started, on a tree without the rule) stands in front of it.
    const own = world(mode, { levels: { [BOT]: TOP } });
    const c3 = card(own, BOT, TOP);
    const b3 = optOf(c3, TOP);
    ok(b3 && b3.text === APPOINT && !b3.disabled && b3.selected && String(pickerOf(c3).value) === String(TOP),
      "C " + name + ": THE BOT'S OWN CARD — \"" + APPOINT + "\", chosen (their rank) and live", { opt: b3, value: c3.ok && pickerOf(c3) && pickerOf(c3).value });
    // THE OPEN CARD FOLLOWS THE ROOM: the bot demoted elsewhere, the card repainted as the app repaints it (a world of its own).
    const fw = world(mode, { levels: { [BOT]: TOP } });
    const c4 = card(fw, THEM, 0);
    ok(optOf(c4, TOP) && optOf(c4, TOP).disabled, "C " + name + ": PREMISE — their card open with the Bot choice greyed", optOf(c4, TOP));
    const p = JSON.parse(JSON.stringify(fw.hs.rooms[fw.sid].power)); p.users[BOT] = 0;
    fw.hs.rooms[fw.sid].power = p;
    fw.w.state(fw.sid, "m.room.power_levels", "", p, ME);
    c4.refresh(); c4.flushTimers();
    const b4 = optOf(c4, TOP);
    ok(b4 && b4.text === APPOINT && !b4.disabled, "C " + name + ": THE BOT DEMOTED ELSEWHERE — the open card follows: \"" + APPOINT + "\", live again", b4);
  }

  // ═══ D — ui/ DECIDES NOTHING OF IT (source-level: a regex proves a name is not SPELLED, which is all it claims) ══════════
  {
    const uiFiles = fs.readdirSync(path.join(ROOT, "ui")).filter((f) => f.endsWith(".js"));
    const hits = [];
    for (const f of uiFiles) {
      const code = fs.readFileSync(path.join(ROOT, "ui", f), "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      if (/\bbotTaken\b|\baccountsAtLevel\b|Bot already assigned/.test(code)) hits.push(f);
    }
    ok(uiFiles.length >= 10 && hits.length === 0, "D: no ui/ file names the rule, the power list or its words — the picker shows the adapter's reason", hits);
  }

  _finished = true;
  if (failed) { console.log("[one-bot] FAIL — " + failed + " of " + asserts + " assertions"); process.exit(1); }
  console.log("[one-bot] PASS — one bot per room (J140, the owner's: \"turn unavailable and say bot already assigned\"), in a shared room " +
    "and in a bot room, through the real bridge, room, adapter, card and picker: while another account holds the bot's rank, giving " +
    "it to anyone else is not available — the picker shows the Bot choice greyed as \"" + WORDS + "\" and it cannot be picked; " +
    "`Room.assignRank` refuses it by the same rule with nothing sent, and `Actions.perform` with the same words; with no bot, and " +
    "for the bot itself, it is as before; a default level at the bot's rung holds it, a power list that cannot be read does not; " +
    "the open card follows a demotion made elsewhere; ui/ names none of it (" + asserts + " assertions)");
  process.exit(0);
})().catch((e) => { _finished = true; console.log("[one-bot] FAIL — the guard threw: " + ((e && e.stack) || e)); process.exit(1); });
