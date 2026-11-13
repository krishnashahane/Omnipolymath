import type { SessionManager } from "omnipolymath/plugin-sdk/agent-sessions";
import { expectTypeOf } from "vitest";

// agent sessions SDK
// keeps SessionManager.persist public
expectTypeOf<SessionManager["persist"]>().toBeFunction();

// keeps tool-result preparation internal
expectTypeOf<typeof import("omnipolymath/plugin-sdk/agent-sessions")>().not.toHaveProperty(
  "prepareSessionToolResult",
);
expectTypeOf<typeof import("omnipolymath/plugin-sdk/agent-sessions")>().not.toHaveProperty(
  "setSessionToolResultPreparer",
);
