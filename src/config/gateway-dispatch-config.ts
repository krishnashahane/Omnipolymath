import fs from "node:fs";
import path from "node:path";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { parseJsonWithJson5Fallback } from "../utils/parse-json-compat.js";
import { resolveConfigIncludes } from "./includes.js";
import { resolveConfigForRead } from "./io.read-helpers.js";
import { resolveConfigPath, resolveIncludeRoots } from "./paths.js";
import { setConfigResolutionFacts } from "./resolution-facts.js";
import type { OmnipolymathConfig } from "./types.omnipolymath.js";

const GATEWAY_DISPATCH_SHELL_ENV_EXPECTED_KEYS = [
  "OMNIPOLYMATH_GATEWAY_TOKEN",
  "OMNIPOLYMATH_GATEWAY_PASSWORD",
] as const;

const GATEWAY_DISPATCH_TOP_LEVEL_KEYS = [
  "agents",
  // Store-backed credential refs read the configured state engine.
  "database",
  "env",
  "gateway",
  "plugins",
  "secrets",
  "session",
] as const;

/** Options for reading the reduced config surface used by Gateway dispatch. */
type GatewayDispatchConfigReadOptions = {
  configPath?: string;
  env?: NodeJS.ProcessEnv;
};

function resolveGatewayDispatchConfig(value: unknown, env: NodeJS.ProcessEnv): OmnipolymathConfig {
  if (!isRecord(value)) {
    return {};
  }
  const projected: Record<string, unknown> = {};
  for (const key of GATEWAY_DISPATCH_TOP_LEVEL_KEYS) {
    if (Object.hasOwn(value, key)) {
      projected[key] = value[key];
    }
  }
  // Substitution owns the fresh nested containers; discarded branches need neither
  // substitution nor another deep copy after the complete include graph is resolved.
  const { resolvedConfigRaw, resolutionFacts } = resolveConfigForRead(projected, env);
  const config = resolvedConfigRaw as OmnipolymathConfig;
  // Process-local main-key aliases resolve to the Gateway's canonical key.
  if (config.session?.mainKey !== undefined) {
    config.session.mainKey = "main";
  }
  setConfigResolutionFacts(config, resolutionFacts);
  return config;
}

function readRawGatewayDispatchConfig(options: GatewayDispatchConfigReadOptions = {}): {
  config: OmnipolymathConfig;
  configPath: string;
} {
  const env = options.env ?? process.env;
  const configPath = options.configPath ?? resolveConfigPath(env);
  if (!fs.existsSync(configPath)) {
    return { config: {}, configPath };
  }

  const raw = fs.readFileSync(configPath, "utf-8");
  const parsed = parseJsonWithJson5Fallback(raw);
  const resolvedIncludes = resolveConfigIncludes(parsed, configPath, undefined, {
    allowedRoots: resolveIncludeRoots(env),
  });
  return {
    config: resolveGatewayDispatchConfig(resolvedIncludes, env),
    configPath,
  };
}

export function readGatewayDispatchConfig(
  options: GatewayDispatchConfigReadOptions = {},
): OmnipolymathConfig {
  return readRawGatewayDispatchConfig(options).config;
}

export async function readGatewayDispatchConfigWithShellEnvFallback(
  options: GatewayDispatchConfigReadOptions = {},
): Promise<OmnipolymathConfig> {
  const env = options.env ?? process.env;
  const firstRead = readRawGatewayDispatchConfig(options);
  const {
    loadShellEnvFallback,
    resolveShellEnvFallbackTimeoutMs,
    shouldDeferShellEnvFallback,
    shouldEnableShellEnvFallback,
  } = await import("../infra/shell-env.js");
  const enabled =
    shouldEnableShellEnvFallback(env) || firstRead.config.env?.shellEnv?.enabled === true;
  if (enabled && !shouldDeferShellEnvFallback(env)) {
    const applied = loadShellEnvFallback({
      env,
      expectedKeys: [...GATEWAY_DISPATCH_SHELL_ENV_EXPECTED_KEYS],
      timeoutMs: firstRead.config.env?.shellEnv?.timeoutMs ?? resolveShellEnvFallbackTimeoutMs(env),
    });
    if (applied.length > 0) {
      return readGatewayDispatchConfig({
        ...options,
        configPath: path.resolve(firstRead.configPath),
      });
    }
  }
  return firstRead.config;
}
