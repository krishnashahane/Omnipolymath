import { createPluginRuntimeProcessEntrypoint } from "omnipolymath/plugin-sdk/process-runtime";

export const codexHistoryWorkerEntrypoint = createPluginRuntimeProcessEntrypoint(
  "codexSessionHistory",
  import.meta.url,
);
