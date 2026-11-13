import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTestDir } from "../test-helpers/temp-dir.js";
import { swapStagedPackageInstall } from "./package-update-swap.js";
import { createNativePackageSwapFixture } from "./package-update-swap.test-support.js";

describe("native launcher publication", () => {
  it.each([false, true])(
    "commits with an actionable warning only for missing launcher targets (missing=%s)",
    async (missing) => {
      await withTestDir({ prefix: "native-launcher-publication-" }, async (base) => {
        const { params, native, packageRoot, candidate, binDir } =
          await createNativePackageSwapFixture(base);
        const entry = path.join(candidate, "omnipolymath.mjs");
        await fs.writeFile(entry, 'console.log("candidate");\n');
        const target = path.relative(
          native.binDir,
          missing ? path.join(base, ".omnipolymath-update-native-removed", "omnipolymath.mjs") : entry,
        );
        // All published formats must inspect the executable path, even with correct metadata.
        for (const [name, content] of [
          ["omnipolymath", `exec node "$basedir_abs/${target}" "$@"`],
          ["omnipolymath.cmd", `"node" "%~dp0\\${target.replaceAll("/", "\\")}" %*`],
          ["omnipolymath.ps1", `& "node" "$basedir/${target}" $args`],
        ]) {
          await fs.writeFile(
            path.join(native.binDir, name!),
            `${content}\n# cmd-shim-target=${entry}\n`,
          );
        }
        const result = await swapStagedPackageInstall(params);
        expect(result).toMatchObject({ status: "committed", step: { exitCode: 0 } });
        if (missing) {
          expect(result.step.warnings).toHaveLength(3);
          for (const name of ["omnipolymath", "omnipolymath.cmd", "omnipolymath.ps1"]) {
            expect(result.step.warnings).toContainEqual(
              expect.stringContaining(path.join(binDir, name)),
            );
          }
          expect(result.step.advisory).toMatchObject({
            kind: "recoverable-maintenance",
            message: expect.stringContaining("Reinstall the current omnipolymath version with pnpm"),
          });
        } else {
          expect(result.step.warnings).toBeUndefined();
        }
        expect(await fs.readFile(path.join(packageRoot, "omnipolymath.mjs"), "utf8")).toContain(
          "candidate",
        );
      });
    },
  );
});
