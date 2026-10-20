// tests/check-local-evidence.js
// SUBJECT: backends/backend1/, core/, features/, ui/
//
// A CLIENT NEVER ACTS ON A TRUTH THE ROOM CANNOT HOLD.
//
// THE CONCEPT, and it is the system's rather than this file's: the server holds the timeline and
// clients never stray from it. Being behind is ordinary — clients sync at different moments and
// forget different amounts. **Computing from something the room cannot compute from is a fork**, and
// a fork supplied late is still a fork. So a client may not keep, or act on, evidence others cannot
// have. That is why a deleted event is refilled from a PUBLISHED vouch record plus the homeserver's
// tombstone: both halves are shared by construction, so a repair moves the whole room to one truth
// rather than moving one client somewhere private.
//
// THE OPERATIONAL FORM, which is what can actually be checked:
//
//     LOCAL EVIDENCE MAY MAKE A CLIENT MORE CAUTIOUS. IT MAY NEVER MAKE ONE MORE PERMISSIVE.
//
// `Continuity` is the worked example and reads correctly in both directions: uncorroborated local
// evidence of a gap yields `suspect` and PERMITS anyway, because one fabricated parent must not
// freeze a room; only corroborated — shared — evidence yields `short` and stops. Evidence nobody
// else has is not grounds to act, in either direction.
//
// WHY THIS IS AN ACCOUNTING GUARD RATHER THAN A DEFECT DETECTOR. J43 was one place where local
// evidence made a client more permissive: a floor refused by the derived log came back from the raw
// cache. Fixing that site fixes that site. What stops the NEXT one is the rule being enforced over
// the whole population — so every module is either unable to read local-only evidence at all, or
// declared here with the reason it is safe. A module that starts reading the cache fails this guard
// until someone says which it is. Same shape as `check-spine` PART A for layer placement and
// `check-room-scope` for room isolation.
//
// WHAT COUNTS AS LOCAL-ONLY. Two sources, and they are different in kind:
//   · `EventCache` — raw, per-client, and a SUPERSET of the derived log: it holds what the fold
//     refused and what the trim dropped. Reading it is how a client sees something the room's
//     derivation does not.
//   · `Store` / `localStorage` — per-device. Nobody else has it, ever.
//
// WHAT IS NOT LOCAL-ONLY, and why the line is drawn there: a vouch record is PUBLISHED on the wire
// (`sendEvent(roomId, Vouch.BUNDLE_TYPE, …)`), and a tombstone comes from the homeserver on the
// redaction path. Holding either is holding something the room holds.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const strip = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
const LOCAL = /\bEventCache\s*\.|\blocalStorage\b|\bStore\s*\./;

let checks = 0;
function ok(cond, why, detail) {
  checks++;
  assert.ok(cond, "[local-evidence] FAIL — " + why + (detail ? "\n      " + detail : ""));
}

// ── THE POPULATION, DERIVED ──────────────────────────────────────────────────────────────────
// Read off disk so a new module is in scope the moment it exists.
const dirs = ["backends/backend1", "core", "features", "ui"];
const FILES = [];
for (const d of dirs) {
  for (const f of fs.readdirSync(path.join(ROOT, d))) {
    if (f.endsWith(".js")) FILES.push(d + "/" + f);
  }
}
FILES.push("app.js");

