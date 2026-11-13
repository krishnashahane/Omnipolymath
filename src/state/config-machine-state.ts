// Machine-owned values retired from omnipolymath.json live in the shared state database.
import type { EngineConnection } from "../infra/sql-connection.js";
import { readConfigMachineStateRowInDatabase } from "./config-machine-state-row.js";
import { isStateSchemaVersionAtLeast } from "./omnipolymath-state-db-admission.js";
import type { OmnipolymathStateDatabaseOptions } from "./omnipolymath-state-db-contract.js";
import {
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly,
  withExistingOmnipolymathStateDatabaseReadOnly,
} from "./omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateReadCommand } from "./omnipolymath-state-read.types.js";

export {
  getTtsMachinePathAdmission,
  readConfigMachineStateRowInDatabase,
  type ConfigMachineStateDatabase,
} from "./config-machine-state-row.js";

type ConfigMachineStateReadCommand = Extract<
  OmnipolymathStateReadCommand,
  {
    type:
      | "nodeHost.config"
      | "cron.store"
      | "hooks.internal.installs"
      | "operator.channelPolicy"
      | "tts.prefsPath"
      | "voicewake.triggers"
      | "voicewake.routing";
  }
>;

export function isConfigMachineStateReadCommand(
  command: OmnipolymathStateReadCommand,
): command is ConfigMachineStateReadCommand {
  return (
    command.type === "nodeHost.config" ||
    command.type === "cron.store" ||
    command.type === "hooks.internal.installs" ||
    command.type === "operator.channelPolicy" ||
    command.type === "tts.prefsPath" ||
    command.type === "voicewake.triggers" ||
    command.type === "voicewake.routing"
  );
}

export function readConfigMachineStateCommandInDatabase(
  database: EngineConnection,
  command: ConfigMachineStateReadCommand,
) {
  return {
    type: command.type,
    // Activation may precede deferred publication; never issue authority before v19.
    row:
      command.type === "operator.channelPolicy" && !isStateSchemaVersionAtLeast(database, 19)
        ? undefined
        : readConfigMachineStateRowInDatabase(database, command.type),
  };
}

// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Callers own the JSON shape for open-ended state keys.
export function readConfigMachineState<T>(
  key: string,
  options: OmnipolymathStateDatabaseOptions = {},
  behavior: { artifactPreservingReadOnly?: boolean } = {},
): T | undefined {
  const read = ({ db: database }: { db: EngineConnection }) => {
    const row = readConfigMachineStateRowInDatabase(database, key);
    // SAFETY: Each key's owner defines its persisted JSON shape.
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  };
  return behavior.artifactPreservingReadOnly
    ? withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly(read, options)
    : withExistingOmnipolymathStateDatabaseReadOnly(read, options);
}
