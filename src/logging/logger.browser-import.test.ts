// Logger browser import tests cover safe import behavior in browser-like runtimes.
import path from "node:path";
import { importFreshModule } from "omnipolymath/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

type LoggerModule = typeof import("./logger.js");

const originalGetBuiltinModule = (
  process as NodeJS.Process & { getBuiltinModule?: (id: string) => unknown }
).getBuiltinModule;

async function importLoggerWithMockedTempResolver(params?: {
  nodeFsAvailable?: boolean;
  resolvePreferredOmnipolymathTmpDir?: ReturnType<typeof vi.fn>;
}): Promise<{
  module: LoggerModule;
  resolvePreferredOmnipolymathTmpDir: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const resolvePreferredOmnipolymathTmpDir =
    params?.resolvePreferredOmnipolymathTmpDir ??
    vi.fn(() => {
      throw new Error("resolvePreferredOmnipolymathTmpDir should not run during browser-safe import");
    });

  vi.doMock("../infra/tmp-omnipolymath-dir.js", async () => {
    const actual = await vi.importActual<typeof import("../infra/tmp-omnipolymath-dir.js")>(
      "../infra/tmp-omnipolymath-dir.js",
    );
    return {
      ...actual,
      resolvePreferredOmnipolymathTmpDir,
    };
  });

  Object.defineProperty(process, "getBuiltinModule", {
    configurable: true,
    value: params?.nodeFsAvailable ? (id: string) => (id === "fs" ? {} : undefined) : undefined,
  });

  const module = await importFreshModule<LoggerModule>(
    import.meta.url,
    `./logger.js?scope=${params?.nodeFsAvailable ? "node-safe" : "browser-safe"}`,
  );
  return { module, resolvePreferredOmnipolymathTmpDir };
}

describe("logging/logger import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-omnipolymath-dir.js");
    Object.defineProperty(process, "getBuiltinModule", {
      configurable: true,
      value: originalGetBuiltinModule,
    });
  });

  it("defers node temp resolution until active logger settings are requested", async () => {
    const secureLogDir = path.join(process.cwd(), "secure-omnipolymath-temp");
    const resolvePreferredOmnipolymathTmpDir = vi.fn(() => secureLogDir);
    const { module } = await importLoggerWithMockedTempResolver({
      nodeFsAvailable: true,
      resolvePreferredOmnipolymathTmpDir,
    });

    expect(resolvePreferredOmnipolymathTmpDir).not.toHaveBeenCalled();

    module.applyLoggingConfig(undefined);
    try {
      expect(path.dirname(module.getResolvedLoggerSettings().file)).toBe(secureLogDir);
      expect(resolvePreferredOmnipolymathTmpDir).toHaveBeenCalledOnce();
    } finally {
      module.resetLogger();
    }
  });

  it("disables file logging when imported in a browser-like environment", async () => {
    const { module, resolvePreferredOmnipolymathTmpDir } = await importLoggerWithMockedTempResolver();

    expect(module.getResolvedLoggerSettings()).toStrictEqual({
      level: "silent",
      file: "/tmp/omnipolymath/omnipolymath.log",
      maxFileBytes: 100 * 1024 * 1024,
    });
    expect(module.isFileLogLevelEnabled("info")).toBe(false);
    expect(module.getLogger().info("browser-safe")).toBeUndefined();
    expect(resolvePreferredOmnipolymathTmpDir).not.toHaveBeenCalled();
  });
});
