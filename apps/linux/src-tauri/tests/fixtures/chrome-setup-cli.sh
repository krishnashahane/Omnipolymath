#!/bin/sh
root=$(dirname "$0")
if test "$1" = "--version"; then printf 'Omnipolymath 2026.9.4 (fixture)\n'; exit 0; fi
test "$OMNIPOLYMATH_NO_RESPAWN" = "1" || exit 2
printf '%s\n' "$*" >> "$root/calls"
if test -f "$root/fail"; then
  printf 'fixture-private-diagnostic\n' >&2
  exit 1
fi
cat "$root/result.json"
