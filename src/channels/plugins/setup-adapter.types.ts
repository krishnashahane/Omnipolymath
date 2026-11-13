import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import type { ChannelAccountKeyPolicy } from "../../routing/account-lookup.js";
import type { RuntimeEnv } from "../../runtime.js";
import type { ChannelSetupInput } from "./setup-input.js";

export type ChannelSetupAdapter<Input extends { name?: string } = ChannelSetupInput> = {
  /** Prepared plugin-owned policy for setup outside a published Gateway metadata generation. */
  accountKeyPolicy?: ChannelAccountKeyPolicy;
  /** Keep root config as an independent identity when the host adds named accounts. */
  configPromotion?: "preserve-root";
  resolveAccountId?: (params: { cfg: OmnipolymathConfig; accountId?: string; input?: Input }) => string;
  prepareAccountConfigInput?: (params: {
    cfg: OmnipolymathConfig;
    accountId: string;
    input: Input;
    runtime: RuntimeEnv;
  }) => Promise<Input> | Input;
  resolveBindingAccountId?: (params: {
    cfg: OmnipolymathConfig;
    agentId: string;
    accountId?: string;
  }) => string | undefined;
  applyAccountName?: (params: {
    cfg: OmnipolymathConfig;
    accountId: string;
    name?: string;
  }) => OmnipolymathConfig;
  applyAccountConfig: (params: {
    cfg: OmnipolymathConfig;
    accountId: string;
    input: Input;
  }) => OmnipolymathConfig;
  afterAccountConfigWritten?: (params: {
    previousCfg: OmnipolymathConfig;
    cfg: OmnipolymathConfig;
    accountId: string;
    input: Input;
    runtime: RuntimeEnv;
  }) => Promise<void> | void;
  validateInput?: (params: {
    cfg: OmnipolymathConfig;
    accountId: string;
    input: Input;
  }) => string | null;
  singleAccountKeysToMove?: readonly string[];
  namedAccountPromotionKeys?: readonly string[];
  resolveSingleAccountPromotionTarget?: (params: {
    channel: Record<string, unknown>;
  }) => string | undefined;
};
