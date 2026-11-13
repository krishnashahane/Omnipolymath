#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
if [[ -z "${OMNIPOLYMATH_KITCHEN_SINK_NPM_SPEC:-}" ]]; then
  KITCHEN_SINK_NPM_VERSION_FILE="$TARGET_ROOT_DIR/scripts/e2e/lib/kitchen-sink-plugin/npm-version.txt"
  if [[ ! -f "$KITCHEN_SINK_NPM_VERSION_FILE" ]]; then
    echo "Frozen target is missing its branch-recorded Kitchen Sink npm version: $KITCHEN_SINK_NPM_VERSION_FILE" >&2
    exit 2
  fi
  KITCHEN_SINK_NPM_VERSION="$(tr -d '[:space:]' <"$KITCHEN_SINK_NPM_VERSION_FILE")"
  if [[ ! "$KITCHEN_SINK_NPM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][0-9A-Za-z.-]+)?$ ]]; then
    echo "Invalid branch-recorded Kitchen Sink npm version: $KITCHEN_SINK_NPM_VERSION" >&2
    exit 2
  fi
  export OMNIPOLYMATH_KITCHEN_SINK_NPM_SPEC="npm:@omnipolymath/kitchen-sink@$KITCHEN_SINK_NPM_VERSION"
fi

IMAGE_NAME="$(docker_e2e_resolve_image "omnipolymath-kitchen-sink-rpc-e2e" OMNIPOLYMATH_KITCHEN_SINK_RPC_E2E_IMAGE)"
MAX_MEMORY_MIB="$(docker_e2e_read_nonnegative_decimal_env OMNIPOLYMATH_KITCHEN_SINK_MAX_MEMORY_MIB 2048)"
MAX_CPU_PERCENT="$(docker_e2e_read_nonnegative_decimal_env OMNIPOLYMATH_KITCHEN_SINK_MAX_CPU_PERCENT 1200)"
# Keep the outer Docker watchdog above the walker's install, enable, inspect,
# readiness, and first-RPC retry budgets so inner failures stay diagnostic.
DOCKER_RUN_TIMEOUT="${OMNIPOLYMATH_KITCHEN_SINK_RPC_DOCKER_RUN_TIMEOUT:-1500s}"
CONTAINER_NAME="omnipolymath-kitchen-sink-rpc-e2e-$$"
RUN_LOG="$(mktemp "${TMPDIR:-/tmp}/omnipolymath-kitchen-sink-rpc.XXXXXX")"
STATS_LOG="$(mktemp "${TMPDIR:-/tmp}/omnipolymath-kitchen-sink-rpc-stats.XXXXXX")"
LIMITS_SUMMARY="$(mktemp "${TMPDIR:-/tmp}/omnipolymath-kitchen-sink-rpc-limits.XXXXXX")"

cleanup() {
  docker_e2e_docker_cmd rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  rm -f "$RUN_LOG" "$STATS_LOG" "$LIMITS_SUMMARY"
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" kitchen-sink-rpc

DOCKER_ENV_ARGS=(
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0
  -e OMNIPOLYMATH_ENTRY=/app/omnipolymath.mjs
)
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
  # The container's appuser writes only task-owned, non-secret limit diagnostics.
  chmod 666 "$LIMITS_SUMMARY"
  DOCKER_ENV_ARGS+=(
    -e GITHUB_ACTIONS
    -e GITHUB_STEP_SUMMARY=/tmp/omnipolymath-limits-summary.md
    -v "$LIMITS_SUMMARY:/tmp/omnipolymath-limits-summary.md"
  )
fi
capability_status=0
omnipolymath_resolve_frozen_plugin_harness_capabilities \
  "${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" || capability_status=$?
[ "$capability_status" -eq 0 ] || exit "$capability_status"
omnipolymath_append_frozen_plugin_harness_docker_env

for env_name in \
  OMNIPOLYMATH_KITCHEN_SINK_NPM_SPEC \
  OMNIPOLYMATH_KITCHEN_SINK_PLUGIN_ID \
  OMNIPOLYMATH_KITCHEN_SINK_PERSONALITY \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_READY_MS \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_COMMAND_MS \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_INSTALL_MS \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_CALL_MS \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_PORT \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_FETCH_MS \
  OMNIPOLYMATH_KITCHEN_SINK_RPC_FETCH_BODY_BYTES \
  OMNIPOLYMATH_KITCHEN_SINK_OUTPUT_CAPTURE_CHARS \
  OMNIPOLYMATH_KITCHEN_SINK_KEEP_TMP \
  OMNIPOLYMATH_KITCHEN_SINK_MAX_RSS_MIB \
  OMNIPOLYMATH_KITCHEN_SINK_COMMAND_MAX_RSS_MIB; do
  env_value="${!env_name:-}"
  if [[ -n "$env_value" && "$env_value" != "undefined" && "$env_value" != "null" ]]; then
    DOCKER_ENV_ARGS+=(-e "$env_name")
  fi
done

echo "Running kitchen-sink RPC Docker E2E..."
docker_e2e_docker_cmd rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker_e2e_harness_mount_args
DOCKER_COMMAND_TIMEOUT="$DOCKER_RUN_TIMEOUT" docker_e2e_docker_run_cmd run --name "$CONTAINER_NAME" "${DOCKER_E2E_HARNESS_ARGS[@]}" "${DOCKER_ENV_ARGS[@]}" -i "$IMAGE_NAME" \
  bash -lc "source scripts/lib/omnipolymath-e2e-instance.sh; omnipolymath_e2e_run_script_entrypoint scripts/e2e/kitchen-sink-rpc-walk" >"$RUN_LOG" 2>&1 &
docker_pid="$!"

docker_e2e_sample_stats_until_exit \
  "$CONTAINER_NAME" \
  "$docker_pid" \
  "$STATS_LOG" \
  "$RUN_LOG" \
  "Kitchen-sink RPC Docker E2E" \
  "${OMNIPOLYMATH_DOCKER_E2E_STATS_HEARTBEAT_SECONDS:-30}"

set +e
wait "$docker_pid"
run_status="$?"
set -e

docker_e2e_print_log "$RUN_LOG"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" && -s "$LIMITS_SUMMARY" ]]; then
  cat "$LIMITS_SUMMARY" >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$run_status" -eq 0 ]; then
  node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink-rpc
elif [ -s "$STATS_LOG" ]; then
  if ! node scripts/e2e/lib/docker-stats/assert-resource-ceiling.mjs "$STATS_LOG" "$MAX_MEMORY_MIB" "$MAX_CPU_PERCENT" kitchen-sink-rpc; then
    echo "RESOURCE_CEILING_FAILED lane=kitchen-sink-rpc primary_status=$run_status" >&2
  fi
fi

exit "$run_status"
