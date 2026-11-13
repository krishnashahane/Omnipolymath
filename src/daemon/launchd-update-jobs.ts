import path from "node:path";
import {
  parseStrictInteger,
  parseStrictPositiveInteger,
} from "@omnipolymath/normalization-core/number-coercion";
import {
  GATEWAY_SERVICE_KIND,
  GATEWAY_SERVICE_MARKER,
  resolveGatewayLaunchAgentLabel,
} from "./constants.js";
import { isCurrentProcessLaunchdServiceLabel } from "./launchd-current-service.js";
import { execLaunchctl, formatLaunchctlResultDetail } from "./launchd-exec.js";
import { assertValidLaunchAgentLabel } from "./launchd-label.js";
import { readLaunchAgentProgramArgumentsFromFile } from "./launchd-plist.js";
import { resolveLaunchAgentGuiDomain } from "./launchd-runtime.js";
import { resolveLaunchAgentPlistPathForLabel } from "./launchd-service-files.js";

const OMNIPOLYMATH_UPDATE_LAUNCHD_LABEL_PREFIX = "ai.omnipolymath.update.";
const MANUAL_UPDATE_LAUNCHD_LABEL_PATTERN = /^ai\.omnipolymath\.manual-update\.\d+$/;
const OMNIPOLYMATH_PROFILE_UPDATE_LAUNCHD_LABEL_PATTERN =
  /^ai\.omnipolymath\.[A-Za-z0-9._-]+\.update\.[A-Za-z0-9._-]+$/;
const OMNIPOLYMATH_DIRECT_CLI_NAMES = new Set(["omnipolymath", "omnipolymath.mjs"]);
const OMNIPOLYMATH_NODE_RUNTIME_NAMES = new Set(["bun", "bun.exe", "node", "node.exe"]);
export type StaleOmnipolymathUpdateLaunchdJob = {
  label: string;
  pid?: number;
  lastExitStatus?: number;
};

type OmnipolymathUpdateLaunchdLabelCandidate = {
  label: string;
  requiresMetadata: boolean;
};

function normalizeOmnipolymathUpdateLaunchdLabelCandidate(
  label: unknown,
): OmnipolymathUpdateLaunchdLabelCandidate | null {
  if (typeof label !== "string") {
    return null;
  }
  const trimmed = label.trim();
  // Manual update jobs include a timestamp-like suffix and should be cleaned up
  // without matching arbitrary ai.omnipolymath labels.
  if (
    trimmed.startsWith(OMNIPOLYMATH_UPDATE_LAUNCHD_LABEL_PREFIX) ||
    MANUAL_UPDATE_LAUNCHD_LABEL_PATTERN.test(trimmed)
  ) {
    return { label: trimmed, requiresMetadata: false };
  }
  return OMNIPOLYMATH_PROFILE_UPDATE_LAUNCHD_LABEL_PATTERN.test(trimmed)
    ? { label: trimmed, requiresMetadata: true }
    : null;
}

function isCurrentGatewayLaunchdLabel(label: string, env: NodeJS.ProcessEnv): boolean {
  const gatewayProfileLabel = resolveGatewayLaunchAgentLabel(env.OMNIPOLYMATH_PROFILE);
  if (label === gatewayProfileLabel) {
    return true;
  }
  if (
    env.OMNIPOLYMATH_SERVICE_MARKER?.trim() !== GATEWAY_SERVICE_MARKER ||
    env.OMNIPOLYMATH_SERVICE_KIND?.trim() !== GATEWAY_SERVICE_KIND
  ) {
    return false;
  }
  const configuredLabel = env.OMNIPOLYMATH_LAUNCHD_LABEL?.trim();
  return Boolean(configuredLabel && label === configuredLabel);
}

function resolveCurrentOmnipolymathUpdateLaunchdJobLabel(
  env: NodeJS.ProcessEnv = process.env,
): OmnipolymathUpdateLaunchdLabelCandidate | null {
  for (const label of [
    env.LAUNCH_JOB_LABEL,
    env.LAUNCH_JOB_NAME,
    env.XPC_SERVICE_NAME,
    env.OMNIPOLYMATH_LAUNCHD_LABEL,
  ]) {
    const candidate = normalizeOmnipolymathUpdateLaunchdLabelCandidate(label);
    if (candidate && !isCurrentGatewayLaunchdLabel(candidate.label, env)) {
      return candidate;
    }
  }
  return null;
}

