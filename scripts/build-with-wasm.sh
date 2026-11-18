#!/usr/bin/env bash
set -euo pipefail

WASM_PACK_VERSION="0.15.1"

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal
fi

if [[ -f "$HOME/.cargo/env" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.cargo/env"
fi

rustup target add wasm32-unknown-unknown

installed_wasm_pack_version="$(wasm-pack --version 2>/dev/null | awk '{print $2}' || true)"
if [[ "$installed_wasm_pack_version" != "$WASM_PACK_VERSION" ]]; then
  cargo install wasm-pack --version "$WASM_PACK_VERSION" --locked --force
fi

npm run build
