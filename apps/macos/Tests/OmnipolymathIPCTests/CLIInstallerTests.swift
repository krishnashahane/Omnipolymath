import Foundation
import os
import Testing
@testable import Omnipolymath

@Suite(.serialized)
@MainActor
struct CLIInstallerTests {
    @Test(arguments: [
        (#"{"status":"ok","warnings":["Plugin repair remains pending"]}"#, 0, true),
        (
            #"{"status":"advisory","advisory":{"kind":"package-post-install-doctor","reason":"deferred-configured-plugin-repair","message":"Deferred","details":["Plugin repair remains pending"]}}"#,
            86,
            true),
        (
            #"{"status":"error","failureFacts":[{"check":"omnipolymath doctor","code":"required-migration","message":"Required migration failed"}]}"#,
            1,
            false),
        (#"{"status":"ok","maintenanceRefusal":{"kind":"deferred","reason":"agent-database-in-use"}}"#, 0, false),
        (
            #"{"status":"ok","configWriteRefusal":{"reason":"authority-changed","message":"Required write refused","keys":["plugins"]}}"#,
            0,
            false),
        (
            #"{"status":"ok","failureFacts":[{"check":"doctor","code":"required-migration","message":"Required migration failed"}]}"#,
            0,
            false),
        (#"{"status":"ok"}"#, 1, false),
        (#"{"status":"advisory"}"#, 86, false),
        ("invalid JSON", 0, false),
    ])
    func `bundled repair consumes classified Doctor outcomes after child settlement`(
        payload: String, exitCode: Int, succeeds: Bool) throws
    {
        let response = ShellExecutor.ShellResult(
            stdout: "Human inspection output\nOMNIPOLYMATH_UPDATE_POST_INSTALL_DOCTOR_RESULT_PATH=\(payload)\nDoctor complete.\n",
            stderr: "", exitCode: exitCode, timedOut: false, success: exitCode == 0,
            errorMessage: exitCode == 0 ? nil : "exit \(exitCode)", preflightError: nil)
        if succeeds {
            #expect(try CLIInstaller.bundledDoctorDiagnostics(response).contains("Plugin repair remains pending"))
        } else {
            #expect(throws: (any Error).self) { try CLIInstaller.bundledDoctorDiagnostics(response) }
        }
        var unsettled = response
        unsettled.exitCode = nil
        unsettled.timedOut = true
        #expect(throws: CLIInstaller.DoctorProcessesUnsettled.self) {
            try CLIInstaller.bundledDoctorDiagnostics(unsettled)
        }
        var missing = response
        missing.stdout = payload
        #expect(throws: CLIInstaller.DoctorProcessesUnsettled.self) {
            try CLIInstaller.bundledDoctorDiagnostics(missing)
        }
    }

    @Test func `managed install locations follow the app profile`() {
        let home = URL(fileURLWithPath: "/Users/Test User", isDirectory: true)
        let cases = [
            (AppProfile(environment: [:]), "/Users/Test User/.omnipolymath"),
            (
                AppProfile(environment: [
                    "OMNIPOLYMATH_PROFILE": "onboardtest",
                    "OMNIPOLYMATH_STATE_DIR": "/tmp/ignored-state",
                ]),
                "/Users/Test User/.omnipolymath-onboardtest"),
        ]

        for (profile, expectedPrefix) in cases {
            let prefix = CLIInstaller.installPrefix(homeDirectory: home, profile: profile)
            #expect(prefix == expectedPrefix)
            #expect(CLIInstaller.managedExecutableLocation(homeDirectory: home, profile: profile) ==
                "\(expectedPrefix)/bin/omnipolymath")

            let command = CLIInstaller.installScriptCommand(
                target: .exact("2026.7.3"),
                prefix: prefix,
                scriptPath: "/Applications/Omnipolymath.app/Contents/Resources/install-cli.sh")
            let prefixIndex = command.firstIndex(of: "--prefix")
            #expect(prefixIndex.map { command[$0 + 1] } == expectedPrefix)
        }
    }

    @Test func `installed location finds executable`() throws {
        let fm = FileManager()
        let root = fm.temporaryDirectory.appendingPathComponent(
            "omnipolymath-cli-installer-\(UUID().uuidString)")
        defer { try? fm.removeItem(at: root) }

        let binDir = root.appendingPathComponent("bin")
        try fm.createDirectory(at: binDir, withIntermediateDirectories: true)
        let cli = binDir.appendingPathComponent("omnipolymath")
        fm.createFile(atPath: cli.path, contents: Data())
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: cli.path)

        let found = CLIInstaller.installedLocation(
            searchPaths: [binDir.path],
            fileManager: fm)
        #expect(found == cli.path)

        try fm.removeItem(at: cli)
        fm.createFile(atPath: cli.path, contents: Data())
        try fm.setAttributes([.posixPermissions: 0o644], ofItemAtPath: cli.path)

        let missing = CLIInstaller.installedLocation(
            searchPaths: [binDir.path],
            fileManager: fm)
        #expect(missing == nil)
    }

