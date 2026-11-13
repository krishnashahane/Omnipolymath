---
summary: "How the installer scripts work (install.sh, install-cli.sh, install.ps1), their options, and automation"
read_when:
  - You want to understand `omnipolymath.vercel.app/install.sh`
  - You want to automate installs (CI / headless)
  - You want to install from a fork, branch or tag
title: "Installer internals"
---

Omnipolymath ships three small installer scripts from `omnipolymath.vercel.app`. Read
them before running them: [install.sh](https://omnipolymath.vercel.app/install.sh),
[install-cli.sh](https://omnipolymath.vercel.app/install-cli.sh),
[install.ps1](https://omnipolymath.vercel.app/install.ps1).

Omnipolymath isn't published to npm yet, so the shell installers build from source.

## Requirements

The installers check for these and stop with a clear message if one is missing.
They don't install them for you.

- **git**
- **Node.js 24.16+ on 24.x, or 26.1+** (see [Node.js compatibility](/install/node-compatibility))
- **pnpm**, or Node's `corepack`, which the installer uses to run pnpm
- **macOS or Linux** (on Windows, use WSL2)

They refuse to run as root.

## Quick commands

```bash
# Install and start onboarding
curl -fsSL https://omnipolymath.vercel.app/install.sh | bash

# Install without onboarding
curl -fsSL https://omnipolymath.vercel.app/install.sh | bash -s -- --no-onboard

# Build a specific branch or tag from a fork
curl -fsSL https://omnipolymath.vercel.app/install.sh | \
  OMNIPOLYMATH_REPO=https://github.com/you/Omnipolymath.git OMNIPOLYMATH_REF=my-branch bash
```

## install.sh

### Flow (install.sh)

1. Check the operating system, git, Node.js and pnpm (or corepack).
2. Clone the repository with `git clone --depth 1` into `OMNIPOLYMATH_DIR`, or, if a
   checkout is already there, fetch `OMNIPOLYMATH_REF` and check it out.
3. Run `pnpm install --frozen-lockfile` (falling back to `pnpm install`), then
   `pnpm build` and `pnpm ui:build`.
4. Write a small `omnipolymath` wrapper into `OMNIPOLYMATH_BIN` that runs
   `node <checkout>/omnipolymath.mjs`, and warn if that directory isn't on your `PATH`.
5. Start `omnipolymath onboard --install-daemon` when a terminal is attached, unless
   you passed `--no-onboard`.

Running the installer again updates the checkout and rebuilds.

### Options

| Option         | Description     |
| -------------- | --------------- |
| `--no-onboard` | Skip onboarding |
| `-h`, `--help` | Show usage      |

| Environment variable | Default                                              | Description                                 |
| -------------------- | ---------------------------------------------------- | ------------------------------------------- |
| `OMNIPOLYMATH_DIR`   | `~/.omnipolymath-src`                                | Source checkout location                    |
| `OMNIPOLYMATH_REPO`  | `https://github.com/krishnashahane/Omnipolymath.git` | Repository to clone                         |
| `OMNIPOLYMATH_REF`   | `main`                                               | Branch or tag to build                      |
| `OMNIPOLYMATH_BIN`   | `~/.local/bin`                                       | Where the `omnipolymath` command is written |

## install-cli.sh

The same as `install.sh`, except that it never starts onboarding. Use it in
automation, then run `omnipolymath onboard --install-daemon` yourself when ready.

```bash
curl -fsSL https://omnipolymath.vercel.app/install-cli.sh | bash
```

On FreeBSD and other platforms the shell installers don't support, build from
source by hand as described in [Install](/install#from-source).

## install.ps1

Omnipolymath runs on Windows through WSL2. `install.ps1` checks whether WSL is
available and prints the exact next steps. It doesn't change your system.

```powershell
iwr -useb https://omnipolymath.vercel.app/install.ps1 | iex
```

## CI and automation

- Pass `--no-onboard`, or use `install-cli.sh`, so the installer never waits for input.
- Pin a version with `OMNIPOLYMATH_REF` (a tag or commit-pinned branch).
- Put the command on `PATH` with `OMNIPOLYMATH_BIN`, or call
  `node "$OMNIPOLYMATH_DIR/omnipolymath.mjs"` directly.

## Troubleshooting

- **`omnipolymath: command not found`:** add `~/.local/bin` (or your `OMNIPOLYMATH_BIN`)
  to `PATH`, for example `echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc`, then
  open a new terminal.
- **`Node.js X is not supported`:** install Node 24.16+ or 26.1+ from
  [nodejs.org](https://nodejs.org) or your version manager, then run the installer again.
- **`pnpm is required`:** run `npm install -g pnpm`, or enable corepack with `corepack enable`.
- **`... exists and is not a git checkout`:** move that directory away or set
  `OMNIPOLYMATH_DIR` to a new location.
- **Build fails:** run `pnpm install && pnpm build` inside the checkout to see the full error.

## Related

- [Install](/install)
- [Node.js compatibility](/install/node-compatibility)
- [Updating](/install/updating)
- [Uninstall](/install/uninstall)
