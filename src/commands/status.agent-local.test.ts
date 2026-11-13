import { expect, it } from "vitest";
import { withOmnipolymathTestState } from "../test-utils/omnipolymath-test-state.js";
import { buildStatusCommandOverviewRows } from "./status-overview-rows.ts";
import { collectStatusLocalSnapshot } from "./status.agent-local.js";
import { createStatusCommandOverviewRowsParams } from "./status.test-support.ts";

it("does not project the gateway's compatibility id as an explicit fleet default", async () => {
  await withOmnipolymathTestState({ label: "status-explicit-fleet" }, async () => {
    const prepared = await collectStatusLocalSnapshot({
      agents: { ownership: "explicit", entries: { alpha: {}, beta: {} } },
    });
    const agentStatus = prepared.publish();
    expect(agentStatus).toMatchObject({
      defaultId: null,
      ownership: "explicit",
      selectionRequired: true,
      agents: [{ id: "alpha" }, { id: "beta" }],
    });
    const rows = buildStatusCommandOverviewRows(
      createStatusCommandOverviewRowsParams({ agentStatus }),
    );
    expect(rows.find(({ Item }) => Item === "Agents")?.Value).toBe(
      "2 · no workspaces bootstrapping · sessions 0",
    );
  });
});
