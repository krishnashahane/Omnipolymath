import type { SessionRow } from "@omnipolymath/gateway-protocol";

export type { AgentsListResult } from "@omnipolymath/gateway-protocol";
export type GatewaySessionRow = SessionRow & {
  hasActiveRun?: boolean;
  abortedLastRun?: boolean;
};
