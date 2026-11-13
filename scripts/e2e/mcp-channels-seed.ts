// Mcp Channels Seed script supports Omnipolymath repository automation.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyDockerOpenAiProviderConfig, type OmnipolymathConfig } from "./docker-openai-seed.ts";

async function main() {
  const stateDir = process.env.OMNIPOLYMATH_STATE_DIR?.trim() || path.join(os.homedir(), ".omnipolymath");
  const configPath =
    process.env.OMNIPOLYMATH_CONFIG_PATH?.trim() || path.join(stateDir, "omnipolymath.json");
  const now = Date.now();

  await fs.mkdir(path.dirname(configPath), { recursive: true });

  const seededConfig = applyDockerOpenAiProviderConfig(
    {
      gateway: {
        controlUi: {
          enabled: false,
        },
      },
      plugins: {
        enabled: false,
      },
    } satisfies OmnipolymathConfig,
    "sk-docker-smoke-test",
  );

  await fs.writeFile(configPath, JSON.stringify(seededConfig, null, 2), "utf-8");

  const [
    { normalizeSessionDeliveryState, upsertSessionEntry },
    { appendSessionTranscriptMessagesByIdentity },
    { resolveOmnipolymathAgentSqlitePath },
  ] = await Promise.all([
    import("omnipolymath/plugin-sdk/session-store-runtime"),
    import("omnipolymath/plugin-sdk/session-transcript-runtime"),
    import("omnipolymath/plugin-sdk/sqlite-runtime"),
  ]);
  const storePath = resolveOmnipolymathAgentSqlitePath({ agentId: "main" });

  await upsertSessionEntry({
    agentId: "main",
    sessionKey: "agent:main:main",
    storePath,
    entry: {
      sessionId: "sess-main",
      updatedAt: now,
      delivery: normalizeSessionDeliveryState({
        context: {
          channel: "imessage",
          to: "+15551234567",
          accountId: "imessage-default",
          threadId: "thread-42",
        },
      }),
      displayName: "Docker MCP Channel Smoke",
    },
  });

  // The installed candidate owns the transcript header and ordered parent links.
  await appendSessionTranscriptMessagesByIdentity({
    agentId: "main",
    sessionKey: "agent:main:main",
    sessionId: "sess-main",
    storePath,
    config: seededConfig,
    messages: [
      {
        eventId: "msg-1",
        now,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hello from seeded transcript" }],
          timestamp: now,
        },
      },
      {
        eventId: "msg-attachment",
        now: now + 1,
        message: {
          role: "user",
          content: "seeded image attachment",
          __omnipolymath: {
            media: [
              {
                url: "media://inbound/seeded-image.png",
                contentType: "image/png",
                kind: "image",
                fileName: "seeded-image.png",
                sizeBytes: 3,
              },
            ],
          },
          timestamp: now + 1,
        },
      },
    ],
  });

  process.stdout.write(`${JSON.stringify({ ok: true, stateDir, configPath, storePath })}\n`);
}

await main();
