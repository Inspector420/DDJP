# Vendored Matrix SDK — provenance

This records exactly what the vendored Matrix SDK files are, where they came
from, and how to reproduce them. It exists so a future upgrade is one command,
not archaeology, and so the committed binaries can be audited against their
upstream sources.

## What is vendored

| File (commit to `lib/`) | Size | SHA-256 |
|---|---|---|
| `matrix-sdk.bundle.js` | 3,206,383 B | `a29a74bea2bf2f0c538c4c3cb4f4bdeee613aa0e7f948b68a71d41b3aedb94e2` |
| `matrix-crypto.wasm` | 5,573,870 B | `580fc05a46d3132c9fb672744401e73eec2b7ba46dea33e384c8181143a5998e` |

Re-run `tools/build-vendor.sh` and compare these sums to verify the build is
reproducible from the pinned sources below.

## Upstream sources (pinned)

| Package | Version | Registry tarball | Integrity (npm) |
|---|---|---|---|
| `matrix-js-sdk` | 41.8.0 | https://registry.npmjs.org/matrix-js-sdk/-/matrix-js-sdk-41.8.0.tgz | `sha512-ojbSE7s9hbK49a43QYP/RGPnpXQdXzDvAr9HfG5boqyHcVFAwansxzXEYXbooiIaYxFZA2Xfzu6waxxB1yCVPg==` |
| `@matrix-org/matrix-sdk-crypto-wasm` | 18.3.1 | https://registry.npmjs.org/@matrix-org/matrix-sdk-crypto-wasm/-/matrix-sdk-crypto-wasm-18.3.1.tgz | `sha512-VRjWhE1UgHnPpJ3b9B5+8z71ZC/HICFngPPFIN6ktzmUBKI5RusPujzbAQUoB3CgZ0yU58L99AfSQS4YTztSWw==` |

Bundler: `esbuild` (any recent version; not shipped, build-time only).
Build host requirement: Node >= 22.

## What the bundle exposes

Loaded with a single `<script src="lib/matrix-sdk.bundle.js"></script>`, it
defines the global `matrixcs`:

- `matrixcs.createClient(...)`, `matrixcs.RoomEvent`, `matrixcs.ClientEvent`,
  `matrixcs.Preset`, `matrixcs.Visibility`, and the rest of the matrix-js-sdk
  top-level namespace (drop-in for the old `browser-matrix.js` global).
- `matrixcs.cryptoApi.*` — the crypto-api namespace (`CryptoEvent`,
  `VerificationRequestEvent`, etc.), used for cross-signing / verification.
- `matrixcs.loadCrypto(wasmUrl?)` — added by DDJP. Loads the Rust crypto WASM
  and returns a memoized promise. Call it once and `await` it **before**
  `client.initRustCrypto()`.

## How the WASM is loaded (why two files works)

The crypto package's `initAsync(url)` fetches and instantiates the WASM, and
memoizes the result. `matrixcs.loadCrypto()` calls it with an explicit URL
(`lib/matrix-crypto.wasm`, resolved against the page). Because the SDK's own
`initRustCrypto()` later calls `initAsync()` with no argument, it reuses the
already-loaded module instead of fetching from its bundler-relative default.

Hosting requirement: the server must send `matrix-crypto.wasm` with
`Content-Type: application/wasm` (GitHub Pages, `python -m http.server`, and
most static hosts already do). Opening `index.html` from a `file://` path will
not work, because the WASM is fetched — same constraint the old `olm.wasm` had.

## Reproduce / upgrade

```
npm install
npm run build:vendor -- lib      # writes both files straight into lib/
```

`$1` is the output directory and defaults to `./vendor-out`; it is resolved to an absolute path
before the script `cd`s into its temp working dir, so a relative one works. **Both of those were
defects, and both are why this block now names the destination explicitly:** a bare invocation left
`lib/` empty while the suite stayed green and the page silently failed to start, and a relative `$1`
was resolved inside the temp dir — so the script printed *built into lib* with two correct SHA-256
sums and then deleted them on its exit trap.

**The sums above should reproduce exactly.** The build runs `npm ci` against this repo's
`package-lock.json` rather than installing into an empty temp project. That matters because
`matrix-js-sdk` pins its twelve dependencies with CARET RANGES and the bundle inlines all of them —
a floating install moves the bundle's bytes whenever any of them publishes a patch, with the two
direct versions still pinned exactly. Measured: `content-type` 2.0.0→2.1.0 and `matrix-widget-api`
1.17.0→1.19.0 were enough on their own. The WASM is unaffected because it is a prebuilt binary
copied out of a pinned package rather than bundled, which is why it matched while the bundle did not.

**So a mismatch here is now a real signal.** Before this, the check failed for a benign reason and
could not separate *upstream published a patch* from *this tarball was tampered with* — which is
the state most likely to train a reviewer to skip it.

To upgrade later, bump the two version variables at the top of `build-vendor.sh`, update the same
versions in `package.json`, run `npm install` to refresh the lockfile, re-run, update the
version/size/SHA-256 rows above, and re-test E2EE in a browser before committing.
