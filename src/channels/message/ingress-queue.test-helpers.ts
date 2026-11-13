import { hasUnjoinedWork } from "../../../scripts/lib/managed-child-process.mts";
import { executeSqliteQuerySync, getNodeSqliteKysely } from "../../infra/kysely-sync.js";
import { AsyncWorkScope } from "../../shared/async-work-scope.js";
import type { DB as OmnipolymathStateKyselyDatabase } from "../../state/omnipolymath-state-db.generated.js";
import { runOmnipolymathStateWriteTransaction } from "../../state/omnipolymath-state-db.js";
import {
  createOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../../test-utils/omnipolymath-test-state.js";
import { createChannelIngressQueue } from "./ingress-queue.js";

type ChannelIngressTestDatabase = Pick<OmnipolymathStateKyselyDatabase, "channel_ingress_events">;
type QueueOptions = Parameters<typeof createChannelIngressQueue>[0];

export function createTestIngressQueue<TPayload, TMetadata = unknown, TCompletedMetadata = unknown>(
  stateDir: string,
  options: Omit<QueueOptions, "channelId" | "accountId" | "stateDir"> = {},
) {
  return createChannelIngressQueue<TPayload, TMetadata, TCompletedMetadata>({
    channelId: "test",
    accountId: "account",
    stateDir,
    ...options,
  });
}

export function useRetainedIngressState(
  registerCleanup: (cleanup: () => Promise<void>) => unknown,
) {
  let retainedState: OmnipolymathTestState | undefined;
  let retainedFailure: { error: unknown } | undefined;
  const cleanup = async (...causes: unknown[]) => {
    try {
      await retainedState?.cleanup();
      retainedState = undefined;
    } catch (cleanupError) {
      const error = causes.length
        ? new AggregateError(
            [...causes, cleanupError],
            `Fixture cleanup unverified; retained ${retainedState?.root}`,
            { cause: causes[0] },
          )
        : cleanupError;
      retainedFailure = { error };
      throw error;
    }
  };
  registerCleanup(async () => {
    if (retainedFailure) {
      throw retainedFailure.error;
    }
    await cleanup();
  });

  return async function withTempState<T>(fn: (stateDir: string) => Promise<T>): Promise<T> {
    if (retainedFailure) {
      throw retainedFailure.error;
    }
    // The earlier cold/authority cases retain isolated fixtures and never enter this owner.
    const state = (retainedState ??= await createOmnipolymathTestState({
      layout: "state-only",
      prefix: "omnipolymath-ingress-queue-retained-",
      applyEnv: false,
    }));
    const failures = new Set<unknown>();
    const work = new AsyncWorkScope(failures);
    const [outcome] = await Promise.allSettled([work.track(() => fn(state.stateDir))]);
    await work.drain();
    if ([...failures].some(hasUnjoinedWork)) {
      try {
        await state.restoreEnv();
      } catch (error) {
        failures.add(error);
      }
      const retained = [...failures];
      const error =
        retained.length === 1
          ? retained[0]
          : new AggregateError(retained, `Fixture cleanup unverified; retained ${state.root}`);
      retainedFailure = { error };
      throw error;
    }
    try {
      if (outcome.status === "rejected") {
        throw outcome.reason;
      }
      // Callback finally blocks have restored spies; native commands and their descendants settled.
      runOmnipolymathStateWriteTransaction(
        ({ db }) =>
          executeSqliteQuerySync(
            db,
            getNodeSqliteKysely<ChannelIngressTestDatabase>(db).deleteFrom(
              "channel_ingress_events",
            ),
          ),
        { env: state.env },
      );
      return outcome.value;
    } catch (error) {
      await cleanup(error);
      throw error;
    }
  };
}
