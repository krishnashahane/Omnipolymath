import { asOptionalRecord } from "@omnipolymath/normalization-core/record-coerce";
import { normalizeNullableString } from "@omnipolymath/normalization-core/string-coerce";

export function readMessageIdempotencyKey(message: unknown): string | null {
  return normalizeNullableString(asOptionalRecord(message)?.idempotencyKey);
}
