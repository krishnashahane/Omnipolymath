import { normalizeLowercaseStringOrEmpty } from "@omnipolymath/normalization-core/string-coerce";

// Default service labels (canonical + legacy compatibility)
export const GATEWAY_LAUNCH_AGENT_LABEL = "ai.omnipolymath.gateway";
const GATEWAY_SYSTEMD_SERVICE_NAME = "omnipolymath-gateway";
const GATEWAY_WINDOWS_TASK_NAME = "Omnipolymath Gateway";
export const GATEWAY_SERVICE_MARKER = "omnipolymath";
export const GATEWAY_SERVICE_KIND = "gateway";
export const GATEWAY_SERVICE_RUNTIME_PID_ENV = "OMNIPOLYMATH_GATEWAY_SERVICE_PID";
export const GATEWAY_SERVICE_SELECTOR_ENV_KEYS = [
  "OMNIPOLYMATH_STATE_DIR",
  "OMNIPOLYMATH_CONFIG_PATH",
  "OMNIPOLYMATH_PROFILE",
  "OMNIPOLYMATH_GATEWAY_PORT",
  "OMNIPOLYMATH_LAUNCHD_LABEL",
  "OMNIPOLYMATH_SYSTEMD_UNIT",
  "OMNIPOLYMATH_WINDOWS_TASK_NAME",
] as const;

export function isGatewayServiceEnv(env: Record<string, string | undefined>): boolean {
  if (env.OMNIPOLYMATH_SERVICE_MARKER?.trim() !== GATEWAY_SERVICE_MARKER) {
    return false;
  }
  const serviceKind = env.OMNIPOLYMATH_SERVICE_KIND?.trim();
  return !serviceKind || serviceKind === GATEWAY_SERVICE_KIND;
}

const NODE_LAUNCH_AGENT_LABEL = "ai.omnipolymath.node";
const NODE_SYSTEMD_SERVICE_NAME = "omnipolymath-node";
const NODE_WINDOWS_TASK_NAME = "Omnipolymath Node";
const NODE_SERVICE_MARKER = "omnipolymath";
export const NODE_SERVICE_KIND = "node";
const NODE_WINDOWS_TASK_SCRIPT_NAME = "node.cmd";
export const LEGACY_GATEWAY_SYSTEMD_SERVICE_NAMES: string[] = ["clawdbot-gateway"];

function normalizeGatewayProfile(profile?: string): string | null {
  const trimmed = profile?.trim();
  // The default profile keeps the historical unqualified service names.
  return trimmed && normalizeLowercaseStringOrEmpty(trimmed) !== "default" ? trimmed : null;
}

export function resolveGatewayProfileSuffix(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `-${normalized}` : "";
}

export function resolveGatewayLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `ai.omnipolymath.${normalized}` : GATEWAY_LAUNCH_AGENT_LABEL;
}

export function resolveGatewaySystemdServiceName(profile?: string): string {
  return `${GATEWAY_SYSTEMD_SERVICE_NAME}${resolveGatewayProfileSuffix(profile)}`;
}

/**
 * Service-name candidates for a profile, preferred order.
 *
 * Current installs use `omnipolymath-gateway[-profile]`. Older multi-agent hosts
 * used `omnipolymath-<profile>` (no "gateway" segment). Doctor/runtime resolution
 * must try both for the same profile before scanning unrelated units.
 */
export function resolveGatewaySystemdServiceNameCandidates(profile?: string): string[] {
  const canonical = resolveGatewaySystemdServiceName(profile);
  const suffix = resolveGatewayProfileSuffix(profile);
  if (!suffix) {
    // Default profile: omnipolymath-gateway is current; bare omnipolymath is a known
    // legacy system-unit name (parallel to omnipolymath-<profile> for named agents).
    // Custom names are matched separately against their effective installation identity.
    return [canonical, "omnipolymath"];
  }
  const legacy = `omnipolymath${suffix}`;
  // Never adopt the default node or another profile's canonical Gateway.
  return legacy === NODE_SYSTEMD_SERVICE_NAME ||
    legacy === GATEWAY_SYSTEMD_SERVICE_NAME ||
    legacy.startsWith(`${GATEWAY_SYSTEMD_SERVICE_NAME}-`)
    ? [canonical]
    : [canonical, legacy];
}

export function resolveGatewayWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `${GATEWAY_WINDOWS_TASK_NAME} (${normalized})` : GATEWAY_WINDOWS_TASK_NAME;
}

