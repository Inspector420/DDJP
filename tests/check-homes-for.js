// tests/check-homes-for.js
// SUBJECT: tools/homes-for.js
// WALL: the drain tool finds an entry's rules, and says which of them live nowhere else.
//
// SMALL ON PURPOSE (`ddjp_617`). `tools/homes-for.js` was the guard `check-rule-homes`; it is a tool now, run on an
// entry before it is deleted (`HANDOVER.md` §5 rule 6). What would make it lie quietly is held here, on a fixture
// roadmap and the live corpus:
//   EXTRACTOR  a short bold label followed by a bold rule sentence: the sentence is a claim, the prose between is not
//              (the delimiter desync the tool's header describes).
//   MATCHER    a claim built from the live corpus resolves; one built from words no file contains does not.
//   ENTRY      both entry shapes are found and bounded at the next entry, and the entry is not its own home.
"use strict";
const fs = require("fs");
const path = require("path");
const H = require(path.join(__dirname, "..", "tools", "homes-for.js"));

let failed = 0;
function ok(c, msg, got) {
  if (c) return;
  failed++;
  console.log("[homes-for] FAIL — " + msg + (got === undefined ? "" : "\n      got " + JSON.stringify(got).slice(0, 500)));
}

// ── EXTRACTOR ───────────────────────────────────────────────────────────────────────────────────────────────────────
const FIX = "**Kind.** `x`. **Off the gate** — the conditional in the old field is resolved here, so nothing was waiting. " +
  "**A sentence that states a rule and must be examined.**";
const got = H.claimsIn(FIX);
ok(got.length === 1 && /^A sentence that states a rule/.test(got[0]),
  "the bold sentence after a short label must be the one claim, and the unbolded prose between must not be one: the " +
  "extractor has stopped pairing its delimiters, so a rule in that position would be drained unexamined", got);

// ── MATCHER, on the live corpus ─────────────────────────────────────────────────────────────────────────────────────
const DOCS = H.docsRoot();
ok(!!DOCS, "APPLIED — a doc tree with main/09-roadmap.md sits beside this one");
if (DOCS) {
  const rel = path.join("main", "09-roadmap.md");
  const roadmap = fs.readFileSync(path.join(DOCS, rel), "utf8");
  const id = (roadmap.match(/^#### (J\d+)\b/m) || [])[1];
  const entry = id && H.entryText(roadmap, id);
  ok(!!entry, "APPLIED — the roadmap has an entry to build the corpus around", id);
  if (entry) {
    const corpus = H.corpusFor(DOCS, rel, entry);
    const resolves = H.matcher(corpus);
    const words = H.norm(corpus).split(" ");
    let homed = null;
    for (let i = 1000; i + 8 <= words.length && !homed; i++) if (words.slice(i, i + 8).every((w) => /^[a-z]{3,}$/.test(w))) homed = words.slice(i, i + 8).join(" ");
    const nonce = (987654321).toString(36);
    const lost = ["q", "x", "y", "w", "v", "u", "t"].map((c) => c + nonce).join(" ");
    const own = H.claimsIn(entry.text).find((c) => !resolves(c)) || null;
    ok(homed !== null && resolves(homed) && !resolves(lost),
      "a claim from the corpus must resolve and one from words no file contains must not: a matcher that resolves " +
      "everything, or nothing, makes every list it prints meaningless", { homed, resolvesHomed: resolves(homed), resolvesLost: resolves(lost) });
    // ── ENTRY: both shapes, bounded, and not its own home ──────────────────────────────────────────────────────────
    const fx = "#### J901 — a heading entry\n\n**A rule that this heading entry states for the test.**\n\n" +
      "**J902 — a prose entry.** **A rule that this prose entry states for the test.**\n\n## 7. Decisions already made\n";
    const a = H.entryText(fx, "J901"), b = H.entryText(fx, "J902");
    ok(a && b && /heading entry states/.test(a.text) && !/prose entry states/.test(a.text) && /prose entry states/.test(b.text) &&
       !/Decisions/.test(b.text) && corpus.indexOf(entry.text) < 0,
      "both entry shapes must be found, each bounded at the next entry or §7, and the corpus must leave out the entry " +
      "being drained, or an entry is its own rule's home", { a: a && a.text.length, b: b && b.text.length, own });
  }
}

if (failed) { console.log("[homes-for] " + failed + " FAILED"); process.exit(1); }
console.log("[homes-for] PASS — the drain tool pairs its delimiters, its matcher resolves a claim from the corpus and " +
  "refuses one from nowhere, and it finds and bounds both entry shapes without counting an entry as its own home.");
