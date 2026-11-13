#!/usr/bin/env bash
# Bash 5.3+ can deadlock writing heredoc pipes on macOS before the reader starts.
if [[ ${OSTYPE:-} == darwin* && $BASH != /bin/bash ]] && ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 3))); then
  exec /bin/bash "$0" "$@"
fi
set -euo pipefail

PACKAGE_TGZ=""
AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT=""
UPGRADE_SCENARIO_STAGE=""
WORKER_RUNTIME_HOST_ROOT=""
LIMITS_SUMMARY=""
run_completed="0"
diagnostics_ready=0
is_scheduler_installed_recovery() {
  # Only the scheduler's retained producer identity assigns host finalization.
  [ -n "${DOCKER_E2E_CONTAINER_CIDFILE:-}" ]
}
cleanup_outer() {
  local exit_status="$?"
  trap - EXIT
  set +e
  # Bash 3.2 can enter EXIT with status 0 after a fatal nounset expansion.
  # Only a successfully joined scenario may turn cleanup into a successful exit.
  if [ "$exit_status" -eq 0 ] && [ "$run_completed" != "1" ]; then
    echo "Upgrade survivor exited before the scenario completed." >&2
    exit_status=1
  fi
  # These finite scheduler cells publish after the lane group is joined. Its
  # timeout can kill this shell, so it must not own the required host receipt.
  local scheduler_recovery=0
  if is_scheduler_installed_recovery; then
    scheduler_recovery=1
  fi
  if [ "$exit_status" -ne 0 ] && [ "$scheduler_recovery" = "0" ]; then
    if [ "$diagnostics_ready" = "1" ]; then
      publish_diagnostics ||
        echo "Upgrade survivor diagnostics missing; preserving original lane failure." >&2
    else
      echo "Upgrade survivor diagnostics missing: no private capture prepared." >&2
    fi
  fi
  if [ "$exit_status" -eq 0 ] && [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" = "1" ] && [ "$diagnostics_ready" = "1" ]; then
    publish_diagnostics passed ||
      echo "Upgrade survivor diagnostics missing: successful receipt was not published." >&2
  fi
  if [ -n "$PACKAGE_TGZ" ]; then
    docker_e2e_cleanup_package_tgz "$PACKAGE_TGZ"
  fi
  if [ -n "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" ]; then
    rm -rf "$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT"
  fi
  if [ -n "$UPGRADE_SCENARIO_STAGE" ]; then
    rm -rf "$UPGRADE_SCENARIO_STAGE"
  fi
  if [ -n "$WORKER_RUNTIME_HOST_ROOT" ]; then
    if [ "$exit_status" -eq 0 ] && [ "$run_completed" = "1" ]; then
      # The image user owns the private child and can differ from the host user.
      if ! docker_e2e_docker_cmd run --rm --network none \
        --entrypoint rm \
        -v "$WORKER_RUNTIME_HOST_ROOT:/tmp/omnipolymath-worker-cleanup" \
        "$IMAGE_NAME" -rf -- /tmp/omnipolymath-worker-cleanup/runtime ||
        ! rm -rf "$WORKER_RUNTIME_HOST_ROOT"; then
        echo "Worker-cell runtime cleanup failed: $WORKER_RUNTIME_HOST_ROOT" >&2
        exit_status=1
      fi
    else
      echo "Preserved failed synthetic worker-cell state: $WORKER_RUNTIME_HOST_ROOT" >&2
    fi
  fi
  if [ "$exit_status" -ne 0 ]; then
    printf '[upgrade-survivor] FAILED (exit %s)\n' "$exit_status" >&2
  fi
  if [ -n "$LIMITS_SUMMARY" ]; then
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ] && [ -s "$LIMITS_SUMMARY" ]; then
      cat "$LIMITS_SUMMARY" >> "$GITHUB_STEP_SUMMARY" || exit_status=1
    fi
    rm -f "$LIMITS_SUMMARY"
  fi
  exit "$exit_status"
}
trap cleanup_outer EXIT

HARNESS_ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT_DIR="$(cd "${OMNIPOLYMATH_DOCKER_E2E_REPO_ROOT:-$HARNESS_ROOT_DIR}" && pwd)"
DOCKER_E2E_HARNESS_ROOT_DIR="$HARNESS_ROOT_DIR"
source "$HARNESS_ROOT_DIR/scripts/lib/docker-e2e-image.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/docker-e2e-package.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/upgrade-survivor-diagnostics.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/omnipolymath-e2e-instance.sh"
source "$HARNESS_ROOT_DIR/scripts/lib/frozen-target-compat.sh"
source "$HARNESS_ROOT_DIR/scripts/e2e/lib/prepublish-plugin-registry.sh"

UPGRADE_SCENARIO_ARGS=()
UPGRADE_COMPAT_ENV_ARGS=()
UPGRADE_SCENARIO_STAGE=""
UPGRADE_RUNNER="$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/run.sh"
UPGRADE_SCENARIO_DIR=""
UPGRADE_TARGET_TRAIN=""
UPGRADE_TRUSTED_ASSERTIONS="scripts/e2e/lib/upgrade-survivor/assertions.mjs"
UPGRADE_TRUSTED_DIAGNOSTICS="/app/scripts/e2e/lib/upgrade-survivor/diagnostics.mjs"
context_status=0
omnipolymath_prepare_frozen_target_context "$ROOT_DIR" || context_status=$?
case "$context_status" in
  0)
    UPGRADE_TARGET_TRAIN="$(node --input-type=module - "$ROOT_DIR" "$OMNIPOLYMATH_SELECTED_SHA" "$HARNESS_ROOT_DIR/scripts/lib/release-version.mjs" <<'NODE'
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const [root, sha, classifier] = process.argv.slice(2);
const { parseReleaseVersion, classifyReleaseTrain } = await import(pathToFileURL(classifier).href);
const { version } = JSON.parse(execFileSync("git", ["-C", root, "show", `${sha}:package.json`], { encoding: "utf8" }));
const parsed = typeof version === "string" ? parseReleaseVersion(version) : null;
if (!parsed) throw new Error("Selected upgrade target has an invalid release version.");
const train = classifyReleaseTrain(parsed);
if (train === "unsupported-extended-stable-correction") {
  throw new Error("Selected extended-stable target has an unsupported correction version.");
}
process.stdout.write(train);
NODE
)"
    ;;
  1) ;;
  *) exit "$context_status" ;;
esac
omnipolymath_resolve_frozen_upgrade_survivor_capabilities "$ROOT_DIR"
UPGRADE_COMPAT_ENV_ARGS+=(
  -e "OMNIPOLYMATH_FROZEN_UPGRADE_SURVIVOR_TOOL_SEARCH_RECIPE=$OMNIPOLYMATH_FROZEN_UPGRADE_SURVIVOR_TOOL_SEARCH_RECIPE"
  -e "OMNIPOLYMATH_FROZEN_UPGRADE_SURVIVOR_MEMBERSHIP_MODE=$OMNIPOLYMATH_FROZEN_UPGRADE_SURVIVOR_MEMBERSHIP_MODE"
)
if [ -n "${OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_IDEMPOTENCE_BUDGET_SECONDS:-}" ]; then
  UPGRADE_COMPAT_ENV_ARGS+=(-e "OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_IDEMPOTENCE_BUDGET_SECONDS=$OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_IDEMPOTENCE_BUDGET_SECONDS")