// ── WHO MAY READ LOCAL-ONLY EVIDENCE, AND WHY IT IS SAFE ─────────────────────────────────────
// The reason is the part a reader cannot recompute, so it is the part recorded.
const ALLOWED = {
  "backends/backend1/eventcache.js":
    "it IS the cache — the module that owns the local store cannot be forbidden from touching it",
  "backends/backend1/matrixbridge.js":
    "the transport. It reads the cache to SUPPLY CANDIDATES, never to accept: `_verifiedOriginalFor` " +
    "and the `pHash` commitment both check what they find against a SHARED commitment, and " +
    "`_localPager` now reports whether it actually fetched so `Floor.thinJoin` can refuse to take " +
    "back a floor on evidence already held (J43)",
  "backends/backend1/matrixaccount.js":
    "app plumbing (J59). Everything it reads is per-DEVICE or per-ACCOUNT by construction and none " +
    "of it reaches the fold: the session blob and its at-rest key, the account registry, the avatar " +
    "cache, the pending recovery key, and the DM scope — which is asserted separately (check-dm-gaps) " +
    "to reach the raw listeners and NOTHING else, so a DM is never a candidate original, an eviction " +
    "subject or a fold input. It cannot make this client more permissive than the room because it " +
    "touches no module that decides what the room is: check-spine PART A2 drives that, and it is the " +
    "property this row rests on rather than a promise made here",
  "core/storageio.js": "the storage layer itself",
  "core/chatprefs.js": "per-device chat preferences, which are display-only and never folded",
  "app.js": "boot wiring — reads storage to stand modules up, decides nothing about room truth",
  // features/ and ui/ hold per-device preferences and display state. None of it is folded, and the
  // reducer is asserted below to be unable to reach any of it.
  "features/mediablocked.js": "per-device stagger offset; the DECLARATION it produces is published",
  "features/medialength.js":
    "a locally measured length is a HINT that becomes a PUBLISHED claim, never truth on its own — " +
    "`localMeasuredDuration` drives only this device's playhead, because a peer value cannot move my queue",
  "features/metadata.js": "per-device metadata cache, display only",
  "features/playback.js": "this device's playhead",
  "features/playlists.js": "per-device playlists — the user's own library, never room truth",
  "features/room.js": "per-device room list and preferences",
  "features/userqueue.js": "this device's queue draft before it is published",
  // `ui/interface.js` LOST this permission at ddjp_389 and the row is gone rather than kept
  // "just in case". Every local-only read it had — the thumbnail blob cache, the preview
  // player's volume mirror, the log filter selections — left with the clusters that owned them.
  // The residue reads none, and this guard's both-directions half is what noticed: a permission
  // nobody re-checks is how the list stops meaning anything. Third time that half has fired
  // during this split, after ui/base.js and ui/queue.js.
  // The ui/ split (roles.md §5). Each extracted file needs its OWN reason rather than
  // inheriting interface.js's: this guard accounts for every module in the population, so a
  // new file arriving unaccounted-for is it working rather than a new break.
  // `ui/base.js` is deliberately NOT here. It declares `refs` and the shared state objects
  // and reads no evidence of any kind, so a row for it was REFUSED by this guard's own
  // both-directions check — a permission nobody re-checks is how the list stops meaning
  // anything, and that half fired on the first run of this split.
  "ui/player.js": "display state and per-device preferences (volume, background, dim)",
  "ui/playlists.js": "thumbnail blob cache and the preview player's local volume mirror",
  // `ui/settings.js` is NOT here either, and I tried again. The lock state is read through the
  // host seam rather than from storage, so the panel file reads no local-only evidence. FIFTH
  // refusal from this half during the split.
  // `ui/chat.js` is deliberately NOT here, and I tried to add it. The chat tier selection and the
  // DM read positions go through ChatPrefs and the feature seam rather than being read locally in
  // the panel, so the row was REFUSED by this guard's both-directions half — the FOURTH time that
  // half has corrected this split, after ui/base.js, ui/queue.js and ui/interface.js. Guessing a
  // module's permissions from its subject matter is exactly what it is there to stop.
  "ui/panels.js": "the local session log and this device's log filter selections",
  // `ui/queue.js` is deliberately NOT here. The queue tab selection is declared in
  // ui/interface.js and read through a `UIBase.host` READER, so the panel file itself reads no
  // local-only evidence — and a row for it was REFUSED by this guard's both-directions check,
  // the same half that fired for ui/base.js at ddjp_386. A permission nobody re-checks is how
  // the list stops meaning anything.
};

