#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"
source "$ROOT_DIR/scripts/lib/frozen-target-compat.sh"

TARGET_ROOT_DIR="$(cd "${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}" && pwd)"
CODEX_ASSERTIONS="$(omnipolymath_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/codex-on-demand/assertions.mjs \
  "$ROOT_DIR/scripts/e2e/lib/codex-on-demand/assertions.mjs")"
CODEX_DOCTOR_CHECKS="$(omnipolymath_resolve_frozen_target_file "$TARGET_ROOT_DIR" \
  scripts/e2e/lib/codex-on-demand/doctor-checks.mjs \
  "$ROOT_DIR/scripts/e2e/lib/codex-on-demand/doctor-checks.mjs" \
  "")"
CODEX_DOCTOR_CHECKS_ENABLED=0
if [ -n "$CODEX_DOCTOR_CHECKS" ]; then
  CODEX_DOCTOR_CHECKS_ENABLED=1
fi

IMAGE_NAME="$(docker_e2e_resolve_image "omnipolymath-codex-on-demand-e2e" OMNIPOLYMATH_CODEX_ON_DEMAND_E2E_IMAGE)"
DOCKER_TARGET="${OMNIPOLYMATH_CODEX_ON_DEMAND_DOCKER_TARGET:-bare}"
HOST_BUILD="${OMNIPOLYMATH_CODEX_ON_DEMAND_HOST_BUILD:-1}"
PACKAGE_TGZ="${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:-}"
AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT=""
run_log=""

# This lane installs the package and then exercises a managed npm install of Codex.
# Keep the package install budget above the shared default so slow npm hosts reach
# the Codex assertions instead of failing as a silent package-install timeout.
export OMNIPOLYMATH_E2E_NPM_INSTALL_TIMEOUT="${OMNIPOLYMATH_E2E_NPM_INSTALL_TIMEOUT:-1200s}"

cleanup() {
  if [ -n "${PACKAGE_TGZ:-}" ]; then
    docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  fi
  if [ -n "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" ]; then
    rm -rf "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT"
  fi
  if [ -n "${run_log:-}" ]; then
    rm -f "$run_log"
  fi
}
trap cleanup EXIT

docker_e2e_build_or_reuse "$IMAGE_NAME" codex-on-demand "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "$DOCKER_TARGET"

if [ -z "$PACKAGE_TGZ" ] && [ "$HOST_BUILD" = "0" ] && [ -z "${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:-}" ]; then
  echo "OMNIPOLYMATH_CODEX_ON_DEMAND_HOST_BUILD=0 requires OMNIPOLYMATH_CURRENT_PACKAGE_TGZ" >&2
  exit 1
fi
PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz codex-on-demand "$PACKAGE_TGZ")"

if [ -z "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ] &&
  [ -z "${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:-}" ] &&
  [ "$HOST_BUILD" != "0" ]; then
  AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT="$(
    mktemp -d "${TMPDIR:-/tmp}/omnipolymath-codex-on-demand-plugin-registry.XXXXXX"
  )"
  OMNIPOLYMATH_DOCKER_ALL_LANES=codex-on-demand \
    OMNIPOLYMATH_DOCKER_ALL_LOG_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" \
    OMNIPOLYMATH_DOCKER_ALL_TIMINGS=0 \
    node "$ROOT_DIR/scripts/test-docker-all.mjs" --prepare-plugin-registry >/dev/null
  export OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT/prepublish-plugin-registry"
fi

docker_e2e_package_mount_args "$PACKAGE_TGZ"
run_log="$(docker_e2e_run_log codex-on-demand)"
OMNIPOLYMATH_TEST_STATE_SCRIPT_B64="$(docker_e2e_test_state_shell_b64 codex-on-demand empty)"
CODEX_CONTRACT_MOUNT_ARGS=(
  -v "$CODEX_ASSERTIONS:/app/scripts/e2e/lib/codex-on-demand/assertions.mjs:ro"
)
if [ -n "$CODEX_DOCTOR_CHECKS" ]; then
  CODEX_CONTRACT_MOUNT_ARGS+=(
    -v "$CODEX_DOCTOR_CHECKS:/app/scripts/e2e/lib/codex-on-demand/doctor-checks.mjs:ro"
  )
fi

