// tools/probes/probe-j14-card.js
// READ-ONLY MEASUREMENT for J14 — the user card. Changes nothing on disk.
//
// Run it on the tree as received and it reports the ABSENCE J14 exists to close; run it after the
// build and it reports the rules and the surface. Every row is admissibility-gated, and the gate
// self-tests first — an unreached measurement returns the same value in every tree, and absence
// reads exactly like a finding (`08-build-and-deploy.md` §Writing a guard).
//
//   node tools/probes/probe-j14-card.js

const P = require("../../tests/_probe-j14-card.js");

let rows = 0, refused = 0;
function row(id, what, fn) {
  rows++;
  let r;
  try { r = fn(); }
  catch (e) {
    refused++;
    console.log("\n" + id + " — " + what + "\n  REFUSED (the probe itself threw): " + e.message);
    return null;
  }
  if (r && r.__gate && !r.__gate.ok) {
    refused++;
    console.log("\n" + id + " — " + what);
    for (const p of r.__gate.problems) console.log("  REFUSED: " + p);
    return r;
  }
  console.log("\n" + id + " — " + what);
  for (const line of (r.lines || [])) console.log("  " + line);
  return r;
}

// ── R0 — the gate's own test, before anything rests on it ────────────────────────────────────
const st = P.selfTest();
console.log("R0 — the admissibility gate, self-tested");
console.log("  cases it should catch and missed : " + (st.missed.length ? st.missed.join(" · ") : "none"));
console.log("  sound readings it wrongly refused: " + (st.falseAlarms.length ? st.falseAlarms.join(" · ") : "none"));
console.log("  verdict: " + (st.ok ? "the gate discriminates in BOTH directions" : "THE GATE IS NOT TRUSTWORTHY — nothing below is a measurement"));
if (!st.ok) process.exit(1);

// ── R1 — what the HOMESERVER will enforce, read by EXECUTING _powerLevels ────────────────────
const hs = P.homeserverGate();
row("R1", "the power levels a DDJP channel is really created with", () => {
  if (!hs.ok) return { __gate: { ok: false, problems: [hs.stage] } };
  return { lines: [
    "ban    = " + hs.ban + "  -> the weakest rank that meets it is " + hs.weakestRankFor(hs.ban),
    "kick   = " + hs.kick + "  -> the weakest rank that meets it is " + hs.weakestRankFor(hs.kick),
    "redact = " + hs.redact,
    "READ BY EXECUTION, not by regex: `_powerLevels` is extracted from the transport and run.",
    "This is the enforcement counterpart for these two verbs. There is no reducer branch to be",
    "equivalent to — kick and ban are Matrix MEMBERSHIP acts, so an app gate WEAKER than the",
    "power level above yields a button that reports permitted and produces a 403.",
  ] };
});

// ── R2/R3 — the RULES, driven across every (actor x target) pair on the ladder ───────────────
function gridRow(id, verb, mkTarget, note) {
  return row(id, "`" + verb + "` across the ladder (" + P.LADDER.length + "x" + P.LADDER.length + " pairs)", () => {
    const g = P.ladderGrid(verb, mkTarget);
    const gate = P.admissible("grid", g);
    if (!gate.ok) return { __gate: gate, g };
    const lines = [];
    const weakestActor = P.LADDER.filter((a) => g.rows.some((r) => r.actor === a.name && r.permitted))
      .map((a) => a.name);
    lines.push("permitted " + g.permitted + " of " + g.asked + " pairs");
    lines.push("ranks that may act at all: " + (weakestActor.join(" · ") || "none"));
    for (const a of P.LADDER) {
      const mine = g.rows.filter((r) => r.actor === a.name);
      const yes = mine.filter((r) => r.permitted).map((r) => r.target);
      lines.push("  actor " + a.name.padEnd(14) + " -> " + (yes.length ? yes.join(", ") : "(nobody)"));
    }
    const selfPairs = g.rows.filter((r) => r.actor === r.target && r.permitted);
    lines.push("self-action permitted anywhere: " + (selfPairs.length ? "YES — " + selfPairs.length + " pairs" : "no"));
    if (note) lines.push(note);
    return { lines, g };
  });
}
gridRow("R2", "member.kick", null,
  "shape follows `rank.assign`: act on a target STRICTLY BELOW you. Self is not below self, so");
