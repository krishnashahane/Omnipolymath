#!/usr/bin/env bash
set -euo pipefail
case "${OMNIPOLYMATH_FROZEN_TARGET_SESSION_COLD_STORAGE_MODE:-required}" in
  required | legacy) ;;
  unsupported)
    echo "NOT RUN: cold transcript storage is unavailable in the selected frozen target"
    exit 0
    ;;
  *) echo "invalid frozen session cold-storage mode" >&2; exit 2 ;;
esac
source scripts/lib/omnipolymath-e2e-instance.sh

proof_dir="$(mktemp -d /tmp/omnipolymath-cold-storage-e2e.XXXXXX)"
export HOME="$proof_dir/home"
export OMNIPOLYMATH_STATE_DIR="$proof_dir/state"
export OMNIPOLYMATH_CONFIG_PATH="$OMNIPOLYMATH_STATE_DIR/omnipolymath.json"
export OMNIPOLYMATH_TEST_WORKSPACE_DIR="$proof_dir/workspace"
export OMNIPOLYMATH_GATEWAY_TOKEN="cold-storage-e2e-token"
export OMNIPOLYMATH_SKIP_CHANNELS=1 OMNIPOLYMATH_SKIP_CRON=1 OMNIPOLYMATH_SKIP_CANVAS_HOST=1
export OMNIPOLYMATH_SKIP_GMAIL_WATCHER=1 OMNIPOLYMATH_DISABLE_BONJOUR=1
export PORT=18789
mkdir -p "$HOME" "$OMNIPOLYMATH_STATE_DIR" "$OMNIPOLYMATH_TEST_WORKSPACE_DIR"
entry="$(omnipolymath_e2e_resolve_entrypoint)"
gateway_pid=""
gateway_log="$proof_dir/gateway.log"
cleanup() {
  omnipolymath_e2e_stop_process "$gateway_pid"
  rm -rf "$proof_dir"
}
trap cleanup EXIT
dump_debug_logs() {
  omnipolymath_e2e_dump_logs "$gateway_log"
}
omnipolymath_e2e_enable_failure_diagnostics

client() { node scripts/e2e/lib/session-cold-storage/client.mjs "$1" "$entry" "$proof_dir"; }
start_gateway() {
  gateway_pid="$(omnipolymath_e2e_start_gateway "$entry" "$PORT" "$gateway_log")"
  omnipolymath_e2e_wait_gateway_ready "$gateway_pid" "$gateway_log" 300 "$PORT"
}
client seed
start_gateway
client exercise
kill -0 "$gateway_pid"
omnipolymath_e2e_stop_process "$gateway_pid"
start_gateway
client restart
omnipolymath_e2e_stop_process "$gateway_pid"
rm -rf "$OMNIPOLYMATH_STATE_DIR"
export OMNIPOLYMATH_STATE_DIR="$proof_dir/recovered"
export OMNIPOLYMATH_CONFIG_PATH="$OMNIPOLYMATH_STATE_DIR/omnipolymath.json"
start_gateway
client recovered
echo "Cold transcript storage Docker E2E passed"
