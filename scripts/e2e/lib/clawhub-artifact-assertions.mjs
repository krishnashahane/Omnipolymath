import fs from "node:fs";
import path from "node:path";
import { assertRealPathInside } from "./omnipolymath-state-paths.mjs";

export function assertClawHubExternalInstallContract(installPath, label) {
  const omnipolymathPeerPath = path.join(installPath, "node_modules", "omnipolymath");
  if (!fs.existsSync(omnipolymathPeerPath)) {
    throw new Error(`missing ${label} omnipolymath peer symlink: ${omnipolymathPeerPath}`);
  }
  if (!fs.lstatSync(omnipolymathPeerPath).isSymbolicLink()) {
    throw new Error(`${label} omnipolymath peer is not a symlink: ${omnipolymathPeerPath}`);
  }
  const hostRoot = fs.realpathSync(process.env.OMNIPOLYMATH_E2E_HOST_ROOT || process.cwd());
  const linkedHostRoot = fs.realpathSync(omnipolymathPeerPath);
  if (linkedHostRoot !== hostRoot) {
    throw new Error(`expected ${label} omnipolymath peer ${linkedHostRoot} to target ${hostRoot}`);
  }

  const dependencyPackagePath = path.join(installPath, "node_modules", "is-number", "package.json");
  if (fs.existsSync(dependencyPackagePath)) {
    assertRealPathInside(installPath, dependencyPackagePath, `${label} isolated dependency`);
  }
}

export function assertClawHubArtifactMetadata(record, messagePrefixes) {
  if (record.artifactKind === "legacy-zip") {
    if (record.artifactFormat !== "zip") {
      throw new Error(`${messagePrefixes.legacyZip}: ${JSON.stringify(record)}`);
    }
    return;
  }

  if (record.artifactKind !== "npm-pack" || record.artifactFormat !== "tgz") {
    throw new Error(`${messagePrefixes.artifact}: ${JSON.stringify(record)}`);
  }
  if (!record.clawpackSha256 || typeof record.clawpackSize !== "number") {
    throw new Error(`${messagePrefixes.clawpack}: ${JSON.stringify(record)}`);
  }
  if (!record.npmIntegrity || !record.npmShasum || !record.npmTarballName) {
    throw new Error(`${messagePrefixes.npm}: ${JSON.stringify(record)}`);
  }
}
