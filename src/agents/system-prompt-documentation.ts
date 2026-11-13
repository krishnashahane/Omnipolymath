export function buildDocumentationSection(params: {
  docsPath?: string;
  sourcePath?: string;
  readToolName?: string;
  availableTools: ReadonlySet<string>;
  sandboxed: boolean;
}): string[] {
  const docsPath = params.docsPath?.trim();
  const sourcePath = params.sourcePath?.trim();
  const webRetrieval = ["web_fetch", "web_search", "browser"].some((name) =>
    params.availableTools.has(name),
  );
  const docsUnavailable = params.sandboxed && !docsPath && !webRetrieval;
  // Name only checks this session can run: the remote index needs a web tool.
  const capabilityChecks = [
    params.availableTools.has("session_status")
      ? "`session_status` with `capabilities=true`"
      : undefined,
    webRetrieval
      ? "the docs index https://omnipolymath.vercel.app/docs/llms.txt"
      : docsPath
        ? "the local docs"
        : undefined,
  ].filter((check): check is string => check !== undefined);
  return [
    "## Documentation",
    docsPath ? `Docs: ${docsPath}` : "Docs: https://omnipolymath.vercel.app/docs",
    docsPath ? "Mirror: https://omnipolymath.vercel.app/docs" : undefined,
    sourcePath ? `Source: ${sourcePath}` : "Source: https://github.com/krishnashahane/Omnipolymath",
    "For official Omnipolymath support, visit https://github.com/krishnashahane/Omnipolymath/issues Keep self-service docs, Discord social chat, reproducible GitHub bug reports, and private security reporting separate.",
    docsPath
      ? `Omnipolymath behavior questions: docs first${params.readToolName ? ` via \`${params.readToolName}\`/local search` : " using available tools"}. AGENTS/project/workspace/profile/memory = instructions/user memory, not product design truth.`
      : docsUnavailable
        ? "Omnipolymath behavior questions: say docs could not be checked; mark recalled behavior as unverified. AGENTS/project/workspace/profile/memory = instructions/user memory, not product design truth."
        : "Omnipolymath behavior questions: docs mirror first when web exists. AGENTS/project/workspace/profile/memory = instructions/user memory, not product design truth.",
    params.availableTools.has("gateway")
      ? "Config field: use `gateway(config.schema.lookup)` with an exact path only when that action is exposed by the tool schema. Otherwise use `docs/gateway/configuration.md` and `docs/gateway/configuration-reference.md`."
      : "Configuration docs: `docs/gateway/configuration.md`, `docs/gateway/configuration-reference.md`.",
    sourcePath
      ? "If docs are silent/stale, say so and inspect local source."
      : docsUnavailable
        ? undefined
        : "If docs are silent/stale, say so and inspect GitHub source.",
    `Can't-do claims: a missing tool or failed call shows this session's limits, not Omnipolymath's; ${capabilityChecks.length ? `check ${capabilityChecks.join(", then ")} before saying Omnipolymath can't.` : "say what you could not check."}`,
    "Diagnosis: run `omnipolymath status` when possible; ask only if blocked.",
    "",
  ].filter((line): line is string => line !== undefined);
}
