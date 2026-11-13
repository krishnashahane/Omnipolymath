// Focused runtime contract for memory plugin config/state/helpers.

export type { AnyAgentTool } from "./host/omnipolymath-runtime-agent.js";
export { resolveCronStyleNow } from "./host/omnipolymath-runtime-agent.js";
export { DEFAULT_AGENT_COMPACTION_RESERVE_TOKENS_FLOOR } from "./host/omnipolymath-runtime-agent.js";
export { resolveDefaultAgentId, resolveSessionAgentId } from "./host/omnipolymath-runtime-agent.js";
export { resolveMemorySearchConfig } from "./host/omnipolymath-runtime-agent.js";
export {
  asToolParamsRecord,
  jsonResult,
  readNumberParam,
  readStringParam,
} from "./host/omnipolymath-runtime-agent.js";
export { SILENT_REPLY_TOKEN } from "./host/omnipolymath-runtime-session.js";
export { parseNonNegativeByteSize } from "./host/omnipolymath-runtime-config.js";
export { getRuntimeConfig } from "./host/omnipolymath-runtime-session.js";
export { resolveStateDir } from "./host/omnipolymath-runtime-config.js";
export { resolveSessionTranscriptsDirForAgent } from "./host/omnipolymath-runtime-config.js";
export { emptyPluginConfigSchema } from "./host/omnipolymath-runtime-memory.js";
export {
  buildActiveMemoryPromptSection,
  getMemoryCapabilityRegistration,
  listActiveMemoryPublicArtifacts,
} from "./host/omnipolymath-runtime-memory.js";
export { parseAgentSessionKey } from "./host/omnipolymath-runtime-agent.js";
export type { OmnipolymathConfig } from "./host/omnipolymath-runtime-config.js";
export type { MemoryCitationsMode } from "./host/omnipolymath-runtime-config.js";
export type {
  MemoryFlushPlan,
  MemoryFlushPlanResolver,
  MemoryPluginCapability,
  MemoryPluginPublicArtifact,
  MemoryPluginPublicArtifactsProvider,
  MemoryPluginRuntime,
  MemoryPromptSectionBuilder,
} from "./host/omnipolymath-runtime-memory.js";
export type { OmnipolymathPluginApi } from "./host/omnipolymath-runtime-memory.js";
