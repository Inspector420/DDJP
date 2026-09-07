// tests/check-chat-redaction.js
// WALL: A DELETED CHAT MESSAGE LEAVES THE SCREEN, AND THE SPINE STAYS IMMUTABLE.
//
// J11's Done-when has two halves and both are here: a redaction removes the message from the
// rendered chat, and the Spine is untouched. The second is not a formality — **this tree already
// answers `m.room.redaction` the OPPOSITE way** for Spine channels, refusing the redaction and
// re-ingesting the verified original (`check-redaction`, `check-seal-hold`). One Matrix event
// type, two opposite correct responses, told apart ONLY by which channel it lands in. PART F
// drives that boundary.
//
// ── THE FAILURE THIS FILE EXISTS TO CATCH IS SILENT ──────────────────────────────────────────
// The obvious handler is an upsert to a placeholder — exactly what a decryption failure does —
// and the buffer REFUSES it. `prev.failed === false && failed` returns `noop`, because the
// non-downgrading rule that stops a decryption placeholder clobbering real text cannot tell a
// deletion from one. **The message stays on screen after being deleted and nothing throws.**
// PART A drives that refusal directly, so the reason this code is shaped the way it is stays
// attached to the evidence for it.
//
// WHAT EACH PART PINS:
//   PART A — the buffer refuses the placeholder upsert, and expresses removal instead.
//   PART B — the door: a redaction goes through the readable-set gate FIRST, fails closed, and
//     one with no target is refused rather than approximated.
//   PART C — the envelope carries the target id, from either room-version location.
//   PART D — the removal routes to the tier the message is IN, and a message never held is a
//     no-op rather than an error.
//   PART E — the affordance is on own rows only, and that is a UI choice rather than a gate.
//   PART F — THE SPINE IS UNTOUCHED: chat redactions never reach the reducer, and a Spine
//     redaction is still REFUSED. The two answers, driven side by side.
//   PART G — no rank gate anywhere on this path, and no `Ranks.GATES` row (J14's lesson).

const fs = require("fs");
const path = require("path");
const { loadInContext } = require("./_load");
const P = require("./_probe-j11-redact");

let asserts = 0;
function fail(msg, got) {
  console.log("[chat-redaction] FAIL — " + msg);
  if (got !== undefined) console.log("      got " + JSON.stringify(got));
  process.exit(1);
}
function ok(c, msg, got) { asserts++; if (!c) fail(msg, got); }
const ROOT = path.resolve(__dirname, "..");

