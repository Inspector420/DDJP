// tests/check-message-row.js
// SUBJECT: ui/chat.js, index.html
// WALL: ONE message row for every chat tier and every DM (owner-approved canvas, ddjp_468). An avatar
// column; a body holding the name — which never splits — and the text, whose wrapped lines stay in the
// body instead of running back under the avatar; and at the row's end, shown on hover (or a tap where
// there is no hover): HOW LONG AGO it was sent, against the SERVER clock, and the delete × where your
// rights allow it — your own messages, or anyone's when your rank may remove them; never a tombstone's.
//
// Driven: the REAL `_chatRow` in `ui/chat.js`, loaded whole through `_chat-world.js`, and the REAL DM
// conversation, which builds its rows with the same function. THIS GUARD CANNOT SEE THE LAYOUT — that the
// name stays whole and the text wraps under it, and that showing the age moves nothing, is CSS a browser
// applies; those rules are DECLARED here.

const fs = require("fs");
const path = require("path");
const { world, tick, mk } = require("./_chat-world");
const { ROOT } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[message-row] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const has = (n, c) => n && typeof n.className === "string" && n.className.split(/\s+/).indexOf(c) >= 0;
const all = (n) => { const out = []; (function w(x) { for (const c of (x.children || [])) { out.push(c); w(c); } })(n); return out; };
// Since ddjp_474 the meta (age and ×) sits at the END OF THE BODY, after the text — not in a column of its own.
const parts = (row) => {
  const body = row.children.find((c) => has(c, "chat-body"));
  return { kids: row.children.map((c) => c.className || c.tag), body,
           meta: body ? body.children.find((c) => has(c, "chat-meta")) : undefined };
};

