import { assertOmnipolymathStateDatabaseOwner } from "../state/omnipolymath-state-db-maintenance.js";
import {
  withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly,
  withExistingOmnipolymathStateDatabaseReadOnly,
} from "../state/omnipolymath-state-db-readonly.js";
import type { WorkerOperationContext } from "../state/worker-operation-registry.js";
import { readTemplateInstallSchemaVersionRows } from "./provenance-runtime-read.kernel.js";

export const templateInstallSchemaOperations = {
  "templates.install-schema-versions": (
    input: { artifactPreservingReadOnly: boolean },
    context: WorkerOperationContext,
  ) => {
    const read = input.artifactPreservingReadOnly
      ? withExistingOmnipolymathStateDatabaseArtifactPreservingReadOnly
      : withExistingOmnipolymathStateDatabaseReadOnly;
    return read(({ db, path: pathname }) => {
      assertOmnipolymathStateDatabaseOwner(db, { pathname });
      return readTemplateInstallSchemaVersionRows(db);
    }, context.stateOptions());
  },
};
