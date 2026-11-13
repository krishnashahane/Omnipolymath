#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/omnipolymath-e2e-instance.sh
source scripts/lib/docker-e2e-logs.sh
OMNIPOLYMATH_PLUGINS_SWEEP_SOURCE_ONLY="${OMNIPOLYMATH_PLUGINS_SWEEP_SOURCE_ONLY:-0}"
if [[ -z "${OMNIPOLYMATH_ENTRY:-}" && "$OMNIPOLYMATH_PLUGINS_SWEEP_SOURCE_ONLY" != "1" ]]; then
  OMNIPOLYMATH_ENTRY="$(omnipolymath_e2e_resolve_entrypoint)"
fi
export OMNIPOLYMATH_ENTRY
OMNIPOLYMATH_PLUGINS_CREATED_TMP_DIR=0
if [[ -z "${OMNIPOLYMATH_PLUGINS_TMP_DIR:-}" ]]; then
  OMNIPOLYMATH_PLUGINS_TMP_DIR="$(mktemp -d "/tmp/omnipolymath-plugins.XXXXXX")"
  OMNIPOLYMATH_PLUGINS_CREATED_TMP_DIR=1
fi
export OMNIPOLYMATH_PLUGINS_TMP_DIR
OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT="${OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT:-180s}"
mkdir -p "$OMNIPOLYMATH_PLUGINS_TMP_DIR"

# Redact complete stderr before truncation so a split credential can never expose its suffix.
print_plugins_stderr_log() {
  local error_file="$1"
  local redacted_file
  redacted_file="$(mktemp "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-redacted.XXXXXX")" || return $?
  local status=0
  sed -E \
    -e 's/[Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+[^[:space:]]+/Bearer [REDACTED]/g' \
    -e 's/(^|[^[:alnum:]_])(sk|sess|rk)-[[:alnum:]_-]+/\1[REDACTED]/g' \
    "$error_file" >"$redacted_file" || status=$?
  if [[ "$status" -eq 0 ]]; then
    docker_e2e_print_log "$redacted_file" >&2 || status=$?
  fi
  rm -f "$redacted_file"
  return "$status"
}

run_plugins_omnipolymath_logged() {
  local label="$1"
  shift
  run_plugins_command_output command "$label" "" omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" "$@"
}

run_plugins_fixture_logged() {
  local label="$1"
  shift
  run_plugins_command_output command "$label" "" omnipolymath_e2e_fixture_plugin_command omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" -- "$@"
}

run_plugins_omnipolymath_capture() {
  local output_file="$1"
  shift
  run_plugins_command_output capture "${output_file##*/}" "$output_file" omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" "$@"
}

run_plugins_command_output() {
  local mode="$1"
  local label="$2"
  local output_file="$3"
  shift 3
  if [[ "$mode" == "command" ]]; then
    output_file="$(mktemp "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-stdout.XXXXXX")" || return $?
  fi
  local error_file
  error_file="$(mktemp "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-stderr.XXXXXX")" || {
    local create_status=$?
    if [[ "$mode" == "command" ]]; then
      rm -f "$output_file"
    fi
    return "$create_status"
  }
  local status=0
  if "$@" >"$output_file" 2>"$error_file"; then
    if [[ "$mode" == "capture" ]] || docker_e2e_lifecycle_trace_enabled; then
      print_plugins_stderr_log "$error_file" || status=$?
    fi
  else
    status=$?
    if ! print_plugins_stderr_log "$error_file"; then
      printf 'Plugin sweep stderr redaction failed: %s\n' "$label" >&2
    fi
    if [[ "$status" -eq 124 ]]; then
      printf 'Plugin sweep %s timed out after %s: %s\n' \
        "$mode" "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" "$label" >&2
    else
      printf 'Plugin sweep %s failed with status %s: %s\n' \
        "$mode" "$status" "$label" >&2
    fi
  fi
  if [[ "$mode" == "command" ]]; then
    rm -f "$error_file" "$output_file"
  else
    rm -f "$error_file"
  fi
  return "$status"
}

run_plugins_shell_logged() {
  local label="$1"
  shift
  local command="$1"
  run_logged "$label" omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" bash -c "$command"
}

source scripts/e2e/lib/plugins/fixtures.sh
source scripts/e2e/lib/plugins/marketplace.sh
source scripts/e2e/lib/plugins/clawhub.sh

