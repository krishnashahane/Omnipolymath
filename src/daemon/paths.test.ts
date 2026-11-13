import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGatewayTaskScriptPath } from "./paths.js";

describe("resolveGatewayTaskScriptPath", () => {
  it.each([
    {
      name: "uses default path when OMNIPOLYMATH_PROFILE is unset",
      env: { USERPROFILE: "C:\\Users\\test" },
      expected: path.join("C:\\Users\\test", ".omnipolymath", "gateway.cmd"),
    },
    {
      name: "uses profile-specific path when OMNIPOLYMATH_PROFILE is set to a custom value",
      env: { USERPROFILE: "C:\\Users\\test", OMNIPOLYMATH_PROFILE: "jbphoenix" },
      expected: path.join("C:\\Users\\test", ".omnipolymath-jbphoenix", "gateway.cmd"),
    },
    {
      name: "prefers OMNIPOLYMATH_STATE_DIR over profile-derived defaults",
      env: {
        USERPROFILE: "C:\\Users\\test",
        OMNIPOLYMATH_PROFILE: "rescue",
        OMNIPOLYMATH_STATE_DIR: "C:\\State\\omnipolymath",
      },
      expected: path.join("C:\\State\\omnipolymath", "gateway.cmd"),
    },
    {
      name: "falls back to HOME when USERPROFILE is not set",
      env: { HOME: "/home/test", OMNIPOLYMATH_PROFILE: "default" },
      expected: path.join("/home/test", ".omnipolymath", "gateway.cmd"),
    },
    {
      name: "uses a custom task script file name inside the state directory",
      env: {
        USERPROFILE: "C:\\Users\\test",
        OMNIPOLYMATH_TASK_SCRIPT_NAME: "gateway-node.cmd",
      },
      expected: path.join("C:\\Users\\test", ".omnipolymath", "gateway-node.cmd"),
    },
  ])("$name", ({ env, expected }) => {
    expect(resolveGatewayTaskScriptPath(env)).toBe(expected);
  });

  it.each(["nested/gateway.cmd", "nested\\gateway.cmd", "gateway..cmd"])(
    "rejects non-file task script name %s",
    (scriptName) => {
      expect(() =>
        resolveGatewayTaskScriptPath({
          USERPROFILE: "C:\\Users\\test",
          OMNIPOLYMATH_TASK_SCRIPT_NAME: scriptName,
        }),
      ).toThrow("OMNIPOLYMATH_TASK_SCRIPT_NAME must be a file name only");
    },
  );
});
