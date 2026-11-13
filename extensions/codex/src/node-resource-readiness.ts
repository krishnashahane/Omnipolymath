import { createDeferred } from "omnipolymath/plugin-sdk/extension-shared";
import { isRecord } from "omnipolymath/plugin-sdk/string-coerce-runtime";
import { racePromiseWithAbortSignal } from "omnipolymath/plugin-sdk/time-runtime";

/** Derives a connection-local effect fence from its admitted Gateway delivery owner. */
export function createCodexNodeResourceReadiness(params: {
  required?: boolean;
  signal: AbortSignal;
  assertCurrent: () => void;
}) {
  const settled = createDeferred<void>();
  let status: "pending" | "ready" | "failed" = params.required ? "pending" : "ready";
  const assertReady = () => {
    params.signal.throwIfAborted();
    params.assertCurrent();
    if (status !== "ready") {
      throw new Error("Private turn resource preparation is unavailable.");
    }
  };
  return {
    readiness: params.required
      ? {
          async wait(signal: AbortSignal) {
            await racePromiseWithAbortSignal(settled.promise, signal);
            assertReady();
          },
          assertCurrent() {
            assertReady();
          },
        }
      : undefined,
    settle(request: unknown) {
      if (!isRecord(request) || request.method !== "omnipolymath/resources/settle") {
        return undefined;
      }
      params.signal.throwIfAborted();
      params.assertCurrent();
      const next = isRecord(request.params) ? request.params.status : undefined;
      const valid =
        params.required &&
        status === "pending" &&
        (typeof request.id === "string" || Number.isSafeInteger(request.id)) &&
        Object.keys(request).every((key) => ["id", "method", "params", "jsonrpc"].includes(key)) &&
        (request.jsonrpc === undefined || request.jsonrpc === "2.0") &&
        isRecord(request.params) &&
        Object.keys(request.params).length === 1 &&
        (next === "ready" || next === "failed");
      if (valid) {
        status = next;
        settled.resolve();
      }
      return {
        id: request.id,
        ...(valid
          ? { result: {} }
          : { error: { code: -32001, message: "Private resource preparation owner changed." } }),
      };
    },
  };
}
