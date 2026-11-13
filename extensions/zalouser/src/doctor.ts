import type { ChannelDoctorAdapter } from "omnipolymath/plugin-sdk/channel-contract";
import { createDangerousNameMatchingMutableAllowlistWarningCollector } from "omnipolymath/plugin-sdk/channel-policy";
import { asObjectRecord } from "omnipolymath/plugin-sdk/runtime-doctor-migrations";
import { legacyConfigRules, normalizeCompatibilityConfig } from "./doctor-contract.js";
import { isZalouserMutableGroupEntry } from "./security-audit.js";

const collectZalouserMutableAllowlistWarnings =
  createDangerousNameMatchingMutableAllowlistWarningCollector({
    channel: "zalouser",
    detector: isZalouserMutableGroupEntry,
    collectLists: (scope) => {
      const groups = asObjectRecord(scope.account.groups);
      return groups
        ? [
            {
              pathLabel: `${scope.prefix}.groups`,
              list: Object.keys(groups),
            },
          ]
        : [];
    },
  });

export const zalouserDoctor: ChannelDoctorAdapter = {
  dmAllowFromMode: "topOnly",
  groupModel: "hybrid",
  groupAllowFromFallbackToAllowFrom: false,
  warnOnEmptyGroupSenderAllowlist: false,
  legacyConfigRules,
  normalizeCompatibilityConfig,
  collectMutableAllowlistWarnings: collectZalouserMutableAllowlistWarnings,
};
