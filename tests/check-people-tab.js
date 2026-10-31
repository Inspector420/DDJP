// tests/check-people-tab.js
// SUBJECT: features/room.js, ui/roster.js, ui/panels.js, ui/screens.js, index.html
//
// WALL: THE PEOPLE TAB HAS ONE ORDER, AND SHOWS REP ONLY WHERE THIS DEVICE HOLDS IT (J84-3; the owner's rulings 27, 30e,
// 30f, 31 and 34, and Q6). The order is decided in the feature layer (`Room.peopleOrder`) and the UI renders it; the
// row asks REP for its number at one site (H3, `Rep.badge`). Both run here as they stand — extracted from their files.
//
//   A  THE ORDER (31): the active (this viewer's own view) on top, the inactive members below; within each group the
//      higher rank first, then the higher REP with no number after any number, then the name a–z, case folded, the user
//      ID breaking a tie. A person the view names who is not a member is not listed. An inactive member's number orders
//      them in their own group (34). With no numbers — no bot in the room — the same order on rank and name (30f).
//   B  THE ROW: `<n> REP` in its own light-grey element on the right, after the name (ruling 36, J88; it was before the
//      name by ruling 27), only where this device holds it (H3), nothing
//      where it does not — never a 0, no tooltip, no coverage text (Q6); the inactive rows greyed, an inactive member's
//      number shown with the row (34); no bot in the room, no numbers and everything else as it was; a REP that throws
//      draws the list anyway.
//   C  THE LOOK: `.person-rep` light grey, and an inactive row greyed as a whole, its number with it (index.html; ruling 38).
//   D  ONE COPY: the UI keeps no order of its own, and the feature layer exports the one it renders.
//   E  IN REAL TIME (the owner's ruling 35): the feature layer's generic "the people view changed" reaches every listener
//      and names nothing of what changed; the People tab subscribes, and redraws within about a second, ONCE per burst —
//      not while hidden, and not while you are using the list (it waits for you).
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const ROOT = path.join(__dirname, "..");
const XI = require("./_probe-j14-card.js");

let asserts = 0, failed = 0;
function ok(c, msg, got) {
  asserts++;
  if (!c) { failed++; console.log("[people-tab] FAIL — " + msg + (got !== undefined ? "\n      got " + JSON.stringify(got) : "")); }
}
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// The real order, extracted from the feature layer and run as it stands.
const ORD = XI.extractNamed("features/room.js", "peopleOrder");
ok(ORD.ok, "PREMISE — `peopleOrder` is declared once in features/room.js and extractable", ORD.stage);
const oc = vm.createContext({});
if (ORD.ok) vm.runInContext(ORD.source + "\n;this.peopleOrder = peopleOrder;", oc);
const order = (view, roster, numberOf) => oc.peopleOrder(view, roster, numberOf);
const ids = (rows) => rows.map((r) => r.member.userId.split(":")[0].slice(1) + (r.active ? "*" : ""));

const M = (u, name, level) => ({ userId: "@" + u + ":hs", name: name, level: level });
const ROSTER = [
  M("owner", "owner", 100), M("bot", "bot", 99), M("zed", "zed", 50), M("amy", "Amy", 50), M("bob", "bob", 50),
  M("cat", "cat", 0), M("dan", "Dan", 0), M("eve", "eve", 0), M("fay", "fay", 0), M("gus", "gus", 0),
];
const VIEW = { people: ["@bob:hs", "@zed:hs", "@cat:hs", "@eve:hs", "@stranger:hs", "@bot:hs"].map((u) => ({ userId: u, lastTs: 1 })) };
const REPS = { "@bob:hs": 3, "@zed:hs": 9, "@cat:hs": 5, "@eve:hs": 5, "@amy:hs": 2, "@dan:hs": 7, "@owner:hs": 1 };

