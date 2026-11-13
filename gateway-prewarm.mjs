import { flushCompileCache } from "node:module";
import { fileURLToPath } from "node:url";
import { resolveOmnipolymathCliRespawn } from "./cli-invocation.mjs";
import {
  enableOmnipolymathCompileCache,
  resolveOmnipolymathCompileCacheDirectory,
  resolveOmnipolymathCompileCacheRespawnEnv,
} from "./node-compile-cache.mjs";

const directory = resolveOmnipolymathCompileCacheDirectory({
  installRoot: fileURLToPath(new URL(".", import.meta.url)),
  prewarm: true,
});
const respawnEnv = resolveOmnipolymathCompileCacheRespawnEnv({ directory });
if (respawnEnv) {
  const { runRespawnedChild } = await import("./node-runtime-recovery.mjs");
  await runRespawnedChild(
    resolveOmnipolymathCliRespawn({
      entryPath: fileURLToPath(import.meta.url),
      execArgv: [],
      args: [],
      env: respawnEnv,
    }),
  );
} else if (directory) {
  enableOmnipolymathCompileCache({ directory });
  // Import only: do not start a Gateway or read its configuration/state.
  await import("./dist/gateway-prewarm.js");
  flushCompileCache();
}
