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
DOCKER_EXTRA_ENV_FILES=()
DOCKER_TRUSTED_HARNESS_CONTAINER_DIR="/trusted-harness"
DOCKER_TRUSTED_HARNESS_MOUNT=(-v "$TRUSTED_HARNESS_DIR":"$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR":ro)
omnipolymath_live_init_temp_dirs
omnipolymath_live_init_cache_home_dir
omnipolymath_live_init_managed_home
omnipolymath_live_init_profile_mount

if [[ -n "${OPENAI_API_KEY:-}" || -n "${OPENAI_BASE_URL:-}" || -n "${GEMINI_API_KEY:-}" || -n "${GOOGLE_API_KEY:-}" ]]; then
  docker_env_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-subagent-live-env.XXXXXX")"
  TEMP_DIRS+=("$docker_env_dir")
  docker_env_file="$docker_env_dir/provider.env"
  {
    if [[ -n "${OPENAI_API_KEY:-}" ]]; then
      printf 'OMNIPOLYMATH_DOCKER_LIVE_OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
    fi
    if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
      printf 'OMNIPOLYMATH_DOCKER_LIVE_OPENAI_BASE_URL=%s\n' "${OPENAI_BASE_URL}"
    fi
    if [[ -n "${GEMINI_API_KEY:-}" ]]; then
      printf 'OMNIPOLYMATH_DOCKER_LIVE_GEMINI_API_KEY=%s\n' "${GEMINI_API_KEY}"
    fi
    if [[ -n "${GOOGLE_API_KEY:-}" ]]; then
      printf 'OMNIPOLYMATH_DOCKER_LIVE_GOOGLE_API_KEY=%s\n' "${GOOGLE_API_KEY}"
    fi
  } >"$docker_env_file"
  DOCKER_EXTRA_ENV_FILES+=(--env-file "$docker_env_file")
fi

CONTAINER_NODE_OPTIONS="$(omnipolymath_live_container_node_options)"

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
if [ -n "${OMNIPOLYMATH_DOCKER_LIVE_OPENAI_API_KEY:-}" ]; then
  export OPENAI_API_KEY="$OMNIPOLYMATH_DOCKER_LIVE_OPENAI_API_KEY"
  unset OMNIPOLYMATH_DOCKER_LIVE_OPENAI_API_KEY
fi
if [ -n "${OMNIPOLYMATH_DOCKER_LIVE_OPENAI_BASE_URL:-}" ]; then
  export OPENAI_BASE_URL="$OMNIPOLYMATH_DOCKER_LIVE_OPENAI_BASE_URL"
  unset OMNIPOLYMATH_DOCKER_LIVE_OPENAI_BASE_URL
fi
if [ -n "${OMNIPOLYMATH_DOCKER_LIVE_GEMINI_API_KEY:-}" ]; then
  export GEMINI_API_KEY="$OMNIPOLYMATH_DOCKER_LIVE_GEMINI_API_KEY"
  unset OMNIPOLYMATH_DOCKER_LIVE_GEMINI_API_KEY
fi
if [ -n "${OMNIPOLYMATH_DOCKER_LIVE_GOOGLE_API_KEY:-}" ]; then
  export GOOGLE_API_KEY="$OMNIPOLYMATH_DOCKER_LIVE_GOOGLE_API_KEY"
  unset OMNIPOLYMATH_DOCKER_LIVE_GOOGLE_API_KEY
fi
trusted_scripts_dir="${OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR:-/src/scripts}"
source "$trusted_scripts_dir/lib/live-docker-stage.sh"
mkdir -p "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
tmp_dir="$(mktemp -d)"
omnipolymath_live_stage_workspace "$tmp_dir"
cd "$tmp_dir"
announce_relative="$(
  omnipolymath_live_resolve_unique_staged_file "$tmp_dir/src/agents" subagent-announce.live.test.ts
)"
announce_test="src/agents/$announce_relative"
OMNIPOLYMATH_LIVE_TEST=1 \
OMNIPOLYMATH_LIVE_SUBAGENT_E2E=1 \
OMNIPOLYMATH_VITEST_MAX_WORKERS="${OMNIPOLYMATH_VITEST_MAX_WORKERS:-1}" \
omnipolymath_live_run_staged_script scripts/test-live -- "$announce_test" -- --reporter=verbose
EOF

OMNIPOLYMATH_LIVE_DOCKER_REPO_ROOT="$ROOT_DIR" "$TRUSTED_HARNESS_DIR/scripts/test-live-build-docker.sh"
if omnipolymath_live_uses_managed_bind_dirs; then
  omnipolymath_live_chown_bind_dirs_for_container_user \
    "$LIVE_IMAGE_NAME" \
    "$DOCKER_USER" \
    "$CACHE_HOME_DIR" \
    "${DOCKER_HOME_DIR:-}"
fi

echo "==> Run subagent announce live test in Docker"
echo "==> Target: unique staged subagent-announce.live.test.ts"
echo "==> Model: ${OMNIPOLYMATH_LIVE_SUBAGENT_E2E_MODEL:-openai/gpt-5.6-luna}"
echo "==> Profile file: $PROFILE_STATUS"
DOCKER_RUN_ARGS=()
omnipolymath_live_init_docker_run_args DOCKER_RUN_ARGS "${OMNIPOLYMATH_LIVE_SUBAGENT_DOCKER_RUN_TIMEOUT:-1200s}"
DOCKER_RUN_ARGS+=(--rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS="$CONTAINER_NODE_OPTIONS" \
  -e OMNIPOLYMATH_SKIP_CHANNELS=1 \
  -e OMNIPOLYMATH_SUPPRESS_NOTES=1 \
  -e OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR="${DOCKER_TRUSTED_HARNESS_CONTAINER_DIR}/scripts" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE="${OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e OMNIPOLYMATH_LIVE_TEST=1 \
  -e OMNIPOLYMATH_LIVE_TEST_QUIET="${OMNIPOLYMATH_LIVE_TEST_QUIET:-}" \
  -e OMNIPOLYMATH_LIVE_WRAPPER_HEARTBEAT_MS="${OMNIPOLYMATH_LIVE_WRAPPER_HEARTBEAT_MS:-}" \
  -e OMNIPOLYMATH_LIVE_SUBAGENT_E2E=1 \
  -e OMNIPOLYMATH_LIVE_SUBAGENT_E2E_MODEL="${OMNIPOLYMATH_LIVE_SUBAGENT_E2E_MODEL:-}" \
  -e OMNIPOLYMATH_VITEST_FS_MODULE_CACHE=0 \
  -e OMNIPOLYMATH_VITEST_MAX_WORKERS="${OMNIPOLYMATH_VITEST_MAX_WORKERS:-1}")
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_EXTRA_ENV_FILES
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_TRUSTED_HARNESS_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$CACHE_HOME_DIR":/home/node/.cache \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.omnipolymath \
  -v "$WORKSPACE_DIR":/home/node/.omnipolymath/workspace)
omnipolymath_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
"${DOCKER_RUN_ARGS[@]}"