gridRow("R3", "member.ban", null,
  "the self case falls out of the same comparison rather than needing a rule of its own.");

// The control. `rank.assign` is the only moderation rule the tree had, and the two new ones are
// shaped after it — so if its grid ever stops matching theirs, they have drifted from the pattern
// the entry says not to reinvent.
row("R4", "`rank.assign` — the existing pattern the two new gates copy", () => {
  const g = P.ladderGrid("rank.assign", (target, actor) => ({
    targetRank: target.level, newLevel: Math.max(0, target.level),
  }));
  const gate = P.admissible("grid", g);
  if (!gate.ok) return { __gate: gate };
  const lines = ["permitted " + g.permitted + " of " + g.asked + " pairs"];
  for (const a of P.LADDER) {
    const yes = g.rows.filter((r) => r.actor === a.name && r.permitted).map((r) => r.target);
    lines.push("  actor " + a.name.padEnd(14) + " -> " + (yes.length ? yes.join(", ") : "(nobody)"));
  }
  return { lines };
});

// ── R5 — the SURFACE, extracted from ui/interface.js and RUN ─────────────────────────────────
const PERMITTED = { enabled: true, reason: null };
const DENIED = { enabled: false, reason: "Staff rank required" };

row("R5", "the user card, extracted and executed against a recording adapter", () => {
  const r = P.driveCard({
    member: { userId: "@them:hs", name: "Them", level: 0 },
    describeAnswers: { "rank.assign": PERMITTED, "member.kick": PERMITTED, "member.ban": PERMITTED },
  });
  const gate = P.admissible("card", r, { expectOffered: true });
  if (!gate.ok) return { __gate: gate };
  return { lines: [
    "asked Actions.describe for: " + r.asked.map((a) => a.action).join(", "),
    "offered: " + r.offered.map((o) => o.tag + (o.action ? "[" + o.action + "]" : "") +
      (o.live ? " LIVE" : " inert")).join(" · "),
    "rank control offered: " + r.rankControlOffered,
  ] };
});

// ── R6 — the same card in front of a DENIED descriptor ───────────────────────────────────────
// The half that matters, and the whole of the Done-when's first clause: a card that offers the
// same LIVE controls whatever the adapter says is a card deciding for itself.
row("R6", "the same card when every descriptor comes back DENIED", () => {
  const r = P.driveCard({
    member: { userId: "@them:hs", name: "Them", level: 0 },
    describeAnswers: { "rank.assign": DENIED, "member.kick": DENIED, "member.ban": DENIED },
  });
  const gate = P.admissible("card", r);
  if (!gate.ok) return { __gate: gate };
  const live = r.offered.filter((o) => o.live && o.action);
  return { lines: [
    "asked: " + r.asked.map((a) => a.action).join(", "),
    "offered " + r.offered.filter((o) => o.action).length + " action control(s), of which " +
      live.length + " are LIVE",
    "each denied control carries the backend's own reason as its tooltip: " +
      r.offered.filter((o) => o.action).map((o) => JSON.stringify(o.title)).join(", "),
    "rank control offered: " + r.rankControlOffered + "  (the select is not built when denied)",
    "a live control here would be the UI deciding for itself",
  ] };
});

