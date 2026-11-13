// Registry Jiti mock helpers install Vitest mocks for plugin registry import tests.
import { vi } from "vitest";
import "../../test-utils/prepare-compiled-subprocesses.js";

const registryJitiMocks = vi.hoisted(() => ({
  createJiti: vi.fn(),
  discoverConfiguredPluginLoadPaths: vi.fn(),
  discoverOmnipolymathPlugins: vi.fn(),
  loadPluginManifestRegistry: vi.fn(),
  loadPluginRegistrySnapshot: vi.fn(),
}));

vi.mock("../discovery.js", () => ({
  discoverConfiguredPluginLoadPaths: (
    ...args: Parameters<typeof registryJitiMocks.discoverConfiguredPluginLoadPaths>
  ) => registryJitiMocks.discoverConfiguredPluginLoadPaths(...args),
  discoverOmnipolymathPlugins: (
    ...args: Parameters<typeof registryJitiMocks.discoverOmnipolymathPlugins>
  ) => registryJitiMocks.discoverOmnipolymathPlugins(...args),
}));

vi.mock("../manifest-registry-build.js", () => ({
  loadBundledPluginManifestRegistry: (
    ...args: Parameters<typeof registryJitiMocks.loadPluginManifestRegistry>
  ) => registryJitiMocks.loadPluginManifestRegistry(...args),
}));
vi.mock("../manifest-registry.js", () => ({
  loadPluginManifestRegistryCore: (
    ...args: Parameters<typeof registryJitiMocks.loadPluginManifestRegistry>
  ) => registryJitiMocks.loadPluginManifestRegistry(...args),
}));

vi.mock("../manifest-registry-installed.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../manifest-registry-installed.js")>()),
  loadPluginManifestRegistryForInstalledIndex: (
    ...args: Parameters<typeof registryJitiMocks.loadPluginManifestRegistry>
  ) => registryJitiMocks.loadPluginManifestRegistry(...args),
}));

vi.mock("../plugin-registry.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../plugin-registry.js")>();
  return {
    ...actual,
    loadPluginRegistrySnapshot: (
      ...args: Parameters<typeof registryJitiMocks.loadPluginRegistrySnapshot>
    ) => registryJitiMocks.loadPluginRegistrySnapshot(...args),
    loadPluginRegistrySnapshotWithMetadata: (
      ...args: Parameters<typeof registryJitiMocks.loadPluginRegistrySnapshot>
    ) => ({ snapshot: registryJitiMocks.loadPluginRegistrySnapshot(...args) }),
    loadPluginManifestRegistryForPluginRegistry: (
      ...args: Parameters<typeof registryJitiMocks.loadPluginManifestRegistry>
    ) => registryJitiMocks.loadPluginManifestRegistry(...args),
  };
});
export function resetRegistryJitiMocks(): void {
  registryJitiMocks.createJiti.mockReset();
  registryJitiMocks.discoverConfiguredPluginLoadPaths.mockReset();
  registryJitiMocks.discoverOmnipolymathPlugins.mockReset();
  registryJitiMocks.loadPluginManifestRegistry.mockReset();
  registryJitiMocks.loadPluginRegistrySnapshot.mockReset();
  registryJitiMocks.discoverOmnipolymathPlugins.mockReturnValue({
    candidates: [],
    diagnostics: [],
  });
  registryJitiMocks.discoverConfiguredPluginLoadPaths.mockReturnValue({
    candidates: [],
    diagnostics: [],
  });
  registryJitiMocks.loadPluginRegistrySnapshot.mockReturnValue({
    diagnostics: [],
    plugins: [],
  });
  registryJitiMocks.createJiti.mockImplementation(
    (_modulePath: string, _options?: Record<string, unknown>) => () => ({ default: {} }),
  );
}

export function getRegistryJitiMocks() {
  return registryJitiMocks;
}
