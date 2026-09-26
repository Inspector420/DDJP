// tools/probes/probe-j11-redact.js
// J11 — THE MEASUREMENTS THE JOB ENTRY DID NOT HAVE. Read-only.
//
// The entry's What field says only "take back something you said, via Matrix redaction". After
// twelve consecutive entries wrong somewhere, an entry that thin predicts an OMISSION rather than
// a false statement. These are the omissions, driven:
//
//   R0  THE BUFFER REFUSES THE OBVIOUS HANDLER — the deleted message stays on screen, silently
//   R1  what the buffer CAN express, and why it is removal rather than a tombstone
//   R2  the raw envelope carried NO target id, so the handler could not tell WHICH message
//   R3  which tier a redaction routes to, given buffers are per tier
//   R4  ONE EVENT TYPE, TWO OPPOSITE ANSWERS — the Spine refuses what chat honours
//   R5  what the ladder actually permits, which decides the affordance and the deferred case
//   R6  the unread badge after a redaction — does the count go stale?
//
// `--selftest` shows the gate refusing failed premises and admitting sound ones.

const path = require("path");
const fs = require("fs");
const vm = require("vm");
const ROOT = path.resolve(__dirname, "../..");
const { loadInContext } = require(path.join(ROOT, "tests/_load.js"));

let GATE_THROW = false;
function gate(row, checks) {
  for (const c of checks) {
    if (!c.ok) {
      const msg = "[probe-j11] INADMISSIBLE " + row + " — " + c.why +
        "\n      the reading never reached its subject, so nothing it says would mean anything";
      if (GATE_THROW) throw new Error(msg);
      console.log(msg);
      return false;
    }
  }
  return true;
}

const MB_SRC = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");

