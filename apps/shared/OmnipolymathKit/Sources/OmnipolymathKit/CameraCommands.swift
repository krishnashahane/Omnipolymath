import Foundation

public enum OmnipolymathCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
    case ptzStatus = "camera.ptz.status"
    case ptzControl = "camera.ptz.control"
}

public enum OmnipolymathCameraPTZOperation: String, Codable, Sendable {
    case set
    case move
    case home
}

public struct OmnipolymathCameraPTZAxisValues: Codable, Sendable, Equatable {
    public var panDegrees: Double?
    public var tiltDegrees: Double?
    public var zoomPercent: Double?

    public init(
        panDegrees: Double? = nil,
        tiltDegrees: Double? = nil,
        zoomPercent: Double? = nil)
    {
        self.panDegrees = panDegrees
        self.tiltDegrees = tiltDegrees
        self.zoomPercent = zoomPercent
    }
}

public struct OmnipolymathCameraPTZStatusParams: Codable, Sendable, Equatable {
    public var deviceId: String

    public init(deviceId: String) {
        self.deviceId = deviceId
    }
}

public struct OmnipolymathCameraPTZControlParams: Codable, Sendable, Equatable {
    public var deviceId: String
    public var operation: OmnipolymathCameraPTZOperation
    public var target: OmnipolymathCameraPTZAxisValues?
    public var delta: OmnipolymathCameraPTZAxisValues?

    public init(
        deviceId: String,
        operation: OmnipolymathCameraPTZOperation,
        target: OmnipolymathCameraPTZAxisValues? = nil,
        delta: OmnipolymathCameraPTZAxisValues? = nil)
    {
        self.deviceId = deviceId
        self.operation = operation
        self.target = target
        self.delta = delta
    }
}

public enum OmnipolymathCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum OmnipolymathCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum OmnipolymathCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct OmnipolymathCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: OmnipolymathCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: OmnipolymathCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: OmnipolymathCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: OmnipolymathCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct OmnipolymathCameraClipParams: Codable, Sendable, Equatable {
    public var facing: OmnipolymathCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: OmnipolymathCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: OmnipolymathCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: OmnipolymathCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
