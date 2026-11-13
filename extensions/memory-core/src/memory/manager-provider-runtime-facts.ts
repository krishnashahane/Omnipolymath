// Memory Core reads optional provider runtime diagnostics without widening the provider contract.
import type { MemoryEmbeddingProvider } from "omnipolymath/plugin-sdk/memory-core-host-engine-embeddings";

const LOCAL_EMBEDDING_RUNTIME_FACTS = Symbol.for("omnipolymath.localEmbeddingRuntimeFacts");

export function getLocalEmbeddingRuntimeFacts(provider: MemoryEmbeddingProvider | null): unknown {
  if (!provider) {
    return undefined;
  }
  const getRuntimeFacts = Reflect.get(provider, LOCAL_EMBEDDING_RUNTIME_FACTS);
  return typeof getRuntimeFacts === "function" ? getRuntimeFacts() : undefined;
}
