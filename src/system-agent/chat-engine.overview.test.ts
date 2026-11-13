import "./chat-engine.mocks.test-support.js";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { readConfigFileSnapshot } from "../config/config.js";
import * as configModule from "../config/config.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { withEnvAsync } from "../test-utils/env.js";
import { SystemAgentChatEngine } from "./chat-engine.js";
import {
  createSystemAgentPluginMetadataTestSnapshot,
  createSystemAgentVerifiedInferenceTestFixture,
} from "./system-agent.test-helpers.js";

vi.mock("./probes.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./probes.js")>()),
  probeLocalCommand: async (command: string) => ({ command, found: false }),
  probeGatewayUrl: async (url: string) => ({ url, reachable: false }),
}));

it("uses the verified inference owner for a delegated fleet overview", async () => {
  await withTestDir({ prefix: "omnipolymath-engine-overview-" }, async (stateDir) => {
    const configPath = path.join(stateDir, "omnipolymath.json");
    await withEnvAsync(
      {
        OMNIPOLYMATH_STATE_DIR: stateDir,
        OMNIPOLYMATH_CONFIG_PATH: configPath,
        OMNIPOLYMATH_GATEWAY_URL: undefined,
        OMNIPOLYMATH_GATEWAY_PORT: undefined,
        OMNIPOLYMATH_PROFILE: undefined,
      },
      async () => {
        const verifiedConfig: OmnipolymathConfig = {
          agents: { entries: { main: { model: "openai/gpt-5.6-luna" } } },
        };
        await fs.writeFile(configPath, JSON.stringify(verifiedConfig));
        const verifiedSnapshot = await readConfigFileSnapshot();
        expect(verifiedSnapshot.valid).toBe(true);
        const metadata = createSystemAgentPluginMetadataTestSnapshot(verifiedConfig);
        await metadata.run(async () => {
          const inference = await createSystemAgentVerifiedInferenceTestFixture(verifiedConfig);
          const fleetConfig: OmnipolymathConfig = {
            agents: {
              ownership: "explicit",
              entries: { main: { model: "openai/gpt-5.6-luna" }, work: {} },
            },
            gateway: { port: 1 },
          };
          const raw = JSON.stringify(fleetConfig);
          await fs.writeFile(configPath, raw);
          const engine = new SystemAgentChatEngine({
            requesterAgentId: "work",
            verifiedInference: inference.binding,
          });
          const reader = vi
            .spyOn(configModule, "readConfigFileSnapshot")
            .mockResolvedValueOnce(verifiedSnapshot);
          try {
            const overview = await engine.loadOverview();
            expect(overview.config).toMatchObject({
              path: configPath,
              exists: true,
              valid: true,
              hash: createHash("sha256").update(raw).digest("hex"),
            });
            expect(overview.defaultAgentId).toBe("main");
            expect(overview.agents.map(({ id, isDefault }) => ({ id, isDefault }))).toEqual([
              { id: "main", isDefault: true },
              { id: "work", isDefault: false },
            ]);
          } finally {
            try {
              await engine.dispose();
            } finally {
              reader.mockRestore();
            }
          }
        });
      },
    );
  });
});
