// Run from the repository root with: node --import ./scripts/tsx.mjs test/helpers/run-quiet-steering-live.mts
// Isolate the launch source BEFORE LIVE=1: live-aware test setup otherwise stages real-home auth.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { listDirectoryTreeStrictSync } from "../../src/infra/directory-walk.js";
import { listKnownProviderAuthEnvVarNamesCore } from "../../src/secrets/provider-env-vars.js";

if (!process.env.OPENAI_API_KEY?.trim()) {
  throw new Error("OPENAI_API_KEY is required");
}
const scratch = path.resolve(".omnipolymath/tmp");
fs.mkdirSync(scratch, { recursive: true });
const root = fs.mkdtempSync(path.join(scratch, "quiet-launch-"));
const home = path.join(root, "source-home");
const temp = path.join(root, "tmp");
fs.mkdirSync(home);
fs.mkdirSync(temp);
const env = { ...process.env };
for (const name of listKnownProviderAuthEnvVarNamesCore()) {
  if (name !== "OPENAI_API_KEY") {
    delete env[name];
  }
}
for (const name of [
  "OPENAI_BASE_URL",
  "OPENAI_API_BASE",
  "OMNIPOLYMATH_TEST_HOME",
  "OMNIPOLYMATH_LIVE_USE_REAL_HOME",
  "OMNIPOLYMATH_AGENT_DIR",
  "OMNIPOLYMATH_BUNDLED_PLUGINS_DIR",
  "OMNIPOLYMATH_TEST_TRUST_BUNDLED_PLUGINS_DIR",
  "OMNIPOLYMATH_GATEWAY_TOKEN",
  "OMNIPOLYMATH_GATEWAY_PASSWORD",
  "OMNIPOLYMATH_GATEWAY_PORT",
  "OMNIPOLYMATH_GATEWAY_URL",
]) {
  delete env[name];
}
Object.assign(env, {
  HOME: home,
  USERPROFILE: home,
  OMNIPOLYMATH_HOME: home,
  OMNIPOLYMATH_STATE_DIR: path.join(home, ".omnipolymath"),
  OMNIPOLYMATH_CONFIG_PATH: path.join(home, ".omnipolymath/omnipolymath.json"),
  XDG_CONFIG_HOME: path.join(home, ".config"),
  XDG_DATA_HOME: path.join(home, ".local/share"),
  XDG_STATE_HOME: path.join(home, ".local/state"),
  XDG_CACHE_HOME: path.join(home, ".cache"),
  TMPDIR: temp,
  TMP: temp,
  TEMP: temp,
  OMNIPOLYMATH_VITEST_FS_MODULE_CACHE_PATH: path.join(root, "module-cache"),
  NO_PROXY: [env.NO_PROXY, "127.0.0.1", "localhost", "::1"].filter(Boolean).join(","),
  no_proxy: [env.no_proxy, "127.0.0.1", "localhost", "::1"].filter(Boolean).join(","),
  LIVE: "1",
  OMNIPOLYMATH_LIVE_TEST_QUIET: "1",
});
// Preserve exec attribution and enforced proxy/broker environment; never copy auth files.
console.error(
  "[quiet-live-launch] empty launch HOME/config/state; authorized OpenAI env credential only; attribution retained",
);
try {
  const result = spawnSync(
    process.execPath,
    [
      "scripts/run-vitest.mjs",
      "--config",
      "test/vitest/vitest.live.config.ts",
      "src/gateway/gateway-quiet-steering-authority.live.test.ts",
      "--maxWorkers=1",
    ],
    { env, stdio: "inherit" },
  );
  if (result.error) {
    throw result.error;
  }
  process.exitCode = result.status ?? 1;
} finally {
  const staged = listDirectoryTreeStrictSync(home).filter((entry) =>
    /auth-profiles|credentials|oauth|[.]claude|[.]codex/.test(entry.relativePath),
  );
  console.error("[quiet-live-launch] launch-source credential files=" + staged.length);
  if (staged.length) {
    process.exitCode = 1;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
