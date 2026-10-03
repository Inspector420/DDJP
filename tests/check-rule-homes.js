// tests/check-rule-homes.js
// SUBJECT: docs/main/09-roadmap.md
//
// WALL: an entry declared REHOMED must have every one of its rules living somewhere else.
//
// ── THE FAILURE THIS EXISTS FOR, WHICH HAPPENED ─────────────────────────────────────────────
// Twenty-four closed entries in §6 were compressed to stubs on a probe: does every backticked
// identifier in the entry resolve elsewhere in `docs/` or the code? All twenty-four scored 100%.
// **The probe was measuring the wrong thing.** Identifiers resolve because an entry names files
// and functions that obviously still exist. The RULE an entry established is prose, and prose does
// not resolve.
//
// A second pass over the same bodies — testing whether each entry's bold CLAIM SENTENCES survived
// anywhere else — found 57 claims across 19 of the 24 that exist nowhere but the entry, several of
// them standing rules rather than narrative:
//
//     "a guard's message is not evidence of what it checked"   (J01)
//     "compare by name, never by number"                        (J07)
//     "key, not value, is the axis that decides cost"           (J10)
//     "the redaction target is not in the obvious field"        (J11)
//
// All twenty-four bodies were restored. **THE SUITE WAS GREEN THROUGH ALL OF IT** — 175 verdicts,
// three separate deletions, and nothing anywhere checked that a rule still had a home. That is the
// hole this file closes.
//
// ── WHY IT CHECKS THE NARROW THING AND NOT THE OBVIOUS ONE ──────────────────────────────────
// The obvious rule — *every claim in every closed entry resolves elsewhere* — is RED ON ARRIVAL,
// because 57 do not, and that is the work rather than a defect. A count that may only fall is
// worse: a new closed entry legitimately introduces new rules, so a falling-only count would fail
// honest work and teach the next session to route around it.
//
// So the checkable property is the one that was actually violated: **a claim of rehoming must be
// true.** Write `**Rehomed.**` on an entry and every claim in it must resolve outside this file.
// Until then the entry is untouched and unjudged, and the unhomed count rides in the PASS line as
// a WORKLIST rather than an assertion. Same shape as `check-guard-subject`: the guard cannot tell
// you a rule found the RIGHT home, only that the words are somewhere a reader will meet them.
//
// ── AND IT IS NOT VACUOUS ON ARRIVAL, WHICH IS THE POINT ────────────────────────────────────
// A rule nothing has opted into yet is a rule that passes by never running, and this suite has
// shipped that twice. So three entries are marked `**Rehomed.**` in the same change — J03, J13 and
// J26, chosen because MEASUREMENT says every claim in them already resolves elsewhere, not because
// they looked safe. The gate below runs against fourteen real claims from the first commit.

const fs = require("fs");
const path = require("path");
const { ROOT, docPaths, searchedFor } = require("./_docs.js");

let failed = 0;
function ok(cond, msg) { if (!cond) { console.log("[rule-homes] FAIL — " + msg); failed++; } }

function readDoc(rel) {
  for (const p of docPaths(rel)) if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  return null;
}
const rm = readDoc("main/09-roadmap.md");
ok(rm !== null, "09-roadmap.md is not in any of the places the tree puts it — the docs ship WITH " +
   "the tree, as siblings. Looked in: " + searchedFor("main/09-roadmap.md"));
if (rm === null) { console.log("[rule-homes] 1 failure(s)"); process.exit(1); }

// EVERYWHERE ELSE A RULE COULD LIVE: the rest of the doc tree, and every comment in the app.
// Code counts because this project puts its reasoning in module headers by design — half of the
// tree is comment — so a rule rehomed into `streammanager.js` HAS found a home.
let elsewhere = "";
for (const rel of ["", "main", "consensus", "reference"]) {
  for (const base of docPaths(rel)) {
    if (!fs.existsSync(base)) continue;
    for (const f of fs.readdirSync(base)) {
      if (!f.endsWith(".md") || f === "09-roadmap.md") continue;
      elsewhere += fs.readFileSync(path.join(base, f), "utf8");
    }
  }
}
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === "node_modules") continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith(".js")) elsewhere += fs.readFileSync(p, "utf8");
  }
}
for (const d of ["core", "features", "ui", "backends", "tests", "tools"]) walk(path.join(ROOT, d));

const norm = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const HAY = norm(elsewhere);

// A claim resolves if any distinctive five-word run of it appears elsewhere. Five because shorter
// runs match common phrasing and longer ones miss a rule that was reworded on the way to its home —
// the question is whether a READER MEETS THE RULE, not whether the sentence was copied.
function resolves(claim) {
  const w = norm(claim).split(" ");
  if (w.length < 6) return true;
  for (let i = 0; i + 5 <= w.length; i++) if (HAY.includes(w.slice(i, i + 5).join(" "))) return true;
  return false;
}

