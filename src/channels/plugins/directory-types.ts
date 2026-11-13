import type { OmnipolymathConfig } from "../../config/types.js";

export type DirectoryConfigParams = {
  cfg: OmnipolymathConfig;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
};