fi
if [ "$UPGRADE_TARGET_TRAIN" = extended-stable ]; then
  if [ -n "${OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_MODELS:-}" ]; then
    echo "Selected extended-stable target does not support OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_MODELS with its frozen upgrade survivor runner." >&2
    exit 2
  elif [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI:-0}" = "1" ]; then
    echo "Selected extended-stable target does not support OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI with its frozen upgrade survivor runner." >&2
    exit 2
  fi
  # Extended-stable retains shipped state expectations. Regular releases keep
  # the trusted runner and its serving-turn/post-inference assertions together.
  UPGRADE_SCENARIO_DIR="$(omnipolymath_resolve_frozen_target_file \
    "$ROOT_DIR" scripts/e2e/lib/upgrade-survivor)"
  if [ -z "$UPGRADE_SCENARIO_DIR" ]; then
    echo "Selected extended-stable target does not provide an upgrade scenario." >&2
    exit 2
  fi
  UPGRADE_RUNNER="$UPGRADE_SCENARIO_DIR/run.sh"
  UPGRADE_TRUSTED_ASSERTIONS="/tmp/omnipolymath-release-harness/scripts/e2e/lib/upgrade-survivor/assertions.mjs"
  UPGRADE_TRUSTED_DIAGNOSTICS="/tmp/omnipolymath-release-harness/scripts/e2e/lib/upgrade-survivor/diagnostics.mjs"
  UPGRADE_NPM_PUBLISH_PLAN="$(omnipolymath_resolve_frozen_target_file \
    "$ROOT_DIR" scripts/lib/npm-publish-plan.mjs)"
  UPGRADE_WINDOWS_HELPERS="$(omnipolymath_resolve_frozen_target_file \
    "$ROOT_DIR" scripts/windows-cmd-helpers.mjs)"
  DOCKER_E2E_WINDOWS_HELPERS_PATH="$UPGRADE_WINDOWS_HELPERS"
  UPGRADE_BOUNDED_RESPONSE="$HARNESS_ROOT_DIR/scripts/lib/bounded-response.mjs"
  UPGRADE_DIAGNOSTICS="$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/diagnostics.mjs"
  UPGRADE_NPM_REGISTRY_SERVER="$HARNESS_ROOT_DIR/scripts/e2e/lib/plugins/npm-registry-server.mjs"
  UPGRADE_PLUGIN_INDEX="$(omnipolymath_resolve_frozen_target_file \
    "$ROOT_DIR" scripts/e2e/lib/plugin-index-sqlite.mjs)"
  UPGRADE_ENV_LIMITS="$(omnipolymath_resolve_frozen_target_file \
    "$ROOT_DIR" scripts/e2e/lib/env-limits.mjs)"
  UPGRADE_TEXT_FILE_UTILS="$(omnipolymath_resolve_frozen_target_file \
    "$ROOT_DIR" scripts/e2e/lib/text-file-utils.mjs)"
  # Build the complete scenario tree before mounting it read-only. A nested
  # diagnostics bind cannot create its destination beneath a read-only mount.
  UPGRADE_SCENARIO_STAGE="$(mktemp -d "${TMPDIR:-/tmp}/omnipolymath-upgrade-scenario.XXXXXX")"
  cp -R "$UPGRADE_SCENARIO_DIR/." "$UPGRADE_SCENARIO_STAGE/"
  cp "$UPGRADE_DIAGNOSTICS" "$UPGRADE_SCENARIO_STAGE/diagnostics.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/backup-rollback-summary.mjs" "$UPGRADE_SCENARIO_STAGE/backup-rollback-summary.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/native-assignment-summary.mjs" "$UPGRADE_SCENARIO_STAGE/native-assignment-summary.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/plugin-policy-summary.mjs" "$UPGRADE_SCENARIO_STAGE/plugin-policy-summary.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/observations.mjs" "$UPGRADE_SCENARIO_STAGE/observations.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/installed-recovery-observations.mjs" "$UPGRADE_SCENARIO_STAGE/installed-recovery-observations.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/installed-recovery-cases.mjs" "$UPGRADE_SCENARIO_STAGE/installed-recovery-cases.mjs"
  cp "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/package-activation-recovery.mjs" "$UPGRADE_SCENARIO_STAGE/package-activation-recovery.mjs"
  chmod 0755 "$UPGRADE_SCENARIO_STAGE"
  UPGRADE_SCENARIO_ARGS+=(
    -v "$UPGRADE_SCENARIO_STAGE:/app/scripts/e2e/lib/upgrade-survivor:ro"
    -v "$UPGRADE_NPM_REGISTRY_SERVER:/app/scripts/e2e/lib/plugins/npm-registry-server.mjs:ro"
    -v "$UPGRADE_NPM_PUBLISH_PLAN:/app/scripts/lib/npm-publish-plan.mjs:ro"
    -v "$UPGRADE_BOUNDED_RESPONSE:/app/scripts/lib/bounded-response.mjs:ro"
    -v "$UPGRADE_PLUGIN_INDEX:/app/scripts/e2e/lib/plugin-index-sqlite.mjs:ro"
    -v "$UPGRADE_ENV_LIMITS:/app/scripts/e2e/lib/env-limits.mjs:ro"
    -v "$UPGRADE_TEXT_FILE_UTILS:/app/scripts/e2e/lib/text-file-utils.mjs:ro"
  )
fi

IMAGE_NAME="$(docker_e2e_resolve_image "omnipolymath-upgrade-survivor-e2e" OMNIPOLYMATH_UPGRADE_SURVIVOR_E2E_IMAGE)"
SKIP_BUILD="${OMNIPOLYMATH_UPGRADE_SURVIVOR_E2E_SKIP_BUILD:-0}"
DOCKER_RUN_TIMEOUT="${OMNIPOLYMATH_UPGRADE_SURVIVOR_DOCKER_RUN_TIMEOUT:-1200s}"
BASELINE_SPEC="${OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE_SPEC:-}"
SCENARIO="${OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIO:-base}"
SURVIVOR_RUNTIME_ROOT="${OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT:-/tmp/omnipolymath-upgrade-survivor-runtime}"
UPDATE_RESTART_MODE="${OMNIPOLYMATH_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE:-manual}"
if [ "$SCENARIO" = "abandoned-update" ] && [ -z "${OMNIPOLYMATH_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE:-}" ]; then
  UPDATE_RESTART_MODE="auto-auth"
fi
COMMAND_TIMEOUT="${OMNIPOLYMATH_UPGRADE_SURVIVOR_COMMAND_TIMEOUT:-900s}"
START_BUDGET_SECONDS="$(omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_START_BUDGET_SECONDS 300)"
STATUS_BUDGET_SECONDS="$(omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS 30)"
PROBE_TIMEOUT_MS="$(omnipolymath_e2e_read_nonnegative_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_PROBE_TIMEOUT_MS 60000)"
PROBE_ATTEMPT_TIMEOUT_MS="$(
  omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_PROBE_ATTEMPT_TIMEOUT_MS 5000
)"
PROBE_MAX_BODY_BYTES="$(
  omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_PROBE_MAX_BODY_BYTES 1048576
)"
ROOT_MANAGED_VPS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS:-0}"
LIVE_MODEL_ROWS="$(node "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/live-models.mjs" rows)"
LIVE_ENABLED=0
LIVE_MODEL_ENV_ARGS=()
if [ -n "$LIVE_MODEL_ROWS" ]; then
  LIVE_ENABLED=1
  if [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
    echo "Live survivor turns require OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
    exit 2
  fi
  LIVE_MODEL_TIMEOUT_SECONDS="$(
    omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI_TIMEOUT_SECONDS 180
  )"
  LIVE_MODEL_ENV_ARGS=(
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_MODELS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_MODELS:-}"
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI="${OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI:-0}"
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI_MODEL="${OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI_MODEL:-openai/gpt-5.5}"
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_LIVE_OPENAI_TIMEOUT_SECONDS="$LIVE_MODEL_TIMEOUT_SECONDS"
  )
  while IFS=$'\t' read -r live_model live_provider live_key_env live_artifact; do
    LIVE_MODEL_ENV_ARGS+=(-e "$live_key_env")
  done <<<"$LIVE_MODEL_ROWS"
fi