// ── A — THE ORDER ────────────────────────────────────────────────────────────────────────────────────────────────────────
if (ORD.ok) {
  const got = ids(order(VIEW, ROSTER, (u) => (u in REPS ? REPS[u] : null)));
  // Active: bot (99); zed 9, bob 3 (50); cat 5, eve 5 → a–z (0). Inactive: owner (100); amy 2 (50); dan 7, then fay, gus
  // with no number, a–z (0).
  ok(got.join(",") === "bot*,zed*,bob*,cat*,eve*,owner,amy,dan,fay,gus",
    "A: ACTIVE ON TOP, INACTIVE BELOW; within each, rank, then REP high first, then a–z — the stranger the view names is not a member, so not listed",
    got);
  const inact = ids(order({ people: [] }, ROSTER, (u) => (u === "@gus:hs" ? 1 : null)));
  ok(inact.join(",") === "owner,bot,amy,bob,zed,gus,cat,dan,eve,fay",
    "A: NO NUMBER AFTER ANY NUMBER — gus's 1 puts him above everyone of his rank with none; amy before bob before zed, case folded",
    inact);
  const plain = ids(order(VIEW, ROSTER));
  ok(plain.join(",") === "bot*,bob*,zed*,cat*,eve*,owner,amy,dan,fay,gus",
    "A: NO BOT IN THE ROOM — no numbers, and the same order on rank and name alone (30f)", plain);
  const zero = ids(order({ people: [] }, [M("a", "a", 0), M("b", "b", 0), M("c", "c", 0)], (u) => ({ "@a:hs": null, "@b:hs": 0, "@c:hs": 4 })[u]));
  ok(zero.join(",") === "c,b,a", "A: a 0 is a number and sorts as one — above no number, below a higher one", zero);
  const tie = ids(order({ people: [] }, [M("y", "Sam", 0), M("x", "sam", 0), M("w", "Sam", 0)], () => null));
  ok(tie.join(",") === "w,x,y", "A: the same name, any case — the user ID breaks the tie", tie);
  const dup = ids(order({ people: [] }, [M("a", "a", 0), M("a", "a", 0), null, { name: "no id" }], () => null));
  ok(dup.join(",") === "a", "A: a member listed twice is one row, and an entry with no user ID is none", dup);
  const thr = ids(order({ people: [] }, [M("a", "a", 0), M("b", "b", 0)], (u) => { if (u === "@a:hs") throw new Error("x"); return 2; }));
  ok(thr.join(",") === "b,a", "A: a number that cannot be read is no number — never a throw out of the People tab", thr);
}

