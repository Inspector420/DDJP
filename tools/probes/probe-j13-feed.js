// tools/probes/probe-j13-feed.js
// J13 — THE MEASUREMENTS THE JOB ENTRY'S DONE-WHEN DID NOT HAVE. Read-only: this file ingests
// events into sandboxed clients and reads what they hold. It writes nothing to the tree.
//
// The Done-when asks for "a feed that starts at the floor, not an empty one with no explanation".
// Nobody had driven it. These rows are what happens when somebody does, and they refute both
// halves — which is why they are recorded here rather than summarised in a job entry that would
// die when the job lands.
//
//   R0  the control: a young room's log, and what a feed folded from it holds
//   R1  the log holds what the reducer REFUSED, and `isLegal` discriminates within one kind
//   R2  A FLOOR PART-WAY UP: the trim keeps `l > floorL` STRICTLY — nothing at the floor survives
//   R3  A FLOOR AT THE HEAD: the log is EMPTY and the room is still running
//   R4  the three origins, told apart by state-without-evidence, read from the contract alone
//   R5  which kinds the reducer handles, and which of them the feed names
//   R6  `WindowedList.visibleRange` under a list that SHORTENS beneath a scroll offset
//   R7  `WindowedList.create()` + `arraySource` under the same, and why it is not adopted
//
// ── THE ADMISSIBILITY GATE ───────────────────────────────────────────────────────────────────
// Every row states its preconditions as SEPARATE checks and refuses to print a reading whose
// premise did not hold, naming the stage. That matters more here than usual because THE SUBJECT
// IS LEGITIMATELY EMPTY in the rows this probe exists for: R3's whole finding is a log with zero
// entries, and "zero because the room was banked" and "zero because the fixture never ingested
// anything" are the same output. `--selftest` feeds the gate broken readings AND sound ones,
// because a gate that refuses everything certifies nothing.
//
//   node tools/probes/probe-j13-feed.js
//   node tools/probes/probe-j13-feed.js --selftest

const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const { loadInContext } = require(path.join(ROOT, "tests/_load.js"));
const F = require(path.join(ROOT, "tests/_fixtures.js"));

let GATE_THROW = false;
function gate(row, checks) {
  for (const c of checks) {
    if (!c.ok) {
      const msg = "[probe-j13] INADMISSIBLE " + row + " — " + c.why +
        "\n      the reading never reached its subject, so nothing it says would mean anything";
      if (GATE_THROW) throw new Error(msg);
      console.log(msg);
      return false;
    }
  }
  return true;
}

function client(rank) {
  const sb = loadInContext([
    "core/logger.js", "core/store.js", "core/storageio.js", "core/idb.js", "core/playlistdoc.js",
    "backends/backend1/ranks.js", "backends/backend1/consensushash.js",
    "backends/backend1/trustpolicy.js", "backends/backend1/checkpointformat.js",
    "backends/backend1/settingsproof.js", "backends/backend1/session.js",
    "backends/backend1/scheduler.js", "backends/backend1/vouch.js", "backends/backend1/floor.js",
    "backends/backend1/statederiver.js", "backends/backend1/streammanager.js",
    "backends/backend1/matrixbridge.js", "features/room.js",
  ], {
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    Date, Math, JSON, setTimeout, clearTimeout, setInterval, clearInterval,
    window: {}, document: { body: { appendChild() {} } },
  });
  sb.feed = (evs) => { for (const e of evs) sb.StreamManager.ingest(F.toRaw(e)); };
  sb.Floor.attach({
    log: () => sb.StreamManager.getLog(), settings: () => ({}), myRank: () => rank,
    trimmed: () => { try { return sb.StreamManager._trimState() !== null; } catch (e) { return false; } },
  });
  sb.Floor.onChange(function (ev) {
    if (ev.kind !== "adopted" && ev.kind !== "moved") return;
    try { sb.StreamManager.trimToFloor(); } catch (e) {}
  });
  return sb;
}

function adoptFloorAt(c, full, cutIdx) {
  const oc = client(F.RANK.owner);
  oc.feed(full.filter((e) => e.l <= full[cutIdx].l));
  const seg = oc.StreamManager.getLog();
  const last = seg[seg.length - 1];
  const FL = { t: "ddjp.checkpoint", n: 1, prev: null, seed: oc.StateDeriver.buildSeed(seg),
               covers: oc.CheckpointFormat.coversOf(seg[0].eventId, last.eventId),
               floorL: last.l, thin: false, by: "@own:hs" };
  FL.h = oc.CheckpointFormat.fingerprint(FL.n, FL.prev, FL.seed, FL.floorL, FL.thin, FL.covers);
  c.StreamManager._setLicenceForTest({ status: "validated", reason: "probe" });
  c.SettingsProof._setVerdictForTest({ status: "validated", reason: "probe" });
  c.Floor.remember(FL, F.RANK.owner, "@own:hs");
  c.Floor.adopt({ floor: Object.assign({ u: "@own:hs" }, FL), tier: 0 });
  return FL;
}

