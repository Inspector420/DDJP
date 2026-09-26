#!/usr/bin/env bash
# build-vendor.sh — reproducibly rebuild DDJP's vendored Matrix SDK bundle.
#
# Produces two committed static files (no build step needed to RUN the app):
#   lib/matrix-sdk.bundle.js   — matrix-js-sdk exposed as the global `matrixcs`
#   lib/matrix-crypto.wasm     — Rust crypto WASM, loaded via matrixcs.loadCrypto()
#
# Run this only when UPGRADING the SDK. Requires Node >= 22 and network access
# to registry.npmjs.org. Review the printed SHA-256 sums against VENDOR_PROVENANCE.md.
set -euo pipefail

# THESE TWO ARE NOW A CHECK, NOT AN INSTALL ARGUMENT — AND THAT IS DELIBERATE.
# The install below is `npm ci` against the shipped lockfile, so nothing consumes these as
# versions any more. Left as bare literals they would have been two dead constants that a reader
# takes for the pinned versions while the lockfile quietly said something else — the
# second-source-for-a-fact shape this tree keeps finding, and an unused value is indistinguishable
# from a missing feature. So they are asserted against what will actually be installed: if
# `package.json` is bumped and these are not, the build stops rather than producing a bundle whose
# provenance rows name the wrong versions.
MATRIX_JS_SDK_VERSION="41.8.0"
CRYPTO_WASM_VERSION="18.3.1"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
_pinned() {
  node -e 'const p=require(process.argv[1]+"/package.json");
    process.stdout.write(String((p.devDependencies||{})[process.argv[2]]||""))' "$REPO_ROOT" "$1"
}
for _pair in "matrix-js-sdk:$MATRIX_JS_SDK_VERSION" \
             "@matrix-org/matrix-sdk-crypto-wasm:$CRYPTO_WASM_VERSION"; do
  _pkg="${_pair%:*}"; _want="${_pair##*:}"; _got="$(_pinned "$_pkg")"
  if [ "$_got" != "$_want" ]; then
    echo "build-vendor: $_pkg is '$_want' here and '$_got' in package.json — reconcile them, then" >&2
    echo "              update the version/size/SHA-256 rows in tools/VENDOR_PROVENANCE.md." >&2
    exit 1
  fi
done

# OUT_DIR IS RESOLVED TO AN ABSOLUTE PATH HERE, BEFORE THE `cd` BELOW. A relative argument used to
# be resolved inside the temp working directory instead, so `build-vendor.sh lib` created
# `$WORK/lib`, copied both files into it, printed "--- built into lib ---" with two correct
# SHA-256 sums, and then deleted the whole thing on the EXIT trap. The command reported success,
# named the right destination, and produced nothing — which is worse than failing, and it is what
# `npm run build:vendor -- lib` did.
OUT_DIR="${1:-vendor-out}"
case "$OUT_DIR" in
  /*) ;;
  *) OUT_DIR="$(pwd)/$OUT_DIR" ;;
esac

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# THE REPO'S OWN LOCKFILE IS WHAT MAKES THIS REPRODUCIBLE, AND IT USED TO BE IGNORED.
# `matrix-js-sdk` pins its twelve dependencies with CARET RANGES, and the bundle inlines all of
# them — so a fresh `npm install` in an empty temp dir floats every one of them to newest-matching
# and the output bytes change whenever any of them publishes a patch. Measured: `content-type`
# 2.0.0->2.1.0 and `matrix-widget-api` 1.17.0->1.19.0 were enough to move the SHA-256 recorded in
# VENDOR_PROVENANCE.md, while the WASM matched exactly because it is a prebuilt binary copied out
# of a pinned package rather than bundled.
#
# WHY THAT MATTERS MORE THAN A STALE HASH: the provenance file tells the reader to compare these
# sums to verify the build. That is a SUPPLY-CHAIN check, and one that fails for a benign reason
# cannot separate "upstream published a patch" from "this tarball was tampered with" — so it
# trains its only reader to ignore it.
#
# `npm ci` against the shipped lockfile pins all twelve. Driven both ways: floating reproduced
# neither the size nor the sum; pinning reproduced both byte-for-byte.
cp "$REPO_ROOT/package.json" "$REPO_ROOT/package-lock.json" "$WORK/"
cd "$WORK"

npm ci --no-audit --no-fund

cat > entry.js <<'EOF'
export * from "matrix-js-sdk";
export * as cryptoApi from "matrix-js-sdk/lib/crypto-api/index.js";
import { initAsync } from "@matrix-org/matrix-sdk-crypto-wasm";
let _cryptoPromise = null;
export function loadCrypto(wasmUrl) {
  if (!_cryptoPromise) {
    const url = new URL(wasmUrl || "lib/matrix-crypto.wasm", document.baseURI);
    _cryptoPromise = initAsync(url);
  }
  return _cryptoPromise;
}
EOF

./node_modules/.bin/esbuild entry.js \
  --bundle --format=iife --global-name=matrixcs \
  --platform=browser --target=es2020 --legal-comments=none \
  --define:import.meta.url='"https://ddjp.invalid/"' \
  --outfile=matrix-sdk.bundle.js

mkdir -p "$OUT_DIR"
cp matrix-sdk.bundle.js "$OUT_DIR/matrix-sdk.bundle.js"
cp node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm "$OUT_DIR/matrix-crypto.wasm"

echo "--- built into $OUT_DIR ---"
sha256sum "$OUT_DIR/matrix-sdk.bundle.js" "$OUT_DIR/matrix-crypto.wasm"
