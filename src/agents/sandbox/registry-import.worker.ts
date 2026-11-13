import { requestSqliteWorkerOperationAdmission } from "../../infra/sqlite-worker-operation-admission.js";
import {
  runOmnipolymathStateWriteTransaction,
  type OmnipolymathStateDatabaseOptions,
} from "../../state/omnipolymath-state-db.js";
import { withSandboxRegistryWorkerReceipt } from "./registry-publication.js";
import {
  insertSandboxRegistryRowIfMissingInDatabase,
  type SandboxRegistryInsert,
} from "./registry.kernel.js";

export function importSandboxRegistryRow(
  row: SandboxRegistryInsert,
  options: OmnipolymathStateDatabaseOptions,
): void {
  runOmnipolymathStateWriteTransaction(
    ({ db }) =>
      withSandboxRegistryWorkerReceipt(db, () => {
        requestSqliteWorkerOperationAdmission({ stage: "transaction", facts: undefined });
        insertSandboxRegistryRowIfMissingInDatabase(db, row);
        requestSqliteWorkerOperationAdmission({ stage: "commit", facts: undefined });
      }),
    options,
  );
}
