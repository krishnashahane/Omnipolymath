/** Detects system-domain launchd ownership before mutating a user LaunchAgent. */
import fs from "node:fs/promises";
import path from "node:path";
import { quoteCliArg } from "../cli/quote-cli-arg.js";
import { hasErrnoCode } from "../infra/errno.js";
import { isMissingPathError } from "../infra/errors.js";
import {
  execLaunchctl,
  formatLaunchctlResultDetail,
  isLaunchctlNotLoaded,
  launchctlInspectionReason,
  type LaunchctlResult,
} from "./launchd-exec.js";
import { decodeLaunchdPlistMetadata } from "./launchd-plist.js";
import {
  ServiceOwnershipRefusalError,
  type ServiceInspectionReason,
} from "./service-inspection-error.js";
import { formatServiceInspectionDetail } from "./service-runtime.js";

const SYSTEM_LAUNCH_DAEMON_DIR = "/Library/LaunchDaemons";

type SystemLaunchDaemonOwnership =
  | { status: "absent"; serviceTarget: string }
  | { status: "loaded"; serviceTarget: string }
  | { status: "installed"; serviceTarget: string; plistPath: string }
  | {
      status: "unverifiable";
      serviceTarget: string;
      operation: "launchctl" | "filesystem";
      detail: string;
      reason?: ServiceInspectionReason;
    };

type SystemLaunchDaemonConflict = Exclude<SystemLaunchDaemonOwnership, { status: "absent" }>;

/**
 * Renders the package-independent ownership probe used by detached restart helpers.
 * The caller must refuse activation when `omnipolymath_system_launchd_conflict` is non-empty.
 */
