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
DEFAULT_PROVIDER="${OMNIPOLYMATH_DOCKER_CLI_BACKEND_PROVIDER:-claude-cli}"
CLI_MODEL="${OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL:-}"
CLI_PROVIDER="${CLI_MODEL%%/*}"
CLI_DISABLE_MCP_CONFIG="${OMNIPOLYMATH_LIVE_CLI_BACKEND_DISABLE_MCP_CONFIG:-}"
CLI_AUTH_MODE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH:-auto}"
CLI_SETUP_TIMEOUT_SECONDS="$(omnipolymath_live_read_positive_int_env OMNIPOLYMATH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS 180)"
DOCKER_EXTRA_ENV_FILES=()
DOCKER_AUTH_PRESTAGED=0
DOCKER_TRUSTED_HARNESS_CONTAINER_DIR="/trusted-harness"
DOCKER_TRUSTED_HARNESS_MOUNT=(-v "$TRUSTED_HARNESS_DIR":"$DOCKER_TRUSTED_HARNESS_CONTAINER_DIR":ro)

if [[ -z "$CLI_PROVIDER" || "$CLI_PROVIDER" == "$CLI_MODEL" ]]; then
  CLI_PROVIDER="$DEFAULT_PROVIDER"
fi
if [[ -f "$PROFILE_FILE" && -r "$PROFILE_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$PROFILE_FILE"
  set +a
fi

case "$CLI_AUTH_MODE" in
  auto | api-key | subscription)
    ;;
  *)
    echo "ERROR: OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH must be one of: auto, api-key, subscription." >&2
    exit 1
    ;;
esac

if [[ "$CLI_AUTH_MODE" == "subscription" && "$CLI_PROVIDER" != "claude-cli" ]]; then
  echo "ERROR: OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH=subscription is only supported for claude-cli." >&2
  exit 1
fi

if [[ "$CLI_PROVIDER" == "codex-cli" ]]; then
  echo "ERROR: codex-cli is no longer a bundled CLI backend. Use openai/* with the Codex app-server runtime instead." >&2
  exit 1
fi

CLI_METADATA_JSON="$(node --import tsx "$ROOT_DIR/scripts/print-cli-backend-live-metadata.ts" "$CLI_PROVIDER")"
read_metadata_field() {
  local field="$1"
  node -e 'const data = JSON.parse(process.argv[1]); const field = process.argv[2]; const value = data?.[field]; if (value == null) process.exit(1); process.stdout.write(typeof value === "string" ? value : JSON.stringify(value));' \
    "$CLI_METADATA_JSON" \
    "$field"
}

DEFAULT_MODEL="$(read_metadata_field defaultModelRef 2>/dev/null || printf '%s' 'claude-cli/claude-sonnet-4-6')"
CLI_MODEL="${CLI_MODEL:-$DEFAULT_MODEL}"
CLI_DEFAULT_COMMAND="$(read_metadata_field command 2>/dev/null || true)"
CLI_DOCKER_NPM_PACKAGE="$(read_metadata_field dockerNpmPackage 2>/dev/null || true)"
CLI_DOCKER_BINARY_NAME="$(read_metadata_field dockerBinaryName 2>/dev/null || true)"

if [[ "$CLI_PROVIDER" == "claude-cli" && -z "$CLI_DISABLE_MCP_CONFIG" ]]; then
  if [[ "$CLI_AUTH_MODE" == "subscription" ]]; then
    CLI_DISABLE_MCP_CONFIG="1"
  else
    CLI_DISABLE_MCP_CONFIG="0"
  fi
fi
export OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE:-0}"
export OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_PROBE:-0}"
export OMNIPOLYMATH_LIVE_CLI_BACKEND_MCP_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_MCP_PROBE:-0}"

omnipolymath_live_init_temp_dirs
omnipolymath_live_init_cli_tools_dir
omnipolymath_live_init_cache_home_dir
omnipolymath_live_init_managed_home