// ═══ PART A — the buffer refuses the obvious handler ═════════════════════════════════════════
{
  const CB = P.realBuffer();
  const b = CB.create();
  b.upsert("$m1", "@a:hs", "something I regret", false, 1000);
  ok(b.size() === 1 && b.get("$m1").body === "something I regret",
    "A: APPLIED — the message must be in the buffer, or the refusal below is a refusal of nothing",
    b.size());

  const r = b.upsert("$m1", "@a:hs", "", true, 1000);
  ok(r.type === "noop",
    "A: THE OBVIOUS HANDLER IS REFUSED. Replacing the body with a placeholder — exactly what a " +
    "decryption failure does — returns `noop`, because `prev.failed === false && failed` is the " +
    "non-downgrading rule and it cannot tell a deletion from a decryption placeholder", r.type);
  ok(b.get("$m1").body === "something I regret" && b.size() === 1,
    "A: SO THE DELETED MESSAGE IS STILL THERE, with its real text, and NOTHING THREW. That is the " +
    "whole reason this guard exists: the failure is silent, and a handler written the obvious way " +
    "would look correct in review and in the log", b.get("$m1"));

  // The control: the same rule doing its actual job, so PART A is not an argument against it.
  const b2 = CB.create();
  b2.upsert("$m2", "@a:hs", "", true, 1000);
  const up = b2.upsert("$m2", "@a:hs", "the real text arrived late", false, 1000);
  ok(up.type === "update" && b2.get("$m2").body === "the real text arrived late",
    "A control: the same rule still lets REAL text replace a placeholder, which is what it is for " +
    "— so the refusal above is the rule working rather than the rule being broken", b2.get("$m2"));

  // ── THE THIRD STATE (J11b) ─────────────────────────────────────────────────────────────────
  // `redacted` is what lets a deletion through a rule built to refuse one. The rule above is not
  // relaxed — it is given something it can distinguish. A DELETION IS NOT A DECRYPTION FAILURE and
  // the buffer now says so in its own vocabulary.
  const b3 = CB.create();
  b3.upsert("$m3", "@a:hs", "something I regret", false, 1000);
  ok(b3.redact("$m3") === true,
    "A: APPLIED — the transition must succeed, or every row below is about a record that never " +
    "changed", b3.get("$m3"));
  const t = b3.get("$m3");
  ok(t.redacted === true && b3.size() === 1 && b3.has("$m3") === true,
    "A: REAL -> REDACTED IS ADMITTED, and the row SURVIVES as a tombstone. A vanished row is " +
    "indistinguishable from one that was never there; a marked one says something happened here",
    t);
  ok(t.body === "",
    "A: AND THE TOMBSTONE HOLDS NO BODY", t.body);
  ok(t.failed === false,
    "A: and `failed` is untouched, because a redaction says nothing about whether this device " +
    "could READ the message", t.failed);

  // ── THE BUFFER'S RULES ARE DRIVEN AT `upsert`, NOT AT `redact` ─────────────────────────────
  // THESE THREE ROWS EXIST BECAUSE `mutate-j11-redact` M18 AND M20 SURVIVED WITHOUT THEM.
  // `redact` is a well-behaved caller: it passes an empty body and the previous `failed`, so
  // every assertion routed through it was true whether or not the buffer enforced anything. The
  // rules exist to protect against a DIFFERENT caller — one written later, by someone who has the
  // body to hand and no reason to think it matters — so they have to be driven where they live.
  const bx = CB.create();
  bx.upsert("$x", "@a:hs", "the text", false, 1000);
  bx.upsert("$x", "@a:hs", "the text", false, 1000, true);   // a redacting upsert WITH a body
  ok(bx.get("$x").body === "" && bx.get("$x").redacted === true,
    "A: A REDACTING UPSERT DROPS THE BODY EVEN WHEN THE CALLER HANDS ONE OVER. A tombstone that " +
    "kept the text would leave the plaintext in RAM for any repaint to render — the deletion " +
    "would be a rendering choice rather than a removal. Enforced in `_record`, so no caller can " +
    "get it wrong", bx.get("$x"));

  // `keepTs` driven at `upsert` for the same reason as the two rows above: `redact` hands over
  // `prev.ts`, so every assertion routed through it held whether or not the buffer preserved
  // anything. `mutate-j11-redact` M19c — the lattice's adjacent CONTROL — came back green until
  // this existed, which made the whole rotation inadmissible rather than informative.
  const bt = CB.create();
  bt.upsert("$t1", "@a:hs", "first", false, 1000);
  bt.upsert("$t2", "@a:hs", "second", false, 2000);
  bt.upsert("$t1", "@a:hs", "re-decrypted late", false, 999999);
  ok(bt.get("$t1").ts === 1000 && JSON.stringify(bt.ids()) === '["$t1","$t2"]',
    "A: an in-place update KEEPS the ts it was first placed at, even when the caller hands over a " +
    "later one — a late re-decrypt must not move the row, and the slot is what a tombstone " +
    "depends on", { ts: bt.get("$t1").ts, order: bt.ids() });

  const by = CB.create();
  by.upsert("$y", "@a:hs", "", true, 1000);                   // undecryptable
  by.upsert("$y", "@a:hs", "", false, 1000, true);            // a redacting upsert claiming NOT failed
  ok(by.get("$y").failed === true && by.get("$y").redacted === true,
    "A: A REDACTING UPSERT CANNOT CLEAR `failed`, even when the caller says false. Losing it would " +
    "turn a row hidden as undecryptable into a VISIBLE tombstone — a deletion causing a row to " +
    "APPEAR, which is backwards, and the caller is the last place that should be deciding it",
    by.get("$y"));

  // REDACTION IS TERMINAL. The reachable case, not a hypothetical: backfill decrypts NEWEST-first
  // and megolm keys arrive late, so a real body for an already-redacted message genuinely turns up.
  const back = b3.upsert("$m3", "@a:hs", "something I regret", false, 1000);
  ok(back.type === "noop" && b3.get("$m3").redacted === true && b3.get("$m3").body === "",
    "A: REDACTED -> REAL IS REFUSED. A late-decrypting body must never resurrect something the " +
    "author deleted — the worst failure this file can have, and one that would look like the " +
    "buffer working", b3.get("$m3"));
  const back2 = b3.upsert("$m3", "@a:hs", "", true, 1000);
  ok(b3.get("$m3").redacted === true,
    "A: and an ordinary later update cannot quietly un-tombstone it either — `redacted` is sticky",
    b3.get("$m3"));

  // THE SLOT. This is why the tombstone is a MUTATION rather than a remove-and-reinsert, and the
  // difference was driven before the state was added (`probe-j11-redact.js` R1b).
  const b4 = CB.create();
  b4.upsert("$a", "@a:hs", "first", false, 1000);
  b4.upsert("$b", "@a:hs", "second", false, 2000);
  b4.upsert("$c", "@a:hs", "third", false, 3000);
  b4.redact("$b");
  ok(JSON.stringify(b4.ids()) === '["$a","$b","$c"]',
    "A: A TOMBSTONE KEEPS ITS CHRONOLOGICAL SLOT. `upsert`'s update branch never touches `order[]`, " +
    "so the slot is structurally untouchable from that path", b4.ids());
  const b5 = CB.create();
  b5.upsert("$a", "@a:hs", "first", false, 1000);
  b5.upsert("$b", "@a:hs", "second", false, 2000);
  b5.upsert("$c", "@a:hs", "third", false, 3000);
  b5.remove("$b"); b5.upsert("$b", "@a:hs", "", true, 0);
  ok(JSON.stringify(b5.ids()) !== '["$a","$b","$c"]',
    "A control: while REMOVE-THEN-REINSERT moves it — `_place` sorts on the ts it is handed and " +
    "the original was lost with the record. That clobber is what ruled a tombstone out the first " +
    "time, and it belongs to REINSERTION rather than to mutation", b5.ids());

  // A HIDDEN ROW MUST NOT BECOME A VISIBLE ONE. A deletion causing a row to APPEAR is backwards.
  const b6 = CB.create();
  b6.upsert("$f", "@a:hs", "", true, 1000);
  ok(b6.get("$f").failed === true,
    "A: APPLIED — the row must be failed before the redaction, or the row below proves nothing",
    b6.get("$f"));
  b6.redact("$f");
  ok(b6.get("$f").redacted === true && b6.get("$f").failed === true,
    "A: a redaction of an UNDECRYPTABLE row marks it AND keeps it failed, so the renderer goes on " +
    "hiding it. Losing `failed` here would make a deletion reveal that an unreadable message " +
    "existed — information the person did not have before", b6.get("$f"));

  ok(b3.redact("$nope") === false,
    "A: and redacting something absent answers false rather than throwing, which is what makes " +
    "the never-held case a no-op instead of an error path", b3.redact("$nope"));
}

