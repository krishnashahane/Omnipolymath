#!/usr/bin/env bash
set -euo pipefail
trap "" PIPE
export TERM=xterm-256color
export NO_COLOR=1

source scripts/lib/omnipolymath-e2e-instance.sh

source scripts/e2e/lib/release-scenarios/setup.sh

dump_debug_logs() {
  local status="$1"
  echo "release plugin marketplace failed with exit code $status" >&2
  omnipolymath_e2e_dump_logs \
    /tmp/omnipolymath-release-plugin-marketplace-install.log \
    /tmp/omnipolymath-release-plugin-marketplace-onboard.log \
    /tmp/omnipolymath-release-plugin-marketplace-list.json \
    /tmp/omnipolymath-release-plugin-marketplace-install-plugin.log \
    /tmp/omnipolymath-release-plugin-marketplace-cli-v1.log \
    /tmp/omnipolymath-release-plugin-marketplace-update-dry-run.log \
    /tmp/omnipolymath-release-plugin-marketplace-cli-after-dry-run.log \
    /tmp/omnipolymath-release-plugin-marketplace-update.log \
    /tmp/omnipolymath-release-plugin-marketplace-cli-v2.log \
    /tmp/omnipolymath-release-plugin-marketplace-uninstall.log \
    /tmp/omnipolymath-release-plugin-marketplace-cli-after-uninstall.log
}
omnipolymath_e2e_enable_failure_diagnostics

omnipolymath_e2e_install_package /tmp/omnipolymath-release-plugin-marketplace-install.log
command -v omnipolymath >/dev/null
omnipolymath_e2e_enable_omnipolymath_cli_timeout

omnipolymath_release_onboard "" omnipolymath >/tmp/omnipolymath-release-plugin-marketplace-onboard.log 2>&1

marketplace_root="$HOME/.claude/plugins/marketplaces/release-fixture-marketplace"
marketplace_assertions="scripts/e2e/lib/release-plugin-marketplace/lifecycle-assertions.mjs"
install_path_file="/tmp/omnipolymath-release-plugin-marketplace-install-path.txt"
mkdir -p "$HOME/.claude/plugins" "$marketplace_root/.claude-plugin"
node scripts/e2e/lib/release-scenarios/write-cli-plugin.mjs \
  "$marketplace_root/plugins/release-marketplace-plugin" \
  release-marketplace-plugin \
  0.0.1 \
  release.marketplace.v1 \
  "Release Marketplace Plugin" \
  release-market \
  "release-marketplace-plugin:v1"
node scripts/e2e/lib/release-scenarios/write-cli-plugin.mjs \
  "$marketplace_root/plugins/release-marketplace-other" \
  release-marketplace-other \
  0.0.1 \
  release.marketplace.other \
  "Release Marketplace Other" \
  release-market-other \
  "release-marketplace-other:v1"
node scripts/e2e/lib/release-scenarios/write-marketplace.mjs \
  "$marketplace_root" \
  release-fixtures \
  release-marketplace-plugin \
  release-marketplace-other

omnipolymath plugins marketplace list release-fixtures --json >/tmp/omnipolymath-release-plugin-marketplace-list.json
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-file-contains /tmp/omnipolymath-release-plugin-marketplace-list.json release-marketplace-plugin

omnipolymath_e2e_fixture_plugin_command omnipolymath -- plugins install release-marketplace-plugin@release-fixtures --force >/tmp/omnipolymath-release-plugin-marketplace-install-plugin.log 2>&1
node "$marketplace_assertions" \
  assert-marketplace-state \
  release-marketplace-plugin \
  0.0.1 \
  release-fixtures \
  release-marketplace-plugin \
  "$install_path_file"
omnipolymath release-market ping >/tmp/omnipolymath-release-plugin-marketplace-cli-v1.log 2>&1
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-file-contains /tmp/omnipolymath-release-plugin-marketplace-cli-v1.log "release-marketplace-plugin:v1"

node scripts/e2e/lib/release-scenarios/write-cli-plugin.mjs \
  "$marketplace_root/plugins/release-marketplace-plugin" \
  release-marketplace-plugin \
  0.0.2 \
  release.marketplace.v2 \
  "Release Marketplace Plugin" \
  release-market \
  "release-marketplace-plugin:v2"
omnipolymath plugins update release-marketplace-plugin --dry-run >/tmp/omnipolymath-release-plugin-marketplace-update-dry-run.log 2>&1
node "$marketplace_assertions" \
  assert-update-log \
  /tmp/omnipolymath-release-plugin-marketplace-update-dry-run.log \
  "Would update release-marketplace-plugin: 0.0.1 -> 0.0.2."
node "$marketplace_assertions" \
  assert-marketplace-state \
  release-marketplace-plugin \
  0.0.1 \
  release-fixtures \
  release-marketplace-plugin \
  "$install_path_file"
omnipolymath release-market ping >/tmp/omnipolymath-release-plugin-marketplace-cli-after-dry-run.log 2>&1
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-file-contains /tmp/omnipolymath-release-plugin-marketplace-cli-after-dry-run.log "release-marketplace-plugin:v1"
omnipolymath_e2e_fixture_plugin_command omnipolymath -- plugins update release-marketplace-plugin >/tmp/omnipolymath-release-plugin-marketplace-update.log 2>&1
node "$marketplace_assertions" \
  assert-update-log \
  /tmp/omnipolymath-release-plugin-marketplace-update.log \
  "Updated release-marketplace-plugin: 0.0.1 -> 0.0.2."
node "$marketplace_assertions" \
  assert-marketplace-state \
  release-marketplace-plugin \
  0.0.2 \
  release-fixtures \
  release-marketplace-plugin \
  "$install_path_file"
omnipolymath release-market ping >/tmp/omnipolymath-release-plugin-marketplace-cli-v2.log 2>&1
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-file-contains /tmp/omnipolymath-release-plugin-marketplace-cli-v2.log "release-marketplace-plugin:v2"

sentinel_plugin_id="release-marketplace-other"
sentinel_path="$marketplace_root/plugins/$sentinel_plugin_id"
node "$marketplace_assertions" \
  seed-marketplace-uninstall-state \
  release-marketplace-plugin \
  "$sentinel_plugin_id" \
  "$sentinel_path" \
  "$install_path_file"
omnipolymath plugins uninstall release-marketplace-plugin --force >/tmp/omnipolymath-release-plugin-marketplace-uninstall.log 2>&1
node "$marketplace_assertions" \
  assert-update-log \
  /tmp/omnipolymath-release-plugin-marketplace-uninstall.log \
  "Removed: plugin settings, install record, allowlist entry, denylist entry, load path, directory."
if omnipolymath release-market ping >/tmp/omnipolymath-release-plugin-marketplace-cli-after-uninstall.log 2>&1; then
  echo "release-market CLI should be gone after uninstall" >&2
  exit 1
fi
node "$marketplace_assertions" \
  assert-marketplace-uninstalled \
  release-marketplace-plugin \
  "$sentinel_plugin_id" \
  "$sentinel_path" \
  "$install_path_file"
node scripts/e2e/lib/release-scenarios/assertions.mjs assert-plugin-uninstalled release-marketplace-plugin release-market

echo "Release plugin marketplace scenario passed."
