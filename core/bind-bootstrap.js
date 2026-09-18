// core/bind-bootstrap.js — fill the four interface names, before anything reads them.
//
// ONE LINE, AND IT HAS TO RUN HERE. `core/backends.js` declares `StreamManager`, `MatrixBridge`,
// `MatrixAccount` and `Capabilities` as empty shells whose contents the binder swaps (J23). Until
// something binds, all four are `{}`.
//
// ── THE BUG THIS EXISTS BECAUSE OF, FOUND IN A BROWSER ────────────────────────────────────────
// The bind lived in `app.js`, which is the LAST script the page loads. Ten `ui/` and `features/`
// files load before it, and they do not merely define functions — several read the interface AT
// LOAD TIME. `ui/base.js` builds its rank colour table with a top-level
// `const RANKS = Room.rankLadder()`, and `rankLadder` reads `Capabilities.LADDER`. Against an empty
// shell that is `undefined.map(...)`, which threw, which meant `UIBase` was never defined, which
// took out every ui/ module after it and then `app.js` itself. **Blank screen, nine cascading
// ReferenceErrors, and the real cause three files above the first one that complained.**
//
// Before J23 this could not happen: `const Capabilities = (() => {…})()` was live the moment its own
// script ran, so load order and bind order were the same thing. Splitting them is what the seam buys
// and this is the bill.
//
// ── WHY A FILE RATHER THAN A LINE IN THE LAST BACKEND ─────────────────────────────────────────
// It could be appended to whichever backend happens to load last, and that is exactly the problem:
// it would be a load-order dependency hidden inside a file about something else, and the next person
// to reorder the backend block would move it without knowing. A file with a name says what it is,
// and `index.html` shows it sitting between the engines and their first reader.
//
// ── THE RULE, FOR WHOEVER ADDS A SCRIPT ───────────────────────────────────────────────────────
// **Every `features/` and `ui/` script must load AFTER this one.** `check-backends` PART D asserts
// it against `index.html`, because the failure is a blank page rather than a bad answer, and the
// first error it prints names a file that is not the cause.
Backends.bindBootstrap();
