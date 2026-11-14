#!/usr/bin/env bash
# Omnipolymath CLI installer (no onboarding): https://omnipolymath.vercel.app/install-cli.sh
#
#   curl -fsSL https://omnipolymath.vercel.app/install.sh | bash
#   curl -fsSL https://omnipolymath.vercel.app/install-cli.sh | bash
#
# By default installs the prebuilt package from the latest GitHub release
# (needs only Node.js and npm, checks its SHA-256) into ~/.omnipolymath-cli and
# links the `omnipolymath` command into ~/.local/bin. With --from-source, or when
# no prebuilt package exists for the requested version, it clones the
# repository and builds it with pnpm instead. Nothing runs as root.
#
# Environment overrides:
#   OMNIPOLYMATH_REF     release tag (vYYYY.M.D), "latest", or a branch (default: latest;
#                        a branch always builds from source)
#   OMNIPOLYMATH_PREFIX  prebuilt install prefix (default: ~/.omnipolymath-cli)
#   OMNIPOLYMATH_DIR     source checkout (default: ~/.omnipolymath-src)
#   OMNIPOLYMATH_REPO    git URL (default: https://github.com/krishnashahane/Omnipolymath.git)
#   OMNIPOLYMATH_BIN     directory for the command (default: ~/.local/bin)

