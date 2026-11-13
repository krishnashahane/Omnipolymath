import type {
  OmnipolymathStateDatabaseOptions,
  OmnipolymathStateSchemaReadAdmission,
} from "../state/omnipolymath-state-db-contract.js";
import { isStatePostgres } from "../state/omnipolymath-state-db-engine.js";
import {
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly,
  withExistingOmnipolymathStateDatabaseCurrentReadOnly,
} from "../state/omnipolymath-state-db-readonly.js";
import type { OmnipolymathStateReadOnlyDatabase } from "../state/omnipolymath-state-read.types.js";
import { withEngineStoreAdmission } from "./database-engine/admission-scope.js";

/** PostgreSQL reads admitted rows; SQLite retains private snapshots and legacy catalog admission. */
export function withUpdateRunRead<T>(
  operation: (database: OmnipolymathStateReadOnlyDatabase) => T,
  options: OmnipolymathStateDatabaseOptions & { allowNativeRead?: true },
  schemaAdmission?: OmnipolymathStateSchemaReadAdmission,
): T | undefined {
  if (isStatePostgres()) {
    return withEngineStoreAdmission(() =>
      withExistingOmnipolymathStateDatabaseCurrentReadOnly(operation, options),
    );
  }
  const read = options.allowNativeRead
    ? withExistingOmnipolymathStateDatabaseCurrentReadOnly
    : withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly;
  return read(operation, options, schemaAdmission);
}
