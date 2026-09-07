// tests/check-floor-reload.js
// WALL: THERE IS NO STORED-FLOOR PATH. THE FLOOR ARRIVES BY REPLAY AND ADOPTION.
//
// THE LESSON THIS GUARD KEEPS, because the trap is general and cost this project a release:
// the floor used to be written to disk and re-verified on load before being trusted — which is
// right, and the code said so. But re-verification needs the event log, and it ran during the
// WIRING phase, which happens BEFORE replay. The log was empty, the span could not be found,
// verification failed, the floor was discarded. Every time, every reload. Persistence worked.
// Verification worked. The CALL ORDER defeated both. Correct locally, wrong across the path — this
// codebase's recorded signature failure, and the reason a guard asks WHERE a thing is called from
// and not merely whether it exists.
//
// WHY THE PATH IS NOW GONE RATHER THAN FIXED. Moving the call after replay was not enough, because
// the restore rule was stricter than the acceptance rule it was restoring. A floor is accepted
// three ways — `real` (computed yourself), `verified` (an owner checkpoint, taken on authority),
// `quorum` (enough non-owners agreeing). loadStored demanded a RECOMPUTE of all three, including
// the ones you by definition never computed. It also could not succeed in the common case: the
// recompute looks for the floor's `covers` START, which is below the floor by definition, and
// trimming has already dropped it. The answer was `did-not-recompute` and the saved floor was
// DELETED — observed on both clients in a live log.
//
// So there is one path now instead of two, and it is the one that works: replay rebuilds the log,
// checkpoints arrive, adoption picks the best one. This guard locks that there is no second path
// to drift out of agreement with the first.
//
// PART A — the stored-floor surface does not exist, no production caller reaches for it, and
//          nothing writes one either.
// PART B — the surviving path works: a checkpoint arrives, is selected, is adopted, floor moves.
// PART C — the bridge supplies no storage providers, and losing a floor still resets memory.

const path = require("path");
const { loadInContext } = require(path.join(__dirname, "_load.js"));
const F = require("./_fixtures");
const fs = require("fs");

function fail(m, g) { console.log("[floor-reload] FAIL — " + m); if (g !== undefined) console.log("      got " + JSON.stringify(g)); process.exit(1); }
function ok(c, m, g) { if (!c) fail(m, g); }

const OWNER = F.RANK.owner, STAFF = F.RANK.staff;
const ROOM = F.playingRoom({ songs: 6 });
const LOG = F.sortLog(ROOM.log);

const ROOT = path.join(__dirname, "..");
const FLOOR_SRC = fs.readFileSync(path.join(ROOT, "backends/backend1/floor.js"), "utf8");

function client() {
  const sb = loadInContext([
    "core/logger.js", "backends/backend1/ranks.js", "core/playlistdoc.js",
    "backends/backend1/checkpointformat.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/consensushash.js", "backends/backend1/trustpolicy.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
  ], { Date });
  sb.Floor.attach({ log: () => sb.StreamManager.getLog(), settings: () => ({}),
                    myRank: () => STAFF, trimmed: () => false });
  sb.feed = (evs) => { for (const e of evs) sb.StreamManager.ingest(F.toRaw(e)); };
  return sb;
}

function sealAt(sb, cutIndex, author, rank) {
  const seg = LOG.slice(0, cutIndex);
  const last = seg[seg.length - 1];
  const seed = sb.StateDeriver.buildSeed(seg);
  const covers = seg[0].eventId + ".." + last.eventId;
  const h = sb.Floor.fingerprint(1, null, seed, last.l, false, covers);
  return { t: "ddjp.checkpoint", n: 1, prev: null, seed: seed, h: h,
           covers: covers, floorL: last.l, thin: false, by: author, _rank: rank };
}

