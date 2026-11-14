import {
  buildJsonPluginConfigSchema,
  definePluginEntry,
  type AnyAgentTool,
} from "omnipolymath/plugin-sdk/plugin-entry";
import { runCommandWithTimeout } from "omnipolymath/plugin-sdk/process-runtime";
import { resolveSandboxRuntimeStatusAsync } from "omnipolymath/plugin-sdk/sandbox";
import manifest from "./omnipolymath.plugin.json" with { type: "json" };
import type { CompleteFn } from "./src/classifier.js";
import { firewallPaths, type FirewallPaths } from "./src/cli.js";
import { parseConfig } from "./src/config.js";
import { TrustFirewall } from "./src/firewall.js";
import { FactStore, createFactTools } from "./src/memory-tools.js";
import { formatReceipt } from "./src/receipt.js";
import { isShellTool } from "./src/risk.js";
import { checkSkillInstall } from "./src/skill-install.js";

/**
 * Trust Firewall — sits between every agent and your accounts.
 *
 * - Least privilege + approval before irreversible or spend actions.
 * - Prompt-injection shield: pattern scan plus a model second opinion, with
 *   taint-aware approvals for the rest of the run.
 * - Tamper-evident action log, dry-run mode, and file snapshots so runs that
 *   used write/edit/apply_patch can be undone (`omnipolymath firewall undo`).
 * - Daily spend cap priced from the host's own cost accounting; per-agent
 *   wallets enforce per-transaction and daily limits on spend tools.
 * - Self-cleaning, injection-aware memory tools; skill scans and signature
 *   checks at install time; a receipt at the end of every run.
 */
