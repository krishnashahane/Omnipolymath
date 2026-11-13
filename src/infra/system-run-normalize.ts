export { normalizeNullableString as normalizeNonEmptyString } from "@omnipolymath/normalization-core/string-coerce";
export { readNonBlankString } from "@omnipolymath/normalization-core/string-coerce";

/** Coerces array entries to allow-list strings while rejecting non-array inputs. */
export function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
