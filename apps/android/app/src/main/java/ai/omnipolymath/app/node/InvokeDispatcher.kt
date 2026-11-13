package ai.omnipolymath.app.node

import ai.omnipolymath.app.gateway.GatewaySession
import ai.omnipolymath.app.protocol.OmnipolymathCalendarCommand
import ai.omnipolymath.app.protocol.OmnipolymathCallLogCommand
import ai.omnipolymath.app.protocol.OmnipolymathCameraCommand
import ai.omnipolymath.app.protocol.OmnipolymathCapability
import ai.omnipolymath.app.protocol.OmnipolymathContactsCommand
import ai.omnipolymath.app.protocol.OmnipolymathDeviceCommand
import ai.omnipolymath.app.protocol.OmnipolymathLocationCommand
import ai.omnipolymath.app.protocol.OmnipolymathMobileUiCommand
import ai.omnipolymath.app.protocol.OmnipolymathMotionCommand
import ai.omnipolymath.app.protocol.OmnipolymathNotificationsCommand
import ai.omnipolymath.app.protocol.OmnipolymathPhotosCommand
import ai.omnipolymath.app.protocol.OmnipolymathSmsCommand
import ai.omnipolymath.app.protocol.OmnipolymathSystemCommand
import ai.omnipolymath.app.protocol.OmnipolymathTalkCommand