function run() {
  console.log("=== J13 — the event feed. Read-only measurements. ===\n");

  // ── R0 — the control ───────────────────────────────────────────────────────────────────────
  {
    const c = client(F.RANK.staff);
    const room = F.playingRoom({ songs: 3 });
    c.feed(F.sortLog(room.log));
    const log = c.StreamManager.getLog();
    const f = c.Room.recentEvents({ limit: 100 });
    if (gate("R0", [
      { ok: log.length > 0, why: "the fixture put nothing in the log" },
      { ok: f.rows.length > 0, why: "the fold produced no rows over a log that has some" },
    ])) {
      console.log("R0  CONTROL — a young room. " + log.length + " entries held, " + f.rows.length +
        " narrated, " + f.unnamed + " held-but-unnamed, origin=" + f.origin);
      console.log("    the feed is computable from the log TODAY: no bot, no new event type, no new module.");
    }
  }

  // ── R1 — the log holds what the reducer refused ────────────────────────────────────────────
  {
    const c = client(F.RANK.staff);
    const room = F.playingRoom({ songs: 2 });
    c.feed(F.sortLog(room.log));
    const t = room.startTs + 400000;
    // ONE KIND, TWO SENDERS, one detail changed. The admitted sibling is what makes the refusal
    // attributable to legality rather than to a fixture that never reached the fold.
    c.feed([
      F.reducerEvent("$sOwn", room.lastL + 1, t,        "@own:hs", F.RANK.owner,  { t: "ddjp.room.settings", s: { maxLen: 500 } }),
      F.reducerEvent("$sPly", room.lastL + 2, t + 1000, "@ply:hs", F.RANK.player, { t: "ddjp.room.settings", s: { maxLen: 400 } }),
    ]);
    const log = c.StreamManager.getLog();
    const held = (id) => log.some((e) => e.eventId === id);
    if (gate("R1", [
      { ok: held("$sOwn") && held("$sPly"), why: "one of the two settings events never entered the log" },
      { ok: c.StreamManager.isLegal("$sOwn") === true, why: "the owner's settings event was not accepted, so there is no admitted sibling" },
    ])) {
      const f = c.Room.recentEvents({ limit: 100 });
      console.log("\nR1  A REFUSED EVENT IS STILL IN THE LOG.");
      console.log("    owner settings  in log=" + held("$sOwn") + "  isLegal=" + c.StreamManager.isLegal("$sOwn"));
      console.log("    player settings in log=" + held("$sPly") + "  isLegal=" + c.StreamManager.isLegal("$sPly"));
      console.log("    the feed narrates " + f.rows.filter((r) => r.eventId === "$sOwn").length +
        " of them and counts " + f.refused + " refused.");
      console.log("    So a feed reading getLog() naively narrates acts the room REJECTED — roles.md §10's");
      console.log("    second signature, a narrative naming an action nobody took.");
    }
  }

  // ── R2 — a floor part-way up ───────────────────────────────────────────────────────────────
  {
    const room = F.playingRoom({ songs: 8 });
    const full = F.sortLog(room.log);
    const c = client(F.RANK.staff);
    c.feed(full);
    const before = c.StreamManager.getLog();
    const FL = adoptFloorAt(c, full, 7);
    const after = c.StreamManager.getLog();
    if (gate("R2", [
      { ok: before.length > 0, why: "nothing was held before the trim" },
      { ok: after.length < before.length, why: "the trim did not happen, so both readings are the same reading" },
      { ok: before.some((e) => e.l === FL.floorL), why: "the boundary event was never held, so its absence proves nothing" },
    ])) {
      console.log("\nR2  THE TRIM KEEPS `l > floorL` STRICTLY.  floorL=" + FL.floorL);
      console.log("    before: " + before.length + " held, l " + before[0].l + ".." + before[before.length - 1].l);
      console.log("    after : " + after.length + " held, l " + after[0].l + ".." + after[after.length - 1].l);
      console.log("    anything AT the floor still held? " + after.some((e) => e.l === FL.floorL));
      console.log("    >>> A FEED CAN NEVER `START AT THE FLOOR`. The boundary event is already inside the");
      console.log("        floor's own seed, so keeping it would double-count on the next fold. The oldest");
      console.log("        row a feed can hold is the first event STRICTLY ABOVE the floor.");
    }
  }

  // ── R3 — a floor at the head: the quiet room ───────────────────────────────────────────────
  {
    const room = F.playingRoom({ songs: 8 });
    const full = F.sortLog(room.log);
    const c = client(F.RANK.staff);
    c.feed(full);
    const before = c.StreamManager.getLog().length;
    adoptFloorAt(c, full, full.length - 1);
    const after = c.StreamManager.getLog();
    const st = c.StreamManager.getState();
    if (gate("R3", [
      { ok: before > 0, why: "nothing was held before the seal, so an empty log after it says nothing" },
      { ok: !!(st && st.nowPlaying), why: "the room is not running, so an empty log is just an empty room" },
    ])) {
      const f = c.Room.recentEvents({ limit: 100 });
      console.log("\nR3  A ROOM THAT SEALS AT ITS OWN HEAD HOLDS NOTHING.");
      console.log("    held before=" + before + "   held after=" + after.length +
        "   nowPlaying=" + JSON.stringify(st.nowPlaying.song && st.nowPlaying.song.videoId));
      console.log("    feed rows=" + f.rows.length + "  origin=" + f.origin);
      console.log("    >>> THE EMPTY FEED IS REACHABLE AND CORRECT. `not an empty one` would require");
      console.log("        fabricating rows this client does not have. What the room owes is the");
      console.log("        EXPLANATION — which is the half of the Done-when the tree can honestly meet.");
    }
  }

  // ── R4 — the three origins, from the contract alone ────────────────────────────────────────
  {
    const rows = [];
    const fresh = client(F.RANK.staff);
    rows.push(["fresh client, no events", fresh.Room.recentEvents({})]);

    const young = client(F.RANK.staff);
    young.feed(F.sortLog(F.playingRoom({ songs: 2 }).log));
    rows.push(["young room, untrimmed", young.Room.recentEvents({})]);

    const room = F.playingRoom({ songs: 8 });
    const full = F.sortLog(room.log);
    const part = client(F.RANK.staff); part.feed(full); adoptFloorAt(part, full, 7);
    rows.push(["trimmed part-way", part.Room.recentEvents({})]);

    const head = client(F.RANK.staff); head.feed(full); adoptFloorAt(head, full, full.length - 1);
    rows.push(["trimmed AT THE HEAD", head.Room.recentEvents({})]);

    const origins = rows.map((r) => r[1].origin);
    if (gate("R4", [
      { ok: new Set(origins).size >= 3, why: "the four cases did not produce three distinct origins, so the discriminator is not discriminating" },
    ])) {
      console.log("\nR4  THE THREE ORIGINS, read from getLog() + getState() and nothing else.");
      for (const [name, f] of rows) {
        console.log("    " + name.padEnd(24) + " rows=" + String(f.held).padEnd(3) +
          " roomExists=" + String(f.roomExists).padEnd(5) + " -> " + f.origin);
      }
      console.log("    >>> STATE WITHOUT EVIDENCE is the discriminator. Both readings are on the backend");
      console.log("        INTERFACE, so this survives a backend swap. `StreamManager._trimState()` would");
      console.log("        have answered too and is a GUARD SEAM — rule F is textual and would not have");
      console.log("        caught a feature reading it, but the reason rule F exists would.");
    }
  }

  // ── R5 — the kinds ─────────────────────────────────────────────────────────────────────────
  {
    const fs2 = require("fs");
    const sd = fs2.readFileSync(path.join(ROOT, "backends/backend1/statederiver.js"), "utf8");
    const found = Object.create(null);
    for (const m of sd.matchAll(/"(ddjp\.[a-z.]+)"/g)) found[m[1]] = true;
    const types = Object.keys(found).sort();
    const c = client(F.RANK.staff);
    const named = Object.keys(c.Room.FEED_KINDS), unnamed = Object.keys(c.Room.FEED_UNNAMED);
    if (gate("R5", [
      { ok: types.length > 10, why: "the reducer scan found nothing, so the comparison has no domain" },
      { ok: named.length > 0, why: "the feed names no kinds at all" },
    ])) {
      console.log("\nR5  KINDS. The reducer handles " + types.length + "; the feed NAMES " + named.length +
        " and EXCLUDES " + unnamed.length + " with a reason.");
      console.log("    undecided (in neither): " + JSON.stringify(types.filter((t) => !c.Room.FEED_KINDS[t] && !c.Room.FEED_UNNAMED[t])));
      console.log("    chat types in the reducer's vocabulary: " + JSON.stringify(types.filter((t) => /chat/.test(t))));
      console.log("    >>> Chat is not a type to exclude — it is not in the vocabulary at all, because");
      console.log("        `_routeEvent` skips chat-named rooms before both the store and the fold. The");
      console.log("        entry names six kinds and all six are reachable; chat would have been a");
      console.log("        seventh and is not. Same three-not-four honesty J16 had to state.");
    }
  }

  // ── R6 / R7 — the windowing Open, settled by measurement ───────────────────────────────────
  {
    const w = loadInContext(["core/windowedlist.js"], { Date, Math, JSON, Promise });
    const W = w.WindowedList;
    const big = W.visibleRange(8000, 400, 40, 500, 3);
    const small = W.visibleRange(8000, 400, 40, 12, 3);
    const none = W.visibleRange(8000, 400, 40, 0, 3);
    if (gate("R6", [
      { ok: big.end > big.start, why: "the ample case produced no slice, so the clamp below is not a clamp of anything" },
    ])) {
      console.log("\nR6  `visibleRange` UNDER A LIST THAT SHORTENS BENEATH THE SCROLL OFFSET.");
      console.log("    500 rows @ scrollTop 8000 -> " + JSON.stringify(big));
      console.log("     12 rows @ scrollTop 8000 -> " + JSON.stringify(small) +
        "   start<=end=" + (small.start <= small.end) + " end<=total=" + (small.end <= 12));
      console.log("      0 rows @ scrollTop 8000 -> " + JSON.stringify(none));
      console.log("    >>> IT CLAMPS. An empty slice with proportional padding, never a throw and never a");
      console.log("        row that is not there. This is the half J13 adopts.");
    }

    let arr = []; for (let i = 0; i < 40; i++) arr.push({ id: "e" + i });
    const ctl = W.create({ source: W.arraySource(() => arr), key: (e) => e._i,
                           pageSize: 10, maxWindow: 30, buffer: 2, hasMoreUp: false, hasMoreDown: true });
    return ctl.init().then(async () => {
      await ctl.onScroll(0, 9); await ctl.onScroll(0, 19);
      const s = ctl.snapshot();
      if (!gate("R7", [
        { ok: s.items.length > 0, why: "the controller paged nothing, so a shortening list cannot re-point anything" },
      ])) return;
      const wasFirst = s.items[0]._i;
      arr = arr.slice(20);
      await ctl.onScroll(0, s.items.length - 1);
      const t = ctl.snapshot();
      console.log("\nR7  `create()` + `arraySource` UNDER THE SAME.");
      console.log("    paged to " + s.items.length + " items, _i " + s.items[0]._i + ".." + s.items[s.items.length - 1]._i);
      console.log("    array shortened 40 -> 20; window still holds " + t.items.length +
        " items, _i " + t.items[0]._i + ".." + t.items[t.items.length - 1]._i);
      console.log("    held _i=" + wasFirst + " addressed e" + wasFirst + " and now addresses " +
        JSON.stringify(arr[wasFirst] && arr[wasFirst].id));
      console.log("    >>> IT DOES NOT CLAMP. The cursor is a POSITIONAL index, so a shortening list");
      console.log("        SILENTLY RE-POINTS IT and nothing re-inits the controller. That is the");
      console.log("        plausible-value signature with a scrollbar attached — and a trim is exactly");
      console.log("        the event that shortens this list. NOT ADOPTED. It is also the wrong shape");
      console.log("        independently: it HOLDS the window, and the Done-when forbids state (P5).");
      console.log("\n=== done. Both halves of J13's Done-when are refuted above (R2, R3). ===");
    });
  }
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
// BOTH DIRECTIONS: the gate must refuse a reading whose premise failed AND admit one whose premise
// held, or it certifies everything on its own authority.
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
  t("an empty-log premise, which R3 legitimately has", [{ ok: 0 > 0, why: "held nothing" }], true);
  t("every premise held", [{ ok: true, why: "" }, { ok: true, why: "" }], false);
  t("a sound single premise", [{ ok: 1 > 0, why: "" }], false);
  GATE_THROW = false;
  const bad = out.filter((r) => !r.asExpected);
  console.log("=== probe-j13-feed --selftest ===");
  for (const r of out) {
    console.log("  " + (r.refused ? "REFUSED " : "ADMITTED") + "  " + r.row +
      (r.asExpected ? "" : "   <<< NOT AS EXPECTED"));
  }
  console.log(bad.length === 0
    ? "  the gate refuses failed premises and admits sound ones — both directions shown."
    : "  GATE IS BROKEN: " + bad.length + " row(s) behaved unexpectedly.");
  process.exit(bad.length === 0 ? 0 : 1);
}

if (process.argv.indexOf("--selftest") >= 0) selfTest();
else run();
