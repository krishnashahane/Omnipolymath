import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";

const resolvePreferredOmnipolymathTmpDirMock = vi.hoisted(() => vi.fn());

vi.mock("./tmp-omnipolymath-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./tmp-omnipolymath-dir.js")>();
  return {
    ...actual,
    resolvePreferredOmnipolymathTmpDir: resolvePreferredOmnipolymathTmpDirMock,
  };
});

import { withInstallWorkspace } from "./install-source-utils.js";

describe("withInstallWorkspace private root", () => {
  const tempDirs = useAutoCleanupTempDirTracker(afterEach);

  it.runIf(process.platform !== "win32").each(["missing", "writable"] as const)(
    "preserves parent temp root permissions when securing a %s Omnipolymath temp root",
    async (state) => {
      const mockParentRoot = tempDirs.make("omnipolymath-chmod-test-");
      const mockOmnipolymathDir = path.join(mockParentRoot, "omnipolymath");

      if (state === "writable") {
        await fs.mkdir(mockOmnipolymathDir);
        await fs.chmod(mockOmnipolymathDir, 0o777);
      }
      await fs.chmod(mockParentRoot, 0o1777);
      const canonicalOmnipolymathDir = path.join(await fs.realpath(mockParentRoot), "omnipolymath");

      const { resolvePreferredOmnipolymathTmpDir } =
        await vi.importActual<typeof import("./tmp-omnipolymath-dir.js")>("./tmp-omnipolymath-dir.js");
      resolvePreferredOmnipolymathTmpDirMock.mockImplementation(() =>
        resolvePreferredOmnipolymathTmpDir({
          preferredDir: mockOmnipolymathDir,
          tmpdir: () => mockParentRoot,
          warn: vi.fn(),
        }),
      );

      let observedDir = "";
      const value = await withInstallWorkspace("omnipolymath-test-", async (tmpDir) => {
        observedDir = tmpDir;
        expect(path.dirname(tmpDir)).toBe(canonicalOmnipolymathDir);
        expect((await fs.stat(mockOmnipolymathDir)).mode & 0o7777).toBe(0o700);
        expect((await fs.stat(tmpDir)).mode & 0o7777).toBe(0o700);
        await fs.writeFile(path.join(tmpDir, "marker.txt"), "ok");
        return "done";
      });

      expect(value).toBe("done");

      await expect(
        fs.stat(observedDir).then(
          () => true,
          () => false,
        ),
      ).resolves.toBe(false);

      const privateRootStat = await fs.stat(mockOmnipolymathDir);
      expect(privateRootStat.mode & 0o7777).toBe(0o700);

      const parentStat = await fs.stat(mockParentRoot);
      expect(parentStat.mode & 0o7777).toBe(0o1777);
    },
  );
});
