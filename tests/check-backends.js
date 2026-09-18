// tests/check-backends.js
// SUBJECT: core/backends.js, backends/backend2/skeleton.js, features/room.js, index.html
//
// THE BACKEND SEAM (J23). A room declares its consensus engine at creation and the app binds that
// engine on join. This guard exists because the seam's failure mode is the one this tree has
// already shipped once: `ddjp_hashref` was a per-room flag whose branch nothing exercised, it read
// as care, and it was deleted along with the compatibility it existed for.
// `consensus/backend-selection.md` opens by warning the mode marker recreates exactly that unless
// a second engine is real — so PART B BINDS THE OTHER ENGINE. A switch asserted to exist and never
// thrown is the thing the design doc is afraid of.
//
// WHAT IS DRIVEN AND WHAT IS PINNED, stated so neither is read as more than it is:
//   PART A  driven — the real `core/backends.js`, in its own context, flipped both ways.
//   PART B  driven — the real `backends/backend2/skeleton.js`, registered and bound.
//   PART C  driven — the real `features/room.js`, against the real registry, for the refusals and
//                    for bound-mode-equals-marker.
//   PART D  static — order and reach inside files a headless run cannot execute (`matrixbridge.js`
//                    needs a live SDK, `index.html` needs a browser).
//   PART E  static — no concrete backend named outside the registry.
//
// WHAT IT CANNOT TELL YOU: that either engine is CORRECT, or that a browser can open a room at
// all. Ten of ten original defects here came from a person at a screen.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { loadInContext } = require("./_load");

const ROOT = path.join(__dirname, "..");
let checks = 0;
function ok(c, m, extra) {
  assert.ok(c, "[backends] FAIL — " + m + (extra !== undefined ? "\n      got " + JSON.stringify(extra) : ""));
  checks++;
}
const code = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");   // scan CODE, never prose

// Build the real seam in a fresh context. `withSkeleton` also loads the real backend2 file, so
// PART B is testing the shipped engine rather than a description of it.
function freshSeam(withSkeleton) {
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "core/backends.js"), "utf8"), ctx);
  if (withSkeleton) {
    // BOTH of backend2's registering files. `skeleton.js` carries three stub slots plus the channel
    // plan; `streammanager.js` owns the fourth since slice 3. A stand-in for the shared door is
    // enough here — this seam context is about REGISTRATION, and the fold itself is PART G's.
    ctx.B1StreamManager = { ingest: () => {} };
    ctx.B1MatrixBridge = { getUserId: () => "@me:hs", getUserEffectiveRank: () => 0,
                           seedClock: () => {}, setRoomScope: () => {} };
    // backend2's last two slots ARE these, shared rather than stubbed, so the seam context needs
    // them by name — the same reason the page loads `skeleton.js` after them.
    ctx.B1MatrixAccount = { login: () => {} };
    ctx.B1Capabilities = { can: () => ({ permitted: true, reason: null }) };
    ctx.B2StreamManager = { setFoldScope: () => {} };
    ctx.B2Runner = { start: () => ({ ok: false, reason: "test context" }) };
    ctx.Logger = { info: () => {}, error: () => {} };
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/skeleton.js"), "utf8"), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/streammanager.js"), "utf8"), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/transport.js"), "utf8"), ctx);
  }
  // A top-level `const` in a classic script is NOT a property of the global object — it lives in
  // the global lexical environment. That is the fact the whole seam is shaped around, and it means
  // `ctx.Backends` is undefined until something inside the context hands it out. Bare references
  // in `run(...)` below still resolve to the consts; this only gives the guard a handle.
  vm.runInContext("globalThis.Backends = Backends; globalThis.StreamManager = StreamManager;", ctx);
  return ctx;
}

// ── PART A — THE REGISTRY, DRIVEN ────────────────────────────────────────────────────────────
{
  const ctx = freshSeam(false);
  const run = (src) => vm.runInContext(src, ctx);

  run(`
    const ENG_A = { ping: () => "A", onlyA: () => true };
    const ENG_B = { ping: () => "B" };
    Backends.register("m-a", { StreamManager: ENG_A, MatrixBridge: ENG_A, MatrixAccount: ENG_A, Capabilities: ENG_A }, { ready: true, bootstrap: true });
    Backends.register("m-b", { StreamManager: ENG_B, MatrixBridge: ENG_B, MatrixAccount: ENG_B, Capabilities: ENG_B }, { ready: true });
    globalThis._held = StreamManager;   // a call site holding the name, as every features/ file does
  `);

  ok(run("Object.keys(StreamManager).length === 0"),
    "A: the four names must be EMPTY before anything binds — a shell that arrives pre-filled is a " +
    "hardwire wearing the seam's clothes");

  run(`Backends.bindBootstrap();`);
  ok(run(`Backends.active() === "m-a" && StreamManager.ping() === "A"`),
    "A: bindBootstrap binds the engine that registered itself as bootstrap");

  // THE LOAD-BEARING PROPERTY. ~400 call sites in features/ hold these names; if binding replaced
  // the OBJECT rather than its contents, every one of them would keep the old engine forever and
  // the app would look like it switched while running the previous room's model.
  run(`Backends.bind("m-b");`);
  ok(run(`StreamManager.ping() === "B"`), "A: binding a second engine moves the interface name");
  ok(run(`globalThis._held === StreamManager && globalThis._held.ping() === "B"`),
    "A: OBJECT IDENTITY SURVIVES THE SWAP. A reference taken before the bind sees the new engine — " +
    "this is the entire reason features/ needed no edit, and if it breaks the failure is silent");
  ok(run(`StreamManager.onlyA === undefined`),
    "A: bind REPLACES and never merges — a slot the incoming engine does not define must not be " +
    "served by the outgoing one, or one engine answers for another and the room looks like it works");
  ok(run(`MatrixBridge.ping() === "B" && MatrixAccount.ping() === "B" && Capabilities.ping() === "B"`),
    "A: all FOUR names move together. This list said THREE in every doc in the tree until ddjp_399; " +
    "a seam built to the old list is one `MatrixAccount` cannot pass through");

  run(`Backends.bind("m-a");`);
  ok(run(`StreamManager.ping() === "A"`), "A: and it flips back — the switch has two positions, not one");

  // Refusals.
  ok(run(`Backends.register("m-partial", { StreamManager: ENG_A }, { ready: true }); (() => { try { Backends.bind("m-partial"); return false; } catch (e) { return /missing/.test(e.message); } })()`),
    "A: an engine that fills three of four slots is REFUSED at bind, naming what is missing — not " +
    "bound and left to fail later as a missing method a long way from the cause");
  ok(run(`(() => { try { Backends.bind("nope"); return false; } catch (e) { return true; } })()`),
    "A: an unregistered mode is refused rather than silently ignored");
  ok(run(`Backends.isReady("m-a") === true && Backends.isReady("m-partial") === false`),
    "A: readiness accounts for BOTH the flag and the slots, so a complete-but-unfinished engine and " +
    "an incomplete one are both correctly not-ready");

  // The resolver.
  ok(run(`Backends.resolveMode({ ddjp_mode: "m-b" }) === "m-b"`), "A: a marked room resolves to its mode");
  ok(run(`Backends.resolveMode({}) === null && Backends.resolveMode(null) === null && Backends.resolveMode({ ddjp_mode: 7 }) === null`),
    "A: an unmarked room resolves to NOTHING. There is deliberately no fall-back to a default " +
    "engine: that was the legacy rule, this build supports no legacy rooms, and a branch that only " +
    "runs for rooms the app already refuses is the dead branch backend-selection.md warns about");
}

// ── PART B — THE SECOND ENGINE IS REAL ───────────────────────────────────────────────────────
{
  const ctx = freshSeam(true);
  const run = (src) => vm.runInContext(src, ctx);

  ok(run(`Backends.has("backend2")`),
    "B: the shipped backend2 skeleton registers itself. Without a second entry the registry is one " +
    "answer and the resolver is a constant dressed as a condition");
  ok(run(`Backends._missing("backend2").length === 0`),
    "B: it fills all four slots — so it is a real position for the switch to reach, which is the " +
    "only thing that makes PART A's flip a test of the seam rather than of two doubles",
    run(`Backends._missing("backend2")`));
  // READY AS OF THE DEPLOY THAT FLIPPED IT. This asserted `=== false` while backend2 was a skeleton.
  ok(run(`Backends.isReady("backend2") === true`),
    "B: backend2 is ready, so a room may be created for it and joined");

  ok(run(`(() => { Backends.bind("backend2"); return Backends.active() === "backend2" && StreamManager._engine === "backend2"; })()`),
    "B: binding it actually hands the interface names to backend2 — DRIVEN, because a registry " +
    "entry nothing ever binds proves nothing about the binder");

  // AND NO BOUND SLOT IS A BARE MARKER. Checked AFTER the bind, because before it these names are
  // the empty shells — an earlier placement asserted against those and failed for that reason.
  // `isReady` asks whether a slot is PRESENT, never whether it DOES anything: `{ _engine: "backend2" }`
  // satisfied it, and two slots sat exactly like that until the pre-deploy audit, with the readiness
  // flag as the only thing between a stub and a live bind. The registry cannot check substance
  // without guessing, so it is checked here.
  ok(run(`[StreamManager, MatrixBridge, MatrixAccount, Capabilities]
            .every((m) => Object.keys(m).filter((k) => k !== "_engine").length > 0)`),
    "B: and every bound slot has something in it besides its own name — a stub passes the " +
    "registry's completeness check and then breaks the first thing that calls it",
    run(`[StreamManager, MatrixBridge, MatrixAccount, Capabilities].map((m) => Object.keys(m).length)`));
}

// ── PART C — THE PRODUCTION PATH, DRIVEN ─────────────────────────────────────────────────────
// `features/room.js` against the REAL registry (handed in through the loader, so the binder under
// test is the shipped one and not the harness stand-in). The refusals run before anything is torn
// down, which is the point of where they sit, so very little needs to stand behind them.
function joinWith(createContent) {
  const seam = freshSeam(true);
  const noop = () => {};
  seam.__eng = { reset: noop, on: noop, off: noop, getState: () => ({}), getLog: () => [] };
  // A registered-but-unready engine, so the refusal for one still has something to refuse.
  vm.runInContext('Backends.register("m-unfinished", { StreamManager: __eng, MatrixBridge: __eng, ' +
    'MatrixAccount: __eng, Capabilities: __eng }, { ready: false });', seam);
  vm.runInContext('Backends.register("backend1", { StreamManager: __eng, MatrixBridge: __eng, ' +
    'MatrixAccount: __eng, Capabilities: __eng }, { ready: true, bootstrap: true });' +
    // The lobby is UP before anyone clicks a room: `app.js` binds the bootstrap engine at boot.
    // Without this the fixture starts from a state production is never in, and the assertion that
    // a refusal leaves the lobby served would be testing nothing.
    'Backends.bindBootstrap();', seam);

  const stub = new Proxy({}, { get: () => noop });   // every method exists, every one inert
  const MatrixBridge = {
    joinDDJPSpace: async () => {},
    waitForSpaceChildren: async () => {},
    getClient: () => ({ getRoom: () => ({ name: "R", currentState: { getStateEvents: () => [] } }) }),
    getCreateContent: () => createContent,
    getWriteChannelId: () => "!ev:hs",
    getMyRank: () => 20,
    seedClock: noop, resetCheckpoints: noop, setRoomScope: noop, wireCheckpoints: noop,
    setRoomLive: noop, onRankChange: noop, onChannelAdded: noop, replayRoom: async () => {},
  };
  const sb = loadInContext(["core/store.js", "backends/backend1/ranks.js", "features/room.js"], {
    Backends: seam.Backends, MatrixBridge,
    StreamManager: { reset: noop, on: noop, off: noop, getState: () => ({}), getLog: () => [] },
    Capabilities: stub, Queue: stub, Skip: stub, Playback: stub, Chat: stub, Reactions: stub,
    MediaLength: stub, MediaBlocked: stub, ServerClock: stub, UserQueue: stub, RoomUpgrade: stub,
    BotRuntime: stub, Actions: stub, StorageIO: stub, Interface: stub, Store: undefined,
    Logger: { info: noop, warn: noop, debug: noop, error: noop },
    setTimeout: () => 1, clearTimeout: noop, setInterval: () => 1, clearInterval: noop,
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  });
  return { sb, seam };
}

