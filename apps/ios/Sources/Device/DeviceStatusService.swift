import Foundation
import OmnipolymathKit
import UIKit

@MainActor
final class DeviceStatusService: DeviceStatusServicing {
    private let networkStatus = NetworkStatusService()

    func status() async throws -> OmnipolymathDeviceStatusPayload {
        let battery = Self.batteryStatus(device: UIDevice.current)
        let thermal = self.thermalStatus()
        let storage = self.storageStatus()
        let network = try await self.networkStatus.currentStatus()
        let uptime = ProcessInfo.processInfo.systemUptime

        return OmnipolymathDeviceStatusPayload(
            battery: battery,
            thermal: thermal,
            storage: storage,
            network: network,
            uptimeSeconds: uptime)
    }

    func info() -> OmnipolymathDeviceInfoPayload {
        let device = UIDevice.current
        let appVersion = DeviceInfoHelper.appVersion()
        let appBuild = DeviceInfoHelper.appBuild()
        let locale = Locale.preferredLanguages.first ?? Locale.current.identifier
        return OmnipolymathDeviceInfoPayload(
            deviceName: device.name,
            modelIdentifier: DeviceInfoHelper.modelIdentifier(),
            systemName: device.systemName,
            systemVersion: device.systemVersion,
            appVersion: appVersion,
            appBuild: appBuild.isEmpty ? "0" : appBuild,
            locale: locale)
    }

    static func batteryStatus(device: UIDevice) -> OmnipolymathBatteryStatusPayload {
        let wasMonitoring = device.isBatteryMonitoringEnabled
        device.isBatteryMonitoringEnabled = true
        defer { device.isBatteryMonitoringEnabled = wasMonitoring }
        // UIDevice.batteryLevel is a normalized 0.0–1.0 fraction, matching the
        // shared OmnipolymathBatteryStatusPayload.level contract. `levelPercent`
        // mirrors it as an integer 0–100 percentage.
        let level = device.batteryLevel >= 0 ? Double(device.batteryLevel) : nil
        let levelPercent = level.map { Int(($0 * 100).rounded()) }
        let state: OmnipolymathBatteryState = switch device.batteryState {
        case .charging: .charging
        case .full: .full
        case .unplugged: .unplugged
        case .unknown: .unknown
        @unknown default: .unknown
        }
        return OmnipolymathBatteryStatusPayload(
            level: level,
            state: state,
            lowPowerModeEnabled: ProcessInfo.processInfo.isLowPowerModeEnabled,
            levelPercent: levelPercent)
    }

    private func thermalStatus() -> OmnipolymathThermalStatusPayload {
        let state: OmnipolymathThermalState = switch ProcessInfo.processInfo.thermalState {
        case .nominal: .nominal
        case .fair: .fair
        case .serious: .serious
        case .critical: .critical
        @unknown default: .nominal
        }
        return OmnipolymathThermalStatusPayload(state: state)
    }

    private func storageStatus() -> OmnipolymathStorageStatusPayload {
        let attrs = (try? FileManager.default.attributesOfFileSystem(forPath: NSHomeDirectory())) ?? [:]
        let total = (attrs[.systemSize] as? NSNumber)?.int64Value ?? 0
        let free = (attrs[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
        let used = max(0, total - free)
        return OmnipolymathStorageStatusPayload(totalBytes: total, freeBytes: free, usedBytes: used)
    }
}