(async () => {
  const w = world();
  w.sb.Panels.agoFromServer = (ts) => (typeof ts === "number" ? "AGO " + ts : "");
  const box = mk("div");
  const row = (rec, opts) => w.CP._chatRow(box, rec, opts);

  // ═══ PART A — the row's three parts ════════════════════════════════════════════════════════════
  {
    const r = row({ id: "$a", sender: "@me:hs", body: "hello there", ts: 1000 });
    const p = parts(r);
    ok(p.kids.length === 2 && p.body && p.kids.indexOf(p.body.className) === 1,
      "A: A ROW IS avatar · body — so wrapped text stays in the body, never back under the avatar", p.kids);
    ok(p.meta && p.body.children[p.body.children.length - 1] === p.meta,
      "A: THE AGE AND × SIT AT THE END OF THE MESSAGE — the body's last part, not a column taking width from every line (ddjp_474)",
      p.body.children.map((c) => c.className || c.tag));
    ok(has(p.body.children[0], "sender"), "A: the body starts with the NAME, then the text", p.body.children.map((c) => c.className || c.tag));
    ok(p.meta.children.some((c) => has(c, "chat-ago")), "A: the meta holds the age", p.meta.children.map((c) => c.className));
  }

  // ═══ PART B — how long ago, read against the SERVER clock at the moment you look ═══════════════
  {
    const r = row({ id: "$b", sender: "@alice:hs", body: "hi", ts: 4242 });
    const ago = all(r).find((n) => has(n, "chat-ago"));
    ok(ago && !ago.textContent, "B: nothing is computed until you look — a stored age would be stale by the time it showed", ago && ago.textContent);
    r.onmouseenter();
    ok(ago.textContent === "AGO 4242", "B: HOVERING shows how long ago, from the server clock's own reading of the message's stamp", ago.textContent);
    w.sb.Panels.agoFromServer = (ts) => "LATER " + ts;
    r.onmouseenter();
    ok(ago.textContent === "LATER 4242", "B: and each hover reads it AGAIN, so it is never stale", ago.textContent);
    w.sb.Panels.agoFromServer = (ts) => (typeof ts === "number" ? "AGO " + ts : "");
  }

  // ═══ PART C — the × where your rights allow it ════════════════════════════════════════════════
  {
    const del = (r) => all(r).find((n) => n.tag === "button" && has(n, "chat-del"));
    const mine = row({ id: "$c1", sender: "@me:hs", body: "mine", ts: 1 });
    const theirs = row({ id: "$c2", sender: "@alice:hs", body: "theirs", ts: 1 });
    ok(del(mine) && parts(mine).meta.children.indexOf(del(mine)) >= 0, "C: YOUR OWN message has the ×, in the meta beside the age");
    ok(!del(theirs), "C: someone else's has none — when your rank may not remove it");
    // SOMEONE ELSE'S (ddjp_469): the row ASKS the actions list about `chat.redact` with the AUTHOR's rank,
    // and honours the answer both ways — the rule itself (staff+, only below you) is check-chat-delete's.
    const realD = w.sb.Actions.describe, realLvl = w.sb.UIBase.host._rosterLevel;
    const asked = [];
    w.sb.Actions.describe = (a, t) => { if (a === "chat.redact") { asked.push(t); return { enabled: t.targetRank < 60 }; } return realD ? realD(a, t) : { enabled: false }; };
    w.sb.UIBase.host._rosterLevel = (u) => (u === "@alice:hs" ? 20 : u === "@boss:hs" ? 99 : 0);
    const below = row({ id: "$c3", sender: "@alice:hs", body: "theirs", ts: 1 });
    const above = row({ id: "$c5", sender: "@boss:hs", body: "the owner's", ts: 1 });
    const dmOther = row({ id: "$c6", sender: "@alice:hs", body: "a DM", ts: 1 }, { rowClass: "chat-msg dm-msg", ownOnly: true });
    w.sb.Actions.describe = realD; w.sb.UIBase.host._rosterLevel = realLvl;
    ok(asked.some((t) => t.targetRank === 20), "C: the row asks with the AUTHOR's rank", asked);
    ok(del(below), "C: HAS the × on a message from someone ranked below you, where the rule says so");
    ok(!del(above), "C: and NONE on a message from someone at or above you — nobody deletes a higher rank's words");
    ok(!del(dmOther), "C: in a DM, never on the other person's message — DMs are your own messages only");
    const gone = row({ id: "$c4", sender: "@me:hs", body: "", ts: 1, redacted: true });
    ok(!del(gone), "C: a deleted message offers no × — there is nothing left to take back");
  }

  // ═══ PART D — a tap shows the same thing where there is no hover ══════════════════════════════
  {
    const r = row({ id: "$d", sender: "@me:hs", body: "tap me", ts: 7 });
    r.onclick({ target: r });
    ok(r.classList.contains("shown"), "D: A TAP on the row shows its age and ×", r.className);
    ok(all(r).find((n) => has(n, "chat-ago")).textContent === "AGO 7", "D: with the age read at that moment");
    r.onclick({ target: r });
    ok(!r.classList.contains("shown"), "D: and a second tap hides them again", r.className);
    const btn = all(r).find((n) => n.tag === "button");
    r.onclick({ target: { closest: (sel) => (/button/.test(sel) ? btn : null) } });
    ok(!r.classList.contains("shown"), "D: tapping the × itself (or a name, a link) does its own job, not this", r.className);
  }

  // ═══ PART E — a DM row is THE SAME ROW ═══════════════════════════════════════════════════════════
  {
    const d = world();
    d.refs.dmBox = mk("div"); d.refs.tabDM = mk("button");
    d.sb.Chat.dmInit(); d.CP._wireDMPanel(); d.CP._openDMFromAction("!dm:hs");
    await tick();
    d.rawDM("$dm1", 3000, "a direct message", "@me:hs");
    await tick();
    const dmRow = all(d.refs.dmBox).find((n) => n.dataset && n.dataset.eid === "$dm1");
    ok(dmRow, "E: APPLIED — the DM message is shown");
    const p = parts(dmRow);
    ok(p.body && p.meta && has(dmRow, "chat-msg") && has(dmRow, "dm-msg"),
      "E: A DM ROW IS THE SAME avatar · body · meta chat row — one builder, one shape, both surfaces", p.kids);
  }

  // ═══ PART F — the layout rules a browser applies (DECLARED) ═══════════════════════════════════
  {
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    const rule = (sel) => (css.match(new RegExp(sel.replace(/[.]/g, "\\.").replace(/ /g, "\\s+") + "\\s*\\{[^}]*\\}")) || [""])[0];
    ok(/white-space:\s*nowrap/.test(rule(".chat-body .sender")), "F: the NAME never splits", rule(".chat-body .sender"));
    ok(/min-width:\s*0/.test(rule(".chat-body")) && /overflow-wrap:\s*anywhere/.test(rule(".chat-body")),
      "F: the body may shrink and breaks a very long word instead of spilling out", rule(".chat-body"));
    ok(/display:\s*flex/.test(rule(".chat-msg")) && /align-items:\s*flex-start/.test(rule(".chat-msg")), "F: a row is avatar · body · meta side by side", rule(".chat-msg"));
    // HIDDEN-BUT-PRESENT, by owner ruling (ddjp_484): showing them on hover grew a line under the pointer when the
    // message's last line had no room, and moved every row below. ddjp_474 had left `visibility` because the meta
    // was then a COLUMN, whose reserved width narrowed every line; floated at the END it reserves the last line only.
    ok(/visibility:\s*hidden/.test(rule(".chat-meta")) && !/display:\s*none/.test(rule(".chat-meta")) && /white-space:\s*nowrap/.test(rule(".chat-meta")),
      "F: the age and × KEEP THEIR SPOT before you look — hidden, not absent — and stay together (owner ruling, ddjp_484)", rule(".chat-meta"));
    // ddjp_475: at the RIGHT EDGE, always (owner ruling) — floated right at the end of the message, so they sit
    // on its last line when there is room and on a new line, still at the right edge, when there is not.
    ok(/float:\s*right/.test(rule(".chat-meta")), "F: the age and × FLOAT RIGHT — always at the end of the line, never mid-row", rule(".chat-meta"));
    ok(/\.chat-msg:hover \.chat-meta[^{]*\{[^}]*visibility:\s*visible/.test(css),
      "F: hovered, they become VISIBLE in the spot they already hold — nothing moves");
    ok(/@media \(hover: none\)[\s\S]{0,300}\.chat-msg\.shown \.chat-meta \{[^}]*visibility:\s*visible/.test(css),
      "F: and on a device with no hover, a tapped row shows them — a click on a computer does not stick");
    // The toggle that moved the list was DISPLAY. Every rule naming the meta itself (not its ::before) is read.
    const rulesAll = []; css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { rulesAll.push({ sels: sel.split(",").map((x) => x.trim()), body }); return m; });
    const metaRules = rulesAll.filter((r) => r.sels.some((x) => /\.chat-meta$/.test(x)));
    ok(metaRules.length >= 3, "F: APPLIED — the stylesheet reader finds the meta's own rules", metaRules.length);
    const toggles = metaRules.filter((r) => /display:/.test(r.body) && !/display:\s*inline-grid/.test(r.body)).map((r) => r.sels.join(", "));
    ok(toggles.length === 0, "F: and NOTHING toggles their display — the change that grew a line under the pointer", toggles);
    ok(!/\.dm-msg \{[^}]*display:\s*flex/.test(css), "F: DM rows carry no layout of their own any more — one row, one rule");
  }

  // ═══ PART G — a very long unbroken run may break anywhere, so it starts beside the name (ddjp_469) ═══
  {
    const long = "x".repeat(96);
    const r = row({ id: "$g", sender: "@me:hs", body: "look " + long + " end", ts: 1 });
    const body = parts(r).body;
    const run = all(body).find((n) => has(n, "chat-long"));
    ok(run && run.textContent === long, "G: A VERY LONG RUN is its own breakable span — the browser no longer moves it whole to a fresh line", run && run.textContent);
    const plain = row({ id: "$g2", sender: "@me:hs", body: "an ordinary message with ordinary words", ts: 1 });
    ok(!all(parts(plain).body).some((n) => has(n, "chat-long")), "G: ordinary words are left alone — never split mid-word");
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok(/\.chat-long \{[^}]*word-break:\s*break-all/.test(css), "G: and the run is breakable anywhere (DECLARED)");
  }

  // ═══ PART H — a click goes THROUGH the actions list, so the rule is checked again as you click (ddjp_469)
  {
    const performed = [];
    const realP = w.sb.Actions.perform, realD = w.sb.Actions.describe, realLvl = w.sb.UIBase.host._rosterLevel;
    w.sb.Actions.perform = async (a, args) => { performed.push({ a, args }); return { ok: true }; };
    w.sb.Actions.describe = (a, t) => ({ enabled: a === "chat.redact" && t.targetRank < 60 });
    w.sb.UIBase.host._rosterLevel = (u) => (u === "@alice:hs" ? 20 : 0);
    const del = (r) => all(r).find((n) => n.tag === "button" && has(n, "chat-del"));
    const mine = row({ id: "$h1", sender: "@me:hs", body: "mine", ts: 1 });
    const theirs = row({ id: "$h2", sender: "@alice:hs", body: "theirs", ts: 1 });
    await del(mine).onclick(); await del(theirs).onclick(); await tick();
    w.sb.Actions.perform = realP; w.sb.Actions.describe = realD; w.sb.UIBase.host._rosterLevel = realLvl;
    ok(performed[0] && performed[0].a === "chat.redact.own" && performed[0].args.eventId === "$h1",
      "H: YOUR OWN message's × dispatches `chat.redact.own` — anyone may delete their own", performed[0]);
    ok(performed[1] && performed[1].a === "chat.redact" && performed[1].args.eventId === "$h2" && performed[1].args.targetRank === 20,
      "H: someone else's dispatches `chat.redact` WITH the author's rank, so the adapter re-checks the rule at the click", performed[1]);
  }

  // ═══ PART I — the × follows your rights AS THEY ARE NOW, whoever's rank changed (ddjp_470) ════════════
  // Rows are kept, not rebuilt, when ranks change, so a × decided once at build went stale: promoted, you
  // saw none on messages already there; demoted, you kept one. It is re-decided each time you look.
  {
    let allowed = false;
    const realD = w.sb.Actions.describe;
    w.sb.Actions.describe = (a, t) => ({ enabled: a === "chat.redact" && allowed });
    const r = row({ id: "$i1", sender: "@alice:hs", body: "theirs", ts: 1 });
    const del = () => all(r).find((n) => n.tag === "button" && has(n, "chat-del"));
    ok(!del(), "I: APPLIED — not allowed when the row was built, no ×");
    allowed = true;  r.onmouseenter();
    ok(del(), "I: YOUR RIGHTS CHANGED — the next hover shows the × on a message that was already there");
    allowed = false; r.onmouseenter();
    ok(!del(), "I: and when they change back, the next hover takes it away — no stale × left to click");
    allowed = true;  r.onclick({ target: r });
    ok(del(), "I: a tap re-decides it too, where there is no hover");
    w.sb.Actions.describe = realD;
    const mine = row({ id: "$i2", sender: "@me:hs", body: "mine", ts: 1 });
    mine.onmouseenter();
    ok(all(mine).some((n) => n.tag === "button" && has(n, "chat-del")), "I: CONTROL — your own message keeps its × whatever the rule says");
  }

  // ═══ PART M — the reserved spot is exactly as wide as the widest age (owner ruling, ddjp_484; DECLARED) ═══
  // The age is read only as you look, so the spot cannot be measured from it. It holds an INVISIBLE COPY of the
  // widest age the formatter gives, set in the age's own type and stacked under the real one — exact in whatever
  // font a machine has (the app asks for Arial; a machine without it falls back to a wider face), where a fixed
  // width would be right on one machine only. The copy is the FORMATTER's words, run here, never restated.
  {
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const R = []; css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, body) => { R.push({ sels: sel.split(",").map((x) => x.trim()), body }); return m; });
    const rulesFor = (sel) => R.filter((r) => r.sels.indexOf(sel) >= 0);
    const decl = (sel, prop) => { for (const r of rulesFor(sel)) { const m = r.body.match(new RegExp("(?:^|;)\\s*" + prop + ":\\s*([^;]+)")); if (m) return m[1].trim(); } return null; };
    const F = require("./_probe-j14-card.js").extractNamed("ui/panels.js", "_fmtAgo");
    ok(F.ok, "M: APPLIED — the real age formatter is extractable from ui/panels.js by name", F.stage);
    const fmt = new Function(F.source + "; return _fmtAgo;")();
    // THE WIDEST AGE, DERIVED: each unit at its longest reading (59 mins, 23 hrs, 29 days, 11 months, 99 years),
    // and the longest of those. CHARACTERS STAND IN FOR WIDTH, and that is declared: measured in Chrome at
    // ddjp_485, the longest is also the widest in Arial's metric twin, DejaVu Sans and Noto Sans, by 8px or more.
    // `now` far enough from 1970 that a hundred years back is still a real stamp (the formatter refuses one that is not).
    const now = 5e12, s1 = 1000, mn = 60 * s1, hr = 60 * mn, day = 24 * hr;
    const longest = [60 * mn - s1, 24 * hr - s1, 30 * day - s1, 365 * day - s1, (100 * 365 - 1) * day].map((a) => fmt(now - a, now));
    const widest = longest.reduce((w, t) => (t.length > w.length ? t : w), "");
    ok(longest.every((t) => /ago$/.test(t)) && fmt(now - 30 * s1, now) === "just now", "M: APPLIED — the formatter runs, and reads each unit at its longest", longest);
    ok(decl(".chat-meta::before", "content") === JSON.stringify(widest),
      "M: THE SPOT HOLDS THE FORMATTER'S OWN WIDEST AGE — derived from its words, not a copy that could drift", { css: decl(".chat-meta::before", "content"), formatter: widest, longest });
    ok(decl(".chat-meta::before", "visibility") === "hidden", "M: and that copy is never shown, hovered or not", decl(".chat-meta::before", "visibility"));
    ok(R.some((r) => r.sels.indexOf(".chat-ago") >= 0 && r.sels.indexOf(".chat-meta::before") >= 0 && /font-size:/.test(r.body)),
      "M: the copy is set in the AGE'S OWN TYPE — one rule for both — so its width is the real age's, in any font");
    ok(decl(".chat-meta", "display") === "inline-grid" && decl(".chat-meta::before", "grid-area") === "1 / 1" && decl(".chat-ago", "grid-area") === "1 / 1",
      "M: the real age is STACKED over the copy in one cell, so the cell is as wide as the wider of the two", [decl(".chat-meta", "display"), decl(".chat-meta::before", "grid-area"), decl(".chat-ago", "grid-area")]);
    ok(decl(".chat-ago", "justify-self") === "end" && decl(".chat-del", "grid-area") === "1 / 2",
      "M: and the age keeps its place beside the × at the right edge, as before", [decl(".chat-ago", "justify-self"), decl(".chat-del", "grid-area")]);
    ok(fmt(now - 100 * 365 * day, now) === "100 years ago", "M: the only edge left — an age of 100 years or more would be wider than the spot", fmt(now - 100 * 365 * day, now));
  }

  // ═══ PART L — the profile picture opens the card (owner ruling, ddjp_478) ════════════════════════════
  // Wired on a WRAPPER around the picture: when a profile picture finishes loading, the app swaps the
  // placeholder for the image, and a handler on the placeholder would go with it.
  {
    const wired = [];
    const realW = w.sb.Roster._wireCardTrigger;
    w.sb.Roster._wireCardTrigger = (n, u) => { wired.push({ n, u }); if (n && n.classList) n.classList.add("uc-trigger"); return n; };
    const r = row({ id: "$l", sender: "@alice:hs", body: "hi", ts: 1 });
    w.sb.Roster._wireCardTrigger = realW;
    const avBox = r.children[0];
    ok(has(avBox, "chat-av") && wired.some((x) => x.n === avBox && x.u === "@alice:hs"),
      "L: THE PROFILE PICTURE OPENS THE CARD — wired on its wrapper, so a picture loading later keeps it", wired.map((x) => x.n.className));
    ok(avBox.children.some((c) => c.dataset && c.dataset.avatarFor === "@alice:hs"),
      "L: the picture itself stays inside the wrapper, where a loaded image replaces it");
    r.onclick({ target: { closest: (sel) => (/uc-trigger/.test(sel) ? avBox : null) } });
    ok(!r.classList.contains("shown"), "L: and tapping the picture opens the card — it does not show the time and ×", r.className);
  }

  console.log("[message-row] PASS — one message row for every chat and DM (" + asserts + " assertions), driven through the real " +
    "`_chatRow` and a real DM conversation: avatar · body · meta, the name first in the body and the text after it; how long ago " +
    "read from the server clock each time you hover or tap, never stored; the × for your own messages and, where your rank may, " +
    "anyone's, never a tombstone's; a tap shows them where there is no hover and leaves the ×, names and links to their own job. " +
    "Their spot is RESERVED before you look — as wide as the formatter's widest age, in the age's own type — so showing them moves nothing. " +
    "THIS GUARD CANNOT SEE THE LAYOUT — its rules are declared");
  process.exit(0);
})().catch((e) => fail("threw — " + ((e && e.stack) || e)));
