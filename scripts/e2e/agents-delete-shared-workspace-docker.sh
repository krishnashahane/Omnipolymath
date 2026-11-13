#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_ROOT="${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "omnipolymath-agents-delete-shared-workspace-e2e:local" OMNIPOLYMATH_AGENTS_DELETE_SHARED_WORKSPACE_E2E_IMAGE)"
SKIP_BUILD="${OMNIPOLYMATH_AGENTS_DELETE_SHARED_WORKSPACE_E2E_SKIP_BUILD:-0}"
DOCKER_COMMAND_TIMEOUT="${OMNIPOLYMATH_AGENTS_DELETE_SHARED_WORKSPACE_DOCKER_COMMAND_TIMEOUT:-300s}"
OMNIPOLYMATH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 agents-delete-shared-workspace empty)"

docker_e2e_build_or_reuse "$IMAGE_NAME" agents-delete-shared-workspace "$SOURCE_ROOT/Dockerfile" "$SOURCE_ROOT" "" "$SKIP_BUILD"
docker_e2e_harness_mount_args

run_logged agents-delete-shared-workspace docker_e2e_docker_cmd run --rm \
  "${DOCKER_E2E_HARNESS_ARGS[@]}" \
  --entrypoint bash \
  -e OMNIPOLYMATH_SKIP_CHANNELS=1 \
  -e OMNIPOLYMATH_SKIP_PROVIDERS=1 \
  -e OMNIPOLYMATH_SKIP_GMAIL_WATCHER=1 \
  -e OMNIPOLYMATH_SKIP_CRON=1 \
  -e OMNIPOLYMATH_SKIP_CANVAS_HOST=1 \
  -e OMNIPOLYMATH_SKIP_BROWSER_CONTROL_SERVER=1 \
  -e OMNIPOLYMATH_SKIP_ACPX_RUNTIME=1 \
  -e OMNIPOLYMATH_SKIP_ACPX_RUNTIME_PROBE=1 \
  -e OMNIPOLYMATH_GATEWAY_TOKEN=agents-delete-shared-workspace-token \
  -e "OMNIPOLYMATH_TEST_STATE_SCRIPT_B64=$OMNIPOLYMATH_TEST_STATE_SCRIPT_B64" \
  "$IMAGE_NAME" \
  -lc '
set -euo pipefail
source scripts/lib/omnipolymath-e2e-instance.sh

omnipolymath_e2e_eval_test_state_from_b64 "${OMNIPOLYMATH_TEST_STATE_SCRIPT_B64:?missing OMNIPOLYMATH_TEST_STATE_SCRIPT_B64}"
export SHARED_WORKSPACE="$HOME/workspace-shared"
output_file="$HOME/delete.json"
agents_file="$HOME/agents.json"
gateway_log="$HOME/gateway.log"
gateway_pid=""

cleanup() {
  omnipolymath_e2e_terminate_gateways "${gateway_pid:-}"
  rm -rf "$HOME"
}
dump_logs_on_error() {
  local status=$?
  omnipolymath_e2e_print_log "$gateway_log" >&2
  exit "$status"
}
trap cleanup EXIT
trap dump_logs_on_error ERR

mkdir -p "$OMNIPOLYMATH_STATE_DIR" "$SHARED_WORKSPACE"
entry="$(omnipolymath_e2e_resolve_entrypoint)"
node "$entry" agents add alpha --workspace "$SHARED_WORKSPACE" --non-interactive
node "$entry" agents add ops --workspace "$SHARED_WORKSPACE" --non-interactive
gateway_pid="$(omnipolymath_e2e_start_gateway "$entry" 18789 "$gateway_log")"
omnipolymath_e2e_wait_gateway_ready "$gateway_pid" "$gateway_log" 300 18789

node "$entry" agents delete ops --force --json > "$output_file"
node "$entry" agents list --json > "$agents_file"

node scripts/e2e/lib/fixture.mjs agents-delete-assert "$output_file" "$agents_file"
'