// ═══ PART B — the door ═══════════════════════════════════════════════════════════════════════
{
  let captured = null;
  const sb = loadInContext(["core/logger.js", "features/chat.js"], {
    Date, Math, JSON, setTimeout, clearTimeout,
    MatrixBridge: { onRawEvent: (fn) => { captured = fn; }, offRawEvent: () => {},
                    sendMessage: async () => {}, redactEvent: async () => {},
                    cryptoAvailable: () => true, recentChatMessages: async () => ({ messages: [] }) },
  });
  const Chat = sb.Chat;
  const reds = [], msgs = [];
  Chat.onMessage((id, s2, b, f, ts, roomId) => msgs.push({ id, roomId }));
  Chat.onRedaction((target, roomId, sender) => reds.push({ target, roomId, sender }));
  Chat.init("!main:hs");
  ok(typeof captured === "function", "B: APPLIED — init must register a raw listener", typeof captured);
  Chat.setReadableTiers(["!main:hs", "!staff:hs"]);

  const red = (id, room, target) => ({ type: "m.room.redaction", room_id: room, event_id: id,
                                       sender: "@a:hs", content: {}, ts: 9, redacts: target });

  captured(red("$r1", "!staff:hs", "$victim"), {}, {});
  ok(reds.length === 1 && reds[0].target === "$victim",
    "B: a redaction in a READABLE tier reaches the consumer with its target", reds);
  ok(reds[0].roomId === "!staff:hs",
    "B: and with the channel it happened in — buffers are per tier (J12), so a redaction has to " +
    "reach the tier the deleted message is actually in", reds[0]);
  ok(msgs.length === 0,
    "B: and it does NOT arrive as a message — a redaction is an instruction to remove a row, not " +
    "a row, and folding it into `onMessage` would make every caller grow a branch for it", msgs);

  reds.length = 0;
  captured(red("$r2", "!stranger:hs", "$victim"), {}, {});
  ok(reds.length === 0,
    "B: a redaction from a channel OUTSIDE the readable set is refused — the same wall a message " +
    "meets, at the same door", reds);

  // FAIL CLOSED, and the ORDER is the point: the gate is asked before the type is dispatched.
  Chat.setReadableTiers([]);
  reds.length = 0;
  captured(red("$r3", "!main:hs", "$victim"), {}, {});
  ok(reds.length === 0,
    "B: an UNBOUND client acts on no deletion at all. An empty readable set means nothing is ours " +
    "rather than everything, exactly as it does for a message — a permissive filter here would " +
    "let a stranger's channel delete rows out of this room's view", reds);

  // A redaction naming nothing is refused rather than guessed at.
  Chat.setReadableTiers(["!main:hs"]);
  reds.length = 0;
  captured({ type: "m.room.redaction", room_id: "!main:hs", event_id: "$r4", sender: "@a:hs",
             content: {}, ts: 9, redacts: null }, {}, {});
  ok(reds.length === 0,
    "B: a redaction whose target did not survive the envelope names NOTHING, and is refused " +
    "rather than approximated — guessing would delete the wrong row", reds);

  // And the message path is unchanged, so this is an addition rather than a rewrite.
  msgs.length = 0;
  captured({ type: "m.room.message", room_id: "!main:hs", event_id: "$m", sender: "@a:hs",
             content: { body: "hi" }, ts: 1 }, {}, {});
  ok(msgs.length === 1,
    "B control: ordinary messages still arrive, so the widened door is a widening", msgs);
}

