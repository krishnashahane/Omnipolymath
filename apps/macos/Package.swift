// swift-tools-version: 6.3
// Package manifest for the Omnipolymath macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "Omnipolymath",
    platforms: [
        .macOS("26.2"),
    ],
    products: [
        .library(name: "OmnipolymathIPC", targets: ["OmnipolymathIPC"]),
        .library(name: "OmnipolymathDiscovery", targets: ["OmnipolymathDiscovery"]),
        .executable(name: "Omnipolymath", targets: ["Omnipolymath"]),
        .executable(name: "omnipolymath-mac", targets: ["OmnipolymathMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/sindresorhus/KeyboardShortcuts", exact: "3.1.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.15.1"),
        .package(url: "https://github.com/sparkle-project/Sparkle", exact: "2.10.1"),
        .package(url: "https://github.com/openclaw/Peekaboo.git", exact: "4.9.6"),
        .package(url: "https://github.com/pointfreeco/swift-concurrency-extras", from: "1.4.1"),
        .package(path: "../shared/OmnipolymathKit"),
        .package(path: "../shared/OmnipolymathMLXTTSProtocol"),
        .package(path: "../swabble"),
    ],
    targets: [
        .target(
            name: "OmnipolymathCameraPTZNative",
            path: "Sources/OmnipolymathCameraPTZNative",
            publicHeadersPath: "include",
            linkerSettings: [
                .linkedFramework("CoreFoundation"),
                .linkedFramework("IOKit"),
            ]),
        .target(
            name: "OmnipolymathIPC",
            dependencies: [.product(name: "OmnipolymathNativeState", package: "OmnipolymathKit")],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "OmnipolymathDiscovery",
            dependencies: [
                .product(name: "OmnipolymathKit", package: "OmnipolymathKit"),
                .product(name: "Subprocess", package: "swift-subprocess"),
            ],
            path: "Sources/OmnipolymathDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "Omnipolymath",
            dependencies: [
                "OmnipolymathIPC",
                "OmnipolymathDiscovery",
                "OmnipolymathCameraPTZNative",
                .product(name: "OmnipolymathNativeState", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathKit", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathChatUI", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathMLXTTSProtocol", package: "OmnipolymathMLXTTSProtocol"),
                .product(name: "OmnipolymathProtocol", package: "OmnipolymathKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
                .product(name: "ConcurrencyExtras", package: "swift-concurrency-extras"),
                .product(name: "KeyboardShortcuts", package: "KeyboardShortcuts"),
            ],
            exclude: [
                "Resources/Info.plist",
                "Resources/Localizable.xcstrings",
            ],
            resources: [
                .copy("Resources/Omnipolymath.icns"),
                .copy("Resources/NativeSessionCatalogs.json"),
                .copy("Resources/AppIcons"),
                .copy("Resources/DeviceModels"),
                .copy("Resources/ProviderIcons"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "OmnipolymathMacCLI",
            dependencies: [
                "OmnipolymathIPC",
                "OmnipolymathDiscovery",
                .product(name: "OmnipolymathNativeState", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathKit", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathProtocol", package: "OmnipolymathKit"),
            ],
            path: "Sources/OmnipolymathMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "OmnipolymathWebKitTestSupport",
            path: "Tests/OmnipolymathWebKitTestSupport",
            publicHeadersPath: "include",
            linkerSettings: [
                .linkedFramework("WebKit"),
            ]),
        .testTarget(
            name: "OmnipolymathIPCTests",
            dependencies: [
                "OmnipolymathIPC",
                .product(name: "OmnipolymathNativeState", package: "OmnipolymathKit"),
                "Omnipolymath",
                "OmnipolymathMacCLI",
                "OmnipolymathDiscovery",
                "OmnipolymathWebKitTestSupport",
                .product(name: "OmnipolymathChatUI", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathKit", package: "OmnipolymathKit"),
                .product(name: "OmnipolymathMLXTTSProtocol", package: "OmnipolymathMLXTTSProtocol"),
                .product(name: "OmnipolymathProtocol", package: "OmnipolymathKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
