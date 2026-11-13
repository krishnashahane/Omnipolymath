import { warnPluginSdkDeprecation } from "../plugins/sdk-deprecation.js";
import { assembleOmnipolymathCodingTools } from "./agent-tools.assembly.js";
import type { PluginCodingToolsOptions } from "./agent-tools.options.js";
import { prepareCodingToolAssembly } from "./agent-tools.preparation-sync.js";
import type { AnyAgentTool } from "./agent-tools.types.js";
import { withLegacySessionCapabilityRead } from "./subagents/spawn/subagent-session-store-legacy.js";

export {
  createOmnipolymathCodingToolsAsync,
  createOmnipolymathCodingToolsInternalAsync,
} from "./agent-tools.async.js";
export { resolveToolLoopDetectionConfig } from "./tool-loop-detection-config.js";

/** @deprecated Use createOmnipolymathCodingToolsInternalAsync for runtime construction. */
export function createOmnipolymathCodingToolsInternal(
  ...args: Parameters<typeof assembleOmnipolymathCodingTools>
): AnyAgentTool[] {
  return withLegacySessionCapabilityRead(() =>
    prepareCodingToolAssembly(assembleOmnipolymathCodingTools(...args)),
  );
}

/** @deprecated Use createOmnipolymathCodingToolsAsync to prepare policy through the worker. Supported through 2026-12-31. Removal in the first January 2027 stable release. */
export function createOmnipolymathCodingTools(options?: PluginCodingToolsOptions): AnyAgentTool[] {
  warnPluginSdkDeprecation({
    family: "tool-surface",
    method: "createOmnipolymathCodingTools",
    replacement: "await createOmnipolymathCodingToolsAsync()",
  });
  return createOmnipolymathCodingToolsInternal({ ...options, unverifiedExecutionPolicy: true });
}
