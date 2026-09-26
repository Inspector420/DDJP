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

const B2Checkpoint = (() => {
  const TYPE = "ddjp.checkpoint";

  let _floor = null;        // the adopted checkpoint
  let _floorPos = -1;       // its position in the folded log, for tie-breaking
  let _floorAt = null;      // the floor's own SERVER stamp — what the runner's time trigger measures from (J61)
  let _held = [];           // everything seen, for the lobby's saves list
  let _pos = 0;             // monotonic counter standing for log order
  let _refused = [];        // what did not adopt, and why — the part a reader cannot recompute

  // BOUNDED, BOTH OF THEM. backend1 bounds everything it accumulates — the log trims to the floor
  // and the event cache is bounded by it — and these two were the only arrays in this engine that
  // grew forever. `_held` is the sharper of the pair: every entry carries a FULL STATE SEED, so a
  // long-lived room would accumulate a copy of its own history, one blob per seal, in every client.
  // The lobby's saves list shows recent saves for one room, so a window is what it actually needs.
  const MAX_HELD = 24;
  const MAX_REFUSED = 50;

  function reset() {
    _floor = null; _floorPos = -1; _floorAt = null; _held = []; _pos = 0; _refused = [];
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

    _held.push({ id, n: cp.n, at, cp });
    while (_held.length > MAX_HELD) _held.shift();

    if (_floor) {
      if (cp.n < _floor.n) {
        _refuse({ id, n: cp.n, why: "older than the adopted floor" });
        return { adopted: false, why: "the floor only moves forward" };
      }
      // SAME `n`, TWO WRITERS. Log order decides, so every client decides the same way.
      if (cp.n === _floor.n && pos <= _floorPos) {
        _refuse({ id, n: cp.n, why: "same position, earlier in the log" });
        return { adopted: false, why: "later in the log wins a tie" };
      }
    }

    const chained = !_floor || !cp.prev || cp.prev === _floor.h;
    _floor = cp;
    _floorPos = pos;
    _floorAt = at;
    return { adopted: true, n: cp.n, chained: chained };
  }

  function floor() { return _floor; }
  // WHEN the adopted floor was written, by the SERVER's clock: `meta.at` is the stamp the door
  // shaped the event with, which for a checkpoint is its `origin_server_ts` (a checkpoint carries no
  // `at` of its own). `null` when nothing is adopted, which the runner reads as overdue.
  function floorAt() { return _floorAt; }
  function floorCut() { try { return CheckpointFormat.cutOf(_floor); } catch (e) { return null; } }
  function held() { return _held.map((h) => ({ id: h.id, n: h.n, at: h.at })); }
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
    const h = CheckpointFormat.fingerprint(n, prev, state, floorL, false, covers);
    return { ok: true, cp: { t: TYPE, n: n, prev: prev, seed: state, floorL: floorL, thin: false, covers: covers, h: h } };
  }

  return { TYPE, reset, observe, verify, seal, floor, floorAt, floorCut, held, refused, byId };
})();
