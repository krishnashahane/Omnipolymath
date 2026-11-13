#!/usr/bin/env bash

case "${BASH_SOURCE[0]}" in
  */*) source "${BASH_SOURCE[0]%/*}/docker-e2e-container.sh" ;;
  *) source ./docker-e2e-container.sh ;;
esac

OMNIPOLYMATH_DOCKER_LIVE_AUTH_ALL=(.factory .gemini .minimax)
OMNIPOLYMATH_DOCKER_LIVE_AUTH_FILES_ALL=(
  .codex/auth.json
  .codex/config.toml
  .claude.json
  .claude/.credentials.json
  .claude/settings.json
  .claude/settings.local.json
  .gemini/settings.json
)

omnipolymath_live_trim() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

omnipolymath_live_truthy() {
  case "${1:-}" in
    1 | true | TRUE | yes | YES | on | ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

omnipolymath_live_read_positive_int_env() {
  local name="${1:?missing environment variable name}"
  local fallback="${2:?missing fallback value}"
  local value="${!name-}"
  if [ -z "${!name+x}" ]; then
    value="$fallback"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]] || (( 10#$value < 1 )); then
    echo "invalid $name: $value" >&2
    return 2
  fi
  printf '%s\n' "$value"
}

omnipolymath_live_is_ci() {
  omnipolymath_live_truthy "${CI:-}" \
    || omnipolymath_live_truthy "${GITHUB_ACTIONS:-}" \
    || omnipolymath_live_truthy "${OMNIPOLYMATH_TESTBOX:-}"
}

omnipolymath_live_uses_managed_bind_dirs() {
  omnipolymath_live_is_ci \
    || [[ -n "${OMNIPOLYMATH_DOCKER_CACHE_HOME_DIR:-}" ]] \
    || [[ -n "${OMNIPOLYMATH_DOCKER_CLI_TOOLS_DIR:-}" ]]
}

omnipolymath_live_default_profile_file() {
  if [[ -n "${OMNIPOLYMATH_PROFILE_FILE:-}" ]]; then
    printf '%s\n' "$OMNIPOLYMATH_PROFILE_FILE"
    return 0
  fi
  local testbox_profile="$HOME/.omnipolymath-testbox-live.profile"
  if [[ -f "$testbox_profile" ]]; then
    printf '%s\n' "$testbox_profile"
    return 0
  fi
  printf '%s\n' "$HOME/.profile"
}

# Live Docker wrappers share these host-side directories. Keep their lifecycle
# here so every lane uses the same CI ownership and cleanup rules.
omnipolymath_live_init_temp_dirs() {
  TEMP_DIRS=()
  cleanup_temp_dirs() {
    if ((${#TEMP_DIRS[@]} > 0)); then
      rm -rf "${TEMP_DIRS[@]}"
    fi
  }
  trap cleanup_temp_dirs EXIT
}

omnipolymath_live_init_cli_tools_dir() {
  if [[ -n "${OMNIPOLYMATH_DOCKER_CLI_TOOLS_DIR:-}" ]]; then
    CLI_TOOLS_DIR="$OMNIPOLYMATH_DOCKER_CLI_TOOLS_DIR"
  elif omnipolymath_live_is_ci; then
    CLI_TOOLS_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-docker-cli-tools.XXXXXX")"
    TEMP_DIRS+=("$CLI_TOOLS_DIR")
  else
    CLI_TOOLS_DIR="$HOME/.cache/omnipolymath/docker-cli-tools"
  fi
  omnipolymath_live_prepare_bind_dir_for_container_user "$CLI_TOOLS_DIR"
}

omnipolymath_live_init_cache_home_dir() {
  if [[ -n "${OMNIPOLYMATH_DOCKER_CACHE_HOME_DIR:-}" ]]; then
    CACHE_HOME_DIR="$OMNIPOLYMATH_DOCKER_CACHE_HOME_DIR"
  elif omnipolymath_live_is_ci; then
    CACHE_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-docker-cache.XXXXXX")"
    TEMP_DIRS+=("$CACHE_HOME_DIR")
  else
    CACHE_HOME_DIR="$HOME/.cache/omnipolymath/docker-cache"
  fi
  omnipolymath_live_prepare_bind_dir_for_container_user "$CACHE_HOME_DIR"
}

omnipolymath_live_init_managed_home() {
  DOCKER_USER="${OMNIPOLYMATH_DOCKER_USER:-node}"
  DOCKER_HOME_MOUNT=()
  unset DOCKER_HOME_DIR
  if omnipolymath_live_uses_managed_bind_dirs; then
    DOCKER_USER="$(id -u):$(id -g)"
    DOCKER_HOME_DIR="$(mktemp -d "${RUNNER_TEMP:-/tmp}/omnipolymath-docker-home.XXXXXX")"
    TEMP_DIRS+=("$DOCKER_HOME_DIR")
    omnipolymath_live_prepare_bind_dir_for_container_user "$DOCKER_HOME_DIR"
    DOCKER_HOME_MOUNT=(-v "$DOCKER_HOME_DIR:/home/node")
  fi
}

omnipolymath_live_init_profile_mount() {
  PROFILE_MOUNT=()
  PROFILE_STATUS="none"
  if [[ -f "$PROFILE_FILE" && -r "$PROFILE_FILE" ]]; then
    if [[ -n "${DOCKER_HOME_DIR:-}" ]]; then
      omnipolymath_live_stage_profile_into_home "$DOCKER_HOME_DIR" "$PROFILE_FILE"
    else
      PROFILE_MOUNT=(-v "$PROFILE_FILE:/home/node/.profile:ro")
    fi
    PROFILE_STATUS="$PROFILE_FILE"
  fi
}

omnipolymath_live_validate_relative_home_path() {
  local value
  value="$(omnipolymath_live_trim "${1:-}")"
  [[ -n "$value" ]] || {
    echo "ERROR: empty auth path." >&2
    return 1
  }
  case "$value" in
    /* | *..* | *\\* | *:*)
      echo "ERROR: invalid auth path '$value'." >&2
      return 1
      ;;
  esac
  printf '%s' "$value"
}

omnipolymath_live_normalize_auth_dir() {
  local value
  value="$(omnipolymath_live_trim "${1:-}")"
  [[ -n "$value" ]] || return 1
  if [[ "$value" != .* ]]; then
    value=".$value"
  fi
  value="$(omnipolymath_live_validate_relative_home_path "$value")" || return 1
  printf '%s' "$value"
}

omnipolymath_live_should_include_auth_dir_for_provider() {
  local provider
  provider="$(omnipolymath_live_trim "${1:-}")"
  case "$provider" in
    droid | factory | factory-droid)
      printf '%s\n' ".factory"
      ;;
    gemini | gemini-cli | google-gemini-cli)
      printf '%s\n' ".gemini"
      ;;
    minimax | minimax-portal)
      printf '%s\n' ".minimax"
      ;;
  esac
}

omnipolymath_live_should_include_auth_file_for_provider() {
  local provider
  provider="$(omnipolymath_live_trim "${1:-}")"
  case "$provider" in
    codex-cli | openai)
      printf '%s\n' ".codex/auth.json"
      printf '%s\n' ".codex/config.toml"
      ;;
    anthropic | claude-cli)
      printf '%s\n' ".claude.json"
      printf '%s\n' ".claude/.credentials.json"
      printf '%s\n' ".claude/settings.json"
      printf '%s\n' ".claude/settings.local.json"
      ;;
  esac
}

omnipolymath_live_collect_auth_dirs_from_csv() {
  local raw="${1:-}"
  local token
  [[ -n "$(omnipolymath_live_trim "$raw")" ]] || return 0
  IFS=',' read -r -a tokens <<<"$raw"
  for token in "${tokens[@]}"; do
    omnipolymath_live_should_include_auth_dir_for_provider "$token"
  done | awk 'NF && !seen[$0]++'
}

omnipolymath_live_collect_auth_dirs_from_override() {
  local raw token normalized
  raw="$(omnipolymath_live_trim "${OMNIPOLYMATH_DOCKER_AUTH_DIRS:-}")"
  [[ -n "$raw" ]] || return 1
  case "$raw" in
    all)
      printf '%s\n' "${OMNIPOLYMATH_DOCKER_LIVE_AUTH_ALL[@]}"
      return 0
      ;;
    none)
      return 0
      ;;
  esac
  IFS=',' read -r -a tokens <<<"$raw"
  for token in "${tokens[@]}"; do
    normalized="$(omnipolymath_live_normalize_auth_dir "$token")" || continue
    printf '%s\n' "$normalized"
  done | awk '!seen[$0]++'
  return 0
}

omnipolymath_live_collect_auth_dirs() {
  if omnipolymath_live_collect_auth_dirs_from_override; then
    return 0
  fi
  printf '%s\n' "${OMNIPOLYMATH_DOCKER_LIVE_AUTH_ALL[@]}"
}

omnipolymath_live_collect_auth_files_from_csv() {
  local raw="${1:-}"
  local token
  [[ -n "$(omnipolymath_live_trim "$raw")" ]] || return 0
  IFS=',' read -r -a tokens <<<"$raw"
  for token in "${tokens[@]}"; do
    omnipolymath_live_should_include_auth_file_for_provider "$token"
  done | awk 'NF && !seen[$0]++'
}

omnipolymath_live_collect_auth_files_from_override() {
  local raw
  raw="$(omnipolymath_live_trim "${OMNIPOLYMATH_DOCKER_AUTH_DIRS:-}")"
  [[ -n "$raw" ]] || return 1
  case "$raw" in
    all)
      printf '%s\n' "${OMNIPOLYMATH_DOCKER_LIVE_AUTH_FILES_ALL[@]}"
      return 0
      ;;
    none)
      return 0
      ;;
  esac
  return 0
}

omnipolymath_live_collect_auth_files() {
  if omnipolymath_live_collect_auth_files_from_override; then
    return 0
  fi
  printf '%s\n' "${OMNIPOLYMATH_DOCKER_LIVE_AUTH_FILES_ALL[@]}"
}

omnipolymath_live_join_csv() {
  local first=1 value
  for value in "$@"; do
    [[ -n "$value" ]] || continue
    if (( first )); then
      printf '%s' "$value"
      first=0
    else
      printf ',%s' "$value"
    fi
  done
}

omnipolymath_live_collect_auth_for_providers() {
  local providers="${1:-}"
  local provider_names
  provider_names="$(omnipolymath_live_trim "${providers//,/}")"
  AUTH_DIRS=()
  AUTH_FILES=()
  local auth_path
  if [[ -n "${OMNIPOLYMATH_DOCKER_AUTH_DIRS:-}" || -z "$provider_names" ]]; then
    while IFS= read -r auth_path; do
      [[ -n "$auth_path" ]] && AUTH_DIRS+=("$auth_path")
    done < <(omnipolymath_live_collect_auth_dirs)
    while IFS= read -r auth_path; do
      [[ -n "$auth_path" ]] && AUTH_FILES+=("$auth_path")
    done < <(omnipolymath_live_collect_auth_files)
    return
  fi
  while IFS= read -r auth_path; do
    [[ -n "$auth_path" ]] && AUTH_DIRS+=("$auth_path")
  done < <(omnipolymath_live_collect_auth_dirs_from_csv "$providers")
  while IFS= read -r auth_path; do
    [[ -n "$auth_path" ]] && AUTH_FILES+=("$auth_path")
  done < <(omnipolymath_live_collect_auth_files_from_csv "$providers")
}

omnipolymath_live_finalize_auth_mounts() {
  AUTH_DIRS_CSV=""
  if ((${#AUTH_DIRS[@]} > 0)); then
    AUTH_DIRS_CSV="$(omnipolymath_live_join_csv "${AUTH_DIRS[@]}")"
  fi
  AUTH_FILES_CSV=""
  if ((${#AUTH_FILES[@]} > 0)); then
    AUTH_FILES_CSV="$(omnipolymath_live_join_csv "${AUTH_FILES[@]}")"
  fi
  if [[ -n "${DOCKER_HOME_DIR:-}" ]]; then
    if ((${#AUTH_DIRS[@]} > 0)); then
      omnipolymath_live_stage_auth_into_home "$DOCKER_HOME_DIR" "${AUTH_DIRS[@]}"
    fi
    if ((${#AUTH_FILES[@]} > 0)); then
      omnipolymath_live_stage_auth_into_home "$DOCKER_HOME_DIR" --files "${AUTH_FILES[@]}"
    fi
    DOCKER_AUTH_PRESTAGED=1
  fi

  EXTERNAL_AUTH_MOUNTS=()
  local auth_path host_path
  if ((${#AUTH_DIRS[@]} > 0)); then
    for auth_path in "${AUTH_DIRS[@]}"; do
      auth_path="$(omnipolymath_live_validate_relative_home_path "$auth_path")" || return 1
      host_path="$HOME/$auth_path"
      [[ -d "$host_path" ]] && EXTERNAL_AUTH_MOUNTS+=(-v "$host_path:/host-auth/$auth_path:ro")
    done
  fi
  if ((${#AUTH_FILES[@]} > 0)); then
    for auth_path in "${AUTH_FILES[@]}"; do
      auth_path="$(omnipolymath_live_validate_relative_home_path "$auth_path")" || return 1
      host_path="$HOME/$auth_path"
      [[ -f "$host_path" ]] && EXTERNAL_AUTH_MOUNTS+=(-v "$host_path:/host-auth-files/$auth_path:ro")
    done
  fi
  return 0
}

omnipolymath_live_append_array() {
  local target_array="${1:?target array required}"
  local source_array="${2:?source array required}"
  local count

  eval "count=\${#${source_array}[@]}"
  if ((count == 0)); then
    return 0
  fi
  eval "${target_array}+=(\"\${${source_array}[@]}\")"
}

omnipolymath_live_append_default_env() {
  local prefix="$1" setting name fallback
  shift
  for setting in "$@"; do
    name="${prefix}${setting%%=*}"
    fallback="${setting#*=}"
    DOCKER_RUN_ARGS+=(-e "$name=${!name:-$fallback}")
  done
}

omnipolymath_live_require_build_extension() {
  local extension="${1:?extension required}"
  local current="${OMNIPOLYMATH_DOCKER_BUILD_EXTENSIONS:-${OMNIPOLYMATH_EXTENSIONS:-}}"
  case " $current " in
    *" $extension "*)
      ;;
    *)
      export OMNIPOLYMATH_DOCKER_BUILD_EXTENSIONS="${current:+$current }$extension"
      ;;
  esac
}

omnipolymath_live_timeout_supports_kill_after() {
  local timeout_bin="${1:?timeout binary required}"
  "$timeout_bin" --kill-after=1s 1s true >/dev/null 2>&1
}

omnipolymath_live_resource_limits_disabled() {
  omnipolymath_live_truthy "${OMNIPOLYMATH_LIVE_DOCKER_DISABLE_RESOURCE_LIMITS:-${OMNIPOLYMATH_DOCKER_E2E_DISABLE_RESOURCE_LIMITS:-}}"
}

omnipolymath_live_docker_run_resource_args() {
  local target_array="${1:?target array required}"
  eval "${target_array}=()"
  if omnipolymath_live_resource_limits_disabled; then
    return 0
  fi

  local memory="${OMNIPOLYMATH_LIVE_DOCKER_MEMORY:-${OMNIPOLYMATH_DOCKER_E2E_MEMORY:-8g}}"
  local cpus="${OMNIPOLYMATH_LIVE_DOCKER_CPUS:-${OMNIPOLYMATH_DOCKER_E2E_CPUS:-16}}"
  local pids_limit="${OMNIPOLYMATH_LIVE_DOCKER_PIDS_LIMIT:-${OMNIPOLYMATH_DOCKER_E2E_PIDS_LIMIT:-2048}}"
  local pids_limit_env="OMNIPOLYMATH_LIVE_DOCKER_PIDS_LIMIT"
  if [ -z "${OMNIPOLYMATH_LIVE_DOCKER_PIDS_LIMIT:-}" ]; then
    pids_limit_env="OMNIPOLYMATH_DOCKER_E2E_PIDS_LIMIT"
  fi
  cpus="$(docker_e2e_resolve_cpus "$cpus" "${OMNIPOLYMATH_LIVE_DOCKER_AVAILABLE_CPUS:-${OMNIPOLYMATH_DOCKER_E2E_AVAILABLE_CPUS:-}}")"

  if ! docker_e2e_resource_value_disabled "$memory"; then
    eval "${target_array}+=(--memory \"\$memory\")"
  fi
  if ! docker_e2e_resource_value_disabled "$cpus"; then
    eval "${target_array}+=(--cpus \"\$cpus\")"
  fi
  if ! docker_e2e_resource_value_disabled "$pids_limit"; then
    pids_limit="$(docker_e2e_resolve_pids_limit "$pids_limit" "$pids_limit_env")" || return $?
    eval "${target_array}+=(--pids-limit \"\$pids_limit\")"
  fi
}

omnipolymath_live_init_docker_run_args() {
  local target_array="${1:?target array required}"
  local timeout_value="${2:-${OMNIPOLYMATH_LIVE_DOCKER_RUN_TIMEOUT:-2700s}}"
  local resource_args=()
  local timeout_bin
  local quoted_timeout

  if ! timeout_bin="$(docker_e2e_timeout_bin)"; then
    echo "timeout command not found; cannot bound live Docker run after ${timeout_value}" >&2
    return 127
  fi
  quoted_timeout="$(printf '%q' "$timeout_value")"
  # Provider CLIs can leave orphaned tooling grandchildren; Docker init reaps
  # them so sequential Vitest process groups can join after teardown.
  if omnipolymath_live_timeout_supports_kill_after "$timeout_bin"; then
    eval "${target_array}=(${timeout_bin} --kill-after=30s ${quoted_timeout} docker run --init)"
  else
    eval "${target_array}=(${timeout_bin} ${quoted_timeout} docker run --init)"
  fi
  omnipolymath_live_docker_run_resource_args resource_args || return $?
  omnipolymath_live_append_array "$target_array" resource_args
}

omnipolymath_live_container_node_options() {
  local value
  value="$(omnipolymath_live_trim "${OMNIPOLYMATH_DOCKER_NODE_OPTIONS:-${NODE_OPTIONS:-}}")"
  if [[ -z "$value" ]]; then
    value="--max-old-space-size=4096"
  fi

  case " $value " in
    *" --dns-result-order="*)
      ;;
    *)
      value="$value --dns-result-order=ipv4first"
      ;;
  esac

  case " $value " in
    *" --disable-warning=ExperimentalWarning "*)
      ;;
    *)
      value="$value --disable-warning=ExperimentalWarning"
      ;;
  esac

  printf '%s\n' "$value"
}

omnipolymath_live_stage_auth_into_home() {
  local dest_home="${1:?destination home directory required}"
  shift

  local mode="dirs"
  local relative_path source_path dest_path

  mkdir -p "$dest_home"
  chmod u+rwx "$dest_home" || true

  while (($# > 0)); do
    case "$1" in
      --files)
        mode="files"
        shift
        continue
        ;;
    esac

    relative_path="$(omnipolymath_live_validate_relative_home_path "$1")" || return 1
    source_path="$HOME/$relative_path"
    dest_path="$dest_home/$relative_path"

    if [[ "$mode" == "dirs" ]]; then
      if [[ -d "$source_path" ]]; then
        mkdir -p "$dest_path"
        cp -R "$source_path"/. "$dest_path"
        chmod -R u+rwX "$dest_path" || true
      fi
    else
      if [[ -f "$source_path" ]]; then
        mkdir -p "$(dirname "$dest_path")"
        cp "$source_path" "$dest_path"
        chmod u+rw "$dest_path" || true
      fi
    fi

    shift
  done
}

omnipolymath_live_prepare_bind_dir_for_container_user() {
  local dir="${1:?directory required}"

  mkdir -p "$dir"
  chmod u+rwx "$dir" || true
}

omnipolymath_live_stage_profile_into_home() {
  local dest_home="${1:?destination home directory required}"
  local profile_file="${2:?profile file required}"

  [[ -f "$profile_file" && -r "$profile_file" ]] || return 1
  mkdir -p "$dest_home"
  cp "$profile_file" "$dest_home/.profile"
  chmod u+rw "$dest_home/.profile" || true
}

omnipolymath_live_chown_bind_dirs_for_container_user() {
  local image_name="${1:?image name required}"
  local container_user="${2:?container user required}"
  shift 2

  local mount_args=()
  local index=0
  local dir
  for dir in "$@"; do
    [[ -n "$dir" ]] || continue
    mkdir -p "$dir"
    mount_args+=(-v "$dir:/omnipolymath-bind-dir-$index")
    index=$((index + 1))
  done
  ((index > 0)) || return 0

  local resource_args=()
  omnipolymath_live_docker_run_resource_args resource_args || return $?

  docker run --rm \
    ${resource_args[@]+"${resource_args[@]}"} \
    -u 0:0 \
    --entrypoint sh \
    -e OMNIPOLYMATH_BIND_DIR_USER="$container_user" \
    "${mount_args[@]}" \
    "$image_name" \
    -c 'for dir in /omnipolymath-bind-dir-*; do chown -R "$OMNIPOLYMATH_BIND_DIR_USER" "$dir"; done'
}
