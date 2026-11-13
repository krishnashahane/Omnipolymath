import { expect, it } from "vitest";
import {
  agentHarnessBuildsOmnipolymathTools,
  agentHarnessExposesOmnipolymathTools,
} from "./tool-surface.js";

it.each([
  { harness: "omnipolymath", builds: false, exposes: true },
  { harness: "codex", builds: true, exposes: true },
  { harness: "copilot", builds: true, exposes: true },
  { harness: "custom", builds: false, exposes: false },
])("identifies the $harness tool surface", ({ harness, builds, exposes }) => {
  expect(agentHarnessBuildsOmnipolymathTools(harness)).toBe(builds);
  expect(agentHarnessExposesOmnipolymathTools(harness)).toBe(exposes);
});
