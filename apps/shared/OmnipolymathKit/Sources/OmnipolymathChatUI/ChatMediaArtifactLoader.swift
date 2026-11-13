import Foundation
import OmnipolymathProtocol

public enum OmnipolymathChatMediaArtifactLoader {
    public enum LoadError: Error, Equatable {
        case invalidSource
        case invalidResponse
        case requestFailed(statusCode: Int)
        case unsupportedMediaType
        case payloadTooLarge
    }

    public typealias Download = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)
    public typealias Source = (url: URL, allowsStreaming: Bool, download: Download)

    public static func load(
        response: ArtifactsDownloadResult,
        kind: OmnipolymathChatMediaKind,
        playback: OmnipolymathChatPlaybackMode?,
        source: @Sendable (String) async throws -> Source) async throws -> OmnipolymathChatLoadedMedia
    {
        let declaredMIME = response.artifact.mimetype?.lowercased()
        if playback != .transcode,
           let encoded = response.data?.trimmingCharacters(in: .whitespacesAndNewlines),
           !encoded.isEmpty
        {
            guard response.encoding == "base64",
                  let declaredMIME,
                  kind.acceptsMIMEType(declaredMIME),
                  let data = Data(base64Encoded: encoded)
            else { throw LoadError.invalidResponse }
            guard data.count <= kind.maximumDownloadBytes else { throw LoadError.payloadTooLarge }
            return .data(OmnipolymathChatMediaData(data: data, mimeType: declaredMIME))
        }

        let source = try await source(response.url?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "")
        let canStream = source.allowsStreaming && kind == .video &&
            source.url.scheme?.lowercased() == "https" && declaredMIME.map(kind.acceptsMIMEType) == true
        if canStream, playback != .transcode, let declaredMIME {
            return .stream(OmnipolymathChatMediaStream(
                url: source.url, mimeType: declaredMIME, sizeBytes: response.artifact.sizebytes))
        }

        var request = URLRequest(url: source.url)
        request.timeoutInterval = kind == .video ? 60 : 20
        request.setValue(kind.acceptHeader, forHTTPHeaderField: "Accept")
        if canStream {
            request.setValue("bytes=0-0", forHTTPHeaderField: "Range")
        }
        let (data, http) = try await source.download(request)
        if http.statusCode == 202 {
            return .preparing
        }
        guard (200..<300).contains(http.statusCode) else {
            throw LoadError.requestFailed(statusCode: http.statusCode)
        }
        guard let mimeType = http.mimeType?.lowercased(), kind.acceptsMIMEType(mimeType) else {
            throw LoadError.unsupportedMediaType
        }
        if canStream {
            return .stream(OmnipolymathChatMediaStream(
                url: source.url, mimeType: mimeType, sizeBytes: response.artifact.sizebytes))
        }
        guard data.count <= kind.maximumDownloadBytes else { throw LoadError.payloadTooLarge }
        return .data(OmnipolymathChatMediaData(data: data, mimeType: mimeType))
    }
}
