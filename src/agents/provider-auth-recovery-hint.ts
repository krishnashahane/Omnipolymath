import { normalizeProviderId } from "@omnipolymath/model-catalog-core/provider-id";
import { formatCliCommand } from "../cli/command-format.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resolveManifestProviderAuthChoices } from "../plugins/provider-auth-choices.js";
import { resolveProviderAuthAliasMap } from "./provider-auth-aliases.js";

function normalizeProviderIdForAuth(
  providerId: string,
  aliases: Readonly<Record<string, string>>,
): string {
  const normalized = normalizeProviderId(providerId);
  return normalized ? (aliases[normalized] ?? normalized) : normalized;
}

export function buildProviderAuthRecoveryHint(params: {
  provider: string;
  config?: OmnipolymathConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  includeEnvVar?: boolean;
}): string {
  const aliases = resolveProviderAuthAliasMap(params);
  const normalized = normalizeProviderIdForAuth(params.provider, aliases);
  const choice = resolveManifestProviderAuthChoices(params).find(
    (candidate) =>
      normalized && normalizeProviderIdForAuth(candidate.providerId, aliases) === normalized,
  );
  const loginCommand = choice
    ? formatCliCommand(`omnipolymath models auth login --provider ${normalized}`)
    : undefined;
  const parts: string[] = [];
  if (loginCommand) {
    parts.push(`Run \`${loginCommand}\``);
  }
  parts.push(`\`${formatCliCommand("omnipolymath configure")}\``);
  if (params.includeEnvVar) {
    parts.push("set an API key env var");
  }
  if (parts.length === 1) {
    return `${parts[0]}.`;
  }
  if (parts.length === 2) {
    return `${parts[0]} or ${parts[1]}.`;
  }
  return `${parts[0]}, ${parts[1]}, or ${parts[2]}.`;
}
