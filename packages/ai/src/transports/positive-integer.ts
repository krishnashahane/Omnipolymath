import {
  floorPositiveFiniteNumber,
  parseStrictPositiveInteger,
} from "@omnipolymath/normalization-core/number-coercion";

export function parsePositiveInteger(value: unknown): number | undefined {
  return typeof value === "string"
    ? parseStrictPositiveInteger(value)
    : floorPositiveFiniteNumber(value);
}
