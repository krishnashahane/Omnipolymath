import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { RuntimeEnv } from "../../runtime.js";

/**
 * Channel pairing hooks used by setup and allowlist approval flows.
 */
export type ChannelPairingAdapter = {
  idLabel: string;
  normalizeAllowEntry?: (entry: string) => string;
  /** Derive the persisted approval entry from the locally issued request. */
  resolveApprovalStoreEntry?: (request: {
    id: string;
    meta?: Record<string, string>;
  }) => string | null | undefined;
  notifyApproval?: (params: {
    cfg: OmnipolymathConfig;
    id: string;
    accountId?: string;
    meta?: Record<string, string>;
    runtime?: RuntimeEnv;
  }) => Promise<void>;
};
