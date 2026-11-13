import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import type { OmnipolymathConfig } from "../config/config.js";
import { createConfigIO } from "../config/io.js";
import { collectGatewayConfigFindings } from "./audit-gateway-config.js";
import { collectSecretsInConfigFindings } from "./audit-secrets.js";
import { runSecurityAuditCore } from "./audit.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function collect(cfg: OmnipolymathConfig, sourceConfig = cfg, env: NodeJS.ProcessEnv = {}) {
  return collectGatewayConfigFindings(cfg, sourceConfig, env);
}
function finding(checkId: string, severity?: string) {
  return expect.objectContaining(severity ? { checkId, severity } : { checkId });
}
function lan(auth: NonNullable<OmnipolymathConfig["gateway"]>["auth"]): OmnipolymathConfig {
  return { gateway: { bind: "lan", auth } };
}
const secretRef = (id: string) => ({ source: "env", provider: "default", id }) as const;

describe("security audit gateway config findings", () => {
  it.each([
    ["env references", "${AUDIT_SECRET}", false],
    ["literal secret", "synthetic-audit-secret", true],
    ["escaped reference", "$${AUDIT_SECRET}", true],
  ] as const)("audits loaded %s by authored provenance", async (_name, value, stored) => {
    const stateDir = tempDirs.make("omnipolymath-audit-env-");
    const configPath = path.join(stateDir, "omnipolymath.json");
    const env = { OMNIPOLYMATH_STATE_DIR: stateDir, AUDIT_SECRET: "synthetic-audit-secret" };
    await fs.writeFile(
      configPath,
      JSON.stringify({
        gateway: { auth: { mode: "password", password: value } },
        hooks: { enabled: true, token: value },
      }),
    );
    const snapshot = await createConfigIO({
      configPath,
      env,
      homedir: () => stateDir,
      pluginValidation: "core-only",
      shellEnvFallback: "defer",
      observe: false,
    }).readConfigFileSnapshot();
    expect(snapshot.valid).toBe(true);
    const report = await runSecurityAuditCore({
      config: snapshot.config,
      sourceConfig: snapshot.sourceConfig,
      configPath,
      stateDir,
      env,
      workspaceDir: stateDir,
      includeFilesystem: false,
    });
    for (const checkId of [
      "config.secrets.gateway_password_in_config",
      "config.secrets.hooks_token_in_config",
    ]) {
      expect(report.findings.some((entry) => entry.checkId === checkId)).toBe(stored);
      expect(
        collectSecretsInConfigFindings(snapshot.config).some((entry) => entry.checkId === checkId),
      ).toBe(stored);
    }
  });

  it("does not allow Tailscale auth outside loopback", () => {
    const cfg: OmnipolymathConfig = {
      gateway: {
        ...lan({ allowTailscale: true }).gateway,
        tailscale: { mode: "serve" },
      },
    };
    expect(collect(cfg)).toContainEqual(finding("gateway.bind_no_auth", "critical"));
  });

  it.each(["token", "password"] as const)("flags a blank %s as critical", (credential) => {
    const cfg: OmnipolymathConfig = {
      gateway: {
        bind: "loopback",
        auth: { mode: credential, [credential]: "  " },
      },
    };
    const findings = collect(cfg);
    expect(findings).toContainEqual(finding(`gateway.${credential}_placeholder_value`, "critical"));
    // The placeholder finding replaces the misleading length-only warning.
    expect(findings).not.toContainEqual(finding(`gateway.${credential}_too_short`));
  });

  it("evaluates gateway auth presence and rate-limit guardrails", () => {
    const noAuth = finding("gateway.bind_no_auth");
    expect(collect(lan({}))).toContainEqual(finding("gateway.bind_no_auth", "critical"));

    expect(collect(lan({ password: secretRef("OMNIPOLYMATH_GATEWAY_PASSWORD") }))).not.toContainEqual(
      noAuth,
    );

    const sourceConfig: OmnipolymathConfig = {
      ...lan({ token: secretRef("OMNIPOLYMATH_GATEWAY_TOKEN") }),
      secrets: { providers: { default: { source: "env" } } },
    };
    const resolvedConfig = { ...lan({}), secrets: sourceConfig.secrets };
    expect(collect(resolvedConfig, sourceConfig)).not.toContainEqual(noAuth);

    expect(collect(lan({ token: "secret" }))).toContainEqual(
      finding("gateway.auth_no_rate_limit", "warn"),
    );
    const rateLimitedConfig = lan({
      token: "secret",
      rateLimit: { maxAttempts: 10, windowMs: 60_000, lockoutMs: 300_000 },
    });
    expect(collect(rateLimitedConfig)).not.toContainEqual(finding("gateway.auth_no_rate_limit"));
  });

  it("warns when OMNIPOLYMATH_GATEWAY_TOKEN shadows a different configured token source", () => {
    const cfg: OmnipolymathConfig = {
      gateway: { auth: { token: "config-token" } },
    };
    expect(collect(cfg, cfg, { OMNIPOLYMATH_GATEWAY_TOKEN: "env-token" })).toContainEqual(
      finding("gateway.env_token_overrides_config"),
    );
  });
});
