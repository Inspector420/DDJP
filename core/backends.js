// core/backends.js — the backend seam (J23).
//
// WHAT THIS IS. A room declares which consensus engine it runs. This file holds the three
// pieces `consensus/backend-selection.md` §2 specifies — registry, resolver, binder — plus the
// four interface objects the rest of the app talks to. Nothing above this file knows a second
// engine exists: features and ui go on calling `StreamManager`, `MatrixBridge`, `MatrixAccount`
// and `Capabilities` exactly as before, and the binder points those four at the engine the room
// asked for.
//
// ── WHY THE FOUR NAMES ARE SHELLS AND NOT THE ENGINES THEMSELVES ───────────────────────────
// The design doc offered "the existing global names rebound" as one option. That option does not
// exist. Every interface module declared itself `const StreamManager = (() => {…})()`, and a
// top-level `const` in a classic script (a) cannot be reassigned — it throws — and (b) lives in
// the global LEXICAL environment, which is consulted before the global object, so assigning
// `globalThis.StreamManager` would leave every bare `StreamManager.x()` in features/ still
// resolving to backend1's const. Both were driven at `ddjp_399` before this file was written.
//
// So the four names are declared ONCE, here, as stable empty objects, and `bind()` swaps their
// CONTENTS. The identity of each object never changes, which is what lets ~400 call sites in
// features/ keep working untouched. The modules return plain closure objects — `return { ingest,
// normalise, … }` — and use no `this`, so copying the method set across is safe.
//
// ── WHY THIS LIVES IN core/ AND NOT IN backends/ ───────────────────────────────────────────
// §2b says the three seams live in shared infra, in no single backend. The obvious reading of
// that is `backends/registry.js`. DO NOT MOVE IT THERE. `check-boundaries` builds its backend
// file set from `backendDirs()`, which returns SUBDIRECTORIES of `backends/` that contain a
// `.js`. A file sitting directly at `backends/registry.js` is in neither that set nor
// APP_AND_SHARED, so it would be judged by no boundary rule at all — an unjudged hole in the one
// file the whole seam passes through, which is the forty-ninth signature exactly. `core/` is
// judged. That is the entire reason for the location.
//
// This file names no backend. It holds a string key and a container, which is why it satisfies
// rule C's REASON (core must not depend on the backend) and not merely its grammar.
//
// ── WHAT IS DELIBERATELY NOT HERE ──────────────────────────────────────────────────────────
// No `report()`. J23 rules that both room types may end up reporting to the community browser,
// so reporting must not become the property of one engine. Keeping it off the registry entry is
// how that stays open; it costs nothing now and is expensive to undo once a second engine ships.

// ── THE FOUR INTERFACE OBJECTS ─────────────────────────────────────────────────────────────
// Declared before `Backends` so the binder is writing into bindings that already exist. Empty
// until something binds. Every `typeof X !== "undefined" && X.method` guard in the tree keeps
// working across that window: the name is always defined, the method is absent until bind.
const StreamManager = {};
const MatrixBridge  = {};
const MatrixAccount = {};
const Capabilities  = {};

