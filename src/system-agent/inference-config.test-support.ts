import { onTestFinished } from "vitest";
import { createConfigIO } from "../config/config.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { createOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";

/** Real source and runtime snapshots without replacing the host's state directory. */
export async function createInferenceConfigFixture(config: OmnipolymathConfig) {
  const state = await createOmnipolymathTestState({ label: "inference-config", applyEnv: false });
  onTestFinished(() => state.cleanup());
  const io = createConfigIO({
    configPath: state.configPath,
    env: state.env,
    homedir: () => state.home,
    observe: false,
    pluginValidation: "core-only",
  });
  await state.writeConfig(config);
  const snapshot = await io.readConfigFileSnapshot();
  if (!snapshot.exists || !snapshot.valid) {
    throw new Error(`Invalid inference fixture config: ${JSON.stringify(snapshot.issues)}`);
  }
  return {
    snapshot,
    read: io.readConfigFileSnapshot,
    write: state.writeConfig,
    preview: (candidate: OmnipolymathConfig) =>
      io.readConfigFileSnapshotFromRaw(JSON.stringify(candidate)),
  };
}
