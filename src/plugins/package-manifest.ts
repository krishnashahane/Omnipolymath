import { isRecord } from "@omnipolymath/normalization-core/record-coerce";
import { normalizeOptionalString } from "../../packages/normalization-core/src/string-coerce.js";
import { MANIFEST_KEY } from "../compat/legacy-names.js";
import type {
  OmnipolymathPackageManifest,
  PackageExtensionResolution,
  PackageManifest,
} from "./package-manifest.types.js";

export type * from "./package-manifest.types.js";

export const DEFAULT_PLUGIN_ENTRY_CANDIDATES = [
  "index.ts",
  "index.js",
  "index.mjs",
  "index.cjs",
] as const;

export function getPackageManifestMetadata(
  manifest: PackageManifest | undefined,
): OmnipolymathPackageManifest | undefined {
  return manifest?.[MANIFEST_KEY];
}

export { controlUiSource } from "./manifest-control-ui.js";

export function resolvePackageExtensionEntries(
  manifest: PackageManifest | undefined,
): PackageExtensionResolution {
  const rawOmnipolymath = manifest?.[MANIFEST_KEY] as unknown;
  if (rawOmnipolymath === undefined || rawOmnipolymath === null) {
    return { status: "missing", entries: [] };
  }
  if (!isRecord(rawOmnipolymath)) {
    return {
      status: "invalid",
      entries: [],
      error: "package.json omnipolymath must be an object",
    };
  }
  const raw = rawOmnipolymath.extensions;
  if (raw === undefined || raw === null) {
    return { status: "missing", entries: [] };
  }
  if (!Array.isArray(raw)) {
    return {
      status: "invalid",
      entries: [],
      error: "package.json omnipolymath.extensions must be an array",
    };
  }
  const entries: string[] = [];
  for (const [index, entry] of raw.entries()) {
    const normalized = normalizeOptionalString(entry);
    if (!normalized) {
      return {
        status: "invalid",
        entries: [],
        error: `package.json omnipolymath.extensions[${index}] must be a non-empty string`,
      };
    }
    entries.push(normalized);
  }
  if (entries.length === 0) {
    return { status: "empty", entries: [] };
  }
  return { status: "ok", entries };
}
