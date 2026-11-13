// swift-tools-version: 6.3
// Isolated MLX TTS helper package. Keep this out of apps/macos/Package.swift so
// normal macOS app tests do not compile the full MLX audio stack.

import PackageDescription

let package = Package(
    name: "OmnipolymathMLXTTS",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .executable(name: "omnipolymath-mlx-tts", targets: ["OmnipolymathMLXTTSHelper"]),
    ],
    dependencies: [
        .package(
            url: "https://github.com/Blaizzy/mlx-audio-swift",
            revision: "d60236dee82de1173fc20757dad82a5116db1ddf"),
        .package(path: "../shared/OmnipolymathMLXTTSProtocol"),
    ],
    targets: [
        .target(
            name: "OmnipolymathMLXTTSRuntime",
            dependencies: [
                .product(name: "MLXAudioCore", package: "mlx-audio-swift"),
                .product(name: "MLXAudioTTS", package: "mlx-audio-swift"),
                .product(name: "OmnipolymathMLXTTSProtocol", package: "OmnipolymathMLXTTSProtocol"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "OmnipolymathMLXTTSHelper",
            dependencies: [
                "OmnipolymathMLXTTSRuntime",
                .product(name: "OmnipolymathMLXTTSProtocol", package: "OmnipolymathMLXTTSProtocol"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "OmnipolymathMLXTTSRuntimeTests",
            dependencies: [
                "OmnipolymathMLXTTSRuntime",
                .product(name: "OmnipolymathMLXTTSProtocol", package: "OmnipolymathMLXTTSProtocol"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
    ])
