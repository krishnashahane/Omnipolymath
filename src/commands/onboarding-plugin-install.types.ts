import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { PluginCapabilityConsentHandler } from "../plugins/capability-consent.js";
import type { PluginPackageInstall } from "../plugins/manifest.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

export type OnboardingPluginInstallEntry = {
  pluginId: string;
  label: string;
  install: PluginPackageInstall;
  trustedSourceLinkedOfficialInstall?: boolean;
  /** Keep this official runtime package on the same release cohort as Omnipolymath. */
  versionBoundToOmnipolymath?: boolean;
};

export type OnboardingPluginInstallOptions = {
  cfg: OmnipolymathConfig;
  entry: OnboardingPluginInstallEntry;
  prompter: WizardPrompter;
  runtime: RuntimeEnv;
  workspaceDir?: string;
  promptInstall?: boolean;
  autoConfirmSingleSource?: boolean;
  beforePersistentEffect?: () => void | Promise<void>;
  beforePersistentApply?: () => void;
  onCapabilityConsent?: PluginCapabilityConsentHandler;
  recordOfficialCapabilities?: boolean;
};

export type OnboardingPluginInstallResult = {
  cfg: OmnipolymathConfig;
  installed: boolean;
  pluginId: string;
  status: "installed" | "skipped" | "failed" | "timed_out";
  /** Sanitized actionable detail for non-interactive callers. */
  error?: string;
};
