---
summary: "Codex auth selection order, credential handling, and environment isolation"
read_when:
  - You need the Codex auth selection order
  - You are sharing or isolating the native Codex home
  - You are migrating Codex credentials or assets into an agent
title: "Codex auth and environment isolation"
sidebarTitle: "Auth and isolation"
---

Which credential a Codex turn uses, and what the app-server child process inherits. Part of the [Codex harness reference](/plugins/codex-harness-reference); [Where each section moved](/plugins/codex-harness-reference#where-each-section-moved) lists every section.

## Auth and environment isolation

In the default per-agent home, stdio launches use Codex's ephemeral credential
store, including custom commands selected by `appServer.command` or
`OMNIPOLYMATH_CODEX_APP_SERVER_BIN`. Command wrappers must forward Codex's `-c`
configuration arguments. For stdio launches with an explicit `app-server`
subcommand, Omnipolymath groups `-c` / `--config` overrides before that subcommand,
preserving their order and leaving wrapper prefixes and other arguments in place.
This prevents Codex from dropping earlier overrides when flags appear on both
sides of `app-server`. Omnipolymath's ephemeral credential-store override remains
last when Omnipolymath owns auth; native user-home auth is unchanged.
Workspace-write turns also preserve explicit `sandbox_workspace_write` temporary
root exclusions from these arguments, including attached `-ckey=value` flags
and TOML comments after boolean values. The last explicit value wins.
Explicit turn sandbox policies and network-proxy permission profiles keep their
existing precedence.

Omnipolymath supplies auth in this order:

1. An explicit or ordered Omnipolymath auth profile for the agent.
2. For an API-key route only, a prepared key or local stdio fallback from
   `CODEX_API_KEY`, then `OPENAI_API_KEY`.

The app-server does not read an existing `codex-home/auth.json` in
this mode. Import that file explicitly as described below. Set
`appServer.homeScope: "user"` only when the app-server should instead own and
use the operator's native Codex account.

For a side-by-side explanation of what is handed off, who refreshes it, and how
a shared native account affects supervised Chats, see
[Credentials and account ownership](/plugins/codex-harness/native-features#credentials-and-account-ownership).

No credential file is written in this mode, in either home. A subscription
profile is handed over as an `account/login/start` request of type
`chatgptAuthTokens`, which Codex installs as in-memory external auth rather
than persisting; the ephemeral credential store covers the API-key login,
which would otherwise write `CODEX_HOME/auth.json`.

Token refresh is inverted so the long-lived secret never leaves Omnipolymath. Codex
holds only a short-lived access token, and on an unauthorized response it sends
an `account/chatgptAuthTokens/refresh` request back to Omnipolymath over the same
connection. Omnipolymath refreshes against its own auth profile store and returns a
fresh access token, so the refresh token stays in SQLite. A refresh that does
not answer within the app-server's timeout fails that turn rather than falling
back to another credential. A failed refresh retires the shared client from
reuse; existing leases drain, and the next request starts a fresh client. If the
workspace changed, retry the request. If credentials cannot refresh, sign in
again with `omnipolymath models auth login --provider openai` and select that profile.
Shared clients recheck the selected profile before reuse so changing accounts
under the same profile ID also selects a new client.

When Omnipolymath sees a ChatGPT subscription-style Codex auth profile (OAuth or
token credential type), it removes `CODEX_API_KEY` and `OPENAI_API_KEY` from
the spawned Codex child process. That keeps Gateway-level API keys available
for embeddings or direct OpenAI models without making native Codex app-server
turns bill through the API by accident.

Explicit Codex API-key profiles and local stdio env-key fallback use
app-server login instead of inherited child-process env. WebSocket app-server
connections do not receive Gateway env API-key fallback; use an explicit auth
profile or the remote app-server's own account.

Stdio app-server launches inherit Omnipolymath's process environment by default.
Omnipolymath owns the Codex app-server account bridge and sets `CODEX_HOME` to a
per-agent directory under that agent's Omnipolymath state. That keeps Codex
config, accounts, plugin cache/data, and thread state scoped to the Omnipolymath
agent instead of leaking in from the operator's personal `~/.codex` home.

Set `appServer.homeScope: "user"` to share native Codex state with Codex
Desktop and the CLI. This local user-home mode supports managed stdio and
explicit Unix transport. It uses `$CODEX_HOME` when set and `~/.codex`
otherwise, including native auth, config, plugins, and threads.
Omnipolymath skips its auth-profile bridge for the app-server. Verified owner
turns can use `codex_threads` to list (with an optional `search` filter),
read, fork, rename, archive, and unarchive those threads. Fork a thread before
continuing it in Omnipolymath; independent Codex processes do not coordinate
concurrent writers for the same thread.

That `homeScope` opt-in applies to ordinary harness sessions. Hosted web search
and settled-turn finalization use private temporary homes and Omnipolymath auth
even when ordinary sessions share the user home. A Chat created
through Codex Sessions uses its private supervision connection instead, which
preserves the native connection's auth and provider configuration for the
primary branch and future resumes. If that supervised turn finishes tool work
without a final answer, Omnipolymath does not borrow host credentials to generate
one. It delivers the [settled-tool fallback](/plugins/codex-harness-runtime#final-answers-after-settled-tool-work)
without repeating completed actions.

In a model-locked supervised Chat, `codex_threads` cannot attach a different
fork or archive the Chat's bound native thread. List and metadata-only read
remain available. Raw transcript reads require `allowRawTranscripts`; when it
is disabled, list search is also rejected because native search can match
transcript previews. Rename, unarchive, detached fork, and archive of an
unrelated thread not owned by another Omnipolymath Chat require
`allowWriteControls`. Neither option bypasses a locked binding.

Omnipolymath does not rewrite `HOME` for normal local app-server launches.
Codex-run subprocesses such as `omnipolymath`, `gh`, `git`, cloud CLIs, and shell
commands see the normal process home and can find user-home config and
tokens. Codex may also discover `$HOME/.agents/skills` and
`$HOME/.agents/plugins/marketplace.json`; that `.agents` discovery is
intentionally shared with the operator home and is separate from isolated
`~/.codex` state.

In the default agent scope, Omnipolymath plugins and Omnipolymath skill snapshots
still flow through Omnipolymath's own plugin registry and skill loader; personal
Codex `~/.codex` assets do not. If you have useful Codex CLI skills or
plugins from a Codex home that should become part of an isolated Omnipolymath
agent, inventory them explicitly:

```bash
omnipolymath migrate codex --dry-run
omnipolymath migrate apply codex --yes
```

Credentials need the sensitive migration path because the default agent scope
does not consume a copied or mounted `codex-home/auth.json` directly. Replace
`<agent-id>` with the configured agent that owns this Codex home:

```bash
omnipolymath migrate plan codex --from <codex-home> --agent <agent-id> --include-secrets --item auth:openai
omnipolymath migrate apply codex --from <codex-home> --agent <agent-id> --include-secrets --item auth:openai --yes
```

If a deployment needs additional environment isolation, add those variables
to `appServer.clearEnv`:

```json5
{
  plugins: {
    entries: {
      codex: {
        enabled: true,
        config: {
          appServer: {
            clearEnv: ["CODEX_API_KEY", "OPENAI_API_KEY"],
          },
        },
      },
    },
  },
}
```

`appServer.clearEnv` only affects the spawned Codex app-server child process.
Omnipolymath removes `CODEX_HOME` and `HOME` from this list during local launch
normalization: `CODEX_HOME` stays pointed at the selected agent or user scope,
and `HOME` stays inherited so subprocesses can use normal user-home state.

## Custom providers with native command auth

For an operator-managed custom HTTPS Responses endpoint, set the provider's
auth mode to `native-command` and explicitly select the Codex runtime. Use a
new provider ID, not an ID or alias owned by a provider plugin:

```json5
{
  models: {
    providers: {
      "company-inference": {
        baseUrl: "https://inference.example.com/v1",
        api: "openai-responses",
        auth: "native-command",
        agentRuntime: { id: "codex" },
        models: [{ id: "company-model", name: "Company model" }],
      },
    },
  },
}
```

Configure the same provider ID and endpoint in the selected Codex home's
`config.toml` (the default per-agent Codex home, or an explicitly selected user
home). Codex owns the executable, token cache, timeout, and refresh behavior:

```toml
[model_providers.company-inference]
name = "Company inference"
base_url = "https://inference.example.com/v1"
wire_api = "responses"
requires_openai_auth = false

[model_providers.company-inference.auth]
command = "/absolute/path/to/provider-token"
args = ["--audience", "inference"]
timeout_ms = 5000
refresh_interval_ms = 300000
```

The command must print only the bearer token to stdout and exit successfully.
Omnipolymath’s eligibility checks do not execute the command or copy its token into
an auth profile. Codex owns command execution during native discovery and turns.
A configured model being eligible does not prove that the command or upstream
service is healthy; execution failures are reported by the native runtime.

Select `company-inference/company-model` for an ordinary Codex session. The
runtime checks the native provider's endpoint and command-auth configuration
before starting a thread. Omnipolymath does not forward stored profiles or ambient
`CODEX_API_KEY`, `OPENAI_API_KEY`, or `CODEX_ACCESS_TOKEN` credentials.
Do not combine this mode with an Omnipolymath API key, profile pin, custom headers,
or request transport overrides in Omnipolymath. Explicit authentication and headers
in Codex's native configuration remain owned by Codex, including `gateway_oauth`
alongside the primary token command. Codex validates conflicts, stores and refreshes
its secondary account, and may authenticate catalog requests during startup.
The helper can represent a user or service; a native secondary account is not
implicitly the Omnipolymath or Team requester. This mode does not add an Omnipolymath
login flow or import either native credential into an Omnipolymath profile.

This mode does not support the embedded Omnipolymath runtime, isolated completions,
supervised native sessions, manual compaction, or remote-exec cloud placement.
Codex still owns automatic compaction within a normal turn. If tools finish
without a final answer, Omnipolymath uses the settled-tool fallback instead of
borrowing credentials for a separate summarization turn. This mode does not relax
model-backed approval-review endpoint trust, operator model policy, or native
tool permissions. Existing OpenAI account discovery and readiness are unchanged.

## Upgrading from 2026.9.4 with Codex sign-in

If `openai:default` exists only through native Codex sign-in, you can prepare
on 2026.9.4 before upgrading to 2026.9.5, which no longer supplies that overlay.
For the conventional `main` shared-store owner, complete a fresh device-code
sign-in through Omnipolymath and verify the persisted profile:

```bash
omnipolymath models auth login --provider openai --method device-code --profile-id openai:default --agent main
omnipolymath models auth list --agent main --json
```

Keep `--profile-id`: omitting it on 2026.9.4 can import under a different ID
and remove the old overlay. `openai:default` should appear in the unfiltered
list above. Other agents [inherit the shared profile](/auth-credential-semantics#agent-copy-portability),
including agents with unrelated local credentials. A local profile with the
same ID overrides it; sign in separately with `--agent <id>` only to create or
replace an intentional local OpenAI override.