export function normalizeWindowsTaskIdentity(value: string): string {
  // Root prefixes and casing do not change task identity; nested folders do.
  return value.replace(/^\\+/, "").toLowerCase();
}

type GatewayNativeServiceIdentityConflict = {
  envKey: "OMNIPOLYMATH_LAUNCHD_LABEL" | "OMNIPOLYMATH_SYSTEMD_UNIT" | "OMNIPOLYMATH_WINDOWS_TASK_NAME";
  expected: string;
};

export function resolveGatewayNativeServiceIdentityConflict(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): GatewayNativeServiceIdentityConflict | null {
  const profile = normalizeGatewayProfile(env.OMNIPOLYMATH_PROFILE);
  if (!profile) {
    return null;
  }

  if (platform === "darwin") {
    const envKey = "OMNIPOLYMATH_LAUNCHD_LABEL";
    const actual = env[envKey]?.trim();
    const expected = resolveGatewayLaunchAgentLabel(profile);
    return actual && actual !== expected ? { envKey, expected } : null;
  }
  if (platform === "linux") {
    const envKey = "OMNIPOLYMATH_SYSTEMD_UNIT";
    const actual = env[envKey]?.trim();
    const normalizedActual = actual?.endsWith(".service") ? actual : actual && `${actual}.service`;
    const expected = `${resolveGatewaySystemdServiceName(profile)}.service`;
    return normalizedActual && normalizedActual !== expected ? { envKey, expected } : null;
  }
  if (platform === "win32") {
    const envKey = "OMNIPOLYMATH_WINDOWS_TASK_NAME";
    const actual = env[envKey]?.trim();
    const expected = resolveGatewayWindowsTaskName(profile);
    return actual && normalizeWindowsTaskIdentity(actual) !== normalizeWindowsTaskIdentity(expected)
      ? { envKey, expected }
      : null;
  }
  return null;
}

function formatGatewayServiceDescription(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `Omnipolymath Gateway (profile: ${normalized})` : "Omnipolymath Gateway";
}

export function resolveGatewayServiceDescription(params: {
  env: Record<string, string | undefined>;
  description?: string;
}): string {
  return params.description ?? formatGatewayServiceDescription(params.env.OMNIPOLYMATH_PROFILE);
}

export function resolveNodeLaunchAgentLabel(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `${NODE_LAUNCH_AGENT_LABEL}.${normalized}` : NODE_LAUNCH_AGENT_LABEL;
}

export function isNodeLaunchAgentLabel(label: string): boolean {
  return label === NODE_LAUNCH_AGENT_LABEL || label.startsWith(`${NODE_LAUNCH_AGENT_LABEL}.`);
}

export function resolveNodeSystemdServiceName(profile?: string): string {
  return `${NODE_SYSTEMD_SERVICE_NAME}${resolveGatewayProfileSuffix(profile)}`;
}

export function resolveNodeWindowsTaskName(profile?: string): string {
  const normalized = normalizeGatewayProfile(profile);
  return normalized ? `${NODE_WINDOWS_TASK_NAME} (${normalized})` : NODE_WINDOWS_TASK_NAME;
}

export function resolveNodeServiceIdentityEnvironment(
  env: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  const profile = env.OMNIPOLYMATH_PROFILE;
  return {
    OMNIPOLYMATH_PROFILE: profile,
    OMNIPOLYMATH_LAUNCHD_LABEL: resolveNodeLaunchAgentLabel(profile),
    OMNIPOLYMATH_SYSTEMD_UNIT: resolveNodeSystemdServiceName(profile),
    OMNIPOLYMATH_WINDOWS_TASK_NAME: resolveNodeWindowsTaskName(profile),
    OMNIPOLYMATH_WINDOWS_TASK_HIDDEN_LAUNCHER: "1",
    OMNIPOLYMATH_TASK_SCRIPT_NAME: NODE_WINDOWS_TASK_SCRIPT_NAME,
    // launchd writes every node's supervisor logs to one ~/Library/Logs/omnipolymath.
    OMNIPOLYMATH_LOG_PREFIX: `node${resolveGatewayProfileSuffix(profile)}`,
    OMNIPOLYMATH_SERVICE_MARKER: NODE_SERVICE_MARKER,
    OMNIPOLYMATH_SERVICE_KIND: NODE_SERVICE_KIND,
  };
}
