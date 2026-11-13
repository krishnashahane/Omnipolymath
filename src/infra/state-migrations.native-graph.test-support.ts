import { expect, vi } from "vitest";

// Load one native migration graph before the suite and after resetModules.
export async function importStateMigrationFixtureGraph() {
  const sessionMeta = await import("../acp/runtime/session-meta-readonly.js");
  const agentScope = await import("../agents/agent-scope.js");
  const workspaceLegacy = await import("../agents/workspace-legacy-state.js");
  const workspaceStore = await import("../agents/workspace-state-store.js");
  const ingress = await import("../channels/message/ingress-queue.js");
  const legacyAgent = await import("../config/legacy.default-agent-owner.js");
  const sessions = await import("../config/sessions/session-accessor.js");
  const sessionEntries = await import("../config/sessions/session-accessor.sqlite-entry-store.js");
  const memoryEvents = await import("../memory-host-sdk/events.js");
  const nodeConfig = await import("../node-host/config.js");
  const pairing = await import("../pairing/pairing-store-sqlite.test-helpers.js");
  const pluginDoctor = await import("../plugin-sdk/runtime-doctor-migrations.js");
  const legacySurfaces = await import("../plugins/legacy-session-surfaces.types.js");
  const pluginRuntime = await import("../plugins/runtime.js");
  const configState = await import("../state/config-machine-state.js");
  const agentRegistry = await import("../state/omnipolymath-agent-db-registry.js");
  const agentDb = await import("../state/omnipolymath-agent-db.js");
  const stateContract = await import("../state/omnipolymath-state-db-contract.js");
  const stateDb = await import("../state/omnipolymath-state-db.js");
  const statePaths = await import("../state/omnipolymath-state-db.paths.js");
  const stateSchema = await import("../state/omnipolymath-state-schema.test-support.js");
  const channelFixtures = await import("../test-utils/channel-plugins.js");
  const databaseCleanup = await import("../test-utils/database-cleanup.js");
  const locks = await import("./state-migrations.gateway-lock.test-support.js");
  const sql = await import("./kysely-sync.js");
  const apns = await import("./push-apns.js");
  const migrationLease = await import("./startup-migration-checkpoint.js");
  const daemonPins = await import("./state-migrations.daemon-runtime-pins.js");
  const doctor = await import("./state-migrations.doctor.js");
  const files = await import("./state-migrations.filesystem.test-support.js");
  const ingressLifecycle = await import("./state-migrations.ingress-lifecycle.test-support.js");
  const audit = await import("./state-migrations.legacy-audit.test-support.js");
  const sessionStore = await import("./state-migrations.legacy-session-store.js");
  const messages = await import("./state-migrations.messages.js");
  const pluginMigrations = await import("./state-migrations.plugin-doctor.js");
  const sessionFixtures = await import("./state-migrations.session-store.test-support.js");
  return {
    readAcpSessionMetaForEntry: sessionMeta.readAcpSessionMetaForEntry,
    AgentSelectionRequiredError: agentScope.AgentSelectionRequiredError,
    resolveDefaultAgentId: agentScope.resolveDefaultAgentId,
    assertWorkspaceStateMigrationReady: workspaceLegacy.assertWorkspaceStateMigrationReady,
    readWorkspaceStateSnapshot: workspaceStore.readWorkspaceStateSnapshot,
    createChannelIngressQueue: ingress.createChannelIngressQueue,
    retainLegacyDefaultAgentId: legacyAgent.retainLegacyDefaultAgentId,
    loadSessionEntryReadOnly: sessions.loadSessionEntryReadOnly,
    upsertSessionEntryCore: sessions.upsertSessionEntryCore,
    writeSessionEntry: sessionEntries.writeSessionEntry,
    readMemoryHostEventRecords: memoryEvents.readMemoryHostEventRecords,
    loadNodeHostConfig: nodeConfig.loadNodeHostConfig,
    readChannelPairingStateSnapshot: pairing.readChannelPairingStateSnapshot,
    definePluginDoctorMigrationFromPlans: pluginDoctor.definePluginDoctorMigrationFromPlans,
    EMPTY_LEGACY_SESSION_SURFACES: legacySurfaces.EMPTY_LEGACY_SESSION_SURFACES,
    resetPluginRuntimeStateForTest: pluginRuntime.resetPluginRuntimeStateForTest,
    setActivePluginRegistry: pluginRuntime.setActivePluginRegistry,
    readConfigMachineState: configState.readConfigMachineState,
    listOmnipolymathRegisteredAgentDatabases: agentRegistry.listOmnipolymathRegisteredAgentDatabases,
    closeOmnipolymathAgentDatabasesAsync: agentDb.closeOmnipolymathAgentDatabasesAsync,
    closeOmnipolymathAgentDatabasesForTest: agentDb.closeOmnipolymathAgentDatabasesForTest,
    ensureOmnipolymathAgentDatabaseSchema: agentDb.ensureOmnipolymathAgentDatabaseSchema,
    OMNIPOLYMATH_AGENT_SCHEMA_VERSION: agentDb.OMNIPOLYMATH_AGENT_SCHEMA_VERSION,
    runOmnipolymathAgentWriteTransaction: agentDb.runOmnipolymathAgentWriteTransaction,
    OMNIPOLYMATH_STATE_SCHEMA_VERSION: stateContract.OMNIPOLYMATH_STATE_SCHEMA_VERSION,
    closeOmnipolymathStateDatabaseForTest: stateDb.closeOmnipolymathStateDatabaseForTest,
    openOmnipolymathStateDatabase: stateDb.openOmnipolymathStateDatabase,
    resolveOmnipolymathStateSqlitePath: statePaths.resolveOmnipolymathStateSqlitePath,
    withStateMigrationBackupForTest: stateSchema.withStateMigrationBackupForTest,
    createChannelTestPluginBase: channelFixtures.createChannelTestPluginBase,
    createTestRegistry: channelFixtures.createTestRegistry,
    closeDatabaseTestCohorts: databaseCleanup.closeDatabaseTestCohorts,
    closeStateDatabaseForTest: databaseCleanup.closeStateDatabaseForTest,
    withGatewayLockHeld: locks.withGatewayLockHeld,
    executeSqliteQuerySync: sql.executeSqliteQuerySync,
    getNodeSqliteKysely: sql.getNodeSqliteKysely,
    loadApnsRegistration: apns.loadApnsRegistration,
    acquireStartupMigrationLeaseWithWait: migrationLease.acquireStartupMigrationLeaseWithWait,
    migrateDaemonRuntimePins: daemonPins.migrateDaemonRuntimePins,
    autoMigrateLegacyStateWithSurfaces: doctor.autoMigrateLegacyState,
    detectLegacyStateMigrationsWithSurfaces: doctor.detectLegacyStateMigrations,
    runLegacyStateMigrationsWithSurfaces: doctor.runLegacyStateMigrations,
    expectMissingPath: files.expectMissingPath,
    expectRecoveryPredicateRefusedAfterRepair:
      ingressLifecycle.expectRecoveryPredicateRefusedAfterRepair,
    createLegacyAuditLedger: audit.createLegacyAuditLedger,
    sessionStore,
    throwIfDoctorStateMigrationRefused: messages.throwIfDoctorStateMigrationRefused,
    autoMigrateLegacyPluginDoctorState: pluginMigrations.autoMigrateLegacyPluginDoctorState,
    createConfig: sessionFixtures.createConfig,
    createEnv: sessionFixtures.createEnv,
    createLegacyAcpSessionEntry: sessionFixtures.createLegacyAcpSessionEntry,
    createMigrationContext: sessionFixtures.createMigrationContext,
    drainSessionMigrationFixture: sessionFixtures.drainSessionMigrationFixture,
  };
}

