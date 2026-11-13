import { closeOmnipolymathStateDatabaseAsync } from "omnipolymath/plugin-sdk/sqlite-runtime-testing";
import { afterAll, afterEach, vi } from "vitest";

afterEach(async () => {
  await closeOmnipolymathStateDatabaseAsync();
});

afterAll(() => {
  vi.doUnmock("./reply-dispatcher.js");
  vi.doUnmock("./reasoning-preview.js");
  vi.doUnmock("./send.js");
  vi.doUnmock("./media.js");
  vi.doUnmock("omnipolymath/plugin-sdk/media-runtime");
  vi.doUnmock("./client.js");
  vi.doUnmock("./bot-name.js");
  vi.doUnmock("omnipolymath/plugin-sdk/conversation-runtime");
  vi.resetModules();
});
