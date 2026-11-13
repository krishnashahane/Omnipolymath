import { afterEach, beforeEach, expect, it } from "vitest";
import { closeOmnipolymathStateDatabaseAsync } from "../../state/omnipolymath-state-db-cache.js";
import {
  createOmnipolymathTestState,
  type OmnipolymathTestState,
} from "../../test-utils/omnipolymath-test-state.js";
import {
  listSecretStoreEntries,
  readSecretStoreValue,
  writeSecretStoreEntry,
  writeSecretStoreEntryForConfigRef,
} from "./secret-store.js";

const team = { kind: "team" } as const;
let state: OmnipolymathTestState;

beforeEach(async () => {
  state = await createOmnipolymathTestState({ prefix: "secret-config-ref-worker-", applyEnv: true });
});
afterEach(async () => {
  await closeOmnipolymathStateDatabaseAsync();
  await state.cleanup();
});

it("saves a chat secret beside an existing entry without touching it", async () => {
  await writeSecretStoreEntry({
    scope: team,
    name: "GATEWAY_REMOTE_TOKEN",
    value: "owned-elsewhere",
    kind: "secret",
    updatedBy: "cli",
  });

  const name = await writeSecretStoreEntryForConfigRef({
    baseName: "GATEWAY_REMOTE_TOKEN",
    value: "from-chat",
    updatedBy: "omnipolymath",
    assertCurrent: () => {},
  });

  expect(name).toMatch(/^GATEWAY_REMOTE_TOKEN_[0-9A-F]{16}$/);
  expect(await readSecretStoreValue({ scope: team, name })).toEqual({
    ok: true,
    value: "from-chat",
  });
  expect(await readSecretStoreValue({ scope: team, name: "GATEWAY_REMOTE_TOKEN" })).toEqual({
    ok: true,
    value: "owned-elsewhere",
  });
});

it("writes nothing when the requester is revoked after the caller's check", async () => {
  let checks = 0;

  await expect(
    writeSecretStoreEntryForConfigRef({
      baseName: "GATEWAY_REMOTE_TOKEN",
      value: "from-chat",
      updatedBy: "omnipolymath",
      assertCurrent: () => {
        checks += 1;
        if (checks > 1) {
          throw new Error("requesting run is no longer active");
        }
      },
    }),
  ).rejects.toThrow("no longer active");

  expect(await listSecretStoreEntries({ scope: team, includeDeleted: true })).toEqual([]);
});
