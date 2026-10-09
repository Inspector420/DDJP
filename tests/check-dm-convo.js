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

  console.log("[dm-convo] PASS — a DM conversation behaves like room chat (" + asserts + " assertions), driven through `ui/chat.js` " +
    "loaded WHOLE and the real `features/chat.js`: its list is chat's own `chat-messages` box and the outer panel does not scroll; " +
    "a message arriving — another person's, or the echo of my own — repaints the list and NEVER replaces the input, so focus and " +
    "a half-typed message survive; sending empties the field at once and asks for focus, by Enter or by the Send button; a failed " +
    "send puts the text back; the list follows the newest message and leaves a reader who scrolled up where they are. Until this " +
    "guard no test ran the conversation view at all. THIS GUARD CANNOT SEE THE BOX OR A BROWSER'S FOCUS");
  process.exit(0);
})().catch((e) => fail("threw — " + ((e && e.stack) || e)));
