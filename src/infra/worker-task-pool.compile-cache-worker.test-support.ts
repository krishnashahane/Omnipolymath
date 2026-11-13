import { getCompileCacheDir } from "node:module";
import { serveWorkerTasks } from "./worker-task-server.js";

serveWorkerTasks((input: { sharedValue?: string }) => {
  if (input.sharedValue) {
    process.env.OMNIPOLYMATH_CACHE_FIXTURE_SHARED = input.sharedValue;
  }
  return {
    directory: getCompileCacheDir() ?? null,
    cache: process.env.NODE_COMPILE_CACHE ?? null,
    disable: process.env.NODE_DISABLE_COMPILE_CACHE ?? null,
    explicit: process.env.OMNIPOLYMATH_CACHE_FIXTURE_EXPLICIT ?? null,
  };
});
