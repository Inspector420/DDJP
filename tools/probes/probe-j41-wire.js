#!/usr/bin/env node
// tools/probes/probe-j41-wire.js — IS THE BLOCKED REPORT REACHED?
//
// Read-only. Prints what the main player wires, whether anything in production calls
// `MediaBlocked.reportCannotSee`, and — by RUNNING the handler the UI actually holds — whether a
// `ddjp.play.blocked` reaches the transport and what reason it carries.
//
// Run it before and after the wire lands. Before, R1 reports the handler set without `onError`,
// R3 refuses at its gate naming the absence, and that refusal IS the measurement. After, every row
// answers.
//
// Every reading goes through `tests/_probe-j41-wire.js`'s admissibility gate, and the gate is
// self-tested first — because everything this probe can return is a small array or a boolean, and
// every way of failing to reach the code returns exactly what "correctly declined to report"
// returns.

const P = require("../../tests/_probe-j41-wire");

function line(s) { console.log(s); }
function show(name, r, opts) {
  const a = P.admissible(r, opts);
  if (!a.ok) {
    line("  " + name + ": REFUSED");
    for (const p of a.problems) line("      " + p);
    return null;
  }
  return r;
}

line("=== probe-j41-wire ===\n");

// ── the gate first, because every row below is read through it ───────────────────────────────
const st = P.selfTest();
line("R0  the admissibility gate");
line("      cases it must refuse and did not: " + (st.missed.length ? st.missed.join(", ") : "(none)"));
line("      a sound reading is admitted: " + (st.rejectedGood ? "NO — " + st.rejectedGood.join("; ") : "yes"));
line("      the expectSend inversion works both ways: " + (st.inversionOk ? "yes" : "NO"));
if (st.missed.length || st.rejectedGood || !st.inversionOk) {
  line("\n  THE GATE IS BROKEN. Every row below would be certified on its own authority. Stopping.");
  process.exit(1);
}
line("");

// ── R1 — what the MAIN player wires ──────────────────────────────────────────────────────────
const ev = P.playerEvents();
line("R1  the main player's handler set (" + P.UI_REL + ", " + P.MAIN_PLAYER_ANCHOR + ")");
if (!ev.ok) line("      REFUSED: " + ev.stage);
else line("      wires: " + ev.keys.join(", "));
line("");

// ── R2 — is there a production caller for the report at all? ─────────────────────────────────
const callers = P.productionCallersOf("reportCannotSee");
const entry = P.productionCallersOf("notifyPlayerError");
line("R2  production callers (textual candidate scan, never a verdict)");
line("      reportCannotSee:   " + (callers.length ? callers.join(", ") : "(none — the declaration is authored by nobody)"));
line("      notifyPlayerError: " + (entry.length ? entry.join(", ") : "(none)"));
line("");

// ── R3 — DRIVE the handler for every code the reporter maps, and one it does not ─────────────
line("R3  running the extracted onError handler into the real module");
{
  // the code→token map is the FEATURE's, read from the feature rather than restated here
  const sb = require("../../tests/_load").loadInContext(
    ["backends/backend1/ranks.js", "backends/backend1/capabilities.js", "features/mediablocked.js"],
    { StreamManager: { getState: () => ({ nowPlaying: null }), on() {}, off() {} },
      MatrixBridge: { getUserId: () => "@me:hs", async sendEvent() {} },
      Logger: { info() {}, warn() {}, debug() {} }, setTimeout: () => 0, clearTimeout: () => {}, Date, Math });
  const map = (sb.MediaBlocked && sb.MediaBlocked._REASON_FOR_CODE) || {};
  for (const code of Object.keys(map)) {
    const r = P.driveHandler("onError", { code: Number(code) });
    const good = show("code " + code, r, { expectSend: true });
    if (good) {
      const b = good.blocked[0];
      line("  code " + String(code).padEnd(4) + " -> sent " + b.type + "  k=" +
        (b.content.k === undefined ? "(absent — untyped)" : b.content.k) +
        "  pi=" + b.content.pi +
        "   [" + (b.content.k && P.REASONS[b.content.k] && P.REASONS[b.content.k].counts
          ? "counts toward a road" : "local only — counts toward nothing") + "]");
    }
  }
  // an unmapped code: still reported, deliberately untyped
  const unk = P.driveHandler("onError", { code: 999 });
  const g2 = show("code 999 (unmapped)", unk, { expectSend: true });
  if (g2) {
    const b = g2.blocked[0];
    line("  code 999  -> sent " + b.type + "  k=" +
      (b.content.k === undefined ? "(absent — untyped, counts toward nothing)" : b.content.k));
  }
}
line("");

