// swift-tools-version: 6.3

import PackageDescription

/// Build scripts/build-apple.sh first. The binary is intentionally not checked in;
/// a missing artifact is a build prerequisite, never a transport fallback.
let package = Package(
    name: "OmnipolymathIroh",
    platforms: [.macOS(.v15), .iOS(.v18)],
    products: [
        .library(name: "OmnipolymathIroh", targets: ["OmnipolymathIroh"]),
    ],
    targets: [
        .binaryTarget(
            name: "OmnipolymathIrohFFI",
            path: "dist/apple/OmnipolymathIrohFFI.xcframework"),
        .target(
            name: "OmnipolymathIroh",
            dependencies: ["OmnipolymathIrohFFI"],
            path: "generated",
            exclude: ["ai", "OmnipolymathIrohFFI.h", "OmnipolymathIrohFFI.modulemap"],
            sources: ["OmnipolymathIroh.swift"],
            linkerSettings: [
                .linkedFramework("Security"),
                .linkedFramework("SystemConfiguration"),
                .linkedFramework("Network"),
                .linkedFramework("CoreWLAN", .when(platforms: [.macOS])),
            ]),
        .testTarget(
            name: "OmnipolymathIrohTests",
            dependencies: ["OmnipolymathIroh"],
            path: "swift-tests"),
    ])
