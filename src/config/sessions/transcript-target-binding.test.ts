import path from "node:path";
import { expect, it } from "vitest";
import { captureSessionTranscriptStorageEnvironment } from "./transcript-target-binding.js";

it.each([
  ["linux", "OMNIPOLYMATH_STATE_DIR"],
  ["win32", "OMNIPOLYMATH_STATE_DIR"],
  ["win32", "omnipolymath_state_dir"],
] as const)("captures storage facts without reading unrelated values (%s, %s)", (platform, key) => {
  const stateDir = path.resolve("synthetic-state");
  const source: NodeJS.ProcessEnv = {
    omnipolymath_state_dir: path.resolve("decoy-state"),
    [key]: stateDir,
    Omnipolymath_Supervisor_Mode: "external",
  };
  Object.defineProperty(source, "UNRELATED_VALUE", {
    enumerable: true,
    get() {
      throw new Error("Storage capture must not read unrelated environment values");
    },
  });
  const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform });
  try {
    expect(structuredClone(captureSessionTranscriptStorageEnvironment(source))).toEqual({
      OMNIPOLYMATH_STATE_DIR: stateDir,
      ...(platform === "win32" ? { OMNIPOLYMATH_SUPERVISOR_MODE: "external" } : {}),
    });
  } finally {
    Object.defineProperty(process, "platform", descriptor);
  }
});
