// tests/check-duration-provider.js
// SUBJECT: ui/player.js
// WALL: the duration provider the UI installs on Playback returns null WHOLESALE when it cannot name
// a video, and never an object whose `videoId` is falsy.
//
// ── WHY THIS EXISTS: J49's SECOND PRECONDITION, AND NOTHING ELSE WATCHED IT ──────────────────
// `Playback._confirmReading` opens with `!expectedVideoId ||`. That clause is DOMINATED today: the
// only reading it could refuse is an object with a falsy id, and the shipped provider never makes
// one — every case it cannot name comes back as `null`, which is refused one line above the clause.
// The day a player adapter (J29) returns `{ videoId: null, … }` instead, the clause becomes the only
// thing between an unconfirmed reading and a `ddjp.play.len` that can never be withdrawn.
//
// J49 measured that NO guard would notice that day arriving: `check-length-freshness` installs its
// own provider at every site and never runs the shipped one, and the guards that read the player
// file never touch the install. So the redundancy could end silently. This guard is the net under
// that route. It does not pin the clause — J49 records why a row on the clause must wait for J29 —
// it pins the CONTRACT the clause's redundancy rests on, so the contract cannot change quietly.
//
// ── ONE EXTRACTOR, ONE SHAPE LIST ────────────────────────────────────────────────────────────
// The provider is extracted structurally out of `ui/player.js` and EXECUTED, by the same harness
// `tools/probes/probe-j49-confirm.js` uses (`tests/_probe-j49-confirm.js`), against the same list
// of player shapes. A second extractor here would be a second definition of where the provider is.
//
// ── WHEN THIS GOES RED ON PURPOSE ────────────────────────────────────────────────────────────
// A provider that legitimately returns an object with a falsy id is J29 arriving. Do not relax this
// guard to make it green: J49's Done-when applies — a row on the clause, built from the
// matching-absence pairing, lands first. Read J49 in `main/09-roadmap.md` before touching either.

const P = require("./_probe-j49-confirm.js");

let failed = 0, assertions = 0;
function ok(cond, msg, got) {
  assertions++;
  if (!cond) { failed++; console.log("  ✗ " + msg + (got === undefined ? "" : " — got " + JSON.stringify(got))); }
}

const ps = P.providerSource();
ok(ps.ok, "PREMISE — the provider must be extractable from " + P.UI_REL + " (" + (ps.stage || "") + ")");

if (ps.ok) {
  const shapes = P.PLAYER_SHAPES;
  ok(Array.isArray(shapes) && shapes.length > 0, "PREMISE — the harness must supply player shapes to drive");
  let driven = 0, falsy = [], named = 0, honest = null;
  for (const s of shapes || []) {
    const r = P.runProvider(ps.source, s.player, ("ready" in s) ? { ready: s.ready } : {});
    if (!r.ok) { ok(false, "PREMISE — shape `" + s.name + "` could not be driven (" + r.stage + ")"); continue; }
    driven++;
    const cls = P.classify(r.out);
    if (cls === "OBJECT-WITH-FALSY-ID") falsy.push(s.name);
    if (cls === "object-with-id") named++;
    if (s.name === "honest reading") honest = r.out;
    ok(cls === "null-wholesale" || cls === "object-with-id",
       "shape `" + s.name + "` must yield null or a named reading, never anything else", r.out);
  }
  // A filtered check must assert it filtered to something: every shape was actually run.
  ok(driven === (shapes || []).length, "PREMISE — every shape must be driven, not a subset", driven);
  // THE CONTRACT.
  ok(falsy.length === 0,
     "THE PROVIDER CONTRACT CHANGED: these shapes now yield an object with a FALSY id, which is the one " +
     "reading `_confirmReading`'s `!expectedVideoId ||` clause exists to refuse. That clause is no longer " +
     "dominated — read J49 before changing anything", falsy);
  // THE POSITIVE CONTROL. A provider returning null for everything satisfies the contract above for
  // free, so an honest player must still produce a named reading with its real length.
  ok(honest && honest.videoId === "ABC" && honest.seconds === 200,
     "CONTROL — an honest player must still produce a named reading with its length, or the contract " +
     "above is being met by a provider that reports nothing", honest);
  ok(named > 0, "CONTROL — at least one shape must yield a named reading", named);
}

if (failed > 0) {
  console.log("[duration-provider] FAIL — " + failed + " of " + assertions + " assertion(s) failed");
  process.exit(1);
}
console.log("[duration-provider] PASS — the duration provider installed by ui/player.js, extracted and " +
  "EXECUTED against every player shape the harness names, returns null wholesale whenever it cannot " +
  "name a video and never an object with a falsy id — the contract that keeps `_confirmReading`'s " +
  "`!expectedVideoId ||` redundant (J49). An honest player still yields its id and length, so the " +
  "contract is not met by a provider that reports nothing (" + assertions + " assertions)");
process.exit(0);
