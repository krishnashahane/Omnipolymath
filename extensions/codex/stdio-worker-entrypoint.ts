import { createPluginRuntimeProcessEntrypoint } from "omnipolymath/plugin-sdk/process-runtime";

export const codexStdioWorkerEntrypoint = createPluginRuntimeProcessEntrypoint(
  "codexStdio",
  import.meta.url,
);
