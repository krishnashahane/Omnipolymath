import {
  normalizeSortedUniqueTrimmedStringList,
  normalizeUniqueTrimmedStringList,
} from "@omnipolymath/normalization-core/string-normalization";

export function resolveTimezoneSuggestions(
  configuredTimezones: string[],
  browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  supportedTimezones = Intl.supportedValuesOf("timeZone"),
): string[] {
  return normalizeUniqueTrimmedStringList([
    browserTimezone,
    "UTC",
    ...configuredTimezones,
    ...normalizeSortedUniqueTrimmedStringList(supportedTimezones),
  ]);
}
