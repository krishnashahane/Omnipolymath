import { parse as parseSemver, type SemVer } from "semver";
import {
  compareOmnipolymathSemver,
  isOmnipolymathCorrectionSemver,
  normalizeLegacyDotBetaVersion,
} from "../infra/semver.js";

/** Parses stable, prerelease, and legacy dot-beta Omnipolymath versions. */
function parseOmnipolymathVersion(raw: string | null | undefined): SemVer | null {
  if (!raw) {
    return null;
  }
  const normalized = normalizeLegacyDotBetaVersion(raw.trim());
  return parseSemver(normalized);
}

export function normalizeOmnipolymathVersionBase(raw: string | null | undefined): string | null {
  const parsed = parseOmnipolymathVersion(raw);
  if (!parsed) {
    return null;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
}

export function compareOmnipolymathVersions(
  a: string | null | undefined,
  b: string | null | undefined,
): number | null {
  const parsedA = parseOmnipolymathVersion(a);
  const parsedB = parseOmnipolymathVersion(b);
  if (!parsedA || !parsedB) {
    return null;
  }
  return compareOmnipolymathSemver(parsedA, parsedB);
}

export function shouldWarnOnTouchedVersion(
  current: string | null | undefined,
  touched: string | null | undefined,
): boolean {
  const parsedCurrent = parseOmnipolymathVersion(current);
  const parsedTouched = parseOmnipolymathVersion(touched);
  if (parsedCurrent && parsedTouched && parsedCurrent.compareMain(parsedTouched) === 0) {
    if (parsedTouched.prerelease.length === 0 || isOmnipolymathCorrectionSemver(parsedTouched)) {
      return false;
    }
  }
  return parsedCurrent !== null && parsedTouched !== null
    ? compareOmnipolymathSemver(parsedCurrent, parsedTouched) < 0
    : false;
}
