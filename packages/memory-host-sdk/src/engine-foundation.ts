// Real workspace contract for memory engine foundation concerns.

export {
  resolveAgentContextLimits,
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
  resolveSessionAgentId,
} from "./host/omnipolymath-runtime-agent.js";
export {
  resolveMemorySearchConfig,
  resolveMemorySearchSyncConfig,
  type ResolvedMemorySearchConfig,
  type ResolvedMemorySearchSyncConfig,
} from "./host/omnipolymath-runtime-agent.js";
export { parseDurationMs } from "./host/omnipolymath-runtime-config.js";
export { resolveStateDir } from "./host/omnipolymath-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/omnipolymath-runtime-config.js";
export {
  hasConfiguredSecretInput,
  normalizeResolvedSecretInputString,
} from "./host/omnipolymath-runtime-config.js";
export { root } from "./host/omnipolymath-runtime-io.js";
export { isPathInside } from "./host/fs-utils.js";
export { createSubsystemLogger } from "./host/omnipolymath-runtime-io.js";
export { detectMime } from "./host/omnipolymath-runtime-io.js";
export { resolveGlobalSingleton } from "./host/omnipolymath-runtime-io.js";
export { onSessionTranscriptUpdate } from "./host/omnipolymath-runtime-session.js";
export { splitShellArgs } from "./host/omnipolymath-runtime-io.js";
export { runTasksWithConcurrency } from "./host/omnipolymath-runtime-io.js";
export {
  shortenHomeInString,
  shortenHomePath,
  resolveUserPath,
  truncateUtf16Safe,
} from "./host/omnipolymath-runtime-io.js";
export type { OmnipolymathConfig } from "./host/omnipolymath-runtime-config.js";
export type { SecretInput } from "./host/omnipolymath-runtime-config.js";
export type { MemoryCitationsMode } from "./host/omnipolymath-runtime-config.js";
export type { MemorySearchConfig } from "./host/omnipolymath-runtime-config.js";
