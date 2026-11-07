// tests/check-feed-moderation.js
// SUBJECT: features/room.js, ui/chat.js, ui/panels.js, ui/base.js, index.html
// WALL: J131 PART C — ROOM EVENTS STAY GREY WHEN THEY ARE A PERSON'S OWN ACT, AND ARE TEAL WHEN THEY ARE MODERATION, in chat
// and in the Gear → Feed tab (the owner, `ddjp_654`; the shade, the owner's answer at the pause; teal, not the Staff blue it
// was, the owner's at `ddjp_658`: "something more unique" — he thought of purple, which is High Staff's, and chose teal).
//
//   PART A — marked in ONE place: every `Room.FEED_KINDS` row states `moderation`, and the rows marked are exactly the owner's
//            six — skipped a song (every `ddjp.dj.skip`), struck a song, removed a DJ, reset the rotation, moved a DJ, changed
//            the room settings. Grey, as now: joined or left the DJ queue, started a song, upvoted, saved, skipped an
//            unplayable song, the length report, the bot coming online. `group` is not this decision and is left as it was.
//   PART B — the REAL fold carries it on every row it narrates: an act, an act the room refused, and a bot room's "no".
//   PART C — chat: each kind, through the real fold and chat's real `_feedRow` (ui/chat.js whole, `tests/_chat-world.js`),
//            carries the moderation class or not — and the page's own stylesheet colours it teal or leaves it grey.
//   PART D — the Gear → Feed tab: the same, through `ui/panels.js` whole (`tests/_screen-world.js`), refused acts included.
//   PART E — the colour is the stylesheet's, on a class: never an inline colour; it is the owner's shade — the event line's
//            grey moved most of the way to teal (#14B8A6), not all of it; and it is a colour no name takes — its hue clear of
//            every rank colour the app paints a name in, read from the real ladder through `rankColor` (greys excepted).

"use strict";
const S = require("./_screen-world.js");
const W = require("./_chat-world.js");
const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[feed-moderation] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
let _finished = false;
process.on("exit", () => { if (!_finished) { console.log("[feed-moderation] FAIL — the guard did not finish: a promise never settled"); process.exitCode = 1; } });
const tick = () => new Promise((r) => setImmediate(r));

// THE OWNER'S LIST (`ddjp_654`), the decision this guard holds the table to.
const OWNER_MOD = ["ddjp.dj.skip", "ddjp.dj.strike", "ddjp.dj.remove", "ddjp.dj.reset", "ddjp.dj.move", "ddjp.room.settings"];
const OWNER_GREY = ["ddjp.dj.join", "ddjp.dj.leave", "ddjp.dj.play", "ddjp.dj.vote", "ddjp.dj.save", "ddjp.media.skip", "ddjp.media.len", "ddjp.bot.here"];
const MOD = "chat-feed-mod";
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const cas = S.makeCascade(S.readSheet(html));
const colour = (n) => { const d = n ? cas.declared(n, "color") : null; return d ? d.val.toLowerCase() : null; };
const rgb = (h) => { const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ""); return m ? m.slice(1).map((x) => parseInt(x, 16)) : null; };
// THE REAL LADDER, as `Room.rankLadder()` gives it the app (`Capabilities.LADDER`): PART E reads every face it paints a name in.
const LADDER = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/capabilities.js"], { Date })
  .Capabilities.LADDER.map((r) => ({ name: r.name, level: r.level, label: r.label }));