if { [ "$SCENARIO" = "sqlite-volume" ] || [ "$SCENARIO" = "recovery-cleanup" ] || [ "$SCENARIO" = "legacy-operator-state" ] || [ "$SCENARIO" = "cron-scheduled-authority" ]; } && [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
  echo "$SCENARIO requires OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
  exit 1
fi
if [ "$SCENARIO" = "mobile-pairing-reconnect" ] && [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
  echo "mobile-pairing-reconnect requires OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
  exit 1
fi
if [ "$SCENARIO" = "recovery-cleanup" ] && { [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ]; }; then
  echo "recovery-cleanup requires the isolated manual-restart fixture without live provider credentials" >&2
  exit 1
fi
if [ "$SCENARIO" = "mobile-pairing-reconnect" ] && { [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ]; }; then
  echo "mobile-pairing-reconnect requires the isolated manual-restart fixture without live provider credentials" >&2
  exit 1
fi

if [ "$SCENARIO" = "abandoned-update" ] && {
  [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ] ||
  [ "$UPDATE_RESTART_MODE" != "auto-auth" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ];
}; then
  echo "abandoned-update requires the published baseline, auto-auth service fixture, and no live provider" >&2
  exit 1
fi

# Current-writer interruption proof is separate from released baseline coverage.
# In particular, do not normalize a file tarball into a historical release cell.
if [ "$SCENARIO" = "package-installed-recovery" ] && {
  [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "0" ] ||
  [ -n "$BASELINE_SPEC" ] || [ "$UPDATE_RESTART_MODE" != "manual" ] ||
  [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ];
}; then
  echo "package-installed-recovery requires an isolated current packed writer, manual restart, and no live provider" >&2
  exit 1
fi

if [ "$SCENARIO" = "projects-doctor" ] || [ "$SCENARIO" = "projects-startup-migration" ] || [ "$SCENARIO" = "cron-owner-doctor" ]; then
  worker_baseline_supported=0
  if [ "$BASELINE_SPEC" = "omnipolymath@2026.9.4" ] ||
    { [ "$SCENARIO" = "cron-owner-doctor" ] && [ "$BASELINE_SPEC" = "omnipolymath@2026.9.7" ]; }; then
    worker_baseline_supported=1
  fi
  if [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ] ||
    [ "$worker_baseline_supported" != "1" ] ||
    [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ]; then
    echo "$SCENARIO requires its audited published baseline, manual restart, isolated state, and no live provider" >&2
    exit 1
  fi
fi

if [ "$SCENARIO" = "workshop-doctor-recovery" ] && {
  [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ] ||
  [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ];
}; then
  echo "workshop-doctor-recovery requires the published baseline, manual restart, and no live provider" >&2
  exit 1
fi

if [ "$SCENARIO" = "dreaming-cron-doctor" ] && {
  [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ] ||
  [ "$BASELINE_SPEC" != "omnipolymath@2026.9.6" ] ||
  [ "$UPDATE_RESTART_MODE" != "manual" ] || [ "$ROOT_MANAGED_VPS" != "0" ] || [ "$LIVE_ENABLED" != "0" ];
}; then
  echo "dreaming-cron-doctor requires published omnipolymath@2026.9.6, manual restart, isolated state, and no live provider" >&2
  exit 1
fi

resolve_lane_artifact_suffix() {
  if [ -n "${OMNIPOLYMATH_DOCKER_ALL_LANE_NAME:-}" ]; then
    printf "%s" "$OMNIPOLYMATH_DOCKER_ALL_LANE_NAME"
    return
  fi

  if [ "$ROOT_MANAGED_VPS" = "1" ]; then
    printf "root-managed-vps-upgrade"
  elif [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
    printf "update-restart-auth"
  elif [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" = "1" ]; then
    printf "published-upgrade-survivor"
  else
    printf "upgrade-survivor"
  fi

  if [ -n "${BASELINE_SPEC// }" ]; then
    printf -- "-%s" "$BASELINE_SPEC"
  fi
  if [ "$SCENARIO" != "base" ]; then
    printf -- "-%s" "$SCENARIO"
  fi
}

LANE_ARTIFACT_SUFFIX="$(resolve_lane_artifact_suffix)"
LANE_ARTIFACT_SUFFIX="${LANE_ARTIFACT_SUFFIX//[^A-Za-z0-9_.-]/_}"
ARTIFACT_DIR="${OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_DIR:-$ROOT_DIR/.artifacts/upgrade-survivor/$LANE_ARTIFACT_SUFFIX}"
UPGRADE_LIMITS_ARGS=()
prepare_limit_summary() {
  if [ "${GITHUB_ACTIONS:-}" != "true" ]; then
    return 0
  fi
  LIMITS_SUMMARY="$(mktemp "$ARTIFACT_DIR/limit-warnings.XXXXXX")"
  chmod 666 "$LIMITS_SUMMARY"
  UPGRADE_LIMITS_ARGS=(
    -e GITHUB_ACTIONS
    -e GITHUB_STEP_SUMMARY=/tmp/omnipolymath-limits-summary.md
    -v "$LIMITS_SUMMARY:/tmp/omnipolymath-limits-summary.md"
  )
}
DOCKER_RUN_USER_ARGS=()
UPGRADE_ENTRYPOINT=()
if [ "$UPDATE_RESTART_MODE" = auto-auth ] ||
  { [ "$SCENARIO" = package-installed-recovery ] && [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_INSTALLED_RECOVERY_CUT:-}" = older-runtime ]; }; then
  # MAC_OVERRIDE permits replacing unconfined; the entrypoint drops every capability.
  DOCKER_RUN_USER_ARGS+=(--user root --cgroupns private --cap-add SYS_ADMIN --cap-add MAC_OVERRIDE --security-opt apparmor=unconfined)
  UPGRADE_ENTRYPOINT=(bash /tmp/omnipolymath-release-harness/scripts/e2e/lib/upgrade-survivor/cgroup-entrypoint.sh)
fi
PROBE_ENV_ARGS=(
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_PROBE_TIMEOUT_MS="$PROBE_TIMEOUT_MS"
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_PROBE_ATTEMPT_TIMEOUT_MS="$PROBE_ATTEMPT_TIMEOUT_MS"
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_PROBE_MAX_BODY_BYTES="$PROBE_MAX_BODY_BYTES"
)
if [ -n "${OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING:-}" ]; then
  PROBE_ENV_ARGS+=(
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING="$OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING"
  )
fi
if [ -n "${OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED:-}" ]; then
  PROBE_ENV_ARGS+=(
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED="$OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED"
  )
fi
if [ "$ROOT_MANAGED_VPS" = "1" ]; then
  if [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" != "1" ]; then
    echo "OMNIPOLYMATH_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS=1 requires OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE=1" >&2
    exit 1
  fi
  DOCKER_RUN_USER_ARGS+=(--user root -e HOME=/root -e USER=root)
fi

normalize_npm_candidate() {
  local raw="$1"
  case "$raw" in
    omnipolymath@*)
      printf '%s\n' "$raw"
      ;;
    *@*)
      echo "OMNIPOLYMATH_UPGRADE_SURVIVOR_CANDIDATE must be current, latest, beta, omnipolymath@<version>, a bare version, or a .tgz path." >&2
      return 1
      ;;
    *)
      printf 'omnipolymath@%s\n' "$raw"
      ;;
  esac
}

if [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_PUBLISHED_BASELINE:-0}" = "1" ]; then
  if [ -z "${BASELINE_SPEC// }" ]; then
    echo "OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE_SPEC is required for published upgrade survivor" >&2
    exit 1
  fi

  mkdir -p "$ARTIFACT_DIR"
  if [ "$SCENARIO" = "projects-doctor" ] || [ "$SCENARIO" = "projects-startup-migration" ] || [ "$SCENARIO" = "cron-owner-doctor" ]; then
    ARTIFACT_DIR="$(mktemp -d "$ARTIFACT_DIR/worker-run.XXXXXX")"
    echo "Worker survivor artifacts: $ARTIFACT_DIR"
  fi
  chmod -R a+rwX "$ARTIFACT_DIR" || true
  prepare_diagnostics_capture
  prepare_limit_summary

  DOCKER_E2E_PACKAGE_ARGS=()
  CANDIDATE_RAW="${OMNIPOLYMATH_UPGRADE_SURVIVOR_CANDIDATE:-current}"
  CANDIDATE_KIND="npm"
  CANDIDATE_IS_CURRENT=0
  CANDIDATE_SPEC=""

  if [ -n "${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:-}" ] || [ "$CANDIDATE_RAW" = "current" ]; then
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor)"
    CANDIDATE_KIND="tarball"
    CANDIDATE_IS_CURRENT=1
    CANDIDATE_SPEC="/tmp/omnipolymath-current.tgz"
  elif [[ "$CANDIDATE_RAW" == *.tgz ]]; then
    if [ ! -f "$CANDIDATE_RAW" ]; then
      echo "Omnipolymath candidate tarball does not exist: $CANDIDATE_RAW" >&2
      exit 1
    fi
    PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor "$CANDIDATE_RAW")"
    CANDIDATE_KIND="tarball"
    CANDIDATE_SPEC="/tmp/omnipolymath-current.tgz"
  else
    CANDIDATE_SPEC="$(normalize_npm_candidate "$CANDIDATE_RAW")"
  fi

  if { [ "$SCENARIO" = "projects-doctor" ] || [ "$SCENARIO" = "projects-startup-migration" ] || [ "$SCENARIO" = "cron-owner-doctor" ] || [ "$SCENARIO" = "dreaming-cron-doctor" ]; } && [ "$CANDIDATE_KIND" != "tarball" ]; then
    echo "$SCENARIO requires a frozen candidate tarball" >&2
    exit 1
  fi

  if [ "$CANDIDATE_IS_CURRENT" = "1" ] && [ -z "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    registry_required="$(
      OMNIPOLYMATH_DOCKER_ALL_LANES=published-upgrade-survivor \
        OMNIPOLYMATH_DOCKER_ALL_TIMINGS=0 \
        OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE_SPECS="$BASELINE_SPEC" \
        OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIOS="$SCENARIO" \
        node "$HARNESS_ROOT_DIR/scripts/test-docker-all.mjs" --plan-json | node -e '
          const plan = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
          const required = plan.needs?.prepublishPluginRegistry;
          if (typeof required !== "boolean") throw new Error("Docker planner omitted plugin registry requirements");
          process.stdout.write(required ? "1" : "0");
        '
    )"
    if [ "$registry_required" = "1" ]; then
      AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT="$(
        mktemp -d "${TMPDIR:-/tmp}/omnipolymath-upgrade-survivor-plugin-registry.XXXXXX"
      )"
      OMNIPOLYMATH_DOCKER_ALL_LANES=published-upgrade-survivor \
        OMNIPOLYMATH_DOCKER_ALL_LOG_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" \
        OMNIPOLYMATH_DOCKER_ALL_TIMINGS=0 \
        OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE_SPECS="$BASELINE_SPEC" \
        OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIOS="$SCENARIO" \
        node "$HARNESS_ROOT_DIR/scripts/test-docker-all.mjs" --prepare-plugin-registry
      export OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT/prepublish-plugin-registry"
    fi
  fi

  if [ -n "$PACKAGE_TGZ" ]; then
    docker_e2e_package_mount_args "$PACKAGE_TGZ"
  elif [ -n "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
    omnipolymath_prepublish_plugin_registry_configure_docker_args "$OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR"
    DOCKER_E2E_PACKAGE_ARGS=("${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DOCKER_ARGS[@]}")
  fi

  OMNIPOLYMATH_TEST_STATE_FUNCTION_B64="$(docker_e2e_test_state_function_b64)"

  if [ "$SCENARIO" = "projects-startup-migration" ]; then
    if [ ! -f "${OMNIPOLYMATH_UPGRADE_SURVIVOR_STARTUP_BINDINGS:-}" ]; then
      echo "projects-startup-migration requires reviewed candidate bindings via OMNIPOLYMATH_UPGRADE_SURVIVOR_STARTUP_BINDINGS" >&2
      exit 1
    fi
    startup_bindings="$(cd "$(dirname "$OMNIPOLYMATH_UPGRADE_SURVIVOR_STARTUP_BINDINGS")" && pwd)/$(basename "$OMNIPOLYMATH_UPGRADE_SURVIVOR_STARTUP_BINDINGS")"
    UPGRADE_SCENARIO_ARGS+=(
      -v "$startup_bindings:/tmp/omnipolymath-project-startup-bindings.json:ro"
      -e OMNIPOLYMATH_UPGRADE_SURVIVOR_STARTUP_BINDINGS=/tmp/omnipolymath-project-startup-bindings.json
    )
  fi

  if [ "$SCENARIO" = "projects-doctor" ] || [ "$SCENARIO" = "projects-startup-migration" ] || [ "$SCENARIO" = "cron-owner-doctor" ]; then
    WORKER_RUNTIME_HOST_ROOT="$(mktemp -d "$ARTIFACT_DIR/worker-runtime.XXXXXX")"
    chmod a+rwx "$WORKER_RUNTIME_HOST_ROOT"
    UPGRADE_SCENARIO_ARGS+=(
      -v "$WORKER_RUNTIME_HOST_ROOT:$SURVIVOR_RUNTIME_ROOT"
    )
    # The container user creates/owns the private child, not the host mount point.
    SURVIVOR_RUNTIME_ROOT="$SURVIVOR_RUNTIME_ROOT/runtime"
  fi

  docker_e2e_build_or_reuse "$IMAGE_NAME" upgrade-survivor "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "bare" "$SKIP_BUILD"
  if [ "$UPDATE_RESTART_MODE" = auto-auth ]; then
    # Have Docker load its default AppArmor profile before the setup process reattaches it.
    docker_e2e_docker_cmd run --rm --network none --entrypoint true "$IMAGE_NAME"
  fi

  echo "Running published upgrade survivor Docker E2E..."
  # Keep candidate images from selecting an older copy of the trusted release runner.
  docker_e2e_run_with_harness \
    --init \
    ${UPGRADE_LIMITS_ARGS[@]+"${UPGRADE_LIMITS_ARGS[@]}"} \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e OMNIPOLYMATH_TEST_STATE_FUNCTION_B64="$OMNIPOLYMATH_TEST_STATE_FUNCTION_B64" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE="$BASELINE_SPEC" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_CANDIDATE_KIND="$CANDIDATE_KIND" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_CANDIDATE_SPEC="$CANDIDATE_SPEC" \
    -e OMNIPOLYMATH_DOCKER_E2E_SELECTED_SHA="${OMNIPOLYMATH_DOCKER_E2E_SELECTED_SHA:-}" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIO="$SCENARIO" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT="$SURVIVOR_RUNTIME_ROOT" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE="$UPDATE_RESTART_MODE" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_COMMAND_TIMEOUT="$COMMAND_TIMEOUT" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_SESSIONS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_SESSIONS:-}" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_EVENTS_PER_SESSION="${OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_EVENTS_PER_SESSION:-}" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_CRON_JOBS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_VOLUME_CRON_JOBS:-}" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_LEGACY_RUNTIME_DEPS_SYMLINK="${OMNIPOLYMATH_UPGRADE_SURVIVOR_LEGACY_RUNTIME_DEPS_SYMLINK:-}" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS="$ROOT_MANAGED_VPS" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_TSX_IMPORT=/usr/local/lib/node_modules/tsx/dist/loader.mjs \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_SUMMARY_JSON=/tmp/omnipolymath-upgrade-survivor-artifacts/summary.json \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_START_BUDGET_SECONDS="$START_BUDGET_SECONDS" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS="$STATUS_BUDGET_SECONDS" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER=/tmp/omnipolymath-clawhub-fixture-server.cjs \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER=/tmp/omnipolymath-config-parking.mjs \
    -e OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_SERVER_SCRIPT=/tmp/omnipolymath-release-harness/scripts/e2e/lib/plugins/npm-registry-server.mjs \
    ${UPGRADE_COMPAT_ENV_ARGS[@]+"${UPGRADE_COMPAT_ENV_ARGS[@]}"} \
    "${PROBE_ENV_ARGS[@]}" \
    ${LIVE_MODEL_ENV_ARGS[@]+"${LIVE_MODEL_ENV_ARGS[@]}"} \
    -v "$ARTIFACT_DIR:/tmp/omnipolymath-upgrade-survivor-artifacts" \
    -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/clawhub-fixture-server.cjs:/tmp/omnipolymath-clawhub-fixture-server.cjs:ro" \
    -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/config-parking.mjs:/tmp/omnipolymath-config-parking.mjs:ro" \
    -v "$HARNESS_ROOT_DIR/scripts:/tmp/omnipolymath-release-harness/scripts:ro" \
    -v "$UPGRADE_RUNNER:/tmp/omnipolymath-upgrade-survivor-run.sh:ro" \
    ${UPGRADE_SCENARIO_ARGS[@]+"${UPGRADE_SCENARIO_ARGS[@]}"} \
    ${DOCKER_E2E_PACKAGE_ARGS[@]+"${DOCKER_E2E_PACKAGE_ARGS[@]}"} \
    ${DOCKER_RUN_USER_ARGS[@]+"${DOCKER_RUN_USER_ARGS[@]}"} \
    "$IMAGE_NAME" \
    ${UPGRADE_ENTRYPOINT[@]+"${UPGRADE_ENTRYPOINT[@]}"} \
    timeout --kill-after=30s "$DOCKER_RUN_TIMEOUT" bash /tmp/omnipolymath-upgrade-survivor-run.sh
  run_completed="1"
  exit 0
fi

PACKAGE_TGZ="$(docker_e2e_prepare_package_tgz upgrade-survivor "${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:-}")"
if [ "$SCENARIO" != "package-installed-recovery" ] && [ -z "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ]; then
  AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT="$(
    mktemp -d "${TMPDIR:-/tmp}/omnipolymath-upgrade-survivor-plugin-registry.XXXXXX"
  )"
  planner_lane="upgrade-survivor"
  if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
    planner_lane="update-restart-auth"
  fi
  OMNIPOLYMATH_DOCKER_ALL_LANES="$planner_lane" \
    OMNIPOLYMATH_DOCKER_ALL_LOG_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT" \
    OMNIPOLYMATH_DOCKER_ALL_TIMINGS=0 \
    OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIOS="$SCENARIO" \
    node "$HARNESS_ROOT_DIR/scripts/test-docker-all.mjs" --prepare-plugin-registry
  export OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR="$AUTO_PREPUBLISH_PLUGIN_REGISTRY_ROOT/prepublish-plugin-registry"
fi
docker_e2e_package_mount_args "$PACKAGE_TGZ"
OMNIPOLYMATH_TEST_STATE_FUNCTION_B64="$(docker_e2e_test_state_function_b64)"
mkdir -p "$ARTIFACT_DIR"
if is_scheduler_installed_recovery; then
  # The host owns the private outer directory and setgid evidence mount. Keep
  # appuser/HOME unchanged; only this group can read new private producer files.
  DOCKER_RUN_USER_ARGS+=(--group-add "$(id -g)")
else
  chmod -R a+rwX "$ARTIFACT_DIR" || true
fi
prepare_diagnostics_capture
prepare_limit_summary

docker_e2e_build_or_reuse "$IMAGE_NAME" upgrade-survivor "$ROOT_DIR/scripts/e2e/Dockerfile" "$ROOT_DIR" "bare" "$SKIP_BUILD"
if [ "$SCENARIO" = "package-installed-recovery" ]; then
  recovery_image="$IMAGE_NAME"
  recovery_name=""
  if is_scheduler_installed_recovery && [ "$OMNIPOLYMATH_UPGRADE_SURVIVOR_INSTALLED_RECOVERY_CUT" = partial-previous ]; then
    recovery_name="omnipolymath-recovery-$(basename "$(dirname "$ARTIFACT_DIR")")"
    recovery_image="$(docker_e2e_docker_with_timeout 10s image inspect --format '{{.Id}}' "$IMAGE_NAME")"
    [[ "$recovery_image" =~ ^sha256:[a-f0-9]{64}$ ]]
  fi
  docker_e2e_run_with_harness \
    --init \
    ${UPGRADE_LIMITS_ARGS[@]+"${UPGRADE_LIMITS_ARGS[@]}"} \
    -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    -e OMNIPOLYMATH_TEST_STATE_FUNCTION_B64="$OMNIPOLYMATH_TEST_STATE_FUNCTION_B64" \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT=/tmp/omnipolymath-upgrade-survivor-artifacts \
    -e OMNIPOLYMATH_UPGRADE_SURVIVOR_INSTALLED_RECOVERY_CUT="${OMNIPOLYMATH_UPGRADE_SURVIVOR_INSTALLED_RECOVERY_CUT:-}" \
    -e OMNIPOLYMATH_DOCKER_E2E_SELECTED_SHA="${OMNIPOLYMATH_DOCKER_E2E_SELECTED_SHA:-}" \
    -v "$ARTIFACT_DIR:/tmp/omnipolymath-upgrade-survivor-artifacts" \
    -v "$HARNESS_ROOT_DIR/scripts:/tmp/omnipolymath-release-harness/scripts:ro" \
    ${DOCKER_E2E_PACKAGE_ARGS[@]+"${DOCKER_E2E_PACKAGE_ARGS[@]}"} \
    -e OMNIPOLYMATH_E2E_COMMAND_TIMEOUT="$COMMAND_TIMEOUT" \
    ${DOCKER_RUN_USER_ARGS[@]+"${DOCKER_RUN_USER_ARGS[@]}"} \
    "$recovery_image" \
    ${UPGRADE_ENTRYPOINT[@]+"${UPGRADE_ENTRYPOINT[@]}"} \
    timeout --kill-after=30s "$DOCKER_RUN_TIMEOUT" \
    bash /tmp/omnipolymath-release-harness/scripts/e2e/lib/upgrade-survivor/installed-recovery.sh
  if [ -n "$recovery_name" ]; then
    # A joined host CLI alone does not prove container settlement. These two
    # serial, offline readers consume the same image only after that proof.
    docker_e2e_settle_container_cidfile "${DOCKER_E2E_CONTAINER_CIDFILE:?missing scheduler producer CID path}"
    read -r producer_uid reader_uid reader_gid < <(node -e '
      const fs = require("node:fs"), path = require("node:path");
      const root = process.argv[1], host = process.getuid(), group = process.getgid();
      if ((fs.lstatSync(path.dirname(root)).mode & 0o777) !== 0o700) process.exit(1);
      const producer = fs.lstatSync(path.join(root, "installed-recovery.json")).uid;
      let uid = 65534, gid = 65534;
      while (uid === producer || uid === host) uid--;
      while (gid === group) gid--;
      console.log(producer, uid, gid);
    ' "$ARTIFACT_DIR")
    for access in shared outsider; do
      reader_name="${recovery_name}-${access}"
      reader_group=()
      [ "$access" != shared ] || reader_group=(--group-add "$(id -g)")
      status=0
      docker_e2e_docker_with_timeout 30s run --name "$reader_name" --pull=never --rm \
        --network=none --cap-drop=ALL --security-opt=no-new-privileges --read-only \
        --user "$reader_uid:$reader_gid" --workdir=/ ${reader_group[@]+"${reader_group[@]}"} \
        -v "$ARTIFACT_DIR:/evidence:ro" -v "$(dirname "$ARTIFACT_DIR"):/private:ro" \
        -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/installed-recovery-access.mjs:/check.mjs:ro" \
        --entrypoint node "$recovery_image" /check.mjs "$access" "$reader_uid" "$reader_gid" "$(id -g)" "$producer_uid" || status="$?"
      docker_e2e_docker_with_timeout 10s rm -f "$reader_name" >/dev/null 2>&1 || true
      state="$(docker_e2e_docker_with_timeout 10s ps -a --filter "name=^/${reader_name}$" --format '{{.State}}')"
      [ -z "$state" ]
      [ "$status" -eq 0 ] || exit "$status"
    done
    printf 'Installed recovery access proved with image %s\n' "$recovery_image"
  fi
  run_completed="1"
  exit 0
fi
if [ "$UPDATE_RESTART_MODE" = auto-auth ]; then
  docker_e2e_docker_cmd run --rm --network none --entrypoint true "$IMAGE_NAME"
fi

echo "Running upgrade survivor Docker E2E..."
docker_e2e_run_with_harness \
  --init \
  ${UPGRADE_LIMITS_ARGS[@]+"${UPGRADE_LIMITS_ARGS[@]}"} \
  -e COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
  -e OMNIPOLYMATH_TEST_STATE_FUNCTION_B64="$OMNIPOLYMATH_TEST_STATE_FUNCTION_B64" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT=/tmp/omnipolymath-upgrade-survivor-artifacts \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_ROOT_MANAGED_VPS="$ROOT_MANAGED_VPS" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIO="$SCENARIO" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE="$UPDATE_RESTART_MODE" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_COMMAND_TIMEOUT="$COMMAND_TIMEOUT" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_START_BUDGET_SECONDS="$START_BUDGET_SECONDS" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS="$STATUS_BUDGET_SECONDS" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER=/tmp/omnipolymath-clawhub-fixture-server.cjs \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER=/tmp/omnipolymath-config-parking.mjs \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_TRUSTED_ASSERTIONS="$UPGRADE_TRUSTED_ASSERTIONS" \
  -e OMNIPOLYMATH_UPGRADE_SURVIVOR_TRUSTED_DIAGNOSTICS="$UPGRADE_TRUSTED_DIAGNOSTICS" \
  -e OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_SERVER_SCRIPT=/tmp/omnipolymath-release-harness/scripts/e2e/lib/plugins/npm-registry-server.mjs \
  ${UPGRADE_COMPAT_ENV_ARGS[@]+"${UPGRADE_COMPAT_ENV_ARGS[@]}"} \
  "${PROBE_ENV_ARGS[@]}" \
  -v "$ARTIFACT_DIR:/tmp/omnipolymath-upgrade-survivor-artifacts" \
  -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/clawhub-fixture-server.cjs:/tmp/omnipolymath-clawhub-fixture-server.cjs:ro" \
  -v "$HARNESS_ROOT_DIR/scripts/e2e/lib/upgrade-survivor/config-parking.mjs:/tmp/omnipolymath-config-parking.mjs:ro" \
  -v "$HARNESS_ROOT_DIR/scripts:/tmp/omnipolymath-release-harness/scripts:ro" \
  ${UPGRADE_SCENARIO_ARGS[@]+"${UPGRADE_SCENARIO_ARGS[@]}"} \
  ${DOCKER_E2E_PACKAGE_ARGS[@]+"${DOCKER_E2E_PACKAGE_ARGS[@]}"} \
  ${DOCKER_RUN_USER_ARGS[@]+"${DOCKER_RUN_USER_ARGS[@]}"} \
  "$IMAGE_NAME" \
  ${UPGRADE_ENTRYPOINT[@]+"${UPGRADE_ENTRYPOINT[@]}"} \
 timeout --kill-after=30s "$DOCKER_RUN_TIMEOUT" bash -lc 'set -euo pipefail
 source scripts/lib/omnipolymath-e2e-instance.sh
 source scripts/e2e/lib/prepublish-plugin-registry.sh

export npm_config_loglevel=error
export npm_config_fund=false
export npm_config_audit=false
export OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT="${OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT:-/tmp/omnipolymath-upgrade-survivor-artifacts}"
export OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT="${OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT:-/tmp/omnipolymath-upgrade-survivor-runtime}"
TRUSTED_ASSERTIONS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_TRUSTED_ASSERTIONS:-scripts/e2e/lib/upgrade-survivor/assertions.mjs}"
TRUSTED_DIAGNOSTICS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_TRUSTED_DIAGNOSTICS:-$PWD/scripts/e2e/lib/upgrade-survivor/diagnostics.mjs}"
mkdir -p "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT"
export TMPDIR="${OMNIPOLYMATH_UPGRADE_SURVIVOR_TMPDIR:-$OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT/tmp}"
export OMNIPOLYMATH_TEST_STATE_TMPDIR="${OMNIPOLYMATH_UPGRADE_SURVIVOR_TEST_STATE_TMPDIR:-$OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT/state-tmp}"
export npm_config_prefix="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/npm-prefix"
export NPM_CONFIG_PREFIX="$npm_config_prefix"
export npm_config_cache="${OMNIPOLYMATH_UPGRADE_SURVIVOR_NPM_CACHE:-$OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT/npm-cache}"
export NPM_CONFIG_CACHE="$npm_config_cache"
export npm_config_tmp="$TMPDIR"
mkdir -p "$OMNIPOLYMATH_UPGRADE_SURVIVOR_RUNTIME_ROOT" "$TMPDIR" "$OMNIPOLYMATH_TEST_STATE_TMPDIR" "$npm_config_prefix" "$npm_config_cache"
chmod 700 "$npm_config_cache" || true
export PATH="$npm_config_prefix/bin:$PATH"
export CI=true
export OMNIPOLYMATH_NO_ONBOARD=1
export OMNIPOLYMATH_NO_PROMPT=1
export OMNIPOLYMATH_SKIP_PROVIDERS=1
export OMNIPOLYMATH_SKIP_CHANNELS=1
export OMNIPOLYMATH_DISABLE_BONJOUR=1
export GATEWAY_AUTH_TOKEN_REF="upgrade-survivor-token"
export OPENAI_API_KEY="sk-omnipolymath-upgrade-survivor"
export DISCORD_BOT_TOKEN="upgrade-survivor-discord-token"
export TELEGRAM_BOT_TOKEN="123456:upgrade-survivor-telegram-token"
SCENARIO="${OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIO:-base}"
if [ "$SCENARIO" = "feishu-channel" ]; then
  export FEISHU_APP_SECRET="upgrade-survivor-feishu-secret"
