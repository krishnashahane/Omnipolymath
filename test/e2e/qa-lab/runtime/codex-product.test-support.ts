import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadBundledPluginFacade } from "../../../../src/test-utils/bundled-plugin-public-surface.js";
import {
  fixtureReceiptClientSource,
  openFixtureReceiptChannel,
} from "../../../helpers/fixture-receipts.js";
import { createOmnipolymathTestInstance } from "../../../helpers/omnipolymath-test-instance.js";

export async function createCodexReceiptClient(root: string) {
  const receipts = await openFixtureReceiptChannel();
  const clientPath = path.join(root, "client.mjs");
  await fs.writeFile(
    clientPath,
    `${fixtureReceiptClientSource(receipts.endpoint)}\nexport { sendReceipt };\n`,
  );
  return { receipts, receiptClientUrl: pathToFileURL(clientPath).href };
}

type InstanceOptions = Parameters<typeof createOmnipolymathTestInstance>[0];

export async function createCodexProductInstance({
  receiptClientUrl,
  model,
  nativeModel,
  openaiCatalog = false,
  logging,
  ...options
}: Pick<InstanceOptions, "name" | "env" | "gatewayCommandPrefix" | "startTimeoutMs"> & {
  receiptClientUrl: string;
  model: string;
  nativeModel?: string;
  openaiCatalog?: boolean;
  logging?: { consoleLevel: "debug" };
}) {
  const { CODEX_APP_SERVER_VERSION } = await loadBundledPluginFacade<{
    CODEX_APP_SERVER_VERSION: string;
  }>({ pluginId: "codex", artifactBasename: "test-api.js" });
  return createOmnipolymathTestInstance({
    ...options,
    env: {
      OMNIPOLYMATH_AGENT_HARNESS_FALLBACK: "none",
      OMNIPOLYMATH_QA_CODEX_APP_SERVER_VERSION: CODEX_APP_SERVER_VERSION,
      OMNIPOLYMATH_SKIP_PROVIDERS: undefined,
      // Native turns and auth refresh need the real Gateway process owner.
      OMNIPOLYMATH_TEST_MINIMAL_GATEWAY: undefined,
      ...options.env,
    },
    config: {
      ...(logging ? { logging } : {}),
      plugins: {
        enabled: true,
        allow: openaiCatalog ? ["codex", "openai"] : ["codex"],
        entries: {
          ...(openaiCatalog ? { openai: { enabled: true } } : {}),
          codex: {
            enabled: true,
            config: {
              appServer: {
                mode: "yolo",
                command: process.execPath,
                args: [
                  fileURLToPath(new URL("./codex-auth-app-server.fixture.mjs", import.meta.url)),
                  receiptClientUrl,
                ],
                requestTimeoutMs: 60_000,
              },
            },
          },
        },
      },
      agents: {
        defaults: {
          model: { primary: model, fallbacks: [] },
          // Catalog routing must exercise the default runtime, without an override.
          ...(nativeModel ? { models: { [nativeModel]: { agentRuntime: { id: "codex" } } } } : {}),
          workspace: "~/workspace",
          skipBootstrap: true,
          timeoutSeconds: 60,
          sandbox: { mode: "off" },
        },
      },
    },
  });
}
