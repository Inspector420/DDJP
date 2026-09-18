// tools/probes/mutate-j11-redact.js
// J13 — break each thing `check-chat-redaction` claims to pin, and watch it go red.
//
// EVERY ROW EXPECTS A CHANGE unless it is explicitly marked `expectGreen`. A mutation whose
// expected result is "nothing changes" cannot detect its own failure to apply
// (`09-roadmap.md` §8), so each row breaks something and expects the suite to notice; a row that
// stays GREEN without being marked is a finding about the GUARD, not about the tree.
//
// JOURNALLED. The edit is recorded before it is made and cleared only after the original bytes
// are back, so a run killed mid-flight leaves a recoverable tree rather than a mutated one the
// next reader measures. APPLIED-CHECKED TWICE: once when the edit lands, and again after the
// suite's result has been read — before-only is sufficient when one hand holds the tree and
// worthless when two do. Under collision a green row is VOID, not a survivor.
//
// ROW IDS ARE PER-FILE. `mutate-j15-dm.js` and `mutate-j16-active.js` both have rows in the M1x
// range about other claims; cite these as `mutate-j11-redact M4`, never as a bare `M4`. The journal
// markers (`J11M4`) are already disambiguated, so a mis-citation cannot apply the wrong edit —
// only mislead a reader.
//
// ROW-SELECTABLE, because the full suite is ~35s per row:
//   node tools/probes/mutate-j11-redact.js M1 M2 M3
// `J11_SUITE=tests/check-chat-redaction.js` narrows the runner for ATTRIBUTION ONLY — a green row
// measured that way would be a claim about one file dressed as a claim about the suite.
//
// ── THE ROWS THAT MATTER MOST ────────────────────────────────────────────────────────────────
// M3 is the one this job exists to prevent: the feed narrates events the reducer REFUSED. Nothing
// breaks, the list looks fuller, and the panel names acts nobody performed.
// M7 and M8 are the Done-when correction: collapse the two empties into one and the panel tells
// somebody their history was banked when it never existed, or that nothing has happened in a room
// whose entire history it destroyed. Both are true-of-nothing sentences that read as fact.

const path = require("path");
const { execFileSync } = require("child_process");
const J = require("./_journal.js");

const ROOT = path.resolve(__dirname, "../..");
const SUITE = process.env.J11_SUITE || "tests/run-all.js";
const NARROWED = !!process.env.J11_SUITE;

const F = {
  rm: path.join(ROOT, "features/room.js"),
  ui: path.join(ROOT, "ui/interface.js"),
  ch: path.join(ROOT, "features/chat.js"),
  cp: path.join(ROOT, "core/chatprefs.js"),
  mb: path.join(ROOT, "backends/backend1/matrixbridge.js"),
  cb: path.join(ROOT, "ui/chatbuffer.js"),
};

