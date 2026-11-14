# Omnipolymath

**The agent you can actually trust with your keys.**

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/omnipolymath-banner-light.png">
    <img src="docs/assets/omnipolymath-banner-dark.png" alt="Omnipolymath: an AI assistant that runs on your own devices and shows a receipt for everything it does.">
  </picture>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License: MIT"></a>
  <a href="https://omnipolymath.vercel.app"><img src="https://img.shields.io/badge/site-omnipolymath.vercel.app-111?style=flat-square" alt="Website"></a>
  <a href="https://omnipolymath.vercel.app/docs"><img src="https://img.shields.io/badge/docs-read-111?style=flat-square" alt="Docs"></a>
</p>

Omnipolymath is an open-source AI assistant that runs on your own computer and meets you in the chat apps you already use: Discord, iMessage, Slack, Teams, Telegram, WhatsApp and 20+ more, plus a browser Control UI. Source for macOS, iOS, Android, Windows and Linux apps is in `apps/`; app downloads aren't published yet.

It does the work, and it shows the receipts. Autonomous, but never out of control.

[Website](https://omnipolymath.vercel.app) · [Docs](https://omnipolymath.vercel.app/docs) · [Getting started](https://omnipolymath.vercel.app/docs/start/getting-started) · [Trust Firewall](extensions/trust-firewall/README.md) · [FAQ](https://omnipolymath.vercel.app/docs/help/faq) · [Vision](VISION.md)

## Why Omnipolymath

Agents hold your credentials, read your mail and run commands on real machines. Omnipolymath puts a **Trust Firewall** between every agent and your accounts, and it is on by default.

|                          | What you get                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Approvals**            | Anything that spends money or can't be taken back waits for your approval. Each agent gets only the tools you allow.                                                                                                                                                                                                                                                                         |
| **Injection shield**     | Every tool result is pattern-scanned. Web, email and chat content that talks to an AI or gives orders also gets a second opinion from your own model (capped per run, so ordinary pages cost nothing). Content that tries to hand the checker a verdict is flagged on sight. Once a run reads something that looks like a hijack, outbound and write actions in that run need your approval. |
| **Undo**                 | Files only. `write`, `edit` and `apply_patch` are snapshotted before they run, and `omnipolymath firewall undo <run>` restores them without overwriting a change you made afterwards. **Shell commands, sent messages, API calls and payments can't be undone**, which is why the risky ones wait for your approval.                                                                         |
| **Tamper-evident log**   | Every decision is a hash-chained JSON line. `omnipolymath firewall verify` names the exact entry if anything was edited, removed or reordered. Dry-run mode never sends or deletes anything.                                                                                                                                                                                                 |
| **Spend cap**            | A hard daily cap, priced from the cost your provider reports for each response and kept across restarts. Optional routing sends routine prompts to a cheaper model.                                                                                                                                                                                                                          |
| **Agent wallets**        | Any tool that pays, charges or orders is held to per-transaction and daily USD limits and an optional payee allowlist.                                                                                                                                                                                                                                                                       |
| **Receipts**             | Every run ends with a receipt: what it did, what it cost, what changed, what was stopped and how to undo it.                                                                                                                                                                                                                                                                                 |
| **Self-cleaning memory** | `fact_save` and `fact_search` keep facts with provenance and an integrity hash. Facts decay, expire and resolve contradictions; facts learned from suspicious content start at low confidence.                                                                                                                                                                                               |
| **Checked skills**       | Skills are scanned for dangerous permissions at install and publisher signatures are verified. You can require signatures.                                                                                                                                                                                                                                                                   |
| **Signed handoffs**      | `omnipolymath firewall handoff` issues and verifies Ed25519-signed, scoped, expiring delegations between agents.                                                                                                                                                                                                                                                                             |
| **No telemetry**         | Nothing is sent anywhere unless you set `OMNIPOLYMATH_TELEMETRY_ENDPOINT`.                                                                                                                                                                                                                                                                                                                   |
| **Sandbox**              | Shell commands can run in Docker with one setting (`agents.defaults.sandbox.mode: "non-main"`). Without Docker they run on your machine, so commands that change it (sudo, system and shell-profile files, global installs, services, SSH keys) need your approval first. Set `unsandboxedShell: "approve-all"` to approve every command.                                                    |
| **Egress guard**         | Agent shells and tools can't reach cloud-metadata endpoints that hand out credentials. Optionally, every new host needs your approval once, and `posture: "restricted"` turns on the strictest defaults in one line.                                                                                                                                                                         |

> **What undo can't reverse:** only file edits made with `write`, `edit` and `apply_patch` can be rolled back. A shell command that already ran, a message that was sent or a payment that went through stays done, so keep approvals on for those tiers.

## Install

Omnipolymath runs on macOS, Linux and Windows (WSL2) with Node.js 24.16+ or 26.1+. One command installs it:

```bash
# macOS / Linux / WSL2
curl -fsSL https://omnipolymath.vercel.app/install.sh | bash
```

The installer downloads the prebuilt package from the [latest release](https://github.com/krishnashahane/Omnipolymath/releases/latest), checks its SHA-256, installs it with npm into `~/.omnipolymath-cli` and starts onboarding. It includes all 162 bundled channels, model providers and tools, and never runs as root. Add `--from-source` (or set `OMNIPOLYMATH_REF=main`) to build from the repository instead, which needs git and pnpm. To build by hand:

```bash
git clone https://github.com/krishnashahane/Omnipolymath.git
cd Omnipolymath
pnpm install
pnpm build
pnpm ui:build
pnpm omnipolymath onboard --install-daemon
```

## Quick start

```bash
omnipolymath gateway status
omnipolymath dashboard
```

Onboarding checks model access, creates the workspace and configures the Gateway. The dashboard opens the Control UI; send a message there to confirm the assistant works. See the [getting started guide](https://omnipolymath.vercel.app/docs/start/getting-started) for channel setup and troubleshooting.

### Tune the Trust Firewall

The defaults are safe without any configuration. To change them, edit `~/.omnipolymath/omnipolymath.json`:

```json5
{
  plugins: {
    entries: {
      "trust-firewall": {
        config: {
          posture: "balanced", // "restricted" asks before anything leaves the machine
          mode: "enforce", // or "monitor" (log only) or "dry-run" (never write)
          dailySpendCapUsd: 25, // 0 turns the cap off
          approveTiers: ["spend", "irreversible"],
          agentToolAllowlist: { helper: ["read", "web_search"] },
          wallet: { perTransactionUsd: 100, dailyUsd: 250, allowedPayees: [] },
          skills: { requireSignature: false, blockHighRisk: false },
          routing: { enabled: true, routineModel: "<cheap model>", hardModel: "<best model>" },
          egress: { mode: "approve-new", allowedHosts: ["*.github.com", "api.openai.com"] },
          unsandboxedShell: "approve-risky", // or "approve-all" / "allow"
        },
      },
    },
  },
}
```

Want the strictest setup in one line? Set `posture: "restricted"`: outbound actions, new hosts and every shell command outside the sandbox wait for you, and high-risk skills are blocked.

Inspect what happened with `omnipolymath firewall status`, `omnipolymath firewall log` and `omnipolymath firewall verify`. Full reference: [extensions/trust-firewall/README.md](extensions/trust-firewall/README.md).

## How it fits together

- The [Gateway](https://omnipolymath.vercel.app/docs/gateway) is the local control plane for sessions, tools, events and channel connections.
- The [Control UI](https://omnipolymath.vercel.app/docs/web/control-ui), CLI and [TUI](https://omnipolymath.vercel.app/docs/web/tui) connect to the Gateway.
- [Channels](https://omnipolymath.vercel.app/docs/channels) bring the assistant to WhatsApp, Telegram, Slack, Discord, Google Chat, Signal, iMessage and other messaging services.
- [Companion apps and nodes](https://omnipolymath.vercel.app/docs/platforms) add voice, Canvas, camera, screen and device-local actions on supported platforms.
- The [Trust Firewall](extensions/trust-firewall/README.md) checks every tool call, model call and run.

Omnipolymath works with hosted and local [model providers](https://omnipolymath.vercel.app/docs/concepts/model-providers). [Tools](https://omnipolymath.vercel.app/docs/tools), [skills](https://omnipolymath.vercel.app/docs/tools/skills) and [plugins](https://omnipolymath.vercel.app/docs/plugins) extend what an assistant can do.

## Security

Treat inbound messages as untrusted input. DM-capable channels pair unknown senders by default; approve a pairing request with `omnipolymath pairing approve <channel> <code>`.

Read the [security guide](https://omnipolymath.vercel.app/docs/gateway/security), [exposure runbook](https://omnipolymath.vercel.app/docs/gateway/security/exposure-runbook) and [sandboxing guide](https://omnipolymath.vercel.app/docs/gateway/sandboxing) before connecting other users or exposing the Gateway remotely. Report vulnerabilities through [SECURITY.md](SECURITY.md).

## Documentation

| Goal                             | Start here                                                                                                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configure models and auth        | [Models](https://omnipolymath.vercel.app/docs/concepts/models) · [Model providers](https://omnipolymath.vercel.app/docs/concepts/model-providers)                                                                            |
| Connect a messaging service      | [Channels](https://omnipolymath.vercel.app/docs/channels)                                                                                                                                                                    |
| Add tools, skills and plugins    | [Tools](https://omnipolymath.vercel.app/docs/tools) · [Skills](https://omnipolymath.vercel.app/docs/tools/skills) · [Plugins](https://omnipolymath.vercel.app/docs/plugins)                                                  |
| Run apps and device nodes        | [Platforms](https://omnipolymath.vercel.app/docs/platforms) · [Nodes](https://omnipolymath.vercel.app/docs/nodes)                                                                                                            |
| Use the CLI and chat commands    | [CLI reference](https://omnipolymath.vercel.app/docs/cli) · [Slash commands](https://omnipolymath.vercel.app/docs/tools/slash-commands)                                                                                      |
| Configure or operate the Gateway | [Configuration](https://omnipolymath.vercel.app/docs/gateway/configuration) · [Architecture](https://omnipolymath.vercel.app/docs/concepts/architecture) · [Updating](https://omnipolymath.vercel.app/docs/install/updating) |

## Development

The repository is a pnpm workspace. Plain `npm install` at the repository root is not supported.

```bash
git clone https://github.com/krishnashahane/Omnipolymath.git
cd Omnipolymath
pnpm install
pnpm build
pnpm ui:build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and the [source setup guide](https://omnipolymath.vercel.app/docs/start/setup) for the development loop.

## Maintainer

Omnipolymath is built and maintained by **Krishna Shahane**.

- GitHub: [@krishnashahane](https://github.com/krishnashahane)
- LinkedIn: [krishna-shahane](https://www.linkedin.com/in/krishna-shahane-721522273/)
- X: [@krishnashahane_](https://x.com/krishnashahane_)
- Instagram: [@urstrulylkrishna](https://www.instagram.com/urstrulylkrishna/)

Use the [issue chooser](https://github.com/krishnashahane/Omnipolymath/issues/new/choose) for bugs and feature requests (questions welcome too).

## License

MIT licensed. See [LICENSE](LICENSE) for the copyright notices, and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party components.