    @Test func `installer command runs the signed bundled script without a shell pipeline`() {
        let command = CLIInstaller.installScriptCommand(
            target: .exact("2026.7.3-beta.1"),
            prefix: "/Users/Test User/.omnipolymath",
            scriptPath: "/Applications/Omnipolymath.app/Contents/Resources/install-cli.sh",
            compatibleWith: "2026.7.4")

        #expect(command == [
            "/bin/bash",
            "/Applications/Omnipolymath.app/Contents/Resources/install-cli.sh",
            "--json",
            "--no-onboard",
            "--prefix",
            "/Users/Test User/.omnipolymath",
            "--version",
            "2026.7.3-beta.1",
        ])
        #expect(!command.contains("curl"))
        #expect(!command.contains("--compatible-with"))
    }

    @Test func `channel installer checks compatibility before replacing the managed CLI`() {
        let command = CLIInstaller.installScriptCommand(
            target: .channel(.stable),
            prefix: "/Users/Test User/.omnipolymath",
            scriptPath: "/Applications/Omnipolymath.app/Contents/Resources/install-cli.sh",
            compatibleWith: "2026.7.3-beta.8")

        #expect(command.suffix(3) == [
            "latest",
            "--compatible-with",
            "2026.7.3-beta.8",
        ])
    }

    @Test func `dev installer uses a managed git main checkout`() {
        let command = CLIInstaller.installScriptCommand(
            target: .channel(.dev),
            prefix: "/Users/Test User/.omnipolymath",
            scriptPath: "/Applications/Omnipolymath.app/Contents/Resources/install-cli.sh",
            compatibleWith: "2026.7.3")

        #expect(command.suffix(5) == [
            "2026.7.3",
            "--install-method",
            "git",
            "--git-dir",
            "/Users/Test User/.omnipolymath/dev/omnipolymath",
        ])
    }

    @Test func `dev source installs allow a full cold build`() {
        #expect(CLIInstaller.installWatchdogTimeout(for: .channel(.dev)) == 7200)
        #expect(CLIInstaller.installWatchdogTimeout(for: .channel(.stable)) == 900)
        #expect(CLIInstaller.installWatchdogTimeout(for: .channel(.beta)) == 900)
        #expect(CLIInstaller.installWatchdogTimeout(for: .exact(String())) == 900)
    }

    @Test func `installer events map to concise live status`() {
        let cases: [(String, String)] = [
            (#"{"event":"step","name":"disk-space","status":"start"}"#, "Checking available disk space…"),
            (#"{"event":"step","name":"node","status":"start"}"#, "Installing Node.js runtime…"),
            (#"{"event":"step","name":"git-tools","status":"start"}"#, "Preparing Git and pnpm…"),
            (#"{"event":"step","name":"git-clone","status":"start"}"#, "Downloading Omnipolymath source…"),
            (#"{"event":"step","name":"git-update","status":"start"}"#, "Updating Omnipolymath source…"),
            (#"{"event":"step","name":"dependencies","status":"start"}"#, "Installing dependencies…"),
            (#"{"event":"step","name":"control-ui","status":"start"}"#, "Building interface…"),
            (#"{"event":"step","name":"cli-build","status":"start"}"#, "Building Omnipolymath CLI…"),
            (#"{"event":"step","name":"omnipolymath","status":"retry"}"#, "Retrying Omnipolymath CLI install…"),
            (
                #"{"event":"step","name":"disk-space","status":"warn"}"#,
                "Couldn’t verify free disk space; continuing…"),
            (
                #"{"event":"step","name":"git-update","status":"warn"}"#,
                "Using the existing modified Omnipolymath source…"),
            (
                #"{"event":"step","name":"control-ui","status":"warn"}"#,
                "Interface build did not finish; continuing…"),
        ]

        for (line, expected) in cases {
            #expect(CLIInstaller.installStatus(forEventLine: line) == expected)
        }
    }

    @Test func `installer status ignores malformed unknown and terminal events`() {
        for line in [
            "not json",
            #"{"event":"step","name":"future-stage","status":"start"}"#,
            #"{"event":"step","name":"dependencies","status":"ok"}"#,
            #"{"event":"done","ok":true,"version":"2026.7.3"}"#,
            #"{"event":"error","message":"failed"}"#,
        ] {
            #expect(CLIInstaller.installStatus(forEventLine: line) == nil)
        }
    }

    @Test func `installer extracts one actionable disk preflight error`() {
        let output = """
        {"event":"step","name":"disk-space","status":"start"}
        {"event":"error","message":"Fresh Git installs require at least 6 GiB of free disk space; only 2.0 GiB is available. Free disk space and retry."}
        """

        #expect(CLIInstaller.installErrorMessage(from: output) ==
            "Fresh Git installs require at least 6 GiB of free disk space; only 2.0 GiB is available. Free disk space and retry.")
    }

    @Test func `managed update uses the canonical updater without accepting downgrades`() {
        let command = CLIInstaller.managedUpdateCommand(
            executable: "/Users/Test User/.omnipolymath/bin/omnipolymath",
            targetVersion: "2026.7.4")

        #expect(command == [
            "/Users/Test User/.omnipolymath/bin/omnipolymath",
            "update",
            "--tag",
            "2026.7.4",
            "--json",
            "--timeout",
            "900",
        ])
        #expect(!command.contains("--yes"))

        let withoutRestart = CLIInstaller.managedUpdateCommand(
            executable: "/Users/Test User/.omnipolymath/bin/omnipolymath",
            targetVersion: "2026.7.4",
            restartGateway: false)
        #expect(withoutRestart == command + ["--no-restart"])

        let repair = CLIInstaller.managedUpdateCommand(
            executable: "/Users/Test User/.omnipolymath/bin/omnipolymath",
            targetVersion: "2026.7.4",
            restartGateway: false,
            repair: true)
        #expect(repair == [
            "/Users/Test User/.omnipolymath/bin/omnipolymath",
            "update",
            "repair",
            "--json",
            "--timeout",
            "900",
            "--yes",
            "--no-restart",
        ])

        let profile = AppProfile(environment: ["OMNIPOLYMATH_PROFILE": "work"])
        #expect(CLIInstaller.managedUpdateCommand(
            executable: "/opt/omnipolymath",
            targetVersion: "2026.7.4",
            profile: profile) == [
            "/opt/omnipolymath", "--profile", "work", "update", "--tag", "2026.7.4",
            "--json", "--timeout", "900",
        ])
        #expect(CLIInstaller.managedUpdateCommand(
            executable: "/opt/omnipolymath",
            targetVersion: "2026.7.4",
            repair: true,
            profile: profile) == [
            "/opt/omnipolymath", "--profile", "work", "update", "repair", "--json",
            "--timeout", "900", "--yes",
        ])
    }

    @Test(arguments: [false, true])
    func `stale managed update preserves a runtime advanced by the CLI`(advancesDuringDispatch: Bool) async throws {
        let root = FileManager().temporaryDirectory.appendingPathComponent(
            "omnipolymath-update-ahead-\(UUID().uuidString)")
        defer { try? FileManager().removeItem(at: root) }
        try FileManager().createDirectory(at: root, withIntermediateDirectories: true)
        let executable = root.appendingPathComponent("omnipolymath")
        let dispatched = root.appendingPathComponent("update-dispatched")
        try """
        #!/bin/sh
        if [ "$1" = "--version" ]; then
          if [ '\(advancesDuringDispatch)' = 'true' ] && [ ! -f '\(dispatched.path)' ]; then
            echo 'Omnipolymath 2026.9.8'
          else
            echo 'Omnipolymath 2026.10.2'
          fi
          exit 0
        fi
        touch '\(dispatched.path)'
        echo '{"status":"skipped","reason":"downgrade-confirmation-required","before":{"version":"2026.10.2"}}'
        exit 1
        """.write(to: executable, atomically: false, encoding: .utf8)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        let config = root.appendingPathComponent("omnipolymath.json")
        try "{}".write(to: config, atomically: false, encoding: .utf8)
        try await TestIsolation.withIsolatedState(
            env: ["OMNIPOLYMATH_STATE_DIR": root.path, "OMNIPOLYMATH_CONFIG_PATH": config.path],
            defaults: [cliInstallPolicyKey: "exact"])
        {
            let absent = root.appendingPathComponent("absent-service")
            let authority = GatewayLaunchAgentManager.ServiceAuthority(
                plist: absent, environment: absent, wrapper: absent,
                definition: .init(plist: nil, environment: nil, wrapper: nil),
                isLocalGateway: false, updateSelection: CLIInstallPolicy.managedUpdateSelection())
            var dispatchedReceipt = false
            let outcome = await CLIInstaller.updateManaged(
                targetVersion: "2026.9.8",
                installedCLI: .init(
                    prefix: [executable.path], sqliteLibrary: nil, serviceAuthority: authority),
                onDispatch: { dispatchedReceipt = true },
                statusHandler: { _ in })

            #expect(outcome == .success(fromVersion: "2026.10.2", toVersion: "2026.10.2"))
            #expect(dispatchedReceipt == advancesDuringDispatch)
            #expect(FileManager().fileExists(atPath: dispatched.path) == advancesDuringDispatch)
        }
        #expect(CLIInstaller.satisfiesUpdateTarget(installedVersion: "2026.10.2", targetVersion: "2026.9.8"))
        #expect(!CLIInstaller.satisfiesUpdateTarget(installedVersion: "2026.9.8", targetVersion: "2026.10.2"))
    }

    @Test func `managed update parses structured updater diagnostics`() throws {
        let summary = try #require(CLIInstaller.parseManagedUpdateSummary("""
        {
          "status": "error",
          "mode": "npm",
          "reason": "package-update-failed",
          "before": { "version": "2026.7.3" },
          "after": { "version": "2026.7.3" },
          "steps": [
            { "name": "package update", "exitCode": 1, "stderrTail": "registry unavailable" }
          ],
          "durationMs": 42
        }
        """))

        #expect(summary.status == "error")
        #expect(summary.reason == "package-update-failed")
        #expect(summary.before?.version == "2026.7.3")
        #expect(summary.steps?.first?.name == "package update")
        #expect(summary.steps?.first?.stderrTail == "registry unavailable")
    }

    @Test(arguments: [
        (
            #"{"status":"warning","coreUpdate":"completed","warnings":["Optional device-pair plugin is disabled"]}"#,
            0,
            true),
        (#"{"status":"ok","coreUpdate":"completed"}"#, 0, true),
        (#"{"status":"warning","coreUpdate":"pending"}"#, 0, false),
        (#"{"status":"error","coreUpdate":"completed"}"#, 1, false),
        (#"{"status":"warning","coreUpdate":"completed"}"#, 1, false),
        (#"{"status":"ok"}"#, 0, false),
        (#"{"status":"ok","coreUpdate":"unknown"}"#, 0, false),
    ])
    func `managed repair settles only proven core completion across relaunch`(
        payload: String, exitCode: Int, completes: Bool) async throws
    {
        let root = temporaryDirectoryForTests().appendingPathComponent(
            "omnipolymath-repair-completion-\(UUID().uuidString)")
        defer { try? FileManager().removeItem(at: root) }
        try FileManager().createDirectory(at: root, withIntermediateDirectories: true)
        let executable = root.appendingPathComponent("omnipolymath")
        try """
        #!/bin/sh
        if [ "$1" = "--version" ]; then
          echo 'Omnipolymath 2026.10.2'
          exit 0
        fi
        echo '\(payload)'
        exit \(exitCode)
        """.write(to: executable, atomically: false, encoding: .utf8)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        let config = root.appendingPathComponent("omnipolymath.json")
        try "{}".write(to: config, atomically: false, encoding: .utf8)
        let suite = "CLIInstallerTests.repair-completion.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        try await TestIsolation.withIsolatedState(
            env: ["OMNIPOLYMATH_STATE_DIR": root.path, "OMNIPOLYMATH_CONFIG_PATH": config.path],
            defaults: [cliInstallPolicyKey: "exact"])
        {
            let absent = root.appendingPathComponent("absent-service")
            let authority = GatewayLaunchAgentManager.ServiceAuthority(
                plist: absent,
                environment: absent,
                wrapper: absent,
                definition: .init(plist: nil, environment: nil, wrapper: nil),
                isLocalGateway: false,
                updateSelection: CLIInstallPolicy.managedUpdateSelection())
            let receipt = PostAppUpdateReceiptStore.recordSetupRecovery(
                fromVersion: "2026.9.8", toVersion: "2026.10.2", defaults: defaults)
            let outcome = await CLIInstaller.updateManaged(
                targetVersion: "2026.10.2",
                restartGateway: false,
                repair: true,
                installedCLI: .init(
                    prefix: [executable.path], sqliteLibrary: nil, serviceAuthority: authority),
                statusHandler: { _ in })

            switch outcome {
            case .success:
                #expect(completes)
                PostAppUpdateReceiptStore.completeCoreRepair(
                    receipt: receipt, owner: .gateway, defaults: defaults)
            case .failure:
                #expect(!completes)
            }
            let relaunched = try #require(PostAppUpdateReceiptStore.pendingForLaunch(
                currentVersion: "2026.10.2", onboardingSeen: true, defaults: defaults))
            #expect(relaunched.coreUpdatePending == !completes)
            #expect(PostUpdateController.coreRepairAction(
                receipt: relaunched, migrationFailed: false, explicitRetry: true) ==
                (completes ? .none : .repair))
        }
    }

    @Test func `release builds install exact while unreleased builds choose a channel`() {
        #expect(CLIInstaller.automaticInstallTarget(
            appVersion: "2026.7.2",
            isDebug: false) == .exact("2026.7.2"))
        #expect(CLIInstaller.automaticInstallTarget(
            appVersion: "2026.7.2-1",
            isDebug: false) == .exact("2026.7.2-1"))
        #expect(CLIInstaller.automaticInstallTarget(
            appVersion: "2026.7.2-beta.1",
            isDebug: false) == nil)
        #expect(CLIInstaller.automaticInstallTarget(
            appVersion: "2026.7.2",
            isDebug: true) == nil)
        #expect(CLIInstaller.suggestedChannel(
            appVersion: "2026.7.2-beta.1",
            isDebug: false) == .beta)
        #expect(CLIInstaller.suggestedChannel(
            appVersion: "2026.7.2",
            isDebug: true) == .dev)
    }

    @Test func `channel policy accepts the selected channel version`() throws {
        let suite = "CLIInstallerTests.channel-policy.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }

        #expect(CLIInstallPolicy.storedPolicy(defaults: defaults) == nil)
        #expect(CLIInstallPolicy.requiredGatewayVersionString(
            appVersion: "2026.7.2",
            isDebug: true,
            defaults: defaults) == "2026.7.2")
        defaults.set("beta", forKey: cliInstallPolicyKey)
        #expect(CLIInstallPolicy.storedPolicy(defaults: defaults) == "beta")
        #expect(CLIInstallPolicy.requiredGatewayVersionString(
            appVersion: "2026.7.2",
            isDebug: true,
            defaults: defaults) == nil)
        #expect(CLIInstallPolicy.requiredGatewayVersionString(
            appVersion: "2026.7.2-beta.1",
            isDebug: false,
            defaults: defaults) == nil)
        #expect(CLIInstallPolicy.requiredGatewayVersionString(
            appVersion: "2026.7.2",
            isDebug: false,
            defaults: defaults) == "2026.7.2")
    }

    @Test func `validated CLI cache changes only when the ready tuple changes`() throws {
        let suite = "CLIInstallerTests.validated-cache.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let notificationCount = OSAllocatedUnfairLock(initialState: 0)
        let initialLocation = "/Users/test/.local/bin/omnipolymath"
        defaults.set(initialLocation, forKey: cliValidatedExecutableKey)
        defaults.set("2026.8.1", forKey: cliValidatedVersionKey)
        let observer = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification,
            object: defaults,
            queue: nil)
        { _ in
            notificationCount.withLock { $0 += 1 }
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        CLIInstaller.rememberValidated(
            .ready(location: initialLocation, version: "2026.8.1"),
            defaults: defaults)

        #expect(notificationCount.withLock { $0 } == 0)

        let updatedLocation = "/opt/homebrew/bin/omnipolymath"
        CLIInstaller.rememberValidated(
            .ready(location: updatedLocation, version: "2026.8.1"),
            defaults: defaults)

        #expect(notificationCount.withLock { $0 } == 1)
        #expect(defaults.string(forKey: cliValidatedExecutableKey) == updatedLocation)
        #expect(defaults.string(forKey: cliValidatedVersionKey) == "2026.8.1")

        CLIInstaller.rememberValidated(
            .ready(location: updatedLocation, version: "2026.8.2"),
            defaults: defaults)

        #expect(notificationCount.withLock { $0 } == 2)
        #expect(defaults.string(forKey: cliValidatedVersionKey) == "2026.8.2")
    }

    @Test func `managed setup requires a parseable compatible version`() {
        let location = "/Users/test/.omnipolymath/bin/omnipolymath"

        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "Omnipolymath 2026.7.3\n",
            expectedVersion: "2026.7.3") == .ready(location: location, version: "2026.7.3"))
        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "Omnipolymath\n",
            expectedVersion: "2026.7.3") == .unusable(location: location))
        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "2026.6.1\n",
            expectedVersion: "2026.7.3") == .incompatible(
            location: location,
            found: "2026.6.1",
            required: "2026.7.3"))
        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "2026.7.3-beta.1\n",
            expectedVersion: "2026.7.3-beta.2") == .incompatible(
            location: location,
            found: "2026.7.3-beta.1",
            required: "2026.7.3-beta.2"))
        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "2026.7.3-beta.2\n",
            expectedVersion: "2026.7.3") == .incompatible(
            location: location,
            found: "2026.7.3-beta.2",
            required: "2026.7.3"))
        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "2026.7.3\n",
            expectedVersion: "2026.7.3-beta.2") == .incompatible(
            location: location,
            found: "2026.7.3",
            required: "2026.7.3-beta.2"))
        #expect(CLIInstaller.classifyVersion(
            location: location,
            output: "2026.7.3-alpha.1\n",
            expectedVersion: "2026.7.3") == .incompatible(
            location: location,
            found: "2026.7.3-alpha.1",
            required: "2026.7.3"))
    }

    @Test func `channel install cannot bootstrap with an older config writer`() {
        #expect(!CLIInstaller.channelInstallIsCompatible(
            installedVersion: "2026.7.1-2",
            appVersion: "2026.7.2"))
        #expect(!CLIInstaller.channelInstallIsCompatible(
            installedVersion: "2026.7.2-beta.6",
            appVersion: "2026.7.2-beta.7"))
        #expect(CLIInstaller.channelInstallIsCompatible(
            installedVersion: "2026.7.2",
            appVersion: "2026.7.2-beta.7"))
        #expect(CLIInstaller.channelInstallIsCompatible(
            installedVersion: "2026.7.2-beta.7",
            appVersion: "2026.7.2"))
        #expect(CLIInstaller.channelInstallIsCompatible(
            installedVersion: "2026.7.2-1",
            appVersion: "2026.7.2-2"))
        #expect(CLIInstaller.channelInstallIsCompatible(
            installedVersion: "2026.7.3-beta.1",
            appVersion: "2026.7.2"))
    }

    @Test func `compatible external CLI satisfies setup`() async throws {
        let root = FileManager().temporaryDirectory.appendingPathComponent(
            "omnipolymath-compatible-cli-\(UUID().uuidString)")
        defer { try? FileManager().removeItem(at: root) }
        try FileManager().createDirectory(at: root, withIntermediateDirectories: true)
        let executable = root.appendingPathComponent("omnipolymath")
        let node = root.appendingPathComponent("node")
        try "#!/bin/sh\necho 'Omnipolymath 2026.7.3'\n".write(
            to: executable,
            atomically: true,
            encoding: .utf8)
        try "#!/bin/sh\necho 'v24.22.1'\n".write(
            to: node,
            atomically: true,
            encoding: .utf8)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)

        let status = await CLIInstaller.status(location: executable.path)

        #expect(status == .ready(location: executable.path, version: "2026.7.3"))
    }

    @Test(arguments: [("v20.18.0", 0), ("v24.15.0", 1)])
    func `matching external CLI with an unusable Node runtime needs repair`(
        version: String,
        exitCode: Int) async throws
    {
        let root = FileManager().temporaryDirectory.appendingPathComponent(
            "omnipolymath-old-node-cli-\(UUID().uuidString)")
        defer { try? FileManager().removeItem(at: root) }
        try FileManager().createDirectory(at: root, withIntermediateDirectories: true)
        let executable = root.appendingPathComponent("omnipolymath")
        let node = root.appendingPathComponent("node")
        try "#!/bin/sh\necho 'Omnipolymath 2026.7.3'\n".write(
            to: executable,
            atomically: true,
            encoding: .utf8)
        try "#!/bin/sh\necho '\(version)'\nexit \(exitCode)\n".write(
            to: node,
            atomically: true,
            encoding: .utf8)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        try FileManager().setAttributes([.posixPermissions: 0o755], ofItemAtPath: node.path)

        let status = await CLIInstaller.status(location: executable.path)

        #expect(status == .unusable(location: executable.path))
    }

    @Test func `CLI probe preserves environment and resolves shebang tools beside executable`() {
        let location = "/custom/bin/omnipolymath"
        let environment = CLIInstaller.probeEnvironment(
            location: location,
            processEnvironment: ["HOME": "/Users/test", "PATH": "/usr/bin"],
            preferredPaths: ["/opt/homebrew/bin", "/usr/bin"])

        #expect(environment["HOME"] == "/Users/test")
        #expect(environment["PATH"] == "/custom/bin:/opt/homebrew/bin:/usr/bin")
    }

    @Test func `managed CLI probe prefers its private runtime`() {
        let executable = "/Users/test/.omnipolymath/bin/omnipolymath"
        let environment = CLIInstaller.probeEnvironment(
            location: executable,
            processEnvironment: [:],
            preferredPaths: ["/Users/test/.nvm/versions/node/v20/bin", "/usr/bin"],
            managedExecutable: executable,
            managedRuntimeDirectory: "/Users/test/.omnipolymath/tools/node/bin")

        #expect(environment["PATH"] == [
            "/Users/test/.omnipolymath/bin",
            "/Users/test/.omnipolymath/tools/node/bin",
            "/Users/test/.nvm/versions/node/v20/bin",
            "/usr/bin",
        ].joined(separator: ":"))
    }

    @Test(arguments: [false, true])
    func `successful CLI setup starts the local gateway and waits for readiness`(pauseDuringReadiness: Bool) async {
        var didStart = false
        var didWait = false
        var paused = false

        let activation = await CLIInstaller.activateLocalGateway(
            mode: .local,
            paused: paused,
            start: { didStart = true },
            waitUntilReady: {
                didWait = true
                paused = pauseDuringReadiness
                return true
            })

        #expect(didStart)
        #expect(didWait)
        #expect(activation == (pauseDuringReadiness ? .deferred : .ready))
    }

    @Test func `paused CLI setup defers gateway activation`() async {
        var didStart = false
        var didWait = false

        let activation = await CLIInstaller.activateLocalGateway(
            mode: .local,
            paused: true,
            start: { didStart = true },
            waitUntilReady: {
                didWait = true
                return true
            })

        #expect(!didStart)
        #expect(!didWait)
        #expect(activation == .deferred)
    }

    @Test func `failed CLI setup binds the reason to this activation attempt`() async {
        let activation = await CLIInstaller.activateLocalGateway(
            mode: .local,
            paused: false,
            start: {},
            waitUntilReady: { false },
            failureReason: { "launchd disabled" })

        #expect(activation == .failed(reason: "launchd disabled"))
    }
}