function parseLaunchctlListOmnipolymathUpdateJobCandidates(
  output: string,
): Array<StaleOmnipolymathUpdateLaunchdJob & OmnipolymathUpdateLaunchdLabelCandidate> {
  const jobs: Array<StaleOmnipolymathUpdateLaunchdJob & OmnipolymathUpdateLaunchdLabelCandidate> = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    const [pidRaw, statusRaw, ...labelParts] = parts;
    const candidate = normalizeOmnipolymathUpdateLaunchdLabelCandidate(labelParts.join(" "));
    if (!candidate) {
      continue;
    }
    const pid = pidRaw === "-" ? undefined : parseStrictPositiveInteger(pidRaw ?? "");
    const lastExitStatus = parseStrictInteger(statusRaw ?? "");
    jobs.push({
      label: candidate.label,
      requiresMetadata: candidate.requiresMetadata,
      ...(pid !== undefined ? { pid } : {}),
      ...(lastExitStatus !== undefined ? { lastExitStatus } : {}),
    });
  }
  return jobs.toSorted((a, b) => a.label.localeCompare(b.label));
}

function hasOmnipolymathUpdateLaunchdMarker(env: Record<string, string | undefined> | undefined) {
  return env?.OMNIPOLYMATH_UPDATE_RUN_HANDOFF?.trim() === "1";
}

function isOmnipolymathUpdateProgramArguments(programArguments: string[] | undefined): boolean {
  if (!Array.isArray(programArguments) || programArguments.length === 0) {
    return false;
  }
  const updateIndex = programArguments.findIndex((arg) => arg.trim() === "update");
  if (updateIndex < 0 || !programArguments.slice(updateIndex + 1).includes("--yes")) {
    return false;
  }
  const executable = path.basename(programArguments[0] ?? "").toLowerCase();
  const updateCommand =
    updateIndex === 1
      ? OMNIPOLYMATH_DIRECT_CLI_NAMES.has(executable)
      : updateIndex === 2 &&
        OMNIPOLYMATH_NODE_RUNTIME_NAMES.has(executable) &&
        path.basename(programArguments[1] ?? "").toLowerCase() === "omnipolymath.mjs";
  return updateCommand && !programArguments.some((arg) => arg.trim() === "gateway");
}

async function isLaunchdJobConfirmedOmnipolymathUpdater(params: {
  label: string;
  env: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const plistPath = resolveLaunchAgentPlistPathForLabel(params.env, params.label);
  const command = await readLaunchAgentProgramArgumentsFromFile(plistPath);
  return (
    hasOmnipolymathUpdateLaunchdMarker(command?.environment) ||
    isOmnipolymathUpdateProgramArguments(command?.programArguments)
  );
}

export async function findStaleOmnipolymathUpdateLaunchdJobs(
  env: NodeJS.ProcessEnv = process.env,
): Promise<StaleOmnipolymathUpdateLaunchdJob[]> {
  if (process.platform !== "darwin") {
    return [];
  }
  const result = await execLaunchctl(["list"]);
  if (result.code !== 0) {
    throw new Error(
      `launchctl list failed (exit ${result.code}): ${formatLaunchctlResultDetail(result)}`,
    );
  }
  // Never report the active gateway label as stale even when a wrapper exposes
  // update-like launchd metadata through the current environment.
  const jobs: StaleOmnipolymathUpdateLaunchdJob[] = [];
  for (const { requiresMetadata, ...job } of parseLaunchctlListOmnipolymathUpdateJobCandidates(
    result.stdout,
  )) {
    if (isCurrentGatewayLaunchdLabel(job.label, env)) {
      continue;
    }
    if (
      requiresMetadata &&
      !(await isLaunchdJobConfirmedOmnipolymathUpdater({ label: job.label, env }))
    ) {
      continue;
    }
    jobs.push(job);
  }
  return jobs;
}

export async function disableCurrentOmnipolymathUpdateLaunchdJob(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const candidate = resolveCurrentOmnipolymathUpdateLaunchdJobLabel(env);
  if (!candidate || process.platform !== "darwin") {
    return false;
  }
  // Detached handoffs preserve the configured label, so only launchd-backed
  // current-process identity may turn the ambient marker into proof.
  const trustCurrentEnvMarker = isCurrentProcessLaunchdServiceLabel(candidate.label, env);
  if (
    candidate.requiresMetadata &&
    !(
      (trustCurrentEnvMarker && hasOmnipolymathUpdateLaunchdMarker(env)) ||
      (await isLaunchdJobConfirmedOmnipolymathUpdater({ label: candidate.label, env }))
    )
  ) {
    return false;
  }
  const serviceTarget = `${resolveLaunchAgentGuiDomain()}/${assertValidLaunchAgentLabel(candidate.label)}`;
  const result = await execLaunchctl(["disable", serviceTarget]);
  return result.code === 0;
}
