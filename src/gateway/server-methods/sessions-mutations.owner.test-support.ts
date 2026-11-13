import { vi } from "vitest";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { trackAsyncWork } from "../../shared/async-work-scope.js";
import { gatewayConnect, gatewayProfile } from "../server/client-fixtures.test-support.js";
import type { GatewayClient, GatewayRequestContext } from "./types.js";

export function createSessionMutationTestClient(profileId?: string): GatewayClient {
  return {
    connect: gatewayConnect(["operator.write"]),
    ...(profileId
      ? {
          authenticatedUserId: `${profileId}@example.com`,
          authenticatedUserProfile: gatewayProfile(profileId, profileId),
        }
      : {}),
  };
}

export function createSessionMutationTestContext(cfg: OmnipolymathConfig) {
  return {
    trackExecution: trackAsyncWork,
    getRuntimeConfig: () => cfg,
    getSessionEventSubscriberConnIds: () => new Set(["observer"]),
    broadcastToConnIds: vi.fn(),
  } as unknown as GatewayRequestContext;
}
