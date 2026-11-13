import type { GatewayRequestHandlerOptions } from "omnipolymath/plugin-sdk/gateway-runtime";
import { expectTypeOf } from "vitest";

// Preserve the released synchronous approval commit guard.
expectTypeOf<
  NonNullable<GatewayRequestHandlerOptions["sessionMutationCommitGuard"]>
>().toEqualTypeOf<() => void>();
