import Foundation
import OmnipolymathChatUI
import OmnipolymathProtocol

@MainActor
enum MacGatewayGroupDefaults {
    static func browser(connection: OmnipolymathSessionMenuConnection) -> OmnipolymathGroupDefaultsBrowser {
        // ui/src/components/app-sidebar.ts:93–125: browse the Gateway, including remote hosts,
        // and retain the captured connection's lease for both filesystem operations.
        OmnipolymathGroupDefaultsBrowser(
            listDirectory: { path in
                try await JSONDecoder().decode(
                    FsListDirResult.self,
                    from: connection.request(OmnipolymathChatGatewayRequests.groupDefaultsDirectory(path)))
            },
            inspectRepository: { path in
                let result = try await JSONDecoder().decode(
                    WorktreesBranchesResult.self,
                    from: connection.request(OmnipolymathChatGatewayRequests.groupDefaultsRepository(path)))
                return result.repositorystatus ?? .unavailable
            })
    }
}
