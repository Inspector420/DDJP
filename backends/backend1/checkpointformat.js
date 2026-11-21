// backends/backend1/checkpointformat.js
//
// THE CHECKPOINT FORMAT — what a checkpoint IS, in one place.
//
// This exists because of an arrow that pointed the wrong way. The fingerprint lived in Floor, and
// Checkpoint called Floor.fingerprint to build one — so Checkpoint depended on Floor for two
// unrelated reasons, and only one of them was legitimate. The format is not Floor's; Floor is a
// CONSUMER of it, exactly like Checkpoint. Both read from here and neither owns the other.
//
// EVERY FIELD IS COMMITTED, AND EACH FOR A STATED REASON:
//   n / prev / seed  the claim itself
//   floorL           steers eviction and NOTHING FOLDS IT, so it has none of the indirect
//                    protection `covers` has. Uncommitted it would be a body field an attacker
//                    could raise to make a client drop history it still needs.
//   thin             the author's own statement about HOW it computed. Grade is the receiver's
//                    judgment and cannot travel; how you computed is a fact about you and can.
//                    Uncommitted, a relay could strip it and turn a statement into a courtesy.
//   covers           because verify() recomputes NOTHING. Adoption catches a rewritten span
//                    downstream, but a public predicate that passes a tampered body is one
//                    somebody eventually relies on.
//
// AGREEMENT IS NEVER FINGERPRINT COMPARISON. `h` commits the author's own private bookkeeping, so
// two honest peers sealing the very same cut produce DIFFERENT fingerprints. Comparing them would
// reject honest peers as a fork. Verification is always recomputation — see Floor.chainVerifies.
//
// Depends on: ConsensusHash. Nothing else. Read by Floor and Checkpoint, and by backend2's
// checkpoint.js and streammanager.js.

const CheckpointFormat = (() => {

  const TYPE = "ddjp.checkpoint";

  function fingerprint(n, prev, seed, floorL, thin, covers) {
    return ConsensusHash.contentHash({
      n: n, prev: prev || null, seed: seed,
      floorL: (typeof floorL === "number") ? floorL : null,
      thin: thin === true,
      covers: (typeof covers === "string") ? covers : null,
    });
  }

  // Is this checkpoint internally consistent — does its own h commit its own body? Says nothing
  // about whether the claim is TRUE; that is recomputation's job.
  function verify(cp) {
    if (!cp || !cp.seed || typeof cp.n !== "number" || typeof cp.h !== "string") return false;
    return ConsensusHash.verify({
      n: cp.n, prev: cp.prev || null, seed: cp.seed,
      floorL: (typeof cp.floorL === "number") ? cp.floorL : null,
      thin: cp.thin === true,
      covers: (typeof cp.covers === "string") ? cp.covers : null,
    }, cp.h);
  }

  // The cut a checkpoint seals, as (position, id). Position is preferred because the boundary event
  // is AT the floor and therefore already retirable — a client that has forgotten below its floor
  // does not hold it, which is exactly when a floor must still be placeable.
  function cutOf(cp) {
    if (!cp) return null;
    const id = (typeof cp.covers === "string") ? cp.covers.split("..")[1] : null;
    if (typeof cp.floorL === "number") return { l: cp.floorL, id: id };
    return id ? { l: null, id: id } : null;
  }

  function coversOf(firstId, lastId) { return String(firstId) + ".." + String(lastId); }

  // ── WHERE A SAVE POINT SITS IN THE LOG: ITS CARRYING EVENT (`ddjp_570`) ─────────────────────────
  // `a` and `b` are `{ l, id }`: the position of the event that CARRIED a save point — its `l`, then
  // its event id, the order every device folds in. Is `a` later in the log than `b`? Never the order
  // a client happened to observe them in. A bot room's two save points at one `n` are ordered by it.
  function laterInLog(a, b) {
    if (!a || typeof a.l !== "number") return false;
    if (!b || typeof b.l !== "number") return true;
    if (a.l !== b.l) return a.l > b.l;
    return String(a.id) > String(b.id);
  }

  return { TYPE, fingerprint, verify, cutOf, coversOf, laterInLog };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { CheckpointFormat };
