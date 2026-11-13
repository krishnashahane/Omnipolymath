import fs from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  loadAuthProfileStoreWithoutExternalProfiles,
  saveAuthProfileStore,
} from "omnipolymath/plugin-sdk/agent-runtime";
import {
  closeOmnipolymathAgentDatabasesAsync,
  closeOmnipolymathStateDatabaseAsync,
  openOmnipolymathStateDatabase,
} from "omnipolymath/plugin-sdk/sqlite-runtime-testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTempDirHarness } from "../../temp-dir.test-helper.js";
import { readQaAuthProfiles, writeQaAuthProfiles } from "./auth-store.js";
import { stageQaMockAuthProfiles } from "./mock-auth.js";

const tempDirs = createTempDirHarness();
const apiKey = (provider = "openai") => ({ type: "api_key" as const, provider, key: "qa-fake" });

async function writeUnreadableDatabase(databasePath: string, kind: "future" | "invalid") {
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  if (kind === "future") {
    const database = new DatabaseSync(databasePath);
    database.exec("PRAGMA user_version = 999");
    database.close();
  } else {
    await fs.writeFile(databasePath, "not a SQLite database");
  }
}

let root: string;
let agentDir: string;
beforeEach(async () => {
  root = await tempDirs.makeTempDir("omnipolymath-qa-auth-store-");
  agentDir = path.join(root, "agents", "main", "agent");
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", root);
});
const write = (
  profiles: Parameters<typeof writeQaAuthProfiles>[0]["profiles"] = { "qa-mock-openai": apiKey() },
  replace = false,
) => writeQaAuthProfiles({ agentId: "main", stateDir: root, profiles, replace });

afterEach(async () => {
  await closeOmnipolymathAgentDatabasesAsync();
  await closeOmnipolymathStateDatabaseAsync();
  vi.unstubAllEnvs();
  await tempDirs.cleanup();
});

it.each(["old", "future", "invalid"] as const)("isolates %s host state", async (kind) => {
  const hostStateDir = await tempDirs.makeTempDir("omnipolymath-qa-auth-unreadable-host-");
  const hostDatabasePath = path.join(hostStateDir, "state", "omnipolymath.sqlite");
  if (kind === "old") {
    openOmnipolymathStateDatabase({ env: { ...process.env, OMNIPOLYMATH_STATE_DIR: hostStateDir } });
    await closeOmnipolymathStateDatabaseAsync();
    const database = new DatabaseSync(hostDatabasePath);
    database.exec(
      "PRAGMA user_version = 6; UPDATE schema_meta SET schema_version = 6 WHERE meta_key = 'primary'",
    );
    database.close();
  } else {
    await writeUnreadableDatabase(hostDatabasePath, kind);
  }
  const hostBefore = await fs.readFile(hostDatabasePath);
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", hostStateDir);
  vi.stubEnv("OMNIPOLYMATH_AGENT_DIR", path.join(hostStateDir, "relocated-agent"));
  const staged = await Promise.all(
    ["openai", "anthropic"].map(async (provider) => {
      const stateDir = await tempDirs.makeTempDir("omnipolymath-qa-auth-concurrent-");
      const config = await stageQaMockAuthProfiles({
        cfg: {},
        agentIds: ["qa"],
        stateDir,
        providers: [provider],
      });
      return { stateDir, provider, config };
    }),
  );
  for (const { stateDir, provider, config } of staged) {
    const store = await readQaAuthProfiles(path.join(stateDir, "agents", "qa", "agent"));
    expect(Object.keys(store.profiles)).toEqual([`qa-mock-${provider}`]);
    expect(config.auth).toEqual({
      profiles: {
        [`qa-mock-${provider}`]: {
          provider,
          mode: "api_key",
          displayName: `QA mock ${provider} credential`,
        },
      },
    });
  }
  await closeOmnipolymathAgentDatabasesAsync();
  await closeOmnipolymathStateDatabaseAsync();
  expect(await fs.readFile(hostDatabasePath)).toEqual(hostBefore);
  expect(process.env.OMNIPOLYMATH_STATE_DIR).toBe(hostStateDir);
  expect(process.env.OMNIPOLYMATH_AGENT_DIR).toBe(path.join(hostStateDir, "relocated-agent"));
});

it.each(["future", "invalid", "legacy"] as const)("refuses a %s auth source", async (kind) => {
  const sourcePath = path.join(
    agentDir,
    kind === "legacy" ? "auth-profiles.json" : "omnipolymath-agent.sqlite",
  );
  if (kind === "legacy") {
    await fs.mkdir(agentDir, { recursive: true });
    await fs.writeFile(sourcePath, "{not-json");
  } else {
    await writeUnreadableDatabase(sourcePath, kind);
  }
  const before = await fs.readFile(sourcePath);
  await expect(write()).rejects.toThrow(
    kind === "legacy" ? "requires legacy credential migration" : "unreadable",
  );
  expect(await fs.readFile(sourcePath)).toEqual(before);
});

it("merges canonical credentials, then replaces profiles and clears stale metadata", async () => {
  const profiles = {
    existing: {
      type: "api_key",
      provider: "openai",
      keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    },
    tokenProfile: {
      type: "token",
      provider: "github",
      tokenRef: { source: "file", provider: "vault", id: "github/token" },
    },
    oauthProfile: {
      type: "oauth",
      provider: "chatgpt",
      access: "qa-access-token",
      refresh: "qa-refresh-token",
      expires: 1_900_000_000_000,
    },
  } satisfies Parameters<typeof writeQaAuthProfiles>[0]["profiles"];
  saveAuthProfileStore(
    {
      version: 1,
      profiles,
      order: { openai: ["existing"] },
      lastGood: { openai: "existing" },
      usageStats: { existing: { cooldownUntil: Date.now() + 60_000 } },
    },
    agentDir,
    { filterExternalAuthProfiles: false, syncExternalCli: false },
  );
  const added = { "qa-mock-anthropic": apiKey("anthropic") };
  await write(added);
  expect((await readQaAuthProfiles(agentDir)).profiles).toEqual({ ...profiles, ...added });
  await expect(fs.stat(path.join(agentDir, "auth-profiles.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await write({ current: apiKey("anthropic") }, true);
  const replaced = loadAuthProfileStoreWithoutExternalProfiles(agentDir, {
    inheritedAuthDir: agentDir,
  });
  expect(replaced.profiles).toEqual({ current: apiKey("anthropic") });
  expect(replaced.order).toBeUndefined();
  expect(replaced.lastGood).toBeUndefined();
  expect(replaced.usageStats).toBeUndefined();
});