async function main() {
  // The three refusals, each refused for ITS OWN reason. A single catch-all message would let two
  // of these pass while the branch that produces them had collapsed into one.
  const REFUSALS = [
    [null, /created again/i, "an UNMARKED room (one made before rooms declared an engine)"],
    [{ ddjp_mode: "backend9" }, /does not have/i, "a room naming an engine this build never registered"],
    [{ ddjp_mode: "m-unfinished" }, /not finished/i, "a room naming a REGISTERED but unfinished engine"],
  ];
  for (const [content, pattern, what] of REFUSALS) {
    const { sb, seam } = joinWith(content);
    let msg = null;
    try { await sb.Room.join("!space:hs"); } catch (e) { msg = (e && e.message) || String(e); }
    ok(msg !== null, "C: joining " + what + " must be REFUSED, not entered");
    ok(pattern.test(msg), "C: and refused BY NAME, in words a person can act on, for " + what, msg);
    ok(seam.Backends.active() === "backend1",
      "C: and refused BEFORE rebinding — the bootstrap engine is still bound, so the lobby that " +
      "the refusal returns to is still served. A refusal that leaves nothing bound blanks the " +
      "saves list on the way out", seam.Backends.active());
  }

  // THE SECOND GUARD backend-selection.md §5 ASKS FOR: a room's bound mode must equal its marker.
  // A room silently run under the wrong engine is the failure this exists to make impossible.
  {
    const { sb, seam } = joinWith({ ddjp_mode: "backend1" });
    let threw = null;
    try { await sb.Room.join("!space:hs"); } catch (e) { threw = (e && e.message) || String(e); }
    ok(threw === null, "C: APPLIED — a room marked with a READY engine must actually join, or " +
      "every refusal above is free and this part would pass on a build that can enter no room at all", threw);
    ok(seam.Backends.active() === "backend1",
      "C: THE BOUND MODE EQUALS THE ROOM'S MARKER, driven end to end from the create-content read " +
      "through the resolver to the binder", seam.Backends.active());
  }
}

// ── PART D — ORDER AND REACH, PINNED ─────────────────────────────────────────────────────────
// These live in files a headless run cannot execute: `matrixbridge.js` needs a live SDK and
// `index.html` needs a browser. A text scan cannot resolve a call — that limit is recorded in
// `08-build-and-deploy.md` and it applies here too.
{
  const room = code("features/room.js");
  const init = room.slice(room.indexOf("function _initModules(room, modeId)"));
  const resetAt = init.indexOf("StreamManager.reset()");
  const bindAt = init.indexOf("Backends.bind(modeId)");
  ok(resetAt >= 0 && bindAt >= 0,
    "D: the wiring step must both reset and bind", { resetAt, bindAt });
  ok(resetAt < bindAt,
    "D: THE OUTGOING ENGINE IS RESET BEFORE THE INCOMING ONE IS BOUND. The resets act on whatever " +
    "is currently bound, which is the engine actually holding the last room's state — bind first " +
    "and they clear an engine holding nothing while the outgoing one keeps everything. Correct " +
    "code, wrong moment, which is the shape BEHAVIOUR.md opens with", { resetAt, bindAt });

  const joinBody = room.slice(room.indexOf("async function join(spaceId)"));
  ok(joinBody.indexOf("Backends.resolveMode") < joinBody.indexOf("_initModules(current"),
    "D: the mode is resolved BEFORE the wiring step, so a room that will be refused is refused " +
    "before the previous room's state is cleared for it");
  ok(/_initModules\(current, _mode\)/.test(room),
    "D: join hands the wiring step the mode it resolved — not a default, and not a second read");
  // THE PROPERTY, NOT THE SPELLING. This pinned `_initModules(current, Backends.active())` until
  // slice 2 gave `create` a mode parameter. "The active engine" was only ever a stand-in for "the
  // mode this room was created as", and those stop being the same value the moment a second engine
  // can be chosen. So the check is now that ONE value reaches both the create call and the bind:
  // the mode stamped into the room's create record and the mode bound for it cannot differ.
  const createCall = room.match(/createDDJPSpace\(\s*name\s*,\s*\w+\s*,\s*(\w+)\s*\)/);
  ok(!!createCall, "D: create must hand `createDDJPSpace` an explicit mode to build and stamp", room.slice(0, 0));
  ok(new RegExp("_initModules\\(current, " + createCall[1] + "\\)").test(room),
    "D: and must bind THAT SAME value — the mode written into the room's create record is the mode " +
    "the room runs, never whatever happened to be active", createCall[1]);

  // THE ROOM IS BUILT FROM THE PLAN IT IS STAMPED WITH. Driven as a property rather than pinned:
  // whatever identifier is written into `ddjp_mode` must be the SAME one handed to `creationPlan`.
  // Found by a planted mutation — dropping the mode from the plan call left every other assertion
  // here green while a bot room would have been built with backend1's nineteen channels and then
  // labelled `backend2`, which is a room no engine can serve and nothing would have reported.
  {
    const mb = code("backends/backend1/matrixbridge.js");
    const body = mb.slice(mb.indexOf("async function createDDJPSpace("),
                          mb.indexOf("async function joinDDJPSpace("));
    ok(body.length > 200, "D: APPLIED — createDDJPSpace must be locatable", body.length);
    const stamped = body.match(/ddjp_mode:\s*(\w+)/);
    ok(!!stamped, "D: the create record must be stamped with an identifier, not a literal");
    ok(new RegExp("creationPlan\\([^)]*\\b" + stamped[1] + "\\b").test(body),
      "D: and the CHANNEL PLAN must be taken for that same mode — a room stamped `backend2` and " +
      "built from backend1's plan is a room no engine can serve", stamped[1]);
  }

  ok(/creation_content:\s*\{[^}]*ddjp_mode:/.test(code("backends/backend1/matrixbridge.js")),
    "D: the marker is written into the Space's CREATE RECORD, which the homeserver fixes forever " +
    "at creation and which exists whatever the room's channels look like. It cannot be a room " +
    "SETTING: settings are folded out of replayed events by an engine, so reading them to choose " +
    "the engine is circular");
  // THE BOOTSTRAP BIND, WHEREVER IT LIVES. This pinned it to `app.js` until v380 moved it — the
  // property was never "app.js calls it", it was "something binds before anything reads". PART O
  // owns the ORDER; this owns that the call exists at all, and refuses to care which file.
  {
    const binders = ["core/bind-bootstrap.js", "app.js"]
      .filter((f) => /Backends\.bindBootstrap\(\)/.test(code(f)));
    ok(binders.length === 1,
      "D: exactly ONE file binds the bootstrap engine — login, discovery and the room list all run " +
      "before any room exists, and the four names are empty until something binds. Two callers for " +
      "one thing is how the first stops being where people look", binders);
  }

  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const seamTag = html.indexOf("core/backends.js");
  const firstBackend = html.indexOf('src="backends/');
  ok(seamTag >= 0 && firstBackend >= 0, "D: both the seam and the backends must be in the page");
  ok(seamTag < firstBackend,
    "D: the registry loads BEFORE any backend, because every backend module registers itself at " +
    "load and would otherwise throw before the page starts", { seamTag, firstBackend });
  ok(html.indexOf("backends/backend2/skeleton.js") >= 0,
    "D: the second engine is in the page's load order, not merely on disk");
}

