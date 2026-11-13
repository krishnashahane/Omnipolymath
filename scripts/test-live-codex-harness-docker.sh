#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

SCRIPT_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="${OMNIPOLYMATH_LIVE_DOCKER_REPO_ROOT:-$SCRIPT_ROOT_DIR}"
ROOT_DIR="$(cd "$ROOT_DIR" && pwd)"
TRUSTED_HARNESS_DIR="${OMNIPOLYMATH_LIVE_DOCKER_TRUSTED_HARNESS_DIR:-${OMNIPOLYMATH_LIVE_CODEX_TRUSTED_HARNESS_DIR:-$SCRIPT_ROOT_DIR}}"
if [[ -z "$TRUSTED_HARNESS_DIR" || ! -d "$TRUSTED_HARNESS_DIR" ]]; then
  echo "ERROR: trusted Codex harness directory not found: ${TRUSTED_HARNESS_DIR:-<empty>}." >&2
  exit 1
fi
TRUSTED_HARNESS_DIR="$(cd "$TRUSTED_HARNESS_DIR" && pwd)"
source "$TRUSTED_HARNESS_DIR/scripts/lib/live-docker-auth.sh"
source "$TRUSTED_HARNESS_DIR/scripts/lib/codex-live-docker-security.sh"
IMAGE_NAME="${OMNIPOLYMATH_IMAGE:-omnipolymath:local}"
LIVE_IMAGE_NAME="${OMNIPOLYMATH_LIVE_IMAGE:-${IMAGE_NAME}-live}"
CONFIG_DIR="${OMNIPOLYMATH_CONFIG_DIR:-$HOME/.omnipolymath}"
WORKSPACE_DIR="${OMNIPOLYMATH_WORKSPACE_DIR:-$HOME/.omnipolymath/workspace}"
PROFILE_FILE="$(omnipolymath_live_default_profile_file)"
CODEX_HARNESS_AUTH_MODE="${OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH:-codex-auth}"
CODEX_CLI_PACKAGE_SPEC="${OMNIPOLYMATH_LIVE_CODEX_CLI_PACKAGE_SPEC:-}"
CODEX_HARNESS_SETUP_TIMEOUT_SECONDS="$(omnipolymath_live_read_positive_int_env OMNIPOLYMATH_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS 180)"
CODEX_HARNESS_TARGET_COUNT=1
if [[ -n "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_TARGETS:-}" ]]; then
  IFS=',' read -r -a CODEX_HARNESS_TARGET_ITEMS <<<"$OMNIPOLYMATH_LIVE_CODEX_HARNESS_TARGETS"
  CODEX_HARNESS_TARGET_COUNT="${#CODEX_HARNESS_TARGET_ITEMS[@]}"
fi
# Each target starts an isolated 15-minute Vitest suite. Preserve the old
# 35-minute single-target budget while scaling matrix runs linearly.
CODEX_HARNESS_DOCKER_RUN_TIMEOUT="${OMNIPOLYMATH_LIVE_CODEX_HARNESS_DOCKER_RUN_TIMEOUT:-$((2100 * CODEX_HARNESS_TARGET_COUNT))s}"
DOCKER_TRUSTED_HARNESS_MOUNT=()
DOCKER_TRUSTED_HARNESS_CONTAINER_DIR=""
DOCKER_CACHE_CONTAINER_DIR="/tmp/omnipolymath-cache"
DOCKER_CLI_TOOLS_CONTAINER_DIR="/tmp/omnipolymath-npm-global"
DOCKER_EXTRA_ENV_FILES=()
DOCKER_AUTH_PRESTAGED=0

case "$CODEX_HARNESS_AUTH_MODE" in
  codex-auth | api-key)
    ;;
  *)
    echo "ERROR: OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH must be one of: codex-auth, api-key." >&2
    exit 1
    ;;
esac

