export function enableOmnipolymathCompileCache(params: {
  directory: string | undefined;
  env?: NodeJS.ProcessEnv;
  foregroundGateway?: boolean;
}): void;
export function scheduleOmnipolymathCompileCacheFlush(): void;
export function resolveOmnipolymathCompileCacheRespawnEnv(params: {
  directory: string | undefined;
  env?: NodeJS.ProcessEnv;
  foregroundGateway?: boolean;
}): NodeJS.ProcessEnv | undefined;
export function resolveOmnipolymathCompileCacheDirectory(params: {
  installRoot: string;
  env?: NodeJS.ProcessEnv;
  foregroundGateway?: boolean;
  prewarm?: boolean;
}): string | undefined;
export function resolveSafeNodeCompileCacheDirectory(directory: string): string | undefined;
