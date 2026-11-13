import { readStringValue } from "@omnipolymath/normalization-core/string-coerce";
import { normalizeCsvOrLooseStringList } from "@omnipolymath/normalization-core/string-normalization";
import {
  applyOmnipolymathManifestInstallCommonFields,
  parseOmnipolymathManifestInstallBase,
  resolveOmnipolymathManifestBlock,
  resolveOmnipolymathManifestInstall,
  resolveOmnipolymathManifestOs,
  resolveOmnipolymathManifestRequires,
} from "../shared/frontmatter.js";
import type {
  OmnipolymathHookMetadata,
  HookEntry,
  HookInstallSpec,
  ParsedHookFrontmatter,
} from "./types.js";

export { parseFrontmatterBlock as parseHookFrontmatter } from "../../packages/markdown-core/src/frontmatter.js";

function parseInstallSpec(input: unknown): HookInstallSpec | undefined {
  const parsed = parseOmnipolymathManifestInstallBase(input, ["bundled", "npm", "git"]);
  if (!parsed) {
    return undefined;
  }
  const { raw } = parsed;
  const spec = applyOmnipolymathManifestInstallCommonFields<HookInstallSpec>(
    {
      kind: parsed.kind as HookInstallSpec["kind"],
    },
    parsed,
  );
  if (typeof raw.package === "string") {
    spec.package = raw.package;
  }
  if (typeof raw.repository === "string") {
    spec.repository = raw.repository;
  }

  return spec;
}

export function resolveHookManifestMetadata(
  frontmatter: ParsedHookFrontmatter,
): OmnipolymathHookMetadata | undefined {
  const metadataObj = resolveOmnipolymathManifestBlock({ frontmatter });
  if (!metadataObj) {
    return undefined;
  }
  const requires = resolveOmnipolymathManifestRequires(metadataObj);
  const install = resolveOmnipolymathManifestInstall(metadataObj, parseInstallSpec);
  const osRaw = resolveOmnipolymathManifestOs(metadataObj);
  return {
    always: typeof metadataObj.always === "boolean" ? metadataObj.always : undefined,
    emoji: readStringValue(metadataObj.emoji),
    homepage: readStringValue(metadataObj.homepage),
    hookKey: readStringValue(metadataObj.hookKey),
    export: readStringValue(metadataObj.export),
    os: osRaw.length > 0 ? osRaw : undefined,
    events: normalizeCsvOrLooseStringList(metadataObj.events),
    requires,
    install: install.length > 0 ? install : undefined,
  };
}

export function resolveHookKey(hookName: string, entry?: Pick<HookEntry, "metadata">): string {
  return entry?.metadata?.hookKey ?? hookName;
}
