import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";

export function createWorkspaceCompactionConfig(): OmnipolymathConfig {
  return {
    agents: {
      defaults: {
        compaction: {
          mode: "safeguard",
          postCompactionSections: ["Compaction fixture"],
          recentTurnsPreserve: 0,
          qualityGuard: { enabled: false },
        },
      },
    },
  };
}
