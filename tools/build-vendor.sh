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

MATRIX_JS_SDK_VERSION="41.8.0"
CRYPTO_WASM_VERSION="18.3.1"
OUT_DIR="${1:-$(pwd)/vendor-out}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"

npm init -y >/dev/null
npm install --no-audit --no-fund \
  "matrix-js-sdk@${MATRIX_JS_SDK_VERSION}" \
  "@matrix-org/matrix-sdk-crypto-wasm@${CRYPTO_WASM_VERSION}" \
  esbuild

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