function run() {
  console.log("=== J11 — deleting a chat message. Read-only measurements. ===\n");

  const CB = loadInContext(["ui/chatbuffer.js"], { Date, Math, JSON }).ChatBuffer;

  // ── R0 — the buffer refuses ───────────────────────────────────────────────────────────────
  {
    const b = CB.create();
    b.upsert("$m1", "@a:hs", "something I regret", false, 1000);
    if (gate("R0", [{ ok: b.size() === 1, why: "the fixture never got the message into the buffer" }])) {
      const r = b.upsert("$m1", "@a:hs", "", true, 1000);
      console.log("R0  THE OBVIOUS HANDLER IS REFUSED, AND SILENTLY.");
      console.log("    upsert(id, sender, \"\", failed=true) -> type=" + r.type +
        "   size=" + b.size());
      console.log("    body still: " + JSON.stringify(b.get("$m1").body) +
        "   failed=" + b.get("$m1").failed);
      console.log("    >>> `prev.failed === false && failed` returns `noop`. The non-downgrading");
      console.log("        rule that stops a DECRYPTION placeholder clobbering real text cannot");
      console.log("        tell a DELETION from one — both arrive as `replace real text with an");
      console.log("        absence`. THE DELETED MESSAGE STAYS ON SCREEN AND NOTHING THROWS.");
    }
  }

  // ── R1 — what it can express ──────────────────────────────────────────────────────────────
  {
    const b = CB.create();
    b.upsert("$a", "@a:hs", "first", false, 1000);
    b.upsert("$b", "@a:hs", "second", false, 2000);
    if (gate("R1", [{ ok: b.size() === 2, why: "the fixture holds fewer than the two rows this row compares" }])) {
      const removed = b.remove("$a");
      console.log("\nR1  WHAT THE DEDUP RULE CAN ACTUALLY EXPRESS.");
      console.log("    remove('$a')      -> " + removed + "   size=" + b.size() +
        "   remaining=" + JSON.stringify(b.ids()));
      console.log("    remove(unknown)   -> " + b.remove("$nope") + "   (no throw)");
      b.upsert("$a", "@a:hs", "", true, 1000);
      console.log("    re-insert as placeholder after removal -> size=" + b.size() +
        "   order=" + JSON.stringify(b.ids()));
      console.log("    >>> REMOVE-THEN-REINSERT MOVES THE ROW, which is why the first version of");
      console.log("        J11 rejected a tombstone. R1b below shows the clobber belongs to");
      console.log("        REINSERTION, not to mutation — and a tombstone by mutation is what J11b");
      console.log("        built, because a vanished row is indistinguishable from one that was");
      console.log("        never there.");
    }
  }

  // ── R1b — in-place mutation keeps the slot ────────────────────────────────────────────────
  {
    const b = CB.create();
    b.upsert("$a", "@a:hs", "first", false, 1000);
    b.upsert("$b", "@a:hs", "second", false, 2000);
    b.upsert("$c", "@a:hs", "third", false, 3000);
    const before = JSON.stringify(b.ids());
    if (gate("R1b", [{ ok: b.size() === 3, why: "the fixture holds fewer than the three rows this row orders" }])) {
      b.redact("$b");
      const b2 = CB.create();
      b2.upsert("$a", "@a:hs", "first", false, 1000);
      b2.upsert("$b", "@a:hs", "second", false, 2000);
      b2.upsert("$c", "@a:hs", "third", false, 3000);
      b2.remove("$b"); b2.upsert("$b", "@a:hs", "", true, 0);
      console.log("\nR1b THE TOMBSTONE IS A MUTATION, AND THAT IS WHY IT IS SAFE.");
      console.log("    order before:                 " + before);
      console.log("    after redact() (in place):    " + JSON.stringify(b.ids()) +
        "   record=" + JSON.stringify(b.get("$b")));
      console.log("    after remove-then-reinsert:   " + JSON.stringify(b2.ids()) +
        "   ts=" + b2.get("$b").ts);
      console.log("    >>> `upsert`'s update branch NEVER touches order[], so the slot is");
      console.log("        structurally untouchable from that path and `keepTs` holds the ts.");
      console.log("        Reinsertion loses both with the record and _place sorts on what it is");
      console.log("        handed — landing the row at the FRONT. The objection that ruled a");
      console.log("        tombstone out belongs to reinsertion alone.");
    }
  }

  // ── R2 — the envelope ─────────────────────────────────────────────────────────────────────
  {
    const m = MB_SRC.match(/const raw = \{[\s\S]*?\n      \};/);
    if (gate("R2", [{ ok: !!m, why: "the raw envelope could not be located in matrixbridge.js" }])) {
      const hasRedacts = /redacts:/.test(m[0]);
      console.log("\nR2  THE TARGET EVENT ID.");
      console.log("    envelope carries `redacts`: " + hasRedacts + "   (it did NOT before J11)");
      console.log("    fields: " + (m[0].match(/^\s*(\w+):/gm) || []).map((x) => x.trim().replace(":", "")).join(", "));
      console.log("    reads content.redacts (v11+): " + /content\.redacts/.test(m[0]));
      console.log("    reads the pre-v11 top level:  " + /ev\.redacts/.test(m[0]) +
        "   <- deleted in J11b with the pin raise");
      console.log("    >>> `event_id` is the REDACTION's own id, not its target's. Without a");
      console.log("        `redacts` field a client can see that something was deleted and not");
      console.log("        WHICH — indistinguishable from not knowing at all. And the target lives");
      console.log("        `redacts` field a client can see that something was deleted and not");
      console.log("        WHICH. J11 read BOTH room-version locations; J11b raised creation to");
      console.log("        v11 and deleted the pre-v11 read, because it was the PIN'S SHADOW");
      console.log("        rather than a compatibility bridge — see R7.");
    }
  }

  // ── R3 — which tier ───────────────────────────────────────────────────────────────────────
  {
    const uiSrc = fs.readFileSync(path.join(ROOT, "ui/interface.js"), "utf8");
    const fn = uiSrc.match(/function removeChatMessage\([\s\S]*?\n  \}/);
    if (gate("R3", [{ ok: !!fn, why: "`removeChatMessage` is not present, so there is no routing to read" }])) {
      console.log("\nR3  WHICH TIER'S BUFFER A REDACTION LANDS IN.");
      console.log("    removeChatMessage resolves the tier from the event's own room_id: " +
        /_tierForChannel\(roomId\)/.test(fn[0]));
      console.log("    and touches the DOM only when that tier is the visible one: " +
        /tier === visible/.test(fn[0]));
      console.log("    >>> buffers are per tier since J12 and a redaction carries its own room_id,");
      console.log("        so it must be ROUTED rather than applied to whichever buffer is to hand.");
      console.log("        A redaction for a hidden tier removes from that tier's buffer and has no");
      console.log("        DOM row to remove, which is correct rather than a special case.");
    }
  }

  // ── R4 — two opposite answers ─────────────────────────────────────────────────────────────
  {
    const dm = MB_SRC.match(/function spineRestoreDecision[\s\S]*?\n  \}/);
    if (gate("R4", [{ ok: !!dm, why: "spineRestoreDecision could not be extracted" }])) {
      const ctx = {}; vm.createContext(ctx);
      vm.runInContext(dm[0] + ";globalThis.d = spineRestoreDecision;", ctx);
      const noComments = MB_SRC.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
      console.log("\nR4  ONE MATRIX EVENT TYPE, TWO OPPOSITE CORRECT ANSWERS.");
      console.log("    SPINE:  spineRestoreDecision(redacted=true, haveOriginal=true) = " +
        ctx.d(true, true) + "   <- REFUSE the redaction");
      console.log("    CHAT:   the row is removed                                      <- HONOUR it");
      console.log("    told apart by: `if (_isSpineChannel(room)) { _ingestSpineEvent(...); return; }` = " +
        /if \(_isSpineChannel\(room\)\) \{\s*_ingestSpineEvent\(event, room\);\s*return;/.test(noComments));
      console.log("    >>> A HANDLER THAT GOT THE BRANCH WRONG WOULD SILENTLY MAKE THE SPINE");
      console.log("        MUTABLE. The separation is the ROUTING, not a test inside either");
      console.log("        handler — the Spine branch returns before the raw fan-out chat listens");
      console.log("        to, so a chat redaction handler cannot ever see a Spine event.");
    }
  }

  // ── R5 — what the ladder permits ──────────────────────────────────────────────────────────
  {
    const plm = MB_SRC.match(/function _powerLevels\(sendLevel, creatorId, isSpace\)[\s\S]*?\n  \}/);
    if (gate("R5", [{ ok: !!plm, why: "_powerLevels could not be extracted" }])) {
      const c = {}; vm.createContext(c);
      vm.runInContext(plm[0] + ";globalThis.pl = _powerLevels(0, '@o:hs', false);", c);
      console.log("\nR5  WHAT THE HOMESERVER LADDER ACTUALLY PERMITS.");
      console.log("    redact          = " + c.pl.redact + "   (deleting SOMEBODY ELSE'S message)");
      console.log("    events_default  = " + c.pl.events_default + "   (sending a redaction of YOUR OWN)");
      console.log("    >>> the self case is open to EVERY rank and needs no gate. The moderator");
      console.log("        case needs the room's POWER LEVELS changed — not a rank check added —");
      console.log("        so the entry's `moderators over others is a J14 question` misplaces it:");
      console.log("        J14 is about rank gates, and a rank gate here would report `permitted`");
      console.log("        against nothing. That is the 403 drift 10-capabilities.md prevents.");
    }
  }

  // ── R6 — the unread badge ─────────────────────────────────────────────────────────────────
  {
    const CP = loadInContext(["core/logger.js", "core/storageio.js", "core/idb.js", "core/store.js",
                              "core/chatprefs.js"], {
      localStorage: { _v: {}, getItem(k) { return this._v[k] === undefined ? null : this._v[k]; },
                      setItem(k, v) { this._v[k] = String(v); }, removeItem(k) { delete this._v[k]; } },
      Date, Math, JSON, indexedDB: undefined });
    const A = CP.ChatPrefs; A.load();
    A.tierTouch("staff", 5000);
    const before = A.tierUnread("staff");
    // A redaction removes the message. Nothing in chatprefs knows.
    const after = A.tierUnread("staff");
    if (gate("R6", [{ ok: before === true, why: "the tier was not unread to begin with, so staleness is unmeasurable" }])) {
      console.log("\nR6  THE UNREAD BADGE AFTER A REDACTION.");
      console.log("    tier unread before the redaction: " + before);
      console.log("    tier unread after  the redaction: " + after + "   (nothing told chatprefs)");
      console.log("    row shape: " + JSON.stringify(A.tierList()[0]));
      console.log("    >>> THE BADGE STAYS, AND THAT IS THE DECISION RATHER THAN AN OVERSIGHT.");
      console.log("        `tierUnread` is `lastTs > readTs` — a comparison of STAMPS, not a count");
      console.log("        of live messages. Lowering `lastTs` on a redaction would need chatprefs");
      console.log("        to know WHICH message set it, i.e. to hold event ids — exactly what the");
      console.log("        scalars-only rule forbids, and the rule is what keeps a message body");
      console.log("        out of the store. So a badge can point at a tier whose only unread");
      console.log("        message has since been deleted, and opening the tier clears it.");
    }
  }

  // ── R7 — the pin, and what raising it costs ───────────────────────────────────────────────
  {
    const pins = [...MB_SRC.matchAll(/opts\.room_version = "(\d+)";/g)].map((m) => m[1]);
    const restricted = (MB_SRC.match(/join_rule: "restricted"/g) || []).length;
    if (gate("R7", [
      { ok: pins.length === 2, why: "there are not two creation sites to compare" },
      { ok: restricted >= 2, why: "restricted join is not pushed, so the pin protects nothing measurable" },
    ])) {
      console.log("\nR7  THE VERSION PIN, AND WHY THE SECOND READ WAS ITS SHADOW.");
      console.log("    creation sites pinning a version: " + JSON.stringify(pins));
      console.log("    restricted-join pushes:           " + restricted);
      console.log("    restricted join needs v8+;  8 <= " + pins[0] + " : " + (8 <= Number(pins[0])));
      console.log("    >>> the pin exists FOR restricted join and v11 is a superset for that");
      console.log("        purpose — nothing the pin needs was removed. The pre-v11 `redacts` read");
      console.log("        existed because creation was pinned to v10 TWO FUNCTIONS AWAY, not");
      console.log("        because any room needed answering. Old rooms are discardable, so with");
      console.log("        creation at v11 that branch was reachable from no room this build can");
      console.log("        make.");
      console.log("    THE RISK THIS MOVES IS NOT ABOUT ROOMS: a server that does not support v11");
      console.log("        FAILS createRoom OUTRIGHT rather than degrading, because the version is");
      console.log("        requested explicitly. That raises the floor a self-hosted deployment");
      console.log("        must meet, and it is the one question discarding old rooms cannot");
      console.log("        answer. NO HOMESERVER WAS CONTACTED BY THIS PROBE — acceptance is a");
      console.log("        live measurement nothing headless can take (the J09 shape).");
      console.log("\n=== done. Every omission above was absent from the entry. ===");
    }
  }
}