if [[ "$CLI_PROVIDER" == "claude-cli" && "$CLI_AUTH_MODE" == "subscription" ]]; then
  CLAUDE_CREDS_FILE="$HOME/.claude/.credentials.json"
  CLAUDE_SUBSCRIPTION_AUTH_SOURCE=""
  CLAUDE_SUBSCRIPTION_TYPE=""
  if [[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]]; then
    CLAUDE_SUBSCRIPTION_TYPE="oauth-token"
    CLAUDE_SUBSCRIPTION_AUTH_SOURCE="env-token"
  elif [[ -f "$CLAUDE_CREDS_FILE" ]]; then
    CLAUDE_SUBSCRIPTION_TYPE="$(
      node -e '
        const fs = require("node:fs");
        const file = process.argv[1];
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        const subscriptionType = String(data?.claudeAiOauth?.subscriptionType ?? "").trim();
        if (!subscriptionType || subscriptionType === "unknown") process.exit(2);
        process.stdout.write(subscriptionType);
      ' "$CLAUDE_CREDS_FILE" 2>/dev/null
    )" || {
      echo "ERROR: $CLAUDE_CREDS_FILE does not look like Claude subscription OAuth auth." >&2
      echo "Expected claudeAiOauth.subscriptionType to be present." >&2
      exit 1
    }
    CLAUDE_SUBSCRIPTION_AUTH_SOURCE="credentials-file"
  else
    echo "ERROR: Claude subscription auth requires either:" >&2
    echo "  - $CLAUDE_CREDS_FILE with claudeAiOauth.subscriptionType, or" >&2
    echo "  - CLAUDE_CODE_OAUTH_TOKEN from 'claude setup-token'." >&2
    exit 1
  fi
  if [[ -z "${OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV:-}" ]]; then
    if [[ "$CLAUDE_SUBSCRIPTION_AUTH_SOURCE" == "env-token" ]]; then
      export OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV='["CLAUDE_CODE_OAUTH_TOKEN"]'
    else
      export OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV="[]"
    fi
  fi
  if [[ "$OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV" == *ANTHROPIC_API_KEY* ]]; then
    echo "ERROR: subscription auth smoke must not preserve Anthropic API-key env vars." >&2
    exit 1
  fi
  if [[ "$CLAUDE_SUBSCRIPTION_AUTH_SOURCE" == "env-token" && "$OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV" != *CLAUDE_CODE_OAUTH_TOKEN* ]]; then
    echo "ERROR: CLAUDE_CODE_OAUTH_TOKEN subscription smoke must preserve CLAUDE_CODE_OAUTH_TOKEN for the Gateway child process." >&2
    exit 1
  fi
  export OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL_SWITCH_PROBE:-0}"
  export OMNIPOLYMATH_LIVE_CLI_BACKEND_RESUME_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_RESUME_PROBE:-1}"
  export OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_IMAGE_PROBE:-0}"
  export OMNIPOLYMATH_LIVE_CLI_BACKEND_MCP_PROBE="${OMNIPOLYMATH_LIVE_CLI_BACKEND_MCP_PROBE:-0}"
fi

omnipolymath_live_init_profile_mount

ensure_live_build_extension() {
  local extension="$1"
  local current="${OMNIPOLYMATH_DOCKER_BUILD_EXTENSIONS:-${OMNIPOLYMATH_EXTENSIONS:-}}"
  case " ${current//,/ } " in
    *" $extension "*) ;;
    *) export OMNIPOLYMATH_DOCKER_BUILD_EXTENSIONS="${current:+$current }$extension" ;;
  esac
}

if [[ "$CLI_PROVIDER" == "claude-cli" ]]; then
  ensure_live_build_extension anthropic
fi

omnipolymath_live_collect_auth_for_providers "$CLI_PROVIDER"
if [[ "${CLAUDE_SUBSCRIPTION_AUTH_SOURCE:-}" == "env-token" ]]; then
  retained_auth_files=()
  for auth_file in ${AUTH_FILES[@]+"${AUTH_FILES[@]}"}; do
    case "$auth_file" in
      .claude.json | .claude/.credentials.json) ;;
      *) retained_auth_files+=("$auth_file") ;;
    esac
  done
  AUTH_FILES=(${retained_auth_files[@]+"${retained_auth_files[@]}"})
fi
omnipolymath_live_finalize_auth_mounts

