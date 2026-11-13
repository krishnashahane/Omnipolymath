#!/usr/bin/env bash
set -euo pipefail

source scripts/lib/omnipolymath-e2e-instance.sh
omnipolymath_e2e_eval_test_state_from_b64 "${OMNIPOLYMATH_TEST_STATE_SCRIPT_B64:?missing isolated state}"
omnipolymath_e2e_install_package /tmp/consent-install.log "mounted Omnipolymath package" /tmp/consent-prefix
package_root="$(omnipolymath_e2e_package_root /tmp/consent-prefix)"
entry="$(omnipolymath_e2e_package_entrypoint "$package_root")"
export PATH="/tmp/consent-prefix/bin:$PATH"
export NPM_CONFIG_PREFIX=/tmp/consent-prefix
node scripts/e2e/lib/plugin-update/probe.mjs consent "$entry" "$OMNIPOLYMATH_CURRENT_PACKAGE_TGZ"
