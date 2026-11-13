import { createTestEntrypoint } from "../infra/runtime-entrypoint.test-support.ts";

const entrypoint = createTestEntrypoint(import.meta.url, "state");

// Finite runs share the verified build; standalone/watch rebuilds the packaged fixture.

export const agentDatabaseModuleIdentityEntrypoints = {
  host: entrypoint("omnipolymath-agent-db-module-identity-host.test-support"),
  sdk: entrypoint("omnipolymath-agent-db-module-identity-sdk.test-support"),
} as const;
