import type { Mock } from "vitest";
import type { GatewayServiceState } from "../../daemon/service.js";
import type { OmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import type { PreManagedServiceStop } from "./update-command-service-context-types.js";

export type OriginalServiceFixture = {
  state: OmnipolymathTestState;
  rootA: string;
  rootB: string;
  serviceNodeRunner: string;
  before: PreManagedServiceStop;
  serviceState: GatewayServiceState;
  mocks: {
    capability: Mock;
    nativeRestart: Mock;
    nativeInstall: Mock;
    restart: Mock;
    health: Mock;
    readiness: Mock;
  };
};
