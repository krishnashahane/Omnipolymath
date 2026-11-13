// Qa Lab helper module supports vite behavior.
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: path.resolve(import.meta.dirname),
  base: "./",
  resolve: {
    alias: {
      "omnipolymath/plugin-sdk/error-runtime": path.resolve(
        import.meta.dirname,
        "../../../packages/normalization-core/src/browser-error-runtime.ts",
      ),
      "omnipolymath/plugin-sdk/text-utility-runtime": path.resolve(
        import.meta.dirname,
        "../../../packages/normalization-core/src/utf16-slice.ts",
      ),
      "omnipolymath/plugin-sdk/time-runtime": path.resolve(
        import.meta.dirname,
        "../../../packages/plugin-sdk/src/time-runtime.ts",
      ),
    },
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
});
