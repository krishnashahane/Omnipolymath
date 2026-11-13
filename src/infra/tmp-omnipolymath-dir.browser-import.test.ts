// Covers browser-safe importing of temp-dir helpers with fs shims.
import { Buffer } from "node:buffer";
import crypto from "node:crypto";
import { expectDefined } from "@omnipolymath/normalization-core";
import { build, type Plugin } from "esbuild";
import { describe, expect, it } from "vitest";

describe("tmp-omnipolymath-dir browser-safe import", () => {
  it("loads when a browser fs shim omits constants", async () => {
    const resultKey = `__omnipolymathTmpDirBrowserImport_${crypto.randomUUID().replaceAll("-", "_")}`;
    const nodeShimPlugin: Plugin = {
      name: "node-browser-shims",
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^node:(fs|os|path)$/ }, (args) => ({
          path: args.path,
          namespace: "node-browser-shim",
        }));
        pluginBuild.onLoad({ filter: /^node:fs$/, namespace: "node-browser-shim" }, () => ({
          contents: "export default { constants: undefined };",
          loader: "js",
        }));
        pluginBuild.onLoad({ filter: /^node:os$/, namespace: "node-browser-shim" }, () => ({
          contents: 'export const tmpdir = () => "/tmp"; export default { tmpdir };',
          loader: "js",
        }));
        pluginBuild.onLoad({ filter: /^node:path$/, namespace: "node-browser-shim" }, () => ({
          contents: "export default { join: (...parts) => parts.join('/') };",
          loader: "js",
        }));
      },
    };

    const bundled = await build({
      bundle: true,
      format: "esm",
      platform: "browser",
      plugins: [nodeShimPlugin],
      stdin: {
        contents: `
          import { DEFAULT_POSIX_TMP_ROOT, resolvePreferredOmnipolymathTmpDir } from "./src/infra/tmp-omnipolymath-dir.ts";
          globalThis.${resultKey} = {
            posixTmpDir: DEFAULT_POSIX_TMP_ROOT,
            resolverType: typeof resolvePreferredOmnipolymathTmpDir,
          };
        `,
        loader: "ts",
        resolveDir: process.cwd(),
        sourcefile: "tmp-omnipolymath-dir-browser-entry.ts",
      },
      write: false,
    });

    const bundledSource = bundled.outputFiles[0]?.text;
    expect(bundledSource).toContain(resultKey);

    await import(
      `data:text/javascript;base64,${Buffer.from(expectDefined(bundledSource, "bundledSource test invariant")).toString("base64")}`
    );

    try {
      expect((globalThis as Record<string, unknown>)[resultKey]).toEqual({
        posixTmpDir: "/tmp/omnipolymath",
        resolverType: "function",
      });
    } finally {
      delete (globalThis as Record<string, unknown>)[resultKey];
    }
  });
});