// ── THE FOLD MAY NOT REACH IT AT ALL ─────────────────────────────────────────────────────────
// CHECKED FIRST, AND THE ORDER IS THE POINT. These modules decide what the room IS; no entry in
// ALLOWED would be good enough for them, so their violation is a different and worse thing than an
// unaccounted module. Run after the accounting, a reducer reading the cache reports as "not
// accounted for" — true, and the weakest true thing that could be said about it, inviting someone to
// silence it by adding a row. Same ordering lesson `check-room-compat` records: a broken baseline
// and a broken room need opposite responses, so the sharper check goes first.
const NEVER = [
  "backends/backend1/statederiver.js",   // what the room is
  "backends/backend1/streammanager.js",  // the fold and the one door
  "backends/backend1/checkpoint.js",     // what gets banked
  "backends/backend1/floor.js",          // where we compute from
  "backends/backend1/continuity.js",     // may I advance
  "backends/backend1/vouch.js",          // what is protected
  "backends/backend1/capabilities.js",   // who may do what
  "backends/backend1/consensushash.js",  // canonical bytes
];
for (const f of NEVER) {
  ok(!LOCAL.test(strip(fs.readFileSync(path.join(ROOT, f), "utf8"))),
    "`" + path.basename(f) + "` reads LOCAL-ONLY evidence. This module decides what the room IS, " +
    "or what may be done to it, and must derive from the shared log alone. There is no reason good " +
    "enough to add it to ALLOWED — a client whose ROOM depends on its private storage has left the " +
    "timeline, and every downstream answer will be room-shaped and wrong.",
    f);
}

// ── THE ACCOUNTING ───────────────────────────────────────────────────────────────────────────
const unaccounted = FILES.filter((f) => {
  if (ALLOWED[f]) return false;
  return LOCAL.test(strip(fs.readFileSync(path.join(ROOT, f), "utf8")));
});

ok(unaccounted.length === 0,
  "a module reads LOCAL-ONLY evidence and is not accounted for. A client that acts on something " +
  "the room cannot hold has forked, and the failure is silent because the result is room-shaped. " +
  "Either stop reading it, or add it to ALLOWED with the reason it cannot make this client more " +
  "permissive than the room.",
  JSON.stringify(unaccounted));

// ── AND THE LIST STAYS HONEST ────────────────────────────────────────────────────────────────
// A permission for a module that no longer reads anything is a permission nobody re-checked, and a
// list that only grows stops meaning anything.
const stale = Object.keys(ALLOWED).filter((f) => {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) return true;
  return !LOCAL.test(strip(fs.readFileSync(p, "utf8")));
});
ok(stale.length === 0,
  "ALLOWED grants a module permission it no longer needs — it has stopped reading local-only " +
  "evidence, or no longer exists. Remove the row: a permission nobody re-checks is how this list " +
  "stops meaning anything.",
  JSON.stringify(stale));

// ── AND CONTINUITY'S DIRECTION, DRIVEN RATHER THAN ASSERTED IN PROSE ─────────────────────────
// The rule's one worked example: local evidence of a gap must not be enough to STOP the room, or a
// single fabricated parent freezes it. Read from the module rather than described, so the claim
// this file makes about `Continuity` cannot drift from what `Continuity` does.
const cont = strip(fs.readFileSync(path.join(ROOT, "backends/backend1/continuity.js"), "utf8"));
ok(/state:\s*"suspect"/.test(cont) && /ok:\s*true[^}]*state:\s*"suspect"/.test(cont.replace(/\s+/g, " ")),
  "`Continuity` no longer PERMITS on uncorroborated local evidence. That direction is the rule's " +
  "worked example: evidence nobody else has is not grounds to act, and a client that stops on it " +
  "hands any peer the power to freeze the room with one fabricated parent.",
  "expected an `ok: true` outcome carrying state `suspect`");

console.log(
  "[local-evidence] PASS — a client never acts on a truth the room cannot hold. Local evidence may " +
  "make a client MORE CAUTIOUS and never MORE PERMISSIVE, and that is enforced over the whole " +
  "population rather than at the site where it was last broken: every module either cannot read " +
  "local-only evidence or is accounted for with the reason it is safe, the permission list is " +
  "asserted honest in both directions, and the modules that decide what the room IS are barred " +
  "outright — no reason would be good enough for those. `Continuity`'s direction is read from the " +
  "module rather than described here, so this file's claim about it cannot drift (" + checks +
  " assertions)");