const ROWS = [
  // ── THE SILENT FAILURE THIS JOB EXISTS TO PREVENT ─────────────────────────────────────────
  // M1 restores the handler that looks obviously right and does nothing: the buffer refuses the
  // placeholder upsert, the message stays on screen, and NOTHING THROWS.
  { id: "M1", file: "ui", part: "A/D",
    why: "the tombstone becomes a placeholder UPSERT — the original obvious handler. The buffer " +
         "refuses it, the deleted message STAYS ON SCREEN with its text, and nothing errors",
    find: "    if (!st.buf.redact(redactedId)) return;",
    repl: '    if (!st.buf.has(redactedId)) return; st.buf.upsert(redactedId, "@x:hs", "", true, 0);   /*J11M1*/',
    marker: "J11M1", expect: 1 },

  // ── THE THIRD STATE (J11b) ────────────────────────────────────────────────────────────────
  { id: "M17", file: "cb", part: "A",
    why: "REDACTED -> REAL becomes possible — a late-decrypting body RESURRECTS a message the " +
         "author deleted. Backfill decrypts newest-first, so this is reachable, and it would look " +
         "exactly like the buffer working",
    find: "        if (prev && prev.redacted && !redacted) {\n          return { type: \"noop\", record: prev, evicted: [] };\n        }",
    repl: "        /*J11M17*/",
    marker: "J11M17", expect: 1 },

  { id: "M18", file: "cb", part: "A",
    why: "the tombstone KEEPS THE BODY, so the deleted plaintext stays in RAM and any repaint " +
         "renders it — the deletion becomes a rendering choice rather than a removal",
    find: "        body: red ? \"\" : (body == null ? \"\" : String(body)),",
    repl: "        body: body == null ? \"\" : String(body),   /*J11M18*/",
    marker: "J11M18", expect: 1 },

  // ── THE KEEP-ONE LATTICE ON REDACTION-TERMINALITY ─────────────────────────────────────────
  // TWO sites keep a tombstone a tombstone: the TERMINAL check (`prev.redacted && !redacted` ->
  // noop) and the STICKY assignment (`red = redacted || prev.redacted`). M19 came back green on
  // its first run, which is what prompted the rotation rather than a shrug.
  { id: "M19", file: "cb", part: "A",
    why: "KEEP THE TERMINAL CHECK (drop the sticky assignment) — is stickiness doing any work?",
    find: "        const red = !!redacted || !!(prev && prev.redacted);",
    repl: "        const red = !!redacted;   /*J11M19*/",
    marker: "J11M19", expect: 1, expectGreen: true },

  { id: "M19b", file: "cb", part: "A",
    why: "DROP BOTH — the floor. A red here with M19 green identifies the terminal check as the " +
         "sole enforcement and stickiness as dominated by it",
    find: "        if (prev && prev.redacted && !redacted) {\n          return { type: \"noop\", record: prev, evicted: [] };\n        }",
    repl: "        /*J11M19b-a*/",
    find2: "        const red = !!redacted || !!(prev && prev.redacted);",
    repl2: "        const red = !!redacted;   /*J11M19b*/",
    marker: "J11M19b", expect: 1 },

  { id: "M19c", file: "cb", part: "A",
    why: "CONTROL — adjacent to the subjects: drop `keepTs` on the same update branch. A red here " +
         "proves the suite reaches and evaluates this branch, which is what makes M19's green a " +
         "reading of domination rather than an unexercised path",
    find: "        const keepTs = (prev && prev.ts) ? prev.ts : (Number(ts) || 0);",
    repl: "        const keepTs = Number(ts) || 0;   /*J11M19c*/",
    marker: "J11M19c", expect: 1 },

  { id: "M20", file: "cb", part: "A",
    why: "a redaction CLEARS `failed`, so a row hidden as undecryptable becomes a visible " +
         "tombstone — a deletion causing a row to APPEAR, which is backwards",
    find: "        const nextFailed = red && prev ? !!prev.failed : !!failed;",
    repl: "        const nextFailed = !!failed;   /*J11M20*/",
    marker: "J11M20", expect: 1 },

  { id: "M21", file: "cb", part: "A",
    why: "REAL -> FAILED is admitted again — J12's rule gone, so a decryption placeholder " +
         "clobbers real text. The rule the third state was added to AVOID relaxing",
    find: "        if (prev && prev.failed === false && failed && !redacted) {",
    repl: "        if (false) {   /*J11M21*/",
    marker: "J11M21", expect: 1 },

  { id: "M22", file: "cb", part: "A",
    why: "the tombstone is a REMOVE-AND-REINSERT instead of a mutation, so the row jumps to the " +
         "front of the list — the clobber that ruled a tombstone out the first time",
    find: "      const prev = msgs.get(id);\n      upsert(id, prev.sender, \"\", prev.failed, prev.ts, true);\n      return true;",
    repl: "      const prev = msgs.get(id);\n      remove(id);\n      upsert(id, prev.sender, \"\", prev.failed, 0, true);   /*J11M22*/\n      return true;",
    marker: "J11M22", expect: 1 },

  { id: "M23", file: "ui", part: "D",
    why: "the tombstone is not RENDERED — the row keeps its old content, so a deleted message " +
         "still shows its text until something else repaints",
    find: "        node.replaceWith(_chatRow(box, rec));",
    repl: "        /*J11M23*/",
    marker: "J11M23", expect: 1 },

  { id: "M24", file: "ui", part: "D",
    why: "a redaction for a message never held INSERTS a tombstone, creating a row for something " +
         "the person never saw rather than annotating one they did",
    find: "    if (!st.buf.redact(redactedId)) return;",
    repl: '    if (!st.buf.redact(redactedId)) { st.buf.upsert(redactedId, "@x:hs", "", false, 1, true); }   /*J11M24*/',
    marker: "J11M24", expect: 1 },

  // ── THE VERSION PIN (J11b) ────────────────────────────────────────────────────────────────
  { id: "M25", file: "mb", part: "C/H",
    why: "a creation site drops back to v10 while only `content.redacts` is read — a client that " +
         "sees a deletion and cannot tell WHICH message, caused from a file away",
    find: '      opts.room_version = "11";\n      initial_state.push({',
    repl: '      opts.room_version = "10";   /*J11M25*/\n      initial_state.push({',
    marker: "J11M25", expect: 1 },

  { id: "M26", file: "mb", part: "C/H",
    why: "the OTHER creation site drops back to v10 — the half a single-site check would miss",
    find: '      opts.room_version = "11";   // restricted join needs v8+; see the pin note in _createOpenChannel',
    repl: '      opts.room_version = "10";   /*J11M26*/',
    marker: "J11M26", expect: 1 },

  { id: "M27", file: "mb", part: "H",
    why: "restricted join stops being pushed at the open channel, so the pin protects nothing and " +
         "any space member loses their route in",
    find: '        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] }\n      });\n    }\n    const room = await client.createRoom(opts);\n    return room.room_id;\n  }\n\n  // E2E encrypted channel',
    repl: '        content: { join_rule: "invite" }   /*J11M27*/\n      });\n    }\n    const room = await client.createRoom(opts);\n    return room.room_id;\n  }\n\n  // E2E encrypted channel',
    marker: "J11M27", expect: 1 },

  { id: "M28", file: "mb", part: "H",
    why: "the allow rule loses the space, so restricted join names no room to be a member of",
    find: '      opts.room_version = "11";   // restricted join needs v8+; see the pin note in _createOpenChannel\n      initial_state.push({\n        type: "m.room.join_rules", state_key: "",\n        content: { join_rule: "restricted", allow: [{ type: "m.room_membership", room_id: spaceId }] }',
    repl: '      opts.room_version = "11";   /*J11M28*/\n      initial_state.push({\n        type: "m.room.join_rules", state_key: "",\n        content: { join_rule: "restricted", allow: [] }',
    marker: "J11M28", expect: 1 },

  { id: "M2", file: "ui", part: "D",
    why: "the buffer is tombstoned but no DOM row is found, so the deleted message keeps its text " +
         "on screen until something else happens to repaint",
    find: "      const node = box.querySelector(_eidSel(redactedId));\n      const rec = st.buf.get(redactedId);",
    repl: "      const node = null;   /*J11M2*/\n      const rec = st.buf.get(redactedId);",
    marker: "J11M2", expect: 1 },

  { id: "M3", file: "ui", part: "D",
    why: "the removal applies to the VISIBLE tier instead of the tier the message is in, so a " +
         "redaction in a background tier deletes an innocent row out of the one you are reading",
    find: "    const st = _chatState(box, tier || visible);\n    // TOMBSTONE, NOT REMOVAL.",
    repl: "    const st = _chatState(box, visible);   /*J11M3*/\n    // TOMBSTONE, NOT REMOVAL.",
    marker: "J11M3", expect: 1 },

  { id: "M4", file: "ui", part: "D",
    why: "a redaction of an UNDECRYPTABLE row paints a visible tombstone instead of staying " +
         "hidden — a deletion revealing that an unreadable message existed",
    find: "        if (rec.failed) { node.remove(); st.domIds.delete(redactedId); return; }",
    repl: "        if (rec.failed) { node.replaceWith(_chatRow(box, rec)); return; }   /*J11M4*/",
    marker: "J11M4", expect: 1 },

  // ── THE DOOR ──────────────────────────────────────────────────────────────────────────────
  { id: "M5", file: "ch", part: "B",
    why: "the redaction branch runs BEFORE the readable-set gate, so an unbound client acts on a " +
         "deletion from any room in sync — the posture J15 established, undone by reordering",
    find: '    if (raw.type !== "m.room.message" && raw.type !== "m.room.redaction") return;',
    repl: '    if (raw.type === "m.room.redaction" && raw.redacts) { if (_onRedaction) _onRedaction(raw.redacts, raw.room_id, raw.sender); return; }   /*J11M5*/\n    if (raw.type !== "m.room.message") return;',
    marker: "J11M5", expect: 1 },

  { id: "M6", file: "ch", part: "B",
    why: "a redaction with NO target is approximated instead of refused — it names nothing, so " +
         "anything it deletes is the wrong row",
    find: "      if (!target) { Logger.warn(\"Chat: redaction with no target id\"); return; }",
    repl: "      /*J11M6*/",
    marker: "J11M6", expect: 1 },

  { id: "M7", file: "ch", part: "B",
    why: "the room id stops travelling with the redaction, so it cannot be routed to the tier " +
         "the deleted message is in",
    find: "      if (_onRedaction) _onRedaction(target, raw.room_id, raw.sender);",
    repl: "      if (_onRedaction) _onRedaction(target, null, raw.sender);   /*J11M7*/",
    marker: "J11M7", expect: 1 },

  // ── THE ENVELOPE ──────────────────────────────────────────────────────────────────────────
  // M8 IS GONE, AND ITS ABSENCE IS THE POINT. It removed the pre-v11 top-level `redacts` read to
  // show that dropping it lost the target in older rooms. That read was the version pin's shadow
  // rather than a compatibility bridge, and it was deleted with the raise to v11 (J11b). A row
  // mutating code that no longer exists would VOID on every run and read as a broken probe rather
  // than as a rule that stopped applying. M25/M26 replace it by attacking the PIN instead, which
  // is where the property actually lives now.

  { id: "M9", file: "mb", part: "C",
    why: "only the pre-v11 location is read, so the target is lost in every modern room",
    find: '          if (content && typeof content.redacts === "string") return content.redacts;',
    repl: "          /*J11M9*/",
    marker: "J11M9", expect: 1 },

  { id: "M10", file: "mb", part: "C",
    why: "a throwing SDK accessor takes the whole resolution down instead of falling through to " +
         "the wire format",
    find: "          try {\n            if (event.getAssociatedId) { const a = event.getAssociatedId(); if (a) return a; }\n          } catch (e) {}",
    repl: "          if (event.getAssociatedId) { const a = event.getAssociatedId(); if (a) return a; }   /*J11M10*/",
    marker: "J11M10", expect: 1 },

  // ── THE AFFORDANCE ────────────────────────────────────────────────────────────────────────
  { id: "M11", file: "ui", part: "E",
    why: "the delete control appears on EVERYBODY'S messages, offering an action the homeserver " +
         "will refuse for anyone below level 100 — the 403 drift, arriving as an affordance",
    find: "    if (record.id && !record.redacted && _isOwnMessage(record.sender)) {",
    repl: "    if (record.id && !record.redacted) {   /*J11M11*/",
    marker: "J11M11", expect: 1 },

  { id: "M12", file: "ui", part: "E",
    why: "own-ness is decided by the row existing rather than by comparing against the live " +
         "account, so a row rendered before a re-login keeps somebody else's control",
    find: "    return !!me && sender === me;",
    repl: "    return true;   /*J11M12*/",
    marker: "J11M12", expect: 1 },

  { id: "M13", file: "ui", part: "E",
    why: "the delete button is wired to no particular row, so it deletes whichever id was last " +
         "closed over rather than the one it sits on",
    find: "      del.onclick = () => _deleteChatMessage(record.id);",
    repl: "      del.onclick = () => _deleteChatMessage(null);   /*J11M13*/",
    marker: "J11M13", expect: 1 },

  // ── THE SPINE HALF OF THE DONE-WHEN ───────────────────────────────────────────────────────
  // These do not touch J11's code at all. They ask whether PART F's assertions are load-bearing
  // or decorative — whether this guard would NOTICE the Spine becoming mutable.
  { id: "M14", file: "mb", part: "F",
    why: "the SPINE stops refusing redactions — a redacted event with a verified original is no " +
         "longer restored. J11 must not have loosened this and PART F must NOTICE if it does",
    find: '    if (!isRedacted) return "ingest";',
    repl: '    if (!isRedacted) return "ingest";\n    return "ingest";   /*J11M14*/',
    marker: "J11M14", expect: 1 },

  { id: "M15", file: "mb", part: "F",
    why: "Spine channels stop returning before the raw fan-out, so a chat redaction handler can " +
         "see a Spine event — the branch that separates the two opposite answers",
    find: "      if (_isSpineChannel(room)) {\n        _ingestSpineEvent(event, room);\n        return;\n      }",
    repl: "      if (_isSpineChannel(room)) {\n        _ingestSpineEvent(event, room);\n      }   /*J11M15*/",
    marker: "J11M15", expect: 1 },

  // ── THE GATE THAT MUST NOT EXIST ──────────────────────────────────────────────────────────
  { id: "M16", file: "ch", part: "G",
    why: "a RANK GATE appears in front of the redaction send — permitted against nothing, since " +
         "the homeserver adjudicates and the reducer never sees one. The 403 drift, exactly",
    find: "    if (!eventId) return { ok: false, reason: \"no-target\" };",
    repl: "    if (!eventId) return { ok: false, reason: \"no-target\" };\n    if (Ranks.GATES && MatrixBridge.getMyRank() < 60) return { ok: false, reason: \"rank\" };   /*J11M16*/",
    marker: "J11M16", expect: 1 },
];

