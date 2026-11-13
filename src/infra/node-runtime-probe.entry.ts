import process from "node:process";
import { isSupportedOmnipolymathNodeVersion } from "../../node-version.mjs";

const requiredFlag = process.argv[2];
process.stdout.write(
  !process.versions.bun &&
    isSupportedOmnipolymathNodeVersion(process.versions.node) &&
    (!requiredFlag || process.allowedNodeEnvironmentFlags.has(requiredFlag))
    ? process.execPath
    : "",
);