echo "Running Codex on-demand Docker E2E..."
if ! docker_e2e_run_with_harness \
  -v "${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}/extensions/codex/package.json:/tmp/omnipolymath-candidate-codex-package.json:ro" \
  "${CODEX_CONTRACT_MOUNT_ARGS[@]}" \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e "OMNIPOLYMATH_CODEX_DOCTOR_CHECKS_ENABLED=$CODEX_DOCTOR_CHECKS_ENABLED" \
  -e "OMNIPOLYMATH_TEST_STATE_SCRIPT_B64=$OMNIPOLYMATH_TEST_STATE_SCRIPT_B64" \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -i "$IMAGE_NAME" bash -s >"$run_log" 2>&1 <<'EOF'; then
set -euo pipefail

source scripts/lib/omnipolymath-e2e-instance.sh
source scripts/e2e/lib/prepublish-plugin-registry.sh
omnipolymath_e2e_eval_test_state_from_b64 "${OMNIPOLYMATH_TEST_STATE_SCRIPT_B64:?missing OMNIPOLYMATH_TEST_STATE_SCRIPT_B64}"
export NPM_CONFIG_PREFIX="$HOME/.npm-global"
export npm_config_prefix="$NPM_CONFIG_PREFIX"
export XDG_CACHE_HOME="${XDG_CACHE_HOME:-$HOME/.cache}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-$XDG_CACHE_HOME/npm}"
export npm_config_cache="$NPM_CONFIG_CACHE"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
export OPENAI_API_KEY="sk-omnipolymath-codex-on-demand-e2e"

dump_debug_logs() {
  local status="$1"
  echo "Codex on-demand scenario failed with exit code $status" >&2
  omnipolymath_e2e_dump_logs \
    /tmp/omnipolymath-install.log \
    /tmp/omnipolymath-codex-plugin-install.log \
    /tmp/omnipolymath-codex-registry/server.log \
    /tmp/omnipolymath-onboard.json \
    /tmp/omnipolymath-plugins-list.json \
    /tmp/omnipolymath-codex-inspect.json
}
trap 'status=$?; dump_debug_logs "$status"; exit "$status"' ERR

plugin_registry_pid=""
cleanup_inner() {
  omnipolymath_e2e_stop_process "${plugin_registry_pid:-}"
}
trap cleanup_inner EXIT

mkdir -p "$NPM_CONFIG_PREFIX" "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE"
chmod 700 "$XDG_CACHE_HOME" "$NPM_CONFIG_CACHE" || true

omnipolymath_e2e_install_package /tmp/omnipolymath-install.log
command -v omnipolymath >/dev/null
omnipolymath_e2e_enable_omnipolymath_cli_timeout

omnipolymath_e2e_assert_dep_absent "@omnipolymath/codex" "$HOME/.omnipolymath" "$NPM_CONFIG_PREFIX"
omnipolymath_e2e_assert_dep_absent "@openai/codex" "$HOME/.omnipolymath" "$NPM_CONFIG_PREFIX"

omnipolymath_prepublish_plugin_registry_start_mounted \
  /tmp/omnipolymath-codex-registry plugin_registry_pid '["@omnipolymath/codex"]'

# Non-interactive onboarding cannot grant capabilities. Use the shared fixture
# consent flow and the exact companion when testing an unpublished candidate.
codex_install_args=("@omnipolymath/codex")
if [ -n "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  codex_install_args=("npm:@omnipolymath/codex@${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_CANDIDATE_VERSION:?missing candidate version}" --pin)
fi
echo "Installing Codex on demand with explicit capability consent..."
omnipolymath_e2e_fixture_plugin_command omnipolymath -- plugins install "${codex_install_args[@]}" \
  >/tmp/omnipolymath-codex-plugin-install.log 2>&1

echo "Running non-interactive OpenAI onboarding with the accepted Codex plugin..."
omnipolymath onboard --non-interactive --accept-risk \
  --mode local \
  --auth-choice openai-api-key \
  --secret-input-mode ref \
  --skip-daemon \
  --skip-ui \
  --skip-channels \
  --skip-skills \
  --skip-health \
  --json >/tmp/omnipolymath-onboard.json

omnipolymath plugins list --json >/tmp/omnipolymath-plugins-list.json
omnipolymath plugins inspect codex --runtime --json >/tmp/omnipolymath-codex-inspect.json
node scripts/e2e/lib/codex-on-demand/assertions.mjs
if [ "$OMNIPOLYMATH_CODEX_DOCTOR_CHECKS_ENABLED" = "1" ]; then
  node scripts/e2e/lib/codex-on-demand/doctor-checks.mjs
fi

echo "Codex on-demand Docker E2E passed"
EOF
  docker_e2e_print_log "$run_log"
  exit 1
fi

docker_e2e_print_log "$run_log"
echo "Codex on-demand Docker E2E passed"
