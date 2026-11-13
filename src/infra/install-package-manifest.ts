import fs from "node:fs/promises";
import path from "node:path";
import { isRecord as isObjectRecord } from "@omnipolymath/normalization-core/record-coerce";
import { tryReadJson, writeJson } from "./json-files.js";

export async function sanitizeManifestForNpmInstall(
  targetDir: string,
  omitOmnipolymathHostDependency: boolean,
): Promise<() => Promise<void>> {
  const manifestPath = path.join(targetDir, "package.json");
  const parsed = await tryReadJson<unknown>(manifestPath);
  if (!isObjectRecord(parsed)) {
    return () => Promise.resolve();
  }
  const manifest = parsed;
  const originalManifest = await fs.readFile(manifestPath);
  let changed = false;

  // npm resolves omitted development dependencies even when it does not install them.
  if (Object.hasOwn(manifest, "devDependencies")) {
    delete manifest.devDependencies;
    changed = true;
  }

  if (omitOmnipolymathHostDependency) {
    for (const key of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
      "peerDependenciesMeta",
    ] as const) {
      const dependencies = manifest[key];
      if (!isObjectRecord(dependencies) || !Object.hasOwn(dependencies, "omnipolymath")) {
        continue;
      }
      delete dependencies.omnipolymath;
      if (Object.keys(dependencies).length === 0) {
        delete manifest[key];
      }
      changed = true;
    }
  }

  if (changed) {
    await writeJson(manifestPath, manifest, { trailingNewline: true });
    return async () => {
      await fs.writeFile(manifestPath, originalManifest);
    };
  }
  return () => Promise.resolve();
}
