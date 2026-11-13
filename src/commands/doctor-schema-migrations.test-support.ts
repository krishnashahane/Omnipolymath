import { createOmnipolymathDatabaseMaintenanceScope } from "../state/omnipolymath-state-db-async-lifecycle.js";

export async function withMaintenance<T>(run: () => Promise<T>) {
  const maintenance = createOmnipolymathDatabaseMaintenanceScope({
    schemaMaintenance: true,
    assertOwnerCurrent: () => {},
  });
  try {
    return await maintenance.run(run);
  } finally {
    await maintenance.close();
  }
}