export function renderSystemLaunchDaemonOwnershipShellProbe(label: string): string {
  const serviceTarget = `system/${label}`;
  return `omnipolymath_system_launchd_conflict=""
omnipolymath_system_launchd_detail=""
omnipolymath_system_launchd_target=${quoteCliArg(serviceTarget)}
omnipolymath_system_launchd_dir=${quoteCliArg(SYSTEM_LAUNCH_DAEMON_DIR)}
omnipolymath_system_launchd_label=${quoteCliArg(label)}
omnipolymath_query_system_launchd() {
  omnipolymath_system_launchd_probe=$(launchctl print "$omnipolymath_system_launchd_target" 2>&1)
  omnipolymath_system_launchd_probe_status=$?
  # POSIX shell status 126/127 means execution failed; >128 can represent a signal.
  # Partial absence output cannot establish that the ownership query completed.
  if [ "$omnipolymath_system_launchd_probe_status" -eq 0 ]; then
    omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_target"
    omnipolymath_system_launchd_detail="loaded system LaunchDaemon $omnipolymath_system_launchd_target"
  elif [ "$omnipolymath_system_launchd_probe_status" -eq 126 ] || [ "$omnipolymath_system_launchd_probe_status" -eq 127 ] || [ "$omnipolymath_system_launchd_probe_status" -gt 128 ] ||
       ! printf '%s' "$omnipolymath_system_launchd_probe" | /usr/bin/grep -Eiq 'could not find service|no such process|not found'; then
    omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_target"
    omnipolymath_system_launchd_detail="could not verify $omnipolymath_system_launchd_target (exit $omnipolymath_system_launchd_probe_status): $omnipolymath_system_launchd_probe"
  fi
}
omnipolymath_query_system_launchd
if [ -z "$omnipolymath_system_launchd_conflict" ]; then
  if [ ! -e "$omnipolymath_system_launchd_dir" ]; then
    :
  elif [ ! -r "$omnipolymath_system_launchd_dir" ] || [ ! -x "$omnipolymath_system_launchd_dir" ]; then
    omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_dir"
    omnipolymath_system_launchd_detail="could not inspect $omnipolymath_system_launchd_dir"
  else
    omnipolymath_system_launchd_entries=""
    if omnipolymath_system_launchd_entries=$(/usr/bin/mktemp "\${TMPDIR:-/tmp}/omnipolymath-launchd-scan.XXXXXX" 2>&1); then
      if /usr/bin/find "$omnipolymath_system_launchd_dir" -mindepth 1 -maxdepth 1 -name '*.plist' -print0 >"$omnipolymath_system_launchd_entries"; then
        while IFS= read -r -d '' omnipolymath_system_launchd_plist; do
          # Unreadable plists are treated as foreign: loaded same-label daemons are caught by the
          # bracketing launchctl checks; an unloaded unreadable same-label plist is an accepted operator-created edge (#120481).
          if [ ! -r "$omnipolymath_system_launchd_plist" ]; then
            continue
          fi
          # Preserve exact string labels, including trailing newlines, on both parser paths.
          # plutil documents exit 1 for parse failure. Signals/execution errors cannot
          # establish a missing Label, even if a later lint accepts the same plist.
          if omnipolymath_system_launchd_plist_label=$(/usr/bin/plutil -extract Label raw -expect string -n -o - -- "$omnipolymath_system_launchd_plist" 2>&1; omnipolymath_system_launchd_parse_status=$?; printf '.'; exit "$omnipolymath_system_launchd_parse_status"); then
            omnipolymath_system_launchd_plist_label=\${omnipolymath_system_launchd_plist_label%.}
            if [ "$omnipolymath_system_launchd_plist_label" != "$omnipolymath_system_launchd_label" ]; then
              continue
            fi
            omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_plist"
            omnipolymath_system_launchd_detail="installed same-label system LaunchDaemon plist $omnipolymath_system_launchd_plist"
            break
          elif [ "$?" -eq 1 ] && /usr/bin/plutil -lint -- "$omnipolymath_system_launchd_plist" >/dev/null 2>&1; then
            continue
          else
            # Endpoint protection can deny plutil while allowing a real read. The system
            # Perl reader survives package swaps and classifies errno, not diagnostic text.
            omnipolymath_system_launchd_snapshot=$(/usr/bin/mktemp "\${TMPDIR:-/tmp}/omnipolymath-launchd-plist.XXXXXX")
            if [ -n "$omnipolymath_system_launchd_snapshot" ]; then
              /usr/bin/perl -e '
use strict;
use Fcntl qw(O_RDONLY O_NONBLOCK);
use Errno qw(EACCES EPERM ENOENT ENOTDIR);
sub read_failed {
  my $code = 0 + $!;
  exit(($code == EACCES || $code == EPERM) ? 77 :
       ($code == ENOENT || $code == ENOTDIR) ? 66 : 74);
}
$SIG{ALRM} = sub { exit 74; };
alarm 5;
sysopen(my $file, $ARGV[0], O_RDONLY | O_NONBLOCK) or read_failed();
-f $file or exit 74;
# Inherited PERL_UNICODE must not turn binary plist input into a UTF-8 handle.
binmode $file;
binmode STDOUT;
my $total = 0;
while (1) {
  my $count = sysread($file, my $bytes, 65536);
  defined($count) or read_failed();
  last if !$count;
  $total += $count;
  $total <= 1048576 or exit 75;
  print STDOUT $bytes or exit 74;
}
close($file) or read_failed();
close(STDOUT) or exit 74;
' "$omnipolymath_system_launchd_plist" >"$omnipolymath_system_launchd_snapshot" 2>/dev/null
              omnipolymath_system_launchd_read_status=$?
              if [ "$omnipolymath_system_launchd_read_status" -eq 77 ] || [ "$omnipolymath_system_launchd_read_status" -eq 66 ]; then
                /bin/rm -f "$omnipolymath_system_launchd_snapshot"
                continue
              elif [ "$omnipolymath_system_launchd_read_status" -eq 0 ]; then
                # The sentinel preserves label newlines through command substitution.
                if omnipolymath_system_launchd_plist_label=$(/usr/bin/plutil -extract Label raw -expect string -n -o - -- - <"$omnipolymath_system_launchd_snapshot" 2>/dev/null; omnipolymath_system_launchd_parse_status=$?; printf '.'; exit "$omnipolymath_system_launchd_parse_status"); then
                  omnipolymath_system_launchd_plist_label=\${omnipolymath_system_launchd_plist_label%.}
                  /bin/rm -f "$omnipolymath_system_launchd_snapshot"
                  if [ "$omnipolymath_system_launchd_plist_label" != "$omnipolymath_system_launchd_label" ]; then
                    continue
                  fi
                  omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_plist"
                  omnipolymath_system_launchd_detail="installed same-label system LaunchDaemon plist $omnipolymath_system_launchd_plist"
                  break
                elif [ "$?" -eq 1 ] && /usr/bin/plutil -lint -- - <"$omnipolymath_system_launchd_snapshot" >/dev/null 2>&1; then
                  /bin/rm -f "$omnipolymath_system_launchd_snapshot"
                  continue
                fi
              fi
              /bin/rm -f "$omnipolymath_system_launchd_snapshot"
            fi
            omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_plist"
            omnipolymath_system_launchd_detail="could not inspect system LaunchDaemon plist $omnipolymath_system_launchd_plist: $omnipolymath_system_launchd_plist_label"
            break
          fi
        done <"$omnipolymath_system_launchd_entries"
      else
        omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_dir"
        omnipolymath_system_launchd_detail="could not enumerate $omnipolymath_system_launchd_dir"
      fi
      /bin/rm -f "$omnipolymath_system_launchd_entries"
    else
      omnipolymath_system_launchd_conflict="$omnipolymath_system_launchd_dir"
      omnipolymath_system_launchd_detail="could not create a secure system LaunchDaemon scan snapshot: $omnipolymath_system_launchd_entries"
    fi
  fi
fi
`;
}

function classifySystemLaunchDaemonQuery(
  serviceTarget: string,
  result: LaunchctlResult,
): SystemLaunchDaemonOwnership {
  if (result.code === 0) {
    return { status: "loaded", serviceTarget };
  }
  return isLaunchctlNotLoaded(result)
    ? { status: "absent", serviceTarget }
    : {
        status: "unverifiable",
        serviceTarget,
        operation: "launchctl",
        detail: formatLaunchctlResultDetail(result) || `exit code ${result.code}`,
        reason: launchctlInspectionReason(result, serviceTarget),
      };
}

