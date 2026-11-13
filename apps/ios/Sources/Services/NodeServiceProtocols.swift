import CoreLocation
import Foundation
import OmnipolymathKit
import UIKit

typealias OmnipolymathCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias OmnipolymathCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(
        params: OmnipolymathCameraSnapParams,
        defaultFacing: OmnipolymathCameraFacing) async throws -> OmnipolymathCameraSnapResult
    func clip(
        params: OmnipolymathCameraClipParams,
        defaultFacing: OmnipolymathCameraFacing) async throws -> OmnipolymathCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func authorizationSnapshot() -> LocationAuthorizationSnapshot
    func ensureAuthorization(
        mode: OmnipolymathLocationMode,
        isCurrent: @MainActor () -> Bool) async -> CLAuthorizationStatus
    func currentLocation(
        params: OmnipolymathLocationGetParams,
        desiredAccuracy: OmnipolymathLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func setBackgroundLocationUpdatesEnabled(_ enabled: Bool)
    func setAuthorizationChangeHandler(
        _ handler: @escaping @MainActor @Sendable (LocationAuthorizationSnapshot) -> Void)
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> OmnipolymathDeviceStatusPayload
    func info() -> OmnipolymathDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: OmnipolymathPhotosLatestParams) async throws -> OmnipolymathPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: OmnipolymathContactsSearchParams) async throws -> OmnipolymathContactsSearchPayload
    func add(params: OmnipolymathContactsAddParams) async throws -> OmnipolymathContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: OmnipolymathCalendarEventsParams) async throws -> OmnipolymathCalendarEventsPayload
    func add(params: OmnipolymathCalendarAddParams) async throws -> OmnipolymathCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: OmnipolymathRemindersListParams) async throws -> OmnipolymathRemindersListPayload
    func add(params: OmnipolymathRemindersAddParams) async throws -> OmnipolymathRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: OmnipolymathMotionActivityParams) async throws -> OmnipolymathMotionActivityPayload
    func pedometer(params: OmnipolymathPedometerParams) async throws -> OmnipolymathPedometerPayload
}

typealias WatchMessagingStatus = OmnipolymathWatchStatusPayload

struct WatchExecApprovalResolveEvent: Codable, Equatable, Sendable {
    var replyId: String
    var approvalId: String
    var gatewayStableID: String?
    var decision: OmnipolymathWatchExecApprovalDecision
    var sentAtMs: Int64?
    var transport: String
}

typealias WatchExecApprovalSnapshotRequestItem = OmnipolymathWatchExecApprovalSnapshotRequestItem

struct WatchExecApprovalSnapshotRequestEvent: Equatable, Sendable {
    var requestId: String
    var gatewayStableID: String?
    var heldApprovals: [WatchExecApprovalSnapshotRequestItem] = []
    var sentAtMs: Int64?
    var transport: String
}

struct WatchAppSnapshotRequestEvent: Equatable, Sendable {
    var requestId: String
    var sentAtMs: Int64?
    var transport: String
}

struct WatchAppCommandEvent: Codable, Equatable, Sendable {
    var commandId: String
    var command: OmnipolymathWatchAppCommand
    var sessionKey: String?
    var gatewayStableID: String?
    var text: String?
    var sentAtMs: Int64?
    var transport: String
}

typealias WatchNotificationSendResult = OmnipolymathWatchNotifyPayload

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setStatusHandler(_ handler: (@Sendable (WatchMessagingStatus) -> Void)?)
    func setChatDeliveryHandler(
        _ handler: (@Sendable (OmnipolymathWatchChatDeliveryCommand) async throws -> Void)?)
    func setChatDeliveryReceiptAckHandler(
        _ handler: (@Sendable (OmnipolymathWatchChatDeliveryReceiptAck) async throws -> Void)?)
    func setLegacyChatRejectedHandler(_ handler: (@Sendable () -> Void)?)
    func setExecApprovalResolveHandler(_ handler: (@Sendable (WatchExecApprovalResolveEvent) -> Void)?)
    func setExecApprovalSnapshotRequestHandler(
        _ handler: (@Sendable (WatchExecApprovalSnapshotRequestEvent) -> Void)?)
    func setAppSnapshotRequestHandler(_ handler: (@Sendable (WatchAppSnapshotRequestEvent) -> Void)?)
    func setAppCommandHandler(_ handler: (@Sendable (WatchAppCommandEvent) -> Void)?)
    func sendDirectNodeSetup(setupCode: String) async throws -> WatchNotificationSendResult
    func sendNotification(
        id: String,
        params: OmnipolymathWatchNotifyParams,
        gatewayStableID: String?,
        chatDeliveryContext: OmnipolymathWatchChatDeliveryContext?) async throws -> WatchNotificationSendResult
    func sendExecApprovalPrompt(
        _ message: OmnipolymathWatchExecApprovalPromptMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalResolved(
        _ message: OmnipolymathWatchExecApprovalResolvedMessage) async throws -> WatchNotificationSendResult
    func sendExecApprovalExpired(
        _ message: OmnipolymathWatchExecApprovalExpiredMessage) async throws -> WatchNotificationSendResult
    func syncExecApprovalSnapshot(
        _ message: OmnipolymathWatchExecApprovalSnapshotMessage) async throws -> WatchNotificationSendResult
    func syncAppSnapshot(
        _ message: OmnipolymathWatchAppSnapshotMessage) async throws -> WatchNotificationSendResult
    func sendChatDeliveryReceipt(
        _ receipt: OmnipolymathWatchChatDeliveryReceipt) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
