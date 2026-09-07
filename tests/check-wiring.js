// tests/check-wiring.js
// WALL: THE NEW MODULES ARE ACTUALLY CALLED.
//
// Every mechanism in this session was built, guarded, and correct in isolation. This project's
// recorded failure is what happens next: `earnsForget` was correct and called by nobody;
// `trimToFloor` was correct and called by nobody; `floorNeedsRepage` went true and nobody read it.
// A predicate with no call site is indistinguishable from a missing feature at runtime, and it
// passes every unit guard.
//
// So these assertions are STRUCTURAL on purpose. They do not test behaviour — the other guards do
// that — they test that the behaviour is reachable from a running client.
//
// PART A — the modules are in the app's load order, and in an order that satisfies load-time deps.
// PART B — Session is attached and started by transport, with real browser signals.
// PART C — the TOMBSTONE is recorded where redactions are detected.
// PART D — every concept that must be attached, is.
// PART E — the phase machine sees ingested events.

const path = require("path");
const fs = require("fs");
function rd(p) { return fs.readFileSync(path.join(__dirname, "..", p), "utf8"); }
function fail(m, g) { console.log("[wiring] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const html = rd("index.html");
const bridge = rd("backends/backend1/matrixbridge.js");
const stream = rd("backends/backend1/streammanager.js");

// ── PART A — in the load order, and correctly ordered ────────────────────────────────────────
{
  const NEW = ["checkpointformat", "dials", "session", "scheduler", "vouch", "floor",
               "checkpoint", "continuity", "history", "settingsproof"];
  for (const m of NEW) {
    ok(html.indexOf("backends/backend1/" + m + ".js") >= 0,
      "A: " + m + ".js must be in the app's load order — a module the page never loads is a module "
      + "that does not exist at runtime, however well it is guarded");
  }
  // the two REAL load-time constraints
  const at = (m) => html.indexOf("backends/backend1/" + m + ".js");
  ok(at("checkpointformat") < at("floor"),
    "A: APPLIED — floor.js aliases CheckpointFormat's functions into constants at LOAD time, so the "
    + "format must load first. This is one of only two ordering constraints that are real; "
    + "everything else resolves when a function runs");
  ok(at("checkpointformat") < at("checkpoint"),
    "A: APPLIED — and checkpoint.js does `const TYPE = CheckpointFormat.TYPE`, the other one");

  const tags = html.match(/\?v=\d+/g) || [];
  ok(new Set(tags).size === 1,
    "A: every version tag must be identical, or a stale module loads beside a fresh one",
    Array.from(new Set(tags)));
}

// ── PART B — Session is attached AND started ─────────────────────────────────────────────────
{
  ok(/Session\.attach\(\{/.test(bridge),
    "B: Session is attached by transport — it is written to run headless and must never reach for "
    + "a browser global itself, so the one place that legitimately owns `document` and `navigator` "
    + "wires it");
  ok(/Session\.start\(\)/.test(bridge), "B: and STARTED — attaching without starting is a heartbeat that never beats");
  ok(/visibilitychange/.test(bridge), "B: APPLIED — with the visibility signal");
  ok(/addEventListener\("online"/.test(bridge) && /addEventListener\("offline"/.test(bridge),
    "B: APPLIED — and connectivity");
  ok(/client\.on\("sync"[\s\S]{0,400}connectionLost/.test(bridge),
    "B: APPLIED — and the SDK's ONGOING sync state. Before this the only sync listener was a "
    + "one-shot at startup that removed itself, so nothing could learn a reconnect had happened");
  ok(/Session\.enterRoom\(/.test(bridge), "B: a room change resets the phase");
  ok(/Session\.replayFinished\(\)/.test(bridge),
    "B: APPLIED — and replay finishing is announced. Not LIVE directly: a long replay may have a "
    + "backlog behind it, and a client folding a backlog is behind exactly as a replaying one is");
}

// ── PART C — the tombstone is recorded, PROVEN BY EXECUTION ──────────────────────────────────
// EXECUTED, not matched. A textual assertion can only see that a NAME appears — the first version
// of this stayed GREEN when the call was disabled with `if (false)`, because the string was still
// in the file. Running it is the only honest test that a mechanism is reachable.
{
  const { loadInContext } = require(path.join(__dirname, "_load.js"));
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
    "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/floor.js", "backends/backend1/continuity.js",
    "backends/backend1/history.js", "backends/backend1/settingsproof.js",
    "backends/backend1/dials.js", "backends/backend1/eventcache.js",
    "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js",
  ], { window: { location: { origin: "", pathname: "" }, addEventListener: () => {} },
       document: { addEventListener: () => {} },
       localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
       navigator: {}, indexedDB: null, Date: Date,
       setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} });

  const fakeEvent = { getId: () => "$deleted", getSender: () => "@dj:hs", getTs: () => 4242 };
  const fakeRoom = { roomId: "!events-staff:hs", name: "events-staff" };
  sb.Vouch.forgetTombstones();
  const recorded = sb.MatrixBridge._recordTombstone(fakeEvent, fakeRoom);
  const t = sb.Vouch.tombstoneFor("$deleted");
  ok(recorded === true && t !== null,
    "C: APPLIED — the tombstone is genuinely RECORDED when transport sees a redaction. This is the "
    + "half of reconstruction that was missing: a record carries content and position but cannot "
    + "carry IDENTITY, and Matrix kept it", { recorded: recorded, tomb: t });
  ok(t.sender === "@dj:hs" && t.ts === 4242 && t.roomId === "!events-staff:hs",
    "C: with the id, sender and timestamp Matrix signed", t);
  ok(t.rank === sb.Ranks.levelOf("staff"),
    "C: APPLIED — and the rank read from the CHANNEL the event was in. A rank taken from the record "
    + "instead would be a witness's OBSERVATION, and the reducer is rank-sensitive for chain "
    + "events, so a wrong one would change consensus", { got: t.rank });
  ok(bridge.indexOf("if (isRedacted) _recordTombstone") > 0,
    "C: and it is called on the REDACTION path, the only place a tombstone exists");

  // ── PART D — every concept that needs attaching, is (also EXECUTED) ────────────────────────
  sb.MatrixBridge._wireConcepts({ events_staff: "!events-staff:hs" });
  sb.Session._setPhaseForTest(sb.Session.LIVE);
  const seen = (function () { try { return sb.Continuity.check(); } catch (e) { return { state: "threw" }; } })();
  ok(seen.state !== "unattached" && seen.state !== "threw",
    "D: APPLIED — Continuity is genuinely attached. Unattached it answers 'unattached' forever "
    + "rather than reaching for a global, which is precisely what makes this observable", seen);
  // FLOOR, observed the same way. Attaching hands it a real log source; unattached it answers "I
  // hold nothing" forever. A first version of this only text-matched `Floor.attach({`, which stays
  // true when the call is disabled with `if (false)` — the same trap twice in one guard.
  sb.StreamManager._setLogForTest([{ eventId: "$a", l: 1 }, { eventId: "$b", l: 2 }]);
  const probe = sb.Floor._envProbe();
  ok(probe.logLen === 2,
    "D: APPLIED — Floor is genuinely attached: it reads the log through the source transport gave "
    + "it. Unattached its default is an empty list, which is indistinguishable from a quiet room "
    + "unless the wiring is exercised", probe);
  ok(probe.myRank !== null,
    "D: APPLIED — and it can answer what rank it holds, which is what decides whose floors bind it",
    probe);

  for (const m of ["Floor", "Continuity", "History", "SettingsProof"]) {
    ok(new RegExp(m + "\\.attach\\(\\{").test(bridge),
      "D: " + m + " is attached by transport — each is built to fail VISIBLY when unwired");
  }
  ok(/Scheduler\.attach\(\{/.test(bridge), "D: and the Scheduler");
  // THE CONSEQUENCE OF ADOPTING A FLOOR. Floor only emits; something has to act. The old engine
  // called trimToFloor inline, and moving to an emission is better only if somebody subscribes —
  // an emission nobody listens to is exactly the flag-nobody-reads failure it replaced.
  ok(/Floor\.onChange\(function \(ev\)[\s\S]{0,2000}trimToFloor/.test(bridge),
    "D: APPLIED — adopting a floor triggers the trim. Without this subscriber, forgetting silently "
    + "stops happening at all: the floor moves, nothing sheds, and the room holds everything "
    + "forever while looking perfectly healthy");

  // PROVE BEFORE TRIMMING. The seed claims which settings governed the floor's cut; the evidence
  // for that claim is the settings events at or below the cut, which is precisely what the trim
  // drops. Asking afterwards asks a question whose evidence we just destroyed — and gets "cannot
  // tell" for a reason we caused, on the one path where "cannot tell" is supposed to mean the room
  // is unusual rather than that we were careless. Order is the whole assertion here.
  //
  // ── RE-POINTED IN J35, AND THE REASON IS THE RULE ITSELF ──────────────────────────────────
  // The `SettingsProof.proveClaim` call used to sit inline in this subscriber. J35 lifted it into
  // `_proveFloorSettings()` because it is now called from two places, and this assertion — keyed to
  // the literal string inside the subscriber's slice — went red the moment the code moved while the
  // behaviour was unchanged. That is the trap `09-roadmap.md` §8 names: *code you moved is code you
  // have not tested, because the guard that covered it stayed pointed at where it used to be.* The
  // answer is to point it at the new home rather than to widen it, so both halves are pinned here:
  // the helper still proves, and the subscriber still calls it before trimming.
  {
    const h = bridge.slice(bridge.indexOf("Floor.onChange(function (ev)"));
    const iProve = h.indexOf("_proveFloorSettings()");
    const iTrim = h.indexOf("trimToFloor");
    ok(/function _proveFloorSettings\(\)[\s\S]{0,1200}SettingsProof\.proveClaim/.test(bridge),
      "D: APPLIED — the floor's settings claim is PROVED on adoption. Unwired, the verdict never "
      + "leaves not-yet-run, the forget licence is never granted, and trimToFloor returns 0 forever "
      + "while every part of the machinery reports success");
    ok(iProve >= 0, "D: APPLIED — and the subscriber is what asks for the proof");
    ok(iProve >= 0 && iTrim >= 0 && iProve < iTrim,
      "D: APPLIED — and it is proved BEFORE the trim, not after. The trim removes the evidence the "
      + "proof reads; reversing these two makes the check fail for a reason we created");
    // THE SAME ORDER ON THE READ-BACK PATH (J35). A client whose reading was too shallow pages the
    // settings channel and then asks again — and that continuation has the same obligation, for the
    // same reason. Textual here and DRIVEN in `check-settings-readback` PART C, because a string
    // index proves an order in the source and not an order at runtime.
    const iDeepen = h.indexOf("_deepenSettingsRead()");
    ok(iDeepen >= 0,
      "D: APPLIED — a proof that failed for want of READING is followed up: without this the "
      + "verdict stays unverifiable for the whole session and a thin or post-trim client never "
      + "forgets anything (09-roadmap.md J35)");
    const d = bridge.slice(bridge.indexOf("function _deepenSettingsRead()"));
    const dProve = d.indexOf("_proveFloorSettings()");
    const dTrim = d.indexOf("trimToFloor");
    ok(dProve >= 0 && dTrim >= 0 && dProve < dTrim,
      "D: APPLIED — and the read-back re-proves BEFORE it re-trims, not after");
  }

  // THE CADENCE TICK. maySeal has two triggers and the clock one was unreachable: nothing polled,
  // so the cooldown could only be evaluated when a play or skip arrived — a rate limit on the count
  // rather than a second reason to seal, while Checkpoint's own comment claimed it "covers a quiet
  // room where the count would never arrive". It could not. The tick only ASKS; maySeal still
  // refuses unless something countable changed, so an idle room is polled and declines for free.
  // Bounded to the wiring block and the teardown block respectively. An unbounded search for the
  // NAME matches the function's own definition, so deleting the call left the guard green — caught
  // by mutation, and it is the exact decorative-assertion failure this file exists to prevent.
  {
    // TWO LIFETIMES, NOT ONE FLAG. The StreamManager subscriptions are per-SESSION and `on`
    // appends without de-duplicating, so re-running them on a room change means a single play
    // triggers one floor revalidation per room ever visited. The tick is per-ROOM: it is stopped
    // on entry and must be re-armed. Putting the tick inside the subscription guard forced a
    // choice between never re-arming and re-subscribing every time — both wrong, and the second
    // silently so.
    const wire = bridge.slice(bridge.indexOf("function wireCheckpoints"));
    const wireBody = wire.slice(0, wire.indexOf("\n  }"));
    const guardStart = wireBody.indexOf("if (!_sealWired) {");
    const guardEnd = wireBody.indexOf("_sealWired = true;");
    const insideGuard = wireBody.slice(guardStart, guardEnd);
    ok(/_startSealTick\(\)/.test(wireBody),
      "D: APPLIED — the cadence tick is STARTED on room entry, so the clock trigger can actually "
      + "be asked. Without it a room that stops playing never seals again however long its "
      + "cooldown runs out for");
    ok(!/_startSealTick\(\)/.test(insideGuard),
      "D: APPLIED — and it is started OUTSIDE the once-per-session subscription guard, so a room "
      + "change re-arms the timer without re-subscribing the handlers");

    const teardown = bridge.slice(bridge.indexOf("function seedClock("));
    const teardownBody = teardown.slice(0, teardown.indexOf("\n  }"));
    ok(/_stopSealTick\(\)/.test(teardownBody),
      "D: APPLIED — it is stopped on room entry, for the same reason Scheduler.cancelAll is "
      + "called there: a timer armed against the previous room would fire against this one");
    ok(!/_sealWired\s*=\s*false/.test(teardownBody),
      "D: APPLIED — and the subscription flag is NOT cleared there. Clearing it re-subscribes "
      + "_onSpineForSeal on every room change, and nothing would ever report it: the room seals "
      + "correctly, just N times over");
  }

  // ONE SCALE FOR THE COUNT. noteAdopted banks how far the floor covers, and maySeal compares that
  // against a COUNTABLE head (the set Vouch uses, which excludes bundles). Passing a raw
  // .length here made the difference negative after every adoption in a room where roughly half
  // the log is protection traffic, so the count trigger silently needed about double its
  // configured number of new events. Both were plausible integers and nothing errored.
  {
    const h = bridge.slice(bridge.indexOf("Floor.onChange(function (ev)"));
    const call = h.slice(0, h.indexOf("Checkpoint.noteAdopted("));
    ok(/_countable\(/.test(call),
      "D: APPLIED — the count handed to noteAdopted is passed through _countable, measured the same "
      + "way as the head it will be compared against");
    ok(!/\.length\s*:\s*0;[\s\S]{0,80}noteAdopted/.test(h),
      "D: APPLIED — and it is not a raw log length, which is what made the two numbers different "
      + "scales wearing the same name");
  }

  // ── THE ADVANCE ASKS WHETHER IT MAY ──────────────────────────────────────────────────────
  // Two correct, guarded rules were reachable by nothing that advances. Session's own header names
  // "the stale-timer advance" as what it retires as a CATEGORY, yet Scheduler had two call sites,
  // both in the backend. Continuity's rule — a client missing history must not advance — was
  // consulted only by the owner's SEAL gate, so it governed whether a snapshot could be published
  // and never whether a song could be played. Both now sit behind one interface predicate.
  ok(/function mayAdvance\(\)/.test(bridge),
    "D: APPLIED — the interface exposes mayAdvance, so a feature can ask without reaching for a "
    + "backend internal that a lite or bot model would not have");
  {
    // TWO QUESTIONS, ONE DEFINITION EACH. "Am I caught up" applies to ANY send; "am I whole"
    // applies only to a chained advance. mayAdvance COMPOSES from mayAuthor rather than restating
    // the phase check, so there is one definition of caught-up and callers pick the question that
    // matches what they are doing.
    ok(/function mayAuthor\(\)/.test(bridge),
      "D: APPLIED — the interface exposes mayAuthor, the base question every send needs");
    const authFn = bridge.slice(bridge.indexOf("function mayAuthor()"));
    ok(/Session\.mayAuthor/.test(authFn.slice(0, authFn.indexOf("\n  }"))),
      "D: APPLIED — and it is the caught-up question, which no feature ever asked");

    const fn = bridge.slice(bridge.indexOf("function mayAdvance()"));
    const body = fn.slice(0, fn.indexOf("\n  }"));
    ok(/mayAuthor\(\)/.test(body),
      "D: APPLIED — and mayAdvance composes from it rather than restating the phase check");
    ok(/Continuity\.mayAdvance/.test(body),
      "D: APPLIED — adding only the am-I-whole question, which only the seal gate ever asked");
  }

  // AND EVERY SEND SITE THAT WRITES TO THE ROOM HAS A DECIDED ANSWER.
  // The Queue gate was applied to Queue because Queue was where the bug was seen. Other features
  // also send, and nobody decided whether they should ask — the same omission one level up.
  //
  // ── THE KEY IS THE SEND SITE, NOT THE FILE ────────────────────────────────────────────────
  // This table was keyed by FILE, and a per-file verdict cannot describe a file with two senders.
  // `playback.js` was recorded as "gated via mayAdvance — authors the chain itself", which is true
  // of the advance and false of `ddjp.play.len` in the same file — and `play.len` is
  // CONSENSUS-CRITICAL: it is the declaration the agreed length is cascaded from, so it gates when
  // every client in the room may advance. One row covered both and described only one.
  //
  // The precedent is directly below, in this same guard. The Queue half began as "submitSong is
  // gated" and was rewritten to walk every function, because gating one sender left the identical
  // window open behind `undeclare` and `reorder`. That lesson was applied inside one file and not
  // across the table that indexes the files. Same shape, one level up: a rule reached by some of
  // the paths that need it.
  //
  // The rule is DECIDE, not GATE. Most of these are scoped to a play instance (`pi`), so a send
  // made while behind names an instance the reducer refuses at its own fold position —
  // self-correcting, and gating them would refuse a moderator's click for no gain. That is a
  // reasonable answer. It has to BE an answer, per site, rather than a file nobody looked at.
  {
    const fs2 = fs;
    const dir = path.join(__dirname, "..", "features");
    // ── THE KEY CARRIES THE FUNCTION, AND THAT IS THIS TABLE'S THIRD WIDENING ────────────────
    // It began keyed per FILE, and a per-file verdict could not describe `playback.js`, which sends
    // the advance (gated) and `ddjp.play.len` (not) — so the TYPE joined the key. J28 produced the
    // same defect one level further down: `room.js` now sends `ddjp.room.settings` from TWO
    // functions with two correct and opposite answers — `setSettings` is an owner's deliberate
    // click and is ratified ungated, while `overrideFromFile` must ask, because it anchors a
    // checkpoint on the room's HEAD and a client that is behind does not know where that is.
    // One key, two verdicts, and the split-key assertion below is what caught it rather than a
    // reader noticing. The FUNCTION therefore joins the key too.
    //
    // Note what did NOT happen: the tempting fix was to route the override's send through
    // `setSettings` so there is one site again. That would have gated an owner's ordinary settings
    // write as a side effect of an unrelated job — re-deciding a ratified decision by accident,
    // which is worse than the collision it tidies.
    const DECIDED = {
      // reputation.js — J19. NOT gated, and for a different reason from J18's request: this is
      // not a person's click at all. A snapshot is published by the BOT, on its own schedule, and
      // a misclick gate exists to make an IRREVERSIBLE act ask a HUMAN first. There is no human
      // in this path to ask, and the act is not irreversible — a snapshot is an assertion that the
      // next one supersedes, inert to the reducer, and touching no checkpoint.
      "reputation.js|ddjp.rep.snapshot|publish": "not gated — published by the bot rather than "
        + "clicked by a person, inert to the reducer, and superseded by the next snapshot; there "
        + "is no human in this path for a confirmation to ask",
      // botsettings.js — J18. NOT gated, and that is the decision rather than an omission.
      // A misclick gate exists so an IRREVERSIBLE act asks first. A settings REQUEST is neither
      // irreversible nor an act: it is inert to the reducer (unknown type — driven state-, seed-
      // and fingerprint-identical), and by itself it changes nothing at all. What it does is ask
      // the bot, which then applies the delegation policy and may author nothing. Gating the
      // request would put a confirmation in front of asking a question, while the thing worth
      // confirming — the settings write — already sits behind the owner path's own gate.
      "botsettings.js|ddjp.bot.request|request": "not gated — a request is inert to the reducer "
        + "and authors nothing by itself; the settings write it may cause is gated where it "
        + "happens, and confirming a question is not a confirmation of anything",
      // queue.js — every one of these is gated; the per-function walk below is what proves it.
      "queue.js|ddjp.dj.join|submitSong":      "gated — the reconcile re-submits on reload; this is where the bug was seen",
      "queue.js|ddjp.dj.join|join":            "gated — the OTHER join sender, which the per-type key "
        + "collapsed into the row above. Same reconcile path, same answer; recorded separately "
        + "because sharing a verdict is a measurement, not a default",
      "queue.js|ddjp.dj.leave|leave":          "gated — same reconcile path",
      "queue.js|ddjp.dj.move|move":            "gated — same reconcile path",
      "queue.js|ddjp.dj.remove|remove":        "gated — same reconcile path",
      "queue.js|ddjp.dj.strike|strike":        "gated — same reconcile path",
      "queue.js|ddjp.dj.reset|reset":          "gated — same reconcile path",
      "queue.js|ddjp.dj.order|reorder":        "gated — the reconcile reaches the room through this one too",
      "queue.js|ddjp.dj.undeclare|undeclare":  "gated — the reconcile reaches the room through this one too",

      // playback.js — TWO senders, TWO answers. This pair is why the table is keyed per site.
      "playback.js|ddjp.dj.play|_emitPlay":   "gated via mayAdvance, asked at FIRE time — authors the chain itself",
      "playback.js|ddjp.play.len|setDuration":  "NOT gated. RATIFIED, and DRIVEN rather than reasoned — this "
        + "is the answer the table concealed while it was keyed per file, and it is the one send "
        + "site here that is consensus-critical, since the agreed length gates when every client "
        + "in the room may advance. Measured: a behind client declaring for the pi it still thinks "
        + "is live is REFUSED at its own fold position (the reducer takes a declaration only if it "
        + "names the playing that is live THERE), so it is not folded, not protected, and cannot "
        + "move the gate — while the same declaration one detail changed, naming the live pi, is "
        + "admitted and does move it. The refusal is therefore attributable to the rule and not to "
        + "a probe that missed the reducer. So a gate would buy nothing. It would also COST: "
        + "`setDuration` has no retry path, so refusing there is a DROP rather than a deferral "
        + "(paths.md 8c), and a dropped declaration leaves the room on its grace floor for that "
        + "song. Gating this properly means gate PLUS deferral, which is app code with its own "
        + "guard — not a line slipped into a cleanup. If that is ever wanted it is a job, not an "
        + "edit to this row",

      // mediablocked.js — also two senders, and the second one is an ADVANCE.
      "mediablocked.js|ddjp.play.blocked|_reportNow": "not gated — scoped to `pi`, re-checked at fire time",
      "mediablocked.js|ddjp.media.skip|_maybeAuthorSkip":   "not gated — and this is an ADVANCE, so the restraint "
        + "(`a client that knows it is missing history must not advance`) applies to it in words "
        + "and is not asked in code. DRIVEN rather than assumed: corroborated-short WITH a current "
        + "head is reachable — an advance naming a parent I never held leaves my own head exactly "
        + "where the room's is, so `Continuity` says short while the advance lock would accept. The "
        + "restraint is genuinely bypassed here. What bounds it is that the event names the head "
        + "the room agrees on, so it cannot fork anybody; a gap INSIDE my accepted chain leaves my "
        + "head stale instead and the lock refuses me. A rule with a hole, not a live fork",

      "medialength.js|ddjp.media.len|_answerNow":     "not gated — display-level and reducer-inert",
      "reactions.js|ddjp.dj.vote|vote":         "not gated — display-level, scoped to `pi`",
      "reactions.js|ddjp.dj.save|recordSave":         "not gated — display-level, scoped to `pi`",
      "room.js|ddjp.room.settings|setSettings": "not gated — owner settings, a deliberate click, not a reconcile",
      "room.js|ddjp.room.settings|createFromFile": "not gated — the room was created by this client "
        + "seconds ago and has no head to be behind, so there is nothing for a caught-up question to "
        + "mean here. This is the site J27 shipped",
      "room.js|ddjp.room.settings|overrideFromFile": "gated — J28, and the one row in this table "
        + "where the answer differs from its own file-mate for a reason about the ROOM rather than "
        + "about the event. The send is a settings post like `setSettings`, but what it is FOR is an "
        + "anchor: the checkpoint published immediately after names this event's position as the "
        + "room's new origin, and every client that adopts it stops folding its own history below "
        + "that cut. A client that is still replaying does not know where the head is, so it would "
        + "anchor the origin at a position the room has already moved past. Asked through "
        + "`MatrixBridge.mayAuthor()` because features may not reach `Session` (boundaries rule F), "
        + "and the refusal is RETURNED rather than dropped, so the click can say why nothing happened",
      "roomupgrade.js|ddjp.room.upgrade.start|upgrade": "not gated — owner batch creation, deliberate and rate-limited",
      "room.js|ddjp.room.settings|create": "not gated — the genesis settings post inside room "
        + "creation. There is no room to be behind yet, which is the same reason `createFromFile` "
        + "is ungated one row up",
      "roomupgrade.js|ddjp.room.upgrade.done|upgrade":  "not gated — owner batch creation, deliberate and rate-limited",
      "roomupgrade.js|ddjp.room.upgrade.done|recordCreation": "not gated — the SECOND `upgrade.done` "
        + "sender, collapsed into the row above by the per-type key. Same answer, recorded on its own",
      "skip.js|ddjp.dj.skip|skip":              "not gated — carries `p`; a stale instance is dropped by the advance lock",
    };
    // The type is the second argument. A send whose type is not a string LITERAL cannot be
    // classified, so it FAILS rather than being skipped — the same rule the entries themselves are
    // held to, since an unclassifiable site is as invisible as an unlisted one.
    //
    // ── AND THE ROW'S VERDICT IS CHECKED AGAINST THE CODE, NOT ONLY ITS KEY ─────────────────
    // The first version of this table asserted that every site HAD a row and that no row was
    // stale, and read nothing of what a row SAID. Flipping "NOT gated" to "gated" on the one row
    // carrying a ratification left the whole suite green — so the decision lived in a string one
    // word away from stating its own opposite, and "changing it turns the guard red" was true of
    // the KEY and false of the VALUE. That is the shape of a guard covering the axis it was built
    // for while reading as though it covers one it does not.
    //
    // So a row must DECLARE its verdict — it starts with `gated` or `not gated` — and the scan
    // resolves the same question independently, from the source.
    //
    // THE GATE IS OFTEN NOT IN THE SENDING FUNCTION, which is why this is not a proximity check.
    // `_emitPlay` holds the advance send and no gate; the gate is in `_maybeAdvance`, which calls
    // it only after asking `MatrixBridge.mayAdvance()` at fire time. So a site resolves through
    // its enclosing function and then ONE HOP to any function in the same file that calls it.
    // A same-function rule would report the advance as ungated — a false red, which is worse than
    // no check, because the fix for a false red is usually to loosen the guard.
    const SEND_RE = /MatrixBridge\.sendEvent\(\s*([^,]+),\s*("([^"]+)"|[A-Za-z_$][\w.$]*)/g;
    const FN_RE = /^  (?:async )?function (\w+)\s*\(/gm;
    const GATES = ["_mayWrite(", "MatrixBridge.mayAuthor(", "MatrixBridge.mayAdvance("];
    // ── GATES ARE RESOLVED AGAINST CODE, NOT AGAINST PROSE ───────────────────────────────────
    // A function's span runs to the NEXT function header, so the doc comment introducing the next
    // function sits inside the previous one's span. This guard read that span raw, so a comment
    // merely NAMING `MatrixBridge.mayAuthor()` resolved its neighbour as gated — the textual-guard
    // failure this codebase already names in two other places (a regex matching a definition rather
    // than a call; `check-advance-notify` staying green on a type name left in a comment).
    //
    // FOUND BY BEING BITTEN, NOT BY READING. J28's `overrideFromFile` carries a comment explaining
    // WHY it asks `mayAuthor`, and that comment made `createFromFile` — the function above it,
    // which correctly asks nothing — report as gated, and `create` with it through the one-hop
    // rule. Two false verdicts from one paragraph of English. Comments are stripped first, so what
    // a row is checked against is what runs.
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const calls = (body, name) =>
      new RegExp("(^|[^\\w.$])" + name + "\\s*\\(").test(strip(body));
    const hasGate = (body) => { const b = strip(body); return GATES.some((g) => b.indexOf(g) >= 0); };

    const undecided = [], nonLiteral = [], unresolved = [], mismatched = [], malformed = [];
    const found = new Set();
    const byKey = new Map();          // key -> Set of resolved verdicts, to catch a split key
    let files = 0;
    for (const f of fs2.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs2.readFileSync(path.join(dir, f), "utf8");
      if (src.indexOf("MatrixBridge.sendEvent") < 0) continue;
      files++;
      // Function spans: a header at IIFE indentation, running to the next one.
      const hs = [];
      let h;
      FN_RE.lastIndex = 0;
      while ((h = FN_RE.exec(src)) !== null) hs.push({ name: h[1], at: h.index });
      const spanOf = (i2) => ({ name: hs[i2].name, from: hs[i2].at,
                                to: (i2 + 1 < hs.length) ? hs[i2 + 1].at : src.length });
      let mm;
      SEND_RE.lastIndex = 0;
      while ((mm = SEND_RE.exec(src)) !== null) {
        if (!mm[3]) { nonLiteral.push(f + " -> " + mm[2]); continue; }
        // Resolve the site to its enclosing function FIRST, because the function is part of the
        // key. Failing to resolve one is REFUSED rather than skipped: an unresolved site is an
        // unchecked verdict wearing a checked one's badge.
        let idx = -1;
        for (let i2 = 0; i2 < hs.length; i2++) if (hs[i2].at < mm.index) idx = i2;
        const sp = (idx >= 0) ? spanOf(idx) : null;
        if (!sp || mm.index >= sp.to) { unresolved.push(f + "|" + mm[3] + "|<unresolved>"); continue; }
        const key = f + "|" + mm[3] + "|" + sp.name;
        found.add(key);
        if (!DECIDED[key]) { undecided.push(key); continue; }
        const body = src.slice(sp.from, sp.to);
        let gated = hasGate(body);
        if (!gated) {                              // ONE HOP: a caller in the same file may gate it
          for (let i2 = 0; i2 < hs.length && !gated; i2++) {
            const o = spanOf(i2);
            if (o.name === sp.name) continue;
            const ob = src.slice(o.from, o.to);
            if (calls(ob, sp.name) && hasGate(ob)) gated = true;
          }
        }
        (byKey.get(key) || byKey.set(key, new Set()).get(key)).add(gated);
        const row = String(DECIDED[key]);
        const saysNot = /^not gated/i.test(row), saysGated = /^gated/i.test(row);
        if (!saysNot && !saysGated) { malformed.push(key); continue; }
        if (saysGated !== gated) {
          mismatched.push(key + ": row says " + (saysGated ? "gated" : "NOT gated") +
                          ", code says " + (gated ? "gated" : "NOT gated"));
        }
      }
    }
    ok(files >= 6 && found.size >= 12,
      "D: the sender scan actually found the send sites that write", { files, sites: found.size });
    ok(nonLiteral.length === 0,
      "D: every send site must name its event type as a string literal, or it cannot be classified "
      + "and the decision cannot be recorded against it", nonLiteral);
    ok(undecided.length === 0,
      "D: APPLIED — every SEND SITE that writes to the room has a recorded decision about whether "
      + "it asks first. Per FILE was not enough: playback.js sends the advance (gated) and "
      + "ddjp.play.len (not), and one row described both", undecided);
    ok(unresolved.length === 0,
      "D: every send site must resolve to an enclosing function, or its verdict is unchecked while "
      + "looking checked", unresolved);
    ok(malformed.length === 0,
      "D: every recorded decision must OPEN with `gated` or `not gated`. A row that states its "
      + "verdict only in prose cannot be checked against the code, which is how a ratification "
      + "comes to live in a string nothing reads", malformed);
    // A key whose sites disagree cannot be described by one row — the original defect, one level
    // down. Splitting the key is the fix, exactly as splitting the file was.
    const split = [];
    for (const [k, set] of byKey) if (set.size > 1) split.push(k);
    ok(split.length === 0,
      "D: every send site sharing a key must resolve to the SAME verdict. Two sites with one row "
      + "is the per-file defect again, one level down — the row must be split", split);
    ok(mismatched.length === 0,
      "D: APPLIED — every row's VERDICT matches the code. The key being present is not the check; "
      + "the row is what carries the decision, and this row set carries a ratification "
      + "(playback.js|ddjp.play.len). Resolution follows the enclosing function and one hop to a "
      + "caller, because the advance's gate sits in `_maybeAdvance` and its send in `_emitPlay`",
      mismatched);
    // And the table must not outlive the code. A row for a site that no longer exists is the same
    // rot from the other side — it reads as a decision covering something, and covers nothing.
    const stale = Object.keys(DECIDED).filter((k) => !found.has(k));
    ok(stale.length === 0,
      "D: APPLIED — every recorded decision names a send site that still exists. A row nobody "
      + "matches is a decision about nothing, which reads exactly like a decision about something",
      stale);
  }

  // AND EVERY QUEUE SENDER ASKS — not just the one that was noticed first.
  // Gating submitSong alone left the same window open behind undeclare and reorder, which the
  // reconcile also calls. A room diverged again on reload with only submitSong gated: the advance
  // chain agreed while the ROTATION did not, which is what one client holding queue events the
  // other refused looks like from outside.
  {
    const q = rd("features/queue.js");
    const ungated = [];
    for (const m of q.matchAll(/async function (\w+)\(([\s\S]*?)\n  \}/g)) {
      const name = m[1], body = m[2];
      if (body.indexOf("sendEvent") < 0) continue;          // not a room writer
      const iAsk = body.indexOf("_mayWrite");
      const iSend = body.indexOf("sendEvent");
      if (iAsk < 0 || iAsk > iSend) ungated.push(name);
    }
    ok(ungated.length === 0,
      "D: APPLIED — EVERY function in Queue that writes to the room asks whether it may, before it "
      + "sends. One ungated sender is the whole window: the reconcile reaches the room through "
      + "several of them and only needs one to still be open", ungated);
  }

  // AND THE ADVANCE PATH ACTUALLY CALLS IT. The rule existing on the interface changes nothing if
  // playback does not ask — which was the entire shape of the original bug, one layer down.
  {
    const pb = rd("features/playback.js");
    const i = pb.indexOf("function _maybeAdvance");
    const body = pb.slice(i, pb.indexOf("\n  function ", i + 10));
    const iAsk = body.indexOf("MatrixBridge.mayAdvance");
    const iEmit = body.indexOf("_emitPlay(");
    ok(iAsk >= 0, "D: APPLIED — _maybeAdvance asks mayAdvance");
    ok(iAsk >= 0 && iEmit >= 0 && iAsk < iEmit,
      "D: APPLIED — and it asks BEFORE emitting the play, not after. Asking afterwards would "
      + "publish the event this check exists to withhold");
    ok(/_setHold\(/.test(body),
      "D: APPLIED — and a refusal is published rather than swallowed. To the user the music simply "
      + "stopped, and silence makes a deliberate hold indistinguishable from a bug");
  }

  // ── FEDERATION IS NOT ONE PROVIDER ───────────────────────────────────────────────────────
  // `via` on m.space.child tells a joining client which servers can reach the child room. It was
  // hardcoded to "matrix.org", which pinned every room this app creates to one provider
  // UNDERNEATH every other guarantee: a self-hosted room advertised a server that had never heard
  // of it, and a matrix.org outage broke rooms with no relationship to matrix.org. Executed rather
  // than grepped, because "the literal is gone" and "the right servers are advertised" are
  // different claims.
  {
    const { loadInContext } = require(path.join(__dirname, "_load.js"));
    const sb = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
      "backends/backend1/matrixbridge.js"], {});
    sb.MatrixBridge._setClientForTest({ getUserId: () => "@me:my.server.tld" });

    ok(JSON.stringify(sb.MatrixBridge._viaFor("!abc:my.server.tld")) === JSON.stringify(["my.server.tld"]),
      "D: a self-hosted room advertises ITS OWN server, not somebody else's",
      sb.MatrixBridge._viaFor("!abc:my.server.tld"));

    const far = sb.MatrixBridge._viaFor("!xyz:other.example");
    ok(far[0] === "other.example" && far.indexOf("my.server.tld") > 0,
      "D: APPLIED — a room on another server advertises that server FIRST (it necessarily holds "
      + "the room) with ours as a fallback, since we are a member and can be asked", far);

    ok(JSON.stringify(sb.MatrixBridge._viaFor("bogus")) === JSON.stringify(["my.server.tld"]),
      "D: APPLIED — and a malformed id degrades to our own server rather than to an empty list, "
      + "which would leave a joiner with nowhere to ask", sb.MatrixBridge._viaFor("bogus"));

    ok(!/via:\s*\[\s*"matrix\.org"/.test(bridge),
      "D: APPLIED — and no provider is named in the source at all. There is no correct constant "
      + "here, which is exactly why the constant was wrong");
  }

  // AND ACCEPTING ONE RESETS MY CLOCK. This single line is what makes the cascade a cascade with
  // no coordination protocol: the owner seals first, everyone adopts, everyone's cooldown resets,
  // so nobody below is due for another full cooldown and the owner alone keeps sealing. The
  // degradation needs no code either — when the owner leaves, nothing resets anyone's clock, it
  // simply runs out and substitutes take over.
  // BOUNDED BY THE HANDLER, NOT BY A CHARACTER COUNT. This read `{0,5000}` and went red when a
  // comment was added inside the handler — the assertion was measuring prose length, not wiring.
  // A distance bound on a source scan is a slow trap: it passes until someone explains something,
  // and then reports a wiring fault that does not exist.
  ok(/Floor\.onChange\(function \(ev\)[\s\S]*?Checkpoint\.noteAdopted\(/.test(bridge),
    "D: APPLIED — adopting a floor resets the seal cooldown. Without it every client stays due and "
    + "the room pays for the same stretch once per participant, which is the waste the cascade "
    + "exists to remove");

  // AND LOSING ONE MEANS GOING BACK. The other half of the same lesson: the floor ANNOUNCES
  // `demoted`/`withdrawn` and something must act, or a client that lost its floor sits there having
  // noticed and done nothing — which is precisely where these mechanisms already were. This said
  // "needsRepage goes true" until J02 deleted that flag; the listener always keyed on the emission.
  ok(/Floor\.onChange\(function \(ev\)[\s\S]{0,500}thinJoin/.test(bridge),
    "D: APPLIED — losing a floor triggers a re-page. The pager reads the raw cache first, because "
    + "trimming the derived log never dropped those, so the common case needs no network");

  ok(/Scheduler\.cancelAll\(\)/.test(bridge),
    "D: APPLIED — with ONE owner for 'the room changed'. In the old tree six modules each "
    + "remembered to clear their own timer, and forgetting one let a wait from the previous room "
    + "defer an action in the next");
}

// ── PART E — the phase machine sees events ───────────────────────────────────────────────────
{
  ok(/Session\.sawEvent\(\)/.test(stream),
    "E: APPLIED — every ingested event tells Session. It only matters while catching up, where it "
    + "keeps the settle window open for as long as the burst lasts — which is what stops a client "
    + "still draining a backlog from acting as though it knows the present");
}

// ── PART F — the voucher-restore path is ALIVE ───────────────────────────────────────────────
// Found during the swap: both branches that restore a redacted event from a submitted voucher were
// gated on `typeof VouchVerify !== "undefined"`. That module is gone, so both were permanently
// false — the feature was still in the file, still readable, and could never run. A dead branch
// behind a `typeof` guard is the quietest way to lose a feature there is: nothing throws, nothing
// logs, and the code looks present.
{
  ok(!/VouchVerify/.test(bridge),
    "F: APPLIED — no branch may be gated on a module that no longer exists. The guard would be "
    + "permanently false and the code inside it permanently unreachable");
  ok(/_addVoucherRecord\(/.test(bridge) && /function _addVoucherRecord/.test(bridge),
    "F: APPLIED — and the attribution helper is DEFINED, not merely called. It lives here rather "
    + "than behind the trust seam because it picks a face to show a human, and nothing computed "
    + "depends on it");
  ok(/function _selectVoucher/.test(bridge),
    "F: with its tie-break, so the same set always names the same voucher and the flag does not "
    + "flicker between equals as messages arrive in different orders");
}

// ── PART G — the seal hold is STAMPED, and sealing keeps ONE ladder ──────────────────────────
// Ported from check-seal-witness-race and check-seal-stagger. Both are anti-erosion: they guard
// against a mechanism quietly detaching, which is invisible at runtime.
{
  // A deletion detected inside my own window must start the seal hold, or a client seals a segment
  // that is still repairing and everyone adopts a short seed. `_flagIntegrity` is where a hole is
  // noticed, so it is where the clock has to be stamped — noticing without stamping is the
  // detection-without-response split in its most expensive form.
  const i = bridge.indexOf("function _flagIntegrity");
  ok(i > 0, "G: _flagIntegrity not found (renamed? this guard must be updated)");
  const body = bridge.slice(i, bridge.indexOf("\n  function ", i + 10));
  ok(/startsSealHold\s*\(/.test(body),
    "G: APPLIED — _flagIntegrity must consult startsSealHold. Only a DETECTED deletion starts the "
    + "hold; routine under-coverage must not, or the room stops sealing whenever anyone is behind");
  ok(/holeStampAt|_holeAt|holeClock/.test(body),
    "G: APPLIED — and stamp the clock, so the hold has a start and can therefore END. A hold with "
    + "no clock is not a delay, it is a stop", body.slice(0, 200));

  // AND THE NEW MODULE MUST BE HANDED IT. The hold lives in transport because it is about what
  // this client OBSERVED; the seal gate lives in Checkpoint because it is about what may be
  // published. The seam between them is the one thing that can silently come apart.
  ok(/Checkpoint\.attach\(\{[\s\S]{0,900}holdForWitness:/.test(bridge),
    "G: APPLIED — Checkpoint is handed the hold. Without it the gate is simply absent, and the "
    + "owner — whose floor everyone adopts WITHOUT recompute — is exactly who seals short");

  // ONE LADDER. Seven hand-rolled stagger ladders were consolidated into a single primitive; the
  // way that erodes is a module growing its own again, one plausible special case at a time.
  const cp = rd("backends/backend1/checkpoint.js");
  ok(/Ranks\.staggerMs|Scheduler\.(slotMs|plan)/.test(cp),
    "G: sealing delegates to the one stagger primitive rather than timing itself");
  ok(!/Math\.random\(\)\s*\*/.test(cp),
    "G: APPLIED — and has not grown a ladder of its own. A second copy of the spread is how the "
    + "seven became seven in the first place");
}

// ── PART H — THE HOLD IS ONE BOUNDED WAIT PER GAP, NOT A REFRESHING WINDOW ───────────────────
// Ported from check-seal-hold-bounded, which REVERSED a documented decision. The old comment said
// an indefinite defer was deliberate and warned against capping it: "a cap hands whoever can time
// deletions a guaranteed seal window, which is the race itself."
//
// The reversal is a cost argument, and it is worth keeping because the rule looks wrong without it:
//
//   INDEFINITE  attacker cost: keep deleting YOUR OWN events. In Matrix a user may always redact
//               their own, whatever `redact` is set to — so this is EVERY participant.
//               Outcome: the room never seals, nobody forgets, thin clients become impossible.
//   WAIT ONCE   attacker cost: delete AND stop the re-broadcast reaching the sealer, which is
//               delivery control — homeserver level.
//               Outcome: one event lost below the floor.
//
// The indefinite version loses to a much cheaper attack than the one it prevents. That was
// tolerable while sealing was optional; once the floor is what everyone computes from,
// denial-of-sealing is denial-of-service for the whole room. The wait protects against RECOVERABLE
// ACCIDENTAL loss — against a determined attacker you were always going to lose something, and the
// question is only whether you lose the event or the room.
{
  const { loadInContext: L } = require(path.join(__dirname, "_load.js"));
  const b = L(["core/logger.js", "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
               "backends/backend1/trustpolicy.js", "core/playlistdoc.js", "backends/backend1/session.js",
               "backends/backend1/scheduler.js", "backends/backend1/vouch.js",
               "backends/backend1/statederiver.js", "backends/backend1/checkpointformat.js",
               "backends/backend1/floor.js", "backends/backend1/eventcache.js",
               "backends/backend1/streammanager.js", "backends/backend1/matrixbridge.js"],
              { window: { location: { origin: "", pathname: "" }, addEventListener: () => {} },
                document: { addEventListener: () => {} },
                localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
                navigator: {}, indexedDB: null, Date: Date,
                setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {} });
  const MB = b.MatrixBridge, CYCLE = 6000;

  ok(MB.holeStampAt(0, 1000, 1000, CYCLE) === 1000,
    "H: the FIRST hole starts the wait");
  ok(MB.holeStampAt(1000, 3000, 3000, CYCLE) === 1000,
    "H: APPLIED — a hole arriving DURING the wait must NOT move the clock. Refreshing it lets "
    + "anyone who can delete their own messages — which is everyone — defer sealing forever, and "
    + "the room then never forgets anything");
  ok(MB.holeStampAt(1000, 6999, 6999, CYCLE) === 1000,
    "H: nor does one arriving just before it lapses");
  ok(MB.holeStampAt(1000, 8000, 8000, CYCLE) === 8000,
    "H: APPLIED — but once the wait has LAPSED, a new hole starts a new one. The bound is per gap, "
    + "not per room");
}

// ── PART I — THE TWO HALVES OF RECONSTRUCTION ARE JOINED ─────────────────────────────────────
// Found in the final audit, by asking which exported mechanisms have no caller at all.
//
// `repairFrom` restores CONTENT — and that alone is restore-material, because the reducer keys
// members, ranks and DJ attribution by SENDER, and a record commits the sender without letting you
// open it. The TOMBSTONE is the other half: a redaction leaves the event id, the sender and the
// room id behind, signed, and the room is the channel and the channel is the rank.
//
// Both halves were built. Both were guarded. Nothing put them together — the tombstone was
// recorded and the content was recovered and they never met. That is the shape of nearly every bug
// this project has found: each part correct, the JOIN missing, and no test failing because every
// test was of a part.
{
  ok(/Vouch\.reconstruct\(/.test(bridge),
    "I: APPLIED — the repair path must actually CALL reconstruct. Without it the mechanism stops "
    + "one step short and a deleted event stays out of history forever, while both halves report "
    + "themselves working");
  const i = bridge.indexOf("Vouch.reconstruct(");
  const region = bridge.slice(i, i + 500);
  ok(/StreamManager\.ingest\(/.test(region),
    "I: APPLIED — and a reconstructed event goes into the TIMELINE, not only the cache. Storing it "
    + "in the cache alone is what a content-only rebuild already did; the point of the tombstone is "
    + "that this one can be folded", region.slice(0, 200));
}

// ── PART J — THE VOUCH PASS GOES THROUGH THE SCHEDULER ───────────────────────────────────────
// The one job the Scheduler was built for. A bare timer here has three silent failure modes: it
// fires after a sleep against a room that moved hours ago; it acts on the rank held when the pass
// was SCHEDULED, so sleeping through a promotion publishes under the old rank; and it runs while
// the client is still draining a backlog, which is not the present.
{
  ok(/Scheduler\.plan\("vouch:proactive"/.test(bridge),
    "J: APPLIED — the proactive vouch pass is planned through the Scheduler, not a raw setTimeout");
  const i = bridge.indexOf('Scheduler.plan("vouch:proactive"');
  const spec = bridge.slice(i, i + 1600);
  ok(/rank:\s*\(\)\s*=>/.test(spec),
    "J: APPLIED — rank is a GETTER, read at fire time. Capturing it is exactly the bug: the old "
    + "pass re-read the event list and captured the rank, so it did half the job and looked done");
  ok(/stillNeeded:\s*\(\)\s*=>/.test(spec),
    "J: and the re-check is supplied — the stagger creates an observation window and this is the "
    + "thing that uses it");
  ok(/Vouch\.owed\(/.test(spec),
    "J: APPLIED — the re-check asks what is STILL owed rather than assuming the plan is valid. If "
    + "the room covered it while we waited, we send nothing");
}

// ── EVERY TYPE A FEATURE EMITS MUST HAVE A DELIBERATE CLASSIFICATION ─────────────────────────
// NON_CRITICAL_TYPES is an EXCLUSION list: absence means critical, the safe default for a new
// consensus event. Getting it wrong the other way is quieter, and was paid for real —
// ddjp.media.len, a reducer-inert display countdown emitted once per song, was dropped from the
// list on the strength of a comment about its RETIRED partner. Nothing errored. Protection began
// to be spent vouching a display event, and _countable started counting it toward the checkpoint
// cadence: frequent traffic that changes nothing convincing the room it had fallen behind, which
// is the self-amplifying mistake the note in maySeal describes for bundles.
//
// THE RULE IS "DECIDE", NOT "EXCLUDE", and the difference matters. A first version of this asserted
// that anything reducer-inert MUST be excluded, and immediately flagged the two room-upgrade
// markers — which are emitted at most TWICE in a room's whole life, behind a two-hour cooldown, and
// gate a real policy. Protecting those costs nothing and losing one matters, so critical is the
// right answer for them and the derived rule was simply wrong. Frequency is what makes a misfiling
// expensive, and frequency is not derivable from source.
//
// So: every emitted type must be handled by the reducer, excluded from protection, or listed here
// with a reason. Adding a type forces a decision instead of inheriting one.
{
  const dir = path.join(__dirname, "..", "features");
  const emitted = new Set();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    for (const m of src.matchAll(/sendEvent\(\s*[^,]+,\s*"(ddjp\.[a-z.]+)"/g)) emitted.add(m[1]);
  }
  ok(emitted.size > 0, "D: the emitted-type scan found something to check", [...emitted]);

  const { loadInContext } = require(path.join(__dirname, "_load.js"));
  const sbT = loadInContext(["core/logger.js", "backends/backend1/ranks.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/consensushash.js",
    "backends/backend1/vouch.js", "backends/backend1/statederiver.js"], {});
  const handled = new Set(sbT.StateDeriver.HANDLED_TYPES);
  const nonCritical = new Set(sbT.Vouch.NON_CRITICAL_TYPES);

  // Reducer-inert and DELIBERATELY critical. Each needs a reason that survives reading.
  const ACKNOWLEDGED = {
    "ddjp.room.upgrade.start": "at most twice per room, behind a 2h cooldown; gates a real policy",
    "ddjp.room.upgrade.done":  "same — rare and structural, so protection costs nothing",
    "ddjp.voucher":            "recovery TRANSPORT, never persisted to the log at all",
  };
  const undecided = [...emitted].filter((t) =>
    !handled.has(t) && !nonCritical.has(t) && !ACKNOWLEDGED[t] && t !== sbT.Vouch.BUNDLE_TYPE);
  ok(undecided.length === 0,
    "D: APPLIED — no feature emits a type whose classification nobody decided. An unlisted one is "
    + "being vouched and counted toward the seal cadence by DEFAULT, which is right for a rare "
    + "structural event and wrong for anything sent per song", undecided);

  ok(nonCritical.has("ddjp.media.len"),
    "D: APPLIED — and media.len specifically is excluded. It is emitted once per song and changes "
    + "no derived state, so treating it as critical spends protection on nothing and inflates the "
    + "checkpoint cadence with display traffic");
}

console.log("[wiring] PASS — the new layer is reachable from a running client, not merely correct "
  + "in isolation: all ten modules are in the page's load order with both real load-time "
  + "constraints satisfied and one version tag throughout; Session is attached AND started with "
  + "visibility, connectivity and the SDK's ongoing sync state, where before nothing anywhere could "
  + "learn a reconnect had happened; the TOMBSTONE is recorded on the redaction path with the rank "
  + "taken from the channel rather than from a witness; every concept that must be attached is; and "
  + "the phase machine sees every ingested event");
