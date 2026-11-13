import actualFs from "node:fs";
import actualFsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";

const VITEST_FS_BASE = path.join(path.parse(process.cwd()).root, "__omnipolymath_vitest__");
const FIXTURE_BASE = path.join(VITEST_FS_BASE, "omnipolymath-root");

const state = vi.hoisted(() => ({
  entries: new Map<string, string>(),
  realpaths: new Map<string, string>(),
  realpathErrors: new Set<string>(),
}));

const abs = (p: string) => path.resolve(p);
const fx = (...parts: string[]) => path.join(FIXTURE_BASE, ...parts);
const vitestRootWithSep = `${abs(VITEST_FS_BASE)}${path.sep}`;
const isFixturePath = (p: string) => {
  const resolved = abs(p);
  return resolved === vitestRootWithSep.slice(0, -1) || resolved.startsWith(vitestRootWithSep);
};

function setPackageRoot(root: string, name = "omnipolymath") {
  state.entries.set(abs(path.join(root, "package.json")), JSON.stringify({ name }));
  return root;
}

const mockFsModule = () => ({
  ...actualFs,
  readFileSync: (p: string, encoding?: BufferEncoding) => {
    if (!isFixturePath(p)) {
      return actualFs.readFileSync(p, { encoding });
    }
    const content = readFixture(p);
    return encoding ? content : Buffer.from(content, "utf-8");
  },
  realpathSync: (p: string) => {
    if (!isFixturePath(p)) {
      return actualFs.realpathSync(p);
    }
    const resolved = abs(p);
    if (state.realpathErrors.has(resolved)) {
      throw new Error(`ENOENT: no such file or directory, realpath '${p}'`);
    }
    return state.realpaths.get(resolved) ?? resolved;
  },
});

const mockFsPromisesModule = () => ({
  ...actualFsPromises,
  readFile: async (p: string, options?: Parameters<typeof actualFsPromises.readFile>[1]) => {
    if (!isFixturePath(p)) {
      return await actualFsPromises.readFile(p, options ?? null);
    }
    return readFixture(p);
  },
});

function readFixture(p: string) {
  const content = state.entries.get(abs(p));
  if (content === undefined) {
    throw new Error(`ENOENT: no such file, open '${p}'`);
  }
  return content;
}

vi.mock("./omnipolymath-root.fs.runtime.js", () => ({
  omnipolymathRootFsSync: mockFsModule(),
  omnipolymathRootFs: mockFsPromisesModule(),
}));

describe("resolveOmnipolymathPackageRoot", () => {
  let resolveOmnipolymathPackageRoot: typeof import("./omnipolymath-root.js").resolveOmnipolymathPackageRoot;
  let resolveOmnipolymathPackageRootSync: typeof import("./omnipolymath-root.js").resolveOmnipolymathPackageRootSync;

  beforeAll(async () => {
    ({ resolveOmnipolymathPackageRoot, resolveOmnipolymathPackageRootSync } =
      await import("./omnipolymath-root.js"));
  });

  function binScenario(name: string, target?: string | false) {
    const project = fx(name);
    const argv1 = path.join(project, "node_modules", ".bin", "omnipolymath");
    const expected = path.join(project, "node_modules", "omnipolymath");
    setPackageRoot(expected);
    if (target === false) {
      state.realpathErrors.add(abs(argv1));
    } else if (target) {
      state.realpaths.set(abs(argv1), path.join(project, target, "omnipolymath.mjs"));
    }
    return { opts: { argv1 }, expected };
  }

  function cwdScenario(name: string, moduleUrl?: string, packageName = "omnipolymath") {
    const cwd = fx(name);
    setPackageRoot(cwd, packageName);
    return { opts: { cwd, moduleUrl }, expected: packageName === "omnipolymath" ? cwd : null };
  }

  function linkedScenario(name: string, nested = false) {
    const project = fx(name);
    const bin = path.join(project, nested ? ".artifacts/prefix/bin" : "bin", "omnipolymath");
    const expected = setPackageRoot(
      path.join(project, nested ? ".artifacts/prefix/lib/node_modules/omnipolymath" : "real-pkg"),
    );
    if (nested) {
      setPackageRoot(project);
    }
    state.realpaths.set(abs(bin), abs(path.join(expected, "omnipolymath.mjs")));
    return { opts: { argv1: bin }, expected };
  }

  function moduleScenario(fallthrough = false) {
    const root = fx(fallthrough ? "moduleurl-fallthrough" : "moduleurl");
    const moduleRoot = setPackageRoot(
      fallthrough ? path.join(root, "wrong") : root,
      fallthrough ? "not-omnipolymath" : "omnipolymath",
    );
    const cwd = fallthrough ? setPackageRoot(path.join(root, "cwd")) : undefined;
    return {
      opts: { moduleUrl: pathToFileURL(path.join(moduleRoot, "dist/index.js")).href, cwd },
      expected: cwd ?? moduleRoot,
    };
  }

  it.each([
    ["resolves package root from .bin argv1", () => binScenario("bin-scenario")],
    ["resolves package root via symlinked argv1", () => linkedScenario("symlink-scenario")],
    [
      "prefers a symlink target nested under another omnipolymath package",
      () => linkedScenario("nested-symlink-scenario", true),
    ],
    ["falls back when argv1 realpath throws", () => binScenario("realpath-throw-scenario", false)],
    ["prefers moduleUrl candidates", () => moduleScenario()],
    ["falls through from a non-omnipolymath moduleUrl candidate to cwd", () => moduleScenario(true)],
    [
      "ignores invalid moduleUrl values and falls back to cwd",
      () => cwdScenario("invalid-moduleurl", "not-a-file-url"),
    ],
    [
      "returns null for non-omnipolymath package roots",
      () => cwdScenario("not-omnipolymath", undefined, "not-omnipolymath"),
    ],
    [
      "falls back from a symlinked argv1 to the node_modules package root",
      () => binScenario("symlink-node-modules-fallback", "versions/current"),
    ],
    [
      "does not cross a node_modules boundary into an enclosing checkout",
      () => {
        const outerCheckout = fx("nested-worktree-outer");
        setPackageRoot(outerCheckout);
        setPackageRoot(path.join(outerCheckout, "node_modules", "vitest"), "vitest");
        const argv1 = path.join(outerCheckout, "node_modules/vitest/dist/workers/threads.js");
        return { opts: { argv1 }, expected: null };
      },
    ],
    [
      "still resolves the omnipolymath package below a node_modules boundary",
      () => {
        const project = fx("installed-below-boundary");
        setPackageRoot(project);
        const pkgRoot = path.join(project, "node_modules", "omnipolymath");
        setPackageRoot(pkgRoot);
        return { opts: { argv1: path.join(pkgRoot, "dist", "entry.js") }, expected: pkgRoot };
      },
    ],
    [
      "returns null when no package roots exist",
      () => ({
        opts: { cwd: fx("missing") },
        expected: null,
      }),
    ],
  ] as const)("%s", async (_name, setup) => {
    const { opts, expected } = setup();
    expect(resolveOmnipolymathPackageRootSync(opts)).toBe(expected);
    await expect(resolveOmnipolymathPackageRoot(opts)).resolves.toBe(expected);
  });
});
