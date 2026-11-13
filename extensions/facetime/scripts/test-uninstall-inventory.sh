#!/bin/sh
set -eu

root=$(/usr/bin/mktemp -d "${TMPDIR:-/tmp}/omnipolymath-facetime-uninstall-test.XXXXXX")
cleanup() { /bin/rm -rf "$root"; }
trap cleanup EXIT
home="$root/home"
tmp="$root/tmp"
/bin/mkdir -p \
  "$home/Library/Caches/Omnipolymath/FaceTime/driver/OmnipolymathBridge.driver" \
  "$home/Library/Application Support/Omnipolymath/FaceTime" \
  "$home/Library/Containers/com.apple.FaceTime/Data/tmp" \
  "$home/Library/Containers/com.apple.mobilephone/Data/tmp" \
  "$tmp/omnipolymath-facetime-macabi"
/usr/bin/touch \
  "$home/Library/Application Support/Omnipolymath/FaceTime/helper-ipc-key" \
  "$home/Library/Application Support/Omnipolymath/FaceTime/helper-build.sha256" \
  "$home/Library/Containers/com.apple.FaceTime/Data/tmp/FaceTimeHelper.dylib" \
  "$home/Library/Containers/com.apple.mobilephone/Data/tmp/FaceTimeHelper-1.dylib" \
  "$home/Library/Containers/com.apple.FaceTime/Data/tmp/unrelated" \
  "$tmp/omnipolymath-facetime-macabi/FaceTimeHelper.dylib"

/bin/sh "$(dirname "$0")/remove-user-artifacts.sh" "$home" "$tmp"
test ! -e "$home/Library/Caches/Omnipolymath/FaceTime/driver/OmnipolymathBridge.driver"
test ! -e "$home/Library/Application Support/Omnipolymath/FaceTime/helper-ipc-key"
test ! -e "$home/Library/Application Support/Omnipolymath/FaceTime/helper-build.sha256"
test ! -e "$home/Library/Containers/com.apple.FaceTime/Data/tmp/FaceTimeHelper.dylib"
test ! -e "$home/Library/Containers/com.apple.mobilephone/Data/tmp/FaceTimeHelper-1.dylib"
test ! -e "$tmp/omnipolymath-facetime-macabi"
test -e "$home/Library/Containers/com.apple.FaceTime/Data/tmp/unrelated"