// ── PART E — NOTHING OUTSIDE THE REGISTRY NAMES A CONCRETE BACKEND ───────────────────────────
// backend-selection.md §5 asks for this explicitly, mirroring check-boundaries rule F: the app
// resolves an engine only through the registry. A literal mode id above the seam is a hardwire
// that survives the seam existing.
{
  const walk = (d, out) => {
    for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
      const rel = d + "/" + e.name;
      if (e.isDirectory()) walk(rel, out);
      else if (e.name.endsWith(".js")) out.push(rel);
    }
    return out;
  };
  const above = ["features", "ui", "core"].reduce((a, d) => walk(d, a), ["app.js"]);
  const offenders = [];
  for (const rel of above) {
    if (rel === "core/backends.js") continue;   // the registry is where a mode id may be handled
    if (/["']backend\d+["']/.test(code(rel))) offenders.push(rel);
  }
  ok(offenders.length === 0,
    "E: no file above the seam may name a concrete engine — the mode comes from the room and the " +
    "engine from the registry, or the seam exists and the app is still hardwired", offenders);
}

// ── PART F — THE CHANNEL PLAN FOLLOWS THE BOUND ENGINE (J24 slice 1) ─────────────────────────
// Slice 1 moved the channel table from a constant inside backend1 to something the registry serves
// per mode, because both engines ride the SAME transport module and a bot room is seven channels
// where a decentralised one is nineteen. With one engine registered every answer is identical to
// before — which is exactly the shape of a change nothing exercises, so it is driven here against a
// second table rather than asserted.
//
// Extracted from the transport's own source: `matrixbridge.js` needs a live SDK and cannot be
// loaded headlessly, so the resolver and the derivation are sliced and run with a stub registry.
// The rows are the tree's, not this file's.
{
  const src = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const table = src.slice(src.indexOf("const B1_CHANNELS = ["), src.indexOf("// Canonical string forms"));
  const resolver = src.slice(src.indexOf("function _channels("), src.indexOf("function eventsKeyForLevel"));
  ok(table.length > 100 && resolver.length > 100,
    "F: APPLIED — the table and the resolver must be locatable, or everything below is free",
    { table: table.length, resolver: resolver.length });

  const FAKE = [
    { kind: "events", slug: "uncategorized", key: "events_uncategorized", level: 0, batch: 1 },
    { kind: "events", slug: "owner", key: "events_owner", level: 99, batch: 1 },
    { kind: "chat", slug: "uncategorized", key: "chat_uncategorized", level: 0, batch: 1 },
    { kind: "presence", slug: "chat", key: "presence_chat", level: 0, batch: 1 },
  ];
  let bound = null;
  const ctx = {
    console,
    Backends: { active: () => bound, planFor: (m) => (m === "m-fake" ? FAKE : null) },
  };
  vm.createContext(ctx);
  vm.runInContext(table + "\n" + resolver +
    "\n;globalThis.rows = () => _channels(); globalThis.d = () => _derived();" +
    "\nglobalThis.rowsFor = (m) => _channels(m); globalThis.dFor = (m) => _derived(m);", ctx);

  // EVERY EXPECTATION BELOW IS DERIVED, NOT PINNED. An earlier version of this part asserted the
  // literals 19, 6 and 3. Those are OUTCOMES of the table, not rulings about it — adding one
  // channel row would have turned this red for a reason with nothing to do with the seam, which is
  // the dead-copy failure `README.md` §Conventions names. The property under test is that the
  // derivations FOLLOW the bound table, so both sides are computed from the tables themselves.
  const b1Rows = (table.match(/\{\s*kind:\s*"/g) || []).length;
  ok(b1Rows > 10, "F: APPLIED — backend1's table must parse to a plausible row count", b1Rows);

  // Nothing bound: backend1's own table, so load order and any unbound sandbox are unaffected.
  ok(ctx.rows().length === b1Rows,
    "F: with NO engine bound the transport answers with backend1's own table — the fallback that " +
    "keeps load time and every guard sandbox working", { got: ctx.rows().length, want: b1Rows });
  const b1Batch1 = ctx.rows().filter((c) => c.batch === 1).length;
  const b1Max = Math.max.apply(null, ctx.rows().map((c) => c.batch));
  ok(ctx.d().total === b1Batch1 && ctx.d().maxBatch === b1Max,
    "F: and its derivations are readings of that table rather than a second copy of it",
    { total: ctx.d().total, want: b1Batch1, maxBatch: ctx.d().maxBatch, wantMax: b1Max });

  // A second engine bound: every derivation follows ITS table, through the same transport module.
  bound = "m-fake";
  ok(ctx.rows().length === FAKE.length && FAKE.length !== b1Rows,
    "F: binding a second engine changes the table the SHARED transport reads — this is the whole " +
    "of slice 1, and with one engine registered nothing else could show it",
    { got: ctx.rows().length, want: FAKE.length, backend1: b1Rows });
  ok(ctx.d().total === FAKE.filter((c) => c.batch === 1).length &&
     ctx.d().maxBatch === Math.max.apply(null, FAKE.map((c) => c.batch)),
    "F: and the derived creation plan follows it rather than backend1's — a room in that mode is " +
    "built from its own engine's plan", { total: ctx.d().total, maxBatch: ctx.d().maxBatch });
  ok(ctx.d().eventsKeyByLevel[99] === "events_owner" && ctx.d().eventsKeyByLevel[20] === undefined,
    "F: the rank->channel map follows too, so a rung the second engine does not have resolves to " +
    "nothing rather than to backend1's answer", ctx.d().eventsKeyByLevel);

  // Back to unbound: the fallback is not a one-way door.
  bound = null;
  ok(ctx.rows().length === b1Rows, "F: and it follows back", ctx.rows().length);

  // SLICE 2 — A NAMED MODE RESOLVES WITHOUT BEING BOUND. This is what lets a room be created in an
  // engine this client is not running. Binding first and then failing to create would leave the
  // lobby holding an engine with nothing in it, and the lobby's saves list reads through
  // `StreamManager` — the control `BEHAVIOUR.md` protects by clearing on entry and never on leave.
  ok(ctx.rowsFor("m-fake").length === FAKE.length,
    "F: a NAMED mode answers with its own plan while nothing is bound — the mode travels as a " +
    "value, so creating a bot room never requires binding one first",
    { got: ctx.rowsFor("m-fake").length, want: FAKE.length });
  ok(ctx.rows().length === b1Rows,
    "F: and asking for a named mode does not disturb what the bound engine answers",
    ctx.rows().length);
  ok(ctx.dFor("m-fake").total === FAKE.filter((c) => c.batch === 1).length,
    "F: its creation plan is that engine's too, so the room is BUILT from the plan it is stamped " +
    "with rather than from the plan the creator happens to be running", ctx.dFor("m-fake").total);
}

// ── PART G — THE AUTHORSHIP OVERRIDE (J24 slice 3) ───────────────────────────────────────────
// backend1 proves a rung by WHICH CHANNEL accepted the write. Bot mode has one events channel, so
// the actor, the rung and the moment travel in the body and this module puts them back. Driven
// against the real file: it is loaded with a recording stand-in for the shared door, so what the
// fold would receive is observed rather than asserted.
{
  const ctx = { console };
  vm.createContext(ctx);
  ctx.seen = [];
  ctx.B1StreamManager = { ingest: (e) => ctx.seen.push(e), marker: "shared" };
  ctx.Backends = { register: () => {} };
  // A required dependency since slice 5, deliberately not `typeof`-guarded in the module: a
  // checkpoint module that failed to load must fail loudly, not leave the saves list empty.
  ctx.cps = [];
  ctx.B2Checkpoint = { TYPE: "ddjp.checkpoint", observe: (cp, m) => ctx.cps.push({ cp, m }),
                       held: () => [], byId: () => null, reset: () => {} };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/streammanager.js"), "utf8"), ctx);
  vm.runInContext("globalThis.SM = B2StreamManager;", ctx);
  const SM = ctx.SM;

  ok(typeof SM.ingest === "function" && SM.marker === "shared",
    "G: APPLIED — the module must load and must carry the shared door's surface, or it is not " +
    "delegating and every assertion below is about something else", Object.keys(SM).length);

  const LOG = "!log:hs", SET = "!set:hs", INTENTS = "!intents:hs";
  const msg = (room, body) => ({
    type: "m.room.message", event_id: "$e1", room_id: room,
    sender: "@bot:hs", origin_server_ts: 9000, content: { body: JSON.stringify(body) },
  });

  // FAIL CLOSED BEFORE A SCOPE IS BOUND.
  ctx.seen.length = 0;
  SM.ingest(msg(LOG, { t: "ddjp.dj.join", l: 1, actor: "@a:hs", rank: 40, at: 100 }));
  ok(ctx.seen.length === 0,
    "G: nothing folds until a fold scope is bound — the same direction `features/room.js` fails in " +
    "when a room's readable set is unknown: closed, not open", ctx.seen.length);

  SM.setFoldScope({ events_owner: LOG, settings_owner: SET, events_uncategorized: INTENTS });

  // THE OVERRIDE.
  ctx.seen.length = 0;
  SM.ingest(msg(LOG, { t: "ddjp.dj.join", l: 7, actor: "@alice:hs", rank: 40, at: 1234 }));
  ok(ctx.seen.length === 1, "G: APPLIED — an in-scope event must reach the fold", ctx.seen.length);
  const e = ctx.seen[0];
  ok(e.sender === "@alice:hs",
    "G: the ACTOR is the sender, not the bot. Matrix says `@bot:hs` for every event in the log, so " +
    "reading the Matrix sender would attribute the whole room to the bot", e.sender);
  ok(e.senderRank === 40,
    "G: the rung is the one the bot evaluated, carried in the body — the channel cannot prove it " +
    "here because everyone writes to the same one", e.senderRank);
  ok(e.ts === 1234,
    "G: and the timestamp is WHEN THE PERSON ACTED. Matrix's own stamp is when the BOT relayed, so " +
    "a batch window would shift playback, AFK and the countdown by exactly the window", e.ts);

  // INTENTS NEVER FOLD.
  ctx.seen.length = 0;
  SM.ingest(msg(INTENTS, { t: "ddjp.dj.join", l: 8, actor: "@bob:hs", rank: 20, at: 2000 }));
  ok(ctx.seen.length === 0,
    "G: an event from the intents channel is REFUSED. A client that folded intents would run a " +
    "different room from everyone else — every request treated as though it had been granted",
    ctx.seen.length);

  // A DIRECTLY-AUTHORED EVENT STILL FOLDS CORRECTLY (owner-written settings, §2a).
  // The raw carries `senderRank` because transport stamps it from the channel the write landed in.
  ctx.seen.length = 0;
  SM.ingest({ type: "m.room.message", event_id: "$s1", room_id: SET, sender: "@owner:hs",
              origin_server_ts: 5555, ts: 5555, senderRank: 99,
              content: { body: JSON.stringify({ t: "ddjp.room.settings", l: 9, s: {} }) } });
  ok(ctx.seen.length === 1 && ctx.seen[0].sender === "@owner:hs" && ctx.seen[0].ts === 5555,
    "G: an event the bot did not relay keeps its OWN sender and timestamp — settings are authored " +
    "directly by the owner, so the overrides must fall back rather than overwrite",
    ctx.seen[0] && { sender: ctx.seen[0].sender, ts: ctx.seen[0].ts });

  // AND ITS RUNG. SHIPPED AND FOUND IN A LIVE ROOM at v380: this fell back to `undefined` while
  // `sender` and `ts` fell back properly. A settings event written straight to `settings-owner`
  // carries no `rank` in its body, so its rung vanished, `Ranks.permits(undefined, "room.settings")`
  // was false, and the reducer refused it as not-permitted. **The write succeeded and was visible in
  // the channel; the room simply never changed.** A silent refusal is the worst shape available
  // here, because bot mode publishes none — there was nothing anywhere to read.
  ok(ctx.seen[0].senderRank === 99,
    "G: and its RUNG falls back to what transport stamped. Channel-origin rank still proves " +
    "something in a bot room — `settings-owner` is gated at 99, so a write that landed there IS 99. " +
    "What bot mode gives up is the proof for the one channel anyone may write to, and events from " +
    "there never fold", ctx.seen[0].senderRank);

  // BATCHES.
  ctx.seen.length = 0;
  SM.ingest(msg(LOG, { t: "ddjp.batch", evs: [
    { t: "ddjp.dj.join", l: 10, actor: "@a:hs", rank: 20, at: 11 },
    { t: "ddjp.dj.vote", l: 11, actor: "@b:hs", rank: 40, at: 12 },
  ] }));
  ok(ctx.seen.length === 2,
    "G: one Matrix message carrying several events unpacks into several — one API call instead of " +
    "N is the saving, and a Matrix event either landed or it did not, so there is no half-applied " +
    "batch to reconcile", ctx.seen.length);
  ok(ctx.seen[0].event_id !== ctx.seen[1].event_id,
    "G: and each inner event gets its own id, or dedupe would collapse a batch to its first member",
    ctx.seen.map((x) => x.event_id));
  ok(ctx.seen[0].sender === "@a:hs" && ctx.seen[1].senderRank === 40 && ctx.seen[1].ts === 12,
    "G: with the overrides applied per inner event, not once for the carrier",
    ctx.seen.map((x) => ({ s: x.sender, r: x.senderRank, t: x.ts })));
}

// ── PART H — THE RUNNER'S DECISION (J24 slice 4) ─────────────────────────────────────────────
// Bot mode publishes no refusals, which is safe ONLY while the runner and the client reach the same
// verdict from the same inputs. So the thing under test is not "does it refuse correctly" — it is
// "does it ask the shared question at all", and that failure is invisible at runtime by
// construction. It is therefore asserted twice: textually over the source, and by driving the
// decision with a recording `Capabilities`.
{
  const AUTH_REL = "backends/backend2/authority.js";
  const authSrc = code(AUTH_REL);

  // ── H1. IT ASKS, AND IT DOES NOT DECIDE FOR ITSELF ────────────────────────────────────────
  ok(/Capabilities\.can\(/.test(authSrc),
    "H: the runner must ask `Capabilities.can` — the client's own function. A second copy of the " +
    "rules is a second verdict, and with no refusals published the difference is invisible");

  // No rank arithmetic of its own. `rank` is handed in from Matrix power levels and passed
  // through; comparing it here would be the runner deciding rather than asking.
  const LADDER = "(?:100|99|80|60|40|20|10)";
  const rankCompare = new RegExp("\\brank\\w*\\s*(?:[<>]=?|===|!==)\\s*" + LADDER + "\\b", "i");
  const rankCompareRev = new RegExp("\\b" + LADDER + "\\s*(?:[<>]=?|===|!==)\\s*rank\\w*", "i");
  ok(!rankCompare.test(authSrc) && !rankCompareRev.test(authSrc),
    "H: and compares NO rank against a ladder level of its own. Outside the gates table a rank is " +
    "a name, and the moment the runner does its own arithmetic the two verdicts can drift",
    (authSrc.match(rankCompare) || authSrc.match(rankCompareRev) || [""])[0]);

  // No settings lookup of its own either — the other half of the same input.
  ok(!/state\s*\.\s*settings|getState\(\)\s*\.\s*settings/.test(authSrc),
    "H: and reads no room SETTING of its own — settings are the other input the verdict is a " +
    "function of, and reading them here is the same drift by the other door");

  // ── H2. EVERY TYPE THE APP CAN SEND IS CLASSIFIED ─────────────────────────────────────────
  // Derived from `features/`, not listed here: a new event type that nobody classified would be
  // refused with no way for its sender to learn why, or would sail through ungated.
  const featDir = path.join(ROOT, "features");
  const sent = new Set();
  for (const f of fs.readdirSync(featDir)) {
    if (!f.endsWith(".js")) continue;
    const src = code("features/" + f);
    for (const m of src.matchAll(/sendEvent\(\s*[\w.\[\]]+\s*,\s*"(ddjp\.[a-z.]+)"/g)) sent.add(m[1]);
  }
  ok(sent.size > 10,
    "H: APPLIED — the scan of features/ must find the protocol types, or this wall is free", sent.size);

  const judged = new Set([...authSrc.matchAll(/"(ddjp\.[a-z.]+)":/g)].map((m) => m[1]));
  ok(judged.size > 10, "H: APPLIED — the classification table must parse", judged.size);
  const unclassified = [...sent].filter((t) => !judged.has(t));
  ok(unclassified.length === 0,
    "H: every event type a feature can send is classified by the runner — as a verb to ask about, " +
    "or explicitly ungated with the reason. An unclassified type is either refused silently or " +
    "waved through, and with no refusals published a person would have no way to tell which",
    unclassified);

  // ── H3. DRIVEN: the verdict comes from the shared function ────────────────────────────────
  const ctx = { console };
  vm.createContext(ctx);
  ctx.asked = [];
  ctx.Capabilities = {
    // ANSWERS `{ permitted, reason }`, as the real one does. This returned `{ ok }` until v387 and
    // so agreed with a runner that read `.ok` — both wrong together, which is why PART H was green
    // while every gated intent in a live room was refused.
    can: (verb, state, c) => { ctx.asked.push({ verb, myId: c.myId, myRank: c.myRank });
      return verb === "dj.reset" ? { permitted: false, reason: "no" } : { permitted: true, reason: null }; },
  };
  vm.runInContext(fs.readFileSync(path.join(ROOT, AUTH_REL), "utf8"), ctx);
  vm.runInContext("globalThis.A = B2Authority;", ctx);
  const A = ctx.A;

  ctx.asked.length = 0;
  const v = A.evaluate({ t: "ddjp.dj.move", actor: "@a:hs" }, { rotation: [] }, 60);
  ok(ctx.asked.length === 1 && ctx.asked[0].verb === "dj.move",
    "H: a gated intent reaches `Capabilities.can` with the act's verb", ctx.asked);
  ok(ctx.asked[0].myRank === 60 && ctx.asked[0].myId === "@a:hs",
    "H: carrying the ACTOR and the rung the runner was handed — not the runner's own identity, " +
    "which would ask whether the BOT may act", ctx.asked[0]);
  ok(v.ok === true, "H: and the answer is the shared function's", v);

  ok(A.evaluate({ t: "ddjp.dj.reset", actor: "@a:hs" }, {}, 20).ok === false,
    "H: a refusal from the shared function is a refusal here — the runner adds no verdict of its own");

  ctx.asked.length = 0;
  ok(A.evaluate({ t: "ddjp.media.len", actor: "@a:hs" }, {}, 10).ok === true && ctx.asked.length === 0,
    "H: a REPORT is not gated by rank and asks nothing. The cascade decides who speaks first, not " +
    "who may speak — gating these would silently disable the countdown and the availability escape " +
    "for everyone below the bar", ctx.asked);

  // SHIPPED AT v384 AS `bot: true`, AND IT MEANT A BOT ROOM COULD NEVER START A SONG.
  // `features/playback.js` says in its own header that any present client may emit an advance, and
  // `mayAdvance` gates it on being caught up rather than on rank. The runner refused every client's
  // proposal and authored none of its own, so the queue filled and the player sat still.
  ok(A.evaluate({ t: "ddjp.dj.play", actor: "@a:hs" }, {}, 10).ok === true,
    "H: ANY present client may propose an advance, whatever their rung — the cascade orders the " +
    "proposals and the reducer settles duplicates, exactly as in a shared room. Refusing them " +
    "stops the room dead, because nothing else authors one");

  // AND THE GENERAL SHAPE OF THAT MISTAKE, WALLED. A type a FEATURE can send that the runner marks
  // runner-only is a feature that is permanently dead in a bot room, refused silently forever —
  // and §4a publishes no refusals, so nobody would ever learn why. The upgrade pair is the only
  // deliberate case: a bot room is built in one burst and has no upgrade path at all.
  {
    const botOnly = [...authSrc.matchAll(/"(ddjp\.[a-z.]+)":\s*\{ bot: true/g)].map((m) => m[1]);
    const deadFeaturePaths = botOnly.filter((t) => sent.has(t)).sort();
    ok(JSON.stringify(deadFeaturePaths) ===
       JSON.stringify(["ddjp.room.upgrade.done", "ddjp.room.upgrade.start"]),
      "H: the only feature-sent types the runner reserves to itself are the upgrade pair, which a " +
      "bot room genuinely has no path for. Any other entry here is a feature that looks present and " +
      "can never work", deadFeaturePaths);
  }
  ok(A.evaluate({ t: "ddjp.not.a.thing", actor: "@a:hs" }, {}, 99).ok === false,
    "H: and an unclassified type is refused rather than waved through");

  // ── H4. THE SEND QUEUE, AND WHAT MAY NEVER WAIT ───────────────────────────────────────────
  // `sendEvent(roomId, type, content)` builds the protocol envelope itself, so what the queue hands
  // out is (type, payload) — not a pre-wrapped body. Passing a Matrix type where a DDJP type belongs
  // is what shipped at v381 and made every runner write inert.
  const outbox = [];
  A.reset();
  A.attach((type, payload) => outbox.push({ type, payload }), { windowMs: 1000 });

  for (const t of ["ddjp.media.len", "ddjp.play.len", "ddjp.play.blocked", "ddjp.media.skip", "ddjp.dj.skip", "ddjp.dj.play"]) {
    ok(A.isUrgent(t),
      "H: `" + t + "` must bypass the batch window. The cascade works by SUPPRESSION — a lower " +
      "rung cancels its slot when it sees the rung above land — and the relay round trip already " +
      "eats into every gap. A window on top makes the whole room declare at once");
  }

  outbox.length = 0;
  A.submit(A.stamp({ t: "ddjp.media.len", v: "x" }, "@a:hs", 20, "$i1", 4242));
  ok(outbox.length === 1 && outbox[0].type === "ddjp.media.len",
    "H: so an urgent type leaves immediately, on its own, AS ITS OWN DDJP TYPE — the transport " +
    "stamps `t` from this argument, so a Matrix type here produces an event every door drops",
    outbox[0] && outbox[0].type);
  ok(outbox[0].payload.actor === "@a:hs" && outbox[0].payload.rank === 20 &&
     outbox[0].payload.src === "$i1" && outbox[0].payload.at === 4242,
    "H: carrying who asked, at what rung, for which intent, and WHEN THEY ACTED", outbox[0].payload);
  ok(outbox[0].payload.l === undefined,
    "H: and NOT its own position — `sendEvent` stamps `l` from the room's Lamport clock, and a " +
    "counter in the runner would be a second opinion about the room's ordering", outbox[0].payload.l);

  outbox.length = 0;
  A.submit(A.stamp({ t: "ddjp.dj.join" }, "@a:hs", 20, "$i2", 1));
  A.submit(A.stamp({ t: "ddjp.dj.vote" }, "@b:hs", 40, "$i3", 2));
  ok(outbox.length === 0 && A.pending() === 2,
    "H: a non-urgent type waits instead", { out: outbox.length, pending: A.pending() });
  A.flush();
  ok(outbox.length === 1 && outbox[0].type === "ddjp.batch" && outbox[0].payload.evs.length === 2,
    "H: and leaves as ONE message — one API call instead of N, and crash-atomic, because a Matrix " +
    "event either landed or it did not", outbox[0] && outbox[0].t);

  ok(outbox[0].payload.evs.every((e) => e.l === undefined),
    "H: whose members carry NO position of their own — they share the carrier's, and the `#i` " +
    "suffix on their ids separates them, which the reducer's `(l, event_id)` sort already orders",
    outbox[0].payload.evs.map((e) => e.l));
}

// ── PART I — THE RUNNER'S FLOOR (J24 slice 5) ────────────────────────────────────────────────
// backend1's checkpoint machinery is large because many untrusted peers may seal and a checkpoint
// lives in a different room from the events it covers. Bot mode has neither problem, so what is
// left is small — and the small things left are the ones that would divide a room if they were
// wrong. Driven against the real module with the real fingerprint.
{
  const ctx = { console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend1/consensushash.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend1/checkpointformat.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/checkpoint.js"), "utf8"), ctx);
  vm.runInContext("globalThis.CP = B2Checkpoint; globalThis.FMT = CheckpointFormat;", ctx);
  const CP = ctx.CP;

  const mk = (n, prev, seed) => {
    const r = CP.seal(seed, { isRunner: true });
    return r.cp;
  };

  CP.reset();
  ok(CP.seal({ a: 1 }, { isRunner: false }).ok === false,
    "I: only the RUNNER seals. This is one of the bot's own powers, not a permission question " +
    "about a user, so it is decided here rather than through `Capabilities` — the split " +
    "`authority.js` describes");

  const s1 = CP.seal({ a: 1 }, { isRunner: true });
  ok(s1.ok === true && s1.cp.n === 1 && s1.cp.prev === null,
    "I: APPLIED — the runner can seal, or every refusal below is free", s1);
  ok(ctx.FMT.verify(s1.cp) === true,
    "I: and what it seals verifies under the SHARED fingerprint — the same one backend1 writes, so " +
    "a save file crossing between modes is checkable by either", s1.cp.h);

  // ADOPTION.
  ok(CP.observe(s1.cp, { id: "$c1", at: 10 }).adopted === true, "I: a verified checkpoint adopts");
  ok(CP.floor() && CP.floor().n === 1, "I: and becomes the floor", CP.floor() && CP.floor().n);

  // TRUSTING THE WRITER IS NOT TRUSTING THE BYTES.
  const bad = JSON.parse(JSON.stringify(s1.cp));
  bad.n = 5; bad.seed = { a: 999 };
  const badRes = CP.observe(bad, { id: "$bad" });
  ok(badRes.adopted === false && /verif/i.test(badRes.why),
    "I: a blob whose fingerprint does not verify is REFUSED even though its writer is trusted. " +
    "A truncated or garbled checkpoint is not a statement anybody made", badRes);
  ok(CP.floor().n === 1, "I: and the floor did not move for it", CP.floor().n);

  // THE FLOOR ONLY MOVES FORWARD.
  const s2 = CP.seal({ a: 2 }, { isRunner: true });
  ok(CP.observe(s2.cp, { id: "$c2", at: 20 }).adopted === true && CP.floor().n === 2,
    "I: APPLIED — a newer checkpoint does adopt, or the refusal below proves nothing", CP.floor().n);
  const old = CP.observe(s1.cp, { id: "$c1again", at: 30 });
  ok(old.adopted === false && CP.floor().n === 2,
    "I: replaying an older one does NOT rewind the floor. Every cold start replays history, so a " +
    "floor that could move backwards would undo a room that had already moved past it", old);

  // AND THE REFUSALS ARE RECORDED, not merely implied by a floor that did not move. Asserted HERE,
  // before the tie fixture below resets the module — an earlier draft checked it after, found an
  // empty list, and was measuring its own housekeeping rather than the code.
  ok(CP.refused().length === 2,
    "I: what did not adopt is recorded with its reason — a floor that quietly failed to move is " +
    "indistinguishable from one that had nothing to move to", CP.refused());

  // TWO WRITERS, ONE ANSWER. The owner sits at the runner's level (§10), so ties are possible and
  // must not be broken by network luck.
  CP.reset();
  const a = CP.seal({ x: "a" }, { isRunner: true });
  CP.observe(a.cp, { id: "$a", at: 1 });
  CP.reset();
  const b = CP.seal({ x: "b" }, { isRunner: true });
  CP.reset();
  CP.observe(a.cp, { id: "$a", at: 1 });
  const tie = CP.observe(b.cp, { id: "$b", at: 1 });
  ok(tie.adopted === true && CP.floor().seed.x === "b",
    "I: on an equal position the LATER one in the log wins — every client folds the same ordered " +
    "room, so every client picks the same one. Breaking a tie by arrival order would divide the " +
    "room by network luck, which is the one thing a consensus model may never do", tie);

}

// ── PART J — CHOOSING A ROOM TYPE (J24 slice 6) ──────────────────────────────────────────────
// The one control bot mode adds. It must offer what the registry describes, name no engine above
// the seam, and not exist at all while there is nothing to choose between.
{
  const ctx = freshSeam(true);
  const B = ctx.Backends;

  ok(B.describe("backend2") && B.describe("backend2").label,
    "J: an engine describes ITSELF — the label lives with the engine so no file above the seam has " +
    "to name one", B.describe("backend2"));
  vm.runInContext('Backends.register("m-undescribed", {}, { ready: true });', ctx);
  ok(B.describe("m-undescribed") === null,
    "J: and one that never described itself cannot be offered by accident");

  // Room.availableTypes — offers READY engines only.
  const roomSrc = code("features/room.js");
  const avail = roomSrc.slice(roomSrc.indexOf("function availableTypes()"),
                              roomSrc.indexOf("async function create("));
  ok(/Backends\.isReady/.test(avail),
    "J: only a READY engine is offered. `backend2` is registered and unfinished, so a room made " +
    "for it could be created and then refused at join — offering it would build a room nobody can " +
    "open");
  ok(/Backends\.describe/.test(avail),
    "J: and what is offered is what the registry describes, not a list kept here");

  // The UI names no engine, and does not reach the registry at all.
  const appSrc = code("app.js");
  ok(/Room\.availableTypes/.test(appSrc),
    "J: the create screen asks the FEATURE, because `ui/` and the bootstrap may not reach the " +
    "registry — `check-boundaries` rule D puts `Backends` on the ui wall");
  ok(!/["']backend\d+["']/.test(appSrc),
    "J: and names no engine. The option values are ids the registry handed over, so adding an " +
    "engine changes no file above the seam");

  // HIDDEN WHILE THERE IS NOTHING TO CHOOSE.
  ok(/types\.length\s*<\s*2/.test(appSrc),
    "J: the row is not drawn while one engine is ready. A dropdown with a single option is a " +
    "decision a person cannot make, and this keeps the create screen unchanged until a second " +
    "engine is actually finished");

  // A SAVE FILE DECIDES ITS OWN TYPE.
  ok(/createFromFile\(name, file\)/.test(appSrc) &&
     /file \? await Room\.createFromFile\(name, file\) : await Room\.create\(name, picked\)/.test(appSrc),
    "J: an import does not consult the picker — the file's own mode marker decides, and a build " +
    "that cannot serve it refuses by name (J24's Open)");
}

// ── PART K — THE TRANSPORT EDGES ─────────────────────────────────────────────────────────────
// Transport is shared. Three answers are not, and all three change for one reason: backend1 encodes
// the rank ladder in the channel topology and bot mode does not. Driven against the real module.
{
  const ctx = { console };
  vm.createContext(ctx);
  ctx.asked = [];
  ctx.B1MatrixBridge = {
    getUserId: () => "@me:hs",
    getUserEffectiveRank: (space, ch, who) => { ctx.asked.push({ space, who }); return 60; },
    getWriteChannelId: () => "!backend1-would-say:hs",
    getMyRank: () => 99,
    // backend1 maps each rung to its OWN channel; a bot room has two, which is the bug.
    eventsKeyForLevel: (l) => ({ 0: "events_uncategorized", 99: "events_owner" })[l] || null,
    sendEvent: () => "shared",
    replayRoom: () => "shared",
    banFromRoom: () => "shared",
  };
  ctx.Backends = { register: () => {} };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/transport.js"), "utf8"), ctx);
  vm.runInContext("globalThis.T = B2MatrixBridge;", ctx);
  const T = ctx.T;
  const CH = { events_uncategorized: "!intents:hs", events_owner: "!log:hs", settings_owner: "!set:hs" };

  // Guarded with `typeof` so a MISSING method reports as this assertion rather than throwing a
  // TypeError out of the harness — a guard that crashes says less than one that answers.
  const inherited = ["sendEvent", "replayRoom", "banFromRoom"];
  ok(inherited.every((m) => typeof T[m] === "function" && T[m]() === "shared"),
    "K: the whole of transport is INHERITED, not re-listed. A hand-written subset would fall behind " +
    "the real one the next time a method was added — a wall covering one thing less than it claims",
    inherited.filter((m) => typeof T[m] !== "function"));

  ok(T.getWriteChannelId(CH) === "!intents:hs",
    "K: everyone writes to the same channel, whatever their rung. A write target that varied by rank " +
    "would let the runner tell rungs apart by where a message landed — the proof bot mode gives up",
    T.getWriteChannelId(CH));
  ok(T.getWriteChannelId(CH) !== ctx.B1MatrixBridge.getWriteChannelId(),
    "K: APPLIED — and it is genuinely not backend1's answer, or this edge is inert");

  ok(T.getCheckpointChannelId(CH) === "!log:hs",
    "K: checkpoints go to the log beside the events they cover, so there is no `checkpoints_` " +
    "channel to choose between", T.getCheckpointChannelId(CH));

  // ── EVERY RUNG EXISTS IN A BOT ROOM ───────────────────────────────────────────────────────
  // `features/room.js` decides which ranks a room has "unlocked" by asking `eventsKeyForLevel` for a
  // rung and checking whether that channel is present — backend1 grows more of them as a room
  // upgrades. A bot room has TWO events channels, so the rank menu offered two rungs and **no middle
  // rank could be granted at all**. Reported from a live room, and it is also why a guest could
  // never be lifted to `minDjRank` and so could never join the queue.
  const LEVELS = [0, 10, 20, 40, 60, 80, 99];
  const offered = LEVELS.filter((l) => { const k = T.eventsKeyForLevel(l); return !!(k && CH[k]); });
  ok(offered.length === LEVELS.length,
    "K: every rung maps to an events channel that EXISTS, so the whole ladder is grantable. In this " +
    "engine rank is a power level, not a place you may write — everyone writes to the one events " +
    "channel whatever their rung", offered);
  const b1Offered = LEVELS.filter((l) => {
    const k = ctx.B1MatrixBridge.eventsKeyForLevel(l); return !!(k && CH[k]);
  });
  ok(b1Offered.length < LEVELS.length,
    "K: APPLIED — and backend1's own mapping would offer FEWER against this same channel map, or " +
    "this assertion is not testing the override", b1Offered);

  ctx.asked.length = 0;
  const rank = T.getMyRank(CH);
  ok(rank === 60 && ctx.asked.length === 1 && ctx.asked[0].who === "@me:hs",
    "K: the rung is the POWER LEVEL, read through the shared reader rather than by testing which " +
    "channel accepts a write — one definition of how a rung is read from Matrix, used by both",
    { rank, asked: ctx.asked });
  ok(rank !== ctx.B1MatrixBridge.getMyRank(),
    "K: APPLIED — and not backend1's channel-probing answer", { b2: rank, b1: ctx.B1MatrixBridge.getMyRank() });
}

// ── PART L — THE RUNNER LOOP ─────────────────────────────────────────────────────────────────
// Exactly one client in a room may run this; two would republish every intent twice. Driven against
// the real module, including the gate — which is the part most likely to look obviously right and
// not be.
{
  function build(myLevel) {
    const ctx = { console, setInterval: () => 1, clearInterval: () => {}, Date: Date };
    vm.createContext(ctx);
    ctx.sent = [];
    ctx.raws = [];
    ctx.said = [];
    ctx.Logger = { info: (m) => ctx.said.push(m), error: (m) => ctx.said.push("ERR " + m) };
    ctx.Ranks = { levelOf: (n) => (n === "owner" ? 99 : 0) };
    ctx.Backends = { active: () => "backend2", resolveMode: (c) => (c && c.ddjp_mode) || null };
    ctx.MatrixBridge = {
      getMyPowerLevel: () => myLevel,
      getCreateContent: () => ({ ddjp_mode: "backend2" }),
      getUserEffectiveRank: () => 40,
      onRawEvent: (fn) => ctx.raws.push(fn),
      offRawEvent: () => {},
      // `start` runs from `setRoomScope`, BEFORE the room is replayed — so the honest default for
      // this fixture is "not caught up yet", which is the state v382 announced in.
      // ANSWERS WITH AN OBJECT, as the real one does: `{ ok, reason }`. The fixture returned a bare
      // boolean until v384 and so agreed with a runner that read `=== true` — both wrong together,
      // which is why every assertion here was green while the runner could not relay at all.
      mayAuthor: () => (ctx.caughtUp === true ? { ok: true } : { ok: false, reason: "not-live" }),
      onAuthorReady: (fn) => { ctx.authorReady = fn; },
      sendEvent: (room, type, c) => { ctx.sent.push({ room, type, body: c }); return "$ok"; },
    };
    ctx.StreamManager = { getState: () => ({}) };
    ctx.Capabilities = { can: () => ({ permitted: true, reason: null }) };
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/authority.js"), "utf8"), ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/runner.js"), "utf8"), ctx);
    vm.runInContext("globalThis.R = B2Runner; globalThis.A = B2Authority;", ctx);
    return ctx;
  }
  const CH = { events_uncategorized: "!intents:hs", events_owner: "!log:hs" };
  const intent = (t, sender) => ({
    type: "m.room.message", event_id: "$i1", room_id: "!intents:hs", sender: sender || "@a:hs",
    origin_server_ts: 777, content: { body: JSON.stringify({ t: t }) },
  });

  // ── THE GATE ────────────────────────────────────────────────────────────────────────────────
  const owner = build(100);
  ok(owner.R.isRunner("!log:hs") === false,
    "L: THE HUMAN OWNER AT 100 IS NOT THE RUNNER. `Ranks.LADDER` tops out at 99 so `nameOf` " +
    "saturates and `atLeast(100, \"owner\")` is true — a rank CHECK would admit the owner's own tab. " +
    "That puts two authorities on the settings channel, and settings are last-write-wins over a " +
    "whole blob, so the loser's change vanishes with nothing reporting it");
  ok(owner.R.start({ channels: CH }).ok === false,
    "L: so it refuses to start there rather than quietly running a second authority");

  const low = build(60);
  ok(low.R.isRunner("!log:hs") === false, "L: and a staff client is not the runner either");

  const bot = build(99);
  ok(bot.R.isRunner("!log:hs") === true,
    "L: APPLIED — the client at exactly the top rung IS the runner, or every refusal above is free");
  ok(bot.R.runnerLevel() === 99,
    "L: and the rung is DERIVED from the ladder, not written here — one home for the rule, shared " +
    "with `features/botruntime.js` rather than copied", bot.R.runnerLevel());

  // ── STARTING ────────────────────────────────────────────────────────────────────────────────
  ok(build(99).R.start({ channels: { events_owner: "!log:hs" } }).ok === false,
    "L: a runner without both channels refuses to start — half-wired is not running");

  // ── THE ROOM MUST BE A BOT-RUN ROOM, NOT MERELY ONE WHERE I HOLD THE RUNG ──────────────────
  const shared = build(99);
  shared.Backends.active = () => "backend1";
  const wrongEngine = shared.R.start({ channels: CH });
  ok(wrongEngine.ok === false,
    "L: a client running the SHARED engine does not start a runner, even holding the top rung. A " +
    "backend1 room has an `events_owner` channel and a bot at 99 too — relaying there would land " +
    "every act twice, once as the person authored it and once as the runner repeated it",
    wrongEngine);

  const mislabelled = build(99);
  mislabelled.MatrixBridge.getCreateContent = () => ({ ddjp_mode: "backend1" });
  const wrongRoom = mislabelled.R.start({ channels: CH, spaceId: "!s:hs" });
  ok(wrongRoom.ok === false && /room does not declare/.test(wrongRoom.reason),
    "L: and the ROOM's own declaration is checked, not just this client's. Which engine is bound " +
    "is a fact about the client; the create-content marker is a fact about the room, and it is the " +
    "one that cannot be changed after creation", wrongRoom);

  const r = bot.R.start({ channels: CH });
  ok(r.ok === true && bot.R.running() === true, "L: APPLIED — the runner starts", r);

  // ── NOTHING IS WRITTEN BEFORE THE CLIENT IS CAUGHT UP ──────────────────────────────────────
  // SHIPPED AT v382. `start` runs before the room is replayed, so the Lamport clock is still at
  // zero; the announcement was minted at `l=1` and came back
  // `REFUSED AT THE DOOR — backdated: claims l=1 (head is l=8)`. Written, delivered, and refused by
  // every door including its own — and every relay would have been backdated identically.
  ok(bot.sent.length === 0,
    "L: the runner writes NOTHING while still catching up. `session` already owns 'only a fully " +
    "caught-up client may write anything'; a position minted before replay is behind the room's " +
    "head and is refused at every door", bot.sent.length);
  bot.R._onRaw(intent("ddjp.media.len"));
  ok(bot.sent.length === 0,
    "L: including relays — an intent arriving before the client is caught up is not republished " +
    "backdated, it waits", bot.sent.length);

  // ── CAUGHT UP: IT ANNOUNCES, AND IT RELAYS ─────────────────────────────────────────────────
  bot.caughtUp = true;
  bot.authorReady();
  // The announcement comes FIRST, and anything held while catching up follows it — the boundary
  // marker has to precede the acts it is a boundary for. (This asserted `length === 1` until v391,
  // when intents stopped being dropped while not live and began arriving behind the announcement.)
  ok(bot.sent.length >= 1 && bot.sent[0].type === "ddjp.bot.here" && bot.sent[0].room === "!log:hs",
    "L: it announces the moment it IS caught up, in the log, through the hook the transport already " +
    "exposes for exactly this — the boundary marker for 'listening from here', and it goes before " +
    "anything that was held", bot.sent.map((x) => x.type));

  // SHIPPED AT v381. `sendEvent(roomId, type, content)` BUILDS the protocol envelope — it stamps `t`
  // from `type` and `l` from the room clock. The runner called it as
  // `sendEvent(room, "m.room.message", { body: JSON.stringify(...) })`, pre-wrapping the body and
  // passing a Matrix type where a DDJP type belongs, so every event it wrote had
  // `t: "m.room.message"` and was dropped by every door. The harnesses missed it because their fake
  // `sendEvent` took whatever it was handed; this one mirrors what the real one does.
  ok(bot.sent.every((x) => /^ddjp\./.test(x.type)),
    "L: and every runner write names a DDJP type, never a Matrix one — the transport stamps `t` " +
    "from this argument, and an event whose `t` is not a `ddjp.` type is dropped everywhere",
    bot.sent.map((x) => x.type));

  // SHIPPED AT v383, AND INVISIBLE. `mayAuthor()` answers with an OBJECT — `{ ok, reason }`, never a
  // boolean — and the runner compared it to `true`, which an object never is. So it was always
  // refused and relayed NOTHING. The announcement still landed, because that goes through
  // `onAuthorReady` rather than through the same check, so the log read "caught up — announced and
  // now relaying" while not one intent could ever be republished. The fixture returned a bare
  // boolean and agreed with the bug, which is why every assertion here was green.
  ok(bot.MatrixBridge.mayAuthor().ok === true,
    "L: APPLIED — the fixture answers the way the transport does, with an object");
  bot.sent.length = 0;
  bot.R._onRaw(intent("ddjp.media.len"));
  ok(bot.sent.length === 1,
    "L: a caught-up runner RELAYS — `=== true` against `{ ok: true }` is false, and the " +
    "announcement takes a different path, so the runner looks alive while relaying nothing",
    bot.sent.length);
  ok(bot.sent[0].room === "!log:hs",
    "L: to the LOG, not the intents channel — the one room only the runner and the owner may write " +
    "to, which is what makes its authority homeserver-enforced rather than agreed", bot.sent[0].room);
  ok(bot.sent[0].body.actor === "@a:hs" && bot.sent[0].body.src === "$i1" && bot.sent[0].body.at === 777,
    "L: carrying who asked, which message asked it, and when they asked", bot.sent[0].body);

  // AN INTENT FROM THE LOG ITSELF IS NOT RE-READ.
  bot.sent.length = 0;
  bot.R._onRaw(Object.assign(intent("ddjp.media.len"), { room_id: "!log:hs" }));
  ok(bot.sent.length === 0,
    "L: the runner does not read its own output — an intent-shaped event in the log would be " +
    "republished forever", bot.sent.length);

  // A REFUSAL IS SILENT, BY DESIGN.
  const deny = build(99);
  deny.caughtUp = true;
  deny.Capabilities.can = () => ({ permitted: false, reason: "no" });
  deny.R.start({ channels: CH });
  deny.sent.length = 0;
  deny.R._onRaw(intent("ddjp.dj.move"));
  ok(deny.sent.length === 0,
    "L: a refused intent publishes NOTHING. Determinism is what makes that safe — the client " +
    "reached the same verdict from the same two inputs and never sent it. A refusal path here " +
    "would quietly become the second one", deny.sent.length);
  // AND IT SAYS SO LOCALLY. Five live bugs ran their course with the runner silent about intents:
  // the log read "announced and now relaying" while nothing was relayed, and the only way to tell
  // was reading the room's raw contents by hand. No refusal is PUBLISHED (§4a) — but the person
  // running the bot can see what it saw.
  ok(deny.said.some((m) => /refused .*ddjp\.dj\.move/.test(m)),
    "L: a refusal is said in the runner's own log, naming the act and the reason — silence about " +
    "an intent is indistinguishable from never having received one", deny.said);
  ok(deny.R.stats().seen === 1 && deny.R.stats().stood === 0,
    "L: but it is COUNTED, so a room where nothing stands is distinguishable from one where " +
    "nothing was asked", deny.R.stats());

  // STOPPING FLUSHES.
  const f = build(99);
  f.caughtUp = true;
  f.R.start({ channels: CH });
  f.sent.length = 0;
  f.R._onRaw(intent("ddjp.dj.join"));
  ok(f.sent.length === 0 && f.A.pending() === 1,
    "L: a non-urgent intent waits for the window", { sent: f.sent.length, pending: f.A.pending() });
  f.R.stop();
  ok(f.sent.length === 1 && f.sent[0].type === "ddjp.batch",
    "L: and stopping flushes what was waiting rather than dropping it on the floor", f.sent[0]);
}

// ── PART M — ATTRIBUTION, AND WHO THE ROOM THINKS IS ACTIVE ──────────────────────────────────
// Every event in a bot room's log is SENT BY THE BOT. If anything downstream attributed by the
// Matrix sender, the bot would look permanently active and every person permanently idle — and the
// AFK sweep removes people from the presence channel on exactly that reading. So the attribution
// hand-off is driven end to end here, from the intent a person sent to what the fold is handed.
{
  const ctx = { console, setInterval: () => 1, clearInterval: () => {}, Date: Date };
  vm.createContext(ctx);
  ctx.sent = [];
  ctx.folded = [];
  ctx.Ranks = { levelOf: (n) => (n === "owner" ? 99 : 0) };
  ctx.Capabilities = { can: () => ({ permitted: true, reason: null }) };
  ctx.StreamManager = { getState: () => ({}) };
  ctx.Backends = { active: () => "backend2", resolveMode: (c) => (c && c.ddjp_mode) || null };
  ctx.MatrixBridge = {
    mayAuthor: () => ({ ok: true }),
    onAuthorReady: (fn) => fn(),
    getMyPowerLevel: () => 99,
    getCreateContent: () => ({ ddjp_mode: "backend2" }),
    getUserEffectiveRank: () => 40,
    onRawEvent: () => {}, offRawEvent: () => {},
    // THE BOT IS THE MATRIX SENDER OF EVERYTHING IT WRITES. That is the whole hazard.
    // Mirrors what the real transport does: it BUILDS the envelope, stamping `t` and `l`.
    sendEvent: (room, type, c) => { ctx.sent.push({ room_id: room, type: "m.room.message",
      event_id: "$relay" + ctx.sent.length, sender: "@bot:hs", origin_server_ts: 999999, ts: 999999,
      senderRank: 99,
      content: { body: JSON.stringify(Object.assign({}, c, { t: type, l: 50 + ctx.sent.length })) } });
      return "$ok"; },
  };
  ctx.B1StreamManager = { ingest: (e) => ctx.folded.push(e) };
  ctx.B2Checkpoint = { TYPE: "ddjp.checkpoint", observe: () => {}, held: () => [], byId: () => null, reset: () => {} };
  ctx.Backends.register = () => {};
  for (const f of ["authority.js", "runner.js", "streammanager.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/" + f), "utf8"), ctx);
  }
  vm.runInContext("globalThis.R = B2Runner; globalThis.SM = B2StreamManager; globalThis.A = B2Authority;", ctx);

  const CH = { events_uncategorized: "!intents:hs", events_owner: "!log:hs" };
  ctx.R.start({ channels: CH });
  ctx.SM.setFoldScope(CH);

  // A PERSON ACTS. The runner relays; every client folds what the runner wrote.
  ctx.sent.length = 0; ctx.folded.length = 0;
  ctx.R._onRaw({ type: "m.room.message", event_id: "$mine", room_id: "!intents:hs",
    sender: "@alice:hs", origin_server_ts: 4242,
    content: { body: JSON.stringify({ t: "ddjp.dj.join" }) } });
  // A join is not urgent, so it waits for the window — flushing here relays it AND exercises the
  // batch path, where the overrides have to be applied per inner event rather than once for the
  // carrier the bot sent.
  ctx.A.flush();
  ok(ctx.sent.length === 1, "M: APPLIED — the intent must be relayed, or nothing below is exercised", ctx.sent.length);
  ok(ctx.sent[0].sender === "@bot:hs",
    "M: APPLIED — and the relayed event's MATRIX sender is the bot, which is the hazard this part " +
    "exists for", ctx.sent[0].sender);

  for (const ev of ctx.sent) ctx.SM.ingest(ev);
  ok(ctx.folded.length === 1, "M: APPLIED — and it reaches the fold", ctx.folded.length);
  ok(ctx.folded[0].sender === "@alice:hs",
    "M: THE FOLD IS HANDED THE PERSON, NOT THE BOT. Everything downstream attributes by this field " +
    "— the rotation, the People panel, and `recentlyActive`, which the AFK sweep removes people on. " +
    "Reading the Matrix sender here would make the bot permanently active and every person " +
    "permanently idle", ctx.folded[0].sender);
  ok(ctx.folded[0].ts === 4242,
    "M: WITH THE MOMENT THEY ACTED, not the moment the bot spoke. Idleness is measured from this, " +
    "so relay time would age everyone by the batch window and sweep people who had just acted",
    { got: ctx.folded[0].ts, relayed: ctx.sent[0].origin_server_ts });
  ok(ctx.folded[0].senderRank === 40,
    "M: and the rung the runner read at the moment it decided", ctx.folded[0].senderRank);

  // THE RUNNER'S OWN ANNOUNCEMENT MUST NOT LOOK LIKE ACTIVITY.
  ctx.sent.length = 0; ctx.folded.length = 0;
  ctx.R.announce();
  for (const ev of ctx.sent) ctx.SM.ingest(ev);
  ok(ctx.folded.length === 1 && ctx.folded[0].sender === "@bot:hs",
    "M: the runner's own announcement is attributed to the runner — it carries no actor, so the " +
    "override falls back rather than inventing one", ctx.folded[0] && ctx.folded[0].sender);
  const ACTIVE = code("backends/backend1/statederiver.js");
  ok(!/"ddjp\.bot\.here":/.test(ACTIVE.slice(ACTIVE.indexOf("ACTIVE_TYPES"), ACTIVE.indexOf("ACTIVE_TYPES") + 900)),
    "M: and it is not an ACTIVITY type, so a runner that never stops announcing cannot make itself " +
    "look like the most active member of the room");

  // A CLIENT CANNOT CLAIM TO BE THE RUNNER.
  const claim = ctx.A.evaluate({ t: "ddjp.bot.here", actor: "@alice:hs" }, {}, 99);
  ok(claim.ok === false && /runner/.test(claim.reason),
    "M: and a client sending one is refused BY RULE rather than by omission — 'we never listed it' " +
    "is the kind of accident that reads as a decision", claim);
}

// ── PART N — THE PROTECTIONS backend1 HAS, CHECKED FOR HERE ──────────────────────────────────
// A second engine is a second place for the habits of the first to be absent. backend1 bounds
// everything it accumulates and never discards work it has not confirmed was accepted; these are
// the two places bot mode could quietly stop doing either.
{
  const ctx = { console };
  vm.createContext(ctx);
  ctx.Capabilities = { can: () => ({ permitted: true, reason: null }) };
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/authority.js"), "utf8"), ctx);
  vm.runInContext("globalThis.A = B2Authority;", ctx);
  const A = ctx.A;

  // ── A FAILED SEND MUST NOT EAT THE BATCH ──────────────────────────────────────────────────
  // A batch is several people's acts. Clearing the buffer before the send is accepted loses all of
  // them silently: the room never sees those acts, and nothing publishes a refusal to explain it.
  A.reset();
  let fail = true;
  A.attach(function () { if (fail) throw new Error("network"); return "ok"; });
  A.submit(A.stamp({ t: "ddjp.dj.join" }, "@a:hs", 20, "$1", 1));
  A.submit(A.stamp({ t: "ddjp.dj.vote" }, "@b:hs", 20, "$2", 2));
  ok(A.pending() === 2, "N: APPLIED — two acts are waiting", A.pending());
  // `flush` must ABSORB the failure, not propagate it — a throw escaping here would take down
  // whatever timer called it, so the runner would stop flushing entirely after one bad send.
  let bad = null, threw = null;
  try { bad = A.flush(); } catch (e) { threw = (e && e.message) || String(e); }
  ok(threw === null,
    "N: a failing send must not throw OUT of flush — this runs on a timer, and an escaping error " +
    "stops every later flush as well as this one", threw);
  ok(bad && bad.sent === 0 && A.pending() === 2,
    "N: a send that THROWS puts the batch back rather than dropping it. Those are two people's " +
    "acts; losing them is invisible, because bot mode publishes no refusals to explain the silence",
    { res: bad, pending: A.pending() });

  fail = false;
  ok(A.flush().sent === 2 && A.pending() === 0,
    "N: and the retry carries them, so a transient failure costs a delay rather than the acts");

  // Same for a REJECTED promise, which is the shape a real send actually fails in.
  A.reset();
  let rejecter = null;
  A.attach(function () { return { catch: function (f) { rejecter = f; return this; } }; });
  A.submit(A.stamp({ t: "ddjp.dj.join" }, "@a:hs", 20, "$3", 3));
  A.flush();
  ok(A.pending() === 0, "N: APPLIED — an in-flight send empties the buffer", A.pending());
  ok(typeof rejecter === "function",
    "N: APPLIED — the send's rejection handler must be registered, or the assertion below is " +
    "testing nothing", typeof rejecter);
  if (typeof rejecter === "function") rejecter();
  ok(A.pending() === 1,
    "N: and a REJECTION puts it back. A network send fails by rejecting far more often than by " +
    "throwing, so catching only the throw would cover the rarer half", A.pending());

  // ── NOTHING GROWS FOREVER ─────────────────────────────────────────────────────────────────
  A.reset();
  A.attach(null);
  for (let i = 0; i < 2000; i++) A.submit(A.stamp({ t: "ddjp.dj.join" }, "@a:hs", 20, "$q" + i, i));
  ok(A.pending() > 0 && A.pending() <= 1000,
    "N: the outbound queue is BOUNDED. backend1 trims everything it accumulates — the log to the " +
    "floor, the cache by it — and a runner whose sends keep failing would otherwise grow one array " +
    "until the tab dies", A.pending());

  const cctx = { console };
  vm.createContext(cctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend1/consensushash.js"), "utf8"), cctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend1/checkpointformat.js"), "utf8"), cctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, "backends/backend2/checkpoint.js"), "utf8"), cctx);
  vm.runInContext("globalThis.CP = B2Checkpoint;", cctx);
  const CP = cctx.CP;
  CP.reset();
  for (let i = 0; i < 200; i++) {
    const r = CP.seal({ i: i }, { isRunner: true });
    CP.observe(r.cp, { id: "$h" + i, at: i });
  }
  ok(CP.held().length > 0 && CP.held().length <= 64,
    "N: and so is the held-checkpoint list — the sharper of the two, because every entry carries a " +
    "FULL STATE SEED. Unbounded, a long-lived room would keep a copy of its own history, one blob " +
    "per seal, in every client", CP.held().length);
  ok(CP.floor().n === 200,
    "N: APPLIED — while the FLOOR still tracks the newest, so the window trims the list without " +
    "trimming the answer", CP.floor().n);

  CP.reset();
  for (let i = 0; i < 300; i++) CP.observe({ n: 1, h: "forged" }, { id: "$r" + i });
  ok(CP.refused().length > 0 && CP.refused().length <= 120,
    "N: the refusal record is bounded too — it exists so a reader can see WHY nothing adopted, and " +
    "a log nobody can load answers nothing", CP.refused().length);
}

