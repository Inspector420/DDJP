// backends/backend2/checkpoint.js — the runner's checkpoints and floor (J24 slice 5).
//
// backend1's checkpoint machinery is large because it has a hard problem: many peers may seal, none
// of them is trusted, and a checkpoint lives in a DIFFERENT ROOM from the events it covers. So it
// collects candidates, grades them, re-verifies them, keeps substitutes, and reconciles a claimed
// position against a log that arrived separately.
//
// Bot mode has none of those problems, and this file is small because of it:
//
//   - **Nothing is vouched.** The runner does not delete its own messages, so there is nothing to
//     regenerate and no trust cascade to run.
//   - **Checkpoints live in `events-owner`, beside the events they cover** (`bot-backend.md` §2c).
//     A checkpoint sits at its own position in the one ordered timeline it describes, so there is
//     no cross-room ordering to reconcile — which is most of what `floor` exists for.
//   - **The floor is just the newest checkpoint.** No candidates, no grading.
//
// ── WHAT IS STILL LOAD-BEARING, AND WHY ───────────────────────────────────────────────────────
// Two writers may author here: the runner AND the owner, who sits at the same power level because
// the owner is trusted to manage the bot (§10). Nothing in the design leans on single-writer, and
// this file must not either. Two consequences, both handled below:
//
//   1. **Ties are broken by LOG ORDER, never by arrival order.** If two checkpoints claim the same
//      `n`, every client must pick the same one — and they do, because they all fold the same
//      ordered room. Picking by "whichever reached me first" would divide the room by network luck,
//      which is the one thing a consensus model may never do.
//   2. **The fingerprint is still verified.** Trusting the writer is not the same as trusting the
//      bytes: a truncated or garbled blob is not a statement anybody made.
//
// And the floor only ever moves FORWARD. A checkpoint replayed from history — which happens on
// every cold start — must not rewind a room that has already moved past it.
//
// ── THE OWNER'S RESTORE IS THE ROOM'S NEW BEGINNING (J79, owner's rulings) ─────────────────────
// Only the room's owner restores, by hand. The restore is a save point HERE, in this format, that
// declares an ORIGIN — `prev` null and `thin` true, the same committed pair a decentralized
// restore declares (`_isOriginFloor` in `backend1/streammanager.js`), which the runner can never
// produce because `seal` below hard-codes `thin: false`. It is recognised by that pair AND by who
// carried it: the door reads the carrier's Matrix sender and passes `owner` only for a level above
// the ladder, which the bot (exactly the top rung) never has.
//
// ── WHICH SAVE POINT STANDS: THE RESTART, THEN THE COUNT, THEN THE LOG (owner's ruling, `ddjp_571`) ──
// Every save point carries a restart number (`era`, `CheckpointFormat.eraOf`). A restore starts a
// new one — one higher than the floor it replaces, `n` back to 1 — and is that era's ROOT; every
// other save point carries the era and root of the floor it builds on, `n` counting forward. Save
// points compare by era, then root (at one era the restore later in the log wins), then `n`, then
// their carrying events' position (`l`, then id). THE FLOOR IS THE GREATEST SAVE POINT HELD — a
// maximum, so the order things arrived in never matters. That one rule is what keeps the restore:
// a seal the bot made on the old floor is from an earlier era whatever its `n` or position; the
// same restore delivered again, or an older one, is never greater than what stands on it. It
// replaced `ddjp_570`'s chain walk, the chain-after-origin rule and the origin tie at one `l`.
// Rooms never restored are era 0 throughout, and for them the order is the count and the log, as
// it always was. And a save point this client already holds changes nothing (`ddjp_570`).