read -r -d '' LIVE_TEST_CMD <<'EOF' || true
set -euo pipefail
[ -f "$HOME/.profile" ] && [ -r "$HOME/.profile" ] && source "$HOME/.profile" || true
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.npm-global}"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
trusted_scripts_dir="${OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR:-/src/scripts}"
source "$trusted_scripts_dir/lib/live-docker-stage.sh"
mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$COREPACK_HOME" "$NPM_CONFIG_CACHE" || true
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
omnipolymath_live_stage_mounted_auth
provider="${OMNIPOLYMATH_DOCKER_CLI_BACKEND_PROVIDER:-claude-cli}"
default_command="${OMNIPOLYMATH_DOCKER_CLI_BACKEND_COMMAND_DEFAULT:-}"
docker_package="${OMNIPOLYMATH_DOCKER_CLI_BACKEND_NPM_PACKAGE:-}"
binary_name="${OMNIPOLYMATH_DOCKER_CLI_BACKEND_BINARY_NAME:-}"
if [ -z "$binary_name" ] && [ -n "$default_command" ]; then
  binary_name="$(basename "$default_command")"
fi
if [ -z "${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND:-}" ] && [ -n "$binary_name" ]; then
  export OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND="$NPM_CONFIG_PREFIX/bin/$binary_name"
fi
omnipolymath_live_prepare_cli_backend \
  "${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND:?missing CLI backend command}" \
  "$docker_package" "$OMNIPOLYMATH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS"
if [ -n "${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND:-}" ] && [ -x "${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND}" ]; then
  echo "==> CLI backend binary: ${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND}"
  "${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND}" -V || "${OMNIPOLYMATH_LIVE_CLI_BACKEND_COMMAND}" --version || true
fi
if [ "$provider" = "google-gemini-cli" ]; then
  omnipolymath_live_stage_gemini_auth
fi
if [ "$provider" = "claude-cli" ]; then
  auth_mode="${OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH:-auto}"
  if [ "$auth_mode" = "subscription" ]; then
    unset ANTHROPIC_API_KEY
    unset ANTHROPIC_API_KEY_OLD
    unset ANTHROPIC_API_TOKEN
    unset ANTHROPIC_AUTH_TOKEN
    unset ANTHROPIC_OAUTH_TOKEN
    node - <<'NODE'
const fs = require("node:fs");
const file = `${process.env.HOME}/.claude/.credentials.json`;
if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) {
  console.error("[claude-subscription] using CLAUDE_CODE_OAUTH_TOKEN from environment");
} else if (fs.existsSync(file)) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const subscriptionType = String(data?.claudeAiOauth?.subscriptionType ?? "").trim();
  if (!subscriptionType || subscriptionType === "unknown") {
    throw new Error("Claude subscription OAuth credentials are missing subscriptionType.");
  }
  console.error(`[claude-subscription] subscriptionType=${subscriptionType}`);
} else {
  throw new Error("Claude subscription OAuth token or credentials file is required.");
}
NODE
  fi
  real_claude="$NPM_CONFIG_PREFIX/bin/claude-real"
  if [ ! -x "$real_claude" ] && [ -x "$NPM_CONFIG_PREFIX/bin/claude" ]; then
    mv "$NPM_CONFIG_PREFIX/bin/claude" "$real_claude"
  fi
  if [ -x "$real_claude" ]; then
    cat > "$NPM_CONFIG_PREFIX/bin/claude" <<WRAP
#!/usr/bin/env bash
script_dir="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
if [ -n "\${OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY:-}" ]; then
  export ANTHROPIC_API_KEY="\${OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY}"
fi
if [ -n "\${OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD:-}" ]; then
  export ANTHROPIC_API_KEY_OLD="\${OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD}"
