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
// Depends on: ConsensusHash. Nothing else, and nothing depends on it but Floor and Checkpoint.

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

  // ── THE SAVE FILE (J25) ────────────────────────────────────────────────────────────────────
  // A save file is NOT a new artefact. `checkpoint-contents.md` §7 fixes the export format AS the
  // checkpoint format, so everything below is an ENVELOPE around checkpoints that already exist
  // and already verify. It lives here because this module is the one home for "what a checkpoint
  // is", and a second home for format knowledge is the drift P7 is about.
  //
  // THE ENVELOPE SITS OUTSIDE THE COMMITMENT, AND THAT IS THE DRIVEN PART. Adding a key to a
  // fingerprinted object retroactively unverifies every artefact written before it — measured as
  // ROW 1 of tools/probes/mutate-j25-settings-coupling.js, where one new settings key turns
  // Floor.chainVerifies from true to false against every checkpoint sealed earlier. So an envelope
  // that could ever gain a field must not be inside `fp`, or the version marker becomes the very
  // thing that breaks old files. `ddjp` and `mode` are therefore readable WITHOUT hashing anything,
  // which is also what lets an unknown version be refused with a stated reason instead of a hash
  // failure that looks like corruption.
  const FILE_VERSION = 1;
  const FILE_MODES = ["full", "bot"];

  // The payload commitment. Covers the snapshots and every optional section PRESENT, and nothing
  // else. An absent optional section is absent rather than null: `hist` omitted and `hist: null`
  // must not be two spellings of one file, or the section's own absence moves the fingerprint.
  function filePrint(payload) {
    return ConsensusHash.contentHash({
      snapshots: (payload && Array.isArray(payload.snapshots)) ? payload.snapshots : [],
      hist: (payload && Array.isArray(payload.hist)) ? payload.hist : null,
      rep: (payload && payload.rep) ? payload.rep : null,
      keyset: (payload && Array.isArray(payload.keyset)) ? payload.keyset : [],
      author: (payload && payload.author) ? payload.author : null,
    });
  }

  // opts: { mode, snapshots:[cp], hist?:[entry], keyset:[settings key names], author:{rank} }
  function saveFile(opts) {
    const o = opts || {};
    const payload = {
      snapshots: Array.isArray(o.snapshots) ? o.snapshots : [],
      keyset: Array.isArray(o.keyset) ? o.keyset.slice().sort() : [],
      author: o.author ? { rank: String(o.author.rank) } : null,
    };
    // Optional sections are OMITTED when absent, never nulled. `rep` is reserved for J19 and is
    // deliberately not written here: it sits OUTSIDE `seed` so that reputation landing later moves
    // only the fingerprint of files that actually carry it.
    if (Array.isArray(o.hist) && o.hist.length) payload.hist = o.hist;
    // `ddjp` and `mode` FIRST, in this order, so a reader can refuse a foreign file from its first
    // bytes without parsing anything it may not understand.
    return { ddjp: FILE_VERSION, mode: (o.mode === "bot") ? "bot" : "full", payload: payload, fp: filePrint(payload) };
  }

  // env: { keys:[current settings key names], ownerAuthored:bool, chainVerify:fn(snapshots)->bool }
  //
  // `chainVerify` is passed IN rather than imported, because Floor is a consumer of this module and
  // reversing that arrow is the exact mistake this file's header records. `ownerAuthored` is the
  // CALLER's belief about provenance, never the file's claim about itself: rank comes from the
  // channel an event arrived on (P6) and a file has no channel, so a body field saying "owner"
  // proves nothing and must not buy the owner's single-snapshot path.
  //
  // THE ORDER OF THE CHECKS IS LOAD-BEARING, not tidiness. An older-keyset file ALSO fails the
  // chain, because the recomputed blob gains the new key from the defaults (ROW 1 again) — so if
  // the chain check ran first, every file predating a settings key would be reported as corrupt.
  // "This file predates key K" and "this file is corrupt" need opposite responses, which is the
  // distinction J25's entry gives as the version marker's justification; the marker alone cannot
  // make it, because §1.3 is explicit that a new setting needs no new seed field and so moves no
  // version. The keyset is what closes that, and it has to be asked BEFORE the chain.
  function readFile(file, env) {
    const e = env || {};
    const no = (reason, extra) => Object.assign({ ok: false, reason: reason, detail: null }, extra || {});
    // The missing-key subject, agreeing in number. ONE key is by far the commonest case — a release
    // adds one — and the plural-only sentence read as a defect in the FILE rather than in the
    // build. Built once so the two messages below cannot drift into saying it differently.
    const _keyPhrase = (missing) => {
      const n = (missing || []).length;
      return n === 1 ? "one settings key this file does not carry: " + missing[0]
                     : n + " settings keys this file does not carry: " + missing.join(", ");
    };

    if (!file || typeof file !== "object") return no("not-an-object");
    if (!Number.isSafeInteger(file.ddjp) || file.ddjp !== FILE_VERSION) {
      return no("unknown-version", { detail: "file format version " + String(file.ddjp) +
        ", this build reads version " + FILE_VERSION + " only" });
    }
    if (FILE_MODES.indexOf(file.mode) < 0) {
      return no("unknown-mode", { detail: "mode " + JSON.stringify(file.mode) });
    }
    const p = file.payload;
    if (!p || typeof p !== "object") return no("malformed-payload");
    if (!Array.isArray(p.snapshots) || p.snapshots.length === 0) return no("no-snapshots");
    if (filePrint(p) !== file.fp) return no("fingerprint-mismatch");
    for (const cp of p.snapshots) {
      if (!verify(cp)) return no("snapshot-self-inconsistent");
    }

    // The keyset diagnosis, ahead of the chain for the reason above.
    if (!Array.isArray(p.keyset)) return no("malformed-keyset");
    const have = Array.isArray(e.keys) ? e.keys : [];
    const extra = p.keyset.filter((k) => have.indexOf(k) < 0);
    const missing = have.filter((k) => p.keyset.indexOf(k) < 0);
    if (extra.length) {
      // Keys this build does not have: a file from a newer tree. Refused outright rather than read
      // best-effort — this build supports rooms it creates and no others.
      return no("keyset-newer", { extraKeys: extra,
        detail: "the file names settings keys this build does not define: " + extra.join(", ") });
    }

    // The author declaration is compared, never trusted. A disagreement in EITHER direction is
    // stated rather than resolved, because resolving it silently means picking whose claim wins.
    const declaredOwner = !!(p.author && p.author.rank === "owner");
    const callerOwner = e.ownerAuthored === true;
    if (declaredOwner !== callerOwner) {
      return no("author-not-corroborated", {
        detail: "the file declares " + (declaredOwner ? "owner" : "peer") + " authorship and the " +
          "caller believes " + (callerOwner ? "owner" : "peer") + "; a file has no channel origin, " +
          "so this cannot be settled from the file",
      });
    }

    const out = {
      ok: true, reason: null, detail: null, warning: null,
      version: file.ddjp, mode: file.mode,
      snapshots: p.snapshots, hist: Array.isArray(p.hist) ? p.hist : null,
      keyset: p.keyset, author: p.author || null,
    };

    if (missing.length) {
      // The file predates a settings key. For an OWNER-authored file this is survivable and the
      // reading is honest: the seeded reader is Object.assign(defaultSettings(), seed.settings), so
      // the missing key is filled from the default and that room really was running under it
      // (checkpoint-contents.md §1.3). For a PEER file it is fatal, because the chain below cannot
      // reproduce a fingerprint sealed without the key. Same file, two provenances, two answers.
      // ── THE SENTENCE AGREES IN NUMBER (v284) ─────────────────────────────────────────────
      // Both messages read *"written before this build defined: botDelegation; those values will
      // be filled"* — written for the plural and wrong for the one case that is commonest, a
      // single new key. `_keyPhrase` builds the subject once so the two sites cannot drift into
      // saying it differently, which is the same reason the codes they carry are shared.
      const phrase = _keyPhrase(missing);
      if (!callerOwner) {
        return no("keyset-older", { missingKeys: missing,
          detail: "written before this build defined " + phrase +
            " — a peer-authored file cannot chain across a settings key addition; re-export from " +
            "a room running this build, or supply an owner-authored file" });
      }
      out.warning = "keyset-older";
      out.missingKeys = missing;
      out.detail = "written before this build defined " + phrase +
        (missing.length === 1 ? ", and that value will be filled from the current default"
                              : ", and those values will be filled from the current defaults");
    }

    if (callerOwner) return out;   // adopted on authority, no recompute — Floor.select's asymmetry

    if (p.snapshots.length < 2) {
      return no("chain-too-short", { detail: "a peer-authored file needs a chain the importer can " +
        "fold; Floor.chainVerifies refuses below two snapshots" });
    }
    if (typeof e.chainVerify !== "function") return no("no-chain-verifier");
    if (!e.chainVerify(p.snapshots)) return no("chain-refused");
    return out;
  }

  return { TYPE, fingerprint, verify, cutOf, coversOf,
    FILE_VERSION, FILE_MODES, filePrint, saveFile, readFile };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { CheckpointFormat };
