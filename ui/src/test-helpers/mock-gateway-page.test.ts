import { expect } from "vitest";
import { configSnapshot } from "../lib/config/config-snapshot.test-support.ts";
import {
  createControlUiMockGatewayInitScript,
  createControlUiMockSameOriginGatewayScript,
} from "./control-ui-e2e.ts";
import { mockGatewayTest as it } from "./mock-gateway-page.test-support.ts";

it("keeps serialized Gateway globals and storage out of the host realm", ({ gatewayPage }) => {
  const keys = [
    "WebSocket",
    "JSON5",
    "__OMNIPOLYMATH_CONTROL_UI_BASE_PATH__",
    "omnipolymathControlUiE2eGateway",
  ];
  const descriptors = () => keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const before = descriptors();
  const hostStorage = Object.entries(sessionStorage);
  gatewayPage.execute(createControlUiMockGatewayInitScript({}));
  gatewayPage.window.sessionStorage.setItem("fixture-only", "owned");

  expect(gatewayPage.window).not.toBe(globalThis.window);
  expect(
    Object.getOwnPropertyDescriptor(gatewayPage.window, "omnipolymathControlUiE2eGateway")?.value,
  ).toBeDefined();
  expect(descriptors()).toEqual(before);
  expect(Object.entries(sessionStorage)).toEqual(hostStorage);
});

it("binds standalone mock pages to their serving Gateway", ({ gatewayPage }) => {
  gatewayPage.execute(createControlUiMockSameOriginGatewayScript());

  expect(gatewayPage.window["__OMNIPOLYMATH_NATIVE_CONTROL_AUTH__"]).toEqual({
    gatewayUrl: "ws://mock-control-ui",
  });
});

it("retires queued Gateway work and listeners when its page closes", async ({ gatewayPage }) => {
  const { window, execute } = gatewayPage;
  execute(
    createControlUiMockGatewayInitScript({
      methodResponses: {
        "config.get": configSnapshot({ count: 1 }, "original", '{"count":1}'),
      },
    }),
  );
  const storage = window.sessionStorage;
  const socket = new window.WebSocket("ws://mock-gateway");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(socket.readyState).toBe(window.WebSocket.OPEN);
  const responses: string[] = [];
  socket.addEventListener("message", (event: MessageEvent) => responses.push(String(event.data)));
  socket.send(
    JSON.stringify({
      type: "req",
      id: "queued-write",
      method: "config.set",
      params: { raw: '{"count":2}', baseHash: "original" },
    }),
  );
  let listenerCalls = 0;
  window.addEventListener("fixture-probe", () => {
    listenerCalls += 1;
  });
  gatewayPage.close();
  window.dispatchEvent(new window.Event("fixture-probe"));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

  expect(storage.getItem("omnipolymath.control-ui-e2e.configState")).toBeNull();
  expect(responses).toEqual([]);
  expect(listenerCalls).toBe(0);
});