// ═══ PART C — the envelope carries the target ════════════════════════════════════════════════
// Driven against the REAL expression in `matrixbridge.js`, extracted and run, because the two
// room-version locations are the kind of detail that is right in the room you tested and wrong in
// the next one.
{
  const vm = require("vm");
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const m = src.match(/redacts: \(function \(\) \{[\s\S]*?\}\)\(\),/);
  ok(!!m, "C: APPLIED — the `redacts` resolution must be extractable, or this part has no subject");
  const expr = m[0].replace(/^redacts: /, "").replace(/,$/, "");

  // THE RESOLUTION IS CALLED THROUGH A CATCH, AND THAT IS NOT DEFENSIVENESS FOR ITS OWN SAKE.
  // `mutate-j11-redact` M9 and M10 — and a third row since RETIRED, which that file's ENVELOPE
  // note records as deliberately gone — first went RED BY CRASH: the mutated expression threw, the
  // exception escaped this file, and node printed a stack trace instead of a FAIL line. A guard
  // killed by a throw is one swallowed exception away from being killed by nothing
  // (`08-build-and-deploy.md` §Writing a guard), and the assertion written for the failure never
  // ran. A throw is now turned into a distinctive value so the assertion below is the reporter.
  const THREW = "\u0000threw";
  function resolve(event, content) {
    const ctx = { event, content };
    vm.createContext(ctx);
    try { return vm.runInContext("(" + expr + ")", ctx); }
    catch (e) { return THREW; }
  }
  ok(resolve({ getAssociatedId: () => "$viaSdk" }, {}) === "$viaSdk",
    "C: the SDK's own normalisation is asked first, so a version this build has not seen is still " +
    "handled if the SDK knows it", resolve({ getAssociatedId: () => "$viaSdk" }, {}));
  ok(resolve({}, { redacts: "$viaContent" }) === "$viaContent",
    "C: room v11+ carries the target in `content.redacts`", resolve({}, { redacts: "$viaContent" }));
  // ── ONE LOCATION, AND THE PIN IS WHY (J11b) ────────────────────────────────────────────────
  // This once asserted the PRE-v11 top-level location too, and that read looked like a
  // compatibility bridge. It was the shadow of `opts.room_version = "10"` two functions away.
  // Creation is pinned to v11 now, old rooms are discardable, and the second read was reachable
  // from no room this build can make. **So the assertion is not deleted — it is INVERTED**: the
  // single read is only correct while the pin says v11, and this guard now holds those two facts
  // together so raising or lowering one without the other fails here rather than in a room.
  ok(resolve({ event: { redacts: "$viaTop" } }, {}) === null,
    "C: the PRE-v11 top-level location is NOT read — it was the pin's shadow, not a bridge, and a " +
    "branch reachable from no room this build can create is a rule with no caller", "still read");

  const pins = [...src.matchAll(/opts\.room_version = "(\d+)";/g)].map((m) => m[1]);
  ok(pins.length === 2,
    "C: APPLIED — both creation sites must pin a version, or the claim below covers only one",
    pins);
  ok(pins.every((v) => Number(v) >= 11),
    "C: AND EVERY CREATION SITE PINS v11 OR LATER. The single `content.redacts` read above is " +
    "correct ONLY because of this. Lowering either pin without restoring the other read would " +
    "produce a client that sees a deletion and cannot tell WHICH message — the silent failure " +
    "PART A is about, arriving from a file away", pins);
  ok(pins.every((v) => Number(v) >= 8),
    "C: and both still meet the floor the pin exists for — restricted join needs v8+, which is " +
    "the reason there is a pin here at all rather than the server's default", pins);
  ok(resolve({}, {}) === null,
    "C: and with neither present it answers null rather than undefined-shaped nonsense, so the " +
    "door's no-target refusal has something definite to test", resolve({}, {}));
  // The control: a throwing SDK accessor must not take the resolution down.
  const thrower = resolve({ getAssociatedId: () => { throw new Error("boom"); } }, { redacts: "$fallback" });
  ok(thrower !== THREW,
    "C control: a throwing SDK accessor does not take the resolution down with it — the SDK is " +
    "third-party and a version that throws on an event shape it dislikes must not lose the target",
    "the resolution threw");
  ok(thrower === "$fallback",
    "C control: it falls through to the wire format instead, so the target survives an SDK that " +
    "cannot normalise it", thrower);
}

