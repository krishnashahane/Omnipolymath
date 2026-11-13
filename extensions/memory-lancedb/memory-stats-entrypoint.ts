import { createPluginRuntimeProcessEntrypoint } from "omnipolymath/plugin-sdk/process-runtime";

export const memoryStatsRuntimeEntrypoint = createPluginRuntimeProcessEntrypoint(
  "memoryStatsRuntime",
  import.meta.url,
);
