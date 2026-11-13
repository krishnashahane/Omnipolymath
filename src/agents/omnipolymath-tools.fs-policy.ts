import type { OmnipolymathToolsOptions } from "./omnipolymath-tools.types.js";
import { subagentAttachmentRootForRun } from "./subagents/subagent-attachment-paths.js";
import { resolveOmnipolymathToolsFsPolicy, type ToolFsPolicy } from "./tool-fs-policy.js";

/**
 * Callers that build Omnipolymath tools without an fsPolicy (Gateway loopback, skill dispatch,
 * the deprecated sync factory) get the same policy the embedded runner would derive. Omission
 * must never read as "unrestricted": the delegate tool grants Full Access without it.
 */
export function resolveCapturedOmnipolymathToolsFsPolicy(
  options: Pick<
    OmnipolymathToolsOptions,
    "fsPolicy" | "config" | "sessionPermissionPolicy" | "runSessionKey" | "agentSessionKey"
  >,
  sessionAgentId: string,
): ToolFsPolicy | undefined {
  return (
    options.fsPolicy ??
    resolveOmnipolymathToolsFsPolicy({
      cfg: options.config,
      agentId: sessionAgentId,
      sessionPermissionPolicy: options.sessionPermissionPolicy,
      attachmentReadRoot: subagentAttachmentRootForRun(
        sessionAgentId,
        options.runSessionKey ?? options.agentSessionKey,
      ),
    })
  );
}
