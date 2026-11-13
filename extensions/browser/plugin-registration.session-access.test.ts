import type { PluginControlUiDescriptor } from "omnipolymath/plugin-sdk/plugin-entry";
import { createPluginStateKeyedStoreForTests } from "omnipolymath/plugin-sdk/plugin-state-test-runtime";
import { createTestPluginApi } from "omnipolymath/plugin-sdk/plugin-test-api";
import { createPluginRuntimeMock } from "omnipolymath/plugin-sdk/plugin-test-runtime";
import { withOmnipolymathTestState } from "omnipolymath/plugin-sdk/test-state";
import { expect, it } from "vitest";
import browserPlugin from "./index.js";

it("declares a session-writer dashboard while preserving the global admin method", async () => {
  await withOmnipolymathTestState({ scenario: "minimal" }, async () => {
    const descriptors: PluginControlUiDescriptor[] = [];
    const methods = new Map<string, unknown>();
    browserPlugin.register(
      createTestPluginApi({
        id: "browser",
        runtime: createPluginRuntimeMock({
          state: {
            openKeyedStore: (options) => createPluginStateKeyedStoreForTests("browser", options),
          },
        }),
        registerControlUiDescriptor: (descriptor) => descriptors.push(descriptor),
        registerGatewayMethod: (name, _handler, options) => {
          methods.set(name, options);
        },
      }),
    );
    expect(descriptors).toContainEqual(
      expect.objectContaining({
        id: "dashboard",
        surface: "widget",
        label: "Browser",
        requiredScopes: ["operator.sessions.write"],
      }),
    );
    expect(methods.get("browser.request")).toMatchObject({ scope: "operator.admin" });
    expect(methods.get("browser.dashboard.request")).toMatchObject({
      scope: "operator.write",
      sessionAccess: { mode: "write", allowOwnSessionScope: true, requiredTool: "browser" },
    });
  });
});
