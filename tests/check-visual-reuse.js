// tests/check-visual-reuse.js
// WALL: THREE VISUAL CORRECTIONS, EACH BY REUSING AN EXISTING RULE RATHER THAN ADDING A FOURTH.
//
// Three browser findings, and the shared property is that every one of them ALREADY had a
// precedent in this file. What this guard pins is not "it looks right" — a guard cannot see that —
// but that the precedent is genuinely being reused and has not been quietly re-declared beside.
//
//   PART A — the header back button borrows `copy-btn icon-only`. Both dimensions explicit; the
//     other `.back-btn` caller is untouched; the dead `collapsed` rung is gone.
//   PART B — ONE marquee, two targets. `_fitMarquee` is generalised, not copied, and its per-fit
//     state is per-element so two targets cannot cancel each other's frame.
//   PART C — the DM composer carries the chat panel's classes, and the duplicated declarations
//     are gone rather than left alongside.
//
// ── WHAT THIS GUARD CANNOT DO, STATED SO IT IS NOT MISTAKEN FOR COVERAGE ────────────────────
// It cannot tell you any of this LOOKS right. CSS cascade order, computed widths, ResizeObserver
// and `@keyframes` are browser machinery and the harness has none of it. **A title that scrolls
// correctly in a sandbox proves nothing.** `README.md` carries what only a browser can answer.

const fs = require("fs");
const path = require("path");