cleanup_omnipolymath_plugins_sweep() {
  omnipolymath_plugins_cleanup_fixture_servers
  if [[ "${OMNIPOLYMATH_PLUGINS_CREATED_TMP_DIR:-0}" = "1" ]]; then
    rm -rf "$OMNIPOLYMATH_PLUGINS_TMP_DIR"
  fi
}

if [[ "$OMNIPOLYMATH_PLUGINS_SWEEP_SOURCE_ONLY" = "1" ]]; then
  return 0 2>/dev/null || { cleanup_omnipolymath_plugins_sweep; exit 0; }
fi

trap cleanup_omnipolymath_plugins_sweep EXIT

omnipolymath_e2e_eval_test_state_from_b64 "${OMNIPOLYMATH_TEST_STATE_SCRIPT_B64:?missing OMNIPOLYMATH_TEST_STATE_SCRIPT_B64}"
# Initialize the canonical state schema before fixture trust writes its install record.
run_plugins_omnipolymath_logged initialize-state config set plugins.enabled true
BUNDLED_PLUGIN_ROOT_DIR="extensions"
OMNIPOLYMATH_PLUGIN_HOME="$HOME/.omnipolymath/$BUNDLED_PLUGIN_ROOT_DIR"

demo_plugin_id="demo-plugin"
demo_plugin_root="$OMNIPOLYMATH_PLUGIN_HOME/$demo_plugin_id"
node scripts/e2e/lib/fixture.mjs plugin-demo "$demo_plugin_root"
node scripts/e2e/lib/plugins/assertions.mjs record-fixture-plugin-trust "$demo_plugin_id" "$demo_plugin_root" 1

run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-inspect.json" plugins inspect demo-plugin --runtime --json

node scripts/e2e/lib/plugins/assertions.mjs demo-plugin

echo "Testing tgz install flow..."
pack_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-pack.XXXXXX")"
pack_fixture_archive plugin "$pack_dir" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/demo-plugin-tgz.tgz" demo-plugin-tgz 0.0.1 demo.tgz "Demo Plugin TGZ"

run_plugins_fixture_logged install-tgz plugins install "$OMNIPOLYMATH_PLUGINS_TMP_DIR/demo-plugin-tgz.tgz" --force

run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins2.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins2-inspect.json" plugins inspect demo-plugin-tgz --runtime --json

node scripts/e2e/lib/plugins/assertions.mjs plugin-tgz

run_plugins_omnipolymath_logged uninstall-tgz plugins uninstall demo-plugin-tgz --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins2-uninstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-tgz-removed

echo "Testing install from local folder (plugins.load.paths)..."
dir_plugin="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-dir.XXXXXX")"
node scripts/e2e/lib/fixture.mjs plugin "$dir_plugin" demo-plugin-dir 0.0.1 demo.dir "Demo Plugin DIR"

run_plugins_fixture_logged install-dir plugins install "$dir_plugin" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins3.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins3-inspect.json" plugins inspect demo-plugin-dir --runtime --json

node scripts/e2e/lib/plugins/assertions.mjs plugin-dir "$dir_plugin"

omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" plugins update demo-plugin-dir >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-dir-update.log" 2>&1
node scripts/e2e/lib/plugins/assertions.mjs plugin-dir-update-skipped

run_plugins_omnipolymath_logged uninstall-dir plugins uninstall demo-plugin-dir --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins3-uninstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-dir-removed

echo "Testing install from local folder with preinstalled dependencies..."
dir_deps_plugin="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-dir-deps.XXXXXX")"
node scripts/e2e/lib/fixture.mjs plugin-vendored-dep "$dir_deps_plugin" demo-plugin-dir-deps 0.0.1 demo.dir.deps "Demo Plugin DIR Deps"

run_plugins_fixture_logged install-dir-deps plugins install "$dir_deps_plugin" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-dir-deps.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-dir-deps-inspect.json" plugins inspect demo-plugin-dir-deps --runtime --json

node scripts/e2e/lib/plugins/assertions.mjs plugin-dir-deps "$dir_deps_plugin"

run_plugins_omnipolymath_logged uninstall-dir-deps plugins uninstall demo-plugin-dir-deps --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-dir-deps-uninstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-dir-deps-removed