if [[ -f "$PROFILE_FILE" && -r "$PROFILE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROFILE_FILE"
  set +a
fi

CODEX_APP_SERVER_ARGS="${OMNIPOLYMATH_CODEX_APP_SERVER_ARGS:-}"
if [[ -z "$CODEX_APP_SERVER_ARGS" ]] && omnipolymath_live_truthy "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE:-1}"; then
  CODEX_APP_SERVER_ARGS="app-server --listen stdio:// -c features.multi_agent_v2=true"
fi

if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH=api-key requires OPENAI_API_KEY." >&2
  exit 1
fi
if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" && ! -s "$HOME/.codex/auth.json" ]]; then
  echo "ERROR: OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH=codex-auth requires ~/.codex/auth.json before building the live Docker image." >&2
  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "If this is a Testbox/API-key run, set OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH=api-key and run through omnipolymath-testbox-env." >&2
  fi
  exit 1
fi
if [[ -z "$CODEX_CLI_PACKAGE_SPEC" ]]; then
  CODEX_CLI_PACKAGE_SPEC="$(
    node -e '
      const pkg = require(process.argv[1]);
      const version = pkg.dependencies?.["@openai/codex"];
      if (!version || typeof version !== "string") process.exit(1);
      process.stdout.write(`@openai/codex@${version}`);
    ' "$ROOT_DIR/extensions/codex/package.json"
  )"
fi

omnipolymath_live_init_temp_dirs
omnipolymath_live_init_cli_tools_dir
omnipolymath_live_init_cache_home_dir
omnipolymath_live_init_managed_home
if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then
  if [[ -z "${DOCKER_HOME_DIR:-}" ]]; then
    DOCKER_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-docker-home.XXXXXX")"
    TEMP_DIRS+=("$DOCKER_HOME_DIR")
    omnipolymath_live_prepare_bind_dir_for_container_user "$DOCKER_HOME_DIR"
    DOCKER_HOME_MOUNT=(-v "$DOCKER_HOME_DIR":/home/node)
  fi
  CONFIG_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-docker-config.XXXXXX")"
  WORKSPACE_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-docker-workspace.XXXXXX")"
  TEMP_DIRS+=("$CONFIG_DIR" "$WORKSPACE_DIR")
  chmod 0777 "$DOCKER_HOME_DIR" "$CONFIG_DIR" "$WORKSPACE_DIR" || true
  DOCKER_CACHE_CONTAINER_DIR="/home/node/.cache"
  DOCKER_CLI_TOOLS_CONTAINER_DIR="/home/node/.npm-global"
fi

if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then
  PROFILE_MOUNT=()
  PROFILE_STATUS="api-key-env"
else
  omnipolymath_live_init_profile_mount
fi

DOCKER_TRUSTED_HARNESS_CONTAINER_DIR="/trusted-harness"
DOCKER_TRUSTED_HARNESS_MOUNT=(-v "$TRUSTED_HARNESS_DIR":"$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR":ro)

AUTH_FILES=()
if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" ]]; then
  while IFS= read -r auth_file; do
    [[ -n "$auth_file" ]] || continue
    AUTH_FILES+=("$auth_file")
  done < <(omnipolymath_live_collect_auth_files_from_csv "openai")
fi

AUTH_DIRS=()
omnipolymath_live_finalize_auth_mounts

DOCKER_AUTH_ENV=()
if [[ "$CODEX_HARNESS_AUTH_MODE" == "api-key" ]]; then
  docker_env_dir="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-codex-harness-env.XXXXXX")"
  TEMP_DIRS+=("$docker_env_dir")
  docker_env_file="$docker_env_dir/openai.env"
  {
    printf 'OPENAI_API_KEY=%s\n' "${OPENAI_API_KEY}"
    printf 'CODEX_API_KEY=%s\n' "${CODEX_API_KEY:-$OPENAI_API_KEY}"
    if [[ -n "${OPENAI_BASE_URL:-}" ]]; then
      printf 'OPENAI_BASE_URL=%s\n' "${OPENAI_BASE_URL}"
    fi
  } >"$docker_env_file"
  DOCKER_EXTRA_ENV_FILES+=(--env-file "$docker_env_file")