const Backends = (() => {
  // The four slots an engine must fill to be a backend. This list is a GRAMMAR, not a
  // population: it said THREE in every doc in the tree until `ddjp_399`, because `MatrixAccount`
  // joined the interface at J59 in the same change as the file and no list was widened with it.
  // A seam built to the old list is one the account half cannot pass through.
  const SLOTS = ["StreamManager", "MatrixBridge", "MatrixAccount", "Capabilities"];

  const _shells = { StreamManager, MatrixBridge, MatrixAccount, Capabilities };
  const _reg = Object.create(null);
  let _active = null;

  // ── REGISTRY ─────────────────────────────────────────────────────────────────────────────
  // Each backend calls this once, at load, from its own files. `ready:false` means the engine is
  // registered and bindable but cannot run a room — `backend2` is that today. The flag is read at
  // join, so a room whose marker names an unfinished engine is REFUSED BY NAME rather than
  // half-run, which is the `checkpointformat.js` pattern: a room this build cannot serve is told
  // so in words, never left to fail later as something that looks like corruption.
  function register(modeId, impl, opts) {
    if (!modeId || typeof modeId !== "string") throw new Error("Backends.register: modeId required");
    const o = opts || {};
    const entry = _reg[modeId] || (_reg[modeId] = { modeId, parts: {}, ready: false, bootstrap: false });
    for (const slot of SLOTS) {
      if (impl && impl[slot]) entry.parts[slot] = impl[slot];
    }
    if (o.ready !== undefined) entry.ready = !!o.ready;
    if (o.bootstrap) entry.bootstrap = true;
    // ── THE CHANNEL PLAN IS THE ENGINE'S, NOT THE TRANSPORT'S (J24 slice 1) ────────────────
    // `backend-selection.md` §4 said transport is shared, and it mostly is — auth, discovery,
    // room CRUD, send/receive. But WHICH ROOMS A ROOM IS MADE OF is not shared: a bot-run room
    // is seven channels where a decentralised one is nineteen, because the rank ladder stops
    // being encoded in the channel topology. Since both engines ride the same transport module,
    // that module has to be able to serve either table, so the table is registered here rather
    // than being a constant inside one backend.
    if (Array.isArray(o.channels)) entry.channels = o.channels.slice();
    // HOW AN ENGINE INTRODUCES ITSELF. The label and blurb live with the engine so that no file
    // above the seam has to name one — the create screen offers what the registry describes, and
    // a mode id never appears as a literal outside this file.
    if (typeof o.label === "string") entry.label = o.label;
    // The token this engine's SAVE FILES carry in their envelope (`mode: "bot" | "full"`). Declared
    // by the engine so that the import path can refuse a file it cannot serve without naming any
    // engine itself — `check-backends` PART E forbids a concrete mode id above the seam.
    if (typeof o.fileMode === "string") entry.fileMode = o.fileMode;
    if (typeof o.blurb === "string") entry.blurb = o.blurb;
    return entry;
  }

  function has(modeId) { return !!_reg[modeId]; }
  function isReady(modeId) { return !!(_reg[modeId] && _reg[modeId].ready && _missing(modeId).length === 0); }
  function active() { return _active; }
  function modes() { return Object.keys(_reg); }

  // Which slots an engine has not filled. Used by `bind` and by the guard; an engine that
  // registers three of four is the failure this returns rather than a TypeError later.
  // The channel plan for a mode, or null when that mode registered none. Readable WITHOUT
  // binding, which is what lets a room be created in a mode the client is not currently running
  // (`bot-backend.md` §10b: the mode travels as a value, because binding early and then failing
  // to create would leave the lobby holding an engine with nothing in it).
  function planFor(modeId) {
    const e = _reg[modeId];
    return (e && e.channels) ? e.channels : null;
  }

  // What the create screen shows for a mode. `null` for one that never described itself, so an
  // engine cannot be offered by accident.
  // Which engine a save file belongs to, from the token in its envelope. `null` when no registered
  // engine claims it, which is itself the answer the import path needs.
  function forFileMode(token) {
    if (typeof token !== "string" || !token) return null;
    const hit = Object.keys(_reg).find((k) => _reg[k].fileMode === token);
    return hit || null;
  }

  function describe(modeId) {
    const e = _reg[modeId];
    if (!e || !e.label) return null;
    return { id: e.modeId, label: e.label, blurb: e.blurb || "" };
  }

  function _missing(modeId) {
    const e = _reg[modeId];
    if (!e) return SLOTS.slice();
    return SLOTS.filter((s) => !e.parts[s]);
  }

  // ── RESOLVER ─────────────────────────────────────────────────────────────────────────────
  // Content in, mode id out. It takes the create-content OBJECT rather than a room, so it needs
  // no SDK and no bound engine — the caller (features/room.js) already holds the Space and reads
  // its state, and transport hands the content over.
  //
  // WHY THE MARKER IS IN THE ROOM'S CREATE RECORD AND NOT IN ROOM SETTINGS. Settings are produced
  // BY an engine: `StreamManager.on("ddjp.room.settings", …)` folds them out of replayed events.
  // Reading settings to choose the engine needs an engine already running, which is circular.
  // `m.room.create` is written by the homeserver when the Space is made, can never change
  // afterwards, and exists regardless of how the room is structured inside — so it still answers
  // for a future room type that has no settings channel at all.
  //
  // NO MARKER MEANS NO ANSWER, and the caller refuses. There is deliberately no fall-back to
  // backend1 for an unmarked room: that was §2a's rule, written when legacy rooms existed, and
  // this build supports none (`08-build-and-deploy.md` §Legacy). A default here would be a branch
  // that only ever runs for rooms the app already refuses — the dead branch `ddjp_hashref` was,
  // which is what the design doc opens by warning against.
  function resolveMode(createContent) {
    if (!createContent || typeof createContent !== "object") return null;
    const m = createContent.ddjp_mode;
    return (typeof m === "string" && m) ? m : null;
  }

  // ── BINDER ───────────────────────────────────────────────────────────────────────────────
  // Points the four names at one engine. REPLACES, never merges — each shell is emptied before
  // it is filled, so a slot the incoming engine does not define cannot be served by the outgoing
  // one. That is the same rule `setRoomScope` follows, for the same reason: a merge here would
  // leave one engine answering for another and look like the room working.
  function bind(modeId) {
    const e = _reg[modeId];
    if (!e) throw new Error("Backends.bind: no engine registered for mode \"" + modeId + "\"");
    const missing = _missing(modeId);
    if (missing.length) {
      throw new Error("Backends.bind: engine \"" + modeId + "\" is missing " + missing.join(", "));
    }
    for (const slot of SLOTS) _fill(_shells[slot], e.parts[slot]);
    _active = modeId;
    try { if (typeof Logger !== "undefined" && Logger.info) Logger.info("Backends: bound " + modeId); } catch (err) {}
    return modeId;
  }

  // Boot binding. Login, room discovery and the room list all run BEFORE any room is entered, so
  // the four names cannot be empty while the lobby is up — `app.js` reaches `MatrixAccount` long
  // before `Room.join` exists to bind anything. §4 is what makes this honest rather than a
  // hardwire: discovery and account are shared across every near-term mode, so binding the
  // bootstrap engine to serve the lobby is binding the transport everyone shares.
  //
  // Nothing outside this file names the bootstrap engine. The engine declares itself.
  function bindBootstrap() {
    const id = Object.keys(_reg).find((k) => _reg[k].bootstrap);
    if (!id) throw new Error("Backends.bindBootstrap: no engine registered itself as bootstrap");
    return bind(id);
  }

  // Swap one shell's contents. Delete-then-assign rather than reassign: the OBJECT IDENTITY is
  // the contract with every call site in features/, so it must survive the swap.
  function _fill(shell, src) {
    for (const k of Object.keys(shell)) delete shell[k];
    Object.assign(shell, src);
  }

  // NOTE FOR WHOEVER ADDS `reset()`. §2b specifies `Backends.reset()` on leave. DO NOT ADD IT.
  // `BEHAVIOUR.md` §Entering a room: per-room state is cleared on room ENTRY, never on leave, and
  // that ordering is load-bearing. The lobby's saves list reads the LAST room's checkpoints
  // through `Room.heldCheckpoints()` → `StreamManager.heldCheckpoints()`, and its own empty-state
  // text is "Open a room to see the saves it holds." Unbind on leave and that control goes blank.
  // Binding is replace-on-entry; there is nothing to undo on the way out.

  // ── EXPOSED FOR THE HARNESS, AND NOT A SECOND BINDER ───────────────────────────────────────
  // `tests/_load.js` builds a sandbox by concatenating a SUBSET of the tree — a guard that only
  // needs the stream half never loads `matrixbridge.js`. `bind()` refuses a partial engine, and
  // it should: a room served by three of four slots is a bug. But a sandbox with empty shells is
  // WORSE THAN A FAILING ONE, because backend1's own modules reach the interface through guarded
  // reads (`typeof StreamManager !== "undefined" && StreamManager.normalise`), so an unfilled
  // shell does not throw — it quietly takes the fallback branch, and the guard above it reports a
  // finding about behaviour that never ran. That is absence reading as a result.
  //
  // So the harness fills what registered and says so. Production never calls this: `app.js` calls
  // `bindBootstrap`, `Room.join` calls `bind`, and both are strict.
  function _fillFromRegistered() {
    const id = Object.keys(_reg).find((k) => _reg[k].bootstrap) || Object.keys(_reg)[0];
    if (!id) return null;
    for (const slot of SLOTS) if (_reg[id].parts[slot]) _fill(_shells[slot], _reg[id].parts[slot]);
    _active = id;
    return id;
  }

  return { register, has, isReady, bind, bindBootstrap, resolveMode, planFor, describe, forFileMode, active, modes, SLOTS, _missing,
    _fillFromRegistered /* exposed for the guard harness */ };
})();