fi
if [ "$SCENARIO" = "configured-plugin-installs" ] || [ "$SCENARIO" = "sqlite-volume" ]; then
  export BRAVE_API_KEY="BSA_upgrade_survivor_brave_key"
fi

UPDATE_RESTART_MODE="${OMNIPOLYMATH_UPGRADE_SURVIVOR_UPDATE_RESTART_MODE:-manual}"
command_timeout="${OMNIPOLYMATH_UPGRADE_SURVIVOR_COMMAND_TIMEOUT:-900s}"
PORT=18789
START_BUDGET="$(omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_START_BUDGET_SECONDS 300)"
STATUS_BUDGET="$(omnipolymath_e2e_read_positive_int_env OMNIPOLYMATH_UPGRADE_SURVIVOR_STATUS_BUDGET_SECONDS 30)"
GATEWAY_LOG="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/gateway.log"
SYSTEMCTL_SHIM_LOG="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/systemctl-shim.log"
SYSTEMCTL_SHIM_PID_FILE="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/systemctl-shim.pid"
SYSTEMCTL_SHIM_DAEMON_LOG="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/systemctl-shim-gateway.log"
BASELINE_SERVICE_INSTALL_JSON="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/baseline-service-install.json"
BASELINE_SERVICE_INSTALL_ERR="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/baseline-service-install.err"
export OMNIPOLYMATH_UPGRADE_SURVIVOR_SYSTEMCTL_SHIM_LOG="$SYSTEMCTL_SHIM_LOG"
export OMNIPOLYMATH_UPGRADE_SURVIVOR_SYSTEMCTL_SHIM_PID_FILE="$SYSTEMCTL_SHIM_PID_FILE"
export OMNIPOLYMATH_UPGRADE_SURVIVOR_SYSTEMCTL_SHIM_DAEMON_LOG="$SYSTEMCTL_SHIM_DAEMON_LOG"
export OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE_SERVICE_INSTALL_JSON="$BASELINE_SERVICE_INSTALL_JSON"
export OMNIPOLYMATH_UPGRADE_SURVIVOR_BASELINE_SERVICE_INSTALL_ERR="$BASELINE_SERVICE_INSTALL_ERR"

