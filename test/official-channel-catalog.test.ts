import path from "node:path";
import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { buildOfficialChannelCatalog } from "../scripts/write-official-channel-catalog.mts";
import { normalizeClawHubSha256Integrity } from "../src/infra/clawhub-integrity.js";
import { describePluginInstallSource } from "../src/plugins/install-source-info.js";
import { cleanupTempDirs, makeTempDir as makeTempRepoRoot } from "./helpers/temp-dir.js";
import { writeJsonFile } from "./helpers/temp-repo.js";

const tempDirs: string[] = [];
let repoRoot: string;
beforeEach(() => {
  repoRoot = makeTempRepoRoot(tempDirs, "omnipolymath-channel-catalog-");
});

type OfficialChannelCatalogEntry = ReturnType<
  typeof buildOfficialChannelCatalog
>["entries"][number];
type OfficialChannelInstall = OfficialChannelCatalogEntry["omnipolymath"]["install"];

function writeChannelPackage(directory: string, install: OfficialChannelInstall) {
  writeJsonFile(path.join(repoRoot, "extensions", directory, "package.json"), {
    name: `@omnipolymath/${directory}`,
    omnipolymath: {
      channel: { id: directory },
      install,
      release: { publishToNpm: true },
    },
  });
  const entry = buildOfficialChannelCatalog({ repoRoot }).entries.find(
    (candidate) => candidate.omnipolymath.channel.id === directory,
  );
  assert(entry, "expected official channel catalog entry");
  return entry;
}

afterEach(() => cleanupTempDirs(tempDirs));

describe("buildOfficialChannelCatalog", () => {
  it("keeps third-party official external catalog install sources pinned", () => {
    const entries = buildOfficialChannelCatalog({ repoRoot }).entries.filter(
      (entry) => entry.source === "external" && !entry.name?.startsWith("@omnipolymath/"),
    );

    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const install = entry.omnipolymath.install;
      const installSource = describePluginInstallSource(install);
      expect(installSource.warnings).toStrictEqual([]);
      if (install.npmSpec) {
        expect(installSource.npm?.pinState).toBe("exact-with-integrity");
      } else {
        expect(installSource.npm).toBeUndefined();
        expect(installSource.clawhub?.exactVersion).toBe(true);
        expect(normalizeClawHubSha256Integrity(install.expectedIntegrity ?? "")).not.toBeNull();
      }
    }
  });

  it("allows official Omnipolymath channel npm specs without integrity during launch", () => {
    const twitch = writeChannelPackage("twitch", {
      npmSpec: "@omnipolymath/twitch",
      defaultChoice: "npm",
      minHostVersion: ">=2026.4.10",
    });

    expect(twitch?.name).toBe("@omnipolymath/twitch");
    expect(twitch?.omnipolymath.install).toEqual({
      npmSpec: "@omnipolymath/twitch",
      defaultChoice: "npm",
      minHostVersion: ">=2026.4.10",
    });
    expect(describePluginInstallSource(twitch.omnipolymath.install)).toMatchObject({
      npm: { pinState: "floating-without-integrity" },
      warnings: ["npm-spec-floating", "npm-spec-missing-integrity"],
    });
  });

  it("preserves ClawHub specs when generating publishable channel catalog entries", () => {
    const entry = writeChannelPackage("storepack-chat", {
      clawhubSpec: "clawhub:@omnipolymath/storepack-chat",
      npmSpec: "@omnipolymath/storepack-chat",
      defaultChoice: "clawhub",
    });

    expect(entry.omnipolymath.install).toEqual({
      clawhubSpec: "clawhub:@omnipolymath/storepack-chat",
      npmSpec: "@omnipolymath/storepack-chat",
      defaultChoice: "clawhub",
    });
  });
});
