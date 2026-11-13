#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${OMNIPOLYMATH_LIVE_DOCKER_REPO_ROOT:-$SCRIPT_ROOT_DIR}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
TRUSTED_HARNESS_DIR="${OMNIPOLYMATH_LIVE_DOCKER_TRUSTED_HARNESS_DIR:-$SCRIPT_ROOT_DIR}"
if [[ -z "$TRUSTED_HARNESS_DIR" || ! -d "$TRUSTED_HARNESS_DIR" ]]; then
  echo "ERROR: trusted live Docker harness directory not found: ${TRUSTED_HARNESS_DIR:-<empty>}." >&2
  exit 1
fi
TRUSTED_HARNESS_DIR="$(cd "$TRUSTED_HARNESS_DIR" && pwd)"
source "$TRUSTED_HARNESS_DIR/scripts/lib/live-docker-auth.sh"
IMAGE_NAME="${OMNIPOLYMATH_IMAGE:-omnipolymath:local}"
LIVE_IMAGE_NAME="${OMNIPOLYMATH_LIVE_IMAGE:-${IMAGE_NAME}-live}"
CONFIG_DIR="${OMNIPOLYMATH_CONFIG_DIR:-$HOME/.omnipolymath}"
WORKSPACE_DIR="${OMNIPOLYMATH_WORKSPACE_DIR:-$HOME/.omnipolymath/workspace}"
PROFILE_FILE="$(omnipolymath_live_default_profile_file)"
LIVE_GATEWAY_MAX_MODELS="$(omnipolymath_live_read_positive_int_env OMNIPOLYMATH_LIVE_GATEWAY_MAX_MODELS 8)"
LIVE_GATEWAY_STEP_TIMEOUT_MS="$(omnipolymath_live_read_positive_int_env OMNIPOLYMATH_LIVE_GATEWAY_STEP_TIMEOUT_MS 45000)"
LIVE_GATEWAY_MODEL_TIMEOUT_MS="$(omnipolymath_live_read_positive_int_env OMNIPOLYMATH_LIVE_GATEWAY_MODEL_TIMEOUT_MS 90000)"
DOCKER_AUTH_PRESTAGED=0
DOCKER_TRUSTED_HARNESS_CONTAINER_DIR="/trusted-harness"
DOCKER_TRUSTED_HARNESS_MOUNT=(-v "$TRUSTED_HARNESS_DIR":"$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR":ro)
omnipolymath_live_init_temp_dirs
omnipolymath_live_init_cli_tools_dir
omnipolymath_live_init_cache_home_dir
omnipolymath_live_init_managed_home
omnipolymath_live_init_profile_mount

omnipolymath_live_collect_auth_for_providers "${OMNIPOLYMATH_LIVE_GATEWAY_PROVIDERS:-}"
omnipolymath_live_finalize_auth_mounts
CONTAINER_NODE_OPTIONS="$(omnipolymath_live_container_node_options)"

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
trusted_scripts_dir="${OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR:-/src/scripts}"
source "$trusted_scripts_dir/lib/live-docker-stage.sh"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
tmp_dir="$(mktemp -d)"
omnipolymath_live_stage_mounted_auth
omnipolymath_live_stage_workspace "$tmp_dir"
cd "$tmp_dir"
omnipolymath_live_prepare_cli_backend_docker_packages \
  "${OMNIPOLYMATH_LIVE_GATEWAY_PROVIDERS:-}" \
  "${OMNIPOLYMATH_LIVE_GATEWAY_MODELS:-}"
omnipolymath_live_stage_gemini_auth
omnipolymath_live_run_staged_script scripts/test-live -- src/gateway/gateway-models.profiles.live.test.ts
EOF

OMNIPOLYMATH_LIVE_DOCKER_REPO_ROOT="$ROOT_DIR" "$TRUSTED_HARNESS_DIR/scripts/test-live-build-docker.sh"
if omnipolymath_live_uses_managed_bind_dirs; then
  omnipolymath_live_chown_bind_dirs_for_container_user \
    "$LIVE_IMAGE_NAME" \
    "$DOCKER_USER" \
    "$CLI_TOOLS_DIR" \
    "$CACHE_HOME_DIR" \
    "${DOCKER_HOME_DIR:-}"