// ── R9 — the DM slot, driven BOTH ways ───────────────────────────────────────────────────────
// The claim "this is the container J15 plugs into" is a claim about behaviour, so it is driven
// rather than asserted: with `chat.dm` absent from the adapter's vocabulary the card must offer
// no DM control, and with it present the SAME card source must offer one — no edit to
// `ui/interface.js` in between. A row that only ran the first half would be green on a card that
// can never show the control at all.
row("R9", "the DM slot: absent from the adapter today, present when J15 adds it", () => {
  const without = P.driveCard({
    describeAnswers: { "rank.assign": DENIED, "member.kick": PERMITTED, "member.ban": DENIED },
  });
  const withDm = P.driveCard({
    describeAnswers: { "rank.assign": DENIED, "member.kick": PERMITTED, "member.ban": DENIED,
      "chat.dm": PERMITTED },
  });
  const g1 = P.admissible("card", without), g2 = P.admissible("card", withDm);
  if (!g1.ok) return { __gate: g1 };
  if (!g2.ok) return { __gate: g2 };
  const dm = (r) => r.offered.filter((o) => o.action === "chat.dm").length;
  return { lines: [
    "adapter does NOT know chat.dm -> DM controls offered: " + dm(without),
    "adapter DOES know chat.dm    -> DM controls offered: " + dm(withDm),
    "same card source both times; the difference is the adapter's vocabulary alone",
  ] };
});

// ── R10 — the click path, in front of a PARTIAL verdict ──────────────────────────────────────
// The consequence J14's entry says will bite on day one, followed all the way to what a person
// is TOLD. A card that prints "Done." over a twenty-of-twenty-one ban is the failure.
row("R10", "clicking Ban when the backend reports an INCOMPLETE ban", () => {
  const r = P.driveCard({
    member: { userId: "@them:hs", name: "Them", level: 0 },
    describeAnswers: { "rank.assign": DENIED, "member.kick": DENIED, "member.ban": PERMITTED },
    performResult: { ok: false, op: "ban", total: 21, closed: 20, failed: ["!chat_staff:hs"], unverified: [] },
  });
  const gate = P.admissible("card", r, { expectOffered: true });
  if (!gate.ok) return { __gate: gate };
  const btn = r.click("member.ban");
  if (!btn) return { __gate: { ok: false, problems: [
    "stage: no LIVE member.ban control to click, so the click path below was never entered"] } };
  const armed = btn.text;
  const performsAfterFirst = r.performed.length;
  btn.onclick();   // the second click — the confirm step
  return { lines: [
    "first click ARMS rather than acts: button reads " + JSON.stringify(armed) +
      ", performs so far: " + performsAfterFirst,
    "second click performs: " + JSON.stringify(r.performed.map((p) => p.action)),
    "(what the card PRINTS is asserted by check-user-card PART F, which awaits the promise)",
  ] };
});

// ── R7/R8 — the 21-room loop, and what a PARTIAL failure reports ─────────────────────────────
Promise.resolve()
  .then(() => P.driveMembershipLoop("banFromRoom", { failOn: null }))
  .then((r) => {
    rows++;
    const gate = P.admissible("loop", r);
    console.log("\nR7 — a ban across the whole room set, with every call succeeding (the CONTROL)");
    if (!gate.ok) { refused++; for (const p of gate.problems) console.log("  REFUSED: " + p); return; }
    console.log("  room set: " + r.roomCount + " rooms (the Space + " + (r.roomCount - 1) + " channels)");
    console.log("  homeserver calls made: " + r.calls.length);
    console.log("  verdict returned: " + JSON.stringify(r.result));
  })
  .then(() => {
    // fail exactly ONE room — the shape the entry warns about
    let n = 0;
    return P.driveMembershipLoop("banFromRoom", {
      failOn: (roomId) => (roomId.indexOf("chat_staff") >= 0),
    });
  })
  .then((r) => {
    rows++;
    const gate = P.admissible("loop", r);
    console.log("\nR8 — the same ban with ONE room refusing (the partial that looks like a success)");
    if (!gate.ok) { refused++; for (const p of gate.problems) console.log("  REFUSED: " + p); return; }
    console.log("  homeserver calls made: " + r.calls.length);
    console.log("  verdict returned: " + JSON.stringify(r.result));
    console.log("  THE QUESTION: does the caller learn that one room is still open to them?");
  })
  .then(() => {
    console.log("\n────────────────────────────────────────────────────────────────");
    console.log("rows: " + rows + " · refused by the gate: " + refused);
    if (refused) {
      console.log("A REFUSED row is not a finding. It says which stage failed, so the next reading");
      console.log("is aimed at the stage rather than at the conclusion.");
    }
  });
