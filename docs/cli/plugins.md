---
summary: "CLI reference for `omnipolymath plugins` (init, build, validate, lint, list, install, reload, marketplace, uninstall, enable/disable, doctor)"
read_when:
  - You want to install or manage Gateway plugins or compatible bundles
  - You want to scaffold or validate a simple tool plugin
  - You want to debug plugin load failures
title: "Plugins CLI"
sidebarTitle: "Plugins"
---

# `omnipolymath plugins`

Manage Gateway plugins, hook packs, and compatible bundles.

Install, uninstall, enable, disable, and reload use their existing Gateway routes
when a Gateway is running. Local fallbacks require exclusive offline state ownership.
Stop the Gateway through its service owner before running `plugins update`,
`plugins registry --refresh`, marketplace feed refreshes, or hook-pack install
fallbacks. `plugins marketplace entries --offline` reads the saved feed without
refreshing it. Refused commands report how to retry.

While a plugin or config operation is running, the CLI waits and retries only if
the Gateway confirms that it did not accept the mutation. Admission stays within
the command's existing ten-minute budget, including `plugins reload --wait`.
Interrupting the command cancels pending admission retries. An already accepted
mutation may still finish; inspect plugin status before retrying it.
Lost replies and failures after acceptance are reported without automatic replay;
inspect plugin status before retrying them. Older Gateways that do not provide
the admission fact keep the explicit busy response.

If a command encounters offline database maintenance, it reports the reason
without `OMNIPOLYMATH_DEBUG`. Wait for maintenance to finish, then retry the command.

`plugins enable` and `plugins disable` accept case-insensitive plugin IDs, including
when the Gateway is stopped. Reported IDs retain their manifest spelling; plugin
policy keys in config use the required lowercase form.
The same policy applies to live activation and the next Gateway start. Runtime
IDs and Gateway method names retain the plugin's declared spelling.
`plugins inspect` and its `info` alias try an exact ID, then an exact display name,
then the canonical ID resolved from case variants or manifest legacy IDs.

<CardGroup cols={2}>
  <Card title="Plugin system" href="/tools/plugin">
    End-user guide for installing, enabling, and troubleshooting plugins.
  </Card>
  <Card title="Manage plugins" href="/plugins/manage-plugins">
    Quick examples for install, list, update, uninstall, and publishing.
  </Card>
  <Card title="Plugin bundles" href="/plugins/bundles">
    Bundle compatibility model.
  </Card>
  <Card title="Plugin manifest" href="/plugins/manifest">
    Manifest fields and config schema.
  </Card>
  <Card title="Security" href="/gateway/security">
    Security hardening for plugin installs.
  </Card>
</CardGroup>

## Commands

```bash
omnipolymath plugins list [--enabled] [--verbose] [--json]
omnipolymath plugins search <query> [--limit <n>] [--json]
omnipolymath plugins install <path-or-spec> [--link] [--force] [--pin] [--no-enable] [--accept-capabilities] [--acknowledge-install-policy-warning] [--marketplace <source>]
omnipolymath plugins inspect <id> [--runtime] [--json]
omnipolymath plugins inspect --all [--runtime] [--json]
omnipolymath plugins info <id>                    # alias for inspect
omnipolymath plugins enable <ids...> [--accept-capabilities]
omnipolymath plugins disable <ids...>
omnipolymath plugins reload <ids...> [--wait] [--accept-capabilities] [--json]
omnipolymath plugins uninstall <ids...> [--dry-run] [--keep-files] [--force]
omnipolymath plugins update <ids-or-npm-specs...> | --all [--dry-run]
omnipolymath plugins registry [--refresh] [--json]
omnipolymath plugins doctor [--json]
omnipolymath plugins init <id> [--name <name>] [--type tool|provider|feature] [--directory <path>]
omnipolymath plugins build [--root <path>] [--entry <path>] [--check]
omnipolymath plugins validate [--root <path>] [--entry <path>] [--json]
omnipolymath plugins lint [--root <path>] [--json]
omnipolymath plugins pack [--root <path>] [--out <file.tgz>] [--json]
omnipolymath plugins marketplace entries [--offline] [--feed-profile <name>] [--json]
omnipolymath plugins marketplace list <source> [--json]
omnipolymath plugins marketplace refresh [--feed-profile <name>] [--expected-sha256 <sha256>] [--json]
```

An accepted interrupt cancels the pending catalog reads for read-only
`plugins search` and suppresses late search results or errors.

