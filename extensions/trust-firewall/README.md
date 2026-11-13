# Trust Firewall

Sits between every Omnipolymath agent and your accounts. On by default.

| Layer | What it does |
| --- | --- |
| Least privilege | Per-agent tool allowlists and a global block list. |
| Approvals | Spend and irreversible actions (for example `rm -rf`, `git push --force`, `DROP TABLE`, deletes, payments) wait for your approval. No answer within the timeout means the action does not run. |
| Injection shield | Every tool result is scanned for hijack patterns. Results from untrusted sources (web, browser, email, chat, downloads) that the patterns don't flag also get a second opinion from your own model. Once a run reads suspicious content, every outbound or write action in that run needs approval, and risky calls wait for any check still running. If the model check fails, the log says so; the run is never silently marked clean. |
| Undo | Before `write`, `edit` or `apply_patch` runs, the firewall snapshots each target file (up to 10 MB, content-addressed, permissions kept) and records its hash after the call. `omnipolymath firewall undo <run>` restores the files newest-first and skips any file changed since the agent touched it unless you pass `--force`. |
| Action log | Every decision is appended to `<state dir>/trust-firewall/actions.jsonl`. Each line includes the SHA-256 of the previous line, so editing or deleting history is detectable. Secrets in parameters are redacted. |
| Dry run | `mode: "dry-run"` lets agents read and plan but never write, send or delete. |
| Spend cap | A hard daily cap on model spend (default $25), saved to disk so a restart doesn't reset it. When reached, new runs and non-read actions stop until the next day. |
| Agent wallets | Spend-tier tool calls that name an amount are charged against a per-agent, per-day wallet: a per-transaction limit (default $100), a daily limit (default $250) and an optional payee allowlist. Over-limit, disallowed-payee and non-USD calls are blocked; calls you deny or that fail are refunded. The wallet authorizes; the payment tool still moves the money. |
| Memory | Two optional tools, `fact_save` and `fact_search`: facts carry provenance and an integrity hash, decay over time, expire, de-duplicate and resolve contradictions. Facts saved during a suspicious run are stored at low confidence. |
| Skill checks | On every skill install, text files are scanned for dangerous permissions and a `SIGNATURE.json` publisher signature is verified. A bad signature always blocks; `requireSignature` and `blockHighRisk` can block unsigned or high-risk skills. |
| Cost routing | Optional: routine prompts go to a cheaper model and hard ones to your best model. |
| Receipts | Every run ends with a receipt in the Gateway log: what it did, what it cost, what changed, what was stopped, a digest that links it to the action log, and the undo command. |
| Sandbox reminder | At Gateway start, if Docker is available but the agent sandbox is off, the firewall logs the one command that turns it on. |

## Pricing

Spend is priced in this order:

1. `prices` in this plugin's config, if the model is listed.
2. Exact rates learned from the cost breakdown your provider reports with each response.
3. Built-in list prices copied from the provider catalogs in this repository (`src/prices.ts`).
4. `defaultPrice` (deliberately conservative), as a last resort.

## Commands

```bash
omnipolymath firewall status            # mode, today's spend, log health
omnipolymath firewall log --run <id>    # decisions for one run
omnipolymath firewall verify            # check the whole log's hash chain
omnipolymath firewall undo              # list runs with file changes
omnipolymath firewall undo <run> --dry-run
omnipolymath firewall undo <run>
omnipolymath firewall handoff keygen planner
omnipolymath firewall handoff issue --from planner --to booker --task "Book travel" --cap calendar:read email:send
omnipolymath firewall handoff verify envelope.json --as booker --trust planner=planner.pub.pem --need email:send
```

## Configuration

All fields are optional.

```json5
{
  plugins: {
    entries: {
      "trust-firewall": {
        config: {
          mode: "enforce", // "monitor" logs only, "dry-run" never writes
          approveTiers: ["spend", "irreversible"],
          taintedApproveTiers: ["external", "write"],
          blockedTools: [],
          agentToolAllowlist: { helper: ["read", "web_search"] },
          injection: {
            enabled: true,
            threshold: 0.5,
            classifier: { enabled: true, timeoutMs: 8000, maxChars: 12000, minConfidence: 0.6 },
          },
          dailySpendCapUsd: 25, // 0 turns the cap off
          prices: { "my-model": { inputPerMTok: 1, outputPerMTok: 4 } },
          defaultPrice: { inputPerMTok: 5, outputPerMTok: 25 },
          wallet: { enabled: true, perTransactionUsd: 100, dailyUsd: 250, allowedPayees: [] },
          memory: { enabled: true, halfLifeDays: 30, minConfidence: 0.2, maxFacts: 2000 },
          skills: {
            scanOnInstall: true,
            blockHighRisk: false,
            requireSignature: false,
            trustedPublishers: {}, // name -> PEM public key
          },
          snapshots: { enabled: true },
          sandboxNudge: true,
          routing: { enabled: false, routineModel: "<cheap model>", hardModel: "<best model>" },
          receipts: { enabled: true },
          approvalTimeoutMs: 120000,
        },
      },
    },
  },
}
```

Risk tiers, lowest to highest: `read`, `write`, `external`, `spend`, `irreversible`. Unknown tools are treated as `write`, never `read`.

The model check uses your agent's own model through the Gateway (no extra API key) and counts toward the spend cap. Turn it off with `injection.classifier.enabled: false`.

## Limits

Pattern scans and a model classifier reduce risk; they don't make an agent safe on their own. Keep approvals on, use the sandbox for untrusted sessions, and review receipts. Undo covers files changed by `write`, `edit` and `apply_patch`; it can't reverse shell commands, sent messages or payments, which is why those need approval.
