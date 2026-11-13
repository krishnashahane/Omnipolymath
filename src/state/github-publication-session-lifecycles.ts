import { captureGitHubPublicationLifecycle } from "./github-publication-receipts.js";
import { executeExistingOmnipolymathStateRead } from "./omnipolymath-state-db-readonly.js";
import { captureOmnipolymathStateReadContext } from "./omnipolymath-state-worker-context.js";

type PublicationIdentity = Parameters<typeof captureGitHubPublicationLifecycle>[1];

/** Retain the immutable binding separately from request status and other authority owners. */
export async function prepareGitHubPublicationSessionLifecycle(input: PublicationIdentity) {
  const authority = captureGitHubPublicationLifecycle(captureOmnipolymathStateReadContext(), input);
  if (!authority.loaded) {
    authority.observe(await readGitHubPublicationSessionLifecycleInWorker(input));
  }
  return { readCurrent: authority.readCurrent };
}

export async function readGitHubPublicationSessionLifecycleInWorker(input: PublicationIdentity) {
  const { publicationKind, requestId } = input;
  const result = await executeExistingOmnipolymathStateRead(
    {},
    { type: "githubPublication.lifecycle", publicationKind, requestId },
    { current: true },
  );
  if (!result) {
    throw new Error("GitHub publication requester metadata is unavailable.");
  }
  return result.lifecycle;
}
