import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { createOmnipolymathCodingToolsInternalAsync } from "../../../agents/agent-tools.js";
import { resolveRuntimeChannelPromptContext } from "../../../agents/runtime-capabilities.js";
import { buildAgentSystemPrompt } from "../../../agents/system-prompt.js";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../../config/io.js";
import type { OmnipolymathConfig } from "../../../config/types.omnipolymath.js";
import { isPrereleaseSemverVersion } from "../../../infra/npm-registry-spec.js";
import {
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../../../plugins/runtime.js";
import { createTestRegistry } from "../../../test-utils/channel-plugins.js";
import { getBundledChannelPluginAsync } from "./test-helpers/bundled-channel-plugin-loader.js";
import {
  describeBundledMetadataOnlyChannelCatalogContract,
  describeChannelCatalogEntryContract,
  describeOfficialFallbackChannelCatalogContract,
} from "./test-helpers/channel-catalog-contract.js";

async function registerChannels(ids: string) {
  const channels = await Promise.all(
    ids.split(" ").map(async (pluginId) => {
      const plugin = await getBundledChannelPluginAsync(pluginId);
      assert(plugin, `Missing bundled channel plugin for ${pluginId}`);
      return { pluginId, plugin, source: "test" };
    }),
  );
  setActivePluginRegistry(createTestRegistry(channels));
}

afterEach(() => {
  resetPluginRuntimeStateForTest();
  clearRuntimeConfigSnapshot();
});

for (const [channelId, npmSpec, alias] of [
  ["msteams", "@omnipolymath/msteams", "teams"],
  ["wecom", "@wecom/wecom-omnipolymath-plugin@2026.7.2", "wework"],
  ["yuanbao", "omnipolymath-plugin-yuanbao@2.18.2", "yb"],
  ["omnipolymath-zaloclawbot", "@zalo-platforms/omnipolymath-zaloclawbot@0.1.4", "zaloclawbot"],
] as const) {
  describeChannelCatalogEntryContract({ channelId, npmSpec, alias });
}

const whatsappPackageJson = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "extensions", "whatsapp", "package.json"), "utf8"),
) as {
  name?: string;
  version?: string;
  omnipolymath?: { install?: { npmSpec?: string } };
};
const whatsappNpmSpec = whatsappPackageJson.omnipolymath?.install?.npmSpec ?? whatsappPackageJson.name;
const whatsappVersion = whatsappPackageJson.version;
if (!whatsappNpmSpec || !whatsappVersion) {
  throw new Error("missing package metadata for whatsapp");
}
const whatsappCatalog = {
  pluginId: "whatsapp",
  channelId: "whatsapp",
  packageName: "@omnipolymath/whatsapp",
  npmSpec: "@omnipolymath/whatsapp",
  meta: {
    id: "whatsapp",
    label: "WhatsApp",
    selectionLabel: "WhatsApp (QR link)",
    detailLabel: "WhatsApp Web",
    docsPath: "/channels/whatsapp",
    blurb: "works with your own number; recommend a separate phone + eSIM.",
  },
};
describeBundledMetadataOnlyChannelCatalogContract({ ...whatsappCatalog, defaultChoice: "npm" });
describeOfficialFallbackChannelCatalogContract({
  ...whatsappCatalog,
  npmSpec: isPrereleaseSemverVersion(whatsappVersion)
    ? `${whatsappNpmSpec}@${whatsappVersion}`
    : whatsappNpmSpec,
  externalNpmSpec: "@vendor/whatsapp-fork",
  externalLabel: "WhatsApp Fork",
});

const config: OmnipolymathConfig = {
  agents: { entries: { main: {} } },
  plugins: { enabled: false },
  tools: { allow: ["ask_user"] },
};

it.each([
  { messageChannel: "webchat", available: true },
  { messageChannel: "discord", available: true },
  { messageChannel: "slack", available: true },
  { messageChannel: "telegram", available: true },
  { messageChannel: "whatsapp", available: false },
  { messageChannel: "imessage", available: false },
  { messageChannel: "signal", available: false },
  { messageChannel: "mattermost", available: false },
  { messageChannel: "unknown-channel", available: false },
  { messageChannel: "webchat", available: false, deny: true },
])(
  "uses the inbound $messageChannel capability (available: $available, deny: $deny)",
  async ({ messageChannel, available, deny }) => {
    setRuntimeConfigSnapshot(config);
    await registerChannels("discord imessage mattermost signal slack telegram whatsapp");
    const tools = await createOmnipolymathCodingToolsInternalAsync({
      config: deny ? { ...config, tools: { allow: ["ask_user"], deny: ["ask_user"] } } : config,
      sessionKey: "agent:main:run",
      messageChannel,
      messageProvider: "discord",
      toolConstructionPlan: {
        includeBaseCodingTools: false,
        includeShellTools: false,
        includeChannelTools: false,
        includeOmnipolymathTools: true,
        includePluginTools: false,
      },
    });
    expect(tools.some((tool) => tool.name === "ask_user")).toBe(available);
  },
);
it.each([{ capabilities: undefined }, { capabilities: ["inlineButtons"] }])(
  "does not advertise unsupported callbacks with capabilities $capabilities",
  async ({ capabilities }) => {
    await registerChannels("feishu");
    const feishu = {
      enabled: true,
      appId: "cli_test",
      appSecret: "synthetic-secret",
      capabilities,
    };
    const context = resolveRuntimeChannelPromptContext({
      cfg: { channels: { feishu } },
      channel: "feishu",
    });
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/workspace",
      toolNames: ["message"],
      runtimeInfo: {
        channel: context.runtimeChannel,
        capabilities: context.runtimeCapabilities,
        customInlineButtonHint: context.customInlineButtonHint,
      },
      messageToolHints: context.messageToolHints,
    });
    expect(prompt).not.toContain("feishu.capabilities.inlineButtons");
    expect(prompt).not.toContain('"action":{"type":"callback"');
    expect(prompt).toContain("ask questions in plain text");
  },
);
