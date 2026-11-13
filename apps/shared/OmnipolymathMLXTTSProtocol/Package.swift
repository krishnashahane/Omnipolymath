// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "OmnipolymathMLXTTSProtocol",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "OmnipolymathMLXTTSProtocol", targets: ["OmnipolymathMLXTTSProtocol"]),
    ],
    targets: [
        .target(name: "OmnipolymathMLXTTSProtocol"),
        .testTarget(
            name: "OmnipolymathMLXTTSProtocolTests",
            dependencies: ["OmnipolymathMLXTTSProtocol"]),
    ])
