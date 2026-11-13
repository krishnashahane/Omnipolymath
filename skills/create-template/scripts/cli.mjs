#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const omnipolymath = fileURLToPath(new URL("../../../omnipolymath.mjs", import.meta.url));
const result = spawnSync(process.execPath, [omnipolymath, ...process.argv.slice(2)], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`Unable to run the bundled Omnipolymath CLI: ${result.error.message}\n`);
}
process.exit(result.status ?? 1);
