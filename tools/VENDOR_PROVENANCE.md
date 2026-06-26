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
tools/build-vendor.sh            # outputs to ./vendor-out
# then review the printed SHA-256 sums and copy the two files into lib/
```

To upgrade later, bump the two version variables at the top of
`build-vendor.sh`, re-run, update the version/size/SHA-256 rows above, and
re-test E2EE in a browser before committing.