// ── PAIR THE DELIMITERS; DO NOT LENGTH-SCAN FOR THEM ────────────────────────────────────────
// This extractor used to be `/\*\*([^*]{30,140})\*\*/g`, which does not pair `**` marks at all: it
// looks for an opener followed by 30-140 non-`*` characters. A bold span SHORTER than the lower
// bound fails that match, so the scan resumed at the span's CLOSING `**` and treated it as an
// opener. Two consequences, both driven in the gate below. The plain prose after a short label was
// reported as a claim that nobody wrote; and the genuinely bold sentence after THAT was consumed
// as a closing delimiter and never examined at all. Every field label in the roadmap is under
// thirty characters, so this fired throughout the file.
//
// It is the failure this guard exists to catch, reappearing inside the guard: an entry marked
// `**Rehomed.**` is checked only against what this function returns, so a rule the desync hid
// could be drained with the entry while the suite stayed green. `**Rehomed.**` is itself an
// eight-character span, which means the act of declaring an entry done moved what this function
// could see in the rest of that entry. Recorded in `FAILURE-SIGNATURES.md`.
//
// So: split on the delimiter, take the odd segments, and apply length as a FILTER afterwards.
// The old `FIELD` list is deleted rather than carried over. It existed to suppress a string that
// only ever appeared as desync output, and re-measured against correct pairing it dropped two real
// rule sentences (in J13 and J17) whose first word happened to be a field name, while the three
// entry headings it was credited with dropping are all caught by the version test below.
function claimsIn(body) {
  const out = [];
  const parts = body.split("**");
  for (let i = 1; i < parts.length; i += 2) {
    const c = parts[i].replace(/`/g, "").trim();
    if (c.length < 30 || c.length > 140) continue;
    if (/\b(DONE|done)\s*\(v\d+/.test(c) || c.split(/\s+/).length < 6) continue;
    out.push(c);
  }
  return out;
}

const lines = rm.split("\n");
const heads = [];
for (let i = 0; i < lines.length; i++) if (/^#### /.test(lines[i])) heads.push(i);

let entries = 0, claimsSeen = 0, resolved = 0, rehomed = 0, checkedRehomed = 0;
const worklist = [];

for (let k = 0; k < heads.length; k++) {
  const m = lines[heads[k]].match(/^#### (J\d+)\b/);
  if (!m || !/\b(DONE|done)\b/.test(lines[heads[k]])) continue;
  // BOUNDED AT THE NEXT J-ENTRY, NEVER THE NEXT `####`. `####` marks an entry AND that entry's own
  // sub-headings, so cutting to the next `####` stops at the entry's first sub-heading and leaves
  // its body attributed to nothing. That mistake orphaned 331 lines of J17 before this was written.
  let end = lines.length;
  // A STANDALONE RECORD IS A BOUNDARY TOO. Bounding only at the next `#### J` made J16 swallow the
  // `Findings from the J38/J39/J40 sweeps` record and the version index that follow it — 111 claims
  // attributed to a 41-line entry. `####` is used for entries, for their sub-headings, AND for
  // standalone records, and no regex separates the last two: a sub-heading belongs to its entry, a
  // record does not, and they are written identically. The two that exist are named here, and a new
  // one must be added or its claims land on whichever entry precedes it.
  const RECORD = /^#### (Findings from|Session records are not kept)/;
  // AND A PROSE-SHAPED ENTRY IS A BOUNDARY: `**Jnn — ` at the start of a line, the second of the two
  // entry shapes `journal/entry-list.js` reads. Bounding at `#### J` alone let a closed `####` entry
  // swallow every prose entry after it. Found at `ddjp_415`: J40, marked DONE, acquired the prose
  // entries from J42 to J57 — 204 claims that were not its own — and J57's literal `**Rehomed.**`
  // with them, so it failed as an entry claiming a rehoming it never claimed. While J40 was open it
  // was skipped, which is why nothing showed: marking a job done changed what this guard could see.
  // The census drew this boundary correctly all along; two readers of one file must draw it alike.
  const PROSE_ENTRY = /^\*\*J\d+ — /;
  for (let j = heads[k] + 1; j < lines.length; j++) {
    const L = lines[j];
    if (/^#### J\d+\b/.test(L) || RECORD.test(L) || PROSE_ENTRY.test(L)) { end = j; break; }
  }
  if (end === lines.length) for (let j = heads[k] + 1; j < lines.length; j++) if (/^## /.test(lines[j])) { end = j; break; }

  const body = lines.slice(heads[k], end).join("\n");
  const isRehomed = /\*\*Rehomed\.\*\*/.test(body);
  entries++;
  const cs = claimsIn(body);
  const missing = [];
  for (const c of cs) { claimsSeen++; if (resolves(c)) resolved++; else missing.push(c); }

  if (isRehomed) {
    rehomed++; checkedRehomed += cs.length;
    ok(cs.length > 0, m[1] + " declares **Rehomed.** but carries no claim this guard can check. " +
       "An entry with nothing to verify cannot be evidence that rehoming worked — remove the field " +
       "or check what the extractor is missing.");
    for (const c of missing) {
      ok(false, m[1] + " declares **Rehomed.** but this rule resolves NOWHERE outside the roadmap:\n" +
         '           "' + c.slice(0, 110) + '"\n' +
         "         Give it a home — the doc that owns the rule, or the module header it governs — " +
         "before claiming it has one. Deleting this entry now would take the rule with it.");
    }
  } else if (missing.length) worklist.push(m[1] + ":" + missing.length);
}

// ADMISSIBILITY. Every number below is a way this guard could pass by measuring nothing, and each
// has happened somewhere in this suite: a filter matching zero rows, a matcher that never matches,
// and a rule nobody has opted into.
ok(entries >= 20, "only " + entries + " closed entries found in §6 — the extractor is not reaching " +
   "the job list, so every check below is vacuous");
// THIS FLOOR IS NOT DENOMINATED IN §6's SIZE, AND THE PREVIOUS ONE WAS. It read
// `claimsSeen >= 100`, standing in for *the extractor still works*. But J57's whole job is to
// REDUCE the number of claims in §6, so every successful drain moved that count toward the failure
// and the guard would eventually read success as breakage — leaving only two exits, undo the work
// or weaken the guard. It tripped at 98, from 242 before the job started, with the file's own
// comment thirty lines above warning that a count which may only fall "would fail honest work and
// teach the next session to route around it". The proxy is therefore DELETED rather than re-tuned:
// the pairing rows below drive `claimsIn` at a fixture with a known claim count, which tests the
// extractor DIRECTLY and does not move when §6 shrinks. Recorded in `FAILURE-SIGNATURES.md`.
ok(claimsSeen > 0, "not one claim extracted from " + entries + " entries — the claim pattern has " +
   "stopped matching, and an empty claim set passes everything");
ok(resolved > 0, "not one claim resolved anywhere outside the roadmap. That is the MATCHER failing, " +
   "not the tree: the doc and code corpus is empty or normalisation broke");
ok(rehomed >= 1, "no entry declares **Rehomed.**, so the gate above never ran. A rule nothing has " +
   "opted into passes by never executing — mark an entry whose rules genuinely live elsewhere");
ok(checkedRehomed >= 5, "the **Rehomed.** entries yielded only " + checkedRehomed + " claims between " +
   "them, which is too few to be evidence the gate discriminates");

// PAIRING, DRIVEN BOTH WAYS. The bug this replaced could not be caught by any count above: it
// moved claims between "invented" and "invisible" without changing how many there were. So the
// extractor is driven at a fixture carrying the exact shape that broke it — a short bold label
// followed by prose, followed by a real bold sentence.
const FIX = "**Kind.** `x`. **Off the gate** — the conditional in the old field is resolved here, " +
            "so nothing was waiting. **A sentence that states a rule and must be examined.**";
const fixClaims = claimsIn(FIX);
ok(fixClaims.some((c) => /^A sentence that states a rule/.test(c)),
   "the bold sentence after a short label is NOT being extracted. That is the desync this " +
   "extractor was rewritten to remove: the sentence is being consumed as a closing delimiter and " +
   "never examined, so a rule in that position can be drained while this guard passes.");
ok(!fixClaims.some((c) => /^— the conditional/.test(c)),
   "prose that nobody bolded is being reported as a claim. The scan is resuming at a closing `**` " +
   "and treating it as an opener, which inflates the worklist with text no one wrote.");
ok(claimsIn("**Rehomed.** " + "z".repeat(60) + " **A rule sentence that must still be seen here.**")
     .some((c) => /^A rule sentence/.test(c)),
   "marking an entry **Rehomed.** hides the claims after it. The act of declaring a job done must " +
   "not change what the guard checking that job can see.");

if (failed) { console.log("[rule-homes] " + failed + " failure(s)"); process.exit(1); }
console.log("[rule-homes] PASS — every entry declaring **Rehomed.** has each of its rules living " +
  "somewhere a reader will meet them (" + rehomed + " entries, " + checkedRehomed + " claims verified " +
  "against " + entries + " closed entries and " + claimsSeen + " claims examined, " + resolved +
  " resolving). THE REST OF §6 IS A WORKLIST AND NOT A FAILURE: " +
  (worklist.length ? worklist.length + " entries still hold rules that exist nowhere else — " +
   worklist.join(" ") : "none outstanding") + ". This guard CANNOT tell you a rule found the RIGHT " +
  "home, only that the words are somewhere else; and it exists because three deletions removed " +
  "rules from this file while all 175 verdicts stayed green");
process.exit(0);
