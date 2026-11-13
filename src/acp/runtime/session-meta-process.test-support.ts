import type { SessionAcpMeta } from "../../config/sessions/types.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import { closeOmnipolymathAgentDatabasesAsync } from "../../state/omnipolymath-agent-db.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  runOmnipolymathStateWriteTransaction,
} from "../../state/omnipolymath-state-db.js";
import { upsertAcpSessionMeta } from "./session-meta-write.js";
import { writeAcpSessionMetaForMigration } from "./session-meta.js";

/** Independent canonical writers use the invocation's compiled storage runtime. */
export async function writeAcpMetadataFromProcess(params: {
  mutation:
    | {
        kind: "upsert";
        scope: { cfg: OmnipolymathConfig; agentId: string; sessionKey: string };
        clear: boolean;
      }
    | {
        kind: "migration";
        rows: Array<{ sessionKey: string; lifecycleRevision: string; meta: SessionAcpMeta }>;
      };
}): Promise<void> {
  const phase = (name: string) => {
    process.stderr.write(`acp-proof:${name}:${performance.now().toFixed(0)}\n`);
  };
  phase("imports-ready");
  try {
    phase("write-start");
    const mutation = params.mutation;
    if (mutation.kind === "upsert") {
      await upsertAcpSessionMeta({
        ...mutation.scope,
        skipMaintenance: true,
        mutate: (current) => {
          if (!current) {
            throw new Error("Expected current metadata before independent write.");
          }
          return mutation.clear ? null : { ...current, lastActivityAt: 200 };
        },
      });
    } else {
      runOmnipolymathStateWriteTransaction((database) => {
        for (const row of mutation.rows) {
          writeAcpSessionMetaForMigration({ ...row, database });
        }
      });
    }
    phase("write-settled");
  } finally {
    try {
      phase("agent-close-start");
      await closeOmnipolymathAgentDatabasesAsync();
      phase("agent-close-end");
    } finally {
      phase("state-close-start");
      await closeOmnipolymathStateDatabaseAsync();
      phase("state-close-end");
    }
  }
}
