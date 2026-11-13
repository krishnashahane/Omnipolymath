// Matrix tests cover device health plugin behavior.
import { describe, expect, it } from "vitest";
import { listStaleOmnipolymathMatrixDevices } from "./device-health.js";

describe("matrix device health", () => {
  it("summarizes stale Omnipolymath-managed devices separately from the current device", () => {
    const devices = [
      {
        deviceId: "du314Zpw3A",
        displayName: "Omnipolymath Gateway",
        current: true,
      },
      {
        deviceId: "BritdXC6iL",
        displayName: "Omnipolymath Gateway",
        current: false,
      },
      {
        deviceId: "G6NJU9cTgs",
        displayName: "Omnipolymath Debug",
        current: false,
      },
      {
        deviceId: "phone123",
        displayName: "Element iPhone",
        current: false,
      },
      { deviceId: "unnamed", displayName: null, current: false },
    ];

    expect(listStaleOmnipolymathMatrixDevices(devices)).toEqual([devices[1], devices[2]]);
  });
});
