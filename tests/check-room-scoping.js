// tests/check-room-scoping.js
//
// THE HELD SET MUST BE SCOPED TO THIS ROOM — AND SCOPED CORRECTLY.
//
// `EventCache` is keyed by event id and spans EVERY room and session the client has ever seen. It
// is the durable store and is deliberately never reset per room. So every consumer must scope it,
// and the scope has two failure modes that are easy to get wrong in opposite directions:
//
//   TOO BROAD  — no filter at all. A previous room's history leaks into this room's vouch bundles:
//                real observed symptom was a play/skip carrying records from an unrelated room,
//                including that room's settings (a background-image URL) and lamport positions an
//                order of magnitude beyond anything in the current room. That is cross-room data
//                leakage on the wire, and it wastes the bundle budget on events nobody here needs.
//
//   TOO NARROW — filtering on a single Matrix room id. A DDJP room is a SPACE whose events arrive
//                across SEVERAL rooms, one channel per rank, so a single-id filter silently drops
//                everything said on the other rank channels of this very room.
//
// The correct scope is "any held event whose room id is one of THIS space's channels", and it must
// live in exactly ONE place so the vouching loop, the repair pass and the checkpoint gate can never
// disagree about what "this room's history" is. This guard pins that.
//
// MatrixBridge can't be loaded headlessly, so this is a static guard over the source.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

let checks = 0;
function ok(c, m) { assert.ok(c, m); checks++; }

// Strip only WHOLE-LINE comments: a naive `//` strip also eats everything after a URL inside a
// string, silently deleting real code from the scan.
function code(rel) {
  const src = fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
  return src.split("\n").filter((ln) => !/^\s*\/\//.test(ln)).join("\n");
}
const mb = code("backends/backend1/matrixbridge.js");
// The seal path's scoping moved with the engine: Checkpoint takes its held set through an
// injected getter now, so the scope is chosen once by transport rather than re-derived per module.
const bm = code("backends/backend1/checkpoint.js");

// ── (a) exactly ONE scoping helper, and it scopes by the space's CHANNEL SET ──
ok(/function _heldHere\(\)/.test(mb), "a single room-scoping helper exists");
const helper = mb.slice(mb.indexOf("function _heldHere()"), mb.indexOf("function _heldHere()") + 700);
// The scope used to be borrowed from `_recoveryChannels` — checkpoint-recovery state, set late by
// wireCheckpoints. It now has a dedicated owner (`_activeScope`), bound at room entry before
// replay, because the READER was only ever half the problem: foreign events were reaching the
// derived log before anyone read anything (check-room-ingest-gate). One scope, bound once, shared
// by the door and every reader — and separable from checkpoint concerns so it can move into
// `Backends.bind()` when per-room backends land.
ok(/_activeScope/.test(helper),
  "the scope is built from this space's CHANNEL MAP via the dedicated room scope (not a single " +
  "room id — that would drop other rank channels; and not borrowed from checkpoint state, which " +
  "is set too late to gate ingest)");
ok(/EventCache\.values\(\)/.test(helper), "it reads the durable cache");
ok(/filter\(/.test(helper), "it filters rather than returning everything");

// ── (b) no consumer reads the cache raw. The ONLY raw read may be inside the helper itself. ──
const rawReads = (mb.match(/EventCache\.values\(\)/g) || []).length;
ok(rawReads === 1, "matrixbridge reads the durable cache in exactly one place (the helper); found " + rawReads);

// the outgoing vouch bundle in particular — this is where the leak was observed
const sendArea = mb.slice(mb.indexOf("Vouch.carries(type)"), mb.indexOf("Vouch.carries(type)") + 900);
ok(/_heldHere\(\)/.test(sendArea) && !/EventCache\.values\(\)/.test(sendArea),
  "the outgoing vouch bundle is built from the SCOPED held set (the observed cross-room leak)");
ok(/Vouch\.owed\(/.test(sendArea) && /Vouch\.bundleFor\(/.test(sendArea),
  "the piggyback path uses the SHARED selection (owed -> bundleFor), not a picker of its own");

// ── (c) single-room-id filtering must not creep back (the too-narrow failure) ──
ok(!/room_id === roomId/.test(mb),
  "no consumer filters on a single room id (a DDJP room spans several channel rooms)");

// ── (d) the seal path shares the SAME scope rather than re-deriving one ──
// It used to reach out for MatrixBridge.heldHere; now the scope is INJECTED, which is stronger.
// A module that fetches its own scope has an opinion about what "here" means and can drift from the
// helper; a module that is handed one cannot. So the assertion is that Checkpoint takes its held
// set through the seam and never reaches for the cache itself.
ok(/held:\s*\(\)\s*=>/.test(bm) || /_env\.held\(\)/.test(bm),
  "the seal path takes its held set through an injected getter rather than fetching its own");
ok(!/EventCache\.values\(\)/.test(bm),
  "and never reads the durable cache directly — one scoping helper, one opinion about 'here'");
ok(/held:\s*\(\)\s*=>\s*_heldHere\(\)/.test(mb),
  "and transport hands it THE helper, so the seal and the bundle cannot disagree about scope");
ok(!/Recovery\.detectGaps\(EventCache\.values\(\)\)/.test(bm),
  "blockmanager no longer hole-checks against every room it has ever seen");
ok(!/canCheckpoint\(EventCache\.values\(\)/.test(bm),
  "the checkpoint gate no longer judges coverage against another room's events");

console.log("[room-scoping] PASS — the durable event cache is read through exactly ONE scoping helper, which scopes by this space's channel set (so other rank channels of the same room are kept, and other rooms are excluded); the outgoing vouch bundle uses it — closing the observed cross-room leak — and the checkpoint engine reuses the same scope instead of deriving its own (" + checks + " assertions)");
process.exit(0);
