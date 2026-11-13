export const CODEX_NATIVE_PROFILE_IMPORT_COMMAND =
  "omnipolymath models auth login --provider openai --method device-code";

export class CodexAppServerAuthProfileUnavailableError extends Error {
  readonly code = "selected_auth_profile_unavailable";
}

export function formatCodexAuthProfileUnavailableMessage(profileId: string): string {
  const missing = `Codex app-server auth profile "${profileId}" was not found in the Omnipolymath credential store. This is a local credential lookup failure.`;
  return profileId === "openai:default"
    ? `${missing} Since 2026.9.5, Omnipolymath no longer supplies this profile from the native Codex login. Run \`${CODEX_NATIVE_PROFILE_IMPORT_COMMAND}\` to import that login or sign in through Omnipolymath, then retry. For multiple agents, add \`--agent <id>\`.`
    : `${missing} Restore or select an existing OpenAI profile, then retry.`;
}