fi

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
trusted_scripts_dir="${OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR:-/src/scripts}"
source "$trusted_scripts_dir/lib/live-docker-stage.sh"
cleanup_codex_live_mounts() {
  chmod -R a+rwX "$HOME" "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" 2>/dev/null || true
}
trap cleanup_codex_live_mounts EXIT
if [ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_DEBUG:-}" = "1" ]; then
  id
  mount | grep -E 'omnipolymath-cache|omnipolymath-npm|/home/node' || true
  ls -ld "$HOME" "$XDG_CACHE_HOME" "$NPM_CONFIG_PREFIX" 2>/dev/null || true
fi
# Force the Codex harness to use the staged `~/.codex` auth files. This lane
# is not meant to exercise raw OpenAI API-key routing unless the lane
# explicitly opts into API-key auth for CI.
if [ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" != "api-key" ]; then
  unset OPENAI_API_KEY OPENAI_BASE_URL
fi
mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
omnipolymath_live_stage_mounted_auth
run_setup_command() {
  omnipolymath_live_run_setup_command \
    "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS:?missing live Codex harness setup timeout seconds}" \
    "live Codex harness setup" \
    "$@"
}
if [ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" != "api-key" ] && [ ! -s "$HOME/.codex/auth.json" ]; then
  echo "ERROR: missing ~/.codex/auth.json for Codex harness live test." >&2
  exit 1
fi
if [ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" != "api-key" ]; then
  node --import tsx "$trusted_scripts_dir/prepare-codex-ci-auth.ts" "$HOME/.codex/auth.json"
fi
run_setup_command npm install -g "$OMNIPOLYMATH_LIVE_CODEX_CLI_PACKAGE_SPEC"
"$NPM_CONFIG_PREFIX/bin/codex" --version
if [ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH:-codex-auth}" = "api-key" ]; then
  printf '%s\n' "$OPENAI_API_KEY" | "$NPM_CONFIG_PREFIX/bin/codex" login --with-api-key >/dev/null
fi
tmp_dir="$(mktemp -d)"
omnipolymath_live_stage_source_tree "$tmp_dir"
omnipolymath_live_stage_node_modules "$tmp_dir"
omnipolymath_live_link_runtime_tree "$tmp_dir"
if [ ! -f "$tmp_dir/extensions/codex/omnipolymath.plugin.json" ]; then
  echo "ERROR: staged Codex plugin not found for live harness." >&2
  exit 1
fi
# Source Gateway and plugin must share one prepared-runtime owner; built artifacts own a
# separate lifecycle and are validated by the packaged-plugin Docker lane instead.
export OMNIPOLYMATH_BUNDLED_PLUGINS_DIR="$tmp_dir/extensions"
omnipolymath_live_stage_state_dir "$tmp_dir/.omnipolymath-state"
if [ -n "${OMNIPOLYMATH_LIVE_CODEX_TRUSTED_HARNESS_DIR:-}" ] && [ -d "$OMNIPOLYMATH_LIVE_CODEX_TRUSTED_HARNESS_DIR" ]; then
  for harness_file in src/gateway/gateway-codex-harness.live-helpers.ts; do
    if [ -f "$OMNIPOLYMATH_LIVE_CODEX_TRUSTED_HARNESS_DIR/$harness_file" ]; then
      mkdir -p "$(dirname "$tmp_dir/$harness_file")"
      cp "$OMNIPOLYMATH_LIVE_CODEX_TRUSTED_HARNESS_DIR/$harness_file" "$tmp_dir/$harness_file"
    fi
  done
fi
omnipolymath_live_prepare_staged_config
cd "$tmp_dir"
if [ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG:-1}" = "1" ]; then
  node --import tsx "$trusted_scripts_dir/prepare-codex-ci-config.ts" "$HOME/.codex/config.toml" "$tmp_dir"
fi
# Detect runner namespace restrictions before making live provider requests.
"$NPM_CONFIG_PREFIX/bin/codex" sandbox \
  -c 'sandbox_mode="workspace-write"' \
  -c sandbox_workspace_write.network_access=false \
  -- true
codex_preflight_log="$tmp_dir/codex-preflight.log"
codex_preflight_token="CODEX-PREFLIGHT-OK"
if ! "$NPM_CONFIG_PREFIX/bin/codex" exec \
  --json \
  --color never \
  --skip-git-repo-check \
  "Reply exactly: $codex_preflight_token" >"$codex_preflight_log" 2>&1; then
  if grep -q "Failed to extract accountId from token" "$codex_preflight_log"; then
    echo "ERROR: Codex auth cannot extract accountId from the available token; refresh OMNIPOLYMATH_CODEX_AUTH_JSON or use OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH=api-key." >&2
    exit 1
  fi
  tail -c 262144 "$codex_preflight_log" >&2 || true
  exit 1
fi
run_codex_harness_target() {
  local model="${1:?model required}"
  local thinking="${2:?thinking required}"
  export OMNIPOLYMATH_LIVE_CODEX_HARNESS_MODEL="$model"
  export OMNIPOLYMATH_LIVE_CODEX_HARNESS_THINKING="$thinking"
  echo "==> Codex harness target: model=$model thinking=$thinking"
  omnipolymath_live_run_staged_script scripts/test-live -- ${OMNIPOLYMATH_LIVE_CODEX_TEST_FILES:-src/gateway/gateway-codex-harness.live.test.ts}
}
if [ -n "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_TARGETS:-}" ]; then
  IFS=',' read -r -a harness_targets <<<"$OMNIPOLYMATH_LIVE_CODEX_HARNESS_TARGETS"
  for harness_target in "${harness_targets[@]}"; do
    model="${harness_target%%=*}"
    thinking="${harness_target##*=}"
    if [ -z "$model" ] || [ -z "$thinking" ] || [ "$model" = "$thinking" ]; then
      echo "ERROR: invalid Codex harness target '$harness_target'; expected provider/model=thinking." >&2
      exit 1
    fi
    run_codex_harness_target "$model" "$thinking"
  done
else
  run_codex_harness_target \
    "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_MODEL:-openai/gpt-5.6-luna}" \
    "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_THINKING:-low}"
fi
EOF

omnipolymath_live_require_build_extension codex
# The release package image intentionally excludes externalized plugins such as
# Codex. This lane must rebuild the live image so the plugin-owned harness is
# present under the bundled plugin runtime directory.
OMNIPOLYMATH_SKIP_DOCKER_BUILD=0
export OMNIPOLYMATH_SKIP_DOCKER_BUILD
OMNIPOLYMATH_LIVE_DOCKER_REPO_ROOT="$ROOT_DIR" "$TRUSTED_HARNESS_DIR/scripts/test-live-build-docker.sh"
if omnipolymath_live_uses_managed_bind_dirs; then
  omnipolymath_live_chown_bind_dirs_for_container_user \
    "$LIVE_IMAGE_NAME" \
    "$DOCKER_USER" \
    "$CLI_TOOLS_DIR" \
    "$CACHE_HOME_DIR" \
    "$CONFIG_DIR" \
    "$WORKSPACE_DIR" \
    "${DOCKER_HOME_DIR:-}"
fi

echo "==> Run Codex harness live test in Docker"
echo "==> Model: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_MODEL:-openai/gpt-5.6-luna}"
echo "==> Thinking: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_THINKING:-low}"
echo "==> Expected native effort: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_EXPECTED_EFFORT:-auto}"
echo "==> Targets: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_TARGETS:-single model}"
echo "==> Target count: $CODEX_HARNESS_TARGET_COUNT"
echo "==> Docker run timeout: $CODEX_HARNESS_DOCKER_RUN_TIMEOUT"
echo "==> Chat image probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_CHAT_IMAGE_PROBE:-0}"
echo "==> Image probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_IMAGE_PROBE:-1}"
echo "==> MCP probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_MCP_PROBE:-1}"
echo "==> Multi-session probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_MULTI_SESSION_PROBE:-0}"
echo "==> Subagent probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE:-1}"
echo "==> Subagent count: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT:-1}"
echo "==> Subagent-only fast path: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_ONLY:-auto}"
echo "==> Guardian probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_GUARDIAN_PROBE:-1}"
echo "==> Code-mode-only probe: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_CODE_MODE_ONLY:-0}"
echo "==> Loop relay disabled: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_DISABLE_LOOP_RELAY:-0}"
echo "==> Resume stress: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_RESUME_STRESS:-0}"
echo "==> Resume stress history turns: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_RESUME_STRESS_HISTORY_TURNS:-4}"
echo "==> Resume stress restarts: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_RESUME_STRESS_RESTARTS:-3}"
echo "==> Compaction stress: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_COMPACTION_STRESS:-0}"
echo "==> Compaction stress turns: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_COMPACTION_STRESS_TURNS:-4}"
echo "==> Large output bytes: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_LARGE_OUTPUT_BYTES:-300000}"
echo "==> Auth mode: $CODEX_HARNESS_AUTH_MODE"
echo "==> Profile file: $PROFILE_STATUS"
echo "==> CI-safe Codex config: ${OMNIPOLYMATH_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG:-1}"
echo "==> Test files: ${OMNIPOLYMATH_LIVE_CODEX_TEST_FILES:-src/gateway/gateway-codex-harness.live.test.ts}"
echo "==> Codex CLI package: $CODEX_CLI_PACKAGE_SPEC"
echo "==> Harness fallback: none"
echo "==> Auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_RUN_ARGS=()
omnipolymath_live_init_docker_run_args DOCKER_RUN_ARGS "$CODEX_HARNESS_DOCKER_RUN_TIMEOUT"
cleanup_codex_live_docker() {
  local run_result=$?
  local cleanup_failed=0
  trap - EXIT
  if ! omnipolymath_codex_live_cleanup_security; then
    echo "ERROR: Codex Docker cleanup failed; retained recovery files at ${CODEX_LIVE_SECURITY_DIR:-<unavailable>}." >&2
    cleanup_failed=1
  fi
  cleanup_temp_dirs || cleanup_failed=1
  if [[ "$cleanup_failed" == 1 ]]; then
    exit 1
  fi
  exit "$run_result"
}
trap cleanup_codex_live_docker EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
omnipolymath_codex_live_prepare_security "$TRUSTED_HARNESS_DIR/scripts/lib/codex-live-docker-security"
omnipolymath_live_append_array DOCKER_RUN_ARGS CODEX_LIVE_SECURITY_ARGS
DOCKER_RUN_ARGS+=(--rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NPM_CONFIG_PREFIX="$DOCKER_CLI_TOOLS_CONTAINER_DIR" \
  -e npm_config_prefix="$DOCKER_CLI_TOOLS_CONTAINER_DIR" \
  -e XDG_CACHE_HOME="$DOCKER_CACHE_CONTAINER_DIR" \
  -e COREPACK_HOME="$DOCKER_CACHE_CONTAINER_DIR/node/corepack" \
  -e NPM_CONFIG_CACHE="$DOCKER_CACHE_CONTAINER_DIR/npm" \
  -e npm_config_cache="$DOCKER_CACHE_CONTAINER_DIR/npm" \
  -e NODE_OPTIONS="$(omnipolymath_live_container_node_options)" \
  -e OMNIPOLYMATH_AGENT_HARNESS_FALLBACK=none \
  -e OMNIPOLYMATH_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e OMNIPOLYMATH_CODEX_APP_SERVER_BIN="${OMNIPOLYMATH_CODEX_APP_SERVER_BIN:-codex}" \
  -e OMNIPOLYMATH_CODEX_APP_SERVER_ARGS="$CODEX_APP_SERVER_ARGS" \
  -e OMNIPOLYMATH_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE="${OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS_AUTH="$CODEX_HARNESS_AUTH_MODE" \
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS=1)
omnipolymath_live_append_default_env OMNIPOLYMATH_LIVE_CODEX_HARNESS_ \
  CHAT_IMAGE_PROBE=0 CODE_MODE_ONLY=0 COMPACTION_STRESS=0 COMPACTION_STRESS_TURNS=4 \
  DEBUG= DISABLE_LOOP_RELAY=0 GUARDIAN_PROBE=1 IMAGE_PROBE=1 LARGE_OUTPUT_BYTES=300000 \
  MCP_PROBE=1 MULTI_SESSION_PROBE=0 MODEL=openai/gpt-5.6-luna TARGETS= THINKING=low \
  EXPECTED_EFFORT= REQUIRE_GUARDIAN_EVENTS=1 REQUEST_TIMEOUT_MS= RESUME_STRESS=0 \
  RESUME_STRESS_HISTORY_TURNS=4 RESUME_STRESS_RESTARTS=3
DOCKER_RUN_ARGS+=(\
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS_SETUP_TIMEOUT_SECONDS="$CODEX_HARNESS_SETUP_TIMEOUT_SECONDS" \
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_ONLY="${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_ONLY:-}" \
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT="${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_COUNT:-1}" \
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE="${OMNIPOLYMATH_LIVE_CODEX_HARNESS_SUBAGENT_PROBE:-1}" \
  -e OMNIPOLYMATH_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG="${OMNIPOLYMATH_LIVE_CODEX_HARNESS_USE_CI_SAFE_CODEX_CONFIG:-1}" \
  -e OMNIPOLYMATH_LIVE_CODEX_CLI_PACKAGE_SPEC="$CODEX_CLI_PACKAGE_SPEC" \
  -e OMNIPOLYMATH_CLI_BACKEND_LOG_OUTPUT="${OMNIPOLYMATH_CLI_BACKEND_LOG_OUTPUT:-}" \
  -e OMNIPOLYMATH_TEST_CONSOLE="${OMNIPOLYMATH_TEST_CONSOLE:-}" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR="${DOCKER_TRUSTED_HARNESS_CONTAINER_DIR}/scripts" \
  -e OMNIPOLYMATH_LIVE_DOCKER_TRUSTED_HARNESS_DIR="$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR" \
  -e OMNIPOLYMATH_LIVE_CODEX_TRUSTED_HARNESS_DIR="$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR" \
  -e OMNIPOLYMATH_LIVE_CODEX_BIND="${OMNIPOLYMATH_LIVE_CODEX_BIND:-}" \
  -e OMNIPOLYMATH_LIVE_CODEX_BIND_MODEL="${OMNIPOLYMATH_LIVE_CODEX_BIND_MODEL:-}" \
  -e OMNIPOLYMATH_LIVE_CODEX_BIND_PROVIDER="${OMNIPOLYMATH_LIVE_CODEX_BIND_PROVIDER:-}" \
  -e OMNIPOLYMATH_LIVE_CODEX_BIND_REQUEST_TIMEOUT_MS="${OMNIPOLYMATH_LIVE_CODEX_BIND_REQUEST_TIMEOUT_MS:-}" \
  -e OMNIPOLYMATH_LIVE_CODEX_BIND_TIMEOUT_MS="${OMNIPOLYMATH_LIVE_CODEX_BIND_TIMEOUT_MS:-}" \
  -e OMNIPOLYMATH_LIVE_CODEX_TEST_FILES="${OMNIPOLYMATH_LIVE_CODEX_TEST_FILES:-}" \
  -e OMNIPOLYMATH_LIVE_TEST=1 \
  -e OMNIPOLYMATH_VITEST_FS_MODULE_CACHE=0)
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_AUTH_ENV
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_EXTRA_ENV_FILES
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_TRUSTED_HARNESS_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.omnipolymath \
  -v "$WORKSPACE_DIR":/home/node/.omnipolymath/workspace)
if [[ "$CODEX_HARNESS_AUTH_MODE" != "api-key" ]]; then
  DOCKER_RUN_ARGS+=(\
    -v "$CACHE_HOME_DIR":"$DOCKER_CACHE_CONTAINER_DIR" \
    -v "$CLI_TOOLS_DIR":"$DOCKER_CLI_TOOLS_CONTAINER_DIR")
fi
omnipolymath_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
omnipolymath_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
if [[ "${OMNIPOLYMATH_LIVE_CODEX_HARNESS_DEBUG:-}" == "1" ]]; then
  echo "==> Docker debug: host ids and mounted dirs"
  id
  ls -ld "$CACHE_HOME_DIR" "$CLI_TOOLS_DIR" "${DOCKER_HOME_DIR:-$HOME}" 2>/dev/null || true
  printf '==> Docker debug args:'
  printf ' %q' "${DOCKER_RUN_ARGS[@]}"
  printf '\n'
fi
"${DOCKER_RUN_ARGS[@]}"
