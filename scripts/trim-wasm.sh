#!/usr/bin/env bash
# Post-bundle trim step for the Guardian CLI build.
# The bun bundle is self-contained; this hook exists as the final build-stage
# step referenced by the package.json `build` script. Currently a no-op
# (kept for forward-compatibility if a wasm/asset trim is added later).
set -euo pipefail
echo "trim-wasm: nothing to trim (bundle is self-contained)"
