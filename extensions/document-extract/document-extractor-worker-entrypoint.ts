import { createPluginRuntimeProcessEntrypoint } from "omnipolymath/plugin-sdk/process-runtime";

export const documentExtractorWorkerEntrypoint = createPluginRuntimeProcessEntrypoint(
  "documentExtractor",
  import.meta.url,
);