// ═══ PART D — the removal routes by tier, and a never-held message is a no-op ════════════════
{
  const RES = { tiers: [{ tier: "main", id: "!m:hs", main: true },
                        { tier: "staff", id: "!s:hs", main: false }], activeTier: "main" };

  // The message is in the VISIBLE tier and mounted: buffer and DOM both lose it.
  let r = P.gate("removal", P.driveRemoval({
    redactedId: "$a", roomId: "!m:hs", res: RES, visibleTier: "main", mounted: ["$a"],
    seed: { main: [{ id: "$a" }, { id: "$b" }] } }), { expectSeeded: true }, "PART D visible");
  const recOf = (tier, id) => (r.records[tier] || []).find((x) => x.id === id);
  ok(r.sizes.main === 2 && JSON.stringify(r.held.main) === '["$a","$b"]',
    "D: THE ROW STAYS AND KEEPS ITS SLOT. A vanished row is indistinguishable from one that was " +
    "never there, so a deletion leaves a mark — and it leaves it where the message was", r.held);
  ok(recOf("main", "$a").redacted === true && recOf("main", "$a").body === "",
    "D: marked as redacted, with no body left behind — the tombstone is a removal of the text, " +
    "not a decision about how to draw it", recOf("main", "$a"));
  ok(recOf("main", "$b").redacted === false,
    "D control: and its neighbour is untouched, so the transition applies to one record rather " +
    "than to the tier", recOf("main", "$b"));
  ok(r.replacedInDom.length === 1 && r.replacedInDom[0].id === "$a",
    "D: AND THE MOUNTED ROW IS REPLACED IN PLACE rather than removed, so the mark lands in the " +
    "slot the message occupied instead of the list closing over it", r.replacedInDom.map((x) => x.id));
  const painted = P.flatten(r.replacedInDom[0].node).map((n) => n.text).filter(Boolean).join(" ");
  ok(/Message deleted/.test(painted),
    "D: and what it paints SAYS SO — the tombstone is rendered, not merely recorded", painted);
  ok(!/\bsecond\b/.test(painted) && painted.indexOf("body-of-$a") < 0,
    "D: and it does not paint the body it replaced", painted);
  ok(r.domIds.main.indexOf("$a") >= 0,
    "D: the id STAYS in the mounted set, because the row is still mounted — dropping it would " +
    "leave a rendered row nothing tracks, and a later repaint would not know to redraw it",
    r.domIds);

  // The message is in a NON-VISIBLE tier: the buffer loses it, the DOM was never holding it.
  r = P.gate("removal", P.driveRemoval({
    redactedId: "$s1", roomId: "!s:hs", res: RES, visibleTier: "main", mounted: [],
    seed: { main: [{ id: "$a" }], staff: [{ id: "$s1" }, { id: "$s2" }] } }),
    { expectSeeded: true }, "PART D hidden");
  const rec2 = (tier, id) => (r.records[tier] || []).find((x) => x.id === id);
  ok(rec2("staff", "$s1").redacted === true && rec2("staff", "$s2").redacted === false,
    "D: A REDACTION ROUTES TO THE TIER THE MESSAGE IS IN, not the tier being viewed. Buffers are " +
    "per tier (J12) and a redaction carries its own room_id — driven rather than assumed, because " +
    "there is no reason a redaction must route the way a message does", r.records.staff);
  ok(rec2("main", "$a").redacted === false,
    "D control: and the VISIBLE tier is untouched, so the routing is a routing rather than a " +
    "transition applied to whichever buffer was to hand", r.records.main);
  ok(r.replacedInDom.length === 0 && r.removedFromDom.length === 0,
    "D: and nothing in the DOM is touched, because the tombstone is in a tier that is not on " +
    "screen — it is waiting in that tier's retained buffer", r.replacedInDom);
  // THE TOMBSTONE SURVIVES A TIER SWITCH, which is the question per-tier buffers make askable.
  ok(r.sizes.staff === 2,
    "D: THE TOMBSTONE SURVIVES IN THE HIDDEN TIER'S BUFFER. Buffers are retained across a switch " +
    "(J12), so switching to that tier finds the mark rather than a gap — the deletion is visible " +
    "whenever the person next looks, not only if they were looking at the time", r.held.staff);

  // A REDACTED UNDECRYPTABLE ROW MUST LEAVE THE SCREEN, NOT BECOME A TOMBSTONE ON IT.
  // `mutate-j11-redact` M4 survived without this: PART A drove the BUFFER side (the record keeps
  // `failed`), and nothing drove the DOM side, where the handler has to choose between removing
  // the hidden row and painting a mark in its place. The buffer being right does not make the
  // renderer right, and they are two decisions in two files.
  r = P.gate("removal", P.driveRemoval({
    redactedId: "$f", roomId: "!m:hs", res: RES, visibleTier: "main", mounted: ["$f"],
    seedFailed: ["$f"], seed: { main: [{ id: "$f" }] } }), { expectSeeded: true }, "PART D hidden-row");
  ok(r.removedFromDom.indexOf("$f") >= 0 && r.replacedInDom.length === 0,
    "D: a redaction of a row this device could NOT DECRYPT removes it rather than painting a " +
    "tombstone. The row was hidden, and a deletion must not reveal that an unreadable message " +
    "existed — information the person did not have before", r);
  ok(r.domIds.main.indexOf("$f") < 0,
    "D: and it is forgotten from the mounted set, because unlike a tombstone there is no row left " +
    "to track", r.domIds);

  // A message this client never held.
  r = P.gate("removal", P.driveRemoval({
    redactedId: "$never", roomId: "!m:hs", res: RES, visibleTier: "main",
    seed: { main: [{ id: "$a" }] } }), { expectSeeded: true }, "PART D unheld");
  ok(!r.threw && r.sizes.main === 1 && r.replacedInDom.length === 0,
    "D: A REDACTION FOR A MESSAGE THIS CLIENT NEVER HELD IS A NO-OP, NOT AN ERROR — and it is the " +
    "NORMAL case rather than the exotic one: buffers are capped and per tier, the client may have " +
    "joined after the message, and the tier may never have been opened. No tombstone is INSERTED " +
    "for it either: a mark for a message the person never saw would create a row rather than " +
    "annotate one", r);

  // A redaction from a channel that is not a tier of this room at all.
  r = P.gate("removal", P.driveRemoval({
    redactedId: "$a", roomId: "!elsewhere:hs", res: RES, visibleTier: "main", mounted: ["$a"],
    seed: { main: [{ id: "$a" }] } }), { expectSeeded: true }, "PART D foreign");
  ok(!r.threw,
    "D: and an unrecognised channel does not throw — the door already refused it, and this is the " +
    "second line of the same defence rather than the first", r.threw);
}

