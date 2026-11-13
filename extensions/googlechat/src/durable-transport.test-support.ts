import type { sendDurableMessageBatch } from "omnipolymath/plugin-sdk/channel-outbound";
import { withOmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";

export async function withDurableGoogleChatTransport(
  label: string,
  run: (send: typeof sendDurableMessageBatch) => Promise<void>,
) {
  await withOmnipolymathTestState({ label, layout: "state-only" }, async () => {
    const [
      { sendDurableMessageBatch },
      { createTestRegistry, withPluginRuntimeRegistryScope },
      { googlechatPlugin },
    ] = await Promise.all([
      import("omnipolymath/plugin-sdk/channel-outbound"),
      import("omnipolymath/plugin-sdk/channel-test-helpers"),
      import("../api.js"),
    ]);
    await withPluginRuntimeRegistryScope(
      createTestRegistry([{ pluginId: "googlechat", plugin: googlechatPlugin, source: "test" }]),
      () => run(sendDurableMessageBatch),
    );
  });
}