fi
exec "\$script_dir/claude-real" "\$@"
WRAP
    chmod +x "$NPM_CONFIG_PREFIX/bin/claude"
  fi
  if [ -z "${OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV:-}" ]; then
    export OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV='["ANTHROPIC_API_KEY","ANTHROPIC_API_KEY_OLD"]'
  fi
  if [ "$auth_mode" = "subscription" ]; then
    claude --version
    direct_probe_log="$(mktemp)"
    set +e
    claude \
      -p "This is a local CLI smoke test. What is two plus two? Reply with only the result." \
      --output-format text \
      --model sonnet \
      --permission-mode bypassPermissions \
      --setting-sources user \
      --strict-mcp-config \
      --mcp-config '{"mcpServers":{}}' \
      --no-session-persistence >"$direct_probe_log" 2>&1
    direct_probe_status=$?
    set -e
    print_redacted_direct_probe_log() {
      sed -E \
        -e 's/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/<redacted-email>/g' \
        -e 's/(sk-ant-|sk-)[A-Za-z0-9_-]+/<redacted-secret>/g' \
        "$direct_probe_log" >&2
    }
    if [ "$direct_probe_status" -ne 0 ]; then
      echo "ERROR: direct Claude subscription probe exited with status $direct_probe_status." >&2
      print_redacted_direct_probe_log
      rm -f "$direct_probe_log"
      exit "$direct_probe_status"
    fi
    if ! grep -Eiq '(^|[^[:alnum:]])(4|four)([^[:alnum:]]|$)' "$direct_probe_log"; then
      echo "ERROR: direct Claude subscription probe did not return the expected arithmetic result." >&2
      print_redacted_direct_probe_log
      rm -f "$direct_probe_log"
      exit 1
    fi
    rm -f "$direct_probe_log"
    echo "[claude-subscription] direct claude -p probe ok"
  else
    claude auth status || true
  fi
fi
tmp_dir="$(mktemp -d)"
omnipolymath_live_stage_workspace "$tmp_dir"
cd "$tmp_dir"
omnipolymath_live_run_staged_script scripts/test-live -- src/gateway/gateway-cli-backend.live.test.ts
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

echo "==> Run CLI backend live test in Docker"
echo "==> Model: $CLI_MODEL"
echo "==> Provider: $CLI_PROVIDER"
echo "==> Auth mode: $CLI_AUTH_MODE"
echo "==> Setup timeout: ${CLI_SETUP_TIMEOUT_SECONDS}s"
echo "==> Profile file: $PROFILE_STATUS"
if [[ "$CLI_PROVIDER" == "claude-cli" && "$CLI_AUTH_MODE" == "subscription" ]]; then
  echo "==> Claude subscription: $CLAUDE_SUBSCRIPTION_TYPE"
  echo "==> Claude subscription source: $CLAUDE_SUBSCRIPTION_AUTH_SOURCE"
fi
echo "==> External auth dirs: ${AUTH_DIRS_CSV:-none}"
echo "==> External auth files: ${AUTH_FILES_CSV:-none}"
DOCKER_AUTH_ENV=(
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND_AUTH="$CLI_AUTH_MODE"
)
if [[ "$CLI_PROVIDER" == "claude-cli" && "$CLI_AUTH_MODE" == "subscription" ]]; then
  DOCKER_AUTH_ENV+=(
    -e CLAUDE_CODE_OAUTH_TOKEN="${CLAUDE_CODE_OAUTH_TOKEN:-}"
    -e OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV="$OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV"
  )
else
  DOCKER_AUTH_ENV+=(
    -e ANTHROPIC_API_KEY
    -e ANTHROPIC_API_KEY_OLD
    -e OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}"
    -e OMNIPOLYMATH_LIVE_CLI_BACKEND_ANTHROPIC_API_KEY_OLD="${ANTHROPIC_API_KEY_OLD:-}"
    -e OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV="${OMNIPOLYMATH_LIVE_CLI_BACKEND_PRESERVE_ENV:-}"
  )
fi

