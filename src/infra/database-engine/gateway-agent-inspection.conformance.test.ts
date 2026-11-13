import { describe, expect, it, vi } from "vitest";
import { prepareGatewayStartupSessions } from "../../gateway/server-startup-session-migration.js";
import {
  AgentDatabaseAdmissionError,
  readAgentDatabaseAdmissionRefusal,
  recordAgentDatabaseAdmissions,
} from "../../state/agent-database-admission.js";
import { withAgentDatabaseStartupAdmission } from "../../state/agent-database-startup.js";
import { OMNIPOLYMATH_AGENT_SCHEMA_VERSION as version } from "../../state/omnipolymath-agent-db-contract.js";
import {
  closeOmnipolymathAgentDatabaseByPath,
  closeOmnipolymathAgentDatabaseByPathAsync,
  openOmnipolymathAgentDatabase,
} from "../../state/omnipolymath-agent-db.js";
import { prepareOmnipolymathAgentDatabaseExecution } from "../../state/omnipolymath-agent-execution.js";
import { createAgentSchemaInspectionWorker } from "../../state/omnipolymath-agent-schema-inspection-worker.js";
import { withEngineStoreAdmission } from "./admission-scope.js";
import { mixedAgentConnection, useMixedAgentPair } from "./mixed-agent.conformance.test-support.js";

describe.skipIf(!mixedAgentConnection).each(["sqlite", "postgres"] as const)(
  "%s deferred Gateway agent inspection",
  (engine) => {
    useMixedAgentPair(engine, engine);

    it("inspects a pending agent before preparing and publishing its runtime admission", async () => {
      const env = { ...process.env };
      const options = { agentId: "qa", env };
      const open = () => withEngineStoreAdmission(() => openOmnipolymathAgentDatabase(options));
      const { path: pathname } = open();
      withEngineStoreAdmission(() => closeOmnipolymathAgentDatabaseByPath(pathname));
      await closeOmnipolymathAgentDatabaseByPathAsync(pathname);
      await using inspector = createAgentSchemaInspectionWorker();
      await withAgentDatabaseStartupAdmission(async (admission) => {
        const owner = admission.adopt();
        const inspection = inspector.inspect({
          ...options,
          pathname,
          supportedVersion: version,
          verifyCurrentSchemaShape: true,
          inspectOwnership: true,
          requireStartupMigrationReadiness: true,
        });
        const refusals = admission.defer({
          env,
          inspections: [
            {
              target: { agentId: "qa", path: pathname },
              result: inspection.then(() => ({ incompatible: [], indeterminate: [] })),
            },
          ],
          reason: "Inspection is still in flight",
        });
        recordAgentDatabaseAdmissions(refusals, { env, source: "startup" });
        try {
          expect(await inspection).toMatchObject({
            version,
            agentSchemaMeta: { agentId: "qa", role: "agent" },
          });
          expect(readAgentDatabaseAdmissionRefusal("qa", { env })).toBe(refusals[0]);
          expect(open).toThrow(AgentDatabaseAdmissionError);
          const log = { info: vi.fn(), warn: vi.fn() };
          admission.activate({
            isCurrent: () => true,
            preparationReady: Promise.resolve(),
            openAgent: ({ assertCurrent, signal }) =>
              prepareOmnipolymathAgentDatabaseExecution(options, assertCurrent, signal),
            migrateAgent: async ({ assertCurrent }) => {
              await prepareGatewayStartupSessions({
                cfg: { agents: { entries: { qa: {} } } },
                env,
                agentIds: new Set(["qa"]),
                assertCurrent,
                log,
              });
            },
            publishAgent: async ({ assertCurrent }) => assertCurrent(),
          });
          await admission.pendingPreparation;
          expect(readAgentDatabaseAdmissionRefusal("qa", { env })).toBeUndefined();
          expect(open).not.toThrow();
        } finally {
          await owner.stop();
          recordAgentDatabaseAdmissions([], { env, source: "startup" });
        }
      });
    });
  },
);