gateway_pid=""
plugin_registry_pid=""
clawhub_fixture_pid=""
run_completed="0"
cleanup() {
  if [ -s "$SYSTEMCTL_SHIM_PID_FILE" ]; then
    systemctl --user stop omnipolymath-gateway.service >/dev/null 2>&1 || true
  fi
  omnipolymath_e2e_terminate_gateways "${gateway_pid:-}"
  if [ -s "$SYSTEMCTL_SHIM_PID_FILE" ]; then
    omnipolymath_e2e_terminate_gateways "$(cat "$SYSTEMCTL_SHIM_PID_FILE" 2>/dev/null || true)"
  fi
  omnipolymath_e2e_stop_process "${plugin_registry_pid:-}"
  omnipolymath_e2e_stop_process "${clawhub_fixture_pid:-}"
}
CURRENT_PHASE="setup"
on_exit() {
  local result="$1"
  trap - EXIT
  set +e
  if [ "$result" -eq 0 ] && [ "$run_completed" != "1" ]; then
    echo "Upgrade survivor exited before all assertions completed." >&2
    result=1
  fi
  if [ "$result" -ne 0 ]; then
    node "$TRUSTED_DIAGNOSTICS" capture \
      "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT" "$CURRENT_PHASE" "$result" ||
      echo "Upgrade survivor diagnostics missing; preserving original phase failure." >&2
  fi
  cleanup
  exit "$result"
}
trap '"'"'on_exit $?'"'"' EXIT

