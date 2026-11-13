import type {
  OmnipolymathPluginApi,
  OmnipolymathPluginNodeHostCommand,
  OmnipolymathPluginNodeInvokePolicy,
} from "omnipolymath/plugin-sdk/plugin-entry";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("linux-node plugin registration", () => {
  it("registers node-host commands and preserves explicit arming for capture", () => {
    const commands: OmnipolymathPluginNodeHostCommand[] = [];
    const policies: OmnipolymathPluginNodeInvokePolicy[] = [];
    plugin.register({
      pluginConfig: {
        notify: { enabled: true },
        camera: { enabled: true },
        location: { enabled: true },
      },
      registerNodeHostCommand: (command: OmnipolymathPluginNodeHostCommand) => commands.push(command),
      registerNodeInvokePolicy: (policy: OmnipolymathPluginNodeInvokePolicy) => policies.push(policy),
    } as unknown as OmnipolymathPluginApi);

    expect(commands.map((command) => command.command)).toEqual([
      "system.notify",
      "camera.list",
      "camera.snap",
      "camera.clip",
      "location.get",
    ]);
    expect(
      commands.filter((command) => command.dangerous).map((command) => command.command),
    ).toEqual(["camera.snap", "camera.clip"]);
    expect(policies).toHaveLength(2);
    expect(policies[0]).toMatchObject({
      commands: ["camera.list", "location.get"],
      defaultPlatforms: ["linux"],
    });
    expect(policies[1]).toMatchObject({
      commands: ["camera.snap", "camera.clip"],
      dangerous: true,
    });
    expect(policies[1]?.defaultPlatforms).toBeUndefined();
  });
});
