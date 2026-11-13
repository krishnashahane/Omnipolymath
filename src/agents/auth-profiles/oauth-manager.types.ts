import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { OAuthRefreshCohort } from "./oauth-refresh-queue.js";
import type { PersonalAuthProfileStore } from "./personal-store.js";
import type { OAuthCredential } from "./types.js";

export type OAuthRefreshParams = {
  cohort: OAuthRefreshCohort;
  personalStore?: PersonalAuthProfileStore;
  profileId: string;
  provider: string;
  agentDir?: string;
  cfg?: OmnipolymathConfig;
  signal?: AbortSignal;
  forceRefresh?: boolean;
  attemptedCredential: OAuthCredential;
  attemptedCredentials?: OAuthCredential[];
  bootstrapCredential?: OAuthCredential | null;
  bootstrapBaseCredential?: OAuthCredential;
  validateCredential?: (credential: OAuthCredential) => void;
  assertRefreshAdmission?: () => void;
};