wait_for_fixture_port() {
  local pid="$1" port_file="$2" log_file="$3" label="$4"
  for _ in $(seq 1 100); do
    [ -s "$port_file" ] && return 0
    omnipolymath_e2e_process_alive "$pid" || break
    sleep 0.1
  done
  omnipolymath_e2e_print_log "$log_file" >&2
  echo "Timed out waiting for upgrade survivor $label." >&2
  return 1
}

configure_clawhub_fixture() {
  unset OMNIPOLYMATH_CLAWHUB_URL CLAWHUB_URL
  [ -z "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ] && return 0
  local fixture_root="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/clawhub-fixture" port_file log_file
  port_file="$fixture_root/port"
  log_file="$fixture_root/server.log"
  mkdir -p "$fixture_root"
  node "$OMNIPOLYMATH_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER" \
    prepublish-artifacts "$port_file" \
    "$OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR/prepublish-plugin-registry.json" >"$log_file" 2>&1 &
  clawhub_fixture_pid="$!"
  wait_for_fixture_port "$clawhub_fixture_pid" "$port_file" "$log_file" "ClawHub fixture"
  export OMNIPOLYMATH_CLAWHUB_URL="http://127.0.0.1:$(cat "$port_file")"
}

 configure_plugin_registry() {
   local fixture_root="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/plugin-registry"
   local package_dir="$fixture_root/package"
   local tarball="$fixture_root/omnipolymath-brave-plugin-2026.5.2.tgz"
   local registry_args=()

   if [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIO:-base}" = "configured-plugin-installs" ]; then
    mkdir -p "$package_dir"
    FIXTURE_PACKAGE_DIR="$package_dir" FIXTURE_PACKAGE_VERSION="2026.5.2" \
      node /tmp/omnipolymath-release-harness/scripts/e2e/lib/fixture.mjs brave-plugin
    tar -czf "$tarball" -C "$fixture_root" package
    registry_args+=("@omnipolymath/brave-plugin" "2026.5.2" "$tarball")
  fi

   if [ "${#registry_args[@]}" -eq 0 ]; then
     [ -n "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" ] || return 0
   fi

 omnipolymath_prepublish_plugin_registry_start \
     "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_DIR:-}" \
     "${OMNIPOLYMATH_DOCKER_E2E_SELECTED_SHA:-}" \
     "$package_version" \
     "${OMNIPOLYMATH_PREPUBLISH_PLUGIN_REGISTRY_MANIFEST_SHA256:-}" \
     "$fixture_root" \
     plugin_registry_pid \
     ${registry_args[@]+"${registry_args[@]}"}
 }

install_companion_plugins() {
  local authored_config="$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/companion-install-authored.json"
  local trusted_assertions="${OMNIPOLYMATH_UPGRADE_SURVIVOR_TRUSTED_ASSERTIONS:-scripts/e2e/lib/upgrade-survivor/assertions.mjs}"
  local install_status=0
  local restore_status=0
  node "$OMNIPOLYMATH_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER" \
    park-companion-install "$OMNIPOLYMATH_CONFIG_PATH" "$authored_config"

  set +e
  omnipolymath_e2e_fixture_plugin_command omnipolymath -- \
    plugins install "npm:@omnipolymath/discord@$package_version" --pin
  install_status=$?
  if [ "$install_status" -eq 0 ]; then
    omnipolymath_e2e_fixture_plugin_command omnipolymath -- \
      plugins install "clawhub:@omnipolymath/whatsapp@$package_version"
    install_status=$?
  fi
  if [ "$install_status" -eq 0 ]; then
    node "$OMNIPOLYMATH_UPGRADE_SURVIVOR_CLAWHUB_FIXTURE_SERVER" \
      assert-prepublish-requests "$OMNIPOLYMATH_CLAWHUB_URL" "@omnipolymath/whatsapp" "$package_version"
    install_status=$?
  fi
  if [ "$install_status" -eq 0 ]; then
    omnipolymath_e2e_fixture_plugin_command omnipolymath -- \
      plugins install "npm:@omnipolymath/codex@$package_version" --pin
    install_status=$?
  fi
  if [ "$install_status" -eq 0 ]; then
    # Inspection validates config too; keep the legacy migration specimen parked
    # until companion installation and its provenance checks have both finished.
    node "$trusted_assertions" \
      assert-companion-installs "$package_version" \
      "${OMNIPOLYMATH_E2E_LAST_FIXTURE_PLUGIN_CAPABILITY_CONSENT_SUPPORTED:?missing candidate capability-consent support}"
    install_status=$?
  fi
  node "$OMNIPOLYMATH_UPGRADE_SURVIVOR_CONFIG_PARKING_HELPER" \
    restore "$OMNIPOLYMATH_CONFIG_PATH" "$authored_config"
  restore_status=$?
  set -e

  if [ "$install_status" -ne 0 ]; then
    return "$install_status"
  fi
  if [ "$restore_status" -ne 0 ]; then
    return "$restore_status"
  fi
}

omnipolymath_e2e_eval_test_state_from_b64 "${OMNIPOLYMATH_TEST_STATE_FUNCTION_B64:?missing OMNIPOLYMATH_TEST_STATE_FUNCTION_B64}"
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  account_home="$(getent passwd "$(id -u)" | cut -d: -f6)"
  if [ -z "$account_home" ]; then
    echo "Could not resolve the current account home" >&2
    exit 1
  fi
  omnipolymath_test_state_create "$account_home" upgrade-survivor
  export HOME="$account_home"
  export USERPROFILE="$account_home"
  export OMNIPOLYMATH_STATE_DIR="$account_home/.omnipolymath"
  export OMNIPOLYMATH_CONFIG_PATH="$OMNIPOLYMATH_STATE_DIR/omnipolymath.json"
  unset OMNIPOLYMATH_HOME
else
  omnipolymath_test_state_create upgrade-survivor upgrade-survivor
fi
node scripts/e2e/lib/upgrade-survivor/assertions.mjs seed

CURRENT_PHASE="install-candidate"
omnipolymath_e2e_install_package "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/install.log" "upgrade survivor package" "$npm_config_prefix"
command -v omnipolymath >/dev/null
package_version="$(node -p "JSON.parse(require(\"node:fs\").readFileSync(process.argv[1] + \"/lib/node_modules/omnipolymath/package.json\", \"utf8\")).version" "$npm_config_prefix")"

echo "Checking dirty-state config before update..."
CURRENT_PHASE="prepare-state"
OMNIPOLYMATH_UPGRADE_SURVIVOR_ASSERT_STAGE=baseline node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-config
OMNIPOLYMATH_UPGRADE_SURVIVOR_ASSERT_STAGE=baseline node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-state
configure_clawhub_fixture
configure_plugin_registry
install_companion_plugins
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  # shellcheck disable=SC1091
  source scripts/e2e/lib/upgrade-survivor/update-restart-auth.sh
  prepare_update_restart_probe_current_install "$PORT" "$GATEWAY_LOG"
  pre_update_service_pid="$(cat "$SYSTEMCTL_SHIM_PID_FILE")"
  pre_update_systemctl_lines="$(wc -l <"$SYSTEMCTL_SHIM_LOG")"
fi

echo "Running package update against the mounted tarball..."
TRUSTED_DIAGNOSTICS="${OMNIPOLYMATH_UPGRADE_SURVIVOR_TRUSTED_DIAGNOSTICS:-$PWD/scripts/e2e/lib/upgrade-survivor/diagnostics.mjs}"
CURRENT_PHASE="update-candidate"
update_args=(update --tag "${OMNIPOLYMATH_CURRENT_PACKAGE_TGZ:?missing OMNIPOLYMATH_CURRENT_PACKAGE_TGZ}" --yes --json)
if [ "$UPDATE_RESTART_MODE" != "auto-auth" ]; then
  update_args+=(--no-restart)
fi
set +e
omnipolymath_e2e_maybe_timeout "$command_timeout" env -u OMNIPOLYMATH_GATEWAY_TOKEN -u OMNIPOLYMATH_GATEWAY_PASSWORD OMNIPOLYMATH_ALLOW_ROOT=1 NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--import=$TRUSTED_DIAGNOSTICS" omnipolymath "${update_args[@]}" >"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.json" 2>"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.err"
update_status=$?
set -e
if [ "$update_status" -ne 0 ]; then
  echo "omnipolymath update failed" >&2
  validate_status=0
  omnipolymath_e2e_maybe_timeout "$command_timeout" omnipolymath config validate --json >"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.json" 2>"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.err" || validate_status=$?
  echo "post-update config validation probe status=$validate_status" >&2
  omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.err" >&2 || true
  omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/post-update-validate.json" >&2 || true
  omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.err" >&2 || true
  omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/update.json" >&2 || true
  exit "$update_status"
fi
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  echo "Skipping doctor repair until after restart proof."
else
  echo "Running non-interactive doctor repair..."
  CURRENT_PHASE="doctor"
  if ! omnipolymath_e2e_maybe_timeout "$command_timeout" omnipolymath doctor --fix --non-interactive >"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" 2>&1; then
    echo "omnipolymath doctor failed" >&2
    omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" >&2
    exit 1
  fi
  if ! omnipolymath_e2e_maybe_timeout "$command_timeout" omnipolymath config validate >>"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" 2>&1; then
    echo "post-doctor config validation failed" >&2
    omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/doctor.log" >&2
    exit 1
  fi
fi

echo "Verifying config and state survived update..."
CURRENT_PHASE="assert-state"
node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-config
node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-state

startup_summary="n/a"
if [ "$UPDATE_RESTART_MODE" = "auto-auth" ]; then
  assert_update_restart_service_replaced "$pre_update_service_pid" "$pre_update_systemctl_lines"
  echo "Gateway restart was handled by omnipolymath update."
else
  echo "Starting gateway from upgraded state..."
  CURRENT_PHASE="start-gateway"
  start_epoch="$(node -e "process.stdout.write(String(Date.now()))")"
  omnipolymath gateway --port "$PORT" --bind loopback --allow-unconfigured >"$GATEWAY_LOG" 2>&1 &
  gateway_pid="$!"
  omnipolymath_e2e_wait_gateway_ready "$gateway_pid" "$GATEWAY_LOG" "$((10#$START_BUDGET * 4))" "$PORT"
  ready_epoch="$(node -e "process.stdout.write(String(Date.now()))")"
  start_seconds=$(((ready_epoch - start_epoch + 999) / 1000))
  if [ "$start_seconds" -gt "$START_BUDGET" ]; then
    if ! node scripts/lib/check-limits.mts scripts/e2e/upgrade-survivor-docker.sh "Upgrade startup budget" "gateway startup exceeded survivor budget: ${start_seconds}s > ${START_BUDGET}s"; then
      omnipolymath_e2e_print_log "$GATEWAY_LOG" >&2
      exit 1
    fi
  fi
  startup_summary="${start_seconds}s"
fi

echo "Checking gateway HTTP probes..."
CURRENT_PHASE="http-probes"
node scripts/e2e/lib/upgrade-survivor/probe-gateway.mjs \
  --base-url "http://127.0.0.1:$PORT" \
  --path /healthz \
  --expect live \
  --out "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/healthz.json"

readyz_probe_args=(
  --base-url "http://127.0.0.1:$PORT"
  --path /readyz
  --expect ready
)
if [ -n "${OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING:-}" ]; then
  readyz_probe_args+=(--allow-failing "$OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_FAILING")
fi
if [ "${OMNIPOLYMATH_UPGRADE_SURVIVOR_READYZ_ALLOW_DEGRADED:-}" = "1" ]; then
  readyz_probe_args+=(--allow-degraded-ready)
fi
readyz_probe_args+=(--out "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/readyz.json")
node scripts/e2e/lib/upgrade-survivor/probe-gateway.mjs "${readyz_probe_args[@]}"

echo "Checking gateway RPC status..."
CURRENT_PHASE="status"
status_start="$(node -e "process.stdout.write(String(Date.now()))")"
if ! omnipolymath_e2e_maybe_timeout "$command_timeout" omnipolymath gateway status --url "ws://127.0.0.1:$PORT" --token "$GATEWAY_AUTH_TOKEN_REF" --require-rpc --timeout 30000 --json >"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.json" 2>"$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.err"; then
  echo "gateway status failed" >&2
  omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.err" >&2
  omnipolymath_e2e_print_log "$GATEWAY_LOG" >&2
  omnipolymath_e2e_print_log "$SYSTEMCTL_SHIM_DAEMON_LOG" >&2
  exit 1
fi
status_end="$(node -e "process.stdout.write(String(Date.now()))")"
status_seconds=$(((status_end - status_start + 999) / 1000))
if [ "$status_seconds" -gt "$STATUS_BUDGET" ]; then
  if ! node scripts/lib/check-limits.mts scripts/e2e/upgrade-survivor-docker.sh "Upgrade status budget" "gateway status exceeded survivor budget: ${status_seconds}s > ${STATUS_BUDGET}s"; then
    omnipolymath_e2e_print_log "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.json" >&2
    exit 1
  fi
fi
node scripts/e2e/lib/upgrade-survivor/assertions.mjs assert-status-json "$OMNIPOLYMATH_UPGRADE_SURVIVOR_ARTIFACT_ROOT/status.json"

echo "Upgrade survivor Docker E2E passed scenario=${OMNIPOLYMATH_UPGRADE_SURVIVOR_SCENARIO:-base} updateRestartMode=${UPDATE_RESTART_MODE} startup=${startup_summary} status=${status_seconds}s."
run_completed="1"
'
run_completed="1"
