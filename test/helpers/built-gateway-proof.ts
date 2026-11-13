import type { GatewayClient } from "../../src/gateway/client.js";
import { disconnectGatewayClient } from "../../src/gateway/test-helpers.e2e.js";
import { connectProofClient } from "./gateway-integration-fixtures.js";
import { createOmnipolymathTestInstance, type OmnipolymathTestInstance } from "./omnipolymath-test-instance.js";
import { runQaGatewayFixture } from "./qa-gateway-cleanup.js";

export async function withBuiltGateway(
  options: Parameters<typeof createOmnipolymathTestInstance>[0],
  body: (client: GatewayClient, instance: OmnipolymathTestInstance) => Promise<void>,
  clientOptions: Parameters<typeof connectProofClient>[1] = {},
) {
  const instance = await createOmnipolymathTestInstance(options);
  let client: GatewayClient | undefined;
  await runQaGatewayFixture(
    async () => {
      try {
        await instance.startGateway();
        client = await connectProofClient(instance, clientOptions);
        await body(client, instance);
      } catch (error) {
        throw new Error(`${String(error)}\n${await instance.diagnose()}`, { cause: error });
      }
    },
    () => client && disconnectGatewayClient(client),
    () => instance.cleanup(),
  );
}
