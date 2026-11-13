import type { SqliteWorkerStateContext } from "../infra/sqlite-worker-state-context.js";
import type {
  OmnipolymathDatabaseMaintenanceScope,
  OmnipolymathStateDatabaseReadAdmission,
} from "./omnipolymath-state-db-async-lifecycle.js";

export type OmnipolymathStateWorkerContext = Omit<SqliteWorkerStateContext, "environment"> & {
  environment: {
    OMNIPOLYMATH_STATE_DIR: string;
    OMNIPOLYMATH_SUPERVISOR_MODE?: "external";
  };
  admission: OmnipolymathStateDatabaseReadAdmission;
  /** Committed facts outlive a caller's schema borrow, but never the captured database generation. */
  assertPublicationCurrent?: () => void;
  /** Host-only captured scope; reentry never extends the original admission lifetime. */
  runInCapturedSchemaScope?: <T>(operation: () => T) => T;
  /** Host-only ownership; workers request live schema grants through their job admission. */
  maintenanceScope?: OmnipolymathDatabaseMaintenanceScope;
};
