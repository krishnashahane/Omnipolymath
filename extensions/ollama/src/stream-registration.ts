import type { StreamFn } from "omnipolymath/plugin-sdk/agent-core";
import { createLazyRuntimeModule } from "omnipolymath/plugin-sdk/lazy-runtime";
import type { OmnipolymathPluginApi, ProviderRuntimeModel } from "omnipolymath/plugin-sdk/plugin-entry";

const loadOllamaStreamRuntime = createLazyRuntimeModule(() => import("./stream.runtime.js"));

export type OllamaLocalService = {
  providerId: string;
  acquire: OmnipolymathPluginApi["runtime"]["llm"]["acquireLocalService"];
};

export function createLazyConfiguredOllamaStreamFn(params: {
  model: Pick<Partial<ProviderRuntimeModel>, "baseUrl" | "headers">;
  localService?: OllamaLocalService;
  providerBaseUrl?: string;
}): StreamFn {
  const streamFnPromise = loadOllamaStreamRuntime().then((runtime) =>
    runtime.createConfiguredOllamaStreamFn(params),
  );
  return async (...args) => {
    const streamFn = await streamFnPromise;
    return streamFn(...args);
  };
}