main() {
  set -euo pipefail

  local repo="${OMNIPOLYMATH_REPO:-https://github.com/krishnashahane/Omnipolymath.git}"
  local ref="${OMNIPOLYMATH_REF:-latest}"
  local dir="${OMNIPOLYMATH_DIR:-$HOME/.omnipolymath-src}"
  local prefix="${OMNIPOLYMATH_PREFIX:-$HOME/.omnipolymath-cli}"
  local bindir="${OMNIPOLYMATH_BIN:-$HOME/.local/bin}"
  local releases="https://github.com/krishnashahane/Omnipolymath/releases"
  local onboard=0
  local from_source=0

  for arg in "$@"; do
    case "$arg" in
      --no-onboard) onboard=0 ;;
      --from-source) from_source=1 ;;
      -h | --help)
        sed -n '2,22p' "$0" 2>/dev/null || true
        echo "Usage: install.sh [--no-onboard] [--from-source]"
        return 0
        ;;
      *)
        echo "Unknown option: $arg" >&2
        return 2
        ;;
    esac
  done

  say() { printf '\033[1m%s\033[0m\n' "$*"; }
  warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
  die() {
    printf '\033[31mError:\033[0m %s\n' "$*" >&2
    exit 1
  }

  if [ "$(id -u)" = "0" ]; then
    die "Please run the installer as your normal user, not root."
  fi

  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) die "Unsupported OS $(uname -s). On Windows, install WSL2 and run this inside it." ;;
  esac

  say "Omnipolymath installer"

  command -v node >/dev/null 2>&1 || die "Node.js 24.16+ or 26.1+ is required: https://nodejs.org"

  local node_version major minor
  node_version="$(node -p 'process.versions.node')"
  major="${node_version%%.*}"
  minor="$(echo "$node_version" | cut -d. -f2)"
  if ! { [ "$major" -eq 24 ] && [ "$minor" -ge 16 ]; } && ! { [ "$major" -eq 26 ] && [ "$minor" -ge 1 ]; } && ! [ "$major" -gt 26 ]; then
    die "Node.js $node_version is not supported. Install Node 24.16+ or 26.1+ from https://nodejs.org"
  fi

  sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum "$1" | cut -d' ' -f1
    else
      shasum -a 256 "$1" | cut -d' ' -f1
    fi
  }

  link_command() {
    mkdir -p "$bindir"
    cat >"$bindir/omnipolymath" <<WRAPPER
#!/usr/bin/env bash
exec node "$1" "\$@"
WRAPPER
    chmod 755 "$bindir/omnipolymath"
    say "Installed: $bindir/omnipolymath"
  }

  # Prebuilt package: only for "latest" or a release tag.
  local installed=0
  if [ "$from_source" -eq 0 ] && { [ "$ref" = "latest" ] || [[ "$ref" =~ ^v[0-9]+\.[0-9]+\.[0-9]+ ]]; }; then
    command -v npm >/dev/null 2>&1 || die "npm is required (it ships with Node.js)."
    command -v curl >/dev/null 2>&1 || die "curl is required."
    local base
    if [ "$ref" = "latest" ]; then
      base="$releases/latest/download"
    else
      base="$releases/download/$ref"
    fi
    local tmp
    tmp="$(mktemp -d)"
    # Retry network errors; only a missing asset (HTTP 404) falls back to a source build.
    local retry_all=""
    # --retry-all-errors needs curl 7.71+; older curl still retries transient errors.
    if curl --help all 2>/dev/null | grep -q -- "--retry-all-errors"; then
      retry_all="--retry-all-errors"
    fi
    fetch() {
      local code
      # shellcheck disable=SC2086
      code="$(curl -sSL --retry 4 $retry_all --retry-delay 2 -o "$2" -w '%{http_code}' "$1" || true)"
      case "$code" in
        200) return 0 ;;
        404) return 1 ;;
        *) die "Could not download $1 (HTTP ${code:-error}). Check your connection and run the installer again." ;;
      esac
    }
    say "Downloading the prebuilt package ($ref)"
    if fetch "$base/omnipolymath.tgz.sha256" "$tmp/omnipolymath.tgz.sha256" &&
      fetch "$base/omnipolymath.tgz" "$tmp/omnipolymath.tgz"; then
      local want got
      want="$(cut -d' ' -f1 <"$tmp/omnipolymath.tgz.sha256")"
      got="$(sha256_of "$tmp/omnipolymath.tgz")"
      [ -n "$want" ] && [ "$want" = "$got" ] || die "Checksum mismatch for the downloaded package (expected $want, got $got)."
      say "Installing into $prefix"
      # npm 11.20+ asks before running install scripts. These fetch native prebuilds
      # for bundled channels and tools; older npm ignores the setting.
      npm install --global --prefix "$prefix" --no-fund --no-audit \
        --allow-scripts=omnipolymath,protobufjs,esbuild,@google/genai,@matrix-org/matrix-sdk-crypto-nodejs,baileys,onnxruntime-node,koffi,node-pty \
        "$tmp/omnipolymath.tgz"
      local pkgdir="$prefix/lib/node_modules/omnipolymath"
      local entry="$pkgdir/omnipolymath.mjs"
      [ -f "$entry" ] || die "The package installed but $entry is missing."
      # npm skips the root package's own postinstall for file installs; run it here.
      (cd "$pkgdir" && node scripts/postinstall-bundled-plugins.mjs) ||
        warn "Post-install cleanup reported a problem; 'omnipolymath doctor' can repair it."
      link_command "$entry"
      installed=1
    else
      warn "No prebuilt package for $ref; building from source instead."
    fi
    rm -rf "$tmp"
  fi

  if [ "$installed" -eq 0 ]; then
  if [ "$ref" = "latest" ]; then
    ref="main"
  fi
  command -v git >/dev/null 2>&1 || die "git is required. Install it, then run this again."
  local pnpm_cmd
  if command -v pnpm >/dev/null 2>&1; then
    pnpm_cmd="pnpm"
  elif command -v corepack >/dev/null 2>&1; then
    pnpm_cmd="corepack pnpm"
  else
    die "pnpm is required. Install it with: npm install -g pnpm"
  fi

  if [ -d "$dir/.git" ]; then
    say "Updating $dir"
    git -C "$dir" fetch --depth 1 origin "$ref"
    git -C "$dir" checkout -q -B "$ref" FETCH_HEAD
  else
    if [ -e "$dir" ]; then
      die "$dir exists and is not a git checkout. Move it away or set OMNIPOLYMATH_DIR."
    fi
    say "Cloning $repo ($ref)"
    git clone --depth 1 --branch "$ref" "$repo" "$dir"
  fi

  if [ ! -f "$dir/package.json" ] || [ ! -f "$dir/omnipolymath.mjs" ]; then
    die "The repository at $repo does not contain the Omnipolymath source yet. Watch https://github.com/krishnashahane/Omnipolymath for the first release."
  fi

  cd "$dir"
  say "Installing dependencies (this takes a few minutes)"
  $pnpm_cmd install --frozen-lockfile || $pnpm_cmd install
  say "Building"
  $pnpm_cmd build
  $pnpm_cmd ui:build

  link_command "$dir/omnipolymath.mjs"
  fi

  case ":$PATH:" in
    *":$bindir:"*) ;;
    *) warn "Add $bindir to your PATH, for example: echo 'export PATH=\"$bindir:\$PATH\"' >> ~/.zshrc" ;;
  esac

  if [ "$onboard" -eq 1 ]; then
    if [ -t 1 ] && [ -r /dev/tty ]; then
      say "Starting onboarding"
      "$bindir/omnipolymath" onboard --install-daemon </dev/tty
    else
      say "Next: run 'omnipolymath onboard --install-daemon'"
    fi
  else
    say "Next: run 'omnipolymath onboard --install-daemon'"
  fi
}

main "$@"