// ═══ PART E — the affordance ═════════════════════════════════════════════════════════════════
{
  let r = P.gate("row", P.driveRow({ me: "@me:hs",
    record: { id: "$mine", sender: "@me:hs", body: "mine", ts: 1 } }), { expectEid: true }, "PART E own");
  ok(r.hasDelete === true,
    "E: your OWN message carries a delete control", r.del.length);
  r.del[0].onclick();
  ok(r.clicked.indexOf("$mine") >= 0,
    "E: and it is wired to the id of the row it sits on, so it deletes that message rather than " +
    "whichever was last rendered", r.clicked);

  r = P.gate("row", P.driveRow({ me: "@me:hs",
    record: { id: "$theirs", sender: "@other:hs", body: "theirs", ts: 1 } }), { expectEid: true }, "PART E other");
  ok(r.hasDelete === false,
    "E: SOMEBODY ELSE'S DOES NOT. The ladder reads `redact: 100` with `events_default: 0` — your " +
    "own needs only permission to send a redaction, which everyone has; another's needs level 100. " +
    "So this absence is a decision about what to OFFER, not a permission check standing in for one",
    r.del.length);

  // The control that makes the above a reading rather than a constant: no account bound.
  r = P.gate("row", P.driveRow({ me: null,
    record: { id: "$x", sender: "@me:hs", body: "x", ts: 1 } }), { expectEid: true }, "PART E unbound");
  ok(r.hasDelete === false,
    "E control: with no account bound nothing is 'yours', so the control is decided by comparing " +
    "against the live id rather than by the row's mere existence", r.del.length);
}

