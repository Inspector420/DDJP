// tests/check-dm-convo.js
// SUBJECT: ui/chat.js, index.html
// WALL: a DM conversation behaves like room chat (owner report with screenshot, ddjp_451). Its
// messages sit in chat's own scrolling box (`chat-messages`) instead of running on under the input;
// the list stays at the newest message unless the reader has scrolled up; and the COMPOSER IS BUILT
// ONCE — a message arriving repaints the list and never replaces the input, so focus and a
// half-typed message survive, and sending empties the field and keeps it focused, as chat does.
//
// WHY THIS GUARD EXISTS: no guard ran the conversation view at all. `_probe-j15-dm.js` stubs
// `_renderDMConvo`, so every DM guard drove the list and never the conversation — code no guard
// executes, the seventh signature. This one loads `ui/chat.js` WHOLE through `_chat-world.js`, opens
// the conversation the way the panel does, and feeds messages through the REAL `features/chat.js`.
//
// PART W (J136): the room's DM panel — its list and an open conversation — sits as far in from the side panel's edges as the Chat
// tab's box and People's rows, read through the page's own cascade in the screen world; the box keeps its top padding (the
// heading's place), and the lobby's framed Messages box keeps all of its.
//
// THIS GUARD CANNOT TELL YOU THE BOX LOOKS LIKE CHAT'S OR THAT A BROWSER KEEPS FOCUS. It proves the
// input element is never replaced and that focus is asked for; the rest is a person at a screen.

const fs = require("fs");
const path = require("path");
const { world, tick, mk } = require("./_chat-world");
const { ROOT } = require("./_load");

