/* @vitest-environment jsdom */
import { expect, onTestFinished, vi } from "vitest";
import { notifyRenderLifecycleForTest } from "../pages/chat/render-lifecycle.ts";
import { createControlUiMockGatewayInitScript } from "./control-ui-e2e.ts";
import { createControlUiPaneRuntimeTestAdapterScript } from "./control-ui-pane-runtime.test-support.ts";
import { mockGatewayTest as it } from "./mock-gateway-page.test-support.ts";

it("composes existing and replacement render lifecycle instrumentation", ({ gatewayPage }) => {
  const { window, execute } = gatewayPage;
  // SAFETY: The isolated page installs the existing opt-in instrumentation property.
  const scope = window as typeof window & {
    omnipolymathRenderLifecycleTestHook?: typeof notifyRenderLifecycleForTest;
  };
  const firstProbe = vi.fn();
  scope.omnipolymathRenderLifecycleTestHook = firstProbe;
  execute(createControlUiPaneRuntimeTestAdapterScript());
  const adapter = scope.omnipolymathRenderLifecycleTestHook;
  execute(createControlUiMockGatewayInitScript());
  expect(scope.omnipolymathRenderLifecycleTestHook).toBe(adapter);
  const owner = { element: window.document.createElement("omnipolymath-chat-pane") };
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  vi.stubGlobal("omnipolymathRenderLifecycleTestHook", scope.omnipolymathRenderLifecycleTestHook);

  notifyRenderLifecycleForTest(owner, "commit");
  expect(firstProbe).toHaveBeenCalledWith(owner, "commit");

  const streamProbe = vi.fn();
  scope.omnipolymathRenderLifecycleTestHook = streamProbe;
  notifyRenderLifecycleForTest(owner, "commit");
  expect(firstProbe).toHaveBeenCalledTimes(1);
  expect(streamProbe).toHaveBeenCalledWith(owner, "commit");
});