// ═══ PART F — THE SPINE IS UNTOUCHED, AND THE OTHER ANSWER STILL HOLDS ═══════════════════════
// The Done-when's second half. This tree answers `m.room.redaction` two OPPOSITE ways depending on
// the channel, and a handler that got the branch wrong would silently make the Spine mutable.
{
  const MB = loadInContext(["core/logger.js", "backends/backend1/consensushash.js",
    "backends/backend1/ranks.js", "backends/backend1/trustpolicy.js"], { Date, Math, JSON });
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");

  // THE SPINE ANSWER, unchanged: refuse the redaction and restore the verified original.
  const vm = require("vm");
  const dm = src.match(/function spineRestoreDecision[\s\S]*?\n  \}/);
  ok(!!dm, "F: APPLIED — `spineRestoreDecision` must be extractable, or this part has no subject");
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(dm[0] + ";globalThis.d = spineRestoreDecision;", ctx);
  ok(ctx.d(true, true) === "restore",
    "F: a redacted SPINE event with a verified original is still RESTORED — the redaction is " +
    "REFUSED. J11 must not have loosened this", ctx.d(true, true));
  ok(ctx.d(false, false) === "ingest",
    "F control: while an un-redacted one is ingested, so the decision discriminates", ctx.d(false, false));

  // AND THE BRANCH: Spine channels never reach the raw fan-out chat listens to.
  const noComments = src.split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  // THE SHAPE CHANGED WHEN THE BOT NEEDED SPINE EVENTS. `_ingestSpineEvent` now takes a liveness
  // flag and does its own fan-out for LIVE events only, so the assertion is no longer "the Spine
  // branch reaches no fan-out" — it is that the Spine branch still RETURNS rather than falling
  // through into the chat fan-out below. That is the property chat depends on: a Spine event must
  // not arrive at a chat listener as though it were chat.
  ok(/if \(_isSpineChannel\(room\)\) \{\s*_ingestSpineEvent\(event, room, true\);\s*return;/.test(noComments),
    "F: a Spine channel RETURNS into `_ingestSpineEvent` rather than falling through, so a chat " +
    "redaction handler cannot ever see a Spine event — the two answers are separated by the " +
    "routing rather than by a test inside the handler", "branch not found");

  // AND CHAT NEVER REACHES THE REDUCER — the other direction of the same wall.
  ok(/if \(!_isChatChannel\(room\) && inScope\(room\.roomId\)\) \{/.test(noComments),
    "F: and chat-named rooms are skipped before both `EventCache.store` and " +
    "`StreamManager.ingest`, so a chat redaction cannot reach the log even in principle",
    "chat skip not found");

  // The reducer has no branch for a redaction, and must not grow one.
  const sd = fs.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");
  ok(!/m\.room\.redaction/.test(sd),
    "F: THE REDUCER HAS NO REDACTION BRANCH and there can never be one — chat is Skin and a " +
    "chat redaction never arrives at the fold. A branch here would be a rule with no caller " +
    "that a later reader would take for a live one", "statederiver names m.room.redaction");
}

// ═══ PART G — no rank gate on this path ══════════════════════════════════════════════════════
// J14'S LESSON, APPLIED RATHER THAN RE-LEARNED. For acts the homeserver decides there is no
// reducer branch and can never be one, so a rank gate reports *permitted* against nothing — the
// 403 drift `main/10-capabilities.md` exists to prevent. J15's DM send is the precedent.
{
  const strip = (f) => fs.readFileSync(path.join(ROOT, f), "utf8")
    .split("\n").map((l) => (l.trim().startsWith("//") ? "" : l)).join("\n");

  const chat = strip("features/chat.js");
  const redactFn = chat.match(/async function redact\(eventId\)[\s\S]*?\n  \}/);
  ok(!!redactFn, "G: APPLIED — `Chat.redact` must be findable, or this part has no subject");
  ok(!/Ranks\.|GATES|myRank|getMyRank/.test(redactFn[0]),
    "G: `Chat.redact` consults no rank. The homeserver adjudicates a redaction and the reducer " +
    "never sees one, so a gate would report permitted against nothing", redactFn[0].slice(0, 200));

  const ranks = strip("backends/backend1/ranks.js");
  ok(!/redact/i.test(ranks),
    "G: and there is NO `Ranks.GATES` row for redaction — the ladder gates acts the REDUCER " +
    "adjudicates, and a row here would be a permission this app cannot enforce and does not own",
    "ranks.js names redact");

  // The ladder is read for what it SAYS, so the affordance decision in PART E rests on a
  // measurement rather than on a recollection.
  const vm = require("vm");
  const mbSrc = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const plm = mbSrc.match(/function _powerLevels\(sendLevel, creatorId, isSpace\)[\s\S]*?\n  \}/);
  ok(!!plm, "G: APPLIED — `_powerLevels` must be extractable");
  const c2 = {}; vm.createContext(c2);
  vm.runInContext(plm[0] + ";globalThis.pl = _powerLevels(0, '@o:hs', false);", c2);
  ok(c2.pl.redact === 100,
    "G: the ladder sets `redact` to 100 — deleting SOMEBODY ELSE'S message is owner-only today",
    c2.pl.redact);
  ok(c2.pl.events_default === 0,
    "G: while `events_default` is 0, so sending a redaction of YOUR OWN message is open to every " +
    "rank. That pair is why the self case needs no gate and the moderator case would need the " +
    "room's POWER LEVELS changed rather than a rank check added — a different job from the one " +
    "J11's Open defers it to", c2.pl.events_default);
}

