import { expect, it, vi } from "vitest";
import { prepareEmbeddedRunSession } from "../../agents/embedded-agent-runner/run/session-bootstrap.js";
import {
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/runtime-snapshot.js";
import { replaceSessionEntry } from "../../config/sessions/session-accessor.js";
import { resolveSqliteTargetFromSessionStorePath } from "../../config/sessions/session-sqlite-target.js";
import type { OmnipolymathConfig } from "../../config/types.omnipolymath.js";
import * as nodeSqlite from "../../infra/node-sqlite.js";
import { unregisterOmnipolymathAgentDatabase } from "../../state/omnipolymath-agent-db-registry.js";
import {
  closeOmnipolymathAgentDatabaseByPathAsync,
  isOmnipolymathAgentDatabaseOpen,
} from "../../state/omnipolymath-agent-db.js";
import { withOmnipolymathTestState } from "../../test-utils/omnipolymath-test-state.js";
import { createDirectChatContext } from "../server-chat.agent-events.test-helpers.js";
import { prepareAgentRequestRouting } from "./agent-request-routing.js";

async function route(
  cfg: OmnipolymathConfig,
  request: Parameters<typeof prepareAgentRequestRouting>[0]["request"],
) {
  const respond = vi.fn();
  const routing = await prepareAgentRequestRouting({
    cfg,
    request,
    runId: request.idempotencyKey,
    context: createDirectChatContext({ getRuntimeConfig: () => cfg }),
    respond,
    isRawModelRun: false,
    agentDedupeKeys: [`agent:${request.idempotencyKey}`],
    reserveDedupe: vi.fn(),
    bindDedupeSessionTarget: vi.fn(),
    clearDedupe: vi.fn(),
  });
  expect(respond).not.toHaveBeenCalled();
  return routing;
}

it.each([
  { caller: "creation", createSessionIfMissing: false },
  { caller: "creation", createSessionIfMissing: true },
  { caller: "Gateway", createSessionIfMissing: false },
  { caller: "Gateway", createSessionIfMissing: true },
  { caller: "embedded", createSessionIfMissing: false },
])(
  "routes $caller session IDs (createSessionIfMissing=$createSessionIfMissing)",
  async ({ caller, createSessionIfMissing }) => {
    await withOmnipolymathTestState({ label: "session-id-routing" }, async (state) => {
      const storePath = state.statePath("sessions.json");
      const cfg: OmnipolymathConfig = {
        agents:
          caller === "creation"
            ? { entries: { main: {} } }
            : { ownership: "explicit", entries: { main: {}, ops: {} } },
        session: { store: storePath },
      };
      await state.writeConfig(cfg);
      setRuntimeConfigSnapshot(cfg);
      try {
        if (caller === "creation") {
          await replaceSessionEntry(
            { agentId: "main", storePath, sessionKey: "agent:main:existing" },
            { sessionId: "existing-id", updatedAt: 1 },
          );
          expect(
            await route(cfg, {
              message: "start a named session",
              agentId: "main",
              sessionId: "new-id",
              createSessionIfMissing,
              idempotencyKey: "creation",
            }),
          ).toMatchObject({
            agentId: "main",
            requestedSessionId: "new-id",
            requestedSessionKey: createSessionIfMissing ? "agent:main:explicit:new-id" : undefined,
          });
          return;
        }
        const sessionKey = caller === "embedded" ? "unknown" : "global";
        for (const agentId of ["main", "ops"]) {
          await replaceSessionEntry(
            { agentId, storePath, sessionKey },
            { sessionId: `${agentId}-session`, updatedAt: 1 },
          );
          const target = resolveSqliteTargetFromSessionStorePath(storePath, { agentId });
          await closeOmnipolymathAgentDatabaseByPathAsync(target.path);
          unregisterOmnipolymathAgentDatabase({ agentId, path: target.path });
          expect(isOmnipolymathAgentDatabaseOpen(target.path)).toBe(false);
        }
        const openDatabase = vi.spyOn(nodeSqlite, "openNodeSqliteDatabase");
        if (caller === "Gateway") {
          expect(
            await route(cfg, {
              message: "resume",
              sessionId: "ops-session",
              createSessionIfMissing,
              idempotencyKey: "lookup",
            }),
          ).toMatchObject({ agentId: "ops", requestedSessionKey: sessionKey });
        } else {
          const prepared = await prepareEmbeddedRunSession({
            config: cfg,
            sessionId: "ops-session",
            sessionFile: sessionKey,
            workspaceDir: state.workspaceDir,
            prompt: "resume",
            runId: "lookup",
            timeoutMs: 1000,
          });
          expect(prepared.params).toMatchObject({ sessionKey, agentId: "ops" });
        }
        expect(openDatabase).not.toHaveBeenCalled();
      } finally {
        vi.restoreAllMocks();
        clearRuntimeConfigSnapshot();
      }
    });
  },
);
