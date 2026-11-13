#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
# Proves hosted npm installation plus dedicated-prefix source installation.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_ROOT="${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$ROOT_DIR}"
source "$ROOT_DIR/scripts/lib/docker-e2e-image.sh"

IMAGE_NAME="$(docker_e2e_resolve_image "omnipolymath-cli-installer-distribution:local")"
PACKAGE_TGZ="$(
  docker_e2e_prepare_package_tgz cli-installer-distribution "${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:-}"
)"
docker_e2e_package_mount_args "$PACKAGE_TGZ"
HOSTED_PROOF_CONTAINER="omnipolymath-hosted-installer-proof-$$"
SOURCE_PROOF_CONTAINER="omnipolymath-source-installer-proof-$$"
SOURCE_BUNDLE="$(mktemp "${TMPDIR:-/tmp}/omnipolymath-source.XXXXXX.bundle")"
SOURCE_PROOF_SCRIPT="$(mktemp "${TMPDIR:-/tmp}/omnipolymath-source-proof.XXXXXX.sh")"
SOURCE_SHA="$(git -C "$SOURCE_ROOT" rev-parse HEAD)"
SOURCE_MEMORY="${OMNIPOLYMATH_CLI_INSTALLER_SOURCE_MEMORY:-16g}"
INSTALLERS_DIR=""

cleanup() {
  docker_e2e_docker_cmd rm -f \
    "$HOSTED_PROOF_CONTAINER" \
    "$SOURCE_PROOF_CONTAINER" >/dev/null 2>&1 || true
  docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  rm -f "$SOURCE_BUNDLE" "$SOURCE_PROOF_SCRIPT"
  [[ -z "$INSTALLERS_DIR" ]] || rm -rf "$INSTALLERS_DIR"
}
trap cleanup EXIT

git -C "$SOURCE_ROOT" bundle create "$SOURCE_BUNDLE" HEAD
cat >"$SOURCE_PROOF_SCRIPT" <<'SOURCE_PROOF'
#!/usr/bin/env bash
set -euo pipefail

test -r "$0"
test -x "$0"
command -v curl >/dev/null
git clone -q /tmp/omnipolymath-source.bundle /tmp/omnipolymath-source
git -C /tmp/omnipolymath-source checkout -q --detach "$OMNIPOLYMATH_SOURCE_SHA"
bash /tmp/omnipolymath-source/scripts/install-cli.sh \
  --install-method git \
  --git-dir /tmp/omnipolymath-source \
  --version "$OMNIPOLYMATH_SOURCE_SHA" \
  --no-git-update \
  --prefix /tmp/omnipolymath-prefix \
  --node-version 24.22.1 \
  --no-onboard

