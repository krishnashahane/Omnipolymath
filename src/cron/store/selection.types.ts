import type { CronStorePartitionInventory } from "../../state/omnipolymath-state-db-cron-identity-migration.js";

export type CronStoreSelection =
  | { status: "ready"; storeKey: string; storePath: string }
  | {
      status: "unresolved";
      storePath: string;
      partitions: CronStorePartitionInventory[];
      message: string;
    };