let asserts = 0;
function fail(msg, got) {
  console.log("[visual-reuse] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");
const ui = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
const uiCode = ui.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

// A CSS rule's declarations, read from the stylesheet rather than from a comment about it.
function ruleOf(selector) {
  const i = html.indexOf("\n    " + selector + " {");
  if (i < 0) return null;
  const open = html.indexOf("{", i);
  const close = html.indexOf("}", open);
  if (close < 0) return null;
  const body = html.slice(open + 1, close);
  const out = {};
  for (const part of body.split(";")) {
    const c = part.indexOf(":");
    if (c < 0) continue;
    out[part.slice(0, c).trim()] = part.slice(c + 1).trim();
  }
  return { at: i, decls: out };
}

// ═══ PART A — THE BACK BUTTON BORROWS THE COPY BUTTON'S SHAPE ════════════════════════════════
{
  const icon = ruleOf(".copy-btn.icon-only");
  ok(!!icon, "A: APPLIED — `.copy-btn.icon-only` must exist to be the precedent", "not found");
  for (const d of ["width", "height", "display", "align-items", "justify-content"]) {
    ok(icon.decls[d] !== undefined,
      "A: APPLIED — the precedent declares `" + d + "`, which is what makes it square and centred " +
      "rather than sized by its glyph", Object.keys(icon.decls));
  }
  ok(icon.decls.width === icon.decls.height,
    "A: and its two dimensions are EQUAL — the property the back button was missing, which is why " +
    "a box sized by the arrow's line-height came out oblong", 
    { w: icon.decls.width, h: icon.decls.height });

  // TWO CALLERS, AND ONLY ONE CHANGED.
  const callers = [...uiCode.matchAll(/class: "back-btn([^"]*)", text: "([^"]*)"/g)]
    .map((m) => ({ extra: m[1].trim(), text: m[2] }));
  ok(callers.length === 2,
    "A: APPLIED — there must be exactly two `.back-btn` callers, or 'only one changed' is a claim " +
    "about a population this guard cannot see", callers);
  const arrowOnly = callers.filter((c) => c.text === "\\u2190" || c.text === "\u2190");
  const worded = callers.filter((c) => /Rooms/.test(c.text));
  ok(arrowOnly.length === 1 && worded.length === 1,
    "A: one is the bare arrow and one has a word in it", callers);
  ok(/copy-btn/.test(arrowOnly[0].extra) && /icon-only/.test(arrowOnly[0].extra),
    "A: THE ARROW-ONLY CALLER BORROWS THE PRECEDENT rather than getting a fourth button style",
    arrowOnly[0]);
  ok(worded[0].extra === "",
    "A: AND THE WORDED CALLER IS UNTOUCHED — `← Rooms` keeps the wide pill, because a 26px square " +
    "would clip a word. Two callers were checked, not one", worded[0]);

  // SOURCE ORDER IS WHY NO NEW RULE WAS NEEDED, and it is a fact about the file rather than a
  // claim in a comment.
  const back = ruleOf(".back-btn");
  ok(!!back && back.at < icon.at,
    "A: `.back-btn` is declared BEFORE `.copy-btn.icon-only`, so at equal specificity the " +
    "precedent's box and border win on source order — which is why borrowing needed no new rule",
    { back: back && back.at, icon: icon.at });

  // THE DEAD RUNG IS GONE, both the class and the ladder step that applied it.
  ok(html.indexOf(".back-btn.collapsed {") < 0,
    "A: the `.back-btn.collapsed` rule is REMOVED. The button is a fixed square from the start, so " +
    "a rung that collapsed it had nothing to collapse — and a ladder step that does nothing reads " +
    "as one that works", "still present");
  ok(!/classList\.toggle\("collapsed"/.test(uiCode),
    "A: and nothing still toggles it", "toggle survives");
}

// ═══ PART B — ONE MARQUEE, TWO TARGETS ═══════════════════════════════════════════════════════
{
  const defs = [...uiCode.matchAll(/function\s+_fit\w*Marquee\w*\s*\(/g)].map((m) => m[0]);
  ok(defs.length === 2,
    "B: APPLIED — exactly two marquee functions: the fitter and the both-targets caller. A third " +
    "would be the copy this reuse exists to avoid", defs);
  ok(/function _fitMarquee\(boxEl, txtEl\)/.test(uiCode),
    "B: THE FITTER TAKES ITS TARGET rather than naming one. A second implementation of a rule is " +
    "the category this tree has recorded five times — `_dmFoldMessage` was the last, where a " +
    "comment claiming parity stood in for the rule and a state change never reached the copy",
    "not parameterised");

  const body = uiCode.slice(uiCode.indexOf("function _fitMarquee(boxEl, txtEl)"));
  const fn = body.slice(0, body.indexOf("\n  }\n") + 4);
  ok(/const box = boxEl \|\| refs\.videoTitle/.test(fn),
    "B: defaulting to the original target, so every existing caller keeps working unchanged", fn.slice(0, 200));
  ok(/@keyframes/.test(fn) && /_marqueeSeq/.test(fn),
    "B: APPLIED — the unique-keyframe-name fix is inside the ONE implementation, which is what a " +
    "copy would have inherited a snapshot of", "missing");

  // THE PER-FIT STATE IS PER-ELEMENT. A shared frame handle would have let one target's fit
  // cancel the other's — a bug a copy would ALSO have had, arriving by a different route.
  ok(/box\._marqueeRaf/.test(fn),
    "B: the pending-frame handle lives ON THE ELEMENT, so two targets fitting at once cannot " +
    "cancel each other's frame", "shared handle");
  ok(!/[^.]\b_marqueeRaf\b/.test(fn.replace(/box\._marqueeRaf/g, "")),
    "B: and no module-level handle survives inside it", "module handle survives");

  // TWO OBSERVERS, because the two boxes reflow for different reasons.
  ok(/_roomTitleRo = new ResizeObserver/.test(uiCode) && /_marqueeRo = new ResizeObserver/.test(uiCode),
    "B: each target has its OWN ResizeObserver — the header reflows for reasons (the fit ladder, " +
    "a rank badge appearing) that never touch the video title's box", "shared observer");

  // THE ROOM TITLE HAS THE SHAPE THE MARQUEE NEEDS.
  ok(/refs\.roomTitleText = el\("span"/.test(uiCode) && /refs\.roomTitle = el\("h2"[^\n]*roomTitleText/.test(uiCode),
    "B: the room title is a clipping BOX with an inner text node — the same shape the video title " +
    "has, because the marquee translates the TEXT inside the BOX and a bare `<h2>` has nothing to " +
    "move", "wrong shape");
  const rt = ruleOf(".room-title");
  ok(rt && rt.decls.overflow === "hidden" && /nowrap/.test(rt.decls["white-space"] || ""),
    "B: and the box clips, or the text would simply widen it and never overflow", rt && rt.decls);
}

// ═══ PART C — THE DM COMPOSER CARRIES THE CHAT PANEL'S CLASSES ═══════════════════════════════
{
  const chatInput = ruleOf(".chat-input");
  ok(!!chatInput, "C: APPLIED — `.chat-input` must exist as the precedent", "not found");
  for (const d of ["background", "border", "color", "padding", "font-size"]) {
    ok(chatInput.decls[d] !== undefined,
      "C: APPLIED — the precedent declares `" + d + "`, which is exactly what `.dm-input` lacked " +
      "and why it rendered as a browser-default white box on a dark panel", Object.keys(chatInput.decls));
  }

  const dmInput = ruleOf(".dm-input");
  ok(!!dmInput, "C: APPLIED — `.dm-input` must still exist for its own declarations", "not found");
  for (const d of ["background", "border", "color", "padding", "font-size"]) {
    ok(dmInput.decls[d] === undefined,
      "C: `.dm-input` does NOT re-declare `" + d + "` — the borrowed rule supplies it, and two " +
      "descriptions of one appearance drift the next time either is touched", dmInput.decls);
  }

  ok(/class: "dm-input chat-input"/.test(uiCode),
    "C: the field carries BOTH — `dm-input` for what is particular to a DM composer, `chat-input` " +
    "for everything a composer is", "not borrowed");
  ok(/class: "dm-input-row chat-input-row"/.test(uiCode),
    "C: AND SO DOES THE ROW, which is what styles the Send button — `.dm-input-row button` had no " +
    "rule at all, so Send was a bare default button", "row not borrowed");
  ok(!!ruleOf(".chat-input-row button"),
    "C: APPLIED — and that button rule exists to be borrowed", "no button rule");
  ok(html.indexOf(".dm-input-row button {") < 0,
    "C: with no `.dm-input-row button` rule added beside it", "duplicate added");

  // THE NAME COLOUR: one rule, not two.
  // ── SUBSUMED BY A STRONGER PROPERTY (v274) ────────────────────────────────────────────────
  // This pinned that a DM sender name BORROWED the chat panel's `sender` class — a fix for one
  // element of a row that was otherwise a second implementation of the chat row. **The two row
  // builders are now one**, so the DM sender is not borrowing the class, it IS the chat row's
  // sender span. Asserting the borrow would be asserting that the duplicate still exists.
  //
  // The property is inverted and strengthened: there is ONE builder, and the DM thread calls it.
  ok(!/class: "dm-sender sender"/.test(uiCode),
    "C: the DM thread no longer builds its own sender span — the duplicate row builder is gone " +
    "rather than borrowing one class from the original", "the duplicate survives");
  ok(/_chatRow\(msgs, m, \{ rowClass: "dm-msg", onDelete: _deleteDMMessage \}\)/.test(uiCode),
    "C: AND THE DM THREAD CALLS `_chatRow` — one builder, two surfaces, so avatars, the live " +
    "avatar refresh, tombstones and anything added later arrive in both without a second edit. " +
    "The seventh copied-rule instance, and the second in DMs after `_dmFoldMessage`", "not merged");
  ok(/function _chatRow\(box, record, opts\)/.test(uiCode),
    "C: parameterised rather than branched — what differed between the two was WHICH delete " +
    "function and WHICH row class, and both are arguments", "not parameterised");
  const dmSender = ruleOf(".dm-sender");
  ok(dmSender && dmSender.decls.color === undefined,
    "C: and `.dm-sender` no longer declares a colour, so ONE rule decides what a name looks like " +
    "in this app rather than two that disagreed (#9CA3AF against #5865F2)", dmSender && dmSender.decls);
  ok(dmSender && dmSender.decls["flex-shrink"] !== undefined,
    "C control: while keeping the one thing a DM row needs that a chat row does not — so the rule " +
    "was narrowed rather than deleted", dmSender && dmSender.decls);
}

console.log("[visual-reuse] PASS — three visual corrections, each by reusing an existing rule " +
  "rather than adding a fourth (" + asserts + " assertions). The back button borrows " +
  "`copy-btn icon-only`, whose two dimensions are EQUAL — the property it was missing, since " +
  "`.back-btn.collapsed` set a width and no height and let the arrow's line-height decide the " +
  "box. BOTH callers were checked and only one changed: `← Rooms` keeps the wide pill because a " +
  "26px square would clip a word. The dead `collapsed` rule AND the ladder rung that applied it " +
  "are gone, because a step that does nothing reads as one that works. ONE marquee serves two " +
  "targets — parameterised, not copied, with its pending-frame handle moved ONTO THE ELEMENT so " +
  "two targets cannot cancel each other's frame, and an observer each because the two boxes " +
  "reflow for different reasons. And the DM composer carries `chat-input` / `chat-input-row` / " +
  "`sender`, with the duplicated declarations REMOVED rather than left alongside. **THIS GUARD " +
  "CANNOT TELL YOU ANY OF IT LOOKS RIGHT** — cascade order, computed widths, ResizeObserver and " +
  "keyframes are browser machinery the harness does not have, and a title that scrolls in a " +
  "sandbox proves nothing. README.md carries what only a browser can answer");