// ═══ PART H — RESTRICTED JOIN AT v11, DRIVEN ════════════════════════════════════════════════
// The pin exists FOR restricted join, so raising it without driving that would be trading a
// measured property for an assumed one. Both creation functions are extracted and RUN against a
// recording client, so what this asserts is the options object the SDK would actually receive.
//
// WHAT THIS CANNOT MEASURE, STATED RATHER THAN IMPLIED: no homeserver was contacted. This drives
// the REQUEST, not the acceptance. Whether a given Synapse or Dendrite honours a v11 restricted
// join is a live measurement nothing headless can take — the same shape as J09 — and the roadmap
// entry names which servers this was and was not checked against rather than leaving the reader
// to assume a round trip happened.
{
  const vm = require("vm");
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const grab = (name) => {
    const a = "async function " + name + "(";
    const i = src.indexOf(a);
    if (i < 0) return null;
    const o = src.indexOf("{", src.indexOf(")", i));
    let d = 0;
    for (let j = o; j < src.length; j++) {
      if (src[j] === "{") d++;
      else if (src[j] === "}") { d--; if (!d) return src.slice(i, j + 1); }
    }
    return null;
  };
  const plm = src.match(/function _powerLevels\(sendLevel, creatorId, isSpace\)[\s\S]*?\n  \}/);
  const open = grab("_createOpenChannel");
  const chat = grab("_createChatChannel");
  ok(!!plm && !!open && !!chat,
    "H: APPLIED — both creation functions must be extractable, or nothing below is about the code " +
    "that ships", { open: !!open, chat: !!chat });

  function drive(fnSrc, name, args) {
    const seen = [];
    const ctx = { console, Math, JSON, Date,
      client: { createRoom: async (opts) => { seen.push(opts); return { room_id: "!new:hs" }; } } };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(plm[0] + "\n" + fnSrc + "\n;globalThis.__f = " + name + ";", ctx);
    return ctx.__f.apply(null, args).then(() => seen[0]);
  }

  return Promise.all([
    drive(open, "_createOpenChannel", ["events_player", 0, "@o:hs", "!space:hs"]),
    drive(chat, "_createChatChannel", ["chat_uncategorized", 0, "@o:hs", "!space:hs"]),
    drive(open, "_createOpenChannel", ["events_player", 0, "@o:hs", null]),
  ]).then(([openOpts, chatOpts, noSpace]) => {
    for (const [label, opts] of [["open channel", openOpts], ["chat channel", chatOpts]]) {
      ok(opts.room_version === "11",
        "H: the " + label + " is created at room version 11", opts.room_version);
      const jr = (opts.initial_state || []).find((e) => e.type === "m.room.join_rules");
      ok(!!jr, "H: APPLIED — the " + label + " must push join_rules, or the rows below have no " +
        "subject", opts.initial_state.map((e) => e.type));
      ok(jr.content.join_rule === "restricted",
        "H: AND RESTRICTED JOIN SURVIVES THE RAISE for the " + label + " — this is the property " +
        "the pin exists to protect, and raising the pin without driving it would trade a measured " +
        "property for an assumed one", jr.content);
      ok(Array.isArray(jr.content.allow) && jr.content.allow.length === 1 &&
         jr.content.allow[0].type === "m.room_membership" &&
         jr.content.allow[0].room_id === "!space:hs",
        "H: with the space named in the allow rule, so membership of the space is what grants the " +
        "join — the shape restricted join actually needs, not merely the word", jr.content.allow);
    }
    // THE CONTROL: without a space there is no restricted join AND no pin, so both are readings
    // of the argument rather than constants stamped on every room.
    ok(noSpace.room_version === undefined,
      "H control: with no space there is no version pin at all — the pin is a consequence of " +
      "restricted join rather than a property of every room this app makes", noSpace.room_version);
    ok(!(noSpace.initial_state || []).some((e) => e.type === "m.room.join_rules"),
      "H control: and no join_rules is pushed, so the pair above is a reading of the same " +
      "condition rather than two independent constants",
      (noSpace.initial_state || []).map((e) => e.type));

    tail();
  });
}

function tail() {
// ═══ the harness's own gate, both directions ═════════════════════════════════════════════════
{
  const rows = P.selfTest();
  const refusals = rows.filter((r) => r.refused === true).length;
  const admits = rows.filter((r) => r.admitted === true).length;
  ok(refusals === 4 && admits === 3,
    "the admissibility gate refuses each broken reading and ADMITS the sound ones — including a " +
    "redaction for a message never held, which this job's own no-op case requires it to admit " +
    "rather than refuse as a failed reading", rows);
}

console.log("[chat-redaction] PASS — a deleted chat message leaves the screen and the Spine stays " +
  "immutable (J11). THE FAILURE THIS GUARD EXISTS TO CATCH IS SILENT: the obvious handler is an " +
  "upsert to a placeholder, exactly what a decryption failure does, and the buffer REFUSES it — " +
  "the non-downgrading rule cannot tell a deletion from a decryption placeholder, so the message " +
  "stays on screen with its real text and nothing throws. Driven in PART A with the control " +
  "showing that same rule still doing its job. SO THE BUFFER GAINED A THIRD STATE: `redacted`, " +
  "orthogonal to `failed`, because they answer different questions — one is about keys and stays " +
  "hidden, the other is about the room and is MARKED. real->redacted is admitted, real->failed is " +
  "still refused, and redacted->real is refused outright, because backfill decrypts newest-first " +
  "and a late body must never resurrect what an author deleted. The row is a TOMBSTONE keeping " +
  "its slot, holding no body, and surviving a tier switch in its retained buffer — a MUTATION, " +
  "not a remove-and-reinsert, which is driven here to land the row at the FRONT. The door is the " +
  "SAME door: a redaction " +
  "meets the readable-set gate before the type is dispatched, an unbound client acts on no " +
  "deletion, and one whose target did not survive the envelope is refused rather than guessed at " +
  "— and the envelope now carries that target from BOTH room-version locations, because a client " +
  "reading one would work in some rooms and silently fail in others. Removal routes to the tier " +
  "the message is IN rather than the tier being viewed, and a redaction for a message never held " +
  "is a NO-OP, which is the normal case. THE SPINE ANSWERS THE SAME EVENT TYPE THE OPPOSITE WAY " +
  "and still does: a redacted Spine event with a verified original is RESTORED, Spine channels " +
  "return before the fan-out chat listens to, chat never reaches the reducer, and the reducer has " +
  "no redaction branch. And there is NO RANK GATE and no `Ranks.GATES` row: the ladder reads " +
  "`redact: 100` with `events_default: 0`, so the self case is open to every rank and the " +
  "moderator case needs power levels changed rather than a check added (" + asserts + " assertions)");
}

