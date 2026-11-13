---
summary: "Install Omnipolymath declaratively with Nix"
read_when:
  - You want reproducible, rollback-able installs
  - You're already using Nix/NixOS/Home Manager
  - You want everything pinned and managed declaratively
title: "Nix"
---

A Nix flake or Home Manager module isn't published for Omnipolymath yet. Install
it with the installer script from the [install guide](/install).

The runtime still supports Nix mode, described below, for setups where the
configuration is managed declaratively.

## Nix-mode runtime behavior

When `OMNIPOLYMATH_NIX_MODE=1` is set (automatic with nix-omnipolymath), Omnipolymath uses the Nix-managed install mode. Other Nix packages can set the same mode; nix-omnipolymath is the first-party reference.

For externally managed config without Nix, use
[`OMNIPOLYMATH_CONFIG_READONLY=1`](/cli/config#externally-managed-config). It applies
the same immutable-config enforcement with generic messaging, without enabling
Nix-specific behavior. Existing `OMNIPOLYMATH_NIX_MODE=1` installs need no changes.

You can also set it manually:

```bash
export OMNIPOLYMATH_NIX_MODE=1
```

On macOS, the GUI app does not inherit shell environment variables. Enable Nix mode via `defaults` instead:

```bash
defaults write ai.omnipolymath.mac omnipolymath.nixMode -bool true
```

### What changes in Nix mode

- Auto-install and self-mutation flows are disabled.
- `omnipolymath.json` is treated as immutable. Startup-derived defaults stay runtime-only, and config writers (setup, onboarding, mutating `omnipolymath update`, plugin install/update/uninstall/enable, `doctor --fix`, `doctor --generate-gateway-token`, `omnipolymath config set`) refuse to edit the file.
- Edit the Nix source instead. For nix-omnipolymath, use the agent-first Quick Start and set config under `programs.omnipolymath.config` or `instances.<name>.config`.
- Missing dependencies surface Nix-specific remediation messages.
- The UI shows a read-only Nix mode banner.

### Config and state paths

Omnipolymath reads JSON5 config from `OMNIPOLYMATH_CONFIG_PATH` and stores mutable data in `OMNIPOLYMATH_STATE_DIR`. Under Nix, set these explicitly to Nix-managed locations so runtime state and config stay out of the immutable store.

| Variable                   | Default                                     |
| -------------------------- | ------------------------------------------- |
| `OMNIPOLYMATH_HOME`        | `HOME` / `USERPROFILE` / `os.homedir()`     |
| `OMNIPOLYMATH_STATE_DIR`   | `~/.omnipolymath`                           |
| `OMNIPOLYMATH_CONFIG_PATH` | `$OMNIPOLYMATH_STATE_DIR/omnipolymath.json` |

### Service PATH discovery

On Linux, the systemd Gateway service auto-discovers Nix-profile binaries so plugins and tools that shell out to `nix`-installed executables work without manual PATH setup:

- When `NIX_PROFILES` is set, every entry is added to the service PATH in right-to-left precedence (matches Nix shell precedence: rightmost wins).
- When `NIX_PROFILES` is unset, `~/.nix-profile/bin` is added as a fallback.

These profile directories follow the trusted system directories in the service PATH.

On macOS, the launchd Gateway service intentionally uses a system-only PATH and does not add Nix profiles or inherit your shell's PATH:

```text
/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
```

If a CLI backend, stdio MCP server, or skill needs a Nix-installed executable, use one of these approaches:

- **CLI-managed service:** install an executable wrapper that adds the required Nix bin directories to `PATH`, then execs Omnipolymath with `"$@"`. Adjust the profile directories below to match your own profiles, and replace `/absolute/path/to/omnipolymath` with your Omnipolymath executable's absolute path:

  ```bash
  mkdir -p ~/.local/bin
  cat > ~/.local/bin/omnipolymath-nix-wrapper <<'EOF'
  #!/bin/sh
  set -eu
  export PATH="$HOME/.nix-profile/bin:/nix/var/nix/profiles/default/bin:$PATH"
  exec /absolute/path/to/omnipolymath "$@"
  EOF
  chmod +x ~/.local/bin/omnipolymath-nix-wrapper
  ```

  Register it with the persistent [`--wrapper` option](/cli/gateway/service#install-with-a-wrapper):

  ```bash
  omnipolymath gateway install --wrapper ~/.local/bin/omnipolymath-nix-wrapper --force
  omnipolymath gateway restart
  ```

  Omnipolymath persists the wrapper for later reinstalls, updates, and Doctor repairs; do not edit the generated LaunchAgent.

- **Per-command configuration:** use the executable's absolute path wherever the integration accepts a command path, rather than relying on a bare command name.
- **nix-omnipolymath-managed service:** add the tools to `programs.omnipolymath.runtimePackages` (or `programs.omnipolymath.instances.<name>.runtimePackages`) in your Home Manager configuration, then run `home-manager switch`. The module adds these packages to the Gateway's runtime PATH without changing your shell's PATH. For example:

  ```nix
  programs.omnipolymath.runtimePackages = [ pkgs.jq ];
  ```

## Related

<CardGroup cols={2}>
  <Card title="Setup wizard" href="/start/wizard" icon="wand-magic-sparkles">
    Non-Nix CLI setup walkthrough.
  </Card>
  <Card title="Docker" href="/install/docker" icon="docker">
    Containerized setup as a non-Nix alternative.
  </Card>
  <Card title="Updating" href="/install/updating" icon="arrow-up-right-from-square">
    Updating Home Manager-managed installs alongside the package.
  </Card>
</CardGroup>
