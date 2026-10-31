// tests/check-rank-faces.js
// SUBJECT: ui/base.js, ui/roster.js, ui/chat.js, ui/queue.js, ui/panels.js, ui/player.js, index.html
//
// WALL: COLOURS TELL RANKS APART, AND THE PEOPLE ROW SHOWS REP WHERE THE RANK LABEL WAS (J88; the owner's rulings 36, 37).
//
// FOUND LIVE (`?v=536`): the human owner's name was GREY and the bot's ORANGE. `rankColor` looked a level up in `RANKS`,
// where the ladder SATURATES — its top rung, 99, is filed as `owner` though it is the bot's slot, and the human owner's 100
// is above the ladder and not in the list at all, so it fell back to grey. `rankName` already split the two by level;
// the colour did not.
//
//   A  THE FACES, DRIVEN: the real `ui/base.js`, loaded over the real ladder (`ranks.js`, `capabilities.js` and
//      `features/room.js`'s own `rankLadder`). Every ladder level plus the owner's 100: the owner ORANGE (#E8890C), the
//      bot PINK (#EC4899), every other rank its own colour as before (ruling 37); grey only for uncategorized and for
//      levels nobody defined. Every rank a different colour. The name and the colour make the SAME split, at every level.
//   B  ONE PLACE: the split is written once (`_rankFace`), and `rankName` and `rankColor` only read it.
//   C  EVERY COLOURED NAME GOES THROUGH IT: the People tab, the user card, chat names, the queue, now playing, history,
//      the player and avatar initials each colour through the host's `rankColor` (read), and no ui/ file keeps a rank
//      colour of its own (read). The People row and the avatar initials are also driven, in D.
//   D  THE PEOPLE ROW (ruling 36), the real `renderRoster` over the real host: no rank label; `<n> REP`, light grey, on
//      the right, where the rank tag was; nothing there when this device holds no number; the rank in the name's colour,
//      and in the avatar initials'; the order the feature layer's.
//   E  THE LOOK (index.html): REP pushed right; an inactive row greyed as a whole, the name included, as before J88 (rulings
//      34 and 38 — 38 replaces J88's undimmed name).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const { loadInContext } = require("./_load");
const XI = require("./_probe-j14-card.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[rank-faces] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");

// The owner's colours (ruling 37) and the colours every other rank keeps — written here ONCE as the ruling's own words:
// "every other rank keeps its colour" is a promise about these values, so a guard that derived them from the file under
// test could not hold it.
const OWNER = "#E8890C", BOT = "#EC4899", GREY = "#9CA3AF";
const KEEPS = { 80: "#7C3AED", 60: "#3B82F6", 40: "#60A5FA", 20: "#4ADE80", 10: "#A7C4A0", 0: GREY };

