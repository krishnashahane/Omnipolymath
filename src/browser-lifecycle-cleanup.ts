import { normalizeUniqueStringEntries } from "@omnipolymath/normalization-core/string-normalization";
import type { SessionEntryCurrentPreparation } from "./config/sessions/session-entry-current.types.js";
import type { OmnipolymathConfig } from "./config/types.omnipolymath.js";
import { runBestEffortCleanup } from "./infra/non-fatal-cleanup.js";
import { closeTrackedBrowserTabsForSessions } from "./plugin-sdk/browser-maintenance.js";
import { parseAgentSessionKey } from "./routing/session-key.js";

function isBrowserCleanupDisabled(cfg: OmnipolymathConfig | undefined): boolean {
  return cfg?.browser?.enabled === false || cfg?.plugins?.entries?.browser?.enabled === false;
}

export async function cleanupBrowserSessionsForLifecycleEnd(
  params: SessionEntryCurrentPreparation & {
    cfg?: OmnipolymathConfig;
    sessionKeys: string[];
    isCurrent?: () => boolean;
    onWarn?: (message: string) => void;
    onError?: (error: unknown) => void;
  },
): Promise<void> {
  const { cfg, onError, ...cleanupParams } = params;
  if (isBrowserCleanupDisabled(cfg)) {
    return;
  }
  const sessionKeys = normalizeUniqueStringEntries(
    params.sessionKeys.flatMap((key) => {
      const parsed = parseAgentSessionKey(key);
      return parsed ? [`agent:${parsed.agentId}:${parsed.rest}`] : [];
    }),
  );
  if (sessionKeys.length === 0) {
    return;
  }
  await runBestEffortCleanup({
    cleanup: async () => {
      await closeTrackedBrowserTabsForSessions({
        ...cleanupParams,
        sessionKeys,
      });
    },
    onError,
  });
}