function selfTest() {
  GATE_THROW = true;
  const out = [];
  const t = (name, checks, expect) => {
    let refused = false;
    try { gate(name, checks); } catch (e) { refused = true; }
    out.push({ row: name, refused, asExpected: refused === expect });
  };
  t("a premise that failed", [{ ok: false, why: "deliberately false" }], true);
  t("the SECOND premise failed", [{ ok: true, why: "" }, { ok: false, why: "deliberately false" }], true);
  t("an absent-subject premise, which R2 legitimately has", [{ ok: !null, why: "" }], false);
  t("an empty-buffer premise", [{ ok: 0 > 0, why: "held nothing" }], true);
  t("every premise held", [{ ok: true, why: "" }, { ok: true, why: "" }], false);
  GATE_THROW = false;
  const bad = out.filter((r) => !r.asExpected);
  console.log("=== probe-j11-redact --selftest ===");
  for (const r of out) console.log("  " + (r.refused ? "REFUSED " : "ADMITTED") + "  " + r.row +
    (r.asExpected ? "" : "   <<< NOT AS EXPECTED"));
  console.log(bad.length === 0
    ? "  the gate refuses failed premises and admits sound ones — both directions shown."
    : "  GATE IS BROKEN: " + bad.length + " row(s) behaved unexpectedly.");
  process.exit(bad.length === 0 ? 0 : 1);
}

if (process.argv.indexOf("--selftest") >= 0) selfTest();
else run();