function runSuite() {
  try {
    const out = execFileSync("node", [SUITE], { cwd: ROOT, encoding: "utf8", timeout: 900000 });
    return { green: /All guards passed/.test(out) || /PASS/.test(out), out };
  } catch (e) {
    return { green: false, out: (e.stdout || "") + (e.stderr || "") };
  }
}

function firstFail(out) {
  const m = (out || "").match(/^\[[a-z0-9-]+\] (FAIL|INADMISSIBLE) .*/m);
  return m ? m[0].slice(0, 180) : "(no FAIL line — check the output)";
}

function main() {
  const rec = J.recover();
  if (rec.restored.length) {
    console.log("[mutate-j11] recovered a dirty journal from a previous run: " +
      rec.restored.map((r) => r.file).join(", "));
  }
  if (rec.skipped.length) {
    console.log("[mutate-j11] LEFT ALONE (changed since the journal was written): " +
      JSON.stringify(rec.skipped));
  }

  // The suffix is allowed because lattice rotations are lettered (M19, M19b, M19c). The stricter
  // `^M\d+$` silently matched NONE of them and fell through to "run everything" — 29 rows instead
  // of 2, and a reader would have taken the summary for the rotation's answer.
  const want = process.argv.slice(2).filter((a) => /^M\d+[a-z]?$/.test(a));
  const rows = want.length ? ROWS.filter((r) => want.indexOf(r.id) >= 0) : ROWS;
  if (!rows.length) { console.log("[mutate-j11] no rows selected"); process.exit(1); }

  if (NARROWED) {
    console.log("[mutate-j11] SUITE NARROWED to " + SUITE + " — this run is for ATTRIBUTION ONLY. " +
      "A green row measured here is a claim about one file, not about the suite.");
  }

  const results = [];
  for (const row of rows) {
    const file = F[row.file];
    const h = J.open("mutate-j11-redact:" + row.id, file);
    let applied = 0;
    try {
      applied = h.apply(row.find, row.repl, row.expect);
      if (row.find2) applied += h.apply(row.find2, row.repl2, row.expect);
    } catch (e) {
      h.restore();
      console.log(row.id + "  VOID  — the mutation did not apply: " + e.message);
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }
    if (!h.stillApplied(row.marker)) {
      h.restore();
      console.log(row.id + "  VOID  — the marker was absent immediately after applying");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    const r = runSuite();

    // THE SECOND HALF: assert it STILL applies now that the result has been read.
    const still = h.stillApplied(row.marker);
    h.restore();

    if (!still) {
      console.log(row.id + "  VOID  — the mutation was gone by the time the result was read " +
        "(somebody else wrote to the tree); a green here would be a claim about a tree that " +
        "never held it");
      results.push({ id: row.id, verdict: "VOID" });
      continue;
    }

    let verdict = r.green ? "GREEN" : "RED";
    if (row.expectGreen) verdict = r.green ? "DOMINATED" : "RED (redundancy ENDED — read it)";
    console.log(row.id + "  " + verdict + " [" + applied + " site, targets PART " + row.part + "] " +
      row.why + (/^RED/.test(verdict) ? "\n        -> " + firstFail(r.out) : ""));
    results.push({ id: row.id, verdict, part: row.part });
  }

  const red = results.filter((r) => /^RED/.test(r.verdict)).length;
  const green = results.filter((r) => r.verdict === "GREEN").length;
  const dom = results.filter((r) => r.verdict === "DOMINATED").length;
  const voidd = results.filter((r) => r.verdict === "VOID").length;
  console.log("\n[mutate-j11] " + results.length + " rows: " + red + " RED, " + green +
    " green, " + dom + " dominated (expected, recorded), " + voidd + " void." +
    (green ? "  A GREEN ROW IS A FINDING ABOUT THE GUARD, NOT ABOUT THE TREE." : ""));
}

main();