// ── B — THE ROW ──────────────────────────────────────────────────────────────────────────────────────────────────────
function drive(o) {
  const mk = (tag) => ({ tag, className: "", text: "", children: [], style: {}, dataset: {}, attrs: {},
    appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } });
  const el = (tag, a, kids) => { const n = mk(tag); if (a) { for (const k of Object.keys(a)) { if (k === "class") n.className = a[k]; else if (k === "text") n.text = a[k]; else n.attrs[k] = a[k]; } }
    for (const c of (kids || [])) if (c) n.children.push(c); return n; };
  const box = mk("div");
  const T = 20000000;
  const ctx = {
    refs: { rosterBox: box }, console,
    H: { el, clear: (n) => { n.children = []; }, shortName: (u) => u.split(":")[0].slice(1), rankColor: () => "#fff",
         rankName: (l) => String(l), avatarEl: (u) => { const a = mk("img"); a.dataset.who = u; return a; } },
    Room: { getRoster: () => ROSTER, presenceView: () => VIEW, peopleOrder: null },
    ServerClock: { serverNow: () => T },
    Panels: { agoFromServer: () => "now" },
    Logger: { warn() {} },
    _wireCardTrigger: () => {},
  };
  if (o.rep) ctx.Rep = o.rep;
  const pieces = ["_repBadge", "renderRoster"].map((n) => { const x = XI.extractNamed("ui/roster.js", n); ok(x.ok, "B: APPLIED — `" + n + "` is extractable from ui/roster.js", x.stage); return x.source; });
  vm.createContext(ctx);
  vm.runInContext(ORD.source + "\nRoom.peopleOrder = peopleOrder;\n" + pieces.join("\n") + "\n;globalThis.__r = renderRoster;", ctx);
  ctx.__r();
  const rows = box.children.filter((n) => /\bperson\b/.test(n.className));
  const flat = (n) => [n].concat(...n.children.map(flat));
  return { rows, flat, who: (r) => (flat(r).find((x) => x.className === "who") || {}).text,
    rep: (r) => r.children.find((x) => /\bperson-rep\b/.test(x.className)), all: (r) => flat(r).map((x) => x.text || "").join(" ") };
}
if (ORD.ok) {
  const asked = [];
  const w = drive({ rep: { badge: (u) => { asked.push(u); return (u in REPS) ? { rep: REPS[u], text: REPS[u] + " REP" } : null; } } });
  ok(w.rows.length === ROSTER.length, "B: APPLIED — one row per member", w.rows.length);
  ok(w.rows.map(w.who).join(",") === "bot,zed,bob,cat,eve,owner,Amy,Dan,fay,gus",
    "B: THE ROWS ARE IN THE FEATURE LAYER'S ORDER — the UI renders it and sorts nothing", w.rows.map(w.who));
  ok(asked.length === ROSTER.length && ROSTER.every((m) => asked.indexOf(m.userId) >= 0), "B: H3 is asked once per member — `Rep.badge`, REP's one name in the UI", asked);
  const zedRow = w.rows[1], kids = zedRow.children.map((x) => x.className || x.tag);
  // RE-AIMED AT J88 (the owner's ruling 36): REP moved from before the name to the right, the rank tag's old spot — the
  // row's last element. `check-rank-faces` D holds the rest of the new row (no rank label; nothing where no number is held).
  ok(w.rep(zedRow) && w.rep(zedRow).text === "9 REP" && kids.indexOf("who") === 1 && kids.indexOf("person-rep") === kids.length - 1,
    "B: `<n> REP` IN ITS OWN ELEMENT, ON THE RIGHT — the row's last, after the name (ruling 36)", kids);
  ok(!w.rep(w.rows[0]) && !/REP/.test(w.all(w.rows[0])) && !/\b0\b/.test(w.all(w.rows[0])),
    "B: where this device holds no REP — the bot's row — nothing: no number, never a 0", w.all(w.rows[0]));
  const inactive = w.rows.filter((r) => /\binactive\b/.test(r.className)).map(w.who);
  ok(inactive.join(",") === "owner,Amy,Dan,fay,gus" && w.rows.slice(0, 5).every((r) => r.className === "person"),
    "B: THE INACTIVE ROWS ARE GREYED (`.person.inactive`), the active ones not (ruling 31)", w.rows.map((r) => r.className));
  const danRow = w.rows.find((r) => w.who(r) === "Dan");
  ok(w.rep(danRow) && w.rep(danRow).text === "7 REP" && /\binactive\b/.test(danRow.className),
    "B: AN INACTIVE MEMBER'S NUMBER SHOWS, greyed with the row (ruling 34)", w.all(danRow));
  const reps = w.rows.map((r) => w.rep(r)).filter(Boolean);
  ok(reps.every((x) => Object.keys(x.attrs).length === 0) && !w.rows.some((r) => /since|seen by|counted/i.test(w.all(r))),
    "B: NO TOOLTIP AND NO COVERAGE TEXT — not on the number, not anywhere on the row (Q6)", reps.map((x) => x.attrs));
  const none = drive({ rep: { badge: () => null } });
  ok(none.rows.map(none.who).join(",") === "bot,bob,zed,cat,eve,owner,Amy,Dan,fay,gus" && none.rows.every((r) => !none.rep(r)),
    "B: NO BOT IN THE ROOM — no numbers anywhere, and the same order on rank and name (30f)", none.rows.map(none.who));
  const absent = drive({});
  ok(absent.rows.length === ROSTER.length && absent.rows.every((r) => !absent.rep(r)), "B: with REP not loaded at all, the list draws and shows no number", absent.rows.length);
  const boom = drive({ rep: { badge: () => { throw new Error("x"); } } });
  ok(boom.rows.length === ROSTER.length && boom.rows.every((r) => !boom.rep(r)), "B: a REP that throws draws the list anyway, with no numbers", boom.rows.length);
}

