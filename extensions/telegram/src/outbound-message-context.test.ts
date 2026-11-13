import type { OmnipolymathConfig } from "omnipolymath/plugin-sdk/config-contracts";
import { resetPluginStateStoreForTests } from "omnipolymath/plugin-sdk/plugin-state-test-runtime";
import { resolveStorePath } from "omnipolymath/plugin-sdk/session-store-runtime";
import { createOmnipolymathTestState, type OmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasProviderObservedTelegramThreadBinding } from "./message-cache-codec.js";
import { resolveTelegramMessageCacheScope } from "./message-cache-persistence.js";
import { createTelegramMessageCache } from "./message-cache.js";
import { recordOutboundMessageForPromptContext } from "./outbound-message-context.js";
import { setTelegramPluginStateRuntimeForTests } from "./runtime-state.test-support.js";
import {
  clearTelegramRuntimeForTest as clearTelegramRuntime,
  resetTelegramMessageCacheForTest as resetTelegramMessageCacheBucketsForTest,
} from "./runtime.test-support.js";

let cfg: OmnipolymathConfig;
let testState: OmnipolymathTestState;
const accountId = "default";
const bot = (first_name: string, username?: string, id = 999) => ({
  id,
  is_bot: true,
  first_name,
  ...(username ? { username } : {}),
});
const privateChat = { id: 42, type: "private" };
const self = (sender: string, senderId = "999", extra = {}) => ({
  sender: `${sender} (you)`,
  senderId,
  ...extra,
});
type RecordParams = Omit<Parameters<typeof recordOutboundMessageForPromptContext>[0], "cfg">;
async function recordAndRead(
  message: RecordParams["message"],
  options: Partial<Omit<RecordParams, "message" | "account">> & { name?: string } = {},
) {
  const { name = "Configured Agent", ...overrides } = options;
  const input = { account: { accountId, name }, chatId: 42, messageId: 700, message, ...overrides };
  await recordOutboundMessageForPromptContext({ cfg, ...input });
  return createPromptContextCache().get({
    accountId,
    chatId: input.chatId,
    messageId: String(input.messageId),
  });
}

function createPromptContextCache() {
  return createTelegramMessageCache({
    scope: resolveTelegramMessageCacheScope(resolveStorePath(cfg.session?.store)),
  });
}

describe("recordOutboundMessageForPromptContext", () => {
  beforeEach(async () => {
    testState = await createOmnipolymathTestState({
      label: "telegram-outbound-history",
      layout: "state-only",
    });
    cfg = { session: { store: testState.statePath("sessions", "sessions.json") } };
    resetPluginStateStoreForTests();
    resetTelegramMessageCacheBucketsForTest();
    setTelegramPluginStateRuntimeForTests();
  });

  afterEach(async () => {
    clearTelegramRuntime();
    resetTelegramMessageCacheBucketsForTest();
    resetPluginStateStoreForTests();
    await testState.cleanup();
  });

  it.each([
    ["caller-only forum", "forum", {}, 77, false],
    ["provider forum", "forum", { message_thread_id: 77 }, 77, true],
    ["private General topic", "dm", { chat: privateChat }, 1, false],
    [
      "channel Direct Messages precedence",
      "direct-messages",
      {
        message_thread_id: 999,
        direct_messages_topic: { topic_id: 77 },
      },
      77,
      true,
    ],
  ] as const)(
    "records only provider-observed threads: %s",
    async (_label, scope, message, id, bound) => {
      const cached = await recordAndRead(message, {
        chatId: scope === "dm" ? 42 : -1001,
        messageThreadId: "message_thread_id" in message ? message.message_thread_id : id,
        successfulSendThread: { scope, id },
      });
      expect(hasProviderObservedTelegramThreadBinding(cached, id)).toBe(bound);
      if (scope === "direct-messages") {
        expect([cached?.threadId, cached?.threadBinding?.threadSpec]).toEqual([
          "77",
          { scope: "direct-messages", id: 77 },
        ]);
      }
    },
  );

  it.each([
    [
      "  Configured Agent  ",
      {
        from: { ...bot("Provisioning", "omnipolymath_bot"), last_name: "Placeholder" },
      },
      self("Configured Agent", "999", {
        senderUsername: "omnipolymath_bot",
        sourceMessage: { from: bot("Configured Agent (you)", "omnipolymath_bot") },
      }),
    ],
    [
      "",
      { from: bot("Atlas", "atlas_bot") },
      self("Atlas", "999", { senderUsername: "atlas_bot" }),
    ],
    [
      "Configured Agent",
      {
        from: {
          id: 777,
          is_bot: false,
          first_name: "Business Account",
          username: "business_account",
        },
        sender_business_bot: bot("Telegram Bot Name", "omnipolymath_bot"),
      },
      self("Configured Agent", "777", {
        senderUsername: "business_account",
        sourceMessage: { sender_business_bot: { id: 999, is_bot: true, username: "omnipolymath_bot" } },
      }),
    ],
    [
      "StreamBot",
      {},
      self("StreamBot", "0", {
        sourceMessage: { from: bot("StreamBot (you)", undefined, 0) },
      }),
    ],
  ] as const)(
    "preserves configured, provider, Business and synthetic identity: %s",
    async (accountName, message, expected) => {
      const cached = await recordAndRead(
        { ...message, chat: privateChat },
        { name: accountName, text: "Bot just replied" },
      );
      expect(cached).toMatchObject(expected);
      expect(cached?.sourceMessage.from).not.toHaveProperty("last_name");
    },
  );

  it("ignores Telegram's fake sender identity across channel post echoes", async () => {
    const senderChat = { id: -1001, type: "channel" as const, title: "Announcements" };
    const echo = {
      message_id: 1498,
      from: { id: 777_000, is_bot: false, first_name: "Telegram" },
      sender_chat: senderChat,
      text: "Channel announcement",
    };
    const initial = await recordAndRead(
      { ...echo, text: undefined },
      {
        name: "",
        chatId: -1001,
        messageId: 1498,
        text: "Channel announcement",
      },
    );
    expect(initial).toMatchObject(self("Omnipolymath", "0"));

    const cache = createPromptContextCache();
    await cache.record({
      accountId: "default",
      chatId: -1001,
      msg: {
        ...echo,
        date: 1_736_380_900,
        chat: { id: -1001, type: "supergroup", title: "Announcements" },
      },
    });

    const merged = await cache.get({ accountId: "default", chatId: -1001, messageId: "1498" });
    expect(merged).toMatchObject(
      self("Omnipolymath", "0", {
        sourceMessage: {
          from: bot("Omnipolymath (you)", undefined, 0),
          sender_chat: senderChat,
        },
      }),
    );
  });
});
