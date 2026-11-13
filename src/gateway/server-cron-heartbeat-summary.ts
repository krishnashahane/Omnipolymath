import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { getCronJobsStoreRevision } from "../cron/store.js";
import type { CronJob } from "../cron/types.js";
import { readHeartbeatSummarySnapshot } from "../infra/heartbeat-summary-snapshot.js";

export function createGatewayCronHeartbeatSummary(params: {
  storePath: string;
  prepareStoreKey: () => Promise<string>;
  isStopped: () => boolean;
}) {
  // Store revisions also cover SDK writes that do not emit cron events.
  let summary: { cfg: OmnipolymathConfig; revision: number; jobs: CronJob[] } | undefined;
  return {
    async read(cfg: OmnipolymathConfig) {
      const storeKey = await params.prepareStoreKey();
      const revision = getCronJobsStoreRevision(storeKey);
      if (summary?.cfg === cfg && summary.revision === revision) {
        return summary.jobs;
      }
      const jobs = await readHeartbeatSummarySnapshot(cfg, params.storePath, storeKey);
      if (!params.isStopped() && revision === getCronJobsStoreRevision(storeKey)) {
        summary = { cfg, revision, jobs };
      }
      return jobs;
    },
    clear() {
      summary = undefined;
    },
  };
}
