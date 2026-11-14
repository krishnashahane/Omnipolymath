## Unreleased

### Trust Firewall

- Egress guard: shell commands and tool calls aimed at cloud metadata or link-local addresses (including encoded forms of `169.254.169.254`) are always blocked. With `egress.mode: "approve-new"`, contacting a host outside `egress.allowedHosts` needs approval once per Gateway session.
- Agent shells run with `AWS_EC2_METADATA_DISABLED=true` (`execEnv.disableCloudMetadata`).
- Host guard: when a shell command runs outside the sandbox, commands that change the machine (sudo, system and shell-profile files, global installs, services, SSH keys, remote shells) need approval. Configure with `unsandboxedShell`.
- Posture presets: `posture: "restricted" | "balanced" | "personal"`. Explicit settings still win.
- The injection classifier skips content that never addresses an AI, is capped per run (`maxChecksPerRun`), and only accepts a single JSON verdict; content that hands the checker a ready-made verdict is flagged by the pattern scan.
- Wallet reservations for approved calls that never finish are released.

### Install

- `install.sh` installs the prebuilt package from the latest GitHub release by default, checks its SHA-256 and needs only Node.js and npm. It retries network errors and builds from source only with `--from-source`, a branch in `OMNIPOLYMATH_REF`, or when a release has no package.
- The package bundles all 162 channel, provider and tool plugins.

### Website and docs

- Light and dark theme toggle, hero motion, and a section of concrete use cases.
- Docs no longer claim store apps, hosted plans, one-click templates or npm packages that don't exist, and third-party plugins built for the upstream SDK are marked as not loading yet.

### CI

- A lean workflow runs the Trust Firewall tests, oxlint, docs lint and the website build on every push and pull request.
