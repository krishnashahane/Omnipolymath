import Foundation

public struct OmnipolymathCanvasNavigateParams: Codable, Sendable, Equatable {
    public var url: String

    public init(url: String) {
        self.url = url
    }
}

public struct OmnipolymathCanvasPlacement: Codable, Sendable, Equatable {
    public var x: Double?
    public var y: Double?
    public var width: Double?
    public var height: Double?
}

public struct OmnipolymathCanvasPresentParams: Codable, Sendable, Equatable {
    public var url: String?
    public var placement: OmnipolymathCanvasPlacement?

    public init(url: String? = nil, placement: OmnipolymathCanvasPlacement? = nil) {
        self.url = url
        self.placement = placement
    }
}
