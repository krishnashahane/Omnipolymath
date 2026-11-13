import type {
  EmbeddedRunAttemptParamsV2,
  resolveSandboxContext,
} from "omnipolymath/plugin-sdk/agent-harness-runtime";
import { runWithCronCreatorAuthorityCapabilityResolver } from "omnipolymath/plugin-sdk/codex-mcp-projection";
import { isCodexPairedNodeRemoteExecPlacementSandbox } from "./config.js";

type OmnipolymathCodingToolsOptions = NonNullable<
  Parameters<
    (typeof import("omnipolymath/plugin-sdk/agent-harness"))["createOmnipolymathCodingToolsAsync"]
  >[0]
>;
type OmnipolymathSandboxContext = Awaited<ReturnType<typeof resolveSandboxContext>>;

/** Constructs through the live host while preserving the originating cron authority scope. */
export function createCodexHostToolSurface(
  params: Pick<
    EmbeddedRunAttemptParamsV2,
    "hostCapabilities" | "cronCreatorAuthorityCapability" | "runId"
  >,
  options: OmnipolymathCodingToolsOptions,
  bindingOptions: Readonly<{ cwd: string; nativeLocalExecution?: true }>,
  resolveCronCreatorToolAuthority?: Parameters<
    typeof runWithCronCreatorAuthorityCapabilityResolver
  >[0]["resolve"],
) {
  const construct = () => {
    const createToolSurfaceAsync = params.hostCapabilities.createToolSurfaceAsync;
    if (!createToolSurfaceAsync) {
      throw new Error("Codex tool construction requires a current host capability");
    }
    return createToolSurfaceAsync(options, bindingOptions);
  };
  return resolveCronCreatorToolAuthority
    ? runWithCronCreatorAuthorityCapabilityResolver({
        capability: params.cronCreatorAuthorityCapability,
        runId: params.runId,
        resolve: resolveCronCreatorToolAuthority,
        run: construct,
      })
    : construct();
}

/** Keeps node filesystem and process ownership on its native exec-server. */
export function resolveCodexToolConstructionPlan(
  sandbox: OmnipolymathSandboxContext | undefined,
  nativeToolSurfaceEnabled: boolean | undefined,
  requireWorkspaceOnly: boolean | undefined,
): OmnipolymathCodingToolsOptions["toolConstructionPlan"] {
  const nodeExecution =
    isCodexPairedNodeRemoteExecPlacementSandbox(sandbox) && sandbox?.backendId === "node";
  if (!nodeExecution && !requireWorkspaceOnly) {
    return undefined;
  }
  if (nodeExecution && !nativeToolSurfaceEnabled) {
    throw new Error(
      "Codex node execution requires its native exec-server tool surface; adjust the session tool policy and start a fresh attempt.",
    );
  }
  return {
    includeBaseCodingTools: !nodeExecution,
    includeShellTools: false,
    includeChannelTools: true,
    includeOmnipolymathTools: true,
    includePluginTools: true,
  };
}
