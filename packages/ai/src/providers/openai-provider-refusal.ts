import {
  readProviderRefusalReview,
  type ProviderRefusalReview,
} from "@omnipolymath/llm-core/diagnostics";
import { isRecord } from "@omnipolymath/normalization-core/record-coerce";

/** Responses uses snake_case; the ChatGPT app-server error envelope uses camelCase. */
export function readOpenAIMisalignmentReview(
  value: unknown,
  continuationSupported: boolean,
): ProviderRefusalReview | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return readProviderRefusalReview({
    explanation: value.detailed_explanation ?? value.detailedExplanation,
    errorType: value.error_type ?? value.errorType,
    ...(continuationSupported ? { continuation: value.steer } : {}),
  });
}