const B2Checkpoint = (() => {
  const TYPE = "ddjp.checkpoint";

  let _floor = null;        // the adopted checkpoint
  let _floorAt = null;      // the floor's own SERVER stamp — what the runner's time trigger measures from (J61)
  let _held = [];           // everything seen, for the lobby's saves list
  let _pos = 0;             // monotonic counter standing for log order
  let _refused = [];        // what did not adopt, and why — the part a reader cannot recompute
  let _floorId = null;      // the adopted checkpoint's event id (J79: the door adopts an origin by it)
  let _floorOwner = false;  // was the floor carried by the room's owner? (J79: an owner restore is one)
  let _floorLog = null;     // the adopted floor's CARRYING event: { l, id, pos } — where it sits in the log (`ddjp_570`)

  // BOUNDED, BOTH OF THEM. backend1 bounds everything it accumulates — the log trims to the floor
  // and the event cache is bounded by it — and these two were the only arrays in this engine that
  // grew forever. `_held` is the sharper of the pair: every entry carries a FULL STATE SEED, so a
  // long-lived room would accumulate a copy of its own history, one blob per seal, in every client.
  // The lobby's saves list shows recent saves for one room, so a window is what it actually needs.
  const MAX_HELD = 24;
  const MAX_REFUSED = 50;

  function reset() {
    _floor = null; _floorAt = null; _held = []; _pos = 0; _refused = [];
    _floorId = null; _floorOwner = false; _floorLog = null;
  }
  // Is the save point at `a` later in the log than the one at `b`? By the carrying events' positions
  // (`CheckpointFormat.laterInLog`). A caller that hands no position — a harness feeding `observe`
  // directly — falls back to the order of observation, which is all it has.
  function _laterInLog(a, b) {
    if (!b) return true;
    if (typeof a.l === "number" && typeof b.l === "number") return CheckpointFormat.laterInLog(a, b);
    return a.pos > b.pos;
  }
  // The committed origin pair (J79) — what a restore declares and no seal can.
  function isOrigin(cp) { return !!cp && (cp.prev === null || cp.prev === undefined) && cp.thin === true; }
  // A save point's restart: its era, and where that era's restore sits (`{ l, id }` — for a restore,
  // its own carrying event; for anything after it, the `root` it commits).
  function _restartOf(cp, place) { return CheckpointFormat.restartOf(cp, place); }
  // THE ORDER (owner's ruling, `ddjp_571`): > 0 when save point `a` stands over `b`. Each is
  // `{ cp, place }`. Restart first, then the count, then the log.
  function _compare(a, b) {
    const c = CheckpointFormat.compareRestart(_restartOf(a.cp, a.place), _restartOf(b.cp, b.place));
    if (c !== 0) return { c: c, by: "restart" };
    if (a.cp.n !== b.cp.n) return { c: a.cp.n > b.cp.n ? 1 : -1, by: "n" };
    if (a.place.l === b.place.l && a.place.id === b.place.id && a.place.pos === b.place.pos) return { c: 0, by: "same" };
    return { c: _laterInLog(a.place, b.place) ? 1 : -1, by: "position" };
  }

  function _refuse(rec) {
    _refused.push(rec);
    while (_refused.length > MAX_REFUSED) _refused.shift();
  }

  function verify(cp) {
    try { return CheckpointFormat.verify(cp); } catch (e) { return false; }
  }

  // Called for every `ddjp.checkpoint` that folds. Returns what happened, so the caller — and the
  // guard — can see a refusal rather than infer it from a floor that quietly did not move.
  function observe(cp, meta) {
    const pos = _pos++;
    const at = (meta && typeof meta.at === "number") ? meta.at : null;
    const id = (meta && meta.id) || null;

    if (!cp || typeof cp.n !== "number") {
      _refuse({ id, why: "not a checkpoint" });
      return { adopted: false, why: "not a checkpoint" };
    }
    // TRUSTING THE WRITER IS NOT TRUSTING THE BYTES.
    if (!verify(cp)) {
      _refuse({ id, n: cp.n, why: "fingerprint does not verify" });
      return { adopted: false, why: "fingerprint does not verify" };
    }

    // ── A SAVE POINT ALREADY HELD CHANGES NOTHING (`ddjp_570`, the supervisor's finding) ──────────
    // Delivered again — a live event that replay's scrollback then folds a second time, or a send
    // admitted early and echoed late — it is the same save point at the same place. Known by its
    // event id or its fingerprint. Not recorded as a refusal: nothing was decided.
    if (_held.some((h) => (id !== null && h.id === id) || (h.cp && h.cp.h === cp.h))) {
      return { adopted: false, why: "already held", duplicate: true };
    }

    const owner = !!(meta && meta.owner === true);
    const place = { l: (meta && typeof meta.l === "number") ? meta.l : null, id: id, pos: pos };
    const entry = { id, n: cp.n, at, cp, owner: owner, accepted: false, l: place.l, place: place };
    _held.push(entry);
    while (_held.length > MAX_HELD) _held.shift();

    // ── AN ORIGIN: THE OWNER'S RESTORE, OR NOTHING (J79) ───────────────────────────────────────
    if (isOrigin(cp) && !owner) {
      _refuse({ id, n: cp.n, era: CheckpointFormat.eraOf(cp), why: "an origin not carried by the room's owner" });
      return { adopted: false, why: "only the room's owner restores" };
    }
    // A save point built after a restore names that restore (`root`); one that does not is not a
    // statement this format can place, and is refused rather than read as era 0.
    if (CheckpointFormat.eraOf(cp) > 0 && !isOrigin(cp) && !CheckpointFormat.rootOf(cp)) {
      _refuse({ id, n: cp.n, era: CheckpointFormat.eraOf(cp), why: "a restart with no root" });
      return { adopted: false, why: "a save point of a restart must name its restore" };
    }

    if (_floor) {
      const cmp = _compare({ cp: cp, place: place }, { cp: _floor, place: _floorLog });
      if (cmp.c <= 0) {
        const e = CheckpointFormat.eraOf(cp), fe = CheckpointFormat.eraOf(_floor);
        // FROM BEFORE THE ROOM'S RESTORE: a seal the bot made on the old floor, however many and whatever
        // their `n`; an older restore. Said — the owner's live check looks for it (J79's Done-when).
        if (cmp.by === "restart" && e < fe) {
          _refuse({ id, n: cp.n, era: e, why: isOrigin(cp) ? "an older restore than the room's" : "does not build on the room's restore" });
          return { adopted: false, era: e, why: "from before the room's restore (restart " + e + ", the room is at " + fe + ")" };
        }
        if (cmp.by === "restart") {
          _refuse({ id, n: cp.n, era: e, why: "built on an earlier restore of this restart" });
          return { adopted: false, era: e, why: "built on an earlier restore of restart " + e + " than the one that stands" };
        }
        if (cmp.by === "n") {
          _refuse({ id, n: cp.n, era: e, why: "older than the adopted floor" });
          return { adopted: false, era: e, why: "the floor only moves forward" };
        }
        _refuse({ id, n: cp.n, era: e, why: "same position, earlier in the log" });
        return { adopted: false, era: e, why: "later in the log wins a tie" };
      }
    }
    const chained = !_floor || !cp.prev || cp.prev === _floor.h;
    // A LATER RESTART REPLACES THE ROOM (`ddjp_571`): whatever this client held of an earlier one —
    // the old room's save points, a seal the bot made on the old floor that arrived first — no longer
    // counts as having stood. Opening, moving on and saving a file read `accepted`.
    if (_floor) {
      const nr = _restartOf(cp, place);
      for (const h of _held) {
        if (h !== entry && h.accepted && CheckpointFormat.compareRestart(_restartOf(h.cp, h.place), nr) < 0) h.accepted = false;
      }
    }
    _floor = cp;
    _floorAt = at;
    _floorId = id;
    _floorLog = place;
    _floorOwner = owner;
    entry.accepted = true;
    return { adopted: true, n: cp.n, era: CheckpointFormat.eraOf(cp), origin: isOrigin(cp), chained: chained };
  }

  function floor() { return _floor; }
  // WHEN the adopted floor was written, by the SERVER's clock: `meta.at` is the stamp the door
  // shaped the event with, which for a checkpoint is its `origin_server_ts` (a checkpoint carries no
  // `at` of its own). `null` when nothing is adopted, which the runner reads as overdue.
  function floorAt() { return _floorAt; }
  function floorCut() { try { return CheckpointFormat.cutOf(_floor); } catch (e) { return null; } }
  // Position and thinness travel with each entry, because the saves list orders and labels by them
  // and the export builds its chain by position (J64).
  function held() {
    return _held.map((h) => ({ id: h.id, n: h.n, at: h.at, l: (typeof h.l === "number") ? h.l : null,
      floorL: (h.cp && typeof h.cp.floorL === "number") ? h.cp.floorL : null,
      thin: !!(h.cp && h.cp.thin === true),
      // J79: did this one stand (on the chain), and is it the owner's restore?
      accepted: h.accepted === true, ownerOrigin: h.owner === true && isOrigin(h.cp),
      // `ddjp_571`: its restart — the era, and where that era's restore sits
      era: CheckpointFormat.eraOf(h.cp), root: _restartOf(h.cp, h.place).root }));
  }
  function floorId() { return _floorId; }
  // Is the floor the owner's restore itself? And does the room stand in a restart at all? (J79; by era
  // since `ddjp_571`.)
  function floorIsOwnerOrigin() { return !!_floor && isOrigin(_floor) && _floorOwner && CheckpointFormat.eraOf(_floor) > 0; }
  function originSeen() { return !!_floor && CheckpointFormat.eraOf(_floor) > 0; }
  // The floor's restart, `{ era, root }` — what the fold compares before it moves (`ddjp_571`).
  function floorRestart() { return _floor ? _restartOf(_floor, _floorLog) : { era: 0, root: null }; }
  function restartOf(id) {
    for (const h of _held) if (h.id === id) return _restartOf(h.cp, h.place);
    return null;
  }
  function refused() { return _refused.slice(); }

  function byId(id) {
    for (const h of _held) if (h.id === id) return h.cp;
    return null;
  }

  // ── SEALING IS THE RUNNER'S ───────────────────────────────────────────────────────────────
  // Not a permission question about a user, so it does not go through `Capabilities` — it is one of
  // the runner's own powers, the split `authority.js` describes. `isRunner` is handed in rather
  // than worked out here, for the same reason ranks are: this file decides nothing about identity.
  function seal(state, opts) {
    const o = opts || {};
    if (!o.isRunner) return { ok: false, reason: "only the runner seals in this room type" };
    if (!state || typeof state !== "object") return { ok: false, reason: "nothing to seal" };

    const n = _floor ? _floor.n + 1 : 1;
    const prev = _floor ? _floor.h : null;
    const floorL = (typeof o.floorL === "number") ? o.floorL : null;
    const covers = (typeof o.covers === "string") ? o.covers : null;
    // THE RESTART OF THE FLOOR IT BUILDS ON (`ddjp_571`): its era, and its root — the floor's own
    // position when the floor is the restore, the root it carries otherwise.
    const rs = floorRestart();
    if (rs.era > 0 && !rs.root) return { ok: false, reason: "the restore this would build on has no position" };
    const h = CheckpointFormat.fingerprint(n, prev, state, floorL, false, covers, rs.era, rs.root);
    const cp = { t: TYPE, n: n, prev: prev, seed: state, floorL: floorL, thin: false, covers: covers, h: h };
    if (rs.era > 0) { cp.era = rs.era; cp.root = { l: rs.root.l, id: rs.root.id }; }
    return { ok: true, cp: cp };
  }

  // ── THE OWNER'S RESTORE, BUILT IN THE BOT ROOM'S SAVE-POINT FORMAT (J79) ──────────────────────
  // The same fields and fingerprint `seal` writes, with the origin pair: `prev` null, `thin` true.
  // A NEW RESTART (owner's ruling, `ddjp_571`): `era` one higher than the floor it replaces, and `n`
  // back to 1 — the restart, not the count, is what makes it stand over everything before it. (It
  // was `n` = the floor's `n` + 1 at `ddjp_569`.) It carries no `root`: it is its era's root, and
  // its position is its carrying event's. The cut (`floorL`) and `covers` are the publisher's — where
  // this client stands — and nothing here decides who may publish: that is the engine's question.
  function restore(seed, opts) {
    const o = opts || {};
    if (!seed || typeof seed !== "object") return { ok: false, reason: "no-seed" };
    if (typeof o.floorL !== "number" || !isFinite(o.floorL)) return { ok: false, reason: "no-cut" };
    const era = CheckpointFormat.eraOf(_floor) + 1, n = 1;
    const covers = (typeof o.covers === "string") ? o.covers : null;
    const h = CheckpointFormat.fingerprint(n, null, seed, o.floorL, true, covers, era, null);
    return { ok: true, cp: { t: TYPE, n: n, prev: null, seed: seed, floorL: o.floorL, thin: true, covers: covers, era: era, h: h } };
  }

  return { TYPE, reset, observe, verify, seal, restore, isOrigin, floor, floorAt, floorCut, floorId,
    floorIsOwnerOrigin, originSeen, floorRestart, restartOf, held, refused, byId };
})();
