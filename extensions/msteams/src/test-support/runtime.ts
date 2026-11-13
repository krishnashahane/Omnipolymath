// Msteams plugin module implements runtime behavior.
import os from "node:os";
import path from "node:path";
import type {
  OpenKeyedStoreOptions,
  PluginStateActionAuthority,
} from "omnipolymath/plugin-sdk/plugin-state-runtime";
import {
  createPluginStateKeyedStoreForTests,
  createPluginStateKeyedStoreV2ForTests,
} from "omnipolymath/plugin-sdk/plugin-state-test-runtime";
import type { PluginRuntime } from "../../runtime-api.js";

export const msteamsRuntimeStub = {
  state: {
    openKeyedStore: (options: OpenKeyedStoreOptions) =>
      createPluginStateKeyedStoreForTests("msteams", options),
    openKeyedStoreV2: (options: OpenKeyedStoreOptions, authority?: PluginStateActionAuthority) =>
      createPluginStateKeyedStoreV2ForTests(
        "msteams",
        options,
        authority ?? { assertCurrent() {} },
      ),
    resolveStateDir: (env: NodeJS.ProcessEnv = process.env, homedir?: () => string) => {
      const override = env.OMNIPOLYMATH_STATE_DIR?.trim() || env.OMNIPOLYMATH_STATE_DIR?.trim();
      if (override) {
        return override;
      }
      const resolvedHome = homedir ? homedir() : os.homedir();
      return path.join(resolvedHome, ".omnipolymath");
    },
  },
} as unknown as PluginRuntime;
