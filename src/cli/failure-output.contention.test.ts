import { expect, it } from "vitest";
import { GatewayStateOwnerContentionError } from "../infra/gateway-state-owner.js";
import { StartupMaintenanceRequiredError } from "../infra/startup-maintenance-required.js";
import { DoctorUnreadableStateDatabaseError } from "../infra/state-repair-message.js";
import { OmnipolymathDatabaseSchemaPreflightError } from "../state/omnipolymath-database-preflight.messages.js";
import { formatCliFailureLines, formatCliJsonFailure } from "./failure-output.js";

it("preserves a worker migration refusal and its recovery command", () => {
  const cause = new StartupMaintenanceRequiredError(
    "state-migrations",
    "this CLI is 2026.10.8 but the Gateway service runs 2026.10.3 from /old; run omnipolymath update (or the CLI from /old)",
  );
  const error = new Error("config health failed", { cause });
  expect(formatCliFailureLines({ title: "Command failed", error, env: {} })).toEqual([
    "[omnipolymath] Command failed",
    `[omnipolymath] Reason: ${cause.message}`,
  ]);
});

it.each([
  new DoctorUnreadableStateDatabaseError("/state/omnipolymath.sqlite", "unreadable"),
  new OmnipolymathDatabaseSchemaPreflightError([
    { kind: "state", path: "/state/omnipolymath.sqlite", foundVersion: 20, supportedVersion: 19 },
  ]),
])("preserves the manual recovery when Doctor cannot repair $name", (error) => {
  const output = formatCliFailureLines({ title: "Command failed", error, env: {} }).join("\n");
  expect(output).toContain("restore");
  expect(output).toContain("backup");
  expect(output).not.toContain("For help, run `omnipolymath doctor`");
});

it.each(["nested", "message-only"])(
  "preserves %s contention output and classifies the Doctor hint by error identity",
  (kind) => {
    const cause = new GatewayStateOwnerContentionError("/synthetic/omnipolymath.sqlite");
    const error =
      kind === "nested"
        ? new AggregateError(
            [new Error(`Task registry restore failed: ${cause.message}`, { cause })],
            cause.message,
          )
        : new Error(cause.message);
    expect(formatCliJsonFailure(error, { env: {} })).toEqual({
      ok: false,
      error: { type: "cli_error", message: error.message },
    });
    expect(formatCliFailureLines({ title: "The CLI command failed.", error, env: {} })).toEqual([
      "[omnipolymath] The CLI command failed.",
      kind === "nested"
        ? "[omnipolymath] Another Omnipolymath process is using your data. Wait for it to finish before trying again."
        : "[omnipolymath] For help, run `omnipolymath doctor`.",
    ]);
    expect(error.message).toContain("Wait for the other Omnipolymath process to finish, then retry.");
  },
);
