import path from "node:path";
import { pathToFileURL } from "node:url";

export function createQaPreparedRepoCliCommand(repoRoot: string) {
  return {
    executablePath: process.execPath,
    argsPrefix: [
      "--import",
      pathToFileURL(path.join(repoRoot, "scripts/tsx.mjs")).href,
      path.join(repoRoot, "scripts/run-with-env.mts"),
      `OMNIPOLYMATH_DEV_SOURCE_ROOT=${repoRoot}`,
      "--",
      process.execPath,
      path.join(repoRoot, "omnipolymath.mjs"),
    ],
    cwd: repoRoot,
    usePackagedPlugins: true,
  };
}
