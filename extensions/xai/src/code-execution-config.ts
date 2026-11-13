import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { resolvePluginConfigObject } from "omnipolymath/plugin-sdk/plugin-config-runtime";
import { asOptionalObjectRecord } from "omnipolymath/plugin-sdk/string-coerce-runtime";
import { isXaiToolEnabled, type XaiToolAuthContext } from "./tool-auth-shared.js";

type CodeExecutionConfig = {
  enabled?: boolean;
  model?: string;
  maxTurns?: number;
  timeoutSeconds?: number;
};

export function readPluginCodeExecutionConfig(
  cfg?: OmnipolymathConfig,
): CodeExecutionConfig | undefined {
  return asOptionalObjectRecord(resolvePluginConfigObject(cfg, "xai")?.codeExecution);
}

export function resolveCodeExecutionEnabled(params: {
  sourceConfig?: OmnipolymathConfig;
  runtimeConfig?: OmnipolymathConfig;
  config?: CodeExecutionConfig;
  auth?: XaiToolAuthContext;
}): boolean {
  return isXaiToolEnabled({
    enabled: params.config?.enabled,
    runtimeConfig: params.runtimeConfig,
    sourceConfig: params.sourceConfig,
    auth: params.auth,
  });
}