let asserts = 0;
function fail(msg, got) {
  console.log("[dm-convo] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const all = (n) => { const out = []; (function w(x) { for (const c of x.children) { out.push(c); w(c); } })(n); return out; };
const has = (n, c) => n && typeof n.className === "string" && n.className.split(/\s+/).indexOf(c) >= 0;

async function opened() {
  const w = world();
  w.refs.dmBox = mk("div");
  w.refs.tabDM = mk("button");
  w.sb.Chat.dmInit();          // binds the DM receive handler, as the app does at room entry
  w.CP._wireDMPanel();
  w.CP._openDMFromAction("!dm:hs");
  await tick();
  const box = w.refs.dmBox;
  const input = () => all(box).find((n) => n.tag === "input" && has(n, "dm-input")) || null;
  const list = () => all(box).find((n) => has(n, "dm-msgs")) || null;
  const rows = () => { const l = list(); return l ? l.children.filter((c) => c.dataset && c.dataset.eid) : []; };
  const send = () => all(box).find((n) => n.tag === "button" && n.textContent === "Send");
  const note = () => all(box).find((n) => has(n, "dm-note"));
  // The chat world's elements have no focus(); give the composer one that records, so the guard can
  // see what the panel ASKED for. Re-applied to whatever input is found, never to a fresh one.
  const arm = (i) => { if (i && !i.focus) { i.value = i.value || ""; i.focused = false; i.focus = function () { this.focused = true; }; } return i; };
  return { w, box, input: () => arm(input()), list, rows, send, note };
}

(async () => {
  // ═══ PART A — the list is chat's scrolling box, and the outer panel does not scroll ═══════════════
  {
    const c = await opened();
    ok(c.w.ui.rightTab === "dm", "A: APPLIED — the conversation opened the DM tab", c.w.ui.rightTab);
    const l = c.list();
    ok(l, "A: APPLIED — the conversation renders its message list");
    ok(has(l, "chat-messages"), "A: THE LIST IS CHAT'S OWN BOX (`chat-messages`) — its look and its own scroll, borrowed, not re-declared", l && l.className);
    ok(c.box.classList.contains("dm-convo"), "A: and the outer DM box is in conversation mode, so IT does not scroll — the list does, and the input stays below it");
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    ok(/\.dm-box\.dm-convo \{[^}]*overflow:\s*hidden/.test(css), "A: `.dm-box.dm-convo` is declared not to scroll (DECLARED — the layout is a browser's)");
  }

  // ═══ PART B — a message arriving never replaces the composer ═════════════════════════════════════
  {
    const c = await opened();
    const i0 = c.input();
    ok(i0, "B: APPLIED — the composer renders");
    i0.value = "half-typ"; i0.focus();
    const l0 = c.list();
    c.w.rawDM("$in1", 1000, "hello from alice", "@alice:hs");
    await tick();
    ok(c.rows().some((r) => r.dataset.eid === "$in1"), "B: APPLIED — the arriving message is shown", c.rows().map((r) => r.dataset.eid));
    ok(c.input() === i0, "B: A MESSAGE ARRIVING DOES NOT REPLACE THE INPUT — the same element, so focus is never taken away");
    ok(i0.value === "half-typ", "B: and a half-typed message SURVIVES another person's message arriving", i0.value);
    ok(c.list() === l0, "B: the list is the same element too, so its scroll position is its own", null);
  }

  // ═══ PART C — sending: one send, the field empties at once, focus is kept, the echo keeps it ═════
  {
    const c = await opened();
    const i0 = c.input();
    i0.value = "hi alice";
    i0.onkeydown({ key: "Enter" });
    ok(i0.value === "", "C: THE FIELD EMPTIES AT ONCE, as chat's does — the next message can be typed while this one goes", i0.value);
    ok(i0.focused === true, "C: and focus is asked for, so you keep typing without clicking back in");
    await tick();
    ok(c.w.sent.length === 1 && c.w.sent[0].text === "hi alice" && c.w.sent[0].roomId === "!dm:hs", "C: APPLIED — one message reached the transport", c.w.sent);
    i0.value = "next one";
    c.w.rawDM("$echo", 1001, "hi alice", "@me:hs");   // the server's echo of my own message
    await tick();
    ok(c.input() === i0 && i0.value === "next one", "C: MY OWN MESSAGE'S ECHO does not replace the input either — what I typed next is still there", i0.value);
    // Clicking Send keeps you typing too.
    i0.value = "by button"; i0.focused = false;
    c.send().onclick();
    ok(i0.value === "" && i0.focused === true, "C: pressing Send empties the field and hands focus back to it", { v: i0.value, f: i0.focused });
    await tick();
  }

  // ═══ PART D — a failed send puts the text back and says so ════════════════════════════════════════
  {
    const c = await opened();
    c.w.sb.MatrixBridge.sendMessage = async () => { throw new Error("boom"); };
    const i0 = c.input();
    i0.value = "retry me";
    i0.onkeydown({ key: "Enter" });
    await tick(); await tick();
    ok(i0.value === "retry me", "D: A FAILED SEND PUTS THE TEXT BACK — nothing typed is lost", i0.value);
    ok(/didn't send/.test(c.note().textContent), "D: and the note says it did not send", c.note().textContent);
  }

  // ═══ PART E — the list stays at the newest message, unless the reader has scrolled up ═════════════
  {
    const c = await opened();
    for (let k = 0; k < 30; k++) c.w.rawDM("$m" + k, 2000 + k, "msg " + k, k % 2 ? "@alice:hs" : "@me:hs");
    await tick();
    const l = c.list();
    ok(l.scrollHeight > l.clientHeight, "E: APPLIED — the list is taller than its box", { h: l.scrollHeight, c: l.clientHeight });
    ok(l.scrollTop === l.scrollHeight, "E: AT THE NEWEST MESSAGE — the list follows the conversation", { top: l.scrollTop, h: l.scrollHeight });
    l.scrollTop = 0;                                   // the reader scrolls up to read
    c.w.rawDM("$late", 3000, "a later one", "@alice:hs");
    await tick();
    ok(l.scrollTop === 0, "E: SCROLLED UP TO READ, a new message does not yank the reader down", l.scrollTop);
  }

  // ═══ PART F — leaving and reopening builds fresh; the list view is not in conversation mode ═══════
  {
    const c = await opened();
    const i0 = c.input();
    const back = all(c.box).find((n) => n.tag === "button" && /Conversations/.test(n.textContent));
    ok(back, "F: APPLIED — the back button renders");
    back.onclick();
    ok(!c.box.classList.contains("dm-convo") && !c.input(), "F: back in the list, the box leaves conversation mode and the composer is gone");
    c.w.CP._openDMFromAction("!dm:hs");
    await tick();
    ok(c.input() && c.input() !== i0, "F: reopening builds a fresh composer, so nothing leaks from the last visit");
  }

  // ═══ PART G — your own DM message shows its delete ×, like chat (owner report, ddjp_467) ══════════
  // The × was THERE — clickable where chat's sits — but never shown: `.chat-del` is invisible until a
  // `.chat-msg` row is hovered, and DM rows were built by chat's own `_chatRow` with a class of their
  // own INSTEAD of chat's. Now a DM row is a chat row too (`chat-msg dm-msg`), so it borrows chat's
  // rules, the reveal among them. The reveal itself is browser CSS: DECLARED.
  {
    const c = await opened();
    c.w.rawDM("$mine", 5000, "my own words", "@me:hs");
    c.w.rawDM("$theirs", 5001, "their words", "@alice:hs");
    await tick();
    const mine = c.rows().find((r) => r.dataset.eid === "$mine");
    const theirs = c.rows().find((r) => r.dataset.eid === "$theirs");
    ok(mine && theirs, "G: APPLIED — both messages are shown", c.rows().map((r) => r.dataset.eid));
    const del = (r) => all(r).find((n) => n.tag === "button" && has(n, "chat-del"));
    ok(del(mine), "G: my own message HAS its delete button");
    ok(has(mine, "chat-msg") && has(mine, "dm-msg"), "G: AND ITS ROW IS A CHAT ROW TOO — so chat's hover rule reveals the ×", mine.className);
    ok(!del(theirs), "G: CONTROL — someone else's message has none", null);
    const css = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    // Since ddjp_468 the × sits in the row's META with the age, and the meta is what hover reveals.
    // ddjp_484: the meta keeps its spot HIDDEN until hovered (visibility), so showing it moves nothing —
    // it was absent (display: none) from ddjp_474, which grew a line under the pointer on a full last line.
    ok(/\.chat-msg:hover \.chat-meta[^{]*\{[^}]*visibility:\s*visible/.test(css) && /\.chat-meta \{[^}]*visibility:\s*hidden/.test(css),
      "G: the × (in the meta) is hidden until its CHAT row is hovered — the rule a DM row borrows (DECLARED)");
  }

  // ═══ PART W — THE ROOM'S DM PANEL AS WIDE AS CHAT AND PEOPLE (J136, the owner's: "also the DM pannel should be as large as chat
  // and people, its narrower") ═══════════════════════════════════════════════════════════════════════════════════════════════════
  // The REAL main screen and the real panels in the screen world (`tests/_screen-world.js`, the eleven ui/ files whole), read
  // through the page's own cascade: how far in from the side panel's edges each box sits — the side margins, borders and padding
  // of every element between it and the panel the Chat box, People's rows and the DMs share. The DM list's heading, search box
  // and rows, and an open conversation's head, messages box and composer, must sit exactly as far in as the Chat tab's box (and
  // its composer) and People's rows: at 680 they sat 8 px further in on each side (`.dm-box { padding: 8px }`). The box keeps its
  // top padding, which is what puts "Direct messages" 23 px below the tabs; the lobby's framed Messages box keeps all of its.
  // DECLARED (the cascade's resolved values); the widths and the 23 px are MEASURED in Chromium at 360, 390 and 1400, at `ddjp_681`.
  {
    const S = require("./_screen-world.js");
    const T0 = 1700000000000, MIN = 60 * 1000;
    const people = []; for (let i = 0; i < 3; i++) people.push({ userId: "@p" + i + ":hs", lastTs: T0, acts: 1 });
    const fold = { people, requestedWindowMs: 60 * MIN, effectiveWindowMs: 60 * MIN, reach: 90 * MIN, bounded: false };
    const convs = [{ userId: "@ann:hs", lastTs: T0 - 3 * MIN, roomIds: ["!dm1:hs"], roomId: "!dm1:hs" },
                   { userId: "@bob:hs", lastTs: T0 - 2 * MIN, roomIds: ["!dm2:hs"], roomId: "!dm2:hs" }];
    let openId = null;
    const ws = S.world({ features: {
      Room: { presenceView: () => fold, recentlyActive: () => fold, rankLadder: () => [], getMyId: () => "@me:hs",
        getRoster: () => people.map((x) => ({ userId: x.userId, level: 0 })), peopleOrder: (f, roster) => roster.map((m) => ({ member: m, active: true })) },
      Actions: { describe: () => ({ enabled: false, reason: "Not permitted" }) }, ChatPrefs: { layout: () => "wide", setLayout: () => {} },
      Chat: { conversations: () => convs.slice(), dmUnreadCount: () => 0, setDMVisible: () => {}, dmInvites: () => [],
        openDMRoom: (id) => { openId = id; return { ok: true, roomId: id }; }, currentDM: () => openId, currentDMPerson: () => (openId ? "@ann:hs" : ""),
        backfillDM: () => Promise.resolve({ messages: [{ id: "$m1", sender: "@ann:hs", body: "hello", ts: T0 }] }),
        closeDM: () => { openId = null; }, dmCaughtUp: () => {}, setDMLive: () => {}, mentions: () => false } } });
    ws.H.buildMainDom(ws.main, { roomId: "!room:hs", spaceId: "!space:hs", name: "Test room" });
    ws.sb.Panels.renderActivePanel();
    ws.sb.Roster.renderRoster();
    ws.sb.ChatPanels.renderDMPanel();
    const R = ws.refs;
    const kids = (n) => (n && n.children ? n.children.filter((c) => c.nodeType === 1) : []);
    const deep = (n) => { const out = []; (function go(x) { for (const c of kids(x)) { out.push(c); go(c); } })(n); return out; };
    const cl = (n, c) => !!n && String(n.className || "").split(/\s+/).indexOf(c) >= 0;
    const find = (root, c) => deep(root).filter((n) => cl(n, c));
    const up = (n) => { const out = []; for (let p = n; p; p = p.parent || p.parentNode || null) out.push(p); return out; };
    // One side of a box property, as the cascade resolves it: the longhand or the shorthand, whichever wins (`!important`, then
    // specificity, then order); a shorthand's 1–4 values read as CSS reads them; anything but a px length (or 0) is refused.
    const PX = (v) => { const t = String(v).trim(); if (t === "0") return 0; const m = t.match(/^(-?\d+(?:\.\d+)?)px$/); return m ? parseFloat(m[1]) : NaN; };
    const side = (n, prop, which) => {
      const lh = ws.cas.declared(n, prop + "-" + which), sh = ws.cas.declared(n, prop);
      const beats = (a, b) => !b || (a.imp || 0) > (b.imp || 0) || ((a.imp || 0) === (b.imp || 0) && (a.spec > b.spec || (a.spec === b.spec && a.order > b.order)));
      if (lh && beats(lh, sh)) return prop === "border" ? (PX(String(lh.val).split(/\s+/).find((x) => /px$|^0$/.test(x)) || "0")) : PX(lh.val);
      if (!sh) return 0;
      if (prop === "border") { if (/^none\b/.test(sh.val)) return 0; const w1 = String(sh.val).split(/\s+/).find((x) => /px$|^0$/.test(x)); return w1 ? PX(w1) : 0; }
      const v = String(sh.val).trim().split(/\s+/);
      const pick = { top: 0, right: v.length > 1 ? 1 : 0, bottom: v.length > 2 ? 2 : 0, left: v.length > 3 ? 3 : (v.length > 1 ? 1 : 0) }[which];
      return v[pick] === "auto" ? 0 : PX(v[pick]);
    };
    // How far in from the shared panel `n`'s box sits on each side: its own side margins, and every ancestor's below the shared
    // one — margin, border and padding.
    const shared = (a, b) => { const ua = up(a), ub = up(b); return ua.find((x) => ub.indexOf(x) >= 0) || null; };
    const inset = (n, top) => {
      const l = [side(n, "margin", "left")], r = [side(n, "margin", "right")];
      for (const p of up(n).slice(1)) { if (p === top) break;
        l.push(side(p, "margin", "left"), side(p, "border", "left"), side(p, "padding", "left"));
        r.push(side(p, "margin", "right"), side(p, "border", "right"), side(p, "padding", "right")); }
      const sum = (xs) => xs.reduce((s, x) => s + x, 0);
      return [sum(l), sum(r)];
    };
    const chatComposer = R.chatInput ? up(R.chatInput).find((n) => cl(n, "chat-input-row")) : null;
    const person = R.rosterBox ? find(R.rosterBox, "person")[0] : null;
    const dmHead = find(R.dmBox, "dm-head")[0], dmSearch = find(R.dmBox, "dm-search")[0], dmRows = find(R.dmBox, "dm-row");
    ok(R.chatBox && chatComposer && person && dmHead && dmSearch && dmRows.length === 2,
      "W PREMISE — the real main screen drew the Chat tab's box and composer, People's rows, and the DM list: its heading, search box and two conversations",
      { chat: !!R.chatBox, composer: !!chatComposer, person: !!person, head: !!dmHead, search: !!dmSearch, rows: dmRows.length });
    if (R.chatBox && chatComposer && person && dmHead && dmSearch && dmRows.length) {
      const top = shared(R.chatBox, R.dmBox);
      ok(top && up(person).indexOf(top) >= 0 && up(R.dmBox).indexOf(top) >= 0,
        "W PREMISE — the Chat box, People's rows and the DM box share the side panel, read from it", top && top.className);
      const ref = inset(R.chatBox, top);
      const all = [["the Chat composer", chatComposer], ["People's first row", person], ["the DM heading", dmHead], ["the DM search box", dmSearch]]
        .concat(dmRows.map((n, i) => ["DM row " + (i + 1), n])).map(([k, n]) => [k, inset(n, top)]);
      ok(ref.every((x) => !Number.isNaN(x)) && all.every(([, v]) => v[0] === ref[0] && v[1] === ref[1]),
        "W: THE DM LIST'S HEADING, SEARCH BOX AND ROWS SIT AS FAR IN AS THE CHAT TAB'S BOX AND PEOPLE'S ROWS, ON BOTH SIDES — they were 8 px " +
        "further in (DECLARED, the cascade; MEASURED in Chromium: 21–339 at 360, 21–369 at 390, 976.88–1375 at 1400)", { chat: ref, others: all });
      const padTop = side(R.dmBox, "padding", "top");
      ok(padTop === 8 && side(R.dmBox, "padding", "left") === 0 && side(R.dmBox, "padding", "right") === 0,
        "W: THE BOX LOSES ITS SIDE PADDING AND KEEPS ITS TOP 8 PX, so \"Direct messages\" stays 23 px below the tabs and 15 px above the " +
        "search box (DECLARED; MEASURED in Chromium)", { top: padTop, left: side(R.dmBox, "padding", "left"), right: side(R.dmBox, "padding", "right") });
      // AN OPEN CONVERSATION: drawn in the same box, so its head, its messages box and its composer sit where the Chat tab's do.
      ws.sb.ChatPanels._openDMFromAction("!dm1:hs");
      for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
      const cHead = find(R.dmBox, "dm-head")[0], cMsgs = find(R.dmBox, "dm-msgs")[0], cComp = find(R.dmBox, "dm-input-row")[0];
      ok(cl(R.dmBox, "dm-convo") && cHead && cMsgs && cComp && cl(cMsgs, "chat-messages"),
        "W PREMISE — the conversation opened in the same box: its head, chat's own messages box and its composer", { convo: cl(R.dmBox, "dm-convo"), head: !!cHead, msgs: !!cMsgs, comp: !!cComp });
      if (cHead && cMsgs && cComp) {
        const conv = [["the conversation's head", cHead], ["its messages box", cMsgs], ["its composer", cComp]].map(([k, n]) => [k, inset(n, top)]);
        ok(conv.every(([, v]) => v[0] === ref[0] && v[1] === ref[1]) && JSON.stringify(inset(cComp, top)) === JSON.stringify(inset(chatComposer, top)),
          "W: AN OPEN CONVERSATION'S HEAD, MESSAGES BOX AND COMPOSER SIT AS FAR IN AS THE CHAT TAB'S BOX AND COMPOSER (DECLARED; MEASURED in Chromium)",
          { chat: ref, conversation: conv });
      }
      // THE LOBBY'S MESSAGES BOX, framed on its own (`#lobby-dm`), keeps its padding on every side: nothing in it touches its frame.
      const host = S.mk("div", ws.doc); host.id = "lobby-dm"; ws.main.appendChild(host);
      ws.sb.ChatPanels.openLobbyDM(host);
      const lb = kids(host)[0];
      ok(lb && cl(lb, "lobby-dm-box") && ["top", "right", "bottom", "left"].every((k) => side(lb, "padding", k) === 8),
        "W: THE LOBBY'S MESSAGES BOX KEEPS ITS 8 PX ON EVERY SIDE — the change is the room panel's only (`.dm > .dm-box`)",
        lb && ["top", "right", "bottom", "left"].map((k) => side(lb, "padding", k)));
    }
  }

  console.log("[dm-convo] PASS — a DM conversation behaves like room chat (" + asserts + " assertions), driven through `ui/chat.js` " +
    "loaded WHOLE and the real `features/chat.js`: its list is chat's own `chat-messages` box and the outer panel does not scroll; " +
    "a message arriving — another person's, or the echo of my own — repaints the list and NEVER replaces the input, so focus and " +
    "a half-typed message survive; sending empties the field at once and asks for focus, by Enter or by the Send button; a failed " +
    "send puts the text back; the list follows the newest message and leaves a reader who scrolled up where they are. Until this " +
    "guard no test ran the conversation view at all. AND (J136) the room's DM panel — heading, search box, rows, an open conversation's head, " +
    "messages box and composer — sits as far in as the Chat tab's box and People's rows, its top padding kept and the lobby's box untouched. " +
    "THIS GUARD CANNOT SEE THE BOX OR A BROWSER'S FOCUS");
  process.exit(0);
})().catch((e) => fail("threw — " + ((e && e.stack) || e)));