/** Owns Android command bindings and their live advertised/invoke availability. */
class InvokeDispatcher(
  cameraHandler: CameraHandler,
  locationHandler: LocationHandler,
  deviceHandler: DeviceHandler,
  notificationsHandler: NotificationsHandler,
  systemHandler: SystemHandler,
  talkHandler: TalkHandler,
  photosHandler: PhotosHandler,
  contactsHandler: ContactsHandler,
  calendarHandler: CalendarHandler,
  motionHandler: MotionHandler,
  smsHandler: SmsHandler,
  debugHandler: DebugHandler,
  callLogHandler: CallLogHandler,
  mobileUiHandler: MobileUiHandler,
  private val isForeground: () -> Boolean,
  cameraEnabled: () -> Boolean,
  locationEnabled: () -> Boolean,
  sendSmsAvailable: () -> Boolean,
  private val readSmsAvailable: () -> Boolean,
  smsSearchPossible: () -> Boolean,
  callLogAvailable: () -> Boolean,
  photosAvailable: () -> Boolean,
  installedAppsSharingEnabled: () -> Boolean,
  debugBuild: () -> Boolean,
  motionActivityAvailable: () -> Boolean,
  motionPedometerAvailable: () -> Boolean,
  mobileUiAvailable: () -> Boolean,
  private val voiceWakeAvailable: () -> Boolean,
) {
  private class CommandGate(
    val isAvailable: () -> Boolean,
    val unavailable: GatewaySession.InvokeResult,
    val isAdvertised: () -> Boolean = isAvailable,
  )

  private class Command(
    val name: String,
    val invoke: suspend (String?) -> GatewaySession.InvokeResult,
    val gate: CommandGate? = null,
    val requiresForeground: Boolean = false,
  )

  private val cameraGate =
    CommandGate(cameraEnabled, nodeInvokeError("CAMERA_DISABLED", "enable Camera in Settings"))
  private val locationGate =
    CommandGate(locationEnabled, nodeInvokeError("LOCATION_DISABLED", "enable Location in Settings"))
  private val motionActivityGate =
    CommandGate(motionActivityAvailable, nodeInvokeError("MOTION_UNAVAILABLE", "accelerometer not available"))
  private val motionPedometerGate =
    CommandGate(motionPedometerAvailable, nodeInvokeError("PEDOMETER_UNAVAILABLE", "step counter not available"))
  private val smsUnavailable = nodeInvokeError("SMS_UNAVAILABLE", "SMS not available on this device")
  private val smsSendGate = CommandGate(sendSmsAvailable, smsUnavailable)
  private val smsSearchGate =
    CommandGate(
      isAvailable = { readSmsAvailable() || smsSearchPossible() },
      unavailable = smsUnavailable,
      // Search is advertised before READ_SMS is granted so its handler can request permission.
      isAdvertised = smsSearchPossible,
    )
  private val callLogGate =
    CommandGate(callLogAvailable, nodeInvokeError("CALL_LOG_UNAVAILABLE", "call log not available on this build"))
  private val photosGate =
    CommandGate(photosAvailable, nodeInvokeError("PHOTOS_UNAVAILABLE", "photos not available on this build"))
  private val installedAppsGate =
    CommandGate(installedAppsSharingEnabled, nodeInvokeError("INSTALLED_APPS_SHARING_DISABLED", "enable Installed Apps in Settings"))
  private val debugGate =
    CommandGate(debugBuild, nodeInvokeError("INVALID_REQUEST", "unknown command"))
  private val mobileUiGate =
    CommandGate(mobileUiAvailable, nodeInvokeError("MOBILE_UI_UNAVAILABLE", "accessibility service is not connected"))

  // Keep protocol ordering stable. The same entries advertise and dispatch each bound handler.
  private val commands =
    listOf(
      Command(OmnipolymathSystemCommand.Notify.rawValue, systemHandler::handleSystemNotify),
      Command(OmnipolymathTalkCommand.PttStart.rawValue, talkHandler::handlePttStart),
      Command(OmnipolymathTalkCommand.PttStop.rawValue, talkHandler::handlePttStop),
      Command(OmnipolymathTalkCommand.PttCancel.rawValue, talkHandler::handlePttCancel),
      Command(OmnipolymathTalkCommand.PttOnce.rawValue, talkHandler::handlePttOnce, requiresForeground = true),
      Command(OmnipolymathCameraCommand.List.rawValue, cameraHandler::handleList, cameraGate, requiresForeground = true),
      Command(OmnipolymathCameraCommand.Snap.rawValue, cameraHandler::handleSnap, cameraGate, requiresForeground = true),
      Command(OmnipolymathCameraCommand.Clip.rawValue, cameraHandler::handleClip, cameraGate, requiresForeground = true),
      Command(OmnipolymathLocationCommand.Get.rawValue, locationHandler::handleLocationGet, locationGate),
      Command(OmnipolymathDeviceCommand.Status.rawValue, deviceHandler::handleDeviceStatus),
      Command(OmnipolymathDeviceCommand.Info.rawValue, deviceHandler::handleDeviceInfo),
      Command(OmnipolymathDeviceCommand.Permissions.rawValue, deviceHandler::handleDevicePermissions),
      Command(OmnipolymathDeviceCommand.Health.rawValue, deviceHandler::handleDeviceHealth),
      Command(OmnipolymathDeviceCommand.Apps.rawValue, deviceHandler::handleDeviceApps, installedAppsGate),
      Command(OmnipolymathNotificationsCommand.List.rawValue, notificationsHandler::handleNotificationsList),
      Command(OmnipolymathNotificationsCommand.Actions.rawValue, notificationsHandler::handleNotificationsActions),
      Command(OmnipolymathPhotosCommand.Latest.rawValue, photosHandler::handlePhotosLatest, photosGate),
      Command(OmnipolymathContactsCommand.Search.rawValue, contactsHandler::handleContactsSearch),
      Command(OmnipolymathContactsCommand.Add.rawValue, contactsHandler::handleContactsAdd),
      Command(OmnipolymathCalendarCommand.Events.rawValue, calendarHandler::handleCalendarEvents),
      Command(OmnipolymathCalendarCommand.Add.rawValue, calendarHandler::handleCalendarAdd),
      Command(OmnipolymathMotionCommand.Activity.rawValue, motionHandler::handleMotionActivity, motionActivityGate),
      Command(OmnipolymathMotionCommand.Pedometer.rawValue, motionHandler::handleMotionPedometer, motionPedometerGate),
      Command(OmnipolymathSmsCommand.Send.rawValue, smsHandler::handleSmsSend, smsSendGate),
      Command(OmnipolymathSmsCommand.Search.rawValue, smsHandler::handleSmsSearch, smsSearchGate),
      Command(OmnipolymathCallLogCommand.Search.rawValue, callLogHandler::handleCallLogSearch, callLogGate),
      Command(OmnipolymathMobileUiCommand.Observe.rawValue, mobileUiHandler::handleObserve, mobileUiGate),
      Command(OmnipolymathMobileUiCommand.Act.rawValue, mobileUiHandler::handleAct, mobileUiGate),
      Command("debug.logs", { debugHandler.handleLogs() }, debugGate),
      Command("debug.ed25519", { debugHandler.handleEd25519() }, debugGate),
    )
  private val commandsByName = commands.associateBy(Command::name)

  suspend fun handleInvoke(
    command: String,
    paramsJson: String?,
  ): GatewaySession.InvokeResult {
    val binding = commandsByName[command] ?: return nodeInvokeError("INVALID_REQUEST", "unknown command")
    if (binding.requiresForeground && !isForeground()) {
      return nodeInvokeError("NODE_BACKGROUND_UNAVAILABLE", "command requires foreground")
    }
    val gate = binding.gate
    if (gate != null && !gate.isAvailable()) return gate.unavailable
    return binding.invoke(paramsJson)
  }

  fun buildInvokeCommands(): List<String> = commands.filter { it.gate?.isAdvertised?.invoke() != false }.map(Command::name)

  fun buildCapabilities(): List<String> =
    buildList {
      add(OmnipolymathCapability.Device.rawValue)
      add(OmnipolymathCapability.Notifications.rawValue)
      add(OmnipolymathCapability.System.rawValue)
      if (cameraGate.isAvailable()) add(OmnipolymathCapability.Camera.rawValue)
      // A promptable search alone does not advertise the SMS capability.
      if (smsSendGate.isAvailable() || readSmsAvailable()) add(OmnipolymathCapability.Sms.rawValue)
      add(OmnipolymathCapability.Talk.rawValue)
      if (locationGate.isAvailable()) add(OmnipolymathCapability.Location.rawValue)
      if (photosGate.isAvailable()) add(OmnipolymathCapability.Photos.rawValue)
      add(OmnipolymathCapability.Contacts.rawValue)
      add(OmnipolymathCapability.Calendar.rawValue)
      if (motionActivityGate.isAvailable() || motionPedometerGate.isAvailable()) add(OmnipolymathCapability.Motion.rawValue)
      if (callLogGate.isAvailable()) add(OmnipolymathCapability.CallLog.rawValue)
      if (voiceWakeAvailable()) add(OmnipolymathCapability.VoiceWake.rawValue)
      if (mobileUiGate.isAvailable()) add(OmnipolymathCapability.MobileUI.rawValue)
    }
}

/** Talk-mode command adapter implemented by the voice subsystem. */
interface TalkHandler {
  /** Starts a push-to-talk capture session and keeps it open until stop or cancel. */
  suspend fun handlePttStart(paramsJson: String?): GatewaySession.InvokeResult

  /** Finishes the active push-to-talk capture and submits recognized speech. */
  suspend fun handlePttStop(paramsJson: String?): GatewaySession.InvokeResult

  /** Aborts the active push-to-talk capture without submitting speech. */
  suspend fun handlePttCancel(paramsJson: String?): GatewaySession.InvokeResult

  /** Runs a bounded one-shot push-to-talk capture. */
  suspend fun handlePttOnce(paramsJson: String?): GatewaySession.InvokeResult
}
