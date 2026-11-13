import { normalizeTrimmedStringList } from "@omnipolymath/normalization-core/string-normalization";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { resolveExternalCliAuthScopeFromConfig } from "./external-cli-scope.js";

export type ExternalCliAuthDiscovery =
  | {
      mode: "none";
      allowKeychainPrompt?: false;
      config?: OmnipolymathConfig;
    }
  | {
      mode: "existing";
      allowKeychainPrompt?: boolean;
      config?: OmnipolymathConfig;
    }
  | {
      mode: "scoped";
      allowKeychainPrompt?: boolean;
      config?: OmnipolymathConfig;
      providerIds?: Iterable<string>;
      profileIds?: Iterable<string>;
    };

function externalCliDiscoveryNone(params?: { config?: OmnipolymathConfig }): ExternalCliAuthDiscovery {
  return {
    mode: "none",
    allowKeychainPrompt: false,
    ...(params?.config ? { config: params.config } : {}),
  };
}

export function externalCliDiscoveryScoped(
  params: Omit<Extract<ExternalCliAuthDiscovery, { mode: "scoped" }>, "mode">,
): ExternalCliAuthDiscovery {
  return {
    mode: "scoped",
    ...(params.allowKeychainPrompt !== undefined
      ? { allowKeychainPrompt: params.allowKeychainPrompt }
      : {}),
    ...(params.config ? { config: params.config } : {}),
    ...(params.providerIds ? { providerIds: params.providerIds } : {}),
    ...(params.profileIds ? { profileIds: params.profileIds } : {}),
  };
}

export function externalCliDiscoveryForProviderAuth(params: {
  cfg?: OmnipolymathConfig;
  provider: string;
  profileId?: string;
  preferredProfile?: string;
  allowKeychainPrompt?: boolean;
}): ExternalCliAuthDiscovery {
  const profileIds = normalizeTrimmedStringList([params.profileId, params.preferredProfile]);
  return externalCliDiscoveryScoped({
    config: params.cfg,
    allowKeychainPrompt: params.allowKeychainPrompt ?? false,
    providerIds: [params.provider],
    ...(profileIds.length > 0 ? { profileIds } : {}),
  });
}

export function externalCliDiscoveryForConfigStatus(params: {
  cfg: OmnipolymathConfig;
}): ExternalCliAuthDiscovery {
  const scope = resolveExternalCliAuthScopeFromConfig(params.cfg);
  return scope
    ? externalCliDiscoveryScoped({
        config: params.cfg,
        allowKeychainPrompt: false,
        providerIds: scope.providerIds,
        profileIds: scope.profileIds,
      })
    : externalCliDiscoveryNone({ config: params.cfg });
}

export function externalCliDiscoveryForProviders(params: {
  cfg?: OmnipolymathConfig;
  providers: Iterable<string>;
}): ExternalCliAuthDiscovery {
  const providers = normalizeTrimmedStringList([...params.providers]);
  if (providers.length === 0) {
    return externalCliDiscoveryNone({ config: params.cfg });
  }
  return externalCliDiscoveryScoped({
    config: params.cfg,
    allowKeychainPrompt: false,
    providerIds: providers,
  });
}
