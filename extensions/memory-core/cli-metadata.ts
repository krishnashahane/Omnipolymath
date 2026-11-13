import { definePluginEntry, type OmnipolymathPluginApi } from "omnipolymath/plugin-sdk/core";
import type { OpenKeyedStoreOptions } from "omnipolymath/plugin-sdk/plugin-state-runtime";
import type { MemoryCoreRuntimeHost } from "./src/memory/runtime-host.js";

export function registerMemoryCoreCli(api: OmnipolymathPluginApi, host?: MemoryCoreRuntimeHost) {
  api.registerCli(
    async ({ program }) => {
      const { registerMemoryCli } = await import("./cli.js");
      registerMemoryCli(
        program,
        host ?? {
          acquireLocalService: api.runtime.llm?.acquireLocalService,
          openKeyedStore: <T>(options: OpenKeyedStoreOptions) =>
            api.runtime.state.openKeyedStore<T>(options),
        },
      );
    },
    {
      descriptors: [
        {
          name: "memory",
          description: "Search, inspect, and reindex memory files",
          hasSubcommands: true,
        },
      ],
    },
  );
}

export default definePluginEntry({
  id: "memory-core",
  name: "Omnipolymath Memory",
  description: "File-backed memory search tools and CLI",
  register(api) {
    registerMemoryCoreCli(api);
  },
});
