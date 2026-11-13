import { afterEach, beforeAll, beforeEach, expect, onTestFinished, vi } from "vitest";
import { createTempDirTracker } from "../../test/helpers/temp-dir.js";
import * as authStore from "../agents/auth-profiles/store-runtime.js";
import {
  fingerprintAuthProfileCredential,
  fingerprintResolvedProviderAuth,
} from "../agents/execution-auth-binding.js";
import * as harnessRegistry from "../agents/harness/registry.js";
import { committedConfigFiles as hostedConfigFiles } from "../commands/committed-config.test-support.js";
import { createTestConfigSnapshot } from "../commands/test-runtime-config-helpers.js";
import type { ConfigFileSnapshot, OmnipolymathConfig } from "../config/types.omnipolymath.js";
import type { runSetupMemoryImportStep } from "../wizard/setup.memory-import.js";
import { runSystemAgentTurn as runTurn } from "./agent-turn.js";
import {
  SystemAgentChatEngine as RuntimeSystemAgentChatEngine,
  type SystemAgentChatEngineOptions,
} from "./chat-engine.js";
import {
  resolveSystemAgentConfiguredRouteFromConfig as resolveRouteImpl,
  type SystemAgentConfiguredRoute,
  type SystemAgentConfigSnapshot,
} from "./inference-route.js";
import type { SystemAgentOverview } from "./overview.js";
import {
  createSystemAgentVerifiedInferenceTestFixture as makeFixtureImpl,
  createSystemAgentPluginMetadataTestSnapshot as prepareMetadata,
  type SystemAgentPluginMetadataTestSnapshot,
} from "./system-agent.test-helpers.js";
import {
  createSystemAgentVerifiedInferenceBinding as bindInference,
  type SystemAgentVerifiedInferenceBinding,
} from "./verified-inference.js";
import { profileStore, requireFingerprint } from "./verified-inference.test-support.js";

const mocks = vi.hoisted(() => ({
  readConfigFileSnapshot: vi.fn(async () => configSnapshot({})),
  readSetupConfigFileSnapshot: vi.fn(),
  setupChannels: vi.fn(),
  setupSkills: vi.fn(),
  runSearchSetupFlow: vi.fn(),
  runSetupMemoryImportStep: vi.fn(),
  writeWizardConfigFile: vi.fn(),
  sharedVerifiedInference: undefined as SystemAgentVerifiedInferenceBinding | undefined,
}));

export type MemoryImportStepParams = Parameters<typeof runSetupMemoryImportStep>[0];

vi.mock("../config/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config/config.js")>()),
  readConfigFileSnapshot: mocks.readConfigFileSnapshot,
}));

vi.mock("../wizard/setup.shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../wizard/setup.shared.js")>()),
  readSetupConfigFileSnapshot: mocks.readSetupConfigFileSnapshot,
  writeWizardConfigFile: mocks.writeWizardConfigFile,
}));

vi.mock("../flows/channel-setup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flows/channel-setup.js")>()),
  setupChannels: mocks.setupChannels,
}));

vi.mock("../commands/onboard-skills.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../commands/onboard-skills.js")>()),
  setupSkills: mocks.setupSkills,
}));

vi.mock("../flows/search-setup.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../flows/search-setup.js")>()),
  runSearchSetupFlow: mocks.runSearchSetupFlow,
}));

vi.mock("../wizard/setup.memory-import.js", () => ({
  runSetupMemoryImportStep: mocks.runSetupMemoryImportStep,
}));

vi.mock("./verified-inference.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verified-inference.js")>();
  return {
    ...actual,
    resolveSystemAgentVerifiedInferenceRoute: (
      ...args: Parameters<typeof actual.resolveSystemAgentVerifiedInferenceRoute>
    ) => {
      // Most cases own chat state, not inference ownership. Explicit bindings
      // still run the real resolver so every drift and apply-boundary test stays end-to-end.
      if (args[0] === mocks.sharedVerifiedInference) {
        return Promise.resolve(args[0].execution);
      }
      return actual.resolveSystemAgentVerifiedInferenceRoute(...args);
    },
  };
});

const tempDirs = createTempDirTracker();

export const sharedVerifiedInferenceConfig = {
  agents: {
    entries: {
      main: {
        agentDir: "/tmp/omnipolymath-omnipolymath-chat-engine-agent",
        model: "openai/gpt-5.5",
      },
    },
  },
  models: {
    providers: {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        auth: "api-key",
        models: [],
      },
    },
  },
} satisfies OmnipolymathConfig;

let sharedFixture: Awaited<ReturnType<typeof makeFixtureImpl>>;
let pluginMetadataSnapshot: SystemAgentPluginMetadataTestSnapshot | undefined;

