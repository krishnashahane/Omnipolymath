import { definePluginEntry } from "omnipolymath/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "bonjour",
  name: "Bonjour Gateway Discovery",
  description: "Advertise the local Omnipolymath gateway over Bonjour/mDNS.",
  register(api) {
    api.registerGatewayDiscoveryService({
      id: "bonjour",
      advertise: async (ctx) => {
        const { startGatewayBonjourAdvertiser } = await import("./src/advertiser.js");
        const displayName = ctx.machineDisplayName.trim();
        return startGatewayBonjourAdvertiser(
          {
            instanceName: !displayName
              ? "Omnipolymath"
              : /omnipolymath/i.test(displayName)
                ? displayName
                : `${displayName} (Omnipolymath)`,
            gatewayPort: ctx.gatewayPort,
            gatewayTlsEnabled: ctx.gatewayTlsEnabled,
            gatewayTlsFingerprintSha256: ctx.gatewayTlsFingerprintSha256,
            gatewayDirectReachable: ctx.gatewayDirectReachable,
            sshPort: ctx.sshPort,
            tailnetDns: ctx.tailnetDns,
            cliPath: ctx.cliPath,
            minimal: ctx.minimal,
          },
          api.logger,
        );
      },
    });
  },
});
