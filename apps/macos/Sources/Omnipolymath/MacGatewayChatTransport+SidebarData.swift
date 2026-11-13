import Foundation
import OmnipolymathChatUI

extension MacGatewayChatTransport: OmnipolymathChatSidebarTransport {
    func acquireSidebarRequest() async throws -> @Sendable (OmnipolymathChatGatewayRequest) async throws -> Data {
        let lease = try await self.connection.acquireServerLease()
        try await self.requireCurrentOutboxGateway()
        return { request in
            try await self.connection.request(request, ifCurrentServerLease: lease)
        }
    }

    func loadSidebarAgentAvatar(_ source: String) async -> Data? {
        guard let lease = try? await self.connection.acquireServerLease(),
              await (try? self.requireCurrentOutboxGateway()) != nil else { return nil }
        guard let context = await self.connection.loadSourceContext(),
              let url = OmnipolymathSidebarAgentAvatarSource.resourceURL(source, context: context),
              let (data, response) = try? await self.connection.requestSourceResource(
                  url: url,
                  maximumBytes: OmnipolymathSidebarAgentAvatarSource.maximumBytes,
                  lease: lease,
                  revision: self.connection.sourceResourceRevision),
              (response as? HTTPURLResponse)?.statusCode == 200,
              response.mimeType?.lowercased().hasPrefix("image/") == true,
              !data.isEmpty else { return nil }
        return data
    }

    func snapshotTransportEvent(previousLease: GatewayConnection.ServerLease) async -> OmnipolymathChatTransportEvent {
        if self.connection.serverLeaseMatchesCurrentRoute(previousLease) { return .reconnected }
        // The cache namespace survives explicit reconnect/token renewal; profile principal changes
        // retire the fleet owner (MacGatewayProfiles.swift), and Primary rechecks its current identity.
        if self.outboxGatewayID != nil, await self.currentOutboxGatewayMatchesConnection() { return .reconnected }
        return .routeChanged
    }
}
