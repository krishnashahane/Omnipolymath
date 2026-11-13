// Shared root CLI failure formatting with debug stack gating and recovery hints.
import { isForegroundGatewayRunArgv } from "../../gateway-run-argv.mjs";
import { isInvalidConfigError } from "../config/io.invalid-config.js";
import { isGatewayTransportError } from "../gateway/transport-error.js";
import { getRootOptionAwareCommandPath } from "../infra/cli-root-options.js";
import { isTruthyEnvValue } from "../infra/env.js";
import { collectNestedErrorCandidates } from "../infra/error-graph-internal.js";
import { extractErrorCode, formatErrorMessage, formatUncaughtError } from "../infra/errors.js";
import { runFatalErrorHooks } from "../infra/fatal-error-hooks.js";
import { findStartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";
import {
  isBenignUncaughtExceptionError,
  isUncaughtExceptionHandled,
} from "../infra/unhandled-rejections.js";
import { defaultRuntime, restoreRuntimeTerminalState } from "../runtime.js";
import {
  UpdateSchemaRefusalError,
  type UpdateSchemaRefusalDatabase,
} from "../state/omnipolymath-update-schema-refusal.js";
import { formatCliCommand } from "./command-format.js";
import type { CronCliJobMatch } from "./cron-cli/cron-cli-error.js";
import { ExpectedCliError } from "./expected-cli-error.js";
import { isJsonOutputModeActive } from "./json-output-mode.js";
import { exitAfterSignalExitBarriers } from "./signal-exit-barrier.js";

export { ExpectedCliError } from "./expected-cli-error.js";

export function handleCliUncaughtException(error: unknown, argv?: string[]): void {
  if (isUncaughtExceptionHandled(error)) {
    return;
  }
  if (isBenignUncaughtExceptionError(error)) {
    console.warn(
      "[omnipolymath] Non-fatal uncaught exception (continuing):",
      formatUncaughtError(error),
    );
    return;
  }
  if (isJsonOutputModeActive(argv ?? process.argv)) {
    defaultRuntime.writeJson(formatCliJsonFailure(error));
  }
  for (const line of formatCliFailureLines({
    title: "Omnipolymath hit an unexpected runtime error.",
    error,
    argv: argv ?? process.argv,
  })) {
    console.error(line);
  }
  for (const message of runFatalErrorHooks({ reason: "uncaught_exception", error })) {
    console.error("[omnipolymath]", message);
  }
  restoreRuntimeTerminalState("uncaught exception");
  exitAfterSignalExitBarriers(1, "uncaught exception");
}

type FormatCliFailureOptions = {
  title: string;
  error: unknown;
  argv?: string[];
  env?: NodeJS.ProcessEnv;
};

type CliFailureDebugOptions = Pick<FormatCliFailureOptions, "argv" | "env">;

export type CliJsonFailure = {
  ok: false;
  runId?: string;
  origin?: "gateway";
  error: {
    type: "cli_error";
    message: string;
    code?: string;
    databases?: readonly UpdateSchemaRefusalDatabase[];
    updaterVersion?: string;
    targetVersion?: string;
    commands?: readonly string[];
    matches?: readonly CronCliJobMatch[];
  };
};

export type CliGatewayRunFailure = { runId: string; origin: "gateway" };

const gatewayRunFailures = new WeakMap<Error, CliGatewayRunFailure>();

/** Agent dispatch supplies observed Gateway IDs; error identity and human output stay intact. */
export function recordCliGatewayRunFailure(error: unknown, runId: string | undefined): void {
  if (error instanceof Error && runId) {
    gatewayRunFailures.set(error, { runId, origin: "gateway" });
  }
}

/** Human diagnostics (agent transport-loss hint) read back the run identity recorded at dispatch. */
export function readCliGatewayRunFailure(error: unknown): CliGatewayRunFailure | undefined {
  return error instanceof Error ? gatewayRunFailures.get(error) : undefined;
}

export function isGatewayCredentialsCliError(
  error: unknown,
): error is Error & { method: string; configPath: string } {
  // Keep the root failure renderer lean; importing gateway/call would pull the
  // transport and config stack into every CLI startup path.
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name === "GatewayCredentialsRequiredError" &&
    "method" in error &&
    typeof error.method === "string" &&
    "configPath" in error &&
    typeof error.configPath === "string"
  );
}

