#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/omnipolymath-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
omnipolymath_e2e_eval_test_state_from_b64 "${OMNIPOLYMATH_TEST_STATE_SCRIPT_B64:?missing OMNIPOLYMATH_TEST_STATE_SCRIPT_B64}"
export OMNIPOLYMATH_SKIP_CHANNELS=1
export OMNIPOLYMATH_SKIP_GMAIL_WATCHER=1
export OMNIPOLYMATH_SKIP_CRON=1
export OMNIPOLYMATH_SKIP_CANVAS_HOST=1
export OMNIPOLYMATH_SKIP_BROWSER_CONTROL_SERVER=1
export OMNIPOLYMATH_SKIP_ACPX_RUNTIME=1
export OMNIPOLYMATH_SKIP_ACPX_RUNTIME_PROBE=1
export OMNIPOLYMATH_AGENT_HARNESS_FALLBACK=none
export OMNIPOLYMATH_CODEX_MEDIA_PATH_APP_SERVER_LOG="/tmp/omnipolymath-codex-media-path-app-server.jsonl"

PORT="${PORT:?missing PORT}"
TOKEN="${OMNIPOLYMATH_GATEWAY_TOKEN:?missing OMNIPOLYMATH_GATEWAY_TOKEN}"
PLUGIN_SPEC="${OMNIPOLYMATH_CODEX_MEDIA_PATH_PLUGIN_SPEC:-npm:@omnipolymath/codex}"
if [[ -z "${OMNIPOLYMATH_CODEX_MEDIA_PATH_PLUGIN_SPEC:-}" && -n "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]]; then
  PLUGIN_SPEC="npm:@omnipolymath/codex@${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}"
fi
GATEWAY_LOG="/tmp/omnipolymath-codex-media-path-gateway.log"
CLIENT_LOG="/tmp/omnipolymath-codex-media-path-client.log"
PLUGIN_INSTALL_LOG="/tmp/omnipolymath-codex-media-path-plugin-install.log"
PLUGIN_INSPECT_LOG="/tmp/omnipolymath-codex-media-path-plugin-inspect.json"
gateway_pid=""
plugin_registry_pid=""

cleanup() {
  omnipolymath_e2e_stop_process "$gateway_pid"
  omnipolymath_e2e_stop_process "$plugin_registry_pid"
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "Codex media-path Docker E2E failed with exit code $status" >&2
  omnipolymath_e2e_dump_logs "$PLUGIN_INSTALL_LOG" "$PLUGIN_INSPECT_LOG" "$GATEWAY_LOG" "$CLIENT_LOG" "$OMNIPOLYMATH_CODEX_MEDIA_PATH_APP_SERVER_LOG"
}
omnipolymath_e2e_enable_failure_diagnostics

entry="$(omnipolymath_e2e_resolve_entrypoint)"
mkdir -p "$OMNIPOLYMATH_STATE_DIR" "$OMNIPOLYMATH_TEST_WORKSPACE_DIR"
rm -f "$OMNIPOLYMATH_CODEX_MEDIA_PATH_APP_SERVER_LOG"

omnipolymath_e2e_enable_omnipolymath_cli_timeout
omnipolymath_prepublish_plugin_registry_start_mounted \
  /tmp/omnipolymath-codex-media-path-registry plugin_registry_pid '["@omnipolymath/codex"]'

echo "Installing Codex plugin: $PLUGIN_SPEC"
omnipolymath_e2e_fixture_plugin_command omnipolymath -- plugins install "$PLUGIN_SPEC" --force >"$PLUGIN_INSTALL_LOG" 2>&1
omnipolymath plugins inspect codex --runtime --json >"$PLUGIN_INSPECT_LOG"

node scripts/e2e/lib/codex-media-path/write-config.mjs

gateway_pid="$(omnipolymath_e2e_start_gateway "$entry" "$PORT" "$GATEWAY_LOG")"
omnipolymath_e2e_wait_gateway_ready "$gateway_pid" "$GATEWAY_LOG" 480 "$PORT"

PORT="$PORT" OMNIPOLYMATH_GATEWAY_TOKEN="$TOKEN" \
  tsx scripts/e2e/lib/codex-media-path/client.mjs >"$CLIENT_LOG" 2>&1

omnipolymath_e2e_print_log "$CLIENT_LOG"
echo "Codex media-path Docker E2E passed"
