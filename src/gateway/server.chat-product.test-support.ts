import { createServer, type ServerResponse } from "node:http";
import { readRequestText } from "../../test/helpers/gateway-integration-fixtures.js";
import type { OmnipolymathConfig } from "../config/types.omnipolymath.js";
import { createOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { KERNEL_TEST_ENV } from "./test-helpers.env.js";
import { buildMockOpenAiResponsesProvider } from "./test-openai-responses-model.js";

export const createProductState = (label: string) =>
  createOmnipolymathTestState({
    label,
    env: {
      ...KERNEL_TEST_ENV,
      VITEST: process.env.VITEST,
      OMNIPOLYMATH_TEST_MINIMAL_GATEWAY: undefined,
      OMNIPOLYMATH_DISABLE_BUNDLED_PLUGINS: "1",
    },
  });

export function productModelConfig(
  workspace: string,
  provider: ReturnType<typeof buildMockOpenAiResponsesProvider>,
) {
  return {
    defaults: {
      workspace,
      skipBootstrap: true,
      model: { primary: provider.modelRef },
      models: {
        [provider.modelRef]: {
          agentRuntime: { id: "omnipolymath" },
          params: { transport: "sse", openaiWsWarmup: false },
        },
      },
    },
    models: {
      mode: "replace",
      providers: {
        [provider.providerId]: { ...provider.config, request: { allowPrivateNetwork: true } },
      },
    },
  } satisfies {
    defaults: NonNullable<OmnipolymathConfig["agents"]>["defaults"];
    models: OmnipolymathConfig["models"];
  };
}

export function productProvider(
  errors: unknown[],
  handle: (body: string, response: ServerResponse, url?: string) => void | Promise<void>,
) {
  return createServer((request, response) => {
    void readRequestText(request)
      .then((body) => handle(body, response, request.url))
      .catch((error: unknown) => {
        errors.push(error);
        response.writeHead(500).end("fixture provider failed");
      });
  });
}
