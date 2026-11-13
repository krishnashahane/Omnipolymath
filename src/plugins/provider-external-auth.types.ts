import type { AuthProfileStore, OAuthCredential } from "../agents/auth-profiles/types.js";
import type { ModelProviderAuthMode, ModelProviderConfig } from "../config/types.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";

/** Context for resolving synthetic provider credentials from config. */
export type ProviderResolveSyntheticAuthContext = {
  config?: OmnipolymathConfig;
  provider: string;
  providerConfig?: ModelProviderConfig;
};

/** Validated, non-secret native login metadata for display, never auth authority. */
export type ProviderNativeAuthDisplay = {
  kind: "subscription" | "api" | "native";
  plan?: string;
};

/** Synthetic provider credential returned by plugin auth helpers. */
export type ProviderSyntheticAuthResult = {
  apiKey: string;
  source: string;
  mode: Exclude<ModelProviderAuthMode, "aws-sdk" | "none" | "native-command">;
  expiresAt?: number;
  /** Native presence authorizes only this runtime, never a provider bearer request. */
  nativeAuth?: {
    runtime: string;
    mode: "api-key" | "oauth" | "token";
    display?: ProviderNativeAuthDisplay;
  };
};

/** Context for resolving external provider auth profiles. */
export type ProviderResolveExternalAuthProfilesContext = {
  config?: OmnipolymathConfig;
  agentDir?: string;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
  store: AuthProfileStore;
};

/** External auth profile credential resolved for a provider. */
export type ProviderExternalAuthProfile = {
  profileId: string;
  credential: OAuthCredential;
  persistence?: "runtime-only" | "persisted";
};

/** Internal synchronous resolver shared by provider hooks and auth-store overlays. */
export type ProviderExternalAuthProfileResolver = (params: {
  config?: OmnipolymathConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  context: ProviderResolveExternalAuthProfilesContext;
}) => ProviderExternalAuthProfile[];
