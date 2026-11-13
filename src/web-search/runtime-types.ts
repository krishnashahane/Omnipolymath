import type { AuthProfileStore } from "../agents/auth-profiles/types.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { WebSearchProviderToolExecutionContext } from "../plugins/web-provider-types.js";
import type { RuntimeWebSearchMetadata } from "../secrets/runtime-web-tools.types.js";

// Shared web_search runtime contracts. Keep these in a types-only module so
// provider registries and callers can import them without loading runtime code.
export type RuntimeWebSearchConfig = NonNullable<
  NonNullable<OmnipolymathConfig["tools"]>["web"]
>["search"];

export type ResolveWebSearchDefinitionParams = {
  config?: OmnipolymathConfig;
  agentDir?: string;
  authStore?: AuthProfileStore;
  sandboxed?: boolean;
  runtimeWebSearch?: RuntimeWebSearchMetadata;
  providerId?: string;
  preferRuntimeProviders?: boolean;
  preferInputConfig?: boolean;
};

export type RunWebSearchParams = ResolveWebSearchDefinitionParams & {
  args: Record<string, unknown>;
  signal?: AbortSignal;
  /** Caller-owned synchronous authority check, repeated immediately before external requests. */
  assertCurrent?: () => void;
  modelSelection?: WebSearchProviderToolExecutionContext["modelSelection"];
};

export type RunWebSearchResult = {
  provider: string;
  result: Record<string, unknown>;
};
