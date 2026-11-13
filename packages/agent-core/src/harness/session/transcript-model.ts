export const OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER = "omnipolymath" as const;

/** Transcript authorship is not an inference model, even when the message is replayable. */
export function isTranscriptArtifactProvider(provider: unknown): boolean {
  return provider === OMNIPOLYMATH_TRANSCRIPT_ARTIFACT_PROVIDER;
}
