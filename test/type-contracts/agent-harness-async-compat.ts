import type {
  createOmnipolymathCodingTools,
  createOmnipolymathCodingToolsAsync,
} from "omnipolymath/plugin-sdk/agent-harness";
import type {
  AgentHarnessAttemptParamsV2,
  AnyAgentTool,
} from "omnipolymath/plugin-sdk/agent-harness-runtime";
import { expectTypeOf } from "vitest";

// Retains synchronous harness factories from v2026.9.8 with awaited replacements.
type Host = AgentHarnessAttemptParamsV2["hostCapabilities"];
type SyncHostFactory = NonNullable<Host["createToolSurface"]>;
type AsyncHostFactory = NonNullable<Host["createToolSurfaceAsync"]>;
type PublicOptions = NonNullable<Parameters<typeof createOmnipolymathCodingTools>[0]>;
type ReleasedHostFactory = (
  options: Omit<PublicOptions, "operationalRunInstance">,
  bindingOptions?: Readonly<{ cwd?: string }>,
) => AnyAgentTool[];
expectTypeOf<SyncHostFactory>().toExtend<ReleasedHostFactory>();
expectTypeOf<ReleasedHostFactory>().toExtend<SyncHostFactory>();
expectTypeOf<Parameters<AsyncHostFactory>>().toEqualTypeOf<Parameters<SyncHostFactory>>();
expectTypeOf<ReturnType<AsyncHostFactory>>().toEqualTypeOf<Promise<AnyAgentTool[]>>();
expectTypeOf<ReturnType<typeof createOmnipolymathCodingTools>>().toEqualTypeOf<AnyAgentTool[]>();
expectTypeOf<Parameters<typeof createOmnipolymathCodingToolsAsync>>().toEqualTypeOf<
  Parameters<typeof createOmnipolymathCodingTools>
>();
expectTypeOf<ReturnType<typeof createOmnipolymathCodingToolsAsync>>().toEqualTypeOf<
  Promise<AnyAgentTool[]>
>();