echo "Testing install from npm spec (file:)..."
file_pack_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-filepack.XXXXXX")"
node scripts/e2e/lib/fixture.mjs plugin "$file_pack_dir/package" demo-plugin-file 0.0.1 demo.file "Demo Plugin FILE"

run_plugins_fixture_logged install-file plugins install "file:$file_pack_dir/package" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins4.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins4-inspect.json" plugins inspect demo-plugin-file --runtime --json

node scripts/e2e/lib/plugins/assertions.mjs plugin-file "$file_pack_dir/package"

run_plugins_omnipolymath_logged uninstall-file plugins uninstall demo-plugin-file --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins4-uninstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-file-removed

echo "Testing install and update from npm registry..."
npm_pack_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-npm-pack.XXXXXX")"
npm_dep_pack_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-npm-dep-pack.XXXXXX")"
invalid_npm_pack_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-invalid-metadata-pack.XXXXXX")"
npm_registry_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-npm-registry.XXXXXX")"
pack_fixture_archive plugin-cli-registry-dep "$npm_pack_dir" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/demo-plugin-npm.tgz" demo-plugin-npm 0.0.1 demo.npm "Demo Plugin NPM" demo-npm "demo-plugin-npm:pong"
pack_fixture_archive fake-is-number-package "$npm_dep_pack_dir" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/is-number-7.0.0.tgz"
pack_fixture_plugin_with_invalid_extension_entry "$invalid_npm_pack_dir" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/demo-plugin-invalid-metadata.tgz" demo-plugin-invalid-metadata 0.0.1 demo.invalid.metadata "Demo Plugin Invalid Metadata"
start_npm_fixture_registry "@omnipolymath/demo-plugin-npm" "0.0.1" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/demo-plugin-npm.tgz" "$npm_registry_dir" "is-number" "7.0.0" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/is-number-7.0.0.tgz" "@omnipolymath/demo-plugin-invalid-metadata" "0.0.1" "$OMNIPOLYMATH_PLUGINS_TMP_DIR/demo-plugin-invalid-metadata.tgz"

run_plugins_fixture_logged install-npm plugins install "npm:@omnipolymath/demo-plugin-npm@0.0.1" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-inspect.json" plugins inspect demo-plugin-npm --runtime --json
run_plugins_shell_logged exec-npm-plugin-cli 'node "$OMNIPOLYMATH_ENTRY" demo-npm ping >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-cli.txt"'

node scripts/e2e/lib/plugins/assertions.mjs plugin-npm

omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" plugins update demo-plugin-npm >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-update.log" 2>&1
node scripts/e2e/lib/plugins/assertions.mjs plugin-npm-update

run_plugins_omnipolymath_logged uninstall-npm-retained plugins uninstall demo-plugin-npm --force --keep-files
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-retained.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-npm-retained

run_plugins_fixture_logged reinstall-npm plugins install "npm:@omnipolymath/demo-plugin-npm@0.0.1" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-reinstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-npm-reinstalled
# Reinstall preserves the explicit uninstall marker until the operator enables the plugin.
run_plugins_fixture_logged enable-reinstalled-npm plugins enable demo-plugin-npm
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-inspect.json" plugins inspect demo-plugin-npm --runtime --json
run_plugins_shell_logged exec-reinstalled-npm-plugin-cli 'node "$OMNIPOLYMATH_ENTRY" demo-npm ping >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-cli.txt"'
node scripts/e2e/lib/plugins/assertions.mjs plugin-npm

run_plugins_omnipolymath_logged uninstall-npm plugins uninstall demo-plugin-npm --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-npm-uninstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-npm-removed

echo "Testing npm install rejects malformed package metadata..."
if omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" plugins install "npm:@omnipolymath/demo-plugin-invalid-metadata@0.0.1" --force >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-invalid-omnipolymath-extensions.log" 2>&1; then
  cat "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-invalid-omnipolymath-extensions.log"
  echo "Expected malformed package metadata install to fail." >&2
  exit 1
fi
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-invalid-omnipolymath-extensions-list.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs invalid-omnipolymath-extensions