(async () => {
  const w = W.world();
  const Room = w.sb.Room;
  const K = Room.FEED_KINDS || {};
  const types = Object.keys(K);

  // ═══ PART A — the table ═══════════════════════════════════════════════════════════════════════════════════════════
  ok(types.length === OWNER_MOD.length + OWNER_GREY.length && OWNER_MOD.concat(OWNER_GREY).every((t) => K[t]),
    "A PREMISE — `Room.FEED_KINDS` names exactly the fourteen kinds the owner sorted", types);
  ok(types.every((t) => typeof K[t].moderation === "boolean"),
    "A: EVERY KIND STATES WHETHER IT IS MODERATION — `moderation: true|false` on every row, so a new kind is decided the day it is added",
    types.filter((t) => typeof K[t].moderation !== "boolean"));
  ok(JSON.stringify(types.filter((t) => K[t].moderation === true).sort()) === JSON.stringify(OWNER_MOD.slice().sort()),
    "A: THE KINDS MARKED ARE THE OWNER'S SIX — every skip, a strike, a removal, a reset, a move, a settings change", types.filter((t) => K[t].moderation === true));
  ok(OWNER_GREY.every((t) => K[t].moderation === false), "A: AND EVERY OTHER KIND IS A PERSON'S OWN ACT — grey, as now", OWNER_GREY.filter((t) => K[t].moderation !== false));
  const GROUPS = { "ddjp.dj.join": "rotation", "ddjp.dj.leave": "rotation", "ddjp.dj.play": "playback", "ddjp.dj.skip": "playback",
    "ddjp.media.skip": "playback", "ddjp.dj.vote": "reaction", "ddjp.dj.save": "reaction", "ddjp.room.settings": "settings",
    "ddjp.dj.strike": "moderation", "ddjp.dj.remove": "moderation", "ddjp.dj.reset": "moderation", "ddjp.dj.move": "moderation",
    "ddjp.media.len": "playback", "ddjp.bot.here": "settings" };
  ok(types.every((t) => K[t].group === GROUPS[t]), "A: `group` IS LEFT AS IT WAS — a separate flag, not a regrouping (a skip stays `playback`)",
    types.filter((t) => K[t].group !== GROUPS[t]).map((t) => [t, K[t].group]));

  // ═══ PART B — the fold ════════════════════════════════════════════════════════════════════════════════════════════
  const T0 = 5e12;
  const log = types.map((t, i) => ({ eventId: "$k" + i, type: t, ts: T0 + i * 1000, l: 10 + i, sender: "@p" + i + ":hs", content: {} }));
  const refusedLog = types.map((t, i) => ({ eventId: "$r" + i, type: t, ts: T0 + 100000 + i * 1000, l: 100 + i, sender: "@q" + i + ":hs", content: {} }));
  const botNo = types.map((t, i) => ({ eventId: "$b" + i, type: "ddjp.bot.refused", ts: T0 + 200000 + i * 1000, l: 200 + i, sender: "@r" + i + ":hs", content: { of: t, reason: "no" } }));
  const refusedIds = new Set(refusedLog.map((e) => e.eventId));
  const all = log.concat(refusedLog, botNo);
  const f = Room.foldFeed(all, (id) => !refusedIds.has(id), { limit: 500, refused: true });
  const byId = {}; for (const r of (f && f.rows) || []) byId[r.eventId] = r;
  ok(log.every((e) => byId[e.eventId]) && refusedLog.every((e) => byId[e.eventId] && byId[e.eventId].refused) && botNo.every((e) => byId[e.eventId] && byId[e.eventId].refused),
    "B PREMISE — the real fold narrated every kind three ways: done, refused by the room, and refused by a bot room", f && f.rows && f.rows.length);
  // A boolean on each side, compared: a row with no flag against a kind with none would agree by both being absent.
  const wrong = (evs, typeOf) => evs.filter((e) => { const r = byId[e.eventId], k = K[typeOf(e)];
    return !r || typeof r.moderation !== "boolean" || !k || r.moderation !== k.moderation; }).map((e) => [e.eventId, typeOf(e), byId[e.eventId] && byId[e.eventId].moderation]);
  ok(wrong(log, (e) => e.type).length === 0, "B: EVERY ROW THE FOLD NARRATES CARRIES ITS KIND'S `moderation`", wrong(log, (e) => e.type));
  ok(wrong(refusedLog, (e) => e.type).length === 0, "B: AN ACT THE ROOM REFUSED CARRIES IT TOO", wrong(refusedLog, (e) => e.type));
  ok(wrong(botNo, (e) => e.content.of).length === 0, "B: AND A BOT ROOM'S \"NO\" CARRIES THE NAMED ACT'S", wrong(botNo, (e) => e.content.of));

  // ═══ PART C — chat ═══════════════════════════════════════════════════════════════════════════════════════════════
  await w.CP.startChat(w.box); await tick();
  for (const t of types) w.sb.ChatPrefs.setFeedShown(t, true, K[t].shownByDefault);   // every kind shown, so every kind is drawn
  for (const e of log) w.log.push(e);
  w.CP._repaintChat(w.box); await tick();
  const typeOf = {}; for (const e of log) typeOf[e.eventId] = e.type;
  const feedNodes = w.box.children.filter((n) => n.dataset && n.dataset.fid && typeOf[n.dataset.fid]);
  ok(feedNodes.length === types.length, "C PREMISE — chat drew a row for every kind", feedNodes.map((n) => n.dataset.fid));
  const has = (n) => String(n.className).split(/\s+/).indexOf(MOD) >= 0;
  const chatWrong = feedNodes.filter((n) => has(n) !== K[typeOf[n.dataset.fid]].moderation).map((n) => [typeOf[n.dataset.fid], n.className]);
  ok(feedNodes.length && chatWrong.length === 0, "C: IN CHAT, EACH KIND'S ROW CARRIES THE MODERATION CLASS EXACTLY WHEN IT IS MODERATION", chatWrong);
  const parts = (n) => ({ who: n.children.find((c) => /\bsender\b/.test(c.className)), verb: n.children.find((c) => /\bchat-feed-verb\b/.test(c.className)) });
  const greyN = feedNodes.find((n) => OWNER_GREY.indexOf(typeOf[n.dataset.fid]) >= 0), modN = feedNodes.find((n) => OWNER_MOD.indexOf(typeOf[n.dataset.fid]) >= 0);
  const grey = greyN ? { who: colour(parts(greyN).who), verb: colour(parts(greyN).verb) } : null;
  const modc = modN ? { who: colour(parts(modN).who), verb: colour(parts(modN).verb) } : null;
  ok(grey && grey.who && grey.verb && modc && modc.who && modc.verb && modc.who !== grey.who && modc.verb !== grey.verb,
    "C: THE STYLESHEET COLOURS A MODERATION ROW'S NAME AND WORDS APART FROM A PERSON'S OWN ACT", { grey, modc });
  // Expected from the OWNER'S list, not from the table's flag: a table that marked nothing would otherwise read as all grey and agree.
  const isModKind = (t) => OWNER_MOD.indexOf(t) >= 0;
  // And a moderation colour that is the grey is none: the six are held to a colour the others do not take.
  const modApart = !!(modc && grey && modc.who !== grey.who && modc.verb !== grey.verb);
  const colourWrong = feedNodes.filter((n) => { const p = parts(n), want = isModKind(typeOf[n.dataset.fid]) ? (modApart ? modc : null) : grey;
    return !want || colour(p.who) !== want.who || colour(p.verb) !== want.verb; }).map((n) => typeOf[n.dataset.fid]);
  ok(colourWrong.length === 0, "C: AND EVERY ROW TAKES ITS KIND'S COLOURS — the six teal, the rest grey, as now", colourWrong);

  // ═══ PART D — the Gear → Feed tab ═════════════════════════════════════════════════════════════════════════════════
  const NOW = T0 + 400000;
  const sw = S.world({ features: {
    Room: { rankLadder: () => LADDER, getMyId: () => "@me:hs", getRoster: () => [],
      FEED_KINDS: K, recentEvents: (o) => Room.foldFeed(all, (id) => !refusedIds.has(id), Object.assign({}, o, { roomExists: true })) },
    ServerClock: { serverNow: () => NOW },
    Queue: { getNowPlaying: () => null, getRotation: () => [], getState: () => ({ counts: {} }), recentHistory: () => [], historyReach: () => null },
    ChatPrefs: { layout: () => "wide", videoHidden: () => false, overlayBlocked: () => false },
    Actions: { describe: () => ({ enabled: false, reason: "Not permitted" }), perform: () => Promise.resolve({ ok: true }) },
    UserQueue: { items: () => [], count: () => 0, slotState: () => null, isActive: () => false, stackCount: () => 0 },
  } });
  sw.H.buildMainDom(sw.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
  sw.sb.ChatPanels.feedSince = () => T0 - 1;          // chat's line, which this tab reads (chat itself is PART C's)
  sw.sb.Settings.renderSettings = () => {}; sw.sb.Settings.renderChatSettings = () => {};   // not this guard's panel
  sw.refs.tabGear.click(); sw.refs.subtabFeed.click();            // the person's way there: ⚙, then Feed
  const tabOn = (() => { try { return sw.H.rightTab() === "gear" && sw.H.gearTab() === "feed"; } catch (e) { return false; } })();
  const lines = sw.refs.feedBox ? sw.refs.feedBox.querySelectorAll(".feed-line") : [];
  const rowOf = (line) => line.querySelector(".chat-feed");
  ok(tabOn && lines.length === all.length, "D PREMISE — the Feed tab is the one shown, and it drew every row the fold narrated (refused included)",
    { tabOn, lines: lines.length, want: all.length });
  const kindOfLine = {}; for (const e of log.concat(refusedLog)) kindOfLine[e.eventId] = e.type; for (const e of botNo) kindOfLine[e.eventId] = e.content.of;
  const tabWrong = lines.filter((l) => { const r = rowOf(l); const t = r && kindOfLine[r.getAttribute("data-fid") || (r.dataset && r.dataset.fid)];
    return !r || !t || has(r) !== K[t].moderation; }).map((l) => { const r = rowOf(l); return r && [r.getAttribute("data-fid") || (r.dataset && r.dataset.fid), r.className]; });
  ok(lines.length && tabWrong.length === 0, "D: IN THE FEED TAB, EACH ROW CARRIES THE MODERATION CLASS EXACTLY WHEN ITS KIND IS MODERATION — refused acts and a bot room's \"no\" too", tabWrong);
  const tabColWrong = lines.filter((l) => { const r = rowOf(l); const t = r && kindOfLine[r.getAttribute("data-fid") || (r.dataset && r.dataset.fid)];
    const want = t && isModKind(t) ? (modApart ? modc : null) : grey; const who = r && r.querySelector(".sender"), verb = r && r.querySelector(".chat-feed-verb");
    return !want || sw.cas.declared(verb, "color").val.toLowerCase() !== want.verb || sw.cas.declared(who, "color").val.toLowerCase() !== want.who; })
    .map((l) => rowOf(l) && rowOf(l).textContent);
  ok(lines.length && tabColWrong.length === 0, "D: AND THE SAME COLOURS AS CHAT'S — the six teal, the rest grey", tabColWrong.slice(0, 4));
  const refusedLine = lines.find((l) => /\brefused\b/.test(l.className));
  ok(refusedLine && /\brefused\b/.test(refusedLine.className) && refusedLine.querySelector(".feed-reason"),
    "D: A REFUSED ACT STILL READS AS REFUSED — its line and its reason as before", refusedLine && refusedLine.className);

  // ═══ PART E — on a class, never inline; the owner's shade; and a colour no name takes ═══════════════════════════════
  const inline = feedNodes.concat(lines.map(rowOf)).filter(Boolean).map((n) => [n].concat(n.children || [])).reduce((a, b) => a.concat(b), [])
    .filter((n) => n && n.style && n.style.color);
  ok(feedNodes.length && inline.length === 0, "E: THE MODERATION COLOUR IS NEVER AN INLINE COLOUR — no row, name or verb carries one", inline.map((n) => n.className));
  // THE OWNER'S SHADE OF TEAL (`ddjp_658`): the event grey moved most of the way to #14B8A6, the words and the name alike —
  // read on each channel the move is large on (one the grey already nearly shares says nothing about how far it went).
  const TEAL = rgb("#14b8a6");
  const toward = (g, b) => { const G = rgb(g), B = rgb(b); if (!G || !B) return null;
    const t = [0, 1, 2].filter((k) => Math.abs(TEAL[k] - G[k]) >= 20).map((k) => (B[k] - G[k]) / (TEAL[k] - G[k]));
    const between = [0, 1, 2].every((k) => Math.min(G[k], TEAL[k]) - 1 <= B[k] && B[k] <= Math.max(G[k], TEAL[k]) + 1);
    return { t, between }; };
  const tv = grey && modc ? toward(grey.verb, modc.verb) : null, tw = grey && modc ? toward(grey.who, modc.who) : null;
  ok(tv && tw && tv.between && tw.between && [tv.t, tw.t].every((t) => t.length >= 2 && t.every((x) => x > 0.5 && x < 0.9) &&
      Math.max.apply(null, t) - Math.min.apply(null, t) < 0.05),
    "E: THE OWNER'S SHADE — the event grey moved toward teal (#14B8A6), brighter than half way but tamer than the teal itself, the words and the name alike",
    { verb: tv, name: tw, grey, modc });
  // A COLOUR NO NAME TAKES (the owner's reason at `ddjp_658`: "something more unique"). Every face the app paints a name in —
  // each rung of the real ladder, and the owner above it — read through `rankColor`, as People, chat and the queue read it. A
  // grey (next to no colour) has no hue to be taken for, and is excepted. The blue it replaced was Staff's own hue.
  const top = Math.max.apply(null, LADDER.map((r) => r.level));
  const faces = LADDER.map((r) => r.level).concat([top + 1]).map((l) => ({ level: l, name: sw.H.rankName(l), color: sw.H.rankColor(l) }));
  ok(faces.length === LADDER.length + 1 && faces.every((f) => rgb(f.color)) && faces.some((f) => /^high staff$/i.test(f.name)) &&
      faces.some((f) => /^owner$/i.test(f.name)) && faces.some((f) => /^bot$/i.test(f.name)),
    "E PREMISE — every face the app paints a name in: each rung of the real ladder, the bot's at its top, and the owner above it", faces);
  const hsl = (hex) => { const c = rgb(hex); if (!c) return null; const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn, l = (mx + mn) / 2;
    const h = !d ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: (h * 60 + 360) % 360, s: d ? d / (1 - Math.abs(2 * l - 1)) : 0 }; };
  const apart = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
  const HUE_APART = 25;
  const close = modc && hsl(modc.verb) && hsl(modc.who) ? faces.filter((f) => hsl(f.color).s >= 0.15)
    .map((f) => ({ name: f.name, color: f.color, wordsApart: Math.round(apart(hsl(f.color).h, hsl(modc.verb).h)), nameApart: Math.round(apart(hsl(f.color).h, hsl(modc.who).h)) }))
    .filter((f) => f.wordsApart < HUE_APART || f.nameApart < HUE_APART) : null;
  ok(close && close.length === 0,
    "E: A COLOUR NO NAME TAKES — the moderation colour's hue at least " + HUE_APART + "° from every rank colour that has one, so a moderation line never reads as someone's name",
    close);

  _finished = true;
  if (failed) { console.log("[feed-moderation] " + failed + " of " + asserts + " assertions FAILED"); process.exit(1); }
  console.log("[feed-moderation] PASS — room events of moderation are teal and a person's own acts grey (J131 C, the owner's at " +
    "`ddjp_654`; " + asserts + " assertions): marked once, a `moderation` flag on every `Room.FEED_KINDS` row — the owner's six, every skip " +
    "included, and `group` untouched; the real fold carries it on every row, refused and bot-refused too; chat's own row carries the " +
    "class exactly then, in chat and in the Gear → Feed tab, and the page's stylesheet colours it — never inline — in the owner's shade, " +
    "the event grey moved most of the way to teal (blue, Staff's, until `ddjp_658`), a hue no rank paints a name in.");
})().catch((e) => { _finished = true; console.log("[feed-moderation] FAIL — threw: " + String(e && e.stack || e).split("\n").slice(0, 4).join(" | ")); process.exit(1); });
