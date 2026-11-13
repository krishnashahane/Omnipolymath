// Tests Omnipolymath execution environment construction.
import { describe, expect, it } from "vitest";
import { deleteTestEnvValue, setTestEnvValue } from "../test-utils/env.js";
import {
  ensureOmnipolymathExecMarkerOnProcess,
  markOmnipolymathExecEnv,
  OMNIPOLYMATH_CLI_ENV_VAR,
} from "./omnipolymath-exec-env.js";

const OMNIPOLYMATH_CLI_ENV_VALUE = "1";

describe("markOmnipolymathExecEnv", () => {
  it("returns a cloned env object with the exec marker set", () => {
    const env = { PATH: "/usr/bin", OMNIPOLYMATH_CLI: "0" };
    const marked = markOmnipolymathExecEnv(env);

    expect(marked).toEqual({
      PATH: "/usr/bin",
      OMNIPOLYMATH_CLI: OMNIPOLYMATH_CLI_ENV_VALUE,
    });
    expect(marked).not.toBe(env);
    expect(env.OMNIPOLYMATH_CLI).toBe("0");
  });
});

describe("ensureOmnipolymathExecMarkerOnProcess", () => {
  it("overwrites an existing marker on the provided process env", () => {
    const env = { PATH: "/usr/bin", [OMNIPOLYMATH_CLI_ENV_VAR]: "0" };
    expect(ensureOmnipolymathExecMarkerOnProcess(env)).toBe(env);
    expect(env[OMNIPOLYMATH_CLI_ENV_VAR]).toBe(OMNIPOLYMATH_CLI_ENV_VALUE);
  });

  it("defaults to mutating process.env when no env object is provided", () => {
    const previous = process.env[OMNIPOLYMATH_CLI_ENV_VAR];
    deleteTestEnvValue(OMNIPOLYMATH_CLI_ENV_VAR);

    try {
      expect(ensureOmnipolymathExecMarkerOnProcess()).toBe(process.env);
      expect(process.env[OMNIPOLYMATH_CLI_ENV_VAR]).toBe(OMNIPOLYMATH_CLI_ENV_VALUE);
    } finally {
      if (previous === undefined) {
        deleteTestEnvValue(OMNIPOLYMATH_CLI_ENV_VAR);
      } else {
        setTestEnvValue(OMNIPOLYMATH_CLI_ENV_VAR, previous);
      }
    }
  });
});
