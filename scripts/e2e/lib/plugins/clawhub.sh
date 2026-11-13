run_plugins_clawhub_scenario() {
  if [ "${OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB:-1}" = "0" ]; then
    echo "Skipping ClawHub plugin install and uninstall (OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB=0)."
  else
    echo "Testing ClawHub plugin install and uninstall..."

    start_clawhub_fixture_server() {
      local fixture_dir="$1"
      local server_log="$fixture_dir/clawhub-fixture.log"
      local server_port_file="$fixture_dir/clawhub-fixture-port"
      local server_pid_file="$fixture_dir/clawhub-fixture-pid"

      omnipolymath_plugins_validate_fixture_log_print_bytes || return $?

      node scripts/e2e/lib/clawhub-fixture-server.cjs plugins "$server_port_file" >"$server_log" 2>&1 &
      local server_pid="$!"
      echo "$server_pid" >"$server_pid_file"
      omnipolymath_plugins_register_fixture_pid_file "$server_pid_file"

      omnipolymath_plugins_wait_fixture_port "$server_pid" "$server_port_file" "$server_log" "ClawHub fixture server"
      local readiness_status=$?
      [ "$readiness_status" -eq 0 ] || return "$readiness_status"
      export OMNIPOLYMATH_CLAWHUB_URL="http://127.0.0.1:$(cat "$server_port_file")"
      return 0
    }

    local clawhub_default_plugin_spec="clawhub:@omnipolymath/plugin-e2e-fixture"
    if [[ "${OMNIPOLYMATH_PLUGINS_E2E_LIVE_CLAWHUB:-0}" = "1" ]]; then
      if [[ -z "${OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB_SPEC:-}" || -z "${OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB_ID:-}" ]]; then
        echo "Live ClawHub E2E requires OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB_SPEC and OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB_ID; the Kitchen Sink listing has been retired." >&2
        return 2
      fi
      export OMNIPOLYMATH_CLAWHUB_URL="${OMNIPOLYMATH_CLAWHUB_URL:-${CLAWHUB_URL:-https://clawhub.ai}}"
      export NPM_CONFIG_REGISTRY="${OMNIPOLYMATH_PLUGINS_E2E_LIVE_NPM_REGISTRY:-https://registry.npmjs.org/}"
    else
      # Keep the release-path smoke hermetic; live ClawHub can rate-limit CI.
      if [[ -n "${OMNIPOLYMATH_CLAWHUB_URL:-}" || -n "${CLAWHUB_URL:-}" ]]; then
        echo "Ignoring ambient ClawHub URL for fixture-mode plugin E2E."
      fi
      unset OMNIPOLYMATH_CLAWHUB_URL CLAWHUB_URL
      clawhub_fixture_dir="$(mktemp -d "$OMNIPOLYMATH_PLUGINS_TMP_DIR/omnipolymath-clawhub-fixture.XXXXXX")"
      start_clawhub_fixture_server "$clawhub_fixture_dir" || return "$?"
    fi

    CLAWHUB_PLUGIN_SPEC="${OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB_SPEC:-$clawhub_default_plugin_spec}"
    CLAWHUB_PLUGIN_ID="${OMNIPOLYMATH_PLUGINS_E2E_CLAWHUB_ID:-omnipolymath-kitchen-sink-fixture}"
    export CLAWHUB_PLUGIN_SPEC CLAWHUB_PLUGIN_ID

    node scripts/e2e/lib/plugins/assertions.mjs clawhub-preflight

    run_plugins_fixture_logged install-clawhub plugins install "$CLAWHUB_PLUGIN_SPEC"
    run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-clawhub-installed.json" plugins list --json
    run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-clawhub-inspect.json" plugins inspect "$CLAWHUB_PLUGIN_ID" --json

    node scripts/e2e/lib/plugins/assertions.mjs clawhub-installed

    omnipolymath_e2e_maybe_timeout "$OMNIPOLYMATH_PLUGINS_CLI_TIMEOUT" node "$OMNIPOLYMATH_ENTRY" plugins update "$CLAWHUB_PLUGIN_ID" >"$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-clawhub-update.log" 2>&1
    run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-clawhub-updated.json" plugins list --json
    run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-clawhub-updated-inspect.json" plugins inspect "$CLAWHUB_PLUGIN_ID" --json

    node scripts/e2e/lib/plugins/assertions.mjs clawhub-updated

    run_plugins_omnipolymath_logged uninstall-clawhub plugins uninstall "$CLAWHUB_PLUGIN_SPEC" --force
    run_plugins_omnipolymath_capture "$OMNIPOLYMATH_PLUGINS_TMP_DIR/plugins-clawhub-uninstalled.json" plugins list --json

    node scripts/e2e/lib/plugins/assertions.mjs clawhub-removed
  fi
}
