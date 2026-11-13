import { resolveWorkspaceStateIdentity } from "../agents/workspace-state-identity.js";
import {
  ONBOARDING_RECOMMENDATIONS_STATE_KEY_PREFIX,
  prepareOnboardingRecommendationOffer,
  prepareOnboardingRecommendationPending,
  type OnboardingRecommendationsRecord,
  type WriteOnboardingRecommendationsOfferParams,
  type AcknowledgeOnboardingRecommendationsParams,
  type UpdatePendingOnboardingRecommendationsParams,
  type ClearPendingOnboardingRecommendationsParams,
} from "./onboarding-recommendations.contract.js";
import { executeExistingOmnipolymathStateRead } from "./omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.js";
import { executeOmnipolymathStateWorker } from "./omnipolymath-state-worker-store.js";

export type {
  OnboardingRecommendationMatch,
  OnboardingRecommendationsRecord,
} from "./onboarding-recommendations.contract.js";

export function createOnboardingRecommendationsStore(params: {
  workspaceDir: string;
  database?: Pick<OmnipolymathStateDatabaseOptions, "path" | "env">;
}) {
  // Doctor owns the one-time `primary` migration; a runtime fallback would recreate
  // cross-workspace reads. Every operation stays bound to one canonical workspace key.
  const { workspaceKey } = resolveWorkspaceStateIdentity(params.workspaceDir);
  const configKey = `${ONBOARDING_RECOMMENDATIONS_STATE_KEY_PREFIX}${workspaceKey}`;
  const database = params.database ?? {};
  return {
    read: async (): Promise<OnboardingRecommendationsRecord | null> => {
      const result = await executeExistingOmnipolymathStateRead(database, {
        type: "onboardingRecommendations.read",
        configKey,
      });
      if (result === undefined) {
        return null;
      }
      return result.record;
    },
    writeOffer: (offer: WriteOnboardingRecommendationsOfferParams) => {
      const captured = prepareOnboardingRecommendationOffer(offer);
      const context = captureOmnipolymathStateWorkerContext(database);
      return executeOmnipolymathStateWorker(context, {
        type: "onboardingRecommendations.writeOffer",
        input: { workspaceKey, params: captured },
      });
    },
    acknowledge: (options: AcknowledgeOnboardingRecommendationsParams = {}) => {
      const context = captureOmnipolymathStateWorkerContext(database);
      const captured = { ...options, nowMs: options.nowMs ?? Date.now() };
      return executeOmnipolymathStateWorker(context, {
        type: "onboardingRecommendations.acknowledge",
        input: { workspaceKey, params: captured },
      });
    },
    updatePending: (options: UpdatePendingOnboardingRecommendationsParams) => {
      const captured = prepareOnboardingRecommendationPending(options);
      const context = captureOmnipolymathStateWorkerContext(database);
      return executeOmnipolymathStateWorker(context, {
        type: "onboardingRecommendations.updatePending",
        input: { workspaceKey, params: captured },
      });
    },
    clearPending: (options: ClearPendingOnboardingRecommendationsParams) => {
      const context = captureOmnipolymathStateWorkerContext(database);
      return executeOmnipolymathStateWorker(context, {
        type: "onboardingRecommendations.clearPending",
        input: { workspaceKey, params: options },
      });
    },
    clear: () => {
      return executeOmnipolymathStateWorker(captureOmnipolymathStateWorkerContext(database), {
        type: "onboardingRecommendations.clear",
        input: { workspaceKey },
      });
    },
  };
}

export type OnboardingRecommendationsStore = ReturnType<
  typeof createOnboardingRecommendationsStore
>;
