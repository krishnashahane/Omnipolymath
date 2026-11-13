import assert from "node:assert/strict";
import { json } from "node:stream/consumers";
import type {
  MemorySearchManager,
  MemorySyncParams,
} from "omnipolymath/plugin-sdk/memory-core-host-engine-storage";
import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/memory-core-host-runtime-core";
import { setRuntimeConfigSnapshot } from "omnipolymath/plugin-sdk/runtime-config-snapshot";
import { withServer } from "omnipolymath/plugin-sdk/test-env";
import { withOmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";
import { runInMemoryTestBackgroundContext } from "./background-context.test-support.js";
import { closeCompatibleIndexManagers } from "./manager-compatible-index.test-support.js";
import { isolateMemoryManagerTestConfig } from "./test-config-helpers.js";

export async function withEmbeddingHttpFixture(
  prefix: string,
  run: (fixture: {
    workspace: string;
    baseUrl: string;
    requests: string[][];
    configure: (overrides: OmnipolymathConfig) => void;
    open: () => Promise<{
      manager: MemorySearchManager;
      sync: (params: MemorySyncParams) => Promise<void>;
    }>;
  }) => Promise<void>,
) {
  const { getMemorySearchManager } = await import("./index.js");
  const requests: string[][] = [];
  await withServer(
    (req, res) => {
      void (async () => {
        const body = (await json(req)) as { input: string[] };
        requests.push(body.input);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            data: body.input.map((text, index) => ({
              index,
              embedding: text.toLowerCase().includes("alpha") ? [1, 0, 0] : [0, 1, 0],
            })),
          }),
        );
      })().catch((error: unknown) => {
        res.writeHead(500);
        res.end(String(error));
      });
    },
    async (origin) => {
      await withOmnipolymathTestState({ prefix, layout: "state-only" }, async (state) => {
        let cfg: OmnipolymathConfig;
        const configure = (overrides: OmnipolymathConfig) => {
          cfg = isolateMemoryManagerTestConfig({
            ...overrides,
            agents: { defaults: { workspace: state.workspaceDir }, entries: { main: {} } },
          });
          setRuntimeConfigSnapshot(cfg);
        };
        const open = async () => {
          const { manager } = await getMemorySearchManager({
            cfg,
            agentId: "main",
            purpose: "cli",
            runInBackgroundContext: runInMemoryTestBackgroundContext,
          });
          assert(
            manager && typeof manager.sync === "function",
            "fixture memory index manager is unavailable",
          );
          return { manager, sync: manager.sync.bind(manager) };
        };
        try {
          await run({
            workspace: state.workspaceDir,
            baseUrl: `${origin}/v1`,
            requests,
            configure,
            open,
          });
        } finally {
          await closeCompatibleIndexManagers();
        }
      });
    },
  );
}
