import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import type {
  resolveMemoryLightDreamingConfig,
  resolveMemoryRemDreamingConfig,
} from "omnipolymath/plugin-sdk/memory-core-host-status";
import type { OmnipolymathPluginApi } from "omnipolymath/plugin-sdk/plugin-entry";
import type { NarrativePhaseData } from "./dreaming-narrative.js";
import type { SessionAdmissionPolicy } from "./session-ingestion.js";
import type { WorkspaceFileMode } from "./workspace-file-mode.js";

export type LightDreamingConfig = ReturnType<typeof resolveMemoryLightDreamingConfig>;
export type RemDreamingConfig = ReturnType<typeof resolveMemoryRemDreamingConfig>;
export type DreamingSweepParams = {
  agentId?: string;
  workspaceDir: string;
  workspaceFileMode?: WorkspaceFileMode;
  pluginConfig?: Record<string, unknown>;
  cfg?: OmnipolymathConfig;
  logger: Pick<OmnipolymathPluginApi["logger"], "info" | "warn" | "error">;
  nowMs?: number;
};
export type DreamingPhaseRunParams<TConfig extends LightDreamingConfig | RemDreamingConfig> =
  DreamingSweepParams & {
    config: TConfig;
    nowMs: number;
    admissionPolicy?: SessionAdmissionPolicy;
  };
export type DreamingPhasePreparation = {
  bodyLines: string[];
  keys: string[];
  consideredKeys?: string[];
  logMessage: string;
  data?: NarrativePhaseData;
};