// These producers already supply the operator remedy. Classify by name to keep
// their runtime modules out of the root CLI's cold startup path.
const EXPECTED_CLI_ERROR_NAMES = new Set([
  "GatewayExplicitAuthRequiredError",
  "AgentSelectionRequiredError",
  "ConfigReadOnlyError",
  "NixModeConfigMutationError",
  "LocalStateOwnerError",
  "CompletionCacheMissingError",
  "CompletionProfileEncodingError",
]);

export function isExpectedCliError(error: unknown): error is Error {
  return (
    error instanceof ExpectedCliError ||
    isGatewayCredentialsCliError(error) ||
    (error instanceof Error && EXPECTED_CLI_ERROR_NAMES.has(error.name)) ||
    isGatewayTransportError(error)
  );
}

/**
 * Plugin actions and command hooks report their failure message like core command
 * boundaries; the root renderer still owns JSON envelopes and exit codes.
 */
export function toPluginCommandFailure(error: unknown): unknown {
  if (
    isExpectedCliError(error) ||
    (error instanceof Error && (error.name === "CommanderError" || error.name === "ExitError"))
  ) {
    return error;
  }
  const commanderCode =
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.startsWith("commander.");
  if (shouldShowDebugDetails() && !commanderCode) {
    return error;
  }
  const message = formatCliOperatorError(error);
  return new ExpectedCliError({
    message,
    humanOutput: message,
    machineOutput: message,
    cause: error,
  });
}

export function rethrowExpectedCliError(error: unknown): void {
  if (isExpectedCliError(error)) {
    throw error;
  }
}

function resolveExpectedCliOutput(error: Error) {
  return error instanceof ExpectedCliError
    ? error
    : {
        humanOutput: error.message,
        humanOutputWritten: false,
        machineOutput: error.message,
      };
}

/** Canonical machine-readable failure envelope for CLI-owned errors. */
export function formatCliJsonFailure(
  error: unknown,
  options: CliFailureDebugOptions = {},
): CliJsonFailure {
  const message = isExpectedCliError(error)
    ? formatErrorMessage(resolveExpectedCliOutput(error).machineOutput.trimEnd())
    : formatCliOperatorError(error, options);
  return {
    ok: false,
    ...readCliGatewayRunFailure(error),
    error: {
      type: "cli_error",
      message,
      ...(error instanceof ExpectedCliError && error.matches ? { matches: error.matches } : {}),
      ...(error instanceof UpdateSchemaRefusalError
        ? {
            code: error.code,
            databases: error.databases,
            updaterVersion: error.updaterVersion,
            targetVersion: error.targetVersion,
            commands: error.commands,
          }
        : {}),
    },
  };
}

function shouldShowDebugDetails(
  argv: string[] | undefined = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  for (const arg of argv ?? []) {
    // Arguments after the terminator belong to the child, not root stack-trace policy.
    if (arg === "--") {
      break;
    }
    if (arg === "--debug" || arg === "--verbose") {
      return true;
    }
  }
  return isTruthyEnvValue(env.OMNIPOLYMATH_DEBUG);
}

export function formatCliOperatorError(
  error: unknown,
  options: CliFailureDebugOptions = {},
): string {
  const includeCause = shouldShowDebugDetails(options.argv, options.env);
  const value =
    !includeCause && error instanceof Error ? error.message || error.name || "Error" : error;
  return formatErrorMessage(value);
}

