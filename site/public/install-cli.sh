#!/usr/bin/env bash
# Omnipolymath CLI installer (no onboarding): https://omnipolymath.vercel.app/install-cli.sh
#
#   curl -fsSL https://omnipolymath.vercel.app/install.sh | bash
#   curl -fsSL https://omnipolymath.vercel.app/install-cli.sh | bash
#
# Installs from source: clones the repository, builds it with pnpm and links
# the `omnipolymath` command into ~/.local/bin. Nothing runs as root.
#
# Environment overrides:
#   OMNIPOLYMATH_DIR   source checkout (default: ~/.omnipolymath-src)
#   OMNIPOLYMATH_REPO  git URL (default: https://github.com/krishnashahane/Omnipolymath.git)
#   OMNIPOLYMATH_REF   branch or tag (default: main)
#   OMNIPOLYMATH_BIN   directory for the command (default: ~/.local/bin)

main() {
  set -euo pipefail

  local repo="${OMNIPOLYMATH_REPO:-https://github.com/krishnashahane/Omnipolymath.git}"
  local ref="${OMNIPOLYMATH_REF:-main}"
  local dir="${OMNIPOLYMATH_DIR:-$HOME/.omnipolymath-src}"
  local bindir="${OMNIPOLYMATH_BIN:-$HOME/.local/bin}"
  local onboard=0

  for arg in "$@"; do
    case "$arg" in
      --no-onboard) onboard=0 ;;
      -h | --help)
        sed -n '2,15p' "$0" 2>/dev/null || true
        echo "Usage: install.sh [--no-onboard]"
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

  command -v git >/dev/null 2>&1 || die "git is required. Install it, then run this again."
  command -v node >/dev/null 2>&1 || die "Node.js 24.16+ or 26.1+ is required: https://nodejs.org"

  local node_version major minor
  node_version="$(node -p 'process.versions.node')"
  major="${node_version%%.*}"
  minor="$(echo "$node_version" | cut -d. -f2)"
  if ! { [ "$major" -eq 24 ] && [ "$minor" -ge 16 ]; } && ! { [ "$major" -eq 26 ] && [ "$minor" -ge 1 ]; } && ! [ "$major" -gt 26 ]; then
    die "Node.js $node_version is not supported. Install Node 24.16+ or 26.1+ from https://nodejs.org"
  fi

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

  mkdir -p "$bindir"
  cat >"$bindir/omnipolymath" <<WRAPPER
#!/usr/bin/env bash
exec node "$dir/omnipolymath.mjs" "\$@"
WRAPPER
  chmod 755 "$bindir/omnipolymath"
  say "Installed: $bindir/omnipolymath"

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
