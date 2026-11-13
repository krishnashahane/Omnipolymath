import Foundation
import OmnipolymathChatUI
import OmnipolymathKit
import OmnipolymathProtocol

extension GatewayConnection {
    func loadMediaArtifact(
        sessionKey: String,
        agentID: String?,
        artifactId: String,
        kind: OmnipolymathChatMediaKind,
        playback: OmnipolymathChatPlaybackMode?,
        ifCurrentServerLease lease: ServerLease) async throws -> OmnipolymathChatLoadedMedia?
    {
        guard kind.acceptsManagedArtifactID(artifactId) else { return nil }
        let request = OmnipolymathChatGatewayRequests.artifactDownload(
            sessionKey: sessionKey,
            agentID: agentID,
            artifactId: artifactId)
        let responseData = try await self.request(
            request,
            ifCurrentServerLease: lease)
        let response = try JSONDecoder().decode(ArtifactsDownloadResult.self, from: responseData)
        let loaded: OmnipolymathChatLoadedMedia
        do {
            loaded = try await OmnipolymathChatMediaArtifactLoader.load(
                response: response, kind: kind, playback: playback)
            { ticketedPath in
                guard let url = OmnipolymathChatMediaURL.resolve(
                    gatewayURL: lease.route.url,
                    ticketedPath: ticketedPath,
                    playback: playback)
                else { throw OmnipolymathChatMediaArtifactLoader.LoadError.invalidSource }
                return (url, lease.route.browserSession == nil && lease.route.tls == nil, { urlRequest in
                    var urlRequest = urlRequest
                    // Artifact tickets do not bypass the ingress issuer. Reuse the socket's
                    // exact session and reject redirects before any credential can leave its authority.
                    for (name, value) in try lease.route.browserSession?.headers(for: url) ?? [:] {
                        urlRequest.setValue(value, forHTTPHeaderField: name)
                    }
                    let tls = lease.route.tls?.params ?? GatewayTLSParams(
                        required: lease.route.browserSession != nil,
                        expectedFingerprint: nil,
                        allowTOFU: false,
                        storeKey: nil)
                    let session = GatewayTLSPinningSession(
                        params: tls,
                        allowsRedirects: lease.route.browserSession == nil,
                        allowsStoredCredentials: lease.route.browserSession == nil)
                    defer { session.finishTasksAndInvalidate() }
                    guard await self.isCurrentServerLease(lease) else {
                        throw OmnipolymathChatTransportSendError.notDispatched
                    }
                    let (data, urlResponse) = try await self.transferMedia(
                        request: urlRequest,
                        session: session,
                        maximumBytes: kind.maximumDownloadBytes,
                        lease: lease)
                    guard await self.isCurrentServerLease(lease) else {
                        throw OmnipolymathChatTransportSendError.notDispatched
                    }
                    guard let http = urlResponse as? HTTPURLResponse else {
                        throw OmnipolymathChatMediaArtifactLoader.LoadError.invalidResponse
                    }
                    return (data, http)
                })
            }
        } catch is OmnipolymathChatMediaArtifactLoader.LoadError {
            return nil
        }
        guard await isCurrentServerLease(lease) else {
            throw OmnipolymathChatTransportSendError.notDispatched
        }
        return loaded
    }

    func transferMedia(
        request: URLRequest,
        session: GatewayTLSPinningSession,
        maximumBytes: Int,
        lease: ServerLease) async throws -> (Data, URLResponse)
    {
        let transferID = UUID()
        let transfer = Task {
            try await session.data(for: request, maximumBytes: maximumBytes) { [weak self] in
                self?.serverLeaseMatchesCurrentState(lease) == true
            }
        }
        managedMediaTransfers[transferID] = transfer
        defer { self.managedMediaTransfers[transferID] = nil }
        return try await withTaskCancellationHandler {
            try await transfer.value
        } onCancel: {
            transfer.cancel()
        }
    }
}
