import { assertCronStateReadSchemaReadOnly } from "../../../cron/store/read-only.js";
import { isSqliteSchemaVersionError } from "../../../infra/sqlite-user-version.js";
import { isStatePostgres } from "../../../state/omnipolymath-state-db-engine.js";
import { withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync } from "../../../state/omnipolymath-state-db-readonly.js";

export async function assertCronStateSchemaSupportedAsync(env?: NodeJS.ProcessEnv): Promise<void> {
  if (isStatePostgres()) {
    await assertCronStateReadSchemaReadOnly(env);
    return;
  }
  await withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnlyAsync(() => undefined, { env });
}

export function rethrowSqliteSchemaVersionError(error: unknown): void {
  if (isSqliteSchemaVersionError(error)) {
    throw error;
  }
}
