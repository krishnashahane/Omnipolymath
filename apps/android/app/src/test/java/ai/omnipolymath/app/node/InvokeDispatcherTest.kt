package ai.omnipolymath.app.node

import ai.omnipolymath.app.gateway.GatewaySession
import ai.omnipolymath.app.gateway.testDeviceIdentityStore
import ai.omnipolymath.app.protocol.OmnipolymathCallLogCommand
import ai.omnipolymath.app.protocol.OmnipolymathCameraCommand
import ai.omnipolymath.app.protocol.OmnipolymathDeviceCommand
import ai.omnipolymath.app.protocol.OmnipolymathLocationCommand
import ai.omnipolymath.app.protocol.OmnipolymathMobileUiCommand
import ai.omnipolymath.app.protocol.OmnipolymathMotionCommand
import ai.omnipolymath.app.protocol.OmnipolymathPhotosCommand
import ai.omnipolymath.app.protocol.OmnipolymathSmsCommand
import ai.omnipolymath.app.protocol.OmnipolymathTalkCommand
import android.content.Context
import android.content.pm.PackageManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class InvokeDispatcherTest {
  @Test
  fun handleInvoke_allowsRequestableSmsSearchToReachHandler() =
    runTest {
      val result =
        newInvokeDispatcher(
          readSmsAvailable = false,
          smsFeatureEnabled = true,
          smsTelephonyAvailable = true,
        ).handleInvoke(OmnipolymathSmsCommand.Search.rawValue, "not-json")

      assertEquals("SMS_PERMISSION_REQUIRED", result.error?.code)
      assertEquals("grant READ_SMS permission", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksSmsSearchWhenFeatureIsUnavailable() =
    runTest {
      val result =
        newInvokeDispatcher(
          readSmsAvailable = false,
          smsFeatureEnabled = false,
          smsTelephonyAvailable = true,
        ).handleInvoke(OmnipolymathSmsCommand.Search.rawValue, "not-json")

      assertEquals("SMS_UNAVAILABLE", result.error?.code)
      assertEquals("SMS_UNAVAILABLE: SMS not available on this device", result.error?.message)
    }

  @Test
  fun handleInvoke_allowsAvailableSmsSendToReachHandler() =
    runTest {
      val result =
        newInvokeDispatcher(
          sendSmsAvailable = true,
          smsFeatureEnabled = true,
          smsTelephonyAvailable = true,
        ).handleInvoke(OmnipolymathSmsCommand.Send.rawValue, """{"to":"+15551234567","message":"hi"}""")

      assertEquals("SMS_PERMISSION_REQUIRED", result.error?.code)
      assertEquals("grant SMS permission", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksSmsSendWhenUnavailable() =
    runTest {
      val result =
        newInvokeDispatcher(
          sendSmsAvailable = false,
          smsFeatureEnabled = true,
          smsTelephonyAvailable = true,
        ).handleInvoke(OmnipolymathSmsCommand.Send.rawValue, """{"to":"+15551234567","message":"hi"}""")

      assertEquals("SMS_UNAVAILABLE", result.error?.code)
      assertEquals("SMS_UNAVAILABLE: SMS not available on this device", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksCameraCommandsWhenCameraDisabled() =
    runTest {
      val result = newInvokeDispatcher(cameraEnabled = { false }).handleInvoke(OmnipolymathCameraCommand.List.rawValue, null)

      assertEquals("CAMERA_DISABLED", result.error?.code)
      assertEquals("CAMERA_DISABLED: enable Camera in Settings", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksLocationCommandWhenLocationDisabled() =
    runTest {
      val result = newInvokeDispatcher(locationEnabled = false).handleInvoke(OmnipolymathLocationCommand.Get.rawValue, null)

      assertEquals("LOCATION_DISABLED", result.error?.code)
      assertEquals("LOCATION_DISABLED: enable Location in Settings", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksDeviceAppsWhenSharingDisabled() =
    runTest {
      val result =
        newInvokeDispatcher(installedAppsSharingEnabled = false)
          .handleInvoke(OmnipolymathDeviceCommand.Apps.rawValue, """{"limit":1}""")

      assertEquals("INSTALLED_APPS_SHARING_DISABLED", result.error?.code)
      assertEquals(
        "INSTALLED_APPS_SHARING_DISABLED: enable Installed Apps in Settings",
        result.error?.message,
      )
    }

  @Test
  fun handleInvoke_blocksMotionActivityWhenUnavailable() =
    runTest {
      val result =
        newInvokeDispatcher(motionActivityAvailable = false)
          .handleInvoke(OmnipolymathMotionCommand.Activity.rawValue, null)

      assertEquals("MOTION_UNAVAILABLE", result.error?.code)
      assertEquals("MOTION_UNAVAILABLE: accelerometer not available", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksMotionPedometerWhenUnavailable() =
    runTest {
      val result =
        newInvokeDispatcher(motionPedometerAvailable = false)
          .handleInvoke(OmnipolymathMotionCommand.Pedometer.rawValue, null)

      assertEquals("PEDOMETER_UNAVAILABLE", result.error?.code)
      assertEquals("PEDOMETER_UNAVAILABLE: step counter not available", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksCallLogWhenUnavailable() =
    runTest {
      val result =
        newInvokeDispatcher(callLogAvailable = false).handleInvoke(OmnipolymathCallLogCommand.Search.rawValue, null)

      assertEquals("CALL_LOG_UNAVAILABLE", result.error?.code)
      assertEquals("CALL_LOG_UNAVAILABLE: call log not available on this build", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksPhotosWhenUnavailable() =
    runTest {
      val result = newInvokeDispatcher(photosAvailable = false).handleInvoke(OmnipolymathPhotosCommand.Latest.rawValue, null)

      assertEquals("PHOTOS_UNAVAILABLE", result.error?.code)
      assertEquals("PHOTOS_UNAVAILABLE: photos not available on this build", result.error?.message)
    }

  @Test
  fun handleInvoke_blocksMobileUiWhenServiceIsUnavailable() =
    runTest {
      val result =
        newInvokeDispatcher(mobileUiAvailable = false)
          .handleInvoke(OmnipolymathMobileUiCommand.Observe.rawValue, null)

      assertEquals("MOBILE_UI_UNAVAILABLE", result.error?.code)
      assertEquals(
        "MOBILE_UI_UNAVAILABLE: accessibility service is not connected",
        result.error?.message,
      )
    }

  @Test
  fun handleInvoke_treatsDebugCommandsAsUnknownOutsideDebugBuilds() =
    runTest {
      val result = newInvokeDispatcher(debugBuild = false).handleInvoke("debug.logs", null)

      assertEquals("INVALID_REQUEST", result.error?.code)
      assertEquals("INVALID_REQUEST: unknown command", result.error?.message)
    }

  @Test
  fun handleInvoke_routesTalkPttCommands() =
    runTest {
      val talk = InvokeDispatcherFakeTalkHandler()
      val dispatcher = newInvokeDispatcher(talkHandler = talk)

      val start = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttStart.rawValue, null)
      val stop = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttStop.rawValue, null)
      val cancel = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttCancel.rawValue, null)
      val once = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttOnce.rawValue, null)

      assertEquals("""{"captureId":"start"}""", start.payloadJson)
      assertEquals("""{"status":"stop"}""", stop.payloadJson)
      assertEquals("""{"status":"cancel"}""", cancel.payloadJson)
      assertEquals("""{"status":"once"}""", once.payloadJson)
      assertEquals(
        listOf("start", "stop", "cancel", "once"),
        talk.calls,
      )
    }

  @Test
  fun handleInvoke_blocksTalkOnceButLeavesPttStartToRuntimeStateGateWhenBackgrounded() =
    runTest {
      val talk = InvokeDispatcherFakeTalkHandler()
      val dispatcher = newInvokeDispatcher(isForeground = { false }, talkHandler = talk)

      val start = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttStart.rawValue, null)
      val once = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttOnce.rawValue, null)
      val stop = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttStop.rawValue, null)
      val cancel = dispatcher.handleInvoke(OmnipolymathTalkCommand.PttCancel.rawValue, null)

      assertEquals("""{"captureId":"start"}""", start.payloadJson)
      assertEquals("NODE_BACKGROUND_UNAVAILABLE", once.error?.code)
      assertEquals("NODE_BACKGROUND_UNAVAILABLE: command requires foreground", once.error?.message)
      assertEquals("""{"status":"stop"}""", stop.payloadJson)
      assertEquals("""{"status":"cancel"}""", cancel.payloadJson)
      assertEquals(listOf("start", "stop", "cancel"), talk.calls)
    }

  @Test
  fun foregroundAndAvailabilityGatesReadCurrentStateBeforeInvokingHandlers() =
    runTest {
      var foreground = false
      var cameraEnabled = false
      var cameraReads = 0
      val dispatcher =
        newInvokeDispatcher(
          isForeground = { foreground },
          cameraEnabled = {
            cameraReads += 1
            cameraEnabled
          },
        )

      assertEquals("INVALID_REQUEST", dispatcher.handleInvoke("not.real", null).error?.code)
      assertEquals(
        "NODE_BACKGROUND_UNAVAILABLE",
        dispatcher.handleInvoke(OmnipolymathCameraCommand.List.rawValue, null).error?.code,
      )
      assertEquals(0, cameraReads)

      foreground = true
      assertEquals("CAMERA_DISABLED", dispatcher.handleInvoke(OmnipolymathCameraCommand.List.rawValue, null).error?.code)
      assertEquals(1, cameraReads)

      cameraEnabled = true
      assertTrue(dispatcher.buildInvokeCommands().contains(OmnipolymathCameraCommand.List.rawValue))
      assertTrue(dispatcher.buildCapabilities().contains("camera"))
      cameraEnabled = false
      assertFalse(dispatcher.buildInvokeCommands().contains(OmnipolymathCameraCommand.List.rawValue))
      assertEquals("CAMERA_DISABLED", dispatcher.handleInvoke(OmnipolymathCameraCommand.List.rawValue, null).error?.code)
    }

  @Test
  fun boundHandlerReceivesOpaqueParamsAndPropagatesFailureAndCancellation() =
    runTest {
      val talk = InvokeDispatcherFakeTalkHandler()
      val dispatcher = newInvokeDispatcher(talkHandler = talk)
      val params = "opaque handler-owned params"
      dispatcher.handleInvoke(OmnipolymathTalkCommand.PttStart.rawValue, params)
      assertEquals(listOf(params), talk.params)

      for (failure in listOf(IllegalStateException("synthetic failure"), CancellationException("synthetic cancellation"))) {
        talk.failure = failure
        val result = runCatching { dispatcher.handleInvoke(OmnipolymathTalkCommand.PttStart.rawValue, params) }
        assertSame(failure, result.exceptionOrNull())
      }
    }

  @Test
  fun advertisedCommandsReachBoundHandlersInsteadOfUnknownCommandFallbacks() =
    runTest {
      val dispatcher =
        newInvokeDispatcher(
          isForeground = { false },
          cameraEnabled = { true },
          locationEnabled = true,
          sendSmsAvailable = true,
          readSmsAvailable = true,
          callLogAvailable = true,
          photosAvailable = true,
          installedAppsSharingEnabled = true,
          motionActivityAvailable = true,
          motionPedometerAvailable = true,
          mobileUiAvailable = true,
        )

      for (command in dispatcher.buildInvokeCommands()) {
        val result = dispatcher.handleInvoke(command, "{}")
        assertNotEquals(command, "INVALID_REQUEST: unknown command", result.error?.message)
      }
    }
}

internal fun newInvokeDispatcher(
  isForeground: () -> Boolean = { true },
  cameraEnabled: () -> Boolean = { false },
  locationEnabled: Boolean = false,
  sendSmsAvailable: Boolean = false,
  readSmsAvailable: Boolean = false,
  smsFeatureEnabled: Boolean = true,
  smsTelephonyAvailable: Boolean = true,
  callLogAvailable: Boolean = false,
  photosAvailable: Boolean = true,
  installedAppsSharingEnabled: Boolean = true,
  debugBuild: Boolean = false,
  motionActivityAvailable: Boolean = false,
  motionPedometerAvailable: Boolean = false,
  mobileUiAvailable: Boolean = false,
  talkHandler: TalkHandler = InvokeDispatcherFakeTalkHandler(),
  smsSearchPossible: () -> Boolean = { smsFeatureEnabled && smsTelephonyAvailable },
  voiceWakeAvailable: () -> Boolean = { false },
): InvokeDispatcher {
  val appContext = RuntimeEnvironment.getApplication()
  shadowOf(appContext.packageManager).setSystemFeature(PackageManager.FEATURE_TELEPHONY, smsTelephonyAvailable)
  return InvokeDispatcher(
    cameraHandler = newCameraHandler(appContext),
    locationHandler =
      LocationHandler(
        appContext = appContext,
        capture = { _, _, _ -> error("unused in InvokeDispatcherTest") },
        hasFinePermission = { false },
        hasCoarsePermission = { false },
        hasBackgroundPermission = { false },
      ),
    deviceHandler = DeviceHandler(appContext),
    notificationsHandler =
      NotificationsHandler(
        appContext = appContext,
        readSnapshot = { DeviceNotificationSnapshot(enabled = false, connected = false, notifications = emptyList()) },
        requestServiceRebind = {},
        executeAction = { NotificationActionResult(ok = true, code = null, message = null) },
      ),
    systemHandler = SystemHandler(InvokeDispatcherFakeSystemNotificationPoster()),
    talkHandler = talkHandler,
    photosHandler = PhotosHandler(appContext, InvokeDispatcherFakePhotosDataSource()),
    contactsHandler = ContactsHandler(appContext, InvokeDispatcherFakeContactsDataSource()),
    calendarHandler = CalendarHandler(appContext, InvokeDispatcherFakeCalendarDataSource()),
    motionHandler = MotionHandler(appContext, InvokeDispatcherFakeMotionDataSource()),
    smsHandler = SmsHandler(SmsManager(appContext)),
    debugHandler = DebugHandler(appContext, testDeviceIdentityStore(appContext)),
    callLogHandler = CallLogHandler(appContext),
    mobileUiHandler = MobileUiHandler(),
    isForeground = isForeground,
    cameraEnabled = cameraEnabled,
    locationEnabled = { locationEnabled },
    sendSmsAvailable = { sendSmsAvailable },
    readSmsAvailable = { readSmsAvailable },
    smsSearchPossible = smsSearchPossible,
    callLogAvailable = { callLogAvailable },
    photosAvailable = { photosAvailable },
    installedAppsSharingEnabled = { installedAppsSharingEnabled },
    debugBuild = { debugBuild },
    motionActivityAvailable = { motionActivityAvailable },
    motionPedometerAvailable = { motionPedometerAvailable },
    mobileUiAvailable = { mobileUiAvailable },
    voiceWakeAvailable = voiceWakeAvailable,
  )
}

private fun newCameraHandler(appContext: Context): CameraHandler =
  CameraHandler(
    appContext = appContext,
    camera = CameraCaptureManager(appContext),
    setCameraAudioCaptureActive = { true },
  )

private class InvokeDispatcherFakeSystemNotificationPoster : SystemNotificationPoster {
  override fun post(request: SystemNotifyRequest) = Unit
}

private class InvokeDispatcherFakeTalkHandler : TalkHandler {
  val calls = mutableListOf<String>()
  val params = mutableListOf<String?>()
  var failure: Throwable? = null

  override suspend fun handlePttStart(paramsJson: String?): GatewaySession.InvokeResult {
    calls.add("start")
    params.add(paramsJson)
    failure?.let { throw it }
    return GatewaySession.InvokeResult.ok("""{"captureId":"start"}""")
  }

  override suspend fun handlePttStop(paramsJson: String?): GatewaySession.InvokeResult {
    calls.add("stop")
    return GatewaySession.InvokeResult.ok("""{"status":"stop"}""")
  }

  override suspend fun handlePttCancel(paramsJson: String?): GatewaySession.InvokeResult {
    calls.add("cancel")
    return GatewaySession.InvokeResult.ok("""{"status":"cancel"}""")
  }

  override suspend fun handlePttOnce(paramsJson: String?): GatewaySession.InvokeResult {
    calls.add("once")
    return GatewaySession.InvokeResult.ok("""{"status":"once"}""")
  }
}

private class InvokeDispatcherFakePhotosDataSource : PhotosDataSource {
  override fun hasPermission(): Boolean = true

  override fun latest(request: PhotosLatestRequest): List<EncodedPhotoPayload> = emptyList()
}

private class InvokeDispatcherFakeContactsDataSource : ContactsDataSource {
  override fun hasReadPermission(): Boolean = true

  override fun hasWritePermission(): Boolean = true

  override fun search(request: ContactsSearchRequest): List<ContactRecord> = emptyList()

  override fun add(request: ContactsAddRequest): ContactRecord {
    error("unused in InvokeDispatcherTest")
  }
}

private class InvokeDispatcherFakeCalendarDataSource : CalendarDataSource {
  override fun hasReadPermission(): Boolean = true

  override fun hasWritePermission(): Boolean = true

  override fun events(request: CalendarEventsRequest): List<CalendarEventRecord> = emptyList()

  override fun add(request: CalendarAddRequest): CalendarEventRecord {
    error("unused in InvokeDispatcherTest")
  }
}

private class InvokeDispatcherFakeMotionDataSource : MotionDataSource {
  override fun isActivityAvailable(): Boolean = false

  override fun isPedometerAvailable(): Boolean = false

  override fun hasPermission(): Boolean = true

  override suspend fun activity(request: MotionRangeRequest): MotionActivityRecord {
    error("unused in InvokeDispatcherTest")
  }

  override suspend fun pedometer(request: MotionRangeRequest): PedometerRecord {
    error("unused in InvokeDispatcherTest")
  }
}
