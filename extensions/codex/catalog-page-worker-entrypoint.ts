import { createPluginRuntimeProcessEntrypoint } from "omnipolymath/plugin-sdk/process-runtime";

export const codexCatalogPageWorkerEntrypoint = createPluginRuntimeProcessEntrypoint(
  "codexCatalogPage",
  import.meta.url,
);
