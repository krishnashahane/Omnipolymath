# @omnipolymath/openshell-sandbox

Official NVIDIA OpenShell sandbox backend for Omnipolymath.

This plugin lets Omnipolymath use OpenShell-managed local or remote sandboxes with
SSH command execution. Choose `mirror` mode for a synchronized local workspace
or `remote` mode for a workspace managed on the remote host.

Mirror operations sharing a workspace run sequentially so concurrent agent
turns cannot overwrite one another. Outbound attachments resolve against the
configured remote workspace, which defaults to `/sandbox`.

Configuring an OpenShell workspace requires OpenShell `v0.0.88` or newer. The
plugin supports OpenShell control-plane workspaces through
`plugins.entries.openshell.config.workspace`; this is separate from Omnipolymath's
local/remote filesystem workspace mode. The setting applies to the whole plugin
instance, not individual agents or sessions. When unset, the plugin preserves
the OpenShell CLI's ambient `OPENSHELL_WORKSPACE` selection, or its `default`
fallback when no ambient selection exists.

## Install

```bash
omnipolymath plugins install @omnipolymath/openshell-sandbox
```

Restart the Gateway after installing or updating the plugin.

## Configure

Install and configure the OpenShell CLI before enabling the backend. As the same
operating system user that runs the Omnipolymath Gateway, verify:

```bash
openshell --version
openshell gateway list
openshell sandbox list
```

Set `agents.defaults.sandbox.backend` to `"openshell"`, enable
`plugins.entries.openshell`, and restart the Omnipolymath Gateway. OpenShell
settings belong under `plugins.entries.openshell.config`.

The optional `policy` setting must be the path to a readable OpenShell policy
YAML file on the Gateway host; it is not a policy name or ID. Use an absolute
path to avoid resolving it relative to an agent workspace.

Use the OpenShell docs for credentials, workspace mirroring, runtime selection, and troubleshooting:

- https://omnipolymath.vercel.app/docs/gateway/openshell

## Brokered worker inference

The optional `worker` configuration adds `omnipolymath openshell worker create`,
`run`, and `configure`. It launches the ordinary Omnipolymath node inside an
OpenShell sandbox after credential-provider readiness, then binds the existing
paired-device worker-inference profile. Docker and Podman use the same OpenShell
gateway contract; OCE and Kubernetes are not required. Sandbox-only behavior is
unchanged. See https://omnipolymath.vercel.app/docs/gateway/openshell-workers for setup,
credential custody, image requirements, and live-proof limitations.

## Package

- Plugin id: `openshell`
- Package: `@omnipolymath/openshell-sandbox`
- Minimum Omnipolymath host: `2026.5.12-beta.1`