function scoped<Args extends unknown[], Result>(
  run: (...args: Args) => Result,
  config?: (args: Args) => OmnipolymathConfig,
) {
  return (...args: Args) => pluginMetadataSnapshot!.run(() => run(...args), config?.(args));
}

const resolveRoute = scoped(resolveRouteImpl, ([config]) => config);
const makeFixture = scoped(makeFixtureImpl, ([config]) => config);
const makeBinding = scoped(bindInference);
export const runSystemAgentTurn = scoped(runTurn);

export { makeFixture as createSystemAgentVerifiedInferenceTestFixture };

export function useTempStateDir(): string {
  const dir = tempDirs.make("omnipolymath-engine-");
  vi.stubEnv("OMNIPOLYMATH_STATE_DIR", dir);
  return dir;
}

export function configSnapshot(config: OmnipolymathConfig): ConfigFileSnapshot {
  return {
    ...createTestConfigSnapshot(config),
    hash: "h",
    raw: null,
    parsed: config,
  };
}

const sharedSnapshot = () => configSnapshot(structuredClone(sharedVerifiedInferenceConfig));

function testHarnessBinding(route: SystemAgentConfiguredRoute) {
  if (route.runner !== "embedded") {
    return { auth: {} };
  }
  const id =
    route.agentHarnessRuntimeOverride === "auto"
      ? "omnipolymath"
      : (route.agentHarnessRuntimeOverride ?? "codex");
  if (id === "omnipolymath") {
    return { auth: { agentHarnessId: id } };
  }
  vi.spyOn(harnessRegistry, "getRegisteredAgentHarness").mockImplementation((harnessId) =>
    harnessId === id
      ? {
          harness: {
            id,
            label: id,
            supports: () => ({ supported: true }),
            runAttempt: async () => {
              throw new Error("Synthetic chat never runs a harness");
            },
            runtimeArtifact: { validate: async () => true },
          },
        }
      : undefined,
  );
  return {
    auth: {
      agentHarnessId: id,
      runtimeOwnerKind: "plugin-harness" as const,
      runtimeOwnerId: id,
      runtimeArtifactId: `${id}-test-artifact`,
      runtimeArtifactFingerprint: `${id}-test-fingerprint`,
    },
  };
}

type ProfileCredential = Parameters<typeof fingerprintAuthProfileCredential>[0]["credential"];

async function createVerifiedBinding(
  config: OmnipolymathConfig,
  credential?: ProfileCredential,
  snapshot?: SystemAgentConfigSnapshot,
) {
  const route = await resolveRoute(config, undefined, {}, snapshot);
  if (!route) {
    throw new Error("missing test route");
  }
  const profileId = "anthropic:oauth";
  const authFingerprint = requireFingerprint(
    credential
      ? fingerprintAuthProfileCredential({ profileId, credential })
      : fingerprintResolvedProviderAuth({
          apiKey: "test-key",
          source: "models.json",
          mode: "api-key",
        }),
  );
  const harness = testHarnessBinding(route);
  const auth: Parameters<typeof makeBinding>[0]["auth"] = { authFingerprint, ...harness.auth };
  if (credential) {
    auth.authProfileId = profileId;
    vi.spyOn(authStore, "loadAuthProfileStoreForRuntimeAsync").mockImplementation(
      profileStore(profileId, credential),
    );
  } else {
    auth.modelId = route.model;
    auth.modelApi = route.provider === "anthropic" ? "anthropic-messages" : "openai-responses";
  }
  return makeBinding({ configuredRoute: route, executionRoute: route, auth });
}

export const createAmbientVerifiedBinding = (
  config: OmnipolymathConfig,
  snapshot?: SystemAgentConfigSnapshot,
) => createVerifiedBinding(config, undefined, snapshot);

export const createOAuthVerifiedBinding = (
  config: OmnipolymathConfig,
  credential: ProfileCredential,
  snapshot?: SystemAgentConfigSnapshot,
) => createVerifiedBinding(config, credential, snapshot);

type TestSystemAgentChatEngineOptions = Omit<SystemAgentChatEngineOptions, "verifiedInference"> & {
  verifiedInference?: SystemAgentVerifiedInferenceBinding;
};

export class SystemAgentChatEngine extends RuntimeSystemAgentChatEngine {
  override answerWizard = scoped(super.answerWizard.bind(this));
  override cancelWizard = scoped(super.cancelWizard.bind(this));
  override resolveOperatorApproval = scoped(super.resolveOperatorApproval.bind(this));
  override loadOverview = scoped(super.loadOverview.bind(this));
  override planGreeting = scoped(super.planGreeting.bind(this));
  override seedHistory = scoped(super.seedHistory.bind(this));
  override propose = scoped(super.propose.bind(this));
  override handle = scoped(super.handle.bind(this));

