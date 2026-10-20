# backend2 — the bot-run engine

**Live: it runs bot rooms** (`skeleton.js` registers it with `ready: true`). One account — the runner,
at exactly the ladder's top rung — reads intents from `events-uncategorized`, judges each with the
shared `Capabilities`, and writes what stands into `events-owner`, which every client folds through
the shared reducer. Design and rulings: `consensus/bot-backend.md` in the docs tree beside this one;
what each file owns is in its own header, read top to bottom before changing it.

| file | owns |
|---|---|
| `skeleton.js` | the registration and the seven-channel plan (the name is a fossil, kept on purpose) |
| `transport.js` | the transport's three bot-room answers, and ranking intents by power level |
| `streammanager.js` | the bot door: reshaping relayed events, unpacking groups, the saves list |
| `authority.js` | judging an intent, stamping it, and the send queue |
| `runner.js` | the loop that drives it: holding, relaying, announcing, sealing |
| `checkpoint.js` | the runner's checkpoints and floor |

*(This file said "skeleton, registered, not ready" until `ddjp_503`, long after J24 made the engine
live — corrected at J64.)*

## How a backend is loaded (changed at J23)

It is no longer "point `index.html` at this folder instead of `backend1/`". That was a
BUILD-TIME swap and it could not let two rooms differ. Every backend folder is loaded now and
each registers itself:

```js
Backends.register("backend2", {
  StreamManager: …,   // derived state / the reducer seam
  MatrixBridge:  …,   // transport, platform, intents
  MatrixAccount: …,   // login, session, account
  Capabilities:  …,   // permissions
}, { ready: false });   // `true` once it can actually run a room
```

**All FOUR slots, not two.** This file said two until `ddjp_399` — `MatrixAccount` joined the
interface at J59 and `Capabilities` well before that, and no stub README followed. A backend
built to the old list is one the account half cannot pass through, and `Backends.bind` refuses
a partial engine by name rather than binding it and failing later.

Declare the module under an engine-scoped name (`B2StreamManager`, as `backend1` does) rather
than the interface name. The interface names are declared once, in `core/backends.js`, and the
binder swaps their contents — two top-level `const`s of one name in a classic script is a
SyntaxError, and the shell has to be the one that wins.

Add a `<script>` tag for each file to `index.html`, after `core/backends.js`.

See `consensus/backend-selection.md` for the design and `tests/check-backends.js` for what the
seam is actually asserted to do.
