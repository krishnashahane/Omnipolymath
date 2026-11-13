import { resolveGlobalSingleton } from "omnipolymath/plugin-sdk/global-singleton";
import { KeyedAsyncQueue } from "omnipolymath/plugin-sdk/keyed-async-queue";

// Dist and source copies share physical clients, so their lifecycle queues must
// share ownership too. Settled entries drain naturally; never clear active tails.
const nativeThreadOwners = resolveGlobalSingleton(
  Symbol.for("omnipolymath.codexNativeThreadOwners"),
  () => new KeyedAsyncQueue(),
);

function mutationQueue(namespace: "thread" | "conversation") {
  return async <T>(id: string, run: () => Promise<T>): Promise<T> =>
    await nativeThreadOwners.enqueue(`${namespace}:${id}`, run);
}

/** Serialize Omnipolymath-owned lifecycle changes, not native-internal thread controllers. */
export const withCodexAppServerThreadMutation = mutationQueue("thread");

/** Serializes bound turns and retirement so detach cannot unsubscribe an active turn. */
export const withCodexConversationThreadActivity = mutationQueue("conversation");
