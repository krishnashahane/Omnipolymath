import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";

export class OmnipolymathAgentDatabaseMediaMigrationRequiredError extends StartupMaintenanceRequiredError {
  constructor(
    readonly pathname: string,
    readonly schemaVersion: number,
  ) {
    super(
      "agent-media",
      `Omnipolymath agent database ${pathname} uses schema version ${schemaVersion}; run omnipolymath doctor --fix to migrate persisted media before using it.`,
    );
    this.name = "OmnipolymathAgentDatabaseMediaMigrationRequiredError";
  }
}
