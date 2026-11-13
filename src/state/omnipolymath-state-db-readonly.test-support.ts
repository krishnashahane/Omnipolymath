import {
  createRetainedOperation,
  type RetainedOperation,
} from "@omnipolymath/worker-runtime/lifecycle";
import type {
  OmnipolymathStateReadAuthority,
  OmnipolymathStateReadLocation,
  OmnipolymathStateReadOutcome,
} from "./omnipolymath-state-read.types.js";

// These awaited fixtures observe Promise settlement; they do not prove blocked-host progress.
export function observeAsyncFixture<T>(run: () => Promise<T>): RetainedOperation<T> {
  const completion = createRetainedOperation<T>(() => undefined);
  try {
    void run().then(completion.resolve, completion.reject);
  } catch (error) {
    completion.reject(error);
  }
  return completion.operation;
}

// Preparation owns no resource beyond the separately cleaned prepared location.
export function retainFixturePreparation<T>(preparation: RetainedOperation<T>) {
  const close = createRetainedOperation<void>(() => {
    if (preparation.read().status !== "pending") {
      close.resolve(undefined);
    }
  });
  void preparation.result.then(
    () => close.operation.service(),
    () => close.operation.service(),
  );
  return { ...preparation, startClose: () => close.operation };
}

export function createReadWorkerFixture(
  read: (
    source: OmnipolymathStateReadLocation,
    authority: OmnipolymathStateReadAuthority,
  ) => Promise<OmnipolymathStateReadOutcome>,
  close: () => Promise<void>,
) {
  return {
    captureOmnipolymathStateReadSource: () => ({
      createTransport: () => ({
        startRead: async (
          source: OmnipolymathStateReadLocation,
          authority: OmnipolymathStateReadAuthority,
        ) => {
          authority.assertCurrent();
          return await read(source, authority);
        },
        startValidateFresh: async (
          _context: OmnipolymathStateReadLocation["context"],
          authority: OmnipolymathStateReadAuthority,
        ) => authority.assertCurrent(),
        startClose: close,
      }),
      own: () => () => {},
    }),
  };
}
