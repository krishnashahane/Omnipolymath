import { resolveStateDir } from "../config/paths.js";
import { getSessionActorStorageBinding } from "../config/sessions/session-actor-storage-binding.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { withMemorySessionRows } from "./session-row-projection-memory.js";
import type { Row } from "./session-row-projection-record.js";

/** Private rows borrow existing memory owners through synchronous presentation. */
export function withBoundIncognitoSessionRows<T>(
  cfg: OmnipolymathConfig,
  queries: readonly { key: string; agentId: string; storePath?: string }[],
  consume: (rows: ReadonlyMap<string, Row | undefined>) => T,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const env = { ...environment, OMNIPOLYMATH_STATE_DIR: resolveStateDir(environment) };
  return withMemorySessionRows(getSessionActorStorageBinding({}), cfg, queries, consume, env);
}