// ── R4 — the refusals, each with the sibling that must be admitted ───────────────────────────
// A refusal is evidence only if something adjacent was admitted, so each of these is run against
// the SAME fixture with one detail changed.
line("R4  refusals, each beside its control");
const control = P.driveHandler("onError", { code: 101 });
const cOk = P.admissible(control, { expectSend: true }).ok;
line("      control (player id matches the live song): " + (cOk ? "ADMITTED — 1 declaration sent" : "REFUSED"));
// THREE OUTCOMES, NOT TWO. A reading that never reached the handler is neither "refused by the
// rule" nor "sent anyway" — printing it as either is the absence-reads-as-a-finding failure this
// probe's gate exists to prevent, and the first draft of this line did exactly that.
for (const c of [
  { name: "the player reports a DIFFERENT video than the room is playing",
    opts: { code: 101, playerVideoId: "BBBBBBBBBBB", npVideoId: "AAAAAAAAAAA" } },
  { name: "the player reports no video data at all (mid-swap)",
    opts: { code: 101, playerVideoId: null } },
  { name: "getVideoData throws",
    opts: { code: 101, playerThrows: true } },
  { name: "nothing is playing",
    opts: { code: 101, nowPlaying: false } },
]) {
  const r = P.driveHandler("onError", c.opts);
  let verdict;
  if (!r || !r.ok) verdict = "UNREADABLE (" + ((r && r.stage) || "no reading") + ")";
  else if (r.blocked.length === 0) verdict = "REFUSED by the rule";
  else verdict = "SENT ANYWAY — " + r.blocked.length + " declaration(s)";
  line("      " + verdict + "  <- " + c.name);
}
line("");

// ── R5 — the join: is what the wire SENDS a declaration the fold COUNTS? ─────────────────────
// Neither end covered this before. `check-blocked-reason` builds its own declarations from
// fixtures and never sees what the reporter emits; everything above stops at the transport. So the
// body the wire actually produced is folded here, five times from five distinct people, and the
// road tally is read off the reducer's own advance view.
line("R5  the body the wire produced, folded by the real reducer");
{
  const F = require("../../tests/_fixtures");
  const SD = P.StateDeriver;
  for (const code of [101, 2, 999]) {
    const r = P.driveHandler("onError", { code });
    if (!r || !r.ok || r.blocked.length === 0) { line("      code " + code + ": UNREADABLE"); continue; }
    const body = r.blocked[0].content;
    const room = F.playingRoom({ songs: 2 });
    const pi = room.pis[room.pis.length - 1];
    const decls = [];
    for (let i = 0; i < 5; i++) {
      // the WIRE's own body, re-pointed at this fixture's live playing and given a distinct
      // sender — the reducer counts distinct people, and reusing one collapses five into one
      decls.push(F.reducerEvent("$w" + i, room.lastL + 1 + i, room.startTs + 1000 + i,
        "@rep" + i + ":hs", F.RANK.guest, Object.assign({ t: "ddjp.play.blocked" }, body, { pi })));
    }
    const out = SD.deriveBoth(F.sortLog(room.log.concat(decls)));
    const accepted = decls.filter((d) => new Set(out.accepted).has(d.eventId)).length;
    const adv = out.state.advance;
    if (accepted !== decls.length) {
      line("      code " + code + ": UNREADABLE — only " + accepted + " of " + decls.length +
        " accepted by the fold, so the tally below counts nothing");
      continue;
    }
    line("      code " + String(code).padEnd(4) + " k=" +
      (body.k === undefined ? "(untyped)" : body.k).padEnd(15) +
      " -> guestPlus=" + adv.blockedGuestPlus + "  skipWarranted=" + adv.skipWarranted);
  }
}
line("");

line("Read R3 with R1: a handler set without `onError` makes every R3 row refuse at the gate, and " +
  "that refusal is the finding rather than a probe fault.");