For slow install, inspect, uninstall, or registry-refresh investigation, run the
command with `OMNIPOLYMATH_PLUGIN_LIFECYCLE_TRACE=1`. The trace writes phase timings
to stderr and keeps JSON output parseable. See [Debugging](/help/debugging#plugin-lifecycle-trace).

<Note>
In Nix mode (`OMNIPOLYMATH_NIX_MODE=1`), `omnipolymath.json` is immutable. `install`, `update`, `uninstall`, `enable`, and `disable` all refuse to run. Manage those choices in the Nix source for this install (`programs.omnipolymath.config` or `instances.<name>.config` for nix-omnipolymath), then rebuild. Reload remains available when no new capability consent needs to be recorded; it preserves config and installation state. See the agent-first Quick Start.
</Note>

<Note>
Bundled plugins ship with Omnipolymath. A little over half are enabled by default — mostly model and speech providers, plus a few others such as the bundled browser plugin. Other bundled plugins need explicit enablement or relevant configuration. Enabled does not mean currently in use. Provider use depends on configuration and requests. Providers that require authentication need credentials; keyless providers such as Microsoft speech do not. An enabled entry in `plugins list` does not mean the plugin is doing work.

Native Omnipolymath plugins ship `omnipolymath.plugin.json` with an inline JSON Schema (`configSchema`, even if empty). Compatible bundles use their own bundle manifests instead.

`plugins list` shows `Format: omnipolymath` or `Format: bundle`. Verbose list/info output also shows the bundle subtype (`agent (Agent Plugins)`, `codex`, `claude`, or `cursor`) plus detected bundle capabilities.
</Note>

## Plugins pages

This page is an index. `omnipolymath plugins` is documented on six pages, one per
reader job. Open the page that matches your task.

| Page                                                              | Read it when                                                                     |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Author plugins](/cli/plugins/authoring)                          | You are creating, building, validating, or packing a plugin project.             |
| [Install plugins](/cli/plugins/install)                           | You are installing from ClawHub, npm, git, a path, an archive, or a marketplace. |
| [List installed plugins](/cli/plugins/list)                       | You want the installed inventory, discovery diagnostics, or the plugin index.    |
| [Uninstall and update plugins](/cli/plugins/uninstall-and-update) | You are removing or reloading a plugin, or updating its version and source.      |
| [Inspect and diagnose plugins](/cli/plugins/inspect-and-diagnose) | You need plugin identity, runtime registrations, load errors, or registry state. |
| [Marketplace feeds](/cli/plugins/marketplace)                     | You are browsing, listing, or refreshing a marketplace or hosted signed feed.    |

## Where each section moved

Every section anchor from the previous single-page version keeps its id here,
so an existing link such as `/cli/plugins#registry` still resolves. Each entry
points at the page that now holds the content.

- <a id="author" />[Author](/cli/plugins/authoring#author)
- <a id="feature-scaffold-and-artifacts" />[Feature scaffold and artifacts](/cli/plugins/authoring#feature-scaffold-and-artifacts)
- <a id="provider-scaffold" />[Provider scaffold](/cli/plugins/authoring#provider-scaffold)
- <a id="install" />[Install](/cli/plugins/install#install)
- <a id="config-includes-and-invalid-config-repair" />[Config includes and invalid-config repair](/cli/plugins/install#config-includes-and-invalid-config-repair)
- <a id="force-confirmation-and-reinstall-vs-update" />[`--force` confirmation and reinstall vs update](/cli/plugins/install#force-confirmation-and-reinstall-vs-update)
- <a id="pin-scope" />[`--pin` scope](/cli/plugins/install#pin-scope)
- <a id="acknowledge-install-policy-warning" />[`--acknowledge-install-policy-warning`](/cli/plugins/install#acknowledge-install-policy-warning)
- <a id="clawhub-security-audit" />[ClawHub Security Audit](/cli/plugins/install#clawhub-security-audit)
- <a id="hook-packs-and-npm-specs" />[Hook packs and npm specs](/cli/plugins/install#hook-packs-and-npm-specs)
- <a id="git-repositories" />[Git repositories](/cli/plugins/install#git-repositories)
- <a id="archives" />[Archives](/cli/plugins/install#archives)
- <a id="marketplace-shorthand" />[Marketplace shorthand](/cli/plugins/install#marketplace-shorthand)
- <a id="marketplace-sources" />[Marketplace sources](/cli/plugins/install#marketplace-sources)
- <a id="remote-marketplace-rules" />[Remote marketplace rules](/cli/plugins/install#remote-marketplace-rules)
- <a id="list" />[List](/cli/plugins/list#list)
- <a id="param-enabled" />[`--enabled`](/cli/plugins/list#param-enabled)
- <a id="param-verbose" />[`--verbose`](/cli/plugins/list#param-verbose)
- <a id="param-json" />[`--json`](/cli/plugins/list#param-json)
- <a id="plugin-index" />[Plugin index](/cli/plugins/list#plugin-index)
- <a id="reload" />[Reload](/cli/plugins/uninstall-and-update#reload)
- <a id="uninstall" />[Uninstall](/cli/plugins/uninstall-and-update#uninstall)
- <a id="update" />[Update](/cli/plugins/uninstall-and-update#update)
- <a id="resolving-plugin-id-vs-npm-spec" />[Resolving plugin id vs npm spec](/cli/plugins/uninstall-and-update#resolving-plugin-id-vs-npm-spec)
- <a id="beta-channel-updates" />[Beta channel updates](/cli/plugins/uninstall-and-update#beta-channel-updates)
- <a id="existing-plugin-source-choices" />[Existing plugin source choices](/cli/plugins/uninstall-and-update#existing-plugin-source-choices)
- <a id="version-checks-and-integrity-drift" />[Version checks and integrity drift](/cli/plugins/uninstall-and-update#version-checks-and-integrity-drift)
- <a id="acknowledge-install-policy-warning-on-update" />[`--acknowledge-install-policy-warning` on update](/cli/plugins/uninstall-and-update#acknowledge-install-policy-warning-on-update)
- <a id="clawhub-security-audit-on-update" />[ClawHub Security Audit on update](/cli/plugins/uninstall-and-update#clawhub-security-audit-on-update)
- <a id="inspect" />[Inspect](/cli/plugins/inspect-and-diagnose#inspect)
- <a id="doctor" />[Doctor](/cli/plugins/inspect-and-diagnose#doctor)
- <a id="registry" />[Registry](/cli/plugins/inspect-and-diagnose#registry)
- <a id="marketplace" />[Marketplace](/cli/plugins/marketplace#marketplace)

## Related

- [Runtime compatibility lint](/plugins/runtime-compatibility)
- [Building plugins](/plugins/building-plugins)
- [CLI reference](/cli)
- [ClawHub](/clawhub)
- [ClawHub CLI](/clawhub/cli) - standalone registry commands
- [ClawHub publishing](/clawhub/publishing) - owners, scopes, and release review