DOCKER_RUN_ARGS=()
omnipolymath_live_init_docker_run_args DOCKER_RUN_ARGS "${OMNIPOLYMATH_LIVE_CLI_BACKEND_DOCKER_RUN_TIMEOUT:-2700s}"
DOCKER_RUN_ARGS+=(--rm -t \
  -u "$DOCKER_USER" \
  --entrypoint bash \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e HOME=/home/node \
  -e NODE_OPTIONS="$(omnipolymath_live_container_node_options)" \
  -e OMNIPOLYMATH_SKIP_CHANNELS=1 \
  -e OMNIPOLYMATH_VITEST_FS_MODULE_CACHE=0 \
  -e OMNIPOLYMATH_DOCKER_AUTH_PRESTAGED="$DOCKER_AUTH_PRESTAGED" \
  -e OMNIPOLYMATH_DOCKER_AUTH_DIRS_RESOLVED="$AUTH_DIRS_CSV" \
  -e OMNIPOLYMATH_DOCKER_AUTH_FILES_RESOLVED="$AUTH_FILES_CSV" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SCRIPTS_DIR="${DOCKER_TRUSTED_HARNESS_CONTAINER_DIR}/scripts" \
  -e OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE="${OMNIPOLYMATH_LIVE_DOCKER_SOURCE_STAGE_MODE:-copy}" \
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND_SETUP_TIMEOUT_SECONDS="$CLI_SETUP_TIMEOUT_SECONDS" \
  -e OMNIPOLYMATH_DOCKER_CLI_BACKEND_PROVIDER="$CLI_PROVIDER" \
  -e OMNIPOLYMATH_DOCKER_CLI_BACKEND_COMMAND_DEFAULT="$CLI_DEFAULT_COMMAND" \
  -e OMNIPOLYMATH_DOCKER_CLI_BACKEND_NPM_PACKAGE="$CLI_DOCKER_NPM_PACKAGE" \
  -e OMNIPOLYMATH_DOCKER_CLI_BACKEND_BINARY_NAME="$CLI_DOCKER_BINARY_NAME" \
  -e OMNIPOLYMATH_LIVE_TEST=1 \
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND=1 \
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND_DEBUG="${OMNIPOLYMATH_LIVE_CLI_BACKEND_DEBUG:-}" \
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND_ADVISORY="${OMNIPOLYMATH_LIVE_CLI_BACKEND_ADVISORY:-}" \
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND_ALLOW_PROVIDER_SKIP="${OMNIPOLYMATH_LIVE_CLI_BACKEND_ALLOW_PROVIDER_SKIP:-}" \
  -e OMNIPOLYMATH_CLI_BACKEND_LOG_OUTPUT="${OMNIPOLYMATH_CLI_BACKEND_LOG_OUTPUT:-}" \
  -e OMNIPOLYMATH_TEST_CONSOLE="${OMNIPOLYMATH_TEST_CONSOLE:-}" \
  -e OMNIPOLYMATH_LIVE_CLI_BACKEND_MODEL="$CLI_MODEL")
omnipolymath_live_append_default_env OMNIPOLYMATH_LIVE_CLI_BACKEND_ \
  COMMAND= ARGS= RESUME_ARGS= CLEAR_ENV=
DOCKER_RUN_ARGS+=(-e OMNIPOLYMATH_LIVE_CLI_BACKEND_DISABLE_MCP_CONFIG="$CLI_DISABLE_MCP_CONFIG")
omnipolymath_live_append_default_env OMNIPOLYMATH_LIVE_CLI_BACKEND_ \
  CACHE_PROBE= RESUME_PROBE= MODEL_SWITCH_PROBE= IMAGE_PROBE= MCP_PROBE= \
  MCP_SCHEMA_PROBE= IMAGE_ARG= IMAGE_MODE=
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_HOME_MOUNT
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_EXTRA_ENV_FILES
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_TRUSTED_HARNESS_MOUNT
DOCKER_RUN_ARGS+=(\
  -v "$CACHE_HOME_DIR":/home/node/.cache \
  -v "$ROOT_DIR":/src:ro \
  -v "$CONFIG_DIR":/home/node/.omnipolymath \
  -v "$WORKSPACE_DIR":/home/node/.omnipolymath/workspace \
  -v "$CLI_TOOLS_DIR":/home/node/.npm-global)
omnipolymath_live_append_array DOCKER_RUN_ARGS EXTERNAL_AUTH_MOUNTS
omnipolymath_live_append_array DOCKER_RUN_ARGS DOCKER_AUTH_ENV
omnipolymath_live_append_array DOCKER_RUN_ARGS PROFILE_MOUNT
DOCKER_RUN_ARGS+=(\
  "$LIVE_IMAGE_NAME" \
  -lc "$LIVE_TEST_CMD")
"${DOCKER_RUN_ARGS[@]}"
