// With the Labs switch off, the omnipolymathId.* methods answer nothing about the claw,
// even to the direct-loopback operator and even when a linked claw record exists.
import { describe, expect, it } from "vitest";
import type { GatewayOmnipolymathIdConfig } from "../../config/types.gateway.js";
import { omnipolymathIdHandlers } from "../server-methods/omnipolymath-id.js";
import type { GatewayRequestHandlerOptions } from "../server-methods/types.js";
import { linkedClaw, serviceFor } from "./omnipolymath-id.test-support.js";

const loopback = { internal: { isLocalClient: true } };

describe.each<[string, GatewayOmnipolymathIdConfig | undefined]>([
  ["absent", undefined],
  ["explicitly off", { enabled: false }],
])("Omnipolymath ID methods with the Labs switch %s", (_label, config) => {
  it("refuses people and every authority action and reports no link", async () => {
    const claw = await linkedClaw();
    // serviceFor defaults to enabled; an empty block is the absent switch.
    const { service } = serviceFor(claw.authority, config ?? {});
    const call = async (method: string, params: Record<string, unknown> = {}) => {
      let response: { ok: boolean; payload?: Record<string, unknown> } | undefined;
      await omnipolymathIdHandlers[method]!({
        params,
        client: loopback,
        respond: (ok: boolean, payload?: Record<string, unknown>) => {
          response = { ok, payload };
        },
        context: {
          omnipolymathIdService: service,
          getRuntimeConfig: () => ({ gateway: { omnipolymathId: config } }),
        },
      } as unknown as GatewayRequestHandlerOptions);
      return response!;
    };

    for (const action of ["check_name", "prepare", "commit", "publish", "submit", "device_mail"]) {
      expect((await call("omnipolymathId.authority", { action })).ok, action).toBe(false);
    }
    expect((await call("omnipolymathId.people")).ok).toBe(false);
    expect((await call("omnipolymathId.status")).payload).toMatchObject({
      status: { state: "off" },
      link: { linked: false },
      owner: false,
    });
  });
});
