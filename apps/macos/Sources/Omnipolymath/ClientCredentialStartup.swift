import Foundation
import OmnipolymathNativeState

@MainActor
enum ClientCredentialStartup {
    typealias CommandRunner = @Sendable ([String], String, [String: String]) async -> ShellExecutor.ShellResult

    /// Run the app's matching migration owner before native credential admission.
    /// The selected Gateway may still use an older runtime; PATH is not an update authority.
    static func prepare(
        executionRoot: URL,
        configURL: URL,
        bundle: Bundle = .main,
        profile: AppProfile = .current,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        runCommand: CommandRunner = { command, cwd, environment in
            await ShellExecutor.runDetailed(
                command: command,
                cwd: cwd,
                env: environment,
                timeout: CLIInstaller.managedUpdateTimeout)
        }) async throws
    {
        try Task.checkCancellation()
        let runtime = try BundledRuntime.resolve(bundle: bundle)
        var childEnvironment = environment.merging(runtime.environment) { _, bundled in bundled }
        childEnvironment["OMNIPOLYMATH_PROFILE"] = profile.name ?? "default"
        childEnvironment["OMNIPOLYMATH_STATE_DIR"] = executionRoot.path
        childEnvironment["OMNIPOLYMATH_CONFIG_PATH"] = configURL.path
        let command = profile.localCLICommand(
            prefix: runtime.cliCommand,
            arguments: ["doctor", "--client-credentials", "--fix", "--non-interactive"])
        let result = await runCommand(command, runtime.packageRoot.path, childEnvironment)
        try Task.checkCancellation()
        guard result.success, !result.timedOut, result.exitCode == 0 else {
            let detail = [result.preflightError, result.stderr, result.errorMessage]
                .compactMap { $0?.nonEmpty }.first ?? "Credential preparation did not complete."
            throw OmnipolymathNativeStateError("Could not prepare local client credentials. " + detail.suffix(4000))
        }
    }
}