export function formatCliFailureLines(options: FormatCliFailureOptions): string[] {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  const showDebugDetails = shouldShowDebugDetails(options.argv, env);
  // Admission and argument failures can precede the updater marker.
  const commandPath = getRootOptionAwareCommandPath(argv, 2);
  const isUpdateCommand = commandPath[0] === "update";
  const isPluginUpdateCommand = commandPath[0] === "plugins" && commandPath[1] === "update";
  const isNodeRunCommand = commandPath[0] === "node" && commandPath[1] === "run";
  // Update subprocesses use both marker values and retain captured reasons for recovery.
  const showUpdateDiagnostics = ["0", "1"].includes(env.OMNIPOLYMATH_UPDATE_IN_PROGRESS ?? "");
  if (
    isGatewayTransportError(options.error) &&
    !showDebugDetails &&
    !showUpdateDiagnostics &&
    !isUpdateCommand
  ) {
    const error = options.error;
    return [
      error.kind === "timeout"
        ? "Omnipolymath took too long to respond."
        : error.requestDispatched
          ? "Lost the connection to Omnipolymath."
          : "Couldn't connect to Omnipolymath.",
      ...(error.requestDispatched
        ? ["Your request may have completed. Check its result before trying again."]
        : []),
      `Check the Control UI or run \`${formatCliCommand("omnipolymath gateway status", options.env)}\` in your terminal.`,
    ];
  }
  if (isExpectedCliError(options.error)) {
    const output = resolveExpectedCliOutput(options.error);
    return output.humanOutputWritten ? [] : output.humanOutput.trimEnd().split("\n");
  }

  const errors = collectNestedErrorCandidates(options.error);
  const stateBusy = errors.some(
    (error) => error instanceof Error && error.name === "GatewayStateOwnerContentionError",
  );
  // Names survive worker transport without loading the state owner's runtime here.
  const stateRefusal =
    findStartupMaintenanceRequiredError(options.error) ??
    errors.find(
      (error): error is Error =>
        error instanceof Error &&
        (error.name === "StateDatabaseAccessError" ||
          error.name === "StateDatabaseMaintenanceScopeError"),
    );
  const reason = (error: unknown) =>
    `[omnipolymath] Reason: ${formatCliOperatorError(error, { argv, env })}`;
  if (!showDebugDetails && !showUpdateDiagnostics) {
    if (
      options.error instanceof UpdateSchemaRefusalError ||
      (options.error instanceof Error &&
        (options.error.name === "DoctorUnreadableStateDatabaseError" ||
          options.error.name === "OmnipolymathDatabaseSchemaPreflightError"))
    ) {
      // Doctor cannot repair these refusals; their producers own the required recovery steps.
      return ["[omnipolymath] Omnipolymath needs a manual recovery step.", reason(options.error)];
    }
    if (stateRefusal) {
      return [`[omnipolymath] ${options.title}`, reason(stateRefusal)];
    }
    // Engine selection throws config read failures unprinted; Doctor cannot read the file either.
    if (extractErrorCode(options.error) === "CONFIG_READ_FAILED") {
      return [`[omnipolymath] ${options.title}`, reason(options.error)];
    }
    // Config validation owns actionable file/field details; some startup paths have not printed them.
    const showReason = isInvalidConfigError(options.error)
      ? !options.error.diagnosticEmitted
      : isUpdateCommand ||
        isPluginUpdateCommand ||
        (options.error instanceof Error && options.error.name === "GatewayClientRequestError") ||
        isNodeRunCommand ||
        commandPath[0] === "connect" ||
        isForegroundGatewayRunArgv(argv);
    return [
      `[omnipolymath] ${options.title}`,
      ...(showReason ? [reason(options.error)] : []),
      stateBusy
        ? "[omnipolymath] Another Omnipolymath process is using your data. Wait for it to finish before trying again."
        : `[omnipolymath] For help, run \`${formatCliCommand("omnipolymath doctor", env)}\`.`,
    ];
  }
  const lines = [`[omnipolymath] ${options.title}`, reason(options.error)];

  if (showDebugDetails) {
    lines.push("[omnipolymath] Stack:");
    for (const line of formatUncaughtError(options.error).split("\n")) {
      if (line.trim().length > 0) {
        lines.push(`[omnipolymath] ${line}`);
      }
    }
  }

  // Doctor needs the same state owner; inspect wrappers without loading the SQLite runtime.
  if (!stateBusy) {
    lines.push(`[omnipolymath] Try: ${formatCliCommand("omnipolymath doctor", env)}`);
  }
  lines.push(`[omnipolymath] Help: ${formatCliCommand("omnipolymath --help", env)}`);
  return lines;
}
