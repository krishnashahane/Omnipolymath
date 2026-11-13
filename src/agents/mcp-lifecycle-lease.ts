import type { OmnipolymathStateDatabaseOptions } from "../state/omnipolymath-state-db.js";
import {
  withOmnipolymathStateLeaseAsync,
  type OmnipolymathStateAsyncLeaseContext,
} from "../state/omnipolymath-state-lease.js";
import { captureOmnipolymathStateWorkerContext } from "../state/omnipolymath-state-worker-context.js";

const MCP_LIFECYCLE_LEASE_SCOPE = "core:claw-mcp-lifecycle";
const MCP_LIFECYCLE_LEASE_MS = 5 * 60_000;
const MCP_LIFECYCLE_WAIT_MS = 10 * 60_000;

type McpLifecycleLeaseOptions = Pick<OmnipolymathStateDatabaseOptions, "env" | "path">;

/** Serialize ownership decisions and global config mutations for one MCP server. */
export async function withMcpLifecycleLease<T>(
  name: string,
  options: McpLifecycleLeaseOptions,
  run: (lease: OmnipolymathStateAsyncLeaseContext) => Promise<T>,
): Promise<T> {
  return await withOmnipolymathStateLeaseAsync(
    {
      scope: MCP_LIFECYCLE_LEASE_SCOPE,
      key: name.trim(),
      leaseMs: MCP_LIFECYCLE_LEASE_MS,
      waitMs: MCP_LIFECYCLE_WAIT_MS,
      leaseLabel: "Template MCP lifecycle lease",
      operationLabel: "templates.mcp.lifecycle.lease",
    },
    captureOmnipolymathStateWorkerContext(options),
    run,
  );
}
