import { parentPort, workerData } from "node:worker_threads";
import {
  installDatabaseEngineSelection,
  type DatabaseEngineSelection,
} from "../infra/database-engine/context.js";
import {
  installSqliteDatabaseAdmissions,
  type SqliteDatabaseAdmissions,
} from "../infra/sqlite-database-admission.js";
import { inspectPostgresMediaPersistence } from "../infra/state-migrations.media-persistence-inspection.js";
import { closeOmnipolymathAgentDatabasesAsync } from "./omnipolymath-agent-db.js";
import { closeOmnipolymathStateDatabaseAsync } from "./omnipolymath-state-db.js";

const input: {
  admissions: SqliteDatabaseAdmissions;
  env: NodeJS.ProcessEnv;
  selection: DatabaseEngineSelection;
  target: { agentId: string; path: string };
} = workerData;

if (parentPort) {
  let reply:
    | { result: Awaited<ReturnType<typeof inspectPostgresMediaPersistence>> }
    | { error: string };
  try {
    installDatabaseEngineSelection(input.selection);
    installSqliteDatabaseAdmissions(input.admissions);
    reply = {
      result: await inspectPostgresMediaPersistence({
        env: input.env,
        agentId: input.target.agentId,
        pathname: input.target.path,
        maintenance: { signal: new AbortController().signal },
      }),
    };
  } catch (error) {
    reply = { error: error instanceof Error ? (error.stack ?? error.message) : String(error) };
  } finally {
    await closeOmnipolymathAgentDatabasesAsync();
    await closeOmnipolymathStateDatabaseAsync();
  }
  parentPort.postMessage(reply, []);
  parentPort.close();
}
