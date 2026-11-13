import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CommandContext } from "../auto-reply/reply/commands-types.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { resetPluginStateStoreForTests } from "../plugin-state/plugin-state-store.js";
import { closeOmnipolymathStateDatabaseAsync } from "../state/omnipolymath-state-db.js";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { withEnvAsync } from "../test-utils/env.js";
import { runSystemAgentRescueMessage } from "./rescue-message.js";

describe("Omnipolymath rescue eligibility", () => {
  it.each<{
    name: string;
    cfg: OmnipolymathConfig;
    senderIsOwner: boolean;
    isGroup: boolean;
    reply: string;
  }>([
    {
      name: "active sandbox",
      cfg: { agents: { defaults: { sandbox: { mode: "all" } } } },
      senderIsOwner: true,
      isGroup: false,
      reply:
        "Omnipolymath rescue is blocked because Omnipolymath sandboxing is active. Fix the install locally or disable sandboxing before using remote rescue.",
    },
    {
      name: "restricted host posture",
      cfg: { tools: { exec: { security: "allowlist", ask: "always" } } },
      senderIsOwner: true,
      isGroup: false,
      reply: "Omnipolymath rescue requires YOLO host posture with sandboxing off.",
    },
    {
      name: "non-owner sender",
      cfg: {},
      senderIsOwner: false,
      isGroup: false,
      reply: "Omnipolymath rescue only accepts commands from an Omnipolymath owner.",
    },
    {
      name: "group conversation",
      cfg: {},
      senderIsOwner: true,
      isGroup: true,
      reply: "Omnipolymath rescue is restricted to owner DMs by default.",
    },
  ])(
    "denies $name through the rescue entry point",
    async ({ cfg, senderIsOwner, isGroup, reply }) => {
      await withTestDir({ prefix: "omnipolymath-rescue-policy-" }, async (root) => {
        await withEnvAsync(
          {
            HOME: root,
            OMNIPOLYMATH_HOME: path.join(root, ".omnipolymath"),
            OMNIPOLYMATH_STATE_DIR: path.join(root, "state"),
            OMNIPOLYMATH_CONFIG_PATH: path.join(root, "omnipolymath.json"),
            XDG_CONFIG_HOME: path.join(root, "config"),
            XDG_CACHE_HOME: path.join(root, "cache"),
            XDG_DATA_HOME: path.join(root, "data"),
            XDG_STATE_HOME: path.join(root, "xdg-state"),
          },
          async () => {
            const commandBody = "/omnipolymath restart gateway";
            const command: CommandContext = {
              surface: "whatsapp",
              channel: "whatsapp",
              channelId: "whatsapp",
              accountId: "default",
              ownerList: ["user:owner"],
              senderIsOwner,
              isAuthorizedSender: true,
              senderId: senderIsOwner ? "user:owner" : "user:other",
              rawBodyNormalized: commandBody,
              commandBodyNormalized: commandBody,
              from: senderIsOwner ? "user:owner" : "user:other",
              to: "account:default",
            };
            resetPluginStateStoreForTests();
            try {
              await expect(
                runSystemAgentRescueMessage({ cfg, command, commandBody, isGroup }),
              ).resolves.toBe(reply);
            } finally {
              try {
                await closeOmnipolymathStateDatabaseAsync();
              } finally {
                resetPluginStateStoreForTests();
              }
            }
          },
        );
      });
    },
  );
});
