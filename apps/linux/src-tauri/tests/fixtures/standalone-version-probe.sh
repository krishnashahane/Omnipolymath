#!/bin/sh
[ "$HOME" = "$OMNIPOLYMATH_STATE_DIR" ] || exit 1
[ "$HOME" = "$TMPDIR" ] || exit 2
[ "$HOME" = "$TMP" ] || exit 3
[ "$HOME" = "$TEMP" ] || exit 4
[ "$OMNIPOLYMATH_CONFIG_PATH" = "$HOME/omnipolymath.json" ] || exit 5
[ -z "${CODEX_HOME-}" ] || exit 6
[ "$#" = 1 ] && [ "$1" = --version ] || exit 7
printf 'synthetic probe\n' > "$HOME/probe-ran"
printf 'Omnipolymath 2026.10.1\n'
