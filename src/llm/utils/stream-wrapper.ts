import type { StreamFn } from "@omnipolymath/llm-core";

/** Preserve synchronous streams while adapting promise-returning provider implementations. */
export function mapAssistantMessageStream(
  stream: ReturnType<StreamFn>,
  wrap: (resolved: Awaited<ReturnType<StreamFn>>) => Awaited<ReturnType<StreamFn>>,
): ReturnType<StreamFn> {
  return stream && typeof stream === "object" && "then" in stream
    ? Promise.resolve(stream).then(wrap)
    : wrap(stream);
}
