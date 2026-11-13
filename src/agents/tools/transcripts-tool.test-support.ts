import path from "node:path";
import { afterEach, vi } from "vitest";
import { createTempDirTracker } from "../../../test/helpers/temp-dir.js";
import { createEmptyPluginRegistry } from "../../plugins/registry-empty.js";
import { setActivePluginRegistry } from "../../plugins/runtime.js";
import {
  closeOmnipolymathStateDatabaseAsync,
  closeOmnipolymathStateDatabaseForTest,
} from "../../state/omnipolymath-state-db.js";
import { clearTranscriptCapturesForTest } from "../../transcripts/capture.test-support.js";
import type { TranscriptSourceProvider } from "../../transcripts/provider-types.js";
import { TranscriptsStore } from "../../transcripts/store.js";

export function useTranscriptTestState() {
  const dirs = createTempDirTracker();
  afterEach(async () => {
    await clearTranscriptCapturesForTest();
    setActivePluginRegistry(createEmptyPluginRegistry());
    vi.restoreAllMocks();
    vi.useRealTimers();
    await closeOmnipolymathStateDatabaseAsync();
    closeOmnipolymathStateDatabaseForTest();
    vi.unstubAllEnvs();
    dirs.cleanup();
  });
  return () => {
    const stateDir = dirs.make("omnipolymath-transcripts-");
    vi.stubEnv("OMNIPOLYMATH_STATE_DIR", stateDir);
    return {
      stateDir,
      store: new TranscriptsStore(path.join(stateDir, "transcripts"), {
        env: { ...process.env, OMNIPOLYMATH_STATE_DIR: stateDir },
      }),
    };
  };
}

export function registerTranscriptTestProvider(
  provider: TranscriptSourceProvider,
  pluginId = provider.id,
) {
  const registry = createEmptyPluginRegistry();
  registry.transcriptSourceProviders.push({ pluginId, provider, source: import.meta.url });
  setActivePluginRegistry(registry);
}