export default definePluginEntry({
  id: manifest.id,
  name: manifest.name,
  description: manifest.description,
  configSchema: buildJsonPluginConfigSchema(manifest.configSchema),
  register(api) {
    const config = parseConfig(api.pluginConfig);
    let paths: FirewallPaths | undefined;
    try {
      paths = firewallPaths(api.runtime.state.resolveStateDir(process.env));
    } catch {
      paths = undefined; // test hosts without a state dir keep everything in memory
    }

    const complete: CompleteFn = async (params) => {
      const result = await api.runtime.llm.complete({
        messages: params.messages,
        model: params.model,
        maxTokens: params.maxTokens,
        temperature: params.temperature,
        purpose: params.purpose,
        agentId: params.agentId,
        signal: params.signal,
      });
      return { text: result.text, usage: { costUsd: result.usage?.costUsd } };
    };

    const firewall = new TrustFirewall(config, {
      logFile: paths?.logFile,
      spendFile: paths?.spendFile,
      snapshotDir: paths?.snapshotDir,
      complete,
    });

    const workspaceFor = (agentId?: string): string | undefined => {
      try {
        return api.runtime.agent.resolveAgentWorkspaceDir(api.config, agentId ?? "main");
      } catch {
        return undefined;
      }
    };

    api.on("before_agent_run", () => {
      const cap = firewall.capStatus();
      if (cap.reached && config.mode !== "monitor") {
        return {
          outcome: "block",
          reason: "daily spend cap reached",
          message: `Daily spend cap of $${cap.capUsd.toFixed(2)} reached ($${cap.spentUsd.toFixed(2)} spent). Raise plugins.entries.trust-firewall.config.dailySpendCapUsd or wait until tomorrow.`,
          category: "cost_limit",
        };
      }
      return { outcome: "pass" };
    });

    api.on("before_model_resolve", (event) =>
      firewall.route(event.prompt, event.attachments?.length ?? 0),
    );

    /** Whether a shell call runs in the sandbox; anything unproven counts as the host. */
    const sandboxedFor = async (
      toolName: string,
      ctx: { agentId?: string; sessionKey?: string },
    ): Promise<boolean | undefined> => {
      if (!isShellTool(toolName) || config.unsandboxedShell === "allow") {
        return undefined;
      }
      try {
        const status = await resolveSandboxRuntimeStatusAsync({
          cfg: api.config,
          sessionKey: ctx.sessionKey,
          agentId: ctx.agentId,
        });
        return status.sandboxed;
      } catch {
        return false;
      }
    };

    if (config.execEnv.disableCloudMetadata) {
      // Cloud SDKs inside agent shells must never pick up instance credentials.
      api.on("resolve_exec_env", () => ({ AWS_EC2_METADATA_DISABLED: "true" }));
    }

    api.on("before_tool_call", async (event, ctx) => {
      const runId = event.runId ?? ctx.runId;
      const sandboxed = await sandboxedFor(event.toolName, ctx);
      // A model second opinion on untrusted content may still be running; let it land first.
      await firewall.awaitChecks(runId);
      const decision = firewall.beforeToolCall(
        {
          toolName: event.toolName,
          params: event.params ?? {},
          runId,
          agentId: ctx.agentId,
          derivedPaths: event.derivedPaths,
          workspaceDir: workspaceFor(ctx.agentId),
          sandboxed,
        },
        event.toolCallId ?? ctx.toolCallId,
      );
      if (decision.kind === "allow") {
        return undefined;
      }
      if (decision.kind === "block") {
        return { block: true, blockReason: `Trust Firewall: ${decision.reason}` };
      }
      return {
        requireApproval: {
          title: decision.title,
          description: decision.description,
          severity: decision.severity,
          timeoutMs: config.approvalTimeoutMs,
          timeoutReason: "Trust Firewall: no approval received in time, so the action did not run.",
          allowedDecisions: ["allow-once", "deny"],
          pluginId: manifest.id,
          onResolution: (resolution) => {
            firewall.resolveApproval(decision.entry, resolution);
          },
        },
      };
    });

    api.on("after_tool_call", (event, ctx) => {
      const scan = firewall.afterToolCall({
        toolName: event.toolName,
        runId: event.runId ?? ctx.runId,
        toolCallId: event.toolCallId ?? ctx.toolCallId,
        result: event.result,
        error: event.error,
        durationMs: event.durationMs,
        agentId: ctx.agentId,
      });
      if (scan?.flagged) {
        api.logger.warn(
          `trust-firewall: possible prompt injection in ${event.toolName} output (score ${scan.score}: ${scan.signals.map((s) => s.id).join(", ")}); risky actions in this run now need approval`,
        );
      }
    });

    api.on("llm_output", (event) => {
      firewall.recordUsage(
        event.resolvedRef ?? `${event.provider}/${event.model}`,
        event.usage,
        event.runId,
        event.lastAssistant,
      );
    });

    api.on("agent_end", (event, ctx) => {
      const runId = event.runId ?? ctx.runId;
      if (!runId || !config.receipts.enabled) {
        return;
      }
      const undoable = firewall.log.undoPlan(runId).length > 0;
      const receipt = firewall.finishRun({
        runId,
        agentId: ctx.agentId,
        success: event.success,
        durationMs: event.durationMs,
      });
      const text = formatReceipt(receipt);
      api.logger.info(
        `trust-firewall receipt\n${text}${undoable ? `\nUndo: omnipolymath firewall undo ${runId.slice(0, 12)}` : ""}`,
      );
    });

    if (config.skills.scanOnInstall) {
      api.on("before_install", (event) => {
        if (event.targetType !== "skill") {
          return undefined;
        }
        const result = checkSkillInstall(event.sourcePath, config.skills);
        return {
          findings: result.findings,
          ...(result.block ? { block: true, blockReason: `Trust Firewall: ${result.block}` } : {}),
        };
      });
    }

    if (config.memory.enabled) {
      const store = new FactStore({
        file: paths ? `${paths.dir}/memory.json` : undefined,
        halfLifeDays: config.memory.halfLifeDays,
        minConfidence: config.memory.minConfidence,
        maxFacts: config.memory.maxFacts,
        isTainted: (runId) => firewall.isTainted(runId),
      });
      api.registerTool(
        (ctx) =>
          createFactTools(store, {
            agentId: ctx.agentId,
            runId: ctx.runId,
          }) as unknown as AnyAgentTool[],
        { names: ["fact_save", "fact_search"], optional: true, workspaceAccess: false },
      );
    }

    if (paths) {
      const cliPaths = paths;
      api.registerCli(
        async ({ program }) => {
          const { registerFirewallCli } = await import("./src/cli.js");
          registerFirewallCli(program, { paths: cliPaths, config });
        },
        {
          descriptors: [
            {
              name: "firewall",
              description: "Inspect, verify and undo what agents did (Trust Firewall)",
              hasSubcommands: true,
            },
          ],
        },
      );
    }

    if (config.sandboxNudge) {
      api.on("gateway_start", async () => {
        const mode = api.config.agents?.defaults?.sandbox?.mode ?? "off";
        if (mode !== "off") {
          return;
        }
        try {
          const docker = await runCommandWithTimeout(
            ["docker", "version", "--format", "{{.Server.Version}}"],
            { timeoutMs: 3_000 },
          );
          if (docker.code === 0 && docker.stdout.trim()) {
            api.logger.warn(
              `trust-firewall: Docker ${docker.stdout.trim()} is available but the agent sandbox is off, so shell commands run directly on this machine. Turn it on with: omnipolymath config set agents.defaults.sandbox.mode non-main`,
            );
          }
        } catch {
          // Docker not installed: the host guard below is the remaining protection.
        }
        if (config.unsandboxedShell !== "allow") {
          api.logger.info(
            `trust-firewall: the agent sandbox is off, so shell commands that change this machine (sudo, system files, global installs, services, ssh keys) need your approval (unsandboxedShell=${config.unsandboxedShell}).`,
          );
        }
      });
    }
  },
});
