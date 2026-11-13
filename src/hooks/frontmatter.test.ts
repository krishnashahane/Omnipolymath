// Hook frontmatter tests cover hook metadata parsing from hook files.
import { expectDefined } from "@omnipolymath/normalization-core";
import { describe, expect, it } from "vitest";
import { parseHookFrontmatter, resolveHookManifestMetadata } from "./frontmatter.js";

function requireString(value: string | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`expected ${label}`);
  }
  return value;
}

describe("resolveHookManifestMetadata", () => {
  it("returns undefined when metadata is missing", () => {
    const frontmatter = { name: "no-metadata" };
    const result = resolveHookManifestMetadata(frontmatter);
    expect(result).toBeUndefined();
  });

  it("handles install specs", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        omnipolymath: {
          events: ["command"],
          install: [
            { id: "bundled", kind: "bundled", label: "Bundled with Omnipolymath" },
            { id: "npm", kind: "npm", package: "@omnipolymath/hook" },
          ],
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    expect(result?.install).toHaveLength(2);
    expect(expectDefined(result?.install?.[0], "result?.install?.[0] test invariant").kind).toBe(
      "bundled",
    );
    expect(expectDefined(result?.install?.[1], "result?.install?.[1] test invariant").kind).toBe(
      "npm",
    );
    expect(expectDefined(result?.install?.[1], "result?.install?.[1] test invariant").package).toBe(
      "@omnipolymath/hook",
    );
  });

  it("handles os restrictions", () => {
    const frontmatter = {
      metadata: JSON.stringify({
        omnipolymath: {
          events: ["command"],
          os: ["darwin", "linux"],
        },
      }),
    };

    const result = resolveHookManifestMetadata(frontmatter);
    expect(result?.os).toEqual(["darwin", "linux"]);
  });

  it("parses real session-memory HOOK.md format", () => {
    // This is the actual format used in the bundled hooks
    const content = `---
name: session-memory
description: "Save session context to memory when a session is reset"
homepage: https://omnipolymath.vercel.app/docs/automation/hooks#session-memory
metadata:
  {
    "omnipolymath":
      {
        "emoji": "💾",
        "events": ["command:new", "command:reset", "session:auto-reset"],
        "requires": { "config": ["workspace.dir"] },
        "install": [{ "id": "bundled", "kind": "bundled", "label": "Bundled with Omnipolymath" }],
      },
  }
---

# Session Memory Hook
`;

    const frontmatter = parseHookFrontmatter(content);
    expect(frontmatter.name).toBe("session-memory");
    expect(requireString(frontmatter.metadata, "session-memory metadata")).toContain(
      '"command:reset"',
    );

    const omnipolymath = expectDefined(resolveHookManifestMetadata(frontmatter), "hook metadata");
    expect(omnipolymath.emoji).toBe("💾");
    expect(omnipolymath.events).toEqual(["command:new", "command:reset", "session:auto-reset"]);
    expect(omnipolymath.requires?.config).toEqual(["workspace.dir"]);
    expect(expectDefined(omnipolymath.install?.[0], "omnipolymath.install?.[0] test invariant").kind).toBe(
      "bundled",
    );
  });
});
