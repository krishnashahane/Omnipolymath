// swift-tools-version: 6.3

import Foundation
import PackageDescription

// Native transport is an explicit build opt-in; ordinary app builds need no XCFramework.
let nativeIrohEnabled = ProcessInfo.processInfo.environment["OMNIPOLYMATH_IROH_NATIVE"] == "1"
let nativePackages: [Package.Dependency] = nativeIrohEnabled
    ? [.package(path: "../../../crates/omnipolymath-iroh-ffi")] : []
let nativeDependencies: [Target.Dependency] = nativeIrohEnabled
    ? [.product(
        name: "OmnipolymathIroh",
        package: "omnipolymath-iroh-ffi",
        condition: .when(platforms: [.iOS, .macOS]))] : []
let nativeSettings: [SwiftSetting] = nativeIrohEnabled
    ? [.define("OMNIPOLYMATH_IROH_NATIVE", .when(platforms: [.iOS, .macOS]))] : []

let package = Package(
    name: "OmnipolymathKit",
    platforms: [
        .iOS(.v18),
        .macOS(.v15),
        .watchOS(.v11),
    ],
    products: [
        .library(name: "OmnipolymathProtocol", targets: ["OmnipolymathProtocol"]),
        .library(name: "OmnipolymathNativeState", targets: ["OmnipolymathNativeState"]),
        .library(name: "OmnipolymathKit", targets: ["OmnipolymathKit"]),
        .library(name: "OmnipolymathChatUI", targets: ["OmnipolymathChatUI"]),
    ],
    traits: [
        .trait(name: "Talk", description: "ElevenLabs cloud TTS / talk support"),
        .default(enabledTraits: ["Talk"]),
    ],
    dependencies: nativePackages + [
        .package(url: "https://github.com/steipete/ElevenLabsKit", exact: "0.1.3"),
        .package(url: "https://github.com/groue/GRDB.swift.git", exact: "7.12.0"),
        .package(url: "https://github.com/mgriebling/SwiftMath", exact: "1.7.3"),
        .package(url: "https://github.com/swiftlang/swift-markdown", exact: "0.9.0"),
    ],
    targets: [
        .target(
            name: "OmnipolymathProtocol",
            path: "Sources/OmnipolymathProtocol",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ],
            plugins: ["GenerateGatewayProtocol"]),
        .plugin(
            name: "GenerateGatewayProtocol",
            capability: .buildTool()),
        .target(
            name: "OmnipolymathNativeState",
            path: "Sources/OmnipolymathNativeState",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "OmnipolymathKit",
            dependencies: nativeDependencies + [
                "OmnipolymathNativeState",
                "OmnipolymathProtocol",
                .product(
                    name: "ElevenLabsKit",
                    package: "ElevenLabsKit",
                    condition: .when(platforms: [.iOS, .macOS], traits: ["Talk"])),
            ],
            path: "Sources/OmnipolymathKit",
            resources: [
                .process("Resources"),
            ],
            swiftSettings: nativeSettings + [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "OmnipolymathChatUI",
            dependencies: [
                "OmnipolymathKit",
                "OmnipolymathProtocol",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Markdown", package: "swift-markdown"),
                .product(name: "SwiftMath", package: "SwiftMath"),
            ],
            path: "Sources/OmnipolymathChatUI",
            resources: [
                .copy("Resources/Mermaid"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "OmnipolymathKitTests",
            dependencies: nativeDependencies + [
                "OmnipolymathKit",
                "OmnipolymathChatUI",
                "OmnipolymathProtocol",
                .product(name: "GRDB", package: "GRDB.swift"),
            ],
            path: "Tests/OmnipolymathKitTests",
            resources: [.copy("Fixtures")],
            swiftSettings: nativeSettings + [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
        .testTarget(
            name: "OmnipolymathNativeStateTests",
            dependencies: ["OmnipolymathNativeState"],
            path: "Tests/OmnipolymathNativeStateTests",
            resources: [.copy("Fixtures")],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