// ── C — THE LOOK ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const html = read("index.html");
  const repRule = (html.match(/\.person-rep\s*\{([^}]*)\}/) || [])[1] || "";
  const hex = (repRule.match(/color:\s*#([0-9a-fA-F]{6})/) || [])[1];
  const ch = hex ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : null;
  ok(ch && ch.every((v) => v >= 0x80 && v <= 0xd0) && Math.max(...ch) - Math.min(...ch) <= 0x18,
    "C: `.person-rep` is a light grey — every channel between 0x80 and 0xD0, and near equal (ruling 27)", hex);
  // RE-AIMED AT J89 (the owner's ruling 38, which replaces J88's undimmed name): an inactive row is greyed as a whole again,
  // as before J88 — its name and its number with it. `check-rank-faces` E holds the rest of the look.
  const inRule = (html.match(/\.person\.inactive\s*\{([^}]*)\}/) || [])[1] || "";
  const op = (inRule.match(/opacity:\s*([0-9.]+)/) || [])[1];
  ok(op !== undefined && Number(op) > 0 && Number(op) < 1, "C: an inactive row is greyed as a whole — its name and number with it (ruling 38)", inRule);
}

// ── D — ONE COPY ─────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const rm = read("features/room.js"), ro = read("ui/roster.js"), pn = read("ui/panels.js");
  ok(/\n\s*peopleOrder,/.test(rm.slice(rm.lastIndexOf("return {"))), "D: the feature layer exports the one order (`Room.peopleOrder`)");
  ok(/Room\.peopleOrder\(/.test(ro) && !/_activeOrder/.test(ro) && !/_activeOrder/.test(pn) && !/\.sort\(/.test(XI.extractNamed("ui/roster.js", "renderRoster").source || ""),
    "D: and the UI renders it — no order of its own, no sort in the row builder (P7)");
}

// ── E — IN REAL TIME ─────────────────────────────────────────────────────────────────────────────────────────────────
{
  const on = XI.extractNamed("features/room.js", "onPeopleViewChange"), raise = XI.extractNamed("features/room.js", "peopleViewChanged");
  ok(on.ok && raise.ok, "E: PREMISE — the feature layer declares the signal, once", [on.stage, raise.stage]);
  if (on.ok && raise.ok) {
    const c = vm.createContext({});
    vm.runInContext("const _peopleViewListeners = [];\n" + on.source + "\n" + raise.source + "\n;this.on = onPeopleViewChange; this.raise = peopleViewChanged;", c);
    const heard = [];
    const f = () => heard.push("f"), g = () => { heard.push("g"); throw new Error("x"); }, h = () => heard.push("h");
    c.on(f); c.on(g); c.on(h); c.on(f);
    c.raise();
    ok(heard.join() === "f,g,h", "E: \"THE PEOPLE VIEW CHANGED\" REACHES EVERY LISTENER, once each — one that throws stops none after it", heard);
    ok(!/\bRep\b|\bREP\b|rep-/.test(on.source + raise.source), "E: and names nothing of what changed — no REP in it");
  }
  const screens = read("ui/screens.js");
  ok(/Room\.onPeopleViewChange\(Panels\.peopleViewChanged\)/.test(screens), "E: THE PEOPLE TAB SUBSCRIBES (ui/screens.js, once a page)");
  const names = ["_peopleVisible", "_peopleBusy", "_peopleTick", "peopleViewChanged"];
  const X = names.map((n) => XI.extractNamed("ui/panels.js", n));
  const soonMs = Number((read("ui/panels.js").match(/const PEOPLE_SOON_MS = (\d+);/) || [])[1]);
  ok(X.every((x) => x.ok) && soonMs > 0 && soonMs <= 1000, "E: PREMISE — the redraw is extractable, and due within a second", { soonMs: soonMs, stages: X.map((x) => x.stage) });
  if (X.every((x) => x.ok)) {
    const drive = (o) => {
      const t = { timers: [], draws: 0, heads: 0, pane: { style: { display: o.hidden ? "none" : "flex" } }, focus: o.busy ? { inList: true } : null };
      const c = vm.createContext({
        setTimeout: (fn, ms) => { const h = { fn, ms, live: true }; t.timers.push(h); return h; },
        refs: { roster: t.pane, rosterBox: { contains: (n) => !!(n && n.inList) } },
        document: { get activeElement() { return t.focus; } },
        Roster: { renderRoster: () => { t.draws++; } },
        renderActivePanel: () => { t.heads++; },
      });
      vm.runInContext("let _peopleSoon = null; const PEOPLE_SOON_MS = " + soonMs + ";\n" + X.map((x) => x.source).join("\n") + "\n;this.signal = peopleViewChanged;", c);
      t.signal = c.signal;
      t.fire = () => { const due = t.timers.filter((h) => h.live); for (const h of due) { h.live = false; h.fn(); } };
      return t;
    };
    const t = drive({});
    for (let i = 0; i < 10; i++) t.signal();
    ok(t.timers.length === 1 && t.timers[0].ms === soonMs && t.draws === 0, "E: A BURST IS ONE REDRAW — ten signals arm one timer, nothing drawn yet", t.timers.length);
    t.fire();
    ok(t.draws === 1 && t.heads === 1, "E: and it draws once, the list and its header", { list: t.draws, head: t.heads });
    t.signal(); t.fire();
    ok(t.draws === 2, "E: the next signal draws again", t.draws);
    const hid = drive({ hidden: true });
    hid.signal(); hid.fire();
    ok(hid.draws === 0 && hid.heads === 0, "E: People hidden — nothing drawn (opening it draws fresh)", hid.draws);
    const busy = drive({ busy: true });
    busy.signal(); busy.fire();
    ok(busy.draws === 0 && busy.timers.filter((h) => h.live).length === 1, "E: while you are using the list it waits — not dropped, armed again", busy.timers.length);
    busy.focus = null; busy.fire();
    ok(busy.draws === 1, "E: and draws once you are not", busy.draws);
  }
}

if (failed) { console.log("[people-tab] " + failed + " failure(s) of " + asserts + " assertions"); process.exit(1); }
console.log("[people-tab] PASS — the People tab has one order and shows REP only where this device holds it (J84-3, ruling 35; " + asserts +
  " assertions). THE ORDER, decided in the feature layer and run as it stands: this viewer's active people on top, the inactive " +
  "members below; within each, rank, then REP with no number after any number, then a–z case folded, the user ID breaking a tie; " +
  "a non-member is not listed; with no numbers the same order on rank and name. THE ROW, the real builder: `<n> REP` in its own " +
  "light-grey element on the right, after the name, only where H3 answers — no 0, no tooltip, no coverage text; the inactive greyed, " +
  "an inactive member's number with them; no bot, no numbers; a REP that throws, the list anyway. ONE COPY: the UI sorts nothing. " +
  "IN REAL TIME (ruling 35): the generic \"the people view changed\" reaches every listener and names nothing of REP; People " +
  "redraws within a second, once per burst, never while hidden, and waits while you use the list");
