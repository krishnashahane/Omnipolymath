import { uniqueStrings } from "@omnipolymath/normalization-core/string-normalization";
import { listKnownChannelEnvVarNames } from "../secrets/channel-env-vars.js";
import { listKnownProviderAuthEnvVarNamesCore } from "../secrets/provider-env-vars.js";
import type { OmnipolymathConfig } from "./types.omnipolymath.js";

const CORE_SHELL_ENV_EXPECTED_KEYS = ["OMNIPOLYMATH_GATEWAY_TOKEN", "OMNIPOLYMATH_GATEWAY_PASSWORD"];

/** Includes configured plugin paths when selecting keys for login-shell import. */
export function resolveShellEnvExpectedKeys(
  env: NodeJS.ProcessEnv,
  config?: OmnipolymathConfig,
): string[] {
  return uniqueStrings([
    ...listKnownProviderAuthEnvVarNamesCore({ config, env }),
    ...listKnownChannelEnvVarNames({ config, env }),
    ...CORE_SHELL_ENV_EXPECTED_KEYS,
  ]);
}
