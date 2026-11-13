import Foundation

// Stable identifier used for both the macOS LaunchAgent label and Nix-managed defaults suite.
// nix-omnipolymath writes app defaults into this suite to survive app bundle identifier churn.
let launchdLabel = "ai.omnipolymath.mac"
var gatewayLaunchdLabel: String {
    AppProfile.current.gatewayLaunchAgentLabel
}

let nodeLaunchdLabel = "ai.omnipolymath.node"
let onboardingVersionKey = "omnipolymath.onboardingVersion"
let onboardingSeenKey = "omnipolymath.onboardingSeen"
/// Fingerprint of the config file's `gateway` section at the moment the user chose "Set up later".
/// While it matches the file, the app has no primary Gateway; any other writer's edit retires it.
let primaryGatewayDeferredFingerprintKey = "omnipolymath.primaryGatewayDeferredFingerprint"
let onboardingSystemAgentPendingKey = "omnipolymath.onboardingSystemAgentPending"
// Pre-rename releases persisted pending activations under the Crestodian key.
let onboardingSystemAgentPendingRetiredKey = "omnipolymath.onboardingCrestodianPending"
let currentOnboardingVersion = 8
let pauseDefaultsKey = "omnipolymath.pauseEnabled"
let iconAnimationsEnabledKey = "omnipolymath.iconAnimationsEnabled"
let swabbleEnabledKey = "omnipolymath.swabbleEnabled"
let swabbleTriggersKey = "omnipolymath.swabbleTriggers"
let voiceWakeTriggerChimeKey = "omnipolymath.voiceWakeTriggerChime"
let voiceWakeSendChimeKey = "omnipolymath.voiceWakeSendChime"
let showDockIconKey = "omnipolymath.showDockIcon"
let nativeExperienceEnabledKey = "omnipolymath.nativeExperienceEnabled"
let appIconStyleKey = "omnipolymath.appIconStyle"
let defaultVoiceWakeTriggers = ["omnipolymath"]
let voiceWakeMaxWords = 32
let voiceWakeMaxWordLength = 64
let voiceWakeMicKey = "omnipolymath.voiceWakeMicID"
let voiceWakeMicNameKey = "omnipolymath.voiceWakeMicName"
let voiceWakeLocaleKey = "omnipolymath.voiceWakeLocaleID"
let voiceWakeAdditionalLocalesKey = "omnipolymath.voiceWakeAdditionalLocaleIDs"
let voicePushToTalkEnabledKey = "omnipolymath.voicePushToTalkEnabled"
let voiceWakeTriggersTalkModeKey = "omnipolymath.voiceWakeTriggersTalkMode"
let talkEnabledKey = "omnipolymath.talkEnabled"
let talkRealtimeRelayEnabledKey = "omnipolymath.talkRealtimeRelayEnabled"
let talkPhaseSoundsEnabledKey = "omnipolymath.talkPhaseSoundsEnabled"
let talkShiftToStopEnabledKey = "omnipolymath.talkShiftToStopEnabled"
let iconOverrideKey = "omnipolymath.iconOverride"
let connectionModeKey = "omnipolymath.connectionMode"
let hostsLocalGatewayWithRemotePrimaryKey = "omnipolymath.localGateway.hostWithRemotePrimary"
let remoteTargetKey = "omnipolymath.remoteTarget"
let remoteIdentityKey = "omnipolymath.remoteIdentity"
let remoteProjectRootKey = "omnipolymath.remoteProjectRoot"
let remoteCliPathKey = "omnipolymath.remoteCliPath"
let canvasEnabledKey = "omnipolymath.canvasEnabled"
let quickChatEnabledKey = "omnipolymath.quickChatEnabled"
let cameraEnabledKey = "omnipolymath.cameraEnabled"
let desktopSharingEnabledKey = "omnipolymath.desktopSharingEnabled"
let computerControlEnabledKey = "omnipolymath.computerControlEnabled"
let computerControlProviderKey = "omnipolymath.computerControlProvider"
let cookieSyncEnabledKey = "omnipolymath.cookieSyncEnabled"
let cookieSyncIntoProfileKey = "omnipolymath.cookieSyncIntoProfile"
let cookieSyncDomainsKey = "omnipolymath.cookieSyncDomains"

func isTalkRealtimeRelayEnabled(defaults: UserDefaults = AppDefaults.standard) -> Bool {
    defaults.object(forKey: talkRealtimeRelayEnabledKey) as? Bool ?? false
}

func isComputerControlEnabled(
    defaults: UserDefaults = AppDefaults.standard,
    launchPlan: AppLaunchRuntimePlan = .current) -> Bool
{
    // object(forKey:) preserves an explicit false; bool(forKey:) would conflate it with an unset default.
    let storedValue = defaults.object(forKey: computerControlEnabledKey) as? Bool ?? true
    return launchPlan.resolveComputerControlEnabled(storedValue)
}

let activeComputerPresenceEnabledKey = "omnipolymath.activeComputerPresenceEnabled"
let locationModeKey = "omnipolymath.locationMode"
let locationPreciseKey = "omnipolymath.locationPreciseEnabled"
let peekabooBridgeEnabledKey = "omnipolymath.peekabooBridgeEnabled"
let deepLinkKeyKey = "omnipolymath.deepLinkKey"
let cliInstallPromptedVersionKey = "omnipolymath.cliInstallPromptedVersion"
let cliInstallPolicyKey = "omnipolymath.cliInstallPolicy"
let cliManagedRestartPendingKey = "omnipolymath.cliManagedRestartPending"
let postAppUpdateReceiptKey = "omnipolymath.postAppUpdateReceipt"
let lastLaunchedAppVersionKey = "omnipolymath.lastLaunchedAppVersion"
let cliValidatedExecutableKey = "omnipolymath.cliValidatedExecutable"
let cliValidatedVersionKey = "omnipolymath.cliValidatedVersion"
let macNodeIdentityProfileKey = "omnipolymath.macNodeIdentityProfile"
let heartbeatsEnabledKey = "omnipolymath.heartbeatsEnabled"
let debugPaneEnabledKey = "omnipolymath.debugPaneEnabled"
let debugFileLogEnabledKey = "omnipolymath.debug.fileLogEnabled"
let appLogLevelKey = "omnipolymath.debug.appLogLevel"

let nativeConversationForcedKey = "omnipolymath.chat.useNativeConversation"