// ── PART O — THE INTERFACE IS FILLED BEFORE ANYTHING READS IT ────────────────────────────────
// SHIPPED AND FOUND IN A BROWSER AT v379. The four interface names are empty shells until something
// binds (J23). The bind lived in `app.js`, the LAST script on the page — so ten `features/` and
// `ui/` files loaded first, and several of them read the interface AT LOAD TIME rather than inside
// a function. `ui/base.js` builds its rank colours with a top-level `const RANKS =
// Room.rankLadder()`, and `rankLadder` reads `Capabilities.LADDER`. Against an empty shell that is
// `undefined.map(...)`: it threw, `UIBase` was never defined, and every ui/ module after it failed
// with `UIBase is not defined`. **A blank page, nine cascading errors, and the first one named a
// file three below the cause.**
//
// Before J23 this was impossible — a module's own script defined it, so load order and bind order
// were the same thing. Splitting them is what the seam buys and this is the bill, so it is guarded
// two ways: the page's tag order, and the load itself.
{
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const tags = [...html.matchAll(/src="([^"]+\.js)\?v=\d+"/g)].map((m) => m[1]);
  const bindAt = tags.indexOf("core/bind-bootstrap.js");
  ok(bindAt >= 0,
    "O: the page must bind the bootstrap engine in a script of its own. Appending the call to " +
    "whichever backend happens to load last hides a load-order dependency inside a file about " +
    "something else, where the next reorder moves it silently");

  const readers = tags.filter((t) => /^(features|ui)\//.test(t));
  ok(readers.length > 10, "O: APPLIED — the page must actually contain readers", readers.length);
  const early = readers.filter((t) => tags.indexOf(t) < bindAt);
  ok(early.length === 0,
    "O: EVERY features/ and ui/ script loads AFTER the bind. Several read the interface at load " +
    "time, so an empty shell is not a missing value here — it is a blank page", early);

  // AND THE LOAD ITSELF, in page order, so this rests on what happens rather than on tag position.
  // Stops at the first reader: core and the engines need no DOM, so there is no browser stub to go
  // stale and turn this red for a reason that has nothing to do with the seam.
  const upTo = tags.slice(0, tags.indexOf(readers[0]))
    .filter((t) => !/^lib\//.test(t) && !/sw-register/.test(t));
  const ctx = { console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
                setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
                localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
                navigator: {}, location: { href: "" }, document: { addEventListener() {} } };
  ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  let died = null;
  for (const t of upTo) {
    try { vm.runInContext(fs.readFileSync(path.join(ROOT, t), "utf8"), ctx, { filename: t }); }
    catch (e) { died = t + ": " + ((e && e.message) || e); break; }
  }
  ok(died === null, "O: APPLIED — core and the engines must load clean in page order", died);

  vm.runInContext("globalThis.__slots = [StreamManager, MatrixBridge, MatrixAccount, Capabilities]" +
                  ".map((m) => Object.keys(m).length);", ctx);
  ok(ctx.__slots.every((n) => n > 0),
    "O: and by the time the FIRST reader would run, all four interface names are filled — driven " +
    "by loading the page's own tag list in its own order, not by reading the order off",
    { slots: ctx.__slots, firstReader: readers[0] });
  vm.runInContext("globalThis.__ladder = Array.isArray(Capabilities.LADDER);", ctx);
  ok(ctx.__ladder === true,
    "O: including `Capabilities.LADDER` specifically, which is the one `ui/base.js` reads at load " +
    "time and the exact value that was undefined when this shipped");
}

// ── PART P — THE RUNNER JUDGED AGAINST THE REAL CAPABILITY MODULE ────────────────────────────
// EVERY OTHER PART HERE USES A DOUBLE FOR `Capabilities`, AND THAT IS WHY THREE CONTRACT BUGS
// SHIPPED. A double answers the way its author believed the real thing answers; when the belief is
// wrong the double is wrong in the same direction, and the guard agrees with the bug. `can` returns
// `{ permitted, reason }` and the runner read `verdict.ok` — always `undefined`, so **every gated
// intent was refused** while the shared function was saying yes. `mayAuthor` returns `{ ok }` and
// was read as a boolean. `sendEvent` builds the envelope and was handed a pre-built one.
//
// So this part uses NO double for the thing under test: the real `ranks.js` and `capabilities.js`
// are loaded, and the runner's own decision is driven against them.
{
  const ctx = { console };
  vm.createContext(ctx);
  ctx.Backends = { register: () => {} };
  // `statederiver.js` too: `_minDjRank` validates the room's setting against that module's ranges
  // and falls back to the default if it cannot. Without it the bar silently reads as the lowest
  // rung and a bar test passes for the wrong reason — a harness answering from its own absence.
  for (const f of ["backends/backend1/ranks.js", "backends/backend1/consensushash.js",
                   "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
                   "backends/backend2/authority.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  // The engine binds backend1's capability module into the shared slot, so that is what the runner
  // asks — exactly as a bot room does.
  vm.runInContext("globalThis.Capabilities = B1Capabilities; globalThis.A = B2Authority;", ctx);
  const A = ctx.A;

  const state = { settings: { minDjRank: "guest", maxLen: 601, minLen: 10 }, rotation: [], nowPlaying: null };

  const join = A.evaluate({ t: "ddjp.dj.join", actor: "@someone:hs" }, state, 100);
  ok(join.ok === true,
    "P: an act the ROOM PERMITS is permitted by the runner. `can` answers `{ permitted, reason }` " +
    "and reading `.ok` off it is always undefined — every gated intent refused, in a room where " +
    "the shared function said yes", join);

  // AND THE TELL WAS INVERTED, which is why the live log was so hard to read: a genuine refusal
  // carries a reason and showed one, while a PERMITTED act came back `reason: null` and fell
  // through to the fallback text. "refused by dj.join" was an act the room allowed.
  const leave = A.evaluate({ t: "ddjp.dj.leave", actor: "@someone:hs" }, state, 100);
  ok(leave.ok === false && /not in the rotation/i.test(leave.reason || ""),
    "P: and a real refusal carries the room's OWN sentence, not a fallback — the two must not be " +
    "told apart by whether a reason happens to be present", leave);

  // The bar is the room's, read from settings rather than assumed.
  // THE BAR IS THE ROOM'S, AND ITS LEGAL VALUES ARE THE DERIVER'S. `minDjRank` accepts only
  // `guest` or `uncategorized` — an earlier version of this assertion set it to "staff", which is
  // not a legal value, so `_minDjRank` fell back to the default and the act was permitted. The test
  // was wrong, not the code, and it is written down because the next person will reach for a rung
  // name that looks obviously valid.
  const low = A.evaluate({ t: "ddjp.dj.join", actor: "@someone:hs" },
    { settings: { minDjRank: "guest" }, rotation: [] }, 0);
  ok(low.ok === false && /required/i.test(low.reason || ""),
    "P: a rung below the room's bar is refused, carrying the room's own reason", low);

  // A verb the gates table does not define must not silently pass.
  ok(A.classify("ddjp.dj.vote").verb === "react.vote",
    "P: and the vote still maps to `react.vote` against the REAL table — a mechanical strip of the " +
    "`ddjp.` prefix would ask for a verb that does not exist there");
}

// ── PART Q — THE THREE GAPS CLOSED AT v388 ───────────────────────────────────────────────────
{
  // ── Q1. THE HOMESERVER'S BARS COME DOWN TO THE STAFF RUNG IN A BOT ROOM ───────────────────
  // Matrix defaults are `ban: 99` and `redact: 100`, coarser than the app's ladder: staff sit at 60,
  // so by default they can kick and can NEVER ban, and nobody but the owner can delete a message.
  // A bot room is meant to be run by its staff. This replaces a much larger design — ban and kick as
  // commands to the bot, with a result event and an async return — with one number per room, which
  // also keeps moderation working while the bot is down.
  const plan = code("backends/backend2/skeleton.js");
  const chatGates = [...plan.matchAll(/kind: "chat"[^}]*gates: \{([^}]*)\}/g)].map((m) => m[1]);
  ok(chatGates.length === 3,
    "Q: APPLIED — every chat row in the bot plan must carry gates, or the rest is free", chatGates.length);
  ok(chatGates.every((g) => /redact:\s*60/.test(g)),
    "Q: chat rooms lower `redact` to the staff rung, so the people expected to moderate chat can. " +
    "At Matrix's default of 100 only the owner could delete anything, in either room type", chatGates);
  ok([...plan.matchAll(/gates: \{([^}]*)\}/g)].every((m) => /ban:\s*60/.test(m[1])),
    "Q: and EVERY room lowers `ban`, not just chat — a removal spans the whole Space, so a bar that " +
    "held in one room and not another would half-remove somebody");

  // DRIVEN against the real template, because a plan that carries gates and a template that ignores
  // them look identical from the plan's side.
  const mb = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const i = mb.indexOf("function _powerLevels");
  const end = mb.indexOf("\n  function ", i + 10);
  const pctx = { console };
  vm.createContext(pctx);
  // NEWLINE FIRST: the slice can end inside a `//` comment, which would swallow this line.
  vm.runInContext(mb.slice(i, end) + "\n;globalThis.PL = _powerLevels;", pctx);
  const dflt = pctx.PL(0, "@o:hs", false);
  const bot = pctx.PL(0, "@o:hs", false, { redact: 60, ban: 60 });
  ok(dflt.redact === 100 && dflt.ban === 99,
    "Q: APPLIED — with no gates the template is exactly what a shared room has always had", dflt);
  ok(bot.redact === 60 && bot.ban === 60,
    "Q: and a row's gates actually reach the homeserver's own bars", bot);

  // ── Q2. THE RUNNER SEALS, ON THE ROOM'S OWN CADENCE ───────────────────────────────────────
  // `B2Checkpoint.seal` existed from the day the floor was written and NOTHING CALLED IT: a bot room
  // replayed its whole log on every join, forever, and got slower every day.
  const run = code("backends/backend2/runner.js");
  // CALLED, not merely defined. `/_maybeSeal\(\)/` matched the function's own declaration, so
  // deleting the call left this green — the assertion was testing that the code existed, which was
  // never in doubt. The beat's body is sliced and the call looked for inside it.
  const beat = run.slice(run.indexOf("_beat = setInterval"), run.indexOf("_beat = setInterval") + 500);
  ok(/_maybeSeal\(\)/.test(beat) && /B2Checkpoint\.seal\(/.test(run),
    "Q: the runner seals ON ITS BEAT — nothing else can, because only the runner may (§6), and " +
    "backend1's cadence tick cannot: it resolves a `checkpoints_` channel a bot room does not have",
    beat.slice(0, 120));
  ok(/checkpointEvery/.test(run) && /checkpointCooldownMs/.test(run),
    "Q: on the ROOM'S cadence, read from settings rather than a number invented in the runner — so " +
    "a bot room seals on the same rhythm a shared room does");

  // ── Q3. A SAVE FILE THIS BUILD CANNOT SERVE IS REFUSED BY NAME ────────────────────────────
  const room = code("features/room.js");
  const imp = room.slice(room.indexOf("async function createFromFile"),
                         room.indexOf("async function createFromFile") + 2200);
  ok(/Backends\.forFileMode/.test(imp) && /Backends\.isReady/.test(imp),
    "Q: an import reads the file's OWN mode marker and refuses one this build cannot run");
  // BOTH PRESENT, THEN ORDERED. `indexOf` returns -1 when absent, and -1 is less than any index —
  // so deleting the refusal entirely satisfied the comparison and this stayed green.
  ok(imp.indexOf("mode-not-available") >= 0 && imp.indexOf("importFile") >= 0 &&
     imp.indexOf("mode-not-available") < imp.indexOf("importFile"),
    "Q: and refuses BEFORE reading the file in — a silent partial import is far worse than a " +
    "refusal, because the room would look made and behave as though it had lost its contents");
}

// ── PART R — A WRITE HELD FOR LIVENESS IS ACTUALLY SENT ──────────────────────────────────────
// REPORTED FROM A LIVE ROOM at v388: a song offered while the session was not live was logged as
// deferred and then DROPPED. `_mayWrite` returned `{ retrying: true }`, the message said "will retry
// when live", and **nothing retried** — the flag was read by nobody. A person sees a click that does
// nothing and a log that says the opposite of what happened.
//
// This is not a bot-mode defect: `features/queue.js` is shared and it bites in both room types. It
// surfaces when the tab is not focused, because that is when a session goes quiet — so "add a song,
// then go and look at something else" loses the song.
{
  const q = code("features/queue.js");
  ok(/_awaitWritable/.test(q) && /onAuthorReady/.test(q),
    "R: the queue WAITS for liveness through the hook the transport already exposes, rather than " +
    "returning a flag nobody reads. It is the same hook the runner uses to hold its own writes " +
    "until the clock has caught up");

  // Every gated act, not just the one that was reported. A held `join` and a dropped `strike` are
  // the same defect wearing different names.
  const gated = [...q.matchAll(/_mayWrite\("([^"]+)"\)/g)].map((m) => m[1]);
  ok(gated.length >= 9,
    "R: APPLIED — the gate must be found at every write, or this wall covers one act", gated.length);
  const waits = [...q.matchAll(/_awaitWritable\("([^"]+)"/g)].map((m) => m[1]);
  ok(gated.every((g) => waits.indexOf(g) >= 0),
    "R: and EVERY one of them waits — a gate that refuses in one place and waits in another is two " +
    "behaviours for one rule", gated.filter((g) => waits.indexOf(g) < 0));

  // THE LIVE PATH MUST STAY SYNCHRONOUS. An earlier fix awaited unconditionally and moved every send
  // one microtask later; guards that call `UserQueue.joinRoomQueue()` without awaiting then asserted
  // before the send had happened. A fix that changes when a WORKING path runs breaks the working path.
  ok(/const w = _mayWrite\("[^"]+"\); if \(!w\.ok && !\(await _awaitWritable/.test(q),
    "R: and the wait is reached only AFTER a synchronous refusal, so a live client sends exactly " +
    "when it always did");

  // It must also give up rather than hang: a promise nobody resolves is a button that never returns.
  // THE DECLARATION, not a mention of it: `/LIVE_WAIT_MS/` matched the use site, so deleting the
  // constant left this green while the wait became a ReferenceError.
  ok(/const LIVE_WAIT_MS\s*=\s*\d+/.test(q) && /gave up holding/.test(q),
    "R: with a bounded wait — if liveness never returns the act is refused with a reason, not left " +
    "pending forever");
}

// ── PART S — TARGETED ACTS, AND A CONTROL THAT IS REACHABLE ──────────────────────────────────
// Both reported from a live room at v389, and both the same shape: the permission was right and the
// question was wrong.
{
  const ctx = { console };
  vm.createContext(ctx);
  ctx.Backends = { register: () => {} };
  for (const f of ["backends/backend1/ranks.js", "backends/backend1/consensushash.js",
                   "backends/backend1/statederiver.js", "backends/backend1/capabilities.js",
                   "backends/backend2/authority.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  vm.runInContext("globalThis.Capabilities = B1Capabilities; globalThis.A = B2Authority;", ctx);
  const A = ctx.A;
  const state = { settings: { minDjRank: "guest" },
                  rotation: [{ user: "@vic:hs", pending: [{ videoId: "abc" }] }], nowPlaying: null };

  // `can` reads `ctx.target.userId` / `.videoId`; the WIRE carries `{ x, v }`. This passed
  // `intent.target`, a field no event has ever had, so every targeted act saw `{}` and was refused
  // as "Not in the rotation" — against a person plainly in it. The refusal read correctly, which is
  // what made it convincing.
  ok(A.evaluate({ t: "ddjp.dj.strike", actor: "@gm:hs", x: "@vic:hs", v: "abc" }, state, 100).ok === true,
    "S: a strike naming a real person and one of their songs is PERMITTED — the wire's `x` and `v` " +
    "must be translated into the target `Capabilities` reads, or no targeted act can ever stand");
  ok(A.evaluate({ t: "ddjp.dj.remove", actor: "@gm:hs", x: "@vic:hs" }, state, 100).ok === true,
    "S: and so is a remove naming them");

  // The refusals must still bite, or the translation has simply made everything pass.
  const wrongSong = A.evaluate({ t: "ddjp.dj.strike", actor: "@gm:hs", x: "@vic:hs", v: "zzz" }, state, 100);
  ok(wrongSong.ok === false && /Not one of their songs/.test(wrongSong.reason || ""),
    "S: APPLIED — a strike naming a song they do not have is still refused, with the room's own " +
    "reason. Without this the fix would be indistinguishable from removing the check", wrongSong);
  const nobody = A.evaluate({ t: "ddjp.dj.remove", actor: "@gm:hs", x: "@nope:hs" }, state, 100);
  ok(nobody.ok === false && /Not in the rotation/.test(nobody.reason || ""),
    "S: and removing somebody who is not in the rotation still is too", nobody);

  // ── AND A PERMISSION NOBODY CAN REACH IS NOT A PERMISSION ─────────────────────────────────
  // v388 lowered the `redact` bar so moderators could delete messages. They still could not: the UI
  // offered the control only when `sender === me`, so the homeserver said yes and nothing asked.
  const uiChat = code("ui/chat.js");
  ok(/Chat\.mayRedactOthers/.test(uiChat),
    "S: the delete affordance is offered when this client MAY delete, not only when the message is " +
    "its own — a control that cannot be reached is the same as a permission not granted");
  const feat = code("features/chat.js");
  ok(/mayRedactOthers/.test(feat) && /MatrixBridge\.mayRedactIn/.test(feat),
    "S: asked through the feature, because `ui/` may not reach the transport (rule D)");
  ok(/function mayRedactIn/.test(code("backends/backend1/matrixbridge.js")),
    "S: and answered by comparing this client's power level against the ROOM'S OWN redact bar, so " +
    "the answer follows whatever that room was built or retrofitted with");
}

// ── PART T — AN INTENT ARRIVING WHILE THE RUNNER CANNOT WRITE IS HELD, NOT LOST ──────────────
// Reported from a live room at v390: "everything works with massive delays" and "sometimes you have
// to try several times". Both are what a DROPPED act looks like from the outside.
//
// A browser tab spends much of its life not-live — backgrounded, throttled, catching up after. In a
// shared room that costs one client its own writes. In a BOT room the runner's liveness is the whole
// room's liveness, so an intent thrown away there is an act that simply never happened for anybody.
// The gate itself is right: `Session.mayAuthor` is true only in `live`, and `catching-up` and
// `suspended` genuinely mean "I do not yet know what I missed", so a position minted then would be
// under the room's head and refused at every door.
{
  const ctx = { console, setInterval: () => 1, clearInterval: () => {}, Date: Date };
  vm.createContext(ctx);
  ctx.sent = []; ctx.said = [];
  ctx.caughtUp = false;
  ctx.Logger = { info: (m) => ctx.said.push(m), error: (m) => ctx.said.push(m) };
  ctx.Ranks = { levelOf: (n) => (n === "owner" ? 99 : 0) };
  ctx.Capabilities = { can: () => ({ permitted: true, reason: null }) };
  ctx.StreamManager = { getState: () => ({ settings: {} }), getLog: () => [] };
  ctx.Backends = { register: () => {}, active: () => "backend2", resolveMode: () => "backend2" };
  ctx.B2Checkpoint = { TYPE: "ddjp.checkpoint", floor: () => null, seal: () => ({ ok: false }) };
  ctx.MatrixBridge = {
    getMyPowerLevel: () => 99, getUserEffectiveRank: () => 40,
    getCreateContent: () => ({ ddjp_mode: "backend2" }),
    onRawEvent: () => {}, offRawEvent: () => {},
    mayAuthor: () => (ctx.caughtUp ? { ok: true } : { ok: false, reason: "not-live" }),
    onAuthorReady: (fn) => { ctx.authorReady = fn; },
    sendEvent: (room, type, c) => { ctx.sent.push({ room, type, body: c }); return "$ok"; },
  };
  for (const f of ["backends/backend2/authority.js", "backends/backend2/runner.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  }
  vm.runInContext("globalThis.R = B2Runner; globalThis.A = B2Authority;", ctx);
  const CH = { events_uncategorized: "!int:hs", events_owner: "!log:hs" };
  const intent = (t, i) => ({ type: "m.room.message", event_id: "$i" + i, room_id: "!int:hs",
    sender: "@a:hs", origin_server_ts: 1000 + i, content: { body: JSON.stringify({ t: t }) } });

  ctx.R.start({ channels: CH, spaceId: "!s:hs" });
  ctx.sent.length = 0;

  // NOT LIVE: three acts arrive. None may be written, and none may be lost.
  ctx.R._onRaw(intent("ddjp.media.len", 1));
  ctx.R._onRaw(intent("ddjp.media.len", 2));
  ctx.R._onRaw(intent("ddjp.media.len", 3));
  ok(ctx.sent.length === 0,
    "T: APPLIED — nothing is written while the runner is not live, or the hold below proves nothing",
    ctx.sent.length);
  ok(ctx.R.stats().held === 3,
    "T: and the three acts are HELD. Returning here threw them away: the person's act never " +
    "happened and they had to do it again, which is exactly what 'you have to try several times' " +
    "looks like from the outside", ctx.R.stats());

  // LIVE AGAIN: they go, in the order they arrived.
  ctx.caughtUp = true;
  ctx.authorReady();
  // Filtered, because going live also emits the announcement — which must come first and is not
  // one of the held acts.
  const relayed = ctx.sent.filter((x) => x.type === "ddjp.media.len");
  ok(ctx.sent[0].type === "ddjp.bot.here" && relayed.length === 3,
    "T: and all three are relayed the moment it can write again, behind the announcement",
    ctx.sent.map((x) => x.type));
  ok(relayed[0].body.src === "$i1" && relayed[2].body.src === "$i3",
    "T: in arrival order, each still naming the intent it came from",
    relayed.map((x) => x.body.src));
  ok(ctx.R.stats().held === 0, "T: and the hold is emptied", ctx.R.stats().held);

  // BOUNDED, and honest about what it let go.
  ctx.caughtUp = false;
  for (let i = 0; i < 500; i++) ctx.R._onRaw(intent("ddjp.media.len", 1000 + i));
  const st = ctx.R.stats();
  ok(st.held > 0 && st.held <= 250 && st.dropped > 0,
    "T: the hold is BOUNDED and says how many it let go — a runner away for a very long time keeps " +
    "the most recent acts rather than growing one array until the tab dies", st);
}

main().then(() => {
  console.log("[backends] PASS — a room declares its engine at creation and the app binds THAT engine on join. " +
    "The registry is driven both ways against the shipped backend2 rather than described: all four " +
    "interface names move together, bind REPLACES instead of merging, and object identity survives the " +
    "swap — which is the property that let ~400 call sites in features/ stay untouched and whose failure " +
    "would be silent. The second engine is real and bound, because a switch with one position is the " +
    "constant-dressed-as-a-condition backend-selection.md opens by warning about. The three refusals are " +
    "driven through the real join path, each by its own reason and each leaving the bootstrap engine bound " +
    "so the lobby it returns to still works; a control joins a ready room, so the refusals are the clause " +
    "and not the fixture. Order is pinned where it cannot be executed: the outgoing engine is reset before " +
    "the incoming one binds, and the mode is resolved before anything is cleared. THIS PROVES NOTHING " +
    "ABOUT EITHER ENGINE BEING CORRECT, and nothing here opens a browser (" + checks + " assertions)");
  process.exit(0);
}).catch((e) => {
  console.log((e && e.message) || String(e));
  process.exit(1);
});
