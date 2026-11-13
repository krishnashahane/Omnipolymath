export type OmnipolymathExecMode = "deny" | "allowlist" | "ask" | "auto" | "full";
export type OmnipolymathExecSecurity = "deny" | "allowlist" | "full";
export type OmnipolymathExecAsk = "off" | "on-miss" | "always";
export type OmnipolymathExecApprovalFloorsForCodexAppServer = {
  security?: OmnipolymathExecSecurity;
  ask?: OmnipolymathExecAsk;
};
export type OmnipolymathExecPolicyForCodexAppServer = {
  mode: OmnipolymathExecMode;
  security: OmnipolymathExecSecurity;
  ask: OmnipolymathExecAsk;
  touched: boolean;
};

export type CodexAppServerCommandSource = "managed" | "resolved-managed" | "config" | "env";
export type CodexPluginDestructivePolicy = boolean | "auto" | "ask";
export type CodexPluginDestructiveApprovalMode = "allow" | "deny" | "auto" | "ask";

export const CODEX_PLUGIN_MARKETPLACE_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export type CodexPluginMarketplaceName = string;

export type ResolvedCodexPluginPolicy = {
  configKey: string;
  marketplaceName: CodexPluginMarketplaceName;
  pluginName: string;
  enabled: boolean;
  readOnly?: boolean;
  allowDestructiveActions: boolean;
  destructiveApprovalMode: CodexPluginDestructiveApprovalMode;
};

export type ResolvedCodexPluginsPolicy = {
  configured: boolean;
  enabled: boolean;
  allowAllPlugins: boolean;
  allowDestructiveActions: boolean;
  destructiveApprovalMode: CodexPluginDestructiveApprovalMode;
  pluginPolicies: ResolvedCodexPluginPolicy[];
};
