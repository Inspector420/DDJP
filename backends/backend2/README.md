# backend2 — the bot-run engine (skeleton, registered, not ready)

**`skeleton.js` registers `backend2` and nothing else.** It exists so the switch has a real
second position — a registry with one entry is a constant dressed as a condition, which is the
dead branch `consensus/backend-selection.md` §1 opens by warning about. It registers
`ready: false`, so `Room.join` refuses a room marked `backend2` by name.

**J24 fills it in**: a room where the bot holds full authority and nothing is vouched.

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
