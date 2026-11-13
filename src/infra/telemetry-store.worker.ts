import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { readConfigMachineStateRowInDatabase } from "../state/config-machine-state-row.js";
import {
  updateConfigMachineStateInDatabase,
  writeConfigMachineStateInDatabase,
} from "../state/config-machine-state-write.js";
import { readConfigMachineState } from "../state/config-machine-state.js";
import { withExistingOmnipolymathStateDatabaseReadOnly } from "../state/omnipolymath-state-db-readonly.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "../state/omnipolymath-state-db.generated.js";
import { runOmnipolymathStateWriteTransaction } from "../state/omnipolymath-state-db.js";
import type {
  WorkerOperationHandlers,
  WorkerOperations,
} from "../state/worker-operation-registry.js";
import { executeSqliteQueryTakeFirstSync, getNodeSqliteKysely } from "./kysely-sync.js";
import {
  installationCountStateKey,
  buildInstallationCountHeader,
} from "./telemetry-installation-count.js";
import type { SuccessfulTelemetryState, TelemetryState } from "./telemetry-worker-contract.js";

const TELEMETRY_STATE_KEY = "telemetry.updateCheck";

export const telemetryOperations = {
  "telemetry.claimInstallationCount": (
    input: { endpoint: string; day: number },
    { open, stateOptions },
  ): string | null =>
    runOmnipolymathStateWriteTransaction(
      ({ db }) => {
        const key = installationCountStateKey(input.endpoint);
        const row = readConfigMachineStateRowInDatabase(db, key);
        const header = buildInstallationCountHeader(
          input.day,
          row ? JSON.parse(row.value_json) : undefined,
        );
        if (header !== null) {
          // Claim before HTTP: failed or ambiguous delivery must never retry today's count.
          writeConfigMachineStateInDatabase(db, key, input.day);
        }
        return header;
      },
      { database: open(), ...stateOptions() },
      { operationLabel: "telemetry.claimInstallationCount" },
    ),
  "telemetry.readState": (_input: undefined, { stateOptions }): TelemetryState => {
    const state = readConfigMachineState<TelemetryState>(TELEMETRY_STATE_KEY, stateOptions());
    return state && isRecord(state) ? state : {};
  },
  "telemetry.countRecentSessions": (input: { sinceMs: number }, { stateOptions }) =>
    withExistingOmnipolymathStateDatabaseReadOnly(({ db: database }) => {
      const db =
        getNodeSqliteKysely<Pick<OmnipolymathStateKyselyDatabase, "session_state_events">>(database);
      const row = executeSqliteQueryTakeFirstSync(
        database,
        db
          .selectFrom("session_state_events")
          .select((builder) => builder.fn.countAll<number>().as("count"))
          .where("kind", "=", "created")
          .where("occurred_at", ">=", input.sinceMs),
      );
      return row?.count ?? 0;
    }, stateOptions()) ?? 0,
  "telemetry.persistSuccess": (
    input: { state: SuccessfulTelemetryState; updatedAtMs: number },
    { open, stateOptions },
  ) =>
    runOmnipolymathStateWriteTransaction(
      ({ db: database }) => {
        const { state, updatedAtMs } = input;
        return updateConfigMachineStateInDatabase<SuccessfulTelemetryState>(
          database,
          TELEMETRY_STATE_KEY,
          (current) =>
            current?.lastPingAt !== undefined && current.lastPingAt >= state.lastPingAt
              ? current
              : state,
          updatedAtMs,
        );
      },
      { database: open(), ...stateOptions() },
      { operationLabel: "config-machine-state.update" },
    ),
} satisfies WorkerOperationHandlers;

export type TelemetryWorkerOperations = WorkerOperations<typeof telemetryOperations>;
