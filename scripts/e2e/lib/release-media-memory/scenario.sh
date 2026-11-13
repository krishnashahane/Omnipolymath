#!/usr/bin/env bash
set -euo pipefail
trap "" PIPE
export TERM=xterm-256color
export NO_COLOR=1

source scripts/lib/omnipolymath-e2e-instance.sh

source scripts/e2e/lib/release-scenarios/setup.sh
export OPENAI_API_KEY="sk-omnipolymath-release-media-memory"
export OMNIPOLYMATH_QA_ALLOW_LOCAL_IMAGE_PROVIDER=1

PORT="18789"
MOCK_PORT="44200"
SUCCESS_MARKER="OMNIPOLYMATH_E2E_OK_MEDIA_MEMORY"
MEMORY_MARKER="release-media-memory-saffron-$(date +%s)"
media_root="$(mktemp -d /tmp/omnipolymath-release-media-memory.XXXXXX)"
omnipolymath_release_scenario_logs \
  INSTALL_LOG "$media_root/install.log" \
  ONBOARD_LOG "$media_root/onboard.log" \
  ENV_LOG "$media_root/env.log" \
  CONFIG_JSON "$media_root/config.json" \
  PACKAGE_FILES_LOG "$media_root/package-files.log" \
  PLUGINS_JSON "$media_root/plugins.json" \
  PLUGINS_STDERR_LOG "$media_root/plugins.stderr.log" \
  MOCK_OPENAI_LOG "$media_root/openai.log" \
  MOCK_REQUEST_LOG "$media_root/openai-requests.jsonl" \
  DESCRIBE_JSON "$media_root/describe.json" \
  DESCRIBE_STDERR_LOG "$media_root/describe.stderr.log" \
  GENERATE_JSON "$media_root/generate.json" \
  GENERATE_STDERR_LOG "$media_root/generate.stderr.log" \
  INDEX_LOG "$media_root/index.log" \
  SEARCH_BEFORE_JSON "$media_root/search-before.json" \
  SEARCH_BEFORE_STDERR_LOG "$media_root/search-before.stderr.log" \
  SEARCH_AFTER_JSON "$media_root/search-after.json" \
  SEARCH_AFTER_STDERR_LOG "$media_root/search-after.stderr.log" \
  GATEWAY_1_LOG "$media_root/gateway-1.log" \
  GATEWAY_2_LOG "$media_root/gateway-2.log"
export SUCCESS_MARKER MOCK_REQUEST_LOG

mock_pid=""
gateway_pid=""
cleanup() {
  omnipolymath_e2e_terminate_gateways "${gateway_pid:-}"
  omnipolymath_e2e_stop_process "${mock_pid:-}"
  if [ -n "${media_root:-}" ]; then
    rm -rf "$media_root"
  fi
}
trap cleanup EXIT

dump_debug_logs() {
  local status="$1"
  echo "release media memory failed with exit code $status" >&2
  omnipolymath_e2e_dump_logs "${OMNIPOLYMATH_RELEASE_DIAGNOSTIC_LOGS[@]}"
}
omnipolymath_e2e_enable_failure_diagnostics

omnipolymath_e2e_install_package "$INSTALL_LOG"
command -v omnipolymath >/dev/null
package_root="$(omnipolymath_e2e_package_root)"
entry="$(omnipolymath_e2e_package_entrypoint "$package_root")"
{
  printf 'omnipolymath=%s\n' "$(command -v omnipolymath)"
  printf 'package_root=%s\n' "$package_root"
  printf 'entry=%s\n' "$entry"
  printf 'HOME=%s\n' "$HOME"
  printf 'OMNIPOLYMATH_HOME=%s\n' "$OMNIPOLYMATH_HOME"
  printf 'OMNIPOLYMATH_STATE_DIR=%s\n' "$OMNIPOLYMATH_STATE_DIR"
  printf 'OMNIPOLYMATH_CONFIG_PATH=%s\n' "$OMNIPOLYMATH_CONFIG_PATH"
} >"$ENV_LOG"
omnipolymath_e2e_enable_omnipolymath_cli_timeout
(
  cd "$package_root/dist/extensions/memory-core"
  find . -type f | sed 's#^\./##' | sort
) >"$PACKAGE_FILES_LOG"

mock_pid="$(omnipolymath_e2e_start_mock_openai "$MOCK_PORT" "$MOCK_OPENAI_LOG")"
omnipolymath_e2e_wait_mock_openai "$MOCK_PORT"

omnipolymath_release_onboard "$PORT" omnipolymath >"$ONBOARD_LOG" 2>&1
cp "$OMNIPOLYMATH_CONFIG_PATH" "$CONFIG_JSON"
omnipolymath plugins list --json >"$PLUGINS_JSON" 2>"$PLUGINS_STDERR_LOG"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-file-contains "$PLUGINS_JSON" memory-core
node scripts/e2e/lib/release-scenarios/assertions.mjs configure-mock-openai "$MOCK_PORT"

mkdir -p "$OMNIPOLYMATH_STATE_DIR/workspace/memory"
printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yf7kAAAAASUVORK5CYII=' | base64 -d >"$media_root/input.png"

omnipolymath infer image describe \
  --file "$media_root/input.png" \
  --model openai/gpt-5.6-luna \
  --prompt "Describe this image and return marker $SUCCESS_MARKER" \
  --json >"$DESCRIBE_JSON" 2>"$DESCRIBE_STDERR_LOG"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-image-describe "$DESCRIBE_JSON" "$MOCK_REQUEST_LOG"

omnipolymath infer image generate \
  --model openai/gpt-image-1 \
  --prompt "Generate a tiny test image for $SUCCESS_MARKER" \
  --output "$media_root/generated.png" \
  --json >"$GENERATE_JSON" 2>"$GENERATE_STDERR_LOG"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-image-generate "$GENERATE_JSON" "$MOCK_REQUEST_LOG"

cat >"$OMNIPOLYMATH_STATE_DIR/workspace/MEMORY.md" <<EOF
# Long-term memory

- The release media memory marker is $MEMORY_MARKER.
EOF

omnipolymath memory index --force >"$INDEX_LOG" 2>&1
omnipolymath memory search "$MEMORY_MARKER" --json >"$SEARCH_BEFORE_JSON" 2>"$SEARCH_BEFORE_STDERR_LOG"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-memory-search "$SEARCH_BEFORE_JSON" "$MEMORY_MARKER"

start_gateway "$GATEWAY_1_LOG"
stop_gateway
start_gateway "$GATEWAY_2_LOG"
omnipolymath memory search "$MEMORY_MARKER" --json >"$SEARCH_AFTER_JSON" 2>"$SEARCH_AFTER_STDERR_LOG"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-memory-search "$SEARCH_AFTER_JSON" "$MEMORY_MARKER"
stop_gateway

echo "Release media memory scenario passed."
