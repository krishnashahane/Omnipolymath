import {
  execPolicy,
  type EmbeddedRunAttemptParamsV2,
} from "omnipolymath/plugin-sdk/agent-harness-runtime";
import { resolveAgentConfig } from "omnipolymath/plugin-sdk/agent-scope-runtime";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import {
  resolveExecApprovalsFromFile,
  type ExecApprovalsFile,
} from "omnipolymath/plugin-sdk/exec-approvals-runtime";
import type {
  OmnipolymathExecApprovalFloorsForCodexAppServer,
  OmnipolymathExecMode,
  OmnipolymathExecPolicyForCodexAppServer,
} from "./config-contracts.js";
import { readExecAsk, readExecSecurity, readRecord } from "./config-utils.js";

export function resolveOmnipolymathExecPolicyForCodexAppServer(params: {
  permissionMode?: EmbeddedRunAttemptParamsV2["permissionMode"];
  execOverrides?: {
    mode?: unknown;
    security?: unknown;
    ask?: unknown;
  };
  approvals?: ExecApprovalsFile;
  config?: OmnipolymathConfig;
  agentId?: string;
}): OmnipolymathExecPolicyForCodexAppServer {
  if (params.permissionMode === "full") {
    return resolveOmnipolymathExecPolicy({ mode: "full" });
  }
  const globalExec = readRecord(params.config?.tools?.exec);
  const globalPolicy = applyOmnipolymathExecPolicyLayer(
    resolveOmnipolymathExecPolicy({ mode: "full" }, false),
    globalExec,
  );
  const agentId = params.agentId?.trim();
  const agentExec = agentId
    ? readRecord(resolveAgentConfig(params.config ?? {}, agentId)?.tools?.exec)
    : undefined;
  const basePolicy = applyOmnipolymathExecPolicyLayer(globalPolicy, agentExec);
  const overridePolicy = applyOmnipolymathExecPolicyLayer(basePolicy, params.execOverrides);
  const approvalFloors = params.approvals
    ? resolveExecApprovalsFromFile({
        file: params.approvals,
        agentId: params.agentId,
        overrides: { security: overridePolicy.security, ask: overridePolicy.ask },
      }).agent
    : undefined;
  if (!approvalFloors) {
    return overridePolicy;
  }
  const nextSecurity = approvalFloors.security
    ? execPolicy.minSecurity(overridePolicy.security, approvalFloors.security)
    : overridePolicy.security;
  const nextAsk = approvalFloors.ask
    ? execPolicy.maxAsk(overridePolicy.ask, approvalFloors.ask)
    : overridePolicy.ask;
  if (nextSecurity === overridePolicy.security && nextAsk === overridePolicy.ask) {
    return overridePolicy;
  }
  return resolveOmnipolymathExecPolicy({ security: nextSecurity, ask: nextAsk });
}

function applyOmnipolymathExecPolicyLayer(
  base: OmnipolymathExecPolicyForCodexAppServer,
  exec?: { mode?: unknown; security?: unknown; ask?: unknown },
): OmnipolymathExecPolicyForCodexAppServer {
  if (!exec) {
    return base;
  }
  const mode = readExecMode(exec.mode);
  if (mode !== undefined) {
    return resolveOmnipolymathExecPolicy({ mode });
  }
  const security = readExecSecurity(exec.security);
  const ask = readExecAsk(exec.ask);
  if (security === undefined && ask === undefined) {
    return base;
  }
  return resolveOmnipolymathExecPolicy({ security: security ?? base.security, ask: ask ?? base.ask });
}

function resolveOmnipolymathExecPolicy(
  policy: OmnipolymathExecApprovalFloorsForCodexAppServer & { mode?: OmnipolymathExecMode },
  touched = true,
): OmnipolymathExecPolicyForCodexAppServer {
  const { mode, security, ask } = execPolicy.resolveExecModePolicy({
    mode: policy.mode,
    security: policy.security ?? "full",
    ask: policy.ask ?? "off",
  });
  return { mode, security, ask, touched };
}

function readExecMode(value: unknown): OmnipolymathExecMode | undefined {
  return value === "deny" ||
    value === "allowlist" ||
    value === "ask" ||
    value === "auto" ||
    value === "full"
    ? value
    : undefined;
}