type StateMigrationFixtureGraph = Awaited<ReturnType<typeof importStateMigrationFixtureGraph>>;

export async function rerunStateMigrationFixtureAfterRestart(
  params: Parameters<StateMigrationFixtureGraph["autoMigrateLegacyStateWithSurfaces"]>[0],
  native: StateMigrationFixtureGraph,
  migrationDatabaseClosers: Set<() => void | Promise<void>>,
) {
  await native.closeDatabaseTestCohorts(migrationDatabaseClosers);
  vi.resetModules();
  const [agentDb, stateDb, agentDbTest] = await Promise.all([
    import("../state/omnipolymath-agent-db.js"),
    import("../state/omnipolymath-state-db.js"),
    import("../state/omnipolymath-agent-db.test-support.js"),
  ]);
  migrationDatabaseClosers.add(agentDb.closeOmnipolymathAgentDatabasesAsync);
  migrationDatabaseClosers.add(agentDb.closeOmnipolymathAgentDatabasesForTest);
  migrationDatabaseClosers.add(stateDb.closeOmnipolymathStateDatabaseAsync);
  migrationDatabaseClosers.add(stateDb.closeOmnipolymathStateDatabaseForTest);
  try {
    const migrationOwner = await import("./state-migrations.doctor.js");
    return await migrationOwner.autoMigrateLegacyState({
      legacySessionSurfaces: native.EMPTY_LEGACY_SESSION_SURFACES,
      ...params,
    });
  } finally {
    await native.closeDatabaseTestCohorts(migrationDatabaseClosers);
    expect(agentDbTest.listOmnipolymathAgentDatabasesForTest()).toEqual([]);
    expect(stateDb.isOmnipolymathStateDatabaseOpen()).toBe(false);
  }
}
