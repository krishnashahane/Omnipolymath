#!/usr/bin/env bash
set -euo pipefail

export HOME=/tmp/omnipolymath-docker-selected-plugins
export OMNIPOLYMATH_STATE_DIR="$HOME/.omnipolymath"
export OMNIPOLYMATH_CONFIG_PATH="$OMNIPOLYMATH_STATE_DIR/omnipolymath.json"
export OMNIPOLYMATH_DISABLE_BUNDLED_SOURCE_OVERLAYS=1

mkdir -p "$OMNIPOLYMATH_STATE_DIR"
node --input-type=module <<'NODE'
import fs from "node:fs";

const entries = Object.fromEntries(
  ["clickclack", "slack", "msteams", "whatsapp"].map((id) => [id, { enabled: true }]),
);
fs.writeFileSync(
  process.env.OMNIPOLYMATH_CONFIG_PATH,
  `${JSON.stringify({ plugins: { entries } }, null, 2)}\n`,
  { mode: 0o600 },
);
NODE

for plugin_id in clickclack slack msteams whatsapp clawrouter; do
  node /app/omnipolymath.mjs plugins inspect "$plugin_id" --runtime --json \
    >"/tmp/omnipolymath-${plugin_id}-inspect.json"
done

node /omnipolymath-e2e/assertions.mjs
