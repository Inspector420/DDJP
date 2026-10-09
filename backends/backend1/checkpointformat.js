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
//   era / root       THE RESTART (J79, owner's ruling, `ddjp_571`). `era` decides which save point
//                    stands before anything else does, so uncommitted it would be the body field an
//                    attacker raises. Committed ONLY FROM ERA 1: era 0 is the ABSENT key, never
//                    `era: 0`, so every save point written before restarts existed hashes exactly
//                    as it always did — the rule `filePrint` keeps for its optional sections. A
//                    restore is its era's ROOT and carries no `root` (its own position is read from
//                    its carrying event, which it cannot know when it is built); everything built
//                    in an era after it commits `root`, that restore's position `{ l, id }`.
//
// AGREEMENT IS NEVER FINGERPRINT COMPARISON. `h` commits the author's own private bookkeeping, so
// two honest peers sealing the very same cut produce DIFFERENT fingerprints. Comparing them would
// reject honest peers as a fork. Verification is always recomputation — see Floor.chainVerifies.
//
// Depends on: ConsensusHash. Nothing else, and nothing depends on it but Floor and Checkpoint.

const CheckpointFormat = (() => {

  const TYPE = "ddjp.checkpoint";

  // ── THE RESTART NUMBER AND ITS ROOT (J79, `ddjp_571`) ────────────────────────────────────────
  // `eraOf`: 0 when absent (every save point from before restarts existed), a positive integer
  // otherwise. `rootOf`: where the era's restore sits in the log, `{ l, id }` — for a restore, its
  // own carrying event (`place`); for anything built after it, the committed `root`; null in era 0.
  function eraOf(cp) {
    const e = cp ? cp.era : undefined;
    return (Number.isSafeInteger(e) && e > 0) ? e : 0;
  }
  function _rootShape(r) {
    return (r && typeof r.l === "number" && isFinite(r.l) && typeof r.id === "string" && r.id) ? { l: r.l, id: r.id } : null;
  }
  function rootOf(cp, place) {
    if (eraOf(cp) === 0) return null;
    const origin = !!cp && (cp.prev === null || cp.prev === undefined) && cp.thin === true;
    return origin ? _rootShape(place) : _rootShape(cp.root);
  }
  // The hashed object. `era` and `root` are written only from era 1, so era 0 is byte-identical to
  // the object this function hashed before restarts existed.
  function _committed(n, prev, seed, floorL, thin, covers, era, root) {
    const o = {
      n: n, prev: prev || null, seed: seed,
      floorL: (typeof floorL === "number") ? floorL : null,
      thin: thin === true,
      covers: (typeof covers === "string") ? covers : null,
    };
    if (Number.isSafeInteger(era) && era > 0) {
      o.era = era;
      const r = _rootShape(root);
      if (r) o.root = r;
    }
    return o;
  }
  function fingerprint(n, prev, seed, floorL, thin, covers, era, root) {
    return ConsensusHash.contentHash(_committed(n, prev, seed, floorL, thin, covers, era, root));
  }

  // Is this checkpoint internally consistent — does its own h commit its own body? Says nothing
  // about whether the claim is TRUE; that is recomputation's job.
  function verify(cp) {
    if (!cp || !cp.seed || typeof cp.n !== "number" || typeof cp.h !== "string") return false;
    // A malformed restart is refused rather than read as era 0: `era: 0`, a fraction or a string
    // would otherwise be dropped from the hashed object and verify as an older save point.
    if (cp.era !== undefined && !(Number.isSafeInteger(cp.era) && cp.era > 0)) return false;
    if (cp.root !== undefined && (eraOf(cp) === 0 || !_rootShape(cp.root))) return false;
    return ConsensusHash.verify(_committed(cp.n, cp.prev, cp.seed, cp.floorL, cp.thin, cp.covers, cp.era, cp.root), cp.h);
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

  // ── WHERE A SAVE POINT SITS IN THE LOG: ITS CARRYING EVENT (J79, `ddjp_570`) ────────────────────
  // `a` and `b` are `{ l, id }`: the position of the event that CARRIED a save point — its `l`, then
  // its event id, the order every device folds in. Is `a` later in the log than `b`? Never the order
  // a client happened to observe them in. (`ddjp_570` sorted an owner origin after a seal at one
  // `l`; restarts decide that now, so the clause is gone — `ddjp_571`.)
  function laterInLog(a, b) {
    if (!a || typeof a.l !== "number") return false;
    if (!b || typeof b.l !== "number") return true;
    if (a.l !== b.l) return a.l > b.l;
    return String(a.id) > String(b.id);
  }

  // ── WHICH RESTART IS LATER: THE ERA, THEN ITS ROOT (J79, owner's ruling, `ddjp_571`) ───────────
  // `a` and `b` are `{ era, root }`. The higher era is later; at one era — two restores made at once
  // from the same floor — the restore LATER IN THE LOG wins, and with it everything built on it.
  // Returns > 0, 0 or < 0. Both room types ask it first, before anything else they compare.
  function compareRestart(a, b) {
    const ea = (a && Number.isSafeInteger(a.era) && a.era > 0) ? a.era : 0;
    const eb = (b && Number.isSafeInteger(b.era) && b.era > 0) ? b.era : 0;
    if (ea !== eb) return ea > eb ? 1 : -1;
    if (ea === 0) return 0;
    const ra = _rootShape(a && a.root), rb = _rootShape(b && b.root);
    if (!ra || !rb) return (ra ? 1 : 0) - (rb ? 1 : 0);
    if (ra.l === rb.l && ra.id === rb.id) return 0;
    return laterInLog(ra, rb) ? 1 : -1;
  }
  function restartOf(cp, place) { return { era: eraOf(cp), root: rootOf(cp, place) }; }

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

  return { TYPE, fingerprint, verify, cutOf, coversOf, laterInLog, eraOf, rootOf, restartOf, compareRestart,
    FILE_VERSION, FILE_MODES, filePrint, saveFile, readFile };
})();

if (typeof module !== "undefined" && module.exports) module.exports = { CheckpointFormat };
