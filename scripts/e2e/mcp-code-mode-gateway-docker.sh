#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Runs a deterministic packaged Gateway/code-mode/MCP smoke using the Docker
# functional image and the local mock OpenAI Responses server.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "omnipolymath-mcp-code-mode-gateway-e2e" OMNIPOLYMATH_IMAGE)"
PORT="$(docker_e2e_read_tcp_port_env OMNIPOLYMATH_MCP_CODE_MODE_GATEWAY_PORT 18789)"
MOCK_PORT="$(docker_e2e_read_tcp_port_env OMNIPOLYMATH_MCP_CODE_MODE_MOCK_PORT 44082)"
CLIENT_TIMEOUT_MS="$(docker_e2e_read_positive_int_env OMNIPOLYMATH_MCP_CODE_MODE_CLIENT_TIMEOUT_MS 300000)"
CLIENT_BODY_MAX_BYTES="$(docker_e2e_read_positive_int_env OMNIPOLYMATH_MCP_CODE_MODE_CLIENT_BODY_MAX_BYTES 1048576)"
TOKEN="mcp-code-mode-e2e-$(date +%s)-$$"
CONTAINER_NAME="omnipolymath-mcp-code-mode-e2e-$$"

CLIENT_LOG="$(mktemp -t omnipolymath-mcp-code-mode-client-log.XXXXXX)"

trap 'docker_e2e_cleanup_container_run "$CONTAINER_NAME" "$CLIENT_LOG"' EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" mcp-code-mode-gateway
OMNIPOLYMATH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 mcp-code-mode-gateway empty)"
OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS=()
if [ -n "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  omnipolymath_prepublish_plugin_registry_configure_docker_args "$OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR"
fi

echo "Running in-container deterministic Gateway code-mode MCP API-file smoke..."
set +e
docker_e2e_run_with_harness \
  --name "$CONTAINER_NAME" \
  -e "OMNIPOLYMATH_GATEWAY_TOKEN=$TOKEN" \
  -e "OMNIPOLYMATH_SKIP_CHANNELS=1" \
  -e "OMNIPOLYMATH_SKIP_GMAIL_WATCHER=1" \
  -e "OMNIPOLYMATH_SKIP_CRON=1" \
  -e "OMNIPOLYMATH_SKIP_CANVAS_HOST=1" \
  -e "OMNIPOLYMATH_SKIP_ACPX_RUNTIME=1" \
  -e "OMNIPOLYMATH_SKIP_ACPX_RUNTIME_PROBE=1" \
  -e "OMNIPOLYMATH_TEST_STATE_SCRIPT_B64=$OMNIPOLYMATH_TEST_STATE_SCRIPT_B64" \
  -e "GW_URL=http://127.0.0.1:$PORT" \
  -e "GW_TOKEN=$TOKEN" \
  -e "OMNIPOLYMATH_MCP_CODE_MODE_CLIENT_TIMEOUT_MS=$CLIENT_TIMEOUT_MS" \
  -e "OMNIPOLYMATH_MCP_CODE_MODE_CLIENT_BODY_MAX_BYTES=$CLIENT_BODY_MAX_BYTES" \
  -e "OMNIPOLYMATH_ALLOW_INSECURE_PRIVATE_WS=1" \
  ${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]+"${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]}"} \
  "$IMAGE_NAME" \
  bash scripts/e2e/lib/mcp-code-mode/scenario.sh mock "$PORT" "$MOCK_PORT" >"$CLIENT_LOG" 2>&1
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  echo "Docker MCP code-mode API-file smoke failed"
  docker_e2e_print_log "$CLIENT_LOG"
  exit "$status"
fi

docker_e2e_print_log "$CLIENT_LOG"
echo "OK"
