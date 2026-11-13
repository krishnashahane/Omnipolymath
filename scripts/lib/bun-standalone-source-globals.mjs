/** Type-only runtime bridge for original TypeScript compiled into the standalone image. */
export function createStandaloneSourceGlobals() {
  return `import type { Dirent, PathLike, Stats } from "node:fs";
import type { createRequire } from "node:module";

type StandaloneImageScope = {
  rootDir: string;
  relativePath: string;
  rootRealPath?: string;
};
type StandaloneImageEntry = {
  ok: true;
  path: string;
  rootRealPath: string;
  exists: true;
};
type StandaloneImageFile = {
  ok: true;
  path: string;
  rootRealPath: string;
  contents: Buffer;
  hash: string;
  signature: { size: number; mtimeMs: number; ctimeMs: number };
};
type StandaloneFileScope = {
  rootPath: string;
  rootRealPath?: string;
} & ({ filePath: string; absolutePath?: string } | { absolutePath: string; filePath?: string });
type StandaloneOperationArtifact = {
  rootDir: string;
  hasSource(source: string): boolean;
  resolve(source: string, rejectHardlinks?: boolean): string;
  prepareModule(filename: string): string[];
  linkHost(hostRoot: string): void;
  dispose(): void;
  disposeAsync(): Promise<void>;
};
type StandaloneNativeRequire = {
  (parent: string, specifier: string): unknown;
  resolve(parent: string, ...args: Parameters<NodeJS.RequireResolve>): string;
};

declare global {
  var __omnipolymathStandaloneRootUrl: string;
  var __omnipolymathStandaloneUnrenderedModuleUrl: (marker: string) => string;
  var __omnipolymathStandaloneExternalModulePath: (pathname: string) => string | undefined;
  var __omnipolymathStandaloneExternalModuleResolution: (pathname: string) => { path: string; namespace: string };
  var __omnipolymathStandaloneEmbeddedPath: (pathname: string) => string | undefined;
  var __omnipolymathStandaloneOriginalPath: (filename: string) => string;
  var __omnipolymathStandaloneResolve: (parent: string, specifier: string, from?: string) => string;
  var __omnipolymathStandaloneImport: <T>(
    parent: string,
    specifier: string,
    options: ImportCallOptions | undefined,
    original: () => Promise<T>,
  ) => Promise<T>;
  var __omnipolymathStandaloneCreateRequire: (
    create: typeof createRequire,
    ...args: Parameters<typeof createRequire>
  ) => ReturnType<typeof createRequire>;
  var __omnipolymathStandaloneNativePath: (relative: string) => string;
  var __omnipolymathStandaloneNativeResolve: (parent: string, specifier: unknown) => string | undefined;
  var __omnipolymathStandaloneNativeResolvePaths: (parent: string, specifier: unknown) => string[] | undefined;
  var __omnipolymathStandaloneNativeRequire: StandaloneNativeRequire;

  var __omnipolymathStandaloneImageStat: (filename: PathLike, lstat?: boolean) => Stats | undefined;
  var __omnipolymathStandaloneImageLstat: (filename: PathLike) => Stats | undefined;
  var __omnipolymathStandaloneImageExists: (filename: PathLike) => boolean | undefined;
  var __omnipolymathStandaloneImageRealpath: (filename: PathLike) => string | undefined;
  var __omnipolymathStandaloneImageDirectory: (directory: string, read: () => Dirent[]) => Dirent[];
  var __omnipolymathStandaloneImageCheck: <T extends StandaloneImageScope>(params: T) => StandaloneImageEntry | undefined;
  var __omnipolymathStandaloneImageRead: <T extends StandaloneImageScope>(params: T) => StandaloneImageFile | undefined;
  var __omnipolymathStandaloneModuleOpen: <T extends StandaloneFileScope>(params: T) => StandaloneImageEntry | undefined;
  var __omnipolymathStandaloneHookEntry: <T extends { rootPath: string; absolutePath: string; source: string }>(params: T) => { ok: true; path: string } | undefined;
  var __omnipolymathStandaloneSqliteWorkerModule: (sourceUrl: URL) => { modulePath: string; moduleUrl: string } | undefined;
  var __omnipolymathStandaloneDoctorHash: (filename: string) => string | undefined;

  var __omnipolymathStandaloneLoadPluginModule: (target: string) => { moduleExport: unknown } | undefined;
  var __omnipolymathStandaloneCaptureOperationArtifact: (
    capture: (rootDir: string, selected?: string | readonly string[]) => StandaloneOperationArtifact,
    rootDir: string,
    selected?: string | readonly string[],
  ) => StandaloneOperationArtifact;
  var __omnipolymathStandaloneFingerprintArtifact: <T extends { origin: string; rootDir: string; source?: string; sourcePreferred?: boolean }>(record: T) => string | undefined;
}
`;
}
