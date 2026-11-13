import { importFreshModule } from "omnipolymath/plugin-sdk/test-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";

type BrowserProfilesModule = typeof import("./browser-profiles.js");

describe("plugin-sdk browser profiles import", () => {
  afterEach(() => {
    vi.doUnmock("../infra/tmp-omnipolymath-dir.js");
    vi.resetModules();
  });

  it("keeps the SDK facade independent from secure temp resolution", async () => {
    const resolvePreferredOmnipolymathTmpDir = vi.fn(() => {
      throw new Error("secure temp resolution must stay lazy");
    });
    const loadTempResolver = vi.fn(() => ({ resolvePreferredOmnipolymathTmpDir }));
    vi.doMock("../infra/tmp-omnipolymath-dir.js", loadTempResolver);

    const browserProfiles = await importFreshModule<BrowserProfilesModule>(
      import.meta.url,
      "./browser-profiles.js?scope=browser-safe",
    );

    expect(loadTempResolver).not.toHaveBeenCalled();
    expect(resolvePreferredOmnipolymathTmpDir).not.toHaveBeenCalled();
    expect(browserProfiles.DEFAULT_UPLOAD_DIR).toBe("/tmp/omnipolymath/uploads");
  });
});
