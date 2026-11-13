import { safeParseJson } from "@omnipolymath/normalization-core/json-coercion";
import { normalizeOptionalString } from "@omnipolymath/normalization-core/string-coerce";

export function parseGatewayPayload(value: string | null | undefined): unknown {
  const trimmed = normalizeOptionalString(value);
  if (!trimmed) {
    return undefined;
  }
  const parsed = safeParseJson(trimmed);
  return parsed === undefined ? { payloadJSON: value } : parsed;
}