// ── THE REAL ui/base.js OVER THE REAL LADDER ─────────────────────────────────────────────────────────────────────────────
// A document just real enough for `el`, `avatarEl` and `_initialsEl`: nodes with a class, text, inline style and children.
function mkDoc() {
  const node = (tag) => ({
    tag, className: "", textContent: "", children: [], dataset: {}, attrs: {},
    style: { cssText: "", set color(v) { this._color = v; }, get color() {
      if (this._color !== undefined) return this._color;
      const m = /(?:^|;)\s*color:\s*([^;]+)/.exec(this.cssText); return m ? m[1].trim() : ""; } },
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
    replaceChildren() { this.children = []; }, replaceWith() {},
  });
  return { createElement: node, createTextNode: (t) => Object.assign(node("#text"), { textContent: t }) };
}
function loadBase(roster) {
  const ctx = loadInContext(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/capabilities.js"], {});
  const rl = XI.extractNamed("features/room.js", "rankLadder");
  ok(rl.ok, "PREMISE — `rankLadder` is declared once in features/room.js and extractable (the UI's one route to the ladder)", rl.stage);
  ctx.document = mkDoc();
  ctx.Media = { getAvatarUrl: () => null };   // no picture: the initials, which are coloured by rank
  vm.runInContext("const Room = { getRoster: () => __roster };\n" + rl.source + "\nRoom.rankLadder = rankLadder;\n" +
    read("ui/base.js") + "\n;globalThis.UIBase = UIBase; globalThis.Room = Room;", Object.assign(ctx, { __roster: roster || [] }));
  return ctx;
}

let base = null;
try { base = loadBase([]); } catch (e) { ok(false, "PREMISE — the real ui/base.js loads over the real ladder", String(e && e.message)); }
const H = base && base.UIBase && base.UIBase.host;
ok(H && typeof H.rankColor === "function" && typeof H.rankName === "function", "PREMISE — the host publishes `rankColor` and `rankName`");

// ── A — THE FACES ────────────────────────────────────────────────────────────────────────────────────────────────────────
if (H) {
  const ladder = base.Capabilities.LADDER.map((r) => r.level);
  const top = Math.max.apply(null, ladder);
  ok(top === 99 && ladder.indexOf(0) >= 0, "A: PREMISE — the ladder tops out at the bot's rung, 99, and starts at 0", ladder);
  const levels = ladder.concat([top + 1]);   // every rung, plus the human owner above it
  const face = {};
  for (const l of levels) face[l] = { name: H.rankName(l), color: String(H.rankColor(l)).toUpperCase() };

  ok(face[top + 1].name === "Owner" && face[top + 1].color === OWNER,
    "A: THE HUMAN OWNER (100, above the ladder) IS ORANGE — live it fell back to grey, being in no list", face[top + 1]);
  ok(face[top].name === "Bot" && face[top].color === BOT,
    "A: THE BOT (99, the top rung) IS PINK — live it was painted the owner's orange, because the ladder files 99 as `owner`", face[top]);
  for (const l of Object.keys(KEEPS).map(Number)) {
    ok(face[l] && face[l].color === KEEPS[l], "A: EVERY OTHER RANK KEEPS ITS COLOUR — level " + l + " (" + (face[l] && face[l].name) + ")", face[l]);
  }
  const notGrey = levels.filter((l) => l !== 0);
  ok(notGrey.every((l) => face[l].color !== GREY),
    "A: NO RANK FALLS BACK TO GREY but uncategorized — every rung and the owner have a colour of their own",
    notGrey.map((l) => l + "=" + face[l].color));
  const colours = levels.map((l) => face[l].color);
  ok(new Set(colours).size === levels.length, "A: COLOURS TELL RANKS APART — every rank, the owner and the bot a different colour", colours);
  const unknown = [5, 50, 98, -1, 0.5, NaN, undefined, null, "60"];
  ok(unknown.every((l) => String(H.rankColor(l)).toUpperCase() === GREY),
    "A: A LEVEL NOBODY DEFINED IS GREY — between the rungs, below them, not a number", unknown.map((l) => String(l) + "=" + H.rankColor(l)));
  ok(H.rankName(50) === "L50", "A: and its name is not invented (`L<n>`)", H.rankName(50));

  // THE SAME SPLIT, AT EVERY LEVEL: wherever the name says Owner the colour is the owner's, wherever it says Bot the bot's —
  // and the other way round. The defect was exactly a name and a colour that split the same two accounts differently.
  const probe = levels.concat([top + 2, 150, 1000, 98, 50, 1, -1]);
  const disagree = probe.filter((l) => {
    const n = H.rankName(l), c = String(H.rankColor(l)).toUpperCase();
    return (n === "Owner") !== (c === OWNER) || (n === "Bot") !== (c === BOT);
  });
  ok(disagree.length === 0, "A: THE NAME AND THE COLOUR MAKE THE SAME SPLIT — Owner is orange and only Owner, Bot is pink and only Bot", disagree);

  // The rank-select table the user card reads agrees: its top rung, the bot's, is pink too.
  const rows = H.RANKS();
  const topRow = rows.find((r) => r.level === top);
  ok(topRow && String(topRow.color).toUpperCase() === BOT, "A: the RANKS table's top rung is the bot's pink — no second answer for 99", topRow);
}

// ── B — ONE PLACE ────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const src = strip(read("ui/base.js"));
  const fx = XI.extractNamed("ui/base.js", "_rankFace");
  ok(fx.ok, "B: THE SPLIT IS WRITTEN ONCE — `_rankFace` in ui/base.js", fx.stage);
  const body = (n) => { const x = XI.extractNamed("ui/base.js", n); return x.ok ? strip(x.source) : ""; };
  const rn = body("rankName"), rc = body("rankColor");
  ok(/_rankFace\(/.test(rn) && /_rankFace\(/.test(rc), "B: `rankName` and `rankColor` both read it", { rankName: rn, rankColor: rc });
  ok(!/_BOT_LEVEL|RANKS|[<>]=?|===/.test(rn.replace(/^[^{]*\{/, "")) && !/_BOT_LEVEL|RANKS|[<>]=?|===/.test(rc.replace(/^[^{]*\{/, "")),
    "B: and neither splits levels of its own — no comparison, no ladder lookup outside `_rankFace`", { rankName: rn, rankColor: rc });
  ok((src.match(/function rankColor\(/g) || []).length === 1 && (src.match(/function rankName\(/g) || []).length === 1,
    "B: each is declared once");
}

// ── C — EVERY COLOURED NAME GOES THROUGH IT ──────────────────────────────────────────────────────────────────────────────
{
  const SURFACES = [
    ["ui/roster.js", "renderRoster", "the People tab"],
    ["ui/roster.js", "openUserCard", "the user card"],
    ["ui/chat.js", "_chatRow", "chat names"],
    ["ui/queue.js", "renderRoomQueue", "the queue and now playing"],
    ["ui/panels.js", "renderHistory", "history"],
    ["ui/player.js", "_setNpLabel", "the player"],
    ["ui/base.js", "_initialsEl", "avatar initials"],
  ];
  for (const [file, fn, what] of SURFACES) {
    const x = XI.extractNamed(file, fn);
    const s = x.ok ? strip(x.source) : "";
    ok(x.ok && /\brankColor\(/.test(s), "C: " + what.toUpperCase() + " COLOURS A NAME BY RANK THROUGH `rankColor` (" + file + " `" + fn + "`)", x.stage);
  }
  const q = strip(XI.extractNamed("ui/queue.js", "renderRoomQueue").source || "");
  ok((q.match(/\brankColor\(/g) || []).length >= 2, "C: the queue's rows AND now playing, both", (q.match(/\brankColor\(/g) || []).length);
  // No ui/ file keeps a rank colour of its own, nor defines a second `rankColor`, nor reads a colour off the RANKS table.
  const faces = [OWNER, BOT].concat(Object.values(KEEPS)).map((h) => h.toLowerCase());
  const ui = fs.readdirSync(path.join(ROOT, "ui")).filter((f) => f.endsWith(".js"));
  const stray = [];
  for (const f of ui) {
    const s = strip(read("ui/" + f));
    if (f !== "base.js") {
      for (const h of faces) if (s.toLowerCase().indexOf(h) >= 0) stray.push(f + " holds " + h);
      if (/function rankColor\(|rankColor\s*=/.test(s)) stray.push(f + " defines a rankColor");
      if (/RANKS\(\)[^;\n]*\.color/.test(s)) stray.push(f + " reads a colour off RANKS");
    }
  }
  ok(stray.length === 0, "C: NO ui/ FILE KEEPS A RANK COLOUR OF ITS OWN — one table, in ui/base.js", stray);
}

// ── D — THE PEOPLE ROW ───────────────────────────────────────────────────────────────────────────────────────────────────
const M = (u, name, level) => ({ userId: "@" + u + ":hs", name: name, level: level });
const ROSTER = [M("owner", "owner", 100), M("bot", "bot", 99), M("sam", "sam", 60), M("zed", "zed", 50), M("cat", "cat", 0), M("dan", "Dan", 0)];
const VIEW = { people: ["@bot:hs", "@sam:hs", "@cat:hs"].map((u) => ({ userId: u, lastTs: 1 })) };
const REPS = { "@owner:hs": 4, "@sam:hs": 9, "@cat:hs": 0, "@dan:hs": 7 };   // the bot and zed: no number held here
function driveRow() {
  const ctx = loadBase(ROSTER);
  const ORD = XI.extractNamed("features/room.js", "peopleOrder");
  const pieces = ["_repBadge", "renderRoster"].map((n) => XI.extractNamed("ui/roster.js", n));
  ok(ORD.ok && pieces.every((p) => p.ok), "D: PREMISE — the order and the row builder are extractable", [ORD.stage].concat(pieces.map((p) => p.stage)));
  const box = ctx.document.createElement("div");
  Object.assign(ctx, {
    refs: { rosterBox: box }, H: ctx.UIBase.host,
    ServerClock: { serverNow: () => 20000000 }, Panels: { agoFromServer: () => "now" },
    Rep: { badge: (u) => (u in REPS ? { rep: REPS[u], text: REPS[u] + " REP" } : null) },
    _wireCardTrigger: () => {},
  });
  vm.runInContext("Room.presenceView = () => (" + JSON.stringify(VIEW) + ");\n" + ORD.source + "\nRoom.peopleOrder = peopleOrder;\n" +
    pieces.map((p) => p.source).join("\n") + "\n;renderRoster();", ctx);
  return box.children.filter((n) => /\bperson\b/.test(n.className));
}
let rows = [];
try { rows = driveRow(); } catch (e) { ok(false, "D: the real row builder runs over the real host", String(e && e.message)); }
if (rows.length) {
  const H2 = H;
  const flat = (n) => [n].concat(...(n.children || []).map(flat));
  const cls = (n) => n.className || "";
  const whoOf = (r) => flat(r).find((x) => /\bwho\b/.test(cls(x)));
  const byName = (nm) => rows.find((r) => (whoOf(r) || {}).textContent === nm);
  ok(rows.length === ROSTER.length && rows.map((r) => whoOf(r).textContent).join(",") === "bot,sam,cat,owner,zed,Dan",
    "D: THE ORDER IS UNCHANGED (ruling 31) — the feature layer's, active first, then rank, REP, name", rows.map((r) => whoOf(r) && whoOf(r).textContent));
  const rankWords = ROSTER.map((m) => H2.rankName(m.level)).concat(["Owner", "Bot", "High Staff", "Staff", "VIP", "Player", "Guest", "Uncategorized"]);
  const labelled = rows.filter((r) => flat(r).some((x) => /\brank-tag\b/.test(cls(x)) || (x !== whoOf(r) && rankWords.indexOf(x.textContent) >= 0)));
  ok(labelled.length === 0, "D: NO RANK LABEL ON ANY ROW (ruling 36) — no rank tag, no rank's name beside the person's",
    labelled.map((r) => flat(r).map((x) => x.textContent).filter(Boolean)));
  const last = (r) => r.children[r.children.length - 1];
  const withNo = ["owner", "sam", "cat", "Dan"].map(byName);
  ok(withNo.every((r) => /\bperson-rep\b/.test(cls(last(r))) && r.children.indexOf(whoOf(r)) < r.children.length - 1),
    "D: `<n> REP` IS ON THE RIGHT, IN THE RANK TAG'S SPOT — the row's last element, after the name", withNo.map((r) => r.children.map(cls)));
  ok(byName("sam") && last(byName("sam")).textContent === "9 REP" && last(byName("cat")).textContent === "0 REP" && last(byName("Dan")).textContent === "7 REP",
    "D: the same `<n> REP` text — a held 0 shows as a number like any other", withNo.map((r) => last(r).textContent));
  const none = ["bot", "zed"].map(byName);
  ok(none.every((r) => !flat(r).some((x) => /\bperson-rep\b/.test(cls(x)) || /REP/.test(x.textContent || ""))),
    "D: NOTHING THERE WHEN THIS DEVICE HOLDS NO NUMBER — no REP, no placeholder", none.map((r) => flat(r).map((x) => x.textContent).filter(Boolean)));
  ok(none.every((r) => !/\bperson-rep\b|\brank-tag\b/.test(cls(last(r)))), "D: and no rank label takes the empty spot", none.map((r) => cls(last(r))));
  const colourOf = (nm) => String((whoOf(byName(nm)) || { style: {} }).style.color || "").toUpperCase();
  ok(colourOf("owner") === OWNER && colourOf("bot") === BOT && colourOf("sam") === KEEPS[60] && colourOf("zed") === GREY && colourOf("cat") === GREY,
    "D: THE RANK SHOWS THROUGH THE NAME'S COLOUR — the owner orange, the bot pink, staff blue, an undefined level and uncategorized grey",
    ["owner", "bot", "sam", "zed", "cat"].map((n) => n + "=" + colourOf(n)));
  const initials = (nm) => { const r = byName(nm); const av = flat(r).find((x) => /\bperson-av\b/.test(cls(x))); const i = av && av.children[0]; return String(i ? i.style.color : "").toUpperCase(); };
  ok(initials("owner") === OWNER && initials("bot") === BOT && initials("sam") === KEEPS[60],
    "D: AVATAR INITIALS TOO — the same colours, from the roster's level", ["owner", "bot", "sam"].map((n) => n + "=" + initials(n)));
  const inactive = rows.filter((r) => /\binactive\b/.test(cls(r))).map((r) => whoOf(r).textContent);
  ok(inactive.join(",") === "owner,zed,Dan", "D: the inactive rows still carry their class (ruling 34)", inactive);
}

// ── E — THE LOOK ─────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const css = strip(read("index.html").replace(/<script[\s\S]*?<\/script>/g, ""));
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, " "), body: m[2] }));
  const prop = (body, p) => { const m = new RegExp("(?:^|;)\\s*" + p + "\\s*:\\s*([^;]+)").exec(body); return m ? m[1].trim() : null; };
  const repRight = rules.some((r) => r.sel.split(",").some((s) => /\.person-rep$/.test(s.trim())) && prop(r.body, "margin-left") === "auto");
  ok(repRight, "E: REP IS PUSHED TO THE RIGHT — a `.person-rep` rule with `margin-left: auto`, the rank tag's old place");
  const repRule = rules.find((r) => r.sel === ".person-rep") || { body: "" };
  const hex = (prop(repRule.body, "color") || "").replace("#", "");
  const ch = /^[0-9a-fA-F]{6}$/.test(hex) ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
  ok(ch && ch.every((v) => v >= 0x80 && v <= 0xd0) && Math.max(...ch) - Math.min(...ch) <= 0x18, "E: still light grey", hex);

  // RE-AIMED AT J89 (the owner's ruling 38): an inactive row is greyed AS BEFORE J88 — the whole row at 0.55, the name and its
  // colour included; the owner prefers the greyer look. J88's rows here held the opposite ("never through the name", and each
  // rank colour at least as readable as on an active row), which 38 replaces. REP stays on the right (above).
  const inact = rules.filter((r) => r.sel.split(",").some((s) => /\.person\.inactive/.test(s)));
  const whole = inact.filter((r) => r.sel.split(",").some((s) => /\.person\.inactive$/.test(s.trim())));
  const op = whole.map((r) => prop(r.body, "opacity")).filter((v) => v !== null);
  ok(op.length === 1 && Number(op[0]) === 0.55, "E: AN INACTIVE ROW IS GREYED AS A WHOLE, AS BEFORE J88 — the row at 0.55 (rulings 34 and 38)", inact.map((r) => r.sel + " { " + r.body.trim() + " }"));
  ok(!inact.some((r) => /\.who\b/.test(r.sel)), "E: AND THE NAME WITH IT — no rule lifts the name out of the grey (ruling 38 replaces J88's undimmed name)",
    inact.map((r) => r.sel));
}

if (failed) { console.log("[rank-faces] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[rank-faces] PASS — colours tell ranks apart and the People row shows REP where the rank label was (J88, rulings 36 " +
  "and 37; " + asserts + " assertions). THE FACES, driven on the real ui/base.js over the real ladder: the human owner (100, " +
  "above the ladder) orange, the bot (99, the top rung) pink, every other rank its own colour as before, grey only for " +
  "uncategorized and undefined levels, every rank a different colour, and the name and the colour splitting the same way at " +
  "every level. ONE PLACE: `_rankFace`, which `rankName` and `rankColor` only read. EVERY COLOURED NAME — People, the user card, " +
  "chat, the queue, now playing, history, the player, avatar initials — through `rankColor`, and no ui/ file holding a rank " +
  "colour of its own. THE PEOPLE ROW, the real builder over the real host: no rank label; `<n> REP` on the right where the tag " +
  "was; nothing when no number is held; the rank in the name's and the initials' colour; the order unchanged. THE LOOK: REP " +
  "pushed right; an inactive row greyed as a whole, the name included, as before J88 (ruling 38)");
