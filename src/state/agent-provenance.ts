import { executeSqliteQuerySync, getNodeSqliteKysely } from "../infra/kysely-sync.js";
import type { EngineConnection } from "../infra/sql-connection.js";
import { createSqliteWorkerWriteAdmission } from "../infra/sqlite-worker-store.js";
import { normalizeAgentId } from "../routing/session-key.js";
import {
  agentProvenancePublication,
  withAgentProvenancePublication,
} from "./agent-provenance-publication.js";
import type { AgentCreatedVia, AgentProvenance } from "./agent-provenance.types.js";
import { executeExistingOmnipolymathStateRead } from "./omnipolymath-state-db-readonly.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "./omnipolymath-state-db.generated.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db.js";
import { captureOmnipolymathStateWorkerContext } from "./omnipolymath-state-worker-context.js";

export type { AgentCreatedVia, AgentProvenance } from "./agent-provenance.types.js";

type AgentProvenanceDatabase = Pick<OmnipolymathStateKyselyDatabase, "agent_provenance">;
type AgentProvenanceOptions = OmnipolymathStateDatabaseOptions & { nowMs?: number };

export async function recordAgentProvenance(
  agentId: string,
  provenance: { createdVia: AgentCreatedVia; creatorAgentId?: string },
  options: AgentProvenanceOptions = {},
): Promise<void> {
  const context = captureOmnipolymathStateWorkerContext({
    ...options,
    path: options.database?.path ?? options.path,
  });
  const input = {
    agentId: normalizeAgentId(agentId),
    createdVia: provenance.createdVia,
    creatorAgentId: provenance.creatorAgentId ? normalizeAgentId(provenance.creatorAgentId) : null,
    createdAtMs: options.nowMs ?? Date.now(),
  };
  const { runOmnipolymathStateWorkerOperation } = await import("./omnipolymath-state-worker-store.js");
  await runOmnipolymathStateWorkerOperation(
    context,
    (scope) => scope.execute({ type: "agentProvenance.record", input }),
    {
      createAdmission: withAgentProvenancePublication(
        createSqliteWorkerWriteAdmission(context.admission.assertCurrent, [
          context.admission.databasePath,
        ]),
        context,
      ),
    },
  );
}

type AgentProvenanceReadOptions = Pick<OmnipolymathStateDatabaseOptions, "env" | "path">;
const DISPLAY_PROVENANCE_BATCH_SIZE = 256;

/** Read provenance for the selected presentation roster in bounded worker batches. */
export async function readAgentProvenanceForDisplay(
  agentIds: readonly string[],
  options: AgentProvenanceReadOptions = {},
): Promise<AgentProvenance[]> {
  if (agentIds.length === 0) {
    return [];
  }
  const context = captureOmnipolymathStateWorkerContext(options);
  const requestedIds = agentIds.map(normalizeAgentId);
  const records: AgentProvenance[] = [];
  // Canonical IDs are bounded; chunking keeps roster growth below broker input
  // admission limits while preserving caller order and the first read error.
  for (let offset = 0; offset < requestedIds.length; offset += DISPLAY_PROVENANCE_BATCH_SIZE) {
    const batch = await executeExistingOmnipolymathStateRead(
      { path: context.admission.databasePath, env: context.environment },
      {
        type: "agentProvenance.readBatch",
        input: { agentIds: requestedIds.slice(offset, offset + DISPLAY_PROVENANCE_BATCH_SIZE) },
      },
      { context, current: true },
    );
    context.admission.assertCurrent();
    records.push(...(batch?.records ?? []));
  }
  return records;
}

export async function listAgentProvenance(
  options: AgentProvenanceReadOptions = {},
): Promise<AgentProvenance[]> {
  const context = captureOmnipolymathStateWorkerContext(options);
  const reply = await executeExistingOmnipolymathStateRead(
    { path: context.admission.databasePath, env: context.environment },
    { type: "agentProvenance.list", input: undefined },
    { context, current: true },
  );
  context.admission.assertCurrent();
  return reply?.records ?? [];
}

/** Delete one row inside the caller's authoritative state transaction. */
export function deleteAgentProvenanceForAgent(database: EngineConnection, agentId: string): void {
  const db = getNodeSqliteKysely<AgentProvenanceDatabase>(database);
  executeSqliteQuerySync(
    database,
    db.deleteFrom("agent_provenance").where("agent_id", "=", normalizeAgentId(agentId)),
  );
  agentProvenancePublication.stageDeletions(database, [normalizeAgentId(agentId)]);
}