fi

echo "==> Run gateway live model tests (profile keys)"
echo "==> Target: src/gateway/gateway-models.profiles.live.test.ts"
echo "==> Profile file: $PROFILE_STATUS"
echo "==> External auth dirs: ${AUTH_DIRS_CSV:-none}"
echo "==> External auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_RUN_ARGS=()
omnipolymath_live_init_docker_run_args DOCKER_RUN_ARGS "${OMNIPOLYMATH_LIVE_GATEWAY_DOCKER_RUN_TIMEOUT:-2100s}"
DOCKER_RUN_ARGS+=(--rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e OPENAI_API_KEY \
  -e OPENAI_BASE_URL \
  -e ANTHROPIC_API_KEY \
  -e GEMINI_API_KEY \
  -e GOOGLE_API_KEY \
  -e MINIMAX_API_KEY \
  -e OPENROUTER_API_KEY \
  -e FIREWORKS_API_KEY \
  -e DEEPSEEK_API_KEY \
  -e XAI_API_KEY \
  -e ZAI_API_KEY \
  -e Z_AI_API_KEY \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS="$CONTAINER_NODE_OPTIONS" \
  -e OMNIPOLYMATH_SKIP_CHANNELS=1 \
  -e OMNIPOLYMATH_SUPPRESS_NOTES=1 \
  -e OMNIPOLYMATH_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e OMNIPOLYMATH_DOCKER_AUTH_DIRS_RESOLVED="$AUTH_DIRS_CSV" \
  -e OMNIPOLYMATH_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR="${DOCKER_TRUSTED_HARNESS_CONTAINER_DIR}/scripts" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE="${OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e OMNIPOLYMATH_LIVE_TEST=1 \
  -e OMNIPOLYMATH_LIVE_TEST_QUIET="${OMNIPOLYMATH_LIVE_TEST_QUIET:-}" \
  -e OMNIPOLYMATH_LIVE_WRAPPER_HEARTBEAT_MS="${OMNIPOLYMATH_LIVE_WRAPPER_HEARTBEAT_MS:-}" \
  -e OMNIPOLYMATH_LIVE_REQUIRE_PROFILE_KEYS="${OMNIPOLYMATH_LIVE_REQUIRE_PROFILE_KEYS:-}" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_MODELS="${OMNIPOLYMATH_LIVE_GATEWAY_MODELS:-modern}" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_PROVIDERS="${OMNIPOLYMATH_LIVE_GATEWAY_PROVIDERS:-}" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_THINKING="${OMNIPOLYMATH_LIVE_GATEWAY_THINKING:-}" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_SMOKE="${OMNIPOLYMATH_LIVE_GATEWAY_SMOKE:-1}" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_MAX_MODELS="$LIVE_GATEWAY_MAX_MODELS" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_HEARTBEAT_MS="${OMNIPOLYMATH_LIVE_GATEWAY_HEARTBEAT_MS:-}" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_STEP_TIMEOUT_MS="$LIVE_GATEWAY_STEP_TIMEOUT_MS" \
  -e OMNIPOLYMATH_LIVE_GATEWAY_MODEL_TIMEOUT_MS="$LIVE_GATEWAY_MODEL_TIMEOUT_MS" \
  -e OMNIPOLYMATH_VITEST_FS_MODULE_CACHE=0)
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_TRUSTED_HARNESS_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$CLI_TOOLS_DIR":/home/node/.npm-global \
  -v "$CACHE_HOME_DIR":/home/node/.cache \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.omnipolymath \
  -v "$WORKSPACE_DIR":/home/node/.omnipolymath/workspace)
omnipolymath_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
omnipolymath_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
"${DOCKER_RUN_ARGS[@]}"