export async function inspectSystemLaunchDaemonOwnership(
  label: string,
  options: { scanInstalledPlists?: boolean; timeoutMs?: number } = {},
): Promise<SystemLaunchDaemonOwnership> {
  const serviceTarget = `system/${label}`;
  if (process.platform !== "darwin") {
    return { status: "absent", serviceTarget };
  }

  const initialQuery = classifySystemLaunchDaemonQuery(
    serviceTarget,
    await execLaunchctl(["print", serviceTarget], options.timeoutMs),
  );
  if (initialQuery.status !== "absent") {
    return initialQuery;
  }
  if (options.scanInstalledPlists === false) {
    return { status: "absent", serviceTarget };
  }

  let entries: string[];
  try {
    entries = await fs.readdir(SYSTEM_LAUNCH_DAEMON_DIR);
  } catch (error) {
    if (isMissingPathError(error)) {
      return { status: "absent", serviceTarget };
    }
    return {
      status: "unverifiable",
      serviceTarget,
      operation: "filesystem",
      detail: formatServiceInspectionDetail(error),
    };
  }

  for (const entry of entries.filter((candidate) => candidate.endsWith(".plist")).toSorted()) {
    const plistPath = path.posix.join(SYSTEM_LAUNCH_DAEMON_DIR, entry);
    try {
      const contents = await fs.readFile(plistPath).catch((error: unknown) => {
        // Unreadable plists are foreign: the initial query catches loaded same-label daemons;
        // an unloaded unreadable same-label plist is an accepted edge (#120481).
        if (
          isMissingPathError(error) ||
          hasErrnoCode(error, "EACCES") ||
          hasErrnoCode(error, "EPERM")
        ) {
          return null;
        }
        throw error;
      });
      if (contents === null) {
        continue;
      }
      const plist = await decodeLaunchdPlistMetadata(contents);
      if (plist?.Label === label) {
        return { status: "installed", serviceTarget, plistPath };
      }
    } catch (error) {
      return {
        status: "unverifiable",
        serviceTarget,
        operation: "filesystem",
        detail: `${plistPath}: ${formatServiceInspectionDetail(error)}`,
      };
    }
  }
  // Concurrent root installers are best effort; activation performs its own check.
  return { status: "absent", serviceTarget };
}

export function formatSystemLaunchDaemonOwnershipSummary(
  ownership: SystemLaunchDaemonConflict,
): string {
  switch (ownership.status) {
    case "loaded":
      return `System LaunchDaemon ${ownership.serviceTarget} already owns this gateway label.`;
    case "installed":
      return `System LaunchDaemon plist ${ownership.plistPath} already owns this gateway label.`;
    case "unverifiable":
      return `System LaunchDaemon ownership for ${ownership.serviceTarget} could not be verified: ${ownership.detail}`;
    default: {
      const exhaustive: never = ownership;
      throw new Error(`Unexpected system LaunchDaemon ownership: ${String(exhaustive)}`);
    }
  }
}

function formatSystemLaunchDaemonOwnershipError(ownership: SystemLaunchDaemonConflict): string {
  const recovery =
    ownership.status === "loaded"
      ? `Keep it as the sole gateway manager, or unload it with \`sudo launchctl bootout ${ownership.serviceTarget}\` and remove its plist before retrying.`
      : ownership.status === "installed"
        ? `Keep it as the sole gateway manager, or remove or relocate ${quoteCliArg(ownership.plistPath)} before retrying.`
        : "Fix the reported launchctl or filesystem access error, then retry.";
  return [
    formatSystemLaunchDaemonOwnershipSummary(ownership),
    "Refusing to create or activate a user LaunchAgent for the same label because duplicate KeepAlive managers can restart-loop the gateway.",
    "Omnipolymath does not manage system LaunchDaemons, and --force does not override system ownership.",
    recovery,
  ].join("\n");
}

class SystemLaunchDaemonOwnershipError extends ServiceOwnershipRefusalError {
  readonly code = "SYSTEM_LAUNCH_DAEMON_OWNERSHIP";

  constructor(readonly ownership: SystemLaunchDaemonConflict) {
    super("launchd-system-owned", formatSystemLaunchDaemonOwnershipError(ownership));
    this.name = "SystemLaunchDaemonOwnershipError";
  }
}

export function isSystemLaunchDaemonOwnershipError(
  error: unknown,
): error is SystemLaunchDaemonOwnershipError {
  return error instanceof SystemLaunchDaemonOwnershipError;
}

export async function assertNoSystemLaunchDaemonOwnership(label: string): Promise<void> {
  const ownership = await inspectSystemLaunchDaemonOwnership(label);
  if (ownership.status !== "absent") {
    // System-domain ownership is host-wide. A gui-domain manager with the same
    // label can create two independent KeepAlive loops for one gateway port.
    throw new SystemLaunchDaemonOwnershipError(ownership);
  }
}