prefix_node=/tmp/omnipolymath-prefix/tools/node/bin/node
prefix_cli=/tmp/omnipolymath-prefix/bin/omnipolymath
test -x "$prefix_node"
test -x "$prefix_cli"
grep -Fq "exec \"$prefix_node\"" "$prefix_cli"
grep -Fq "/tmp/omnipolymath-source/dist/entry.js" "$prefix_cli"
export PATH="/tmp/omnipolymath-prefix/bin:$PATH"
test "$(command -v omnipolymath)" = "$prefix_cli"
test "$(git -C /tmp/omnipolymath-source rev-parse HEAD)" = "$OMNIPOLYMATH_SOURCE_SHA"
omnipolymath_version="$(omnipolymath --version)"
omnipolymath --help >/tmp/omnipolymath-help
test -s /tmp/omnipolymath-help
status_json="$(omnipolymath update status --json)"
STATUS_JSON="$status_json" node -e "
  const status = JSON.parse(process.env.STATUS_JSON);
  if (status.update?.installKind !== \"git\") {
    throw new Error(\`expected git install kind, got \${status.update?.installKind}\`);
  }
"
printf "prefixNode=%s@%s\n" "$prefix_node" "$("$prefix_node" --version)"
printf "prefixOmnipolymath=%s@%s\n" "$prefix_cli" "$omnipolymath_version"
printf "sourceHead=%s installKind=git\n" "$OMNIPOLYMATH_SOURCE_SHA"
printf "sourceOnboard=disabled\n"
touch /tmp/omnipolymath-proof-ready
exec sleep infinity
SOURCE_PROOF
chmod 0555 "$SOURCE_PROOF_SCRIPT"

docker_e2e_build_or_reuse \
  "$IMAGE_NAME" \
  cli-installer-distribution \
  "$ROOT_DIR/scripts/e2e/Dockerfile" \
  "$ROOT_DIR" \
  bare

INSTALLERS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/omnipolymath-installers.XXXXXX")"
node "$ROOT_DIR/scripts/build-installers.mjs" "$INSTALLERS_DIR" "$SOURCE_ROOT"
echo "==> Hosted install.sh exact-candidate proof"
docker_e2e_docker_run_cmd run -d \
  --name "$HOSTED_PROOF_CONTAINER" \
  -e HOME=/tmp/omnipolymath-hosted-home \
  -e OMNIPOLYMATH_NO_ONBOARD=1 \
  -e OMNIPOLYMATH_NO_PROMPT=1 \
  "${DOCKER_E2E_PACKAGE_ARGS[@]}" \
  -v "$INSTALLERS_DIR/install.sh:/tmp/install.sh:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    mkdir -p "$HOME"
    bash /tmp/install.sh \
      --install-method npm \
      --version file:/tmp/omnipolymath-current.tgz \
      --no-onboard \
      --no-prompt
    source "$HOME/.bashrc"
    hash -r
    omnipolymath_path="$(command -v omnipolymath)"
    test -n "$omnipolymath_path"
    node_path="$(command -v node)"
    node_version="$(node --version)"
    omnipolymath_version="$(omnipolymath --version)"
    omnipolymath --help >/tmp/omnipolymath-help
    test -s /tmp/omnipolymath-help
    printf "hostedNode=%s@%s\n" "$node_path" "$node_version"
    printf "hostedOmnipolymath=%s@%s\n" "$omnipolymath_path" "$omnipolymath_version"
    printf "hostedOnboard=disabled\n"
    touch /tmp/omnipolymath-proof-ready
    exec sleep infinity
  ' >/dev/null

# A full source install builds every workspace package; the shared 8g cap OOMs before wrapper creation.
echo "==> install-cli.sh dedicated-prefix source-checkout proof"
docker_e2e_docker_run_cmd run -d \
  --name "$SOURCE_PROOF_CONTAINER" \
  --memory "$SOURCE_MEMORY" \
  -e HOME=/tmp/omnipolymath-source-home \
  -e OMNIPOLYMATH_NO_ONBOARD=1 \
  -e OMNIPOLYMATH_NO_PROMPT=1 \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e "OMNIPOLYMATH_SOURCE_SHA=$SOURCE_SHA" \
  --user root \
  -v "$SOURCE_BUNDLE:/tmp/omnipolymath-source.bundle:ro" \
  -v "$SOURCE_PROOF_SCRIPT:/tmp/source-proof.sh:ro" \
  "$IMAGE_NAME" \
  bash -lc '
    set -euo pipefail
    rm -f -- /node_modules
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends curl
    rm -rf /var/lib/apt/lists/*
    command -v curl >/dev/null
    install -d -o appuser -g appuser "$HOME"
    exec runuser -u appuser -- env \
      HOME="$HOME" \
      OMNIPOLYMATH_NO_ONBOARD="$OMNIPOLYMATH_NO_ONBOARD" \
      OMNIPOLYMATH_NO_PROMPT="$OMNIPOLYMATH_NO_PROMPT" \
      COREPACK_ENABLE_DOWNLOAD_PROMPT="$COREPACK_ENABLE_DOWNLOAD_PROMPT" \
      OMNIPOLYMATH_SOURCE_SHA="$OMNIPOLYMATH_SOURCE_SHA" \
      bash /tmp/source-proof.sh
  ' >/dev/null

docker_e2e_wait_for_proof "$HOSTED_PROOF_CONTAINER" 1200
docker logs "$HOSTED_PROOF_CONTAINER"
docker_e2e_wait_for_proof "$SOURCE_PROOF_CONTAINER" 1200
docker logs "$SOURCE_PROOF_CONTAINER"
echo "CLI installer distribution proof passed."
