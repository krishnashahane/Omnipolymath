import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveOmnipolymathConfigPath as resolveConfig,
  resolveOmnipolymathStateDir as resolveState,
} from "../../scripts/e2e/lib/omnipolymath-state-paths.mjs";
import { withEnv } from "../../src/test-utils/env.js";

const home = path.join(path.sep, "tmp", "omnipolymath-home");
const state = path.join(path.sep, "tmp", "omnipolymath-state");
const rawState = `${state}/../raw `;
const rawConfig = " ./raw config.json ";

describe("Omnipolymath E2E state paths", () => {
  it.each([
    ["returns raw state path bytes", resolveState, [home, undefined, rawState], rawState],
    ["preserves whitespace state overrides", resolveState, [home, undefined, " \t "], " \t "],
    [
      "falls back from an empty state override",
      resolveState,
      [home, undefined, ""],
      path.join(home, ".omnipolymath"),
    ],
    [
      "returns a config override without resolving HOME",
      resolveConfig,
      [undefined, rawConfig, undefined],
      rawConfig,
    ],
    [
      "falls back from an empty config override via state",
      resolveConfig,
      [undefined, "", state],
      path.join(state, "omnipolymath.json"),
    ],
  ])("%s", (_name, resolve, [HOME, OMNIPOLYMATH_CONFIG_PATH, OMNIPOLYMATH_STATE_DIR], expected) => {
    withEnv({ HOME, OMNIPOLYMATH_CONFIG_PATH, OMNIPOLYMATH_STATE_DIR }, () =>
      expect(resolve()).toBe(expected),
    );
  });

  it.each([
    ["state", resolveState],
    ["config", resolveConfig],
  ])("rejects missing HOME for the default %s path", (_name, resolve) => {
    withEnv(
      { HOME: undefined, OMNIPOLYMATH_CONFIG_PATH: undefined, OMNIPOLYMATH_STATE_DIR: undefined },
      () => expect(resolve).toThrow(TypeError),
    );
  });
});