  constructor(opts: TestSystemAgentChatEngineOptions = {}) {
    const explicitBinding = opts.verifiedInference;
    super({
      ...opts,
      verifiedInference: explicitBinding ?? sharedFixture.binding,
    });
  }
}

export function createChatEngine(options: TestSystemAgentChatEngineOptions = {}, dispose = false) {
  const engine = new SystemAgentChatEngine({
    ...options,
    deps: { loadOverview: fakeOverviewLoader(), ...options.deps },
  });
  if (dispose) {
    onTestFinished(() => engine.dispose());
  }
  return engine;
}

export function inferenceConfig(model = "openai/gpt-5.5"): OmnipolymathConfig {
  return {
    agents: { defaults: { model } },
    models: { providers: structuredClone(sharedVerifiedInferenceConfig.models.providers) },
  };
}

export function setupResult() {
  return {
    configPath: "/tmp/omnipolymath.json",
    configHashBefore: "before",
    configHashAfter: "after",
    bootstrapPending: true,
    workspaceReady: true,
    gateway: { status: "ready" as const, action: "reused" as const },
    lines: ["Workspace: /tmp/hatch-work"],
  };
}

export async function advanceGatewayWizardToSecretStorage(engine: SystemAgentChatEngine) {
  const portStep = await engine.handle("configure gateway");
  expect((await engine.handle("19001")).text).toContain("Gateway bind address");
  expect((await engine.handle("2")).text).toContain("Tailscale exposure");
  const storageStep = await engine.handle("1");
  expect(storageStep.text).toContain("store the Gateway");
  return { portStep, storageStep };
}

beforeAll(() => {
  pluginMetadataSnapshot = prepareMetadata(sharedVerifiedInferenceConfig);
});

beforeEach(async () => {
  sharedFixture = await makeFixture(sharedVerifiedInferenceConfig);
  mocks.sharedVerifiedInference = sharedFixture.binding;
  mocks.readConfigFileSnapshot.mockResolvedValue(sharedSnapshot());
});

afterEach(() => {
  hostedConfigFiles.clear();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.readConfigFileSnapshot.mockResolvedValue(sharedSnapshot());
  mocks.readSetupConfigFileSnapshot.mockReset();
  mocks.setupChannels.mockReset();
  mocks.setupSkills.mockReset();
  mocks.runSearchSetupFlow.mockReset();
  mocks.runSetupMemoryImportStep.mockReset();
  mocks.writeWizardConfigFile.mockReset();
  tempDirs.cleanup();
});

export const CANCEL_HINT = "Say `cancel` to stop this setup.";
export const countCancelHints = (text: string) => text.split(CANCEL_HINT).length - 1;

export const fakeOverviewLoader =
  (
    overrides: {
      defaultModel?: string;
      setupModel?: string;
      claudeFound?: boolean;
      codexFound?: boolean;
    } = {},
  ) =>
  async (): Promise<SystemAgentOverview> => ({
    config: { path: "/tmp/omnipolymath.json", exists: false, valid: true, issues: [], hash: null },
    agents: [],
    defaultAgentId: "main",
    defaultModel: overrides.defaultModel,
    ...(overrides.setupModel ? { setupModel: overrides.setupModel } : {}),
    tools: {
      codex: { command: "codex", found: overrides.codexFound ?? false },
      claude: { command: "claude", found: overrides.claudeFound ?? false },
      gemini: { command: "gemini", found: false },
      apiKeys: { openai: false, anthropic: false },
    },
    gateway: { url: "ws://127.0.0.1:18789", source: "local", reachable: false },
    references: {
      docsUrl: "https://omnipolymath.vercel.app/docs",
      sourceUrl: "https://github.com/krishnashahane/Omnipolymath",
    },
  });

export { expectDefined } from "@omnipolymath/normalization-core";
export { hashSystemAgentOperation } from "./operator-approval.js";
export type { OmnipolymathConfig };
export type { WizardPrompter } from "../wizard/prompts.js";
export { classifySystemAgentApprovalText } from "./operator-approval.js";
export { SystemAgentWizardAnswerError } from "./chat-engine.js";
export type { SystemAgentChatEngineOptions } from "./chat-engine.js";
export { SystemAgentInferenceUnavailableError } from "./inference-error.js";
export { RuntimeSystemAgentChatEngine, mocks };
export { operationMocks } from "./chat-engine.mocks.test-support.js";