// ── PART A — the surface is gone, and nothing reaches for it ─────────────────────────────────
{
  const c = client();

  // The module surface. A deletion that leaves the entry point exported has deleted nothing —
  // the next caller finds it and the two paths are back.
  for (const name of ["loadStored", "computesThrough", "_priorStateFor"]) {
    ok(typeof c.Floor[name] === "undefined",
      "A: APPLIED — Floor." + name + " is not exported. The stored-floor path is deleted rather "
      + "than merely unused, so it cannot be picked up again by someone who finds it and assumes "
      + "it works", typeof c.Floor[name]);
    ok(new RegExp("function\\s+" + name + "\\s*\\(").test(FLOOR_SRC) === false,
      "A: APPLIED — and " + name + " is not defined in floor.js either. Dead code does not exist");
  }

  // THE CALLERS ARE DERIVED BY SCANNING, not listed from memory. A hand-listed set is a set that
  // stops covering the tree the moment somebody adds a file — which is how the floor bound came to
  // be applied at only the call sites one session happened to notice.
  const scanned = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== "node_modules" && entry.name !== "tests") walk(p); }
      else if (entry.name.endsWith(".js")) scanned.push(p);
    }
  })(ROOT);
  ok(scanned.length > 40, "A: setup — the scan actually walked the tree (probe applied)", scanned.length);
  ok(scanned.some((p) => p.endsWith("matrixbridge.js")), "A: setup — including the bridge, which held the only production caller");

  const callers = scanned.filter((p) => /Floor\.loadStored\s*\(|\bloadStored\s*\(/.test(fs.readFileSync(p, "utf8")));
  ok(callers.length === 0,
    "A: APPLIED — no file outside tests/ calls loadStored. The bridge used to call it from "
    + "setRoomLive; that call is gone rather than left pointing at a stub",
    callers.map((p) => path.relative(ROOT, p)));

  // NOTHING WRITES EITHER. Asserted here, before the behavioural part, deliberately: floor.js has
  // no `save` in its env any more, so a restored _env.save call throws a TypeError the moment
  // adoption runs. That would go red — but red by CRASH, from a mutation whose own assertion never
  // got to speak. A guard that only fails by crashing is one swallowed exception away from failing
  // silently, which is a shape this project has already been bitten by four times.
  ok(/_env\.save\s*\(/.test(FLOOR_SRC) === false,
    "A: APPLIED — floor.js never writes a floor to disk. Nothing loads one, so writing one would "
    + "be a store with no reader — and a store with no reader is how the two rules drifted apart "
    + "in the first place");
  ok(/_env\.drop\s*\(/.test(FLOOR_SRC) === false,
    "A: APPLIED — and never deletes one, because there is nothing there to delete");
}

// ── PART B — the surviving path: replay, then adopt ──────────────────────────────────────────
{
  const c = client();
  c.feed(LOG);
  ok(c.StreamManager.getLog().length === LOG.length, "B: setup — the log is replayed (probe applied)");

  // REPLAY ALONE GIVES NO FLOOR, and that is the intended shape rather than a regression: a floor
  // is somebody's attested claim, so it arrives as a checkpoint or not at all.
  ok(c.Floor.position() === -1,
    "B: APPLIED — a client that has replayed the whole log still holds NO floor. Nothing is read "
    + "from disk, so there is no second route by which one could appear", c.Floor.position());

  const cp = sealAt(c, 4, "@own:hs", OWNER);
  c.Floor.remember(cp, OWNER, "@own:hs");
  const sel = c.Floor.select(STAFF, {}, () => true);
  ok(sel && sel.tier === 0, "B: setup — the owner's checkpoint is selectable (probe applied)", sel);

  const emitted = [];
  c.Floor.onChange((e) => emitted.push(e));
  ok(c.Floor.adopt(sel) === true, "B: setup — and adoptable");
  ok(c.Floor.position() === cp.floorL,
    "B: APPLIED — the floor arrives by ADOPTION. This is the one path, and it is the one that "
    + "worked: the restore path demanded a recompute of floors taken on authority, which is a "
    + "stricter rule than the one that accepted them",
    { got: c.Floor.position(), want: cp.floorL });
  ok(emitted.some((e) => e.kind === "adopted"),
    "B: APPLIED — and it announces itself, because a floor change decides what everyone computes "
    + "from and a flag nobody reads is this codebase's signature bug", emitted);
}

// ── PART C — nothing writes, and losing a floor still clears memory ──────────────────────────
{
  const bridge = fs.readFileSync(path.join(ROOT, "backends/backend1/matrixbridge.js"), "utf8");
  const attach = bridge.match(/Floor\.attach\(\{[\s\S]*?\n\s*\}\);/);
  ok(!!attach, "C: setup — the bridge's Floor.attach block was located (probe applied)");
  for (const provider of ["load", "save", "drop"]) {
    ok(new RegExp("(^|[^\\w])" + provider + "\\s*:").test(attach[0]) === false,
      "C: APPLIED — the bridge supplies no `" + provider + ":` provider to Floor. The persistence "
      + "is gone at both ends rather than orphaned at one", attach[0]);
  }

  // WHAT WAS DELIBERATELY KEPT. Withdrawing a floor still resets in-memory state — only the
  // persistence was lost. Asserted behaviourally in check-floor PART F (revalidate -> withdrawn ->
  // current() === null) and not duplicated here; what belongs here is that _withdraw no longer
  // reaches for storage while still doing its real work.
  const withdraw = FLOOR_SRC.match(/function _withdraw\(\)[^\n]*/);
  ok(!!withdraw, "C: setup — _withdraw was located (probe applied)");
  ok(/_trusted\s*=\s*null/.test(withdraw[0]) && /_emit\(/.test(withdraw[0]),
    "C: APPLIED — _withdraw still clears the trusted floor and announces it. The deletion took the "
    + "persistence and nothing else", withdraw[0]);
}

console.log("[floor-reload] PASS — there is no stored-floor path and the floor arrives by replay "
  + "and adoption: loadStored, computesThrough and _priorStateFor are gone from floor.js and its "
  + "exports, no file outside tests/ calls them (the callers are DERIVED by scanning the tree, not "
  + "listed from memory), a client that has replayed the whole log still holds no floor until a "
  + "checkpoint arrives and is adopted, the adoption emits, neither end of the persistence "
  + "survives — floor.js writes nothing and the bridge supplies no load/save/drop provider — and "
  + "_withdraw still resets in-memory state, so what was deleted is the storage and not the "
  + "withdrawal");