echo "Testing install from git repo and plugin CLI execution..."
git_fixture_root="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-git.XXXXXX")"
git_repo="$git_fixture_root/repo"
git_repo_url="file://$git_repo"
node scripts/e2e/lib/fixture.mjs plugin-cli "$git_repo" demo-plugin-git 0.0.1 demo.git "Demo Plugin Git" demo-git "demo-plugin-git:pong"
git -C "$git_repo" init -q
git -C "$git_repo" config user.email "docker-e2e@omnipolymath.local"
git -C "$git_repo" config user.name "Omnipolymath Docker E2E"
git -C "$git_repo" add -A
git -C "$git_repo" commit -qm "test fixture"
git_ref="$(git -C "$git_repo" rev-parse HEAD)"

run_plugins_fixture_logged install-git plugins install "git:$git_repo_url@$git_ref" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-inspect.json" plugins inspect demo-plugin-git --runtime --json
run_plugins_shell_logged exec-git-plugin-cli 'node "$OMNIPOLYMATH_ENTRY" demo-git ping >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-cli.txt"'

node scripts/e2e/lib/plugins/assertions.mjs plugin-git "$git_repo_url" "$git_ref"

run_plugins_omnipolymath_logged uninstall-git plugins uninstall demo-plugin-git --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-uninstalled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs plugin-git-removed

echo "Testing git plugin update from moving ref..."
git_update_fixture_root="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-git-update.XXXXXX")"
git_update_repo="$git_update_fixture_root/repo"
git_update_repo_url="file://$git_update_repo"
node scripts/e2e/lib/fixture.mjs plugin-cli "$git_update_repo" demo-plugin-git-update 0.0.1 demo.git.update.v1 "Demo Plugin Git Update" demo-git-update "demo-plugin-git-update:pong-v1"
git -C "$git_update_repo" init -q
git -C "$git_update_repo" config user.email "docker-e2e@omnipolymath.local"
git -C "$git_update_repo" config user.name "Omnipolymath Docker E2E"
git -C "$git_update_repo" checkout -qb main
git -C "$git_update_repo" add -A
git -C "$git_update_repo" commit -qm "test fixture v1"
git_update_ref_v1="$(git -C "$git_update_repo" rev-parse HEAD)"

run_plugins_fixture_logged install-git-update plugins install "git:$git_update_repo_url@main" --force
node scripts/e2e/lib/fixture.mjs plugin-cli "$git_update_repo" demo-plugin-git-update 0.0.2 demo.git.update.v2 "Demo Plugin Git Update" demo-git-update "demo-plugin-git-update:pong-v2"
git -C "$git_update_repo" add -A
git -C "$git_update_repo" commit -qm "test fixture v2"

omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" plugins update demo-plugin-git-update >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-update.log" 2>&1
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-update.json" plugins list --json
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-update-inspect.json" plugins inspect demo-plugin-git-update --runtime --json
run_plugins_shell_logged exec-updated-git-plugin-cli 'node "$OMNIPOLYMATH_ENTRY" demo-git-update ping >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-git-update-cli.txt"'

node scripts/e2e/lib/plugins/assertions.mjs plugin-git-updated "$git_update_ref_v1"

echo "Testing Claude bundle enable and inspect flow..."
bundle_plugin_id="claude-bundle-e2e"
bundle_root="$OMNIPOLYMATH_PLUGIN_HOME/$bundle_plugin_id"
node scripts/e2e/lib/fixture.mjs claude-bundle "$bundle_root"
node scripts/e2e/lib/plugins/assertions.mjs record-fixture-plugin-trust "$bundle_plugin_id" "$bundle_root" 0

run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-bundle-disabled.json" plugins list --json
node scripts/e2e/lib/plugins/assertions.mjs bundle-disabled

run_plugins_fixture_logged enable-claude-bundle plugins enable claude-bundle-e2e
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-bundle-inspect.json" plugins inspect claude-bundle-e2e --json
node scripts/e2e/lib/plugins/assertions.mjs bundle-inspect

echo "Testing plugin install visible after explicit restart..."
slash_install_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-plugin-slash-install.XXXXXX")"
node scripts/e2e/lib/fixture.mjs plugin "$slash_install_dir" slash-install-plugin 0.0.1 demo.slash.install "Slash Install Plugin"

run_plugins_fixture_logged install-slash-plugin plugins install "$slash_install_dir" --force
run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugin-command-install-show.json" plugins inspect slash-install-plugin --runtime --json
node scripts/e2e/lib/plugins/assertions.mjs slash-install

run_plugins_marketplace_scenario

run_plugins_clawhub_scenario
